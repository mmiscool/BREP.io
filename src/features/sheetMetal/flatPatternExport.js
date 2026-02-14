import * as THREE from "three";
import { Colors } from "@tarikjabiri/dxf";
import { deepClone } from "../../utils/deepClone.js";
import { evaluateSheetMetal } from "./engine/index.js";
import {
  buildDxfFromTwoDScene,
  buildSvgFromTwoDScene,
  computeTwoDSceneBounds,
} from "../../exporters/twoDSceneExport.js";

const EPS = 1e-8;
const SEG_KEY_QUANT = 1e-6;
const FLAT_PATTERN_STYLES = {
  CUT: {
    layer: "CUT",
    stroke: "#111111",
    textColor: "#111111",
    dxfColor: Colors.Black,
    dxfLineType: "Continuous",
  },
  BEND_UP: {
    layer: "BEND_UP",
    stroke: "#0066ff",
    textColor: "#0066ff",
    dxfColor: Colors.Blue,
    dxfDashPattern: [4, -2],
    svgDash: [6, 3],
  },
  BEND_DOWN: {
    layer: "BEND_DOWN",
    stroke: "#ff00cc",
    textColor: "#ff00cc",
    dxfColor: Colors.Magenta,
    dxfDashPattern: [4, -2],
    svgDash: [6, 3],
  },
  BEND_LABEL_UP: {
    layer: "BEND_LABEL_UP",
    stroke: "#0066ff",
    textColor: "#0066ff",
    dxfColor: Colors.Blue,
    dxfLineType: "Continuous",
  },
  BEND_LABEL_DOWN: {
    layer: "BEND_LABEL_DOWN",
    stroke: "#ff00cc",
    textColor: "#ff00cc",
    dxfColor: Colors.Magenta,
    dxfLineType: "Continuous",
  },
};

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function quantKey(value, quantum = SEG_KEY_QUANT) {
  const safe = toFiniteNumber(value, 0);
  if (!(quantum > 0)) return `${safe}`;
  return `${Math.round(safe / quantum)}`;
}

function pointKey2(point) {
  return `${quantKey(point[0])},${quantKey(point[1])}`;
}

function edgeKeyUndirected(a, b) {
  const ka = pointKey2(a);
  const kb = pointKey2(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function addSegmentCounter(map, a, b) {
  const dx = toFiniteNumber(a[0]) - toFiniteNumber(b[0]);
  const dy = toFiniteNumber(a[1]) - toFiniteNumber(b[1]);
  if ((dx * dx) + (dy * dy) <= EPS * EPS) return;
  const key = edgeKeyUndirected(a, b);
  const entry = map.get(key);
  if (entry) {
    entry.count += 1;
    return;
  }
  map.set(key, {
    count: 1,
    a: [toFiniteNumber(a[0]), toFiniteNumber(a[1])],
    b: [toFiniteNumber(b[0]), toFiniteNumber(b[1])],
  });
}

function flattenPoint(point3) {
  return [toFiniteNumber(point3?.x), toFiniteNumber(point3?.y)];
}

function flatOutlineWorld2(placement) {
  const outline = Array.isArray(placement?.flat?.outline) ? placement.flat.outline : [];
  const matrix = placement?.matrix;
  if (!outline.length || !matrix?.isMatrix4) return [];
  const out = [];
  for (const p of outline) {
    const world = new THREE.Vector3(toFiniteNumber(p?.[0]), toFiniteNumber(p?.[1]), 0).applyMatrix4(matrix);
    out.push([world.x, world.y]);
  }
  return out;
}

function addFlatPlacementOutlineSegments(segments, placement) {
  const poly = flatOutlineWorld2(placement);
  if (poly.length < 2) return;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    addSegmentCounter(segments, a, b);
  }
}

function buildBendBandPolylines2D(bendPlacement) {
  const edgeWorld = Array.isArray(bendPlacement?.edgeWorld) ? bendPlacement.edgeWorld : [];
  if (edgeWorld.length < 2) return null;

  const allowance = Math.max(0, toFiniteNumber(bendPlacement?.allowance, 0));
  if (!(allowance > EPS)) return null;

  const shiftDir = Array.isArray(bendPlacement?.shiftDir) ? bendPlacement.shiftDir : [0, 0];
  const shift = new THREE.Vector2(toFiniteNumber(shiftDir[0]), toFiniteNumber(shiftDir[1]));
  const shiftLen = shift.length();
  if (!(shiftLen > EPS)) return null;

  shift.normalize().multiplyScalar(allowance);
  const basePoints = [];
  const shiftedPoints = [];
  for (const point of edgeWorld) {
    const base = flattenPoint(point);
    basePoints.push(base);
    shiftedPoints.push([base[0] + shift.x, base[1] + shift.y]);
  }
  if (basePoints.length < 2) return null;
  return { basePoints, shiftedPoints };
}

function addBendBandBoundarySegments(segments, bendPlacement) {
  const band = buildBendBandPolylines2D(bendPlacement);
  if (!band) return;

  const { basePoints, shiftedPoints } = band;
  for (let i = 0; i < basePoints.length - 1; i += 1) {
    addSegmentCounter(segments, basePoints[i], basePoints[i + 1]);
    addSegmentCounter(segments, shiftedPoints[i], shiftedPoints[i + 1]);
  }
  addSegmentCounter(segments, basePoints[0], shiftedPoints[0]);
  addSegmentCounter(segments, basePoints[basePoints.length - 1], shiftedPoints[shiftedPoints.length - 1]);
}

function formatAngleLabel(angleDeg) {
  const abs = Math.abs(toFiniteNumber(angleDeg, 0));
  if (Math.abs(abs - Math.round(abs)) <= 1e-6) return `${Math.round(abs)}\u00B0`;
  return `${Number(abs.toFixed(2))}\u00B0`;
}

function polylineLength2(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

function polylineMidpoint2(points) {
  if (!Array.isArray(points) || points.length === 0) return [0, 0];
  if (points.length === 1) return [toFiniteNumber(points[0][0]), toFiniteNumber(points[0][1])];

  const total = polylineLength2(points);
  if (!(total > EPS)) return [toFiniteNumber(points[0][0]), toFiniteNumber(points[0][1])];
  let walk = total * 0.5;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(segLen > EPS)) continue;
    if (walk > segLen) {
      walk -= segLen;
      continue;
    }
    const t = walk / segLen;
    return [
      a[0] + ((b[0] - a[0]) * t),
      a[1] + ((b[1] - a[1]) * t),
    ];
  }

  const tail = points[points.length - 1];
  return [toFiniteNumber(tail[0]), toFiniteNumber(tail[1])];
}

function polylineDirection2(points) {
  if (!Array.isArray(points) || points.length < 2) return [1, 0];
  const a = points[0];
  const b = points[points.length - 1];
  const dx = toFiniteNumber(b[0]) - toFiniteNumber(a[0]);
  const dy = toFiniteNumber(b[1]) - toFiniteNumber(a[1]);
  const len = Math.hypot(dx, dy);
  if (!(len > EPS)) return [1, 0];
  return [dx / len, dy / len];
}

function buildBendCenterlineRecords(bends2D) {
  const out = [];
  for (const bendPlacement of bends2D || []) {
    const edgeWorld = Array.isArray(bendPlacement?.edgeWorld) ? bendPlacement.edgeWorld : [];
    if (edgeWorld.length < 2) continue;

    const allowance = Math.max(0, toFiniteNumber(bendPlacement?.allowance, 0));
    if (!(allowance > EPS)) continue;

    const shiftDir = Array.isArray(bendPlacement?.shiftDir) ? bendPlacement.shiftDir : [0, 0];
    const shift = new THREE.Vector2(toFiniteNumber(shiftDir[0]), toFiniteNumber(shiftDir[1]));
    const shiftLen = shift.length();
    if (!(shiftLen > EPS)) continue;
    shift.normalize().multiplyScalar(allowance * 0.5);

    const centerlinePoints = edgeWorld
      .map((point) => flattenPoint(point))
      .map((point) => [point[0] + shift.x, point[1] + shift.y]);
    if (centerlinePoints.length < 2) continue;

    const angleDeg = toFiniteNumber(bendPlacement?.bend?.angleDeg, 0);
    const direction = angleDeg >= 0 ? "UP" : "DOWN";
    const tangent = polylineDirection2(centerlinePoints);
    const normalLen = Math.hypot(toFiniteNumber(shiftDir[0]), toFiniteNumber(shiftDir[1]));
    let nx = normalLen > EPS ? toFiniteNumber(shiftDir[0]) / normalLen : -tangent[1];
    let ny = normalLen > EPS ? toFiniteNumber(shiftDir[1]) / normalLen : tangent[0];
    const nLen = Math.hypot(nx, ny);
    if (!(nLen > EPS)) {
      nx = -tangent[1];
      ny = tangent[0];
    } else {
      nx /= nLen;
      ny /= nLen;
    }

    const midpoint = polylineMidpoint2(centerlinePoints);
    const labelOffset = Math.max(allowance * 0.65, 0.75);
    const labelPosition = [midpoint[0] + (nx * labelOffset), midpoint[1] + (ny * labelOffset)];
    const labelRotationDeg = THREE.MathUtils.radToDeg(Math.atan2(tangent[1], tangent[0]));
    const label = `${direction} ${formatAngleLabel(angleDeg)}`;

    out.push({
      points: centerlinePoints,
      direction,
      angleDeg,
      label,
      labelPosition,
      labelRotationDeg,
    });
  }
  return out;
}

function boundsFromGeometry(cutSegments, bendCenterlines) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (p) => {
    const x = toFiniteNumber(p?.[0], Number.NaN);
    const y = toFiniteNumber(p?.[1], Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const seg of cutSegments || []) {
    visit(seg?.a);
    visit(seg?.b);
  }
  for (const poly of bendCenterlines || []) {
    for (const p of poly) visit(p);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  return { minX, minY, maxX, maxY, width, height };
}

function buildFlatPatternScene({ cutSegments, bendCenterlineRecords, bounds }) {
  const scene = {
    units: "mm",
    styles: { ...FLAT_PATTERN_STYLES },
    entities: [],
  };

  for (const seg of cutSegments || []) {
    scene.entities.push({
      type: "line",
      style: "CUT",
      a: [toFiniteNumber(seg?.a?.[0]), toFiniteNumber(seg?.a?.[1])],
      b: [toFiniteNumber(seg?.b?.[0]), toFiniteNumber(seg?.b?.[1])],
    });
  }

  const bb = bounds || computeTwoDSceneBounds(scene);
  const labelHeight = Math.max(Math.max(bb.width, bb.height) * 0.018, 1.8);

  for (const record of bendCenterlineRecords || []) {
    const lineStyle = record?.direction === "DOWN" ? "BEND_DOWN" : "BEND_UP";
    const labelStyle = record?.direction === "DOWN" ? "BEND_LABEL_DOWN" : "BEND_LABEL_UP";
    const points = Array.isArray(record?.points) ? record.points : [];
    for (let i = 0; i < points.length - 1; i += 1) {
      scene.entities.push({
        type: "line",
        style: lineStyle,
        a: [toFiniteNumber(points[i][0]), toFiniteNumber(points[i][1])],
        b: [toFiniteNumber(points[i + 1][0]), toFiniteNumber(points[i + 1][1])],
      });
    }

    if (record?.label && Array.isArray(record?.labelPosition)) {
      scene.entities.push({
        type: "text",
        style: labelStyle,
        value: String(record.label),
        at: [toFiniteNumber(record.labelPosition[0]), toFiniteNumber(record.labelPosition[1])],
        rotationDeg: toFiniteNumber(record.labelRotationDeg, 0),
        height: labelHeight,
      });
    }
  }

  return scene;
}

export function buildFlatPatternExportData(treeLike) {
  const tree = deepClone(treeLike || null);
  if (!tree || typeof tree !== "object") {
    return {
      cutSegments: [],
      bendCenterlines: [],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
    };
  }

  const model = evaluateSheetMetal(tree);
  const segmentCounter = new Map();
  for (const placement of model?.flats2D || []) addFlatPlacementOutlineSegments(segmentCounter, placement);
  for (const bendPlacement of model?.bends2D || []) addBendBandBoundarySegments(segmentCounter, bendPlacement);

  const cutSegments = [];
  for (const entry of segmentCounter.values()) {
    if (entry.count === 1) {
      cutSegments.push({
        a: [entry.a[0], entry.a[1]],
        b: [entry.b[0], entry.b[1]],
      });
    }
  }

  const bendCenterlineRecords = buildBendCenterlineRecords(model?.bends2D || []);
  const bendCenterlines = bendCenterlineRecords.map((record) => record.points);
  const bounds = boundsFromGeometry(cutSegments, bendCenterlines);
  const scene = buildFlatPatternScene({ cutSegments, bendCenterlineRecords, bounds });
  return {
    cutSegments,
    bendCenterlines,
    bendCenterlineRecords,
    bounds,
    scene,
  };
}

function buildLegacyFlatPatternScene(data = {}) {
  const cutSegments = Array.isArray(data.cutSegments) ? data.cutSegments : [];
  const bendCenterlines = Array.isArray(data.bendCenterlines) ? data.bendCenterlines : [];

  const bendCenterlineRecords = bendCenterlines.map((points) => {
    const safePoints = Array.isArray(points)
      ? points.map((point) => [toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1])])
      : [];
    const tangent = polylineDirection2(safePoints);
    const mid = polylineMidpoint2(safePoints);
    const labelPosition = [mid[0] + (-tangent[1] * 1.5), mid[1] + (tangent[0] * 1.5)];
    return {
      points: safePoints,
      direction: "UP",
      angleDeg: 90,
      label: "",
      labelPosition,
      labelRotationDeg: THREE.MathUtils.radToDeg(Math.atan2(tangent[1], tangent[0])),
    };
  });

  return buildFlatPatternScene({
    cutSegments,
    bendCenterlineRecords,
    bounds: data.bounds || boundsFromGeometry(cutSegments, bendCenterlines),
  });
}

function resolveFlatPatternScene(data = {}) {
  const scene = data?.scene;
  if (scene && Array.isArray(scene.entities)) return scene;
  return buildLegacyFlatPatternScene(data);
}

export function buildFlatPatternDxf(data = {}) {
  return buildDxfFromTwoDScene(resolveFlatPatternScene(data));
}

export function buildFlatPatternSvg(data = {}) {
  return buildSvgFromTwoDScene(resolveFlatPatternScene(data));
}

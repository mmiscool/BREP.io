import * as THREE from "three";
import { DxfWriter, point3d, Colors, Units } from "@tarikjabiri/dxf";
import { deepClone } from "../../utils/deepClone.js";
import { evaluateSheetMetal } from "./engine/index.js";

const EPS = 1e-8;
const SEG_KEY_QUANT = 1e-6;

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

function buildBendCenterlinePolylines(bends2D) {
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

    const points = edgeWorld
      .map((p) => flattenPoint(p))
      .map((p) => [p[0] + shift.x, p[1] + shift.y]);
    if (points.length >= 2) out.push(points);
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

  const bendCenterlines = buildBendCenterlinePolylines(model?.bends2D || []);
  const bounds = boundsFromGeometry(cutSegments, bendCenterlines);
  return { cutSegments, bendCenterlines, bounds };
}

export function buildFlatPatternDxf({ cutSegments, bendCenterlines }) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);

  const bendDashName = "SM_BEND_DASH";
  try { writer.addLType(bendDashName, "_ _ _ _ _", [4, -2]); } catch {}
  try { writer.addLayer("CUT", Colors.Red, "Continuous"); } catch {}
  try { writer.addLayer("BEND_CENTER", Colors.Blue, bendDashName); } catch {}

  for (const seg of cutSegments || []) {
    writer.addLine(
      point3d(toFiniteNumber(seg?.a?.[0]), toFiniteNumber(seg?.a?.[1]), 0),
      point3d(toFiniteNumber(seg?.b?.[0]), toFiniteNumber(seg?.b?.[1]), 0),
      {
        layerName: "CUT",
        colorNumber: Colors.Red,
        lineType: "Continuous",
      }
    );
  }

  for (const poly of bendCenterlines || []) {
    for (let i = 0; i < poly.length - 1; i += 1) {
      const a = poly[i];
      const b = poly[i + 1];
      writer.addLine(
        point3d(toFiniteNumber(a?.[0]), toFiniteNumber(a?.[1]), 0),
        point3d(toFiniteNumber(b?.[0]), toFiniteNumber(b?.[1]), 0),
        {
          layerName: "BEND_CENTER",
          colorNumber: Colors.Blue,
          lineType: bendDashName,
          lineTypeScale: 1,
        }
      );
    }
  }

  return writer.stringify();
}

function fmt(value, digits = 6) {
  return Number(toFiniteNumber(value)).toFixed(digits);
}

export function buildFlatPatternSvg({ cutSegments, bendCenterlines, bounds }) {
  const bb = bounds || boundsFromGeometry(cutSegments, bendCenterlines);
  const pad = Math.max(bb.width, bb.height) * 0.03;
  const minX = bb.minX - pad;
  const minY = bb.minY - pad;
  const width = bb.width + (pad * 2);
  const height = bb.height + (pad * 2);
  const centerY = bb.minY + bb.maxY;
  const strokeWidth = Math.max(Math.max(bb.width, bb.height) * 0.0012, 0.15);
  const dashLength = strokeWidth * 8;
  const gapLength = strokeWidth * 4;

  const linesCut = (cutSegments || []).map((seg) => (
    `<line x1="${fmt(seg.a[0])}" y1="${fmt(seg.a[1])}" x2="${fmt(seg.b[0])}" y2="${fmt(seg.b[1])}" />`
  )).join("");

  const linesBend = [];
  for (const poly of bendCenterlines || []) {
    for (let i = 0; i < poly.length - 1; i += 1) {
      const a = poly[i];
      const b = poly[i + 1];
      linesBend.push(
        `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" />`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${fmt(width)}mm" height="${fmt(height)}mm"`,
    ` viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}">`,
    `  <g transform="translate(0 ${fmt(centerY)}) scale(1 -1)">`,
    `    <g fill="none" stroke="#ff0000" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round">`,
    `      ${linesCut}`,
    `    </g>`,
    `    <g fill="none" stroke="#0066ff" stroke-width="${fmt(strokeWidth)}" stroke-dasharray="${fmt(dashLength)} ${fmt(gapLength)}" stroke-linecap="round">`,
    `      ${linesBend.join("")}`,
    `    </g>`,
    `  </g>`,
    `</svg>`,
  ].join("");
}

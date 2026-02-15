import * as THREE from "three";
import Tess2 from "tess2";
import { SelectionState } from "../../UI/SelectionState.js";
import { BREP } from "../../BREP/BREP.js";
import { Solid } from "../../BREP/BetterSolid.js";
import { deepClone } from "../../utils/deepClone.js";
import { buildTwoDGroup, evaluateSheetMetal } from "./engine/index.js";
import { buildFlatPatternExportData } from "./flatPatternExport.js";

const EPS = 1e-8;
const POINT_EPS = 1e-4;
const MIN_THICKNESS = 1e-4;
const MIN_LEG = 1e-3;
const ENGINE_TAG = "sheet-metal-core";
const TRIANGLE_AREA_EPS = 1e-14;
const COORD_QUANT = 1e-7;
const EDGE_MATCH_EPS = 1e-3;
const OVERLAP_RELIEF_GAP = .0001;
const FLAT_PATTERN_OVERLAY_Z = 1e-3;
const FLAT_PATTERN_TEXT_RENDER_ORDER = 38;
const FLAT_PATTERN_LINE_RENDER_ORDER = 36;
const FLAT_PATTERN_TEXT_FONT_PX = 220;
const FLAT_PATTERN_TEXT_FONT_FAMILY = "Arial, Helvetica, sans-serif";

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function featureIdFromInstance(instance, fallback = "SheetMetal") {
  const raw =
    instance?.inputParams?.featureID ??
    instance?.inputParams?.id ??
    instance?.inputParams?.name ??
    fallback;
  return String(raw || fallback);
}

function matrixToArray(matrix) {
  if (matrix && matrix.isMatrix4 && Array.isArray(matrix.elements)) {
    return matrix.elements.slice();
  }
  return new THREE.Matrix4().identity().elements.slice();
}

function matrixFromAny(value) {
  if (value && value.isMatrix4) return value.clone();
  if (Array.isArray(value) && value.length === 16) {
    const m = new THREE.Matrix4();
    try {
      m.fromArray(value);
      return m;
    } catch {
      return new THREE.Matrix4().identity();
    }
  }
  if (value && Array.isArray(value.elements) && value.elements.length === 16) {
    const m = new THREE.Matrix4();
    try {
      m.fromArray(value.elements);
      return m;
    } catch {
      return new THREE.Matrix4().identity();
    }
  }
  return new THREE.Matrix4().identity();
}

function applyMatrixToObject(object, matrix) {
  if (!object || !matrix) return;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(pos, quat, scale);
  object.position.copy(pos);
  object.quaternion.copy(quat);
  object.scale.copy(scale);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function cloneTree(tree) {
  return deepClone(tree || {});
}

function isSolidLikeObject(value) {
  return !!(
    value
    && typeof value === "object"
    && (
      String(value.type || "").toUpperCase() === "SOLID"
      || typeof value.subtract === "function"
      || typeof value.union === "function"
      || typeof value._manifoldize === "function"
    )
  );
}

function cloneSolidWorldBaked(solid, nameHint = null) {
  if (!isSolidLikeObject(solid) || typeof solid.clone !== "function") return null;
  const clone = solid.clone();
  try { solid.updateMatrixWorld?.(true); } catch {
    // ignore
  }
  const worldMatrix = matrixFromAny(solid?.matrixWorld);
  try {
    clone.bakeTransform(worldMatrix);
  } catch {
    // best effort; if bake fails use raw clone
  }
  if (nameHint) clone.name = String(nameHint);
  return clone;
}

function serializeSolidSnapshot(solid) {
  if (!isSolidLikeObject(solid)) return null;
  const vertProperties = Array.isArray(solid?._vertProperties) ? solid._vertProperties.slice() : null;
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts.slice() : null;
  const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs.slice() : null;
  if (!vertProperties || !triVerts || !triIDs || !triVerts.length || !triIDs.length) return null;
  return {
    vertProperties,
    triVerts,
    triIDs,
    idToFaceName: (solid?._idToFaceName instanceof Map)
      ? Array.from(solid._idToFaceName.entries()).map(([id, name]) => [toFiniteNumber(id, 0), String(name || "")])
      : [],
  };
}

function solidFromSnapshot(snapshot, name = "SheetMetalCutout:CUTTER") {
  if (!snapshot || typeof snapshot !== "object") return null;
  const vertProperties = Array.isArray(snapshot.vertProperties) ? snapshot.vertProperties : [];
  const triVerts = Array.isArray(snapshot.triVerts) ? snapshot.triVerts : [];
  const triIDs = Array.isArray(snapshot.triIDs) ? snapshot.triIDs : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!vertProperties.length || triCount <= 0) return null;

  const solid = new Solid();
  solid.name = String(name || "SheetMetalCutout:CUTTER");
  solid._numProp = 3;
  solid._vertProperties = vertProperties.map((value) => toFiniteNumber(value, 0));
  solid._triVerts = triVerts.map((value) => Math.max(0, toFiniteNumber(value, 0) | 0));
  solid._triIDs = (triIDs.length === triCount)
    ? triIDs.map((value) => Math.max(0, toFiniteNumber(value, 0) | 0))
    : new Array(triCount).fill(0);
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < solid._vertProperties.length; i += 3) {
    const x = solid._vertProperties[i];
    const y = solid._vertProperties[i + 1];
    const z = solid._vertProperties[i + 2];
    solid._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
  }

  const idToFaceName = new Map();
  const entries = Array.isArray(snapshot.idToFaceName) ? snapshot.idToFaceName : [];
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const id = Math.max(0, toFiniteNumber(pair[0], 0) | 0);
    const faceName = String(pair[1] || `CUTOUT_FACE_${id}`);
    if (!idToFaceName.has(id)) idToFaceName.set(id, faceName);
  }
  for (const id of solid._triIDs) {
    if (!idToFaceName.has(id)) idToFaceName.set(id, `CUTOUT_FACE_${id}`);
  }
  solid._idToFaceName = idToFaceName;
  solid._faceNameToID = new Map(Array.from(idToFaceName.entries()).map(([id, faceName]) => [faceName, id]));
  solid._faceMetadata = new Map();
  solid._edgeMetadata = new Map();
  solid._auxEdges = [];
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  return solid;
}

function applyRecordedCutoutsToSolid(baseSolid, tree) {
  const summary = {
    requested: 0,
    applied: 0,
    skipped: 0,
    skippedNonBoolean: 0,
    appliedCutouts: [],
    skippedCutouts: [],
  };
  if (!isSolidLikeObject(baseSolid)) return { solid: baseSolid, summary };

  const cutouts = Array.isArray(tree?.__sheetMeta?.cutouts) ? tree.__sheetMeta.cutouts : [];
  summary.requested = cutouts.length;
  if (!cutouts.length) return { solid: baseSolid, summary };

  let result = baseSolid;
  for (let i = 0; i < cutouts.length; i += 1) {
    const cutout = cutouts[i] || {};
    const cutoutId = String(cutout?.id || `cutout_${i + 1}`);
    const mode = String(cutout?.mode || "").toLowerCase();
    const isLegacyBoolean = !mode || mode === "legacy_boolean";
    if (!isLegacyBoolean) {
      summary.skippedNonBoolean += 1;
      continue;
    }
    const cutter = solidFromSnapshot(cutout?.cutterSnapshot, `${cutoutId}:CUTTER`);
    if (!cutter) {
      summary.skipped += 1;
      summary.skippedCutouts.push({ id: cutoutId, reason: "missing_cutter_snapshot" });
      continue;
    }

    try {
      result = result.subtract(cutter);
      summary.applied += 1;
      summary.appliedCutouts.push({ id: cutoutId });
    } catch (error) {
      summary.skipped += 1;
      summary.skippedCutouts.push({
        id: cutoutId,
        reason: "boolean_subtract_failed",
        message: String(error?.message || error || "Unknown boolean failure"),
      });
    }
  }

  return { solid: result, summary };
}

function signedArea2D(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return area * 0.5;
}

function isSamePoint3(a, b, eps = POINT_EPS) {
  if (!a || !b) return false;
  return a.distanceToSquared(b) <= eps * eps;
}

function dedupeConsecutivePoints3(points) {
  if (!Array.isArray(points) || !points.length) return [];
  const out = [points[0].clone()];
  for (let i = 1; i < points.length; i += 1) {
    if (!isSamePoint3(points[i], out[out.length - 1])) out.push(points[i].clone());
  }
  return out;
}

function dedupeConsecutivePoints2(points) {
  if (!Array.isArray(points) || !points.length) return [];
  const out = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > POINT_EPS) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

function polylineLength2D(polyline) {
  let len = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    len += Math.hypot(polyline[i][0] - polyline[i - 1][0], polyline[i][1] - polyline[i - 1][1]);
  }
  return len;
}

function normalizeLoop2(loop, tolerance = EPS) {
  const tol = Math.max(EPS, Math.abs(toFiniteNumber(tolerance, EPS)));
  if (!Array.isArray(loop) || loop.length < 3) return [];
  const out = [];
  for (const point of loop) {
    const x = toFiniteNumber(point?.[0], Number.NaN);
    const y = toFiniteNumber(point?.[1], Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!out.length) {
      out.push([x, y]);
      continue;
    }
    const prev = out[out.length - 1];
    if (Math.hypot(prev[0] - x, prev[1] - y) <= tol) continue;
    out.push([x, y]);
  }
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol) out.pop();
  }
  if (out.length < 3) return [];
  if (Math.abs(signedArea2D(out)) <= EPS * EPS) return [];
  return out;
}

function holeOutlineFromEntry(entry) {
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === "object" && Array.isArray(entry.outline)) return entry.outline;
  return null;
}

function collectFlatHoleLoops(flat) {
  const raw = Array.isArray(flat?.holes) ? flat.holes : [];
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    const loop = normalizeLoop2(holeOutlineFromEntry(entry));
    if (loop.length < 3) continue;
    out.push({
      raw: entry,
      loop,
      id: String(entry?.id || `${flat?.id || "flat"}:hole_${i + 1}`),
      cutoutId: entry?.cutoutId != null ? String(entry.cutoutId) : null,
    });
  }
  return out;
}

function iterateTreeFlats(rootFlat, callback) {
  const visited = new Set();
  const walk = (flat) => {
    if (!flat || typeof flat !== "object") return;
    const key = String(flat.id || "");
    if (visited.has(key)) return;
    visited.add(key);
    callback(flat);
    const edges = Array.isArray(flat.edges) ? flat.edges : [];
    for (const edge of edges) {
      const children = Array.isArray(edge?.bend?.children) ? edge.bend.children : [];
      for (const child of children) walk(child?.flat);
    }
  };
  walk(rootFlat);
}

function removeCutoutHolesFromTree(tree, cutoutId) {
  if (!tree?.root || !cutoutId) return 0;
  const targetId = String(cutoutId);
  let removed = 0;
  iterateTreeFlats(tree.root, (flat) => {
    const holes = Array.isArray(flat?.holes) ? flat.holes : null;
    if (!holes?.length) return;
    const kept = [];
    for (const hole of holes) {
      const holeCutoutId = hole?.cutoutId != null ? String(hole.cutoutId) : null;
      if (holeCutoutId && holeCutoutId === targetId) {
        removed += 1;
        continue;
      }
      kept.push(hole);
    }
    if (kept.length) flat.holes = kept;
    else delete flat.holes;
  });
  return removed;
}

function segmentDistanceToPoint2(point, a, b) {
  const px = toFiniteNumber(point?.[0]);
  const py = toFiniteNumber(point?.[1]);
  const ax = toFiniteNumber(a?.[0]);
  const ay = toFiniteNumber(a?.[1]);
  const bx = toFiniteNumber(b?.[0]);
  const by = toFiniteNumber(b?.[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = (dx * dx) + (dy * dy);
  if (!(lenSq > EPS)) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

function pointInPolygon2(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const x = toFiniteNumber(point?.[0], Number.NaN);
  const y = toFiniteNumber(point?.[1], Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = toFiniteNumber(polygon[i]?.[0]);
    const yi = toFiniteNumber(polygon[i]?.[1]);
    const xj = toFiniteNumber(polygon[j]?.[0]);
    const yj = toFiniteNumber(polygon[j]?.[1]);
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || EPS) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointNearPolygonBoundary2(point, polygon, tol = POINT_EPS * 4) {
  if (!Array.isArray(polygon) || polygon.length < 2) return false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (segmentDistanceToPoint2(point, a, b) <= tol) return true;
  }
  return false;
}

function polygonMostlyInsidePolygon(innerLoop, outerLoop, tol = POINT_EPS * 6) {
  if (!Array.isArray(innerLoop) || innerLoop.length < 3) return false;
  if (!Array.isArray(outerLoop) || outerLoop.length < 3) return false;
  for (const point of innerLoop) {
    if (pointInPolygon2(point, outerLoop)) continue;
    if (pointNearPolygonBoundary2(point, outerLoop, tol)) continue;
    return false;
  }
  return true;
}

function normalizeFilledLoop2(loop) {
  const normalized = normalizeLoop2(loop);
  if (normalized.length < 3) return [];
  if (signedArea2D(normalized) < 0) return normalized.slice().reverse();
  return normalized;
}

function unionFilledLoops2(loops) {
  const normalizedLoops = [];
  for (const loop of Array.isArray(loops) ? loops : []) {
    const normalized = normalizeFilledLoop2(loop);
    if (normalized.length < 3) continue;
    normalizedLoops.push(normalized);
  }
  if (!normalizedLoops.length) return [];
  if (normalizedLoops.length === 1) return normalizedLoops;

  const contours = normalizedLoops.map((loop) => {
    const contour = [];
    for (const point of loop) {
      contour.push(toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1]));
    }
    return contour;
  });

  try {
    const tess = Tess2?.tesselate?.({
      contours,
      windingRule: Tess2.WINDING_POSITIVE,
      elementType: Tess2.BOUNDARY_CONTOURS,
      polySize: 3,
      vertexSize: 2,
      normal: [0, 0, 1],
    });
    const vertices = Array.isArray(tess?.vertices) ? tess.vertices : [];
    const elements = Array.isArray(tess?.elements) ? tess.elements : [];
    if (!vertices.length || !elements.length) return normalizedLoops;

    const out = [];
    for (let i = 0; i + 1 < elements.length; i += 2) {
      const start = Math.max(0, (toFiniteNumber(elements[i], -1) | 0));
      const count = Math.max(0, (toFiniteNumber(elements[i + 1], 0) | 0));
      if (count < 3) continue;
      const loop = [];
      for (let j = 0; j < count; j += 1) {
        const idx = (start + j) * 2;
        if (idx + 1 >= vertices.length) break;
        loop.push([
          toFiniteNumber(vertices[idx], Number.NaN),
          toFiniteNumber(vertices[idx + 1], Number.NaN),
        ]);
      }
      const normalized = normalizeLoop2(loop);
      if (normalized.length >= 3) out.push(normalized);
    }

    return out.length ? out : normalizedLoops;
  } catch {
    return normalizedLoops;
  }
}

function computeLoopNormal3(points3) {
  if (!Array.isArray(points3) || points3.length < 3) return null;
  const normal = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < points3.length; i += 1) {
    const a = points3[i];
    const b = points3[(i + 1) % points3.length];
    const ax = toFiniteNumber(a?.x, toFiniteNumber(a?.[0], Number.NaN));
    const ay = toFiniteNumber(a?.y, toFiniteNumber(a?.[1], Number.NaN));
    const az = toFiniteNumber(a?.z, toFiniteNumber(a?.[2], Number.NaN));
    const bx = toFiniteNumber(b?.x, toFiniteNumber(b?.[0], Number.NaN));
    const by = toFiniteNumber(b?.y, toFiniteNumber(b?.[1], Number.NaN));
    const bz = toFiniteNumber(b?.z, toFiniteNumber(b?.[2], Number.NaN));
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) continue;
    if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) continue;
    normal.x += (ay - by) * (az + bz);
    normal.y += (az - bz) * (ax + bx);
    normal.z += (ax - bx) * (ay + by);
  }
  if (!(normal.lengthSq() > EPS * EPS)) return null;
  return normal.normalize();
}

function projectLoopToFlatMidplane(localLoop3, localProjectionDir, planeZ = 0, directionTol = 1e-6) {
  if (!Array.isArray(localLoop3) || localLoop3.length < 3) return null;
  if (!localProjectionDir?.isVector3) return null;
  const dz = toFiniteNumber(localProjectionDir.z, 0);
  if (Math.abs(dz) <= directionTol) return null;

  const projected = [];
  let sumAbsT = 0;
  for (const point of localLoop3) {
    if (!point?.isVector3) continue;
    const t = (planeZ - point.z) / dz;
    if (!Number.isFinite(t)) return null;
    projected.push([
      point.x + localProjectionDir.x * t,
      point.y + localProjectionDir.y * t,
    ]);
    sumAbsT += Math.abs(t);
  }

  const loop2 = normalizeLoop2(projected);
  if (loop2.length < 3) return null;
  return {
    loop2,
    avgAbsParam: projected.length ? (sumAbsT / projected.length) : Number.POSITIVE_INFINITY,
  };
}

function quantizeCoord(value, quantum = COORD_QUANT) {
  if (!Number.isFinite(value)) return 0;
  if (!(quantum > 0)) return value;
  const snapped = Math.round(value / quantum) * quantum;
  return Math.abs(snapped) <= quantum ? 0 : snapped;
}

function quantizePoint3(point, quantum = COORD_QUANT) {
  return [
    quantizeCoord(toFiniteNumber(point?.x), quantum),
    quantizeCoord(toFiniteNumber(point?.y), quantum),
    quantizeCoord(toFiniteNumber(point?.z), quantum),
  ];
}

function triangleAreaSq3(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return nx * nx + ny * ny + nz * nz;
}

function addTriangleIfValid(solid, faceName, a, b, c) {
  if (!solid || !faceName) return false;
  if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) return false;
  if (triangleAreaSq3(a, b, c) <= TRIANGLE_AREA_EPS) return false;
  solid.addTriangle(faceName, a, b, c);
  return true;
}

function makeMidplaneWorldPoint(matrix, point2) {
  return new THREE.Vector3(point2[0], point2[1], 0).applyMatrix4(matrix);
}

function buildQuantizedPolylineSignature(polyline, precision = 5) {
  if (!Array.isArray(polyline) || polyline.length < 2) return null;
  const fmt = (v) => Number(v).toFixed(precision);
  const encode = (points) => points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(";");
  const forward = encode(polyline);
  const reverse = encode(polyline.slice().reverse());
  return forward < reverse ? forward : reverse;
}

function buildFlatEdgeIndex(flat) {
  const index = new Map();
  const edges = Array.isArray(flat?.edges) ? flat.edges : [];
  for (const edge of edges) {
    if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) continue;
    const key = buildQuantizedPolylineSignature(edge.polyline);
    if (!key || index.has(key)) continue;
    index.set(key, edge);
  }
  return index;
}

function colorFromString(seed, saturation = 0.62, lightness = 0.52) {
  const text = String(seed || "sheet");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  const color = new THREE.Color();
  color.setHSL(hue / 360, saturation, lightness);
  return color.getHex();
}

function normalizeSelectionArray(value) {
  if (!Array.isArray(value)) return value ? [value] : [];
  return value.filter(Boolean);
}

function resolveProfileFace(selectionValue) {
  const selected = Array.isArray(selectionValue) ? selectionValue[0] : selectionValue;
  if (!selected || typeof selected !== "object") return null;
  if (selected.type === "FACE") return selected;
  if (selected.type === "SKETCH") {
    const kids = Array.isArray(selected.children) ? selected.children : [];
    return kids.find((child) => child && child.type === "FACE") || null;
  }
  if (selected.parent && selected.parent.type === "SKETCH") {
    const kids = Array.isArray(selected.parent.children) ? selected.parent.children : [];
    return kids.find((child) => child && child.type === "FACE") || null;
  }
  return null;
}

function buildCutoutCutterFromProfile(profileSelections, featureID, options = {}) {
  const selections = normalizeSelectionArray(profileSelections);
  const first = selections[0] || null;
  if (!first || typeof first !== "object") {
    return { cutter: null, profileFace: null, sourceType: null, reason: "no_profile_selection" };
  }

  const firstType = String(first.type || "").toUpperCase();
  if (firstType === "SOLID") {
    const profileSolid = resolveCarrierFromObject(first) || (isSolidLikeObject(first) ? first : null);
    if (!profileSolid) {
      return { cutter: null, profileFace: null, sourceType: "solid", reason: "profile_solid_not_found" };
    }
    const cutter = cloneSolidWorldBaked(profileSolid, `${featureID}:CUTTER`);
    if (!cutter) {
      return { cutter: null, profileFace: null, sourceType: "solid", reason: "failed_to_clone_profile_solid" };
    }
    return { cutter, profileFace: null, sourceType: "solid", profileSolid };
  }

  const profileFace = resolveProfileFace(first);
  if (!profileFace) {
    return { cutter: null, profileFace: null, sourceType: "face", reason: "profile_face_not_found" };
  }

  const forwardDistance = Math.max(0, toFiniteNumber(options.forwardDistance, 1));
  const backDistance = Math.max(0, toFiniteNumber(options.backDistance, 0));
  if (!(forwardDistance > EPS) && !(backDistance > EPS)) {
    return { cutter: null, profileFace, sourceType: "face", reason: "zero_cut_depth" };
  }

  const forwardBias = forwardDistance > EPS ? 1e-5 : 0;
  const backBias = backDistance > EPS ? 1e-5 : 0;
  const cutter = new BREP.Sweep({
    face: profileFace,
    distance: forwardDistance + forwardBias,
    distanceBack: backDistance + backBias,
    mode: "translate",
    name: `${featureID}:CUTTER`,
    omitBaseCap: false,
  });

  return {
    cutter,
    profileFace,
    sourceType: "face",
    forwardDistance,
    backDistance,
  };
}

function collectSketchParents(objects) {
  const out = [];
  const seen = new Set();
  for (const obj of normalizeSelectionArray(objects)) {
    let current = obj;
    while (current) {
      if (current.type === "SKETCH") {
        const key = current.uuid || current.id || current.name;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(current);
        }
        break;
      }
      current = current.parent || null;
    }
  }
  return out;
}

function readEdgePolyline3D(edgeObj) {
  if (!edgeObj || typeof edgeObj !== "object") return null;

  if (typeof edgeObj.points === "function") {
    try {
      const points = edgeObj.points(true);
      if (Array.isArray(points) && points.length >= 2) {
        const vecs = points
          .map((point) => new THREE.Vector3(toFiniteNumber(point?.x), toFiniteNumber(point?.y), toFiniteNumber(point?.z)))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
        if (vecs.length >= 2) return dedupeConsecutivePoints3(vecs);
      }
    } catch {
      // ignore and try geometry fallback
    }
  }

  try {
    const pos = edgeObj.geometry?.getAttribute?.("position");
    if (pos && pos.itemSize === 3 && pos.count >= 2) {
      const out = [];
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 1) {
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        tmp.applyMatrix4(edgeObj.matrixWorld);
        out.push(tmp.clone());
      }
      const deduped = dedupeConsecutivePoints3(out);
      if (deduped.length >= 2) return deduped;
    }
  } catch {
    // ignore
  }

  return null;
}

function monotonicHull(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const sorted = points
    .map((point) => ({ x: point[0], y: point[1] }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper).map((point) => [point.x, point.y]);
}

function buildProfileFrame(points3D, normalHint = null) {
  if (!Array.isArray(points3D) || points3D.length < 3) return null;
  const origin = points3D[0].clone();

  let xAxis = null;
  for (let i = 1; i < points3D.length; i += 1) {
    const candidate = points3D[i].clone().sub(origin);
    if (candidate.lengthSq() > EPS) {
      xAxis = candidate.normalize();
      break;
    }
  }
  if (!xAxis) return null;

  let normal = null;
  if (normalHint && normalHint.isVector3 && normalHint.lengthSq() > EPS) {
    normal = normalHint.clone().normalize();
  } else {
    for (let i = 1; i < points3D.length - 1; i += 1) {
      const a = points3D[i].clone().sub(origin);
      const b = points3D[i + 1].clone().sub(origin);
      const cross = new THREE.Vector3().crossVectors(a, b);
      if (cross.lengthSq() > EPS) {
        normal = cross.normalize();
        break;
      }
    }
  }
  if (!normal) normal = new THREE.Vector3(0, 0, 1);

  if (Math.abs(normal.dot(xAxis)) > 0.999) {
    const fallback = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    xAxis = new THREE.Vector3().crossVectors(fallback, normal).normalize();
  }

  let yAxis = new THREE.Vector3().crossVectors(normal, xAxis);
  if (yAxis.lengthSq() <= EPS) {
    yAxis = Math.abs(normal.z) < 0.9
      ? new THREE.Vector3(0, 0, 1).cross(normal)
      : new THREE.Vector3(0, 1, 0).cross(normal);
  }
  yAxis.normalize();
  xAxis = new THREE.Vector3().crossVectors(yAxis, normal).normalize();

  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  matrix.setPosition(origin);

  return { origin, xAxis, yAxis, normal, matrix };
}

function projectPointToFrame(point, frame) {
  const delta = point.clone().sub(frame.origin);
  return [delta.dot(frame.xAxis), delta.dot(frame.yAxis)];
}

function readFaceEdgePolylines(faceObj) {
  const entries = [];
  const edges = Array.isArray(faceObj?.edges) ? faceObj.edges : [];

  for (const edge of edges) {
    const polyline = readEdgePolyline3D(edge);
    if (!polyline || polyline.length < 2) continue;
    entries.push({
      id: edge?.name || edge?.userData?.edgeName || `edge_${entries.length + 1}`,
      edge,
      polyline,
    });
  }

  if (entries.length) return entries;

  const fallbackPoints = [];
  const pos = faceObj?.geometry?.getAttribute?.("position");
  if (pos && pos.itemSize === 3 && pos.count >= 3) {
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(faceObj.matrixWorld);
      fallbackPoints.push(tmp.clone());
    }
  }

  if (fallbackPoints.length < 3) return entries;

  const frame = buildProfileFrame(fallbackPoints, faceObj?.getAverageNormal?.());
  if (!frame) return entries;

  const points2 = dedupeConsecutivePoints2(fallbackPoints.map((point) => projectPointToFrame(point, frame)));
  const hull = monotonicHull(points2);
  if (hull.length < 3) return entries;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const p3A = frame.origin
      .clone()
      .addScaledVector(frame.xAxis, a[0])
      .addScaledVector(frame.yAxis, a[1]);
    const p3B = frame.origin
      .clone()
      .addScaledVector(frame.xAxis, b[0])
      .addScaledVector(frame.yAxis, b[1]);
    entries.push({
      id: `edge_${i + 1}`,
      edge: null,
      polyline: [p3A, p3B],
    });
  }

  return entries;
}

function findBestMatchAtPoint(entries, anchorPoint) {
  let best = null;
  for (let i = 0; i < entries.length; i += 1) {
    const candidate = entries[i];
    const start = candidate.polyline[0];
    const end = candidate.polyline[candidate.polyline.length - 1];
    const startDist = start.distanceToSquared(anchorPoint);
    const endDist = end.distanceToSquared(anchorPoint);
    const thresholdSq = POINT_EPS * POINT_EPS;

    if (startDist <= thresholdSq) {
      if (!best || startDist < best.distance) {
        best = { index: i, attachAt: "start", distance: startDist };
      }
    }
    if (endDist <= thresholdSq) {
      if (!best || endDist < best.distance) {
        best = { index: i, attachAt: "end", distance: endDist };
      }
    }
  }
  return best;
}

function orderConnectedEntries(entries) {
  if (!Array.isArray(entries) || entries.length <= 1) return entries || [];

  const remaining = entries.map((entry) => ({
    ...entry,
    polyline: entry.polyline.map((point) => point.clone()),
  }));

  const ordered = [remaining.shift()];
  while (remaining.length) {
    let advanced = false;

    const tail = ordered[ordered.length - 1].polyline[ordered[ordered.length - 1].polyline.length - 1];
    const tailMatch = findBestMatchAtPoint(remaining, tail);
    if (tailMatch) {
      const [picked] = remaining.splice(tailMatch.index, 1);
      if (tailMatch.attachAt === "end") picked.polyline.reverse();
      ordered.push(picked);
      advanced = true;
    }

    if (remaining.length) {
      const head = ordered[0].polyline[0];
      const headMatch = findBestMatchAtPoint(remaining, head);
      if (headMatch) {
        const [picked] = remaining.splice(headMatch.index, 1);
        if (headMatch.attachAt === "start") picked.polyline.reverse();
        ordered.unshift(picked);
        advanced = true;
      }
    }

    if (!advanced) break;
  }

  return ordered;
}

function orderConnectedEntryGroups(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const remaining = entries.map((entry) => ({
    ...entry,
    polyline: Array.isArray(entry?.polyline) ? entry.polyline.map((point) => point.clone()) : [],
  }));
  const groups = [];

  while (remaining.length) {
    const ordered = [remaining.shift()];
    while (remaining.length) {
      let advanced = false;

      const tail = ordered[ordered.length - 1]?.polyline?.[ordered[ordered.length - 1]?.polyline?.length - 1] || null;
      if (tail) {
        const tailMatch = findBestMatchAtPoint(remaining, tail);
        if (tailMatch) {
          const [picked] = remaining.splice(tailMatch.index, 1);
          if (tailMatch.attachAt === "end") picked.polyline.reverse();
          ordered.push(picked);
          advanced = true;
        }
      }

      if (remaining.length) {
        const head = ordered[0]?.polyline?.[0] || null;
        if (head) {
          const headMatch = findBestMatchAtPoint(remaining, head);
          if (headMatch) {
            const [picked] = remaining.splice(headMatch.index, 1);
            if (headMatch.attachAt === "start") picked.polyline.reverse();
            ordered.unshift(picked);
            advanced = true;
          }
        }
      }

      if (!advanced) break;
    }
    groups.push(ordered);
  }

  return groups;
}

function buildOutlineFromOrderedEntries(orderedEntries) {
  const points = [];
  for (let i = 0; i < orderedEntries.length; i += 1) {
    const polyline = orderedEntries[i].polyline;
    if (!Array.isArray(polyline) || polyline.length < 2) continue;
    if (i === 0) {
      for (const point of polyline) points.push(point.clone());
    } else {
      for (let j = 1; j < polyline.length; j += 1) points.push(polyline[j].clone());
    }
  }

  const deduped = dedupeConsecutivePoints3(points);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  return deduped;
}

function normalizeWorldLoopToFacePlane(loop3, normalHint = null) {
  if (!Array.isArray(loop3) || loop3.length < 3) return [];
  const frame = buildProfileFrame(loop3, normalHint);
  if (!frame) return [];
  const projected2 = normalizeLoop2(loop3.map((point) => projectPointToFrame(point, frame)));
  if (projected2.length < 3) return [];
  const out = projected2.map((point) => frame.origin
    .clone()
    .addScaledVector(frame.xAxis, toFiniteNumber(point?.[0], 0))
    .addScaledVector(frame.yAxis, toFiniteNumber(point?.[1], 0)));
  const deduped = dedupeConsecutivePoints3(out);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  return deduped.length >= 3 ? deduped : [];
}

function loopKey3(loop, precision = 5) {
  if (!Array.isArray(loop) || loop.length < 3) return null;
  const fmt = (value) => Number(toFiniteNumber(value, 0)).toFixed(precision);
  const encode = (points) => points.map((point) => (
    `${fmt(point?.x)}|${fmt(point?.y)}|${fmt(point?.z)}`
  )).join(";");
  const forward = encode(loop);
  const reverse = encode(loop.slice().reverse());
  return forward < reverse ? forward : reverse;
}

function buildFlatEdgesFromOutline(outline2, flatId) {
  const edges = [];
  for (let i = 0; i < outline2.length; i += 1) {
    const a = outline2[i];
    const b = outline2[(i + 1) % outline2.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) continue;
    edges.push({
      id: `${flatId}:e${edges.length + 1}`,
      polyline: [[a[0], a[1]], [b[0], b[1]]],
    });
  }
  return edges;
}

function buildFlatFromFace(faceObj, featureID, label = "Tab") {
  const loops3 = faceOutlineLoops3FromFace(faceObj, featureID);
  if (!loops3.length) return null;

  const normalHint = (typeof faceObj?.getAverageNormal === "function")
    ? faceObj.getAverageNormal()
    : null;
  const frame = buildProfileFrame(loops3[0], normalHint);
  if (!frame) return null;

  const projectedLoops = [];
  for (const loop3 of loops3) {
    const projected = normalizeLoop2(loop3.map((point) => projectPointToFrame(point, frame)));
    if (projected.length < 3) continue;
    projectedLoops.push(projected);
  }
  if (!projectedLoops.length) return null;

  let outerIndex = -1;
  let maxOuterAreaAbs = 0;
  for (let i = 0; i < projectedLoops.length; i += 1) {
    const areaAbs = Math.abs(signedArea2D(projectedLoops[i]));
    if (areaAbs > maxOuterAreaAbs) {
      maxOuterAreaAbs = areaAbs;
      outerIndex = i;
    }
  }
  if (outerIndex < 0) return null;

  let outline2 = projectedLoops[outerIndex];
  if (signedArea2D(outline2) < 0) outline2 = outline2.slice().reverse();

  const flatId = `${featureID}:flat_root`;
  const edges = buildFlatEdgesFromOutline(outline2, flatId);
  if (edges.length < 3) return null;

  const flat = {
    kind: "flat",
    id: flatId,
    label,
    color: colorFromString(flatId),
    outline: outline2,
    edges,
  };

  const holes = [];
  for (let i = 0; i < projectedLoops.length; i += 1) {
    if (i === outerIndex) continue;
    let holeLoop = projectedLoops[i];
    if (holeLoop.length < 3) continue;
    if (!polygonMostlyInsidePolygon(holeLoop, outline2, POINT_EPS * 8)) continue;
    if (signedArea2D(holeLoop) > 0) holeLoop = holeLoop.slice().reverse();
    holes.push({
      id: `${flatId}:hole_${holes.length + 1}`,
      outline: holeLoop.map((point) => [point[0], point[1]]),
    });
  }
  if (holes.length) flat.holes = holes;

  return { flat, frame };
}

function faceOutlineLoops3FromFace(faceObj, featureID) {
  const normalHint = (typeof faceObj?.getAverageNormal === "function")
    ? faceObj.getAverageNormal()
    : null;

  const loops = [];
  const seen = new Set();
  const pushLoop = (loop3) => {
    const normalized = normalizeWorldLoopToFacePlane(loop3, normalHint);
    if (normalized.length < 3) return;
    const key = loopKey3(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    loops.push(normalized);
  };

  const boundaryLoopsRaw = Array.isArray(faceObj?.userData?.boundaryLoopsWorld)
    ? faceObj.userData.boundaryLoopsWorld
    : [];
  for (const entry of boundaryLoopsRaw) {
    const ptsRaw = Array.isArray(entry?.pts) ? entry.pts : (Array.isArray(entry) ? entry : null);
    if (!Array.isArray(ptsRaw) || ptsRaw.length < 3) continue;
    const world = [];
    for (const point of ptsRaw) {
      if (point?.isVector3) world.push(point.clone());
      else if (Array.isArray(point) && point.length >= 3) {
        world.push(new THREE.Vector3(
          toFiniteNumber(point[0]),
          toFiniteNumber(point[1]),
          toFiniteNumber(point[2]),
        ));
      }
    }
    const deduped = dedupeConsecutivePoints3(world);
    if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) deduped.pop();
    pushLoop(deduped);
  }
  if (loops.length) return loops;

  const edgeEntries = readFaceEdgePolylines(faceObj);
  if (!edgeEntries.length) return loops;
  const groups = orderConnectedEntryGroups(edgeEntries);
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length) continue;
    const start = group[0]?.polyline?.[0] || null;
    const lastPolyline = group[group.length - 1]?.polyline || [];
    const end = lastPolyline[lastPolyline.length - 1] || null;
    if (!start || !end || !isSamePoint3(start, end, POINT_EPS * 8)) continue;
    const outline3 = buildOutlineFromOrderedEntries(group);
    pushLoop(outline3);
  }

  return loops;
}

function faceOutlineLoop3FromFace(faceObj, featureID) {
  const loops = faceOutlineLoops3FromFace(faceObj, featureID);
  return loops[0] || null;
}

function collectCutoutProfileLoops(profileSelections, featureID) {
  const selections = normalizeSelectionArray(profileSelections);
  const firstType = String(selections[0]?.type || "").toUpperCase();
  const sourceType = firstType === "SOLID" ? "solid" : "face";
  const faces = [];
  const seenFaceKeys = new Set();
  const pushFace = (faceObj) => {
    if (!faceObj || typeof faceObj !== "object") return;
    const key = faceObj.uuid || faceObj.id || faceObj.name || faceObj;
    if (seenFaceKeys.has(key)) return;
    seenFaceKeys.add(key);
    faces.push(faceObj);
  };

  for (const selection of selections) {
    if (!selection || typeof selection !== "object") continue;
    const type = String(selection.type || "").toUpperCase();
    if (type === "FACE") {
      pushFace(selection);
      continue;
    }
    if (type === "SKETCH") {
      const kids = Array.isArray(selection.children) ? selection.children : [];
      for (const child of kids) {
        if (String(child?.type || "").toUpperCase() === "FACE") pushFace(child);
      }
      continue;
    }
    if (selection?.parent && String(selection.parent.type || "").toUpperCase() === "SKETCH") {
      const kids = Array.isArray(selection.parent.children) ? selection.parent.children : [];
      for (const child of kids) {
        if (String(child?.type || "").toUpperCase() === "FACE") pushFace(child);
      }
    }
  }

  if (!faces.length) {
    const fallbackFace = resolveProfileFace(selections[0] || null);
    if (fallbackFace) pushFace(fallbackFace);
  }

  const loops = [];
  const seenLoops = new Set();
  for (const face of faces) {
    const faceLoops = faceOutlineLoops3FromFace(face, featureID);
    for (const loop of faceLoops) {
      if (!Array.isArray(loop) || loop.length < 3) continue;
      const key = loopKey3(loop);
      if (!key || seenLoops.has(key)) continue;
      seenLoops.add(key);
      loops.push(loop);
    }
  }

  return {
    sourceType,
    faceCount: faces.length,
    loops,
  };
}

function applyCutoutLoopsToTree({ tree, featureID, profileLoops3 = [], rootMatrix = null }) {
  const summary = {
    requestedLoops: Array.isArray(profileLoops3) ? profileLoops3.length : 0,
    applied: 0,
    skipped: 0,
    assignments: [],
    skippedLoops: [],
  };
  if (!tree?.root || !summary.requestedLoops) return summary;

  let model = null;
  try {
    model = evaluateSheetMetal(tree);
  } catch (error) {
    summary.skipped = summary.requestedLoops;
    summary.skippedLoops.push({
      reason: "evaluate_failed",
      message: String(error?.message || error || "failed to evaluate tree"),
    });
    return summary;
  }

  const root = matrixFromAny(rootMatrix || new THREE.Matrix4().identity());
  const flatPlacements = [];
  for (const placement of model?.flats3D || []) {
    if (!placement?.flat || !placement?.matrix?.isMatrix4) continue;
    const worldMatrix = root.clone().multiply(placement.matrix.clone());
    const inverseWorld = worldMatrix.clone().invert();
    flatPlacements.push({ placement, inverseWorld });
  }
  if (!flatPlacements.length) {
    summary.skipped = summary.requestedLoops;
    summary.skippedLoops.push({ reason: "no_flat_placements" });
    return summary;
  }

  removeCutoutHolesFromTree(tree, featureID);
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(tree?.thickness, 1)));
  const halfT = thickness * 0.5;
  const planeTol = Math.max(POINT_EPS * 8, Math.max(1e-3, thickness * 0.1));
  const insideTol = Math.max(POINT_EPS * 8, thickness * 0.02);
  const projectionDirTol = Math.max(1e-6, planeTol * 0.05);

  for (let loopIndex = 0; loopIndex < profileLoops3.length; loopIndex += 1) {
    const worldLoopRaw = profileLoops3[loopIndex];
    if (!Array.isArray(worldLoopRaw) || worldLoopRaw.length < 3) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "invalid_loop" });
      continue;
    }
    const worldLoop = dedupeConsecutivePoints3(worldLoopRaw.map((point) => (
      point?.isVector3
        ? point.clone()
        : new THREE.Vector3(toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1]), toFiniteNumber(point?.[2]))
    )));
    if (worldLoop.length >= 2 && isSamePoint3(worldLoop[0], worldLoop[worldLoop.length - 1])) worldLoop.pop();
    if (worldLoop.length < 3) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "degenerate_loop" });
      continue;
    }
    const loopNormalWorld = computeLoopNormal3(worldLoop);

    let best = null;
    for (const candidate of flatPlacements) {
      const flat = candidate.placement.flat;
      const outer = normalizeLoop2(flat?.outline);
      if (outer.length < 3) continue;

      const local3 = worldLoop.map((point) => point.clone().applyMatrix4(candidate.inverseWorld));
      let minZ = Number.POSITIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      let sumAbsZ = 0;
      for (const point of local3) {
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
        sumAbsZ += Math.abs(point.z);
      }
      const zSpread = maxZ - minZ;
      const avgAbsZ = sumAbsZ / local3.length;

      let localLoop2 = null;
      let holeLoops2 = null;
      let projectionMode = "coplanar";
      let projectionParam = 0;
      if (zSpread <= planeTol) {
        localLoop2 = normalizeLoop2(local3.map((point) => [point.x, point.y]));
        if (localLoop2.length >= 3) holeLoops2 = [localLoop2];
      } else {
        const projectedLoopNormal = loopNormalWorld
          ? loopNormalWorld.clone().transformDirection(candidate.inverseWorld).normalize()
          : computeLoopNormal3(local3);
        const topProjected = projectLoopToFlatMidplane(local3, projectedLoopNormal, halfT, projectionDirTol);
        const bottomProjected = projectLoopToFlatMidplane(local3, projectedLoopNormal, -halfT, projectionDirTol);
        if (!topProjected?.loop2?.length || !bottomProjected?.loop2?.length) continue;

        const projectedMidLoops = unionFilledLoops2([
          topProjected.loop2,
          bottomProjected.loop2,
        ]);
        if (!projectedMidLoops.length) continue;
        holeLoops2 = projectedMidLoops;
        localLoop2 = projectedMidLoops[0] || null;
        projectionMode = "projected_top_bottom";
        projectionParam = (
          toFiniteNumber(topProjected.avgAbsParam, 0)
          + toFiniteNumber(bottomProjected.avgAbsParam, 0)
        ) * 0.5;
      }
      if (!localLoop2 || localLoop2.length < 3 || !Array.isArray(holeLoops2) || !holeLoops2.length) continue;
      let allInside = true;
      for (const holeLoop of holeLoops2) {
        if (!polygonMostlyInsidePolygon(holeLoop, outer, insideTol)) {
          allInside = false;
          break;
        }
      }
      if (!allInside) continue;

      const score = (projectionMode === "coplanar")
        ? (avgAbsZ + (zSpread * 10))
        : (projectionParam * 0.1 + avgAbsZ + (zSpread * 2) + (holeLoops2.length * 0.005));
      if (!best || score < best.score) {
        best = {
          flat,
          localLoop2,
          holeLoops2,
          avgAbsZ,
          zSpread,
          projectionMode,
          projectionParam,
          score,
        };
      }
    }

    if (!best) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "no_flat_mapping" });
      continue;
    }

    const outerSign = signedArea2D(best.flat.outline);
    const loopHoleIds = [];
    const holeLoops = Array.isArray(best.holeLoops2) && best.holeLoops2.length
      ? best.holeLoops2
      : [best.localLoop2];
    if (!Array.isArray(best.flat.holes)) best.flat.holes = [];
    for (let i = 0; i < holeLoops.length; i += 1) {
      let holeLoop = normalizeLoop2(holeLoops[i]);
      if (holeLoop.length < 3) continue;
      if (outerSign * signedArea2D(holeLoop) > 0) {
        holeLoop = holeLoop.slice().reverse();
      }
      const holeId = holeLoops.length === 1
        ? `${featureID}:hole_${loopIndex + 1}`
        : `${featureID}:hole_${loopIndex + 1}_${i + 1}`;
      best.flat.holes.push({
        id: holeId,
        cutoutId: featureID,
        outline: holeLoop.map((point) => [point[0], point[1]]),
      });
      loopHoleIds.push(holeId);
    }
    if (!loopHoleIds.length) {
      summary.skipped += 1;
      summary.skippedLoops.push({ loopIndex, reason: "empty_projected_hole" });
      continue;
    }

    summary.applied += 1;
    summary.assignments.push({
      loopIndex,
      flatId: best.flat.id,
      holeIds: loopHoleIds,
      avgAbsZ: best.avgAbsZ,
      zSpread: best.zSpread,
      projectionMode: best.projectionMode,
      projectionParam: best.projectionParam,
      holeCount: loopHoleIds.length,
      pointCount: Array.isArray(best.localLoop2) ? best.localLoop2.length : 0,
    });
  }

  return summary;
}

function buildPathPolylineFromSelections(pathSelections) {
  const collected = [];

  for (const selection of normalizeSelectionArray(pathSelections)) {
    if (!selection || typeof selection !== "object") continue;

    if (selection.type === "EDGE") {
      const points = readEdgePolyline3D(selection);
      if (points && points.length >= 2) {
        collected.push({ id: selection.name || `edge_${collected.length + 1}`, polyline: points });
      }
      continue;
    }

    if (selection.type === "SKETCH") {
      const kids = Array.isArray(selection.children) ? selection.children : [];
      for (const child of kids) {
        if (!child || child.type !== "EDGE") continue;
        const points = readEdgePolyline3D(child);
        if (points && points.length >= 2) {
          collected.push({ id: child.name || `edge_${collected.length + 1}`, polyline: points });
        }
      }
      continue;
    }

    if (selection.type === "FACE") {
      const entries = readFaceEdgePolylines(selection);
      for (const entry of entries) {
        collected.push({ id: entry.id || `edge_${collected.length + 1}`, polyline: entry.polyline.map((p) => p.clone()) });
      }
    }
  }

  if (!collected.length) return null;

  const ordered = orderConnectedEntries(collected);
  if (!ordered.length || ordered.length !== collected.length) return null;
  const points = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const polyline = ordered[i].polyline;
    if (!Array.isArray(polyline) || polyline.length < 2) continue;

    if (i > 0) {
      const prevLast = points[points.length - 1];
      const currentFirst = polyline[0];
      if (!prevLast || !isSamePoint3(prevLast, currentFirst)) {
        return null;
      }
    }

    if (i === 0) {
      for (const point of polyline) points.push(point.clone());
    } else {
      for (let j = 1; j < polyline.length; j += 1) points.push(polyline[j].clone());
    }
  }

  const deduped = dedupeConsecutivePoints3(points);
  if (deduped.length >= 2 && isSamePoint3(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }

  return deduped.length >= 2 ? deduped : null;
}

function choosePerpendicularNormal(xAxis) {
  const candidates = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ];

  for (const seed of candidates) {
    const projected = seed.clone().sub(xAxis.clone().multiplyScalar(seed.dot(xAxis)));
    if (projected.lengthSq() > EPS * EPS) return projected.normalize();
  }
  return null;
}

function buildContourPathFrame(path3, reverseSheetSide = false) {
  if (!Array.isArray(path3) || path3.length < 2) return null;
  const origin = path3[0].clone();

  let xAxis = null;
  for (let i = 1; i < path3.length; i += 1) {
    const delta = path3[i].clone().sub(origin);
    if (delta.lengthSq() > EPS * EPS) {
      xAxis = delta.normalize();
      break;
    }
  }
  if (!xAxis) return null;

  let planeNormal = null;
  for (let i = 0; i < path3.length - 2; i += 1) {
    const a = path3[i + 1].clone().sub(path3[i]);
    const b = path3[i + 2].clone().sub(path3[i + 1]);
    if (a.lengthSq() <= EPS * EPS || b.lengthSq() <= EPS * EPS) continue;
    const cross = new THREE.Vector3().crossVectors(a, b);
    if (cross.lengthSq() > EPS * EPS) {
      planeNormal = cross.normalize();
      break;
    }
  }
  if (!planeNormal) {
    planeNormal = choosePerpendicularNormal(xAxis);
  }
  if (!planeNormal) return null;

  const extensionDir = reverseSheetSide ? planeNormal.clone().multiplyScalar(-1) : planeNormal.clone();
  let zAxis = new THREE.Vector3().crossVectors(xAxis, extensionDir);
  if (zAxis.lengthSq() <= EPS * EPS) return null;
  zAxis.normalize();

  let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  if (yAxis.lengthSq() <= EPS * EPS) return null;
  yAxis.normalize();

  if (yAxis.dot(extensionDir) < 0) {
    yAxis.multiplyScalar(-1);
    zAxis.multiplyScalar(-1);
  }

  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  matrix.setPosition(origin);
  return { origin, xAxis, yAxis, zAxis, matrix };
}

function projectPointToContourAxes(point, frame) {
  const delta = point.clone().sub(frame.origin);
  return [delta.dot(frame.xAxis), delta.dot(frame.zAxis)];
}

function simplifyContourPath2(path2) {
  const deduped = dedupeConsecutivePoints2(path2 || []);
  if (deduped.length < 2) return deduped;

  const compact = [deduped[0]];
  for (let i = 1; i < deduped.length; i += 1) {
    const point = deduped[i];
    const prev = compact[compact.length - 1];
    if (pointDistance2(point, prev) > POINT_EPS) compact.push(point);
  }
  if (compact.length < 3) return compact;

  const merged = [compact[0]];
  for (let i = 1; i < compact.length - 1; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = compact[i];
    const next = compact[i + 1];

    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (!(l1 > POINT_EPS) || !(l2 > POINT_EPS)) continue;

    const cross = (v1x * v2y - v1y * v2x) / (l1 * l2);
    const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
    if (Math.abs(cross) <= 1e-6 && dot > 0.9999) continue;
    merged.push(curr);
  }
  merged.push(compact[compact.length - 1]);
  return merged;
}

function signedTurnRadians2(dirA, dirB) {
  const ax = toFiniteNumber(dirA?.[0]);
  const ay = toFiniteNumber(dirA?.[1]);
  const bx = toFiniteNumber(dirB?.[0]);
  const by = toFiniteNumber(dirB?.[1]);
  return Math.atan2((ax * by) - (ay * bx), (ax * bx) + (ay * by));
}

function buildContourSegments(path2) {
  const out = [];
  if (!Array.isArray(path2) || path2.length < 2) return out;

  for (let i = 0; i < path2.length - 1; i += 1) {
    const a = path2[i];
    const b = path2[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!(length > POINT_EPS)) continue;
    out.push({
      index: out.length,
      start: [a[0], a[1]],
      end: [b[0], b[1]],
      length,
      dir: [dx / length, dy / length],
    });
  }
  return out;
}

function intersectLines2(pointA, dirA, pointB, dirB) {
  const ax = toFiniteNumber(pointA?.[0]);
  const ay = toFiniteNumber(pointA?.[1]);
  const adx = toFiniteNumber(dirA?.[0]);
  const ady = toFiniteNumber(dirA?.[1]);
  const bx = toFiniteNumber(pointB?.[0]);
  const by = toFiniteNumber(pointB?.[1]);
  const bdx = toFiniteNumber(dirB?.[0]);
  const bdy = toFiniteNumber(dirB?.[1]);

  const det = (adx * bdy) - (ady * bdx);
  if (Math.abs(det) <= EPS) return null;

  const qpx = bx - ax;
  const qpy = by - ay;
  const t = ((qpx * bdy) - (qpy * bdx)) / det;
  return [ax + adx * t, ay + ady * t];
}

function offsetOpenContourPath2(path2, offsetDistance) {
  if (!Array.isArray(path2) || path2.length < 2) return null;
  const baseSegments = buildContourSegments(path2);
  if (baseSegments.length !== path2.length - 1) return null;

  const lines = [];
  for (const segment of baseSegments) {
    const nx = -segment.dir[1];
    const ny = segment.dir[0];
    const ox = nx * offsetDistance;
    const oy = ny * offsetDistance;
    lines.push({
      dir: [segment.dir[0], segment.dir[1]],
      start: [segment.start[0] + ox, segment.start[1] + oy],
      end: [segment.end[0] + ox, segment.end[1] + oy],
    });
  }
  if (!lines.length) return null;

  const out = new Array(path2.length);
  out[0] = [lines[0].start[0], lines[0].start[1]];
  out[path2.length - 1] = [lines[lines.length - 1].end[0], lines[lines.length - 1].end[1]];

  for (let i = 1; i < path2.length - 1; i += 1) {
    const prev = lines[i - 1];
    const next = lines[i];
    const hit = intersectLines2(prev.start, prev.dir, next.start, next.dir);
    if (Array.isArray(hit)) {
      out[i] = [hit[0], hit[1]];
      continue;
    }
    out[i] = [
      (toFiniteNumber(prev.end[0]) + toFiniteNumber(next.start[0])) * 0.5,
      (toFiniteNumber(prev.end[1]) + toFiniteNumber(next.start[1])) * 0.5,
    ];
  }

  return dedupeConsecutivePoints2(out);
}

function preferredContourOffsetSide(path2) {
  const segments = buildContourSegments(path2);
  if (segments.length < 2) return 1;
  let turnSum = 0;
  for (let i = 0; i < segments.length - 1; i += 1) {
    turnSum += signedTurnRadians2(segments[i].dir, segments[i + 1].dir);
  }
  if (Math.abs(turnSum) <= 1e-7) return 1;
  return turnSum > 0 ? 1 : -1;
}

function computeContourCornerTrimData(segments, midRadius) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const safeMidRadius = Math.max(MIN_LEG, Math.abs(toFiniteNumber(midRadius, MIN_LEG)));
  const startTrim = new Array(segments.length).fill(0);
  const endTrim = new Array(segments.length).fill(0);
  const joints = [];

  for (let i = 0; i < segments.length - 1; i += 1) {
    const turnRad = signedTurnRadians2(segments[i].dir, segments[i + 1].dir);
    const absTurn = Math.abs(turnRad);
    if (absTurn <= 1e-8) {
      joints.push({ index: i, turnRad: 0, angleDeg: 1e-4, setback: 0 });
      continue;
    }

    const tanHalf = Math.tan(absTurn * 0.5);
    if (!Number.isFinite(tanHalf)) return null;
    const setback = Math.max(0, safeMidRadius * Math.abs(tanHalf));
    endTrim[i] += setback;
    startTrim[i + 1] += setback;

    let angleDeg = -THREE.MathUtils.radToDeg(turnRad);
    if (Math.abs(angleDeg) < 1e-4) angleDeg = angleDeg >= 0 ? 1e-4 : -1e-4;
    joints.push({ index: i, turnRad, angleDeg, setback });
  }

  const segmentFlatLengths = segments.map((segment, idx) => (
    toFiniteNumber(segment.length, 0) - startTrim[idx] - endTrim[idx]
  ));
  if (segmentFlatLengths.some((length) => !(length > MIN_LEG))) return null;

  return { startTrim, endTrim, segmentFlatLengths, joints };
}

function buildContourMidplanePathData(path2Sketch, thickness, midRadius) {
  const halfThickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(thickness, MIN_THICKNESS))) * 0.5;
  const preferredSide = preferredContourOffsetSide(path2Sketch);
  const candidates = [preferredSide, -preferredSide];
  let preferredCandidate = null;
  let fallbackCandidate = null;

  for (const side of candidates) {
    const offsetPath = offsetOpenContourPath2(path2Sketch, halfThickness * side);
    if (!Array.isArray(offsetPath) || offsetPath.length < 2) continue;

    const segments = buildContourSegments(offsetPath);
    if (!segments.length) continue;

    const trimData = computeContourCornerTrimData(segments, midRadius);
    if (!trimData) continue;
    const minFlatLength = Math.min(...trimData.segmentFlatLengths);
    const candidate = {
      side,
      path2Midplane: offsetPath,
      segments,
      trimData,
      minFlatLength,
    };

    if (side === preferredSide) {
      preferredCandidate = candidate;
      continue;
    }
    if (!fallbackCandidate || candidate.minFlatLength > fallbackCandidate.minFlatLength) {
      fallbackCandidate = candidate;
    }
  }

  return preferredCandidate || fallbackCandidate;
}

function makeContourSegmentFlat(featureID, segmentIndex, length, height, usedIds, isRoot = false) {
  const safeLength = Math.max(MIN_LEG, toFiniteNumber(length, MIN_LEG));
  const safeHeight = Math.max(MIN_LEG, toFiniteNumber(height, MIN_LEG));
  const baseFlatId = isRoot ? `${featureID}:flat_root` : `${featureID}:flat_${segmentIndex + 1}`;
  const flatId = uniqueId(baseFlatId, usedIds);

  const topEdgeId = uniqueId(`${flatId}:top`, usedIds);
  const endEdgeId = uniqueId(`${flatId}:end`, usedIds);
  const bottomEdgeId = uniqueId(`${flatId}:bottom`, usedIds);
  const startEdgeId = uniqueId(`${flatId}:start`, usedIds);

  const flat = {
    kind: "flat",
    id: flatId,
    label: `Contour Segment ${segmentIndex + 1}`,
    color: colorFromString(`${featureID}:${flatId}`),
    outline: [
      [0, 0],
      [safeLength, 0],
      [safeLength, safeHeight],
      [0, safeHeight],
    ],
    edges: [
      { id: topEdgeId, polyline: [[0, 0], [safeLength, 0]] },
      { id: endEdgeId, polyline: [[safeLength, 0], [safeLength, safeHeight]] },
      { id: bottomEdgeId, polyline: [[safeLength, safeHeight], [0, safeHeight]] },
      { id: startEdgeId, isAttachEdge: !isRoot, polyline: [[0, 0], [0, safeHeight]] },
    ],
  };

  return { flat, flatId, startEdgeId, endEdgeId, topEdgeId, bottomEdgeId };
}

function buildContourFlangeFromPath(pathSelections, featureID, options = {}) {
  const path3 = buildPathPolylineFromSelections(pathSelections);
  if (!path3 || path3.length < 2) return null;

  const reverseSheetSide = !!options.reverseSheetSide;
  const frame = buildContourPathFrame(path3, reverseSheetSide);
  if (!frame) return null;

  const height = Math.max(MIN_LEG, Math.abs(toFiniteNumber(options.distance, 0)));
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(options.thickness, 1)));
  const insideRadius = Math.max(0, toFiniteNumber(options.bendRadius, thickness * 0.5));
  const midRadius = Math.max(MIN_LEG, insideRadius + thickness * 0.5);
  const kFactor = clamp(toFiniteNumber(options.kFactor, 0.5), 0, 1);

  const path2SketchRaw = path3.map((point) => projectPointToContourAxes(point, frame));
  const path2Sketch = simplifyContourPath2(path2SketchRaw);
  if (path2Sketch.length < 2) return null;

  const midplaneData = buildContourMidplanePathData(path2Sketch, thickness, midRadius);
  if (!midplaneData) return null;

  const path2 = midplaneData.path2Midplane;
  const trimData = midplaneData.trimData;
  const segments = midplaneData.segments.map((segment, idx) => ({
    ...segment,
    trimStart: trimData.startTrim[idx],
    trimEnd: trimData.endTrim[idx],
    flatLength: trimData.segmentFlatLengths[idx],
  }));
  if (!segments.length) return null;

  const usedIds = new Set();
  const first = makeContourSegmentFlat(featureID, 0, segments[0].flatLength, height, usedIds, true);
  let current = first;
  const bendSummary = [];

  for (let i = 0; i < segments.length - 1; i += 1) {
    const parentSeg = segments[i];
    const childSeg = segments[i + 1];
    const child = makeContourSegmentFlat(featureID, i + 1, childSeg.flatLength, height, usedIds, false);
    const joint = trimData.joints[i] || {};
    const angleDeg = toFiniteNumber(joint.angleDeg, -THREE.MathUtils.radToDeg(signedTurnRadians2(parentSeg.dir, childSeg.dir)));

    const bendId = uniqueId(`${featureID}:bend_${i + 1}`, usedIds);
    const endEdge = findEdgeById(current.flat, current.endEdgeId);
    if (!endEdge) return null;

    endEdge.bend = {
      kind: "bend",
      id: bendId,
      color: colorFromString(bendId, 0.7, 0.5),
      angleDeg,
      midRadius,
      kFactor,
      children: [{
        flat: child.flat,
        attachEdgeId: child.startEdgeId,
        reverseEdge: false,
      }],
    };

    bendSummary.push({
      bendId,
      fromFlatId: current.flatId,
      toFlatId: child.flatId,
      angleDeg,
      turnDeg: THREE.MathUtils.radToDeg(signedTurnRadians2(parentSeg.dir, childSeg.dir)),
      setback: Math.max(0, toFiniteNumber(joint.setback, 0)),
    });
    current = child;
  }

  const tree = {
    thickness,
    root: first.flat,
  };

  return {
    tree,
    frame,
    path2,
    path2Sketch,
    segments,
    bends: bendSummary,
    height,
    insideRadius,
    midRadius,
    kFactor,
  };
}

function ensureSheetMeta(tree) {
  if (!tree || typeof tree !== "object") return {};
  if (!tree.__sheetMeta || typeof tree.__sheetMeta !== "object") tree.__sheetMeta = {};
  return tree.__sheetMeta;
}

function collectTreeIds(tree) {
  const used = new Set();

  const visitFlat = (flat) => {
    if (!flat || typeof flat !== "object") return;
    used.add(String(flat.id || ""));
    const edges = Array.isArray(flat.edges) ? flat.edges : [];
    for (const edge of edges) {
      used.add(String(edge?.id || ""));
      const bend = edge?.bend;
      if (!bend) continue;
      used.add(String(bend.id || ""));
      const children = Array.isArray(bend.children) ? bend.children : [];
      for (const child of children) visitFlat(child?.flat);
    }
  };

  visitFlat(tree?.root);
  used.delete("");
  return used;
}

function uniqueId(base, usedIds) {
  let candidate = String(base || "id");
  let index = 1;
  while (usedIds.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function findFlatById(flat, targetId) {
  if (!flat || !targetId) return null;
  if (String(flat.id) === String(targetId)) return flat;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    const children = Array.isArray(edge?.bend?.children) ? edge.bend.children : [];
    for (const child of children) {
      const found = findFlatById(child?.flat, targetId);
      if (found) return found;
    }
  }
  return null;
}

function findEdgeById(flat, edgeId) {
  if (!flat || !edgeId) return null;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  return edges.find((edge) => String(edge?.id) === String(edgeId)) || null;
}

function copyPoint2(point) {
  return [toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1])];
}

function pointDistance2(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Number.POSITIVE_INFINITY;
  return Math.hypot(toFiniteNumber(a[0]) - toFiniteNumber(b[0]), toFiniteNumber(a[1]) - toFiniteNumber(b[1]));
}

function segmentLength2(a, b) {
  return pointDistance2(a, b);
}

function segmentSignature2(a, b) {
  return buildQuantizedPolylineSignature([[toFiniteNumber(a[0]), toFiniteNumber(a[1])], [toFiniteNumber(b[0]), toFiniteNumber(b[1])]]);
}

function polygonCentroid2(outline) {
  if (!Array.isArray(outline) || !outline.length) return [0, 0];
  let crossSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const cross = (toFiniteNumber(a[0]) * toFiniteNumber(b[1])) - (toFiniteNumber(b[0]) * toFiniteNumber(a[1]));
    crossSum += cross;
    cx += (toFiniteNumber(a[0]) + toFiniteNumber(b[0])) * cross;
    cy += (toFiniteNumber(a[1]) + toFiniteNumber(b[1])) * cross;
  }
  if (Math.abs(crossSum) <= EPS) {
    let sx = 0;
    let sy = 0;
    for (const point of outline) {
      sx += toFiniteNumber(point?.[0]);
      sy += toFiniteNumber(point?.[1]);
    }
    const inv = outline.length ? 1 / outline.length : 1;
    return [sx * inv, sy * inv];
  }
  return [cx / (3 * crossSum), cy / (3 * crossSum)];
}

function normalizeFlangeLengthReference(value) {
  const key = String(value || "outside").trim().toLowerCase();
  if (key === "inside" || key === "outside" || key === "web") return key;
  return "outside";
}

function normalizeFlangeInsetMode(value) {
  const key = String(value || "material_inside").trim().toLowerCase();
  if (key === "bend_outside" || key === "material_outside" || key === "material_inside") return key;
  return "material_inside";
}

function computeFlangeLengthReferenceSetback({ lengthReference = "outside", insideRadius = 0, thickness = 0, angleDeg = 90 }) {
  const ref = normalizeFlangeLengthReference(lengthReference);
  const safeInsideRadius = Math.max(0, toFiniteNumber(insideRadius, 0));
  const safeThickness = Math.max(0, toFiniteNumber(thickness, 0));
  const safeAngle = Math.max(0, Math.abs(toFiniteNumber(angleDeg, 90)));
  const halfRad = THREE.MathUtils.degToRad(safeAngle * 0.5);
  const tanHalf = Number.isFinite(Math.tan(halfRad)) ? Math.max(0, Math.tan(halfRad)) : 1;

  const insideSetback = safeInsideRadius * tanHalf;
  const outsideSetback = (safeInsideRadius + safeThickness) * tanHalf;
  if (ref === "inside") return insideSetback;
  if (ref === "outside") return outsideSetback;
  return 0; // web
}

function computeInsetEdgeShiftDistance({ insetMode = "material_inside", thickness = 0, insideRadius = 0 }) {
  const mode = normalizeFlangeInsetMode(insetMode);
  const safeThickness = Math.max(0, toFiniteNumber(thickness, 0));
  const safeInsideRadius = Math.max(0, toFiniteNumber(insideRadius, 0));
  if (mode === "material_inside") return safeThickness + safeInsideRadius;
  if (mode === "material_outside") return safeInsideRadius;
  return 0; // bend_outside
}

function findOutlineSegmentForEdge(flat, edge) {
  const outline = Array.isArray(flat?.outline) ? flat.outline : [];
  const edgePolyline = Array.isArray(edge?.polyline) ? edge.polyline : [];
  if (outline.length < 2 || edgePolyline.length < 2) return null;
  const edgeStart = edgePolyline[0];
  const edgeEnd = edgePolyline[edgePolyline.length - 1];
  let best = null;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const forward = pointDistance2(edgeStart, a) + pointDistance2(edgeEnd, b);
    const reverse = pointDistance2(edgeStart, b) + pointDistance2(edgeEnd, a);
    const reversed = reverse < forward;
    const score = reversed ? reverse : forward;
    if (!best || score < best.score) {
      best = { index: i, start: copyPoint2(a), end: copyPoint2(b), score, reversed };
    }
  }
  if (!best) return null;
  const segLen = segmentLength2(best.start, best.end);
  const tol = Math.max(POINT_EPS * 4, segLen * 1e-3);
  return best.score <= tol ? best : null;
}

function moveFlatEdgeForFlangeReference(flat, targetEdge, inwardDistance, usedIds) {
  const shift = toFiniteNumber(inwardDistance, 0);
  if (!(Math.abs(shift) > POINT_EPS)) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0 };
  }
  if (!flat || !targetEdge) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "invalid_flat_or_edge" };
  }
  const outline = Array.isArray(flat.outline) ? flat.outline.map((point) => copyPoint2(point)) : [];
  if (outline.length < 3) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "invalid_outline" };
  }

  const match = findOutlineSegmentForEdge(flat, targetEdge);
  if (!match) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "segment_not_found" };
  }

  const dx = match.end[0] - match.start[0];
  const dy = match.end[1] - match.start[1];
  const segLen = Math.hypot(dx, dy);
  if (!(segLen > EPS)) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "degenerate_segment" };
  }

  const left = [-dy / segLen, dx / segLen];
  const right = [dy / segLen, -dx / segLen];
  const centroid = polygonCentroid2(outline);
  const mid = [(match.start[0] + match.end[0]) * 0.5, (match.start[1] + match.end[1]) * 0.5];
  const toCenter = [centroid[0] - mid[0], centroid[1] - mid[1]];
  const dotLeft = toCenter[0] * left[0] + toCenter[1] * left[1];
  const dotRight = toCenter[0] * right[0] + toCenter[1] * right[1];
  const inward = dotLeft >= dotRight ? left : right;

  const movedStart = [match.start[0] + inward[0] * shift, match.start[1] + inward[1] * shift];
  const movedEnd = [match.end[0] + inward[0] * shift, match.end[1] + inward[1] * shift];
  if (!(segmentLength2(movedStart, movedEnd) > POINT_EPS)) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "degenerate_moved_edge" };
  }

  const oldEdges = Array.isArray(flat.edges) ? flat.edges : [];
  const oldBySig = new Map();
  for (const edge of oldEdges) {
    if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) continue;
    const sig = segmentSignature2(edge.polyline[0], edge.polyline[edge.polyline.length - 1]);
    if (!sig) continue;
    if (!oldBySig.has(sig)) oldBySig.set(sig, []);
    oldBySig.get(sig).push(edge);
  }
  const findExistingEdgeBySegment = (a, b, excludeId = null) => {
    const sig = segmentSignature2(a, b);
    if (!sig) return null;
    const list = oldBySig.get(sig);
    if (!Array.isArray(list) || !list.length) return null;
    for (let i = 0; i < list.length; i += 1) {
      const candidate = list[i];
      if (!candidate) continue;
      const candidateId = candidate.id != null ? String(candidate.id) : null;
      if (excludeId != null && candidateId === String(excludeId)) continue;
      return candidate;
    }
    return null;
  };

  const dot2 = (u, v) => (u[0] * v[0]) + (u[1] * v[1]);
  const collinear2 = (u, v) => {
    const lu = Math.hypot(u[0], u[1]);
    const lv = Math.hypot(v[0], v[1]);
    if (!(lu > POINT_EPS) || !(lv > POINT_EPS)) return false;
    const cross = Math.abs((u[0] * v[1]) - (u[1] * v[0]));
    const tol = Math.max(POINT_EPS * 0.5, Math.min(lu, lv) * 1e-4);
    return cross <= tol;
  };

  const count = outline.length;
  const startIndex = match.index;
  const endIndex = (match.index + 1) % count;
  const prevIndex = (startIndex - 1 + count) % count;
  const nextIndex = endIndex;
  const prevPoint = copyPoint2(outline[prevIndex]);
  const nextPoint = copyPoint2(outline[(nextIndex + 1) % count]);

  const incomingPrev = [match.start[0] - prevPoint[0], match.start[1] - prevPoint[1]];
  const outgoingStartBridge = [movedStart[0] - match.start[0], movedStart[1] - match.start[1]];
  const incomingEndBridge = [match.end[0] - movedEnd[0], match.end[1] - movedEnd[1]];
  const outgoingNext = [nextPoint[0] - match.end[0], nextPoint[1] - match.end[1]];

  // If a bridge would immediately reverse along an adjacent collinear edge, trim the adjacent edge
  // to the moved endpoint instead of creating a zero-area spike.
  const trimStartAdjacent = collinear2(incomingPrev, outgoingStartBridge) && dot2(incomingPrev, outgoingStartBridge) < 0;
  const trimEndAdjacent = collinear2(incomingEndBridge, outgoingNext) && dot2(incomingEndBridge, outgoingNext) < 0;

  const prevAdjEdge = findExistingEdgeBySegment(prevPoint, match.start, targetEdge?.id ?? null);
  const nextAdjEdge = findExistingEdgeBySegment(match.end, nextPoint, targetEdge?.id ?? null);
  const prevProtected = !!(prevAdjEdge?.bend || prevAdjEdge?.isAttachEdge);
  const nextProtected = !!(nextAdjEdge?.bend || nextAdjEdge?.isAttachEdge);
  // Never reshape an adjacent bend/attach edge. We still move the selected edge and bridge to the
  // original endpoint (overlap/double-back is allowed), so inset options remain active in-place.
  const trimStart = trimStartAdjacent && !prevProtected;
  const trimEnd = trimEndAdjacent && !nextProtected;
  let startNeedsReliefJog = trimStartAdjacent && prevProtected;
  let endNeedsReliefJog = trimEndAdjacent && nextProtected;
  // When one protected side requires an overlap-relief jog, mirror that tiny jog
  // on the other bridged side as well. This avoids single-sided micro-overlaps
  // that can still produce non-manifold topology in chained flange cases.
  if (startNeedsReliefJog || endNeedsReliefJog) {
    if (!trimStart) startNeedsReliefJog = true;
    if (!trimEnd) endNeedsReliefJog = true;
  }

  const tangent = [dx / segLen, dy / segLen];
  const reliefDistance = Math.min(segLen * 0.25, OVERLAP_RELIEF_GAP);
  const reliefStartPoint = [
    match.start[0] + (tangent[0] * reliefDistance),
    match.start[1] + (tangent[1] * reliefDistance),
  ];
  const reliefEndPoint = [
    match.end[0] - (tangent[0] * reliefDistance),
    match.end[1] - (tangent[1] * reliefDistance),
  ];
  const movedReliefStartPoint = [
    movedStart[0] + (tangent[0] * reliefDistance),
    movedStart[1] + (tangent[1] * reliefDistance),
  ];
  const movedReliefEndPoint = [
    movedEnd[0] - (tangent[0] * reliefDistance),
    movedEnd[1] - (tangent[1] * reliefDistance),
  ];
  const effectiveMovedStart = startNeedsReliefJog ? movedReliefStartPoint : movedStart;
  const effectiveMovedEnd = endNeedsReliefJog ? movedReliefEndPoint : movedEnd;
  if (!(segmentLength2(effectiveMovedStart, effectiveMovedEnd) > POINT_EPS)) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "relief_consumed_target_edge" };
  }

  const edgeDefs = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (i === prevIndex && trimStart) {
      edgeDefs.push({
        kind: "existing",
        a: copyPoint2(a),
        b: copyPoint2(movedStart),
        reuseA: copyPoint2(a),
        reuseB: copyPoint2(b),
      });
      continue;
    }
    if (i === nextIndex && trimEnd) {
      edgeDefs.push({
        kind: "existing",
        a: copyPoint2(movedEnd),
        b: copyPoint2(b),
        reuseA: copyPoint2(a),
        reuseB: copyPoint2(b),
      });
      continue;
    }
    if (i !== match.index) {
      edgeDefs.push({ kind: "existing", a: copyPoint2(a), b: copyPoint2(b) });
      continue;
    }
    if (!trimStart) {
      if (startNeedsReliefJog && segmentLength2(a, reliefStartPoint) >= POINT_EPS && segmentLength2(reliefStartPoint, effectiveMovedStart) > POINT_EPS) {
        edgeDefs.push({ kind: "bridge_start", a: copyPoint2(a), b: copyPoint2(reliefStartPoint) });
        edgeDefs.push({ kind: "bridge_start", a: copyPoint2(reliefStartPoint), b: copyPoint2(effectiveMovedStart) });
      } else {
        edgeDefs.push({ kind: "bridge_start", a: copyPoint2(a), b: copyPoint2(effectiveMovedStart) });
      }
    }
    edgeDefs.push({ kind: "target", a: copyPoint2(effectiveMovedStart), b: copyPoint2(effectiveMovedEnd) });
    if (!trimEnd) {
      if (endNeedsReliefJog && segmentLength2(effectiveMovedEnd, reliefEndPoint) > POINT_EPS && segmentLength2(reliefEndPoint, b) >= POINT_EPS) {
        edgeDefs.push({ kind: "bridge_end", a: copyPoint2(effectiveMovedEnd), b: copyPoint2(reliefEndPoint) });
        edgeDefs.push({ kind: "bridge_end", a: copyPoint2(reliefEndPoint), b: copyPoint2(b) });
      } else {
        edgeDefs.push({ kind: "bridge_end", a: copyPoint2(effectiveMovedEnd), b: copyPoint2(b) });
      }
    }
  }

  // Preserve intentional overlap-relief micro segments (e.g. 0.0001) so we don't
  // accidentally collapse the loop and create a non-manifold diagonal closure.
  const filteredDefs = edgeDefs.filter((entry) => segmentLength2(entry.a, entry.b) >= POINT_EPS);
  if (filteredDefs.length < 3) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "insufficient_segments" };
  }

  const consumed = new Set();
  const consumeExistingEdge = (a, b, excludeId = null) => {
    const sig = segmentSignature2(a, b);
    if (!sig) return null;
    const list = oldBySig.get(sig);
    if (!Array.isArray(list) || !list.length) return null;
    for (let i = 0; i < list.length; i += 1) {
      const candidate = list[i];
      if (!candidate) continue;
      const candidateId = candidate.id != null ? String(candidate.id) : null;
      if (excludeId != null && candidateId === String(excludeId)) continue;
      if (candidateId != null && consumed.has(candidateId)) continue;
      if (candidateId != null) consumed.add(candidateId);
      return candidate;
    }
    return null;
  };

  const newEdges = [];
  const orientSegmentLikeMatchedEdge = (a, b, matchedEdge, refA = null, refB = null) => {
    const forward = [copyPoint2(a), copyPoint2(b)];
    const reverse = [copyPoint2(b), copyPoint2(a)];
    if (!matchedEdge || !Array.isArray(matchedEdge.polyline) || matchedEdge.polyline.length < 2) return forward;
    const edgeStart = matchedEdge.polyline[0];
    const edgeEnd = matchedEdge.polyline[matchedEdge.polyline.length - 1];
    const sourceA = Array.isArray(refA) ? refA : a;
    const sourceB = Array.isArray(refB) ? refB : b;
    const sameDirScore = pointDistance2(edgeStart, sourceA) + pointDistance2(edgeEnd, sourceB);
    const reversedScore = pointDistance2(edgeStart, sourceB) + pointDistance2(edgeEnd, sourceA);
    return sameDirScore <= reversedScore ? forward : reverse;
  };
  let bridgeCount = 0;
  for (const entry of filteredDefs) {
    if (entry.kind === "target") {
      const targetPolyline = match.reversed
        ? [copyPoint2(entry.b), copyPoint2(entry.a)]
        : [copyPoint2(entry.a), copyPoint2(entry.b)];
      const rebuilt = { ...(targetEdge || {}), polyline: targetPolyline };
      newEdges.push(rebuilt);
      if (targetEdge?.id != null) consumed.add(String(targetEdge.id));
      continue;
    }

    if (entry.kind === "existing") {
      const reuseA = Array.isArray(entry.reuseA) ? entry.reuseA : entry.a;
      const reuseB = Array.isArray(entry.reuseB) ? entry.reuseB : entry.b;
      const matchedEdge = consumeExistingEdge(reuseA, reuseB, targetEdge?.id ?? null);
      if (matchedEdge) {
        newEdges.push({
          ...matchedEdge,
          polyline: orientSegmentLikeMatchedEdge(entry.a, entry.b, matchedEdge, reuseA, reuseB),
        });
      } else {
        const fallbackId = uniqueId(`${flat.id}:edge`, usedIds);
        newEdges.push({ id: fallbackId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] });
      }
      continue;
    }

    bridgeCount += 1;
    const bridgeId = uniqueId(`${targetEdge?.id || flat.id}:bridge`, usedIds);
    newEdges.push({ id: bridgeId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] });
  }

  const rebuiltOutline = [copyPoint2(filteredDefs[0].a), ...filteredDefs.map((entry) => copyPoint2(entry.b))];
  if (rebuiltOutline.length >= 2) {
    const first = rebuiltOutline[0];
    const last = rebuiltOutline[rebuiltOutline.length - 1];
    if (pointDistance2(first, last) <= POINT_EPS) rebuiltOutline.pop();
  }
  if (rebuiltOutline.length < 3) {
    return { edge: targetEdge, moved: false, shiftDistance: 0, bridgeCount: 0, reason: "invalid_rebuilt_outline" };
  }

  flat.outline = rebuiltOutline;
  flat.edges = newEdges;
  const movedEdge = newEdges.find((edge) => String(edge?.id) === String(targetEdge?.id)) || null;
  return {
    edge: movedEdge || targetEdge,
    moved: true,
    shiftDistance: shift,
    bridgeCount,
  };
}

function chooseDefaultEdge(flat) {
  const edges = Array.isArray(flat?.edges) ? flat.edges : [];
  const candidates = edges.filter((edge) => (
    edge
    && !edge.bend
    && !edge.isAttachEdge
    && Array.isArray(edge.polyline)
    && edge.polyline.length >= 2
  ));
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestLen = polylineLength2D(best.polyline);
  for (let i = 1; i < candidates.length; i += 1) {
    const len = polylineLength2D(candidates[i].polyline);
    if (len > bestLen) {
      best = candidates[i];
      bestLen = len;
    }
  }
  return best;
}

function resolveCarrierFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.sheetMetalModel?.tree) return current;
    current = current.parent || null;
  }
  return null;
}

function buildSheetSourceFromCarrier(carrier) {
  if (!carrier) return null;
  const tree = carrier.userData?.sheetMetalModel?.tree;
  if (!tree || typeof tree !== "object") return null;

  try { carrier.updateMatrixWorld?.(true); } catch {
    // ignore
  }

  const storedRoot = carrier.userData?.sheetMetalModel?.rootTransform;
  const hasStoredRoot = Array.isArray(storedRoot) && storedRoot.length === 16;
  return {
    carrier,
    tree: cloneTree(tree),
    rootMatrix: hasStoredRoot
      ? matrixFromAny(storedRoot)
      : (carrier.matrixWorld ? carrier.matrixWorld.clone() : new THREE.Matrix4().identity()),
  };
}

function rootSceneFromObject(object) {
  let current = object;
  let last = null;
  while (current && typeof current === "object") {
    last = current;
    current = current.parent || null;
  }
  return (last && typeof last.traverse === "function") ? last : null;
}

function rootSceneFromSelections(selections) {
  const list = normalizeSelectionArray(selections);
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const scene = rootSceneFromObject(item);
    if (scene) return scene;
  }
  return null;
}

function collectSheetMetalCarriersInScene(scene) {
  if (!scene || typeof scene.traverse !== "function") return [];
  const out = [];
  const seen = new Set();
  scene.traverse((object) => {
    if (!object || !object.userData?.sheetMetalModel?.tree) return;
    const key = object.uuid || object.id || object.name || object;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(object);
  });
  return out;
}

function worldAnchorFromSelection(selection) {
  if (!selection || typeof selection !== "object") return null;
  try {
    const box = new THREE.Box3().setFromObject(selection);
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
  } catch {
    // ignore
  }
  try {
    if (typeof selection.getWorldPosition === "function") {
      const point = selection.getWorldPosition(new THREE.Vector3());
      if (point?.isVector3) return point;
    }
  } catch {
    // ignore
  }
  return null;
}

function nearestCarrierByAnchor(carriers, anchor) {
  if (!Array.isArray(carriers) || !carriers.length) return null;
  if (!anchor?.isVector3) return carriers[0] || null;

  let best = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  const box = new THREE.Box3();
  const nearest = new THREE.Vector3();
  for (const carrier of carriers) {
    if (!carrier) continue;
    try {
      box.setFromObject(carrier);
      const point = box.clampPoint(anchor, nearest);
      const distSq = point.distanceToSquared(anchor);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = carrier;
      }
    } catch {
      // ignore broken bbox candidates
    }
  }
  return best || carriers[0] || null;
}

function resolveSheetSourceWithFallback(sheetSelections, profileSelections) {
  // Priority 1: explicit sheet target field
  const fromSheet = resolveSheetSourceFromSelections(sheetSelections);
  if (fromSheet) return { source: fromSheet, resolution: "explicit_sheet" };

  // Priority 2: profile selection directly attached to an existing sheet model
  const fromProfileOwner = resolveSheetSourceFromSelections(profileSelections);
  if (fromProfileOwner) return { source: fromProfileOwner, resolution: "profile_owner" };

  // Priority 3: nearest sheet model in scene to the profile selection anchor
  const scene = rootSceneFromSelections(sheetSelections) || rootSceneFromSelections(profileSelections);
  if (!scene) return { source: null, resolution: "no_scene" };
  const carriers = collectSheetMetalCarriersInScene(scene);
  if (!carriers.length) return { source: null, resolution: "no_sheet_models" };
  const profileAnchor = worldAnchorFromSelection(normalizeSelectionArray(profileSelections)[0] || null);
  const sheetAnchor = worldAnchorFromSelection(normalizeSelectionArray(sheetSelections)[0] || null);
  const anchor = profileAnchor || sheetAnchor || null;
  const picked = nearestCarrierByAnchor(carriers, anchor);
  return {
    source: buildSheetSourceFromCarrier(picked),
    resolution: "nearest_sheet_in_scene",
  };
}

function resolveSheetSourceFromSelections(selections) {
  const list = normalizeSelectionArray(selections);
  for (const item of list) {
    const carrier = resolveCarrierFromObject(item);
    if (!carrier) continue;
    const source = buildSheetSourceFromCarrier(carrier);
    if (source) return source;
  }
  return null;
}

function readSelectionSheetMetalMetadata(selection) {
  if (!selection || typeof selection !== "object") return null;
  const fromUserData = selection?.userData?.sheetMetal;
  let merged = (fromUserData && typeof fromUserData === "object")
    ? { ...fromUserData }
    : {};

  const solid = selection.parentSolid || resolveCarrierFromObject(selection);
  const name = selection?.name || selection?.userData?.faceName || selection?.userData?.edgeName || null;
  if (!solid || !name) {
    return Object.keys(merged).length ? merged : null;
  }

  try {
    const isFace = String(selection.type || "").toUpperCase() === "FACE";
    const isEdge = String(selection.type || "").toUpperCase() === "EDGE";
    const metadata = isFace
      ? (typeof solid.getFaceMetadata === "function" ? solid.getFaceMetadata(name) : null)
      : (isEdge ? (typeof solid.getEdgeMetadata === "function" ? solid.getEdgeMetadata(name) : null) : null);

    if (metadata && typeof metadata === "object") {
      if (metadata.sheetMetal && typeof metadata.sheetMetal === "object") {
        merged = { ...merged, ...metadata.sheetMetal };
      }
      if (metadata.flatId != null && merged.flatId == null) merged.flatId = metadata.flatId;
      if (metadata.edgeId != null && merged.edgeId == null) merged.edgeId = metadata.edgeId;
      if (metadata.bendId != null && merged.bendId == null) merged.bendId = metadata.bendId;
    }
  } catch {
    // ignore metadata lookup failures
  }

  return Object.keys(merged).length ? merged : null;
}

function resolveEdgeTargets(selections, tree, carrier) {
  const targets = [];
  const seen = new Set();

  for (const selection of normalizeSelectionArray(selections)) {
    if (!selection || typeof selection !== "object") continue;
    const selectionCarrier = resolveCarrierFromObject(selection);
    if (!selectionCarrier || selectionCarrier !== carrier) continue;

    const meta = readSelectionSheetMetalMetadata(selection) || {};
    const flatId = meta.flatId || null;
    const edgeId = meta.edgeId || null;
    if (!flatId) continue;

    const flat = findFlatById(tree.root, flatId);
    if (!flat) continue;

    const edge = edgeId ? findEdgeById(flat, edgeId) : chooseDefaultEdge(flat);
    if (!edge) continue;

    const key = `${flat.id}|${edge.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ flatId: flat.id, edgeId: edge.id });
  }

  if (targets.length) return targets;

  const rootFlat = tree?.root;
  const defaultEdge = chooseDefaultEdge(rootFlat);
  if (rootFlat && defaultEdge) {
    targets.push({ flatId: rootFlat.id, edgeId: defaultEdge.id });
  }
  return targets;
}

function makeFlangeChildFlat(featureID, parentEdge, legLength, colorSeed, usedIds) {
  const length = Math.max(MIN_LEG, polylineLength2D(parentEdge.polyline));
  if (!(length > EPS)) return null;

  const flatId = uniqueId(`${featureID}:flat`, usedIds);
  const attachEdgeId = uniqueId(`${flatId}:attach`, usedIds);
  const topEdgeId = uniqueId(`${flatId}:top`, usedIds);
  const leftEdgeId = uniqueId(`${flatId}:left`, usedIds);
  const rightEdgeId = uniqueId(`${flatId}:right`, usedIds);

  const safeLeg = Math.max(MIN_LEG, toFiniteNumber(legLength, 0));

  const childFlat = {
    kind: "flat",
    id: flatId,
    label: `Flange ${flatId}`,
    color: colorFromString(colorSeed || flatId),
    outline: [
      [0, 0],
      [length, 0],
      [length, safeLeg],
      [0, safeLeg],
    ],
    edges: [
      { id: attachEdgeId, isAttachEdge: true, polyline: [[0, 0], [length, 0]] },
      { id: topEdgeId, polyline: [[length, safeLeg], [0, safeLeg]] },
      { id: leftEdgeId, polyline: [[0, safeLeg], [0, 0]] },
      { id: rightEdgeId, polyline: [[length, 0], [length, safeLeg]] },
    ],
  };

  return { childFlat, attachEdgeId };
}

function addFlangesToTree(tree, featureID, targets, options = {}) {
  const usedIds = collectTreeIds(tree);
  const summary = {
    requested: targets.length,
    applied: 0,
    skipped: 0,
    appliedTargets: [],
    skippedTargets: [],
  };

  const angleDeg = toFiniteNumber(options.angleDeg, 90);
  const midRadius = Math.max(MIN_LEG, toFiniteNumber(options.midRadius, 1));
  const kFactor = clamp(toFiniteNumber(options.kFactor, 0.5), 0, 1);
  const legLength = Math.max(MIN_LEG, toFiniteNumber(options.legLength, 0));
  const requestedLegLength = Math.max(MIN_LEG, toFiniteNumber(options.requestedLegLength, legLength));
  const legLengthReference = normalizeFlangeLengthReference(options.legLengthReference);
  const legLengthReferenceSetback = Math.max(0, toFiniteNumber(options.legLengthReferenceSetback, 0));
  const thickness = Math.max(MIN_THICKNESS, toFiniteNumber(options.thickness, tree?.thickness));
  const insideRadius = Math.max(0, toFiniteNumber(options.insideRadius, 0));
  const insetMode = normalizeFlangeInsetMode(options.insetMode);
  const insetReferenceShift = computeInsetEdgeShiftDistance({
    insetMode,
    thickness,
    insideRadius,
  });
  // Positive user offset pushes the bend edge outward from the flat body.
  const userOffset = toFiniteNumber(options.offset, 0);
  const inwardEdgeShift = insetReferenceShift - userOffset;

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const flat = findFlatById(tree.root, target.flatId);
    if (!flat) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "flat_not_found" });
      continue;
    }

    const edge = findEdgeById(flat, target.edgeId);
    if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "edge_not_found" });
      continue;
    }

    if (edge.bend || edge.isAttachEdge) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "edge_already_has_bend" });
      continue;
    }

    let parentEdge = edge;
    let edgeShiftApplied = 0;
    let bridgeCount = 0;
    if (Math.abs(inwardEdgeShift) > POINT_EPS) {
      const moved = moveFlatEdgeForFlangeReference(flat, edge, inwardEdgeShift, usedIds);
      if (!moved?.edge) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: moved?.reason || "edge_move_failed" });
        continue;
      }
      parentEdge = moved.edge;
      edgeShiftApplied = moved.moved ? toFiniteNumber(moved.shiftDistance, 0) : 0;
      bridgeCount = moved.moved ? toFiniteNumber(moved.bridgeCount, 0) : 0;
    }

    const created = makeFlangeChildFlat(featureID, parentEdge, legLength, `${featureID}:${flat.id}:${parentEdge.id}:${i}`, usedIds);
    if (!created) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "invalid_child_flat" });
      continue;
    }

    const bendId = uniqueId(`${featureID}:bend`, usedIds);
    parentEdge.bend = {
      kind: "bend",
      id: bendId,
      color: colorFromString(bendId, 0.7, 0.5),
      angleDeg,
      midRadius,
      kFactor,
      children: [{
        flat: created.childFlat,
        attachEdgeId: created.attachEdgeId,
      }],
    };

    summary.applied += 1;
    summary.appliedTargets.push({
      ...target,
      edgeId: parentEdge.id,
      bendId,
      childFlatId: created.childFlat.id,
      insetMode,
      insetReferenceShift,
      legLengthReference,
      legLengthReferenceSetback,
      requestedLegLength,
      effectiveLegLength: legLength,
      userOffset,
      edgeShiftApplied,
      bridgeCount,
    });
  }

  return summary;
}

function makeFlatFaceName(featureID, flatId, suffix) {
  return `${featureID}:FLAT:${flatId}:${suffix}`;
}

function makeBendFaceName(featureID, bendId, suffix) {
  return `${featureID}:BEND:${bendId}:${suffix}`;
}

function sheetMetalFaceStableKey(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const sm = metadata.sheetMetal;
  if (!sm || typeof sm !== "object") return null;

  const kind = String(sm.kind || "").trim().toLowerCase();
  const flatId = sm.flatId != null ? String(sm.flatId) : null;
  const bendId = sm.bendId != null ? String(sm.bendId) : null;
  const edgeId = sm.edgeId != null ? String(sm.edgeId) : null;
  const side = sm.side != null ? String(sm.side).trim().toUpperCase() : null;
  const end = sm.end != null ? String(sm.end).trim().toLowerCase() : null;

  if (kind === "flat" && flatId && side) return `flat|${flatId}|${side}`;
  if (kind === "flat_edge_wall" && flatId && edgeId) return `flat_edge_wall|${flatId}|${edgeId}`;
  if (kind === "flat_cutout_wall" && flatId && sm.holeId != null) {
    if (sm.edgeSignature != null) {
      return `flat_cutout_wall|${flatId}|${String(sm.holeId)}|sig:${String(sm.edgeSignature)}`;
    }
    if (sm.edgeIndex != null) {
      return `flat_cutout_wall|${flatId}|${String(sm.holeId)}|edge:${toFiniteNumber(sm.edgeIndex, 0)}`;
    }
    return `flat_cutout_wall|${flatId}|${String(sm.holeId)}`;
  }
  if (kind === "bend" && bendId && side) return `bend|${bendId}|${side}`;
  if (kind === "bend_end_cap" && bendId && end) return `bend_end_cap|${bendId}|${end}`;
  return null;
}

function buildSheetMetalFaceNameLookup(solid) {
  const lookup = new Map();
  if (!solid || typeof solid.getFaceMetadata !== "function") return lookup;
  const faceNames = typeof solid.getFaceNames === "function"
    ? solid.getFaceNames()
    : (solid?._faceNameToID instanceof Map ? Array.from(solid._faceNameToID.keys()) : []);

  for (const faceName of faceNames) {
    if (!faceName) continue;
    const meta = solid.getFaceMetadata(faceName);
    const key = sheetMetalFaceStableKey(meta);
    if (!key || lookup.has(key)) continue;
    lookup.set(key, String(faceName));
  }
  return lookup;
}

function preserveSheetMetalFaceNames(targetSolid, sourceSolid) {
  if (!targetSolid || !sourceSolid) return;
  if (typeof targetSolid.getFaceMetadata !== "function" || typeof targetSolid.renameFace !== "function") return;
  const sourceLookup = buildSheetMetalFaceNameLookup(sourceSolid);
  if (!sourceLookup.size) return;

  const targetFaceNames = typeof targetSolid.getFaceNames === "function"
    ? targetSolid.getFaceNames()
    : (targetSolid?._faceNameToID instanceof Map ? Array.from(targetSolid._faceNameToID.keys()) : []);

  for (const currentName of targetFaceNames) {
    if (!currentName) continue;
    const meta = targetSolid.getFaceMetadata(currentName);
    const key = sheetMetalFaceStableKey(meta);
    if (!key) continue;
    const previousName = sourceLookup.get(key);
    if (!previousName || previousName === currentName) continue;
    try {
      targetSolid.renameFace(currentName, previousName);
    } catch {
      // best effort: if rename fails, keep generated deterministic name
    }
  }
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function polylineLength3(polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    len += distance3(polyline[i - 1], polyline[i]);
  }
  return len;
}

function edgePolylineScore(boundaryPolyline, candidatePolyline) {
  if (!Array.isArray(boundaryPolyline) || boundaryPolyline.length < 2) return Number.POSITIVE_INFINITY;
  if (!Array.isArray(candidatePolyline) || candidatePolyline.length < 2) return Number.POSITIVE_INFINITY;
  const bStart = boundaryPolyline[0];
  const bEnd = boundaryPolyline[boundaryPolyline.length - 1];
  const cStart = candidatePolyline[0];
  const cEnd = candidatePolyline[candidatePolyline.length - 1];
  const forward = distance3(bStart, cStart) + distance3(bEnd, cEnd);
  const reverse = distance3(bStart, cEnd) + distance3(bEnd, cStart);
  const lenPenalty = Math.abs(polylineLength3(boundaryPolyline) - polylineLength3(candidatePolyline)) * 0.25;
  return Math.min(forward, reverse) + lenPenalty;
}

function transformPolyline3ByMatrix(polyline, matrix) {
  const out = [];
  if (!Array.isArray(polyline)) return out;
  for (const point of polyline) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const p = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(matrix);
    out.push(quantizePoint3(p));
  }
  return out;
}

function cumulativeLengths3(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(out[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  return out;
}

function samplePolyline3(points, lengths, t) {
  if (!points.length) return new THREE.Vector3();
  if (points.length === 1 || t <= 0) return points[0].clone();
  if (t >= 1) return points[points.length - 1].clone();

  const total = lengths[lengths.length - 1];
  if (total <= EPS) return points[0].clone();

  const target = total * t;
  for (let i = 0; i < lengths.length - 1; i += 1) {
    if (target > lengths[i + 1]) continue;
    const segmentLength = lengths[i + 1] - lengths[i];
    if (segmentLength <= EPS) return points[i].clone();
    const alpha = (target - lengths[i]) / segmentLength;
    return points[i].clone().lerp(points[i + 1], alpha);
  }
  return points[points.length - 1].clone();
}

function resamplePolyline3(points, sampleCount) {
  const lengths = cumulativeLengths3(points);
  const out = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    out.push(samplePolyline3(points, lengths, t));
  }
  return out;
}

function buildBendLookup(tree) {
  const lookup = new Map();
  const visitFlat = (flat) => {
    if (!flat || typeof flat !== "object") return;
    const edges = Array.isArray(flat.edges) ? flat.edges : [];
    for (const edge of edges) {
      const bend = edge?.bend;
      if (!bend || typeof bend !== "object") continue;

      const childAttachEdgeByFlatId = {};
      const children = Array.isArray(bend.children) ? bend.children : [];
      for (const child of children) {
        const childFlatId = child?.flat?.id;
        if (!childFlatId) continue;
        childAttachEdgeByFlatId[String(childFlatId)] = child?.attachEdgeId ?? null;
        if (child?.attachEdgeId) {
          const attachEdge = findEdgeById(child.flat, child.attachEdgeId);
          if (attachEdge) attachEdge.isAttachEdge = true;
        }
      }

      lookup.set(String(bend.id), {
        parentFlatId: flat.id ?? null,
        parentEdgeId: edge.id ?? null,
        childAttachEdgeByFlatId,
      });

      for (const child of children) {
        visitFlat(child?.flat);
      }
    }
  };

  visitFlat(tree?.root);
  return lookup;
}

function addFlatPlacementToSolid({ solid, placement, featureID, thickness, edgeCandidates }) {
  const flat = placement?.flat;
  if (!solid || !flat || !Array.isArray(flat.outline) || flat.outline.length < 3) return;

  const outerLoop = normalizeLoop2(flat.outline);
  if (outerLoop.length < 3) return;

  const holeEntries = collectFlatHoleLoops(flat).map((entry, index) => {
    const outerArea = signedArea2D(outerLoop);
    let loop = entry.loop;
    if (outerArea * signedArea2D(loop) > 0) loop = loop.slice().reverse();
    return {
      ...entry,
      id: entry.id || `${flat.id}:hole_${index + 1}`,
      loop,
    };
  });

  const contour = outerLoop.map((point) => new THREE.Vector2(point[0], point[1]));
  const holeLoops = holeEntries.map((entry) => entry.loop.map((point) => new THREE.Vector2(point[0], point[1])));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holeLoops);
  if (!triangles.length) return;

  const loops = [outerLoop, ...holeEntries.map((entry) => entry.loop)];
  const loopOffsets = [];
  let pointCount = 0;
  for (const loop of loops) {
    loopOffsets.push(pointCount);
    pointCount += loop.length;
  }

  const halfT = thickness * 0.5;
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(placement.matrix).normalize();
  const topPoints = new Array(pointCount);
  const bottomPoints = new Array(pointCount);

  for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
    const loop = loops[loopIndex];
    const offset = loopOffsets[loopIndex];
    for (let i = 0; i < loop.length; i += 1) {
      const point = loop[i];
      const mid = makeMidplaneWorldPoint(placement.matrix, point);
      const top = mid.clone().addScaledVector(normal, halfT);
      const bottom = mid.clone().addScaledVector(normal, -halfT);
      topPoints[offset + i] = quantizePoint3(top);
      bottomPoints[offset + i] = quantizePoint3(bottom);
    }
  }

  const topFace = makeFlatFaceName(featureID, flat.id, "A");
  const bottomFace = makeFlatFaceName(featureID, flat.id, "B");
  for (const tri of triangles) {
    addTriangleIfValid(solid, topFace, topPoints[tri[0]], topPoints[tri[1]], topPoints[tri[2]]);
    addTriangleIfValid(solid, bottomFace, bottomPoints[tri[0]], bottomPoints[tri[2]], bottomPoints[tri[1]]);
  }

  const defaultEdgeId = chooseDefaultEdge(flat)?.id || null;
  solid.setFaceMetadata(topFace, {
    flatId: flat.id,
    sheetMetalFaceType: "A",
    sheetMetal: {
      kind: "flat",
      representation: "3D",
      flatId: flat.id,
      side: "A",
      defaultEdgeId,
    },
  });
  solid.setFaceMetadata(bottomFace, {
    flatId: flat.id,
    sheetMetalFaceType: "B",
    sheetMetal: {
      kind: "flat",
      representation: "3D",
      flatId: flat.id,
      side: "B",
      defaultEdgeId,
    },
  });

  const flatEdges = Array.isArray(flat.edges) ? flat.edges : [];
  const edgeIndex = buildFlatEdgeIndex(flat);
  const outerOffset = loopOffsets[0];
  for (let i = 0; i < outerLoop.length; i += 1) {
    const next = (i + 1) % outerLoop.length;
    const signature = buildQuantizedPolylineSignature([outerLoop[i], outerLoop[next]]);
    const mappedEdge = edgeIndex.get(signature) || flatEdges[i] || null;
    if (mappedEdge?.bend || mappedEdge?.isAttachEdge) continue;

    const edgeId = mappedEdge?.id || `${flat.id}:edge_${i + 1}`;
    const sideFace = makeFlatFaceName(featureID, flat.id, `SIDE:${edgeId}`);
    const topA = outerOffset + i;
    const topB = outerOffset + next;
    addTriangleIfValid(solid, sideFace, topPoints[topA], bottomPoints[topA], topPoints[topB]);
    addTriangleIfValid(solid, sideFace, topPoints[topB], bottomPoints[topA], bottomPoints[topB]);
    solid.setFaceMetadata(sideFace, {
      flatId: flat.id,
      edgeId,
      sheetMetal: {
        kind: "flat_edge_wall",
        representation: "3D",
        flatId: flat.id,
        edgeId,
      },
    });
  }

  for (let holeIndex = 0; holeIndex < holeEntries.length; holeIndex += 1) {
    const hole = holeEntries[holeIndex];
    const loop = hole.loop;
    const offset = loopOffsets[holeIndex + 1];
    for (let i = 0; i < loop.length; i += 1) {
      const next = (i + 1) % loop.length;
      const edgeIndex = i + 1;
      const sideFace = makeFlatFaceName(featureID, flat.id, `CUTOUT:${hole.id}:EDGE:${edgeIndex}`);
      const topA = offset + i;
      const topB = offset + next;
      addTriangleIfValid(solid, sideFace, topPoints[topA], bottomPoints[topA], topPoints[topB]);
      addTriangleIfValid(solid, sideFace, topPoints[topB], bottomPoints[topA], bottomPoints[topB]);
      const edgeSignature = buildQuantizedPolylineSignature([loop[i], loop[next]]);
      solid.setFaceMetadata(sideFace, {
        flatId: flat.id,
        holeId: hole.id,
        cutoutId: hole.cutoutId || null,
        edgeIndex,
        edgeSignature: edgeSignature || null,
        sheetMetal: {
          kind: "flat_cutout_wall",
          representation: "3D",
          flatId: flat.id,
          holeId: hole.id,
          cutoutId: hole.cutoutId || null,
          edgeIndex,
          edgeSignature: edgeSignature || null,
        },
      });
    }
  }

  for (const edge of flatEdges) {
    if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) continue;
    const polylineA = [];
    const polylineB = [];
    for (const point of edge.polyline) {
      const mid = makeMidplaneWorldPoint(placement.matrix, point);
      polylineA.push(quantizePoint3(mid.clone().addScaledVector(normal, halfT)));
      polylineB.push(quantizePoint3(mid.clone().addScaledVector(normal, -halfT)));
    }
    edgeCandidates.push({
      flatId: flat.id,
      edgeId: edge.id,
      bendId: edge?.bend?.id || null,
      sheetMetalEdgeType: "A",
      polyline: polylineA,
    });
    edgeCandidates.push({
      flatId: flat.id,
      edgeId: edge.id,
      bendId: edge?.bend?.id || null,
      sheetMetalEdgeType: "B",
      polyline: polylineB,
    });
  }
}

function addBendPlacementToSolid({ solid, bendPlacement, featureID, thickness, bendLookup }) {
  if (!solid || !bendPlacement?.bend) return;
  const bend = bendPlacement.bend;
  const parentEdgeWorld = Array.isArray(bendPlacement.parentEdgeWorld) ? bendPlacement.parentEdgeWorld : [];
  const childEdgeWorld = Array.isArray(bendPlacement.childEdgeWorld) ? bendPlacement.childEdgeWorld : [];
  if (parentEdgeWorld.length < 2 || childEdgeWorld.length < 2) return;

  const axis = bendPlacement.axisEnd.clone().sub(bendPlacement.axisStart);
  if (axis.lengthSq() <= EPS) return;
  const axisDir = axis.normalize();
  const axisOrigin = bendPlacement.axisStart.clone();
  const sampleCount = Math.max(2, parentEdgeWorld.length, childEdgeWorld.length);
  const parentEdge = resamplePolyline3(parentEdgeWorld, sampleCount);
  const childEdge = resamplePolyline3(childEdgeWorld, sampleCount);
  const sweepSteps = Math.max(16, Math.ceil(Math.abs(bendPlacement.angleRad) / THREE.MathUtils.degToRad(4)));
  const columns = sweepSteps + 1;
  const halfT = thickness * 0.5;

  const top = new Array(sampleCount * columns);
  const bottom = new Array(sampleCount * columns);
  const indexOf = (i, j) => i * columns + j;

  const rotateAroundAxis = (point, angleRad) => {
    const translated = point.clone().sub(axisOrigin);
    translated.applyAxisAngle(axisDir, angleRad);
    return translated.add(axisOrigin);
  };

  for (let i = 0; i < sampleCount; i += 1) {
    const parentPoint = parentEdge[i];
    const childPoint = childEdge[i];
    for (let j = 0; j <= sweepSteps; j += 1) {
      const t = j / sweepSteps;
      const angle = bendPlacement.angleRad * t;
      const mid = rotateAroundAxis(parentPoint, angle);
      const normal = bendPlacement.parentNormal.clone().applyAxisAngle(axisDir, bendPlacement.angleRad * t).normalize();
      if (j === 0) {
        mid.copy(parentPoint);
        normal.copy(bendPlacement.parentNormal);
      } else if (j === sweepSteps) {
        mid.copy(childPoint);
        normal.copy(bendPlacement.childNormal);
      }

      top[indexOf(i, j)] = quantizePoint3(mid.clone().addScaledVector(normal, halfT));
      bottom[indexOf(i, j)] = quantizePoint3(mid.clone().addScaledVector(normal, -halfT));
    }
  }

  const lookup = bendLookup.get(String(bend.id)) || {};
  const parentEdgeId = lookup?.parentEdgeId ?? null;

  const faceA = makeBendFaceName(featureID, bend.id, "A");
  const faceB = makeBendFaceName(featureID, bend.id, "B");
  const faceEndStart = makeBendFaceName(featureID, bend.id, "END:START");
  const faceEndEnd = makeBendFaceName(featureID, bend.id, "END:END");

  for (let i = 0; i < sampleCount - 1; i += 1) {
    for (let j = 0; j < sweepSteps; j += 1) {
      const ta = top[indexOf(i, j)];
      const tb = top[indexOf(i, j + 1)];
      const tc = top[indexOf(i + 1, j)];
      const td = top[indexOf(i + 1, j + 1)];
      addTriangleIfValid(solid, faceA, ta, tc, tb);
      addTriangleIfValid(solid, faceA, tb, tc, td);

      const ba = bottom[indexOf(i, j)];
      const bb = bottom[indexOf(i, j + 1)];
      const bc = bottom[indexOf(i + 1, j)];
      const bd = bottom[indexOf(i + 1, j + 1)];
      addTriangleIfValid(solid, faceB, ba, bb, bc);
      addTriangleIfValid(solid, faceB, bb, bd, bc);
    }
  }

  for (let j = 0; j < sweepSteps; j += 1) {
    const aTop0 = top[indexOf(0, j)];
    const aTop1 = top[indexOf(0, j + 1)];
    const aBot0 = bottom[indexOf(0, j)];
    const aBot1 = bottom[indexOf(0, j + 1)];
    addTriangleIfValid(solid, faceEndStart, aTop0, aTop1, aBot0);
    addTriangleIfValid(solid, faceEndStart, aTop1, aBot1, aBot0);

    const bTop0 = top[indexOf(sampleCount - 1, j)];
    const bTop1 = top[indexOf(sampleCount - 1, j + 1)];
    const bBot0 = bottom[indexOf(sampleCount - 1, j)];
    const bBot1 = bottom[indexOf(sampleCount - 1, j + 1)];
    addTriangleIfValid(solid, faceEndEnd, bTop0, bBot0, bTop1);
    addTriangleIfValid(solid, faceEndEnd, bTop1, bBot0, bBot1);
  }

  solid.setFaceMetadata(faceA, {
    bendId: bend.id,
    sheetMetalFaceType: "A",
    sheetMetal: {
      kind: "bend",
      representation: "3D",
      bendId: bend.id,
      flatId: bendPlacement.parentFlatId,
      parentFlatId: bendPlacement.parentFlatId,
      childFlatId: bendPlacement.childFlatId,
      edgeId: parentEdgeId,
      side: "A",
    },
  });
  solid.setFaceMetadata(faceB, {
    bendId: bend.id,
    sheetMetalFaceType: "B",
    sheetMetal: {
      kind: "bend",
      representation: "3D",
      bendId: bend.id,
      flatId: bendPlacement.parentFlatId,
      parentFlatId: bendPlacement.parentFlatId,
      childFlatId: bendPlacement.childFlatId,
      edgeId: parentEdgeId,
      side: "B",
    },
  });
  solid.setFaceMetadata(faceEndStart, {
    bendId: bend.id,
    sheetMetal: {
      kind: "bend_end_cap",
      representation: "3D",
      bendId: bend.id,
      end: "start",
    },
  });
  solid.setFaceMetadata(faceEndEnd, {
    bendId: bend.id,
    sheetMetal: {
      kind: "bend_end_cap",
      representation: "3D",
      bendId: bend.id,
      end: "end",
    },
  });
}

function addBendCenterlinesToSolid({ solid, bends3D, featureID }) {
  if (!solid || !Array.isArray(bends3D) || bends3D.length === 0) return;
  const usedNames = new Set();

  for (let i = 0; i < bends3D.length; i += 1) {
    const bendPlacement = bends3D[i];
    const axisStart = bendPlacement?.axisStart;
    const axisEnd = bendPlacement?.axisEnd;
    if (!axisStart?.isVector3 || !axisEnd?.isVector3) continue;
    if (axisStart.distanceToSquared(axisEnd) <= POINT_EPS * POINT_EPS) continue;

    const bendId = String(bendPlacement?.bend?.id || `bend_${i + 1}`);
    let name = `${featureID}:BEND:${bendId}:CENTERLINE`;
    let suffix = 1;
    while (usedNames.has(name)) {
      name = `${featureID}:BEND:${bendId}:CENTERLINE:${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);

    solid.addAuxEdge(name, [quantizePoint3(axisStart), quantizePoint3(axisEnd)], {
      centerline: true,
      materialKey: "OVERLAY",
      polylineWorld: false,
    });
  }
}

function sceneStyleForKey(scene, styleKey) {
  const styles = scene?.styles && typeof scene.styles === "object" ? scene.styles : {};
  if (styleKey && styles[styleKey] && typeof styles[styleKey] === "object") return styles[styleKey];
  if (styles.DEFAULT && typeof styles.DEFAULT === "object") return styles.DEFAULT;
  return {};
}

function styleColorHex(style, fallback = "#ffffff", key = "stroke") {
  const raw = style?.[key] ?? style?.stroke ?? fallback;
  const color = new THREE.Color();
  try {
    color.set(raw);
    return color.getHex();
  } catch {
    color.set(fallback);
    return color.getHex();
  }
}

function parseDashPattern(style = {}) {
  const raw = style.svgDash ?? style.dxfDashPattern ?? null;
  let values = null;
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string") {
    values = raw
      .split(/[\s,]+/)
      .map((token) => Number(token))
      .filter((num) => Number.isFinite(num));
  }
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized = values
    .map((value) => Math.abs(toFiniteNumber(value, 0)))
    .filter((value) => value > EPS);
  if (!normalized.length) return null;
  if (normalized.length === 1) return [normalized[0], normalized[0]];
  return [normalized[0], normalized[1]];
}

function lineMaterialForStyle(style, materialCache, key = "DEFAULT") {
  const cacheKey = String(key || "DEFAULT");
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const color = styleColorHex(style, "#ffffff", "stroke");
  const dash = parseDashPattern(style);
  const baseProps = {
    color,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  };
  const material = dash
    ? new THREE.LineDashedMaterial({
      ...baseProps,
      dashSize: dash[0],
      gapSize: dash[1],
    })
    : new THREE.LineBasicMaterial(baseProps);
  materialCache.set(cacheKey, material);
  return material;
}

function pointsFromEntity(entity) {
  if (!entity || typeof entity !== "object") return [];
  if (entity.type === "line") {
    const a = Array.isArray(entity.a) ? entity.a : [];
    const b = Array.isArray(entity.b) ? entity.b : [];
    return [
      new THREE.Vector3(toFiniteNumber(a[0]), toFiniteNumber(a[1]), FLAT_PATTERN_OVERLAY_Z),
      new THREE.Vector3(toFiniteNumber(b[0]), toFiniteNumber(b[1]), FLAT_PATTERN_OVERLAY_Z),
    ];
  }
  if (entity.type === "polyline") {
    const raw = Array.isArray(entity.points) ? entity.points : [];
    const points = raw.map((point) => new THREE.Vector3(
      toFiniteNumber(point?.[0]),
      toFiniteNumber(point?.[1]),
      FLAT_PATTERN_OVERLAY_Z,
    ));
    if (entity.closed && points.length > 2) points.push(points[0].clone());
    return points;
  }
  return [];
}

function textAnchorOffset(entity, width, height) {
  const anchor = String(entity?.anchor || "left").toLowerCase();
  const baseline = String(entity?.baseline || "baseline").toLowerCase();

  let ox = 0;
  if (anchor === "center" || anchor === "middle") ox = 0;
  else if (anchor === "right" || anchor === "end") ox = -width * 0.5;
  else ox = width * 0.5;

  let oy = 0;
  if (baseline === "middle" || baseline === "center") oy = 0;
  else if (baseline === "top" || baseline === "hanging") oy = -height * 0.5;
  else if (baseline === "bottom") oy = height * 0.5;
  else oy = height * 0.18;

  return [ox, oy];
}

function buildFlatPatternTextMesh(entity, style) {
  if (!entity || typeof entity !== "object") return null;
  if (typeof document === "undefined") return null;

  const value = String(entity.value || "").trim();
  if (!value) return null;

  const worldHeight = Math.max(0.05, toFiniteNumber(entity.height, 1));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.font = `bold ${FLAT_PATTERN_TEXT_FONT_PX}px ${FLAT_PATTERN_TEXT_FONT_FAMILY}`;
  const measuredWidth = Math.max(1, context.measureText(value).width);
  const padX = Math.ceil(FLAT_PATTERN_TEXT_FONT_PX * 0.35);
  const padY = Math.ceil(FLAT_PATTERN_TEXT_FONT_PX * 0.5);
  canvas.width = Math.max(64, Math.ceil(measuredWidth + padX * 2));
  canvas.height = Math.max(64, Math.ceil(FLAT_PATTERN_TEXT_FONT_PX + padY * 2));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `bold ${FLAT_PATTERN_TEXT_FONT_PX}px ${FLAT_PATTERN_TEXT_FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = new THREE.Color(styleColorHex(style, "#ffffff", "textColor")).getStyle();
  context.fillText(value, canvas.width * 0.5, canvas.height * 0.5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const worldWidth = worldHeight * (canvas.width / canvas.height);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
  mesh.renderOrder = FLAT_PATTERN_TEXT_RENDER_ORDER;

  const atX = toFiniteNumber(entity?.at?.[0], 0);
  const atY = toFiniteNumber(entity?.at?.[1], 0);
  const rotationDeg = toFiniteNumber(entity?.rotationDeg, 0);
  const rotationRad = THREE.MathUtils.degToRad(rotationDeg);
  const [offsetX, offsetY] = textAnchorOffset(entity, worldWidth, worldHeight);
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const wx = (offsetX * cos) - (offsetY * sin);
  const wy = (offsetX * sin) + (offsetY * cos);

  mesh.position.set(atX + wx, atY + wy, FLAT_PATTERN_OVERLAY_Z * 2);
  mesh.rotation.set(0, 0, rotationRad);
  mesh.userData = {
    ...(mesh.userData || {}),
    sheetMetalFlatPattern: true,
    bendLabel: true,
    style: entity?.style || null,
  };
  return mesh;
}

function addFlatPatternOverlayToGroup(group2D, tree) {
  if (!group2D || !tree) return;

  const exportData = buildFlatPatternExportData(tree);
  const scene = exportData?.scene;
  const entities = Array.isArray(scene?.entities) ? scene.entities : [];
  if (!entities.length) return;

  const overlay = new THREE.Group();
  overlay.name = "FLAT_PATTERN_OVERLAY";
  overlay.userData = {
    ...(overlay.userData || {}),
    sheetMetalFlatPattern: true,
    overlay: true,
  };

  const materialCache = new Map();
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (!entity || typeof entity !== "object") continue;

    if (entity.type === "line" || entity.type === "polyline") {
      const points = pointsFromEntity(entity);
      if (points.length < 2) continue;
      const style = sceneStyleForKey(scene, entity.style);
      const material = lineMaterialForStyle(style, materialCache, entity.style);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      if (line.material?.isLineDashedMaterial) {
        try { line.computeLineDistances(); } catch { }
      }
      line.renderOrder = FLAT_PATTERN_LINE_RENDER_ORDER;
      line.userData = {
        ...(line.userData || {}),
        sheetMetalFlatPattern: true,
        style: entity.style || null,
      };
      overlay.add(line);
      continue;
    }

    if (entity.type === "text") {
      const style = sceneStyleForKey(scene, entity.style);
      const mesh = buildFlatPatternTextMesh(entity, style);
      if (mesh) overlay.add(mesh);
    }
  }

  if (overlay.children.length) group2D.add(overlay);
}

function assignSheetMetalEdgeMetadata(solid, edgeCandidates) {
  if (!solid || !Array.isArray(edgeCandidates) || !edgeCandidates.length) return;

  let boundaries = [];
  try {
    boundaries = solid.getBoundaryEdgePolylines() || [];
  } catch {
    boundaries = [];
  }
  if (!boundaries.length) return;

  for (const boundary of boundaries) {
    if (!boundary || !boundary.name || !Array.isArray(boundary.positions) || boundary.positions.length < 2) continue;
    const polyline = boundary.positions.map((point) => [point[0], point[1], point[2]]);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of edgeCandidates) {
      const score = edgePolylineScore(polyline, candidate.polyline);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best) continue;

    const refLength = Math.max(polylineLength3(best.polyline), polylineLength3(polyline));
    const threshold = Math.max(EDGE_MATCH_EPS * 2, refLength * 1e-4);
    if (bestScore > threshold) continue;

    solid.setEdgeMetadata(boundary.name, {
      flatId: best.flatId,
      edgeId: best.edgeId,
      bendId: best.bendId || null,
      sheetMetalEdgeType: best.sheetMetalEdgeType,
      sheetMetal: {
        kind: "edge",
        representation: "3D",
        flatId: best.flatId,
        edgeId: best.edgeId,
        bendId: best.bendId || null,
        side: best.sheetMetalEdgeType,
      },
    });
  }
}

function makeSheetMetal2DGroup({ solid, model, tree, featureID, thickness, rootMatrix, showFlatPattern }) {
  if (!solid || !model || showFlatPattern === false) return null;

  const group2D = buildTwoDGroup(model.flats2D, model.bends2D, {
    showTriangulation: false,
  });
  addFlatPatternOverlayToGroup(group2D, tree);
  group2D.name = `${featureID}:2D`;
  group2D.visible = true;
  group2D.userData = {
    ...(group2D.userData || {}),
    sheetMetalFlatPattern: true,
  };

  const box3 = new THREE.Box3().setFromObject(solid);
  const box2 = new THREE.Box3().setFromObject(group2D);
  const width3 = box3.isEmpty() ? 0 : (box3.max.x - box3.min.x);
  const width2 = box2.isEmpty() ? 0 : (box2.max.x - box2.min.x);
  const offset = Math.max(10, width3 + width2 * 0.25 + toFiniteNumber(thickness, 1) * 4);

  const base = matrixFromAny(rootMatrix || new THREE.Matrix4().identity());
  const offsetMatrix = new THREE.Matrix4().makeTranslation(offset, 0, 0);
  applyMatrixToObject(group2D, base.clone().multiply(offsetMatrix));
  return group2D;
}

function installSheetMetalVisualizeHook(root, config) {
  if (!root || typeof root.visualize !== "function") return;
  if (root.__sheetMetalVisualizeHookInstalled) return;

  const baseVisualize = root.visualize.bind(root);
  root.__sheetMetalVisualizeHookInstalled = true;
  root.visualize = function visualizeWithSheetMetalOverlay(options = {}) {
    const result = baseVisualize(options);
    const pattern = makeSheetMetal2DGroup({
      solid: this,
      model: config?.model,
      tree: config?.tree,
      featureID: config?.featureID,
      thickness: config?.thickness,
      rootMatrix: config?.rootMatrix,
      showFlatPattern: config?.showFlatPattern,
    });
    if (pattern) this.add(pattern);
    SelectionState.attach(this, { deep: true });
    this.onClick = this.onClick || (() => {});
    return result;
  };
}

function buildRenderableSheetModel({ featureID, tree, rootMatrix = null, showFlatPattern = true }) {
  const model = evaluateSheetMetal(tree);
  const thickness = Math.max(MIN_THICKNESS, toFiniteNumber(tree?.thickness, 1));
  const rootTransform = rootMatrix ? matrixFromAny(rootMatrix) : new THREE.Matrix4().identity();

  const root = new Solid();
  root.name = featureID;

  const edgeCandidates = [];
  const bendLookup = buildBendLookup(tree);

  for (const placement of model.flats3D || []) {
    addFlatPlacementToSolid({
      solid: root,
      placement,
      featureID,
      thickness,
      edgeCandidates,
    });
  }

  for (const bendPlacement of model.bends3D || []) {
    addBendPlacementToSolid({
      solid: root,
      bendPlacement,
      featureID,
      thickness,
      bendLookup,
    });
  }
  addBendCenterlinesToSolid({
    solid: root,
    bends3D: model.bends3D || [],
    featureID,
  });

  if (rootMatrix) {
    root.bakeTransform(rootTransform);
    for (const candidate of edgeCandidates) {
      candidate.polyline = transformPolyline3ByMatrix(candidate.polyline, rootTransform);
    }
  }

  const cutoutApplication = applyRecordedCutoutsToSolid(root, tree);
  let outputSolid = isSolidLikeObject(cutoutApplication?.solid) ? cutoutApplication.solid : root;
  if (outputSolid !== root) {
    preserveSheetMetalFaceNames(outputSolid, root);
  }
  outputSolid.name = featureID;
  assignSheetMetalEdgeMetadata(outputSolid, edgeCandidates);

  outputSolid.userData = outputSolid.userData || {};
  outputSolid.userData.sheetMetalModel = {
    engine: ENGINE_TAG,
    featureID,
    tree: cloneTree(tree),
    rootTransform: matrixToArray(rootTransform),
    showFlatPattern: showFlatPattern !== false,
    generatedAt: Date.now(),
    geometryBaked: true,
  };
  outputSolid.userData.sheetMetal = {
    engine: ENGINE_TAG,
    featureID,
  };

  installSheetMetalVisualizeHook(outputSolid, {
    model,
    tree: cloneTree(tree),
    featureID,
    thickness,
    rootMatrix: rootTransform,
    showFlatPattern: showFlatPattern !== false,
  });

  SelectionState.attach(outputSolid);
  outputSolid.onClick = outputSolid.onClick || (() => {});

  return { root: outputSolid, evaluated: model, cutoutSummary: cutoutApplication?.summary || null };
}

function summarizeEvaluatedModel(evaluated) {
  return {
    flatCount3D: Array.isArray(evaluated?.flats3D) ? evaluated.flats3D.length : 0,
    flatCount2D: Array.isArray(evaluated?.flats2D) ? evaluated.flats2D.length : 0,
    bendCount3D: Array.isArray(evaluated?.bends3D) ? evaluated.bends3D.length : 0,
    bendCount2D: Array.isArray(evaluated?.bends2D) ? evaluated.bends2D.length : 0,
  };
}

function basePersistentPayload(instance) {
  return {
    ...(instance?.persistentData || {}),
    sheetMetal: {
      engine: ENGINE_TAG,
      feature: instance?.constructor?.shortName || instance?.constructor?.name || "SheetMetal",
      featureID: featureIdFromInstance(instance),
      status: "ok",
    },
  };
}

function dedupeObjects(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = item.uuid || item.id || item.name || item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function runSheetMetalTab(instance) {
  const featureID = featureIdFromInstance(instance, "SM_TAB");
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(instance?.inputParams?.thickness, 1)));
  const bendRadius = Math.max(MIN_LEG, toFiniteNumber(instance?.inputParams?.bendRadius, thickness * 0.5));
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, 0.5), 0, 1);
  const placementMode = String(instance?.inputParams?.placementMode || "forward").toLowerCase();

  const profileSelections = normalizeSelectionArray(instance?.inputParams?.profile);
  const faceObj = resolveProfileFace(profileSelections[0] || null);

  if (!faceObj) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_profile",
        message: "Select a sketch or face profile to build a sheet metal tab.",
      },
    };
    return { added: [], removed: [] };
  }

  const built = buildFlatFromFace(faceObj, featureID, "Tab Root");
  if (!built) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Unable to derive a closed flat outline from the selected profile.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = { thickness, root: built.flat };
  const meta = ensureSheetMeta(tree);
  meta.baseType = "TAB";
  meta.defaultInsideRadius = bendRadius;
  meta.defaultKFactor = kFactor;
  meta.lastFeatureID = featureID;

  const rootMatrix = built.frame.matrix.clone();
  const placementOffset = (() => {
    if (placementMode === "reverse") return -thickness * 0.5;
    if (placementMode === "midplane") return 0;
    return thickness * 0.5;
  })();
  const pos = built.frame.origin.clone().addScaledVector(built.frame.normal, placementOffset);
  rootMatrix.setPosition(pos);

  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });

  const removed = [];
  if (instance?.inputParams?.consumeProfileSketch !== false) {
    removed.push(...collectSketchParents(profileSelections));
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects(removed) };
}

export function runSheetMetalContourFlange(instance) {
  const featureID = featureIdFromInstance(instance, "SM_CF");
  const pathSelections = normalizeSelectionArray(instance?.inputParams?.path);
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(instance?.inputParams?.thickness, 1)));
  const distance = toFiniteNumber(instance?.inputParams?.distance, 20);
  const reverseSheetSide = !!instance?.inputParams?.reverseSheetSide;
  const bendRadius = Math.max(0, toFiniteNumber(instance?.inputParams?.bendRadius, thickness * 0.5));
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, 0.5), 0, 1);

  const built = buildContourFlangeFromPath(pathSelections, featureID, {
    distance,
    thickness,
    bendRadius,
    kFactor,
    reverseSheetSide,
  });
  if (!built) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_path",
        message: "Select connected sketch edges (or an edge chain) for contour flange.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = built.tree;
  const meta = ensureSheetMeta(tree);
  meta.baseType = "CONTOUR_FLANGE";
  meta.defaultInsideRadius = built.insideRadius;
  meta.defaultKFactor = built.kFactor;
  meta.lastFeatureID = featureID;

  const rootMatrix = built.frame.matrix.clone();
  // The contour tree is built from midplane-segment data anchored at local origin.
  // Re-apply the midplane path start offset so the solved body lands on the sketch edge.
  const midplaneStart = Array.isArray(built.path2?.[0]) ? built.path2[0] : [0, 0];
  const rootOrigin = built.frame.origin
    .clone()
    .addScaledVector(built.frame.xAxis, toFiniteNumber(midplaneStart[0], 0))
    .addScaledVector(built.frame.zAxis, toFiniteNumber(midplaneStart[1], 0));
  rootMatrix.setPosition(rootOrigin);

  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });

  const removed = [];
  if (instance?.inputParams?.consumePathSketch !== false) {
    removed.push(...collectSketchParents(pathSelections));
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      contourSummary: {
        segmentCount: built.segments.length,
        bendCount: built.bends.length,
        wallHeight: built.height,
      },
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects(removed) };
}

export function runSheetMetalFlange(instance, options = {}) {
  const featureID = featureIdFromInstance(instance, "SM_FLANGE");
  const selections = normalizeSelectionArray(instance?.inputParams?.faces);
  const source = resolveSheetSourceFromSelections(selections);

  if (!source) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_source",
        message: "Select edge overlays from an existing sheet metal model.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = cloneTree(source.tree);
  const meta = ensureSheetMeta(tree);
  const thickness = Math.max(MIN_THICKNESS, toFiniteNumber(tree?.thickness, 1));

  const defaultInsideRadius = toFiniteNumber(
    options.defaultInsideRadius,
    toFiniteNumber(meta.defaultInsideRadius, thickness * 0.5)
  );
  const requestedInsideRadius = toFiniteNumber(instance?.inputParams?.bendRadius, defaultInsideRadius);
  const resolvedInsideRadius = requestedInsideRadius <= 0 ? defaultInsideRadius : requestedInsideRadius;
  const insideRadius = Math.max(MIN_LEG, toFiniteNumber(resolvedInsideRadius, defaultInsideRadius));
  const midRadius = Math.max(MIN_LEG, insideRadius + thickness * 0.5);

  const defaultKFactor = clamp(toFiniteNumber(meta.defaultKFactor, 0.5), 0, 1);
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, defaultKFactor), 0, 1);

  const explicitAngle = options.angleDeg != null
    ? toFiniteNumber(options.angleDeg, 90)
    : toFiniteNumber(instance?.inputParams?.angle, 90);
  let angleDeg = Math.max(0, Math.abs(explicitAngle));
  if (!options.lockAngleToAbsolute && instance?.inputParams?.useOppositeCenterline) {
    angleDeg *= -1;
  }

  const legLengthRaw = Math.max(MIN_LEG, toFiniteNumber(instance?.inputParams?.flangeLength, options.defaultLegLength ?? 10));
  const legLengthReference = normalizeFlangeLengthReference(
    options?.flangeLengthReference != null
      ? options.flangeLengthReference
      : instance?.inputParams?.flangeLengthReference
  );
  const legLengthReferenceSetback = computeFlangeLengthReferenceSetback({
    lengthReference: legLengthReference,
    insideRadius,
    thickness,
    angleDeg,
  });
  const legLength = Math.max(MIN_LEG, legLengthRaw - legLengthReferenceSetback);
  const insetMode = normalizeFlangeInsetMode(instance?.inputParams?.inset);
  const offset = toFiniteNumber(instance?.inputParams?.offset, 0);

  const targets = resolveEdgeTargets(selections, tree, source.carrier);
  const flangeSummary = addFlangesToTree(tree, featureID, targets, {
    angleDeg,
    midRadius,
    kFactor,
    legLength,
    requestedLegLength: legLengthRaw,
    legLengthReference,
    legLengthReferenceSetback,
    insideRadius,
    thickness,
    insetMode,
    offset,
  });

  if (flangeSummary.applied === 0) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_targets",
        message: "No eligible sheet-metal edges selected for flange creation.",
        targets: flangeSummary,
      },
    };
    return { added: [], removed: [] };
  }

  meta.defaultInsideRadius = insideRadius;
  meta.defaultKFactor = kFactor;
  meta.defaultFlangeLengthReference = legLengthReference;
  meta.defaultInsetMode = insetMode;
  meta.lastFeatureID = featureID;
  meta.baseType = options.baseType || "FLANGE";

  const rootMatrix = source.rootMatrix || matrixFromAny(source.carrier?.userData?.sheetMetalModel?.rootTransform);
  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });
  preserveSheetMetalFaceNames(root, source.carrier);
  if (source?.carrier && typeof source.carrier.name === "string") {
    root.name = source.carrier.name;
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      flangeSummary,
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects([source.carrier]) };
}

export function runSheetMetalCutout(instance) {
  const featureID = featureIdFromInstance(instance, "SM_CUTOUT");
  const sheetSelections = normalizeSelectionArray(instance?.inputParams?.sheet);
  const profileSelections = normalizeSelectionArray(instance?.inputParams?.profile);
  const sourceResolution = resolveSheetSourceWithFallback(sheetSelections, profileSelections);
  const source = sourceResolution?.source || null;

  if (!source) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_source",
        message: "Select a sheet-metal target (or provide a profile near an existing sheet-metal model).",
        sourceResolution: sourceResolution?.resolution || "unresolved",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = cloneTree(source.tree);
  const meta = ensureSheetMeta(tree);
  if (!Array.isArray(meta.cutouts)) meta.cutouts = [];

  const forwardDistance = Math.max(0, toFiniteNumber(instance?.inputParams?.forwardDistance, 1));
  const backDistance = Math.max(0, toFiniteNumber(instance?.inputParams?.backDistance, 0));
  const cutterBuild = buildCutoutCutterFromProfile(profileSelections, featureID, {
    forwardDistance,
    backDistance,
  });
  if (!cutterBuild?.cutter) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Select a valid cutout profile (solid/face/sketch) with non-zero cut depth.",
        reason: cutterBuild?.reason || "invalid_profile",
      },
    };
    return { added: [], removed: [] };
  }

  const cutter = cutterBuild.cutter;
  if (cutterBuild?.sourceType === "solid" && cutterBuild?.profileSolid && cutterBuild.profileSolid === source.carrier) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Cutout profile solid cannot be the same as the target sheet-metal solid.",
        reason: "profile_matches_target",
      },
    };
    return { added: [], removed: [] };
  }

  const rootMatrix = source.rootMatrix || matrixFromAny(source.carrier?.userData?.sheetMetalModel?.rootTransform);
  const profileLoopData = collectCutoutProfileLoops(profileSelections, featureID);
  const treeCutSummary = applyCutoutLoopsToTree({
    tree,
    featureID,
    profileLoops3: profileLoopData.loops,
    rootMatrix,
  });
  const midplaneApplied = treeCutSummary.applied > 0;
  const allowBooleanFallback = String(cutterBuild?.sourceType || "").toLowerCase() === "solid";
  if (!midplaneApplied && !allowBooleanFallback) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "mapping_failed",
        message: "Cutout profile could not be mapped onto a sheet-metal flat in the midplane tree.",
        treeCutSummary,
      },
    };
    return { added: [], removed: [] };
  }
  const mode = midplaneApplied ? "midplane_tree" : "legacy_boolean";

  let cutterSnapshot = null;
  if (!midplaneApplied) {
    cutterSnapshot = serializeSolidSnapshot(cutter);
    if (!cutterSnapshot) {
      instance.persistentData = {
        ...basePersistentPayload(instance),
        sheetMetal: {
          ...basePersistentPayload(instance).sheetMetal,
          status: "invalid_cutter",
          message: "Failed to build a valid cutter solid from the selected profile.",
        },
      };
      return { added: [], removed: [] };
    }
  }

  const profileNames = profileSelections
    .map((item) => item?.name || item?.userData?.faceName || item?.userData?.edgeName || null)
    .filter(Boolean);

  const existingCutoutIndex = meta.cutouts.findIndex((entry) => String(entry?.id || "") === featureID);
  if (existingCutoutIndex >= 0) meta.cutouts.splice(existingCutoutIndex, 1);
  const cutoutEntry = {
    id: featureID,
    mode,
    sourceType: cutterBuild?.sourceType || profileLoopData?.sourceType || null,
    profileNames,
    profileLoopCount: Array.isArray(profileLoopData?.loops) ? profileLoopData.loops.length : 0,
    mappedLoopCount: treeCutSummary.applied,
    mappedLoops: Array.isArray(treeCutSummary.assignments) ? treeCutSummary.assignments : [],
    skippedLoops: Array.isArray(treeCutSummary.skippedLoops) ? treeCutSummary.skippedLoops : [],
    forwardDistance,
    backDistance,
    keepTool: !!instance?.inputParams?.keepTool,
    debugCutter: !!instance?.inputParams?.debugCutter,
    recordedAt: Date.now(),
  };
  if (!midplaneApplied && cutterSnapshot) {
    cutoutEntry.cutterSnapshot = cutterSnapshot;
  }
  meta.cutouts.push(cutoutEntry);

  meta.lastFeatureID = featureID;

  const { root, evaluated, cutoutSummary } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });
  preserveSheetMetalFaceNames(root, source.carrier);
  if (source?.carrier && typeof source.carrier.name === "string") {
    root.name = source.carrier.name;
  }

  const removed = [source.carrier];
  if (instance?.inputParams?.consumeProfileSketch !== false) {
    removed.push(...collectSketchParents(profileSelections));
  }
  const added = [root];
  if (instance?.inputParams?.keepTool || instance?.inputParams?.debugCutter) {
    cutter.name = `${featureID}:CUTTER`;
    cutter.userData = {
      ...(cutter.userData || {}),
      sheetMetalCutoutTool: true,
      featureID,
    };
    added.push(cutter);
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      cutoutSummary: {
        mode,
        tree: treeCutSummary,
        boolean: cutoutSummary,
      },
      sourceResolution: sourceResolution?.resolution || "explicit_sheet",
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: dedupeObjects(added), removed: dedupeObjects(removed) };
}

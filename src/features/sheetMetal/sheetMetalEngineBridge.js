import * as THREE from "three";
import { SelectionState } from "../../UI/SelectionState.js";
import { Solid } from "../../BREP/BetterSolid.js";
import { deepClone } from "../../utils/deepClone.js";
import { buildTwoDGroup, evaluateSheetMetal } from "./engine/index.js";

const EPS = 1e-8;
const POINT_EPS = 1e-4;
const MIN_THICKNESS = 1e-4;
const MIN_LEG = 1e-3;
const ENGINE_TAG = "sheet-metal-core";
const TRIANGLE_AREA_EPS = 1e-14;
const COORD_QUANT = 1e-7;
const EDGE_MATCH_EPS = 1e-3;
const OVERLAP_RELIEF_GAP = .0001;

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

function findBestMatchAtTail(entries, tailPoint) {
  let best = null;
  for (let i = 0; i < entries.length; i += 1) {
    const candidate = entries[i];
    const start = candidate.polyline[0];
    const end = candidate.polyline[candidate.polyline.length - 1];
    const startDist = start.distanceToSquared(tailPoint);
    const endDist = end.distanceToSquared(tailPoint);

    if (startDist <= POINT_EPS * POINT_EPS) {
      if (!best || startDist < best.distance) {
        best = { index: i, reverse: false, distance: startDist };
      }
    }
    if (endDist <= POINT_EPS * POINT_EPS) {
      if (!best || endDist < best.distance) {
        best = { index: i, reverse: true, distance: endDist };
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
    const tail = ordered[ordered.length - 1].polyline[ordered[ordered.length - 1].polyline.length - 1];
    const match = findBestMatchAtTail(remaining, tail);
    if (!match) break;

    const [picked] = remaining.splice(match.index, 1);
    if (match.reverse) picked.polyline.reverse();
    ordered.push(picked);
  }

  return ordered;
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
  const edgeEntries = readFaceEdgePolylines(faceObj);
  if (!edgeEntries.length) return null;

  const ordered = orderConnectedEntries(edgeEntries);
  const outline3 = buildOutlineFromOrderedEntries(ordered);
  if (outline3.length < 3) return null;

  const normalHint = (typeof faceObj?.getAverageNormal === "function")
    ? faceObj.getAverageNormal()
    : null;
  const frame = buildProfileFrame(outline3, normalHint);
  if (!frame) return null;

  let outline2 = outline3.map((point) => projectPointToFrame(point, frame));
  outline2 = dedupeConsecutivePoints2(outline2);
  if (outline2.length < 3) return null;

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

  return { flat, frame };
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
  const points = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const polyline = ordered[i].polyline;
    if (!Array.isArray(polyline) || polyline.length < 2) continue;

    if (i > 0) {
      const prevLast = points[points.length - 1];
      const currentFirst = polyline[0];
      if (!prevLast || !isSamePoint3(prevLast, currentFirst)) {
        break;
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

function offsetPath2D(path2, offset) {
  const out = [];
  if (!Array.isArray(path2) || path2.length < 2) return out;

  for (let i = 0; i < path2.length; i += 1) {
    const current = path2[i];
    let nx = 0;
    let ny = 0;
    let contributions = 0;

    if (i > 0) {
      const prev = path2[i - 1];
      const dx = current[0] - prev[0];
      const dy = current[1] - prev[1];
      const len = Math.hypot(dx, dy);
      if (len > EPS) {
        nx += -dy / len;
        ny += dx / len;
        contributions += 1;
      }
    }

    if (i < path2.length - 1) {
      const next = path2[i + 1];
      const dx = next[0] - current[0];
      const dy = next[1] - current[1];
      const len = Math.hypot(dx, dy);
      if (len > EPS) {
        nx += -dy / len;
        ny += dx / len;
        contributions += 1;
      }
    }

    if (contributions === 0 || Math.hypot(nx, ny) <= EPS) {
      out.push([current[0], current[1]]);
      continue;
    }

    const inv = 1 / Math.hypot(nx, ny);
    out.push([current[0] + nx * inv * offset, current[1] + ny * inv * offset]);
  }

  return out;
}

function buildFlatFromPath(pathSelections, featureID, distance, reverseSheetSide = false) {
  const path3 = buildPathPolylineFromSelections(pathSelections);
  if (!path3 || path3.length < 2) return null;

  const frame = buildProfileFrame(path3, null);
  if (!frame) return null;

  let path2 = path3.map((point) => projectPointToFrame(point, frame));
  path2 = dedupeConsecutivePoints2(path2);
  if (path2.length < 2) return null;

  const width = Math.max(MIN_LEG, Math.abs(toFiniteNumber(distance, 0)));
  const sign = reverseSheetSide ? -1 : 1;
  const shifted = offsetPath2D(path2, sign * width);
  if (shifted.length !== path2.length || shifted.length < 2) return null;

  let outline2 = [...path2, ...shifted.slice().reverse()];
  outline2 = dedupeConsecutivePoints2(outline2);
  if (outline2.length < 3) return null;

  if (signedArea2D(outline2) < 0) outline2 = outline2.slice().reverse();

  const flatId = `${featureID}:flat_root`;
  const edges = buildFlatEdgesFromOutline(outline2, flatId);
  if (edges.length < 3) return null;

  const flat = {
    kind: "flat",
    id: flatId,
    label: "Contour Flange",
    color: colorFromString(flatId),
    outline: outline2,
    edges,
  };

  return { flat, frame };
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
  const startNeedsReliefJog = trimStartAdjacent && prevProtected;
  const endNeedsReliefJog = trimEndAdjacent && nextProtected;

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

  const filteredDefs = edgeDefs.filter((entry) => segmentLength2(entry.a, entry.b) > POINT_EPS);
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
        newEdges.push({ ...matchedEdge, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] });
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

function resolveSheetSourceFromSelections(selections) {
  const list = normalizeSelectionArray(selections);
  for (const item of list) {
    const carrier = resolveCarrierFromObject(item);
    if (!carrier) continue;

    const tree = carrier.userData?.sheetMetalModel?.tree;
    if (!tree || typeof tree !== "object") continue;

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

  const contour = flat.outline.map((point) => new THREE.Vector2(point[0], point[1]));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!triangles.length) return;

  const halfT = thickness * 0.5;
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(placement.matrix).normalize();
  const topPoints = [];
  const bottomPoints = [];

  for (const point of flat.outline) {
    const mid = makeMidplaneWorldPoint(placement.matrix, point);
    const top = mid.clone().addScaledVector(normal, halfT);
    const bottom = mid.clone().addScaledVector(normal, -halfT);
    topPoints.push(quantizePoint3(top));
    bottomPoints.push(quantizePoint3(bottom));
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
  for (let i = 0; i < flat.outline.length; i += 1) {
    const next = (i + 1) % flat.outline.length;
    const signature = buildQuantizedPolylineSignature([flat.outline[i], flat.outline[next]]);
    const mappedEdge = edgeIndex.get(signature) || flatEdges[i] || null;
    if (mappedEdge?.bend || mappedEdge?.isAttachEdge) continue;

    const edgeId = mappedEdge?.id || `${flat.id}:edge_${i + 1}`;
    const sideFace = makeFlatFaceName(featureID, flat.id, `SIDE:${edgeId}`);
    addTriangleIfValid(solid, sideFace, topPoints[i], bottomPoints[i], topPoints[next]);
    addTriangleIfValid(solid, sideFace, topPoints[next], bottomPoints[i], bottomPoints[next]);
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

function buildFlatPatternBendCenterlinePoints(bend2D) {
  const edgeWorld = Array.isArray(bend2D?.edgeWorld) ? bend2D.edgeWorld : [];
  if (edgeWorld.length < 2) return [];

  const allowance = Math.max(0, toFiniteNumber(bend2D?.allowance, 0));
  const shiftRaw = Array.isArray(bend2D?.shiftDir) ? bend2D.shiftDir : [0, 0];
  const shift = new THREE.Vector3(toFiniteNumber(shiftRaw[0]), toFiniteNumber(shiftRaw[1]), 0);
  const shiftLen = shift.length();
  if (!(shiftLen > EPS)) return [];

  shift.multiplyScalar((allowance * 0.5) / shiftLen);
  const out = [];
  for (const point of edgeWorld) {
    if (!point?.isVector3) continue;
    out.push(point.clone().add(shift));
  }
  return out.length >= 2 ? out : [];
}

function addBendCenterlinesToFlatPatternGroup(group2D, bends2D) {
  if (!group2D || !Array.isArray(bends2D) || bends2D.length === 0) return;
  const material = new THREE.LineBasicMaterial({
    color: 0xffe27a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });

  for (let i = 0; i < bends2D.length; i += 1) {
    const bendPlacement = bends2D[i];
    const points = buildFlatPatternBendCenterlinePoints(bendPlacement);
    if (points.length < 2) continue;

    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    line.renderOrder = 30;
    line.name = `${bendPlacement?.bend?.id || `bend_${i + 1}`}:CENTERLINE`;
    line.userData = {
      ...(line.userData || {}),
      sheetMetalFlatPattern: true,
      centerline: true,
      sheetMetal: {
        kind: "bend_centerline",
        representation: "2D",
        bendId: bendPlacement?.bend?.id || null,
        parentFlatId: bendPlacement?.parentFlatId || null,
        childFlatId: bendPlacement?.childFlatId || null,
      },
    };
    group2D.add(line);
  }
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

function makeSheetMetal2DGroup({ solid, model, featureID, thickness, rootMatrix, showFlatPattern }) {
  if (!solid || !model || showFlatPattern === false) return null;

  const group2D = buildTwoDGroup(model.flats2D, model.bends2D, {
    showTriangulation: false,
  });
  addBendCenterlinesToFlatPatternGroup(group2D, model.bends2D);
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

  assignSheetMetalEdgeMetadata(root, edgeCandidates);

  root.userData = root.userData || {};
  root.userData.sheetMetalModel = {
    engine: ENGINE_TAG,
    featureID,
    tree: cloneTree(tree),
    rootTransform: matrixToArray(rootTransform),
    showFlatPattern: showFlatPattern !== false,
    generatedAt: Date.now(),
    geometryBaked: true,
  };
  root.userData.sheetMetal = {
    engine: ENGINE_TAG,
    featureID,
  };

  installSheetMetalVisualizeHook(root, {
    model,
    featureID,
    thickness,
    rootMatrix: rootTransform,
    showFlatPattern: showFlatPattern !== false,
  });

  SelectionState.attach(root);
  root.onClick = root.onClick || (() => {});

  return { root, evaluated: model };
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
  const bendRadius = Math.max(MIN_LEG, toFiniteNumber(instance?.inputParams?.bendRadius, thickness * 0.5));
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, 0.5), 0, 1);

  const built = buildFlatFromPath(pathSelections, featureID, distance, reverseSheetSide);
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

  const tree = { thickness, root: built.flat };
  const meta = ensureSheetMeta(tree);
  meta.baseType = "CONTOUR_FLANGE";
  meta.defaultInsideRadius = bendRadius;
  meta.defaultKFactor = kFactor;
  meta.lastFeatureID = featureID;

  const rootMatrix = built.frame.matrix.clone();
  rootMatrix.setPosition(
    built.frame.origin.clone().addScaledVector(built.frame.normal, reverseSheetSide ? -thickness * 0.5 : thickness * 0.5)
  );

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
  const legLengthReference = normalizeFlangeLengthReference(instance?.inputParams?.flangeLengthReference);
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
  const source = resolveSheetSourceFromSelections(sheetSelections.length ? sheetSelections : profileSelections);

  if (!source) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_source",
        message: "Select a sheet-metal model to register cutout intent.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = cloneTree(source.tree);
  const meta = ensureSheetMeta(tree);
  if (!Array.isArray(meta.cutouts)) meta.cutouts = [];

  const profileNames = profileSelections
    .map((item) => item?.name || item?.userData?.faceName || item?.userData?.edgeName || null)
    .filter(Boolean);

  meta.cutouts.push({
    id: featureID,
    profileNames,
    forwardDistance: Math.max(0, toFiniteNumber(instance?.inputParams?.forwardDistance, 1)),
    backDistance: Math.max(0, toFiniteNumber(instance?.inputParams?.backDistance, 0)),
    keepTool: !!instance?.inputParams?.keepTool,
    debugCutter: !!instance?.inputParams?.debugCutter,
    recordedAt: Date.now(),
  });

  meta.lastFeatureID = featureID;

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

  const removed = [source.carrier];
  if (instance?.inputParams?.consumeProfileSketch !== false) {
    removed.push(...collectSketchParents(profileSelections));
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "cutout_recorded",
      message: "Cutout intent was recorded on the sheet-metal model metadata.",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects(removed) };
}

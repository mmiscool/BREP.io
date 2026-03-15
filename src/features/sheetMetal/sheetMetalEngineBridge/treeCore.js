import { POINT_EPS, toFiniteNumber } from "./shared.js";
import { collectFlatHoleLoops } from "./cutoutTree.js";

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

function buildQuantizedPolylineSignature(polyline, precision = 5) {
  if (!Array.isArray(polyline) || polyline.length < 2) return null;
  const fmt = (value) => Number(value).toFixed(precision);
  const encode = (points) => points.map((point) => `${fmt(point[0])},${fmt(point[1])}`).join(";");
  const forward = encode(polyline);
  const reverse = encode(polyline.slice().reverse());
  return forward < reverse ? forward : reverse;
}

function segmentSignature2(a, b) {
  return buildQuantizedPolylineSignature([[toFiniteNumber(a[0]), toFiniteNumber(a[1])], [toFiniteNumber(b[0]), toFiniteNumber(b[1])]]);
}

function makeHoleSegmentEdgeId(flatId, holeId, edgeIndex) {
  const safeFlatId = String(flatId || "flat");
  const safeHoleId = String(holeId || "hole");
  const safeIndex = Math.max(1, toFiniteNumber(edgeIndex, 1) | 0);
  return `${safeFlatId}:hole:${safeHoleId}:edge:${safeIndex}`;
}

function findHoleSegmentByEdgeId(flat, edgeId) {
  if (!flat || !edgeId) return null;
  const target = String(edgeId);
  const holes = collectFlatHoleLoops(flat);
  for (const hole of holes) {
    const loop = hole?.loop;
    if (!Array.isArray(loop) || loop.length < 2) continue;
    for (let i = 0; i < loop.length; i += 1) {
      const next = (i + 1) % loop.length;
      const candidateId = makeHoleSegmentEdgeId(flat?.id, hole?.id, i + 1);
      if (candidateId !== target) continue;
      return {
        holeId: hole.id,
        edgeIndex: i + 1,
        a: copyPoint2(loop[i]),
        b: copyPoint2(loop[next]),
        edgeSignature: segmentSignature2(loop[i], loop[next]),
      };
    }
  }
  return null;
}

function ensureFlatEdgeForHoleSegment(flat, edgeId, usedIds = null) {
  if (!flat || !edgeId) return null;
  const existing = findEdgeById(flat, edgeId);
  if (existing) return existing;

  const segment = findHoleSegmentByEdgeId(flat, edgeId);
  if (!segment) return null;

  const newEdge = {
    id: String(edgeId),
    polyline: [segment.a, segment.b],
    isInternalCutoutEdge: true,
    holeId: segment.holeId,
    holeEdgeIndex: segment.edgeIndex,
    holeEdgeSignature: segment.edgeSignature || null,
  };
  const edges = Array.isArray(flat.edges) ? flat.edges.slice() : [];
  edges.push(newEdge);
  flat.edges = edges;
  if (usedIds && typeof usedIds.add === "function") usedIds.add(String(edgeId));
  return newEdge;
}

function isInternalCutoutLikeEdge(edge) {
  if (!edge || typeof edge !== "object") return false;
  if (edge.isInternalCutoutEdge) return true;
  if (edge.holeId != null || edge.holeEdgeIndex != null || edge.holeEdgeSignature != null) return true;
  return String(edge.id || "").includes(":hole:");
}

function cloneFlatEdge(edge) {
  if (!edge || typeof edge !== "object") return edge;
  const polyline = Array.isArray(edge.polyline)
    ? edge.polyline.map((point) => copyPoint2(point))
    : edge.polyline;
  return {
    ...edge,
    polyline,
  };
}

function carryOverInternalCutoutEdges(oldEdges, rebuiltEdges) {
  const out = [];
  const existingIds = new Set();
  for (const edge of Array.isArray(rebuiltEdges) ? rebuiltEdges : []) {
    if (!edge || edge.id == null) continue;
    existingIds.add(String(edge.id));
  }
  for (const edge of Array.isArray(oldEdges) ? oldEdges : []) {
    if (!isInternalCutoutLikeEdge(edge)) continue;
    const id = edge?.id != null ? String(edge.id) : null;
    if (!id || existingIds.has(id)) continue;
    out.push(cloneFlatEdge(edge));
    existingIds.add(id);
  }
  return out;
}

function findBestMatchingSegmentIndex(loop, edgePolyline) {
  if (!Array.isArray(loop) || loop.length < 2) return null;
  const polyline = Array.isArray(edgePolyline) ? edgePolyline : [];
  if (polyline.length < 2) return null;
  const edgeStart = polyline[0];
  const edgeEnd = polyline[polyline.length - 1];
  let bestIndex = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestLen = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const segLen = segmentLength2(a, b);
    const forward = pointDistance2(edgeStart, a) + pointDistance2(edgeEnd, b);
    const reverse = pointDistance2(edgeStart, b) + pointDistance2(edgeEnd, a);
    const score = Math.min(forward, reverse);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
      bestLen = segLen;
    }
  }
  const tol = Math.max(POINT_EPS * 4, bestLen * 1e-3);
  return (bestIndex != null && bestScore <= tol) ? bestIndex : null;
}

export {
  carryOverInternalCutoutEdges,
  cloneFlatEdge,
  collectTreeIds,
  copyPoint2,
  ensureFlatEdgeForHoleSegment,
  ensureSheetMeta,
  findBestMatchingSegmentIndex,
  findEdgeById,
  findFlatById,
  findHoleSegmentByEdgeId,
  isInternalCutoutLikeEdge,
  makeHoleSegmentEdgeId,
  pointDistance2,
  segmentLength2,
  segmentSignature2,
  uniqueId,
};

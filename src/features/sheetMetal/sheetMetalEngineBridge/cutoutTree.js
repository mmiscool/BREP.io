import Tess2 from "tess2";
import * as THREE from "three";
import { evaluateSheetMetal } from "../engine/index.js";
import {
  EPS,
  MIN_THICKNESS,
  POINT_EPS,
  isSolidLikeObject,
  legacyBooleanCutoutGroupKey,
  matrixFromAny,
  sanitizeFaceNameToken,
  stableStringHash32,
  toFiniteNumber,
} from "./shared.js";
import {
  carryOverInternalCutoutEdges,
  collectTreeIds,
  copyPoint2,
  findEdgeById,
  isInternalCutoutLikeEdge,
  pointDistance2,
  segmentLength2,
  segmentSignature2,
  uniqueId,
} from "./treeCore.js";

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

function buildQuantizedPolylineSignature(polyline, precision = 5) {
  if (!Array.isArray(polyline) || polyline.length < 2) return null;
  const fmt = (value) => Number(value).toFixed(precision);
  const encode = (points) => points.map((point) => `${fmt(point[0])},${fmt(point[1])}`).join(";");
  const forward = encode(polyline);
  const reverse = encode(polyline.slice().reverse());
  return forward < reverse ? forward : reverse;
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

function simplifyCollinearPolyline2(polyline, tol = POINT_EPS * 4) {
  let points = dedupeConsecutivePoints2(
    (Array.isArray(polyline) ? polyline : []).map((point) => [toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1])]),
  );
  if (points.length < 3) return points;

  const safeTol = Math.max(POINT_EPS, Math.abs(toFiniteNumber(tol, POINT_EPS * 4)));
  let changed = true;
  let guard = 0;
  while (changed && points.length >= 3 && guard < 64) {
    changed = false;
    guard += 1;
    const next = [copyPoint2(points[0])];
    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = next[next.length - 1];
      const curr = points[i];
      const after = points[i + 1];
      const lenA = segmentLength2(prev, curr);
      const lenB = segmentLength2(curr, after);
      if (!(lenA > POINT_EPS) || !(lenB > POINT_EPS)) {
        changed = true;
        continue;
      }
      const lineTol = Math.max(safeTol, Math.min(lenA, lenB) * 1e-4);
      if (pointOnSegment2(curr, prev, after, lineTol)) {
        changed = true;
        continue;
      }
      next.push(copyPoint2(curr));
    }
    next.push(copyPoint2(points[points.length - 1]));
    points = dedupeConsecutivePoints2(next);
  }
  return points;
}

function polylineIsLinear2(polyline, tol = POINT_EPS * 4) {
  const points = dedupeConsecutivePoints2(Array.isArray(polyline) ? polyline : []);
  if (points.length < 2) return false;
  const a = points[0];
  const b = points[points.length - 1];
  if (!(segmentLength2(a, b) > POINT_EPS)) return false;
  for (let i = 1; i < points.length - 1; i += 1) {
    if (!pointOnSegment2(points[i], a, b, tol)) return false;
  }
  return true;
}

function injectOutlineVerticesIntoLinearEdge(flat, edge) {
  if (!flat || !edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) return;
  if (!polylineIsLinear2(edge.polyline)) return;

  const outline = normalizeLoop2(flat.outline);
  if (outline.length < 3) return;

  const start = copyPoint2(edge.polyline[0]);
  const end = copyPoint2(edge.polyline[edge.polyline.length - 1]);
  const segLen = segmentLength2(start, end);
  if (!(segLen > POINT_EPS)) return;

  const endpointMatchTol = Math.max(POINT_EPS * 4, segLen * 1e-6);
  const closestOutlineIndex = (target) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < outline.length; i += 1) {
      const d = pointDistance2(outline[i], target);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    return { index: bestIndex, distance: bestDistance };
  };

  const startMatch = closestOutlineIndex(start);
  const endMatch = closestOutlineIndex(end);
  if (startMatch.index < 0 || endMatch.index < 0) return;
  if (startMatch.distance > endpointMatchTol || endMatch.distance > endpointMatchTol) return;

  const collectPath = (from, to, step) => {
    const path = [];
    let index = from;
    let guard = 0;
    const n = outline.length;
    while (guard <= n) {
      path.push(copyPoint2(outline[index]));
      if (index === to) break;
      index = (index + step + n) % n;
      guard += 1;
    }
    return path;
  };

  const forwardPath = collectPath(startMatch.index, endMatch.index, 1);
  const reversePath = collectPath(startMatch.index, endMatch.index, -1);
  const bestPath = polylineLength2D(forwardPath) <= polylineLength2D(reversePath) ? forwardPath : reversePath;
  if (bestPath.length <= 2) return;

  const lineTol = Math.max(POINT_EPS * 2, segLen * 1e-6);
  const interior = [];
  for (let i = 1; i < bestPath.length - 1; i += 1) {
    const point = bestPath[i];
    if (!pointOnSegment2(point, start, end, lineTol)) return;
    interior.push(copyPoint2(point));
  }
  if (!interior.length) return;

  edge.polyline = [start, ...interior, end];
}

function restoreFlatEdgeBoundaryVertices(flat) {
  if (!flat || typeof flat !== "object") return;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    injectOutlineVerticesIntoLinearEdge(flat, edge);
    const bend = edge?.bend;
    const children = Array.isArray(bend?.children) ? bend.children : [];
    for (const child of children) {
      if (child?.flat) restoreFlatEdgeBoundaryVertices(child.flat);
    }
  }
}

function polylineArcFractions2(polyline) {
  const points = Array.isArray(polyline) ? polyline : [];
  if (points.length < 2) return [0, 1];
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += segmentLength2(points[i - 1], points[i]);
    cumulative.push(total);
  }
  if (!(total > POINT_EPS)) return [0, 1];
  return cumulative.map((value) => value / total);
}

function replaceOutlineSegmentWithPolyline(flat, edge, replacementPolyline) {
  if (!flat || !edge || !Array.isArray(replacementPolyline) || replacementPolyline.length < 2) return false;
  const outline = Array.isArray(flat.outline) ? flat.outline.map((point) => copyPoint2(point)) : [];
  if (outline.length < 3) return false;

  const match = findOutlineSegmentForEdge(flat, edge);
  if (!match) return false;

  const replacement = match.reversed
    ? replacementPolyline.slice().reverse().map((point) => copyPoint2(point))
    : replacementPolyline.map((point) => copyPoint2(point));
  const interior = replacement.slice(1, -1);
  if (!interior.length) return false;

  const rebuilt = [];
  for (let i = 0; i < outline.length; i += 1) {
    rebuilt.push(copyPoint2(outline[i]));
    if (i === match.index) {
      for (const point of interior) rebuilt.push(copyPoint2(point));
    }
  }

  const deduped = dedupeConsecutivePoints2(rebuilt);
  if (deduped.length < 3) return false;
  flat.outline = deduped;
  return true;
}

function synchronizeBendAttachEdgeSubdivision(flat) {
  if (!flat || typeof flat !== "object") return;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    const bend = edge?.bend;
    const children = Array.isArray(bend?.children) ? bend.children : [];
    if (!children.length) continue;

    const parentPolyline = Array.isArray(edge.polyline) ? edge.polyline : [];
    const parentFractions = polylineArcFractions2(parentPolyline);
    const canSubdivideChildren = polylineIsLinear2(parentPolyline) && parentFractions.length > 2;
    const parentLength = polylineLength2D(parentPolyline);

    for (const child of children) {
      if (!child?.flat || !child?.attachEdgeId) {
        if (child?.flat) synchronizeBendAttachEdgeSubdivision(child.flat);
        continue;
      }
      const attachEdge = findEdgeById(child.flat, child.attachEdgeId);
      if (!attachEdge) {
        synchronizeBendAttachEdgeSubdivision(child.flat);
        continue;
      }

      if (canSubdivideChildren && polylineIsLinear2(attachEdge.polyline)) {
        const attachLength = polylineLength2D(attachEdge.polyline);
        const lenTol = Math.max(POINT_EPS * 16, Math.max(parentLength, attachLength) * 1e-5);
        if (Math.abs(parentLength - attachLength) <= lenTol) {
          const attachStart = copyPoint2(attachEdge.polyline[0]);
          const attachEnd = copyPoint2(attachEdge.polyline[attachEdge.polyline.length - 1]);
          const rebuiltAttach = dedupeConsecutivePoints2(
            parentFractions.map((t) => [
              attachStart[0] + (attachEnd[0] - attachStart[0]) * t,
              attachStart[1] + (attachEnd[1] - attachStart[1]) * t,
            ]),
          );
          if (rebuiltAttach.length >= 2) {
            attachEdge.polyline = rebuiltAttach;
            replaceOutlineSegmentWithPolyline(child.flat, attachEdge, rebuiltAttach);
          }
        }
      }

      synchronizeBendAttachEdgeSubdivision(child.flat);
    }
  }
}

function collapseLinearOutlineSpanForEdge(flat, edge) {
  if (!flat || !edge || !Array.isArray(edge.polyline) || edge.polyline.length < 3) return false;
  if (!polylineIsLinear2(edge.polyline)) return false;

  const outline = normalizeLoop2(flat.outline);
  if (outline.length < 3) return false;

  const start = copyPoint2(edge.polyline[0]);
  const end = copyPoint2(edge.polyline[edge.polyline.length - 1]);
  const segLen = segmentLength2(start, end);
  if (!(segLen > POINT_EPS)) return false;

  const endpointTol = Math.max(POINT_EPS * 4, segLen * 1e-6);
  const closestOutlineIndex = (target) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < outline.length; i += 1) {
      const d = pointDistance2(outline[i], target);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    return { index: bestIndex, distance: bestDistance };
  };

  const startMatch = closestOutlineIndex(start);
  const endMatch = closestOutlineIndex(end);
  if (startMatch.index < 0 || endMatch.index < 0) return false;
  if (startMatch.distance > endpointTol || endMatch.distance > endpointTol) return false;

  const collectPathIndices = (from, to, step) => {
    const n = outline.length;
    const out = [];
    let index = from;
    let guard = 0;
    while (guard <= n) {
      out.push(index);
      if (index === to) break;
      index = (index + step + n) % n;
      guard += 1;
    }
    return out;
  };

  const lineTol = Math.max(POINT_EPS * 2, segLen * 1e-6);
  const validatePath = (indices) => {
    if (!Array.isArray(indices) || indices.length < 3) return false;
    for (let i = 1; i < indices.length - 1; i += 1) {
      const point = outline[indices[i]];
      if (!pointOnSegment2(point, start, end, lineTol)) return false;
    }
    return true;
  };

  const forward = collectPathIndices(startMatch.index, endMatch.index, 1);
  const reverse = collectPathIndices(startMatch.index, endMatch.index, -1);
  const forwardOk = validatePath(forward);
  const reverseOk = validatePath(reverse);
  if (!forwardOk && !reverseOk) return false;

  const chosen = (!reverseOk || (forwardOk && forward.length <= reverse.length)) ? forward : reverse;
  const remove = new Set(chosen.slice(1, -1));
  if (!remove.size) return false;

  const rebuiltOutline = [];
  for (let i = 0; i < outline.length; i += 1) {
    if (remove.has(i)) continue;
    rebuiltOutline.push(copyPoint2(outline[i]));
  }
  const deduped = dedupeConsecutivePoints2(rebuiltOutline);
  if (deduped.length < 3) return false;

  flat.outline = deduped;
  edge.polyline = [start, end];
  return true;
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

function normalizeHoleSourceChain2(rawChain, fallbackId = null) {
  const polylineRaw = Array.isArray(rawChain)
    ? rawChain
    : (Array.isArray(rawChain?.polyline) ? rawChain.polyline : []);
  const polyline = dedupeConsecutivePoints2(polylineRaw.map((point) => [
    toFiniteNumber(point?.[0]),
    toFiniteNumber(point?.[1]),
  ]));
  if (polyline.length < 2) return null;
  const rawId = (rawChain && typeof rawChain === "object" && !Array.isArray(rawChain) && rawChain.id != null)
    ? String(rawChain.id)
    : (fallbackId != null ? String(fallbackId) : null);
  return {
    id: rawId || null,
    polyline: polyline.map((point) => [point[0], point[1]]),
  };
}

function cloneHoleSourceChains2(rawChains = [], fallbackBaseId = "hole_source") {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(rawChains) ? rawChains : [];
  for (let i = 0; i < list.length; i += 1) {
    const chain = normalizeHoleSourceChain2(list[i], `${fallbackBaseId}:${i + 1}`);
    if (!chain) continue;
    const id = chain.id || `${fallbackBaseId}:${i + 1}`;
    const key = `${id}|${buildQuantizedPolylineSignature(chain.polyline) || i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      polyline: chain.polyline.map((point) => [point[0], point[1]]),
    });
  }
  return out;
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

function pointOnSegment2(point, a, b, tol = POINT_EPS * 4) {
  const px = toFiniteNumber(point?.[0], Number.NaN);
  const py = toFiniteNumber(point?.[1], Number.NaN);
  const ax = toFiniteNumber(a?.[0], Number.NaN);
  const ay = toFiniteNumber(a?.[1], Number.NaN);
  const bx = toFiniteNumber(b?.[0], Number.NaN);
  const by = toFiniteNumber(b?.[1], Number.NaN);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return false;
  }
  const segLen = Math.hypot(bx - ax, by - ay);
  if (!(segLen > EPS)) return Math.hypot(px - ax, py - ay) <= tol;
  const dist = segmentDistanceToPoint2([px, py], [ax, ay], [bx, by]);
  if (dist > tol) return false;
  const minX = Math.min(ax, bx) - tol;
  const maxX = Math.max(ax, bx) + tol;
  const minY = Math.min(ay, by) - tol;
  const maxY = Math.max(ay, by) + tol;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

function orientationSign2(a, b, c) {
  const ax = toFiniteNumber(a?.[0], Number.NaN);
  const ay = toFiniteNumber(a?.[1], Number.NaN);
  const bx = toFiniteNumber(b?.[0], Number.NaN);
  const by = toFiniteNumber(b?.[1], Number.NaN);
  const cx = toFiniteNumber(c?.[0], Number.NaN);
  const cy = toFiniteNumber(c?.[1], Number.NaN);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
    return 0;
  }
  const cross = ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
  const scale = Math.max(1, Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay));
  const tol = Math.max(EPS * 10, scale * 1e-9);
  if (Math.abs(cross) <= tol) return 0;
  return cross > 0 ? 1 : -1;
}

function segmentsIntersect2(a, b, c, d, tol = POINT_EPS * 4) {
  if (
    !Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c) || !Array.isArray(d)
    || a.length < 2 || b.length < 2 || c.length < 2 || d.length < 2
  ) return false;
  const minAx = Math.min(a[0], b[0]) - tol;
  const maxAx = Math.max(a[0], b[0]) + tol;
  const minAy = Math.min(a[1], b[1]) - tol;
  const maxAy = Math.max(a[1], b[1]) + tol;
  const minBx = Math.min(c[0], d[0]) - tol;
  const maxBx = Math.max(c[0], d[0]) + tol;
  const minBy = Math.min(c[1], d[1]) - tol;
  const maxBy = Math.max(c[1], d[1]) + tol;
  if (maxAx < minBx || maxBx < minAx || maxAy < minBy || maxBy < minAy) return false;

  const o1 = orientationSign2(a, b, c);
  const o2 = orientationSign2(a, b, d);
  const o3 = orientationSign2(c, d, a);
  const o4 = orientationSign2(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment2(c, a, b, tol)) return true;
  if (o2 === 0 && pointOnSegment2(d, a, b, tol)) return true;
  if (o3 === 0 && pointOnSegment2(a, c, d, tol)) return true;
  if (o4 === 0 && pointOnSegment2(b, c, d, tol)) return true;
  return false;
}

function polygonsOverlap2(loopA, loopB, tol = POINT_EPS * 6) {
  if (!Array.isArray(loopA) || loopA.length < 3) return false;
  if (!Array.isArray(loopB) || loopB.length < 3) return false;

  for (const point of loopA) {
    if (pointInPolygon2(point, loopB) || pointNearPolygonBoundary2(point, loopB, tol)) return true;
  }
  for (const point of loopB) {
    if (pointInPolygon2(point, loopA) || pointNearPolygonBoundary2(point, loopA, tol)) return true;
  }

  for (let i = 0; i < loopA.length; i += 1) {
    const a0 = loopA[i];
    const a1 = loopA[(i + 1) % loopA.length];
    for (let j = 0; j < loopB.length; j += 1) {
      const b0 = loopB[j];
      const b1 = loopB[(j + 1) % loopB.length];
      if (segmentsIntersect2(a0, a1, b0, b1, tol)) return true;
    }
  }
  return false;
}

function buildLoopSignature2(loop, precision = 5) {
  const normalized = normalizeLoop2(loop);
  if (normalized.length < 3) return null;
  const fmt = (value) => Number(toFiniteNumber(value, 0)).toFixed(precision);
  const tokens = normalized.map((point) => `${fmt(point[0])},${fmt(point[1])}`);
  if (!tokens.length) return null;

  const minRotation = (arr) => {
    let best = null;
    for (let i = 0; i < arr.length; i += 1) {
      const rotated = arr.slice(i).concat(arr.slice(0, i)).join(";");
      if (best == null || rotated < best) best = rotated;
    }
    return best;
  };

  const forward = minRotation(tokens);
  const reverse = minRotation(tokens.slice().reverse());
  if (forward == null) return reverse;
  if (reverse == null) return forward;
  return forward < reverse ? forward : reverse;
}

function tesselateBoundaryContours2(contours) {
  const prepared = [];
  for (const contour of Array.isArray(contours) ? contours : []) {
    const loop = normalizeLoop2(contour);
    if (loop.length < 3) continue;
    const encoded = [];
    for (const point of loop) {
      encoded.push(toFiniteNumber(point?.[0]), toFiniteNumber(point?.[1]));
    }
    if (encoded.length >= 6) prepared.push(encoded);
  }
  if (!prepared.length) return [];

  try {
    const tess = Tess2?.tesselate?.({
      contours: prepared,
      windingRule: Tess2.WINDING_POSITIVE,
      elementType: Tess2.BOUNDARY_CONTOURS,
      polySize: 3,
      vertexSize: 2,
      normal: [0, 0, 1],
    });
    const vertices = Array.isArray(tess?.vertices) ? tess.vertices : [];
    const elements = Array.isArray(tess?.elements) ? tess.elements : [];
    if (!vertices.length || !elements.length) return [];

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
    return out;
  } catch {
    return [];
  }
}

function orientPolylineLikeEdge(polyline, edge) {
  const points = Array.isArray(polyline) ? polyline.map((point) => copyPoint2(point)) : [];
  if (points.length < 2) return points;
  if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) return points;
  const edgeStart = edge.polyline[0];
  const edgeEnd = edge.polyline[edge.polyline.length - 1];
  const polyStart = points[0];
  const polyEnd = points[points.length - 1];
  const sameDirScore = pointDistance2(edgeStart, polyStart) + pointDistance2(edgeEnd, polyEnd);
  const reversedScore = pointDistance2(edgeStart, polyEnd) + pointDistance2(edgeEnd, polyStart);
  return sameDirScore <= reversedScore ? points : points.slice().reverse();
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

function appendSegmentToPolyline(polyline, a, b, tol = POINT_EPS * 4) {
  if (!Array.isArray(polyline) || polyline.length < 2) return false;
  const segA = copyPoint2(a);
  const segB = copyPoint2(b);
  const start = polyline[0];
  const end = polyline[polyline.length - 1];
  if (pointDistance2(end, segA) <= tol) {
    polyline.push(segB);
    return true;
  }
  if (pointDistance2(end, segB) <= tol) {
    polyline.push(segA);
    return true;
  }
  if (pointDistance2(start, segB) <= tol) {
    polyline.unshift(segA);
    return true;
  }
  if (pointDistance2(start, segA) <= tol) {
    polyline.unshift(segB);
    return true;
  }
  return false;
}

function cloneEdgeMetadataForSplit(edge) {
  if (!edge || typeof edge !== "object") return {};
  const cloned = { ...edge };
  delete cloned.id;
  delete cloned.polyline;
  delete cloned.bend;
  delete cloned.isAttachEdge;
  return cloned;
}

function buildEdgeSegmentSourceIndex(edges, { skipInternalCutout = false } = {}) {
  const segmentBySignature = new Map();
  const segments = [];
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || !Array.isArray(edge.polyline) || edge.polyline.length < 2) continue;
    if (skipInternalCutout && isInternalCutoutLikeEdge(edge)) continue;
    const edgeId = edge?.id != null ? String(edge.id) : null;
    for (let i = 0; i + 1 < edge.polyline.length; i += 1) {
      const a = copyPoint2(edge.polyline[i]);
      const b = copyPoint2(edge.polyline[i + 1]);
      if (segmentLength2(a, b) <= POINT_EPS) continue;
      const segment = { edge, edgeId, a, b };
      segments.push(segment);
      const signature = segmentSignature2(a, b);
      if (!signature) continue;
      if (!segmentBySignature.has(signature)) segmentBySignature.set(signature, []);
      segmentBySignature.get(signature).push(segment);
    }
  }
  return { segmentBySignature, segments };
}

function findSourceEdgeForSegment(a, b, sourceIndex, excludeEdgeId = null) {
  if (!sourceIndex || !Array.isArray(sourceIndex.segments) || !sourceIndex.segments.length) return null;
  const excludeId = excludeEdgeId != null ? String(excludeEdgeId) : null;
  const signature = segmentSignature2(a, b);
  if (signature) {
    const exactMatches = sourceIndex.segmentBySignature.get(signature);
    if (Array.isArray(exactMatches) && exactMatches.length) {
      for (const match of exactMatches) {
        const edgeId = match?.edgeId != null ? String(match.edgeId) : null;
        if (excludeId && edgeId && edgeId === excludeId) continue;
        return match?.edge || null;
      }
    }
  }

  // Sub-segment fallback: a boolean split may cut an old segment into shorter pieces.
  const tol = POINT_EPS * 4;
  let best = null;
  for (const candidate of sourceIndex.segments) {
    const edgeId = candidate?.edgeId != null ? String(candidate.edgeId) : null;
    if (excludeId && edgeId && edgeId === excludeId) continue;
    if (!pointOnSegment2(a, candidate.a, candidate.b, tol)) continue;
    if (!pointOnSegment2(b, candidate.a, candidate.b, tol)) continue;
    const score = Math.min(
      pointDistance2(a, candidate.a) + pointDistance2(b, candidate.b),
      pointDistance2(a, candidate.b) + pointDistance2(b, candidate.a),
    );
    if (!best || score < best.score) best = { edge: candidate.edge, score };
  }
  return best?.edge || null;
}

function findSourceIdForBoundarySegment(a, b, sourceIndex, tol = POINT_EPS * 8) {
  if (!sourceIndex || !Array.isArray(sourceIndex.segments) || !sourceIndex.segments.length) return null;

  const exactEdge = findSourceEdgeForSegment(a, b, sourceIndex);
  if (exactEdge?.id != null) return String(exactEdge.id);

  const nearbyIdsForPoint = (point) => {
    const bestById = new Map();
    for (const candidate of sourceIndex.segments) {
      const edgeId = candidate?.edgeId != null ? String(candidate.edgeId) : null;
      if (!edgeId) continue;
      const distance = segmentDistanceToPoint2(point, candidate.a, candidate.b);
      if (!(distance <= tol)) continue;
      const previous = bestById.get(edgeId);
      if (previous == null || distance < previous) bestById.set(edgeId, distance);
    }
    return bestById;
  };

  const nearA = nearbyIdsForPoint(a);
  const nearB = nearbyIdsForPoint(b);
  let bestSharedId = null;
  let bestSharedScore = Number.POSITIVE_INFINITY;
  for (const [edgeId, distA] of nearA.entries()) {
    const distB = nearB.get(edgeId);
    if (distB == null) continue;
    const score = distA + distB;
    if (score < bestSharedScore) {
      bestSharedScore = score;
      bestSharedId = edgeId;
    }
  }
  if (bestSharedId) return bestSharedId;

  const midpoint = [
    (toFiniteNumber(a?.[0], 0) + toFiniteNumber(b?.[0], 0)) * 0.5,
    (toFiniteNumber(a?.[1], 0) + toFiniteNumber(b?.[1], 0)) * 0.5,
  ];
  let bestId = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of sourceIndex.segments) {
    const edgeId = candidate?.edgeId != null ? String(candidate.edgeId) : null;
    if (!edgeId) continue;
    const score =
      segmentDistanceToPoint2(a, candidate.a, candidate.b)
      + segmentDistanceToPoint2(b, candidate.a, candidate.b)
      + (segmentDistanceToPoint2(midpoint, candidate.a, candidate.b) * 0.5);
    if (score < bestScore) {
      bestScore = score;
      bestId = edgeId;
    }
  }
  return bestScore <= (tol * 3) ? bestId : null;
}

function deriveLoopSourceChains2(loop, sourceEdges, fallbackBaseId = "hole_source") {
  const normalizedLoop = normalizeLoop2(loop);
  if (normalizedLoop.length < 3) return [];

  const normalizedSourceEdges = [];
  for (let i = 0; i < (Array.isArray(sourceEdges) ? sourceEdges.length : 0); i += 1) {
    const edge = sourceEdges[i];
    const chain = normalizeHoleSourceChain2(edge, `${fallbackBaseId}:${i + 1}`);
    if (!chain) continue;
    normalizedSourceEdges.push({
      id: chain.id || `${fallbackBaseId}:${i + 1}`,
      polyline: chain.polyline.map((point) => [point[0], point[1]]),
    });
  }
  const sourceIndex = buildEdgeSegmentSourceIndex(normalizedSourceEdges);
  if (!Array.isArray(sourceIndex?.segments) || !sourceIndex.segments.length) return [];

  const segmentDefs = [];
  for (let i = 0; i < normalizedLoop.length; i += 1) {
    const a = normalizedLoop[i];
    const b = normalizedLoop[(i + 1) % normalizedLoop.length];
    if (segmentLength2(a, b) <= POINT_EPS) continue;
    segmentDefs.push({
      a: copyPoint2(a),
      b: copyPoint2(b),
      sourceId: findSourceIdForBoundarySegment(a, b, sourceIndex),
    });
  }
  if (!segmentDefs.some((entry) => !!entry.sourceId)) return [];

  const firstMatchedIndex = (() => {
    for (let i = 0; i < segmentDefs.length; i += 1) {
      if (!segmentDefs[i]?.sourceId) continue;
      const prev = segmentDefs[(i - 1 + segmentDefs.length) % segmentDefs.length];
      if ((prev?.sourceId || null) !== segmentDefs[i].sourceId) return i;
    }
    return segmentDefs.findIndex((entry) => !!entry.sourceId);
  })();
  const orderedDefs = firstMatchedIndex > 0
    ? segmentDefs.slice(firstMatchedIndex).concat(segmentDefs.slice(0, firstMatchedIndex))
    : segmentDefs;

  const chains = [];
  for (const entry of orderedDefs) {
    const sourceId = entry?.sourceId || null;
    if (!sourceId) continue;
    const current = chains[chains.length - 1] || null;
    if (current && current.id === sourceId && appendSegmentToPolyline(current.polyline, entry.a, entry.b)) {
      continue;
    }
    chains.push({
      id: sourceId,
      polyline: [copyPoint2(entry.a), copyPoint2(entry.b)],
    });
  }
  return cloneHoleSourceChains2(chains, fallbackBaseId);
}

function rebuildFlatOuterEdgesFromOutline(flat, outlineLoop, usedIds, cutLoopSources = null) {
  const outline = normalizeLoop2(outlineLoop);
  if (!flat || outline.length < 3) return { changed: false, reason: "invalid_outline" };

  const oldEdges = Array.isArray(flat.edges) ? flat.edges : [];
  const sourceIndex = buildEdgeSegmentSourceIndex(oldEdges, { skipInternalCutout: true });
  const cutSourceEdges = [];
  const sourceLoops = Array.isArray(cutLoopSources) ? cutLoopSources : [];
  for (let loopIndex = 0; loopIndex < sourceLoops.length; loopIndex += 1) {
    const sourceChains = Array.isArray(sourceLoops[loopIndex]) ? sourceLoops[loopIndex] : [];
    for (let chainIndex = 0; chainIndex < sourceChains.length; chainIndex += 1) {
      const rawChain = sourceChains[chainIndex];
      const chain = normalizeHoleSourceChain2(rawChain, `${flat.id}:cutsrc:${loopIndex + 1}:${chainIndex + 1}`);
      if (!chain) continue;
      cutSourceEdges.push({
        id: chain.id || `${flat.id}:cutsrc:${loopIndex + 1}:${chainIndex + 1}`,
        polyline: chain.polyline.map((point) => [point[0], point[1]]),
        __cutSource: true,
      });
    }
  }
  const cutSourceIndex = buildEdgeSegmentSourceIndex(cutSourceEdges);

  const segmentDefs = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    let sourceEdge = findSourceEdgeForSegment(a, b, sourceIndex);
    if (!sourceEdge) sourceEdge = findSourceEdgeForSegment(a, b, cutSourceIndex);
    if (segmentLength2(a, b) <= POINT_EPS) continue;
    segmentDefs.push({
      a: copyPoint2(a),
      b: copyPoint2(b),
      sourceEdge,
      sourceId: sourceEdge?.id != null ? String(sourceEdge.id) : null,
    });
  }
  if (!segmentDefs.length) return { changed: false, reason: "no_outline_segments" };

  // Avoid a run wrapping across the loop boundary when we have anchored source segments.
  const firstMatchedIndex = segmentDefs.findIndex((entry) => !!entry.sourceId);
  const orderedDefs = firstMatchedIndex > 0
    ? segmentDefs.slice(firstMatchedIndex).concat(segmentDefs.slice(0, firstMatchedIndex))
    : segmentDefs;

  const consumedSourceIds = new Set();
  const newEdges = [];
  for (let i = 0; i < orderedDefs.length;) {
    const entry = orderedDefs[i];
    const sourceEdge = entry.sourceEdge || null;
    const sourceId = entry.sourceId || null;
    const runPoints = [copyPoint2(entry.a), copyPoint2(entry.b)];
    let j = i + 1;
    while (j < orderedDefs.length) {
      const next = orderedDefs[j];
      if ((next.sourceId || null) !== sourceId) break;
      if (!sourceId) break;
      if (!appendSegmentToPolyline(runPoints, next.a, next.b)) break;
      j += 1;
    }

    const polyline = simplifyCollinearPolyline2(runPoints);
    if (polyline.length >= 2) {
      const isCutSource = !!sourceEdge?.__cutSource;
      if (sourceEdge && sourceId && !isCutSource && !consumedSourceIds.has(sourceId)) {
        newEdges.push({
          ...sourceEdge,
          polyline: orientPolylineLikeEdge(polyline, sourceEdge),
        });
        consumedSourceIds.add(sourceId);
        if (usedIds && sourceEdge?.id != null) usedIds.add(String(sourceEdge.id));
      } else if (sourceEdge && !isCutSource) {
        const splitId = uniqueId(`${sourceId || flat.id}:split`, usedIds);
        newEdges.push({
          ...cloneEdgeMetadataForSplit(sourceEdge),
          id: splitId,
          polyline: orientPolylineLikeEdge(polyline, sourceEdge),
        });
      } else if (sourceId) {
        const cutEdgeId = uniqueId(`${flat.id}:edge`, usedIds);
        newEdges.push({
          id: cutEdgeId,
          polyline,
        });
      } else {
        const fallbackId = uniqueId(`${flat.id}:e${newEdges.length + 1}`, usedIds);
        newEdges.push({
          id: fallbackId,
          polyline,
        });
      }
    }
    i = j;
  }
  const carryOverEdges = carryOverInternalCutoutEdges(oldEdges, newEdges);
  if (carryOverEdges.length) newEdges.push(...carryOverEdges);

  if (newEdges.length < 3) return { changed: false, reason: "insufficient_rebuilt_edges" };
  flat.outline = outline.map((point) => [point[0], point[1]]);
  flat.edges = newEdges;
  return { changed: true };
}

function applyCutLoopsToFlat(flat, cutLoops2, featureID, usedIds, cutLoopSources = null) {
  if (!flat || !Array.isArray(flat?.outline) || flat.outline.length < 3) {
    return { applied: false, reason: "invalid_flat" };
  }

  const cutLoops = [];
  const cutSources = [];
  const rawCutSources = Array.isArray(cutLoopSources) ? cutLoopSources : [];
  const cutLoopList = Array.isArray(cutLoops2) ? cutLoops2 : [];
  for (let loopIndex = 0; loopIndex < cutLoopList.length; loopIndex += 1) {
    const loop = cutLoopList[loopIndex];
    const normalized = normalizeFilledLoop2(loop);
    if (normalized.length >= 3) cutLoops.push(normalized);
    if (normalized.length >= 3) {
      const sourceChains = [];
      const rawChains = Array.isArray(rawCutSources[loopIndex]) ? rawCutSources[loopIndex] : [];
      for (let chainIndex = 0; chainIndex < rawChains.length; chainIndex += 1) {
        const chain = normalizeHoleSourceChain2(
          rawChains[chainIndex],
          `${featureID}:cutsrc:${loopIndex + 1}:${chainIndex + 1}`,
        );
        if (!chain) continue;
        sourceChains.push({
          id: chain.id,
          polyline: chain.polyline.map((point) => [point[0], point[1]]),
        });
      }
      cutSources.push(sourceChains);
    }
  }
  if (!cutLoops.length) return { applied: false, reason: "no_cut_loops" };

  const outer = normalizeFilledLoop2(flat.outline);
  if (outer.length < 3) return { applied: false, reason: "invalid_flat_outline" };

  const existingHoles = collectFlatHoleLoops(flat).map((hole) => ({
    raw: hole.raw,
    id: hole.id,
    cutoutId: hole.cutoutId,
    loop: normalizeLoop2(hole.loop),
    signature: buildLoopSignature2(hole.loop),
  }));

  const contours = [];
  contours.push(outer);
  for (const hole of existingHoles) {
    const loop = normalizeFilledLoop2(hole.loop);
    if (loop.length < 3) continue;
    contours.push(loop.slice().reverse());
  }
  for (const loop of cutLoops) {
    contours.push(loop.slice().reverse());
  }

  const boundaryLoops = tesselateBoundaryContours2(contours);
  if (!boundaryLoops.length) {
    return { applied: false, reason: "empty_boolean_result" };
  }

  let newOuter = null;
  let maxOuterArea = Number.NEGATIVE_INFINITY;
  for (const loop of boundaryLoops) {
    const area = signedArea2D(loop);
    const areaAbs = Math.abs(area);
    if (areaAbs <= EPS) continue;
    const isCandidate = area > 0 || !newOuter;
    if (isCandidate && areaAbs > maxOuterArea) {
      maxOuterArea = areaAbs;
      newOuter = loop.slice();
    }
  }
  if (!newOuter || newOuter.length < 3) {
    return { applied: false, reason: "no_outer_after_boolean" };
  }
  if (signedArea2D(newOuter) < 0) newOuter.reverse();
  const newOuterSignature = buildLoopSignature2(newOuter);

  const newHoles = [];
  let disconnectedCount = 0;
  for (const loop of boundaryLoops) {
    const signature = buildLoopSignature2(loop);
    if (!signature) continue;
    if (newOuterSignature && signature === newOuterSignature) continue;
    if (!polygonMostlyInsidePolygon(loop, newOuter, POINT_EPS * 10)) {
      disconnectedCount += 1;
      continue;
    }
    let holeLoop = normalizeLoop2(loop);
    if (holeLoop.length < 3) continue;
    if (signedArea2D(holeLoop) > 0) holeLoop = holeLoop.slice().reverse();
    newHoles.push(holeLoop);
  }
  if (disconnectedCount > 0) {
    return {
      applied: false,
      reason: "disconnected_result",
      disconnectedCount,
    };
  }

  const oldOuterSig = buildLoopSignature2(outer);
  const oldHoleSigs = existingHoles
    .map((hole) => hole.signature)
    .filter(Boolean)
    .sort();
  const newOuterSig = buildLoopSignature2(newOuter);
  const newHoleSigs = newHoles
    .map((loop) => buildLoopSignature2(loop))
    .filter(Boolean)
    .sort();
  const unchanged = oldOuterSig && newOuterSig
    && oldOuterSig === newOuterSig
    && oldHoleSigs.length === newHoleSigs.length
    && oldHoleSigs.every((value, index) => value === newHoleSigs[index]);
  if (unchanged) return { applied: false, reason: "no_effect" };

  const rebuildEdges = rebuildFlatOuterEdgesFromOutline(flat, newOuter, usedIds, cutSources);
  if (!rebuildEdges.changed) {
    return { applied: false, reason: rebuildEdges.reason || "edge_rebuild_failed" };
  }

  const existingHoleBySignature = new Map();
  for (const hole of existingHoles) {
    if (!hole.signature) continue;
    if (!existingHoleBySignature.has(hole.signature)) existingHoleBySignature.set(hole.signature, []);
    existingHoleBySignature.get(hole.signature).push(hole);
  }
  const usedHoleIds = new Set(existingHoles.map((hole) => String(hole.id || "")));
  usedHoleIds.delete("");
  let newHoleCounter = 1;
  const nextNewHoleId = () => {
    let candidate = `${featureID}:hole_${newHoleCounter}`;
    while (usedHoleIds.has(candidate)) {
      newHoleCounter += 1;
      candidate = `${featureID}:hole_${newHoleCounter}`;
    }
    usedHoleIds.add(candidate);
    newHoleCounter += 1;
    return candidate;
  };

  const rebuiltHoleEntries = [];
  const createdHoleIds = [];
  const cutSourcesBySignature = new Map();
  for (let loopIndex = 0; loopIndex < cutLoops.length; loopIndex += 1) {
    const signature = buildLoopSignature2(cutLoops[loopIndex]);
    if (!signature || cutSourcesBySignature.has(signature) || cutSources[loopIndex]?.length <= 0) continue;
    cutSourcesBySignature.set(
      signature,
      cloneHoleSourceChains2(cutSources[loopIndex], `${featureID}:cutsrc:${loopIndex + 1}`),
    );
  }
  const allCutSourceEdges = [];
  for (let loopIndex = 0; loopIndex < cutSources.length; loopIndex += 1) {
    const sourceChains = Array.isArray(cutSources[loopIndex]) ? cutSources[loopIndex] : [];
    for (let chainIndex = 0; chainIndex < sourceChains.length; chainIndex += 1) {
      const chain = normalizeHoleSourceChain2(
        sourceChains[chainIndex],
        `${featureID}:cutsrc:${loopIndex + 1}:${chainIndex + 1}`,
      );
      if (!chain) continue;
      allCutSourceEdges.push({
        id: chain.id || `${featureID}:cutsrc:${loopIndex + 1}:${chainIndex + 1}`,
        polyline: chain.polyline.map((point) => [point[0], point[1]]),
      });
    }
  }
  for (const loop of newHoles) {
    const signature = buildLoopSignature2(loop);
    const reused = signature ? existingHoleBySignature.get(signature) : null;
    const reusedHole = Array.isArray(reused) && reused.length ? reused.shift() : null;
    const outline = loop.map((point) => [point[0], point[1]]);
    const matchedSourceChains = signature ? cutSourcesBySignature.get(signature) : null;
    const derivedSourceChains = deriveLoopSourceChains2(loop, allCutSourceEdges, `${featureID}:hole_source`);
    const existingSourceChains = reusedHole?.raw && typeof reusedHole.raw === "object" && !Array.isArray(reusedHole.raw)
      ? reusedHole.raw.sourceChains
      : null;
    const sourceChains = cloneHoleSourceChains2(
      (derivedSourceChains && derivedSourceChains.length)
        ? derivedSourceChains
        : ((matchedSourceChains && matchedSourceChains.length) ? matchedSourceChains : existingSourceChains),
      `${featureID}:hole_source`,
    );

    if (reusedHole) {
      const raw = reusedHole.raw;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const updated = {
          ...raw,
          id: String(raw.id || reusedHole.id),
          outline,
        };
        if (sourceChains.length) updated.sourceChains = sourceChains;
        rebuiltHoleEntries.push(updated);
      } else {
        const updated = {
          id: String(reusedHole.id),
          cutoutId: reusedHole.cutoutId || null,
          outline,
        };
        if (sourceChains.length) updated.sourceChains = sourceChains;
        rebuiltHoleEntries.push(updated);
      }
      continue;
    }

    const id = nextNewHoleId();
    const created = {
      id,
      cutoutId: featureID,
      outline,
    };
    if (sourceChains.length) created.sourceChains = sourceChains;
    rebuiltHoleEntries.push(created);
    createdHoleIds.push(id);
  }

  if (rebuiltHoleEntries.length) flat.holes = rebuiltHoleEntries;
  else delete flat.holes;

  return {
    applied: true,
    createdHoleIds,
    holeCount: createdHoleIds.length,
    totalHoleCount: rebuiltHoleEntries.length,
    outerChanged: true,
  };
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

function buildSolidCutoutSectionSourceId(faceName, metadata) {
  const key = legacyBooleanCutoutGroupKey(faceName, metadata);
  const token = sanitizeFaceNameToken(key || faceName || "CUTTER_FACE", "CUTTER_FACE");
  const hash = stableStringHash32(key || String(faceName || "CUTTER_FACE"))
    .toString(16)
    .slice(-8)
    .padStart(8, "0");
  return `SOLID_SECTION:${token}:${hash}`;
}

function pointKey2(point, tol = POINT_EPS * 8) {
  const quantum = Math.max(POINT_EPS, Math.abs(toFiniteNumber(tol, POINT_EPS * 8)));
  const x = Math.round(toFiniteNumber(point?.[0], 0) / quantum);
  const y = Math.round(toFiniteNumber(point?.[1], 0) / quantum);
  return `${x},${y}`;
}

function pushUniquePoint2(points, point, tol = POINT_EPS * 6) {
  const candidate = copyPoint2(point);
  for (const existing of points) {
    if (pointDistance2(existing, candidate) <= tol) return;
  }
  points.push(candidate);
}

function sliceTriangleWithPlane2(points3, planeZ = 0, tol = POINT_EPS * 6) {
  if (!Array.isArray(points3) || points3.length < 3) return null;

  const distances = points3.map((point) => toFiniteNumber(point?.[2], 0) - planeZ);
  const onPlaneCount = distances.reduce((count, value) => count + (Math.abs(value) <= tol ? 1 : 0), 0);
  if (onPlaneCount >= 3) return null;

  const intersections = [];
  const edges = [[0, 1], [1, 2], [2, 0]];
  for (const [ia, ib] of edges) {
    const a = points3[ia];
    const b = points3[ib];
    const da = distances[ia];
    const db = distances[ib];
    const aOn = Math.abs(da) <= tol;
    const bOn = Math.abs(db) <= tol;

    if (aOn && bOn) {
      pushUniquePoint2(intersections, [a[0], a[1]], tol);
      pushUniquePoint2(intersections, [b[0], b[1]], tol);
      continue;
    }
    if (aOn) {
      pushUniquePoint2(intersections, [a[0], a[1]], tol);
      continue;
    }
    if (bOn) {
      pushUniquePoint2(intersections, [b[0], b[1]], tol);
      continue;
    }

    const crosses = (da < -tol && db > tol) || (da > tol && db < -tol);
    if (!crosses) continue;

    const denom = toFiniteNumber(b[2], 0) - toFiniteNumber(a[2], 0);
    if (Math.abs(denom) <= EPS) continue;
    const t = (planeZ - toFiniteNumber(a[2], 0)) / denom;
    if (!Number.isFinite(t)) continue;
    pushUniquePoint2(intersections, [
      toFiniteNumber(a[0], 0) + (toFiniteNumber(b[0], 0) - toFiniteNumber(a[0], 0)) * t,
      toFiniteNumber(a[1], 0) + (toFiniteNumber(b[1], 0) - toFiniteNumber(a[1], 0)) * t,
    ], tol);
  }

  if (intersections.length < 2) return null;
  if (intersections.length === 2) {
    if (pointDistance2(intersections[0], intersections[1]) <= tol) return null;
    return { a: intersections[0], b: intersections[1] };
  }

  let best = null;
  for (let i = 0; i < intersections.length; i += 1) {
    for (let j = i + 1; j < intersections.length; j += 1) {
      const dist = pointDistance2(intersections[i], intersections[j]);
      if (!(dist > tol)) continue;
      if (!best || dist > best.dist) {
        best = { a: intersections[i], b: intersections[j], dist };
      }
    }
  }
  return best ? { a: best.a, b: best.b } : null;
}

function buildSectionLoopsFromSegments2(segments, tol = POINT_EPS * 8) {
  const pointByKey = new Map();
  const adjacency = new Map();
  const normalizedSegments = [];
  const seenEdges = new Set();

  const addAdjacency = (fromKey, entry) => {
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, []);
    adjacency.get(fromKey).push(entry);
  };

  for (const segment of Array.isArray(segments) ? segments : []) {
    const a = copyPoint2(segment?.a);
    const b = copyPoint2(segment?.b);
    if (pointDistance2(a, b) <= tol) continue;
    const aKey = pointKey2(a, tol);
    const bKey = pointKey2(b, tol);
    if (!aKey || !bKey || aKey === bKey) continue;
    if (!pointByKey.has(aKey)) pointByKey.set(aKey, a);
    if (!pointByKey.has(bKey)) pointByKey.set(bKey, b);
    const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);

    const index = normalizedSegments.length;
    normalizedSegments.push({
      aKey,
      bKey,
      sourceId: segment?.sourceId != null ? String(segment.sourceId) : null,
    });
    addAdjacency(aKey, { segmentIndex: index, otherKey: bKey });
    addAdjacency(bKey, { segmentIndex: index, otherKey: aKey });
  }

  for (const entries of adjacency.values()) {
    entries.sort((a, b) => String(a.otherKey).localeCompare(String(b.otherKey)));
  }

  const usedSegments = new Set();
  const loops = [];
  const pickNext = (currentKey, previousKey = null) => {
    const candidates = Array.isArray(adjacency.get(currentKey)) ? adjacency.get(currentKey) : [];
    for (const candidate of candidates) {
      if (usedSegments.has(candidate.segmentIndex)) continue;
      if (previousKey && candidate.otherKey === previousKey && candidates.length > 1) continue;
      return candidate;
    }
    return candidates.find((candidate) => !usedSegments.has(candidate.segmentIndex)) || null;
  };

  for (let i = 0; i < normalizedSegments.length; i += 1) {
    if (usedSegments.has(i)) continue;
    const seed = normalizedSegments[i];
    usedSegments.add(i);
    const chain = [seed.aKey, seed.bKey];
    const sourceIds = new Set(seed.sourceId ? [seed.sourceId] : []);

    let advanced = true;
    while (advanced) {
      advanced = false;

      const endKey = chain[chain.length - 1];
      const prevKey = chain.length >= 2 ? chain[chain.length - 2] : null;
      const nextEnd = pickNext(endKey, prevKey);
      if (nextEnd) {
        usedSegments.add(nextEnd.segmentIndex);
        chain.push(nextEnd.otherKey);
        const sourceId = normalizedSegments[nextEnd.segmentIndex]?.sourceId;
        if (sourceId) sourceIds.add(sourceId);
        advanced = true;
        if (chain[chain.length - 1] === chain[0]) break;
        continue;
      }

      const startKey = chain[0];
      const nextStart = pickNext(startKey, chain[1] || null);
      if (nextStart) {
        usedSegments.add(nextStart.segmentIndex);
        chain.unshift(nextStart.otherKey);
        const sourceId = normalizedSegments[nextStart.segmentIndex]?.sourceId;
        if (sourceId) sourceIds.add(sourceId);
        advanced = true;
        if (chain[chain.length - 1] === chain[0]) break;
      }
    }

    if (chain.length < 4 || chain[0] !== chain[chain.length - 1]) continue;
    const loop = simplifyCollinearPolyline2(
      chain.slice(0, -1).map((key) => copyPoint2(pointByKey.get(key))),
      tol,
    );
    const normalized = normalizeLoop2(loop);
    if (normalized.length < 3) continue;
    loops.push({
      loop: normalized,
      sourceIds: Array.from(sourceIds).filter(Boolean).sort(),
    });
  }

  return loops;
}

function buildSolidPlaneSectionLoops2({
  localVertices = [],
  triVerts = [],
  faceIDs = [],
  faceNamesById = null,
  cutter = null,
  planeZ = 0,
  tol = POINT_EPS * 6,
} = {}) {
  const triCount = (Array.isArray(triVerts) ? (triVerts.length / 3) : 0) | 0;
  if (triCount <= 0 || !Array.isArray(localVertices) || !localVertices.length) return [];

  const segments = [];
  const seenSegments = new Set();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const base = triIndex * 3;
    const ia = Math.max(0, toFiniteNumber(triVerts[base + 0], 0) | 0);
    const ib = Math.max(0, toFiniteNumber(triVerts[base + 1], 0) | 0);
    const ic = Math.max(0, toFiniteNumber(triVerts[base + 2], 0) | 0);
    const a = localVertices[ia];
    const b = localVertices[ib];
    const c = localVertices[ic];
    if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) continue;

    const segment = sliceTriangleWithPlane2([a, b, c], planeZ, tol);
    if (!segment) continue;

    const faceId = Array.isArray(faceIDs) && triIndex < faceIDs.length
      ? Math.max(0, toFiniteNumber(faceIDs[triIndex], 0) | 0)
      : 0;
    const faceName = faceNamesById instanceof Map
      ? (faceNamesById.get(faceId) || `FACE_${faceId}`)
      : `FACE_${faceId}`;
    const faceMeta = (cutter && typeof cutter.getFaceMetadata === "function")
      ? cutter.getFaceMetadata(faceName)
      : null;
    const sourceId = buildSolidCutoutSectionSourceId(faceName, faceMeta);
    const signature = segmentSignature2(segment.a, segment.b);
    if (!signature) continue;
    const dedupeKey = `${sourceId}|${signature}`;
    if (seenSegments.has(dedupeKey)) continue;
    seenSegments.add(dedupeKey);
    segments.push({
      a: segment.a,
      b: segment.b,
      sourceId,
    });
  }

  const loops = buildSectionLoopsFromSegments2(segments, tol);
  const sourceEdges = segments.map((segment, index) => ({
    id: segment?.sourceId != null ? String(segment.sourceId) : `solid_section:${index + 1}`,
    polyline: [copyPoint2(segment.a), copyPoint2(segment.b)],
  }));
  return loops.map((entry, index) => {
    const sourceChains = deriveLoopSourceChains2(
      entry.loop,
      sourceEdges,
      `solid_section:${index + 1}`,
    );
    return {
      ...entry,
      sourceChains,
      sourceIds: sourceChains.map((chain) => String(chain.id || "")).filter(Boolean),
    };
  });
}

function applySolidCutoutToTree({ tree, featureID, cutter, rootMatrix = null }) {
  const summary = {
    requestedLoops: 0,
    applied: 0,
    skipped: 0,
    assignments: [],
    skippedLoops: [],
  };
  if (!tree?.root || !isSolidLikeObject(cutter) || typeof cutter.getMesh !== "function") return summary;

  let model = null;
  try {
    model = evaluateSheetMetal(tree);
  } catch (error) {
    summary.skippedLoops.push({
      reason: "evaluate_failed",
      message: String(error?.message || error || "failed to evaluate tree"),
    });
    summary.skipped = 1;
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
    summary.skipped = 1;
    summary.skippedLoops.push({ reason: "no_flat_placements" });
    return summary;
  }

  let mesh = null;
  let triVerts = [];
  let faceIDs = [];
  let localizableVertices = [];
  try {
    mesh = cutter.getMesh();
    triVerts = mesh?.triVerts?.length ? Array.from(mesh.triVerts) : [];
    faceIDs = mesh?.faceID?.length
      ? Array.from(mesh.faceID)
      : (Array.isArray(cutter?._triIDs) ? cutter._triIDs.slice() : []);
    const vertProperties = mesh?.vertProperties?.length ? Array.from(mesh.vertProperties) : [];
    const vertexCount = (vertProperties.length / 3) | 0;
    localizableVertices = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) {
      localizableVertices[i] = [
        toFiniteNumber(vertProperties[i * 3 + 0], 0),
        toFiniteNumber(vertProperties[i * 3 + 1], 0),
        toFiniteNumber(vertProperties[i * 3 + 2], 0),
      ];
    }
  } catch (error) {
    summary.skipped = 1;
    summary.skippedLoops.push({
      reason: "cutter_mesh_failed",
      message: String(error?.message || error || "failed to read cutter mesh"),
    });
    return summary;
  } finally {
    try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
  }
  if (!triVerts.length || !localizableVertices.length) {
    summary.skipped = 1;
    summary.skippedLoops.push({ reason: "empty_cutter_mesh" });
    return summary;
  }

  removeCutoutHolesFromTree(tree, featureID);
  const usedIds = collectTreeIds(tree);
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(tree?.thickness, 1)));
  const halfT = thickness * 0.5;
  const sectionTol = Math.max(POINT_EPS * 6, thickness * 1e-3);
  const faceNamesById = (cutter?._idToFaceName instanceof Map) ? new Map(cutter._idToFaceName) : new Map();

  for (const candidate of flatPlacements) {
    const flat = candidate.placement.flat;
    const localVertices = localizableVertices.map((point) => {
      const local = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(candidate.inverseWorld);
      return [local.x, local.y, local.z];
    });

    const topSections = buildSolidPlaneSectionLoops2({
      localVertices,
      triVerts,
      faceIDs,
      faceNamesById,
      cutter,
      planeZ: halfT,
      tol: sectionTol,
    });
    const bottomSections = buildSolidPlaneSectionLoops2({
      localVertices,
      triVerts,
      faceIDs,
      faceNamesById,
      cutter,
      planeZ: -halfT,
      tol: sectionTol,
    });
    const topLoops = topSections.map((entry) => entry.loop);
    const bottomLoops = bottomSections.map((entry) => entry.loop);
    summary.requestedLoops += topLoops.length + bottomLoops.length;
    if (!topLoops.length && !bottomLoops.length) continue;

    const cutEntries = [...topSections, ...bottomSections];
    const cutLoops = unionFilledLoops2([...topLoops, ...bottomLoops]);
    if (!cutLoops.length) {
      summary.skipped += 1;
      summary.skippedLoops.push({
        flatId: String(flat?.id || ""),
        reason: "empty_section_union",
        topSectionCount: topLoops.length,
        bottomSectionCount: bottomLoops.length,
      });
      continue;
    }

    const sectionSourceEdges = [];
    for (const entry of cutEntries) {
      const sourceChains = Array.isArray(entry?.sourceChains) ? entry.sourceChains : [];
      for (let chainIndex = 0; chainIndex < sourceChains.length; chainIndex += 1) {
        const chain = normalizeHoleSourceChain2(
          sourceChains[chainIndex],
          `${featureID}:solid_section:${chainIndex + 1}`,
        );
        if (!chain) continue;
        sectionSourceEdges.push({
          id: chain.id || `${featureID}:solid_section:${chainIndex + 1}`,
          polyline: chain.polyline.map((point) => [point[0], point[1]]),
        });
      }
    }
    const cutLoopSources = cutLoops.map((loop, loopIndex) => (
      deriveLoopSourceChains2(loop, sectionSourceEdges, `${featureID}:solid_section:${loopIndex + 1}`)
    ));

    const sourceIds = new Set();
    for (const entry of cutEntries) {
      for (const sourceId of Array.isArray(entry?.sourceIds) ? entry.sourceIds : []) {
        if (sourceId) sourceIds.add(String(sourceId));
      }
    }

    const cutResult = applyCutLoopsToFlat(flat, cutLoops, featureID, usedIds, cutLoopSources);
    if (!cutResult?.applied) {
      summary.skipped += 1;
      summary.skippedLoops.push({
        flatId: String(flat?.id || ""),
        reason: cutResult?.reason || "cut_apply_failed",
        topSectionCount: topLoops.length,
        bottomSectionCount: bottomLoops.length,
      });
      continue;
    }

    summary.applied += 1;
    summary.assignments.push({
      flatId: String(flat?.id || ""),
      projectionMode: "solid_top_bottom_sections",
      topSectionCount: topLoops.length,
      bottomSectionCount: bottomLoops.length,
      unionLoopCount: Math.max(0, toFiniteNumber(cutResult.totalHoleCount, 0) | 0),
      sourceGroupCount: sourceIds.size,
      holeCount: Math.max(0, toFiniteNumber(cutResult.holeCount, 0) | 0),
      totalHoleCount: Math.max(0, toFiniteNumber(cutResult.totalHoleCount, 0) | 0),
      createdHoleCount: Array.isArray(cutResult.createdHoleIds) ? cutResult.createdHoleIds.length : 0,
      holeIds: Array.isArray(cutResult.createdHoleIds) ? cutResult.createdHoleIds.slice() : [],
      outerChanged: !!cutResult.outerChanged,
    });
  }

  if (summary.requestedLoops <= 0) {
    summary.skippedLoops.push({ reason: "no_flat_sections" });
  }
  return summary;
}

export {
  appendSegmentToPolyline,
  applyCutLoopsToFlat,
  applySolidCutoutToTree,
  buildEdgeSegmentSourceIndex,
  cloneEdgeMetadataForSplit,
  cloneHoleSourceChains2,
  collapseLinearOutlineSpanForEdge,
  collectFlatHoleLoops,
  computeLoopNormal3,
  dedupeConsecutivePoints2,
  dedupeConsecutivePoints3,
  findSourceEdgeForSegment,
  holeOutlineFromEntry,
  isSamePoint3,
  normalizeHoleSourceChain2,
  normalizeLoop2,
  orientPolylineLikeEdge,
  pointInPolygon2,
  polygonMostlyInsidePolygon,
  polygonsOverlap2,
  polylineIsLinear2,
  polylineLength2D,
  projectLoopToFlatMidplane,
  rebuildFlatOuterEdgesFromOutline,
  removeCutoutHolesFromTree,
  restoreFlatEdgeBoundaryVertices,
  signedArea2D,
  simplifyCollinearPolyline2,
  synchronizeBendAttachEdgeSubdivision,
  unionFilledLoops2,
};

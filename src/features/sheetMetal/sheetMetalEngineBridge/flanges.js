import * as THREE from "three";
import {
  OVERLAP_RELIEF_GAP,
  EPS,
  MIN_LEG,
  MIN_THICKNESS,
  POINT_EPS,
  clamp,
  cloneTree,
  matrixFromAny,
  normalizeSelectionArray,
  toFiniteNumber,
} from "./shared.js";
import {
  appendSegmentToPolyline,
  buildEdgeSegmentSourceIndex,
  cloneEdgeMetadataForSplit,
  collapseLinearOutlineSpanForEdge,
  collectFlatHoleLoops,
  dedupeConsecutivePoints2,
  findSourceEdgeForSegment,
  holeOutlineFromEntry,
  normalizeLoop2,
  orientPolylineLikeEdge,
  pointInPolygon2,
  polylineIsLinear2,
  polylineLength2D,
  rebuildFlatOuterEdgesFromOutline,
  restoreFlatEdgeBoundaryVertices,
  signedArea2D,
  simplifyCollinearPolyline2,
  synchronizeBendAttachEdgeSubdivision,
} from "./cutoutTree.js";
import { colorFromString } from "./profiles.js";
import {
  carryOverInternalCutoutEdges,
  cloneFlatEdge,
  collectTreeIds,
  copyPoint2,
  ensureFlatEdgeForHoleSegment,
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
} from "./treeCore.js";

function trimHoleEdgeSpanForFlange(flat, targetEdge, startSetback, endSetback) {
  const requestedStart = Math.max(0, toFiniteNumber(startSetback, 0));
  const requestedEnd = Math.max(0, toFiniteNumber(endSetback, 0));
  if (!(requestedStart > POINT_EPS || requestedEnd > POINT_EPS)) {
    return {
      edge: targetEdge,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
    };
  }
  if (!flat || !targetEdge) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "invalid_flat_or_edge",
    };
  }

  const rawHoles = Array.isArray(flat?.holes) ? flat.holes : [];
  if (!rawHoles.length) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "no_holes_on_flat",
    };
  }

  const edgeInfoById = findHoleSegmentByEdgeId(flat, targetEdge?.id);
  const targetHoleId = targetEdge?.holeId != null
    ? String(targetEdge.holeId)
    : (edgeInfoById?.holeId != null ? String(edgeInfoById.holeId) : null);
  let targetSegmentIndex = targetEdge?.holeEdgeIndex != null
    ? Math.max(0, (toFiniteNumber(targetEdge.holeEdgeIndex, 1) | 0) - 1)
    : null;
  if (targetSegmentIndex == null && edgeInfoById?.edgeIndex != null) {
    targetSegmentIndex = Math.max(0, (toFiniteNumber(edgeInfoById.edgeIndex, 1) | 0) - 1);
  }

  let chosen = null;
  for (let holeIdx = 0; holeIdx < rawHoles.length; holeIdx += 1) {
    const rawEntry = rawHoles[holeIdx];
    const holeId = String(rawEntry?.id || `${flat.id}:hole_${holeIdx + 1}`);
    if (targetHoleId && holeId !== targetHoleId) continue;

    const loop = normalizeLoop2(holeOutlineFromEntry(rawEntry));
    if (loop.length < 3) continue;

    let segIndex = null;
    if (targetSegmentIndex != null && targetSegmentIndex >= 0 && targetSegmentIndex < loop.length) {
      segIndex = targetSegmentIndex;
    } else {
      segIndex = findBestMatchingSegmentIndex(loop, targetEdge?.polyline);
    }
    if (segIndex == null) continue;

    chosen = {
      holeIdx,
      rawEntry,
      holeId,
      loop,
      segIndex,
      a: copyPoint2(loop[segIndex]),
      b: copyPoint2(loop[(segIndex + 1) % loop.length]),
    };
    break;
  }

  if (!chosen) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "hole_segment_not_found",
    };
  }

  const dx = chosen.b[0] - chosen.a[0];
  const dy = chosen.b[1] - chosen.a[1];
  const segLen = Math.hypot(dx, dy);
  if (!(segLen > EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "degenerate_segment",
    };
  }

  const maxSetbackSum = Math.max(0, segLen - MIN_LEG);
  if ((requestedStart + requestedEnd) > (maxSetbackSum + POINT_EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "setback_exceeds_edge_length",
      edgeLength: segLen,
    };
  }

  const appliedStart = Math.min(requestedStart, maxSetbackSum);
  const appliedEnd = Math.min(requestedEnd, Math.max(0, maxSetbackSum - appliedStart));
  const ux = dx / segLen;
  const uy = dy / segLen;

  const trimmedStart = [
    chosen.a[0] + (ux * appliedStart),
    chosen.a[1] + (uy * appliedStart),
  ];
  const trimmedEnd = [
    chosen.b[0] - (ux * appliedEnd),
    chosen.b[1] - (uy * appliedEnd),
  ];
  if (!(segmentLength2(trimmedStart, trimmedEnd) > POINT_EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "degenerate_trimmed_segment",
    };
  }

  const rebuiltPoints = [];
  let bridgeCount = 0;
  for (let i = 0; i < chosen.loop.length; i += 1) {
    const point = chosen.loop[i];
    const next = chosen.loop[(i + 1) % chosen.loop.length];
    rebuiltPoints.push(copyPoint2(point));
    if (i !== chosen.segIndex) continue;

    if (segmentLength2(point, trimmedStart) > POINT_EPS) {
      rebuiltPoints.push(copyPoint2(trimmedStart));
      bridgeCount += 1;
    }
    if (segmentLength2(trimmedStart, trimmedEnd) > POINT_EPS) {
      rebuiltPoints.push(copyPoint2(trimmedEnd));
    }
    if (segmentLength2(trimmedEnd, next) > POINT_EPS) {
      bridgeCount += 1;
    }
  }

  const rebuiltLoop = normalizeLoop2(rebuiltPoints);
  if (rebuiltLoop.length < 3) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "invalid_rebuilt_hole_loop",
    };
  }

  const updateRaw = chosen.rawEntry;
  if (Array.isArray(updateRaw)) {
    rawHoles[chosen.holeIdx] = rebuiltLoop.map((point) => [point[0], point[1]]);
  } else if (updateRaw && typeof updateRaw === "object") {
    updateRaw.outline = rebuiltLoop.map((point) => [point[0], point[1]]);
  } else {
    rawHoles[chosen.holeIdx] = {
      id: chosen.holeId,
      outline: rebuiltLoop.map((point) => [point[0], point[1]]),
    };
  }

  const edgePolyline = Array.isArray(targetEdge?.polyline) ? targetEdge.polyline : null;
  const originalStart = edgePolyline?.[0] || chosen.a;
  const originalEnd = edgePolyline?.[edgePolyline.length - 1] || chosen.b;
  const sameDirScore = pointDistance2(originalStart, chosen.a) + pointDistance2(originalEnd, chosen.b);
  const reverseScore = pointDistance2(originalStart, chosen.b) + pointDistance2(originalEnd, chosen.a);
  const keepForward = sameDirScore <= reverseScore;
  const rebuiltEdgePolyline = keepForward
    ? [copyPoint2(trimmedStart), copyPoint2(trimmedEnd)]
    : [copyPoint2(trimmedEnd), copyPoint2(trimmedStart)];

  targetEdge.polyline = rebuiltEdgePolyline;
  targetEdge.isInternalCutoutEdge = true;
  targetEdge.holeId = chosen.holeId;
  targetEdge.holeEdgeSignature = segmentSignature2(trimmedStart, trimmedEnd);

  return {
    edge: targetEdge,
    modified: true,
    startSetbackApplied: appliedStart,
    endSetbackApplied: appliedEnd,
    bridgeCount,
  };
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

function interiorSideOfBoundaryLoop2(loop, edgeStart, edgeEnd) {
  if (!Array.isArray(loop) || loop.length < 3) return 1;
  const start = copyPoint2(edgeStart);
  const end = copyPoint2(edgeEnd);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const edgeLen = Math.hypot(dx, dy);
  if (!(edgeLen > EPS)) return 1;

  const edgeDir = [dx / edgeLen, dy / edgeLen];
  const leftNormal = [-edgeDir[1], edgeDir[0]];
  const edgeMid = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of loop) {
    minX = Math.min(minX, toFiniteNumber(point?.[0]));
    minY = Math.min(minY, toFiniteNumber(point?.[1]));
    maxX = Math.max(maxX, toFiniteNumber(point?.[0]));
    maxY = Math.max(maxY, toFiniteNumber(point?.[1]));
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  const probeDistance = Math.max(POINT_EPS * 2, diagonal * 1e-5, edgeLen * 1e-5);
  const probeLeft = [edgeMid[0] + leftNormal[0] * probeDistance, edgeMid[1] + leftNormal[1] * probeDistance];
  const probeRight = [edgeMid[0] - leftNormal[0] * probeDistance, edgeMid[1] - leftNormal[1] * probeDistance];
  const insideLeft = pointInPolygon2(probeLeft, loop);
  const insideRight = pointInPolygon2(probeRight, loop);
  if (insideLeft !== insideRight) return insideLeft ? 1 : -1;

  const centroid = polygonCentroid2(loop);
  const toCenter = [centroid[0] - edgeMid[0], centroid[1] - edgeMid[1]];
  const dot = (leftNormal[0] * toCenter[0]) + (leftNormal[1] * toCenter[1]);
  return dot >= 0 ? 1 : -1;
}

function interiorSideOfFlatEdge2(flat, edge) {
  if (!flat || !edge || !Array.isArray(edge?.polyline) || edge.polyline.length < 2) return 1;
  const start = edge.polyline[0];
  const end = edge.polyline[edge.polyline.length - 1];

  if (isInternalCutoutLikeEdge(edge)) {
    const holes = collectFlatHoleLoops(flat);
    let holeLoop = null;
    const edgeHoleId = edge?.holeId != null ? String(edge.holeId) : null;
    if (edgeHoleId) {
      const hole = holes.find((entry) => String(entry?.id) === edgeHoleId);
      if (hole?.loop) holeLoop = hole.loop;
    }
    if (!holeLoop && edge?.id != null) {
      const segment = findHoleSegmentByEdgeId(flat, edge.id);
      if (segment?.holeId != null) {
        const hole = holes.find((entry) => String(entry?.id) === String(segment.holeId));
        if (hole?.loop) holeLoop = hole.loop;
      }
    }
    if (holeLoop) return -interiorSideOfBoundaryLoop2(holeLoop, start, end);
  }

  const outer = normalizeLoop2(flat?.outline);
  if (!outer.length) return 1;
  return interiorSideOfBoundaryLoop2(outer, start, end);
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
  const sourceIndex = buildEdgeSegmentSourceIndex(oldEdges, { skipInternalCutout: true });
  const findExistingEdgeBySegment = (a, b, excludeId = null) => {
    return findSourceEdgeForSegment(a, b, sourceIndex, excludeId);
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

  const consumedSourceIds = new Set();
  const newEdges = [];
  let activeExistingRun = null;
  let bridgeCount = 0;
  for (const entry of filteredDefs) {
    if (entry.kind === "target") {
      activeExistingRun = null;
      const targetPolyline = match.reversed
        ? [copyPoint2(entry.b), copyPoint2(entry.a)]
        : [copyPoint2(entry.a), copyPoint2(entry.b)];
      const rebuilt = { ...(targetEdge || {}), polyline: targetPolyline };
      newEdges.push(rebuilt);
      if (targetEdge?.id != null) consumedSourceIds.add(String(targetEdge.id));
      continue;
    }

    if (entry.kind === "existing") {
      const reuseA = Array.isArray(entry.reuseA) ? entry.reuseA : entry.a;
      const reuseB = Array.isArray(entry.reuseB) ? entry.reuseB : entry.b;
      const sourceEdge = findSourceEdgeForSegment(reuseA, reuseB, sourceIndex, targetEdge?.id ?? null);
      const sourceId = sourceEdge?.id != null ? String(sourceEdge.id) : null;
      if (
        activeExistingRun
        && activeExistingRun.sourceId === (sourceId || null)
        && appendSegmentToPolyline(activeExistingRun.edge.polyline, entry.a, entry.b)
      ) {
        continue;
      }

      if (sourceEdge && sourceId && !consumedSourceIds.has(sourceId)) {
        const rebuilt = {
          ...sourceEdge,
          polyline: orientPolylineLikeEdge([entry.a, entry.b], sourceEdge),
        };
        newEdges.push(rebuilt);
        consumedSourceIds.add(sourceId);
        activeExistingRun = { sourceId, edge: rebuilt };
      } else if (sourceEdge) {
        const splitId = uniqueId(`${sourceId || flat.id}:split`, usedIds);
        const rebuilt = {
          ...cloneEdgeMetadataForSplit(sourceEdge),
          id: splitId,
          polyline: orientPolylineLikeEdge([entry.a, entry.b], sourceEdge),
        };
        newEdges.push(rebuilt);
        activeExistingRun = { sourceId: sourceId || null, edge: rebuilt };
      } else {
        const fallbackId = uniqueId(`${flat.id}:edge`, usedIds);
        const rebuilt = { id: fallbackId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] };
        newEdges.push(rebuilt);
        activeExistingRun = { sourceId: null, edge: rebuilt };
      }
      continue;
    }

    activeExistingRun = null;
    bridgeCount += 1;
    const bridgeId = uniqueId(`${targetEdge?.id || flat.id}:bridge`, usedIds);
    newEdges.push({ id: bridgeId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] });
  }
  const carryOverEdges = carryOverInternalCutoutEdges(oldEdges, newEdges);
  if (carryOverEdges.length) newEdges.push(...carryOverEdges);

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

function trimFlatEdgeSpanForFlange(flat, targetEdge, startSetback, endSetback, usedIds) {
  const requestedStart = Math.max(0, toFiniteNumber(startSetback, 0));
  const requestedEnd = Math.max(0, toFiniteNumber(endSetback, 0));
  if (!(requestedStart > POINT_EPS || requestedEnd > POINT_EPS)) {
    return {
      edge: targetEdge,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
    };
  }
  if (!flat || !targetEdge) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "invalid_flat_or_edge",
    };
  }

  const outline = Array.isArray(flat.outline) ? flat.outline.map((point) => copyPoint2(point)) : [];
  if (outline.length < 3) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "invalid_outline",
    };
  }

  const match = findOutlineSegmentForEdge(flat, targetEdge);
  if (!match) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "segment_not_found",
    };
  }

  const dx = match.end[0] - match.start[0];
  const dy = match.end[1] - match.start[1];
  const segLen = Math.hypot(dx, dy);
  if (!(segLen > EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "degenerate_segment",
    };
  }

  const maxSetbackSum = Math.max(0, segLen - MIN_LEG);
  if ((requestedStart + requestedEnd) > (maxSetbackSum + POINT_EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "setback_exceeds_edge_length",
      edgeLength: segLen,
    };
  }

  const appliedStart = Math.min(requestedStart, maxSetbackSum);
  const appliedEnd = Math.min(requestedEnd, Math.max(0, maxSetbackSum - appliedStart));
  const ux = dx / segLen;
  const uy = dy / segLen;

  const trimmedStart = [
    match.start[0] + (ux * appliedStart),
    match.start[1] + (uy * appliedStart),
  ];
  const trimmedEnd = [
    match.end[0] - (ux * appliedEnd),
    match.end[1] - (uy * appliedEnd),
  ];
  if (!(segmentLength2(trimmedStart, trimmedEnd) > POINT_EPS)) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "degenerate_trimmed_segment",
    };
  }

  const edgeDefs = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (i !== match.index) {
      edgeDefs.push({ kind: "existing", a: copyPoint2(a), b: copyPoint2(b) });
      continue;
    }
    if (segmentLength2(a, trimmedStart) > POINT_EPS) {
      edgeDefs.push({ kind: "bridge_start", a: copyPoint2(a), b: copyPoint2(trimmedStart) });
    }
    edgeDefs.push({ kind: "target", a: copyPoint2(trimmedStart), b: copyPoint2(trimmedEnd) });
    if (segmentLength2(trimmedEnd, b) > POINT_EPS) {
      edgeDefs.push({ kind: "bridge_end", a: copyPoint2(trimmedEnd), b: copyPoint2(b) });
    }
  }

  const filteredDefs = edgeDefs.filter((entry) => segmentLength2(entry.a, entry.b) >= POINT_EPS);
  if (filteredDefs.length < 3) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "insufficient_segments",
    };
  }

  const oldEdges = Array.isArray(flat.edges) ? flat.edges : [];
  const sourceIndex = buildEdgeSegmentSourceIndex(oldEdges, { skipInternalCutout: true });

  const idSeed = targetEdge?.id || flat.id || "edge";
  const consumedSourceIds = new Set();
  const newEdges = [];
  let activeExistingRun = null;
  let bridgeCount = 0;
  for (const entry of filteredDefs) {
    if (entry.kind === "target") {
      activeExistingRun = null;
      const targetPolyline = match.reversed
        ? [copyPoint2(entry.b), copyPoint2(entry.a)]
        : [copyPoint2(entry.a), copyPoint2(entry.b)];
      const rebuilt = { ...(targetEdge || {}), polyline: targetPolyline };
      newEdges.push(rebuilt);
      if (targetEdge?.id != null) consumedSourceIds.add(String(targetEdge.id));
      continue;
    }

    if (entry.kind === "existing") {
      const sourceEdge = findSourceEdgeForSegment(entry.a, entry.b, sourceIndex, targetEdge?.id ?? null);
      const sourceId = sourceEdge?.id != null ? String(sourceEdge.id) : null;
      if (
        activeExistingRun
        && activeExistingRun.sourceId === (sourceId || null)
        && appendSegmentToPolyline(activeExistingRun.edge.polyline, entry.a, entry.b)
      ) {
        continue;
      }

      if (sourceEdge && sourceId && !consumedSourceIds.has(sourceId)) {
        const rebuilt = {
          ...sourceEdge,
          polyline: orientPolylineLikeEdge([entry.a, entry.b], sourceEdge),
        };
        newEdges.push(rebuilt);
        consumedSourceIds.add(sourceId);
        activeExistingRun = { sourceId, edge: rebuilt };
      } else if (sourceEdge) {
        const splitId = uniqueId(`${sourceId || flat.id}:split`, usedIds);
        const rebuilt = {
          ...cloneEdgeMetadataForSplit(sourceEdge),
          id: splitId,
          polyline: orientPolylineLikeEdge([entry.a, entry.b], sourceEdge),
        };
        newEdges.push(rebuilt);
        activeExistingRun = { sourceId: sourceId || null, edge: rebuilt };
      } else {
        const fallbackId = uniqueId(`${flat.id}:edge`, usedIds);
        const rebuilt = { id: fallbackId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] };
        newEdges.push(rebuilt);
        activeExistingRun = { sourceId: null, edge: rebuilt };
      }
      continue;
    }

    activeExistingRun = null;
    bridgeCount += 1;
    const bridgeId = uniqueId(`${idSeed}:bridge`, usedIds);
    newEdges.push({ id: bridgeId, polyline: [copyPoint2(entry.a), copyPoint2(entry.b)] });
  }
  const carryOverEdges = carryOverInternalCutoutEdges(oldEdges, newEdges);
  if (carryOverEdges.length) newEdges.push(...carryOverEdges);

  const rebuiltOutline = [copyPoint2(filteredDefs[0].a), ...filteredDefs.map((entry) => copyPoint2(entry.b))];
  if (rebuiltOutline.length >= 2) {
    const first = rebuiltOutline[0];
    const last = rebuiltOutline[rebuiltOutline.length - 1];
    if (pointDistance2(first, last) <= POINT_EPS) rebuiltOutline.pop();
  }
  if (rebuiltOutline.length < 3) {
    return {
      edge: null,
      modified: false,
      startSetbackApplied: 0,
      endSetbackApplied: 0,
      bridgeCount: 0,
      reason: "invalid_rebuilt_outline",
    };
  }

  flat.outline = rebuiltOutline;
  flat.edges = newEdges;
  const trimmedEdge = newEdges.find((edge) => String(edge?.id) === String(targetEdge?.id)) || null;
  return {
    edge: trimmedEdge || targetEdge,
    modified: true,
    startSetbackApplied: appliedStart,
    endSetbackApplied: appliedEnd,
    bridgeCount,
  };
}

function chooseDefaultEdge(flat) {
  const edges = Array.isArray(flat?.edges) ? flat.edges : [];
  const candidates = edges.filter((edge) => (
    edge
    && !edge.bend
    && !edge.isAttachEdge
    && !edge.isInternalCutoutEdge
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
  const explicitSheetSelections = normalizeSelectionArray(sheetSelections);

  // Priority 1: explicit sheet target field
  const fromSheet = resolveSheetSourceFromSelections(explicitSheetSelections);
  if (fromSheet) return { source: fromSheet, resolution: "explicit_sheet" };
  if (explicitSheetSelections.length > 0) {
    return { source: null, resolution: "invalid_explicit_sheet" };
  }

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

function isSketchOwnedSelection(selection) {
  if (!selection || typeof selection !== "object") return false;
  if (String(selection?.type || "").toUpperCase() === "SKETCH") return true;
  if (String(selection?.parent?.type || "").toUpperCase() === "SKETCH") return true;
  return false;
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

  if (
    merged
    && merged.edgeId == null
    && String(merged.kind || "").trim().toLowerCase() === "flat_cutout_wall"
    && merged.flatId != null
    && merged.holeId != null
    && merged.edgeIndex != null
  ) {
    merged.edgeId = makeHoleSegmentEdgeId(merged.flatId, merged.holeId, merged.edgeIndex);
  }

  return Object.keys(merged).length ? merged : null;
}

function profileReferencesTargetSheetFace(profileSelections, targetCarrier) {
  if (!targetCarrier) return false;
  const selections = normalizeSelectionArray(profileSelections);
  for (const selection of selections) {
    if (!selection || typeof selection !== "object") continue;
    const type = String(selection.type || "").toUpperCase();
    if (type !== "FACE") continue;
    if (isSketchOwnedSelection(selection)) continue;
    const carrier = resolveCarrierFromObject(selection);
    if (!carrier || carrier !== targetCarrier) continue;
    const smMeta = readSelectionSheetMetalMetadata(selection);
    if (smMeta?.flatId || smMeta?.edgeId || smMeta?.bendId || smMeta?.kind) return true;
  }
  return false;
}

function resolveEdgeTargets(selections, tree, carrier) {
  const targets = [];
  const seen = new Set();
  let hadExplicitSelection = false;

  for (const selection of normalizeSelectionArray(selections)) {
    if (!selection || typeof selection !== "object") continue;
    const selectionCarrier = resolveCarrierFromObject(selection);
    if (!selectionCarrier || selectionCarrier !== carrier) continue;

    const meta = readSelectionSheetMetalMetadata(selection) || {};
    const flatId = meta.flatId || null;
    const edgeId = meta.edgeId || null;
    if (!flatId) continue;
    hadExplicitSelection = true;

    const flat = findFlatById(tree.root, flatId);
    if (!flat) continue;

    if (edgeId) {
      const key = `${flat.id}|${String(edgeId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ flatId: flat.id, edgeId: String(edgeId) });
      continue;
    }

    const edge = chooseDefaultEdge(flat);
    if (!edge) continue;
    const key = `${flat.id}|${edge.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ flatId: flat.id, edgeId: edge.id });
  }

  if (targets.length) return targets;
  if (hadExplicitSelection) return targets;

  const rootFlat = tree?.root;
  const defaultEdge = chooseDefaultEdge(rootFlat);
  if (rootFlat && defaultEdge) {
    targets.push({ flatId: rootFlat.id, edgeId: defaultEdge.id });
  }
  return targets;
}

function resolveSheetMetalCornerFilletTargets(selections, edgeSelections, tree, carrier) {
  const targets = [];
  const seen = new Set();

  const normalizeSelectionToken = (token) => String(token || "").trim().replace(/\[\d+\]$/, "");

  const parseStringReferenceTarget = (token) => {
    const text = normalizeSelectionToken(token);
    if (!text) return null;
    const flatMarker = ":FLAT:";
    const sideMarker = ":SIDE:";
    const cutoutMarker = ":CUTOUT:";
    const edgeMarker = ":EDGE:";
    const flatPos = text.indexOf(flatMarker);
    if (flatPos < 0) return null;
    const carrierName = flatPos > 0 ? text.slice(0, flatPos) : null;
    const flatStart = flatPos + flatMarker.length;
    const sidePos = text.indexOf(sideMarker, flatStart);
    if (sidePos > flatStart) {
      const flatId = text.slice(flatStart, sidePos);
      const edgeId = text.slice(sidePos + sideMarker.length);
      if (flatId && edgeId) return { carrierName, flatId, edgeId };
      return null;
    }

    const cutoutPos = text.indexOf(cutoutMarker, flatStart);
    if (cutoutPos > flatStart) {
      const flatId = text.slice(flatStart, cutoutPos);
      const edgePos = text.indexOf(edgeMarker, cutoutPos + cutoutMarker.length);
      if (edgePos > cutoutPos) {
        const holeId = text.slice(cutoutPos + cutoutMarker.length, edgePos);
        const edgeIndexRaw = text.slice(edgePos + edgeMarker.length);
        const edgeIndex = Math.max(1, toFiniteNumber(edgeIndexRaw, 1) | 0);
        if (flatId && holeId) {
          return { carrierName, flatId, edgeId: makeHoleSegmentEdgeId(flatId, holeId, edgeIndex) };
        }
      }
    }
    return null;
  };

  const carrierNameMatches = (name) => {
    if (!name) return true;
    const carrierName = String(carrier?.name || "");
    if (!carrierName) return true;
    return String(name) === carrierName;
  };

  const resolveSelectionCarrier = (selection) => {
    if (!selection || typeof selection !== "object") return null;
    const directSolid = selection?.parentSolid;
    if (directSolid?.userData?.sheetMetalModel?.tree) return directSolid;
    const fromSolidParent = resolveCarrierFromObject(directSolid);
    if (fromSolidParent) return fromSolidParent;
    return resolveCarrierFromObject(selection);
  };

  const pushEdgeTarget = (flatIdRaw, edgeIdRaw) => {
    const flatId = flatIdRaw != null ? String(flatIdRaw) : null;
    const edgeId = edgeIdRaw != null ? String(edgeIdRaw) : null;
    if (!flatId || !edgeId) return;
    const flat = findFlatById(tree?.root, flatId);
    if (!flat) return;
    const key = `${flatId}|${edgeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ flatId, edgeId });
  };

  const pushCornerTarget = (flatIdRaw, cornerEdgeIdsRaw) => {
    const flatId = flatIdRaw != null ? String(flatIdRaw) : null;
    if (!flatId) return;
    const flat = findFlatById(tree?.root, flatId);
    if (!flat) return;
    const edgeIds = Array.isArray(cornerEdgeIdsRaw)
      ? cornerEdgeIdsRaw.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (edgeIds.length < 2) return;
    const unique = [];
    const seenEdges = new Set();
    for (const edgeId of edgeIds) {
      if (seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      unique.push(edgeId);
    }
    if (unique.length < 2) return;
    const pair = unique.slice(0, 2);
    const signature = pair.slice().sort().join("&");
    const key = `${flatId}|corner|${signature}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ flatId, cornerEdgeIds: pair });
  };

  const parseCornerPairReferenceTarget = (value) => {
    if (typeof value !== "string") return null;
    if (!value.includes("|")) return null;
    const tokens = value.split("|").map((token) => String(token || "").trim()).filter(Boolean);
    if (tokens.length < 2) return null;
    const parsed = [];
    for (const token of tokens) {
      const entry = parseStringReferenceTarget(token);
      if (!entry) continue;
      if (!carrierNameMatches(entry.carrierName)) continue;
      parsed.push(entry);
    }
    if (parsed.length < 2) return null;
    const flatId = parsed[0].flatId;
    if (!flatId) return null;
    for (let i = 1; i < parsed.length; i += 1) {
      if (String(parsed[i].flatId || "") !== String(flatId)) return null;
    }
    const edgeIds = [];
    const seenEdges = new Set();
    for (const entry of parsed) {
      const edgeId = String(entry.edgeId || "").trim();
      if (!edgeId || seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      edgeIds.push(edgeId);
    }
    if (edgeIds.length < 2) return null;
    return { flatId, cornerEdgeIds: edgeIds.slice(0, 2) };
  };

  const resolveObjectTarget = (selection) => {
    if (!selection || typeof selection !== "object") return;
    const cornerFromName = parseCornerPairReferenceTarget(selection?.name)
      || parseCornerPairReferenceTarget(selection?.userData?.edgeName)
      || parseCornerPairReferenceTarget(selection?.userData?.faceName);
    if (cornerFromName) {
      pushCornerTarget(cornerFromName.flatId, cornerFromName.cornerEdgeIds);
      return;
    }

    const selectionCarrier = resolveSelectionCarrier(selection);
    if (!selectionCarrier || selectionCarrier === carrier) {
      const meta = readSelectionSheetMetalMetadata(selection) || {};
      if (meta.flatId && meta.edgeId) {
        pushEdgeTarget(meta.flatId, meta.edgeId);
        return;
      }
      if (meta.flatId && meta.defaultEdgeId) {
        pushEdgeTarget(meta.flatId, meta.defaultEdgeId);
        return;
      }
      if (meta.kind && String(meta.kind).toLowerCase() === "flat_edge_wall" && meta.flatId && meta.edgeId) {
        pushEdgeTarget(meta.flatId, meta.edgeId);
        return;
      }
    }

    resolveStringTarget(selection?.name);
    resolveStringTarget(selection?.userData?.edgeName);
    resolveStringTarget(selection?.userData?.faceName);
  };

  const resolveStringTarget = (value) => {
    if (typeof value !== "string") return;
    const cornerPair = parseCornerPairReferenceTarget(value);
    if (cornerPair) {
      pushCornerTarget(cornerPair.flatId, cornerPair.cornerEdgeIds);
      return;
    }
    const tokens = value.includes("|") ? value.split("|") : [value];
    for (const token of tokens) {
      const parsed = parseStringReferenceTarget(token);
      if (!parsed) continue;
      if (!carrierNameMatches(parsed.carrierName)) continue;
      pushEdgeTarget(parsed.flatId, parsed.edgeId);
    }
  };

  for (const edge of normalizeSelectionArray(edgeSelections)) {
    if (typeof edge === "string") resolveStringTarget(edge);
    else resolveObjectTarget(edge);
  }
  for (const selection of normalizeSelectionArray(selections)) {
    if (typeof selection === "string") resolveStringTarget(selection);
    else resolveObjectTarget(selection);
  }

  return targets;
}

function findNearestLoopVertexIndex(loop, anchor, tolerance = POINT_EPS * 8) {
  if (!Array.isArray(loop) || loop.length < 3 || !Array.isArray(anchor) || anchor.length < 2) return -1;
  const target = copyPoint2(anchor);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < loop.length; i += 1) {
    const dist = pointDistance2(loop[i], target);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }
  return bestDistance <= Math.max(POINT_EPS, toFiniteNumber(tolerance, POINT_EPS * 8)) ? bestIndex : -1;
}

function unwrapAngleDelta(start, end, preferCCW) {
  let delta = end - start;
  const fullTurn = Math.PI * 2;
  if (preferCCW) {
    while (delta <= 0) delta += fullTurn;
  } else {
    while (delta >= 0) delta -= fullTurn;
  }
  return delta;
}

function roundFlatOutlineCorner(loop, vertexIndex, radius, resolution = 32) {
  const sourceLoop = normalizeLoop2(loop);
  if (sourceLoop.length < 3) return { changed: false, reason: "invalid_loop" };
  const n = sourceLoop.length;
  const idx = ((toFiniteNumber(vertexIndex, 0) | 0) % n + n) % n;
  const prev = copyPoint2(sourceLoop[(idx - 1 + n) % n]);
  const curr = copyPoint2(sourceLoop[idx]);
  const next = copyPoint2(sourceLoop[(idx + 1) % n]);

  const lenPrev = segmentLength2(prev, curr);
  const lenNext = segmentLength2(curr, next);
  if (!(lenPrev > POINT_EPS) || !(lenNext > POINT_EPS)) {
    return { changed: false, reason: "degenerate_corner_edges" };
  }

  const dirPrev = [(prev[0] - curr[0]) / lenPrev, (prev[1] - curr[1]) / lenPrev];
  const dirNext = [(next[0] - curr[0]) / lenNext, (next[1] - curr[1]) / lenNext];
  const dot = clamp((dirPrev[0] * dirNext[0]) + (dirPrev[1] * dirNext[1]), -1, 1);
  const cornerAngle = Math.acos(dot);
  if (!(cornerAngle > THREE.MathUtils.degToRad(2)) || !(cornerAngle < (Math.PI - THREE.MathUtils.degToRad(2)))) {
    return { changed: false, reason: "unsupported_corner_angle" };
  }

  const turn = ((curr[0] - prev[0]) * (next[1] - curr[1])) - ((curr[1] - prev[1]) * (next[0] - curr[0]));
  const orientation = signedArea2D(sourceLoop) >= 0 ? 1 : -1;
  if ((turn * orientation) <= (POINT_EPS * 10)) {
    return { changed: false, reason: "non_convex_corner" };
  }

  const requestedRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (!(requestedRadius > POINT_EPS)) {
    return { changed: false, reason: "invalid_radius" };
  }

  const tanHalf = Math.tan(cornerAngle * 0.5);
  if (!(Math.abs(tanHalf) > EPS)) {
    return { changed: false, reason: "invalid_corner_geometry" };
  }

  let tangentDistance = requestedRadius / tanHalf;
  const maxTangentDistance = Math.max(POINT_EPS, Math.min(lenPrev, lenNext) - (POINT_EPS * 4));
  if (!(maxTangentDistance > POINT_EPS)) {
    return { changed: false, reason: "insufficient_edge_length" };
  }
  tangentDistance = Math.min(tangentDistance, maxTangentDistance);
  if (!(tangentDistance > POINT_EPS)) {
    return { changed: false, reason: "insufficient_effective_tangent_distance" };
  }

  const effectiveRadius = tangentDistance * tanHalf;
  if (!(effectiveRadius > POINT_EPS)) {
    return { changed: false, reason: "insufficient_effective_radius" };
  }

  const startPoint = [
    curr[0] + (dirPrev[0] * tangentDistance),
    curr[1] + (dirPrev[1] * tangentDistance),
  ];
  const endPoint = [
    curr[0] + (dirNext[0] * tangentDistance),
    curr[1] + (dirNext[1] * tangentDistance),
  ];
  if (segmentLength2(startPoint, endPoint) <= POINT_EPS) {
    return { changed: false, reason: "collapsed_fillet_span" };
  }

  const bisector = [dirPrev[0] + dirNext[0], dirPrev[1] + dirNext[1]];
  const bisectorLength = Math.hypot(bisector[0], bisector[1]);
  if (!(bisectorLength > POINT_EPS)) {
    return { changed: false, reason: "degenerate_bisector" };
  }
  const bisectorUnit = [bisector[0] / bisectorLength, bisector[1] / bisectorLength];
  const centerDistance = effectiveRadius / Math.sin(cornerAngle * 0.5);
  if (!(centerDistance > POINT_EPS)) {
    return { changed: false, reason: "invalid_center_distance" };
  }

  const preferCCW = turn > 0;
  const candidateCenters = [
    [curr[0] + bisectorUnit[0] * centerDistance, curr[1] + bisectorUnit[1] * centerDistance],
    [curr[0] - bisectorUnit[0] * centerDistance, curr[1] - bisectorUnit[1] * centerDistance],
  ];

  let chosen = null;
  for (const center of candidateCenters) {
    const startAngle = Math.atan2(startPoint[1] - center[1], startPoint[0] - center[0]);
    const endAngle = Math.atan2(endPoint[1] - center[1], endPoint[0] - center[0]);
    const delta = unwrapAngleDelta(startAngle, endAngle, preferCCW);
    const absDelta = Math.abs(delta);
    if (!(absDelta > THREE.MathUtils.degToRad(1)) || !(absDelta < (Math.PI - THREE.MathUtils.degToRad(1)))) continue;
    const midAngle = startAngle + delta * 0.5;
    const midPoint = [
      center[0] + Math.cos(midAngle) * effectiveRadius,
      center[1] + Math.sin(midAngle) * effectiveRadius,
    ];
    const score = pointDistance2(midPoint, curr);
    if (!chosen || score < chosen.score) {
      chosen = {
        center,
        startAngle,
        delta,
        score,
      };
    }
  }

  if (!chosen) {
    return { changed: false, reason: "failed_to_resolve_arc_center" };
  }

  const safeResolution = Math.max(8, Math.min(256, toFiniteNumber(resolution, 32) | 0));
  const arcSegments = Math.max(2, Math.ceil((Math.abs(chosen.delta) / (Math.PI * 2)) * safeResolution));
  const arcPoints = [];
  for (let i = 1; i < arcSegments; i += 1) {
    const t = i / arcSegments;
    const angle = chosen.startAngle + chosen.delta * t;
    arcPoints.push([
      chosen.center[0] + Math.cos(angle) * effectiveRadius,
      chosen.center[1] + Math.sin(angle) * effectiveRadius,
    ]);
  }

  const rebuilt = [];
  for (let i = 0; i < sourceLoop.length; i += 1) {
    if (i === idx) {
      rebuilt.push(copyPoint2(startPoint));
      for (const point of arcPoints) rebuilt.push(copyPoint2(point));
      rebuilt.push(copyPoint2(endPoint));
    } else {
      rebuilt.push(copyPoint2(sourceLoop[i]));
    }
  }

  const normalized = normalizeLoop2(rebuilt);
  if (normalized.length < 3) {
    return { changed: false, reason: "invalid_rebuilt_loop" };
  }

  return {
    changed: true,
    loop: normalized,
    effectiveRadius,
    arcSegmentCount: arcSegments,
    arcPolyline: [copyPoint2(startPoint), ...arcPoints.map((point) => copyPoint2(point)), copyPoint2(endPoint)],
  };
}

function applyCornerFilletsToTree(tree, featureID, targets, options = {}) {
  const safeRadius = Math.max(0, toFiniteNumber(options.radius, 0));
  const safeResolution = Math.max(8, Math.min(256, toFiniteNumber(options.resolution, 32) | 0));
  const usedIds = options.usedIds instanceof Set ? options.usedIds : collectTreeIds(tree);

  const summary = {
    requested: Array.isArray(targets) ? targets.length : 0,
    applied: 0,
    skipped: 0,
    appliedTargets: [],
    skippedTargets: [],
    appliedCorners: 0,
  };
  if (!(safeRadius > POINT_EPS)) {
    summary.skipped = summary.requested;
    for (const target of Array.isArray(targets) ? targets : []) {
      summary.skippedTargets.push({ ...target, reason: "invalid_radius" });
    }
    return summary;
  }

  const plansByFlatId = new Map();
  const targetList = Array.isArray(targets) ? targets : [];
  const addPlanAnchor = (plan, anchor) => {
    const safeAnchor = copyPoint2(anchor);
    const key = `${safeAnchor[0].toFixed(6)},${safeAnchor[1].toFixed(6)}`;
    if (!plan.cornerAnchorsByKey.has(key)) plan.cornerAnchorsByKey.set(key, safeAnchor);
  };
  const resolveOutlineEdgeMatch = (flat, edgeIdRaw) => {
    const edgeId = edgeIdRaw != null ? String(edgeIdRaw) : null;
    let edge = findEdgeById(flat, edgeId);
    if (!edge && edgeId) edge = ensureFlatEdgeForHoleSegment(flat, edgeId, usedIds);
    if (!edge) return { reason: "edge_not_found" };
    if (edge.bend || edge.isAttachEdge) return { reason: "edge_not_supported" };
    if (isInternalCutoutLikeEdge(edge)) return { reason: "internal_cutout_edge_not_supported" };
    const match = findOutlineSegmentForEdge(flat, edge);
    if (!match) return { reason: "edge_not_on_outer_outline" };
    return { edge, match };
  };
  const findSharedOutlineCorner = (outline, firstMatch, secondMatch) => {
    if (!Array.isArray(outline) || outline.length < 3 || !firstMatch || !secondMatch) return null;
    const safeLen = outline.length;
    const vertex = (index) => copyPoint2(outline[((index % safeLen) + safeLen) % safeLen]);
    const first = [vertex(firstMatch.index), vertex(firstMatch.index + 1)];
    const second = [vertex(secondMatch.index), vertex(secondMatch.index + 1)];
    const tol = Math.max(POINT_EPS * 8, 1e-5);
    for (const a of first) {
      for (const b of second) {
        if (pointDistance2(a, b) <= tol) {
          return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        }
      }
    }
    return null;
  };

  for (const target of targetList) {
    const flat = findFlatById(tree?.root, target?.flatId);
    if (!flat) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "flat_not_found" });
      continue;
    }

    const outline = normalizeLoop2(flat?.outline);
    if (outline.length < 3) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: "invalid_outline" });
      continue;
    }

    if (!plansByFlatId.has(flat.id)) {
      plansByFlatId.set(flat.id, {
        flat,
        cornerAnchorsByKey: new Map(),
        sources: [],
      });
    }
    const plan = plansByFlatId.get(flat.id);
    const cornerEdgeIds = Array.isArray(target?.cornerEdgeIds)
      ? target.cornerEdgeIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (cornerEdgeIds.length >= 2) {
      const firstEdge = resolveOutlineEdgeMatch(flat, cornerEdgeIds[0]);
      if (!firstEdge?.edge || !firstEdge?.match) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: firstEdge?.reason || "edge_not_found" });
        continue;
      }
      const secondEdge = resolveOutlineEdgeMatch(flat, cornerEdgeIds[1]);
      if (!secondEdge?.edge || !secondEdge?.match) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: secondEdge?.reason || "edge_not_found" });
        continue;
      }
      const sharedAnchor = findSharedOutlineCorner(outline, firstEdge.match, secondEdge.match);
      if (!sharedAnchor) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: "corner_pair_not_adjacent" });
        continue;
      }
      addPlanAnchor(plan, sharedAnchor);
      plan.sources.push({
        target,
        edgeId: `${firstEdge.edge.id}|${secondEdge.edge.id}`,
        cornerEdgeIds: [firstEdge.edge.id, secondEdge.edge.id],
        cornerMode: "pair",
      });
      continue;
    }

    const resolved = resolveOutlineEdgeMatch(flat, target?.edgeId);
    if (!resolved?.edge || !resolved?.match) {
      summary.skipped += 1;
      summary.skippedTargets.push({ ...target, reason: resolved?.reason || "edge_not_found" });
      continue;
    }
    const cornerIndices = [resolved.match.index, (resolved.match.index + 1) % outline.length];
    for (const index of cornerIndices) addPlanAnchor(plan, outline[index]);
    plan.sources.push({ target, edgeId: resolved.edge.id });
  }

  for (const [, plan] of plansByFlatId) {
    const flat = plan.flat;
    const baseOutline = normalizeLoop2(flat?.outline);
    if (baseOutline.length < 3) {
      for (const source of plan.sources) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...source.target, reason: "invalid_outline" });
      }
      continue;
    }

    const sourceIndex = buildEdgeSegmentSourceIndex(Array.isArray(flat.edges) ? flat.edges : [], { skipInternalCutout: true });
    const eligibleAnchors = [];
    const ineligibleAnchors = [];
    for (const anchor of plan.cornerAnchorsByKey.values()) {
      const idx = findNearestLoopVertexIndex(baseOutline, anchor, POINT_EPS * 12);
      if (idx < 0) {
        ineligibleAnchors.push({ anchor, reason: "corner_not_found" });
        continue;
      }
      const prev = baseOutline[(idx - 1 + baseOutline.length) % baseOutline.length];
      const curr = baseOutline[idx];
      const next = baseOutline[(idx + 1) % baseOutline.length];
      const prevEdge = findSourceEdgeForSegment(prev, curr, sourceIndex);
      const nextEdge = findSourceEdgeForSegment(curr, next, sourceIndex);
      if (prevEdge?.bend || prevEdge?.isAttachEdge || nextEdge?.bend || nextEdge?.isAttachEdge) {
        ineligibleAnchors.push({ anchor, reason: "corner_adjacent_to_bend_or_attach" });
        continue;
      }
      eligibleAnchors.push(anchor);
    }

    let workingLoop = baseOutline.map((point) => copyPoint2(point));
    let changedCorners = 0;
    const filletSourceChains = [];
    for (const anchor of eligibleAnchors) {
      const idx = findNearestLoopVertexIndex(workingLoop, anchor, POINT_EPS * 20);
      if (idx < 0) continue;
      const rounded = roundFlatOutlineCorner(workingLoop, idx, safeRadius, safeResolution);
      if (!rounded?.changed || !Array.isArray(rounded.loop) || rounded.loop.length < 3) continue;
      workingLoop = rounded.loop.map((point) => copyPoint2(point));
      changedCorners += 1;
      if (Array.isArray(rounded.arcPolyline) && rounded.arcPolyline.length >= 3) {
        filletSourceChains.push(rounded.arcPolyline.map((point) => copyPoint2(point)));
      }
    }

    if (changedCorners <= 0) {
      for (const source of plan.sources) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...source.target, reason: ineligibleAnchors[0]?.reason || "no_eligible_corners" });
      }
      continue;
    }

    const oldOutline = Array.isArray(flat.outline) ? flat.outline.map((point) => copyPoint2(point)) : [];
    const oldEdges = Array.isArray(flat.edges) ? flat.edges.map((edge) => cloneFlatEdge(edge)) : [];
    flat.outline = workingLoop.map((point) => copyPoint2(point));
    const rebuilt = rebuildFlatOuterEdgesFromOutline(
      flat,
      flat.outline,
      usedIds,
      filletSourceChains.length ? [filletSourceChains] : null,
    );
    if (!rebuilt?.changed) {
      flat.outline = oldOutline;
      flat.edges = oldEdges;
      for (const source of plan.sources) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...source.target, reason: rebuilt?.reason || "edge_rebuild_failed" });
      }
      continue;
    }

    summary.applied += plan.sources.length;
    summary.appliedCorners += changedCorners;
    for (const source of plan.sources) {
      summary.appliedTargets.push({
        ...source.target,
        edgeId: source.edgeId,
        radius: safeRadius,
        resolution: safeResolution,
        appliedCornerCount: changedCorners,
      });
    }
  }

  if (tree?.root) {
    restoreFlatEdgeBoundaryVertices(tree.root);
    synchronizeBendAttachEdgeSubdivision(tree.root);
  }

  return summary;
}

export {
  addFlangesToTree,
  applyCornerFilletsToTree,
  buildSheetSourceFromCarrier,
  chooseDefaultEdge,
  computeFlangeLengthReferenceSetback,
  normalizeFlangeInsetMode,
  normalizeFlangeLengthReference,
  profileReferencesTargetSheetFace,
  resolveCarrierFromObject,
  resolveEdgeTargets,
  resolveSheetMetalCornerFilletTargets,
  resolveSheetSourceFromSelections,
  resolveSheetSourceWithFallback,
};

function buildCanonicalFlangeAttachPolyline(parentEdge) {
  const source = dedupeConsecutivePoints2(
    (Array.isArray(parentEdge?.polyline) ? parentEdge.polyline : []).map((point) => copyPoint2(point)),
  );
  if (source.length < 2) return null;

  const start = source[0];
  const end = source[source.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const axisLen = Math.hypot(dx, dy);
  if (!(axisLen > EPS)) return null;

  const cos = dx / axisLen;
  const sin = dy / axisLen;
  const transformed = source.map((point, index) => {
    const vx = point[0] - start[0];
    const vy = point[1] - start[1];
    let x = (vx * cos) + (vy * sin);
    let y = (-vx * sin) + (vy * cos);
    if (index === 0) {
      x = 0;
      y = 0;
    } else if (index === source.length - 1) {
      x = axisLen;
      y = 0;
    }
    if (Math.abs(x) <= POINT_EPS) x = 0;
    if (Math.abs(y) <= POINT_EPS) y = 0;
    return [x, y];
  });

  const attach = simplifyCollinearPolyline2(transformed);
  if (attach.length < 2) return null;
  attach[0] = [0, 0];
  attach[attach.length - 1] = [axisLen, 0];
  if (!(polylineLength2D(attach) > EPS)) return null;
  return attach;
}

function makeFlangeChildFlat(featureID, parentEdge, legLength, colorSeed, usedIds, topOffsetSign = 1) {
  const attachPolyline = buildCanonicalFlangeAttachPolyline(parentEdge);
  if (!Array.isArray(attachPolyline) || attachPolyline.length < 2) return null;

  const length = Math.max(MIN_LEG, polylineLength2D(attachPolyline));
  if (!(length > EPS)) return null;

  const flatId = uniqueId(`${featureID}:flat`, usedIds);
  const attachEdgeId = uniqueId(`${flatId}:attach`, usedIds);
  const topEdgeId = uniqueId(`${flatId}:top`, usedIds);
  const leftEdgeId = uniqueId(`${flatId}:left`, usedIds);
  const rightEdgeId = uniqueId(`${flatId}:right`, usedIds);

  const safeLeg = Math.max(MIN_LEG, toFiniteNumber(legLength, 0));

  // Preserve legacy rectangular flange behavior for linear source edges.
  if (attachPolyline.length === 2) {
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

  // Keep non-linear flange section orientation deterministic in local +Y.
  // This avoids side-flip ambiguity from automatic offset-side selection.
  const safeTopSign = toFiniteNumber(topOffsetSign, 1) >= 0 ? 1 : -1;
  const topForward = dedupeConsecutivePoints2(
    attachPolyline.map((point) => [point[0], point[1] + (safeLeg * safeTopSign)]),
  );
  if (topForward.length < 2) return null;

  const attachStart = copyPoint2(attachPolyline[0]);
  const attachEnd = copyPoint2(attachPolyline[attachPolyline.length - 1]);
  const topStart = copyPoint2(topForward[0]);
  const topEnd = copyPoint2(topForward[topForward.length - 1]);
  if (segmentLength2(topStart, attachStart) <= POINT_EPS || segmentLength2(topEnd, attachEnd) <= POINT_EPS) {
    return null;
  }

  const topPolyline = topForward.slice().reverse().map((point) => copyPoint2(point));
  const leftPolyline = [copyPoint2(topStart), copyPoint2(attachStart)];
  const rightPolyline = [copyPoint2(attachEnd), copyPoint2(topEnd)];
  const outline = dedupeConsecutivePoints2([
    ...attachPolyline.map((point) => copyPoint2(point)),
    ...topPolyline.map((point) => copyPoint2(point)),
  ]);
  if (outline.length >= 2 && pointDistance2(outline[0], outline[outline.length - 1]) <= POINT_EPS) {
    outline.pop();
  }
  if (outline.length < 3) return null;

  const childFlat = {
    kind: "flat",
    id: flatId,
    label: `Flange ${flatId}`,
    color: colorFromString(colorSeed || flatId),
    outline,
    edges: [
      { id: attachEdgeId, isAttachEdge: true, polyline: attachPolyline.map((point) => copyPoint2(point)) },
      { id: topEdgeId, polyline: topPolyline },
      { id: leftEdgeId, polyline: leftPolyline },
      { id: rightEdgeId, polyline: rightPolyline },
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
  const edgeStartSetback = Math.max(0, toFiniteNumber(options.edgeStartSetback, 0));
  const edgeEndSetback = Math.max(0, toFiniteNumber(options.edgeEndSetback, 0));
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

    let edge = findEdgeById(flat, target.edgeId);
    if (!edge && target?.edgeId) {
      edge = ensureFlatEdgeForHoleSegment(flat, target.edgeId, usedIds);
    }
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
    let edgeStartSetbackApplied = 0;
    let edgeEndSetbackApplied = 0;
    let bridgeCount = 0;
    const isInternalCutoutEdge = !!parentEdge?.isInternalCutoutEdge;
    let supportsOutlineEdgeAdjustments = Array.isArray(parentEdge?.polyline) && parentEdge.polyline.length >= 2;
    if (
      supportsOutlineEdgeAdjustments
      && parentEdge.polyline.length > 2
      && !isInternalCutoutEdge
      && polylineIsLinear2(parentEdge.polyline)
    ) {
      collapseLinearOutlineSpanForEdge(flat, parentEdge);
    }
    supportsOutlineEdgeAdjustments = Array.isArray(parentEdge?.polyline) && parentEdge.polyline.length === 2;
    if (Math.abs(inwardEdgeShift) > POINT_EPS && !isInternalCutoutEdge && supportsOutlineEdgeAdjustments) {
      const moved = moveFlatEdgeForFlangeReference(flat, parentEdge, inwardEdgeShift, usedIds);
      if (!moved?.edge) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: moved?.reason || "edge_move_failed" });
        continue;
      }
      parentEdge = moved.edge;
      edgeShiftApplied = moved.moved ? toFiniteNumber(moved.shiftDistance, 0) : 0;
      bridgeCount = moved.moved ? toFiniteNumber(moved.bridgeCount, 0) : 0;
    }
    if ((edgeStartSetback > POINT_EPS || edgeEndSetback > POINT_EPS) && supportsOutlineEdgeAdjustments) {
      const trimmed = isInternalCutoutEdge
        ? trimHoleEdgeSpanForFlange(flat, parentEdge, edgeStartSetback, edgeEndSetback)
        : trimFlatEdgeSpanForFlange(flat, parentEdge, edgeStartSetback, edgeEndSetback, usedIds);
      if (!trimmed?.edge) {
        summary.skipped += 1;
        summary.skippedTargets.push({ ...target, reason: trimmed?.reason || "edge_span_trim_failed" });
        continue;
      }
      parentEdge = trimmed.edge;
      if (trimmed.modified) {
        edgeStartSetbackApplied = Math.max(0, toFiniteNumber(trimmed.startSetbackApplied, 0));
        edgeEndSetbackApplied = Math.max(0, toFiniteNumber(trimmed.endSetbackApplied, 0));
        bridgeCount += Math.max(0, toFiniteNumber(trimmed.bridgeCount, 0));
      }
    }

    const topOffsetSign = supportsOutlineEdgeAdjustments
      ? 1
      : (interiorSideOfFlatEdge2(flat, parentEdge) > 0 ? -1 : 1);
    const created = makeFlangeChildFlat(
      featureID,
      parentEdge,
      legLength,
      `${featureID}:${flat.id}:${parentEdge.id}:${i}`,
      usedIds,
      topOffsetSign,
    );
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
      edgeStartSetback,
      edgeEndSetback,
      edgeStartSetbackApplied,
      edgeEndSetbackApplied,
      isInternalCutoutEdge,
      bridgeCount,
    });
  }

  return summary;
}

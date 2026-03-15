import * as THREE from "three";
import { Solid } from "../../../BREP/BetterSolid.js";
import { SelectionState } from "../../../UI/SelectionState.js";
import { buildTwoDGroup, evaluateSheetMetal } from "../engine/index.js";
import { buildFlatPatternExportData } from "../flatPatternExport.js";
import {
  COORD_QUANT,
  EDGE_MATCH_EPS,
  ENGINE_TAG,
  EPS,
  FLAT_PATTERN_LINE_RENDER_ORDER,
  FLAT_PATTERN_OVERLAY_Z,
  FLAT_PATTERN_TEXT_FONT_FAMILY,
  FLAT_PATTERN_TEXT_FONT_PX,
  FLAT_PATTERN_TEXT_RENDER_ORDER,
  MIN_THICKNESS,
  POINT_EPS,
  TRIANGLE_AREA_EPS,
  applyMatrixToObject,
  applyRecordedCutoutsToSolid,
  cloneTree,
  isSolidLikeObject,
  matrixFromAny,
  matrixToArray,
  toFiniteNumber,
} from "./shared.js";
import {
  buildEdgeSegmentSourceIndex,
  cloneHoleSourceChains2,
  collectFlatHoleLoops,
  findSourceEdgeForSegment,
  normalizeLoop2,
  restoreFlatEdgeBoundaryVertices,
  signedArea2D,
  synchronizeBendAttachEdgeSubdivision,
} from "./cutoutTree.js";
import { ensureSheetMeta, findEdgeById, makeHoleSegmentEdgeId } from "./treeCore.js";
import {
  addFlangesToTree,
  applyCornerFilletsToTree,
  buildSheetSourceFromCarrier,
  chooseDefaultEdge,
  resolveSheetMetalCornerFilletTargets,
} from "./flanges.js";

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
    const fullKey = buildQuantizedPolylineSignature(edge.polyline);
    if (fullKey && !index.has(fullKey)) index.set(fullKey, edge);
    for (let i = 0; i < edge.polyline.length - 1; i += 1) {
      const segmentKey = buildQuantizedPolylineSignature([edge.polyline[i], edge.polyline[i + 1]]);
      if (!segmentKey || index.has(segmentKey)) continue;
      index.set(segmentKey, edge);
    }
  }
  return index;
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
  if (kind === "flat_edge_wall" && flatId && edgeId) {
    if (sm.edgeSignature != null) {
      return `flat_edge_wall|${flatId}|${edgeId}|sig:${String(sm.edgeSignature)}`;
    }
    return `flat_edge_wall|${flatId}|${edgeId}`;
  }
  if (kind === "flat_cutout_wall" && flatId && sm.holeId != null) {
    if (edgeId) {
      return `flat_cutout_wall|${flatId}|${String(sm.holeId)}|edgeId:${edgeId}`;
    }
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
  if (Array.isArray(points) && points.length === sampleCount) {
    return points.map((point) => point.clone());
  }
  const lengths = cumulativeLengths3(points);
  const out = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    out.push(samplePolyline3(points, lengths, t));
  }
  return out;
}

function pointDistanceToAxis(point, axisPoint, axisDir) {
  if (!point || !axisPoint || !axisDir) return null;
  const offset = point.clone().sub(axisPoint);
  const axial = axisDir.clone().multiplyScalar(offset.dot(axisDir));
  return offset.sub(axial).length();
}

function firstPointOnFaceGrid(points) {
  if (!Array.isArray(points)) return null;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 3) continue;
    return new THREE.Vector3(point[0], point[1], point[2]);
  }
  return null;
}

function buildBendCylindricalMetadata({ facePoints, axisStart, axisEnd, axisDir, fallbackRadius = null }) {
  if (!axisStart?.isVector3 || !axisEnd?.isVector3 || !axisDir?.isVector3) return null;
  const axisCenter = axisStart.clone().add(axisEnd).multiplyScalar(0.5);
  const samplePoint = firstPointOnFaceGrid(facePoints);
  const sampledRadius = samplePoint ? pointDistanceToAxis(samplePoint, axisStart, axisDir) : null;
  const radius = Number.isFinite(sampledRadius) ? sampledRadius : fallbackRadius;
  const height = axisStart.distanceTo(axisEnd);
  if (!Number.isFinite(radius) || radius <= EPS) return null;
  return {
    type: "cylindrical",
    radius,
    height: Number.isFinite(height) ? height : 0,
    axis: [axisDir.x, axisDir.y, axisDir.z],
    center: [axisCenter.x, axisCenter.y, axisCenter.z],
  };
}

function circumcenter2(a, b, c) {
  const ax = toFiniteNumber(a?.[0]);
  const ay = toFiniteNumber(a?.[1]);
  const bx = toFiniteNumber(b?.[0]);
  const by = toFiniteNumber(b?.[1]);
  const cx = toFiniteNumber(c?.[0]);
  const cy = toFiniteNumber(c?.[1]);
  const d = 2 * ((ax * (by - cy)) + (bx * (cy - ay)) + (cx * (ay - by)));
  if (Math.abs(d) <= EPS) return null;

  const aSq = (ax * ax) + (ay * ay);
  const bSq = (bx * bx) + (by * by);
  const cSq = (cx * cx) + (cy * cy);
  return [
    ((aSq * (by - cy)) + (bSq * (cy - ay)) + (cSq * (ay - by))) / d,
    ((aSq * (cx - bx)) + (bSq * (ax - cx)) + (cSq * (bx - ax))) / d,
  ];
}

function fitCircularEdgePolyline2(polyline) {
  const points = Array.isArray(polyline) ? polyline : [];
  if (points.length < 3) return null;
  const first = points[0];
  const mid = points[(points.length / 2) | 0];
  const last = points[points.length - 1];
  const center = circumcenter2(first, mid, last);
  if (!center) return null;

  const radius = Math.hypot(first[0] - center[0], first[1] - center[1]);
  if (!(Number.isFinite(radius) && radius > EPS)) return null;

  const startAngle = Math.atan2(first[1] - center[1], first[0] - center[0]);
  const endAngle = Math.atan2(last[1] - center[1], last[0] - center[0]);
  let delta = endAngle - startAngle;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  if (Math.abs(delta) <= THREE.MathUtils.degToRad(1)) return null;

  const tolerance = Math.max(1e-4, radius * 1e-3);
  for (const point of points) {
    const sampleRadius = Math.hypot(point[0] - center[0], point[1] - center[1]);
    if (Math.abs(sampleRadius - radius) > tolerance) return null;
  }

  return { center, radius };
}

function buildFlatWallCylindricalMetadata({ edge, placementMatrix, thickness }) {
  const fit = fitCircularEdgePolyline2(edge?.polyline);
  if (!fit) return null;
  const axisDir = new THREE.Vector3(0, 0, 1).transformDirection(placementMatrix).normalize();
  const axisCenter = makeMidplaneWorldPoint(placementMatrix, fit.center);
  const height = Math.abs(toFiniteNumber(thickness, 0));
  if (!(height > EPS)) return null;
  return {
    type: "cylindrical",
    radius: fit.radius,
    height,
    axis: [axisDir.x, axisDir.y, axisDir.z],
    center: [axisCenter.x, axisCenter.y, axisCenter.z],
  };
}

function addCylindricalFaceCenterline({ solid, faceName, metadata }) {
  if (!solid || !faceName || !metadata || metadata.type !== "cylindrical") return;
  const axis = Array.isArray(metadata.axis) ? metadata.axis : null;
  const center = Array.isArray(metadata.center) ? metadata.center : null;
  const height = Math.abs(toFiniteNumber(metadata.height, 0));
  if (!axis || axis.length !== 3 || !center || center.length !== 3 || !(height > EPS)) return;

  const axisDir = new THREE.Vector3(axis[0], axis[1], axis[2]);
  if (axisDir.lengthSq() <= EPS) return;
  axisDir.normalize();

  const axisCenter = new THREE.Vector3(center[0], center[1], center[2]);
  const halfHeight = height * 0.5;
  const start = axisCenter.clone().addScaledVector(axisDir, -halfHeight);
  const end = axisCenter.clone().addScaledVector(axisDir, halfHeight);
  solid.addAuxEdge(`${faceName}:CENTERLINE`, [quantizePoint3(start), quantizePoint3(end)], {
    centerline: true,
    materialKey: "OVERLAY",
    polylineWorld: false,
  });
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
  const edgeSourceIndex = buildEdgeSegmentSourceIndex(flatEdges);
  const outerOffset = loopOffsets[0];
  for (let i = 0; i < outerLoop.length; i += 1) {
    const next = (i + 1) % outerLoop.length;
    const signature = buildQuantizedPolylineSignature([outerLoop[i], outerLoop[next]]);
    const mappedEdge = edgeIndex.get(signature)
      || findSourceEdgeForSegment(outerLoop[i], outerLoop[next], edgeSourceIndex)
      || flatEdges[i]
      || null;
    if (mappedEdge?.bend || mappedEdge?.isAttachEdge) continue;

    const edgeId = mappedEdge?.id || `${flat.id}:edge_${i + 1}`;
    const sideFace = makeFlatFaceName(featureID, flat.id, `SIDE:${edgeId}`);
    const topA = outerOffset + i;
    const topB = outerOffset + next;
    addTriangleIfValid(solid, sideFace, topPoints[topA], bottomPoints[topA], topPoints[topB]);
    addTriangleIfValid(solid, sideFace, topPoints[topB], bottomPoints[topA], bottomPoints[topB]);
    const cylindricalMeta = buildFlatWallCylindricalMetadata({
      edge: mappedEdge,
      placementMatrix: placement.matrix,
      thickness,
    });
    solid.setFaceMetadata(sideFace, {
      ...(cylindricalMeta || {}),
      flatId: flat.id,
      edgeId,
      edgeSignature: signature || null,
      sheetMetal: {
        kind: "flat_edge_wall",
        representation: "3D",
        flatId: flat.id,
        edgeId,
        edgeSignature: signature || null,
      },
    });
    if (cylindricalMeta) addCylindricalFaceCenterline({ solid, faceName: sideFace, metadata: cylindricalMeta });
  }

  for (let holeIndex = 0; holeIndex < holeEntries.length; holeIndex += 1) {
    const hole = holeEntries[holeIndex];
    const loop = hole.loop;
    const offset = loopOffsets[holeIndex + 1];
    const holeSourceEdges = cloneHoleSourceChains2(
      hole?.raw?.sourceChains,
      `${flat.id}:hole:${hole.id}:source`,
    ).map((chain, chainIndex) => ({
      id: chain.id || `${flat.id}:hole:${hole.id}:source:${chainIndex + 1}`,
      polyline: chain.polyline.map((point) => [point[0], point[1]]),
    }));
    const holeSourceIndex = buildEdgeSegmentSourceIndex(holeSourceEdges);
    const holeFaceGroups = new Map();
    for (let i = 0; i < loop.length; i += 1) {
      const next = (i + 1) % loop.length;
      const holeEdgeIndex = i + 1;
      const edgeSignature = buildQuantizedPolylineSignature([loop[i], loop[next]]);
      const mappedSourceEdge = findSourceEdgeForSegment(loop[i], loop[next], holeSourceIndex) || null;
      const mappedEdge = edgeIndex.get(edgeSignature)
        || findSourceEdgeForSegment(loop[i], loop[next], edgeSourceIndex)
        || null;
      const edgeId = mappedEdge?.id || makeHoleSegmentEdgeId(flat.id, hole.id, holeEdgeIndex);
      if (mappedEdge?.bend || mappedEdge?.isAttachEdge) continue;

      const faceGroupKey = mappedSourceEdge?.id || edgeId;
      let faceGroup = holeFaceGroups.get(faceGroupKey);
      if (!faceGroup) {
        faceGroup = {
          faceName: makeFlatFaceName(featureID, flat.id, `CUTOUT:${hole.id}:EDGE:${holeEdgeIndex}`),
          edgeId,
          edgeIndex: holeEdgeIndex,
          edgeSignature: edgeSignature || null,
        };
        holeFaceGroups.set(faceGroupKey, faceGroup);
      }

      const sideFace = faceGroup.faceName;
      const topA = offset + i;
      const topB = offset + next;
      addTriangleIfValid(solid, sideFace, topPoints[topA], bottomPoints[topA], topPoints[topB]);
      addTriangleIfValid(solid, sideFace, topPoints[topB], bottomPoints[topA], bottomPoints[topB]);
      solid.setFaceMetadata(sideFace, {
        flatId: flat.id,
        edgeId: faceGroup.edgeId,
        holeId: hole.id,
        cutoutId: hole.cutoutId || null,
        edgeIndex: faceGroup.edgeIndex,
        edgeSignature: faceGroup.edgeSignature,
        sheetMetal: {
          kind: "flat_cutout_wall",
          representation: "3D",
          flatId: flat.id,
          edgeId: faceGroup.edgeId,
          holeId: hole.id,
          cutoutId: hole.cutoutId || null,
          edgeIndex: faceGroup.edgeIndex,
          edgeSignature: faceGroup.edgeSignature,
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
  const axisStart = bendPlacement.axisStart.clone();
  const axisEnd = bendPlacement.axisEnd.clone();
  const axisOrigin = axisStart.clone();
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
  const midRadius = Math.max(EPS, toFiniteNumber(bendPlacement.midRadius, 0));
  const fallbackOuterRadius = midRadius + halfT;
  const fallbackInnerRadius = Math.max(EPS, midRadius - halfT);
  const isFaceAOuter = bendPlacement.angleRad >= 0;
  const faceAMetadata = buildBendCylindricalMetadata({
    facePoints: top,
    axisStart,
    axisEnd,
    axisDir,
    fallbackRadius: isFaceAOuter ? fallbackOuterRadius : fallbackInnerRadius,
  });
  const faceBMetadata = buildBendCylindricalMetadata({
    facePoints: bottom,
    axisStart,
    axisEnd,
    axisDir,
    fallbackRadius: isFaceAOuter ? fallbackInnerRadius : fallbackOuterRadius,
  });

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
    ...(faceAMetadata || {}),
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
    ...(faceBMetadata || {}),
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
  if (tree?.root) {
    restoreFlatEdgeBoundaryVertices(tree.root);
    synchronizeBendAttachEdgeSubdivision(tree.root);
  }
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

export function __test_buildRenderableSheetModelFromTree({
  featureID = "SM_TEST",
  tree,
  rootMatrix = null,
  showFlatPattern = false,
} = {}) {
  if (!tree || typeof tree !== "object") {
    throw new Error("__test_buildRenderableSheetModelFromTree requires a valid tree object.");
  }
  return buildRenderableSheetModel({
    featureID: String(featureID || "SM_TEST"),
    tree: cloneTree(tree),
    rootMatrix: rootMatrix ? matrixFromAny(rootMatrix) : null,
    showFlatPattern,
  });
}

export function __test_applyFlangesToTree({
  tree,
  featureID = "SM_TEST",
  targets = [],
  options = {},
} = {}) {
  if (!tree || typeof tree !== "object" || !tree.root) {
    throw new Error("__test_applyFlangesToTree requires a valid tree with a root flat.");
  }
  const workingTree = cloneTree(tree);
  const summary = addFlangesToTree(workingTree, String(featureID || "SM_TEST"), Array.isArray(targets) ? targets : [], options || {});
  return { tree: workingTree, summary };
}

export function __test_applyCornerFilletsToTree({
  tree,
  featureID = "SM_TEST_FILLET",
  targets = [],
  radius = 1,
  resolution = 32,
} = {}) {
  if (!tree || typeof tree !== "object" || !tree.root) {
    throw new Error("__test_applyCornerFilletsToTree requires a valid tree with a root flat.");
  }
  const workingTree = cloneTree(tree);
  const summary = applyCornerFilletsToTree(
    workingTree,
    String(featureID || "SM_TEST_FILLET"),
    Array.isArray(targets) ? targets : [],
    { radius, resolution },
  );
  return { tree: workingTree, summary };
}

export function runSheetMetalCornerFillet({
  sourceCarrier = null,
  selections = [],
  edgeSelections = [],
  radius = 1,
  resolution = 32,
  featureID = "SM_FILLET",
  showFlatPattern = true,
} = {}) {
  const source = buildSheetSourceFromCarrier(sourceCarrier);
  if (!source) {
    return {
      handled: false,
      root: null,
      tree: null,
      summary: {
        requested: 0,
        applied: 0,
        skipped: 0,
        appliedTargets: [],
        skippedTargets: [],
        appliedCorners: 0,
        reason: "no_sheet_source",
      },
    };
  }

  const safeFeatureID = String(featureID || "SM_FILLET");
  const tree = cloneTree(source.tree);
  const targets = resolveSheetMetalCornerFilletTargets(selections, edgeSelections, tree, source.carrier);
  const summary = applyCornerFilletsToTree(tree, safeFeatureID, targets, { radius, resolution });
  if (summary.applied <= 0 || summary.appliedCorners <= 0) {
    return {
      handled: true,
      root: null,
      tree,
      summary: {
        ...summary,
        reason: summary.requested > 0 ? "no_corners_modified" : "no_sheet_metal_edge_targets",
      },
    };
  }

  const meta = ensureSheetMeta(tree);
  meta.lastFeatureID = safeFeatureID;
  if (meta.baseType == null) meta.baseType = "FILLET";

  const rootMatrix = source.rootMatrix || matrixFromAny(source.carrier?.userData?.sheetMetalModel?.rootTransform);
  const { root, evaluated } = buildRenderableSheetModel({
    featureID: safeFeatureID,
    tree,
    rootMatrix,
    showFlatPattern: showFlatPattern !== false,
  });
  preserveSheetMetalFaceNames(root, source.carrier);
  if (source?.carrier && typeof source.carrier.name === "string") {
    root.name = source.carrier.name;
  }

  return {
    handled: true,
    root,
    tree,
    evaluated,
    summary,
  };
}

export {
  buildRenderableSheetModel,
  preserveSheetMetalFaceNames,
};

import * as THREE from 'three';
import { buildPointInsideTester } from './utils/pointInsideTester.js';

const DEFAULT_NORMAL_TOLERANCE_DEG = 1.0;
const DEFAULT_PLANE_DISTANCE_TOLERANCE = 1e-4;
const DEFAULT_OVERLAP_AREA_TOLERANCE = 1e-6;
const DEFAULT_BOOLEAN_CONDITIONING_NUDGE_SCALE = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function vectorKey(vec, precision = 6) {
  return [
    finiteNumber(vec?.x, 0).toFixed(precision),
    finiteNumber(vec?.y, 0).toFixed(precision),
    finiteNumber(vec?.z, 0).toFixed(precision),
  ].join(',');
}

function triangleRecordFromPoints(a, b, c) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const normal = new THREE.Vector3().crossVectors(ab, ac);
  const doubleArea = normal.length();
  if (!(doubleArea > 1e-12)) return null;
  const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  return {
    a: a.clone(),
    b: b.clone(),
    c: c.clone(),
    centroid,
    normal: normal.normalize(),
    area: doubleArea * 0.5,
  };
}

function ensureFaceTrianglesFromObject3D(face) {
  if (!face?.geometry?.isBufferGeometry) return [];
  const geometry = face.geometry;
  const pos = geometry.getAttribute?.('position');
  if (!pos || pos.itemSize !== 3 || pos.count < 3) return [];
  const index = geometry.getIndex?.() || null;

  face.updateMatrixWorld?.(true);
  const matrix = face.matrixWorld || new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const out = [];

  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  for (let tri = 0; tri < triCount; tri += 1) {
    let i0;
    let i1;
    let i2;
    if (index) {
      const base = tri * 3;
      i0 = index.getX(base);
      i1 = index.getX(base + 1);
      i2 = index.getX(base + 2);
    } else {
      i0 = tri * 3;
      i1 = i0 + 1;
      i2 = i0 + 2;
    }

    a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(matrix);
    b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(matrix);
    c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(matrix);

    const record = triangleRecordFromPoints(a, b, c);
    if (record) out.push(record);
  }
  return out;
}

function ensureFaceTrianglesFromRecords(triangles) {
  if (!Array.isArray(triangles) || triangles.length === 0) return [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const out = [];
  for (const triangle of triangles) {
    const p1 = Array.isArray(triangle?.p1) ? triangle.p1 : null;
    const p2 = Array.isArray(triangle?.p2) ? triangle.p2 : null;
    const p3 = Array.isArray(triangle?.p3) ? triangle.p3 : null;
    if (!p1 || !p2 || !p3) continue;
    a.set(p1[0], p1[1], p1[2]);
    b.set(p2[0], p2[1], p2[2]);
    c.set(p3[0], p3[1], p3[2]);
    const record = triangleRecordFromPoints(a, b, c);
    if (record) out.push(record);
  }
  return out;
}

function computeFaceEntryFromTriangles(faceName, triangles, options: any = {}, extra = null) {
  if (!triangles.length) return null;

  const avgNormal = new THREE.Vector3();
  const weightedPoint = new THREE.Vector3();
  let totalArea = 0;
  for (const tri of triangles) {
    avgNormal.addScaledVector(tri.normal, tri.area);
    weightedPoint.addScaledVector(tri.centroid, tri.area);
    totalArea += tri.area;
  }
  if (!(avgNormal.lengthSq() > 1e-12) || !(totalArea > 0)) return null;

  avgNormal.normalize();
  const point = weightedPoint.multiplyScalar(1 / totalArea);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(avgNormal.clone(), point.clone());

  let maxPlaneDistance = 0;
  const uniquePoints = new Map();
  const bbox = new THREE.Box3();
  for (const tri of triangles) {
    for (const vertex of [tri.a, tri.b, tri.c]) {
      bbox.expandByPoint(vertex);
      const dist = Math.abs(plane.distanceToPoint(vertex));
      if (dist > maxPlaneDistance) maxPlaneDistance = dist;
      const key = vectorKey(vertex);
      if (!uniquePoints.has(key)) uniquePoints.set(key, vertex.clone());
    }
  }

  const planarityTolerance = Math.max(
    finiteNumber(options.facePlanarityTolerance, 0),
    finiteNumber(options.planeDistanceTolerance, DEFAULT_PLANE_DISTANCE_TOLERANCE) * 8,
    1e-5,
  );
  if (maxPlaneDistance > planarityTolerance) return null;

  return {
    faceName,
    triangles,
    normal: avgNormal,
    point,
    planeConstant: avgNormal.dot(point),
    maxPlaneDistance,
    area: totalArea,
    bbox,
    vertices: Array.from(uniquePoints.values()),
    ...(extra || {}),
  };
}

function buildPlaneBasis(normal, origin) {
  const n = normal.clone().normalize();
  const ref = Math.abs(n.z) < 0.9
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { origin: origin.clone(), normal: n, u, v };
}

function projectPoint2(point, basis) {
  const rel = point.clone().sub(basis.origin);
  return {
    x: rel.dot(basis.u),
    y: rel.dot(basis.v),
  };
}

function polygonArea2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a.x * b.y) - (a.y * b.x);
  }
  return sum * 0.5;
}

function normalizeConvexPolygon(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const copy = points.map((point) => ({ x: finiteNumber(point?.x, 0), y: finiteNumber(point?.y, 0) }));
  if (polygonArea2(copy) < 0) copy.reverse();
  return copy;
}

function signedDistanceToLine(point, edgeStart, edgeEnd) {
  return ((edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y))
    - ((edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x));
}

function intersectSegments2(start, end, edgeStart, edgeEnd) {
  const x1 = start.x;
  const y1 = start.y;
  const x2 = end.x;
  const y2 = end.y;
  const x3 = edgeStart.x;
  const y3 = edgeStart.y;
  const x4 = edgeEnd.x;
  const y4 = edgeEnd.y;

  const denom = ((x1 - x2) * (y3 - y4)) - ((y1 - y2) * (x3 - x4));
  if (Math.abs(denom) <= 1e-12) {
    return {
      x: (start.x + end.x) * 0.5,
      y: (start.y + end.y) * 0.5,
    };
  }

  const numA = ((x1 * y2) - (y1 * x2));
  const numB = ((x3 * y4) - (y3 * x4));
  return {
    x: ((numA * (x3 - x4)) - ((x1 - x2) * numB)) / denom,
    y: ((numA * (y3 - y4)) - ((y1 - y2) * numB)) / denom,
  };
}

function clipConvexPolygon(subjectPolygon, clipPolygon) {
  let output = normalizeConvexPolygon(subjectPolygon);
  const clip = normalizeConvexPolygon(clipPolygon);
  if (output.length < 3 || clip.length < 3) return [];

  for (let i = 0; i < clip.length; i += 1) {
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    const input = output.slice();
    output = [];
    if (!input.length) break;

    let previous = input[input.length - 1];
    let previousInside = signedDistanceToLine(previous, edgeStart, edgeEnd) >= -1e-10;
    for (const current of input) {
      const currentInside = signedDistanceToLine(current, edgeStart, edgeEnd) >= -1e-10;
      if (currentInside) {
        if (!previousInside) {
          output.push(intersectSegments2(previous, current, edgeStart, edgeEnd));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(intersectSegments2(previous, current, edgeStart, edgeEnd));
      }
      previous = current;
      previousInside = currentInside;
    }
  }

  return output;
}

function triangleOverlapArea2(triA, triB) {
  const clipped = clipConvexPolygon(triA, triB);
  return Math.abs(polygonArea2(clipped));
}

function computeProjectedFaceTriangles(faceEntry, basis) {
  const projectedTriangles = [];
  const bbox = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const tri of faceEntry.triangles) {
    const projected = normalizeConvexPolygon([
      projectPoint2(tri.a, basis),
      projectPoint2(tri.b, basis),
      projectPoint2(tri.c, basis),
    ]);
    if (projected.length < 3) continue;
    const area = Math.abs(polygonArea2(projected));
    if (!(area > 1e-12)) continue;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of projected) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      bbox.minX = Math.min(bbox.minX, point.x);
      bbox.minY = Math.min(bbox.minY, point.y);
      bbox.maxX = Math.max(bbox.maxX, point.x);
      bbox.maxY = Math.max(bbox.maxY, point.y);
    }

    projectedTriangles.push({
      points: projected,
      area,
      bbox: { minX, minY, maxX, maxY },
    });
  }

  if (!projectedTriangles.length) return null;
  return { triangles: projectedTriangles, bbox };
}

function boxesOverlap2(a, b, tolerance = 0) {
  if (!a || !b) return false;
  return !(
    (a.maxX + tolerance) < b.minX
    || (b.maxX + tolerance) < a.minX
    || (a.maxY + tolerance) < b.minY
    || (b.maxY + tolerance) < a.minY
  );
}

function boxesOverlap3(a, b, tolerance = 0) {
  if (!a || !b) return false;
  return !(
    (a.max.x + tolerance) < b.min.x
    || (b.max.x + tolerance) < a.min.x
    || (a.max.y + tolerance) < b.min.y
    || (b.max.y + tolerance) < a.min.y
    || (a.max.z + tolerance) < b.min.z
    || (b.max.z + tolerance) < a.min.z
  );
}

function computeFacePairOverlap(faceA, faceB, options: any = {}) {
  const normalToleranceDeg = finiteNumber(options.normalToleranceDeg, DEFAULT_NORMAL_TOLERANCE_DEG);
  const planeDistanceTolerance = finiteNumber(options.planeDistanceTolerance, DEFAULT_PLANE_DISTANCE_TOLERANCE);
  const overlapAreaTolerance = finiteNumber(options.overlapAreaTolerance, DEFAULT_OVERLAP_AREA_TOLERANCE);
  const normalCosTolerance = Math.cos(THREE.MathUtils.degToRad(normalToleranceDeg));

  let alignedNormalB = faceB.normal.clone();
  let planeConstantB = faceB.planeConstant;
  let dot = faceA.normal.dot(alignedNormalB);
  if (dot < 0) {
    alignedNormalB.multiplyScalar(-1);
    planeConstantB *= -1;
    dot = faceA.normal.dot(alignedNormalB);
  }
  const absDot = Math.abs(dot);
  if (absDot < normalCosTolerance) return null;

  const planeDistanceA = Math.abs(faceA.normal.dot(faceB.point) - faceA.planeConstant);
  const planeDistanceB = Math.abs(alignedNormalB.dot(faceA.point) - planeConstantB);
  const planeDistance = Math.max(planeDistanceA, planeDistanceB);
  if (planeDistance > planeDistanceTolerance) return null;
  if (!boxesOverlap3(faceA.bbox, faceB.bbox, planeDistanceTolerance * 2)) return null;

  const basis = buildPlaneBasis(faceA.normal, faceA.point);
  const projectedA = computeProjectedFaceTriangles(faceA, basis);
  const projectedB = computeProjectedFaceTriangles(faceB, basis);
  if (!projectedA || !projectedB) return null;
  if (!boxesOverlap2(projectedA.bbox, projectedB.bbox, planeDistanceTolerance * 2)) return null;

  let overlapArea = 0;
  for (const triA of projectedA.triangles) {
    for (const triB of projectedB.triangles) {
      if (!boxesOverlap2(triA.bbox, triB.bbox, planeDistanceTolerance * 2)) continue;
      overlapArea += triangleOverlapArea2(triA.points, triB.points);
    }
  }

  if (!(overlapArea > overlapAreaTolerance)) return null;

  return {
    faceA: faceA.faceName,
    faceB: faceB.faceName,
    overlapArea,
    planeDistance,
    angleDeg: THREE.MathUtils.radToDeg(Math.acos(clamp(absDot, -1, 1))),
    normalDot: faceA.normal.dot(faceB.normal),
  };
}

function resolveSolidName(solid) {
  return String(solid?.name || solid?.userData?.solidName || '').trim() || null;
}

function resolveSolidKey(solid, fallback = 'SOLID') {
  return String(solid?.uuid || solid?.name || solid?.userData?.solidName || fallback);
}

function computeSolidCenterFromVertices(solid) {
  const vp = solid?._vertProperties;
  if (!Array.isArray(vp) || vp.length < 3) return null;
  const center = new THREE.Vector3();
  const count = Math.floor(vp.length / 3);
  for (let i = 0; i < vp.length; i += 3) {
    center.x += finiteNumber(vp[i + 0], 0);
    center.y += finiteNumber(vp[i + 1], 0);
    center.z += finiteNumber(vp[i + 2], 0);
  }
  return count > 0 ? center.multiplyScalar(1 / count) : null;
}

function computeSolidCenterFromChildren(solid) {
  const children = Array.isArray(solid?.children) ? solid.children : [];
  const box = new THREE.Box3();
  let hasPoint = false;
  const temp = new THREE.Box3();
  for (const child of children) {
    if (!child || String(child.type || '').toUpperCase() !== 'FACE') continue;
    child.updateMatrixWorld?.(true);
    if (!child.geometry?.isBufferGeometry) continue;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox?.();
    if (!child.geometry.boundingBox) continue;
    temp.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld || new THREE.Matrix4());
    box.union(temp);
    hasPoint = true;
  }
  return hasPoint ? box.getCenter(new THREE.Vector3()) : null;
}

function computeSolidCenter(solid) {
  return computeSolidCenterFromVertices(solid)
    || computeSolidCenterFromChildren(solid)
    || new THREE.Vector3();
}

function collectSolidFaceEntriesFromMeshChildren(solid, options: any = {}) {
  const children = Array.isArray(solid?.children) ? solid.children : [];
  const faceEntries = [];
  const solidName = resolveSolidName(solid);
  const solidKey = resolveSolidKey(solid);
  for (const child of children) {
    if (!child || String(child.type || '').toUpperCase() !== 'FACE') continue;
    const faceName = String(child?.name || child?.userData?.faceName || '').trim() || child?.uuid || 'FACE';
    const triangles = ensureFaceTrianglesFromObject3D(child);
    const entry = computeFaceEntryFromTriangles(faceName, triangles, options, {
      face: child,
      solid,
      solidName,
      solidKey,
      source: 'object3d',
    });
    if (entry) faceEntries.push(entry);
  }
  return faceEntries;
}

function collectSolidFaceEntriesFromBrep(solid, options: any = {}) {
  if (!solid || typeof solid.getFaces !== 'function') return [];
  const faces = solid.getFaces(false);
  const faceEntries = [];
  const solidName = resolveSolidName(solid);
  const solidKey = resolveSolidKey(solid);
  for (const faceRecord of faces || []) {
    const faceName = String(faceRecord?.faceName || '').trim();
    if (!faceName) continue;
    const triangles = ensureFaceTrianglesFromRecords(faceRecord?.triangles);
    const entry = computeFaceEntryFromTriangles(faceName, triangles, options, {
      solid,
      solidName,
      solidKey,
      source: 'brep',
    });
    if (entry) faceEntries.push(entry);
  }
  return faceEntries;
}

function collectSolidFaceEntries(solid, options: any = {}) {
  const fromBrep = collectSolidFaceEntriesFromBrep(solid, options);
  if (fromBrep.length) return fromBrep;
  return collectSolidFaceEntriesFromMeshChildren(solid, options);
}

function buildHighlightedBySolid(map) {
  const out = {};
  for (const [solidKey, record] of map.entries()) {
    out[solidKey] = {
      solidName: record.solidName,
      faceNames: Array.from(record.faceNames),
    };
  }
  return out;
}

function analyzeFaceEntryPairs(faceEntriesA, faceEntriesB, options: any = {}, { sameSet = false, includeEntries = false } = {}) {
  const overlaps = [];
  const highlighted = new Set();
  const highlightedBySolid = new Map();
  for (let i = 0; i < faceEntriesA.length; i += 1) {
    const startJ = sameSet ? i + 1 : 0;
    for (let j = startJ; j < faceEntriesB.length; j += 1) {
      const faceA = faceEntriesA[i];
      const faceB = faceEntriesB[j];
      const pair = computeFacePairOverlap(faceA, faceB, options);
      if (!pair) continue;
      overlaps.push({
        ...pair,
        solidA: faceA.solidName,
        solidAKey: faceA.solidKey,
        solidB: faceB.solidName,
        solidBKey: faceB.solidKey,
        ...(includeEntries ? { faceEntryA: faceA, faceEntryB: faceB } : {}),
      });
      highlighted.add(pair.faceA);
      highlighted.add(pair.faceB);
      for (const faceEntry of [faceA, faceB]) {
        let record = highlightedBySolid.get(faceEntry.solidKey);
        if (!record) {
          record = { solidName: faceEntry.solidName, faceNames: new Set() };
          highlightedBySolid.set(faceEntry.solidKey, record);
        }
        record.faceNames.add(faceEntry.faceName);
      }
    }
  }

  overlaps.sort((a, b) => {
    if (b.overlapArea !== a.overlapArea) return b.overlapArea - a.overlapArea;
    if (a.planeDistance !== b.planeDistance) return a.planeDistance - b.planeDistance;
    return `${a.solidAKey}|${a.faceA}|${a.solidBKey}|${a.faceB}`.localeCompare(`${b.solidAKey}|${b.faceA}|${b.solidBKey}|${b.faceB}`);
  });

  return {
    overlaps,
    highlightedFaceNames: Array.from(highlighted),
    highlightedBySolid: buildHighlightedBySolid(highlightedBySolid),
  };
}

export function analyzeSolidFaceOverlaps(solid, options: any = {}) {
  const faceEntries = collectSolidFaceEntries(solid, options);
  const pairReport = analyzeFaceEntryPairs(faceEntries, faceEntries, options, { sameSet: true });
  return {
    mode: 'single',
    solidName: resolveSolidName(solid),
    solidKey: resolveSolidKey(solid),
    faceCount: faceEntries.length,
    ...pairReport,
  };
}

export function analyzeSolidPairFaceOverlaps(solidA, solidB, options: any = {}) {
  const faceEntriesA = collectSolidFaceEntries(solidA, options);
  const faceEntriesB = collectSolidFaceEntries(solidB, options);
  const pairReport = analyzeFaceEntryPairs(faceEntriesA, faceEntriesB, options, { sameSet: false });
  return {
    mode: 'pair',
    solidAName: resolveSolidName(solidA),
    solidAKey: resolveSolidKey(solidA, 'SOLID_A'),
    solidBName: resolveSolidName(solidB),
    solidBKey: resolveSolidKey(solidB, 'SOLID_B'),
    faceCountA: faceEntriesA.length,
    faceCountB: faceEntriesB.length,
    comparedFaceCount: faceEntriesA.length + faceEntriesB.length,
    ...pairReport,
  };
}

function resolveConditioningDistance(scale, options: any = {}) {
  const explicit = Number(options.conditioningDistance);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const planeTol = finiteNumber(options.planeDistanceTolerance, DEFAULT_PLANE_DISTANCE_TOLERANCE);
  const scaleFactor = Math.max(1e-5 * Math.max(1, scale), 1e-6);
  return Math.max(planeTol * DEFAULT_BOOLEAN_CONDITIONING_NUDGE_SCALE, scaleFactor);
}

function resolvePushSign(faceEntry, stationarySolid, probeDistance) {
  if (!faceEntry) return 0;
  const normal = faceEntry.normal?.clone?.();
  const point = faceEntry.point?.clone?.();
  if (!normal || !point || !(normal.lengthSq() > 1e-12)) return 0;

  const insideTester = buildPointInsideTester(stationarySolid);
  if (insideTester) {
    const plusInside = insideTester(point.clone().addScaledVector(normal, probeDistance));
    const minusInside = insideTester(point.clone().addScaledVector(normal, -probeDistance));
    if (plusInside !== minusInside) return plusInside ? 1 : -1;
  }

  const stationaryCenter = computeSolidCenter(stationarySolid);
  const toCenter = stationaryCenter.clone().sub(point);
  const dot = toCenter.dot(normal);
  if (Math.abs(dot) > 1e-12) return dot > 0 ? 1 : -1;
  return 0;
}

export function buildBooleanOverlapConditioningPlan(stationarySolid, movingSolid, options: any = {}) {
  const conditioningMode = String(options.conditioningMode || options.operation || '').toUpperCase();
  const faceEntriesA = collectSolidFaceEntries(stationarySolid, options);
  const faceEntriesB = collectSolidFaceEntries(movingSolid, options);
  const pairReport = analyzeFaceEntryPairs(faceEntriesA, faceEntriesB, options, {
    sameSet: false,
    includeEntries: true,
  });
  const overlaps = Array.isArray(pairReport?.overlaps) ? pairReport.overlaps : [];
  const scale = Math.max(
    finiteNumber(options.scaleHint, 0),
    finiteNumber(options.stationaryScaleHint, 0),
    finiteNumber(options.movingScaleHint, 0),
    1,
  );
  const distance = resolveConditioningDistance(scale, options);
  const probeDistance = Math.max(distance * 2, finiteNumber(options.planeDistanceTolerance, DEFAULT_PLANE_DISTANCE_TOLERANCE) * 4, 1e-6);
  const votes = new Map();

  for (const overlap of overlaps) {
    const faceEntry = overlap?.faceEntryB;
    const faceName = faceEntry?.faceName;
    if (!faceName) continue;
    const sign = (conditioningMode === 'SUBTRACT')
      ? 1
      : resolvePushSign(faceEntry, stationarySolid, probeDistance);
    if (sign === 0) continue;
    let vote = votes.get(faceName);
    if (!vote) {
      vote = {
        faceName,
        positiveVotes: 0,
        negativeVotes: 0,
        overlapCount: 0,
        overlapArea: 0,
      };
      votes.set(faceName, vote);
    }
    if (sign > 0) vote.positiveVotes += 1;
    else vote.negativeVotes += 1;
    vote.overlapCount += 1;
    vote.overlapArea += finiteNumber(overlap.overlapArea, 0);
  }

  const faceAdjustments = Array.from(votes.values())
    .map((vote) => {
      const sign = vote.positiveVotes >= vote.negativeVotes ? 1 : -1;
      return {
        faceName: vote.faceName,
        distance: sign * distance,
        sign,
        overlapCount: vote.overlapCount,
        overlapArea: vote.overlapArea,
      };
    })
    .sort((a, b) => {
      if (b.overlapArea !== a.overlapArea) return b.overlapArea - a.overlapArea;
      return a.faceName.localeCompare(b.faceName);
    });

  return {
    stationarySolidName: resolveSolidName(stationarySolid),
    movingSolidName: resolveSolidName(movingSolid),
    overlapCount: overlaps.length,
    overlaps,
    faceAdjustments,
    conditioningDistance: distance,
    probeDistance,
  };
}

export const SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS = {
  normalToleranceDeg: DEFAULT_NORMAL_TOLERANCE_DEG,
  planeDistanceTolerance: DEFAULT_PLANE_DISTANCE_TOLERANCE,
  overlapAreaTolerance: DEFAULT_OVERLAP_AREA_TOLERANCE,
};

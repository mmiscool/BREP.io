// Solid.fillet implementation: consolidates fillet logic so features call this API.
// Usage: solid.fillet({ radius, edges, featureID, direction, inflate, resolution, debug, consoleLogProcess, debugSolidsLevel, debugShowCombinedBeforeTarget })
import { resolveEdgesFromInputs } from './edgeResolution.js';
import {
  applySolidAuthoringStateSnapshot,
  buildSolidAuthoringStateSnapshot,
  getSyncedCppSolidCore,
  syncSolidAuthoringStateFromCpp,
} from '../CppSolidCore.js';
import { manifold } from '../setupManifold.js';

const FILLET_SIDEWALL_COLLAPSE_SIMPLIFY_TOLERANCE = 0.0009;

function hasNativeFilletCombinedBuilder() {
  return typeof manifold?.buildFilletCombinedAuthoringState === 'function';
}

function hasNativeFilletBatchBuilder() {
  return typeof manifold?.buildFilletBatchAuthoringState === 'function';
}

function hasNativeFilletCornerBridgeBuilder() {
  return typeof manifold?.buildFilletCornerBridgeAuthoringState === 'function';
}

function hasNativeFilletDirectionClassifier() {
  return typeof manifold?.classifyFilletEdgeDirection === 'function';
}

function requireNativeFilletCombinedBuilder() {
  if (!hasNativeFilletBatchBuilder()) {
    throw new Error('Solid.fillet() requires the custom local manifold build with native fillet batch support.');
  }
  if (!hasNativeFilletCombinedBuilder()) {
    throw new Error('Solid.fillet() requires the custom local manifold build with native fillet combine support.');
  }
  if (!hasNativeFilletCornerBridgeBuilder()) {
    throw new Error('Solid.fillet() requires the custom local manifold build with native fillet corner-bridge support.');
  }
  if (!hasNativeFilletDirectionClassifier()) {
    throw new Error('Solid.fillet() requires the custom local manifold build with native fillet direction classification support.');
  }
}

function solidFromSnapshot(snapshot, SolidClass, name = null) {
  if (!snapshot || !SolidClass) return null;
  const solid = new SolidClass();
  applySolidAuthoringStateSnapshot(solid, snapshot);
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  if (typeof name === 'string' && name.length > 0) {
    try { solid.name = name; } catch { }
  }
  return solid;
}

function deriveSolidToleranceFromVerts(solid, baseTol = 1e-5) {
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  if (!vp || vp.length < 6) return baseTol;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i + 0];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const diag = Math.hypot(dx, dy, dz) || 1;
  return Math.max(baseTol, diag * 1e-6);
}

function normalizeFilletDirectionMode(rawDirection) {
  const dir = String(rawDirection || 'AUTO').toUpperCase();
  if (dir === 'INSET' || dir === 'OUTSET' || dir === 'AUTO') return dir;
  return 'AUTO';
}

function pushUniquePoint3(list, point, eps2) {
  if (!Array.isArray(list) || !point) return;
  const px = Number(point.x);
  const py = Number(point.y);
  const pz = Number(point.z);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
  for (const q of list) {
    const dx = px - q.x;
    const dy = py - q.y;
    const dz = pz - q.z;
    if (((dx * dx) + (dy * dy) + (dz * dz)) <= eps2) return;
  }
  list.push({ x: px, y: py, z: pz });
}

function getEdgeFaceNames(edgeObj) {
  const faceAName = edgeObj?.faces?.[0]?.name || edgeObj?.userData?.faceA || null;
  const faceBName = edgeObj?.faces?.[1]?.name || edgeObj?.userData?.faceB || null;
  return { faceAName, faceBName };
}

function getEdgePolylineLocal(edgeObj) {
  const poly = edgeObj?.userData?.polylineLocal;
  if (!Array.isArray(poly) || poly.length < 2) return null;
  return poly;
}

function toPoint3Object(point) {
  if (Array.isArray(point) && point.length >= 3) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const z = Number(point[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    return null;
  }
  if (point && typeof point === 'object') {
    const x = Number(point.x);
    const y = Number(point.y);
    const z = Number(point.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
  }
  return null;
}

function point3DistanceSq(a, b) {
  const pa = toPoint3Object(a);
  const pb = toPoint3Object(b);
  if (!pa || !pb) return Infinity;
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  const dz = pa.z - pb.z;
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function normalizePoint3Vector(vx, vy, vz) {
  const len = Math.hypot(vx, vy, vz);
  if (!(len > 1e-12)) return null;
  return [vx / len, vy / len, vz / len];
}

function stableStringHash32(value = '') {
  const text = String(value == null ? '' : value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sanitizeFaceNameToken(value, fallback = 'TOKEN') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\[\d+\]$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || fallback;
}

function boundaryPolylineLength(points) {
  const pts = Array.isArray(points) ? points : [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) continue;
    length += Math.hypot(
      (b[0] || 0) - (a[0] || 0),
      (b[1] || 0) - (a[1] || 0),
      (b[2] || 0) - (a[2] || 0),
    );
  }
  return length;
}

function quantizePoint3Key(point, tolerance = 1e-6) {
  const p = toPoint3Object(point);
  if (!p) return '';
  const tol = Math.max(1e-9, Math.abs(Number(tolerance) || 0));
  return [
    Math.round(p.x / tol),
    Math.round(p.y / tol),
    Math.round(p.z / tol),
  ].join('|');
}

function segmentLength3D(a, b) {
  const pa = toPoint3Object(a);
  const pb = toPoint3Object(b);
  if (!pa || !pb) return 0;
  return Math.hypot(
    pa.x - pb.x,
    pa.y - pb.y,
    pa.z - pb.z,
  );
}

function buildBoundarySegmentsFromFaceTriangles(triangles, {
  pointTolerance = 1e-6,
} = {}) {
  const tris = Array.isArray(triangles) ? triangles : [];
  if (tris.length === 0) return [];

  const tol = Math.max(1e-7, Math.abs(Number(pointTolerance) || 0));
  const tol2 = tol * tol;
  const edgeMap = new Map();
  const addEdge = (rawA, rawB) => {
    const a = toPoint3Object(rawA);
    const b = toPoint3Object(rawB);
    if (!a || !b) return;
    if (point3DistanceSq(a, b) <= tol2) return;
    const keyA = quantizePoint3Key(a, tol);
    const keyB = quantizePoint3Key(b, tol);
    if (!keyA || !keyB || keyA === keyB) return;
    const key = keyA < keyB ? `${keyA}__${keyB}` : `${keyB}__${keyA}`;
    const length = segmentLength3D(a, b);
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += 1;
      if (length > existing.length) {
        existing.a = a;
        existing.b = b;
        existing.length = length;
      }
      return;
    }
    edgeMap.set(key, {
      count: 1,
      a,
      b,
      length,
    });
  };

  for (const tri of tris) {
    addEdge(tri?.p1, tri?.p2);
    addEdge(tri?.p2, tri?.p3);
    addEdge(tri?.p3, tri?.p1);
  }

  return Array.from(edgeMap.values())
    .filter((edge) => edge.count === 1 && edge.length > tol)
    .map((edge) => ({
      a: edge.a,
      b: edge.b,
      length: edge.length,
    }));
}

function pointDistanceToLine3D(point, lineOrigin, lineDirection) {
  const p = toPoint3Object(point);
  const origin = toPoint3Object(lineOrigin);
  const dir = Array.isArray(lineDirection) ? lineDirection : null;
  if (!p || !origin || !dir || dir.length < 3) return Infinity;
  const px = p.x - origin.x;
  const py = p.y - origin.y;
  const pz = p.z - origin.z;
  const proj = (px * dir[0]) + (py * dir[1]) + (pz * dir[2]);
  const rx = px - (proj * dir[0]);
  const ry = py - (proj * dir[1]);
  const rz = pz - (proj * dir[2]);
  return Math.hypot(rx, ry, rz);
}

function pointDistanceToSegment3D(point, segmentA, segmentB) {
  const p = toPoint3Object(point);
  const a = toPoint3Object(segmentA);
  const b = toPoint3Object(segmentB);
  if (!p || !a || !b) return Infinity;

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const abLenSq = (abx * abx) + (aby * aby) + (abz * abz);
  if (!(abLenSq > 1e-18)) {
    return Math.hypot(
      p.x - a.x,
      p.y - a.y,
      p.z - a.z,
    );
  }

  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const t = Math.max(0, Math.min(1, (
    (apx * abx)
    + (apy * aby)
    + (apz * abz)
  ) / abLenSq));
  const closestX = a.x + (abx * t);
  const closestY = a.y + (aby * t);
  const closestZ = a.z + (abz * t);
  return Math.hypot(
    p.x - closestX,
    p.y - closestY,
    p.z - closestZ,
  );
}

function measureTrianglePointsOnBoundarySegments(points, boundarySegments, {
  distanceTolerance = 1e-4,
} = {}) {
  const pts = Array.isArray(points) ? points : [];
  const segments = Array.isArray(boundarySegments) ? boundarySegments : [];
  const tol = Math.max(1e-7, Math.abs(Number(distanceTolerance) || 0));
  if (pts.length === 0 || segments.length === 0) return null;

  let maxDistance = 0;
  let totalDistance = 0;
  const matchedSegmentIndices = [];
  for (const point of pts) {
    let bestDistance = Infinity;
    let bestSegmentIndex = -1;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      const distance = pointDistanceToSegment3D(point, segment?.a, segment?.b);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSegmentIndex = segmentIndex;
      }
    }
    if (!(bestDistance <= tol) || bestSegmentIndex < 0) {
      return null;
    }
    totalDistance += bestDistance;
    if (bestDistance > maxDistance) maxDistance = bestDistance;
    matchedSegmentIndices.push(bestSegmentIndex);
  }

  return {
    pointCount: pts.length,
    distinctSegmentCount: new Set(matchedSegmentIndices).size,
    maxDistance,
    totalDistance,
  };
}

function sharedCollinearSegmentLength3D(segmentA, segmentB, {
  matchTolerance = 1e-4,
  directionTolerance = 2e-3,
} = {}) {
  const a0 = toPoint3Object(segmentA?.a);
  const a1 = toPoint3Object(segmentA?.b);
  const b0 = toPoint3Object(segmentB?.a);
  const b1 = toPoint3Object(segmentB?.b);
  if (!a0 || !a1 || !b0 || !b1) return 0;

  const lenA = Number(segmentA?.length) || segmentLength3D(a0, a1);
  const lenB = Number(segmentB?.length) || segmentLength3D(b0, b1);
  const tol = Math.max(1e-7, Math.abs(Number(matchTolerance) || 0));
  if (!(lenA > tol) || !(lenB > tol)) return 0;

  const dirA = normalizePoint3Vector(
    a1.x - a0.x,
    a1.y - a0.y,
    a1.z - a0.z,
  );
  const dirB = normalizePoint3Vector(
    b1.x - b0.x,
    b1.y - b0.y,
    b1.z - b0.z,
  );
  if (!dirA || !dirB) return 0;

  const dot = Math.abs(
    (dirA[0] * dirB[0])
    + (dirA[1] * dirB[1])
    + (dirA[2] * dirB[2]),
  );
  if ((1 - dot) > Math.max(1e-6, Math.abs(Number(directionTolerance) || 0))) {
    return 0;
  }

  if (
    pointDistanceToLine3D(b0, a0, dirA) > tol
    || pointDistanceToLine3D(b1, a0, dirA) > tol
    || pointDistanceToLine3D(a0, b0, dirB) > tol
    || pointDistanceToLine3D(a1, b0, dirB) > tol
  ) {
    return 0;
  }

  const projectAlongA = (point) => {
    const p = toPoint3Object(point);
    if (!p) return 0;
    return (
      ((p.x - a0.x) * dirA[0])
      + ((p.y - a0.y) * dirA[1])
      + ((p.z - a0.z) * dirA[2])
    );
  };

  const bProj0 = projectAlongA(b0);
  const bProj1 = projectAlongA(b1);
  const bMin = Math.min(bProj0, bProj1);
  const bMax = Math.max(bProj0, bProj1);
  const overlapStart = Math.max(0, bMin);
  const overlapEnd = Math.min(lenA, bMax);
  const overlap = overlapEnd - overlapStart;
  if (!(overlap > tol)) return 0;
  return Math.min(overlap, lenA, lenB);
}

function computeSharedBoundaryLength(boundarySegmentsA, boundarySegmentsB, {
  matchTolerance = 1e-4,
  directionTolerance = 2e-3,
} = {}) {
  const segmentsA = Array.isArray(boundarySegmentsA) ? boundarySegmentsA : [];
  const segmentsB = Array.isArray(boundarySegmentsB) ? boundarySegmentsB : [];
  if (segmentsA.length === 0 || segmentsB.length === 0) return 0;

  let total = 0;
  for (const segmentA of segmentsA) {
    const lenA = Number(segmentA?.length) || segmentLength3D(segmentA?.a, segmentA?.b);
    if (!(lenA > 0)) continue;
    let bestOverlap = 0;
    for (const segmentB of segmentsB) {
      const overlap = sharedCollinearSegmentLength3D(segmentA, segmentB, {
        matchTolerance,
        directionTolerance,
      });
      if (overlap > bestOverlap) bestOverlap = overlap;
    }
    total += Math.min(bestOverlap, lenA);
  }
  return total;
}

function estimateFaceArea(solid, faceName) {
  try {
    const tris = solid?.getFace?.(faceName);
    if (!Array.isArray(tris) || tris.length === 0) return 0;
    let area = 0;
    for (const tri of tris) {
      const p1 = tri?.p1;
      const p2 = tri?.p2;
      const p3 = tri?.p3;
      if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
      const ax = p2[0] - p1[0];
      const ay = p2[1] - p1[1];
      const az = p2[2] - p1[2];
      const bx = p3[0] - p1[0];
      const by = p3[1] - p1[1];
      const bz = p3[2] - p1[2];
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      area += 0.5 * Math.hypot(cx, cy, cz);
    }
    return area;
  } catch {
    return 0;
  }
}

function cloneFaceMetadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(metadata));
  } catch {
    return { ...metadata };
  }
}

function analyzePlanarFaceTriangles(triangles, {
  pointTolerance = 1e-6,
  planarityTolerance = 1e-5,
} = {}) {
  const tris = Array.isArray(triangles) ? triangles : [];
  if (tris.length === 0) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let totalArea = 0;
  const vertices = [];
  const pointTol2 = Math.max(1e-16, Math.abs(Number(pointTolerance) || 0) ** 2);

  for (const tri of tris) {
    const p1 = toPoint3Object(tri?.p1);
    const p2 = toPoint3Object(tri?.p2);
    const p3 = toPoint3Object(tri?.p3);
    if (!p1 || !p2 || !p3) continue;

    pushUniquePoint3(vertices, p1, pointTol2);
    pushUniquePoint3(vertices, p2, pointTol2);
    pushUniquePoint3(vertices, p3, pointTol2);

    const ux = p2.x - p1.x;
    const uy = p2.y - p1.y;
    const uz = p2.z - p1.z;
    const vx = p3.x - p1.x;
    const vy = p3.y - p1.y;
    const vz = p3.z - p1.z;
    const cx = (uy * vz) - (uz * vy);
    const cy = (uz * vx) - (ux * vz);
    const cz = (ux * vy) - (uy * vx);
    const twiceArea = Math.hypot(cx, cy, cz);
    if (!(twiceArea > 1e-12)) continue;

    const area = twiceArea * 0.5;
    totalArea += area;
    nx += cx * 0.5;
    ny += cy * 0.5;
    nz += cz * 0.5;
    sx += ((p1.x + p2.x + p3.x) / 3) * area;
    sy += ((p1.y + p2.y + p3.y) / 3) * area;
    sz += ((p1.z + p2.z + p3.z) / 3) * area;
  }

  const normal = normalizePoint3Vector(nx, ny, nz);
  if (!normal || !(totalArea > 0) || vertices.length < 3) return null;

  const point = {
    x: sx / totalArea,
    y: sy / totalArea,
    z: sz / totalArea,
  };
  const planeOffset = (normal[0] * point.x) + (normal[1] * point.y) + (normal[2] * point.z);
  let maxPlaneDistance = 0;
  const planarTol = Math.max(1e-7, Math.abs(Number(planarityTolerance) || 0));
  for (const vertex of vertices) {
    const dist = Math.abs(
      (normal[0] * vertex.x)
      + (normal[1] * vertex.y)
      + (normal[2] * vertex.z)
      - planeOffset,
    );
    if (dist > maxPlaneDistance) maxPlaneDistance = dist;
    if (dist > planarTol) return null;
  }

  return {
    normal,
    point,
    planeOffset,
    area: totalArea,
    vertices,
    maxPlaneDistance,
  };
}

function pointDistanceToFacePlane(point, faceAnalysis) {
  const p = toPoint3Object(point);
  if (!p || !faceAnalysis || !Array.isArray(faceAnalysis.normal)) return Infinity;
  return (
    (faceAnalysis.normal[0] * p.x)
    + (faceAnalysis.normal[1] * p.y)
    + (faceAnalysis.normal[2] * p.z)
    - Number(faceAnalysis.planeOffset || 0)
  );
}

function arePlanarFaceAnalysesCoplanar(faceA, faceB, {
  distanceTolerance = 1e-5,
  normalTolerance = 2e-4,
} = {}) {
  if (!faceA || !faceB) return false;
  const normalA = Array.isArray(faceA.normal) ? faceA.normal : null;
  const normalB = Array.isArray(faceB.normal) ? faceB.normal : null;
  if (!normalA || !normalB) return false;

  const dot = Math.abs(
    (normalA[0] * normalB[0])
    + (normalA[1] * normalB[1])
    + (normalA[2] * normalB[2]),
  );
  const normalTol = Math.max(1e-8, Math.abs(Number(normalTolerance) || 0));
  if ((1 - dot) > normalTol) return false;

  const distanceTol = Math.max(1e-7, Math.abs(Number(distanceTolerance) || 0));
  const vertsA = Array.isArray(faceA.vertices) ? faceA.vertices : [];
  const vertsB = Array.isArray(faceB.vertices) ? faceB.vertices : [];
  for (const vertex of vertsA) {
    if (Math.abs(pointDistanceToFacePlane(vertex, faceB)) > distanceTol) return false;
  }
  for (const vertex of vertsB) {
    if (Math.abs(pointDistanceToFacePlane(vertex, faceA)) > distanceTol) return false;
  }
  return true;
}

function findCoplanarAdjacentFaceForFilletEndCap(solid, endCapFaceName, {
  featureID = '',
  planarityTolerance = 1e-5,
  distanceTolerance = 1e-5,
  normalTolerance = 2e-4,
} = {}) {
  if (!solid || !endCapFaceName) return null;
  const faceEntries = (typeof solid.getFaces === 'function') ? (solid.getFaces(false) || []) : [];
  if (!Array.isArray(faceEntries) || faceEntries.length === 0) return null;

  const faceTriangles = new Map();
  for (const entry of faceEntries) {
    const name = String(entry?.faceName || '').trim();
    if (!name) continue;
    faceTriangles.set(name, Array.isArray(entry?.triangles) ? entry.triangles : []);
  }
  const analysisCache = new Map();
  const boundarySegmentsCache = new Map();
  const analysisPointTolerance = Math.max(distanceTolerance * 0.5, 1e-6);
  const boundaryPointTolerance = Math.max(distanceTolerance * 0.5, 1e-6);
  const boundaryMatchTolerance = Math.max(distanceTolerance * 2, 2e-4);
  const boundaryDirectionTolerance = 5e-3;
  const minSharedBoundaryLength = Math.max(boundaryMatchTolerance * 2, distanceTolerance * 4);
  const getFaceAnalysis = (faceName) => {
    if (analysisCache.has(faceName)) return analysisCache.get(faceName);
    const analysis = analyzePlanarFaceTriangles(faceTriangles.get(faceName), {
      pointTolerance: analysisPointTolerance,
      planarityTolerance,
    });
    analysisCache.set(faceName, analysis || null);
    return analysis || null;
  };
  const getBoundarySegments = (faceName) => {
    if (boundarySegmentsCache.has(faceName)) return boundarySegmentsCache.get(faceName);
    const segments = buildBoundarySegmentsFromFaceTriangles(faceTriangles.get(faceName), {
      pointTolerance: boundaryPointTolerance,
    });
    boundarySegmentsCache.set(faceName, segments);
    return segments;
  };

  const endCapAnalysis = getFaceAnalysis(endCapFaceName);
  if (!endCapAnalysis) return null;
  const endCapBoundarySegments = getBoundarySegments(endCapFaceName);

  const boundaries = (typeof solid.getBoundaryEdgePolylines === 'function')
    ? (solid.getBoundaryEdgePolylines() || [])
    : [];
  const nativeNeighborSharedLengths = new Map();
  for (const boundary of boundaries) {
    const faceA = String(boundary?.faceA || '').trim();
    const faceB = String(boundary?.faceB || '').trim();
    if (!faceA || !faceB || faceA === faceB) continue;
    const sharedLength = boundaryPolylineLength(boundary?.positions || boundary?.pts);
    if (!(sharedLength > 0)) continue;
    if (faceA === endCapFaceName && faceB) {
      nativeNeighborSharedLengths.set(faceB, (nativeNeighborSharedLengths.get(faceB) || 0) + sharedLength);
    } else if (faceB === endCapFaceName && faceA) {
      nativeNeighborSharedLengths.set(faceA, (nativeNeighborSharedLengths.get(faceA) || 0) + sharedLength);
    }
  }

  const featureToken = String(featureID || '').trim();
  let best = null;
  for (const neighborName of faceTriangles.keys()) {
    if (!neighborName || neighborName === endCapFaceName) continue;
    const neighborMetadata = (typeof solid.getFaceMetadata === 'function')
      ? (solid.getFaceMetadata(neighborName) || {})
      : {};
    if (neighborMetadata?.filletEndCap === true) continue;

    const neighborAnalysis = getFaceAnalysis(neighborName);
    if (!neighborAnalysis) continue;
    if (!arePlanarFaceAnalysesCoplanar(endCapAnalysis, neighborAnalysis, {
      distanceTolerance,
      normalTolerance,
    })) {
      continue;
    }

    const nativeSharedLength = nativeNeighborSharedLengths.get(neighborName) || 0;
    let sharedLength = nativeSharedLength;
    if (endCapBoundarySegments.length > 0) {
      const neighborBoundarySegments = getBoundarySegments(neighborName);
      if (neighborBoundarySegments.length > 0) {
        sharedLength = Math.max(
          sharedLength,
          computeSharedBoundaryLength(endCapBoundarySegments, neighborBoundarySegments, {
            matchTolerance: boundaryMatchTolerance,
            directionTolerance: boundaryDirectionTolerance,
          }),
        );
      }
    }
    if (!(sharedLength > minSharedBoundaryLength)) continue;

    const neighborFeatureId = String(
      neighborMetadata?.sourceFeatureId
      || neighborMetadata?.featureID
      || '',
    ).trim();
    const ownershipRank = (
      featureToken
      && neighborFeatureId
      && neighborFeatureId !== featureToken
    ) || (
      featureToken
      && !String(neighborName || '').startsWith(`${featureToken}_`)
    )
      ? 1
      : 0;
    const candidate = {
      faceName: neighborName,
      sharedLength,
      area: Number(neighborAnalysis.area) || 0,
      ownershipRank,
    };
    if (
      !best
      || candidate.ownershipRank > best.ownershipRank
      || (candidate.ownershipRank === best.ownershipRank && candidate.sharedLength > best.sharedLength)
      || (candidate.ownershipRank === best.ownershipRank
        && candidate.sharedLength === best.sharedLength
        && candidate.area > best.area)
    ) {
      best = candidate;
    }
  }

  return best;
}

function mergeCoplanarAdjacentFilletEndCaps(solid, opts = {}) {
  if (!solid || typeof solid.getFaceNames !== 'function') {
    return { mergedEndCaps: 0 };
  }

  const featureID = String(opts?.featureID || '').trim();
  const debug = !!opts?.debug;
  const logProcess = !!opts?.consoleLogProcess || debug;
  const nudgeDistance = Math.abs(Number(opts?.nudgeFaceDistance) || 0);
  const solidTol = deriveSolidToleranceFromVerts(solid, 1e-5);
  const distanceTolerance = Math.max(solidTol * 4, 2e-4, nudgeDistance * 3);
  const planarityTolerance = Math.max(distanceTolerance * 2, 2e-4, nudgeDistance * 4);
  const normalTolerance = Math.max(1e-6, Math.abs(Number(opts?.normalTolerance) || 2e-4));
  const core = getSyncedCppSolidCore(solid);
  let mergedEndCaps = 0;
  const maxPasses = Math.max(1, (solid.getFaceNames() || []).length);

  for (let pass = 0; pass < maxPasses; pass++) {
    const endCapFaceNames = (solid.getFaceNames() || [])
      .map((name) => String(name || '').trim())
      .filter((name) => {
        if (!name) return false;
        const metadata = (typeof solid.getFaceMetadata === 'function')
          ? (solid.getFaceMetadata(name) || {})
          : {};
        return metadata?.filletEndCap === true;
      });
    if (endCapFaceNames.length === 0) break;

    let mergedThisPass = false;
    for (const endCapFaceName of endCapFaceNames) {
      const target = findCoplanarAdjacentFaceForFilletEndCap(solid, endCapFaceName, {
        featureID,
        planarityTolerance,
        distanceTolerance,
        normalTolerance,
      });
      if (!target?.faceName) continue;

      const targetMetadata = cloneFaceMetadataObject(core.getFaceMetadata(target.faceName) || {});
      if (logProcess) {
        console.log('[Solid.fillet] Renaming fillet face.', {
          featureID,
          operation: 'merge coplanar end cap',
          fromFaceName: endCapFaceName,
          toFaceName: target.faceName,
          sharedLength: target.sharedLength,
          area: target.area,
          distanceTolerance,
          planarityTolerance,
          normalTolerance,
        });
      }
      if (!core.renameFace(endCapFaceName, target.faceName)) {
        if (logProcess) {
          console.log('[Solid.fillet] Fillet face rename failed.', {
            featureID,
            operation: 'merge coplanar end cap',
            fromFaceName: endCapFaceName,
            toFaceName: target.faceName,
          });
        }
        continue;
      }
      if (logProcess) {
        console.log('[Solid.fillet] Fillet face rename succeeded.', {
          featureID,
          operation: 'merge coplanar end cap',
          fromFaceName: endCapFaceName,
          toFaceName: target.faceName,
        });
      }
      core.setFaceMetadata(target.faceName, targetMetadata);
      syncSolidAuthoringStateFromCpp(solid, core);
      solid._dirty = true;
      solid._faceIndex = null;
      try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
      solid._manifold = null;
      mergedEndCaps += 1;
      mergedThisPass = true;

      if (debug) {
        console.log('[Solid.fillet] Merged coplanar fillet end cap into adjacent face.', {
          featureID,
          endCapFaceName,
          targetFaceName: target.faceName,
          sharedLength: target.sharedLength,
          area: target.area,
          distanceTolerance,
          planarityTolerance,
          normalTolerance,
        });
      }
      break;
    }

    if (!mergedThisPass) break;
  }

  return {
    mergedEndCaps,
    distanceTolerance,
    planarityTolerance,
    normalTolerance,
  };
}

function reversePostBooleanFilletEndCapNudge(solid, nudgeFaceDistance = 0, { debug = false, featureID = '' } = {}) {
  if (!solid || typeof solid.getFaceNames !== 'function' || typeof solid.pushFace !== 'function') {
    return { reversedFaces: 0 };
  }

  const nudgeAmount = Math.abs(Number(nudgeFaceDistance) || 0);
  if (!(nudgeAmount > 0)) return { reversedFaces: 0 };

  const endCapFaceNames = (solid.getFaceNames() || [])
    .map((name) => String(name || '').trim())
    .filter((name) => {
      if (!name) return false;
      const metadata = (typeof solid.getFaceMetadata === 'function')
        ? (solid.getFaceMetadata(name) || {})
        : {};
      return metadata?.filletEndCap === true;
    });
  if (endCapFaceNames.length === 0) {
    return { reversedFaces: 0, nudgeAmount };
  }

  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  const getFaceMetadata = (name) => (typeof solid.getFaceMetadata === 'function')
    ? (solid.getFaceMetadata(name) || {})
    : {};
  const isFilletManagedNeighbor = (faceName) => {
    if (!faceName) return false;
    const metadata = getFaceMetadata(faceName);
    return metadata?.filletEndCap !== true && (
      metadata?.filletSideWall === true
      || metadata?.filletMergedSideWall === true
      || typeof metadata?.filletRoundFace === 'string'
      || faceName.endsWith('_TUBE_Outer')
    );
  };
  const vertexToFaceNames = new Map();
  if (idToFaceName && triVerts.length >= 3 && triIDs.length > 0) {
    const triCount = Math.min(triIDs.length, (triVerts.length / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
      const faceName = String(idToFaceName.get(triIDs[triIndex] >>> 0) || '').trim();
      if (!faceName) continue;
      const base = triIndex * 3;
      for (const vertexIndex of [triVerts[base + 0] >>> 0, triVerts[base + 1] >>> 0, triVerts[base + 2] >>> 0]) {
        let faceNames = vertexToFaceNames.get(vertexIndex);
        if (!faceNames) {
          faceNames = new Set();
          vertexToFaceNames.set(vertexIndex, faceNames);
        }
        faceNames.add(faceName);
      }
    }
  }

  let reversedFaces = 0;
  let skippedFaces = 0;
  for (const faceName of endCapFaceNames) {
    let touchesFilletManagedNeighbor = false;
    if (idToFaceName && vertexToFaceNames.size > 0) {
      const faceVertexIndices = new Set();
      const triCount = Math.min(triIDs.length, (triVerts.length / 3) | 0);
      for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        if (String(idToFaceName.get(triIDs[triIndex] >>> 0) || '').trim() !== faceName) continue;
        const base = triIndex * 3;
        faceVertexIndices.add(triVerts[base + 0] >>> 0);
        faceVertexIndices.add(triVerts[base + 1] >>> 0);
        faceVertexIndices.add(triVerts[base + 2] >>> 0);
      }
      for (const vertexIndex of faceVertexIndices) {
        const sharedFaceNames = vertexToFaceNames.get(vertexIndex);
        if (!sharedFaceNames) continue;
        for (const sharedFaceName of sharedFaceNames) {
          if (sharedFaceName === faceName) continue;
          if (isFilletManagedNeighbor(sharedFaceName)) {
            touchesFilletManagedNeighbor = true;
            break;
          }
        }
        if (touchesFilletManagedNeighbor) break;
      }
    }
    if (touchesFilletManagedNeighbor) {
      skippedFaces += 1;
      continue;
    }
    try {
      solid.pushFace(faceName, -nudgeAmount, {
        warnMissing: false,
        warnInvalidNormal: false,
      });
      reversedFaces += 1;
    } catch { }
  }

  if (debug && reversedFaces > 0) {
    console.log('[Solid.fillet] Reversed post-boolean fillet end-cap nudge.', {
      featureID,
      reversedFaces,
      skippedFaces,
      nudgeAmount,
    });
  }

  return {
    reversedFaces,
    skippedFaces,
    nudgeAmount,
  };
}

function computeTriangleGeometryFromAuthoringState(vertProperties, triVerts, triIndex) {
  const base = triIndex * 3;
  const i0 = triVerts[base + 0] >>> 0;
  const i1 = triVerts[base + 1] >>> 0;
  const i2 = triVerts[base + 2] >>> 0;
  const p0Index = i0 * 3;
  const p1Index = i1 * 3;
  const p2Index = i2 * 3;
  const p0 = {
    x: Number(vertProperties[p0Index + 0]) || 0,
    y: Number(vertProperties[p0Index + 1]) || 0,
    z: Number(vertProperties[p0Index + 2]) || 0,
  };
  const p1 = {
    x: Number(vertProperties[p1Index + 0]) || 0,
    y: Number(vertProperties[p1Index + 1]) || 0,
    z: Number(vertProperties[p1Index + 2]) || 0,
  };
  const p2 = {
    x: Number(vertProperties[p2Index + 0]) || 0,
    y: Number(vertProperties[p2Index + 1]) || 0,
    z: Number(vertProperties[p2Index + 2]) || 0,
  };

  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const vx = p2.x - p0.x;
  const vy = p2.y - p0.y;
  const vz = p2.z - p0.z;
  const cx = (uy * vz) - (uz * vy);
  const cy = (uz * vx) - (ux * vz);
  const cz = (ux * vy) - (uy * vx);
  const twiceArea = Math.hypot(cx, cy, cz);
  const area = twiceArea * 0.5;
  const edge01 = segmentLength3D(p0, p1);
  const edge12 = segmentLength3D(p1, p2);
  const edge20 = segmentLength3D(p2, p0);
  const longestEdge = Math.max(edge01, edge12, edge20, 0);
  const minHeight = (longestEdge > 1e-12)
    ? ((twiceArea || 0) / longestEdge)
    : 0;

  return {
    vertexIndices: [i0, i1, i2],
    points: [p0, p1, p2],
    edgeLengths: [edge01, edge12, edge20],
    area,
    longestEdge,
    minHeight,
  };
}

function buildFaceTriangleMapFromAuthoringState(vertProperties, triVerts, triIDs, idToFaceName) {
  const faceTriangles = new Map();
  const tv = Array.isArray(triVerts) ? triVerts : [];
  const vp = Array.isArray(vertProperties) ? vertProperties : [];
  const ids = Array.isArray(triIDs) ? triIDs : [];
  const idToFace = idToFaceName instanceof Map ? idToFaceName : null;
  if (!idToFace) return faceTriangles;

  const triCount = Math.min(ids.length, (tv.length / 3) | 0);
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const faceName = String(idToFace.get(ids[triIndex] >>> 0) || '').trim();
    if (!faceName) continue;
    const geometry = computeTriangleGeometryFromAuthoringState(vp, tv, triIndex);
    let tris = faceTriangles.get(faceName);
    if (!tris) {
      tris = [];
      faceTriangles.set(faceName, tris);
    }
    tris.push({
      p1: [geometry.points[0].x, geometry.points[0].y, geometry.points[0].z],
      p2: [geometry.points[1].x, geometry.points[1].y, geometry.points[1].z],
      p3: [geometry.points[2].x, geometry.points[2].y, geometry.points[2].z],
    });
  }
  return faceTriangles;
}

function pruneUnusedFaceLabelsFromTriangles(solid) {
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
  const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
  const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  if (!ids || !faceToId || !idToFace) return 0;

  const usedIDs = new Set();
  for (let i = 0; i < ids.length; i++) usedIDs.add(ids[i] >>> 0);

  let removed = 0;
  for (const [faceName, faceID] of Array.from(faceToId.entries())) {
    if (usedIDs.has(faceID >>> 0)) continue;
    faceToId.delete(faceName);
    idToFace.delete(faceID);
    if (solid._faceMetadata instanceof Map) solid._faceMetadata.delete(faceName);
    removed += 1;
  }
  return removed;
}

function cleanupSingleNeighborFilletFaceIslands(solid, opts = {}) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
  const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  if (!solid || !tv || !ids || !idToFace) {
    return { reassignedTriangles: 0, reassignedComponents: 0 };
  }

  const featureID = String(opts?.featureID || '').trim();
  const debug = !!opts?.debug;
  const triCount = Math.min(ids.length, Math.floor(tv.length / 3));
  if (triCount <= 0) {
    return { reassignedTriangles: 0, reassignedComponents: 0 };
  }

  const getFaceMetadata = (faceName) => (typeof solid.getFaceMetadata === 'function')
    ? (solid.getFaceMetadata(faceName) || {})
    : {};
  const isFilletRoundFace = (faceName) => {
    const name = String(faceName || '').trim();
    if (!name) return false;
    const metadata = getFaceMetadata(name);
    return metadata?.filletSideWall === true
      || metadata?.filletMergedSideWall === true
      || metadata?.filletRoundFace === name
      || (typeof metadata?.filletRoundFace === 'string' && metadata.filletRoundFace.length > 0)
      || name.endsWith('_TUBE_Outer')
      || (featureID && name.startsWith(`${featureID}_FILLET_SIDEWALL_`));
  };
  const isFilletEndCap = (faceName) => getFaceMetadata(faceName)?.filletEndCap === true;

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToTris = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const base = triIndex * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let list = edgeToTris.get(key);
      if (!list) {
        list = [];
        edgeToTris.set(key, list);
      }
      list.push(triIndex);
    }
  }

  const adjacency = Array.from({ length: triCount }, () => []);
  for (const list of edgeToTris.values()) {
    if (list.length !== 2) continue;
    adjacency[list[0]].push(list[1]);
    adjacency[list[1]].push(list[0]);
  }

  const seen = new Uint8Array(triCount);
  const components = [];
  const faceComponentCounts = new Map();
  const faceLargestComponentSize = new Map();
  for (let seed = 0; seed < triCount; seed += 1) {
    if (seen[seed]) continue;
    const faceID = ids[seed] >>> 0;
    const stack = [seed];
    const tris = [];
    const neighborIDs = new Set();
    seen[seed] = 1;

    while (stack.length > 0) {
      const triIndex = stack.pop();
      tris.push(triIndex);
      for (const neighborIndex of adjacency[triIndex]) {
        const neighborFaceID = ids[neighborIndex] >>> 0;
        if (neighborFaceID === faceID) {
          if (seen[neighborIndex]) continue;
          seen[neighborIndex] = 1;
          stack.push(neighborIndex);
        } else {
          neighborIDs.add(neighborFaceID);
        }
      }
    }

    components.push({ faceID, tris, neighborIDs });
    faceComponentCounts.set(faceID, (faceComponentCounts.get(faceID) || 0) + 1);
    faceLargestComponentSize.set(
      faceID,
      Math.max(faceLargestComponentSize.get(faceID) || 0, tris.length),
    );
  }

  const countContactEdgeChains = (component, neighborID) => {
    const componentTris = new Set(component.tris);
    const vertexAdj = new Map();
    let contactEdgeCount = 0;
    const addVertexEdge = (a, b) => {
      let aSet = vertexAdj.get(a);
      if (!aSet) {
        aSet = new Set();
        vertexAdj.set(a, aSet);
      }
      let bSet = vertexAdj.get(b);
      if (!bSet) {
        bSet = new Set();
        vertexAdj.set(b, bSet);
      }
      aSet.add(b);
      bSet.add(a);
    };

    for (const triIndex of component.tris) {
      const base = triIndex * 3;
      for (const [a, b] of [
        [tv[base + 0] >>> 0, tv[base + 1] >>> 0],
        [tv[base + 1] >>> 0, tv[base + 2] >>> 0],
        [tv[base + 2] >>> 0, tv[base + 0] >>> 0],
      ]) {
        const triList = edgeToTris.get(edgeKey(a, b)) || [];
        let touchesTargetNeighbor = false;
        for (const otherTriIndex of triList) {
          if (componentTris.has(otherTriIndex)) continue;
          if ((ids[otherTriIndex] >>> 0) !== neighborID) continue;
          touchesTargetNeighbor = true;
          break;
        }
        if (!touchesTargetNeighbor) continue;
        contactEdgeCount += 1;
        addVertexEdge(a, b);
      }
    }

    if (contactEdgeCount === 0) return { contactEdgeCount: 0, chainCount: 0 };

    let chainCount = 0;
    const visited = new Set();
    for (const vertex of vertexAdj.keys()) {
      if (visited.has(vertex)) continue;
      chainCount += 1;
      const stack = [vertex];
      visited.add(vertex);
      while (stack.length > 0) {
        const current = stack.pop();
        for (const next of vertexAdj.get(current) || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return { contactEdgeCount, chainCount };
  };

  let reassignedTriangles = 0;
  let reassignedComponents = 0;
  const details = [];
  for (const component of components) {
    if ((faceComponentCounts.get(component.faceID) || 0) <= 1) continue;
    if (component.tris.length >= (faceLargestComponentSize.get(component.faceID) || 0)) continue;
    if (component.neighborIDs.size !== 1) continue;

    const neighborID = Array.from(component.neighborIDs)[0] >>> 0;
    if (neighborID === component.faceID) continue;
    const sourceFaceName = String(idToFace.get(component.faceID) || '').trim();
    const neighborFaceName = String(idToFace.get(neighborID) || '').trim();
    if (!sourceFaceName || !neighborFaceName) continue;
    if (isFilletEndCap(sourceFaceName) || isFilletEndCap(neighborFaceName)) continue;

    const sourceIsRound = isFilletRoundFace(sourceFaceName);
    const neighborIsRound = isFilletRoundFace(neighborFaceName);
    if (sourceIsRound === neighborIsRound) continue;

    const contact = countContactEdgeChains(component, neighborID);
    if (contact.chainCount !== 1) continue;

    for (const triIndex of component.tris) {
      if ((ids[triIndex] >>> 0) !== component.faceID) continue;
      ids[triIndex] = neighborID;
      reassignedTriangles += 1;
    }
    reassignedComponents += 1;
    details.push({
      fromFaceName: sourceFaceName,
      toFaceName: neighborFaceName,
      triangles: component.tris.length,
      contactEdgeCount: contact.contactEdgeCount,
    });
  }

  if (reassignedTriangles > 0) {
    pruneUnusedFaceLabelsFromTriangles(solid);
    solid._dirty = true;
    solid._faceIndex = null;
    try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
    solid._manifold = null;
    if (debug) {
      console.log('[Solid.fillet] Cleaned single-neighbor fillet face islands.', {
        featureID,
        reassignedTriangles,
        reassignedComponents,
        details,
      });
    }
  }

  return { reassignedTriangles, reassignedComponents, details };
}

export function cleanupFilletSingleNeighborIslands(solid, opts = {}) {
  return cleanupSingleNeighborFilletFaceIslands(solid, opts);
}

function collapseFilletSideWallFaces(solid, opts = {}) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
  const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
  if (!solid || !tv || !vp || !ids || !faceToId) {
    return { collapsedEdges: 0, collapsedTriangles: 0 };
  }

  const featureID = String(opts?.featureID || '').trim();
  const debug = !!opts?.debug;
  const forcedCollapseFaceIDs = new Set();
  const opportunisticCollapseFaceIDs = new Set();
  const collapseFaceNames = [];
  const sideWallNameNeedle = featureID ? `${featureID}_FILLET_SIDEWALL_` : '_FILLET_SIDEWALL_';
  const hostSideWallPattern = /_(?:FACE_A|FACE_B|SIDE_A|SIDE_B)(?:$|_)/u;
  const wedgeSurfaceSideWallPattern = /_(?:SURFACE_CA|SURFACE_CB|WEDGE_A|WEDGE_B)(?:$|_)/u;
  for (const [faceNameRaw, faceIDRaw] of faceToId.entries()) {
    const faceName = String(faceNameRaw || '').trim();
    const faceID = faceIDRaw >>> 0;
    if (!faceName) continue;
    const metadata = (typeof solid.getFaceMetadata === 'function')
      ? (solid.getFaceMetadata(faceName) || {})
      : {};
    const isDeterministicSideWall = featureID
      ? faceName.startsWith(sideWallNameNeedle)
      : faceName.includes(sideWallNameNeedle);
    const isPreservedIntermediateSideWall = featureID
      && faceName.startsWith(`${featureID}_`)
      && hostSideWallPattern.test(faceName);
    const isPreservedWedgeSurfaceSideWall = featureID
      && faceName.startsWith(`${featureID}_`)
      && wedgeSurfaceSideWallPattern.test(faceName);
    const isRoundPipeFace = faceName.endsWith('_TUBE_Outer');
    if (
      (!isDeterministicSideWall && !isPreservedIntermediateSideWall && !isPreservedWedgeSurfaceSideWall)
      || isRoundPipeFace
      || metadata?.filletRoundFace === faceName
    ) continue;
    if (isPreservedWedgeSurfaceSideWall) opportunisticCollapseFaceIDs.add(faceID);
    else forcedCollapseFaceIDs.add(faceID);
    collapseFaceNames.push(faceName);
  }
  if (forcedCollapseFaceIDs.size === 0 && opportunisticCollapseFaceIDs.size === 0) {
    return { collapsedEdges: 0, collapsedTriangles: 0 };
  }

  const triCount = Math.min(ids.length, (tv.length / 3) | 0);
  const vertexCount = (vp.length / 3) | 0;
  if (triCount <= 0 || vertexCount <= 0) {
    return { collapsedEdges: 0, collapsedTriangles: 0 };
  }

  const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToFaceIDs = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const faceID = ids[triIndex] >>> 0;
    const base = triIndex * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let faceIDs = edgeToFaceIDs.get(key);
      if (!faceIDs) {
        faceIDs = new Set();
        edgeToFaceIDs.set(key, faceIDs);
      }
      faceIDs.add(faceID);
    }
  }

  const collapseFaceIDs = new Set([...forcedCollapseFaceIDs, ...opportunisticCollapseFaceIDs]);
  const roundFaceIDs = new Set();
  if (idToFace) {
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
      const faceID = faceIDRaw >>> 0;
      if (collapseFaceIDs.has(faceID)) continue;
      const faceName = String(faceNameRaw || '').trim();
      if (!faceName) continue;
      const metadata = (typeof solid.getFaceMetadata === 'function')
        ? (solid.getFaceMetadata(faceName) || {})
        : {};
      if (
        faceName.endsWith('_TUBE_Outer')
        || metadata?.filletRoundFace === true
        || metadata?.filletRoundFace === faceName
      ) {
        roundFaceIDs.add(faceID);
      }
    }
  }
  const edgeTouchesRoundFace = (a, b) => {
    const faceIDs = edgeToFaceIDs.get(edgeKey(a, b));
    if (!faceIDs) return false;
    for (const faceID of faceIDs) {
      if (roundFaceIDs.has(faceID >>> 0)) return true;
    }
    return false;
  };
  const edgeTouchesPreservedFace = (a, b) => {
    const faceIDs = edgeToFaceIDs.get(edgeKey(a, b));
    if (!faceIDs) return false;
    for (const faceID of faceIDs) {
      const id = faceID >>> 0;
      if (!collapseFaceIDs.has(id) && !roundFaceIDs.has(id)) return true;
    }
    return false;
  };
  const protectedVertices = new Set();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const faceID = ids[triIndex] >>> 0;
    if (!collapseFaceIDs.has(faceID)) continue;
    const base = triIndex * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      if (!edgeTouchesPreservedFace(a, b)) continue;
      protectedVertices.add(a);
      protectedVertices.add(b);
    }
  }

  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) parent[i] = i;
  const find = (index) => {
    let i = index;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const uniteDirected = (source, target) => {
    const rs = find(source);
    const rt = find(target);
    if (rs === rt) return false;
    parent[rs] = rt;
    return true;
  };

  const collapseCandidates = [];
  const pointForVertex = (vertexIndex) => ({
    x: Number(vp[(vertexIndex * 3) + 0]) || 0,
    y: Number(vp[(vertexIndex * 3) + 1]) || 0,
    z: Number(vp[(vertexIndex * 3) + 2]) || 0,
  });
  const vertexDistanceSq = (a, b) => point3DistanceSq(pointForVertex(a), pointForVertex(b));
  const pushCandidate = (source, target, forced, mode) => {
    if (source == null || target == null || source === target) return false;
    if (roundFaceIDs.size > 0 && protectedVertices.has(source)) return false;
    collapseCandidates.push({ a: source >>> 0, b: target >>> 0, forced, mode });
    return true;
  };
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const faceID = ids[triIndex] >>> 0;
    const forced = forcedCollapseFaceIDs.has(faceID);
    const opportunistic = opportunisticCollapseFaceIDs.has(faceID);
    if (!forced && !opportunistic) continue;
    const geometry = computeTriangleGeometryFromAuthoringState(vp, tv, triIndex);
    const [i0, i1, i2] = geometry.vertexIndices;
    const [edge01, edge12, edge20] = geometry.edgeLengths;
    const edges = [
      { a: i0, b: i1, opposite: i2, length: edge01 },
      { a: i1, b: i2, opposite: i0, length: edge12 },
      { a: i2, b: i0, opposite: i1, length: edge20 },
    ];

    const hostEdges = edges.filter((edge) => edgeTouchesPreservedFace(edge.a, edge.b));
    let addedDirected = false;
    if (hostEdges.length > 0) {
      hostEdges.sort((left, right) => right.length - left.length);
      for (const edge of hostEdges) {
        const source = edge.opposite;
        const target = vertexDistanceSq(source, edge.a) <= vertexDistanceSq(source, edge.b)
          ? edge.a
          : edge.b;
        if (pushCandidate(source, target, forced, 'toward-preserved-face')) {
          addedDirected = true;
          break;
        }
      }
    }

    if (!addedDirected) {
      const roundEdges = edges.filter((edge) => edgeTouchesRoundFace(edge.a, edge.b));
      roundEdges.sort((left, right) => left.length - right.length);
      for (const edge of roundEdges) {
        const sourceOptions = [edge.a, edge.b].filter((vertexIndex) => !protectedVertices.has(vertexIndex));
        if (sourceOptions.length === 0) continue;
        const source = sourceOptions.length === 1
          ? sourceOptions[0]
          : (vertexDistanceSq(sourceOptions[0], edge.opposite) <= vertexDistanceSq(sourceOptions[1], edge.opposite)
            ? sourceOptions[0]
            : sourceOptions[1]);
        if (pushCandidate(source, edge.opposite, forced, 'away-from-round-face')) {
          addedDirected = true;
          break;
        }
      }
    }

    if (addedDirected) continue;

    let a = i0;
    let b = i1;
    let minLength = edge01;
    if (edge12 < minLength) {
      minLength = edge12;
      a = i1;
      b = i2;
    }
    if (edge20 < minLength) {
      a = i2;
      b = i0;
    }
    if (roundFaceIDs.size === 0) {
      const source = a < b ? b : a;
      const target = a < b ? a : b;
      pushCandidate(source, target, forced, 'shortest-edge-fallback');
    } else if (protectedVertices.has(a) && !protectedVertices.has(b)) {
      pushCandidate(b, a, forced, 'shortest-edge-fallback');
    } else {
      pushCandidate(a, b, forced, 'shortest-edge-fallback');
    }
  }

  let collapsedEdges = 0;
  let collapsedTriangles = 0;
  let collapsedWedgeSurfaceTriangles = 0;
  for (const candidate of collapseCandidates) {
    if (uniteDirected(candidate.a, candidate.b)) collapsedEdges += 1;
    collapsedTriangles += 1;
    if (!candidate.forced) collapsedWedgeSurfaceTriangles += 1;
  }
  if (collapsedEdges === 0 && collapsedTriangles === 0) {
    return { collapsedEdges: 0, collapsedTriangles: 0 };
  }

  const rootCoords = new Map();
  for (let i = 0; i < vertexCount; i += 1) {
    const root = find(i);
    if (rootCoords.has(root)) continue;
    rootCoords.set(root, [
      vp[root * 3 + 0],
      vp[root * 3 + 1],
      vp[root * 3 + 2],
    ]);
  }
  for (let i = 0; i < vertexCount; i += 1) {
    const coords = rootCoords.get(find(i));
    vp[i * 3 + 0] = coords[0];
    vp[i * 3 + 1] = coords[1];
    vp[i * 3 + 2] = coords[2];
  }

  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < vp.length; i += 3) {
    solid._vertKeyToIndex.set(`${vp[i]},${vp[i + 1]},${vp[i + 2]}`, (i / 3) | 0);
  }
  solid._faceIndex = null;
  solid._dirty = true;
  try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
  solid._manifold = null;
  solid._cppSolidCoreSyncStamp = null;

  const summary = {
    collapsedEdges,
    collapsedTriangles,
    removedSideWallTriangles: 0,
    removedDegenerateTriangles: 0,
    removedDuplicateTriangles: 0,
    collapsedWedgeSurfaceTriangles,
    sideWallFaceNames: collapseFaceNames,
  };
  if (debug) {
    console.log('[Solid.fillet] Collapsed fillet side-wall face vertices onto shortest edges.', {
      featureID,
      ...summary,
    });
  }
  return summary;
}

function reassignTinyFilletSidewallSliverTriangles(solid, opts = {}) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  const ids = Array.isArray(solid?._triIDs) ? Array.from(solid._triIDs) : null;
  const faceToId = solid?._faceNameToID instanceof Map ? new Map(solid._faceNameToID) : null;
  const idToFace = solid?._idToFaceName instanceof Map ? new Map(solid._idToFaceName) : null;
  if (!solid || !tv || !vp || !ids || !faceToId || !idToFace) {
    return { reassignedTriangles: 0 };
  }

  const triCount = Math.min(ids.length, (tv.length / 3) | 0);
  if (triCount <= 0) return { reassignedTriangles: 0 };

  const debug = !!opts?.debug;
  const featureID = String(opts?.featureID || '').trim();
  const solidTol = deriveSolidToleranceFromVerts(solid, 1e-5);
  const sliverHeightTolerance = Math.max(solidTol * 4, 2e-4);
  const planeDistanceTolerance = Math.max(sliverHeightTolerance * 2, 3e-4);
  const boundaryDistanceTolerance = Math.max(sliverHeightTolerance * 1.5, 3e-4);
  const analysisPointTolerance = Math.max(planeDistanceTolerance * 0.5, 1e-6);
  const planarityTolerance = Math.max(planeDistanceTolerance * 2, 5e-4);

  const faceTriangles = buildFaceTriangleMapFromAuthoringState(vp, tv, ids, idToFace);

  const faceAnalysisCache = new Map();
  const faceAreaCache = new Map();
  const boundarySegmentsCache = new Map();
  const getFaceAnalysis = (faceName) => {
    if (faceAnalysisCache.has(faceName)) return faceAnalysisCache.get(faceName);
    const analysis = analyzePlanarFaceTriangles(faceTriangles.get(faceName), {
      pointTolerance: analysisPointTolerance,
      planarityTolerance,
    });
    faceAnalysisCache.set(faceName, analysis || null);
    return analysis || null;
  };
  const getFaceArea = (faceName) => {
    if (faceAreaCache.has(faceName)) return faceAreaCache.get(faceName);
    const analysis = getFaceAnalysis(faceName);
    const area = analysis ? (Number(analysis.area) || 0) : estimateFaceArea(solid, faceName);
    faceAreaCache.set(faceName, area);
    return area;
  };
  const getBoundarySegments = (faceName) => {
    if (boundarySegmentsCache.has(faceName)) return boundarySegmentsCache.get(faceName);
    const segments = buildBoundarySegmentsFromFaceTriangles(faceTriangles.get(faceName), {
      pointTolerance: analysisPointTolerance,
    });
    boundarySegmentsCache.set(faceName, Array.isArray(segments) ? segments : []);
    return boundarySegmentsCache.get(faceName);
  };
  const candidateFaceNames = Array.from(faceTriangles.keys())
    .map((faceName) => String(faceName || '').trim())
    .filter((faceName) => !!faceName);

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToTriangles = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const base = triIndex * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let list = edgeToTriangles.get(key);
      if (!list) {
        list = [];
        edgeToTriangles.set(key, list);
      }
      list.push(triIndex);
    }
  }

  let reassignedTriangles = 0;
  const mutationDetails = [];
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const currentFaceID = ids[triIndex] >>> 0;
    const currentFaceName = String(idToFace.get(currentFaceID) || '').trim();
    if (!currentFaceName) continue;

    const currentMetadata = (typeof solid.getFaceMetadata === 'function')
      ? (solid.getFaceMetadata(currentFaceName) || {})
      : {};
    const isFilletSidewall = currentMetadata?.filletSideWall === true
      || currentMetadata?.filletMergedSideWall === true
      || currentFaceName.endsWith('_TUBE_Outer');
    if (!isFilletSidewall) continue;

    const geometry = computeTriangleGeometryFromAuthoringState(vp, tv, triIndex);
    if (!(geometry.area > 0) || !(geometry.minHeight > 0) || geometry.minHeight > sliverHeightTolerance) {
      continue;
    }

    const externalNeighborContact = new Map();
    for (const [a, b] of [
      [geometry.vertexIndices[0], geometry.vertexIndices[1]],
      [geometry.vertexIndices[1], geometry.vertexIndices[2]],
      [geometry.vertexIndices[2], geometry.vertexIndices[0]],
    ]) {
      const triList = edgeToTriangles.get(edgeKey(a, b)) || [];
      for (const neighborTriIndex of triList) {
        if (neighborTriIndex === triIndex) continue;
        const neighborFaceID = ids[neighborTriIndex] >>> 0;
        if (neighborFaceID === currentFaceID) continue;
        externalNeighborContact.set(neighborFaceID, (externalNeighborContact.get(neighborFaceID) || 0) + 1);
      }
    }

    let best = null;
    for (const neighborFaceName of candidateFaceNames) {
      if (!neighborFaceName) continue;
      if (neighborFaceName === currentFaceName) continue;
      const neighborFaceID = faceToId.get(neighborFaceName);
      if (!Number.isFinite(neighborFaceID)) continue;

      const neighborMetadata = (typeof solid.getFaceMetadata === 'function')
        ? (solid.getFaceMetadata(neighborFaceName) || {})
        : {};
      if (neighborMetadata?.filletEndCap === true) continue;

      const neighborAnalysis = getFaceAnalysis(neighborFaceName);
      if (!neighborAnalysis) continue;
      const boundaryFit = measureTrianglePointsOnBoundarySegments(geometry.points, getBoundarySegments(neighborFaceName), {
        distanceTolerance: boundaryDistanceTolerance,
      });
      if (!boundaryFit || boundaryFit.pointCount < geometry.points.length) continue;

      let maxPlaneDistance = 0;
      let onNeighborPlane = true;
      for (const point of geometry.points) {
        const planeDistance = Math.abs(pointDistanceToFacePlane(point, neighborAnalysis));
        if (planeDistance > maxPlaneDistance) maxPlaneDistance = planeDistance;
        if (planeDistance > planeDistanceTolerance) {
          onNeighborPlane = false;
          break;
        }
      }
      if (!onNeighborPlane) continue;

      const neighborIsFilletManaged = neighborMetadata?.filletSideWall === true
        || neighborMetadata?.filletMergedSideWall === true
        || typeof neighborMetadata?.filletRoundFace === 'string'
        || neighborFaceName.endsWith('_TUBE_Outer');
      const featureOwnershipRank = (
        featureID
        && !neighborIsFilletManaged
        && !neighborFaceName.startsWith(`${featureID}_`)
        && String(neighborMetadata?.sourceFeatureId || '').trim() !== featureID
      ) ? 2 : (neighborIsFilletManaged ? 0 : 1);

      const candidate = {
        faceID: neighborFaceID,
        faceName: neighborFaceName,
        sharedEdges: externalNeighborContact.get(neighborFaceID) || 0,
        distinctBoundarySegments: boundaryFit.distinctSegmentCount,
        maxBoundaryDistance: boundaryFit.maxDistance,
        totalBoundaryDistance: boundaryFit.totalDistance,
        maxPlaneDistance,
        featureOwnershipRank,
        area: getFaceArea(neighborFaceName),
      };
      if (
        !best
        || candidate.featureOwnershipRank > best.featureOwnershipRank
        || (candidate.featureOwnershipRank === best.featureOwnershipRank && candidate.sharedEdges > best.sharedEdges)
        || (candidate.featureOwnershipRank === best.featureOwnershipRank
          && candidate.sharedEdges === best.sharedEdges
          && candidate.distinctBoundarySegments > best.distinctBoundarySegments)
        || (candidate.featureOwnershipRank === best.featureOwnershipRank
          && candidate.sharedEdges === best.sharedEdges
          && candidate.distinctBoundarySegments === best.distinctBoundarySegments
          && candidate.maxBoundaryDistance < best.maxBoundaryDistance)
        || (candidate.featureOwnershipRank === best.featureOwnershipRank
          && candidate.sharedEdges === best.sharedEdges
          && candidate.distinctBoundarySegments === best.distinctBoundarySegments
          && candidate.maxBoundaryDistance === best.maxBoundaryDistance
          && candidate.totalBoundaryDistance < best.totalBoundaryDistance)
        || (candidate.featureOwnershipRank === best.featureOwnershipRank
          && candidate.sharedEdges === best.sharedEdges
          && candidate.distinctBoundarySegments === best.distinctBoundarySegments
          && candidate.maxBoundaryDistance === best.maxBoundaryDistance
          && candidate.totalBoundaryDistance === best.totalBoundaryDistance
          && candidate.maxPlaneDistance < best.maxPlaneDistance)
        || (candidate.featureOwnershipRank === best.featureOwnershipRank
          && candidate.sharedEdges === best.sharedEdges
          && candidate.distinctBoundarySegments === best.distinctBoundarySegments
          && candidate.maxBoundaryDistance === best.maxBoundaryDistance
          && candidate.totalBoundaryDistance === best.totalBoundaryDistance
          && candidate.maxPlaneDistance === best.maxPlaneDistance
          && candidate.area > best.area)
      ) {
        best = candidate;
      }
    }

    if (!best?.faceName) continue;
    ids[triIndex] = best.faceID >>> 0;
    reassignedTriangles += 1;
    if (debug) {
        mutationDetails.push({
          triIndex,
          fromFace: currentFaceName,
          toFace: best.faceName,
          area: geometry.area,
          minHeight: geometry.minHeight,
          sharedEdges: best.sharedEdges,
          distinctBoundarySegments: best.distinctBoundarySegments,
          maxBoundaryDistance: best.maxBoundaryDistance,
          totalBoundaryDistance: best.totalBoundaryDistance,
          maxPlaneDistance: best.maxPlaneDistance,
        });
      }
  }

  if (reassignedTriangles <= 0) {
    return {
      reassignedTriangles: 0,
      sliverHeightTolerance,
      planeDistanceTolerance,
      boundaryDistanceTolerance,
    };
  }

  solid._triIDs = ids;
  solid._faceNameToID = faceToId;
  solid._idToFaceName = idToFace;
  pruneUnusedFaceLabelsFromTriangles(solid);
  solid._faceIndex = null;
  solid._dirty = true;
  try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
  solid._manifold = null;

  if (debug && mutationDetails.length > 0) {
    console.log('[Solid.fillet] Reassigned tiny fillet sliver triangles into planar neighbors.', {
      featureID,
      reassignedTriangles,
      sliverHeightTolerance,
      planeDistanceTolerance,
      boundaryDistanceTolerance,
      mutations: mutationDetails,
    });
  }

  return {
    reassignedTriangles,
    sliverHeightTolerance,
    planeDistanceTolerance,
    boundaryDistanceTolerance,
  };
}

export { reversePostBooleanFilletEndCapNudge as __testOnlyReversePostBooleanFilletEndCapNudge };
export { mergeCoplanarAdjacentFilletEndCaps as __testOnlyMergeCoplanarAdjacentFilletEndCaps };
export { reassignTinyFilletSidewallSliverTriangles as __testOnlyReassignTinyFilletSidewallSliverTriangles };
export { collapseFilletSideWallFaces as __testOnlyCollapseFilletSideWallFaces };

/**
 * Apply fillets to this Solid and return a new Solid with the result.
 * Accepts explicit `edges` objects.
 *
 * @param {Object} opts
 * @param {number} opts.radius Required fillet radius (> 0)
 * @param {any[]} [opts.edges] Optional pre-resolved Edge objects (must belong to this Solid)
 * @param {'AUTO'|'INSET'|'OUTSET'|string} [opts.direction='AUTO'] Choose boolean side per edge automatically (AUTO) or force INSET/OUTSET
 * @param {number} [opts.inflate=0.1] Inflation for cutting tube
 * @param {number} [opts.nudgeFaceDistance=0.0001] pushFace amount applied to wedge end caps before boolean
 * @param {number} [opts.resolution=32] Tube resolution (segments around circumference)
 * @param {number} [opts.cleanupTinyFaceIslandsArea=0.01] area threshold for reassigning tiny enclosed face-label islands (<= 0 disables)
 * @param {boolean} [opts.mergeCoplanarEndCaps=true] merge coplanar fillet end caps into adjacent host faces
 * @param {boolean} [opts.renameFaces=true] allow fillet cleanup to rename/relabel generated faces
 * @param {boolean} [opts.reassignSliverTriangles=true] reassign tiny fillet sidewall sliver triangles into planar neighbors
 * @param {boolean} [opts.collapseFilletSideWalls=true] collapse deterministic fillet side-wall faces so adjacent faces meet directly
 * @param {boolean} [opts.debug=false] Enable debug visuals in fillet builder
 * @param {boolean} [opts.consoleLogProcess=false] Emit fillet process console logs without requiring debug visuals
 * @param {number} [opts.debugSolidsLevel=0] -1=none, 0=tube+wedge, 1=edge fillet boolean result, 2=all intermediate solids
 * @param {boolean} [opts.debugShowCombinedBeforeTarget=false] Emit the combined fillet solid before target boolean
 * @param {string} [opts.featureID='FILLET'] For naming of intermediates and result
 * @returns {import('../BetterSolid.js').Solid}
 */
export async function fillet(opts = {}) {
  requireNativeFilletCombinedBuilder();
  const radius = Number(opts.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Solid.fillet: radius must be > 0, got ${opts.radius}`);
  }
  const directionMode = normalizeFilletDirectionMode(opts.direction);
  const autoDirection = directionMode === 'AUTO';
  const inflate = Number.isFinite(opts.inflate) ? Number(opts.inflate) : 0.1;
  const nudgeFaceDistanceRaw = Number(opts.nudgeFaceDistance);
  const nudgeFaceDistance = Number.isFinite(nudgeFaceDistanceRaw) ? nudgeFaceDistanceRaw : 0.0001;
  const debug = !!opts.debug;
  const logProcess = !!opts.consoleLogProcess || debug;
  const nativeProfile = opts.profile === true || logProcess;
  const debugSolidsLevelRaw = Number(opts.debugSolidsLevel);
  const debugSolidsLevel = Number.isFinite(debugSolidsLevelRaw)
    ? Math.max(-1, Math.min(2, Math.floor(debugSolidsLevelRaw)))
    : 0;
  const debugShowCombinedBeforeTarget = !!opts.debugShowCombinedBeforeTarget;
  const resolutionRaw = Number(opts.resolution);
  const resolution = (Number.isFinite(resolutionRaw) && resolutionRaw > 0)
    ? Math.max(8, Math.floor(resolutionRaw))
    : 32;
  const cleanupTinyFaceIslandsAreaRaw = Number(opts.cleanupTinyFaceIslandsArea);
  const cleanupTinyFaceIslandsArea = Number.isFinite(cleanupTinyFaceIslandsAreaRaw)
    ? cleanupTinyFaceIslandsAreaRaw
    : 0.01;
  const renameFaces = opts.renameFaces !== false;
  const mergeCoplanarEndCaps = opts.mergeCoplanarEndCaps !== false && renameFaces;
  const reverseEndCapNudge = mergeCoplanarEndCaps;
  const collapseFilletSideWalls = opts.collapseFilletSideWalls !== false;
  const reassignSliverTriangles = opts.reassignSliverTriangles !== false && !collapseFilletSideWalls;
  const featureID = opts.featureID || 'FILLET';

  // Resolve pre-selected edge objects.
  const unique = resolveEdgesFromInputs(this, { edges: opts.edges });
  if (unique.length === 0) {
    console.warn('[Solid.fillet] No edges resolved on target solid; returning clone.', { featureID, solid: this?.name });
    // Nothing to do - return an unchanged clone so caller can replace scene node safely
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }
  const baseSnapshot = buildSolidAuthoringStateSnapshot(this);
  const debugAdded = [];
  const buildFallbackResult = () => {
    const fallback = this.clone();
    try { fallback.name = this.name; } catch { }
    if (debugAdded.length > 0) {
      try { fallback.__debugAddedSolids = debugAdded; } catch { }
    }
    return fallback;
  };
  const edgePayload = [];
  for (let idx = 0; idx < unique.length; idx++) {
    const edge = unique[idx];
    const edgeRawName = (typeof edge?.name === 'string' && edge.name.trim().length > 0)
      ? edge.name.trim()
      : `EDGE_${idx}`;
    const edgeToken = sanitizeFaceNameToken(edgeRawName, `EDGE_${idx}`);
    const edgeTokenShort = (edgeToken.length > 48) ? edgeToken.slice(0, 48) : edgeToken;
    const edgeHash = stableStringHash32(edgeRawName).toString(16).slice(-8).padStart(8, '0');
    const name = `${featureID}_FILLET_${edgeTokenShort}_${edgeHash}_${idx}`;
    const { faceAName, faceBName } = getEdgeFaceNames(edge);
    const edgePolyline = getEdgePolylineLocal(edge);
    if (!Array.isArray(edgePolyline) || edgePolyline.length < 2) {
      console.warn('[Solid.fillet] Skipping edge with missing polyline.', { featureID, edge: edge?.name });
      continue;
    }
    const payload = {
      name,
      edgeReference: edgeRawName,
      polyline: edgePolyline,
      closedLoop: !!(edge?.closedLoop || edge?.userData?.closedLoop),
    };
    if (faceAName) payload.faceAName = faceAName;
    if (faceBName) payload.faceBName = faceBName;
    if (Array.isArray(edge?.userData?.segmentFacePairs) && edge.userData.segmentFacePairs.length > 0) {
      payload.segmentFacePairs = edge.userData.segmentFacePairs;
    }
    edgePayload.push(payload);
  }
  if (edgePayload.length === 0) return buildFallbackResult();

  let nativeResult = null;
  try {
    nativeResult = manifold.buildFilletAuthoringState({
      snapshot: baseSnapshot,
      edges: edgePayload,
      radius,
      directionMode,
      inflate,
      nudgeFaceDistance,
      resolution,
      featureID,
      name: this?.name || `${featureID}_FINAL_FILLET`,
      cleanupTinyFaceIslandsArea,
      debug: !!debug,
      debugSolidsLevel,
      debugShowCombinedBeforeTarget,
      preserveFilletSideWallFaces: collapseFilletSideWalls,
      enableFaceRenaming: renameFaces,
      profile: nativeProfile,
    });
  } catch (err) {
    console.error('[Solid.fillet] Native fillet build failed; returning clone.', {
      featureID,
      error: err?.message || err,
    });
    return buildFallbackResult();
  }

  if (logProcess && autoDirection && nativeResult?.directionDecision) {
    console.log('[Solid.fillet] AUTO direction classification complete.', {
      featureID,
      insetEdges: nativeResult.directionDecision.insetEdges,
      outsetEdges: nativeResult.directionDecision.outsetEdges,
      fallbackEdges: nativeResult.directionDecision.fallbackEdges,
      ambiguousEdges: nativeResult.directionDecision.ambiguousEdges,
    });
  }

  const SolidClass = this?.constructor?.BaseSolid || this?.constructor || null;
  const result = solidFromSnapshot(nativeResult?.finalSnapshot, SolidClass, this?.name || `${featureID}_FINAL_FILLET`);
  if (!result) {
    console.error('[Solid.fillet] Native fillet build returned no final snapshot.', { featureID });
    return buildFallbackResult();
  }

  const debugSnapshots = Array.isArray(nativeResult?.debugSnapshots) ? nativeResult.debugSnapshots : [];
  if (debug && debugSnapshots.length > 0) {
    for (const entry of debugSnapshots) {
      const debugSolid = solidFromSnapshot(entry?.snapshot, SolidClass, String(entry?.name || 'FILLET_DEBUG'));
      if (debugSolid) debugAdded.push(debugSolid);
    }
  }
  if (debugAdded.length > 0) {
    try { result.__debugAddedSolids = debugAdded; } catch { }
  }
  if (nativeResult?.directionDecision && typeof nativeResult.directionDecision === 'object') {
    try { result.__filletDirectionDecision = nativeResult.directionDecision; } catch { }
  }
  try {
    result.__filletCornerBridgeCount = Math.max(0, Number(nativeResult?.entryCount || 0) - edgePayload.length);
  } catch { }
  result.__filletEndCapReverseNudgeEnabled = reverseEndCapNudge;
  if (reverseEndCapNudge) {
    try {
      const reversedEndCapNudgeSummary = reversePostBooleanFilletEndCapNudge(result, nudgeFaceDistance, {
        featureID,
        debug: logProcess,
      });
      result.__filletEndCapReverseNudgeCount = Math.max(0, Number(reversedEndCapNudgeSummary?.reversedFaces || 0));
    } catch (error) {
      console.warn('[Solid.fillet] Failed to reverse post-boolean fillet end-cap nudge.', {
        featureID,
        error: error?.message || error,
      });
    }
  } else {
    result.__filletEndCapReverseNudgeCount = 0;
  }
  result.__filletEndCapMergeEnabled = mergeCoplanarEndCaps;
  if (mergeCoplanarEndCaps) {
    try {
      const endCapMergeSummary = mergeCoplanarAdjacentFilletEndCaps(result, {
        featureID,
        debug: logProcess,
        consoleLogProcess: logProcess,
        nudgeFaceDistance,
      });
      result.__filletEndCapMergeCount = Math.max(0, Number(endCapMergeSummary?.mergedEndCaps || 0));
    } catch (error) {
      console.warn('[Solid.fillet] Failed to merge coplanar adjacent fillet end caps.', {
        featureID,
        error: error?.message || error,
      });
    }
  } else {
    result.__filletEndCapMergeCount = 0;
  }
  result.__filletSliverTriangleReassignEnabled = reassignSliverTriangles;
  if (reassignSliverTriangles) {
    try {
      const sliverTriangleSummary = reassignTinyFilletSidewallSliverTriangles(result, {
        featureID,
        debug: logProcess,
      });
      result.__filletSliverTriangleReassignCount = Math.max(0, Number(sliverTriangleSummary?.reassignedTriangles || 0));
    } catch (error) {
      console.warn('[Solid.fillet] Failed to reassign tiny fillet sliver triangles.', {
        featureID,
        error: error?.message || error,
      });
    }
  } else {
    result.__filletSliverTriangleReassignCount = 0;
  }
  result.__filletSideWallCollapseEnabled = collapseFilletSideWalls;
  if (collapseFilletSideWalls) {
    try {
      const sideWallCollapseSummary = collapseFilletSideWallFaces(result, {
        featureID,
        debug: logProcess,
      });
      result.__filletSideWallCollapseSummary = sideWallCollapseSummary;
      result.__filletSideWallCollapseCount = Math.max(0, Number(sideWallCollapseSummary?.collapsedEdges || 0));
      result.__filletSideWallCollapseRemovedTriangles = Math.max(0, Number(sideWallCollapseSummary?.removedSideWallTriangles || 0));
      result.__filletSideWallCollapseSimplifySucceeded = false;
      result.__filletSideWallCollapseSimplifyError = null;
      if (result.__filletSideWallCollapseCount > 0 && typeof result.simplify === 'function') {
        try {
          result.simplify(FILLET_SIDEWALL_COLLAPSE_SIMPLIFY_TOLERANCE, true);
          result.__filletSideWallCollapseSimplifySucceeded = true;
        } catch (simplifyError) {
          result.__filletSideWallCollapseSimplifyError = simplifyError?.message || String(simplifyError);
          if (logProcess) {
            console.warn('[Solid.fillet] Failed to simplify after fillet side-wall vertex collapse.', {
              featureID,
              error: result.__filletSideWallCollapseSimplifyError,
            });
          }
        }
      }
    } catch (error) {
      console.warn('[Solid.fillet] Failed to collapse fillet side-wall faces.', {
        featureID,
        error: error?.message || error,
      });
      result.__filletSideWallCollapseCount = 0;
      result.__filletSideWallCollapseRemovedTriangles = 0;
      result.__filletSideWallCollapseSimplifySucceeded = false;
      result.__filletSideWallCollapseSimplifyError = error?.message || String(error);
    }
  } else {
    result.__filletSideWallCollapseCount = 0;
    result.__filletSideWallCollapseRemovedTriangles = 0;
    result.__filletSideWallCollapseSimplifySucceeded = false;
    result.__filletSideWallCollapseSimplifyError = null;
  }
  const runPostFilletTinyFaceIslandCleanup = collapseFilletSideWalls && cleanupTinyFaceIslandsArea > 0;
  result.__filletTinyFaceIslandCleanupEnabled = runPostFilletTinyFaceIslandCleanup;
  result.__filletTinyFaceIslandCleanupCount = 0;
  if (runPostFilletTinyFaceIslandCleanup && typeof result.cleanupTinyFaceIslands === 'function') {
    try {
      result.__filletTinyFaceIslandCleanupCount = Math.max(
        0,
        Number(result.cleanupTinyFaceIslands(cleanupTinyFaceIslandsArea) || 0),
      );
    } catch (error) {
      console.warn('[Solid.fillet] Failed to clean up tiny face islands after fillet post-processing.', {
        featureID,
        error: error?.message || error,
      });
    }
  }
  result.__filletSingleNeighborIslandCleanupCount = 0;
  result.__filletSingleNeighborIslandCleanupComponentCount = 0;
  try {
    const singleNeighborIslandSummary = cleanupSingleNeighborFilletFaceIslands(result, {
      featureID,
      debug: logProcess,
    });
    result.__filletSingleNeighborIslandCleanupCount = Math.max(
      0,
      Number(singleNeighborIslandSummary?.reassignedTriangles || 0),
    );
    result.__filletSingleNeighborIslandCleanupComponentCount = Math.max(
      0,
      Number(singleNeighborIslandSummary?.reassignedComponents || 0),
    );
  } catch (error) {
    console.warn('[Solid.fillet] Failed to clean up single-neighbor fillet face islands.', {
      featureID,
      error: error?.message || error,
    });
  }
  return result;
}

import { Solid } from './BetterSolid.js';
import { Manifold, THREE } from './SolidShared.js';

const EPS = 1e-9;
const TRI_EPS = 1e-12;

function sanitizeToken(value, fallback = 'FACE') {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[:[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    || fallback;
}

function edgeKey(a, b) {
  const i = a < b ? a : b;
  const j = a < b ? b : a;
  return `${i}|${j}`;
}

function invalidateCppSolidCoreCache(solid) {
  if (solid && typeof solid === 'object') {
    solid._cppSolidCoreSyncStamp = null;
  }
}

function pointKey(point, epsilon) {
  const inv = epsilon > 0 ? (1 / epsilon) : 1e6;
  return [
    Math.round(point.x * inv),
    Math.round(point.y * inv),
    Math.round(point.z * inv),
  ].join(',');
}

function triangleNormal(a, b, c) {
  return new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
}

function triangleArea(a, b, c) {
  return triangleNormal(a, b, c).length() * 0.5;
}

function getFaceLabel(face) {
  const raw = face?.userData?.faceName ?? face?.faceName ?? face?.name ?? null;
  if (raw == null) return null;
  const label = String(raw).trim();
  return label || null;
}

function getFaceLabelList(value) {
  const rawList = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const labels = [];
  const seen = new Set();
  for (const entry of rawList) {
    const raw = typeof entry === 'string'
      ? entry
      : (entry?.userData?.faceName ?? entry?.faceName ?? entry?.name ?? null);
    const label = String(raw || '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function getAdjacentNormalFaceFilter(options, selectedFaceName) {
  const labels = getFaceLabelList(
    options.adjacentNormalFaceNames
      ?? options.smoothAdjacentNormalFaceNames
      ?? options.selectedFaceNames,
  );
  const selected = String(selectedFaceName || '').trim();
  const neighbors = labels.filter((label) => label && label !== selected);
  return neighbors.length ? new Set(neighbors) : null;
}

function getFaceOwnerKey(face) {
  const owner = face?.parentSolid || (String(face?.parent?.type || '').toUpperCase() === 'SOLID' ? face.parent : null);
  return String(owner?.uuid || owner?.id || owner?.name || 'NO_OWNER');
}

function unorderedPointPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function copyTriangleMetadata(source, target) {
  if (!source || !target) return target;
  if (source.sourceFaceName != null) target.sourceFaceName = source.sourceFaceName;
  return target;
}

export function groupConnectedFacesBySharedEdges(faces, options = {}) {
  const faceList = Array.isArray(faces)
    ? faces.filter((face) => face?.geometry)
    : [];
  if (faceList.length <= 1) return faceList.length ? [faceList] : [];

  const tmp = new THREE.Vector3();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const face of faceList) {
    try { face.updateMatrixWorld?.(true); } catch { /* ignore */ }
    const position = face.geometry?.getAttribute?.('position');
    if (!position || position.itemSize !== 3) continue;
    for (let i = 0; i < position.count; i++) {
      tmp.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(face.matrixWorld);
      if (tmp.x < minX) minX = tmp.x;
      if (tmp.y < minY) minY = tmp.y;
      if (tmp.z < minZ) minZ = tmp.z;
      if (tmp.x > maxX) maxX = tmp.x;
      if (tmp.y > maxY) maxY = tmp.y;
      if (tmp.z > maxZ) maxZ = tmp.z;
    }
  }
  const scale = Number.isFinite(minX)
    ? Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ))
    : 1;
  const weldTolerance = Math.max(
    Number(options.weldTolerance) || 0,
    Math.max(1e-6, scale * 1e-7),
  );
  const minSharedNormalDot = Number.isFinite(Number(options.minSharedNormalDot))
    ? Math.max(-1, Math.min(1, Number(options.minSharedNormalDot)))
    : -1;
  const minSharedEdgeNormalDot = Number.isFinite(Number(options.minSharedEdgeNormalDot))
    ? Math.max(-1, Math.min(1, Number(options.minSharedEdgeNormalDot)))
    : null;
  const minPlanarRatio = Number.isFinite(Number(options.minPlanarRatio))
    ? Math.max(0, Math.min(1, Number(options.minPlanarRatio)))
    : 0;
  const computeFacePlanarRatio = (face, averageNormal) => {
    if (!(minPlanarRatio > 0)) return 1;
    const position = face?.geometry?.getAttribute?.('position');
    const index = face?.geometry?.getIndex?.() || null;
    if (!position || position.itemSize !== 3 || position.count < 3 || !averageNormal || averageNormal.lengthSq() <= TRI_EPS) return 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let weightedDot = 0;
    let totalAreaTwice = 0;
    const triCount = index ? ((index.count / 3) | 0) : ((position.count / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const i0 = index ? (index.getX((triIndex * 3) + 0) >>> 0) : ((triIndex * 3) + 0);
      const i1 = index ? (index.getX((triIndex * 3) + 1) >>> 0) : ((triIndex * 3) + 1);
      const i2 = index ? (index.getX((triIndex * 3) + 2) >>> 0) : ((triIndex * 3) + 2);
      a.set(position.getX(i0), position.getY(i0), position.getZ(i0)).applyMatrix4(face.matrixWorld);
      b.set(position.getX(i1), position.getY(i1), position.getZ(i1)).applyMatrix4(face.matrixWorld);
      c.set(position.getX(i2), position.getY(i2), position.getZ(i2)).applyMatrix4(face.matrixWorld);
      const normal = triangleNormal(a, b, c);
      const areaTwice = normal.length();
      if (!(areaTwice > TRI_EPS)) continue;
      weightedDot += Math.abs(normal.multiplyScalar(1 / areaTwice).dot(averageNormal)) * areaTwice;
      totalAreaTwice += areaTwice;
    }
    return totalAreaTwice > TRI_EPS ? (weightedDot / totalAreaTwice) : 0;
  };
  const faceNormals = faceList.map((face) => {
    try {
      const normal = typeof face?.getAverageNormal === 'function'
        ? face.getAverageNormal()
        : null;
      if (normal && normal.lengthSq?.() > TRI_EPS) return normal.clone().normalize();
    } catch { /* ignore */ }
    return null;
  });
  const facePlanarRatios = faceList.map((face, index) => computeFacePlanarRatio(face, faceNormals[index]));
  const edgeToFaces = new Map();

  for (let faceIndex = 0; faceIndex < faceList.length; faceIndex++) {
    const face = faceList[faceIndex];
    const position = face.geometry?.getAttribute?.('position');
    const index = face.geometry?.getIndex?.() || null;
    if (!position || position.itemSize !== 3 || position.count < 3) continue;

    const rawPoints = [];
    for (let i = 0; i < position.count; i++) {
      rawPoints.push(
        new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
          .applyMatrix4(face.matrixWorld),
      );
    }
    const rawToCanonicalKey = new Array(rawPoints.length);
    for (let i = 0; i < rawPoints.length; i++) {
      const key = pointKey(rawPoints[i], weldTolerance);
      rawToCanonicalKey[i] = key;
    }

    const edgeCounts = new Map();
    const edgeNormalSums = new Map();
    const triCount = index ? ((index.count / 3) | 0) : ((position.count / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const i0 = index ? (index.getX((triIndex * 3) + 0) >>> 0) : ((triIndex * 3) + 0);
      const i1 = index ? (index.getX((triIndex * 3) + 1) >>> 0) : ((triIndex * 3) + 1);
      const i2 = index ? (index.getX((triIndex * 3) + 2) >>> 0) : ((triIndex * 3) + 2);
      const normal = triangleNormal(rawPoints[i0], rawPoints[i1], rawPoints[i2]);
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const aKey = rawToCanonicalKey[a];
        const bKey = rawToCanonicalKey[b];
        if (!aKey || !bKey || aKey === bKey) continue;
        const key = unorderedPointPairKey(aKey, bKey);
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        let normalSum = edgeNormalSums.get(key);
        if (!normalSum) {
          normalSum = new THREE.Vector3();
          edgeNormalSums.set(key, normalSum);
        }
        normalSum.add(normal);
      }
    }

    const ownerKey = getFaceOwnerKey(face);
    for (const [edge, count] of edgeCounts.entries()) {
      if (count !== 1) continue;
      const key = `${ownerKey}::${edge}`;
      let list = edgeToFaces.get(key);
      if (!list) {
        list = [];
        edgeToFaces.set(key, list);
      }
      const normal = edgeNormalSums.get(edge) || null;
      list.push({
        faceIndex,
        normal: normal && normal.lengthSq() > TRI_EPS ? normal.clone().normalize() : null,
      });
    }
  }

  const parent = new Array(faceList.length).fill(null).map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (aEntry, bEntry) => {
    const a = typeof aEntry === 'number' ? aEntry : (aEntry?.faceIndex >>> 0);
    const b = typeof bEntry === 'number' ? bEntry : (bEntry?.faceIndex >>> 0);
    if (a === b || a >= faceList.length || b >= faceList.length) return;
    if (minSharedEdgeNormalDot != null) {
      const na = aEntry?.normal || faceNormals[a];
      const nb = bEntry?.normal || faceNormals[b];
      if (!na || !nb || Math.abs(na.dot(nb)) < minSharedEdgeNormalDot) return;
    } else {
      if (minPlanarRatio > 0 && (facePlanarRatios[a] < minPlanarRatio || facePlanarRatios[b] < minPlanarRatio)) return;
      if (minSharedNormalDot > -1) {
        const na = faceNormals[a];
        const nb = faceNormals[b];
        if (!na || !nb || Math.abs(na.dot(nb)) < minSharedNormalDot) return;
      }
    }
    if (minSharedNormalDot > -1 && minSharedEdgeNormalDot != null) {
      const na = faceNormals[a];
      const nb = faceNormals[b];
      if (!na || !nb || Math.abs(na.dot(nb)) < minSharedNormalDot) return;
    }
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const list of edgeToFaces.values()) {
    if (!Array.isArray(list) || list.length < 2) continue;
    for (let i = 1; i < list.length; i++) union(list[0], list[i]);
  }

  const groupByRoot = new Map();
  for (let index = 0; index < faceList.length; index++) {
    const root = find(index);
    let group = groupByRoot.get(root);
    if (!group) {
      group = [];
      groupByRoot.set(root, group);
    }
    group.push(faceList[index]);
  }
  return Array.from(groupByRoot.values());
}

function pointToSegmentDistanceSq(point, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  if (!(lengthSq > TRI_EPS)) return point.distanceToSquared(a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(point, a).dot(ab) / lengthSq));
  const closest = a.clone().add(ab.multiplyScalar(t));
  return point.distanceToSquared(closest);
}

function pointToPolylineDistanceSq(point, polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const distSq = pointToSegmentDistanceSq(point, polyline[i], polyline[i + 1]);
    if (distSq < best) best = distSq;
  }
  return best;
}

function pointToTriangleDistanceSq(point, a, b, c) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(point, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return point.distanceToSquared(a);

  const bp = new THREE.Vector3().subVectors(point, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return point.distanceToSquared(b);

  const vc = (d1 * d4) - (d3 * d2);
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return point.distanceToSquared(a.clone().add(ab.multiplyScalar(v)));
  }

  const cp = new THREE.Vector3().subVectors(point, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return point.distanceToSquared(c);

  const vb = (d5 * d2) - (d1 * d6);
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return point.distanceToSquared(a.clone().add(ac.multiplyScalar(w)));
  }

  const va = (d3 * d6) - (d5 * d4);
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const bc = new THREE.Vector3().subVectors(c, b);
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return point.distanceToSquared(b.clone().add(bc.multiplyScalar(w)));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return point.distanceToSquared(a.clone().add(ab.multiplyScalar(v)).add(ac.multiplyScalar(w)));
}

function getSourceEdgePolylines(face) {
  const edges = Array.isArray(face?.edges) ? face.edges : [];
  if (!edges.length) return [];
  const solid = face?.parentSolid || (String(face?.parent?.type || '').toUpperCase() === 'SOLID' ? face.parent : null);
  try { solid?.updateMatrixWorld?.(true); } catch { /* ignore */ }
  const matrix = solid?.matrixWorld || new THREE.Matrix4();
  const result = [];

  for (let index = 0; index < edges.length; index++) {
    const sourceEdge = edges[index];
    const rawPolyline = Array.isArray(sourceEdge?.userData?.polylineLocal)
      ? sourceEdge.userData.polylineLocal
      : [];
    const polyline = rawPolyline
      .map((point) => {
        if (Array.isArray(point)) {
          return new THREE.Vector3(
            Number(point[0]) || 0,
            Number(point[1]) || 0,
            Number(point[2]) || 0,
          ).applyMatrix4(matrix);
        }
        if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number.isFinite(Number(point.z))) {
          return new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z)).applyMatrix4(matrix);
        }
        return null;
      })
      .filter(Boolean);
    if (polyline.length < 2) continue;
    result.push({
      name: String(sourceEdge?.name || sourceEdge?.userData?.edgeName || `EDGE_${index}`).trim() || `EDGE_${index}`,
      key: String(sourceEdge?.uuid || sourceEdge?.name || `EDGE_${index}`),
      polyline,
    });
  }

  return result;
}

function assignSourceEdgesToBoundaryLoops(face, loops, vertices, scale, weldTolerance) {
  const sourceEdges = getSourceEdgePolylines(face);
  if (!sourceEdges.length || !Array.isArray(loops) || !Array.isArray(vertices)) return;
  const tolerance = Math.max(Number(weldTolerance) * 32, Number(scale) * 1e-5, 1e-5);
  const toleranceSq = tolerance * tolerance;

  for (const loop of loops) {
    for (const edge of loop?.edges || []) {
      const start = vertices[edge.start];
      const end = vertices[edge.end];
      if (!start || !end) continue;
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      let best = null;
      let bestScore = Infinity;
      for (const sourceEdge of sourceEdges) {
        const score = Math.max(
          pointToPolylineDistanceSq(start, sourceEdge.polyline),
          pointToPolylineDistanceSq(midpoint, sourceEdge.polyline),
          pointToPolylineDistanceSq(end, sourceEdge.polyline),
        );
        if (score < bestScore) {
          bestScore = score;
          best = sourceEdge;
        }
      }
      if (best && bestScore <= toleranceSq) {
        edge.sourceEdgeName = best.name;
        edge.sourceEdgeKey = best.key;
      }
    }
  }
}

function addSmoothAdjacentBoundaryNormals(face, surface, options = {}) {
  if (options.disableAdjacentBoundaryNormals === true) {
    return {
      candidateEdges: 0,
      acceptedEdges: 0,
      contributionCount: 0,
      contributedVertexCount: 0,
      dotThreshold: null,
      weightScale: 0,
      faceFilterCount: 0,
      faceFilterNames: [],
    };
  }
  const solid = face?.parentSolid || (String(face?.parent?.type || '').toUpperCase() === 'SOLID' ? face.parent : null);
  const selectedFaceName = getFaceLabel(face);
  const adjacentFaceFilter = getAdjacentNormalFaceFilter(options, selectedFaceName);
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const vertProperties = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const triCount = (triVerts.length / 3) | 0;
  const smoothDotThreshold = Math.max(
    -1,
    Math.min(
      1,
      Number.isFinite(Number(options.adjacentNormalDotThreshold))
        ? Number(options.adjacentNormalDotThreshold)
        : (Number.isFinite(Number(options.smoothAdjacentNormalDotThreshold))
          ? Number(options.smoothAdjacentNormalDotThreshold)
          : 0.85),
    ),
  );
  const adjacentWeightScale = Math.max(
    0,
    Number.isFinite(Number(options.adjacentNormalWeightScale))
      ? Number(options.adjacentNormalWeightScale)
      : 1,
  );
  const makeStats = (stats = {}) => ({
    candidateEdges: Number(stats.candidateEdges || 0),
    acceptedEdges: Number(stats.acceptedEdges || 0),
    contributionCount: Number(stats.contributionCount || 0),
    contributedVertexCount: Number(stats.contributedVertexCount || 0),
    dotThreshold: smoothDotThreshold,
    weightScale: adjacentWeightScale,
    faceFilterCount: adjacentFaceFilter?.size || 0,
    faceFilterNames: adjacentFaceFilter ? Array.from(adjacentFaceFilter) : [],
  });
  if (!solid || !selectedFaceName) {
    return makeStats();
  }
  const boundaryEdges = Array.isArray(surface?.boundaryDirectedEdges) ? surface.boundaryDirectedEdges : [];
  const vertices = Array.isArray(surface?.vertices) ? surface.vertices : [];
  const vertexNormals = Array.isArray(surface?.vertexNormals) ? surface.vertexNormals : [];
  if (!boundaryEdges.length || !vertices.length || !vertexNormals.length) {
    return makeStats();
  }

  const weldTolerance = Math.max(Number(surface?.weldTolerance) || 0, 1e-8);
  if (adjacentWeightScale <= 0) {
    return makeStats();
  }

  const boundaryVertexByPointKey = new Map();
  const boundaryEdgeByPointPair = new Map();
  for (const edge of boundaryEdges) {
    const start = edge?.start >>> 0;
    const end = edge?.end >>> 0;
    const a = vertices[start];
    const b = vertices[end];
    if (!a || !b) continue;
    const aKey = pointKey(a, weldTolerance);
    const bKey = pointKey(b, weldTolerance);
    boundaryVertexByPointKey.set(aKey, start);
    boundaryVertexByPointKey.set(bKey, end);
    boundaryEdgeByPointPair.set(unorderedPointPairKey(aKey, bKey), true);
  }
  if (!boundaryEdgeByPointPair.size) {
    return makeStats();
  }

  const idToFaceName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
  const parentMatrix = new THREE.Matrix4();
  try {
    solid.updateMatrixWorld?.(true);
    parentMatrix.copy(solid.matrixWorld || new THREE.Matrix4());
  } catch {
    parentMatrix.identity();
  }

  const parentPointCache = new Map();
  const parentKeyCache = new Map();
  const contributedVertices = new Set();
  const useEqualBoundaryNormals = options.equalAdjacentBoundaryNormals === true
    || String(options.sharedBoundaryNormalMode || '').toLowerCase() === 'equal';
  const equalBoundaryNormalBuckets = useEqualBoundaryNormals ? new Map() : null;
  let candidateEdges = 0;
  let acceptedEdges = 0;
  let contributionCount = 0;

  const normalKey = (normal) => [
    Math.round(normal.x * 1e6),
    Math.round(normal.y * 1e6),
    Math.round(normal.z * 1e6),
  ].join(',');
  const getEqualBoundaryNormalBucket = (selectedIndex) => {
    if (!equalBoundaryNormalBuckets) return null;
    let bucket = equalBoundaryNormalBuckets.get(selectedIndex);
    if (bucket) return bucket;
    const base = vertexNormals[selectedIndex]?.clone?.() || null;
    if (!base || base.lengthSq() <= TRI_EPS) return null;
    base.normalize();
    bucket = {
      sum: base.clone(),
      keys: new Set([normalKey(base)]),
    };
    equalBoundaryNormalBuckets.set(selectedIndex, bucket);
    return bucket;
  };
  const finalizeStats = (stats = {}) => {
    if (equalBoundaryNormalBuckets?.size) {
      for (const [selectedIndex, bucket] of equalBoundaryNormalBuckets.entries()) {
        if (!bucket?.sum || bucket.sum.lengthSq() <= TRI_EPS) continue;
        vertexNormals[selectedIndex].copy(bucket.sum);
      }
    }
    return makeStats(stats);
  };

  const addContributionForPointKey = (key, adjacentUnit, normalLength) => {
    const selectedIndex = boundaryVertexByPointKey.get(key);
    if (selectedIndex == null) return false;
    const current = vertexNormals[selectedIndex];
    if (!current || current.lengthSq() <= TRI_EPS) return false;
    if (equalBoundaryNormalBuckets) {
      const bucket = getEqualBoundaryNormalBucket(selectedIndex);
      if (!bucket) return false;
      const keyForNormal = normalKey(adjacentUnit);
      if (bucket.keys.has(keyForNormal)) return false;
      bucket.keys.add(keyForNormal);
      bucket.sum.add(adjacentUnit);
      contributedVertices.add(selectedIndex);
      contributionCount += 1;
      return true;
    }
    const baseWeight = Math.max(current.length(), EPS);
    const weight = Math.min(normalLength, baseWeight) * adjacentWeightScale;
    if (!(weight > EPS)) return false;
    current.add(adjacentUnit.clone().multiplyScalar(weight));
    contributedVertices.add(selectedIndex);
    contributionCount += 1;
    return true;
  };

  const processAdjacentTriangle = (points) => {
    if (!Array.isArray(points) || points.length !== 3) return;
    const keys = points.map((point) => pointKey(point, weldTolerance));
    let touchesBoundaryEdge = false;
    for (const [u, v] of [[0, 1], [1, 2], [2, 0]]) {
      if (!boundaryEdgeByPointPair.has(unorderedPointPairKey(keys[u], keys[v]))) continue;
      touchesBoundaryEdge = true;
      candidateEdges += 1;
      break;
    }
    if (!touchesBoundaryEdge) return;

    const normal = triangleNormal(points[0], points[1], points[2]);
    const normalLength = normal.length();
    if (!(normalLength > TRI_EPS)) return;
    const unit = normal.multiplyScalar(1 / normalLength);

    let acceptedThisTriangle = false;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const selectedIndex = boundaryVertexByPointKey.get(keys[vertexIndex]);
      if (selectedIndex == null) continue;
      const base = vertexNormals[selectedIndex]?.clone?.() || null;
      if (!base || base.lengthSq() <= TRI_EPS) continue;
      base.normalize();
      const dot = unit.dot(base);
      let aligned = null;
      if (dot >= smoothDotThreshold) aligned = unit;
      else if (-dot >= smoothDotThreshold) aligned = unit.clone().multiplyScalar(-1);
      if (!aligned) continue;
      if (addContributionForPointKey(keys[vertexIndex], aligned, normalLength)) acceptedThisTriangle = true;
    }
    if (acceptedThisTriangle) acceptedEdges += 1;
  };

  try {
    const queriedFaces = typeof solid.getFaces === 'function' ? (solid.getFaces(false) || []) : [];
    if (Array.isArray(queriedFaces) && queriedFaces.length) {
      for (const entry of queriedFaces) {
        const faceName = String(entry?.faceName || '').trim();
        if (!faceName || faceName === selectedFaceName) continue;
        if (adjacentFaceFilter && !adjacentFaceFilter.has(faceName)) continue;
        for (const tri of entry?.triangles || []) {
          const p1 = Array.isArray(tri?.p1) ? tri.p1 : null;
          const p2 = Array.isArray(tri?.p2) ? tri.p2 : null;
          const p3 = Array.isArray(tri?.p3) ? tri.p3 : null;
          if (!p1 || !p2 || !p3) continue;
          processAdjacentTriangle([
            new THREE.Vector3(p1[0] || 0, p1[1] || 0, p1[2] || 0).applyMatrix4(parentMatrix),
            new THREE.Vector3(p2[0] || 0, p2[1] || 0, p2[2] || 0).applyMatrix4(parentMatrix),
            new THREE.Vector3(p3[0] || 0, p3[1] || 0, p3[2] || 0).applyMatrix4(parentMatrix),
          ]);
        }
      }
      if (candidateEdges > 0 || triCount === 0 || triIDs.length < triCount || vertProperties.length < 9) {
        return finalizeStats({
          candidateEdges,
          acceptedEdges,
          contributionCount,
          contributedVertexCount: contributedVertices.size,
        });
      }
    }
  } catch {
    // Fall back to raw authoring arrays below.
  }

  if (triCount === 0 || triIDs.length < triCount || vertProperties.length < 9) {
    return finalizeStats({
      candidateEdges,
      acceptedEdges,
      contributionCount,
      contributedVertexCount: contributedVertices.size,
    });
  }

  const getParentPoint = (index) => {
    const vertexIndex = index >>> 0;
    let point = parentPointCache.get(vertexIndex);
    if (point) return point;
    const base = vertexIndex * 3;
    point = new THREE.Vector3(
      Number(vertProperties[base + 0]) || 0,
      Number(vertProperties[base + 1]) || 0,
      Number(vertProperties[base + 2]) || 0,
    ).applyMatrix4(parentMatrix);
    parentPointCache.set(vertexIndex, point);
    return point;
  };
  const getParentPointKey = (index) => {
    const vertexIndex = index >>> 0;
    let key = parentKeyCache.get(vertexIndex);
    if (key) return key;
    key = pointKey(getParentPoint(vertexIndex), weldTolerance);
    parentKeyCache.set(vertexIndex, key);
    return key;
  };
  const addContribution = (parentVertexIndex, alignedUnit, normalLength) => {
    return addContributionForPointKey(getParentPointKey(parentVertexIndex), alignedUnit, normalLength);
  };

  const triangle = new THREE.Vector3();
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const faceName = String(idToFaceName.get(triIDs[triIndex]) || '').trim();
    if (faceName === selectedFaceName) continue;
    if (adjacentFaceFilter && !adjacentFaceFilter.has(faceName)) continue;

    const i0 = triVerts[(triIndex * 3) + 0] >>> 0;
    const i1 = triVerts[(triIndex * 3) + 1] >>> 0;
    const i2 = triVerts[(triIndex * 3) + 2] >>> 0;
    const parentEdges = [[i0, i1], [i1, i2], [i2, i0]];
    let touchesBoundaryEdge = false;
    for (const [u, v] of parentEdges) {
      const uKey = getParentPointKey(u);
      const vKey = getParentPointKey(v);
      if (!boundaryEdgeByPointPair.has(unorderedPointPairKey(uKey, vKey))) continue;
      touchesBoundaryEdge = true;
      candidateEdges += 1;
      break;
    }
    if (!touchesBoundaryEdge) continue;

    const p0 = getParentPoint(i0);
    const p1 = getParentPoint(i1);
    const p2 = getParentPoint(i2);
    triangle.copy(triangleNormal(p0, p1, p2));
    const normalLength = triangle.length();
    if (!(normalLength > TRI_EPS)) continue;
    const unit = triangle.multiplyScalar(1 / normalLength);

    let acceptedThisTriangle = false;
    for (const vertexIndex of [i0, i1, i2]) {
      const selectedIndex = boundaryVertexByPointKey.get(getParentPointKey(vertexIndex));
      if (selectedIndex == null) continue;
      const base = vertexNormals[selectedIndex]?.clone?.() || null;
      if (!base || base.lengthSq() <= TRI_EPS) continue;
      base.normalize();
      const dot = unit.dot(base);
      let aligned = null;
      if (dot >= smoothDotThreshold) aligned = unit;
      else if (-dot >= smoothDotThreshold) aligned = unit.clone().multiplyScalar(-1);
      if (!aligned) continue;
      if (addContribution(vertexIndex, aligned, normalLength)) acceptedThisTriangle = true;
    }
    if (acceptedThisTriangle) acceptedEdges += 1;
  }

  return finalizeStats({
    candidateEdges,
    acceptedEdges,
    contributionCount,
    contributedVertexCount: contributedVertices.size,
  });
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, triangleCount: 0 };
  const counts = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = triVerts[triIndex * 3] >>> 0;
    const b = triVerts[triIndex * 3 + 1] >>> 0;
    const c = triVerts[triIndex * 3 + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of counts.values()) {
    if (count === 1) boundaryEdgeCount += 1;
    else if (count !== 2) nonManifoldEdgeCount += 1;
  }
  return { boundaryEdgeCount, nonManifoldEdgeCount, triangleCount: triCount };
}

function analyzeTriangleOrientation(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return { sameDirectionEdgeCount: 0, oppositeDirectionEdgeCount: 0, ambiguousEdgeCount: 0 };
  const edgeUses = new Map();
  const addUse = (a, b) => {
    const key = edgeKey(a, b);
    let list = edgeUses.get(key);
    if (!list) {
      list = [];
      edgeUses.set(key, list);
    }
    list.push([a, b]);
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = triVerts[triIndex * 3] >>> 0;
    const b = triVerts[triIndex * 3 + 1] >>> 0;
    const c = triVerts[triIndex * 3 + 2] >>> 0;
    addUse(a, b);
    addUse(b, c);
    addUse(c, a);
  }
  let sameDirectionEdgeCount = 0;
  let oppositeDirectionEdgeCount = 0;
  let ambiguousEdgeCount = 0;
  for (const uses of edgeUses.values()) {
    if (uses.length !== 2) {
      ambiguousEdgeCount += 1;
      continue;
    }
    if (uses[0][0] === uses[1][0] && uses[0][1] === uses[1][1]) sameDirectionEdgeCount += 1;
    else oppositeDirectionEdgeCount += 1;
  }
  return { sameDirectionEdgeCount, oppositeDirectionEdgeCount, ambiguousEdgeCount };
}

function orientSolidTrianglesByAdjacency(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || vp.length < 9) return 0;

  const edgeUses = new Map();
  const addUse = (a, b, triIndex) => {
    const key = edgeKey(a, b);
    let list = edgeUses.get(key);
    if (!list) {
      list = [];
      edgeUses.set(key, list);
    }
    list.push({ triIndex, a, b });
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    addUse(a, b, triIndex);
    addUse(b, c, triIndex);
    addUse(c, a, triIndex);
  }

  const adjacency = Array.from({ length: triCount }, () => []);
  for (const uses of edgeUses.values()) {
    if (uses.length !== 2) continue;
    const first = uses[0];
    const second = uses[1];
    const sameDirection = first.a === second.a && first.b === second.b;
    adjacency[first.triIndex].push({ triIndex: second.triIndex, sameDirection });
    adjacency[second.triIndex].push({ triIndex: first.triIndex, sameDirection });
  }

  const flip = new Int8Array(triCount);
  flip.fill(-1);
  for (let seed = 0; seed < triCount; seed++) {
    if (flip[seed] !== -1) continue;
    flip[seed] = 0;
    const stack = [seed];
    while (stack.length) {
      const current = stack.pop();
      const currentFlip = flip[current];
      for (const edge of adjacency[current]) {
        const desired = currentFlip ^ (edge.sameDirection ? 1 : 0);
        if (flip[edge.triIndex] === -1) {
          flip[edge.triIndex] = desired;
          stack.push(edge.triIndex);
        }
      }
    }
  }

  let changed = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (flip[triIndex] !== 1) continue;
    const base = triIndex * 3;
    const tmp = tv[base + 1];
    tv[base + 1] = tv[base + 2];
    tv[base + 2] = tmp;
    changed += 1;
  }

  const flipTriangle = (triIndex) => {
    const base = triIndex * 3;
    const tmp = tv[base + 1];
    tv[base + 1] = tv[base + 2];
    tv[base + 2] = tmp;
  };

  const orientationStats = () => {
    const localEdgeUses = new Map();
    const addLocalUse = (a, b, triIndex) => {
      const key = edgeKey(a, b);
      let list = localEdgeUses.get(key);
      if (!list) {
        list = [];
        localEdgeUses.set(key, list);
      }
      list.push({ triIndex, a, b });
    };
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const a = tv[(triIndex * 3) + 0] >>> 0;
      const b = tv[(triIndex * 3) + 1] >>> 0;
      const c = tv[(triIndex * 3) + 2] >>> 0;
      addLocalUse(a, b, triIndex);
      addLocalUse(b, c, triIndex);
      addLocalUse(c, a, triIndex);
    }
    const sameByTri = new Uint8Array(triCount);
    const oppositeByTri = new Uint8Array(triCount);
    let sameCount = 0;
    for (const uses of localEdgeUses.values()) {
      if (uses.length !== 2) continue;
      const sameDirection = uses[0].a === uses[1].a && uses[0].b === uses[1].b;
      if (sameDirection) {
        sameCount += 1;
        sameByTri[uses[0].triIndex] += 1;
        sameByTri[uses[1].triIndex] += 1;
      } else {
        oppositeByTri[uses[0].triIndex] += 1;
        oppositeByTri[uses[1].triIndex] += 1;
      }
    }
    return { sameCount, sameByTri, oppositeByTri };
  };

  for (let pass = 0; pass < 16; pass++) {
    const stats = orientationStats();
    if (stats.sameCount === 0) break;
    let flippedThisPass = 0;
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      if (stats.sameByTri[triIndex] <= stats.oppositeByTri[triIndex]) continue;
      flipTriangle(triIndex);
      changed += 1;
      flippedThisPass += 1;
    }
    if (!flippedThisPass) break;
  }

  for (let pass = 0; pass < 64; pass++) {
    let stats = orientationStats();
    if (stats.sameCount === 0) break;
    const candidates = [];
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      if (!stats.sameByTri[triIndex]) continue;
      candidates.push({
        triIndex,
        score: (stats.sameByTri[triIndex] * 2) - stats.oppositeByTri[triIndex],
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.triIndex - b.triIndex);

    let improvedThisPass = false;
    for (const candidate of candidates) {
      stats = orientationStats();
      if (stats.sameCount === 0 || !stats.sameByTri[candidate.triIndex]) break;
      const before = stats.sameCount;
      flipTriangle(candidate.triIndex);
      const after = orientationStats().sameCount;
      if (after < before) {
        changed += 1;
        improvedThisPass = true;
      } else {
        flipTriangle(candidate.triIndex);
      }
    }
    if (!improvedThisPass) break;
  }

  if (changed > 0) {
    solid._dirty = true;
    solid._faceIndex = null;
    solid._manifold = null;
    invalidateCppSolidCoreCache(solid);
  }
  return changed;
}

function orientSolidComponentsBySignedVolume(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || vp.length < 9) return 0;

  const edgeUses = new Map();
  const addUse = (a, b, triIndex) => {
    const key = edgeKey(a, b);
    let list = edgeUses.get(key);
    if (!list) {
      list = [];
      edgeUses.set(key, list);
    }
    list.push(triIndex);
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    addUse(a, b, triIndex);
    addUse(b, c, triIndex);
    addUse(c, a, triIndex);
  }

  const adjacency = Array.from({ length: triCount }, () => []);
  for (const uses of edgeUses.values()) {
    if (uses.length !== 2) continue;
    adjacency[uses[0]].push(uses[1]);
    adjacency[uses[1]].push(uses[0]);
  }

  const signedVolume = (triIndex) => {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    const ax = vp[(a * 3) + 0], ay = vp[(a * 3) + 1], az = vp[(a * 3) + 2];
    const bx = vp[(b * 3) + 0], by = vp[(b * 3) + 1], bz = vp[(b * 3) + 2];
    const cx = vp[(c * 3) + 0], cy = vp[(c * 3) + 1], cz = vp[(c * 3) + 2];
    return (
      (ax * ((by * cz) - (bz * cy)))
      - (ay * ((bx * cz) - (bz * cx)))
      + (az * ((bx * cy) - (by * cx)))
    ) / 6;
  };

  const visited = new Uint8Array(triCount);
  let changed = 0;
  for (let seed = 0; seed < triCount; seed++) {
    if (visited[seed]) continue;
    const component = [];
    const stack = [seed];
    visited[seed] = 1;
    let volume = 0;
    while (stack.length) {
      const triIndex = stack.pop();
      component.push(triIndex);
      volume += signedVolume(triIndex);
      for (const next of adjacency[triIndex]) {
        if (visited[next]) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    if (!(volume < -TRI_EPS)) continue;
    for (const triIndex of component) {
      const base = triIndex * 3;
      const tmp = tv[base + 1];
      tv[base + 1] = tv[base + 2];
      tv[base + 2] = tmp;
      changed += 1;
    }
  }

  if (changed > 0) {
    solid._dirty = true;
    solid._faceIndex = null;
    solid._manifold = null;
    invalidateCppSolidCoreCache(solid);
  }
  return changed;
}

function weldSolidVerticesByPosition(solid, epsilon) {
  const eps = Math.max(Number(epsilon) || 0, 0);
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const vertexCount = (vp.length / 3) | 0;
  const triCount = (tv.length / 3) | 0;
  if (!(eps > 0) || !vertexCount || !triCount || ids.length < triCount) {
    return { weldedVertexCount: 0, removedTriangleCount: 0 };
  }

  const inv = 1 / eps;
  const keyForIndex = (index) => [
    Math.round((Number(vp[(index * 3) + 0]) || 0) * inv),
    Math.round((Number(vp[(index * 3) + 1]) || 0) * inv),
    Math.round((Number(vp[(index * 3) + 2]) || 0) * inv),
  ].join(',');
  const oldToNew = new Int32Array(vertexCount);
  oldToNew.fill(-1);
  const keyToNew = new Map();
  const newVertProperties = [];
  let weldedVertexCount = 0;
  for (let i = 0; i < vertexCount; i++) {
    const key = keyForIndex(i);
    let mapped = keyToNew.get(key);
    if (mapped == null) {
      mapped = (newVertProperties.length / 3) | 0;
      keyToNew.set(key, mapped);
      newVertProperties.push(vp[(i * 3) + 0], vp[(i * 3) + 1], vp[(i * 3) + 2]);
    } else {
      weldedVertexCount += 1;
    }
    oldToNew[i] = mapped;
  }
  if (!weldedVertexCount) return { weldedVertexCount: 0, removedTriangleCount: 0 };

  const areaByIndex = (a, b, c) => {
    const ax = newVertProperties[(a * 3) + 0], ay = newVertProperties[(a * 3) + 1], az = newVertProperties[(a * 3) + 2];
    const bx = newVertProperties[(b * 3) + 0], by = newVertProperties[(b * 3) + 1], bz = newVertProperties[(b * 3) + 2];
    const cx = newVertProperties[(c * 3) + 0], cy = newVertProperties[(c * 3) + 1], cz = newVertProperties[(c * 3) + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    return 0.5 * Math.hypot((uy * vz) - (uz * vy), (uz * vx) - (ux * vz), (ux * vy) - (uy * vx));
  };

  const newTriVerts = [];
  const newTriIDs = [];
  let removedTriangleCount = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = oldToNew[tv[(triIndex * 3) + 0] >>> 0];
    const b = oldToNew[tv[(triIndex * 3) + 1] >>> 0];
    const c = oldToNew[tv[(triIndex * 3) + 2] >>> 0];
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || c === a || !(areaByIndex(a, b, c) > TRI_EPS)) {
      removedTriangleCount += 1;
      continue;
    }
    newTriVerts.push(a, b, c);
    newTriIDs.push(ids[triIndex]);
  }

  solid._vertProperties = newVertProperties;
  solid._triVerts = newTriVerts;
  solid._triIDs = newTriIDs;
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < newVertProperties.length; i += 3) {
    solid._vertKeyToIndex.set(
      `${newVertProperties[i]},${newVertProperties[i + 1]},${newVertProperties[i + 2]}`,
      (i / 3) | 0,
    );
  }
  solid._dirty = true;
  solid._faceIndex = null;
  solid._manifold = null;
  invalidateCppSolidCoreCache(solid);
  return { weldedVertexCount, removedTriangleCount };
}

function extractFaceSurface(face, options = {}) {
  if (!face?.geometry) {
    throw new Error('Face.thicken() requires a face with geometry.');
  }
  try { face.updateMatrixWorld?.(true); } catch { /* ignore */ }

  const geometry = face.geometry;
  const position = geometry.getAttribute?.('position');
  const index = geometry.getIndex?.() || null;
  if (!position || position.itemSize !== 3 || position.count < 3) {
    throw new Error('Face.thicken() requires a triangulated face geometry.');
  }

  const rawPoints = [];
  const tmp = new THREE.Vector3();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    tmp.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(face.matrixWorld);
    rawPoints.push(tmp.clone());
    if (tmp.x < minX) minX = tmp.x;
    if (tmp.y < minY) minY = tmp.y;
    if (tmp.z < minZ) minZ = tmp.z;
    if (tmp.x > maxX) maxX = tmp.x;
    if (tmp.y > maxY) maxY = tmp.y;
    if (tmp.z > maxZ) maxZ = tmp.z;
  }
  const scale = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
  const weldTolerance = Math.max(
    Number(options.weldTolerance) || 0,
    Math.max(1e-6, scale * 1e-7),
  );

  const canonicalMap = new Map();
  const canonicalAcc = [];
  const rawToCanonical = new Array(rawPoints.length);
  for (let i = 0; i < rawPoints.length; i++) {
    const point = rawPoints[i];
    const key = pointKey(point, weldTolerance);
    let canonicalIndex = canonicalMap.get(key);
    if (canonicalIndex == null) {
      canonicalIndex = canonicalAcc.length;
      canonicalMap.set(key, canonicalIndex);
      canonicalAcc.push({ point: point.clone(), count: 1, key });
    } else {
      canonicalAcc[canonicalIndex].point.add(point);
      canonicalAcc[canonicalIndex].count += 1;
    }
    rawToCanonical[i] = canonicalIndex;
  }

  let vertices = canonicalAcc.map((entry) => entry.point.multiplyScalar(1 / entry.count));
  let vertexKeys = canonicalAcc.map((entry) => entry.key);
  const triangleSourceFaceNames = Array.isArray(options.triangleSourceFaceNames)
    ? options.triangleSourceFaceNames
    : null;
  const defaultTriangleSourceFaceName = String(options.sourceFaceName || getFaceLabel(face) || '').trim();
  let triangles = [];
  const triCount = index ? ((index.count / 3) | 0) : ((position.count / 3) | 0);
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? (index.getX((t * 3) + 0) >>> 0) : ((t * 3) + 0);
    const i1 = index ? (index.getX((t * 3) + 1) >>> 0) : ((t * 3) + 1);
    const i2 = index ? (index.getX((t * 3) + 2) >>> 0) : ((t * 3) + 2);
    const a = rawToCanonical[i0] >>> 0;
    const b = rawToCanonical[i1] >>> 0;
    const c = rawToCanonical[i2] >>> 0;
    if (a === b || b === c || c === a) continue;
    const area = triangleArea(vertices[a], vertices[b], vertices[c]);
    if (!(area > TRI_EPS)) continue;
    const tri = [a, b, c];
    const triSourceFaceName = String(triangleSourceFaceNames?.[t] || defaultTriangleSourceFaceName || '').trim();
    if (triSourceFaceName) tri.sourceFaceName = triSourceFaceName;
    triangles.push(tri);
  }
  if (!triangles.length) {
    throw new Error('Face.thicken() could not resolve any non-degenerate source triangles.');
  }

  const edgeToUses = new Map();
  const triAdjacency = new Array(triangles.length).fill(null).map(() => []);
  const edgeOrientation = (tri, u, v) => {
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
      if (a === u && b === v) return 1;
      if (a === v && b === u) return -1;
    }
    return 0;
  };

  for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
    const tri = triangles[triIndex];
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
      const key = edgeKey(u, v);
      let uses = edgeToUses.get(key);
      if (!uses) {
        uses = [];
        edgeToUses.set(key, uses);
      }
      uses.push({ triIndex, u, v });
    }
  }

  for (const [key, uses] of edgeToUses.entries()) {
    if (!Array.isArray(uses) || uses.length < 2) continue;
    const [uRaw, vRaw] = key.split('|');
    const u = Number(uRaw) >>> 0;
    const v = Number(vRaw) >>> 0;
    for (let i = 0; i < uses.length; i++) {
      for (let j = i + 1; j < uses.length; j++) {
        triAdjacency[uses[i].triIndex].push({ neighbor: uses[j].triIndex, u, v });
        triAdjacency[uses[j].triIndex].push({ neighbor: uses[i].triIndex, u, v });
      }
    }
  }

  const triVisited = new Array(triangles.length).fill(false);
  const flipTriangle = (tri) => copyTriangleMetadata(tri, [tri[0], tri[2], tri[1]]);

  for (let seed = 0; seed < triangles.length; seed++) {
    if (triVisited[seed]) continue;
    const stack = [seed];
    triVisited[seed] = true;
    while (stack.length) {
      const current = stack.pop();
      const tri = triangles[current];
      for (const adj of triAdjacency[current]) {
        const neighbor = adj.neighbor;
        if (neighbor == null) continue;
        if (!triVisited[neighbor]) {
          const neighborTri = triangles[neighbor];
          const currentOrient = edgeOrientation(tri, adj.u, adj.v);
          const neighborOrient = edgeOrientation(neighborTri, adj.u, adj.v);
          if (currentOrient !== 0 && currentOrient === neighborOrient) {
            triangles[neighbor] = flipTriangle(neighborTri);
          }
          triVisited[neighbor] = true;
          stack.push(neighbor);
        }
      }
    }
  }

  const triangleNormals = new Array(triangles.length);
  const vertexNormals = new Array(vertices.length).fill(null).map(() => new THREE.Vector3());
  const averageNormal = new THREE.Vector3();

  for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
    const [a, b, c] = triangles[triIndex];
    const normal = triangleNormal(vertices[a], vertices[b], vertices[c]);
    const areaTwice = normal.length();
    if (!(areaTwice > TRI_EPS)) continue;
    const unit = normal.clone().multiplyScalar(1 / areaTwice);
    triangleNormals[triIndex] = unit;
    vertexNormals[a].add(unit.clone().multiplyScalar(areaTwice));
    vertexNormals[b].add(unit.clone().multiplyScalar(areaTwice));
    vertexNormals[c].add(unit.clone().multiplyScalar(areaTwice));
    averageNormal.add(unit.clone().multiplyScalar(areaTwice));
  }
  if (averageNormal.lengthSq() <= TRI_EPS) averageNormal.set(0, 0, 1);
  else averageNormal.normalize();

  const boundaryDirectedEdges = [];
  for (const [key, uses] of edgeToUses.entries()) {
    if (uses.length !== 1) continue;
    const use = uses[0];
    boundaryDirectedEdges.push({ key, start: use.u, end: use.v });
  }

  const boundaryOutgoing = new Map();
  for (const edge of boundaryDirectedEdges) {
    let list = boundaryOutgoing.get(edge.start);
    if (!list) {
      list = [];
      boundaryOutgoing.set(edge.start, list);
    }
    list.push(edge);
  }

  const remainingEdges = new Set(boundaryDirectedEdges.map((edge) => `${edge.start}>${edge.end}`));
  const rawLoops = [];
  const compareEdges = (a, b) => {
    const aKey = `${vertexKeys[a.start]}|${vertexKeys[a.end]}`;
    const bKey = `${vertexKeys[b.start]}|${vertexKeys[b.end]}`;
    return aKey.localeCompare(bKey);
  };

  while (remainingEdges.size) {
    const seedEdgeKey = Array.from(remainingEdges.values())
      .sort((a, b) => a.localeCompare(b))[0];
    const [seedStartRaw, seedEndRaw] = seedEdgeKey.split('>');
    const seedStart = Number(seedStartRaw) >>> 0;
    const seedEnd = Number(seedEndRaw) >>> 0;
    const loopEdges = [];
    const loopVertices = [seedStart];
    let start = seedStart;
    let current = seedStart;
    let next = seedEnd;
    while (remainingEdges.has(`${current}>${next}`)) {
      remainingEdges.delete(`${current}>${next}`);
      loopEdges.push({ start: current, end: next, key: edgeKey(current, next) });
      loopVertices.push(next);
      current = next;
      if (current === start) break;
      const candidates = (boundaryOutgoing.get(current) || [])
        .filter((edge) => remainingEdges.has(`${edge.start}>${edge.end}`))
        .sort(compareEdges);
      if (!candidates.length) break;
      next = candidates[0].end;
    }
    if (loopEdges.length) {
      rawLoops.push({ vertices: loopVertices, edges: loopEdges });
    }
  }

  const normalizeLoopSignature = (loop) => {
    const verts = Array.isArray(loop?.vertices) ? loop.vertices.slice(0, -1) : [];
    if (!verts.length) return '';
    let best = null;
    for (let offset = 0; offset < verts.length; offset++) {
      const rotated = [];
      for (let i = 0; i < verts.length; i++) {
        rotated.push(vertexKeys[verts[(offset + i) % verts.length]] || `${verts[(offset + i) % verts.length]}`);
      }
      const signature = rotated.join('>');
      if (best == null || signature < best) best = signature;
    }
    return best || '';
  };

  const loops = rawLoops
    .map((loop) => ({ ...loop, signature: normalizeLoopSignature(loop) }))
    .sort((a, b) => a.signature.localeCompare(b.signature));

  assignSourceEdgesToBoundaryLoops(face, loops, vertices, scale, weldTolerance);

  const boundaryEdgeToLoop = new Map();
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
    const loop = loops[loopIndex];
    for (const edge of loop.edges) {
      boundaryEdgeToLoop.set(edge.key, loopIndex);
    }
  }

  const adjacentNormalStats = addSmoothAdjacentBoundaryNormals(face, {
    vertices,
    triangles,
    vertexNormals,
    averageNormal,
    loops,
    boundaryEdgeToLoop,
    boundaryDirectedEdges,
    scale,
    weldTolerance,
  }, options);

  for (let i = 0; i < vertexNormals.length; i++) {
    if (vertexNormals[i].lengthSq() <= TRI_EPS) {
      vertexNormals[i].copy(averageNormal);
    }
    if (vertexNormals[i].lengthSq() <= TRI_EPS) {
      vertexNormals[i].set(0, 0, 1);
    } else {
      vertexNormals[i].normalize();
    }
  }

  return {
    vertices,
    triangles,
    triangleNormals,
    vertexNormals,
    averageNormal,
    loops,
    boundaryEdgeToLoop,
    boundaryDirectedEdges,
    adjacentNormalStats,
    scale,
    weldTolerance,
  };
}

function extractFacesSurface(faces, options = {}) {
  const faceList = Array.isArray(faces)
    ? faces.filter((face) => face?.geometry)
    : [];
  if (!faceList.length) {
    throw new Error('Face.thicken() requires at least one face with geometry.');
  }

  const rawPositions = [];
  const rawIndices = [];
  const triangleSourceFaceNames = [];
  const sourceEdges = [];
  const tmp = new THREE.Vector3();
  let commonParentSolid = null;
  let hasMixedParentSolid = false;

  for (const face of faceList) {
    try { face.updateMatrixWorld?.(true); } catch { /* ignore */ }
    const faceName = getFaceLabel(face) || `FACE_${faceList.indexOf(face) + 1}`;
    const parentSolid = face?.parentSolid || (String(face?.parent?.type || '').toUpperCase() === 'SOLID' ? face.parent : null);
    if (!commonParentSolid && parentSolid) commonParentSolid = parentSolid;
    else if (commonParentSolid && parentSolid && parentSolid !== commonParentSolid) hasMixedParentSolid = true;
    if (Array.isArray(face?.edges)) {
      for (const edge of face.edges) {
        if (edge && !sourceEdges.includes(edge)) sourceEdges.push(edge);
      }
    }
    const geometry = face.geometry;
    const position = geometry.getAttribute?.('position');
    const index = geometry.getIndex?.() || null;
    if (!position || position.itemSize !== 3 || position.count < 3) {
      throw new Error('Face.thicken() requires triangulated face geometries.');
    }

    const baseVertex = (rawPositions.length / 3) | 0;
    for (let i = 0; i < position.count; i++) {
      tmp
        .set(position.getX(i), position.getY(i), position.getZ(i))
        .applyMatrix4(face.matrixWorld || new THREE.Matrix4());
      rawPositions.push(tmp.x, tmp.y, tmp.z);
    }

    const triCount = index ? ((index.count / 3) | 0) : ((position.count / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const i0 = index ? (index.getX((triIndex * 3) + 0) >>> 0) : ((triIndex * 3) + 0);
      const i1 = index ? (index.getX((triIndex * 3) + 1) >>> 0) : ((triIndex * 3) + 1);
      const i2 = index ? (index.getX((triIndex * 3) + 2) >>> 0) : ((triIndex * 3) + 2);
      rawIndices.push(baseVertex + i0, baseVertex + i1, baseVertex + i2);
      triangleSourceFaceNames.push(faceName);
    }
  }

  if (rawIndices.length < 3) {
    throw new Error('Face.thicken() could not resolve any source triangles.');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rawPositions), 3));
  geometry.setIndex(rawIndices);

  const fakeFace = {
    geometry,
    matrixWorld: new THREE.Matrix4(),
    name: String(options.sourceFaceName || 'THICKEN_PATCH'),
    edges: sourceEdges,
    parentSolid: hasMixedParentSolid ? null : commonParentSolid,
    userData: {
      faceName: String(options.sourceFaceName || 'THICKEN_PATCH'),
    },
    updateMatrixWorld() {},
  };
  return extractFaceSurface(fakeFace, {
    ...options,
    triangleSourceFaceNames,
    disableAdjacentBoundaryNormals: options.disableAdjacentBoundaryNormals
      ?? !(options.equalAdjacentBoundaryNormals === true
        || String(options.sharedBoundaryNormalMode || '').toLowerCase() === 'equal'),
  });
}

function buildThickenClassificationState(labels, distance) {
  const capGroups = [];
  const capLabels = new Set();
  const addCapGroup = (entry, kind) => {
    const label = String(entry?.label || '').trim();
    if (!label || capLabels.has(label)) return;
    capLabels.add(label);
    const sourceFaceName = String(entry?.sourceFaceName || labels.sourceFaceName || '').trim() || labels.sourceFaceName;
    capGroups.push({
      label,
      kind,
      metadata: {
        type: kind === 'start' ? 'start_cap' : 'end_cap',
        sourceFaceName,
        distance,
      },
    });
  };
  const startCaps = Array.isArray(labels.startCaps) && labels.startCaps.length
    ? labels.startCaps
    : [{ label: labels.start, sourceFaceName: labels.sourceFaceName }];
  const endCaps = Array.isArray(labels.endCaps) && labels.endCaps.length
    ? labels.endCaps
    : [{ label: labels.end, sourceFaceName: labels.sourceFaceName }];
  for (const entry of startCaps) addCapGroup(entry, 'start');
  for (const entry of endCaps) addCapGroup(entry, 'end');

  const sidewallGroups = [];
  const sidewallGroupByLabel = new Map();
  for (const entry of labels.sidewalls || []) {
    const label = String(entry?.label || '').trim();
    if (!label) continue;
    let group = sidewallGroupByLabel.get(label);
    if (!group) {
      group = {
        label,
        kind: 'sidewall',
        metadata: {
          type: 'sidewall',
          sourceFaceName: labels.sourceFaceName,
          loopIndex: entry.loopIndex,
          edgeIndex: entry.edgeIndex,
          edgeKey: entry.key,
          sourceEdgeName: entry.sourceEdgeName || null,
          sourceEdgeKey: entry.sourceEdgeKey || null,
          distance,
          segmentCount: 0,
          edgeKeys: [],
        },
      };
      sidewallGroupByLabel.set(label, group);
      sidewallGroups.push(group);
    }
    group.metadata.segmentCount += 1;
    if (entry.key != null) group.metadata.edgeKeys.push(entry.key);
  }

  const groups = [
    ...capGroups,
    ...sidewallGroups,
  ];

  const faceNameToID = new Map();
  const idToFaceName = new Map();
  const faceMetadataJson = [];
  let nextID = 1;
  try {
    if (typeof Manifold?.reserveIDs === 'function') {
      nextID = Number(Manifold.reserveIDs(groups.length)) || 1;
    }
  } catch {
    nextID = 1;
  }
  for (const group of groups) {
    const id = nextID >>> 0;
    nextID += 1;
    faceNameToID.set(group.label, id);
    idToFaceName.set(id, group.label);
    faceMetadataJson.push([group.label, JSON.stringify(group.metadata || {})]);
  }

  return {
    labels,
    groups,
    faceNameToID,
    idToFaceName,
    faceMetadataJson,
    edgeKeyToLabel: new Map(labels.sidewalls.map((entry) => [entry.key, entry.label])),
  };
}

function buildSolidFromTriangleMesh(mesh, classification, name) {
  const triVerts = Array.from(mesh?.triVerts ?? [], (value) => Number(value) >>> 0);
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return null;

  const faceID = Array.from(classification?.triIDs ?? mesh?.faceID ?? [], (value) => Number(value) >>> 0);
  const fallbackFaceID = Number(classification?.faceNameToID?.values?.()?.next?.()?.value) >>> 0;
  const triIDs = faceID.length === triCount
    ? faceID
    : new Array(triCount).fill(fallbackFaceID || 1);

  const solid = new Solid();
  solid._numProp = Number(mesh?.numProp ?? 3) || 3;
  solid._vertProperties = Array.from(mesh?.vertProperties ?? [], (value) => Number(value) || 0);
  solid._triVerts = triVerts;
  solid._triIDs = triIDs;
  solid._faceNameToID = classification?.faceNameToID instanceof Map
    ? new Map(classification.faceNameToID)
    : new Map();
  solid._idToFaceName = classification?.idToFaceName instanceof Map
    ? new Map(classification.idToFaceName)
    : new Map();
  solid._faceMetadata = new Map();
  for (const [faceName, metadataJson] of classification?.faceMetadataJson || []) {
    if (!faceName) continue;
    try {
      solid._faceMetadata.set(String(faceName), JSON.parse(metadataJson || '{}') || {});
    } catch {
      solid._faceMetadata.set(String(faceName), {});
    }
  }
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < solid._vertProperties.length; i += 3) {
    solid._vertKeyToIndex.set(
      `${solid._vertProperties[i]},${solid._vertProperties[i + 1]},${solid._vertProperties[i + 2]}`,
      (i / 3) | 0,
    );
  }
  try { solid.name = name || solid.name; } catch { /* ignore */ }
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  return solid;
}

function buildRawClassification(classificationState, triIDs, method = 'raw_face_ids') {
  return {
    triIDs: Array.from(triIDs || [], (rawID) => Number(rawID) >>> 0),
    faceNameToID: classificationState?.faceNameToID instanceof Map
      ? classificationState.faceNameToID
      : new Map(),
    idToFaceName: classificationState?.idToFaceName instanceof Map
      ? classificationState.idToFaceName
      : new Map(),
    faceMetadataJson: Array.from(classificationState?.faceMetadataJson || []),
    groups: Array.isArray(classificationState?.groups) ? classificationState.groups : [],
    method,
  };
}

function resolveCapLabelForTriangle(classificationState, tri, kind) {
  const labels = classificationState?.labels || {};
  const sourceFaceName = String(tri?.sourceFaceName || '').trim();
  const capLabels = sourceFaceName
    ? labels.capLabelsBySourceFaceName?.get?.(sourceFaceName)
    : null;
  const label = kind === 'start'
    ? (capLabels?.start || labels.start)
    : (capLabels?.end || labels.end);
  return String(label || '').trim();
}

function resolveCapFaceIDForTriangle(classificationState, tri, kind) {
  const label = resolveCapLabelForTriangle(classificationState, tri, kind);
  return Number(classificationState?.faceNameToID?.get?.(label)) >>> 0;
}

function buildStitchedThickenMesh(surface, distance, classificationState) {
  const vertexCount = Array.isArray(surface?.vertices) ? surface.vertices.length : 0;
  if (!vertexCount) return null;

  const vertProperties = new Float32Array(vertexCount * 2 * 3);
  for (let i = 0; i < vertexCount; i++) {
    const p = surface.vertices[i];
    const q = p.clone().add(surface.vertexNormals[i].clone().multiplyScalar(distance));
    vertProperties[(i * 3) + 0] = p.x;
    vertProperties[(i * 3) + 1] = p.y;
    vertProperties[(i * 3) + 2] = p.z;
    const qi = vertexCount + i;
    vertProperties[(qi * 3) + 0] = q.x;
    vertProperties[(qi * 3) + 1] = q.y;
    vertProperties[(qi * 3) + 2] = q.z;
  }

  const fallbackStartFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.start)) >>> 0;
  const fallbackEndFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.end)) >>> 0;
  const triVerts = [];
  const triIDs = [];
  const addTriangle = (i0, i1, i2, faceID) => {
    if (i0 === i1 || i1 === i2 || i2 === i0) return;
    const a = new THREE.Vector3(
      vertProperties[(i0 * 3) + 0],
      vertProperties[(i0 * 3) + 1],
      vertProperties[(i0 * 3) + 2],
    );
    const b = new THREE.Vector3(
      vertProperties[(i1 * 3) + 0],
      vertProperties[(i1 * 3) + 1],
      vertProperties[(i1 * 3) + 2],
    );
    const c = new THREE.Vector3(
      vertProperties[(i2 * 3) + 0],
      vertProperties[(i2 * 3) + 1],
      vertProperties[(i2 * 3) + 2],
    );
    if (!(triangleArea(a, b, c) > TRI_EPS)) return;
    triVerts.push(i0 >>> 0, i1 >>> 0, i2 >>> 0);
    triIDs.push(Number(faceID) >>> 0);
  };

  for (const tri of surface.triangles || []) {
    const [a, b, c] = tri;
    const startFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'start') || fallbackStartFaceID;
    const endFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'end') || fallbackEndFaceID;
    if (distance >= 0) {
      addTriangle(a, c, b, startFaceID);
      addTriangle(vertexCount + a, vertexCount + b, vertexCount + c, endFaceID);
    } else {
      addTriangle(a, b, c, startFaceID);
      addTriangle(vertexCount + a, vertexCount + c, vertexCount + b, endFaceID);
    }
  }

  for (let loopIndex = 0; loopIndex < (surface.loops?.length || 0); loopIndex++) {
    const loop = surface.loops[loopIndex];
    for (const edge of loop?.edges || []) {
      const u = edge.start >>> 0;
      const v = edge.end >>> 0;
      const qu = vertexCount + u;
      const qv = vertexCount + v;
      const sideLabel = classificationState?.edgeKeyToLabel?.get?.(edge.key);
      const sideFaceID = Number(classificationState?.faceNameToID?.get?.(sideLabel)) >>> 0;
      if (distance >= 0) {
        addTriangle(u, v, qv, sideFaceID);
        addTriangle(u, qv, qu, sideFaceID);
      } else {
        addTriangle(qu, qv, v, sideFaceID);
        addTriangle(qu, v, u, sideFaceID);
      }
    }
  }

  return {
    numProp: 3,
    vertProperties,
    triVerts: Uint32Array.from(triVerts),
    faceID: Uint32Array.from(triIDs),
  };
}

function buildStitchedShellSolid(surface, distance, classificationState, solidName) {
  const rawMesh = buildStitchedThickenMesh(surface, distance, classificationState);
  if (!rawMesh) return null;
  const rawClassification = buildRawClassification(classificationState, rawMesh.faceID, 'stitched_shell');
  return buildSolidFromTriangleMesh(rawMesh, rawClassification, solidName);
}

function buildTrianglePrismUnionThickenMesh(surface, distance, classificationState) {
  const vertices = Array.isArray(surface?.vertices) ? surface.vertices : [];
  const triangles = Array.isArray(surface?.triangles) ? surface.triangles : [];
  if (!vertices.length || !triangles.length) return null;

  const fallbackStartFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.start)) >>> 0;
  const fallbackEndFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.end)) >>> 0;
  const sidewallFallbackID = Number(
    classificationState?.faceNameToID?.values?.()?.next?.()?.value,
  ) >>> 0;
  const triVerts = [];
  const triIDs = [];
  const vertProperties = [];

  const addVertex = (point) => {
    const index = (vertProperties.length / 3) | 0;
    vertProperties.push(point.x, point.y, point.z);
    return index;
  };
  const addTriangleByPoints = (a, b, c, faceID) => {
    if (!a || !b || !c) return;
    if (!(triangleArea(a, b, c) > TRI_EPS)) return;
    const ia = addVertex(a);
    const ib = addVertex(b);
    const ic = addVertex(c);
    triVerts.push(ia, ib, ic);
    triIDs.push(Number(faceID) >>> 0);
  };
  const resolveSideFaceID = (u, v) => {
    const key = edgeKey(u, v);
    const sideLabel = classificationState?.edgeKeyToLabel?.get?.(key);
    return Number(classificationState?.faceNameToID?.get?.(sideLabel)) >>> 0
      || sidewallFallbackID
      || fallbackStartFaceID
      || fallbackEndFaceID
      || 1;
  };

  for (const tri of triangles) {
    const aIndex = tri?.[0] >>> 0;
    const bIndex = tri?.[1] >>> 0;
    const cIndex = tri?.[2] >>> 0;
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const c = vertices[cIndex];
    if (!a || !b || !c) continue;
    const startFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'start') || fallbackStartFaceID;
    const endFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'end') || fallbackEndFaceID;
    const normal = triangleNormal(a, b, c);
    const normalLength = normal.length();
    if (!(normalLength > TRI_EPS)) continue;
    normal.multiplyScalar(distance / normalLength);
    const qa = a.clone().add(normal);
    const qb = b.clone().add(normal);
    const qc = c.clone().add(normal);

    if (distance >= 0) {
      addTriangleByPoints(a, c, b, startFaceID);
      addTriangleByPoints(qa, qb, qc, endFaceID);
      addTriangleByPoints(a, b, qb, resolveSideFaceID(aIndex, bIndex));
      addTriangleByPoints(a, qb, qa, resolveSideFaceID(aIndex, bIndex));
      addTriangleByPoints(b, c, qc, resolveSideFaceID(bIndex, cIndex));
      addTriangleByPoints(b, qc, qb, resolveSideFaceID(bIndex, cIndex));
      addTriangleByPoints(c, a, qa, resolveSideFaceID(cIndex, aIndex));
      addTriangleByPoints(c, qa, qc, resolveSideFaceID(cIndex, aIndex));
    } else {
      addTriangleByPoints(a, b, c, startFaceID);
      addTriangleByPoints(qa, qc, qb, endFaceID);
      addTriangleByPoints(qa, qb, b, resolveSideFaceID(aIndex, bIndex));
      addTriangleByPoints(qa, b, a, resolveSideFaceID(aIndex, bIndex));
      addTriangleByPoints(qb, qc, c, resolveSideFaceID(bIndex, cIndex));
      addTriangleByPoints(qb, c, b, resolveSideFaceID(bIndex, cIndex));
      addTriangleByPoints(qc, qa, a, resolveSideFaceID(cIndex, aIndex));
      addTriangleByPoints(qc, a, c, resolveSideFaceID(cIndex, aIndex));
    }
  }

  if (!triVerts.length) return null;
  return {
    numProp: 3,
    vertProperties: Float32Array.from(vertProperties),
    triVerts: Uint32Array.from(triVerts),
    faceID: Uint32Array.from(triIDs),
  };
}

function buildTrianglePrismUnionShellSolid(surface, distance, classificationState, solidName) {
  const rawMesh = buildTrianglePrismUnionThickenMesh(surface, distance, classificationState);
  if (!rawMesh) return null;
  const rawClassification = buildRawClassification(classificationState, rawMesh.faceID, 'triangle_prism_union');
  return buildSolidFromTriangleMesh(rawMesh, rawClassification, solidName);
}

function cullInternalTrianglesByIndexedRaycast(solid, options = {}) {
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || vp.length < 9 || ids.length < triCount) return 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i + 0];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const eps = Math.max(diag * (Number(options.offsetScale) || 1e-5), 1e-9);
  const rayEps = Math.max(eps * 0.1, diag * 1e-10, 1e-10);
  const gridSize = Math.max(
    12,
    Math.min(256, Number.isFinite(Number(options.gridSize))
      ? Number(options.gridSize) | 0
      : Math.ceil(Math.sqrt(triCount))),
  );

  const triangles = new Array(triCount);
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const i0 = tv[(triIndex * 3) + 0] >>> 0;
    const i1 = tv[(triIndex * 3) + 1] >>> 0;
    const i2 = tv[(triIndex * 3) + 2] >>> 0;
    const a = [vp[(i0 * 3) + 0], vp[(i0 * 3) + 1], vp[(i0 * 3) + 2]];
    const b = [vp[(i1 * 3) + 0], vp[(i1 * 3) + 1], vp[(i1 * 3) + 2]];
    const c = [vp[(i2 * 3) + 0], vp[(i2 * 3) + 1], vp[(i2 * 3) + 2]];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = (uy * vz) - (uz * vy);
    let ny = (uz * vx) - (ux * vz);
    let nz = (ux * vy) - (uy * vx);
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength > TRI_EPS) {
      nx /= normalLength;
      ny /= normalLength;
      nz /= normalLength;
    } else {
      nx = 0;
      ny = 0;
      nz = 0;
    }
    triangles[triIndex] = {
      a,
      b,
      c,
      normal: [nx, ny, nz],
      centroid: [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ],
      min: [
        Math.min(a[0], b[0], c[0]),
        Math.min(a[1], b[1], c[1]),
        Math.min(a[2], b[2], c[2]),
      ],
      max: [
        Math.max(a[0], b[0], c[0]),
        Math.max(a[1], b[1], c[1]),
        Math.max(a[2], b[2], c[2]),
      ],
    };
  }

  const axes = [
    { primary: 0, u: 1, v: 2, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { primary: 1, u: 2, v: 0, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { primary: 2, u: 0, v: 1, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  ];

  const buildIndex = (axis) => {
    const uMin = axis.min[axis.u];
    const vMin = axis.min[axis.v];
    const uSpan = Math.max(axis.max[axis.u] - uMin, eps);
    const vSpan = Math.max(axis.max[axis.v] - vMin, eps);
    const cells = new Map();
    const cellCoord = (value, min, span) => Math.max(
      0,
      Math.min(gridSize - 1, Math.floor(((value - min) / span) * gridSize)),
    );
    const addCell = (iu, iv, triIndex) => {
      const key = `${iu}|${iv}`;
      let list = cells.get(key);
      if (!list) {
        list = [];
        cells.set(key, list);
      }
      list.push(triIndex);
    };
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const tri = triangles[triIndex];
      const iu0 = cellCoord(tri.min[axis.u] - eps, uMin, uSpan);
      const iu1 = cellCoord(tri.max[axis.u] + eps, uMin, uSpan);
      const iv0 = cellCoord(tri.min[axis.v] - eps, vMin, vSpan);
      const iv1 = cellCoord(tri.max[axis.v] + eps, vMin, vSpan);
      for (let iu = iu0; iu <= iu1; iu++) {
        for (let iv = iv0; iv <= iv1; iv++) {
          addCell(iu, iv, triIndex);
        }
      }
    }
    return { axis, uMin, vMin, uSpan, vSpan, cells, cellCoord };
  };

  const selectedAxes = String(options.axes || '').toLowerCase() === 'majority'
    ? axes
    : [axes[0]];
  const indexes = selectedAxes.map(buildIndex);
  const pointInIndexCell = (index, point) => {
    const iu = index.cellCoord(point[index.axis.u], index.uMin, index.uSpan);
    const iv = index.cellCoord(point[index.axis.v], index.vMin, index.vSpan);
    return index.cells.get(`${iu}|${iv}`) || [];
  };

  const rayTriangleHit = (point, axis, tri) => {
    const p = axis.primary;
    const u = axis.u;
    const v = axis.v;
    const ax = tri.a[p] - point[p];
    const ay = tri.a[u] - point[u];
    const az = tri.a[v] - point[v];
    const bx = tri.b[p] - point[p];
    const by = tri.b[u] - point[u];
    const bz = tri.b[v] - point[v];
    const cx = tri.c[p] - point[p];
    const cy = tri.c[u] - point[u];
    const cz = tri.c[v] - point[v];

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    const det = (e1z * e2y) - (e1y * e2z);
    if (Math.abs(det) <= rayEps) return null;
    const invDet = 1 / det;
    const tx = -ax;
    const ty = -ay;
    const tz = -az;
    const px = 0;
    const py = -e2z;
    const pz = e2y;
    const baryU = ((tx * px) + (ty * py) + (tz * pz)) * invDet;
    if (baryU < -1e-10 || baryU > 1 + 1e-10) return null;
    const qx = (ty * e1z) - (tz * e1y);
    const qy = (tz * e1x) - (tx * e1z);
    const qz = (tx * e1y) - (ty * e1x);
    const baryV = qx * invDet;
    if (baryV < -1e-10 || baryU + baryV > 1 + 1e-10) return null;
    const t = ((e2x * qx) + (e2y * qy) + (e2z * qz)) * invDet;
    return t > rayEps ? t : null;
  };

  const inside = (point, index) => {
    const hits = [];
    for (const triIndex of pointInIndexCell(index, point)) {
      const tri = triangles[triIndex];
      if (point[index.axis.primary] > tri.max[index.axis.primary] + eps) continue;
      if (point[index.axis.u] < tri.min[index.axis.u] - eps || point[index.axis.u] > tri.max[index.axis.u] + eps) continue;
      if (point[index.axis.v] < tri.min[index.axis.v] - eps || point[index.axis.v] > tri.max[index.axis.v] + eps) continue;
      const hit = rayTriangleHit(point, index.axis, tri);
      if (hit != null) hits.push(hit);
    }
    if (!hits.length) return false;
    hits.sort((a, b) => a - b);
    let uniqueHits = 0;
    let previous = -Infinity;
    for (const hit of hits) {
      if (Math.abs(hit - previous) <= Math.max(rayEps * 4, 1e-8)) continue;
      uniqueHits += 1;
      previous = hit;
    }
    return (uniqueHits % 2) === 1;
  };

  const keepTri = new Uint8Array(triCount);
  keepTri.fill(1);
  let removed = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const tri = triangles[triIndex];
    const n = tri.normal;
    if (Math.hypot(n[0], n[1], n[2]) <= TRI_EPS) continue;
    const pPlus = [
      tri.centroid[0] + (n[0] * eps),
      tri.centroid[1] + (n[1] * eps),
      tri.centroid[2] + (n[2] * eps),
    ];
    const pMinus = [
      tri.centroid[0] - (n[0] * eps),
      tri.centroid[1] - (n[1] * eps),
      tri.centroid[2] - (n[2] * eps),
    ];
    let crossingVotes = 0;
    for (const index of indexes) {
      if (inside(pPlus, index) !== inside(pMinus, index)) crossingVotes += 1;
    }
    if (crossingVotes >= Math.ceil(indexes.length / 2)) continue;
    keepTri[triIndex] = 0;
    removed += 1;
  }
  if (!removed) return 0;

  const vertexCount = (vp.length / 3) | 0;
  const usedVert = new Uint8Array(vertexCount);
  const newTriVerts = [];
  const newTriIDs = [];
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (!keepTri[triIndex]) continue;
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    newTriVerts.push(a, b, c);
    newTriIDs.push(ids[triIndex]);
    usedVert[a] = 1;
    usedVert[b] = 1;
    usedVert[c] = 1;
  }

  const oldToNew = new Int32Array(vertexCount);
  oldToNew.fill(-1);
  const newVertProperties = [];
  let nextVertex = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (!usedVert[i]) continue;
    oldToNew[i] = nextVertex++;
    newVertProperties.push(vp[(i * 3) + 0], vp[(i * 3) + 1], vp[(i * 3) + 2]);
  }
  for (let i = 0; i < newTriVerts.length; i++) {
    newTriVerts[i] = oldToNew[newTriVerts[i] >>> 0];
  }

  solid._vertProperties = newVertProperties;
  solid._triVerts = newTriVerts;
  solid._triIDs = newTriIDs;
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < newVertProperties.length; i += 3) {
    solid._vertKeyToIndex.set(
      `${newVertProperties[i]},${newVertProperties[i + 1]},${newVertProperties[i + 2]}`,
      (i / 3) | 0,
    );
  }
  solid._dirty = true;
  solid._faceIndex = null;
  solid._manifold = null;
  invalidateCppSolidCoreCache(solid);
  try { solid.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
  return removed;
}

function fillBoundaryLoopsWithTriangles(solid, faceID) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || vp.length < 9) return 0;

  const edgeUses = new Map();
  const addUse = (a, b) => {
    const key = edgeKey(a, b);
    let entry = edgeUses.get(key);
    if (!entry) {
      entry = { count: 0, directed: [] };
      edgeUses.set(key, entry);
    }
    entry.count += 1;
    entry.directed.push([a, b]);
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    addUse(a, b);
    addUse(b, c);
    addUse(c, a);
  }

  const outgoing = new Map();
  const undirectedAdjacency = new Map();
  const directedBoundaryByEdge = new Map();
  const boundaryEdges = [];
  const addUndirectedNeighbor = (a, b) => {
    let list = undirectedAdjacency.get(a);
    if (!list) {
      list = [];
      undirectedAdjacency.set(a, list);
    }
    list.push(b);
  };
  for (const entry of edgeUses.values()) {
    if (entry.count !== 1 || !entry.directed.length) continue;
    const [a, b] = entry.directed[0];
    const edge = { a, b, key: `${a}>${b}` };
    boundaryEdges.push(edge);
    directedBoundaryByEdge.set(edgeKey(a, b), [a, b]);
    addUndirectedNeighbor(a, b);
    addUndirectedNeighbor(b, a);
    let list = outgoing.get(a);
    if (!list) {
      list = [];
      outgoing.set(a, list);
    }
    list.push(edge);
  }
  if (!boundaryEdges.length) return 0;

  for (const list of outgoing.values()) {
    list.sort((a, b) => a.b - b.b);
  }

  const used = new Set();
  const loops = [];
  for (const seed of boundaryEdges) {
    if (used.has(seed.key)) continue;
    const loop = [seed.a];
    let current = seed;
    let guard = 0;
    while (current && !used.has(current.key) && guard++ < boundaryEdges.length + 1) {
      used.add(current.key);
      loop.push(current.b);
      if (current.b === loop[0]) break;
      const next = (outgoing.get(current.b) || []).find((edge) => !used.has(edge.key));
      current = next || null;
    }
    if (loop.length >= 4 && loop[0] === loop[loop.length - 1]) {
      loops.push(loop.slice(0, -1));
    }
  }

  const loopSignature = (loop) => {
    if (!Array.isArray(loop) || !loop.length) return '';
    const variants = [];
    const addVariants = (source) => {
      for (let offset = 0; offset < source.length; offset++) {
        const rotated = [];
        for (let i = 0; i < source.length; i++) rotated.push(source[(offset + i) % source.length]);
        variants.push(rotated.join('|'));
      }
    };
    addVariants(loop);
    if (loop.length > 1) {
      addVariants(loop.slice().reverse());
    }
    return variants.sort()[0] || '';
  };

  const traceBoundaryGraphLoops = (componentEdges, componentAdjacency) => {
    const vertices = Array.from(componentAdjacency.keys());
    if (vertices.length < 3 || componentEdges.length < 3) return [];

    const pointFor = (index) => [
      Number(vp[(index * 3) + 0]) || 0,
      Number(vp[(index * 3) + 1]) || 0,
      Number(vp[(index * 3) + 2]) || 0,
    ];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    const cross = (a, b) => [
      (a[1] * b[2]) - (a[2] * b[1]),
      (a[2] * b[0]) - (a[0] * b[2]),
      (a[0] * b[1]) - (a[1] * b[0]),
    ];
    const length = (a) => Math.hypot(a[0], a[1], a[2]);
    const scaleVec = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

    const centroid = [0, 0, 0];
    const points = new Map();
    for (const vertex of vertices) {
      const point = pointFor(vertex);
      points.set(vertex, point);
      centroid[0] += point[0];
      centroid[1] += point[1];
      centroid[2] += point[2];
    }
    centroid[0] /= vertices.length;
    centroid[1] /= vertices.length;
    centroid[2] /= vertices.length;

    let u = null;
    let maxDist = -Infinity;
    for (const point of points.values()) {
      const vector = sub(point, centroid);
      const dist = length(vector);
      if (dist > maxDist) {
        maxDist = dist;
        u = vector;
      }
    }
    if (!u || !(maxDist > TRI_EPS)) return [];
    u = scaleVec(u, 1 / maxDist);

    let normal = null;
    let maxNormalLength = -Infinity;
    for (const point of points.values()) {
      const candidate = cross(u, sub(point, centroid));
      const candidateLength = length(candidate);
      if (candidateLength > maxNormalLength) {
        maxNormalLength = candidateLength;
        normal = candidate;
      }
    }
    if (!normal || !(maxNormalLength > TRI_EPS)) return [];
    normal = scaleVec(normal, 1 / maxNormalLength);
    const vAxis = cross(normal, u);
    const vLength = length(vAxis);
    if (!(vLength > TRI_EPS)) return [];
    const v = scaleVec(vAxis, 1 / vLength);

    const projected = new Map();
    for (const [vertex, point] of points.entries()) {
      const relative = sub(point, centroid);
      projected.set(vertex, [dot(relative, u), dot(relative, v)]);
    }

    const sortedAdjacency = new Map();
    for (const [vertex, neighbors] of componentAdjacency.entries()) {
      const p = projected.get(vertex);
      sortedAdjacency.set(vertex, neighbors.slice().sort((a, b) => {
        const pa = projected.get(a);
        const pb = projected.get(b);
        return Math.atan2(pa[1] - p[1], pa[0] - p[0])
          - Math.atan2(pb[1] - p[1], pb[0] - p[0]);
      }));
    }

    const area2D = (loop) => {
      let area = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = projected.get(loop[i]);
        const b = projected.get(loop[(i + 1) % loop.length]);
        area += (a[0] * b[1]) - (b[0] * a[1]);
      }
      return area * 0.5;
    };

    const directedVisited = new Set();
    const directedKey = (a, b) => `${a}>${b}`;
    const candidateLoops = [];
    for (const [a, b] of componentEdges) {
      for (const start of [[a, b], [b, a]]) {
        let from = start[0];
        let to = start[1];
        const startKey = directedKey(from, to);
        if (directedVisited.has(startKey)) continue;
        const loop = [];
        let closed = false;
        let guard = 0;
        const guardMax = Math.max(12, componentEdges.length * 4);
        while (!directedVisited.has(directedKey(from, to)) && guard++ < guardMax) {
          directedVisited.add(directedKey(from, to));
          loop.push(from);
          const neighbors = sortedAdjacency.get(to) || [];
          const incoming = neighbors.indexOf(from);
          if (incoming < 0 || neighbors.length === 0) break;
          const next = neighbors[(incoming - 1 + neighbors.length) % neighbors.length];
          from = to;
          to = next;
          if (directedKey(from, to) === startKey) {
            closed = true;
            break;
          }
        }
        if (!closed || loop.length < 3) continue;
        const area = area2D(loop);
        if (Math.abs(area) <= TRI_EPS) continue;
        candidateLoops.push({ loop, area });
      }
    }

    const positive = candidateLoops.filter((entry) => entry.area > TRI_EPS);
    const selected = positive.length ? positive : candidateLoops.filter((entry) => entry.area < -TRI_EPS);
    const tracedLoops = selected.map((entry) => (entry.area > 0 ? entry.loop : entry.loop.slice().reverse()));
    if (tracedLoops.length || componentEdges.length > 64) return tracedLoops;

    const cycleSignatures = new Set();
    const simpleCycles = [];
    const verticesSorted = vertices.slice().sort((a, b) => a - b);
    const canonicalCycleKey = (cycle) => {
      if (!cycle.length) return '';
      const variants = [];
      const add = (source) => {
        for (let offset = 0; offset < source.length; offset++) {
          const rotated = [];
          for (let i = 0; i < source.length; i++) rotated.push(source[(offset + i) % source.length]);
          variants.push(rotated.join('|'));
        }
      };
      add(cycle);
      add(cycle.slice().reverse());
      return variants.sort()[0] || '';
    };
    for (const start of verticesSorted) {
      const stack = [{ current: start, path: [start], visited: new Set([start]) }];
      let dfsSteps = 0;
      while (stack.length && dfsSteps++ < 5000 && simpleCycles.length < componentEdges.length * 2) {
        const state = stack.pop();
        if (state.path.length > componentEdges.length) continue;
        const neighbors = (componentAdjacency.get(state.current) || []).slice().sort((a, b) => a - b);
        for (const neighbor of neighbors) {
          if (neighbor === start && state.path.length >= 3) {
            const key = canonicalCycleKey(state.path);
            if (key && !cycleSignatures.has(key)) {
              cycleSignatures.add(key);
              simpleCycles.push(state.path.slice());
            }
            continue;
          }
          if (neighbor < start || state.visited.has(neighbor)) continue;
          const nextVisited = new Set(state.visited);
          nextVisited.add(neighbor);
          stack.push({ current: neighbor, path: state.path.concat(neighbor), visited: nextVisited });
        }
      }
    }
    simpleCycles.sort((a, b) => a.length - b.length);
    const usedCycleEdges = new Set();
    const edgeDisjointCycles = [];
    for (const cycle of simpleCycles) {
      const cycleEdges = [];
      let overlaps = false;
      for (let i = 0; i < cycle.length; i++) {
        const key = edgeKey(cycle[i], cycle[(i + 1) % cycle.length]);
        cycleEdges.push(key);
        if (usedCycleEdges.has(key)) overlaps = true;
      }
      if (overlaps) continue;
      for (const key of cycleEdges) usedCycleEdges.add(key);
      edgeDisjointCycles.push(cycle);
    }
    return edgeDisjointCycles.slice(0, componentEdges.length);
  };

  const loopSignatures = new Set(loops.map(loopSignature));
  const undirectedVisited = new Set();
  const edgeFans = [];
  for (const edge of boundaryEdges) {
    const seedKey = edgeKey(edge.a, edge.b);
    if (undirectedVisited.has(seedKey)) continue;
    const componentEdges = [];
    const stack = [[edge.a, edge.b]];
    undirectedVisited.add(seedKey);
    while (stack.length) {
      const [a, b] = stack.pop();
      componentEdges.push([a, b]);
      for (const vertex of [a, b]) {
        for (const neighbor of undirectedAdjacency.get(vertex) || []) {
          const key = edgeKey(vertex, neighbor);
          if (undirectedVisited.has(key)) continue;
          undirectedVisited.add(key);
          stack.push([vertex, neighbor]);
        }
      }
    }
    if (componentEdges.length < 3) continue;

    const componentAdjacency = new Map();
    const addComponentNeighbor = (a, b) => {
      let list = componentAdjacency.get(a);
      if (!list) {
        list = [];
        componentAdjacency.set(a, list);
      }
      if (!list.includes(b)) list.push(b);
    };
    for (const [a, b] of componentEdges) {
      addComponentNeighbor(a, b);
      addComponentNeighbor(b, a);
    }
    if (!Array.from(componentAdjacency.values()).every((neighbors) => neighbors.length === 2)) {
      let addedGraphLoop = false;
      for (const loop of traceBoundaryGraphLoops(componentEdges, componentAdjacency)) {
        const signature = loopSignature(loop);
        if (!signature || loopSignatures.has(signature)) continue;
        loopSignatures.add(signature);
        loops.push(loop);
        addedGraphLoop = true;
      }
      if (!addedGraphLoop) edgeFans.push(componentEdges);
      continue;
    }

    const start = Math.min(...Array.from(componentAdjacency.keys()));
    const firstNeighbors = (componentAdjacency.get(start) || []).slice().sort((a, b) => a - b);
    if (firstNeighbors.length !== 2) {
      edgeFans.push(componentEdges);
      continue;
    }
    const ordered = [start];
    let previous = -1;
    let current = start;
    let next = firstNeighbors[0];
    let closed = false;
    let guard = 0;
    while (guard++ < componentEdges.length + 2) {
      ordered.push(next);
      previous = current;
      current = next;
      if (current === start) {
        closed = true;
        break;
      }
      const candidates = (componentAdjacency.get(current) || []).filter((neighbor) => neighbor !== previous);
      if (candidates.length !== 1) break;
      next = candidates[0];
    }
    if (!closed || ordered.length < 4) {
      edgeFans.push(componentEdges);
      continue;
    }
    const loop = ordered.slice(0, -1);
    if (loop.length !== componentEdges.length) {
      edgeFans.push(componentEdges);
      continue;
    }
    const signature = loopSignature(loop);
    if (!signature || loopSignatures.has(signature)) continue;
    loopSignatures.add(signature);
    loops.push(loop);
  }

  // Only closed boundary loops can be capped without inventing topology. Open
  // or branching boundary components indicate the split arrangement is not yet
  // conforming and should be handled by another split/cull repair pass.
  edgeFans.length = 0;

  if (!loops.length && !edgeFans.length) return 0;

  const triangulateLoop = (loop) => {
    if (!Array.isArray(loop) || loop.length < 3) return [];
    const points = loop.map((index) => [
      Number(vp[(index * 3) + 0]) || 0,
      Number(vp[(index * 3) + 1]) || 0,
      Number(vp[(index * 3) + 2]) || 0,
    ]);
    const centroid = [0, 0, 0];
    for (const point of points) {
      centroid[0] += point[0];
      centroid[1] += point[1];
      centroid[2] += point[2];
    }
    centroid[0] /= points.length;
    centroid[1] /= points.length;
    centroid[2] /= points.length;

    let normal = [0, 0, 0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
      normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
      normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    let normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(normalLength > TRI_EPS)) {
      let bestLength = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const c = points[(i + 2) % points.length];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const candidate = [
          (ab[1] * ac[2]) - (ab[2] * ac[1]),
          (ab[2] * ac[0]) - (ab[0] * ac[2]),
          (ab[0] * ac[1]) - (ab[1] * ac[0]),
        ];
        const length = Math.hypot(candidate[0], candidate[1], candidate[2]);
        if (length > bestLength) {
          bestLength = length;
          normal = candidate;
        }
      }
      normalLength = bestLength;
    }
    if (!(normalLength > TRI_EPS)) return [];
    normal = normal.map((value) => value / normalLength);

    let u = null;
    let maxDistance = 0;
    for (const point of points) {
      const candidate = [
        point[0] - centroid[0],
        point[1] - centroid[1],
        point[2] - centroid[2],
      ];
      const distance = Math.hypot(candidate[0], candidate[1], candidate[2]);
      if (distance > maxDistance) {
        maxDistance = distance;
        u = candidate;
      }
    }
    if (!u || !(maxDistance > TRI_EPS)) return [];
    u = u.map((value) => value / maxDistance);
    const v = [
      (normal[1] * u[2]) - (normal[2] * u[1]),
      (normal[2] * u[0]) - (normal[0] * u[2]),
      (normal[0] * u[1]) - (normal[1] * u[0]),
    ];
    const vLength = Math.hypot(v[0], v[1], v[2]);
    if (!(vLength > TRI_EPS)) return [];
    v[0] /= vLength;
    v[1] /= vLength;
    v[2] /= vLength;

    const projected = points.map((point) => {
      const r = [
        point[0] - centroid[0],
        point[1] - centroid[1],
        point[2] - centroid[2],
      ];
      return [
        (r[0] * u[0]) + (r[1] * u[1]) + (r[2] * u[2]),
        (r[0] * v[0]) + (r[1] * v[1]) + (r[2] * v[2]),
      ];
    });
    const area2D = (indices) => {
      let area = 0;
      for (let i = 0; i < indices.length; i++) {
        const a = projected[indices[i]];
        const b = projected[indices[(i + 1) % indices.length]];
        area += (a[0] * b[1]) - (b[0] * a[1]);
      }
      return area * 0.5;
    };
    const cross2D = (a, b, c) => {
      const pa = projected[a];
      const pb = projected[b];
      const pc = projected[c];
      return ((pb[0] - pa[0]) * (pc[1] - pb[1])) - ((pb[1] - pa[1]) * (pc[0] - pb[0]));
    };
    const pointInTri = (pIndex, aIndex, bIndex, cIndex) => {
      const p = projected[pIndex];
      const a = projected[aIndex];
      const b = projected[bIndex];
      const c = projected[cIndex];
      const area = Math.abs(((b[0] - a[0]) * (c[1] - a[1])) - ((b[1] - a[1]) * (c[0] - a[0])));
      if (!(area > TRI_EPS)) return false;
      const a0 = Math.abs(((a[0] - p[0]) * (b[1] - p[1])) - ((a[1] - p[1]) * (b[0] - p[0])));
      const a1 = Math.abs(((b[0] - p[0]) * (c[1] - p[1])) - ((b[1] - p[1]) * (c[0] - p[0])));
      const a2 = Math.abs(((c[0] - p[0]) * (a[1] - p[1])) - ((c[1] - p[1]) * (a[0] - p[0])));
      return Math.abs((a0 + a1 + a2) - area) <= Math.max(TRI_EPS, area * 1e-8);
    };

    const indices = Array.from({ length: loop.length }, (_, index) => index);
    if (area2D(indices) < 0) indices.reverse();
    const out = [];
    let guard = 0;
    while (indices.length > 3 && guard++ < loop.length * loop.length * 4) {
      let clipped = false;
      for (let i = 0; i < indices.length; i++) {
        const prev = indices[(i - 1 + indices.length) % indices.length];
        const current = indices[i];
        const next = indices[(i + 1) % indices.length];
        if (cross2D(prev, current, next) <= TRI_EPS) continue;
        let contains = false;
        for (const candidate of indices) {
          if (candidate === prev || candidate === current || candidate === next) continue;
          if (pointInTri(candidate, prev, current, next)) {
            contains = true;
            break;
          }
        }
        if (contains) continue;
        out.push([loop[prev], loop[current], loop[next]]);
        indices.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (indices.length === 3) {
      out.push([loop[indices[0]], loop[indices[1]], loop[indices[2]]]);
    }
    if (out.length) return out;
    const fallback = [];
    for (let i = 1; i + 1 < loop.length; i++) {
      fallback.push([loop[0], loop[i], loop[i + 1]]);
    }
    return fallback;
  };

  const addVertex = (point) => {
    const index = (solid._vertProperties.length / 3) | 0;
    solid._vertProperties.push(point[0], point[1], point[2]);
    solid._vertKeyToIndex?.set?.(`${point[0]},${point[1]},${point[2]}`, index);
    return index;
  };

  let added = 0;
  const capFaceID = Number(faceID) >>> 0;
  for (const loop of loops) {
    if (loop.length < 3) continue;
    let directedMatches = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const directed = directedBoundaryByEdge.get(edgeKey(a, b));
      if (directed && directed[0] === a && directed[1] === b) directedMatches += 1;
    }
    const reverseFan = directedMatches >= (loop.length / 2);
    for (const tri of triangulateLoop(loop)) {
      const a = tri[0] >>> 0;
      const b = tri[1] >>> 0;
      const c = tri[2] >>> 0;
      if (a === b || b === c || c === a) continue;
      if (reverseFan) solid._triVerts.push(c, b, a);
      else solid._triVerts.push(a, b, c);
      solid._triIDs.push(capFaceID);
      added += 1;
    }
  }

  for (const fanEdges of edgeFans) {
    const vertices = Array.from(new Set(fanEdges.flatMap(([a, b]) => [a, b])));
    if (vertices.length < 3) continue;
    const centroid = [0, 0, 0];
    for (const index of vertices) {
      centroid[0] += vp[(index * 3) + 0];
      centroid[1] += vp[(index * 3) + 1];
      centroid[2] += vp[(index * 3) + 2];
    }
    centroid[0] /= vertices.length;
    centroid[1] /= vertices.length;
    centroid[2] /= vertices.length;
    const centerIndex = addVertex(centroid);
    for (const [u, v] of fanEdges) {
      const directed = directedBoundaryByEdge.get(edgeKey(u, v)) || [u, v];
      const a = directed[0] >>> 0;
      const b = directed[1] >>> 0;
      if (a === b || a === centerIndex || b === centerIndex) continue;
      solid._triVerts.push(b, a, centerIndex);
      solid._triIDs.push(capFaceID);
      added += 1;
    }
  }

  if (added > 0) {
    solid._dirty = true;
    solid._faceIndex = null;
    solid._manifold = null;
    invalidateCppSolidCoreCache(solid);
  }
  return added;
}

function getOrCreateIntersectionCapFaceID(solid, sourceFaceName, distance) {
  const capLabel = `${sourceFaceName}_INTERSECTION_CAP`;
  let capFaceID = solid?._faceNameToID instanceof Map ? solid._faceNameToID.get(capLabel) : null;
  if (!capFaceID && typeof solid?._getOrCreateID === 'function') {
    capFaceID = solid._getOrCreateID(capLabel);
  }
  if (capFaceID && solid?._faceMetadata instanceof Map) {
    solid._faceMetadata.set(capLabel, {
      type: 'intersection_cap',
      sourceFaceName,
      distance,
    });
  }
  return capFaceID || null;
}

function reclassifyThickenCapTrianglesByGeometry(solid, surface, distance, classificationState, tolerance) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const sourceVertices = Array.isArray(surface?.vertices) ? surface.vertices : [];
  const sourceNormals = Array.isArray(surface?.vertexNormals) ? surface.vertexNormals : [];
  const sourceTriangles = Array.isArray(surface?.triangles) ? surface.triangles : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || ids.length < triCount || !sourceVertices.length || !sourceTriangles.length) return 0;

  const fallbackStartFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.start)) >>> 0;
  const fallbackEndFaceID = Number(classificationState?.faceNameToID?.get?.(classificationState?.labels?.end)) >>> 0;
  if (!fallbackStartFaceID || !fallbackEndFaceID) return 0;

  const offsetVertices = sourceVertices.map((point, index) => {
    const normal = sourceNormals[index];
    return point && normal
      ? point.clone().add(normal.clone().multiplyScalar(distance))
      : null;
  });
  const sourceTriRefsByFaceID = new Map();
  const offsetTriRefsByFaceID = new Map();
  const addRef = (map, faceID, refs) => {
    const id = Number(faceID) >>> 0;
    if (!id || !Array.isArray(refs)) return;
    let list = map.get(id);
    if (!list) {
      list = [];
      map.set(id, list);
    }
    list.push(refs);
  };
  for (const tri of sourceTriangles) {
    const a = tri?.[0] >>> 0;
    const b = tri?.[1] >>> 0;
    const c = tri?.[2] >>> 0;
    if (!sourceVertices[a] || !sourceVertices[b] || !sourceVertices[c]) continue;
    const startFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'start') || fallbackStartFaceID;
    const endFaceID = resolveCapFaceIDForTriangle(classificationState, tri, 'end') || fallbackEndFaceID;
    addRef(sourceTriRefsByFaceID, startFaceID, [sourceVertices[a], sourceVertices[b], sourceVertices[c]]);
    if (offsetVertices[a] && offsetVertices[b] && offsetVertices[c]) {
      addRef(offsetTriRefsByFaceID, endFaceID, [offsetVertices[a], offsetVertices[b], offsetVertices[c]]);
    }
  }
  if (!sourceTriRefsByFaceID.size || !offsetTriRefsByFaceID.size) return 0;

  const tol = Math.max(Number(tolerance) || 0, 1e-7);
  const toleranceSq = tol * tol;
  const point = new THREE.Vector3();
  const pointDistanceToSurfaceSq = (p, refs) => {
    let best = Infinity;
    for (const [a, b, c] of refs) {
      const distSq = pointToTriangleDistanceSq(p, a, b, c);
      if (distSq < best) {
        best = distSq;
        if (best <= toleranceSq) break;
      }
    }
    return best;
  };
  const triangleMaxDistanceSq = (triIndex, refs) => {
    let maxDistanceSq = 0;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = tv[(triIndex * 3) + corner] >>> 0;
      const base = vertex * 3;
      point.set(
        Number(vp[base + 0]) || 0,
        Number(vp[base + 1]) || 0,
        Number(vp[base + 2]) || 0,
      );
      const distSq = pointDistanceToSurfaceSq(point, refs);
      if (distSq > maxDistanceSq) maxDistanceSq = distSq;
      if (maxDistanceSq > toleranceSq) break;
    }
    return maxDistanceSq;
  };
  const bestFaceIDForTriangle = (triIndex, refsByFaceID) => {
    let bestFaceID = 0;
    let bestDistanceSq = Infinity;
    for (const [faceID, refs] of refsByFaceID.entries()) {
      const distanceSq = triangleMaxDistanceSq(triIndex, refs);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestFaceID = Number(faceID) >>> 0;
        if (bestDistanceSq <= toleranceSq) break;
      }
    }
    return { faceID: bestFaceID, distanceSq: bestDistanceSq };
  };

  let changed = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const startMatch = bestFaceIDForTriangle(triIndex, sourceTriRefsByFaceID);
    const endMatch = startMatch.distanceSq <= toleranceSq
      ? { faceID: 0, distanceSq: Infinity }
      : bestFaceIDForTriangle(triIndex, offsetTriRefsByFaceID);
    const nextID = startMatch.distanceSq <= toleranceSq
      ? startMatch.faceID
      : (endMatch.distanceSq <= toleranceSq ? endMatch.faceID : 0);
    if (nextID && ids[triIndex] !== nextID) {
      ids[triIndex] = nextID;
      changed += 1;
    }
  }

  if (changed > 0) {
    solid._dirty = true;
    solid._faceIndex = null;
    solid._manifold = null;
  }
  return changed;
}

function fillIntersectionCapBoundaryLoops(solid, sourceFaceName, distance) {
  const capFaceID = getOrCreateIntersectionCapFaceID(solid, sourceFaceName, distance);
  if (!capFaceID) return 0;
  return fillBoundaryLoopsWithTriangles(solid, capFaceID);
}

function cullTrianglesTouchingNonManifoldEdges(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || ids.length < triCount) return 0;

  const edgeToTris = new Map();
  const addUse = (a, b, triIndex) => {
    const key = edgeKey(a, b);
    let list = edgeToTris.get(key);
    if (!list) {
      list = [];
      edgeToTris.set(key, list);
    }
    list.push(triIndex);
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    addUse(a, b, triIndex);
    addUse(b, c, triIndex);
    addUse(c, a, triIndex);
  }

  const removeTri = new Uint8Array(triCount);
  for (const list of edgeToTris.values()) {
    if (list.length <= 2) continue;
    for (const triIndex of list) removeTri[triIndex] = 1;
  }

  let removed = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (removeTri[triIndex]) removed += 1;
  }
  if (!removed) return 0;

  const vertexCount = (vp.length / 3) | 0;
  const usedVert = new Uint8Array(vertexCount);
  const newTriVerts = [];
  const newTriIDs = [];
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (removeTri[triIndex]) continue;
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    newTriVerts.push(a, b, c);
    newTriIDs.push(ids[triIndex]);
    usedVert[a] = 1;
    usedVert[b] = 1;
    usedVert[c] = 1;
  }

  const oldToNew = new Int32Array(vertexCount);
  oldToNew.fill(-1);
  const newVertProperties = [];
  let nextVertex = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (!usedVert[i]) continue;
    oldToNew[i] = nextVertex++;
    newVertProperties.push(vp[(i * 3) + 0], vp[(i * 3) + 1], vp[(i * 3) + 2]);
  }
  for (let i = 0; i < newTriVerts.length; i++) {
    newTriVerts[i] = oldToNew[newTriVerts[i] >>> 0];
  }

  solid._vertProperties = newVertProperties;
  solid._triVerts = newTriVerts;
  solid._triIDs = newTriIDs;
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < newVertProperties.length; i += 3) {
    solid._vertKeyToIndex.set(
      `${newVertProperties[i]},${newVertProperties[i + 1]},${newVertProperties[i + 2]}`,
      (i / 3) | 0,
    );
  }
  solid._dirty = true;
  solid._faceIndex = null;
  solid._manifold = null;
  invalidateCppSolidCoreCache(solid);
  return removed;
}

function cullTrianglesTouchingSameDirectionEdges(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const triCount = (tv.length / 3) | 0;
  if (!triCount || ids.length < triCount) return 0;

  const edgeToUses = new Map();
  const addUse = (a, b, triIndex) => {
    const key = edgeKey(a, b);
    let list = edgeToUses.get(key);
    if (!list) {
      list = [];
      edgeToUses.set(key, list);
    }
    list.push({ triIndex, a, b });
  };
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    addUse(a, b, triIndex);
    addUse(b, c, triIndex);
    addUse(c, a, triIndex);
  }

  const sameByTri = new Uint16Array(triCount);
  for (const uses of edgeToUses.values()) {
    if (uses.length !== 2) continue;
    if (!(uses[0].a === uses[1].a && uses[0].b === uses[1].b)) continue;
    sameByTri[uses[0].triIndex] += 1;
    sameByTri[uses[1].triIndex] += 1;
  }

  let bestTriIndex = -1;
  let bestScore = 0;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const sameCount = sameByTri[triIndex] || 0;
    if (!sameCount) continue;
    const faceName = solid._idToFaceName instanceof Map ? String(solid._idToFaceName.get(ids[triIndex]) || '') : '';
    const capBonus = faceName.includes('INTERSECTION_CAP') ? 100 : 0;
    const score = sameCount + capBonus;
    if (score > bestScore) {
      bestScore = score;
      bestTriIndex = triIndex;
    }
  }
  if (bestTriIndex < 0) return 0;

  const vertexCount = (vp.length / 3) | 0;
  const usedVert = new Uint8Array(vertexCount);
  const newTriVerts = [];
  const newTriIDs = [];
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (triIndex === bestTriIndex) continue;
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    newTriVerts.push(a, b, c);
    newTriIDs.push(ids[triIndex]);
    usedVert[a] = 1;
    usedVert[b] = 1;
    usedVert[c] = 1;
  }

  const oldToNew = new Int32Array(vertexCount);
  oldToNew.fill(-1);
  const newVertProperties = [];
  let nextVertex = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (!usedVert[i]) continue;
    oldToNew[i] = nextVertex++;
    newVertProperties.push(vp[(i * 3) + 0], vp[(i * 3) + 1], vp[(i * 3) + 2]);
  }
  for (let i = 0; i < newTriVerts.length; i++) {
    newTriVerts[i] = oldToNew[newTriVerts[i] >>> 0];
  }

  solid._vertProperties = newVertProperties;
  solid._triVerts = newTriVerts;
  solid._triIDs = newTriIDs;
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < newVertProperties.length; i += 3) {
    solid._vertKeyToIndex.set(
      `${newVertProperties[i]},${newVertProperties[i + 1]},${newVertProperties[i + 2]}`,
      (i / 3) | 0,
    );
  }
  solid._dirty = true;
  solid._faceIndex = null;
  solid._manifold = null;
  invalidateCppSolidCoreCache(solid);
  return 1;
}

function repairSolidOrientationByCullAndCap(solid, context = {}) {
  const sourceFaceName = String(context.sourceFaceName || '').trim() || 'FACE';
  const dist = Number(context.distance) || 0;
  const manifoldWeldEpsilon = Math.max(Number(context.manifoldWeldEpsilon) || 0, 0);
  const nonManifoldCullMaxTriangles = Math.max(
    0,
    Number.isFinite(Number(context.nonManifoldCullMaxTriangles))
      ? Number(context.nonManifoldCullMaxTriangles)
      : 10000,
  );
  const maxPasses = Math.max(
    1,
    Math.min(512, Number.isFinite(Number(context.maxPasses)) ? Number(context.maxPasses) | 0 : 256),
  );
  const stats = {
    orientedTriangleCount: 0,
    orientationCulledTriangleCount: 0,
    orientationCapTriangleCount: 0,
    nonManifoldCulledTriangleCount: 0,
    boundaryCapTriangleCount: 0,
    weldedVertexCount: 0,
    degenerateTriangleCount: 0,
  };
  const isCoherent = () => {
    try {
      return typeof solid?._isCoherentlyOrientedManifold === 'function'
        ? solid._isCoherentlyOrientedManifold() === true
        : true;
    } catch {
      return false;
    }
  };
  const weld = () => {
    const welded = weldSolidVerticesByPosition(solid, manifoldWeldEpsilon);
    stats.weldedVertexCount += welded.weldedVertexCount || 0;
    stats.degenerateTriangleCount += welded.removedTriangleCount || 0;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    let topology = analyzeMeshTopology(solid);
    let changed = false;

    if (
      topology.nonManifoldEdgeCount > 0
      && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles
    ) {
      const removedThisPass = cullTrianglesTouchingNonManifoldEdges(solid);
      if (removedThisPass > 0) {
        stats.nonManifoldCulledTriangleCount += removedThisPass;
        changed = true;
        weld();
        topology = analyzeMeshTopology(solid);
      }
    }

    if (topology.boundaryEdgeCount > 0) {
      const addedThisPass = fillIntersectionCapBoundaryLoops(solid, sourceFaceName, dist);
      if (addedThisPass > 0) {
        stats.boundaryCapTriangleCount += addedThisPass;
        stats.orientationCapTriangleCount += addedThisPass;
        changed = true;
        try { solid.fixTriangleWindingsByAdjacency?.(); } catch { /* keep authored winding */ }
        weld();
        topology = analyzeMeshTopology(solid);
      }
    }

    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
      if (!changed) {
        return { ok: false, topology, orientation: analyzeTriangleOrientation(solid), stats };
      }
      continue;
    }

    const orientedThisPass =
      orientSolidTrianglesByAdjacency(solid)
      + orientSolidComponentsBySignedVolume(solid);
    if (orientedThisPass > 0) {
      stats.orientedTriangleCount += orientedThisPass;
      try { solid.fixTriangleWindingsByAdjacency?.(); } catch { /* keep JS orientation */ }
    }

    if (isCoherent()) {
      return { ok: true, topology: analyzeMeshTopology(solid), orientation: analyzeTriangleOrientation(solid), stats };
    }

    const removedSameDirection = cullTrianglesTouchingSameDirectionEdges(solid);
    if (!(removedSameDirection > 0)) {
      return { ok: false, topology, orientation: analyzeTriangleOrientation(solid), stats };
    }
    stats.orientationCulledTriangleCount += removedSameDirection;
    changed = true;
    weld();
    if (!changed) break;
  }

  const topology = analyzeMeshTopology(solid);
  return {
    ok: topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0 && isCoherent(),
    topology,
    orientation: analyzeTriangleOrientation(solid),
    stats,
  };
}

function tryRepairCoherentOrientationCandidate(solid, context = {}) {
  if (!solid || typeof solid.clone !== 'function') return null;
  let candidate = null;
  try {
    candidate = solid.clone();
    try { candidate.name = solid.name; } catch { /* ignore */ }
    const result = repairSolidOrientationByCullAndCap(candidate, context);
    const topology = result?.topology || analyzeMeshTopology(candidate);
    const coherent = (() => {
      try {
        return typeof candidate._isCoherentlyOrientedManifold === 'function'
          ? candidate._isCoherentlyOrientedManifold() === true
          : true;
      } catch {
        return false;
      }
    })();
    if (
      result?.ok === true
      && topology.boundaryEdgeCount === 0
      && topology.nonManifoldEdgeCount === 0
      && coherent
    ) {
      return { solid: candidate, topology, stats: result.stats || {} };
    }
  } catch {
    /* fall through and reject the candidate */
  }
  try { candidate?.free?.(); } catch { /* ignore */ }
  return null;
}

function pruneOverusedTriangles(solid) {
  let removedTotal = 0;

  const rebuildWithout = (removeTri) => {
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const currentVP = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
    const currentIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
    const triCount = (tv.length / 3) | 0;
    const vertexCount = (currentVP.length / 3) | 0;
    const usedVert = new Uint8Array(vertexCount);
    const newTriVerts = [];
    const newTriIDs = [];
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      if (removeTri[triIndex]) continue;
      const a = tv[(triIndex * 3) + 0] >>> 0;
      const b = tv[(triIndex * 3) + 1] >>> 0;
      const c = tv[(triIndex * 3) + 2] >>> 0;
      newTriVerts.push(a, b, c);
      newTriIDs.push(currentIDs[triIndex]);
      usedVert[a] = 1;
      usedVert[b] = 1;
      usedVert[c] = 1;
    }
    const oldToNew = new Int32Array(vertexCount);
    oldToNew.fill(-1);
    const newVertProperties = [];
    let nextVertex = 0;
    for (let i = 0; i < vertexCount; i++) {
      if (!usedVert[i]) continue;
      oldToNew[i] = nextVertex++;
      newVertProperties.push(currentVP[(i * 3) + 0], currentVP[(i * 3) + 1], currentVP[(i * 3) + 2]);
    }
    for (let i = 0; i < newTriVerts.length; i++) {
      newTriVerts[i] = oldToNew[newTriVerts[i] >>> 0];
    }
    solid._vertProperties = newVertProperties;
    solid._triVerts = newTriVerts;
    solid._triIDs = newTriIDs;
    solid._vertKeyToIndex = new Map();
    for (let i = 0; i < newVertProperties.length; i += 3) {
      solid._vertKeyToIndex.set(
        `${newVertProperties[i]},${newVertProperties[i + 1]},${newVertProperties[i + 2]}`,
        (i / 3) | 0,
      );
    }
    solid._dirty = true;
    solid._faceIndex = null;
    solid._manifold = null;
    invalidateCppSolidCoreCache(solid);
  };

  for (let pass = 0; pass < 256; pass++) {
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
    const triCount = (tv.length / 3) | 0;
    if (!triCount || ids.length < triCount) break;
    const edgeCounts = new Map();
    const triEdges = [];
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const a = tv[(triIndex * 3) + 0] >>> 0;
      const b = tv[(triIndex * 3) + 1] >>> 0;
      const c = tv[(triIndex * 3) + 2] >>> 0;
      const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
      triEdges.push(edges);
      for (const key of edges) edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
    let overusedCount = 0;
    for (const count of edgeCounts.values()) {
      if (count > 2) overusedCount += 1;
    }
    if (!overusedCount) break;

    let best = null;
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const edges = triEdges[triIndex];
      if (edges.some((key) => (edgeCounts.get(key) || 0) <= 1)) continue;
      let score = 0;
      for (const key of edges) score += Math.max(0, (edgeCounts.get(key) || 0) - 2);
      if (!(score > 0)) continue;
      const faceName = solid._idToFaceName instanceof Map ? String(solid._idToFaceName.get(ids[triIndex]) || '') : '';
      const capBonus = faceName.includes('INTERSECTION_CAP') ? 1000 : 0;
      const candidate = { triIndex, score: score + capBonus };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (!best) break;
    const removeTri = new Uint8Array(triCount);
    removeTri[best.triIndex] = 1;
    rebuildWithout(removeTri);
    removedTotal += 1;
  }

  return removedTotal;
}

function triangleSplitCullSolid(solid, options = {}) {
  if (!solid) return null;
  const maxPasses = Math.max(
    1,
    Math.min(8, Number.isFinite(Number(options.triangleCullPasses))
      ? Number(options.triangleCullPasses) | 0
      : 1),
  );
  const splitOptions = {
    snapTolerance: options.splitSnapTolerance ?? options.snapTolerance,
    diagnostics: options.splitDiagnostics === true || options.diagnostics === true,
  };
  if (!Number.isFinite(Number(splitOptions.snapTolerance)) || Number(splitOptions.snapTolerance) <= 0) {
    delete splitOptions.snapTolerance;
  }

  let splitCount = 0;
  let culledTriangleCount = 0;
  let degenerateTriangleCount = 0;
  let weldedVertexCount = 0;
  let passCount = 0;
  const weldTolerance = Math.max(
    Number(options.weldTolerance ?? options.manifoldWeldTolerance) || 0,
    0,
  );
  for (let pass = 0; pass < maxPasses; pass++) {
    passCount = pass + 1;
    const precomputedSplitProbeCount = Number(options.precomputedTriangleSplitProbeCount);
    const splitThisPass = options.skipTriangleSplit === true
      ? (pass === 0
        ? (Number.isFinite(precomputedSplitProbeCount) && precomputedSplitProbeCount >= 0
          ? precomputedSplitProbeCount
          : Number(solid.splitSelfIntersectingTriangles?.({
            ...splitOptions,
            probeOnly: true,
            maxIntersections: 1,
          }) || 0))
        : 0)
      : Number(solid.splitSelfIntersectingTriangles?.(splitOptions) || 0);
    if (splitThisPass > 0 && options.skipTriangleSplit !== true) invalidateCppSolidCoreCache(solid);
    splitCount += splitThisPass;
    const degenerateAfterSplit = Number(solid.removeDegenerateTriangles?.() || 0);
    if (degenerateAfterSplit > 0) invalidateCppSolidCoreCache(solid);
    degenerateTriangleCount += degenerateAfterSplit;
    const weldAfterSplit = weldSolidVerticesByPosition(solid, weldTolerance);
    weldedVertexCount += weldAfterSplit.weldedVertexCount || 0;
    degenerateTriangleCount += weldAfterSplit.removedTriangleCount || 0;
    const currentTriCount = ((solid?._triVerts?.length || 0) / 3) | 0;
    const windingCullMaxTriangles = Math.max(
      0,
      Number.isFinite(Number(options.windingCullMaxTriangles))
        ? Number(options.windingCullMaxTriangles)
        : 10000,
    );
    const defaultCullMethod = currentTriCount > 0 && currentTriCount <= windingCullMaxTriangles
      ? 'winding'
      : 'raycast';
    const cullMethod = String(options.internalCullMethod || defaultCullMethod).toLowerCase();
    const culledThisPass = options.skipInternalCull === true
      ? 0
      : cullMethod === 'winding'
      ? Number(solid.removeInternalTrianglesByWinding?.(options.windingOptions || {}) || 0)
      : Number(cullInternalTrianglesByIndexedRaycast(solid, options.raycastCullOptions || {}) || 0);
    if (culledThisPass > 0) invalidateCppSolidCoreCache(solid);
    culledTriangleCount += culledThisPass;
    const degenerateAfterCull = Number(solid.removeDegenerateTriangles?.() || 0);
    if (degenerateAfterCull > 0) invalidateCppSolidCoreCache(solid);
    degenerateTriangleCount += degenerateAfterCull;
    const weldAfterCull = weldSolidVerticesByPosition(solid, weldTolerance);
    weldedVertexCount += weldAfterCull.weldedVertexCount || 0;
    degenerateTriangleCount += weldAfterCull.removedTriangleCount || 0;
    if (splitThisPass === 0 && culledThisPass === 0) break;
  }
  try { solid.fixTriangleWindingsByAdjacency?.(); } catch { /* keep authored winding if native prep is unavailable */ }
  const topology = analyzeMeshTopology(solid);
  return {
    splitCount,
    culledTriangleCount,
    degenerateTriangleCount,
    weldedVertexCount,
    passCount,
    topology,
  };
}

function applySourceFaceMetadataToThickenResult(result, face, labels, sourceFaceName) {
  let sourceMetadata = null;
  try {
    sourceMetadata = typeof face?.getMetadata === 'function' ? (face.getMetadata() || null) : null;
  } catch {
    sourceMetadata = null;
  }
  if (!sourceMetadata || typeof result?.setFaceMetadata !== 'function') return;
  try {
    result.setFaceMetadata(labels.start, {
      ...sourceMetadata,
      type: 'start_cap',
      sourceFaceName,
      sourceFeatureId: face?.owningFeatureID ?? face?.parentSolid?.owningFeatureID ?? sourceMetadata?.sourceFeatureId ?? null,
    });
    result.setFaceMetadata(labels.end, {
      ...sourceMetadata,
      type: 'end_cap',
      sourceFaceName,
      sourceFeatureId: face?.owningFeatureID ?? face?.parentSolid?.owningFeatureID ?? sourceMetadata?.sourceFeatureId ?? null,
    });
  } catch {
    /* ignore metadata propagation errors */
  }
}

function shouldSkipArrangementSplitForSelfOverlappingSurface(surface, distance) {
  const dist = Number(distance);
  if (!(dist < 0)) return false;
  const vertices = Array.isArray(surface?.vertices) ? surface.vertices : [];
  const normals = Array.isArray(surface?.vertexNormals) ? surface.vertexNormals : [];
  if (vertices.length < 3 || normals.length < vertices.length) return false;

  const normalSum = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  let normalCount = 0;
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    const normal = normals[i];
    if (!vertex || !normal || !(normal.lengthSq?.() > TRI_EPS)) continue;
    centroid.add(vertex);
    normalSum.add(normal);
    normalCount += 1;
  }
  if (normalCount < 3) return false;
  centroid.multiplyScalar(1 / normalCount);

  const resultantNormalLength = normalSum.length() / normalCount;
  if (resultantNormalLength > 0.35) return false;

  let minPositiveSupport = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    const normal = normals[i];
    if (!vertex || !normal || !(normal.lengthSq?.() > TRI_EPS)) continue;
    const support = vertex.clone().sub(centroid).dot(normal);
    if (support > TRI_EPS && support < minPositiveSupport) {
      minPositiveSupport = support;
    }
  }
  if (!Number.isFinite(minPositiveSupport)) return false;
  return Math.abs(dist) >= minPositiveSupport * 0.95;
}

function shouldPreserveExactClosedOffsetShell(staged, surface, distance, options = {}, topology = null) {
  const dist = Number(distance);
  if (!(dist > 0)) return { skip: false, reason: '', splitProbeCount: 0 };
  if (!staged || typeof staged.splitSelfIntersectingTriangles !== 'function') {
    return { skip: false, reason: '', splitProbeCount: 0 };
  }

  const loops = Array.isArray(surface?.loops) ? surface.loops : [];
  if (!loops.length) return { skip: false, reason: '', splitProbeCount: 0 };

  const initialTopology = topology || analyzeMeshTopology(staged);
  if (initialTopology.boundaryEdgeCount || initialTopology.nonManifoldEdgeCount) {
    return { skip: false, reason: '', splitProbeCount: 0 };
  }

  try {
    if (
      typeof staged._isCoherentlyOrientedManifold === 'function'
      && staged._isCoherentlyOrientedManifold() !== true
    ) {
      return { skip: false, reason: '', splitProbeCount: 0 };
    }
  } catch {
    return { skip: false, reason: '', splitProbeCount: 0 };
  }

  const boundarySegmentCount = Math.max(
    Array.isArray(surface?.boundaryDirectedEdges) ? surface.boundaryDirectedEdges.length : 0,
    loops.reduce((sum, loop) => sum + (Array.isArray(loop?.edges) ? loop.edges.length : 0), 0),
  );
  const benignIntersectionLimit = Math.max(16, Math.min(512, boundarySegmentCount * 2 || 64));
  const splitOptions = {
    probeOnly: true,
    maxIntersections: benignIntersectionLimit + 1,
  };
  const snapTolerance = options.splitSnapTolerance ?? options.snapTolerance;
  if (Number.isFinite(Number(snapTolerance)) && Number(snapTolerance) > 0) {
    splitOptions.snapTolerance = Number(snapTolerance);
  }

  let probeSolid = null;
  let splitProbeCount = 0;
  try {
    probeSolid = typeof staged.clone === 'function' ? staged.clone() : null;
    splitProbeCount = probeSolid
      ? Number(probeSolid.splitSelfIntersectingTriangles(splitOptions) || 0)
      : Number(staged.splitSelfIntersectingTriangles({
        ...splitOptions,
        maxIntersections: 1,
      }) || 0);
  } finally {
    try { probeSolid?.free?.(); } catch { /* ignore */ }
  }
  if (splitProbeCount > benignIntersectionLimit) {
    return { skip: false, reason: '', splitProbeCount };
  }

  return {
    skip: true,
    reason: splitProbeCount > 0 ? 'preserve_exact_closed_shell' : 'closed_shell_without_intersections',
    splitProbeCount,
  };
}

function thickenSurfaceToSolid(surface, face, distance, options = {}) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || Math.abs(dist) <= EPS) {
    throw new Error('Face.thicken() requires a non-zero finite distance.');
  }
  if (!surface || !Array.isArray(surface.triangles) || !surface.triangles.length) {
    throw new Error('Face.thicken() requires a non-empty source triangle surface.');
  }

  const featureId = sanitizeToken(options.featureId || options.name || face?.name || 'THICKEN', 'THICKEN');
  const sourceFaceName = String(options.sourceFaceName || face?.userData?.faceName || face?.name || featureId).trim() || featureId;
  const sourceFaceNames = Array.isArray(options.sourceFaceNames)
    ? options.sourceFaceNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [sourceFaceName];
  const capSourceFaceNames = sourceFaceNames.length ? sourceFaceNames : [sourceFaceName];
  const capLabelsBySourceFaceName = new Map();
  for (const name of capSourceFaceNames) {
    const sourceName = String(name || '').trim();
    if (!sourceName || capLabelsBySourceFaceName.has(sourceName)) continue;
    capLabelsBySourceFaceName.set(sourceName, {
      start: `${sourceName}_START`,
      end: `${sourceName}_END`,
    });
  }
  const fallbackCapLabels = capLabelsBySourceFaceName.get(sourceFaceName)
    || capLabelsBySourceFaceName.values().next().value
    || { start: `${sourceFaceName}_START`, end: `${sourceFaceName}_END` };
  const loops = Array.isArray(surface.loops) ? surface.loops : [];
  const labels = {
    sourceFaceName,
    start: fallbackCapLabels.start,
    end: fallbackCapLabels.end,
    startCaps: Array.from(capLabelsBySourceFaceName.entries(), ([name, caps]) => ({
      label: caps.start,
      sourceFaceName: name,
    })),
    endCaps: Array.from(capLabelsBySourceFaceName.entries(), ([name, caps]) => ({
      label: caps.end,
      sourceFaceName: name,
    })),
    capLabelsBySourceFaceName,
    sidewalls: loops.flatMap((loop, loopIndex) => (Array.isArray(loop?.edges) ? loop.edges : []).map((edge, edgeIndex) => {
      const sourceEdgeName = String(edge?.sourceEdgeName || '').trim();
      const sourceEdgeToken = sourceEdgeName
        ? sanitizeToken(sourceEdgeName, `EDGE_${loopIndex}_${edgeIndex}`).replace(/_+$/g, '')
        : null;
      return {
        key: edge.key,
        loopIndex,
        edgeIndex,
        sourceEdgeName: sourceEdgeName || null,
        sourceEdgeKey: edge?.sourceEdgeKey || null,
        label: sourceEdgeToken
          ? `${sourceEdgeToken}_SW`
          : (loopIndex === 0
            ? `${sourceFaceName}_E${edgeIndex}_SW`
            : `${sourceFaceName}_L${loopIndex}_E${edgeIndex}_SW`),
      };
    })),
  };
  const classificationState = buildThickenClassificationState(labels, dist);
  const solidName = String(options.name || featureId).trim() || featureId;
  const manifoldWeldEpsilon = Math.max(
    Number(options.manifoldWeldTolerance) || 0,
    Math.max(surface.weldTolerance || 0, surface.scale * 1e-7, 1e-6),
  );
  const orientationRepairDistanceLimit = Math.max(
    0,
    Number.isFinite(Number(options.orientationRepairDistanceLimit))
      ? Number(options.orientationRepairDistanceLimit)
      : 2,
  );
  const useSmallThicknessOrientationRepair = Math.abs(dist) <= orientationRepairDistanceLimit;
  const useTrianglePrismUnion = options.trianglePrismUnion === true;
  const allowBoundaryRepairCaps = options.repairBoundaryCaps !== false;
  const sourceTriangleCount = Array.isArray(surface.triangles) ? surface.triangles.length : 0;

  let staged = null;
  try {
    const retryWithoutInternalCull = () => {
      if (options.__skipInternalCullRetry === true || options.skipInternalCull === true) return null;
      if (!useSmallThicknessOrientationRepair) return null;
      try { staged?.free?.(); } catch { /* ignore */ }
      staged = null;
      try {
        return thickenSurfaceToSolid(surface, face, dist, {
          ...options,
          skipInternalCull: true,
          __skipInternalCullRetry: true,
        });
      } catch {
        return null;
      }
    };
    const retryWithRelaxedWeld = () => {
      if (options.__relaxedWeldRetry === true) return null;
      if (!useSmallThicknessOrientationRepair) return null;
      const scaleRelativeWeld = Math.min(1e-4, Math.max(surface.scale * 1e-5, 1e-8));
      const relaxedWeldTolerance = Math.max(
        manifoldWeldEpsilon * 16,
        surface.scale * 1e-6,
        scaleRelativeWeld,
      );
      if (Number(options.manifoldWeldTolerance) >= relaxedWeldTolerance * 0.95) return null;
      try { staged?.free?.(); } catch { /* ignore */ }
      staged = null;
      try {
        return thickenSurfaceToSolid(surface, face, dist, {
          ...options,
          skipInternalCull: true,
          manifoldWeldTolerance: relaxedWeldTolerance,
          __relaxedWeldRetry: true,
        });
      } catch {
        return null;
      }
    };
    const retryWithRaycastMajority = () => {
      if (options.__raycastMajorityRetry === true) return null;
      try { staged?.free?.(); } catch { /* ignore */ }
      staged = null;
      return thickenSurfaceToSolid(surface, face, dist, {
        ...options,
        internalCullMethod: 'raycast',
        raycastCullOptions: {
          ...(options.raycastCullOptions || {}),
          axes: 'majority',
        },
        __raycastMajorityRetry: true,
      });
    };
    const retryWithoutTriangleSplit = () => {
      if (options.__skipTriangleSplitRetry === true || options.skipTriangleSplit === true) return null;
      try { staged?.free?.(); } catch { /* ignore */ }
      staged = null;
      try {
        return thickenSurfaceToSolid(surface, face, dist, {
          ...options,
          skipTriangleSplit: true,
          __skipTriangleSplitRetry: true,
        });
      } catch {
        return null;
      }
    };
    const retryWithTrianglePrismUnion = (reason = 'destructive_repair') => {
      if (options.__trianglePrismUnionRetry === true || useTrianglePrismUnion) return null;
      try { staged?.free?.(); } catch { /* ignore */ }
      staged = null;
      try {
        return thickenSurfaceToSolid(surface, face, dist, {
          ...options,
          trianglePrismUnion: true,
          repairBoundaryCaps: false,
          nonManifoldCullMaxTriangles: 0,
          __trianglePrismUnionRetry: true,
          __trianglePrismUnionReason: reason,
        });
      } catch {
        return null;
      }
    };
    const getBoundaryRepairFaceID = () => getOrCreateIntersectionCapFaceID(staged, sourceFaceName, dist);

    staged = useTrianglePrismUnion
      ? buildTrianglePrismUnionShellSolid(surface, dist, classificationState, solidName)
      : buildStitchedShellSolid(surface, dist, classificationState, solidName);
    if (!staged) {
      throw new Error('Face.thicken() failed to build the stitched triangle shell.');
    }

    let topology = analyzeMeshTopology(staged);
    const exactShellPreservation = (
      options.skipTriangleSplit !== true
      && options.skipTriangleSplit !== false
      && !useTrianglePrismUnion
    )
      ? shouldPreserveExactClosedOffsetShell(staged, surface, dist, options, topology)
      : { skip: false, reason: '', splitProbeCount: 0 };
    const skipSelfOverlapArrangement = (
      options.skipTriangleSplit !== false
      && shouldSkipArrangementSplitForSelfOverlappingSurface(surface, dist)
    );
    const skipArrangementSplit = options.skipTriangleSplit === true
      || exactShellPreservation.skip === true
      || skipSelfOverlapArrangement;
    const triangleSplitSkipReason = options.skipTriangleSplit === true
      ? 'option'
      : (exactShellPreservation.reason || (skipSelfOverlapArrangement ? 'self_overlap_surface' : ''));
    const cleanup = triangleSplitCullSolid(staged, {
      ...options,
      skipTriangleSplit: skipArrangementSplit,
      precomputedTriangleSplitProbeCount: exactShellPreservation.skip === true
        ? exactShellPreservation.splitProbeCount
        : undefined,
      weldTolerance: manifoldWeldEpsilon,
    });
    topology = cleanup?.topology || analyzeMeshTopology(staged);
    let boundaryCapTriangleCount = 0;
    let nonManifoldCulledTriangleCount = 0;
    const nonManifoldCullMaxTriangles = Math.max(
      0,
      Number.isFinite(Number(options.nonManifoldCullMaxTriangles))
        ? Number(options.nonManifoldCullMaxTriangles)
        : 10000,
    );
    for (let nonManifoldPass = 0; nonManifoldPass < 8; nonManifoldPass++) {
      if (!(topology.nonManifoldEdgeCount > 0 && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles)) break;
      const removedThisPass = cullTrianglesTouchingNonManifoldEdges(staged);
      if (!(removedThisPass > 0)) break;
      nonManifoldCulledTriangleCount += removedThisPass;
      const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
      cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
      cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
      topology = analyzeMeshTopology(staged);
    }
    if (topology.nonManifoldEdgeCount === 0 && topology.boundaryEdgeCount > 0) {
      try {
        staged.removeDegenerateTriangles?.();
        topology = analyzeMeshTopology(staged);
      } catch { /* ignore */ }
    }
    if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
      const capFaceID = getBoundaryRepairFaceID();
      if (capFaceID) {
        boundaryCapTriangleCount = fillBoundaryLoopsWithTriangles(staged, capFaceID);
        if (boundaryCapTriangleCount > 0) {
          try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
          const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
          cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
          cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
          topology = analyzeMeshTopology(staged);
        }
      }
    }
    for (let repairPass = 0; repairPass < 16; repairPass++) {
      let changed = false;
      if (topology.nonManifoldEdgeCount > 0 && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles) {
        const removedThisPass = cullTrianglesTouchingNonManifoldEdges(staged);
        if (removedThisPass > 0) {
          nonManifoldCulledTriangleCount += removedThisPass;
          const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
          cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
          cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
          topology = analyzeMeshTopology(staged);
          changed = true;
        }
      }
      if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
        const capFaceID = getBoundaryRepairFaceID();
        if (capFaceID) {
          const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
          if (addedThisPass > 0) {
            boundaryCapTriangleCount += addedThisPass;
            try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
            const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
            cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
            cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
            topology = analyzeMeshTopology(staged);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    let orientedTriangleCount = topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0
      ? orientSolidTrianglesByAdjacency(staged)
      : 0;
    if (topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0) {
      orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
    }
    let orientationCulledTriangleCount = 0;
    let orientationCapTriangleCount = 0;
    let orientationCandidateRepairAccepted = false;
    if (orientedTriangleCount > 0) {
      try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
    }
    if (
      topology.boundaryEdgeCount === 0
      && topology.nonManifoldEdgeCount === 0
      && useSmallThicknessOrientationRepair
      && typeof staged._isCoherentlyOrientedManifold === 'function'
      && staged._isCoherentlyOrientedManifold() !== true
    ) {
      for (let orientationRepairPass = 0; orientationRepairPass < 8; orientationRepairPass++) {
        const removedThisPass = cullTrianglesTouchingSameDirectionEdges(staged);
        if (!(removedThisPass > 0)) break;
        orientationCulledTriangleCount += removedThisPass;
        topology = analyzeMeshTopology(staged);
        if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
          const capFaceID = getBoundaryRepairFaceID();
          if (capFaceID) {
            const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
            if (addedThisPass > 0) {
              orientationCapTriangleCount += addedThisPass;
              boundaryCapTriangleCount += addedThisPass;
            }
          }
        }
        const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
        cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
        cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
        topology = analyzeMeshTopology(staged);
        if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) break;
        orientedTriangleCount += orientSolidTrianglesByAdjacency(staged);
        orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
        try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
        if (staged._isCoherentlyOrientedManifold() === true) break;
      }
    }
    for (let postOrientationRepairPass = 0; postOrientationRepairPass < 8; postOrientationRepairPass++) {
      let changed = false;
      if (topology.nonManifoldEdgeCount > 0 && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles) {
        const removedThisPass = cullTrianglesTouchingNonManifoldEdges(staged);
        if (removedThisPass > 0) {
          nonManifoldCulledTriangleCount += removedThisPass;
          changed = true;
        }
      }
      topology = analyzeMeshTopology(staged);
      if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
        const capFaceID = getBoundaryRepairFaceID();
        if (capFaceID) {
          const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
          if (addedThisPass > 0) {
            boundaryCapTriangleCount += addedThisPass;
            changed = true;
          }
        }
      }
      if (changed) {
        const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
        cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
        cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
        topology = analyzeMeshTopology(staged);
        if (topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0) {
          orientedTriangleCount += orientSolidTrianglesByAdjacency(staged);
          orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
          try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
        }
      }
      if (!changed) break;
    }
    if (topology.nonManifoldEdgeCount > 0 && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles) {
      const prunedThisPass = pruneOverusedTriangles(staged);
      if (prunedThisPass > 0) {
        nonManifoldCulledTriangleCount += prunedThisPass;
        topology = analyzeMeshTopology(staged);
        if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
          const capFaceID = getBoundaryRepairFaceID();
          if (capFaceID) {
            const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
            if (addedThisPass > 0) {
              boundaryCapTriangleCount += addedThisPass;
              topology = analyzeMeshTopology(staged);
            }
          }
        }
        if (topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0) {
          orientedTriangleCount += orientSolidTrianglesByAdjacency(staged);
          orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
          try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
        }
      }
    }
    if (options.__raycastMajorityRetry !== true && useSmallThicknessOrientationRepair) for (let finalOrientationRepairPass = 0; finalOrientationRepairPass < 128; finalOrientationRepairPass++) {
      topology = analyzeMeshTopology(staged);
      if (topology.nonManifoldEdgeCount > 0 && (topology.triangleCount || 0) <= nonManifoldCullMaxTriangles) {
        const removedThisPass = cullTrianglesTouchingNonManifoldEdges(staged);
        if (removedThisPass > 0) {
          nonManifoldCulledTriangleCount += removedThisPass;
          const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
          cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
          cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
          topology = analyzeMeshTopology(staged);
        }
      }
      if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
        const capFaceID = getBoundaryRepairFaceID();
        if (capFaceID) {
          const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
          if (addedThisPass > 0) {
            boundaryCapTriangleCount += addedThisPass;
            const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
            cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
            cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
            topology = analyzeMeshTopology(staged);
          }
        }
      }
      if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) break;

      orientedTriangleCount += orientSolidTrianglesByAdjacency(staged);
      orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
      try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
      if (typeof staged._isCoherentlyOrientedManifold !== 'function' || staged._isCoherentlyOrientedManifold() === true) {
        break;
      }

      const removedSameDirection = cullTrianglesTouchingSameDirectionEdges(staged);
      if (!(removedSameDirection > 0)) break;
      orientationCulledTriangleCount += removedSameDirection;
      const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
      cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
      cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
    }
    topology = analyzeMeshTopology(staged);
    if (
      topology.boundaryEdgeCount === 0
      && topology.nonManifoldEdgeCount === 0
      && useSmallThicknessOrientationRepair
      && typeof staged._isCoherentlyOrientedManifold === 'function'
      && staged._isCoherentlyOrientedManifold() !== true
    ) {
      const repaired = tryRepairCoherentOrientationCandidate(staged, {
        sourceFaceName,
        distance: dist,
        manifoldWeldEpsilon,
        nonManifoldCullMaxTriangles,
        maxPasses: options.orientationRepairMaxPasses,
      });
      if (repaired?.solid) {
        const previous = staged;
        staged = repaired.solid;
        try { previous?.free?.(); } catch { /* ignore */ }
        topology = repaired.topology || analyzeMeshTopology(staged);
        const stats = repaired.stats || {};
        orientedTriangleCount += stats.orientedTriangleCount || 0;
        orientationCulledTriangleCount += stats.orientationCulledTriangleCount || 0;
        orientationCapTriangleCount += stats.orientationCapTriangleCount || 0;
        boundaryCapTriangleCount += stats.boundaryCapTriangleCount || 0;
        nonManifoldCulledTriangleCount += stats.nonManifoldCulledTriangleCount || 0;
        cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (stats.weldedVertexCount || 0);
        cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (stats.degenerateTriangleCount || 0);
        orientationCandidateRepairAccepted = true;
      }
    }
    const excessiveRepairCaps = !useTrianglePrismUnion && boundaryCapTriangleCount > Math.max(10000, sourceTriangleCount * 100);
    const excessiveNonManifoldCull = !useTrianglePrismUnion && nonManifoldCulledTriangleCount > Math.max(10000, sourceTriangleCount * 100);
    if (excessiveRepairCaps || excessiveNonManifoldCull) {
      const prismRetry = retryWithTrianglePrismUnion(excessiveRepairCaps ? 'excessive_boundary_caps' : 'excessive_nonmanifold_cull');
      if (prismRetry) return prismRetry;
      throw new Error(
        'Face.thicken() triangle split/cull required excessive topology repair '
        + `(boundaryCaps=${boundaryCapTriangleCount}, nonManifoldCull=${nonManifoldCulledTriangleCount}, sourceTriangles=${sourceTriangleCount}).`,
      );
    }

    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
      const prismRetry = retryWithTrianglePrismUnion('invalid_stitched_topology');
      if (prismRetry) return prismRetry;
      const noTriangleSplitRetry = retryWithoutTriangleSplit();
      if (noTriangleSplitRetry) return noTriangleSplitRetry;
      const noInternalCullRetry = retryWithoutInternalCull();
      if (noInternalCullRetry) return noInternalCullRetry;
      const relaxedWeldRetry = retryWithRelaxedWeld();
      if (relaxedWeldRetry) return relaxedWeldRetry;
      const retry = retryWithRaycastMajority();
      if (retry) return retry;
      throw new Error(
        `Face.thicken() triangle split/cull produced invalid topology: `
        + `boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}, triangles=${topology.triangleCount || 0}.`,
      );
    }
    let orientationWarning = typeof staged._isCoherentlyOrientedManifold === 'function' && staged._isCoherentlyOrientedManifold() !== true;
    let finalOrientation = orientationWarning ? analyzeTriangleOrientation(staged) : null;
    if (orientationWarning && topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0) {
      const repaired = tryRepairCoherentOrientationCandidate(staged, {
        sourceFaceName,
        distance: dist,
        manifoldWeldEpsilon,
        nonManifoldCullMaxTriangles,
        maxPasses: options.orientationRepairMaxPasses,
      });
      if (repaired?.solid) {
        const previous = staged;
        staged = repaired.solid;
        try { previous?.free?.(); } catch { /* ignore */ }
        topology = repaired.topology || analyzeMeshTopology(staged);
        const stats = repaired.stats || {};
        orientedTriangleCount += stats.orientedTriangleCount || 0;
        orientationCulledTriangleCount += stats.orientationCulledTriangleCount || 0;
        orientationCapTriangleCount += stats.orientationCapTriangleCount || 0;
        boundaryCapTriangleCount += stats.boundaryCapTriangleCount || 0;
        nonManifoldCulledTriangleCount += stats.nonManifoldCulledTriangleCount || 0;
        cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (stats.weldedVertexCount || 0);
        cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (stats.degenerateTriangleCount || 0);
        orientationCandidateRepairAccepted = true;
        orientationWarning = typeof staged._isCoherentlyOrientedManifold === 'function' && staged._isCoherentlyOrientedManifold() !== true;
        finalOrientation = orientationWarning ? analyzeTriangleOrientation(staged) : null;
      }
    }
    if (orientationWarning && topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0) {
      for (let finalCoherencePass = 0; finalCoherencePass < 32; finalCoherencePass++) {
        const removedThisPass = cullTrianglesTouchingSameDirectionEdges(staged);
        if (!(removedThisPass > 0)) break;
        orientationCulledTriangleCount += removedThisPass;
        topology = analyzeMeshTopology(staged);
        if (allowBoundaryRepairCaps && topology.boundaryEdgeCount > 0) {
          const capFaceID = getBoundaryRepairFaceID();
          if (capFaceID) {
            const addedThisPass = fillBoundaryLoopsWithTriangles(staged, capFaceID);
            if (addedThisPass > 0) {
              orientationCapTriangleCount += addedThisPass;
              boundaryCapTriangleCount += addedThisPass;
            }
          }
        }
        const weld = weldSolidVerticesByPosition(staged, manifoldWeldEpsilon);
        cleanup.weldedVertexCount = (cleanup.weldedVertexCount || 0) + (weld.weldedVertexCount || 0);
        cleanup.degenerateTriangleCount = (cleanup.degenerateTriangleCount || 0) + (weld.removedTriangleCount || 0);
        topology = analyzeMeshTopology(staged);
        if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) break;
        orientedTriangleCount += orientSolidTrianglesByAdjacency(staged);
        orientedTriangleCount += orientSolidComponentsBySignedVolume(staged);
        try { staged.fixTriangleWindingsByAdjacency?.(); } catch { /* ignore */ }
        orientationWarning = typeof staged._isCoherentlyOrientedManifold === 'function' && staged._isCoherentlyOrientedManifold() !== true;
        finalOrientation = orientationWarning ? analyzeTriangleOrientation(staged) : null;
        if (!orientationWarning) break;
      }
    }
    if (orientationWarning && options.__raycastMajorityRetry !== true && useSmallThicknessOrientationRepair) {
      const noInternalCullRetry = retryWithoutInternalCull();
      if (noInternalCullRetry) return noInternalCullRetry;
      const relaxedWeldRetry = retryWithRelaxedWeld();
      if (relaxedWeldRetry) return relaxedWeldRetry;
      const retry = retryWithRaycastMajority();
      if (retry) return retry;
      throw new Error(
        'Face.thicken() triangle split/cull produced a non-coherently-oriented manifold result: '
        + `sameDirection=${finalOrientation.sameDirectionEdgeCount}, ambiguous=${finalOrientation.ambiguousEdgeCount}.`,
      );
    }

    const capReclassificationTolerance = Math.max(
      manifoldWeldEpsilon * 64,
      Math.abs(dist) * 1e-5,
      surface.scale * 1e-5,
      1e-6,
    );
    const capReclassifiedTriangleCount = reclassifyThickenCapTrianglesByGeometry(
      staged,
      surface,
      dist,
      classificationState,
      capReclassificationTolerance,
    );

    applySourceFaceMetadataToThickenResult(staged, face, labels, sourceFaceName);
    staged.__thickenMethod = 'triangle_split_cull';
    staged.__thickenClassificationMethod = 'raw_face_ids';
    staged.__thickenDiagnostics = {
      boundaryLoopCount: loops.length,
      sourceTriangleCount: Array.isArray(surface.triangles) ? surface.triangles.length : 0,
      sourceFaceCount: sourceFaceNames.length,
      sourceFaceNames,
      resultTriangleCount: ((staged._triVerts?.length || 0) / 3) | 0,
      sourceFaceName,
      distance: dist,
      classificationMethod: 'raw_face_ids',
      buildMethod: staged.__thickenMethod,
      constructionMethod: useTrianglePrismUnion ? 'triangle_prism_union' : 'stitched_shell',
      trianglePrismUnionRetry: options.__trianglePrismUnionRetry === true,
      trianglePrismUnionReason: options.__trianglePrismUnionReason || '',
      repairBoundaryCapsEnabled: allowBoundaryRepairCaps,
      weldEpsilon: manifoldWeldEpsilon,
      triangleSplitCount: cleanup?.splitCount || 0,
      triangleSplitSkipped: skipArrangementSplit,
      triangleSplitSkipReason,
      triangleSplitProbeCount: exactShellPreservation.splitProbeCount || 0,
      culledTriangleCount: cleanup?.culledTriangleCount || 0,
      internalTriangleCullSkipped: options.skipInternalCull === true,
      internalTriangleCullRetry: options.__skipInternalCullRetry === true,
      relaxedWeldRetry: options.__relaxedWeldRetry === true,
      degenerateTriangleCount: cleanup?.degenerateTriangleCount || 0,
      weldedVertexCount: cleanup?.weldedVertexCount || 0,
      orientedTriangleCount,
      orientationCulledTriangleCount,
      orientationCapTriangleCount,
      orientationCandidateRepairAccepted,
      orientationRepairDistanceLimit,
      orientationWarning,
      orientationSameDirectionEdgeCount: finalOrientation?.sameDirectionEdgeCount || 0,
      orientationAmbiguousEdgeCount: finalOrientation?.ambiguousEdgeCount || 0,
      capReclassifiedTriangleCount,
      nonManifoldCulledTriangleCount,
      boundaryCapTriangleCount,
      splitCullPasses: cleanup?.passCount || 0,
      adjacentBoundaryNormalContributionCount: surface.adjacentNormalStats?.contributionCount || 0,
      adjacentBoundaryNormalVertexCount: surface.adjacentNormalStats?.contributedVertexCount || 0,
      adjacentBoundaryNormalCandidateEdgeCount: surface.adjacentNormalStats?.candidateEdges || 0,
      adjacentBoundaryNormalAcceptedEdgeCount: surface.adjacentNormalStats?.acceptedEdges || 0,
      adjacentBoundaryNormalDotThreshold: surface.adjacentNormalStats?.dotThreshold ?? null,
      adjacentBoundaryNormalWeightScale: surface.adjacentNormalStats?.weightScale ?? null,
      adjacentBoundaryNormalFaceFilterCount: surface.adjacentNormalStats?.faceFilterCount || 0,
      adjacentBoundaryNormalFaceFilterNames: surface.adjacentNormalStats?.faceFilterNames || [],
    };
    staged.userData = {
      ...(staged.userData || {}),
      thicken: {
        sourceFaceName,
        sourceFaceNames,
        sourceFaceCount: sourceFaceNames.length,
        distance: dist,
        boundaryLoopCount: loops.length,
        sourceTriangleCount: Array.isArray(surface.triangles) ? surface.triangles.length : 0,
        resultTriangleCount: ((staged._triVerts?.length || 0) / 3) | 0,
        classificationMethod: 'raw_face_ids',
        buildMethod: staged.__thickenMethod,
        weldEpsilon: manifoldWeldEpsilon,
        triangleSplitCount: cleanup?.splitCount || 0,
        triangleSplitSkipped: skipArrangementSplit,
        triangleSplitSkipReason,
        triangleSplitProbeCount: exactShellPreservation.splitProbeCount || 0,
        culledTriangleCount: cleanup?.culledTriangleCount || 0,
        internalTriangleCullSkipped: options.skipInternalCull === true,
        internalTriangleCullRetry: options.__skipInternalCullRetry === true,
        relaxedWeldRetry: options.__relaxedWeldRetry === true,
        degenerateTriangleCount: cleanup?.degenerateTriangleCount || 0,
        weldedVertexCount: cleanup?.weldedVertexCount || 0,
        orientedTriangleCount,
        orientationCulledTriangleCount,
        orientationCapTriangleCount,
        orientationCandidateRepairAccepted,
        orientationRepairDistanceLimit,
        orientationWarning,
        orientationSameDirectionEdgeCount: finalOrientation?.sameDirectionEdgeCount || 0,
        orientationAmbiguousEdgeCount: finalOrientation?.ambiguousEdgeCount || 0,
        capReclassifiedTriangleCount,
        nonManifoldCulledTriangleCount,
        boundaryCapTriangleCount,
        splitCullPasses: cleanup?.passCount || 0,
        adjacentBoundaryNormalContributionCount: surface.adjacentNormalStats?.contributionCount || 0,
        adjacentBoundaryNormalVertexCount: surface.adjacentNormalStats?.contributedVertexCount || 0,
        adjacentBoundaryNormalDotThreshold: surface.adjacentNormalStats?.dotThreshold ?? null,
        adjacentBoundaryNormalFaceFilterCount: surface.adjacentNormalStats?.faceFilterCount || 0,
        adjacentBoundaryNormalFaceFilterNames: surface.adjacentNormalStats?.faceFilterNames || [],
      },
    };
    const result = staged;
    staged = null;
    return result;
  } finally {
    try { staged?.free?.(); } catch { /* ignore */ }
  }
}

export function thickenFaceToSolid(face, distance, options = {}) {
  const surface = extractFaceSurface(face, options);
  const sourceFaceName = String(options.sourceFaceName || face?.userData?.faceName || face?.name || '').trim();
  return thickenSurfaceToSolid(surface, face, distance, {
    ...options,
    sourceFaceNames: Array.isArray(options.sourceFaceNames)
      ? options.sourceFaceNames
      : (sourceFaceName ? [sourceFaceName] : undefined),
    sourceFaceName,
  });
}

export function thickenFacesToSolid(faces, distance, options = {}) {
  const faceList = Array.isArray(faces)
    ? faces.filter((face) => face?.geometry)
    : [];
  if (!faceList.length) {
    throw new Error('Face.thicken() requires at least one face with geometry.');
  }
  const sourceFaceNames = faceList.map((face, index) => (
    String(face?.userData?.faceName || face?.name || `FACE_${index + 1}`).trim() || `FACE_${index + 1}`
  ));
  const featureId = sanitizeToken(options.featureId || options.name || sourceFaceNames[0] || 'THICKEN', 'THICKEN');
  const sourceFaceName = String(options.sourceFaceName || `${featureId}_PATCH`).trim() || `${featureId}_PATCH`;
  const surface = extractFacesSurface(faceList, options);
  return thickenSurfaceToSolid(surface, faceList[0], distance, {
    ...options,
    sourceFaceName,
    sourceFaceNames,
  });
}

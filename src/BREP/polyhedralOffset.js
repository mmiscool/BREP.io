import * as THREE from 'three';
import { Solid } from './BetterSolid.js';
import {
  cppSolidCoreHasNativeDisconnectedIslandCleanup,
  getSolidAuthoringStateSnapshot,
  getSyncedCppSolidCore,
  applySolidAuthoringStateSnapshot,
  syncSolidAuthoringStateFromCpp,
} from './CppSolidCore.js';
import { MeshRepairer } from './MeshRepairer.js';
import { Manifold } from './SolidShared.js';
import { manifold } from './setupManifold.js';

const PLANE_EPS = 1e-5;
const SOLVER_EPS = 1e-9;
const RESIDUAL_EPS = 5e-4;
const ITERATION_EPS = 1e-8;
const MAX_GN_ITERS = 24;
const MAX_OFFSET_REPAIR_PASSES = 6;
const DEFAULT_TINY_BOUNDARY_AREA = 1e-7;
const DEFAULT_ISLAND_TRIANGLE_CAP = 16;
const DEFAULT_TINY_FACE_ISLAND_AREA = 1e-4;
const DEFAULT_DISCONNECTED_MIN_VOLUME = 1e-10;
const STABLE_PASS_LIMIT = 2;

function _buildPointInsideTester(solid, options = {}) {
  const vertProperties = Array.isArray(solid?._vertProperties)
    ? solid._vertProperties
    : Array.from(solid?._vertProperties || []);
  const triVerts = Array.isArray(solid?._triVerts)
    ? solid._triVerts
    : Array.from(solid?._triVerts || []);
  const triCount = (triVerts.length / 3) | 0;
  if (vertProperties.length < 9 || triCount === 0) return null;

  const triangles = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i0 = (triVerts[t * 3 + 0] >>> 0) * 3;
    const i1 = (triVerts[t * 3 + 1] >>> 0) * 3;
    const i2 = (triVerts[t * 3 + 2] >>> 0) * 3;

    triangles[t] = [
      [vertProperties[i0] || 0, vertProperties[i0 + 1] || 0, vertProperties[i0 + 2] || 0],
      [vertProperties[i1] || 0, vertProperties[i1 + 1] || 0, vertProperties[i1 + 2] || 0],
      [vertProperties[i2] || 0, vertProperties[i2 + 1] || 0, vertProperties[i2 + 2] || 0],
    ];
  }

  const jitterScale = Math.max(1e-8, Math.min(1e-4, (_modelScale(solid) || 1) * 1e-6));
  const requestedProbeOffset = Number.isFinite(Number(options?.probeOffset)) ? Number(options.probeOffset) : jitterScale;
  const probeOffset = Math.max(1e-8, Math.min(jitterScale, requestedProbeOffset));

  const rayTri = (orig, dir, tri) => {
    const EPS = 1e-12;
    const ax = tri[0][0], ay = tri[0][1], az = tri[0][2];
    const bx = tri[1][0], by = tri[1][1], bz = tri[1][2];
    const cx = tri[2][0], cy = tri[2][1], cz = tri[2][2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dir[1] * e2z - dir[2] * e2y;
    const py = dir[2] * e2x - dir[0] * e2z;
    const pz = dir[0] * e2y - dir[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) return null;
    const invDet = 1.0 / det;
    const tvecx = orig[0] - ax, tvecy = orig[1] - ay, tvecz = orig[2] - az;
    const u = (tvecx * px + tvecy * py + tvecz * pz) * invDet;
    if (u < 0 || u > 1) return null;
    const qx = tvecy * e1z - tvecz * e1y;
    const qy = tvecz * e1x - tvecx * e1z;
    const qz = tvecx * e1y - tvecy * e1x;
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
    if (v < 0 || u + v > 1) return null;
    const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return tHit > EPS ? tHit : null;
  };

  const pointInsideByAxis = (point, dir, axisOffset) => {
    const sampleOffsets = [
      [0.17, 0.23, 0.29],
      [0.41, 0.47, 0.53],
      [0.73, 0.79, 0.83],
    ];
    let insideVotes = 0;
    for (let s = 0; s < sampleOffsets.length; s++) {
      const offset = sampleOffsets[s];
      const origin = [
        point.x + (axisOffset + 1) * offset[0] * probeOffset,
        point.y + (axisOffset + 2) * offset[1] * probeOffset,
        point.z + (axisOffset + 3) * offset[2] * probeOffset,
      ];
      let hits = 0;
      for (let i = 0; i < triCount; i++) {
        const th = rayTri(origin, dir, triangles[i]);
        if (th !== null) hits++;
      }
      if ((hits % 2) === 1) insideVotes++;
    }
    return insideVotes >= 2;
  };

  const pointInside = (point) => {
    if (!point || Number.isNaN(point.x) || Number.isNaN(point.y) || Number.isNaN(point.z)) return false;
    const axisTests = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    let yes = 0;
    let no = 0;
    for (let i = 0; i < axisTests.length; i++) {
      try {
        const inside = pointInsideByAxis(point, axisTests[i], i + 1);
        if (inside) yes++;
        else no++;
      } catch {
        return false;
      }
    }
    return yes >= no;
  };

  return pointInside;
}

function _safePointInsideTest(insideTester, point) {
  if (typeof insideTester !== 'function' || !isFiniteVec3(point)) return null;
  try {
    return !!insideTester(point);
  } catch {
    return null;
  }
}

function _orientFaceNormalOutward(normal, centroid, options = {}) {
  const normalVec = new THREE.Vector3(normal.x || 0, normal.y || 0, normal.z || 0);
  if (!normalVec.lengthSq()) return null;
  normalVec.normalize();

  const insideTester = options.insideTester;
  const probeOffset = Number(options.probeOffset) || 1e-5;
  const fallbackVec = options.solidCentroid instanceof THREE.Vector3
    ? options.solidCentroid
    : new THREE.Vector3();
  const centroidDirection = centroid && fallbackVec.lengthSq() ? centroid.clone().sub(fallbackVec) : null;
  const centroidOutward = centroidDirection ? centroidDirection.dot(normalVec) >= 0 : null;

  if (typeof insideTester === 'function' && centroid) {
    const basis = _buildFaceBasis(normalVec);
    const distanceSteps = [0.6, 1, 1.8];
    const lateralSamples = [
      [0, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];

    let plusInsideVotes = 0;
    let minusInsideVotes = 0;
    for (const distance of distanceSteps) {
      for (const [sx, sy] of lateralSamples) {
        for (let sign = -1; sign <= 1; sign += 2) {
          const sample = centroid.clone();
          sample.addScaledVector(basis.normal, sign * probeOffset * distance);
          sample.addScaledVector(basis.tangent1, probeOffset * distance * 0.07 * sx);
          sample.addScaledVector(basis.tangent2, probeOffset * distance * 0.07 * sy);
          const inside = !!insideTester(sample);
          if (sign > 0) {
            if (inside) plusInsideVotes++;
          } else if (inside) {
            minusInsideVotes++;
          }
        }
      }
    }

    const totalSamples = plusInsideVotes + minusInsideVotes;
    if (totalSamples > 0) {
      const insideConfidence = Math.abs(plusInsideVotes - minusInsideVotes) / totalSamples;
      const insideSuggestsOutward = minusInsideVotes > plusInsideVotes;
      if (insideConfidence >= 0.65) {
        if (centroidOutward !== null && centroidOutward !== insideSuggestsOutward && insideConfidence < 0.85) {
          // Defer to centroid direction when inside sampling is not overwhelmingly confident.
          return centroidOutward ? normalVec : normalVec.multiplyScalar(-1);
        }
        if (!insideSuggestsOutward) normalVec.multiplyScalar(-1);
        return normalVec;
      }
    }
  }

  if (centroidOutward === false) {
    normalVec.multiplyScalar(-1);
  }
  return normalVec;
}

function _modelScale(solid) {
  const vertProperties = Array.isArray(solid?._vertProperties)
    ? solid._vertProperties
    : Array.from(solid?._vertProperties || []);
  if (vertProperties.length < 9) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertProperties.length; i += 3) {
    const x = vertProperties[i + 0];
    const y = vertProperties[i + 1];
    const z = vertProperties[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
}

function isFiniteVec3(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.z);
}

function _buildFaceBasis(normal) {
  const n = normal.clone().normalize();
  const axis = Math.abs(n.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent1 = new THREE.Vector3().crossVectors(n, axis);
  if (!tangent1.lengthSq()) {
    tangent1.set(0, 0, 1).crossVectors(n, new THREE.Vector3(0, 0, 1));
  }
  if (!tangent1.lengthSq()) {
    return {
      normal: n,
      tangent1: new THREE.Vector3(1, 0, 0),
      tangent2: new THREE.Vector3(0, 1, 0),
    };
  }
  tangent1.normalize();
  return {
    normal: n,
    tangent1,
    tangent2: new THREE.Vector3().crossVectors(n, tangent1).normalize(),
  };
}

function edgeKey(a, b) {
  const u = Math.min(a, b);
  const v = Math.max(a, b);
  return `${u}|${v}`;
}

function _triangleArea(vertProperties, triIndex, triVerts) {
  const ia = triVerts[triIndex * 3] >>> 0;
  const ib = triVerts[triIndex * 3 + 1] >>> 0;
  const ic = triVerts[triIndex * 3 + 2] >>> 0;
  const a = ia * 3;
  const b = ib * 3;
  const c = ic * 3;
  const ux = vertProperties[b + 0] - vertProperties[a + 0];
  const uy = vertProperties[b + 1] - vertProperties[a + 1];
  const uz = vertProperties[b + 2] - vertProperties[a + 2];
  const vx = vertProperties[c + 0] - vertProperties[a + 0];
  const vy = vertProperties[c + 1] - vertProperties[a + 1];
  const vz = vertProperties[c + 2] - vertProperties[a + 2];
  const cx = (uy * vz) - (uz * vy);
  const cy = (uz * vx) - (ux * vz);
  const cz = (ux * vy) - (uy * vx);
  return 0.5 * Math.hypot(cx, cy, cz);
}

function _buildVertexFallbackSupport(analysis, vertexIndex, point, faceNames, options = {}) {
  const preferred = [];
  const preferredNames = [];
  const fallback = [];
  const fallbackNames = [];
  const solidCentroid = options.solidCentroid instanceof THREE.Vector3 ? options.solidCentroid : null;
  const sourceFaceMap = analysis?.faceMap instanceof Map ? analysis.faceMap : new Map();

  const addNormal = (faceName, normal, isPreferred) => {
    if (!normal || !isFiniteVec3(normal) || normal.lengthSq() <= SOLVER_EPS) return;
    const candidate = normal.clone();
    const face = sourceFaceMap.get(faceName);
    const faceCentroid = face?.centroid;
    if (faceCentroid && solidCentroid && isFiniteVec3(faceCentroid) && isFiniteVec3(solidCentroid)) {
      const centroidToFace = faceCentroid.clone().sub(solidCentroid);
      if (centroidToFace.dot(candidate) < 0) {
        candidate.negate();
      }
    }
    if (isPreferred) {
      preferred.push(candidate);
      preferredNames.push(faceName);
      return;
    }
    fallback.push(candidate);
    fallbackNames.push(faceName);
  };

  for (const faceName of Array.from(faceNames || [])) {
    const normal = analysis.vertexFaceNormalMap?.get?.(`${vertexIndex}|${faceName}`) || null;
    const face = sourceFaceMap.get(faceName);
    const isPreferred = face?.support?.kind && face.support.kind !== 'vertex_tangent';
    addNormal(faceName, normal, isPreferred);
  }

  const useFallback = !(preferred.length > 0);
  const normalBuckets = useFallback ? fallback : preferred;
  const faceNameBuckets = useFallback ? fallbackNames : preferredNames;
  const fallbackNormal = new THREE.Vector3();
  for (const normal of normalBuckets) {
    fallbackNormal.add(normal);
  }
  if (!fallbackNormal.lengthSq()) return [];
  fallbackNormal.normalize();
  const representativeFaceName = String((faceNameBuckets && faceNameBuckets[0]) || (faceNames && faceNames.values().next().value) || '');

  return [{
    kind: 'plane',
    faceName: representativeFaceName,
    normal: fallbackNormal,
    offset: fallbackNormal.dot(point),
  }];
}

function _applyNamePrefix(name, prefix) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const normalizedPrefix = String(prefix || '').trim();
  if (!normalizedPrefix) return trimmed;
  const normalizedPrefixWithSep = `${normalizedPrefix}_`;
  if (trimmed === normalizedPrefix || trimmed.startsWith(normalizedPrefixWithSep)) return trimmed;
  return `${normalizedPrefixWithSep}${trimmed}`;
}

function _cloneMetadataValue(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => _cloneMetadataValue(entry));
  return { ...value };
}

function _buildOffsetFaceMetadata(sourceSolid, newSolidName) {
  const sourceMap = (sourceSolid?._faceMetadata instanceof Map)
    ? sourceSolid._faceMetadata
    : new Map();
  const out = new Map();
  for (const [faceName, metadata] of sourceMap.entries()) {
    const prefixedName = _applyNamePrefix(faceName, newSolidName);
    if (!prefixedName) continue;
    out.set(prefixedName, _cloneMetadataValue(metadata));
  }
  return out;
}

function _collectMetadataEntriesForRebuild(solids, options = {}) {
  const { namePrefix = '' } = options;
  const normalize = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return JSON.stringify({});
    try {
      return JSON.stringify(_cloneMetadataValue(JSON.parse(trimmed)) || {});
    } catch {
      return JSON.stringify({});
    }
  };

  const faceMetadata = new Map();
  const edgeMetadata = new Map();
  const auxEdges = [];

  for (const solid of solids) {
    if (!solid) continue;
    const snapshot = getSolidAuthoringStateSnapshot(solid);
    const faceEntries = snapshot?.faceMetadataJson instanceof Map
      ? snapshot.faceMetadataJson.entries()
      : Array.isArray(snapshot?.faceMetadataJson) ? snapshot.faceMetadataJson : [];
    for (const [name, metadataJson] of faceEntries) {
      const normalizedName = _applyNamePrefix(name, namePrefix);
      if (!normalizedName) continue;
      faceMetadata.set(normalizedName, normalize(metadataJson));
    }

    const edgeEntries = snapshot?.edgeMetadataJson instanceof Map
      ? snapshot.edgeMetadataJson.entries()
      : Array.isArray(snapshot?.edgeMetadataJson) ? snapshot.edgeMetadataJson : [];
    for (const [name, metadataJson] of edgeEntries) {
      const normalizedName = String(name || '').trim();
      if (!normalizedName) continue;
      edgeMetadata.set(normalizedName, normalize(metadataJson));
    }

    const auxFromSnapshot = Array.isArray(snapshot?.auxEdges) ? snapshot.auxEdges : null;
    if (auxFromSnapshot?.length) auxEdges.push(...auxFromSnapshot);
  }

  return {
    faceMetadataJson: Array.from(faceMetadata.entries()),
    edgeMetadataJson: Array.from(edgeMetadata.entries()),
    auxEdges,
  };
}

function _solidToGeometry(solid) {
  try {
    const vp = solid?._vertProperties;
    const tv = solid?._triVerts;
    const ids = solid?._triIDs;
    if (!Array.isArray(vp) || vp.length < 9) return null;
    if (!Array.isArray(tv) || tv.length < 3) return null;
    if (!Array.isArray(ids) || ids.length !== (tv.length / 3)) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(vp), 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(tv), 1));
    return geometry;
  } catch {
    return null;
  }
}

function _collectTrianglesFromSolid(solid, options = {}) {
  const { namePrefix = '' } = options;
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid?._idToFaceName instanceof Map
    ? solid._idToFaceName
    : new Map();
  const faceNamePrefix = String(namePrefix || solid?.name || '').trim();

  const triCount = (tv.length / 3) | 0;
  if (!vp.length || !triCount) return null;

  const triangles = [];
  let minX = +Infinity;
  let minY = +Infinity;
  let minZ = +Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let t = 0; t < triCount; t++) {
    const i0 = tv[t * 3] >>> 0;
    const i1 = tv[t * 3 + 1] >>> 0;
    const i2 = tv[t * 3 + 2] >>> 0;

    const ax = vp[i0 * 3];
    const ay = vp[i0 * 3 + 1];
    const az = vp[i0 * 3 + 2];
    const bx = vp[i1 * 3];
    const by = vp[i1 * 3 + 1];
    const bz = vp[i1 * 3 + 2];
    const cx = vp[i2 * 3];
    const cy = vp[i2 * 3 + 1];
    const cz = vp[i2 * 3 + 2];

    const centerX = (ax + bx + cx) / 3;
    const centerY = (ay + by + cy) / 3;
    const centerZ = (az + bz + cz) / 3;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }

    const rawName = idToFaceName.get(ids[t]);
    const baseName = String(rawName || '').trim() || `FACE_${ids[t] ?? t}`;
    const faceName = _applyNamePrefix(baseName, faceNamePrefix);

    triangles.push({
      center: [centerX, centerY, centerZ],
      normal: [nx, ny, nz],
      faceName,
    });
  }

  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const diag = Math.hypot(dx, dy, dz);
  const scale = Math.max(1, Number(diag) || 1, Math.abs(dx), Math.abs(dy), Math.abs(dz));

  return {
    triangles,
    scale,
    fallbackPrefix: `${(faceNamePrefix || 'REPAIRED')}_OFFSET`,
  };
}

function _assignFaceDataByTriangleProximity(geometry, sourceMeta) {
  if (!geometry) return null;
  const indexAttr = geometry.getIndex();
  const posAttr = geometry.getAttribute('position');
  if (!indexAttr || !posAttr) return null;

  const idx = indexAttr.array;
  const pos = posAttr.array;
  const triCount = (idx.length / 3) | 0;
  if (!(triCount > 0)) return null;

  const sourceTriangles = Array.isArray(sourceMeta?.triangles) ? sourceMeta.triangles : [];
  if (!sourceTriangles.length) return null;

  const scale = Math.max(1, Number(sourceMeta?.scale) || 1);
  const distLimit = Math.max(1e-9, Math.pow(scale * 5e-3, 2));
  const fallbackPrefix = String(sourceMeta?.fallbackPrefix || 'REPAIRED').trim() || 'REPAIRED';

  const faceIDs = new Uint32Array(triCount);
  const nameToID = new Map();
  const idToName = new Map();
  let fallbackCount = 0;
  const nextFallbackName = () => `${fallbackPrefix}_FACE_${++fallbackCount}`;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3];
    const i1 = idx[t * 3 + 1];
    const i2 = idx[t * 3 + 2];
    const ax = pos[i0 * 3];
    const ay = pos[i0 * 3 + 1];
    const az = pos[i0 * 3 + 2];
    const bx = pos[i1 * 3];
    const by = pos[i1 * 3 + 1];
    const bz = pos[i1 * 3 + 2];
    const cx = pos[i2 * 3];
    const cy = pos[i2 * 3 + 1];
    const cz = pos[i2 * 3 + 2];

    const centerX = (ax + bx + cx) / 3;
    const centerY = (ay + by + cy) / 3;
    const centerZ = (az + bz + cz) / 3;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }

    let bestScore = Infinity;
    let bestName = null;
    for (const tri of sourceTriangles) {
      const dx = centerX - tri.center[0];
      const dy = centerY - tri.center[1];
      const dz = centerZ - tri.center[2];
      const dist2 = dx * dx + dy * dy + dz * dz;
      const tn = tri.normal;
      const dot = Math.max(0, Math.min(1, Math.abs(nx * tn[0] + ny * tn[1] + nz * tn[2])));
      const normalPenalty = 1 - dot;
      const score = dist2 + normalPenalty * distLimit;
      if (score < bestScore) {
        bestScore = score;
        bestName = tri.faceName;
      }
    }

    let faceName = String(bestName || '').trim() || nextFallbackName();
    let id = nameToID.get(faceName);
    if (!id) {
      id = Manifold.reserveIDs(1);
      nameToID.set(faceName, id);
      idToName.set(id, faceName);
    }
    faceIDs[t] = id;
  }

  return { faceIDs, idToFaceName: idToName };
}

function _makeSolidFromRepairedGeometry(geometry, faceIDs, idToFaceName, sourceForMetadata, options = {}) {
  if (!geometry || !faceIDs || !idToFaceName) return null;
  if (typeof manifold?.buildSolidAuthoringStateFromMesh !== 'function') {
    return null;
  }

  const { metadataNamePrefix = '' } = options;

  const indexAttr = geometry.getIndex();
  const posAttr = geometry.getAttribute('position');
  if (!indexAttr || !posAttr) return null;

  const metadata = _collectMetadataEntriesForRebuild(Array.isArray(sourceForMetadata) ? sourceForMetadata : [sourceForMetadata], {
    namePrefix: metadataNamePrefix,
  });
  const faceNameToID = Array.from(idToFaceName.entries(), ([id, faceName]) => [faceName, id]);
  const snapshot = manifold.buildSolidAuthoringStateFromMesh({
    numProp: 3,
    vertProperties: Array.from(posAttr.array || []),
    triVerts: Array.from(indexAttr.array || []),
    faceID: Array.from(faceIDs instanceof Uint32Array ? faceIDs : Uint32Array.from(faceIDs)),
    faceNameToID,
    idToFaceName: Array.from(idToFaceName.entries()),
    faceMetadataJson: metadata?.faceMetadataJson,
    edgeMetadataJson: metadata?.edgeMetadataJson,
    auxEdges: metadata?.auxEdges,
  });

  const rebuilt = new Solid();
  applySolidAuthoringStateSnapshot(rebuilt, snapshot, {
    remapFaceIDs: false,
  });

  const builtFaceNames = new Set(Array.from(idToFaceName.values(), (faceName) => String(faceName || '')));
  rebuilt._faceMetadata = new Map(
    Array.from(metadata.faceMetadataJson || [], ([faceName, raw]) => {
      if (!builtFaceNames.has(faceName)) return null;
      try {
        return [faceName, JSON.parse(raw || "{}")] ;
      } catch {
        return [faceName, {}];
      }
    }).filter(Boolean)
  );
  rebuilt._edgeMetadata = new Map(
    Array.from(metadata.edgeMetadataJson || [], ([edgeName, raw]) => {
      try {
        return [edgeName, JSON.parse(raw || "{}")] ;
      } catch {
        return [edgeName, {}];
      }
    })
  );
  rebuilt._auxEdges = Array.isArray(metadata.auxEdges) ? metadata.auxEdges.slice() : [];
  rebuilt._idToFaceName = new Map(idToFaceName);
  rebuilt._faceNameToID = new Map(Array.from(idToFaceName.entries(), ([id, name]) => [name, id]));
  rebuilt._dirty = true;
  rebuilt._manifold = null;
  rebuilt._faceIndex = null;
  return rebuilt;
}

function _buildRepairedOffsetCandidates(baseSolid, sourceForMetadata, options = {}) {
  const {
    newSolidName = `${baseSolid?.name || 'Solid'}`,
    repairPasses = MAX_OFFSET_REPAIR_PASSES,
    repairAttempts,
  } = options;

  const metadataSourceInput = Array.isArray(sourceForMetadata) ? sourceForMetadata[0] : sourceForMetadata;
  const metadataSource = baseSolid && _collectTrianglesFromSolid(metadataSourceInput, {
    namePrefix: newSolidName,
  });
  if (!metadataSource) return null;

  const sourceGeom = _solidToGeometry(baseSolid);
  if (!sourceGeom) return null;

  const repairer = new MeshRepairer();
  let output = null;
  const modelScale = _modelScale(baseSolid);
  const baseWeld = Math.max(1e-5, Math.min(1e-2, modelScale * 1e-5));
  const attempts = Array.isArray(repairAttempts) && repairAttempts.length
    ? repairAttempts.filter((value) => Number.isFinite(Number(value))).map((value) => Math.max(1, Number(value)))
    : [1, 4, 16, 64];
  const sourceForMetadataEntries = Array.isArray(sourceForMetadata)
    ? sourceForMetadata
    : [sourceForMetadata];

  try {
    for (const attemptScale of attempts) {
      const workingGeom = _safeCall(() => sourceGeom.clone());
      if (!workingGeom) continue;
      const weldEps = baseWeld * attemptScale;
      const lineEps = Math.max(1e-5, weldEps * 1.4);
      const gridCell = Math.max(1e-4, weldEps * 2.2);
      let repairedGeom = null;

      try {
        repairedGeom = _safeCall(() => repairer.repairAll(workingGeom, {
          weldEps,
          lineEps,
          gridCell,
        })) || workingGeom;
      } catch {
        // best effort repair pass
      }
      if (!repairedGeom) {
        try { workingGeom.dispose(); } catch { }
        continue;
      }

      const faceData = _assignFaceDataByTriangleProximity(repairedGeom, metadataSource);
      if (!faceData?.faceIDs?.length) {
        try { repairedGeom.dispose(); } catch { }
        if (repairedGeom !== workingGeom) {
          try { workingGeom.dispose(); } catch { }
        }
        continue;
      }

      const rebuilt = _makeSolidFromRepairedGeometry(
        repairedGeom,
        faceData.faceIDs,
        faceData.idToFaceName,
        sourceForMetadataEntries,
        {
          metadataNamePrefix: newSolidName,
        },
      );
      try { repairedGeom.dispose(); } catch { }
      if (repairedGeom !== workingGeom) {
        try { workingGeom.dispose(); } catch { }
      }
      if (!rebuilt) continue;

      const repairResult = _repairSelfIntersections(rebuilt, {
        maxPasses: repairPasses,
      });
      if (!repairResult) {
        continue;
      }

      rebuilt.name = newSolidName;
      rebuilt.__offsetMethod = 'polyhedral_topology';
      output = rebuilt;
      break;
    }
  } finally {
    try { sourceGeom.dispose(); } catch { }
  }

  return output;
}


function _hasFiniteAuthoring(solid) {
  const vertProperties = Array.isArray(solid?._vertProperties)
    ? solid._vertProperties
    : Array.from(solid?._vertProperties || []);
  if (!vertProperties.length) return false;
  for (const value of vertProperties) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function _analyzeEdgeTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts)
    ? solid._triVerts
    : Array.from(solid?._triVerts || []);
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) {
    return { edgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0 };
  }
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
  for (const value of counts.values()) {
    if (value === 1) boundaryEdgeCount += 1;
    else if (value !== 2) nonManifoldEdgeCount += 1;
  }

  return {
    edgeCount: counts.size,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
  };
}

function _hasDegenerateTriangles(solid) {
  const triVerts = Array.isArray(solid?._triVerts)
    ? solid._triVerts
    : Array.from(solid?._triVerts || []);
  const vertProperties = Array.isArray(solid?._vertProperties)
    ? solid._vertProperties
    : Array.from(solid?._vertProperties || []);
  const triCount = (triVerts.length / 3) | 0;
  if (triCount === 0) return true;
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    if (_triangleArea(vertProperties, triIndex, triVerts) <= 1e-12) return true;
  }
  return false;
}

function _isValidPolyhedralOffset(solid) {
  if (!_hasFiniteAuthoring(solid)) return false;
  if (!_triangleCount(solid)) return false;
  if (_safeCall(() => !!solid._manifoldize()) !== true) return false;

  if (typeof solid._isCoherentlyOrientedManifold === 'function') {
    const coherent = _safeCall(() => solid._isCoherentlyOrientedManifold());
    if (coherent === false) return false;
  }

  const topology = _analyzeEdgeTopology(solid);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) return false;
  if (_hasDegenerateTriangles(solid)) return false;
  return true;
}

function toVec3(value) {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  return new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
}

function pointKey(point, precision = 6) {
  return `${point.x.toFixed(precision)},${point.y.toFixed(precision)},${point.z.toFixed(precision)}`;
}

function uniquePointsFromTriangles(triangles) {
  const out = [];
  const seen = new Map();
  for (const tri of Array.isArray(triangles) ? triangles : []) {
    for (const raw of [tri?.p1, tri?.p2, tri?.p3]) {
      const point = toVec3(raw);
      const key = pointKey(point);
      if (seen.has(key)) continue;
      seen.set(key, true);
      out.push(point);
    }
  }
  return out;
}

function determinant3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function solveLinear3(matrix, rhs) {
  const det = determinant3(matrix);
  if (Math.abs(det) <= SOLVER_EPS) return null;
  const replaceColumn = (column) => ([
    [column[0], matrix[0][1], matrix[0][2]],
    [column[1], matrix[1][1], matrix[1][2]],
    [column[2], matrix[2][1], matrix[2][2]],
  ]);
  const replaceColumn1 = (column) => ([
    [matrix[0][0], column[0], matrix[0][2]],
    [matrix[1][0], column[1], matrix[1][2]],
    [matrix[2][0], column[2], matrix[2][2]],
  ]);
  const replaceColumn2 = (column) => ([
    [matrix[0][0], matrix[0][1], column[0]],
    [matrix[1][0], matrix[1][1], column[1]],
    [matrix[2][0], matrix[2][1], column[2]],
  ]);
  return new THREE.Vector3(
    determinant3(replaceColumn(rhs)) / det,
    determinant3(replaceColumn1(rhs)) / det,
    determinant3(replaceColumn2(rhs)) / det
  );
}

function parseVec3Array(value, fallback = [0, 0, 0]) {
  const src = Array.isArray(value) ? value : fallback;
  return new THREE.Vector3(
    Number(src[0]) || 0,
    Number(src[1]) || 0,
    Number(src[2]) || 0
  );
}

function _stripEdgeSegmentSuffix(name) {
  return String(name || '').replace(/\[\d+\]$/u, '').trim();
}

function _fitCircle2D(points2D) {
  if (!Array.isArray(points2D) || points2D.length < 3) return null;

  let xx = 0;
  let xy = 0;
  let x1 = 0;
  let yy = 0;
  let y1 = 0;
  let xz = 0;
  let yz = 0;
  let z1 = 0;
  let count = 0;

  for (const entry of points2D) {
    const x = Number(entry?.[0]);
    const y = Number(entry?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const z = (x * x) + (y * y);
    xx += x * x;
    xy += x * y;
    x1 += x;
    yy += y * y;
    y1 += y;
    xz += x * z;
    yz += y * z;
    z1 += z;
    count += 1;
  }
  if (count < 3) return null;

  const solution = solveLinear3(
    [
      [xx, xy, x1],
      [xy, yy, y1],
      [x1, y1, count],
    ],
    [-xz, -yz, -z1],
  );
  if (!solution) return null;

  const cx = -solution.x * 0.5;
  const cy = -solution.y * 0.5;
  const radiusSquared = (cx * cx) + (cy * cy) - solution.z;
  if (!(radiusSquared > SOLVER_EPS)) return null;

  return {
    cx,
    cy,
    radius: Math.sqrt(radiusSquared),
  };
}

function _pointToLineDistance(point, linePoint, axis) {
  if (!isFiniteVec3(point) || !isFiniteVec3(linePoint) || !isFiniteVec3(axis) || axis.lengthSq() <= SOLVER_EPS) {
    return Infinity;
  }
  const delta = point.clone().sub(linePoint);
  const axial = axis.clone().multiplyScalar(delta.dot(axis));
  return delta.sub(axial).length();
}

function _resolveSphereNormalSign(face, center) {
  if (!face || !isFiniteVec3(center)) return 1;
  const samplePoint = face.centroid instanceof THREE.Vector3 ? face.centroid : face.point;
  if (!isFiniteVec3(samplePoint) || !isFiniteVec3(face.normal)) return 1;
  const radial = samplePoint.clone().sub(center);
  if (radial.lengthSq() <= SOLVER_EPS) return 1;
  return face.normal.dot(radial) >= 0 ? 1 : -1;
}

function _resolveCylinderNormalSign(face, center, axis) {
  if (!face || !isFiniteVec3(center) || !isFiniteVec3(axis) || axis.lengthSq() <= SOLVER_EPS) return 1;
  const samplePoint = face.centroid instanceof THREE.Vector3 ? face.centroid : face.point;
  if (!isFiniteVec3(samplePoint) || !isFiniteVec3(face.normal)) return 1;
  const local = samplePoint.clone().sub(center);
  const axial = axis.clone().multiplyScalar(local.dot(axis));
  const radial = local.sub(axial);
  if (radial.lengthSq() <= SOLVER_EPS) return 1;
  return face.normal.dot(radial) >= 0 ? 1 : -1;
}

function _resolveFilletCylinderNormalSign(faceA, faceB, center, radius, fallbackFace, axis) {
  const candidateSigns = [];
  for (const face of [faceA, faceB]) {
    if (!face || !isFiniteVec3(face.normal) || !Number.isFinite(face.offset)) continue;
    const signedDistance = face.normal.dot(center) - face.offset;
    if (!Number.isFinite(signedDistance)) continue;
    const tangentError = Math.abs(Math.abs(signedDistance) - radius);
    if (tangentError > Math.max(1e-3, radius * 1e-2)) continue;
    candidateSigns.push(-(Math.sign(signedDistance) || 1));
  }
  if (candidateSigns.length > 0) {
    const vote = candidateSigns.reduce((sum, sign) => sum + sign, 0);
    if (vote !== 0) return vote > 0 ? 1 : -1;
    return candidateSigns[0];
  }
  return _resolveCylinderNormalSign(fallbackFace, center, axis);
}

function _buildFilletCylinderSupport(face, metadata = {}, options = {}) {
  if (!face || !Array.isArray(face.points) || face.points.length < 3) return null;
  const faceMap = options.faceMap instanceof Map ? options.faceMap : null;
  if (!faceMap) return null;

  const edgeRef = String(metadata?.filletSideWallEdge || '').trim();
  if (!edgeRef.includes('|')) return null;
  const [rawFaceA, rawFaceB] = edgeRef.split('|');
  const faceAName = _stripEdgeSegmentSuffix(rawFaceA);
  const faceBName = _stripEdgeSegmentSuffix(rawFaceB);
  if (!faceAName || !faceBName) return null;

  const faceA = faceMap.get(faceAName) || null;
  const faceB = faceMap.get(faceBName) || null;
  if (!faceA || !faceB) return null;
  if (!isFiniteVec3(faceA.normal) || !isFiniteVec3(faceB.normal)) return null;

  const axis = new THREE.Vector3().crossVectors(faceA.normal, faceB.normal);
  if (axis.lengthSq() <= SOLVER_EPS) return null;
  axis.normalize();

  const basisSeed = Math.abs(axis.x) < 0.8
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const tangent1 = new THREE.Vector3().crossVectors(axis, basisSeed);
  if (tangent1.lengthSq() <= SOLVER_EPS) return null;
  tangent1.normalize();
  const tangent2 = new THREE.Vector3().crossVectors(axis, tangent1);
  if (tangent2.lengthSq() <= SOLVER_EPS) return null;
  tangent2.normalize();

  const origin = face.centroid instanceof THREE.Vector3 ? face.centroid : face.points[0];
  const projectedPoints = face.points.map((point) => {
    const local = point.clone().sub(origin);
    return [local.dot(tangent1), local.dot(tangent2)];
  });
  const circle = _fitCircle2D(projectedPoints);
  if (!circle || !(circle.radius > SOLVER_EPS)) return null;

  const center = origin.clone()
    .add(tangent1.clone().multiplyScalar(circle.cx))
    .add(tangent2.clone().multiplyScalar(circle.cy));

  let maxError = 0;
  let meanError = 0;
  for (const point of face.points) {
    const distance = _pointToLineDistance(point, center, axis);
    const error = Math.abs(distance - circle.radius);
    if (error > maxError) maxError = error;
    meanError += error;
  }
  meanError /= Math.max(1, face.points.length);
  const sourceScale = Number.isFinite(Number(options.sourceScale))
    ? Math.max(1, Number(options.sourceScale))
    : 1;
  const maxAllowedError = Math.max(1e-3, sourceScale * 5e-4, circle.radius * 1e-2);
  if (!(maxError <= maxAllowedError) || !Number.isFinite(meanError)) return null;

  return {
    kind: 'cylinder',
    faceName: face.name,
    center,
    axis,
    radius: circle.radius,
    normalSign: _resolveFilletCylinderNormalSign(faceA, faceB, center, circle.radius, face, axis),
  };
}

function _dedupeIncidentPlanes(planes) {
  const out = [];
  for (const plane of planes) {
    let merged = false;
    for (const existing of out) {
      const align = Math.abs(existing.normal.dot(plane.normal));
      const offsetDelta = Math.abs(existing.offset - plane.offset);
      if (align >= 1 - 1e-5 && offsetDelta <= PLANE_EPS) {
        merged = true;
        break;
      }
    }
    if (!merged) out.push(plane);
  }
  return out;
}

function _triangleCount(solid) {
  if (!solid || (!Array.isArray(solid._triVerts) && !(solid._triVerts instanceof Uint32Array))) {
    return 0;
  }
  return (solid._triVerts.length / 3) | 0;
}

function _toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function _toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function _dropDisconnectedIslandsByVolume(solid, minVolume) {
  if (!cppSolidCoreHasNativeDisconnectedIslandCleanup) return 0;
  const threshold = _toPositiveNumber(minVolume, 0);
  if (!threshold) return 0;
  const core = _safeCall(() => getSyncedCppSolidCore(solid));
  if (!core) return 0;
  const removed = _safeCall(() => core.removeDisconnectedIslandsByVolume(threshold));
  if (removed > 0) {
    syncSolidAuthoringStateFromCpp(solid, core);
    solid._dirty = true;
    solid._faceIndex = null;
    try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
    solid._manifold = null;
  }
  return Number.isFinite(removed) ? removed : 0;
}

function _safeCall(fn) {
  if (typeof fn !== 'function') return 0;
  try {
    return fn();
  } catch {
    return 0;
  }
}

function _repairSelfIntersections(solid, options = {}) {
  const maxPasses = Math.max(1, Math.min(MAX_OFFSET_REPAIR_PASSES, Number(options.maxPasses) || MAX_OFFSET_REPAIR_PASSES));
  const tryInternalCleanup = options.tryInternalCleanup !== false;
  const debug = options.debug === true;
  const modelScale = _modelScale(solid);
  const tinyBoundaryArea = _toNonNegativeNumber(
    options.tinyBoundaryArea,
    Math.max(DEFAULT_TINY_BOUNDARY_AREA, DEFAULT_TINY_BOUNDARY_AREA * (modelScale * modelScale)),
  );
  const islandTriangleCap = Math.max(0, Number.isFinite(Number(options.removeSmallIslandsMaxTriangles))
    ? Math.max(4, Math.trunc(Number(options.removeSmallIslandsMaxTriangles)))
    : DEFAULT_ISLAND_TRIANGLE_CAP);
  const tinyFaceIslandArea = _toPositiveNumber(
    options.cleanupTinyFaceIslandsArea,
    Math.max(
      DEFAULT_TINY_FACE_ISLAND_AREA,
      DEFAULT_TINY_FACE_ISLAND_AREA * (modelScale * modelScale),
    ),
  );
  const disconnectedMinVolume = _toPositiveNumber(
    options.removeDisconnectedMinVolume,
    Math.max(DEFAULT_DISCONNECTED_MIN_VOLUME, Math.pow(modelScale, 3) * 1e-10),
  );
  const baseWeldEpsilon = _toNonNegativeNumber(
    options.weldEpsilon,
    Math.max(1e-8, modelScale * 1e-8),
  );
  const hasDegenerateRemoval = typeof solid.removeDegenerateTriangles === 'function';
  const hasSelfIntersectionSplit = typeof solid.splitSelfIntersectingTriangles === 'function';
  const hasOppositeFaceCleanup = typeof solid.removeOppositeSingleEdgeFaces === 'function';
  const hasTinyBoundaryCleanup = typeof solid.removeTinyBoundaryTriangles === 'function';
  const hasSmallIslandCleanup = typeof solid.removeSmallIslands === 'function';
  const hasTinyFaceIslandCleanup = typeof solid.cleanupTinyFaceIslands === 'function';
  const hasVertexWeld = typeof solid._weldVerticesByEpsilon === 'function';
  const hasWindings = typeof solid.fixTriangleWindingsByAdjacency === 'function';
  const hasInternalCleanup = typeof solid.removeInternalTriangles === 'function';
  const hasDisconnectedCleanup = !!cppSolidCoreHasNativeDisconnectedIslandCleanup || hasSmallIslandCleanup;

  const log = (...args) => {
    if (!debug) return;
    console.log('[offset-repair]', ...args);
  };

  const topologySignature = (snap = _analyzeEdgeTopology(solid)) => (
    `${_triangleCount(solid)}|${snap.boundaryEdgeCount}|${snap.nonManifoldEdgeCount}`
  );

  const quickValid = () => {
    if (!_hasFiniteAuthoring(solid)) return false;
    if (_triangleCount(solid) <= 0) return false;
    if (_hasDegenerateTriangles(solid)) return false;
    const top = _analyzeEdgeTopology(solid);
    if (top.boundaryEdgeCount || top.nonManifoldEdgeCount) return false;
    if (typeof solid._isCoherentlyOrientedManifold === 'function') {
      const coherent = _safeCall(() => solid._isCoherentlyOrientedManifold());
      if (coherent === false) return false;
    }
    return true;
  };

  const runCount = (before, label, action) => {
    let result = 0;
    if (typeof action === 'function') {
      result = _safeCall(action);
    }
    const after = _triangleCount(solid);
    const changed = Number.isFinite(result) ? result : (after - before);
    if (before !== after || changed > 0) {
      log(`${label} before=${before} after=${after} delta=${after - before} result=${changed}`);
      return { changed: Math.abs(after - before) + (changed > 0 ? changed : 0), after };
    }
    return { changed: 0, after };
  };

  const removeTinyBoundary = (before, threshold) => {
    if (!hasTinyBoundaryCleanup || threshold <= 0) return { changed: 0, after: before };
    return runCount(before, 'removeTinyBoundaryTriangles', () => solid.removeTinyBoundaryTriangles(
      threshold,
      Math.min(3, 1 + (Number(options.tinyBoundaryIterations) || 0)),
    ));
  };

  let stableCountPasses = 0;
  let signature = topologySignature();

  for (let pass = 0; pass < maxPasses; pass++) {
    const passTopologyBefore = _analyzeEdgeTopology(solid);
    const passTriangleCount = _triangleCount(solid);
    if (quickValid() && _isValidPolyhedralOffset(solid)) return true;

    let didWorkThisPass = false;
    let nextCount = _triangleCount(solid);

    if (hasDegenerateRemoval) {
      const result = runCount(nextCount, 'removeDegenerateTriangles', () => solid.removeDegenerateTriangles());
      if (result.changed) {
        didWorkThisPass = true;
        nextCount = result.after;
      }
      if (nextCount <= 0) return false;
    }

    if (hasSelfIntersectionSplit) {
      const splitPasses = Math.min(3, 1 + Math.floor(pass / 2));
      for (let splitPass = 0; splitPass < splitPasses; splitPass++) {
        const beforeSplit = _triangleCount(solid);
        const splitResult = runCount(beforeSplit, `splitSelfIntersectingTriangles#${splitPass}`, () => solid.splitSelfIntersectingTriangles());
        if (splitResult.changed) {
          didWorkThisPass = true;
          nextCount = splitResult.after;
          _safeCall(() => solid.fixTriangleWindingsByAdjacency());
          continue;
        }
        break;
      }
    }

    if (hasOppositeFaceCleanup) {
      const result = runCount(nextCount, 'removeOppositeSingleEdgeFaces', () => solid.removeOppositeSingleEdgeFaces({
        normalDotThreshold: Number(options.oppositeNormalDotThreshold) || -0.95,
      }));
      if (result.changed) {
        didWorkThisPass = true;
        nextCount = result.after;
      }
    }

    if (hasTinyBoundaryCleanup && tinyBoundaryArea > 0) {
      const result = removeTinyBoundary(nextCount, tinyBoundaryArea);
      if (result.changed) {
        didWorkThisPass = true;
        nextCount = result.after;
      }
    }

    if (nextCount > 0 && tryInternalCleanup && hasInternalCleanup) {
      const shouldRunInternal = (
        passTopologyBefore.boundaryEdgeCount
        || passTopologyBefore.nonManifoldEdgeCount
        || pass > 2
        || nextCount <= Math.max(4, passTriangleCount * 0.8)
      );
      if (shouldRunInternal) {
        const removed = runCount(nextCount, `removeInternalTriangles#${pass}`, () => solid.removeInternalTriangles());
        if (removed.changed) {
          didWorkThisPass = true;
          nextCount = removed.after;
        }
        // Raycast fallback: if winding-based removal stalled, try ray-based classification
        if (!removed.changed && pass > 1 && passTopologyBefore.nonManifoldEdgeCount === 0
            && typeof solid.removeInternalTrianglesByRaycast === 'function') {
          const raycastResult = runCount(nextCount, 'removeInternalTriangles(raycast)', () => solid.removeInternalTrianglesByRaycast());
          if (raycastResult.changed) {
            didWorkThisPass = true;
            nextCount = raycastResult.after;
          }
        }
      }
    }

    if (hasSmallIslandCleanup && islandTriangleCap > 0 && nextCount > 0) {
      const islandResult = runCount(nextCount, 'removeSmallIslands', () => solid.removeSmallIslands({
        maxTriangles: Math.max(islandTriangleCap, Math.max(4, Math.floor(nextCount * 0.25))),
        removeInternal: true,
        removeExternal: true,
      }));
      if (islandResult.changed) {
        didWorkThisPass = true;
        nextCount = islandResult.after;
      }
    }

    if (hasTinyFaceIslandCleanup && tinyFaceIslandArea > 0 && nextCount > 0) {
      const tinyFaceResult = runCount(nextCount, 'cleanupTinyFaceIslands', () => solid.cleanupTinyFaceIslands(tinyFaceIslandArea));
      if (tinyFaceResult.changed) {
        didWorkThisPass = true;
        nextCount = tinyFaceResult.after;
      }
    }

    if (disconnectedMinVolume > 0 && hasDisconnectedCleanup && pass >= 1 && nextCount > 0) {
      const beforeDisconnect = nextCount;
      const removedDisconnected = _dropDisconnectedIslandsByVolume(solid, disconnectedMinVolume * Math.pow(2, pass));
      if (removedDisconnected > 0) {
        didWorkThisPass = true;
        nextCount = _triangleCount(solid);
      } else if (pass >= 2 && passTopologyBefore.nonManifoldEdgeCount > 0 && hasSmallIslandCleanup) {
        const cleanupResult = runCount(beforeDisconnect, 'removeSmallIslands(extternalOnly)', () => solid.removeSmallIslands({
          maxTriangles: Math.max(islandTriangleCap, 2048),
          removeInternal: true,
          removeExternal: false,
        }));
        if (cleanupResult.changed) {
          didWorkThisPass = true;
          nextCount = cleanupResult.after;
        }
      }
    }

    if (hasVertexWeld && baseWeldEpsilon > 0 && nextCount > 0) {
      const weldEpsilon = Math.min(
        Math.max(baseWeldEpsilon * Math.pow(1.6, pass), modelScale * 1e-9),
        Math.max(1e-4, modelScale * 1e-4),
      );
      const welded = runCount(nextCount, `weldVerticesByEpsilon#${pass}`, () => solid._weldVerticesByEpsilon(weldEpsilon, {
        rebuildManifold: false,
      }));
      if (welded.changed) {
        didWorkThisPass = true;
        nextCount = welded.after;
      }
    }

    if (hasDegenerateRemoval) {
      const finalDegenerate = runCount(nextCount, 'removeDegenerateTriangles(final)', () => solid.removeDegenerateTriangles());
      if (finalDegenerate.changed) {
        didWorkThisPass = true;
        nextCount = finalDegenerate.after;
      }
    }

    if (hasWindings) {
      _safeCall(() => solid.fixTriangleWindingsByAdjacency());
    }

    if (_isValidPolyhedralOffset(solid)) {
      return true;
    }

    const nextSignature = topologySignature();
    if (nextSignature === signature && !didWorkThisPass) {
      stableCountPasses += 1;
    } else {
      stableCountPasses = 0;
      signature = nextSignature;
      didWorkThisPass = false;
    }

    if (stableCountPasses > STABLE_PASS_LIMIT) {
      return _isValidPolyhedralOffset(solid);
    }
  }

  return _isValidPolyhedralOffset(solid);
}

function dedupeSupports(supports) {
  const out = [];
  for (const support of supports) {
    if (!support) continue;
    let merged = false;
    for (const existing of out) {
      if (existing.kind !== support.kind) continue;
      if (existing.faceName === support.faceName) {
        merged = true;
        break;
      }
      if (support.kind === 'plane') {
        const align = Math.abs(existing.normal.dot(support.normal));
        const offsetDelta = Math.abs(existing.offset - support.offset);
        if (align >= 1 - 1e-5 && offsetDelta <= PLANE_EPS) {
          merged = true;
          break;
        }
      }
    }
    if (!merged) out.push(support);
  }
  return out;
}

function analyzeFaceEntry(faceEntry, faceNormalEntry, solidCentroid, options = {}) {
  const name = String(faceEntry?.faceName || '').trim();
  if (!name) return null;
  const points = uniquePointsFromTriangles(faceEntry?.triangles);
  if (points.length < 3) return null;

  let normal = toVec3(faceNormalEntry?.normal);
  if (!(faceNormalEntry?.faceFound && faceNormalEntry?.validNormal) || normal.lengthSq() <= 1e-12) {
    const v0 = points[0];
    const v1 = points[1];
    const v2 = points[2];
    normal = v1.clone().sub(v0).cross(v2.clone().sub(v0));
  }
  if (normal.lengthSq() <= 1e-12) return null;
  normal.normalize();

  const centroid = new THREE.Vector3();
  for (const point of points) centroid.add(point);
  centroid.multiplyScalar(1 / points.length);

  const sourceScale = Number.isFinite(Number(options.sourceScale))
    ? Math.max(1, Number(options.sourceScale))
    : _modelScale(faceEntry?._sourceSolid);
  const normalOffset = Math.max(1e-6, sourceScale * 1e-5);
  const orientedNormal = _orientFaceNormalOutward(normal, centroid, {
    insideTester: options.pointInsideTester,
    solidCentroid,
    probeOffset: normalOffset,
  });

  if (!orientedNormal) return null;

  normal.copy(orientedNormal);

  const offset = normal.dot(points[0]);
  let maxPlaneDistance = 0;
  for (const point of points) {
    const dist = Math.abs(normal.dot(point) - offset);
    if (dist > maxPlaneDistance) maxPlaneDistance = dist;
  }

  return {
    name,
    normal,
    offset,
    centroid,
    planar: maxPlaneDistance <= PLANE_EPS,
    point: points[0].clone(),
    points,
    maxPlaneDistance,
  };
}

function buildFaceSupport(face, metadata = {}, options = {}) {
  const rawType = String(metadata?.type || metadata?.surfaceType || metadata?.kind || '').trim().toLowerCase();
  const rawFaceType = String(metadata?.faceType || '').trim().toLowerCase();
  let type = rawType;
  if (type === 'cylinder' || type === 'cyl') type = 'cylindrical';
  if (type === 'cone' || type === 'conic') type = 'conical';
  if (type === 'sphere' || type === 'spheric') type = 'spherical';
  if (type === 'torus' || type === 'toroid') type = 'toroidal';
  const sourceScale = Number.isFinite(Number(options.sourceScale))
    ? Math.max(1, Number(options.sourceScale))
    : 1;
  const relaxedPlanarTolerance = Math.max(PLANE_EPS, sourceScale * 1e-5);
  const canUseRelaxedPlanarity = (
    rawFaceType === 'sidewall'
    || rawFaceType === 'endcap'
    || typeof metadata?.sourceEdgeName === 'string'
  );
  const treatAsPlanar = face.planar || (
    canUseRelaxedPlanarity
    && Number.isFinite(face?.maxPlaneDistance)
    && face.maxPlaneDistance <= relaxedPlanarTolerance
  );

  if (
    !type
    && (metadata?.filletSideWall === true || metadata?.filletMergedSideWall === true || face?.name?.endsWith?.('_TUBE_Outer'))
  ) {
    const filletCylinder = _buildFilletCylinderSupport(face, metadata, options);
    if (filletCylinder) return filletCylinder;
  }

  if (!type) {
    if (treatAsPlanar) {
      return { kind: 'plane', faceName: face.name, normal: face.normal.clone(), offset: face.offset };
    }
    return { kind: 'vertex_tangent', faceName: face.name };
  }
  if (type === 'planar' || type === 'plane') {
    return { kind: 'plane', faceName: face.name, normal: face.normal.clone(), offset: face.offset };
  }
  if (type === 'spherical') {
    const radius = Number(metadata.radius);
    if (!Number.isFinite(radius) || radius <= 0) return { kind: 'vertex_tangent', faceName: face.name };
    const center = parseVec3Array(metadata.center, [0, 0, 0]);
    return {
      kind: 'sphere',
      faceName: face.name,
      center,
      radius,
      normalSign: _resolveSphereNormalSign(face, center),
    };
  }
  if (type === 'cylindrical') {
    const radius = Number(metadata.radius);
    if (!Number.isFinite(radius) || radius <= 0) return { kind: 'vertex_tangent', faceName: face.name };
    const center = parseVec3Array(metadata.center, [0, 0, 0]);
    const axis = parseVec3Array(metadata.axis, [0, 1, 0]).normalize();
    return {
      kind: 'cylinder',
      faceName: face.name,
      center,
      axis,
      radius,
      normalSign: _resolveCylinderNormalSign(face, center, axis),
    };
  }
  if (type === 'conical') {
    const radiusBottom = Number(metadata.radiusBottom);
    const radiusTop = Number(metadata.radiusTop);
    const height = Number(metadata.height);
    if (!Number.isFinite(radiusBottom) || !Number.isFinite(radiusTop) || !Number.isFinite(height)) {
      return { kind: 'vertex_tangent', faceName: face.name };
    }
    return {
      kind: 'cone',
      faceName: face.name,
      center: parseVec3Array(metadata.center, [0, 0, 0]),
      axis: parseVec3Array(metadata.axis, [0, 1, 0]).normalize(),
      radiusBottom,
      radiusTop,
      height,
    };
  }
  if (type === 'toroidal') {
    const majorRadius = Number(metadata.majorRadius);
    const tubeRadius = Number(metadata.tubeRadius);
    if (!Number.isFinite(majorRadius) || !Number.isFinite(tubeRadius) || majorRadius <= 0 || tubeRadius <= 0) {
      return { kind: 'vertex_tangent', faceName: face.name };
    }
    return {
      kind: 'torus',
      faceName: face.name,
      center: parseVec3Array(metadata.center, [0, 0, 0]),
      axis: parseVec3Array(metadata.axis, [0, 1, 0]).normalize(),
      majorRadius,
      tubeRadius,
    };
  }
  return { kind: 'vertex_tangent', faceName: face.name };
}

function supportResidualAndGradient(support, point, distance) {
  if (!support) return null;
  const effectiveDistance = Number.isFinite(Number(support?.distanceOverride))
    ? Number(support.distanceOverride)
    : distance;
  if (support.kind === 'plane') {
    return {
      residual: support.normal.dot(point) - (support.offset + effectiveDistance),
      gradient: support.normal.clone(),
    };
  }
  if (support.kind === 'sphere') {
    const delta = point.clone().sub(support.center);
    const len = delta.length();
    if (len <= SOLVER_EPS) return null;
    const normalSign = Number.isFinite(Number(support.normalSign)) ? Math.sign(Number(support.normalSign)) || 1 : 1;
    return {
      residual: (normalSign * (len - support.radius)) - effectiveDistance,
      gradient: delta.multiplyScalar(normalSign / len),
    };
  }
  if (support.kind === 'cylinder') {
    const local = point.clone().sub(support.center);
    const axial = support.axis.clone().multiplyScalar(local.dot(support.axis));
    const radial = local.sub(axial);
    const radialLen = radial.length();
    if (radialLen <= SOLVER_EPS) return null;
    const normalSign = Number.isFinite(Number(support.normalSign)) ? Math.sign(Number(support.normalSign)) || 1 : 1;
    return {
      residual: (normalSign * (radialLen - support.radius)) - effectiveDistance,
      gradient: radial.multiplyScalar(normalSign / radialLen),
    };
  }
  if (support.kind === 'cone') {
    const local = point.clone().sub(support.center);
    const axisCoord = local.dot(support.axis);
    const t = axisCoord + (support.height * 0.5);
    const slope = support.height > SOLVER_EPS
      ? (support.radiusTop - support.radiusBottom) / support.height
      : 0;
    const axial = support.axis.clone().multiplyScalar(axisCoord);
    const radial = local.sub(axial);
    const radialLen = radial.length();
    if (radialLen <= SOLVER_EPS) return null;
    const baseRadius = support.radiusBottom + (slope * t);
    const grad = radial.clone().multiplyScalar(1 / radialLen).sub(
      support.axis.clone().multiplyScalar(slope)
    );
    const gradLen = grad.length();
    if (gradLen <= SOLVER_EPS) return null;
    const offsetScale = gradLen;
    return {
      residual: radialLen - baseRadius - (effectiveDistance * offsetScale),
      gradient: grad.multiplyScalar(1 / gradLen),
    };
  }
  if (support.kind === 'torus') {
    const local = point.clone().sub(support.center);
    const axisCoord = local.dot(support.axis);
    const axial = support.axis.clone().multiplyScalar(axisCoord);
    const radialVec = local.sub(axial);
    const radialLen = radialVec.length();
    if (radialLen <= SOLVER_EPS) return null;
    const tubeVec = new THREE.Vector2(radialLen - support.majorRadius, axisCoord);
    const tubeLen = tubeVec.length();
    if (tubeLen <= SOLVER_EPS) return null;
    const radialGrad = radialVec.clone().multiplyScalar((tubeVec.x / tubeLen) / radialLen);
    const axialGrad = support.axis.clone().multiplyScalar(tubeVec.y / tubeLen);
    const gradient = radialGrad.add(axialGrad);
    const gradLen = gradient.length();
    if (gradLen <= SOLVER_EPS) return null;
    return {
      residual: tubeLen - (support.tubeRadius + effectiveDistance),
      gradient: gradient.multiplyScalar(1 / gradLen),
    };
  }
  return null;
}

function solveSupportVertex(originalPoint, supports, distance) {
  let point = originalPoint.clone();
  for (let iter = 0; iter < MAX_GN_ITERS; iter++) {
    const ata = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const atb = [0, 0, 0];
    let maxResidual = 0;
    let used = 0;
    const rows = [];
    for (const support of supports) {
      const sample = supportResidualAndGradient(support, point, distance);
      if (!sample) continue;
      const { residual, gradient } = sample;
      maxResidual = Math.max(maxResidual, Math.abs(residual));
      rows.push({ residual, gradient });
      const gx = gradient.x;
      const gy = gradient.y;
      const gz = gradient.z;
      ata[0][0] += gx * gx;
      ata[0][1] += gx * gy;
      ata[0][2] += gx * gz;
      ata[1][0] += gy * gx;
      ata[1][1] += gy * gy;
      ata[1][2] += gy * gz;
      ata[2][0] += gz * gx;
      ata[2][1] += gz * gy;
      ata[2][2] += gz * gz;
      atb[0] += gx * residual;
      atb[1] += gy * residual;
      atb[2] += gz * residual;
      used++;
    }
    if (!used) return null;
    if (maxResidual <= RESIDUAL_EPS) return point;
    let delta = null;
    if (rows.length === 1) {
      const g = rows[0].gradient;
      const denom = Math.max(SOLVER_EPS, g.dot(g));
      delta = g.clone().multiplyScalar(rows[0].residual / denom);
    } else if (rows.length === 2) {
      const g0 = rows[0].gradient;
      const g1 = rows[1].gradient;
      const gram = [
        [g0.dot(g0), g0.dot(g1)],
        [g1.dot(g0), g1.dot(g1)],
      ];
      const det = (gram[0][0] * gram[1][1]) - (gram[0][1] * gram[1][0]);
      if (Math.abs(det) > SOLVER_EPS) {
        const lambda0 = ((rows[0].residual * gram[1][1]) - (gram[0][1] * rows[1].residual)) / det;
        const lambda1 = ((gram[0][0] * rows[1].residual) - (rows[0].residual * gram[1][0])) / det;
        delta = g0.clone().multiplyScalar(lambda0).add(g1.clone().multiplyScalar(lambda1));
      }
    } else {
      delta = solveLinear3(ata, atb);
    }
    if (!delta) return null;
    point = point.clone().sub(delta);
    if (delta.length() <= ITERATION_EPS) return point;
  }
  let finalResidual = 0;
  let used = 0;
  for (const support of supports) {
    const sample = supportResidualAndGradient(support, point, distance);
    if (!sample) continue;
    finalResidual = Math.max(finalResidual, Math.abs(sample.residual));
    used++;
  }
  if (!used || finalResidual > Math.max(RESIDUAL_EPS * 2, 1e-3)) return null;
  return point;
}

function buildVertexIncidentFaceMap(sourceSolid, faceMap, solidCentroid = null) {
  const triVerts = Array.isArray(sourceSolid?._triVerts)
    ? sourceSolid._triVerts
    : Array.from(sourceSolid?._triVerts || []);
  const vertProperties = Array.isArray(sourceSolid?._vertProperties)
    ? sourceSolid._vertProperties
    : Array.from(sourceSolid?._vertProperties || []);
  const triIDs = Array.isArray(sourceSolid?._triIDs)
    ? sourceSolid._triIDs
    : Array.from(sourceSolid?._triIDs || []);
  const idToFaceName = sourceSolid?._idToFaceName instanceof Map
    ? sourceSolid._idToFaceName
    : new Map();
  const vertexFaceMap = new Map();
  const edgeMap = new Map();
  const vertexFaceNormalMap = new Map();
  for (let triIndex = 0; triIndex * 3 + 2 < triVerts.length; triIndex++) {
    const faceName = faceMap.get(idToFaceName.get(triIDs[triIndex]) || '')?.name || idToFaceName.get(triIDs[triIndex]);
    if (!faceName || !faceMap.has(faceName)) continue;
    const analyzedFace = faceMap.get(faceName) || null;
    const a = triVerts[triIndex * 3 + 0] >>> 0;
    const b = triVerts[triIndex * 3 + 1] >>> 0;
    const c = triVerts[triIndex * 3 + 2] >>> 0;
    const ia = a * 3;
    const ib = b * 3;
    const ic = c * 3;
    const ax = vertProperties[ia + 0] || 0;
    const ay = vertProperties[ia + 1] || 0;
    const az = vertProperties[ia + 2] || 0;
    const bx = vertProperties[ib + 0] || 0;
    const by = vertProperties[ib + 1] || 0;
    const bz = vertProperties[ib + 2] || 0;
    const cx = vertProperties[ic + 0] || 0;
    const cy = vertProperties[ic + 1] || 0;
    const cz = vertProperties[ic + 2] || 0;
    const triangleCentroid = new THREE.Vector3(
      (ax + bx + cx) / 3,
      (ay + by + cy) / 3,
      (az + bz + cz) / 3,
    );
    const vertexNormal = new THREE.Vector3(
      ((by - ay) * (cz - az)) - ((bz - az) * (cy - ay)),
      ((bz - az) * (cx - ax)) - ((bx - ax) * (cz - az)),
      ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax)),
    );
    if (vertexNormal.lengthSq() > SOLVER_EPS) {
      vertexNormal.normalize();
      const analyzedNormal = analyzedFace?.normal;
      if (isFiniteVec3(analyzedNormal) && analyzedNormal.lengthSq() > SOLVER_EPS) {
        if (analyzedNormal.dot(vertexNormal) < 0) {
          vertexNormal.negate();
        }
      } else {
        const centroidDirection = solidCentroid instanceof THREE.Vector3
          ? triangleCentroid.clone().sub(solidCentroid)
          : null;
        if (centroidDirection?.lengthSq() > SOLVER_EPS && centroidDirection.dot(vertexNormal) < 0) {
          vertexNormal.negate();
        }
      }
    } else {
      const faceNormal = analyzedFace?.normal;
      if (isFiniteVec3(faceNormal) && faceNormal.lengthSq() > SOLVER_EPS) {
        vertexNormal.copy(faceNormal).normalize();
      } else {
        vertexNormal.set(0, 0, 0);
      }
    }
    if (vertexNormal.lengthSq() > SOLVER_EPS) {
      const analyzedNormal = analyzedFace?.normal;
      if (isFiniteVec3(analyzedNormal) && analyzedNormal.lengthSq() > SOLVER_EPS && analyzedNormal.dot(vertexNormal) < 0) {
        vertexNormal.negate();
      }
    }
    for (const idx of [a, b, c]) {
      let set = vertexFaceMap.get(idx);
      if (!set) {
        set = new Set();
        vertexFaceMap.set(idx, set);
      }
      set.add(faceName);
      const normalKey = `${idx}|${faceName}`;
      if (vertexNormal) {
        const accum = vertexFaceNormalMap.get(normalKey) || new THREE.Vector3();
        accum.add(vertexNormal);
        vertexFaceNormalMap.set(normalKey, accum);
      }
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = { a: Math.min(u, v), b: Math.max(u, v), faces: new Set() };
        edgeMap.set(key, entry);
      }
      entry.faces.add(faceName);
    }
  }
  for (const [key, normal] of vertexFaceNormalMap.entries()) {
    if (normal.lengthSq() > SOLVER_EPS) normal.normalize();
    else vertexFaceNormalMap.delete(key);
  }
  return { vertexFaceMap, edgeMap, vertexFaceNormalMap };
}

export function analyzePolyhedralSolid(sourceSolid) {
  if (!sourceSolid || typeof sourceSolid.getFaces !== 'function' || typeof sourceSolid.getFaceNormal !== 'function') {
    return null;
  }

  const positionsRaw = Array.isArray(sourceSolid._vertProperties)
    ? sourceSolid._vertProperties
    : Array.from(sourceSolid._vertProperties || []);
  const triVerts = Array.isArray(sourceSolid._triVerts)
    ? sourceSolid._triVerts
    : Array.from(sourceSolid._triVerts || []);
  if (positionsRaw.length < 9 || triVerts.length < 3) return null;

  const vertices = [];
  for (let i = 0; i + 2 < positionsRaw.length; i += 3) {
    vertices.push(new THREE.Vector3(positionsRaw[i], positionsRaw[i + 1], positionsRaw[i + 2]));
  }

  const uniquePointMap = new Map();
  const uniquePoints = [];
  for (const point of vertices) {
    const key = pointKey(point);
    if (uniquePointMap.has(key)) continue;
    uniquePointMap.set(key, true);
    uniquePoints.push(point);
  }
  const solidCentroid = new THREE.Vector3();
  for (const point of uniquePoints) solidCentroid.add(point);
  solidCentroid.multiplyScalar(1 / Math.max(1, uniquePoints.length));

  const faceEntries = sourceSolid.getFaces(false) || [];
  if (!faceEntries.length) return null;
  const pointInsideTester = _buildPointInsideTester(sourceSolid, {
    probeOffset: Math.max(1e-6, _modelScale(sourceSolid) * 1e-5),
  });

  const faceMap = new Map();
  for (const faceEntry of faceEntries) {
    const faceNormal = sourceSolid.getFaceNormal(faceEntry.faceName);
    const face = analyzeFaceEntry(faceEntry, faceNormal, solidCentroid, {
      pointInsideTester,
      sourceScale: _modelScale(sourceSolid),
    });
    if (!face) return null;
    const metadata = (typeof sourceSolid.getFaceMetadata === 'function')
      ? (sourceSolid.getFaceMetadata(face.name) || {})
      : {};
    face.metadata = metadata;
    faceMap.set(face.name, face);
  }

  for (const face of faceMap.values()) {
    const support = buildFaceSupport(face, face.metadata, {
      faceMap,
      sourceScale: _modelScale(sourceSolid),
    });
    if (!support) return null;
    face.support = support;
  }

  const { vertexFaceMap, edgeMap, vertexFaceNormalMap } = buildVertexIncidentFaceMap(sourceSolid, faceMap, solidCentroid);
  if (!vertexFaceMap.size) return null;

  return {
    solidCentroid,
    faceMap,
    vertices,
    triVerts,
    triIDs: Array.isArray(sourceSolid._triIDs) ? sourceSolid._triIDs : Array.from(sourceSolid._triIDs || []),
    idToFaceName: sourceSolid._idToFaceName instanceof Map ? sourceSolid._idToFaceName : new Map(),
    vertexFaceMap,
    edgeMap,
    vertexFaceNormalMap,
    pointInsideTester,
  };
}

function _faceNameForShell(faceName, newSolidName) {
  return _applyNamePrefix(faceName, newSolidName);
}

function _innerFaceNameForShell(faceName, newSolidName) {
  return _applyNamePrefix(`INNER_${faceName}`, newSolidName);
}

function _rimFaceNameForShell(faceName, a, b, newSolidName) {
  return _applyNamePrefix(`RIM_${faceName}_${Math.min(a, b)}_${Math.max(a, b)}`, newSolidName);
}

function _vecToArr(v) {
  return [v.x, v.y, v.z];
}

function _incrementDiagnosticCounter(bucket, key) {
  if (!bucket || typeof bucket !== 'object') return;
  const normalizedKey = String(key || '').trim() || 'UNKNOWN';
  bucket[normalizedKey] = (Number(bucket[normalizedKey]) || 0) + 1;
}

function _buildRemovedBoundarySupport(face) {
  if (!face) return null;
  const support = face.support || null;
  if (support && support.kind !== 'vertex_tangent') {
    return {
      ...support,
      distanceOverride: 0,
    };
  }
  if (isFiniteVec3(face.normal) && Number.isFinite(face.offset)) {
    return {
      kind: 'plane',
      faceName: face.name,
      normal: face.normal.clone(),
      offset: face.offset,
      distanceOverride: 0,
    };
  }
  return null;
}

function _pointNearRemovedBoundary(point, removedBoundarySupports, tolerance) {
  if (!isFiniteVec3(point) || !Array.isArray(removedBoundarySupports) || removedBoundarySupports.length === 0) {
    return false;
  }
  const tol = Math.max(1e-8, Number(tolerance) || 0);
  for (const support of removedBoundarySupports) {
    const sample = supportResidualAndGradient(support, point, 0);
    if (!sample) continue;
    if (Math.abs(Number(sample.residual) || 0) <= tol) return true;
  }
  return false;
}

function _recordInwardTriangleEscape(diagnostics, triangleKind, faceName, p0, p1, p2, options = {}) {
  if (!diagnostics?.enabled) return;
  if (triangleKind === 'outer') return;

  const insideTester = typeof options.insideTester === 'function' ? options.insideTester : null;
  if (!insideTester) return;
  const sourcePointKeys = options.sourcePointKeys instanceof Set ? options.sourcePointKeys : null;
  const removedBoundarySupports = Array.isArray(options.removedBoundarySupports) ? options.removedBoundarySupports : [];
  const removedBoundaryTolerance = Math.max(1e-8, Number(options.removedBoundaryTolerance) || 0);
  const points = [p0, p1, p2].map((point) => new THREE.Vector3(
    Number(point?.[0]) || 0,
    Number(point?.[1]) || 0,
    Number(point?.[2]) || 0,
  ));
  const vertices = points.map((point) => {
    const onSource = !!sourcePointKeys?.has?.(pointKey(point, 8));
    const inside = _safePointInsideTest(insideTester, point);
    const onRemovedBoundary = _pointNearRemovedBoundary(point, removedBoundarySupports, removedBoundaryTolerance);
    return {
      point: [point.x, point.y, point.z],
      onSource,
      inside,
      onRemovedBoundary,
    };
  });
  const centroid = new THREE.Vector3()
    .add(points[0])
    .add(points[1])
    .add(points[2])
    .multiplyScalar(1 / 3);
  const centroidInside = _safePointInsideTest(insideTester, centroid);
  const centroidOnRemovedBoundary = _pointNearRemovedBoundary(centroid, removedBoundarySupports, removedBoundaryTolerance);
  const nonSourceOutsideCount = vertices.reduce((count, entry) => (
    count + ((!entry.onSource && entry.inside === false && !entry.onRemovedBoundary) ? 1 : 0)
  ), 0);
  if ((centroidInside !== false || centroidOnRemovedBoundary) && nonSourceOutsideCount === 0) return;

  diagnostics.escapedTriangleCount += 1;
  diagnostics.escapedVertexCount += nonSourceOutsideCount;
  _incrementDiagnosticCounter(diagnostics.escapedFaceCounts, faceName);
  _incrementDiagnosticCounter(diagnostics.escapedKindCounts, triangleKind);
  if (diagnostics.escapedTriangles.length < diagnostics.maxRecordedTriangles) {
    diagnostics.escapedTriangles.push({
      triangleKind,
      faceName,
      centroid: [centroid.x, centroid.y, centroid.z],
      centroidInside,
      vertices,
    });
  }
}

function _buildShellFaceMetadata(sourceSolid, newSolidName, removeFaceNames = new Set()) {
  const sourceMap = (sourceSolid?._faceMetadata instanceof Map)
    ? sourceSolid._faceMetadata
    : new Map();
  const out = new Map();
  for (const [faceName, metadata] of sourceMap.entries()) {
    if (removeFaceNames.has(faceName)) continue;
    const outerName = _faceNameForShell(faceName, newSolidName);
    const innerName = _innerFaceNameForShell(faceName, newSolidName);
    out.set(outerName, _cloneMetadataValue(metadata));
    out.set(innerName, {
      ..._cloneMetadataValue(metadata),
      shellRole: 'inner',
      sourceFaceName: faceName,
    });
  }
  return out;
}

function _buildPolyhedralShellSolid(sourceSolid, analysis, outerVertices, innerVertices, options = {}) {
  const {
    newSolidName = `${sourceSolid?.name || 'Solid'}_shell`,
    removeFaceNames = [],
    triangleDiagnostics = null,
    insideTester = null,
    sourcePointKeys = null,
    removedBoundarySupports = null,
    removedBoundaryTolerance = 0,
  } = options;

  const removeFaceSet = new Set(Array.from(removeFaceNames || [], (faceName) => String(faceName || '').trim()).filter(Boolean));
  if (!removeFaceSet.size) return null;

  const out = new Solid();
  out.name = newSolidName;
  const bridgeEdges = new Map();
  const addTriangle = (triangleKind, faceName, p0, p1, p2) => {
    _recordInwardTriangleEscape(
      triangleDiagnostics,
      triangleKind,
      faceName,
      p0,
      p1,
      p2,
      {
        insideTester,
        sourcePointKeys,
        removedBoundarySupports,
        removedBoundaryTolerance,
      },
    );
    out.addTriangle(faceName, p0, p1, p2);
  };

  for (let triIndex = 0; triIndex * 3 + 2 < analysis.triVerts.length; triIndex++) {
    const a = analysis.triVerts[triIndex * 3 + 0] >>> 0;
    const b = analysis.triVerts[triIndex * 3 + 1] >>> 0;
    const c = analysis.triVerts[triIndex * 3 + 2] >>> 0;
    const faceID = analysis.triIDs[triIndex];
    const faceName = analysis.idToFaceName.get(faceID);
    if (!faceName) return null;

    if (!removeFaceSet.has(faceName)) {
      const outerFaceName = _faceNameForShell(faceName, newSolidName);
      const innerFaceName = _innerFaceNameForShell(faceName, newSolidName);
      addTriangle(
        'outer',
        outerFaceName,
        _vecToArr(outerVertices[a]),
        _vecToArr(outerVertices[b]),
        _vecToArr(outerVertices[c]),
      );
      addTriangle(
        'inner',
        innerFaceName,
        _vecToArr(innerVertices[c]),
        _vecToArr(innerVertices[b]),
        _vecToArr(innerVertices[a]),
      );
      continue;
    }

    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      if (bridgeEdges.has(key)) continue;
      const edge = analysis.edgeMap.get(key);
      const incidentFaces = edge?.faces instanceof Set ? Array.from(edge.faces) : [];
      const keptNeighbors = incidentFaces.filter((incidentFaceName) => !removeFaceSet.has(incidentFaceName));
      if (!keptNeighbors.length) continue;
      bridgeEdges.set(key, { a: u, b: v, faceName });
    }
  }

  for (const { a, b, faceName } of bridgeEdges.values()) {
    const outerA = outerVertices[a];
    const outerB = outerVertices[b];
    const innerA = innerVertices[a];
    const innerB = innerVertices[b];
    if (!outerA || !outerB || !innerA || !innerB) return null;
    const rimFaceName = _rimFaceNameForShell(faceName, a, b, newSolidName);
    addTriangle(
      'rim',
      rimFaceName,
      _vecToArr(outerA),
      _vecToArr(outerB),
      _vecToArr(innerB),
    );
    addTriangle(
      'rim',
      rimFaceName,
      _vecToArr(outerA),
      _vecToArr(innerB),
      _vecToArr(innerA),
    );
  }

  out._faceMetadata = _buildShellFaceMetadata(sourceSolid, newSolidName, removeFaceSet);
  out._auxEdges = Array.isArray(sourceSolid?._auxEdges) ? [...sourceSolid._auxEdges] : [];
  out.__offsetMethod = 'polyhedral_topology_shell';
  if (typeof out.fixTriangleWindingsByAdjacency === 'function') {
    _safeCall(() => out.fixTriangleWindingsByAdjacency());
  }
  return out;
}

export function buildOffsetPolyhedralSolid(sourceSolid, analysis, distance, options = {}) {
  if (!analysis?.faceMap || !analysis?.vertexFaceMap) return null;
  const dist = Number(distance);
  if (!Number.isFinite(dist)) return null;

  const {
    newSolidName = `${sourceSolid?.name || 'Solid'}_${Math.abs(dist)}`,
    removeFaceNames = [],
    debugSupportFailures = false,
  } = options;
  const removeFaceSet = new Set(Array.from(removeFaceNames || [], (faceName) => String(faceName || '').trim()).filter(Boolean));
  const insideTester = typeof analysis?.pointInsideTester === 'function' ? analysis.pointInsideTester : null;
  const modelScale = _modelScale(sourceSolid);
  const removedBoundaryTolerance = Math.max(1e-6, modelScale * 1e-5);
  const removedBoundarySupports = removeFaceSet.size
    ? Array.from(removeFaceSet, (faceName) => _buildRemovedBoundarySupport(analysis.faceMap.get(faceName))).filter(Boolean)
    : [];
  const inwardTriangleDiagnostics = (dist < 0 && insideTester && removeFaceSet.size)
    ? {
      enabled: true,
      mode: 'triangle_generation',
      escapedTriangleCount: 0,
      escapedVertexCount: 0,
      escapedFaceCounts: {},
      escapedKindCounts: {},
      maxRecordedTriangles: 24,
      escapedTriangles: [],
    }
    : null;
  const sourcePointKeys = inwardTriangleDiagnostics
    ? new Set(analysis.vertices.map((point) => pointKey(point, 8)))
    : null;
  const inwardEscapeDiagnostics = (dist < 0 && insideTester)
    ? {
      enabled: true,
      mode: 'source_inside_heuristic',
      rawEscapedVertexCount: 0,
      finalEscapedVertexCount: 0,
      clampedVertexCount: 0,
      maxRecordedVertices: 24,
      escapedVertices: [],
    }
    : null;

  const movedVertices = new Array(analysis.vertices.length);
  for (const [vertexIndex, faceNames] of analysis.vertexFaceMap.entries()) {
    const incidentFaceNames = Array.from(faceNames || []);
    const keptFaceNames = removeFaceSet.size
      ? incidentFaceNames.filter((faceName) => !removeFaceSet.has(faceName))
      : incidentFaceNames;
    if (!keptFaceNames.length) continue;

    const supportFaceNames = removeFaceSet.size ? incidentFaceNames : keptFaceNames;
    const supports = dedupeSupports(Array.from(supportFaceNames || [], (faceName) => {
      const face = analysis.faceMap.get(faceName);
      const support = face?.support || null;
      const distanceOverride = removeFaceSet.has(faceName) ? 0 : undefined;
      if (!support) return null;
      if (support.kind !== 'vertex_tangent') {
        if (distanceOverride === undefined) return support;
        return {
          ...support,
          distanceOverride,
        };
      }
      const normal = analysis.vertexFaceNormalMap?.get?.(`${vertexIndex}|${faceName}`) || null;
      if (!normal || normal.lengthSq() <= SOLVER_EPS) return null;
      return {
        kind: 'plane',
        faceName,
        normal: normal.clone(),
        offset: normal.dot(analysis.vertices[vertexIndex]),
        ...(distanceOverride === undefined ? {} : { distanceOverride }),
      };
    }).filter(Boolean));
    if (!supports.length) {
      const fallbackSupports = _buildVertexFallbackSupport(
        analysis,
        vertexIndex,
        analysis.vertices[vertexIndex],
        supportFaceNames,
        {
          solidCentroid: analysis.solidCentroid,
        },
      );
      if (fallbackSupports.length) {
        supports.push(...fallbackSupports);
      }
    }
    if (!supports.length) return null;
    const moved = solveSupportVertex(analysis.vertices[vertexIndex], supports, dist);
    if (!moved) {
      if (debugSupportFailures) {
        console.warn('[polyhedralOffset] Failed to solve offset vertex support.', {
          newSolidName,
          vertexIndex,
          distance: dist,
          sourcePoint: analysis.vertices[vertexIndex]?.toArray?.() || null,
          keptFaceNames,
          removedFaceNames: removeFaceSet.size
            ? Array.from(faceNames || []).filter((faceName) => removeFaceSet.has(faceName))
            : [],
          supportKinds: supports.map((support) => String(support?.kind || 'unknown')),
          supportFaceNames: supports.map((support) => String(support?.faceName || '')),
          supports: supports.map((support) => {
            if (support?.kind === 'plane') {
              return {
                kind: support.kind,
                faceName: support.faceName,
                normal: support.normal?.toArray?.() || null,
                offset: Number(support.offset),
              };
            }
            if (support?.kind === 'cylinder') {
              return {
                kind: support.kind,
                faceName: support.faceName,
                center: support.center?.toArray?.() || null,
                axis: support.axis?.toArray?.() || null,
                radius: Number(support.radius),
              };
            }
            return {
              kind: String(support?.kind || 'unknown'),
              faceName: String(support?.faceName || ''),
            };
          }),
        });
      }
      return null;
    }
    let finalMoved = moved;
    if (inwardEscapeDiagnostics && moved.distanceToSquared(analysis.vertices[vertexIndex]) > Math.max(1e-16, Math.pow(modelScale * 1e-8, 2))) {
      const rawInside = _safePointInsideTest(insideTester, moved);
      const onRemovedBoundary = _pointNearRemovedBoundary(moved, removedBoundarySupports, removedBoundaryTolerance);
      if (rawInside === false && !onRemovedBoundary) {
        inwardEscapeDiagnostics.rawEscapedVertexCount += 1;
        inwardEscapeDiagnostics.finalEscapedVertexCount += 1;
        if (inwardEscapeDiagnostics.escapedVertices.length < inwardEscapeDiagnostics.maxRecordedVertices) {
          inwardEscapeDiagnostics.escapedVertices.push({
            vertexIndex,
            sourcePoint: [analysis.vertices[vertexIndex].x, analysis.vertices[vertexIndex].y, analysis.vertices[vertexIndex].z],
            rawMovedPoint: [moved.x, moved.y, moved.z],
            finalMovedPoint: [finalMoved.x, finalMoved.y, finalMoved.z],
            keptFaceNames,
            removedFaceNames: removeFaceSet.size
              ? Array.from(faceNames || []).filter((faceName) => removeFaceSet.has(faceName))
              : [],
            supportKinds: supports.map((support) => String(support?.kind || 'unknown')),
            supportFaceNames: supports.map((support) => String(support?.faceName || '')),
            shellInnerFaceNames: keptFaceNames.map((faceName) => _innerFaceNameForShell(faceName, newSolidName)),
          });
        }
      }
    }
    movedVertices[vertexIndex] = finalMoved;
  }

  for (let i = 0; i < movedVertices.length; i++) {
    if (movedVertices[i]) continue;
    movedVertices[i] = analysis.vertices[i].clone();
  }

  let out = null;
  if (removeFaceSet.size) {
    const outerVertices = dist >= 0 ? movedVertices : analysis.vertices;
    const innerVertices = dist >= 0 ? analysis.vertices : movedVertices;
    out = _buildPolyhedralShellSolid(sourceSolid, analysis, outerVertices, innerVertices, {
      newSolidName,
      removeFaceNames: removeFaceSet,
      triangleDiagnostics: inwardTriangleDiagnostics,
      insideTester,
      sourcePointKeys,
      removedBoundarySupports,
      removedBoundaryTolerance,
    });
  } else {
    out = new Solid();
    out.name = newSolidName;
    for (let triIndex = 0; triIndex * 3 + 2 < analysis.triVerts.length; triIndex++) {
      const a = analysis.triVerts[triIndex * 3 + 0] >>> 0;
      const b = analysis.triVerts[triIndex * 3 + 1] >>> 0;
      const c = analysis.triVerts[triIndex * 3 + 2] >>> 0;
      const faceID = analysis.triIDs[triIndex];
      const faceName = analysis.idToFaceName.get(faceID);
      if (!faceName) return null;
      const p0 = movedVertices[a];
      const p1 = movedVertices[b];
      const p2 = movedVertices[c];
      if (!p0 || !p1 || !p2) return null;

      out.addTriangle(
        `${newSolidName}_${faceName}`,
        [p0.x, p0.y, p0.z],
        [p1.x, p1.y, p1.z],
        [p2.x, p2.y, p2.z]
      );
    }

    if ((out._triVerts?.length || 0) !== analysis.triVerts.length) return null;
    out._faceMetadata = _buildOffsetFaceMetadata(sourceSolid, newSolidName);
    out._auxEdges = Array.isArray(sourceSolid._auxEdges) ? [...sourceSolid._auxEdges] : [];
    out.__offsetMethod = 'polyhedral_topology';
  }
  if (!out) return null;
  if (inwardEscapeDiagnostics) {
    out.__offsetDiagnostics = {
      ...(out.__offsetDiagnostics || {}),
      inwardEscapeCheck: inwardEscapeDiagnostics,
    };
  }
  if (inwardTriangleDiagnostics) {
    out.__offsetDiagnostics = {
      ...(out.__offsetDiagnostics || {}),
      triangleGenerationEscapeCheck: inwardTriangleDiagnostics,
    };
  }

  const repairResult = _repairSelfIntersections(out, {
    maxPasses: Number(options.repairPasses) || MAX_OFFSET_REPAIR_PASSES,
  });
  if (repairResult) return out;

  if (removeFaceSet.size) return null;

  const repairAttempts = Array.isArray(options.repairAttempts)
    ? options.repairAttempts
    : (Number.isFinite(Number(options.repairAttempts)) ? [Number(options.repairAttempts)] : undefined);

  const repaired = _buildRepairedOffsetCandidates(out, sourceSolid, {
    newSolidName,
    repairPasses: Number(options.repairPasses) || MAX_OFFSET_REPAIR_PASSES,
    repairAttempts,
  });
  if (repaired) return repaired;
  return null;
}

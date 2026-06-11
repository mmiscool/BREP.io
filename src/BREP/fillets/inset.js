import * as THREE from 'three';

// Scratch vectors
const __tmp1 = new THREE.Vector3();
const __tmp2 = new THREE.Vector3();
const __tmp3 = new THREE.Vector3();
const __tmp4 = new THREE.Vector3();
const __tmp5 = new THREE.Vector3();
const __tmp6 = new THREE.Vector3();

function getScaleAdaptiveTolerance(radius, baseEpsilon = 1e-12) {
  return Math.max(baseEpsilon, baseEpsilon * Math.abs(radius));
}

function getDistanceTolerance(radius) {
  return Math.max(1e-9, 1e-6 * Math.abs(radius));
}

// Lightweight spatial index keyed by voxel cells for triangle centroid spheres
class TriangleSpatialIndex {
  constructor(triangleData, cellSize = null) {
    this.triangleData = triangleData || [];
    this.grid = new Map();
    if (!this.triangleData.length) return;
    if (cellSize == null) {
      const avgRad = this.triangleData.reduce((s, d) => s + (d.rad || 0), 0) / this.triangleData.length;
      cellSize = Math.max(avgRad * 2, 1e-6);
    }
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    for (let i = 0; i < this.triangleData.length; i++) {
      for (const key of this.getTriangleCells(this.triangleData[i])) {
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(i);
      }
    }
  }
  cellKey(x, y, z) {
    const ix = Math.floor(x * this.invCellSize);
    const iy = Math.floor(y * this.invCellSize);
    const iz = Math.floor(z * this.invCellSize);
    return `${ix},${iy},${iz}`;
  }
  getTriangleCells({ cx, cy, cz, rad }) {
    const cells = new Set();
    const minX = (cx - rad) * this.invCellSize;
    const maxX = (cx + rad) * this.invCellSize;
    const minY = (cy - rad) * this.invCellSize;
    const maxY = (cy + rad) * this.invCellSize;
    const minZ = (cz - rad) * this.invCellSize;
    const maxZ = (cz + rad) * this.invCellSize;
    for (let ix = Math.floor(minX); ix <= Math.floor(maxX); ix++)
      for (let iy = Math.floor(minY); iy <= Math.floor(maxY); iy++)
        for (let iz = Math.floor(minZ); iz <= Math.floor(maxZ); iz++)
          cells.add(`${ix},${iy},${iz}`);
    return cells;
  }
  getNearbyTriangles(point, maxDistance = Infinity) {
    const key = this.cellKey(point.x, point.y, point.z);
    const list = this.grid.get(key) || [];
    if (maxDistance === Infinity || list.length) return list;
    const R = Math.ceil(maxDistance * this.invCellSize);
    const ix0 = Math.floor(point.x * this.invCellSize);
    const iy0 = Math.floor(point.y * this.invCellSize);
    const iz0 = Math.floor(point.z * this.invCellSize);
    const set = new Set();
    for (let ix = ix0 - R; ix <= ix0 + R; ix++)
      for (let iy = iy0 - R; iy <= iy0 + R; iy++)
        for (let iz = iz0 - R; iz <= iz0 + R; iz++) {
          const l = this.grid.get(`${ix},${iy},${iz}`);
          if (l) for (const i of l) set.add(i);
        }
    return Array.from(set);
  }
}

const __FACE_DATA_CACHE = new Map();
const __SPATIAL_INDEX_CACHE = new Map();
const MAX_CACHE_SIZE = 100;

function getCachedFaceDataForTris(tris, faceKey = null) {
  if (!Array.isArray(tris) || tris.length === 0) return [];
  const cacheKey = faceKey || tris;
  const existing = __FACE_DATA_CACHE.get(cacheKey);
  if (existing) return existing;
  if (__FACE_DATA_CACHE.size >= MAX_CACHE_SIZE) {
    const first = __FACE_DATA_CACHE.keys().next().value;
    __FACE_DATA_CACHE.delete(first);
    __SPATIAL_INDEX_CACHE.delete(first);
  }
  const a = __tmp1, b = __tmp2, c = __tmp3;
  const ab = __tmp4, ac = __tmp5, n = __tmp6;
  const faceData = tris.map(t => {
    a.set(t.p1[0], t.p1[1], t.p1[2]);
    b.set(t.p2[0], t.p2[1], t.p2[2]);
    c.set(t.p3[0], t.p3[1], t.p3[2]);
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len < getScaleAdaptiveTolerance(1.0, 1e-14)) return null;
    n.multiplyScalar(1 / len);
    const dxA = a.x - cx, dyA = a.y - cy, dzA = a.z - cz;
    const dxB = b.x - cx, dyB = b.y - cy, dzB = b.z - cz;
    const dxC = c.x - cx, dyC = c.y - cy, dzC = c.z - cz;
    const rA2 = dxA * dxA + dyA * dyA + dzA * dzA;
    const rB2 = dxB * dxB + dyB * dyB + dzB * dzB;
    const rC2 = dxC * dxC + dyC * dyC + dzC * dzC;
    const rad = Math.sqrt(Math.max(rA2, rB2, rC2));
    return { cx, cy, cz, rad, normal: n.clone(), triangle: t };
  }).filter(Boolean);
  __FACE_DATA_CACHE.set(cacheKey, faceData);
  return faceData;
}

function getCachedSpatialIndex(faceData, faceKey = null) {
  const key = faceKey || faceData;
  let idx = __SPATIAL_INDEX_CACHE.get(key);
  if (!idx && Array.isArray(faceData) && faceData.length) {
    idx = new TriangleSpatialIndex(faceData);
    __SPATIAL_INDEX_CACHE.set(key, idx);
  }
  return idx;
}

function averageFaceNormalObjectSpace(solid, faceName) {
  const tris = solid.getFace(faceName);
  if (!tris || !tris.length) return new THREE.Vector3(0, 1, 0);
  const accum = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const t of tris) {
    a.set(t.p1[0], t.p1[1], t.p1[2]);
    b.set(t.p2[0], t.p2[1], t.p2[2]);
    c.set(t.p3[0], t.p3[1], t.p3[2]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    accum.add(ab.clone().cross(ac));
  }
  if (accum.lengthSq() === 0) return new THREE.Vector3(0, 1, 0);
  return accum.normalize();
}

function localFaceNormalAtPoint(solid, faceName, p, faceData = null, faceKey = null) {
  const point = (p && typeof p.x === 'number') ? p : __tmp5.set(p?.[0] || 0, p?.[1] || 0, p?.[2] || 0);
  let data = (Array.isArray(faceData) && faceData.length) ? faceData : null;
  if (!data) {
    const tris = solid?.getFace ? solid.getFace(faceName) : null;
    if (!Array.isArray(tris) || tris.length === 0) return null;
    data = getCachedFaceDataForTris(tris, faceKey || faceName);
  }
  if (!data || !data.length) return null;
  const spatial = getCachedSpatialIndex(data, faceKey || faceName || null);
  let bestNormal = null;
  let bestDist = Infinity;
  const evalIdx = (idx) => {
    const e = data[idx]; if (!e) return;
    const dx = point.x - e.cx, dy = point.y - e.cy, dz = point.z - e.cz;
    const dist = Math.abs(e.normal.x * dx + e.normal.y * dy + e.normal.z * dz);
    if (dist < bestDist) { bestDist = dist; bestNormal = e.normal; }
  };
  if (spatial) {
    const r = Number.isFinite(spatial.cellSize) ? spatial.cellSize * 1.5 : Infinity;
    const near = spatial.getNearbyTriangles(point, r);
    if (Array.isArray(near)) for (const idx of near) evalIdx(idx);
  }
  if (!bestNormal) {
    const pick = Math.min(16, data.length);
    const candidates = [];
    for (let i = 0; i < data.length; i++) {
      const e = data[i]; if (!e) continue;
      const dx = point.x - e.cx, dy = point.y - e.cy, dz = point.z - e.cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (candidates.length < pick) {
        candidates.push({ idx: i, d2 });
        if (candidates.length === pick) candidates.sort((a, b) => a.d2 - b.d2);
      } else if (d2 < candidates[candidates.length - 1].d2) {
        candidates[candidates.length - 1] = { idx: i, d2 };
        candidates.sort((a, b) => a.d2 - b.d2);
      }
    }
    for (const c of candidates) evalIdx(c.idx);
  }
  return bestNormal || null;
}

export {
  getDistanceTolerance,
  averageFaceNormalObjectSpace,
  localFaceNormalAtPoint,
};

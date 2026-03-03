import * as THREE from "three";

export const DEFAULT_CAGE_DIVISIONS = [3, 3, 3];
export const DEFAULT_CAGE_PADDING = 0.08;

const EPS = 1e-9;
const BOUNDS_FALLBACK = {
  min: [-10, -10, -10],
  max: [10, 10, 10],
};

const BINOMIAL_CACHE = new Map();

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toVec3 = (value, fallback = [0, 0, 0]) => {
  const source = Array.isArray(value) ? value : fallback;
  return [
    toFiniteNumber(source[0], fallback[0] || 0),
    toFiniteNumber(source[1], fallback[1] || 0),
    toFiniteNumber(source[2], fallback[2] || 0),
  ];
};

const isFiniteVec3 = (value) =>
  Array.isArray(value)
  && value.length >= 3
  && Number.isFinite(Number(value[0]))
  && Number.isFinite(Number(value[1]))
  && Number.isFinite(Number(value[2]));

const vec3DistanceSq = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

const boundaryKey = (i, j, k) => `${i}:${j}:${k}`;

const fullLatticePointCount = (dims) => dims[0] * dims[1] * dims[2];

const fullLatticeIndex = (i, j, k, dims) => k * (dims[0] * dims[1]) + j * dims[0] + i;

const isBoundaryCoordinate = (i, j, k, dims) => {
  const [nx, ny, nz] = dims;
  return (
    i === 0 || i === nx - 1
    || j === 0 || j === ny - 1
    || k === 0 || k === nz - 1
  );
};

function forEachBoundaryCoordinate(dims, callback) {
  const [nx, ny, nz] = dims;
  let boundaryIndex = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!isBoundaryCoordinate(i, j, k, dims)) continue;
        if (callback(i, j, k, boundaryIndex) === false) return;
        boundaryIndex += 1;
      }
    }
  }
}

export function cloneCageData(cage) {
  try {
    return JSON.parse(JSON.stringify(cage || null));
  } catch {
    return null;
  }
}

export function sanitizeCageDivisions(input, fallback = DEFAULT_CAGE_DIVISIONS) {
  const fromArray = Array.isArray(input) ? input : null;
  const fromObject = (!fromArray && input && typeof input === "object") ? input : null;
  const source = fromArray || fromObject;

  const read = (index, key, fallbackValue) => {
    const raw = fromArray ? source[index] : source?.[key];
    const base = Math.floor(toFiniteNumber(raw, fallbackValue));
    return clamp(base || fallbackValue, 2, 9);
  };

  const f = Array.isArray(fallback) && fallback.length >= 3 ? fallback : DEFAULT_CAGE_DIVISIONS;
  return [
    read(0, "u", f[0] || 3),
    read(1, "v", f[1] || 3),
    read(2, "w", f[2] || 3),
  ];
}

export function cagePointCount(dimsInput) {
  const dims = sanitizeCageDivisions(dimsInput);
  let count = 0;
  forEachBoundaryCoordinate(dims, () => {
    count += 1;
  });
  return count;
}

export function cageIndex(i, j, k, dimsInput) {
  const dims = sanitizeCageDivisions(dimsInput);
  const [nx, ny, nz] = dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
  if (!isBoundaryCoordinate(i, j, k, dims)) return -1;
  let out = -1;
  forEachBoundaryCoordinate(dims, (ci, cj, ck, boundaryIndex) => {
    if (ci === i && cj === j && ck === k) {
      out = boundaryIndex;
      return false;
    }
    return true;
  });
  return out;
}

export function cageCoordsFromIndex(index, dimsInput) {
  const dims = sanitizeCageDivisions(dimsInput);
  const count = cagePointCount(dims);
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  let coords = null;
  forEachBoundaryCoordinate(dims, (i, j, k, boundaryIndex) => {
    if (boundaryIndex === index) {
      coords = [i, j, k];
      return false;
    }
    return true;
  });
  return coords;
}

export function cageIdFromIndex(index, dimsInput) {
  const coords = cageCoordsFromIndex(index, dimsInput);
  if (!coords) return null;
  return `cp:${coords[0]}:${coords[1]}:${coords[2]}`;
}

export function cageIndexFromId(id, dimsInput) {
  if (typeof id !== "string") return -1;
  const match = /^cp:(\d+):(\d+):(\d+)$/.exec(id.trim());
  if (!match) return -1;
  const i = Number(match[1]);
  const j = Number(match[2]);
  const k = Number(match[3]);
  return cageIndex(i, j, k, dimsInput);
}

export function buildCageSegments(dimsInput) {
  const dims = sanitizeCageDivisions(dimsInput);
  const [nx, ny, nz] = dims;
  const segments = [];
  const lookup = new Map();
  forEachBoundaryCoordinate(dims, (i, j, k, boundaryIndex) => {
    lookup.set(boundaryKey(i, j, k), boundaryIndex);
  });

  const pushSegmentIfValid = (a, i, j, k) => {
    const b = lookup.get(boundaryKey(i, j, k));
    if (Number.isInteger(a) && Number.isInteger(b)) segments.push([a, b]);
  };

  forEachBoundaryCoordinate(dims, (i, j, k, a) => {
    if (i + 1 < nx && isBoundaryCoordinate(i + 1, j, k, dims)) {
      pushSegmentIfValid(a, i + 1, j, k);
    }
    if (j + 1 < ny && isBoundaryCoordinate(i, j + 1, k, dims)) {
      pushSegmentIfValid(a, i, j + 1, k);
    }
    if (k + 1 < nz && isBoundaryCoordinate(i, j, k + 1, dims)) {
      pushSegmentIfValid(a, i, j, k + 1);
    }
  });
  return segments;
}

export function computeBoundsFromPoints(pointsInput) {
  const points = Array.isArray(pointsInput) ? pointsInput : [];
  if (!points.length) return { ...BOUNDS_FALLBACK };

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const p of points) {
    if (!isFiniteVec3(p)) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    const z = Number(p[2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { ...BOUNDS_FALLBACK };

  if (Math.abs(maxX - minX) < EPS) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (Math.abs(maxY - minY) < EPS) {
    minY -= 0.5;
    maxY += 0.5;
  }
  if (Math.abs(maxZ - minZ) < EPS) {
    minZ -= 0.5;
    maxZ += 0.5;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

export function expandBounds(boundsInput, paddingFraction = DEFAULT_CAGE_PADDING) {
  const bounds = (boundsInput && typeof boundsInput === "object") ? boundsInput : BOUNDS_FALLBACK;
  const min = toVec3(bounds.min, BOUNDS_FALLBACK.min);
  const max = toVec3(bounds.max, BOUNDS_FALLBACK.max);
  const size = [
    Math.max(EPS, max[0] - min[0]),
    Math.max(EPS, max[1] - min[1]),
    Math.max(EPS, max[2] - min[2]),
  ];
  const maxSize = Math.max(size[0], size[1], size[2], 1e-3);
  const padScale = clamp(toFiniteNumber(paddingFraction, DEFAULT_CAGE_PADDING), 0, 1);
  const pad = Math.max(maxSize * padScale, 1e-4);

  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

function sampleBoundsPoint(bounds, dims, i, j, k) {
  const min = toVec3(bounds?.min, BOUNDS_FALLBACK.min);
  const max = toVec3(bounds?.max, BOUNDS_FALLBACK.max);
  const [nx, ny, nz] = dims;
  const u = nx > 1 ? (i / (nx - 1)) : 0;
  const v = ny > 1 ? (j / (ny - 1)) : 0;
  const w = nz > 1 ? (k / (nz - 1)) : 0;
  return [
    min[0] + (max[0] - min[0]) * u,
    min[1] + (max[1] - min[1]) * v,
    min[2] + (max[2] - min[2]) * w,
  ];
}

export function createDefaultCage(boundsInput, options = {}) {
  const dims = sanitizeCageDivisions(options.divisions || DEFAULT_CAGE_DIVISIONS);
  const padding = toFiniteNumber(options.padding, DEFAULT_CAGE_PADDING);
  const expandedBounds = expandBounds(boundsInput || BOUNDS_FALLBACK, padding);
  const points = [];

  forEachBoundaryCoordinate(dims, (i, j, k) => {
    points.push(sampleBoundsPoint(expandedBounds, dims, i, j, k));
  });

  return {
    version: 1,
    dims,
    baseBounds: expandedBounds,
    sourceSignature: options.sourceSignature ? String(options.sourceSignature) : null,
    points,
  };
}

const isBoundsLike = (value) => (
  !!value
  && typeof value === "object"
  && isFiniteVec3(value.min)
  && isFiniteVec3(value.max)
);

function sanitizeBounds(boundsInput, fallbackPoints = null, padding = DEFAULT_CAGE_PADDING) {
  if (isBoundsLike(boundsInput)) {
    return {
      min: toVec3(boundsInput.min),
      max: toVec3(boundsInput.max),
    };
  }
  if (Array.isArray(fallbackPoints) && fallbackPoints.length) {
    return expandBounds(computeBoundsFromPoints(fallbackPoints), padding);
  }
  return { ...BOUNDS_FALLBACK };
}

function buildDeformationContext(cageInput) {
  const cage = cageInput && typeof cageInput === "object" ? cageInput : null;
  if (!cage) return null;

  const dims = sanitizeCageDivisions(cage.dims || DEFAULT_CAGE_DIVISIONS);
  const boundaryPoints = Array.isArray(cage.points) ? cage.points : null;
  const expectedBoundaryCount = cagePointCount(dims);
  if (!boundaryPoints || boundaryPoints.length !== expectedBoundaryCount) return null;

  const baseBounds = sanitizeBounds(cage.baseBounds, boundaryPoints, 0);
  const fullCount = fullLatticePointCount(dims);
  const fullPoints = new Array(fullCount);

  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        const idx = fullLatticeIndex(i, j, k, dims);
        fullPoints[idx] = sampleBoundsPoint(baseBounds, dims, i, j, k);
      }
    }
  }

  forEachBoundaryCoordinate(dims, (i, j, k, boundaryIndex) => {
    const idx = fullLatticeIndex(i, j, k, dims);
    fullPoints[idx] = toVec3(boundaryPoints[boundaryIndex], fullPoints[idx]);
  });

  const [nx, ny, nz] = dims;
  if (nx > 2 && ny > 2 && nz > 2) {
    const interior = [];
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          interior.push([i, j, k]);
        }
      }
    }
    const iterations = Math.max(16, (nx + ny + nz) * 4);
    for (let pass = 0; pass < iterations; pass++) {
      for (const [i, j, k] of interior) {
        const idx = fullLatticeIndex(i, j, k, dims);
        const xm = fullPoints[fullLatticeIndex(i - 1, j, k, dims)];
        const xp = fullPoints[fullLatticeIndex(i + 1, j, k, dims)];
        const ym = fullPoints[fullLatticeIndex(i, j - 1, k, dims)];
        const yp = fullPoints[fullLatticeIndex(i, j + 1, k, dims)];
        const zm = fullPoints[fullLatticeIndex(i, j, k - 1, dims)];
        const zp = fullPoints[fullLatticeIndex(i, j, k + 1, dims)];
        const curr = fullPoints[idx] || [0, 0, 0];
        curr[0] = (xm[0] + xp[0] + ym[0] + yp[0] + zm[0] + zp[0]) / 6;
        curr[1] = (xm[1] + xp[1] + ym[1] + yp[1] + zm[1] + zp[1]) / 6;
        curr[2] = (xm[2] + xp[2] + ym[2] + yp[2] + zm[2] + zp[2]) / 6;
        fullPoints[idx] = curr;
      }
    }
  }

  return { dims, baseBounds, fullPoints };
}

function evaluateDeformationContextAtUVW(context, u, v, w) {
  if (!context) return [0, 0, 0];
  const [nx, ny, nz] = context.dims;
  const bu = bernsteinBasis(nx - 1, u);
  const bv = bernsteinBasis(ny - 1, v);
  const bw = bernsteinBasis(nz - 1, w);

  let x = 0;
  let y = 0;
  let z = 0;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = fullLatticeIndex(i, j, k, context.dims);
        const p = context.fullPoints[idx];
        const weight = bu[i] * bv[j] * bw[k];
        x += p[0] * weight;
        y += p[1] * weight;
        z += p[2] * weight;
      }
    }
  }
  return [x, y, z];
}

function resampleBoundaryPoints(cageInput, nextDimsInput) {
  const nextDims = sanitizeCageDivisions(nextDimsInput);
  const context = buildDeformationContext(cageInput);
  if (!context) return null;

  const [nx, ny, nz] = nextDims;
  const resampled = [];
  forEachBoundaryCoordinate(nextDims, (i, j, k) => {
    const u = nx > 1 ? (i / (nx - 1)) : 0;
    const v = ny > 1 ? (j / (ny - 1)) : 0;
    const w = nz > 1 ? (k / (nz - 1)) : 0;
    resampled.push(evaluateDeformationContextAtUVW(context, u, v, w));
  });
  return resampled;
}

function extractBoundaryPointsFromFullLattice(pointsInput, dimsInput) {
  const dims = sanitizeCageDivisions(dimsInput);
  const fullCount = fullLatticePointCount(dims);
  const points = Array.isArray(pointsInput) ? pointsInput : null;
  if (!points || points.length !== fullCount) return null;
  const out = [];
  forEachBoundaryCoordinate(dims, (i, j, k) => {
    const idx = fullLatticeIndex(i, j, k, dims);
    out.push(toVec3(points[idx]));
  });
  return out;
}

export function normalizeCageData(raw, options = {}) {
  const bounds = options.bounds || BOUNDS_FALLBACK;
  const wantedDims = sanitizeCageDivisions(options.divisions || DEFAULT_CAGE_DIVISIONS);
  const sourceSignature = options.sourceSignature ? String(options.sourceSignature) : null;
  const padding = toFiniteNumber(options.padding, DEFAULT_CAGE_PADDING);

  const rawObj = raw && typeof raw === "object" ? raw : null;
  const rawDims = sanitizeCageDivisions(rawObj?.dims || wantedDims, wantedDims);
  const dimsChanged = (
    rawDims[0] !== wantedDims[0]
    || rawDims[1] !== wantedDims[1]
    || rawDims[2] !== wantedDims[2]
  );
  const rawSignature = rawObj?.sourceSignature != null ? String(rawObj.sourceSignature) : null;
  const expectedRawBoundaryCount = cagePointCount(rawDims);
  const expectedRawLegacyFullCount = fullLatticePointCount(rawDims);
  const rawPoints = Array.isArray(rawObj?.points) ? rawObj.points : null;
  let normalizedRawPoints = null;
  if (rawPoints) {
    if (rawPoints.length === expectedRawBoundaryCount) {
      normalizedRawPoints = rawPoints.map((p) => toVec3(p));
    } else if (rawPoints.length === expectedRawLegacyFullCount) {
      normalizedRawPoints = extractBoundaryPointsFromFullLattice(rawPoints, rawDims);
    }
  }
  if (!normalizedRawPoints || normalizedRawPoints.length !== expectedRawBoundaryCount) {
    return createDefaultCage(bounds, {
      divisions: wantedDims,
      sourceSignature,
      padding,
    });
  }
  const rawBaseBounds = sanitizeBounds(rawObj?.baseBounds, normalizedRawPoints, padding);

  if (dimsChanged) {
    const resampledPoints = resampleBoundaryPoints({
      dims: rawDims,
      points: normalizedRawPoints,
      baseBounds: rawBaseBounds,
      sourceSignature: rawSignature,
    }, wantedDims);
    if (resampledPoints && resampledPoints.length === cagePointCount(wantedDims)) {
      return {
        version: 1,
        dims: wantedDims,
        baseBounds: rawBaseBounds,
        sourceSignature: sourceSignature || rawSignature || null,
        points: resampledPoints,
      };
    }
    return createDefaultCage(bounds, {
      divisions: wantedDims,
      sourceSignature,
      padding,
    });
  }

  return {
    version: 1,
    dims: rawDims,
    baseBounds: rawBaseBounds,
    sourceSignature: sourceSignature || rawSignature || null,
    points: normalizedRawPoints,
  };
}

function getBinomial(n, k) {
  const key = `${n}:${k}`;
  if (BINOMIAL_CACHE.has(key)) return BINOMIAL_CACHE.get(key);
  if (k === 0 || k === n) {
    BINOMIAL_CACHE.set(key, 1);
    return 1;
  }
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  BINOMIAL_CACHE.set(key, result);
  return result;
}

function bernsteinBasis(degree, t) {
  const tt = clamp(toFiniteNumber(t, 0), 0, 1);
  const oneMinus = 1 - tt;
  const out = new Array(degree + 1);
  for (let i = 0; i <= degree; i++) {
    out[i] = getBinomial(degree, i) * (tt ** i) * (oneMinus ** (degree - i));
  }
  return out;
}

function mapPointToUVW(point, bounds) {
  const min = toVec3(bounds?.min, BOUNDS_FALLBACK.min);
  const max = toVec3(bounds?.max, BOUNDS_FALLBACK.max);
  const x = toFiniteNumber(point?.[0], 0);
  const y = toFiniteNumber(point?.[1], 0);
  const z = toFiniteNumber(point?.[2], 0);

  const sizeX = Math.max(EPS, max[0] - min[0]);
  const sizeY = Math.max(EPS, max[1] - min[1]);
  const sizeZ = Math.max(EPS, max[2] - min[2]);

  return [
    clamp((x - min[0]) / sizeX, 0, 1),
    clamp((y - min[1]) / sizeY, 0, 1),
    clamp((z - min[2]) / sizeZ, 0, 1),
  ];
}

export function deformPointWithCage(pointInput, cageInput) {
  const context = buildDeformationContext(cageInput);
  if (!context) return toVec3(pointInput);
  const [u, v, w] = mapPointToUVW(pointInput, context.baseBounds);
  return evaluateDeformationContextAtUVW(context, u, v, w);
}

export function deformPointsWithCage(pointsInput, cage) {
  const points = Array.isArray(pointsInput) ? pointsInput : [];
  const context = buildDeformationContext(cage);
  if (!context) return points.map((p) => toVec3(p));
  return points.map((point) => {
    const [u, v, w] = mapPointToUVW(point, context.baseBounds);
    return evaluateDeformationContextAtUVW(context, u, v, w);
  });
}

export function buildFaceShellSource(faceObj, options = {}) {
  if (!faceObj || faceObj.type !== "FACE" || !faceObj.geometry) return null;

  const thicknessRaw = toFiniteNumber(options.thickness, 1);
  const thickness = Math.max(EPS, Math.abs(thicknessRaw));
  const twoSided = options.twoSided !== false;
  const quant = Math.max(1e-9, toFiniteNumber(options.quantization, 1e-6));
  const invQuant = 1 / quant;

  try { faceObj.updateMatrixWorld?.(true); } catch { }

  const geometry = faceObj.geometry;
  const posAttr = geometry.getAttribute?.("position");
  if (!posAttr || posAttr.itemSize !== 3 || posAttr.count < 3) return null;

  let normalAttr = geometry.getAttribute?.("normal") || null;
  let tempGeom = null;
  if (!normalAttr || normalAttr.count !== posAttr.count) {
    try {
      tempGeom = geometry.clone();
      tempGeom.computeVertexNormals();
      normalAttr = tempGeom.getAttribute("normal");
    } catch {
      normalAttr = null;
    }
  }

  const fallbackNormal = (() => {
    try {
      if (typeof faceObj.getAverageNormal === "function") {
        const n = faceObj.getAverageNormal().clone();
        if (n && n.lengthSq() > EPS) return n.normalize().toArray();
      }
    } catch { }
    return [0, 0, 1];
  })();

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(faceObj.matrixWorld);
  const tmpPos = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();

  const canonicalPositions = [];
  const canonicalNormalSums = [];
  const canonicalMap = new Map();
  const origToCanonical = new Array(posAttr.count);

  const keyOf = (p) => {
    const x = Math.round(p[0] * invQuant) / invQuant;
    const y = Math.round(p[1] * invQuant) / invQuant;
    const z = Math.round(p[2] * invQuant) / invQuant;
    return `${x},${y},${z}`;
  };

  for (let i = 0; i < posAttr.count; i++) {
    tmpPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(faceObj.matrixWorld);
    const position = [tmpPos.x, tmpPos.y, tmpPos.z];
    const key = keyOf(position);
    let canonicalIndex = canonicalMap.get(key);
    if (canonicalIndex == null) {
      canonicalIndex = canonicalPositions.length;
      canonicalMap.set(key, canonicalIndex);
      canonicalPositions.push(position);
      canonicalNormalSums.push([0, 0, 0]);
    }
    origToCanonical[i] = canonicalIndex;

    if (normalAttr && i < normalAttr.count) {
      tmpNormal
        .set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i))
        .applyMatrix3(normalMatrix);
      if (tmpNormal.lengthSq() > EPS) tmpNormal.normalize();
    } else {
      tmpNormal.set(fallbackNormal[0], fallbackNormal[1], fallbackNormal[2]);
    }
    const sum = canonicalNormalSums[canonicalIndex];
    sum[0] += tmpNormal.x;
    sum[1] += tmpNormal.y;
    sum[2] += tmpNormal.z;
  }

  const triangles = [];
  const edgeCounts = new Map();
  const indexAttr = geometry.getIndex?.() || null;
  const triCount = indexAttr
    ? ((indexAttr.count / 3) | 0)
    : ((posAttr.count / 3) | 0);

  const addEdgeCount = (a, b) => {
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const key = `${i},${j}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };

  for (let t = 0; t < triCount; t++) {
    const oa = indexAttr ? (indexAttr.getX(t * 3 + 0) >>> 0) : (t * 3 + 0);
    const ob = indexAttr ? (indexAttr.getX(t * 3 + 1) >>> 0) : (t * 3 + 1);
    const oc = indexAttr ? (indexAttr.getX(t * 3 + 2) >>> 0) : (t * 3 + 2);
    const a = origToCanonical[oa] >>> 0;
    const b = origToCanonical[ob] >>> 0;
    const c = origToCanonical[oc] >>> 0;
    if (a === b || b === c || c === a) continue;
    triangles.push([a, b, c]);
    addEdgeCount(a, b);
    addEdgeCount(b, c);
    addEdgeCount(c, a);
  }

  if (!triangles.length || canonicalPositions.length < 3) {
    try { tempGeom?.dispose?.(); } catch { }
    return null;
  }

  const normals = canonicalNormalSums.map((sum) => {
    const n = new THREE.Vector3(sum[0], sum[1], sum[2]);
    if (n.lengthSq() < EPS) n.set(fallbackNormal[0], fallbackNormal[1], fallbackNormal[2]);
    return n.normalize().toArray();
  });

  const offsetTop = twoSided ? (thickness * 0.5) : 0;
  const offsetBottom = twoSided ? (-thickness * 0.5) : (-thickness);
  const top = canonicalPositions.map((p, idx) => {
    const n = normals[idx];
    return [
      p[0] + n[0] * offsetTop,
      p[1] + n[1] * offsetTop,
      p[2] + n[2] * offsetTop,
    ];
  });
  const bottom = canonicalPositions.map((p, idx) => {
    const n = normals[idx];
    return [
      p[0] + n[0] * offsetBottom,
      p[1] + n[1] * offsetBottom,
      p[2] + n[2] * offsetBottom,
    ];
  });

  const boundaryEdges = [];
  for (const [key, count] of edgeCounts.entries()) {
    if (count !== 1) continue;
    const parts = key.split(",");
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) boundaryEdges.push([a, b]);
  }

  const bounds = computeBoundsFromPoints([...top, ...bottom]);
  const sourceSignature = `${String(faceObj.uuid || faceObj.name || "FACE")}:${canonicalPositions.length}:${triangles.length}`;

  try { tempGeom?.dispose?.(); } catch { }

  return {
    top,
    bottom,
    triangles,
    boundaryEdges,
    bounds,
    sourceSignature,
  };
}

export function computeCenterFromBounds(boundsInput) {
  const bounds = boundsInput && typeof boundsInput === "object" ? boundsInput : BOUNDS_FALLBACK;
  const min = toVec3(bounds.min, BOUNDS_FALLBACK.min);
  const max = toVec3(bounds.max, BOUNDS_FALLBACK.max);
  return [
    0.5 * (min[0] + max[0]),
    0.5 * (min[1] + max[1]),
    0.5 * (min[2] + max[2]),
  ];
}

export function addTriangleFacingOutward(solid, faceName, p0, p1, p2, center) {
  if (!solid || !p0 || !p1 || !p2) return;
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const lenSq = nx * nx + ny * ny + nz * nz;
  if (!(lenSq > 1e-24)) return;
  const cx = (p0[0] + p1[0] + p2[0]) / 3;
  const cy = (p0[1] + p1[1] + p2[1]) / 3;
  const cz = (p0[2] + p1[2] + p2[2]) / 3;
  const vx = center[0] - cx;
  const vy = center[1] - cy;
  const vz = center[2] - cz;
  const dot = nx * vx + ny * vy + nz * vz;
  if (dot > 0) solid.addTriangle(faceName, p0, p2, p1);
  else solid.addTriangle(faceName, p0, p1, p2);
}

export function mergeNearDuplicatePoints(pointsInput, tolerance = 1e-9) {
  const points = Array.isArray(pointsInput) ? pointsInput : [];
  if (!points.length) return [];
  const out = [toVec3(points[0])];
  const tolSq = tolerance * tolerance;
  for (let i = 1; i < points.length; i++) {
    const p = toVec3(points[i]);
    const prev = out[out.length - 1];
    if (vec3DistanceSq(p, prev) > tolSq) out.push(p);
  }
  return out;
}

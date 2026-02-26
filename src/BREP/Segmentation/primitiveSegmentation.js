const DEG2RAD = Math.PI / 180;
const EPS = 1e-12;
const TYPE_PLANE = "PLANE";
const TYPE_CYLINDER = "CYLINDER";
const TYPE_CONE = "CONE";
const TYPE_OTHER = "OTHER";

const TYPE_CODE_PLANE = 0;
const TYPE_CODE_CYLINDER = 1;
const TYPE_CODE_CONE = 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createRng(seed = 1337) {
  // Deterministic, fast 32-bit PRNG (Mulberry32).
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeXYZ(x, y, z) {
  const len = Math.hypot(x, y, z);
  if (!(len > EPS)) return null;
  const inv = 1 / len;
  return [x * inv, y * inv, z * inv];
}

function dotXYZ(ax, ay, az, bx, by, bz) {
  return (ax * bx) + (ay * by) + (az * bz);
}

function crossXYZ(ax, ay, az, bx, by, bz) {
  return [
    (ay * bz) - (az * by),
    (az * bx) - (ax * bz),
    (ax * by) - (ay * bx),
  ];
}

function binarySearchCdf(cdf, value) {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value <= cdf[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function edgeKey(v0, v1, edgeMul) {
  const a = v0 < v1 ? v0 : v1;
  const b = v0 < v1 ? v1 : v0;
  return (a * edgeMul) + b;
}

function addEdge(edgeMap, edgeMul, v0, v1, tri) {
  if (v0 === v1) return;
  const a = v0 < v1 ? v0 : v1;
  const b = v0 < v1 ? v1 : v0;
  const key = edgeKey(a, b, edgeMul);
  const edge = edgeMap.get(key);
  if (!edge) {
    edgeMap.set(key, {
      v0: a,
      v1: b,
      t0: tri,
      t1: -1,
      extra: null,
    });
    return;
  }
  if (edge.t1 < 0) {
    edge.t1 = tri;
    return;
  }
  if (edge.extra == null) edge.extra = [tri];
  else edge.extra.push(tri);
}

function forEachEdgePair(edge, cb) {
  if (edge.t1 < 0) return;
  if (!edge.extra || edge.extra.length === 0) {
    cb(edge.t0, edge.t1);
    return;
  }
  const list = [edge.t0, edge.t1, ...edge.extra];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      cb(list[i], list[j]);
    }
  }
}

function edgeIncidentTriangles(edge, out) {
  out.length = 0;
  out.push(edge.t0);
  if (edge.t1 >= 0) out.push(edge.t1);
  if (edge.extra && edge.extra.length) {
    for (let i = 0; i < edge.extra.length; i += 1) out.push(edge.extra[i]);
  }
  return out;
}

function precomputeMeshData(mesh) {
  const vertProperties = mesh?.vertProperties;
  const triVerts = mesh?.triVerts;

  const vertCount = (vertProperties && vertProperties.length >= 3)
    ? ((vertProperties.length / 3) | 0)
    : 0;
  const triCount = (triVerts && triVerts.length >= 3)
    ? ((triVerts.length / 3) | 0)
    : 0;

  const triNormals = new Float32Array(triCount * 3);
  const triAreas = new Float32Array(triCount);
  const triCentroids = new Float32Array(triCount * 3);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  if (vertCount > 0) {
    for (let i = 0; i < vertCount; i += 1) {
      const b = i * 3;
      const x = Number(vertProperties[b + 0]);
      const y = Number(vertProperties[b + 1]);
      const z = Number(vertProperties[b + 2]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  } else {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const bboxDiag = Math.hypot(dx, dy, dz);

  const edgeMap = new Map();
  const edgeMul = vertCount + 1;

  for (let t = 0; t < triCount; t += 1) {
    const base = t * 3;
    const i0 = Number(triVerts[base + 0]);
    const i1 = Number(triVerts[base + 1]);
    const i2 = Number(triVerts[base + 2]);

    const valid =
      Number.isInteger(i0) && Number.isInteger(i1) && Number.isInteger(i2) &&
      i0 >= 0 && i1 >= 0 && i2 >= 0 &&
      i0 < vertCount && i1 < vertCount && i2 < vertCount;

    if (!valid) continue;

    const a = i0 * 3;
    const b = i1 * 3;
    const c = i2 * 3;

    const ax = Number(vertProperties[a + 0]);
    const ay = Number(vertProperties[a + 1]);
    const az = Number(vertProperties[a + 2]);
    const bx = Number(vertProperties[b + 0]);
    const by = Number(vertProperties[b + 1]);
    const bz = Number(vertProperties[b + 2]);
    const cx = Number(vertProperties[c + 0]);
    const cy = Number(vertProperties[c + 1]);
    const cz = Number(vertProperties[c + 2]);

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = (uy * vz) - (uz * vy);
    const ny = (uz * vx) - (ux * vz);
    const nz = (ux * vy) - (uy * vx);
    const nLen = Math.hypot(nx, ny, nz);

    const nBase = t * 3;
    if (nLen > EPS) {
      const inv = 1 / nLen;
      triNormals[nBase + 0] = nx * inv;
      triNormals[nBase + 1] = ny * inv;
      triNormals[nBase + 2] = nz * inv;
      triAreas[t] = 0.5 * nLen;
    } else {
      triNormals[nBase + 0] = 0;
      triNormals[nBase + 1] = 0;
      triNormals[nBase + 2] = 1;
      triAreas[t] = 0;
    }

    triCentroids[nBase + 0] = (ax + bx + cx) / 3;
    triCentroids[nBase + 1] = (ay + by + cy) / 3;
    triCentroids[nBase + 2] = (az + bz + cz) / 3;

    addEdge(edgeMap, edgeMul, i0, i1, t);
    addEdge(edgeMap, edgeMul, i1, i2, t);
    addEdge(edgeMap, edgeMul, i2, i0, t);
  }

  const triDegree = new Int32Array(triCount);
  for (const edge of edgeMap.values()) {
    forEachEdgePair(edge, (ta, tb) => {
      triDegree[ta] += 1;
      triDegree[tb] += 1;
    });
  }

  const adjacencyOffsets = new Int32Array(triCount + 1);
  for (let t = 0; t < triCount; t += 1) {
    adjacencyOffsets[t + 1] = adjacencyOffsets[t] + triDegree[t];
  }
  const adjacency = new Int32Array(adjacencyOffsets[triCount]);
  const cursor = new Int32Array(adjacencyOffsets);

  for (const edge of edgeMap.values()) {
    forEachEdgePair(edge, (ta, tb) => {
      adjacency[cursor[ta]++] = tb;
      adjacency[cursor[tb]++] = ta;
    });
  }

  return {
    vertCount,
    triCount,
    triNormals,
    triAreas,
    triCentroids,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      diag: bboxDiag,
    },
    edgeMap,
    adjacencyOffsets,
    adjacency,
  };
}

function buildAreaWeightedSamples(mesh, pre, sampleCount, rng) {
  const triCount = pre.triCount;
  const triAreas = pre.triAreas;
  const triNormals = pre.triNormals;
  const triCentroids = pre.triCentroids;

  if (triCount <= 0 || sampleCount <= 0) {
    return {
      samplePos: new Float32Array(0),
      sampleNrm: new Float32Array(0),
      sampleTri: new Uint32Array(0),
    };
  }

  const areaTris = [];
  const areaCdf = [];
  let totalArea = 0;
  for (let t = 0; t < triCount; t += 1) {
    const area = triAreas[t];
    if (!(area > EPS)) continue;
    totalArea += area;
    areaTris.push(t);
    areaCdf.push(totalArea);
  }

  const outCount = sampleCount | 0;
  const samplePos = new Float32Array(outCount * 3);
  const sampleNrm = new Float32Array(outCount * 3);
  const sampleTri = new Uint32Array(outCount);

  if (!(totalArea > EPS) || areaTris.length === 0) {
    for (let s = 0; s < outCount; s += 1) {
      const t = s % triCount;
      const b = s * 3;
      const tb = t * 3;
      samplePos[b + 0] = triCentroids[tb + 0];
      samplePos[b + 1] = triCentroids[tb + 1];
      samplePos[b + 2] = triCentroids[tb + 2];
      sampleNrm[b + 0] = triNormals[tb + 0];
      sampleNrm[b + 1] = triNormals[tb + 1];
      sampleNrm[b + 2] = triNormals[tb + 2];
      sampleTri[s] = t;
    }
    return { samplePos, sampleNrm, sampleTri };
  }

  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  for (let s = 0; s < outCount; s += 1) {
    const r = rng() * totalArea;
    const idx = binarySearchCdf(areaCdf, r);
    const tri = areaTris[idx];
    const triBase = tri * 3;

    const i0 = Number(tv[triBase + 0]);
    const i1 = Number(tv[triBase + 1]);
    const i2 = Number(tv[triBase + 2]);

    const valid = (
      i0 >= 0 && i1 >= 0 && i2 >= 0 &&
      i0 < pre.vertCount && i1 < pre.vertCount && i2 < pre.vertCount
    );

    const outBase = s * 3;
    if (valid) {
      const a = i0 * 3;
      const b = i1 * 3;
      const c = i2 * 3;
      const ax = Number(vp[a + 0]);
      const ay = Number(vp[a + 1]);
      const az = Number(vp[a + 2]);
      const bx = Number(vp[b + 0]);
      const by = Number(vp[b + 1]);
      const bz = Number(vp[b + 2]);
      const cx = Number(vp[c + 0]);
      const cy = Number(vp[c + 1]);
      const cz = Number(vp[c + 2]);

      // Uniform sampling on triangle by square-root barycentric transform.
      const su = Math.sqrt(rng());
      const v = rng();
      const w0 = 1 - su;
      const w1 = su * (1 - v);
      const w2 = su * v;
      samplePos[outBase + 0] = (w0 * ax) + (w1 * bx) + (w2 * cx);
      samplePos[outBase + 1] = (w0 * ay) + (w1 * by) + (w2 * cy);
      samplePos[outBase + 2] = (w0 * az) + (w1 * bz) + (w2 * cz);
    } else {
      const cb = tri * 3;
      samplePos[outBase + 0] = triCentroids[cb + 0];
      samplePos[outBase + 1] = triCentroids[cb + 1];
      samplePos[outBase + 2] = triCentroids[cb + 2];
    }

    const nb = tri * 3;
    sampleNrm[outBase + 0] = triNormals[nb + 0];
    sampleNrm[outBase + 1] = triNormals[nb + 1];
    sampleNrm[outBase + 2] = triNormals[nb + 2];
    sampleTri[s] = tri;
  }

  return { samplePos, sampleNrm, sampleTri };
}

function pickDistinctSamples(activeIndices, activeCount, rng, out, required) {
  if (activeCount < required) return false;
  for (let i = 0; i < required; i += 1) out[i] = -1;
  let attempts = 0;
  let found = 0;
  while (found < required && attempts < 128) {
    attempts += 1;
    const idx = (rng() * activeCount) | 0;
    const sid = activeIndices[idx];
    let already = false;
    for (let i = 0; i < found; i += 1) {
      if (out[i] === sid) {
        already = true;
        break;
      }
    }
    if (already) continue;
    out[found++] = sid;
  }
  return found === required;
}

function buildPlaneHypothesis(activeIndices, activeCount, samples, rng) {
  const picked = [-1, -1, -1];
  if (!pickDistinctSamples(activeIndices, activeCount, rng, picked, 3)) return null;

  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;

  const a = picked[0] * 3;
  const b = picked[1] * 3;
  const c = picked[2] * 3;

  const ax = pos[a + 0];
  const ay = pos[a + 1];
  const az = pos[a + 2];
  const bx = pos[b + 0];
  const by = pos[b + 1];
  const bz = pos[b + 2];
  const cx = pos[c + 0];
  const cy = pos[c + 1];
  const cz = pos[c + 2];

  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const cr = crossXYZ(ux, uy, uz, vx, vy, vz);
  const n = normalizeXYZ(cr[0], cr[1], cr[2]);
  if (!n) return null;
  let nx = n[0];
  let ny = n[1];
  let nz = n[2];

  const nAvgX = (nrm[a + 0] + nrm[b + 0] + nrm[c + 0]) / 3;
  const nAvgY = (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) / 3;
  const nAvgZ = (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]) / 3;
  if (dotXYZ(nx, ny, nz, nAvgX, nAvgY, nAvgZ) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const d = -dotXYZ(nx, ny, nz, ax, ay, az);
  return {
    type: TYPE_PLANE,
    params: { nx, ny, nz, d },
  };
}

function closestPointsMidpointForLines(
  p1x, p1y, p1z, d1x, d1y, d1z,
  p2x, p2y, p2z, d2x, d2y, d2z
) {
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;

  const a = dotXYZ(d1x, d1y, d1z, d1x, d1y, d1z);
  const b = dotXYZ(d1x, d1y, d1z, d2x, d2y, d2z);
  const c = dotXYZ(d2x, d2y, d2z, d2x, d2y, d2z);
  const d = dotXYZ(d1x, d1y, d1z, rx, ry, rz);
  const e = dotXYZ(d2x, d2y, d2z, rx, ry, rz);
  const den = (a * c) - (b * b);
  if (Math.abs(den) < 1e-10) return null;

  const t1 = ((b * e) - (c * d)) / den;
  const t2 = ((a * e) - (b * d)) / den;

  const c1x = p1x + (d1x * t1);
  const c1y = p1y + (d1y * t1);
  const c1z = p1z + (d1z * t1);
  const c2x = p2x + (d2x * t2);
  const c2y = p2y + (d2y * t2);
  const c2z = p2z + (d2z * t2);

  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dz = c1z - c2z;
  const sep = Math.hypot(dx, dy, dz);

  return {
    x: (c1x + c2x) * 0.5,
    y: (c1y + c2y) * 0.5,
    z: (c1z + c2z) * 0.5,
    sep,
  };
}

function buildCylinderHypothesis(activeIndices, activeCount, samples, rng, distEps) {
  const picked = [-1, -1];
  if (!pickDistinctSamples(activeIndices, activeCount, rng, picked, 2)) return null;

  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;
  const a = picked[0] * 3;
  const b = picked[1] * 3;

  const p0x = pos[a + 0];
  const p0y = pos[a + 1];
  const p0z = pos[a + 2];
  const p1x = pos[b + 0];
  const p1y = pos[b + 1];
  const p1z = pos[b + 2];

  const n0x = nrm[a + 0];
  const n0y = nrm[a + 1];
  const n0z = nrm[a + 2];
  const n1x = nrm[b + 0];
  const n1y = nrm[b + 1];
  const n1z = nrm[b + 2];

  const c = crossXYZ(n0x, n0y, n0z, n1x, n1y, n1z);
  const axis = normalizeXYZ(c[0], c[1], c[2]);
  if (!axis) return null;
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];

  const n0dot = dotXYZ(n0x, n0y, n0z, ux, uy, uz);
  const n1dot = dotXYZ(n1x, n1y, n1z, ux, uy, uz);

  let m0x = n0x - (n0dot * ux);
  let m0y = n0y - (n0dot * uy);
  let m0z = n0z - (n0dot * uz);
  let m1x = n1x - (n1dot * ux);
  let m1y = n1y - (n1dot * uy);
  let m1z = n1z - (n1dot * uz);

  const m0 = normalizeXYZ(m0x, m0y, m0z);
  const m1 = normalizeXYZ(m1x, m1y, m1z);
  if (!m0 || !m1) return null;
  m0x = m0[0]; m0y = m0[1]; m0z = m0[2];
  m1x = m1[0]; m1y = m1[1]; m1z = m1[2];

  const p0u = dotXYZ(p0x, p0y, p0z, ux, uy, uz);
  const p1u = dotXYZ(p1x, p1y, p1z, ux, uy, uz);

  const q0x = p0x - (p0u * ux);
  const q0y = p0y - (p0u * uy);
  const q0z = p0z - (p0u * uz);
  const q1x = p1x - (p1u * ux);
  const q1y = p1y - (p1u * uy);
  const q1z = p1z - (p1u * uz);

  const dmx = m0x - m1x;
  const dmy = m0y - m1y;
  const dmz = m0z - m1z;
  const dqx = q0x - q1x;
  const dqy = q0y - q1y;
  const dqz = q0z - q1z;

  const denom = dotXYZ(dmx, dmy, dmz, dmx, dmy, dmz);
  if (!(denom > 1e-10)) return null;

  const signedRadius = dotXYZ(dqx, dqy, dqz, dmx, dmy, dmz) / denom;
  const radius = Math.abs(signedRadius);
  if (!(radius > Math.max(distEps * 0.25, 1e-8))) return null;

  const c0x = q0x - (signedRadius * m0x);
  const c0y = q0y - (signedRadius * m0y);
  const c0z = q0z - (signedRadius * m0z);
  const c1x = q1x - (signedRadius * m1x);
  const c1y = q1y - (signedRadius * m1y);
  const c1z = q1z - (signedRadius * m1z);

  const cx = (c0x + c1x) * 0.5;
  const cy = (c0y + c1y) * 0.5;
  const cz = (c0z + c1z) * 0.5;

  const t = (p0u + p1u) * 0.5;
  const ax = cx + (ux * t);
  const ay = cy + (uy * t);
  const az = cz + (uz * t);

  return {
    type: TYPE_CYLINDER,
    params: { ax, ay, az, ux, uy, uz, radius },
  };
}

function buildConeHypothesis(activeIndices, activeCount, samples, rng, distEps) {
  const picked = [-1, -1, -1];
  if (!pickDistinctSamples(activeIndices, activeCount, rng, picked, 3)) return null;

  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;
  const a = picked[0] * 3;
  const b = picked[1] * 3;
  const c = picked[2] * 3;

  const p0x = pos[a + 0];
  const p0y = pos[a + 1];
  const p0z = pos[a + 2];
  const p1x = pos[b + 0];
  const p1y = pos[b + 1];
  const p1z = pos[b + 2];

  const n0x = nrm[a + 0];
  const n0y = nrm[a + 1];
  const n0z = nrm[a + 2];
  const n1x = nrm[b + 0];
  const n1y = nrm[b + 1];
  const n1z = nrm[b + 2];
  const n2x = nrm[c + 0];
  const n2y = nrm[c + 1];
  const n2z = nrm[c + 2];

  const d01x = n0x - n1x;
  const d01y = n0y - n1y;
  const d01z = n0z - n1z;
  const d02x = n0x - n2x;
  const d02y = n0y - n2y;
  const d02z = n0z - n2z;

  let axis = normalizeXYZ(...crossXYZ(d01x, d01y, d01z, d02x, d02y, d02z));
  if (!axis) axis = normalizeXYZ(...crossXYZ(n0x, n0y, n0z, n1x, n1y, n1z));
  if (!axis) return null;
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];

  let meanDot = (
    dotXYZ(n0x, n0y, n0z, ux, uy, uz) +
    dotXYZ(n1x, n1y, n1z, ux, uy, uz) +
    dotXYZ(n2x, n2y, n2z, ux, uy, uz)
  ) / 3;
  if (meanDot > 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
    meanDot = -meanDot;
  }

  const sinA = clamp(-meanDot, Math.sin(2 * DEG2RAD), Math.sin(88 * DEG2RAD));
  const angleRad = Math.asin(sinA);
  const cosA = Math.cos(angleRad);
  if (!(cosA > 1e-4)) return null;

  let er0x = n0x + (sinA * ux);
  let er0y = n0y + (sinA * uy);
  let er0z = n0z + (sinA * uz);
  let er1x = n1x + (sinA * ux);
  let er1y = n1y + (sinA * uy);
  let er1z = n1z + (sinA * uz);

  const er0 = normalizeXYZ(er0x, er0y, er0z);
  const er1 = normalizeXYZ(er1x, er1y, er1z);
  if (!er0 || !er1) return null;
  er0x = er0[0]; er0y = er0[1]; er0z = er0[2];
  er1x = er1[0]; er1y = er1[1]; er1z = er1[2];

  let g0x = (cosA * ux) + (sinA * er0x);
  let g0y = (cosA * uy) + (sinA * er0y);
  let g0z = (cosA * uz) + (sinA * er0z);
  let g1x = (cosA * ux) + (sinA * er1x);
  let g1y = (cosA * uy) + (sinA * er1y);
  let g1z = (cosA * uz) + (sinA * er1z);
  const g0 = normalizeXYZ(g0x, g0y, g0z);
  const g1 = normalizeXYZ(g1x, g1y, g1z);
  if (!g0 || !g1) return null;
  g0x = -g0[0]; g0y = -g0[1]; g0z = -g0[2];
  g1x = -g1[0]; g1y = -g1[1]; g1z = -g1[2];

  const apex = closestPointsMidpointForLines(
    p0x, p0y, p0z, g0x, g0y, g0z,
    p1x, p1y, p1z, g1x, g1y, g1z
  );
  if (!apex || !Number.isFinite(apex.sep) || apex.sep > (distEps * 8)) return null;

  return {
    type: TYPE_CONE,
    params: {
      apx: apex.x,
      apy: apex.y,
      apz: apex.z,
      ux,
      uy,
      uz,
      angleRad,
      sinA,
      cosA,
      tanA: Math.tan(angleRad),
    },
  };
}

function planeSampleInlier(params, px, py, pz, nx, ny, nz, distEps, cosAngle) {
  const dist = Math.abs(dotXYZ(params.nx, params.ny, params.nz, px, py, pz) + params.d);
  if (dist > distEps) return false;
  const nd = Math.abs(dotXYZ(params.nx, params.ny, params.nz, nx, ny, nz));
  return nd >= cosAngle;
}

function cylinderSampleInlier(params, px, py, pz, nx, ny, nz, distEps, cosAngle) {
  const dx = px - params.ax;
  const dy = py - params.ay;
  const dz = pz - params.az;
  const h = dotXYZ(dx, dy, dz, params.ux, params.uy, params.uz);
  const rx = dx - (h * params.ux);
  const ry = dy - (h * params.uy);
  const rz = dz - (h * params.uz);
  const rLen = Math.hypot(rx, ry, rz);
  if (!(rLen > EPS)) return false;

  const dist = Math.abs(rLen - params.radius);
  if (dist > distEps) return false;

  const inv = 1 / rLen;
  const nd = Math.abs(dotXYZ(nx, ny, nz, rx * inv, ry * inv, rz * inv));
  return nd >= cosAngle;
}

function coneSampleInlier(params, px, py, pz, nx, ny, nz, distEps, cosAngle) {
  const vx = px - params.apx;
  const vy = py - params.apy;
  const vz = pz - params.apz;
  const h = dotXYZ(vx, vy, vz, params.ux, params.uy, params.uz);
  const rx = vx - (h * params.ux);
  const ry = vy - (h * params.uy);
  const rz = vz - (h * params.uz);
  const rho = Math.hypot(rx, ry, rz);
  if (!(rho > EPS)) return false;

  // Distance in cone cross-section (axis/radius plane).
  const dist = Math.abs((rho * params.cosA) - (Math.abs(h) * params.sinA));
  if (dist > distEps) return false;

  const signH = h >= 0 ? 1 : -1;
  const invRho = 1 / rho;
  const npx = (params.cosA * rx * invRho) - (params.sinA * signH * params.ux);
  const npy = (params.cosA * ry * invRho) - (params.sinA * signH * params.uy);
  const npz = (params.cosA * rz * invRho) - (params.sinA * signH * params.uz);
  const nd = Math.abs(dotXYZ(nx, ny, nz, npx, npy, npz));
  return nd >= cosAngle;
}

function sampleInlier(model, px, py, pz, nx, ny, nz, distEps, cosAngle) {
  if (model.type === TYPE_PLANE) {
    return planeSampleInlier(model.params, px, py, pz, nx, ny, nz, distEps, cosAngle);
  }
  if (model.type === TYPE_CYLINDER) {
    return cylinderSampleInlier(model.params, px, py, pz, nx, ny, nz, distEps, cosAngle);
  }
  return coneSampleInlier(model.params, px, py, pz, nx, ny, nz, distEps, cosAngle);
}

function countInliersQuick(model, activeIndices, activeCount, samples, distEps, cosAngle, stride, offset) {
  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;
  let count = 0;
  for (let i = offset; i < activeCount; i += stride) {
    const sid = activeIndices[i];
    const b = sid * 3;
    if (sampleInlier(
      model,
      pos[b + 0], pos[b + 1], pos[b + 2],
      nrm[b + 0], nrm[b + 1], nrm[b + 2],
      distEps,
      cosAngle
    )) {
      count += 1;
    }
  }
  return count;
}

function collectInliers(model, activeIndices, activeCount, samples, distEps, cosAngle) {
  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;
  const inliers = [];
  for (let i = 0; i < activeCount; i += 1) {
    const sid = activeIndices[i];
    const b = sid * 3;
    if (sampleInlier(
      model,
      pos[b + 0], pos[b + 1], pos[b + 2],
      nrm[b + 0], nrm[b + 1], nrm[b + 2],
      distEps,
      cosAngle
    )) {
      inliers.push(sid);
    }
  }
  return inliers;
}

function jacobiSmallestEigenVectorSymmetric3(m00, m01, m02, m11, m12, m22) {
  // Symmetric 3x3 Jacobi diagonalization.
  const m = [
    m00, m01, m02,
    m01, m11, m12,
    m02, m12, m22,
  ];
  const v = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];

  for (let iter = 0; iter < 24; iter += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(m[1]);
    const a02 = Math.abs(m[2]);
    const a12 = Math.abs(m[5]);
    if (a02 > max) {
      max = a02;
      p = 0; q = 2;
    }
    if (a12 > max) {
      max = a12;
      p = 1; q = 2;
    }
    if (!(max > 1e-15)) break;

    const pp = m[(p * 3) + p];
    const qq = m[(q * 3) + q];
    const pq = m[(p * 3) + q];
    const phi = 0.5 * Math.atan2(2 * pq, qq - pp);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let r = 0; r < 3; r += 1) {
      const mrp = m[(r * 3) + p];
      const mrq = m[(r * 3) + q];
      m[(r * 3) + p] = (c * mrp) - (s * mrq);
      m[(r * 3) + q] = (s * mrp) + (c * mrq);
    }
    for (let r = 0; r < 3; r += 1) {
      const mpr = m[(p * 3) + r];
      const mqr = m[(q * 3) + r];
      m[(p * 3) + r] = (c * mpr) - (s * mqr);
      m[(q * 3) + r] = (s * mpr) + (c * mqr);
    }

    // Numerical symmetry projection.
    m[3] = m[1] = 0.5 * (m[1] + m[3]);
    m[6] = m[2] = 0.5 * (m[2] + m[6]);
    m[7] = m[5] = 0.5 * (m[5] + m[7]);

    for (let r = 0; r < 3; r += 1) {
      const vrp = v[(r * 3) + p];
      const vrq = v[(r * 3) + q];
      v[(r * 3) + p] = (c * vrp) - (s * vrq);
      v[(r * 3) + q] = (s * vrp) + (c * vrq);
    }
  }

  const d0 = m[0];
  const d1 = m[4];
  const d2 = m[8];
  let idx = 0;
  if (d1 < d0 && d1 <= d2) idx = 1;
  else if (d2 < d0 && d2 < d1) idx = 2;

  const x = v[(0 * 3) + idx];
  const y = v[(1 * 3) + idx];
  const z = v[(2 * 3) + idx];
  const n = normalizeXYZ(x, y, z);
  if (!n) return [0, 0, 1];
  return n;
}

function solveLinear3x3(
  a00, a01, a02,
  a10, a11, a12,
  a20, a21, a22,
  b0, b1, b2
) {
  const m = [
    [a00, a01, a02, b0],
    [a10, a11, a12, b1],
    [a20, a21, a22, b2],
  ];

  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    let maxAbs = Math.abs(m[col][col]);
    for (let row = col + 1; row < 3; row += 1) {
      const v = Math.abs(m[row][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivot = row;
      }
    }
    if (!(maxAbs > 1e-14)) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const inv = 1 / m[col][col];
    for (let k = col; k < 4; k += 1) m[col][k] *= inv;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      if (Math.abs(factor) < 1e-16) continue;
      for (let k = col; k < 4; k += 1) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function buildPerpBasis(ux, uy, uz) {
  let tx = 1;
  let ty = 0;
  let tz = 0;
  if (Math.abs(ux) > 0.9) {
    tx = 0;
    ty = 1;
    tz = 0;
  }
  let e1 = crossXYZ(ux, uy, uz, tx, ty, tz);
  let n1 = normalizeXYZ(e1[0], e1[1], e1[2]);
  if (!n1) {
    e1 = crossXYZ(ux, uy, uz, 0, 0, 1);
    n1 = normalizeXYZ(e1[0], e1[1], e1[2]);
    if (!n1) n1 = [1, 0, 0];
  }
  const e2 = crossXYZ(ux, uy, uz, n1[0], n1[1], n1[2]);
  const n2 = normalizeXYZ(e2[0], e2[1], e2[2]) || [0, 1, 0];
  return {
    e1x: n1[0], e1y: n1[1], e1z: n1[2],
    e2x: n2[0], e2y: n2[1], e2z: n2[2],
  };
}

function refitPlaneFromSamples(sampleIndices, samples, prevParams) {
  if (!sampleIndices || sampleIndices.length < 3) return prevParams || null;
  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;

  let sx = 0;
  let sy = 0;
  let sz = 0;
  let snx = 0;
  let sny = 0;
  let snz = 0;

  const n = sampleIndices.length;
  for (let i = 0; i < n; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    sx += pos[b + 0];
    sy += pos[b + 1];
    sz += pos[b + 2];
    snx += nrm[b + 0];
    sny += nrm[b + 1];
    snz += nrm[b + 2];
  }
  const cx = sx / n;
  const cy = sy / n;
  const cz = sz / n;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < n; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    const dx = pos[b + 0] - cx;
    const dy = pos[b + 1] - cy;
    const dz = pos[b + 2] - cz;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }

  let normal = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let nx = normal[0];
  let ny = normal[1];
  let nz = normal[2];
  if (dotXYZ(nx, ny, nz, snx, sny, snz) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const d = -dotXYZ(nx, ny, nz, cx, cy, cz);
  return { nx, ny, nz, d };
}

function refitCylinderFromSamples(sampleIndices, samples, prevParams, distEps) {
  if (!sampleIndices || sampleIndices.length < 6) return prevParams || null;
  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let count = 0;

  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    const nx = nrm[b + 0];
    const ny = nrm[b + 1];
    const nz = nrm[b + 2];
    c00 += nx * nx;
    c01 += nx * ny;
    c02 += nx * nz;
    c11 += ny * ny;
    c12 += ny * nz;
    c22 += nz * nz;
    count += 1;
  }
  if (!(count > 0)) return prevParams || null;

  let axis = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];
  if (prevParams && dotXYZ(ux, uy, uz, prevParams.ux, prevParams.uy, prevParams.uz) < 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }

  const basis = buildPerpBasis(ux, uy, uz);
  let ata00 = 0;
  let ata01 = 0;
  let ata02 = 0;
  let ata11 = 0;
  let ata12 = 0;
  let ata22 = 0;
  let atb0 = 0;
  let atb1 = 0;
  let atb2 = 0;
  let sumT = 0;
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    const px = pos[b + 0];
    const py = pos[b + 1];
    const pz = pos[b + 2];
    const nx = nrm[b + 0];
    const ny = nrm[b + 1];
    const nz = nrm[b + 2];

    const t = dotXYZ(px, py, pz, ux, uy, uz);
    const qx = px - (t * ux);
    const qy = py - (t * uy);
    const qz = pz - (t * uz);
    const x = dotXYZ(qx, qy, qz, basis.e1x, basis.e1y, basis.e1z);
    const y = dotXYZ(qx, qy, qz, basis.e2x, basis.e2y, basis.e2z);

    let mx = nx - (dotXYZ(nx, ny, nz, ux, uy, uz) * ux);
    let my = ny - (dotXYZ(nx, ny, nz, ux, uy, uz) * uy);
    let mz = nz - (dotXYZ(nx, ny, nz, ux, uy, uz) * uz);
    const mLen = Math.hypot(mx, my, mz);
    if (!(mLen > EPS)) continue;
    mx /= mLen;
    my /= mLen;
    mz /= mLen;
    const m1 = dotXYZ(mx, my, mz, basis.e1x, basis.e1y, basis.e1z);
    const m2 = dotXYZ(mx, my, mz, basis.e2x, basis.e2y, basis.e2z);

    const w = 1;
    ata00 += w;
    ata01 += 0;
    ata02 += w * m1;
    atb0 += w * x;
    ata11 += w;
    ata12 += w * m2;
    atb1 += w * y;
    ata22 += w * ((m1 * m1) + (m2 * m2));
    atb2 += w * ((m1 * x) + (m2 * y));
    sumT += w * t;
    sumW += w;
    sumX += w * x;
    sumY += w * y;
  }
  if (!(sumW > 0)) return prevParams || null;

  const sol = solveLinear3x3(
    ata00, ata01, ata02,
    ata01, ata11, ata12,
    ata02, ata12, ata22,
    atb0, atb1, atb2
  );

  let cx;
  let cy;
  let radius;
  if (sol) {
    cx = sol[0];
    cy = sol[1];
    radius = Math.abs(sol[2]);
  } else {
    cx = sumX / sumW;
    cy = sumY / sumW;
    radius = 0;
    for (let i = 0; i < sampleIndices.length; i += 1) {
      const sid = sampleIndices[i];
      const b = sid * 3;
      const px = pos[b + 0];
      const py = pos[b + 1];
      const pz = pos[b + 2];
      const t = dotXYZ(px, py, pz, ux, uy, uz);
      const qx = px - (t * ux);
      const qy = py - (t * uy);
      const qz = pz - (t * uz);
      const x = dotXYZ(qx, qy, qz, basis.e1x, basis.e1y, basis.e1z);
      const y = dotXYZ(qx, qy, qz, basis.e2x, basis.e2y, basis.e2z);
      radius += Math.hypot(x - cx, y - cy);
    }
    radius /= sampleIndices.length;
  }

  if (!(radius > Math.max(distEps * 0.25, 1e-8))) return prevParams || null;

  const meanT = sumT / sumW;
  const c3x = (cx * basis.e1x) + (cy * basis.e2x);
  const c3y = (cx * basis.e1y) + (cy * basis.e2y);
  const c3z = (cx * basis.e1z) + (cy * basis.e2z);

  return {
    ax: c3x + (meanT * ux),
    ay: c3y + (meanT * uy),
    az: c3z + (meanT * uz),
    ux,
    uy,
    uz,
    radius,
  };
}

function refitConeFromSamples(sampleIndices, samples, prevParams) {
  if (!sampleIndices || sampleIndices.length < 8) return prevParams || null;
  const pos = samples.samplePos;
  const nrm = samples.sampleNrm;

  let mnx = 0;
  let mny = 0;
  let mnz = 0;
  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    mnx += nrm[b + 0];
    mny += nrm[b + 1];
    mnz += nrm[b + 2];
  }
  const invN = 1 / sampleIndices.length;
  mnx *= invN;
  mny *= invN;
  mnz *= invN;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    const dx = nrm[b + 0] - mnx;
    const dy = nrm[b + 1] - mny;
    const dz = nrm[b + 2] - mnz;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }

  let axis = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];
  if (prevParams && dotXYZ(ux, uy, uz, prevParams.ux, prevParams.uy, prevParams.uz) < 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }

  let meanDot = 0;
  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const b = sid * 3;
    meanDot += dotXYZ(nrm[b + 0], nrm[b + 1], nrm[b + 2], ux, uy, uz);
  }
  meanDot /= sampleIndices.length;
  let sinA = -meanDot;
  if (sinA < 0) {
    sinA = -sinA;
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }
  sinA = clamp(sinA, Math.sin(2 * DEG2RAD), Math.sin(88 * DEG2RAD));
  const angleRad = Math.asin(sinA);
  const cosA = Math.cos(angleRad);
  const tanA = Math.tan(angleRad);

  let a00 = 0;
  let a01 = 0;
  let a02 = 0;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < sampleIndices.length; i += 1) {
    const sid = sampleIndices[i];
    const idx = sid * 3;
    const px = pos[idx + 0];
    const py = pos[idx + 1];
    const pz = pos[idx + 2];
    const nx = nrm[idx + 0];
    const ny = nrm[idx + 1];
    const nz = nrm[idx + 2];

    let erx = nx + (sinA * ux);
    let ery = ny + (sinA * uy);
    let erz = nz + (sinA * uz);
    const er = normalizeXYZ(erx, ery, erz);
    if (!er) continue;
    erx = er[0];
    ery = er[1];
    erz = er[2];

    let dx = -((cosA * ux) + (sinA * erx));
    let dy = -((cosA * uy) + (sinA * ery));
    let dz = -((cosA * uz) + (sinA * erz));
    const dn = normalizeXYZ(dx, dy, dz);
    if (!dn) continue;
    dx = dn[0]; dy = dn[1]; dz = dn[2];

    const m00 = 1 - (dx * dx);
    const m01 = -(dx * dy);
    const m02 = -(dx * dz);
    const m11 = 1 - (dy * dy);
    const m12 = -(dy * dz);
    const m22 = 1 - (dz * dz);

    a00 += m00;
    a01 += m01;
    a02 += m02;
    a11 += m11;
    a12 += m12;
    a22 += m22;
    b0 += (m00 * px) + (m01 * py) + (m02 * pz);
    b1 += (m01 * px) + (m11 * py) + (m12 * pz);
    b2 += (m02 * px) + (m12 * py) + (m22 * pz);
  }

  const apex = solveLinear3x3(
    a00, a01, a02,
    a01, a11, a12,
    a02, a12, a22,
    b0, b1, b2
  );
  if (!apex) return prevParams || null;

  return {
    apx: apex[0],
    apy: apex[1],
    apz: apex[2],
    ux,
    uy,
    uz,
    angleRad,
    sinA,
    cosA,
    tanA,
  };
}

function refitModelFromSamples(modelType, sampleIndices, samples, prevParams, distEps) {
  if (modelType === TYPE_PLANE) return refitPlaneFromSamples(sampleIndices, samples, prevParams);
  if (modelType === TYPE_CYLINDER) return refitCylinderFromSamples(sampleIndices, samples, prevParams, distEps);
  return refitConeFromSamples(sampleIndices, samples, prevParams);
}

function choosePrimitiveType(rng, opts) {
  const allowPlane = !!opts?.enablePlane;
  const allowCylinder = !!opts?.enableCylinder;
  const allowCone = !!opts?.enableCone;

  if (allowPlane && allowCylinder && allowCone) {
    const r = rng();
    if (r < 0.42) return TYPE_PLANE;
    if (r < 0.78) return TYPE_CYLINDER;
    return TYPE_CONE;
  }

  if (allowPlane && allowCylinder) {
    return rng() < 0.52 ? TYPE_PLANE : TYPE_CYLINDER;
  }
  if (allowPlane && allowCone) {
    return rng() < 0.6 ? TYPE_PLANE : TYPE_CONE;
  }
  if (allowCylinder && allowCone) {
    return rng() < 0.62 ? TYPE_CYLINDER : TYPE_CONE;
  }
  if (allowPlane) return TYPE_PLANE;
  if (allowCylinder) return TYPE_CYLINDER;
  if (allowCone) return TYPE_CONE;
  return null;
}

function runPrimitiveRansac(pre, samples, opts, rng) {
  const sampleCount = samples.sampleTri.length;
  const models = [];
  if (sampleCount <= 0) return models;

  const active = new Uint32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) active[i] = i;
  let activeCount = sampleCount;

  const cosAngle = Math.cos(opts.angleEpsDeg * DEG2RAD);
  const markStamp = new Int32Array(sampleCount);
  let stamp = 1;

  while (models.length < opts.maxModels && activeCount >= opts.minInliers) {
    const quickEval = Math.min(4096, activeCount);
    const stride = Math.max(1, (activeCount / quickEval) | 0);
    const offset = (rng() * stride) | 0;
    const trials = Math.max(64, Math.min(180, 72 + ((activeCount / 4096) | 0)));

    let best = null;
    let bestQuick = -1;

    for (let i = 0; i < trials; i += 1) {
      const type = choosePrimitiveType(rng, opts);
      if (!type) continue;
      let candidate = null;
      if (type === TYPE_PLANE) {
        candidate = buildPlaneHypothesis(active, activeCount, samples, rng);
      } else if (type === TYPE_CYLINDER) {
        candidate = buildCylinderHypothesis(active, activeCount, samples, rng, opts.distEps);
      } else {
        candidate = buildConeHypothesis(active, activeCount, samples, rng, opts.distEps);
      }
      if (!candidate) continue;

      const quickCount = countInliersQuick(
        candidate,
        active,
        activeCount,
        samples,
        opts.distEps,
        cosAngle,
        stride,
        offset
      );

      if (quickCount > bestQuick) {
        bestQuick = quickCount;
        best = candidate;
      }
    }

    if (!best) break;

    let bestInliers = collectInliers(
      best,
      active,
      activeCount,
      samples,
      opts.distEps,
      cosAngle
    );
    if (bestInliers.length < opts.minInliers) break;

    let bestModel = best;
    for (let iter = 0; iter < opts.maxRefineIters; iter += 1) {
      const refinedParams = refitModelFromSamples(
        bestModel.type,
        bestInliers,
        samples,
        bestModel.params,
        opts.distEps
      );
      if (!refinedParams) break;
      const refined = { type: bestModel.type, params: refinedParams };
      const refinedInliers = collectInliers(
        refined,
        active,
        activeCount,
        samples,
        opts.distEps,
        cosAngle
      );
      if (refinedInliers.length < bestInliers.length) break;
      bestModel = refined;
      const improved = refinedInliers.length > bestInliers.length;
      bestInliers = refinedInliers;
      if (!improved) break;
    }

    const modelId = models.length;
    models.push({
      id: modelId,
      type: bestModel.type,
      params: bestModel.params,
      inlierSamples: Uint32Array.from(bestInliers),
      inlierCount: bestInliers.length,
    });

    stamp += 1;
    for (let i = 0; i < bestInliers.length; i += 1) {
      markStamp[bestInliers[i]] = stamp;
    }
    let w = 0;
    for (let i = 0; i < activeCount; i += 1) {
      const sid = active[i];
      if (markStamp[sid] === stamp) continue;
      active[w++] = sid;
    }
    activeCount = w;
  }

  return models;
}

function growTriangleAssignments(triBestModel, models, pre, distEps, cosAngle) {
  if (!models || models.length === 0) return;
  const triCount = pre.triCount;
  const cent = pre.triCentroids;
  const nrm = pre.triNormals;
  const offsets = pre.adjacencyOffsets;
  const adjacency = pre.adjacency;
  const candidateModels = [];
  const candidateCounts = [];
  const maxIters = 3;

  for (let iter = 0; iter < maxIters; iter += 1) {
    let changed = 0;
    for (let tri = 0; tri < triCount; tri += 1) {
      if (triBestModel[tri] >= 0) continue;
      candidateModels.length = 0;
      candidateCounts.length = 0;

      const start = offsets[tri];
      const end = offsets[tri + 1];
      for (let i = start; i < end; i += 1) {
        const nb = adjacency[i];
        const modelId = triBestModel[nb];
        if (modelId < 0) continue;
        let hit = -1;
        for (let k = 0; k < candidateModels.length; k += 1) {
          if (candidateModels[k] === modelId) {
            hit = k;
            break;
          }
        }
        if (hit >= 0) candidateCounts[hit] += 1;
        else {
          candidateModels.push(modelId);
          candidateCounts.push(1);
        }
      }
      if (candidateModels.length === 0) continue;

      // Try high-neighbor-support models first.
      for (let i = 0; i < candidateModels.length - 1; i += 1) {
        let best = i;
        for (let j = i + 1; j < candidateModels.length; j += 1) {
          if (candidateCounts[j] > candidateCounts[best]) best = j;
        }
        if (best !== i) {
          const tmpM = candidateModels[i];
          const tmpC = candidateCounts[i];
          candidateModels[i] = candidateModels[best];
          candidateCounts[i] = candidateCounts[best];
          candidateModels[best] = tmpM;
          candidateCounts[best] = tmpC;
        }
      }

      const b = tri * 3;
      const px = cent[b + 0];
      const py = cent[b + 1];
      const pz = cent[b + 2];
      const nx = nrm[b + 0];
      const ny = nrm[b + 1];
      const nz = nrm[b + 2];

      for (let i = 0; i < candidateModels.length; i += 1) {
        const modelId = candidateModels[i];
        const model = models[modelId];
        if (!sampleInlier(model, px, py, pz, nx, ny, nz, distEps, cosAngle)) continue;
        triBestModel[tri] = modelId;
        changed += 1;
        break;
      }
    }
    if (changed === 0) break;
  }
}

function voteTriangles(models, sampleTri, pre, opts) {
  const triCount = pre.triCount;
  const triBestModel = new Int32Array(triCount);
  triBestModel.fill(-1);
  const triBestVotes = new Int32Array(triCount);
  const triBestInlierCount = new Int32Array(triCount);
  const voteScratch = new Int32Array(triCount);

  for (let m = 0; m < models.length; m += 1) {
    const inliers = models[m].inlierSamples;
    const touched = [];
    for (let i = 0; i < inliers.length; i += 1) {
      const tri = sampleTri[inliers[i]];
      if (voteScratch[tri] === 0) touched.push(tri);
      voteScratch[tri] += 1;
    }
    for (let i = 0; i < touched.length; i += 1) {
      const tri = touched[i];
      const votes = voteScratch[tri];
      voteScratch[tri] = 0;
      if (votes < opts.minVotesPerTriangle) continue;

      const prevVotes = triBestVotes[tri];
      const prevModel = triBestModel[tri];
      const prevInlierCount = prevModel >= 0 ? triBestInlierCount[tri] : -1;
      const candidateInlierCount = models[m].inlierCount;
      const better = (
        (votes > prevVotes) ||
        (votes === prevVotes && candidateInlierCount > prevInlierCount) ||
        (votes === prevVotes && candidateInlierCount === prevInlierCount && (prevModel < 0 || m < prevModel))
      );
      if (better) {
        triBestModel[tri] = m;
        triBestVotes[tri] = votes;
        triBestInlierCount[tri] = candidateInlierCount;
      }
    }
  }

  growTriangleAssignments(
    triBestModel,
    models,
    pre,
    opts.distEps,
    Math.cos(opts.angleEpsDeg * DEG2RAD)
  );

  const triTypeCode = new Int8Array(triCount);
  triTypeCode.fill(-1);
  for (let t = 0; t < triCount; t += 1) {
    const modelId = triBestModel[t];
    if (modelId < 0) continue;
    const type = models[modelId].type;
    triTypeCode[t] = (
      type === TYPE_PLANE ? TYPE_CODE_PLANE :
      type === TYPE_CYLINDER ? TYPE_CODE_CYLINDER :
      TYPE_CODE_CONE
    );
  }
  return { triBestModel, triTypeCode };
}

function primitiveDistance(type, params, px, py, pz) {
  if (type === TYPE_PLANE) {
    return Math.abs(dotXYZ(params.nx, params.ny, params.nz, px, py, pz) + params.d);
  }
  if (type === TYPE_CYLINDER) {
    const dx = px - params.ax;
    const dy = py - params.ay;
    const dz = pz - params.az;
    const h = dotXYZ(dx, dy, dz, params.ux, params.uy, params.uz);
    const rx = dx - (h * params.ux);
    const ry = dy - (h * params.uy);
    const rz = dz - (h * params.uz);
    const rho = Math.hypot(rx, ry, rz);
    return Math.abs(rho - params.radius);
  }
  const vx = px - params.apx;
  const vy = py - params.apy;
  const vz = pz - params.apz;
  const h = dotXYZ(vx, vy, vz, params.ux, params.uy, params.uz);
  const rx = vx - (h * params.ux);
  const ry = vy - (h * params.uy);
  const rz = vz - (h * params.uz);
  const rho = Math.hypot(rx, ry, rz);
  return Math.abs((rho * params.cosA) - (Math.abs(h) * params.sinA));
}

function refitPlaneFromTriangles(component, pre, prevParams) {
  if (!component || component.length < 3) return prevParams || null;
  const cent = pre.triCentroids;
  const nrm = pre.triNormals;
  const area = pre.triAreas;

  let sumW = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nxAvg = 0;
  let nyAvg = 0;
  let nzAvg = 0;

  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    cx += w * cent[b + 0];
    cy += w * cent[b + 1];
    cz += w * cent[b + 2];
    nxAvg += w * nrm[b + 0];
    nyAvg += w * nrm[b + 1];
    nzAvg += w * nrm[b + 2];
    sumW += w;
  }
  if (!(sumW > 0)) return prevParams || null;
  cx /= sumW;
  cy /= sumW;
  cz /= sumW;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    const dx = cent[b + 0] - cx;
    const dy = cent[b + 1] - cy;
    const dz = cent[b + 2] - cz;
    c00 += w * dx * dx;
    c01 += w * dx * dy;
    c02 += w * dx * dz;
    c11 += w * dy * dy;
    c12 += w * dy * dz;
    c22 += w * dz * dz;
  }

  let normal = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let nx = normal[0];
  let ny = normal[1];
  let nz = normal[2];
  if (dotXYZ(nx, ny, nz, nxAvg, nyAvg, nzAvg) < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const d = -dotXYZ(nx, ny, nz, cx, cy, cz);
  return { nx, ny, nz, d };
}

function refitCylinderFromTriangles(component, pre, prevParams, distEps) {
  if (!component || component.length < 8) return prevParams || null;
  const cent = pre.triCentroids;
  const nrm = pre.triNormals;
  const area = pre.triAreas;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;

  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    const nx = nrm[b + 0];
    const ny = nrm[b + 1];
    const nz = nrm[b + 2];
    c00 += w * nx * nx;
    c01 += w * nx * ny;
    c02 += w * nx * nz;
    c11 += w * ny * ny;
    c12 += w * ny * nz;
    c22 += w * nz * nz;
  }

  let axis = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];
  if (prevParams && dotXYZ(ux, uy, uz, prevParams.ux, prevParams.uy, prevParams.uz) < 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }

  const basis = buildPerpBasis(ux, uy, uz);

  let ata00 = 0;
  let ata01 = 0;
  let ata02 = 0;
  let ata11 = 0;
  let ata12 = 0;
  let ata22 = 0;
  let atb0 = 0;
  let atb1 = 0;
  let atb2 = 0;
  let sumT = 0;
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < component.length; i += 1) {
    const tId = component[i];
    const w = Math.max(area[tId], 1e-16);
    const b = tId * 3;
    const px = cent[b + 0];
    const py = cent[b + 1];
    const pz = cent[b + 2];
    const nx = nrm[b + 0];
    const ny = nrm[b + 1];
    const nz = nrm[b + 2];

    const t = dotXYZ(px, py, pz, ux, uy, uz);
    const qx = px - (t * ux);
    const qy = py - (t * uy);
    const qz = pz - (t * uz);
    const x = dotXYZ(qx, qy, qz, basis.e1x, basis.e1y, basis.e1z);
    const y = dotXYZ(qx, qy, qz, basis.e2x, basis.e2y, basis.e2z);

    const nDotU = dotXYZ(nx, ny, nz, ux, uy, uz);
    let mx = nx - (nDotU * ux);
    let my = ny - (nDotU * uy);
    let mz = nz - (nDotU * uz);
    const mLen = Math.hypot(mx, my, mz);
    if (!(mLen > EPS)) continue;
    mx /= mLen;
    my /= mLen;
    mz /= mLen;
    const m1 = dotXYZ(mx, my, mz, basis.e1x, basis.e1y, basis.e1z);
    const m2 = dotXYZ(mx, my, mz, basis.e2x, basis.e2y, basis.e2z);

    ata00 += w;
    ata01 += 0;
    ata02 += w * m1;
    atb0 += w * x;
    ata11 += w;
    ata12 += w * m2;
    atb1 += w * y;
    ata22 += w * ((m1 * m1) + (m2 * m2));
    atb2 += w * ((m1 * x) + (m2 * y));
    sumT += w * t;
    sumW += w;
    sumX += w * x;
    sumY += w * y;
  }
  if (!(sumW > 0)) return prevParams || null;

  const sol = solveLinear3x3(
    ata00, ata01, ata02,
    ata01, ata11, ata12,
    ata02, ata12, ata22,
    atb0, atb1, atb2
  );

  let cx;
  let cy;
  let radius;
  if (sol) {
    cx = sol[0];
    cy = sol[1];
    radius = Math.abs(sol[2]);
  } else {
    cx = sumX / sumW;
    cy = sumY / sumW;
    radius = 0;
    let radiusW = 0;
    for (let i = 0; i < component.length; i += 1) {
      const tId = component[i];
      const w = Math.max(area[tId], 1e-16);
      const b = tId * 3;
      const px = cent[b + 0];
      const py = cent[b + 1];
      const pz = cent[b + 2];
      const t = dotXYZ(px, py, pz, ux, uy, uz);
      const qx = px - (t * ux);
      const qy = py - (t * uy);
      const qz = pz - (t * uz);
      const x = dotXYZ(qx, qy, qz, basis.e1x, basis.e1y, basis.e1z);
      const y = dotXYZ(qx, qy, qz, basis.e2x, basis.e2y, basis.e2z);
      radius += w * Math.hypot(x - cx, y - cy);
      radiusW += w;
    }
    radius = radiusW > 0 ? (radius / radiusW) : 0;
  }

  if (!(radius > Math.max(distEps * 0.25, 1e-8))) return prevParams || null;

  const meanT = sumT / sumW;
  const c3x = (cx * basis.e1x) + (cy * basis.e2x);
  const c3y = (cx * basis.e1y) + (cy * basis.e2y);
  const c3z = (cx * basis.e1z) + (cy * basis.e2z);
  return {
    ax: c3x + (meanT * ux),
    ay: c3y + (meanT * uy),
    az: c3z + (meanT * uz),
    ux,
    uy,
    uz,
    radius,
  };
}

function refitConeFromTriangles(component, pre, prevParams) {
  if (!component || component.length < 10) return prevParams || null;
  const cent = pre.triCentroids;
  const nrm = pre.triNormals;
  const area = pre.triAreas;

  let sumW = 0;
  let mnx = 0;
  let mny = 0;
  let mnz = 0;
  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    mnx += w * nrm[b + 0];
    mny += w * nrm[b + 1];
    mnz += w * nrm[b + 2];
    sumW += w;
  }
  if (!(sumW > 0)) return prevParams || null;
  mnx /= sumW;
  mny /= sumW;
  mnz /= sumW;

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    const dx = nrm[b + 0] - mnx;
    const dy = nrm[b + 1] - mny;
    const dz = nrm[b + 2] - mnz;
    c00 += w * dx * dx;
    c01 += w * dx * dy;
    c02 += w * dx * dz;
    c11 += w * dy * dy;
    c12 += w * dy * dz;
    c22 += w * dz * dz;
  }

  let axis = jacobiSmallestEigenVectorSymmetric3(c00, c01, c02, c11, c12, c22);
  let ux = axis[0];
  let uy = axis[1];
  let uz = axis[2];
  if (prevParams && dotXYZ(ux, uy, uz, prevParams.ux, prevParams.uy, prevParams.uz) < 0) {
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }

  let meanDot = 0;
  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    meanDot += w * dotXYZ(nrm[b + 0], nrm[b + 1], nrm[b + 2], ux, uy, uz);
  }
  meanDot /= sumW;

  let sinA = -meanDot;
  if (sinA < 0) {
    sinA = -sinA;
    ux = -ux;
    uy = -uy;
    uz = -uz;
  }
  sinA = clamp(sinA, Math.sin(2 * DEG2RAD), Math.sin(88 * DEG2RAD));
  const angleRad = Math.asin(sinA);
  const cosA = Math.cos(angleRad);
  const tanA = Math.tan(angleRad);

  let a00 = 0;
  let a01 = 0;
  let a02 = 0;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;

  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const idx = t * 3;
    const px = cent[idx + 0];
    const py = cent[idx + 1];
    const pz = cent[idx + 2];
    const nx = nrm[idx + 0];
    const ny = nrm[idx + 1];
    const nz = nrm[idx + 2];

    let erx = nx + (sinA * ux);
    let ery = ny + (sinA * uy);
    let erz = nz + (sinA * uz);
    const er = normalizeXYZ(erx, ery, erz);
    if (!er) continue;
    erx = er[0];
    ery = er[1];
    erz = er[2];

    let dx = -((cosA * ux) + (sinA * erx));
    let dy = -((cosA * uy) + (sinA * ery));
    let dz = -((cosA * uz) + (sinA * erz));
    const dn = normalizeXYZ(dx, dy, dz);
    if (!dn) continue;
    dx = dn[0];
    dy = dn[1];
    dz = dn[2];

    const m00 = 1 - (dx * dx);
    const m01 = -(dx * dy);
    const m02 = -(dx * dz);
    const m11 = 1 - (dy * dy);
    const m12 = -(dy * dz);
    const m22 = 1 - (dz * dz);

    a00 += w * m00;
    a01 += w * m01;
    a02 += w * m02;
    a11 += w * m11;
    a12 += w * m12;
    a22 += w * m22;
    b0 += w * ((m00 * px) + (m01 * py) + (m02 * pz));
    b1 += w * ((m01 * px) + (m11 * py) + (m12 * pz));
    b2 += w * ((m02 * px) + (m12 * py) + (m22 * pz));
  }

  let apex = solveLinear3x3(
    a00, a01, a02,
    a01, a11, a12,
    a02, a12, a22,
    b0, b1, b2
  );

  if (!apex && prevParams) {
    apex = [prevParams.apx, prevParams.apy, prevParams.apz];
  }
  if (!apex) return null;

  return {
    apx: apex[0],
    apy: apex[1],
    apz: apex[2],
    ux,
    uy,
    uz,
    angleRad,
    sinA,
    cosA,
    tanA,
  };
}

function refitRegionPrimitive(typeCode, component, pre, initialParams, distEps) {
  if (typeCode === TYPE_CODE_PLANE) {
    return refitPlaneFromTriangles(component, pre, initialParams);
  }
  if (typeCode === TYPE_CODE_CYLINDER) {
    return refitCylinderFromTriangles(component, pre, initialParams, distEps);
  }
  return refitConeFromTriangles(component, pre, initialParams);
}

function typeCodeToName(typeCode) {
  if (typeCode === TYPE_CODE_PLANE) return TYPE_PLANE;
  if (typeCode === TYPE_CODE_CYLINDER) return TYPE_CYLINDER;
  return TYPE_CONE;
}

function serializePrimitiveParams(type, params) {
  if (!params) return {};
  if (type === TYPE_PLANE) {
    return {
      n: [params.nx, params.ny, params.nz],
      d: params.d,
    };
  }
  if (type === TYPE_CYLINDER) {
    return {
      axisPoint: [params.ax, params.ay, params.az],
      axisDir: [params.ux, params.uy, params.uz],
      radius: params.radius,
    };
  }
  if (type === TYPE_CONE) {
    return {
      apex: [params.apx, params.apy, params.apz],
      axisDir: [params.ux, params.uy, params.uz],
      angleRad: params.angleRad,
    };
  }
  return {};
}

function computeRegionBBox(component, mesh, pre) {
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const vertCount = pre.vertCount;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const b = t * 3;
    const i0 = Number(tv[b + 0]);
    const i1 = Number(tv[b + 1]);
    const i2 = Number(tv[b + 2]);
    const ids = [i0, i1, i2];
    for (let k = 0; k < 3; k += 1) {
      const vi = ids[k];
      if (!(vi >= 0 && vi < vertCount)) continue;
      const vb = vi * 3;
      const x = Number(vp[vb + 0]);
      const y = Number(vp[vb + 1]);
      const z = Number(vp[vb + 2]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!Number.isFinite(minX)) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
    };
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function computeRegionRms(type, params, component, pre) {
  if (!params || !component || component.length === 0) return 0;
  const cent = pre.triCentroids;
  const area = pre.triAreas;
  let sumW = 0;
  let sumSq = 0;
  for (let i = 0; i < component.length; i += 1) {
    const t = component[i];
    const w = Math.max(area[t], 1e-16);
    const b = t * 3;
    const px = cent[b + 0];
    const py = cent[b + 1];
    const pz = cent[b + 2];
    const d = primitiveDistance(type, params, px, py, pz);
    sumSq += w * d * d;
    sumW += w;
  }
  if (!(sumW > 0)) return 0;
  return Math.sqrt(sumSq / sumW);
}

function buildPrimitiveRegions(models, triBestModel, triTypeCode, pre, mesh, opts) {
  const triCount = pre.triCount;
  const triRegionId = new Int32Array(triCount);
  triRegionId.fill(-1);
  const regions = [];

  const queue = new Int32Array(Math.max(1, triCount));
  const processedPrimitive = new Uint8Array(triCount);

  for (let seed = 0; seed < triCount; seed += 1) {
    const typeCode = triTypeCode[seed];
    if (typeCode < 0) continue;
    if (processedPrimitive[seed]) continue;

    const seedModelId = triBestModel[seed];
    const typeName = typeCodeToName(typeCode);
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    processedPrimitive[seed] = 1;
    const component = [];

    while (head < tail) {
      const tri = queue[head++];
      component.push(tri);
      const start = pre.adjacencyOffsets[tri];
      const end = pre.adjacencyOffsets[tri + 1];
      for (let i = start; i < end; i += 1) {
        const nb = pre.adjacency[i];
        if (processedPrimitive[nb]) continue;
        if (triTypeCode[nb] !== typeCode) continue;
        processedPrimitive[nb] = 1;
        queue[tail++] = nb;
      }
    }

    if (component.length < opts.minRegionTriangles) continue;

    const initialParams = (seedModelId >= 0 && models[seedModelId]) ? models[seedModelId].params : null;
    const fitted = refitRegionPrimitive(typeCode, component, pre, initialParams, opts.distEps) || initialParams;
    if (!fitted) continue;

    const regionId = regions.length;
    const triIndices = Uint32Array.from(component);
    for (let i = 0; i < component.length; i += 1) {
      triRegionId[component[i]] = regionId;
    }

    const bbox = computeRegionBBox(component, mesh, pre);
    const rms = computeRegionRms(typeName, fitted, component, pre);
    const region = {
      id: regionId,
      type: typeName,
      triIndices,
      params: serializePrimitiveParams(typeName, fitted),
      rms,
      bbox,
    };
    if (typeName === TYPE_CYLINDER || typeName === TYPE_CONE) {
      region.axis = [fitted.ux, fitted.uy, fitted.uz];
    }
    if (typeName === TYPE_CONE) {
      region.apex = [fitted.apx, fitted.apy, fitted.apz];
    }
    regions.push(region);
  }

  // Remaining triangles become OTHER connected components.
  const processedOther = new Uint8Array(triCount);
  for (let seed = 0; seed < triCount; seed += 1) {
    if (triRegionId[seed] >= 0) continue;
    if (processedOther[seed]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    processedOther[seed] = 1;
    const component = [];

    while (head < tail) {
      const tri = queue[head++];
      if (triRegionId[tri] >= 0) continue;
      component.push(tri);
      const start = pre.adjacencyOffsets[tri];
      const end = pre.adjacencyOffsets[tri + 1];
      for (let i = start; i < end; i += 1) {
        const nb = pre.adjacency[i];
        if (processedOther[nb]) continue;
        if (triRegionId[nb] >= 0) continue;
        processedOther[nb] = 1;
        queue[tail++] = nb;
      }
    }

    if (component.length === 0) continue;
    const regionId = regions.length;
    const triIndices = Uint32Array.from(component);
    for (let i = 0; i < component.length; i += 1) {
      triRegionId[component[i]] = regionId;
    }
    regions.push({
      id: regionId,
      type: TYPE_OTHER,
      triIndices,
      params: {},
      rms: 0,
      bbox: computeRegionBBox(component, mesh, pre),
    });
  }

  return { triRegionId, regions };
}

function detectBoundaryEdges(pre, triRegionId) {
  const boundaryEdges = [];
  const incident = [];

  for (const edge of pre.edgeMap.values()) {
    edgeIncidentTriangles(edge, incident);
    if (incident.length === 1) {
      boundaryEdges.push({
        v0: edge.v0,
        v1: edge.v1,
        regionA: triRegionId[incident[0]],
        regionB: -1,
      });
      continue;
    }

    const regionSet = new Set();
    for (let i = 0; i < incident.length; i += 1) {
      regionSet.add(triRegionId[incident[i]]);
    }
    if (regionSet.size <= 1) continue;

    const regions = Array.from(regionSet).sort((a, b) => a - b);
    if (regions.length === 2) {
      boundaryEdges.push({
        v0: edge.v0,
        v1: edge.v1,
        regionA: regions[0],
        regionB: regions[1],
      });
      continue;
    }

    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        boundaryEdges.push({
          v0: edge.v0,
          v1: edge.v1,
          regionA: regions[i],
          regionB: regions[j],
        });
      }
    }
  }
  return boundaryEdges;
}

function buildFaceIdsFromRegions(triRegionId) {
  const triCount = triRegionId.length;
  const out = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t += 1) {
    const rid = triRegionId[t];
    out[t] = rid >= 0 ? (rid + 1) : 0;
  }
  return out;
}

function resolveOptions(pre, options) {
  const triCount = pre.triCount;
  const fallbackSampleCount = Math.min(200000, triCount * 2);
  const sampleCount = Math.max(
    1,
    Math.floor(Number.isFinite(options?.sampleCount) ? Number(options.sampleCount) : fallbackSampleCount)
  );
  const bboxDiag = pre.bbox.diag;
  const defaultDist = Math.max(1e-8, bboxDiag * 0.002);
  const distEps = Number.isFinite(options?.distEps) ? Math.max(1e-10, Number(options.distEps)) : defaultDist;
  const angleEpsDeg = Number.isFinite(options?.angleEpsDeg) ? Math.max(1, Number(options.angleEpsDeg)) : 15;
  const minInliersDefault = Math.max(500, Math.floor(sampleCount * 0.01));
  const minInliers = Number.isFinite(options?.minInliers)
    ? Math.max(16, Math.floor(Number(options.minInliers)))
    : minInliersDefault;
  const maxModels = Number.isFinite(options?.maxModels) ? Math.max(1, Math.floor(Number(options.maxModels))) : 64;
  const minVotesPerTriangle = Number.isFinite(options?.minVotesPerTriangle)
    ? Math.max(1, Math.floor(Number(options.minVotesPerTriangle)))
    : 3;
  const minRegionTriangles = Number.isFinite(options?.minRegionTriangles)
    ? Math.max(1, Math.floor(Number(options.minRegionTriangles)))
    : 200;
  const randomSeed = Number.isFinite(options?.randomSeed) ? (Number(options.randomSeed) >>> 0) : 1337;
  const maxRefineIters = Number.isFinite(options?.maxRefineIters)
    ? Math.max(0, Math.floor(Number(options.maxRefineIters)))
    : 8;
  const enablePlane = options?.enablePlane !== undefined ? !!options.enablePlane : true;
  const enableCylinder = options?.enableCylinder !== undefined ? !!options.enableCylinder : true;
  let enableCone = options?.enableCone !== undefined ? !!options.enableCone : true;
  if (!enablePlane && !enableCylinder && !enableCone) {
    // Keep segmentation functional even if caller disables all by mistake.
    enableCone = true;
  }

  return {
    sampleCount,
    distEps,
    angleEpsDeg,
    minInliers,
    maxModels,
    minVotesPerTriangle,
    minRegionTriangles,
    randomSeed,
    maxRefineIters,
    enablePlane,
    enableCylinder,
    enableCone,
  };
}

export function segmentMeshPrimitives(mesh, options = {}) {
  const pre = precomputeMeshData(mesh);
  if (pre.triCount <= 0 || pre.vertCount <= 0) {
    return {
      triRegionId: new Int32Array(0),
      regions: [],
      regionFaceID: new Uint32Array(0),
      boundaryEdges: [],
    };
  }

  const opts = resolveOptions(pre, options);
  const rng = createRng(opts.randomSeed);

  const samples = buildAreaWeightedSamples(mesh, pre, opts.sampleCount, rng);
  const models = runPrimitiveRansac(pre, samples, opts, rng);
  const votes = voteTriangles(models, samples.sampleTri, pre, opts);
  const segmented = buildPrimitiveRegions(models, votes.triBestModel, votes.triTypeCode, pre, mesh, opts);
  const boundaryEdges = detectBoundaryEdges(pre, segmented.triRegionId);
  const regionFaceID = buildFaceIdsFromRegions(segmented.triRegionId);

  return {
    triRegionId: segmented.triRegionId,
    regions: segmented.regions,
    regionFaceID,
    boundaryEdges,
  };
}

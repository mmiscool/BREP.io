const DEFAULT_NEUTRAL_FACTOR = 0.5;
const EPS = 1e-9;

function xmlEsc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolveNeutralFactor(opts, solid, metadataManager) {
  const fromOpts = Number(opts?.neutralFactor ?? opts?.sheetMetalNeutralFactor);
  if (Number.isFinite(fromOpts)) return clamp(fromOpts, 0, 1);
  const sm = solid?.userData?.sheetMetal || null;
  const fromSolid = Number(
    sm?.neutralFactor
    ?? sm?.kFactor
    ?? sm?.kFactorValue
    ?? solid?.userData?.sheetMetalNeutralFactor
  );
  if (Number.isFinite(fromSolid)) return clamp(fromSolid, 0, 1);
  const meta = metadataManager && solid?.name && typeof metadataManager.getMetadata === 'function'
    ? metadataManager.getMetadata(solid.name)
    : null;
  const fromMeta = Number(meta?.sheetMetalNeutralFactor ?? meta?.sheetMetalKFactor);
  if (Number.isFinite(fromMeta)) return clamp(fromMeta, 0, 1);
  return DEFAULT_NEUTRAL_FACTOR;
}

function resolveThickness(solid, metadataManager) {
  const sm = solid?.userData?.sheetMetal || null;
  const candidates = [
    sm?.thickness,
    sm?.baseThickness,
    solid?.userData?.sheetThickness,
    solid?.userData?.sheetMetalThickness,
  ];
  const meta = metadataManager && solid?.name && typeof metadataManager.getMetadata === 'function'
    ? metadataManager.getMetadata(solid.name)
    : null;
  if (meta) candidates.push(meta.sheetMetalThickness);
  for (const val of candidates) {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function resolveBendRadius(solid, metadataManager) {
  const sm = solid?.userData?.sheetMetal || null;
  const candidates = [
    sm?.bendRadius,
    sm?.baseBendRadius,
    sm?.defaultBendRadius,
    sm?.extra?.bendRadiusUsed,
    solid?.userData?.sheetBendRadius,
  ];
  const meta = metadataManager && solid?.name && typeof metadataManager.getMetadata === 'function'
    ? metadataManager.getMetadata(solid.name)
    : null;
  if (meta) candidates.push(meta.sheetMetalBendRadius);
  for (const val of candidates) {
    const num = Number(val);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

function resolveFaceType(meta) {
  const t = meta?.sheetMetalFaceType;
  if (t === 'A' || t === 'B') return t;
  return null;
}

function normalizeAxis(axis) {
  if (!Array.isArray(axis) || axis.length < 3) return null;
  let ax = Number(axis[0]);
  let ay = Number(axis[1]);
  let az = Number(axis[2]);
  const len = Math.hypot(ax, ay, az);
  if (!Number.isFinite(len) || len < EPS) return null;
  ax /= len; ay /= len; az /= len;
  if (az < 0 || (az === 0 && ay < 0) || (az === 0 && ay === 0 && ax < 0)) {
    ax = -ax; ay = -ay; az = -az;
  }
  return [ax, ay, az];
}

function lineKey(axis, center) {
  const n = normalizeAxis(axis);
  if (!n || !Array.isArray(center) || center.length < 3) return null;
  const cx = Number(center[0]);
  const cy = Number(center[1]);
  const cz = Number(center[2]);
  if (![cx, cy, cz].every(Number.isFinite)) return null;
  const ax = n[0], ay = n[1], az = n[2];
  const mx = cy * az - cz * ay;
  const my = cz * ax - cx * az;
  const mz = cx * ay - cy * ax;
  const round = (v) => Number(v.toFixed(5));
  return `${round(ax)},${round(ay)},${round(az)}|${round(mx)},${round(my)},${round(mz)}`;
}

function findInsideFaceType(faceMetaByName) {
  const groups = new Map();
  for (const [name, meta] of faceMetaByName.entries()) {
    const faceType = resolveFaceType(meta);
    if (!faceType) continue;
    if (meta?.type !== 'cylindrical') continue;
    const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const key = lineKey(meta?.axis, meta?.center);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { A: [], B: [] };
      groups.set(key, group);
    }
    group[faceType].push(radius);
  }

  let winsA = 0;
  let winsB = 0;
  for (const group of groups.values()) {
    if (!group.A.length || !group.B.length) continue;
    const minA = Math.min(...group.A);
    const minB = Math.min(...group.B);
    if (minA + EPS < minB) winsA += 1;
    else if (minB + EPS < minA) winsB += 1;
  }

  if (winsA > winsB) return 'A';
  if (winsB > winsA) return 'B';
  return null;
}

function buildCylRadiusGroups(faceMetaById) {
  const groups = new Map();
  if (!faceMetaById || typeof faceMetaById.values !== 'function') return groups;
  for (const meta of faceMetaById.values()) {
    if (meta?.type !== 'cylindrical') continue;
    const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const key = lineKey(meta?.axis, meta?.center);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { min: radius, max: radius };
      groups.set(key, group);
    } else {
      if (radius < group.min) group.min = radius;
      if (radius > group.max) group.max = radius;
    }
  }
  return groups;
}

function inferCylFaceIsInside(meta, faceRadius, cylGroups, thickness) {
  if (!Number.isFinite(faceRadius) || !cylGroups) return null;
  const key = lineKey(meta?.axis, meta?.center);
  if (!key) return null;
  const group = cylGroups.get(key);
  if (!group || !Number.isFinite(group.min) || !Number.isFinite(group.max)) return null;
  if (group.max - group.min <= EPS) return null;
  const dMin = Math.abs(faceRadius - group.min);
  const dMax = Math.abs(faceRadius - group.max);
  const tol = Number.isFinite(thickness) && thickness > 0
    ? Math.max(1e-4, thickness * 0.1)
    : 0;
  if (tol > 0) {
    if (dMin <= tol && dMin <= dMax) return true;
    if (dMax <= tol && dMax < dMin) return false;
  }
  return dMin <= dMax;
}

function getVertex3(vertProps, idx) {
  const base = idx * 3;
  return [vertProps[base + 0], vertProps[base + 1], vertProps[base + 2]];
}

function computeTriangleNormal(a, b, c) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ];
}

function normalizeVec3(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < EPS) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function buildFaceAdjacencyFromMesh(triVerts, faceIDs, vertProps, opts = {}) {
  if (!triVerts || !faceIDs) return new Map();
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount || faceIDs.length !== triCount) return new Map();
  const edgeFaces = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let vertexKey = null;
  if (vertProps && vertProps.length) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < vertProps.length; i += 3) {
      const x = vertProps[i + 0];
      const y = vertProps[i + 1];
      const z = vertProps[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const baseTol = Number.isFinite(opts?.tolerance) ? opts.tolerance : 0;
    const tol = Math.max(1e-5, diag * 1e-8, baseTol || 0);
    const quant = (v) => Math.round(v / tol);
    vertexKey = (idx) => {
      const base = idx * 3;
      const x = vertProps[base + 0];
      const y = vertProps[base + 1];
      const z = vertProps[base + 2];
      return `${quant(x)},${quant(y)},${quant(z)}`;
    };
  }
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const keyA = vertexKey ? vertexKey(u) : u;
      const keyB = vertexKey ? vertexKey(v) : v;
      const key = edgeKey(keyA, keyB);
      let set = edgeFaces.get(key);
      if (!set) { set = new Set(); edgeFaces.set(key, set); }
      set.add(faceId);
    }
  }

  const neighbors = new Map();
  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };
  for (const faces of edgeFaces.values()) {
    if (faces.size < 2) continue;
    const ids = Array.from(faces);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (a === b) continue;
        addNeighbor(a, b);
        addNeighbor(b, a);
      }
    }
  }
  return neighbors;
}

function selectSheetMetalFaces(mesh, solid, opts = {}) {
  const idToName = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
  if (!idToName) return null;
  const faceMetaById = new Map();
  const faceTypeById = new Map();
  const faceMetaByName = new Map();
  const cylFaces = [];
  let hasA = false;
  let hasB = false;
  for (const [id, name] of idToName.entries()) {
    let meta = {};
    if (solid && typeof solid.getFaceMetadata === 'function') {
      try { meta = solid.getFaceMetadata(name) || {}; } catch { meta = {}; }
    }
    faceMetaById.set(id, meta || {});
    faceMetaByName.set(name, meta || {});
    const ft = resolveFaceType(meta);
    if (ft === 'A') hasA = true;
    if (ft === 'B') hasB = true;
    faceTypeById.set(id, ft);
    if (meta?.type === 'cylindrical') {
      const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
      if (Number.isFinite(radius) && radius > 0) {
        cylFaces.push({ id, radius, meta });
      }
    }
  }
  if (!hasA) return null;

  const insideType = findInsideFaceType(faceMetaByName) || (hasA ? 'A' : 'B');
  const surfaceType = hasA ? 'A' : 'B';
  const strictSurfaceType = opts?.strictSurfaceType !== false;

  const thickness = resolveThickness(solid, opts?.metadataManager);
  if (!Number.isFinite(thickness) || thickness <= 0) return null;
  const tolFromOpts = Number.isFinite(opts?.edgeTolerance) ? opts.edgeTolerance
    : Number.isFinite(opts?.mergeTolerance) ? opts.mergeTolerance
      : null;
  const adjacencyTol = Number.isFinite(tolFromOpts)
    ? tolFromOpts
    : Math.max(0, thickness * 1e-2);
  const bendRadius = resolveBendRadius(solid, opts?.metadataManager);
  const minCylRadius = cylFaces.length ? Math.min(...cylFaces.map((c) => c.radius)) : null;
  const insideRadius = Number.isFinite(bendRadius) && bendRadius >= 0 ? bendRadius : minCylRadius;
  const outsideRadius = Number.isFinite(insideRadius) ? insideRadius + thickness : null;
  const radiusTol = Math.max(
    1e-4,
    thickness * 0.1,
    Number.isFinite(insideRadius) ? insideRadius * 0.05 : 0,
  );
  const neutralFactor = resolveNeutralFactor(opts, solid, opts?.metadataManager);
  const surfaceIsInside = insideType ? (surfaceType === insideType) : true;
  const targetRadius = surfaceIsInside ? insideRadius : outsideRadius;

  const includeSet = new Set();
  for (const [id] of faceMetaById.entries()) {
    const faceType = faceTypeById.get(id) || null;
    if (faceType === surfaceType) includeSet.add(id);
  }

  if (!strictSurfaceType) {
    const adjacency = buildFaceAdjacencyFromMesh(
      mesh?.triVerts,
      mesh?.faceID,
      mesh?.vertProperties,
      { tolerance: adjacencyTol },
    );
    let includedCyl = 0;
    for (const [id] of faceMetaById.entries()) {
      const meta = faceMetaById.get(id);
      if (!meta || meta.type !== 'cylindrical') continue;
      const nbrs = adjacency.get(id);
      if (nbrs && Array.from(nbrs).some((nb) => includeSet.has(nb))) {
        includeSet.add(id);
        includedCyl += 1;
      }
    }

    if (!includedCyl) {
      for (const [id] of faceMetaById.entries()) {
        if (includeSet.has(id)) continue;
        const meta = faceMetaById.get(id);
        if (!meta || meta.type !== 'cylindrical') continue;
        const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
        if (!Number.isFinite(radius)) continue;
        if (Number.isFinite(targetRadius)) {
          if (Math.abs(radius - targetRadius) <= radiusTol) includeSet.add(id);
        } else {
          includeSet.add(id);
        }
      }
    }
  }

  return {
    includeSet,
    faceMetaById,
    faceTypeById,
    thickness,
    neutralFactor,
    insideRadius,
    insideType,
    surfaceType,
    surfaceIsInside,
    targetRadius,
  };
}

function buildSharedVerticesMap(triVerts, faceIDs, includeSet) {
  const triCount = (triVerts.length / 3) | 0;
  const edgeFaces = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    if (!includeSet.has(faceId)) continue;
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const key = edgeKey(u, v);
      let set = edgeFaces.get(key);
      if (!set) { set = new Set(); edgeFaces.set(key, set); }
      set.add(faceId);
    }
  }

  const sharedVertsByPair = new Map();
  const neighbors = new Map();
  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };

  for (const [key, faces] of edgeFaces.entries()) {
    const ids = Array.from(faces);
    if (ids.length < 2) continue;
    const [va, vb] = key.split('|').map((n) => Number(n));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const fa = ids[i];
        const fb = ids[j];
        const pairKey = fa < fb ? `${fa}|${fb}` : `${fb}|${fa}`;
        let set = sharedVertsByPair.get(pairKey);
        if (!set) { set = new Set(); sharedVertsByPair.set(pairKey, set); }
        set.add(va);
        set.add(vb);
        addNeighbor(fa, fb);
        addNeighbor(fb, fa);
      }
    }
  }

  return { sharedVertsByPair, neighbors };
}

function collectFaceTriangles(triVerts, faceIDs, includeSet, vertProps = null) {
  const triCount = (triVerts.length / 3) | 0;
  const map = new Map();
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    if (!includeSet.has(faceId)) continue;
    let entry = map.get(faceId);
    if (!entry) {
      entry = { triangles: [], vertices: new Set(), area: 0 };
      map.set(faceId, entry);
    }
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    entry.triangles.push([a, b, c]);
    entry.vertices.add(a);
    entry.vertices.add(b);
    entry.vertices.add(c);
    if (vertProps) {
      const ax = vertProps[a * 3 + 0];
      const ay = vertProps[a * 3 + 1];
      const az = vertProps[a * 3 + 2];
      const bx = vertProps[b * 3 + 0];
      const by = vertProps[b * 3 + 1];
      const bz = vertProps[b * 3 + 2];
      const cx = vertProps[c * 3 + 0];
      const cy = vertProps[c * 3 + 1];
      const cz = vertProps[c * 3 + 2];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      entry.area += 0.5 * Math.hypot(nx, ny, nz);
    }
  }
  return map;
}

function buildPlanarFaceCoords(face, vertProps) {
  const triangles = face.triangles;
  if (!triangles.length) return null;
  let normal = [0, 0, 0];
  let origin = null;
  for (const tri of triangles) {
    const a = getVertex3(vertProps, tri[0]);
    const b = getVertex3(vertProps, tri[1]);
    const c = getVertex3(vertProps, tri[2]);
    const n = computeTriangleNormal(a, b, c);
    normal = add3(normal, n);
    if (!origin) origin = a;
  }
  normal = normalizeVec3(normal);
  if (!origin) origin = getVertex3(vertProps, triangles[0][0]);

  const verts = Array.from(face.vertices);
  let v0 = getVertex3(vertProps, verts[0]);
  let v1 = v0;
  let maxDist = 0;
  for (const idx of verts) {
    const p = getVertex3(vertProps, idx);
    const d = Math.hypot(p[0] - v0[0], p[1] - v0[1], p[2] - v0[2]);
    if (d > maxDist) { maxDist = d; v1 = p; }
  }
  let uAxis = normalizeVec3(sub3(v1, v0));
  if (Math.abs(dot3(uAxis, normal)) > 0.99) {
    uAxis = normalizeVec3(cross3(normal, [1, 0, 0]));
    if (Math.hypot(uAxis[0], uAxis[1], uAxis[2]) < EPS) {
      uAxis = normalizeVec3(cross3(normal, [0, 1, 0]));
    }
  }
  const vAxis = normalizeVec3(cross3(normal, uAxis));

  const coords = new Map();
  for (const idx of verts) {
    const p = getVertex3(vertProps, idx);
    const rel = sub3(p, origin);
    coords.set(idx, { x: dot3(rel, uAxis), y: dot3(rel, vAxis) });
  }
  return { coords, origin, uAxis, vAxis, normal };
}

function buildCylFaceCoords(face, vertProps, meta, neutralRadius, sharedVerts) {
  const axisDir = normalizeAxis(meta?.axis);
  if (!axisDir) return null;
  const axisOrigin = Array.isArray(meta?.center) && meta.center.length >= 3
    ? [Number(meta.center[0]), Number(meta.center[1]), Number(meta.center[2])]
    : getVertex3(vertProps, Array.from(face.vertices)[0]);
  const axis = axisDir;

  let ref = null;
  if (sharedVerts && sharedVerts.size) {
    for (const idx of sharedVerts) {
      const p = getVertex3(vertProps, idx);
      const toP = sub3(p, axisOrigin);
      const t = dot3(toP, axis);
      const proj = add3(axisOrigin, scale3(axis, t));
      const radial = sub3(p, proj);
      const rLen = Math.hypot(radial[0], radial[1], radial[2]);
      if (rLen > EPS) { ref = scale3(radial, 1 / rLen); break; }
    }
  }
  if (!ref) {
    const idx = Array.from(face.vertices)[0];
    const p = getVertex3(vertProps, idx);
    const toP = sub3(p, axisOrigin);
    const t = dot3(toP, axis);
    const proj = add3(axisOrigin, scale3(axis, t));
    const radial = sub3(p, proj);
    const rLen = Math.hypot(radial[0], radial[1], radial[2]);
    ref = rLen > EPS ? scale3(radial, 1 / rLen) : [1, 0, 0];
  }

  const uAxis = normalizeVec3(ref);
  const vAxis = normalizeVec3(cross3(axis, uAxis));
  const rawAngles = new Map();
  const axial = new Map();
  for (const idx of face.vertices) {
    const p = getVertex3(vertProps, idx);
    const toP = sub3(p, axisOrigin);
    const t = dot3(toP, axis);
    const proj = add3(axisOrigin, scale3(axis, t));
    const radial = sub3(p, proj);
    const rLen = Math.hypot(radial[0], radial[1], radial[2]);
    const angle = rLen > EPS ? Math.atan2(dot3(radial, vAxis), dot3(radial, uAxis)) : 0;
    rawAngles.set(idx, angle);
    axial.set(idx, t);
  }

  const neighbors = new Map();
  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };
  for (const tri of face.triangles) {
    addNeighbor(tri[0], tri[1]);
    addNeighbor(tri[1], tri[0]);
    addNeighbor(tri[1], tri[2]);
    addNeighbor(tri[2], tri[1]);
    addNeighbor(tri[2], tri[0]);
    addNeighbor(tri[0], tri[2]);
  }

  const unwrapped = new Map();
  const twoPi = Math.PI * 2;
  const seedQueue = [];
  if (sharedVerts && sharedVerts.size) {
    for (const idx of sharedVerts) {
      if (rawAngles.has(idx)) seedQueue.push(idx);
    }
  }
  if (!seedQueue.length && rawAngles.size) {
    seedQueue.push(rawAngles.keys().next().value);
  }
  const visitFrom = (seed) => {
    if (seed == null || unwrapped.has(seed) || !rawAngles.has(seed)) return;
    unwrapped.set(seed, rawAngles.get(seed));
    const queue = [seed];
    while (queue.length) {
      const v = queue.shift();
      const av = unwrapped.get(v);
      const nbrs = neighbors.get(v);
      if (!nbrs) continue;
      for (const nb of nbrs) {
        if (unwrapped.has(nb) || !rawAngles.has(nb)) continue;
        const base = rawAngles.get(nb);
        const k = Math.round((av - base) / twoPi);
        unwrapped.set(nb, base + k * twoPi);
        queue.push(nb);
      }
    }
  };
  for (const seed of seedQueue) visitFrom(seed);
  for (const idx of rawAngles.keys()) visitFrom(idx);

  const coords = new Map();
  for (const idx of rawAngles.keys()) {
    const angle = unwrapped.get(idx) ?? rawAngles.get(idx);
    const x = axial.get(idx);
    const y = angle * neutralRadius;
    coords.set(idx, { x, y });
  }
  return { coords };
}

function pickSharedEndpoints(sharedVerts, coords) {
  const verts = Array.from(sharedVerts || []);
  if (verts.length < 2) return null;
  let best = null;
  let maxDist = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const pa = coords.get(a);
    if (!pa) continue;
    for (let j = i + 1; j < verts.length; j++) {
      const b = verts[j];
      const pb = coords.get(b);
      if (!pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = dx * dx + dy * dy;
      if (d > maxDist) {
        maxDist = d;
        best = [a, b];
      }
    }
  }
  return best;
}

function makeTransform(angle, tx, ty) {
  return { cos: Math.cos(angle), sin: Math.sin(angle), tx, ty };
}

function applyTransform2(pt, tr) {
  let x = pt.x;
  let y = pt.y;
  const reflect = tr && tr.reflect;
  if (reflect && reflect.origin && reflect.dir) {
    const ox = reflect.origin.x;
    const oy = reflect.origin.y;
    const dx = reflect.dir.x;
    const dy = reflect.dir.y;
    const px = x - ox;
    const py = y - oy;
    const dot = px * dx + py * dy;
    const projx = ox + dx * dot;
    const projy = oy + dy * dot;
    x = projx * 2 - x;
    y = projy * 2 - y;
  }
  return {
    x: tr.cos * x - tr.sin * y + tr.tx,
    y: tr.sin * x + tr.cos * y + tr.ty,
  };
}

function computeFaceSideSign(face, idx0, idx1, transform = null) {
  if (!face || !face.coords || !face.vertices) return 0;
  const raw0 = face.coords.get(idx0);
  const raw1 = face.coords.get(idx1);
  if (!raw0 || !raw1) return 0;
  const p0 = transform ? applyTransform2(raw0, transform) : raw0;
  const p1 = transform ? applyTransform2(raw1, transform) : raw1;
  const ex = p1.x - p0.x;
  const ey = p1.y - p0.y;
  const len = Math.hypot(ex, ey);
  if (len < EPS) return 0;
  let best = 0;
  let bestAbs = 0;
  for (const idx of face.vertices) {
    if (idx === idx0 || idx === idx1) continue;
    const raw = face.coords.get(idx);
    if (!raw) continue;
    const p = transform ? applyTransform2(raw, transform) : raw;
    const cross = ex * (p.y - p0.y) - ey * (p.x - p0.x);
    const abs = Math.abs(cross);
    if (abs > bestAbs) {
      bestAbs = abs;
      best = cross;
    }
  }
  const tol = Math.max(EPS, len * 1e-9);
  if (bestAbs <= tol) return 0;
  return best > 0 ? 1 : -1;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildBoundaryEdgesFromTriangles(triangles) {
  const edgeCounts = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let entry = edgeCounts.get(key);
    if (entry) entry.count += 1;
    else edgeCounts.set(key, { a, b, count: 1 });
  };
  for (const tri of triangles) {
    addEdge(tri[0], tri[1]);
    addEdge(tri[1], tri[2]);
    addEdge(tri[2], tri[0]);
  }
  const edges = [];
  for (const entry of edgeCounts.values()) {
    if (entry.count === 1) edges.push([entry.a, entry.b]);
  }
  return edges;
}

function buildEdgeChainsFromEdges(edges) {
  if (!edges || !edges.length) return [];
  const adjacency = new Map();
  const addAdj = (a, b) => {
    let list = adjacency.get(a);
    if (!list) { list = []; adjacency.set(a, list); }
    list.push(b);
  };
  for (const [a, b] of edges) {
    addAdj(a, b);
    addAdj(b, a);
  }

  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const isUsed = (a, b) => used.has(edgeKey(a, b));
  const markUsed = (a, b) => used.add(edgeKey(a, b));

  const walkChain = (start) => {
    const chain = [start];
    let prev = null;
    let curr = start;
    let guard = 0;
    while (guard++ < edges.length * 2) {
      const neighbors = adjacency.get(curr) || [];
      let next = null;
      for (const n of neighbors) {
        if (n === prev) continue;
        if (isUsed(curr, n)) continue;
        next = n;
        break;
      }
      if (next == null) break;
      markUsed(curr, next);
      prev = curr;
      curr = next;
      chain.push(curr);
      if (curr === start) break;
    }
    return chain;
  };

  const chains = [];
  for (const [v, neighbors] of adjacency.entries()) {
    if (!neighbors || neighbors.length !== 1) continue;
    const hasUnused = neighbors.some((n) => !isUsed(v, n));
    if (!hasUnused) continue;
    const chain = walkChain(v);
    if (chain.length > 1) chains.push(chain);
  }

  for (const [a, b] of edges) {
    if (isUsed(a, b)) continue;
    const chain = walkChain(a);
    if (chain.length > 1) chains.push(chain);
  }

  return chains.map((verts) => {
    let closed = false;
    if (verts.length > 2 && verts[0] === verts[verts.length - 1]) {
      closed = true;
      verts = verts.slice(0, -1);
    }
    return { verts, closed };
  });
}

function buildFaceEdgeChainsFromMeshIndexed(triVerts, faceIDs, idToName, includeSet) {
  const triCount = (triVerts.length / 3) | 0;
  const edgeMap = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const key = edgeKey(u, v);
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = { a: u, b: v, faces: new Set() };
        edgeMap.set(key, entry);
      }
      entry.faces.add(faceId);
    }
  }

  const pairEdges = new Map();
  for (const entry of edgeMap.values()) {
    if (entry.faces.size !== 2) continue;
    const faces = Array.from(entry.faces);
    const f0 = faces[0];
    const f1 = faces[1];
    if (f0 === f1) continue;
    if (includeSet && !includeSet.has(f0) && !includeSet.has(f1)) continue;
    const key = f0 < f1 ? `${f0}|${f1}` : `${f1}|${f0}`;
    let list = pairEdges.get(key);
    if (!list) { list = []; pairEdges.set(key, list); }
    list.push([entry.a, entry.b]);
  }

  const byFace = new Map();
  const byPair = new Map();
  const neighbors = new Map();
  const sharedVertsByFace = new Map();
  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };
  const addSharedVert = (faceId, idx) => {
    let set = sharedVertsByFace.get(faceId);
    if (!set) { set = new Set(); sharedVertsByFace.set(faceId, set); }
    set.add(idx);
  };

  for (const [pairKey, edges] of pairEdges.entries()) {
    const parts = pairKey.split('|').map((n) => Number(n));
    const faceA = parts[0];
    const faceB = parts[1];
    const nameA = (idToName && typeof idToName.get === 'function' && idToName.get(faceA)) || `FACE_${faceA}`;
    const nameB = (idToName && typeof idToName.get === 'function' && idToName.get(faceB)) || `FACE_${faceB}`;
    const chains = buildEdgeChainsFromEdges(edges);
    const isShared = !includeSet || (includeSet.has(faceA) && includeSet.has(faceB));
    const pairEntry = { faceA, faceB, chains: [] };
    byPair.set(pairKey, pairEntry);
    if (isShared) {
      addNeighbor(faceA, faceB);
      addNeighbor(faceB, faceA);
    }
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      const edgeLabel = `${safeEdgeName(nameA)}|${safeEdgeName(nameB)}[${i}]`;
      pairEntry.chains.push({
        verts: chain.verts,
        closed: chain.closed,
        edgeLabel,
        shared: isShared,
        faceA,
        faceB,
      });
      if (!includeSet || includeSet.has(faceA)) {
        let list = byFace.get(faceA);
        if (!list) { list = []; byFace.set(faceA, list); }
        list.push({
          verts: chain.verts,
          closed: chain.closed,
          edgeLabel,
          shared: isShared,
          faceA,
          faceB,
          otherFaceId: faceB,
        });
      }
      if (!includeSet || includeSet.has(faceB)) {
        let list = byFace.get(faceB);
        if (!list) { list = []; byFace.set(faceB, list); }
        list.push({
          verts: chain.verts,
          closed: chain.closed,
          edgeLabel,
          shared: isShared,
          faceA,
          faceB,
          otherFaceId: faceA,
        });
      }
      for (const idx of chain.verts) {
        addSharedVert(faceA, idx);
        addSharedVert(faceB, idx);
      }
    }
  }

  return { byFace, byPair, neighbors, sharedVertsByFace };
}

function buildFaceEdgeChainsFromMeshQuantized(triVerts, faceIDs, idToName, includeSet, vertProps, opts = {}) {
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount || !vertProps || !vertProps.length) {
    return buildFaceEdgeChainsFromMeshIndexed(triVerts, faceIDs, idToName, includeSet);
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertProps.length; i += 3) {
    const x = vertProps[i + 0];
    const y = vertProps[i + 1];
    const z = vertProps[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const baseTol = Number.isFinite(opts?.tolerance) ? opts.tolerance : 0;
  const tol = Math.max(1e-5, diag * 1e-8, baseTol || 0);
  const quant = (v) => Math.round(v / tol);
  const vertexKey = (idx) => {
    const base = idx * 3;
    const x = vertProps[base + 0];
    const y = vertProps[base + 1];
    const z = vertProps[base + 2];
    return `${quant(x)},${quant(y)},${quant(z)}`;
  };

  const edgeCountsByFace = new Map();
  const faceKeyToIndex = new Map();
  const addFaceKey = (faceId, idx, key) => {
    let map = faceKeyToIndex.get(faceId);
    if (!map) { map = new Map(); faceKeyToIndex.set(faceId, map); }
    if (!map.has(key)) map.set(key, idx);
  };

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    const ka = vertexKey(a);
    const kb = vertexKey(b);
    const kc = vertexKey(c);
    addFaceKey(faceId, a, ka);
    addFaceKey(faceId, b, kb);
    addFaceKey(faceId, c, kc);
    const edges = [
      { v0: a, v1: b, k0: ka, k1: kb },
      { v0: b, v1: c, k0: kb, k1: kc },
      { v0: c, v1: a, k0: kc, k1: ka },
    ];
    let edgeCounts = edgeCountsByFace.get(faceId);
    if (!edgeCounts) { edgeCounts = new Map(); edgeCountsByFace.set(faceId, edgeCounts); }
    for (const edge of edges) {
      const key = edgeKey(edge.k0, edge.k1);
      let entry = edgeCounts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        edgeCounts.set(key, { ...edge, count: 1 });
      }
    }
  }

  const boundaryEdgesByFace = new Map();
  const edgeOccurrencesByKey = new Map();
  for (const [faceId, edgeCounts] of edgeCountsByFace.entries()) {
    for (const [key, entry] of edgeCounts.entries()) {
      if (entry.count !== 1) continue;
      let list = boundaryEdgesByFace.get(faceId);
      if (!list) { list = []; boundaryEdgesByFace.set(faceId, list); }
      const edge = { faceId, v0: entry.v0, v1: entry.v1, k0: entry.k0, k1: entry.k1, key };
      list.push(edge);
      let occ = edgeOccurrencesByKey.get(key);
      if (!occ) { occ = []; edgeOccurrencesByKey.set(key, occ); }
      occ.push(edge);
    }
  }

  const pairEdges = new Map();
  for (const [key, occurrences] of edgeOccurrencesByKey.entries()) {
    if (occurrences.length < 2) continue;
    for (let i = 0; i < occurrences.length; i++) {
      for (let j = i + 1; j < occurrences.length; j++) {
        const fa = occurrences[i].faceId;
        const fb = occurrences[j].faceId;
        if (fa === fb) continue;
        if (includeSet && !includeSet.has(fa) && !includeSet.has(fb)) continue;
        const faceA = fa < fb ? fa : fb;
        const faceB = fa < fb ? fb : fa;
        const pair = `${faceA}|${faceB}`;
        let entry = pairEdges.get(pair);
        if (!entry) {
          entry = { faceA, faceB, edges: [], edgeKeys: new Set() };
          pairEdges.set(pair, entry);
        }
        if (entry.edgeKeys.has(key)) continue;
        entry.edgeKeys.add(key);
        entry.edges.push([occurrences[i].k0, occurrences[i].k1]);
      }
    }
  }

  const byFace = new Map();
  const byPair = new Map();
  const neighbors = new Map();
  const sharedVertsByFace = new Map();
  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };
  const addSharedVert = (faceId, idx) => {
    let set = sharedVertsByFace.get(faceId);
    if (!set) { set = new Set(); sharedVertsByFace.set(faceId, set); }
    set.add(idx);
  };

  for (const [pairKey, entry] of pairEdges.entries()) {
    const faceA = entry.faceA;
    const faceB = entry.faceB;
    const nameA = (idToName && typeof idToName.get === 'function' && idToName.get(faceA)) || `FACE_${faceA}`;
    const nameB = (idToName && typeof idToName.get === 'function' && idToName.get(faceB)) || `FACE_${faceB}`;
    const chains = buildEdgeChainsFromEdges(entry.edges);
    const isShared = !includeSet || (includeSet.has(faceA) && includeSet.has(faceB));
    const pairEntry = { faceA, faceB, chains: [] };
    byPair.set(pairKey, pairEntry);
    if (isShared) {
      addNeighbor(faceA, faceB);
      addNeighbor(faceB, faceA);
    }
    const keyMapA = faceKeyToIndex.get(faceA);
    const keyMapB = faceKeyToIndex.get(faceB);
    if (!keyMapA || !keyMapB) continue;
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      const keys = chain.verts;
      const vertsA = [];
      const vertsB = [];
      let missing = false;
      for (const key of keys) {
        const idxA = keyMapA.get(key);
        const idxB = keyMapB.get(key);
        if (idxA == null || idxB == null) { missing = true; break; }
        vertsA.push(idxA);
        vertsB.push(idxB);
      }
      if (missing || vertsA.length < 2 || vertsB.length < 2) continue;
      const edgeLabel = `${safeEdgeName(nameA)}|${safeEdgeName(nameB)}[${i}]`;
      pairEntry.chains.push({
        keys,
        closed: chain.closed,
        edgeLabel,
        shared: isShared,
        vertsA,
        vertsB,
        faceA,
        faceB,
      });
      if (!includeSet || includeSet.has(faceA)) {
        let list = byFace.get(faceA);
        if (!list) { list = []; byFace.set(faceA, list); }
        list.push({
          verts: vertsA,
          closed: chain.closed,
          edgeLabel,
          shared: isShared,
          faceA,
          faceB,
          otherFaceId: faceB,
        });
      }
      if (!includeSet || includeSet.has(faceB)) {
        let list = byFace.get(faceB);
        if (!list) { list = []; byFace.set(faceB, list); }
        list.push({
          verts: vertsB,
          closed: chain.closed,
          edgeLabel,
          shared: isShared,
          faceA,
          faceB,
          otherFaceId: faceA,
        });
      }
      for (const idx of vertsA) addSharedVert(faceA, idx);
      for (const idx of vertsB) addSharedVert(faceB, idx);
    }
  }

  for (const [faceId, edges] of boundaryEdgesByFace.entries()) {
    if (includeSet && !includeSet.has(faceId)) continue;
    const outer = [];
    for (const edge of edges) {
      const occ = edgeOccurrencesByKey.get(edge.key);
      if (occ && occ.length > 1) continue;
      outer.push([edge.k0, edge.k1]);
    }
    if (!outer.length) continue;
    const keyMap = faceKeyToIndex.get(faceId);
    if (!keyMap) continue;
    const chains = buildEdgeChainsFromEdges(outer);
    const name = (idToName && typeof idToName.get === 'function' && idToName.get(faceId)) || `FACE_${faceId}`;
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i];
      const verts = [];
      let missing = false;
      for (const key of chain.verts) {
        const idx = keyMap.get(key);
        if (idx == null) { missing = true; break; }
        verts.push(idx);
      }
      if (missing || verts.length < 2) continue;
      const edgeLabel = `${safeEdgeName(name)}|OUTER[${i}]`;
      let list = byFace.get(faceId);
      if (!list) { list = []; byFace.set(faceId, list); }
      list.push({ verts, closed: chain.closed, edgeLabel, shared: false, otherFaceId: null });
    }
  }

  return { byFace, byPair, neighbors, sharedVertsByFace };
}

function buildFaceEdgeChainsFromMesh(triVerts, faceIDs, idToName, includeSet, vertProps, opts = {}) {
  if (vertProps && vertProps.length) {
    return buildFaceEdgeChainsFromMeshQuantized(triVerts, faceIDs, idToName, includeSet, vertProps, opts);
  }
  return buildFaceEdgeChainsFromMeshIndexed(triVerts, faceIDs, idToName, includeSet);
}

function safeEdgeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function edgeColor(key) {
  const h = hashString(String(key)) % 360;
  return `hsl(${h},70%,45%)`;
}

function buildRgbPalette(vals = [0, 128, 255]) {
  const colors = [];
  for (const r of vals) {
    for (const g of vals) {
      for (const b of vals) {
        colors.push(`rgb(${r},${g},${b})`);
      }
    }
  }
  return colors;
}

function assignDebugPathColors(debugSteps) {
  if (!Array.isArray(debugSteps) || !debugSteps.length) return;
  const edgeInfo = new Map();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const step of debugSteps) {
    if (!step || !Array.isArray(step.paths)) continue;
    for (const path of step.paths) {
      if (!path) continue;
      const pts = path.points || [];
      for (const pt of pts) {
        if (!pt) continue;
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  const tol = Math.max(1e-5, diag * 1e-6);
  const pointKey = (pt) => `${Math.round(pt.x / tol)},${Math.round(pt.y / tol)}`;

  for (const step of debugSteps) {
    if (!step || !Array.isArray(step.paths)) continue;
    for (const path of step.paths) {
      if (!path) continue;
      const label = path.edgeLabel || path.name || 'edge';
      path.edgeLabel = label;
      let info = edgeInfo.get(label);
      if (!info) {
        info = { keys: new Set(), shared: false };
        edgeInfo.set(label, info);
      }
      if (Array.isArray(path.points)) {
        for (const pt of path.points) {
          if (!pt) continue;
          info.keys.add(pointKey(pt));
        }
      } else if (Array.isArray(path.indices)) {
        for (const idx of path.indices) info.keys.add(`i:${idx}`);
      }
      if (path.shared) info.shared = true;
    }
  }

  const adjacency = new Map();
  for (const label of edgeInfo.keys()) adjacency.set(label, new Set());
  const vertexToEdges = new Map();
  for (const [label, info] of edgeInfo.entries()) {
    for (const key of info.keys) {
      let set = vertexToEdges.get(key);
      if (!set) { set = new Set(); vertexToEdges.set(key, set); }
      set.add(label);
    }
  }
  for (const edgeLabels of vertexToEdges.values()) {
    const labels = Array.from(edgeLabels);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        adjacency.get(labels[i]).add(labels[j]);
        adjacency.get(labels[j]).add(labels[i]);
      }
    }
  }

  const palette = buildRgbPalette();
  const extraPalette = buildRgbPalette([0, 100, 200, 255]);
  const parseRgb = (color) => {
    const match = /^rgb\\((\\d+),(\\d+),(\\d+)\\)$/.exec(color);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const minDiff = 100;
  const isDistinct = (color, neighborColors) => {
    const c = parseRgb(color);
    if (!c) return true;
    for (const nb of neighborColors) {
      const n = parseRgb(nb);
      if (!n) continue;
      const dr = Math.abs(c[0] - n[0]);
      const dg = Math.abs(c[1] - n[1]);
      const db = Math.abs(c[2] - n[2]);
      if (dr < minDiff && dg < minDiff && db < minDiff) return false;
    }
    return true;
  };
  const labels = Array.from(edgeInfo.keys()).sort((a, b) => {
    const da = adjacency.get(a)?.size || 0;
    const db = adjacency.get(b)?.size || 0;
    if (da !== db) return db - da;
    return a.localeCompare(b);
  });
  const colorMap = new Map();
  for (const label of labels) {
    const used = new Set();
    const nbrs = adjacency.get(label);
    if (nbrs) {
      for (const nb of nbrs) {
        const c = colorMap.get(nb);
        if (c) used.add(c);
      }
    }
    let chosen = null;
    for (const color of palette) {
      if (used.has(color)) continue;
      if (isDistinct(color, used)) { chosen = color; break; }
    }
    if (!chosen) {
      for (const color of extraPalette) {
        if (used.has(color)) continue;
        if (isDistinct(color, used)) { chosen = color; break; }
      }
    }
    if (!chosen) {
      const idx = Math.abs(hashString(label)) % palette.length;
      const fallback = palette[idx];
      if (isDistinct(fallback, used)) chosen = fallback;
    }
    if (!chosen) {
      const fallbacks = [
        'rgb(0,0,0)',
        'rgb(255,255,255)',
        'rgb(0,255,255)',
        'rgb(255,0,255)',
        'rgb(255,255,0)',
      ];
      for (const color of fallbacks) {
        if (isDistinct(color, used)) { chosen = color; break; }
      }
    }
    if (!chosen) chosen = 'rgb(0,0,0)';
    colorMap.set(label, chosen);
  }

  const baseWidth = 0.2;
  const sharedWidth = baseWidth * 2;
  for (const step of debugSteps) {
    if (!step || !Array.isArray(step.paths)) continue;
    for (const path of step.paths) {
      if (!path) continue;
      const label = path.edgeLabel || path.name || 'edge';
      const info = edgeInfo.get(label);
      path.color = colorMap.get(label) || 'rgb(0,0,0)';
      path.strokeWidth = info && info.shared ? sharedWidth : baseWidth;
    }
  }
}

function collectPathsForFaces(faceIds, faceData, transforms, faceNameById, opts = {}) {
  const paths = [];
  const identity = opts.identity || { cos: 1, sin: 0, tx: 0, ty: 0 };
  const seen = opts.dedupe ? new Set() : null;
  const skipSharedEdge = typeof opts.skipSharedEdge === 'function' ? opts.skipSharedEdge : null;
  for (const faceId of faceIds) {
    const face = faceData.get(faceId);
    if (!face) continue;
    if (opts.requireTransform && (!transforms || !transforms.has(faceId))) continue;
    const tr = (transforms && transforms.get(faceId)) || identity;
    if (!face.boundaryChains || !face.boundaryChains.length) continue;
    const faceName = (faceNameById && typeof faceNameById.get === 'function' && faceNameById.get(faceId))
      || `face_${faceId}`;
    const faceLabel = safeEdgeName(faceName);
    let chainIndex = 0;
    for (const chain of face.boundaryChains) {
      if (chain?.shared && skipSharedEdge) {
        const otherFaceId = Number.isFinite(chain.otherFaceId) ? chain.otherFaceId : null;
        if (skipSharedEdge(faceId, otherFaceId, chain)) {
          chainIndex += 1;
          continue;
        }
      }
      const pts = [];
      for (const idx of chain.verts) {
        const local = face.coords.get(idx);
        if (!local) continue;
        const g = applyTransform2(local, tr);
        pts.push({ x: g.x, y: g.y });
      }
      if (pts.length < 2) continue;
      const edgeLabel = chain.edgeLabel || `edge_${chainIndex}`;
      if (seen) {
        if (seen.has(edgeLabel)) {
          chainIndex += 1;
          continue;
        }
        seen.add(edgeLabel);
      }
      paths.push({
        points: pts,
        closed: !!chain.closed,
        indices: Array.isArray(chain.verts) ? chain.verts.slice() : [],
        edgeLabel,
        name: edgeLabel,
        shared: !!chain.shared,
        otherFaceId: Number.isFinite(chain.otherFaceId) ? chain.otherFaceId : null,
        faceId,
        faceName,
        faceLabel,
      });
      chainIndex += 1;
    }
  }
  return paths;
}

function buildDebugSvgFromPaths(paths, label = 'Flat Debug') {
  if (!paths || !paths.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const pt of path.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  // const pad = Math.max(1, Math.min(width, height) * 0.05);
  const viewWidth = width + pad * 2;
  const viewHeight = height + pad * 2;
  const pad = Math.max(1, Math.min(width, height) * 0.05);

  const fmt = (n) => {
    if (!Number.isFinite(n)) return '0';
    const s = n.toFixed(4);
    return s.replace(/\.0+$/,'').replace(/(\.[0-9]*?)0+$/,'$1');
  };

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width + pad * 2)}mm" height="${fmt(height + pad * 2)}mm" viewBox="0 0 ${fmt(width + pad * 2)} ${fmt(height + pad * 2)}">`);
  lines.push(`  <title>${xmlEsc(label || 'Flat Debug')}</title>`);
  lines.push('  <g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const path of paths) {
    const pts = path.points;
    if (!pts || pts.length < 2) continue;
    const first = pts[0];
    const fx = first.x - minX + pad;
    const fy = height - (first.y - minY) + pad;
    let d = `M ${fmt(fx)} ${fmt(fy)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const x = p.x - minX + pad;
      const y = height - (p.y - minY) + pad;
      d += ` L ${fmt(x)} ${fmt(y)}`;
    }
    if (path.closed) d += ' Z';
    const name = xmlEsc(path.name || 'edge');
    const sw = Number.isFinite(path.strokeWidth) ? path.strokeWidth : 0.2;
    const stroke = path.color || '#000';
    lines.push(`    <path d="${d}" stroke="${stroke}" stroke-width="${fmt(sw)}" name="${name}"/>`);
  }
  lines.push('  </g>');
  lines.push('</svg>');
  return { svg: lines.join('\n'), width: width + pad * 2, height: height + pad * 2 };
}

function computeTransformForEdge(faceA, faceB, baseTransform, edgeInfo) {
  const a0 = faceA.coords.get(edgeInfo.a0);
  const a1 = faceA.coords.get(edgeInfo.a1);
  let b0 = faceB.coords.get(edgeInfo.b0);
  let b1 = faceB.coords.get(edgeInfo.b1);
  if (!a0 || !a1 || !b0 || !b1) return null;
  const ga0 = applyTransform2(a0, baseTransform);
  const ga1 = applyTransform2(a1, baseTransform);
  const signA = computeFaceSideSign(faceA, edgeInfo.a0, edgeInfo.a1, baseTransform);
  const signB = computeFaceSideSign(faceB, edgeInfo.b0, edgeInfo.b1);
  const vbv = { x: b1.x - b0.x, y: b1.y - b0.y };
  const gvv = { x: ga1.x - ga0.x, y: ga1.y - ga0.y };
  const lenB = Math.hypot(vbv.x, vbv.y);
  const lenG = Math.hypot(gvv.x, gvv.y);
  if (lenB < EPS || lenG < EPS) return null;
  const angle = Math.atan2(gvv.y, gvv.x) - Math.atan2(vbv.y, vbv.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rb0 = { x: cos * b0.x - sin * b0.y, y: sin * b0.x + cos * b0.y };
  const tr = { cos, sin, tx: ga0.x - rb0.x, ty: ga0.y - rb0.y };
  if (signA && signB && signA === signB) {
    tr.reflect = {
      origin: { x: b0.x, y: b0.y },
      dir: { x: vbv.x / lenB, y: vbv.y / lenB },
    };
  }
  return tr;
}

function computeComponentBounds(faceIds, faceData, transforms) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const faceId of faceIds) {
    const face = faceData.get(faceId);
    const tr = transforms.get(faceId);
    if (!face || !tr) continue;
    for (const idx of face.vertices) {
      const local = face.coords.get(idx);
      if (!local) continue;
      const g = applyTransform2(local, tr);
      if (g.x < minX) minX = g.x;
      if (g.x > maxX) maxX = g.x;
      if (g.y < minY) minY = g.y;
      if (g.y > maxY) maxY = g.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

function buildSharedEdgesMap(faceTriangles, vertProps, opts = {}) {
  const edgesByKey = new Map();
  const sharedEdgesByPair = new Map();
  const neighbors = new Map();
  const sharedVertsByFace = new Map();

  if (!faceTriangles || !faceTriangles.size || !vertProps) {
    return { sharedEdgesByPair, neighbors, sharedVertsByFace };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertProps.length; i += 3) {
    const x = vertProps[i + 0];
    const y = vertProps[i + 1];
    const z = vertProps[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const baseTol = Number.isFinite(opts?.tolerance) ? opts.tolerance : 0;
  const tol = Math.max(1e-5, diag * 1e-8, baseTol || 0);
  const quant = (v) => Math.round(v / tol);
  const vertexKey = (idx) => {
    const base = idx * 3;
    const x = vertProps[base + 0];
    const y = vertProps[base + 1];
    const z = vertProps[base + 2];
    return `${quant(x)},${quant(y)},${quant(z)}`;
  };

  const addEdgeEntry = (faceId, v0, v1, k0, k1) => {
    if (v0 === v1) return;
    const key0 = k0 || vertexKey(v0);
    const key1 = k1 || vertexKey(v1);
    if (key0 === key1) return;
    const key = key0 < key1 ? `${key0}|${key1}` : `${key1}|${key0}`;
    let list = edgesByKey.get(key);
    if (!list) { list = []; edgesByKey.set(key, list); }
    list.push({ faceId, v0, v1, k0: key0, k1: key1 });
  };

  for (const [faceId, face] of faceTriangles.entries()) {
    const edgeCounts = new Map();
    const addEdge = (a, b) => {
      const k0 = vertexKey(a);
      const k1 = vertexKey(b);
      if (k0 === k1) return;
      const key = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
      let entry = edgeCounts.get(key);
      if (entry) entry.count += 1;
      else edgeCounts.set(key, { a, b, k0, k1, count: 1 });
    };
    for (const tri of face.triangles) {
      addEdge(tri[0], tri[1]);
      addEdge(tri[1], tri[2]);
      addEdge(tri[2], tri[0]);
    }
    for (const entry of edgeCounts.values()) {
      if (entry.count === 1) {
        addEdgeEntry(faceId, entry.a, entry.b, entry.k0, entry.k1);
      }
    }
  }

  const addNeighbor = (a, b) => {
    let set = neighbors.get(a);
    if (!set) { set = new Set(); neighbors.set(a, set); }
    set.add(b);
  };

  const addSharedVert = (faceId, idx) => {
    let set = sharedVertsByFace.get(faceId);
    if (!set) { set = new Set(); sharedVertsByFace.set(faceId, set); }
    set.add(idx);
  };

  for (const entries of edgesByKey.values()) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const ea = entries[i];
        const eb = entries[j];
        if (ea.faceId === eb.faceId) continue;
        let a0 = ea.v0;
        let a1 = ea.v1;
        let b0 = eb.v0;
        let b1 = eb.v1;
        if (ea.k0 === eb.k0 && ea.k1 === eb.k1) {
          // endpoints match in order
        } else if (ea.k0 === eb.k1 && ea.k1 === eb.k0) {
          b0 = eb.v1;
          b1 = eb.v0;
        } else {
          continue;
        }

        let faceA = ea.faceId;
        let faceB = eb.faceId;
        if (faceA > faceB) {
          [faceA, faceB] = [faceB, faceA];
          [a0, b0] = [b0, a0];
          [a1, b1] = [b1, a1];
        }
        const key = pairKey(faceA, faceB);
        let list = sharedEdgesByPair.get(key);
        if (!list) { list = []; sharedEdgesByPair.set(key, list); }
        list.push({ faceA, faceB, a0, a1, b0, b1 });
        addNeighbor(faceA, faceB);
        addNeighbor(faceB, faceA);
        addSharedVert(faceA, a0);
        addSharedVert(faceA, a1);
        addSharedVert(faceB, b0);
        addSharedVert(faceB, b1);
      }
    }
  }

  return { sharedEdgesByPair, neighbors, sharedVertsByFace };
}

function normalizeSharedEdgeForFaces(edge, faceA, faceB) {
  if (edge.faceA === faceA && edge.faceB === faceB) {
    return { a0: edge.a0, a1: edge.a1, b0: edge.b0, b1: edge.b1 };
  }
  if (edge.faceA === faceB && edge.faceB === faceA) {
    return { a0: edge.b0, a1: edge.b1, b0: edge.a0, b1: edge.a1 };
  }
  return null;
}

function pickBestSharedEdge(faceA, faceB, faceAId, faceBId, edges) {
  if (!edges || !edges.length) return null;
  let best = null;
  let maxDist = -Infinity;
  for (const edge of edges) {
    const info = normalizeSharedEdgeForFaces(edge, faceAId, faceBId);
    if (!info) continue;
    const a0 = faceA.coords.get(info.a0);
    const a1 = faceA.coords.get(info.a1);
    if (!a0 || !a1) continue;
    const dx = a1.x - a0.x;
    const dy = a1.y - a0.y;
    const d = dx * dx + dy * dy;
    if (d > maxDist) {
      maxDist = d;
      best = info;
    }
  }
  return best;
}

function pickBestSharedChain(faceA, faceB, faceAId, faceBId, pairEntry) {
  if (!pairEntry || !Array.isArray(pairEntry.chains)) return null;
  let best = null;
  let maxDist = -Infinity;
  for (const chain of pairEntry.chains) {
    let vertsA = chain.vertsA || chain.vertsByFace?.get(faceAId) || chain.verts;
    let vertsB = chain.vertsB || chain.vertsByFace?.get(faceBId) || chain.verts;
    if (chain.vertsA && chain.vertsB && pairEntry.faceA != null && pairEntry.faceB != null) {
      if (pairEntry.faceA !== faceAId && pairEntry.faceB === faceAId) {
        [vertsA, vertsB] = [chain.vertsB, chain.vertsA];
      }
    }
    if (!vertsA || !vertsB || vertsA.length < 2 || vertsB.length < 2) continue;
    let a0 = vertsA[0];
    let a1 = vertsA[vertsA.length - 1];
    let b0 = vertsB[0];
    let b1 = vertsB[vertsB.length - 1];
    if (chain.closed || a0 === a1) {
      let bestI = null;
      let bestJ = null;
      let bestD = -Infinity;
      for (let i = 0; i < vertsA.length; i++) {
        const pa = faceA.coords.get(vertsA[i]);
        if (!pa) continue;
        for (let j = i + 1; j < vertsA.length; j++) {
          const pb = faceA.coords.get(vertsA[j]);
          if (!pb) continue;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const d = dx * dx + dy * dy;
          if (d > bestD) {
            bestD = d;
            bestI = i;
            bestJ = j;
          }
        }
      }
      if (bestI == null || bestJ == null) continue;
      a0 = vertsA[bestI];
      a1 = vertsA[bestJ];
      b0 = vertsB[bestI];
      b1 = vertsB[bestJ];
    }
    const a0c = faceA.coords.get(a0);
    const a1c = faceA.coords.get(a1);
    if (!a0c || !a1c) continue;
    const dx = a1c.x - a0c.x;
    const dy = a1c.y - a0c.y;
    const d = dx * dx + dy * dy;
    if (d > maxDist) {
      maxDist = d;
      best = { a0, a1, b0, b1 };
    }
  }
  return best;
}

function buildFlatPatternMeshByFaces(solid, opts = {}) {
  if (!solid || typeof solid.getMesh !== 'function') return null;
  const mesh = solid.getMesh();
  try {
    if (!mesh || !mesh.vertProperties || !mesh.triVerts || !mesh.faceID) return null;
    const vertProps = mesh.vertProperties;
    const triVerts = mesh.triVerts;
    const faceIDs = mesh.faceID;
    const triCount = (triVerts.length / 3) | 0;
    if (!triCount) return null;

    const selection = selectSheetMetalFaces(mesh, solid, opts);
    if (!selection || !selection.includeSet || !selection.includeSet.size) return null;
    const {
      includeSet,
      faceMetaById,
      faceTypeById,
      thickness,
      neutralFactor,
      insideRadius,
      insideType,
      surfaceIsInside,
    } = selection;

    const cylGroups = buildCylRadiusGroups(faceMetaById);
    const faceTriangles = collectFaceTriangles(triVerts, faceIDs, includeSet, vertProps);
    if (!faceTriangles.size) return null;
    const faceNameById = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
    const tolFromOpts = Number.isFinite(opts?.edgeTolerance) ? opts.edgeTolerance
      : Number.isFinite(opts?.mergeTolerance) ? opts.mergeTolerance
        : null;
    const edgeTol = Number.isFinite(tolFromOpts)
      ? tolFromOpts
      : Math.max(0, thickness * 1e-2);
    const topoEdges = buildFaceEdgeChainsFromMesh(
      triVerts,
      faceIDs,
      faceNameById,
      includeSet,
      vertProps,
      { tolerance: edgeTol },
    );
    let sharedPairs = topoEdges.byPair;
    let neighbors = topoEdges.neighbors;
    let sharedVertsByFace = topoEdges.sharedVertsByFace;
    let fallbackEdgesByPair = null;
    let fallback = null;
    const ensureFallback = () => {
      if (!fallback) {
        fallback = buildSharedEdgesMap(faceTriangles, vertProps, { tolerance: edgeTol });
      }
      return fallback;
    };
    if (!neighbors || !neighbors.size) {
      const fb = ensureFallback();
      sharedPairs = null;
      neighbors = fb.neighbors;
      sharedVertsByFace = fb.sharedVertsByFace;
      fallbackEdgesByPair = fb.sharedEdgesByPair;
    } else {
      const fb = ensureFallback();
      fallbackEdgesByPair = fb.sharedEdgesByPair;
      for (const [faceId, set] of fb.neighbors.entries()) {
        let target = neighbors.get(faceId);
        if (!target) { target = new Set(); neighbors.set(faceId, target); }
        for (const nb of set) target.add(nb);
      }
      for (const [faceId, set] of fb.sharedVertsByFace.entries()) {
        let target = sharedVertsByFace.get(faceId);
        if (!target) { target = new Set(); sharedVertsByFace.set(faceId, target); }
        for (const idx of set) target.add(idx);
      }
    }
    const faceData = new Map();
    const debugSteps = opts?.debug ? [] : null;
    const debugPlacementSteps = !!opts?.debugPlacementSteps;
    const identity = { cos: 1, sin: 0, tx: 0, ty: 0 };

    for (const [faceId, face] of faceTriangles.entries()) {
      const meta = faceMetaById.get(faceId) || {};
      const faceType = faceTypeById.get(faceId) || null;
      let coordsInfo = null;
      if (meta?.type === 'cylindrical') {
        const sharedVerts = sharedVertsByFace.get(faceId) || null;
        const faceRadius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
        const inferredInside = inferCylFaceIsInside(meta, faceRadius, cylGroups, thickness);
        let faceIsInside = inferredInside != null
          ? inferredInside
          : (insideType && faceType ? faceType === insideType : surfaceIsInside);
        let neutralRadius = null;
        if (Number.isFinite(faceRadius)) {
          neutralRadius = faceIsInside
            ? faceRadius + neutralFactor * thickness
            : faceRadius - (1 - neutralFactor) * thickness;
        }
        if (!Number.isFinite(neutralRadius) || neutralRadius <= EPS) {
          if (Number.isFinite(insideRadius)) {
            neutralRadius = insideRadius + neutralFactor * thickness;
          }
        }
        if (!Number.isFinite(neutralRadius) || neutralRadius <= EPS) return null;
        coordsInfo = buildCylFaceCoords(face, vertProps, meta, neutralRadius, sharedVerts);
      } else {
        coordsInfo = buildPlanarFaceCoords(face, vertProps);
      }
      if (!coordsInfo || !coordsInfo.coords) return null;
      const boundaryEdges = buildBoundaryEdgesFromTriangles(face.triangles);
      const boundaryChains = topoEdges.byFace.get(faceId) || buildEdgeChainsFromEdges(boundaryEdges);
      const basis = coordsInfo.origin && coordsInfo.uAxis && coordsInfo.vAxis
        ? {
          origin: Array.isArray(coordsInfo.origin) ? coordsInfo.origin.slice() : coordsInfo.origin,
          uAxis: Array.isArray(coordsInfo.uAxis) ? coordsInfo.uAxis.slice() : coordsInfo.uAxis,
          vAxis: Array.isArray(coordsInfo.vAxis) ? coordsInfo.vAxis.slice() : coordsInfo.vAxis,
          normal: Array.isArray(coordsInfo.normal) ? coordsInfo.normal.slice() : coordsInfo.normal,
        }
        : null;
      faceData.set(faceId, {
        ...face,
        coords: coordsInfo.coords,
        meta,
        area: face.area || 0,
        boundaryEdges,
        boundaryChains,
        basis,
      });
    }

    if (!faceData.size) return null;

    const cylInfoByFace = new Map();
    const getCylInfo = (faceId) => {
      if (cylInfoByFace.has(faceId)) return cylInfoByFace.get(faceId);
      const meta = faceData.get(faceId)?.meta || faceMetaById.get(faceId) || null;
      if (!meta || meta.type !== 'cylindrical') {
        cylInfoByFace.set(faceId, null);
        return null;
      }
      const key = lineKey(meta?.axis, meta?.center);
      const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
      const info = { key, radius };
      cylInfoByFace.set(faceId, info);
      return info;
    };
    const skipSharedEdge = (faceId, otherFaceId) => {
      if (!Number.isFinite(otherFaceId)) return false;
      const a = getCylInfo(faceId);
      const b = getCylInfo(otherFaceId);
      if (!a || !b || !a.key || !b.key) return false;
      if (a.key !== b.key) return false;
      if (!Number.isFinite(a.radius) || !Number.isFinite(b.radius)) return false;
      const minR = Math.min(Math.abs(a.radius), Math.abs(b.radius));
      const tol = Math.max(1e-4, (thickness || 0) * 0.05, minR * 0.02);
      return Math.abs(a.radius - b.radius) <= tol;
    };

    const transforms = new Map();
    const components = [];
    const unvisited = new Set(faceData.keys());
    if (debugSteps) {
      for (const faceId of faceData.keys()) {
        const faceName = (faceNameById && typeof faceNameById.get === 'function' && faceNameById.get(faceId))
          || `face_${faceId}`;
        const faceLabel = safeEdgeName(faceName);
        const paths = collectPathsForFaces([faceId], faceData, null, faceNameById, { skipSharedEdge });
        if (paths.length) {
          debugSteps.push({
            label: `Face ${faceLabel} (local)`,
            paths,
            faceId,
            faceName,
            basis: faceData.get(faceId)?.basis || null,
            addedFaceId: faceId,
            addedFaceName: faceName,
          });
        }
      }
    }

    let componentIndex = 0;
    while (unvisited.size) {
      let root = null;
      let maxArea = -Infinity;
      for (const id of unvisited) {
        const area = faceData.get(id)?.area ?? 0;
        if (area > maxArea) {
          maxArea = area;
          root = id;
        }
      }
      if (root == null) break;

      const compFaces = new Set();
      const queue = [root];
      transforms.set(root, identity);
      compFaces.add(root);
      unvisited.delete(root);
      componentIndex += 1;
      let stepIndex = 0;
      let prevSig = null;
      const baseBasis = faceData.get(root)?.basis || null;
      if (debugSteps && debugPlacementSteps) {
        const faceName = (faceNameById && typeof faceNameById.get === 'function' && faceNameById.get(root))
          || `face_${root}`;
        const faceLabel = safeEdgeName(faceName);
        const paths = collectPathsForFaces([root], faceData, transforms, faceNameById, {
          requireTransform: true,
          dedupe: true,
          skipSharedEdge,
        });
        const sig = paths.length ? paths.map((p) => p.edgeLabel || p.name || '').sort().join('|') : '';
        if (paths.length && sig !== prevSig) {
          debugSteps.push({
            label: `Component ${componentIndex} step ${stepIndex} (root ${faceLabel})`,
            paths,
            baseFaceId: root,
            baseBasis,
            addedFaceId: root,
            addedFaceName: faceName,
          });
          prevSig = sig;
        }
      }

      while (queue.length) {
        const current = queue.shift();
        const baseTr = transforms.get(current);
        const nbrs = neighbors.get(current);
        if (!nbrs) continue;
        for (const nb of nbrs) {
          if (!faceData.has(nb)) continue;
          if (transforms.has(nb)) continue;
          const faceA = faceData.get(current);
          const faceB = faceData.get(nb);
          if (!faceA || !faceB) continue;
          let edgeInfo = null;
          if (sharedPairs) {
            const pairEntry = sharedPairs.get(pairKey(current, nb));
            edgeInfo = pickBestSharedChain(faceA, faceB, current, nb, pairEntry);
          }
          if (!edgeInfo && fallbackEdgesByPair) {
            const fallbackEdges = fallbackEdgesByPair.get(pairKey(current, nb));
            edgeInfo = pickBestSharedEdge(faceA, faceB, current, nb, fallbackEdges);
          }
          if (!edgeInfo) continue;
          const tr = computeTransformForEdge(faceA, faceB, baseTr, edgeInfo);
          if (!tr) continue;
          transforms.set(nb, tr);
          compFaces.add(nb);
          unvisited.delete(nb);
          queue.push(nb);
          if (debugSteps && debugPlacementSteps) {
            const faceName = (faceNameById && typeof faceNameById.get === 'function' && faceNameById.get(nb))
              || `face_${nb}`;
            const faceLabel = safeEdgeName(faceName);
            stepIndex += 1;
            const placed = Array.from(compFaces);
            const paths = collectPathsForFaces(placed, faceData, transforms, faceNameById, {
              requireTransform: true,
              dedupe: true,
              skipSharedEdge,
            });
            const sig = paths.length ? paths.map((p) => p.edgeLabel || p.name || '').sort().join('|') : '';
            if (paths.length && sig !== prevSig) {
              debugSteps.push({
                label: `Component ${componentIndex} step ${stepIndex} (+${faceLabel})`,
                paths,
                baseFaceId: root,
                baseBasis,
                addedFaceId: nb,
                addedFaceName: faceName,
              });
              prevSig = sig;
            }
          }
        }
      }

      const bounds = computeComponentBounds(compFaces, faceData, transforms);
      if (bounds) components.push({ faces: Array.from(compFaces), bounds });
    }

    if (!components.length) return null;

    const positions = [];
    const triOut = [];
    const triFaceIds = [];
    const uvs = [];
    const margin = Math.max(1, thickness * 2);
    const weldTol = Math.max(1e-5, thickness * 1e-6);
    const coordKey = (x, y) => `${Math.round(x / weldTol)},${Math.round(y / weldTol)}`;
    let offsetX = 0;

    for (const component of components) {
      const bounds = component.bounds;
      if (!bounds) continue;
      const dx = offsetX - bounds.minX;
      const dy = -bounds.minY;
      offsetX += (bounds.maxX - bounds.minX) + margin;

      const coordToNew = new Map();
      const getIndex = (pt) => {
        const key = coordKey(pt.x, pt.y);
        let idx = coordToNew.get(key);
        if (idx != null) return idx;
        idx = (positions.length / 3) | 0;
        positions.push(pt.x, pt.y, 0);
        uvs[idx] = { x: pt.x, y: pt.y };
        coordToNew.set(key, idx);
        return idx;
      };

      for (const faceId of component.faces) {
        const face = faceData.get(faceId);
        const tr = transforms.get(faceId);
        if (!face || !tr) continue;
        const faceCoords = new Map();
        for (const idx of face.vertices) {
          const local = face.coords.get(idx);
          if (!local) continue;
          const g = applyTransform2(local, tr);
          faceCoords.set(idx, { x: g.x + dx, y: g.y + dy });
        }
        for (const tri of face.triangles) {
          const pa = faceCoords.get(tri[0]);
          const pb = faceCoords.get(tri[1]);
          const pc = faceCoords.get(tri[2]);
          if (!pa || !pb || !pc) continue;
          const ia = getIndex(pa);
          const ib = getIndex(pb);
          const ic = getIndex(pc);
          triOut.push(ia, ib, ic);
          triFaceIds.push(faceId);
        }
      }
    }

    if (!triOut.length || !positions.length) return null;
    const result = {
      vertProperties: new Float32Array(positions),
      triVerts: new Uint32Array(triOut),
      triFaces: triFaceIds,
      uvs,
      faceMetaById,
      faceNameById: solid._idToFaceName,
      thickness,
      delete() {},
    };
    if (debugSteps) result.debugSteps = debugSteps;
    return result;
  } finally {
    try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
  }
}

function buildNeutralSurfaceMesh(solid, opts = {}) {
  if (!solid || typeof solid.getMesh !== 'function') return null;
  const mesh = solid.getMesh();
  try {
    if (!mesh || !mesh.vertProperties || !mesh.triVerts || !mesh.faceID) return null;
    const vertProps = mesh.vertProperties;
    const triVerts = mesh.triVerts;
    const faceIDs = mesh.faceID;
    const triCount = (triVerts.length / 3) | 0;
    if (!triCount) return null;
    const idToName = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (!idToName) return null;

    const faceMetaByName = new Map();
    const faceMetaById = new Map();
    const faceTypeById = new Map();
    const cylFaces = [];
    let hasA = false;
    let hasB = false;
    for (const [id, name] of idToName.entries()) {
      let meta = {};
      if (solid && typeof solid.getFaceMetadata === 'function') {
        try { meta = solid.getFaceMetadata(name) || {}; } catch { meta = {}; }
      }
      faceMetaByName.set(name, meta || {});
      faceMetaById.set(id, meta || {});
      const ft = resolveFaceType(meta);
      if (ft === 'A') hasA = true;
      if (ft === 'B') hasB = true;
      faceTypeById.set(id, ft);
      if (meta?.type === 'cylindrical') {
        const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
        if (Number.isFinite(radius) && radius > 0) {
          cylFaces.push({ id, radius, meta });
        }
      }
    }
    if (!hasA) return null;

    const insideType = findInsideFaceType(faceMetaByName) || (hasA ? 'A' : 'B');
    const surfaceType = hasA ? 'A' : 'B';
    const strictSurfaceType = opts?.strictSurfaceType !== false;

    const thickness = resolveThickness(solid, opts?.metadataManager);
    if (!Number.isFinite(thickness) || thickness <= 0) return null;
    const bendRadius = resolveBendRadius(solid, opts?.metadataManager);
    const minCylRadius = cylFaces.length ? Math.min(...cylFaces.map((c) => c.radius)) : null;
    const insideRadius = Number.isFinite(bendRadius) && bendRadius >= 0 ? bendRadius : minCylRadius;
    const outsideRadius = Number.isFinite(insideRadius) ? insideRadius + thickness : null;
    const radiusTol = Math.max(
      1e-4,
      thickness * 0.1,
      Number.isFinite(insideRadius) ? insideRadius * 0.05 : 0,
    );

    const neutralFactor = resolveNeutralFactor(opts, solid, opts?.metadataManager);
    const surfaceIsInside = insideType ? (surfaceType === insideType) : true;
    const offsetDist = surfaceIsInside
      ? neutralFactor * thickness
      : (1 - neutralFactor) * thickness;

    const positions = [];
    const triangles = [];
    const triFaceIds = [];
    const indexMap = new Map();
    const mapIndex = (origIdx) => {
      let mapped = indexMap.get(origIdx);
      if (mapped != null) return mapped;
      mapped = (positions.length / 3) | 0;
      positions.push(
        vertProps[origIdx * 3 + 0],
        vertProps[origIdx * 3 + 1],
        vertProps[origIdx * 3 + 2],
      );
      indexMap.set(origIdx, mapped);
      return mapped;
    };

    for (let t = 0; t < triCount; t++) {
      const faceId = faceIDs[t];
      const faceType = faceTypeById.get(faceId) || null;
      const meta = faceMetaById.get(faceId);
      let include = faceType === surfaceType;
      if (!include && !strictSurfaceType && meta?.type === 'cylindrical') {
        const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
        if (Number.isFinite(radius)) {
          if (Number.isFinite(insideRadius)) {
            const target = surfaceIsInside ? insideRadius : outsideRadius;
            if (Number.isFinite(target)) {
              include = Math.abs(radius - target) <= radiusTol;
            }
          } else {
            include = true;
          }
        }
      }
      if (!include) continue;
      const base = t * 3;
      const a = mapIndex(triVerts[base + 0]);
      const b = mapIndex(triVerts[base + 1]);
      const c = mapIndex(triVerts[base + 2]);
      triangles.push([a, b, c]);
      triFaceIds.push(faceId);
    }

    if (!triangles.length) return null;
    const vCount = (positions.length / 3) | 0;

    const normals = new Float32Array(positions.length);
    for (const tri of triangles) {
      const i0 = tri[0], i1 = tri[1], i2 = tri[2];
      const ax = positions[i0 * 3 + 0];
      const ay = positions[i0 * 3 + 1];
      const az = positions[i0 * 3 + 2];
      const bx = positions[i1 * 3 + 0];
      const by = positions[i1 * 3 + 1];
      const bz = positions[i1 * 3 + 2];
      const cx = positions[i2 * 3 + 0];
      const cy = positions[i2 * 3 + 1];
      const cz = positions[i2 * 3 + 2];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      normals[i0 * 3 + 0] += nx;
      normals[i0 * 3 + 1] += ny;
      normals[i0 * 3 + 2] += nz;
      normals[i1 * 3 + 0] += nx;
      normals[i1 * 3 + 1] += ny;
      normals[i1 * 3 + 2] += nz;
      normals[i2 * 3 + 0] += nx;
      normals[i2 * 3 + 1] += ny;
      normals[i2 * 3 + 2] += nz;
    }

    for (let i = 0; i < vCount; i++) {
      const nx = normals[i * 3 + 0];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      const len = Math.hypot(nx, ny, nz);
      if (len > EPS) {
        normals[i * 3 + 0] = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      } else {
        normals[i * 3 + 0] = 0;
        normals[i * 3 + 1] = 0;
        normals[i * 3 + 2] = 1;
      }
    }

    if (offsetDist > EPS) {
      for (let i = 0; i < vCount; i++) {
        positions[i * 3 + 0] -= normals[i * 3 + 0] * offsetDist;
        positions[i * 3 + 1] -= normals[i * 3 + 1] * offsetDist;
        positions[i * 3 + 2] -= normals[i * 3 + 2] * offsetDist;
      }
    }

    return {
      positions,
      triangles,
      triFaceIds,
      thickness,
      faceMetaById,
      faceNameById: idToName,
    };
  } finally {
    try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
  }
}

function buildTriangleNormals(positions, triangles) {
  const out = new Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const i0 = tri[0], i1 = tri[1], i2 = tri[2];
    const ax = positions[i0 * 3 + 0];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3 + 0];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3 + 0];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[i] = [nx / len, ny / len, nz / len];
  }
  return out;
}

function orientTriangles(positions, triangles) {
  if (!triangles.length) return triangles;
  const normals = buildTriangleNormals(positions, triangles);
  const base = normals[0];
  for (let i = 0; i < triangles.length; i++) {
    const n = normals[i];
    const dot = n[0] * base[0] + n[1] * base[1] + n[2] * base[2];
    if (dot < 0) {
      const tri = triangles[i];
      const tmp = tri[1];
      tri[1] = tri[2];
      tri[2] = tmp;
    }
  }
  return triangles;
}

function buildEdgeMap(triangles) {
  const edgeMap = new Map();
  const addEdge = (a, b, triIdx) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let list = edgeMap.get(key);
    if (!list) { list = []; edgeMap.set(key, list); }
    list.push(triIdx);
  };
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    addEdge(tri[0], tri[1], i);
    addEdge(tri[1], tri[2], i);
    addEdge(tri[2], tri[0], i);
  }
  return edgeMap;
}

function dist(positions, a, b) {
  const ax = positions[a * 3 + 0];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3 + 0];
  const by = positions[b * 3 + 1];
  const bz = positions[b * 3 + 2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return Math.hypot(dx, dy, dz);
}

function triOrientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function unfoldSurfaceTo2D(positions, triangles, thickness = 1) {
  const vCount = (positions.length / 3) | 0;
  const triCount = triangles.length;
  const uvs = new Array(vCount);
  const triPlaced = new Array(triCount).fill(false);
  const edgeMap = buildEdgeMap(triangles);
  const margin = Math.max(1, thickness * 2);
  let offsetX = 0;

  const placeTriangle = (triIdx) => {
    const tri = triangles[triIdx];
    const a = tri[0], b = tri[1], c = tri[2];
    const lenAB = dist(positions, a, b);
    const lenAC = dist(positions, a, c);
    const lenBC = dist(positions, b, c);
    if (lenAB < EPS || lenAC < EPS || lenBC < EPS) return null;
    const x = (lenAC * lenAC - lenBC * lenBC + lenAB * lenAB) / (2 * lenAB);
    const ySq = Math.max(lenAC * lenAC - x * x, 0);
    const y = Math.sqrt(ySq);
    uvs[a] = { x: 0, y: 0 };
    uvs[b] = { x: lenAB, y: 0 };
    uvs[c] = { x, y };
    triPlaced[triIdx] = true;
    return [a, b, c];
  };

  for (let t = 0; t < triCount; t++) {
    if (triPlaced[t]) continue;
    const componentVerts = new Set();
    const baseVerts = placeTriangle(t);
    if (!baseVerts) continue;
    baseVerts.forEach((v) => componentVerts.add(v));
    const queue = [t];

    while (queue.length) {
      const current = queue.shift();
      const tri = triangles[current];
      const edges = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      for (const [a, b] of edges) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const neighbors = edgeMap.get(key) || [];
        for (const nIdx of neighbors) {
          if (nIdx === current || triPlaced[nIdx]) continue;
          const nTri = triangles[nIdx];
          const c = nTri.find((idx) => idx !== a && idx !== b);
          if (c == null) continue;
          if (!uvs[a] || !uvs[b]) continue;
          if (!uvs[c]) {
            const pa = uvs[a];
            const pb = uvs[b];
            const lenAB = dist(positions, a, b);
            const lenAC = dist(positions, a, c);
            const lenBC = dist(positions, b, c);
            if (lenAB < EPS || lenAC < EPS || lenBC < EPS) continue;
            const x = (lenAC * lenAC - lenBC * lenBC + lenAB * lenAB) / (2 * lenAB);
            const ySq = Math.max(lenAC * lenAC - x * x, 0);
            const y = Math.sqrt(ySq);
            const ex = (pb.x - pa.x) / lenAB;
            const ey = (pb.y - pa.y) / lenAB;
            const perp = { x: -ey, y: ex };
            const cand1 = { x: pa.x + ex * x + perp.x * y, y: pa.y + ey * x + perp.y * y };
            const cand2 = { x: pa.x + ex * x - perp.x * y, y: pa.y + ey * x - perp.y * y };

            const orient1 = triOrientation(
              nTri[0] === c ? cand1 : uvs[nTri[0]],
              nTri[1] === c ? cand1 : uvs[nTri[1]],
              nTri[2] === c ? cand1 : uvs[nTri[2]],
            );
            const orient2 = triOrientation(
              nTri[0] === c ? cand2 : uvs[nTri[0]],
              nTri[1] === c ? cand2 : uvs[nTri[1]],
              nTri[2] === c ? cand2 : uvs[nTri[2]],
            );

            let chosen = cand1;
            if (orient1 < 0 && orient2 >= 0) chosen = cand2;
            else if (orient1 < 0 && orient2 < 0) {
              chosen = Math.abs(orient2) < Math.abs(orient1) ? cand2 : cand1;
            }
            uvs[c] = chosen;
          }
          componentVerts.add(a);
          componentVerts.add(b);
          componentVerts.add(c);
          triPlaced[nIdx] = true;
          queue.push(nIdx);
        }
      }
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const idx of componentVerts) {
      const uv = uvs[idx];
      if (!uv) continue;
      if (uv.x < minX) minX = uv.x;
      if (uv.x > maxX) maxX = uv.x;
      if (uv.y < minY) minY = uv.y;
      if (uv.y > maxY) maxY = uv.y;
    }
    if (!Number.isFinite(minX)) continue;
    const dx = offsetX - minX;
    const dy = -minY;
    for (const idx of componentVerts) {
      const uv = uvs[idx];
      if (!uv) continue;
      uv.x += dx;
      uv.y += dy;
    }
    offsetX += (maxX - minX) + margin;
  }

  return uvs;
}

function buildFlatPatternMeshTriangulated(solid, opts = {}) {
  const neutral = buildNeutralSurfaceMesh(solid, opts);
  if (!neutral) return null;
  const positions = neutral.positions;
  const triangles = orientTriangles(positions, neutral.triangles);
  const triFaceIds = Array.isArray(neutral.triFaceIds) ? neutral.triFaceIds.slice() : null;
  const uvs = unfoldSurfaceTo2D(positions, triangles, neutral.thickness);
  if (!uvs || !uvs.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  for (const uv of uvs) {
    if (!uv) continue;
    if (uv.x < minX) minX = uv.x;
    if (uv.y < minY) minY = uv.y;
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  const vCount = uvs.length;
  const flatVerts = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const uv = uvs[i] || { x: 0, y: 0 };
    flatVerts[i * 3 + 0] = uv.x - minX;
    flatVerts[i * 3 + 1] = uv.y - minY;
    flatVerts[i * 3 + 2] = 0;
  }

  const triVerts = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    triVerts[i * 3 + 0] = tri[0];
    triVerts[i * 3 + 1] = tri[1];
    triVerts[i * 3 + 2] = tri[2];
  }

  return {
    vertProperties: flatVerts,
    triVerts,
    triFaces: triFaceIds,
    uvs,
    faceMetaById: neutral.faceMetaById,
    faceNameById: neutral.faceNameById,
    thickness: neutral.thickness,
    delete() {},
  };
}

function buildFlatPatternMesh(solid, opts = {}) {
  const flatByFaces = buildFlatPatternMeshByFaces(solid, opts);
  if (flatByFaces) return flatByFaces;
  return buildFlatPatternMeshTriangulated(solid, opts);
}

function buildBoundaryLoops2D(positions, triVerts) {
  const edgeCounts = new Map();
  const triCount = (triVerts.length / 3) | 0;
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const key = edgeKey(u, v);
      const entry = edgeCounts.get(key);
      if (entry) entry.count += 1;
      else edgeCounts.set(key, { a: u, b: v, count: 1 });
    }
  }

  const boundaryEdges = [];
  for (const entry of edgeCounts.values()) {
    if (entry.count === 1) boundaryEdges.push([entry.a, entry.b]);
  }
  if (!boundaryEdges.length) return [];

  const adjacency = new Map();
  const addAdj = (u, v) => {
    let list = adjacency.get(u);
    if (!list) { list = []; adjacency.set(u, list); }
    list.push(v);
  };
  for (const [a, b] of boundaryEdges) {
    addAdj(a, b);
    addAdj(b, a);
  }

  const used = new Set();
  const loops = [];
  const markUsed = (u, v) => used.add(edgeKey(u, v));
  const isUsed = (u, v) => used.has(edgeKey(u, v));

  for (const [startA, startB] of boundaryEdges) {
    if (isUsed(startA, startB)) continue;
    const loop = [startA, startB];
    markUsed(startA, startB);
    let prev = startA;
    let curr = startB;
    let guard = 0;
    while (guard++ < boundaryEdges.length * 2) {
      const neighbors = adjacency.get(curr) || [];
      let next = null;
      for (const n of neighbors) {
        if (n === prev) continue;
        if (!isUsed(curr, n)) { next = n; break; }
      }
      if (next == null) {
        const maybeClose = neighbors.find((n) => n === startA && !isUsed(curr, n));
        if (maybeClose != null) {
          loop.push(startA);
          markUsed(curr, maybeClose);
        }
        break;
      }
      loop.push(next);
      markUsed(curr, next);
      prev = curr;
      curr = next;
      if (curr === startA) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

function buildBendAnnotations2D(flatMesh) {
  if (!flatMesh || !flatMesh.vertProperties || !flatMesh.triVerts) {
    return { centerlines: [], bendEdges: [] };
  }
  const triFaces = Array.isArray(flatMesh.triFaces) ? flatMesh.triFaces : null;
  const faceMetaById = flatMesh.faceMetaById instanceof Map ? flatMesh.faceMetaById : null;
  const triCount = (flatMesh.triVerts.length / 3) | 0;
  if (!triFaces || !faceMetaById || triFaces.length !== triCount) {
    return { centerlines: [], bendEdges: [] };
  }

  const thickness = Number(flatMesh.thickness);
  const faceNameById = flatMesh.faceNameById instanceof Map ? flatMesh.faceNameById : null;
  const faceMetaByName = new Map();
  if (faceNameById) {
    for (const [id, name] of faceNameById.entries()) {
      faceMetaByName.set(name, faceMetaById.get(id) || {});
    }
  }
  const insideType = faceMetaByName.size ? findInsideFaceType(faceMetaByName) : null;
  const cylGroups = buildCylRadiusGroups(faceMetaById);

  const positions = flatMesh.vertProperties;
  const triVerts = flatMesh.triVerts;
  const faceToTris = new Map();
  for (let i = 0; i < triFaces.length; i++) {
    const faceId = triFaces[i];
    const meta = faceMetaById.get(faceId);
    if (!meta || meta.type !== 'cylindrical') continue;
    let list = faceToTris.get(faceId);
    if (!list) { list = []; faceToTris.set(faceId, list); }
    list.push(i);
  }
  if (!faceToTris.size) return { centerlines: [], bendEdges: [] };

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const centerlines = [];
  const bendEdges = [];
  const faceTowardA = new Map();
  const getTowardA = (faceId) => {
    if (faceTowardA.has(faceId)) return faceTowardA.get(faceId);
    const meta = faceMetaById.get(faceId);
    if (!meta || meta.type !== 'cylindrical') {
      faceTowardA.set(faceId, null);
      return null;
    }
    const faceRadius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
    const inferredInside = inferCylFaceIsInside(meta, faceRadius, cylGroups, thickness);
    let faceIsInside = inferredInside;
    if (faceIsInside == null && insideType) {
      const faceType = resolveFaceType(meta);
      if (faceType) faceIsInside = faceType === insideType;
    }
    if (faceIsInside == null) {
      faceTowardA.set(faceId, null);
      return null;
    }
    const faceType = resolveFaceType(meta);
    const towardA = faceType === 'B' ? !faceIsInside : faceIsInside;
    faceTowardA.set(faceId, towardA);
    return towardA;
  };

  for (const [faceId, triIdxs] of faceToTris.entries()) {
    const edgeCounts = new Map();
    const addEdge = (a, b) => {
      const key = edgeKey(a, b);
      const entry = edgeCounts.get(key);
      if (entry) entry.count += 1;
      else edgeCounts.set(key, { a, b, count: 1 });
    };
    for (const triIdx of triIdxs) {
      const base = triIdx * 3;
      const a = triVerts[base + 0];
      const b = triVerts[base + 1];
      const c = triVerts[base + 2];
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }

    const boundaryEdges = [];
    for (const entry of edgeCounts.values()) {
      if (entry.count === 1) boundaryEdges.push([entry.a, entry.b]);
    }
    if (boundaryEdges.length < 2) continue;

    const edges2D = [];
    for (const [a, b] of boundaryEdges) {
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < EPS) continue;
      edges2D.push({
        a,
        b,
        dx: dx / len,
        dy: dy / len,
        len,
        mid: { x: (ax + bx) / 2, y: (ay + by) / 2 },
        pa: { x: ax, y: ay },
        pb: { x: bx, y: by },
      });
    }
    if (edges2D.length < 2) continue;

    edges2D.sort((e1, e2) => e2.len - e1.len);
    const first = edges2D[0];
    let axisDir = { x: first.dx, y: first.dy };
    if (edges2D.length > 1) {
      const second = edges2D[1];
      const dot = axisDir.x * second.dx + axisDir.y * second.dy;
      const sx = dot < 0 ? -second.dx : second.dx;
      const sy = dot < 0 ? -second.dy : second.dy;
      axisDir = { x: axisDir.x + sx, y: axisDir.y + sy };
      const len = Math.hypot(axisDir.x, axisDir.y);
      if (len > EPS) { axisDir.x /= len; axisDir.y /= len; }
    }

    const nDir = { x: -axisDir.y, y: axisDir.x };
    const parallelEdges = edges2D.filter(
      (e) => Math.abs(e.dx * axisDir.x + e.dy * axisDir.y) > 0.9,
    );
    if (parallelEdges.length < 2) continue;

    for (const e of parallelEdges) {
      bendEdges.push({ p0: e.pa, p1: e.pb, faceId });
    }

    let minOff = Infinity;
    let maxOff = -Infinity;
    let minS = Infinity;
    let maxS = -Infinity;
    for (const e of parallelEdges) {
      const offset = e.mid.x * nDir.x + e.mid.y * nDir.y;
      if (offset < minOff) minOff = offset;
      if (offset > maxOff) maxOff = offset;
      const pts = [e.pa, e.pb];
      for (const p of pts) {
        const s = p.x * axisDir.x + p.y * axisDir.y;
        if (s < minS) minS = s;
        if (s > maxS) maxS = s;
      }
    }
    if (!Number.isFinite(minOff) || !Number.isFinite(maxOff)) continue;
    if (!Number.isFinite(minS) || !Number.isFinite(maxS)) continue;

    const centerOff = (minOff + maxOff) * 0.5;
    const p0 = {
      x: axisDir.x * minS + nDir.x * centerOff,
      y: axisDir.y * minS + nDir.y * centerOff,
    };
    const p1 = {
      x: axisDir.x * maxS + nDir.x * centerOff,
      y: axisDir.y * maxS + nDir.y * centerOff,
    };
    centerlines.push({ p0, p1, faceId, towardA: getTowardA(faceId) });
  }

  return { centerlines, bendEdges };
}

function buildSvgForFlatMesh(flatMesh, name = 'FLAT', opts = {}) {
  if (!flatMesh || !flatMesh.vertProperties || !flatMesh.triVerts) return null;
  const positions = flatMesh.vertProperties;
  const triVerts = flatMesh.triVerts;
  const loops = buildBoundaryLoops2D(positions, triVerts);
  if (!loops.length) return null;
  const bendAnnotations = buildBendAnnotations2D(flatMesh) || { centerlines: [], bendEdges: [] };
  const centerlines = Array.isArray(bendAnnotations.centerlines) ? bendAnnotations.centerlines : [];
  const bendEdges = Array.isArray(bendAnnotations.bendEdges) ? bendAnnotations.bendEdges : [];

  let longestLen = 0;
  let longestDx = 1;
  let longestDy = 0;
  for (const loop of loops) {
    if (!loop || loop.length < 2) continue;
    const pts = loop[0] === loop[loop.length - 1] ? loop.slice(0, -1) : loop;
    const count = pts.length;
    if (count < 2) continue;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % count];
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len > longestLen) {
        longestLen = len;
        longestDx = dx;
        longestDy = dy;
      }
    }
  }

  let rotCos = 1;
  let rotSin = 0;
  if (longestLen > EPS) {
    const angle = Math.atan2(longestDy, longestDx);
    const rot = -angle;
    rotCos = Math.cos(rot);
    rotSin = Math.sin(rot);
  }

  const rotatePoint = (x, y) => ({
    x: rotCos * x - rotSin * y,
    y: rotSin * x + rotCos * y,
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const idx of loop) {
      const rawX = positions[idx * 3 + 0];
      const rawY = positions[idx * 3 + 1];
      const p = rotatePoint(rawX, rawY);
      const x = p.x;
      const y = p.y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const pad = Math.max(1, Math.min(width, height) * 0.05);
  const viewWidth = width + pad * 2;
  const viewHeight = height + pad * 2;

  const fmt = (n) => {
    if (!Number.isFinite(n)) return '0';
    const s = n.toFixed(4);
    return s.replace(/\.0+$/,'').replace(/(\.[0-9]*?)0+$/,'$1');
  };

  const pathParts = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const pts = loop[0] === loop[loop.length - 1] ? loop.slice(0, -1) : loop.slice();
    if (pts.length < 3) continue;
    const first = pts[0];
    const fp = rotatePoint(positions[first * 3 + 0], positions[first * 3 + 1]);
    const fx = fp.x - minX + pad;
    const fy = height - (fp.y - minY) + pad;
    let d = `M ${fmt(fx)} ${fmt(fy)}`;
    for (let i = 1; i < pts.length; i++) {
      const idx = pts[i];
      const p = rotatePoint(positions[idx * 3 + 0], positions[idx * 3 + 1]);
      const x = p.x - minX + pad;
      const y = height - (p.y - minY) + pad;
      d += ` L ${fmt(x)} ${fmt(y)}`;
    }
    d += ' Z';
    pathParts.push(d);
  }
  if (!pathParts.length) return null;

  const linePartsTowardA = [];
  const linePartsAwayFromA = [];
  const linePartsUnknown = [];
  if (centerlines.length) {
    for (const line of centerlines) {
      const p0 = rotatePoint(line.p0.x, line.p0.y);
      const p1 = rotatePoint(line.p1.x, line.p1.y);
      const x1 = p0.x - minX + pad;
      const y1 = height - (p0.y - minY) + pad;
      const x2 = p1.x - minX + pad;
      const y2 = height - (p1.y - minY) + pad;
      const d = `M ${fmt(x1)} ${fmt(y1)} L ${fmt(x2)} ${fmt(y2)}`;
      if (line.towardA === true) linePartsTowardA.push(d);
      else if (line.towardA === false) linePartsAwayFromA.push(d);
      else linePartsUnknown.push(d);
    }
  }

  const bendEdgeParts = [];
  if (bendEdges.length) {
    for (const edge of bendEdges) {
      const p0 = rotatePoint(edge.p0.x, edge.p0.y);
      const p1 = rotatePoint(edge.p1.x, edge.p1.y);
      const x1 = p0.x - minX + pad;
      const y1 = height - (p0.y - minY) + pad;
      const x2 = p1.x - minX + pad;
      const y2 = height - (p1.y - minY) + pad;
      bendEdgeParts.push(`M ${fmt(x1)} ${fmt(y1)} L ${fmt(x2)} ${fmt(y2)}`);
    }
  }

  const cutStroke = '#000';
  const bendEdgeStroke = '#0070cc';
  const centerTowardAStroke = '#00b000';
  const centerAwayAStroke = '#b00000';
  const centerUnknownStroke = centerTowardAStroke;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(viewWidth)}mm" height="${fmt(viewHeight)}mm" viewBox="0 0 ${fmt(viewWidth)} ${fmt(viewHeight)}">`);
  lines.push(`  <title>${xmlEsc(name || 'Flat Pattern')}</title>`);
  lines.push(`  <g fill="none" stroke="${cutStroke}" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round">`);
  for (const d of pathParts) {
    lines.push(`    <path d="${d}"/>`);
  }
  lines.push('  </g>');
  if (bendEdgeParts.length) {
    lines.push(`  <g fill="none" stroke="${bendEdgeStroke}" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="3,2">`);
    for (const d of bendEdgeParts) {
      lines.push(`    <path d="${d}"/>`);
    }
    lines.push('  </g>');
  }
  if (linePartsTowardA.length) {
    lines.push(`  <g fill="none" stroke="${centerTowardAStroke}" stroke-width="0.15" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="2,1">`);
    for (const d of linePartsTowardA) lines.push(`    <path d="${d}"/>`);
    lines.push('  </g>');
  }
  if (linePartsAwayFromA.length) {
    lines.push(`  <g fill="none" stroke="${centerAwayAStroke}" stroke-width="0.15" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="2,1">`);
    for (const d of linePartsAwayFromA) lines.push(`    <path d="${d}"/>`);
    lines.push('  </g>');
  }
  if (linePartsUnknown.length) {
    lines.push(`  <g fill="none" stroke="${centerUnknownStroke}" stroke-width="0.15" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="2,1">`);
    for (const d of linePartsUnknown) lines.push(`    <path d="${d}"/>`);
    lines.push('  </g>');
  }
  lines.push('</svg>');
  return { svg: lines.join('\n'), width: viewWidth, height: viewHeight };
}

export function buildSheetMetalFlatPatternSolids(solids, opts = {}) {
  const out = [];
  const list = Array.isArray(solids) ? solids : [];
  for (const solid of list) {
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const flatMesh = buildFlatPatternMesh(solid, opts);
    if (!flatMesh) continue;
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    out.push({
      name: `${baseName}_FLAT`,
      getMesh: () => flatMesh,
    });
  }
  return out;
}

export function buildSheetMetalFlatPatternDebugSteps(solids, opts = {}) {
  const entries = [];
  const list = Array.isArray(solids) ? solids : [];
  const debugPlacementSteps = opts?.debugPlacementSteps ?? true;
  for (let i = 0; i < list.length; i++) {
    const solid = list[i];
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const flatMesh = buildFlatPatternMesh(solid, {
      ...opts,
      debug: true,
      debugPlacementSteps,
    });
    if (!flatMesh || !Array.isArray(flatMesh.debugSteps) || !flatMesh.debugSteps.length) continue;
    assignDebugPathColors(flatMesh.debugSteps);
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    entries.push({
      name: baseName,
      debugSteps: flatMesh.debugSteps,
      thickness: flatMesh.thickness,
      sourceIndex: i,
    });
  }
  return entries;
}

export function buildSheetMetalFlatPatternSvgs(solids, opts = {}) {
  const entries = [];
  const list = Array.isArray(solids) ? solids : [];
  for (const solid of list) {
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const flatMesh = buildFlatPatternMesh(solid, opts);
    if (!flatMesh) continue;
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    const svgInfo = buildSvgForFlatMesh(flatMesh, `${baseName} Flat Pattern`);
    if (!svgInfo || !svgInfo.svg) continue;
    const entry = { name: baseName, svg: svgInfo.svg, width: svgInfo.width, height: svgInfo.height };
    if (opts?.debug && Array.isArray(flatMesh.debugSteps)) {
      assignDebugPathColors(flatMesh.debugSteps);
      const debugSvgs = [];
      for (const step of flatMesh.debugSteps) {
        const info = buildDebugSvgFromPaths(step.paths, step.label);
        if (info && info.svg) {
          debugSvgs.push({ label: step.label, svg: info.svg, width: info.width, height: info.height });
        }
      }
      if (debugSvgs.length) entry.debug = debugSvgs;
    }
    entries.push(entry);
  }
  return entries;
}

import { Colors, DxfWriter, LineTypes, Units, point3d } from '@tarikjabiri/dxf';

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
  if (Number.isFinite(fromOpts) && fromOpts > 0) {
    console.log('[FlatPattern] resolveNeutralFactor: from opts =', fromOpts);
    return clamp(fromOpts, 0, 1);
  }
  const sm = solid?.userData?.sheetMetal || null;
  const fromSolid = Number(
    sm?.neutralFactor
    ?? sm?.kFactor
    ?? sm?.kFactorValue
    ?? solid?.userData?.sheetMetalNeutralFactor
  );
  if (Number.isFinite(fromSolid) && fromSolid > 0) {
    console.log('[FlatPattern] resolveNeutralFactor: from solid =', fromSolid);
    return clamp(fromSolid, 0, 1);
  }
  const meta = metadataManager && solid?.name && typeof metadataManager.getMetadata === 'function'
    ? metadataManager.getMetadata(solid.name)
    : null;
  const fromMeta = Number(meta?.sheetMetalNeutralFactor ?? meta?.sheetMetalKFactor);
  if (Number.isFinite(fromMeta) && fromMeta > 0) {
    console.log('[FlatPattern] resolveNeutralFactor: from metadata =', fromMeta);
    return clamp(fromMeta, 0, 1);
  }
  console.log('[FlatPattern] resolveNeutralFactor: using DEFAULT =', DEFAULT_NEUTRAL_FACTOR);
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

function rayIntersectsTriangle(rayOrigin, rayDir, v0, v1, v2) {
  // Möller–Trumbore ray-triangle intersection algorithm
  const EPSILON = 1e-6;
  
  const edge1 = sub3(v1, v0);
  const edge2 = sub3(v2, v0);
  const h = cross3(rayDir, edge2);
  const a = dot3(edge1, h);
  
  if (Math.abs(a) < EPSILON) return false; // Ray parallel to triangle
  
  const f = 1.0 / a;
  const s = sub3(rayOrigin, v0);
  const u = f * dot3(s, h);
  
  if (u < 0.0 || u > 1.0) return false;
  
  const q = cross3(s, edge1);
  const v = f * dot3(rayDir, q);
  
  if (v < 0.0 || u + v > 1.0) return false;
  
  const t = f * dot3(edge2, q);
  
  return t > EPSILON; // Ray intersects triangle (t is distance along ray)
}

function rayIntersectsTriangleWithPoint(rayOrigin, rayDir, v0, v1, v2) {
  // Möller–Trumbore ray-triangle intersection algorithm with intersection point
  const EPSILON = 1e-6;
  
  const edge1 = sub3(v1, v0);
  const edge2 = sub3(v2, v0);
  const h = cross3(rayDir, edge2);
  const a = dot3(edge1, h);
  
  if (Math.abs(a) < EPSILON) return null; // Ray parallel to triangle
  
  const f = 1.0 / a;
  const s = sub3(rayOrigin, v0);
  const u = f * dot3(s, h);
  
  if (u < 0.0 || u > 1.0) return null;
  
  const q = cross3(s, edge1);
  const v = f * dot3(rayDir, q);
  
  if (v < 0.0 || u + v > 1.0) return null;
  
  const t = f * dot3(edge2, q);
  
  if (t > EPSILON) {
    // Calculate intersection point
    const point = add3(rayOrigin, scale3(rayDir, t));
    return { point, distance: t };
  }
  
  return null;
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
  console.log('[FlatPattern] selectSheetMetalFaces - neutralFactor resolved:', neutralFactor);
  console.log('[FlatPattern]   opts:', opts);
  console.log('[FlatPattern]   solid.userData:', solid?.userData);
  console.log('[FlatPattern]   DEFAULT_NEUTRAL_FACTOR:', DEFAULT_NEUTRAL_FACTOR);
  
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

function buildPlanarFaceCoords(face, vertProps, offsetDistance = 0, offsetNormal = null) {
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

  // Use provided offset normal or computed normal
  const actualNormal = offsetNormal || normal;

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

  // Apply offset in 3D space before projecting to 2D
  const coords = new Map();
  for (const idx of verts) {
    const p = getVertex3(vertProps, idx);
    // Offset the point along the normal if offset is specified
    const offsetP = offsetDistance !== 0 
      ? add3(p, scale3(actualNormal, offsetDistance))
      : p;
    const rel = sub3(offsetP, origin);
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
  const raw = String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const maxLen = 120;
  if (raw.length <= maxLen) return raw;
  const suffix = hashString(raw).toString(36).slice(0, 8);
  const headLen = Math.max(1, maxLen - suffix.length - 1);
  return `${raw.slice(0, headLen)}_${suffix}`;
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
        
        // Coordinates are already offset in 3D space before projection
        const g = applyTransform2({ x: local.x, y: local.y }, tr);
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

function buildStepBendAnnotations(faceIds, faceData, transforms, opts = {}) {
  const centerlines = [];
  const bendEdges = [];
  if (!Array.isArray(faceIds) || !faceIds.length) return { centerlines, bendEdges };
  const identity = opts.identity || { cos: 1, sin: 0, tx: 0, ty: 0 };
  const faceMetaById = opts.faceMetaById instanceof Map ? opts.faceMetaById : null;
  const faceTypeById = opts.faceTypeById instanceof Map ? opts.faceTypeById : null;
  const insideType = opts.insideType || null;
  const thickness = Number(opts.thickness);
  const cylGroups = opts.cylGroups;
  const faceTowardA = new Map();

  const getTowardA = (faceId, face) => {
    if (faceTowardA.has(faceId)) return faceTowardA.get(faceId);
    const meta = face?.meta || (faceMetaById ? faceMetaById.get(faceId) : null);
    if (!meta || meta.type !== 'cylindrical') {
      faceTowardA.set(faceId, null);
      return null;
    }
    const faceRadius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
    const inferredInside = inferCylFaceIsInside(meta, faceRadius, cylGroups, thickness);
    let faceIsInside = inferredInside;
    if (faceIsInside == null && insideType) {
      const faceType = (faceTypeById && faceTypeById.get(faceId)) || resolveFaceType(meta);
      if (faceType) faceIsInside = faceType === insideType;
    }
    if (faceIsInside == null) {
      faceTowardA.set(faceId, null);
      return null;
    }
    const faceType = (faceTypeById && faceTypeById.get(faceId)) || resolveFaceType(meta);
    const towardA = faceType === 'B' ? !faceIsInside : faceIsInside;
    faceTowardA.set(faceId, towardA);
    return towardA;
  };

  const pushEdge = (list, pa, pb) => {
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < EPS) return;
    list.push({
      pa,
      pb,
      dx: dx / len,
      dy: dy / len,
      len,
      mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    });
  };

  const addEdgesFromPoints = (pts, list) => {
    for (let i = 1; i < pts.length; i++) {
      pushEdge(list, pts[i - 1], pts[i]);
    }
    if (pts.length > 2) {
      pushEdge(list, pts[pts.length - 1], pts[0]);
    }
  };

  for (const faceId of faceIds) {
    const face = faceData.get(faceId);
    const meta = face?.meta;
    if (!face || !meta || meta.type !== 'cylindrical') continue;
    const tr = (transforms && transforms.get(faceId)) || identity;
    const allEdges = [];
    const sharedEdges = [];
    const chains = Array.isArray(face.boundaryChains) ? face.boundaryChains : [];
    for (const chain of chains) {
      const verts = Array.isArray(chain?.verts) ? chain.verts : [];
      const pts = [];
      for (const idx of verts) {
        const local = face.coords.get(idx);
        if (!local) continue;
        const g = applyTransform2(local, tr);
        pts.push({ x: g.x, y: g.y });
      }
      if (pts.length < 2) continue;
      addEdgesFromPoints(pts, allEdges);
      const otherFaceId = Number.isFinite(chain?.otherFaceId) ? chain.otherFaceId : null;
      const otherMeta = otherFaceId != null ? faceData.get(otherFaceId)?.meta : null;
      const sharedWithPlanar = !!chain?.shared && (!otherMeta || otherMeta.type !== 'cylindrical');
      if (sharedWithPlanar) {
        addEdgesFromPoints(pts, sharedEdges);
      }
    }
    const useSharedEdges = sharedEdges.length >= 2;
    const edges2D = useSharedEdges ? sharedEdges : allEdges;
    if (edges2D.length < 2) continue;

    const boundaryPoints = [];
    for (const e of edges2D) {
      boundaryPoints.push(e.pa, e.pb);
    }

    let axisDir = null;
    let nDir = null;
    let ranges = null;
    if (useSharedEdges && edges2D.length) {
      const first = edges2D[0];
      let sumX = first.dx;
      let sumY = first.dy;
      for (let i = 1; i < edges2D.length; i++) {
        const e = edges2D[i];
        const dot = first.dx * e.dx + first.dy * e.dy;
        const sx = dot < 0 ? -e.dx : e.dx;
        const sy = dot < 0 ? -e.dy : e.dy;
        sumX += sx;
        sumY += sy;
      }
      const len = Math.hypot(sumX, sumY);
      if (len > EPS) {
        axisDir = { x: sumX / len, y: sumY / len };
        nDir = { x: -axisDir.y, y: axisDir.x };
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      const edgeAxis = computeEdgeAxis2D(edges2D);
      if (edgeAxis) {
        axisDir = edgeAxis.axisDir;
        nDir = edgeAxis.nDir;
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      const axisInfo = computePrincipalAxis2D(boundaryPoints);
      if (axisInfo) {
        axisDir = axisInfo.axisDir;
        nDir = axisInfo.nDir;
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      edges2D.sort((e1, e2) => e2.len - e1.len);
      const first = edges2D[0];
      axisDir = { x: first.dx, y: first.dy };
      if (edges2D.length > 1) {
        const second = edges2D[1];
        const dot = axisDir.x * second.dx + axisDir.y * second.dy;
        const sx = dot < 0 ? -second.dx : second.dx;
        const sy = dot < 0 ? -second.dy : second.dy;
        axisDir = { x: axisDir.x + sx, y: axisDir.y + sy };
        const len = Math.hypot(axisDir.x, axisDir.y);
        if (len > EPS) { axisDir.x /= len; axisDir.y /= len; }
      }
      nDir = { x: -axisDir.y, y: axisDir.x };
      ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
    }
    if (!ranges) continue;

    const parallelEdges = edges2D.filter(
      (e) => Math.abs(e.dx * axisDir.x + e.dy * axisDir.y) > 0.9,
    );

    if (parallelEdges.length < 2) {
      const { minOff, maxOff, minS, maxS } = ranges;
      const e0a = {
        x: axisDir.x * minS + nDir.x * minOff,
        y: axisDir.y * minS + nDir.y * minOff,
      };
      const e1a = {
        x: axisDir.x * maxS + nDir.x * minOff,
        y: axisDir.y * maxS + nDir.y * minOff,
      };
      const e0b = {
        x: axisDir.x * minS + nDir.x * maxOff,
        y: axisDir.y * minS + nDir.y * maxOff,
      };
      const e1b = {
        x: axisDir.x * maxS + nDir.x * maxOff,
        y: axisDir.y * maxS + nDir.y * maxOff,
      };
      bendEdges.push({ p0: e0a, p1: e1a, faceId });
      bendEdges.push({ p0: e0b, p1: e1b, faceId });
      const centerOff = (minOff + maxOff) * 0.5;
      const p0 = {
        x: axisDir.x * minS + nDir.x * centerOff,
        y: axisDir.y * minS + nDir.y * centerOff,
      };
      const p1 = {
        x: axisDir.x * maxS + nDir.x * centerOff,
        y: axisDir.y * maxS + nDir.y * centerOff,
      };
      centerlines.push({ p0, p1, faceId, towardA: getTowardA(faceId, face) });
      continue;
    }

    for (const e of parallelEdges) {
      bendEdges.push({ p0: e.pa, p1: e.pb, faceId });
    }

    const { minOff, maxOff, minS, maxS } = ranges;
    const centerOff = (minOff + maxOff) * 0.5;
    const p0 = {
      x: axisDir.x * minS + nDir.x * centerOff,
      y: axisDir.y * minS + nDir.y * centerOff,
    };
    const p1 = {
      x: axisDir.x * maxS + nDir.x * centerOff,
      y: axisDir.y * maxS + nDir.y * centerOff,
    };
    centerlines.push({ p0, p1, faceId, towardA: getTowardA(faceId, face) });
  }

  return { centerlines, bendEdges };
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

function createVisualizationMeshes(visualizationData, vertProps, neutralFactor, thickness) {
  const meshes = [];
  const offsetDist = neutralFactor * thickness;
  
  console.log('[FlatPattern] ========================================');
  console.log('[FlatPattern] Creating visualization meshes:');
  console.log('[FlatPattern]   neutralFactor:', neutralFactor);
  console.log('[FlatPattern]   thickness:', thickness);
  console.log('[FlatPattern]   offsetDistance (neutralFactor * thickness):', offsetDist);
  console.log('[FlatPattern]   allAFaceTrianglesCount:', visualizationData.allAFaceTriangles.length);
  console.log('[FlatPattern] ========================================');
  
  if (offsetDist === 0 || !Number.isFinite(offsetDist)) {
    console.error('[FlatPattern] ERROR: Offset distance is zero or invalid!');
    console.error('[FlatPattern]   This will result in no visible offset.');
  }
  
  // Create mesh for unified offset A faces (semi-transparent blue)
  // Build a unified mesh from all A faces, calculate vertex normals, then offset
  if (visualizationData.allAFaceTriangles.length > 0) {
    const positions = [];
    const triangles = [];
    const triangleFaceIds = [];
    
    // First, build vertex -> triangles map for the unified mesh
    const vertexTriangles = new Map();
    for (let i = 0; i < visualizationData.allAFaceTriangles.length; i++) {
      const entry = visualizationData.allAFaceTriangles[i];
      const tri = entry.tri;
      const triNormal = entry.faceNormal;
      for (const vertIdx of tri) {
        if (!vertexTriangles.has(vertIdx)) {
          vertexTriangles.set(vertIdx, []);
        }
        vertexTriangles.get(vertIdx).push({ tri, triNormal });
      }
    }
    
    // Calculate averaged normal for each vertex in the unified mesh
    const vertexNormals = new Map();
    for (const [vertIdx, triData] of vertexTriangles.entries()) {
      let avgNormal = [0, 0, 0];
      for (const { triNormal } of triData) {
        avgNormal = add3(avgNormal, triNormal);
      }
      vertexNormals.set(vertIdx, normalizeVec3(avgNormal));
    }
    
    // Now create the offset mesh using shared vertices
    const vertexMap = new Map();
    let vertexCount = 0;
    
    for (const entry of visualizationData.allAFaceTriangles) {
      const tri = entry.tri; // Extract triangle from object
      const triIndices = [];
      for (const vertIdx of tri) {
        let newIdx = vertexMap.get(vertIdx);
        if (newIdx === undefined) {
          newIdx = vertexCount;
          const v = getVertex3(vertProps, vertIdx);
          const normal = vertexNormals.get(vertIdx);
          // Offset vertex along its averaged normal from the unified mesh
          const offsetDist = -(neutralFactor * thickness);
          const offsetV = add3(v, scale3(normal, offsetDist));
          positions.push(offsetV[0], offsetV[1], offsetV[2]);
          
          // Log first few vertices for debugging
          if (vertexCount < 3) {
            const actualOffset = Math.hypot(offsetV[0] - v[0], offsetV[1] - v[1], offsetV[2] - v[2]);
            console.log(`[FlatPattern]     Vertex ${vertIdx} (unified mesh, averaged normal):`);
            console.log(`[FlatPattern]       Normal: [${normal[0].toFixed(6)}, ${normal[1].toFixed(6)}, ${normal[2].toFixed(6)}]`);
            console.log(`[FlatPattern]       Requested offset: ${offsetDist.toFixed(6)}`);
            console.log(`[FlatPattern]       Actual offset: ${actualOffset.toFixed(6)}`);
            console.log(`[FlatPattern]       Position: [${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}] → [${offsetV[0].toFixed(3)}, ${offsetV[1].toFixed(3)}, ${offsetV[2].toFixed(3)}]`);
          }
          
          vertexMap.set(vertIdx, newIdx);
          vertexCount++;
        }
        triIndices.push(newIdx);
      }
      triangles.push(triIndices);
      triangleFaceIds.push(entry.faceId);
    }
    
    if (positions.length > 0) {
      console.log(`[FlatPattern]   Created Unified Offset A Faces mesh: ${positions.length / 3} vertices, ${triangles.length} triangles (unified mesh with averaged vertex normals)`);
      meshes.push({
        name: 'Offset A Faces (Unified)',
        positions: new Float32Array(positions),
        triangles,
        triangleFaceIds,
        faceMetaById: visualizationData.faceMetaById || null,
        color: [0, 0.5, 1], // Light Blue
        opacity: 0.5,
      });
    }
  }

  if (meshes.length) {
    const flatMesh = unfoldTriangleMesh(meshes[meshes.length - 1]);
    if (flatMesh) meshes.push(flatMesh);
  }
  
  console.log(`[FlatPattern] Total visualization meshes created: ${meshes.length}`);
  return meshes;
}

function unfoldTriangleMesh(meshData) {
  if (!meshData || !meshData.positions || !meshData.triangles) return null;
  const positions = meshData.positions;
  const triangles = meshData.triangles;
  const triangleFaceIds = Array.isArray(meshData.triangleFaceIds)
    ? meshData.triangleFaceIds
    : null;
  const faceMetaById = meshData.faceMetaById || null;
  const triCount = triangles.length;
  if (!triCount) return null;

  const vertexCount = (positions.length / 3) | 0;
  const getV3 = (idx) => [
    positions[idx * 3 + 0],
    positions[idx * 3 + 1],
    positions[idx * 3 + 2],
  ];
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const cross2d = (a, b, c) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    return abx * acy - aby * acx;
  };

  const triInfo = new Array(triCount);
  const edgeMap = new Map();
  for (let i = 0; i < triCount; i++) {
    const tri = triangles[i];
    const v0 = getV3(tri[0]);
    const v1 = getV3(tri[1]);
    const v2 = getV3(tri[2]);
    const n = computeTriangleNormal(v0, v1, v2);
    const e1 = sub3(v1, v0);
    const e2 = sub3(v2, v0);
    const area = 0.5 * Math.hypot(...cross3(e1, e2));
    triInfo[i] = {
      tri,
      normal: n,
      area,
    };
    const edges = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (const [a, b] of edges) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(i);
    }
  }

  const neighbors = new Array(triCount);
  for (let i = 0; i < triCount; i++) neighbors[i] = [];
  for (const [key, tris] of edgeMap.entries()) {
    if (tris.length !== 2) continue;
    const [t0, t1] = tris;
    const [aStr, bStr] = key.split('|');
    const a = Number(aStr);
    const b = Number(bStr);
    neighbors[t0].push({ tri: t1, edge: [a, b] });
    neighbors[t1].push({ tri: t0, edge: [a, b] });
  }

  const placedVerts = new Map();
  const placedTris = new Array(triCount).fill(false);
  let globalMaxX = 0;
  let globalMinX = 0;
  const padding = 5;

  const placeSeedTriangle = (triIndex, offsetX) => {
    const tri = triInfo[triIndex].tri;
    const a = tri[0];
    const b = tri[1];
    const c = tri[2];
    const va = getV3(a);
    const vb = getV3(b);
    const vc = getV3(c);
    const dAB = dist3(va, vb);
    const dAC = dist3(va, vc);
    const dBC = dist3(vb, vc);
    if (dAB < EPS || !Number.isFinite(dAB)) return false;
    const x = (dAC * dAC - dBC * dBC + dAB * dAB) / (2 * dAB);
    const y2 = Math.max(0, dAC * dAC - x * x);
    const y = Math.sqrt(y2);
    placedVerts.set(a, { x: offsetX, y: 0 });
    placedVerts.set(b, { x: offsetX + dAB, y: 0 });
    placedVerts.set(c, { x: offsetX + x, y });
    return true;
  };

  const placeNeighbor = (currentTri, neighborInfo) => {
    const nb = neighborInfo.tri;
    const [ea, eb] = neighborInfo.edge;
    const a2d = placedVerts.get(ea);
    const b2d = placedVerts.get(eb);
    if (!a2d || !b2d) return false;
    const tri = triInfo[nb].tri;
    const third = tri[0] !== ea && tri[0] !== eb ? tri[0]
      : tri[1] !== ea && tri[1] !== eb ? tri[1]
        : tri[2];
    if (placedVerts.has(third)) return true;

    const va = getV3(ea);
    const vb = getV3(eb);
    const vc = getV3(third);
    const dAB = dist3(va, vb);
    if (dAB < EPS || !Number.isFinite(dAB)) return false;
    const dAC = dist3(va, vc);
    const dBC = dist3(vb, vc);
    const x = (dAC * dAC - dBC * dBC + dAB * dAB) / (2 * dAB);
    const y2 = Math.max(0, dAC * dAC - x * x);
    const y = Math.sqrt(y2);

    const edge2d = { x: b2d.x - a2d.x, y: b2d.y - a2d.y };
    const edgeLen2d = Math.hypot(edge2d.x, edge2d.y);
    if (edgeLen2d < EPS) return false;
    const ex = edge2d.x / edgeLen2d;
    const ey = edge2d.y / edgeLen2d;
    const px = -ey;
    const py = ex;
    const cand1 = { x: a2d.x + ex * x + px * y, y: a2d.y + ey * x + py * y };
    const cand2 = { x: a2d.x + ex * x - px * y, y: a2d.y + ey * x - py * y };

    const currentInfo = triInfo[currentTri];
    const currentTriVerts = currentInfo.tri;
    const currentThird = currentTriVerts[0] !== ea && currentTriVerts[0] !== eb ? currentTriVerts[0]
      : currentTriVerts[1] !== ea && currentTriVerts[1] !== eb ? currentTriVerts[1]
        : currentTriVerts[2];
    const currentThird2d = placedVerts.get(currentThird);
    if (!currentThird2d) return false;
    const sideCurrent2d = cross2d(a2d, b2d, currentThird2d);

    const n1 = currentInfo.normal;
    const n2 = triInfo[nb].normal;
    const e3 = normalizeVec3(sub3(vb, va));
    let v1 = cross3(e3, n1);
    let v2 = cross3(e3, n2);
    v1 = normalizeVec3(v1);
    v2 = normalizeVec3(v2);
    if (dot3(v1, sub3(getV3(currentThird), va)) < 0) v1 = scale3(v1, -1);
    if (dot3(v2, sub3(vc, va)) < 0) v2 = scale3(v2, -1);
    const sameSide = dot3(v1, v2) >= 0;
    const wantPositive = sideCurrent2d >= 0 ? sameSide : !sameSide;
    const sideCand1 = cross2d(a2d, b2d, cand1);
    const pickCand1 = wantPositive ? sideCand1 >= 0 : sideCand1 < 0;
    placedVerts.set(third, pickCand1 ? cand1 : cand2);
    return true;
  };

  const triIndices = triInfo
    .map((info, idx) => ({ idx, area: info.area }))
    .sort((a, b) => b.area - a.area);

  for (const { idx } of triIndices) {
    if (placedTris[idx]) continue;
    const offsetX = placedVerts.size ? globalMaxX + padding : 0;
    if (!placeSeedTriangle(idx, offsetX)) {
      placedTris[idx] = true;
      continue;
    }
    placedTris[idx] = true;
    const queue = [idx];
    while (queue.length) {
      const current = queue.shift();
      for (const nb of neighbors[current]) {
        if (placedTris[nb.tri]) continue;
        if (placeNeighbor(current, nb)) {
          placedTris[nb.tri] = true;
          queue.push(nb.tri);
        }
      }
    }

    for (const { x } of placedVerts.values()) {
      globalMinX = Math.min(globalMinX, x);
      globalMaxX = Math.max(globalMaxX, x);
    }
  }

  const flatPositions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const p2d = placedVerts.get(i);
    if (!p2d) continue;
    flatPositions[i * 3 + 0] = p2d.x;
    flatPositions[i * 3 + 1] = p2d.y;
    flatPositions[i * 3 + 2] = 0;
  }

  const edgeSegments = triangleFaceIds
    ? buildUnfoldedEdgeSegments(triangles, triangleFaceIds)
    : null;

  return {
    name: 'Flat A Faces (Triangle Unfold)',
    positions: flatPositions,
    triangles,
    triangleFaceIds: triangleFaceIds ? triangleFaceIds.slice() : undefined,
    faceMetaById,
    edgeSegments,
    color: [1, 0.6, 0.1],
    opacity: 0.7,
  };
}

function buildUnfoldedEdgeSegments(triangles, triangleFaceIds) {
  if (!Array.isArray(triangles) || !Array.isArray(triangleFaceIds)) return null;
  if (triangles.length !== triangleFaceIds.length) return null;
  const edgeMap = new Map();
  const addEdge = (a, b, faceId) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { a, b, faces: [] };
      edgeMap.set(key, entry);
    }
    entry.faces.push(faceId);
  };
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const faceId = triangleFaceIds[i];
    addEdge(tri[0], tri[1], faceId);
    addEdge(tri[1], tri[2], faceId);
    addEdge(tri[2], tri[0], faceId);
  }

  const outerEdges = [];
  const innerEdges = [];
  for (const entry of edgeMap.values()) {
    if (entry.faces.size === 1) outerEdges.push([entry.a, entry.b]);
    else if (entry.faces.size > 1) innerEdges.push([entry.a, entry.b]);
  }
  return { outerEdges, innerEdges };
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
      faceTypeById,
      faceMetaById,
      thickness,
      neutralFactor,
    } = selection;

    const faceTriangles = collectFaceTriangles(triVerts, faceIDs, includeSet, vertProps);
    if (!faceTriangles.size) return null;

    const visualizationData = {
      allAFaceTriangles: [],
      faceMetaById,
    };

    for (const [faceId, face] of faceTriangles.entries()) {
      const faceType = faceTypeById.get(faceId) || null;
      if (faceType !== 'A') continue;
      for (const tri of face.triangles) {
        const v0 = getVertex3(vertProps, tri[0]);
        const v1 = getVertex3(vertProps, tri[1]);
        const v2 = getVertex3(vertProps, tri[2]);
        const triNormal = computeTriangleNormal(v0, v1, v2);
        visualizationData.allAFaceTriangles.push({ tri, faceId, faceNormal: triNormal });
      }
    }

    if (!visualizationData.allAFaceTriangles.length) return null;

    const visualizationMeshes = createVisualizationMeshes(
      visualizationData,
      vertProps,
      neutralFactor,
      thickness
    );
    if (!visualizationMeshes || !visualizationMeshes.length) return null;

    return {
      visualizationMeshes,
      thickness,
      delete() {},
      isVisualizationOnly: true,
    };
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
  const flat = buildFlatPatternMeshTriangulated(solid, opts);
  const viz = buildFlatPatternMeshByFaces(solid, opts);
  if (flat) {
    if (viz?.visualizationMeshes) flat.visualizationMeshes = viz.visualizationMeshes;
    return flat;
  }
  return viz;
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

function computePrincipalAxis2D(points) {
  if (!points || points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (!Number.isFinite(sxx) || !Number.isFinite(syy) || !Number.isFinite(sxy)) return null;
  if (sxx + syy <= EPS) return null;
  let angle = 0;
  if (Math.abs(sxy) > EPS || Math.abs(sxx - syy) > EPS) {
    angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  } else if (syy > sxx) {
    angle = Math.PI / 2;
  }
  const axisDir = { x: Math.cos(angle), y: Math.sin(angle) };
  const nDir = { x: -axisDir.y, y: axisDir.x };
  return { axisDir, nDir };
}

function computeEdgeAxis2D(edges) {
  if (!edges || edges.length < 2) return null;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const e of edges) {
    const w = Number.isFinite(e.len) ? e.len : 0;
    sxx += w * e.dx * e.dx;
    syy += w * e.dy * e.dy;
    sxy += w * e.dx * e.dy;
  }
  if (!Number.isFinite(sxx) || !Number.isFinite(syy) || !Number.isFinite(sxy)) return null;
  if (sxx + syy <= EPS) return null;
  let angle = 0;
  if (Math.abs(sxy) > EPS || Math.abs(sxx - syy) > EPS) {
    angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  } else if (syy > sxx) {
    angle = Math.PI / 2;
  }
  const axisDir = { x: Math.cos(angle), y: Math.sin(angle) };
  const nDir = { x: -axisDir.y, y: axisDir.x };
  return { axisDir, nDir };
}

function computeAxisRanges(points, axisDir, nDir) {
  if (!points || !points.length) return null;
  let minOff = Infinity;
  let maxOff = -Infinity;
  let minS = Infinity;
  let maxS = -Infinity;
  for (const p of points) {
    const off = p.x * nDir.x + p.y * nDir.y;
    const s = p.x * axisDir.x + p.y * axisDir.y;
    if (off < minOff) minOff = off;
    if (off > maxOff) maxOff = off;
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
  }
  if (!Number.isFinite(minOff) || !Number.isFinite(maxOff)) return null;
  if (!Number.isFinite(minS) || !Number.isFinite(maxS)) return null;
  return { minOff, maxOff, minS, maxS };
}

function buildBendAnnotations2D(flatMesh) {
  if (!flatMesh || !flatMesh.vertProperties || !flatMesh.triVerts) {
    return { centerlines: [], bendEdges: [] };
  }
  if (flatMesh.bendAnnotations && (flatMesh.bendAnnotations.centerlines || flatMesh.bendAnnotations.bendEdges)) {
    const centerlines = Array.isArray(flatMesh.bendAnnotations.centerlines)
      ? flatMesh.bendAnnotations.centerlines
      : [];
    const bendEdges = Array.isArray(flatMesh.bendAnnotations.bendEdges)
      ? flatMesh.bendAnnotations.bendEdges
      : [];
    return { centerlines, bendEdges };
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
  const edgeToFaces = new Map();
  const addEdgeFace = (a, b, faceId) => {
    const key = edgeKey(a, b);
    let set = edgeToFaces.get(key);
    if (!set) { set = new Set(); edgeToFaces.set(key, set); }
    set.add(faceId);
  };
  for (let i = 0; i < triFaces.length; i++) {
    const faceId = triFaces[i];
    const base = i * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    addEdgeFace(a, b, faceId);
    addEdgeFace(b, c, faceId);
    addEdgeFace(c, a, faceId);
  }
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

    const sharedBoundaryEdges = [];
    for (const [a, b] of boundaryEdges) {
      const faces = edgeToFaces.get(edgeKey(a, b));
      if (!faces || faces.size < 2) continue;
      let shared = false;
      for (const fid of faces) {
        if (fid === faceId) continue;
        const otherMeta = faceMetaById.get(fid);
        if (!otherMeta || otherMeta.type !== 'cylindrical') { shared = true; break; }
      }
      if (shared) sharedBoundaryEdges.push([a, b]);
    }

    const useSharedEdges = sharedBoundaryEdges.length >= 2;
    const activeEdges = useSharedEdges ? sharedBoundaryEdges : boundaryEdges;
    const edges2D = [];
    for (const [a, b] of activeEdges) {
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

    const boundaryPoints = [];
    for (const e of edges2D) {
      boundaryPoints.push(e.pa, e.pb);
    }

    let axisDir = null;
    let nDir = null;
    let ranges = null;
    if (useSharedEdges && edges2D.length) {
      const first = edges2D[0];
      let sumX = first.dx;
      let sumY = first.dy;
      for (let i = 1; i < edges2D.length; i++) {
        const e = edges2D[i];
        const dot = first.dx * e.dx + first.dy * e.dy;
        const sx = dot < 0 ? -e.dx : e.dx;
        const sy = dot < 0 ? -e.dy : e.dy;
        sumX += sx;
        sumY += sy;
      }
      const len = Math.hypot(sumX, sumY);
      if (len > EPS) {
        axisDir = { x: sumX / len, y: sumY / len };
        nDir = { x: -axisDir.y, y: axisDir.x };
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      const edgeAxis = computeEdgeAxis2D(edges2D);
      if (edgeAxis) {
        axisDir = edgeAxis.axisDir;
        nDir = edgeAxis.nDir;
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      const axisInfo = computePrincipalAxis2D(boundaryPoints);
      if (axisInfo) {
        axisDir = axisInfo.axisDir;
        nDir = axisInfo.nDir;
        ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
      }
    }
    if (!ranges) {
      edges2D.sort((e1, e2) => e2.len - e1.len);
      const first = edges2D[0];
      axisDir = { x: first.dx, y: first.dy };
      if (edges2D.length > 1) {
        const second = edges2D[1];
        const dot = axisDir.x * second.dx + axisDir.y * second.dy;
        const sx = dot < 0 ? -second.dx : second.dx;
        const sy = dot < 0 ? -second.dy : second.dy;
        axisDir = { x: axisDir.x + sx, y: axisDir.y + sy };
        const len = Math.hypot(axisDir.x, axisDir.y);
        if (len > EPS) { axisDir.x /= len; axisDir.y /= len; }
      }
      nDir = { x: -axisDir.y, y: axisDir.x };
      ranges = computeAxisRanges(boundaryPoints, axisDir, nDir);
    }
    if (!ranges) continue;

    const parallelEdges = edges2D.filter(
      (e) => Math.abs(e.dx * axisDir.x + e.dy * axisDir.y) > 0.9,
    );

    if (parallelEdges.length < 2) {
      const { minOff, maxOff, minS, maxS } = ranges;
      const e0a = {
        x: axisDir.x * minS + nDir.x * minOff,
        y: axisDir.y * minS + nDir.y * minOff,
      };
      const e1a = {
        x: axisDir.x * maxS + nDir.x * minOff,
        y: axisDir.y * maxS + nDir.y * minOff,
      };
      const e0b = {
        x: axisDir.x * minS + nDir.x * maxOff,
        y: axisDir.y * minS + nDir.y * maxOff,
      };
      const e1b = {
        x: axisDir.x * maxS + nDir.x * maxOff,
        y: axisDir.y * maxS + nDir.y * maxOff,
      };
      bendEdges.push({ p0: e0a, p1: e1a, faceId });
      bendEdges.push({ p0: e0b, p1: e1b, faceId });
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
      continue;
    }

    for (const e of parallelEdges) {
      bendEdges.push({ p0: e.pa, p1: e.pb, faceId });
    }

    const { minOff, maxOff, minS, maxS } = ranges;
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
  const unfolded = extractUnfoldedEdges(flatMesh) || extractTriangulatedEdges(flatMesh);
  if (unfolded) {
    const { positions, outerEdges, innerEdges, centerlines } = unfolded;
    const allEdges = outerEdges.concat(innerEdges);
    if (!allEdges.length) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [a, b] of allEdges) {
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      minX = Math.min(minX, ax, bx);
      maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
    }
    for (const line of centerlines || []) {
      minX = Math.min(minX, line.start.x, line.end.x);
      maxX = Math.max(maxX, line.start.x, line.end.x);
      minY = Math.min(minY, line.start.y, line.end.y);
      maxY = Math.max(maxY, line.start.y, line.end.y);
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

    const buildLines = (edges) => edges.map(([a, b]) => {
      const ax = positions[a * 3 + 0] - minX + pad;
      const ay = height - (positions[a * 3 + 1] - minY) + pad;
      const bx = positions[b * 3 + 0] - minX + pad;
      const by = height - (positions[b * 3 + 1] - minY) + pad;
      return `M ${fmt(ax)} ${fmt(ay)} L ${fmt(bx)} ${fmt(by)}`;
    });

    const outerParts = buildLines(outerEdges);
    const innerParts = buildLines(innerEdges);
    const centerParts = (centerlines || []).map((line) => {
      const ax = line.start.x - minX + pad;
      const ay = height - (line.start.y - minY) + pad;
      const bx = line.end.x - minX + pad;
      const by = height - (line.end.y - minY) + pad;
      return `M ${fmt(ax)} ${fmt(ay)} L ${fmt(bx)} ${fmt(by)}`;
    });

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(viewWidth)}mm" height="${fmt(viewHeight)}mm" viewBox="0 0 ${fmt(viewWidth)} ${fmt(viewHeight)}">`);
    lines.push(`  <title>${xmlEsc(name || 'Flat Pattern')}</title>`);
    if (outerParts.length) {
      lines.push(`  <g fill="none" stroke="#ff5fa2" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round">`);
      for (const d of outerParts) lines.push(`    <path d="${d}"/>`);
      lines.push('  </g>');
    }
    if (innerParts.length) {
      lines.push(`  <g fill="none" stroke="#00ffff" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round">`);
      for (const d of innerParts) lines.push(`    <path d="${d}"/>`);
      lines.push('  </g>');
    }
    if (centerParts.length) {
      lines.push(`  <g fill="none" stroke="#00ffff" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round">`);
      for (const d of centerParts) lines.push(`    <path d="${d}"/>`);
      lines.push('  </g>');
    }
    lines.push('</svg>');
    return { svg: lines.join('\n'), width: viewWidth, height: viewHeight };
  }
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

function buildDxfForFlatMesh(flatMesh, name = 'FLAT') {
  if (!flatMesh || !flatMesh.vertProperties || !flatMesh.triVerts) return null;
  const unfolded = extractUnfoldedEdges(flatMesh) || extractTriangulatedEdges(flatMesh);
  if (unfolded) {
    const { positions, outerEdges, innerEdges, centerlines } = unfolded;
    const allEdges = outerEdges.concat(innerEdges);
    if (!allEdges.length) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [a, b] of allEdges) {
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      minX = Math.min(minX, ax, bx);
      maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
    }
    for (const line of centerlines || []) {
      minX = Math.min(minX, line.start.x, line.end.x);
      maxX = Math.max(maxX, line.start.x, line.end.x);
      minY = Math.min(minY, line.start.y, line.end.y);
      maxY = Math.max(maxY, line.start.y, line.end.y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const pad = Math.max(1, Math.min(width, height) * 0.05);
    const viewWidth = width + pad * 2;
    const viewHeight = height + pad * 2;

    const toPoint = (x, y) => ({ x: x - minX + pad, y: y - minY + pad });
    const dxf = new DxfWriter();
    dxf.setUnits(Units.Millimeters);
    const cutLayer = 'CUT';
    const innerLayer = 'FACE_EDGE';
    const centerLayer = 'BEND_CENTER';
    dxf.addLayer(cutLayer, Colors.Magenta, LineTypes.Continuous);
    dxf.addLayer(innerLayer, Colors.White, LineTypes.Continuous);
    dxf.addLayer(centerLayer, Colors.Cyan, LineTypes.Continuous);
    const addLine = (p0, p1) => {
      dxf.addLine(point3d(p0.x, p0.y, 0), point3d(p1.x, p1.y, 0));
    };

    dxf.setCurrentLayerName(cutLayer);
    for (const [a, b] of outerEdges) {
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      addLine(toPoint(ax, ay), toPoint(bx, by));
    }
    if (innerEdges.length) {
      dxf.setCurrentLayerName(innerLayer);
      for (const [a, b] of innerEdges) {
        const ax = positions[a * 3 + 0];
        const ay = positions[a * 3 + 1];
        const bx = positions[b * 3 + 0];
        const by = positions[b * 3 + 1];
        addLine(toPoint(ax, ay), toPoint(bx, by));
      }
    }
    if (centerlines && centerlines.length) {
      dxf.setCurrentLayerName(centerLayer);
      for (const line of centerlines) {
        addLine(toPoint(line.start.x, line.start.y), toPoint(line.end.x, line.end.y));
      }
    }
    return { dxf: dxf.stringify(), width: viewWidth, height: viewHeight, name };
  }
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
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const pad = Math.max(1, Math.min(width, height) * 0.05);
  const viewWidth = width + pad * 2;
  const viewHeight = height + pad * 2;

  const toPoint = (x, y) => {
    const p = rotatePoint(x, y);
    return { x: p.x - minX + pad, y: p.y - minY + pad };
  };

  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);

  const dashedType = 'DASHED';
  const centerType = 'CENTER';
  dxf.addLType(dashedType, 'Dashed', [3, -1.5]);
  dxf.addLType(centerType, 'Center', [2, -0.5, 0.5, -0.5]);

  const cutLayer = 'CUT';
  const bendLayer = 'BEND_EDGE';
  const centerTowardLayer = 'BEND_CTR_TOWARD_A';
  const centerAwayLayer = 'BEND_CTR_AWAY_A';
  const centerUnknownLayer = 'BEND_CTR';

  dxf.addLayer(cutLayer, Colors.Black, LineTypes.Continuous);
  dxf.addLayer(bendLayer, Colors.Blue, dashedType);
  dxf.addLayer(centerTowardLayer, Colors.Green, centerType);
  dxf.addLayer(centerAwayLayer, Colors.Red, centerType);
  dxf.addLayer(centerUnknownLayer, Colors.Green, centerType);

  const addLine = (p0, p1) => {
    dxf.addLine(point3d(p0.x, p0.y, 0), point3d(p1.x, p1.y, 0));
  };

  dxf.setCurrentLayerName(cutLayer);
  for (const loop of loops) {
    if (!loop || loop.length < 2) continue;
    const pts = loop[0] === loop[loop.length - 1] ? loop.slice(0, -1) : loop;
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      addLine(toPoint(ax, ay), toPoint(bx, by));
    }
  }

  if (bendEdges.length) {
    dxf.setCurrentLayerName(bendLayer);
    for (const edge of bendEdges) {
      addLine(toPoint(edge.p0.x, edge.p0.y), toPoint(edge.p1.x, edge.p1.y));
    }
  }

  if (centerlines.length) {
    const towardLines = [];
    const awayLines = [];
    const unknownLines = [];
    for (const line of centerlines) {
      if (line.towardA === true) towardLines.push(line);
      else if (line.towardA === false) awayLines.push(line);
      else unknownLines.push(line);
    }
    if (towardLines.length) {
      dxf.setCurrentLayerName(centerTowardLayer);
      for (const line of towardLines) {
        addLine(toPoint(line.p0.x, line.p0.y), toPoint(line.p1.x, line.p1.y));
      }
    }
    if (awayLines.length) {
      dxf.setCurrentLayerName(centerAwayLayer);
      for (const line of awayLines) {
        addLine(toPoint(line.p0.x, line.p0.y), toPoint(line.p1.x, line.p1.y));
      }
    }
    if (unknownLines.length) {
      dxf.setCurrentLayerName(centerUnknownLayer);
      for (const line of unknownLines) {
        addLine(toPoint(line.p0.x, line.p0.y), toPoint(line.p1.x, line.p1.y));
      }
    }
  }

  return { dxf: dxf.stringify(), width: viewWidth, height: viewHeight, name };
}

function extractUnfoldedEdges(flatMesh) {
  const meshes = Array.isArray(flatMesh?.visualizationMeshes) ? flatMesh.visualizationMeshes : [];
  const unfolded = meshes.find((m) => m?.name === 'Flat A Faces (Triangle Unfold)') || null;
  if (!unfolded || !unfolded.positions) return null;
  const positions = unfolded.positions;
  const lines = buildUnfoldedChildLines(unfolded);
  if (!lines) return null;
  const outerEdges = Array.isArray(lines.outerEdges) ? lines.outerEdges : [];
  const innerEdges = Array.isArray(lines.innerEdges) ? lines.innerEdges : [];
  const centerlines = Array.isArray(lines.centerlines) ? lines.centerlines : [];
  if (!outerEdges.length && !innerEdges.length && !centerlines.length) return null;

  return { positions, outerEdges, innerEdges, centerlines };
}

function extractTriangulatedEdges(flatMesh) {
  if (!flatMesh?.vertProperties || !flatMesh?.triVerts) return null;
  const faceIds = Array.isArray(flatMesh.triFaces) ? flatMesh.triFaces : null;
  const triVerts = flatMesh.triVerts;
  const triCount = (triVerts.length / 3) | 0;
  if (!faceIds || faceIds.length !== triCount) return null;
  const triangles = new Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    triangles[i] = [triVerts[base + 0], triVerts[base + 1], triVerts[base + 2]];
  }
  const lines = buildUnfoldedChildLines({
    positions: flatMesh.vertProperties,
    triangles,
    triangleFaceIds: faceIds,
    faceMetaById: flatMesh.faceMetaById || null,
  });
  if (!lines) return null;
  const outerEdges = Array.isArray(lines.outerEdges) ? lines.outerEdges : [];
  const innerEdges = Array.isArray(lines.innerEdges) ? lines.innerEdges : [];
  const centerlines = Array.isArray(lines.centerlines) ? lines.centerlines : [];
  if (!outerEdges.length && !innerEdges.length && !centerlines.length) return null;
  return {
    positions: flatMesh.vertProperties,
    outerEdges,
    innerEdges,
    centerlines,
  };
}

function buildUnfoldedChildLines(unfolded) {
  if (!unfolded || !unfolded.positions || !unfolded.triangles) return null;
  const positions = unfolded.positions;
  const triangles = unfolded.triangles;
  const faceIds = Array.isArray(unfolded.triangleFaceIds) ? unfolded.triangleFaceIds : null;
  if (!faceIds || faceIds.length !== triangles.length) return null;

  const pos2d = (idx) => ({
    x: positions[idx * 3 + 0],
    y: positions[idx * 3 + 1],
  });
  const isColinear = (a, b, c) => {
    const pa = pos2d(a);
    const pb = pos2d(b);
    const pc = pos2d(c);
    const v1x = pa.x - pb.x;
    const v1y = pa.y - pb.y;
    const v2x = pc.x - pb.x;
    const v2y = pc.y - pb.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-9 || len2 < 1e-9) return false;
    const cross = v1x * v2y - v1y * v2x;
    return Math.abs(cross) <= 1e-6 * len1 * len2;
  };
  const mergeColinearEdges = (segments) => {
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const adj = new Map();
    const unvisited = new Set();
    for (const [a, b] of segments) {
      const key = edgeKey(a, b);
      unvisited.add(key);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
    const hasEdge = (a, b) => unvisited.has(edgeKey(a, b));
    const takeEdge = (a, b) => unvisited.delete(edgeKey(a, b));
    const merged = [];
    while (unvisited.size) {
      const key = unvisited.values().next().value;
      const [aStr, bStr] = key.split('|');
      const a = Number(aStr);
      const b = Number(bStr);
      takeEdge(a, b);
      let start = a;
      let end = b;
      const startNeighbor = b;
      let prev = start;
      let curr = end;
      while (true) {
        const nbrs = (adj.get(curr) || []).filter((n) => n !== prev);
        if (nbrs.length !== 1) break;
        const next = nbrs[0];
        if (!hasEdge(curr, next)) break;
        if (!isColinear(prev, curr, next)) break;
        takeEdge(curr, next);
        prev = curr;
        curr = next;
        end = curr;
      }
      prev = startNeighbor;
      curr = start;
      while (true) {
        const nbrs = (adj.get(curr) || []).filter((n) => n !== prev);
        if (nbrs.length !== 1) break;
        const next = nbrs[0];
        if (!hasEdge(curr, next)) break;
        if (!isColinear(prev, curr, next)) break;
        takeEdge(curr, next);
        prev = curr;
        curr = next;
        start = curr;
      }
      merged.push([start, end]);
    }
    return merged;
  };

  const edgeMap = new Map();
  const addEdge = (a, b, faceId) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { a, b, faces: [] };
      edgeMap.set(key, entry);
    }
    entry.faces.push(faceId);
  };
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const faceId = faceIds[i];
    addEdge(tri[0], tri[1], faceId);
    addEdge(tri[1], tri[2], faceId);
    addEdge(tri[2], tri[0], faceId);
  }

  const pinkSegments = [];
  const whiteSegments = [];
  const bendEdgeMap = new Map();
  const faceMetaById = unfolded.faceMetaById || null;
  const isCylFace = (faceId) => {
    if (!faceMetaById) return false;
    if (faceMetaById instanceof Map) {
      return faceMetaById.get(faceId)?.type === 'cylindrical';
    }
    return faceMetaById[faceId]?.type === 'cylindrical';
  };
  for (const entry of edgeMap.values()) {
    const faces = entry.faces;
    const faceSet = new Set(faces);
    // Match visualization edge logic: only keep edges used by a single triangle,
    // or shared between different faces (ignore same-face triangulation edges).
    if (faces.length === 1) {
      pinkSegments.push([entry.a, entry.b]);
    } else if (faceSet.size > 1) {
      whiteSegments.push([entry.a, entry.b]);
      for (const faceId of faceSet) {
        if (!isCylFace(faceId)) continue;
        if (!bendEdgeMap.has(faceId)) bendEdgeMap.set(faceId, []);
        bendEdgeMap.get(faceId).push([entry.a, entry.b]);
      }
    }
  }

  const faceCentroids = new Map();
  const faceVertexCounts = new Map();
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const faceId = faceIds[i];
    for (let k = 0; k < 3; k++) {
      const vIdx = tri[k];
      const p = pos2d(vIdx);
      const acc = faceCentroids.get(faceId) || { x: 0, y: 0 };
      acc.x += p.x;
      acc.y += p.y;
      faceCentroids.set(faceId, acc);
      faceVertexCounts.set(faceId, (faceVertexCounts.get(faceId) || 0) + 1);
    }
  }
  for (const [faceId, acc] of faceCentroids.entries()) {
    const count = faceVertexCounts.get(faceId) || 1;
    acc.x /= count;
    acc.y /= count;
  }

  const buildCenterline = (edges, faceId) => {
    if (!edges || edges.length < 2) return null;
    const merged = mergeColinearEdges(edges);
    if (merged.length < 2) return null;
    const centroid = faceCentroids.get(faceId);
    if (!centroid) return null;
    const edgeDir = (a, b) => {
      const pa = pos2d(a);
      const pb = pos2d(b);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      return { x: dx / len, y: dy / len };
    };
    const baseDir = edgeDir(merged[0][0], merged[0][1]);
    if (!baseDir) return null;
    const perp = { x: -baseDir.y, y: baseDir.x };
    const groupA = [];
    const groupB = [];
    for (const [a, b] of merged) {
      const dir = edgeDir(a, b);
      if (!dir) continue;
      const dot = dir.x * baseDir.x + dir.y * baseDir.y;
      if (Math.abs(dot) < 0.98) continue;
      const pa = pos2d(a);
      const cross = (baseDir.x * (centroid.y - pa.y)) - (baseDir.y * (centroid.x - pa.x));
      if (cross >= 0) groupA.push([a, b]);
      else groupB.push([a, b]);
    }
    if (!groupA.length || !groupB.length) return null;
    const buildLine = (group) => {
      let minT = Infinity;
      let maxT = -Infinity;
      let offSum = 0;
      let offCount = 0;
      for (const [a, b] of group) {
        const pa = pos2d(a);
        const pb = pos2d(b);
        const ta = pa.x * baseDir.x + pa.y * baseDir.y;
        const tb = pb.x * baseDir.x + pb.y * baseDir.y;
        minT = Math.min(minT, ta, tb);
        maxT = Math.max(maxT, ta, tb);
        offSum += pa.x * perp.x + pa.y * perp.y;
        offSum += pb.x * perp.x + pb.y * perp.y;
        offCount += 2;
      }
      return {
        minT,
        maxT,
        off: offSum / offCount,
      };
    };
    const lineA = buildLine(groupA);
    const lineB = buildLine(groupB);
    if (!lineA || !lineB) return null;
    const minT = Math.min(lineA.minT, lineB.minT);
    const maxT = Math.max(lineA.maxT, lineB.maxT);
    const midOff = (lineA.off + lineB.off) * 0.5;
    const start = {
      x: baseDir.x * minT + perp.x * midOff,
      y: baseDir.y * minT + perp.y * midOff,
    };
    const end = {
      x: baseDir.x * maxT + perp.x * midOff,
      y: baseDir.y * maxT + perp.y * midOff,
    };
    return { start, end };
  };

  const centerlines = [];
  for (const [faceId, edges] of bendEdgeMap.entries()) {
    const lineInfo = buildCenterline(edges, faceId);
    if (!lineInfo) continue;
    centerlines.push(lineInfo);
  }

  return {
    outerEdges: mergeColinearEdges(pinkSegments),
    innerEdges: mergeColinearEdges(whiteSegments),
    centerlines,
  };
}

export function buildSheetMetalFlatPatternSolids(solids, opts = {}) {
  const out = [];
  const list = Array.isArray(solids) ? solids : [];
  for (const solid of list) {
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const flatMesh = buildFlatPatternMeshTriangulated(solid, opts);
    if (!flatMesh || flatMesh.isVisualizationOnly) continue;
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    out.push({
      name: `${baseName}_FLAT`,
      getMesh: () => flatMesh,
    });
  }
  return out;
}

export function buildSheetMetalFlatPatternDxfs(solids, opts = {}) {
  const entries = [];
  const list = Array.isArray(solids) ? solids : [];
  for (const solid of list) {
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const flatMesh = buildFlatPatternMesh(solid, opts);
    if (!flatMesh || flatMesh.isVisualizationOnly) continue;
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    const dxfInfo = buildDxfForFlatMesh(flatMesh, `${baseName} Flat Pattern`);
    if (!dxfInfo || !dxfInfo.dxf) continue;
    entries.push({ name: baseName, dxf: dxfInfo.dxf, width: dxfInfo.width, height: dxfInfo.height });
  }
  return entries;
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
    if (!flatMesh) continue;
    const debugSteps = Array.isArray(flatMesh.debugSteps) ? flatMesh.debugSteps : [];
    if (debugSteps.length) assignDebugPathColors(debugSteps);
    const baseName = String(solid.name || 'SHEET').trim() || 'SHEET';
    entries.push({
      name: baseName,
      debugSteps,
      visualizationMeshes: flatMesh.visualizationMeshes || [],
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
    if (!flatMesh || flatMesh.isVisualizationOnly) continue;
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

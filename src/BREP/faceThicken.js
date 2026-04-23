import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { Solid } from './BetterSolid.js';
import { Manifold, ManifoldMesh, THREE } from './SolidShared.js';
import { manifold } from './setupManifold.js';

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

function triangleCentroid(a, b, c) {
  return new THREE.Vector3(
    (a.x + b.x + c.x) / 3,
    (a.y + b.y + c.y) / 3,
    (a.z + b.z + c.z) / 3,
  );
}

function pointTriangleDistanceSquared(point, a, b, c) {
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
    const proj = a.clone().add(ab.multiplyScalar(v));
    return point.distanceToSquared(proj);
  }

  const cp = new THREE.Vector3().subVectors(point, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return point.distanceToSquared(c);

  const vb = (d5 * d2) - (d1 * d6);
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const proj = a.clone().add(ac.multiplyScalar(w));
    return point.distanceToSquared(proj);
  }

  const va = (d3 * d6) - (d5 * d4);
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const bc = new THREE.Vector3().subVectors(c, b);
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const proj = b.clone().add(bc.multiplyScalar(w));
    return point.distanceToSquared(proj);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const proj = a.clone()
    .add(ab.multiplyScalar(v))
    .add(ac.multiplyScalar(w));
  return point.distanceToSquared(proj);
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0 };
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
  return { boundaryEdgeCount, nonManifoldEdgeCount };
}

function buildReferenceGroup(label, triangles, kind, metadata = {}) {
  const prepared = [];
  for (const tri of triangles) {
    if (!tri?.a || !tri?.b || !tri?.c) continue;
    const normal = triangleNormal(tri.a, tri.b, tri.c);
    const area = normal.length() * 0.5;
    if (!(area > TRI_EPS)) continue;
    prepared.push({
      a: tri.a,
      b: tri.b,
      c: tri.c,
      normal: normal.normalize(),
      centroid: triangleCentroid(tri.a, tri.b, tri.c),
    });
  }
  return { label, kind, metadata, triangles: prepared };
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

  const vertices = canonicalAcc.map((entry) => entry.point.multiplyScalar(1 / entry.count));
  const vertexKeys = canonicalAcc.map((entry) => entry.key);
  const triangles = [];
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
    triangles.push([a, b, c]);
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
  const flipTriangle = (tri) => [tri[0], tri[2], tri[1]];

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

  const boundaryEdgeToLoop = new Map();
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
    const loop = loops[loopIndex];
    for (const edge of loop.edges) {
      boundaryEdgeToLoop.set(edge.key, loopIndex);
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
    scale,
    weldTolerance,
  };
}

function buildThickenClassificationState(labels, distance) {
  const groups = [
    {
      label: labels.source,
      kind: 'source',
      metadata: {
        type: 'thicken_source',
        sourceFaceName: labels.sourceFaceName,
        distance,
      },
    },
    {
      label: labels.offset,
      kind: 'offset',
      metadata: {
        type: 'thicken_offset',
        sourceFaceName: labels.sourceFaceName,
        distance,
      },
    },
    ...labels.rims.map((label, loopIndex) => ({
      label,
      kind: 'rim',
      metadata: {
        type: 'thicken_rim',
        sourceFaceName: labels.sourceFaceName,
        loopIndex,
        distance,
      },
    })),
  ];

  const faceNameToID = new Map();
  const idToFaceName = new Map();
  const faceMetadataJson = [];
  let nextID = 1;
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
  };
}

function buildClassificationFromPropagatedFaceIDs(mesh, classificationState) {
  const triVerts = Array.from(mesh?.triVerts ?? []);
  const triCount = (triVerts.length / 3) | 0;
  const triIDs = Array.from(mesh?.faceID ?? [], (rawID) => Number(rawID) >>> 0);
  if (!triCount || triIDs.length !== triCount) return null;

  const idToFaceName = classificationState?.idToFaceName instanceof Map
    ? classificationState.idToFaceName
    : new Map();
  for (const id of triIDs) {
    if (!idToFaceName.has(id)) return null;
  }

  return {
    triIDs,
    faceNameToID: classificationState?.faceNameToID instanceof Map
      ? classificationState.faceNameToID
      : new Map(),
    idToFaceName,
    faceMetadataJson: Array.from(classificationState?.faceMetadataJson || []),
    groups: Array.isArray(classificationState?.groups) ? classificationState.groups : [],
    method: 'propagated_face_ids',
  };
}

function buildPrismManifold(p0, p1, p2, q0, q1, q2, distance, faceIDs = {}) {
  const from = distance >= 0
    ? [p0, p1, p2]
    : [q0, q1, q2];
  const to = distance >= 0
    ? [q0, q1, q2]
    : [p0, p1, p2];

  const verts = [
    from[0], from[1], from[2],
    to[0], to[1], to[2],
  ];
  const vertProperties = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    vertProperties[(i * 3) + 0] = verts[i].x;
    vertProperties[(i * 3) + 1] = verts[i].y;
    vertProperties[(i * 3) + 2] = verts[i].z;
  }
  const triVerts = new Uint32Array([
    0, 2, 1,
    3, 4, 5,
    0, 1, 4,
    0, 4, 3,
    1, 2, 5,
    1, 5, 4,
    2, 0, 3,
    2, 3, 5,
  ]);
  const sourceFaceID = Number(faceIDs?.sourceFaceID) >>> 0;
  const offsetFaceID = Number(faceIDs?.offsetFaceID) >>> 0;
  const defaultInternalSideFaceID = Number.isFinite(Number(faceIDs?.internalSideFaceID))
    ? (Number(faceIDs.internalSideFaceID) >>> 0)
    : (sourceFaceID || offsetFaceID || 1);
  const sideFaceIDs = Array.isArray(faceIDs?.sideFaceIDs) ? faceIDs.sideFaceIDs : [];
  const capA = distance >= 0 ? (sourceFaceID || 1) : (offsetFaceID || 1);
  const capB = distance >= 0 ? (offsetFaceID || capA) : (sourceFaceID || capA);
  const side0 = Number.isFinite(Number(sideFaceIDs[0]))
    ? (Number(sideFaceIDs[0]) >>> 0)
    : defaultInternalSideFaceID;
  const side1 = Number.isFinite(Number(sideFaceIDs[1]))
    ? (Number(sideFaceIDs[1]) >>> 0)
    : defaultInternalSideFaceID;
  const side2 = Number.isFinite(Number(sideFaceIDs[2]))
    ? (Number(sideFaceIDs[2]) >>> 0)
    : defaultInternalSideFaceID;
  const faceID = new Uint32Array([
    capA,
    capB,
    side0, side0,
    side1, side1,
    side2, side2,
  ]);
  const mesh = new ManifoldMesh({ numProp: 3, vertProperties, triVerts, faceID });
  try {
    return new Manifold(mesh);
  } finally {
    try { mesh.delete?.(); } catch { /* ignore */ }
  }
}

function buildHullFallback(p0, p1, p2, q0, q1, q2) {
  return Manifold.hull([
    [p0.x, p0.y, p0.z],
    [p1.x, p1.y, p1.z],
    [p2.x, p2.y, p2.z],
    [q0.x, q0.y, q0.z],
    [q1.x, q1.y, q1.z],
    [q2.x, q2.y, q2.z],
  ]);
}

function shouldUseHullPrimitive(p0, p1, p2, q0, q1, q2, distance) {
  if (!(Number.isFinite(distance))) return true;
  if (distance < 0) return true;

  const sourceNormal = triangleNormal(p0, p1, p2);
  const offsetNormal = triangleNormal(q0, q1, q2);
  const sourceLenSq = sourceNormal.lengthSq();
  const offsetLenSq = offsetNormal.lengthSq();
  if (!(sourceLenSq > TRI_EPS) || !(offsetLenSq > TRI_EPS)) return true;

  const alignment = sourceNormal.dot(offsetNormal) / Math.sqrt(sourceLenSq * offsetLenSq);
  if (!(alignment > 0.25)) return true;

  return false;
}

function unionManifoldsDeterministically(manifolds, batchSize = 24) {
  const items = Array.isArray(manifolds) ? manifolds.filter(Boolean) : [];
  if (!items.length) return null;
  if (items.length === 1) return items[0];

  let current = items.slice();
  const chunkSize = Math.max(2, Number(batchSize) || 24);
  while (current.length > 1) {
    const next = [];
    for (let start = 0; start < current.length; start += chunkSize) {
      const chunk = current.slice(start, start + chunkSize);
      if (chunk.length === 1) {
        next.push(chunk[0]);
        continue;
      }
      const merged = Manifold.union(chunk);
      for (const item of chunk) {
        if (item === merged) continue;
        try { item.delete?.(); } catch { /* ignore */ }
      }
      next.push(merged);
    }
    current = next;
  }
  return current[0];
}

function classifyUnionMesh(mesh, surface, distance, classificationState) {
  const triVerts = Array.from(mesh?.triVerts ?? []);
  const vertProperties = Array.from(mesh?.vertProperties ?? []);
  const triCount = (triVerts.length / 3) | 0;
  const distanceScale = Math.max(Math.abs(Number(distance) || 0) * 0.05, surface.scale * 1e-5, 1e-6);
  const labels = classificationState?.labels || {};

  const sourceTriangles = [];
  const offsetTriangles = [];
  const rimLoopTriangles = surface.loops.map(() => []);

  for (let triIndex = 0; triIndex < surface.triangles.length; triIndex++) {
    const [a, b, c] = surface.triangles[triIndex];
    const p0 = surface.vertices[a];
    const p1 = surface.vertices[b];
    const p2 = surface.vertices[c];
    const q0 = p0.clone().add(surface.vertexNormals[a].clone().multiplyScalar(distance));
    const q1 = p1.clone().add(surface.vertexNormals[b].clone().multiplyScalar(distance));
    const q2 = p2.clone().add(surface.vertexNormals[c].clone().multiplyScalar(distance));

    if (distance >= 0) {
      sourceTriangles.push({ a: p0, b: p2, c: p1 });
      offsetTriangles.push({ a: q0, b: q1, c: q2 });
    } else {
      sourceTriangles.push({ a: p0, b: p1, c: p2 });
      offsetTriangles.push({ a: q0, b: q2, c: q1 });
    }

    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const loopIndex = surface.boundaryEdgeToLoop.get(edgeKey(u, v));
      if (loopIndex == null) continue;
      const pu = surface.vertices[u];
      const pv = surface.vertices[v];
      const qu = pu.clone().add(surface.vertexNormals[u].clone().multiplyScalar(distance));
      const qv = pv.clone().add(surface.vertexNormals[v].clone().multiplyScalar(distance));
      rimLoopTriangles[loopIndex].push({ a: pu, b: pv, c: qv });
      rimLoopTriangles[loopIndex].push({ a: pu, b: qv, c: qu });
    }
  }

  const sourceGroup = classificationState?.groups?.[0] || {
    label: labels.source,
    kind: 'source',
    metadata: {
      type: 'thicken_source',
      sourceFaceName: labels.sourceFaceName,
      distance,
    },
  };
  const offsetGroup = classificationState?.groups?.[1] || {
    label: labels.offset,
    kind: 'offset',
    metadata: {
      type: 'thicken_offset',
      sourceFaceName: labels.sourceFaceName,
      distance,
    },
  };
  const rimGroups = Array.isArray(classificationState?.groups)
    ? classificationState.groups.slice(2)
    : [];

  const referenceGroups = [
    buildReferenceGroup(sourceGroup.label, sourceTriangles, sourceGroup.kind || 'source', sourceGroup.metadata || {}),
    buildReferenceGroup(offsetGroup.label, offsetTriangles, offsetGroup.kind || 'offset', offsetGroup.metadata || {}),
    ...rimLoopTriangles.map((triangles, loopIndex) => {
      const rimGroup = rimGroups[loopIndex] || {
        label: labels.rims?.[loopIndex],
        kind: 'rim',
        metadata: {
          type: 'thicken_rim',
          sourceFaceName: labels.sourceFaceName,
          loopIndex,
          distance,
        },
      };
      return buildReferenceGroup(
        rimGroup.label,
        triangles,
        rimGroup.kind || 'rim',
        rimGroup.metadata || {},
      );
    }),
  ].filter((group) => Array.isArray(group?.triangles) && group.triangles.length);

  const faceNameToID = classificationState?.faceNameToID instanceof Map
    ? classificationState.faceNameToID
    : new Map();
  const idToFaceName = classificationState?.idToFaceName instanceof Map
    ? classificationState.idToFaceName
    : new Map();
  const faceMetadataJson = Array.from(classificationState?.faceMetadataJson || []);

  const classifiedIDs = new Array(triCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const i0 = triVerts[(triIndex * 3) + 0] >>> 0;
    const i1 = triVerts[(triIndex * 3) + 1] >>> 0;
    const i2 = triVerts[(triIndex * 3) + 2] >>> 0;
    a.set(
      vertProperties[(i0 * 3) + 0] || 0,
      vertProperties[(i0 * 3) + 1] || 0,
      vertProperties[(i0 * 3) + 2] || 0,
    );
    b.set(
      vertProperties[(i1 * 3) + 0] || 0,
      vertProperties[(i1 * 3) + 1] || 0,
      vertProperties[(i1 * 3) + 2] || 0,
    );
    c.set(
      vertProperties[(i2 * 3) + 0] || 0,
      vertProperties[(i2 * 3) + 1] || 0,
      vertProperties[(i2 * 3) + 2] || 0,
    );

    const centroid = triangleCentroid(a, b, c);
    const triNormal = triangleNormal(a, b, c);
    if (triNormal.lengthSq() > TRI_EPS) triNormal.normalize();

    let bestGroup = referenceGroups[0];
    let bestScore = Infinity;
    for (const group of referenceGroups) {
      let bestDistanceSq = Infinity;
      let bestAlignmentPenalty = 0;
      for (const ref of group.triangles) {
        const distanceSq = pointTriangleDistanceSquared(centroid, ref.a, ref.b, ref.c);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          if (triNormal.lengthSq() > TRI_EPS && ref.normal.lengthSq() > TRI_EPS) {
            const dot = Math.max(-1, Math.min(1, triNormal.dot(ref.normal)));
            bestAlignmentPenalty = (1 - dot) * distanceScale;
          } else {
            bestAlignmentPenalty = 0;
          }
        }
      }
      const score = Math.sqrt(bestDistanceSq) + bestAlignmentPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    classifiedIDs[triIndex] = faceNameToID.get(bestGroup.label);
  }

  return {
    triIDs: classifiedIDs,
    faceNameToID,
    idToFaceName,
    faceMetadataJson,
    groups: Array.isArray(classificationState?.groups) ? classificationState.groups : referenceGroups,
    method: 'heuristic_reclassification',
  };
}

function buildSolidFromUnionMesh(mesh, classification, name) {
  if (typeof manifold?.buildSolidAuthoringStateFromMesh !== 'function') {
    throw new Error('Face.thicken() requires buildSolidAuthoringStateFromMesh in the local manifold build.');
  }
  const snapshot = manifold.buildSolidAuthoringStateFromMesh({
    numProp: Number(mesh?.numProp ?? 3),
    vertProperties: Array.from(mesh?.vertProperties ?? []),
    triVerts: Array.from(mesh?.triVerts ?? []),
    faceID: Array.from(classification?.triIDs ?? []),
    faceNameToID: Array.from(classification?.faceNameToID?.entries?.() || []),
    idToFaceName: Array.from(classification?.idToFaceName?.entries?.() || []),
    faceMetadataJson: Array.from(classification?.faceMetadataJson || []),
    edgeMetadataJson: [],
    auxEdges: [],
    name: String(name || ''),
  });
  const solid = new Solid();
  applySolidAuthoringStateSnapshot(solid, snapshot, { remapFaceIDs: true });
  try { solid.name = name || solid.name; } catch { /* ignore */ }
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  return solid;
}

export function thickenFaceToSolid(face, distance, options = {}) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || Math.abs(dist) <= EPS) {
    throw new Error('Face.thicken() requires a non-zero finite distance.');
  }

  const surface = extractFaceSurface(face, options);
  const featureId = sanitizeToken(options.featureId || options.name || face?.name || 'THICKEN', 'THICKEN');
  const sourceFaceName = String(face?.userData?.faceName || face?.name || featureId).trim() || featureId;
  const sourceToken = sanitizeToken(sourceFaceName, 'FACE');
  const loops = Array.isArray(surface.loops) ? surface.loops : [];

  const prismManifolds = [];
  let hullFallbackCount = 0;
  for (const tri of surface.triangles) {
    const [a, b, c] = tri;
    const p0 = surface.vertices[a];
    const p1 = surface.vertices[b];
    const p2 = surface.vertices[c];
    const q0 = p0.clone().add(surface.vertexNormals[a].clone().multiplyScalar(dist));
    const q1 = p1.clone().add(surface.vertexNormals[b].clone().multiplyScalar(dist));
    const q2 = p2.clone().add(surface.vertexNormals[c].clone().multiplyScalar(dist));

    const useHull = shouldUseHullPrimitive(p0, p1, p2, q0, q1, q2, dist);
    if (useHull) {
      prismManifolds.push(buildHullFallback(p0, p1, p2, q0, q1, q2));
      hullFallbackCount += 1;
      continue;
    }

    try {
      prismManifolds.push(buildPrismManifold(p0, p1, p2, q0, q1, q2, dist));
    } catch {
      prismManifolds.push(buildHullFallback(p0, p1, p2, q0, q1, q2));
      hullFallbackCount += 1;
    }
  }
  if (!prismManifolds.length) {
    throw new Error('Face.thicken() failed to build any manifold primitives.');
  }

  let unioned = null;
  try {
    unioned = unionManifoldsDeterministically(prismManifolds);
    const mesh = unioned.getMesh();
    const labels = {
      sourceFaceName,
      source: `${featureId}_SOURCE_${sourceToken}`,
      offset: `${featureId}_OFFSET_${sourceToken}`,
      rims: loops.map((_, loopIndex) => `${featureId}_RIM_L${loopIndex}_${sourceToken}`),
    };
    const classification = classifyUnionMesh(mesh, surface, dist, labels);
    const solidName = String(options.name || featureId).trim() || featureId;
    const result = buildSolidFromUnionMesh(mesh, classification, solidName);
    const topology = analyzeMeshTopology(result);
    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
      throw new Error(
        `Face.thicken() produced invalid topology: `
        + `boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
      );
    }
    if (typeof result._isCoherentlyOrientedManifold === 'function' && result._isCoherentlyOrientedManifold() !== true) {
      throw new Error('Face.thicken() produced a non-coherently-oriented manifold result.');
    }

    let sourceMetadata = null;
    try {
      sourceMetadata = typeof face?.getMetadata === 'function' ? (face.getMetadata() || null) : null;
    } catch {
      sourceMetadata = null;
    }
    try {
      if (sourceMetadata && typeof result.setFaceMetadata === 'function') {
        result.setFaceMetadata(labels.source, {
          ...sourceMetadata,
          type: classification.groups.find((group) => group.label === labels.source)?.metadata?.type || 'thicken_source',
          sourceFaceName,
          sourceFeatureId: face?.owningFeatureID ?? face?.parentSolid?.owningFeatureID ?? sourceMetadata?.sourceFeatureId ?? null,
        });
        result.setFaceMetadata(labels.offset, {
          ...sourceMetadata,
          type: classification.groups.find((group) => group.label === labels.offset)?.metadata?.type || 'thicken_offset',
          sourceFaceName,
          sourceFeatureId: face?.owningFeatureID ?? face?.parentSolid?.owningFeatureID ?? sourceMetadata?.sourceFeatureId ?? null,
        });
      }
    } catch { /* ignore metadata propagation errors */ }

    result.__thickenMethod = hullFallbackCount > 0
      ? 'triangle_prism_union_with_hull_fallback'
      : 'triangle_prism_union';
    result.__thickenDiagnostics = {
      primitiveCount: prismManifolds.length,
      hullFallbackCount,
      boundaryLoopCount: loops.length,
      sourceFaceName,
      distance: dist,
    };
    result.userData = {
      ...(result.userData || {}),
      thicken: {
        sourceFaceName,
        distance: dist,
        primitiveCount: prismManifolds.length,
        hullFallbackCount,
        boundaryLoopCount: loops.length,
      },
    };
    return result;
  } finally {
    for (const primitive of prismManifolds) {
      if (!primitive || primitive === unioned) continue;
      try { primitive.delete?.(); } catch { /* ignore */ }
    }
    if (unioned) {
      try { unioned.delete?.(); } catch { /* ignore */ }
    }
  }
}

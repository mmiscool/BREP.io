import { Solid } from '../BREP/BetterSolid.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
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

function hasVertexNear(solid, expected, tolerance = 1e-8) {
  const verts = solid?._vertProperties || [];
  for (let i = 0; i < verts.length; i += 3) {
    const dx = verts[i + 0] - expected[0];
    const dy = verts[i + 1] - expected[1];
    const dz = verts[i + 2] - expected[2];
    if (Math.hypot(dx, dy, dz) <= tolerance) return true;
  }
  return false;
}

function addBox(solid, name, min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p000 = [x0, y0, z0];
  const p001 = [x0, y0, z1];
  const p010 = [x0, y1, z0];
  const p011 = [x0, y1, z1];
  const p100 = [x1, y0, z0];
  const p101 = [x1, y0, z1];
  const p110 = [x1, y1, z0];
  const p111 = [x1, y1, z1];
  solid.addTriangle(`${name}_NX`, p000, p001, p011);
  solid.addTriangle(`${name}_NX`, p000, p011, p010);
  solid.addTriangle(`${name}_PX`, p100, p110, p111);
  solid.addTriangle(`${name}_PX`, p100, p111, p101);
  solid.addTriangle(`${name}_NY`, p000, p100, p101);
  solid.addTriangle(`${name}_NY`, p000, p101, p001);
  solid.addTriangle(`${name}_PY`, p010, p011, p111);
  solid.addTriangle(`${name}_PY`, p010, p111, p110);
  solid.addTriangle(`${name}_NZ`, p000, p010, p110);
  solid.addTriangle(`${name}_NZ`, p000, p110, p100);
  solid.addTriangle(`${name}_PZ`, p001, p101, p111);
  solid.addTriangle(`${name}_PZ`, p001, p111, p011);
}

export async function test_mesh_cleanup_split_crossing_triangles_inserts_intersection_edges() {
  const solid = new Solid();
  solid.addTriangle('A', [0, 0, 0], [2, 0, 0], [0, 2, 0]);
  solid.addTriangle('B', [0.5, -0.25, -1], [0.5, 1.5, 1], [0.5, 1.5, -1]);

  const splitCount = solid.splitSelfIntersectingTriangles();
  assert(splitCount === 1, `[mesh-cleanup split] Expected one intersecting pair, received ${splitCount}.`);
  assert(solid._triVerts.length / 3 > 2, '[mesh-cleanup split] Expected triangle count to increase.');
  assert(solid._triIDs.length === solid._triVerts.length / 3, '[mesh-cleanup split] Face ID count must stay per-triangle.');
  assert(hasVertexNear(solid, [0.5, 0.625, 0]), '[mesh-cleanup split] Missing first intersection endpoint.');
  assert(hasVertexNear(solid, [0.5, 1.5, 0]), '[mesh-cleanup split] Missing second intersection endpoint.');
}

export async function test_mesh_cleanup_split_point_intersection_inserts_vertex() {
  const solid = new Solid();
  solid.addTriangle('A', [0, 0, 0], [2, 0, 0], [0, 2, 0]);
  solid.addTriangle('B', [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 1, 1]);

  const splitCount = solid.splitSelfIntersectingTriangles();
  assert(splitCount === 1, `[mesh-cleanup point] Expected one point intersecting pair, received ${splitCount}.`);
  assert(solid._triVerts.length / 3 > 2, '[mesh-cleanup point] Expected triangle count to increase.');
  assert(solid._triIDs.length === solid._triVerts.length / 3, '[mesh-cleanup point] Face ID count must stay per-triangle.');
  assert(hasVertexNear(solid, [0.5, 0.5, 0]), '[mesh-cleanup point] Missing point intersection vertex.');
}

export async function test_mesh_cleanup_split_then_winding_removes_internal_overlap() {
  const solid = new Solid();
  addBox(solid, 'A', [0, 0, 0], [2, 2, 2]);
  addBox(solid, 'B', [1, 1, 0], [3, 3, 2]);

  const splitCount = solid.splitSelfIntersectingTriangles();
  assert(splitCount > 0, '[mesh-cleanup overlap] Expected overlapping boxes to produce split intersections.');

  const removed = solid.removeInternalTrianglesByWinding();
  assert(removed > 0, '[mesh-cleanup overlap] Expected winding cleanup to remove internal triangles.');
  const topology = analyzeMeshTopology(solid);
  assert(topology.boundaryEdgeCount === 0, `[mesh-cleanup overlap] Expected no boundary edges, received ${topology.boundaryEdgeCount}.`);
  assert(topology.nonManifoldEdgeCount === 0, `[mesh-cleanup overlap] Expected no non-manifold edges, received ${topology.nonManifoldEdgeCount}.`);
  assert(topology.triangleCount > 0, '[mesh-cleanup overlap] Cleanup removed all triangles.');
  if (typeof solid._isCoherentlyOrientedManifold === 'function') {
    assert(solid._isCoherentlyOrientedManifold() === true, '[mesh-cleanup overlap] Expected coherent manifold orientation.');
  }
}

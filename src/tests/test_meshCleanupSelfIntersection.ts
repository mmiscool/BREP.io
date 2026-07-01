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

function approxEqual(a, b, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
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

export async function test_mesh_cleanup_find_one_triangle_intersected_by_multiple_triangles() {
  const solid = new Solid();
  solid.addTriangle('BASE', [0, 0, 0], [3, 0, 0], [0, 3, 0]);
  solid.addTriangle('CUT_X', [1, -0.25, -1], [1, 2, 1], [1, 2, -1]);
  solid.addTriangle('CUT_Y', [-0.25, 1, -1], [2, 1, 1], [2, 1, -1]);

  const hits = solid.findSelfIntersections();
  assert(hits.filter((hit) => hit.triangleA === 0 || hit.triangleB === 0).length >= 2, '[mesh-cleanup multi] Expected the base triangle to collect multiple hits.');
  const splitCount = solid.splitSelfIntersectingTriangles();
  assert(splitCount >= 2, `[mesh-cleanup multi] Expected at least two split pairs, received ${splitCount}.`);
  assert(solid._triIDs.length === solid._triVerts.length / 3, '[mesh-cleanup multi] Face IDs must stay per-triangle.');
}

export async function test_mesh_cleanup_two_cut_segments_cross_inside_same_triangle() {
  const solid = new Solid();
  solid.addTriangle('BASE', [0, 0, 0], [3, 0, 0], [0, 3, 0]);
  solid.addTriangle('CUT_X', [1, -0.5, -1], [1, -0.5, 1], [1, 2.5, 0]);
  solid.addTriangle('CUT_Y', [-0.5, 1, -1], [-0.5, 1, 1], [2.5, 1, 0]);

  solid.splitSelfIntersectingTriangles();
  assert(hasVertexNear(solid, [1, 1, 0]), '[mesh-cleanup crossing cuts] Missing crossing vertex inserted inside source triangle.');
}

export async function test_mesh_cleanup_intersection_endpoint_on_shared_mesh_edge() {
  const solid = new Solid();
  solid.addTriangle('A', [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  solid.addTriangle('B', [1, 0, 0], [1, 1, 0], [0, 1, 0]);
  solid.addTriangle('CUT', [0.5, 0.5, 0], [0.5, 0.5, 1], [0.8, 0.8, 1]);

  const splitCount = solid.splitSelfIntersectingTriangles();
  assert(splitCount >= 1, `[mesh-cleanup shared edge endpoint] Expected split pair, received ${splitCount}.`);
  assert(hasVertexNear(solid, [0.5, 0.5, 0]), '[mesh-cleanup shared edge endpoint] Missing endpoint vertex on shared edge.');
}

export async function test_mesh_cleanup_detects_coplanar_partial_triangle_overlap() {
  const solid = new Solid();
  solid.addTriangle('A', [0, 0, 0], [2, 0, 0], [0, 2, 0]);
  solid.addTriangle('B', [0.5, 0.25, 0], [2.5, 0.25, 0], [0.5, 2.25, 0]);

  const hits = solid.findSelfIntersections();
  assert(hits.some((hit) => hit.type === 'coplanar'), '[mesh-cleanup coplanar] Expected coplanar overlap record.');
  assert(solid.splitSelfIntersectingTriangles() >= 1, '[mesh-cleanup coplanar] Expected coplanar overlap to be processed.');
}

export async function test_mesh_cleanup_removes_geometrically_duplicate_triangles() {
  const solid = new Solid();
  solid.addTriangle('A', [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  solid.addTriangle('B', [0, 1, 0], [1, 0, 0], [0, 0, 0]);

  const report = solid.cleanupSelfIntersections({ validate: false, removeInternal: false });
  assert(report.duplicateTrianglesRemoved === 1, `[mesh-cleanup duplicate] Expected one duplicate removed, received ${report.duplicateTrianglesRemoved}.`);
  assert(solid._triVerts.length / 3 === 1, '[mesh-cleanup duplicate] Expected one triangle to remain.');
}

export async function test_mesh_cleanup_removes_closed_box_completely_inside_another() {
  const solid = new Solid();
  addBox(solid, 'OUTER', [0, 0, 0], [3, 3, 3]);
  addBox(solid, 'INNER', [1, 1, 1], [2, 2, 2]);

  const report = solid.cleanupSelfIntersections({ validate: false });
  assert(report.internalTrianglesRemoved >= 12, `[mesh-cleanup nested box] Expected inner shell removal, removed ${report.internalTrianglesRemoved}.`);
  assert(solid._triVerts.length / 3 === 12, '[mesh-cleanup nested box] Expected only the outer box triangles to remain.');
}

export async function test_mesh_cleanup_overlapping_boxes_volume_equals_union() {
  const solid = new Solid();
  addBox(solid, 'A', [0, 0, 0], [2, 2, 2]);
  addBox(solid, 'B', [1, 1, 0], [3, 3, 2]);

  const report = solid.cleanupSelfIntersections({ validate: false });
  assert(report.intersectionFree === true && report.closed === true, '[mesh-cleanup box union] Expected closed intersection-free cleanup.');
  assert(approxEqual(solid.volume(), 14, 1e-5), `[mesh-cleanup box union] Expected union volume 14, received ${solid.volume()}.`);
}

export async function test_mesh_cleanup_disjoint_closed_boxes_are_preserved() {
  const solid = new Solid();
  addBox(solid, 'A', [0, 0, 0], [1, 1, 1]);
  addBox(solid, 'B', [2, 0, 0], [3, 1, 1]);

  const report = solid.cleanupSelfIntersections({ validate: false });
  assert(report.internalTrianglesRemoved === 0, '[mesh-cleanup disjoint boxes] Disjoint boxes should not be culled.');
  assert(solid._triVerts.length / 3 === 24, '[mesh-cleanup disjoint boxes] Expected both boxes to remain.');
}

export async function test_mesh_cleanup_preserves_face_ids_after_splitting() {
  const solid = new Solid();
  solid.addTriangle('FACE_A', [0, 0, 0], [2, 0, 0], [0, 2, 0]);
  solid.addTriangle('FACE_B', [0.5, -0.25, -1], [0.5, 1.5, 1], [0.5, 1.5, -1]);
  const faceAID = solid._faceNameToID.get('FACE_A');

  solid.splitSelfIntersectingTriangles();
  const faceAFragments = solid._triIDs.filter((id) => id === faceAID).length;
  assert(faceAFragments > 1, '[mesh-cleanup face IDs] Expected split FACE_A fragments to inherit the source face ID.');
  assert(solid._triIDs.length === solid._triVerts.length / 3, '[mesh-cleanup face IDs] Face ID count must match triangle count.');
}

export async function test_mesh_cleanup_complete_operation_is_idempotent() {
  const solid = new Solid();
  addBox(solid, 'A', [0, 0, 0], [2, 2, 2]);
  addBox(solid, 'B', [1, 1, 0], [3, 3, 2]);

  const first = solid.cleanupSelfIntersections({ validate: false });
  const triCount = solid._triVerts.length / 3;
  const vertCount = solid._vertProperties.length / 3;
  const second = solid.cleanupSelfIntersections({ validate: false });
  assert(first.complete === true, '[mesh-cleanup idempotence] Initial cleanup should complete.');
  assert(second.intersectionsFound === 0, '[mesh-cleanup idempotence] Second cleanup should find no intersections.');
  assert(solid._triVerts.length / 3 === triCount && solid._vertProperties.length / 3 === vertCount, '[mesh-cleanup idempotence] Second cleanup should not change geometry counts.');
}

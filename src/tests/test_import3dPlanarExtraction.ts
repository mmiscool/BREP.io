import { BREP } from '../BREP/BREP.js';
import { fs } from '../fs.proxy.js';

const IMPORT_PLANAR_SLIVER_ID = 'IMPORT3D_PLANAR_SLIVER_BRIDGE';
const IMPORT_FIXTURE_STL_PATH = 'src/tests/importTestingData/import_test.stl';

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  if (Math.abs(num) < 1e-16) return '0';
  return num.toFixed(9);
}

function appendFacet(out, p0, p1, p2) {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  let nx = (uy * vz) - (uz * vy);
  let ny = (uz * vx) - (ux * vz);
  let nz = (ux * vy) - (uy * vx);
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  out.push(`  facet normal ${formatNumber(nx)} ${formatNumber(ny)} ${formatNumber(nz)}`);
  out.push('    outer loop');
  out.push(`      vertex ${formatNumber(p0[0])} ${formatNumber(p0[1])} ${formatNumber(p0[2])}`);
  out.push(`      vertex ${formatNumber(p1[0])} ${formatNumber(p1[1])} ${formatNumber(p1[2])}`);
  out.push(`      vertex ${formatNumber(p2[0])} ${formatNumber(p2[1])} ${formatNumber(p2[2])}`);
  out.push('    endloop');
  out.push('  endfacet');
}

function buildCoplanarSliverBridgeStl() {
  const lines = ['solid import3d_planar_sliver_bridge'];
  const addTri = (a, b, c) => appendFacet(lines, a, b, c);

  // Sliver first: after default weld tolerance, this can collapse toward a line,
  // and should still be absorbed into the larger coplanar region.
  addTri([1, 0, 0], [1.000001, 0.5, 0], [1, 1, 0]);

  // Left patch
  addTri([0, 0, 0], [1, 0, 0], [1, 1, 0]);
  addTri([0, 0, 0], [1, 1, 0], [0, 1, 0]);

  // Right patch
  addTri([1.000001, 0, 0], [2.000001, 0, 0], [2.000001, 1, 0]);
  addTri([1.000001, 0, 0], [2.000001, 1, 0], [1.000001, 1, 0]);

  lines.push('endsolid import3d_planar_sliver_bridge');
  return lines.join('\n');
}

export async function test_import3d_planar_extraction_merges_sliver_bridge(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.id = IMPORT_PLANAR_SLIVER_ID;
  import3d.inputParams.featureID = IMPORT_PLANAR_SLIVER_ID;
  import3d.inputParams.fileToImport = buildCoplanarSliverBridgeStl();
  import3d.inputParams.centerMesh = false;
  import3d.inputParams.deflectionAngle = 5;
  import3d.inputParams.extractPlanarFaces = true;
  import3d.inputParams.planarFaceMinAreaPercent = 20;
  import3d.inputParams.segmentAnalyticPrimitives = false;
  return partHistory;
}

export async function afterRun_import3d_planar_extraction_merges_sliver_bridge(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  if (!solids.length) {
    throw new Error('[import3d planar sliver] No solids were generated');
  }

  const solid = solids.find((obj) => String(obj?.name || '') === IMPORT_PLANAR_SLIVER_ID) || solids[0];
  if (!solid) {
    throw new Error('[import3d planar sliver] Could not find imported solid');
  }

  const triVerts = Array.isArray(solid._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (triCount !== 5) {
    throw new Error(`[import3d planar sliver] Expected 5 triangles, got ${triCount}`);
  }

  const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs : [];
  const idToFaceName = (solid._idToFaceName instanceof Map) ? solid._idToFaceName : new Map();
  if (triIDs.length !== triCount) {
    throw new Error('[import3d planar sliver] Triangle IDs missing or inconsistent');
  }

  const triFaceNames = triIDs.map((faceID) => String(idToFaceName.get(faceID) || ''));
  const uniqueFaceNames = new Set(triFaceNames);
  if (uniqueFaceNames.size !== 1) {
    throw new Error(
      `[import3d planar sliver] Expected one merged planar face, got ${uniqueFaceNames.size} (${Array.from(uniqueFaceNames).join(', ')})`,
    );
  }
}

export async function test_import3d_planar_extraction_keeps_small_flat_patch_edges() {
  const geometry = new BREP.THREE.BufferGeometry();
  const positions = new Float32Array([
    // Center flat patch, intentionally below the global planar area threshold.
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,

    // Neighboring shallow planes that would merge by deflection angle.
    -1, 0, 0.05,
    0, 0, 0,
    0, 1, 0,
    -1, 1, 0.05,

    1, 0, 0,
    2, 0, 0.05,
    2, 1, 0.05,
    1, 1, 0,

    // Large disconnected planar area to make the center patch fail the
    // configured global percent threshold.
    -25, -25, 10,
    25, -25, 10,
    25, 25, 10,
    -25, 25, 10,
  ]);
  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
    4, 5, 6,
    4, 6, 7,
    8, 9, 10,
    8, 10, 11,
    12, 13, 14,
    12, 14, 15,
  ]);
  geometry.setAttribute('position', new BREP.THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new BREP.THREE.BufferAttribute(indices, 1));

  const solid = new BREP.MeshToBrep(geometry, 5, 1e-5, {
    extractPlanarFaces: true,
    planarMinAreaPercent: 1,
  });

  const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
  const names = triIDs.map((id) => String(idToFaceName.get(id) || ''));

  if (names.length !== 8) {
    throw new Error(`[import3d planar small patch] Expected 8 triangles, got ${names.length}`);
  }
  if (!names[0] || names[0] !== names[1]) {
    throw new Error('[import3d planar small patch] Center patch triangles were not kept in one planar face.');
  }
  if (names[0] === names[2] || names[0] === names[4]) {
    throw new Error('[import3d planar small patch] Center planar patch was merged into adjacent shallow faces.');
  }
}

export async function test_import3d_planar_extraction_merges_near_coplanar_patch_back_into_neighbor() {
  const geometry = new BREP.THREE.BufferGeometry();
  const positions = new Float32Array([
    // Small local planar patch.
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,

    // Neighboring patch is visually coplanar but has tiny STL tolerance drift.
    1, 0, 0,
    2, 0, 0.0002,
    2, 1, 0.0002,
    1, 1, 0,

    // Large disconnected planar area makes the local patch fail the global
    // area threshold, forcing the local-patch path before coalescing.
    -25, -25, 10,
    25, -25, 10,
    25, 25, 10,
    -25, 25, 10,
  ]);
  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
    4, 5, 6,
    4, 6, 7,
    8, 9, 10,
    8, 10, 11,
  ]);
  geometry.setAttribute('position', new BREP.THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new BREP.THREE.BufferAttribute(indices, 1));

  const solid = new BREP.MeshToBrep(geometry, 5, 1e-5, {
    extractPlanarFaces: true,
    planarMinAreaPercent: 1,
  });

  const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
  const names = triIDs.map((id) => String(idToFaceName.get(id) || ''));

  if (names.length !== 6) {
    throw new Error(`[import3d planar near-coplanar merge] Expected 6 triangles, got ${names.length}`);
  }
  if (!names[0] || names[0] !== names[1]) {
    throw new Error('[import3d planar near-coplanar merge] Local patch triangles were not grouped together.');
  }
  if (names[0] !== names[2] || names[0] !== names[3]) {
    throw new Error('[import3d planar near-coplanar merge] Local patch was not merged back into its coplanar neighbor.');
  }
}

export async function test_import3d_fixture_merges_faces_4_and_34(partHistory) {
  const stl = await (fs.promises as any).readFile(IMPORT_FIXTURE_STL_PATH, 'utf8');
  const import3d = await partHistory.newFeature('IMPORT3D');
  Object.assign(import3d.inputParams, {
    id: 'IMPORT3D5',
    featureID: 'IMPORT3D5',
    fileToImport: stl,
    deflectionAngle: 8,
    decimationLevel: 100,
    meshRepairLevel: 'NONE',
    centerMesh: true,
    extractMultipleSolids: false,
    extractPlanarFaces: true,
    planarFaceMinAreaPercent: 1,
    segmentAnalyticPrimitives: false,
  });

  await partHistory.runHistory();

  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  const solid = solids.find((obj) => String(obj?.name || '') === 'IMPORT3D5') || solids[0];
  if (!solid) {
    throw new Error('[import3d fixture planar merge] No imported solid was generated.');
  }

  const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
  const faceCounts = new Map();
  for (const faceID of triIDs) {
    const faceName = String(idToFaceName.get(faceID) || '');
    if (!faceName) continue;
    faceCounts.set(faceName, (faceCounts.get(faceName) || 0) + 1);
  }

  const face4Count = faceCounts.get('STL_FACE_4') || 0;
  const face34Count = faceCounts.get('STL_FACE_34') || 0;
  if (face4Count <= 0) {
    throw new Error('[import3d fixture planar merge] Expected STL_FACE_4 to exist after import.');
  }
  if (face34Count !== 0) {
    throw new Error(
      `[import3d fixture planar merge] Expected STL_FACE_34 to merge into STL_FACE_4, but it still has ${face34Count} triangles.`,
    );
  }
}

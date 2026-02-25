const IMPORT_PLANAR_SLIVER_ID = 'IMPORT3D_PLANAR_SLIVER_BRIDGE';

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

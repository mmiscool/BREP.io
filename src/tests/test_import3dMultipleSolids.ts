const IMPORT3D_MULTI_SOLIDS_ID = 'IMPORT3D_MULTI_SOLIDS';

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

function appendCube(out, minPt, maxPt) {
  const [x0, y0, z0] = minPt;
  const [x1, y1, z1] = maxPt;

  // Bottom (-Y)
  appendFacet(out, [x0, y0, z0], [x1, y0, z1], [x1, y0, z0]);
  appendFacet(out, [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]);

  // Top (+Y)
  appendFacet(out, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1]);
  appendFacet(out, [x0, y1, z0], [x1, y1, z1], [x0, y1, z1]);

  // Left (-X)
  appendFacet(out, [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
  appendFacet(out, [x0, y0, z0], [x0, y1, z1], [x0, y0, z1]);

  // Right (+X)
  appendFacet(out, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]);
  appendFacet(out, [x1, y0, z0], [x1, y1, z1], [x1, y1, z0]);

  // Front (-Z)
  appendFacet(out, [x0, y0, z0], [x1, y1, z0], [x1, y0, z0]);
  appendFacet(out, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);

  // Back (+Z)
  appendFacet(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]);
  appendFacet(out, [x0, y0, z1], [x1, y1, z1], [x0, y1, z1]);
}

function buildTwoCubeIslandsStl() {
  const lines = ['solid import3d_multiple_solids'];
  appendCube(lines, [-1, 0, -1], [1, 2, 1]);
  appendCube(lines, [8, 0, -1], [10, 2, 1]);
  lines.push('endsolid import3d_multiple_solids');
  return lines.join('\n');
}

function getImportFeatureById(partHistory, id) {
  return (partHistory.features || []).find((entry) => (
    entry
    && String(entry?.type || '').toUpperCase() === 'IMPORT3D'
    && (
      String(entry?.inputParams?.featureID || '') === id
      || String(entry?.inputParams?.id || '') === id
    )
  )) || null;
}

function listFeatureSolids(partHistory, featureId) {
  const prefix = `${featureId}_SOLID_`;
  return (partHistory.scene?.children || []).filter((obj) => (
    obj?.type === 'SOLID'
    && (
      String(obj?.name || '') === featureId
      || String(obj?.name || '').startsWith(prefix)
    )
  ));
}

export async function test_import3d_extract_multiple_solids_toggle(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.id = IMPORT3D_MULTI_SOLIDS_ID;
  import3d.inputParams.featureID = IMPORT3D_MULTI_SOLIDS_ID;
  import3d.inputParams.fileToImport = buildTwoCubeIslandsStl();
  import3d.inputParams.centerMesh = false;
  import3d.inputParams.deflectionAngle = 8;
  import3d.inputParams.decimationLevel = 100;
  import3d.inputParams.meshRepairLevel = 'NONE';
  import3d.inputParams.extractMultipleSolids = false;
  import3d.inputParams.extractPlanarFaces = false;
  import3d.inputParams.segmentAnalyticPrimitives = false;
  return partHistory;
}

export async function afterRun_import3d_extract_multiple_solids_toggle(partHistory) {
  const feature = getImportFeatureById(partHistory, IMPORT3D_MULTI_SOLIDS_ID);
  if (!feature) throw new Error('[import3d multi solids] Import feature not found');

  const baselineSolids = listFeatureSolids(partHistory, IMPORT3D_MULTI_SOLIDS_ID);
  if (baselineSolids.length !== 1) {
    throw new Error(`[import3d multi solids] Expected 1 solid with checkbox off, got ${baselineSolids.length}`);
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.extractMultipleSolids = true;
  await partHistory.runHistory();

  const splitSolids = listFeatureSolids(partHistory, IMPORT3D_MULTI_SOLIDS_ID);
  if (splitSolids.length !== 2) {
    throw new Error(`[import3d multi solids] Expected 2 solids with checkbox on, got ${splitSolids.length}`);
  }

  const splitNames = new Set(splitSolids.map((solid) => String(solid?.name || '')));
  if (!splitNames.has(`${IMPORT3D_MULTI_SOLIDS_ID}_SOLID_01`) || !splitNames.has(`${IMPORT3D_MULTI_SOLIDS_ID}_SOLID_02`)) {
    throw new Error(`[import3d multi solids] Unexpected split solid names: ${Array.from(splitNames).join(', ')}`);
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.extractMultipleSolids = false;
  await partHistory.runHistory();

  const mergedSolids = listFeatureSolids(partHistory, IMPORT3D_MULTI_SOLIDS_ID);
  if (mergedSolids.length !== 1) {
    throw new Error(`[import3d multi solids] Expected 1 solid after turning checkbox off again, got ${mergedSolids.length}`);
  }
  if (String(mergedSolids[0]?.name || '') !== IMPORT3D_MULTI_SOLIDS_ID) {
    throw new Error(`[import3d multi solids] Expected merged solid name to reset to feature ID, got ${String(mergedSolids[0]?.name || '')}`);
  }
}

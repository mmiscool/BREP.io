const IMPORT3D_DECIMATION_BASELINE_ID = 'IMPORT3D_DECIMATION_BASELINE';
const IMPORT3D_DECIMATION_REDUCED_ID = 'IMPORT3D_DECIMATION_REDUCED';
const IMPORT3D_DECIMATION_STABILITY_ID = 'IMPORT3D_DECIMATION_STABILITY';
const IMPORT3D_DECIMATION_RESTORE_ID = 'IMPORT3D_DECIMATION_RESTORE';
const IMPORT3D_DECIMATION_LEGACY_CACHE_ID = 'IMPORT3D_DECIMATION_LEGACY_CACHE';
const IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE_ID = 'IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE';

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

function buildCylinderStl({ radius = 6, height = 10, segments = 96 } = {}) {
  const segCount = Math.max(24, Number(segments) | 0);
  const r = Math.max(0.1, Number(radius) || 1);
  const h = Math.max(0.1, Number(height) || 1);
  const half = h * 0.5;
  const topCenter = [0, half, 0];
  const bottomCenter = [0, -half, 0];

  const lines = ['solid import3d_decimation_cylinder'];
  for (let i = 0; i < segCount; i += 1) {
    const t0 = (i / segCount) * Math.PI * 2;
    const t1 = ((i + 1) / segCount) * Math.PI * 2;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);

    const b0 = [r * c0, -half, r * s0];
    const b1 = [r * c1, -half, r * s1];
    const top0 = [r * c0, half, r * s0];
    const top1 = [r * c1, half, r * s1];

    appendFacet(lines, b0, b1, top1);
    appendFacet(lines, b0, top1, top0);
    appendFacet(lines, topCenter, top1, top0);
    appendFacet(lines, bottomCenter, b0, b1);
  }
  lines.push('endsolid import3d_decimation_cylinder');
  return lines.join('\n');
}

function createImportFeature(feature, fileToImport, decimationLevel) {
  feature.inputParams.id = feature.inputParams.featureID;
  feature.inputParams.fileToImport = fileToImport;
  feature.inputParams.centerMesh = false;
  feature.inputParams.deflectionAngle = 8;
  feature.inputParams.decimationLevel = decimationLevel;
  feature.inputParams.meshRepairLevel = 'NONE';
  feature.inputParams.extractPlanarFaces = false;
  feature.inputParams.segmentAnalyticPrimitives = false;
}

function hashSolidMeshSignature(solid) {
  const verts = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const tris = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  let hash = 0x811c9dc5 >>> 0;
  const mix = (n) => {
    hash ^= (n >>> 0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const mixString = (text) => {
    const s = String(text || '');
    for (let i = 0; i < s.length; i += 1) {
      mix(s.charCodeAt(i) & 0xff);
      mix((s.charCodeAt(i) >>> 8) & 0xff);
    }
  };
  for (let i = 0; i < verts.length; i += 1) {
    const n = Number(verts[i]);
    mixString(Number.isFinite(n) ? n.toFixed(9) : 'NaN');
  }
  for (let i = 0; i < tris.length; i += 1) mix(Number(tris[i]) | 0);
  return hash >>> 0;
}

function getSolidByName(partHistory, name) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  return solids.find((obj) => String(obj?.name || '') === name) || null;
}

function getSolidTriangleCount(solid) {
  return Math.floor((Array.isArray(solid?._triVerts) ? solid._triVerts.length : 0) / 3);
}

function getImportFeatureById(partHistory, id) {
  return (partHistory.features || []).find((entry) => (
    entry &&
    String(entry?.type || '').toUpperCase() === 'IMPORT3D' &&
    (
      String(entry?.inputParams?.featureID || '') === id ||
      String(entry?.inputParams?.id || '') === id
    )
  )) || null;
}

export async function test_import3d_decimation_reduces_triangle_count(partHistory) {
  const stlText = buildCylinderStl({ radius: 5, height: 10, segments: 96 });

  const baseline = await partHistory.newFeature('IMPORT3D');
  baseline.inputParams.featureID = IMPORT3D_DECIMATION_BASELINE_ID;
  createImportFeature(baseline, stlText, 100);

  const reduced = await partHistory.newFeature('IMPORT3D');
  reduced.inputParams.featureID = IMPORT3D_DECIMATION_REDUCED_ID;
  createImportFeature(reduced, stlText, 55);

  return partHistory;
}

export async function afterRun_import3d_decimation_reduces_triangle_count(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  if (!solids.length) throw new Error('[import3d decimation] No solids were generated');

  const baselineSolid = solids.find((obj) => String(obj?.name || '') === IMPORT3D_DECIMATION_BASELINE_ID);
  const reducedSolid = solids.find((obj) => String(obj?.name || '') === IMPORT3D_DECIMATION_REDUCED_ID);
  if (!baselineSolid || !reducedSolid) {
    throw new Error('[import3d decimation] Could not locate baseline and reduced solids');
  }

  const baselineTriangles = Math.floor((Array.isArray(baselineSolid._triVerts) ? baselineSolid._triVerts.length : 0) / 3);
  const reducedTriangles = Math.floor((Array.isArray(reducedSolid._triVerts) ? reducedSolid._triVerts.length : 0) / 3);

  if (!(baselineTriangles > 0)) {
    throw new Error('[import3d decimation] Baseline triangle count is invalid');
  }
  if (!(reducedTriangles > 0)) {
    throw new Error('[import3d decimation] Reduced triangle count is invalid');
  }
  if (!(reducedTriangles < baselineTriangles)) {
    throw new Error(
      `[import3d decimation] Expected reduced triangle count < baseline (${reducedTriangles} >= ${baselineTriangles})`,
    );
  }
}

export async function test_import3d_decimation_reapplies_from_cached_source_mesh(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.featureID = IMPORT3D_DECIMATION_STABILITY_ID;
  createImportFeature(
    import3d,
    buildCylinderStl({ radius: 5, height: 10, segments: 96 }),
    80,
  );
  return partHistory;
}

export async function afterRun_import3d_decimation_reapplies_from_cached_source_mesh(partHistory) {
  const feature = getImportFeatureById(partHistory, IMPORT3D_DECIMATION_STABILITY_ID);
  if (!feature) throw new Error('[import3d decimation stability] Import feature not found');

  const getSolidTriangleCount = () => {
    const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
    const solid = solids.find((obj) => String(obj?.name || '') === IMPORT3D_DECIMATION_STABILITY_ID);
    if (!solid) return 0;
    return Math.floor((Array.isArray(solid._triVerts) ? solid._triVerts.length : 0) / 3);
  };

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 55;
  await partHistory.runHistory();
  const first55 = getSolidTriangleCount();
  if (!(first55 > 0)) {
    throw new Error('[import3d decimation stability] First decimated rebuild produced no triangles');
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 55;
  await partHistory.runHistory();
  const second55 = getSolidTriangleCount();
  if (!(second55 > 0)) {
    throw new Error('[import3d decimation stability] Second decimated rebuild produced no triangles');
  }

  if (first55 !== second55) {
    throw new Error(
      `[import3d decimation stability] Expected stable triangle count when re-running same decimation level (${first55} !== ${second55})`,
    );
  }
}

export async function test_import3d_decimation_100_restores_original_geometry(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.featureID = IMPORT3D_DECIMATION_RESTORE_ID;
  createImportFeature(
    import3d,
    buildCylinderStl({ radius: 5, height: 10, segments: 96 }),
    100,
  );
  return partHistory;
}

export async function afterRun_import3d_decimation_100_restores_original_geometry(partHistory) {
  const feature = getImportFeatureById(partHistory, IMPORT3D_DECIMATION_RESTORE_ID);
  if (!feature) throw new Error('[import3d decimation restore] Import feature not found');

  const baselineSolid = getSolidByName(partHistory, IMPORT3D_DECIMATION_RESTORE_ID);
  if (!baselineSolid) throw new Error('[import3d decimation restore] Baseline solid not found');
  const baselineTriangles = getSolidTriangleCount(baselineSolid);
  const baselineHash = hashSolidMeshSignature(baselineSolid);

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 90;
  await partHistory.runHistory();
  const decimatedSolid = getSolidByName(partHistory, IMPORT3D_DECIMATION_RESTORE_ID);
  if (!decimatedSolid) throw new Error('[import3d decimation restore] Decimated solid not found');
  const decimatedTriangles = getSolidTriangleCount(decimatedSolid);
  if (!(decimatedTriangles < baselineTriangles)) {
    throw new Error(
      `[import3d decimation restore] Expected 90% decimation to reduce triangles (${decimatedTriangles} >= ${baselineTriangles})`,
    );
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 100;
  await partHistory.runHistory();
  const restoredSolid = getSolidByName(partHistory, IMPORT3D_DECIMATION_RESTORE_ID);
  if (!restoredSolid) throw new Error('[import3d decimation restore] Restored solid not found');

  const restoredTriangles = getSolidTriangleCount(restoredSolid);
  const restoredHash = hashSolidMeshSignature(restoredSolid);
  if (restoredTriangles !== baselineTriangles || restoredHash !== baselineHash) {
    throw new Error(
      `[import3d decimation restore] 100% did not restore original mesh (baseline triangles=${baselineTriangles}, restored triangles=${restoredTriangles}, baseline hash=${baselineHash}, restored hash=${restoredHash})`,
    );
  }
}

export async function test_import3d_decimation_seeds_source_snapshot_for_legacy_cache(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.featureID = IMPORT3D_DECIMATION_LEGACY_CACHE_ID;
  createImportFeature(
    import3d,
    buildCylinderStl({ radius: 5, height: 10, segments: 96 }),
    100,
  );
  return partHistory;
}

export async function afterRun_import3d_decimation_seeds_source_snapshot_for_legacy_cache(partHistory) {
  const feature = getImportFeatureById(partHistory, IMPORT3D_DECIMATION_LEGACY_CACHE_ID);
  if (!feature) throw new Error('[import3d decimation legacy cache] Import feature not found');

  if (!feature?.persistentData?.importCache) {
    throw new Error('[import3d decimation legacy cache] Missing import cache');
  }

  // Simulate a legacy project saved before sourceMeshSnapshot existed.
  delete feature.persistentData.importCache.sourceMeshSnapshot;

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 90;
  await partHistory.runHistory();
  const first90 = getSolidTriangleCount(getSolidByName(partHistory, IMPORT3D_DECIMATION_LEGACY_CACHE_ID));
  if (!(first90 > 0)) {
    throw new Error('[import3d decimation legacy cache] 90% pass produced no triangles');
  }
  if (!feature?.persistentData?.importCache?.sourceMeshSnapshot) {
    throw new Error('[import3d decimation legacy cache] Expected source mesh snapshot to be seeded');
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 80;
  await partHistory.runHistory();
  const at80 = getSolidTriangleCount(getSolidByName(partHistory, IMPORT3D_DECIMATION_LEGACY_CACHE_ID));
  if (!(at80 > 0 && at80 < first90)) {
    throw new Error(`[import3d decimation legacy cache] Expected 80% to reduce triangles (${at80} !< ${first90})`);
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 90;
  await partHistory.runHistory();
  const second90 = getSolidTriangleCount(getSolidByName(partHistory, IMPORT3D_DECIMATION_LEGACY_CACHE_ID));
  if (second90 !== first90) {
    throw new Error(
      `[import3d decimation legacy cache] 90% result changed after intermediate edit (${first90} !== ${second90})`,
    );
  }
}

export async function test_import3d_decimation_preserves_source_snapshot_without_json_clone(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.featureID = IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE_ID;
  createImportFeature(
    import3d,
    buildCylinderStl({ radius: 5, height: 10, segments: 96 }),
    100,
  );
  return partHistory;
}

export async function afterRun_import3d_decimation_preserves_source_snapshot_without_json_clone(partHistory) {
  const feature = getImportFeatureById(partHistory, IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE_ID);
  if (!feature) throw new Error('[import3d decimation snapshot resilience] Import feature not found');

  const baselineSolid = getSolidByName(partHistory, IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE_ID);
  if (!baselineSolid) throw new Error('[import3d decimation snapshot resilience] Baseline solid not found');
  const baselineTriangles = getSolidTriangleCount(baselineSolid);
  const baselineHash = hashSolidMeshSignature(baselineSolid);

  const initialSourceSnapshot = feature?.persistentData?.importCache?.sourceMeshSnapshot;
  if (!initialSourceSnapshot || !Array.isArray(initialSourceSnapshot.position)) {
    throw new Error('[import3d decimation snapshot resilience] Initial source mesh snapshot missing');
  }

  const originalStringify = JSON.stringify;
  try {
    JSON.stringify = function patchedStringify(value, replacer, space) {
      if (
        value &&
        typeof value === 'object' &&
        Array.isArray(value.position) &&
        value.position.length > 0 &&
        (Array.isArray(value.index) || Array.isArray(value.normal))
      ) {
        throw new Error('Synthetic stringify failure for mesh snapshot');
      }
      return originalStringify.call(JSON, value, replacer, space);
    };

    feature.inputParams.fileToImport = null;
    feature.inputParams.decimationLevel = 90;
    await partHistory.runHistory();
  } finally {
    JSON.stringify = originalStringify;
  }

  const snapshotAfter90 = feature?.persistentData?.importCache?.sourceMeshSnapshot;
  if (!snapshotAfter90 || !Array.isArray(snapshotAfter90.position)) {
    throw new Error('[import3d decimation snapshot resilience] Source snapshot was dropped after cached rebuild');
  }

  feature.inputParams.fileToImport = null;
  feature.inputParams.decimationLevel = 100;
  await partHistory.runHistory();
  const restoredSolid = getSolidByName(partHistory, IMPORT3D_DECIMATION_SNAPSHOT_CLONE_RESILIENCE_ID);
  if (!restoredSolid) throw new Error('[import3d decimation snapshot resilience] Restored solid not found');

  const restoredTriangles = getSolidTriangleCount(restoredSolid);
  const restoredHash = hashSolidMeshSignature(restoredSolid);
  if (restoredTriangles !== baselineTriangles || restoredHash !== baselineHash) {
    throw new Error(
      `[import3d decimation snapshot resilience] 100% did not restore baseline mesh (baseline triangles=${baselineTriangles}, restored triangles=${restoredTriangles}, baseline hash=${baselineHash}, restored hash=${restoredHash})`,
    );
  }
}

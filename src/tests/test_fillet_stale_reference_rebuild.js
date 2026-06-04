function findObjectByName(root, name) {
  if (!root || !name) return null;
  if (root.name === name) return root;
  let found = null;
  if (typeof root.traverse === 'function') {
    root.traverse((child) => {
      if (!found && child?.name === name) found = child;
    });
  }
  return found;
}

function makeOriginalFourEdgeSketch() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 0, y: 0, fixed: true, construction: false, externalReference: false },
      { id: 3, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
      { id: 5, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
      { id: 6, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
      { id: 7, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [0, 3], construction: false },
      { id: 2, type: 'line', points: [4, 1], construction: false },
      { id: 3, type: 'line', points: [5, 6], construction: false },
      { id: 4, type: 'line', points: [7, 2], construction: false },
    ],
    constraints: [],
  };
}

function makeExpandedSketchWithUnchangedFilletEdges() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 0, y: 0, fixed: true, construction: false, externalReference: false },
      { id: 3, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
      { id: 5, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
      { id: 6, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
      { id: 7, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
      { id: 9, x: -21.942782, y: -8.205132, fixed: false, construction: false, externalReference: false },
      { id: 10, x: -14.391155, y: -11.020762, fixed: false, construction: false, externalReference: false },
      { id: 12, x: -14.391155, y: -11.020762, fixed: false, construction: false, externalReference: false },
      { id: 13, x: -14.466292, y: 8.628587, fixed: false, construction: false, externalReference: false },
      { id: 14, x: -5.143845, y: 3.068105, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [0, 3], construction: false },
      { id: 2, type: 'line', points: [4, 1], construction: false },
      { id: 3, type: 'line', points: [5, 6], construction: false },
      { id: 6, type: 'line', points: [10, 9], construction: false },
      { id: 8, type: 'line', points: [7, 13], construction: false },
      { id: 9, type: 'line', points: [14, 2], construction: false },
      { id: 10, type: 'line', points: [14, 12], construction: false },
      { id: 11, type: 'line', points: [13, 9], construction: false },
    ],
    constraints: [],
  };
}

function getSolidFaceNames(solid) {
  if (!solid || typeof solid !== 'object') return new Set();
  if (typeof solid.getFaceNames === 'function') {
    try { return new Set(solid.getFaceNames()); } catch { /* ignore */ }
  }
  if (solid._faceNameToID instanceof Map) return new Set(solid._faceNameToID.keys());
  return new Set();
}

export async function test_fillet_rebuild_re_resolves_stale_edge_object(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.sizeX = 10;
  cube.inputParams.sizeY = 10;
  cube.inputParams.sizeZ = 10;

  const cubeId = cube.inputParams.featureID;
  const edgeName = `${cubeId}_NX|${cubeId}_PZ[0]`;

  const fillet = await partHistory.newFeature('F');
  fillet.inputParams.edges = [edgeName];
  fillet.inputParams.radius = 1;
  fillet.inputParams.direction = 'INSET';
  fillet.inputParams.resolution = 16;

  await partHistory.runHistory({ throwOnFeatureError: true });

  const staleSourceSolid = Array.isArray(fillet.effects?.removed) ? fillet.effects.removed[0] : null;
  if (!staleSourceSolid || staleSourceSolid.name !== cubeId) {
    throw new Error('[fillet stale reference] Initial fillet did not remove the source cube.');
  }

  const staleEdge = findObjectByName(staleSourceSolid, edgeName);
  if (!staleEdge || String(staleEdge.type || '').toUpperCase() !== 'EDGE') {
    throw new Error(`[fillet stale reference] Could not capture removed source edge "${edgeName}".`);
  }

  fillet.inputParams.edges = [staleEdge];
  cube.inputParams.sizeZ = 14;
  cube.dirty = true;

  await partHistory.runHistory({ throwOnFeatureError: true });

  const secondSourceSolid = Array.isArray(fillet.effects?.removed) ? fillet.effects.removed[0] : null;
  if (!secondSourceSolid || secondSourceSolid === staleSourceSolid) {
    throw new Error('[fillet stale reference] Fillet reused the removed pre-edit source solid.');
  }

  const liveEdge = findObjectByName(secondSourceSolid, edgeName);
  if (!liveEdge || liveEdge === staleEdge) {
    throw new Error('[fillet stale reference] Fillet did not resolve the stale edge object to the rebuilt source edge.');
  }

  const cacheStatus = fillet.persistentData?.filletProfiler?.cacheStatus || null;
  if (cacheStatus !== 'miss') {
    throw new Error(`[fillet stale reference] Expected upstream edit to miss fillet cache, received "${cacheStatus}".`);
  }

  fillet.inputParams.edges = [edgeName];
  fillet.dirty = true;
  await partHistory.runHistory({ throwOnFeatureError: true });

  console.log('✓ Fillet stale edge references re-resolve to rebuilt upstream geometry');
  return partHistory;
}

export async function test_fillet_cache_invalidates_when_target_solid_changes_away_from_selected_edges(partHistory) {
  const sketch = await partHistory.newFeature('S');
  Object.assign(sketch.inputParams, {
    id: 'S1',
    sketchPlane: null,
    curveResolution: 32,
  });
  sketch.persistentData = { sketch: makeOriginalFourEdgeSketch() };

  const extrude = await partHistory.newFeature('E');
  Object.assign(extrude.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 43.1,
    distanceBack: 73.4,
    boolean: {
      targets: [],
      operation: 'NONE',
    },
  });

  const fillet = await partHistory.newFeature('F');
  Object.assign(fillet.inputParams, {
    id: 'F3',
    edges: [
      'E2:S1:G2_SW|E2:S1:G3_SW[0]',
      'E2:S1:G1_SW|E2:S1:G2_SW[0]',
    ],
    radius: '9.5',
    resolution: 32,
    inflate: 0.1,
    nudgeFaceDistance: 0.0001,
    direction: 'AUTO',
    debug: 'NONE',
    showTangentOverlays: false,
  });

  await partHistory.runHistory({ throwOnFeatureError: true });
  if (fillet.persistentData?.filletProfiler?.cacheStatus !== 'miss') {
    throw new Error('[fillet target cache] Initial fillet run should build the cache.');
  }

  sketch.persistentData.sketch = makeExpandedSketchWithUnchangedFilletEdges();
  sketch.dirty = true;

  await partHistory.runHistory({ throwOnFeatureError: true });

  const cacheStatus = fillet.persistentData?.filletProfiler?.cacheStatus || null;
  if (cacheStatus !== 'miss') {
    throw new Error(`[fillet target cache] Expected changed source solid to miss fillet cache, received "${cacheStatus}".`);
  }

  const finalSolid = partHistory.getObjectByName('E2');
  const faceNames = getSolidFaceNames(finalSolid);
  for (const faceName of ['E2:S1:G8_SW', 'E2:S1:G9_SW', 'E2:S1:G10_SW', 'E2:S1:G11_SW']) {
    if (!faceNames.has(faceName)) {
      throw new Error(`[fillet target cache] Rebuilt fillet result is missing new source face "${faceName}".`);
    }
  }

  console.log('✓ Fillet cache invalidates when non-selected source faces change');
  return partHistory;
}

import * as THREE from 'three';

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

function findEdgeBetweenFaces(root, faceA, faceB) {
  const wanted = new Set([faceA, faceB]);
  let found = null;
  root?.traverse?.((child) => {
    if (found || String(child?.type || '').toUpperCase() !== 'EDGE') return;
    const a = child?.userData?.faceA || null;
    const b = child?.userData?.faceB || null;
    if (wanted.has(a) && wanted.has(b) && a !== b) found = child;
  });
  return found;
}

function getObjectTimestamp(obj, label) {
  const timestamp = Number(obj?.timestamp ?? obj?.userData?.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`[history timestamp scope] Missing timestamp for ${label}.`);
  }
  return timestamp;
}

function waitForTimestampTick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

export async function test_history_delete_restores_removed_upstream_solid_from_source_feature(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'C1',
    sizeX: 4,
    sizeY: 4,
    sizeZ: 4,
  });

  const shell = await partHistory.newFeature('O.S');
  Object.assign(shell.inputParams, {
    id: 'OS2',
    faces: ['C1_PZ'],
    distance: 1,
    replaceOriginalSolid: true,
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  const liveShell = partHistory.getObjectByName('C1_OS2');
  if (!liveShell) {
    throw new Error('[history delete restore] Expected offset shell result C1_OS2.');
  }

  const removedCube = Array.isArray(shell.effects?.removed) ? shell.effects.removed[0] : null;
  if (!removedCube || removedCube.name !== 'C1') {
    throw new Error('[history delete restore] Expected shell feature to remove upstream cube C1.');
  }
  if (removedCube.owningFeatureID !== 'C1') {
    throw new Error(`[history delete restore] Removed upstream cube ownership was overwritten as ${removedCube.owningFeatureID}.`);
  }

  const ghostGroup = new THREE.Group();
  ghostGroup.name = '__REF_SELECTION_ADDED_GHOSTS__OS2';
  ghostGroup.userData = {
    preventRemove: true,
    excludeFromFit: true,
    referenceSelectionGhost: true,
  };
  const ghostSolid = new THREE.Group();
  ghostSolid.name = 'C1_OS2';
  ghostSolid.type = 'SOLID';
  ghostGroup.add(ghostSolid);

  partHistory.scene.remove(liveShell);
  partHistory.scene.add(ghostGroup);
  partHistory.scene.add(liveShell);
  const resolvedShell = partHistory.getObjectByName('C1_OS2');
  if (resolvedShell !== liveShell) {
    throw new Error('[history delete restore] Live object lookup resolved a reference-selection ghost before the real shell.');
  }

  const initialCubeOutput = Array.isArray(cube.effects?.added) ? cube.effects.added[0] : null;
  await partHistory.removeFeature('OS2');
  await partHistory.runHistory({ throwOnFeatureError: true });

  const restoredCube = partHistory.getObjectByName('C1');
  if (!restoredCube) {
    throw new Error('[history delete restore] Expected C1 to be restored after deleting OS2.');
  }
  if (partHistory.getObjectByName('C1_OS2')) {
    throw new Error('[history delete restore] Deleted shell output C1_OS2 still resolves as a live history object.');
  }
  if (restoredCube === initialCubeOutput) {
    throw new Error('[history delete restore] Restored cube reused the pre-delete live object cache.');
  }
  if (restoredCube.owningFeatureID !== 'C1') {
    throw new Error(`[history delete restore] Restored cube has wrong owner ${restoredCube.owningFeatureID}.`);
  }

  const restoredFaces = getSolidFaceNames(restoredCube);
  if (!restoredFaces.has('C1_PZ')) {
    throw new Error('[history delete restore] Restored cube is missing its original C1_PZ face.');
  }

  console.log('✓ Deleting a downstream feature rebuilds and restores removed upstream solids');
  return partHistory;
}

export async function test_reference_selection_timestamp_scope_preserves_unchanged_edge_cache(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'C1',
    sizeX: 4,
    sizeY: 4,
    sizeZ: 4,
  });

  const push = await partHistory.newFeature('PF');
  Object.assign(push.inputParams, {
    id: 'PF1',
    faces: ['C1_PZ'],
    distance: 1,
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  let pushedSolid = partHistory.getObjectByName('C1');
  let stableEdge = findEdgeBetweenFaces(pushedSolid, 'C1_NX', 'C1_NZ');
  if (!stableEdge) {
    throw new Error('[history timestamp scope] Could not find stable bottom edge after push-face.');
  }

  const tube = await partHistory.newFeature('TU');
  Object.assign(tube.inputParams, {
    id: 'TU1',
    path: [stableEdge.name],
    radius: 0.15,
    innerRadius: 0,
    resolution: 8,
    mode: 'Light (fast)',
    boolean: { targets: [], operation: 'NONE' },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  pushedSolid = partHistory.getObjectByName('C1');
  stableEdge = findEdgeBetweenFaces(pushedSolid, 'C1_NX', 'C1_NZ');
  let movedEdge = findEdgeBetweenFaces(pushedSolid, 'C1_NX', 'C1_PZ');
  if (!stableEdge || !movedEdge) {
    throw new Error('[history timestamp scope] Missing expected pushed-solid edges before rerun.');
  }
  const firstStableEdgeTimestamp = getObjectTimestamp(stableEdge, stableEdge.name);
  const firstMovedEdgeTimestamp = getObjectTimestamp(movedEdge, movedEdge.name);
  const firstTubeTimestamp = getObjectTimestamp(tube, 'tube feature');

  await waitForTimestampTick();
  push.inputParams.distance = 2;
  await partHistory.runHistory({ throwOnFeatureError: true });

  pushedSolid = partHistory.getObjectByName('C1');
  stableEdge = findEdgeBetweenFaces(pushedSolid, 'C1_NX', 'C1_NZ');
  movedEdge = findEdgeBetweenFaces(pushedSolid, 'C1_NX', 'C1_PZ');
  if (!stableEdge || !movedEdge) {
    throw new Error('[history timestamp scope] Missing expected pushed-solid edges after rerun.');
  }

  const secondStableEdgeTimestamp = getObjectTimestamp(stableEdge, stableEdge.name);
  const secondMovedEdgeTimestamp = getObjectTimestamp(movedEdge, movedEdge.name);
  const secondTubeTimestamp = getObjectTimestamp(tube, 'tube feature');

  if (secondStableEdgeTimestamp !== firstStableEdgeTimestamp) {
    throw new Error('[history timestamp scope] Unchanged selected edge timestamp changed after parent solid rerun.');
  }
  if (secondMovedEdgeTimestamp <= firstMovedEdgeTimestamp) {
    throw new Error('[history timestamp scope] Changed edge timestamp did not advance after parent solid rerun.');
  }
  if (secondTubeTimestamp !== firstTubeTimestamp) {
    throw new Error('[history timestamp scope] Edge-scoped tube reran even though its selected edge geometry was unchanged.');
  }

  console.log('✓ Reference selection timestamp scope preserves unchanged edge caches');
  return partHistory;
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

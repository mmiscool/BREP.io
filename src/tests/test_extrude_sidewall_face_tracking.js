import * as THREE from 'three';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getSolidFaceNames(solid) {
  if (!solid || typeof solid !== 'object') return [];
  if (typeof solid.getFaceNames === 'function') {
    try { return solid.getFaceNames(); } catch { /* ignore */ }
  }
  if (solid._faceNameToID instanceof Map) return Array.from(solid._faceNameToID.keys());
  return [];
}

function getTrackedFaceId(solid, faceName) {
  if (!solid || typeof solid !== 'object') return null;
  if (solid._faceNameToID instanceof Map && solid._faceNameToID.has(faceName)) {
    return solid._faceNameToID.get(faceName);
  }
  if (solid._idToFaceName instanceof Map) {
    for (const [id, name] of solid._idToFaceName.entries()) {
      if (name === faceName) return id;
    }
  }
  return null;
}

function assertDistinctTrackedFaces(solid, faceNames, context) {
  const ids = faceNames.map((faceName) => getTrackedFaceId(solid, faceName));
  const missing = faceNames.filter((_, index) => ids[index] == null);
  assert(missing.length === 0, `${context} Missing face tracking IDs for: ${missing.join(', ')}`);
  const distinct = new Set(ids.map((id) => String(id)));
  assert(
    distinct.size === faceNames.length,
    `${context} Expected distinct face IDs for ${faceNames.join(', ')}, got ${ids.join(', ')}`,
  );
}

function makeRectangleSketch() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: 2, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 8, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 3, x: 8, y: 2, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 8, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 5, x: 8, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 6, x: 2, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 7, x: 2, y: 8, fixed: false, construction: false, externalReference: false },
      { id: 8, x: 2, y: 2, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [1, 2], construction: false },
      { id: 2, type: 'line', points: [3, 4], construction: false },
      { id: 3, type: 'line', points: [5, 6], construction: false },
      { id: 4, type: 'line', points: [7, 8], construction: false },
    ],
    constraints: [
      { id: 0, type: '⏚', points: [0] },
      { id: 1, type: '≡', points: [2, 3] },
      { id: 2, type: '≡', points: [4, 5] },
      { id: 3, type: '≡', points: [6, 7] },
      { id: 4, type: '≡', points: [8, 1] },
    ],
  };
}

function makeGeneratedHistoryBaseSketch() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: -7.158141, y: -7.907776, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 8.426984, y: 5.71041, fixed: false, construction: false, externalReference: false },
      { id: 3, x: -7.158141, y: -7.907776, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
      { id: 5, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
      { id: 6, x: 8.426984, y: 5.71041, fixed: false, construction: false, externalReference: false },
      { id: 7, x: -6.291516, y: 6.590214, fixed: false, construction: false, externalReference: false },
      { id: 8, x: -6.291516, y: 6.590214, fixed: false, construction: false, externalReference: false },
      { id: 9, x: -1.237185, y: 0.019114, fixed: false, construction: false, externalReference: false },
      { id: 10, x: -2.794092, y: -2.205038, fixed: false, construction: false, externalReference: false },
      { id: 11, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
      { id: 12, x: 7.484115, y: -11.495576, fixed: false, construction: false, externalReference: false },
      { id: 13, x: -7.437728, y: -13.144076, fixed: false, construction: false, externalReference: false },
      { id: 14, x: -2.88781, y: -12.825321, fixed: false, construction: false, externalReference: false },
      { id: 15, x: -4.301049, y: -12.388265, fixed: false, construction: false, externalReference: false },
      { id: 16, x: -5.585603, y: -11.991006, fixed: false, construction: false, externalReference: false },
      { id: 17, x: 2.463262, y: -12.023261, fixed: false, construction: false, externalReference: false },
      { id: 18, x: 0.123113, y: -13.639996, fixed: false, construction: false, externalReference: false },
      { id: 19, x: -1.794938, y: -14.965129, fixed: false, construction: false, externalReference: false },
      { id: 20, x: 5.529604, y: -10.376861, fixed: false, construction: false, externalReference: false },
      { id: 21, x: 3.628537, y: -11.397603, fixed: false, construction: false, externalReference: false },
      { id: 22, x: 2.463262, y: -12.023261, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [1, 4], construction: true },
      { id: 2, type: 'line', points: [5, 2], construction: false },
      { id: 3, type: 'line', points: [6, 7], construction: false },
      { id: 4, type: 'line', points: [8, 3], construction: false },
      { id: 5, type: 'circle', points: [9, 10], construction: false },
      { id: 6, type: 'bezier', points: [11, 12, 20, 21, 22, 17, 18, 19, 14, 15, 16, 13, 1], construction: false },
      { id: 7, type: 'line', points: [11, 12], construction: true },
      { id: 8, type: 'line', points: [1, 13], construction: true },
      { id: 9, type: 'line', points: [15, 14], construction: true },
      { id: 10, type: 'line', points: [15, 16], construction: true },
      { id: 11, type: 'line', points: [18, 17], construction: true },
      { id: 12, type: 'line', points: [18, 19], construction: true },
      { id: 13, type: 'line', points: [21, 20], construction: true },
      { id: 14, type: 'line', points: [21, 22], construction: true },
    ],
    constraints: [],
  };
}

function makeGeneratedHistoryS22Sketch() {
  return {
    points: [
      { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
      { id: 1, x: -3.800787, y: -3.701602, fixed: false, construction: false, externalReference: false },
      { id: 2, x: 3.150132, y: 3.59845, fixed: false, construction: false, externalReference: false },
      { id: 3, x: -3.800787, y: -3.701602, fixed: false, construction: false, externalReference: false },
      { id: 4, x: 3.150132, y: -3.701602, fixed: false, construction: false, externalReference: false },
      { id: 5, x: 3.150132, y: -3.701602, fixed: false, construction: false, externalReference: false },
      { id: 6, x: 3.150132, y: 3.59845, fixed: false, construction: false, externalReference: false },
      { id: 7, x: -3.800787, y: 3.59845, fixed: false, construction: false, externalReference: false },
      { id: 8, x: -3.800787, y: 3.59845, fixed: false, construction: false, externalReference: false },
    ],
    geometries: [
      { id: 1, type: 'line', points: [1, 4], construction: false },
      { id: 2, type: 'line', points: [5, 2], construction: false },
      { id: 3, type: 'line', points: [6, 7], construction: false },
      { id: 4, type: 'line', points: [8, 3], construction: false },
    ],
    constraints: [],
  };
}

function expectedExtrudeFaceNames(extrudeId = 'E2', sketchId = 'S1') {
  return [
    `${extrudeId}:${sketchId}:PROFILE_START`,
    `${extrudeId}:${sketchId}:PROFILE_END`,
    `${extrudeId}:${sketchId}:G1_SW`,
    `${extrudeId}:${sketchId}:G2_SW`,
    `${extrudeId}:${sketchId}:G3_SW`,
    `${extrudeId}:${sketchId}:G4_SW`,
  ];
}

async function addRectangleSketch(partHistory, id = 'S1') {
  const sketch = await partHistory.newFeature('S');
  Object.assign(sketch.inputParams, {
    id,
    sketchPlane: null,
    curveResolution: 32,
  });
  sketch.persistentData = { sketch: makeRectangleSketch() };
  return sketch;
}

export async function test_extrude_rectangle_profile_has_one_sidewall_per_sketch_edge(partHistory) {
  await addRectangleSketch(partHistory, 'S1');

  const extrude = await partHistory.newFeature('E');
  Object.assign(extrude.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 1,
    boolean: { targets: [], operation: 'NONE' },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  const solid = partHistory.getObjectByName('E2');
  assert(solid, '[extrude sidewalls] Expected extrude output E2.');
  const faceNames = getSolidFaceNames(solid);
  const expected = expectedExtrudeFaceNames('E2', 'S1');
  for (const faceName of expected) {
    assert(faceNames.includes(faceName), `[extrude sidewalls] Missing face ${faceName}. Faces: ${faceNames.join(', ')}`);
  }
  assert(faceNames.length === expected.length, `[extrude sidewalls] Expected exactly 6 faces, received ${faceNames.length}: ${faceNames.join(', ')}`);
  assertDistinctTrackedFaces(solid, expected, '[extrude sidewalls]');

  console.log('✓ Rectangle extrude keeps one side wall face per sketch edge');
  return partHistory;
}

export async function test_subtract_extrude_preserves_rectangle_tool_sidewall_faces(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'C1',
    sizeX: 10,
    sizeY: 10,
    sizeZ: 10,
  });

  await addRectangleSketch(partHistory, 'S1');

  const cut = await partHistory.newFeature('E');
  Object.assign(cut.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 12,
    distanceBack: 1,
    boolean: {
      targets: ['C1'],
      operation: 'SUBTRACT',
      overlapConditioningEnabled: true,
    },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  const result = partHistory.getObjectByName('C1');
  assert(result, '[extrude subtract sidewalls] Expected boolean result C1.');
  const faceNames = getSolidFaceNames(result);
  const sidewallNames = expectedExtrudeFaceNames('E2', 'S1').filter((name) => name.endsWith('_SW'));
  for (const faceName of sidewallNames) {
    assert(faceNames.includes(faceName), `[extrude subtract sidewalls] Missing cut sidewall ${faceName}. Faces: ${faceNames.join(', ')}`);
  }
  assertDistinctTrackedFaces(result, sidewallNames, '[extrude subtract sidewalls]');

  console.log('✓ Subtract extrude preserves one tool side wall face per sketch edge');
  return partHistory;
}

export async function test_subtract_restore_rejects_raw_tool_added_snapshot(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'C1',
    sizeX: 10,
    sizeY: 10,
    sizeZ: 10,
  });

  await addRectangleSketch(partHistory, 'S1');

  const cut = await partHistory.newFeature('E');
  Object.assign(cut.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 12,
    distanceBack: 1,
    boolean: {
      targets: ['C1'],
      operation: 'SUBTRACT',
      overlapConditioningEnabled: true,
    },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });
  assert(partHistory.getObjectByName('C1'), '[subtract stale cache] Expected initial subtract result C1.');

  const addedSnapshot = cut.effectSnapshots?.added?.[0] || null;
  assert(addedSnapshot, '[subtract stale cache] Expected subtract feature to have an added snapshot.');
  addedSnapshot.name = 'E2';
  addedSnapshot.type = 'SOLID';
  cut.dirty = false;

  await partHistory.runHistory({ throwOnFeatureError: true });
  assert(partHistory.getObjectByName('C1'), '[subtract stale cache] Expected subtract result C1 after stale cache rejection.');
  assertNoLiveSolidNamed(partHistory, 'E2', '[subtract stale cache]');

  console.log('✓ Subtract replay rejects raw-tool added snapshots');
  return partHistory;
}

export async function test_generated_history_20260609042734_preserves_s22_subtract_sidewalls(partHistory) {
  partHistory.expressions = '//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n';

  const sketch1 = await partHistory.newFeature('S');
  Object.assign(sketch1.inputParams, {
    id: 'S1',
    sketchPlane: null,
    curveResolution: 'resolution',
  });
  sketch1.persistentData = { sketch: makeGeneratedHistoryBaseSketch() };

  const extrude1 = await partHistory.newFeature('E');
  Object.assign(extrude1.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: 'NONE', overlapConditioningEnabled: true },
  });

  const revolve = await partHistory.newFeature('R');
  Object.assign(revolve.inputParams, {
    id: 'R3',
    profile: 'E2:S1:PROFILE_START',
    consumeProfileSketch: true,
    axis: 'E2:S1:G3_SW|E2:S1:PROFILE_START[0]',
    angle: 53,
    resolution: 'resolution',
    boolean: {
      targets: ['E2'],
      operation: 'UNION',
      overlapConditioningEnabled: false,
    },
  });

  const shell = await partHistory.newFeature('O.S');
  Object.assign(shell.inputParams, {
    id: 'O.S17',
    distance: '-.5',
    faces: ['E2:S1:PROFILE_START_END'],
    replaceOriginalSolid: true,
    debugSeparateRoundedCornerPipe: false,
    roundedCornerAreaLossDetectionEnabled: true,
    roundedCornerPipeSliverCollapseEnabled: true,
    roundedCornerAreaLossReassignEnabled: true,
    roundedCornerCleanupRollbackEnabled: true,
    debugMode: 'NORMAL',
  });

  const sketch2 = await partHistory.newFeature('S');
  Object.assign(sketch2.inputParams, {
    id: 'S22',
    sketchPlane: 'E2:S1:G3_SW_END',
    curveResolution: 'resolution',
  });
  sketch2.persistentData = { sketch: makeGeneratedHistoryS22Sketch() };

  const cut = await partHistory.newFeature('E');
  Object.assign(cut.inputParams, {
    id: 'E26',
    profile: 'S22:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: '1',
    boolean: {
      targets: ['E2_O.S17'],
      operation: 'SUBTRACT',
      overlapConditioningEnabled: true,
    },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  const result = partHistory.getObjectByName('E2_O.S17');
  assert(result, '[generated 20260609042734] Expected final target solid E2_O.S17.');
  const faceNames = getSolidFaceNames(result);
  const sidewallNames = expectedExtrudeFaceNames('E26', 'S22').filter((name) => name.endsWith('_SW'));
  for (const faceName of sidewallNames) {
    assert(faceNames.includes(faceName), `[generated 20260609042734] Missing S22 cut sidewall ${faceName}. Faces: ${faceNames.join(', ')}`);
  }
  assertDistinctTrackedFaces(result, sidewallNames, '[generated 20260609042734]');

  console.log('✓ Generated history 20260609042734 preserves S22 subtract side walls');
  return partHistory;
}

function assertNoLiveSolidNamed(partHistory, name, context) {
  let found = null;
  try {
    partHistory.scene?.traverse?.((obj) => {
      if (found) return;
      if (String(obj?.type || '').toUpperCase() === 'SOLID' && obj?.name === name) found = obj;
    });
  } catch { /* ignore */ }
  assert(!found, `${context} Unexpected live solid named ${name}.`);
}

function resolveParentSolidName(obj) {
  let cursor = obj || null;
  let guard = 0;
  while (cursor && guard < 64) {
    if (String(cursor?.type || '').toUpperCase() === 'SOLID') return cursor.name || null;
    cursor = cursor.parentSolid || cursor.parent || null;
    guard += 1;
  }
  return null;
}

function assertEdgeRefsResolveToSolid(partHistory, edgeRefs, expectedSolidName, context) {
  for (const edgeRef of edgeRefs) {
    const resolved = partHistory.getObjectByName(edgeRef);
    assert(resolved, `${context} Could not resolve ${edgeRef}.`);
    const parentSolidName = resolveParentSolidName(resolved);
    assert(
      parentSolidName === expectedSolidName,
      `${context} ${edgeRef} resolved under ${parentSolidName || '(none)'} instead of ${expectedSolidName}.`,
    );
  }
}

function boundaryPolylineLength(edge) {
  const points = Array.isArray(edge?.positions) ? edge.positions : [];
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!Array.isArray(previous) || !Array.isArray(current)) continue;
    length += Math.hypot(
      Number(current[0]) - Number(previous[0]),
      Number(current[1]) - Number(previous[1]),
      Number(current[2]) - Number(previous[2]),
    );
  }
  return length;
}

function assertSingleBoundaryBetweenFaces(solid, faceA, faceB, context) {
  assert(solid && typeof solid.getBoundaryEdgePolylines === 'function', `${context} Expected boundary query support.`);
  const matching = (solid.getBoundaryEdgePolylines() || []).filter((edge) => {
    const a = String(edge?.faceA || '');
    const b = String(edge?.faceB || '');
    return (a === faceA && b === faceB) || (a === faceB && b === faceA);
  });
  assert(
    matching.length === 1,
    `${context} Expected one boundary between ${faceA} and ${faceB}, found ${matching.length}: `
      + matching.map((edge) => `${edge?.name || '(unnamed)'}:${boundaryPolylineLength(edge).toFixed(6)}`).join(', '),
  );
}

export function test_feature_edge_name_resolution_prefers_boolean_result_over_raw_tool(partHistory) {
  const edgeRef = 'E23:S22:G1_SW|E23:S22:G2_SW[0]';

  const rawTool = new THREE.Group();
  rawTool.type = 'SOLID';
  rawTool.name = 'E23';
  rawTool.owningFeatureID = 'E23';
  const rawEdge = new THREE.Group();
  rawEdge.type = 'EDGE';
  rawEdge.name = edgeRef;
  rawEdge.owningFeatureID = 'E23';
  rawEdge.parentSolid = rawTool;
  rawTool.add(rawEdge);

  const booleanResult = new THREE.Group();
  booleanResult.type = 'SOLID';
  booleanResult.name = 'E2_O.S17';
  booleanResult.owningFeatureID = 'E23';
  const resultEdge = new THREE.Group();
  resultEdge.type = 'EDGE';
  resultEdge.name = edgeRef;
  resultEdge.owningFeatureID = 'E23';
  resultEdge.parentSolid = booleanResult;
  booleanResult.add(resultEdge);

  partHistory.scene.add(rawTool);
  partHistory.scene.add(booleanResult);

  const resolved = partHistory.getObjectByName(edgeRef);
  assert(resolved === resultEdge, '[feature edge resolution] Duplicate feature edge name resolved to raw tool instead of boolean result.');

  console.log('✓ Feature edge name resolution prefers boolean result over raw tool');
  return partHistory;
}

export async function test_run_history_calls_are_serialized(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'C1',
    sizeX: 4,
    sizeY: 4,
    sizeZ: 4,
  });

  let activeRuns = 0;
  let maxActiveRuns = 0;
  let callbackCalls = 0;
  const previousRunCallback = partHistory.callbacks.run;
  partHistory.callbacks.run = async () => {
    callbackCalls += 1;
    activeRuns += 1;
    maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRuns -= 1;
  };

  try {
    await Promise.all([
      partHistory.runHistory({ throwOnFeatureError: true }),
      partHistory.runHistory({ throwOnFeatureError: true }),
    ]);
  } finally {
    if (previousRunCallback) partHistory.callbacks.run = previousRunCallback;
    else delete partHistory.callbacks.run;
  }

  assert(callbackCalls >= 2, '[run history serialization] Expected both queued runs to execute.');
  assert(maxActiveRuns === 1, `[run history serialization] Concurrent runHistory callbacks overlapped (${maxActiveRuns}).`);
  assert(partHistory.getObjectByName('C1'), '[run history serialization] Expected final scene to contain C1.');

  console.log('✓ Concurrent runHistory calls are serialized');
  return partHistory;
}

async function addGeneratedHistoryThroughE23(partHistory) {
  partHistory.expressions = '//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n';

  const sketch1 = await partHistory.newFeature('S');
  Object.assign(sketch1.inputParams, {
    id: 'S1',
    sketchPlane: null,
    curveResolution: 'resolution',
  });
  sketch1.persistentData = { sketch: makeGeneratedHistoryBaseSketch() };

  const extrude1 = await partHistory.newFeature('E');
  Object.assign(extrude1.inputParams, {
    id: 'E2',
    profile: 'S1:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: 'NONE', overlapConditioningEnabled: true },
  });

  const revolve = await partHistory.newFeature('R');
  Object.assign(revolve.inputParams, {
    id: 'R3',
    profile: 'E2:S1:PROFILE_START',
    consumeProfileSketch: true,
    axis: 'E2:S1:G3_SW|E2:S1:PROFILE_START[0]',
    angle: 53,
    resolution: 'resolution',
    boolean: {
      targets: ['E2'],
      operation: 'UNION',
      overlapConditioningEnabled: false,
    },
  });

  const shell = await partHistory.newFeature('O.S');
  Object.assign(shell.inputParams, {
    id: 'O.S17',
    distance: '-.5',
    faces: ['E2:S1:PROFILE_START_END'],
    replaceOriginalSolid: true,
    debugSeparateRoundedCornerPipe: false,
    roundedCornerAreaLossDetectionEnabled: true,
    roundedCornerPipeSliverCollapseEnabled: true,
    roundedCornerAreaLossReassignEnabled: true,
    roundedCornerCleanupRollbackEnabled: true,
    debugMode: 'NORMAL',
  });

  const sketch2 = await partHistory.newFeature('S');
  Object.assign(sketch2.inputParams, {
    id: 'S22',
    sketchPlane: 'E2:S1:G3_SW_END',
    curveResolution: 'resolution',
  });
  sketch2.persistentData = { sketch: makeGeneratedHistoryS22Sketch() };

  const cut = await partHistory.newFeature('E');
  Object.assign(cut.inputParams, {
    id: 'E23',
    profile: 'S22:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 3.5,
    boolean: {
      targets: ['E2_O.S17'],
      operation: 'SUBTRACT',
      overlapConditioningEnabled: true,
    },
  });

  return { sketch1, extrude1, revolve, shell, sketch2, cut };
}

export async function test_generated_history_20260609045351_fillet_expanded_replay_uses_subtract_result(partHistory) {
  await addGeneratedHistoryThroughE23(partHistory);
  const edgeRefs = [
    'E23:S22:G1_SW|E23:S22:G2_SW[0]',
    'E23:S22:G1_SW|E23:S22:G4_SW[0]',
    'E23:S22:G3_SW|E23:S22:G4_SW[0]',
    'E23:S22:G2_SW|E23:S22:G3_SW[0]',
  ];

  const fillet = await partHistory.newFeature('F');
  Object.assign(fillet.inputParams, {
    id: 'F26',
    edges: edgeRefs,
    radius: 1,
    resolution: 'resolution',
    direction: 'AUTO',
    debug: 'NONE',
    inflate: 0,
    nudgeFaceDistance: 0.0001,
    renameFaces: true,
  });

  await partHistory.runHistory({ throwOnFeatureError: true });
  const finalSolid = partHistory.getObjectByName('E2_O.S17');
  assert(finalSolid, '[generated 20260609045351] Expected final filleted solid E2_O.S17.');
  assertSingleBoundaryBetweenFaces(
    finalSolid,
    'E2:S1:G2_SW_START',
    'E2:S1:G2_SW_END',
    '[generated 20260609045351 full replay]',
  );
  assertNoLiveSolidNamed(partHistory, 'E23', '[generated 20260609045351 full replay]');

  partHistory.currentHistoryStepId = 'F26';
  await partHistory.runHistory({ throwOnFeatureError: true });
  const expandedSolid = partHistory.getObjectByName('E2_O.S17');
  assert(expandedSolid, '[generated 20260609045351] Expected expanded replay solid E2_O.S17.');
  assertSingleBoundaryBetweenFaces(
    expandedSolid,
    'E2:S1:G2_SW_START',
    'E2:S1:G2_SW_END',
    '[generated 20260609045351 expanded replay]',
  );
  assertNoLiveSolidNamed(partHistory, 'E23', '[generated 20260609045351 expanded replay]');

  await partHistory.runHistory({ throwOnFeatureError: true, stopBeforeFeatureId: 'F26' });
  const preFilletTarget = partHistory.getObjectByName('E2_O.S17');
  assert(preFilletTarget, '[generated 20260609045351] Expected pre-fillet target E2_O.S17.');
  assertEdgeRefsResolveToSolid(partHistory, edgeRefs, 'E2_O.S17', '[generated 20260609045351 pre-fillet refs]');
  assertNoLiveSolidNamed(partHistory, 'E23', '[generated 20260609045351 pre-fillet replay]');

  console.log('✓ Generated history 20260609045351 fillet expansion resolves subtract-result edges');
  return partHistory;
}

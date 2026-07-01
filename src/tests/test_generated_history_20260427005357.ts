import { manifoldBuildSource } from '../BREP/setupManifold.js';

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

function assertNoExcessiveRepairCaps(solid, label) {
  const diagnostics = solid?.__thickenDiagnostics || {};
  const sourceTriangles = Math.max(1, Number(diagnostics.sourceTriangleCount) || 1);
  const capTriangles = Math.max(0, Number(diagnostics.boundaryCapTriangleCount) || 0);
  assert(
    capTriangles <= Math.max(32, sourceTriangles * 16),
    `[${label}] ${solid.name} generated excessive repair caps: boundaryCapTriangleCount=${capTriangles}, sourceTriangleCount=${sourceTriangles}.`,
  );
}

export async function test_generated_history_20260427005357(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  partHistory.expressions = '//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n';
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature('D');
  Object.assign(feature1.inputParams, {
    id: 'D1',
    transform: {
      position: [3.3933600572696956, 7.871131156996574, 4.477523481078175],
      rotationEuler: [26.501360840664976, 31.900969676610398, 5.9119378272310765],
      scale: [1, 1, 1],
    },
  });

  const feature2 = await partHistory.newFeature('S');
  Object.assign(feature2.inputParams, {
    id: 'S2',
    sketchPlane: 'D1:YZ',
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 'resolution',
  });
  feature2.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -20.633919, y: -28.143771, fixed: false, construction: false, externalReference: false },
        { id: 3, x: -20.633919, y: -28.143771, fixed: false, construction: false, externalReference: false },
        { id: 4, x: -1.788275, y: -28.801008, fixed: false, construction: false, externalReference: false },
        { id: 5, x: -1.788275, y: -28.801008, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -19.066353, y: 12.549009, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -19.066353, y: 12.549009, fixed: false, construction: false, externalReference: false },
        { id: 10, x: 36.343169, y: 9.236573, fixed: false, construction: false, externalReference: false },
        { id: 11, x: 36.343169, y: 9.236573, fixed: false, construction: false, externalReference: false },
        { id: 12, x: 23.611174, y: 23.11733, fixed: false, construction: false, externalReference: false },
        { id: 13, x: 23.611174, y: 23.11733, fixed: false, construction: false, externalReference: false },
        { id: 14, x: -19.066353, y: 12.549009, fixed: false, construction: false, externalReference: false },
        { id: 15, x: -1.098446, y: -0.4332, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: 'line', points: [1, 4], construction: false },
        { id: 4, type: 'line', points: [8, 3], construction: false },
        { id: 6, type: 'line', points: [11, 12], construction: false },
        { id: 7, type: 'line', points: [13, 14], construction: false },
        { id: 8, type: 'line', points: [5, 15], construction: false },
        { id: 9, type: 'line', points: [15, 10], construction: false },
      ],
      constraints: [
        { id: 0, type: '⏚', points: [0], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '0:0,0,1;' },
        { id: 1, type: '≡', points: [1, 3], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '1:-20.633919,-28.143771,0;3:-20.633919,-28.143771,0;' },
        { id: 2, type: '≡', points: [4, 5], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '4:-1.788275,-28.801008,0;5:-1.788275,-28.801008,0;' },
        { id: 4, type: '≡', points: [7, 8], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '7:-19.066353,12.549009,0;8:-19.066353,12.549009,0;' },
        { id: 8, type: '≡', points: [10, 11], labelX: 0, labelY: 0, displayStyle: '', value: null, valueNeedsSetup: true, status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '10:36.343169,9.236573,0;11:36.343169,9.236573,0;' },
        { id: 9, type: '≡', points: [12, 13], labelX: 0, labelY: 0, displayStyle: '', value: null, valueNeedsSetup: true, status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '12:23.611174,23.11733,0;13:23.611174,23.11733,0;' },
        { id: 10, type: '≡', points: [7, 14], labelX: 0, labelY: 0, displayStyle: '', value: null, valueNeedsSetup: true, status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '7:-19.066353,12.549009,0;14:-19.066353,12.549009,0;' },
      ],
    },
  };

  const feature3 = await partHistory.newFeature('E');
  Object.assign(feature3.inputParams, {
    id: 'E3',
    profile: 'S2:PROFILE',
    consumeProfileSketch: true,
    distance: 19.5,
    distanceBack: 20.3,
    boolean: { targets: [], operation: 'NONE', overlapConditioningEnabled: true },
  });

  const feature4 = await partHistory.newFeature('F');
  Object.assign(feature4.inputParams, {
    id: 'F4',
    edges: [
      'E3:S2:G1_SW|E3:S2:G4_SW[0]',
      'E3:S2:G1_SW|E3:S2:G8_SW[0]',
      'E3:S2:G8_SW|E3:S2:G9_SW[0]',
      'E3:S2:G6_SW|E3:S2:G9_SW[0]',
      'E3:S2:G6_SW|E3:S2:G7_SW[0]',
      'E3:S2:G4_SW|E3:S2:G7_SW[0]',
    ],
    radius: '4',
    resolution: 'resolution',
    inflate: 0.1,
    nudgeFaceDistance: 0.0001,
    simplifyResult: true,
    cleanupNativeTinyFaceIslands: true,
    mergeCoplanarEndCaps: true,
    reassignSliverTriangles: true,
    collapseTinyTriangles: true,
    cleanupPostCollapseTinyFaceIslands: true,
    direction: 'AUTO',
    debug: 'NONE',
  });

  const feature5 = await partHistory.newFeature('S');
  Object.assign(feature5.inputParams, {
    id: 'S5',
    sketchPlane: 'E3:S2:G8_SW',
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 'resolution',
  });
  feature5.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -6.86055, y: -5.376867, fixed: false, construction: false, externalReference: false },
        { id: 2, x: -1.327535, y: -5.783019, fixed: false, construction: false, externalReference: false },
        { id: 3, x: 15.644084, y: -4.533575, fixed: false, construction: false, externalReference: false },
        { id: 4, x: 18.155102, y: 2.188373, fixed: false, construction: false, externalReference: false },
        { id: 5, x: -6.023401, y: 5.918983, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -6.023401, y: 5.918983, fixed: false, construction: false, externalReference: false },
        { id: 9, x: 18.155102, y: 2.188373, fixed: false, construction: false, externalReference: false },
        { id: 10, x: -5.355786, y: -3.037608, fixed: false, construction: false, externalReference: false },
        { id: 11, x: -2.190031, y: -1.205176, fixed: false, construction: false, externalReference: false },
        { id: 12, x: -0.02383, y: 0.048685, fixed: false, construction: false, externalReference: false },
        { id: 13, x: 6.951459, y: 1.526626, fixed: false, construction: false, externalReference: false },
        { id: 14, x: 8.745348, y: -0.552752, fixed: false, construction: false, externalReference: false },
        { id: 15, x: 11.822995, y: -4.120191, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: 'bezier', points: [1, 2, 10, 11, 12, 13, 14, 15, 3, 4], construction: false },
        { id: 2, type: 'line', points: [1, 2], construction: true },
        { id: 3, type: 'line', points: [4, 3], construction: true },
        { id: 4, type: 'line', points: [1, 5], construction: false },
        { id: 6, type: 'line', points: [8, 9], construction: false },
        { id: 7, type: 'line', points: [11, 10], construction: true },
        { id: 8, type: 'line', points: [11, 12], construction: true },
        { id: 9, type: 'line', points: [14, 13], construction: true },
        { id: 10, type: 'line', points: [14, 15], construction: true },
      ],
      constraints: [
        { id: 0, type: '⏚', points: [0], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '0:0,0,1;' },
        { id: 3, type: '≡', points: [4, 9], labelX: 0, labelY: 0, displayStyle: '', value: null, valueNeedsSetup: true, status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '4:18.155102,2.188373,0;9:18.155102,2.188373,0;' },
        { id: 4, type: '≡', points: [8, 5], labelX: 0, labelY: 0, displayStyle: '', value: null, valueNeedsSetup: true, status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '8:-6.023401,5.918983,0;5:-6.023401,5.918983,0;' },
      ],
    },
  };

  const feature6 = await partHistory.newFeature('E');
  Object.assign(feature6.inputParams, {
    id: 'E7',
    profile: 'S5:PROFILE',
    consumeProfileSketch: true,
    distance: 38,
    distanceBack: 10,
    boolean: { targets: ['E3'], operation: 'UNION', overlapConditioningEnabled: true },
  });

  const feature7 = await partHistory.newFeature('THK');
  Object.assign(feature7.inputParams, {
    id: 'THK11',
    face: [
      'F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer',
      'E7:S5:G6_SW',
      'E3:S2:PROFILE_START',
      'F4_FILLET_E3_S2_G8_SW_E3_S2_G9_SW_a386a4b0_2_TUBE_Outer',
      'E3:S2:G9_SW',
      'E7:S5:G1_SW',
      'E7:S5:G4_SW',
      'E3:S2:G8_SW',
      'E3:S2:PROFILE_END',
      'F4_FILLET_E3_S2_G6_SW_E3_S2_G9_SW_ac21e33a_3_TUBE_Outer',
      'E3:S2:G6_SW',
      'F4_FILLET_E3_S2_G6_SW_E3_S2_G7_SW_9f79c830_4_TUBE_Outer',
      'E3:S2:G1_SW',
    ],
    distance: '1',
  });

  return partHistory;
}

export async function afterRun_generated_history_20260427005357(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  const feature = (partHistory.features || []).find((entry) => String(entry?.inputParams?.id || '') === 'THK11');
  assert(feature, '[generated_history_20260427005357] Expected THK11 feature entry.');
  assert(
    !Array.isArray(feature.persistentData?.failures) || feature.persistentData.failures.length === 0,
    `[generated_history_20260427005357] Expected no thicken failures, received ${JSON.stringify(feature.persistentData?.failures || [])}.`,
  );

  const solids = (partHistory.scene?.children || []).filter(
    (obj) => obj?.type === 'SOLID' && String(obj?.owningFeatureID || '') === 'THK11',
  );
  assert(solids.length === 13, `[generated_history_20260427005357] Expected 13 thickened solids, received ${solids.length}.`);
  for (const solid of solids) {
    const topology = analyzeMeshTopology(solid);
    assert(
      topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0,
      `[generated_history_20260427005357] ${solid.name} is not closed: boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
    assert(
      solid.__thickenDiagnostics?.buildMethod === 'triangle_split_cull',
      `[generated_history_20260427005357] ${solid.name} did not use triangle split/cull thicken.`,
    );
    assert(
      !solid.__thickenDiagnostics?.splitCullFallback,
      `[generated_history_20260427005357] ${solid.name} used a non-strict thicken fallback.`,
    );
    assertNoExcessiveRepairCaps(solid, 'generated_history_20260427005357');
  }
}

export async function test_generated_history_20260427005357_nine_face_thicken(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  await test_generated_history_20260427005357(partHistory);
  const feature = (partHistory.features || [])[partHistory.features.length - 1];
  Object.assign(feature.inputParams, {
    id: 'THK8',
    face: [
      'E3:S2:G7_SW',
      'F4_FILLET_E3_S2_G6_SW_E3_S2_G7_SW_9f79c830_4_TUBE_Outer',
      'F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer',
      'E7:S5:G1_SW',
      'E3:S2:G8_SW',
      'F4_FILLET_E3_S2_G8_SW_E3_S2_G9_SW_a386a4b0_2_TUBE_Outer',
      'E3:S2:G9_SW',
      'F4_FILLET_E3_S2_G6_SW_E3_S2_G9_SW_ac21e33a_3_TUBE_Outer',
      'E3:S2:G6_SW',
    ],
    distance: '1',
  });
  return partHistory;
}

export async function afterRun_generated_history_20260427005357_nine_face_thicken(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  const feature = (partHistory.features || []).find((entry) => String(entry?.inputParams?.id || '') === 'THK8');
  assert(feature, '[generated_history_20260427005357_nine_face_thicken] Expected THK8 feature entry.');
  assert(
    !Array.isArray(feature.persistentData?.failures) || feature.persistentData.failures.length === 0,
    `[generated_history_20260427005357_nine_face_thicken] Expected no thicken failures, received ${JSON.stringify(feature.persistentData?.failures || [])}.`,
  );

  const solids = (partHistory.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && String(obj?.owningFeatureID || '') === 'THK8')
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  assert(solids.length === 9, `[generated_history_20260427005357_nine_face_thicken] Expected 9 individual thickened solids, received ${solids.length}.`);
  for (const solid of solids) {
    const topology = analyzeMeshTopology(solid);
    assert(
      topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0,
      `[generated_history_20260427005357_nine_face_thicken] ${solid.name} is not closed: boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
    assert(
      solid.__thickenDiagnostics?.buildMethod === 'triangle_split_cull',
      `[generated_history_20260427005357_nine_face_thicken] ${solid.name} did not use triangle split/cull thicken.`,
    );
    assert(
      solid.__thickenDiagnostics?.sourceFaceCount === 1,
      `[generated_history_20260427005357_nine_face_thicken] ${solid.name} should be a single-face thicken result.`,
    );
    assertNoExcessiveRepairCaps(solid, 'generated_history_20260427005357_nine_face_thicken');
  }
}

export async function test_generated_history_20260427005357_three_face_thicken(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  await test_generated_history_20260427005357(partHistory);
  const feature = (partHistory.features || [])[partHistory.features.length - 1];
  Object.assign(feature.inputParams, {
    id: 'THK8',
    face: [
      'F4_FILLET_E3_S2_G4_SW_E3_S2_G7_SW_a10871de_5_TUBE_Outer',
      'E3:S2:G7_SW',
      'E3:S2:G4_SW',
    ],
    distance: '5',
  });
  return partHistory;
}

export async function afterRun_generated_history_20260427005357_three_face_thicken(partHistory) {
  if (manifoldBuildSource !== 'local') return;

  const feature = (partHistory.features || []).find((entry) => String(entry?.inputParams?.id || '') === 'THK8');
  assert(feature, '[generated_history_20260427005357_three_face_thicken] Expected THK8 feature entry.');
  assert(
    !Array.isArray(feature.persistentData?.failures) || feature.persistentData.failures.length === 0,
    `[generated_history_20260427005357_three_face_thicken] Expected no thicken failures, received ${JSON.stringify(feature.persistentData?.failures || [])}.`,
  );

  const solids = (partHistory.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && String(obj?.owningFeatureID || '') === 'THK8')
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  assert(solids.length === 3, `[generated_history_20260427005357_three_face_thicken] Expected 3 individual thickened solids, received ${solids.length}.`);
  for (const solid of solids) {
    const topology = analyzeMeshTopology(solid);
    assert(
      topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0,
      `[generated_history_20260427005357_three_face_thicken] ${solid.name} is not closed: boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
    assert(
      solid.__thickenDiagnostics?.buildMethod === 'triangle_split_cull',
      `[generated_history_20260427005357_three_face_thicken] ${solid.name} did not use triangle split/cull thicken.`,
    );
    assert(
      solid.__thickenDiagnostics?.sourceFaceCount === 1,
      `[generated_history_20260427005357_three_face_thicken] ${solid.name} should be a single-face thicken result.`,
    );
  }
}

import { PartHistory } from '../PartHistory.js';
import { Solid } from '../BREP/BetterSolid.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0 };
  const counts = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
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
  return { boundaryEdgeCount, nonManifoldEdgeCount };
}

function assertClosedManifold(solid, label) {
  assert(solid?.type === 'SOLID', `[${label}] Expected a SOLID result.`);
  const topology = analyzeMeshTopology(solid);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[${label}] Expected a closed manifold result. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
  }
  if (typeof solid._isCoherentlyOrientedManifold === 'function' && solid._isCoherentlyOrientedManifold() !== true) {
    throw new Error(`[${label}] Result failed coherent manifold orientation check.`);
  }
}

function getFaceNamesSet(solid) {
  return new Set(typeof solid?.getFaceNames === 'function' ? solid.getFaceNames() : []);
}

function listFaceNamesByRegex(solid, regex) {
  return Array.from(getFaceNamesSet(solid)).filter((name) => regex.test(String(name || ''))).sort((a, b) => a.localeCompare(b));
}

function assertSidewallsConnectToCaps(solid, label, startFaceName, endFaceName, sidewallNames) {
  const boundaries = typeof solid?.getBoundaryEdgePolylines === 'function'
    ? (solid.getBoundaryEdgePolylines() || [])
    : [];
  const normalizePair = (faceA, faceB) => [String(faceA || ''), String(faceB || '')]
    .sort((a, b) => a.localeCompare(b))
    .join('|');
  const actualPairs = new Set(boundaries.map((edge) => normalizePair(edge?.faceA, edge?.faceB)));
  for (const sidewallName of sidewallNames) {
    assert(
      actualPairs.has(normalizePair(startFaceName, sidewallName)),
      `[${label}] Expected sidewall "${sidewallName}" to meet start cap "${startFaceName}".`,
    );
    assert(
      actualPairs.has(normalizePair(endFaceName, sidewallName)),
      `[${label}] Expected sidewall "${sidewallName}" to meet end cap "${endFaceName}".`,
    );
  }
}

function averageFaceTriangleRadiusXZ(solid, faceName, yBand = null) {
  const face = typeof solid?.getFace === 'function' ? solid.getFace(faceName) : null;
  assert(Array.isArray(face) && face.length > 0, `Expected face "${faceName}" to exist on solid "${solid?.name || ''}".`);
  let sum = 0;
  let count = 0;
  for (const tri of face) {
    const points = [tri?.p1, tri?.p2, tri?.p3];
    if (!points.every((point) => Array.isArray(point) && point.length >= 3)) continue;
    const cx = (points[0][0] + points[1][0] + points[2][0]) / 3;
    const cy = (points[0][1] + points[1][1] + points[2][1]) / 3;
    const cz = (points[0][2] + points[1][2] + points[2][2]) / 3;
    if (Number.isFinite(yBand) && Math.abs(cy) > yBand) continue;
    sum += Math.hypot(cx, cz);
    count += 1;
  }
  return count ? (sum / count) : 0;
}

function makeRectSketch(x0, y0, x1, y1, geomBase = 100) {
  return {
    points: [
      { id: 0, x: x0, y: y0, fixed: true },
      { id: 1, x: x1, y: y0, fixed: false },
      { id: 2, x: x1, y: y1, fixed: false },
      { id: 3, x: x0, y: y1, fixed: false },
    ],
    geometries: [
      { id: geomBase + 0, type: 'line', points: [0, 1], construction: false },
      { id: geomBase + 1, type: 'line', points: [1, 2], construction: false },
      { id: geomBase + 2, type: 'line', points: [2, 3], construction: false },
      { id: geomBase + 3, type: 'line', points: [3, 0], construction: false },
    ],
    constraints: [{ id: 0, type: '⏚', points: [0] }],
  };
}

function makeRingSketch() {
  return {
    points: [
      { id: 10, x: -5, y: -5, fixed: false },
      { id: 11, x: 5, y: -5, fixed: false },
      { id: 12, x: 5, y: 5, fixed: false },
      { id: 13, x: -5, y: 5, fixed: false },
      { id: 20, x: -3, y: -3, fixed: false },
      { id: 21, x: 3, y: -3, fixed: false },
      { id: 22, x: 3, y: 3, fixed: false },
      { id: 23, x: -3, y: 3, fixed: false },
    ],
    geometries: [
      { id: 200, type: 'line', points: [10, 11], construction: false },
      { id: 201, type: 'line', points: [11, 12], construction: false },
      { id: 202, type: 'line', points: [12, 13], construction: false },
      { id: 203, type: 'line', points: [13, 10], construction: false },
      { id: 210, type: 'line', points: [20, 21], construction: false },
      { id: 211, type: 'line', points: [21, 22], construction: false },
      { id: 212, type: 'line', points: [22, 23], construction: false },
      { id: 213, type: 'line', points: [23, 20], construction: false },
    ],
    constraints: [],
  };
}

async function buildSketchProfileFace(partHistory, featureId, sketchData) {
  const sketch = await partHistory.newFeature('S');
  sketch.inputParams.id = featureId;
  sketch.persistentData.sketch = sketchData;
  await partHistory.runHistory();
  const face = partHistory.getObjectByName(`${featureId}:PROFILE`);
  assert(face?.type === 'FACE', `Expected sketch profile face "${featureId}:PROFILE".`);
  return face;
}

async function buildCylinderSideFace(partHistory, featureId, radius, height, resolution = 48) {
  const cylinder = await partHistory.newFeature('P.CY');
  cylinder.inputParams.id = featureId;
  cylinder.inputParams.radius = radius;
  cylinder.inputParams.height = height;
  cylinder.inputParams.resolution = resolution;
  await partHistory.runHistory();
  const face = partHistory.getObjectByName(`${featureId}_S`);
  assert(face?.type === 'FACE', `Expected cylinder side face "${featureId}_S".`);
  return face;
}

async function buildTorusSideFace(partHistory, featureId, majorRadius, tubeRadius, arcDegrees, resolution = 32) {
  const torus = await partHistory.newFeature('P.T');
  torus.inputParams.id = featureId;
  torus.inputParams.majorRadius = majorRadius;
  torus.inputParams.tubeRadius = tubeRadius;
  torus.inputParams.arc = arcDegrees;
  torus.inputParams.resolution = resolution;
  await partHistory.runHistory();
  const face = partHistory.getObjectByName(`${featureId}_Side`);
  assert(face?.type === 'FACE', `Expected torus side face "${featureId}_Side".`);
  return face;
}

async function buildFilletedCubeTopFace(partHistory, featureId) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.id = featureId;
  cube.inputParams.sizeX = 8;
  cube.inputParams.sizeY = 6;
  cube.inputParams.sizeZ = 4;

  const fillet = await partHistory.newFeature('F');
  fillet.inputParams.id = `${featureId}_FILLET`;
  fillet.inputParams.edges = [`${featureId}_PZ`];
  fillet.inputParams.radius = 0.75;
  fillet.inputParams.direction = 'INSET';

  await partHistory.runHistory();
  const face = partHistory.getObjectByName(`${featureId}_PZ`);
  assert(face?.type === 'FACE', `Expected filleted top face "${featureId}_PZ".`);
  return face;
}

export async function test_face_thicken_planar_profile(partHistory) {
  const face = await buildSketchProfileFace(partHistory, 'THICK_PLANAR_SRC', makeRectSketch(0, 0, 10, 6));
  const solid = face.thicken(2, { featureId: 'THICK_PLANAR' });
  assertClosedManifold(solid, 'thicken-planar');

  const actualFaceNames = getFaceNamesSet(solid);
  assert(actualFaceNames.has('THICK_PLANAR_SRC:PROFILE_START'), '[thicken-planar] Missing start face.');
  assert(actualFaceNames.has('THICK_PLANAR_SRC:PROFILE_END'), '[thicken-planar] Missing end face.');
  const sidewalls = listFaceNamesByRegex(solid, /^THICK_PLANAR_SRC:PROFILE_E\d+_SW$/);
  assert(sidewalls.length === 4, `[thicken-planar] Expected 4 per-edge sidewalls, received ${sidewalls.length}.`);
  assertSidewallsConnectToCaps(
    solid,
    'thicken-planar',
    'THICK_PLANAR_SRC:PROFILE_START',
    'THICK_PLANAR_SRC:PROFILE_END',
    sidewalls,
  );

  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-planar] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Math.abs(volume - 120) <= 1e-3, `[thicken-planar] Expected volume 120, received ${volume}.`);
}

export async function test_face_thicken_hole_profile(partHistory) {
  const face = await buildSketchProfileFace(partHistory, 'THICK_RING_SRC', makeRingSketch());
  const solid = face.thicken(2, { featureId: 'THICK_RING' });
  assertClosedManifold(solid, 'thicken-hole');

  const faceNames = getFaceNamesSet(solid);
  assert(faceNames.has('THICK_RING_SRC:PROFILE_START'), '[thicken-hole] Missing start face.');
  assert(faceNames.has('THICK_RING_SRC:PROFILE_END'), '[thicken-hole] Missing end face.');
  const outerSidewalls = listFaceNamesByRegex(solid, /^THICK_RING_SRC:PROFILE_E\d+_SW$/);
  const innerSidewalls = listFaceNamesByRegex(solid, /^THICK_RING_SRC:PROFILE_L1_E\d+_SW$/);
  assert(outerSidewalls.length === 4, `[thicken-hole] Expected 4 outer sidewalls, received ${outerSidewalls.length}.`);
  assert(innerSidewalls.length === 4, `[thicken-hole] Expected 4 inner sidewalls, received ${innerSidewalls.length}.`);
  assertSidewallsConnectToCaps(
    solid,
    'thicken-hole-outer',
    'THICK_RING_SRC:PROFILE_START',
    'THICK_RING_SRC:PROFILE_END',
    outerSidewalls,
  );
  assertSidewallsConnectToCaps(
    solid,
    'thicken-hole-inner',
    'THICK_RING_SRC:PROFILE_START',
    'THICK_RING_SRC:PROFILE_END',
    innerSidewalls,
  );

  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-hole] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Math.abs(volume - 128) <= 1e-3, `[thicken-hole] Expected volume 128, received ${volume}.`);
}

export async function test_face_thicken_curved_cylinder_side(partHistory) {
  const face = await buildCylinderSideFace(partHistory, 'THICK_CURVED_SRC', 3, 8, 64);
  const solid = face.thicken(0.75, { featureId: 'THICK_CURVED' });
  assertClosedManifold(solid, 'thicken-curved');

  const faceNames = getFaceNamesSet(solid);
  assert(faceNames.has('THICK_CURVED_SRC_S_START'), '[thicken-curved] Missing start face.');
  assert(faceNames.has('THICK_CURVED_SRC_S_END'), '[thicken-curved] Missing end face.');
  const outerSidewalls = listFaceNamesByRegex(solid, /^THICK_CURVED_SRC_S_E\d+_SW$/);
  const innerSidewalls = listFaceNamesByRegex(solid, /^THICK_CURVED_SRC_S_L1_E\d+_SW$/);
  assert(outerSidewalls.length > 0, '[thicken-curved] Expected per-edge sidewalls on the first boundary loop.');
  assert(innerSidewalls.length > 0, '[thicken-curved] Expected per-edge sidewalls on the second boundary loop.');

  const sourceRadius = averageFaceTriangleRadiusXZ(solid, 'THICK_CURVED_SRC_S_START');
  const offsetRadius = averageFaceTriangleRadiusXZ(solid, 'THICK_CURVED_SRC_S_END');
  assert(
    offsetRadius > sourceRadius + 0.45,
    `[thicken-curved] Expected offset face to sit radially outside the source face, received ${sourceRadius} vs ${offsetRadius}.`,
  );
  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-curved] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
}

export async function test_face_thicken_filleted_planar_face_keeps_clean_boundaries(partHistory) {
  const face = await buildFilletedCubeTopFace(partHistory, 'THICK_FILLETED_SRC');
  const solid = face.thicken(1.25, { featureId: 'THICK_FILLETED' });
  assertClosedManifold(solid, 'thicken-filleted-planar');

  const faceNames = getFaceNamesSet(solid);
  assert(faceNames.has('THICK_FILLETED_SRC_PZ_START'), '[thicken-filleted-planar] Missing start face.');
  assert(faceNames.has('THICK_FILLETED_SRC_PZ_END'), '[thicken-filleted-planar] Missing end face.');
  const sidewalls = listFaceNamesByRegex(solid, /^THICK_FILLETED_SRC_PZ_(?:L\d+_)?E\d+_SW$/);
  assert(sidewalls.length > 0, '[thicken-filleted-planar] Expected per-edge sidewalls.');
  assertSidewallsConnectToCaps(
    solid,
    'thicken-filleted-planar',
    'THICK_FILLETED_SRC_PZ_START',
    'THICK_FILLETED_SRC_PZ_END',
    sidewalls,
  );

  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-filleted-planar] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
}

export async function test_face_thicken_self_overlap_cylinder_side(partHistory) {
  const face = await buildCylinderSideFace(partHistory, 'THICK_SELF_SRC', 1, 6, 32);
  const solid = face.thicken(-1.25, { featureId: 'THICK_SELF' });
  assertClosedManifold(solid, 'thicken-self-overlap');

  const diagnostics = solid?.__thickenDiagnostics || null;
  assert(diagnostics && Number.isFinite(diagnostics.sourceTriangleCount), '[thicken-self-overlap] Missing diagnostics.');
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-self-overlap] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
  assert(
    (diagnostics.triangleSplitCount || 0) > 0,
    '[thicken-self-overlap] Expected triangle intersections to be split.',
  );
  assert(
    (diagnostics.culledTriangleCount || 0) > 0,
    '[thicken-self-overlap] Expected internal triangles to be culled.',
  );
  assert(
    (diagnostics.boundaryCapTriangleCount || 0) > 0,
    '[thicken-self-overlap] Expected split/cull boundary loops to be capped with triangles.',
  );
  assert((typeof solid.volume === 'function' ? solid.volume() : 0) > 0, '[thicken-self-overlap] Expected a positive-volume solid.');
}

export async function test_face_thicken_partial_torus_side_avoids_internal_voids(partHistory) {
  const face = await buildTorusSideFace(partHistory, 'THICK_TORUS_SRC', 10, 4, 201, 32);
  const solid = face.thicken(3, { featureId: 'THICK_TORUS' });
  assertClosedManifold(solid, 'thicken-partial-torus');

  const faceNames = getFaceNamesSet(solid);
  assert(faceNames.has('THICK_TORUS_SRC_Side_START'), '[thicken-partial-torus] Missing start face.');
  assert(faceNames.has('THICK_TORUS_SRC_Side_END'), '[thicken-partial-torus] Missing end face.');
  const outerSidewalls = listFaceNamesByRegex(solid, /^THICK_TORUS_SRC_Side_E\d+_SW$/);
  const innerSidewalls = listFaceNamesByRegex(solid, /^THICK_TORUS_SRC_Side_L1_E\d+_SW$/);
  assert(outerSidewalls.length > 0, '[thicken-partial-torus] Expected per-edge sidewalls on the first boundary loop.');
  assert(innerSidewalls.length > 0, '[thicken-partial-torus] Expected per-edge sidewalls on the second boundary loop.');

  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    diagnostics.buildMethod === 'triangle_split_cull',
    `[thicken-partial-torus] Expected triangle split/cull build path, received ${diagnostics.buildMethod || 'unknown'}.`,
  );
  assert(
    Number.isFinite(Number(diagnostics.splitCullPasses)) && diagnostics.splitCullPasses >= 1,
    '[thicken-partial-torus] Expected triangle split/cull diagnostics.',
  );

  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Number.isFinite(volume) && volume > 1000, `[thicken-partial-torus] Expected positive torus-shell volume, received ${volume}.`);
}

export async function test_face_thicken_boundary_uses_smooth_adjacent_face_normals() {
  const parent = new Solid();
  const tilt = Math.tan(Math.PI / 9);
  parent.addTriangle('SMOOTH_A', [0, 0, 0], [1, 0, 0], [1, 1, 0]);
  parent.addTriangle('SMOOTH_A', [0, 0, 0], [1, 1, 0], [0, 1, 0]);
  parent.addTriangle('SMOOTH_B', [1, 0, 0], [2, 0, tilt], [2, 1, tilt]);
  parent.addTriangle('SMOOTH_B', [1, 0, 0], [2, 1, tilt], [1, 1, 0]);
  parent.visualize({ authoringOnly: true, showEdges: false });

  const face = parent.getObjectByName('SMOOTH_A');
  assert(face?.type === 'FACE', '[thicken-smooth-boundary] Expected authored source face.');

  const solid = face.thicken(2, { featureId: 'THICK_SMOOTH_BOUNDARY' });
  assertClosedManifold(solid, 'thicken-smooth-boundary');

  const diagnostics = solid?.__thickenDiagnostics || {};
  assert(
    (diagnostics.adjacentBoundaryNormalContributionCount || 0) >= 2,
    '[thicken-smooth-boundary] Expected tangent adjacent face normals to contribute at the boundary.',
  );

  const endFace = typeof solid.getFace === 'function' ? solid.getFace('SMOOTH_A_END') : [];
  const endXs = [];
  for (const tri of endFace || []) {
    for (const point of [tri?.p1, tri?.p2, tri?.p3]) {
      if (Array.isArray(point) && point.length >= 3) endXs.push(point[0]);
    }
  }
  const maxEndX = Math.max(...endXs);
  assert(
    maxEndX < 0.9,
    `[thicken-smooth-boundary] Expected the offset boundary to follow the smooth neighbor normal field; max x=${maxEndX}.`,
  );
}

export async function test_thicken_feature_serializes_and_replays_planar_profile(partHistory) {
  const sketch = await partHistory.newFeature('S');
  sketch.inputParams.id = 'THICK_FEATURE_SRC';
  sketch.persistentData.sketch = makeRectSketch(0, 0, 4, 3);

  const thicken = await partHistory.newFeature('THK');
  thicken.inputParams.id = 'THICK_FEATURE';
  thicken.inputParams.face = 'THICK_FEATURE_SRC:PROFILE';
  thicken.inputParams.distance = 1.5;

  return partHistory;
}

export async function test_thicken_feature_multiple_faces_produce_multiple_solids(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.id = 'THICK_MULTI_SRC';
  cube.inputParams.sizeX = 4;
  cube.inputParams.sizeY = 3;
  cube.inputParams.sizeZ = 2;

  const thicken = await partHistory.newFeature('THK');
  thicken.inputParams.id = 'THICK_MULTI';
  thicken.inputParams.face = ['THICK_MULTI_SRC_PZ', 'THICK_MULTI_SRC_NZ'];
  thicken.inputParams.distance = 1.25;

  return partHistory;
}

export async function test_thicken_feature_connected_faces_remain_individual_solids(partHistory) {
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.id = 'THICK_PATCH_SRC';
  cube.inputParams.sizeX = 4;
  cube.inputParams.sizeY = 3;
  cube.inputParams.sizeZ = 2;

  const thicken = await partHistory.newFeature('THK');
  thicken.inputParams.id = 'THICK_PATCH';
  thicken.inputParams.face = ['THICK_PATCH_SRC_PZ', 'THICK_PATCH_SRC_PX'];
  thicken.inputParams.distance = 1;

  return partHistory;
}

export async function afterRun_thicken_feature_serializes_and_replays_planar_profile(partHistory) {
  const solid = partHistory.scene.getObjectByName('THICK_FEATURE');
  assertClosedManifold(solid, 'thicken-feature');

  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Math.abs(volume - 18) <= 1e-3, `[thicken-feature] Expected volume 18, received ${volume}.`);

  const featureEntry = (partHistory.features || []).find((entry) => String(entry?.type || '').toUpperCase() === 'THK');
  assert(featureEntry?.persistentData?.diagnostics, '[thicken-feature] Expected thicken diagnostics to be stored in persistentData.');

  const json = await partHistory.toJSON();
  const replay = new PartHistory();
  await replay.fromJSON(json);
  await replay.runHistory();
  const replaySolid = replay.scene.getObjectByName('THICK_FEATURE');
  assertClosedManifold(replaySolid, 'thicken-feature-replay');

  const replayVolume = typeof replaySolid.volume === 'function' ? replaySolid.volume() : NaN;
  assert(Math.abs(replayVolume - volume) <= 1e-6, `[thicken-feature] Replay volume mismatch ${replayVolume} vs ${volume}.`);

  const expectedFaceNames = (typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []).slice().sort();
  const replayFaceNames = (typeof replaySolid.getFaceNames === 'function' ? replaySolid.getFaceNames() : []).slice().sort();
  assert(
    JSON.stringify(replayFaceNames) === JSON.stringify(expectedFaceNames),
    `[thicken-feature] Replay face names mismatch. Expected ${JSON.stringify(expectedFaceNames)}, received ${JSON.stringify(replayFaceNames)}.`,
  );
}

export async function afterRun_thicken_feature_multiple_faces_produce_multiple_solids(partHistory) {
  const featureEntry = (partHistory.features || []).find((entry) => String(entry?.inputParams?.id || '').trim() === 'THICK_MULTI');
  assert(featureEntry, '[thicken-feature-multi] Expected THICK_MULTI feature entry.');
  const featureId = String(featureEntry?.inputParams?.featureID || featureEntry?.inputParams?.id || '').trim();
  assert(featureId, '[thicken-feature-multi] Missing feature id.');

  const solids = (partHistory.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && obj?.owningFeatureID === featureId)
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  assert(solids.length === 2, `[thicken-feature-multi] Expected 2 solids, received ${solids.length}.`);

  const expectedNames = [
    'THICK_MULTI_01_THICK_MULTI_SRC_PZ',
    'THICK_MULTI_02_THICK_MULTI_SRC_NZ',
  ];
  const actualNames = solids.map((solid) => String(solid?.name || ''));
  assert(
    JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    `[thicken-feature-multi] Expected solid names ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}.`,
  );

  for (const solid of solids) {
    assertClosedManifold(solid, `thicken-feature-multi:${solid.name}`);
    const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
    assert(Math.abs(volume - 15) <= 1e-3, `[thicken-feature-multi] Expected volume 15 for ${solid.name}, received ${volume}.`);
  }

  assert(Array.isArray(featureEntry?.persistentData?.results), '[thicken-feature-multi] Expected persistentData.results.');
  assert(featureEntry.persistentData.results.length === 2, '[thicken-feature-multi] Expected two persistent result records.');
  assert(Array.isArray(featureEntry?.persistentData?.diagnostics), '[thicken-feature-multi] Expected diagnostics array for multi-face thicken.');

  const json = await partHistory.toJSON();
  const replay = new PartHistory();
  await replay.fromJSON(json);
  await replay.runHistory();

  const replayFeatureEntry = (replay.features || []).find((entry) => String(entry?.inputParams?.id || '').trim() === 'THICK_MULTI');
  const replayFeatureId = String(replayFeatureEntry?.inputParams?.featureID || replayFeatureEntry?.inputParams?.id || '').trim();
  const replayNames = (replay.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && obj?.owningFeatureID === replayFeatureId)
    .map((solid) => String(solid?.name || ''))
    .sort();
  assert(
    JSON.stringify(replayNames) === JSON.stringify(expectedNames),
    `[thicken-feature-multi] Replay names mismatch. Expected ${JSON.stringify(expectedNames)}, received ${JSON.stringify(replayNames)}.`,
  );
}

export async function afterRun_thicken_feature_connected_faces_remain_individual_solids(partHistory) {
  const featureEntry = (partHistory.features || []).find((entry) => String(entry?.inputParams?.id || '').trim() === 'THICK_PATCH');
  assert(featureEntry, '[thicken-feature-patch] Expected THICK_PATCH feature entry.');
  const featureId = String(featureEntry?.inputParams?.featureID || featureEntry?.inputParams?.id || '').trim();
  assert(featureId, '[thicken-feature-patch] Missing feature id.');

  const solids = (partHistory.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && obj?.owningFeatureID === featureId)
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  assert(solids.length === 2, `[thicken-feature-patch] Expected two individual solids, received ${solids.length}.`);

  const expectedNames = [
    'THICK_PATCH_01_THICK_PATCH_SRC_PZ',
    'THICK_PATCH_02_THICK_PATCH_SRC_PX',
  ];
  const actualNames = solids.map((solid) => String(solid?.name || ''));
  assert(
    JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    `[thicken-feature-patch] Expected solid names ${JSON.stringify(expectedNames)}, received ${JSON.stringify(actualNames)}.`,
  );
  for (const solid of solids) {
    assertClosedManifold(solid, `thicken-feature-patch:${solid.name}`);
    const diagnostics = solid?.__thickenDiagnostics || {};
    assert(diagnostics.buildMethod === 'triangle_split_cull', `[thicken-feature-patch] ${solid.name} did not use triangle split/cull.`);
    assert(diagnostics.sourceFaceCount === 1, `[thicken-feature-patch] Expected one source face for ${solid.name}.`);
  }
  assert(Array.isArray(featureEntry?.persistentData?.results), '[thicken-feature-patch] Expected persistentData.results.');
  assert(featureEntry.persistentData.results.length === 2, '[thicken-feature-patch] Expected two persistent result records.');

  const json = await partHistory.toJSON();
  const replay = new PartHistory();
  await replay.fromJSON(json);
  await replay.runHistory();
  const replayNames = (replay.scene?.children || [])
    .filter((obj) => obj?.type === 'SOLID' && obj?.owningFeatureID === featureId)
    .map((solid) => String(solid?.name || ''))
    .sort();
  assert(
    JSON.stringify(replayNames) === JSON.stringify(expectedNames),
    `[thicken-feature-patch] Replay names mismatch. Expected ${JSON.stringify(expectedNames)}, received ${JSON.stringify(replayNames)}.`,
  );
}

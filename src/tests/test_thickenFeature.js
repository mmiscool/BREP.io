import { PartHistory } from '../PartHistory.js';

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

export async function test_face_thicken_planar_profile(partHistory) {
  const face = await buildSketchProfileFace(partHistory, 'THICK_PLANAR_SRC', makeRectSketch(0, 0, 10, 6));
  const solid = face.thicken(2, { featureId: 'THICK_PLANAR' });
  assertClosedManifold(solid, 'thicken-planar');

  const expectedFaceNames = new Set([
    'THICK_PLANAR_SOURCE_THICK_PLANAR_SRC_PROFILE',
    'THICK_PLANAR_OFFSET_THICK_PLANAR_SRC_PROFILE',
    'THICK_PLANAR_RIM_L0_THICK_PLANAR_SRC_PROFILE',
  ]);
  const actualFaceNames = new Set(typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
  for (const faceName of expectedFaceNames) {
    assert(actualFaceNames.has(faceName), `[thicken-planar] Missing face "${faceName}".`);
  }

  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Math.abs(volume - 120) <= 1e-3, `[thicken-planar] Expected volume 120, received ${volume}.`);
}

export async function test_face_thicken_hole_profile(partHistory) {
  const face = await buildSketchProfileFace(partHistory, 'THICK_RING_SRC', makeRingSketch());
  const solid = face.thicken(2, { featureId: 'THICK_RING' });
  assertClosedManifold(solid, 'thicken-hole');

  const faceNames = new Set(typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
  assert(faceNames.has('THICK_RING_SOURCE_THICK_RING_SRC_PROFILE'), '[thicken-hole] Missing source face.');
  assert(faceNames.has('THICK_RING_OFFSET_THICK_RING_SRC_PROFILE'), '[thicken-hole] Missing offset face.');
  assert(faceNames.has('THICK_RING_RIM_L0_THICK_RING_SRC_PROFILE'), '[thicken-hole] Missing outer rim face.');
  assert(faceNames.has('THICK_RING_RIM_L1_THICK_RING_SRC_PROFILE'), '[thicken-hole] Missing inner rim face.');

  const volume = typeof solid.volume === 'function' ? solid.volume() : NaN;
  assert(Math.abs(volume - 128) <= 1e-3, `[thicken-hole] Expected volume 128, received ${volume}.`);
}

export async function test_face_thicken_curved_cylinder_side(partHistory) {
  const face = await buildCylinderSideFace(partHistory, 'THICK_CURVED_SRC', 3, 8, 64);
  const solid = face.thicken(0.75, { featureId: 'THICK_CURVED' });
  assertClosedManifold(solid, 'thicken-curved');

  const faceNames = new Set(typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
  assert(faceNames.has('THICK_CURVED_SOURCE_THICK_CURVED_SRC_S'), '[thicken-curved] Missing source face.');
  assert(faceNames.has('THICK_CURVED_OFFSET_THICK_CURVED_SRC_S'), '[thicken-curved] Missing offset face.');
  assert(faceNames.has('THICK_CURVED_RIM_L0_THICK_CURVED_SRC_S'), '[thicken-curved] Missing first rim loop.');
  assert(faceNames.has('THICK_CURVED_RIM_L1_THICK_CURVED_SRC_S'), '[thicken-curved] Missing second rim loop.');

  const sourceRadius = averageFaceTriangleRadiusXZ(solid, 'THICK_CURVED_SOURCE_THICK_CURVED_SRC_S');
  const offsetRadius = averageFaceTriangleRadiusXZ(solid, 'THICK_CURVED_OFFSET_THICK_CURVED_SRC_S');
  assert(
    offsetRadius > sourceRadius + 0.45,
    `[thicken-curved] Expected offset face to sit radially outside the source face, received ${sourceRadius} vs ${offsetRadius}.`,
  );
}

export async function test_face_thicken_self_overlap_cylinder_side(partHistory) {
  const face = await buildCylinderSideFace(partHistory, 'THICK_SELF_SRC', 1, 6, 72);
  const solid = face.thicken(-1.25, { featureId: 'THICK_SELF' });
  assertClosedManifold(solid, 'thicken-self-overlap');

  const diagnostics = solid?.__thickenDiagnostics || null;
  assert(diagnostics && Number.isFinite(diagnostics.primitiveCount), '[thicken-self-overlap] Missing diagnostics.');
  assert((typeof solid.volume === 'function' ? solid.volume() : 0) > 0, '[thicken-self-overlap] Expected a positive-volume solid.');
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

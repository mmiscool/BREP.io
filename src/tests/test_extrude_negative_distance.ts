import * as THREE from 'three';

const DISTANCE = -4;
const DISTANCE_BACK = 15.7;
const TOLERANCE = 1e-4;

const makeRectSketch = () => ({
  points: [
    { id: 0, x: -2, y: -2, fixed: true },
    { id: 1, x: 2, y: -2, fixed: false },
    { id: 2, x: 2, y: 2, fixed: false },
    { id: 3, x: -2, y: 2, fixed: false },
  ],
  geometries: [
    { id: 100, type: 'line', points: [0, 1], construction: false },
    { id: 101, type: 'line', points: [1, 2], construction: false },
    { id: 102, type: 'line', points: [2, 3], construction: false },
    { id: 103, type: 'line', points: [3, 0], construction: false },
  ],
  constraints: [{ id: 0, type: '⏚', points: [0] }],
});

function collectWorldVerticesFromFaceObject(faceObject) {
  const geometry = faceObject?.geometry;
  const pos = geometry?.getAttribute?.('position');
  if (!pos) return [];
  const out = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(faceObject.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

function collectTriangleVertices(triangles) {
  const out = [];
  for (const tri of Array.isArray(triangles) ? triangles : []) {
    if (Array.isArray(tri?.p1)) out.push(tri.p1);
    if (Array.isArray(tri?.p2)) out.push(tri.p2);
    if (Array.isArray(tri?.p3)) out.push(tri.p3);
  }
  return out;
}

function analyzeProjectedOffsets(points, normal, baseProjection) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    const projection = (p[0] * normal.x) + (p[1] * normal.y) + (p[2] * normal.z);
    const offset = projection - baseProjection;
    if (offset < min) min = offset;
    if (offset > max) max = offset;
    sum += offset;
    count += 1;
  }
  return {
    mean: count ? (sum / count) : 0,
    spread: count ? (max - min) : 0,
    count,
  };
}

export async function test_extrude_negative_distance_cap_alignment(partHistory) {
  const plane = await partHistory.newFeature('P');
  plane.inputParams.orientation = 'XY';

  const sketch = await partHistory.newFeature('S');
  sketch.inputParams.sketchPlane = plane.inputParams.featureID;
  sketch.persistentData.sketch = makeRectSketch();

  const extrude = await partHistory.newFeature('E');
  extrude.inputParams.profile = sketch.inputParams.featureID;
  extrude.inputParams.consumeProfileSketch = false;
  extrude.inputParams.distance = DISTANCE;
  extrude.inputParams.distanceBack = DISTANCE_BACK;

  return partHistory;
}

export async function afterRun_extrude_negative_distance_cap_alignment(partHistory) {
  const extrudeEntry = partHistory.features.find((feature) => feature?.type === 'E');
  const sketchEntry = partHistory.features.find((feature) => feature?.type === 'S');
  if (!extrudeEntry?.inputParams?.featureID) throw new Error('[extrude-negative] missing extrude feature id');
  if (!sketchEntry?.inputParams?.featureID) throw new Error('[extrude-negative] missing sketch feature id');

  const extrudeSolid = partHistory.scene.getObjectByName(extrudeEntry.inputParams.featureID);
  if (!extrudeSolid || typeof extrudeSolid.getFaces !== 'function') {
    throw new Error('[extrude-negative] extrude solid missing from scene');
  }

  const sketchObject = partHistory.scene.getObjectByName(sketchEntry.inputParams.featureID);
  const profileFace = sketchObject?.children?.find?.((child) => child?.type === 'FACE')
    || sketchObject?.children?.find?.((child) => child?.userData?.faceName);
  if (!profileFace || typeof profileFace.getAverageNormal !== 'function') {
    throw new Error('[extrude-negative] profile face missing from sketch');
  }

  const baseNormal = profileFace.getAverageNormal().clone();
  if (baseNormal.lengthSq() < 1e-20) throw new Error('[extrude-negative] profile normal is degenerate');
  baseNormal.normalize();

  const basePoints = collectWorldVerticesFromFaceObject(profileFace);
  if (!basePoints.length) throw new Error('[extrude-negative] profile face has no vertices');
  const baseProjection = basePoints.reduce(
    (acc, p) => acc + (p[0] * baseNormal.x) + (p[1] * baseNormal.y) + (p[2] * baseNormal.z),
    0,
  ) / basePoints.length;

  const faceSets = extrudeSolid.getFaces(false);
  const startFace = faceSets.find((entry) => String(entry?.faceName || '').endsWith('_START'));
  const endFace = faceSets.find((entry) => String(entry?.faceName || '').endsWith('_END'));
  if (!startFace || !endFace) {
    const names = faceSets.map((entry) => String(entry?.faceName || ''));
    throw new Error(`[extrude-negative] missing start/end caps. Faces: ${names.join(', ')}`);
  }

  const startStats = analyzeProjectedOffsets(
    collectTriangleVertices(startFace.triangles),
    baseNormal,
    baseProjection,
  );
  const endStats = analyzeProjectedOffsets(
    collectTriangleVertices(endFace.triangles),
    baseNormal,
    baseProjection,
  );

  if (startStats.count === 0 || endStats.count === 0) {
    throw new Error('[extrude-negative] cap triangles are empty');
  }
  if (startStats.spread > TOLERANCE) {
    throw new Error(`[extrude-negative] start cap not planar on expected axis (spread=${startStats.spread})`);
  }
  if (endStats.spread > TOLERANCE) {
    throw new Error(`[extrude-negative] end cap not planar on expected axis (spread=${endStats.spread})`);
  }

  if (Math.abs(startStats.mean - (-DISTANCE_BACK)) > TOLERANCE) {
    throw new Error(
      `[extrude-negative] start cap offset mismatch: got ${startStats.mean}, expected ${-DISTANCE_BACK}`,
    );
  }
  if (Math.abs(endStats.mean - DISTANCE) > TOLERANCE) {
    throw new Error(
      `[extrude-negative] end cap offset mismatch: got ${endStats.mean}, expected ${DISTANCE}`,
    );
  }
}

import * as THREE from 'three';

const PLANE_DISTANCE_TOLERANCE = 1e-3;
const CENTER_DISTANCE_TOLERANCE = 1e-3;

function collectFaceVerticesWorld(faceObject) {
  const geometry = faceObject?.geometry;
  const position = geometry?.getAttribute?.('position');
  if (!position || position.itemSize !== 3) return [];
  const out = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point
      .set(position.getX(i), position.getY(i), position.getZ(i))
      .applyMatrix4(faceObject.matrixWorld);
    out.push([point.x, point.y, point.z]);
  }
  return out;
}

function computeCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const sum = new THREE.Vector3();
  for (const p of points) {
    sum.x += Number(p[0]) || 0;
    sum.y += Number(p[1]) || 0;
    sum.z += Number(p[2]) || 0;
  }
  return sum.multiplyScalar(1 / points.length);
}

function computeSignedDistanceStats(points, planePoint, planeNormal) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    const dx = (Number(p[0]) || 0) - planePoint.x;
    const dy = (Number(p[1]) || 0) - planePoint.y;
    const dz = (Number(p[2]) || 0) - planePoint.z;
    const signed = (dx * planeNormal.x) + (dy * planeNormal.y) + (dz * planeNormal.z);
    if (signed < min) min = signed;
    if (signed > max) max = signed;
    sum += signed;
    count += 1;
  }
  return {
    count,
    mean: count ? (sum / count) : 0,
    spread: count ? (max - min) : 0,
  };
}

export async function test_sketch_face_attachment_alignment(partHistory) {
  const feature1 = await partHistory.newFeature('S');
  Object.assign(feature1.inputParams, {
    id: 'S1',
    sketchPlane: null,
    curveResolution: 32,
  });
  feature1.persistentData = {
    sketch: {
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
      constraints: [
        { id: 0, type: '⏚', points: [0], status: 'solved' },
        { id: 1, type: '≡', points: [0, 2], status: 'solved' },
        { id: 2, type: '≡', points: [3, 4], status: 'solved' },
        { id: 3, type: '≡', points: [1, 5], status: 'solved' },
        { id: 4, type: '≡', points: [6, 7], status: 'solved' },
        { id: 5, type: '⟂', points: [0, 3, 4, 1], status: 'solved', value: 270 },
        { id: 6, type: '⟂', points: [4, 1, 5, 6], status: 'solved', value: 270 },
        { id: 7, type: '⟂', points: [5, 6, 7, 2], status: 'solved', value: 270 },
      ],
    },
  };

  const feature2 = await partHistory.newFeature('E');
  Object.assign(feature2.inputParams, {
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

  const feature3 = await partHistory.newFeature('F');
  Object.assign(feature3.inputParams, {
    id: 'F3',
    edges: [
      'E2:S1:G2_SW|E2:S1:G3_SW[0]',
      'E2:S1:G1_SW|E2:S1:G2_SW[0]',
    ],
    radius: '9.5',
    resolution: 32,
    inflate: 0.1,
    direction: 'AUTO',
    debug: 'NONE',
    showTangentOverlays: false,
  });

  const feature4 = await partHistory.newFeature('R');
  Object.assign(feature4.inputParams, {
    id: 'R4',
    profile: 'E2:S1:PROFILE_END',
    consumeProfileSketch: true,
    axis: 'E2:S1:G4_SW|E2:S1:PROFILE_END[0]',
    angle: 144,
    resolution: 64,
    boolean: {
      targets: ['E2'],
      operation: 'UNION',
    },
  });

  const feature5 = await partHistory.newFeature('E');
  Object.assign(feature5.inputParams, {
    id: 'E5',
    profile: 'E2:S1:PROFILE_END_END',
    consumeProfileSketch: true,
    distance: 0,
    distanceBack: 111.2,
    boolean: {
      targets: ['E2'],
      operation: 'UNION',
    },
  });

  const feature6 = await partHistory.newFeature('S');
  Object.assign(feature6.inputParams, {
    id: 'S6',
    sketchPlane: 'E5:E2:S1:PROFILE_END_END_START',
    curveResolution: 32,
  });
  feature6.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: 1.282171, y: 3.606104, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 20.40159, y: 3.342124, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: 'circle', points: [0, 1], construction: false },
      ],
      constraints: [
        { id: 0, type: '⏚', points: [0], status: 'solved' },
      ],
    },
  };

  return partHistory;
}

export async function afterRun_sketch_face_attachment_alignment(partHistory) {
  const referenceFaceName = 'E5:E2:S1:PROFILE_END_END_START';
  const sketchName = 'S6';
  const sketchFaceName = 'S6:PROFILE';

  const referenceFace = partHistory.scene.getObjectByName(referenceFaceName);
  if (!referenceFace || referenceFace.type !== 'FACE') {
    throw new Error(`[sketch-face-attach] Missing reference face ${referenceFaceName}`);
  }

  const sketchGroup = partHistory.scene.getObjectByName(sketchName);
  if (!sketchGroup) {
    throw new Error('[sketch-face-attach] Sketch group S6 not found');
  }

  let sketchFace = null;
  sketchGroup.traverse((obj) => {
    if (!sketchFace && obj?.type === 'FACE' && obj?.name === sketchFaceName) {
      sketchFace = obj;
    }
  });
  if (!sketchFace) {
    throw new Error(`[sketch-face-attach] Missing sketch profile face ${sketchFaceName}`);
  }

  const refNormal = (typeof referenceFace.getAverageNormal === 'function')
    ? referenceFace.getAverageNormal().clone()
    : null;
  if (!refNormal || refNormal.lengthSq() < 1e-12) {
    throw new Error('[sketch-face-attach] Reference face normal is invalid');
  }
  refNormal.normalize();

  const refVertices = collectFaceVerticesWorld(referenceFace);
  const sketchVertices = collectFaceVerticesWorld(sketchFace);
  if (!refVertices.length || !sketchVertices.length) {
    throw new Error('[sketch-face-attach] Missing reference/sketch vertices');
  }

  const refCentroid = computeCentroid(refVertices);
  if (!refCentroid) {
    throw new Error('[sketch-face-attach] Failed to compute reference face centroid');
  }

  const stats = computeSignedDistanceStats(sketchVertices, refCentroid, refNormal);
  if (Math.abs(stats.mean) > PLANE_DISTANCE_TOLERANCE) {
    throw new Error(
      `[sketch-face-attach] Sketch profile is offset from target face plane (mean=${stats.mean}, tol=${PLANE_DISTANCE_TOLERANCE})`,
    );
  }
  if (stats.spread > PLANE_DISTANCE_TOLERANCE) {
    throw new Error(
      `[sketch-face-attach] Sketch profile is not planar on target face plane (spread=${stats.spread}, tol=${PLANE_DISTANCE_TOLERANCE})`,
    );
  }

  const sketchEntry = partHistory.features.find((entry) => entry?.inputParams?.featureID === sketchName);
  const basisOrigin = Array.isArray(sketchEntry?.persistentData?.basis?.origin)
    ? new THREE.Vector3().fromArray(sketchEntry.persistentData.basis.origin)
    : null;
  if (!basisOrigin) {
    throw new Error('[sketch-face-attach] Sketch basis origin is missing from persistent data');
  }

  referenceFace.updateWorldMatrix(true, true);
  const boundsCenter = new THREE.Box3().setFromObject(referenceFace).getCenter(new THREE.Vector3());
  const refVertex = refVertices[0];
  const planePoint = new THREE.Vector3(refVertex[0], refVertex[1], refVertex[2]);
  const projectedCenter = boundsCenter.clone().sub(refNormal.clone().multiplyScalar(boundsCenter.clone().sub(planePoint).dot(refNormal)));
  const centerDistance = basisOrigin.distanceTo(projectedCenter);
  if (centerDistance > CENTER_DISTANCE_TOLERANCE) {
    throw new Error(
      `[sketch-face-attach] Sketch basis origin is not centered on target face (distance=${centerDistance}, tol=${CENTER_DISTANCE_TOLERANCE})`,
    );
  }
}

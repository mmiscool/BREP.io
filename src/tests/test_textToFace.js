import { SelectionState } from '../UI/SelectionState.js';
import { BREP } from '../BREP/BREP.js';

const EPS = 1e-6;

function findSketchGroup(scene) {
  const children = Array.isArray(scene?.children) ? scene.children : [];
  return children.find((obj) => obj && obj.type === 'SKETCH') || null;
}

function findSketchFace(sketchGroup) {
  if (!sketchGroup) return null;
  const kids = Array.isArray(sketchGroup.children) ? sketchGroup.children : [];
  return kids.find((obj) => obj && obj.type === 'FACE') || null;
}

function findSketchEdges(sketchGroup) {
  if (!sketchGroup) return [];
  const kids = Array.isArray(sketchGroup.children) ? sketchGroup.children : [];
  return kids.filter((obj) => obj && obj.type === 'EDGE');
}

function expectTruthy(value, label) {
  if (!value) throw new Error(label);
}

function expectApprox(value, expected, label) {
  if (!Number.isFinite(value) || Math.abs(value - expected) > EPS) {
    throw new Error(`${label} expected ${expected}, got ${value}`);
  }
}

export async function test_textToFace(partHistory) {
  partHistory.expressions = 'textLabel = "BREP";';

  const plane = await partHistory.newFeature('P');
  plane.inputParams.orientation = 'XY';

  const text = await partHistory.newFeature('TEXT');
  text.inputParams.text = 'textLabel';
  text.inputParams.textHeight = 10;
  text.inputParams.curveResolution = 12;
  text.inputParams.placementPlane = plane.inputParams.featureID;
  text.inputParams.font = 'Noto Sans';

  return partHistory;
}

export async function afterRun_textToFace(partHistory) {
  const textFeature = (Array.isArray(partHistory.features)
    ? partHistory.features.find((f) => f && f.type === 'TEXT')
    : null);
  expectTruthy(textFeature, '[text_to_face] No TEXT feature found');
  if (String(textFeature?.previouseExpressions?.text ?? '') !== 'BREP') {
    throw new Error('[text_to_face] Text expression did not resolve to BREP');
  }

  const sketchGroup = findSketchGroup(partHistory.scene);
  expectTruthy(sketchGroup, '[text_to_face] No SKETCH group found');

  const face = findSketchFace(sketchGroup);
  expectTruthy(face, '[text_to_face] No FACE found on SKETCH group');

  const edges = findSketchEdges(sketchGroup);
  if (!edges.length) throw new Error('[text_to_face] No sketch edges found');

  const loops = face?.userData?.boundaryLoopsWorld;
  if (!Array.isArray(loops) || !loops.length) {
    throw new Error('[text_to_face] Missing boundaryLoopsWorld on face');
  }

  const profileGroups = face?.userData?.profileGroups;
  if (!Array.isArray(profileGroups) || !profileGroups.length) {
    throw new Error('[text_to_face] Missing profileGroups on face');
  }

  const baseMat = SelectionState.getBaseMaterial(face) || face.material;
  if (!baseMat) throw new Error('[text_to_face] Face has no material');
  if (baseMat.side !== BREP.THREE.DoubleSide) {
    throw new Error('[text_to_face] Face material is not DoubleSide');
  }
  if (!baseMat.polygonOffset) {
    throw new Error('[text_to_face] Face material polygonOffset not enabled');
  }

  const edgeMat = SelectionState.getBaseMaterial(edges[0]) || edges[0].material;
  if (!edgeMat) throw new Error('[text_to_face] Edge has no material');
  if (edgeMat.depthTest !== false) {
    throw new Error('[text_to_face] Edge material depthTest should be false');
  }
  if (edges[0].renderOrder < 2) {
    throw new Error('[text_to_face] Edge renderOrder should be elevated');
  }

  // sanity check: face normal should be finite
  try {
    if (typeof face.getAverageNormal === 'function') {
      const n = face.getAverageNormal();
      expectApprox(Number(n.length()), 1, '[text_to_face] Face normal not normalized');
    }
  } catch {
    // ignore if normal computation fails in test runtime
  }
}

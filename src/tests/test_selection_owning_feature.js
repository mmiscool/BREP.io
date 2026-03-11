import {
  isSingleSketchLikeSelection,
  isSingleSelectionOfTypes,
  isSingleSplineSelection,
  resolveOwningFeatureIdForObject,
  resolveOwningFeatureIdForSelection,
  resolveSketchLikeFeatureIdForObject,
  resolveSketchLikeFeatureIdForSelection,
  resolveSplineFeatureIdForObject,
  resolveSplineFeatureIdForSelection,
} from '../utils/selectionOwningFeature.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_selection_owning_feature_resolution() {
  const solid = {
    type: 'SOLID',
    owningFeatureID: 'BODY_OWNER',
    getFaceMetadata(name) {
      if (name === 'FACE_FROM_META') return { sourceFeatureId: 'FACE_OWNER' };
      return null;
    },
    getEdgeMetadata(name) {
      if (name === 'EDGE_FROM_META') return { sourceFeatureId: 'EDGE_OWNER' };
      return null;
    },
  };

  const face = {
    type: 'FACE',
    name: 'FACE_FROM_META',
    parentSolid: solid,
    parent: solid,
  };
  const edge = {
    type: 'EDGE',
    name: 'EDGE_FROM_META',
    parentSolid: solid,
    parent: solid,
  };
  const fallbackFace = {
    type: 'FACE',
    name: 'FACE_FALLBACK',
    parentSolid: solid,
    parent: solid,
  };
  const spline = {
    type: 'EDGE',
    userData: { splineFeatureId: 'SP_001' },
  };
  const splineChild = {
    type: 'LINE2',
    userData: {},
    parent: spline,
  };
  const sketchGroup = {
    type: 'SKETCH',
    name: 'SK_001',
    userData: { sketchFeatureId: 'SK_001' },
  };
  const sketchEdge = {
    type: 'EDGE',
    name: 'SK_001:G5',
    userData: {},
    parent: sketchGroup,
  };
  const offsetFaceGroup = {
    type: 'SKETCH',
    name: 'OF_001:FACE_A',
    userData: { sketchFeatureId: 'OF_001' },
  };
  const offsetProfile = {
    type: 'FACE',
    name: 'OF_001:FACE_A:PROFILE',
    userData: {},
    parent: offsetFaceGroup,
  };

  assert(resolveOwningFeatureIdForObject(face) === 'FACE_OWNER', 'Face metadata owner should win.');
  assert(resolveOwningFeatureIdForObject(edge) === 'EDGE_OWNER', 'Edge metadata owner should use precise edge metadata.');
  assert(resolveOwningFeatureIdForObject(fallbackFace) == null, 'Faces without precise provenance should not fall back to solid owner.');
  assert(resolveSplineFeatureIdForObject(spline) === 'SP_001', 'Spline owner should resolve from spline metadata.');
  assert(resolveSplineFeatureIdForObject(splineChild) === 'SP_001', 'Spline owner should resolve through parent geometry.');
  assert(resolveSketchLikeFeatureIdForObject(sketchEdge) === 'SK_001', 'Sketch owner should resolve through sketch group metadata.');
  assert(resolveSketchLikeFeatureIdForObject(offsetProfile) === 'OF_001', 'Sketch-like owner should resolve from group metadata.');
  assert(
    resolveOwningFeatureIdForSelection([{ object: face }]) === 'FACE_OWNER',
    'Single-selection resolution should unwrap selection objects.',
  );
  assert(
    resolveSplineFeatureIdForSelection([{ object: splineChild }]) === 'SP_001',
    'Spline selection resolution should unwrap selection objects.',
  );
  assert(
    resolveSketchLikeFeatureIdForSelection([{ object: sketchEdge }]) === 'SK_001',
    'Sketch-like selection resolution should unwrap selection objects.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: face }], ['FACE']) === true,
    'Single face selection should match FACE.',
  );
  assert(
    isSingleSplineSelection([{ object: spline }]) === true,
    'Single spline selection should match spline helper.',
  );
  assert(
    isSingleSketchLikeSelection([{ object: offsetProfile }]) === true,
    'Single sketch-like selection should match sketch-like helper.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: edge }], ['FACE', 'PLANE']) === false,
    'Edge selection should not match the face-only toolbar filter.',
  );
  assert(
    isSingleSplineSelection([{ object: spline }, { object: edge }]) === false,
    'Multiple selections should not match spline helper.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: face }, { object: edge }], ['FACE', 'EDGE']) === false,
    'Multiple selections should not match.',
  );
}

import {
  isSingleSelectionOfTypes,
  resolveOwningFeatureIdForObject,
  resolveOwningFeatureIdForSelection,
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

  assert(resolveOwningFeatureIdForObject(face) === 'FACE_OWNER', 'Face metadata owner should win.');
  assert(resolveOwningFeatureIdForObject(edge) === 'EDGE_OWNER', 'Edge metadata owner should use precise edge metadata.');
  assert(resolveOwningFeatureIdForObject(fallbackFace) == null, 'Faces without precise provenance should not fall back to solid owner.');
  assert(
    resolveOwningFeatureIdForSelection([{ object: face }]) === 'FACE_OWNER',
    'Single-selection resolution should unwrap selection objects.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: face }], ['FACE']) === true,
    'Single face selection should match FACE.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: edge }], ['FACE', 'PLANE']) === false,
    'Edge selection should not match the face-only toolbar filter.',
  );
  assert(
    isSingleSelectionOfTypes([{ object: face }, { object: edge }], ['FACE', 'EDGE']) === false,
    'Multiple selections should not match.',
  );
}

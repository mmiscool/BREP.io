import { setSketchFeatureSceneVisibility } from '../utils/sketchFeatureVisibility.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_sketch_feature_scene_visibility() {
  const sketchObject = { type: 'SKETCH', visible: true };
  const partHistory = {
    getObjectByName(name) {
      return name === 'SK_001' ? sketchObject : null;
    },
  };

  assert(
    setSketchFeatureSceneVisibility(partHistory, 'SK_001', false) === true,
    'Expected sketch visibility helper to hide the requested sketch object.',
  );
  assert(sketchObject.visible === false, 'Expected sketch object to become hidden.');

  assert(
    setSketchFeatureSceneVisibility(partHistory, 'SK_001', true) === true,
    'Expected sketch visibility helper to restore the requested sketch object.',
  );
  assert(sketchObject.visible === true, 'Expected sketch object visibility to be restored.');

  assert(
    setSketchFeatureSceneVisibility(partHistory, 'MISSING', true) === false,
    'Expected helper to report when a sketch object cannot be found.',
  );
}

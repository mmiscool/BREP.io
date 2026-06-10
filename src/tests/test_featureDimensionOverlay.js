import * as THREE from 'three';
import { PartHistory } from '../PartHistory.js';
import {
  collectFeatureDimensionReferenceNames,
  resolveFeatureDimensionEffectReferenceObject,
  resolvePortExtensionAnnotationGeometry,
  supportsFeatureDimensionFeatureKey,
} from '../UI/featureDimensions/featureDimensionUtils.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function approxEqual(a, b, tolerance = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function test_feature_dimension_overlay_supports_port() {
  assert(
    supportsFeatureDimensionFeatureKey('PORT') === true,
    'Expected feature dimension overlay to support port features.',
  );
}

export function test_port_extension_annotation_geometry_preserves_extension_value() {
  const positive = resolvePortExtensionAnnotationGeometry({
    point: [1, 2, 3],
    direction: [0, 0, 10],
    extension: 4,
  }, 0.5);
  assert(positive, 'Expected positive port extension geometry to resolve.');
  assert(approxEqual(positive.value, 4), 'Expected extension value to be preserved.');
  assert(approxEqual(positive.dragPlaneValue, 4), 'Expected drag plane value to match positive extension.');
  assert(approxEqual(positive.pointB.x, 1) && approxEqual(positive.pointB.y, 2) && approxEqual(positive.pointB.z, 7), 'Expected endpoint to follow normalized port direction.');

  const zero = resolvePortExtensionAnnotationGeometry({
    point: [0, 0, 0],
    direction: [5, 0, 0],
    extension: 0,
  }, 0.75);
  assert(zero, 'Expected zero-length port extension geometry to resolve.');
  assert(approxEqual(zero.value, 0), 'Expected displayed extension value to remain zero.');
  assert(approxEqual(zero.dragPlaneValue, 0.75), 'Expected zero-length extension to keep a visible drag handle offset.');
  assert(approxEqual(zero.pointB.x, 0.75) && approxEqual(zero.pointB.y, 0) && approxEqual(zero.pointB.z, 0), 'Expected visible tip offset to follow the normalized direction.');
}

export function test_feature_dimension_effect_reference_resolves_consumed_profile_and_axis() {
  const profile = { name: 'S1:PROFILE', type: 'FACE', children: [] };
  const axis = { name: 'S1:G4', type: 'EDGE', children: [] };
  const sketch = {
    name: 'S1',
    type: 'SKETCH',
    children: [
      { name: 'S1:P1', type: 'VERTEX', children: [] },
      profile,
      { name: 'edges', type: 'GROUP', children: [axis] },
    ],
  };
  const entry = { effects: { removed: [sketch], added: [] } };

  assert(
    resolveFeatureDimensionEffectReferenceObject(entry, 'S1:PROFILE', new Set(['FACE'])) === profile,
    'Expected consumed profile face to resolve from feature effects.',
  );
  assert(
    resolveFeatureDimensionEffectReferenceObject(entry, { edgeName: 'S1:G4' }, ['EDGE']) === axis,
    'Expected consumed revolve axis edge to resolve from feature effects.',
  );
  assert(
    resolveFeatureDimensionEffectReferenceObject(entry, { reference: 'S1' }, new Set(['SKETCH'])) === sketch,
    'Expected consumed sketch object to resolve from feature effects.',
  );
  assert(
    resolveFeatureDimensionEffectReferenceObject(entry, 'S1:PROFILE', new Set(['EDGE'])) == null,
    'Expected type filtering to reject non-axis profile matches.',
  );

  const names = collectFeatureDimensionReferenceNames({ reference: ['S1:PROFILE', { edgeName: 'S1:G4' }] });
  assert(
    names.includes('S1:PROFILE') && names.includes('S1:G4'),
    'Expected nested reference names to be collected for generic overlay resolution.',
  );
}

export async function test_part_history_prevent_remove_survives_multi_child_scene_clear() {
  const partHistory = new PartHistory();
  const protectedGroup = new THREE.Group();
  protectedGroup.name = 'protected-overlay-test';
  protectedGroup.userData.preventRemove = true;
  const regularGroup = new THREE.Group();
  regularGroup.name = 'regular-overlay-test';
  partHistory.scene.add(regularGroup, protectedGroup);

  await partHistory.scene.clear();

  assert(protectedGroup.parent === partHistory.scene, 'Expected preventRemove scene child to survive scene.clear().');
  assert(regularGroup.parent !== partHistory.scene, 'Expected unprotected scene child to be removed by scene.clear().');
}

import {
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

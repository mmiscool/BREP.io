import { ThickenFeature } from '../features/thicken/ThickenFeature.js';
import { isFeatureAllowedInWorkbench } from '../workbenches/index.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_thicken_feature_is_available_in_modeling_and_surfacing_workbenches() {
  assert(
    isFeatureAllowedInWorkbench(ThickenFeature, 'MODELING') === true,
    'Expected Thicken to be available in the Modeling workbench.',
  );
  assert(
    isFeatureAllowedInWorkbench(ThickenFeature, 'SURFACING') === true,
    'Expected Thicken to be available in the Surfacing workbench.',
  );
}

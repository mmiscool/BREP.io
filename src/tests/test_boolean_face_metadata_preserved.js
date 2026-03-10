import { BREP } from '../BREP/BREP.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_boolean_face_metadata_preserved() {
  const base = new BREP.Cube({ x: 10, y: 10, z: 10, name: 'BASE' });
  const tool = new BREP.Cube({ x: 6, y: 6, z: 6, name: 'TOOL' });
  base.setFaceMetadata('BASE_NX', { sourceFeatureId: 'BASE_FEATURE', marker: 'base-nx' });
  tool.setFaceMetadata('TOOL_PX', { sourceFeatureId: 'TOOL_FEATURE', marker: 'tool-px' });
  tool.bakeTRS({
    position: [7, 2, 2],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  });

  // Force applyBooleanOperation into its repair fallback path.
  base.union = () => {
    throw new Error('forced union failure for metadata fallback test');
  };

  const fakePartHistory = {
    scene: {
      getObjectByName() {
        return null;
      },
    },
  };

  const resultEffects = await BREP.applyBooleanOperation(fakePartHistory, base, {
    operation: 'UNION',
    targets: [tool],
  }, 'BOOL_META');

  const result = Array.isArray(resultEffects?.added) ? resultEffects.added[0] : null;
  assert(result, 'Expected boolean to return a result solid.');

  const baseFaceMeta = result.getFaceMetadata('BASE_NX');
  assert(baseFaceMeta && baseFaceMeta.sourceFeatureId === 'BASE_FEATURE', 'Base face provenance should survive union fallback.');
  assert(baseFaceMeta && baseFaceMeta.marker === 'base-nx', 'Base face custom metadata should survive union fallback.');
}

import * as THREE from 'three';
import { PartHistory } from '../PartHistory.js';
import {
  collectFeatureDimensionReferenceNames,
  resolveFeatureDimensionEffectReferenceObject,
  resolvePortExtensionAnnotationGeometry,
} from '../UI/featureDimensions/featureDimensionUtils.js';
import {
  supportsFeatureDimensionFeatureKey,
  supportsTransformDimensionToggle,
} from '../UI/featureDimensions/FeatureDimensionRegistry.js';
import { FeatureDimensionAnnotationBuilder } from '../UI/featureDimensions/FeatureDimensionAnnotationBuilder.js';
import {
  captureReferenceSelectionSnapshots,
  resolveReferenceSnapshotFromNames,
} from '../UI/referenceSnapshotStore.js';
import {
  allowSceneOverlayRemoval,
  markSceneOverlayObject,
} from '../UI/sceneOverlayUtils.js';
import {
  addTransformControlToScene,
  markTransformControlTarget,
  removeTransformControlSceneObjects,
  restoreTransformControlSceneObjects,
} from '../UI/transformControlSceneBinding.js';

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

export function test_feature_dimension_registry_support_and_transform_toggle_agree() {
  const supportedKeys = ['P.CU', 'P.CY', 'P.CO', 'P.S', 'P.PY', 'P.T', 'E', 'R', 'PORT'];
  for (const key of supportedKeys) {
    assert(
      supportsFeatureDimensionFeatureKey(key) === true,
      `Expected ${key} to be registered for feature dimensions.`,
    );
    assert(
      supportsTransformDimensionToggle(key) === true,
      `Expected ${key} transform controls to expose dimension toggles.`,
    );
  }

  assert(
    supportsFeatureDimensionFeatureKey('UNKNOWN') === false,
    'Expected unknown feature keys to be rejected by the feature dimension registry.',
  );
  assert(
    supportsTransformDimensionToggle('UNKNOWN') === false,
    'Expected unknown feature keys to be rejected by the transform dimension toggle registry.',
  );
}

export function test_feature_dimension_annotation_builder_dispatches_registered_primitive() {
  const linearSpecs = [];
  const builder = new FeatureDimensionAnnotationBuilder({
    active: {
      entryId: 'P1',
      featureKey: 'P.CU',
      entry: {
        inputParams: {
          sizeX: 1,
          sizeY: 2,
          sizeZ: 3,
        },
      },
    },
    createLinearAnnotation: (spec) => {
      linearSpecs.push(spec);
      return {
        id: `${spec.entryId}:${spec.fieldKey}`,
        fieldKey: spec.fieldKey,
      };
    },
    createAngleAnnotation: () => null,
  });

  const annotations = builder.build();
  assert(annotations.length === 3, 'Expected cube feature to build three primitive dimensions.');
  assert(
    linearSpecs.map((spec) => spec.fieldKey).join(',') === 'sizeX,sizeY,sizeZ',
    'Expected registered cube descriptor to dispatch through the annotation builder.',
  );
}

export function test_reference_snapshot_store_uses_generic_reference_snapshots_key() {
  const persistentData = {};
  const edge = {
    name: 'S1:G4',
    type: 'EDGE',
    uuid: 'edge-uuid',
    points: () => [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
  };

  const captured = captureReferenceSelectionSnapshots({
    stores: [persistentData],
    schema: {
      edges: { type: 'reference_selection' },
    },
    resolvedParams: {
      edges: [edge],
    },
  });

  assert(captured === 1, 'Expected one reference snapshot write.');
  assert(!persistentData.__refPreviewSnapshots, 'Expected legacy reference preview snapshots key not to be created.');
  assert(
    Array.isArray(persistentData.referenceSnapshots?.edges?.['S1:G4']?.positions),
    'Expected edge snapshot to be stored under referenceSnapshots.',
  );
  assert(
    resolveReferenceSnapshotFromNames(persistentData, 'edges', ['S1:G4'], new Set(['EDGE'])) === persistentData.referenceSnapshots.edges['S1:G4'],
    'Expected snapshots to resolve through the generic reference snapshot store.',
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
  markSceneOverlayObject(protectedGroup, { preserve: true, overlayType: 'testOverlay' });
  const regularGroup = new THREE.Group();
  regularGroup.name = 'regular-overlay-test';
  partHistory.scene.add(regularGroup, protectedGroup);

  await partHistory.scene.clear();

  assert(protectedGroup.parent === partHistory.scene, 'Expected preventRemove scene child to survive scene.clear().');
  assert(regularGroup.parent !== partHistory.scene, 'Expected unprotected scene child to be removed by scene.clear().');

  allowSceneOverlayRemoval(protectedGroup, { deep: true });
  partHistory.scene.remove(protectedGroup);
  assert(protectedGroup.parent !== partHistory.scene, 'Expected unmarked overlay child to be removable.');
}

export async function test_transform_control_scene_binding_readds_and_removes_overlay_roots() {
  const partHistory = new PartHistory();
  let renderCount = 0;
  const viewer = {
    scene: partHistory.scene,
    render: () => { renderCount++; },
  };
  const target = new THREE.Object3D();
  const helper = new THREE.Group();
  const controls = {
    __helper: null,
    attached: null,
    mode: 'translate',
    updated: false,
    getHelper: () => helper,
    attach(object) { this.attached = object; },
    getMode() { return this.mode; },
    setMode(mode) { this.mode = mode; },
    update() { this.updated = true; },
  };

  markTransformControlTarget(target);
  partHistory.scene.add(target);
  const added = addTransformControlToScene(viewer, controls);

  assert(added.addedToScene === true, 'Expected transform helper to be added to the scene.');
  assert(helper.parent === partHistory.scene, 'Expected transform helper to have the scene as parent.');
  assert(helper.userData.preventRemove === true, 'Expected transform helper to be scene-removal protected.');
  assert(target.userData.preventRemove === true, 'Expected transform target to be scene-removal protected.');

  await partHistory.scene.clear();
  assert(helper.parent === partHistory.scene, 'Expected transform helper to survive protected scene clear.');
  assert(target.parent === partHistory.scene, 'Expected transform target to survive protected scene clear.');

  removeTransformControlSceneObjects({ viewer, controls, group: added.group, target });
  assert(helper.parent !== partHistory.scene, 'Expected transform helper to be removable through transform teardown.');
  assert(target.parent !== partHistory.scene, 'Expected transform target to be removable through transform teardown.');

  const restored = restoreTransformControlSceneObjects(viewer, controls, target);
  assert(restored.addedToScene === true, 'Expected transform helper to be restored to the scene.');
  assert(helper.parent === partHistory.scene, 'Expected restored transform helper to have the scene as parent.');
  assert(target.parent === partHistory.scene, 'Expected restored transform target to have the scene as parent.');
  assert(controls.attached === target, 'Expected transform controls to reattach to the target.');
  assert(controls.updated === true, 'Expected transform controls to be updated after restore.');
  assert(renderCount > 0, 'Expected restore to request a viewer render.');

  removeTransformControlSceneObjects({ viewer, controls, group: restored.group, target });
}

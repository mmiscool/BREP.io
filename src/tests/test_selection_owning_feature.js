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
import { SelectionFilter } from '../UI/SelectionFilter.js';
import { SelectionState } from '../UI/SelectionState.js';

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

export async function test_selection_line2_resolution_repair() {
  const hadWindow = typeof globalThis.window !== 'undefined';
  const previousWindow = globalThis.window;
  if (!hadWindow) globalThis.window = { DEBUG_MODE: false };
  let selectionMethods;
  try {
    ({ selectionMethods } = await import('../UI/viewer/selectionMethods.js'));
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else {
      try { delete globalThis.window; } catch { globalThis.window = undefined; }
    }
  }
  const material = { linewidth: 3 };
  const line = {
    isLine2: true,
    material,
  };
  const viewer = {
    renderer: {
      domElement: {
        clientWidth: 640,
        clientHeight: 480,
        getBoundingClientRect: () => ({ width: 640, height: 480 }),
      },
    },
    scene: {
      traverse(callback) {
        callback(line);
      },
    },
  };
  viewer._syncLineMaterialResolutionForPicking = selectionMethods._syncLineMaterialResolutionForPicking;

  selectionMethods._syncLineMaterialResolutionForPicking.call(viewer);

  assert(material.resolution, 'Expected Line2 material to receive a resolution before raycasting.');
  assert(material.resolution.width === 640, `Expected repaired width 640, got ${material.resolution.width}`);
  assert(material.resolution.height === 480, `Expected repaired height 480, got ${material.resolution.height}`);
  delete material.resolution;

  let sawResolutionInsidePick = false;
  selectionMethods._withDoubleSidedPicking.call(viewer, () => {
    sawResolutionInsidePick = !!material.resolution;
    return [];
  });
  assert(sawResolutionInsidePick, 'Expected picking wrapper to repair Line2 material resolution before raycasting.');
}

export async function test_selection_hover_material_restores_before_dispose() {
  let hoverMaterial = null;
  const baseMaterial = {
    type: 'FakeMaterial',
    color: { set() {} },
    clone() {
      hoverMaterial = {
        type: 'FakeHoverMaterial',
        color: { set() {} },
        disposed: false,
        dispose() {
          this.disposed = true;
        },
      };
      return hoverMaterial;
    },
  };
  const edge = {
    type: 'EDGE',
    name: 'hover-restore-edge',
    material: baseMaterial,
    userData: {},
  };

  SelectionState.attach(edge);
  edge.hovered = true;

  assert(hoverMaterial, 'Expected hover to create a temporary material.');
  assert(edge.material === hoverMaterial, 'Expected hover material to be assigned while hovered.');

  SelectionState._clearHover(edge);

  assert(edge.material === baseMaterial, 'Expected base material to be restored before hover material disposal.');
  assert(hoverMaterial.disposed === true, 'Expected temporary hover material to be disposed after restore.');
}

export async function test_selection_sketch_hover_tints_material_in_place() {
  const makeSketchMaterial = (initialColor, type) => {
    let color = initialColor;
    const material = {
      type,
      needsUpdate: false,
      color: {
        set(next) { color = next; },
        getHex() { return color; },
      },
      clone() {
        throw new Error('Sketch hover should not clone/replace materials.');
      },
      get currentColor() { return color; },
    };
    return material;
  };
  const sketchMaterial = makeSketchMaterial('#009dff', 'FakeSketchLineMaterial');
  const sketchFaceMaterial = makeSketchMaterial('#00009e', 'FakeSketchFaceMaterial');
  const sketchGroup = {
    type: 'SKETCH',
    userData: { sketchFeatureId: 'S1' },
  };
  const face = {
    type: 'FACE',
    name: 'S1:PROFILE',
    material: sketchFaceMaterial,
    userData: {
      __baseMaterial: { type: 'MeshStandardMaterial', color: 158 },
      __defaultMaterial: { type: 'MeshStandardMaterial', color: 158 },
    },
    parent: sketchGroup,
  };
  const edge = {
    type: 'EDGE',
    name: 'S1:G100',
    material: sketchMaterial,
    userData: {
      sketchFeatureId: 'S1',
      sketchGeometryId: 100,
      __baseMaterial: { type: 'LineMaterial', color: 40447 },
      __defaultMaterial: { type: 'LineMaterial', color: 40447 },
    },
  };

  SelectionState.attach(edge);
  assert(edge.userData.__baseMaterial === sketchMaterial, 'Expected cloned plain edge base material to be replaced with the live material.');
  edge.hovered = true;

  assert(edge.material === sketchMaterial, 'Expected sketch edge hover to keep the same material object.');
  assert(sketchMaterial.currentColor === SelectionState.hoverColor, `Expected edge hover color ${SelectionState.hoverColor}, got ${sketchMaterial.currentColor}`);
  assert(sketchMaterial.needsUpdate === true, 'Expected edge hover tint to mark material for update.');

  edge.hovered = false;

  assert(edge.material === sketchMaterial, 'Expected sketch edge hover clear to keep the same material object.');
  assert(sketchMaterial.currentColor === '#009dff', `Expected sketch edge hover clear to restore original color, got ${sketchMaterial.currentColor}`);

  SelectionState.attach(face);
  assert(face.userData.__baseMaterial === sketchFaceMaterial, 'Expected cloned plain face base material to be replaced with the live material.');
  face.hovered = true;

  assert(face.material === sketchFaceMaterial, 'Expected sketch face hover to keep the same material object.');
  assert(sketchFaceMaterial.currentColor === SelectionState.hoverColor, `Expected face hover color ${SelectionState.hoverColor}, got ${sketchFaceMaterial.currentColor}`);

  face.hovered = false;

  assert(face.material === sketchFaceMaterial, 'Expected sketch face hover clear to keep the same material object.');
  assert(sketchFaceMaterial.currentColor === '#00009e', `Expected sketch face hover clear to restore original color, got ${sketchFaceMaterial.currentColor}`);
}

export async function test_selection_filter_empty_hover_clears_in_place_sketch_hover() {
  let color = '#009dff';
  const sketchMaterial = {
    needsUpdate: false,
    color: {
      set(next) { color = next; },
      getHex() { return color; },
    },
    clone() {
      throw new Error('SelectionFilter hover should tint sketch materials in place.');
    },
    get currentColor() { return color; },
  };
  const edge = {
    type: 'EDGE',
    name: 'S1:G101',
    uuid: 'selection-filter-empty-hover-edge',
    material: sketchMaterial,
    userData: { sketchFeatureId: 'S1', sketchGeometryId: 101 },
  };

  SelectionFilter.clearHover();
  SelectionFilter.setHoverObjects([edge], { ignoreFilter: true });

  assert(edge.hovered === true, 'Expected SelectionFilter to mark the sketch edge hovered.');
  assert(sketchMaterial.currentColor === SelectionState.hoverColor, `Expected sketch edge hover color ${SelectionState.hoverColor}, got ${sketchMaterial.currentColor}`);

  SelectionFilter.setHoverObjects([], { ignoreFilter: true });

  assert(edge.hovered === false, 'Expected an empty hover update to clear the hovered flag.');
  assert(sketchMaterial.currentColor === '#009dff', `Expected empty hover update to restore sketch material color, got ${sketchMaterial.currentColor}`);
  assert(SelectionFilter._hovered.size === 0, 'Expected SelectionFilter hovered target set to be empty after clear.');
}

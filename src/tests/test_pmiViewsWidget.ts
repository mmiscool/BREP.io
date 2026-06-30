import * as THREE from 'three';
import { PMIViewsWidget } from '../UI/pmi/PMIViewsWidget.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export function test_pmi_monochrome_label_svg_uses_backdrop_color() {
  const widget = Object.create(PMIViewsWidget.prototype);
  widget.viewer = null;

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const svg = widget._composeLabelSVG(
    'data:image/png;base64,',
    [{ world: new THREE.Vector3(0, 0, 0), text: 'R1.500', anchor: 'center middle' }],
    400,
    300,
    400,
    {
      viewer: { camera },
      renderMode: 'monochrome',
      labelBackdropColor: '#ff0000',
    },
  );

  assert(svg.includes('fill="#ff0000"'), 'Expected monochrome PMI label mask to use the view backdrop color.');
  assert(svg.includes('stroke="none"'), 'Expected monochrome PMI label mask to avoid drawing a border.');
}

export function test_pmi_monochrome_label_layout_is_tighter_than_shaded() {
  const widget = Object.create(PMIViewsWidget.prototype);
  widget.viewer = null;

  const monochrome = widget._getLabelLayoutMetrics(400, 400, { renderMode: 'monochrome' });
  const shaded = widget._getLabelLayoutMetrics(400, 400, { renderMode: 'shaded' });

  assert(monochrome.paddingX < shaded.paddingX, 'Expected monochrome PMI label mask horizontal padding to be tighter than shaded export padding.');
  assert(monochrome.paddingY < shaded.paddingY, 'Expected monochrome PMI label mask vertical padding to be tighter than shaded export padding.');
  assert(monochrome.lineHeight < shaded.lineHeight, 'Expected monochrome PMI label mask line height to be tighter than shaded export line height.');
  assert(monochrome.radius < shaded.radius, 'Expected monochrome PMI label mask corner radius to be tighter than shaded export radius.');
}

export function test_pmi_enter_edit_mode_reuses_shared_flow() {
  const widget = Object.create(PMIViewsWidget.prototype);
  const calls = [];
  const view = { viewName: 'View 1' };
  const originalSetTimeout = globalThis.setTimeout;

  widget._enterEditMode = (viewArg, indexArg) => {
    calls.push({ view: viewArg, index: indexArg });
  };

  try {
    (globalThis as any).setTimeout = (fn, _delay) => {
      fn();
      return 0;
    };
    widget.enterEditMode(view, 3);
  } finally {
    (globalThis as any).setTimeout = originalSetTimeout;
  }

  assert(calls.length === 2, 'Expected shared PMI edit flow to invoke the edit handoff twice.');
  assert(calls[0]?.view === view && calls[1]?.view === view, 'Expected shared PMI edit flow to forward the same view.');
  assert(calls[0]?.index === 3 && calls[1]?.index === 3, 'Expected shared PMI edit flow to forward the same view index.');
}

export function test_pmi_export_render_context_applies_visibility_state() {
  const widget = Object.create(PMIViewsWidget.prototype);
  const calls = [];
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  widget._getCaptureViewportMetrics = () => ({ width: 100, height: 100 });
  widget._updateExportCameraLightRig = () => {};
  widget._applyWireframe = () => {};

  const view = {
    camera: {
      position: { x: 0, y: 0, z: 1 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
      projection: null,
    },
    viewSettings: {
      visibilityState: {
        hidden: [{ key: 'solid-a', count: 1 }],
      },
    },
  };

  const renderContext = {
    viewer: {
      camera,
      partHistory: {
        applyVisibilityState(hidden) {
          calls.push(hidden);
        },
      },
    },
    viewport: { width: 100, height: 100 },
    scene: {},
  };

  widget._applyViewToRenderContext(view, renderContext, { index: 0 });

  assert(calls.length === 1, 'Expected PMI export render context to apply view visibility state.');
  assert(Array.isArray(calls[0]) && calls[0][0]?.key === 'solid-a', 'Expected PMI export render context to forward hidden visibility entries.');
}

export function test_pmi_effective_visibility_respects_hidden_ancestor() {
  const widget = Object.create(PMIViewsWidget.prototype);
  const parent = new THREE.Object3D();
  const child = new THREE.Object3D();
  parent.visible = false;
  child.visible = true;
  parent.add(child);

  assert(widget._isObjectEffectivelyVisible(child) === false, 'Expected hidden ancestors to make PMI export objects effectively invisible.');
}

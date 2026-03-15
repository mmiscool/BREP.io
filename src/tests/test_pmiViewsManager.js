import { PMIViewsManager } from '../pmi/PMIViewsManager.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export function test_pmi_view_text_size_setting_normalizes() {
  const manager = new PMIViewsManager(null);
  const added = manager.addView({
    viewName: 'Sheet View',
    camera: {},
    annotations: [],
    viewSettings: {
      pmiTextSizePt: '18.5',
    },
  });

  assert(added?.viewSettings?.pmiTextSizePt === 18.5, 'Expected PMI text size to normalize to a finite number.');

  const updated = manager.updateView(0, (view) => {
    view.viewSettings.pmiTextSizePt = -4;
    return view;
  });

  assert(!Object.prototype.hasOwnProperty.call(updated?.viewSettings || {}, 'pmiTextSizePt'), 'Expected invalid PMI text size to be removed during normalization.');
}

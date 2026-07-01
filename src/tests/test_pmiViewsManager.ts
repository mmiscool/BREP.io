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

export function test_pmi_view_visibility_state_normalizes() {
  const manager = new PMIViewsManager(null);
  const added = manager.addView({
    viewName: 'Visibility View',
    camera: {},
    annotations: [],
    viewSettings: {
      visibilityState: {
        hidden: [
          { key: 'solid-a', count: '2.8' },
          { key: '', count: 10 },
          { key: 'face-b', count: 0 },
        ],
      },
    },
  });

  const hidden = added?.viewSettings?.visibilityState?.hidden || [];
  assert(hidden.length === 2, 'Expected PMI visibility state to discard invalid hidden entries.');
  assert(hidden[0]?.key === 'solid-a' && hidden[0]?.count === 3, 'Expected PMI visibility counts to normalize to rounded positive integers.');
  assert(hidden[1]?.key === 'face-b' && hidden[1]?.count === 1, 'Expected PMI visibility counts to clamp to at least 1.');
}

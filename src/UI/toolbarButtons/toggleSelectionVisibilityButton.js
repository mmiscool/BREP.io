import { SelectionFilter } from '../SelectionFilter.js';

function getSelection(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene || null;
  return SelectionFilter.getSelectedObjects({ scene });
}

function getToggleTargets(selection) {
  const out = [];
  for (const obj of selection || []) {
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj.visible === 'undefined') continue;
    out.push(obj);
  }
  return out;
}

export function createToggleSelectionVisibilityButton(viewer) {
  const onClick = () => {
    const selection = getSelection(viewer);
    if (!selection.length) {
      viewer?._toast?.('Select at least one object.');
      return;
    }

    const targets = getToggleTargets(selection);
    if (!targets.length) {
      viewer?._toast?.('Selected objects cannot be hidden.');
      return;
    }

    const anyVisible = targets.some((obj) => obj.visible !== false);
    const targetVisible = !anyVisible;
    for (const obj of targets) {
      try { obj.visible = targetVisible; } catch { }
    }

    try { viewer?.render?.(); } catch { }
  };

  return {
    label: '👁',
    title: 'Toggle visibility of selected objects',
    onClick,
  };
}

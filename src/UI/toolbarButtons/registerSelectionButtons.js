import { SelectionFilter } from '../SelectionFilter.js';
import { createOrientToFaceButton } from './orientToFaceButton.js';
import { createInspectorToggleButton } from './inspectorToggleButton.js';
import { createMetadataButton } from './metadataButton.js';

const hasSelection = (items) => Array.isArray(items) && items.length > 0;
const hasType = (items, types) => {
  if (!Array.isArray(items) || items.length === 0) return false;
  const typeSet = new Set((types || []).map((t) => String(t || '').toUpperCase()));
  if (typeSet.size === 0) return false;
  return items.some((obj) => typeSet.has(String(obj?.type || '').toUpperCase()));
};

export function registerSelectionToolbarButtons(viewer) {
  if (!viewer || typeof SelectionFilter?.registerSelectionAction !== 'function') return;


  try {
    SelectionFilter.registerSelectionAction({
      id: 'selection-action-clear',
      label: '␛',
      title: 'Clear selection',
      onClick: () => {
        const scene = viewer?.partHistory?.scene || viewer?.scene || null;
        if (scene) SelectionFilter.unselectAll(scene);
        try { viewer?._hideSelectionOverlay?.(); } catch { }
      },
      shouldShow: (selection) => hasSelection(selection),
    });
  } catch { }



  try {
    const perpSpec = createOrientToFaceButton(viewer);
    if (perpSpec) {
      SelectionFilter.registerSelectionAction({
        id: 'selection-action-perp',
        ...perpSpec,
        shouldShow: (selection) => hasType(selection, ['FACE', 'PLANE']),
      });
    }
  } catch { }

  try {
    const inspectorSpec = createInspectorToggleButton(viewer);
    if (inspectorSpec) {
      SelectionFilter.registerSelectionAction({
        id: 'selection-action-inspector',
        ...inspectorSpec,
        shouldShow: (selection) => hasSelection(selection),
      });
    }
  } catch { }



  try {
    const metadataSpec = createMetadataButton(viewer);
    if (metadataSpec) {
      SelectionFilter.registerSelectionAction({
        id: 'selection-action-metadata',
        ...metadataSpec,
        shouldShow: (selection) => hasSelection(selection),
      });
    }
  } catch { }
}

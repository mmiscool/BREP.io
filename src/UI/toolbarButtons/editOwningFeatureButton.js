import { SelectionFilter } from '../SelectionFilter.js';
import {
  isSingleSelectionOfTypes,
  resolveOwningFeatureIdForSelection,
} from '../../utils/selectionOwningFeature.js';

const SUPPORTED_TYPES = ['FACE', 'PLANE'];

export function createEditOwningFeatureButton(viewer) {
  const onClick = async () => {
    const selection = SelectionFilter.getSelectedObjects();
    if (!isSingleSelectionOfTypes(selection, SUPPORTED_TYPES)) {
      viewer?._toast?.('Select a single face.');
      return;
    }

    const featureId = resolveOwningFeatureIdForSelection(selection);
    if (!featureId) {
      viewer?._toast?.('No owning feature found for that selection.');
      return;
    }

    try { await viewer?.accordion?.expandSection?.('History'); } catch { /* ignore */ }
    try {
      if (viewer?.partHistory) {
        viewer.partHistory.currentHistoryStepId = String(featureId);
      }
    } catch { /* ignore */ }

    const revealed = viewer?.historyWidget?.revealEntry?.(featureId, { focus: true, scroll: true }) === true;
    if (!revealed) {
      viewer?._toast?.(`Feature "${featureId}" is not available in history.`);
    }
  };

  return {
    label: 'Edit owning feature',
    title: 'Expand the feature that originally created the selected face',
    onClick,
  };
}

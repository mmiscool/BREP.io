import { SelectionFilter } from '../SelectionFilter.js';
import { createOrientToFaceButton } from './orientToFaceButton.js';
import { createInspectorToggleButton } from './inspectorToggleButton.js';
import { createMetadataButton } from './metadataButton.js';
import { createToggleSelectionVisibilityButton } from './toggleSelectionVisibilityButton.js';
import { createEditOwningFeatureButton } from './editOwningFeatureButton.js';
import {
  isSingleSelectionOfTypes,
  resolveOwningFeatureIdForSelection,
  resolveSplineFeatureIdForSelection,
} from '../../utils/selectionOwningFeature.js';

const hasSelection = (items) => Array.isArray(items) && items.length > 0;
const hasType = (items, types) => {
  if (!Array.isArray(items) || items.length === 0) return false;
  const typeSet = new Set((types || []).map((t) => String(t || '').toUpperCase()));
  if (typeSet.size === 0) return false;
  return items.some((obj) => typeSet.has(String(obj?.type || '').toUpperCase()));
};
const getSingleSelectionComponent = (items, viewer) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const findComponent = (obj) => {
    if (!obj) return null;
    if (viewer && typeof viewer._findOwningComponent === 'function') {
      try { return viewer._findOwningComponent(obj); } catch { }
    }
    let cur = obj;
    while (cur) {
      if (cur.isAssemblyComponent || String(cur.type || '').toUpperCase() === SelectionFilter.COMPONENT) return cur;
      cur = cur.parent || null;
    }
    return null;
  };
  let component = null;
  for (const item of items) {
    const obj = item?.object || item?.target || item;
    const owning = findComponent(obj);
    if (!owning) return null;
    if (!component) component = owning;
    else if (component !== owning) return null;
  }
  return component;
};

const getSplineFeatureEntry = (selection, viewer) => {
  const featureId = resolveSplineFeatureIdForSelection(selection);
  if (!featureId) return null;
  const features = Array.isArray(viewer?.partHistory?.features) ? viewer.partHistory.features : [];
  const feature = features.find((item) => {
    const itemId = item?.inputParams?.featureID ?? item?.inputParams?.id ?? item?.id ?? null;
    return itemId != null && String(itemId) === String(featureId);
  }) || null;
  if (!feature) return null;
  const typeKey = String(feature?.constructor?.shortName || feature?.constructor?.type || '').toUpperCase();
  if (typeKey !== 'SP') return null;
  return { featureId: String(featureId), feature };
};

const isWireHarnessWorkbenchActive = (viewer) => {
  const workbenchId = viewer?._getActiveWorkbenchId?.() || viewer?.partHistory?.activeWorkbench || null;
  return String(workbenchId || '').toUpperCase() === 'WIRE_HARNESS';
};

const revealHistoryEntry = async (viewer, featureId) => {
  if (!featureId) return false;
  try { await viewer?.accordion?.expandSection?.('History'); } catch { /* ignore */ }
  try {
    if (viewer?.partHistory) {
      viewer.partHistory.currentHistoryStepId = String(featureId);
    }
  } catch { /* ignore */ }
  return viewer?.historyWidget?.revealEntry?.(featureId, { focus: true, scroll: true }) === true;
};

const deleteHistoryEntry = async (viewer, featureId) => {
  if (!featureId) return false;
  const historyWidget = viewer?.historyWidget || null;
  if (historyWidget && typeof historyWidget._deleteEntry === 'function') {
    historyWidget._deleteEntry(String(featureId));
    return true;
  }
  const partHistory = viewer?.partHistory || null;
  if (!partHistory) return false;
  await partHistory.removeFeature?.(String(featureId));
  await partHistory.runHistory?.();
  partHistory.queueHistorySnapshot?.({ debounceMs: 0, reason: 'delete' });
  return true;
};

export function registerSelectionToolbarButtons(viewer) {
  if (!viewer || typeof SelectionFilter?.registerSelectionAction !== 'function') return;


  try {
    SelectionFilter.registerSelectionAction({
      id: 'selection-action-clear',
      label: '␛',
      title: 'Clear selection',
      onClick: () => {
        try { viewer?._handleEscapeAction?.(); } catch { }
      },
      shouldShow: (selection) => hasSelection(selection),
    });
  } catch { }

  try {
    const toggleVisibilitySpec = createToggleSelectionVisibilityButton(viewer);
    if (toggleVisibilitySpec) {
      SelectionFilter.registerSelectionAction({
        id: 'selection-action-toggle-visibility',
        ...toggleVisibilitySpec,
        shouldShow: (selection) => hasSelection(selection),
      });
    }
  } catch { }



  try {
    SelectionFilter.registerSelectionAction({
      id: 'selection-action-move',
      label: 'Move',
      title: 'Move component',
      onClick: () => {
        const selection = SelectionFilter.getSelectedObjects();
        const component = getSingleSelectionComponent(selection, viewer);
        if (!component) {
          viewer?._toast?.('Select a single component to move.');
          return;
        }
        if (typeof viewer?._toggleComponentTransform === 'function') {
          viewer._toggleComponentTransform(component);
          return;
        }
        if (typeof viewer?._activateComponentTransform === 'function') {
          if (component.fixed) {
            viewer?._toast?.('Component is fixed and cannot be moved.');
            return;
          }
          viewer._activateComponentTransform(component);
        }
      },
      shouldShow: (selection) => !!getSingleSelectionComponent(selection, viewer),
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

  try {
    const editOwningFeatureSpec = createEditOwningFeatureButton(viewer);
    if (editOwningFeatureSpec) {
      SelectionFilter.registerSelectionAction({
        id: 'selection-action-edit-owning-feature',
        ...editOwningFeatureSpec,
        shouldShow: (selection) => (
          isSingleSelectionOfTypes(selection, ['FACE', 'PLANE'])
          && !!resolveOwningFeatureIdForSelection(selection)
        ),
      });
    }
  } catch { }

  try {
    SelectionFilter.registerSelectionAction({
      id: 'selection-action-edit-spline',
      label: 'Edit spline',
      title: 'Open the selected spline in history for editing',
      onClick: async () => {
        const selection = SelectionFilter.getSelectedObjects();
        const entry = getSplineFeatureEntry(selection, viewer);
        if (!entry) {
          viewer?._toast?.('Select a single spline.');
          return;
        }
        const revealed = await revealHistoryEntry(viewer, entry.featureId);
        if (!revealed) {
          viewer?._toast?.(`Spline "${entry.featureId}" is not available in history.`);
        }
      },
      shouldShow: (selection) => isWireHarnessWorkbenchActive(viewer) && !!getSplineFeatureEntry(selection, viewer),
    });
  } catch { }

  try {
    SelectionFilter.registerSelectionAction({
      id: 'selection-action-delete-spline',
      label: 'Delete spline',
      title: 'Delete the selected spline feature',
      onClick: async () => {
        const selection = SelectionFilter.getSelectedObjects();
        const entry = getSplineFeatureEntry(selection, viewer);
        if (!entry) {
          viewer?._toast?.('Select a single spline.');
          return;
        }
        try {
          const scene = viewer?.partHistory?.scene || viewer?.scene || null;
          if (scene) SelectionFilter.unselectAll(scene);
          SelectionFilter.clearHover?.();
        } catch { /* ignore */ }
        const deleted = await deleteHistoryEntry(viewer, entry.featureId);
        if (!deleted) {
          viewer?._toast?.(`Unable to delete spline "${entry.featureId}".`);
        }
      },
      shouldShow: (selection) => isWireHarnessWorkbenchActive(viewer) && !!getSplineFeatureEntry(selection, viewer),
    });
  } catch { }
}

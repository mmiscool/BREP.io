import { SelectionFilter } from '../SelectionFilter.js';
import { createOrientToFaceButton } from './orientToFaceButton.js';
import { createInspectorToggleButton } from './inspectorToggleButton.js';
import { createMetadataButton } from './metadataButton.js';
import { createToggleSelectionVisibilityButton } from './toggleSelectionVisibilityButton.js';

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
}

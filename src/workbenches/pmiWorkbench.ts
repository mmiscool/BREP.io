import type { WorkbenchDefinition } from './index.js';

export const PMI_WORKBENCH = {
  id: 'PMI',
  label: 'PMI',
  featureTypes: [],
  contextFamilies: {
    features: false,
    assemblyConstraints: false,
    pmiAnnotations: true,
  },
  sidePanels: {
    assemblyConstraints: false,
    pmiViews: true,
  },
  toolbarButtons: [
    'new',
    'save',
    'saveAs',
    'zoomToFit',
    'wireframe',
    'import',
    'export',
    'share',
    'sheetEditor',
    'about',
    'historyTestSnippet',
    'scriptRunner',
    'undo',
    'redo',
    'tests',
    'selectionState',
  ],
} satisfies WorkbenchDefinition;

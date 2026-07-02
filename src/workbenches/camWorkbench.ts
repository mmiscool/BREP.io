import type { WorkbenchDefinition } from './index.js';

export const CAM_WORKBENCH = {
  id: 'CAM',
  label: 'CAM',
  featureTypes: [],
  contextFamilies: {
    features: false,
    assemblyConstraints: false,
    pmiAnnotations: false,
  },
  sidePanels: {
    camHistory: true,
    camMachineConfiguration: true,
    camGcode: true,
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

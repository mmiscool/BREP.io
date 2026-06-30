import type { WorkbenchDefinition } from './index.js';

export const WIRE_HARNESS_WORKBENCH = {
  id: 'WIRE_HARNESS',
  label: 'Wire Harness',
  featureTypes: [
    'D',
    'P',
    'ACOMP',
    'SP',
    'PORT',
  ],
  contextFamilies: {
    features: true,
    assemblyConstraints: true,
    pmiAnnotations: false,
  },
  sidePanels: {
    assemblyConstraints: true,
    pmiViews: true,
    wireHarnessConnections: true,
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

import type { WorkbenchDefinition } from './index.js';

export const ALL_WORKBENCH = {
  id: 'ALL',
  label: 'All',
  featureTypes: '*',
  contextFamilies: {
    features: true,
    assemblyConstraints: true,
    pmiAnnotations: true,
  },
  sidePanels: {
    assemblyConstraints: true,
    pmiViews: true,
    camHistory: true,
    camMachineConfiguration: true,
    camGcode: true,
  },
  toolbarButtons: '*',
} satisfies WorkbenchDefinition;

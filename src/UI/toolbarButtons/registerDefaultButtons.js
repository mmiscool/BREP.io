// Registers the default toolbar buttons using the viewer's addToolbarButton API.
// Each button's logic is implemented in its own module.

import { createNewButton } from './newButton.js';
import { createSaveButton } from './saveButton.js';
import { createUndoButton, createRedoButton } from './undoRedoButtons.js';
import { createZoomToFitButton } from './zoomToFitButton.js';
import { createWireframeToggleButton } from './wireframeToggleButton.js';
import { createImportButton } from './importButton.js';
import { createExportButton } from './exportButton.js';
import { createShareButton } from './shareButton.js';
import { createAboutButton } from './aboutButton.js';
import { createTestsButton } from './testsButton.js';
import { createScriptRunnerButton } from './scriptRunnerButton.js';
import { createSelectionStateButton } from './selectionStateButton.js';
import { createSheetMetalFlatExportButton } from './sheetMetalFlatExportButton.js';
import { createSheetMetalDebugButton } from './sheetMetalDebugButton.js';
import { createHomeButton } from './homeButton.js';

function isLocalhostRuntime() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost'
      || host.endsWith('.localhost')
      || host === '127.0.0.1'
      || host === '::1';
  } catch {
    return false;
  }
}

export function registerDefaultToolbarButtons(viewer) {
  if (!viewer || typeof viewer.addToolbarButton !== 'function') return;
  const isLocalhost = isLocalhostRuntime();

  const creators = [
    createHomeButton,
    createNewButton,
    createSaveButton,
    createZoomToFitButton,
    createWireframeToggleButton,
    createImportButton,
    createExportButton,
    createShareButton,
    createSheetMetalFlatExportButton,
  ];

  if (isLocalhost) creators.push(createSheetMetalDebugButton);
  creators.push(createAboutButton);
  if (isLocalhost) creators.push(createTestsButton);
  creators.push(createScriptRunnerButton);
  if (isLocalhost) creators.push(createSelectionStateButton);
  creators.push(createUndoButton, createRedoButton);

  for (const make of creators) {
    try {
      const spec = make(viewer);
      if (!spec) continue;
      const { label, title, onClick } = spec;
      viewer.addToolbarButton(label, title, onClick);
    } catch {}
  }
}

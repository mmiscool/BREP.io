// Registers the default toolbar buttons using the viewer's addToolbarButton API.
// Each button's logic is implemented in its own module.

import { createNewButton } from './newButton.js';
import { createSaveButton } from './saveButton.js';
import { createUndoButton, createRedoButton } from './undoRedoButtons.js';
import { createZoomToFitButton } from './zoomToFitButton.js';
import { createWireframeToggleButton } from './wireframeToggleButton.js';
import { createImportButton } from './importButton.js';
import { createExportButton } from './exportButton.js';
import { createAboutButton } from './aboutButton.js';
import { createTestsButton } from './testsButton.js';
import { createScriptRunnerButton } from './scriptRunnerButton.js';
import { createSelectionStateButton } from './selectionStateButton.js';

export function registerDefaultToolbarButtons(viewer) {
  if (!viewer || typeof viewer.addToolbarButton !== 'function') return;

  const creators = [
    createNewButton,
    createSaveButton,
    createZoomToFitButton,
    createWireframeToggleButton,
    createImportButton,
    createExportButton,
    createAboutButton,
    createTestsButton,
    createScriptRunnerButton,
    createSelectionStateButton,
    createUndoButton,
    createRedoButton,
  ];

  for (const make of creators) {
    try {
      const spec = make(viewer);
      if (!spec) continue;
      const { label, title, onClick } = spec;
      viewer.addToolbarButton(label, title, onClick);
    } catch {}
  }
}

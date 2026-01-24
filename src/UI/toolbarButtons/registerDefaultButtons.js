// Registers the default toolbar buttons using the viewer's addToolbarButton API.
// Each button's logic is implemented in its own module.

import { createSaveButton } from './saveButton.js';
import { createUndoButton, createRedoButton } from './undoRedoButtons.js';
import { createZoomToFitButton } from './zoomToFitButton.js';
import { createOrientToFaceButton } from './orientToFaceButton.js';
import { createWireframeToggleButton } from './wireframeToggleButton.js';
import { createInspectorToggleButton } from './inspectorToggleButton.js';
import { createMetadataButton } from './metadataButton.js';
import { createImportButton } from './importButton.js';
import { createExportButton } from './exportButton.js';
import { createFlatPatternButton } from './flatPatternButton.js';
import { createAboutButton } from './aboutButton.js';
import { createTestsButton } from './testsButton.js';
import { createScriptRunnerButton } from './scriptRunnerButton.js';

export function registerDefaultToolbarButtons(viewer) {
  if (!viewer || typeof viewer.addToolbarButton !== 'function') return;

  const creators = [
    createUndoButton,
    createRedoButton,
    createSaveButton,
    createZoomToFitButton,
    createOrientToFaceButton,
    createWireframeToggleButton,
    createInspectorToggleButton,
    createMetadataButton,
    createImportButton,
    createExportButton,
    createFlatPatternButton,
    createAboutButton,
    createTestsButton,
    createScriptRunnerButton,
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

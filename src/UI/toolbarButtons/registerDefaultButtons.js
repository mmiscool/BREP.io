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
import { createHistoryTestSnippetButton } from './historyTestSnippetButton.js';
import { createSelectionStateButton } from './selectionStateButton.js';
import { createSheetEditorButton } from './sheetEditorButton.js';
import { createSheetMetalFlatExportButton } from './sheetMetalFlatExportButton.js';
import { createSheetMetalDebugButton } from './sheetMetalDebugButton.js';
import { createHomeButton } from './homeButton.js';

function isLocalhostRuntime() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost'
      || host.endsWith('.localhost')
      || host === '::1';
  } catch {
    return false;
  }
}

export function registerDefaultToolbarButtons(viewer) {
  if (!viewer || typeof viewer.addToolbarButton !== 'function') return;
  const isLocalhost = isLocalhostRuntime();

  const creators = [
    { id: 'home', create: createHomeButton, source: 'builtin' },
    { id: 'new', create: createNewButton, source: 'builtin' },
    { id: 'save', create: createSaveButton, source: 'builtin' },
    { id: 'zoomToFit', create: createZoomToFitButton, source: 'builtin' },
    { id: 'wireframe', create: createWireframeToggleButton, source: 'builtin' },
    { id: 'import', create: createImportButton, source: 'builtin' },
    { id: 'export', create: createExportButton, source: 'builtin' },
    { id: 'share', create: createShareButton, source: 'builtin' },
    { id: 'sheetEditor', create: createSheetEditorButton, source: 'builtin' },
    { id: 'sheetMetalFlatExport', create: createSheetMetalFlatExportButton, source: 'builtin' },
  ];

  if (isLocalhost) creators.push({ id: 'sheetMetalDebug', create: createSheetMetalDebugButton, source: 'builtin' });
  creators.push({ id: 'about', create: createAboutButton, source: 'builtin' });
  if (isLocalhost) creators.push({ id: 'tests', create: createTestsButton, source: 'builtin' });
  creators.push({ id: 'historyTestSnippet', create: createHistoryTestSnippetButton, source: 'builtin' });
  creators.push({ id: 'scriptRunner', create: createScriptRunnerButton, source: 'builtin' });
  if (isLocalhost) creators.push({ id: 'selectionState', create: createSelectionStateButton, source: 'builtin' });
  creators.push(
    { id: 'undo', create: createUndoButton, source: 'builtin' },
    { id: 'redo', create: createRedoButton, source: 'builtin' },
  );

  for (const entry of creators) {
    try {
      const spec = entry.create(viewer);
      if (!spec) continue;
      viewer.addToolbarButton({
        ...spec,
        id: entry.id,
        source: entry.source || 'builtin',
      });
    } catch {}
  }
}

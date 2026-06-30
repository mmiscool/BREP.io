const FLOATING_WINDOW_SHOTS = new Set([
  'floating-export',
  'floating-metadata',
  'floating-inspector',
  'floating-selection-diagnostics',
  'floating-triangle-debugger',
  'floating-display-settings',
  'floating-share-model',
  'floating-script-runner',
  'floating-selection-state',
  'floating-solid-overlap-diagnostics',
  'floating-sheet-metal-flat-export',
  'floating-sheet-metal-debug',
  'floating-browser-testing',
  'floating-history-test-snippet',
  'floating-add-plugin',
  'floating-save-model',
  'floating-unsaved-changes',
  'floating-component-selector',
  'floating-wire-harness-insert-sheet',
]);

export function isFloatingWindowScreenshotId(shotId) {
  return FLOATING_WINDOW_SHOTS.has(String(shotId || ''));
}

export async function prepareFloatingWindowScreenshot(page, shotId) {
  await page.evaluate(async ({ shotIdValue }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const importAppModule = (path) => import(/* @vite-ignore */ path);
    const withFixedDate = async (callback) => {
      const RealDate = Date;
      const fixedTime = new RealDate('2026-01-01T00:00:00.000Z').getTime();
      const FixedDate = function (...args) {
        if (!(this instanceof FixedDate)) return new RealDate(fixedTime).toString();
        if (!args.length) return new RealDate(fixedTime);
        if (args.length === 1) return new RealDate(args[0]);
        return new RealDate(
          args[0],
          args[1],
          args[2] == null ? 1 : args[2],
          args[3] == null ? 0 : args[3],
          args[4] == null ? 0 : args[4],
          args[5] == null ? 0 : args[5],
          args[6] == null ? 0 : args[6],
        );
      } as any;
      FixedDate.now = () => fixedTime;
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      FixedDate.prototype = RealDate.prototype;
      try { (window as any).Date = FixedDate; } catch { /* ignore Date replacement failure */ }
      try {
        return await callback();
      } finally {
        try { (window as any).Date = RealDate; } catch { /* ignore Date restore failure */ }
      }
    };

    const closeFloatingWindows = () => {
      for (const win of Array.from(document.querySelectorAll('.floating-window'))) {
        try { win.remove(); } catch { /* ignore stale screenshot window cleanup */ }
      }
      for (const overlay of Array.from(document.querySelectorAll('.floating-window-modal-overlay'))) {
        try { overlay.remove(); } catch { /* ignore stale screenshot overlay cleanup */ }
      }
    };

    const firstSolid = () => {
      const scene = viewer.partHistory?.scene || viewer.scene || null;
      let found = null;
      try {
        scene?.traverse?.((object) => {
          if (found || !object) return;
          if (String(object.type || '').toUpperCase() === 'SOLID') found = object;
        });
      } catch { /* ignore scene traversal failure */ }
      return found;
    };

    const markSelected = (object) => {
      if (!object) return;
      try { object.selected = true; } catch { /* ignore selection state assignment */ }
      try { viewer._lastInspectorTarget = object; } catch { /* ignore inspector cache update */ }
      try { window.dispatchEvent(new Event('selection-changed')); } catch { /* ignore selection event */ }
    };

    const prepareCube = async () => {
      try { viewer.endSketchMode?.(); } catch { /* ignore mode cleanup */ }
      try { viewer.endPMIMode?.(); } catch { /* ignore mode cleanup */ }
      try { viewer.closeSheet2DEditor?.(); } catch { /* ignore mode cleanup */ }
      await viewer.partHistory.reset();

      const cube = await viewer.partHistory.newFeature('P.CU');
      if (cube?.inputParams) {
        cube.inputParams.sizeX = 18;
        cube.inputParams.sizeY = 14;
        cube.inputParams.sizeZ = 10;
        cube.inputParams.transform = {
          position: [-9, -7, -5],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        };
      }
      viewer.partHistory.currentHistoryStepId = null;
      await viewer.partHistory.runHistory();
      try { viewer.historyWidget?.render?.(); } catch { /* ignore history UI refresh */ }
      const solid = firstSolid();
      if (solid) {
        try { solid.name = solid.name || 'Demo_Cube'; } catch { /* ignore readonly name */ }
        markSelected(solid);
      }
      try {
        viewer.camera?.position?.set?.(24, 18, 24);
        viewer.controls?.target?.set?.(0, 0, 0);
        viewer.controls?.update?.();
        viewer.zoomToFit?.(1.2);
      } catch { /* ignore camera framing */ }
      await nextFrame();
      return solid;
    };

    const prepareSheetMetalSolid = async () => {
      try { viewer.endSketchMode?.(); } catch { /* ignore mode cleanup */ }
      try { viewer.endPMIMode?.(); } catch { /* ignore mode cleanup */ }
      try { viewer.closeSheet2DEditor?.(); } catch { /* ignore mode cleanup */ }
      await viewer.partHistory.reset();
      const { __test_buildRenderableSheetModelFromTree } = await importAppModule('/src/features/sheetMetal/sheetMetalEngineBridge.js');
      const featureID = 'SM_DOC_FLAT_PATTERN';
      const flatId = `${featureID}:flat_root`;
      const tree = {
        thickness: 2,
        root: {
          kind: 'flat',
          id: flatId,
          label: 'Flat Pattern Demo',
          outline: [
            [0, 0],
            [70, 0],
            [70, 38],
            [0, 38],
          ],
          edges: [
            { id: `${flatId}:e1`, polyline: [[0, 0], [70, 0]] },
            { id: `${flatId}:e2`, polyline: [[70, 0], [70, 38]] },
            { id: `${flatId}:e3`, polyline: [[70, 38], [0, 38]] },
            { id: `${flatId}:e4`, polyline: [[0, 38], [0, 0]] },
          ],
        },
      };
      const { root: solid } = __test_buildRenderableSheetModelFromTree({
        featureID,
        tree,
        showFlatPattern: true,
      });
      solid.name = 'Sheet_Metal_Demo';
      viewer.partHistory.scene?.add?.(solid);
      try { await solid.visualize?.(); } catch { /* ignore sheet metal preview render */ }
      markSelected(solid);
      try {
        viewer.camera?.position?.set?.(90, -110, 90);
        viewer.controls?.target?.set?.(35, 18, 0);
        viewer.controls?.update?.();
        viewer.zoomToFit?.(1.25);
      } catch { /* ignore camera framing */ }
      await nextFrame();
      return solid;
    };

    closeFloatingWindows();

    if (shotIdValue === 'floating-sheet-metal-flat-export' || shotIdValue === 'floating-sheet-metal-debug') {
      await prepareSheetMetalSolid();
    } else {
      await prepareCube();
    }

    const solid = firstSolid();

    switch (shotIdValue) {
      case 'floating-export': {
        const { createExportButton } = await importAppModule('/src/UI/toolbarButtons/exportButton.js');
        createExportButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-metadata': {
        const { createMetadataButton } = await importAppModule('/src/UI/toolbarButtons/metadataButton.js');
        if (solid?.name) {
          viewer.partHistory.metadataManager?.setMetadataObject?.(solid.name, {
            material: 'Aluminum 6061',
            finish: 'Clear anodize',
            revision: 'A',
            supplier: 'Docs capture fixture',
          });
        }
        createMetadataButton(viewer)?.onClick?.();
        viewer.__metadataPanelController?.handleSelection?.(solid);
        break;
      }
      case 'floating-inspector': {
        viewer._openInspectorPanel?.();
        viewer._updateInspectorFor?.(solid);
        break;
      }
      case 'floating-selection-diagnostics': {
        viewer._showDiagnosticsFor?.(solid);
        break;
      }
      case 'floating-triangle-debugger': {
        viewer._openTriangleDebugger?.();
        if (viewer._triangleDebugger) viewer._triangleDebugger.openFor?.(solid);
        break;
      }
      case 'floating-display-settings': {
        viewer.openSettingsDialog?.();
        break;
      }
      case 'floating-share-model': {
        const { createShareButton } = await importAppModule('/src/UI/toolbarButtons/shareButton.js');
        createShareButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-script-runner': {
        const { createScriptRunnerButton } = await importAppModule('/src/UI/toolbarButtons/scriptRunnerButton.js');
        createScriptRunnerButton(viewer)?.onClick?.();
        await sleep(700);
        break;
      }
      case 'floating-selection-state': {
        const { createSelectionStateButton } = await importAppModule('/src/UI/toolbarButtons/selectionStateButton.js');
        markSelected(solid);
        createSelectionStateButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-solid-overlap-diagnostics': {
        const { createSolidOverlapDiagnosticsButton } = await importAppModule('/src/UI/toolbarButtons/solidOverlapDiagnosticsButton.js');
        markSelected(solid);
        createSolidOverlapDiagnosticsButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-sheet-metal-flat-export': {
        const { createSheetMetalFlatExportButton } = await importAppModule('/src/UI/toolbarButtons/sheetMetalFlatExportButton.js');
        createSheetMetalFlatExportButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-sheet-metal-debug': {
        const { createSheetMetalDebugButton } = await importAppModule('/src/UI/toolbarButtons/sheetMetalDebugButton.js');
        await createSheetMetalDebugButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-browser-testing': {
        const { createTestsButton } = await importAppModule('/src/UI/toolbarButtons/testsButton.js');
        await createTestsButton(viewer)?.onClick?.();
        break;
      }
      case 'floating-history-test-snippet': {
        const { createHistoryTestSnippetButton } = await importAppModule('/src/UI/toolbarButtons/historyTestSnippetButton.js');
        await withFixedDate(async () => createHistoryTestSnippetButton(viewer)?.onClick?.());
        break;
      }
      case 'floating-add-plugin': {
        const { PluginsWidget } = await importAppModule('/src/UI/PluginsWidget.js');
        const widget = new PluginsWidget(viewer);
        widget._openAddModal?.();
        break;
      }
      case 'floating-save-model': {
        void viewer.fileManagerWidget?._openSaveTargetDialog?.('docs/floating-window-demo.3mf');
        break;
      }
      case 'floating-unsaved-changes': {
        void viewer.fileManagerWidget?._openNavigateHomeDialog?.();
        break;
      }
      case 'floating-component-selector': {
        const { openComponentSelectorModal } = await importAppModule('/src/UI/componentSelectorModal.js');
        void openComponentSelectorModal({ title: 'Select Component' });
        break;
      }
      case 'floating-wire-harness-insert-sheet': {
        if (!viewer.wireHarnessConnectionsWidget) {
          const { WireHarnessConnectionsWidget } = await importAppModule('/src/UI/wireHarness/WireHarnessConnectionsWidget.js');
          viewer.wireHarnessConnectionsWidget = new WireHarnessConnectionsWidget(viewer);
        }
        viewer.wireHarnessConnectionsWidget?._openInsertToSheetWindow?.();
        break;
      }
      default:
        throw new Error(`Unknown floating window docs shot "${shotIdValue}"`);
    }

    await nextFrame();
  }, { shotIdValue: shotId });

  await page.locator('.floating-window').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(350);
}

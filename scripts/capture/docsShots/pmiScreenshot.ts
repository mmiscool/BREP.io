export async function preparePmiScreenshot(page, pmiFixtureJson = '') {
  await page.evaluate(async ({ pmiFixtureJsonValue }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const partHistory = viewer.partHistory;
    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

    const hasFixture = typeof pmiFixtureJsonValue === 'string' && pmiFixtureJsonValue.trim().length > 0;
    if (hasFixture) {
      await partHistory.fromJSON(pmiFixtureJsonValue);
      partHistory.currentHistoryStepId = null;
      await partHistory.runHistory();
      try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }
      try {
        viewer.pmiViewsWidget?.refreshFromHistory?.();
        viewer.pmiViewsWidget?._renderList?.();
      } catch { /* ignore */ }
    } else {
      await partHistory.reset();
      const cube = await partHistory.newFeature('P.CU');
      cube.inputParams.sizeX = 12;
      cube.inputParams.sizeY = 12;
      cube.inputParams.sizeZ = 12;
      cube.inputParams.transform = {
        position: [-6, -6, -6],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
      partHistory.currentHistoryStepId = null;
      await partHistory.runHistory();

      try {
        viewer.camera?.position?.set?.(21, 17, 23);
        viewer.controls?.target?.set?.(0, 0, 0);
        viewer.controls?.update?.();
      } catch { /* ignore */ }
      try { viewer.zoomToFit?.(1.18); } catch { /* ignore */ }
    }

    const manager = partHistory.pmiViewsManager;
    let views = manager?.getViews?.() || [];
    let viewEntry = views[0] || null;
    if (!viewEntry) {
      viewEntry = manager?.addView?.({
        viewName: 'test view',
        name: 'test view',
        camera: {},
        annotations: [],
      }) || {
        viewName: 'test view',
        name: 'test view',
        camera: {},
        annotations: [],
      };
      views = manager?.getViews?.() || [];
    }
    const viewIndex = Math.max(0, views.indexOf(viewEntry));
    const openViaWidget = viewer.pmiViewsWidget && typeof viewer.pmiViewsWidget._enterEditMode === 'function';
    if (openViaWidget) {
      await Promise.resolve(viewer.pmiViewsWidget._enterEditMode(viewEntry, viewIndex));
    } else {
      viewer.startPMIMode(viewEntry, viewIndex, viewer.pmiViewsWidget);
    }

    const mode = viewer._pmiMode;
    const annHistory = mode?._annotationHistory;
    if (!hasFixture && annHistory?.createAnnotation) {
      annHistory.createAnnotation('linear', {
        targets: [],
        p0: { x: -6, y: 6, z: 6 },
        p1: { x: 6, y: 6, z: 6 },
        offset: 2,
        decimals: 3,
      });
      annHistory.createAnnotation('linear', {
        targets: [],
        p0: { x: 6, y: 6, z: 6 },
        p1: { x: 6, y: -6, z: 6 },
        offset: 2,
        decimals: 3,
      });
      annHistory.createAnnotation('note', {
        text: 'BREAK SHARP CORNERS',
        position: { x: -6, y: -6, z: -6 },
      });
    }

    const entries = annHistory?.getEntries?.() || [];
    for (const entry of entries) {
      if (entry?.runtimeAttributes) entry.runtimeAttributes.__open = false;
      if (entry?.inputParams) entry.inputParams.__open = false;
    }

    try { mode?._annotationWidget?.render?.(); } catch { /* ignore */ }
    try { mode?.markAnnotationsDirty?.(); } catch { /* ignore */ }
    try { mode?._refreshOverlays?.(); } catch { /* ignore */ }
  }, { pmiFixtureJsonValue: pmiFixtureJson || '' });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450);
}

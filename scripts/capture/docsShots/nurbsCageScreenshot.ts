export async function prepareNurbsCageScreenshot(page) {
  await page.evaluate(async () => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const partHistory = viewer.partHistory;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const ensureHistoryEntryOpen = (entry, entryId) => {
      if (!entry) return;
      entry.runtimeAttributes = (entry.runtimeAttributes && typeof entry.runtimeAttributes === 'object')
        ? entry.runtimeAttributes
        : {};
      entry.runtimeAttributes.__open = true;
      entry.inputParams = (entry.inputParams && typeof entry.inputParams === 'object')
        ? entry.inputParams
        : {};
      entry.inputParams.__open = true;
      if (entryId) {
        try {
          viewer.historyWidget._expandedId = String(entryId);
        } catch {
          // ignore private history state assignment errors
        }
      }
    };
    const ensureDialogFormOpen = async (entryId) => {
      const id = String(entryId || '');
      if (!id) return false;
      const historyWidget = viewer.historyWidget;
      if (!historyWidget) return false;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        try { historyWidget.render?.(); } catch { /* ignore */ }
        const form = historyWidget.getFormForEntry?.(id);
        if (form) return true;
        const expanded = historyWidget._expandedId != null ? String(historyWidget._expandedId) : null;
        if (expanded !== id) {
          try { historyWidget._toggleEntry?.(id); } catch { /* ignore */ }
        }
        await wait(70);
      }
      return !!historyWidget.getFormForEntry?.(id);
    };

    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

    await partHistory.reset();
    const nurbs = await partHistory.newFeature('NURBS');
    if (!nurbs?.inputParams) throw new Error('Failed to create NURBS feature for capture');

    nurbs.inputParams.basePrimitive = 'CUBE';
    nurbs.inputParams.volumeSize = 10;
    nurbs.inputParams.volumeDensity = 20;
    nurbs.inputParams.cageDivisionsU = 5;
    nurbs.inputParams.cageDivisionsV = 5;
    nurbs.inputParams.cageDivisionsW = 5;
    nurbs.inputParams.cagePadding = 0.08;

    nurbs.persistentData = (nurbs.persistentData && typeof nurbs.persistentData === 'object')
      ? nurbs.persistentData
      : {};
    nurbs.persistentData.editorOptions = {
      showEdges: true,
      showControlPoints: true,
      allowX: true,
      allowY: true,
      allowZ: true,
      symmetryX: false,
      symmetryY: false,
      symmetryZ: false,
      cageColor: '#70d6ff',
    };

    const entryId = String(
      nurbs.inputParams.id
      || nurbs.inputParams.featureID
      || nurbs.id
      || 'nurbs-capture',
    );
    ensureHistoryEntryOpen(nurbs, entryId);
    partHistory.currentHistoryStepId = entryId;

    await partHistory.runHistory();
    try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('History')); } catch { /* ignore */ }
    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarAutoHideSuspended?.(false);
      viewer._setSidebarHoverVisible?.(true);
    } catch { /* ignore */ }

    const historyEntry = (Array.isArray(partHistory.features) ? partHistory.features : [])
      .find((feature) => String(
        feature?.inputParams?.id
        || feature?.inputParams?.featureID
        || feature?.id
        || '',
      ) === entryId);
    ensureHistoryEntryOpen(historyEntry, entryId);
    await ensureDialogFormOpen(entryId);

    try {
      viewer.camera?.position?.set?.(18, 14, 18);
      viewer.controls?.target?.set?.(0, 0, 0);
      viewer.controls?.update?.();
    } catch { /* ignore */ }
    try { viewer.zoomToFit?.(1.1); } catch { /* ignore */ }
    try { viewer.render?.(); } catch { /* ignore */ }
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

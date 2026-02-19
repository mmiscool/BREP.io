export async function prepareSketchScreenshot(page, fixtureJson) {
  await page.evaluate(async ({ fixtureJsonValue }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const partHistory = viewer.partHistory;
    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

    if (fixtureJsonValue) {
      await partHistory.fromJSON(fixtureJsonValue);
      partHistory.currentHistoryStepId = null;
      await partHistory.runHistory();
    } else {
      await partHistory.reset();
      await partHistory.newFeature('S');
      partHistory.currentHistoryStepId = null;
      await partHistory.runHistory();
    }

    const sketchFeature = (partHistory.features || []).find((entry) => String(entry?.type || '').toUpperCase() === 'S');
    const sketchId = sketchFeature?.inputParams?.id || sketchFeature?.inputParams?.featureID;
    if (!sketchId) throw new Error('No sketch feature found for capture');

    viewer.startSketchMode(sketchId);
    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarHoverVisible?.(true);
    } catch { /* ignore */ }
  }, { fixtureJsonValue: fixtureJson || '' });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450);
}

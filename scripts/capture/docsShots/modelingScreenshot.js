export async function prepareModelingScreenshot(page) {
  await page.evaluate(async () => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const partHistory = viewer.partHistory;
    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

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

    try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('History')); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('PMI Views')); } catch { /* ignore */ }
    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarAutoHideSuspended?.(false);
      viewer._setSidebarHoverVisible?.(true);
    } catch { /* ignore */ }
    try {
      viewer.camera?.position?.set?.(22, 16, 22);
      viewer.controls?.target?.set?.(0, 0, 0);
      viewer.controls?.update?.();
    } catch { /* ignore */ }
    try { viewer.zoomToFit?.(1.15); } catch { /* ignore */ }
  });
  await page.waitForTimeout(300);
}

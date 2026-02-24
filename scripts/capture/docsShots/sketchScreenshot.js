export async function prepareSketchScreenshot(page, fixtureJson) {
  await page.evaluate(async ({ fixtureJsonValue }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const panSketchClearOfSidebar = () => {
      const sketchMode = viewer._sketchMode;
      const camera = viewer.camera;
      const controls = viewer.controls;
      const rendererEl = viewer.renderer?.domElement;
      const basis = sketchMode?._lock?.basis;
      const points = sketchMode?._solver?.sketchObject?.points;
      if (
        !camera?.isOrthographicCamera
        || !rendererEl
        || !basis?.origin
        || !basis?.x
        || !Array.isArray(points)
        || points.length === 0
      ) return;

      const viewportRect = rendererEl.getBoundingClientRect?.();
      if (!viewportRect || viewportRect.width <= 0 || viewportRect.height <= 0) return;

      const sidebarRect = viewer.sidebar?.getBoundingClientRect?.();
      const sidebarRightPx = sidebarRect ? (sidebarRect.right - viewportRect.left) : 0;
      const sidebarClearancePx = 56;
      const safeLeftPx = Math.max(0, sidebarRightPx) + sidebarClearancePx;

      let minSketchScreenX = Infinity;
      const worldPoint = basis.origin.clone();
      for (const point of points) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        worldPoint.copy(basis.origin).addScaledVector(basis.x, x).addScaledVector(basis.y, y).project(camera);
        if (!Number.isFinite(worldPoint.x)) continue;
        const screenX = ((worldPoint.x + 1) * 0.5) * viewportRect.width;
        if (screenX < minSketchScreenX) minSketchScreenX = screenX;
      }
      if (!Number.isFinite(minSketchScreenX)) return;

      const deltaPx = safeLeftPx - minSketchScreenX;
      if (!(deltaPx > 0.5)) return;

      const zoom = camera.zoom > 0 ? camera.zoom : 1;
      const worldPerPixelX = (camera.right - camera.left) / (viewportRect.width * zoom);
      const worldShift = deltaPx * worldPerPixelX;
      if (!(worldShift > 0)) return;

      const Vec3 = camera.position?.constructor;
      const cameraRight = Vec3 ? new Vec3() : null;
      if (!cameraRight) return;
      cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

      // Shift camera/target left in screen-space terms so the sketch appears farther right.
      camera.position.addScaledVector(cameraRight, -worldShift);
      controls?.target?.addScaledVector?.(cameraRight, -worldShift);
      camera.updateMatrixWorld?.(true);
      controls?.update?.();
    };

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

    // Allow sketch-mode UI layout to settle, then nudge view so geometry clears the sidebar.
    for (let i = 0; i < 2; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      try { panSketchClearOfSidebar(); } catch { /* ignore */ }
    }
  }, { fixtureJsonValue: fixtureJson || '' });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450);
}

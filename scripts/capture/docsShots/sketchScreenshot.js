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

    const selectLineForContextToolbar = async () => {
      const sketchMode = viewer._sketchMode;
      const geometries = sketchMode?._solver?.sketchObject?.geometries;
      if (!Array.isArray(geometries) || geometries.length === 0) return false;

      const targetGeometry = geometries.find((geo) => String(geo?.type || '').toLowerCase() === 'line')
        || geometries[0];
      const targetId = Number(targetGeometry?.id);
      if (!Number.isFinite(targetId)) return false;

      const isSelected = () => Array.from(sketchMode?._selection || []).some(
        (item) => item?.type === 'geometry' && Number(item?.id) === targetId,
      );

      const clickLineMidpointInViewport = async () => {
        const camera = viewer.camera;
        const rendererEl = viewer.renderer?.domElement;
        const basis = sketchMode?._lock?.basis;
        const points = sketchMode?._solver?.sketchObject?.points;
        const linePointIds = Array.isArray(targetGeometry?.points) ? targetGeometry.points : [];
        if (
          !camera
          || !rendererEl
          || !basis?.origin
          || !basis?.x
          || !basis?.y
          || !Array.isArray(points)
          || linePointIds.length < 2
        ) return false;

        const id0 = Number(linePointIds[0]);
        const id1 = Number(linePointIds[1]);
        const p0 = points.find((point) => Number(point?.id) === id0);
        const p1 = points.find((point) => Number(point?.id) === id1);
        if (!p0 || !p1) return false;

        const midX = (Number(p0.x) + Number(p1.x)) * 0.5;
        const midY = (Number(p0.y) + Number(p1.y)) * 0.5;
        if (!Number.isFinite(midX) || !Number.isFinite(midY)) return false;

        const rect = rendererEl.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;

        const worldPoint = basis.origin.clone().addScaledVector(basis.x, midX).addScaledVector(basis.y, midY);
        const ndc = worldPoint.project(camera);
        if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return false;

        const clientX = rect.left + ((ndc.x + 1) * 0.5) * rect.width;
        const clientY = rect.top + ((1 - ndc.y) * 0.5) * rect.height;
        if (
          clientX < rect.left
          || clientX > rect.right
          || clientY < rect.top
          || clientY > rect.bottom
        ) return false;

        const downOpts = {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          buttons: 1,
        };
        const upOpts = {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          buttons: 0,
        };

        try { sketchMode?._selection?.clear?.(); } catch { /* ignore */ }
        if (typeof window.PointerEvent === 'function') {
          rendererEl.dispatchEvent(new PointerEvent('pointerdown', { ...downOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          window.dispatchEvent(new PointerEvent('pointerup', { ...upOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        } else {
          rendererEl.dispatchEvent(new MouseEvent('mousedown', downOpts));
          window.dispatchEvent(new MouseEvent('mouseup', upOpts));
        }
        rendererEl.dispatchEvent(new MouseEvent('click', upOpts));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return isSelected();
      };

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const listRoot = sketchMode?._acc?.uiElement;
        const rowButton = (listRoot && typeof listRoot.querySelector === 'function')
          ? listRoot.querySelector(`[data-act="g:${targetId}"]`)
          : null;
        if (rowButton instanceof HTMLElement) {
          try { sketchMode?._selection?.clear?.(); } catch { /* ignore */ }
          rowButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          if (isSelected()) return true;
        }
        await wait(50);
      }
      return clickLineMidpointInViewport();
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
    let didSelectLine = false;
    try { didSelectLine = await selectLineForContextToolbar(); } catch { /* ignore */ }
    if (!didSelectLine) {
      // One final settle if async sidebar/list rendering lagged unexpectedly.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, { fixtureJsonValue: fixtureJson || '' });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
}

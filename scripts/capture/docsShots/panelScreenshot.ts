const PANEL_CAPTURE_TARGET_ID = 'panel-doc-capture-target';

const PANEL_SHOTS = new Map([
  ['panel-feature-history', { workbench: 'MODELING', title: 'History' }],
  ['panel-assembly-constraints', { workbench: 'ASSEMBLIES', title: 'Assembly Constraints' }],
  ['panel-pmi-views', { workbench: 'PMI', title: 'PMI Views' }],
  ['panel-sheets-2d', { workbench: 'MODELING', title: '2D Sheets' }],
  ['panel-wire-harness', { workbench: 'WIRE_HARNESS', title: 'Wire Harness' }],
  ['panel-simulation', { workbench: 'SIMULATION', title: 'Simulation' }],
  ['panel-plugins', { workbench: 'MODELING', title: 'Plugins' }],
]);

export function isPanelScreenshotId(shotId) {
  return PANEL_SHOTS.has(String(shotId || ''));
}

export async function preparePanelScreenshot(page, shotId) {
  await page.evaluate(async ({ shotIdValue, captureTargetId }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const config = new Map([
      ['panel-feature-history', { workbench: 'MODELING', title: 'History' }],
      ['panel-assembly-constraints', { workbench: 'ASSEMBLIES', title: 'Assembly Constraints' }],
      ['panel-pmi-views', { workbench: 'PMI', title: 'PMI Views' }],
      ['panel-sheets-2d', { workbench: 'MODELING', title: '2D Sheets' }],
      ['panel-wire-harness', { workbench: 'WIRE_HARNESS', title: 'Wire Harness' }],
      ['panel-simulation', { workbench: 'SIMULATION', title: 'Simulation' }],
      ['panel-plugins', { workbench: 'MODELING', title: 'Plugins' }],
    ]).get(String(shotIdValue || ''));
    if (!config) throw new Error(`Unknown panel screenshot "${shotIdValue}"`);

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const ensureCaptureTarget = () => {
      let target = document.getElementById(captureTargetId);
      if (!target) {
        target = document.createElement('div');
        target.id = captureTargetId;
        target.style.position = 'fixed';
        target.style.pointerEvents = 'none';
        target.style.opacity = '1';
        target.style.zIndex = '2147483646';
        document.body.appendChild(target);
      }
      return target;
    };

    const movePanelIntoCaptureTarget = (titleElement, contentElement, padding = 0) => {
      const titleRect = titleElement.getBoundingClientRect?.();
      const contentRect = contentElement.getBoundingClientRect?.();
      const width = Math.max(260, Math.ceil(titleRect?.width || 0), Math.ceil(contentRect?.width || 0));
      const target = ensureCaptureTarget();
      target.textContent = '';
      target.style.left = '16px';
      target.style.top = '16px';
      target.style.width = `${width + (padding * 2)}px`;
      target.style.height = 'auto';
      target.style.padding = `${padding}px`;
      target.style.background = 'transparent';
      target.style.boxSizing = 'border-box';

      try {
        titleElement.hidden = false;
        contentElement.hidden = false;
        titleElement.style.display = '';
        contentElement.style.display = '';
        contentElement.style.height = 'auto';
        contentElement.style.maxHeight = 'none';
        contentElement.classList.remove('collapsed');
      } catch { /* ignore panel normalization */ }

      target.appendChild(titleElement);
      target.appendChild(contentElement);
      return target;
    };

    const titleFor = (title) => (
      document.querySelector(`.accordion-title[name="accordion-title-${title}"]`)
      || Array.from(document.querySelectorAll('.accordion-title'))
        .find((element) => String(element?.textContent || '').trim() === title)
      || null
    );
    const contentFor = (title, titleElement = null) => (
      document.getElementById(`accordion-content-${title}`)
      || document.querySelector(`.accordion-content[name="accordion-content-${title}"]`)
      || (titleElement?.nextElementSibling?.classList?.contains('accordion-content') ? titleElement.nextElementSibling : null)
    );
    const waitForPanel = async (title, timeoutMs = 10000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const titleEl = titleFor(title);
        const contentEl = contentFor(title, titleEl);
        if (titleEl && contentEl) return { titleEl, contentEl };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Panel "${title}" was not found`);
    };

    try { viewer.endSketchMode?.(); } catch { /* ignore mode cleanup */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore mode cleanup */ }
    try { viewer.closeSheet2DEditor?.(); } catch { /* ignore mode cleanup */ }
    await viewer.partHistory.reset();

    const cube = await viewer.partHistory.newFeature('P.CU');
    if (cube?.inputParams) {
      cube.inputParams.sizeX = 16;
      cube.inputParams.sizeY = 12;
      cube.inputParams.sizeZ = 10;
      cube.inputParams.transform = {
        position: [-8, -6, -5],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      };
    }
    viewer.partHistory.currentHistoryStepId = null;
    await viewer.partHistory.runHistory();
    try { viewer.historyWidget?.render?.(); } catch { /* ignore history render */ }

    try { viewer.setActiveWorkbench?.(config.workbench, { queueHistorySnapshot: false }); } catch { /* ignore workbench switch */ }
    if (config.workbench === 'SIMULATION') {
      try { await viewer._ensureSimulationWorkbenchManager?.(); } catch { /* ignore simulation manager */ }
    }
    try { viewer.refreshWorkbenchUi?.(); } catch { /* ignore workbench refresh */ }

    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarAutoHideSuspended?.(true);
      viewer._setSidebarHoverVisible?.(true);
      if (viewer.sidebar) {
        viewer.sidebar.hidden = false;
        viewer.sidebar.style.display = '';
        viewer.sidebar.style.visibility = 'visible';
        viewer.sidebar.style.transform = '';
      }
    } catch { /* ignore sidebar visibility */ }

    try { await Promise.resolve(viewer.accordion?.collapseAll?.()); } catch { /* ignore accordion collapse */ }
    try { viewer.accordion?.showSection?.(config.title); } catch { /* ignore panel show */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.(config.title)); } catch { /* ignore panel expand */ }
    await nextFrame();

    const { titleEl, contentEl } = await waitForPanel(config.title);
    try {
      titleEl.hidden = false;
      titleEl.style.display = '';
      contentEl.hidden = false;
      contentEl.style.display = '';
      contentEl.classList.remove('collapsed');
      titleEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch { /* ignore panel scroll */ }
    await nextFrame();

    movePanelIntoCaptureTarget(titleEl, contentEl, 0);
  }, { shotIdValue: shotId, captureTargetId: PANEL_CAPTURE_TARGET_ID });

  await page.locator(`#${PANEL_CAPTURE_TARGET_ID}`).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(250);
}

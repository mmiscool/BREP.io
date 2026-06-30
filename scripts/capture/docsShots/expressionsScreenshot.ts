const EXPRESSIONS_CAPTURE_TARGET_ID = 'expressions-doc-capture-target';

function createCubeTransform() {
  return {
    position: [-8, -6, -4],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function buildExpressionsOnlyState() {
  return {
    expressions: [
      'width = 80;',
      'height = width * 0.6;',
      'wall = 2;',
      'innerWidth = width - wall * 2;',
    ].join('\n'),
    configurator: {
      fields: [],
      values: {},
    },
  };
}

function buildConfiguratorEditorState() {
  return {
    expressions: [
      'width = configurator.panelWidth;',
      'finish = configurator.finish;',
      'holeOffset = width * 0.25;',
    ].join('\n'),
    configurator: {
      fields: [
        {
          name: 'panelWidth',
          label: 'Panel Width',
          type: 'slider',
          defaultValue: 96,
          min: 40,
          max: 140,
          step: 2,
        },
        {
          name: 'finish',
          label: 'Finish',
          type: 'select',
          defaultValue: 'Powder Coat',
          options: ['Powder Coat', 'Anodized', 'Raw'],
        },
      ],
      values: {
        panelWidth: 112,
        finish: 'Anodized',
      },
    },
  };
}

function buildConfiguratorFieldTypesState() {
  return {
    expressions: [
      'panelWidth = configurator.panelWidth;',
      'ribCount = configurator.ribCount;',
      'finish = configurator.finish;',
      'partLabel = configurator.partLabel;',
    ].join('\n'),
    configurator: {
      fields: [
        {
          name: 'panelWidth',
          label: 'Panel Width',
          type: 'slider',
          defaultValue: 72,
          min: 40,
          max: 140,
          step: 2,
        },
        {
          name: 'ribCount',
          label: 'Rib Count',
          type: 'number',
          defaultValue: 6,
          min: 1,
          max: 12,
          step: 1,
        },
        {
          name: 'finish',
          label: 'Finish',
          type: 'select',
          defaultValue: 'Matte Black',
          options: ['Matte Black', 'Brushed', 'Primer'],
        },
        {
          name: 'partLabel',
          label: 'Part Label',
          type: 'string',
          defaultValue: 'Bracket A',
        },
      ],
      values: {
        panelWidth: 94,
        ribCount: 8,
        finish: 'Brushed',
        partLabel: 'Panel 01',
      },
    },
  };
}

function buildShotState(shotId) {
  if (shotId === 'expressions-panel') return buildExpressionsOnlyState();
  if (shotId === 'configurator-editor') return buildConfiguratorEditorState();
  if (shotId === 'configurator-field-types') return buildConfiguratorFieldTypesState();
  throw new Error(`Unknown expressions docs shot "${shotId}"`);
}

export async function prepareExpressionsScreenshot(page, shotId) {
  const shotState = buildShotState(shotId);
  const cubeTransform = createCubeTransform();

  await page.evaluate(async ({
    shotIdValue,
    shotStateValue,
    cubeTransformValue,
    captureTargetId,
  }) => {
    const waitForExpressionsUi = async (timeoutMs = 15000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const manager = window.viewer?.expressionsManager || null;
        const title = Array.from(document.querySelectorAll('.accordion-title'))
          .find((element) => String(element?.textContent || '').trim() === 'Expressions') || null;
        const content = document.getElementById('accordion-content-Expressions');
        if (manager && title && content) {
          return { manager, title, content };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Expressions UI was not created in time.');
    };

    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const partHistory = viewer.partHistory;
    const ensureCaptureTarget = () => {
      let target = document.getElementById(captureTargetId);
      if (!target) {
        target = document.createElement('div');
        target.id = captureTargetId;
        document.body.appendChild(target);
      }
      target.hidden = false;
      target.style.position = 'fixed';
      target.style.left = '16px';
      target.style.top = '16px';
      target.style.width = shotIdValue === 'configurator-editor' ? '620px' : '540px';
      target.style.height = 'auto';
      target.style.display = 'block';
      target.style.visibility = 'visible';
      target.style.pointerEvents = 'none';
      target.style.zIndex = '2147483646';
      target.style.background = 'transparent';
      return target;
    };

    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

    const {
      manager: expressionsManager,
      title: expressionsTitle,
      content: expressionsContent,
    } = await waitForExpressionsUi();
    const normalizeExpressionsVisibility = async () => {
      try {
        viewer._setSidebarPinned?.(true);
        viewer._setSidebarAutoHideSuspended?.(true);
        viewer._setSidebarHoverVisible?.(true);
        if (viewer.sidebar) {
          viewer.sidebar.hidden = false;
          viewer.sidebar.style.display = '';
          viewer.sidebar.style.visibility = 'visible';
          viewer.sidebar.style.transform = '';
          viewer.sidebar.style.width = shotIdValue === 'configurator-editor' ? '620px' : '540px';
        }
      } catch { /* ignore */ }
      try {
        expressionsTitle.hidden = false;
        expressionsTitle.style.display = '';
        expressionsTitle.style.visibility = 'visible';
        expressionsTitle.removeAttribute('aria-hidden');
        expressionsContent.hidden = false;
        expressionsContent.style.display = '';
        expressionsContent.style.visibility = 'visible';
        expressionsContent.removeAttribute('aria-hidden');
        expressionsContent.classList.remove('collapsed');
      } catch { /* ignore */ }
      try {
        expressionsManager.uiElement.hidden = false;
        expressionsManager.uiElement.style.display = '';
        expressionsManager.uiElement.style.visibility = 'visible';
        expressionsManager.textArea?.parentElement?.style?.removeProperty?.('display');
        const panel = expressionsContent.querySelector('.expressions-panel');
        if (panel) {
          panel.hidden = false;
          panel.style.display = '';
          panel.style.visibility = 'visible';
        }
        for (const element of [
          expressionsManager.configuratorPanel,
          expressionsManager.editorPanel,
        ]) {
          if (!element) continue;
          element.style.height = 'auto';
          element.style.minHeight = '0';
          element.style.maxHeight = 'none';
          element.style.overflow = 'visible';
        }
      } catch { /* ignore */ }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const moveExpressionsIntoCaptureTarget = async () => {
      try {
        const target = ensureCaptureTarget();
        target.textContent = '';
        target.appendChild(expressionsManager.uiElement);
      } catch { /* ignore */ }
      await normalizeExpressionsVisibility();
    };

    await partHistory.reset();

    const cube = await partHistory.newFeature('P.CU');
    if (cube?.inputParams) {
      cube.inputParams.sizeX = 18;
      cube.inputParams.sizeY = 12;
      cube.inputParams.sizeZ = 8;
      cube.inputParams.transform = cubeTransformValue;
    }

    partHistory.expressions = shotStateValue.expressions;
    partHistory.configurator = shotStateValue.configurator;
    partHistory.currentHistoryStepId = null;
    await partHistory.runHistory();

    await new Promise((resolve) => setTimeout(resolve, 800));

    try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.collapseAll?.()); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('Expressions')); } catch { /* ignore */ }
    try {
      expressionsTitle.hidden = false;
      expressionsContent.hidden = false;
      expressionsTitle.style.display = '';
      expressionsContent.style.display = '';
      expressionsContent.classList.remove('collapsed');
    } catch { /* ignore */ }

    await normalizeExpressionsVisibility();
    try {
      if (viewer.renderer?.domElement) {
        viewer.renderer.domElement.style.opacity = '0';
      }
    } catch { /* ignore */ }

    try {
      viewer.camera?.position?.set?.(24, 18, 24);
      viewer.controls?.target?.set?.(0, 0, 0);
      viewer.controls?.update?.();
    } catch { /* ignore */ }
    try { viewer.zoomToFit?.(1.2); } catch { /* ignore */ }

    expressionsManager.refreshFromPartHistory?.();
    if (shotIdValue === 'configurator-editor') {
      expressionsManager.toggleEditor?.(true);
    } else {
      expressionsManager.toggleEditor?.(false);
    }

    await normalizeExpressionsVisibility();
    expressionsContent?.scrollIntoView?.({ block: 'start' });
    await moveExpressionsIntoCaptureTarget();
  }, {
    shotIdValue: shotId,
    shotStateValue: shotState,
    cubeTransformValue: cubeTransform,
    captureTargetId: EXPRESSIONS_CAPTURE_TARGET_ID,
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

export async function prepareSheetMetalScreenshot(page) {
  await page.evaluate(async () => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const nextFrame = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const partHistory = viewer.partHistory;
    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }
    try { viewer.closeSheet2DEditor?.(); } catch { /* ignore */ }

    await partHistory.reset();
    try { viewer.setActiveWorkbench?.('SHEET_METAL', { queueHistorySnapshot: false }); } catch { /* ignore */ }

    partHistory.expressions = '//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n';
    partHistory.configurator = {
      fields: [],
      values: {},
    };

    const feature1 = await partHistory.newFeature('S');
    Object.assign(feature1.inputParams, {
      id: 'S1',
      sketchPlane: null,
      editSketch: null,
      dumpSketchDiagnostics: null,
      curveResolution: 'resolution',
    });
    feature1.persistentData = {
      sketch: {
        points: [
          { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
          { id: 1, x: -5.405734, y: -7.403996, fixed: false, construction: false, externalReference: false },
          { id: 2, x: 4.936578, y: -0.161598, fixed: false, construction: false, externalReference: false },
          { id: 3, x: -5.405734, y: -7.403996, fixed: false, construction: false, externalReference: false },
          { id: 5, x: 4.936578, y: -7.403996, fixed: false, construction: false, externalReference: false },
          { id: 6, x: 4.936578, y: -0.161598, fixed: false, construction: false, externalReference: false },
          { id: 7, x: -5.405734, y: -0.161598, fixed: false, construction: false, externalReference: false },
          { id: 8, x: -5.405734, y: -0.161598, fixed: false, construction: false, externalReference: false },
          { id: 11, x: -0.364987, y: -7.403996, fixed: false, construction: false, externalReference: false },
          { id: 12, x: 4.936578, y: -5.382721, fixed: false, construction: false, externalReference: false },
        ],
        geometries: [
          { id: 3, type: 'line', points: [6, 7], construction: false },
          { id: 4, type: 'line', points: [8, 3], construction: false },
          { id: 7, type: 'line', points: [1, 11], construction: false },
          { id: 8, type: 'line', points: [12, 2], construction: false },
          { id: 9, type: 'line', points: [11, 12], construction: false },
        ],
        constraints: [
          { id: 0, type: '⏚', points: [0], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '0:0,0,1;' },
          { id: 1, type: '≡', points: [1, 3], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '1:-5.405734,-7.403996,0;3:-5.405734,-7.403996,0;' },
          { id: 3, type: '≡', points: [2, 6], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '2:4.936578,-0.161598,0;6:4.936578,-0.161598,0;' },
          { id: 4, type: '≡', points: [7, 8], status: 'solved', error: null, _previousSolveValue: null, previousPointValues: '7:-5.405734,-0.161598,0;8:-5.405734,-0.161598,0;' },
          { id: 6, type: '⟂', points: [5, 2, 6, 7], status: 'solved', error: null, value: 270, _previousSolveValue: 270, previousPointValues: '5:4.936578,-7.403996,0;2:4.936578,-0.161598,0;6:4.936578,-0.161598,0;7:-5.405734,-0.161598,0;' },
          { id: 7, type: '⟂', points: [6, 7, 8, 3], status: 'solved', error: null, value: 270, _previousSolveValue: 270, previousPointValues: '6:4.936578,-0.161598,0;7:-5.405734,-0.161598,0;8:-5.405734,-0.161598,0;3:-5.405734,-7.403996,0;' },
        ],
      },
    };

    const feature2 = await partHistory.newFeature('SM.TAB');
    Object.assign(feature2.inputParams, {
      id: 'SM.TAB2',
      profile: 'S1:PROFILE',
      thickness: '1',
      placementMode: 'forward',
      bendRadius: '1',
      neutralFactor: 0.5,
      consumeProfileSketch: true,
    });

    const feature3 = await partHistory.newFeature('SM.F');
    Object.assign(feature3.inputParams, {
      id: 'SM.F3',
      faces: ['SM.TAB2:FLAT:SM.TAB2:flat_root:SIDE:SM.TAB2:flat_root:e4'],
      useOppositeCenterline: false,
      flangeLength: 10,
      edgeStartSetback: 0,
      edgeEndSetback: 0,
      flangeLengthReference: 'outside',
      angle: 90,
      inset: 'material_inside',
      bendRadius: 0,
      offset: 0,
    });

    const feature4 = await partHistory.newFeature('SM.F');
    Object.assign(feature4.inputParams, {
      id: 'SM.F5',
      faces: ['SM.F3:FLAT:SM.F3:flat:SIDE:SM.F3:flat:left'],
      useOppositeCenterline: true,
      flangeLength: 10,
      edgeStartSetback: 0,
      edgeEndSetback: 0,
      flangeLengthReference: 'outside',
      angle: 90,
      inset: 'bend_outside',
      bendRadius: 0,
      offset: 0,
    });

    const feature5 = await partHistory.newFeature('F');
    Object.assign(feature5.inputParams, {
      id: 'F6',
      edges: [
        'SM.F3:FLAT:SM.TAB2:flat_root:SIDE:SM.TAB2:flat_root:e3|SM.TAB2:FLAT:SM.TAB2:flat_root:SIDE:SM.TAB2:flat_root:e2[0]',
        'SM.F3:FLAT:SM.F3:flat:SIDE:SM.F3:flat:right|SM.F3:FLAT:SM.F3:flat:SIDE:SM.F3:flat:top[0]',
        'F6:FLAT:SM.TAB2:flat_root:SIDE:SM.TAB2:flat_root:e1|SM.F3:FLAT:SM.TAB2:flat_root:SIDE:SM.TAB2:flat_root:e5[0]',
        'SM.F5:FLAT:SM.F5:flat:SIDE:SM.F5:flat:right|SM.F5:FLAT:SM.F5:flat:SIDE:SM.F5:flat:top[0]',
        'SM.F5:FLAT:SM.F5:flat:SIDE:SM.F5:flat:left|SM.F5:FLAT:SM.F5:flat:SIDE:SM.F5:flat:top[0]',
      ],
      radius: 1,
      resolution: 'resolution',
      direction: 'AUTO',
      debug: 'NONE',
      inflate: 0,
      nudgeFaceDistance: 0.0001,
      renameFaces: true,
      collapseFilletSideWalls: true,
    });

    partHistory.currentHistoryStepId = null;
    await partHistory.runHistory();

    try { viewer.setActiveWorkbench?.('SHEET_METAL', { queueHistorySnapshot: false }); } catch { /* ignore */ }
    try { viewer.refreshWorkbenchUi?.(); } catch { /* ignore */ }
    try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }
    try { viewer.historyWidget?.collapseExpandedEntries?.({ clearOpenState: true, notify: false }); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('History')); } catch { /* ignore */ }
    try { await Promise.resolve(viewer.accordion?.expandSection?.('PMI Views')); } catch { /* ignore */ }
    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarAutoHideSuspended?.(false);
      viewer._setSidebarHoverVisible?.(true);
      if (viewer.sidebar) {
        viewer.sidebar.hidden = false;
        viewer.sidebar.style.display = '';
        viewer.sidebar.style.visibility = 'visible';
        viewer.sidebar.style.transform = '';
      }
    } catch { /* ignore */ }
    try {
      viewer.camera?.position?.set?.(24, 18, 24);
      viewer.controls?.target?.set?.(0, 0, 0);
      viewer.controls?.update?.();
    } catch { /* ignore */ }
    try { viewer.zoomToFit?.(1.45); } catch { /* ignore */ }
    try {
      viewer.camera?.updateMatrixWorld?.();
      const elements = viewer.camera?.matrixWorld?.elements || [];
      const right = { x: elements[0] || 1, y: elements[1] || 0, z: elements[2] || 0 };
      const panDistance = -13;
      viewer.camera.position.x += right.x * panDistance;
      viewer.camera.position.y += right.y * panDistance;
      viewer.camera.position.z += right.z * panDistance;
      viewer.controls.target.x += right.x * panDistance;
      viewer.controls.target.y += right.y * panDistance;
      viewer.controls.target.z += right.z * panDistance;
      viewer.controls.update?.();
    } catch { /* ignore */ }
    try { viewer.renderScene?.(); } catch { /* ignore */ }
    await nextFrame();
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(450);
}

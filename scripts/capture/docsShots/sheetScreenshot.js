const CAPTURE_TARGET_ID = 'sheet-doc-capture-target';

export async function prepareSheetScreenshot(page, shotId = 'sheets-mode') {
  await page.evaluate(async ({ shotIdValue, captureTargetId }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const nextFrame = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const ensureCaptureTarget = () => {
      let target = document.getElementById(captureTargetId);
      if (!target) {
        target = document.createElement('div');
        target.id = captureTargetId;
        target.style.position = 'fixed';
        target.style.pointerEvents = 'none';
        target.style.opacity = '0';
        target.style.zIndex = '2147483646';
        document.body.appendChild(target);
      }
      return target;
    };

    const hideCaptureTarget = () => {
      const target = ensureCaptureTarget();
      target.style.left = '0px';
      target.style.top = '0px';
      target.style.width = '1px';
      target.style.height = '1px';
      return target;
    };

    const setCaptureTargetFromElements = (elements, padding = 14) => {
      const rects = (Array.isArray(elements) ? elements : [elements])
        .filter(Boolean)
        .map((element) => element.getBoundingClientRect?.())
        .filter((rect) => rect && rect.width > 0 && rect.height > 0);
      if (!rects.length) throw new Error(`No capture rectangles available for ${shotIdValue}`);

      let minLeft = Number.POSITIVE_INFINITY;
      let minTop = Number.POSITIVE_INFINITY;
      let maxRight = Number.NEGATIVE_INFINITY;
      let maxBottom = Number.NEGATIVE_INFINITY;
      for (const rect of rects) {
        minLeft = Math.min(minLeft, rect.left);
        minTop = Math.min(minTop, rect.top);
        maxRight = Math.max(maxRight, rect.right);
        maxBottom = Math.max(maxBottom, rect.bottom);
      }

      const target = ensureCaptureTarget();
      target.style.left = `${Math.max(0, Math.floor(minLeft - padding))}px`;
      target.style.top = `${Math.max(0, Math.floor(minTop - padding))}px`;
      target.style.width = `${Math.ceil((maxRight - minLeft) + (padding * 2))}px`;
      target.style.height = `${Math.ceil((maxBottom - minTop) + (padding * 2))}px`;
      return target;
    };

    const queryToolbarButton = (title) => document.querySelector(`.sheet-slides-topbar button[title="${title}"]`);
    const selectedElementByType = (type) => (editor.sheetDraft?.elements || []).find((element) => element?.type === type) || null;
    const selectSingle = (element) => {
      if (!element?.id) return;
      editor._setSelectedElementIds([String(element.id)], String(element.id));
      editor._renderAll();
    };

    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }
    try { viewer.closeSheet2DEditor?.(); } catch { /* ignore */ }
    try { await viewer.partHistory.reset?.(); } catch { /* ignore */ }

    viewer.openSheet2DEditor();
    const editor = viewer._sheet2DEditorWindow;
    if (!editor) throw new Error('2D sheets editor did not open');

    const manager = editor._getManager?.();
    const sheets = manager?.getSheets?.() || [];
    if (!sheets.length) throw new Error('No sheets available for documentation capture');

    editor.sheetId = String(sheets[0]?.id || editor.sheetId || '');
    editor.refreshFromHistory();
    editor.sheetDraft.elements = [];
    editor._clearSelection();
    editor._closeToolbarPopover?.();
    editor._hideContextMenu?.();
    editor._commitSheetDraft('docs-sheet-shot-reset');
    editor.refreshFromHistory();

    const addElement = (kind) => {
      editor._addElement(kind);
      return editor._getSelectedElement();
    };

    const roundedRect = addElement('roundedRect');
    const ellipse = addElement('ellipse');
    const triangle = addElement('triangle');
    const table = addElement('table');
    const text = addElement('text');

    if (!roundedRect || !ellipse || !triangle || !table || !text) {
      throw new Error('Failed to create sample 2D sheet elements');
    }

    roundedRect.x = 0.8;
    roundedRect.y = 0.95;
    roundedRect.w = 2.2;
    roundedRect.h = 1.25;
    roundedRect.cornerRadius = 0.24;
    roundedRect.fill = '#bfdbfe';
    roundedRect.stroke = '#2563eb';
    roundedRect.strokeWidth = 0.025;
    roundedRect.text = 'Rounded\\nRect';
    roundedRect.fontSize = 0.26;
    roundedRect.fontWeight = '700';
    roundedRect.textAlign = 'center';
    roundedRect.verticalAlign = 'middle';

    ellipse.x = 3.7;
    ellipse.y = 0.95;
    ellipse.w = 2.35;
    ellipse.h = 1.45;
    ellipse.rotationDeg = -10;
    ellipse.fill = '#fde68a';
    ellipse.stroke = '#d97706';
    ellipse.strokeWidth = 0.03;
    ellipse.lineStyle = 'dashed';
    ellipse.text = 'Review';
    ellipse.fontSize = 0.28;
    ellipse.fontWeight = '700';
    ellipse.textAlign = 'center';
    ellipse.verticalAlign = 'middle';

    triangle.x = 6.55;
    triangle.y = 1.05;
    triangle.w = 1.45;
    triangle.h = 1.3;
    triangle.fill = '#86efac';
    triangle.stroke = '#16a34a';
    triangle.strokeWidth = 0.025;

    table.x = 3.15;
    table.y = 3.0;
    table.w = 3.7;
    table.h = 1.7;
    table.tableData.cells[0][0].text = 'Item';
    table.tableData.cells[0][1].text = 'Qty';
    table.tableData.cells[0][2].text = 'Finish';
    table.tableData.cells[0][3].text = 'Notes';
    table.tableData.cells[1][0].text = 'Panel';
    table.tableData.cells[1][1].text = '2';
    table.tableData.cells[1][2].text = 'Paint';
    table.tableData.cells[1][3].text = 'Top coat';
    table.tableData.cells[2][0].text = 'Bracket';
    table.tableData.cells[2][1].text = '4';
    table.tableData.cells[2][2].text = 'Anodize';
    table.tableData.cells[2][3].text = 'Deburr';
    table.fontFamily = 'Arial, Helvetica, sans-serif';
    table.fontSize = 0.2;
    table.color = '#111827';

    text.x = 0.95;
    text.y = 3.0;
    text.w = 1.8;
    text.h = 1.3;
    text.text = 'SHEET\\nLAYOUT';
    text.fontSize = 0.44;
    text.fontWeight = '700';
    text.color = '#7c3aed';
    text.textAlign = 'left';
    text.verticalAlign = 'top';
    text.strokeEnabled = false;

    editor._commitSheetDraft('docs-sheet-shot-layout');
    editor._zoomMode = 'fit';
    editor._closeToolbarPopover?.();
    editor._hideContextMenu?.();
    editor._renderAll();
    await nextFrame();

    hideCaptureTarget();

    if (shotIdValue === 'sheets-mode') {
      return;
    }

    if (shotIdValue === 'sheets-toolbar-insert') {
      setCaptureTargetFromElements([
        queryToolbarButton('Text'),
        queryToolbarButton('Shapes'),
        queryToolbarButton('Table'),
        queryToolbarButton('Image'),
        queryToolbarButton('Insert PMI'),
      ], 10);
      return;
    }

    if (shotIdValue === 'sheets-toolbar-shapes-menu') {
      const shapesButton = queryToolbarButton('Shapes');
      shapesButton?.click?.();
      await nextFrame();
      setCaptureTargetFromElements([shapesButton, editor._toolbarPopover], 12);
      return;
    }

    if (
      shotIdValue === 'sheets-toolbar-style'
      || shotIdValue === 'sheets-toolbar-fill-menu'
      || shotIdValue === 'sheets-toolbar-stroke-menu'
      || shotIdValue === 'sheets-toolbar-line-weight-menu'
      || shotIdValue === 'sheets-toolbar-line-style-menu'
    ) {
      selectSingle(selectedElementByType('ellipse'));
      await nextFrame();

      if (shotIdValue === 'sheets-toolbar-fill-menu') {
        editor._toggleToolbarPopover?.('fillColor', editor._toolbarFillButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionStyleGroup, editor._toolbarPopover], 12);
        return;
      }
      if (shotIdValue === 'sheets-toolbar-stroke-menu') {
        editor._toggleToolbarPopover?.('strokeColor', editor._toolbarStrokeButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionStyleGroup, editor._toolbarPopover], 12);
        return;
      }
      if (shotIdValue === 'sheets-toolbar-line-weight-menu') {
        editor._toggleToolbarPopover?.('lineWeight', editor._toolbarStrokeWidthButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionStyleGroup, editor._toolbarPopover], 12);
        return;
      }
      if (shotIdValue === 'sheets-toolbar-line-style-menu') {
        editor._toggleToolbarPopover?.('lineStyle', editor._toolbarLineStyleButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionStyleGroup, editor._toolbarPopover], 12);
        return;
      }

      setCaptureTargetFromElements(editor._toolbarSelectionStyleGroup, 10);
      return;
    }

    if (
      shotIdValue === 'sheets-toolbar-text'
      || shotIdValue === 'sheets-toolbar-text-color-menu'
      || shotIdValue === 'sheets-toolbar-text-align-menu'
    ) {
      text.fontWeight = '700';
      text.fontStyle = 'italic';
      text.textDecoration = 'underline';
      text.textAlign = 'center';
      text.verticalAlign = 'middle';
      text.fontSize = 0.32;
      editor._commitSheetDraft('docs-sheet-shot-text-style');
      selectSingle(text);
      await nextFrame();

      if (shotIdValue === 'sheets-toolbar-text-color-menu') {
        editor._toggleToolbarPopover?.('textColor', editor._toolbarTextColorButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionTextGroup, editor._toolbarPopover], 12);
        return;
      }
      if (shotIdValue === 'sheets-toolbar-text-align-menu') {
        editor._toggleToolbarPopover?.('textAlign', editor._toolbarAlignmentButton);
        await nextFrame();
        setCaptureTargetFromElements([editor._toolbarSelectionTextGroup, editor._toolbarPopover], 12);
        return;
      }

      setCaptureTargetFromElements(editor._toolbarSelectionTextGroup, 10);
      return;
    }

    throw new Error(`Unknown 2D sheets docs shot "${shotIdValue}"`);
  }, { shotIdValue: shotId, captureTargetId: CAPTURE_TARGET_ID });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

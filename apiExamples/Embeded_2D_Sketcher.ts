import { Sketcher2DEmbed } from '../dist-kernel/Sketcher2D.js';

const btnCreate = document.getElementById('btn-create');
const btnDestroy = document.getElementById('btn-destroy');
const btnApplyCss = document.getElementById('btn-apply-css');
const btnApplyTheme = document.getElementById('btn-apply-theme');
const btnExportSvg = document.getElementById('btn-export-svg');
const btnExportDxf = document.getElementById('btn-export-dxf');
const btnDownloadDxf = document.getElementById('btn-download-dxf');
const btnExportPolylines = document.getElementById('btn-export-polylines');
const geometryColorInput = document.getElementById('geometry-color');
const pointColorInput = document.getElementById('point-color');
const constraintColorInput = document.getElementById('constraint-color');
const backgroundColorInput = document.getElementById('background-color');
const pointSizePxInput = document.getElementById('point-size-px');
const curveThicknessPxInput = document.getElementById('curve-thickness-px');
const sidebarExpandedInput = document.getElementById('sidebar-expanded');
const gridVisibleInput = document.getElementById('grid-visible');
const gridSpacingInput = document.getElementById('grid-spacing');
const curveResolutionInput = document.getElementById('curve-resolution');
const cssInput = document.getElementById('css-input');
const sketchStatusEl = document.getElementById('sketch-status');
const sketchHost = document.getElementById('sketch-host');
const eventOutput = document.getElementById('event-output');
const svgPreview = document.getElementById('svg-preview');
const pathOutput = document.getElementById('path-output');
const dxfOutput = document.getElementById('dxf-output');
const polylineOutput = document.getElementById('polyline-output');

let sketcher = null;
let latestSketch = null;
let changeCount = 0;
let finishCount = 0;
let cancelCount = 0;
let dxfDownloadUrl = null;
const maxEventLines = 6;

const setSketchStatus = (text) => {
  sketchStatusEl.textContent = text;
};

const revokeDxfDownload = () => {
  if (dxfDownloadUrl) {
    URL.revokeObjectURL(dxfDownloadUrl);
    dxfDownloadUrl = null;
  }
};

const setDxfDownload = (text) => {
  revokeDxfDownload();
  if (typeof text !== 'string' || !text.length) {
    btnDownloadDxf.disabled = true;
    return;
  }
  const blob = new Blob([text], { type: 'application/dxf' });
  dxfDownloadUrl = URL.createObjectURL(blob);
  btnDownloadDxf.disabled = false;
};

const setSketchButtons = (mounted) => {
  btnCreate.disabled = mounted;
  btnDestroy.disabled = !mounted;
  btnApplyCss.disabled = !mounted;
  btnApplyTheme.disabled = !mounted;
  btnExportSvg.disabled = !mounted;
  btnExportDxf.disabled = !mounted;
  btnExportPolylines.disabled = !mounted;
  btnDownloadDxf.disabled = !mounted || !dxfDownloadUrl;
};

const pushEvent = (label, payload = null) => {
  const now = new Date().toLocaleTimeString();
  const line = payload == null
    ? `[${now}] ${label}`
    : `[${now}] ${label} ${JSON.stringify(payload)}`;
  const existing = eventOutput.textContent === '(No sketch events yet)'
    ? []
    : eventOutput.textContent.split('\n').filter(Boolean);
  const next = [line, ...existing].slice(0, maxEventLines);
  eventOutput.textContent = next.length ? next.join('\n') : '(No sketch events yet)';
};

const currentTheme = () => ({
  geometryColor: geometryColorInput.value,
  pointColor: pointColorInput.value,
  constraintColor: constraintColorInput.value,
  backgroundColor: backgroundColorInput.value,
  pointSizePx: Math.max(1, Number(pointSizePxInput.value) || 10),
  curveThicknessPx: Math.max(0.5, Number(curveThicknessPxInput.value) || 2),
});

const currentGridSpacing = () => {
  const parsed = Number(gridSpacingInput.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const currentCurveResolution = () => {
  const parsed = Number(curveResolutionInput.value);
  if (!Number.isFinite(parsed)) return 64;
  return Math.max(3, Math.min(2048, Math.floor(parsed)));
};

const attachSketcher = async () => {
  if (sketcher) return;

  sketcher = new Sketcher2DEmbed({
    cssText: cssInput.value,
    ...currentTheme(),
    sidebarExpanded: sidebarExpandedInput.checked,
    gridVisible: gridVisibleInput.checked,
    gridSpacing: currentGridSpacing(),
    onChange: (sketch) => {
      latestSketch = sketch;
      changeCount += 1;
      const pathCount = Array.isArray(sketch?.geometries) ? sketch.geometries.length : 0;
      setSketchStatus(`Sketch updated (${changeCount}). Geometries: ${pathCount}`);
      pushEvent('onChange', { geometries: pathCount });
    },
    onFinished: (sketch) => {
      latestSketch = sketch;
      finishCount += 1;
      const pathCount = Array.isArray(sketch?.geometries) ? sketch.geometries.length : 0;
      setSketchStatus(`Sketch finished (${finishCount}). Geometries: ${pathCount}`);
      pushEvent('onFinished', { geometries: pathCount });
      exportSvg().catch((error) => {
        console.error(error);
        setSketchStatus(`Failed to export SVG after Finish: ${error?.message || String(error)}`);
      });
    },
    onCancelled: () => {
      cancelCount += 1;
      setSketchStatus(`Sketch cancelled (${cancelCount}).`);
      pushEvent('onCancelled');
    },
  });

  await sketcher.mount(sketchHost);
  latestSketch = await sketcher.getSketch();
  setSketchButtons(true);
  setSketchStatus('Sketcher iframe mounted. Draw geometry and run any export action.');
};

const detachSketcher = async () => {
  if (!sketcher) return;
  await sketcher.destroy();
  sketcher = null;
  latestSketch = null;
  changeCount = 0;
  finishCount = 0;
  cancelCount = 0;
  setSketchButtons(false);
  setSketchStatus('Sketcher destroyed.');
  eventOutput.textContent = '(No sketch events yet)';
  svgPreview.innerHTML = '';
  pathOutput.textContent = '(No SVG exported yet)';
  dxfOutput.textContent = '(No DXF exported yet)';
  polylineOutput.textContent = '(No 3D polylines exported yet)';
  revokeDxfDownload();
};

const applySketchCss = async () => {
  if (!sketcher) return;
  await sketcher.setCss(cssInput.value);
  setSketchStatus('Custom CSS applied to iframe.');
};

const applySketchTheme = async () => {
  if (!sketcher) return;
  await sketcher.setTheme(currentTheme());
  await sketcher.setSidebarExpanded(sidebarExpandedInput.checked);
  if (typeof sketcher.setGrid === 'function') {
    await sketcher.setGrid({
      visible: gridVisibleInput.checked,
      spacing: currentGridSpacing(),
    });
  } else {
    if (typeof sketcher.setGridVisible === 'function') {
      await sketcher.setGridVisible(gridVisibleInput.checked);
    }
    if (typeof sketcher.setGridSpacing === 'function') {
      await sketcher.setGridSpacing(currentGridSpacing());
    }
  }
  setSketchStatus('Theme + sidebar + grid state applied to iframe.');
};

const exportSvg = async () => {
  if (!sketcher) return;
  const result = await sketcher.exportSVG({
    flipY: true,
    precision: 3,
    stroke: '#111111',
    strokeWidth: 1.5,
    fill: 'none',
    padding: 12,
    curveResolution: currentCurveResolution(),
  });
  latestSketch = await sketcher.getSketch({ preferCached: true });
  svgPreview.innerHTML = result.svg;
  pathOutput.textContent = result.paths.length
    ? result.paths.map((row) => `id=${row.id} type=${row.type} d="${row.d}"`).join('\n')
    : '(No sketch geometry to export)';
  setSketchStatus(`Exported ${result.paths.length} SVG paths.`);
  svgPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const exportDxf = async () => {
  if (!sketcher) return;
  const result = await sketcher.exportDXF({
    units: 'mm',
    curveResolution: currentCurveResolution(),
    includeConstruction: false,
  });
  dxfOutput.textContent = result?.dxf || '(No DXF payload returned)';
  setDxfDownload(result?.dxf || '');
  setSketchStatus(`Exported DXF with ${result?.polylines?.length || 0} polylines.`);
};

const export3DPolylines = async () => {
  if (!sketcher) return;
  const result = await sketcher.export3DPolylines({
    curveResolution: currentCurveResolution(),
    includeConstruction: false,
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
  });
  polylineOutput.textContent = JSON.stringify(result, null, 2);
  setSketchStatus(`Exported ${result?.polylines?.length || 0} 3D polylines.`);
};

btnCreate.addEventListener('click', () => {
  attachSketcher().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to create sketcher: ${error?.message || String(error)}`);
  });
});

btnDestroy.addEventListener('click', () => {
  detachSketcher().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to destroy sketcher: ${error?.message || String(error)}`);
  });
});

btnApplyCss.addEventListener('click', () => {
  applySketchCss().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply CSS: ${error?.message || String(error)}`);
  });
});

btnApplyTheme.addEventListener('click', () => {
  applySketchTheme().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply theme: ${error?.message || String(error)}`);
  });
});

btnExportSvg.addEventListener('click', () => {
  exportSvg().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to export SVG: ${error?.message || String(error)}`);
  });
});

btnExportDxf.addEventListener('click', () => {
  exportDxf().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to export DXF: ${error?.message || String(error)}`);
  });
});

btnDownloadDxf.addEventListener('click', () => {
  if (!dxfDownloadUrl) return;
  const link = document.createElement('a');
  link.href = dxfDownloadUrl;
  link.download = 'sketch-export.dxf';
  link.click();
});

btnExportPolylines.addEventListener('click', () => {
  export3DPolylines().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to export 3D polylines: ${error?.message || String(error)}`);
  });
});

[geometryColorInput, pointColorInput, constraintColorInput, backgroundColorInput, pointSizePxInput, curveThicknessPxInput].forEach((input) => {
  input.addEventListener('input', () => {
    if (!sketcher) return;
    applySketchTheme().catch((error) => {
      console.error(error);
      setSketchStatus(`Failed to apply theme: ${error?.message || String(error)}`);
    });
  });
});

sidebarExpandedInput.addEventListener('change', () => {
  if (!sketcher) return;
  applySketchTheme().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply sidebar state: ${error?.message || String(error)}`);
  });
});

gridVisibleInput.addEventListener('change', () => {
  if (!sketcher) return;
  applySketchTheme().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply grid visibility: ${error?.message || String(error)}`);
  });
});

gridSpacingInput.addEventListener('input', () => {
  if (!sketcher) return;
  applySketchTheme().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply grid spacing: ${error?.message || String(error)}`);
  });
});

window.addEventListener('beforeunload', () => {
  if (sketcher) {
    sketcher.destroy().catch(() => {});
  }
  revokeDxfDownload();
});

setSketchButtons(false);

if (latestSketch && !Array.isArray(latestSketch?.geometries)) {
  console.warn('Unexpected sketch payload shape', latestSketch);
}

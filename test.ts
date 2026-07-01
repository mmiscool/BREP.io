export {};

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const btnCreate = document.getElementById('btn-create');
const btnDestroy = document.getElementById('btn-destroy');
const btnApplyCss = document.getElementById('btn-apply-css');
const btnApplyTheme = document.getElementById('btn-apply-theme');
const btnExportSvg = document.getElementById('btn-export-svg');
const geometryColorInput = document.getElementById('geometry-color');
const pointColorInput = document.getElementById('point-color');
const constraintColorInput = document.getElementById('constraint-color');
const backgroundColorInput = document.getElementById('background-color');
const pointSizePxInput = document.getElementById('point-size-px');
const curveThicknessPxInput = document.getElementById('curve-thickness-px');
const sidebarExpandedInput = document.getElementById('sidebar-expanded');
const gridVisibleInput = document.getElementById('grid-visible');
const gridSpacingInput = document.getElementById('grid-spacing');
const cssInput = document.getElementById('css-input');
const sketchStatusEl = document.getElementById('sketch-status');
const sketchHost = document.getElementById('sketch-host');
const eventOutput = document.getElementById('event-output');
const svgPreview = document.getElementById('svg-preview');
const pathOutput = document.getElementById('path-output');
let sketcher = null;
let _latestSketch = null;
let changeCount = 0;
let finishCount = 0;
let cancelCount = 0;
const MAX_EVENT_LINES = 5;

const log = (...args) => {
  const line = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  logEl.textContent += `${line}\n`;
  console.log(...args);
};

const setStatus = (text, cls) => {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
};

const setSketchStatus = (text) => {
  sketchStatusEl.textContent = text;
};

const setSketchButtons = (mounted) => {
  btnCreate.disabled = mounted;
  btnDestroy.disabled = !mounted;
  btnApplyCss.disabled = !mounted;
  btnApplyTheme.disabled = !mounted;
  btnExportSvg.disabled = !mounted;
};

const pushEvent = (label, payload = null) => {
  const now = new Date().toLocaleTimeString();
  const line = payload == null
    ? `[${now}] ${label}`
    : `[${now}] ${label} ${JSON.stringify(payload)}`;
  const existing = eventOutput.textContent === '(No sketch events yet)'
    ? []
    : eventOutput.textContent.split('\n').filter(Boolean);
  const next = [line, ...existing].slice(0, MAX_EVENT_LINES);
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

const attachSketcher = async () => {
  if (sketcher) return;
  const { Sketcher2DEmbed } = await import('/dist-kernel/Sketcher2D.js' as any);
  sketcher = new Sketcher2DEmbed({
    cssText: cssInput.value,
    ...currentTheme(),
    sidebarExpanded: sidebarExpandedInput.checked,
    gridVisible: gridVisibleInput.checked,
    gridSpacing: currentGridSpacing(),
    onChange: (sketch) => {
      _latestSketch = sketch;
      changeCount += 1;
      const pathCount = Array.isArray(sketch?.geometries) ? sketch.geometries.length : 0;
      setSketchStatus(`Sketch updated (${changeCount}). Geometries: ${pathCount}`);
      pushEvent('onChange', { geometries: pathCount });
    },
    onFinished: (sketch) => {
      _latestSketch = sketch;
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
  _latestSketch = await sketcher.getSketch();
  setSketchButtons(true);
  setSketchStatus('Sketcher iframe mounted. Draw geometry and click Export SVG Paths.');
};

const detachSketcher = async () => {
  if (!sketcher) return;
  await sketcher.destroy();
  sketcher = null;
  _latestSketch = null;
  changeCount = 0;
  finishCount = 0;
  cancelCount = 0;
  setSketchButtons(false);
  setSketchStatus('Sketcher destroyed.');
  eventOutput.textContent = '(No sketch events yet)';
  svgPreview.innerHTML = '';
  pathOutput.textContent = '';
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
  });
  _latestSketch = await sketcher.getSketch({ preferCached: true });
  svgPreview.innerHTML = result.svg;
  pathOutput.textContent = result.paths.length
    ? result.paths.map((row) => `id=${row.id} type=${row.type} d="${row.d}"`).join('\n')
    : '(No sketch geometry to export)';
  setSketchStatus(`Exported ${result.paths.length} SVG paths.`);
  svgPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

btnExportSvg.addEventListener('click', () => {
  exportSvg().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to export SVG: ${error?.message || String(error)}`);
  });
});

btnApplyTheme.addEventListener('click', () => {
  applySketchTheme().catch((error) => {
    console.error(error);
    setSketchStatus(`Failed to apply theme: ${error?.message || String(error)}`);
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

setSketchButtons(false);
pathOutput.textContent = '(No SVG exported yet)';

(async () => {
  setStatus('Importing bundle...', 'pending');
  const kernel = await import('/dist-kernel/brep-kernel.js' as any);
  log('Bundle exports:', Object.keys(kernel));

  const { BREP } = kernel;
  if (!BREP) {
    throw new Error('BREP export missing from bundle');
  }

  setStatus('Running kernel checks...', 'pending');

  const cube = new BREP.Cube({ x: 2, y: 3, z: 4, name: 'Cube' });
  const cubeVol = cube.volume();
  log('Cube volume:', cubeVol);

  const sphere = new BREP.Sphere({ r: 1, resolution: 24, name: 'Sphere' });
  const sphereTris = sphere.getTriangleCount();
  log('Sphere triangles:', sphereTris);

  const union = cube.union(sphere);
  const unionVol = union.volume();
  log('Union volume:', unionVol);
  log('Union triangles:', union.getTriangleCount());

  const expectedCubeVol = 24;
  const okVol = Math.abs(cubeVol - expectedCubeVol) < 1e-6;
  log('Cube volume check:', okVol ? 'OK' : 'FAIL', '(expected', expectedCubeVol, ')');
  if (!okVol) {
    throw new Error(`Cube volume mismatch: ${cubeVol} vs ${expectedCubeVol}`);
  }

  setStatus('Success: bundle + WASM OK', 'ok');
})().catch((err) => {
  console.error(err);
  log('ERROR:', err && (err.stack || err.message || String(err)));
  setStatus('Failed: see log', 'err');
});

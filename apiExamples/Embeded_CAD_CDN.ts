export {};

const kernelCdnUrl = 'https://cdn.jsdelivr.net/npm/brep-io-kernel@latest/dist-kernel/CAD.js';
const { CadEmbed } = await import(kernelCdnUrl as any);

const btnCreate = document.getElementById('btn-create');
const btnDestroy = document.getElementById('btn-destroy');
const btnState = document.getElementById('btn-state');
const btnHistory = document.getElementById('btn-history');
const btnSample = document.getElementById('btn-sample');
const btnReset = document.getElementById('btn-reset');
const btnCss = document.getElementById('btn-css');
const viewerOnlyInput = document.getElementById('viewer-only');
const sidebarExpandedInput = document.getElementById('sidebar-expanded');
const modelPathInput = document.getElementById('model-path');
const modelSourceInput = document.getElementById('model-source');
const modelRepoInput = document.getElementById('model-repo');
const modelBranchInput = document.getElementById('model-branch');
const cssInput = document.getElementById('css-input');
const statusEl = document.getElementById('cad-status');
const hostEl = document.getElementById('cad-host');
const stateOutput = document.getElementById('state-output');
const historyOutput = document.getElementById('history-output');
const cdnUrlEl = document.getElementById('cdn-url');

cdnUrlEl.textContent = `import { CadEmbed } from "${kernelCdnUrl}"`;

let cad = null;

const sampleCubeHistory = {
  features: [
    {
      type: 'Primitive Cube',
      inputParams: {
        id: 'sample_cube_1',
        sizeX: 24,
        sizeY: 18,
        sizeZ: 14,
        transform: {
          position: [0, 0, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        boolean: {
          targets: [],
          operation: 'NONE',
        },
      },
      persistentData: {},
      timestamp: null,
    },
  ],
  idCounter: 1,
  expressions: '//Examples:\nx = 10 + 6;\ny = x * 2;',
  pmiViews: [],
  metadata: {},
  assemblyConstraints: [],
  assemblyConstraintIdCounter: 0,
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const setButtons = (mounted) => {
  btnCreate.disabled = mounted;
  btnDestroy.disabled = !mounted;
  btnState.disabled = !mounted;
  btnHistory.disabled = !mounted;
  btnSample.disabled = !mounted;
  btnReset.disabled = !mounted;
  btnCss.disabled = !mounted;
  viewerOnlyInput.disabled = mounted;
};

const currentModelRequest = () => {
  const modelPath = String(modelPathInput.value || '').trim();
  if (!modelPath) return null;
  const source = String(modelSourceInput.value || 'local').trim() || 'local';
  const repoFull = String(modelRepoInput.value || '').trim();
  const branch = String(modelBranchInput.value || '').trim();
  const out: any = { modelPath, source };
  if (repoFull) out.repoFull = repoFull;
  if (branch) out.branch = branch;
  return out;
};

const renderState = (state, label = 'State updated') => {
  stateOutput.textContent = JSON.stringify(state || {}, null, 2);
  const features = Number(state?.featureCount || 0);
  const modelName = state?.model?.name || '(unsaved/new)';
  setStatus(`${label}. Features: ${features}. Model: ${modelName}`);
};

const createCad = async () => {
  if (cad) return;
  const initialModel = currentModelRequest();

  cad = new CadEmbed({
    mountTo: hostEl,
    viewerOnlyMode: viewerOnlyInput.checked,
    sidebarExpanded: sidebarExpandedInput.checked,
    cssText: cssInput.value,
    initialModel,
    onReady: (state) => {
      renderState(state, 'CAD ready');
    },
    onHistoryChanged: (state) => {
      renderState(state, `History changed (${state?.reason || 'update'})`);
    },
  });

  await cad.mount();
  setButtons(true);

  const state = await cad.getState();
  renderState(state, 'CAD iframe mounted');
};

const destroyCad = async () => {
  if (!cad) return;
  await cad.destroy();
  cad = null;
  setButtons(false);
  setStatus('CAD iframe destroyed.');
  stateOutput.textContent = '(No state yet)';
  historyOutput.textContent = '(No history exported yet)';
};

const refreshState = async () => {
  if (!cad) return;
  const state = await cad.getState();
  renderState(state, 'State fetched');
};

const exportHistory = async () => {
  if (!cad) return;
  const json = await cad.getPartHistoryJSON();
  historyOutput.textContent = json || '(History is empty)';
  setStatus(`History exported (${json ? json.length : 0} chars).`);
};

const loadSampleCube = async () => {
  if (!cad) return;
  await cad.setPartHistory(sampleCubeHistory);
  await refreshState();
  setStatus('Sample cube history loaded.');
};

const resetModel = async () => {
  if (!cad) return;
  await cad.reset();
  await refreshState();
  setStatus('Model reset complete.');
};

const applyCss = async () => {
  if (!cad) return;
  await cad.setCss(cssInput.value);
  await cad.setSidebarExpanded(sidebarExpandedInput.checked);
  setStatus('Custom CSS and sidebar state applied.');
};

btnCreate.addEventListener('click', () => {
  createCad().catch((error) => {
    console.error(error);
    setStatus(`Failed to create CAD iframe: ${error?.message || String(error)}`);
  });
});

btnDestroy.addEventListener('click', () => {
  destroyCad().catch((error) => {
    console.error(error);
    setStatus(`Failed to destroy CAD iframe: ${error?.message || String(error)}`);
  });
});

btnState.addEventListener('click', () => {
  refreshState().catch((error) => {
    console.error(error);
    setStatus(`Failed to get state: ${error?.message || String(error)}`);
  });
});

btnHistory.addEventListener('click', () => {
  exportHistory().catch((error) => {
    console.error(error);
    setStatus(`Failed to export history: ${error?.message || String(error)}`);
  });
});

btnSample.addEventListener('click', () => {
  loadSampleCube().catch((error) => {
    console.error(error);
    setStatus(`Failed to load sample history: ${error?.message || String(error)}`);
  });
});

btnReset.addEventListener('click', () => {
  resetModel().catch((error) => {
    console.error(error);
    setStatus(`Failed to reset model: ${error?.message || String(error)}`);
  });
});

btnCss.addEventListener('click', () => {
  applyCss().catch((error) => {
    console.error(error);
    setStatus(`Failed to apply CSS: ${error?.message || String(error)}`);
  });
});

sidebarExpandedInput.addEventListener('change', () => {
  if (!cad) return;
  cad.setSidebarExpanded(sidebarExpandedInput.checked)
    .catch((error) => {
      console.error(error);
      setStatus(`Failed to set sidebar state: ${error?.message || String(error)}`);
    });
});

setButtons(false);
setStatus('CDN CAD module loaded. CAD iframe not created.');

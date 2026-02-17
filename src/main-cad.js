import { Viewer } from './UI/viewer.js';
import {
  localStorage as LS,
} from './idbStorage.js';
import './styles/cad.css';

const viewportEl = document.getElementById('viewport');
const sidebarEl = document.getElementById('sidebar');
const currentFileEl = document.querySelector('[data-role="current-file"]');

if (!viewportEl || !sidebarEl) throw new Error('Missing CAD mount elements (#viewport, #sidebar).');

void boot();

async function boot() {
  try {
    await LS.ready();
  } catch {
    // Continue with whichever backend initialized successfully.
  }

  const viewer = new Viewer({
    container: viewportEl,
    sidebar: sidebarEl,
    autoLoadLastModel: false,
  });

  // Preserve legacy global for debugging/plugins.
  window.env = viewer;
  window.viewer = viewer;

  const requestedScope = parseRequestedModelScope();
  if (!requestedScope.modelPath) {
    setCurrentFileLabel('');
    return;
  }

  setCurrentFileLabel(requestedScope.modelPath);
  await loadRequestedFile(viewer, requestedScope);
}

function normalizeModelPath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  const out = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.' || token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

function stripModelFileExtension(pathValue) {
  const clean = normalizeModelPath(pathValue);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower.endsWith('.3mf')) return clean.slice(0, -4);
  return clean;
}

function getRequestedModelPathParam() {
  const params = new URLSearchParams(window.location.search);
  return normalizeModelPath(params.get('path') || '');
}

function getRequestedBranch() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('branch') || '').trim();
}

function parseRequestedModelScope() {
  const rawPath = getRequestedModelPathParam();
  if (!rawPath) {
    return {
      source: 'local',
      repoFull: '',
      modelPath: '',
    };
  }

  const parts = rawPath.split('/').filter(Boolean);
  const prefix = String(parts[0] || '').trim().toLowerCase();

  if (prefix === 'github') {
    if (parts.length < 4) {
      return {
        source: 'github',
        repoFull: '',
        modelPath: '',
      };
    }
    return {
      source: 'github',
      repoFull: `${parts[1]}/${parts[2]}`,
      modelPath: stripModelFileExtension(parts.slice(3).join('/')),
    };
  }

  return {
    source: 'local',
    repoFull: '',
    modelPath: stripModelFileExtension(rawPath),
  };
}

async function loadRequestedFile(viewer, requestedScope) {
  try {
    await viewer.ready;
  } catch {
    // Continue and let direct load attempt fail noisily if needed.
  }

  const fm = viewer?.fileManagerWidget;
  if (!fm || typeof fm.loadModel !== 'function') return;

  try {
    const storageMode = String(requestedScope?.source || '').trim().toLowerCase() === 'github'
      ? 'github'
      : 'local';
    const repoFull = String(requestedScope?.repoFull || '').trim();
    const branch = getRequestedBranch();
    const modelPath = String(requestedScope?.modelPath || '').trim();
    if (!modelPath) return;
    const options = {};
    options.source = storageMode;
    if (repoFull) options.repoFull = repoFull;
    if (branch) options.branch = branch;
    await fm.loadModel(modelPath, options);
    const loadedName = String(fm.currentName || '').trim();
    setCurrentFileLabel(loadedName || modelPath);
  } catch (err) {
    console.error('Failed to load requested model:', err);
    setCurrentFileLabel(String(requestedScope?.modelPath || '').trim());
  }
}

function setCurrentFileLabel(fileName) {
  const clean = String(fileName || '').trim();
  document.title = clean ? `${clean} · BREP.io CAD` : 'BREP.io CAD';
  if (!currentFileEl) return;
  currentFileEl.textContent = clean ? `Model: ${clean}` : 'Model: New';
}

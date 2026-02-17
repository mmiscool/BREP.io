import { Viewer } from './UI/viewer.js';
import {
  localStorage as LS,
} from './idbStorage.js';
import { uint8ArrayToBase64 } from './services/componentLibrary.js';
import './styles/cad.css';

const viewportEl = document.getElementById('viewport');
const sidebarEl = document.getElementById('sidebar');
const currentFileEl = document.querySelector('[data-role="current-file"]');
const GITHUB_HOST = 'github.com';
const GITHUB_RAW_HOST = 'raw.githubusercontent.com';
const JSDELIVR_GH_HOST = 'cdn.jsdelivr.net';

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

  const githubTargetParam = getRequestedGithubTargetParam();
  if (githubTargetParam) {
    const githubTarget = parseGithubTarget(githubTargetParam);
    if (githubTarget?.modelPath) {
      setCurrentFileLabel(githubTarget.modelPath);
      await loadRequestedGithubTarget(viewer, githubTarget);
      return;
    }
    console.error('[main-cad] Invalid githubTarget URL:', githubTargetParam);
  }

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

function getRequestedGithubTargetParam() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('githubTarget') || '').trim();
}

function getRequestedBranch() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('branch') || '').trim();
}

function decodePathPart(part) {
  const token = String(part || '');
  if (!token) return '';
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function encodePathPart(part) {
  const token = String(part || '');
  if (!token) return '';
  try {
    return encodeURIComponent(decodeURIComponent(token));
  } catch {
    return encodeURIComponent(token);
  }
}

function parseGithubTarget(input) {
  const rawTarget = String(input || '').trim();
  if (!rawTarget) return null;

  const withScheme = /^[a-z]+:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`;
  let parsed = null;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  const parts = String(parsed.pathname || '').split('/').filter(Boolean);
  let owner = '';
  let repo = '';
  let branch = '';
  let fileSegments = [];

  if (host === GITHUB_RAW_HOST) {
    if (parts.length < 4) return null;
    owner = String(parts[0] || '').trim();
    repo = String(parts[1] || '').trim();
    branch = String(parts[2] || '').trim();
    fileSegments = parts.slice(3);
  } else if (host === GITHUB_HOST || host === `www.${GITHUB_HOST}`) {
    if (parts.length < 4) return null;
    owner = String(parts[0] || '').trim();
    repo = String(parts[1] || '').trim();
    const mode = String(parts[2] || '').trim().toLowerCase();
    if (mode === 'blob' || mode === 'raw') {
      if (parts.length < 5) return null;
      branch = String(parts[3] || '').trim();
      fileSegments = parts.slice(4);
    } else {
      // Accept shorthand: github.com/owner/repo/branch/path/file.3mf
      branch = String(parts[2] || '').trim();
      fileSegments = parts.slice(3);
    }
  } else {
    return null;
  }

  if (!owner || !repo || !branch || !fileSegments.length) return null;
  const decodedFilePath = normalizeModelPath(fileSegments.map(decodePathPart).join('/'));
  if (!decodedFilePath || !decodedFilePath.toLowerCase().endsWith('.3mf')) return null;
  const modelPath = stripModelFileExtension(decodedFilePath);
  if (!modelPath) return null;

  return {
    owner: decodePathPart(owner),
    repo: decodePathPart(repo),
    branch: decodePathPart(branch),
    filePath: decodedFilePath,
    modelPath,
  };
}

function buildGithubTargetCandidateUrls(githubTarget) {
  const owner = String(githubTarget?.owner || '').trim();
  const repo = String(githubTarget?.repo || '').trim();
  const branch = String(githubTarget?.branch || '').trim();
  const filePath = normalizeModelPath(String(githubTarget?.filePath || '').trim());
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map(encodePathPart)
    .join('/');
  if (!owner || !repo || !branch || !encodedPath) return [];

  const rawUrl = `https://${GITHUB_RAW_HOST}/${encodePathPart(owner)}/${encodePathPart(repo)}/${encodePathPart(branch)}/${encodedPath}`;
  const jsDelivrUrl = `https://${JSDELIVR_GH_HOST}/gh/${encodePathPart(owner)}/${encodePathPart(repo)}@${encodePathPart(branch)}/${encodedPath}`;
  return [rawUrl, jsDelivrUrl];
}

async function downloadGithubTargetBytes(githubTarget) {
  const candidates = buildGithubTargetCandidateUrls(githubTarget);
  if (!candidates.length) throw new Error('No valid download URL could be built for githubTarget.');
  const failures = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Downloaded 3MF is empty.');
      return bytes;
    } catch (err) {
      const reason = (err && err.message) ? err.message : String(err || 'Unknown error');
      failures.push(`${url} -> ${reason}`);
    }
  }
  throw new Error(`Failed to download githubTarget model.\n${failures.join('\n')}`);
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

async function loadRequestedGithubTarget(viewer, githubTarget) {
  try {
    await viewer.ready;
  } catch {
    // Continue and let direct load attempt fail noisily if needed.
  }

  const fm = viewer?.fileManagerWidget;
  if (!fm || typeof fm.loadModelRecord !== 'function') return;

  try {
    const modelPath = String(githubTarget?.modelPath || '').trim();
    if (!modelPath) return;
    const bytes = await downloadGithubTargetBytes(githubTarget);
    await fm.loadModelRecord(modelPath, {
      source: 'local',
      path: modelPath,
      savedAt: new Date().toISOString(),
      data3mf: uint8ArrayToBase64(bytes),
    }, {
      source: 'local',
      path: modelPath,
    });
    const loadedName = String(fm.currentName || '').trim();
    setCurrentFileLabel(loadedName || modelPath);
  } catch (err) {
    console.error('Failed to load githubTarget model:', err);
    setCurrentFileLabel(String(githubTarget?.modelPath || '').trim());
  }
}

function setCurrentFileLabel(fileName) {
  const clean = String(fileName || '').trim();
  document.title = clean ? `${clean} · BREP.io CAD` : 'BREP.io CAD';
  if (!currentFileEl) return;
  currentFileEl.textContent = clean ? `Model: ${clean}` : 'Model: New';
}

import {
  localStorage as LS,
  STORAGE_BACKEND_EVENT,
  configureGithubStorage,
  getGithubStorageConfig,
} from './idbStorage.js';
import { fetchGithubUserRepos } from './githubStorage.js';
import {
  readBrowserStorageValue,
  writeBrowserStorageValue,
  removeBrowserStorageValue,
} from './utils/browserStorage.js';
import {
  isSystemAccessSupported,
  listMountedDirectories,
  promptAndMountDirectory,
  unmountDirectory,
} from './services/mountedStorage.js';
import {
  listComponentRecords,
  listWorkspaceFolders,
  createWorkspaceFolder,
  removeWorkspaceFolder,
  getComponentRecord,
  removeComponentRecord,
  setComponentRecord,
} from './services/componentLibrary.js';
import { readDroppedWorkspaceFileRecord } from './services/droppedWorkspaceFiles.js';
import { WorkspaceFileBrowserWidget } from './UI/WorkspaceFileBrowserWidget.js';
import './UI/dialogs.js';
import './styles/landing.css';
import brepHomeBannerSvg from './assets/brand/brep-home-banner.svg?raw';

const MODEL_FILE_EXTENSION = '.3mf';
const MANUAL_WORKSPACE_REPOS_KEY = '__BREP_WORKSPACE_MANUAL_REPOS__';
const RECENT_EXPANDED_PREF_KEY = '__BREP_UI_RECENT_EXPANDED__';
const EXPLORER_VIEW_MODE_PREF_KEY = '__BREP_UI_EXPLORER_VIEW_MODE__';
const EXPLORER_ICON_SIZE_PREF_KEY = '__BREP_UI_EXPLORER_ICON_SIZE__';
const EXPLORER_LOCATION_PREF_KEY = '__BREP_UI_EXPLORER_LOCATION__';
const HOME_SNAPSHOT_PREF_KEY = '__BREP_HOME_SNAPSHOT__';
const HOME_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const EXPLORER_ICON_SIZE_MIN = 72;
const EXPLORER_ICON_SIZE_MAX = 192;
const EXPLORER_ICON_SIZE_DEFAULT = 132;
const TRASH_FOLDER_NAME = '__BREP_TRASH__';
const TRASH_ROOT_REPO_FULL = '__BREP_TRASH_ROOT__';
const GITHUB_API_BASE = 'https://api.github.com';

const githubDefaultBranchCache = new Map();
const githubDefaultBranchInflight = new Map();

const state = {
  root: document.getElementById('app'),
  records: [],
  allRecords: [],
  folderRecords: [],
  searchTerm: '',
  thumbCache: new Map(),
  repoCache: [],
  manualRepoFulls: [],
  selectedRepoFulls: [],
  primaryRepoFull: '',
  mountedDirectories: [],
  explorerWorkspaceTop: true,
  explorerRootSource: 'local',
  explorerRootRepoFull: '',
  explorerPath: '',
  explorerViewMode: 'list',
  explorerIconSize: EXPLORER_ICON_SIZE_DEFAULT,
  explorerSizePopoverOpen: false,
  explorerSizePopoverClose: null,
  recentExpanded: true,
  selectedEntryKeys: new Set(),
  entryByKey: new Map(),
  visibleExplorerEntryKeys: [],
  dragEntryKeys: [],
  filesListEl: null,
  filesStatusEl: null,
  storageBadgeEl: null,
  workspaceFoldersEl: null,
  workspaceFoldersMetaEl: null,
  workspaceModalEl: null,
  workspaceStatusEl: null,
  settingsPanelEl: null,
  settingsStatusEl: null,
  repoPickerEl: null,
  repoSummaryEl: null,
  mountPickerEl: null,
  mountSummaryEl: null,
  activeFileMenuClose: null,
  explorerWidget: null,
  loadingFiles: false,
  pendingFilesReload: false,
  workspaceReposLoading: false,
  uiBusyDepth: 0,
  busyMessage: '',
  busyDetail: '',
  busyOverlayEl: null,
  busyMessageEl: null,
  busyDetailEl: null,
};

if (!state.root) throw new Error('Missing #app mount element');

function isUiBusy() {
  return Number(state.uiBusyDepth || 0) > 0;
}

function syncBusyOverlay() {
  const busy = isUiBusy();
  if (state.root) state.root.classList.toggle('hub-ui-busy', busy);
  if (!state.busyOverlayEl) return;

  state.busyOverlayEl.hidden = !busy;
  state.busyOverlayEl.setAttribute('aria-hidden', busy ? 'false' : 'true');
  state.busyOverlayEl.setAttribute('aria-busy', busy ? 'true' : 'false');

  if (state.busyMessageEl) {
    state.busyMessageEl.textContent = state.busyMessage || 'Working...';
  }
  if (state.busyDetailEl) {
    const detail = String(state.busyDetail || '').trim();
    state.busyDetailEl.hidden = !detail;
    state.busyDetailEl.textContent = detail;
  }

  if (busy && typeof state.busyOverlayEl.focus === 'function') {
    if (!state.busyOverlayEl.contains(document.activeElement)) {
      state.busyOverlayEl.focus({ preventScroll: true });
    }
  }
}

function beginBusyUi(message = 'Working...', detail = '') {
  state.uiBusyDepth = Number(state.uiBusyDepth || 0) + 1;
  state.busyMessage = String(message || 'Working...');
  state.busyDetail = String(detail || '');
  closeActiveFileMenu();
  closeExplorerSizePopover({ rerender: false });
  syncBusyOverlay();
}

function setBusyUiProgress(message, detail = '') {
  if (!isUiBusy()) return;
  if (typeof message === 'string' && message.trim()) {
    state.busyMessage = message.trim();
  }
  state.busyDetail = String(detail || '');
  syncBusyOverlay();
}

function endBusyUi() {
  if (state.uiBusyDepth > 0) state.uiBusyDepth -= 1;
  if (!state.uiBusyDepth) {
    state.busyMessage = '';
    state.busyDetail = '';
  }
  syncBusyOverlay();
}

async function runBusyUiTask(message, run, options = {}) {
  beginBusyUi(message, options?.detail || '');
  try {
    if (typeof run !== 'function') return undefined;
    return await run({
      setMessage(nextMessage, nextDetail = '') {
        setBusyUiProgress(nextMessage || message, nextDetail);
      },
    });
  } finally {
    endBusyUi();
  }
}

async function waitForFilesIdle({ timeoutMs = 120000 } = {}) {
  const started = Date.now();
  while (state.loadingFiles || state.pendingFilesReload) {
    if ((Date.now() - started) > timeoutMs) break;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

void boot();

async function boot() {
  try {
    await LS.ready();
  } catch {
    // Fall back to whichever backend initialized successfully.
  }

  loadUiPreferences();

  window.addEventListener(STORAGE_BACKEND_EVENT, () => {
    refreshStorageBadge();
    void loadFiles();
  });

  await renderHome();
}

function buildCadUrl(options = {}) {
  const url = new URL('cad.html', window.location.href);
  const source = normalizeStorageSource(options?.source);
  const modelPath = normalizePath(options?.path || '');
  if (modelPath) {
    if (source === 'github') {
      const repoPath = encodeRefForUrl(options?.repoFull || '');
      const modelUrlPath = encodePathForUrl(modelPath);
      const scopedPath = repoPath ? `github/${repoPath}/${modelUrlPath}` : `github/${modelUrlPath}`;
      url.searchParams.set('path', scopedPath);
    } else if (source === 'mounted') {
      const mountId = encodeRefForUrl(options?.repoFull || options?.mountId || '');
      const modelUrlPath = encodePathForUrl(modelPath);
      const scopedPath = mountId ? `mounted/${mountId}/${modelUrlPath}` : `mounted/${modelUrlPath}`;
      url.searchParams.set('path', scopedPath);
    } else {
      url.searchParams.set('path', modelPath);
    }
  }
  const branch = options?.branch;
  if (branch) url.searchParams.set('branch', String(branch));
  return url.toString();
}

function goCad(options = {}) {
  window.location.href = buildCadUrl(options);
}

function normalizeRepoFullList(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || '').split(/[\n,;]/g);
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const repo = String(value || '').trim();
    if (!repo || seen.has(repo)) continue;
    seen.add(repo);
    out.push(repo);
  }
  return out;
}

function loadManualWorkspaceRepos() {
  try {
    const raw = String(readBrowserStorageValue(MANUAL_WORKSPACE_REPOS_KEY, {
      fallback: '',
    }) || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeRepoFullList(parsed);
  } catch {
    return [];
  }
}

function saveManualWorkspaceRepos(repos) {
  const normalized = normalizeRepoFullList(repos);
  try {
    if (!normalized.length) {
      removeBrowserStorageValue(MANUAL_WORKSPACE_REPOS_KEY);
      return;
    }
    writeBrowserStorageValue(MANUAL_WORKSPACE_REPOS_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore persistence failures.
  }
}

function getBrowserLocalStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore localStorage access failures.
  }
  return null;
}

function loadUiPreference(key, fallback = '') {
  const store = getBrowserLocalStorage();
  if (!store) return fallback;
  try {
    const value = store.getItem(String(key || ''));
    return value == null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function saveUiPreference(key, value) {
  const store = getBrowserLocalStorage();
  if (!store) return;
  try {
    store.setItem(String(key || ''), String(value ?? ''));
  } catch {
    // Ignore persistence failures.
  }
}

function createHomeSnapshotRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const source = normalizeStorageSource(entry?.source);
  const name = String(entry?.name || '').trim();
  const path = normalizePath(entry?.path || name);
  const browserPath = normalizePath(entry?.browserPath || path || name);
  if (!name && !path && !browserPath) return null;
  return {
    source,
    name: name || path || browserPath,
    path: path || name || browserPath,
    browserPath: browserPath || path || name,
    folder: String(entry?.folder || '').trim(),
    displayName: String(entry?.displayName || '').trim(),
    repoFull: String(entry?.repoFull || '').trim(),
    branch: String(entry?.branch || '').trim(),
    savedAt: entry?.savedAt || null,
    has3mf: !!entry?.has3mf,
    record: {
      savedAt: entry?.record?.savedAt || entry?.savedAt || null,
      thumbnailPath: String(entry?.record?.thumbnailPath || '').trim() || null,
    },
  };
}

function createHomeSnapshotFolder(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const source = normalizeStorageSource(entry?.source);
  const path = normalizePath(entry?.path || '');
  if (!path) return null;
  return {
    source,
    repoFull: String(entry?.repoFull || '').trim(),
    path,
    savedAt: entry?.savedAt || null,
  };
}

function saveHomeSnapshot() {
  const payload = {
    version: 1,
    savedAt: Date.now(),
    records: state.allRecords
      .map((entry) => createHomeSnapshotRecord(entry))
      .filter(Boolean),
    folders: state.folderRecords
      .map((entry) => createHomeSnapshotFolder(entry))
      .filter(Boolean),
  };
  saveUiPreference(HOME_SNAPSHOT_PREF_KEY, JSON.stringify(payload));
}

function loadHomeSnapshot() {
  const raw = String(loadUiPreference(HOME_SNAPSHOT_PREF_KEY, '') || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed?.savedAt || 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
    if ((Date.now() - savedAt) > HOME_SNAPSHOT_MAX_AGE_MS) return null;
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    const folders = Array.isArray(parsed?.folders) ? parsed.folders : [];
    return { records, folders };
  } catch {
    return null;
  }
}

function hydrateHomeSnapshotIntoState() {
  const snapshot = loadHomeSnapshot();
  if (!snapshot) return false;
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const folders = Array.isArray(snapshot.folders) ? snapshot.folders : [];
  if (!records.length && !folders.length) return false;

  const uniqueRecords = new Map();
  for (const rec of records) {
    const normalized = createHomeSnapshotRecord(rec);
    if (!normalized) continue;
    const key = `${normalized.source}:${normalized.repoFull}:${normalized.name}`;
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, normalized);
  }
  const uniqueFolders = new Map();
  for (const folder of folders) {
    const normalized = createHomeSnapshotFolder(folder);
    if (!normalized) continue;
    const key = `${normalized.source}:${normalized.repoFull}:${normalized.path}`;
    if (!uniqueFolders.has(key)) uniqueFolders.set(key, normalized);
  }

  state.allRecords = Array.from(uniqueRecords.values());
  state.allRecords.sort((a, b) => {
    const aTime = Date.parse(a?.savedAt || '') || 0;
    const bTime = Date.parse(b?.savedAt || '') || 0;
    return bTime - aTime;
  });
  state.folderRecords = Array.from(uniqueFolders.values());
  state.records = state.allRecords.slice(0, 10);
  rebuildEntryLookup();
  return true;
}

function loadUiPreferences() {
  const recentRaw = loadUiPreference(RECENT_EXPANDED_PREF_KEY, '');
  if (recentRaw === '0' || recentRaw === 'false') {
    state.recentExpanded = false;
  } else if (recentRaw === '1' || recentRaw === 'true') {
    state.recentExpanded = true;
  }

  const viewRaw = loadUiPreference(EXPLORER_VIEW_MODE_PREF_KEY, '').trim().toLowerCase();
  if (viewRaw === 'icons' || viewRaw === 'list') {
    state.explorerViewMode = viewRaw;
  }

  const iconSizeRaw = loadUiPreference(EXPLORER_ICON_SIZE_PREF_KEY, '');
  if (iconSizeRaw) {
    state.explorerIconSize = clampExplorerIconSize(iconSizeRaw);
  }

  loadExplorerLocationPreference();
}

function loadExplorerLocationPreference() {
  const raw = String(loadUiPreference(EXPLORER_LOCATION_PREF_KEY, '') || '').trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.workspaceTop === true || parsed.workspaceTop === false) {
      state.explorerWorkspaceTop = parsed.workspaceTop;
    }
    state.explorerRootSource = normalizeStorageSource(parsed.rootSource || parsed.source || state.explorerRootSource);
    state.explorerRootRepoFull = String(parsed.rootRepoFull || parsed.repoFull || state.explorerRootRepoFull || '').trim();
    state.explorerPath = normalizePath(parsed.path || state.explorerPath || '');
    if (state.explorerWorkspaceTop) state.explorerPath = '';
  } catch {
    // Ignore invalid explorer location payloads.
  }
}

function saveExplorerLocationPreference() {
  const payload = {
    workspaceTop: !!state.explorerWorkspaceTop,
    rootSource: normalizeStorageSource(state.explorerRootSource),
    rootRepoFull: String(state.explorerRootRepoFull || '').trim(),
    path: normalizePath(state.explorerPath || ''),
  };
  if (payload.workspaceTop) payload.path = '';
  saveUiPreference(EXPLORER_LOCATION_PREF_KEY, JSON.stringify(payload));
}

function normalizeStorageSource(input) {
  const source = String(input || '').trim().toLowerCase();
  if (source === 'mounted') return 'mounted';
  if (source === 'github') return 'github';
  return 'local';
}

function getMountedDirectoryName(mountId = '') {
  const target = String(mountId || '').trim();
  if (!target) return '';
  for (const item of Array.isArray(state.mountedDirectories) ? state.mountedDirectories : []) {
    if (String(item?.id || '').trim() !== target) continue;
    const name = String(item?.name || '').trim();
    if (name) return name;
  }
  return target;
}

function getStorageRootLabel(source, repoFull = '') {
  const normalizedSource = normalizeStorageSource(source);
  const normalizedRepoFull = String(repoFull || '').trim();
  if (normalizedSource === 'local') return 'Local Browser';
  if (normalizedSource === 'mounted') return getMountedDirectoryName(normalizedRepoFull) || 'Mounted Folder';
  return normalizedRepoFull || 'GitHub';
}

function normalizePath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  const out = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.' || token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

function isTrashPath(input) {
  const value = normalizePath(input || '');
  if (!value) return false;
  return value === TRASH_FOLDER_NAME || value.startsWith(`${TRASH_FOLDER_NAME}/`);
}

function isTrashRoot(source, repoFull = '') {
  return normalizeStorageSource(source) === 'local'
    && String(repoFull || '').trim() === TRASH_ROOT_REPO_FULL;
}

function clampExplorerIconSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return EXPLORER_ICON_SIZE_DEFAULT;
  return Math.max(EXPLORER_ICON_SIZE_MIN, Math.min(EXPLORER_ICON_SIZE_MAX, Math.round(parsed)));
}

function makeRootKey(source, repoFull = '') {
  const src = normalizeStorageSource(source);
  const repo = String(repoFull || '').trim();
  return `${src}:${repo}`;
}

function makeWorkspaceRoots() {
  const cfg = getGithubStorageConfig();
  const configured = normalizeRepoFullList(
    state.selectedRepoFulls?.length ? state.selectedRepoFulls : (cfg?.repoFulls || cfg?.repoFull || ''),
  );
  const seen = new Set();
  const repos = [];
  const addRepo = (value) => {
    const repo = String(value || '').trim();
    if (!repo || seen.has(repo)) return;
    seen.add(repo);
    repos.push(repo);
  };
  for (const repo of configured) addRepo(repo);
  for (const rec of state.allRecords) {
    if (normalizeStorageSource(rec?.source) !== 'github') continue;
    addRepo(String(rec?.repoFull || '').trim());
  }
  repos.sort((a, b) => a.localeCompare(b));

  const mountedMap = new Map();
  const addMounted = (id, name = '') => {
    const mountId = String(id || '').trim();
    if (!mountId) return;
    const current = mountedMap.get(mountId);
    if (current) {
      if (!current.name && name) current.name = String(name || '').trim();
      return;
    }
    mountedMap.set(mountId, {
      id: mountId,
      name: String(name || '').trim(),
    });
  };
  for (const mount of Array.isArray(state.mountedDirectories) ? state.mountedDirectories : []) {
    addMounted(mount?.id, mount?.name);
  }
  for (const rec of state.allRecords) {
    if (normalizeStorageSource(rec?.source) !== 'mounted') continue;
    addMounted(rec?.repoFull, rec?.repoLabel);
  }
  for (const folder of state.folderRecords) {
    if (normalizeStorageSource(folder?.source) !== 'mounted') continue;
    addMounted(folder?.repoFull, folder?.repoLabel);
  }
  const mountedRoots = Array.from(mountedMap.values())
    .sort((a, b) => {
      const aLabel = getStorageRootLabel('mounted', a.id);
      const bLabel = getStorageRootLabel('mounted', b.id);
      return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    })
    .map((entry) => ({
      source: 'mounted',
      repoFull: entry.id,
      label: getStorageRootLabel('mounted', entry.id),
      isPrimary: false,
    }));

  const primaryRepo = String(state.primaryRepoFull || cfg?.repoFull || '').trim();
  const roots = [{
    source: 'local',
    repoFull: '',
    label: 'Local Browser',
    isPrimary: false,
  }];
  roots.push(...mountedRoots);
  for (const repoFull of repos) {
    roots.push({
      source: 'github',
      repoFull,
      label: repoFull,
      isPrimary: !!primaryRepo && repoFull === primaryRepo,
    });
  }
  return roots;
}

function setExplorerWorkspaceTop() {
  state.explorerWorkspaceTop = true;
  state.explorerPath = '';
  saveExplorerLocationPreference();
  renderFilesList();
}

function setExplorerRoot(source, repoFull = '') {
  state.explorerWorkspaceTop = false;
  state.explorerRootSource = normalizeStorageSource(source);
  state.explorerRootRepoFull = String(repoFull || '').trim();
  state.explorerPath = '';
  saveExplorerLocationPreference();
  renderFilesList();
}

function setExplorerPath(path) {
  state.explorerPath = normalizePath(path);
  saveExplorerLocationPreference();
  renderFilesList();
}

function clearExplorerSizePopoverOutsideHandlers() {
  if (typeof state.explorerSizePopoverClose !== 'function') return;
  const close = state.explorerSizePopoverClose;
  state.explorerSizePopoverClose = null;
  try {
    close();
  } catch {
    // Ignore cleanup failures.
  }
}

function applyExplorerSizePopoverToDom(isOpen) {
  if (!state.filesListEl) return;
  state.filesListEl.querySelectorAll('.hub-explorer-size').forEach((popover) => {
    if (isOpen) popover.classList.add('is-open');
    else popover.classList.remove('is-open');
    popover.hidden = !isOpen;
  });
}

function closeExplorerSizePopover({ rerender = true } = {}) {
  if (!state.explorerSizePopoverOpen) {
    clearExplorerSizePopoverOutsideHandlers();
    return;
  }
  state.explorerSizePopoverOpen = false;
  clearExplorerSizePopoverOutsideHandlers();
  if (rerender) renderFilesList();
  else applyExplorerSizePopoverToDom(false);
}


async function renderHome() {
  state.root.innerHTML = `
    <div class="hub-page">
      <div class="hub-bg hub-bg-one"></div>
      <div class="hub-bg hub-bg-two"></div>
      <header class="hub-header">
        <div class="hub-brand-wrap">
          <div class="hub-brand-banner" aria-label="BREP.io logo">${brepHomeBannerSvg}</div>
        </div>
        <div class="hub-header-actions">
          <a class="hub-link-btn" href="./help/developer-index.html" target="_blank" rel="noreferrer">Docs</a>
          <button type="button" class="hub-icon-btn" data-action="toggle-settings" title="Settings" aria-label="Settings">⚙</button>
          <button type="button" class="hub-primary-btn" data-action="new">New Model</button>
        </div>
      </header>

      <main class="hub-main">
        <section class="hub-panel hub-files-panel">
          <div class="hub-panel-head">
            <h2 class="hub-panel-title">Your Files</h2>
            <div class="hub-storage-badge" data-role="storage-badge">Storage: Local</div>
          </div>

          <div class="hub-files-toolbar">
            <input type="search" class="hub-input hub-search" placeholder="Search files... (repo:, source:, ext:, folder:)" data-role="search" />
            <button type="button" class="hub-ghost-btn" data-action="refresh">Refresh</button>
            <button type="button" class="hub-ghost-btn" data-action="toggle-workspace">Workspace</button>
          </div>

          <div class="hub-status" data-role="files-status" hidden></div>
          <div class="hub-files-list" data-role="files-list"></div>
        </section>
      </main>

      <div class="hub-modal-overlay" data-role="workspace-modal" hidden>
        <section class="hub-panel hub-modal-panel hub-workspace-panel">
          <div class="hub-panel-head">
            <h2 class="hub-panel-title">Workspace</h2>
            <button type="button" class="hub-ghost-btn" data-action="close-workspace">Close</button>
          </div>
          <div class="hub-settings-grid">
            <div class="hub-field hub-field-inline">
              <span class="hub-field-label">Add Repository</span>
              <div class="hub-row-inline">
                <input type="text" class="hub-input" data-role="workspace-repo" list="brep-repo-options" placeholder="owner/repo" />
                <button type="button" class="hub-ghost-btn" data-action="add-repo">Add Repo</button>
                <button type="button" class="hub-ghost-btn" data-action="repos">Load Repos</button>
              </div>
              <datalist id="brep-repo-options"></datalist>
              <div class="hub-repo-picker" data-role="repo-picker"></div>
              <div class="hub-repo-summary" data-role="repo-summary"></div>
            </div>
            <div class="hub-field hub-field-inline">
              <span class="hub-field-label">Mounted Folders</span>
              <div class="hub-row-inline">
                <button type="button" class="hub-ghost-btn" data-action="mount-folder">Mount Folder</button>
              </div>
              <div class="hub-repo-picker" data-role="mount-picker"></div>
              <div class="hub-repo-summary" data-role="mount-summary"></div>
            </div>
          </div>
          <div class="hub-status" data-role="workspace-status" hidden></div>
        </section>
      </div>

      <div class="hub-modal-overlay" data-role="settings-modal" hidden>
        <section class="hub-panel hub-modal-panel hub-settings-panel">
          <div class="hub-panel-head">
            <h2 class="hub-panel-title">Settings</h2>
            <button type="button" class="hub-ghost-btn" data-action="close-settings">Close</button>
          </div>

          <div class="hub-settings-grid">
            <label class="hub-field">
              <span class="hub-field-label">GitHub Token</span>
              <input type="password" class="hub-input" data-role="token" placeholder="ghp_..." autocomplete="off" />
            </label>
          </div>

          <section class="hub-settings-instructions" aria-label="GitHub token setup instructions">
            <p class="hub-help-text">Create a GitHub personal access token, then paste it above.</p>
            <ol class="hub-help-list">
              <li>Open GitHub token settings.</li>
              <li>Create a token with repository <code>Contents</code> read/write access.</li>
              <li>Copy the token value and click <strong>Save Token</strong>.</li>
            </ol>
            <div class="hub-help-links">
              <a
                class="hub-link-btn"
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Fine-grained Token Setup
              </a>
              <a
                class="hub-link-btn"
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Classic Token Setup
              </a>
            </div>
          </section>

          <div class="hub-actions-row">
            <button type="button" class="hub-primary-btn" data-action="save-settings">Save Token</button>
          </div>

          <div class="hub-status" data-role="settings-status" hidden></div>
          <p class="hub-help">Token needs repository Contents read/write permission.</p>
        </section>
      </div>

      <div
        class="hub-busy-overlay"
        data-role="busy-overlay"
        hidden
        aria-hidden="true"
        aria-busy="false"
        aria-live="polite"
        tabindex="-1"
      >
        <div class="hub-busy-panel" role="status" aria-live="polite">
          <span class="hub-busy-spinner" aria-hidden="true"></span>
          <div class="hub-busy-copy">
            <h3 class="hub-busy-title" data-role="busy-message">Working...</h3>
            <p class="hub-busy-detail" data-role="busy-detail" hidden></p>
          </div>
        </div>
      </div>
    </div>
  `;

  state.filesListEl = state.root.querySelector('[data-role="files-list"]');
  state.filesStatusEl = state.root.querySelector('[data-role="files-status"]');
  state.storageBadgeEl = state.root.querySelector('[data-role="storage-badge"]');
  state.workspaceFoldersEl = state.root.querySelector('[data-role="workspace-folders"]');
  state.workspaceFoldersMetaEl = state.root.querySelector('[data-role="workspace-folders-meta"]');
  state.workspaceModalEl = state.root.querySelector('[data-role="workspace-modal"]');
  state.workspaceStatusEl = state.root.querySelector('[data-role="workspace-status"]');
  state.settingsPanelEl = state.root.querySelector('[data-role="settings-modal"]');
  state.settingsStatusEl = state.root.querySelector('[data-role="settings-status"]');
  state.mountPickerEl = state.root.querySelector('[data-role="mount-picker"]');
  state.mountSummaryEl = state.root.querySelector('[data-role="mount-summary"]');
  state.busyOverlayEl = state.root.querySelector('[data-role="busy-overlay"]');
  state.busyMessageEl = state.root.querySelector('[data-role="busy-message"]');
  state.busyDetailEl = state.root.querySelector('[data-role="busy-detail"]');
  syncBusyOverlay();

  const searchInput = state.root.querySelector('[data-role="search"]');
  const tokenInput = state.root.querySelector('[data-role="token"]');
  const workspaceRepoInput = state.root.querySelector('[data-role="workspace-repo"]');
  const repoOptions = state.root.querySelector('#brep-repo-options');
  const repoPicker = state.root.querySelector('[data-role="repo-picker"]');
  const repoSummary = state.root.querySelector('[data-role="repo-summary"]');
  const mountPicker = state.root.querySelector('[data-role="mount-picker"]');
  const mountSummary = state.root.querySelector('[data-role="mount-summary"]');
  const toggleSettingsBtn = state.root.querySelector('[data-action="toggle-settings"]');
  const toggleWorkspaceBtn = state.root.querySelector('[data-action="toggle-workspace"]');
  const addRepoBtn = state.root.querySelector('[data-action="add-repo"]');
  const mountFolderBtn = state.root.querySelector('[data-action="mount-folder"]');
  const closeWorkspaceBtn = state.root.querySelector('[data-action="close-workspace"]');
  const closeSettingsBtn = state.root.querySelector('[data-action="close-settings"]');
  state.repoPickerEl = repoPicker;
  state.repoSummaryEl = repoSummary;

  state.root.querySelector('[data-action="new"]')?.addEventListener('click', () => {
    if (isUiBusy()) return;
    goCad();
  });

  state.root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    if (isUiBusy()) return;
    void loadFiles();
  });

  if (searchInput) searchInput.value = state.searchTerm;
  searchInput?.addEventListener('input', () => {
    if (isUiBusy()) return;
    state.searchTerm = String(searchInput.value || '').trim();
    renderFilesList();
  });

  const cfg = getGithubStorageConfig();
  state.manualRepoFulls = normalizeRepoFullList(loadManualWorkspaceRepos());
  state.selectedRepoFulls = normalizeRepoFullList(cfg?.repoFulls || cfg?.repoFull || '');
  state.primaryRepoFull = String(cfg?.repoFull || state.selectedRepoFulls[0] || '').trim();
  if (tokenInput) tokenInput.value = cfg?.token || '';
  if (workspaceRepoInput) workspaceRepoInput.value = '';

  const getSelectableRepos = () => state.repoCache
    .filter((item) => item && item.full_name)
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

  const refreshWorkspaceRepoOptions = () => {
    if (!repoOptions) return;
    repoOptions.innerHTML = '';
    const repoNames = normalizeRepoFullList([
      ...state.manualRepoFulls,
      ...state.selectedRepoFulls,
      ...state.repoCache.map((item) => String(item?.full_name || '').trim()),
    ]);
    for (const repoFull of repoNames) {
      const option = document.createElement('option');
      option.value = repoFull;
      repoOptions.appendChild(option);
    }
  };

  const buildWorkspaceRepoCandidates = () => {
    const map = new Map();
    for (const item of getSelectableRepos()) {
      const repoFull = String(item?.full_name || '').trim();
      if (!repoFull) continue;
      map.set(repoFull, {
        repoFull,
        fetched: true,
        manual: false,
        readOnly: !!item?.permissions && item.permissions.push === false,
      });
    }
    for (const repoFull of state.manualRepoFulls) {
      const existing = map.get(repoFull);
      if (existing) {
        existing.manual = true;
      } else {
        map.set(repoFull, {
          repoFull,
          fetched: false,
          manual: true,
          readOnly: false,
        });
      }
    }
    for (const repoFull of state.selectedRepoFulls) {
      if (map.has(repoFull)) continue;
      map.set(repoFull, {
        repoFull,
        fetched: false,
        manual: false,
        readOnly: false,
      });
    }
    return Array.from(map.values())
      .sort((a, b) => String(a.repoFull || '').localeCompare(String(b.repoFull || '')));
  };

  const setSettingsOpen = (open) => {
    const isOpen = !!open;
    if (state.settingsPanelEl) state.settingsPanelEl.hidden = !isOpen;
    toggleSettingsBtn?.classList.toggle('is-active', isOpen);
  };

  let workspaceRepoLoadCallId = 0;
  const loadWorkspaceRepos = async ({
    silent = false,
  } = {}) => {
    const tokenValue = String(tokenInput?.value || '').trim() || String(getGithubStorageConfig()?.token || '').trim();
    if (!tokenValue) {
      state.repoCache = [];
      refreshWorkspaceRepoOptions();
      renderWorkspaceRepos();
      if (!silent) setWorkspaceStatus('Set a GitHub token from Settings first.', 'warn');
      return;
    }
    state.workspaceReposLoading = true;
    renderWorkspaceRepos();
    const callId = ++workspaceRepoLoadCallId;
    if (!silent) setWorkspaceStatus('Loading repositories...', 'info');
    try {
      const repos = await fetchGithubUserRepos(tokenValue);
      if (callId !== workspaceRepoLoadCallId) return;
      state.repoCache = Array.isArray(repos) ? repos : [];
      refreshWorkspaceRepoOptions();
      renderWorkspaceRepos();
      if (!silent) setWorkspaceStatus(`Loaded ${state.repoCache.length} repositories.`, 'ok');
    } catch (err) {
      if (callId !== workspaceRepoLoadCallId) return;
      if (!silent) setWorkspaceStatus(`Repo load failed: ${errorMessage(err)}`, 'error');
      renderWorkspaceRepos();
    } finally {
      if (callId !== workspaceRepoLoadCallId) return;
      state.workspaceReposLoading = false;
      renderWorkspaceRepos();
    }
  };

  const setWorkspaceOpen = (open) => {
    const isOpen = !!open;
    if (state.workspaceModalEl) state.workspaceModalEl.hidden = !isOpen;
    toggleWorkspaceBtn?.classList.toggle('is-active', isOpen);
    if (isOpen) {
      void loadWorkspaceRepos({ silent: false });
      void refreshMountedFolders({ silent: true });
    }
  };

  toggleSettingsBtn?.addEventListener('click', () => {
    if (isUiBusy()) return;
    const isOpen = !(state.settingsPanelEl?.hidden === false);
    if (isOpen) setWorkspaceOpen(false);
    setSettingsOpen(isOpen);
  });
  toggleWorkspaceBtn?.addEventListener('click', () => {
    if (isUiBusy()) return;
    const isOpen = !(state.workspaceModalEl?.hidden === false);
    if (isOpen) setSettingsOpen(false);
    setWorkspaceOpen(isOpen);
  });
  closeWorkspaceBtn?.addEventListener('click', () => {
    if (isUiBusy()) return;
    setWorkspaceOpen(false);
  });
  closeSettingsBtn?.addEventListener('click', () => {
    if (isUiBusy()) return;
    setSettingsOpen(false);
  });

  state.workspaceModalEl?.addEventListener('click', (event) => {
    if (event.target === state.workspaceModalEl) setWorkspaceOpen(false);
  });
  state.settingsPanelEl?.addEventListener('click', (event) => {
    if (event.target === state.settingsPanelEl) setSettingsOpen(false);
  });
  state.busyOverlayEl?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  state.busyOverlayEl?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  state.busyOverlayEl?.addEventListener('keydown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (isUiBusy()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const activeEl = document.activeElement;
    const isTyping = isTextInputElement(activeEl);
    const settingsOpen = state.settingsPanelEl?.hidden === false;
    const workspaceOpen = state.workspaceModalEl?.hidden === false;

    if (event.key === 'Escape') {
      if (settingsOpen) setSettingsOpen(false);
      if (workspaceOpen) setWorkspaceOpen(false);
      if (!settingsOpen && !workspaceOpen && state.selectedEntryKeys.size) {
        event.preventDefault();
        clearSelectedEntries();
      }
      return;
    }

    if (settingsOpen || workspaceOpen || isTyping) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      if (!state.visibleExplorerEntryKeys.length) return;
      event.preventDefault();
      selectVisibleExplorerEntries(true);
      return;
    }

    if (event.key === 'Delete' && state.selectedEntryKeys.size) {
      event.preventDefault();
      void moveEntriesToTrash(getSelectedEntries(), { confirm: true });
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      if (state.explorerWorkspaceTop) return;
      const currentPath = normalizePath(state.explorerPath || '');
      if (currentPath) {
        const idx = currentPath.lastIndexOf('/');
        setExplorerPath(idx >= 0 ? currentPath.slice(0, idx) : '');
        return;
      }
      setExplorerWorkspaceTop();
    }
  });

  const ensurePrimaryRepo = () => {
    state.selectedRepoFulls = normalizeRepoFullList(state.selectedRepoFulls);
    let primary = String(state.primaryRepoFull || '').trim();
    if (primary && !state.selectedRepoFulls.includes(primary)) {
      primary = '';
    }
    if (!primary && state.selectedRepoFulls.length) {
      primary = state.selectedRepoFulls[0];
    }
    if (primary) state.selectedRepoFulls = normalizeRepoFullList([primary, ...state.selectedRepoFulls]);
    state.primaryRepoFull = primary;
  };

  const addRepoToWorkspace = (repoFullRaw) => {
    const repoFull = String(repoFullRaw || '').trim();
    if (!repoFull) return { ok: false, reason: 'empty' };
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFull)) {
      return { ok: false, reason: 'invalid' };
    }
    state.manualRepoFulls = normalizeRepoFullList([repoFull, ...state.manualRepoFulls]);
    saveManualWorkspaceRepos(state.manualRepoFulls);
    if (state.selectedRepoFulls.includes(repoFull)) {
      if (!state.primaryRepoFull) state.primaryRepoFull = repoFull;
      return { ok: true, changed: false };
    }
    state.selectedRepoFulls = normalizeRepoFullList([...state.selectedRepoFulls, repoFull]);
    if (!state.primaryRepoFull) state.primaryRepoFull = repoFull;
    return { ok: true, changed: true };
  };

  const renderWorkspaceRepos = () => {
    if (!repoPicker || !repoSummary) return;
    repoPicker.innerHTML = '';
    ensurePrimaryRepo();
    const primary = String(state.primaryRepoFull || '').trim();
    const selectedSet = new Set(state.selectedRepoFulls);
    const repos = buildWorkspaceRepoCandidates()
      .slice()
      .sort((a, b) => {
        const aRepo = String(a?.repoFull || '').trim();
        const bRepo = String(b?.repoFull || '').trim();
        const aIncluded = selectedSet.has(aRepo) ? 1 : 0;
        const bIncluded = selectedSet.has(bRepo) ? 1 : 0;
        if (aIncluded !== bIncluded) return bIncluded - aIncluded;
        return aRepo.localeCompare(bRepo);
      });

    if (!repos.length) {
      repoSummary.textContent = state.workspaceReposLoading
        ? 'Loading repositories...'
        : 'No repositories available yet. Add a repository or load your repo list.';
      return;
    }

    for (const repo of repos) {
      const repoFull = String(repo?.repoFull || '').trim();
      if (!repoFull) continue;
      const included = selectedSet.has(repoFull);

      const row = document.createElement('div');
      row.className = `hub-repo-option${included ? ' is-included' : ''}`;

      const label = document.createElement('label');
      label.className = 'hub-repo-check';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = included;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedRepoFulls = normalizeRepoFullList([...state.selectedRepoFulls, repoFull]);
          if (!state.primaryRepoFull) state.primaryRepoFull = repoFull;
        } else {
          state.selectedRepoFulls = state.selectedRepoFulls.filter((value) => value !== repoFull);
          if (String(state.primaryRepoFull || '').trim() === repoFull) {
            state.primaryRepoFull = state.selectedRepoFulls[0] || '';
          }
        }
        ensurePrimaryRepo();
        renderWorkspaceRepos();
        void applyWorkspaceRepos({
          pendingMessage: 'Updating workspace repositories...',
          successMessage: 'Workspace repositories updated.',
        });
      });
      label.appendChild(checkbox);

      const name = document.createElement('span');
      name.className = 'hub-repo-option-name';
      name.textContent = repoFull;
      label.appendChild(name);
      row.appendChild(label);

      const badges = document.createElement('div');
      badges.className = 'hub-repo-option-badges';
      if (included && repoFull === primary) {
        const badge = document.createElement('span');
        badge.className = 'hub-repo-badge is-primary';
        badge.textContent = 'Primary';
        badges.appendChild(badge);
      }
      if (repo?.readOnly) {
        const badge = document.createElement('span');
        badge.className = 'hub-repo-badge';
        badge.textContent = 'Read Only';
        badges.appendChild(badge);
      }
      if (repo?.manual) {
        const badge = document.createElement('span');
        badge.className = 'hub-repo-badge';
        badge.textContent = 'Manual';
        badges.appendChild(badge);
      }
      row.appendChild(badges);

      const primaryBtn = document.createElement('button');
      primaryBtn.type = 'button';
      primaryBtn.className = 'hub-ghost-btn hub-repo-primary-btn';
      primaryBtn.textContent = repoFull === primary ? 'Primary' : 'Set Primary';
      primaryBtn.disabled = !included || repoFull === primary;
      primaryBtn.addEventListener('click', () => {
        state.primaryRepoFull = repoFull;
        ensurePrimaryRepo();
        renderWorkspaceRepos();
        void applyWorkspaceRepos({
          pendingMessage: 'Applying primary repository...',
          successMessage: 'Primary repository updated.',
        });
      });
      row.appendChild(primaryBtn);

      repoPicker.appendChild(row);
    }

    const includedCount = state.selectedRepoFulls.length;
    const availableCount = repos.length;
    const loadingSuffix = state.workspaceReposLoading ? ' Loading…' : '';
    repoSummary.textContent = `Included: ${includedCount} of ${availableCount} repositories.${loadingSuffix}`;
  };

  const renderMountedFolders = () => {
    if (!mountPicker || !mountSummary) return;
    mountPicker.innerHTML = '';

    const supportsMounted = isSystemAccessSupported();
    if (mountFolderBtn) mountFolderBtn.disabled = !supportsMounted;
    if (!supportsMounted) {
      mountSummary.textContent = 'System Access API is not available in this browser/context.';
      return;
    }

    const mounted = (Array.isArray(state.mountedDirectories) ? state.mountedDirectories : [])
      .slice()
      .sort((a, b) =>
        String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );

    if (!mounted.length) {
      mountSummary.textContent = 'No mounted folders yet.';
      return;
    }

    for (const mount of mounted) {
      const mountId = String(mount?.id || '').trim();
      if (!mountId) continue;
      const mountName = String(mount?.name || mountId).trim() || mountId;

      const row = document.createElement('div');
      row.className = 'hub-repo-option is-included';

      const label = document.createElement('div');
      label.className = 'hub-repo-check';
      const name = document.createElement('span');
      name.className = 'hub-repo-option-name';
      name.textContent = mountName;
      label.appendChild(name);
      row.appendChild(label);

      const badges = document.createElement('div');
      badges.className = 'hub-repo-option-badges';
      const idBadge = document.createElement('span');
      idBadge.className = 'hub-repo-badge';
      idBadge.textContent = mountId;
      idBadge.title = mountId;
      badges.appendChild(idBadge);
      row.appendChild(badges);

      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'hub-ghost-btn hub-repo-primary-btn';
      browseBtn.textContent = 'Browse';
      browseBtn.addEventListener('click', () => {
        setExplorerRoot('mounted', mountId);
        setWorkspaceOpen(false);
      });
      row.appendChild(browseBtn);

      const unmountBtn = document.createElement('button');
      unmountBtn.type = 'button';
      unmountBtn.className = 'hub-ghost-btn hub-repo-primary-btn';
      unmountBtn.textContent = 'Unmount';
      unmountBtn.addEventListener('click', async () => {
        const ok = await confirm(`Unmount "${mountName}"?`);
        if (!ok) return;
        setWorkspaceStatus(`Unmounting "${mountName}"...`, 'info');
        try {
          await unmountDirectory(mountId);
          await loadFiles();
          renderMountedFolders();
          setWorkspaceStatus(`Unmounted "${mountName}".`, 'ok');
        } catch (err) {
          setWorkspaceStatus(`Unmount failed: ${errorMessage(err)}`, 'error');
        }
      });
      row.appendChild(unmountBtn);

      mountPicker.appendChild(row);
    }

    mountSummary.textContent = `Mounted: ${mounted.length} folder${mounted.length === 1 ? '' : 's'}.`;
  };

  const refreshMountedFolders = async ({ silent = true } = {}) => {
    try {
      state.mountedDirectories = await listMountedDirectories();
      renderMountedFolders();
      if (!silent) {
        setWorkspaceStatus(
          state.mountedDirectories.length
            ? `Loaded ${state.mountedDirectories.length} mounted folder${state.mountedDirectories.length === 1 ? '' : 's'}.`
            : 'No mounted folders found.',
          'info',
        );
      }
    } catch (err) {
      renderMountedFolders();
      if (!silent) setWorkspaceStatus(`Failed to load mounted folders: ${errorMessage(err)}`, 'error');
    }
  };

  let workspaceApplyCallId = 0;
  const applyWorkspaceRepos = async ({
    pendingMessage = 'Saving workspace repositories...',
    successMessage = 'Workspace repositories saved.',
  } = {}) => {
    ensurePrimaryRepo();
    const repoValue = String(state.primaryRepoFull || '').trim();
    state.selectedRepoFulls = normalizeRepoFullList(state.selectedRepoFulls);
    const callId = ++workspaceApplyCallId;

    setWorkspaceStatus(pendingMessage, 'info');
    try {
      const result = await configureGithubStorage({
        repoFull: repoValue,
        repoFulls: state.selectedRepoFulls,
        mode: 'local',
      });
      if (callId !== workspaceApplyCallId) return;

      if (!result) {
        setWorkspaceStatus('Workspace update returned no result.', 'warn');
      } else setWorkspaceStatus(successMessage, 'ok');
      renderWorkspaceRepos();
      refreshStorageBadge();
      await loadFiles();
    } catch (err) {
      if (callId !== workspaceApplyCallId) return;
      setWorkspaceStatus(`Workspace update failed: ${errorMessage(err)}`, 'error');
    }
  };

  let tokenApplyCallId = 0;
  const applyTokenSettings = async ({
    pendingMessage = 'Saving GitHub token...',
    successMessage = 'GitHub token saved.',
  } = {}) => {
    const tokenValue = String(tokenInput?.value || '').trim();
    const callId = ++tokenApplyCallId;

    setSettingsStatus(pendingMessage, 'info');
    try {
      const result = await configureGithubStorage({
        token: tokenValue,
        mode: 'local',
      });
      if (callId !== tokenApplyCallId) return;
      if (!result) {
        setSettingsStatus('Token update returned no result.', 'warn');
      } else {
        setSettingsStatus(successMessage, 'ok');
      }
      if (!tokenValue) {
        state.repoCache = [];
        refreshWorkspaceRepoOptions();
      }
      refreshStorageBadge();
      await loadFiles();
      if (state.workspaceModalEl?.hidden === false) {
        await loadWorkspaceRepos({ silent: true });
      }
    } catch (err) {
      if (callId !== tokenApplyCallId) return;
      setSettingsStatus(`Token update failed: ${errorMessage(err)}`, 'error');
    }
  };

  state.root.querySelector('[data-action="repos"]')?.addEventListener('click', async () => {
    await loadWorkspaceRepos({ silent: false });
  });

  mountFolderBtn?.addEventListener('click', async () => {
    if (isUiBusy()) return;
    if (!isSystemAccessSupported()) {
      setWorkspaceStatus('System Access API is not available in this browser/context.', 'warn');
      return;
    }
    setWorkspaceStatus('Choose a local folder to mount...', 'info');
    try {
      await promptAndMountDirectory();
      await loadFiles();
      renderMountedFolders();
      setWorkspaceStatus('Folder mounted.', 'ok');
    } catch (err) {
      if (String(err?.name || '').trim() === 'AbortError') {
        setWorkspaceStatus('Mount canceled.', 'warn');
        return;
      }
      setWorkspaceStatus(`Mount failed: ${errorMessage(err)}`, 'error');
    }
  });

  addRepoBtn?.addEventListener('click', () => {
    const result = addRepoToWorkspace(String(workspaceRepoInput?.value || '').trim());
    if (!result.ok) {
      if (result.reason === 'invalid') {
        setWorkspaceStatus('Repository must be in owner/repo format.', 'warn');
      } else {
        setWorkspaceStatus('Enter a repository to add.', 'warn');
      }
      return;
    }
    if (workspaceRepoInput) workspaceRepoInput.value = '';
    refreshWorkspaceRepoOptions();
    renderWorkspaceRepos();
    void applyWorkspaceRepos({
      pendingMessage: 'Adding repository to workspace...',
      successMessage: result.changed ? 'Repository added to workspace.' : 'Repository already in workspace.',
    });
  });

  state.root.querySelector('[data-action="save-settings"]')?.addEventListener('click', async () => {
    await applyTokenSettings({
      pendingMessage: 'Saving GitHub token...',
      successMessage: 'GitHub token saved.',
    });
  });

  workspaceRepoInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    state.root.querySelector('[data-action="add-repo"]')?.dispatchEvent(new Event('click'));
  });

  tokenInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    state.root.querySelector('[data-action="save-settings"]')?.dispatchEvent(new Event('click'));
  });

  refreshWorkspaceRepoOptions();
  setWorkspaceOpen(false);
  setSettingsOpen(false);
  renderWorkspaceRepos();
  renderMountedFolders();
  refreshStorageBadge();
  if (hydrateHomeSnapshotIntoState()) {
    renderFilesList();
    setFilesStatus('Loaded cached file index. Refreshing…', 'info');
  }
  await loadFiles();
}

async function loadFiles() {
  if (state.loadingFiles) {
    state.pendingFilesReload = true;
    await waitForFilesIdle();
    return;
  }
  if (!state.selectedRepoFulls.length) {
    const cfg = getGithubStorageConfig();
    state.selectedRepoFulls = normalizeRepoFullList(cfg?.repoFulls || cfg?.repoFull || '');
    if (!state.primaryRepoFull) state.primaryRepoFull = String(cfg?.repoFull || state.selectedRepoFulls[0] || '').trim();
  }
  state.loadingFiles = true;
  state.pendingFilesReload = false;
  setFilesStatus('Loading files...', 'info');
  if (isUiBusy()) {
    setBusyUiProgress('Refreshing file index...', 'Loading local and remote records...');
  }
  try {
    let mountedDirectories = [];
    try {
      mountedDirectories = await listMountedDirectories();
    } catch {
      mountedDirectories = [];
    }
    state.mountedDirectories = Array.isArray(mountedDirectories) ? mountedDirectories : [];
    const mountedIds = state.mountedDirectories
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean);
    const [localRecords, remoteRecords, mountedRecords, localFolders, remoteFolders, mountedFolders] = await Promise.all([
      listComponentRecords({ source: 'local' }),
      listComponentRecords({ source: 'github', repoFulls: state.selectedRepoFulls }),
      listComponentRecords({ source: 'mounted', repoFulls: mountedIds }),
      listWorkspaceFolders({ source: 'local' }),
      listWorkspaceFolders({ source: 'github', repoFulls: state.selectedRepoFulls }),
      listWorkspaceFolders({ source: 'mounted', repoFulls: mountedIds }),
    ]);
    const combined = [
      ...(Array.isArray(localRecords) ? localRecords : []),
      ...(Array.isArray(remoteRecords) ? remoteRecords : []),
      ...(Array.isArray(mountedRecords) ? mountedRecords : []),
    ];
    const unique = new Map();
    for (const rec of combined) {
      const source = String(rec?.source || '').trim().toLowerCase();
      const repoFull = String(rec?.repoFull || '').trim();
      const name = String(rec?.name || rec?.path || '').trim();
      if (!name) continue;
      const key = `${source}:${repoFull}:${name}`;
      if (!unique.has(key)) unique.set(key, rec);
    }
    state.allRecords = Array.from(unique.values());
    state.allRecords.sort((a, b) => {
      const aTime = Date.parse(a?.savedAt || '') || 0;
      const bTime = Date.parse(b?.savedAt || '') || 0;
      return bTime - aTime;
    });
    const folderCombined = [
      ...(Array.isArray(localFolders) ? localFolders : []),
      ...(Array.isArray(remoteFolders) ? remoteFolders : []),
      ...(Array.isArray(mountedFolders) ? mountedFolders : []),
    ];
    const folderUnique = new Map();
    for (const folder of folderCombined) {
      const source = normalizeStorageSource(folder?.source || 'local');
      const repoFull = String(folder?.repoFull || '').trim();
      const path = normalizePath(folder?.path || '');
      if (!path) continue;
      const key = `${source}:${repoFull}:${path}`;
      if (!folderUnique.has(key)) folderUnique.set(key, {
        source,
        repoFull,
        path,
        savedAt: folder?.savedAt || null,
      });
    }
    state.folderRecords = Array.from(folderUnique.values());
    state.records = state.allRecords.slice(0, 10);
    rebuildEntryLookup();
    saveHomeSnapshot();
    refreshStorageBadge();
    if (isUiBusy()) {
      setBusyUiProgress('Refreshing file index...', 'Rendering updated file explorer...');
    }
    renderFilesList();
    setFilesStatus('', 'info', true);
  } catch (err) {
    state.records = [];
    state.allRecords = [];
    state.folderRecords = [];
    rebuildEntryLookup();
    renderFilesList();
    setFilesStatus(`Failed to load files: ${errorMessage(err)}`, 'error');
  } finally {
    state.loadingFiles = false;
    if (state.pendingFilesReload) {
      state.pendingFilesReload = false;
      await loadFiles();
    }
  }
}

function renderFilesList() {
  if (!state.filesListEl) return;
  if (state.explorerWidget) {
    try { state.explorerWidget.destroy(); } catch { /* ignore */ }
    state.explorerWidget = null;
  }
  closeActiveFileMenu();
  clearExplorerSizePopoverOutsideHandlers();
  state.filesListEl.innerHTML = '';

  const term = state.searchTerm;
  const recentItems = state.records.slice().sort((a, b) => {
    const aTime = Date.parse(a?.savedAt || '') || 0;
    const bTime = Date.parse(b?.savedAt || '') || 0;
    return bTime - aTime;
  });
  const hasAnyContent = state.allRecords.length > 0 || state.folderRecords.length > 0;

  if (!hasAnyContent) {
    const onboarding = document.createElement('section');
    onboarding.className = 'hub-empty-start';
    const title = document.createElement('h3');
    title.className = 'hub-empty-start-title';
    title.textContent = 'Get Started';
    onboarding.appendChild(title);

    const body = document.createElement('p');
    body.className = 'hub-empty-start-body';
    body.textContent = 'Add workspace repositories, create a new model, and save anywhere in your folder tree.';
    onboarding.appendChild(body);

    const steps = document.createElement('ol');
    steps.className = 'hub-empty-start-steps';
    for (const text of [
      'Open Workspace and include local, mounted folders, and/or GitHub repositories.',
      'Click New Model to start a part or assembly.',
      'Save to any folder path in your workspace tree.',
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      steps.appendChild(li);
    }
    onboarding.appendChild(steps);
    state.filesListEl.appendChild(onboarding);
  }

  const recentSection = document.createElement('section');
  recentSection.className = 'hub-recent-strip';
  if (!state.recentExpanded) recentSection.classList.add('is-collapsed');

  const recentHead = document.createElement('button');
  recentHead.type = 'button';
  recentHead.className = 'hub-recent-head hub-recent-toggle';
  recentHead.setAttribute('aria-expanded', state.recentExpanded ? 'true' : 'false');
  recentHead.title = state.recentExpanded ? 'Collapse recent files' : 'Expand recent files';

  const recentTitle = document.createElement('h3');
  recentTitle.className = 'hub-recent-title';
  recentTitle.textContent = 'Recent Files';

  const recentHeadRight = document.createElement('div');
  recentHeadRight.className = 'hub-recent-head-right';

  const recentMeta = document.createElement('div');
  recentMeta.className = 'hub-recent-meta';
  recentMeta.textContent = `${recentItems.length} file${recentItems.length === 1 ? '' : 's'}`;
  recentHeadRight.appendChild(recentMeta);

  const recentChevron = document.createElement('span');
  recentChevron.className = 'hub-recent-chevron';
  recentChevron.setAttribute('aria-hidden', 'true');
  recentChevron.textContent = state.recentExpanded ? 'v' : '>';
  recentHeadRight.appendChild(recentChevron);

  recentHead.appendChild(recentTitle);
  recentHead.appendChild(recentHeadRight);
  recentHead.addEventListener('click', () => {
    state.recentExpanded = !state.recentExpanded;
    saveUiPreference(RECENT_EXPANDED_PREF_KEY, state.recentExpanded ? '1' : '0');
    renderFilesList();
  });
  recentSection.appendChild(recentHead);

  const recentList = document.createElement('div');
  recentList.className = 'hub-recent-gallery hub-browser-grid';
  recentList.hidden = !state.recentExpanded;
  if (!recentItems.length) {
    const empty = document.createElement('div');
    empty.className = 'hub-empty';
    empty.textContent = 'No recent files yet. Open or save a model to populate this list.';
    recentList.appendChild(empty);
  } else {
    for (const entry of recentItems) {
      const tile = createBrowserFileTile(entry);
      if (!tile) continue;
      recentList.appendChild(tile);
    }
  }
  recentSection.appendChild(recentList);
  state.filesListEl.appendChild(recentSection);

  const roots = makeWorkspaceRoots();
  state.filesListEl.appendChild(createFolderExplorer(roots, term));
}

function ensureModelExtension(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (value.toLowerCase().endsWith(MODEL_FILE_EXTENSION)) return value;
  return `${value}${MODEL_FILE_EXTENSION}`;
}

function getEntryModelDisplayName(entry) {
  const name = String(entry?.name || '').trim();
  const base = String(entry?.displayName || '').trim() || (name.includes('/') ? name.split('/').pop() : name);
  return ensureModelExtension(base || name);
}

function getEntryModelPathWithExtension(entry) {
  const modelPath = normalizePath(entry?.path || entry?.name || '');
  return ensureModelExtension(modelPath);
}

function getEntryBrowserPath(entry) {
  return normalizePath(entry?.browserPath || entry?.path || entry?.name || '');
}

function getEntryBrowserPathWithExtension(entry) {
  return ensureModelExtension(getEntryBrowserPath(entry));
}

function stripModelFileExtension(pathValue) {
  const clean = normalizePath(pathValue);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower.endsWith(MODEL_FILE_EXTENSION)) return clean.slice(0, -MODEL_FILE_EXTENSION.length);
  return clean;
}

function getEntryCadLaunchModelPath(entry) {
  const canonicalPath = normalizePath(entry?.path || entry?.name || '');
  const browserPath = getEntryBrowserPath(entry);
  return stripModelFileExtension(canonicalPath || browserPath);
}

function getEntryFullPathTooltip(entry) {
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  const browserPath = getEntryBrowserPathWithExtension(entry)
    || getEntryModelPathWithExtension(entry)
    || ensureModelExtension(String(entry?.name || '').trim());
  const parts = [];
  parts.push(getStorageRootLabel(source, repoFull));
  if (browserPath) parts.push(browserPath);
  return parts.join(' / ');
}

function encodePathForUrl(value) {
  return normalizePath(value)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function encodeRefForUrl(ref) {
  return String(ref || '')
    .trim()
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function isCommitShaLikeRef(ref) {
  const value = String(ref || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function normalizeGithubBrowserBranchRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return '';
  if (isCommitShaLikeRef(value)) return '';
  return value;
}

function parseGithubRepoFull(repoFull) {
  const raw = String(repoFull || '').trim();
  const parts = raw.split('/');
  if (parts.length < 2) return null;
  const owner = String(parts[0] || '').trim();
  const repo = String(parts.slice(1).join('/') || '').trim();
  if (!owner || !repo) return null;
  return { owner, repo };
}

function getGithubApiHeaders(token = '') {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const cleanToken = String(token || '').trim();
  if (cleanToken) headers.Authorization = `Bearer ${cleanToken}`;
  return headers;
}

async function fetchGithubDefaultBranch(repoFull, token = '') {
  const repo = String(repoFull || '').trim();
  if (!repo) return '';
  if (githubDefaultBranchCache.has(repo)) {
    return String(githubDefaultBranchCache.get(repo) || '');
  }
  if (githubDefaultBranchInflight.has(repo)) {
    return await githubDefaultBranchInflight.get(repo);
  }

  const loadPromise = (async () => {
    try {
      const parsed = parseGithubRepoFull(repo);
      if (!parsed) return '';
      const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
      const res = await fetch(url, { headers: getGithubApiHeaders(token) });
      if (!res.ok) return '';
      const data = await res.json();
      const branch = normalizeGithubBrowserBranchRef(data?.default_branch || '');
      if (branch) githubDefaultBranchCache.set(repo, branch);
      return branch;
    } catch {
      return '';
    } finally {
      githubDefaultBranchInflight.delete(repo);
    }
  })();

  githubDefaultBranchInflight.set(repo, loadPromise);
  return await loadPromise;
}

async function resolveGithubBrowserBranch(entry) {
  const repoFull = String(entry?.repoFull || '').trim();
  if (!repoFull) return '';
  const cfg = getGithubStorageConfig() || {};
  const token = String(cfg?.token || '').trim();
  const entryBranch = normalizeGithubBrowserBranchRef(entry?.branch || '');
  const cfgBranch = normalizeGithubBrowserBranchRef(cfg?.branch || '');
  const selected = entryBranch || cfgBranch || '';
  const selectedLower = selected.toLowerCase();

  if (!selected || selectedLower === 'main' || selectedLower === 'master') {
    const defaultBranch = await fetchGithubDefaultBranch(repoFull, token);
    if (defaultBranch) return defaultBranch;
  }

  return selected || 'main';
}

async function buildGithubModelUrl(entry) {
  const source = normalizeStorageSource(entry?.source);
  if (source !== 'github') return '';
  const repoFull = String(entry?.repoFull || '').trim();
  if (!repoFull) return '';
  const branch = await resolveGithubBrowserBranch(entry);
  const branchRef = encodeRefForUrl(branch);
  const filePath = encodePathForUrl(getEntryBrowserPathWithExtension(entry));
  if (!filePath) return `https://github.com/${repoFull}`;
  return `https://github.com/${repoFull}/blob/${branchRef}/${filePath}`;
}

async function openEntryOnGithub(entry) {
  try {
    const url = await buildGithubModelUrl(entry);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
  } catch {
    // Fall through to repo root fallback.
  }
  const repoFull = String(entry?.repoFull || '').trim();
  if (repoFull) window.open(`https://github.com/${repoFull}`, '_blank', 'noopener,noreferrer');
}

function createBrowserFileTile(entry) {
  const name = String(entry?.name || '').trim();
  if (!name) return null;
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  const branch = String(entry?.branch || '').trim();
  const entryKey = getEntrySelectionKey(entry);
  const isSelected = isEntrySelected(entry);
  const displayName = getEntryModelDisplayName(entry);
  const fullModelPath = getEntryFullPathTooltip(entry) || getEntryModelPathWithExtension(entry) || ensureModelExtension(name);
  const cadModelPath = getEntryCadLaunchModelPath(entry) || name;
  const openFile = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    goCad({
      source,
      repoFull,
      branch,
      path: cadModelPath,
    });
  };

  const tile = document.createElement('article');
  tile.className = `hub-browser-tile is-file hub-browser-file-entry${isSelected ? ' is-selected' : ''}`;
  tile.title = fullModelPath || name;
  tile.tabIndex = 0;
  if (entryKey) tile.dataset.entryKey = entryKey;

  tile.appendChild(createSelectionToggle(entry, { tile: true }));
  tile.appendChild(createFileActionsMenu(entry, { extraClass: 'hub-browser-tile-menu' }));
  const preview = createModelPreview(entry, {
    previewClass: 'hub-browser-tile-preview',
    iconClass: 'hub-browser-tile-icon',
    thumbClass: 'hub-browser-tile-thumb',
  });
  preview.classList.add('hub-browser-open-target');
  preview.title = `Open ${displayName || name}`;
  preview.addEventListener('click', openFile);
  tile.appendChild(preview);

  const label = document.createElement('div');
  label.className = 'hub-browser-tile-name';
  label.textContent = displayName || name;
  label.title = fullModelPath || name;
  label.classList.add('hub-browser-open-target');
  label.addEventListener('click', openFile);
  tile.appendChild(label);

  bindExplorerFileKeyboard(tile, entry, openFile);
  bindDragSource(tile, entry);

  return tile;
}

function createModelPreview(entry, {
  previewClass = 'hub-browser-preview',
  iconClass = 'hub-browser-icon',
  thumbClass = 'hub-browser-thumb',
  iconGlyph = '📄',
} = {}) {
  const name = String(entry?.name || '').trim();
  const displayName = getEntryModelDisplayName(entry) || name || 'Model';

  const preview = document.createElement('span');
  preview.className = previewClass;

  const icon = document.createElement('span');
  icon.className = iconClass;
  icon.textContent = iconGlyph;
  icon.setAttribute('aria-hidden', 'true');
  preview.appendChild(icon);

  const thumb = document.createElement('img');
  thumb.className = thumbClass;
  thumb.alt = `${displayName} preview`;
  thumb.addEventListener('load', () => preview.classList.add('has-thumb'));
  thumb.addEventListener('error', () => preview.classList.remove('has-thumb'));
  preview.appendChild(thumb);
  void hydrateThumbnail(entry, thumb);

  return preview;
}

function getRecordsForRoot(source, repoFull = '') {
  const src = normalizeStorageSource(source);
  const repo = String(repoFull || '').trim();
  return state.allRecords.filter((entry) => {
    if (normalizeStorageSource(entry?.source) !== src) return false;
    if (src === 'local') return true;
    return String(entry?.repoFull || '').trim() === repo;
  });
}

function getFoldersForRoot(source, repoFull = '') {
  const src = normalizeStorageSource(source);
  const repo = String(repoFull || '').trim();
  return state.folderRecords.filter((entry) => {
    if (normalizeStorageSource(entry?.source) !== src) return false;
    if (src === 'local') return true;
    return String(entry?.repoFull || '').trim() === repo;
  });
}

function createFolderExplorer(roots, term = '') {
  const listRoots = Array.isArray(roots) ? roots : [];
  const searchTerm = String(term || '').trim();
  const panel = document.createElement('section');
  panel.className = 'hub-explorer hub-browser';
  state.visibleExplorerEntryKeys = [];

  let widget = null;

  const mount = document.createElement('div');
  mount.className = 'hub-explorer-list';
  mount.style.minWidth = '0';
  panel.appendChild(mount);

  widget = new WorkspaceFileBrowserWidget({
    container: mount,
    onActivateFile: async (entry) => {
      const source = normalizeStorageSource(entry?.source);
      const repoFull = String(entry?.repoFull || '').trim();
      const branch = String(entry?.branch || '').trim();
      const path = getEntryCadLaunchModelPath(entry) || String(entry?.name || '').trim();
      goCad({ source, repoFull, branch, path });
    },
    onLocationChange: (location) => {
      state.explorerWorkspaceTop = !!location?.workspaceTop;
      state.explorerRootSource = normalizeStorageSource(location?.source || 'local');
      state.explorerRootRepoFull = String(location?.repoFull || '').trim();
      state.explorerPath = state.explorerWorkspaceTop ? '' : normalizePath(location?.path || '');
      saveExplorerLocationPreference();
      renderWorkspaceFoldersList(widget?.getRoots?.() || listRoots);
    },
    onViewModeChange: (mode) => {
      state.explorerViewMode = mode === 'icons' ? 'icons' : 'list';
      saveUiPreference(EXPLORER_VIEW_MODE_PREF_KEY, state.explorerViewMode);
    },
    onCreateFolder: async ({ targetPath, source, repoFull }) => {
      const rootSource = normalizeStorageSource(source || 'local');
      const rootRepoFull = rootSource === 'local' ? '' : String(repoFull || '').trim();
      if (isUiBusy()) return;
      if (rootSource === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
        throw new Error('Set a GitHub token in Settings before creating folders in repositories.');
      }
      setFilesStatus(`Creating folder "${targetPath}"...`, 'info');
      await runBusyUiTask(`Creating folder "${targetPath}"...`, async ({ setMessage }) => {
        setMessage(`Creating folder "${targetPath}"...`, 'Writing folder metadata...');
        await createWorkspaceFolder(targetPath, {
          source: rootSource,
          repoFull: rootRepoFull,
        });
        state.explorerWorkspaceTop = false;
        state.explorerRootSource = rootSource;
        state.explorerRootRepoFull = rootRepoFull;
        state.explorerPath = normalizePath(targetPath);
        saveExplorerLocationPreference();
        setMessage('Refreshing file index...', 'Updating folder and file listing...');
        await loadFiles();
        await waitForFilesIdle();
      });
      setFilesStatus(`Created folder "${targetPath}".`, 'ok');
    },
    onDeleteFolder: async ({ path, source, repoFull }) => {
      await deleteFolderPath(path, {
        source: normalizeStorageSource(source || 'local'),
        repoFull: String(repoFull || '').trim(),
      });
    },
    onEmptyTrash: async ({ files = [], folders = [] } = {}) => {
      await permanentlyDeleteEntries(files, {
        confirm: false,
        folderEntries: folders,
      });
    },
    createFileActionsMenu: (entry, { tile = false } = {}) => createFileActionsMenu(entry, {
      extraClass: tile ? 'hub-browser-tile-menu' : '',
    }),
    createFolderActionsMenu: (entry, { tile = false, source, repoFull } = {}) => createFolderActionsMenu(entry, {
      source: normalizeStorageSource(source || 'local'),
      repoFull: String(repoFull || '').trim(),
    }, {
      extraClass: tile ? 'hub-browser-tile-menu' : '',
    }),
    bindFileDragSource: (el, entry) => bindDragSource(el, entry),
    bindDropTarget: (el, target) => bindDropTarget(el, createEntryDropTarget(
      target?.source,
      target?.repoFull,
      target?.path,
    )),
    onDropFiles: async ({ files, target }) => {
      await importDesktopFilesToFolder(files, target, { refresh: true });
    },
    showSearchInput: false,
    showCreateFolderButton: true,
    showDeleteFolderButton: true,
    showEmptyTrashButton: true,
    showUpButton: true,
    showRefreshButton: false,
    fileActionLabel: 'Open',
    scrollBody: false,
  });
  state.explorerWidget = widget;
  widget.setData({
    records: state.allRecords,
    folders: state.folderRecords,
    roots: listRoots,
  }, { render: false });
  widget.setSearchTerm(searchTerm, { render: false, syncInput: true });
  widget.setViewMode(state.explorerViewMode, { persist: false });
  widget.setLocation({
    workspaceTop: !!state.explorerWorkspaceTop,
    source: state.explorerRootSource,
    repoFull: state.explorerRootRepoFull,
    path: state.explorerPath,
  }, { persist: false });
  renderWorkspaceFoldersList(widget.getRoots());
  return panel;
}

function renderWorkspaceFoldersList(roots) {
  const container = state.workspaceFoldersEl;
  if (!container) return;
  container.innerHTML = '';

  const list = Array.isArray(roots) ? roots : [];
  if (state.workspaceFoldersMetaEl) {
    state.workspaceFoldersMetaEl.textContent = `${list.length} folder${list.length === 1 ? '' : 's'}`;
  }

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'hub-empty';
    empty.textContent = 'No workspace folders configured yet. Add a repo or mount a folder to start browsing.';
    container.appendChild(empty);
    return;
  }

  const currentRootKey = state.explorerWorkspaceTop
    ? ''
    : makeRootKey(state.explorerRootSource, state.explorerRootRepoFull);
  for (const root of list) {
    container.appendChild(createFolderCard(root, {
      isSelected: !!currentRootKey && makeRootKey(root.source, root.repoFull) === currentRootKey,
      onOpen: () => setExplorerRoot(root.source, root.repoFull),
    }));
  }
}

function createFolderCard(root, { isSelected = false, onOpen = null } = {}) {
  const source = normalizeStorageSource(root?.source);
  const repoFull = String(root?.repoFull || '').trim();
  const trashRoot = isTrashRoot(source, repoFull) || !!root?.isTrash;
  const label = String(root?.label || getStorageRootLabel(source, repoFull)).trim() || 'Workspace';
  const isPrimary = !!root?.isPrimary && source === 'github';
  const isLocal = source === 'local' && !trashRoot;
  const isMounted = source === 'mounted' && !trashRoot;

  const card = document.createElement('button');
  card.type = 'button';
  card.className = `hub-folder-card${isPrimary ? ' is-primary' : ''}${isSelected ? ' is-selected' : ''}`;
  if (typeof onOpen === 'function') card.addEventListener('click', onOpen);

  const icon = document.createElement('div');
  icon.className = 'hub-folder-card-icon';
  icon.textContent = trashRoot ? '🗑️' : '📁';
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'hub-folder-card-body';
  const name = document.createElement('div');
  name.className = 'hub-folder-card-name';
  name.textContent = label;
  name.title = label;
  body.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'hub-folder-card-meta';
  if (trashRoot) {
    meta.textContent = isSelected ? 'Internal trash · browsing' : 'Internal trash';
  } else if (isLocal) {
    meta.textContent = isSelected ? 'Local workspace · browsing' : 'Local workspace';
  } else if (isMounted) {
    meta.textContent = isSelected ? 'Mounted folder · browsing' : 'Mounted folder';
  } else if (isPrimary) {
    meta.textContent = isSelected ? 'Primary workspace repo · browsing' : 'Primary workspace repo';
  } else {
    meta.textContent = isSelected ? 'Workspace repo · browsing' : 'Workspace repo';
  }
  body.appendChild(meta);
  card.appendChild(body);

  return card;
}

function closeActiveFileMenu() {
  if (typeof state.activeFileMenuClose !== 'function') return;
  const close = state.activeFileMenuClose;
  state.activeFileMenuClose = null;
  try {
    close();
  } catch {
    // Ignore close handler failures.
  }
}

function createFloatingActionsMenu(actions = [], options = {}) {
  const extraClass = String(options?.extraClass || '').trim();
  const triggerTitle = String(options?.triggerTitle || 'Actions').trim() || 'Actions';
  const wrapper = document.createElement('div');
  wrapper.className = extraClass ? `hub-file-menu ${extraClass}` : 'hub-file-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'hub-icon-btn hub-file-menu-trigger';
  trigger.textContent = '...';
  trigger.title = triggerTitle;
  trigger.setAttribute('aria-label', triggerTitle);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  wrapper.appendChild(trigger);

  const menu = document.createElement('div');
  menu.className = 'hub-file-menu-list';
  menu.setAttribute('role', 'menu');
  wrapper.appendChild(menu);

  let open = false;
  let removeOutsideHandlers = null;
  const attachMenuToBody = () => {
    if (menu.parentNode !== document.body) document.body.appendChild(menu);
  };
  const attachMenuToWrapper = () => {
    if (menu.parentNode !== wrapper) wrapper.appendChild(menu);
  };

  const positionMenu = () => {
    if (!open) return;
    const margin = 8;
    attachMenuToBody();
    menu.classList.add('is-open');
    menu.classList.add('is-floating');
    menu.style.maxHeight = `${Math.max(140, window.innerHeight - (margin * 2))}px`;
    menu.style.overflowY = 'auto';

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = Math.max(136, Math.ceil(menuRect.width || menu.offsetWidth || 136));
    const menuHeight = Math.ceil(menuRect.height || menu.offsetHeight || 0);

    let left = triggerRect.right - menuWidth;
    if (left < margin) left = margin;
    if ((left + menuWidth) > (window.innerWidth - margin)) {
      left = Math.max(margin, window.innerWidth - margin - menuWidth);
    }

    let top = triggerRect.bottom + 6;
    if ((top + menuHeight) > (window.innerHeight - margin)) {
      const aboveTop = triggerRect.top - 6 - menuHeight;
      if (aboveTop >= margin) top = aboveTop;
      else top = Math.max(margin, window.innerHeight - margin - menuHeight);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.right = 'auto';
  };

  const closeMenu = () => {
    if (!open) return;
    open = false;
    wrapper.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
    menu.classList.remove('is-floating');
    menu.style.left = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.maxHeight = '';
    menu.style.overflowY = '';
    attachMenuToWrapper();
    if (typeof removeOutsideHandlers === 'function') {
      removeOutsideHandlers();
      removeOutsideHandlers = null;
    }
    if (state.activeFileMenuClose === closeMenu) {
      state.activeFileMenuClose = null;
    }
  };

  const openMenu = () => {
    if (open) return;
    closeActiveFileMenu();
    open = true;
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    state.activeFileMenuClose = closeMenu;
    positionMenu();

    const onPointerDown = (event) => {
      if (wrapper.contains(event?.target) || menu.contains(event?.target)) return;
      closeMenu();
    };
    const onKeyDown = (event) => {
      if (event?.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };
    const onViewportChange = () => {
      if (!open) return;
      positionMenu();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onViewportChange, true);
    window.addEventListener('scroll', onViewportChange, true);
    removeOutsideHandlers = () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onViewportChange, true);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  };

  trigger.addEventListener('click', (event) => {
    if (isUiBusy()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (open) closeMenu();
    else openMenu();
  });

  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || typeof action !== 'object') continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = String(action.className || 'hub-file-menu-item');
    item.textContent = String(action.label || '').trim() || 'Action';
    item.setAttribute('role', 'menuitem');
    if (action.disabled) {
      item.disabled = true;
      item.title = String(action.disabledTitle || 'Unavailable');
    }
    item.addEventListener('click', (event) => {
      if (isUiBusy()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (action.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      if (typeof action.run === 'function') action.run();
    });
    menu.appendChild(item);
  }

  return wrapper;
}

function getFolderScopeOptions(source, repoFull = '') {
  const normalizedSource = normalizeStorageSource(source);
  const normalizedRepoFull = String(repoFull || '').trim();
  const scope = {
    source: normalizedSource,
    repoFull: normalizedRepoFull,
  };
  if (normalizedSource === 'github') {
    const branch = String(getGithubStorageConfig()?.branch || '').trim();
    if (branch) scope.branch = branch;
  }
  return scope;
}

function makeStorageScopeKey(source, repoFull = '') {
  return `${normalizeStorageSource(source)}::${String(repoFull || '').trim()}`;
}

function collectTrashScopes(fileEntries = [], folderEntries = []) {
  const scopeMap = new Map();
  const addScope = (source, repoFull) => {
    const normalizedSource = normalizeStorageSource(source || 'local');
    const normalizedRepoFull = String(repoFull || '').trim();
    const key = makeStorageScopeKey(normalizedSource, normalizedRepoFull);
    if (scopeMap.has(key)) return;
    scopeMap.set(key, {
      source: normalizedSource,
      repoFull: normalizedRepoFull,
    });
  };

  for (const entry of Array.isArray(fileEntries) ? fileEntries : []) {
    const path = getEntryModelPath(entry);
    if (!isTrashPath(path)) continue;
    addScope(entry?.source, entry?.repoFull);
  }
  for (const folder of Array.isArray(folderEntries) ? folderEntries : []) {
    const path = normalizePath(folder?.path || '');
    if (!isTrashPath(path)) continue;
    addScope(folder?.source, folder?.repoFull);
  }

  return Array.from(scopeMap.values());
}

function hasTrashFilesInScope(source, repoFull = '') {
  const normalizedSource = normalizeStorageSource(source || 'local');
  const normalizedRepoFull = String(repoFull || '').trim();
  return state.allRecords.some((entry) => {
    const entrySource = normalizeStorageSource(entry?.source || 'local');
    if (entrySource !== normalizedSource) return false;
    if (entrySource !== 'local' && String(entry?.repoFull || '').trim() !== normalizedRepoFull) return false;
    const path = getEntryBrowserPath(entry);
    return isTrashPath(path);
  });
}

function getTrashFolderPathsInScope(source, repoFull = '') {
  const normalizedSource = normalizeStorageSource(source || 'local');
  const normalizedRepoFull = String(repoFull || '').trim();
  const paths = state.folderRecords
    .filter((entry) => {
      const entrySource = normalizeStorageSource(entry?.source || 'local');
      if (entrySource !== normalizedSource) return false;
      if (entrySource !== 'local' && String(entry?.repoFull || '').trim() !== normalizedRepoFull) return false;
      return isTrashPath(entry?.path || '');
    })
    .map((entry) => normalizePath(entry?.path || ''))
    .filter(Boolean);
  if (!paths.includes(TRASH_FOLDER_NAME)) paths.push(TRASH_FOLDER_NAME);
  return Array.from(new Set(paths)).sort((a, b) => b.length - a.length);
}

async function cleanupEmptyTrashFolders(scopes = [], { setMessage = null } = {}) {
  const uniqueScopes = Array.isArray(scopes) ? scopes : [];
  if (!uniqueScopes.length) return 0;
  let removedMarkers = 0;

  for (const scope of uniqueScopes) {
    const source = normalizeStorageSource(scope?.source || 'local');
    const repoFull = String(scope?.repoFull || '').trim();
    if (source === 'github' && getRepoReadOnlyStatus(repoFull)) continue;
    if (hasTrashFilesInScope(source, repoFull)) continue;
    const folderPaths = getTrashFolderPathsInScope(source, repoFull);
    if (!folderPaths.length) continue;
    for (let index = 0; index < folderPaths.length; index += 1) {
      const path = folderPaths[index];
      if (typeof setMessage === 'function') {
        setMessage(
          'Cleaning empty Trash...',
          `Removing marker ${index + 1}/${folderPaths.length}: ${path}`,
        );
      }
      try {
        await removeWorkspaceFolder(path, getFolderScopeOptions(source, repoFull));
        removedMarkers += 1;
      } catch {
        // Ignore missing marker cleanup failures.
      }
    }
  }

  return removedMarkers;
}

function collectFolderSubtree(source, repoFull = '', folderPath = '') {
  const normalizedSource = normalizeStorageSource(source);
  const normalizedRepoFull = String(repoFull || '').trim();
  const normalizedFolderPath = normalizePath(folderPath);
  const prefix = normalizedFolderPath ? `${normalizedFolderPath}/` : '';
  const scopedRecords = getRecordsForRoot(normalizedSource, normalizedRepoFull);
  const scopedFolders = getFoldersForRoot(normalizedSource, normalizedRepoFull);

  const records = scopedRecords.filter((entry) => {
    const pathValue = getEntryBrowserPath(entry);
    return pathValue === normalizedFolderPath || pathValue.startsWith(prefix);
  });

  const folderPaths = scopedFolders
    .map((entry) => normalizePath(entry?.path || ''))
    .filter((pathValue) => pathValue && (pathValue === normalizedFolderPath || pathValue.startsWith(prefix)));
  if (normalizedFolderPath && !folderPaths.includes(normalizedFolderPath)) folderPaths.push(normalizedFolderPath);

  return {
    records,
    folderPaths: Array.from(new Set(folderPaths)),
  };
}

async function deleteFolderPath(folderPathRaw, options = {}) {
  if (isUiBusy()) return;
  const folderPath = normalizePath(folderPathRaw);
  if (!folderPath) return;
  const source = normalizeStorageSource(options?.source || state.explorerRootSource);
  const repoFull = String(options?.repoFull || state.explorerRootRepoFull || '').trim();
  if (source === 'github' && getRepoReadOnlyStatus(repoFull)) {
    setFilesStatus(`Repository "${repoFull}" is read-only.`, 'warn');
    return;
  }

  const { records, folderPaths } = collectFolderSubtree(source, repoFull, folderPath);
  const totalFiles = records.length;
  const totalMarkers = folderPaths.length;
  if (!totalFiles && !totalMarkers) {
    setFilesStatus(`Folder "${folderPath}" has no managed files to delete.`, 'warn');
    return;
  }

  const proceed = await confirm(
    `Delete folder "${folderPath}"?\n\nThis will remove ${totalFiles} file${totalFiles === 1 ? '' : 's'} and ${totalMarkers} managed folder marker${totalMarkers === 1 ? '' : 's'}.`,
  );
  if (!proceed) return;

  const folderScope = getFolderScopeOptions(source, repoFull);
  let fileDeleteFailures = 0;
  let folderDeletes = 0;

  try {
    setFilesStatus(`Deleting folder "${folderPath}"...`, 'info');
    await runBusyUiTask(`Deleting folder "${folderPath}"...`, async ({ setMessage }) => {
      for (let index = 0; index < records.length; index += 1) {
        const rec = records[index];
        const recPath = normalizePath(rec?.path || rec?.name || '');
        setMessage(
          `Deleting folder "${folderPath}"...`,
          `Removing file ${index + 1}/${records.length}: ${recPath || 'Unknown file'}`,
        );
        try {
          await removeComponentRecord(rec.path || rec.name, buildEntryScope(rec));
          state.thumbCache.delete(getEntryCacheKey(rec));
        } catch {
          fileDeleteFailures += 1;
        }
      }
      folderPaths.sort((a, b) => b.length - a.length);
      for (let index = 0; index < folderPaths.length; index += 1) {
        const targetFolderPath = folderPaths[index];
        setMessage(
          `Deleting folder "${folderPath}"...`,
          `Removing folder marker ${index + 1}/${folderPaths.length}: ${targetFolderPath}`,
        );
        try {
          await removeWorkspaceFolder(targetFolderPath, folderScope);
          folderDeletes += 1;
        } catch {
          // Ignore missing marker files.
        }
      }

      if (!state.explorerWorkspaceTop
        && normalizeStorageSource(state.explorerRootSource) === source
        && String(state.explorerRootRepoFull || '').trim() === repoFull) {
        const currentPath = normalizePath(state.explorerPath || '');
        const prefix = `${folderPath}/`;
        if (currentPath === folderPath || currentPath.startsWith(prefix)) {
          const idx = folderPath.lastIndexOf('/');
          state.explorerPath = idx >= 0 ? folderPath.slice(0, idx) : '';
          saveExplorerLocationPreference();
        }
      }

      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    });
    if (fileDeleteFailures) {
      setFilesStatus(`Deleted folder "${folderPath}" with ${fileDeleteFailures} file deletion failure${fileDeleteFailures === 1 ? '' : 's'}.`, 'warn');
    } else {
      setFilesStatus(`Deleted folder "${folderPath}". Removed ${totalFiles} file${totalFiles === 1 ? '' : 's'} and ${folderDeletes} folder marker${folderDeletes === 1 ? '' : 's'}.`, 'ok');
    }
  } catch (err) {
    setFilesStatus(`Delete folder failed: ${errorMessage(err)}`, 'error');
  }
}

async function renameFolderPath(folderPathRaw, options = {}) {
  if (isUiBusy()) return;
  const folderPath = normalizePath(folderPathRaw);
  if (!folderPath) return;
  const source = normalizeStorageSource(options?.source || state.explorerRootSource);
  const repoFull = String(options?.repoFull || state.explorerRootRepoFull || '').trim();
  if (source === 'github' && getRepoReadOnlyStatus(repoFull)) {
    setFilesStatus(`Repository "${repoFull}" is read-only.`, 'warn');
    return;
  }

  const entered = await prompt('Rename folder path:', folderPath);
  if (entered == null) return;
  const nextPath = normalizePath(String(entered || '').trim());
  if (!nextPath || nextPath === folderPath) return;
  if (nextPath.startsWith(`${folderPath}/`)) {
    setFilesStatus('Cannot move a folder inside itself.', 'warn');
    return;
  }

  const scopedRecords = getRecordsForRoot(source, repoFull);
  const scopedFolders = getFoldersForRoot(source, repoFull);
  const nextPrefix = `${nextPath}/`;
  const hasConflict = scopedRecords.some((entry) => {
    const pathValue = normalizePath(getEntryBrowserPath(entry));
    return pathValue === nextPath || pathValue.startsWith(nextPrefix);
  }) || scopedFolders.some((entry) => {
    const pathValue = normalizePath(entry?.path || '');
    return pathValue === nextPath || pathValue.startsWith(nextPrefix);
  });
  if (hasConflict) {
    setFilesStatus(`Target folder "${nextPath}" already exists.`, 'warn');
    return;
  }

  const { records, folderPaths } = collectFolderSubtree(source, repoFull, folderPath);
  const prefix = `${folderPath}/`;
  const folderScope = getFolderScopeOptions(source, repoFull);
  let moved = 0;
  let failed = 0;

  try {
    setFilesStatus(`Renaming folder "${folderPath}" to "${nextPath}"...`, 'info');
    await runBusyUiTask(`Renaming folder "${folderPath}"...`, async ({ setMessage }) => {
      const sortedFolderPaths = folderPaths.slice().sort((a, b) => a.length - b.length);
      for (let index = 0; index < sortedFolderPaths.length; index += 1) {
        const oldFolderPath = sortedFolderPaths[index];
        const suffix = oldFolderPath === folderPath ? '' : oldFolderPath.slice(prefix.length);
        const newFolderPath = normalizePath(suffix ? `${nextPath}/${suffix}` : nextPath);
        if (!newFolderPath) continue;
        setMessage(
          `Renaming folder "${folderPath}"...`,
          `Preparing folder marker ${index + 1}/${sortedFolderPaths.length}: ${newFolderPath}`,
        );
        try {
          await createWorkspaceFolder(newFolderPath, folderScope);
        } catch {
          // Ignore marker create failures; file moves may still succeed.
        }
      }

      for (let index = 0; index < records.length; index += 1) {
        const rec = records[index];
        const oldPath = getEntryModelPath(rec) || normalizePath(getEntryName(rec));
        if (!oldPath) {
          failed += 1;
          continue;
        }
        const suffix = oldPath === folderPath ? '' : oldPath.slice(prefix.length);
        const newPath = normalizePath(suffix ? `${nextPath}/${suffix}` : nextPath);
        if (!newPath) {
          failed += 1;
          continue;
        }

        setMessage(
          `Renaming folder "${folderPath}"...`,
          `Moving file ${index + 1}/${records.length}: ${oldPath}`,
        );
        try {
          const full = await getComponentRecord(oldPath, buildEntryScope(rec));
          if (!full || !full.data3mf) {
            failed += 1;
            continue;
          }
          await setComponentRecord(newPath, {
            savedAt: new Date().toISOString(),
            data3mf: full.data3mf,
            data: full.data,
            thumbnail: full.thumbnail || null,
          }, {
            ...buildEntryScope(rec),
            source,
            repoFull,
            path: newPath,
          });
          await removeComponentRecord(oldPath, buildEntryScope(rec));

          const oldCacheKey = getEntryCacheKey({ source, repoFull, name: oldPath });
          const newCacheKey = getEntryCacheKey({ source, repoFull, name: newPath });
          const cached = state.thumbCache.get(oldCacheKey);
          if (cached) {
            state.thumbCache.set(newCacheKey, cached);
            state.thumbCache.delete(oldCacheKey);
          }
          moved += 1;
        } catch {
          failed += 1;
        }
      }

      const reverseFolderPaths = folderPaths.slice().sort((a, b) => b.length - a.length);
      for (let index = 0; index < reverseFolderPaths.length; index += 1) {
        const oldFolderPath = reverseFolderPaths[index];
        setMessage(
          `Renaming folder "${folderPath}"...`,
          `Cleaning old marker ${index + 1}/${reverseFolderPaths.length}: ${oldFolderPath}`,
        );
        try {
          await removeWorkspaceFolder(oldFolderPath, folderScope);
        } catch {
          // Ignore missing marker files.
        }
      }

      if (!state.explorerWorkspaceTop
        && normalizeStorageSource(state.explorerRootSource) === source
        && String(state.explorerRootRepoFull || '').trim() === repoFull) {
        const currentPath = normalizePath(state.explorerPath || '');
        if (currentPath === folderPath || currentPath.startsWith(prefix)) {
          const suffix = currentPath === folderPath ? '' : currentPath.slice(prefix.length);
          state.explorerPath = normalizePath(suffix ? `${nextPath}/${suffix}` : nextPath);
          saveExplorerLocationPreference();
        }
      }

      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    });
    if (failed) {
      setFilesStatus(`Folder rename completed with ${failed} failure${failed === 1 ? '' : 's'}.`, 'warn');
    } else {
      setFilesStatus(`Renamed folder to "${nextPath}". Moved ${moved} file${moved === 1 ? '' : 's'}.`, 'ok');
    }
  } catch (err) {
    setFilesStatus(`Rename folder failed: ${errorMessage(err)}`, 'error');
  }
}

function getParentPath(pathValue = '') {
  const clean = normalizePath(pathValue);
  if (!clean) return '';
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(0, idx) : '';
}

function getBaseName(pathValue = '') {
  const clean = normalizePath(pathValue);
  if (!clean) return '';
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function getFileScopeOptions(source, repoFull = '', path = '') {
  const scope = getFolderScopeOptions(source, repoFull);
  const cleanPath = normalizePath(path);
  if (cleanPath) scope.path = cleanPath;
  return scope;
}

function normalizeTargetName(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (raw.includes('/') || raw.includes('\\')) return '';
  return normalizePath(raw);
}

async function openTransferBrowserDialog({
  title = 'Transfer',
  actionLabel = 'Apply',
  nameLabel = 'Name',
  initialName = '',
  initialLocation = {},
  description = '',
} = {}) {
  return await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.hidden = false;

    const panel = document.createElement('section');
    panel.className = 'hub-panel hub-modal-panel hub-workspace-panel';
    panel.style.width = 'min(1180px, calc(100vw - 48px))';
    panel.style.maxHeight = 'calc(100vh - 40px)';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '10px';
    panel.style.overflow = 'hidden';
    overlay.appendChild(panel);

    const head = document.createElement('div');
    head.className = 'hub-panel-head';
    const titleEl = document.createElement('h2');
    titleEl.className = 'hub-panel-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hub-ghost-btn';
    closeBtn.textContent = 'Cancel';
    head.appendChild(closeBtn);
    panel.appendChild(head);

    if (description) {
      const descEl = document.createElement('p');
      descEl.className = 'hub-help';
      descEl.textContent = description;
      panel.appendChild(descEl);
    }

    const field = document.createElement('label');
    field.className = 'hub-field';
    const fieldLabel = document.createElement('span');
    fieldLabel.className = 'hub-field-label';
    fieldLabel.textContent = nameLabel;
    field.appendChild(fieldLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'hub-input';
    nameInput.value = String(initialName || '').trim();
    nameInput.placeholder = nameLabel;
    field.appendChild(nameInput);
    panel.appendChild(field);

    const destinationMeta = document.createElement('div');
    destinationMeta.className = 'hub-help';
    panel.appendChild(destinationMeta);

    const statusEl = document.createElement('div');
    statusEl.className = 'hub-status';
    statusEl.hidden = true;
    panel.appendChild(statusEl);

    const browserHost = document.createElement('div');
    browserHost.style.minHeight = '320px';
    browserHost.style.height = 'min(56vh, 520px)';
    browserHost.style.maxHeight = '56vh';
    browserHost.style.overflow = 'hidden';
    panel.appendChild(browserHost);

    const actions = document.createElement('div');
    actions.className = 'hub-actions-row';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'hub-primary-btn';
    submitBtn.textContent = actionLabel;
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'hub-ghost-btn';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    panel.appendChild(actions);

    document.body.appendChild(overlay);

    let closed = false;
    let widget = null;

    const setDialogStatus = (message = '', tone = 'warn') => {
      const text = String(message || '').trim();
      if (!text) {
        statusEl.hidden = true;
        statusEl.textContent = '';
        statusEl.dataset.tone = '';
        return;
      }
      statusEl.hidden = false;
      statusEl.textContent = text;
      statusEl.dataset.tone = tone;
    };

    const updateDestinationMeta = () => {
      if (!widget) return;
      const location = widget.getLocation();
      const source = normalizeStorageSource(location?.source || 'local');
      const repoFull = source === 'local'
        ? ''
        : String(location?.repoFull || '').trim();
      const path = normalizePath(location?.path || '');
      const isWorkspaceTop = !!location?.workspaceTop;
      const targetLabel = [
        getStorageRootLabel(source, repoFull),
        path || '(root)',
      ].join(' / ');
      destinationMeta.textContent = isWorkspaceTop
        ? 'Destination: select a workspace root or folder.'
        : `Destination: ${targetLabel}`;
      const invalidTarget = isWorkspaceTop || isTrashRoot(source, repoFull) || isTrashPath(path);
      submitBtn.disabled = invalidTarget;
    };

    const close = (value = null) => {
      if (closed) return;
      closed = true;
      try { window.removeEventListener('keydown', onKeyDown, true); } catch { /* ignore */ }
      try { widget?.destroy?.(); } catch { /* ignore */ }
      try { overlay.remove(); } catch { /* ignore */ }
      resolve(value);
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(null);
    };
    window.addEventListener('keydown', onKeyDown, true);

    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      close(null);
    });
    closeBtn.addEventListener('click', () => close(null));
    cancelBtn.addEventListener('click', () => close(null));

    submitBtn.addEventListener('click', () => {
      if (!widget) return;
      const location = widget.getLocation();
      const source = normalizeStorageSource(location?.source || 'local');
      const repoFull = source === 'local'
        ? ''
        : String(location?.repoFull || '').trim();
      const path = normalizePath(location?.path || '');
      const nextName = normalizeTargetName(nameInput.value || '');
      if (!nextName) {
        setDialogStatus(`${nameLabel} is required and cannot include path separators.`, 'warn');
        return;
      }
      if (location?.workspaceTop) {
        setDialogStatus('Select a destination root or folder.', 'warn');
        return;
      }
      if (isTrashRoot(source, repoFull) || isTrashPath(path)) {
        setDialogStatus('Moving/copying into Trash is not allowed in this dialog.', 'warn');
        return;
      }
      if (source !== 'local' && !repoFull) {
        setDialogStatus('Select a valid destination root.', 'warn');
        return;
      }
      close({
        source,
        repoFull,
        path,
        name: nextName,
      });
    });

    widget = new WorkspaceFileBrowserWidget({
      container: browserHost,
      onLocationChange: () => {
        setDialogStatus('', 'warn');
        updateDestinationMeta();
      },
      onCreateFolder: async ({ targetPath, source, repoFull }) => {
        const rootSource = normalizeStorageSource(source || 'local');
        const rootRepoFull = rootSource === 'local' ? '' : String(repoFull || '').trim();
        if (rootSource === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
          throw new Error('Set a GitHub token in Settings before creating folders in repositories.');
        }
        if (rootSource === 'github' && getRepoReadOnlyStatus(rootRepoFull)) {
          throw new Error(`Repository "${rootRepoFull}" is read-only.`);
        }
        await createWorkspaceFolder(targetPath, {
          source: rootSource,
          repoFull: rootRepoFull,
        });
        await loadFiles();
        await waitForFilesIdle();
        widget.setData({
          records: state.allRecords,
          folders: state.folderRecords,
          roots: makeWorkspaceRoots(),
        }, { render: false });
        widget.setLocation({
          workspaceTop: false,
          source: rootSource,
          repoFull: rootRepoFull,
          path: normalizePath(targetPath),
        }, { persist: false });
      },
      onDropFiles: async ({ files, target }) => {
        setDialogStatus('', 'warn');
        await importDesktopFilesToFolder(files, target, { refresh: true });
        const currentLocation = widget?.getLocation?.() || {
          workspaceTop: false,
          source: normalizeStorageSource(target?.source || 'local'),
          repoFull: String(target?.repoFull || '').trim(),
          path: normalizePath(target?.path || ''),
        };
        const nextLocation = currentLocation.workspaceTop
          ? {
              workspaceTop: false,
              source: normalizeStorageSource(target?.source || 'local'),
              repoFull: String(target?.repoFull || '').trim(),
              path: normalizePath(target?.path || ''),
            }
          : currentLocation;
        widget.setData({
          records: state.allRecords,
          folders: state.folderRecords,
          roots: makeWorkspaceRoots(),
        }, { render: false });
        widget.setLocation({
          workspaceTop: !!nextLocation.workspaceTop,
          source: normalizeStorageSource(nextLocation.source || 'local'),
          repoFull: String(nextLocation.repoFull || '').trim(),
          path: normalizePath(nextLocation.path || ''),
        }, { persist: false });
        updateDestinationMeta();
      },
      showSearchInput: true,
      showViewToggle: true,
      showCreateFolderButton: true,
      showDeleteFolderButton: false,
      showEmptyTrashButton: false,
      showUpButton: true,
      showRefreshButton: true,
      fileActionLabel: 'Open',
      scrollBody: true,
    });

    try {
      // Avoid mutating the persisted explorer location while using the transfer dialog.
      widget._saveLocationPreference = () => {};
    } catch { /* ignore */ }

    const roots = makeWorkspaceRoots();
    widget.setData({
      records: state.allRecords,
      folders: state.folderRecords,
      roots,
    }, { render: false });

    const defaultSource = normalizeStorageSource(initialLocation?.source || 'local');
    const defaultRepoFull = defaultSource === 'local'
      ? ''
      : String(initialLocation?.repoFull || '').trim();
    const defaultPath = normalizePath(initialLocation?.path || '');
    widget.setLocation({
      workspaceTop: false,
      source: defaultSource,
      repoFull: defaultRepoFull,
      path: defaultPath,
    }, { persist: false });

    updateDestinationMeta();
    setTimeout(() => {
      try { nameInput.focus({ preventScroll: true }); } catch { /* ignore */ }
      try { nameInput.select(); } catch { /* ignore */ }
    }, 0);
  });
}

async function runFileTransferAction(entry, { copy = true } = {}) {
  if (isUiBusy()) return;
  const sourcePath = getEntryModelPath(entry);
  if (!sourcePath) {
    setFilesStatus('File path is missing.', 'warn');
    return;
  }
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  if (!copy && source === 'github' && getRepoReadOnlyStatus(repoFull)) {
    setFilesStatus(`Cannot move from read-only repository "${repoFull}".`, 'warn');
    return;
  }

  const picked = await openTransferBrowserDialog({
    title: copy ? 'Copy File To...' : 'Move File To...',
    actionLabel: copy ? 'Copy File' : 'Move File',
    nameLabel: 'File Name',
    initialName: getBaseName(sourcePath) || getEntryModelDisplayName(entry),
    initialLocation: {
      workspaceTop: false,
      source,
      repoFull,
      path: getParentPath(sourcePath),
    },
    description: 'Choose a destination folder, then set the file name.',
  });
  if (!picked) return;

  const targetSource = normalizeStorageSource(picked.source || 'local');
  const targetRepoFull = targetSource === 'local' ? '' : String(picked.repoFull || '').trim();
  const targetFolderPath = normalizePath(picked.path || '');
  const targetName = normalizeTargetName(picked.name || '');
  const targetPath = normalizePath(targetFolderPath ? `${targetFolderPath}/${targetName}` : targetName);

  if (!targetPath) {
    setFilesStatus('Destination file path is invalid.', 'warn');
    return;
  }
  if (targetSource !== 'local' && !targetRepoFull) {
    setFilesStatus('Destination root is missing.', 'warn');
    return;
  }
  if (targetSource === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
    setFilesStatus('Set a GitHub token in Settings before writing to repositories.', 'warn');
    return;
  }
  if (targetSource === 'github' && getRepoReadOnlyStatus(targetRepoFull)) {
    setFilesStatus(`Repository "${targetRepoFull}" is read-only.`, 'warn');
    return;
  }

  const sameDestination = source === targetSource
    && repoFull === targetRepoFull
    && sourcePath === targetPath;
  if (sameDestination) {
    setFilesStatus('Source and destination are the same.', 'warn');
    return;
  }

  const actionLabel = copy ? 'Copy' : 'Move';
  let cancelled = false;
  const touchedTrashScopes = collectTrashScopes([entry], []);
  try {
    await runBusyUiTask(`${actionLabel} file...`, async ({ setMessage }) => {
      const sourceScope = getFileScopeOptions(source, repoFull, sourcePath);
      const targetScope = getFileScopeOptions(targetSource, targetRepoFull, targetPath);

      setMessage(`${actionLabel} file...`, `Reading: ${sourcePath}`);
      const rec = await getComponentRecord(sourcePath, sourceScope);
      if (!rec || !rec.data3mf) {
        throw new Error(`File not found: ${sourcePath}`);
      }

      setMessage(`${actionLabel} file...`, `Checking destination: ${targetPath}`);
      const existing = await getComponentRecord(targetPath, targetScope);
      if (existing) {
        const overwrite = await confirm(`"${targetPath}" already exists. Overwrite it?`);
        if (!overwrite) {
          cancelled = true;
          return;
        }
      }

      setMessage(`${actionLabel} file...`, `Writing: ${targetPath}`);
      await setComponentRecord(targetPath, {
        savedAt: new Date().toISOString(),
        data3mf: rec.data3mf,
        data: rec.data,
        thumbnail: rec.thumbnail || null,
      }, targetScope);

      if (!copy) {
        setMessage(`${actionLabel} file...`, `Removing source: ${sourcePath}`);
        await removeComponentRecord(sourcePath, sourceScope);
        state.thumbCache.delete(getEntryCacheKey(entry));
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();

      const cleanedMarkers = await cleanupEmptyTrashFolders(touchedTrashScopes, { setMessage });
      if (cleanedMarkers > 0) {
        setMessage('Refreshing file index...', 'Finalizing Trash folder cleanup...');
        await loadFiles();
        await waitForFilesIdle();
      }
    }, {
      detail: `${sourcePath} -> ${targetPath}`,
    });
  } catch (err) {
    setFilesStatus(`${actionLabel} failed: ${errorMessage(err)}`, 'error');
    return;
  }

  if (cancelled) {
    setFilesStatus(`${actionLabel} cancelled.`, 'warn');
    return;
  }
  setFilesStatus(`${actionLabel} complete: "${targetPath}".`, 'ok');
}

async function runFolderTransferAction(folderEntry, options = {}) {
  if (isUiBusy()) return;
  const sourceFolderPath = normalizePath(folderEntry?.path || '');
  if (!sourceFolderPath) {
    setFilesStatus('Folder path is missing.', 'warn');
    return;
  }

  const source = normalizeStorageSource(options?.source || state.explorerRootSource || 'local');
  const repoFull = String(options?.repoFull || state.explorerRootRepoFull || '').trim();
  const copy = options?.copy !== false;
  if (!copy && source === 'github' && getRepoReadOnlyStatus(repoFull)) {
    setFilesStatus(`Cannot move from read-only repository "${repoFull}".`, 'warn');
    return;
  }

  const picked = await openTransferBrowserDialog({
    title: copy ? 'Copy Folder To...' : 'Move Folder To...',
    actionLabel: copy ? 'Copy Folder' : 'Move Folder',
    nameLabel: 'Folder Name',
    initialName: getBaseName(sourceFolderPath),
    initialLocation: {
      workspaceTop: false,
      source,
      repoFull,
      path: getParentPath(sourceFolderPath),
    },
    description: 'Choose a destination folder, then set the folder name.',
  });
  if (!picked) return;

  const targetSource = normalizeStorageSource(picked.source || 'local');
  const targetRepoFull = targetSource === 'local' ? '' : String(picked.repoFull || '').trim();
  const targetParentPath = normalizePath(picked.path || '');
  const targetFolderName = normalizeTargetName(picked.name || '');
  const targetFolderPath = normalizePath(targetParentPath ? `${targetParentPath}/${targetFolderName}` : targetFolderName);
  if (!targetFolderPath) {
    setFilesStatus('Destination folder path is invalid.', 'warn');
    return;
  }
  if (targetSource !== 'local' && !targetRepoFull) {
    setFilesStatus('Destination root is missing.', 'warn');
    return;
  }
  if (targetSource === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
    setFilesStatus('Set a GitHub token in Settings before writing to repositories.', 'warn');
    return;
  }
  if (targetSource === 'github' && getRepoReadOnlyStatus(targetRepoFull)) {
    setFilesStatus(`Repository "${targetRepoFull}" is read-only.`, 'warn');
    return;
  }

  const sameDestination = source === targetSource
    && repoFull === targetRepoFull
    && sourceFolderPath === targetFolderPath;
  if (sameDestination) {
    setFilesStatus('Source and destination are the same.', 'warn');
    return;
  }
  if (!copy
    && source === targetSource
    && repoFull === targetRepoFull
    && targetFolderPath.startsWith(`${sourceFolderPath}/`)) {
    setFilesStatus('Cannot move a folder inside itself.', 'warn');
    return;
  }

  const { records, folderPaths } = collectFolderSubtree(source, repoFull, sourceFolderPath);
  if (!records.length && !folderPaths.length) {
    setFilesStatus(`Folder "${sourceFolderPath}" has no managed content to transfer.`, 'warn');
    return;
  }

  const actionLabel = copy ? 'Copy' : 'Move';
  let copied = 0;
  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const touchedTrashScopes = collectTrashScopes(records, [{ source, repoFull, path: sourceFolderPath }]);
  try {
    await runBusyUiTask(`${actionLabel} folder...`, async ({ setMessage }) => {
      const sourcePrefix = `${sourceFolderPath}/`;
      const sortedFolderPaths = folderPaths.slice().sort((a, b) => a.length - b.length);
      for (let index = 0; index < sortedFolderPaths.length; index += 1) {
        const oldFolderPath = sortedFolderPaths[index];
        const suffix = oldFolderPath === sourceFolderPath ? '' : oldFolderPath.slice(sourcePrefix.length);
        const newFolderPath = normalizePath(suffix ? `${targetFolderPath}/${suffix}` : targetFolderPath);
        if (!newFolderPath) continue;
        setMessage(
          `${actionLabel} folder...`,
          `Preparing destination folder ${index + 1}/${sortedFolderPaths.length}: ${newFolderPath}`,
        );
        try {
          await createWorkspaceFolder(newFolderPath, getFolderScopeOptions(targetSource, targetRepoFull));
        } catch {
          // Ignore marker create failures; file copy/move may still succeed.
        }
      }

      const sortedRecords = records.slice().sort((a, b) =>
        String(getEntryModelPath(a) || '').localeCompare(String(getEntryModelPath(b) || '')),
      );
      for (let index = 0; index < sortedRecords.length; index += 1) {
        const rec = sortedRecords[index];
        const oldPath = getEntryModelPath(rec);
        if (!oldPath) {
          skipped += 1;
          continue;
        }
        const suffix = oldPath.startsWith(sourcePrefix) ? oldPath.slice(sourcePrefix.length) : getBaseName(oldPath);
        const newPath = normalizePath(suffix ? `${targetFolderPath}/${suffix}` : targetFolderPath);
        if (!newPath) {
          skipped += 1;
          continue;
        }
        setMessage(
          `${actionLabel} folder...`,
          `Processing file ${index + 1}/${sortedRecords.length}: ${oldPath}`,
        );
        try {
          const sourceScope = getFileScopeOptions(source, repoFull, oldPath);
          const targetScope = getFileScopeOptions(targetSource, targetRepoFull, newPath);
          const full = await getComponentRecord(oldPath, sourceScope);
          if (!full || !full.data3mf) {
            failed += 1;
            continue;
          }
          const existing = await getComponentRecord(newPath, targetScope);
          if (existing) {
            const overwrite = await confirm(`"${newPath}" already exists. Overwrite it?`);
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }
          await setComponentRecord(newPath, {
            savedAt: new Date().toISOString(),
            data3mf: full.data3mf,
            data: full.data,
            thumbnail: full.thumbnail || null,
          }, targetScope);
          if (!copy) {
            await removeComponentRecord(oldPath, sourceScope);
            state.thumbCache.delete(getEntryCacheKey({ source, repoFull, name: oldPath }));
            moved += 1;
          } else {
            copied += 1;
          }
        } catch {
          failed += 1;
        }
      }

      if (!copy) {
        const reverseFolderPaths = folderPaths.slice().sort((a, b) => b.length - a.length);
        for (let index = 0; index < reverseFolderPaths.length; index += 1) {
          const oldFolderPath = reverseFolderPaths[index];
          setMessage(
            `${actionLabel} folder...`,
            `Cleaning source folder marker ${index + 1}/${reverseFolderPaths.length}: ${oldFolderPath}`,
          );
          try {
            await removeWorkspaceFolder(oldFolderPath, getFolderScopeOptions(source, repoFull));
          } catch {
            // Ignore missing marker cleanup failures.
          }
        }
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();

      const cleanedMarkers = await cleanupEmptyTrashFolders(touchedTrashScopes, { setMessage });
      if (cleanedMarkers > 0) {
        setMessage('Refreshing file index...', 'Finalizing Trash folder cleanup...');
        await loadFiles();
        await waitForFilesIdle();
      }
    }, {
      detail: `${sourceFolderPath} -> ${targetFolderPath}`,
    });
  } catch (err) {
    setFilesStatus(`${actionLabel} folder failed: ${errorMessage(err)}`, 'error');
    return;
  }

  const succeeded = copy ? copied : moved;
  if (failed) {
    setFilesStatus(`${actionLabel} folder complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`${actionLabel} folder complete: ${succeeded} succeeded, ${skipped} skipped.`, 'ok');
  }
}

function createFolderActionsMenu(folderEntry, context = {}, options = {}) {
  const folderPath = normalizePath(folderEntry?.path || '');
  if (!folderPath) return null;
  const source = normalizeStorageSource(context?.source || state.explorerRootSource);
  const repoFull = String(context?.repoFull || state.explorerRootRepoFull || '').trim();
  if (isTrashRoot(source, repoFull) || isTrashPath(folderPath)) return null;
  const isReadOnly = source === 'github' && getRepoReadOnlyStatus(repoFull);
  const extraClass = String(options?.extraClass || '').trim();

  const actions = [
    {
      label: 'Open',
      className: 'hub-file-menu-item',
      run: () => setExplorerPath(folderPath),
    },
    {
      label: 'Rename Folder',
      className: 'hub-file-menu-item',
      disabled: isReadOnly,
      disabledTitle: 'Read-only repository',
      run: () => { void renameFolderPath(folderPath, { source, repoFull }); },
    },
    {
      label: 'Copy Folder...',
      className: 'hub-file-menu-item',
      run: () => { void runFolderTransferAction(folderEntry, { source, repoFull, copy: true }); },
    },
    {
      label: 'Move Folder...',
      className: 'hub-file-menu-item',
      disabled: isReadOnly,
      disabledTitle: 'Read-only repository',
      run: () => { void runFolderTransferAction(folderEntry, { source, repoFull, copy: false }); },
    },
    {
      label: 'Delete Folder',
      className: 'hub-file-menu-item is-danger',
      disabled: isReadOnly,
      disabledTitle: 'Read-only repository',
      run: () => { void deleteFolderPath(folderPath, { source, repoFull }); },
    },
  ];

  return createFloatingActionsMenu(actions, {
    extraClass,
    triggerTitle: 'Folder actions',
  });
}

function createFileActionsMenu(entry, options = {}) {
  const name = String(entry?.name || '').trim();
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  const branch = String(entry?.branch || '').trim();
  const inTrash = isTrashPath(getEntryBrowserPath(entry));
  const restorePath = inTrash ? getRestorePathFromTrashPath(getEntryModelPath(entry)) : '';
  const isReadOnly = source === 'github' && getRepoReadOnlyStatus(repoFull);
  const hasGithubUrl = source === 'github' && !!repoFull;
  const cadModelPath = getEntryCadLaunchModelPath(entry) || name;
  const extraClass = String(options?.extraClass || '').trim();

  const actions = [
    {
      label: 'Open',
      className: 'hub-file-menu-item',
      run: () => goCad({
        source,
        repoFull,
        branch,
        path: cadModelPath,
      }),
    },
    ...(hasGithubUrl ? [{
      label: 'Open on GitHub',
      className: 'hub-file-menu-item',
      run: () => { void openEntryOnGithub(entry); },
    }] : []),
    {
      label: 'Rename',
      className: 'hub-file-menu-item',
      disabled: isReadOnly,
      run: () => { void renameFile(entry); },
    },
    {
      label: 'Duplicate',
      className: 'hub-file-menu-item',
      disabled: isReadOnly,
      run: () => { void duplicateFile(entry); },
    },
    {
      label: 'Copy To...',
      className: 'hub-file-menu-item',
      run: () => { void runFileTransferAction(entry, { copy: true }); },
    },
    {
      label: 'Move To...',
      className: 'hub-file-menu-item',
      disabled: isReadOnly,
      disabledTitle: 'Read-only repository',
      run: () => { void runFileTransferAction(entry, { copy: false }); },
    },
    ...(inTrash ? [{
      label: 'Restore',
      className: 'hub-file-menu-item',
      disabled: isReadOnly || !restorePath,
      disabledTitle: isReadOnly ? 'Read-only repository' : 'Original path unavailable',
      run: () => { void restoreEntries([entry], { confirm: true }); },
    }, {
      label: 'Delete Permanently',
      className: 'hub-file-menu-item is-danger',
      disabled: isReadOnly,
      disabledTitle: 'Read-only repository',
      run: () => { void permanentlyDeleteEntries([entry], { confirm: true }); },
    }] : [{
      label: 'Move to Trash',
      className: 'hub-file-menu-item is-danger',
      disabled: isReadOnly,
      run: () => { void moveEntriesToTrash([entry], { confirm: true }); },
    }]),
  ];

  return createFloatingActionsMenu(actions, {
    extraClass,
    triggerTitle: 'File actions',
  });
}

function getEntryRepoFull(entryOrName) {
  if (!entryOrName || typeof entryOrName === 'string') return '';
  return String(entryOrName.repoFull || '').trim();
}

function getEntrySource(entryOrName) {
  if (!entryOrName || typeof entryOrName === 'string') return '';
  return String(entryOrName.source || '').trim().toLowerCase();
}

function getEntryBranch(entryOrName) {
  if (!entryOrName || typeof entryOrName === 'string') return '';
  return String(entryOrName.branch || '').trim();
}

function buildEntryScope(entryOrName) {
  if (!entryOrName || typeof entryOrName === 'string') return {};
  const scope = {};
  const source = getEntrySource(entryOrName);
  const repoFull = getEntryRepoFull(entryOrName);
  const branch = getEntryBranch(entryOrName);
  const path = getEntryModelPath(entryOrName) || getEntryName(entryOrName);
  if (source === 'local' || source === 'github' || source === 'mounted') scope.source = source;
  if (repoFull) scope.repoFull = repoFull;
  if (branch) scope.branch = branch;
  if (path) scope.path = path;
  return scope;
}

function getEntryName(entryOrName) {
  if (!entryOrName) return '';
  if (typeof entryOrName === 'string') return String(entryOrName).trim();
  return String(entryOrName.name || '').trim();
}

function getEntryModelPath(entryOrName) {
  if (!entryOrName) return '';
  if (typeof entryOrName === 'string') return normalizePath(String(entryOrName).trim());
  // CRUD operations must use the exact persisted record path.
  const canonicalPath = String(entryOrName.path || entryOrName.name || '').trim();
  return normalizePath(canonicalPath || getEntryBrowserPath(entryOrName));
}

function getEntryCacheKey(entryOrName) {
  const source = getEntrySource(entryOrName);
  const repo = getEntryRepoFull(entryOrName);
  const name = typeof entryOrName === 'string'
    ? getEntryName(entryOrName)
    : (getEntryModelPath(entryOrName) || getEntryName(entryOrName));
  const scope = repo ? `${repo}::${name}` : name;
  return source ? `${source}::${scope}` : scope;
}

function getEntrySelectionKey(entryOrName) {
  return getEntryCacheKey(entryOrName);
}

function rebuildEntryLookup() {
  const map = new Map();
  for (const entry of Array.isArray(state.allRecords) ? state.allRecords : []) {
    const key = getEntrySelectionKey(entry);
    if (!key) continue;
    if (!map.has(key)) map.set(key, entry);
  }
  state.entryByKey = map;
  const nextSelection = new Set();
  for (const key of state.selectedEntryKeys) {
    if (map.has(key)) nextSelection.add(key);
  }
  state.selectedEntryKeys = nextSelection;
}

function getSelectedEntries() {
  const out = [];
  for (const key of state.selectedEntryKeys) {
    const entry = state.entryByKey.get(key);
    if (entry) out.push(entry);
  }
  return out;
}

function clearSelectedEntries({ rerender = true } = {}) {
  if (!state.selectedEntryKeys.size) return;
  state.selectedEntryKeys = new Set();
  if (rerender) renderFilesList();
}

function toggleEntrySelected(entryOrName, { rerender = true } = {}) {
  const key = getEntrySelectionKey(entryOrName);
  if (!key) return;
  const had = state.selectedEntryKeys.has(key);
  if (had) state.selectedEntryKeys.delete(key);
  else state.selectedEntryKeys.add(key);
  if (rerender) renderFilesList();
}

function isEntrySelected(entryOrName) {
  const key = getEntrySelectionKey(entryOrName);
  return !!key && state.selectedEntryKeys.has(key);
}

function selectVisibleExplorerEntries(append = false) {
  const keys = Array.isArray(state.visibleExplorerEntryKeys) ? state.visibleExplorerEntryKeys : [];
  if (!keys.length) return;
  const next = append ? new Set(state.selectedEntryKeys) : new Set();
  for (const key of keys) {
    if (!key || !state.entryByKey.has(key)) continue;
    next.add(key);
  }
  state.selectedEntryKeys = next;
  renderFilesList();
}

function isTextInputElement(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function focusExplorerFileItemByDelta(currentEl, delta) {
  const all = Array.from(document.querySelectorAll('.hub-explorer .hub-browser-file-entry'));
  if (!all.length) return;
  const currentIdx = all.indexOf(currentEl);
  if (currentIdx < 0) return;
  const nextIdx = Math.max(0, Math.min(all.length - 1, currentIdx + Number(delta || 0)));
  const nextEl = all[nextIdx];
  if (nextEl && typeof nextEl.focus === 'function') {
    nextEl.focus({ preventScroll: false });
  }
}

function bindExplorerFileKeyboard(rowEl, entry, openHandler) {
  if (!rowEl || !entry || typeof openHandler !== 'function') return;
  rowEl.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      openHandler(event);
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      toggleEntrySelected(entry);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusExplorerFileItemByDelta(rowEl, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusExplorerFileItemByDelta(rowEl, -1);
      return;
    }
    if (event.key === 'ArrowRight' && state.explorerViewMode === 'icons') {
      event.preventDefault();
      focusExplorerFileItemByDelta(rowEl, 1);
      return;
    }
    if (event.key === 'ArrowLeft' && state.explorerViewMode === 'icons') {
      event.preventDefault();
      focusExplorerFileItemByDelta(rowEl, -1);
    }
  });
}

function createSelectionToggle(entry, { tile = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `hub-select-toggle${tile ? ' is-tile' : ''}${isEntrySelected(entry) ? ' is-selected' : ''}`;
  button.setAttribute('aria-label', isEntrySelected(entry) ? 'Unselect file' : 'Select file');
  button.textContent = isEntrySelected(entry) ? '✓' : '○';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleEntrySelected(entry);
  });
  return button;
}

function getRepoReadOnlyStatus(repoFull = '') {
  const target = String(repoFull || '').trim();
  if (!target) return false;
  for (const repo of Array.isArray(state.repoCache) ? state.repoCache : []) {
    if (String(repo?.full_name || '').trim() !== target) continue;
    if (repo?.permissions && repo.permissions.push === false) return true;
    return false;
  }
  return false;
}

function createEntryDropTarget(source, repoFull = '', path = '') {
  return {
    source: normalizeStorageSource(source),
    repoFull: String(repoFull || '').trim(),
    path: normalizePath(path),
  };
}

function getDropTargetLabel(target) {
  const source = normalizeStorageSource(target?.source);
  const repoFull = String(target?.repoFull || '').trim();
  const path = normalizePath(target?.path || '');
  const parts = [getStorageRootLabel(source, repoFull)];
  if (path) parts.push(path);
  return parts.join(' / ');
}

async function importDesktopFilesToFolder(files, target, { refresh = true } = {}) {
  if (isUiBusy()) return { imported: 0, skipped: 0, failed: 0 };
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return { imported: 0, skipped: 0, failed: 0 };

  const targetScope = getTargetScopeForWrite(target, null);
  const targetPath = normalizePath(target?.path || '');
  const targetLabel = getDropTargetLabel(target);
  const source = normalizeStorageSource(targetScope.source || 'local');
  const repoFull = String(targetScope.repoFull || '').trim();
  const supportsJson = source === 'local';

  if (isTrashRoot(source, repoFull) || isTrashPath(targetPath)) {
    setFilesStatus('Cannot import files into Trash.', 'warn');
    return { imported: 0, skipped: list.length, failed: 0 };
  }
  if (source !== 'local' && !repoFull) {
    setFilesStatus('Select a valid destination folder before dropping files.', 'warn');
    return { imported: 0, skipped: list.length, failed: 0 };
  }
  if (source === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
    setFilesStatus('Set a GitHub token in Settings before importing files into repositories.', 'warn');
    return { imported: 0, skipped: list.length, failed: 0 };
  }
  if (source === 'github' && getRepoReadOnlyStatus(repoFull)) {
    setFilesStatus(`Repository "${repoFull}" is read-only.`, 'warn');
    return { imported: 0, skipped: list.length, failed: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  setFilesStatus(`Importing ${list.length} file${list.length === 1 ? '' : 's'}...`, 'info');
  try {
    await runBusyUiTask('Importing desktop files...', async ({ setMessage }) => {
      for (let index = 0; index < list.length; index += 1) {
        const file = list[index];
        const fileName = String(file?.name || '').trim() || `file-${index + 1}`;
        setMessage('Importing desktop files...', `${index + 1}/${list.length} - ${fileName}`);
        try {
          const parsed = await readDroppedWorkspaceFileRecord(file, { allowJson: supportsJson });
          const baseName = normalizePath(parsed?.baseName || '');
          if (!parsed?.record || !baseName) {
            skipped += 1;
            continue;
          }
          const nextPath = normalizePath(targetPath ? `${targetPath}/${baseName}` : baseName);
          if (!nextPath) {
            skipped += 1;
            continue;
          }

          const writeScope = {
            ...targetScope,
            source,
            repoFull,
            path: nextPath,
          };
          const existing = await getComponentRecord(nextPath, writeScope);
          if (existing) {
            const overwrite = await confirm(`"${nextPath}" already exists in ${targetLabel}. Overwrite it?`);
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }

          await setComponentRecord(nextPath, parsed.record, writeScope);
          imported += 1;
        } catch {
          failed += 1;
        }
      }

      if (!refresh) return;
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    }, {
      detail: `Target: ${targetLabel}`,
    });
  } catch (err) {
    setFilesStatus(`Desktop import failed: ${errorMessage(err)}`, 'error');
    return { imported, skipped, failed: failed + 1 };
  }

  if (!imported && !failed) {
    setFilesStatus(`No supported files were imported. Drop ${supportsJson ? '.3mf or .json' : '.3mf'} files.`, 'warn');
    return { imported, skipped, failed };
  }
  if (failed) {
    setFilesStatus(`Import complete: ${imported} imported, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`Imported ${imported} file${imported === 1 ? '' : 's'} to "${targetLabel}".${skipped ? ` (${skipped} skipped)` : ''}`, 'ok');
  }
  return { imported, skipped, failed };
}

function getActiveDragEntries() {
  const keys = Array.isArray(state.dragEntryKeys) ? state.dragEntryKeys : [];
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = state.entryByKey.get(key);
    if (entry) out.push(entry);
  }
  return out;
}

function bindDragSource(el, entry) {
  if (!el || !entry) return;
  el.draggable = true;
  el.addEventListener('dragstart', (event) => {
    if (isUiBusy()) {
      event.preventDefault();
      return;
    }
    const key = getEntrySelectionKey(entry);
    if (!key) {
      event.preventDefault();
      return;
    }
    const selected = state.selectedEntryKeys.has(key)
      ? Array.from(state.selectedEntryKeys)
      : [key];
    const validKeys = selected.filter((item) => state.entryByKey.has(item));
    if (!validKeys.length) {
      event.preventDefault();
      return;
    }
    state.dragEntryKeys = validKeys;
    el.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', validKeys.join('\n'));
    }
  });
  el.addEventListener('dragend', () => {
    state.dragEntryKeys = [];
    el.classList.remove('is-dragging');
    document.querySelectorAll('.hub-drop-target.is-drop-active').forEach((node) => {
      node.classList.remove('is-drop-active');
    });
  });
}

function bindDropTarget(el, target) {
  if (!el || !target) return;
  let depth = 0;
  el.classList.add('hub-drop-target');

  const markActive = () => el.classList.add('is-drop-active');
  const clearActive = () => {
    depth = 0;
    el.classList.remove('is-drop-active');
  };

  el.addEventListener('dragenter', (event) => {
    if (isUiBusy()) return;
    if (!state.dragEntryKeys.length) return;
    event.preventDefault();
    depth += 1;
    markActive();
  });
  el.addEventListener('dragover', (event) => {
    if (isUiBusy()) return;
    if (!state.dragEntryKeys.length) return;
    event.preventDefault();
    if (event.dataTransfer) {
      const copy = !!(event.altKey || event.ctrlKey || event.metaKey);
      event.dataTransfer.dropEffect = copy ? 'copy' : 'move';
    }
    markActive();
  });
  el.addEventListener('dragleave', () => {
    if (isUiBusy()) return;
    if (!state.dragEntryKeys.length) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('is-drop-active');
  });
  el.addEventListener('drop', (event) => {
    if (isUiBusy()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const entries = getActiveDragEntries();
    state.dragEntryKeys = [];
    clearActive();
    if (!entries.length) return;
    event.preventDefault();
    event.stopPropagation();
    const copy = !!(event.altKey || event.ctrlKey || event.metaKey);
    void relocateEntries(entries, target, {
      copy,
      confirm: true,
    });
  });
}

function getEntryPathBaseName(entry) {
  const modelPath = getEntryModelPath(entry);
  if (!modelPath) return '';
  const parts = modelPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || modelPath;
}

function getRestorePathFromTrashPath(pathValue) {
  const normalized = normalizePath(pathValue || '');
  if (!isTrashPath(normalized)) return '';
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts[0] !== TRASH_FOLDER_NAME) return '';
  const tail = parts.slice(1);
  if (!tail.length) return '';
  return normalizePath(tail.join('/'));
}

function getTargetScopeForWrite(target, fallbackEntry = null) {
  const source = normalizeStorageSource(target?.source);
  const repoFull = String(target?.repoFull || '').trim();
  const cfgBranch = String(getGithubStorageConfig()?.branch || '').trim();
  const scope = {
    source,
    repoFull,
  };
  if (source === 'github') {
    const entryBranch = String(fallbackEntry?.branch || '').trim();
    if (entryBranch) scope.branch = entryBranch;
    else if (cfgBranch) scope.branch = cfgBranch;
  }
  return scope;
}

async function relocateEntries(entries, target, {
  copy = false,
  confirm: shouldConfirm = true,
} = {}) {
  if (isUiBusy()) return;
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return;
  const targetScope = getTargetScopeForWrite(target, list[0]);
  const targetPath = normalizePath(target?.path || '');
  const targetLabel = getDropTargetLabel(target);
  const actionLabel = copy ? 'Copy' : 'Move';
  if (targetScope.source === 'github' && getRepoReadOnlyStatus(targetScope.repoFull)) {
    setFilesStatus(`Cannot ${copy ? 'copy into' : 'move into'} read-only repository "${targetScope.repoFull}".`, 'warn');
    return;
  }

  if (shouldConfirm) {
    const ok = await confirm(`${actionLabel} ${list.length} file${list.length === 1 ? '' : 's'} to "${targetLabel}"?`);
    if (!ok) return;
  }

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  setFilesStatus(`${actionLabel} in progress...`, 'info');
  try {
    await runBusyUiTask(`${actionLabel} files...`, async ({ setMessage }) => {
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const sourcePath = getEntryModelPath(entry);
        setMessage(
          `${actionLabel} files...`,
          `${index + 1}/${list.length} - ${sourcePath || getEntryName(entry) || 'Unknown file'}`,
        );
        if (!sourcePath) {
          skipped += 1;
          continue;
        }
        if (isTrashPath(sourcePath)) {
          skipped += 1;
          continue;
        }
        const sourceScope = {
          ...buildEntryScope(entry),
          path: sourcePath,
        };
        const sourceSource = normalizeStorageSource(entry?.source);
        const sourceRepo = String(entry?.repoFull || '').trim();
        const baseName = getEntryPathBaseName(entry);
        const nextPath = normalizePath(targetPath ? `${targetPath}/${baseName}` : baseName);
        if (!nextPath) {
          skipped += 1;
          continue;
        }

        const isSameLocation = sourceSource === targetScope.source
          && sourceRepo === String(targetScope.repoFull || '').trim()
          && sourcePath === nextPath;
        if (isSameLocation) {
          skipped += 1;
          continue;
        }
        if (!copy && sourceSource === 'github' && getRepoReadOnlyStatus(sourceRepo)) {
          skipped += 1;
          continue;
        }

        try {
          const rec = await getComponentRecord(sourcePath, sourceScope);
          if (!rec || !rec.data3mf) {
            failed += 1;
            continue;
          }

          const writeScope = {
            ...targetScope,
            path: nextPath,
          };
          const existing = await getComponentRecord(nextPath, writeScope);
          if (existing) {
            const overwrite = await confirm(`"${nextPath}" already exists in ${targetLabel}. Overwrite it?`);
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }

          await setComponentRecord(nextPath, {
            savedAt: new Date().toISOString(),
            data3mf: rec.data3mf,
            data: rec.data,
            thumbnail: rec.thumbnail || null,
          }, writeScope);

          if (!copy) {
            await removeComponentRecord(sourcePath, sourceScope);
            state.thumbCache.delete(getEntryCacheKey(entry));
          }

          moved += 1;
        } catch {
          failed += 1;
        }
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    }, {
      detail: `Target: ${targetLabel}`,
    });
  } catch (err) {
    setFilesStatus(`${actionLabel} failed: ${errorMessage(err)}`, 'error');
    return;
  }

  if (failed) {
    setFilesStatus(`${actionLabel} complete: ${moved} succeeded, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`${actionLabel} complete: ${moved} succeeded, ${skipped} skipped.`, 'ok');
  }
}

async function permanentlyDeleteEntries(entries, {
  confirm: shouldConfirm = true,
  folderEntries = [],
} = {}) {
  if (isUiBusy()) return;
  const fileList = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const folderList = Array.isArray(folderEntries) ? folderEntries.filter(Boolean) : [];
  if (!fileList.length && !folderList.length) return;

  const actionLabel = fileList.length === 1
    ? 'Delete file permanently'
    : (fileList.length
      ? `Delete ${fileList.length} files permanently`
      : 'Empty Trash permanently');
  if (shouldConfirm) {
    const ok = await confirm(`${actionLabel}?\n\nThis cannot be undone.`);
    if (!ok) return;
  }

  let removed = 0;
  let failed = 0;
  let skipped = 0;
  const touchedTrashScopes = collectTrashScopes(fileList, folderList);

  setFilesStatus('Deleting permanently...', 'info');
  try {
    await runBusyUiTask('Deleting permanently...', async ({ setMessage }) => {
      for (let index = 0; index < fileList.length; index += 1) {
        const entry = fileList[index];
        const path = getEntryModelPath(entry);
        setMessage(
          'Deleting permanently...',
          `${index + 1}/${fileList.length} - ${path || getEntryName(entry) || 'Unknown file'}`,
        );
        if (!path || !isTrashPath(path)) {
          skipped += 1;
          continue;
        }
        const source = normalizeStorageSource(entry?.source);
        const repoFull = String(entry?.repoFull || '').trim();
        if (source === 'github' && getRepoReadOnlyStatus(repoFull)) {
          skipped += 1;
          continue;
        }
        const scope = {
          ...buildEntryScope(entry),
          path,
        };
        try {
          await removeComponentRecord(path, scope);
          state.thumbCache.delete(getEntryCacheKey(entry));
          removed += 1;
        } catch {
          failed += 1;
        }
      }

      const sortedFolders = folderList
        .slice()
        .sort((a, b) => String(b?.path || '').length - String(a?.path || '').length);
      for (let index = 0; index < sortedFolders.length; index += 1) {
        const folder = sortedFolders[index];
        const path = normalizePath(folder?.path || '');
        if (!path || !isTrashPath(path)) continue;
        const source = normalizeStorageSource(folder?.source || 'local');
        const repoFull = String(folder?.repoFull || '').trim();
        if (source === 'github' && getRepoReadOnlyStatus(repoFull)) continue;
        setMessage(
          'Deleting permanently...',
          `Cleaning folder marker ${index + 1}/${sortedFolders.length}: ${path}`,
        );
        try {
          await removeWorkspaceFolder(path, getFolderScopeOptions(source, repoFull));
        } catch {
          // Ignore missing marker cleanup failures.
        }
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();

      const cleanedMarkers = await cleanupEmptyTrashFolders(touchedTrashScopes, { setMessage });
      if (cleanedMarkers > 0) {
        setMessage('Refreshing file index...', 'Finalizing Trash folder cleanup...');
        await loadFiles();
        await waitForFilesIdle();
      }
    }, {
      detail: `Items: ${fileList.length}`,
    });
  } catch (err) {
    setFilesStatus(`Permanent delete failed: ${errorMessage(err)}`, 'error');
    return;
  }

  if (failed) {
    setFilesStatus(`Permanent delete complete: ${removed} succeeded, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`Deleted ${removed} file${removed === 1 ? '' : 's'} permanently.`, 'ok');
  }
}

async function restoreEntries(entries, { confirm: shouldConfirm = true } = {}) {
  if (isUiBusy()) return;
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return;

  const actionLabel = list.length === 1 ? 'Restore file' : `Restore ${list.length} files`;
  if (shouldConfirm) {
    const ok = await confirm(`${actionLabel} from Trash?`);
    if (!ok) return;
  }

  let restored = 0;
  let failed = 0;
  let skipped = 0;
  const touchedTrashScopes = collectTrashScopes(list, []);

  setFilesStatus('Restoring files from Trash...', 'info');
  try {
    await runBusyUiTask('Restoring files from Trash...', async ({ setMessage }) => {
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const trashPath = getEntryModelPath(entry);
        setMessage(
          'Restoring files from Trash...',
          `${index + 1}/${list.length} - ${trashPath || getEntryName(entry) || 'Unknown file'}`,
        );
        if (!trashPath || !isTrashPath(trashPath)) {
          skipped += 1;
          continue;
        }
        const restorePath = getRestorePathFromTrashPath(trashPath);
        if (!restorePath) {
          skipped += 1;
          continue;
        }
        const source = normalizeStorageSource(entry?.source);
        const repoFull = String(entry?.repoFull || '').trim();
        if (source === 'github' && getRepoReadOnlyStatus(repoFull)) {
          skipped += 1;
          continue;
        }
        const sourceScope = {
          ...buildEntryScope(entry),
          path: trashPath,
        };
        const targetScope = {
          ...buildEntryScope(entry),
          path: restorePath,
        };
        try {
          const rec = await getComponentRecord(trashPath, sourceScope);
          if (!rec || !rec.data3mf) {
            failed += 1;
            continue;
          }

          const existing = await getComponentRecord(restorePath, targetScope);
          if (existing) {
            const overwrite = await confirm(`"${restorePath}" already exists. Overwrite it?`);
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }

          await setComponentRecord(restorePath, {
            savedAt: new Date().toISOString(),
            data3mf: rec.data3mf,
            data: rec.data,
            thumbnail: rec.thumbnail || null,
          }, targetScope);
          await removeComponentRecord(trashPath, sourceScope);

          const oldCacheKey = getEntryCacheKey(entry);
          const newCacheKey = getEntryCacheKey({
            source,
            repoFull,
            name: restorePath,
          });
          const cached = state.thumbCache.get(oldCacheKey);
          if (cached) {
            state.thumbCache.set(newCacheKey, cached);
            state.thumbCache.delete(oldCacheKey);
          } else {
            state.thumbCache.delete(oldCacheKey);
          }

          restored += 1;
        } catch {
          failed += 1;
        }
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();

      const cleanedMarkers = await cleanupEmptyTrashFolders(touchedTrashScopes, { setMessage });
      if (cleanedMarkers > 0) {
        setMessage('Refreshing file index...', 'Finalizing Trash folder cleanup...');
        await loadFiles();
        await waitForFilesIdle();
      }
    }, {
      detail: `Items: ${list.length}`,
    });
  } catch (err) {
    setFilesStatus(`Restore failed: ${errorMessage(err)}`, 'error');
    return;
  }

  if (failed) {
    setFilesStatus(`Restore complete: ${restored} succeeded, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`Restored ${restored} file${restored === 1 ? '' : 's'} from Trash.`, 'ok');
  }
}

async function moveEntriesToTrash(entries, { confirm: shouldConfirm = true } = {}) {
  if (isUiBusy()) return;
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return;
  const actionLabel = list.length === 1 ? 'Move file to Trash' : `Move ${list.length} files to Trash`;
  if (shouldConfirm) {
    const ok = await confirm(`${actionLabel}?`);
    if (!ok) return;
  }

  let moved = 0;
  let failed = 0;
  let skipped = 0;

  setFilesStatus('Moving files to Trash...', 'info');
  try {
    await runBusyUiTask('Moving files to Trash...', async ({ setMessage }) => {
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const sourcePath = getEntryModelPath(entry);
        setMessage(
          'Moving files to Trash...',
          `${index + 1}/${list.length} - ${sourcePath || getEntryName(entry) || 'Unknown file'}`,
        );
        const source = normalizeStorageSource(entry?.source);
        const sourceRepo = String(entry?.repoFull || '').trim();
        if (source === 'github' && getRepoReadOnlyStatus(sourceRepo)) {
          skipped += 1;
          continue;
        }
        if (!sourcePath) {
          skipped += 1;
          continue;
        }
        if (isTrashPath(sourcePath)) {
          skipped += 1;
          continue;
        }
        const sourceScope = {
          ...buildEntryScope(entry),
          path: sourcePath,
        };
        const trashPath = normalizePath(`${TRASH_FOLDER_NAME}/${sourcePath}`);
        if (!trashPath) {
          skipped += 1;
          continue;
        }
        const writeScope = {
          ...sourceScope,
          path: trashPath,
        };
        try {
          const rec = await getComponentRecord(sourcePath, sourceScope);
          if (!rec || !rec.data3mf) {
            failed += 1;
            continue;
          }
          const existing = await getComponentRecord(trashPath, writeScope);
          if (existing) {
            const overwrite = await confirm(`"${trashPath}" already exists in Trash. Overwrite it?`);
            if (!overwrite) {
              skipped += 1;
              continue;
            }
          }
          await setComponentRecord(trashPath, {
            savedAt: new Date().toISOString(),
            data3mf: rec.data3mf,
            data: rec.data,
            thumbnail: rec.thumbnail || null,
          }, writeScope);
          await removeComponentRecord(sourcePath, sourceScope);
          state.thumbCache.delete(getEntryCacheKey(entry));
          moved += 1;
        } catch {
          failed += 1;
        }
      }

      clearSelectedEntries({ rerender: false });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    }, {
      detail: `Items: ${list.length}`,
    });
  } catch (err) {
    setFilesStatus(`Trash move failed: ${errorMessage(err)}`, 'error');
    return;
  }

  if (failed) {
    setFilesStatus(`Trash move complete: ${moved} succeeded, ${failed} failed, ${skipped} skipped.`, 'warn');
  } else {
    setFilesStatus(`Moved ${moved} file${moved === 1 ? '' : 's'} to Trash.`, 'ok');
  }
}

async function hydrateThumbnail(entry, imgEl) {
  if (!imgEl || !entry) return;
  const cacheKey = getEntryCacheKey(entry);

  if (entry?.record?.thumbnail) {
    imgEl.src = entry.record.thumbnail;
    state.thumbCache.set(cacheKey, entry.record.thumbnail);
    return;
  }
  if (state.thumbCache.has(cacheKey)) {
    const cached = state.thumbCache.get(cacheKey);
    if (cached) {
      imgEl.src = cached;
      return;
    }
  }
}

async function renameFile(entryOrName) {
  if (isUiBusy()) return;
  const name = getEntryModelPath(entryOrName) || getEntryName(entryOrName);
  const source = getEntrySource(entryOrName);
  const repoFull = getEntryRepoFull(entryOrName);
  const scope = buildEntryScope(entryOrName);
  const rec = await getComponentRecord(name, scope);
  if (!rec) {
    setFilesStatus(`File not found: ${name}`, 'warn');
    return;
  }

  let nextName = (await prompt('Rename file', name)) || '';
  nextName = nextName.trim();
  if (!nextName || nextName === name) return;

  const existing = await getComponentRecord(nextName, { ...scope, path: nextName });
  if (existing) {
    const overwrite = await confirm(`"${nextName}" already exists. Overwrite it?`);
    if (!overwrite) return;
  }

  try {
    await runBusyUiTask(`Renaming "${name}"...`, async ({ setMessage }) => {
      setMessage(`Renaming "${name}"...`, `Writing ${nextName}`);
      await setComponentRecord(nextName, {
        savedAt: rec.savedAt || new Date().toISOString(),
        data3mf: rec.data3mf,
        data: rec.data,
        thumbnail: rec.thumbnail || null,
      }, { ...scope, path: nextName });
      await removeComponentRecord(name, scope);

      const oldCacheKey = getEntryCacheKey({ source, name, repoFull });
      const newCacheKey = getEntryCacheKey({ source, name: nextName, repoFull });
      const cached = state.thumbCache.get(oldCacheKey);
      if (cached) {
        state.thumbCache.set(newCacheKey, cached);
        state.thumbCache.delete(oldCacheKey);
      }

      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    });
    setFilesStatus(`Renamed "${name}" to "${nextName}".`, 'ok');
  } catch (err) {
    setFilesStatus(`Rename failed: ${errorMessage(err)}`, 'error');
  }
}

async function duplicateFile(entryOrName) {
  if (isUiBusy()) return;
  const name = getEntryModelPath(entryOrName) || getEntryName(entryOrName);
  const source = getEntrySource(entryOrName);
  const repoFull = getEntryRepoFull(entryOrName);
  const scope = buildEntryScope(entryOrName);
  const rec = await getComponentRecord(name, scope);
  if (!rec) {
    setFilesStatus(`File not found: ${name}`, 'warn');
    return;
  }

  let nextName = (await prompt('Duplicate as', `${name} copy`)) || '';
  nextName = nextName.trim();
  if (!nextName) return;

  const existing = await getComponentRecord(nextName, { ...scope, path: nextName });
  if (existing) {
    const overwrite = await confirm(`"${nextName}" already exists. Overwrite it?`);
    if (!overwrite) return;
  }

  try {
    await runBusyUiTask(`Duplicating "${name}"...`, async ({ setMessage }) => {
      setMessage(`Duplicating "${name}"...`, `Writing ${nextName}`);
      await setComponentRecord(nextName, {
        savedAt: new Date().toISOString(),
        data3mf: rec.data3mf,
        data: rec.data,
        thumbnail: rec.thumbnail || state.thumbCache.get(getEntryCacheKey({ source, name, repoFull })) || null,
      }, { ...scope, path: nextName });
      setMessage('Refreshing file index...', 'Updating folder and file listing...');
      await loadFiles();
      await waitForFilesIdle();
    });
    setFilesStatus(`Duplicated "${name}" to "${nextName}".`, 'ok');
  } catch (err) {
    setFilesStatus(`Duplicate failed: ${errorMessage(err)}`, 'error');
  }
}

async function deleteFile(entryOrName) {
  const entry = (entryOrName && typeof entryOrName === 'object')
    ? entryOrName
    : state.entryByKey.get(getEntrySelectionKey(entryOrName));
  if (!entry) return;
  await moveEntriesToTrash([entry], { confirm: true });
}

function refreshStorageBadge() {
  if (!state.storageBadgeEl) return;
  const cfg = getGithubStorageConfig();
  const repoList = normalizeRepoFullList(state.selectedRepoFulls?.length ? state.selectedRepoFulls : (cfg?.repoFulls || cfg?.repoFull || ''));
  const hasGithub = !!String(cfg?.token || '').trim() && repoList.length > 0;
  const mountedCount = (Array.isArray(state.mountedDirectories) ? state.mountedDirectories : []).length;
  const parts = ['Local Browser'];
  if (mountedCount > 0) parts.push(`Mounted ${mountedCount}`);
  if (hasGithub) parts.push(`GitHub ${repoList.length}`);
  state.storageBadgeEl.textContent = `Storage: Per-file (${parts.join(' + ')})`;
}

function setFilesStatus(message, type = 'info', forceHide = false) {
  if (!state.filesStatusEl) return;
  if (forceHide || !message) {
    state.filesStatusEl.hidden = true;
    state.filesStatusEl.textContent = '';
    state.filesStatusEl.dataset.tone = '';
    return;
  }
  state.filesStatusEl.hidden = false;
  state.filesStatusEl.textContent = message;
  state.filesStatusEl.dataset.tone = type;
}

function setWorkspaceStatus(message, type = 'info', forceHide = false) {
  if (!state.workspaceStatusEl) return;
  if (forceHide || !message) {
    state.workspaceStatusEl.hidden = true;
    state.workspaceStatusEl.textContent = '';
    state.workspaceStatusEl.dataset.tone = '';
    return;
  }
  state.workspaceStatusEl.hidden = false;
  state.workspaceStatusEl.textContent = message;
  state.workspaceStatusEl.dataset.tone = type;
}

function setSettingsStatus(message, type = 'info', forceHide = false) {
  if (!state.settingsStatusEl) return;
  if (forceHide || !message) {
    state.settingsStatusEl.hidden = true;
    state.settingsStatusEl.textContent = '';
    state.settingsStatusEl.dataset.tone = '';
    return;
  }
  state.settingsStatusEl.hidden = false;
  state.settingsStatusEl.textContent = message;
  state.settingsStatusEl.dataset.tone = type;
}

function errorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
  return String(err);
}

import {
  getComponentRecord,
  listComponentRecords,
  listWorkspaceFolders,
  removeComponentRecord,
  removeWorkspaceFolder,
} from '../services/componentLibrary.js';
import { getGithubStorageConfig } from '../idbStorage.js';

const EXPLORER_VIEW_MODE_PREF_KEY = '__BREP_UI_EXPLORER_VIEW_MODE__';
const EXPLORER_ICON_SIZE_PREF_KEY = '__BREP_UI_EXPLORER_ICON_SIZE__';
const EXPLORER_LOCATION_PREF_KEY = '__BREP_UI_EXPLORER_LOCATION__';
const EXPLORER_ICON_SIZE_MIN = 72;
const EXPLORER_ICON_SIZE_MAX = 192;
const EXPLORER_ICON_SIZE_DEFAULT = 132;
const TRASH_FOLDER_NAME = '__BREP_TRASH__';
const TRASH_ROOT_REPO_FULL = '__BREP_TRASH_ROOT__';

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

function normalizeStorageSource(input) {
  const source = String(input || '').trim().toLowerCase();
  return source === 'github' ? 'github' : 'local';
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

function stripModelFileExtension(pathValue) {
  const clean = normalizePath(pathValue);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower.endsWith('.3mf')) return clean.slice(0, -4);
  return clean;
}

function ensureModelExtension(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (value.toLowerCase().endsWith('.3mf')) return value;
  return `${value}.3mf`;
}

function getEntryBrowserPath(entry) {
  return normalizePath(entry?.browserPath || entry?.path || entry?.name || '');
}

function getEntryModelPathWithExtension(entry) {
  return ensureModelExtension(getEntryBrowserPath(entry) || entry?.path || entry?.name || '');
}

function getEntryDisplayName(entry) {
  const modelPath = normalizePath(entry?.path || entry?.name || '');
  const base = String(entry?.displayName || '').trim()
    || (modelPath.includes('/') ? modelPath.split('/').pop() : modelPath);
  return ensureModelExtension(base);
}

function getEntryLocationLabel(entry) {
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  const folder = String(entry?.folder || '').trim();
  const parts = [];
  if (source === 'local') parts.push('Local Browser');
  if (repoFull) parts.push(repoFull);
  if (folder) parts.push(folder);
  return parts.join(' / ');
}

function getEntryFullPathTooltip(entry) {
  const source = normalizeStorageSource(entry?.source);
  const repoFull = String(entry?.repoFull || '').trim();
  const browserPath = getEntryModelPathWithExtension(entry);
  const parts = [];
  if (source === 'local') parts.push('Local Browser');
  if (repoFull) parts.push(repoFull);
  if (browserPath) parts.push(browserPath);
  return parts.join(' / ');
}

function formatSavedAt(savedAt) {
  const dt = new Date(savedAt || '');
  return isNaN(dt) ? 'Unknown time' : dt.toLocaleString();
}

function getEntryKindLabel(entry) {
  const source = normalizeStorageSource(entry?.source);
  return source === 'local' ? 'Model · Local' : 'Model · GitHub';
}

function normalizeViewMode(value) {
  return String(value || '').trim().toLowerCase() === 'icons' ? 'icons' : 'list';
}

function clampIconSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return EXPLORER_ICON_SIZE_DEFAULT;
  return Math.max(EXPLORER_ICON_SIZE_MIN, Math.min(EXPLORER_ICON_SIZE_MAX, Math.round(parsed)));
}

function readUiPreference(key, fallback = '') {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return String(fallback || '');
    const raw = window.localStorage.getItem(String(key || ''));
    return raw == null ? String(fallback || '') : String(raw);
  } catch {
    return String(fallback || '');
  }
}

function saveUiPreference(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(String(key || ''), String(value ?? ''));
  } catch {
    // Ignore localStorage persistence failures.
  }
}

function loadStoredExplorerLocation() {
  const raw = String(readUiPreference(EXPLORER_LOCATION_PREF_KEY, '') || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const workspaceTop = !!parsed.workspaceTop;
    const source = normalizeStorageSource(parsed.rootSource || parsed.source || 'local');
    const repoFull = source === 'github'
      ? String(parsed.rootRepoFull || parsed.repoFull || '').trim()
      : '';
    const path = normalizePath(parsed.path || '');
    return {
      workspaceTop,
      source,
      repoFull,
      path: workspaceTop ? '' : path,
    };
  } catch {
    return null;
  }
}

function entryMatchesSearch(entry, loweredTerm) {
  const term = String(loweredTerm || '').trim().toLowerCase();
  if (!term) return true;
  const display = getEntryDisplayName(entry).toLowerCase();
  const browserPath = getEntryModelPathWithExtension(entry).toLowerCase();
  const repo = String(entry?.repoFull || '').toLowerCase();
  const folder = String(entry?.folder || '').toLowerCase();
  const source = normalizeStorageSource(entry?.source);
  const full = getEntryFullPathTooltip(entry).toLowerCase();
  return display.includes(term)
    || browserPath.includes(term)
    || folder.includes(term)
    || repo.includes(term)
    || source.includes(term)
    || full.includes(term);
}

function collectFolderEntries(records, folderRecords, currentPath = '') {
  const path = normalizePath(currentPath);
  const prefix = path ? `${path}/` : '';
  const folderMap = new Map();
  const files = [];

  for (const rec of Array.isArray(records) ? records : []) {
    const fullPath = getEntryBrowserPath(rec);
    if (!fullPath) continue;
    if (path && !fullPath.startsWith(prefix)) continue;
    const remainder = path ? fullPath.slice(prefix.length) : fullPath;
    if (!remainder) continue;

    const slashIdx = remainder.indexOf('/');
    if (slashIdx >= 0) {
      const segment = remainder.slice(0, slashIdx);
      if (!segment) continue;
      const folderPath = path ? `${path}/${segment}` : segment;
      const recordTime = Date.parse(rec?.savedAt || '') || 0;
      const existing = folderMap.get(folderPath);
      if (!existing) {
        folderMap.set(folderPath, {
          name: segment,
          path: folderPath,
          savedAt: rec?.savedAt || null,
          sortTime: recordTime,
          count: 1,
        });
      } else {
        existing.count += 1;
        if (recordTime > existing.sortTime) {
          existing.sortTime = recordTime;
          existing.savedAt = rec?.savedAt || existing.savedAt;
        }
      }
      continue;
    }

    files.push(rec);
  }

  for (const folder of Array.isArray(folderRecords) ? folderRecords : []) {
    const fullPath = normalizePath(folder?.path || '');
    if (!fullPath) continue;
    if (path && !fullPath.startsWith(prefix) && fullPath !== path) continue;
    const remainder = fullPath === path ? '' : (path ? fullPath.slice(prefix.length) : fullPath);
    if (!remainder) continue;
    const slashIdx = remainder.indexOf('/');
    const segment = slashIdx >= 0 ? remainder.slice(0, slashIdx) : remainder;
    if (!segment) continue;
    const folderPath = path ? `${path}/${segment}` : segment;
    const existing = folderMap.get(folderPath);
    if (!existing) {
      folderMap.set(folderPath, {
        name: segment,
        path: folderPath,
        savedAt: folder?.savedAt || null,
        sortTime: Date.parse(folder?.savedAt || '') || 0,
        count: 0,
      });
    } else if (!existing.savedAt && folder?.savedAt) {
      existing.savedAt = folder.savedAt;
      existing.sortTime = Date.parse(folder.savedAt) || existing.sortTime;
    }
  }

  const folders = Array.from(folderMap.values()).sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' }),
  );
  const directFiles = files.slice().sort((a, b) => {
    const aTime = Date.parse(a?.savedAt || '') || 0;
    const bTime = Date.parse(b?.savedAt || '') || 0;
    return bTime - aTime;
  });
  return { folders, files: directFiles };
}

export class WorkspaceFileBrowserWidget {
  constructor({
    container,
    onPickFile = null,
    onActivateFile = null,
    onLocationChange = null,
    onViewModeChange = null,
    onCreateFolder = null,
    onDeleteFolder = null,
    onEmptyTrash = null,
    createFileActionsMenu = null,
    createFolderActionsMenu = null,
    bindFileDragSource = null,
    bindDropTarget = null,
    showSearchInput = true,
    showViewToggle = true,
    showCreateFolderButton = false,
    showDeleteFolderButton = false,
    showEmptyTrashButton = false,
    showUpButton = false,
    showRefreshButton = true,
    fileActionLabel = 'Select',
    scrollBody = true,
  } = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('WorkspaceFileBrowserWidget requires a container element.');
    }
    this.container = container;
    this.onPickFile = typeof onPickFile === 'function' ? onPickFile : null;
    this.onActivateFile = typeof onActivateFile === 'function' ? onActivateFile : null;
    this.onLocationChange = typeof onLocationChange === 'function' ? onLocationChange : null;
    this.onViewModeChange = typeof onViewModeChange === 'function' ? onViewModeChange : null;
    this.onCreateFolder = typeof onCreateFolder === 'function' ? onCreateFolder : null;
    this.onDeleteFolder = typeof onDeleteFolder === 'function' ? onDeleteFolder : null;
    this.onEmptyTrash = typeof onEmptyTrash === 'function' ? onEmptyTrash : null;
    this.createFileActionsMenu = typeof createFileActionsMenu === 'function' ? createFileActionsMenu : null;
    this.createFolderActionsMenu = typeof createFolderActionsMenu === 'function' ? createFolderActionsMenu : null;
    this.bindFileDragSource = typeof bindFileDragSource === 'function' ? bindFileDragSource : null;
    this.bindDropTarget = typeof bindDropTarget === 'function' ? bindDropTarget : null;
    this.showSearchInput = showSearchInput !== false;
    this.showViewToggle = showViewToggle !== false;
    this.showCreateFolderButton = showCreateFolderButton === true;
    this.showDeleteFolderButton = showDeleteFolderButton === true;
    this.showEmptyTrashButton = showEmptyTrashButton !== false;
    this.showUpButton = showUpButton === true;
    this.showRefreshButton = showRefreshButton !== false;
    this.fileActionLabel = String(fileActionLabel || '').trim() || 'Select';
    this.scrollBody = scrollBody !== false;
    this.records = [];
    this.folderRecords = [];
    this.roots = [];
    this.searchTerm = '';
    this.workspaceTop = true;
    this.rootSource = 'local';
    this.rootRepoFull = '';
    this.path = '';
    this.viewMode = normalizeViewMode(readUiPreference(EXPLORER_VIEW_MODE_PREF_KEY, 'list'));
    this.iconSize = clampIconSize(readUiPreference(EXPLORER_ICON_SIZE_PREF_KEY, EXPLORER_ICON_SIZE_DEFAULT));
    this._hasStoredLocation = false;
    this.loading = false;
    this.actionBusy = false;
    this.thumbCache = new Map();
    this._boundSearchInput = null;

    this._applyStoredLocation();
    this._ensureStyles();
    this._buildUI();
  }

  destroy() {
    this.thumbCache.clear();
    if (this.root?.parentNode === this.container) {
      this.container.removeChild(this.root);
    }
  }

  async reload() {
    if (this.loading) return;
    this.loading = true;
    this._syncToolbarActions();
    this._setStatus('Loading files...', 'info');
    this._renderListBody([]);
    try {
      const cfg = getGithubStorageConfig() || {};
      const repoFulls = normalizeRepoFullList(cfg?.repoFulls || cfg?.repoFull || '');
      const [localRecords, remoteRecords, localFolders, remoteFolders] = await Promise.all([
        listComponentRecords({ source: 'local' }),
        listComponentRecords({ source: 'github', repoFulls }),
        listWorkspaceFolders({ source: 'local' }),
        listWorkspaceFolders({ source: 'github', repoFulls }),
      ]);

      const mergedRecords = [
        ...(Array.isArray(localRecords) ? localRecords : []),
        ...(Array.isArray(remoteRecords) ? remoteRecords : []),
      ];
      const uniqueRecords = new Map();
      for (const rec of mergedRecords) {
        const source = normalizeStorageSource(rec?.source);
        const repoFull = String(rec?.repoFull || '').trim();
        const path = normalizePath(rec?.path || rec?.name || '');
        if (!path) continue;
        const key = `${source}:${repoFull}:${path}`;
        if (!uniqueRecords.has(key)) uniqueRecords.set(key, rec);
      }
      this.records = Array.from(uniqueRecords.values()).sort((a, b) => {
        const aTime = Date.parse(a?.savedAt || '') || 0;
        const bTime = Date.parse(b?.savedAt || '') || 0;
        return bTime - aTime;
      });

      const mergedFolders = [
        ...(Array.isArray(localFolders) ? localFolders : []),
        ...(Array.isArray(remoteFolders) ? remoteFolders : []),
      ];
      const uniqueFolders = new Map();
      for (const folder of mergedFolders) {
        const source = normalizeStorageSource(folder?.source);
        const repoFull = String(folder?.repoFull || '').trim();
        const path = normalizePath(folder?.path || '');
        if (!path) continue;
        const key = `${source}:${repoFull}:${path}`;
        if (!uniqueFolders.has(key)) uniqueFolders.set(key, {
          source,
          repoFull,
          path,
          savedAt: folder?.savedAt || null,
        });
      }
      this.folderRecords = Array.from(uniqueFolders.values());

      const repoSet = new Set(repoFulls);
      for (const rec of this.records) {
        if (normalizeStorageSource(rec?.source) !== 'github') continue;
        const repo = String(rec?.repoFull || '').trim();
        if (repo) repoSet.add(repo);
      }
      for (const folder of this.folderRecords) {
        if (normalizeStorageSource(folder?.source) !== 'github') continue;
        const repo = String(folder?.repoFull || '').trim();
        if (repo) repoSet.add(repo);
      }
      const repos = Array.from(repoSet).sort((a, b) => a.localeCompare(b));
      this.roots = [
        { source: 'local', repoFull: '', label: 'Local Browser' },
        ...repos.map((repoFull) => ({ source: 'github', repoFull, label: repoFull })),
      ];
      this._syncSpecialRoots();

      this._ensureSelection();
      this._saveLocationPreference();
      this._setStatus('', 'info', true);
      this._render();
    } catch (err) {
      this.records = [];
      this.folderRecords = [];
      this.roots = [{ source: 'local', repoFull: '', label: 'Local Browser' }];
      this.workspaceTop = true;
      this.rootSource = 'local';
      this.rootRepoFull = '';
      this.path = '';
      this._saveLocationPreference();
      const msg = err && err.message ? err.message : String(err || 'Unknown error');
      this._setStatus(`Failed to load files: ${msg}`, 'error');
      this._render();
    } finally {
      this.loading = false;
      this._syncToolbarActions();
    }
  }

  getLocation() {
    return {
      workspaceTop: !!this.workspaceTop,
      source: normalizeStorageSource(this.rootSource),
      repoFull: String(this.rootRepoFull || '').trim(),
      path: normalizePath(this.path || ''),
    };
  }

  getRoots() {
    return Array.isArray(this.roots) ? this.roots.slice() : [];
  }

  setData({ records = [], folders = [], roots = [] } = {}, { render = true } = {}) {
    this.records = Array.isArray(records) ? records.slice() : [];
    this.folderRecords = Array.isArray(folders) ? folders.slice() : [];
    this.roots = Array.isArray(roots) ? roots.slice() : [];
    this._syncSpecialRoots();
    this._ensureSelection();
    if (render) this._render();
  }

  setSearchTerm(value = '', { render = true, syncInput = true } = {}) {
    this.searchTerm = String(value || '').trim().toLowerCase();
    if (syncInput && this.searchEl && this.searchEl.value !== this.searchTerm) {
      this.searchEl.value = this.searchTerm;
    }
    if (render) this._render();
  }

  getViewMode() {
    return this.viewMode;
  }

  setViewMode(mode, { persist = true } = {}) {
    this._setViewMode(mode, { persist });
  }

  hasStoredLocation() {
    return !!this._hasStoredLocation;
  }

  setLocation(location = {}, { persist = true } = {}) {
    const nextWorkspaceTop = !!location?.workspaceTop;
    if (nextWorkspaceTop) {
      this.workspaceTop = true;
      this.rootSource = 'local';
      this.rootRepoFull = '';
      this.path = '';
      if (persist) this._saveLocationPreference();
      this._emitLocationChange();
      this._render();
      return;
    }

    const source = normalizeStorageSource(location?.source || this.rootSource || 'local');
    const repoFull = source === 'github'
      ? String(location?.repoFull || this.rootRepoFull || '').trim()
      : '';
    const repoForLocal = source === 'github' ? repoFull : String(location?.repoFull || this.rootRepoFull || '').trim();
    const isTrash = isTrashRoot(source, repoForLocal);
    const path = normalizePath(location?.path || '') || (isTrash ? TRASH_FOLDER_NAME : '');

    this.workspaceTop = false;
    this.rootSource = source;
    this.rootRepoFull = source === 'github' ? repoFull : repoForLocal;
    this.path = path;
    this._ensureSelection();
    if (this.workspaceTop) this.path = '';
    if (persist) this._saveLocationPreference();
    this._emitLocationChange();
    this._render();
  }

  _applyStoredLocation() {
    const location = loadStoredExplorerLocation();
    if (!location) return;
    this._hasStoredLocation = true;
    this.workspaceTop = !!location.workspaceTop;
    this.rootSource = normalizeStorageSource(location.source || 'local');
    this.rootRepoFull = this.rootSource === 'github' ? String(location.repoFull || '').trim() : '';
    this.path = this.workspaceTop ? '' : normalizePath(location.path || '');
  }

  _syncSpecialRoots() {
    const current = Array.isArray(this.roots) ? this.roots.slice() : [];
    const rootsWithoutTrash = current.filter((entry) =>
      !isTrashRoot(entry?.source, entry?.repoFull),
    );
    const hasTrashEntries = this.records.some((entry) =>
      isTrashPath(entry?.path || entry?.name || ''),
    ) || this.folderRecords.some((entry) =>
      isTrashPath(entry?.path || ''),
    );
    if (!hasTrashEntries) {
      this.roots = rootsWithoutTrash;
      return;
    }
    const trashRoot = {
      source: 'local',
      repoFull: TRASH_ROOT_REPO_FULL,
      label: 'Trash',
      isTrash: true,
    };
    const localIdx = rootsWithoutTrash.findIndex((entry) =>
      normalizeStorageSource(entry?.source) === 'local'
      && String(entry?.repoFull || '').trim() === '',
    );
    if (localIdx >= 0) {
      rootsWithoutTrash.splice(localIdx + 1, 0, trashRoot);
    } else {
      rootsWithoutTrash.unshift(trashRoot);
    }
    this.roots = rootsWithoutTrash;
  }

  _saveLocationPreference() {
    const payload = {
      workspaceTop: !!this.workspaceTop,
      rootSource: normalizeStorageSource(this.rootSource),
      rootRepoFull: String(this.rootRepoFull || '').trim(),
      path: normalizePath(this.path || ''),
    };
    if (payload.workspaceTop) payload.path = '';
    payload.source = payload.rootSource;
    payload.repoFull = payload.rootRepoFull;
    saveUiPreference(EXPLORER_LOCATION_PREF_KEY, JSON.stringify(payload));
    this._hasStoredLocation = true;
  }

  _emitLocationChange() {
    if (!this.onLocationChange) return;
    try {
      this.onLocationChange(this.getLocation());
    } catch {
      // Ignore consumer callback failures.
    }
  }

  _emitViewModeChange() {
    if (!this.onViewModeChange) return;
    try {
      this.onViewModeChange(this.viewMode);
    } catch {
      // Ignore consumer callback failures.
    }
  }

  _setViewMode(mode, { persist = true } = {}) {
    const next = normalizeViewMode(mode);
    if (this.viewMode === next) {
      this._syncViewModeUi();
      return;
    }
    this.viewMode = next;
    if (persist) saveUiPreference(EXPLORER_VIEW_MODE_PREF_KEY, this.viewMode);
    this._emitViewModeChange();
    this._syncViewModeUi();
    this._render();
  }

  _ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('workspace-file-browser-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'workspace-file-browser-widget-styles';
    style.textContent = `
      .wfb {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: 10px;
        color: #d9e6ff;
        font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .wfb.is-auto-height {
        height: auto;
      }
      .wfb-toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .wfb-view-toggle {
        display: inline-flex;
        align-items: center;
        border: 1px solid rgba(122, 162, 247, 0.35);
        border-radius: 10px;
        background: rgba(9, 16, 35, 0.62);
        overflow: hidden;
        flex: 0 0 auto;
      }
      .wfb-view-btn {
        appearance: none;
        border: 0;
        background: transparent;
        color: #c8dbff;
        min-height: 30px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .wfb-view-btn:hover {
        background: rgba(23, 46, 95, 0.6);
      }
      .wfb-view-btn.is-active {
        background: rgba(40, 76, 149, 0.72);
        color: #f2f7ff;
      }
      .wfb-search {
        flex: 1 1 auto;
        min-width: 0;
        border: 1px solid rgba(122, 162, 247, 0.35);
        background: rgba(9, 16, 35, 0.72);
        color: #d8e6ff;
        border-radius: 8px;
        padding: 8px 11px;
      }
      .wfb-search:focus {
        outline: none;
        border-color: rgba(122, 162, 247, 0.85);
        box-shadow: 0 0 0 2px rgba(122, 162, 247, 0.2);
      }
      .wfb-btn {
        appearance: none;
        border: 1px solid rgba(122, 162, 247, 0.35);
        background: rgba(9, 16, 35, 0.7);
        color: #d8e6ff;
        border-radius: 8px;
        min-height: 30px;
        padding: 6px 10px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        transition: border-color .12s ease, filter .12s ease, background-color .12s ease;
      }
      .wfb-btn:hover {
        border-color: rgba(122, 162, 247, 0.85);
        background: rgba(30, 57, 116, 0.72);
        filter: brightness(1.04);
      }
      .wfb-btn:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      .wfb-btn.wfb-btn-danger {
        border-color: rgba(248, 113, 113, 0.42);
        color: #ffd3d3;
      }
      .wfb-btn.wfb-btn-danger:hover:not(:disabled) {
        border-color: rgba(248, 113, 113, 0.8);
        background: rgba(94, 30, 47, 0.72);
      }
      .wfb-toolbar-actions {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }
      .wfb-status {
        min-height: 18px;
        color: #9eb0d8;
        font-size: 12px;
      }
      .wfb-status[data-tone="error"] { color: #ffd1d1; }
      .wfb-status[data-tone="ok"] { color: #b2f2cc; }
      .wfb-nav {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
        min-width: 0;
      }
      .wfb-crumbs {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        min-width: 0;
        overflow-x: auto;
      }
      .wfb-crumb {
        appearance: none;
        border: 1px solid rgba(122, 162, 247, 0.35);
        background: rgba(9, 16, 35, 0.7);
        color: #d8e6ff;
        border-radius: 999px;
        min-height: 26px;
        padding: 3px 9px;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        transition: filter .12s ease, border-color .12s ease;
      }
      .wfb-crumb:hover { filter: brightness(1.08); }
      .wfb-crumb.is-active {
        border-color: rgba(122, 162, 247, 0.85);
        background: rgba(25, 51, 109, 0.78);
        color: #f2f7ff;
      }
      .wfb-crumb:disabled {
        opacity: .65;
        cursor: not-allowed;
      }
      .wfb-sep {
        color: #7e95c7;
        font-size: 12px;
      }
      .wfb-meta {
        color: #9cb1dd;
        margin-left: auto;
        font-size: 11px;
        white-space: nowrap;
      }
      .wfb-table {
        border: 1px solid rgba(136, 170, 235, 0.2);
        border-radius: 10px;
        overflow: hidden;
        background: rgba(6, 12, 28, 0.72);
        box-shadow: inset 0 1px 0 rgba(130, 160, 224, 0.08);
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
      }
      .wfb.is-auto-height .wfb-table {
        flex: 0 0 auto;
      }
      .wfb-head,
      .wfb-row {
        display: grid;
        grid-template-columns: minmax(84px, auto) minmax(220px, 1.8fr) minmax(80px, .6fr) minmax(180px, 1.2fr);
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
      }
      .wfb-head {
        background: rgba(14, 25, 53, 0.58);
        border-bottom: 1px solid rgba(136, 170, 235, 0.16);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #a9bce8;
        font-size: 11px;
      }
      .wfb-head > div,
      .wfb-row > div {
        min-width: 0;
      }
      .wfb-body {
        overflow: auto;
        flex: 1 1 auto;
      }
      .wfb.is-auto-height .wfb-body {
        overflow: visible;
        flex: 0 0 auto;
      }
      .wfb.is-icons .wfb-head {
        display: none;
      }
      .wfb-body.is-icons {
        --wfb-tile-size: 132px;
        padding: 12px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--wfb-tile-size) + 42px)), 1fr));
        gap: 14px;
        align-content: start;
      }
      .wfb-body.is-icons > * {
        min-width: 0;
      }
      .wfb-row {
        border-top: 1px solid rgba(136, 170, 235, 0.1);
        min-height: 87px;
        transition: background-color .14s ease;
      }
      .wfb-row:hover {
        background: rgba(12, 24, 50, 0.56);
      }
      .wfb-actions {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        flex-wrap: wrap;
      }
      .wfb-name-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-preview {
        position: relative;
        flex: 0 0 auto;
        width: 63px;
        height: 63px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid rgba(117, 146, 209, 0.32);
        background: linear-gradient(160deg, rgba(11, 18, 40, 0.85), rgba(8, 11, 26, 0.9));
        overflow: hidden;
      }
      .wfb-preview-icon {
        font-size: 36px;
        line-height: 1.15;
        transform: translateY(1px);
      }
      .wfb-preview-thumb {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: 8px;
        border: 0;
        background: transparent;
        object-fit: cover;
        display: none;
      }
      .wfb-preview.has-thumb .wfb-preview-thumb { display: block; }
      .wfb-preview.has-thumb .wfb-preview-icon { display: none; }
      .wfb-name-text {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-open-target {
        cursor: pointer;
      }
      .wfb-open-target:focus-visible {
        outline: 2px solid rgba(122, 162, 247, 0.75);
        outline-offset: 2px;
      }
      .wfb-kind {
        color: #8fa3cd;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-modified {
        color: #889dc9;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-empty {
        padding: 18px;
        color: #9eb0d8;
        font-size: 14px;
        text-align: center;
      }
      .wfb-tile {
        appearance: none;
        width: 100%;
        border: 1px solid rgba(136, 170, 235, 0.16);
        border-radius: 12px;
        background: rgba(10, 18, 38, 0.7);
        box-shadow: 0 8px 18px rgba(2, 8, 22, 0.24);
        color: inherit;
        text-align: center;
        padding: 12px;
        display: grid;
        justify-items: center;
        align-content: start;
        gap: 10px;
        cursor: pointer;
        position: relative;
        transition: border-color .16s ease, background-color .16s ease, transform .16s ease, box-shadow .16s ease;
      }
      .wfb-tile:hover {
        border-color: rgba(122, 162, 247, 0.42);
        background: rgba(14, 27, 56, 0.82);
        box-shadow: 0 16px 30px rgba(2, 8, 22, 0.3);
        transform: translateY(-2px);
      }
      .wfb-tile:active {
        transform: translateY(0);
      }
      .wfb-tile:focus-visible {
        outline: 2px solid rgba(122, 162, 247, 0.75);
        outline-offset: 1px;
      }
      .wfb-tile-preview {
        position: relative;
        width: min(100%, var(--wfb-tile-size));
        aspect-ratio: 1 / 1;
        height: auto;
        border-radius: 12px;
        border: 1px solid rgba(117, 146, 209, 0.36);
        background: linear-gradient(160deg, rgba(11, 18, 40, 0.85), rgba(8, 11, 26, 0.9));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .wfb-tile-icon {
        font-size: calc(var(--wfb-tile-size) * 0.5);
        line-height: 1;
      }
      .wfb-tile-thumb {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: none;
      }
      .wfb-tile-preview.has-thumb .wfb-tile-icon {
        display: none;
      }
      .wfb-tile-preview.has-thumb .wfb-tile-thumb {
        display: block;
      }
      .wfb-tile-name {
        width: 100%;
        color: #deebff;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.3;
        letter-spacing: 0.01em;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow-wrap: anywhere;
      }
      .wfb-tile-action {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 2;
      }
      .wfb-tile.is-file .wfb-tile-action {
        border-color: rgba(122, 162, 247, 0.52);
        background: rgba(8, 15, 35, 0.78);
      }
      .wfb-tile-empty {
        grid-column: 1 / -1;
      }
    `;
    document.head.appendChild(style);
  }

  _buildUI() {
    this.root = document.createElement('section');
    this.root.className = 'wfb';
    if (!this.scrollBody) this.root.classList.add('is-auto-height');
    this.container.innerHTML = '';
    this.container.appendChild(this.root);

    const toolbar = document.createElement('div');
    toolbar.className = 'wfb-toolbar';
    this.searchEl = document.createElement('input');
    this.searchEl.type = 'search';
    this.searchEl.className = 'wfb-search';
    this.searchEl.placeholder = 'Search files by full path...';
    this.searchEl.addEventListener('input', () => {
      this.searchTerm = String(this.searchEl.value || '').trim().toLowerCase();
      this._render();
    });
    if (!this.showSearchInput) this.searchEl.hidden = true;
    toolbar.appendChild(this.searchEl);

    this.viewToggleEl = document.createElement('div');
    this.viewToggleEl.className = 'wfb-view-toggle';
    this.listViewBtn = document.createElement('button');
    this.listViewBtn.type = 'button';
    this.listViewBtn.className = 'wfb-view-btn';
    this.listViewBtn.textContent = 'List';
    this.listViewBtn.addEventListener('click', () => this._setViewMode('list'));
    this.viewToggleEl.appendChild(this.listViewBtn);
    this.iconsViewBtn = document.createElement('button');
    this.iconsViewBtn.type = 'button';
    this.iconsViewBtn.className = 'wfb-view-btn';
    this.iconsViewBtn.textContent = 'Icons';
    this.iconsViewBtn.addEventListener('click', () => this._setViewMode('icons'));
    this.viewToggleEl.appendChild(this.iconsViewBtn);
    if (!this.showViewToggle) this.viewToggleEl.hidden = true;
    toolbar.appendChild(this.viewToggleEl);

    this.toolbarActionsEl = document.createElement('div');
    this.toolbarActionsEl.className = 'wfb-toolbar-actions';
    if (this.showCreateFolderButton) {
      this.createFolderBtn = document.createElement('button');
      this.createFolderBtn.type = 'button';
      this.createFolderBtn.className = 'wfb-btn';
      this.createFolderBtn.textContent = 'New Folder';
      this.createFolderBtn.addEventListener('click', () => { void this._handleCreateFolder(); });
      this.toolbarActionsEl.appendChild(this.createFolderBtn);
    }
    if (this.showDeleteFolderButton) {
      this.deleteFolderBtn = document.createElement('button');
      this.deleteFolderBtn.type = 'button';
      this.deleteFolderBtn.className = 'wfb-btn wfb-btn-danger';
      this.deleteFolderBtn.textContent = 'Delete Folder';
      this.deleteFolderBtn.addEventListener('click', () => { void this._handleDeleteFolder(); });
      this.toolbarActionsEl.appendChild(this.deleteFolderBtn);
    }
    if (this.showEmptyTrashButton) {
      this.emptyTrashBtn = document.createElement('button');
      this.emptyTrashBtn.type = 'button';
      this.emptyTrashBtn.className = 'wfb-btn wfb-btn-danger';
      this.emptyTrashBtn.textContent = 'Empty Trash';
      this.emptyTrashBtn.addEventListener('click', () => { void this._handleEmptyTrash(); });
      this.toolbarActionsEl.appendChild(this.emptyTrashBtn);
    }
    if (this.showUpButton) {
      this.upBtn = document.createElement('button');
      this.upBtn.type = 'button';
      this.upBtn.className = 'wfb-btn';
      this.upBtn.textContent = 'Up';
      this.upBtn.addEventListener('click', () => this._navigateUp());
      this.toolbarActionsEl.appendChild(this.upBtn);
    }
    if (!this.toolbarActionsEl.children.length) this.toolbarActionsEl.hidden = true;
    toolbar.appendChild(this.toolbarActionsEl);

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.type = 'button';
    this.refreshBtn.className = 'wfb-btn';
    this.refreshBtn.textContent = 'Refresh';
    this.refreshBtn.addEventListener('click', () => { void this.reload(); });
    if (!this.showRefreshButton) this.refreshBtn.hidden = true;
    toolbar.appendChild(this.refreshBtn);
    const actionsHidden = !this.toolbarActionsEl || this.toolbarActionsEl.hidden;
    if (this.searchEl.hidden && this.viewToggleEl.hidden && actionsHidden && this.refreshBtn.hidden) toolbar.hidden = true;
    this.root.appendChild(toolbar);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'wfb-status';
    this.root.appendChild(this.statusEl);

    this.navEl = document.createElement('div');
    this.navEl.className = 'wfb-nav';
    this.root.appendChild(this.navEl);

    this.tableEl = document.createElement('div');
    this.tableEl.className = 'wfb-table';

    this.headEl = document.createElement('div');
    this.headEl.className = 'wfb-head';
    this.headEl.innerHTML = '<div>Actions</div><div>Name</div><div>Kind</div><div>Modified</div>';
    this.tableEl.appendChild(this.headEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'wfb-body';
    this.tableEl.appendChild(this.bodyEl);
    this.root.appendChild(this.tableEl);

    this._syncViewModeUi();
    this._syncToolbarActions();
  }

  _setStatus(message, tone = 'info', forceHide = false) {
    if (!this.statusEl) return;
    if (forceHide || !message) {
      this.statusEl.hidden = true;
      this.statusEl.textContent = '';
      this.statusEl.dataset.tone = '';
      return;
    }
    this.statusEl.hidden = false;
    this.statusEl.textContent = String(message || '');
    this.statusEl.dataset.tone = tone;
  }

  _ensureSelection() {
    if (!this.roots.length) {
      this.workspaceTop = true;
      this.rootSource = 'local';
      this.rootRepoFull = '';
      this.path = '';
      return;
    }
    if (this.workspaceTop) return;
    const source = normalizeStorageSource(this.rootSource);
    const repo = String(this.rootRepoFull || '').trim();
    const exists = this.roots.some((root) =>
      normalizeStorageSource(root?.source) === source
      && String(root?.repoFull || '').trim() === repo,
    );
    if (exists) return;
    this.workspaceTop = true;
    this.rootSource = 'local';
    this.rootRepoFull = '';
    this.path = '';
  }

  _syncViewModeUi() {
    if (this.root) {
      this.root.classList.toggle('is-icons', this.viewMode === 'icons');
    }
    if (this.bodyEl) {
      this.bodyEl.classList.toggle('is-icons', this.viewMode === 'icons');
      this.bodyEl.style.setProperty('--wfb-tile-size', `${this.iconSize}px`);
    }
    if (this.listViewBtn) {
      this.listViewBtn.classList.toggle('is-active', this.viewMode === 'list');
      this.listViewBtn.disabled = this.viewMode === 'list';
    }
    if (this.iconsViewBtn) {
      this.iconsViewBtn.classList.toggle('is-active', this.viewMode === 'icons');
      this.iconsViewBtn.disabled = this.viewMode === 'icons';
    }
  }

  _syncToolbarActions() {
    const hasRoot = !this.workspaceTop;
    const hasPath = !!normalizePath(this.path || '');
    const canNavigateUp = !this.workspaceTop || hasPath;
    const isTrash = this._isTrashRootSelected();
    const disabled = this.loading || this.actionBusy;
    if (this.createFolderBtn) this.createFolderBtn.disabled = disabled || !hasRoot || isTrash;
    if (this.deleteFolderBtn) this.deleteFolderBtn.disabled = disabled || !hasRoot || !hasPath || isTrash;
    if (this.emptyTrashBtn) {
      this.emptyTrashBtn.hidden = !isTrash;
      this.emptyTrashBtn.disabled = disabled || !isTrash;
    }
    if (this.upBtn) this.upBtn.disabled = disabled || !canNavigateUp;
  }

  _navigateUp() {
    if (this.workspaceTop) return;
    const currentPath = normalizePath(this.path || '');
    if (currentPath) {
      const idx = currentPath.lastIndexOf('/');
      this._setPath(idx >= 0 ? currentPath.slice(0, idx) : '');
      return;
    }
    this._setWorkspaceTop();
  }

  async _runToolbarAction(task, fallbackErrorPrefix = 'Action failed') {
    if (this.loading || this.actionBusy) return;
    this.actionBusy = true;
    this._syncToolbarActions();
    try {
      await task();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err || 'Unknown error');
      this._setStatus(`${fallbackErrorPrefix}: ${msg}`, 'error');
    } finally {
      this.actionBusy = false;
      this._syncToolbarActions();
    }
  }

  async _handleCreateFolder() {
    if (!this.showCreateFolderButton) return;
    if (this._isTrashRootSelected()) {
      this._setStatus('Creating folders inside Trash is disabled.', 'error');
      return;
    }
    if (this.workspaceTop) {
      this._setStatus('Select a workspace folder before creating a folder.', 'error');
      return;
    }
    if (!this.onCreateFolder) {
      this._setStatus('Folder creation is not available in this view.', 'error');
      return;
    }
    const currentPath = normalizePath(this.path || '');
    const entered = await prompt(
      currentPath
        ? `Create folder inside "${currentPath}" (relative path):`
        : 'Create folder at workspace root (path):',
      '',
    );
    if (entered == null) return;
    const raw = String(entered || '').trim();
    if (!raw) return;
    const targetPath = raw.startsWith('/')
      ? normalizePath(raw)
      : normalizePath(currentPath ? `${currentPath}/${raw}` : raw);
    if (!targetPath) {
      this._setStatus('Enter a valid folder path.', 'error');
      return;
    }
    const location = this.getLocation();
    await this._runToolbarAction(async () => {
      await this.onCreateFolder({
        ...location,
        currentPath,
        targetPath,
      });
    }, 'Create folder failed');
  }

  async _handleDeleteFolder() {
    if (!this.showDeleteFolderButton) return;
    if (this._isTrashRootSelected()) {
      this._setStatus('Deleting folders from the Trash root is disabled.', 'error');
      return;
    }
    const currentPath = normalizePath(this.path || '');
    if (!currentPath) {
      this._setStatus('Open a folder before deleting it.', 'error');
      return;
    }
    if (!this.onDeleteFolder) {
      this._setStatus('Folder deletion is not available in this view.', 'error');
      return;
    }
    const location = this.getLocation();
    await this._runToolbarAction(async () => {
      await this.onDeleteFolder({
        ...location,
        path: currentPath,
      });
    }, 'Delete folder failed');
  }

  _collectTrashEntries() {
    const files = [];
    const folders = [];
    for (const entry of Array.isArray(this.records) ? this.records : []) {
      const path = normalizePath(entry?.path || entry?.name || '');
      if (!isTrashPath(path)) continue;
      files.push(entry);
    }
    for (const entry of Array.isArray(this.folderRecords) ? this.folderRecords : []) {
      const path = normalizePath(entry?.path || '');
      if (!isTrashPath(path)) continue;
      folders.push(entry);
    }
    return { files, folders };
  }

  async _emptyTrashDirect(files = [], folders = []) {
    let failed = 0;
    for (const entry of files) {
      const path = normalizePath(entry?.path || entry?.name || '');
      if (!isTrashPath(path)) continue;
      const source = normalizeStorageSource(entry?.source);
      const repoFull = String(entry?.repoFull || '').trim();
      const branch = String(entry?.branch || '').trim();
      const scope = { source, repoFull, path };
      if (branch) scope.branch = branch;
      try {
        await removeComponentRecord(path, scope);
      } catch {
        failed += 1;
      }
    }
    for (const folder of folders.slice().sort((a, b) => String(b?.path || '').length - String(a?.path || '').length)) {
      const path = normalizePath(folder?.path || '');
      if (!isTrashPath(path)) continue;
      const source = normalizeStorageSource(folder?.source);
      const repoFull = String(folder?.repoFull || '').trim();
      const scope = { source, repoFull };
      try {
        await removeWorkspaceFolder(path, scope);
      } catch {
        // Ignore marker removal failures.
      }
    }
    await this.reload();
    if (failed) {
      this._setStatus(`Emptied Trash with ${failed} deletion failure${failed === 1 ? '' : 's'}.`, 'error');
    } else {
      this._setStatus('Trash emptied.', 'ok');
    }
  }

  async _handleEmptyTrash() {
    if (!this.showEmptyTrashButton) return;
    if (!this._isTrashRootSelected()) {
      this._setStatus('Open Trash to empty it.', 'error');
      return;
    }
    const { files, folders } = this._collectTrashEntries();
    if (!files.length && !folders.length) {
      this._setStatus('Trash is already empty.', 'info');
      return;
    }
    const ok = await confirm(
      `Permanently delete ${files.length} file${files.length === 1 ? '' : 's'} from Trash? This cannot be undone.`,
    );
    if (!ok) return;
    await this._runToolbarAction(async () => {
      if (this.onEmptyTrash) {
        await this.onEmptyTrash({ files, folders, location: this.getLocation() });
        return;
      }
      await this._emptyTrashDirect(files, folders);
    }, 'Empty Trash failed');
  }

  _setWorkspaceTop() {
    this.workspaceTop = true;
    this.rootSource = 'local';
    this.rootRepoFull = '';
    this.path = '';
    this._saveLocationPreference();
    this._emitLocationChange();
    this._render();
  }

  _setRoot(source, repoFull = '', rootEntry = null) {
    this.workspaceTop = false;
    this.rootSource = normalizeStorageSource(source);
    this.rootRepoFull = String(repoFull || '').trim();
    this.path = (isTrashRoot(this.rootSource, this.rootRepoFull) || !!rootEntry?.isTrash)
      ? TRASH_FOLDER_NAME
      : '';
    this._saveLocationPreference();
    this._emitLocationChange();
    this._render();
  }

  _setPath(path) {
    this.path = normalizePath(path);
    this._saveLocationPreference();
    this._emitLocationChange();
    this._render();
  }

  _getCurrentRootScope() {
    return {
      source: normalizeStorageSource(this.rootSource || 'local'),
      repoFull: String(this.rootRepoFull || '').trim(),
    };
  }

  _isTrashRootSelected() {
    return isTrashRoot(this.rootSource, this.rootRepoFull);
  }

  _attachDropTarget(el, target) {
    if (!el || !this.bindDropTarget) return;
    try {
      this.bindDropTarget(el, target);
    } catch {
      // Ignore host drop-target binding failures.
    }
  }

  _attachFileDragSource(el, entry) {
    if (!el || !entry || !this.bindFileDragSource) return;
    try {
      this.bindFileDragSource(el, entry);
    } catch {
      // Ignore host drag-source binding failures.
    }
  }

  _createEntryActionsMenu(type, entry, { tile = false } = {}) {
    try {
      if (type === 'file' && this.createFileActionsMenu) {
        return this.createFileActionsMenu(entry, { tile }) || null;
      }
      if (type === 'folder' && this.createFolderActionsMenu) {
        if (this._isTrashRootSelected()) return null;
        const scope = this._getCurrentRootScope();
        return this.createFolderActionsMenu(entry, {
          tile,
          source: scope.source,
          repoFull: scope.repoFull,
        }) || null;
      }
    } catch {
      // Ignore host menu builder failures.
    }
    return null;
  }

  _recordsForRoot(source, repoFull = '') {
    if (isTrashRoot(source, repoFull)) {
      return this.records.filter((entry) => isTrashPath(entry?.path || entry?.name || ''));
    }
    const src = normalizeStorageSource(source);
    const repo = String(repoFull || '').trim();
    return this.records.filter((entry) => {
      if (normalizeStorageSource(entry?.source) !== src) return false;
      if (src === 'local') return true;
      return String(entry?.repoFull || '').trim() === repo;
    });
  }

  _foldersForRoot(source, repoFull = '') {
    if (isTrashRoot(source, repoFull)) {
      return this.folderRecords.filter((entry) => isTrashPath(entry?.path || ''));
    }
    const src = normalizeStorageSource(source);
    const repo = String(repoFull || '').trim();
    return this.folderRecords.filter((entry) => {
      if (normalizeStorageSource(entry?.source) !== src) return false;
      if (src === 'local') return true;
      return String(entry?.repoFull || '').trim() === repo;
    });
  }

  _render() {
    this._syncViewModeUi();
    this._syncToolbarActions();
    this._renderNav();
    const renderItems = (items) => {
      if (this.viewMode === 'icons') this._renderIconBody(items);
      else this._renderListBody(items);
    };
    if (this.searchTerm) {
      const matched = this.records
        .filter((entry) => entryMatchesSearch(entry, this.searchTerm))
        .sort((a, b) => {
          const aTime = Date.parse(a?.savedAt || '') || 0;
          const bTime = Date.parse(b?.savedAt || '') || 0;
          return bTime - aTime;
        });
      if (!matched.length) {
        renderItems([{ type: 'empty', text: `No files match "${this.searchTerm}".` }]);
        return;
      }
      renderItems(matched.map((entry) => ({ type: 'file', entry })));
      return;
    }

    if (this.workspaceTop) {
      if (!this.roots.length) {
        renderItems([{ type: 'empty', text: 'No workspace folders configured yet.' }]);
        return;
      }
      renderItems(this.roots.map((entry) => ({ type: 'root', entry })));
      return;
    }

    const source = normalizeStorageSource(this.rootSource);
    const repoFull = String(this.rootRepoFull || '').trim();
    const root = this.roots.find((entry) =>
      normalizeStorageSource(entry?.source) === source
      && String(entry?.repoFull || '').trim() === repoFull,
    );
    if (!root) {
      renderItems([{ type: 'empty', text: 'Select a workspace folder to browse.' }]);
      return;
    }

    const { folders, files } = collectFolderEntries(
      this._recordsForRoot(source, repoFull),
      this._foldersForRoot(source, repoFull),
      this.path,
    );
    if (!folders.length && !files.length) {
      renderItems([{ type: 'empty', text: 'This folder is empty.' }]);
      return;
    }

    const rows = [
      ...folders.map((entry) => ({ type: 'folder', entry })),
      ...files.map((entry) => ({ type: 'file', entry })),
    ];
    renderItems(rows);
  }

  _renderNav() {
    if (!this.navEl) return;
    this.navEl.innerHTML = '';

    const crumbs = document.createElement('div');
    crumbs.className = 'wfb-crumbs';

    const workspaceBtn = document.createElement('button');
    workspaceBtn.type = 'button';
    workspaceBtn.className = `wfb-crumb${this.workspaceTop && !this.searchTerm ? ' is-active' : ''}`;
    workspaceBtn.textContent = 'Workspace';
    workspaceBtn.disabled = this.workspaceTop && !this.searchTerm;
    workspaceBtn.addEventListener('click', () => this._setWorkspaceTop());
    crumbs.appendChild(workspaceBtn);

    const appendSep = () => {
      const sep = document.createElement('span');
      sep.className = 'wfb-sep';
      sep.textContent = '/';
      crumbs.appendChild(sep);
    };

    if (this.searchTerm) {
      appendSep();
      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.className = 'wfb-crumb is-active';
      searchBtn.textContent = 'Search Results';
      searchBtn.disabled = true;
      crumbs.appendChild(searchBtn);
    } else if (!this.workspaceTop) {
      const rootSource = normalizeStorageSource(this.rootSource);
      const rootRepo = String(this.rootRepoFull || '').trim();
      const trashRoot = isTrashRoot(rootSource, rootRepo);
      const root = this.roots.find((entry) =>
        normalizeStorageSource(entry?.source) === rootSource
        && String(entry?.repoFull || '').trim() === rootRepo,
      );
      if (root) {
        appendSep();
        const rootBtn = document.createElement('button');
        rootBtn.type = 'button';
        rootBtn.className = `wfb-crumb${!this.path ? ' is-active' : ''}`;
        rootBtn.textContent = String(root?.label || rootRepo || 'Root');
        rootBtn.disabled = !this.path;
        rootBtn.addEventListener('click', () => this._setPath(''));
        crumbs.appendChild(rootBtn);
        if (!trashRoot) {
          this._attachDropTarget(rootBtn, {
            source: rootSource,
            repoFull: rootRepo,
            path: '',
          });
        }
      }
      if (this.path) {
        const parts = this.path.split('/').filter(Boolean);
        let partial = '';
        for (const part of parts) {
          partial = partial ? `${partial}/${part}` : part;
          const crumbPath = partial;
          appendSep();
          const partBtn = document.createElement('button');
          partBtn.type = 'button';
          partBtn.className = `wfb-crumb${crumbPath === this.path ? ' is-active' : ''}`;
          partBtn.textContent = part;
          partBtn.disabled = crumbPath === this.path;
          partBtn.addEventListener('click', () => this._setPath(crumbPath));
          crumbs.appendChild(partBtn);
          if (!trashRoot) {
            this._attachDropTarget(partBtn, {
              source: rootSource,
              repoFull: rootRepo,
              path: crumbPath,
            });
          }
        }
      }
    }
    this.navEl.appendChild(crumbs);

    const right = document.createElement('div');
    right.className = 'wfb-meta';
    if (this.searchTerm) {
      const count = this.records.filter((entry) => entryMatchesSearch(entry, this.searchTerm)).length;
      right.textContent = `${count} result${count === 1 ? '' : 's'}`;
    } else if (!this.workspaceTop) {
      const source = normalizeStorageSource(this.rootSource);
      const repoFull = String(this.rootRepoFull || '').trim();
      const { folders, files } = collectFolderEntries(
        this._recordsForRoot(source, repoFull),
        this._foldersForRoot(source, repoFull),
        this.path,
      );
      right.textContent = `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${files.length} file${files.length === 1 ? '' : 's'}`;
    } else {
      right.textContent = `${this.roots.length} folder${this.roots.length === 1 ? '' : 's'}`;
    }
    this.navEl.appendChild(right);
  }

  _renderListBody(items = []) {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'wfb-empty';
      empty.textContent = 'No entries.';
      this.bodyEl.appendChild(empty);
      return;
    }

    for (const item of list) {
      if (item?.type === 'empty') {
        const empty = document.createElement('div');
        empty.className = 'wfb-empty';
        empty.textContent = String(item.text || 'No entries.');
        this.bodyEl.appendChild(empty);
        continue;
      }
      const row = this._createRow(item);
      if (row) this.bodyEl.appendChild(row);
    }
  }

  _renderIconBody(items = []) {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'wfb-empty wfb-tile-empty';
      empty.textContent = 'No entries.';
      this.bodyEl.appendChild(empty);
      return;
    }
    for (const item of list) {
      if (item?.type === 'empty') {
        const empty = document.createElement('div');
        empty.className = 'wfb-empty wfb-tile-empty';
        empty.textContent = String(item.text || 'No entries.');
        this.bodyEl.appendChild(empty);
        continue;
      }
      const tile = this._createTile(item);
      if (tile) this.bodyEl.appendChild(tile);
    }
  }

  _createTile(item) {
    const type = String(item?.type || '').trim();
    if (!type) return null;
    const entry = item?.entry || null;

    if (type === 'root') {
      const source = normalizeStorageSource(entry?.source);
      const repoFull = String(entry?.repoFull || '').trim();
      const trashRoot = isTrashRoot(source, repoFull) || !!entry?.isTrash;
      const label = String(entry?.label || (source === 'local' ? 'Local Browser' : repoFull)).trim() || 'Workspace';
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'wfb-tile is-root is-folder';
      tile.title = label;
      tile.addEventListener('click', () => this._setRoot(source, repoFull, entry));

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'wfb-btn wfb-tile-action';
      actionBtn.textContent = 'Open';
      actionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._setRoot(source, repoFull, entry);
      });
      tile.appendChild(actionBtn);

      const preview = document.createElement('span');
      preview.className = 'wfb-tile-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-tile-icon';
      icon.textContent = trashRoot ? '🗑️' : (source === 'local' ? '🖥️' : '🗂️');
      icon.setAttribute('aria-hidden', 'true');
      preview.appendChild(icon);
      tile.appendChild(preview);

      const name = document.createElement('div');
      name.className = 'wfb-tile-name';
      name.textContent = label;
      name.title = label;
      tile.appendChild(name);
      if (!trashRoot) {
        this._attachDropTarget(tile, { source, repoFull, path: '' });
      }
      return tile;
    }

    if (type === 'folder') {
      const folderPath = normalizePath(entry?.path || '');
      const label = String(entry?.name || '').trim() || 'Folder';
      const openFolder = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._setPath(folderPath);
      };
      const tile = document.createElement('article');
      tile.className = 'wfb-tile is-folder';
      tile.title = folderPath || label;
      tile.tabIndex = 0;
      tile.addEventListener('click', () => this._setPath(folderPath));
      tile.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' || event.key === ' ') openFolder(event);
      });

      const actionsMenu = this._createEntryActionsMenu('folder', entry, { tile: true });
      if (actionsMenu) {
        tile.appendChild(actionsMenu);
      } else {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'wfb-btn wfb-tile-action';
        actionBtn.textContent = 'Open';
        actionBtn.addEventListener('click', openFolder);
        tile.appendChild(actionBtn);
      }

      const preview = document.createElement('span');
      preview.className = 'wfb-tile-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-tile-icon';
      icon.textContent = '📁';
      icon.setAttribute('aria-hidden', 'true');
      preview.appendChild(icon);
      tile.appendChild(preview);

      const name = document.createElement('div');
      name.className = 'wfb-tile-name';
      name.textContent = label;
      name.title = folderPath || label;
      tile.appendChild(name);
      const { source: scopeSource, repoFull: scopeRepoFull } = this._getCurrentRootScope();
      if (!this._isTrashRootSelected()) {
        this._attachDropTarget(tile, { source: scopeSource, repoFull: scopeRepoFull, path: folderPath });
      }
      return tile;
    }

    if (type === 'file') {
      const pathValue = normalizePath(entry?.path || entry?.name || '');
      if (!pathValue) return null;
      const displayName = getEntryDisplayName(entry);
      const fullPath = getEntryFullPathTooltip(entry) || getEntryModelPathWithExtension(entry);
      const pickFile = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        void this._handleActivateFile(entry);
      };

      const tile = document.createElement('article');
      tile.className = 'wfb-tile is-file';
      tile.title = fullPath || displayName;
      tile.tabIndex = 0;
      tile.addEventListener('dblclick', pickFile);
      tile.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Enter') pickFile(event);
      });

      const actionsMenu = this._createEntryActionsMenu('file', entry, { tile: true });
      if (actionsMenu) {
        tile.appendChild(actionsMenu);
      } else {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'wfb-btn wfb-tile-action';
        actionBtn.textContent = this.fileActionLabel;
        actionBtn.addEventListener('click', pickFile);
        tile.appendChild(actionBtn);
      }

      const preview = document.createElement('span');
      preview.className = 'wfb-tile-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-tile-icon';
      icon.textContent = '📄';
      icon.setAttribute('aria-hidden', 'true');
      preview.appendChild(icon);
      const thumb = document.createElement('img');
      thumb.className = 'wfb-tile-thumb';
      thumb.alt = `${displayName} preview`;
      thumb.addEventListener('load', () => preview.classList.add('has-thumb'));
      thumb.addEventListener('error', () => preview.classList.remove('has-thumb'));
      preview.appendChild(thumb);
      tile.appendChild(preview);
      preview.classList.add('wfb-open-target');
      preview.title = `Open ${displayName}`;
      preview.addEventListener('click', pickFile);
      void this._hydrateThumbnail(entry, thumb);

      const label = document.createElement('div');
      label.className = 'wfb-tile-name';
      label.classList.add('wfb-open-target');
      label.textContent = displayName;
      label.title = fullPath || displayName;
      label.addEventListener('click', pickFile);
      tile.appendChild(label);
      this._attachFileDragSource(tile, entry);
      return tile;
    }

    return null;
  }

  _createRow(item) {
    const type = String(item?.type || '').trim();
    if (!type) return null;
    const entry = item?.entry || null;

    const row = document.createElement('div');
    row.className = `wfb-row is-${type}`;

    const actionCell = document.createElement('div');
    actionCell.className = 'wfb-actions';
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'wfb-btn';
    actionCell.appendChild(actionBtn);
    row.appendChild(actionCell);

    const nameCell = document.createElement('div');
    nameCell.className = 'wfb-name-cell';
    row.appendChild(nameCell);

    const kindCell = document.createElement('div');
    kindCell.className = 'wfb-kind';
    row.appendChild(kindCell);

    const modifiedCell = document.createElement('div');
    modifiedCell.className = 'wfb-modified';
    row.appendChild(modifiedCell);

    if (type === 'root') {
      const source = normalizeStorageSource(entry?.source);
      const repoFull = String(entry?.repoFull || '').trim();
      const trashRoot = isTrashRoot(source, repoFull) || !!entry?.isTrash;
      const label = String(entry?.label || (source === 'local' ? 'Local Browser' : repoFull)).trim() || 'Workspace';
      const openRoot = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._setRoot(source, repoFull, entry);
      };
      row.title = label;
      row.tabIndex = 0;
      actionBtn.textContent = 'Open';
      actionBtn.addEventListener('click', openRoot);
      row.addEventListener('click', openRoot);
      row.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' || event.key === ' ') openRoot(event);
      });
      const icon = document.createElement('span');
      icon.className = 'wfb-preview-icon';
      icon.textContent = trashRoot ? '🗑️' : (source === 'local' ? '🖥️' : '🗂️');
      const preview = document.createElement('span');
      preview.className = 'wfb-preview';
      preview.appendChild(icon);
      nameCell.appendChild(preview);
      const name = document.createElement('span');
      name.className = 'wfb-name-text';
      name.textContent = label;
      nameCell.appendChild(name);
      kindCell.textContent = 'Workspace';
      modifiedCell.textContent = trashRoot
        ? 'Internal recycle folder'
        : (source === 'local' ? 'Local Browser storage' : (repoFull || 'GitHub repository'));
      if (!trashRoot) this._attachDropTarget(row, { source, repoFull, path: '' });
      return row;
    }

    if (type === 'folder') {
      const folderPath = normalizePath(entry?.path || '');
      const nameValue = String(entry?.name || '').trim() || 'Folder';
      const openFolder = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._setPath(folderPath);
      };
      row.title = folderPath || nameValue;
      row.tabIndex = 0;
      row.addEventListener('click', openFolder);
      row.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' || event.key === ' ') openFolder(event);
      });
      const actionsMenu = this._isTrashRootSelected()
        ? null
        : this._createEntryActionsMenu('folder', entry, { tile: false });
      if (actionsMenu) {
        actionCell.textContent = '';
        actionCell.appendChild(actionsMenu);
      } else {
        actionBtn.textContent = 'Open';
        actionBtn.addEventListener('click', openFolder);
      }
      const preview = document.createElement('span');
      preview.className = 'wfb-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-preview-icon';
      icon.textContent = '📁';
      preview.appendChild(icon);
      nameCell.appendChild(preview);
      const name = document.createElement('span');
      name.className = 'wfb-name-text';
      name.textContent = nameValue;
      nameCell.appendChild(name);
      kindCell.textContent = 'Folder';
      const count = Number(entry?.count || 0);
      modifiedCell.textContent = count > 0
        ? `${count} item${count === 1 ? '' : 's'} · ${formatSavedAt(entry?.savedAt || '')}`
        : `Empty · ${formatSavedAt(entry?.savedAt || '')}`;
      const { source: scopeSource, repoFull: scopeRepoFull } = this._getCurrentRootScope();
      if (!this._isTrashRootSelected()) {
        this._attachDropTarget(row, { source: scopeSource, repoFull: scopeRepoFull, path: folderPath });
      }
      return row;
    }

    if (type === 'file') {
      const pathValue = normalizePath(entry?.path || entry?.name || '');
      if (!pathValue) return null;
      const displayName = getEntryDisplayName(entry);
      const fullPath = getEntryFullPathTooltip(entry) || getEntryModelPathWithExtension(entry);
      row.title = fullPath;
      row.addEventListener('dblclick', () => { void this._handleActivateFile(entry); });
      const actionsMenu = this._createEntryActionsMenu('file', entry, { tile: false });
      if (actionsMenu) {
        actionCell.textContent = '';
        actionCell.appendChild(actionsMenu);
      } else {
        actionBtn.textContent = this.fileActionLabel;
        actionBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this._handleActivateFile(entry);
        });
      }

      const preview = document.createElement('span');
      preview.className = 'wfb-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-preview-icon';
      icon.textContent = '📄';
      preview.appendChild(icon);
      const thumb = document.createElement('img');
      thumb.className = 'wfb-preview-thumb';
      thumb.alt = `${displayName} preview`;
      thumb.addEventListener('load', () => preview.classList.add('has-thumb'));
      thumb.addEventListener('error', () => preview.classList.remove('has-thumb'));
      preview.appendChild(thumb);
      preview.classList.add('wfb-open-target');
      preview.title = `Open ${displayName}`;
      preview.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this._handleActivateFile(entry);
      });
      nameCell.appendChild(preview);

      const name = document.createElement('span');
      name.className = 'wfb-name-text';
      name.classList.add('wfb-open-target');
      name.textContent = displayName;
      name.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this._handleActivateFile(entry);
      });
      nameCell.appendChild(name);

      kindCell.textContent = getEntryKindLabel(entry);
      const location = getEntryLocationLabel(entry);
      modifiedCell.textContent = location
        ? `${formatSavedAt(entry?.savedAt || '')} · ${location}`
        : formatSavedAt(entry?.savedAt || '');
      void this._hydrateThumbnail(entry, thumb);
      this._attachFileDragSource(row, entry);
      return row;
    }

    return null;
  }

  async _hydrateThumbnail(entry, imgEl) {
    if (!imgEl || !entry) return;
    const source = normalizeStorageSource(entry?.source);
    const repoFull = String(entry?.repoFull || '').trim();
    const path = normalizePath(entry?.path || entry?.name || '');
    if (!path) return;
    const key = `${source}:${repoFull}:${path}`;

    const thumbDirect = entry?.thumbnail || entry?.record?.thumbnail || null;
    if (thumbDirect) {
      this.thumbCache.set(key, thumbDirect);
      imgEl.src = thumbDirect;
      return;
    }

    if (this.thumbCache.has(key)) {
      const cached = this.thumbCache.get(key);
      if (cached) imgEl.src = cached;
      return;
    }

    try {
      const scope = { source, repoFull, path };
      const rec = await getComponentRecord(path, scope);
      const thumbnail = rec?.thumbnail || null;
      if (!thumbnail) return;
      this.thumbCache.set(key, thumbnail);
      imgEl.src = thumbnail;
      const record = entry?.record;
      if (record && typeof record === 'object') record.thumbnail = thumbnail;
      else entry.record = { thumbnail };
      return;
    } catch {
      // Ignore thumbnail fetch failures.
    }
  }

  async _handlePickFile(entry) {
    if (!this.onPickFile) return;
    try {
      await this.onPickFile(entry);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err || 'Unknown error');
      this._setStatus(`Selection failed: ${msg}`, 'error');
    }
  }

  async _handleActivateFile(entry) {
    if (this.onActivateFile) {
      try {
        await this.onActivateFile(entry);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'Unknown error');
        this._setStatus(`Open failed: ${msg}`, 'error');
      }
      return;
    }
    await this._handlePickFile(entry);
  }
}

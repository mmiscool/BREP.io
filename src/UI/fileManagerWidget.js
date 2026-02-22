// fileManagerWidget.js
// A lightweight widget to save/load/delete models using IndexedDB storage.
// Designed to be embedded as an Accordion section (similar to expressionsManager).
import * as THREE from 'three';
import JSZip from 'jszip';
import { generate3MF, computeTriangleMaterialIndices } from '../exporters/threeMF.js';
import { CADmaterials } from './CADmaterials.js';
import {
  localStorage as LS,
  STORAGE_BACKEND_EVENT,
  getGithubStorageConfig,
} from '../idbStorage.js';
import {
  readBrowserStorageValue,
  writeBrowserStorageValue,
} from '../utils/browserStorage.js';
import {
  listComponentRecords,
  getComponentRecord,
  setComponentRecord,
  removeComponentRecord,
  MODEL_STORAGE_PREFIX,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../services/componentLibrary.js';
import { readDroppedWorkspaceFileRecord } from '../services/droppedWorkspaceFiles.js';
import { HISTORY_COLLECTION_REFRESH_EVENT } from './history/HistoryCollectionWidget.js';
import { WorkspaceFileBrowserWidget } from './WorkspaceFileBrowserWidget.js';
import { listMountedDirectories } from '../services/mountedStorage.js';

const THUMBNAIL_CAPTURE_SIZE = 240;

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

function normalizeModelPath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  const out = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.') continue;
    if (token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

function stripModelFileExtension(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  return value.toLowerCase().endsWith('.3mf') ? value.slice(0, -4) : value;
}

export class FileManagerWidget {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.uiElement = document.createElement('div');
    // Per-model storage prefix
    this._modelPrefix = MODEL_STORAGE_PREFIX;
    this.currentName = '';
    this.currentRepoFull = '';
    this.currentSource = '';
    this.currentBranch = '';
    this._forceSaveTargetDialog = false;
    this._iconsOnly = this._loadIconsPref();
    this._loadSeq = 0; // guards async load races
    this._refreshInFlight = false;
    this._refreshQueued = false;
    this._thumbCache = new Map();
    this._pendingGithubMeta = new Map();
    this._savedHistorySnapshot = null;
    this._saveOverlay = null;
    this._saveLogEl = null;
    this._ensureStyles();
    this._buildUI();
    // Defer heavy list hydration so URL-driven model loads are not blocked on startup.
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { void this.refreshList(); }, { timeout: 1200 });
    } else {
      setTimeout(() => { void this.refreshList(); }, 80);
    }

    // Refresh UI thumbnails/list when any model key changes via storage events (cross-tab and other code paths)
    try {
      this._onStorage = (ev) => {
        try {
          const key = (ev && (ev.key ?? (ev.detail && ev.detail.key))) || '';
          if (!key) return;
          if (key.startsWith(this._modelPrefix)) {
            // Invalidate cache for this model and refresh list
            try {
              const encName = key.slice(this._modelPrefix.length);
              const name = decodeURIComponent(encName);
              if (name && this._thumbCache) {
                const suffix = `::${name}`;
                for (const cacheKey of Array.from(this._thumbCache.keys())) {
                  if (cacheKey === name || String(cacheKey).endsWith(suffix)) {
                    this._thumbCache.delete(cacheKey);
                  }
                }
              }
            } catch { }
            void this.refreshList();
          } else if (key === '__BREP_FM_ICONSVIEW__') {
            this._iconsOnly = this._loadIconsPref();
            void this.refreshList();
          }
        } catch { /* ignore */ }
      };
      window.addEventListener('storage', this._onStorage);
    } catch { /* ignore */ }

    // Refresh list when storage backend switches (local ↔ GitHub)
    try {
      this._onBackendChange = () => {
        Promise.resolve(LS.ready()).then(() => {
          try {
            this._iconsOnly = this._loadIconsPref();
            void this.refreshList();
          } catch { /* ignore */ }
        });
      };
      window.addEventListener(STORAGE_BACKEND_EVENT, this._onBackendChange);
    } catch { /* ignore */ }

    // Ensure storage hydration completes, then re-sync prefs/list and auto-load last
    try {
      Promise.resolve(LS.ready()).then(() => {
        try {
          this._iconsOnly = this._loadIconsPref();
          void this.refreshList();
        } catch { alert('Failed to initialize File Manager storage.'); }
      });
    } catch { alert('Failed to initialize File Manager storage.'); }
  }

  // ----- Storage helpers -----
  // List all saved model records from per-model keys
  async _listModels() {
    const cfg = getGithubStorageConfig();
    const repoFulls = normalizeRepoFullList(cfg?.repoFulls || cfg?.repoFull || '');
    let mountedIds = [];
    try {
      const mounted = await listMountedDirectories();
      mountedIds = (Array.isArray(mounted) ? mounted : [])
        .map((entry) => String(entry?.id || '').trim())
        .filter(Boolean);
    } catch {
      mountedIds = [];
    }
    const [localRecords, remoteRecords, mountedRecords] = await Promise.all([
      listComponentRecords({ source: 'local' }),
      listComponentRecords({ source: 'github', repoFulls }),
      listComponentRecords({ source: 'mounted', repoFulls: mountedIds }),
    ]);
    const merged = [
      ...(Array.isArray(localRecords) ? localRecords : []),
      ...(Array.isArray(remoteRecords) ? remoteRecords : []),
      ...(Array.isArray(mountedRecords) ? mountedRecords : []),
    ];
    const unique = new Map();
    for (const rec of merged) {
      const source = this._normalizeSource(rec?.source);
      const repoFull = String(rec?.repoFull || '').trim();
      const path = String(rec?.path || rec?.name || '').trim();
      if (!path) continue;
      const key = this._recordScopeKey(path, source, repoFull);
      if (!unique.has(key)) unique.set(key, rec);
    }
    return Array.from(unique.values()).map(({ source, name, path, folder, displayName, savedAt, record, repoFull, repoLabel, branch }) => ({
      source: this._normalizeSource(source),
      name,
      path: String(path || name || '').trim(),
      folder: String(folder || '').trim(),
      displayName: String(displayName || '').trim(),
      savedAt,
      repoFull: String(repoFull || '').trim(),
      repoLabel: String(repoLabel || '').trim(),
      branch: String(branch || '').trim(),
      data: record?.data,
      data3mf: record?.data3mf,
      thumbnail: record?.thumbnail,
    }));
  }
  // Fetch one model record
  async _getModel(name, options) {
    return await getComponentRecord(name, options);
  }
  // Persist one model record
  async _setModel(name, dataObj, options) {
    await setComponentRecord(name, dataObj, options);
  }
  // Remove one model record
  async _removeModel(name, options) {
    await removeComponentRecord(name, options);
  }
  _normalizeSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'github') return 'github';
    if (normalized === 'mounted') return 'mounted';
    return normalized === 'local' ? 'local' : '';
  }
  _resolveSource(source, repoFull = '') {
    const explicit = this._normalizeSource(source);
    if (explicit) return explicit;
    const repo = String(repoFull || '').trim();
    if (!repo) return 'local';
    return repo.includes('/') ? 'github' : 'mounted';
  }
  _buildScopeOptions(source, repoFull, branch) {
    const out = {};
    const src = this._resolveSource(source, repoFull);
    const repo = String(repoFull || '').trim();
    const br = String(branch || '').trim();
    if (src) out.source = src;
    if (repo) out.repoFull = repo;
    if (br) out.branch = br;
    return out;
  }
  _recordScopeKey(name, source = '', repoFull = '') {
    const n = String(name || '').trim();
    const src = this._resolveSource(source, repoFull);
    const repo = String(repoFull || '').trim();
    const scope = repo ? `${repo}::${n}` : n;
    return src ? `${src}::${scope}` : scope;
  }
  async _importDroppedFilesIntoWorkspace(files = [], target = {}, { branch = '' } = {}) {
    const list = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!list.length) {
      return {
        imported: 0,
        skipped: 0,
        failed: 0,
        source: 'local',
        repoFull: '',
        path: '',
      };
    }

    const source = this._normalizeSource(target?.source || 'local') || 'local';
    const repoFull = source === 'local' ? '' : String(target?.repoFull || '').trim();
    const folderPath = normalizeModelPath(target?.path || '');
    if (source !== 'local' && !repoFull) {
      throw new Error('Select a valid destination root before dropping files.');
    }
    if (source === 'github' && !String(getGithubStorageConfig()?.token || '').trim()) {
      throw new Error('Set a GitHub token in Settings before importing files into repositories.');
    }

    const supportsJson = source === 'local';
    const writeBranch = source === 'github'
      ? String(branch || this.currentBranch || getGithubStorageConfig()?.branch || '').trim()
      : '';
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of list) {
      try {
        const parsed = await readDroppedWorkspaceFileRecord(file, { allowJson: supportsJson });
        const baseName = normalizeModelPath(parsed?.baseName || '');
        if (!parsed?.record || !baseName) {
          skipped += 1;
          continue;
        }
        const modelPath = normalizeModelPath(folderPath ? `${folderPath}/${baseName}` : baseName);
        if (!modelPath) {
          skipped += 1;
          continue;
        }

        const scope = {
          ...this._buildScopeOptions(source, repoFull, writeBranch),
          path: modelPath,
        };
        const existing = await this._getModel(modelPath, scope);
        if (existing) {
          const location = repoFull ? ` in ${repoFull}` : '';
          const overwrite = await window.confirm(`"${modelPath}" already exists${location}. Overwrite it?`);
          if (!overwrite) {
            skipped += 1;
            continue;
          }
        }

        await this._setModel(modelPath, parsed.record, scope);
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      imported,
      skipped,
      failed,
      source,
      repoFull,
      path: folderPath,
    };
  }
  _resolveLoadedModelPath(requestedName, options = {}, rec = null) {
    const explicitPath = normalizeModelPath(options?.path || '');
    if (explicitPath) return explicitPath;
    const browserPath = normalizeModelPath(rec?.browserPath || '');
    if (browserPath) return browserPath;
    const recordPath = normalizeModelPath(rec?.path || rec?.name || '');
    if (recordPath) return recordPath;
    return normalizeModelPath(requestedName || '');
  }
  _applyLoadedModelState(requestedName, options = {}, rec = null, fallbackSource = 'local') {
    const resolvedPath = this._resolveLoadedModelPath(requestedName, options, rec);
    const finalName = resolvedPath || normalizeModelPath(requestedName || '') || String(requestedName || '').trim();
    this.currentName = finalName;
    this.currentSource = this._normalizeSource(options?.source || rec?.source) || this._normalizeSource(fallbackSource) || 'local';
    this.currentRepoFull = String(options?.repoFull || rec?.repoFull || '').trim();
    this.currentBranch = String(options?.branch || rec?.branch || '').trim();
    this._forceSaveTargetDialog = !!options?.forceSaveTargetDialog;
    this.nameInput.value = finalName;
  }
  _saveIconsPref(v) {
    try { writeBrowserStorageValue('__BREP_FM_ICONSVIEW__', v ? '1' : '0'); } catch { }
  }
  _loadIconsPref() {
    try {
      const raw = readBrowserStorageValue('__BREP_FM_ICONSVIEW__', {
        fallback: '',
      });
      return raw === '1';
    } catch { return false; }
  }

  async _captureCurrentHistorySnapshot() {
    try {
      if (!this.viewer?.partHistory?.toJSON) return null;
      const snapshot = await this.viewer.partHistory.toJSON();
      return typeof snapshot === 'string' ? snapshot : null;
    } catch {
      return null;
    }
  }

  _markSavedHistorySnapshot(snapshot) {
    this._savedHistorySnapshot = (typeof snapshot === 'string') ? snapshot : null;
  }

  async _refreshSavedHistorySnapshot() {
    const snapshot = await this._captureCurrentHistorySnapshot();
    if (snapshot !== null) this._markSavedHistorySnapshot(snapshot);
    return snapshot;
  }

  async hasUnsavedChanges() {
    const currentSnapshot = await this._captureCurrentHistorySnapshot();
    if (currentSnapshot === null) return false;
    if (typeof this._savedHistorySnapshot !== 'string') {
      this._markSavedHistorySnapshot(currentSnapshot);
      return false;
    }
    return currentSnapshot !== this._savedHistorySnapshot;
  }

  async confirmNavigateHome() {
    const hasChanges = await this.hasUnsavedChanges();
    if (!hasChanges) return true;

    const saveBeforeLeave = await confirm(
      'You have unsaved changes.\n\nSave before returning to Home?\n\nOK = Save and return\nCancel = Do not save',
    );

    if (saveBeforeLeave) {
      try {
        await this.saveCurrent();
      } catch {
        alert('Save failed. Staying in CAD.');
        return false;
      }
      const stillDirty = await this.hasUnsavedChanges();
      if (stillDirty) {
        alert('Model is still unsaved. Staying in CAD.');
        return false;
      }
      return true;
    }

    return await confirm('Discard unsaved changes and return to Home?');
  }



  // ----- UI -----
  _ensureStyles() {
    if (document.getElementById('file-manager-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'file-manager-widget-styles';
    style.textContent = `
      /* Layout */
      .fm-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-bottom: 1px solid #1f2937; background: transparent; transition: background-color .12s ease; }
      .fm-row:hover { background: #0f172a; }
      .fm-row.header { background: #111827; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-bottom: 4px; }
      .fm-row:last-child { border-bottom: 0; }
      .fm-grow { flex: 1 1 auto; overflow: hidden; }
      .fm-thumb { flex: 0 0 auto; width: 60px; height: 60px; border-radius: 6px; border: 1px solid #1f2937; background: #0b0e14; object-fit: contain; image-rendering: auto; }

      /* Inputs (keep text size and padding) */
      .fm-input { width: 100%; box-sizing: border-box; padding: 6px 8px; background: #0b0e14; color: #e5e7eb; border: 1px solid #374151; border-radius: 8px; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
      .fm-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

      /* Buttons (keep text size and padding) */
      .fm-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 2px 6px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; min-width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, background-color .15s ease, transform .05s ease; }
      .fm-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .fm-btn:active { transform: translateY(1px); }
      .fm-btn.danger { border-color: #7f1d1d; color: #fecaca; }
      .fm-btn.danger:hover { border-color: #ef4444; background: rgba(239,68,68,.15); color: #fff; }

      /* List + text (keep sizes) */
      .fm-list { padding: 4px 0; }
      .fm-left { display: flex; flex-direction: column; min-width: 0; }
      .fm-name { font-weight: 600; color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
      .fm-date { font-size: 11px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }

      /* Icons view */
      .fm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; padding: 6px; }
      .fm-item { position: relative; display: flex; align-items: center; justify-content: center; padding: 8px; border: 1px solid #1f2937; border-radius: 8px; background: transparent; transition: background-color .12s ease, border-color .12s ease; }
      .fm-item:hover { background: #0f172a; border-color: #334155; }
      .fm-item .fm-thumb { width: 60px; height: 60px; border: 1px solid #1f2937; background: #0b0e14; border-radius: 6px; }
      .fm-item .fm-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; line-height: 1; }

      /* Blocking save overlay */
      .fm-save-overlay { position: fixed; inset: 0; background: rgba(2,6,23,0.65); display: flex; align-items: center; justify-content: center; z-index: 10050; }
      .fm-save-panel { width: min(520px, 90vw); max-height: 80vh; background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 12px; padding: 16px 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
      .fm-save-title { font-weight: 700; font-size: 14px; letter-spacing: .01em; margin-bottom: 10px; }
      .fm-save-log { font-size: 12px; line-height: 1.4; max-height: 52vh; overflow: auto; white-space: pre-wrap; color: #cbd5f5; background: #0a0f1a; border: 1px solid #1f2937; border-radius: 8px; padding: 10px; }
      .fm-save-line { margin-bottom: 6px; }

      /* Save target dialog */
      .fm-save-target-overlay {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10060;
        padding: 16px;
        box-sizing: border-box;
      }
      .fm-save-target-panel {
        width: min(1100px, 96vw);
        height: min(760px, 90vh);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #0b0e14;
        border: 1px solid #1f2937;
        border-radius: 12px;
        color: #e5e7eb;
        padding: 14px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .fm-save-target-title {
        font-weight: 700;
        font-size: 14px;
      }
      .fm-save-target-controls {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .fm-save-target-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        color: #9ca3af;
      }
      .fm-save-target-browser {
        border: 1px solid #1f2937;
        border-radius: 8px;
        background: #0a0f1a;
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        padding: 8px;
      }
      .fm-save-target-browser-mount {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .fm-save-target-status {
        min-height: 18px;
        font-size: 12px;
        color: #9ca3af;
      }
      .fm-save-target-status[data-tone="error"] {
        color: #fca5a5;
      }
      .fm-save-target-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      @media (max-width: 760px) {
        .fm-save-target-panel {
          width: min(98vw, 1100px);
          padding: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  _setSaveBusy(isBusy) {
    try {
      if (this.saveBtn) this.saveBtn.disabled = !!isBusy;
      if (this.nameInput) this.nameInput.disabled = !!isBusy;
    } catch { /* ignore */ }
  }

  _startSaveProgress(title) {
    try {
      this._endSaveProgress();
      const overlay = document.createElement('div');
      overlay.className = 'fm-save-overlay';
      const panel = document.createElement('div');
      panel.className = 'fm-save-panel';
      const header = document.createElement('div');
      header.className = 'fm-save-title';
      header.textContent = title || 'Saving...';
      const log = document.createElement('div');
      log.className = 'fm-save-log';
      panel.appendChild(header);
      panel.appendChild(log);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      this._saveOverlay = overlay;
      this._saveLogEl = log;
    } catch { /* ignore */ }
  }

  _logSaveProgress(message) {
    try {
      if (!this._saveLogEl) return;
      const line = document.createElement('div');
      line.className = 'fm-save-line';
      line.textContent = message || '';
      this._saveLogEl.appendChild(line);
      this._saveLogEl.scrollTop = this._saveLogEl.scrollHeight;
    } catch { /* ignore */ }
  }

  _endSaveProgress() {
    try {
      if (this._saveOverlay && this._saveOverlay.parentNode) {
        this._saveOverlay.parentNode.removeChild(this._saveOverlay);
      }
    } catch { /* ignore */ }
    this._saveOverlay = null;
    this._saveLogEl = null;
  }

  _buildUI() {
    // Header: name input + Save
    const header = document.createElement('div');
    header.className = 'fm-row header';

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Model name';
    this.nameInput.value = this.currentName;
    this.nameInput.className = 'fm-input fm-grow';
    header.appendChild(this.nameInput);

    // View toggle: list ↔ icons-only
    this.viewToggleBtn = document.createElement('button');
    this.viewToggleBtn.className = 'fm-btn';
    this.viewToggleBtn.addEventListener('click', () => this.toggleViewMode());
    header.appendChild(this.viewToggleBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'fm-btn';
    saveBtn.addEventListener('click', () => this.saveCurrent());
    this.saveBtn = saveBtn;
    header.appendChild(saveBtn);
    this.uiElement.appendChild(header);

    // List container
    this.listEl = document.createElement('div');
    this.listEl.className = 'fm-list';
    this.uiElement.appendChild(this.listEl);

    this._updateViewToggleUI();
  }

  // ----- Actions -----
  async newModel() {
    if (!this.viewer || !this.viewer.partHistory) return;
    const proceed = await confirm('Clear current model and start a new one?');
    if (!proceed) return;
    await this.viewer.partHistory.reset();
    this.viewer.partHistory.currentHistoryStepId = null;
    await this.viewer.partHistory.runHistory();
    this.currentName = '';
    this.currentRepoFull = '';
    this.currentSource = '';
    this.currentBranch = '';
    this._forceSaveTargetDialog = false;
    this.nameInput.value = '';
    await this._refreshSavedHistorySnapshot();
    this._refreshHistoryCollections('new-model');
  }

  async _openSaveTargetDialog(initialPath = '') {
    const normalizedInitialPath = normalizeModelPath(initialPath);
    const slashIdx = normalizedInitialPath.lastIndexOf('/');
    const initialFolder = slashIdx >= 0 ? normalizedInitialPath.slice(0, slashIdx) : '';
    const initialFileName = stripModelFileExtension(
      slashIdx >= 0 ? normalizedInitialPath.slice(slashIdx + 1) : normalizedInitialPath,
    );
    const cfg = getGithubStorageConfig() || {};
    const initialSource = this._normalizeSource(this.currentSource) || 'local';
    const initialRepo = String(this.currentRepoFull || '').trim();
    const initialBranch = String(this.currentBranch || cfg.branch || '').trim();

    return await new Promise((resolve) => {
      let closed = false;
      let browser = null;
      let selectedBranch = initialBranch;

      const overlay = document.createElement('div');
      overlay.className = 'fm-save-target-overlay';

      const panel = document.createElement('section');
      panel.className = 'fm-save-target-panel';
      overlay.appendChild(panel);

      const title = document.createElement('div');
      title.className = 'fm-save-target-title';
      title.textContent = 'Save Model';
      panel.appendChild(title);

      const controls = document.createElement('div');
      controls.className = 'fm-save-target-controls';

      const fileLabel = document.createElement('label');
      fileLabel.className = 'fm-save-target-field';
      fileLabel.textContent = 'File Name';
      const fileInput = document.createElement('input');
      fileInput.type = 'text';
      fileInput.className = 'fm-input';
      fileInput.placeholder = 'part name';
      fileInput.value = initialFileName;
      fileLabel.appendChild(fileInput);
      controls.appendChild(fileLabel);

      const browserWrap = document.createElement('div');
      browserWrap.className = 'fm-save-target-browser';
      panel.appendChild(browserWrap);

      const browserMount = document.createElement('div');
      browserMount.className = 'fm-save-target-browser-mount';
      browserWrap.appendChild(browserMount);

      const status = document.createElement('div');
      status.className = 'fm-save-target-status';
      panel.appendChild(controls);
      panel.appendChild(status);

      const actions = document.createElement('div');
      actions.className = 'fm-save-target-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'fm-btn';
      cancelBtn.textContent = 'Cancel';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'fm-btn';
      saveBtn.textContent = 'Save';
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      panel.appendChild(actions);

      const setStatus = (message = '', tone = '') => {
        status.textContent = String(message || '');
        status.dataset.tone = tone ? String(tone) : '';
        status.hidden = !message;
      };

      const setBusy = (busy) => {
        const disabled = !!busy;
        fileInput.disabled = disabled;
        saveBtn.disabled = disabled;
        cancelBtn.disabled = disabled;
      };

      const close = (result) => {
        if (closed) return;
        closed = true;
        try { document.removeEventListener('keydown', onKeyDown, true); } catch { /* ignore */ }
        try { browser?.destroy?.(); } catch { /* ignore */ }
        try { overlay.remove(); } catch { /* ignore */ }
        resolve(result || null);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(null);
          return;
        }
        if (event.key === 'Enter' && event.target === fileInput) {
          event.preventDefault();
          event.stopPropagation();
          saveBtn.click();
        }
      };

      cancelBtn.addEventListener('click', () => close(null));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });

      saveBtn.addEventListener('click', () => {
        const fileName = stripModelFileExtension(fileInput.value || '');
        if (!fileName) {
          setStatus('Enter a file name.', 'error');
          try { fileInput.focus(); } catch { /* ignore */ }
          return;
        }
        if (fileName.includes('/') || fileName.includes('\\')) {
          setStatus('File name cannot include folder separators.', 'error');
          try { fileInput.focus(); } catch { /* ignore */ }
          return;
        }

        const location = browser?.getLocation?.() || {};
        if (location.workspaceTop) {
          setStatus('Select a local, mounted, or GitHub destination folder.', 'error');
          return;
        }

        const source = this._normalizeSource(location.source || 'local') || 'local';
        const repoFull = source === 'local' ? '' : String(location.repoFull || '').trim();
        if (source !== 'local' && !repoFull) {
          setStatus('Choose a valid destination root before saving.', 'error');
          return;
        }

        const folderPath = normalizeModelPath(location.path || '');
        const modelPath = normalizeModelPath(folderPath ? `${folderPath}/${fileName}` : fileName);
        if (!modelPath) {
          setStatus('Choose a valid destination folder.', 'error');
          return;
        }

        close({
          source,
          repoFull,
          branch: source === 'github' ? selectedBranch : '',
          modelPath,
        });
      });

      browser = new WorkspaceFileBrowserWidget({
        container: browserMount,
        onPickFile: async (entry) => {
          const source = this._normalizeSource(entry?.source || 'local') || 'local';
          const repoFull = source === 'local' ? '' : String(entry?.repoFull || '').trim();
          const pathValue = normalizeModelPath(entry?.browserPath || entry?.path || entry?.name || '');
          if (!pathValue) return;
          const idx = pathValue.lastIndexOf('/');
          const folderPath = idx >= 0 ? pathValue.slice(0, idx) : '';
          const pickedFileName = stripModelFileExtension(idx >= 0 ? pathValue.slice(idx + 1) : pathValue);
          if (pickedFileName) fileInput.value = pickedFileName;
          selectedBranch = String(entry?.branch || selectedBranch || '').trim();
          browser.setLocation({
            workspaceTop: false,
            source,
            repoFull,
            path: folderPath,
          });
          setStatus('Selected existing file. Save will overwrite it.', 'info');
          try { fileInput.focus(); fileInput.select(); } catch { /* ignore */ }
        },
        onDropFiles: async ({ files, target }) => {
          const count = Array.isArray(files) ? files.length : 0;
          if (!count) return;
          setBusy(true);
          setStatus(`Importing ${count} dropped file${count === 1 ? '' : 's'}...`, 'info');
          try {
            const summary = await this._importDroppedFilesIntoWorkspace(files, target, {
              branch: selectedBranch,
            });
            await browser.reload();
            browser.setLocation({
              workspaceTop: false,
              source: summary.source,
              repoFull: summary.repoFull,
              path: summary.path,
            });
            if (!summary.imported && !summary.failed) {
              setStatus('No supported files were imported. Drop .3mf files (or .json for Local Browser).', 'info');
              return;
            }
            if (summary.failed) {
              setStatus(`Import complete: ${summary.imported} imported, ${summary.failed} failed, ${summary.skipped} skipped.`, 'error');
            } else {
              setStatus(`Imported ${summary.imported} file${summary.imported === 1 ? '' : 's'}.${summary.skipped ? ` (${summary.skipped} skipped)` : ''}`, 'info');
            }
          } catch (err) {
            const msg = err?.message || String(err || 'Unknown error');
            setStatus(`File import failed: ${msg}`, 'error');
            throw err;
          } finally {
            setBusy(false);
          }
        },
        scrollBody: true,
      });

      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);

      const fallbackLocation = (initialSource === 'github' && !initialRepo)
        ? { workspaceTop: true }
        : {
            workspaceTop: false,
            source: initialSource,
            repoFull: initialSource === 'local' ? '' : initialRepo,
            path: initialFolder,
          };
      const preferredLocation = browser?.hasStoredLocation?.()
        ? browser.getLocation()
        : fallbackLocation;

      setBusy(true);
      setStatus('Loading files...', 'info');
      void browser.reload()
        .then(() => {
          browser.setLocation(preferredLocation);
          setStatus('', '');
        })
        .catch((err) => {
          const msg = err?.message || String(err || 'Unknown error');
          setStatus(`Failed to load files: ${msg}`, 'error');
        })
        .finally(() => {
          setBusy(false);
          requestAnimationFrame(() => {
            try { fileInput.focus(); } catch { /* ignore */ }
          });
        });
    });
  }

  async _retryGithubOperation(action, op, progress) {
    while (true) {
      try {
        const value = await op();
        return { ok: true, value };
      } catch (err) {
        const msg = (err && typeof err.message === 'string' && err.message.trim())
          ? err.message.trim()
          : (err ? String(err) : '');
        const details = msg ? `\n\n${msg}` : '';
        try { if (typeof progress === 'function') progress(`${action} failed.${details}`); } catch { }
        const retry = await window.confirm(`${action} failed.${details}\n\nRetry?`);
        try { if (typeof progress === 'function') progress(retry ? 'Retrying...' : 'Save canceled by user.'); } catch { }
        if (!retry) return { ok: false, error: err };
      }
    }
  }

  async saveCurrent() {
    if (!this.viewer || !this.viewer.partHistory) return;
    const currentPath = normalizeModelPath(this.currentName || '');
    const typedPath = normalizeModelPath(this.nameInput.value || '');
    const currentSource = this._normalizeSource(this.currentSource) || 'local';
    const currentRepo = String(this.currentRepoFull || '').trim();
    const currentBranch = String(this.currentBranch || '').trim();

    let target = null;
    if (!this._forceSaveTargetDialog && currentPath && typedPath && typedPath === currentPath) {
      target = {
        source: currentSource,
        repoFull: currentSource === 'local' ? '' : currentRepo,
        branch: currentSource === 'github' ? currentBranch : '',
        modelPath: currentPath,
      };
    } else {
      const initialPath = typedPath || currentPath || '';
      target = await this._openSaveTargetDialog(initialPath);
    }

    if (!target) return;
    const modelPath = String(normalizeModelPath(target.modelPath || '') || '').trim();
    if (!modelPath) return;
    const targetSource = this._normalizeSource(target.source || currentSource || 'local') || 'local';
    const targetRepo = String(target.repoFull || '').trim();
    const targetBranch = String(target.branch || currentBranch || '').trim();
    const targetOptions = {
      ...this._buildScopeOptions(targetSource, targetRepo, targetBranch),
      path: modelPath,
    };
    const sameTargetAsCurrent = !!(
      currentPath
      && currentPath === modelPath
      && currentSource === targetSource
      && currentRepo === targetRepo
    );

    if (!sameTargetAsCurrent) {
      try {
        const existing = await this._getModel(modelPath, targetOptions);
        if (existing) {
          const location = targetRepo ? ` in ${targetRepo}` : '';
          const overwrite = await window.confirm(`"${modelPath}" already exists${location}. Overwrite it?`);
          if (!overwrite) return;
        }
      } catch {
        // Ignore lookup failures and allow save attempt to proceed.
      }
    }

    try { console.log('[FileManagerWidget] saveCurrent: begin', { name: modelPath }); } catch { }
    this._setSaveBusy(true);
    this._startSaveProgress(targetRepo ? `Saving "${modelPath}" to ${targetRepo}...` : `Saving "${modelPath}"...`);
    try {
      this._logSaveProgress('Preparing feature history...');
      // Get feature history JSON (now includes PMI views) and embed into a 3MF archive as Metadata/featureHistory.json
      const jsonString = await this.viewer.partHistory.toJSON();
      try { console.log('[FileManagerWidget] saveCurrent: feature history', { bytes: jsonString ? jsonString.length : 0 }); } catch { }
      let additionalFiles = {};
      let modelMetadata = undefined;
      if (jsonString) {
        additionalFiles['Metadata/featureHistory.json'] = jsonString;
        modelMetadata = { featureHistoryPath: '/Metadata/featureHistory.json' };
      }
      // Embed PMI view images under /views
      try {
        this._logSaveProgress('Capturing PMI view images...');
        const viewFiles = await this.viewer?.pmiViewsWidget?.captureViewImagesForPackage?.();
        if (viewFiles && typeof viewFiles === 'object') {
          additionalFiles = { ...(additionalFiles || {}), ...viewFiles };
        }
      } catch (err) {
        console.error('Failed to embed PMI view images:', err);
      }
      // Capture a higher-resolution thumbnail of the current view
      let thumbnail = null;
      try {
        this._logSaveProgress('Capturing thumbnail...');
        thumbnail = await this._captureThumbnail(THUMBNAIL_CAPTURE_SIZE);
      } catch { /* ignore thumbnail failures */ }

      // Collect solids for full 3MF export (so slicers can open it).
      this._logSaveProgress('Collecting solids...');
      const solids = this._collectSolidsForExport();
      try { console.log('[FileManagerWidget] saveCurrent: collected solids', { count: solids.length, names: solids.map(s => s?.name).filter(Boolean) }); } catch { }
      const solidsForExport = [];
      const skipped = [];
      solids.forEach((s, idx) => {
        try {
          const mesh = s?.getMesh?.();
          if (mesh && mesh.vertProperties && mesh.triVerts) {
            solidsForExport.push(s);
          } else {
            skipped.push(s?.name || `solid_${idx}`);
          }
        } catch {
          skipped.push(s?.name || `solid_${idx}`);
        }
      });
      try { console.log('[FileManagerWidget] saveCurrent: solids for export', { count: solidsForExport.length, skipped }); } catch { }

      // Attach BREP-specific metadata for mesh-based restores (face names, colors, centerlines).
      try {
        this._logSaveProgress('Packaging BREP metadata...');
        const extras = this._buildBrepExtras(solidsForExport);
        try { console.log('[FileManagerWidget] saveCurrent: brepExtras', { hasExtras: !!extras, solidCount: extras?.solids ? Object.keys(extras.solids).length : 0 }); } catch { }
        if (extras) {
          additionalFiles = additionalFiles || {};
          additionalFiles['Metadata/brepExtras.json'] = JSON.stringify(extras);
        }
      } catch (err) {
        console.warn('[FileManagerWidget] Failed to embed BREP extras:', err);
      }

      let threeMfBytes;
      try {
        this._logSaveProgress('Exporting 3MF...');
        const metadataManager = this.viewer?.partHistory?.metadataManager || null;
        const defaultFaceColor = (() => {
          try {
            const color = CADmaterials?.FACE?.BASE?.color;
            if (color && typeof color.getHexString === 'function') {
              return `#${color.getHexString()}`;
            }
            if (typeof color === 'string') return color;
          } catch { }
          return null;
        })();
        threeMfBytes = await generate3MF(solidsForExport, {
          unit: 'millimeter',
          precision: 6,
          scale: 1,
          additionalFiles,
          modelMetadata,
          thumbnail,
          metadataManager,
          defaultFaceColor,
          includeFaceTags: false,
        });
        try { console.log('[FileManagerWidget] saveCurrent: 3MF exported', { bytes: threeMfBytes?.length || 0 }); } catch { }
      } catch (e) {
        // Fallback: history only 3MF
        const metadataManager = this.viewer?.partHistory?.metadataManager || null;
        const defaultFaceColor = (() => {
          try {
            const color = CADmaterials?.FACE?.BASE?.color;
            if (color && typeof color.getHexString === 'function') {
              return `#${color.getHexString()}`;
            }
            if (typeof color === 'string') return color;
          } catch { }
          return null;
        })();
        threeMfBytes = await generate3MF([], {
          unit: 'millimeter',
          precision: 6,
          scale: 1,
          additionalFiles,
          modelMetadata,
          thumbnail,
          metadataManager,
          defaultFaceColor,
          includeFaceTags: false,
        });
        console.warn('[FileManagerWidget] 3MF export failed for solids, saved history-only 3MF.', e);
        try { console.log('[FileManagerWidget] saveCurrent: 3MF exported (history only)', { bytes: threeMfBytes?.length || 0 }); } catch { }
      }
      const threeMfB64 = uint8ArrayToBase64(threeMfBytes);
      const now = new Date().toISOString();

      // Persist the model plus optional captured thumbnail sidecar metadata.
      const record = { savedAt: now, data3mf: threeMfB64 };
      if (thumbnail) record.thumbnail = thumbnail;
      if (targetSource === 'github') {
        this._logSaveProgress(`Saving to GitHub${targetRepo ? ` (${targetRepo})` : ''}...`);
        try { console.log('[FileManagerWidget] saveCurrent: saving to GitHub', { name: modelPath, repo: targetRepo }); } catch { }
        const res = await this._retryGithubOperation(
          `Save "${modelPath}" to GitHub${targetRepo ? ` (${targetRepo})` : ''}`,
          () => this._setModel(modelPath, record, targetOptions),
          (msg) => this._logSaveProgress(msg)
        );
        if (!res.ok) {
          this._logSaveProgress('Save canceled.');
          return;
        }
        try {
          const pendingKey = this._recordScopeKey(modelPath, targetSource, targetRepo);
          this._pendingGithubMeta.set(pendingKey, {
            savedAt: record.savedAt || null,
            thumbnail: record.thumbnail || null,
          });
        } catch { /* ignore */ }
      } else {
        if (targetSource === 'mounted') {
          this._logSaveProgress(`Saving to mounted folder${targetRepo ? ` (${targetRepo})` : ''}...`);
          try { console.log('[FileManagerWidget] saveCurrent: saving to mounted folder', { name: modelPath, mountId: targetRepo }); } catch { }
        } else {
          this._logSaveProgress('Saving to local storage...');
          try { console.log('[FileManagerWidget] saveCurrent: saving locally', { name: modelPath }); } catch { }
        }
        await this._setModel(modelPath, record, targetOptions);
      }
      // Update in-memory thumbnail cache so UI reflects the new preview immediately
      try {
        if (thumbnail) this._thumbCache.set(this._recordScopeKey(modelPath, targetSource, targetRepo), thumbnail);
      } catch { }
      this.currentName = modelPath;
      this.currentRepoFull = targetRepo;
      this.currentSource = targetSource;
      this.currentBranch = targetBranch;
      this._forceSaveTargetDialog = false;
      this.nameInput.value = modelPath;
      this._markSavedHistorySnapshot(jsonString || null);
      this._logSaveProgress('Refreshing list...');
      await this.refreshList();
      this._logSaveProgress('Save complete.');
      try { console.log('[FileManagerWidget] saveCurrent: complete', { name: modelPath }); } catch { }
      if (skipped.length) {
        try { console.warn('[FileManagerWidget] Skipped non-manifold solids:', skipped); } catch {}
      }
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err || 'Unknown error');
      this._logSaveProgress(`Save failed: ${msg}`);
      try { console.warn('[FileManagerWidget] saveCurrent: failed', { name: modelPath, error: msg }); } catch { }
      throw err;
    } finally {
      this._endSaveProgress();
      this._setSaveBusy(false);
    }
  }

  _collectSolidsForExport() {
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene;
    if (!scene) return [];
    const solids = [];
    scene.traverse((o) => {
      if (!o || !o.visible) return;
      if (o.type === 'SOLID' && typeof o.toSTL === 'function') solids.push(o);
    });
    const selected = solids.filter(o => o.selected === true);
    return selected.length ? selected : solids;
  }

  _buildBrepExtras(solids) {
    if (!Array.isArray(solids) || solids.length === 0) return null;

    const cleanMeta = (value) => {
      if (value == null) return null;
      try {
        return JSON.parse(JSON.stringify(value, (key, v) => {
          if (typeof v === 'function') return undefined;
          if (v && v.isColor && typeof v.getHexString === 'function') {
            try { return `#${v.getHexString()}`; } catch { return v; }
          }
          return v;
        }));
      } catch {
        return null;
      }
    };

    const mapToObject = (map) => {
      if (!(map instanceof Map) || map.size === 0) return null;
      const out = {};
      for (const [key, val] of map.entries()) {
        if (key == null) continue;
        const cleaned = cleanMeta(val);
        if (cleaned != null) out[String(key)] = cleaned;
      }
      return Object.keys(out).length ? out : null;
    };

    const encodeTriIds = (triIds) => {
      if (!triIds || triIds.length === 0) return '';
      const u32 = triIds instanceof Uint32Array ? triIds : Uint32Array.from(triIds);
      const u8 = new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength);
      return uint8ArrayToBase64(u8);
    };

    const solidsOut = {};
    const metadataManager = this.viewer?.partHistory?.metadataManager;
    for (const solid of solids) {
      if (!solid || solid.type !== 'SOLID') continue;
      const name = String(solid.name || '').trim();
      if (!name) continue;

      const authorTriCount = Array.isArray(solid._triVerts) ? (solid._triVerts.length / 3) : 0;
      const authorTriIdCount = Array.isArray(solid._triIDs) ? solid._triIDs.length : 0;
      let triIds = solid._triIDs || [];
      let triCount = (Array.isArray(triIds) || triIds instanceof Uint32Array) ? triIds.length : 0;
      let triIdsOrdered = triIds;
      let mesh = null;
      let triMat = null;
      let meshTriCount = 0;
      let meshFaceIdCount = 0;
      try {
        if (typeof solid.getMesh === 'function') {
          mesh = solid.getMesh();
          if (mesh && mesh.faceID && mesh.faceID.length) {
            triIds = Array.from(mesh.faceID);
            triCount = triIds.length;
          }
          meshTriCount = (mesh?.triVerts && mesh.triVerts.length) ? (mesh.triVerts.length / 3) : 0;
          meshFaceIdCount = (mesh?.faceID && mesh.faceID.length) ? mesh.faceID.length : 0;
          try {
            triMat = computeTriangleMaterialIndices(solid, mesh, {
              metadataManager,
              includeFaceTags: false,
              useMetadataColors: true,
            });
          } catch { /* ignore material mapping */ }
        }
      } catch { /* ignore mesh failures */ }
      finally { try { mesh?.delete?.(); } catch { } }

      if (triMat && Array.isArray(triMat) && triMat.length === triCount && triCount > 0) {
        const buckets = new Map();
        let defaultBucket = null;
        for (let t = 0; t < triCount; t++) {
          const fid = triIds[t];
          const midx = triMat[t];
          if (midx == null || !Number.isFinite(midx)) {
            if (!defaultBucket) defaultBucket = [];
            defaultBucket.push(fid);
          } else {
            const key = Number(midx);
            let arr = buckets.get(key);
            if (!arr) { arr = []; buckets.set(key, arr); }
            arr.push(fid);
          }
        }
        if (buckets.size || (defaultBucket && defaultBucket.length)) {
          const ordered = [];
          const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
          for (const k of keys) {
            const arr = buckets.get(k);
            if (arr && arr.length) ordered.push(...arr);
          }
          if (defaultBucket && defaultBucket.length) ordered.push(...defaultBucket);
          triIdsOrdered = ordered;
          triCount = triIdsOrdered.length;
        }
      } else {
        triIdsOrdered = triIds;
        triCount = (Array.isArray(triIdsOrdered) || triIdsOrdered instanceof Uint32Array) ? triIdsOrdered.length : 0;
      }
      try {
        console.log('[FileManagerWidget] brepExtras: counts', {
          name,
          authorTriCount,
          authorTriIdCount,
          meshTriCount,
          meshFaceIdCount,
          triIdsCount: (Array.isArray(triIds) || triIds instanceof Uint32Array) ? triIds.length : 0,
          triIdsOrderedCount: (Array.isArray(triIdsOrdered) || triIdsOrdered instanceof Uint32Array) ? triIdsOrdered.length : 0,
          triMatCount: Array.isArray(triMat) ? triMat.length : 0,
        });
      } catch { }
      try {
        console.log('[FileManagerWidget] brepExtras: solid', {
          name,
          triCount,
          faceMapCount: idToFaceName ? Object.keys(idToFaceName).length : 0,
          faceMetaCount: faceMetadata ? Object.keys(faceMetadata).length : 0,
          edgeMetaCount: edgeMetadata ? Object.keys(edgeMetadata).length : 0,
          triFaceOrder: 'material',
        });
      } catch { }
      let idToFaceName = (solid._idToFaceName instanceof Map)
        ? Object.fromEntries(Array.from(solid._idToFaceName.entries()).map(([k, v]) => [String(k), String(v)]))
        : null;
      if (!idToFaceName && solid._faceNameToID instanceof Map) {
        const inverted = {};
        for (const [faceName, faceId] of solid._faceNameToID.entries()) {
          if (faceId == null || faceName == null) continue;
          inverted[String(faceId)] = String(faceName);
        }
        if (Object.keys(inverted).length) idToFaceName = inverted;
      }

      let faceMetadata = mapToObject(solid._faceMetadata);
      const edgeMetadata = mapToObject(solid._edgeMetadata);
      const solidUserMeta = cleanMeta(solid?.userData?.metadata || null);
      const solidManagerMeta = (metadataManager && typeof metadataManager.getMetadata === 'function')
        ? cleanMeta(metadataManager.getMetadata(name))
        : null;
      const solidMetadata = solidManagerMeta
        ? { ...(solidManagerMeta || {}), ...(solidUserMeta || {}) }
        : solidUserMeta;

      if (metadataManager && typeof metadataManager.getMetadata === 'function' && idToFaceName) {
        const mergedFaceMeta = faceMetadata || {};
        for (const faceName of Object.values(idToFaceName)) {
          if (!faceName) continue;
          const meta = cleanMeta(metadataManager.getMetadata(faceName));
          if (meta && typeof meta === 'object' && Object.keys(meta).length) {
            mergedFaceMeta[faceName] = { ...(meta || {}), ...(mergedFaceMeta[faceName] || {}) };
          }
        }
        faceMetadata = Object.keys(mergedFaceMeta).length ? mergedFaceMeta : faceMetadata;
      }

      let auxEdges = null;
      if (Array.isArray(solid._auxEdges) && solid._auxEdges.length) {
        auxEdges = solid._auxEdges.map((e) => {
          const pts = Array.isArray(e?.points)
            ? e.points
                .map((p) => (Array.isArray(p) && p.length === 3 ? [p[0], p[1], p[2]] : null))
                .filter(Boolean)
            : [];
          return {
            name: e?.name || '',
            points: pts,
            closedLoop: !!e?.closedLoop,
            polylineWorld: !!e?.polylineWorld,
            materialKey: e?.materialKey || undefined,
            centerline: !!e?.centerline,
            faceA: typeof e?.faceA === 'string' ? e.faceA : undefined,
            faceB: typeof e?.faceB === 'string' ? e.faceB : undefined,
          };
        }).filter((e) => Array.isArray(e.points) && e.points.length >= 2);
      }

      if (faceMetadata && Object.keys(faceMetadata).length === 0) faceMetadata = null;
      solidsOut[name] = {
        triCount,
        triFaceIdsB64: encodeTriIds(triIdsOrdered),
        triFaceOrder: 'material',
        idToFaceName,
        faceMetadata,
        edgeMetadata,
        auxEdges,
        solidMetadata,
      };
    }

    if (!Object.keys(solidsOut).length) return null;
    return { version: 1, solids: solidsOut };
  }

  async _loadModelRecord(name, rec, options = {}, source = 'local', seq = this._loadSeq, refreshReason = 'load-model') {
    if (!rec) return alert('Model not found.');
    await this.viewer.partHistory.reset();
    // Prefer new 3MF-based storage
    if (rec.data3mf && typeof rec.data3mf === 'string') {
      try {
        let b64 = rec.data3mf;
        if (b64.startsWith('data:') && b64.includes(';base64,')) {
          b64 = b64.split(';base64,')[1];
        }
        const bytes = base64ToUint8Array(b64);
        // Try to extract feature history from 3MF
        const zip = await JSZip.loadAsync(bytes.buffer);
        const files = {};
        Object.keys(zip.files || {}).forEach(p => files[p.toLowerCase()] = p);
        let fhKey = files['metadata/featurehistory.json'];
        if (!fhKey) {
          for (const k of Object.keys(files)) { if (k.endsWith('featurehistory.json')) { fhKey = files[k]; break; } }
        }
        if (fhKey) {
          const jsonData = await zip.file(fhKey).async('string');
          let root = null;
          try { root = JSON.parse(jsonData); } catch { }
          // Ensure expressions is a string if present
          if (root && root.expressions != null && typeof root.expressions !== 'string') {
            try { root.expressions = String(root.expressions); } catch { root.expressions = String(root.expressions); }
          }
          if (root) {
            await this.viewer.partHistory.fromJSON(JSON.stringify(root));
            // Sync Expressions UI with imported code
            try { if (this.viewer?.expressionsManager?.textArea) this.viewer.expressionsManager.textArea.value = this.viewer.partHistory.expressions || ''; } catch { }

            // Refresh PMI views widget from PartHistory
            try {
              if (this.viewer?.pmiViewsWidget) {
                this.viewer.pmiViewsWidget.refreshFromHistory?.();
                this.viewer.pmiViewsWidget._renderList?.();
              }
            } catch { }

            if (seq !== this._loadSeq) return;
            this._applyLoadedModelState(name, options, rec, source);
            await this.viewer.partHistory.runHistory();
            if (seq !== this._loadSeq) return;
            await this._refreshSavedHistorySnapshot();
            this._refreshHistoryCollections(refreshReason);
            return;
          }
        }
        // No feature history found → fallback to import raw 3MF as mesh via Import3D feature
        try {
          const feat = await this.viewer?.partHistory?.newFeature?.('IMPORT3D');
          if (feat) {
            feat.inputParams.fileToImport = bytes.buffer; // Import3dModelFeature can auto-detect 3MF zip
            feat.inputParams.deflectionAngle = 15;
            feat.inputParams.centerMesh = true;
          }
          await this.viewer?.partHistory?.runHistory?.();
          if (seq !== this._loadSeq) return;
          await this._refreshSavedHistorySnapshot();
          this._refreshHistoryCollections(refreshReason);
          this._applyLoadedModelState(name, options, rec, source);
          return;
        } catch { }
      } catch (e) {
        console.warn('[FileManagerWidget] Failed to load 3MF from storage; falling back to JSON if present.', e);
      }
    }
    // JSON fallback path
    try {
      const payload = (typeof rec.data === 'string') ? rec.data : JSON.stringify(rec.data);
      await this.viewer.partHistory.fromJSON(payload);
      // Sync Expressions UI with imported code
      try { if (this.viewer?.expressionsManager?.textArea) this.viewer.expressionsManager.textArea.value = this.viewer.partHistory.expressions || ''; } catch { }
    } catch (e) {
      alert('Failed to load model (invalid data).');
      console.error(e);
      return;
    }
    if (seq !== this._loadSeq) return;
    this._applyLoadedModelState(name, options, rec, source);
    await this.viewer.partHistory.runHistory();
    if (seq !== this._loadSeq) return;
    await this._refreshSavedHistorySnapshot();
    this._refreshHistoryCollections(refreshReason);
  }

  async loadModelRecord(name, rec, options = {}) {
    if (!this.viewer || !this.viewer.partHistory) return;
    const seq = ++this._loadSeq; // only the last call should win
    const source = this._resolveSource(options?.source || rec?.source || '', options?.repoFull || rec?.repoFull || '');
    await this._loadModelRecord(name, rec, options, source, seq, 'load-model-record');
  }

  async loadModel(name, options = {}) {
    if (!this.viewer || !this.viewer.partHistory) return;
    const seq = ++this._loadSeq; // only the last call should win
    const source = this._resolveSource(options?.source || '', options?.repoFull || '');
    let rec = null;
    if (source === 'github') {
      const scope = { ...options, source, throwOnError: true };
      const res = await this._retryGithubOperation(`Load "${name}" from GitHub`, () => this._getModel(name, scope));
      if (!res.ok) return;
      rec = res.value;
    } else {
      rec = await this._getModel(name, { ...options, source });
    }
    await this._loadModelRecord(name, rec, options, source, seq, 'load-model');
  }

  async deleteModel(name, options = {}) {
    const scope = {
      ...options,
      source: this._resolveSource(options?.source || '', options?.repoFull || ''),
    };
    const rec = await this._getModel(name, scope);
    if (!rec) return;
    const proceed = await confirm(`Delete model "${name}"? This cannot be undone.`);
    if (!proceed) return;
    await this._removeModel(name, scope);
    const source = this._normalizeSource(scope.source || rec?.source);
    const repo = String(options?.repoFull || rec?.repoFull || '').trim();
    if (
      this.currentName === name
      && String(this.currentRepoFull || '').trim() === repo
      && this._normalizeSource(this.currentSource) === source
    ) {
      this.currentName = '';
      this.currentRepoFull = '';
      this.currentSource = '';
      this.currentBranch = '';
      this._forceSaveTargetDialog = false;
      if (this.nameInput.value === name) this.nameInput.value = '';
    }
    await this.refreshList();
  }

  _refreshHistoryCollections(reason = 'manual') {
    const detail = { source: 'file-manager', reason };
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const evt = (typeof CustomEvent === 'function')
          ? new CustomEvent(HISTORY_COLLECTION_REFRESH_EVENT, { detail })
          : null;
        if (evt) window.dispatchEvent(evt);
        else window.dispatchEvent({ type: HISTORY_COLLECTION_REFRESH_EVENT, detail });
      }
    } catch { /* ignore */ }

    try { this.viewer?.historyWidget?.render?.(); } catch { }
    try { this.viewer?.assemblyConstraintsWidget?.render?.(); } catch { }
    try {
      if (this.viewer?.pmiViewsWidget) {
        this.viewer.pmiViewsWidget.refreshFromHistory?.();
        this.viewer.pmiViewsWidget._renderList?.();
      }
    } catch { /* ignore */ }
  }

  async refreshList() {
    if (this._refreshInFlight) {
      this._refreshQueued = true;
      return;
    }
    this._refreshInFlight = true;
    try {
      const items = await this._listModels();
      if (this._pendingGithubMeta && this._pendingGithubMeta.size) {
        for (const it of items) {
          if (this._normalizeSource(it?.source) !== 'github') continue;
          const itemKey = this._recordScopeKey(it.path || it.name, it.source, it.repoFull);
          const pending = this._pendingGithubMeta.get(itemKey);
          if (!pending) continue;
          const itemTime = it.savedAt ? Date.parse(it.savedAt) : NaN;
          const pendingTime = pending.savedAt ? Date.parse(pending.savedAt) : NaN;
          if (!Number.isFinite(itemTime) || (Number.isFinite(pendingTime) && pendingTime > itemTime)) {
            if (pending.savedAt) it.savedAt = pending.savedAt;
            if (it.record && pending.savedAt) it.record.savedAt = pending.savedAt;
            if (pending.thumbnail) {
              it.thumbnail = pending.thumbnail;
              if (it.record) it.record.thumbnail = pending.thumbnail;
              try { this._thumbCache.set(itemKey, pending.thumbnail); } catch { }
            }
          } else {
            // Remote metadata caught up; drop the pending override.
            this._pendingGithubMeta.delete(itemKey);
          }
        }
      }
      while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'fm-row';
        empty.textContent = 'No saved models yet.';
        this.listEl.appendChild(empty);
        return;
      }

      const sorted = items.slice().sort((a, b) => {
        const aTime = a?.savedAt ? Date.parse(a.savedAt) : NaN;
        const bTime = b?.savedAt ? Date.parse(b.savedAt) : NaN;
        const av = Number.isFinite(aTime) ? aTime : 0;
        const bv = Number.isFinite(bTime) ? bTime : 0;
        return bv - av;
      });
      if (this._iconsOnly) {
        this._renderIconsView(sorted);
        return;
      }

      for (const it of sorted) {
        const row = document.createElement('div');
        row.className = 'fm-row';
        const pathValue = String(it.path || it.name || '').trim();
        const displayName = String(it.displayName || '').trim() || (pathValue.includes('/') ? pathValue.split('/').pop() : pathValue);
        const folder = String(it.folder || '').trim()
          || (pathValue.includes('/') ? pathValue.slice(0, pathValue.lastIndexOf('/')) : '');
        const locationParts = [];
        const source = this._normalizeSource(it?.source);
        if (source === 'local') locationParts.push('Local Browser');
        else if (source === 'mounted') locationParts.push(String(it?.repoLabel || it?.repoFull || 'Mounted Folder').trim() || 'Mounted Folder');
        else if (it.repoFull) locationParts.push(it.repoFull);
        if (folder) locationParts.push(folder);
        const locationLabel = locationParts.join(' / ');

        const thumb = document.createElement('img');
        thumb.className = 'fm-thumb';
        thumb.alt = `${displayName || pathValue} thumbnail`;
        this._applyThumbnailToImg(it, thumb);
        thumb.addEventListener('click', () => this.loadModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch)));
        row.appendChild(thumb);

        const left = document.createElement('div');
        left.className = 'fm-left fm-grow';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'fm-name';
        nameDiv.textContent = displayName || pathValue;
        nameDiv.title = pathValue || displayName;
        nameDiv.addEventListener('click', () => this.loadModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch)));
        left.appendChild(nameDiv);
        const dt = new Date(it.savedAt);
        const dateEl = document.createElement('div');
        dateEl.className = 'fm-date';
        const dateText = isNaN(dt) ? String(it.savedAt || '') : dt.toLocaleString();
        dateEl.textContent = locationLabel ? `${dateText} · ${locationLabel}` : dateText;
        left.appendChild(dateEl);
        row.appendChild(left);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'fm-btn';
        openBtn.textContent = '📂';
        openBtn.addEventListener('click', () => this.loadModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch)));
        row.appendChild(openBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'fm-btn danger';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => this.deleteModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch)));
        row.appendChild(delBtn);

        this.listEl.appendChild(row);
      }
    } finally {
      this._refreshInFlight = false;
      if (this._refreshQueued) {
        this._refreshQueued = false;
        void this.refreshList();
      }
    }
  }

  toggleViewMode() {
    this._iconsOnly = !this._iconsOnly;
    this._saveIconsPref(this._iconsOnly);
    this._updateViewToggleUI();
    void this.refreshList();
  }
  _updateViewToggleUI() {
    if (!this.viewToggleBtn) return;
    if (this._iconsOnly) {
      this.viewToggleBtn.textContent = '☰';
      this.viewToggleBtn.title = 'Switch to list view';
    } else {
      this.viewToggleBtn.textContent = '🔳';
      this.viewToggleBtn.title = 'Switch to icons view';
    }
  }

  _renderIconsView(items) {
    const grid = document.createElement('div');
    grid.className = 'fm-grid';
    this.listEl.appendChild(grid);

    for (const it of items) {
      const pathValue = String(it.path || it.name || '').trim();
      const displayName = String(it.displayName || '').trim() || (pathValue.includes('/') ? pathValue.split('/').pop() : pathValue);
      const folder = String(it.folder || '').trim()
        || (pathValue.includes('/') ? pathValue.slice(0, pathValue.lastIndexOf('/')) : '');
      const locationParts = [];
      const source = this._normalizeSource(it?.source);
      if (source === 'local') locationParts.push('Local Browser');
      else if (source === 'mounted') locationParts.push(String(it?.repoLabel || it?.repoFull || 'Mounted Folder').trim() || 'Mounted Folder');
      else if (it.repoFull) locationParts.push(it.repoFull);
      if (folder) locationParts.push(folder);
      const locationLabel = locationParts.join(' / ');
      const cell = document.createElement('div');
      cell.className = 'fm-item';
      const dt = new Date(it.savedAt);
      const dateText = isNaN(dt) ? String(it.savedAt || '') : dt.toLocaleString();
      cell.title = `${displayName || pathValue}\n${dateText}${locationLabel ? `\n${locationLabel}` : ''}${pathValue ? `\n${pathValue}` : ''}`;
      cell.addEventListener('click', () => this.loadModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch)));

      const img = document.createElement('img');
      img.className = 'fm-thumb';
      img.alt = `${displayName || pathValue} thumbnail`;
      this._applyThumbnailToImg(it, img);
      cell.appendChild(img);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fm-btn danger fm-del';
      del.textContent = '✕';
      del.title = `Delete ${displayName || pathValue}`;
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.deleteModel(pathValue, this._buildScopeOptions(it.source, it.repoFull, it.branch));
      });
      cell.appendChild(del);

      grid.appendChild(cell);
    }
  }
  async _applyThumbnailToImg(rec, imgEl) {
    try {
      if (!imgEl) return;
      const key = this._recordScopeKey(rec?.path || rec?.name, rec?.source, rec?.repoFull);
      if (rec.thumbnail) {
        imgEl.style.display = '';
        imgEl.src = rec.thumbnail;
        if (this._thumbCache) this._thumbCache.set(key, rec.thumbnail);
        return;
      }
      if (this._thumbCache && this._thumbCache.has(key)) {
        const cached = this._thumbCache.get(key);
        if (cached) {
          imgEl.style.display = '';
          imgEl.src = cached;
          return;
        }
      }
      imgEl.style.display = 'none';
      return;
    } catch {
      if (imgEl) imgEl.style.display = 'none';
    }
  }

  async _captureThumbnail(size = THUMBNAIL_CAPTURE_SIZE) {
    try {
      const renderer = this.viewer?.renderer;
      const canvas = renderer?.domElement;
      const cam = this.viewer?.camera;
      const controls = this.viewer?.controls;
      if (!canvas || !cam) return null;

      // Temporarily reorient exactly like clicking the ViewCube corner (top-front-right)
      try {
        const dir = new THREE.Vector3(1, 1, 1); // matches TOP FRONT RIGHT corner
        if (this.viewer?.viewCube && typeof this.viewer.viewCube._reorientCamera === 'function') {
          this.viewer.viewCube._reorientCamera(dir, 'SAVE THUMBNAIL');
        } else {
          // Fallback: replicate ViewCube corner logic if widget unavailable
          const pivot = (controls && controls._gizmos && controls._gizmos.position)
            ? controls._gizmos.position.clone()
            : new THREE.Vector3(0, 0, 0);
          const dist = cam.position.distanceTo(pivot) || cam.position.length() || 10;
          const pos = pivot.clone().add(dir.clone().normalize().multiplyScalar(dist));
          const useZup = Math.abs(dir.y) > 0.9;
          const up = useZup ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
          cam.position.copy(pos);
          cam.up.copy(up);
          cam.lookAt(pivot);
          cam.updateMatrixWorld(true);
          if (controls?.updateMatrixState) { try { controls.updateMatrixState(); } catch { } }
        }
        // Fit geometry within this oriented view
        try { this.viewer.zoomToFit(1.1); } catch { }
      } catch { /* ignore orientation failures */ }

      // Ensure a fresh frame before capture
      try { this.viewer.render(); } catch { }

      // Wait one frame to be safe
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const srcW = canvas.width || canvas.clientWidth || 1;
      const srcH = canvas.height || canvas.clientHeight || 1;
      const dst = document.createElement('canvas');
      dst.width = size; dst.height = size;
      const ctx = dst.getContext('2d');
      if (!ctx) return null;
      // Leave background transparent so captures can be composited cleanly
      try { ctx.clearRect(0, 0, size, size); } catch { }
      // Compute contain fit
      const scale = Math.min(size / srcW, size / srcH);
      const dw = Math.max(1, Math.floor(srcW * scale));
      const dh = Math.max(1, Math.floor(srcH * scale));
      const dx = Math.floor((size - dw) / 2);
      const dy = Math.floor((size - dh) / 2);
      try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch { }
      ctx.drawImage(canvas, 0, 0, srcW, srcH, dx, dy, dw, dh);
      const dataUrl = dst.toDataURL('image/png');
      return dataUrl;
    } catch {
      return null;
    }
  }
}

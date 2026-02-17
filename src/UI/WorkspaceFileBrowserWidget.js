import {
  listComponentRecords,
  listWorkspaceFolders,
} from '../services/componentLibrary.js';
import { getGithubStorageConfig } from '../idbStorage.js';

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
  } = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('WorkspaceFileBrowserWidget requires a container element.');
    }
    this.container = container;
    this.onPickFile = typeof onPickFile === 'function' ? onPickFile : null;
    this.records = [];
    this.folderRecords = [];
    this.roots = [];
    this.searchTerm = '';
    this.workspaceTop = true;
    this.rootSource = 'local';
    this.rootRepoFull = '';
    this.path = '';
    this.loading = false;
    this.thumbCache = new Map();
    this._boundSearchInput = null;

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

      this._ensureSelection();
      this._setStatus('', 'info', true);
      this._render();
    } catch (err) {
      this.records = [];
      this.folderRecords = [];
      this.roots = [{ source: 'local', repoFull: '', label: 'Local Browser' }];
      this.workspaceTop = true;
      this.path = '';
      const msg = err && err.message ? err.message : String(err || 'Unknown error');
      this._setStatus(`Failed to load files: ${msg}`, 'error');
      this._render();
    } finally {
      this.loading = false;
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

  setLocation(location = {}) {
    const nextWorkspaceTop = !!location?.workspaceTop;
    if (nextWorkspaceTop) {
      this.workspaceTop = true;
      this.rootSource = 'local';
      this.rootRepoFull = '';
      this.path = '';
      this._render();
      return;
    }

    const source = normalizeStorageSource(location?.source || this.rootSource || 'local');
    const repoFull = source === 'github'
      ? String(location?.repoFull || this.rootRepoFull || '').trim()
      : '';
    const path = normalizePath(location?.path || '');

    this.workspaceTop = false;
    this.rootSource = source;
    this.rootRepoFull = repoFull;
    this.path = path;
    this._ensureSelection();
    if (this.workspaceTop) this.path = '';
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
        color: #dbe5f0;
        font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .wfb-toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      .wfb-search {
        flex: 1 1 auto;
        min-width: 0;
        border: 1px solid #2d405f;
        background: #081226;
        color: #dbe5f0;
        border-radius: 8px;
        padding: 8px 10px;
      }
      .wfb-search:focus {
        outline: none;
        border-color: #5f8dff;
        box-shadow: 0 0 0 2px rgba(95, 141, 255, 0.2);
      }
      .wfb-btn {
        border: 1px solid #2d405f;
        background: #0e1a33;
        color: #dbe5f0;
        border-radius: 8px;
        padding: 7px 10px;
        cursor: pointer;
        font: inherit;
      }
      .wfb-btn:hover {
        border-color: #5f8dff;
        background: #1a2f59;
      }
      .wfb-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .wfb-status {
        min-height: 18px;
        color: #9fb6d6;
        margin-bottom: 6px;
      }
      .wfb-status[data-tone="error"] { color: #ff9ba5; }
      .wfb-status[data-tone="ok"] { color: #95e4b2; }
      .wfb-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .wfb-crumbs {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .wfb-crumb {
        border: 1px solid #2d405f;
        background: #081226;
        color: #dbe5f0;
        border-radius: 999px;
        padding: 4px 10px;
        cursor: pointer;
        font: inherit;
      }
      .wfb-crumb:hover { border-color: #5f8dff; }
      .wfb-crumb.is-active {
        background: #274985;
        border-color: #86adff;
      }
      .wfb-crumb:disabled {
        opacity: 0.75;
        cursor: default;
      }
      .wfb-sep { color: #7e96ba; }
      .wfb-meta {
        color: #9fb6d6;
        white-space: nowrap;
      }
      .wfb-table {
        border: 1px solid #243958;
        border-radius: 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
      }
      .wfb-head,
      .wfb-row {
        display: grid;
        grid-template-columns: 98px minmax(220px, 1.3fr) 90px minmax(150px, 1fr);
        align-items: center;
      }
      .wfb-head {
        background: #122446;
        border-bottom: 1px solid #22385a;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #a9c1e4;
      }
      .wfb-head > div,
      .wfb-row > div {
        padding: 10px 12px;
        min-width: 0;
      }
      .wfb-body {
        overflow: auto;
        flex: 1 1 auto;
      }
      .wfb-row {
        border-bottom: 1px solid #182b49;
      }
      .wfb-row:last-child {
        border-bottom: none;
      }
      .wfb-name-cell {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .wfb-preview {
        width: 50px;
        height: 50px;
        border-radius: 8px;
        border: 1px solid #274268;
        background: #081226;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex: 0 0 auto;
        position: relative;
      }
      .wfb-preview-icon {
        font-size: 20px;
      }
      .wfb-preview-thumb {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: none;
      }
      .wfb-preview.has-thumb .wfb-preview-thumb { display: block; }
      .wfb-preview.has-thumb .wfb-preview-icon { visibility: hidden; }
      .wfb-name {
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-sub {
        color: #91a8ca;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wfb-action {
        justify-self: start;
      }
      .wfb-empty {
        padding: 28px 14px;
        color: #90a7c9;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  _buildUI() {
    this.root = document.createElement('section');
    this.root.className = 'wfb';
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
    toolbar.appendChild(this.searchEl);

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.type = 'button';
    this.refreshBtn.className = 'wfb-btn';
    this.refreshBtn.textContent = 'Refresh';
    this.refreshBtn.addEventListener('click', () => { void this.reload(); });
    toolbar.appendChild(this.refreshBtn);
    this.root.appendChild(toolbar);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'wfb-status';
    this.root.appendChild(this.statusEl);

    this.navEl = document.createElement('div');
    this.navEl.className = 'wfb-nav';
    this.root.appendChild(this.navEl);

    this.tableEl = document.createElement('div');
    this.tableEl.className = 'wfb-table';

    const head = document.createElement('div');
    head.className = 'wfb-head';
    head.innerHTML = '<div>Actions</div><div>Name</div><div>Kind</div><div>Modified</div>';
    this.tableEl.appendChild(head);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'wfb-body';
    this.tableEl.appendChild(this.bodyEl);
    this.root.appendChild(this.tableEl);
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

  _setWorkspaceTop() {
    this.workspaceTop = true;
    this.path = '';
    this._render();
  }

  _setRoot(source, repoFull = '') {
    this.workspaceTop = false;
    this.rootSource = normalizeStorageSource(source);
    this.rootRepoFull = String(repoFull || '').trim();
    this.path = '';
    this._render();
  }

  _setPath(path) {
    this.path = normalizePath(path);
    this._render();
  }

  _recordsForRoot(source, repoFull = '') {
    const src = normalizeStorageSource(source);
    const repo = String(repoFull || '').trim();
    return this.records.filter((entry) => {
      if (normalizeStorageSource(entry?.source) !== src) return false;
      if (src === 'local') return true;
      return String(entry?.repoFull || '').trim() === repo;
    });
  }

  _foldersForRoot(source, repoFull = '') {
    const src = normalizeStorageSource(source);
    const repo = String(repoFull || '').trim();
    return this.folderRecords.filter((entry) => {
      if (normalizeStorageSource(entry?.source) !== src) return false;
      if (src === 'local') return true;
      return String(entry?.repoFull || '').trim() === repo;
    });
  }

  _render() {
    this._renderNav();
    if (this.searchTerm) {
      const matched = this.records
        .filter((entry) => entryMatchesSearch(entry, this.searchTerm))
        .sort((a, b) => {
          const aTime = Date.parse(a?.savedAt || '') || 0;
          const bTime = Date.parse(b?.savedAt || '') || 0;
          return bTime - aTime;
        });
      if (!matched.length) {
        this._renderListBody([{ type: 'empty', text: `No files match "${this.searchTerm}".` }]);
        return;
      }
      this._renderListBody(matched.map((entry) => ({ type: 'file', entry })));
      return;
    }

    if (this.workspaceTop) {
      if (!this.roots.length) {
        this._renderListBody([{ type: 'empty', text: 'No workspace folders configured yet.' }]);
        return;
      }
      this._renderListBody(this.roots.map((entry) => ({ type: 'root', entry })));
      return;
    }

    const source = normalizeStorageSource(this.rootSource);
    const repoFull = String(this.rootRepoFull || '').trim();
    const root = this.roots.find((entry) =>
      normalizeStorageSource(entry?.source) === source
      && String(entry?.repoFull || '').trim() === repoFull,
    );
    if (!root) {
      this._renderListBody([{ type: 'empty', text: 'Select a workspace folder to browse.' }]);
      return;
    }

    const { folders, files } = collectFolderEntries(
      this._recordsForRoot(source, repoFull),
      this._foldersForRoot(source, repoFull),
      this.path,
    );
    if (!folders.length && !files.length) {
      this._renderListBody([{ type: 'empty', text: 'This folder is empty.' }]);
      return;
    }

    const rows = [
      ...folders.map((entry) => ({ type: 'folder', entry })),
      ...files.map((entry) => ({ type: 'file', entry })),
    ];
    this._renderListBody(rows);
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
      }
      if (this.path) {
        const parts = this.path.split('/').filter(Boolean);
        let partial = '';
        for (const part of parts) {
          partial = partial ? `${partial}/${part}` : part;
          appendSep();
          const partBtn = document.createElement('button');
          partBtn.type = 'button';
          partBtn.className = `wfb-crumb${partial === this.path ? ' is-active' : ''}`;
          partBtn.textContent = part;
          partBtn.disabled = partial === this.path;
          partBtn.addEventListener('click', () => this._setPath(partial));
          crumbs.appendChild(partBtn);
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

  _createRow(item) {
    const type = String(item?.type || '').trim();
    if (!type) return null;
    const entry = item?.entry || null;

    const row = document.createElement('div');
    row.className = `wfb-row is-${type}`;

    const actionCell = document.createElement('div');
    actionCell.className = 'wfb-action';
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'wfb-btn';
    actionCell.appendChild(actionBtn);
    row.appendChild(actionCell);

    const nameCell = document.createElement('div');
    nameCell.className = 'wfb-name-cell';
    row.appendChild(nameCell);

    const kindCell = document.createElement('div');
    row.appendChild(kindCell);

    const modifiedCell = document.createElement('div');
    row.appendChild(modifiedCell);

    if (type === 'root') {
      const source = normalizeStorageSource(entry?.source);
      const repoFull = String(entry?.repoFull || '').trim();
      const label = String(entry?.label || (source === 'local' ? 'Local Browser' : repoFull)).trim() || 'Workspace';
      row.title = label;
      actionBtn.textContent = 'Open';
      actionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._setRoot(source, repoFull);
      });
      row.addEventListener('click', () => this._setRoot(source, repoFull));
      const icon = document.createElement('span');
      icon.className = 'wfb-preview-icon';
      icon.textContent = source === 'local' ? '🖥️' : '🗂️';
      const preview = document.createElement('span');
      preview.className = 'wfb-preview';
      preview.appendChild(icon);
      nameCell.appendChild(preview);
      const textWrap = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'wfb-name';
      name.textContent = label;
      textWrap.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'wfb-sub';
      sub.textContent = source === 'local' ? 'Local workspace' : `GitHub repository · ${repoFull}`;
      textWrap.appendChild(sub);
      nameCell.appendChild(textWrap);
      kindCell.textContent = 'Workspace';
      modifiedCell.textContent = source === 'local' ? 'Local storage' : repoFull;
      return row;
    }

    if (type === 'folder') {
      const folderPath = normalizePath(entry?.path || '');
      const nameValue = String(entry?.name || '').trim() || 'Folder';
      row.title = folderPath || nameValue;
      actionBtn.textContent = 'Open';
      actionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._setPath(folderPath);
      });
      row.addEventListener('click', () => this._setPath(folderPath));
      const preview = document.createElement('span');
      preview.className = 'wfb-preview';
      const icon = document.createElement('span');
      icon.className = 'wfb-preview-icon';
      icon.textContent = '📁';
      preview.appendChild(icon);
      nameCell.appendChild(preview);
      const textWrap = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'wfb-name';
      name.textContent = nameValue;
      textWrap.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'wfb-sub';
      sub.textContent = folderPath;
      textWrap.appendChild(sub);
      nameCell.appendChild(textWrap);
      kindCell.textContent = 'Folder';
      const count = Number(entry?.count || 0);
      modifiedCell.textContent = count > 0
        ? `${count} item${count === 1 ? '' : 's'} · ${formatSavedAt(entry?.savedAt || '')}`
        : `Empty · ${formatSavedAt(entry?.savedAt || '')}`;
      return row;
    }

    if (type === 'file') {
      const pathValue = normalizePath(entry?.path || entry?.name || '');
      if (!pathValue) return null;
      const displayName = getEntryDisplayName(entry);
      const fullPath = getEntryFullPathTooltip(entry) || getEntryModelPathWithExtension(entry);
      row.title = fullPath;
      actionBtn.textContent = 'Select';
      actionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this._handlePickFile(entry);
      });
      row.addEventListener('dblclick', () => { void this._handlePickFile(entry); });

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
      nameCell.appendChild(preview);

      const textWrap = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'wfb-name';
      name.textContent = displayName;
      textWrap.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'wfb-sub';
      sub.textContent = fullPath;
      textWrap.appendChild(sub);
      nameCell.appendChild(textWrap);

      kindCell.textContent = 'Model';
      const location = getEntryLocationLabel(entry);
      modifiedCell.textContent = location
        ? `${formatSavedAt(entry?.savedAt || '')} · ${location}`
        : formatSavedAt(entry?.savedAt || '');
      void this._hydrateThumbnail(entry, thumb);
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
      if (imgEl.isConnected) imgEl.src = thumbDirect;
      return;
    }

    if (this.thumbCache.has(key)) {
      const cached = this.thumbCache.get(key);
      if (cached && imgEl.isConnected) imgEl.src = cached;
      return;
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
}

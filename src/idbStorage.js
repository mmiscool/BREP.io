/* idbStorage.js
   VFS-backed app storage with a localStorage-like API.
   - Synchronous reads via in-memory cache
   - Async persistence to VFS (fs.proxy -> __BREP_VFS_DB__)
   - Same-tab + optional cross-tab change events
   - Migrates legacy __LS_SHIM_DB__ data into VFS
*/

import { fs } from './fs.proxy.js';
import { GithubStorage } from './githubStorage.js';

const SETTINGS_DIR = 'settings';
const DATA_DIR = '__BREP_DATA__';
const MODEL_PREFIX = '__BREP_DATA__:';
const LEGACY_MODEL_PREFIX = '__BREP_MODEL__:';
const LEGACY_DB_NAME = '__LS_SHIM_DB__';
const LEGACY_STORE_NAME = 'kv';
const BC_NAME = '__BREP_STORAGE_BC__';
const STORAGE_BACKEND_EVENT = 'brep-storage-backend-change';
const GH_TOKEN_KEY = '__BREP_GH_TOKEN__';
const GH_REPO_KEY = '__BREP_GH_REPO__';
const GH_BRANCH_KEY = '__BREP_GH_BRANCH__';

const hasIndexedDB = typeof indexedDB !== 'undefined' && !!indexedDB.open;

function toStringValue(v) {
  return v === undefined || v === null ? String(v) : String(v);
}

function getConfigStorage() {
  try {
    if (typeof window !== 'undefined') {
      return window.sessionStorage || window.localStorage || null;
    }
  } catch {}
  return null;
}

function loadGithubConfig() {
  const store = getConfigStorage();
  if (!store) return { token: '', repoFull: '', branch: '' };
  return {
    token: store.getItem(GH_TOKEN_KEY) || '',
    repoFull: store.getItem(GH_REPO_KEY) || '',
    branch: store.getItem(GH_BRANCH_KEY) || '',
  };
}

function saveGithubConfig({ token, repoFull, branch }) {
  const store = getConfigStorage();
  if (!store) return;
  const setOrClear = (key, value) => {
    const v = String(value || '').trim();
    if (v) store.setItem(key, v);
    else store.removeItem(key);
  };
  setOrClear(GH_TOKEN_KEY, token);
  setOrClear(GH_REPO_KEY, repoFull);
  setOrClear(GH_BRANCH_KEY, branch);
}

function tryDispatchStorageEvent(storage, { key, oldValue, newValue }) {
  try {
    if (typeof window !== 'undefined') {
      let ev;
      try {
        ev = new StorageEvent('storage', {
          key,
          oldValue,
          newValue,
          url: window.location.href,
          storageArea: storage,
        });
      } catch {
        ev = new CustomEvent('storage', { detail: { key, oldValue, newValue } });
      }
      window.dispatchEvent(ev);
    }
  } catch {}
}

function joinPath(...parts) {
  return parts.filter(Boolean).join('/');
}

function encodeSettingKey(key) {
  const k = String(key ?? '');
  if (!k || k === '.' || k === '..' || k.includes('/') || k.includes('\\')) {
    return encodeURIComponent(k);
  }
  return k;
}

function decodeSettingKey(name) {
  if (/%[0-9A-Fa-f]{2}/.test(name)) {
    try { return decodeURIComponent(name); } catch {}
  }
  return name;
}

function isModelKey(key) {
  return typeof key === 'string' && key.startsWith(MODEL_PREFIX);
}

function isLegacyModelKey(key) {
  return typeof key === 'string' && key.startsWith(LEGACY_MODEL_PREFIX);
}

function normalizeModelKey(key) {
  if (isModelKey(key)) return key;
  if (isLegacyModelKey(key)) return MODEL_PREFIX + key.slice(LEGACY_MODEL_PREFIX.length);
  return null;
}

function keyToPath(key) {
  if (isModelKey(key)) {
    const name = key.slice(MODEL_PREFIX.length);
    return joinPath(DATA_DIR, name);
  }
  return joinPath(SETTINGS_DIR, encodeSettingKey(key));
}

async function ensureDir(path) {
  try {
    await fs.promises.mkdir(path, { recursive: true });
  } catch (e) {
    if (e && e.code !== 'EEXIST') throw e;
  }
}

async function exists(path) {
  try {
    await fs.promises.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileSafe(path) {
  try {
    return await fs.promises.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readDirSafe(path) {
  try {
    return await fs.promises.readdir(path);
  } catch {
    return [];
  }
}

async function deleteLegacyDb() {
  if (!hasIndexedDB) return;
  await new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function openLegacyDb() {
  if (!hasIndexedDB) return { db: null, created: false };
  return new Promise((resolve, reject) => {
    let created = false;
    let req;
    try {
      req = indexedDB.open(LEGACY_DB_NAME);
    } catch (e) {
      resolve({ db: null, created: false });
      return;
    }
    req.onupgradeneeded = () => { created = true; };
    req.onsuccess = () => {
      const db = req.result;
      if (created) {
        try { db.close(); } catch {}
        resolve({ db: null, created: true });
        return;
      }
      resolve({ db, created: false });
    };
    req.onerror = () => reject(req.error || new Error('Failed to open legacy DB'));
  });
}

async function readAllLegacyEntries(db) {
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        resolve(new Map());
        return;
      }
      const tx = db.transaction([LEGACY_STORE_NAME], 'readonly');
      const store = tx.objectStore(LEGACY_STORE_NAME);
      const out = new Map();
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const rawKey = cursor.key;
          const rawVal = cursor.value;
          const key = String(rawKey);
          let value = rawVal;
          if (value && typeof value === 'object' && 'value' in value) value = value.value;
          out.set(key, value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error || new Error('Legacy cursor failed'));
    } catch (e) {
      reject(e);
    }
  });
}

class VfsStorage {
  constructor() {
    this._cache = new Map();
    this._ready = false;
    this._persistChain = Promise.resolve();
    this._bc = null;
    this._initPromise = this._init();
  }

  async _init() {
    try {
      await fs.ready();
      await ensureDir(SETTINGS_DIR);
      await ensureDir(DATA_DIR);
      await this._migrateLegacyIdb();
      await this._migrateLegacyFs();
      await this._loadFromFs();
      this._setupBroadcast();
    } catch (e) {
      console.warn('[vfs-storage] init failed; using in-memory storage only.', e);
    }
    this._ready = true;
  }

  async _loadFromFs() {
    this._cache.clear();
    const settingFiles = await readDirSafe(SETTINGS_DIR);
    for (const name of settingFiles) {
      const path = joinPath(SETTINGS_DIR, name);
      const raw = await readFileSafe(path);
      if (raw === null) continue;
      const key = decodeSettingKey(name);
      this._cache.set(key, toStringValue(raw));
    }
    const dataFiles = await readDirSafe(DATA_DIR);
    for (const name of dataFiles) {
      const path = joinPath(DATA_DIR, name);
      const raw = await readFileSafe(path);
      if (raw === null) continue;
      const key = MODEL_PREFIX + name;
      this._cache.set(key, toStringValue(raw));
    }
  }

  async _writeKeyToFs(key, value) {
    const path = keyToPath(key);
    await ensureDir(isModelKey(key) ? DATA_DIR : SETTINGS_DIR);
    await fs.promises.writeFile(path, toStringValue(value), 'utf8');
  }

  async _removeKeyFromFs(key) {
    const path = keyToPath(key);
    try {
      await fs.promises.unlink(path);
    } catch (e) {
      if (!e || e.code !== 'ENOENT') throw e;
    }
  }

  async _resetDir(path) {
    try {
      await fs.promises.rm(path, { recursive: true, force: true });
    } catch {}
    await ensureDir(path);
  }

  async _migrateLegacyIdb() {
    if (!hasIndexedDB) return;
    let db;
    try {
      const opened = await openLegacyDb();
      if (!opened.db) {
        if (opened.created) await deleteLegacyDb();
        return;
      }
      db = opened.db;
      const entries = await readAllLegacyEntries(db);
      for (const [rawKey, rawVal] of entries) {
        const key = String(rawKey);
        const value = toStringValue(rawVal);
        const normalized = normalizeModelKey(key);
        const destKey = normalized || key;
        const destPath = keyToPath(destKey);
        if (await exists(destPath)) continue;
        await this._writeKeyToFs(destKey, value);
      }
    } catch (e) {
      console.warn('[vfs-storage] legacy IndexedDB migration failed:', e);
      return;
    } finally {
      try { db && db.close && db.close(); } catch {}
    }
    await deleteLegacyDb();
  }

  async _migrateLegacyFs() {
    // Move any legacy model keys mistakenly stored under settings/
    const settingFiles = await readDirSafe(SETTINGS_DIR);
    for (const name of settingFiles) {
      if (!name.startsWith(LEGACY_MODEL_PREFIX)) continue;
      const legacyPath = joinPath(SETTINGS_DIR, name);
      const raw = await readFileSafe(legacyPath);
      const key = MODEL_PREFIX + name.slice(LEGACY_MODEL_PREFIX.length);
      if (raw !== null) {
        const destPath = keyToPath(key);
        if (!await exists(destPath)) {
          await this._writeKeyToFs(key, raw);
        }
      }
      try { await fs.promises.unlink(legacyPath); } catch {}
    }

    // Move any legacy data directory (__BREP_MODEL__) contents to __BREP_DATA__
    const legacyDir = '__BREP_MODEL__';
    const legacyFiles = await readDirSafe(legacyDir);
    if (!legacyFiles.length) return;
    await ensureDir(DATA_DIR);
    for (const name of legacyFiles) {
      const from = joinPath(legacyDir, name);
      const to = joinPath(DATA_DIR, name);
      if (await exists(to)) {
        try { await fs.promises.unlink(from); } catch {}
        continue;
      }
      try {
        await fs.promises.rename(from, to);
      } catch {
        const raw = await readFileSafe(from);
        if (raw !== null) {
          await fs.promises.writeFile(to, raw, 'utf8');
        }
        try { await fs.promises.unlink(from); } catch {}
      }
    }
    try { await fs.promises.rm(legacyDir, { recursive: true, force: true }); } catch {}
  }

  _setupBroadcast() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this._bc = new BroadcastChannel(BC_NAME);
        this._bc.onmessage = (ev) => {
          const { type, key, newValue, oldValue } = ev.data || {};
          if (type === 'set') {
            const prev = this._cache.get(key) ?? null;
            const next = toStringValue(newValue);
            this._cache.set(key, next);
            tryDispatchStorageEvent(this, { key, oldValue: prev, newValue: next });
          } else if (type === 'remove') {
            const prev = this._cache.get(key) ?? null;
            this._cache.delete(key);
            tryDispatchStorageEvent(this, { key, oldValue: prev, newValue: null });
          } else if (type === 'clear') {
            if (this._cache.size) {
              this._cache.clear();
              tryDispatchStorageEvent(this, { key: null, oldValue: null, newValue: null });
            }
          }
        };
      }
    } catch {}
  }

  get length() {
    return this._cache.size;
  }

  key(n) {
    if (typeof n !== 'number' || n < 0 || n >= this._cache.size) return null;
    return Array.from(this._cache.keys())[n] ?? null;
  }

  getItem(key) {
    const k = toStringValue(key);
    const v = this._cache.get(k);
    return v === undefined ? null : v;
  }

  _enqueuePersist(op) {
    this._persistChain = this._persistChain
      .then(() => this._initPromise)
      .then(op)
      .catch((e) => {
        console.warn('[vfs-storage] persist failed:', e);
      });
  }

  setItem(key, value) {
    const k = toStringValue(key);
    const v = toStringValue(value);
    const oldValue = this._cache.get(k) ?? null;
    this._cache.set(k, v);

    this._enqueuePersist(() => this._writeKeyToFs(k, v));

    tryDispatchStorageEvent(this, { key: k, oldValue, newValue: v });
    try { this._bc?.postMessage({ type: 'set', key: k, newValue: v, oldValue }); } catch {}
  }

  removeItem(key) {
    const k = toStringValue(key);
    const oldValue = this._cache.get(k) ?? null;
    this._cache.delete(k);

    this._enqueuePersist(() => this._removeKeyFromFs(k));

    tryDispatchStorageEvent(this, { key: k, oldValue, newValue: null });
    try { this._bc?.postMessage({ type: 'remove', key: k, oldValue, newValue: null }); } catch {}
  }

  clear() {
    if (this._cache.size === 0) return;
    this._cache.clear();

    this._enqueuePersist(async () => {
      await this._resetDir(SETTINGS_DIR);
      await this._resetDir(DATA_DIR);
    });

    tryDispatchStorageEvent(this, { key: null, oldValue: null, newValue: null });
    try { this._bc?.postMessage({ type: 'clear' }); } catch {}
  }

  *keys() {
    yield* this._cache.keys();
  }

  ready() {
    return this._initPromise;
  }
}

class StorageProxy {
  constructor(localBackend, githubBackend) {
    this._local = localBackend;
    this._github = githubBackend;
    this._backend = localBackend;
    this._mode = 'local';
  }

  _dispatchBackendEvent() {
    try {
      if (typeof window !== 'undefined') {
        const detail = this.getBackendInfo();
        window.dispatchEvent(new CustomEvent(STORAGE_BACKEND_EVENT, { detail }));
      }
    } catch {}
  }

  async useGithub(config) {
    await this._github.configure(config);
    this._backend = this._github;
    this._mode = 'github';
    this._dispatchBackendEvent();
  }

  async useLocal() {
    this._backend = this._local;
    this._mode = 'local';
    this._dispatchBackendEvent();
  }

  isGithub() {
    return this._mode === 'github';
  }

  getBackendInfo() {
    return {
      mode: this._mode,
      github: this._github?.getInfo?.() || null,
    };
  }

  get length() {
    return this._backend?.length ?? 0;
  }

  key(n) {
    return this._backend?.key?.(n) ?? null;
  }

  getItem(key) {
    return this._backend?.getItem?.(key) ?? null;
  }

  setItem(key, value) {
    return this._backend?.setItem?.(key, value);
  }

  removeItem(key) {
    return this._backend?.removeItem?.(key);
  }

  clear() {
    return this._backend?.clear?.();
  }

  *keys() {
    if (this._backend && typeof this._backend.keys === 'function') {
      yield* this._backend.keys();
    }
  }

  ready() {
    try { return this._backend?.ready?.() ?? Promise.resolve(); } catch { return Promise.resolve(); }
  }
}

const _localBackend = new VfsStorage();
const _githubBackend = new GithubStorage();
const localStorage = new StorageProxy(_localBackend, _githubBackend);

const initialGh = loadGithubConfig();
if (initialGh.token && initialGh.repoFull) {
  localStorage.useGithub(initialGh).catch((e) => {
    console.warn('[storage] GitHub init failed; falling back to local.', e);
    localStorage.useLocal();
  });
}

function getGithubStorageConfig() {
  const cfg = loadGithubConfig();
  if ((!cfg.branch || !cfg.repoFull) && localStorage?.isGithub?.()) {
    const info = localStorage.getBackendInfo?.();
    const branch = info?.github?.branch || cfg.branch || '';
    const repoFull = info?.github?.repoFull || cfg.repoFull || '';
    return { ...cfg, branch, repoFull };
  }
  return cfg;
}

async function configureGithubStorage({ token, repoFull, branch, persist = true } = {}) {
  const prev = loadGithubConfig();
  const next = {
    token: token !== undefined ? String(token || '') : prev.token,
    repoFull: repoFull !== undefined ? String(repoFull || '') : prev.repoFull,
    branch: branch !== undefined ? String(branch || '') : prev.branch,
  };
  if (persist) saveGithubConfig(next);
  if (next.token && next.repoFull) {
    await localStorage.useGithub(next);
    return { enabled: true, mode: 'github' };
  }
  await localStorage.useLocal();
  return { enabled: false, mode: 'local' };
}

async function clearGithubStorageConfig() {
  saveGithubConfig({ token: '', repoFull: '', branch: '' });
  await localStorage.useLocal();
}

export {
  localStorage,
  STORAGE_BACKEND_EVENT,
  configureGithubStorage,
  getGithubStorageConfig,
  clearGithubStorageConfig,
};

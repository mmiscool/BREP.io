const GH = {
  apiBase: 'https://api.github.com',
  apiVersion: '2022-11-28',
};

const _WRITE_CHAINS = new Map();

function _enqueueGithubWrite(key, op) {
  const prev = _WRITE_CHAINS.get(key) || Promise.resolve();
  const next = prev.then(op);
  let safe;
  safe = next.catch(() => {}).finally(() => {
    if (_WRITE_CHAINS.get(key) === safe) _WRITE_CHAINS.delete(key);
  });
  _WRITE_CHAINS.set(key, safe);
  return next;
}

const STORAGE_ROOT = 'brep-storage';
const SETTINGS_DIR = 'settings';
const DATA_DIR = '__BREP_DATA__';
const MODEL_PREFIX = '__BREP_DATA__:';

function toStringValue(v) {
  return v === undefined || v === null ? String(v) : String(v);
}

function joinPath(...parts) {
  return parts.filter(Boolean).join('/');
}

function encodePath(path) {
  return String(path || '')
    .split('/')
    .map((part) => {
      if (!part) return '';
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join('/');
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

function keyToPath(key, rootDir = STORAGE_ROOT) {
  if (isModelKey(key)) {
    const name = key.slice(MODEL_PREFIX.length);
    return joinPath(rootDir, DATA_DIR, name);
  }
  return joinPath(rootDir, SETTINGS_DIR, encodeSettingKey(key));
}

function pathToKey(path, rootDir = STORAGE_ROOT) {
  const clean = String(path || '').replace(/^\/+/, '');
  const base = joinPath(rootDir, '');
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  if (!clean.startsWith(baseWithSlash)) return null;
  const rel = clean.slice(baseWithSlash.length).replace(/^\/+/, '');
  if (rel.startsWith(`${DATA_DIR}/`)) {
    const name = rel.slice(DATA_DIR.length + 1);
    return MODEL_PREFIX + name;
  }
  if (rel.startsWith(`${SETTINGS_DIR}/`)) {
    const name = rel.slice(SETTINGS_DIR.length + 1);
    return decodeSettingKey(name);
  }
  return null;
}

function authHeaders(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': GH.apiVersion,
  };
}

async function ghFetch(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders(token) },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status} ${res.statusText}\n${url}\n\n${text}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await res.json();
  return await res.text();
}

async function ghFetchAllPages(url, token) {
  let out = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers: authHeaders(token) });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`HTTP ${res.status} ${res.statusText}\n${next}\n\n${text}`);
      err.status = res.status;
      throw err;
    }
    out = out.concat(await res.json());
    next = null;
    const link = res.headers.get('link');
    if (link) {
      for (const part of link.split(',').map(s => s.trim())) {
        const m = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
        if (m && m[2] === 'next') {
          next = m[1];
          break;
        }
      }
    }
  }
  return out;
}

function parseRepo(full) {
  const [owner, repo] = String(full || '').trim().split('/');
  if (!owner || !repo) throw new Error('Invalid repo; expected owner/repo.');
  return { owner, repo };
}

function encodeBase64(text) {
  const v = toStringValue(text);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(v, 'utf8').toString('base64');
  }
  if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(v);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  return btoa(unescape(encodeURIComponent(v)));
}

function decodeBase64(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(clean, 'base64').toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined' && typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(escape(atob(clean)));
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

export async function fetchGithubUserRepos(token) {
  const t = String(token || '').trim();
  if (!t) return [];
  const url = `${GH.apiBase}/user/repos?per_page=100&sort=updated&direction=desc`;
  return await ghFetchAllPages(url, t);
}

export function getGithubStorageRoot() {
  return STORAGE_ROOT;
}

export function encodeRepoItemName(name) {
  return encodeURIComponent(String(name || ''));
}

export function decodeRepoItemName(name) {
  try { return decodeURIComponent(String(name || '')); } catch { return String(name || ''); }
}

export async function listGithubDir({ token, repoFull, branch, path }) {
  const t = String(token || '').trim();
  if (!t) return [];
  const { owner, repo } = parseRepo(repoFull);
  const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
  if (branch) url.searchParams.set('ref', branch);
  try {
    const data = await ghFetch(url.toString(), t);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e && e.status === 404) return [];
    throw e;
  }
}

export async function listGithubRepoTree({ token, repoFull, branch }) {
  const t = String(token || '').trim();
  if (!t) return { files: [], dirs: [], truncated: false };
  const { owner, repo } = parseRepo(repoFull);
  let ref = String(branch || '').trim();
  if (!ref) {
    const meta = await ghFetch(`${GH.apiBase}/repos/${owner}/${repo}`, t);
    ref = String(meta?.default_branch || '').trim() || 'main';
  }
  const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}`);
  url.searchParams.set('recursive', '1');
  const data = await ghFetch(url.toString(), t);
  const tree = Array.isArray(data?.tree) ? data.tree : [];
  const files = [];
  const dirs = [];
  for (const item of tree) {
    const itemPath = String(item?.path || '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!itemPath) continue;
    if (item?.type === 'tree') {
      dirs.push({ path: itemPath, type: 'dir' });
      continue;
    }
    if (item?.type === 'blob') {
      files.push({
        type: 'file',
        path: itemPath,
        sha: item?.sha || null,
        size: Number.isFinite(item?.size) ? item.size : null,
      });
    }
  }
  return {
    files,
    dirs,
    truncated: !!data?.truncated,
    ref,
  };
}

export async function readGithubFileBase64({ token, repoFull, branch, path }) {
  const t = String(token || '').trim();
  if (!t) return null;
  const { owner, repo } = parseRepo(repoFull);
  const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
  if (branch) url.searchParams.set('ref', branch);
  const data = await ghFetch(url.toString(), t);
  if (data && data.content && data.encoding === 'base64') return String(data.content || '').replace(/\s+/g, '');
  return null;
}

export async function writeGithubFileBase64({ token, repoFull, branch, path, base64, message, retryOn409 = 2 }) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Missing GitHub token');
  const { owner, repo } = parseRepo(repoFull);
  const url = `${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
  const content = String(base64 || '').replace(/\s+/g, '');
  const maxRetry = Math.max(0, Number.isFinite(retryOn409) ? retryOn409 : 0);
  const writeKey = `${repoFull}@${branch || ''}:${path}`;

  return _enqueueGithubWrite(writeKey, async () => {
    let sha = null;
    const refreshSha = async () => {
      try {
        const meta = await readGithubFileMeta({ token: t, repoFull, branch, path });
        sha = meta?.sha || null;
      } catch (e) {
        if (!e || e.status !== 404) throw e;
        sha = null;
      }
    };

    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      await refreshSha();
      const body = {
        message: message || `BREP storage update: ${path}`,
        content,
      };
      if (branch) body.branch = branch;
      if (sha) body.sha = sha;
      try {
        const res = await ghFetch(url, t, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res;
      } catch (e) {
        if (e && e.status === 409 && attempt < maxRetry) {
          continue;
        }
        throw e;
      }
    }
    return null;
  });
}

export async function deleteGithubFile({ token, repoFull, branch, path, message }) {
  const t = String(token || '').trim();
  if (!t) return;
  const { owner, repo } = parseRepo(repoFull);
  let sha = null;
  try {
    const meta = await readGithubFileMeta({ token: t, repoFull, branch, path });
    sha = meta?.sha || null;
  } catch (e) {
    if (!e || e.status !== 404) throw e;
    return;
  }
  if (!sha) return;
  const body = {
    message: message || `BREP storage delete: ${path}`,
    sha,
  };
  if (branch) body.branch = branch;
  const url = `${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
  await ghFetch(url, t, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readGithubFileMeta({ token, repoFull, branch, path }) {
  const t = String(token || '').trim();
  if (!t) return null;
  const { owner, repo } = parseRepo(repoFull);
  const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
  if (branch) url.searchParams.set('ref', branch);
  url.searchParams.set('_ts', Date.now().toString());
  return await ghFetch(url.toString(), t, {
    cache: 'no-store',
  });
}

export class GithubStorage {
  constructor(config = {}) {
    this._cache = new Map();
    this._shaByKey = new Map();
    this._ready = false;
    this._persistChain = Promise.resolve();
    this._session = 0;
    this.configure(config);
  }

  async configure(config = {}) {
    this._session += 1;
    const session = this._session;
    this._cache.clear();
    this._shaByKey.clear();
    this._token = config.token || null;
    this._repoFull = config.repoFull || config.repo || null;
    this._repo = this._repoFull ? parseRepo(this._repoFull) : null;
    this._branch = config.branch || null;
    this._rootDir = config.rootDir || STORAGE_ROOT;
    this._ready = false;
    this._initPromise = this._init(session);
    return this._initPromise;
  }

  async _init(session) {
    if (!this._token || !this._repo) {
      this._ready = true;
      return;
    }
    try {
      const { owner, repo } = this._repo;
      const meta = await ghFetch(`${GH.apiBase}/repos/${owner}/${repo}`, this._token);
      if (session !== this._session) return;
      if (!this._branch) this._branch = meta.default_branch || 'main';
      await this._loadFromRepo(session);
    } catch (e) {
      console.warn('[github-storage] init failed; using empty cache.', e);
    } finally {
      if (session === this._session) this._ready = true;
    }
  }

  async _listDir(path) {
    const { owner, repo } = this._repo;
    const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
    url.searchParams.set('ref', this._branch || 'main');
    try {
      const data = await ghFetch(url.toString(), this._token);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e && e.status === 404) return [];
      throw e;
    }
  }

  async _readFileContent(path, meta) {
    let file = meta;
    if (!file || !file.content) {
      const { owner, repo } = this._repo;
      const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
      url.searchParams.set('ref', this._branch || 'main');
      file = await ghFetch(url.toString(), this._token);
    }
    if (file && file.content && file.encoding === 'base64') {
      return decodeBase64(file.content);
    }
    if (file && file.download_url) {
      const res = await fetch(file.download_url, { headers: authHeaders(this._token) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${file.download_url}`);
      return await res.text();
    }
    return '';
  }

  async _loadFromRepo(session) {
    const walk = async (dir) => {
      const items = await this._listDir(dir);
      for (const it of items) {
        if (session !== this._session) return;
        if (it.type === 'dir') {
          await walk(it.path);
          continue;
        }
        if (it.type !== 'file') continue;
        const key = pathToKey(it.path, this._rootDir);
        if (!key) continue;
        try {
          const content = await this._readFileContent(it.path, it);
          this._cache.set(key, toStringValue(content));
          if (it.sha) this._shaByKey.set(key, it.sha);
        } catch (e) {
          console.warn('[github-storage] failed to read', it.path, e);
        }
      }
    };
    await walk(this._rootDir);
  }

  _enqueuePersist(op) {
    this._persistChain = this._persistChain
      .then(() => this._initPromise)
      .then(op)
      .catch((e) => {
        console.warn('[github-storage] persist failed:', e);
      });
  }

  async _getFileMeta(path) {
    const { owner, repo } = this._repo;
    const url = new URL(`${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`);
    url.searchParams.set('ref', this._branch || 'main');
    url.searchParams.set('_ts', Date.now().toString());
    return await ghFetch(url.toString(), this._token, {
      cache: 'no-store',
    });
  }

  async _writeKeyToRepo(key, value) {
    if (!this._token || !this._repo) return;
    const { owner, repo } = this._repo;
    const path = keyToPath(key, this._rootDir);
    const url = `${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
    const content = encodeBase64(value);
    const writeKey = `${this._repoFull || ''}@${this._branch || ''}:${path}`;
    return _enqueueGithubWrite(writeKey, async () => {
      let sha = null;
      const refreshSha = async () => {
        try {
          const meta = await this._getFileMeta(path);
          sha = meta?.sha || null;
          if (sha) this._shaByKey.set(key, sha);
        } catch (e) {
          if (!e || e.status !== 404) throw e;
          sha = null;
        }
      };

      for (let attempt = 0; attempt <= 1; attempt++) {
        await refreshSha();
        const body = {
          message: `BREP storage update: ${key}`,
          content,
          branch: this._branch || 'main',
        };
        if (sha) body.sha = sha;
        try {
          const res = await ghFetch(url, this._token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (res && res.content && res.content.sha) {
            this._shaByKey.set(key, res.content.sha);
          }
          return;
        } catch (e) {
          if (e && e.status === 409 && attempt < 1) {
            continue;
          }
          throw e;
        }
      }
    });
  }

  async _removeKeyFromRepo(key) {
    if (!this._token || !this._repo) return;
    const { owner, repo } = this._repo;
    const path = keyToPath(key, this._rootDir);
    let sha = this._shaByKey.get(key) || null;
    if (!sha) {
      try {
        const meta = await this._getFileMeta(path);
        sha = meta?.sha || null;
        if (sha) this._shaByKey.set(key, sha);
      } catch (e) {
        if (!e || e.status !== 404) throw e;
        return;
      }
    }
    if (!sha) return;
    const body = {
      message: `BREP storage delete: ${key}`,
      sha,
      branch: this._branch || 'main',
    };
    const url = `${GH.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
    await ghFetch(url, this._token, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    this._shaByKey.delete(key);
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

  setItem(key, value) {
    const k = toStringValue(key);
    const v = toStringValue(value);
    const oldValue = this._cache.get(k) ?? null;
    this._cache.set(k, v);

    this._enqueuePersist(() => this._writeKeyToRepo(k, v));

    tryDispatchStorageEvent(this, { key: k, oldValue, newValue: v });
  }

  removeItem(key) {
    const k = toStringValue(key);
    const oldValue = this._cache.get(k) ?? null;
    this._cache.delete(k);

    this._enqueuePersist(() => this._removeKeyFromRepo(k));

    tryDispatchStorageEvent(this, { key: k, oldValue, newValue: null });
  }

  clear() {
    if (this._cache.size === 0) return;
    const keys = Array.from(this._cache.keys());
    this._cache.clear();
    this._enqueuePersist(async () => {
      for (const k of keys) await this._removeKeyFromRepo(k);
    });
    tryDispatchStorageEvent(this, { key: null, oldValue: null, newValue: null });
  }

  *keys() {
    yield* this._cache.keys();
  }

  ready() {
    return this._initPromise;
  }

  getInfo() {
    return {
      repoFull: this._repoFull,
      branch: this._branch,
      rootDir: this._rootDir,
      ready: this._ready,
    };
  }
}

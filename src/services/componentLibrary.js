import {
  localStorage as LS,
  getLocalStorageBackend,
  getGithubStorageConfig,
} from '../idbStorage.js';
import {
  listGithubDir,
  listGithubRepoTree,
  readGithubFileBase64,
  writeGithubFileBase64,
  deleteGithubFile,
  getGithubStorageRoot,
  encodeRepoItemName,
  decodeRepoItemName,
} from '../githubStorage.js';

export const MODEL_STORAGE_PREFIX = '__BREP_DATA__:';
export const FOLDER_STORAGE_PREFIX = '__BREP_FOLDER__:';
const MODEL_FILE_EXT = '.3mf';
const MODEL_META_EXT = '.meta.json';
const MODEL_THUMB_EXT = '.png';
const FOLDER_MARKER_FILE = '.brep-folder.json';
const LEGACY_GITHUB_DATA_DIR = `${getGithubStorageRoot()}/__BREP_DATA__`;
const githubModelPathModeCache = new Map();
const GITHUB_TREE_CACHE_TTL_MS = 15 * 1000;
const githubRepoTreeCache = new Map();
const githubRepoTreeInflight = new Map();
const githubRepoTreeVersion = new Map();

function normalizeBase64Payload(payload) {
  let b64 = String(payload || '');
  if (b64.startsWith('data:') && b64.includes(';base64,')) {
    b64 = b64.split(';base64,')[1] || '';
  }
  return b64.replace(/\s+/g, '');
}

function parseBase64DataUrl(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('data:')) return null;
  const marker = ';base64,';
  const markerIdx = raw.indexOf(marker);
  if (markerIdx < 0) return null;
  const mimeRaw = raw.slice(5, markerIdx).split(';')[0] || 'application/octet-stream';
  const mime = String(mimeRaw || '').trim().toLowerCase() || 'application/octet-stream';
  const base64 = normalizeBase64Payload(raw.slice(markerIdx + marker.length));
  if (!base64) return null;
  return { mime, base64 };
}

function makeBase64DataUrl(mime, base64) {
  const payload = normalizeBase64Payload(base64);
  if (!payload) return '';
  return `data:${String(mime || 'application/octet-stream').trim().toLowerCase()};base64,${payload}`;
}

function normalizeStoredThumbnail(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = parseBase64DataUrl(raw);
  if (parsed) return makeBase64DataUrl(parsed.mime, parsed.base64);
  const base64 = normalizeBase64Payload(raw);
  if (!base64) return null;
  return makeBase64DataUrl('image/png', base64);
}

async function convertDataUrlToPngBase64(value) {
  const parsed = parseBase64DataUrl(value);
  if (!parsed || !parsed.mime.startsWith('image/')) return '';
  if (parsed.mime === 'image/png') return parsed.base64;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return '';
  try {
    const src = makeBase64DataUrl(parsed.mime, parsed.base64);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode thumbnail image'));
      img.src = src;
    });
    const width = Math.max(1, Number(image?.naturalWidth || image?.width || 0));
    const height = Math.max(1, Number(image?.naturalHeight || image?.height || 0));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const pngDataUrl = canvas.toDataURL('image/png');
    const pngParsed = parseBase64DataUrl(pngDataUrl);
    return pngParsed?.base64 || '';
  } catch {
    return '';
  }
}

async function normalizeThumbnailToPngBase64(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('data:')) return normalizeBase64Payload(raw);
  return await convertDataUrlToPngBase64(raw);
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

function normalizeComponentPath(input) {
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

function splitComponentPath(path) {
  const normalized = normalizeComponentPath(path);
  if (!normalized) return { path: '', folder: '', displayName: '' };
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { path: normalized, folder: '', displayName: normalized };
  return {
    path: normalized,
    folder: normalized.slice(0, idx),
    displayName: normalized.slice(idx + 1),
  };
}

function resolveComponentPath(name, options = {}) {
  if (options?.path !== undefined) {
    const fromOption = normalizeComponentPath(options.path);
    if (fromOption) return fromOption;
  }
  return normalizeComponentPath(name);
}

function resolveFolderPath(path) {
  return normalizeComponentPath(path);
}

function encodeGithubRelativeModelPath(path) {
  const normalized = normalizeComponentPath(path);
  if (!normalized) return '';
  return normalized
    .split('/')
    .map((part) => encodeRepoItemName(part))
    .join('/');
}

function decodeGithubRelativeModelPath(path) {
  const raw = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!raw) return '';
  return raw
    .split('/')
    .map((part) => decodeRepoItemName(part))
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('/');
}

function stripKnownModelExtension(path) {
  const value = normalizeComponentPath(path);
  const lower = value.toLowerCase();
  if (lower.endsWith(MODEL_META_EXT)) return value.slice(0, -MODEL_META_EXT.length);
  if (lower.endsWith(MODEL_FILE_EXT)) return value.slice(0, -MODEL_FILE_EXT.length);
  if (lower.endsWith(MODEL_THUMB_EXT)) return value.slice(0, -MODEL_THUMB_EXT.length);
  return value;
}

function getGithubPrimaryModelPaths(pathOrName) {
  const modelPath = stripKnownModelExtension(pathOrName);
  if (!modelPath) return { modelPath: '', dataPath: '', metaPath: '' };
  return {
    modelPath,
    dataPath: `${modelPath}${MODEL_FILE_EXT}`,
    metaPath: `${modelPath}${MODEL_META_EXT}`,
    thumbnailPath: `${modelPath}${MODEL_THUMB_EXT}`,
  };
}

function resolveGithubScope(options = {}) {
  const cfg = getGithubStorageConfig() || {};
  const token = options?.token !== undefined ? String(options.token || '').trim() : String(cfg.token || '').trim();
  const branch = options?.branch !== undefined ? String(options.branch || '').trim() : String(cfg.branch || '').trim();
  let repoFull = options?.repoFull !== undefined ? String(options.repoFull || '').trim() : String(cfg.repoFull || '').trim();
  let repoFulls = options?.repoFulls !== undefined
    ? normalizeRepoFullList(options.repoFulls)
    : (repoFull ? [repoFull] : []);
  if (!repoFull && repoFulls.length) repoFull = repoFulls[0];
  if (repoFull && !repoFulls.includes(repoFull)) repoFulls.unshift(repoFull);
  if (!repoFulls.length && repoFull) repoFulls = [repoFull];
  return { token, branch, repoFull, repoFulls };
}

function getGithubLegacyModelPaths(pathOrName) {
  const modelPath = normalizeComponentPath(pathOrName);
  if (!modelPath) return {
    modelPath: '',
    dataPath: '',
    metaPath: '',
    thumbnailPath: '',
  };
  const rootPrefix = `${getGithubStorageRoot()}/__BREP_DATA__/`;
  const dataPrefix = '__BREP_DATA__/';
  if (modelPath.startsWith(rootPrefix) || modelPath.startsWith(dataPrefix)) {
    return {
      modelPath,
      dataPath: '',
      metaPath: '',
      thumbnailPath: '',
    };
  }
  const dataDir = LEGACY_GITHUB_DATA_DIR;
  const rel = encodeGithubRelativeModelPath(modelPath);
  const basePath = rel ? `${dataDir}/${rel}` : dataDir;
  return {
    modelPath,
    dataPath: `${basePath}${MODEL_FILE_EXT}`,
    metaPath: `${basePath}${MODEL_META_EXT}`,
    thumbnailPath: `${basePath}${MODEL_THUMB_EXT}`,
  };
}

function resolveGithubModelInfoFromDataPath(path) {
  const clean = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean.toLowerCase().endsWith(MODEL_FILE_EXT)) return null;
  const base = clean.slice(0, -MODEL_FILE_EXT.length);
  if (base.startsWith(`${LEGACY_GITHUB_DATA_DIR}/`)) {
    const relBase = base.slice(LEGACY_GITHUB_DATA_DIR.length + 1);
    const modelPath = decodeGithubRelativeModelPath(relBase);
    if (!modelPath) return null;
    return {
      modelPath,
      browserPath: stripKnownModelExtension(clean),
      dataPath: clean,
      metaPath: `${base}${MODEL_META_EXT}`,
      thumbnailPath: `${base}${MODEL_THUMB_EXT}`,
      legacy: true,
    };
  }
  const modelPath = stripKnownModelExtension(base);
  if (!modelPath) return null;
  return {
    modelPath,
    browserPath: stripKnownModelExtension(clean),
    dataPath: clean,
    metaPath: `${base}${MODEL_META_EXT}`,
    thumbnailPath: `${base}${MODEL_THUMB_EXT}`,
    legacy: false,
  };
}

function getGithubFolderMarkerPath(folderPath) {
  const clean = resolveFolderPath(folderPath);
  if (!clean) return '';
  return `${clean}/${FOLDER_MARKER_FILE}`;
}

function getGithubRepoTreeCacheKey(scope, repoFull) {
  const token = String(scope?.token || '').trim();
  const repo = String(repoFull || '').trim();
  const branch = String(scope?.branch || '').trim();
  if (!token || !repo) return '';
  return `${token}@@${branch}@@${repo}`;
}

function getGithubRepoTreeVersion(cacheKey) {
  return Number(githubRepoTreeVersion.get(cacheKey) || 0);
}

function normalizeGithubTreeResult(tree) {
  const files = [];
  const dirs = [];
  const fileSeen = new Set();
  const dirSeen = new Set();

  for (const file of Array.isArray(tree?.files) ? tree.files : []) {
    const filePath = normalizeComponentPath(file?.path || '');
    if (!filePath || fileSeen.has(filePath)) continue;
    fileSeen.add(filePath);
    files.push({
      ...file,
      type: 'file',
      path: filePath,
    });
  }

  for (const dir of Array.isArray(tree?.dirs) ? tree.dirs : []) {
    const dirPath = resolveFolderPath(dir?.path || '');
    if (!dirPath || dirSeen.has(dirPath)) continue;
    dirSeen.add(dirPath);
    dirs.push({
      ...dir,
      path: dirPath,
      type: 'dir',
    });
  }

  return { files, dirs };
}

function getCachedGithubRepoTree(cacheKey) {
  const cached = githubRepoTreeCache.get(cacheKey);
  if (!cached) return null;
  if ((Date.now() - Number(cached?.savedAt || 0)) > GITHUB_TREE_CACHE_TTL_MS) {
    githubRepoTreeCache.delete(cacheKey);
    return null;
  }
  return cached.tree || null;
}

function setCachedGithubRepoTree(cacheKey, version, tree) {
  if (getGithubRepoTreeVersion(cacheKey) !== version) return;
  githubRepoTreeCache.set(cacheKey, {
    savedAt: Date.now(),
    tree,
  });
}

function invalidateGithubRepoTree(scope, repoFull) {
  const cacheKey = getGithubRepoTreeCacheKey(scope, repoFull);
  if (!cacheKey) return;
  const nextVersion = getGithubRepoTreeVersion(cacheKey) + 1;
  githubRepoTreeVersion.set(cacheKey, nextVersion);
  githubRepoTreeCache.delete(cacheKey);
  githubRepoTreeInflight.delete(cacheKey);
}

async function listGithubTreeRecursive(scope, repoFull, startDir = '') {
  const files = [];
  const dirs = [];
  const queue = [String(startDir || '')];
  const seen = new Set();

  while (queue.length) {
    const dirRaw = queue.shift();
    const dir = typeof dirRaw === 'string' ? dirRaw : '';
    if (seen.has(dir)) continue;
    seen.add(dir);
    const items = await listGithubDir({
      token: scope.token,
      repoFull,
      branch: scope.branch,
      path: dir,
    });
    for (const it of items) {
      if (!it || !it.type) continue;
      if (it.type === 'dir' && it.path) {
        const dirPath = normalizeComponentPath(it.path);
        if (dirPath) dirs.push({ path: dirPath });
        queue.push(String(it.path).replace(/^\/+/, '').replace(/\/+$/, ''));
        continue;
      }
      if (it.type === 'file') {
        files.push({
          ...it,
          path: String(it.path || '').replace(/^\/+/, '').replace(/\/+$/, ''),
        });
      }
    }
  }

  return { files, dirs };
}

async function getGithubRepoTreeSnapshot(scope, repoFull) {
  const cacheKey = getGithubRepoTreeCacheKey(scope, repoFull);
  if (!cacheKey) return { files: [], dirs: [] };

  const cached = getCachedGithubRepoTree(cacheKey);
  if (cached) return cached;

  const pending = githubRepoTreeInflight.get(cacheKey);
  if (pending) return await pending;

  const version = getGithubRepoTreeVersion(cacheKey);
  const loadPromise = (async () => {
    try {
      const tree = await listGithubRepoTree({
        token: scope.token,
        repoFull,
        branch: scope.branch,
      });
      const normalizedTree = normalizeGithubTreeResult(tree);
      if (!tree?.truncated) {
        setCachedGithubRepoTree(cacheKey, version, normalizedTree);
        return normalizedTree;
      }
    } catch {
      // Fall through to recursive /contents traversal.
    }

    const fallbackTree = normalizeGithubTreeResult(await listGithubTreeRecursive(scope, repoFull, ''));
    setCachedGithubRepoTree(cacheKey, version, fallbackTree);
    return fallbackTree;
  })();

  githubRepoTreeInflight.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (githubRepoTreeInflight.get(cacheKey) === loadPromise) {
      githubRepoTreeInflight.delete(cacheKey);
    }
  }
}

async function listGithubComponentRecords(options = {}) {
  const scope = resolveGithubScope(options);
  const repos = scope.repoFulls;
  if (!scope.token || !repos.length) return [];
  const out = [];

  for (const repoFull of repos) {
    const tree = await getGithubRepoTreeSnapshot(scope, repoFull);
    const items = tree.files;
    const metas = new Map();
    for (const it of items) {
      if (it.type !== 'file' || !it.path) continue;
      const metaPath = String(it.path).replace(/^\/+/, '').replace(/\/+$/, '');
      if (metaPath.toLowerCase().endsWith(MODEL_META_EXT)) {
        metas.set(metaPath, it);
      }
    }

    const byModelPath = new Map();
    for (const it of items) {
      if (it.type !== 'file' || !it.path) continue;
      const info = resolveGithubModelInfoFromDataPath(it.path);
      if (!info || !info.modelPath) continue;
      const existing = byModelPath.get(info.modelPath);
      if (!existing || (existing.legacy && !info.legacy)) {
        byModelPath.set(info.modelPath, info);
      }
    }

    for (const info of byModelPath.values()) {
      const modelPath = info.modelPath;
      const modelParts = splitComponentPath(modelPath);
      const browserPath = normalizeComponentPath(info.browserPath || stripKnownModelExtension(info.dataPath) || modelPath) || modelPath;
      const browserParts = splitComponentPath(browserPath);
      let savedAt = null;
      let thumbnail = null;
      let thumbnailPath = info.thumbnailPath || null;
      const meta = metas.get(info.metaPath);
      if (meta) {
        try {
          const metaB64 = await readGithubFileBase64({
            token: scope.token,
            repoFull,
            branch: scope.branch,
            path: info.metaPath,
          });
          if (metaB64) {
            const metaJson = JSON.parse(atob(metaB64));
            savedAt = metaJson?.savedAt || null;
            thumbnail = normalizeStoredThumbnail(metaJson?.thumbnail) || null;
            if (metaJson?.thumbnailPath) {
              thumbnailPath = normalizeComponentPath(metaJson.thumbnailPath) || thumbnailPath;
            }
          }
        } catch { /* ignore meta failures */ }
      }
      out.push({
        source: 'github',
        name: modelPath,
        path: modelPath,
        browserPath,
        folder: browserParts.folder || modelParts.folder,
        displayName: modelParts.displayName || modelPath,
        repoFull,
        branch: scope.branch || null,
        savedAt,
        has3mf: true,
        record: { savedAt, data3mf: null, data: null, thumbnail, thumbnailPath },
      });
    }
  }

  out.sort((a, b) => {
    const aTime = a.savedAt ? Date.parse(a.savedAt) : 0;
    const bTime = b.savedAt ? Date.parse(b.savedAt) : 0;
    return bTime - aTime;
  });

  return out;
}

async function getGithubComponentRecord(name, options = {}) {
  const scope = resolveGithubScope(options);
  const repoFull = String(options?.repoFull || scope.repoFull || '').trim();
  if (!scope.token || !repoFull) return null;
  const primary = getGithubPrimaryModelPaths(options?.path || name);
  const { modelPath } = primary;
  if (!modelPath) return null;
  const legacy = getGithubLegacyModelPaths(modelPath);
  let data3mf = null;
  let savedAt = null;
  let thumbnail = null;
  let activePaths = primary;
  const cacheKey = `${repoFull}@@${String(scope.branch || '').trim()}@@${modelPath}`;
  const cachedMode = String(githubModelPathModeCache.get(cacheKey) || '').trim();
  const preferLegacy = cachedMode === 'legacy';
  const candidates = preferLegacy ? [legacy, primary] : [primary, legacy];
  for (const candidate of candidates) {
    try {
      data3mf = await readGithubFileBase64({
        token: scope.token,
        repoFull,
        branch: scope.branch,
        path: candidate.dataPath,
      });
      if (data3mf) {
        activePaths = candidate;
        githubModelPathModeCache.set(cacheKey, candidate === legacy ? 'legacy' : 'primary');
        break;
      }
    } catch (err) {
      if (err && err.status === 404) continue;
      if (options?.throwOnError) throw err;
      return null;
    }
  }
  if (!data3mf) return null;
  try {
    const metaB64 = await readGithubFileBase64({
      token: scope.token,
      repoFull,
      branch: scope.branch,
      path: activePaths.metaPath,
    });
    if (metaB64) {
      const metaJson = JSON.parse(atob(metaB64));
      savedAt = metaJson?.savedAt || null;
      thumbnail = normalizeStoredThumbnail(metaJson?.thumbnail) || null;
    }
  } catch { /* ignore */ }
  if (!thumbnail) {
    const thumbPaths = Array.from(new Set([
      activePaths?.thumbnailPath,
      primary?.thumbnailPath,
      legacy?.thumbnailPath,
    ].map((path) => String(path || '').trim()).filter(Boolean)));
    for (const thumbPath of thumbPaths) {
      try {
        const thumbB64 = await readGithubFileBase64({
          token: scope.token,
          repoFull,
          branch: scope.branch,
          path: thumbPath,
        });
        if (!thumbB64) continue;
        thumbnail = makeBase64DataUrl('image/png', thumbB64) || null;
        if (thumbnail) break;
      } catch {
        // Ignore thumbnail sidecar failures.
      }
    }
  }
  const browserPath = normalizeComponentPath(stripKnownModelExtension(activePaths?.dataPath || `${modelPath}${MODEL_FILE_EXT}`)) || modelPath;
  const modelParts = splitComponentPath(modelPath);
  const browserParts = splitComponentPath(browserPath);
  return {
    source: 'github',
    name: modelPath,
    path: modelPath,
    browserPath,
    folder: browserParts.folder || modelParts.folder,
    displayName: modelParts.displayName || modelPath,
    repoFull,
    branch: scope.branch || null,
    savedAt,
    data3mf,
    data: null,
    thumbnail,
  };
}

async function setGithubComponentRecord(name, dataObj, options = {}) {
  const scope = resolveGithubScope(options);
  const repoFull = String(options?.repoFull || scope.repoFull || '').trim();
  if (!scope.token || !repoFull) return;
  const { modelPath, dataPath, metaPath, thumbnailPath } = getGithubPrimaryModelPaths(options?.path || name);
  if (!modelPath) return;
  const legacy = getGithubLegacyModelPaths(modelPath);
  const data3mf = normalizeBase64Payload(dataObj?.data3mf || '');
  if (!data3mf) return;
  const hasThumbnailInput = Object.prototype.hasOwnProperty.call(dataObj || {}, 'thumbnail');
  const thumbnailPngB64 = hasThumbnailInput
    ? await normalizeThumbnailToPngBase64(dataObj?.thumbnail || '')
    : '';
  const thumbnailDataUrl = thumbnailPngB64 ? makeBase64DataUrl('image/png', thumbnailPngB64) : null;
  await writeGithubFileBase64({
    token: scope.token,
    repoFull,
    branch: scope.branch,
    path: dataPath,
    base64: data3mf,
    message: `BREP model update: ${modelPath}`,
    retryOn409: 3,
  });
  githubModelPathModeCache.set(
    `${repoFull}@@${String(scope.branch || '').trim()}@@${modelPath}`,
    'primary',
  );
  if (hasThumbnailInput) {
    if (thumbnailPngB64 && thumbnailPath) {
      await writeGithubFileBase64({
        token: scope.token,
        repoFull,
        branch: scope.branch,
        path: thumbnailPath,
        base64: thumbnailPngB64,
        message: `BREP model thumbnail: ${modelPath}`,
        retryOn409: 3,
      });
    } else if (thumbnailPath) {
      try {
        await deleteGithubFile({
          token: scope.token,
          repoFull,
          branch: scope.branch,
          path: thumbnailPath,
          message: `BREP model thumbnail cleanup: ${modelPath}`,
        });
      } catch { /* ignore thumbnail cleanup failures */ }
    }
  }
  const meta = {
    savedAt: dataObj?.savedAt || new Date().toISOString(),
    thumbnail: hasThumbnailInput
      ? (thumbnailDataUrl || normalizeStoredThumbnail(dataObj?.thumbnail) || null)
      : null,
    thumbnailPath: hasThumbnailInput
      ? (thumbnailPngB64 && thumbnailPath ? thumbnailPath : null)
      : (thumbnailPath || null),
  };
  const metaB64 = btoa(JSON.stringify(meta));
  await writeGithubFileBase64({
    token: scope.token,
    repoFull,
    branch: scope.branch,
    path: metaPath,
    base64: metaB64,
    message: `BREP model meta: ${modelPath}`,
    retryOn409: 3,
  });

  if (legacy.dataPath && legacy.dataPath !== dataPath) {
    try {
      await deleteGithubFile({
        token: scope.token,
        repoFull,
        branch: scope.branch,
        path: legacy.dataPath,
        message: `BREP legacy model cleanup: ${modelPath}`,
      });
      await deleteGithubFile({
        token: scope.token,
        repoFull,
        branch: scope.branch,
        path: legacy.metaPath,
        message: `BREP legacy meta cleanup: ${modelPath}`,
      });
      await deleteGithubFile({
        token: scope.token,
        repoFull,
        branch: scope.branch,
        path: legacy.thumbnailPath,
        message: `BREP legacy thumbnail cleanup: ${modelPath}`,
      });
    } catch { /* ignore cleanup failures */ }
  }
  invalidateGithubRepoTree(scope, repoFull);
}

async function removeGithubComponentRecord(name, options = {}) {
  const scope = resolveGithubScope(options);
  const repoFull = String(options?.repoFull || scope.repoFull || '').trim();
  if (!scope.token || !repoFull) return;
  const primary = getGithubPrimaryModelPaths(options?.path || name);
  const { modelPath, dataPath, metaPath, thumbnailPath } = primary;
  if (!modelPath) return;
  const legacy = getGithubLegacyModelPaths(modelPath);
  const paths = new Set([dataPath, metaPath, thumbnailPath, legacy.dataPath, legacy.metaPath, legacy.thumbnailPath].filter(Boolean));
  for (const path of paths) {
    const lowerPath = path.toLowerCase();
    const isMeta = lowerPath.endsWith(MODEL_META_EXT);
    const isThumb = lowerPath.endsWith(MODEL_THUMB_EXT);
    await deleteGithubFile({
      token: scope.token,
      repoFull,
      branch: scope.branch,
      path,
      message: isMeta
        ? `BREP model meta delete: ${modelPath}`
        : (isThumb ? `BREP model thumbnail delete: ${modelPath}` : `BREP model delete: ${modelPath}`),
    });
  }
  invalidateGithubRepoTree(scope, repoFull);
}

async function listGithubWorkspaceFolders(options = {}) {
  const scope = resolveGithubScope(options);
  const repos = scope.repoFulls;
  if (!scope.token || !repos.length) return [];
  const out = [];

  for (const repoFull of repos) {
    const tree = await getGithubRepoTreeSnapshot(scope, repoFull);
    const map = new Map();

    for (const dir of tree.dirs) {
      const folderPath = resolveFolderPath(dir?.path || '');
      if (!folderPath) continue;
      map.set(folderPath, {
        source: 'github',
        repoFull,
        path: folderPath,
        savedAt: null,
      });
    }

    for (const it of tree.files) {
      if (!it || it.type !== 'file' || !it.path) continue;
      const filePath = String(it.path).replace(/^\/+/, '').replace(/\/+$/, '');
      if (!filePath.endsWith(`/${FOLDER_MARKER_FILE}`)) continue;
      const folderPath = resolveFolderPath(filePath.slice(0, -(`/${FOLDER_MARKER_FILE}`).length));
      if (!folderPath) continue;
      let savedAt = null;
      try {
        const markerB64 = await readGithubFileBase64({
          token: scope.token,
          repoFull,
          branch: scope.branch,
          path: filePath,
        });
        if (markerB64) {
          const marker = JSON.parse(atob(markerB64));
          savedAt = marker?.savedAt || marker?.createdAt || null;
        }
      } catch { /* ignore marker read failures */ }
      map.set(folderPath, {
        source: 'github',
        repoFull,
        path: folderPath,
        savedAt,
      });
    }
    out.push(...Array.from(map.values()));
  }

  return out;
}

async function createGithubWorkspaceFolder(path, options = {}) {
  const scope = resolveGithubScope(options);
  const repoFull = String(options?.repoFull || scope.repoFull || '').trim();
  if (!scope.token || !repoFull) return;
  const folderPath = resolveFolderPath(path);
  if (!folderPath) return;
  const markerPath = getGithubFolderMarkerPath(folderPath);
  if (!markerPath) return;
  const markerB64 = btoa(JSON.stringify({
    type: 'brep-folder',
    version: 1,
    savedAt: new Date().toISOString(),
  }));
  await writeGithubFileBase64({
    token: scope.token,
    repoFull,
    branch: scope.branch,
    path: markerPath,
    base64: markerB64,
    message: `BREP folder create: ${folderPath}`,
    retryOn409: 3,
  });
  invalidateGithubRepoTree(scope, repoFull);
}

async function removeGithubWorkspaceFolder(path, options = {}) {
  const scope = resolveGithubScope(options);
  const repoFull = String(options?.repoFull || scope.repoFull || '').trim();
  if (!scope.token || !repoFull) return;
  const folderPath = resolveFolderPath(path);
  if (!folderPath) return;
  const markerPath = getGithubFolderMarkerPath(folderPath);
  if (!markerPath) return;
  await deleteGithubFile({
    token: scope.token,
    repoFull,
    branch: scope.branch,
    path: markerPath,
    message: `BREP folder delete: ${folderPath}`,
  });
  invalidateGithubRepoTree(scope, repoFull);
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function decodeModelKey(key) {
  try {
    return decodeURIComponent(key.slice(MODEL_STORAGE_PREFIX.length));
  } catch {
    return key.slice(MODEL_STORAGE_PREFIX.length);
  }
}

function decodeFolderKey(key) {
  try {
    return decodeURIComponent(key.slice(FOLDER_STORAGE_PREFIX.length));
  } catch {
    return key.slice(FOLDER_STORAGE_PREFIX.length);
  }
}

function resolveStorageSource(options = {}) {
  const requested = String(options?.source || '').trim().toLowerCase();
  if (requested === 'local' || requested === 'github') return requested;
  const hasExplicitGithubScope = !!(
    String(options?.repoFull || '').trim()
    || (Array.isArray(options?.repoFulls) && options.repoFulls.length)
    || String(options?.token || '').trim()
  );
  if (hasExplicitGithubScope) return 'github';
  return LS?.isGithub?.() ? 'github' : 'local';
}

async function getLocalStore() {
  const local = getLocalStorageBackend?.();
  if (local) {
    try { await local.ready?.(); } catch { /* ignore */ }
    return local;
  }
  return LS;
}

async function listLocalComponentRecords() {
  const store = await getLocalStore();
  const items = [];
  try {
    for (let i = 0; i < (store?.length || 0); i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(MODEL_STORAGE_PREFIX)) continue;
      const raw = store.getItem(key);
      if (!raw) continue;
      const parsed = safeParse(raw);
      if (!parsed || (!parsed.data3mf && !parsed.data)) continue;
      const modelPath = decodeModelKey(key);
      const pathParts = splitComponentPath(modelPath);
      const thumbnail = normalizeStoredThumbnail(parsed.thumbnail);
      items.push({
        source: 'local',
        name: modelPath,
        path: modelPath,
        browserPath: modelPath,
        folder: pathParts.folder,
        displayName: pathParts.displayName || modelPath,
        savedAt: parsed.savedAt || null,
        has3mf: typeof parsed.data3mf === 'string' && parsed.data3mf.length > 0,
        record: {
          ...(parsed || {}),
          thumbnail: thumbnail || null,
        },
      });
    }
  } catch {
    // ignore storage issues
  }

  items.sort((a, b) => {
    const aTime = a.savedAt ? Date.parse(a.savedAt) : 0;
    const bTime = b.savedAt ? Date.parse(b.savedAt) : 0;
    return bTime - aTime;
  });

  return items;
}

async function getLocalComponentRecord(name, options = {}) {
  const modelPath = resolveComponentPath(name, options);
  if (!modelPath) return null;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(modelPath);
  try {
    const store = await getLocalStore();
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = safeParse(raw);
    if (!parsed) return null;
    const pathParts = splitComponentPath(modelPath);
    const thumbnail = normalizeStoredThumbnail(parsed.thumbnail);
    return {
      source: 'local',
      name: modelPath,
      path: modelPath,
      browserPath: modelPath,
      folder: pathParts.folder,
      displayName: pathParts.displayName || modelPath,
      savedAt: parsed.savedAt || null,
      data3mf: typeof parsed.data3mf === 'string' ? parsed.data3mf : null,
      data: parsed.data || null,
      thumbnail: thumbnail || null,
    };
  } catch {
    return null;
  }
}

async function setLocalComponentRecord(name, dataObj, options = {}) {
  const modelPath = resolveComponentPath(name, options);
  if (!modelPath) return;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(modelPath);
  try {
    const store = await getLocalStore();
    const payload = { ...(dataObj || {}) };
    const thumbnailPngB64 = await normalizeThumbnailToPngBase64(payload.thumbnail || '');
    if (thumbnailPngB64) {
      payload.thumbnail = makeBase64DataUrl('image/png', thumbnailPngB64);
    } else if (payload.thumbnail !== undefined) {
      payload.thumbnail = normalizeStoredThumbnail(payload.thumbnail) || null;
    }
    store.setItem(key, JSON.stringify(payload));
  } catch {}
}

async function removeLocalComponentRecord(name, options = {}) {
  const modelPath = resolveComponentPath(name, options);
  if (!modelPath) return;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(modelPath);
  try {
    const store = await getLocalStore();
    store.removeItem(key);
  } catch {}
}

async function listLocalWorkspaceFolders() {
  const store = await getLocalStore();
  const items = [];
  try {
    for (let i = 0; i < (store?.length || 0); i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(FOLDER_STORAGE_PREFIX)) continue;
      const folderPath = resolveFolderPath(decodeFolderKey(key));
      if (!folderPath) continue;
      let savedAt = null;
      try {
        const raw = store.getItem(key);
        const parsed = raw ? safeParse(raw) : null;
        savedAt = parsed?.savedAt || parsed?.createdAt || null;
      } catch { /* ignore */ }
      items.push({
        source: 'local',
        repoFull: '',
        path: folderPath,
        savedAt,
      });
    }
  } catch { /* ignore */ }
  return items;
}

async function createLocalWorkspaceFolder(path) {
  const folderPath = resolveFolderPath(path);
  if (!folderPath) return;
  const key = FOLDER_STORAGE_PREFIX + encodeURIComponent(folderPath);
  const payload = JSON.stringify({
    type: 'brep-folder',
    version: 1,
    savedAt: new Date().toISOString(),
  });
  try {
    const store = await getLocalStore();
    store.setItem(key, payload);
  } catch { /* ignore */ }
}

async function removeLocalWorkspaceFolder(path) {
  const folderPath = resolveFolderPath(path);
  if (!folderPath) return;
  const key = FOLDER_STORAGE_PREFIX + encodeURIComponent(folderPath);
  try {
    const store = await getLocalStore();
    store.removeItem(key);
  } catch { /* ignore */ }
}

export async function listComponentRecords(options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await listGithubComponentRecords(options);
  }
  return await listLocalComponentRecords();
}

export async function listWorkspaceFolders(options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await listGithubWorkspaceFolders(options);
  }
  return await listLocalWorkspaceFolders();
}

export async function createWorkspaceFolder(path, options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await createGithubWorkspaceFolder(path, options);
  }
  await createLocalWorkspaceFolder(path, options);
}

export async function removeWorkspaceFolder(path, options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await removeGithubWorkspaceFolder(path, options);
  }
  await removeLocalWorkspaceFolder(path, options);
}

export async function getComponentRecord(name, options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await getGithubComponentRecord(name, options);
  }
  return await getLocalComponentRecord(name, options);
}

export function base64ToUint8Array(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) return new Uint8Array();
  let payload = b64;
  if (payload.startsWith('data:') && payload.includes(';base64,')) {
    payload = payload.split(';base64,')[1] || '';
  }
  try {
    const binary = atob(payload);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

export function uint8ArrayToBase64(uint8) {
  if (!(uint8 instanceof Uint8Array) || uint8.length === 0) return '';
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunk) {
    const sub = uint8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

export async function setComponentRecord(name, dataObj, options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await setGithubComponentRecord(name, dataObj, options);
  }
  await setLocalComponentRecord(name, dataObj, options);
}

export async function removeComponentRecord(name, options = {}) {
  const source = resolveStorageSource(options);
  if (source === 'github') {
    return await removeGithubComponentRecord(name, options);
  }
  await removeLocalComponentRecord(name, options);
}

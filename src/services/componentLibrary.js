import JSZip from 'jszip';
import {
  localStorage as LS,
  getGithubStorageConfig,
} from '../idbStorage.js';
import {
  listGithubDir,
  readGithubFileBase64,
  writeGithubFileBase64,
  deleteGithubFile,
  getGithubStorageRoot,
  encodeRepoItemName,
  decodeRepoItemName,
} from '../githubStorage.js';

export const MODEL_STORAGE_PREFIX = '__BREP_DATA__:';
const MODEL_FILE_EXT = '.3mf';
const MODEL_META_EXT = '.meta.json';

function normalizeBase64Payload(payload) {
  let b64 = String(payload || '');
  if (b64.startsWith('data:') && b64.includes(';base64,')) {
    b64 = b64.split(';base64,')[1] || '';
  }
  return b64.replace(/\s+/g, '');
}

function getGithubModelPaths(name) {
  const root = getGithubStorageRoot();
  const encName = encodeRepoItemName(name);
  const dataDir = `${root}/__BREP_DATA__`;
  return {
    dataPath: `${dataDir}/${encName}${MODEL_FILE_EXT}`,
    metaPath: `${dataDir}/${encName}${MODEL_META_EXT}`,
  };
}

async function listGithubComponentRecords() {
  const cfg = getGithubStorageConfig();
  if (!cfg?.token || !cfg?.repoFull) return [];
  const dataDir = `${getGithubStorageRoot()}/__BREP_DATA__`;
  const items = await listGithubDir({
    token: cfg.token,
    repoFull: cfg.repoFull,
    branch: cfg.branch,
    path: dataDir,
  });
  const out = [];
  const metas = new Map();

  for (const it of items) {
    if (it.type !== 'file' || !it.name) continue;
    if (String(it.name).endsWith(MODEL_META_EXT)) {
      const base = String(it.name).slice(0, -MODEL_META_EXT.length);
      metas.set(base, it);
    }
  }

  for (const it of items) {
    if (it.type !== 'file' || !it.name) continue;
    if (!String(it.name).endsWith(MODEL_FILE_EXT)) continue;
    const base = String(it.name).slice(0, -MODEL_FILE_EXT.length);
    const name = decodeRepoItemName(base);
    let savedAt = null;
    let thumbnail = null;
    const meta = metas.get(base);
    if (meta) {
      try {
        const metaB64 = await readGithubFileBase64({
          token: cfg.token,
          repoFull: cfg.repoFull,
          branch: cfg.branch,
          path: meta.path,
        });
        if (metaB64) {
          const metaJson = JSON.parse(atob(metaB64));
          savedAt = metaJson?.savedAt || null;
          thumbnail = metaJson?.thumbnail || null;
        }
      } catch { /* ignore meta failures */ }
    }
    out.push({
      name,
      savedAt,
      has3mf: true,
      record: { savedAt, data3mf: null, data: null, thumbnail },
    });
  }

  out.sort((a, b) => {
    const aTime = a.savedAt ? Date.parse(a.savedAt) : 0;
    const bTime = b.savedAt ? Date.parse(b.savedAt) : 0;
    return bTime - aTime;
  });

  return out;
}

async function getGithubComponentRecord(name, options = {}) {
  const cfg = getGithubStorageConfig();
  if (!cfg?.token || !cfg?.repoFull) return null;
  const { dataPath, metaPath } = getGithubModelPaths(name);
  let data3mf = null;
  let savedAt = null;
  let thumbnail = null;
  try {
    data3mf = await readGithubFileBase64({
      token: cfg.token,
      repoFull: cfg.repoFull,
      branch: cfg.branch,
      path: dataPath,
    });
  } catch (err) {
    if (err && err.status === 404) return null;
    if (options?.throwOnError) throw err;
    return null;
  }
  if (!data3mf) return null;
  try {
    const metaB64 = await readGithubFileBase64({
      token: cfg.token,
      repoFull: cfg.repoFull,
      branch: cfg.branch,
      path: metaPath,
    });
    if (metaB64) {
      const metaJson = JSON.parse(atob(metaB64));
      savedAt = metaJson?.savedAt || null;
      thumbnail = metaJson?.thumbnail || null;
    }
  } catch { /* ignore */ }
  return {
    name,
    savedAt,
    data3mf,
    data: null,
    thumbnail,
  };
}

async function setGithubComponentRecord(name, dataObj) {
  const cfg = getGithubStorageConfig();
  if (!cfg?.token || !cfg?.repoFull) return;
  const { dataPath, metaPath } = getGithubModelPaths(name);
  const data3mf = normalizeBase64Payload(dataObj?.data3mf || '');
  if (!data3mf) return;
  await writeGithubFileBase64({
    token: cfg.token,
    repoFull: cfg.repoFull,
    branch: cfg.branch,
    path: dataPath,
    base64: data3mf,
    message: `BREP model update: ${name}`,
    retryOn409: 3,
  });
  const meta = {
    savedAt: dataObj?.savedAt || new Date().toISOString(),
    thumbnail: dataObj?.thumbnail || null,
  };
  const metaB64 = btoa(JSON.stringify(meta));
  await writeGithubFileBase64({
    token: cfg.token,
    repoFull: cfg.repoFull,
    branch: cfg.branch,
    path: metaPath,
    base64: metaB64,
    message: `BREP model meta: ${name}`,
    retryOn409: 3,
  });
}

async function removeGithubComponentRecord(name) {
  const cfg = getGithubStorageConfig();
  if (!cfg?.token || !cfg?.repoFull) return;
  const { dataPath, metaPath } = getGithubModelPaths(name);
  await deleteGithubFile({
    token: cfg.token,
    repoFull: cfg.repoFull,
    branch: cfg.branch,
    path: dataPath,
    message: `BREP model delete: ${name}`,
  });
  await deleteGithubFile({
    token: cfg.token,
    repoFull: cfg.repoFull,
    branch: cfg.branch,
    path: metaPath,
    message: `BREP model meta delete: ${name}`,
  });
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

export async function listComponentRecords() {
  if (LS?.isGithub?.()) {
    return await listGithubComponentRecords();
  }
  const items = [];
  try {
    for (let i = 0; i < LS.length; i++) {
      const key = LS.key(i);
      if (!key || !key.startsWith(MODEL_STORAGE_PREFIX)) continue;
      const raw = LS.getItem(key);
      if (!raw) continue;
      const parsed = safeParse(raw);
      if (!parsed || (!parsed.data3mf && !parsed.data)) continue;
      const name = decodeModelKey(key);
      items.push({
        name,
        savedAt: parsed.savedAt || null,
        has3mf: typeof parsed.data3mf === 'string' && parsed.data3mf.length > 0,
        record: parsed,
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

export async function getComponentRecord(name, options = {}) {
  if (LS?.isGithub?.()) {
    return await getGithubComponentRecord(name, options);
  }
  if (!name) return null;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(String(name));
  try {
    const raw = LS.getItem(key);
    if (!raw) return null;
    const parsed = safeParse(raw);
    if (!parsed) return null;
    return {
      name,
      savedAt: parsed.savedAt || null,
      data3mf: typeof parsed.data3mf === 'string' ? parsed.data3mf : null,
      data: parsed.data || null,
      thumbnail: typeof parsed.thumbnail === 'string' ? parsed.thumbnail : null,
    };
  } catch {
    return null;
  }
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

export async function setComponentRecord(name, dataObj) {
  if (LS?.isGithub?.()) {
    return await setGithubComponentRecord(name, dataObj);
  }
  if (!name) return;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(String(name));
  try {
    LS.setItem(key, JSON.stringify(dataObj || {}));
  } catch {}
}

export async function removeComponentRecord(name) {
  if (LS?.isGithub?.()) {
    return await removeGithubComponentRecord(name);
  }
  if (!name) return;
  const key = MODEL_STORAGE_PREFIX + encodeURIComponent(String(name));
  try {
    LS.removeItem(key);
  } catch {}
}

export async function extractThumbnailFrom3MFBase64(b64) {
  try {
    if (!b64) return null;
    let payload = b64;
    if (payload.startsWith('data:') && payload.includes(';base64,')) {
      payload = payload.split(';base64,')[1] || '';
    }
    const bytes = base64ToUint8Array(payload);
    const zip = await JSZip.loadAsync(bytes.buffer);
    const files = {};
    Object.keys(zip.files || {}).forEach((p) => { files[p.toLowerCase()] = p; });

    const readThumb = async (lfPath) => {
      const real = files[lfPath];
      if (!real) return null;
      const mime = lfPath.endsWith('.png') ? 'image/png' : (lfPath.match(/\.(jpe?g)$/) ? 'image/jpeg' : 'application/octet-stream');
      const imgU8 = await zip.file(real).async('uint8array');
      return `data:${mime};base64,${uint8ArrayToBase64(imgU8)}`;
    };

    const relsRoot = files['_rels/.rels'];
    if (relsRoot) {
      try {
        const relsXml = await zip.file(relsRoot).async('string');
        const relRe = /<Relationship\s+[^>]*Type="[^"]*metadata\/thumbnail[^"]*"[^>]*>/ig;
        const tgtRe = /Target="([^"]+)"/i;
        let match;
        while ((match = relRe.exec(relsXml))) {
          const tag = match[0];
          const tm = tgtRe.exec(tag);
          if (tm && tm[1]) {
            let target = tm[1];
            if (target.startsWith('/')) target = target.replace(/^\/+/, '');
            else target = target.replace(/^\/+/, '');
            const lf = target.toLowerCase();
            const thumb = await readThumb(lf);
            if (thumb) return thumb;
          }
        }
      } catch { /* ignore */ }
    }

    const relsModel = files['3d/_rels/3dmodel.model.rels'];
    if (relsModel) {
      try {
        const relsXml = await zip.file(relsModel).async('string');
        const relRe = /<Relationship\s+[^>]*Type="[^"]*metadata\/thumbnail[^"]*"[^>]*>/ig;
        const tgtRe = /Target="([^"]+)"/i;
        let match;
        while ((match = relRe.exec(relsXml))) {
          const tag = match[0];
          const tm = tgtRe.exec(tag);
          if (tm && tm[1]) {
            let target = tm[1];
            if (target.startsWith('/')) target = target.replace(/^\/+/, '');
            else {
              target = '3D/' + target;
              target = target.replace(/(^|\/)\.{2}\/(?!\.{2}|$)/g, '/');
              target = target.replace(/^\/+/, '');
            }
            const lf = target.toLowerCase();
            const thumb = await readThumb(lf);
            if (thumb) return thumb;
          }
        }
      } catch { /* ignore */ }
    }

    let thumbPath = Object.keys(files).find((k) => k.startsWith('metadata/') && (k.endsWith('.png') || k.endsWith('.jpg') || k.endsWith('.jpeg')));
    if (!thumbPath) {
      thumbPath = Object.keys(files).find((k) => k.startsWith('thumbnails/') && (k.endsWith('.png') || k.endsWith('.jpg') || k.endsWith('.jpeg')));
    }
    if (thumbPath) {
      const real = files[thumbPath];
      const mime = thumbPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const imgU8 = await zip.file(real).async('uint8array');
      return `data:${mime};base64,${uint8ArrayToBase64(imgU8)}`;
    }
    return null;
  } catch {
    return null;
  }
}

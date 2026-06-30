const MOUNT_DB_NAME = '__BREP_MOUNTED_STORAGE__';
const MOUNT_DB_VERSION = 1;
const MOUNT_STORE = 'mounts';

type MountPermissionMode = 'read' | 'readwrite';
type MountPermissionState = 'granted' | 'denied' | 'prompt';
type MountTransactionMode = 'readonly' | 'readwrite' | 'versionchange';

type MountedDirectoryHandle = {
  kind?: string;
  name?: string;
  queryPermission?: (options: { mode: MountPermissionMode }) => Promise<MountPermissionState>;
  requestPermission?: (options: { mode: MountPermissionMode }) => Promise<MountPermissionState>;
  isSameEntry?: (other: MountedDirectoryHandle) => Promise<boolean>;
  [key: string]: any;
};

type MountRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  handle: MountedDirectoryHandle | null;
};

type PublicMountRecord = Omit<MountRecord, 'handle'>;

type MountRecordInput = Partial<MountRecord> | null | undefined;

type MountOptions = {
  id?: string;
  name?: string;
  mode?: MountPermissionMode;
};

type TransactionControl<T> = {
  resolve: (value?: T) => void;
  reject: (error: unknown) => void;
};

type WindowWithDirectoryPicker = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: { id?: string; mode?: MountPermissionMode }) => Promise<MountedDirectoryHandle>;
};

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined' && !!indexedDB.open;
}

function makeNowIso() {
  return new Date().toISOString();
}

function normalizeMountId(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function makeMountId(seed = '') {
  const prefix = normalizeMountId(seed) || 'mount';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function normalizeMountName(value: unknown, fallback = '') {
  const name = String(value || '').trim();
  return name || String(fallback || '').trim() || 'Mounted Folder';
}

function isDirectoryHandle(handle: unknown): handle is MountedDirectoryHandle {
  return !!handle && typeof handle === 'object' && (handle as MountedDirectoryHandle).kind === 'directory';
}

function sanitizeMountRecord(record: MountRecordInput): MountRecord | null {
  const id = normalizeMountId(record?.id || '');
  if (!id) return null;
  return {
    id,
    name: normalizeMountName(record?.name, id),
    createdAt: String(record?.createdAt || makeNowIso()),
    updatedAt: String(record?.updatedAt || makeNowIso()),
    handle: record?.handle || null,
  };
}

async function openMountDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return null;
  return await new Promise((resolve, reject) => {
    let req = null;
    try {
      req = indexedDB.open(MOUNT_DB_NAME, MOUNT_DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MOUNT_STORE)) {
        db.createObjectStore(MOUNT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open mounted storage DB'));
  });
}

async function runTx<T>(
  mode: MountTransactionMode,
  run: (store: IDBObjectStore, control: TransactionControl<T>) => void | Promise<void>,
): Promise<T | null> {
  const db = await openMountDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MOUNT_STORE, mode);
      const store = tx.objectStore(MOUNT_STORE);
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      tx.oncomplete = () => finish(resolve, undefined);
      tx.onerror = () => finish(reject, tx.error || new Error('Mounted storage transaction failed'));
      tx.onabort = () => finish(reject, tx.error || new Error('Mounted storage transaction aborted'));
      try {
        const maybePromise = run(store, {
          resolve: (value) => finish(resolve, value),
          reject: (err) => finish(reject, err),
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((err) => finish(reject, err));
        }
      } catch (err) {
        finish(reject, err);
      }
    });
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

async function getAllMountRecordsRaw(): Promise<MountRecordInput[]> {
  const rows = await runTx('readonly', (store, ctl) => {
    const req = store.getAll();
    req.onsuccess = () => ctl.resolve(req.result || []);
    req.onerror = () => ctl.reject(req.error || new Error('Failed to list mounted folders'));
  });
  return Array.isArray(rows) ? rows : [];
}

async function getMountRecordRaw(id: unknown): Promise<MountRecordInput | null> {
  const key = normalizeMountId(id);
  if (!key) return null;
  return await runTx('readonly', (store, ctl) => {
    const req = store.get(key);
    req.onsuccess = () => ctl.resolve(req.result || null);
    req.onerror = () => ctl.reject(req.error || new Error('Failed to read mounted folder'));
  });
}

async function putMountRecord(record: MountRecordInput): Promise<MountRecord | null> {
  const sanitized = sanitizeMountRecord(record);
  if (!sanitized) return null;
  await runTx('readwrite', (store, ctl) => {
    const req = store.put(sanitized);
    req.onsuccess = () => ctl.resolve(sanitized);
    req.onerror = () => ctl.reject(req.error || new Error('Failed to save mounted folder'));
  });
  return sanitized;
}

async function deleteMountRecord(id: unknown) {
  const key = normalizeMountId(id);
  if (!key) return;
  await runTx('readwrite', (store, ctl) => {
    const req = store.delete(key);
    req.onsuccess = () => ctl.resolve();
    req.onerror = () => ctl.reject(req.error || new Error('Failed to remove mounted folder'));
  });
}

async function ensureHandlePermission(handle: unknown, mode: MountPermissionMode = 'read') {
  if (!isDirectoryHandle(handle)) return false;
  if (typeof handle.queryPermission !== 'function') return true;
  const opts: { mode: MountPermissionMode } = { mode: mode === 'readwrite' ? 'readwrite' : 'read' };
  try {
    const existing = await handle.queryPermission(opts);
    if (existing === 'granted') return true;
  } catch {
    // Ignore and try request path.
  }
  if (typeof handle.requestPermission !== 'function') return false;
  try {
    const granted = await handle.requestPermission(opts);
    return granted === 'granted';
  } catch {
    return false;
  }
}

export function isSystemAccessSupported() {
  return typeof window !== 'undefined' && typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';
}

export async function listMountedDirectories(): Promise<PublicMountRecord[]> {
  const rows = await getAllMountRecordsRaw();
  const out = rows
    .map((row) => sanitizeMountRecord(row))
    .filter(Boolean)
    .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }));
  out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

export async function getMountedDirectoryRecord(id: unknown) {
  const row = await getMountRecordRaw(id);
  return sanitizeMountRecord(row);
}

export async function getMountedDirectoryHandle(id: unknown, options: MountOptions = {}) {
  const record = await getMountedDirectoryRecord(id);
  if (!record || !isDirectoryHandle(record.handle)) return null;
  const mode = String(options?.mode || 'read').trim().toLowerCase() === 'readwrite'
    ? 'readwrite'
    : 'read';
  const hasPermission = await ensureHandlePermission(record.handle, mode);
  if (!hasPermission) return null;
  return record;
}

export async function mountDirectoryHandle(handle: unknown, options: MountOptions = {}) {
  if (!isDirectoryHandle(handle)) {
    throw new Error('A directory handle is required.');
  }
  const name = normalizeMountName(options?.name, handle.name || 'Mounted Folder');
  const rows = await getAllMountRecordsRaw();
  for (const row of rows) {
    const existing = sanitizeMountRecord(row);
    if (!existing || !isDirectoryHandle(existing.handle)) continue;
    if (typeof existing.handle.isSameEntry !== 'function') continue;
    try {
      if (await existing.handle.isSameEntry(handle)) {
        const now = makeNowIso();
        const merged = {
          ...existing,
          name,
          updatedAt: now,
          handle,
        };
        await putMountRecord(merged);
        return { id: merged.id, name: merged.name, createdAt: merged.createdAt, updatedAt: merged.updatedAt };
      }
    } catch {
      // Ignore handle comparison failures.
    }
  }

  const now = makeNowIso();
  const providedId = normalizeMountId(options?.id || '');
  const nextId = providedId || makeMountId(handle.name || 'mount');
  const record = await putMountRecord({
    id: nextId,
    name,
    createdAt: now,
    updatedAt: now,
    handle,
  });
  if (!record) throw new Error('Failed to mount directory.');
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function promptAndMountDirectory(options: MountOptions = {}) {
  if (!isSystemAccessSupported()) {
    throw new Error('System Access API is not available in this browser.');
  }
  const pickerOptions: { id?: string; mode: MountPermissionMode } = {
    mode: 'readwrite',
  };
  if (options?.id) pickerOptions.id = String(options.id);
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error('System Access API is not available in this browser.');
  }
  const handle = await picker(pickerOptions);
  const mounted = await mountDirectoryHandle(handle, options);
  const granted = await ensureHandlePermission(handle, 'readwrite');
  if (!granted) {
    throw new Error('Folder access permission was denied.');
  }
  return mounted;
}

export async function unmountDirectory(id: unknown) {
  await deleteMountRecord(id);
}

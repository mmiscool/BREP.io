import { uint8ArrayToBase64 } from './componentLibrary.js';

const MODEL_EXTENSION = '.3mf';
const JSON_EXTENSION = '.json';
const BREP_JSON_EXTENSION = '.brep.json';

function getLeafName(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[\\/]/g);
  return String(parts[parts.length - 1] || '').trim();
}

export function parseDroppedWorkspaceFileName(fileName = '') {
  const name = getLeafName(fileName);
  const lower = name.toLowerCase();
  if (!name) {
    return {
      fileName: '',
      kind: 'unsupported',
      baseName: '',
    };
  }
  if (lower.endsWith(MODEL_EXTENSION)) {
    return {
      fileName: name,
      kind: '3mf',
      baseName: name.slice(0, -MODEL_EXTENSION.length),
    };
  }
  if (lower.endsWith(BREP_JSON_EXTENSION)) {
    return {
      fileName: name,
      kind: 'json',
      baseName: name.slice(0, -BREP_JSON_EXTENSION.length),
    };
  }
  if (lower.endsWith(JSON_EXTENSION)) {
    return {
      fileName: name,
      kind: 'json',
      baseName: name.slice(0, -JSON_EXTENSION.length),
    };
  }
  return {
    fileName: name,
    kind: 'unsupported',
    baseName: '',
  };
}

export async function readDroppedWorkspaceFileRecord(file, { allowJson = false } = {}) {
  const parsed = parseDroppedWorkspaceFileName(file?.name || '');
  const timestamp = new Date().toISOString();
  if (parsed.kind === '3mf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      ...parsed,
      record: {
        savedAt: timestamp,
        data3mf: uint8ArrayToBase64(bytes),
      },
    };
  }
  if (parsed.kind === 'json' && allowJson) {
    const data = await file.text();
    return {
      ...parsed,
      record: {
        savedAt: timestamp,
        data,
      },
    };
  }
  return {
    ...parsed,
    record: null,
  };
}

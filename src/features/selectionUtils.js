import { resolveSelectionObject as resolveSelectionObjectBase } from '../utils/selectionResolver.js';

export function resolveSelectionObject(selection, partHistory) {
  if (!selection) return null;
  if (typeof selection !== 'string') return selection;

  const nameResolver = (name) => {
    if (partHistory && typeof partHistory.getObjectByName === 'function') {
      return partHistory.getObjectByName(name);
    }
    const scene = partHistory?.scene;
    if (scene && typeof scene.getObjectByName === 'function') {
      return scene.getObjectByName(name);
    }
    return null;
  };

  return resolveSelectionObjectBase(partHistory?.scene || null, selection, {
    nameResolver,
    allowJson: false,
    allowUuid: false,
    allowFuzzyName: false,
    allowNameContains: false,
    allowPath: false,
    allowReference: false,
    allowTarget: false,
    allowSelectionName: false,
    arrayMode: 'first',
  });
}

function getFeatureEntryId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const params = entry.inputParams || {};
  const rawId = params.id ?? params.featureID ?? entry.id ?? null;
  if (rawId == null) return null;
  return String(rawId);
}

function isSketchFeatureType(type, partHistory) {
  const raw = type == null ? '' : String(type).trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'S' || upper === 'SKETCH' || upper === 'SKETCHFEATURE') return true;

  const registry = partHistory?.featureRegistry;
  if (!registry || typeof registry.getSafe !== 'function') return false;
  const cls = registry.getSafe(raw);
  if (!cls) return false;
  const shortName = String(cls.shortName || '').toUpperCase();
  const longName = String(cls.longName || '').toUpperCase();
  const className = String(cls.name || '').toUpperCase();
  if (shortName === 'S' || longName.includes('SKETCH') || className.includes('SKETCH')) return true;
  if (shortName === 'SP' || className.includes('SPLINE')) return true;
  if (shortName === 'IMAGE' || className.includes('IMAGETOFACE')) return true;
  if (shortName === 'TEXT' || className.includes('TEXTTOFACE')) return true;
  return false;
}

function isSketchFeatureId(partHistory, refName) {
  if (!partHistory || !Array.isArray(partHistory.features)) return false;
  const target = String(refName);
  for (const entry of partHistory.features) {
    const entryId = getFeatureEntryId(entry);
    if (entryId !== target) continue;
    if (isSketchFeatureType(entry?.type, partHistory)) return true;
  }
  return false;
}

export function selectionHasSketch(selection, partHistory) {
  const list = Array.isArray(selection) ? selection : [selection];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      const raw = item.trim();
      if (!raw) continue;
      const base = raw.split(/[:|\[]/, 1)[0];
      if (base && isSketchFeatureId(partHistory, base)) return true;
    }
    const obj = resolveSelectionObject(item, partHistory);
    if (!obj) continue;
    if (obj.type === 'SKETCH') return true;
    if (obj.parent && obj.parent.type === 'SKETCH') return true;
    if (obj.name) {
      const base = String(obj.name).split(/[:|\[]/, 1)[0];
      if (base && isSketchFeatureId(partHistory, base)) return true;
    }
  }
  return false;
}

export function normalizeSelectionName(value) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const parsedName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        if (parsedName) return parsedName;
        const parsedId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
        if (parsedId) return parsedId;
      }
    } catch { /* not JSON */ }
    return trimmed;
  }

  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
    if (typeof value.id === 'string' && value.id.trim()) return value.id.trim();
    if (Array.isArray(value.path)) {
      const joined = value.path.filter(Boolean).map(String).join(' > ');
      if (joined) return joined;
    }
  }

  const asString = String(value);
  return asString.trim() || null;
}

export function normalizeSelectionList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const item of values) {
    const normalized = normalizeSelectionName(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

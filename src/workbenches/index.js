import { ALL_WORKBENCH } from './allWorkbench.js';
import { ASSEMBLIES_WORKBENCH } from './assembliesWorkbench.js';
import { IMPORT_WORKBENCH } from './importWorkbench.js';
import { MODELING_WORKBENCH } from './modelingWorkbench.js';
import { PMI_WORKBENCH } from './pmiWorkbench.js';
import { SHEET_METAL_WORKBENCH } from './sheetMetalWorkbench.js';
import { SURFACING_WORKBENCH } from './surfacingWorkbench.js';

export const WORKBENCH_IDS = {
  MODELING: 'MODELING',
  IMPORT: 'IMPORT',
  SURFACING: 'SURFACING',
  SHEET_METAL: 'SHEET_METAL',
  ASSEMBLIES: 'ASSEMBLIES',
  PMI: 'PMI',
  ALL: 'ALL',
};

export const WORKBENCH_LIST = [
  MODELING_WORKBENCH,
  IMPORT_WORKBENCH,
  SURFACING_WORKBENCH,
  SHEET_METAL_WORKBENCH,
  ASSEMBLIES_WORKBENCH,
  PMI_WORKBENCH,
  ALL_WORKBENCH,
];

const WORKBENCH_MAP = new Map(WORKBENCH_LIST.map((definition) => [definition.id, definition]));
const FEATURE_WORKBENCH_METADATA = new WeakMap();

export function getDefaultWorkbenchForNewPart() {
  return WORKBENCH_IDS.MODELING;
}

export function getLegacyLoadWorkbenchDefault() {
  return WORKBENCH_IDS.ALL;
}

export function normalizeWorkbenchId(value, fallback = WORKBENCH_IDS.ALL) {
  const raw = String(value || '').trim().toUpperCase();
  if (WORKBENCH_MAP.has(raw)) return raw;
  return fallback;
}

export function listWorkbenchDefinitions() {
  return WORKBENCH_LIST.slice();
}

export function getWorkbenchDefinition(workbenchId) {
  return WORKBENCH_MAP.get(normalizeWorkbenchId(workbenchId)) || ALL_WORKBENCH;
}

export function getActiveWorkbench(partHistory) {
  return normalizeWorkbenchId(partHistory?.activeWorkbench, getLegacyLoadWorkbenchDefault());
}

export function setActiveWorkbench(partHistory, workbenchId) {
  if (!partHistory) return getLegacyLoadWorkbenchDefault();
  const normalized = normalizeWorkbenchId(workbenchId, getDefaultWorkbenchForNewPart());
  partHistory.activeWorkbench = normalized;
  return normalized;
}

export function registerFeatureWorkbenchMetadata(FeatureClass, options = {}) {
  if (!FeatureClass) return;
  const workbenches = normalizeWorkbenchList(options?.workbenches);
  if (workbenches == null) {
    FEATURE_WORKBENCH_METADATA.delete(FeatureClass);
    return;
  }
  FEATURE_WORKBENCH_METADATA.set(FeatureClass, workbenches);
}

export function getFeatureWorkbenchMetadata(FeatureClass) {
  return FEATURE_WORKBENCH_METADATA.get(FeatureClass) || null;
}

export function normalizeWorkbenchList(value) {
  if (value == null || value === false) return null;
  if (value === '*' || value === true) return ['*'];
  if (typeof value === 'string') {
    const normalized = normalizeWorkbenchId(value, '');
    return normalized ? [normalized] : null;
  }
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    const normalized = normalizeWorkbenchId(item, '');
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : null;
}

export function getFeatureCanonicalId(FeatureClass) {
  if (!FeatureClass) return '';
  return String(
    FeatureClass.shortName
    || FeatureClass.featureShortName
    || FeatureClass.type
    || FeatureClass.name
    || '',
  ).trim().toUpperCase();
}

export function isFeatureAllowedInWorkbench(FeatureClass, workbenchId) {
  const activeWorkbench = normalizeWorkbenchId(workbenchId, getLegacyLoadWorkbenchDefault());
  if (activeWorkbench === WORKBENCH_IDS.ALL) return true;
  const declared = getFeatureWorkbenchMetadata(FeatureClass);
  if (declared) {
    if (declared.includes('*')) return true;
    return declared.includes(activeWorkbench);
  }
  const definition = getWorkbenchDefinition(activeWorkbench);
  const featureTypes = definition?.featureTypes;
  if (featureTypes === '*') return true;
  if (!Array.isArray(featureTypes)) return false;
  const canonicalId = getFeatureCanonicalId(FeatureClass);
  return featureTypes.includes(canonicalId);
}

export function getAllowedFeatureClasses(subject) {
  const viewer = subject?.partHistory ? subject : null;
  const partHistory = viewer?.partHistory || subject || null;
  const registry = partHistory?.featureRegistry || null;
  const features = Array.isArray(registry?.features) ? registry.features : [];
  const workbenchId = viewer?._getActiveWorkbenchId?.() || getActiveWorkbench(partHistory);
  const allowed = features.filter((FeatureClass) => isFeatureAllowedInWorkbench(FeatureClass, workbenchId));
  if (workbenchId === WORKBENCH_IDS.ALL) return allowed;
  const featureTypes = getWorkbenchDefinition(workbenchId)?.featureTypes;
  if (!Array.isArray(featureTypes) || featureTypes.length === 0) return allowed;

  const orderIndex = new Map(featureTypes.map((featureType, index) => [String(featureType).trim().toUpperCase(), index]));
  return allowed
    .map((FeatureClass, registryIndex) => ({
      FeatureClass,
      registryIndex,
      order: orderIndex.get(getFeatureCanonicalId(FeatureClass)),
    }))
    .sort((a, b) => {
      const aOrdered = Number.isInteger(a.order);
      const bOrdered = Number.isInteger(b.order);
      if (aOrdered && bOrdered) return a.order - b.order;
      if (aOrdered) return -1;
      if (bOrdered) return 1;
      return a.registryIndex - b.registryIndex;
    })
    .map(({ FeatureClass }) => FeatureClass);
}

export function isContextFamilyEnabled(family, workbenchId) {
  const activeWorkbench = normalizeWorkbenchId(workbenchId, getLegacyLoadWorkbenchDefault());
  if (activeWorkbench === WORKBENCH_IDS.ALL) return true;
  const definition = getWorkbenchDefinition(activeWorkbench);
  return !!definition?.contextFamilies?.[family];
}

export function isToolbarButtonAllowed(record, workbenchId) {
  const activeWorkbench = normalizeWorkbenchId(workbenchId, getLegacyLoadWorkbenchDefault());
  if (activeWorkbench === WORKBENCH_IDS.ALL) return true;
  if (!record) return false;
  if (record.global === true) return true;
  const declared = normalizeWorkbenchList(record.workbenches);
  if (declared) {
    if (declared.includes('*')) return true;
    return declared.includes(activeWorkbench);
  }
  if (record.source === 'builtin' && record.id) {
    const toolbarButtons = getWorkbenchDefinition(activeWorkbench)?.toolbarButtons;
    if (toolbarButtons === '*') return true;
    return Array.isArray(toolbarButtons) && toolbarButtons.includes(String(record.id));
  }
  return false;
}

export function isSidePanelAllowed(record, workbenchId) {
  const activeWorkbench = normalizeWorkbenchId(workbenchId, getLegacyLoadWorkbenchDefault());
  if (activeWorkbench === WORKBENCH_IDS.ALL) return true;
  if (!record) return false;
  if (record.global === true) return true;
  const declared = normalizeWorkbenchList(record.workbenches);
  if (declared) {
    if (declared.includes('*')) return true;
    return declared.includes(activeWorkbench);
  }
  if (record.source === 'builtin' && record.id) {
    return !!getWorkbenchDefinition(activeWorkbench)?.sidePanels?.[record.id];
  }
  return false;
}

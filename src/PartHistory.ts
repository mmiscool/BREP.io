//
import * as THREE from 'three';


// Feature classes live in their own files; registry wires them up.
import { FeatureRegistry } from './FeatureRegistry.js';
import { Solid } from './BREP/BetterSolid.js';
import {
  applySolidAuthoringStateSnapshot,
  buildSolidAuthoringStateSnapshot,
} from './BREP/CppSolidCore.js';
import { SelectionFilter } from './UI/SelectionFilter.js';
import { AssemblyConstraintHistory } from './assemblyConstraints/AssemblyConstraintHistory.js';
import { AssemblyConstraintRegistry } from './assemblyConstraints/AssemblyConstraintRegistry.js';
import { AssemblyComponentFeature } from './features/assemblyComponent/AssemblyComponentFeature.js';
import { CamPlanManager } from './cam/CamPlanManager.js';
import { MetadataManager } from './metadataManager.js';
import { PMIViewsManager } from './pmi/PMIViewsManager.js';
import { SimulationStateManager } from './simulation/SimulationStateManager.js';
import { Sheet2DManager } from './sheets/Sheet2DManager.js';
import { WireHarnessManager } from './wireHarness/WireHarnessManager.js';
import { base64ToUint8Array, getComponentRecord } from './services/componentLibrary.js';
import { deepClone } from './utils/deepClone.js';
import {
  createEmptyConfiguratorState,
  normalizeConfiguratorState,
} from './utils/configuratorUtils.js';
import { sanitizeTransformValue } from './utils/transformReferenceUtils.js';
import { captureReferenceSelectionSnapshots } from './UI/referenceSnapshotStore.js';
import { isSceneRemovalProtected } from './UI/sceneOverlayUtils.js';
import {
  getDefaultWorkbenchForNewPart,
  getLegacyLoadWorkbenchDefault,
  normalizeWorkbenchId,
} from './workbenches/index.js';


const debug = false;
const UI_ONLY_INPUT_PARAM_KEYS = new Set(['__open']);
const DEFAULT_EXPRESSION_PRELUDE = 'resolution = 32;\n';
const DEFAULT_EXPRESSIONS = "//Examples:\nx = 10 + 6; \ny = x * 2;" + "\n\n" + DEFAULT_EXPRESSION_PRELUDE;

function getMonotonicTimeMs() {
  return (typeof performance !== 'undefined' && performance?.now) ? performance.now() : Date.now();
}

function getReferenceObjectNameCandidates(value) {
  if (!value || typeof value !== 'object') return [];
  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    if (typeof candidate !== 'string') return;
    const name = candidate.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  add(value.name);
  add(value.id);
  add(value.selectionName);
  add(value.userData?.edgeName);
  add(value.userData?.faceName);
  add(value.userData?.selectionName);
  return out;
}

function resolveCurrentReferenceObject(value, getObjectByName) {
  if (!value || typeof value !== 'object' || typeof getObjectByName !== 'function') return null;
  for (const name of getReferenceObjectNameCandidates(value)) {
    try {
      const resolved = getObjectByName(name);
      if (resolved && typeof resolved === 'object') return resolved;
    } catch { /* ignore resolver failures */ }
  }
  return null;
}

function resolveFeatureEntryId(entry, fallback = null) {
  if (!entry) return fallback;
  const params = entry.inputParams || {};
  const rawId = params.id ?? params.featureID ?? entry.id ?? fallback;
  if (rawId == null) return fallback;
  return String(rawId);
}

function stringifyInputParamsForDirtyCheck(inputParams) {
  const source = (inputParams && typeof inputParams === 'object') ? inputParams : {};
  try {
    const seenObjects = new WeakSet();
    const serialized = JSON.stringify(source, (key, value) => {
      if (key && UI_ONLY_INPUT_PARAM_KEYS.has(key)) return undefined;
      if (value && typeof value === 'object') {
        if (seenObjects.has(value)) return undefined;
        seenObjects.add(value);
        const refNames = getReferenceObjectNameCandidates(value);
        if (value.isObject3D || (typeof value.type === 'string' && refNames.length > 0)) {
          return { __reference: refNames[0] || null, type: value.type || null };
        }
      }
      return value;
    });
    return serialized == null ? '' : serialized;
  } catch {
    try {
      const fallback = {};
      for (const [key, value] of Object.entries(source)) {
        if (UI_ONLY_INPUT_PARAM_KEYS.has(key)) continue;
        fallback[key] = value;
      }
      return JSON.stringify(fallback) || '';
    } catch {
      return '';
    }
  }
}


export class PartHistory {
  [key: string]: any;

  constructor() {
    this.features = [];
    this.scene = new THREE.Scene();
    this.idCounter = 0;
    this.featureRegistry = new FeatureRegistry();
    this.assemblyConstraintRegistry = new AssemblyConstraintRegistry();
    this.assemblyConstraintHistory = new AssemblyConstraintHistory(this, this.assemblyConstraintRegistry);
    this.callbacks = {};
    this._modelRevision = 0;
    this._modelChangeListeners = new Set();
    this._runHistoryQueue = null;
    this._runHistoryQueueToken = null;
    this.currentHistoryStepId = null;
    this.runningFeatureId = null;
    this._runningFeatureTiming = null;
    this.expressions = DEFAULT_EXPRESSIONS;
    this.configurator = createEmptyConfiguratorState();
    this.activeWorkbench = getDefaultWorkbenchForNewPart();
    this.pmiViewsManager = new PMIViewsManager(this);
    this.simulationStateManager = new SimulationStateManager(this);
    this.camPlanManager = new CamPlanManager(this);
    this.sheet2DManager = new Sheet2DManager(this);
    this.wireHarnessManager = new WireHarnessManager(this);
    this.metadataManager = new MetadataManager
    this._historyUndo = {
      undoStack: [],
      redoStack: [],
      max: 50,
      debounceMs: 350,
      pendingTimer: null,
      lastSignature: null,
      captureInFlight: false,
      pendingRequest: false,
      isApplying: false,
    };
    if (this.assemblyConstraintHistory) {
      this.assemblyConstraintHistory.clear();
      this.assemblyConstraintHistory.setPartHistory(this);
    }


    // overide the scenes remove method to console log removals along with the stack trace

    const originalRemove = this.scene.remove;
    this.scene.remove = (...args) => {
      //console.log("Removing from scene:", args);
      const removable = args.filter((obj) => !isSceneRemovalProtected(obj));
      if (!removable.length) {
        //console.log("Removal prevented by object flag.");
        return;
      }

      //console.trace();
      originalRemove.apply(this.scene, removable);
    };

    // overide the scenes add method to console log additions along with the stack trace
    const originalAdd = this.scene.add;
    this.scene.add = (...args) => {
      //console.log("Adding to scene:", args);
      //console.trace();
      originalAdd.apply(this.scene, args);
    };

  }

  #runFeatureEntryMigrations(rawFeature) {
    if (!rawFeature || typeof rawFeature !== 'object') return rawFeature;
    const migrated = rawFeature;

    if (Object.prototype.hasOwnProperty.call(migrated, 'featureID')) {
      if (!migrated.id && migrated.featureID != null) {
        migrated.id = migrated.featureID;
      }
      try { delete migrated.featureID; } catch { /* ignore */ }
    }

    const paramsSource = migrated.inputParams && typeof migrated.inputParams === 'object'
      ? migrated.inputParams
      : null;
    if (paramsSource) {
      if (Object.prototype.hasOwnProperty.call(paramsSource, 'featureID')) {
        if ((paramsSource.id == null || paramsSource.id === '') && paramsSource.featureID != null) {
          paramsSource.id = paramsSource.featureID;
        }
        try { delete paramsSource.featureID; } catch { /* ignore */ }
      }
    }

    if ((migrated.id == null || migrated.id === '') && paramsSource?.id != null) {
      migrated.id = paramsSource.id;
    }

    return migrated;
  }

  #linkFeatureParams(feature) {
    if (!feature || typeof feature !== 'object') return;
    if (!feature.inputParams || typeof feature.inputParams !== 'object') {
      feature.inputParams = {};
    }
    if (!feature.persistentData || typeof feature.persistentData !== 'object') {
      feature.persistentData = {};
    }
    const params = feature.inputParams;
    const descriptor = { configurable: true, enumerable: false };
    const rawId = params.id ?? params.featureID ?? feature.id;
    if (rawId != null && rawId !== '') {
      const normalized = String(rawId);
      params.id = normalized;
      feature.id = normalized;
    } else if (params.id != null && params.id !== feature.id) {
      feature.id = params.id;
    } else if (feature.id != null && feature.id !== params.id) {
      params.id = feature.id;
    }

    if (!Object.getOwnPropertyDescriptor(params, 'featureID')) {
      Object.defineProperty(params, 'featureID', {
        ...descriptor,
        get: () => params.id,
        set: (value) => {
          if (value == null || value === '') {
            params.id = value;
            feature.id = value;
            return;
          }
          const normalized = String(value);
          params.id = normalized;
          feature.id = normalized;
        },
      });
    }
  }

  #prepareFeatureEntry(rawFeature) {
    if (!rawFeature || typeof rawFeature !== 'object') return null;
    const migrated = this.#runFeatureEntryMigrations(rawFeature);
    this.#linkFeatureParams(migrated);
    return migrated;
  }

  #prepareFeatureList(list) {
    if (!Array.isArray(list)) return [];
    const prepared = [];
    for (const rawFeature of list) {
      const entry = this.#prepareFeatureEntry(rawFeature);
      if (entry) prepared.push(entry);
    }
    return prepared;
  }

  #disposeMaterialResources(material) {
    if (!material) return;
    if (Array.isArray(material)) {
      for (const mat of material) this.#disposeMaterialResources(mat);
      return;
    }
    if (typeof material !== 'object') return;
    if (typeof material.dispose === 'function') {
      try { material.dispose(); } catch { }
    }
    try {
      for (const value of Object.values(material) as any[]) {
        if (value && typeof value === 'object' && value.isTexture && typeof value.dispose === 'function') {
          try { value.dispose(); } catch { }
        }
      }
    } catch { /* ignore texture disposal errors */ }
  }

  #disposeObjectResources(object) {
    if (!object || typeof object !== 'object') return;
    try {
      const children = Array.isArray(object.children) ? object.children.slice() : [];
      for (const child of children) this.#disposeObjectResources(child);
    } catch { }
    try {
      const geom = object.geometry;
      if (geom && typeof geom.dispose === 'function') geom.dispose();
    } catch { }
    this.#disposeMaterialResources(object.material);
  }

  #disposeSceneObjects(filterFn = null) {
    if (!this.scene || !Array.isArray(this.scene.children)) return;
    const children = this.scene.children.slice();
    for (const child of children) {
      if (isSceneRemovalProtected(child)) continue;
      let shouldDispose = true;
      if (typeof filterFn === 'function') {
        try { shouldDispose = !!filterFn(child); }
        catch { shouldDispose = false; }
      }
      if (!shouldDispose) continue;
      this.#disposeObjectResources(child);
      try { this.scene.remove(child); } catch { }
    }
  }

  #resolveVisibilityAnchor(obj) {
    if (!obj || typeof obj !== 'object') return null;

    const explicitParentSolid = obj.parentSolid || obj?.userData?.parentSolid || null;
    if (explicitParentSolid && explicitParentSolid.isObject3D) return explicitParentSolid;

    const isAnchorType = (candidate) => {
      const t = String(candidate?.type || '').toUpperCase();
      return t === 'SOLID' || t === 'COMPONENT' || t === 'SKETCH' || t === 'DATUM' || t === 'HELIX';
    };

    let cursor = obj.parent || null;
    while (cursor && cursor !== this.scene) {
      if (isAnchorType(cursor)) return cursor;
      cursor = cursor.parent || null;
    }
    return null;
  }

  #buildVisibilityPersistenceKey(obj) {
    if (!obj || typeof obj !== 'object' || typeof obj.visible === 'undefined') return null;

    const type = String(obj.type || '').toUpperCase();
    const supportedTypes = new Set(['SOLID', 'COMPONENT', 'SKETCH', 'DATUM', 'HELIX', 'PLANE', 'FACE', 'EDGE']);
    if (!supportedTypes.has(type)) return null;

    const anchor = this.#resolveVisibilityAnchor(obj);
    const anchorType = String(anchor?.type || '').toUpperCase();
    const anchorName = String(anchor?.name || '');
    const anchorFeatureIdRaw = anchor?.owningFeatureID ?? anchor?.userData?.owningFeatureID ?? null;
    const anchorFeatureId = anchorFeatureIdRaw == null ? '' : String(anchorFeatureIdRaw);

    const objectFeatureIdRaw = obj?.owningFeatureID ?? obj?.userData?.owningFeatureID ?? anchorFeatureIdRaw;
    const objectFeatureId = objectFeatureIdRaw == null ? '' : String(objectFeatureIdRaw);

    let objectName = '';
    if (type === 'FACE') objectName = String(obj?.userData?.faceName || obj?.name || '');
    else objectName = String(obj?.name || '');

    let faceA = '';
    let faceB = '';
    if (type === 'EDGE') {
      faceA = String(obj?.userData?.faceA || '');
      faceB = String(obj?.userData?.faceB || '');
      if (faceA > faceB) {
        const tmp = faceA;
        faceA = faceB;
        faceB = tmp;
      }
    }

    return JSON.stringify({
      type,
      objectName,
      objectFeatureId,
      anchorType,
      anchorName,
      anchorFeatureId,
      faceA,
      faceB,
    });
  }

  #captureHiddenVisibilityState() {
    const hiddenKeyCounts = new Map();
    if (!this.scene || typeof this.scene.traverse !== 'function') return hiddenKeyCounts;

    this.scene.traverse((obj) => {
      if (!obj || obj.visible !== false) return;
      const key = this.#buildVisibilityPersistenceKey(obj);
      if (!key) return;
      hiddenKeyCounts.set(key, (hiddenKeyCounts.get(key) || 0) + 1);
    });

    return hiddenKeyCounts;
  }

  #restoreHiddenVisibilityState(hiddenKeyCounts) {
    if (!(hiddenKeyCounts instanceof Map) || hiddenKeyCounts.size === 0) return;
    if (!this.scene || typeof this.scene.traverse !== 'function') return;

    const remaining = new Map(hiddenKeyCounts);
    this.scene.traverse((obj) => {
      if (!obj || remaining.size === 0) return;
      const key = this.#buildVisibilityPersistenceKey(obj);
      if (!key) return;

      const remainingCount = remaining.get(key) || 0;
      if (remainingCount <= 0) return;

      try { obj.visible = false; } catch { }
      if (remainingCount === 1) remaining.delete(key);
      else remaining.set(key, remainingCount - 1);
    });
  }

  captureVisibilityState() {
    const hiddenKeyCounts = this.#captureHiddenVisibilityState();
    return Array.from(hiddenKeyCounts.entries()).map(([key, count]) => ({
      key,
      count: Math.max(1, Number(count) || 1),
    }));
  }

  applyVisibilityState(serializedState) {
    const hiddenKeyCounts = new Map();
    const entries = Array.isArray(serializedState) ? serializedState : [];
    for (const entry of entries) {
      const key = typeof entry === 'string' ? entry : String(entry?.key || '');
      if (!key) continue;
      const count = Math.max(1, Math.round(Number(typeof entry === 'string' ? 1 : entry?.count) || 1));
      hiddenKeyCounts.set(key, (hiddenKeyCounts.get(key) || 0) + count);
    }

    if (this.scene && typeof this.scene.traverse === 'function') {
      this.scene.traverse((obj) => {
        if (!obj) return;
        const key = this.#buildVisibilityPersistenceKey(obj);
        if (!key) return;
        try { obj.visible = true; } catch { }
      });
    }

    this.#restoreHiddenVisibilityState(hiddenKeyCounts);
    return hiddenKeyCounts;
  }

  static evaluateExpressionSource(exprSource, equation) {
    const fnBody = `${exprSource}; return ${equation} ;`;
    try {
      let result = Function(fnBody)();
      if (typeof result === 'string') {
        const num = Number(result);
        if (!Number.isNaN(num)) {
          return num;
        }
      }
      return result;
    } catch (err) {
      try { console.warn('[PartHistory] evaluateExpression failed:', err?.message || err); } catch { }
      return null;
    }
  }

  static evaluateExpression(expressionsSource, equation, configuratorState = null) {
    const exprSource = PartHistory.buildExpressionSource(expressionsSource, configuratorState);
    return PartHistory.evaluateExpressionSource(exprSource, equation);
  }

  evaluateExpression(equation) {
    return PartHistory.evaluateExpressionSource(this.getExpressionsSource(), equation);
  }

  static buildConfiguratorPrelude(configuratorState = null) {
    const normalized = normalizeConfiguratorState(configuratorState);
    return `configurator = ${JSON.stringify(normalized.values)};`;
  }

  static buildExpressionSource(expressionsSource, configuratorState = null) {
    const exprSource = typeof expressionsSource === 'string' ? expressionsSource : '';
    const prelude = `${DEFAULT_EXPRESSION_PRELUDE}\n${PartHistory.buildConfiguratorPrelude(configuratorState)}`;
    if (!exprSource.trim()) return prelude;
    // Provide a default resolution before the user script runs; users can
    // overwrite it later with `resolution = ...` in their own expressions.
    return `${prelude}\n${exprSource}`;
  }

  buildExpressionSource(expressionsSource = this.expressions) {
    return PartHistory.buildExpressionSource(expressionsSource, this.configurator);
  }

  getExpressionsSource() {
    return this.buildExpressionSource(this.expressions);
  }

  getConfiguratorState() {
    return normalizeConfiguratorState(this.configurator);
  }

  getConfiguratorValues() {
    return this.getConfiguratorState().values;
  }

  getModelRevision() {
    return Number.isInteger(this._modelRevision) ? this._modelRevision : 0;
  }

  addModelChangeListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._modelChangeListeners.add(listener);
    return () => {
      try { this._modelChangeListeners.delete(listener); } catch { /* ignore */ }
    };
  }

  removeModelChangeListener(listener) {
    if (typeof listener !== 'function') return;
    try { this._modelChangeListeners.delete(listener); } catch { /* ignore */ }
  }

  markModelChanged(reason = 'update') {
    const nextRevision = this.getModelRevision() + 1;
    this._modelRevision = nextRevision;
    if (reason === 'runHistory') {
      try { this.camPlanManager?.invalidateGeneratedOperations?.('model-history'); } catch { /* ignore CAM invalidation failures */ }
    }
    if (!this._modelChangeListeners || this._modelChangeListeners.size === 0) return nextRevision;
    const detail = { reason, partHistory: this, revision: nextRevision };
    for (const listener of Array.from(this._modelChangeListeners) as any[]) {
      try { listener(nextRevision, detail); } catch { /* ignore listener errors */ }
    }
    return nextRevision;
  }



  #isTransientReferenceObject(obj) {
    let cursor = obj || null;
    let guard = 0;
    while (cursor && guard < 64) {
      const name = String(cursor?.name || '');
      const userData = cursor?.userData || {};
      if (
        userData.referenceSelectionGhost === true
        || userData.refPreview === true
        || name.startsWith('__REF_SELECTION_ADDED_GHOSTS__')
        || name.startsWith('__refSelectionAdded__')
        || name.startsWith('__REF_PREVIEW_GROUP__')
        || name.startsWith('__refPreview__')
      ) {
        return true;
      }
      cursor = cursor.parent || null;
      guard += 1;
    }
    return false;
  }

  #isAttachedToScene(obj) {
    let cursor = obj || null;
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor === this.scene) return true;
      cursor = cursor.parent || null;
      guard += 1;
    }
    return false;
  }

  #hasRemovedAncestor(obj) {
    let cursor = obj || null;
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor.__removeFlag) return true;
      cursor = cursor.parent || null;
      guard += 1;
    }
    return false;
  }

  #featureIndexForObject(obj) {
    if (!obj || !Array.isArray(this.features)) return -1;
    let cursor = obj;
    let guard = 0;
    while (cursor && guard < 64) {
      const raw = cursor.owningFeatureID ?? cursor.userData?.owningFeatureID ?? null;
      if (raw != null) {
        const featureId = String(raw);
        const idx = this.features.findIndex((entry) => resolveFeatureEntryId(entry) === featureId);
        if (idx >= 0) return idx;
      }
      cursor = cursor.parent || null;
      guard += 1;
    }
    return -1;
  }

  #leadingFeatureTokenFromSelectionName(name) {
    const raw = name == null ? '' : String(name).trim();
    if (!raw || !/[|:[\]]/.test(raw)) return '';
    const token = raw.split(/[:|[\]]/, 1)[0];
    return token ? String(token).trim() : '';
  }

  #scoreLiveSceneNameCandidate(obj, targetName = '') {
    if (!obj || this.#isTransientReferenceObject(obj)) return -Infinity;
    let score = 0;
    score += this.#isAttachedToScene(obj) ? 1_000_000_000_000_000 : -1_000_000_000_000_000;
    if (this.#hasRemovedAncestor(obj)) score -= 100_000_000_000_000;

    const timestamp = Number(obj.timestamp ?? obj.userData?.timestamp);
    if (Number.isFinite(timestamp)) score += Math.min(Math.max(timestamp, 0), 9_000_000_000_000);

    const featureIndex = this.#featureIndexForObject(obj);
    if (featureIndex >= 0) score += featureIndex * 10_000;

    const type = String(obj.type || obj.userData?.type || obj.userData?.brepType || '').toUpperCase();
    if (type === 'SOLID' || type === 'COMPONENT' || type === 'SKETCH') score += 100;
    else if (type === 'FACE' || type === 'EDGE') score += 50;
    else if (obj.geometry) score += 10;

    const featureToken = this.#leadingFeatureTokenFromSelectionName(targetName);
    if (featureToken && (type === 'FACE' || type === 'EDGE')) {
      const parentSolid = this.#findAncestorByType(obj, 'SOLID');
      const parentSolidName = parentSolid?.name != null ? String(parentSolid.name).trim() : '';
      if (parentSolidName) {
        if (parentSolidName === featureToken) score -= 50_000_000_000_000;
        else score += 50_000_000_000_000;
      }
    }
    return score;
  }

  getObjectByName(name) {
    const target = name == null ? '' : String(name);
    if (!target || !this.scene || typeof this.scene.traverse !== 'function') {
      return this.scene?.getObjectByName?.(target) || null;
    }

    let best = null;
    let bestScore = -Infinity;
    try {
      this.scene.traverse((obj) => {
        if (!obj || obj.name !== target) return;
        const score = this.#scoreLiveSceneNameCandidate(obj, target);
        if (score <= bestScore) return;
        best = obj;
        bestScore = score;
      });
    } catch {
      return this.scene.getObjectByName(target) || null;
    }
    return best;
  }

  // Removed: getObjectsByName (unused)

  async reset() {
    this.features = [];
    this.idCounter = 0;
    this.pmiViewsManager.reset();
    this.simulationStateManager.reset();
    this.camPlanManager.reset();
    this.sheet2DManager.reset();
    this.wireHarnessManager.reset();
    this.expressions = DEFAULT_EXPRESSIONS;
    this.configurator = createEmptyConfiguratorState();
    this.activeWorkbench = getDefaultWorkbenchForNewPart();
    // Reset MetadataManager
    this.metadataManager = new MetadataManager();
    this.currentHistoryStepId = null;
    this.runningFeatureId = null;
    this._runningFeatureTiming = null;

    this.#disposeSceneObjects();
    // empty the scene without destroying it
    await this.scene.clear();
    if (this.callbacks.reset) {
      await this.callbacks.reset();
    }

    if (this.assemblyConstraintHistory) {
      this.assemblyConstraintHistory.clear();
      this.assemblyConstraintHistory.setPartHistory(this);
    }

    if (this.callbacks.afterReset) {
      try { await this.callbacks.afterReset(); } catch { /* ignore */ }
    }

    this.markModelChanged('reset');

    this.resetHistoryUndo();
    await this._commitHistorySnapshot({ force: true });

    // sleep for a short duration to allow scene updates to complete
    //await new Promise(resolve => setTimeout(resolve, 1000));
    // console.log("PartHistory reset complete.");
  }

  #setFeatureRunningState(featureId = null, feature = null) {
    const nextFeatureId = featureId != null ? String(featureId) : null;
    const currentTiming = this._runningFeatureTiming || null;
    if (currentTiming && currentTiming.featureId !== nextFeatureId) {
      this.#finishRunningFeatureTiming(getMonotonicTimeMs());
    }

    this.runningFeatureId = nextFeatureId;
    if (nextFeatureId && (!this._runningFeatureTiming || this._runningFeatureTiming.featureId !== nextFeatureId)) {
      this._runningFeatureTiming = {
        featureId: nextFeatureId,
        feature: feature || null,
        startedAt: getMonotonicTimeMs(),
      };
    } else if (nextFeatureId && feature && this._runningFeatureTiming) {
      this._runningFeatureTiming.feature = feature;
    }
  }

  #finishRunningFeatureTiming(endedAt = getMonotonicTimeMs()) {
    const timing = this._runningFeatureTiming || null;
    if (!timing) return null;
    this._runningFeatureTiming = null;

    const startedAt = Number.isFinite(timing.startedAt) ? timing.startedAt : endedAt;
    const durationMs = Math.max(0, Math.round(endedAt - startedAt));
    const feature = timing.feature || this.features.find((candidate) => resolveFeatureEntryId(candidate) === timing.featureId) || null;
    if (feature && timing.recordLastRunTiming) {
      const prev = feature.lastRun && typeof feature.lastRun === 'object' ? feature.lastRun : {};
      feature.lastRun = {
        ok: prev.ok !== undefined ? prev.ok : true,
        startedAt,
        endedAt,
        durationMs,
        error: prev.error || null,
      };
    }
    return { feature, startedAt, endedAt, durationMs };
  }

  #collectTimestampDependencyObjects(paramDef, value) {
    if (!paramDef || !value) return [];
    const type = String(paramDef.type || '');
    if (type === 'reference_selection') {
      return (Array.isArray(value) ? value : [value]).filter((obj) => obj && typeof obj === 'object');
    }
    if (type === 'boolean_operation') {
      const targets = Array.isArray(value?.targets) ? value.targets : [];
      return targets.filter((obj) => obj && typeof obj === 'object');
    }
    return [];
  }

  #findAncestorByType(obj, typeName) {
    const wanted = String(typeName || '').toUpperCase();
    if (!obj || !wanted) return null;
    let cursor = obj;
    let guard = 0;
    while (cursor && guard < 64) {
      if (String(cursor.type || '').toUpperCase() === wanted) return cursor;
      cursor = cursor.parentSolid || cursor.userData?.parentSolid || cursor.parent || null;
      guard += 1;
    }
    return null;
  }

  #getTimestampDependencyValue(obj, paramDef = null) {
    if (!obj || typeof obj !== 'object') return NaN;
    const rawScope = paramDef?.timestampDependency
      ?? paramDef?.referenceTimestampScope
      ?? paramDef?.dependencyTimestamp
      ?? 'selection';
    const scope = String(rawScope || 'selection').trim().toLowerCase();
    let target = obj;
    if (scope === 'parentsolid' || scope === 'parent_solid' || scope === 'solid') {
      target = this.#findAncestorByType(obj, 'SOLID') || obj;
    }
    const timestamp = Number(target.timestamp ?? target.userData?.timestamp);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  #resolveLiveSelectionValue(value) {
    if (!value || typeof value !== 'object') return null;
    const resolved = resolveCurrentReferenceObject(value, (name) => this.getObjectByName(name));
    if (resolved && typeof resolved === 'object') return resolved;
    if (this.#isAttachedToScene(value) && !this.#isTransientReferenceObject(value)) return value;
    const fallbackName = getReferenceObjectNameCandidates(value)[0] || null;
    return fallbackName;
  }

  #cloneSnapshotValue(value, seen = new WeakSet()) {
    if (value == null) return value;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return String(value);
    if (type === 'function' || type === 'symbol' || type === 'undefined') return undefined;
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      try { return Array.from(value as any); } catch { return undefined; }
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      if (seen.has(value)) return undefined;
      seen.add(value);
      const out = [];
      for (const item of value) {
        const cloned = this.#cloneSnapshotValue(item, seen);
        out.push(cloned === undefined ? null : cloned);
      }
      seen.delete(value);
      return out;
    }
    if (value instanceof Map) {
      if (seen.has(value)) return undefined;
      seen.add(value);
      const out = {};
      for (const [key, item] of value.entries()) {
        const cloned = this.#cloneSnapshotValue(item, seen);
        if (cloned !== undefined) out[String(key)] = cloned;
      }
      seen.delete(value);
      return out;
    }
    if (value instanceof Set) {
      if (seen.has(value)) return undefined;
      seen.add(value);
      const out = [];
      for (const item of value.values()) {
        const cloned = this.#cloneSnapshotValue(item, seen);
        if (cloned !== undefined) out.push(cloned);
      }
      seen.delete(value);
      return out;
    }
    if (type === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      const out = {};
      for (const key of Object.keys(value)) {
        const cloned = this.#cloneSnapshotValue(value[key], seen);
        if (cloned !== undefined) out[key] = cloned;
      }
      seen.delete(value);
      return out;
    }
    return undefined;
  }

  #cloneSnapshotUserData(userData) {
    const cloned = this.#cloneSnapshotValue(userData || {});
    return cloned && typeof cloned === 'object' && !Array.isArray(cloned) ? cloned : {};
  }

  #finiteTimestamp(value, fallback = null) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }

  #applyTimestampToObject(obj, timestamp) {
    if (!obj || typeof obj !== 'object') return;
    const normalized = this.#finiteTimestamp(timestamp, null);
    if (!Number.isFinite(normalized)) return;
    try { obj.timestamp = normalized; } catch { }
    try {
      obj.userData = obj.userData || {};
      obj.userData.timestamp = normalized;
    } catch { }
  }

  #applyTimestampToChildrenRecursively(obj, timestamp) {
    this.#applyTimestampToObject(obj, timestamp);
    const children = Array.isArray(obj.children) ? obj.children : [];
    for (const child of children) {
      this.#applyTimestampToChildrenRecursively(child, timestamp);
    }
  }

  #quantizedGeometryNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const q = Math.round(n * 1e6);
    return String(Object.is(q, -0) ? 0 : q);
  }

  #pointSignatureFromValues(x, y, z) {
    const qx = this.#quantizedGeometryNumber(x);
    const qy = this.#quantizedGeometryNumber(y);
    const qz = this.#quantizedGeometryNumber(z);
    if (qx == null || qy == null || qz == null) return null;
    return `${qx},${qy},${qz}`;
  }

  #hashSignatureParts(parts) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    let length = 0;
    for (const part of parts) {
      const text = String(part);
      for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        h1 ^= c;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 = (Math.imul(h2 ^ c, 0x85ebca6b) + 0xc2b2ae35) >>> 0;
      }
      length += text.length + 1;
    }
    return `${h1.toString(36)}:${h2.toString(36)}:${length}`;
  }

  #polylineGeometrySignatureFromPoints(points, reversible = true) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const signatures = [];
    for (const point of points) {
      const sig = Array.isArray(point)
        ? this.#pointSignatureFromValues(point[0], point[1], point[2])
        : null;
      if (!sig) return null;
      signatures.push(sig);
    }
    const forward = signatures.join(';');
    const reverse = signatures.slice().reverse().join(';');
    const canonical = reversible && reverse < forward ? reverse : forward;
    return `poly:${signatures.length}:${this.#hashSignatureParts([canonical])}`;
  }

  #polylineGeometrySignatureFromFlat(flat, reversible = true) {
    if (!Array.isArray(flat) && !ArrayBuffer.isView(flat)) return null;
    flat = flat as any;
    if (flat.length < 6) return null;
    const points = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      points.push([flat[i], flat[i + 1], flat[i + 2]]);
    }
    return this.#polylineGeometrySignatureFromPoints(points, reversible);
  }

  #edgeGeometrySignature(obj) {
    const cached = obj?.userData?.polylineLocal;
    if (Array.isArray(cached) && cached.length >= 2) {
      return this.#polylineGeometrySignatureFromPoints(cached, true);
    }

    const geom = obj?.geometry || null;
    const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
    if (pos && pos.itemSize === 3 && pos.count >= 2) {
      const flat = [];
      for (let i = 0; i < pos.count; i += 1) {
        flat.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      return this.#polylineGeometrySignatureFromFlat(flat, true);
    }

    const start = geom?.attributes?.instanceStart;
    const end = geom?.attributes?.instanceEnd;
    if (start && end && start.itemSize === 3 && end.itemSize === 3 && start.count === end.count && start.count >= 1) {
      const points = [[start.getX(0), start.getY(0), start.getZ(0)]];
      for (let i = 0; i < end.count; i += 1) {
        points.push([end.getX(i), end.getY(i), end.getZ(i)]);
      }
      return this.#polylineGeometrySignatureFromPoints(points, true);
    }
    return null;
  }

  #meshGeometrySignature(obj) {
    const geom = obj?.geometry || null;
    const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
    if (!pos || pos.itemSize !== 3 || pos.count < 1) return null;
    const index = geom && typeof geom.getIndex === 'function' ? geom.getIndex() : null;
    const triangles = [];
    const pointForIndex = (idx) => this.#pointSignatureFromValues(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    if (index && index.count >= 3) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        const tri = [
          pointForIndex(index.getX(i)),
          pointForIndex(index.getX(i + 1)),
          pointForIndex(index.getX(i + 2)),
        ];
        if (tri.every(Boolean)) triangles.push(tri.sort().join('/'));
      }
    } else if (pos.count >= 3) {
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const tri = [pointForIndex(i), pointForIndex(i + 1), pointForIndex(i + 2)];
        if (tri.every(Boolean)) triangles.push(tri.sort().join('/'));
      }
    }
    if (triangles.length) {
      triangles.sort();
      return `mesh:${triangles.length}:${this.#hashSignatureParts(triangles)}`;
    }
    const points = [];
    for (let i = 0; i < pos.count; i += 1) {
      const sig = pointForIndex(i);
      if (sig) points.push(sig);
    }
    points.sort();
    return points.length ? `points:${points.length}:${this.#hashSignatureParts(points)}` : null;
  }

  #objectGeometrySignature(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const type = String(obj.type || '').toUpperCase();
    if (type === 'EDGE') return this.#edgeGeometrySignature(obj);
    if (type === 'FACE') return this.#meshGeometrySignature(obj);
    if (type === 'VERTEX') {
      const p = obj.position || null;
      const point = p ? this.#pointSignatureFromValues(p.x, p.y, p.z) : null;
      return point ? `vertex:${point}` : null;
    }
    return this.#meshGeometrySignature(obj) || this.#edgeGeometrySignature(obj);
  }

  #objectSnapshotName(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return String(obj.name || obj.userData?.edgeName || obj.userData?.faceName || obj.userData?.selectionName || '');
  }

  #snapshotChildObjects(obj) {
    const out = [];
    if (!obj || typeof obj.traverse !== 'function') return out;
    try { obj.updateMatrixWorld?.(true); } catch { }
    try {
      obj.traverse((child) => {
        if (!child || child === obj) return;
        const name = this.#objectSnapshotName(child);
        const type = String(child.type || '');
        const signature = this.#objectGeometrySignature(child);
        if (!name && !signature) return;
        out.push({
          name,
          type,
          signature,
          timestamp: this.#finiteTimestamp(child.timestamp ?? child.userData?.timestamp, null),
        });
      });
    } catch { /* ignore child snapshot failures */ }
    return out;
  }

  #snapshotChildKey(entry, signatureOverride = undefined) {
    if (!entry) return null;
    const name = String(entry.name || '');
    const type = String(entry.type || '').toUpperCase();
    const signature = signatureOverride === undefined ? entry.signature : signatureOverride;
    if (!name && !signature) return null;
    return `${type}\u0000${name}\u0000${signature || ''}`;
  }

  #buildChildTimestampLookup(snapshot) {
    const exact = new Map();
    const loose = new Map();
    const push = (map, key, timestamp) => {
      if (!key || !Number.isFinite(timestamp)) return;
      const queue = map.get(key);
      if (queue) queue.push(timestamp);
      else map.set(key, [timestamp]);
    };
    const children = Array.isArray(snapshot?.children) ? snapshot.children : [];
    for (const child of children) {
      const timestamp = this.#finiteTimestamp(child?.timestamp, null);
      if (!Number.isFinite(timestamp)) continue;
      if (child?.signature) push(exact, this.#snapshotChildKey(child), timestamp);
      else push(loose, this.#snapshotChildKey(child, ''), timestamp);
    }
    return { exact, loose };
  }

  #takeTimestampFromLookup(map, key) {
    if (!map || !key) return null;
    const queue = map.get(key);
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const timestamp = queue.shift();
    if (queue.length === 0) map.delete(key);
    return this.#finiteTimestamp(timestamp, null);
  }

  #applyEffectTimestamps(obj, rootTimestamp, sourceSnapshot = null) {
    if (!obj || typeof obj !== 'object') return;
    const normalizedRootTimestamp = this.#finiteTimestamp(rootTimestamp, Date.now());
    this.#applyTimestampToObject(obj, normalizedRootTimestamp);
    const lookup = this.#buildChildTimestampLookup(sourceSnapshot);
    try {
      obj.updateMatrixWorld?.(true);
      obj.traverse?.((child) => {
        if (!child || child === obj) return;
        const entry = {
          name: this.#objectSnapshotName(child),
          type: String(child.type || ''),
          signature: this.#objectGeometrySignature(child),
        };
        const exactKey = entry.signature ? this.#snapshotChildKey(entry) : null;
        const looseKey = !entry.signature ? this.#snapshotChildKey(entry, '') : null;
        const preserved = this.#takeTimestampFromLookup(lookup.exact, exactKey)
          ?? this.#takeTimestampFromLookup(lookup.loose, looseKey);
        this.#applyTimestampToObject(child, Number.isFinite(preserved) ? preserved : normalizedRootTimestamp);
      });
    } catch { /* ignore timestamp propagation failures */ }
  }

  #effectSnapshotKeyFromParts(type, name) {
    return `${String(type || '').toUpperCase()}\u0000${String(name || '')}`;
  }

  #effectSnapshotKeyForObject(obj) {
    return this.#effectSnapshotKeyFromParts(obj?.type, this.#objectSnapshotName(obj));
  }

  #buildEffectSnapshotQueues(snapshots) {
    const queues = new Map();
    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
      const key = this.#effectSnapshotKeyFromParts(snapshot?.type, snapshot?.name);
      const queue = queues.get(key);
      if (queue) queue.push(snapshot);
      else queues.set(key, [snapshot]);
    }
    return queues;
  }

  #takeEffectSnapshotForObject(queues, obj) {
    const key = this.#effectSnapshotKeyForObject(obj);
    const queue = queues?.get(key);
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const snapshot = queue.shift();
    if (queue.length === 0) queues.delete(key);
    return snapshot || null;
  }

  #cloneMaterialForSnapshot(material) {
    if (!material) return material;
    if (Array.isArray(material)) return material.map((mat) => this.#cloneMaterialForSnapshot(mat));
    if (typeof material.clone === 'function') {
      try { return material.clone(); } catch { return material; }
    }
    return material;
  }

  #cloneObjectForSnapshot(obj) {
    if (!obj || typeof obj.clone !== 'function') return null;
    let clone = null;
    try { clone = obj.clone(true); } catch { clone = null; }
    if (!clone) return null;
    try {
      clone.traverse?.((child) => {
        if (!child) return;
        if (child.geometry && typeof child.geometry.clone === 'function') {
          try { child.geometry = child.geometry.clone(); } catch { /* ignore */ }
        }
        if (child.material) child.material = this.#cloneMaterialForSnapshot(child.material);
        if (child.userData && typeof child.userData === 'object') child.userData = this.#cloneSnapshotUserData(child.userData);
      });
    } catch { /* ignore */ }
    try { if (clone.parent) clone.parent.remove(clone); } catch { /* ignore */ }
    return clone;
  }

  #snapshotEffectObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const base = {
      name: obj.name != null ? String(obj.name) : '',
      type: obj.type != null ? String(obj.type) : '',
      owningFeatureID: obj.owningFeatureID != null ? String(obj.owningFeatureID) : null,
      timestamp: Number.isFinite(Number(obj.timestamp ?? obj.userData?.timestamp))
        ? Number(obj.timestamp ?? obj.userData?.timestamp)
        : null,
      visible: obj.visible !== false,
      renderOrder: Number.isFinite(Number(obj.renderOrder)) ? Number(obj.renderOrder) : 0,
      userData: this.#cloneSnapshotUserData(obj.userData || {}),
      children: this.#snapshotChildObjects(obj),
    };

    const isSolid = String(obj.type || '').toUpperCase() === 'SOLID'
      && Array.isArray(obj._vertProperties)
      && Array.isArray(obj._triVerts)
      && Array.isArray(obj._triIDs);
    if (isSolid) {
      try {
        return {
          ...base,
          snapshotType: 'solid',
          solid: buildSolidAuthoringStateSnapshot(obj),
        };
      } catch { /* fall through to object snapshot */ }
    }

    const template = this.#cloneObjectForSnapshot(obj);
    if (!template) return null;
    return {
      ...base,
      snapshotType: 'object3d',
      template,
    };
  }

  #snapshotEffectObjects(objects) {
    const out = [];
    for (const obj of Array.isArray(objects) ? objects : []) {
      const snapshot = this.#snapshotEffectObject(obj);
      if (snapshot) out.push(snapshot);
    }
    return out;
  }

  #restoreEffectObjectFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    let obj = null;
    if (snapshot.snapshotType === 'solid' && snapshot.solid) {
      obj = new Solid();
      try { applySolidAuthoringStateSnapshot(obj, snapshot.solid); } catch { obj = null; }
    } else if (snapshot.snapshotType === 'object3d' && snapshot.template) {
      obj = this.#cloneObjectForSnapshot(snapshot.template);
    }
    if (!obj) return null;
    try { obj.name = snapshot.name || obj.name || ''; } catch { /* ignore */ }
    try { obj.type = snapshot.type || obj.type; } catch { /* ignore */ }
    try { obj.owningFeatureID = snapshot.owningFeatureID; } catch { /* ignore */ }
    try { obj.userData = this.#cloneSnapshotUserData(snapshot.userData || {}); } catch { /* ignore */ }
    try { obj.visible = snapshot.visible !== false; } catch { /* ignore */ }
    try { obj.renderOrder = Number(snapshot.renderOrder) || 0; } catch { /* ignore */ }
    if (Number.isFinite(Number(snapshot.timestamp))) {
      this.#applyTimestampToObject(obj, Number(snapshot.timestamp));
    }
    return obj;
  }

  #resolveRemovedObjectFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const name = typeof snapshot.name === 'string' ? snapshot.name.trim() : '';
    if (!name) return null;
    return this.getObjectByName(name) || null;
  }

  #hasUsableEffectSnapshots(feature) {
    const snapshots = feature?.effectSnapshots;
    return !!(snapshots
      && Array.isArray(snapshots.added)
      && Array.isArray(snapshots.removed));
  }

  #hasStaleSubtractAddedSnapshot(feature, schema, resolvedParams) {
    if (!feature || !schema || !resolvedParams || !this.#hasUsableEffectSnapshots(feature)) return false;
    const featureId = resolveFeatureEntryId(feature);
    if (!featureId) return false;
    for (const key in schema) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) continue;
      const def = schema[key];
      if (!def || def.type !== 'boolean_operation') continue;
      const booleanValue = resolvedParams[key];
      const op = String(booleanValue?.operation || '').trim().toUpperCase();
      const targets = Array.isArray(booleanValue?.targets) ? booleanValue.targets.filter(Boolean) : [];
      if (op !== 'SUBTRACT' || targets.length === 0) continue;
      for (const snapshot of feature.effectSnapshots.added) {
        const snapshotType = String(snapshot?.type || '').trim().toUpperCase();
        const snapshotName = String(snapshot?.name || '').trim();
        if (snapshotType === 'SOLID' && snapshotName === featureId) return true;
      }
    }
    return false;
  }

  async runHistory(options = {}) {
    const previous = this._runHistoryQueue || Promise.resolve();
    const token = {};
    this._runHistoryQueueToken = token;
    const queued = previous
      .catch(() => { })
      .then(() => this.#runHistoryImpl(options));
    this._runHistoryQueue = queued.catch(() => { });
    try {
      return await queued;
    } finally {
      if (this._runHistoryQueueToken === token) {
        this._runHistoryQueue = null;
        this._runHistoryQueueToken = null;
      }
    }
  }

  async #runHistoryImpl(options: any = {}) {
    const throwOnFeatureError = !!options?.throwOnFeatureError;
    const whatStepToStopAt = this.currentHistoryStepId;
    const stopBeforeFeatureId = options?.stopBeforeFeatureId != null
      ? String(options.stopBeforeFeatureId)
      : null;
    const hiddenVisibilityState = this.#captureHiddenVisibilityState();
    let modelChanged = false;

    this.#setFeatureRunningState(null);
    try {
      this.#disposeSceneObjects((obj) => !obj?.isLight && !obj?.isCamera && !obj?.isTransformGizmo);
      await this.scene.clear();


      let skipAllFeatures = false;
      const features = Array.isArray(this.features) ? this.features : [];
      const nowMs = getMonotonicTimeMs;
      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        this.#linkFeatureParams(feature);
        const featureId = resolveFeatureEntryId(feature);
        if (skipAllFeatures) {
          continue;
        }
        if (stopBeforeFeatureId && featureId === stopBeforeFeatureId) {
          skipAllFeatures = true;
          continue;
        }

        if (whatStepToStopAt && featureId === whatStepToStopAt) {
          skipAllFeatures = true; // stop after this feature
        }

        this.#setFeatureRunningState(featureId, feature);

        // Do NOT mutate currentHistoryStepId while running.
        // It is used by the UI to indicate which panel the user wants open
        // (and to determine the stop-at step). Updating it here caused the
        // HistoryWidget to constantly switch the open panel to whatever
        // feature happened to be executing, which made it impossible to
        // expand items after PNG imports and similar long-running steps.

        if (this.callbacks.run) {
          await this.callbacks.run(featureId);
        }
        const FeatureClass = this.featureRegistry.getSafe(feature.type);
        if (!FeatureClass) {
          // Record an error on the feature but do not abort the whole run.
          const t1 = nowMs();
          const msg = `Feature type "${feature.type}" is not installed`;
          try {
            const startedAt = this._runningFeatureTiming?.featureId === featureId
              ? this._runningFeatureTiming.startedAt
              : t1;
            feature.lastRun = {
              ok: false,
              startedAt,
              endedAt: t1,
              durationMs: Math.max(0, Math.round(t1 - startedAt)),
              error: { name: 'MissingFeature', message: msg, stack: null },
            };
            if (this._runningFeatureTiming?.featureId === featureId) {
              this._runningFeatureTiming.recordLastRunTiming = true;
            }
          } catch { }
          if (throwOnFeatureError) {
            const error: any = new Error(`Feature ${featureId} (${feature.type}) failed: ${msg}`);
            error.name = 'FeatureHistoryError';
            error.featureId = featureId;
            error.featureType = feature.type;
            error.featureIndex = i;
            error.featureLastRun = feature.lastRun;
            try { this.#restoreHiddenVisibilityState(hiddenVisibilityState); } catch { }
            throw error;
          }
          // Skip visualization/add/remove steps for this feature
          continue;
        }
        const instance = new FeatureClass(this);

        //await Object.assign(instance.inputParams, feature.inputParams);
        await Object.assign(instance.persistentData, feature.persistentData);

        // Remove any existing scene children owned by this feature (rerun case)
        const toRemoveOwned = this.scene.children.slice().filter(ch => ch?.owningFeatureID === featureId);
        if (toRemoveOwned.length) {
          for (const ch of toRemoveOwned) this.scene.remove(ch);
        }

        // if the inputParams have changed since last run, mark dirty
        // (ignore UI-only keys such as panel expansion state).
        const inputParamsSignature = stringifyInputParamsForDirtyCheck(feature.inputParams);
        if (inputParamsSignature !== feature.lastRunInputParams) feature.dirty = true;

        instance.inputParams = await this.sanitizeInputParams(FeatureClass.inputParamsSchema, feature.inputParams);
        try { this._captureReferencePreviewSnapshots(feature, FeatureClass.inputParamsSchema, instance.inputParams, instance.persistentData); } catch { }
        // Check timestamps of geometry dependencies. Restored feature outputs keep
        // their original timestamps, so only a full upstream rebuild propagates.
        for (const key in FeatureClass.inputParamsSchema) {
          if (Object.prototype.hasOwnProperty.call(FeatureClass.inputParamsSchema, key)) {
            const paramDef = FeatureClass.inputParamsSchema[key];
            const selected = this.#collectTimestampDependencyObjects(paramDef, instance.inputParams[key]);
            for (const obj of selected) {
              const objTime = this.#getTimestampDependencyValue(obj, paramDef);
              if (Number.isFinite(objTime) && (!Number.isFinite(feature.timestamp) || objTime > feature.timestamp)) {
                feature.dirty = true;
                break;
              }
            }
          }
        }

        // compare any numeric inputParams as evaluated by the sanitizeInputParams method and catch changes due to expressions
        // the instance.inputParams have already been sanitized

        for (const key in FeatureClass.inputParamsSchema) {
          if (Object.prototype.hasOwnProperty.call(FeatureClass.inputParamsSchema, key)) {
            const paramDef = FeatureClass.inputParamsSchema[key];
            if (feature.previouseExpressions === undefined) feature.previouseExpressions = {};
            const exprMap = feature?.inputParams && typeof feature.inputParams === 'object'
              ? feature.inputParams.__expr
              : null;
            const hasExpr = !!(exprMap && Object.prototype.hasOwnProperty.call(exprMap, key));
            const trackExpr = paramDef.type === 'number'
              || hasExpr
              || (paramDef.type === 'string' && paramDef.allowExpression);
            if (trackExpr) {
              try {
                const makeSig = (value) => {
                  if (value == null) return 'null';
                  if (typeof value === 'object') {
                    try { return JSON.stringify(value); } catch { return String(value); }
                  }
                  return String(value);
                };
                const nextSig = makeSig(instance.inputParams[key]);
                if (feature.previouseExpressions[key] === undefined) feature.dirty = true;
                else if (String(feature.previouseExpressions[key]) !== nextSig) feature.dirty = true;
                feature.previouseExpressions[key] = nextSig;
              } catch {
                feature.dirty = true;
                feature.previouseExpressions[key] = instance.inputParams[key];
              }
            }
          }
        }


        // Sketch features need a preview run to detect topology/reference-driven changes.
        // Reuse that preview result later instead of re-running the same sketch again.
        const featureName = FeatureClass?.longName || FeatureClass?.shortName || FeatureClass?.name || '';
        let sketchPreviewRun = null;
        if (featureName === 'Sketch') {
          try {
            const previewStartedAt = nowMs();
            const previewResultArtifacts = await instance.run(this);
            const previewEndedAt = nowMs();
            sketchPreviewRun = {
              resultArtifacts: previewResultArtifacts,
              startedAt: previewStartedAt,
              endedAt: previewEndedAt,
              durationMs: Math.max(0, Math.round(previewEndedAt - previewStartedAt)),
            };
            const sketchChanged = instance.hasSketchChanged(feature);
            if (sketchChanged) feature.dirty = true;
          } catch (error) {
            console.warn('[PartHistory] Sketch change detection failed:', error);
            feature.dirty = true;
            sketchPreviewRun = null;
          }
        }

        if (!feature.dirty && feature.effects && !this.#hasUsableEffectSnapshots(feature)) {
          feature.dirty = true;
        }
        if (!feature.dirty && this.#hasStaleSubtractAddedSnapshot(feature, FeatureClass.inputParamsSchema, instance.inputParams)) {
          feature.dirty = true;
        }

        let featureExecuted = false;
        if (feature.dirty) {
          if (debug) console.log("feature dirty");
          if (debug) console.log(`Running feature ${i + 1}/${features.length} (${featureId}) of type ${feature.type}...`, feature);

          // Record the current input params as lastRunInputParams
          feature.lastRunInputParams = inputParamsSignature;


          let t0 = nowMs();

          try {
            if (sketchPreviewRun) {
              instance.resultArtifacts = sketchPreviewRun.resultArtifacts;
              t0 = sketchPreviewRun.startedAt;
            } else {
              instance.resultArtifacts = await instance.run(this);
            }
            feature.effects = {
              added: instance.resultArtifacts.added || [],
              removed: instance.resultArtifacts.removed || []
            }


            feature.timestamp = Date.now();

            const t1 = sketchPreviewRun ? sketchPreviewRun.endedAt : nowMs();
            const startedAt = this._runningFeatureTiming?.featureId === featureId
              ? this._runningFeatureTiming.startedAt
              : t0;

            feature.lastRun = { ok: true, startedAt, endedAt: t1, durationMs: Math.max(0, Math.round(t1 - startedAt)), error: null };
            if (this._runningFeatureTiming?.featureId === featureId) {
              this._runningFeatureTiming.recordLastRunTiming = true;
            }
            feature.dirty = false;
            featureExecuted = true;
            modelChanged = true;
          } catch (e) {
            const t1 = nowMs();
            const startedAt = this._runningFeatureTiming?.featureId === featureId
              ? this._runningFeatureTiming.startedAt
              : t0;
            feature.lastRun = { ok: false, startedAt, endedAt: t1, durationMs: Math.max(0, Math.round(t1 - startedAt)), error: { message: e?.message || String(e), name: e?.name || 'Error', stack: e?.stack || null } };
            if (this._runningFeatureTiming?.featureId === featureId) {
              this._runningFeatureTiming.recordLastRunTiming = true;
            }
            feature.timestamp = Date.now();
            instance.errorString = `Error occurred while running feature ${featureId}: ${e.message}`;
            try { this.#restoreHiddenVisibilityState(hiddenVisibilityState); } catch { }
            if (throwOnFeatureError) {
              const message = `Feature ${featureId} (${feature.type}) failed: ${e?.message || String(e)}`;
              const error: any = new Error(message);
              error.name = 'FeatureHistoryError';
              error.featureId = featureId;
              error.featureType = feature.type;
              error.featureIndex = i;
              error.featureLastRun = feature.lastRun;
              error.cause = e;
              if (e?.stack) {
                error.stack = `${error.stack}\nCaused by: ${e.stack}`;
              }
              throw error;
            }
            console.error(e);
            return;
          }
        }

        await this.applyFeatureEffects(feature.effects, featureId, feature, { restoreFromSnapshot: !featureExecuted });


        feature.persistentData = instance.persistentData;
        try {
          if (feature?.persistentData?.consumeFileInput && feature?.inputParams && typeof feature.inputParams === 'object') {
            if (Object.prototype.hasOwnProperty.call(feature.inputParams, 'fileToImport')) {
              feature.inputParams.fileToImport = '';
            }
            const exprMap = feature.inputParams.__expr;
            if (exprMap && typeof exprMap === 'object' && !Array.isArray(exprMap)) {
              delete exprMap.fileToImport;
              if (Object.keys(exprMap).length === 0) delete feature.inputParams.__expr;
            }
            delete feature.persistentData.consumeFileInput;
            feature.lastRunInputParams = stringifyInputParamsForDirtyCheck(feature.inputParams);
          }
        } catch { /* ignore */ }
      }

      try {
        await this.runAssemblyConstraints();
      } catch (error) {
        console.warn('[PartHistory] Assembly constraints run failed:', error);
      }
      try { this.#restoreHiddenVisibilityState(hiddenVisibilityState); } catch { }

      // Do not clear currentHistoryStepId here. Keeping it preserves the UX of
      // "stop at the currently expanded feature" across subsequent runs. The
      // UI will explicitly clear it when no section is expanded.

      if (this.callbacks.afterRunHistory) {
        try { await this.callbacks.afterRunHistory(); } catch { /* ignore */ }
      }

      if (modelChanged) {
        this.markModelChanged('runHistory');
      }

      return this;
    } finally {
      this.#setFeatureRunningState(null);
    }
  }

  _captureReferencePreviewSnapshots(feature, schema, resolvedParams, persistentTarget = null) {
    if (!schema || !resolvedParams) return;
    const stores = [];
    if (feature) {
      feature.persistentData = feature.persistentData || {};
      stores.push(feature.persistentData);
    }
    if (persistentTarget && typeof persistentTarget === 'object') {
      stores.push(persistentTarget);
    }
    captureReferenceSelectionSnapshots({ stores, schema, resolvedParams });
  }


  _seedSourceFeatureMetadata(target, featureID) {
    const normalizedFeatureId = featureID == null ? null : String(featureID);
    if (!normalizedFeatureId || !target || typeof target !== 'object') return;

    const applyToSolid = (solid) => {
      if (!solid || typeof solid !== 'object') return;
      const faceNames = typeof solid.getFaceNames === 'function'
        ? solid.getFaceNames()
        : (solid._faceNameToID instanceof Map ? Array.from(solid._faceNameToID.keys()) : []);
      if (!Array.isArray(faceNames) || faceNames.length === 0 || typeof solid.setFaceMetadata !== 'function') return;

      for (const faceName of faceNames) {
        if (!faceName) continue;
        let existing = null;
        try {
          existing = typeof solid.getFaceMetadata === 'function' ? solid.getFaceMetadata(faceName) : null;
        } catch {
          existing = null;
        }
        const existingFeatureId = existing?.sourceFeatureId ?? existing?.sourceFeatureID ?? null;
        if (existingFeatureId != null && String(existingFeatureId).trim()) continue;
        try {
          solid.setFaceMetadata(faceName, { sourceFeatureId: normalizedFeatureId });
        } catch { /* ignore face provenance seed failures */ }
      }
    };

    if (String(target?.type || '').toUpperCase() === 'SOLID') {
      applyToSolid(target);
      return;
    }
    try {
      target.traverse?.((node) => {
        if (String(node?.type || '').toUpperCase() === 'SOLID') {
          applyToSolid(node);
        }
      });
    } catch { /* ignore traversal failures */ }
  }


  async _coerceRunEffects(result, featureType, featureID) {
    if (result == null) return { added: [], removed: [] };
    if (Array.isArray(result)) {
      throw new Error(`[PartHistory] Feature "${featureType}" returned an array; expected { added, removed } payload (featureID=${featureID}).`);
    }
    const added = Array.isArray(result.added) ? result.added.filter(Boolean) : [];
    const removed = Array.isArray(result.removed) ? result.removed.filter(Boolean) : [];

    // set the owningFeatureID for each item added by this feature
    for (const artifact of added) {
      artifact.owningFeatureID = featureID;
      this._seedSourceFeatureMetadata(artifact, featureID);
      // Ensure any stale manifold/cache is dropped before visualizing
      try { await artifact.free(); } catch { }
      try { await artifact.visualize(); } catch { }

    }



    return { added, removed };
  }


  async applyFeatureEffects(effects, featureID, feature, options: any = {}) {
    if (!effects || typeof effects !== 'object') return;
    const restoreFromSnapshot = !!options?.restoreFromSnapshot && this.#hasUsableEffectSnapshots(feature);
    let added = Array.isArray(effects.added) ? effects.added : [];
    let removed = Array.isArray(effects.removed) ? effects.removed : [];
    const addedSnapshotSources = [];
    const previousAddedSnapshotQueues = restoreFromSnapshot
      ? null
      : this.#buildEffectSnapshotQueues(feature?.effectSnapshots?.added || []);

    if (restoreFromSnapshot) {
      added = [];
      for (const snapshot of feature.effectSnapshots.added) {
        const restored = this.#restoreEffectObjectFromSnapshot(snapshot);
        if (restored) {
          added.push(restored);
          addedSnapshotSources.push(snapshot);
        }
      }
      removed = [];
      for (const snapshot of feature.effectSnapshots.removed) {
        const current = this.#resolveRemovedObjectFromSnapshot(snapshot);
        if (current) removed.push(current);
      }
    }

    for (const r of removed) {
      await this._safeRemove(r);
    }

    let addedIndex = 0;
    for (const a of added) {
      if (a && typeof a === 'object') {
        if (a === this.scene) continue;
        this._seedSourceFeatureMetadata(a, featureID);
        // Free first to force rebuild from latest arrays, then visualize
        try { await a.free(); } catch { }
        try { await a.visualize(); } catch { }
        await this.scene.add(a);
        try { SelectionFilter.ensureSelectionHandlers(a, { deep: true }); } catch { }
        // make sure the flag for removal is cleared
        try { a.__removeFlag = false; } catch { }




        // attach the timestamp from the feature to the object for traceability.
        // Restored snapshots already carry the previous run timestamp; keeping
        // it stable prevents false downstream invalidation.
        try {
          const snapshotSource = restoreFromSnapshot
            ? (addedSnapshotSources[addedIndex] || null)
            : this.#takeEffectSnapshotForObject(previousAddedSnapshotQueues, a);
          const timestamp = restoreFromSnapshot
            ? this.#finiteTimestamp(snapshotSource?.timestamp ?? a.timestamp, feature.timestamp)
            : feature.timestamp;
          this.#applyEffectTimestamps(a, timestamp, snapshotSource);
        } catch { }

      }
      addedIndex += 1;
    }

    // apply the featureID to added items for traceability. Removed objects keep
    // their original owningFeatureID so cached upstream outputs can be restored
    // without pretending they were created by the downstream feature.
    try { for (const obj of added) { if (obj) obj.owningFeatureID = featureID; } } catch { }
    try {
      for (const obj of removed) {
        if (!obj) continue;
        obj.userData = obj.userData || {};
        obj.userData.removedByFeatureID = featureID;
      }
    } catch { }


    if (feature && typeof feature === 'object') {
      feature.effects = { added, removed };
      if (!restoreFromSnapshot) {
        feature.effectSnapshots = {
          added: this.#snapshotEffectObjects(added),
          removed: this.#snapshotEffectObjects(removed),
        };
      }
    }
  }

  // Removed unused signature/canonicalization helpers



  _safeRemove(obj) {
    if (!obj) return;
    try {
      if (obj.parent) {
        const rm = obj.parent.remove;
        if (typeof rm === 'function') obj.parent.remove(obj);
        else if (rm !== undefined && THREE?.Object3D?.prototype?.remove) THREE.Object3D.prototype.remove.call(obj.parent, obj);
        else this.scene.remove(obj);
      } else {
        const rm = this.scene.remove;
        if (typeof rm === 'function') this.scene.remove(obj);
        else if (rm !== undefined && THREE?.Object3D?.prototype?.remove) THREE.Object3D.prototype.remove.call(this.scene, obj);
      }
    } catch { }
  }

  // Removed unused _safeAdd and _effectsAppearApplied







  // methods to store and retrieve feature history to JSON strings
  // We will store the features, idCounter, expressions, and optionally PMI views
  async toJSON(options: any = {}) {
    try {
      this.syncAssemblyComponentTransforms?.();
    } catch (error) {
      console.warn('[PartHistory] Failed to sync assembly component transforms before export:', error);
    }
    const constraintsSnapshot = this.assemblyConstraintHistory?.snapshot?.() || { idCounter: 0, constraints: [] };


    // build features object keeping only the inputParams and persistentData
    const features = this.features.map(f => ({
      type: f.type,
      inputParams: f.inputParams,
      persistentData: this._sanitizePersistentDataForExport(f.persistentData),
      timestamp: f.timestamp || null,
    }));
    const pmiViews = this.pmiViewsManager.toSerializable();
    const simulation = this.simulationStateManager.toSerializable();
    const cam = this.camPlanManager.toSerializable({
      includeGeneratedData: options?.includeCamGeneratedData !== false,
      includeGeneratedToolpaths: options?.includeCamGeneratedToolpaths !== false,
    });
    const sheets2D = this.sheet2DManager.toSerializable();
    const wireHarness = this.wireHarnessManager.toSerializable();

    return JSON.stringify({
      features,
      idCounter: this.idCounter,
      expressions: this.expressions,
      configurator: this.getConfiguratorState(),
      activeWorkbench: normalizeWorkbenchId(this.activeWorkbench, getDefaultWorkbenchForNewPart()),
      pmiViews,
      simulation,
      cam,
      sheets2D,
      wireHarness,
      metadata: this.metadataManager.metadata,
      assemblyConstraints: constraintsSnapshot.constraints,
      assemblyConstraintIdCounter: constraintsSnapshot.idCounter,
    }, null, 2);
  }

  _sanitizePersistentDataForExport(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (!Object.prototype.hasOwnProperty.call(raw, 'lastProfileDiagnostics')) return raw;
    const clone = deepClone(raw);
    delete clone.lastProfileDiagnostics;
    return clone;
  }

  async fromJSON(jsonString, options: any = {}) {
    const importData = JSON.parse(jsonString);
    this.runningFeatureId = null;
    this._runningFeatureTiming = null;
    const rawFeatures = Array.isArray(importData.features) ? importData.features : [];
    this.features = this.#prepareFeatureList(rawFeatures);
    this.idCounter = importData.idCounter;
    this.expressions = importData.expressions || "";
    this.configurator = normalizeConfiguratorState(importData.configurator);
    this.activeWorkbench = Object.prototype.hasOwnProperty.call(importData, 'activeWorkbench')
      ? normalizeWorkbenchId(importData.activeWorkbench, getLegacyLoadWorkbenchDefault())
      : getLegacyLoadWorkbenchDefault();
    this.pmiViewsManager.setViews(importData.pmiViews || []);
    this.simulationStateManager.loadSerializable(importData.simulation || []);
    this.camPlanManager.loadSerializable(importData.cam || []);
    this.sheet2DManager.setSheets(importData.sheets2D || []);
    this.wireHarnessManager.loadSerializable(importData.wireHarness || []);
    this.metadataManager.metadata = importData.metadata || {};

    if (this.assemblyConstraintHistory) {
      this.assemblyConstraintHistory.setPartHistory(this);
      const constraintsList = Array.isArray(importData.assemblyConstraints)
        ? importData.assemblyConstraints
        : [];
      const constraintCounter = Number(importData.assemblyConstraintIdCounter) || 0;

      if (constraintsList.length > 0) {
        await this.assemblyConstraintHistory.replaceAll(constraintsList, constraintCounter);
      } else {
        this.assemblyConstraintHistory.clear();
        this.assemblyConstraintHistory.idCounter = constraintCounter;
      }
    }

    const skipUndoReset = !!(options && options.skipUndoReset);
    if (!skipUndoReset) {
      this.resetHistoryUndo();
      await this._commitHistorySnapshot({ force: true });
    }
  }

  async generateId(prefix) {
    this.idCounter += 1;
    return `${prefix}${this.idCounter}`;
  }

  resetHistoryUndo() {
    const state = this._historyUndo;
    if (!state) return;
    if (state.pendingTimer) {
      try { clearTimeout(state.pendingTimer); } catch { }
    }
    state.pendingTimer = null;
    state.undoStack = [];
    state.redoStack = [];
    state.lastSignature = null;
    state.captureInFlight = false;
    state.pendingRequest = false;
    state.isApplying = false;
  }

  queueHistorySnapshot(options: any = {}) {
    const state = this._historyUndo;
    if (!state || state.isApplying) return;
    const debounceMs = (typeof options.debounceMs === 'number')
      ? options.debounceMs
      : state.debounceMs;
    if (state.pendingTimer) {
      try { clearTimeout(state.pendingTimer); } catch { }
      state.pendingTimer = null;
    }
    if (debounceMs <= 0) {
      void this._commitHistorySnapshot({ force: !!options.force });
      return;
    }
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = null;
      void this._commitHistorySnapshot({ force: !!options.force });
    }, debounceMs);
  }

  async flushHistorySnapshot(options: any = {}) {
    const state = this._historyUndo;
    if (!state) return;
    if (state.pendingTimer) {
      try { clearTimeout(state.pendingTimer); } catch { }
      state.pendingTimer = null;
    }
    await this._commitHistorySnapshot({ force: !!options.force });
  }

  canUndoFeatureHistory() {
    const state = this._historyUndo;
    return !!(state && Array.isArray(state.undoStack) && state.undoStack.length > 1);
  }

  canRedoFeatureHistory() {
    const state = this._historyUndo;
    return !!(state && Array.isArray(state.redoStack) && state.redoStack.length > 0);
  }

  async undoFeatureHistory() {
    const state = this._historyUndo;
    if (!state || state.undoStack.length <= 1) return false;
    await this.flushHistorySnapshot();
    if (state.undoStack.length <= 1) return false;
    const current = state.undoStack.pop();
    if (current) state.redoStack.push(current);
    const prev = state.undoStack[state.undoStack.length - 1];
    if (!prev) return false;
    await this._applyHistorySnapshot(prev);
    return true;
  }

  async redoFeatureHistory() {
    const state = this._historyUndo;
    if (!state || state.redoStack.length === 0) return false;
    const next = state.redoStack.pop();
    if (!next) return false;
    state.undoStack.push(next);
    await this._applyHistorySnapshot(next);
    return true;
  }

  async _commitHistorySnapshot({ force = false } = {}) {
    const state = this._historyUndo;
    if (!state || state.isApplying) return;
    if (state.captureInFlight) {
      state.pendingRequest = true;
      return;
    }
    state.captureInFlight = true;
    try {
      const json = await this.toJSON({ includeCamGeneratedData: false });
      if (!json) return;
      if (!force && state.lastSignature === json) return;
      const snapshot = {
        json,
        currentHistoryStepId: this.currentHistoryStepId != null ? String(this.currentHistoryStepId) : null,
      };
      state.undoStack.push(snapshot);
      if (state.undoStack.length > state.max) state.undoStack.shift();
      state.redoStack.length = 0;
      state.lastSignature = json;
    } catch (error) {
      console.warn('[PartHistory] Failed to capture history snapshot:', error);
    } finally {
      state.captureInFlight = false;
      if (state.pendingRequest) {
        state.pendingRequest = false;
        await this._commitHistorySnapshot({ force: false });
      }
    }
  }

  async _applyHistorySnapshot(snapshot) {
    const state = this._historyUndo;
    if (!state || !snapshot || !snapshot.json) return;
    if (state.pendingTimer) {
      try { clearTimeout(state.pendingTimer); } catch { }
      state.pendingTimer = null;
    }
    state.isApplying = true;
    try {
      await this.fromJSON(snapshot.json, { skipUndoReset: true });
      this.currentHistoryStepId = snapshot.currentHistoryStepId != null ? String(snapshot.currentHistoryStepId) : null;
      await this.runHistory();
      state.lastSignature = snapshot.json;
    } catch (error) {
      console.warn('[PartHistory] Failed to apply history snapshot:', error);
    } finally {
      state.isApplying = false;
    }
  }

  async runAssemblyConstraints() {
    if (!this.assemblyConstraintHistory) return [];
    this.assemblyConstraintHistory.setPartHistory(this);
    return await this.assemblyConstraintHistory.runAll(this);
  }

  hasAssemblyComponents() {
    const features = Array.isArray(this.features) ? this.features : [];
    if (!features.length) return false;
    const normalize = (value) => {
      if (value === 0) return '0';
      if (value == null) return '';
      return String(value).trim().toUpperCase();
    };
    const targets = new Set([
      normalize(AssemblyComponentFeature?.shortName),
      normalize(AssemblyComponentFeature?.longName),
      normalize(AssemblyComponentFeature?.name),
    ]);
    targets.delete('');

    for (const feature of features) {
      if (!feature) continue;
      const rawType = feature?.type ?? feature?.inputParams?.type ?? null;
      const typeKey = normalize(rawType);
      if (typeKey && targets.has(typeKey)) return true;

      try {
        const FeatureClass = this.featureRegistry?.getSafe?.(rawType) || null;
        if (FeatureClass === AssemblyComponentFeature) return true;
        const resolvedKey = normalize(FeatureClass?.longName || FeatureClass?.shortName || FeatureClass?.name);
        if (resolvedKey && targets.has(resolvedKey)) return true;
      } catch { /* ignore unknown feature types */ }
    }

    return false;
  }

  syncAssemblyComponentTransforms() {
    if (!this.scene || !Array.isArray(this.features)) return;

    const featureById = new Map();
    for (const feature of this.features) {
      if (!feature || !feature.inputParams) continue;
      const id = resolveFeatureEntryId(feature);
      if (id == null) continue;
      featureById.set(String(id), feature);
    }

    const tempEuler = new THREE.Euler();

    const syncOne = (component) => {
      if (!component || !component.isAssemblyComponent) return;
      const featureIdRaw = component.owningFeatureID;
      if (!featureIdRaw && featureIdRaw !== 0) return;
      const feature = featureById.get(String(featureIdRaw));
      if (!feature) return;

      component.updateMatrixWorld?.(true);

      const pos = component.position || new THREE.Vector3();
      const quat = component.quaternion || new THREE.Quaternion();
      const scl = component.scale || new THREE.Vector3(1, 1, 1);

      tempEuler.setFromQuaternion(quat, 'XYZ');

      const transform = {
        position: [pos.x, pos.y, pos.z],
        rotationEuler: [
          THREE.MathUtils.radToDeg(tempEuler.x),
          THREE.MathUtils.radToDeg(tempEuler.y),
          THREE.MathUtils.radToDeg(tempEuler.z),
        ],
        scale: [scl.x, scl.y, scl.z],
      };

      feature.inputParams = feature.inputParams || {};
      feature.inputParams.transform = transform;
    };

    if (typeof this.scene.traverse === 'function') {
      this.scene.traverse((obj) => { syncOne(obj); });
    } else {
      const children = Array.isArray(this.scene.children) ? this.scene.children : [];
      for (const child of children) syncOne(child);
    }
  }

  async _collectAssemblyComponentUpdates() {
    if (!Array.isArray(this.features) || this.features.length === 0) {
      return [];
    }

    const updates = [];
    const targetName = String(AssemblyComponentFeature?.longName || AssemblyComponentFeature?.name || '').trim().toUpperCase();

    for (const feature of this.features) {
      if (!feature || !feature.type) continue;

      let FeatureClass = null;
      try {
        FeatureClass = this.featureRegistry?.getSafe?.(feature.type) || null;
      } catch {
        FeatureClass = null;
      }

      const isAssemblyComponent = FeatureClass === AssemblyComponentFeature
        || (FeatureClass && String(FeatureClass?.longName || FeatureClass?.name || '').trim().toUpperCase() === targetName);
      if (!isAssemblyComponent) continue;

      const componentName = feature?.inputParams?.componentName;
      if (!componentName) continue;
      const source = feature?.persistentData?.componentData || {};
      const sourceStorage = String(source.source || '').trim().toLowerCase() === 'github' ? 'github' : 'local';
      const repoFull = String(source.repoFull || '').trim();
      const branch = String(source.branch || '').trim();
      const path = String(source.path || componentName || '').trim();
      const record = await getComponentRecord(path || componentName, {
        source: sourceStorage,
        path: path || componentName,
        repoFull,
        branch,
      });
      if (!record || !record.data3mf) continue;

      const prevData = feature?.persistentData?.componentData?.data3mf || null;
      const prevSavedAt = feature?.persistentData?.componentData?.savedAt || null;
      const nextSavedAt = record.savedAt || null;

      const prevTime = prevSavedAt ? Date.parse(prevSavedAt) : NaN;
      const nextTime = nextSavedAt ? Date.parse(nextSavedAt) : NaN;

      const hasNewerTimestamp = Number.isFinite(nextTime) && (!Number.isFinite(prevTime) || nextTime > prevTime);
      const hasDifferentData = record.data3mf !== prevData;

      if (!hasNewerTimestamp && !hasDifferentData) continue;

      updates.push({
        feature,
        componentName,
        componentPath: path || componentName,
        sourceStorage,
        repoFull,
        branch,
        record,
        nextSavedAt,
      });
    }

    return updates;
  }

  async getOutdatedAssemblyComponentCount() {
    const updates = await this._collectAssemblyComponentUpdates();
    return updates.length;
  }

  async updateAssemblyComponents(options: any = {}) {
    const { rerun = true } = options || {};
    const updates = await this._collectAssemblyComponentUpdates();
    const updatedCount = updates.length;

    if (updatedCount === 0) {
      return { updatedCount: 0, reran: false };
    }

    for (const { feature, componentName, componentPath, sourceStorage, repoFull, branch, record, nextSavedAt } of updates) {
      let featureInfo = feature?.persistentData?.componentData?.featureInfo || null;
      try {
        const tempFeature = new AssemblyComponentFeature();
        if (typeof tempFeature._extractFeatureInfo === 'function') {
          const bytes = base64ToUint8Array(record.data3mf);
          if (bytes && bytes.length) {
            const info = await tempFeature._extractFeatureInfo(bytes);
            if (info) featureInfo = info;
          }
        }
      } catch (error) {
        console.warn('[PartHistory] Failed to extract feature info while updating component:', error);
      }

      feature.persistentData = feature.persistentData || {};
      const nextPath = String(record.path || componentPath || componentName || '').trim();
      const nextDisplayName = String(record.displayName || '').trim()
        || (nextPath.includes('/') ? nextPath.split('/').pop() : nextPath);
      feature.persistentData.componentData = {
        source: String(record.source || sourceStorage || '').trim().toLowerCase() === 'github' ? 'github' : 'local',
        name: nextPath || componentName,
        path: nextPath || componentName,
        folder: String(record.folder || '').trim(),
        displayName: nextDisplayName,
        repoFull: String(record.repoFull || repoFull || '').trim(),
        branch: String(record.branch || branch || '').trim(),
        savedAt: nextSavedAt,
        data3mf: record.data3mf,
        featureInfo: featureInfo || null,
      };

      feature.lastRunInputParams = null;
      feature.timestamp = Date.now();
    }

    let reran = false;
    if (rerun && typeof this.runHistory === 'function') {
      await this.runHistory();
      reran = true;
    }

    return { updatedCount, reran };
  }

  async newFeature(featureType) {
    const FeatureClass = (this.featureRegistry && typeof this.featureRegistry.getSafe === 'function')
      ? (this.featureRegistry.getSafe(featureType) || this.featureRegistry.get(featureType))
      : this.featureRegistry.get(featureType);
    const feature: any = {
      type: featureType,
      inputParams: await extractDefaultValues(FeatureClass.inputParamsSchema),
      persistentData: {}
    };
    feature.inputParams.id = await this.generateId(featureType);
    this.#linkFeatureParams(feature);
    if (FeatureClass === AssemblyComponentFeature) {
      const defaultInstanceName = String(feature.inputParams.id || '').trim();
      if (!String(feature.inputParams.instanceName || '').trim()) {
        feature.inputParams.instanceName = defaultInstanceName;
      }
    }
    // console.debug("New feature created:", feature.inputParams.id);
    this.features.push(feature);
    return feature;
  }

  // Removed unused reorderFeature

  async removeFeature(featureID) {
    if (featureID == null) return;
    const target = String(featureID);
    this.features = this.features.filter((f) => resolveFeatureEntryId(f) !== target);
  }



  async sanitizeInputParams(schema, inputParams) {

    let sanitized = {};
    const exprMap = (inputParams && typeof inputParams === 'object' && inputParams.__expr && typeof inputParams.__expr === 'object' && !Array.isArray(inputParams.__expr))
      ? inputParams.__expr
      : null;
    const exprSource = this.getExpressionsSource();
    const evalExpression = (equation) => {
      const fnBody = `${exprSource}; return ${equation} ;`;
      try {
        let result = Function(fnBody)();
        if (typeof result === 'string') {
          const num = Number(result);
          if (!Number.isNaN(num)) result = num;
        }
        return { ok: true, value: result };
      } catch {
        return { ok: false, value: null };
      }
    };
    const evaluateNumericValue = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim().length) {
        const result = PartHistory.evaluateExpressionSource(exprSource, value);
        if (typeof result === 'number' && Number.isFinite(result)) return result;
        const numericFromResult = Number(result);
        if (Number.isFinite(numericFromResult)) return numericFromResult;
      }
      const fallback = Number(value);
      return Number.isFinite(fallback) ? fallback : 0;
    };

    for (const key in schema) {
      //console.log(`Sanitizing ${key}:`, inputParams[key]);
      const hasExpr = !!(exprMap && Object.prototype.hasOwnProperty.call(exprMap, key));
      let exprValue = null;
      let exprOk = false;
      if (hasExpr) {
        const exprText = (exprMap[key] == null) ? '' : String(exprMap[key]);
        if (exprText.trim().length) {
          const res = evalExpression(exprText);
          exprOk = res.ok;
          exprValue = res.value;
        }
      }
      const rawValue = (hasExpr && exprOk) ? exprValue : inputParams[key];
      if (inputParams[key] !== undefined || hasExpr) {
        // check if the schema type is number
        if (schema[key].type === "number") {
          // if it is a string use the eval() function to do some math and return it as a number
          if (hasExpr && exprOk) {
            const num = Number(rawValue);
            sanitized[key] = Number.isFinite(num)
              ? num
              : evaluateNumericValue(inputParams[key]);
          } else {
            sanitized[key] = evaluateNumericValue(inputParams[key]);
          }
        } else if (schema[key].type === "string" && hasExpr && exprOk) {
          if (exprValue == null) sanitized[key] = '';
          else sanitized[key] = String(exprValue);
        } else if (schema[key].type === "string" && schema[key].allowExpression) {
          const raw = rawValue;
          const rawStr = (raw == null) ? '' : String(raw);
          if (rawStr.trim().length) {
            const res = evalExpression(rawStr);
            const result = res.ok ? res.value : null;
            if (result == null) sanitized[key] = rawStr;
            else sanitized[key] = String(result);
          } else {
            sanitized[key] = rawStr;
          }
        } else if (schema[key].type === "reference_selection") {
          // Resolve references by current scene name first; fall back to object refs
          // and preserve unresolved string refs for features that do their own mapping.
          const val = rawValue;
          if (Array.isArray(val)) {
            const arr = [];
            for (const it of val) {
              if (!it) continue;
              if (typeof it === 'object') {
                const liveSelection = this.#resolveLiveSelectionValue(it);
                if (liveSelection) arr.push(liveSelection);
                continue;
              }
              const refName = String(it);
              const obj = this.getObjectByName(refName);
              if (obj) arr.push(obj);
              else arr.push(refName);
            }
            sanitized[key] = arr;
          } else {
            if (!val) { sanitized[key] = []; }
            else if (typeof val === 'object') {
              const liveSelection = this.#resolveLiveSelectionValue(val);
              sanitized[key] = liveSelection ? [liveSelection] : [];
            }
            else {
              const refName = String(val);
              const obj = this.getObjectByName(refName);
              sanitized[key] = obj ? [obj] : [refName];
            }
          }

        } else if (schema[key].type === "boolean_operation") {
          // If it's a boolean operation, normalize op key and resolve targets to objects.
          // Also pass through optional biasDistance (numeric) and new sweep cap offset controls.
          const raw = rawValue || {};
          const op = raw.operation;
          const items = Array.isArray(raw.targets) ? raw.targets : [];
          const targets = [];
          for (const it of items) {
            if (!it) continue;
            if (typeof it === 'object') {
              const liveSelection = this.#resolveLiveSelectionValue(it);
              if (liveSelection && typeof liveSelection === 'object') targets.push(liveSelection);
              continue;
            }
            const obj = this.getObjectByName(String(it));
            if (obj) targets.push(obj);
          }
          const bias = Number(raw.biasDistance);
          const offsetCapFlag = (raw.offsetCoplanarCap != null) ? String(raw.offsetCoplanarCap) : undefined;
          const offsetDistance = Number(raw.offsetDistance);
          const out: any = {
            operation: op ?? 'NONE',
            targets,
            biasDistance: Number.isFinite(bias) ? bias : 0.1,
            overlapConditioningEnabled: raw.overlapConditioningEnabled !== false,
          };
          if (offsetCapFlag !== undefined) out.offsetCoplanarCap = offsetCapFlag;
          if (Number.isFinite(offsetDistance)) out.offsetDistance = offsetDistance;
          sanitized[key] = out;
        } else if (schema[key].type === "transform") {
          // Evaluate each component; allow expressions in position/rotation/scale entries
          const raw = rawValue || {};
          const evalOne = (v) => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string') return evaluateNumericValue(v);
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          };
          const pos = Array.isArray(raw.position) ? raw.position.map(evalOne) : [0, 0, 0];
          const rot = Array.isArray(raw.rotationEuler) ? raw.rotationEuler.map(evalOne) : [0, 0, 0];
          const scl = Array.isArray(raw.scale) ? raw.scale.map(evalOne) : [1, 1, 1];
          sanitized[key] = sanitizeTransformValue({
            position: pos,
            rotationEuler: rot,
            scale: scl,
            reference: raw.reference,
          });
        } else if (schema[key].type === "vec3") {
          // Evaluate vec3 entries; accept array [x,y,z] or object {x,y,z}
          const raw = rawValue;
          const evalOne = (v) => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string') return evaluateNumericValue(v);
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          };
          if (Array.isArray(raw)) {
            sanitized[key] = [evalOne(raw[0]), evalOne(raw[1]), evalOne(raw[2])];
          } else if (raw && typeof raw === 'object') {
            sanitized[key] = [evalOne(raw.x), evalOne(raw.y), evalOne(raw.z)];
          } else {
            sanitized[key] = [0, 0, 0];
          }
        } else if (schema[key].type === "boolean") {
          if (hasExpr && exprOk) {
            if (typeof exprValue === 'boolean') sanitized[key] = exprValue;
            else if (typeof exprValue === 'number') sanitized[key] = exprValue !== 0;
            else if (typeof exprValue === 'string') {
              const trimmed = exprValue.trim().toLowerCase();
              if (trimmed === 'true') sanitized[key] = true;
              else if (trimmed === 'false') sanitized[key] = false;
              else sanitized[key] = Boolean(exprValue);
            } else {
              sanitized[key] = Boolean(exprValue);
            }
          } else {
            sanitized[key] = Boolean(Object.prototype.hasOwnProperty.call(inputParams, key) ? inputParams[key] : schema[key].default_value);
          }
        } else if (schema[key].type === "options") {
          const optionValue = (option) => {
            if (option && typeof option === 'object') {
              return String(option.value ?? option.id ?? option.key ?? option.label ?? '');
            }
            return String(option);
          };
          const options = Array.isArray(schema[key].options) ? schema[key].options.map(optionValue) : [];
          const defaultValue = Object.prototype.hasOwnProperty.call(schema[key], 'default_value')
            ? schema[key].default_value
            : (options[0] ?? '');
          const candidate = rawValue == null ? defaultValue : rawValue;
          const candidateString = String(candidate);
          const defaultString = String(defaultValue ?? '');
          sanitized[key] = options.includes(candidateString)
            ? candidateString
            : (options.includes(defaultString) ? defaultString : (options[0] ?? defaultString));
        } else {
          sanitized[key] = rawValue;
        }
      } else {
        // Clone structured defaults to avoid shared references across features
        sanitized[key] = deepClone(schema[key].default_value);
      }
    }

    const params: any = sanitized;
    if (params && typeof params === 'object') {
      if (params.id == null && params.featureID != null) {
        params.id = params.featureID;
      }
      if (params.id != null && params.id !== '') {
        params.id = String(params.id);
      }
      if (!Object.getOwnPropertyDescriptor(params, 'featureID')) {
        Object.defineProperty(params, 'featureID', {
          configurable: true,
          enumerable: false,
          get: () => params.id,
          set: (value) => {
            params.id = value == null ? value : String(value);
          },
        });
      }
    }

    return sanitized;
  }
}

// Helper to extract default values using shared deepClone utility
export function extractDefaultValues(schema) {
  const result = {};
  for (const key in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, key)) {
      const def = schema[key] ? schema[key].default_value : undefined;
      result[key] = deepClone(def);
    }
  }
  return result;
}

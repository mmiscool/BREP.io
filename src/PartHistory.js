//
import * as THREE from 'three';


// Feature classes live in their own files; registry wires them up.
import { FeatureRegistry } from './FeatureRegistry.js';
import { SelectionFilter } from './UI/SelectionFilter.js';
import { MetadataManager } from './metadataManager.js';
import { AssemblyConstraintRegistry } from './assemblyConstraints/AssemblyConstraintRegistry.js';
import { AssemblyConstraintHistory } from './assemblyConstraints/AssemblyConstraintHistory.js';
import { AssemblyComponentFeature } from './features/assemblyComponent/AssemblyComponentFeature.js';
import { getComponentRecord, base64ToUint8Array } from './services/componentLibrary.js';
import { PMIViewsManager } from './pmi/PMIViewsManager.js';
import { deepClone } from './utils/deepClone.js';


const debug = false;

function resolveFeatureEntryId(entry, fallback = null) {
  if (!entry) return fallback;
  const params = entry.inputParams || {};
  const rawId = params.id ?? params.featureID ?? entry.id ?? fallback;
  if (rawId == null) return fallback;
  return String(rawId);
}


export class PartHistory {
  constructor() {
    this.features = [];
    this.scene = new THREE.Scene();
    this.idCounter = 0;
    this.featureRegistry = new FeatureRegistry();
    this.assemblyConstraintRegistry = new AssemblyConstraintRegistry();
    this.assemblyConstraintHistory = new AssemblyConstraintHistory(this, this.assemblyConstraintRegistry);
    this.callbacks = {};
    this.currentHistoryStepId = null;
    this.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;";
    this.pmiViewsManager = new PMIViewsManager(this);
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
      if (args[0]?.userData?.preventRemove) {
        console.log("Removal prevented by object flag.");
        return;
      }

      //console.trace();
      originalRemove.apply(this.scene, args);
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
      for (const value of Object.values(material)) {
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
      if (child?.userData?.preventRemove) continue;
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

  static evaluateExpression(expressionsSource, equation) {
    const exprSource = typeof expressionsSource === 'string' ? expressionsSource : '';
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

  evaluateExpression(equation) {
    return PartHistory.evaluateExpression(this.expressions, equation);
  }



  getObjectByName(name) {
    // traverse the scene to find an object with the given name
    return this.scene.getObjectByName(name);
  }

  // Removed: getObjectsByName (unused)

  async reset() {
    this.features = [];
    this.idCounter = 0;
    this.pmiViewsManager.reset();
    this.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;";
    // Reset MetadataManager
    this.metadataManager = new MetadataManager();
    this.currentHistoryStepId = null;

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

    this.resetHistoryUndo();
    await this._commitHistorySnapshot({ force: true });

    // sleep for a short duration to allow scene updates to complete
    //await new Promise(resolve => setTimeout(resolve, 1000));
    // console.log("PartHistory reset complete.");
  }

  async runHistory() {
    const whatStepToStopAt = this.currentHistoryStepId;

    this.#disposeSceneObjects((obj) => !obj?.isLight && !obj?.isCamera && !obj?.isTransformGizmo);
    await this.scene.clear();
  


    let skipAllFeatures = false;
    const features = Array.isArray(this.features) ? this.features : [];
    let previousFeatureTimestamp = features.length ? (features[0]?.timestamp ?? null) : null;
    const nowMs = () => (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now());
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      this.#linkFeatureParams(feature);
      const featureId = resolveFeatureEntryId(feature);
      if (skipAllFeatures) {
        continue;
      }

      const nextFeature = features[i + 1];

      if (whatStepToStopAt && featureId === whatStepToStopAt) {
        skipAllFeatures = true; // stop after this feature
      }

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
        const msg = `Feature type \"${feature.type}\" is not installed`;
        try { feature.lastRun = { ok: false, startedAt: t1, endedAt: t1, durationMs: 0, error: { name: 'MissingFeature', message: msg, stack: null } }; } catch { }
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

      // if the previous feature had a timestamp later than this feature, we mark this feature as dirty to ensure it gets re-run
      if (previousFeatureTimestamp != null && Number.isFinite(feature.timestamp) && previousFeatureTimestamp > feature.timestamp) {
        feature.dirty = true;
      }
      // if the inputParams have changed since last run, mark dirty
      if (JSON.stringify(feature.inputParams) !== feature.lastRunInputParams) feature.dirty = true;

      instance.inputParams = await this.sanitizeInputParams(FeatureClass.inputParamsSchema, feature.inputParams);
      try { this._captureReferencePreviewSnapshots(feature, FeatureClass.inputParamsSchema, instance.inputParams, instance.persistentData); } catch { }
      // check the timestamps of any objects referenced by reference_selection inputs; if any are newer than the feature timestamp, mark dirty
      for (const key in FeatureClass.inputParamsSchema) {
        if (Object.prototype.hasOwnProperty.call(FeatureClass.inputParamsSchema, key)) {
          const paramDef = FeatureClass.inputParamsSchema[key];
          if (paramDef.type === 'reference_selection') {
            const selected = Array.isArray(instance.inputParams[key]) ? instance.inputParams[key] : [];
            for (const obj of selected) {
              if (obj && typeof obj === 'object') {
                const objTime = Number(obj.timestamp);
                if (Number.isFinite(objTime) && (!Number.isFinite(feature.timestamp) || objTime > feature.timestamp)) {
                  feature.dirty = true;
                  break;
                }
              }
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


      // manually run the sketch feature and then test if the geometry has changed
      // if so, mark dirty
      const featureName = FeatureClass?.longName || FeatureClass?.shortName || FeatureClass?.name || '';
      if (featureName === 'Sketch') {
        try {
          instance.run(this);
          const sketchChanged = await instance.hasSketchChanged(feature);
          if (sketchChanged) feature.dirty = true;
        } catch (error) {
          console.warn('[PartHistory] Sketch change detection failed:', error);
          feature.dirty = true;
        }
      }

      if (feature.dirty) {
        if (debug) console.log("feature dirty");
        if (debug) console.log(`Running feature ${i + 1}/${features.length} (${featureId}) of type ${feature.type}...`, feature);
        // if this one is dirty, next one should be too (conservative)
        if (nextFeature) nextFeature.dirty = true;

        // Record the current input params as lastRunInputParams
        feature.lastRunInputParams = JSON.stringify(feature.inputParams);


        const t0 = nowMs();

        try {
          instance.resultArtifacts = await instance.run(this);
          feature.effects = {
            added: instance.resultArtifacts.added || [],
            removed: instance.resultArtifacts.removed || []
          }


          feature.timestamp = Date.now();
          previousFeatureTimestamp = feature.timestamp;

          const t1 = nowMs();
          const dur = Math.max(0, Math.round(t1 - t0));

          feature.lastRun = { ok: true, startedAt: t0, endedAt: t1, durationMs: dur, error: null };
          feature.dirty = false;
        } catch (e) {
          const t1 = nowMs();
          const dur = Math.max(0, Math.round(t1 - t0));
          feature.lastRun = { ok: false, startedAt: t0, endedAt: t1, durationMs: dur, error: { message: e?.message || String(e), name: e?.name || 'Error', stack: e?.stack || null } };
          feature.timestamp = Date.now();

          previousFeatureTimestamp = feature.timestamp;
          instance.errorString = `Error occurred while running feature ${featureId}: ${e.message}`;
          console.error(e);
          return;
        }
      }

      await this.applyFeatureEffects(feature.effects, featureId, feature);


      feature.persistentData = instance.persistentData;
    }

    try {
      await this.runAssemblyConstraints();
    } catch (error) {
      console.warn('[PartHistory] Assembly constraints run failed:', error);
    }

    // Do not clear currentHistoryStepId here. Keeping it preserves the UX of
    // "stop at the currently expanded feature" across subsequent runs. The
    // UI will explicitly clear it when no section is expanded.

    if (this.callbacks.afterRunHistory) {
      try { await this.callbacks.afterRunHistory(); } catch { /* ignore */ }
    }

    return this;
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
    if (!stores.length) return;
    const ensureBucket = (store, key) => {
      if (!store.__refPreviewSnapshots || typeof store.__refPreviewSnapshots !== 'object') {
        store.__refPreviewSnapshots = {};
      }
      if (!store.__refPreviewSnapshots[key] || typeof store.__refPreviewSnapshots[key] !== 'object') {
        store.__refPreviewSnapshots[key] = {};
      }
      return store.__refPreviewSnapshots[key];
    };

    const normalizeRefName = (obj) => {
      if (!obj) return null;
      const raw = obj.name != null ? String(obj.name).trim() : '';
      if (raw) return raw;
      const type = obj.type || 'OBJECT';
      const pos = obj.position || {};
      const x = Number.isFinite(pos.x) ? pos.x : 0;
      const y = Number.isFinite(pos.y) ? pos.y : 0;
      const z = Number.isFinite(pos.z) ? pos.z : 0;
      return `${type}(${x},${y},${z})`;
    };

    const extractEdgeWorldPositions = (obj) => {
      if (!obj) return [];
      try { obj.updateMatrixWorld?.(true); } catch { }
      try {
        if (typeof obj.points === 'function') {
          const pts = obj.points(true);
          if (Array.isArray(pts) && pts.length) {
            const flat = [];
            for (const p of pts) {
              if (!p) continue;
              const x = Number(p.x);
              const y = Number(p.y);
              const z = Number(p.z);
              if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
              flat.push(x, y, z);
            }
            if (flat.length >= 6) return flat;
          }
        }
      } catch { /* ignore */ }

      try {
        const geom = obj.geometry;
        const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
        if (!pos || pos.itemSize !== 3 || pos.count < 2) return [];
        const tmp = new THREE.Vector3();
        const flat = [];
        for (let i = 0; i < pos.count; i++) {
          tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
          tmp.applyMatrix4(obj.matrixWorld);
          flat.push(tmp.x, tmp.y, tmp.z);
        }
        return flat.length >= 6 ? flat : [];
      } catch { /* ignore */ }
      return [];
    };

    const extractFaceEdgePositions = (face) => {
      if (!face) return [];
      const out = [];
      const addEdge = (edge) => {
        const positions = extractEdgeWorldPositions(edge);
        if (positions && positions.length >= 6) out.push(positions);
      };

      if (Array.isArray(face.edges) && face.edges.length) {
        for (const edge of face.edges) addEdge(edge);
        return out;
      }

      const faceName = face?.name || face?.userData?.faceName || null;
      const parentSolid = face?.parentSolid || face?.userData?.parentSolid || face?.parent || null;
      if (!faceName || !parentSolid || !Array.isArray(parentSolid.children)) return out;
      for (const child of parentSolid.children) {
        if (!child || child.type !== SelectionFilter.EDGE) continue;
        const faceA = child?.userData?.faceA || null;
        const faceB = child?.userData?.faceB || null;
        if (faceA === faceName || faceB === faceName) {
          addEdge(child);
        }
      }
      return out;
    };

    for (const key in schema) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) continue;
      const def = schema[key];
      if (!def || def.type !== 'reference_selection') continue;
      const selected = Array.isArray(resolvedParams[key]) ? resolvedParams[key] : [];
      if (!selected.length) continue;
      const buckets = stores.map((store) => ensureBucket(store, key));
      for (const obj of selected) {
        if (!obj || typeof obj !== 'object') continue;
        const refName = normalizeRefName(obj);
        if (!refName) continue;
        const objType = String(obj.type || '').toUpperCase();
        const sourceUuid = obj.uuid || null;
        const sourceFeatureId = obj.owningFeatureID ?? null;
        const sourceTimestamp = (obj.timestamp ?? obj.userData?.timestamp ?? null);
        if (objType === SelectionFilter.EDGE || objType === 'EDGE') {
          const positions = extractEdgeWorldPositions(obj);
          if (positions && positions.length >= 6) {
            for (const bucket of buckets) {
              bucket[refName] = { type: 'EDGE', positions, sourceUuid, sourceFeatureId, sourceTimestamp };
            }
          }
        } else if (objType === SelectionFilter.FACE || objType === 'FACE' || objType === SelectionFilter.PLANE || objType === 'PLANE') {
          const edgePositions = extractFaceEdgePositions(obj);
          if (edgePositions && edgePositions.length) {
            const snapType = (objType === SelectionFilter.PLANE || objType === 'PLANE') ? 'PLANE' : 'FACE';
            for (const bucket of buckets) {
              bucket[refName] = { type: snapType, edgePositions, sourceUuid, sourceFeatureId, sourceTimestamp };
            }
          }
        } else if (objType === SelectionFilter.VERTEX || objType === 'VERTEX') {
          const pos = new THREE.Vector3();
          try {
            if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(pos);
            else pos.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
          } catch { }
          for (const bucket of buckets) {
            bucket[refName] = { type: 'VERTEX', position: [pos.x, pos.y, pos.z], sourceUuid, sourceFeatureId, sourceTimestamp };
          }
        }
      }
    }
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
      // Ensure any stale manifold/cache is dropped before visualizing
      try { await artifact.free(); } catch { }
      try { await artifact.visualize(); } catch { }

    }



    return { added, removed };
  }


  async applyFeatureEffects(effects, featureID, feature) {
    if (!effects || typeof effects !== 'object') return;
    const added = Array.isArray(effects.added) ? effects.added : [];
    const removed = Array.isArray(effects.removed) ? effects.removed : [];

    for (const r of removed) {
      await this._safeRemove(r);
    }

    for (const a of added) {
      if (a && typeof a === 'object') {
        if (a === this.scene) continue;
        // Free first to force rebuild from latest arrays, then visualize
        try { await a.free(); } catch { }
        try { await a.visualize(); } catch { }
        await this.scene.add(a);
        // make sure the flag for removal is cleared
        try { a.__removeFlag = false; } catch { }




        const applyTimeStampToChildrenRecursively = (obj, timestamp) => {
          if (!obj || typeof obj !== 'object') return;
          try { obj.timestamp = timestamp || Date.now(); } catch { }
          const children = Array.isArray(obj.children) ? obj.children : [];
          for (const child of children) {
            applyTimeStampToChildrenRecursively(child, timestamp);
          }
        };

        // attach the timestamp from the feature to the object for traceability
        try {
          a.timestamp = feature.timestamp;
          applyTimeStampToChildrenRecursively(a, feature.timestamp);
        } catch { }

      }
    }

    // apply the featureID to all added/removed items for traceability
    try { for (const obj of added) { if (obj) obj.owningFeatureID = featureID; } } catch { }
    try { for (const obj of removed) { if (obj) obj.owningFeatureID = featureID; } } catch { }


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
  async toJSON() {
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

    return JSON.stringify({
      features,
      idCounter: this.idCounter,
      expressions: this.expressions,
      pmiViews,
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

  async fromJSON(jsonString, options = {}) {
    const importData = JSON.parse(jsonString);
    const rawFeatures = Array.isArray(importData.features) ? importData.features : [];
    this.features = this.#prepareFeatureList(rawFeatures);
    this.idCounter = importData.idCounter;
    this.expressions = importData.expressions || "";
    this.pmiViewsManager.setViews(importData.pmiViews || []);
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

  queueHistorySnapshot(options = {}) {
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

  async flushHistorySnapshot(options = {}) {
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
      const json = await this.toJSON();
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

      const record = await getComponentRecord(componentName);
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

  async updateAssemblyComponents(options = {}) {
    const { rerun = true } = options || {};
    const updates = await this._collectAssemblyComponentUpdates();
    const updatedCount = updates.length;

    if (updatedCount === 0) {
      return { updatedCount: 0, reran: false };
    }

    for (const { feature, componentName, record, nextSavedAt } of updates) {
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
      feature.persistentData.componentData = {
        name: record.name || componentName,
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
    const feature = {
      type: featureType,
      inputParams: await extractDefaultValues(FeatureClass.inputParamsSchema),
      persistentData: {}
    };
    feature.inputParams.id = await this.generateId(featureType);
    this.#linkFeatureParams(feature);
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
    const evalExpression = (equation) => {
      const exprSource = typeof this.expressions === 'string' ? this.expressions : '';
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
              : PartHistory.evaluateExpression(this.expressions, inputParams[key]);
          } else {
            sanitized[key] = PartHistory.evaluateExpression(this.expressions, inputParams[key]);
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
          // Resolve references: accept objects directly or look up by name
          const val = rawValue;
          if (Array.isArray(val)) {
            const arr = [];
            for (const it of val) {
              if (!it) continue;
              if (typeof it === 'object') { arr.push(it); continue; }
              const obj = this.getObjectByName(String(it));
              if (obj) arr.push(obj);
            }
            sanitized[key] = arr;
          } else {
            if (!val) { sanitized[key] = []; }
            else if (typeof val === 'object') { sanitized[key] = [val]; }
            else {
              const obj = this.getObjectByName(String(val));
              sanitized[key] = obj ? [obj] : [];
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
            if (typeof it === 'object') { targets.push(it); continue; }
            const obj = this.getObjectByName(String(it));
            if (obj) targets.push(obj);
          }
          const bias = Number(raw.biasDistance);
          const offsetCapFlag = (raw.offsetCoplanarCap != null) ? String(raw.offsetCoplanarCap) : undefined;
          const offsetDistance = Number(raw.offsetDistance);
          const out = {
            operation: op ?? 'NONE',
            targets,
            biasDistance: Number.isFinite(bias) ? bias : 0.1,
          };
          if (offsetCapFlag !== undefined) out.offsetCoplanarCap = offsetCapFlag;
          if (Number.isFinite(offsetDistance)) out.offsetDistance = offsetDistance;
          sanitized[key] = out;
        } else if (schema[key].type === "transform") {
          // Evaluate each component; allow expressions in position/rotation/scale entries
          const raw = rawValue || {};
          const evalOne = (v) => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string') return PartHistory.evaluateExpression(this.expressions, v);
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
          };
          const pos = Array.isArray(raw.position) ? raw.position.map(evalOne) : [0, 0, 0];
          const rot = Array.isArray(raw.rotationEuler) ? raw.rotationEuler.map(evalOne) : [0, 0, 0];
          const scl = Array.isArray(raw.scale) ? raw.scale.map(evalOne) : [1, 1, 1];
          sanitized[key] = { position: pos, rotationEuler: rot, scale: scl };
        } else if (schema[key].type === "vec3") {
          // Evaluate vec3 entries; accept array [x,y,z] or object {x,y,z}
          const raw = rawValue;
          const evalOne = (v) => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string') return PartHistory.evaluateExpression(this.expressions, v);
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
        } else {
          sanitized[key] = rawValue;
        }
      } else {
        // Clone structured defaults to avoid shared references across features
        sanitized[key] = deepClone(schema[key].default_value);
      }
    }

    const params = sanitized;
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

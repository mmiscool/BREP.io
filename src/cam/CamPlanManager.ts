import { HistoryCollectionBase } from '../core/entities/HistoryCollectionBase.js';
import { deepClone } from '../utils/deepClone.js';
import {
  CAM_OPERATION_TYPE_SHADOW_CUTTER,
  ShadowCutterEntity,
} from './ShadowCutterEntity.js';
import {
  CAM_OPERATION_TYPE_ROUGHING,
  RoughingEntity,
} from './RoughingEntity.js';
import {
  CAM_OPERATION_TYPE_SURFACING,
  SurfacingEntity,
} from './SurfacingEntity.js';
import {
  combineCamToolpathPrograms,
  makeEmptyCamToolpathProgram,
  type CamToolpathProgram,
} from './CamToolpathDefinition.js';
import {
  clearCamDebugSliceSolids,
  syncCamDebugSliceSolids,
} from './CamDebugSliceSolids.js';
import {
  clearCamToolpathSimulatorOverlay,
} from './CamToolpathSimulator.js';
import {
  mergeCamMachineProfile,
  normalizeCamMachineProfile,
  type CamMachineProfile,
} from './CamMachineProfile.js';
import {
  mergeCamStockProfile,
  normalizeCamStockProfile,
  type CamStockProfile,
} from './CamStockProfile.js';

const DEFAULT_TYPE = CAM_OPERATION_TYPE_SHADOW_CUTTER;
const CAM_ENTITY_CLASSES = [ShadowCutterEntity, RoughingEntity, SurfacingEntity];
export const CAM_GENERATED_DATA_VERSION = 0;
const RESERVED_INPUT_KEYS = new Set(['type', 'persistentData', '__open']);

type CamEntity = any;
type CamSerializeOptions = {
  includeGeneratedData?: boolean;
};
type CamEntityConstructor = {
  new(options: { history: CamPlanManager; registry: unknown }): CamEntity;
  entityType?: string;
  type?: string;
  shortName?: string;
  inputParamsSchema?: Record<string, any>;
};
type CamListener = (payload: Record<string, any>, manager: CamPlanManager) => void;

export type CamGenerationProgressEvent = {
  phase?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  operationId?: string;
  operationName?: string;
  operationIndex?: number;
  operationCount?: number;
};
type CamGenerationProgressOptions = {
  onProgress?: (event: CamGenerationProgressEvent) => void;
};

function schemaOptionValue(option: unknown) {
  if (option && typeof option === 'object') {
    const source = option as Record<string, any>;
    return String(source.value ?? source.id ?? source.key ?? source.label ?? '');
  }
  return String(option);
}

function schemaOptionValues(def: any) {
  return Array.isArray(def?.options) ? def.options.map(schemaOptionValue) : [];
}

function plainRecordsEqual(left: Record<string, any>, right: Record<string, any>) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of keys) {
    if (!Object.is(left?.[key], right?.[key])) return false;
  }
  return true;
}

function serializableValuesEqual(left: any, right: any): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => serializableValuesEqual(value, right[index]));
  }
  if (
    left
    && right
    && typeof left === 'object'
    && typeof right === 'object'
    && Object.getPrototypeOf(left) === Object.prototype
    && Object.getPrototypeOf(right) === Object.prototype
  ) {
    return plainRecordsEqual(left, right);
  }
  return false;
}

function operationProgressPercent(operationIndex: number, operationFraction: number, operationCount: number) {
  const count = Math.max(1, operationCount);
  const clamped = Math.max(0, Math.min(1, operationFraction));
  return Math.round(5 + (((operationIndex + clamped) / count) * 85));
}

function yieldToProgressObservers() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      try {
        requestAnimationFrame(() => resolve());
        return;
      } catch {
        /* fall back to timer */
      }
    }
    setTimeout(resolve, 0);
  });
}

export class CamPlanManager extends HistoryCollectionBase {
  partHistory: any | null;
  machineProfile: CamMachineProfile;
  stockProfile: CamStockProfile;
  _lastCombinedPlan: CamToolpathProgram | null;
  _lastResults: CamToolpathProgram[];

  constructor(partHistory: any) {
    super({ viewer: null });
    this.partHistory = partHistory || null;
    this.machineProfile = normalizeCamMachineProfile(null);
    this.stockProfile = normalizeCamStockProfile(null);
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._registerAvailableEntries();
  }

  getOperations() {
    return this.entries;
  }

  getMachineProfile() {
    return normalizeCamMachineProfile(this.machineProfile);
  }

  setMachineProfile(profile: any) {
    const nextProfile = normalizeCamMachineProfile(profile);
    if (plainRecordsEqual(this.machineProfile, nextProfile)) return this.getMachineProfile();
    this.machineProfile = nextProfile;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._invalidateGeneratedOperationsForGlobalChange('machine-profile');
    this.notifyListeners({ reason: 'machine-profile', history: this, machineProfile: this.getMachineProfile() });
    return this.getMachineProfile();
  }

  updateMachineProfile(patch: any) {
    const nextProfile = mergeCamMachineProfile(this.machineProfile, patch);
    if (plainRecordsEqual(this.machineProfile, nextProfile)) return this.getMachineProfile();
    this.machineProfile = nextProfile;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._invalidateGeneratedOperationsForGlobalChange('machine-profile');
    this.notifyListeners({ reason: 'machine-profile', history: this, machineProfile: this.getMachineProfile() });
    return this.getMachineProfile();
  }

  getStockProfile() {
    return normalizeCamStockProfile(this.stockProfile);
  }

  setStockProfile(profile: any) {
    const nextProfile = normalizeCamStockProfile(profile);
    if (plainRecordsEqual(this.stockProfile, nextProfile)) return this.getStockProfile();
    this.stockProfile = nextProfile;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._invalidateGeneratedOperationsForGlobalChange('stock-profile');
    this.notifyListeners({ reason: 'stock-profile', history: this, stockProfile: this.getStockProfile() });
    return this.getStockProfile();
  }

  updateStockProfile(patch: any) {
    const nextProfile = mergeCamStockProfile(this.stockProfile, patch);
    if (plainRecordsEqual(this.stockProfile, nextProfile)) return this.getStockProfile();
    this.stockProfile = nextProfile;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._invalidateGeneratedOperationsForGlobalChange('stock-profile');
    this.notifyListeners({ reason: 'stock-profile', history: this, stockProfile: this.getStockProfile() });
    return this.getStockProfile();
  }

  createOperation(type = DEFAULT_TYPE, initialData = null) {
    const EntityClass = this._resolveHandler(type);
    if (!EntityClass) return null;
    const entity = new EntityClass({ history: this, registry: this.registry });
    entity.type = EntityClass.entityType || EntityClass.type || DEFAULT_TYPE;
    entity.entityType = entity.type;
    const defaults = this._defaultsFromSchema(EntityClass);
    const seed = deepClone(initialData || {});
    entity.setParams(this._sanitizeInputParamsForSchema(EntityClass, { ...defaults, ...seed, type: entity.type }));
    entity.setPersistentData(this._normalizeLoadedPersistentData(seed.persistentData || {}));
    delete entity.inputParams.persistentData;
    const id = entity.inputParams.id || this.generateId(entity.shortName || entity.type || 'CAM');
    entity.setId(id);
    entity.runtimeAttributes.__open = true;
    this._linkInputParams(entity);
    this.entries.push(entity);
    this._bumpIdCounterFrom(entity);
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this.notifyListeners({ reason: 'add', entry: entity, history: this });
    return entity;
  }

  generateOperation(entity: CamEntity, viewer: any = null) {
    const resolved = this._resolveEntry(entity);
    if (!resolved) return this._makeEmptyPlan(['No CAM operation was selected.']);
    if (resolved?.inputParams?.enabled === false) return this._makeEmptyPlan();
    if (typeof resolved.run !== 'function') {
      return this._makeEmptyPlan([`CAM operation ${resolved?.inputParams?.id || resolved?.id || ''} cannot generate a toolpath.`]);
    }
    try {
      return resolved.run(this._operationRunContext(viewer));
    } catch (error: any) {
      return this._makeEmptyPlan([String(error?.message || error || 'CAM operation failed.')]);
    }
  }

  async generateOperationAsync(entity: CamEntity, viewer: any = null, options: CamGenerationProgressOptions = {}) {
    const resolved = this._resolveEntry(entity);
    if (!resolved) return this._makeEmptyPlan(['No CAM operation was selected.']);
    if (resolved?.inputParams?.enabled === false) return this._makeEmptyPlan();
    if (typeof resolved.run !== 'function') {
      return this._makeEmptyPlan([`CAM operation ${resolved?.inputParams?.id || resolved?.id || ''} cannot generate a toolpath.`]);
    }
    try {
      const context: Record<string, any> = this._operationRunContext(viewer);
      context.onProgress = (event: CamGenerationProgressEvent = {}) => this._emitProgress(options, event);
      if (typeof resolved.runAsync === 'function') return await resolved.runAsync(context);
      return await resolved.run(context);
    } catch (error: any) {
      return this._makeEmptyPlan([String(error?.message || error || 'CAM operation failed.')]);
    }
  }

  generateAll(viewer: any = null) {
    this._clearDebugSliceSolids(viewer);
    const results: CamToolpathProgram[] = [];
    for (const entity of this.entries) {
      if (entity?.inputParams?.enabled === false) continue;
      results.push(this.generateOperation(entity, viewer));
    }
    this._lastResults = results;
    this._lastCombinedPlan = this._combineOperationResults(results);
    this._syncDebugSliceSolids(viewer, this._lastCombinedPlan);
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan, results });
    return this._lastCombinedPlan;
  }

  async generateAllAsync(viewer: any = null, options: CamGenerationProgressOptions = {}) {
    this._clearDebugSliceSolids(viewer);
    const enabled = this.entries.filter((entity) => entity?.inputParams?.enabled !== false);
    this._emitProgress(options, {
      phase: 'prepare',
      message: 'Preparing CAM generation',
      detail: `${enabled.length} enabled operation${enabled.length === 1 ? '' : 's'}.`,
      current: 0,
      total: 100,
    });
    await yieldToProgressObservers();
    const results: CamToolpathProgram[] = [];
    for (let index = 0; index < enabled.length; index += 1) {
      const entity = enabled[index];
      const operationId = String(entity?.inputParams?.id || entity?.id || '');
      const operationName = String(entity?.inputParams?.name || entity?.type || '');
      this._emitProgress(options, {
        phase: 'operation',
        message: `Generating ${operationName || 'CAM operation'}`,
        detail: operationId ? `Operation ${index + 1} of ${enabled.length}: ${operationId}` : `Operation ${index + 1} of ${enabled.length}`,
        current: operationProgressPercent(index, 0, enabled.length),
        total: 100,
        operationId,
        operationName,
        operationIndex: index,
        operationCount: enabled.length,
      });
      await yieldToProgressObservers();
      results.push(await this.generateOperationAsync(entity, viewer, {
        onProgress: (event) => {
          const childTotal = Math.max(1, Number(event.total) || 100);
          const childCurrent = Number.isFinite(Number(event.current)) ? Number(event.current) : 0;
          this._emitProgress(options, {
            ...event,
            current: operationProgressPercent(index, Math.max(0, Math.min(childTotal, childCurrent)) / childTotal, enabled.length),
            total: 100,
            operationId,
            operationName,
            operationIndex: index,
            operationCount: enabled.length,
          });
        },
      }));
      this._emitProgress(options, {
        phase: 'operation',
        message: `${operationName || 'CAM operation'} complete`,
        current: operationProgressPercent(index, 1, enabled.length),
        total: 100,
        operationId,
        operationName,
        operationIndex: index,
        operationCount: enabled.length,
      });
    }
    this._emitProgress(options, {
      phase: 'combine',
      message: 'Combining generated toolpaths',
      detail: `${results.length} operation result${results.length === 1 ? '' : 's'}.`,
      current: 90,
      total: 100,
    });
    await yieldToProgressObservers();
    this._lastResults = results;
    this._lastCombinedPlan = this._combineOperationResults(results);
    this._emitProgress(options, {
      phase: 'scene',
      message: 'Updating CAM scene overlays',
      current: 96,
      total: 100,
    });
    await yieldToProgressObservers();
    this._syncDebugSliceSolids(viewer, this._lastCombinedPlan);
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan, results });
    this._emitProgress(options, {
      phase: 'done',
      message: 'Toolpath generation complete',
      detail: `${Number(this._lastCombinedPlan?.summary?.pathCount ?? this._lastCombinedPlan?.paths?.length ?? 0) || 0} path${(Number(this._lastCombinedPlan?.summary?.pathCount ?? this._lastCombinedPlan?.paths?.length ?? 0) || 0) === 1 ? '' : 's'} generated.`,
      current: 100,
      total: 100,
    });
    return this._lastCombinedPlan;
  }

  invalidateOperation(entityOrId: any, reason = 'operation-edit') {
    const entity = this._resolveEntry(entityOrId);
    if (!entity) return false;
    const data = entity.persistentData && typeof entity.persistentData === 'object'
      ? { ...entity.persistentData }
      : {};
    const hadGeneratedData = this._hasGeneratedData(data);
    this._stripGeneratedPersistentData(data);
    data.invalidatedAt = new Date().toISOString();
    data.invalidatedReason = String(reason || 'operation-edit');
    entity.setPersistentData(data);
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._clearDebugSliceSolids();
    this.notifyListeners({ reason: 'invalidate', entry: entity, history: this, hadGeneratedData });
    return true;
  }

  getGeneratedResults() {
    return this._lastResults.slice();
  }

  getCombinedPlan() {
    if (this._lastCombinedPlan) return this._lastCombinedPlan;
    return this._makeEmptyPlan();
  }

  getCombinedGcode() {
    return this.getCombinedPlan()?.gcode || '';
  }

  clearSceneArtifacts(viewer: any = null) {
    const scene = this._resolveScene(viewer);
    const removedDebugSolids = this._clearDebugSliceSolids(viewer);
    const removedSimulatorOverlay = clearCamToolpathSimulatorOverlay(scene) ? 1 : 0;
    return removedDebugSolids + removedSimulatorOverlay;
  }

  loadSerializable(rawState: any) {
    this.entries = [];
    this._idCounter = 0;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._clearDebugSliceSolids();
    const state = (rawState && typeof rawState === 'object' && !Array.isArray(rawState))
      ? rawState
      : { operations: rawState };
    this.machineProfile = normalizeCamMachineProfile((state as any).machineProfile);
    this.stockProfile = normalizeCamStockProfile((state as any).stockProfile);
    const list = Array.isArray(state.operations) ? state.operations : [];
    for (const raw of list) {
      const entity = this._hydrateEntity(raw);
      if (!entity) continue;
      this.entries.push(entity);
      this._bumpIdCounterFrom(entity);
      this._linkInputParams(entity);
    }
    this.notifyListeners({ reason: 'load', history: this });
    return this.entries;
  }

  toSerializable(options: CamSerializeOptions = {}) {
    const includeGeneratedData = options.includeGeneratedData !== false;
    return {
      machineProfile: this.getMachineProfile(),
      stockProfile: this.getStockProfile(),
      operations: this.entries.map((entity) => {
        const open = Boolean(entity.runtimeAttributes?.__open);
        const EntityClass = this._resolveHandler(entity.type || entity.entityType || DEFAULT_TYPE);
        const input = this._compactSerializableInputParams(
          EntityClass,
          this._sanitizeInputParamsForSchema(EntityClass, deepClone(entity.inputParams || {})),
        );
        return {
          type: entity.type || DEFAULT_TYPE,
          inputParams: input,
          persistentData: this._serializablePersistentData(entity.persistentData || {}, { includeGeneratedData }),
          __open: open || undefined,
        };
      }),
    };
  }

  reset() {
    this.entries = [];
    this._idCounter = 0;
    this._lastCombinedPlan = null;
    this._lastResults = [];
    this._clearDebugSliceSolids();
    this.machineProfile = normalizeCamMachineProfile(null);
    this.stockProfile = normalizeCamStockProfile(null);
    this.notifyListeners({ reason: 'clear', history: this });
  }

  invalidateGeneratedOperations(reason = 'model-history') {
    return this._invalidateGeneratedOperationsForGlobalChange(String(reason || 'model-history'));
  }

  generateId(typeHint = 'CAM') {
    const prefix = String(typeHint || 'CAM').replace(/[^a-z0-9]/gi, '').toUpperCase() || 'CAM';
    const existing = new Set(this.entries.map((entry, index) => {
      const params = entry?.inputParams;
      if (params?.id) return String(params.id);
      if (entry?.id != null) return String(entry.id);
      return `CAM${index + 1}`;
    }));
    let candidate = '';
    do {
      this._idCounter += 1;
      candidate = `${prefix}${this._idCounter}`;
    } while (existing.has(candidate));
    return candidate;
  }

  addListener(listener: CamListener) {
    if (typeof listener !== 'function') return () => undefined;
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch { /* ignore listener cleanup errors */ }
    };
  }

  removeListener(listener: CamListener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch { /* ignore listener cleanup errors */ }
  }

  notifyListeners(payload = {}) {
    if (!(this._listeners instanceof Set)) return;
    for (const fn of Array.from(this._listeners)) {
      try { fn(payload, this); } catch { /* keep other listeners running */ }
    }
  }

  _operationRunContext(viewer: any = null) {
    const source = viewer && typeof viewer === 'object' ? viewer : {};
    const resolvedViewer = source.viewer || (source.scene ? source : viewer) || this.partHistory?.viewer || null;
    const partHistory = source.partHistory || resolvedViewer?.partHistory || this.partHistory || null;
    return {
      viewer: resolvedViewer,
      partHistory,
      machineProfile: normalizeCamMachineProfile(source.machineProfile || this.getMachineProfile()),
      stockProfile: normalizeCamStockProfile(source.stockProfile || this.getStockProfile()),
      manager: this,
    };
  }

  _resolveScene(viewer: any = null) {
    const resolvedViewer = viewer?.viewer || viewer || this.partHistory?.viewer || null;
    return resolvedViewer?.partHistory?.scene || resolvedViewer?.scene || this.partHistory?.scene || null;
  }

  _syncDebugSliceSolids(viewer: any = null, program: CamToolpathProgram | null = null) {
    return syncCamDebugSliceSolids({
      program,
      scene: this._resolveScene(viewer),
      partHistory: this.partHistory,
    });
  }

  _clearDebugSliceSolids(viewer: any = null) {
    return clearCamDebugSliceSolids(this._resolveScene(viewer), this.partHistory);
  }

  _makeEmptyPlan(warnings: string[] = []): CamToolpathProgram {
    return makeEmptyCamToolpathProgram({
      operationId: 'CAM-PROGRAM',
      operationName: 'CAM Program',
      machine: this.getMachineProfile(),
      warnings,
    });
  }

  _combineOperationResults(results: CamToolpathProgram[]): CamToolpathProgram {
    return combineCamToolpathPrograms({
      programs: results,
      machine: this.getMachineProfile(),
    });
  }

  _invalidateGeneratedOperationsForGlobalChange(reason: string) {
    let count = 0;
    for (const entity of this.entries || []) {
      const data = entity?.persistentData || {};
      if (!this._hasGeneratedData(data)) continue;
      if (this.invalidateOperation(entity, reason)) count += 1;
    }
    return count;
  }

  _hasGeneratedData(data: any) {
    return Boolean(data?.toolpath || data?.gcode || data?.summary || data?.generatedAt || data?.warnings || data?.generatorVersion);
  }

  _normalizeLoadedPersistentData(raw: any) {
    const source = raw && typeof raw === 'object' ? deepClone(raw) : {};
    if (!this._hasGeneratedData(source)) return source;
    this._stripGeneratedPersistentData(source);
    source.invalidatedAt = new Date().toISOString();
    source.invalidatedReason = 'cam-generation-removed';
    return source;
  }

  _stripGeneratedPersistentData(source: Record<string, any>) {
    delete source.toolpath;
    delete source.gcode;
    delete source.generatedAt;
    delete source.summary;
    delete source.warnings;
    delete source.generatorVersion;
    return source;
  }

  _serializablePersistentData(raw: any, options: { includeGeneratedData?: boolean } = {}) {
    const source = raw && typeof raw === 'object' ? deepClone(raw) : {};
    if (options.includeGeneratedData === false || this._hasGeneratedData(source)) {
      return this._stripGeneratedPersistentData(source);
    }
    return source;
  }

  _emitProgress(options: { onProgress?: (event: CamGenerationProgressEvent) => void } | null | undefined, event: CamGenerationProgressEvent) {
    const callback = options?.onProgress;
    if (typeof callback !== 'function') return;
    const total = Math.max(1, Number(event.total) || 100);
    const rawCurrent = Number(event.current);
    const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(total, rawCurrent)) : 0;
    try {
      callback({ ...event, current, total });
    } catch {
      /* progress observers should not stop CAM shell updates */
    }
  }

  _registerAvailableEntries() {
    for (const EntityClass of CAM_ENTITY_CLASSES) {
      try { this.registry.register(EntityClass); } catch { /* ignore duplicate registrations */ }
    }
  }

  _resolveHandler(type: unknown): CamEntityConstructor {
    const normalized = String(type || '').trim();
    if (!normalized) return ShadowCutterEntity;
    if (normalized === CAM_OPERATION_TYPE_ROUGHING || normalized === RoughingEntity.shortName) return RoughingEntity;
    if (normalized === CAM_OPERATION_TYPE_SURFACING || normalized === SurfacingEntity.shortName) return SurfacingEntity;
    if (normalized === DEFAULT_TYPE || normalized === ShadowCutterEntity.shortName) return ShadowCutterEntity;
    const resolved = this.registry?.resolve?.(normalized);
    if (resolved) return resolved;
    return ShadowCutterEntity;
  }

  _resolveEntry(entityOrId: any) {
    if (!entityOrId) return null;
    if (this.entries.includes(entityOrId)) return entityOrId;
    const id = String(entityOrId?.inputParams?.id || entityOrId?.id || entityOrId);
    return this.entries.find((entry) => String(entry?.inputParams?.id || entry?.id || '') === id) || null;
  }

  _defaultsFromSchema(EntityClass: CamEntityConstructor) {
    const out = {};
    const schema = EntityClass?.inputParamsSchema;
    if (!schema || typeof schema !== 'object') return out;
    for (const key of Object.keys(schema)) {
      if (RESERVED_INPUT_KEYS.has(key)) continue;
      const def = schema[key];
      if (!def || typeof def !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(def, 'default_value')) {
        out[key] = deepClone(def.default_value);
      }
    }
    return out;
  }

  _hydrateEntity(raw: unknown) {
    const source: Record<string, any> = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
    const EntityClass = this._resolveHandler(source.type || source.inputParams?.type || DEFAULT_TYPE);
    if (!EntityClass) return null;
    const entity = new EntityClass({ history: this, registry: this.registry });
    entity.type = EntityClass.entityType || EntityClass.type || DEFAULT_TYPE;
    entity.entityType = entity.type;
    const defaults = this._defaultsFromSchema(EntityClass);
    const params = this._sanitizeInputParamsForSchema(
      EntityClass,
      { ...defaults, ...this._cloneWithoutReserved(source.inputParams || source) },
    );
    if (!params.type) params.type = entity.type;
    entity.setParams(params);
    entity.setPersistentData(this._normalizeLoadedPersistentData(source.persistentData || {}));
    delete entity.inputParams.persistentData;
    const id = entity.inputParams.id || source.id || this.generateId(entity.shortName || entity.type);
    entity.setId(id);
    entity.runtimeAttributes.__open = Boolean(source.__open);
    this._linkInputParams(entity);
    return entity;
  }

  _cloneWithoutReserved(obj: unknown) {
    const out: Record<string, any> = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const key of Object.keys(obj)) {
      if (RESERVED_INPUT_KEYS.has(key)) continue;
      out[key] = deepClone(obj[key]);
    }
    return out;
  }

  _sanitizeInputParamsForSchema(EntityClass: CamEntityConstructor, params: unknown) {
    const source = params && typeof params === 'object' ? params as Record<string, any> : {};
    const schema = EntityClass?.inputParamsSchema && typeof EntityClass.inputParamsSchema === 'object'
      ? EntityClass.inputParamsSchema
      : {};
    const allowed = new Set(Object.keys(schema));
    const out: Record<string, any> = {};
    for (const key of Object.keys(source)) {
      if (RESERVED_INPUT_KEYS.has(key)) continue;
      if (!allowed.has(key) && key !== 'type') continue;
      const def = schema[key];
      if (def?.type === 'options') {
        const values = schemaOptionValues(def);
        const defaultValue = Object.prototype.hasOwnProperty.call(def, 'default_value')
          ? def.default_value
          : values[0];
        out[key] = values.includes(String(source[key])) ? source[key] : defaultValue;
        continue;
      }
      out[key] = deepClone(source[key]);
    }
    return out;
  }

  _compactSerializableInputParams(EntityClass: CamEntityConstructor, params: Record<string, any>) {
    const schema = EntityClass?.inputParamsSchema || {};
    const out: Record<string, any> = {};
    for (const key of Object.keys(params || {})) {
      if (key === 'type' || RESERVED_INPUT_KEYS.has(key)) continue;
      const def = schema[key];
      if (def && Object.prototype.hasOwnProperty.call(def, 'default_value')) {
        if (serializableValuesEqual(params[key], def.default_value)) continue;
      }
      out[key] = deepClone(params[key]);
    }
    return out;
  }

  _linkInputParams(entity: CamEntity) {
    const params = entity?.inputParams;
    if (!params || typeof params !== 'object') return;
    if (!params.id && entity?.id) params.id = entity.id;
    try {
      entity.setParams?.(params);
    } catch {
      entity.inputParams = params;
    }
  }

  _bumpIdCounterFrom(entity: CamEntity) {
    const raw = String(entity?.inputParams?.id || entity?.id || '');
    const match = raw.match(/(\d+)$/);
    if (!match) return;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > this._idCounter) this._idCounter = value;
  }
}

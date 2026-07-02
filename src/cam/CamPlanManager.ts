import { HistoryCollectionBase } from '../core/entities/HistoryCollectionBase.js';
import { deepClone } from '../utils/deepClone.js';
import { CAM_OPERATION_TYPE_3_AXIS, CamOperationEntity } from './CamOperationEntity.js';
import {
  CamToolpathResult,
  type CamToolpathProgressEvent,
  collectCamTargetMeshPayloads,
  combineCamToolpathResults,
  generateThreeAxisToolpath,
  generateThreeAxisToolpathAsync,
  getEarlyCamToolpathValidationWarnings,
} from './camToolpath.js';
import {
  canRunCamToolpathWorker,
  runCamToolpathWorker,
  type CamToolpathWorkerOperation,
} from './camToolpathWorkerClient.js';
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

const DEFAULT_TYPE = CAM_OPERATION_TYPE_3_AXIS;
export const CAM_GENERATED_DATA_VERSION = 2;
const RESERVED_INPUT_KEYS = new Set(['type', 'persistentData', '__open']);
const INTERNAL_OPERATION_INPUT_KEYS = new Set([
  'enableLineFilter',
  'enablePathOrdering',
  'maxDepth',
  'minSampling',
  'simplificationTolerance',
  'sampling',
  'preserveSimulationSamples',
  'waterlineSampling',
]);
const UNSERIALIZABLE_WORKER_PARAM = Symbol('UNSERIALIZABLE_WORKER_PARAM');

type CamEntity = any;
type CamGenerateOptions = {
  onProgress?: (event: CamToolpathProgressEvent) => void;
  progressYield?: () => Promise<void> | void;
  useWorker?: boolean;
  signal?: AbortSignal;
};
type CamSerializeOptions = {
  includeGeneratedToolpaths?: boolean;
  includeGeneratedData?: boolean;
};
type CamEntityConstructor = {
  new(options: { history: CamPlanManager; registry: unknown }): CamEntity;
  entityType?: string;
  type?: string;
  shortName?: string;
  inputParamsSchema?: Record<string, any>;
  uiFieldsTest?: (context?: Record<string, any>) => any;
};
type CamListener = (payload: Record<string, any>, manager: CamPlanManager) => void;

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

export class CamPlanManager extends HistoryCollectionBase {
  partHistory: any | null;
  _lastCombinedPlan: CamToolpathResult | null;
  machineProfile: CamMachineProfile;
  stockProfile: CamStockProfile;

  constructor(partHistory: any) {
    super({ viewer: null });
    this.partHistory = partHistory || null;
    this._lastCombinedPlan = null;
    this.machineProfile = normalizeCamMachineProfile(null);
    this.stockProfile = normalizeCamStockProfile(null);
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
    this._invalidateGeneratedOperationsForGlobalChange('machine-profile');
    this.notifyListeners({ reason: 'machine-profile', history: this, machineProfile: this.getMachineProfile() });
    return this.getMachineProfile();
  }

  updateMachineProfile(patch: any) {
    const nextProfile = mergeCamMachineProfile(this.machineProfile, patch);
    if (plainRecordsEqual(this.machineProfile, nextProfile)) return this.getMachineProfile();
    this.machineProfile = nextProfile;
    this._lastCombinedPlan = null;
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
    this._invalidateGeneratedOperationsForGlobalChange('stock-profile');
    this.notifyListeners({ reason: 'stock-profile', history: this, stockProfile: this.getStockProfile() });
    return this.getStockProfile();
  }

  updateStockProfile(patch: any) {
    const nextProfile = mergeCamStockProfile(this.stockProfile, patch);
    if (plainRecordsEqual(this.stockProfile, nextProfile)) return this.getStockProfile();
    this.stockProfile = nextProfile;
    this._lastCombinedPlan = null;
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
    entity.setPersistentData(seed.persistentData || {});
    delete entity.inputParams.persistentData;
    const id = entity.inputParams.id || this.generateId(entity.shortName || entity.type || 'CAM');
    entity.setId(id);
    entity.runtimeAttributes.__open = true;
    this._linkInputParams(entity);
    this.entries.push(entity);
    this._bumpIdCounterFrom(entity);
    this.notifyListeners({ reason: 'add', entry: entity, history: this });
    return entity;
  }

  generateOperation(entity: CamEntity, viewer: any = null) {
    if (!entity) return null;
    const result = generateThreeAxisToolpath(viewer || this.partHistory?.viewer || { partHistory: this.partHistory }, {
      ...(entity.inputParams || {}),
      machineProfile: this.machineProfile,
      stockProfile: this.stockProfile,
    });
    this._persistGeneratedOperation(entity, result);
    return result;
  }

  async generateOperationAsync(entity: CamEntity, viewer: any = null, options: CamGenerateOptions = {}) {
    if (!entity) return null;
    this._throwIfGenerationAborted(options);
    const result = await generateThreeAxisToolpathAsync(viewer || this.partHistory?.viewer || { partHistory: this.partHistory }, {
      ...(entity.inputParams || {}),
      machineProfile: this.machineProfile,
      stockProfile: this.stockProfile,
      onProgress: options.onProgress,
      progressYield: options.progressYield,
      signal: options.signal,
    });
    this._throwIfGenerationAborted(options);
    this._persistGeneratedOperation(entity, result);
    return result;
  }

  invalidateOperation(entityOrId: any, reason = 'operation-edit') {
    const entity = this._resolveEntry(entityOrId);
    if (!entity) return false;
    const data = entity.persistentData && typeof entity.persistentData === 'object'
      ? { ...entity.persistentData }
      : {};
    const hadGeneratedData = Boolean(data.toolpath || data.gcode || data.summary || data.generatedAt || data.warnings);
    delete data.toolpath;
    delete data.gcode;
    delete data.generatedAt;
    delete data.summary;
    delete data.warnings;
    delete data.generatorVersion;
    data.invalidatedAt = new Date().toISOString();
    data.invalidatedReason = String(reason || 'operation-edit');
    entity.setPersistentData(data);
    this._lastCombinedPlan = null;
    this.notifyListeners({ reason: 'invalidate', entry: entity, history: this, hadGeneratedData });
    return true;
  }

  generateAll(viewer: any = null) {
    const results: CamToolpathResult[] = [];
    for (const entity of this.entries) {
      if (entity?.inputParams?.enabled === false) continue;
      const result = this.generateOperation(entity, viewer);
      if (result) results.push(result);
    }
    this._lastCombinedPlan = combineCamToolpathResults(results, { machineProfile: this.machineProfile });
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan });
    return this._lastCombinedPlan;
  }

  async generateAllAsync(viewer: any = null, options: CamGenerateOptions = {}) {
    const enabled = this.entries.filter((entity) => entity?.inputParams?.enabled !== false);
    this._throwIfGenerationAborted(options);
    this._emitProgress(options, {
      phase: 'prepare',
      message: 'Preparing CAM operations',
      detail: `${enabled.length} enabled operation${enabled.length === 1 ? '' : 's'}.`,
      current: 0,
      total: 100,
    });
    await this._yieldProgress(options);

    if (options.useWorker !== false && canRunCamToolpathWorker()) {
      this._throwIfGenerationAborted(options);
      return this._generateAllAsyncInWorker(enabled, viewer, options);
    }

    return this._generateAllAsyncInProcess(enabled, viewer, options);
  }

  getGeneratedResults() {
    const results: CamToolpathResult[] = [];
    for (const entity of this.entries) {
      if (entity?.inputParams?.enabled === false) continue;
      if (!this._isCurrentGeneratedData(entity?.persistentData)) {
        if (this._hasGeneratedData(entity?.persistentData)) this.invalidateOperation(entity, 'cam-generator-version');
        continue;
      }
      const result = entity?.persistentData?.toolpath;
      if (result && Array.isArray(result.paths)) results.push(result);
    }
    return results;
  }

  getCombinedPlan() {
    if (this._lastCombinedPlan) return this._lastCombinedPlan;
    const results = this.getGeneratedResults();
    if (results.length === 1) return results[0];
    if (results.length > 1) {
      this._lastCombinedPlan = combineCamToolpathResults(results, { machineProfile: this.machineProfile });
      return this._lastCombinedPlan;
    }
    return combineCamToolpathResults([], { machineProfile: this.machineProfile });
  }

  getCombinedGcode() {
    return this.getCombinedPlan()?.gcode || '';
  }

  loadSerializable(rawState) {
    this.entries = [];
    this._idCounter = 0;
    this._lastCombinedPlan = null;
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
    const includeGeneratedToolpaths = options.includeGeneratedToolpaths !== false;
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
          persistentData: this._serializablePersistentData(entity.persistentData || {}, {
            includeGeneratedData,
            includeGeneratedToolpaths,
          }),
          __open: open || undefined,
        };
      }),
    };
  }

  reset() {
    this.entries = [];
    this._idCounter = 0;
    this._lastCombinedPlan = null;
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

  _persistGeneratedOperation(entity: CamEntity, result: CamToolpathResult | null) {
    if (!entity || !result) return;
    const persistent = entity.persistentData && typeof entity.persistentData === 'object'
      ? { ...entity.persistentData }
      : {};
    delete persistent.invalidatedAt;
    delete persistent.invalidatedReason;
    const versionedResult = {
      ...result,
      generatorVersion: CAM_GENERATED_DATA_VERSION,
    };
    entity.setPersistentData({
      ...persistent,
      toolpath: versionedResult,
      gcode: result.gcode,
      generatedAt: result.generatedAt,
      summary: result.summary,
      warnings: result.warnings,
      generatorVersion: CAM_GENERATED_DATA_VERSION,
    });
    this.notifyListeners({ reason: 'generate', entry: entity, history: this, result: versionedResult });
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

  _generatedDataVersion(data: any) {
    const version = Number(data?.generatorVersion ?? data?.toolpath?.generatorVersion);
    return Number.isFinite(version) ? version : 0;
  }

  _isCurrentGeneratedData(data: any) {
    if (!this._hasGeneratedData(data)) return false;
    return this._generatedDataVersion(data) === CAM_GENERATED_DATA_VERSION;
  }

  _normalizeLoadedPersistentData(raw: any) {
    const source = raw && typeof raw === 'object' ? deepClone(raw) : {};
    if (!this._hasGeneratedData(source) || this._isCurrentGeneratedData(source)) return source;
    this._stripGeneratedPersistentData(source);
    source.invalidatedAt = new Date().toISOString();
    source.invalidatedReason = 'cam-generator-version';
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

  _serializablePersistentData(raw: any, options: CamSerializeOptions = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (options.includeGeneratedData === false) {
      return this._stripGeneratedPersistentData(deepClone(source));
    }
    if (options.includeGeneratedToolpaths !== false) return deepClone(source);
    const out: Record<string, any> = {};
    for (const key of Object.keys(source)) {
      if (key === 'toolpath') continue;
      out[key] = deepClone(source[key]);
    }
    return out;
  }

  async _generateAllAsyncInWorker(
    enabled: CamEntity[],
    viewer: any = null,
    options: CamGenerateOptions = {},
  ) {
    this._emitProgress(options, {
      phase: 'worker-prepare',
      message: 'Preparing CAM worker job',
      detail: 'Serializing selected target meshes for worker generation.',
      current: 1,
      total: 100,
    });
    await this._yieldProgress(options);

    const operations = await this._buildWorkerOperations(enabled, viewer, options);
    this._throwIfGenerationAborted(options);
    let workerResult;
    try {
      workerResult = await runCamToolpathWorker({
        machineProfile: this.getMachineProfile(),
        stockProfile: this.getStockProfile(),
        operations,
      }, {
        onProgress: (event) => this._emitProgress(options, event),
        progressYield: options.progressYield,
        signal: options.signal,
      });
    } catch (error) {
      this._throwIfGenerationAborted(options);
      if (!this._shouldFallbackFromWorkerError(error)) throw error;
      this._emitProgress(options, {
        phase: 'worker-fallback',
        message: 'CAM worker unavailable',
        detail: 'Falling back to in-process CAM generation.',
        current: 3,
        total: 100,
      });
      await this._yieldProgress(options);
      return this._generateAllAsyncInProcess(enabled, viewer, {
        ...options,
        useWorker: false,
      });
    }
    this._throwIfGenerationAborted(options);

    const results = Array.isArray(workerResult?.operations) ? workerResult.operations : [];
    for (let index = 0; index < enabled.length; index += 1) {
      if (results[index]) this._persistGeneratedOperation(enabled[index], results[index]);
    }

    this._lastCombinedPlan = workerResult?.combined || combineCamToolpathResults(results, { machineProfile: this.machineProfile });
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan });
    return this._lastCombinedPlan;
  }

  async _generateAllAsyncInProcess(
    enabled: CamEntity[],
    viewer: any = null,
    options: CamGenerateOptions = {},
  ) {
    const results: CamToolpathResult[] = [];
    const operationCount = Math.max(1, enabled.length);
    const operationSpan = enabled.length ? 84 / operationCount : 0;
    for (let index = 0; index < enabled.length; index += 1) {
      const entity = enabled[index];
      const operationName = String(entity?.inputParams?.name || entity?.inputParams?.id || `Operation ${index + 1}`);
      this._emitProgress(options, {
        phase: 'operation',
        message: 'Generating CAM operation',
        detail: `${operationName} (${index + 1} of ${enabled.length})`,
        current: 4 + index * operationSpan,
        total: 100,
        operationIndex: index + 1,
        operationCount: enabled.length,
      });
      await this._yieldProgress(options);

      const result = await this.generateOperationAsync(entity, viewer, {
        progressYield: options.progressYield,
        signal: options.signal,
        onProgress: (event) => {
          const localTotal = Math.max(1, Number(event.total) || 100);
          const localCurrent = Math.max(0, Math.min(localTotal, Number(event.current) || 0));
          this._emitProgress(options, {
            ...event,
            current: 4 + index * operationSpan + (localCurrent / localTotal) * operationSpan,
            total: 100,
            operationId: String(entity?.inputParams?.id || event.operationId || ''),
            operationName,
            operationIndex: index + 1,
            operationCount: enabled.length,
          });
        },
      });
      this._throwIfGenerationAborted(options);
      if (result) results.push(result);
    }

    this._emitProgress(options, {
      phase: 'combine',
      message: 'Combining generated operations',
      detail: 'Building final program motion and G-code.',
      current: 90,
      total: 100,
    });
    await this._yieldProgress(options);

    this._throwIfGenerationAborted(options);
    this._lastCombinedPlan = combineCamToolpathResults(results, { machineProfile: this.machineProfile });
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan });

    this._emitProgress(options, {
      phase: 'complete',
      message: 'CAM generation complete',
      detail: `${this._lastCombinedPlan.summary.pathCount} path${this._lastCombinedPlan.summary.pathCount === 1 ? '' : 's'} generated.`,
      current: 95,
      total: 100,
    });
    return this._lastCombinedPlan;
  }

  _shouldFallbackFromWorkerError(error: any) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    if (name === 'AbortError' || /generation canceled|abort/i.test(message)) return false;
    return /worker|module|script|network|security|dataclone|serialization|clone/i.test(message);
  }

  async _buildWorkerOperations(
    enabled: CamEntity[],
    viewer: any = null,
    options: CamGenerateOptions = {},
  ): Promise<CamToolpathWorkerOperation[]> {
    const resolvedViewer = viewer || this.partHistory?.viewer || { partHistory: this.partHistory };
    const operations: CamToolpathWorkerOperation[] = [];
    const operationCount = Math.max(1, enabled.length);
    for (let index = 0; index < enabled.length; index += 1) {
      const entity = enabled[index];
      const params = this._workerParamsForEntity(entity);
      const operationName = String(params.name || params.id || `Operation ${index + 1}`);
      const earlyWarnings = getEarlyCamToolpathValidationWarnings({
        ...params,
        machineProfile: this.getMachineProfile(),
        stockProfile: this.getStockProfile(),
      });
      this._emitProgress(options, {
        phase: earlyWarnings.length ? 'worker-validation' : 'worker-mesh',
        message: earlyWarnings.length ? 'Validating CAM operation for worker' : 'Preparing target mesh for worker',
        detail: earlyWarnings.length
          ? `${operationName}: ${earlyWarnings.slice(0, 2).join(' ')}`
          : `${operationName} (${index + 1} of ${enabled.length})`,
        current: 1 + ((index + 1) / operationCount) * 2,
        total: 100,
        operationId: String(params.id || ''),
        operationName,
        operationIndex: index + 1,
        operationCount: enabled.length,
      });
      await this._yieldProgress(options);

      const payload = earlyWarnings.length
        ? { targets: [], targetCount: 0 }
        : collectCamTargetMeshPayloads(
          resolvedViewer,
          entity?.inputParams?.targetSolids,
          entity?.inputParams?.targetFaces,
        );
      delete params.targetSolids;
      delete params.targetFaces;
      params.targetMeshes = payload.targets;
      params.targetCount = payload.targetCount;
      delete params.machineProfile;
      delete params.stockProfile;
      operations.push({
        id: String(params.id || entity?.inputParams?.id || entity?.id || ''),
        name: operationName,
        params,
      });
    }
    return operations;
  }

  _workerParamsForEntity(entity: CamEntity) {
    const source = entity?.inputParams || {};
    const out: Record<string, any> = {};
    for (const key of Object.keys(source)) {
      if (RESERVED_INPUT_KEYS.has(key)) continue;
      const value = this._workerSerializableValue(source[key]);
      if (value !== UNSERIALIZABLE_WORKER_PARAM) out[key] = value;
    }
    return out;
  }

  _workerSerializableValue(value: any, seen = new Set<any>()): any {
    if (value == null) return value;
    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value;
    if (valueType === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : UNSERIALIZABLE_WORKER_PARAM;
    if (valueType !== 'object') return UNSERIALIZABLE_WORKER_PARAM;
    if (seen.has(value)) return UNSERIALIZABLE_WORKER_PARAM;

    if (ArrayBuffer.isView(value)) {
      const view = value as unknown as { length?: number; [index: number]: any };
      if (typeof view.length !== 'number') return UNSERIALIZABLE_WORKER_PARAM;
      const out: any[] = [];
      seen.add(value);
      for (let index = 0; index < view.length; index += 1) {
        const item = this._workerSerializableValue(view[index], seen);
        if (item !== UNSERIALIZABLE_WORKER_PARAM) out.push(item);
      }
      seen.delete(value);
      return out;
    }

    if (Array.isArray(value)) {
      const out: any[] = [];
      seen.add(value);
      for (const item of value) {
        const serializable = this._workerSerializableValue(item, seen);
        if (serializable !== UNSERIALIZABLE_WORKER_PARAM) out.push(serializable);
      }
      seen.delete(value);
      return out;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return UNSERIALIZABLE_WORKER_PARAM;
    const out: Record<string, any> = {};
    seen.add(value);
    for (const key of Object.keys(value)) {
      const serializable = this._workerSerializableValue(value[key], seen);
      if (serializable !== UNSERIALIZABLE_WORKER_PARAM) out[key] = serializable;
    }
    seen.delete(value);
    return out;
  }

  _emitProgress(options: CamGenerateOptions | null | undefined, event: CamToolpathProgressEvent) {
    const callback = options?.onProgress;
    if (typeof callback !== 'function') return;
    const total = Math.max(1, Number(event.total) || 100);
    const rawCurrent = Number(event.current);
    const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(total, rawCurrent)) : 0;
    try {
      callback({
        ...event,
        current,
        total,
      });
    } catch {
      /* progress observers should not stop CAM generation */
    }
  }

  async _yieldProgress(options: CamGenerateOptions | null | undefined) {
    this._throwIfGenerationAborted(options);
    const progressYield = options?.progressYield;
    if (typeof progressYield === 'function') {
      await progressYield();
      this._throwIfGenerationAborted(options);
      return;
    }
    await Promise.resolve();
    this._throwIfGenerationAborted(options);
  }

  _throwIfGenerationAborted(options: CamGenerateOptions | null | undefined) {
    const signal = options?.signal;
    if (!signal?.aborted) return;
    const reason = signal.reason;
    const error = new Error(String(reason?.message || reason || 'CAM generation canceled'));
    error.name = 'AbortError';
    throw error;
  }

  _registerAvailableEntries() {
    try { this.registry.register(CamOperationEntity); } catch { /* ignore duplicate registrations */ }
  }

  _resolveHandler(_type: unknown): CamEntityConstructor {
    return CamOperationEntity;
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
      if (!allowed.has(key) && key !== 'type' && !INTERNAL_OPERATION_INPUT_KEYS.has(key)) continue;
      const def = schema[key];
      if (def?.type === 'options') {
        const values = schemaOptionValues(def);
        const defaultValue = Object.prototype.hasOwnProperty.call(def, 'default_value')
          ? String(def.default_value ?? '')
          : (values[0] ?? '');
        const candidate = String(source[key] ?? defaultValue);
        out[key] = values.includes(candidate)
          ? candidate
          : (values.includes(defaultValue) ? defaultValue : (values[0] ?? defaultValue));
        continue;
      }
      out[key] = deepClone(source[key]);
    }
    return out;
  }

  _compactSerializableInputParams(EntityClass: CamEntityConstructor, params: Record<string, any>) {
    const input = params && typeof params === 'object' ? { ...params } : {};
    delete input.persistentData;
    delete input.__open;
    delete input.__entityRef;

    const defaults = this._sanitizeInputParamsForSchema(EntityClass, this._defaultsFromSchema(EntityClass));
    const excluded = this._uiExcludedKeysForParams(EntityClass, input);
    for (const key of excluded) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      if (serializableValuesEqual(input[key], defaults[key])) delete input[key];
    }
    return input;
  }

  _uiExcludedKeysForParams(EntityClass: CamEntityConstructor, params: Record<string, any>): Set<string> {
    const fn = EntityClass?.uiFieldsTest;
    if (typeof fn !== 'function') return new Set<string>();
    try {
      const result = fn.call(EntityClass, { params });
      const list = Array.isArray(result) ? result : (Array.isArray(result?.exclude) ? result.exclude : []);
      return new Set<string>(list.filter((key: any): key is string => typeof key === 'string' && key.length > 0));
    } catch {
      return new Set<string>();
    }
  }

  _linkInputParams(entity) {
    if (!entity) return;
    if (!entity.runtimeAttributes || typeof entity.runtimeAttributes !== 'object') {
      entity.runtimeAttributes = {};
    }
    const params = entity.inputParams || {};
    const descriptor = { configurable: true, enumerable: false };

    if (!Object.prototype.hasOwnProperty.call(params, '__entityRef')) {
      Object.defineProperty(params, '__entityRef', { ...descriptor, value: entity });
    }

    if (!Object.prototype.hasOwnProperty.call(params, 'persistentData')) {
      Object.defineProperty(params, 'persistentData', {
        ...descriptor,
        get: () => entity.persistentData,
        set: (value) => {
          const next = (value && typeof value === 'object') ? value : {};
          entity.setPersistentData(next);
        },
      });
    }

    if (!Object.prototype.hasOwnProperty.call(params, '__open')) {
      Object.defineProperty(params, '__open', {
        ...descriptor,
        get: () => Boolean(entity.runtimeAttributes.__open),
        set: (value) => {
          entity.runtimeAttributes.__open = Boolean(value);
        },
      });
    }

    params.type = entity.type || params.type || DEFAULT_TYPE;
    if (params.id == null && entity.id != null) {
      params.id = entity.id;
    }
  }

  _bumpIdCounterFrom(entity) {
    const id = entity?.inputParams?.id || entity?.id;
    if (!id) return;
    const match = String(id).match(/(\d+)$/);
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (Number.isFinite(num) && num > this._idCounter) {
      this._idCounter = num;
    }
  }
}

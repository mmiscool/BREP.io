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

const DEFAULT_TYPE = CAM_OPERATION_TYPE_3_AXIS;
const RESERVED_INPUT_KEYS = new Set(['type', 'persistentData', '__open']);

type CamEntity = any;
type CamGenerateOptions = {
  onProgress?: (event: CamToolpathProgressEvent) => void;
  progressYield?: () => Promise<void> | void;
  useWorker?: boolean;
};
type CamEntityConstructor = {
  new(options: { history: CamPlanManager; registry: unknown }): CamEntity;
  entityType?: string;
  type?: string;
  shortName?: string;
  inputParamsSchema?: Record<string, any>;
};
type CamListener = (payload: Record<string, any>, manager: CamPlanManager) => void;

export class CamPlanManager extends HistoryCollectionBase {
  partHistory: any | null;
  _lastCombinedPlan: CamToolpathResult | null;
  machineProfile: CamMachineProfile;

  constructor(partHistory: any) {
    super({ viewer: null });
    this.partHistory = partHistory || null;
    this._lastCombinedPlan = null;
    this.machineProfile = normalizeCamMachineProfile(null);
    this._registerAvailableEntries();
  }

  getOperations() {
    return this.entries;
  }

  getMachineProfile() {
    return normalizeCamMachineProfile(this.machineProfile);
  }

  setMachineProfile(profile: any) {
    this.machineProfile = normalizeCamMachineProfile(profile);
    this._lastCombinedPlan = null;
    this.notifyListeners({ reason: 'machine-profile', history: this, machineProfile: this.getMachineProfile() });
    return this.getMachineProfile();
  }

  updateMachineProfile(patch: any) {
    this.machineProfile = mergeCamMachineProfile(this.machineProfile, patch);
    this._lastCombinedPlan = null;
    this.notifyListeners({ reason: 'machine-profile', history: this, machineProfile: this.getMachineProfile() });
    return this.getMachineProfile();
  }

  createOperation(type = DEFAULT_TYPE, initialData = null) {
    const EntityClass = this._resolveHandler(type);
    if (!EntityClass) return null;
    const entity = new EntityClass({ history: this, registry: this.registry });
    entity.type = EntityClass.entityType || EntityClass.type || DEFAULT_TYPE;
    entity.entityType = entity.type;
    const defaults = this._defaultsFromSchema(EntityClass);
    const seed = deepClone(initialData || {});
    entity.setParams({ ...defaults, ...seed, type: entity.type });
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
    });
    this._persistGeneratedOperation(entity, result);
    return result;
  }

  async generateOperationAsync(entity: CamEntity, viewer: any = null, options: CamGenerateOptions = {}) {
    if (!entity) return null;
    const result = await generateThreeAxisToolpathAsync(viewer || this.partHistory?.viewer || { partHistory: this.partHistory }, {
      ...(entity.inputParams || {}),
      machineProfile: this.machineProfile,
      onProgress: options.onProgress,
      progressYield: options.progressYield,
    });
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
    this._emitProgress(options, {
      phase: 'prepare',
      message: 'Preparing CAM operations',
      detail: `${enabled.length} enabled operation${enabled.length === 1 ? '' : 's'}.`,
      current: 0,
      total: 100,
    });
    await this._yieldProgress(options);

    if (options.useWorker !== false && canRunCamToolpathWorker()) {
      return this._generateAllAsyncInWorker(enabled, viewer, options);
    }

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

  getGeneratedResults() {
    const results: CamToolpathResult[] = [];
    for (const entity of this.entries) {
      if (entity?.inputParams?.enabled === false) continue;
      const result = entity?.persistentData?.toolpath;
      if (result && Array.isArray(result.paths)) results.push(result);
    }
    return results;
  }

  getCombinedPlan() {
    if (this._lastCombinedPlan) return this._lastCombinedPlan;
    const results = this.getGeneratedResults();
    if (results.length === 1) return results[0];
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

  toSerializable() {
    return {
      machineProfile: this.getMachineProfile(),
      operations: this.entries.map((entity) => {
        const open = Boolean(entity.runtimeAttributes?.__open);
        const input = this._sanitizeInputParamsForSchema(
          this._resolveHandler(entity.type || entity.entityType || DEFAULT_TYPE),
          deepClone(entity.inputParams || {}),
        );
        if (input && typeof input === 'object') {
          delete input.persistentData;
          delete input.__open;
          delete input.__entityRef;
        }
        return {
          type: entity.type || DEFAULT_TYPE,
          inputParams: input,
          persistentData: deepClone(entity.persistentData || {}),
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
    this.notifyListeners({ reason: 'clear', history: this });
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
    entity.setPersistentData({
      ...persistent,
      toolpath: result,
      gcode: result.gcode,
      generatedAt: result.generatedAt,
      summary: result.summary,
      warnings: result.warnings,
    });
    this.notifyListeners({ reason: 'generate', entry: entity, history: this, result });
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
    const workerResult = await runCamToolpathWorker({
      machineProfile: this.getMachineProfile(),
      operations,
    }, {
      onProgress: (event) => this._emitProgress(options, event),
      progressYield: options.progressYield,
    });

    const results = Array.isArray(workerResult?.operations) ? workerResult.operations : [];
    for (let index = 0; index < enabled.length; index += 1) {
      if (results[index]) this._persistGeneratedOperation(enabled[index], results[index]);
    }

    this._lastCombinedPlan = workerResult?.combined || combineCamToolpathResults(results, { machineProfile: this.machineProfile });
    this.notifyListeners({ reason: 'generate-all', history: this, result: this._lastCombinedPlan });
    return this._lastCombinedPlan;
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
      this._emitProgress(options, {
        phase: 'worker-mesh',
        message: 'Preparing target mesh for worker',
        detail: `${operationName} (${index + 1} of ${enabled.length})`,
        current: 1 + ((index + 1) / operationCount) * 2,
        total: 100,
        operationId: String(params.id || ''),
        operationName,
        operationIndex: index + 1,
        operationCount: enabled.length,
      });
      await this._yieldProgress(options);

      const payload = collectCamTargetMeshPayloads(resolvedViewer, entity?.inputParams?.targetSolids);
      delete params.targetSolids;
      params.targetMeshes = payload.targets;
      params.targetCount = payload.targetCount;
      params.machineProfile = this.getMachineProfile();
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
      try {
        out[key] = deepClone(source[key]);
      } catch {
        out[key] = source[key];
      }
    }
    return out;
  }

  _emitProgress(options: CamGenerateOptions | null | undefined, event: CamToolpathProgressEvent) {
    const callback = options?.onProgress;
    if (typeof callback !== 'function') return;
    try { callback(event); } catch { /* progress observers should not stop CAM generation */ }
  }

  async _yieldProgress(options: CamGenerateOptions | null | undefined) {
    const progressYield = options?.progressYield;
    if (typeof progressYield === 'function') {
      await progressYield();
      return;
    }
    await Promise.resolve();
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
    const params = this._sanitizeInputParamsForSchema(
      EntityClass,
      this._cloneWithoutReserved(source.inputParams || source),
    );
    if (!params.type) params.type = entity.type;
    entity.setParams(params);
    entity.setPersistentData(deepClone(source.persistentData || {}));
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
      out[key] = deepClone(source[key]);
    }
    return out;
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

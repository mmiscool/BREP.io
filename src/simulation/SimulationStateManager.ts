import { HistoryCollectionBase } from '../core/entities/HistoryCollectionBase.js';
import { deepClone } from '../utils/deepClone.js';
import { LinearMotionEntity } from './LinearMotionEntity.js';
import { RotationMotionEntity } from './RotationMotionEntity.js';

const DEFAULT_TYPE = 'rotation';
const RESERVED_INPUT_KEYS = new Set(['type', 'persistentData', '__open']);

type SimulationEntity = any;
type SimulationEntityConstructor = {
  new(options: { history: SimulationStateManager; registry: unknown }): SimulationEntity;
  entityType?: string;
  type?: string;
  shortName?: string;
  inputParamsSchema?: Record<string, any>;
};
type SimulationListener = (payload: Record<string, any>, manager: SimulationStateManager) => void;

export class SimulationStateManager extends HistoryCollectionBase {
  partHistory: any | null;

  constructor(partHistory: any) {
    super({ viewer: null });
    this.partHistory = partHistory || null;
    this._registerAvailableEntries();
  }

  getMotions() {
    return this.entries;
  }

  createMotion(type = DEFAULT_TYPE, initialData = null) {
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
    const id = entity.inputParams.id || this.generateId(entity.shortName || entity.type || 'SIM');
    entity.setId(id);
    entity.runtimeAttributes.__open = true;
    this._linkInputParams(entity);
    this.entries.push(entity);
    this._bumpIdCounterFrom(entity);
    this.notifyListeners({ reason: 'add', entry: entity, history: this });
    return entity;
  }

  loadSerializable(rawState) {
    this.entries = [];
    this._idCounter = 0;
    const state = (rawState && typeof rawState === 'object' && !Array.isArray(rawState))
      ? rawState
      : { motions: rawState };
    const list = Array.isArray(state.motions) ? state.motions : [];
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
      motions: this.entries.map((entity) => {
        const open = Boolean(entity.runtimeAttributes?.__open);
        const input = deepClone(entity.inputParams || {});
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
    this.notifyListeners({ reason: 'clear', history: this });
  }

  generateId(typeHint = 'SIM') {
    const prefix = String(typeHint || 'SIM').replace(/[^a-z0-9]/gi, '').toUpperCase() || 'SIM';
    const existing = new Set(this.entries.map((entry, index) => {
      const params = entry?.inputParams;
      if (params?.id) return String(params.id);
      if (entry?.id != null) return String(entry.id);
      return `SIM${index + 1}`;
    }));
    let candidate = '';
    do {
      this._idCounter += 1;
      candidate = `${prefix}${this._idCounter}`;
    } while (existing.has(candidate));
    return candidate;
  }

  addListener(listener: SimulationListener) {
    if (typeof listener !== 'function') return () => undefined;
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch { /* ignore listener cleanup errors */ }
    };
  }

  removeListener(listener: SimulationListener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch { /* ignore listener cleanup errors */ }
  }

  notifyListeners(payload = {}) {
    if (!(this._listeners instanceof Set)) return;
    for (const fn of Array.from(this._listeners)) {
      try { fn(payload, this); } catch { /* keep other listeners running */ }
    }
  }

  _registerAvailableEntries() {
    for (const Handler of [RotationMotionEntity, LinearMotionEntity]) {
      try { this.registry.register(Handler); } catch { /* ignore duplicate registrations */ }
    }
  }

  _resolveHandler(type: unknown): SimulationEntityConstructor {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'linear') return LinearMotionEntity;
    return RotationMotionEntity;
  }

  _defaultsFromSchema(EntityClass: SimulationEntityConstructor) {
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
    const params = this._cloneWithoutReserved(source.inputParams || source);
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

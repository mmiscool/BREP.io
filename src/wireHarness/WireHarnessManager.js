import { deepClone } from '../utils/deepClone.js';

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeConnection(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackNumber = Number.isInteger(index) ? index + 1 : 1;
  const id = normalizeText(source.id, `wire-${fallbackNumber}`);
  return {
    id,
    name: normalizeText(source.name, `Wire ${fallbackNumber}`),
    from: normalizeText(source.from, ''),
    to: normalizeText(source.to, ''),
    diameter: Math.max(0.01, toFiniteNumber(source.diameter, 1)),
  };
}

export class WireHarnessManager {
  constructor(partHistory) {
    this.partHistory = partHistory || null;
    this.connections = [];
    this.routeResults = [];
    this._listeners = new Set();
  }

  reset() {
    this.connections = [];
    this.routeResults = [];
    this._emit();
  }

  getConnections() {
    this._normalizeConnectionsArray(this.connections);
    return this.connections;
  }

  setConnections(rawConnections) {
    const list = Array.isArray(rawConnections) ? Array.from(rawConnections) : [];
    this.connections = list;
    this._normalizeConnectionsArray(this.connections);
    this._emit();
    return this.connections;
  }

  addConnection(connection = {}) {
    const list = this.getConnections();
    const normalized = normalizeConnection({
      id: connection?.id || this._generateConnectionId(),
      ...connection,
    }, list.length);
    list.push(normalized);
    this._emit();
    return normalized;
  }

  updateConnection(connectionId, updater) {
    const list = this.getConnections();
    const id = normalizeText(connectionId, '');
    const index = list.findIndex((connection) => String(connection?.id || '') === id);
    if (index < 0) return null;
    const current = list[index];
    let next = current;
    if (typeof updater === 'function') {
      try {
        const result = updater(deepClone(current));
        if (result && typeof result === 'object') next = result;
      } catch {
        next = current;
      }
    } else if (updater && typeof updater === 'object') {
      next = { ...current, ...updater };
    }
    list[index] = normalizeConnection(next, index);
    if (!list[index].id) list[index].id = current.id;
    this._emit();
    return list[index];
  }

  removeConnection(connectionId) {
    const list = this.getConnections();
    const id = normalizeText(connectionId, '');
    const index = list.findIndex((connection) => String(connection?.id || '') === id);
    if (index < 0) return null;
    const [removed] = list.splice(index, 1);
    this.routeResults = this.routeResults.filter((entry) => String(entry?.connectionId || '') !== id);
    this._normalizeConnectionsArray(list);
    this._emit();
    return removed || null;
  }

  getRouteResults() {
    return Array.isArray(this.routeResults) ? this.routeResults : [];
  }

  setRouteResults(results) {
    this.routeResults = Array.isArray(results) ? results.map((entry) => ({ ...(entry || {}) })) : [];
    this._emit();
    return this.routeResults;
  }

  clearRouteResults() {
    this.routeResults = [];
    this._emit();
  }

  getRouteResultMap() {
    const map = new Map();
    for (const entry of this.getRouteResults()) {
      const key = normalizeText(entry?.connectionId, '');
      if (!key) continue;
      map.set(key, entry);
    }
    return map;
  }

  addListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch { /* ignore */ }
    };
  }

  removeListener(listener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch { /* ignore */ }
  }

  notifyChanged() {
    this._emit();
  }

  toSerializable() {
    return this.getConnections().map((connection) => deepClone(connection));
  }

  _generateConnectionId() {
    const ids = new Set(this.getConnections().map((connection) => String(connection?.id || '')));
    let index = 1;
    while (ids.has(`wire-${index}`)) index += 1;
    return `wire-${index}`;
  }

  _normalizeConnectionsArray(arrayRef) {
    if (!Array.isArray(arrayRef)) {
      this.connections = [];
      return this.connections;
    }
    for (let index = 0; index < arrayRef.length; index += 1) {
      arrayRef[index] = normalizeConnection(arrayRef[index], index);
    }
    return arrayRef;
  }

  _emit() {
    if (!this._listeners || this._listeners.size === 0) return;
    const payload = {
      connections: this.getConnections(),
      routeResults: this.getRouteResults(),
      manager: this,
      partHistory: this.partHistory || null,
    };
    for (const listener of Array.from(this._listeners)) {
      try { listener(payload); } catch { /* ignore */ }
    }
  }
}

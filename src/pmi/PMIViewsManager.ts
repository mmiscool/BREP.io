// PMIViewsManager.js
// Encapsulates storage and lifecycle for PMI views associated with a PartHistory instance.

import { deepClone } from '../utils/deepClone.js';

type PMIVisibilityEntry = {
  key?: unknown;
  count?: unknown;
};

type PMIView = {
  name?: string;
  viewName?: string;
  annotations?: unknown[];
  camera?: {
    viewport?: {
      width?: unknown;
      height?: unknown;
    };
    [key: string]: unknown;
  };
  viewSettings?: {
    pmiTextSizePt?: number;
    visibilityState?: {
      hidden?: PMIVisibilityEntry[];
    };
    [key: string]: unknown;
  };
  annotationHistory?: unknown;
  [key: string]: unknown;
};

type PMIViewsListener = (views: PMIView[], partHistory: unknown | null) => void;

export class PMIViewsManager {
  partHistory: unknown | null;
  views: PMIView[];
  private _listeners: Set<PMIViewsListener>;

  constructor(partHistory) {
    this.partHistory = partHistory || null;
    this.views = [];
    this._listeners = new Set();
  }

  reset() {
    this.views = [];
    this._emit();
  }

  getViews() {
    this._normalizeViewsArray(this.views);
    return this.views;
  }

  setViews(views) {
    const arr = Array.isArray(views) ? Array.from(views) : [];
    this.views = arr;
    this._normalizeViewsArray(this.views);
    this._emit();
    return this.views;
  }

  addView(view) {
    const list = this.getViews();
    const normalized = this._normalizeView(view, list.length);
    list.push(normalized);
    this._emit();
    return normalized;
  }

  updateView(index, updater) {
    const list = this.getViews();
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return null;
    const current = list[idx];
    let next = current;
    if (typeof updater === 'function') {
      try {
        const result = updater(current);
        if (result && typeof result === 'object') {
          next = result;
        }
      } catch {
        // ignore updater errors
      }
    } else if (updater && typeof updater === 'object' && updater !== current) {
      next = Object.assign({}, current, updater);
    }
    if (next !== current) {
      list[idx] = next;
    }
    list[idx] = this._normalizeView(list[idx], idx);
    this._emit();
    return list[idx];
  }

  removeView(index) {
    const list = this.getViews();
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return null;
    const [removed] = list.splice(idx, 1);
    for (let i = 0; i < list.length; i++) {
      list[i] = this._normalizeView(list[i], i);
    }
    this._emit();
    return removed || null;
  }

  addListener(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch {
        // Ignore listener cleanup failures.
      }
    };
  }

  removeListener(listener) {
    if (typeof listener !== 'function') return;
    try { this._listeners.delete(listener); } catch {
      // Ignore listener cleanup failures.
    }
  }

  notifyChanged() {
    this._emit();
  }

  toSerializable() {
    return this.getViews().map(view => deepClone(view));
  }

  _normalizeViewsArray(arrayRef) {
    if (!Array.isArray(arrayRef)) {
      this.views = [];
      return this.views;
    }
    for (let i = 0; i < arrayRef.length; i++) {
      arrayRef[i] = this._normalizeView(arrayRef[i], i);
    }
    return arrayRef;
  }

  _normalizeView(raw, index) {
    const fallbackIndex = Number.isInteger(index) ? index : 0;
    const view = (raw && typeof raw === 'object') ? raw : {};
    const legacyName = typeof view.name === 'string' ? view.name.trim() : '';
    const currentName = typeof view.viewName === 'string' ? view.viewName.trim() : '';
    const finalName = currentName || legacyName || `View ${fallbackIndex + 1}`;
    view.viewName = finalName;
    view.name = finalName;

    if (!Array.isArray(view.annotations)) view.annotations = [];
    if (!view.camera || typeof view.camera !== 'object') view.camera = {};
    if (view.camera.viewport && typeof view.camera.viewport === 'object') {
      const width = Number(view.camera.viewport.width);
      const height = Number(view.camera.viewport.height);
      if (width > 0 && height > 0) {
        view.camera.viewport = { width, height };
      } else {
        delete view.camera.viewport;
      }
    }
    if (!view.viewSettings || typeof view.viewSettings !== 'object') view.viewSettings = {};
    const textSizePt = Number(view.viewSettings?.pmiTextSizePt);
    if (Number.isFinite(textSizePt) && textSizePt > 0) {
      view.viewSettings.pmiTextSizePt = Math.max(1, Math.min(288, textSizePt));
    } else {
      delete view.viewSettings.pmiTextSizePt;
    }
    const hiddenVisibility = Array.isArray(view.viewSettings?.visibilityState?.hidden)
      ? view.viewSettings.visibilityState.hidden
        .map((entry) => ({
          key: String(entry?.key || ''),
          count: Math.max(1, Math.round(Number(entry?.count) || 1)),
        }))
        .filter((entry) => entry.key)
      : [];
    if (hiddenVisibility.length) {
      view.viewSettings.visibilityState = { hidden: hiddenVisibility };
    } else {
      delete view.viewSettings.visibilityState;
    }
    if (view.annotationHistory && typeof view.annotationHistory !== 'object') {
      delete view.annotationHistory;
    }
    return view;
  }

  _emit() {
    if (!this._listeners || this._listeners.size === 0) return;
    const views = this.getViews();
    for (const listener of Array.from(this._listeners)) {
      try { listener(views, this.partHistory || null); } catch {
        // Listener errors should not break PMI view updates.
      }
    }
  }
}

import { SelectionFilter } from './SelectionFilter.js';
import { HistoryCollectionWidget } from './history/HistoryCollectionWidget.js';
import { FeatureDimensionOverlay } from './featureDimensions/FeatureDimensionOverlay.js';
import { SchemaForm } from './featureDialogs.js';

const FALLBACK_INTERVAL_MS = 200;
const FEATURE_DRAG_RUN_THROTTLE_MS = 120;
const HEADER_SYNC_MIN_INTERVAL_MS = 120;

export class HistoryWidget extends HistoryCollectionWidget {
  constructor(viewer) {
    const partHistory = viewer?.partHistory || null;
    super({ history: partHistory, viewer });
    this.viewer = viewer || null;
    this.partHistory = partHistory || null;

    // Override configurable hooks from the base widget after super() so they can access `this`.
    this._autoSyncOpenState = true;
    this._autoFocusOnExpand = true;
    this._determineExpanded = (entry) => this.#shouldExpandEntry(entry);
    this._formOptionsProvider = (context) => this.#buildFormOptions(context);
    this._decorateEntryHeader = (context) => this.#decorateEntryHeader(context);
    this._buildEntryControls = null; // stick with defaults; override move/delete behaviours directly.
    this._onEntryToggle = (entry, isOpen) => this.#handleEntryToggle(entry, isOpen);
    this._onFormReady = (payload) => this.#handleFormReady(payload);
    this._createEntryFunc = (type) => this.#createFeatureEntry(type);
    this.onEntryChange = (payload) => this.#handleEntryChange(payload);

    this._metaEls = new Map();
    this._itemEls = new Map();
    this._paramSignatures = new Map();
    this._idsSignature = this.#computeIdsSignature();
    this._expressionsSig = this.#computeExpressionsSig();
    this._rafHandle = null;
    this._rafIsTimeout = false;
    this._runPromise = null;
    this._featureDragRunTimer = null;
    this._featureDragRunPending = false;
    this._lastHeaderSyncTs = -Infinity;
    this._featureDimensionOverlay = null;
    this._onActiveTransformStateChange = () => this._syncFeatureDimensionOverlay();
    try {
      this._featureDimensionOverlay = new FeatureDimensionOverlay({
        viewer: this.viewer,
        onFieldChange: (payload) => this.#handleFeatureDimensionFieldChange(payload),
        onFieldFocus: (payload) => this.#handleFeatureDimensionFieldFocus(payload),
      });
    } catch (error) {
      console.warn('[HistoryWidget] Failed to initialize feature dimension overlays:', error);
      this._featureDimensionOverlay = null;
    }

    this.uiElement.classList.add('history-widget');
    this.render();
    try { window.addEventListener('brep-active-transform-state', this._onActiveTransformStateChange); } catch { /* ignore */ }
    this.#startAutoSyncLoop();
    this.#patchRunHistory();
    this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'init' });
  }

  dispose() {
    this.#stopAutoSyncLoop();
    this.#cancelFeatureDragRun();
    try { window.removeEventListener('brep-active-transform-state', this._onActiveTransformStateChange); } catch { /* ignore */ }
    try { this._featureDimensionOverlay?.dispose?.(); } catch { /* ignore */ }
    this._featureDimensionOverlay = null;
    super.dispose();
  }

  isFeatureDimensionDragging() {
    return !!this._featureDimensionOverlay?.isDragging?.();
  }

  render() {
    if (!this._metaEls) this._metaEls = new Map();
    if (!this._itemEls) this._itemEls = new Map();
    if (!this._paramSignatures) this._paramSignatures = new Map();
    this._metaEls.clear();
    this._itemEls.clear();
    super.render();
    this._syncHeaderState(true);
    this._syncFeatureDimensionOverlay();
  }

  async _moveEntry(id, delta) {
    const entryInfo = this.#findEntryInfo(id);
    if (!entryInfo) return;
    super._moveEntry(id, delta);
    this._idsSignature = this.#computeIdsSignature();
    const feature = entryInfo.entry;
    if (feature) {
      feature.lastRunInputParams = null;
      const featureId = this.#entryId(feature);
      if (featureId) this.#setCurrentHistoryStep(featureId);
    }
    await this.#safeRunHistory();
    this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'move' });
  }

  _deleteEntry(id) {
    const entryInfo = this.#findEntryInfo(id);
    super._deleteEntry(id);
    const featureId = entryInfo ? this.#entryId(entryInfo.entry) : null;
    if (featureId && this.partHistory && this.partHistory.currentHistoryStepId === featureId) {
      this.partHistory.currentHistoryStepId = null;
    }
    this._idsSignature = this.#computeIdsSignature();
    const runPromise = this.#safeRunHistory();
    if (runPromise && typeof runPromise.then === 'function') {
      runPromise.then(() => {
        this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'delete' });
      });
    } else {
      this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'delete' });
    }
  }

  _refreshAddMenu() {
    if (!this._addMenu || !this._addBtn) return;
    const registry = this._getFeatureRegistry();
    const features = Array.isArray(registry?.features) ? registry.features : [];
    this._addMenu.textContent = '';
    if (!features.length) {
      this._addBtn.disabled = true;
      const empty = document.createElement('div');
      empty.className = 'hc-menu-empty';
      empty.textContent = 'No features registered';
      this._addMenu.appendChild(empty);
      return;
    }
    const items = [];
    for (const FC of features) {
      if (!FC) continue;
      const names = this._extractDisplayNames(
        FC,
        FC?.shortName || FC?.name || 'Feature',
        FC?.longName || FC?.name || 'Feature',
      );
      const label = names.longName || names.shortName || 'Feature';
      const value = FC?.shortName || FC?.type || FC?.name || names.shortName || label;
      const item = this._composeMenuItem(value, label, FC);
      if (item) items.push(item);
    }
    if (!items.length) {
      this._addBtn.disabled = true;
      const empty = document.createElement('div');
      empty.className = 'hc-menu-empty';
      empty.textContent = 'No features registered';
      this._addMenu.appendChild(empty);
      return;
    }
    this._addBtn.disabled = false;
    for (const { type, text } of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hc-menu-item';
      btn.textContent = text;
      btn.dataset.type = type;
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const targetType = ev?.currentTarget?.dataset?.type || type;
        try {
          await this._handleAddEntry(targetType);
        } finally {
          this._toggleAddMenu(false);
        }
      });
      this._addMenu.appendChild(btn);
    }
  }

  _resolveSchema(entry) {
    const FeatureClass = this._resolveFeatureClass(entry?.type);
    return FeatureClass?.inputParamsSchema || null;
  }

  #findEntryInfo(id) {
    if (id == null) return null;
    const entries = this._getEntries();
    const stringId = String(id);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryId = this._extractEntryId(entry, i);
      if (entryId === stringId) {
        return { entry, index: i };
      }
    }
    return null;
  }

  #startAutoSyncLoop() {
    const useRaf = typeof requestAnimationFrame === 'function';
    this._rafIsTimeout = !useRaf;
    const tick = () => {
      const sig = this.#computeIdsSignature();
      if (sig !== this._idsSignature) {
        this._idsSignature = sig;
        this.render();
      } else {
        this.#refreshOpenForms();
        this._syncHeaderState();
        this.#ensureCurrentExpanded();
      }
      if (useRaf) this._rafHandle = requestAnimationFrame(tick);
      else this._rafHandle = setTimeout(tick, FALLBACK_INTERVAL_MS);
    };
    tick();
  }

  #stopAutoSyncLoop() {
    if (this._rafHandle == null) return;
    if (this._rafIsTimeout) clearTimeout(this._rafHandle);
    else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafHandle);
    this._rafHandle = null;
  }

  #patchRunHistory() {
    const ph = this.partHistory;
    if (!ph || typeof ph.runHistory !== 'function' || ph.__historyWidgetPatched) return;
    const original = ph.runHistory.bind(ph);
    ph.runHistory = async (...args) => {
      const res = await original(...args);
      this.#afterPartHistoryMutated();
      return res;
    };
    ph.__historyWidgetPatched = true;
  }

  #afterPartHistoryMutated() {
    const nextIdsSignature = this.#computeIdsSignature();
    const idsChanged = nextIdsSignature !== this._idsSignature;
    this._idsSignature = nextIdsSignature;
    if (idsChanged) this.render();
    this._syncHeaderState(true);
    this.#refreshOpenForms();
    this._syncFeatureDimensionOverlay();
    try { this.viewer?._refreshAssemblyConstraintsPanelVisibility?.(); } catch { /* ignore */ }
  }

  async #createFeatureEntry(typeStr) {
    const ph = this.partHistory;
    if (!ph || typeof ph.newFeature !== 'function') return null;
    try {
      const feature = await ph.newFeature(typeStr);
      const newId = this.#entryId(feature);
      if (newId) this.#setCurrentHistoryStep(newId);
      await this.#safeRunHistory();
      this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'add' });
      this._idsSignature = this.#computeIdsSignature();
      return feature;
    } catch (error) {
      console.warn('[HistoryWidget] Failed to create feature:', error);
      return null;
    }
  }

  #shouldExpandEntry(entry) {
    const target = this.partHistory?.currentHistoryStepId;
    if (!target) return false;
    const id = this.#entryId(entry);
    if (id == null || String(id) !== String(target)) return false;
    const runtimeOpen = entry?.runtimeAttributes?.__open;
    const paramOpen = entry?.inputParams?.__open;
    if (runtimeOpen === false || paramOpen === false) return false;
    return true;
  }

  #handleEntryToggle(entry, isOpen) {
    if (!this.partHistory) return;
    const id = this.#entryId(entry);
    if (!id) return;
    if (isOpen) {
      this.#setCurrentHistoryStep(id);
    } else {
      if (String(this.partHistory.currentHistoryStepId) === String(id)) {
        this.partHistory.currentHistoryStepId = null;
      }
    }
    this.#safeRunHistory();
    this._syncFeatureDimensionOverlay();
  }

  #handleEntryChange({ entry }) {
    const id = this.#entryId(entry);
    if (id) this.#setCurrentHistoryStep(id);
    const runPromise = this.#safeRunHistory();
    if (runPromise && typeof runPromise.then === 'function') {
      runPromise.then(() => {
        this.partHistory?.queueHistorySnapshot?.({ reason: 'edit' });
      });
    } else {
      this.partHistory?.queueHistorySnapshot?.({ reason: 'edit' });
    }
  }

  #handleFormReady({ id, entry }) {
    if (!id || !entry) return;
    this._paramSignatures.set(String(id), this.#computeParamsSig(entry.inputParams));
    this._syncFeatureDimensionOverlay();
  }

  #handleFeatureDimensionFieldChange(payload = {}) {
    const entryId = payload?.entryId != null ? String(payload.entryId) : null;
    const fieldKey = payload?.fieldKey != null ? String(payload.fieldKey) : null;
    if (!entryId || !fieldKey) return;

    const info = this._findEntryInfoById(entryId);
    const entry = info?.entry || null;
    const params = entry?.inputParams;
    if (!entry || !params || typeof params !== 'object') return;

    const nextValue = Number(payload?.value);
    if (!Number.isFinite(nextValue)) return;
    params[fieldKey] = nextValue;

    const exprMap = params.__expr;
    if (exprMap && typeof exprMap === 'object' && Object.prototype.hasOwnProperty.call(exprMap, fieldKey)) {
      try { delete exprMap[fieldKey]; } catch { /* ignore */ }
    }

    this._paramSignatures.set(entryId, this.#computeParamsSig(params));
    try { this.getFormForEntry(entryId)?.refreshFromParams?.(); } catch { /* ignore */ }

    this.#setCurrentHistoryStep(entryId);

    if (payload?.commit) {
      this.#cancelFeatureDragRun();
      this.#handleEntryChange({ entry });
      return;
    }

    entry.lastRunInputParams = null;
    this.#scheduleFeatureDragRun();
    this._syncFeatureDimensionOverlay();
  }

  #scheduleFeatureDragRun() {
    this._featureDragRunPending = true;
    if (this._featureDragRunTimer) return;
    this._featureDragRunTimer = setTimeout(() => {
      this._featureDragRunTimer = null;
      if (!this._featureDragRunPending) return;
      this._featureDragRunPending = false;
      this.#safeRunHistory();
      this._syncFeatureDimensionOverlay();
    }, FEATURE_DRAG_RUN_THROTTLE_MS);
  }

  #cancelFeatureDragRun() {
    this._featureDragRunPending = false;
    if (!this._featureDragRunTimer) return;
    try { clearTimeout(this._featureDragRunTimer); } catch { /* ignore */ }
    this._featureDragRunTimer = null;
  }

  #handleFeatureDimensionFieldFocus(payload = {}) {
    const entryId = payload?.entryId != null ? String(payload.entryId) : null;
    const fieldKey = payload?.fieldKey != null ? String(payload.fieldKey) : null;
    if (!entryId) return;

    const info = this._findEntryInfoById(entryId);
    const entry = info?.entry || null;
    if (!entry) return;

    if (!this._expandedId || String(this._expandedId) !== entryId) {
      if (this._autoSyncOpenState) {
        const previousInfo = this._expandedId ? this._findEntryInfoById(this._expandedId) : null;
        if (previousInfo?.entry) this._applyOpenState(previousInfo.entry, false);
        this._applyOpenState(entry, true);
      }
      this._expandedId = entryId;
      if (this._autoFocusOnExpand) this._pendingFocusEntryId = entryId;
      this.render();
    }

    const focusField = () => {
      const form = this.getFormForEntry(entryId);
      if (!form) return;

      let handled = false;
      if (fieldKey && typeof form.activateField === 'function') {
        try { handled = form.activateField(fieldKey) === true; } catch { /* ignore */ }
      }
      if (handled) return;

      const root = form?._shadow || form?.uiElement || null;
      if (!root?.querySelector || !fieldKey) return;
      const escapedField = typeof CSS !== 'undefined' && CSS?.escape
        ? CSS.escape(fieldKey)
        : fieldKey.replace(/"/g, '\\"');
      const row = root.querySelector(`[data-key="${escapedField}"]`);
      if (!row) return;
      const target = row.querySelector(
        'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])',
      );
      try { target?.focus?.(); } catch { /* ignore */ }
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => focusField());
    else setTimeout(focusField, 0);

    this._syncFeatureDimensionOverlay();
  }

  #buildFormOptions(context = {}) {
    const entry = context?.entry || null;
    const featureId = this.#entryId(entry);
    return {
      onChange: () => {
        if (featureId) this.#setCurrentHistoryStep(featureId);
      },
      onAction: (_id, actionKey) => this.#handleFormAction(featureId, actionKey),
      onReferenceChipRemove: (name) => this.#handleReferenceChipRemove(name),
      scene: this.viewer?.scene || null,
      viewer: this.viewer || null,
      partHistory: this.partHistory || null,
      featureRef: entry || null,
    };
  }

  #handleFormAction(featureID, actionKey) {
    if (!actionKey || !this.viewer) return;
    try {
      if (actionKey === 'editSketch' && typeof this.viewer.startSketchMode === 'function') {
        this.viewer.startSketchMode(featureID);
      } else if (actionKey === 'editSpline' && typeof this.viewer.startSplineMode === 'function') {
        this.viewer.startSplineMode(featureID);
      }
    } catch {
      /* ignore */
    }
  }

  #handleReferenceChipRemove(name) {
    if (!name) return;
    try {
      const scene = this.viewer?.scene || null;
      if (scene) SelectionFilter.deselectItem(scene, name);
    } catch {
      /* ignore */
    }
  }

  #decorateEntryHeader(context = {}) {
    const id = context?.id != null ? String(context.id) : null;
    const entry = context?.entry || null;
    const elements = context?.elements || {};
    this._applyDisplayInfo(entry, context?.index || 0, id, {
      titleEl: elements.titleEl,
      metaEl: elements.metaEl,
      item: elements.item,
    });
    if (id && elements.metaEl) this._metaEls.set(id, elements.metaEl);
    if (id && elements.item) this._itemEls.set(id, elements.item);
    this.#decorateMissingFeaturePanel(entry, context);
  }

  #decorateMissingFeaturePanel(entry, context = {}) {
    if (!context.isOpen) return;
    const FeatureClass = this._resolveFeatureClass(entry?.type);
    if (FeatureClass) return;
    const body = context.elements?.bodyEl;
    if (!body) return;
    body.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'missing-feature-panel';
    const msg = document.createElement('div');
    msg.className = 'missing-msg';
    msg.textContent = `Feature type "${entry?.type || ''}" is not available. Remove it or install a plugin that provides it.`;
    wrap.appendChild(msg);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'hc-btn danger';
    removeBtn.textContent = 'Remove from history';
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._deleteEntry(context.id);
    });
    wrap.appendChild(removeBtn);
    body.appendChild(wrap);
  }

  _syncHeaderState(force = false) {
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    if (!force && (now - this._lastHeaderSyncTs) < HEADER_SYNC_MIN_INTERVAL_MS) return;
    this._lastHeaderSyncTs = now;
    const entries = this._getEntries();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = this._extractEntryId(entry, i);
      if (id == null) continue;
      const titleEl = this._titleEls.get(String(id));
      const metaEl = this._metaEls.get(String(id));
      const item = this._itemEls.get(String(id));
      if (!titleEl && !metaEl && !item) continue;
      this._applyDisplayInfo(entry, i, String(id), {
        titleEl,
        metaEl,
        item,
      });
    }
  }

  #refreshOpenForms() {
    const exprSig = this.#computeExpressionsSig();
    const exprChanged = exprSig !== this._expressionsSig;
    if (exprChanged) this._expressionsSig = exprSig;
    const entries = this._getEntries();
    let hasRefreshed = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = this._extractEntryId(entry, i);
      if (id == null) continue;
      const form = this.getFormForEntry(id);
      if (!form) continue;
      const sig = this.#computeParamsSig(entry?.inputParams);
      if (!exprChanged && this._paramSignatures.get(id) === sig) continue;
      this._paramSignatures.set(id, sig);
      try { form.refreshFromParams?.(); } catch { /* ignore */ }
      hasRefreshed = true;
    }
    if (hasRefreshed) this._syncFeatureDimensionOverlay();
  }

  #ensureCurrentExpanded() {
    const ph = this.partHistory;
    if (!ph) return;
    const target = ph.currentHistoryStepId;
    if (!target) return;
    if (this._expandedId && String(this._expandedId) === String(target)) return;
    const entries = this._getEntries();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (this._extractEntryId(entry, i) !== String(target)) continue;
      if (!this.#shouldExpandEntry(entry)) return;
      this._expandedId = String(target);
      if (this._autoFocusOnExpand) {
        this._pendingFocusEntryId = String(target);
      }
      this.render();
      return;
    }
  }

  _syncFeatureDimensionOverlay() {
    const overlay = this._featureDimensionOverlay;
    if (!overlay) return;
    try {
      const expandedId = this._expandedId != null ? String(this._expandedId) : null;
      if (!expandedId) {
        overlay.setSuppressed(false);
        overlay.clearActive();
        return;
      }

      const info = this._findEntryInfoById(expandedId);
      const entry = info?.entry || null;
      const form = this.getFormForEntry(expandedId);
      const featureClass = this._resolveFeatureClass(entry?.type);

      if (!entry || !form || !featureClass) {
        overlay.setSuppressed(false);
        overlay.clearActive();
        return;
      }

      const activeTransform = SchemaForm?.getActiveTransformState?.() || null;
      const suppressForTransform = Boolean(
        activeTransform?.controls
        && activeTransform?.dimensionToggleEnabled
        && String(activeTransform?.displayMode || 'transform') === 'transform'
        && activeTransform?.entryId != null
        && String(activeTransform.entryId) === expandedId
        && FeatureDimensionOverlay.supportsFeatureKey(featureClass?.shortName || entry?.type),
      );

      overlay.setActive({
        entryId: expandedId,
        entry,
        featureClass,
        form,
      });
      overlay.setSuppressed(suppressForTransform);
      overlay.refresh();
    } catch (error) {
      console.warn('[HistoryWidget] Feature dimension overlay sync failed:', error);
      try { overlay.clearActive(); } catch { /* ignore */ }
    }
  }

  #computeIdsSignature() {
    const features = this._getEntries();
    return features
      .map((entry, idx) => this._extractEntryId(entry, idx))
      .filter((id) => id != null)
      .join('|');
  }

  #computeParamsSig(params) {
    if (!params || typeof params !== 'object') return '';
    const keys = Object.keys(params).filter((k) => k !== 'featureID' && k !== 'id').sort();
    const parts = [];
    for (const key of keys) {
      const value = params[key];
      if (key === '__expr') {
        if (!value || typeof value !== 'object') {
          parts.push('__expr:null');
          continue;
        }
        const exprKeys = Object.keys(value).sort();
        if (!exprKeys.length) {
          parts.push('__expr:{}');
          continue;
        }
        for (const exprKey of exprKeys) {
          const exprVal = value[exprKey];
          parts.push(`__expr.${exprKey}:${exprVal == null ? '' : String(exprVal)}`);
        }
        continue;
      }
      if (value == null) parts.push(`${key}:null`);
      else if (typeof value === 'object' || typeof value === 'function') parts.push(`${key}:[obj]`);
      else parts.push(`${key}:${String(value)}`);
    }
    return parts.join('|');
  }

  #computeExpressionsSig() {
    const expr = this.partHistory?.expressions;
    if (expr == null) return '';
    return String(expr);
  }

  #entryId(entry) {
    if (!entry) return null;
    const params = entry.inputParams || {};
    if (params.id != null) return String(params.id);
    if (params.featureID != null) return String(params.featureID);
    if (params.id != null) return String(params.id);
    if (entry.id != null) return String(entry.id);
    return null;
  }

  #setCurrentHistoryStep(id) {
    if (!this.partHistory) return;
    this.partHistory.currentHistoryStepId = id != null ? String(id) : null;
  }

  #safeRunHistory() {
    if (!this.partHistory || typeof this.partHistory.runHistory !== 'function') {
      return Promise.resolve();
    }
    const previous = this._runPromise || Promise.resolve();
    const next = previous.then(async () => {
      try {
        await this.partHistory.runHistory();
      } catch (error) {
        console.warn('[HistoryWidget] runHistory failed:', error);
      }
    });
    this._runPromise = next.catch((error) => {
      console.warn('[HistoryWidget] runHistory sequence failed:', error);
    });
    return this._runPromise;
  }

  _getFeatureRegistry() {
    return this.partHistory?.featureRegistry || null;
  }

  _resolveFeatureClass(type) {
    if (!type) return null;
    const registry = this._getFeatureRegistry();
    if (!registry) return null;
    try {
      return registry.getSafe?.(type) || registry.get?.(type) || null;
    } catch {
      return null;
    }
  }
}

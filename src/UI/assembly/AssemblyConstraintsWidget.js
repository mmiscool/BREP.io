import * as THREE from 'three';
import { SelectionFilter } from '../SelectionFilter.js';
import { LabelOverlay } from '../pmi/LabelOverlay.js';
import { addArrowCone, screenSizeWorld, getElementDirection } from '../pmi/annUtils.js';
import {
  buildAngleDimensionGeometry,
  buildLinearDimensionGeometry,
  dirTo2D,
  intersectLines2D,
  planeBasis,
  resolveAngleOrientation2D,
  to2D,
} from '../dimensions/dimensionGeometry.js';
import { resolveSelectionObject } from './constraintSelectionUtils.js';
import {
  isFaceObject,
  computeFaceOrigin,
  computeFaceNormal,
  estimateArrowLength,
} from '../faceUtils.js';
import { applyHighlightMaterial, restoreHighlightRecords } from './constraintHighlightUtils.js';
import { extractWorldPoint } from './constraintPointUtils.js';
import { constraintStatusInfo } from './constraintStatusUtils.js';
import { constraintLabelText } from './constraintLabelUtils.js';
import { AssemblyConstraintControlsWidget } from './AssemblyConstraintControlsWidget.js';
import { AssemblyConstraintCollectionWidget } from './AssemblyConstraintCollectionWidget.js';
import { MODEL_STORAGE_PREFIX } from '../../services/componentLibrary.js';
import './AssemblyConstraintsWidget.css';


const ROOT_CLASS = 'constraints-history';
const DEFAULT_CONSTRAINT_COLOR = '#ffd60a';

function resolveConstraintId(entry, fallback = null) {
  if (!entry) return fallback;
  const params = entry.inputParams || {};
  if (params.id != null) return String(params.id);
  if (params.constraintID != null) return String(params.constraintID);
  if (entry.id != null) return String(entry.id);
  return fallback;
}

function normalizedAngleMagnitude(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const wrapped = ((Math.abs(numeric) % 360) + 360) % 360;
  const folded = wrapped > 180 ? 360 - wrapped : wrapped;
  if (folded <= 1e-9) return 0;
  if (Math.abs(folded - 180) <= 1e-9) return 180;
  return folded;
}

export class AssemblyConstraintsWidget {
  constructor(viewer) {
    this.viewer = viewer || null;
    this.partHistory = viewer?.partHistory || null;
    this.registry = this.partHistory?.assemblyConstraintRegistry || null;
    this.history = this.partHistory?.assemblyConstraintHistory || null;
    if (this.history) this.history.setPartHistory?.(this.partHistory);

    this._highlighted = new Map();
    this._highlightPalette = ['#ffd60a', '#30d158', '#0a84ff', '#ff3b30',];

    this._defaultIterations = 1000;
    this._normalArrows = new Set();
    this._constraintLines = new Map();
    this._constraintArrowGroups = new Map();
    this._labelPositions = new Map();
    this._onControlsChange = () => this._refreshConstraintLabels();
    this._onWindowResize = () => this._refreshConstraintLabels();
    this._constraintGraphicsEnabled = true;
    this._constraintGraphicsPreferred = this._constraintGraphicsEnabled;
    this._constraintGraphicsCheckbox = null;
    this._hoverHighlights = new Map();
    this._activeHoverConstraintId = null;
    this._syncScheduled = false;
    this._solverRun = null;
    this._solverActionButton = null;
    this._solverStatusLabel = null;
    this._solverLoopLabel = null;
    this._solverConstraintLabel = null;
    this._pauseCheckbox = null;
    this._solverContinueButton = null;
    this._animateCheckbox = null;
    this._animateDelayInput = null;
    this._animateDelayContainer = null;
    this._animateEnabled = true;
    this._animateDelayMs = 1;
    this._controlsWidget = null;
    this._updateComponentsBtn = null;
    this._updatingComponents = false;
    this._onStorageEvent = null;
    this._fullSolveOnChange = true;
    this._pendingFullSolve = false;
    this._ignoreFullSolveChangeCount = 0;
    this._fullSolveCheckbox = null;
    this._pmiVisibilityLock = 0;
    this._constraintList = null;

    this.uiElement = document.createElement('div');
    this.uiElement.className = ROOT_CLASS;

    if (this.viewer?.scene) {
      this._constraintGroup = new THREE.Group();
      this._constraintGroup.name = 'assembly-constraint-overlays';
      this._constraintGroup.userData.excludeFromFit = true;
      try { this.viewer.scene.add(this._constraintGroup); }
      catch { this._constraintGroup = null; }
    } else {
      this._constraintGroup = null;
    }

    if (this.viewer) {
      this._labelOverlay = new LabelOverlay(
        this.viewer,
        (idx, ann, ev) => { try { this.#handleLabelPointerDown(idx, ann, ev); } catch { } },
        null,
        (idx, ann, ev) => { try { this.#handleLabelClick(idx, ann, ev); } catch { } },
      );
      try { this.viewer.controls?.addEventListener('change', this._onControlsChange); } catch { }
      try { window.addEventListener('resize', this._onWindowResize); } catch { }
    } else {
      this._labelOverlay = null;
    }

    this._controlsWidget = new AssemblyConstraintControlsWidget(this);
    this.uiElement.appendChild(this._controlsWidget.element);
    this._setConstraintGraphicsEnabled(this._constraintGraphicsEnabled);

    this._updateComponentsBtn = this._buildUpdateComponentsButton();
    if (this._updateComponentsBtn && this._controlsWidget?.element) {
      const target = this._controlsWidget.element;
      const solverSection = target.querySelector('.control-panel-section.solver-controls');
      if (solverSection) {
        target.insertBefore(this._updateComponentsBtn, solverSection);
      } else {
        target.insertBefore(this._updateComponentsBtn, target.firstChild);
      }
    }
    void this._refreshUpdateComponentsButton();

    try {
      this._onStorageEvent = (ev) => {
        try {
          const key = (ev && (ev.key ?? ev.detail?.key)) || '';
          if (typeof key === 'string' && key.startsWith(MODEL_STORAGE_PREFIX)) {
            void this._refreshUpdateComponentsButton();
          }
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('storage', this._onStorageEvent);
    } catch {
      this._onStorageEvent = null;
    }

    this._constraintList = new AssemblyConstraintCollectionWidget({
      history: this.history,
      viewer: this.viewer,
      partHistory: this.partHistory,
      onBeforeConstraintChange: () => this._stopSolver({ wait: true }),
      onHighlightRequest: (entry) => {
        if (!entry) return;
        const cls = this._resolveConstraintClass(entry);
        this._highlightConstraint(entry, cls);
      },
      onClearHighlight: () => { this._clearHighlights(); },
    });
    this.uiElement.appendChild(this._constraintList.uiElement);

    this._unsubscribe = this.history?.onChange(() => this.#handleHistoryChange()) || null;

    this.render();
  }

  dispose() {
    this._clearHighlights();
    this._clearConstraintVisuals();
    try { this.viewer?.controls?.removeEventListener('change', this._onControlsChange); } catch { }
    try { window.removeEventListener('resize', this._onWindowResize); } catch { }
    try {
      if (this._onStorageEvent) window.removeEventListener('storage', this._onStorageEvent);
    } catch {
      /* ignore */
    }
    this._onStorageEvent = null;
    if (this._constraintGroup && this.viewer?.scene) {
      try { this.viewer.scene.remove(this._constraintGroup); } catch { }
    }
    this._constraintGroup = null;
    this._constraintLines.clear();
    this._constraintArrowGroups.clear();
    this._labelPositions.clear();
    try { this._labelOverlay?.dispose?.(); } catch { }
    this._labelOverlay = null;
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch { /* ignore */ }
      this._unsubscribe = null;
    }
    const stopPromise = this._stopSolver({ wait: false });
    if (stopPromise?.catch) {
      try { stopPromise.catch(() => { }); } catch { /* ignore */ }
    }
    this._solverRun = null;
    this._iterationInput = null;
    this._solverActionButton = null;
    this._solverStatusLabel = null;
    this._solverLoopLabel = null;
    this._solverConstraintLabel = null;
    this._pauseCheckbox = null;
    this._solverContinueButton = null;
    this._animateCheckbox = null;
    this._animateDelayInput = null;
    this._animateDelayContainer = null;
    this._constraintGraphicsCheckbox = null;
    this._fullSolveCheckbox = null;
    this._pendingFullSolve = false;
    this._fullSolveOnChange = false;
    this._ignoreFullSolveChangeCount = 0;
    this._controlsWidget?.dispose?.();
    this._controlsWidget = null;
    this._constraintList?.dispose?.();
    this._constraintList = null;
  }

  render() {
    this._scheduleSync();
  }

  collapseExpandedDialogs() {
    try { this._constraintList?.collapseExpandedEntries?.({ clearOpenState: true }); } catch { /* ignore */ }
  }

  #handleHistoryChange() {
    this._scheduleSync();
    if (this._ignoreFullSolveChangeCount > 0) {
      this._ignoreFullSolveChangeCount -= 1;
      return;
    }
    if (!this._fullSolveOnChange) return;
    this.#scheduleFullSolveOnChange();
  }

  #scheduleFullSolveOnChange() {
    if (this._pendingFullSolve) return;
    this._pendingFullSolve = true;
    const trigger = () => {
      if (!this._pendingFullSolve) return;
      if (!this._fullSolveOnChange) {
        this._pendingFullSolve = false;
        return;
      }
      if (this._solverRun?.running) {
        setTimeout(() => this.#attemptFullSolveOnChange(), 75);
        return;
      }
      this.#attemptFullSolveOnChange();
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(trigger);
    } else if (typeof Promise === 'function') {
      Promise.resolve().then(trigger).catch(() => trigger());
    } else {
      setTimeout(trigger, 0);
    }
  }

  #attemptFullSolveOnChange() {
    if (!this._pendingFullSolve) return;
    if (!this._fullSolveOnChange) {
      this._pendingFullSolve = false;
      return;
    }
    if (this._solverRun?.running) {
      setTimeout(() => this.#attemptFullSolveOnChange(), 75);
      return;
    }
    this._pendingFullSolve = false;
    try {
      const promise = this._handleStartClick();
      if (promise?.catch) {
        try { promise.catch(() => { }); } catch { /* ignore */ }
      }
    } catch (error) {
      console.warn('[AssemblyConstraintsWidget] Auto solve failed:', error);
    }
  }

  _scheduleSync() {
    if (this._syncScheduled) return;
    this._syncScheduled = true;
    const doSync = () => {
      this._syncScheduled = false;
      try {
        this._syncNow();
      } catch (error) {
        console.warn('[AssemblyConstraintsWidget] Sync failed:', error);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (typeof queueMicrotask === 'function') queueMicrotask(doSync);
        else Promise.resolve().then(doSync);
      });
    } else {
      setTimeout(doSync, 0);
    }
  }

  #requestViewerRender() {
    try { this.viewer?.render?.(); } catch { /* ignore */ }
  }

  _syncNow() {
    void this._refreshUpdateComponentsButton();
    this._clearHighlights();
    const entries = this.history?.list?.();
    const list = Array.isArray(entries) ? entries : [];
    this._updateConstraintVisuals(list);
    this.#requestViewerRender();
  }
  async _handleStartClick() {
    const iterations = this.#normalizeIterationInputValue();
    if (iterations < 1) return;

    await this._stopSolver({ wait: true });
    this._startSolver(iterations);
  }

  _startSolver(iterations) {
    if (!this.history) return;
    this._clearNormalArrows();

    const abortController = new AbortController();
    const run = {
      abortController,
      running: true,
      iterations,
      maxIterations: iterations,
      currentIteration: 0,
      iterationsCompleted: 0,
      currentConstraintID: null,
      awaitingContinue: false,
      continueDeferred: null,
      aborted: false,
      promise: null,
      iterationDelayMs: 0,
      labelRefreshCounter: 0,
    };

    this._solverRun = run;
    this._updateSolverUI();

    const hooks = {
      onStart: ({ maxIterations: total }) => {
        if (this._solverRun !== run) return;
        if (Number.isFinite(total)) run.maxIterations = total;
        this._updateSolverUI();
      },
      onIterationStart: ({ iteration, maxIterations: total }) => {
        if (this._solverRun !== run) return;
        run.currentIteration = Number.isFinite(iteration) ? iteration : 0;
        if (Number.isFinite(total)) run.maxIterations = total;
        run.currentConstraintID = null;
        this._updateSolverUI();
      },
      onConstraintStart: ({ id, constraintID }) => {
        if (this._solverRun !== run) return;
        run.currentConstraintID = id || constraintID || null;
        this._updateSolverUI();
      },
      onIterationComplete: async ({ iteration }) => {
        if (this._solverRun !== run) return;
        run.iterationsCompleted = Number.isFinite(iteration) ? iteration + 1 : run.iterationsCompleted;
        this._updateSolverUI();
        this.#maybeRefreshLabelsDuringSolve(run);
        if (this._shouldPauseBetweenLoops() && !run.abortController.signal.aborted) {
          await this.#waitForIterationContinue(run);
        }
      },
      onComplete: ({ aborted, iterationsCompleted }) => {
        if (this._solverRun !== run) return;
        run.aborted = !!aborted;
        if (Number.isFinite(iterationsCompleted)) {
          run.iterationsCompleted = iterationsCompleted;
        }
        this._updateSolverUI();
      },
    };

    const iterationDelayMs = this.#computeIterationDelay();
    run.iterationDelayMs = Number.isFinite(iterationDelayMs) ? Math.max(0, iterationDelayMs) : 0;

    this._ignoreFullSolveChangeCount += 1;

    run.promise = (async () => {
      try {
        await this.history.runAll(this.partHistory, {
          iterations,
          viewer: this.viewer || null,
          iterationDelayMs,
          controller: {
            signal: abortController.signal,
            hooks,
          },
        });
      } catch (error) {
        console.warn('[AssemblyConstraintsWidget] Solve failed:', error);
      } finally {
        if (this._solverRun === run) {
          this._solverRun = null;
        }
        run.running = false;
        this._resolveIterationGate(run);
        this._updateSolverUI();
        if (this._ignoreFullSolveChangeCount > 0) {
          this._ignoreFullSolveChangeCount -= 1;
        }
      }
    })();
  }

  async _stopSolver({ wait = false } = {}) {
    const run = this._solverRun;
    if (!run) return;
    try {
      if (!run.abortController.signal.aborted) {
        run.abortController.abort();
      }
    } catch { /* ignore */ }
    this._resolveIterationGate(run);
    this._updateSolverUI();
    if (wait && run.promise) {
      try { await run.promise; }
      catch { /* ignore */ }
    }
  }

  _resolveIterationGate(run = this._solverRun) {
    if (!run || !run.continueDeferred) return;
    const { resolve } = run.continueDeferred;
    run.continueDeferred = null;
    run.awaitingContinue = false;
    if (typeof resolve === 'function') {
      try { resolve(); } catch { /* ignore */ }
    }
  }

  async #waitForIterationContinue(run) {
    if (!run) return;
    if (run.continueDeferred) {
      try { await run.continueDeferred.promise; }
      catch { /* ignore */ }
      return;
    }
    run.awaitingContinue = true;
    this._updateSolverUI();
    run.continueDeferred = {};
    run.continueDeferred.promise = new Promise((resolve) => {
      run.continueDeferred.resolve = () => {
        run.awaitingContinue = false;
        run.continueDeferred = null;
        resolve();
      };
    });
    try {
      await run.continueDeferred.promise;
    } catch { /* ignore */ }
  }

  _handlePauseCheckboxChange() {
    if (!this._shouldPauseBetweenLoops()) {
      this._resolveIterationGate();
    }
    this._updateSolverUI();
  }

  _shouldPauseBetweenLoops() {
    return this._pauseCheckbox?.checked === true;
  }

  _handleContinueClick() {
    this._resolveIterationGate();
    this._updateSolverUI();
  }

  #normalizeIterationInputValue() {
    let iterations = Number(this._iterationInput?.value ?? this._defaultIterations ?? 1);
    if (!Number.isFinite(iterations) || iterations < 1) iterations = 1;
    iterations = Math.floor(iterations);
    if (this._iterationInput) this._iterationInput.value = String(iterations);
    return iterations;
  }

  #getIterationInputValue() {
    const raw = Number(this._iterationInput?.value);
    if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
    const fallback = Number(this._defaultIterations);
    if (Number.isFinite(fallback) && fallback >= 1) return Math.floor(fallback);
    return 1;
  }

  #normalizeAnimateDelayValue() {
    let delay = Number(this._animateDelayInput?.value ?? this._animateDelayMs);
    if (!Number.isFinite(delay) || delay < 0) delay = this._animateDelayMs;
    delay = Math.max(0, Math.floor(delay));
    if (this._animateDelayInput) this._animateDelayInput.value = String(delay);
    this._animateDelayMs = delay;
    return delay;
  }

  #computeIterationDelay() {
    const animate = this._animateCheckbox ? this._animateCheckbox.checked : this._animateEnabled;
    if (!animate) return 0;
    return this.#normalizeAnimateDelayValue();
  }

  _handleFullSolveToggleChange(checked) {
    const value = !!checked;
    this._fullSolveOnChange = value;
    if (this._fullSolveCheckbox) {
      this._fullSolveCheckbox.checked = value;
    }
    if (!value) {
      this._pendingFullSolve = false;
      return;
    }
    this.#scheduleFullSolveOnChange();
  }

  _handleAnimateCheckboxChange() {
    this._animateEnabled = this._animateCheckbox?.checked !== false;
    this._updateSolverUI();
  }

  _handleAnimateDelayChange() {
    this.#normalizeAnimateDelayValue();
    this._updateSolverUI();
  }

  #maybeRefreshLabelsDuringSolve(run) {
    if (!run || run.iterationDelayMs <= 0) return;
    run.labelRefreshCounter = (run.labelRefreshCounter || 0) + 1;
    if (run.labelRefreshCounter < 50) return;
    run.labelRefreshCounter = 0;
    const entries = typeof this.history?.list === 'function' ? (this.history.list() || []) : [];
    this._updateConstraintVisuals(entries);
  }

  _updateSolverUI() {
    const run = this._solverRun;
    const running = !!run?.running && !run?.abortController?.signal?.aborted;
    const stopping = !!run?.abortController?.signal?.aborted && !!run?.running;
    const awaitingContinue = !!run?.awaitingContinue;

    if (this._solverActionButton) {
      const isStopMode = running || stopping;
      this._solverActionButton.classList.toggle('solver-start-btn', !isStopMode);
      this._solverActionButton.classList.toggle('solver-stop-btn', isStopMode);
      if (stopping) {
        this._solverActionButton.textContent = 'Stopping...';
        this._solverActionButton.disabled = true;
      } else if (running) {
        this._solverActionButton.textContent = 'Stop';
        this._solverActionButton.disabled = false;
      } else {
        this._solverActionButton.textContent = 'Start';
        this._solverActionButton.disabled = false;
      }
    }
    if (this._iterationInput) {
      this._iterationInput.disabled = running || stopping;
    }
    if (this._animateCheckbox) {
      this._animateCheckbox.disabled = running || stopping;
    }
    if (this._animateDelayInput) {
      const animateChecked = this._animateCheckbox ? this._animateCheckbox.checked : this._animateEnabled;
      this._animateDelayInput.disabled = !animateChecked || running || stopping;
    }
    if (this._animateDelayContainer) {
      const animateChecked = this._animateCheckbox ? this._animateCheckbox.checked : this._animateEnabled;
      this._animateDelayContainer.style.display = animateChecked ? '' : 'none';
    }

    if (this._solverStatusLabel) {
      let text = 'Status: Idle';
      if (stopping) text = 'Status: Stopping';
      else if (awaitingContinue) text = 'Status: Paused';
      else if (running) text = 'Status: Running';
      else if (run) {
        text = run.aborted ? 'Status: Stopped' : 'Status: Completed';
      }
      this._solverStatusLabel.textContent = text;
      this._solverStatusLabel.dataset.state = text.split(':')[1]?.trim()?.toLowerCase() || 'idle';
    }

    if (this._solverLoopLabel) {
      if (run) {
        const max = Number.isFinite(run.maxIterations)
          ? run.maxIterations
          : Number.isFinite(run.iterations)
            ? run.iterations
            : this.#getIterationInputValue();
        const current = awaitingContinue
          ? run.iterationsCompleted
          : Number.isFinite(run.currentIteration) ? run.currentIteration + 1 : run.iterationsCompleted;
        const displayCurrent = Number.isFinite(current) && current > 0 ? current : 0;
        if (Number.isFinite(max) && max > 0) {
          this._solverLoopLabel.textContent = `Loop: ${Math.min(displayCurrent, max)}/${max}`;
        } else if (displayCurrent > 0) {
          this._solverLoopLabel.textContent = `Loop: ${displayCurrent}`;
        } else {
          this._solverLoopLabel.textContent = 'Loop: -';
        }
      } else {
        this._solverLoopLabel.textContent = 'Loop: -';
      }
    }

    if (this._solverConstraintLabel) {
      if (run && run.currentConstraintID) {
        this._solverConstraintLabel.textContent = `Constraint: ${run.currentConstraintID}`;
      } else {
        this._solverConstraintLabel.textContent = 'Constraint: -';
      }
    }

    if (this._solverContinueButton) {
      const pauseEnabled = this._shouldPauseBetweenLoops();
      this._solverContinueButton.style.display = pauseEnabled ? '' : 'none';
      this._solverContinueButton.disabled = !awaitingContinue;
    }
  }


  _setConstraintGraphicsEnabled(enabled, options = {}) {
    const requested = !!enabled;
    if (options.recordPreference !== false) {
      this._constraintGraphicsPreferred = requested;
    }
    const suppressed = this._pmiVisibilityLock > 0 && !options.force;
    const value = suppressed ? false : requested;
    this._constraintGraphicsEnabled = value;

    if (this._constraintGroup) {
      this._constraintGroup.visible = value;
    }

    if (typeof this._labelOverlay?.setVisible === 'function') {
      this._labelOverlay.setVisible(value);
    }

    if (this._constraintGraphicsCheckbox && this._constraintGraphicsCheckbox.checked !== value) {
      this._constraintGraphicsCheckbox.checked = value;
    }

    if (value) {
      this._refreshConstraintLabels();
    } else {
      this.#clearActiveHoverHighlight();
    }

    this.#requestViewerRender();
  }

  onPMIModeEnter() {
    this._pmiVisibilityLock = (this._pmiVisibilityLock || 0) + 1;
    this._setConstraintGraphicsEnabled(this._constraintGraphicsPreferred, { recordPreference: false });
  }

  onPMIModeExit() {
    if (!this._pmiVisibilityLock) return;
    this._pmiVisibilityLock = Math.max(0, this._pmiVisibilityLock - 1);
    if (this._pmiVisibilityLock > 0) return;
    this._setConstraintGraphicsEnabled(this._constraintGraphicsPreferred, {
      recordPreference: false,
      force: true,
    });
  }

  _clearHoverHighlights() {
    restoreHighlightRecords(this._hoverHighlights);
  }

  _clearHighlights() {
    this.#clearActiveHoverHighlight();
    restoreHighlightRecords(this._highlighted);
    this._clearNormalArrows();
    try { SelectionFilter.clearHover?.(); } catch { /* ignore */ }
    this.#requestViewerRender();
  }

  _applyConstraintHighlight(entry, ConstraintClass, options = {}) {
    if (!entry?.inputParams) return false;

    const store = options.store ?? this._highlighted;
    const clearExisting = options.clearExisting !== false;
    const includeNormals = options.includeNormals ?? (store === this._highlighted);
    const skipSets = Array.isArray(options.skipSets) && options.skipSets.length
      ? options.skipSets
      : [store];
    const emitWarnings = options.emitWarnings || false;

    const useHoverStore = store === this._hoverHighlights;

    if (useHoverStore) {
      this._clearHoverHighlights();
      if (clearExisting && store !== this._highlighted) {
        restoreHighlightRecords(this._highlighted);
        this._clearNormalArrows();
      }
    } else if (clearExisting) {
      this._clearHighlights();
    }

    const schema = ConstraintClass?.inputParamsSchema || {};
    const refFields = Object.entries(schema).filter(([, def]) => def?.type === 'reference_selection');
    if (!refFields.length) return false;

    const constraintId = resolveConstraintId(entry) || 'constraint';

    let colorIndex = 0;
    let foundTargets = false;
    let sawFace = false;
    let arrowsCreated = false;
    for (const [key] of refFields) {
      const color = this._highlightPalette[colorIndex % this._highlightPalette.length];
      colorIndex += 1;
      const targets = this._resolveReferenceObjects(entry.inputParams[key]);
      if (!targets || targets.length === 0) continue;
      foundTargets = true;
      for (const obj of targets) {
        const changed = applyHighlightMaterial(obj, color, store, skipSets);
        if (changed && includeNormals && isFaceObject(obj)) {
          sawFace = true;
          const arrow = this._createNormalArrow(obj, color, `${constraintId}:${key}`);
          if (arrow) arrowsCreated = true;
        }
      }
    }

    if (emitWarnings && !foundTargets) {
      console.warn('[AssemblyConstraintsWidget] No reference objects could be highlighted for constraint:', constraintId);
    }

    if (emitWarnings && includeNormals && sawFace && !arrowsCreated) {
      console.warn('[AssemblyConstraintsWidget] No face normals could be visualized for constraint:', constraintId);
    }

    this.#requestViewerRender();
    return foundTargets;
  }

  _highlightConstraint(entry, ConstraintClass) {
    this._applyConstraintHighlight(entry, ConstraintClass, {
      store: this._highlighted,
      clearExisting: true,
      includeNormals: true,
      skipSets: [this._highlighted],
      emitWarnings: true,
    });
  }

  #attachLabelHoverHandlers(element, entry, constraintID) {
    if (!element) return;
    const prev = element.__constraintHoverHandlers;
    if (prev) {
      element.removeEventListener('mouseenter', prev.enter);
      element.removeEventListener('mouseleave', prev.leave);
    }
    if (!entry) {
      element.__constraintHoverHandlers = null;
      return;
    }
    const onEnter = () => {
      try { this.#handleConstraintLabelHover(entry, constraintID); } catch { }
    };
    const onLeave = () => {
      try { this.#handleConstraintLabelHoverEnd(constraintID); } catch { }
    };
    element.addEventListener('mouseenter', onEnter);
    element.addEventListener('mouseleave', onLeave);
    element.__constraintHoverHandlers = { enter: onEnter, leave: onLeave };
  }

  #handleConstraintLabelHover(entry, constraintID) {
    if (!this._constraintGraphicsEnabled) return;
    if (this._activeHoverConstraintId && this._activeHoverConstraintId !== constraintID) {
      this.#clearActiveHoverHighlight();
    }

    const ConstraintClass = this._resolveConstraintClass(entry);

    this._activeHoverConstraintId = constraintID;
    this._applyConstraintHighlight(entry, ConstraintClass, {
      store: this._hoverHighlights,
      clearExisting: false,
      includeNormals: false,
      skipSets: [this._highlighted, this._hoverHighlights],
      emitWarnings: false,
    });
    this.#setConstraintLineHighlight(constraintID, true);
    this.#requestViewerRender();
  }

  #handleConstraintLabelHoverEnd(constraintID) {
    if (!constraintID) return;
    if (this._activeHoverConstraintId !== constraintID) {
      this.#setConstraintLineHighlight(constraintID, false);
      this.#requestViewerRender();
      return;
    }
    this.#clearActiveHoverHighlight();
  }

  #clearActiveHoverHighlight() {
    if (!this._activeHoverConstraintId) return;
    const activeId = this._activeHoverConstraintId;
    this._activeHoverConstraintId = null;
    this._clearHoverHighlights();
    this.#setConstraintLineHighlight(activeId, false);
    this.#requestViewerRender();
  }

  #setConstraintLineHighlight(constraintID, active) {
    const line = this._constraintLines.get(constraintID);
    if (line && line.material) {
      const mat = line.material;
      line.userData = line.userData || {};

      if (active) {
        if (!line.userData.__hoverOriginal) {
          line.userData.__hoverOriginal = {
            color: mat.color ? mat.color.clone() : null,
            linewidth: mat.linewidth,
            opacity: mat.opacity,
            depthTest: mat.depthTest,
            depthWrite: mat.depthWrite,
          };
        }
        try { mat.color?.set('#ffffff'); } catch { }
        try { mat.opacity = 1; } catch { }
        try { mat.linewidth = 2; } catch { }
        try { mat.depthTest = false; mat.depthWrite = false; } catch { }
        line.renderOrder = 10050;
      } else {
        const original = line.userData.__hoverOriginal;
        if (original) {
          try {
            if (original.color && mat.color) mat.color.copy(original.color);
            if (original.opacity != null) mat.opacity = original.opacity;
            if (original.linewidth != null) mat.linewidth = original.linewidth;
            if (original.depthTest != null) mat.depthTest = original.depthTest;
            if (original.depthWrite != null) mat.depthWrite = original.depthWrite;
          } catch { }
        }
        delete line.userData.__hoverOriginal;
        line.renderOrder = 9999;
      }

      try { mat.needsUpdate = true; } catch { }
    }

    this.#setConstraintArrowHighlight(constraintID, active);
  }

  #setConstraintArrowHighlight(constraintID, active) {
    const group = this._constraintArrowGroups.get(constraintID);
    if (!group) return;
    group.userData = group.userData || {};

    if (active) {
      if (!Array.isArray(group.userData.__hoverOriginal)) {
        const original = [];
        for (const child of group.children) {
          if (!child?.isMesh) continue;
          const mat = child.material;
          if (!mat) continue;
          original.push({
            child,
            color: mat.color?.clone?.() || null,
            opacity: mat.opacity,
            depthTest: mat.depthTest,
            depthWrite: mat.depthWrite,
          });
        }
        group.userData.__hoverOriginal = original;
      }
      for (const child of group.children) {
        if (!child?.isMesh || !child.material) continue;
        try { child.material.color?.set?.('#ffffff'); } catch { }
        try { child.material.opacity = 1; } catch { }
        try { child.material.depthTest = false; child.material.depthWrite = false; } catch { }
        child.renderOrder = 10050;
        try { child.material.needsUpdate = true; } catch { }
      }
      return;
    }

    const originals = Array.isArray(group.userData.__hoverOriginal)
      ? group.userData.__hoverOriginal
      : [];
    for (const record of originals) {
      const child = record?.child;
      const mat = child?.material;
      if (!mat) continue;
      try {
        if (record.color && mat.color) mat.color.copy(record.color);
        if (record.opacity != null) mat.opacity = record.opacity;
        if (record.depthTest != null) mat.depthTest = record.depthTest;
        if (record.depthWrite != null) mat.depthWrite = record.depthWrite;
      } catch { }
      if (child) child.renderOrder = 9996;
      try { mat.needsUpdate = true; } catch { }
    }
    delete group.userData.__hoverOriginal;
  }

  _updateConstraintVisuals(entries = []) {
    const scene = this.viewer?.scene || null;
    if (!scene) return;

    this.#clearActiveHoverHighlight();

    const activeIds = new Set();
    this._labelPositions.clear();
    if (this._labelOverlay) {
      try { this._labelOverlay.clear(); } catch { }
    }

    if (!entries || entries.length === 0) {
      this._removeUnusedConstraintLines(activeIds);
      this._refreshConstraintLabels();
      return;
    }

    entries.forEach((entry, index) => {
      if (!entry) return;
      const constraintID = resolveConstraintId(entry) || `constraint-${index}`;
      const constraintClass = this._resolveConstraintClass(entry);
      const statusInfo = constraintStatusInfo(entry);
      const color = statusInfo?.color || DEFAULT_CONSTRAINT_COLOR;
      const visual = this.#constraintVisualData(entry, constraintClass);
      const segments = Array.isArray(visual?.segments) ? visual.segments : [];
      const arrowSpecs = Array.isArray(visual?.arrowSpecs) ? visual.arrowSpecs : [];
      let labelPosition = null;

      if ((segments.length > 0) || (arrowSpecs.length > 0)) {
        this.#upsertConstraintVisual(constraintID, { segments, arrowSpecs }, color);
        labelPosition = visual?.labelPosition?.clone?.() || null;
        if (!labelPosition) {
          labelPosition = this.#segmentsMidpoint(segments);
        }
        if (!labelPosition) {
          labelPosition = this.#constraintStandalonePosition(entry, constraintClass);
        }
      } else {
        this.#removeConstraintLine(constraintID);
        labelPosition = this.#constraintStandalonePosition(entry, constraintClass);
      }

      if (!labelPosition) return;

      const text = constraintLabelText(entry, constraintClass, this.partHistory);
      const overlayData = { id: constraintID, constraintID };

      if (this._constraintGraphicsEnabled) {
        try { this._labelOverlay?.updateLabel(constraintID, text, labelPosition.clone(), overlayData); } catch { }
        const el = this._labelOverlay?.getElement?.(constraintID);
        if (el) {
          try {
            el.classList.add('constraint-label');
            el.dataset.constraintId = constraintID;
          } catch { }
          this.#applyConstraintLabelColor(el, color);
          this.#attachLabelHoverHandlers(el, entry, constraintID);
        }
      }

      this._labelPositions.set(constraintID, {
        position: labelPosition.clone(),
        text,
        data: overlayData,
        entry,
        color,
      });
      activeIds.add(constraintID);
    });

    this._refreshConstraintLabels();
    this.#requestViewerRender();
  }

  _refreshConstraintLabels() {
    if (!this._constraintGraphicsEnabled) return;
    if (!this._labelOverlay || !this._labelPositions.size) return;

    const activeIds = new Set();

    for (const [constraintID, record] of this._labelPositions.entries()) {
      if (!record || !record.position) continue;

      activeIds.add(constraintID);

      let color = record.color || DEFAULT_CONSTRAINT_COLOR;

      if (record.entry) {
        const statusInfo = constraintStatusInfo(record.entry);
        color = statusInfo?.color || color;
        record.color = color;
        const constraintClass = this._resolveConstraintClass(record.entry);
        record.text = constraintLabelText(record.entry, constraintClass, this.partHistory);
        const visual = this.#constraintVisualData(record.entry, constraintClass);
        const segments = Array.isArray(visual?.segments) ? visual.segments : [];
        const arrowSpecs = Array.isArray(visual?.arrowSpecs) ? visual.arrowSpecs : [];
        if ((segments.length > 0) || (arrowSpecs.length > 0)) {
          this.#upsertConstraintVisual(constraintID, { segments, arrowSpecs }, color);
          const labelPosition = visual?.labelPosition?.clone?.()
            || this.#segmentsMidpoint(segments)
            || this.#constraintStandalonePosition(record.entry, constraintClass)
            || record.position;
          if (labelPosition) record.position = labelPosition.clone();
        } else {
          this.#removeConstraintLine(constraintID);
          const fallbackPosition = this.#constraintStandalonePosition(record.entry, constraintClass);
          if (fallbackPosition) record.position = fallbackPosition.clone();
        }
      } else {
        record.color = color;
      }

      try {
        this._labelOverlay.updateLabel(constraintID, record.text, record.position.clone(), record.data);
        const el = this._labelOverlay.getElement(constraintID);
        if (el) {
          el.classList.add('constraint-label');
          el.dataset.constraintId = constraintID;
          this.#applyConstraintLabelColor(el, color);
          this.#attachLabelHoverHandlers(el, record.entry, constraintID);
        }
      } catch { }
    }

    this._removeUnusedConstraintLines(activeIds);
  }

  #applyConstraintLabelColor(element, color) {
    if (!element) return;
    const appliedColor = color || '';
    try { element.style.borderColor = appliedColor; } catch { }
    try { element.style.color = appliedColor || ''; } catch { }
  }

  _clearConstraintVisuals() {
    this.#clearActiveHoverHighlight();
    this._labelPositions.clear();
    if (this._labelOverlay) {
      try { this._labelOverlay.clear(); } catch { }
    }
    for (const constraintID of Array.from(this._constraintLines.keys())) {
      this.#removeConstraintLine(constraintID);
    }
    for (const constraintID of Array.from(this._constraintArrowGroups.keys())) {
      this.#removeConstraintArrows(constraintID);
    }
  }

  _removeUnusedConstraintLines(activeIds) {
    for (const constraintID of Array.from(this._constraintLines.keys())) {
      if (!activeIds.has(constraintID)) {
        this.#removeConstraintLine(constraintID);
      }
    }
    for (const constraintID of Array.from(this._constraintArrowGroups.keys())) {
      if (!activeIds.has(constraintID)) {
        this.#removeConstraintArrows(constraintID);
      }
    }
  }

  _resolveReferenceObjects(value) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    const results = [];
    const scene = this.viewer?.scene || null;
    for (const item of values) {
      const resolved = resolveSelectionObject(scene, item);
      if (resolved) results.push(resolved);
    }
    return results;
  }

  _clearNormalArrows() {
    const scene = this.viewer?.scene || null;
    if (!scene || !this._normalArrows) return;
    for (const arrow of this._normalArrows) {
      try { arrow?.parent?.remove?.(arrow); }
      catch { }
    }
    this._normalArrows.clear();
  }

  #constraintVisualData(entry, cls = null) {
    if (!entry?.inputParams) return { segments: [], arrowSpecs: [], labelPosition: null };
    const constraintClass = cls || this._resolveConstraintClass(entry);
    const typeValue = entry?.type || constraintClass?.constraintType;
    const type = typeof typeValue === 'string' ? typeValue.toLowerCase() : String(typeValue || '').toLowerCase();

    if (type === 'distance') {
      const distanceVisual = this.#distanceConstraintVisual(entry);
      if (distanceVisual) return distanceVisual;
      return {
        segments: [],
        arrowSpecs: [],
        labelPosition: this.#constraintStandalonePosition(entry, constraintClass),
      };
    }
    if (type === 'angle') {
      const angleVisual = this.#angleConstraintVisual(entry);
      if (angleVisual) return angleVisual;
      return {
        segments: [],
        arrowSpecs: [],
        labelPosition: this.#constraintStandalonePosition(entry, constraintClass),
      };
    }

    const segments = this.#constraintSegments(entry);
    return {
      segments,
      arrowSpecs: [],
      labelPosition: this.#segmentsMidpoint(segments),
    };
  }

  #distanceConstraintVisual(entry) {
    const points = this.#collectReferenceSelectionPoints(entry, { limit: 2 });
    if (!Array.isArray(points) || points.length < 2) return null;

    const [pointA, pointB] = points;
    if (!pointA || !pointB) return null;

    const pd = entry?.persistentData || {};
    const geometry = buildLinearDimensionGeometry({
      pointA,
      pointB,
      normal: this.#viewerViewNormal(),
      offset: Number(pd.annotationOffset),
      showExtensions: true,
      labelWorld: pd.labelWorld || null,
      screenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
      fallbackScreenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
    });
    if (!geometry) return null;

    return {
      segments: Array.isArray(geometry.segments) ? geometry.segments : [],
      arrowSpecs: Array.isArray(geometry.arrowSpecs) ? geometry.arrowSpecs : [],
      labelPosition: geometry.labelPosition?.clone?.() || null,
    };
  }

  #angleConstraintVisual(entry) {
    const refs = this.#collectConstraintReferenceSelections(entry, { limit: 2 });
    if (!Array.isArray(refs) || refs.length < 2) return null;

    const selectionA = this.#resolveSelectionVisualInfo(refs[0]);
    const selectionB = this.#resolveSelectionVisualInfo(refs[1]);
    if (!selectionA || !selectionB) return null;
    if (!selectionA.origin || !selectionB.origin || !selectionA.direction || !selectionB.direction) return null;

    const dirA0 = selectionA.direction.clone().normalize();
    const dirB0 = selectionB.direction.clone().normalize();
    if (dirA0.lengthSq() <= 1e-12 || dirB0.lengthSq() <= 1e-12) return null;

    let planeNormal = new THREE.Vector3().crossVectors(dirA0, dirB0);
    if (planeNormal.lengthSq() <= 1e-12) {
      planeNormal = this.#viewerViewNormal();
    }
    if (planeNormal.lengthSq() <= 1e-12) return null;
    planeNormal.normalize();
    const planePoint = selectionA.origin.clone().add(selectionB.origin).multiplyScalar(0.5);

    const lineA = this.#lineInPlaneForSelection(selectionA, planeNormal, planePoint);
    const lineB = this.#lineInPlaneForSelection(selectionB, planeNormal, planePoint);
    if (!lineA || !lineB) return null;

    const basis = planeBasis(planeNormal, lineA.direction);
    let pA2 = to2D(lineA.point, planePoint, basis);
    let pB2 = to2D(lineB.point, planePoint, basis);
    let dA2 = dirTo2D(lineA.direction, basis);
    let dB2 = dirTo2D(lineB.direction, basis);
    let anchorA = lineA.point.clone();
    let anchorB = lineB.point.clone();
    if (dA2.lengthSq() <= 1e-12 || dB2.lengthSq() <= 1e-12) return null;
    dA2.normalize();
    dB2.normalize();

    const angleRaw = Number(entry?.inputParams?.angle ?? 0);
    const angleMagnitude = normalizedAngleMagnitude(angleRaw);
    const angleType = angleMagnitude > 90 ? 'obtuse' : 'acute';

    const reverse = Number.isFinite(angleRaw) && angleRaw < 0;
    if (reverse) {
      [pA2, pB2] = [pB2, pA2];
      [dA2, dB2] = [dB2, dA2];
      [anchorA, anchorB] = [anchorB, anchorA];
    }

    let orientation = resolveAngleOrientation2D(dA2, dB2, angleType, true);
    if (!orientation) {
      orientation = resolveAngleOrientation2D(dA2, dB2, 'acute', false);
    }
    if (!orientation) return null;

    const rayA = orientation.start.clone();
    const rayB = orientation.end.clone();
    let vertex2D = intersectLines2D(pA2, rayA, pB2, rayB);
    if (vertex2D) {
      const base = Math.max(1e-6, pA2.distanceTo(pB2));
      const maxDist = Math.max(vertex2D.distanceTo(pA2), vertex2D.distanceTo(pB2));
      if (maxDist > base * 8) vertex2D = null;
    }
    if (!vertex2D) vertex2D = new THREE.Vector2().addVectors(pA2, pB2).multiplyScalar(0.5);

    const pd = entry?.persistentData || {};
    const geometry = buildAngleDimensionGeometry({
      planePoint,
      planeNormal,
      basis,
      vertex2D,
      directionA2D: rayA,
      directionB2D: rayB,
      sweepRad: orientation.sweep,
      sweepDirection: orientation.dirSign,
      bisector2D: orientation.bisector,
      labelWorld: pd.labelWorld || null,
      screenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
      fallbackScreenSizeWorld: (pixels) => screenSizeWorld(this.viewer, pixels),
    });
    if (!geometry) return null;

    const segments = [];
    const arcPoints = Array.isArray(geometry.arcPoints) ? geometry.arcPoints : [];
    for (let i = 0; i < arcPoints.length - 1; i += 1) {
      const start = arcPoints[i];
      const end = arcPoints[i + 1];
      if (!start || !end) continue;
      segments.push([start, end]);
    }
    if (arcPoints.length) {
      const arcStart = arcPoints[0];
      const arcEnd = arcPoints[arcPoints.length - 1];
      if (anchorA && arcStart) segments.push([anchorA.clone(), arcStart.clone()]);
      if (anchorB && arcEnd) segments.push([anchorB.clone(), arcEnd.clone()]);
    }

    return {
      segments,
      arrowSpecs: Array.isArray(geometry.arrowSpecs) ? geometry.arrowSpecs : [],
      labelPosition: geometry.labelPosition?.clone?.() || null,
      planeNormal: planeNormal.clone(),
      planePoint: planePoint.clone(),
    };
  }

  #collectConstraintReferenceSelections(entry, { limit = Infinity } = {}) {
    const cls = this._resolveConstraintClass(entry);
    const schema = cls?.inputParamsSchema || {};
    const refKeys = Object.entries(schema)
      .filter(([, def]) => def?.type === 'reference_selection')
      .map(([key]) => key);
    if (!refKeys.length) return [];

    const results = [];
    const push = (value) => {
      if (value == null || results.length >= limit) return;
      if (Array.isArray(value)) {
        for (const item of value) {
          push(item);
          if (results.length >= limit) break;
        }
        return;
      }
      results.push(value);
    };

    for (const key of refKeys) {
      push(entry?.inputParams?.[key]);
      if (results.length >= limit) break;
    }

    return results;
  }

  #resolveSelectionVisualInfo(selection) {
    if (!selection) return null;
    const objects = this._resolveReferenceObjects(selection);
    const object = Array.isArray(objects) && objects.length ? objects[0] : null;
    if (!object) return null;

    const kind = this.#selectionKindFrom(object, selection);
    let origin = null;
    let direction = null;

    if (kind === 'FACE') {
      origin = computeFaceOrigin(object) || extractWorldPoint(object);
      direction = computeFaceNormal(object) || getElementDirection(null, object);
    } else if (kind === 'EDGE') {
      origin = extractWorldPoint(object);
      direction = getElementDirection(null, object);
    }

    if (!origin || !direction) return null;
    if (direction.lengthSq() <= 1e-12) return null;
    direction = direction.clone().normalize();

    return {
      selection,
      object,
      kind,
      origin: origin.clone ? origin.clone() : new THREE.Vector3(origin.x, origin.y, origin.z),
      direction,
    };
  }

  #selectionKindFrom(object, selection) {
    const val = (selection && typeof selection.kind === 'string') ? selection.kind : null;
    const raw = (object?.userData?.type || object?.userData?.brepType || object?.type || val || '')
      .toString()
      .toUpperCase();
    if (!raw) return 'UNKNOWN';
    if (raw.includes('FACE')) return 'FACE';
    if (raw.includes('EDGE')) return 'EDGE';
    if (raw.includes('VERTEX') || raw.includes('POINT')) return 'POINT';
    if (raw.includes('COMPONENT')) return 'COMPONENT';
    return raw;
  }

  #lineInPlaneForSelection(selectionInfo, planeNormal, planePoint) {
    if (!selectionInfo || !selectionInfo.origin || !selectionInfo.direction) return null;
    if (!planeNormal || planeNormal.lengthSq() <= 1e-12) return null;
    const normal = planeNormal.clone().normalize();
    const anchor = selectionInfo.origin.clone().sub(
      normal.clone().multiplyScalar(selectionInfo.origin.clone().sub(planePoint).dot(normal)),
    );

    let direction = null;
    if (selectionInfo.kind === 'FACE') {
      direction = new THREE.Vector3().crossVectors(selectionInfo.direction, normal);
    } else {
      direction = selectionInfo.direction.clone().projectOnPlane(normal);
    }
    if (!direction || direction.lengthSq() <= 1e-12) {
      direction = selectionInfo.direction.clone().projectOnPlane(normal);
    }
    if (!direction || direction.lengthSq() <= 1e-12) {
      direction = this.#arbitraryPerpendicular(normal).projectOnPlane(normal);
    }
    if (!direction || direction.lengthSq() <= 1e-12) return null;
    direction.normalize();

    return { point: anchor, direction };
  }

  #viewerViewNormal() {
    const camera = this.viewer?.camera || null;
    if (camera && typeof camera.getWorldDirection === 'function') {
      try {
        const dir = camera.getWorldDirection(new THREE.Vector3());
        if (dir.lengthSq() > 1e-12) return dir.normalize();
      } catch { /* ignore */ }
    }
    return new THREE.Vector3(0, 0, 1);
  }

  #segmentsMidpoint(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    const midpoint = new THREE.Vector3();
    let midpointCount = 0;
    for (const [start, end] of segments) {
      if (!start || !end) continue;
      midpoint.add(start.clone().add(end).multiplyScalar(0.5));
      midpointCount += 1;
    }
    if (midpointCount <= 0) return null;
    return midpoint.divideScalar(midpointCount);
  }

  #constraintSegments(entry) {
    if (!entry?.inputParams) return [];
    const refPoints = this.#collectReferenceSelectionPoints(entry, { limit: Infinity });
    if (refPoints.length < 2) return [];

    if (refPoints.length === 2) {
      return [[refPoints[0], refPoints[1]]];
    }

    const anchor = refPoints[0];
    const segments = [];
    for (let i = 1; i < refPoints.length; i += 1) {
      const point = refPoints[i];
      if (!point) continue;
      segments.push([anchor.clone(), point.clone()]);
    }
    return segments;
  }

  #collectReferenceSelectionPoints(entry, { limit = Infinity } = {}) {
    const cls = this._resolveConstraintClass(entry);
    const schema = cls?.inputParamsSchema || {};
    const refKeys = Object.entries(schema)
      .filter(([, def]) => def?.type === 'reference_selection')
      .map(([key]) => key);
    if (!refKeys.length) return [];

    const points = [];
    const pushSelection = (value) => {
      if (!value || points.length >= limit) return;
      if (Array.isArray(value)) {
        for (const item of value) {
          pushSelection(item);
          if (points.length >= limit) break;
        }
        return;
      }
      const point = this.#resolveSelectionPoint(value);
      if (point) points.push(point);
    };

    for (const key of refKeys) {
      pushSelection(entry.inputParams[key]);
      if (points.length >= limit) break;
    }

    return points;
  }

  #upsertConstraintLines(constraintID, segments, color = DEFAULT_CONSTRAINT_COLOR) {
    if (!this._constraintGroup || !Array.isArray(segments) || segments.length === 0) return;
    const lineColor = color || DEFAULT_CONSTRAINT_COLOR;
    if (!this._constraintGroup.parent) {
      try { this.viewer?.scene?.add(this._constraintGroup); } catch { }
    }
    let line = this._constraintLines.get(constraintID);
    if (line && !line.isLineSegments) {
      this.#removeConstraintLine(constraintID);
      line = null;
    }
    if (!line) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(lineColor).getHex(),
        linewidth: 1,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      });
      line = new THREE.LineSegments(geometry, material);
      line.name = `constraint-line-${constraintID}`;
      line.renderOrder = 9999;
      line.userData.excludeFromFit = true;
      try { this._constraintGroup.add(line); } catch { }
      this._constraintLines.set(constraintID, line);
    } else if (line.material) {
      try { line.material.color?.set?.(lineColor); } catch { }
      try { line.material.needsUpdate = true; } catch { }
    }
    if (line) {
      line.userData = line.userData || {};
      line.userData.baseColor = lineColor;
    }

    const vertexCount = segments.length * 2;
    const expectedArrayLength = vertexCount * 3;
    let attr = line.geometry.getAttribute('position');
    if (!attr || attr.count !== vertexCount) {
      const positions = new Float32Array(expectedArrayLength);
      line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      attr = line.geometry.getAttribute('position');
    }

    let writeIndex = 0;
    for (const [start, end] of segments) {
      if (!start || !end) continue;
      attr.setXYZ(writeIndex, start.x, start.y, start.z);
      attr.setXYZ(writeIndex + 1, end.x, end.y, end.z);
      writeIndex += 2;
    }

    if (writeIndex < 2) {
      this.#removeConstraintLine(constraintID);
      return;
    }

    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, writeIndex);
    line.geometry.computeBoundingSphere?.();
  }

  #upsertConstraintArrows(constraintID, arrowSpecs = [], color = DEFAULT_CONSTRAINT_COLOR) {
    if (!this._constraintGroup) return;
    const specs = Array.isArray(arrowSpecs) ? arrowSpecs : [];
    if (specs.length === 0) {
      this.#removeConstraintArrows(constraintID);
      return;
    }
    if (!this._constraintGroup.parent) {
      try { this.viewer?.scene?.add(this._constraintGroup); } catch { }
    }

    let group = this._constraintArrowGroups.get(constraintID);
    if (!group) {
      group = new THREE.Group();
      group.name = `constraint-arrows-${constraintID}`;
      group.userData.excludeFromFit = true;
      try { this._constraintGroup.add(group); } catch { }
      this._constraintArrowGroups.set(constraintID, group);
    }

    const prevChildren = Array.from(group.children || []);
    for (const child of prevChildren) {
      try { group.remove(child); } catch { }
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
    }
    delete group.userData.__hoverOriginal;

    for (const arrow of specs) {
      const tip = arrow?.tip;
      const direction = arrow?.direction;
      if (!tip || !direction) continue;
      const length = Number(arrow?.length);
      const width = Number(arrow?.width);
      const arrowLength = Number.isFinite(length) && length > 0 ? length : screenSizeWorld(this.viewer, 10);
      const arrowWidth = Number.isFinite(width) && width > 0 ? width : screenSizeWorld(this.viewer, 4);
      const mesh = addArrowCone(group, tip, direction, arrowLength, arrowWidth, color);
      if (mesh) {
        mesh.name = `constraint-arrow-${constraintID}`;
        mesh.userData.excludeFromFit = true;
      }
    }

    if (!group.children.length) {
      this.#removeConstraintArrows(constraintID);
    }
  }

  #upsertConstraintVisual(constraintID, visual = {}, color = DEFAULT_CONSTRAINT_COLOR) {
    const segments = Array.isArray(visual?.segments) ? visual.segments : [];
    const arrows = Array.isArray(visual?.arrowSpecs) ? visual.arrowSpecs : [];
    if (segments.length > 0) this.#upsertConstraintLines(constraintID, segments, color);
    else this.#removeConstraintLine(constraintID);
    this.#upsertConstraintArrows(constraintID, arrows, color);
  }

  #removeConstraintArrows(constraintID) {
    const group = this._constraintArrowGroups.get(constraintID);
    if (!group) return;
    const children = Array.from(group.children || []);
    for (const child of children) {
      try { group.remove(child); } catch { }
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
    }
    try { group.parent?.remove(group); } catch { }
    if (group.userData && Object.prototype.hasOwnProperty.call(group.userData, '__hoverOriginal')) {
      delete group.userData.__hoverOriginal;
    }
    this._constraintArrowGroups.delete(constraintID);
  }

  #removeConstraintLine(constraintID) {
    const line = this._constraintLines.get(constraintID);
    if (line) {
      try { line.parent?.remove(line); } catch { }
      try { line.geometry?.dispose?.(); } catch { }
      try { line.material?.dispose?.(); } catch { }
      this._constraintLines.delete(constraintID);
    }
    this.#removeConstraintArrows(constraintID);
  }

  #resolveSelectionPoint(selection) {
    if (!selection) return null;
    const candidates = this._resolveReferenceObjects(selection);
    const object = candidates?.find((obj) => obj) || null;
    if (object) {
      const point = extractWorldPoint(object);
      if (point) return point;
    }
    if (Array.isArray(selection)) {
      for (const item of selection) {
        const point = this.#resolveSelectionPoint(item);
        if (point) return point;
      }
    }
    if (selection && typeof selection === 'object') {
      if (Number.isFinite(selection.x) && Number.isFinite(selection.y) && Number.isFinite(selection.z)) {
        return new THREE.Vector3(selection.x, selection.y, selection.z);
      }
      if (Array.isArray(selection) && selection.length >= 3 && selection.every((v) => Number.isFinite(v))) {
        return new THREE.Vector3(selection[0], selection[1], selection[2]);
      }
      if (selection.point && typeof selection.point === 'object') {
        const p = selection.point;
        if (Array.isArray(p) && p.length >= 3 && p.every((v) => Number.isFinite(v))) {
          return new THREE.Vector3(p[0], p[1], p[2]);
        }
        if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
          return new THREE.Vector3(p.x, p.y, p.z);
        }
      }
      if (selection.origin && Number.isFinite(selection.origin.x)) {
        return new THREE.Vector3(selection.origin.x, selection.origin.y, selection.origin.z);
      }
    }
    return null;
  }

  #constraintStandalonePosition(entry, cls) {
    if (!entry) return null;
    const constraintClass = cls || this._resolveConstraintClass(entry);
    const typeValue = entry?.type || constraintClass?.constraintType;
    const type = typeof typeValue === 'string' ? typeValue.toLowerCase() : String(typeValue || '').toLowerCase();
    if (type === 'fixed') {
      const center = this.#componentBoundingBoxCenter(entry?.inputParams?.component);
      if (center) return center;
    }
    const [firstPoint] = this.#collectReferenceSelectionPoints(entry, { limit: 1 });
    if (firstPoint) return firstPoint;
    return null;
  }

  #componentBoundingBoxCenter(selection) {
    const objects = this._resolveReferenceObjects(selection);
    if (!objects || objects.length === 0) return null;

    const totalBox = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    let hasBox = false;

    for (const obj of objects) {
      if (!obj) continue;
      try { obj.updateMatrixWorld?.(true); }
      catch { }

      tmpBox.makeEmpty();
      tmpBox.setFromObject(obj);

      const min = tmpBox.min;
      const max = tmpBox.max;
      const valid = Number.isFinite(min.x) && Number.isFinite(min.y) && Number.isFinite(min.z)
        && Number.isFinite(max.x) && Number.isFinite(max.y) && Number.isFinite(max.z)
        && !tmpBox.isEmpty();
      if (!valid) continue;

      if (!hasBox) {
        totalBox.copy(tmpBox);
        hasBox = true;
      } else {
        totalBox.union(tmpBox);
      }
    }

    if (hasBox) {
      const center = totalBox.getCenter(new THREE.Vector3());
      if (center && Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
        return center;
      }
    }

    for (const obj of objects) {
      const fallback = extractWorldPoint(obj);
      if (fallback) return fallback;
    }

    return null;
  }

  #resolveFocusFieldForConstraint(entry) {
    const constraintClass = this._resolveConstraintClass(entry);
    const field = constraintClass?.focusField;
    if (field) return field;
    const type = constraintClass?.constraintType || entry?.type || entry?.inputParams?.type;
    const normalized = typeof type === 'string' ? type.toLowerCase() : '';
    if (normalized === 'distance') return 'distance';
    if (normalized === 'angle') return 'angle';
    return null;
  }

  #findConstraintEntryById(id) {
    if (id == null) return null;
    const targetId = String(id);
    if (!targetId) return null;
    const entries = this.history?.list?.() || [];
    return entries.find((entry) => resolveConstraintId(entry) === targetId) || null;
  }

  #handleLabelPointerDown(idx, _ann, ev) {
    if (idx == null || !ev) return;
    const id = String(idx);
    if (!id) return;
    const entry = this.#findConstraintEntryById(id);
    if (!entry) return;
    const constraintClass = this._resolveConstraintClass(entry);
    const typeValue = entry?.type || constraintClass?.constraintType;
    const type = typeof typeValue === 'string' ? typeValue.toLowerCase() : String(typeValue || '').toLowerCase();
    if (type === 'distance') {
      this.#beginDistanceLabelDrag(id, entry, ev, constraintClass);
      return;
    }
    if (type === 'angle') {
      this.#beginAngleLabelDrag(id, entry, ev, constraintClass);
    }
  }

  #beginDistanceLabelDrag(constraintID, entry, event, constraintClass = null) {
    const points = this.#collectReferenceSelectionPoints(entry, { limit: 2 });
    if (!Array.isArray(points) || points.length < 2) return;
    const pointA = points[0]?.clone?.();
    const pointB = points[1]?.clone?.();
    if (!pointA || !pointB) return;

    const direction = pointB.clone().sub(pointA);
    if (direction.lengthSq() < 1e-12) return;
    direction.normalize();

    const planeNormal = this.#viewerViewNormal();
    let tangent = new THREE.Vector3().crossVectors(planeNormal, direction);
    if (tangent.lengthSq() < 1e-12) {
      tangent = this.#arbitraryPerpendicular(direction);
    } else {
      tangent.normalize();
    }
    if (tangent.lengthSq() < 1e-12) return;

    const midpoint = pointA.clone().add(pointB).multiplyScalar(0.5);
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, midpoint);

    const controls = this.viewer?.controls || null;
    const previousControlsEnabled = controls ? controls.enabled !== false : false;
    try { if (controls) controls.enabled = false; } catch { /* ignore */ }

    const onMove = (moveEvent) => {
      const hit = this.#intersectPointerWithPlane(moveEvent, dragPlane);
      if (!hit) return;

      if (!entry.persistentData || typeof entry.persistentData !== 'object') {
        entry.persistentData = {};
      }
      const toHit = hit.clone().sub(midpoint);
      const offset = toHit.dot(tangent);
      entry.persistentData.annotationOffset = Number.isFinite(offset) ? offset : 0;
      entry.persistentData.labelWorld = [hit.x, hit.y, hit.z];
      this.#refreshConstraintVisualFromEntry(constraintID, entry, constraintClass);
    };

    const onUp = (upEvent) => {
      try { window.removeEventListener('pointermove', onMove, true); } catch { /* ignore */ }
      try { window.removeEventListener('pointerup', onUp, true); } catch { /* ignore */ }
      try { if (controls) controls.enabled = previousControlsEnabled; } catch { /* ignore */ }
      this._scheduleSync();
      try {
        upEvent?.preventDefault?.();
        upEvent?.stopImmediatePropagation?.();
        upEvent?.stopPropagation?.();
      } catch { /* ignore */ }
    };

    try { window.addEventListener('pointermove', onMove, true); } catch { /* ignore */ }
    try { window.addEventListener('pointerup', onUp, true); } catch { /* ignore */ }
    onMove(event);
  }

  #beginAngleLabelDrag(constraintID, entry, event, constraintClass = null) {
    const cls = constraintClass || this._resolveConstraintClass(entry);
    const visual = this.#constraintVisualData(entry, cls);
    const planeNormal = visual?.planeNormal?.clone?.() || this.#viewerViewNormal();
    const planePoint = visual?.planePoint?.clone?.()
      || this.#constraintStandalonePosition(entry, cls)
      || this.#segmentsMidpoint(visual?.segments || [])
      || new THREE.Vector3();
    if (!planeNormal || planeNormal.lengthSq() <= 1e-12 || !planePoint) return;
    planeNormal.normalize();

    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
    const controls = this.viewer?.controls || null;
    const previousControlsEnabled = controls ? controls.enabled !== false : false;
    try { if (controls) controls.enabled = false; } catch { /* ignore */ }

    const onMove = (moveEvent) => {
      const hit = this.#intersectPointerWithPlane(moveEvent, dragPlane);
      if (!hit) return;
      if (!entry.persistentData || typeof entry.persistentData !== 'object') {
        entry.persistentData = {};
      }
      entry.persistentData.labelWorld = [hit.x, hit.y, hit.z];
      this.#refreshConstraintVisualFromEntry(constraintID, entry, cls);
    };

    const onUp = (upEvent) => {
      try { window.removeEventListener('pointermove', onMove, true); } catch { /* ignore */ }
      try { window.removeEventListener('pointerup', onUp, true); } catch { /* ignore */ }
      try { if (controls) controls.enabled = previousControlsEnabled; } catch { /* ignore */ }
      this._scheduleSync();
      try {
        upEvent?.preventDefault?.();
        upEvent?.stopImmediatePropagation?.();
        upEvent?.stopPropagation?.();
      } catch { /* ignore */ }
    };

    try { window.addEventListener('pointermove', onMove, true); } catch { /* ignore */ }
    try { window.addEventListener('pointerup', onUp, true); } catch { /* ignore */ }
    onMove(event);
  }

  #refreshConstraintVisualFromEntry(constraintID, entry, constraintClass = null) {
    if (!constraintID || !entry) return;
    const cls = constraintClass || this._resolveConstraintClass(entry);
    const visual = this.#constraintVisualData(entry, cls);
    const segments = Array.isArray(visual?.segments) ? visual.segments : [];
    const arrowSpecs = Array.isArray(visual?.arrowSpecs) ? visual.arrowSpecs : [];
    const statusInfo = constraintStatusInfo(entry);
    const color = statusInfo?.color || DEFAULT_CONSTRAINT_COLOR;

    if ((segments.length > 0) || (arrowSpecs.length > 0)) {
      this.#upsertConstraintVisual(constraintID, { segments, arrowSpecs }, color);
    } else {
      this.#removeConstraintLine(constraintID);
    }

    const labelPosition = visual?.labelPosition?.clone?.()
      || this.#segmentsMidpoint(segments)
      || this.#constraintStandalonePosition(entry, cls);
    if (!labelPosition) {
      this._labelPositions.delete(constraintID);
      this.#requestViewerRender();
      return;
    }

    const text = constraintLabelText(entry, cls, this.partHistory);
    const overlayData = { id: constraintID, constraintID };
    this._labelPositions.set(constraintID, {
      position: labelPosition.clone(),
      text,
      data: overlayData,
      entry,
      color,
    });

    if (this._constraintGraphicsEnabled) {
      try { this._labelOverlay?.updateLabel(constraintID, text, labelPosition.clone(), overlayData); } catch { }
      const el = this._labelOverlay?.getElement?.(constraintID);
      if (el) {
        try {
          el.classList.add('constraint-label');
          el.dataset.constraintId = constraintID;
        } catch { /* ignore */ }
        this.#applyConstraintLabelColor(el, color);
        this.#attachLabelHoverHandlers(el, entry, constraintID);
      }
    }

    this.#requestViewerRender();
  }

  #intersectPointerWithPlane(event, plane) {
    const ray = this.#rayFromPointerEvent(event);
    if (!ray || !plane) return null;
    const hit = new THREE.Vector3();
    const ok = ray.intersectPlane(plane, hit);
    return ok ? hit : null;
  }

  #rayFromPointerEvent(event) {
    const camera = this.viewer?.camera || null;
    const domElement = this.viewer?.renderer?.domElement || null;
    if (!camera || !domElement || !event) return null;
    const rect = domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!this._labelDragRaycaster) this._labelDragRaycaster = new THREE.Raycaster();
    this._labelDragRaycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    return this._labelDragRaycaster.ray;
  }

  #arbitraryPerpendicular(direction) {
    if (!direction || direction.lengthSq() === 0) return new THREE.Vector3(0, 0, 1);
    const axis = Math.abs(direction.dot(new THREE.Vector3(0, 0, 1))) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(direction, axis);
    if (perp.lengthSq() === 0) {
      perp.crossVectors(direction, new THREE.Vector3(1, 0, 0));
    }
    return perp.lengthSq() === 0 ? new THREE.Vector3(1, 0, 0) : perp.normalize();
  }

  #handleLabelClick(idx, _ann, ev) {
    if (idx == null) return;
    const id = String(idx);
    if (!id) return;
    if (ev) {
      try { ev.preventDefault(); } catch { }
      try { ev.stopPropagation(); } catch { }
    }
    const entries = this.history?.list?.() || [];
    const targetEntry = this.#findConstraintEntryById(id);

    let changed = false;
    if (typeof this.history?.setExclusiveOpen === 'function') {
      changed = this.history.setExclusiveOpen(id);
    }
    if (!changed) {
      for (const entry of entries) {
        const entryId = resolveConstraintId(entry);
        const shouldOpen = entryId === id;
        const current = entry?.__open !== false;
        if (current !== shouldOpen) {
          this.history?.setOpenState(entryId, shouldOpen);
        }
      }
      this.history?.setOpenState?.(id, true);
    }

    const focusField = this.#resolveFocusFieldForConstraint(targetEntry);
    this._constraintList?.focusEntryById?.(id, { focusField });
  }

  _createNormalArrow(object, color, label) {
    const scene = this.viewer?.scene || null;
    if (!scene || !object) return;

    const origin = computeFaceOrigin(object);
    const normal = computeFaceNormal(object);
    if (!origin || !normal) return;

    const hexColor = new THREE.Color(color).getHex();
    const length = estimateArrowLength(object);
    const arrow = new THREE.ArrowHelper(normal, origin, length, hexColor, length * 0.25, length * 0.15);
    arrow.name = `selection-normal-${object.uuid}-${label || 'face'}`;
    scene.add(arrow);
    this._normalArrows.add(arrow);
    return arrow;
  }

  _buildUpdateComponentsButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'update-components-btn';
    btn.title = 'Update assembly components';
    btn.textContent = 'Update components';
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await this._handleUpdateComponents();
    });
    return btn;
  }

  async _refreshUpdateComponentsButton() {
    const btn = this._updateComponentsBtn;
    if (!btn) return;

    let count = 0;
    try {
      if (this.partHistory && typeof this.partHistory.getOutdatedAssemblyComponentCount === 'function') {
        count = Number(await this.partHistory.getOutdatedAssemblyComponentCount()) || 0;
      }
    } catch {
      count = 0;
    }

    const busy = this._updatingComponents;
    const baseLabel = 'Update components';
    const hasOutdated = count > 0;
    btn.disabled = busy || !hasOutdated;
    btn.classList.toggle('needs-update', hasOutdated && !busy);
    btn.textContent = hasOutdated ? `${baseLabel} (${count})` : baseLabel;
    btn.setAttribute('data-outdated-count', String(hasOutdated ? count : 0));
    if (busy) {
      btn.title = 'Updating assembly components…';
    } else if (hasOutdated) {
      btn.title = 'Update assembly components to pull the latest saved versions.';
    } else {
      btn.title = 'Assembly components are up to date.';
    }
  }

  async _handleUpdateComponents() {
    if (this._updatingComponents) return;
    if (!this.partHistory || typeof this.partHistory.updateAssemblyComponents !== 'function') return;

    this._updatingComponents = true;
    void this._refreshUpdateComponentsButton();

    try {
      const result = await this.partHistory.updateAssemblyComponents({ rerun: true });
      if (result?.updatedCount > 0 || result?.reran) {
        this._scheduleSync();
      }
    } catch (error) {
      console.warn('[AssemblyConstraintsWidget] Failed to update components:', error);
    } finally {
      this._updatingComponents = false;
      void this._refreshUpdateComponentsButton();
    }
  }

  _resolveConstraintClass(entry) {
    if (!entry) return null;
    if (entry.constraintClass) return entry.constraintClass;
    const type = entry.type || entry.inputParams?.type;
    if (!type) return null;
    if (this.registry && typeof this.registry.getSafe === 'function') {
      const cls = this.registry.getSafe(type);
      if (cls) return cls;
    }
    if (this.registry && typeof this.registry.get === 'function') {
      try { return this.registry.get(type); }
      catch { return null; }
    }
    return null;
  }

}

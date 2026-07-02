import { HistoryCollectionWidget } from '../history/HistoryCollectionWidget.js';
import { FloatingWindow } from '../FloatingWindow.js';

type AnyRecord = Record<string, any>;

async function waitForProgressPaint(): Promise<void> {
  if (typeof window === 'undefined') {
    await Promise.resolve();
    return;
  }
  const raf = window.requestAnimationFrame;
  if (typeof raf === 'function') {
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: number | null = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer != null) window.clearTimeout(timer);
        resolve();
      };
      timer = window.setTimeout(done, 50);
      raf(() => done());
    });
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function sanitizeFileName(raw: any, fallback = 'brep-cam.nc') {
  const text = String(raw ?? '').trim() || fallback;
  const cleaned = text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function gcodeDownloadFileName(raw: any) {
  const cleaned = sanitizeFileName(raw || 'brep-cam', 'brep-cam');
  if (/\.(nc|gcode|tap)$/i.test(cleaned)) return cleaned;
  const stem = cleaned.replace(/\.(brep|json|step|stp|iges|igs|stl|obj|3mf|glb|gltf)$/i, '') || 'brep-cam';
  return `${stem}.nc`;
}

function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text || ''], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function formatElapsedDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const tenths = Math.max(0, Math.floor((Number(ms) || 0) / 100) / 10);
  return `${tenths.toFixed(1)}s`;
}

export class CamHistoryWidget {
  viewer: any;
  uiElement: HTMLDivElement;
  machineConfigEl!: HTMLDivElement;
  gcodeEl!: HTMLDivElement;
  historyEl!: HTMLDivElement;
  machineEl!: HTMLDivElement;
  stockEl!: HTMLDivElement;
  controlsEl!: HTMLDivElement;
  simulationEl!: HTMLDivElement;
  visualEl!: HTMLDivElement;
  statusEl!: HTMLDivElement;
  programEl!: HTMLDivElement;
  historyWidget: any = null;
  _camListener: (() => void) | null = null;
  _runtime: any = null;
  _runtimePromise: Promise<any> | null = null;
  _runtimeSimulationUnsubscribe: (() => void) | null = null;
  _generationAbortController: AbortController | null = null;
  _generating = false;
  _generationProgress: AnyRecord | null = null;
  _visualOptions: AnyRecord = {
    toolpath: true,
    tool: true,
    sweptVolume: true,
    stock: true,
  };

  constructor(viewer: any) {
    this.viewer = viewer || null;
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'cam-history-widget-root';
    this._ensureStyles();
    this._buildUI();
    this.refresh();
    this._attachCamListener();
  }

  dispose(): void {
    if (typeof this._camListener === 'function') {
      try { this._camListener(); } catch { /* ignore listener cleanup */ }
    }
    this._camListener = null;
    try { this._runtime?.clearPreview?.(); } catch { /* ignore */ }
    try { this._runtimeSimulationUnsubscribe?.(); } catch { /* ignore listener cleanup */ }
    this._runtimeSimulationUnsubscribe = null;
    this._runtime = null;
    this._cancelGeneration();
    this._closeGenerationProgress();
    try { this.historyWidget?.dispose?.(); } catch { /* ignore widget cleanup */ }
    this.historyWidget = null;
  }

  setPanelVisible(visible: boolean): void {
    try { this.historyWidget?.setContextSuppressionEnabled?.(visible !== false); } catch { /* ignore visibility sync */ }
  }

  refresh(): void {
    this._renderMachineSettings();
    this._renderStockSettings();
    this._renderControls();
    this._renderSimulationControls();
    this._renderVisualizationControls();
    this._renderStatus();
    this._renderProgram();
    try { this.historyWidget?.render?.(); } catch { /* ignore render errors */ }
  }

  refreshFromHistory(): void {
    this.refresh();
  }

  _attachCamListener(): void {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    if (!manager?.addListener) return;
    this._camListener = manager.addListener((payload: AnyRecord = {}) => {
      if (
        payload.reason === 'invalidate'
        || payload.reason === 'machine-profile'
        || payload.reason === 'stock-profile'
        || payload.reason === 'load'
        || payload.reason === 'clear'
      ) {
        try { this._runtime?.clearPreview?.(); } catch { /* ignore stale preview cleanup */ }
      }
      if (payload.reason === 'machine-profile' || payload.reason === 'load' || payload.reason === 'clear') {
        this._renderMachineSettings();
      }
      if (payload.reason === 'stock-profile' || payload.reason === 'load' || payload.reason === 'clear') {
        this._renderStockSettings();
      }
      this._renderStatus();
      this._renderProgram();
      this._renderSimulationControls();
    });
  }

  _buildUI(): void {
    this.machineConfigEl = document.createElement('div');
    this.machineConfigEl.className = 'cam-machine-config-panel';

    this.machineEl = document.createElement('div');
    this.machineEl.className = 'cam-machine-panel';
    this.machineConfigEl.appendChild(this.machineEl);

    this.stockEl = document.createElement('div');
    this.stockEl.className = 'cam-stock-panel';
    this.machineConfigEl.appendChild(this.stockEl);

    this.gcodeEl = document.createElement('div');
    this.gcodeEl.className = 'cam-gcode-panel';

    this.historyEl = document.createElement('div');
    this.historyEl.className = 'cam-history-panel';

    this.controlsEl = document.createElement('div');
    this.controlsEl.className = 'cam-history-controls';
    this.historyEl.appendChild(this.controlsEl);

    this.simulationEl = document.createElement('div');
    this.simulationEl.className = 'cam-simulation-panel';
    this.historyEl.appendChild(this.simulationEl);

    this.visualEl = document.createElement('div');
    this.visualEl.className = 'cam-visual-panel';
    this.historyEl.appendChild(this.visualEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'cam-history-status';
    this.historyEl.appendChild(this.statusEl);

    this.programEl = document.createElement('div');
    this.programEl.className = 'cam-program-panel';
    this.gcodeEl.appendChild(this.programEl);

    const manager = this.viewer?.partHistory?.camPlanManager || null;
    this.historyWidget = new HistoryCollectionWidget({
      history: manager,
      viewer: this.viewer,
      autoSyncOpenState: true,
      createEntry: async (typeStr: string) => manager?.createOperation?.(typeStr) || null,
      onEntryChange: ({ entry, details }: AnyRecord = {}) => {
        manager?.invalidateOperation?.(entry, details?.key ? `field:${details.key}` : 'operation-edit');
        try { this._runtime?.clearPreview?.(); } catch { /* ignore stale preview cleanup */ }
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-operation' });
        this._renderControls();
        this._renderSimulationControls();
        this._renderStatus();
        this._renderProgram();
      },
      onCollectionChange: () => {
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-operation' });
        this._renderControls();
        this._renderSimulationControls();
        this._renderStatus();
      },
      entryToggle: {
        isEnabled: ({ entry }: AnyRecord = {}) => entry?.inputParams?.enabled !== false,
        setEnabled: ({ entry }: AnyRecord = {}, enabled: boolean) => {
          if (!entry) return;
          if (typeof entry.mergeParams === 'function') {
            entry.mergeParams({ enabled });
          } else {
            entry.inputParams = { ...(entry.inputParams || {}), enabled };
          }
          manager?.invalidateOperation?.(entry, 'field:enabled');
          this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-operation' });
          this._renderControls();
          this._renderSimulationControls();
          this._renderStatus();
          this._renderProgram();
        },
        getTitle: ({ entry }: AnyRecord = {}) => (
          entry?.inputParams?.enabled === false ? 'Enable CAM operation' : 'Disable CAM operation'
        ),
        className: 'cam-operation-enabled-toggle',
      },
    });
    this.historyEl.appendChild(this.historyWidget.uiElement);
    this.uiElement.appendChild(this.historyEl);
    this.uiElement.appendChild(this.machineConfigEl);
    this.uiElement.appendChild(this.gcodeEl);
  }

  _queueMachineSnapshot(): void {
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-machine-profile' });
  }

  _queueStockSnapshot(): void {
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-stock-profile' });
  }

  _renderMachineSettings(): void {
    if (!this.machineEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    this.machineEl.textContent = '';
    if (!manager) {
      this.machineEl.hidden = true;
      return;
    }
    this.machineEl.hidden = false;
    const profile = manager.getMachineProfile?.() || manager.machineProfile || {};

    const header = document.createElement('div');
    header.className = 'cam-machine-header';
    header.textContent = 'Machine';
    this.machineEl.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cam-machine-grid';
    this.machineEl.appendChild(grid);

    const update = (patch: AnyRecord) => {
      manager.updateMachineProfile?.(patch);
      this._queueMachineSnapshot();
      this._renderStatus();
    };

    const addText = (labelText: string, value: any, onChange: (value: string) => void) => {
      const label = document.createElement('label');
      label.className = 'cam-machine-field';
      const span = document.createElement('span');
      span.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value ?? '');
      input.addEventListener('change', () => onChange(input.value));
      label.appendChild(span);
      label.appendChild(input);
      grid.appendChild(label);
      return input;
    };

    const addNumber = (labelText: string, value: any, onChange: (value: number) => void) => {
      const label = document.createElement('label');
      label.className = 'cam-machine-field';
      const span = document.createElement('span');
      span.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      input.value = String(Number(value) || 0);
      input.addEventListener('change', () => onChange(Number(input.value)));
      label.appendChild(span);
      label.appendChild(input);
      grid.appendChild(label);
      return input;
    };

    addText('Name', profile.name, (value) => update({ name: value }));

    const controllerLabel = document.createElement('label');
    controllerLabel.className = 'cam-machine-field';
    const controllerText = document.createElement('span');
    controllerText.textContent = 'Controller';
    const controller = document.createElement('select');
    for (const value of ['grbl', 'linuxcnc', 'fanuc']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.toUpperCase();
      if (profile.controller === value) option.selected = true;
      controller.appendChild(option);
    }
    controller.addEventListener('change', () => update({ controller: controller.value }));
    controllerLabel.appendChild(controllerText);
    controllerLabel.appendChild(controller);
    grid.appendChild(controllerLabel);

    addNumber('Max RPM', profile.maxSpindleRPM, (value) => update({ maxSpindleRPM: value }));
    addNumber('Rapid', profile.defaultRapidRate, (value) => update({ defaultRapidRate: value }));
    addNumber('Park Z', profile.safeParkZ, (value) => update({ safeParkZ: value }));

    const advanced = document.createElement('details');
    advanced.className = 'cam-machine-advanced';
    const advancedSummary = document.createElement('summary');
    advancedSummary.textContent = 'Postprocessor';
    advanced.appendChild(advancedSummary);
    this.machineEl.appendChild(advanced);

    const toggles = document.createElement('div');
    toggles.className = 'cam-machine-toggles';
    advanced.appendChild(toggles);

    const addToggle = (labelText: string, checked: boolean, onChange: (value: boolean) => void) => {
      const label = document.createElement('label');
      label.className = 'cam-machine-toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      const span = document.createElement('span');
      span.textContent = labelText;
      input.addEventListener('change', () => onChange(input.checked));
      label.appendChild(input);
      label.appendChild(span);
      toggles.appendChild(label);
    };

    addToggle('Token spaces', profile.tokenSpacer !== false, (value) => update({ tokenSpacer: value }));
    addToggle('Strip comments', profile.stripComments === true, (value) => update({ stripComments: value }));

    const macros = document.createElement('div');
    macros.className = 'cam-machine-macros';
    advanced.appendChild(macros);

    const addMacro = (labelText: string, value: any, onChange: (value: string) => void) => {
      const label = document.createElement('label');
      label.className = 'cam-machine-macro';
      const span = document.createElement('span');
      span.textContent = labelText;
      const textarea = document.createElement('textarea');
      textarea.rows = 2;
      textarea.value = String(value ?? '');
      textarea.addEventListener('change', () => onChange(textarea.value));
      label.appendChild(span);
      label.appendChild(textarea);
      macros.appendChild(label);
    };

    addMacro('Header', profile.header, (value) => update({ header: value }));
    addMacro('Footer', profile.footer, (value) => update({ footer: value }));
  }

  _renderStockSettings(): void {
    if (!this.stockEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    this.stockEl.textContent = '';
    if (!manager) {
      this.stockEl.hidden = true;
      return;
    }
    this.stockEl.hidden = false;
    const profile = manager.getStockProfile?.() || manager.stockProfile || {};
    const fixed = profile.mode === 'fixed';

    const header = document.createElement('div');
    header.className = 'cam-stock-header';
    header.textContent = 'Stock';
    this.stockEl.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cam-stock-grid';
    this.stockEl.appendChild(grid);

    const update = (patch: AnyRecord) => {
      manager.updateStockProfile?.(patch);
      this._queueStockSnapshot();
      this._renderStatus();
    };

    const addSelect = (labelText: string, value: any, options: Array<[string, string]>, onChange: (value: string) => void) => {
      const label = document.createElement('label');
      label.className = 'cam-stock-field';
      const span = document.createElement('span');
      span.textContent = labelText;
      const select = document.createElement('select');
      for (const [optionValue, optionText] of options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionText;
        if (value === optionValue) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => onChange(select.value));
      label.appendChild(span);
      label.appendChild(select);
      grid.appendChild(label);
      return select;
    };

    const addNumber = (
      labelText: string,
      value: any,
      onChange: (value: number | null) => void,
      options: { disabled?: boolean; nullable?: boolean; placeholder?: string } = {},
    ) => {
      const label = document.createElement('label');
      label.className = 'cam-stock-field';
      const span = document.createElement('span');
      span.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      input.disabled = options.disabled === true;
      input.placeholder = options.placeholder || '';
      const hasNullableValue = options.nullable && (value == null || value === '');
      const numericValue = Number(value);
      input.value = (hasNullableValue || (options.nullable && !Number.isFinite(numericValue)))
        ? ''
        : String(Number.isFinite(numericValue) ? numericValue : 0);
      input.addEventListener('change', () => {
        const trimmed = input.value.trim();
        const next = Number(trimmed);
        if (options.nullable && (trimmed === '' || !Number.isFinite(next))) {
          onChange(null);
          return;
        }
        onChange(next);
      });
      label.appendChild(span);
      label.appendChild(input);
      grid.appendChild(label);
      return input;
    };

    addSelect('Mode', profile.mode, [
      ['auto', 'Auto fit'],
      ['fixed', 'Fixed size'],
    ], (value) => update({ mode: value }));
    addNumber('Margin', profile.margin, (value) => update({ margin: value ?? 0 }));
    if (fixed) {
      addNumber('Size X', profile.sizeX, (value) => update({ sizeX: value }), { nullable: true, placeholder: 'Auto' });
      addNumber('Size Y', profile.sizeY, (value) => update({ sizeY: value }), { nullable: true, placeholder: 'Auto' });
      addNumber('Size Z', profile.sizeZ, (value) => update({ sizeZ: value }), { nullable: true, placeholder: 'Auto' });
      addNumber('Offset X', profile.offsetX, (value) => update({ offsetX: value ?? 0 }));
      addNumber('Offset Y', profile.offsetY, (value) => update({ offsetY: value ?? 0 }));
      addNumber('Offset Z', profile.offsetZ, (value) => update({ offsetZ: value ?? 0 }));
    }
  }

  async _ensureRuntime() {
    if (this._runtime) return this._runtime;
    if (this._runtimePromise) return this._runtimePromise;
    if (typeof this.viewer?._ensureCamWorkbenchManager === 'function') {
      this._runtimePromise = this.viewer._ensureCamWorkbenchManager()
        .then((runtime) => {
          this._runtime = runtime;
          this._runtime?.setActive?.(true);
          this._runtime?.setVisualizationOptions?.(this._visualOptions);
          this._attachRuntimeSimulationListener();
          return this._runtime;
        })
        .finally(() => {
          this._runtimePromise = null;
        });
      return this._runtimePromise;
    }
    this._runtimePromise = import('../../cam/CamWorkbenchManager.js')
      .then(({ CamWorkbenchManager }) => {
        this._runtime = new CamWorkbenchManager(this.viewer);
        this._runtime.setActive?.(true);
        this._runtime.setVisualizationOptions?.(this._visualOptions);
        this._attachRuntimeSimulationListener();
        return this._runtime;
      })
      .finally(() => {
        this._runtimePromise = null;
      });
    return this._runtimePromise;
  }

  _attachRuntimeSimulationListener(): void {
    if (!this._runtime?.addSimulationListener || this._runtimeSimulationUnsubscribe) return;
    this._runtimeSimulationUnsubscribe = this._runtime.addSimulationListener(() => {
      this._renderSimulationControls();
      this._renderControls();
    });
  }

  async _generate() {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    if (!manager || this._generating) return;
    this._generating = true;
    const abortController = new AbortController();
    this._generationAbortController = abortController;
    this._renderControls();
    const progress = this._openGenerationProgress(() => this._cancelGeneration());
    progress.update({
      phase: 'start',
      message: 'Starting CAM generation',
      detail: 'Reading configured operations and target solids.',
      current: 0,
      total: 100,
    });
    await waitForProgressPaint();
    try {
      const progressOptions = {
        onProgress: (event: AnyRecord = {}) => progress.update(event),
        progressYield: waitForProgressPaint,
        signal: abortController.signal,
      };
      const plan = typeof manager.generateAllAsync === 'function'
        ? await manager.generateAllAsync(this.viewer, progressOptions)
        : manager.generateAll(this.viewer);
      if (abortController.signal.aborted) throw this._generationAbortError(abortController.signal);
      const pathCount = Number(plan?.summary?.pathCount) || 0;
      progress.update({
        phase: 'history',
        message: 'Saving generated CAM program',
        detail: 'Persisting the generated paths and G-code in part history.',
        current: 96,
        total: 100,
      });
      await waitForProgressPaint();
      this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-generate' });
      this.refresh();
      if (!pathCount) {
        const feedback = this._formatNoToolpathFeedback(plan);
        progress.update({
          phase: 'empty',
          message: 'No toolpaths generated',
          detail: feedback,
          current: 100,
          total: 100,
          tone: 'warn',
        });
        this._setStatus(`No toolpaths generated: ${feedback}`, 'warn');
        this._closeGenerationProgress(7000);
        return;
      }
      progress.update({
        phase: 'preview',
        message: 'Preparing CAM preview',
        detail: 'Updating the toolpath, tool, swept volume, and stock visualization.',
        current: 98,
        total: 100,
      });
      await waitForProgressPaint();
      const runtime = await this._ensureRuntime();
      runtime.setVisualizationOptions?.(this._visualOptions);
      runtime.preview?.(plan);
      this._renderSimulationControls();
      progress.update({
        phase: 'complete',
        message: 'CAM toolpaths ready',
        detail: `${pathCount} path${pathCount === 1 ? '' : 's'} generated.`,
        current: 100,
        total: 100,
      });
      this._closeGenerationProgress(900);
    } catch (error: any) {
      const message = String(error?.message || error || 'Unknown CAM generation error');
      if (this._isGenerationAbort(error) || abortController.signal.aborted) {
        progress.update({
          phase: 'canceled',
          message: 'CAM generation stopped',
          detail: 'Toolpath generation was interrupted before saving a new program.',
          current: 100,
          total: 100,
          tone: 'warn',
        });
        progress.setComplete?.();
        this._setStatus('CAM generation stopped before saving a new program.', 'warn');
        this._closeGenerationProgress(4000);
        return;
      }
      progress.update({
        phase: 'error',
        message: 'CAM generation failed',
        detail: message,
        current: 100,
        total: 100,
        tone: 'error',
      });
      this._setStatus(`CAM generation failed: ${message}`, 'warn');
      try { console.error(error); } catch { /* ignore console failures */ }
      this._closeGenerationProgress(5000);
    } finally {
      if (this._generationAbortController === abortController) this._generationAbortController = null;
      this._generating = false;
      this._renderControls();
    }
  }

  _generationAbortError(signal: AbortSignal) {
    const reason = signal.reason;
    const error = new Error(String(reason?.message || reason || 'CAM generation canceled'));
    error.name = 'AbortError';
    return error;
  }

  _isGenerationAbort(error: any) {
    return error?.name === 'AbortError'
      || String(error?.message || error || '').toLowerCase().includes('generation canceled');
  }

  _cancelGeneration(): void {
    const controller = this._generationAbortController;
    if (!controller || controller.signal.aborted) return;
    this._generationProgress?.setCanceling?.();
    try {
      controller.abort(new Error('CAM generation canceled'));
    } catch {
      controller.abort();
    }
  }

  _openGenerationProgress(onCancel: (() => void) | null = null): AnyRecord {
    this._closeGenerationProgress();
    const panel = document.createElement('section');
    panel.className = 'cam-generation-progress';

    const status = document.createElement('div');
    status.className = 'cam-generation-progress-status';
    status.textContent = 'Preparing...';
    panel.appendChild(status);

    const detail = document.createElement('div');
    detail.className = 'cam-generation-progress-detail';
    panel.appendChild(detail);

    const runtime = document.createElement('div');
    runtime.className = 'cam-generation-progress-runtime';
    runtime.textContent = 'Elapsed 0.0s';
    panel.appendChild(runtime);

    const meterRow = document.createElement('div');
    meterRow.className = 'cam-generation-progress-meter-row';
    const meter = document.createElement('div');
    meter.className = 'cam-generation-progress-meter';
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'cam-generation-progress-fill';
    meter.appendChild(fill);
    const percent = document.createElement('output');
    percent.className = 'cam-generation-progress-percent';
    percent.textContent = '0%';
    meterRow.appendChild(meter);
    meterRow.appendChild(percent);
    panel.appendChild(meterRow);

    const log = document.createElement('div');
    log.className = 'cam-generation-progress-log';
    panel.appendChild(log);

    const actions = document.createElement('div');
    actions.className = 'cam-generation-progress-actions';
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'cam-generation-progress-stop';
    stopButton.textContent = 'Stop';
    stopButton.title = 'Stop toolpath generation';
    stopButton.setAttribute('aria-label', 'Stop toolpath generation');
    stopButton.addEventListener('click', () => {
      stopButton.disabled = true;
      stopButton.textContent = 'Stopping...';
      try { onCancel?.(); } catch { /* ignore progress cancel callback */ }
    });
    actions.appendChild(stopButton);
    panel.appendChild(actions);

    const floating = new FloatingWindow({
      title: 'Generating Toolpaths',
      width: 440,
      height: 285,
      minWidth: 320,
      minHeight: 220,
      right: 24,
      top: 82,
      zIndex: 50000,
      modal: false,
      closable: false,
    });
    floating.content?.appendChild(panel);

    let lastMessage = '';
    let closeTimer: number | null = null;
    const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const startedAt = nowMs();
    let elapsedTimer: number | null = null;
    const updateElapsed = () => {
      runtime.textContent = `Elapsed ${formatElapsedDuration(nowMs() - startedAt)}`;
    };
    const stopElapsedTimer = () => {
      if (elapsedTimer != null && typeof window !== 'undefined') {
        window.clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
      updateElapsed();
    };
    updateElapsed();
    if (typeof window !== 'undefined') {
      elapsedTimer = window.setInterval(updateElapsed, 250);
    }
    const markComplete = () => {
      stopElapsedTimer();
      stopButton.disabled = true;
      stopButton.textContent = 'Stop';
    };
    const handle: AnyRecord = {
      update: (event: AnyRecord = {}) => {
        const total = Math.max(1, Number(event.total) || 100);
        const rawCurrent = Number(event.current);
        const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(total, rawCurrent)) : 0;
        const value = Math.max(0, Math.min(100, (current / total) * 100));
        const message = String(event.message || 'Generating toolpaths...');
        const detailText = String(event.detail || '');
        status.textContent = message;
        status.dataset.tone = event.tone === 'error' ? 'error' : (event.tone === 'warn' ? 'warn' : '');
        detail.textContent = detailText;
        detail.hidden = !detailText;
        meter.setAttribute('aria-valuenow', String(Math.round(value)));
        fill.style.width = `${value}%`;
        percent.textContent = `${Math.round(value)}%`;
        if (event.phase === 'complete' || event.phase === 'error' || event.phase === 'empty' || event.phase === 'canceled') {
          markComplete();
        }
        if (message && message !== lastMessage) {
          lastMessage = message;
          const line = document.createElement('div');
          line.className = 'cam-generation-progress-line';
          line.textContent = detailText ? `${message}: ${detailText}` : message;
          log.appendChild(line);
          while (log.childElementCount > 8) log.firstElementChild?.remove();
          log.scrollTop = log.scrollHeight;
        }
      },
      setCanceling: () => {
        stopButton.disabled = true;
        stopButton.textContent = 'Stopping...';
        status.textContent = 'Stopping CAM generation';
        status.dataset.tone = 'warn';
        detail.textContent = 'Waiting for the active CAM operation to yield.';
        detail.hidden = false;
      },
      setComplete: markComplete,
      close: () => {
        if (closeTimer != null) {
          window.clearTimeout(closeTimer);
          closeTimer = null;
        }
        stopElapsedTimer();
        try { floating.destroy?.(); } catch { /* ignore progress cleanup */ }
        if (this._generationProgress === handle) this._generationProgress = null;
      },
      closeAfter: (delayMs: number) => {
        if (closeTimer != null) window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => handle.close(), Math.max(0, Number(delayMs) || 0));
      },
    };
    this._generationProgress = handle;
    return handle;
  }

  _closeGenerationProgress(delayMs = 0): void {
    const progress = this._generationProgress;
    if (!progress) return;
    if (delayMs > 0 && typeof progress.closeAfter === 'function') {
      progress.closeAfter(delayMs);
      return;
    }
    try { progress.close?.(); } catch { /* ignore progress cleanup */ }
    this._generationProgress = null;
  }

  _planWarnings(plan: AnyRecord | null | undefined): string[] {
    return Array.isArray(plan?.warnings)
      ? plan.warnings.map((warning: any) => String(warning || '').trim()).filter(Boolean)
      : [];
  }

  _formatNoToolpathFeedback(plan: AnyRecord | null | undefined): string {
    const warnings = this._planWarnings(plan);
    if (warnings.length) return warnings.slice(0, 3).join(' ');
    return 'Check target solid selection, tool diameter, stepover, and top/bottom cut depths.';
  }

  async _preview() {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    if (!manager) return;
    const plan = manager.getCombinedPlan?.();
    if (!plan?.paths?.length) {
      this._setStatus('Generate toolpaths before previewing CAM simulation.', 'warn');
      this._renderSimulationControls();
      return;
    }
    const runtime = await this._ensureRuntime();
    runtime.setVisualizationOptions?.(this._visualOptions);
    runtime.preview?.(plan);
    this._renderSimulationControls();
    this._renderStatus();
    this._renderProgram();
  }

  async _togglePlay() {
    const runtime = await this._ensureRuntime();
    if (!runtime.group) await this._preview();
    if (!runtime.group) return;
    runtime.togglePlaying?.();
    this._renderControls();
    this._renderSimulationControls();
  }

  async _resetPreview() {
    const runtime = await this._ensureRuntime();
    runtime.reset?.();
    this._renderControls();
    this._renderSimulationControls();
  }

  async _clearPreview() {
    const runtime = await this._ensureRuntime();
    runtime.clearPreview?.();
    this._renderControls();
    this._renderSimulationControls();
  }

  async _setSimulationFrame(index: number) {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const plan = manager?.getCombinedPlan?.();
    if (!plan?.paths?.length) {
      this._setStatus('Generate toolpaths before stepping through CAM simulation.', 'warn');
      this._renderSimulationControls();
      return;
    }
    const runtime = await this._ensureRuntime();
    runtime.setVisualizationOptions?.(this._visualOptions);
    if (!runtime.group) runtime.preview?.(plan);
    runtime.setSimulationFrameIndex?.(index);
    this._renderSimulationControls();
  }

  _exportGcode() {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    if (!manager) return;
    let gcode = manager.getCombinedGcode?.() || '';
    if (!gcode.trim()) {
      this._setStatus('No CAM G-code has been generated yet.', 'warn');
      return;
    }
    downloadTextFile(gcodeDownloadFileName(this.viewer?.fileManagerWidget?.currentName), gcode, 'text/x-gcode;charset=utf-8');
  }

  _renderControls(): void {
    if (!this.controlsEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const hasGeneratedPlan = !!manager?.getCombinedPlan?.()?.paths?.length;
    const runtimePlaying = !!this._runtime?.isPlaying?.();
    const isGenerating = this._generating === true;
    this.controlsEl.textContent = '';
    const buttons = [
      { label: isGenerating ? 'Generating' : 'Generate', title: 'Generate toolpaths and G-code', className: 'cam-history-btn cam-history-btn-primary', disabled: isGenerating, onClick: () => void this._generate() },
      { label: 'Preview', title: 'Preview generated toolpaths', className: 'cam-history-btn', disabled: isGenerating || !hasGeneratedPlan, onClick: () => void this._preview() },
      { label: runtimePlaying ? '||' : '▷', title: runtimePlaying ? 'Pause cutter simulation' : 'Play cutter simulation', className: 'cam-history-btn cam-history-btn-icon', disabled: isGenerating || !hasGeneratedPlan, onClick: () => void this._togglePlay() },
      { label: '↺', title: 'Reset cutter simulation', className: 'cam-history-btn cam-history-btn-icon', disabled: isGenerating || !hasGeneratedPlan, onClick: () => void this._resetPreview() },
      { label: 'Export', title: 'Download generated G-code', className: 'cam-history-btn', disabled: isGenerating || !hasGeneratedPlan, onClick: () => this._exportGcode() },
      { label: '×', title: 'Clear CAM preview', className: 'cam-history-btn cam-history-btn-icon', disabled: isGenerating, onClick: () => void this._clearPreview() },
    ];
    for (const spec of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = spec.className;
      button.textContent = spec.label;
      button.title = spec.title;
      button.setAttribute('aria-label', spec.title);
      button.disabled = spec.disabled === true;
      button.addEventListener('click', spec.onClick);
      this.controlsEl.appendChild(button);
    }
  }

  _renderSimulationControls(): void {
    if (!this.simulationEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const plan = manager?.getCombinedPlan?.();
    const runtimeState = this._runtime?.getSimulationState?.() || {};
    const runtimeCount = Math.max(0, Math.round(Number(runtimeState.count) || 0));
    const planPointCount = Array.isArray(plan?.simulation?.motionPolyline)
      ? plan.simulation.motionPolyline.length
      : 0;
    const pointCount = runtimeCount > 1 ? runtimeCount : planPointCount;
    if (!plan?.paths?.length || pointCount < 2) {
      this.simulationEl.hidden = true;
      this.simulationEl.textContent = '';
      return;
    }
    this.simulationEl.hidden = false;
    this.simulationEl.textContent = '';

    const header = document.createElement('div');
    header.className = 'cam-simulation-header';
    header.textContent = 'Simulation';
    this.simulationEl.appendChild(header);

    const row = document.createElement('label');
    row.className = 'cam-simulation-slider';
    const label = document.createElement('span');
    label.textContent = 'Step';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(Math.max(0, pointCount - 1));
    input.step = '1';
    const index = Math.max(0, Math.min(pointCount - 1, Math.round(Number(runtimeState.index) || 0)));
    input.value = String(index);
    input.addEventListener('input', () => void this._setSimulationFrame(Number(input.value)));
    const value = document.createElement('output');
    value.textContent = `${index + 1} / ${pointCount}`;
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(value);
    this.simulationEl.appendChild(row);
  }

  _setVisualizationOption(key: string, value: boolean): void {
    this._visualOptions[key] = value !== false;
    try { this._runtime?.setVisualizationOptions?.({ [key]: this._visualOptions[key] }); } catch { /* ignore preview option update */ }
    this._renderVisualizationControls();
  }

  _renderVisualizationControls(): void {
    if (!this.visualEl) return;
    this.visualEl.textContent = '';
    const header = document.createElement('div');
    header.className = 'cam-visual-header';
    header.textContent = 'Visuals';
    this.visualEl.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'cam-visual-grid';
    this.visualEl.appendChild(grid);

    const options = [
      ['toolpath', 'Tool path'],
      ['tool', 'Tool'],
      ['sweptVolume', 'Cut volume'],
      ['stock', 'Stock'],
    ];
    for (const [key, labelText] of options) {
      const label = document.createElement('label');
      label.className = 'cam-visual-toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this._visualOptions[key] !== false;
      input.addEventListener('change', () => this._setVisualizationOption(key, input.checked));
      const span = document.createElement('span');
      span.textContent = labelText;
      label.appendChild(input);
      label.appendChild(span);
      grid.appendChild(label);
    }
  }

  _setStatus(message: string, tone = '') {
    if (!this.statusEl) return;
    this.statusEl.textContent = message || '';
    this.statusEl.dataset.tone = tone;
    this.statusEl.hidden = !message;
  }

  async _copyGcode(gcode: string) {
    if (!gcode.trim()) return;
    try {
      await navigator.clipboard?.writeText?.(gcode);
      this._setStatus('G-code copied.', 'ok');
    } catch {
      this._setStatus('Could not copy G-code from this browser context.', 'warn');
    }
  }

  _renderProgram(): void {
    if (!this.programEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const plan = manager?.getCombinedPlan?.() || null;
    const summary: AnyRecord = plan?.summary || {};
    const gcode = String(plan?.gcode || '');
    const generatedResults = Array.isArray(manager?.getGeneratedResults?.()) ? manager.getGeneratedResults() : [];
    if (!plan || (!summary.pathCount && !generatedResults.length)) {
      this.programEl.hidden = true;
      this.programEl.textContent = '';
      return;
    }

    this.programEl.hidden = false;
    this.programEl.textContent = '';

    const header = document.createElement('div');
    header.className = 'cam-program-header';
    const title = document.createElement('div');
    title.textContent = 'Program';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'cam-program-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cam-program-action';
    copy.textContent = 'Copy';
    copy.title = 'Copy generated G-code';
    copy.setAttribute('aria-label', 'Copy generated G-code');
    copy.disabled = !gcode.trim();
    copy.addEventListener('click', () => void this._copyGcode(gcode));
    actions.appendChild(copy);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'cam-program-action';
    exportButton.textContent = 'Export';
    exportButton.title = 'Download generated G-code';
    exportButton.setAttribute('aria-label', 'Download generated G-code');
    exportButton.disabled = !gcode.trim();
    exportButton.addEventListener('click', () => this._exportGcode());
    actions.appendChild(exportButton);

    header.appendChild(actions);
    this.programEl.appendChild(header);

    if (!summary.pathCount) {
      const warningList = document.createElement('div');
      warningList.className = 'cam-program-warnings';
      warningList.textContent = `No toolpaths generated. ${this._formatNoToolpathFeedback(plan)}`;
      this.programEl.appendChild(warningList);
      if (gcode.trim()) {
        const preview = document.createElement('textarea');
        preview.className = 'cam-gcode-preview';
        preview.readOnly = true;
        preview.spellcheck = false;
        preview.rows = 6;
        preview.value = gcode;
        preview.setAttribute('aria-label', 'Generated G-code preview');
        this.programEl.appendChild(preview);
      }
      return;
    }

    const stats = document.createElement('div');
    stats.className = 'cam-program-stats';
    const addStat = (labelText: string, value: any) => {
      const item = document.createElement('div');
      item.className = 'cam-program-stat';
      const label = document.createElement('span');
      label.textContent = labelText;
      const number = document.createElement('strong');
      number.textContent = String(value ?? 0);
      item.appendChild(label);
      item.appendChild(number);
      stats.appendChild(item);
    };
    addStat('Paths', summary.pathCount || 0);
    addStat('Cut Moves', summary.moveCount || 0);
    addStat('Motion', summary.motionSegmentCount || 0);
    addStat('Cut Length', `${summary.estimatedCutLength || 0} mm`);
    this.programEl.appendChild(stats);

    const warnings = Array.isArray(plan.warnings) ? plan.warnings.filter(Boolean) : [];
    if (warnings.length) {
      const warningList = document.createElement('div');
      warningList.className = 'cam-program-warnings';
      warningList.textContent = warnings.slice(0, 3).join('  ');
      this.programEl.appendChild(warningList);
    }

    const preview = document.createElement('textarea');
    preview.className = 'cam-gcode-preview';
    preview.readOnly = true;
    preview.spellcheck = false;
    preview.rows = 10;
    preview.value = gcode;
    preview.setAttribute('aria-label', 'Generated G-code preview');
    this.programEl.appendChild(preview);
  }

  _renderStatus(): void {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const operations = Array.isArray(manager?.getOperations?.()) ? manager.getOperations() : [];
    if (!operations.length) {
      this._setStatus('Add a 3 Axis CAM Operation to begin.', 'info');
      return;
    }
    const plan = manager?.getCombinedPlan?.();
    const summary: AnyRecord = plan?.summary || {};
    if (!summary.pathCount) {
      const generatedResults = Array.isArray(manager?.getGeneratedResults?.()) ? manager.getGeneratedResults() : [];
      if (generatedResults.length) {
        this._setStatus(`No toolpaths generated: ${this._formatNoToolpathFeedback(plan)}`, 'warn');
        return;
      }
      this._setStatus(`${operations.length} operation${operations.length === 1 ? '' : 's'} configured. Generate toolpaths to preview and export G-code.`, 'info');
      return;
    }
    const warnings = Number(summary.warningCount) || 0;
    this._setStatus(
      `${summary.pathCount} path${summary.pathCount === 1 ? '' : 's'}, ${summary.moveCount || 0} cut move${summary.moveCount === 1 ? '' : 's'}, ${summary.estimatedCutLength || 0} mm cut length${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`,
      warnings ? 'warn' : 'ok',
    );
  }

  _ensureStyles(): void {
    if (document.getElementById('cam-history-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'cam-history-widget-styles';
    style.textContent = `
      .cam-history-widget-root {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
      }
      .cam-machine-config-panel,
      .cam-gcode-panel,
      .cam-history-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
        padding: 10px;
        box-sizing: border-box;
      }
      .cam-machine-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .cam-stock-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .cam-machine-config-panel .cam-stock-panel {
        padding-bottom: 0;
        border-bottom: 0;
      }
      .cam-machine-header {
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-stock-header {
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-machine-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .cam-stock-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .cam-machine-field,
      .cam-machine-macro,
      .cam-stock-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        color: #94a3b8;
        font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-machine-field input,
      .cam-machine-field select,
      .cam-machine-macro textarea,
      .cam-stock-field input,
      .cam-stock-field select {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        border-radius: 7px;
        border: 1px solid rgba(148, 163, 184, 0.26);
        background: rgba(15, 23, 42, 0.82);
        color: #e2e8f0;
        padding: 7px 8px;
        font: 12px/1.25 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-stock-field input:disabled {
        color: #64748b;
        background: rgba(15, 23, 42, 0.46);
      }
      .cam-machine-macro textarea {
        resize: vertical;
        min-height: 46px;
      }
      .cam-machine-advanced {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        padding-top: 8px;
      }
      .cam-machine-advanced summary {
        cursor: pointer;
        color: #cbd5e1;
        font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        list-style-position: inside;
      }
      .cam-machine-advanced:not([open]) {
        gap: 0;
      }
      .cam-machine-advanced:not([open]) .cam-machine-toggles,
      .cam-machine-advanced:not([open]) .cam-machine-macros {
        display: none;
      }
      .cam-machine-toggles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
      }
      .cam-machine-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
        font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-machine-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }
      .cam-machine-macros {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .cam-history-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .cam-visual-panel {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 8px 0 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      }
      .cam-visual-header {
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-visual-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px 10px;
      }
      .cam-visual-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: #cbd5e1;
        font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-visual-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }
      .cam-visual-toggle span {
        overflow-wrap: anywhere;
      }
      .cam-history-btn {
        appearance: none;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(24, 35, 51, 0.94);
        color: #f8fafc;
        min-height: 34px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-history-btn:hover {
        border-color: rgba(34, 211, 238, 0.65);
        background: rgba(8, 47, 73, 0.92);
      }
      .cam-history-btn:disabled {
        cursor: not-allowed;
        color: #64748b;
        border-color: rgba(100, 116, 139, 0.18);
        background: rgba(15, 23, 42, 0.62);
      }
      .cam-history-btn-primary {
        background: rgba(15, 118, 110, 0.92);
        border-color: rgba(45, 212, 191, 0.42);
      }
      .cam-history-btn-icon {
        width: 34px;
        min-width: 34px;
        padding: 0;
        font-size: 16px;
      }
      .cam-generation-progress {
        box-sizing: border-box;
        display: flex;
        min-height: 100%;
        flex-direction: column;
        gap: 10px;
        color: #dbeafe;
      }
      .cam-generation-progress-status {
        color: #f8fafc;
        font: 700 13px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        overflow-wrap: anywhere;
      }
      .cam-generation-progress-status[data-tone="error"] {
        color: #fca5a5;
      }
      .cam-generation-progress-status[data-tone="warn"] {
        color: #fde68a;
      }
      .cam-generation-progress-detail {
        min-height: 34px;
        color: #a7f3d0;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        overflow-wrap: anywhere;
      }
      .cam-generation-progress-detail[hidden] {
        display: none;
      }
      .cam-generation-progress-runtime {
        color: #bfdbfe;
        font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-generation-progress-meter-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 44px;
        align-items: center;
        gap: 8px;
      }
      .cam-generation-progress-meter {
        position: relative;
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.26);
        background: rgba(15, 23, 42, 0.96);
      }
      .cam-generation-progress-fill {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #14b8a6, #60a5fa);
        transition: width 140ms ease-out;
      }
      .cam-generation-progress-percent {
        color: #e2e8f0;
        text-align: right;
        font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-generation-progress-log {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 7px;
        background: rgba(2, 6, 23, 0.34);
        padding: 7px;
      }
      .cam-generation-progress-line {
        color: #94a3b8;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        overflow-wrap: anywhere;
      }
      .cam-generation-progress-line + .cam-generation-progress-line {
        margin-top: 5px;
      }
      .cam-generation-progress-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .cam-generation-progress-stop {
        appearance: none;
        border-radius: 7px;
        border: 1px solid rgba(248, 113, 113, 0.42);
        background: rgba(127, 29, 29, 0.72);
        color: #fee2e2;
        min-height: 32px;
        padding: 0 12px;
        cursor: pointer;
        font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-generation-progress-stop:hover:not(:disabled) {
        border-color: rgba(252, 165, 165, 0.72);
        background: rgba(153, 27, 27, 0.86);
      }
      .cam-generation-progress-stop:disabled {
        cursor: wait;
        color: #fecaca;
        opacity: 0.72;
      }
      .cam-simulation-panel {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 8px 0 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      }
      .cam-simulation-panel[hidden] {
        display: none;
      }
      .cam-simulation-header {
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-simulation-slider {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        color: #cbd5e1;
        font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-simulation-slider input[type="range"] {
        width: 100%;
        min-width: 0;
      }
      .cam-simulation-slider output {
        color: #99f6e4;
        white-space: nowrap;
      }
      .cam-history-status {
        min-height: 18px;
        color: #cbd5e1;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-history-status[data-tone="warn"] {
        color: #fde68a;
      }
      .cam-history-status[data-tone="ok"] {
        color: #99f6e4;
      }
      .cam-program-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.32);
      }
      .cam-program-panel[hidden] {
        display: none;
      }
      .cam-program-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-program-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .cam-program-action {
        appearance: none;
        border-radius: 7px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(24, 35, 51, 0.94);
        color: #f8fafc;
        min-height: 28px;
        padding: 0 8px;
        cursor: pointer;
        font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-program-action:hover:not(:disabled) {
        border-color: rgba(34, 211, 238, 0.65);
        background: rgba(8, 47, 73, 0.92);
      }
      .cam-program-action:disabled {
        cursor: not-allowed;
        color: #64748b;
        border-color: rgba(100, 116, 139, 0.18);
        background: rgba(15, 23, 42, 0.62);
      }
      .cam-program-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      .cam-program-stat {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 7px;
        padding: 6px 7px;
        background: rgba(15, 23, 42, 0.58);
      }
      .cam-program-stat span {
        display: block;
        color: #94a3b8;
        font: 700 10px/1.25 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-program-stat strong {
        display: block;
        min-width: 0;
        overflow-wrap: anywhere;
        color: #f8fafc;
        font: 700 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-program-warnings {
        color: #fde68a;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-gcode-preview {
        box-sizing: border-box;
        width: 100%;
        min-height: 150px;
        resize: vertical;
        border-radius: 7px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(15, 23, 42, 0.9);
        color: #dbeafe;
        padding: 8px;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      @media (max-width: 520px) {
        .cam-machine-grid,
        .cam-machine-macros,
        .cam-visual-grid,
        .cam-program-stats {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

import { HistoryCollectionWidget } from '../history/HistoryCollectionWidget.js';
import { CamToolpathSimulator, type CamToolpathSimulatorState } from '../../cam/CamToolpathSimulator.js';

type AnyRecord = Record<string, any>;

export class CamHistoryWidget {
  viewer: any;
  uiElement: HTMLDivElement;
  machineConfigEl!: HTMLDivElement;
  gcodeEl!: HTMLDivElement;
  historyEl!: HTMLDivElement;
  machineEl!: HTMLDivElement;
  stockEl!: HTMLDivElement;
  controlsEl!: HTMLDivElement;
  statusEl!: HTMLDivElement;
  programEl!: HTMLDivElement;
  historyWidget: any = null;
  simulator: CamToolpathSimulator | null = null;
  playButtonEl: HTMLButtonElement | null = null;
  stopButtonEl: HTMLButtonElement | null = null;
  scrubberEl: HTMLInputElement | null = null;
  simReadoutEl: HTMLDivElement | null = null;
  _camListener: (() => void) | null = null;

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
    try { this.simulator?.dispose?.(); } catch { /* ignore simulator cleanup */ }
    this.simulator = null;
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
      if (payload.reason === 'generate-all') {
        this._setSimulatorProgram(payload.result, { autoPlay: false });
      } else if (
        payload.reason === 'invalidate'
        || payload.reason === 'machine-profile'
        || payload.reason === 'stock-profile'
        || payload.reason === 'load'
        || payload.reason === 'clear'
      ) {
        this._clearSimulator();
      }
      if (payload.reason === 'machine-profile' || payload.reason === 'load' || payload.reason === 'clear') {
        this._renderMachineSettings();
      }
      if (payload.reason === 'stock-profile' || payload.reason === 'load' || payload.reason === 'clear') {
        this._renderStockSettings();
      }
      this._renderControls();
      this._renderStatus();
      this._renderProgram();
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

    this.programEl = document.createElement('div');
    this.programEl.className = 'cam-program-panel';
    this.gcodeEl.appendChild(this.programEl);

    this.historyEl = document.createElement('div');
    this.historyEl.className = 'cam-history-panel';

    this.controlsEl = document.createElement('div');
    this.controlsEl.className = 'cam-history-controls';
    this.historyEl.appendChild(this.controlsEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'cam-history-status';
    this.historyEl.appendChild(this.statusEl);

    const manager = this.viewer?.partHistory?.camPlanManager || null;
    this.historyWidget = new HistoryCollectionWidget({
      history: manager,
      viewer: this.viewer,
      autoSyncOpenState: true,
      createEntry: async (typeStr: string) => manager?.createOperation?.(typeStr) || null,
      onEntryChange: ({ entry, details }: AnyRecord = {}) => {
        manager?.invalidateOperation?.(entry, details?.key ? `field:${details.key}` : 'operation-edit');
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-operation' });
        this.refresh();
      },
      onCollectionChange: () => {
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'cam-operation' });
        this.refresh();
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
          this.refresh();
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
      this.refresh();
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
      this.refresh();
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

  _generateCam() {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const result = manager?.generateAll?.(this.viewer) || null;
    const pathCount = Number(result?.summary?.pathCount ?? result?.paths?.length ?? 0) || 0;
    const warningCount = Number(result?.warnings?.length ?? 0) || 0;
    if (pathCount > 0) {
      this._setStatus(`${pathCount} Shadow Cutter path${pathCount === 1 ? '' : 's'} generated.`, warningCount ? 'warn' : 'info');
    } else {
      this._setStatus(result?.warnings?.[0] || 'No Shadow Cutter paths generated.', 'warn');
    }
    this._setSimulatorProgram(result, { autoPlay: pathCount > 0 });
    this._renderProgram();
  }

  _ensureSimulator(): CamToolpathSimulator {
    if (this.simulator) return this.simulator;
    this.simulator = new CamToolpathSimulator({
      viewer: this.viewer,
      scene: this.viewer?.partHistory?.scene || this.viewer?.scene || null,
      onStateChange: (state) => this._syncSimulatorControls(state),
    });
    return this.simulator;
  }

  _setSimulatorProgram(program: AnyRecord | null | undefined, { autoPlay = false } = {}) {
    const sim = this._ensureSimulator();
    sim.setProgram(program as any);
    if (autoPlay) sim.play();
    this._syncSimulatorControls(sim.getState());
  }

  _clearSimulator() {
    try { this.simulator?.clear?.(); } catch { /* ignore simulator cleanup */ }
    this._syncSimulatorControls(this.simulator?.getState?.());
  }

  _toggleSimulationPlayback() {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const sim = this._ensureSimulator();
    let state = sim.getState();
    if (!state.hasProgram) {
      const plan = manager?.getCombinedPlan?.() || null;
      if (Number(plan?.summary?.pathCount ?? plan?.paths?.length ?? 0) > 0) {
        sim.setProgram(plan);
        state = sim.getState();
      } else {
        const result = manager?.generateAll?.(this.viewer) || null;
        sim.setProgram(result);
        state = sim.getState();
      }
    }
    if (!state.hasProgram) {
      this._setStatus('Generate a Shadow Cutter path before simulation.', 'warn');
      return;
    }
    if (state.playing) sim.pause();
    else sim.play();
    this._syncSimulatorControls(sim.getState());
  }

  _stopSimulation() {
    const sim = this._ensureSimulator();
    sim.stop();
    this._syncSimulatorControls(sim.getState());
  }

  _syncSimulatorControls(state: CamToolpathSimulatorState | undefined | null = null) {
    const nextState = state || this.simulator?.getState?.() || {
      hasProgram: false,
      playing: false,
      progress: 0,
      step: 0,
      totalSteps: 0,
      totalLength: 0,
      currentPosition: null,
    };
    if (this.playButtonEl) {
      this.playButtonEl.textContent = nextState.playing ? 'Pause' : 'Play';
      this.playButtonEl.title = nextState.playing ? 'Pause toolpath simulation' : 'Play toolpath simulation';
      this.playButtonEl.setAttribute('aria-label', this.playButtonEl.title);
      this.playButtonEl.disabled = false;
    }
    if (this.stopButtonEl) this.stopButtonEl.disabled = !nextState.hasProgram;
    if (this.scrubberEl) {
      const value = String(Math.round((Number(nextState.progress) || 0) * 1000));
      if (this.scrubberEl.value !== value) this.scrubberEl.value = value;
      this.scrubberEl.disabled = !nextState.hasProgram;
    }
    if (this.simReadoutEl) {
      const pct = Math.round((Number(nextState.progress) || 0) * 100);
      this.simReadoutEl.textContent = nextState.hasProgram
        ? `${nextState.step} / ${nextState.totalSteps}  ${pct}%`
        : '0 / 0  0%';
    }
  }

  _renderControls(): void {
    if (!this.controlsEl) return;
    this.controlsEl.textContent = '';
    const generateButton = document.createElement('button');
    generateButton.type = 'button';
    generateButton.className = 'cam-history-btn cam-history-btn-primary';
    generateButton.textContent = 'Generate';
    generateButton.title = 'Generate Shadow Cutter toolpaths';
    generateButton.setAttribute('aria-label', 'Generate Shadow Cutter toolpaths');
    generateButton.addEventListener('click', () => this._generateCam());
    this.controlsEl.appendChild(generateButton);

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'cam-history-btn';
    playButton.textContent = 'Play';
    playButton.title = 'Play toolpath simulation';
    playButton.setAttribute('aria-label', 'Play toolpath simulation');
    playButton.addEventListener('click', () => this._toggleSimulationPlayback());
    this.controlsEl.appendChild(playButton);
    this.playButtonEl = playButton;

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'cam-history-btn';
    stopButton.textContent = 'Stop';
    stopButton.title = 'Stop toolpath simulation';
    stopButton.setAttribute('aria-label', 'Stop toolpath simulation');
    stopButton.addEventListener('click', () => this._stopSimulation());
    this.controlsEl.appendChild(stopButton);
    this.stopButtonEl = stopButton;

    const simStrip = document.createElement('div');
    simStrip.className = 'cam-sim-strip';
    const scrubber = document.createElement('input');
    scrubber.type = 'range';
    scrubber.min = '0';
    scrubber.max = '1000';
    scrubber.step = '1';
    scrubber.value = '0';
    scrubber.className = 'cam-sim-scrubber';
    scrubber.setAttribute('aria-label', 'Toolpath simulation position');
    scrubber.addEventListener('input', () => {
      const sim = this._ensureSimulator();
      sim.setProgress((Number(scrubber.value) || 0) / 1000);
    });
    const readout = document.createElement('div');
    readout.className = 'cam-sim-readout';
    simStrip.appendChild(scrubber);
    simStrip.appendChild(readout);
    this.controlsEl.appendChild(simStrip);
    this.scrubberEl = scrubber;
    this.simReadoutEl = readout;
    this._syncSimulatorControls();
  }

  _setStatus(message: string, tone = '') {
    if (!this.statusEl) return;
    this.statusEl.textContent = message || '';
    this.statusEl.dataset.tone = tone;
    this.statusEl.hidden = !message;
  }

  _renderProgram(): void {
    if (!this.programEl) return;
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const operations = Array.isArray(manager?.getOperations?.()) ? manager.getOperations() : [];
    this.programEl.textContent = '';
    const header = document.createElement('div');
    header.className = 'cam-program-header';
    const title = document.createElement('div');
    title.textContent = 'Program';
    header.appendChild(title);
    this.programEl.appendChild(header);

    const message = document.createElement('div');
    message.className = 'cam-program-placeholder';
    const gcode = String(manager?.getCombinedGcode?.() || '');
    if (gcode.trim()) {
      message.textContent = gcode;
      message.classList.add('cam-program-code');
      this.programEl.appendChild(message);
      return;
    }
    message.textContent = operations.length
      ? 'Generate to create Shadow Cutter G-code.'
      : 'No Shadow Cutters configured.';
    this.programEl.appendChild(message);
  }

  _renderStatus(): void {
    const manager = this.viewer?.partHistory?.camPlanManager || null;
    const operations = Array.isArray(manager?.getOperations?.()) ? manager.getOperations() : [];
    if (!operations.length) {
      this._setStatus('Add a Shadow Cutter to begin.', 'info');
      return;
    }
    const generated = manager?.getGeneratedResults?.() || [];
    if (generated.length) {
      const pathCount = generated.reduce((sum: number, result: AnyRecord) => sum + (Number(result?.summary?.pathCount ?? result?.paths?.length ?? 0) || 0), 0);
      this._setStatus(`${pathCount} Shadow Cutter path${pathCount === 1 ? '' : 's'} ready.`, 'info');
      return;
    }
    this._setStatus(`${operations.length} Shadow Cutter${operations.length === 1 ? '' : 's'} configured.`, 'info');
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
      .cam-machine-panel,
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
      .cam-machine-header,
      .cam-stock-header {
        color: #e2e8f0;
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-transform: uppercase;
      }
      .cam-machine-grid,
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
      .cam-history-btn-primary {
        background: rgba(15, 118, 110, 0.92);
        border-color: rgba(45, 212, 191, 0.42);
      }
      .cam-sim-strip {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) auto;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-width: 0;
      }
      .cam-sim-scrubber {
        width: 100%;
        min-width: 0;
        accent-color: #5eead4;
      }
      .cam-sim-readout {
        color: #99f6e4;
        min-width: 78px;
        text-align: right;
        white-space: nowrap;
        font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-history-status {
        min-height: 18px;
        color: #cbd5e1;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-history-status[data-tone="warn"] {
        color: #fde68a;
      }
      .cam-program-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
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
      .cam-program-placeholder {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.45);
        color: #cbd5e1;
        padding: 10px;
        font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      .cam-program-code {
        white-space: pre;
        overflow: auto;
        max-height: 360px;
      }
    `;
    document.head.appendChild(style);
  }
}

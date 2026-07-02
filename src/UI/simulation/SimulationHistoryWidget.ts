import { HistoryCollectionWidget } from '../history/HistoryCollectionWidget.js';

export class SimulationHistoryWidget {
  viewer: any;
  uiElement: HTMLDivElement;
  transportEl!: HTMLDivElement;
  historyWidget: any = null;
  _simListener: (() => void) | null = null;

  constructor(viewer: any) {
    this.viewer = viewer || null;
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'simulation-history-widget-root';

    this._ensureStyles();
    this._buildUI();
    this.refresh();
    void this._attachSimulationListener();
  }

  dispose(): void {
    if (typeof this._simListener === 'function') {
      try { this._simListener(); } catch { /* ignore listener cleanup */ }
    }
    this._simListener = null;
    try { this.historyWidget?.dispose?.(); } catch { /* ignore widget cleanup */ }
    this.historyWidget = null;
  }

  setPanelVisible(visible: boolean): void {
    try { this.historyWidget?.setContextSuppressionEnabled?.(visible !== false); } catch { /* ignore visibility sync */ }
  }

  refresh(): void {
    this._renderTransport();
    try { this.historyWidget?.render?.(); } catch { /* ignore render errors */ }
  }

  refreshFromHistory(): void {
    this.refresh();
  }

  async _attachSimulationListener(): Promise<void> {
    const manager = this.viewer?.simulationWorkbenchManager || await this.viewer?._ensureSimulationWorkbenchManager?.();
    if (!manager?.addListener) return;
    this._simListener = manager.addListener(() => this._renderTransport());
    this._renderTransport();
  }

  _buildUI(): void {
    this.transportEl = document.createElement('div');
    this.transportEl.className = 'simulation-history-transport';
    this.uiElement.appendChild(this.transportEl);

    this.historyWidget = new HistoryCollectionWidget({
      history: this.viewer?.partHistory?.simulationStateManager || null,
      viewer: this.viewer,
      autoSyncOpenState: true,
      createEntry: async (typeStr: string) => {
        return this.viewer?.partHistory?.simulationStateManager?.createMotion?.(typeStr) || null;
      },
      onEntryChange: () => {
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-motion' });
      },
      onCollectionChange: () => {
        this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'simulation-motion' });
      },
    });
    this.uiElement.appendChild(this.historyWidget.uiElement);
  }

  _renderTransport(): void {
    const manager = this.viewer?.simulationWorkbenchManager || null;
    const isPlaying = !!manager?.isPlaying?.();
    this.transportEl.textContent = '';

    const playPauseBtn = document.createElement('button');
    playPauseBtn.type = 'button';
    playPauseBtn.className = 'simulation-history-btn simulation-history-btn-primary';
    playPauseBtn.textContent = isPlaying ? '||' : '▷';
    playPauseBtn.title = isPlaying ? 'Pause simulation' : 'Play simulation';
    playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause simulation' : 'Play simulation');
    playPauseBtn.addEventListener('click', async () => {
      const runtime = this.viewer?.simulationWorkbenchManager || await this.viewer?._ensureSimulationWorkbenchManager?.();
      runtime?.setPlaying?.(!runtime?.isPlaying?.());
      this._renderTransport();
    });
    this.transportEl.appendChild(playPauseBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'simulation-history-btn';
    resetBtn.textContent = '↺';
    resetBtn.title = 'Reset simulation';
    resetBtn.setAttribute('aria-label', 'Reset simulation');
    resetBtn.addEventListener('click', async () => {
      const runtime = this.viewer?.simulationWorkbenchManager || await this.viewer?._ensureSimulationWorkbenchManager?.();
      runtime?.resetSimulationState?.();
      this._renderTransport();
    });
    this.transportEl.appendChild(resetBtn);

  }

  _ensureStyles(): void {
    if (document.getElementById('simulation-history-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'simulation-history-widget-styles';
    style.textContent = `
      .simulation-history-widget-root {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
      }
      .simulation-history-transport {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .simulation-history-btn {
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(30, 41, 59, 0.92);
        color: #f8fafc;
        padding: 8px 10px;
        cursor: pointer;
      }
      .simulation-history-transport .simulation-history-btn {
        width: 36px;
        min-width: 36px;
        height: 36px;
        min-height: 36px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-size: 18px;
      }
      .simulation-history-btn-primary {
        background: rgba(37, 99, 235, 0.92);
        border-color: rgba(96, 165, 250, 0.42);
      }
    `;
    document.head.appendChild(style);
  }
}

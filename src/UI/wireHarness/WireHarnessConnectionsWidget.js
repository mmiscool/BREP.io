import { listWireHarnessTerminationEndpoints } from '../../wireHarness/wireHarnessRouting.js';

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '';
  return distance.toFixed(2).replace(/\.?0+$/, '');
}

export class WireHarnessConnectionsWidget {
  constructor(viewer, { readOnly = false } = {}) {
    this.viewer = viewer || null;
    this._readOnly = !!readOnly;
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'wire-harness-widget-root';
    this.connections = [];
    this.routeResults = new Map();
    this.availableEndpoints = [];
    this._removeManagerListener = null;
    this._removeModelChangeListener = null;

    this._ensureStyles();
    this._buildUI();
    this.refreshFromHistory();
    this._renderList();
    this._bindListeners();
  }

  dispose() {
    if (typeof this._removeManagerListener === 'function') {
      try { this._removeManagerListener(); } catch { /* ignore */ }
    }
    if (typeof this._removeModelChangeListener === 'function') {
      try { this._removeModelChangeListener(); } catch { /* ignore */ }
    }
    this._removeManagerListener = null;
    this._removeModelChangeListener = null;
  }

  refreshFromHistory() {
    const manager = this._getManager();
    this.connections = Array.isArray(manager?.getConnections?.()) ? manager.getConnections() : [];
    this.routeResults = manager?.getRouteResultMap?.() || new Map();
    this.availableEndpoints = listWireHarnessTerminationEndpoints(this.viewer?.partHistory)
      .map((entry) => normalizeText(entry?.label, ''))
      .filter(Boolean);
  }

  _getManager() {
    return this.viewer?.partHistory?.wireHarnessManager || null;
  }

  _bindListeners() {
    const manager = this._getManager();
    if (manager?.addListener) {
      this._removeManagerListener = manager.addListener(() => {
        this.refreshFromHistory();
        this._renderList();
      });
    }
    if (this.viewer?.partHistory?.addModelChangeListener) {
      this._removeModelChangeListener = this.viewer.partHistory.addModelChangeListener(() => {
        this.refreshFromHistory();
        this._renderList();
      });
    }
  }

  _buildUI() {
    const header = document.createElement('div');
    header.className = 'wire-harness-widget-header';

    const title = document.createElement('div');
    title.className = 'wire-harness-widget-title';
    title.textContent = this._readOnly ? 'Connections' : 'Harness Connections';
    header.appendChild(title);

    if (!this._readOnly) {
      const actions = document.createElement('div');
      actions.className = 'wire-harness-widget-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'wire-harness-btn wire-harness-btn-primary';
      addBtn.textContent = 'Add';
      addBtn.title = 'Add a new harness connection';
      addBtn.addEventListener('click', () => this._addConnection());
      actions.appendChild(addBtn);

      const routeBtn = document.createElement('button');
      routeBtn.type = 'button';
      routeBtn.className = 'wire-harness-btn';
      routeBtn.textContent = 'Route';
      routeBtn.title = 'Rebuild all routed wires';
      routeBtn.addEventListener('click', () => {
        void this.viewer?.refreshWireHarnessRoutes?.({ reason: 'manual-route' });
      });
      actions.appendChild(routeBtn);

      header.appendChild(actions);
    }

    this.uiElement.appendChild(header);

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'wire-harness-summary';
    this.uiElement.appendChild(this.summaryEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'wire-harness-list';
    this.uiElement.appendChild(this.listEl);
  }

  _addConnection() {
    const manager = this._getManager();
    if (!manager?.addConnection) return;
    const from = this.availableEndpoints[0] || '';
    const to = this.availableEndpoints[1] || this.availableEndpoints[0] || '';
    manager.addConnection({
      name: `Wire ${this.connections.length + 1}`,
      from,
      to,
      diameter: 1,
    });
    this._queuePersistence();
    void this.viewer?.refreshWireHarnessRoutes?.({ reason: 'add-connection' });
  }

  _queuePersistence() {
    this.viewer?.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'wire-harness' });
  }

  _updateConnection(connectionId, patch) {
    const manager = this._getManager();
    if (!manager?.updateConnection) return;
    manager.updateConnection(connectionId, patch);
    this._queuePersistence();
    void this.viewer?.refreshWireHarnessRoutes?.({ reason: 'update-connection' });
  }

  _removeConnection(connectionId) {
    const manager = this._getManager();
    if (!manager?.removeConnection) return;
    manager.removeConnection(connectionId);
    this._queuePersistence();
    void this.viewer?.refreshWireHarnessRoutes?.({ reason: 'remove-connection' });
  }

  _buildEndpointSelect(currentValue, onChange) {
    const select = document.createElement('select');
    select.className = 'wire-harness-select';
    const values = Array.from(new Set([normalizeText(currentValue, ''), ...this.availableEndpoints].filter(Boolean)));
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select port…';
    select.appendChild(blank);
    for (const label of values) {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = normalizeText(currentValue, '');
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  _renderList() {
    if (!this.listEl || !this.summaryEl) return;
    this.listEl.textContent = '';

    const routedCount = Array.from(this.routeResults.values()).filter((entry) => entry?.feasible).length;
    this.summaryEl.textContent = `${this.connections.length} connection${this.connections.length === 1 ? '' : 's'} | ${this.availableEndpoints.length} endpoints | ${routedCount} routed`;

    if (!this.connections.length) {
      const empty = document.createElement('div');
      empty.className = 'wire-harness-empty';
      empty.textContent = this._readOnly
        ? 'No harness connections.'
        : 'No harness connections yet. Add one to route wires through the spline network.';
      this.listEl.appendChild(empty);
      return;
    }

    for (const connection of this.connections) {
      const result = this.routeResults.get(String(connection?.id || '')) || null;
      const row = document.createElement('div');
      row.className = 'wire-harness-row';

      const top = document.createElement('div');
      top.className = 'wire-harness-row-top';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'wire-harness-input wire-harness-name';
      nameInput.value = normalizeText(connection?.name, '');
      nameInput.placeholder = 'Wire name';
      nameInput.disabled = this._readOnly;
      nameInput.addEventListener('change', () => {
        this._updateConnection(connection.id, { name: nameInput.value });
      });
      top.appendChild(nameInput);

      const diameterInput = document.createElement('input');
      diameterInput.type = 'number';
      diameterInput.step = '0.1';
      diameterInput.min = '0.01';
      diameterInput.className = 'wire-harness-input wire-harness-diameter';
      diameterInput.value = String(normalizeNumber(connection?.diameter, 1));
      diameterInput.title = 'Wire diameter';
      diameterInput.disabled = this._readOnly;
      diameterInput.addEventListener('change', () => {
        this._updateConnection(connection.id, { diameter: Math.max(0.01, normalizeNumber(diameterInput.value, 1)) });
      });
      top.appendChild(diameterInput);

      if (!this._readOnly) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'wire-harness-btn wire-harness-btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => this._removeConnection(connection.id));
        top.appendChild(removeBtn);
      }

      row.appendChild(top);

      const endpoints = document.createElement('div');
      endpoints.className = 'wire-harness-endpoints';

      const fromSelect = this._buildEndpointSelect(connection?.from, (value) => {
        this._updateConnection(connection.id, { from: value });
      });
      fromSelect.disabled = this._readOnly;
      endpoints.appendChild(fromSelect);

      const arrow = document.createElement('div');
      arrow.className = 'wire-harness-arrow';
      arrow.textContent = '→';
      endpoints.appendChild(arrow);

      const toSelect = this._buildEndpointSelect(connection?.to, (value) => {
        this._updateConnection(connection.id, { to: value });
      });
      toSelect.disabled = this._readOnly;
      endpoints.appendChild(toSelect);

      row.appendChild(endpoints);

      const status = document.createElement('div');
      status.className = 'wire-harness-status';
      if (result?.feasible) {
        status.textContent = `Routed${formatDistance(result.distance) ? ` | ${formatDistance(result.distance)}` : ''}`;
        status.dataset.state = 'ok';
      } else if (result?.error) {
        status.textContent = result.error;
        status.dataset.state = 'error';
      } else {
        status.textContent = 'Not routed.';
        status.dataset.state = 'idle';
      }
      row.appendChild(status);

      this.listEl.appendChild(row);
    }
  }

  _ensureStyles() {
    if (document.getElementById('wire-harness-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'wire-harness-widget-styles';
    style.textContent = `
      .wire-harness-widget-root {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .wire-harness-widget-header,
      .wire-harness-row-top,
      .wire-harness-endpoints,
      .wire-harness-widget-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wire-harness-widget-header {
        justify-content: space-between;
      }
      .wire-harness-widget-title {
        font-size: 13px;
        font-weight: 700;
        color: #e5e7eb;
      }
      .wire-harness-summary,
      .wire-harness-status {
        font-size: 12px;
        color: #9ca3af;
      }
      .wire-harness-status[data-state="ok"] {
        color: #86efac;
      }
      .wire-harness-status[data-state="error"] {
        color: #fca5a5;
      }
      .wire-harness-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .wire-harness-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #1f2937;
        background: rgba(17, 24, 39, 0.65);
      }
      .wire-harness-input,
      .wire-harness-select {
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #374151;
        background: #0b1220;
        color: #e5e7eb;
      }
      .wire-harness-name {
        flex: 1 1 auto;
      }
      .wire-harness-diameter {
        width: 82px;
        flex: 0 0 82px;
      }
      .wire-harness-btn {
        border: 1px solid #374151;
        background: rgba(255,255,255,0.04);
        color: #f9fafb;
        border-radius: 6px;
        padding: 6px 10px;
        cursor: pointer;
      }
      .wire-harness-btn:hover {
        border-color: #60a5fa;
        background: rgba(96,165,250,0.12);
      }
      .wire-harness-btn-primary {
        border-color: #2563eb;
      }
      .wire-harness-btn-danger {
        border-color: #7f1d1d;
        color: #fecaca;
      }
      .wire-harness-arrow {
        flex: 0 0 auto;
        color: #93c5fd;
        font-weight: 700;
      }
      .wire-harness-empty {
        padding: 12px;
        border: 1px dashed #374151;
        border-radius: 8px;
        color: #9ca3af;
      }
    `;
    document.head.appendChild(style);
  }
}

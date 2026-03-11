import { SelectionFilter } from '../SelectionFilter.js';
import {
  buildWireHarnessRoutingPayload,
  listWireHarnessTerminationEndpoints,
  resolveWireHarnessConnectionPortRefs,
} from '../../wireHarness/wireHarnessRouting.js';

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

function textWidthCh(value, minimum = 0, padding = 2) {
  const text = String(value == null ? '' : value);
  return Math.max(minimum, text.length + padding);
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
    this._hoveredConnectionId = '';
    this._removeManagerListener = null;
    this._removeModelChangeListener = null;

    this._ensureStyles();
    this._buildUI();
    this.refreshFromHistory();
    this._renderList();
    this._bindListeners();
  }

  dispose() {
    this._clearConnectionHover();
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
        const payload = buildWireHarnessRoutingPayload(
          this.viewer?.partHistory,
          this._getManager()?.getConnections?.() || [],
        );
        this._openRoutingPayloadWindow({
          segments: payload?.segments || [],
          connections: payload?.connections || [],
        });
        void this.viewer?.refreshWireHarnessRoutes?.({ reason: 'manual-route' });
      });
      actions.appendChild(routeBtn);

      header.appendChild(actions);
    }

    this.uiElement.appendChild(header);

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'wire-harness-summary';
    this.uiElement.appendChild(this.summaryEl);

    this.listScrollEl = document.createElement('div');
    this.listScrollEl.className = 'wire-harness-list-scroll';
    this.uiElement.appendChild(this.listScrollEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'wire-harness-list';
    this.listScrollEl.appendChild(this.listEl);
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
    this._clearConnectionHover();
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

    this._applyTableColumnWidths();

    const header = document.createElement('div');
    header.className = 'wire-harness-table-head';
    for (const label of ['Wire', 'Length', 'Dia', 'From', 'To', 'Status', 'Actions']) {
      const cell = document.createElement('div');
      cell.className = 'wire-harness-head-cell';
      cell.textContent = label;
      header.appendChild(cell);
    }
    this.listEl.appendChild(header);

    for (const connection of this.connections) {
      const result = this.routeResults.get(String(connection?.id || '')) || null;
      const row = document.createElement('div');
      row.className = 'wire-harness-row wire-harness-table-row';
      row.addEventListener('mouseenter', () => this._hoverConnection(connection));
      row.addEventListener('mouseleave', () => this._clearConnectionHover(connection?.id));

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'wire-harness-input wire-harness-name';
      nameInput.value = normalizeText(connection?.name, '');
      nameInput.placeholder = 'Wire name';
      nameInput.disabled = this._readOnly;
      nameInput.addEventListener('change', () => {
        this._updateConnection(connection.id, { name: nameInput.value });
      });
      row.appendChild(nameInput);

      const lengthValue = document.createElement('div');
      lengthValue.className = 'wire-harness-cell wire-harness-length';
      lengthValue.textContent = result?.feasible && formatDistance(result?.distance)
        ? formatDistance(result.distance)
        : '—';
      row.appendChild(lengthValue);

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
      row.appendChild(diameterInput);

      const fromSelect = this._buildEndpointSelect(connection?.from, (value) => {
        this._updateConnection(connection.id, { from: value });
      });
      fromSelect.disabled = this._readOnly;
      row.appendChild(fromSelect);

      const toSelect = this._buildEndpointSelect(connection?.to, (value) => {
        this._updateConnection(connection.id, { to: value });
      });
      toSelect.disabled = this._readOnly;
      row.appendChild(toSelect);

      const status = document.createElement('div');
      status.className = 'wire-harness-status wire-harness-cell';
      if (result?.feasible) {
        status.textContent = 'Routed';
        status.dataset.state = 'ok';
      } else if (result?.error) {
        status.textContent = result.error;
        status.dataset.state = 'error';
      } else {
        status.textContent = 'Not routed.';
        status.dataset.state = 'idle';
      }
      row.appendChild(status);

      const actions = document.createElement('div');
      actions.className = 'wire-harness-actions-cell';
      if (!this._readOnly) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'wire-harness-btn wire-harness-btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => this._removeConnection(connection.id));
        actions.appendChild(removeBtn);
      }
      row.appendChild(actions);

      this.listEl.appendChild(row);
    }
  }

  _applyTableColumnWidths() {
    if (!this.listEl) return;
    const results = this.routeResults || new Map();
    const nameChars = this.connections.reduce(
      (max, connection) => Math.max(max, textWidthCh(connection?.name, 10, 3)),
      textWidthCh('Wire', 10, 3),
    );
    const lengthChars = this.connections.reduce((max, connection) => {
      const result = results.get(String(connection?.id || '')) || null;
      const value = result?.feasible && formatDistance(result?.distance)
        ? formatDistance(result.distance)
        : '—';
      return Math.max(max, textWidthCh(value, 8, 3));
    }, textWidthCh('Length', 8, 3));
    const diameterChars = this.connections.reduce(
      (max, connection) => Math.max(max, textWidthCh(normalizeNumber(connection?.diameter, 1), 5, 3)),
      textWidthCh('Dia', 5, 3),
    );
    const fromChars = this.connections.reduce(
      (max, connection) => Math.max(max, textWidthCh(connection?.from, 10, 4)),
      textWidthCh('From', 10, 4),
    );
    const toChars = this.connections.reduce(
      (max, connection) => Math.max(max, textWidthCh(connection?.to, 10, 4)),
      textWidthCh('To', 10, 4),
    );
    const statusChars = this.connections.reduce((max, connection) => {
      const result = results.get(String(connection?.id || '')) || null;
      const value = result?.feasible
        ? 'Routed'
        : (result?.error || 'Not routed.');
      return Math.max(max, textWidthCh(value, 12, 3));
    }, textWidthCh('Status', 12, 3));
    const actionsChars = this._readOnly ? textWidthCh('Actions', 6, 2) : Math.max(
      textWidthCh('Actions', 7, 2),
      textWidthCh('Remove', 7, 4),
    );

    this.listEl.style.setProperty('--wire-col-name', `${nameChars}ch`);
    this.listEl.style.setProperty('--wire-col-length', `${lengthChars}ch`);
    this.listEl.style.setProperty('--wire-col-dia', `${diameterChars}ch`);
    this.listEl.style.setProperty('--wire-col-from', `${fromChars}ch`);
    this.listEl.style.setProperty('--wire-col-to', `${toChars}ch`);
    this.listEl.style.setProperty('--wire-col-status', `${statusChars}ch`);
    this.listEl.style.setProperty('--wire-col-actions', `${actionsChars}ch`);
  }

  _hoverConnection(connection) {
    const connectionId = normalizeText(connection?.id, '');
    this._hoveredConnectionId = connectionId;
    const refs = resolveWireHarnessConnectionPortRefs(this.viewer?.partHistory, connection);
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    if (!scene || !Array.isArray(refs?.portRefs) || !refs.portRefs.length) {
      try { SelectionFilter.setHoverObjects([], { ignoreFilter: true }); } catch { /* ignore */ }
      return;
    }

    const targets = refs.portRefs
      .map((ref) => this.viewer?.partHistory?.getObjectByName?.(ref) || scene?.getObjectByName?.(ref) || null)
      .filter(Boolean);

    try { SelectionFilter.setHoverObjects(targets, { ignoreFilter: true }); } catch { /* ignore */ }
  }

  _clearConnectionHover(connectionId = '') {
    const targetId = normalizeText(connectionId, '');
    if (targetId && targetId !== this._hoveredConnectionId) return;
    this._hoveredConnectionId = '';
    try { SelectionFilter.setHoverObjects([], { ignoreFilter: true }); } catch { /* ignore */ }
  }

  _openRoutingPayloadWindow(payload) {
    const json = JSON.stringify(payload || { segments: [], connections: [] }, null, 2);
    const popup = (typeof window !== 'undefined' && typeof window.open === 'function')
      ? window.open('', '_blank', 'noopener,noreferrer,width=840,height=760')
      : null;
    if (popup && popup.document) {
      try {
        popup.document.open();
        popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Wire Harness Routing Payload</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #0b0e14;
        color: #e5e7eb;
        font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      h1 {
        margin: 0 0 8px 0;
        font-size: 16px;
      }
      p {
        margin: 0 0 12px 0;
        color: #9ca3af;
      }
      textarea {
        width: 100%;
        height: calc(100vh - 92px);
        box-sizing: border-box;
        border: 1px solid #1f2937;
        border-radius: 8px;
        padding: 12px;
        background: #050816;
        color: #e5e7eb;
        resize: none;
      }
    </style>
  </head>
  <body>
    <h1>Wire Harness Routing Payload</h1>
    <p>Exact <code>{ "segments": [...], "connections": [...] }</code> data passed into the routing pathfinder.</p>
    <textarea readonly spellcheck="false">${json.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</textarea>
  </body>
</html>`);
        popup.document.close();
        return;
      } catch { /* ignore popup write failure */ }
    }
    try {
      const area = document.createElement('textarea');
      area.value = json;
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      area.focus();
    } catch { /* ignore fallback */ }
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
      .wire-harness-list-scroll {
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 4px;
      }
      .wire-harness-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: max-content;
        min-width: 100%;
        --wire-col-name: 14ch;
        --wire-col-length: 10ch;
        --wire-col-dia: 7ch;
        --wire-col-from: 14ch;
        --wire-col-to: 14ch;
        --wire-col-status: 16ch;
        --wire-col-actions: 10ch;
      }
      .wire-harness-table-head,
      .wire-harness-table-row {
        display: grid;
        grid-template-columns:
          var(--wire-col-name)
          var(--wire-col-length)
          var(--wire-col-dia)
          var(--wire-col-from)
          var(--wire-col-to)
          var(--wire-col-status)
          var(--wire-col-actions);
        gap: 8px;
        align-items: center;
      }
      .wire-harness-table-head {
        padding: 0 10px;
      }
      .wire-harness-head-cell {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #93a4bf;
        white-space: nowrap;
      }
      .wire-harness-row {
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #1f2937;
        background: rgba(17, 24, 39, 0.65);
        transition: border-color 120ms ease, background 120ms ease;
      }
      .wire-harness-row:hover {
        border-color: #60a5fa;
        background: rgba(37, 99, 235, 0.08);
      }
      .wire-harness-cell {
        min-height: 34px;
        display: flex;
        align-items: center;
        white-space: nowrap;
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
        white-space: nowrap;
      }
      .wire-harness-length {
        justify-content: flex-end;
        padding: 0 8px;
        border: 1px solid #1f2937;
        border-radius: 6px;
        background: rgba(2, 6, 23, 0.55);
        color: #e5e7eb;
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
      .wire-harness-actions-cell {
        display: flex;
        justify-content: flex-end;
        white-space: nowrap;
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

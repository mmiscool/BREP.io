import { FloatingWindow } from '../FloatingWindow.js';
import { SelectionFilter } from '../SelectionFilter.js';

const PANEL_KEY = '__selectionStatePanel';

function _ensureStyles() {
  if (document.getElementById('selection-state-styles')) return;
  const style = document.createElement('style');
  style.id = 'selection-state-styles';
  style.textContent = `
    .selection-state-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      height: 100%;
      box-sizing: border-box;
      color: #e5e7eb;
      font-size: 12px;
    }
    .selection-state-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 700;
    }
    .selection-state-count {
      color: #cbd5f5;
      font-size: 12px;
    }
    .selection-state-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      background: rgba(8,10,14,.55);
      border: 1px solid #1f2937;
      border-radius: 8px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .selection-state-item {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 10px;
      align-items: center;
      padding: 4px 6px;
      border-radius: 6px;
      background: rgba(255,255,255,.02);
      border: 1px solid rgba(148,163,184,.18);
    }
    .selection-state-type {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #9aa0aa;
    }
    .selection-state-name {
      font-size: 12px;
      color: #e5e7eb;
      word-break: break-word;
    }
    .selection-state-empty {
      color: #9aa0aa;
      font-style: italic;
      padding: 6px;
    }
  `;
  document.head.appendChild(style);
}

function _labelFor(obj) {
  if (!obj) return 'Unknown';
  const name = obj.name
    || obj.userData?.faceName
    || obj.userData?.edgeName
    || obj.userData?.vertexName
    || obj.userData?.solidName
    || obj.userData?.name
    || null;
  return name || '(unnamed)';
}

class SelectionStatePanel {
  constructor(viewer) {
    this.viewer = viewer || null;
    this.window = null;
    this.root = null;
    this.content = null;
    this.countEl = null;
    this.listEl = null;
    this._boundSelectionChanged = this._handleSelectionChanged.bind(this);
    try { window.addEventListener('selection-changed', this._boundSelectionChanged); } catch { }
  }

  toggle() {
    if (this.root && this.root.style.display !== 'none') this.close();
    else this.open();
  }

  open() {
    this._ensureWindow();
    if (!this.root) return;
    this.root.style.display = 'flex';
    this._render();
  }

  close() {
    if (this.root) {
      try { this.root.style.display = 'none'; } catch { }
    }
  }

  _ensureWindow() {
    if (this.window && this.root) return;
    _ensureStyles();
    const fw = new FloatingWindow({
      title: 'Selection State',
      width: 360,
      height: 320,
      right: 14,
      top: 120,
      shaded: false,
      onClose: () => this.close(),
    });

    const content = document.createElement('div');
    content.className = 'selection-state-content';

    const header = document.createElement('div');
    header.className = 'selection-state-header';
    const title = document.createElement('div');
    title.textContent = 'Currently selected';
    const count = document.createElement('div');
    count.className = 'selection-state-count';
    header.appendChild(title);
    header.appendChild(count);

    const list = document.createElement('div');
    list.className = 'selection-state-list';

    content.appendChild(header);
    content.appendChild(list);
    fw.content.appendChild(content);

    this.window = fw;
    this.root = fw.root;
    this.content = content;
    this.countEl = count;
    this.listEl = list;
  }

  _handleSelectionChanged() {
    if (!this.root || this.root.style.display === 'none') return;
    this._render();
  }

  _render() {
    const list = this.listEl;
    const countEl = this.countEl;
    if (!list || !countEl) return;

    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene || null;
    const selection = SelectionFilter.getSelectedObjects({ scene }) || [];
    countEl.textContent = `${selection.length} selected`;

    list.textContent = '';
    if (!selection.length) {
      const empty = document.createElement('div');
      empty.className = 'selection-state-empty';
      empty.textContent = 'No items selected.';
      list.appendChild(empty);
      return;
    }

    for (const obj of selection) {
      const row = document.createElement('div');
      row.className = 'selection-state-item';
      const type = document.createElement('div');
      type.className = 'selection-state-type';
      type.textContent = String(obj?.type || 'object').toUpperCase();
      const name = document.createElement('div');
      name.className = 'selection-state-name';
      name.textContent = _labelFor(obj);
      row.appendChild(type);
      row.appendChild(name);
      list.appendChild(row);
    }
  }
}

export function createSelectionStateButton(viewer) {
  if (!viewer) return null;
  if (!viewer[PANEL_KEY]) {
    viewer[PANEL_KEY] = new SelectionStatePanel(viewer);
  }
  const panel = viewer[PANEL_KEY];
  return {
    label: 'Sel',
    title: 'Toggle selection state window',
    onClick: () => panel.toggle(),
  };
}

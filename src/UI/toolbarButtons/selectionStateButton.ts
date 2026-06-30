import { FloatingWindow } from '../FloatingWindow.js';
import { SelectionFilter } from '../SelectionFilter.js';

const PANEL_KEY = '__selectionStatePanel';

type SelectionStateViewer = Record<string, any>;

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
      grid-template-columns: auto minmax(0, 1fr) auto;
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
    .selection-state-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }
    .selection-state-action {
      background: #1b2433;
      color: #e5e7eb;
      border: 1px solid #2a3442;
      border-radius: 6px;
      padding: 4px 7px;
      cursor: pointer;
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .selection-state-action:hover {
      filter: brightness(1.12);
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

function _makeActionButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'selection-state-action';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try { onClick(); } catch (err) {
      try { console.warn(`[SelectionStatePanel] ${label} action failed:`, err); } catch {
        // best effort
      }
    }
  });
  return button;
}

class SelectionStatePanel {
  viewer: SelectionStateViewer | null;
  window: any;
  root: HTMLElement | null;
  content: HTMLElement | null;
  countEl: HTMLElement | null;
  listEl: HTMLElement | null;
  _boundSelectionChanged: () => void;

  constructor(viewer) {
    this.viewer = viewer || null;
    this.window = null;
    this.root = null;
    this.content = null;
    this.countEl = null;
    this.listEl = null;
    this._boundSelectionChanged = this._handleSelectionChanged.bind(this);
    try { window.addEventListener('selection-changed', this._boundSelectionChanged); } catch {
      // best effort
    }
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
      try { this.root.style.display = 'none'; } catch {
        // best effort
      }
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

  _openPropertiesFor(obj) {
    if (!obj || !this.viewer) return;
    if (typeof this.viewer._openInspectorPanel === 'function') {
      this.viewer._openInspectorPanel();
    } else if (typeof this.viewer.toggleInspectorPanel === 'function' && !this.viewer._inspectorOpen) {
      this.viewer.toggleInspectorPanel();
    }
    if (typeof this.viewer._updateInspectorFor === 'function') {
      this.viewer._updateInspectorFor(obj);
    }
  }

  _openMetadataFor(obj) {
    if (!obj || !this.viewer) return;
    const controller = this.viewer.__metadataPanelController || null;
    if (controller && typeof controller.openPanel === 'function' && typeof controller.handleSelection === 'function') {
      controller.openPanel();
      controller.handleSelection(obj);
      return;
    }
    if (typeof this.viewer.handleMetadataSelection === 'function') {
      this.viewer.handleMetadataSelection(obj);
    }
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
      const actions = document.createElement('div');
      actions.className = 'selection-state-actions';
      actions.appendChild(_makeActionButton('Properties', `Open properties for ${_labelFor(obj)}`, () => this._openPropertiesFor(obj)));
      actions.appendChild(_makeActionButton('Metadata', `Open metadata for ${_labelFor(obj)}`, () => this._openMetadataFor(obj)));
      row.appendChild(type);
      row.appendChild(name);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }
}

export function createSelectionStateButton(viewer) {
  if (!viewer) return null;
  const targetViewer = viewer as SelectionStateViewer;
  if (!targetViewer[PANEL_KEY]) {
    targetViewer[PANEL_KEY] = new SelectionStatePanel(targetViewer);
  }
  const panel = targetViewer[PANEL_KEY];
  return {
    label: 'Sel',
    title: 'Toggle selection state window',
    onClick: () => panel.toggle(),
  };
}

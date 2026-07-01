import '../EnvMonacoEditor.js';
import { FloatingWindow } from '../FloatingWindow.js';

type AnyRecord = Record<string | symbol, any>;

declare global {
  interface Window {
    viewer?: any;
    env?: any;
    monaco?: any;
  }
}

const PANEL_KEY = Symbol('ScriptRunnerPanel');
const CONSOLE_TREE_CHILD_LIMIT = 300;
const SCRIPT_DB_NAME = 'brep-script-runner';
const SCRIPT_DB_VERSION = 1;
const SCRIPT_STORE_NAME = 'scripts';
const SCRIPT_META_STORE_NAME = 'meta';
const LAST_SCRIPT_KEY = 'lastScriptId';
const DEFAULT_SCRIPT_ID = 'default';
const DEFAULT_SCRIPT_NAME = 'Scratch';
const DEFAULT_SNIPPET = `
// Access the app environment via the global "env" object.
console.log('env keys', Object.keys(env || {}));

// Example: log the active part history entry
console.log('active history', viewer?.partHistory);



`;

type StoredScript = {
  id: string;
  name: string;
  code: string;
  updatedAt: number;
};

function openScriptDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || !indexedDB.open) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(SCRIPT_DB_NAME, SCRIPT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCRIPT_STORE_NAME)) {
        db.createObjectStore(SCRIPT_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SCRIPT_META_STORE_NAME)) {
        db.createObjectStore(SCRIPT_META_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function withScriptStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openScriptDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      try { db.close(); } catch { /* ignore close failure */ }
    };
  });
}

async function listStoredScripts(): Promise<StoredScript[]> {
  const scripts = await withScriptStore<StoredScript[]>(SCRIPT_STORE_NAME, 'readonly', (store) => store.getAll());
  return Array.isArray(scripts)
    ? scripts.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    : [];
}

async function getStoredScript(id: string): Promise<StoredScript | null> {
  return await withScriptStore<StoredScript>(SCRIPT_STORE_NAME, 'readonly', (store) => store.get(id));
}

async function saveStoredScript(script: StoredScript): Promise<boolean> {
  const result = await withScriptStore<IDBValidKey>(SCRIPT_STORE_NAME, 'readwrite', (store) => store.put(script));
  return result !== null;
}

async function deleteStoredScript(id: string): Promise<boolean> {
  const result = await withScriptStore<undefined>(SCRIPT_STORE_NAME, 'readwrite', (store) => store.delete(id));
  return result !== null;
}

async function getLastScriptId(): Promise<string | null> {
  const id = await withScriptStore<string>(SCRIPT_META_STORE_NAME, 'readonly', (store) => store.get(LAST_SCRIPT_KEY));
  return typeof id === 'string' && id ? id : null;
}

async function setLastScriptId(id: string): Promise<void> {
  await withScriptStore<IDBValidKey>(SCRIPT_META_STORE_NAME, 'readwrite', (store) => store.put(id, LAST_SCRIPT_KEY));
}

function makeScriptId() {
  return `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class ScriptRunnerPanel {
  viewer: AnyRecord | null;
  window: any;
  root: HTMLElement | null;
  editorEl: (HTMLElement & AnyRecord) | null;
  editorWrap: HTMLElement | null;
  outputEl: HTMLElement | null;
  consoleWrap: HTMLElement | null;
  splitterEl: HTMLElement | null;
  contentRoot: HTMLElement | null;
  introEl: HTMLElement | null;
  scriptRowEl: HTMLElement | null;
  statusEl: HTMLElement | null;
  scriptSelectEl: HTMLSelectElement | null;
  scriptNameEl: HTMLInputElement | null;
  _initializedValue: boolean;
  _consoleHeight: number;
  _lastContentRect: any;
  _isRunning: boolean;
  _scriptId: string;
  _scripts: StoredScript[];
  _saveTimer: number | null;

  constructor(viewer) {
    this.viewer = viewer;
    this.window = null;
    this.root = null;
    this.editorEl = null;
    this.editorWrap = null;
    this.outputEl = null;
    this.consoleWrap = null;
    this.splitterEl = null;
    this.contentRoot = null;
    this.introEl = null;
    this.scriptRowEl = null;
    this.statusEl = null;
    this.scriptSelectEl = null;
    this.scriptNameEl = null;
    this._initializedValue = false;
    this._consoleHeight = 180;
    this._lastContentRect = null;
    this._isRunning = false;
    this._scriptId = DEFAULT_SCRIPT_ID;
    this._scripts = [];
    this._saveTimer = null;
  }

  toggle() {
    if (this.root && this.root.style.display !== 'none') this.close();
    else this.open();
  }

  open() {
    this._ensureWindow();
    if (!this.root) return;
    this.root.style.display = 'flex';
    try { this.editorEl?.refreshEnvAutocomplete?.(); } catch {
      // best effort
    }
  }

  close() {
    if (!this.root) return;
    try { this.root.style.display = 'none'; } catch {
      // best effort
    }
  }

  _ensureWindow() {
    if (this.root) return;
    const pageHeight = Number(window?.innerHeight) || 520;
    const initialHeight = Math.max(320, Math.round(pageHeight * 0.95));
    const fw = new FloatingWindow({
      title: 'Script Runner',
      width: 760,
      height: initialHeight,
      right: 16,
      top: 56,
      shaded: false,
      onClose: () => this.close(),
    });

    const btnRun = document.createElement('button');
    btnRun.className = 'fw-btn';
    btnRun.textContent = 'Run';
    btnRun.addEventListener('click', () => this._runCode());

    const btnRefresh = document.createElement('button');
    btnRefresh.className = 'fw-btn';
    btnRefresh.textContent = 'Refresh env autocomplete';
    btnRefresh.addEventListener('click', () => {
      try {
        this.editorEl?.refreshEnvAutocomplete?.();
        this._setStatus('env autocomplete refreshed from window.env');
      } catch {
        this._setStatus('Unable to refresh env autocomplete');
      }
    });


    fw.addHeaderAction(btnRun);
    fw.addHeaderAction(btnRefresh);

    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '8px';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.boxSizing = 'border-box';
    content.style.minHeight = '0';
    this.contentRoot = content;

    const intro = document.createElement('div');
    intro.textContent = 'Run ad-hoc JavaScript with Monaco highlighting and live window.env autocomplete.';
    intro.style.color = '#aeb6c5';
    intro.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    intro.style.opacity = '0.9';
    this.introEl = intro;

    const scriptRow = document.createElement('div');
    scriptRow.style.display = 'grid';
    scriptRow.style.gridTemplateColumns = 'auto auto auto minmax(120px, 1fr) minmax(120px, 1fr)';
    scriptRow.style.gap = '6px';
    scriptRow.style.alignItems = 'center';

    const scriptSelect = document.createElement('select');
    scriptSelect.style.minWidth = '0';
    scriptSelect.style.height = '28px';
    scriptSelect.style.background = '#111827';
    scriptSelect.style.color = '#f9fafb';
    scriptSelect.style.border = '1px solid #374151';
    scriptSelect.style.borderRadius = '8px';
    scriptSelect.style.padding = '0 8px';
    scriptSelect.addEventListener('change', () => this._loadSelectedScript());

    const scriptName = document.createElement('input');
    scriptName.type = 'text';
    scriptName.placeholder = 'Script name';
    scriptName.value = DEFAULT_SCRIPT_NAME;
    scriptName.style.minWidth = '0';
    scriptName.style.height = '28px';
    scriptName.style.background = '#111827';
    scriptName.style.color = '#f9fafb';
    scriptName.style.border = '1px solid #374151';
    scriptName.style.borderRadius = '8px';
    scriptName.style.padding = '0 8px';

    const btnSave = document.createElement('button');
    btnSave.className = 'fw-btn';
    btnSave.textContent = '💾';
    btnSave.title = 'Save script';
    btnSave.setAttribute('aria-label', 'Save script');
    this._styleScriptFileButton(btnSave);
    btnSave.addEventListener('click', () => this._saveCurrentScript());

    const btnNew = document.createElement('button');
    btnNew.className = 'fw-btn';
    btnNew.textContent = '📄';
    btnNew.title = 'New script';
    btnNew.setAttribute('aria-label', 'New script');
    this._styleScriptFileButton(btnNew);
    btnNew.addEventListener('click', () => this._newScript());

    const btnDelete = document.createElement('button');
    btnDelete.className = 'fw-btn';
    btnDelete.textContent = '🗑';
    btnDelete.title = 'Delete script';
    btnDelete.setAttribute('aria-label', 'Delete script');
    this._styleScriptFileButton(btnDelete);
    btnDelete.addEventListener('click', () => this._deleteCurrentScript());

    scriptRow.append(btnSave, btnNew, btnDelete, scriptSelect, scriptName);

    const editorWrap = document.createElement('div');
    editorWrap.style.display = 'flex';
    editorWrap.style.flexDirection = 'column';
    editorWrap.style.flex = '1 1 60%';
    editorWrap.style.minHeight = '200px';
    editorWrap.style.minWidth = '0';
    editorWrap.style.position = 'relative';

    const editor = document.createElement('env-monaco-editor') as HTMLElement & AnyRecord;
    editor.style.position = 'absolute';
    editor.style.inset = '0';
    editor.setAttribute('language', 'javascript');
    if (!this._initializedValue) {
      editor.value = DEFAULT_SNIPPET;
      this._initializedValue = true;
    }
    editor.addEventListener('change', () => this._scheduleAutoSave());

    const splitter = document.createElement('div');
    splitter.style.flex = '0 0 10px';
    splitter.style.height = '10px';
    splitter.style.cursor = 'row-resize';
    splitter.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))';
    splitter.style.border = '1px solid #1f2530';
    splitter.style.borderRadius = '8px';
    splitter.style.margin = '6px 0';
    splitter.style.position = 'relative';
    splitter.style.zIndex = '2';
    splitter.addEventListener('pointerdown', (ev) => this._onSplitterPointerDown(ev));

    const consoleWrap = document.createElement('div');
    consoleWrap.style.display = 'flex';
    consoleWrap.style.flexDirection = 'column';
    consoleWrap.style.flex = '0 0 180px';
    consoleWrap.style.minHeight = '120px';
    consoleWrap.style.maxHeight = '70vh';
    consoleWrap.style.gap = '6px';
    consoleWrap.style.position = 'relative';

    const output = document.createElement('div');
    output.style.flex = '1 1 auto';
    output.style.background = '#0e1117';
    output.style.border = '1px solid #1f2530';
    output.style.borderRadius = '8px';
    output.style.padding = '8px';
    output.style.overflowY = 'auto';
    output.style.overflowX = 'hidden';
    output.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    output.style.color = '#d1d5db';

    const statusRow = document.createElement('div');
    statusRow.style.display = 'flex';
    statusRow.style.alignItems = 'center';
    statusRow.style.gap = '8px';

    const status = document.createElement('div');
    status.style.flex = '1';
    status.style.color = '#9ca3af';
    status.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    status.textContent = 'Idle';

    const btnClear = document.createElement('button');
    btnClear.className = 'fw-btn';
    btnClear.textContent = 'Clear output';
    btnClear.addEventListener('click', () => { output.innerHTML = ''; });

    statusRow.appendChild(status);
    statusRow.appendChild(btnClear);

    content.appendChild(intro);
    content.appendChild(scriptRow);
    editorWrap.appendChild(editor);
    content.appendChild(editorWrap);
    content.appendChild(splitter);
    consoleWrap.appendChild(statusRow);
    consoleWrap.appendChild(output);
    content.appendChild(consoleWrap);

    fw.content.appendChild(content);

    this.window = fw;
    this.root = fw.root;
    this.editorEl = editor;
    this.editorWrap = editorWrap;
    this.outputEl = output;
    this.consoleWrap = consoleWrap;
    this.splitterEl = splitter;
    this.scriptRowEl = scriptRow;
    this.statusEl = status;
    this.scriptSelectEl = scriptSelect;
    this.scriptNameEl = scriptName;
    try { this.root.style.display = 'none'; } catch {
      // best effort
    }
    requestAnimationFrame(() => this._applySplitHeights());
    this._loadScriptsFromStorage();
  }

  async _loadScriptsFromStorage() {
    this._scripts = await listStoredScripts();
    if (!this._scripts.length) {
      const defaultScript = {
        id: DEFAULT_SCRIPT_ID,
        name: DEFAULT_SCRIPT_NAME,
        code: DEFAULT_SNIPPET,
        updatedAt: Date.now(),
      };
      await saveStoredScript(defaultScript);
      this._scripts = [defaultScript];
      await setLastScriptId(DEFAULT_SCRIPT_ID);
    }

    const lastId = await getLastScriptId();
    const active = this._scripts.find((script) => script.id === lastId) || this._scripts[0];
    this._applyScriptList(active.id);
    this._setEditorScript(active);
  }

  _styleScriptFileButton(button: HTMLButtonElement) {
    button.style.width = '28px';
    button.style.minWidth = '28px';
    button.style.maxWidth = '28px';
    button.style.height = '28px';
    button.style.minHeight = '28px';
    button.style.maxHeight = '28px';
    button.style.padding = '0';
    button.style.lineHeight = '1';
    button.style.fontSize = '14px';
  }

  _applyScriptList(activeId = this._scriptId) {
    if (!this.scriptSelectEl) return;
    this.scriptSelectEl.innerHTML = '';
    for (const script of this._scripts) {
      const option = document.createElement('option');
      option.value = script.id;
      option.textContent = script.name || 'Untitled';
      this.scriptSelectEl.appendChild(option);
    }
    this.scriptSelectEl.value = activeId;
  }

  _setEditorScript(script: StoredScript) {
    this._scriptId = script.id;
    if (this.scriptNameEl) this.scriptNameEl.value = script.name || DEFAULT_SCRIPT_NAME;
    if (this.scriptSelectEl) this.scriptSelectEl.value = script.id;
    if (this.editorEl) this.editorEl.value = script.code || '';
    this._initializedValue = true;
    this._setStatus(`Loaded ${script.name || 'script'}`);
  }

  async _loadSelectedScript() {
    const id = this.scriptSelectEl?.value || '';
    const script = this._scripts.find((item) => item.id === id) || await getStoredScript(id);
    if (!script) return;
    this._setEditorScript(script);
    await setLastScriptId(script.id);
  }

  async _saveCurrentScript() {
    const name = String(this.scriptNameEl?.value || '').trim() || DEFAULT_SCRIPT_NAME;
    const script = {
      id: this._scriptId || makeScriptId(),
      name,
      code: this.editorEl?.value || '',
      updatedAt: Date.now(),
    };
    const ok = await saveStoredScript(script);
    if (!ok) {
      this._setStatus('Unable to save script');
      return;
    }
    await setLastScriptId(script.id);
    this._scriptId = script.id;
    this._scripts = await listStoredScripts();
    this._applyScriptList(script.id);
    this._setStatus(`Saved ${name}`);
  }

  _scheduleAutoSave() {
    if (this._saveTimer !== null) {
      window.clearTimeout(this._saveTimer);
    }
    this._saveTimer = window.setTimeout(() => {
      this._saveTimer = null;
      this._saveCurrentScript();
    }, 250);
  }

  async _newScript() {
    const script = {
      id: makeScriptId(),
      name: 'Untitled',
      code: '',
      updatedAt: Date.now(),
    };
    this._scripts = this._scripts.concat(script);
    this._applyScriptList(script.id);
    this._setEditorScript(script);
    await setLastScriptId(script.id);
  }

  async _deleteCurrentScript() {
    if (!this._scriptId) return;
    await deleteStoredScript(this._scriptId);
    this._scripts = await listStoredScripts();
    if (!this._scripts.length) {
      const script = {
        id: DEFAULT_SCRIPT_ID,
        name: DEFAULT_SCRIPT_NAME,
        code: DEFAULT_SNIPPET,
        updatedAt: Date.now(),
      };
      await saveStoredScript(script);
      this._scripts = [script];
    }
    const next = this._scripts[0];
    this._applyScriptList(next.id);
    this._setEditorScript(next);
    await setLastScriptId(next.id);
  }

  async _runCode() {
    if (this._isRunning) {
      this._setStatus('Already running');
      return;
    }
    const code = this.editorEl?.value || '';
    if (!code.trim()) {
      this._setStatus('Nothing to run');
      return;
    }
    this._appendOutput(`>>> Running at ${new Date().toLocaleTimeString()}`);
    this._setStatus('Running...');
    this._isRunning = true;

    const exec = () => {
      const runtimeViewer = window.viewer ?? this.viewer ?? null;
      const runtimeEnv = window.env ?? runtimeViewer;
      const editorApi = window.monaco;
      const fn = new Function('viewer', 'env', 'monaco', `"use strict";\n${code}`);
      return fn(runtimeViewer, runtimeEnv, editorApi);
    };

    try {
      const runResult = await this._withConsoleCapture(async () => {
        const result = exec();
        if (result && typeof result.then === 'function') {
          return { value: await result, async: true };
        }
        return { value: result, async: false };
      });
      this._appendOutput(this._stringify(runResult.value));
      if (runResult.async) {
        this._setStatus('Completed (async)');
      } else {
        this._setStatus('Completed');
      }
    } catch (e) {
      const msg = e?.stack || e?.message || String(e);
      this._appendOutput(msg, true);
      this._setStatus('Error');
      try { console.error('[ScriptRunner]', e); } catch {
        // best effort
      }
    } finally {
      this._isRunning = false;
    }
  }

  async _withConsoleCapture(fn) {
    const consoleObj = window.console as any;
    if (!consoleObj) return fn();
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'table', 'trace'];
    const originals = new Map();

    for (const method of methods) {
      const original = consoleObj[method];
      if (typeof original !== 'function') continue;
      originals.set(method, original);
      try {
        consoleObj[method] = (...args) => {
          try {
            this._appendConsoleCall(method, args);
          } catch {
            // best effort
          }
          return original.apply(consoleObj, args);
        };
      } catch {
        // best effort
      }
    }

    try {
      return await fn();
    } finally {
      for (const [method, original] of originals.entries()) {
        try { consoleObj[method] = original; } catch {
          // best effort
        }
      }
    }
  }

  _appendConsoleCall(method, args) {
    if (!this.outputEl) return;
    const line = this._createOutputLine(method === 'error' ? true : method);
    line.style.display = 'flex';
    line.style.flexWrap = 'wrap';
    line.style.alignItems = 'baseline';
    line.style.columnGap = '6px';
    line.style.rowGap = '2px';
    line.style.minWidth = '0';
    line.style.width = '100%';
    if (method !== 'log') {
      const prefix = document.createElement('span');
      prefix.textContent = `${method}:`;
      prefix.style.color = this._outputColor(method);
      prefix.style.fontWeight = '700';
      line.appendChild(prefix);
    }

    if (!args.length) {
      const empty = document.createElement('span');
      empty.textContent = method === 'log' ? '' : ' ';
      line.appendChild(empty);
    }

    for (const arg of args) {
      if (this._isExpandableConsoleValue(arg)) {
        line.appendChild(this._createConsoleTreeNode(arg, '', []));
      } else {
        const span = document.createElement('span');
        span.textContent = this._formatConsoleLeafValue(arg);
        span.style.whiteSpace = 'pre-wrap';
        span.style.overflowWrap = 'anywhere';
        span.style.minWidth = '0';
        line.appendChild(span);
      }
    }

    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  _stringifyConsoleArg(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === 'function') return value.toString();
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'bigint') return `${value.toString()}n`;
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') return `${item.toString()}n`;
        if (typeof item === 'function') return item.toString();
        if (typeof item === 'symbol') return item.toString();
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      }, 2);
      return typeof json === 'string' ? json : String(value);
    } catch {
      try { return String(value); } catch {
        return '[unprintable]';
      }
    }
  }

  _isInspectableConsoleValue(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }

  _isExpandableConsoleValue(value) {
    return this._isInspectableConsoleValue(value) && this._hasExpandableConsoleChildren(value);
  }

  _hasExpandableConsoleChildren(value) {
    if (!this._isInspectableConsoleValue(value)) return false;
    let keys = [];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return false;
    }
    for (const key of keys) {
      let descriptor = null;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        continue;
      }
      if (descriptor && ('get' in descriptor || 'set' in descriptor) && !('value' in descriptor)) {
        if (typeof descriptor.get === 'function') return true;
        continue;
      }
      const child = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (this._isInspectableConsoleValue(child)) return true;
    }
    return false;
  }

  _createConsoleTreeNode(value, label = '', ancestors = []) {
    if (!this._isInspectableConsoleValue(value)) {
      const span = document.createElement('span');
      span.textContent = label ? `${label}: ${this._stringifyConsoleArg(value)}` : this._stringifyConsoleArg(value);
      return span;
    }
    if (ancestors.includes(value)) {
      const circular = document.createElement('span');
      circular.textContent = label ? `${label}: [Circular]` : '[Circular]';
      circular.style.color = '#fbbf24';
      return circular;
    }

    const details = document.createElement('details');
    details.style.display = 'block';
    details.style.flex = label ? '1 1 100%' : '1 1 100%';
    details.style.minWidth = '0';
    details.style.width = '100%';
    details.style.maxWidth = '100%';
    details.style.verticalAlign = 'top';
    details.style.borderLeft = '1px solid #263041';
    details.style.marginLeft = '0';
    details.style.paddingLeft = '6px';
    details.style.boxSizing = 'border-box';
    details.style.overflow = 'hidden';

    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.style.listStyle = 'none';
    summary.style.userSelect = 'none';
    summary.style.display = 'grid';
    summary.style.gridTemplateColumns = '14px minmax(0, auto) minmax(0, 1fr)';
    summary.style.gap = '4px';
    summary.style.alignItems = 'baseline';
    summary.style.whiteSpace = 'normal';
    summary.style.overflow = 'visible';
    summary.style.color = '#d1d5db';
    summary.style.minWidth = '0';

    const marker = document.createElement('span');
    marker.textContent = '>';
    marker.style.display = 'inline-block';
    marker.style.width = '12px';
    marker.style.color = '#9ca3af';
    marker.style.transition = 'transform .12s ease';
    summary.appendChild(marker);

    const title = document.createElement('span');
    title.textContent = label ? `${label}: ` : '';
    title.style.color = '#e5e7eb';
    title.style.fontWeight = label ? '700' : '400';
    summary.appendChild(title);

    const preview = document.createElement('span');
    preview.textContent = this._consoleValuePreview(value);
    preview.style.color = '#aeb6c5';
    preview.style.minWidth = '0';
    preview.style.overflowWrap = 'anywhere';
    summary.appendChild(preview);

    const children = document.createElement('div');
    children.style.display = 'block';
    children.style.marginLeft = '14px';
    children.style.paddingTop = '2px';
    children.style.minWidth = '0';
    children.style.maxWidth = '100%';
    children.style.boxSizing = 'border-box';

    let loaded = false;
    details.addEventListener('toggle', () => {
      marker.textContent = details.open ? 'v' : '>';
      if (!details.open || loaded) return;
      loaded = true;
      this._loadConsoleTreeChildren(children, value, ancestors.concat(value));
    });

    details.append(summary, children);
    return details;
  }

  _loadConsoleTreeChildren(container, value, ancestors) {
    let keys = [];
    try {
      keys = Reflect.ownKeys(value);
    } catch (e) {
      container.appendChild(this._createConsoleTreeMessage(`Unable to inspect: ${e?.message || String(e)}`, true));
      return;
    }

    if (!keys.length) {
      container.appendChild(this._createConsoleTreeMessage('(no own properties)'));
      return;
    }

    const shownKeys = keys.slice(0, CONSOLE_TREE_CHILD_LIMIT);
    for (const key of shownKeys) {
      container.appendChild(this._createConsolePropertyRow(value, key, ancestors));
    }
    if (keys.length > shownKeys.length) {
      container.appendChild(this._createConsoleTreeMessage(`... ${keys.length - shownKeys.length} more properties not shown`));
    }
  }

  _createConsolePropertyRow(owner, key, ancestors) {
    const keyLabel = typeof key === 'symbol' ? key.toString() : String(key);
    let descriptor = null;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
    } catch {
      // best effort
    }

    if (descriptor && ('get' in descriptor || 'set' in descriptor) && !('value' in descriptor)) {
      return this._createConsoleAccessorRow(owner, key, keyLabel, descriptor, ancestors);
    }

    let value;
    try {
      value = descriptor && 'value' in descriptor ? descriptor.value : owner[key];
    } catch (e) {
      return this._createConsoleTreeMessage(`${keyLabel}: [Thrown: ${e?.message || String(e)}]`, true);
    }

    if (this._isExpandableConsoleValue(value)) {
      return this._createConsoleTreeNode(value, keyLabel, ancestors);
    }

    return this._createConsolePropertyValueRow(keyLabel, value);
  }

  _createConsoleAccessorRow(owner, key, keyLabel, descriptor, ancestors) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.alignItems = 'baseline';
    row.style.gap = '8px';
    row.style.padding = '1px 0';
    row.style.minWidth = '0';
    row.style.maxWidth = '100%';
    row.style.boxSizing = 'border-box';

    const label = document.createElement('span');
    label.textContent = `${keyLabel}:`;
    label.style.color = '#e5e7eb';
    label.style.fontWeight = '700';
    label.style.minWidth = '0';
    label.style.overflowWrap = 'anywhere';

    const value = document.createElement('span');
    value.textContent = descriptor.get && descriptor.set ? '[Getter/Setter]' : descriptor.get ? '[Getter]' : '[Setter]';
    value.style.color = '#9ca3af';
    value.style.minWidth = '0';

    row.append(label, value);

    if (typeof descriptor.get === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'get';
      btn.className = 'fw-btn';
      btn.style.padding = '1px 6px';
      btn.addEventListener('click', (ev) => {
        try { ev.preventDefault(); ev.stopPropagation(); } catch {
          // best effort
        }
        try {
          const next = descriptor.get.call(owner);
          row.replaceWith(this._isExpandableConsoleValue(next)
            ? this._createConsoleTreeNode(next, keyLabel, ancestors)
            : this._createConsolePropertyValueRow(keyLabel, next));
        } catch (e) {
          row.replaceWith(this._createConsoleTreeMessage(`${keyLabel}: [Thrown: ${e?.message || String(e)}]`, true));
        }
      });
      row.appendChild(btn);
    }

    return row;
  }

  _createConsolePropertyValueRow(keyLabel, value) {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'minmax(0, 32%) minmax(0, 1fr)';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.minWidth = '0';
    row.style.maxWidth = '100%';
    row.style.boxSizing = 'border-box';
    row.style.padding = '1px 0';
    const keyEl = document.createElement('span');
    keyEl.textContent = keyLabel;
    keyEl.style.color = '#e5e7eb';
    keyEl.style.fontWeight = '700';
    keyEl.style.minWidth = '0';
    keyEl.style.overflowWrap = 'anywhere';
    const valueEl = document.createElement('span');
    valueEl.textContent = this._formatConsoleLeafValue(value);
    valueEl.style.color = this._consolePrimitiveColor(value);
    valueEl.style.whiteSpace = 'pre-wrap';
    valueEl.style.overflowWrap = 'anywhere';
    valueEl.style.minWidth = '0';
    row.append(keyEl, valueEl);
    return row;
  }

  _createConsoleTreeMessage(text, isError = false) {
    const msg = document.createElement('div');
    msg.textContent = text;
    msg.style.color = isError ? '#fca5a5' : '#9ca3af';
    msg.style.fontStyle = 'italic';
    msg.style.padding = '1px 0';
    return msg;
  }

  _consoleValuePreview(value) {
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}`;
    if (value instanceof Date) return `Date ${Number.isNaN(value.getTime()) ? 'Invalid' : value.toISOString()}`;
    if (Array.isArray(value)) return `Array(${value.length})`;
    const ctor = value?.constructor?.name;
    let keyText = '';
    try {
      const keys = Object.keys(value).slice(0, 6);
      keyText = keys.length ? ` { ${keys.join(', ')}${Object.keys(value).length > keys.length ? ', ...' : ''} }` : '';
    } catch {
      // best effort
    }
    return `${ctor && ctor !== 'Object' ? ctor : 'Object'}${keyText}`;
  }

  _formatConsoleLeafValue(value) {
    if (!this._isInspectableConsoleValue(value)) return this._stringifyConsoleArg(value);
    if (value instanceof Error) return value.stack || `${value.name || 'Error'}: ${value.message || ''}`;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (Array.isArray(value)) return `[${value.map((item) => this._formatConsoleLeafValue(item)).join(', ')}]`;
    if (typeof value === 'function') return value.toString();

    let keys = [];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return this._consoleValuePreview(value);
    }
    const parts = [];
    for (const key of keys.slice(0, CONSOLE_TREE_CHILD_LIMIT)) {
      const keyLabel = typeof key === 'symbol' ? key.toString() : String(key);
      let descriptor = null;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        // best effort
      }
      if (descriptor && ('get' in descriptor || 'set' in descriptor) && !('value' in descriptor)) {
        parts.push(`${keyLabel}: ${descriptor.get && descriptor.set ? '[Getter/Setter]' : descriptor.get ? '[Getter]' : '[Setter]'}`);
        continue;
      }
      if (!descriptor || !('value' in descriptor)) continue;
      parts.push(`${keyLabel}: ${this._stringifyConsoleArg(descriptor.value)}`);
    }
    if (keys.length > CONSOLE_TREE_CHILD_LIMIT) parts.push(`... ${keys.length - CONSOLE_TREE_CHILD_LIMIT} more`);
    const ctor = value?.constructor?.name;
    const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
    return `${prefix}{ ${parts.join(', ')} }`;
  }

  _consolePrimitiveColor(value) {
    if (typeof value === 'string') return '#86efac';
    if (typeof value === 'number' || typeof value === 'bigint') return '#fcd34d';
    if (typeof value === 'boolean') return '#93c5fd';
    if (value === null || value === undefined) return '#9ca3af';
    if (typeof value === 'symbol') return '#c4b5fd';
    return '#d1d5db';
  }

  _appendOutput(text, isError = false) {
    if (!this.outputEl) return;
    const line = this._createOutputLine(isError);
    line.textContent = text;
    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  _createOutputLine(kind = false) {
    const line = document.createElement('div');
    line.style.whiteSpace = 'pre-wrap';
    line.style.overflowWrap = 'anywhere';
    line.style.minWidth = '0';
    line.style.maxWidth = '100%';
    line.style.boxSizing = 'border-box';
    line.style.color = this._outputColor(kind);
    line.style.margin = '1px 0';
    return line;
  }

  _outputColor(kind) {
    if (kind === true || kind === 'error') return '#fca5a5';
    if (kind === 'warn') return '#fbbf24';
    if (kind === 'info') return '#93c5fd';
    if (kind === 'debug') return '#9ca3af';
    return '#d1d5db';
  }

  _setStatus(msg) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
  }

  _stringify(value) {
    try {
      if (typeof value === 'string') return value;
      if (typeof value === 'function') return value.toString();
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      const json = JSON.stringify(value, null, 2);
      return typeof json === 'string' ? json : String(value);
    } catch {
      try { return String(value); } catch {
        return '[unprintable]';
      }
    }
  }

  _onSplitterPointerDown(ev) {
    if (ev.button !== 0) return;
    const startY = ev.clientY;
    const startHeight = (this.consoleWrap?.getBoundingClientRect?.().height) || this._consoleHeight;
    const onMove = (e) => {
      const dy = e.clientY - startY;
      this._setConsoleHeight(startHeight - dy);
      try { e.preventDefault(); } catch {
        // best effort
      }
    };
    const onUp = (_e) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      try { this._consoleHeight = (this.consoleWrap?.getBoundingClientRect?.().height) || this._consoleHeight; } catch {
        // best effort
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    try { ev.preventDefault(); } catch {
      // best effort
    }
  }

  _setConsoleHeight(px) {
    if (!this.contentRoot || !this.consoleWrap || !this.editorWrap) return;
    const minConsole = 120;
    const minEditor = 180;
    const rect = this.contentRoot.getBoundingClientRect?.();
    const contentH = rect?.height || 0;
    const introH = this.introEl?.offsetHeight || 0;
    const scriptRowH = this.scriptRowEl?.offsetHeight || 0;
    const splitterH = this.splitterEl?.offsetHeight || 10;
    const available = Math.max(0, contentH - introH - scriptRowH - splitterH - 16); // account for gaps/margins
    if (available <= 0) return;
    const maxConsole = Math.max(minConsole, available - minEditor);
    const clamped = Math.min(Math.max(px, minConsole), maxConsole);
    const editorHeight = Math.max(minEditor, available - clamped);
    this._consoleHeight = clamped;
    this.consoleWrap.style.flexBasis = `${clamped}px`;
    this.consoleWrap.style.height = `${clamped}px`;
    this.editorWrap.style.flexBasis = `${editorHeight}px`;
    this.editorWrap.style.height = `${editorHeight}px`;
    try { this.editorEl?.editor?.layout?.(); } catch {
      // best effort
    }
  }

  _applySplitHeights() {
    this._setConsoleHeight(this._consoleHeight);
    try { this.editorEl?.editor?.layout?.(); } catch {
      // best effort
    }
  }
}

export function createScriptRunnerButton(viewer) {
  if (!viewer) return null;
  const targetViewer = viewer as AnyRecord;
  if (!targetViewer[PANEL_KEY]) {
    targetViewer[PANEL_KEY] = new ScriptRunnerPanel(targetViewer);
  }
  const panel = targetViewer[PANEL_KEY];
  return {
    label: '</>',
    title: 'Open Script Runner',
    onClick: () => panel.toggle(),
  };
}

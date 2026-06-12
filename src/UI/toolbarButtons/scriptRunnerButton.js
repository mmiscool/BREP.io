import '../EnvMonacoEditor.js';
import { FloatingWindow } from '../FloatingWindow.js';

const PANEL_KEY = Symbol('ScriptRunnerPanel');
const CONSOLE_TREE_CHILD_LIMIT = 300;
const DEFAULT_SNIPPET = `// Access the app environment via the global "env" object.
console.log('env keys', Object.keys(env || {}));

// Example: log the active part history entry
console.log('active history', viewer?.partHistory?.getActiveStep?.());
`;

class ScriptRunnerPanel {
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
    this.statusEl = null;
    this._initializedValue = false;
    this._consoleHeight = 180;
    this._lastContentRect = null;
    this._isRunning = false;
  }

  toggle() {
    if (this.root && this.root.style.display !== 'none') this.close();
    else this.open();
  }

  open() {
    this._ensureWindow();
    if (!this.root) return;
    this.root.style.display = 'flex';
    try { this.editorEl?.refreshEnvAutocomplete?.(); } catch {}
  }

  close() {
    if (!this.root) return;
    try { this.root.style.display = 'none'; } catch {}
  }

  _ensureWindow() {
    if (this.root) return;
    const fw = new FloatingWindow({
      title: 'Script Runner',
      width: 760,
      height: 520,
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

    const editorWrap = document.createElement('div');
    editorWrap.style.display = 'flex';
    editorWrap.style.flexDirection = 'column';
    editorWrap.style.flex = '1 1 60%';
    editorWrap.style.minHeight = '200px';
    editorWrap.style.minWidth = '0';
    editorWrap.style.position = 'relative';

    const editor = document.createElement('env-monaco-editor');
    editor.style.position = 'absolute';
    editor.style.inset = '0';
    editor.setAttribute('language', 'javascript');
    if (!this._initializedValue) {
      editor.value = DEFAULT_SNIPPET;
      this._initializedValue = true;
    }

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
    this.statusEl = status;
    try { this.root.style.display = 'none'; } catch {}
    requestAnimationFrame(() => this._applySplitHeights());
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
      try { console.error('[ScriptRunner]', e); } catch {}
    } finally {
      this._isRunning = false;
    }
  }

  async _withConsoleCapture(fn) {
    const consoleObj = window.console;
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
          } catch {}
          return original.apply(consoleObj, args);
        };
      } catch {}
    }

    try {
      return await fn();
    } finally {
      for (const [method, original] of originals.entries()) {
        try { consoleObj[method] = original; } catch {}
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
      try { return String(value); } catch { return '[unprintable]'; }
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
    } catch {}

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
        try { ev.preventDefault(); ev.stopPropagation(); } catch {}
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
    } catch {}
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
      } catch {}
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
      try { return String(value); } catch { return '[unprintable]'; }
    }
  }

  _onSplitterPointerDown(ev) {
    if (ev.button !== 0) return;
    const startY = ev.clientY;
    const startHeight = (this.consoleWrap?.getBoundingClientRect?.().height) || this._consoleHeight;
    const onMove = (e) => {
      const dy = e.clientY - startY;
      this._setConsoleHeight(startHeight - dy);
      try { e.preventDefault(); } catch {}
    };
    const onUp = (_e) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      try { this._consoleHeight = (this.consoleWrap?.getBoundingClientRect?.().height) || this._consoleHeight; } catch {}
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    try { ev.preventDefault(); } catch {}
  }

  _setConsoleHeight(px) {
    if (!this.contentRoot || !this.consoleWrap || !this.editorWrap) return;
    const minConsole = 120;
    const minEditor = 180;
    const rect = this.contentRoot.getBoundingClientRect?.();
    const contentH = rect?.height || 0;
    const introH = this.introEl?.offsetHeight || 0;
    const splitterH = this.splitterEl?.offsetHeight || 10;
    const available = Math.max(0, contentH - introH - splitterH - 8); // account for gap/margins
    if (available <= 0) return;
    const maxConsole = Math.max(minConsole, available - minEditor);
    const clamped = Math.min(Math.max(px, minConsole), maxConsole);
    const editorHeight = Math.max(minEditor, available - clamped);
    this._consoleHeight = clamped;
    this.consoleWrap.style.flexBasis = `${clamped}px`;
    this.consoleWrap.style.height = `${clamped}px`;
    this.editorWrap.style.flexBasis = `${editorHeight}px`;
    this.editorWrap.style.height = `${editorHeight}px`;
    try { this.editorEl?.editor?.layout?.(); } catch {}
  }

  _applySplitHeights() {
    this._setConsoleHeight(this._consoleHeight);
    try { this.editorEl?.editor?.layout?.(); } catch {}
  }
}

export function createScriptRunnerButton(viewer) {
  if (!viewer) return null;
  if (!viewer[PANEL_KEY]) {
    viewer[PANEL_KEY] = new ScriptRunnerPanel(viewer);
  }
  const panel = viewer[PANEL_KEY];
  return {
    label: '</>',
    title: 'Open Script Runner',
    onClick: () => panel.toggle(),
  };
}

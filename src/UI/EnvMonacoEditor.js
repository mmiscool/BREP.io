import * as monacoApi from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import monacoEditorCss from 'monaco-editor/min/vs/editor/editor.main.css?inline';

class EnvMonacoEditor extends HTMLElement {
  static get observedAttributes() {
    return ['language', 'readonly', 'theme'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._editor = null;
    this._model = null;

    this._pendingValue = '';
    this._pendingLanguage = null;
    this._container = null;
    this._loading = null;
  }

  connectedCallback() {
    this._ensureShell();
    this._boot();
  }

  disconnectedCallback() {
    this._disposeEditor();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === 'language') {
      if (this._editor && this._model && window.monaco) {
        window.monaco.editor.setModelLanguage(this._model, this.language);
      } else {
        this._pendingLanguage = this.language;
      }
    }

    if (name === 'readonly') {
      if (this._editor) this._editor.updateOptions({ readOnly: this.readonly });
    }

    if (name === 'theme') {
      if (this._editor && window.monaco) {
        window.monaco.editor.setTheme(this.theme);
      }
    }
  }

  get value() {
    return this._editor ? this._editor.getValue() : this._pendingValue;
  }

  set value(v) {
    const text = String(v ?? '');
    if (this._editor) this._editor.setValue(text);
    else this._pendingValue = text;
  }

  get language() {
    return this.getAttribute('language') || 'javascript';
  }

  set language(v) {
    this.setAttribute('language', v);
  }

  get readonly() {
    return this.hasAttribute('readonly');
  }

  set readonly(v) {
    if (v) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
  }

  get theme() {
    return this.getAttribute('theme') || 'vs-dark';
  }

  set theme(v) {
    this.setAttribute('theme', v);
  }

  get monaco() {
    return window.monaco || null;
  }

  get editor() {
    return this._editor || null;
  }

  refreshEnvAutocomplete() {
    if (!window.monaco) return;
    this._installEnvAutocomplete();
  }

  setValuePreserveUndo(text) {
    if (!this._editor || !this._model) {
      this._pendingValue = String(text ?? '');
      return;
    }
    const fullRange = this._model.getFullModelRange();
    this._editor.executeEdits('env-monaco-editor', [
      { range: fullRange, text: String(text ?? ''), forceMoveMarkers: true },
    ]);
  }

  _ensureShell() {
    if (this._container && this._loading) return;
    if (!this.shadowRoot) return;

    const monacoStyleEl = document.createElement('style');
    monacoStyleEl.textContent = monacoEditorCss;

    const shellStyleEl = document.createElement('style');
    shellStyleEl.textContent = `
      :host {
        display: block;
        position: relative;
        min-height: 120px;
        background: #0f0f12;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        overflow: hidden;
        box-sizing: border-box;
      }
      *, *::before, *::after {
        box-sizing: inherit;
      }
      .wrap {
        height: 100%;
        width: 100%;
        position: absolute;
        inset: 0;
      }
      .container {
        height: 100%;
        width: 100%;
        position: absolute;
        inset: 0;
      }
      .loading {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: rgba(255,255,255,0.72);
        font: 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
              "Courier New", monospace;
        letter-spacing: 0.2px;
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
        user-select: none;
        pointer-events: none;
      }
    `;

    const wrapEl = document.createElement('div');
    wrapEl.className = 'wrap';

    const containerEl = document.createElement('div');
    containerEl.className = 'container';

    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading';
    loadingEl.textContent = 'Loading editor...';

    wrapEl.append(containerEl, loadingEl);
    this.shadowRoot.replaceChildren(monacoStyleEl, shellStyleEl, wrapEl);

    this._container = containerEl;
    this._loading = loadingEl;
  }

  async _boot() {
    try {
      const monaco = await EnvMonacoEditor._loadMonaco();
      EnvMonacoEditor._registerRuntimeCompletion(monaco);
      this._createEditor(monaco);
      this._installEnvAutocomplete();
      monaco.editor.setTheme(this.theme);
      this._loading.style.display = 'none';
    } catch (e) {
      try {
        this._loading.textContent = 'Editor failed to load';
        this._loading.style.pointerEvents = 'auto';
      } catch {}
      try { console.warn('[EnvMonacoEditor] Failed to load Monaco', e); } catch {}
    }
  }

  _createEditor(monaco) {
    const uri = monaco.Uri.parse(`file:///env-monaco-editor/${EnvMonacoEditor._uuid()}.js`);
    const lang = this._pendingLanguage || this.language;

    this._model = monaco.editor.createModel(this._pendingValue || '', lang, uri);

    this._editor = monaco.editor.create(this._container, {
      model: this._model,
      theme: this.theme,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 19,
      tabSize: 2,
      insertSpaces: true,
      readOnly: this.readonly,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
    });

    this._editor.onDidChangeModelContent(() => {
      this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      this.dispatchEvent(
        new CustomEvent('change', {
          detail: { value: this._editor.getValue() },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  _installEnvAutocomplete() {}

  _disposeEditor() {
    if (this._editor) this._editor.dispose();
    this._editor = null;
    if (this._model) this._model.dispose();
    this._model = null;
  }

  _collectProps(obj) {
    const props = [];
    const seenProtos = new Set();
    let cursor = obj;
    while (cursor && cursor !== Object.prototype && cursor !== Function.prototype) {
      if (seenProtos.has(cursor)) break;
      seenProtos.add(cursor);
      let descs = null;
      try { descs = Object.getOwnPropertyDescriptors(cursor); } catch { descs = null; }
      if (!descs) {
        cursor = Object.getPrototypeOf(cursor);
        continue;
      }
      for (const [key, desc] of Object.entries(descs)) {
        if (key === 'constructor') continue;
        if (props.some((p) => p.key === key)) continue;
        const hasValue = Object.prototype.hasOwnProperty.call(desc, 'value');
        const getterOnly = !hasValue && (!!desc.get || !!desc.set);
        const val = hasValue ? desc.value : undefined;
        props.push({ key, value: val, getterOnly });
      }
      cursor = Object.getPrototypeOf(cursor);
    }
    return props;
  }

  static _registerRuntimeCompletion(monaco) {
    if (EnvMonacoEditor._runtimeCompletionRegistered) return;
    EnvMonacoEditor._runtimeCompletionRegistered = true;
    try {
      monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['.', '?'],
        provideCompletionItems: (model, position) => {
          try {
            const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
            const expr = line.split(/[^A-Za-z0-9_$?.]/).pop() || '';
            if (!expr || !expr.startsWith('env')) return { suggestions: [] };
            const cleaned = expr.replace(/^\?/g, '').replace(/\?/g, '');
            const parts = cleaned.split('.').filter(Boolean);
            if (parts[0] !== 'env') return { suggestions: [] };
            parts.shift();
            let target = window.env;
            for (const p of parts) {
              if (target && typeof target === 'object' && p in target) target = target[p];
              else return { suggestions: [] };
            }
            if (target == null) return { suggestions: [] };
            const keys = Array.from(new Set(
              this.prototype._collectProps ? this.prototype._collectProps(target).map((p) => p.key) : Object.keys(target),
            ));
            const wordInfo = model.getWordUntilPosition(position);
            const range = new monaco.Range(
              position.lineNumber,
              wordInfo.startColumn,
              position.lineNumber,
              wordInfo.endColumn,
            );
            const suggestions = keys.map((key) => ({
              label: key,
              insertText: key,
              kind: monaco.languages.CompletionItemKind.Property,
              range,
            }));
            return { suggestions };
          } catch {
            return { suggestions: [] };
          }
        },
      });
    } catch {}
  }

  static _uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }

  static _loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (EnvMonacoEditor._monacoPromise) return EnvMonacoEditor._monacoPromise;

    EnvMonacoEditor._monacoPromise = Promise.resolve().then(() => {
      const loaded = globalThis.monaco || monacoApi;
      window.monaco = loaded;
      return loaded;
    });

    return EnvMonacoEditor._monacoPromise;
  }
}

EnvMonacoEditor._monacoPromise = null;
EnvMonacoEditor._runtimeCompletionRegistered = false;

if (!customElements.get('env-monaco-editor')) {
  customElements.define('env-monaco-editor', EnvMonacoEditor);
}

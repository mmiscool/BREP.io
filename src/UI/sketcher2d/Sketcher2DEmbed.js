import { deepClone } from "../../utils/deepClone.js";
import { sketchToSVG } from "./sketchToSVG.js";
export { bootSketcher2DFrame } from "./Sketcher2DFrameApp.js";

const DEFAULT_CHANNEL = "brep:sketcher2d";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_THEME = {
  geometryColor: null,
  pointColor: null,
  constraintColor: null,
  backgroundColor: null,
};

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withTimeout(promise, timeoutMs, message) {
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  if (ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function resolveHost(target) {
  if (!target) return null;
  if (typeof target === "string") return document.querySelector(target);
  if (typeof target.appendChild === "function") return target;
  return null;
}

function makeInstanceId() {
  return `sk2d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTheme(theme = {}) {
  return {
    geometryColor: theme?.geometryColor ?? null,
    pointColor: theme?.pointColor ?? null,
    constraintColor: theme?.constraintColor ?? null,
    backgroundColor: theme?.backgroundColor ?? null,
  };
}

export class Sketcher2DEmbed {
  constructor(options = {}) {
    this._options = options || {};
    this._channel = this._options.channel || DEFAULT_CHANNEL;
    this._instanceId = this._options.instanceId || makeInstanceId();
    this._requestTimeoutMs = Number.isFinite(Number(this._options.requestTimeoutMs))
      ? Number(this._options.requestTimeoutMs)
      : DEFAULT_TIMEOUT_MS;
    this._targetOrigin = this._options.targetOrigin || "*";
    this._onChange = typeof this._options.onChange === "function" ? this._options.onChange : null;
    this._onFinished = typeof this._options.onFinished === "function"
      ? this._options.onFinished
      : (typeof this._options.onFinish === "function" ? this._options.onFinish : null);
    this._onCancelled = typeof this._options.onCancelled === "function"
      ? this._options.onCancelled
      : (typeof this._options.onCanceled === "function" ? this._options.onCanceled : null);
    this._frameModuleUrl = this._options.frameModuleUrl || import.meta.url;
    this._ready = createDeferred();
    this._initialized = createDeferred();
    this._initStarted = false;
    this._destroyed = false;
    this._pending = new Map();
    this._requestSeq = 0;
    this._latestSketch = null;
    this._initialSketch = this._options.initialSketch ? deepClone(this._options.initialSketch) : null;
    this._initialCss = typeof this._options.cssText === "string" ? this._options.cssText : "";
    this._theme = normalizeTheme({
      ...DEFAULT_THEME,
      geometryColor: this._options.geometryColor,
      pointColor: this._options.pointColor,
      constraintColor: this._options.constraintColor,
      backgroundColor: this._options.backgroundColor,
    });
    this._sidebarExpanded = this._options.sidebarExpanded !== false;
    this._iframe = null;
    this._host = null;
    this._boundMessage = (event) => this.#onMessage(event);
  }

  get iframe() {
    return this._iframe;
  }

  get instanceId() {
    return this._instanceId;
  }

  async mount(target = this._options.mountTo || this._options.container) {
    if (this._destroyed) throw new Error("Sketcher2DEmbed is already destroyed");
    if (this._iframe) {
      await this.waitUntilReady();
      return this._iframe;
    }
    const host = resolveHost(target);
    if (!host) throw new Error("Sketcher2DEmbed.mount requires a valid host element");
    this._host = host;
    window.addEventListener("message", this._boundMessage);

    const iframe = document.createElement("iframe");
    iframe.title = this._options.title || "BREP Sketcher 2D";
    iframe.className = this._options.iframeClassName || "";
    iframe.style.width = this._options.width || "100%";
    iframe.style.height = this._options.height || "520px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.background = String(this._theme.backgroundColor || "#f5f6f8");
    iframe.style.borderRadius = "10px";
    iframe.style.touchAction = "none";
    if (this._options.iframeStyle && typeof this._options.iframeStyle === "object") {
      Object.assign(iframe.style, this._options.iframeStyle);
    }
    const attrs = (this._options.iframeAttributes && typeof this._options.iframeAttributes === "object")
      ? this._options.iframeAttributes
      : null;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null) continue;
        iframe.setAttribute(key, String(value));
      }
    }
    iframe.srcdoc = this.#buildSrcDoc();
    host.appendChild(iframe);
    this._iframe = iframe;
    try {
      await this.waitUntilReady();
      return iframe;
    } catch (error) {
      try { window.removeEventListener("message", this._boundMessage); } catch { }
      try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch { }
      this._iframe = null;
      this._host = null;
      throw error;
    }
  }

  async waitUntilReady() {
    await withTimeout(
      this._initialized.promise,
      this._requestTimeoutMs,
      "Sketcher2DEmbed initialization timed out",
    );
  }

  async getSketch(options = {}) {
    if (options?.preferCached === true && this._latestSketch) return deepClone(this._latestSketch);
    const result = await this.#request("getSketch", {});
    const sketch = deepClone(result?.sketch || null);
    this._latestSketch = sketch;
    return sketch;
  }

  async setSketch(sketch) {
    const result = await this.#request("setSketch", { sketch: deepClone(sketch || null) });
    const next = deepClone(result?.sketch || null);
    this._latestSketch = next;
    return next;
  }

  async setCss(cssText) {
    await this.#request("setCss", { cssText: typeof cssText === "string" ? cssText : "" });
  }

  async setTheme(theme = {}) {
    this._theme = normalizeTheme({
      ...this._theme,
      ...theme,
    });
    if (this._iframe) {
      this._iframe.style.background = String(this._theme.backgroundColor || "#f5f6f8");
    }
    await this.#request("setTheme", { theme: deepClone(this._theme) });
  }

  async setSidebarExpanded(sidebarExpanded) {
    this._sidebarExpanded = sidebarExpanded !== false;
    await this.#request("setSidebarExpanded", { sidebarExpanded: this._sidebarExpanded });
  }

  async exportSVG(options = {}) {
    const sketch = await this.getSketch();
    return sketchToSVG(sketch, options);
  }

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    try {
      if (this._iframe?.contentWindow) {
        this._iframe.contentWindow.postMessage(
          {
            channel: this._channel,
            instanceId: this._instanceId,
            type: "dispose",
            requestId: null,
            payload: {},
          },
          this._targetOrigin,
        );
      }
    } catch { }
    for (const [requestId, pending] of this._pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Request aborted: ${requestId}`));
    }
    this._pending.clear();
    try {
      window.removeEventListener("message", this._boundMessage);
    } catch { }
    try {
      if (this._iframe?.parentNode) this._iframe.parentNode.removeChild(this._iframe);
    } catch { }
    this._iframe = null;
    this._host = null;
  }

  #buildSrcDoc() {
    const configJSON = JSON.stringify({
      channel: this._channel,
      instanceId: this._instanceId,
      frameModuleUrl: this._frameModuleUrl,
      backgroundColor: this._theme.backgroundColor || null,
    });
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }
      body { background: ${JSON.stringify(this._theme.backgroundColor || "#f5f6f8")}; }
    </style>
  </head>
  <body>
    <script type="module">
      const config = ${configJSON};
      try {
        const mod = await import(config.frameModuleUrl);
        const boot = mod?.bootSketcher2DFrame || mod?.boot || window.__BREP_bootSketcher2DFrame;
        if (typeof boot !== "function") {
          throw new Error("Sketcher2D frame bootstrap missing boot function");
        }
        boot({ channel: config.channel, instanceId: config.instanceId });
      } catch (error) {
        window.parent.postMessage(
          {
            channel: config.channel,
            instanceId: config.instanceId,
            type: "frameError",
            payload: { message: error?.message || String(error) },
          },
          "*",
        );
      }
    </script>
  </body>
</html>`;
  }

  async #request(type, payload) {
    await this.waitUntilReady();
    return this.#requestRaw(type, payload);
  }

  async #requestRaw(type, payload) {
    if (this._destroyed) throw new Error("Sketcher2DEmbed is destroyed");
    const win = this._iframe?.contentWindow;
    if (!win) throw new Error("Sketcher2DEmbed iframe is unavailable");
    const requestId = `${this._instanceId}:${++this._requestSeq}`;
    const request = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error(`Request timed out: ${type}`));
      }, this._requestTimeoutMs);
      this._pending.set(requestId, { resolve, reject, timer });
    });
    win.postMessage(
      {
        channel: this._channel,
        instanceId: this._instanceId,
        type,
        requestId,
        payload,
      },
      this._targetOrigin,
    );
    return request;
  }

  #initializeAfterReady() {
    if (this._initStarted) return;
    this._initStarted = true;
    this.#requestRaw("init", {
      sketch: this._initialSketch,
      cssText: this._initialCss,
      theme: deepClone(this._theme),
      sidebarExpanded: this._sidebarExpanded,
    })
      .then(() => this._initialized.resolve(true))
      .catch((error) => this._initialized.reject(error));
  }

  #onMessage(event) {
    if (this._destroyed) return;
    if (!this._iframe?.contentWindow || event.source !== this._iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.channel !== this._channel || msg.instanceId !== this._instanceId) return;

    if (msg.type === "ready") {
      this._ready.resolve(true);
      this.#initializeAfterReady();
      return;
    }

    if (msg.type === "frameError") {
      const message = msg?.payload?.message || "Sketcher2D frame boot failed";
      this._initialized.reject(new Error(message));
      return;
    }

    if (msg.type === "response") {
      const requestId = msg.requestId;
      if (!requestId || !this._pending.has(requestId)) return;
      const pending = this._pending.get(requestId);
      this._pending.delete(requestId);
      clearTimeout(pending.timer);
      if (msg.ok === false || msg.error) {
        pending.reject(new Error(msg?.error?.message || "Sketcher2D request failed"));
      } else {
        pending.resolve(deepClone(msg.payload || null));
      }
      return;
    }

    if (msg.type === "sketchChanged") {
      const sketch = deepClone(msg?.payload?.sketch || null);
      this._latestSketch = sketch;
      try { this._onChange && this._onChange(sketch, deepClone(msg.payload || {})); } catch { }
      return;
    }

    if (msg.type === "sketchFinished") {
      const sketch = deepClone(msg?.payload?.sketch || null);
      this._latestSketch = sketch;
      try { this._onFinished && this._onFinished(sketch, deepClone(msg.payload || {})); } catch { }
      return;
    }

    if (msg.type === "sketchCancelled") {
      try { this._onCancelled && this._onCancelled(deepClone(msg.payload || {})); } catch { }
    }
  }
}

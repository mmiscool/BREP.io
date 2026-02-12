import * as THREE from "three";
import { MainToolbar } from "../MainToolbar.js";
import { SketchMode3D } from "../sketcher/SketchMode3D.js";
import { deepClone } from "../../utils/deepClone.js";

const DEFAULT_FEATURE_ID = "__embed_sketch_feature__";
const DEFAULT_GRID_VISIBLE = false;
const DEFAULT_GRID_SPACING = 1;
const GRID_EXTENT_MULTIPLIER = 100;
const MIN_ORTHO_ZOOM = 0.0001;
const MAX_ORTHO_ZOOM = 300;
const DEFAULT_THEME = {
  geometryColor: null,
  pointColor: null,
  constraintColor: null,
  backgroundColor: null,
  pointSizePx: null,
  curveThicknessPx: null,
};

function normalizeTheme(theme = {}) {
  const pointSizePx = Number(theme?.pointSizePx ?? theme?.pointSize);
  const curveThicknessPx = Number(theme?.curveThicknessPx ?? theme?.curveThickness);
  return {
    geometryColor: theme?.geometryColor ?? null,
    pointColor: theme?.pointColor ?? null,
    constraintColor: theme?.constraintColor ?? null,
    backgroundColor: theme?.backgroundColor ?? null,
    pointSizePx: Number.isFinite(pointSizePx) && pointSizePx > 0 ? pointSizePx : null,
    curveThicknessPx: Number.isFinite(curveThicknessPx) && curveThicknessPx > 0 ? curveThicknessPx : null,
  };
}

function normalizeSidebarExpanded(value, fallback = false) {
  if (value == null) return fallback;
  return value !== false;
}

function normalizeGridVisible(value, fallback = DEFAULT_GRID_VISIBLE) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const next = value.trim().toLowerCase();
    if (next === "false" || next === "0" || next === "off" || next === "no") return false;
    if (next === "true" || next === "1" || next === "on" || next === "yes") return true;
  }
  return value !== false && value !== 0;
}

function normalizeGridSpacing(value, fallback = DEFAULT_GRID_SPACING) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return fallback;
  return Math.max(0.0001, Math.min(1000000, next));
}

function toCssColor(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const hex = Math.max(0, Math.min(0xffffff, value | 0)).toString(16).padStart(6, "0");
    return `#${hex}`;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

class Simple2DControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;
    this.target = new THREE.Vector3(0, 0, 0);
    this._panning = false;
    this._lastX = 0;
    this._lastY = 0;
    this._boundPointerDown = (event) => this.#onPointerDown(event);
    this._boundPointerMove = (event) => this.#onPointerMove(event);
    this._boundPointerUp = () => this.#onPointerUp();
    this._boundWheel = (event) => this.#onWheel(event);
    this._boundContextMenu = (event) => event.preventDefault();
    domElement.addEventListener("pointerdown", this._boundPointerDown, { passive: false });
    window.addEventListener("pointermove", this._boundPointerMove, { passive: false });
    window.addEventListener("pointerup", this._boundPointerUp, { passive: false });
    domElement.addEventListener("wheel", this._boundWheel, { passive: false });
    domElement.addEventListener("contextmenu", this._boundContextMenu, { passive: false });
  }

  update() { }

  updateMatrixState() { }

  dispose() {
    const el = this.domElement;
    if (!el) return;
    el.removeEventListener("pointerdown", this._boundPointerDown);
    window.removeEventListener("pointermove", this._boundPointerMove);
    window.removeEventListener("pointerup", this._boundPointerUp);
    el.removeEventListener("wheel", this._boundWheel);
    el.removeEventListener("contextmenu", this._boundContextMenu);
  }

  #worldPerPixel() {
    const el = this.domElement;
    const width = Math.max(1, el.clientWidth || el.width || 1);
    const height = Math.max(1, el.clientHeight || el.height || 1);
    if (!this.camera?.isOrthographicCamera) return { x: 0.05, y: 0.05 };
    const zoom = this.camera.zoom > 0 ? this.camera.zoom : 1;
    return {
      x: (this.camera.right - this.camera.left) / (width * zoom),
      y: (this.camera.top - this.camera.bottom) / (height * zoom),
    };
  }

  #onPointerDown(event) {
    if (!this.enabled) return;
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    this._panning = true;
    this._lastX = event.clientX;
    this._lastY = event.clientY;
  }

  #onPointerMove(event) {
    if (!this.enabled || !this._panning) return;
    event.preventDefault();
    const dx = event.clientX - this._lastX;
    const dy = event.clientY - this._lastY;
    this._lastX = event.clientX;
    this._lastY = event.clientY;
    const wpp = this.#worldPerPixel();
    const moveX = dx * wpp.x;
    const moveY = dy * wpp.y;
    this.camera.position.x -= moveX;
    this.camera.position.y += moveY;
    this.target.x -= moveX;
    this.target.y += moveY;
    this.camera.updateMatrixWorld(true);
    this.dispatchEvent({ type: "change" });
  }

  #onPointerUp() {
    if (!this._panning) return;
    this._panning = false;
    this.dispatchEvent({ type: "end" });
  }

  #onWheel(event) {
    if (!this.enabled || !this.camera?.isOrthographicCamera) return;
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0015);
    const nextZoom = this.camera.zoom / factor;
    this.camera.zoom = Math.max(MIN_ORTHO_ZOOM, Math.min(MAX_ORTHO_ZOOM, nextZoom));
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.dispatchEvent({ type: "change" });
  }
}

class EmbeddedSketchViewer {
  constructor({
    container,
    sidebar,
    theme = DEFAULT_THEME,
    gridVisible = DEFAULT_GRID_VISIBLE,
    gridSpacing = DEFAULT_GRID_SPACING,
    featureID = DEFAULT_FEATURE_ID,
    onSketchChange = null,
    onSketchFinished = null,
    onSketchCancelled = null,
  }) {
    this.container = container;
    this.sidebar = sidebar;
    this.theme = normalizeTheme(theme);
    this._dragThreshold = 5;
    this._featureID = featureID;
    this._onSketchChange = onSketchChange;
    this._onSketchFinished = onSketchFinished;
    this._onSketchCancelled = onSketchCancelled;
    this._gridVisible = normalizeGridVisible(gridVisible, DEFAULT_GRID_VISIBLE);
    this._gridSpacing = normalizeGridSpacing(gridSpacing, DEFAULT_GRID_SPACING);
    this._gridHelper = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 5000);
    this.camera.position.set(0, 0, 80);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(toCssColor(this.theme.backgroundColor, "#ffffff"), 1);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);
    this.controls = new Simple2DControls(this.camera, this.renderer.domElement);
    this._boundControlsChange = () => {
      try { this._sketchMode?.onCameraChanged?.(); } catch { }
    };
    this.controls.addEventListener("change", this._boundControlsChange);
    this.controls.addEventListener("end", this._boundControlsChange);
    this.#rebuildGrid();
    this.mainToolbar = new MainToolbar(this);
    this._feature = {
      inputParams: {
        featureID: this._featureID,
        sketchPlane: null,
      },
      persistentData: {
        sketch: null,
        externalRefs: [],
      },
    };
    this.partHistory = {
      scene: this.scene,
      features: [this._feature],
      runHistory: async () => null,
      queueHistorySnapshot: () => null,
      getObjectByName: (name) => this.scene.getObjectByName(name) || null,
    };
    this._raf = 0;
    this._running = false;
    this._sketchMode = null;
    this._disposed = false;
    this._resizeRaf = 0;
    this._boundResize = () => this.#onResize();
    this._boundResizeQueued = () => this.#queueResize();
    window.addEventListener("resize", this._boundResize);
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(this._boundResizeQueued);
      try { this._resizeObserver.observe(this.container); } catch { }
    } else {
      this._resizeObserver = null;
    }
    this.#onResize();
  }

  _getSidebarShouldShow() {
    return true;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  start(initialSketch = null) {
    if (initialSketch) this.#setFeatureSketch(initialSketch);
    this.#openSketchMode();
    this.#startRenderLoop();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try { this._sketchMode?.close?.(); } catch { }
    this._sketchMode = null;
  }

  dispose() {
    this._disposed = true;
    this.stop();
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = 0;
    window.removeEventListener("resize", this._boundResize);
    try { this._resizeObserver?.disconnect?.(); } catch { }
    this._resizeObserver = null;
    try { this.controls?.dispose?.(); } catch { }
    try { this.controls?.removeEventListener?.("change", this._boundControlsChange); } catch { }
    try { this.controls?.removeEventListener?.("end", this._boundControlsChange); } catch { }
    try { this.mainToolbar?._ro?.disconnect?.(); } catch { }
    try { this.mainToolbar?.root?.parentNode?.removeChild(this.mainToolbar.root); } catch { }
    this.#clearGrid();
    try { this.renderer?.dispose?.(); } catch { }
    try {
      if (this.renderer?.domElement?.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    } catch { }
  }

  getSketch() {
    const sketch = this._sketchMode?.getSketchData?.() || this._feature?.persistentData?.sketch || null;
    return deepClone(sketch);
  }

  setSketch(sketch) {
    const cloned = deepClone(sketch || null);
    this.#setFeatureSketch(cloned);
    if (this._sketchMode?.setSketchData) this._sketchMode.setSketchData(cloned);
    return this.getSketch();
  }

  setTheme(theme) {
    this.theme = normalizeTheme({
      ...this.theme,
      ...(theme || {}),
    });
    try {
      this.renderer.setClearColor(toCssColor(this.theme.backgroundColor, "#ffffff"), 1);
    } catch { }
    if (this._sketchMode) {
      this._sketchMode._theme = this.theme;
      const currentSketch = this._sketchMode.getSketchData?.() || null;
      this._sketchMode.setSketchData?.(currentSketch);
    }
  }

  setGridOptions(options = {}) {
    const nextVisible = options?.gridVisible ?? options?.visible;
    const nextSpacing = options?.gridSpacing ?? options?.spacing;
    this._gridVisible = normalizeGridVisible(nextVisible, this._gridVisible);
    this._gridSpacing = normalizeGridSpacing(nextSpacing, this._gridSpacing);
    this.#rebuildGrid();
  }

  onSketchFinished(_featureID, sketchObject) {
    this.#setFeatureSketch(sketchObject);
    try { this._onSketchFinished && this._onSketchFinished(deepClone(sketchObject || null)); } catch { }
    this.#reopenSketchModeSoon();
  }

  onSketchCancelled(_featureID) {
    try { this._onSketchCancelled && this._onSketchCancelled(); } catch { }
    this.#reopenSketchModeSoon();
  }

  #setFeatureSketch(sketch) {
    this._feature.persistentData = this._feature.persistentData || {};
    this._feature.persistentData.sketch = deepClone(sketch || null);
  }

  #openSketchMode() {
    if (this._disposed) return;
    try { this._sketchMode?.dispose?.(); } catch { }
    this._sketchMode = new SketchMode3D(this, this._featureID, {
      theme: this.theme,
      uniformPointColor: true,
      useFatCurveLines: true,
      onSketchChange: (sketch) => {
        this.#setFeatureSketch(sketch);
        try { this._onSketchChange && this._onSketchChange(deepClone(sketch)); } catch { }
      },
    });
    this._sketchMode.open();
  }

  #reopenSketchModeSoon() {
    if (this._disposed) return;
    setTimeout(() => {
      if (this._disposed) return;
      this.#openSketchMode();
    }, 0);
  }

  #updateCameraFrustum(width, height) {
    const w = Math.max(1, width || 1);
    const h = Math.max(1, height || 1);
    const aspect = w / h;
    const unitHeight = 40;
    const halfH = unitHeight * 0.5;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  #onResize() {
    if (this._disposed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.#updateCameraFrustum(width, height);
    this.render();
  }

  #queueResize() {
    if (this._disposed) return;
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      this.#onResize();
    });
  }

  #clearGrid() {
    if (!this._gridHelper) return;
    try { this.scene.remove(this._gridHelper); } catch { }
    try {
      const mats = Array.isArray(this._gridHelper.material)
        ? this._gridHelper.material
        : [this._gridHelper.material];
      for (const mat of mats) {
        try { mat?.dispose?.(); } catch { }
      }
      try { this._gridHelper.geometry?.dispose?.(); } catch { }
    } catch { }
    this._gridHelper = null;
  }

  #rebuildGrid() {
    this.#clearGrid();
    if (!this._gridVisible) return;
    const baseDivisions = 200;
    const divisions = baseDivisions * GRID_EXTENT_MULTIPLIER;
    const size = this._gridSpacing * divisions;
    const grid = new THREE.GridHelper(size, divisions, 0x5c6472, 0x3d4554);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.001;
    grid.renderOrder = 9000;
    grid.frustumCulled = false;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (let i = 0; i < mats.length; i += 1) {
      const mat = mats[i];
      if (!mat) continue;
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = i === 0 ? 0.38 : 0.2;
      mat.toneMapped = false;
    }
    this.scene.add(grid);
    this._gridHelper = grid;
  }

  #startRenderLoop() {
    if (this._running) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this.controls.update();
      this.render();
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }
}

class Sketcher2DFrameApp {
  constructor({ channel, instanceId }) {
    this._channel = channel;
    this._instanceId = instanceId;
    this._viewer = null;
    this._customCssEl = null;
    this._root = null;
    this._canvasHost = null;
    this._sidebarHost = null;
    this._disposed = false;
    this._theme = normalizeTheme(DEFAULT_THEME);
    this._sidebarExpanded = false;
    this._gridVisible = DEFAULT_GRID_VISIBLE;
    this._gridSpacing = DEFAULT_GRID_SPACING;
    this._boundMessage = (event) => this.#onMessage(event);
  }

  boot() {
    if (this._disposed) return;
    this.#ensureBaseStyles();
    this.#mountShell();
    window.addEventListener("message", this._boundMessage);
    this.#post("ready", { version: 1 });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    window.removeEventListener("message", this._boundMessage);
    try { this._viewer?.dispose?.(); } catch { }
    this._viewer = null;
    try {
      if (this._root?.parentNode) this._root.parentNode.removeChild(this._root);
    } catch { }
    this._root = null;
    this._canvasHost = null;
    this._sidebarHost = null;
  }

  #ensureBaseStyles() {
    if (document.getElementById("sk2d-base-styles")) return;
    const style = document.createElement("style");
    style.id = "sk2d-base-styles";
    style.textContent = `
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
      body { background: #f5f6f8; color: #111; font-family: "Segoe UI", Tahoma, sans-serif; }
      .sk2d-root { position: relative; width: 100%; height: 100%; overflow: hidden; margin: 0; padding: 0; }
      .sk2d-sidebar {
        position: absolute;
        left: 0;
        top: 56px;
        bottom: 0;
        width: 260px;
        background: rgba(20,24,30,.92);
        border-right: 1px solid #262b36;
        overflow: auto;
        z-index: 20;
      }
      .sk2d-canvas {
        position: absolute;
        left: 0;
        top: 0;
        right: 0;
        bottom: 0;
        background: #ffffff;
        margin: 0;
        padding: 0;
        touch-action: none;
        overscroll-behavior: none;
      }
      .sk2d-root.is-sidebar-collapsed .sk2d-sidebar { display: none; }
      /* In iframe sketch mode, keep room for top-right Finish/Cancel controls so
         icon buttons wrap instead of rendering underneath those actions. */
      .sk2d-root #main-toolbar {
        padding-right: calc(6px + max(var(--mtb-reserved-right, 0px), 180px));
      }
    `;
    document.head.appendChild(style);
  }

  #mountShell() {
    const root = document.createElement("div");
    root.className = "sk2d-root";
    const sidebar = document.createElement("div");
    sidebar.className = "sk2d-sidebar";
    const canvas = document.createElement("div");
    canvas.className = "sk2d-canvas";
    root.appendChild(sidebar);
    root.appendChild(canvas);
    document.body.innerHTML = "";
    document.body.appendChild(root);
    this._root = root;
    this._sidebarHost = sidebar;
    this._canvasHost = canvas;
  }

  #post(type, payload = {}) {
    window.parent.postMessage({
      channel: this._channel,
      instanceId: this._instanceId,
      type,
      payload,
    }, "*");
  }

  #respond(requestId, ok, payload = null, error = null) {
    window.parent.postMessage({
      channel: this._channel,
      instanceId: this._instanceId,
      type: "response",
      requestId,
      ok,
      payload,
      error: error ? { message: error?.message || String(error) } : null,
    }, "*");
  }

  async #onMessage(event) {
    if (this._disposed) return;
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.channel !== this._channel || msg.instanceId !== this._instanceId) return;
    const requestId = msg.requestId;
    const type = msg.type;
    if (!type) return;
    // Allow fire-and-forget dispose from host teardown.
    if (type === "dispose" && !requestId) {
      this.dispose();
      return;
    }
    if (!requestId) return;
    try {
      const payload = await this.#handleRequest(type, msg.payload || {});
      this.#respond(requestId, true, payload);
    } catch (error) {
      this.#respond(requestId, false, null, error);
    }
  }

  async #handleRequest(type, payload) {
    if (type === "init") {
      this.#applyTheme(payload?.theme || null);
      this.#setSidebarExpanded(payload?.sidebarExpanded);
      this.#applyGridOptions(payload);
      this.#ensureViewer(payload?.sketch || null);
      this.#setCustomCss(payload?.cssText || "");
      return { sketch: this._viewer.getSketch() };
    }
    if (!this._viewer) throw new Error("Sketcher2D frame is not initialized");
    if (type === "getSketch") {
      return { sketch: this._viewer.getSketch() };
    }
    if (type === "setSketch") {
      return { sketch: this._viewer.setSketch(payload?.sketch || null) };
    }
    if (type === "setCss") {
      this.#setCustomCss(payload?.cssText || "");
      return { ok: true };
    }
    if (type === "setTheme") {
      this.#applyTheme(payload?.theme || null);
      return { ok: true };
    }
    if (type === "setSidebarExpanded") {
      this.#setSidebarExpanded(payload?.sidebarExpanded);
      return { ok: true };
    }
    if (type === "setGrid") {
      this.#applyGridOptions(payload || {});
      return { ok: true };
    }
    if (type === "setGridVisible") {
      this.#applyGridOptions({ gridVisible: payload?.gridVisible });
      return { ok: true };
    }
    if (type === "setGridSpacing") {
      this.#applyGridOptions({ gridSpacing: payload?.gridSpacing });
      return { ok: true };
    }
    if (type === "dispose") {
      this.dispose();
      return { ok: true };
    }
    throw new Error(`Unknown request type: ${type}`);
  }

  #ensureViewer(initialSketch) {
    if (this._viewer) return;
    this._viewer = new EmbeddedSketchViewer({
      container: this._canvasHost,
      sidebar: this._sidebarHost,
      theme: this._theme,
      gridVisible: this._gridVisible,
      gridSpacing: this._gridSpacing,
      featureID: DEFAULT_FEATURE_ID,
      onSketchChange: (sketch) => this.#post("sketchChanged", { sketch }),
      onSketchFinished: (sketch) => this.#post("sketchFinished", { sketch }),
      onSketchCancelled: () => this.#post("sketchCancelled", {}),
    });
    this._viewer.start(initialSketch);
  }

  #setCustomCss(cssText) {
    if (!this._customCssEl) {
      this._customCssEl = document.createElement("style");
      this._customCssEl.id = "sk2d-custom-css";
      document.head.appendChild(this._customCssEl);
    }
    this._customCssEl.textContent = String(cssText || "");
  }

  #applyTheme(theme) {
    this._theme = normalizeTheme({
      ...this._theme,
      ...(theme || {}),
    });
    const bg = toCssColor(this._theme.backgroundColor, "#ffffff");
    try {
      document.body.style.background = bg;
      if (this._canvasHost) this._canvasHost.style.background = bg;
      this._viewer?.setTheme?.(this._theme);
    } catch { }
  }

  #setSidebarExpanded(sidebarExpanded) {
    this._sidebarExpanded = normalizeSidebarExpanded(sidebarExpanded, false);
    if (!this._root) return;
    this._root.classList.toggle("is-sidebar-collapsed", !this._sidebarExpanded);
  }

  #applyGridOptions(payload = {}) {
    this._gridVisible = normalizeGridVisible(
      payload?.gridVisible ?? payload?.showGrid ?? payload?.visible,
      this._gridVisible,
    );
    this._gridSpacing = normalizeGridSpacing(
      payload?.gridSpacing ?? payload?.spacing,
      this._gridSpacing,
    );
    this._viewer?.setGridOptions?.({
      gridVisible: this._gridVisible,
      gridSpacing: this._gridSpacing,
    });
  }
}

export function bootSketcher2DFrame(config = {}) {
  try {
    if (window.__BREP_Sketcher2DFrameApp && typeof window.__BREP_Sketcher2DFrameApp.dispose === "function") {
      window.__BREP_Sketcher2DFrameApp.dispose();
    }
  } catch { }
  const app = new Sketcher2DFrameApp({
    channel: config.channel || "brep:sketcher2d",
    instanceId: config.instanceId || DEFAULT_FEATURE_ID,
  });
  window.__BREP_Sketcher2DFrameApp = app;
  app.boot();
  return app;
}

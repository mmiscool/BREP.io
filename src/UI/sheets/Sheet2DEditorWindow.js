import { FloatingWindow } from "../FloatingWindow.js";
import { captureCameraSnapshot } from "../pmi/annUtils.js";
import { listSheetSizes } from "../../sheets/sheetStandards.js";

const DEFAULT_SHEET_SIZE_KEY = "A";
const DEFAULT_SHEET_ORIENTATION = "landscape";
const DEFAULT_ZOOM = 1;
const MIN_ELEMENT_IN = 0.05;
const MIN_MEDIA_SCALE = 1;
const MAX_MEDIA_SCALE = 10;
const PMI_TITLE_HEIGHT_IN = 0.3;

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeHex(value, fallback = "#000000") {
  if (!value) return fallback;
  const text = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split("").map((ch) => `${ch}${ch}`).join("")}`;
  }
  return fallback;
}

function toCssColor(value, fallback = "#000000") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(text)) return text;
  if (/^[a-zA-Z]+$/.test(text)) return text;
  return fallback;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultTextElement(xIn, yIn) {
  return {
    id: uid("el"),
    type: "text",
    x: xIn,
    y: yIn,
    w: 3.6,
    h: 1.0,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "transparent",
    stroke: "#000000",
    strokeWidth: 0.01,
    text: "Double-click to edit",
    fontSize: 0.34,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "400",
    fontStyle: "normal",
    textAlign: "left",
    color: "#111111",
  };
}

function defaultRectElement(xIn, yIn) {
  return {
    id: uid("el"),
    type: "rect",
    x: xIn,
    y: yIn,
    w: 2.2,
    h: 1.4,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "#8bc4ff",
    stroke: "#1d4ed8",
    strokeWidth: 0.01,
    cornerRadius: 0.08,
    text: "",
    fontSize: 0.28,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "600",
    fontStyle: "normal",
    textAlign: "center",
    color: "#0f172a",
  };
}

function defaultEllipseElement(xIn, yIn) {
  return {
    id: uid("el"),
    type: "ellipse",
    x: xIn,
    y: yIn,
    w: 2.0,
    h: 1.25,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "#ffd166",
    stroke: "#c78c00",
    strokeWidth: 0.01,
    text: "",
    fontSize: 0.28,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "600",
    fontStyle: "normal",
    textAlign: "center",
    color: "#0f172a",
  };
}

function defaultImageElement(xIn, yIn, src = "") {
  return {
    id: uid("el"),
    type: "image",
    x: xIn,
    y: yIn,
    w: 3.2,
    h: 2.0,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "#ffffff",
    stroke: "#94a3b8",
    strokeWidth: 0.01,
    src: String(src || ""),
    mediaScale: 1,
    mediaOffsetX: 0,
    mediaOffsetY: 0,
  };
}

function defaultPmiInsetElement(xIn, yIn, pmiViewIndex = -1, pmiViewName = "PMI View") {
  return {
    id: uid("el"),
    type: "pmiInset",
    x: xIn,
    y: yIn,
    w: 3.2,
    h: 2.1,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "transparent",
    stroke: "#334155",
    strokeWidth: 0.01,
    pmiViewIndex: Number.isInteger(pmiViewIndex) ? pmiViewIndex : -1,
    pmiViewName: String(pmiViewName || "PMI View"),
    showTitle: true,
    mediaScale: 1,
    mediaOffsetX: 0,
    mediaOffsetY: 0,
    pmiImageRevision: 0,
    pmiModelRevision: -1,
    pmiImageCaptureKey: "",
  };
}

function createOneSheetTemplate(name = "Instruction Sheet 1") {
  return {
    name,
    sizeKey: DEFAULT_SHEET_SIZE_KEY,
    orientation: DEFAULT_SHEET_ORIENTATION,
    background: "#ffffff",
    elements: [],
  };
}

function isTransparentColor(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return true;
  if (text === "transparent") return true;
  if (/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(text)) return true;
  if (/^hsla\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(text)) return true;
  return false;
}

function elementSupportsText(element) {
  const type = String(element?.type || "");
  return type === "text" || type === "rect" || type === "ellipse";
}

function elementSupportsMediaCrop(element) {
  const type = String(element?.type || "");
  return type === "image" || type === "pmiInset";
}

function isPointerFromInput(event) {
  const node = event?.target;
  const tag = String(node?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
  if (node?.closest?.(".sheet-slides-inspector")) return true;
  if (node?.isContentEditable) return true;
  return false;
}

function sortElements(elements) {
  return [...(Array.isArray(elements) ? elements : [])].sort((a, b) => {
    const za = toFiniteNumber(a?.z, 0);
    const zb = toFiniteNumber(b?.z, 0);
    if (za !== zb) return za - zb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

export class Sheet2DEditorWindow {
  constructor(viewer) {
    this.viewer = viewer || null;

    this.window = null;
    this.root = null;

    this.sheetId = null;
    this.sheetDraft = null;
    this.selectedElementId = null;
    this._cropModeElementId = null;

    this.zoom = DEFAULT_ZOOM;
    this._appliedZoom = DEFAULT_ZOOM;
    this._zoomMode = "fit";
    this.showGrid = false;

    this._dragState = null;
    this._isCommitting = false;
    this._removeSheetListener = null;
    this._removePmiListener = null;
    this._removeModelChangeListener = null;
    this._pmiViews = [];
    this._openSheetMenuId = null;
    this._dragSheetId = null;
    this._pmiPickerOpen = false;
    this._isRefreshingAllPmiInsets = false;
    this._queuePmiInsetRefresh = false;
    this._lastObservedModelRevision = null;

    this._fileImageInsertPending = false;
    this._pmiImageCache = new Map();
    this._pendingPmiImageCaptures = new Map();
    this._pendingPmiPreviewCaptures = new Map();
    this._pmiViewRevision = 0;
    this._pmiImageCaptureQueue = Promise.resolve();
    this._mediaMetadataCache = new Map();
    this._stageResizeObserver = null;

    this._contextMenu = null;
    this._boundPointerMove = (event) => this._onGlobalPointerMove(event);
    this._boundPointerUp = (event) => this._onGlobalPointerUp(event);
    this._boundGlobalPointerDown = (event) => this._onGlobalPointerDown(event);
    this._boundKeyDown = (event) => this._onKeyDown(event);
  }

  open(sheetId = null) {
    this._ensureWindow();
    if (!this.root) return;

    if (this.window?.root) this.window.root.style.display = "";
    this.root.style.display = "grid";
    this.window?.bringToFront?.();

    this._bindGlobalEvents();
    this._bindManagerListeners();

    const manager = this._getManager();
    if (!manager) return;

    let targetId = String(sheetId || "").trim();
    if (targetId && !manager.getSheetById?.(targetId)) {
      targetId = "";
    }

    if (!targetId) {
      const first = manager.getSheets?.()?.[0] || null;
      targetId = String(first?.id || "");
    }

    if (!targetId) {
      const created = manager.createSheet?.(createOneSheetTemplate()) || null;
      targetId = String(created?.id || "");
    }

    this.sheetId = targetId || null;
    this.refreshFromHistory();
  }

  close() {
    if (!this.root) return;
    this._endDrag(false);
    this._cropModeElementId = null;
    this._closePmiPicker();
    this._hideContextMenu();
    this.root.style.display = "none";
    if (this.window?.root) this.window.root.style.display = "none";
    this._unbindGlobalEvents();
    this._unbindManagerListeners();
    this._disposeUnusedPmiViewports(new Set());
  }

  dispose() {
    this._endDrag(false);
    this._cropModeElementId = null;
    this._closePmiPicker();
    this._hideContextMenu();
    this._unbindGlobalEvents();
    this._unbindManagerListeners();
    this._disposeAllPmiViewports();
    try { this._stageResizeObserver?.disconnect?.(); } catch { }
    this._stageResizeObserver = null;
    try { this.window?.destroy?.(); } catch { }
    this.window = null;
    this.root = null;
  }

  refreshFromHistory() {
    if (!this.root || this.root.style.display === "none") return;

    this._refreshPmiViews();
    this._hideContextMenu();
    this._openSheetMenuId = null;
    this._dragSheetId = null;

    const manager = this._getManager();
    if (!manager) return;

    const sheets = manager.getSheets?.() || [];
    if (!sheets.length) {
      this.sheetDraft = null;
      this.sheetId = null;
      this.selectedElementId = null;
      this._renderAll();
      return;
    }

    if (!this.sheetId || !manager.getSheetById?.(this.sheetId)) {
      this.sheetId = String(sheets[0]?.id || "") || null;
    }

    const current = this.sheetId ? manager.getSheetById?.(this.sheetId) : null;
    if (!current) {
      this.sheetDraft = null;
      this.selectedElementId = null;
      this._renderAll();
      return;
    }

    this.sheetDraft = deepClone(current);

    const selected = this._getSelectedElement();
    if (!selected) {
      this.selectedElementId = null;
      this._cropModeElementId = null;
    } else if (String(this._cropModeElementId || "") !== String(selected.id || "")) {
      this._cropModeElementId = null;
    }

    this._renderAll();

    if (this._sheetHasStaleModelPmiInsets()) {
      void this._refreshAllPmiInsetImages();
    }
  }

  _getManager() {
    return this.viewer?.partHistory?.sheet2DManager || null;
  }

  _bindManagerListeners() {
    if (!this._removeSheetListener) {
      const manager = this._getManager();
      if (manager?.addListener) {
        this._removeSheetListener = manager.addListener(() => {
          if (this._isCommitting) return;
          this.refreshFromHistory();
        });
      }
    }

    if (!this._removePmiListener) {
      const pmiManager = this.viewer?.partHistory?.pmiViewsManager;
      if (pmiManager?.addListener) {
        this._removePmiListener = pmiManager.addListener(() => {
          this._refreshPmiViews({ bumpRevision: true });
          if (this._pmiPickerOpen) this._renderPmiPicker();
          void this._refreshAllPmiInsetImages();
        });
      }
    }

    if (!this._removeModelChangeListener) {
      const partHistory = this.viewer?.partHistory || null;
      if (partHistory?.addModelChangeListener) {
        this._removeModelChangeListener = partHistory.addModelChangeListener((revision) => {
          this._handleModelRevisionChange(revision);
        });
      }
    }
  }

  _unbindManagerListeners() {
    if (typeof this._removeSheetListener === "function") {
      try { this._removeSheetListener(); } catch { }
    }
    this._removeSheetListener = null;

    if (typeof this._removePmiListener === "function") {
      try { this._removePmiListener(); } catch { }
    }
    this._removePmiListener = null;

    if (typeof this._removeModelChangeListener === "function") {
      try { this._removeModelChangeListener(); } catch { }
    }
    this._removeModelChangeListener = null;
  }

  _bindGlobalEvents() {
    window.addEventListener("pointerdown", this._boundGlobalPointerDown, true);
    window.addEventListener("pointermove", this._boundPointerMove, true);
    window.addEventListener("pointerup", this._boundPointerUp, true);
    window.addEventListener("keydown", this._boundKeyDown, true);
  }

  _unbindGlobalEvents() {
    window.removeEventListener("pointerdown", this._boundGlobalPointerDown, true);
    window.removeEventListener("pointermove", this._boundPointerMove, true);
    window.removeEventListener("pointerup", this._boundPointerUp, true);
    window.removeEventListener("keydown", this._boundKeyDown, true);
  }

  _refreshPmiViews({ bumpRevision = false } = {}) {
    try {
      const manager = this.viewer?.partHistory?.pmiViewsManager;
      const list = manager?.getViews?.();
      this._pmiViews = Array.isArray(list) ? list : [];
      if (bumpRevision) {
        this._pmiViewRevision += 1;
        this._pmiImageCache.clear();
        this._pendingPmiPreviewCaptures.clear();
      }
    } catch {
      this._pmiViews = [];
      if (bumpRevision) {
        this._pmiViewRevision += 1;
        this._pmiImageCache.clear();
        this._pendingPmiPreviewCaptures.clear();
      }
    }
  }

  _getCurrentModelRevision() {
    const partHistory = this.viewer?.partHistory || null;
    const revision = partHistory?.getModelRevision?.();
    return Math.max(0, Math.round(toFiniteNumber(revision, 0)));
  }

  _sheetHasStaleModelPmiInsets() {
    const manager = this._getManager();
    const sheets = manager?.getSheets?.() || [];
    const currentModelRevision = this._getCurrentModelRevision();
    this._lastObservedModelRevision = currentModelRevision;
    for (const sheet of sheets) {
      for (const element of Array.isArray(sheet?.elements) ? sheet.elements : []) {
        if (String(element?.type || "") !== "pmiInset") continue;
        if (toFiniteNumber(element?.pmiModelRevision, -1) !== currentModelRevision) {
          return true;
        }
      }
    }
    return false;
  }

  _handleModelRevisionChange(revision = this._getCurrentModelRevision()) {
    const nextRevision = Math.max(0, Math.round(toFiniteNumber(revision, this._getCurrentModelRevision())));
    const previousRevision = this._lastObservedModelRevision;
    this._lastObservedModelRevision = nextRevision;
    this._pmiImageCache.clear();
    this._pendingPmiPreviewCaptures.clear();
    if (this._pmiPickerOpen) this._renderPmiPicker();
    if (previousRevision === nextRevision && !this._sheetHasStaleModelPmiInsets()) return;
    void this._refreshAllPmiInsetImages();
  }

  _getStageZoom() {
    return clamp(toFiniteNumber(this._appliedZoom, this.zoom), 0.1, 4);
  }

  _computeFitZoom(sheet = this.sheetDraft) {
    const stageWrap = this._stageWrap;
    if (!sheet || !stageWrap) return clamp(toFiniteNumber(this.zoom, DEFAULT_ZOOM), 0.1, 4);

    const ppi = Math.max(1, toFiniteNumber(sheet.pxPerInch, 96));
    const widthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * ppi);
    const heightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * ppi);
    const computed = typeof window !== "undefined" && window.getComputedStyle
      ? window.getComputedStyle(stageWrap)
      : null;
    const padX = toFiniteNumber(computed?.paddingLeft, 0) + toFiniteNumber(computed?.paddingRight, 0);
    const padY = toFiniteNumber(computed?.paddingTop, 0) + toFiniteNumber(computed?.paddingBottom, 0);
    const fitViewportPadding = 24;
    const safetyInset = 2;
    const availableWidth = Math.max(
      1,
      toFiniteNumber(stageWrap.clientWidth, 0) - padX - (fitViewportPadding * 2) - safetyInset,
    );
    const availableHeight = Math.max(
      1,
      toFiniteNumber(stageWrap.clientHeight, 0) - padY - (fitViewportPadding * 2) - safetyInset,
    );
    return clamp(Math.min(availableWidth / widthPx, availableHeight / heightPx), 0.1, 4);
  }

  _syncZoomControl() {
    if (this._fitZoomOption) {
      this._fitZoomOption.textContent = this._zoomMode === "fit"
        ? `Fit (${Math.round(this._getStageZoom() * 100)}%)`
        : "Fit";
    }
    if (!this._zoomSelect) return;
    this._zoomSelect.value = this._zoomMode === "fit" ? "fit" : String(this.zoom);
  }

  _ensureWindow() {
    if (this.root) return;
    this._ensureStyles();

    const fw = new FloatingWindow({
      title: "2D Sheets Editor",
      width: 1420,
      height: 900,
      minWidth: 980,
      minHeight: 640,
      right: 12,
      top: 52,
      shaded: false,
      onClose: () => this.close(),
    });

    const root = document.createElement("div");
    root.className = "sheet-slides-root";
    root.style.display = "none";

    const topbar = document.createElement("div");
    topbar.className = "sheet-slides-topbar";

    const brand = document.createElement("div");
    brand.className = "sheet-slides-brand";
    brand.textContent = "Sheets Studio";
    topbar.appendChild(brand);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "sheet-slides-hidden";
    fileInput.addEventListener("change", () => this._onImageFileChosen(fileInput));
    this._fileInput = fileInput;
    topbar.appendChild(fileInput);

    const addTextBtn = this._makeToolbarButton("Text", () => this._addElement("text"));
    const addRectBtn = this._makeToolbarButton("Rect", () => this._addElement("rect"));
    const addEllipseBtn = this._makeToolbarButton("Ellipse", () => this._addElement("ellipse"));
    const addImageBtn = this._makeToolbarButton("Image", () => this._addImageElement());

    const insertPmiBtn = this._makeToolbarButton("Insert PMI", () => this._openPmiPicker(), "primary");

    const frontBtn = this._makeToolbarButton("Front", () => this._bringSelectedToFront());
    const backBtn = this._makeToolbarButton("Back", () => this._sendSelectedToBack());
    const duplicateElementBtn = this._makeToolbarButton("Duplicate", () => this._duplicateSelectedElement());
    const deleteElementBtn = this._makeToolbarButton("Delete", () => this._deleteSelectedElement(), "danger");

    const zoomSelect = document.createElement("select");
    zoomSelect.className = "sheet-slides-control";
    [["fit", "Fit"], ["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"]]
      .forEach(([value, label]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === "fit") this._fitZoomOption = opt;
        zoomSelect.appendChild(opt);
      });
    zoomSelect.value = "fit";
    zoomSelect.addEventListener("change", () => {
      if (zoomSelect.value === "fit") {
        this._zoomMode = "fit";
      } else {
        this._zoomMode = "manual";
        this.zoom = clamp(toFiniteNumber(zoomSelect.value, 1), 0.1, 4);
      }
      this._renderStageOnly();
      const appliedZoom = Math.round(this._getStageZoom() * 100);
      this._setStatus(this._zoomMode === "fit" ? `Zoom fit (${appliedZoom}%)` : `Zoom ${appliedZoom}%`);
    });
    this._zoomSelect = zoomSelect;

    const gridBtn = this._makeToolbarButton("Grid", () => {
      this.showGrid = !this.showGrid;
      this._renderStageOnly();
    });

    topbar.appendChild(this._toolbarGroup([addTextBtn, addRectBtn, addEllipseBtn, addImageBtn, insertPmiBtn]));
    topbar.appendChild(this._toolbarGroup([frontBtn, backBtn, duplicateElementBtn, deleteElementBtn]));
    topbar.appendChild(this._toolbarGroup([zoomSelect, gridBtn], true));

    const sidebar = document.createElement("aside");
    sidebar.className = "sheet-slides-sidebar";

    const sidebarHeader = document.createElement("div");
    sidebarHeader.className = "sheet-slides-sidebar-header";
    const sidebarTitle = document.createElement("strong");
    sidebarTitle.textContent = "Sheets";
    const sheetCount = document.createElement("span");
    sheetCount.className = "sheet-slides-muted";
    this._sheetCountLabel = sheetCount;
    sidebarHeader.appendChild(sidebarTitle);
    sidebarHeader.appendChild(sheetCount);

    const sheetsList = document.createElement("div");
    sheetsList.className = "sheet-slides-list";
    this._sheetsList = sheetsList;

    sidebar.appendChild(sidebarHeader);
    sidebar.appendChild(sheetsList);

    const stageWrap = document.createElement("main");
    stageWrap.className = "sheet-slides-stage-wrap";
    this._stageWrap = stageWrap;

    const stageCenter = document.createElement("div");
    stageCenter.className = "sheet-slides-stage-center";

    const stageShell = document.createElement("div");
    stageShell.className = "sheet-slides-stage-shell";
    this._stageShell = stageShell;

    const slideCanvas = document.createElement("div");
    slideCanvas.className = "sheet-slides-canvas";
    slideCanvas.addEventListener("pointerdown", (event) => this._onCanvasPointerDown(event));
    slideCanvas.addEventListener("contextmenu", (event) => this._onCanvasContextMenu(event));
    this._slideCanvas = slideCanvas;

    stageShell.appendChild(slideCanvas);
    stageCenter.appendChild(stageShell);
    stageWrap.appendChild(stageCenter);

    if (!this._stageResizeObserver && typeof ResizeObserver !== "undefined") {
      this._stageResizeObserver = new ResizeObserver(() => {
        if (!this.root || this.root.style.display === "none") return;
        if (this._zoomMode !== "fit") return;
        this._renderStageOnly();
      });
      this._stageResizeObserver.observe(stageWrap);
    }

    const inspector = document.createElement("aside");
    inspector.className = "sheet-slides-inspector";

    const inspectorHeader = document.createElement("div");
    inspectorHeader.className = "sheet-slides-inspector-header";
    const inspectorTitle = document.createElement("strong");
    inspectorTitle.textContent = "Inspector";
    const selectionLabel = document.createElement("span");
    selectionLabel.className = "sheet-slides-muted";
    selectionLabel.textContent = "No selection";
    this._selectionLabel = selectionLabel;
    inspectorHeader.appendChild(inspectorTitle);
    inspectorHeader.appendChild(selectionLabel);

    const slidePanel = document.createElement("div");
    slidePanel.className = "sheet-slides-panel";
    slidePanel.innerHTML = "<h3>Sheet</h3>";
    this._slidePanel = slidePanel;

    const sheetNameInput = document.createElement("input");
    sheetNameInput.type = "text";
    sheetNameInput.className = "sheet-slides-control";
    sheetNameInput.addEventListener("change", () => {
      if (!this.sheetDraft) return;
      this.sheetDraft.name = String(sheetNameInput.value || "").trim() || "Sheet";
      this._commitSheetDraft("sheet-name");
      this._renderSidebarOnly();
    });
    this._sheetNameInput = sheetNameInput;
    slidePanel.appendChild(this._makeField("Title", sheetNameInput));

    const sheetSizeInput = document.createElement("select");
    sheetSizeInput.className = "sheet-slides-control";
    for (const size of listSheetSizes()) {
      const option = document.createElement("option");
      option.value = String(size?.key || DEFAULT_SHEET_SIZE_KEY);
      option.textContent = String(size?.label || size?.key || DEFAULT_SHEET_SIZE_KEY);
      sheetSizeInput.appendChild(option);
    }
    sheetSizeInput.addEventListener("change", () => this._setSheetFormatField("sizeKey", sheetSizeInput.value));
    this._sheetSizeInput = sheetSizeInput;
    slidePanel.appendChild(this._makeField("Size", sheetSizeInput));

    const sheetOrientationInput = document.createElement("select");
    sheetOrientationInput.className = "sheet-slides-control";
    [["landscape", "Landscape"], ["portrait", "Portrait"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      sheetOrientationInput.appendChild(option);
    });
    sheetOrientationInput.addEventListener("change", () => this._setSheetFormatField("orientation", sheetOrientationInput.value));
    this._sheetOrientationInput = sheetOrientationInput;
    slidePanel.appendChild(this._makeField("Orientation", sheetOrientationInput));

    const {
      wrap: sheetBgControl,
      input: sheetBgInput,
      reset: sheetBgResetBtn,
    } = this._buildColorControl(
      (value) => this._setSheetBackground(value),
      () => this._resetSheetBackground(),
    );
    this._sheetBgInput = sheetBgInput;
    this._sheetBgResetBtn = sheetBgResetBtn;
    slidePanel.appendChild(this._makeField("Background", sheetBgControl));

    const elementPanel = document.createElement("div");
    elementPanel.className = "sheet-slides-panel";
    elementPanel.innerHTML = "<h3>Element</h3>";
    this._elementPanel = elementPanel;

    const xInput = this._buildNumberInput((value) => this._setSelectedTransformField("x", value));
    const yInput = this._buildNumberInput((value) => this._setSelectedTransformField("y", value));
    const wInput = this._buildNumberInput((value) => this._setSelectedTransformField("w", value));
    const hInput = this._buildNumberInput((value) => this._setSelectedTransformField("h", value));
    const rotInput = this._buildNumberInput((value) => this._setSelectedTransformField("rotationDeg", value), { step: 0.1 });
    const {
      wrap: fillControl,
      input: fillInput,
      reset: fillResetBtn,
    } = this._buildColorControl(
      (value) => this._setSelectedStyleField("fill", value),
      () => this._resetSelectedFill(),
    );

    const opacityInput = this._buildNumberInput((value) => this._setSelectedStyleField("opacity", value), {
      step: 0.05,
      min: 0,
      max: 1,
    });
    const zInput = this._buildNumberInput((value) => this._setSelectedStyleField("z", value), { step: 1 });

    this._xInput = xInput;
    this._yInput = yInput;
    this._wInput = wInput;
    this._hInput = hInput;
    this._rotInput = rotInput;
    this._fillInput = fillInput;
    this._fillResetBtn = fillResetBtn;
    this._opacityInput = opacityInput;
    this._zInput = zInput;

    elementPanel.appendChild(this._makeField("X", xInput));
    elementPanel.appendChild(this._makeField("Y", yInput));
    elementPanel.appendChild(this._makeField("W", wInput));
    elementPanel.appendChild(this._makeField("H", hInput));
    elementPanel.appendChild(this._makeField("Rotation", rotInput));
    const fillField = this._makeField("Fill", fillControl);
    this._fillField = fillField;
    elementPanel.appendChild(fillField);
    elementPanel.appendChild(this._makeField("Opacity", opacityInput));
    elementPanel.appendChild(this._makeField("Layer", zInput));

    const textPanel = document.createElement("div");
    textPanel.className = "sheet-slides-panel";
    textPanel.innerHTML = "<h3>Text</h3>";

    const textInput = document.createElement("textarea");
    textInput.className = "sheet-slides-control";
    textInput.rows = 3;
    textInput.addEventListener("change", () => this._setSelectedTextField("text", textInput.value));

    const fontFamilyInput = document.createElement("select");
    fontFamilyInput.className = "sheet-slides-control";
    [
      ["Arial, Helvetica, sans-serif", "Sans"],
      ["Georgia, serif", "Serif"],
      ["'Courier New', monospace", "Mono"],
      ["Impact, Haettenschweiler, sans-serif", "Display"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      fontFamilyInput.appendChild(option);
    });
    fontFamilyInput.addEventListener("change", () => this._setSelectedTextField("fontFamily", fontFamilyInput.value));

    const fontSizeInput = this._buildNumberInput((value) => this._setSelectedTextField("fontSize", value), {
      step: 1,
      min: 6,
      max: 400,
    });

    const {
      wrap: textColorControl,
      input: textColorInput,
      reset: textColorResetBtn,
    } = this._buildColorControl(
      (value) => this._setSelectedTextField("color", value),
      () => this._resetSelectedTextColor(),
    );

    const textAlignInput = document.createElement("select");
    textAlignInput.className = "sheet-slides-control";
    [["left", "Left"], ["center", "Center"], ["right", "Right"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      textAlignInput.appendChild(option);
    });
    textAlignInput.addEventListener("change", () => this._setSelectedTextField("textAlign", textAlignInput.value));

    const boldBtn = this._makeToolbarButton("Bold", () => this._toggleTextWeight(), "small");
    const italicBtn = this._makeToolbarButton("Italic", () => this._toggleTextItalic(), "small");

    this._textInput = textInput;
    this._fontFamilyInput = fontFamilyInput;
    this._fontSizeInput = fontSizeInput;
    this._textColorInput = textColorInput;
    this._textColorResetBtn = textColorResetBtn;
    this._textAlignInput = textAlignInput;
    this._boldBtn = boldBtn;
    this._italicBtn = italicBtn;
    this._textPanel = textPanel;

    textPanel.appendChild(this._makeField("Content", textInput));
    textPanel.appendChild(this._makeField("Font", fontFamilyInput));
    textPanel.appendChild(this._makeField("Size", fontSizeInput));
    textPanel.appendChild(this._makeField("Color", textColorControl));
    textPanel.appendChild(this._makeField("Align", textAlignInput));
    textPanel.appendChild(this._toolbarGroup([boldBtn, italicBtn], true));

    const cropPanel = document.createElement("div");
    cropPanel.className = "sheet-slides-panel";
    cropPanel.innerHTML = "<h3>Crop</h3>";

    const cropToggleBtn = this._makeToolbarButton("Crop", () => this._toggleCropModeForSelection(), "small");
    const resetCropBtn = this._makeToolbarButton("Reset Crop", () => this._resetSelectedCrop(), "small");
    const cropHint = document.createElement("div");
    cropHint.className = "sheet-slides-muted sheet-slides-crop-hint";

    this._cropPanel = cropPanel;
    this._cropToggleBtn = cropToggleBtn;
    this._resetCropBtn = resetCropBtn;
    this._cropHint = cropHint;

    cropPanel.appendChild(this._toolbarGroup([cropToggleBtn, resetCropBtn], true));
    cropPanel.appendChild(cropHint);

    const pmiPanel = document.createElement("div");
    pmiPanel.className = "sheet-slides-panel";
    pmiPanel.innerHTML = "<h3>PMI View</h3>";

    const pmiNameValue = document.createElement("div");
    pmiNameValue.className = "sheet-slides-readonly";

    const showTitleInput = document.createElement("input");
    showTitleInput.type = "checkbox";
    showTitleInput.addEventListener("change", () => this._setSelectedPMIField("showTitle", showTitleInput.checked));

    const showTitleWrap = document.createElement("div");
    showTitleWrap.className = "sheet-slides-checkbox";
    showTitleWrap.appendChild(showTitleInput);
    showTitleWrap.appendChild(document.createTextNode("Show title"));

    const showBgInput = document.createElement("input");
    showBgInput.type = "checkbox";
    showBgInput.addEventListener("change", () => this._setSelectedPMIField("showBackground", showBgInput.checked));

    const showBgWrap = document.createElement("div");
    showBgWrap.className = "sheet-slides-checkbox";
    showBgWrap.appendChild(showBgInput);
    showBgWrap.appendChild(document.createTextNode("Background"));

    const {
      wrap: pmiBgControl,
      input: pmiBgInput,
      reset: pmiBgResetBtn,
    } = this._buildColorControl(
      (value) => this._setSelectedPMIField("backgroundColor", value),
      () => this._resetSelectedPMIBackground(),
    );

    this._pmiPanel = pmiPanel;
    this._pmiNameValue = pmiNameValue;
    this._showTitleInput = showTitleInput;
    this._showPmiBackgroundInput = showBgInput;
    this._pmiBgInput = pmiBgInput;
    this._pmiBgResetBtn = pmiBgResetBtn;

    pmiPanel.appendChild(this._makeField("View Name", pmiNameValue));
    pmiPanel.appendChild(this._makeField("Title", showTitleWrap));
    pmiPanel.appendChild(this._makeField("Backdrop", showBgWrap));
    pmiPanel.appendChild(this._makeField("BG Color", pmiBgControl));

    inspector.appendChild(inspectorHeader);
    inspector.appendChild(slidePanel);
    inspector.appendChild(elementPanel);
    inspector.appendChild(textPanel);
    inspector.appendChild(cropPanel);
    inspector.appendChild(pmiPanel);

    const status = document.createElement("div");
    status.className = "sheet-slides-status";
    const statusLeft = document.createElement("div");
    const statusRight = document.createElement("div");
    statusRight.className = "sheet-slides-muted";
    statusRight.textContent = "Ready";
    status.appendChild(statusLeft);
    status.appendChild(statusRight);
    this._statusLeft = statusLeft;
    this._statusRight = statusRight;

    const contextMenu = document.createElement("div");
    contextMenu.className = "sheet-slides-context-menu";
    contextMenu.style.display = "none";

    const bringToFrontItem = document.createElement("button");
    bringToFrontItem.type = "button";
    bringToFrontItem.className = "sheet-slides-context-menu-item";
    bringToFrontItem.textContent = "Bring to front";
    bringToFrontItem.addEventListener("click", () => {
      this._hideContextMenu();
      this._bringSelectedToFront();
    });

    const sendToBackItem = document.createElement("button");
    sendToBackItem.type = "button";
    sendToBackItem.className = "sheet-slides-context-menu-item";
    sendToBackItem.textContent = "Send to back";
    sendToBackItem.addEventListener("click", () => {
      this._hideContextMenu();
      this._sendSelectedToBack();
    });

    contextMenu.appendChild(bringToFrontItem);
    contextMenu.appendChild(sendToBackItem);
    this._contextMenu = contextMenu;

    const pmiPicker = document.createElement("div");
    pmiPicker.className = "sheet-slides-modal-overlay";
    pmiPicker.style.display = "none";
    pmiPicker.addEventListener("click", (event) => {
      if (event.target === pmiPicker) this._closePmiPicker();
    });

    const pmiPickerDialog = document.createElement("div");
    pmiPickerDialog.className = "sheet-slides-modal";
    pmiPickerDialog.addEventListener("click", (event) => event.stopPropagation());

    const pmiPickerHeader = document.createElement("div");
    pmiPickerHeader.className = "sheet-slides-modal-header";
    const pmiPickerTitle = document.createElement("strong");
    pmiPickerTitle.textContent = "Insert PMI View";
    const pmiPickerCloseBtn = document.createElement("button");
    pmiPickerCloseBtn.type = "button";
    pmiPickerCloseBtn.className = "sheet-slides-modal-close";
    pmiPickerCloseBtn.textContent = "×";
    pmiPickerCloseBtn.setAttribute("aria-label", "Close PMI picker");
    pmiPickerCloseBtn.addEventListener("click", () => this._closePmiPicker());
    pmiPickerHeader.appendChild(pmiPickerTitle);
    pmiPickerHeader.appendChild(pmiPickerCloseBtn);

    const pmiPickerBody = document.createElement("div");
    pmiPickerBody.className = "sheet-slides-pmi-picker-grid";

    pmiPickerDialog.appendChild(pmiPickerHeader);
    pmiPickerDialog.appendChild(pmiPickerBody);
    pmiPicker.appendChild(pmiPickerDialog);

    this._pmiPickerOverlay = pmiPicker;
    this._pmiPickerBody = pmiPickerBody;

    root.appendChild(topbar);
    root.appendChild(sidebar);
    root.appendChild(stageWrap);
    root.appendChild(inspector);
    root.appendChild(status);
    root.appendChild(contextMenu);
    root.appendChild(pmiPicker);

    fw.content.appendChild(root);

    this.window = fw;
    this.root = root;

    this._refreshPmiViews();
  }

  _makeToolbarButton(label, onClick, variant = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sheet-slides-btn ${variant}`.trim();
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  _toolbarGroup(children, noDivider = false) {
    const wrap = document.createElement("div");
    wrap.className = `sheet-slides-toolbar-group${noDivider ? " no-divider" : ""}`;
    for (const child of children) wrap.appendChild(child);
    return wrap;
  }

  _makeField(label, control) {
    const field = document.createElement("label");
    field.className = "sheet-slides-field";
    const title = document.createElement("span");
    title.className = "sheet-slides-field-label";
    title.textContent = label;
    field.appendChild(title);
    field.appendChild(control);
    return field;
  }

  _buildNumberInput(onChange, { step = 1, min = null, max = null } = {}) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "sheet-slides-control";
    input.step = String(step);
    if (min != null) input.min = String(min);
    if (max != null) input.max = String(max);
    input.addEventListener("input", () => onChange(input.value));
    return input;
  }

  _buildColorControl(onInput, onReset) {
    const wrap = document.createElement("div");
    wrap.className = "sheet-slides-color-row";

    const input = document.createElement("input");
    input.type = "color";
    input.className = "sheet-slides-control";
    input.addEventListener("input", () => onInput(input.value));

    const reset = this._makeToolbarButton("Reset", onReset, "color-reset");

    wrap.appendChild(input);
    wrap.appendChild(reset);
    return { wrap, input, reset };
  }

  _defaultSheetBackground() {
    return "#ffffff";
  }

  _setSheetFormatField(key, rawValue) {
    if (!this.sheetDraft) return;
    if (key === "sizeKey") {
      this.sheetDraft.sizeKey = String(rawValue || DEFAULT_SHEET_SIZE_KEY);
    } else if (key === "orientation") {
      this.sheetDraft.orientation = String(rawValue || DEFAULT_SHEET_ORIENTATION);
    } else {
      return;
    }

    this._commitSheetDraft(`sheet-${key}`);
    this._renderAll();
  }

  _defaultFillForElement(element) {
    const type = String(element?.type || "");
    if (type === "text") return "transparent";
    if (type === "rect") return "#8bc4ff";
    if (type === "ellipse") return "#ffd166";
    if (type === "image") return "#ffffff";
    if (type === "pmiInset") return "transparent";
    return "#000000";
  }

  _defaultTextColorForElement(element) {
    const type = String(element?.type || "");
    if (type === "rect" || type === "ellipse") return "#0f172a";
    return "#111111";
  }

  _setSheetBackground(rawValue) {
    if (!this.sheetDraft) return;
    this.sheetDraft.background = String(rawValue || this._defaultSheetBackground());
    this._commitSheetDraft("sheet-bg");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _resetSheetBackground() {
    this._setSheetBackground(this._defaultSheetBackground());
  }

  _isCropModeForElement(elementOrId) {
    const id = typeof elementOrId === "object"
      ? String(elementOrId?.id || "")
      : String(elementOrId || "");
    return !!id && id === String(this._cropModeElementId || "");
  }

  _enterCropMode(elementId = this.selectedElementId) {
    const element = this._getElementById(elementId);
    if (!element || !elementSupportsMediaCrop(element)) return;
    this._cropModeElementId = String(element.id || "");
    this._renderStageOnly();
    this._renderInspector();
    this._setStatus("Crop mode");
  }

  _exitCropMode() {
    if (!this._cropModeElementId) return;
    this._cropModeElementId = null;
    this._renderStageOnly();
    this._renderInspector();
    this._setStatus("Crop applied");
  }

  _showContextMenu(clientX, clientY) {
    const menu = this._contextMenu;
    const root = this.root;
    if (!menu || !root) return;

    menu.style.display = "grid";
    menu.style.left = "0px";
    menu.style.top = "0px";

    const rootRect = root.getBoundingClientRect();
    const menuWidth = Math.max(1, menu.offsetWidth);
    const menuHeight = Math.max(1, menu.offsetHeight);
    const left = clamp(clientX - rootRect.left, 8, Math.max(8, rootRect.width - menuWidth - 8));
    const top = clamp(clientY - rootRect.top, 8, Math.max(8, rootRect.height - menuHeight - 8));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  _hideContextMenu() {
    if (!this._contextMenu) return;
    this._contextMenu.style.display = "none";
  }

  _openPmiPicker() {
    this._refreshPmiViews();
    this._pmiPickerOpen = true;
    if (this._pmiPickerOverlay) this._pmiPickerOverlay.style.display = "grid";
    this._renderPmiPicker();
  }

  _closePmiPicker() {
    this._pmiPickerOpen = false;
    if (this._pmiPickerOverlay) this._pmiPickerOverlay.style.display = "none";
  }

  _getPmiPreviewCaptureKey(view, viewIndex) {
    return [
      "picker",
      this._getCurrentModelRevision(),
      this._pmiViewRevision,
      Number.isInteger(viewIndex) ? viewIndex : -1,
      String(view?.viewName || view?.name || `View ${Number(viewIndex) + 1}`),
      "transparent",
    ].join(":");
  }

  _ensurePmiPreview(view, viewIndex) {
    const captureKey = this._getPmiPreviewCaptureKey(view, viewIndex);
    if (this._pmiImageCache.has(captureKey)) return;
    if (this._pendingPmiPreviewCaptures.has(captureKey)) return;

    const promise = this._pmiImageCaptureQueue
      .then(() => this._capturePmiViewImage(view, viewIndex, { fill: "transparent", pmiViewName: String(view?.viewName || view?.name || "") }))
      .then((dataUrl) => {
        if (!dataUrl) return null;
        this._pmiImageCache.set(captureKey, dataUrl);
        if (this._pmiPickerOpen) this._renderPmiPicker();
        return dataUrl;
      })
      .catch(() => null)
      .finally(() => {
        if (this._pendingPmiPreviewCaptures.get(captureKey) === promise) {
          this._pendingPmiPreviewCaptures.delete(captureKey);
        }
      });

    this._pendingPmiPreviewCaptures.set(captureKey, promise);
    this._pmiImageCaptureQueue = promise.catch(() => null);
  }

  _renderPmiPicker() {
    const body = this._pmiPickerBody;
    if (!body) return;

    body.textContent = "";

    if (!Array.isArray(this._pmiViews) || this._pmiViews.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sheet-slides-pmi-picker-empty";
      empty.textContent = "No PMI views available.";
      body.appendChild(empty);
      return;
    }

    for (let index = 0; index < this._pmiViews.length; index += 1) {
      const view = this._pmiViews[index];
      const captureKey = this._getPmiPreviewCaptureKey(view, index);
      const cached = this._pmiImageCache.get(captureKey) || "";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "sheet-slides-pmi-picker-card";
      card.addEventListener("click", () => {
        this._closePmiPicker();
        this._insertPmiView(index);
      });

      const preview = document.createElement("div");
      preview.className = "sheet-slides-pmi-picker-preview";
      if (cached) {
        const img = document.createElement("img");
        img.className = "sheet-slides-pmi-picker-image";
        img.alt = String(view?.viewName || view?.name || `PMI view ${index + 1}`);
        img.draggable = false;
        img.src = cached;
        preview.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "sheet-slides-pmi-picker-placeholder";
        placeholder.textContent = "Generating preview...";
        preview.appendChild(placeholder);
        this._ensurePmiPreview(view, index);
      }

      const title = document.createElement("div");
      title.className = "sheet-slides-pmi-picker-title";
      title.textContent = String(view?.viewName || view?.name || `View ${index + 1}`);

      card.appendChild(preview);
      card.appendChild(title);
      body.appendChild(card);
    }
  }

  _toggleSheetMenu(sheetId) {
    const id = String(sheetId || "").trim();
    this._openSheetMenuId = this._openSheetMenuId === id ? null : id;
    this._renderSidebarOnly();
  }

  _closeSheetMenu() {
    if (!this._openSheetMenuId) return;
    this._openSheetMenuId = null;
    this._renderSidebarOnly();
  }

  _onGlobalPointerDown(event) {
    if (this._contextMenu && this._contextMenu.style.display !== "none") {
      if (!event?.target?.closest?.(".sheet-slides-context-menu")) {
        this._hideContextMenu();
      }
    }
    if (this._openSheetMenuId) {
      const insideSheetMenu = event?.target?.closest?.(".sheet-slides-thumb-menu, .sheet-slides-thumb-menu-btn");
      if (!insideSheetMenu) this._closeSheetMenu();
    }
  }

  _toggleCropModeForSelection() {
    const selected = this._getSelectedElement();
    if (!selected || !elementSupportsMediaCrop(selected)) return;
    if (this._isCropModeForElement(selected)) {
      this._exitCropMode();
    } else {
      this._enterCropMode(selected.id);
    }
  }

  _rememberMediaMetadata(src, naturalWidth, naturalHeight) {
    const key = String(src || "").trim();
    const width = Math.max(1, Math.round(toFiniteNumber(naturalWidth, 0)));
    const height = Math.max(1, Math.round(toFiniteNumber(naturalHeight, 0)));
    if (!key || !width || !height) return false;
    const previous = this._mediaMetadataCache.get(key);
    if (previous && previous.width === width && previous.height === height) return false;
    this._mediaMetadataCache.set(key, { width, height });
    return true;
  }

  _bindMediaMetadata(mediaNode, src) {
    const key = String(src || "").trim();
    if (!mediaNode || !key) return;

    const capture = () => {
      const width = toFiniteNumber(mediaNode.naturalWidth, 0);
      const height = toFiniteNumber(mediaNode.naturalHeight, 0);
      if (!width || !height) return;
      if (!this._rememberMediaMetadata(key, width, height)) return;
      this._renderStageOnly();
      this._renderSidebarOnly();
    };

    if (toFiniteNumber(mediaNode.naturalWidth, 0) > 0 && toFiniteNumber(mediaNode.naturalHeight, 0) > 0) {
      capture();
      return;
    }

    mediaNode.addEventListener("load", capture, { once: true });
  }

  _getMediaMetadataForElement(element, mediaNode = null) {
    const src = String(element?.src || "").trim();
    if (!src) return null;
    if (mediaNode && toFiniteNumber(mediaNode.naturalWidth, 0) > 0 && toFiniteNumber(mediaNode.naturalHeight, 0) > 0) {
      this._rememberMediaMetadata(src, mediaNode.naturalWidth, mediaNode.naturalHeight);
    }
    return this._mediaMetadataCache.get(src) || null;
  }

  _getPmiTitleHeightIn(element) {
    return element?.type === "pmiInset" && element?.showTitle !== false ? PMI_TITLE_HEIGHT_IN : 0;
  }

  _getMediaFrameBox(element) {
    const x = toFiniteNumber(element?.x, 0);
    const y = toFiniteNumber(element?.y, 0);
    const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
    const outerH = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
    const captionHeight = this._getPmiTitleHeightIn(element);
    const h = Math.max(MIN_ELEMENT_IN, outerH - captionHeight);
    return { x, y, w, h, outerH, captionHeight };
  }

  _getMediaLayout(element, frameWidth, frameHeight, metadata = null) {
    const safeFrameWidth = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameWidth, 1));
    const safeFrameHeight = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameHeight, 1));
    const naturalWidth = Math.max(1, toFiniteNumber(metadata?.width, safeFrameWidth));
    const naturalHeight = Math.max(1, toFiniteNumber(metadata?.height, safeFrameHeight));
    const fit = Math.max(safeFrameWidth / naturalWidth, safeFrameHeight / naturalHeight);
    const baseWidth = naturalWidth * fit;
    const baseHeight = naturalHeight * fit;
    const scale = clamp(toFiniteNumber(element?.mediaScale, 1), MIN_MEDIA_SCALE, MAX_MEDIA_SCALE);
    const renderWidth = baseWidth * scale;
    const renderHeight = baseHeight * scale;
    const extraX = Math.max(0, renderWidth - safeFrameWidth);
    const extraY = Math.max(0, renderHeight - safeFrameHeight);
    const offsetX = clamp(toFiniteNumber(element?.mediaOffsetX, 0), -1, 1);
    const offsetY = clamp(toFiniteNumber(element?.mediaOffsetY, 0), -1, 1);
    const left = extraX > 0 ? -((offsetX + 1) * 0.5 * extraX) : 0;
    const top = extraY > 0 ? -((offsetY + 1) * 0.5 * extraY) : 0;
    return {
      naturalWidth,
      naturalHeight,
      baseWidth,
      baseHeight,
      scale,
      renderWidth,
      renderHeight,
      extraX,
      extraY,
      left,
      top,
    };
  }

  _applyMediaCropStateFromRect(element, frameBox, mediaRect, metadata = null) {
    if (!element || !frameBox || !mediaRect) return;

    element.x = frameBox.x;
    element.y = frameBox.y;
    element.w = Math.max(MIN_ELEMENT_IN, frameBox.w);
    element.h = Math.max(
      MIN_ELEMENT_IN,
      frameBox.h + (element.type === "pmiInset" ? this._getPmiTitleHeightIn(element) : 0),
    );

    const layout = this._getMediaLayout(
      { mediaScale: 1, mediaOffsetX: 0, mediaOffsetY: 0 },
      frameBox.w,
      frameBox.h,
      metadata,
    );
    const scale = clamp(
      layout.baseWidth > 0 ? (toFiniteNumber(mediaRect.w, layout.baseWidth) / layout.baseWidth) : 1,
      MIN_MEDIA_SCALE,
      MAX_MEDIA_SCALE,
    );
    const renderWidth = layout.baseWidth * scale;
    const renderHeight = layout.baseHeight * scale;
    const extraX = Math.max(0, renderWidth - frameBox.w);
    const extraY = Math.max(0, renderHeight - frameBox.h);
    const left = toFiniteNumber(mediaRect.x, frameBox.x) - frameBox.x;
    const top = toFiniteNumber(mediaRect.y, frameBox.y) - frameBox.y;
    const usedX = clamp(-left, 0, extraX);
    const usedY = clamp(-top, 0, extraY);

    element.mediaScale = scale;
    element.mediaOffsetX = extraX > 0 ? clamp((usedX / extraX) * 2 - 1, -1, 1) : 0;
    element.mediaOffsetY = extraY > 0 ? clamp((usedY / extraY) * 2 - 1, -1, 1) : 0;
  }

  _resizeCropFrameFromHandle(sourceFrame, mediaRect, handle, dx, dy) {
    const leftLimit = toFiniteNumber(mediaRect?.x, toFiniteNumber(sourceFrame?.x, 0));
    const topLimit = toFiniteNumber(mediaRect?.y, toFiniteNumber(sourceFrame?.y, 0));
    const rightLimit = leftLimit + Math.max(MIN_ELEMENT_IN, toFiniteNumber(mediaRect?.w, sourceFrame?.w));
    const bottomLimit = topLimit + Math.max(MIN_ELEMENT_IN, toFiniteNumber(mediaRect?.h, sourceFrame?.h));

    let left = toFiniteNumber(sourceFrame?.x, 0);
    let top = toFiniteNumber(sourceFrame?.y, 0);
    let right = left + Math.max(MIN_ELEMENT_IN, toFiniteNumber(sourceFrame?.w, 1));
    let bottom = top + Math.max(MIN_ELEMENT_IN, toFiniteNumber(sourceFrame?.h, 1));

    if (handle.includes("w")) left += dx;
    if (handle.includes("e")) right += dx;
    if (handle.includes("n")) top += dy;
    if (handle.includes("s")) bottom += dy;

    left = clamp(left, leftLimit, right - MIN_ELEMENT_IN);
    right = clamp(right, left + MIN_ELEMENT_IN, rightLimit);
    top = clamp(top, topLimit, bottom - MIN_ELEMENT_IN);
    bottom = clamp(bottom, top + MIN_ELEMENT_IN, bottomLimit);

    return {
      x: left,
      y: top,
      w: Math.max(MIN_ELEMENT_IN, right - left),
      h: Math.max(MIN_ELEMENT_IN, bottom - top),
    };
  }

  _getMediaInteractionSnapshot(element, node = null) {
    if (!element || !elementSupportsMediaCrop(element)) return null;
    const frame = this._getMediaFrameBox(element);
    const mediaNode = node?.querySelector?.(".sheet-slides-media-image");
    const metadata = this._getMediaMetadataForElement(element, mediaNode);
    const layout = this._getMediaLayout(element, frame.w, frame.h, metadata);
    return {
      frame,
      metadata,
      mediaRect: {
        x: frame.x + layout.left,
        y: frame.y + layout.top,
        w: layout.renderWidth,
        h: layout.renderHeight,
      },
    };
  }

  _renderAll() {
    this._renderSidebarOnly();
    this._renderStageOnly();
    this._renderInspector();
  }

  _renderSidebarOnly() {
    const listEl = this._sheetsList;
    if (!listEl) return;

    const manager = this._getManager();
    const sheets = manager?.getSheets?.() || [];

    listEl.textContent = "";

    for (let index = 0; index < sheets.length; index += 1) {
      const sheet = sheets[index];
      const card = document.createElement("div");
      card.className = `sheet-slides-thumb${String(sheet?.id || "") === String(this.sheetId || "") ? " active" : ""}`;
      card.draggable = true;
      card.dataset.sheetId = String(sheet?.id || "");
      card.addEventListener("dragstart", (event) => {
        this._dragSheetId = String(sheet?.id || "");
        card.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", this._dragSheetId);
        }
      });
      card.addEventListener("dragend", () => {
        this._dragSheetId = null;
        for (const target of this._sheetsList?.querySelectorAll?.(".sheet-slides-thumb.is-drop-target") || []) {
          target.classList.remove("is-drop-target");
        }
        card.classList.remove("is-dragging");
      });
      card.addEventListener("dragover", (event) => {
        if (!this._dragSheetId || this._dragSheetId === String(sheet?.id || "")) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        card.classList.add("is-drop-target");
      });
      card.addEventListener("dragleave", (event) => {
        if (!card.contains(event.relatedTarget)) {
          card.classList.remove("is-drop-target");
        }
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        card.classList.remove("is-drop-target");
        const sourceSheetId = String(this._dragSheetId || "").trim();
        this._dragSheetId = null;
        if (!sourceSheetId || sourceSheetId === String(sheet?.id || "")) return;
        this._moveSheetToIndex(sourceSheetId, index);
      });

      const top = document.createElement("div");
      top.className = "sheet-slides-thumb-top";
      const topText = document.createElement("div");
      topText.className = "sheet-slides-thumb-top-text";
      const title = document.createElement("span");
      title.innerHTML = `${index + 1}. ${escapeHtml(sheet?.name || "Untitled")}`;
      const count = document.createElement("span");
      count.className = "sheet-slides-muted";
      const itemCount = Array.isArray(sheet?.elements) ? sheet.elements.length : 0;
      count.textContent = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
      topText.appendChild(title);
      topText.appendChild(count);
      top.appendChild(topText);

      const menuWrap = document.createElement("div");
      menuWrap.className = "sheet-slides-thumb-menu-wrap";
      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "sheet-slides-thumb-menu-btn";
      menuBtn.textContent = "⋯";
      menuBtn.title = "Sheet actions";
      menuBtn.setAttribute("aria-label", "Sheet actions");
      menuBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._toggleSheetMenu(sheet?.id);
      });
      menuWrap.appendChild(menuBtn);

      if (this._openSheetMenuId === String(sheet?.id || "")) {
        const menu = document.createElement("div");
        menu.className = "sheet-slides-thumb-menu";

        const duplicateBtn = document.createElement("button");
        duplicateBtn.type = "button";
        duplicateBtn.className = "sheet-slides-thumb-menu-item";
        duplicateBtn.textContent = "Duplicate";
        duplicateBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._closeSheetMenu();
          this._duplicateSheet(sheet?.id);
        });
        menu.appendChild(duplicateBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "sheet-slides-thumb-menu-item danger";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._closeSheetMenu();
          this._deleteSheet(sheet?.id);
        });
        menu.appendChild(deleteBtn);

        menuWrap.appendChild(menu);
      }

      top.appendChild(menuWrap);

      const canvas = document.createElement("div");
      canvas.className = "sheet-slides-thumb-canvas";

      card.appendChild(top);
      card.appendChild(canvas);

      card.addEventListener("click", () => {
        this.sheetId = String(sheet?.id || "") || null;
        this.selectedElementId = null;
        this._openSheetMenuId = null;
        this.refreshFromHistory();
      });

      listEl.appendChild(card);
      this._renderMiniSheet(sheet, canvas);
    }

    const phantomCard = document.createElement("div");
    phantomCard.className = "sheet-slides-thumb sheet-slides-thumb-phantom";
    phantomCard.tabIndex = 0;
    phantomCard.setAttribute("role", "button");
    phantomCard.setAttribute("aria-label", "Add new sheet");

    const phantomTop = document.createElement("div");
    phantomTop.className = "sheet-slides-thumb-top";
    const phantomTopText = document.createElement("div");
    phantomTopText.className = "sheet-slides-thumb-top-text";
    const phantomTitle = document.createElement("span");
    phantomTitle.textContent = "New Sheet";
    const phantomHint = document.createElement("span");
    phantomHint.className = "sheet-slides-muted";
    phantomHint.textContent = "Click to add";
    phantomTopText.appendChild(phantomTitle);
    phantomTopText.appendChild(phantomHint);
    phantomTop.appendChild(phantomTopText);

    const phantomCanvas = document.createElement("div");
    phantomCanvas.className = "sheet-slides-thumb-canvas sheet-slides-thumb-canvas-phantom";
    const phantomBadge = document.createElement("div");
    phantomBadge.className = "sheet-slides-thumb-phantom-badge";
    phantomBadge.textContent = "+";
    const phantomLabel = document.createElement("div");
    phantomLabel.className = "sheet-slides-thumb-phantom-label";
    phantomLabel.textContent = "Add sheet";
    phantomCanvas.appendChild(phantomBadge);
    phantomCanvas.appendChild(phantomLabel);

    phantomCard.appendChild(phantomTop);
    phantomCard.appendChild(phantomCanvas);
    phantomCard.addEventListener("click", () => this._addSheet());
    phantomCard.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this._addSheet();
      }
    });
    listEl.appendChild(phantomCard);

    this._sheetCountLabel.textContent = `${sheets.length} total`;
  }

  _renderMiniSheet(sheet, root) {
    const source = (sheet && typeof sheet === "object") ? sheet : null;
    if (!source) return;

    root.textContent = "";

    const widthIn = Math.max(0.1, toFiniteNumber(source.widthIn, 11));
    const heightIn = Math.max(0.1, toFiniteNumber(source.heightIn, 8.5));
    const ppi = Math.max(1, toFiniteNumber(source.pxPerInch, 96));
    const widthPx = widthIn * ppi;
    const heightPx = heightIn * ppi;
    const rootWidth = Math.max(1, root.clientWidth);
    const rootHeight = Math.max(1, root.clientHeight);
    const scale = Math.max(0.01, Math.min(rootWidth / widthPx, rootHeight / heightPx));

    const sheetNode = document.createElement("div");
    sheetNode.className = "sheet-slides-thumb-sheet";
    sheetNode.style.width = `${widthPx}px`;
    sheetNode.style.height = `${heightPx}px`;
    sheetNode.style.background = toCssColor(source.background, "#ffffff");
    sheetNode.style.transform = `scale(${scale})`;
    root.appendChild(sheetNode);

    for (const el of sortElements(source.elements || [])) {
      if (!el || typeof el !== "object") continue;
      const node = document.createElement("div");
      node.className = "sheet-slides-thumb-element";
      node.style.zIndex = String(toFiniteNumber(el.z, 0));
      node.style.opacity = String(clamp(toFiniteNumber(el.opacity, 1), 0, 1));

      if (el.type === "line") {
        const x1 = toFiniteNumber(el.x, 0) * ppi;
        const y1 = toFiniteNumber(el.y, 0) * ppi;
        const x2 = toFiniteNumber(el.x2, el.x) * ppi;
        const y2 = toFiniteNumber(el.y2, el.y) * ppi;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        node.style.left = `${Math.min(x1, x2)}px`;
        node.style.top = `${Math.min(y1, y2)}px`;
        node.style.width = `${len}px`;
        node.style.height = `${Math.max(1, toFiniteNumber(el.strokeWidth, 0.02) * ppi)}px`;
        node.style.transformOrigin = "left center";
        node.style.transform = `rotate(${angle}deg)`;
        node.style.background = toCssColor(el.stroke, "#0f172a");
      } else {
        const xPx = toFiniteNumber(el.x, 0) * ppi;
        const yPx = toFiniteNumber(el.y, 0) * ppi;
        const wPx = Math.max(1, toFiniteNumber(el.w, 1) * ppi);
        const hPx = Math.max(1, toFiniteNumber(el.h, 1) * ppi);
        node.style.left = `${xPx}px`;
        node.style.top = `${yPx}px`;
        node.style.width = `${wPx}px`;
        node.style.height = `${hPx}px`;
        node.style.transform = `rotate(${toFiniteNumber(el.rotationDeg, 0)}deg)`;

        if (el.type === "text") {
          const content = document.createElement("div");
          content.className = "sheet-slides-inline-text";
          content.textContent = String(el.text || "");
          this._applyTextStyles(content, el, ppi);
          content.style.padding = "4px";
          content.style.background = toCssColor(el.fill, "transparent");
          node.appendChild(content);
        } else if (el.type === "ellipse") {
          node.style.background = toCssColor(el.fill, "#ffd166");
          node.style.borderRadius = "999px";
          node.style.border = `${Math.max(1, toFiniteNumber(el.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(el.stroke, "#c78c00")}`;
          const shapeText = document.createElement("div");
          shapeText.className = "sheet-slides-inline-text sheet-slides-shape-text";
          shapeText.textContent = String(el.text || "");
          this._applyTextStyles(shapeText, el, ppi);
          shapeText.style.justifyContent = el.textAlign === "left"
            ? "flex-start"
            : (el.textAlign === "right" ? "flex-end" : "center");
          shapeText.style.padding = "12px";
          node.appendChild(shapeText);
        } else if (el.type === "rect") {
          node.style.background = toCssColor(el.fill, "#8bc4ff");
          node.style.borderRadius = `${Math.max(0, toFiniteNumber(el.cornerRadius, 0.1) * ppi)}px`;
          node.style.border = `${Math.max(1, toFiniteNumber(el.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(el.stroke, "#1d4ed8")}`;
          const shapeText = document.createElement("div");
          shapeText.className = "sheet-slides-inline-text sheet-slides-shape-text";
          shapeText.textContent = String(el.text || "");
          this._applyTextStyles(shapeText, el, ppi);
          shapeText.style.justifyContent = el.textAlign === "left"
            ? "flex-start"
            : (el.textAlign === "right" ? "flex-end" : "center");
          shapeText.style.padding = "8px";
          node.appendChild(shapeText);
        } else if (el.type === "image") {
          node.style.background = toCssColor(el.fill, "transparent");
          node.style.border = `${Math.max(1, toFiniteNumber(el.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(el.stroke, "#94a3b8")}`;
          node.style.borderRadius = "8px";
          node.style.overflow = "hidden";
          const mediaFrame = document.createElement("div");
          mediaFrame.className = "sheet-slides-media-frame";
          mediaFrame.style.background = toCssColor(el.fill, "transparent");
          const img = document.createElement("img");
          img.className = "sheet-slides-media-image";
          img.alt = "";
          img.draggable = false;
          img.src = String(el.src || "");
          this._bindMediaMetadata(img, el.src);
          this._applyMediaCropStyles(img, el, wPx, hPx);
          mediaFrame.appendChild(img);
          node.appendChild(mediaFrame);
        } else if (el.type === "pmiInset") {
          const pmiViewName = this._resolvePmiViewDisplayName(el);
          node.style.background = toCssColor(el.fill, "transparent");
          node.style.border = `${Math.max(1, toFiniteNumber(el.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(el.stroke, "#334155")}`;
          node.style.borderRadius = "8px";
          node.style.overflow = "hidden";
          const captionHeightPx = Math.max(0, this._getPmiTitleHeightIn(el) * ppi);
          const mediaHeightPx = Math.max(1, hPx - captionHeightPx);
          const host = document.createElement("div");
          host.className = "sheet-slides-pmi-host";
          host.style.height = `${mediaHeightPx}px`;
          if (String(el.src || "").trim()) {
            const img = document.createElement("img");
            img.className = "sheet-slides-media-image sheet-slides-pmi-image";
            img.alt = pmiViewName;
            img.draggable = false;
            img.src = String(el.src || "");
            this._bindMediaMetadata(img, el.src);
            this._applyMediaCropStyles(img, el, wPx, mediaHeightPx);
            host.appendChild(img);
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "sheet-slides-pmi-placeholder";
            placeholder.textContent = "PMI image unavailable";
            host.appendChild(placeholder);
          }
          node.appendChild(host);
          if (el.showTitle !== false) {
            const caption = document.createElement("div");
            caption.className = "sheet-slides-pmi-caption";
            caption.textContent = pmiViewName;
            caption.style.height = `${Math.max(0, hPx - mediaHeightPx)}px`;
            node.appendChild(caption);
          }
        } else {
          node.style.background = toCssColor(el.fill, "#8bc4ff");
        }
      }

      sheetNode.appendChild(node);
    }
  }

  _renderStageOnly() {
    const canvas = this._slideCanvas;
    const stageShell = this._stageShell;
    if (!canvas) return;

    const sheet = this.sheetDraft;
    if (!sheet) {
      canvas.textContent = "";
      canvas.style.width = "240px";
      canvas.style.height = "160px";
      canvas.style.transform = "scale(1)";
      if (stageShell) {
        stageShell.style.width = "240px";
        stageShell.style.height = "160px";
      }
      this._appliedZoom = 1;
      this._syncZoomControl();
      this._disposeUnusedPmiViewports(new Set());
      return;
    }

    const ppi = this._pxPerIn();
    const widthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * ppi);
    const heightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * ppi);

    canvas.textContent = "";
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    canvas.style.background = toCssColor(sheet.background, "#ffffff");
    this._appliedZoom = this._zoomMode === "fit"
      ? this._computeFitZoom(sheet)
      : clamp(toFiniteNumber(this.zoom, DEFAULT_ZOOM), 0.1, 4);
    canvas.style.transform = `scale(${this._appliedZoom})`;
    if (stageShell) {
      stageShell.style.width = `${Math.max(1, widthPx * this._appliedZoom)}px`;
      stageShell.style.height = `${Math.max(1, heightPx * this._appliedZoom)}px`;
    }
    canvas.classList.toggle("show-grid", !!this.showGrid);
    this._syncZoomControl();

    const grid = document.createElement("div");
    grid.className = "sheet-slides-grid";
    canvas.appendChild(grid);

    const usedPmiIds = new Set();

    const elements = sortElements(sheet.elements || []);
    for (const element of elements) {
      const node = this._buildElementNode(element, usedPmiIds);
      if (!node) continue;
      canvas.appendChild(node);
    }

    this._disposeUnusedPmiViewports(usedPmiIds);
    this._statusRight.textContent = `${Math.round(widthPx)} × ${Math.round(heightPx)} px`;
  }

  _buildElementNode(element, usedPmiIds) {
    if (!element || typeof element !== "object") return null;

    const ppi = this._pxPerIn();
    const node = document.createElement("div");
    const selected = String(element.id || "") === String(this.selectedElementId || "");
    const cropActive = selected && this._isCropModeForElement(element) && elementSupportsMediaCrop(element);
    node.className = `sheet-slides-element${selected ? " selected" : ""}${cropActive ? " crop-active" : ""}`;
    node.dataset.id = String(element.id || "");
    node.dataset.type = String(element.type || "");

    const opacity = clamp(toFiniteNumber(element.opacity, 1), 0, 1);
    node.style.opacity = String(opacity);
    node.style.zIndex = String(toFiniteNumber(element.z, 0));

    if (element.type === "line") {
      const x1 = toFiniteNumber(element.x, 0) * ppi;
      const y1 = toFiniteNumber(element.y, 0) * ppi;
      const x2 = toFiniteNumber(element.x2, element.x) * ppi;
      const y2 = toFiniteNumber(element.y2, element.y) * ppi;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      node.style.left = `${Math.min(x1, x2)}px`;
      node.style.top = `${Math.min(y1, y2)}px`;
      node.style.width = `${len}px`;
      node.style.height = `${Math.max(2, toFiniteNumber(element.strokeWidth, 0.02) * ppi)}px`;
      node.style.transformOrigin = "left center";
      node.style.transform = `rotate(${angle}deg)`;

      const content = document.createElement("div");
      content.className = "sheet-slides-element-content";
      content.style.background = toCssColor(element.stroke, "#1f2937");
      content.style.width = "100%";
      content.style.height = "100%";
      node.appendChild(content);

      node.addEventListener("pointerdown", (event) => this._onElementPointerDown(event, element.id));
      return node;
    }

    const xPx = toFiniteNumber(element.x, 0) * ppi;
    const yPx = toFiniteNumber(element.y, 0) * ppi;
    const wPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
    const hPx = Math.max(1, toFiniteNumber(element.h, 1) * ppi);
    const mediaFrameBox = elementSupportsMediaCrop(element) ? this._getMediaFrameBox(element) : null;
    const mediaFrameHeightPx = mediaFrameBox ? Math.max(1, mediaFrameBox.h * ppi) : hPx;

    node.style.left = `${xPx}px`;
    node.style.top = `${yPx}px`;
    node.style.width = `${wPx}px`;
    node.style.height = `${hPx}px`;
    node.style.transform = `rotate(${toFiniteNumber(element.rotationDeg, 0)}deg)`;

    const content = document.createElement("div");
    content.className = "sheet-slides-element-content";

    if (element.type === "text") {
      content.classList.add("sheet-slides-inline-text");
      content.textContent = String(element.text || "");
      this._applyTextStyles(content, element, ppi);
      content.style.padding = "4px";
      content.style.background = toCssColor(element.fill, "transparent");
    } else if (element.type === "rect") {
      content.style.background = toCssColor(element.fill, "#8bc4ff");
      content.style.borderRadius = `${Math.max(0, toFiniteNumber(element.cornerRadius, 0.1) * ppi)}px`;
      content.style.border = `${Math.max(1, toFiniteNumber(element.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(element.stroke, "#1d4ed8")}`;
      const shapeText = document.createElement("div");
      shapeText.className = "sheet-slides-inline-text sheet-slides-shape-text";
      shapeText.textContent = String(element.text || "");
      this._applyTextStyles(shapeText, element, ppi);
      shapeText.style.justifyContent = element.textAlign === "left"
        ? "flex-start"
        : (element.textAlign === "right" ? "flex-end" : "center");
      shapeText.style.padding = "8px";
      content.appendChild(shapeText);
    } else if (element.type === "ellipse") {
      content.style.background = toCssColor(element.fill, "#ffd166");
      content.style.borderRadius = "999px";
      content.style.border = `${Math.max(1, toFiniteNumber(element.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(element.stroke, "#c78c00")}`;
      const shapeText = document.createElement("div");
      shapeText.className = "sheet-slides-inline-text sheet-slides-shape-text";
      shapeText.textContent = String(element.text || "");
      this._applyTextStyles(shapeText, element, ppi);
      shapeText.style.justifyContent = element.textAlign === "left"
        ? "flex-start"
        : (element.textAlign === "right" ? "flex-end" : "center");
      shapeText.style.padding = "12px";
      content.appendChild(shapeText);
    } else if (element.type === "image") {
      content.style.background = toCssColor(element.fill, "transparent");
      content.style.border = `${Math.max(1, toFiniteNumber(element.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(element.stroke, "#94a3b8")}`;
      content.style.borderRadius = "8px";
      content.style.overflow = "hidden";
      const mediaFrame = document.createElement("div");
      mediaFrame.className = "sheet-slides-media-frame";
      mediaFrame.dataset.cropTarget = "media";
      mediaFrame.style.background = toCssColor(element.fill, "transparent");
      const media = document.createElement("img");
      media.className = "sheet-slides-media-image";
      media.dataset.cropTarget = "media";
      media.alt = "";
      media.draggable = false;
      media.src = String(element.src || "");
      this._bindMediaMetadata(media, element.src);
      this._applyMediaCropStyles(media, element, wPx, hPx);
      mediaFrame.appendChild(media);
      content.appendChild(mediaFrame);
    } else if (element.type === "pmiInset") {
      const pmiViewName = this._resolvePmiViewDisplayName(element);
      content.style.background = toCssColor(element.fill, "transparent");
      content.style.border = `${Math.max(1, toFiniteNumber(element.strokeWidth, 0.01) * ppi)}px solid ${toCssColor(element.stroke, "#334155")}`;
      content.style.borderRadius = "8px";
      content.style.overflow = "hidden";
      content.classList.add("sheet-slides-pmi-body");
      const host = document.createElement("div");
      host.className = "sheet-slides-pmi-host";
      host.dataset.cropTarget = "media";
      host.style.height = `${mediaFrameHeightPx}px`;
      content.appendChild(host);

      if (element.showTitle !== false) {
        const footer = document.createElement("div");
        footer.className = "sheet-slides-pmi-caption";
        footer.textContent = pmiViewName;
        footer.style.height = `${Math.max(0, hPx - mediaFrameHeightPx)}px`;
        content.appendChild(footer);
      }

      this._attachPmiViewport(element, host, wPx, mediaFrameHeightPx, usedPmiIds);
    } else {
      content.style.background = toCssColor(element.fill, "#dbeafe");
    }

    node.appendChild(content);

    if (selected && element.type !== "line") {
      if (cropActive) {
        const cropOverlay = document.createElement("div");
        cropOverlay.className = "sheet-slides-crop-overlay";
        cropOverlay.style.height = `${mediaFrameHeightPx}px`;
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((corner) => {
          const handle = document.createElement("div");
          handle.className = `sheet-slides-crop-handle ${corner}`;
          handle.dataset.cropHandle = corner;
          cropOverlay.appendChild(handle);
        });
        node.appendChild(cropOverlay);
      } else {
        ["nw", "ne", "sw", "se"].forEach((corner) => {
          const handle = document.createElement("div");
          handle.className = `sheet-slides-handle ${corner}`;
          handle.dataset.handle = corner;
          node.appendChild(handle);
        });

        const rotateLine = document.createElement("div");
        rotateLine.className = "sheet-slides-rotate-line";
        node.appendChild(rotateLine);

        const rotateHandle = document.createElement("div");
        rotateHandle.className = "sheet-slides-rotate-handle";
        rotateHandle.dataset.handle = "rotate";
        node.appendChild(rotateHandle);
      }
    }

    node.addEventListener("pointerdown", (event) => this._onElementPointerDown(event, element.id));
    node.addEventListener("dblclick", (event) => this._onElementDoubleClick(event, element.id));
    return node;
  }

  _attachPmiViewport(element, host, widthPx, heightPx, usedPmiIds) {
    if (!host) return;
    const id = String(element?.id || "");
    if (!id) return;

    usedPmiIds.add(id);
    host.textContent = "";

    const selectedView = this._resolvePmiViewForElement(element);
    const viewIndex = this._resolvePmiViewIndexForElement(element, selectedView);
    const src = String(element?.src || "").trim();
    const captureKey = this._getPmiImageCaptureKey(element, selectedView, viewIndex);
    const needsRefresh = toFiniteNumber(element?.pmiModelRevision, -1) !== this._getCurrentModelRevision()
      || toFiniteNumber(element?.pmiImageRevision, -1) !== this._pmiViewRevision
      || String(element?.pmiImageCaptureKey || "") !== captureKey;

    if (src) {
      const img = document.createElement("img");
      img.className = "sheet-slides-media-image sheet-slides-pmi-image";
      img.dataset.cropTarget = "media";
      img.alt = String(element?.pmiViewName || "PMI View");
      img.draggable = false;
      img.src = src;
      this._bindMediaMetadata(img, src);
      this._applyMediaCropStyles(img, element, widthPx, heightPx);
      host.appendChild(img);
      if (!needsRefresh) return;
    }

    const placeholder = document.createElement("div");
    placeholder.className = "sheet-slides-pmi-placeholder";
    placeholder.textContent = selectedView?.camera
      ? (src ? "Refreshing PMI image..." : "Generating PMI image...")
      : "PMI view not assigned";
    host.appendChild(placeholder);

    if (selectedView?.camera) {
      this._queuePmiInsetImageCapture(element, selectedView, viewIndex, captureKey);
    }
  }

  _resolvePmiViewForElement(element) {
    const idx = Number(element?.pmiViewIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < this._pmiViews.length) {
      return this._pmiViews[idx];
    }
    const targetName = String(element?.pmiViewName || "").trim();
    if (!targetName) return null;
    return this._pmiViews.find((view) => String(view?.viewName || view?.name || "").trim() === targetName) || null;
  }

  _resolvePmiViewIndexForElement(element, view = this._resolvePmiViewForElement(element)) {
    const explicit = Number(element?.pmiViewIndex);
    if (Number.isInteger(explicit) && explicit >= 0 && explicit < this._pmiViews.length) {
      return explicit;
    }
    if (!view) return -1;
    return this._pmiViews.indexOf(view);
  }

  _resolvePmiViewDisplayName(element, view = this._resolvePmiViewForElement(element)) {
    return String(view?.viewName || view?.name || element?.pmiViewName || "PMI View");
  }

  _getMediaCropState(element) {
    return {
      scale: clamp(toFiniteNumber(element?.mediaScale, 1), MIN_MEDIA_SCALE, MAX_MEDIA_SCALE),
      offsetX: clamp(toFiniteNumber(element?.mediaOffsetX, 0), -1, 1),
      offsetY: clamp(toFiniteNumber(element?.mediaOffsetY, 0), -1, 1),
    };
  }

  _applyMediaCropStyles(mediaNode, element, frameWidthPx, frameHeightPx) {
    if (!mediaNode) return;
    const metadata = this._getMediaMetadataForElement(element, mediaNode);
    const layout = this._getMediaLayout(element, frameWidthPx, frameHeightPx, metadata);
    mediaNode.style.position = "absolute";
    mediaNode.style.left = `${layout.left}px`;
    mediaNode.style.top = `${layout.top}px`;
    mediaNode.style.width = `${layout.renderWidth}px`;
    mediaNode.style.height = `${layout.renderHeight}px`;
    mediaNode.style.maxWidth = "none";
    mediaNode.style.maxHeight = "none";
    mediaNode.style.objectFit = "fill";
    mediaNode.style.objectPosition = "center center";
    mediaNode.style.transform = "none";
  }

  _applyTextStyles(node, element, ppi) {
    if (!node || !element) return;
    node.style.fontFamily = String(element.fontFamily || "Arial, Helvetica, sans-serif");
    node.style.fontSize = `${Math.max(6, toFiniteNumber(element.fontSize, 0.32) * ppi)}px`;
    node.style.fontWeight = String(element.fontWeight || "400");
    node.style.fontStyle = String(element.fontStyle || "normal");
    node.style.color = toCssColor(element.color, "#111111");
    node.style.textAlign = String(element.textAlign || (element.type === "text" ? "left" : "center"));
    node.style.whiteSpace = "pre-wrap";
    node.style.wordBreak = "break-word";
    node.style.lineHeight = "1.2";
  }

  _getPmiBackdropCacheToken(element) {
    const backdrop = String(element?.fill || "").trim();
    return isTransparentColor(backdrop) ? "transparent" : normalizeHex(backdrop, "#ffffff");
  }

  _getPmiImageCaptureKey(element, view = this._resolvePmiViewForElement(element), viewIndex = this._resolvePmiViewIndexForElement(element, view)) {
    return [
      this._getCurrentModelRevision(),
      this._pmiViewRevision,
      Number.isInteger(viewIndex) ? viewIndex : -1,
      String(view?.viewName || view?.name || element?.pmiViewName || "PMI View"),
      this._getPmiBackdropCacheToken(element),
    ].join(":");
  }

  _queuePmiInsetImageCapture(element, view, viewIndex, captureKey = this._getPmiImageCaptureKey(element, view, viewIndex)) {
    const id = String(element?.id || "");
    if (!id || !view?.camera) return;
    const pending = this._pendingPmiImageCaptures.get(id);
    if (pending?.key === captureKey) return;

    const cached = this._pmiImageCache.get(captureKey);
    if (cached) {
      this._applyCapturedPmiInsetImage(id, cached, captureKey);
      return;
    }

    const task = this._pmiImageCaptureQueue
      .then(() => this._capturePmiViewImage(view, viewIndex, element))
      .then((dataUrl) => {
        if (!dataUrl) return null;
        this._pmiImageCache.set(captureKey, dataUrl);
        this._applyCapturedPmiInsetImage(id, dataUrl, captureKey);
        return dataUrl;
      })
      .catch(() => null)
      .finally(() => {
        if (this._pendingPmiImageCaptures.get(id)?.promise === task) {
          this._pendingPmiImageCaptures.delete(id);
        }
      });

    this._pendingPmiImageCaptures.set(id, { key: captureKey, promise: task });
    this._pmiImageCaptureQueue = task.catch(() => null);
  }

  _applyCapturedPmiInsetImage(elementId, dataUrl, captureKey = "") {
    const element = this._getElementById(elementId);
    if (!element || element.type !== "pmiInset") return;
    if (captureKey && this._getPmiImageCaptureKey(element) !== captureKey) return;
    if (!this._setPmiInsetImageState(element, dataUrl, captureKey)) return;
    this._commitSheetDraft("pmi-image");
    this._renderStageOnly();
    this._renderSidebarOnly();
    this._renderInspector();
  }

  _setPmiInsetImageState(element, dataUrl, captureKey = "") {
    if (!element || element.type !== "pmiInset") return false;
    const currentModelRevision = this._getCurrentModelRevision();
    const sameSrc = String(element.src || "") === String(dataUrl || "");
    const sameName = String(element.pmiViewName || "") === this._resolvePmiViewDisplayName(element);
    const sameRevision = toFiniteNumber(element.pmiImageRevision, -1) === this._pmiViewRevision;
    const sameModelRevision = toFiniteNumber(element.pmiModelRevision, -1) === currentModelRevision;
    const sameCaptureKey = String(element.pmiImageCaptureKey || "") === String(captureKey || "");
    if (sameSrc && sameName && sameRevision && sameModelRevision && sameCaptureKey) return false;

    element.src = String(dataUrl || "");
    element.pmiViewName = this._resolvePmiViewDisplayName(element);
    element.pmiImageRevision = this._pmiViewRevision;
    element.pmiModelRevision = currentModelRevision;
    element.pmiImageCaptureKey = String(captureKey || "");
    return true;
  }

  async _refreshAllPmiInsetImages() {
    if (this._isRefreshingAllPmiInsets) {
      this._queuePmiInsetRefresh = true;
      return;
    }

    this._isRefreshingAllPmiInsets = true;
    try {
      const manager = this._getManager();
      const sheets = manager?.getSheets?.() || [];
      const groups = new Map();

      for (const sheet of sheets) {
        const sheetId = String(sheet?.id || "").trim();
        if (!sheetId) continue;
        for (const element of Array.isArray(sheet?.elements) ? sheet.elements : []) {
          if (String(element?.type || "") !== "pmiInset") continue;
          const selectedView = this._resolvePmiViewForElement(element);
          const viewIndex = this._resolvePmiViewIndexForElement(element, selectedView);
          if (!selectedView?.camera || viewIndex < 0) continue;
          const captureKey = this._getPmiImageCaptureKey(element, selectedView, viewIndex);
          const group = groups.get(captureKey) || {
            captureKey,
            view: selectedView,
            viewIndex,
            elementSnapshot: deepClone(element),
            targets: [],
          };
          group.targets.push({ sheetId, elementId: String(element?.id || "") });
          groups.set(captureKey, group);
        }
      }

      if (groups.size === 0) {
        this._renderStageOnly();
        this._renderSidebarOnly();
        this._renderInspector();
        return;
      }

      let anyChanged = false;
      for (const group of groups.values()) {
        const cached = this._pmiImageCache.get(group.captureKey);
        const dataUrl = cached || await this._capturePmiViewImage(group.view, group.viewIndex, group.elementSnapshot);
        if (!dataUrl) continue;
        this._pmiImageCache.set(group.captureKey, dataUrl);

        for (const target of group.targets) {
          if (String(target.sheetId) === String(this.sheetId || "")) {
            const element = this._getElementById(target.elementId);
            if (!element || element.type !== "pmiInset") continue;
            if (this._getPmiImageCaptureKey(element) !== group.captureKey) continue;
            if (this._setPmiInsetImageState(element, dataUrl, group.captureKey)) {
              this._commitSheetDraft("pmi-image-sync");
              anyChanged = true;
            }
            continue;
          }

          let changed = false;
          this._isCommitting = true;
          try {
            manager.updateSheet?.(target.sheetId, (sheetDraft) => {
              const elements = Array.isArray(sheetDraft?.elements) ? sheetDraft.elements : [];
              const element = elements.find((entry) => String(entry?.id || "") === String(target.elementId || ""));
              if (!element || element.type !== "pmiInset") return sheetDraft;
              if (this._getPmiImageCaptureKey(element) !== group.captureKey) return sheetDraft;
              if (this._setPmiInsetImageState(element, dataUrl, group.captureKey)) {
                changed = true;
              }
              return sheetDraft;
            });
          } finally {
            this._isCommitting = false;
          }
          if (changed) anyChanged = true;
        }
      }

      if (anyChanged) {
        this.refreshFromHistory();
      } else {
        this._renderStageOnly();
        this._renderSidebarOnly();
        this._renderInspector();
      }
      if (this._pmiPickerOpen) this._renderPmiPicker();
    } finally {
      this._isRefreshingAllPmiInsets = false;
      if (this._queuePmiInsetRefresh) {
        this._queuePmiInsetRefresh = false;
        void this._refreshAllPmiInsetImages();
      }
    }
  }

  async _capturePmiViewImage(view, viewIndex, element = null) {
    const widget = this.viewer?.pmiViewsWidget || null;
    const viewer = this.viewer;
    const camera = viewer?.camera;
    const renderer = viewer?.renderer || null;
    if (!widget || !viewer || !camera || !renderer) return null;

    const originalSnapshot = captureCameraSnapshot(camera, { controls: viewer.controls });
    const originalWireframe = typeof widget._detectWireframe === "function"
      ? widget._detectWireframe(viewer.scene)
      : false;
    const previousClearColor = viewer?._clearColor?.clone?.() || "#000000";
    const previousClearAlpha = typeof renderer.getClearAlpha === "function"
      ? renderer.getClearAlpha()
      : (toFiniteNumber(viewer?._clearAlpha, 1));
    const previousAutoClear = renderer.autoClear;
    const previousSceneBackground = viewer?.scene?.background ?? null;
    const backdrop = toCssColor(element?.fill, "transparent");
    const useTransparentBackground = isTransparentColor(backdrop);

    let dataUrl = null;
    const runCapture = async () => {
      let overlay = null;
      try {
        try {
          renderer.autoClear = true;
          if (useTransparentBackground && viewer?.scene) {
            viewer.scene.background = null;
          }
          renderer.setClearColor(useTransparentBackground ? "#000000" : backdrop, useTransparentBackground ? 0 : 1);
          renderer.clear?.(true, true, true);
        } catch { }
        widget._applyView?.(view, { index: viewIndex, suppressActive: true });
        overlay = typeof widget._buildExportAnnotations === "function"
          ? await widget._buildExportAnnotations(view)
          : { labels: [], cleanup: () => { } };
        if (typeof widget._renderAndWait === "function") {
          await widget._renderAndWait(2);
        } else {
          viewer.render?.();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          viewer.render?.();
        }
        if (typeof widget._captureCanvasImage === "function") {
          dataUrl = await widget._captureCanvasImage(overlay?.labels || []);
        } else {
          dataUrl = viewer.renderer?.domElement?.toDataURL?.("image/png") || null;
        }
      } finally {
        try { overlay?.cleanup?.(); } catch { }
      }
    };

    try {
      if (typeof widget._withViewCubeHidden === "function") {
        await widget._withViewCubeHidden(runCapture);
      } else {
        await runCapture();
      }
    } catch {
      dataUrl = null;
    } finally {
      try { renderer.autoClear = previousAutoClear; } catch { }
      try { if (viewer?.scene) viewer.scene.background = previousSceneBackground; } catch { }
      try { renderer.setClearColor(previousClearColor, previousClearAlpha); } catch { }
      try { widget._restoreViewState?.(originalSnapshot, originalWireframe); } catch { }
    }

    return dataUrl;
  }

  _disposeUnusedPmiViewports(usedIds) {
    void usedIds;
  }

  _disposeAllPmiViewports() {
    this._pendingPmiImageCaptures.clear();
    this._pendingPmiPreviewCaptures.clear();
    this._pmiImageCache.clear();
    this._pmiImageCaptureQueue = Promise.resolve();
  }

  _disposePmiViewportEntry(entry) {
    void entry;
  }

  _renderInspector() {
    const sheet = this.sheetDraft;
    const selected = this._getSelectedElement();
    const hasElement = !!selected;
    const supportsText = hasElement && elementSupportsText(selected);
    const supportsCrop = hasElement && elementSupportsMediaCrop(selected);
    const isPMI = hasElement && selected.type === "pmiInset";
    const isLine = hasElement && selected.type === "line";

    this._sheetNameInput.value = String(sheet?.name || "");
    if (this._sheetSizeInput) this._sheetSizeInput.value = String(sheet?.sizeKey || DEFAULT_SHEET_SIZE_KEY);
    if (this._sheetOrientationInput) this._sheetOrientationInput.value = String(sheet?.orientation || DEFAULT_SHEET_ORIENTATION);
    this._sheetBgInput.value = normalizeHex(sheet?.background, this._defaultSheetBackground());
    if (this._sheetSizeInput) this._sheetSizeInput.disabled = !sheet;
    if (this._sheetOrientationInput) this._sheetOrientationInput.disabled = !sheet;
    this._sheetBgResetBtn.disabled = !sheet;

    this._selectionLabel.textContent = selected
      ? `${selected.type}${selected.type === "pmiInset" ? ` · ${this._resolvePmiViewDisplayName(selected)}` : ""}`
      : "No selection";

    if (this._slidePanel) this._slidePanel.style.display = hasElement ? "none" : "block";
    if (this._elementPanel) this._elementPanel.style.display = hasElement ? "block" : "none";

    const disable = !hasElement;
    this._xInput.disabled = disable;
    this._yInput.disabled = disable;
    this._wInput.disabled = disable;
    this._hInput.disabled = disable;
    this._rotInput.disabled = disable;
    this._fillInput.disabled = disable;
    this._fillResetBtn.disabled = disable;
    this._opacityInput.disabled = disable;
    this._zInput.disabled = disable;
    this._textColorInput.disabled = !supportsText;
    this._textColorResetBtn.disabled = !supportsText;
    this._pmiBgInput.disabled = !isPMI;
    this._pmiBgResetBtn.disabled = !isPMI;
    this._showTitleInput.disabled = !isPMI;
    this._showPmiBackgroundInput.disabled = !isPMI;
    this._cropToggleBtn.disabled = !supportsCrop;
    this._resetCropBtn.disabled = !supportsCrop;
    this._fillField.style.display = hasElement && (isPMI || isLine) ? "none" : "";

    if (!hasElement) {
      this._xInput.value = "";
      this._yInput.value = "";
      this._wInput.value = "";
      this._hInput.value = "";
      this._rotInput.value = "";
      this._fillInput.value = "#000000";
      this._opacityInput.value = "";
      this._zInput.value = "";
      this._textPanel.style.display = "none";
      this._cropPanel.style.display = "none";
      this._pmiPanel.style.display = "none";
      this._cropToggleBtn.textContent = "Crop";
      this._cropToggleBtn.classList.remove("primary");
      this._cropHint.textContent = "";
      this._pmiNameValue.textContent = "";
      this._showTitleInput.checked = false;
      this._showPmiBackgroundInput.checked = false;
      this._pmiBgInput.value = "#ffffff";
      this._pmiBgInput.disabled = true;
      this._pmiBgResetBtn.disabled = true;
      return;
    }

    const ppi = this._pxPerIn();

    if (isLine) {
      this._xInput.value = String(Math.round(toFiniteNumber(selected.x, 0) * ppi));
      this._yInput.value = String(Math.round(toFiniteNumber(selected.y, 0) * ppi));
      this._wInput.value = "";
      this._hInput.value = "";
      this._rotInput.value = "";
      this._fillInput.value = "#000000";
      this._opacityInput.value = String(clamp(toFiniteNumber(selected.opacity, 1), 0, 1));
      this._zInput.value = String(Math.round(toFiniteNumber(selected.z, 0)));
      this._wInput.disabled = true;
      this._hInput.disabled = true;
      this._rotInput.disabled = true;
      this._fillInput.disabled = true;
      this._fillResetBtn.disabled = true;
      this._textPanel.style.display = "none";
      this._cropPanel.style.display = "none";
      this._pmiPanel.style.display = "none";
      this._fillField.style.display = "none";
      return;
    }

    this._wInput.disabled = false;
    this._hInput.disabled = false;
    this._rotInput.disabled = false;
    this._fillInput.disabled = false;
    this._fillResetBtn.disabled = false;

    this._xInput.value = String(Math.round(toFiniteNumber(selected.x, 0) * ppi));
    this._yInput.value = String(Math.round(toFiniteNumber(selected.y, 0) * ppi));
    this._wInput.value = String(Math.round(toFiniteNumber(selected.w, 1) * ppi));
    this._hInput.value = String(Math.round(toFiniteNumber(selected.h, 1) * ppi));
    this._rotInput.value = String(Math.round(toFiniteNumber(selected.rotationDeg, 0) * 10) / 10);
    this._fillInput.value = normalizeHex(
      selected.fill,
      selected.type === "pmiInset" ? "#ffffff" : normalizeHex(this._defaultFillForElement(selected), "#000000"),
    );
    this._opacityInput.value = String(clamp(toFiniteNumber(selected.opacity, 1), 0, 1));
    this._zInput.value = String(Math.round(toFiniteNumber(selected.z, 0)));

    if (isPMI) {
      this._fillInput.disabled = true;
      this._fillResetBtn.disabled = true;
    }

    this._textPanel.style.display = supportsText ? "block" : "none";
    this._cropPanel.style.display = supportsCrop ? "block" : "none";
    this._pmiPanel.style.display = isPMI ? "block" : "none";
    if (!supportsCrop) {
      this._cropToggleBtn.textContent = "Crop";
      this._cropToggleBtn.classList.remove("primary");
      this._cropHint.textContent = "";
    }

    if (supportsText) {
      this._textInput.value = String(selected.text || "");
      this._fontFamilyInput.value = String(selected.fontFamily || "Arial, Helvetica, sans-serif");
      this._fontSizeInput.value = String(Math.round(toFiniteNumber(selected.fontSize, 0.32) * ppi));
      this._textColorInput.value = normalizeHex(selected.color, this._defaultTextColorForElement(selected));
      this._textAlignInput.value = String(selected.textAlign || (selected.type === "text" ? "left" : "center"));
      this._boldBtn.classList.toggle("primary", String(selected.fontWeight || "400") === "700");
      this._italicBtn.classList.toggle("primary", String(selected.fontStyle || "normal") === "italic");
    }

    if (supportsCrop) {
      const cropActive = this._isCropModeForElement(selected);
      this._cropToggleBtn.textContent = cropActive ? "Done" : "Crop";
      this._cropToggleBtn.classList.toggle("primary", cropActive);
      this._cropHint.textContent = cropActive
        ? "Drag the image to reposition it. Drag the black handles to crop. Press Enter or Esc to finish."
        : "Double-click the image or press Crop to edit the crop.";
    }

    if (isPMI) {
      this._pmiNameValue.textContent = this._resolvePmiViewDisplayName(selected);
      this._showTitleInput.checked = selected.showTitle !== false;
      this._showPmiBackgroundInput.checked = !isTransparentColor(selected.fill);
      this._pmiBgInput.value = normalizeHex(selected.fill, "#ffffff");
      this._pmiBgInput.disabled = isTransparentColor(selected.fill);
    }
  }

  _onCanvasPointerDown(event) {
    if (!this.sheetDraft) return;
    if (event.button !== 0) return;
    if (isPointerFromInput(event)) return;
    if (event.target !== this._slideCanvas && !event.target.classList.contains("sheet-slides-grid")) return;
    this._hideContextMenu();
    this._cropModeElementId = null;
    this.selectedElementId = null;
    this._renderStageOnly();
    this._renderInspector();
  }

  _onCanvasContextMenu(event) {
    if (!this.sheetDraft) return;
    if (isPointerFromInput(event)) return;

    const elementNode = event?.target?.closest?.(".sheet-slides-element");
    if (!elementNode || !this._slideCanvas?.contains?.(elementNode)) {
      this._hideContextMenu();
      event.preventDefault();
      return;
    }

    const elementId = String(elementNode.dataset.id || "").trim();
    const element = this._getElementById(elementId);
    if (!element) {
      this._hideContextMenu();
      event.preventDefault();
      return;
    }

    if (this._cropModeElementId && !this._isCropModeForElement(element)) {
      this._cropModeElementId = null;
    }
    this.selectedElementId = elementId;
    this._renderStageOnly();
    this._renderInspector();
    this._showContextMenu(event.clientX, event.clientY);

    event.preventDefault();
    event.stopPropagation();
  }

  _onElementPointerDown(event, elementId) {
    if (!this.sheetDraft) return;
    if (event.button !== 0) return;
    if (isPointerFromInput(event)) return;

    this._hideContextMenu();

    const element = this._getElementById(elementId);
    if (!element) return;

    const previousSelection = String(this.selectedElementId || "");
    if (this._cropModeElementId && !this._isCropModeForElement(element)) {
      this._cropModeElementId = null;
    }
    this.selectedElementId = String(elementId || "") || null;

    const cropHandle = String(event?.target?.dataset?.cropHandle || "").trim();
    const normalHandle = String(event?.target?.dataset?.handle || "").trim();
    const cropTarget = event?.target?.closest?.("[data-crop-target='media']");
    const cropActive = this._isCropModeForElement(element) && elementSupportsMediaCrop(element);

    let mode = null;
    if (cropActive) {
      if (cropHandle) mode = "crop-resize";
      else if (cropTarget) mode = "crop-pan";
    } else {
      mode = normalHandle === "rotate"
        ? "rotate"
        : (normalHandle ? "resize" : "move");
    }

    if (!mode) {
      if (previousSelection !== String(this.selectedElementId || "")) {
        this._renderStageOnly();
      }
      this._renderInspector();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const slideRect = this._slideCanvas?.getBoundingClientRect?.();
    if (!slideRect) return;
    const point = this._eventToSlidePoint(event, slideRect);

    const mediaSnapshot = mode?.startsWith("crop")
      ? this._getMediaInteractionSnapshot(element, event.currentTarget)
      : null;
    if (mode?.startsWith("crop") && !mediaSnapshot) return;

    this._dragState = {
      pointerId: event.pointerId,
      mode,
      handle: normalHandle || cropHandle || null,
      startX: point.x,
      startY: point.y,
      snapshot: deepClone(element),
      shiftKey: !!event.shiftKey,
      elementId: String(element.id || ""),
      moved: false,
      mediaSnapshot,
    };

    if (previousSelection !== String(this.selectedElementId || "")) {
      this._renderStageOnly();
    }
    this._renderInspector();

    event.preventDefault();
    event.stopPropagation();
  }

  _onElementDoubleClick(event, elementId) {
    const element = this._getElementById(elementId);
    if (!element) return;
    this.selectedElementId = String(elementId || "") || null;
    if (elementSupportsMediaCrop(element)) {
      this._enterCropMode(elementId);
    } else if (elementSupportsText(element)) {
      this._renderInspector();
      const node = event.currentTarget;
      this._beginInlineTextEdit(node, element);
    }
    event.preventDefault();
    event.stopPropagation();
  }

  _beginInlineTextEdit(node, element) {
    if (!node || !element || !elementSupportsText(element)) return;
    const content = node?.querySelector?.(".sheet-slides-inline-text");
    if (!content) return;

    content.contentEditable = "true";
    content.spellcheck = false;
    content.classList.add("editing");
    content.focus();
    this._placeCaretAtEnd(content);

    const commit = () => {
      content.contentEditable = "false";
      content.classList.remove("editing");
      element.text = String(content.textContent || "");
      this._commitSheetDraft("text-inline");
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
    };

    const onKeyDown = (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        content.blur();
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        content.blur();
      }
    };

    content.addEventListener("keydown", onKeyDown);
    content.addEventListener("blur", () => {
      content.removeEventListener("keydown", onKeyDown);
      commit();
    }, { once: true });
  }

  _onGlobalPointerMove(event) {
    if (!this._dragState || !this.sheetDraft) return;

    const selected = this._getSelectedElement();
    if (!selected) return;

    const slideRect = this._slideCanvas?.getBoundingClientRect?.();
    if (!slideRect) return;

    const point = this._eventToSlidePoint(event, slideRect);
    const dxPx = point.x - this._dragState.startX;
    const dyPx = point.y - this._dragState.startY;
    if (!this._dragState.moved) {
      const travel = Math.hypot(dxPx, dyPx);
      if (travel < 3) return;
      this._dragState.moved = true;
    }
    const ppi = this._pxPerIn();
    const dx = dxPx / ppi;
    const dy = dyPx / ppi;

    const source = this._dragState.snapshot;

    if (this._dragState.mode === "move") {
      if (selected.type === "line") {
        selected.x = toFiniteNumber(source.x, 0) + dx;
        selected.y = toFiniteNumber(source.y, 0) + dy;
        selected.x2 = toFiniteNumber(source.x2, source.x) + dx;
        selected.y2 = toFiniteNumber(source.y2, source.y) + dy;
      } else {
        selected.x = toFiniteNumber(source.x, 0) + dx;
        selected.y = toFiniteNumber(source.y, 0) + dy;
      }
    } else if (this._dragState.mode === "resize") {
      this._resizeElementFromHandle(selected, source, this._dragState.handle, dx, dy, !!event.shiftKey);
    } else if (this._dragState.mode === "crop-pan") {
      const frame = this._dragState.mediaSnapshot?.frame;
      const mediaRect = this._dragState.mediaSnapshot?.mediaRect;
      if (!frame || !mediaRect) return;
      const nextX = clamp(
        mediaRect.x + dx,
        frame.x + frame.w - mediaRect.w,
        frame.x,
      );
      const nextY = clamp(
        mediaRect.y + dy,
        frame.y + frame.h - mediaRect.h,
        frame.y,
      );
      this._applyMediaCropStateFromRect(
        selected,
        frame,
        { ...mediaRect, x: nextX, y: nextY },
        this._dragState.mediaSnapshot?.metadata,
      );
    } else if (this._dragState.mode === "crop-resize") {
      const frame = this._dragState.mediaSnapshot?.frame;
      const mediaRect = this._dragState.mediaSnapshot?.mediaRect;
      if (!frame || !mediaRect) return;
      const nextFrame = this._resizeCropFrameFromHandle(frame, mediaRect, this._dragState.handle, dx, dy);
      this._applyMediaCropStateFromRect(
        selected,
        nextFrame,
        mediaRect,
        this._dragState.mediaSnapshot?.metadata,
      );
    } else if (this._dragState.mode === "rotate" && selected.type !== "line") {
      const cx = (toFiniteNumber(source.x, 0) + toFiniteNumber(source.w, 1) * 0.5) * ppi;
      const cy = (toFiniteNumber(source.y, 0) + toFiniteNumber(source.h, 1) * 0.5) * ppi;
      const angle = Math.atan2(point.y - cy, point.x - cx) * 180 / Math.PI + 90;
      selected.rotationDeg = Math.round(angle * 10) / 10;
    }

    this._renderStageOnly();
    this._renderInspector();
  }

  _onGlobalPointerUp(event) {
    if (!this._dragState) return;
    this._endDrag(true, event?.pointerId);
  }

  _endDrag(commit = true, pointerId = null) {
    if (!this._dragState) return;
    const activePointerId = pointerId ?? this._dragState.pointerId;
    const moved = !!this._dragState.moved;
    try { this._slideCanvas?.releasePointerCapture?.(activePointerId); } catch { }
    this._dragState = null;
    if (commit && moved) {
      this._commitSheetDraft("drag");
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
    }
  }

  _resizeElementFromHandle(element, source, handle, dx, dy, keepAspect) {
    if (!element || !source || !handle) return;

    let x = toFiniteNumber(source.x, 0);
    let y = toFiniteNumber(source.y, 0);
    let w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1));
    let h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1));

    if (handle.includes("e")) w = Math.max(MIN_ELEMENT_IN, w + dx);
    if (handle.includes("s")) h = Math.max(MIN_ELEMENT_IN, h + dy);
    if (handle.includes("w")) {
      w = Math.max(MIN_ELEMENT_IN, w - dx);
      x = toFiniteNumber(source.x, 0) + dx;
      if (w <= MIN_ELEMENT_IN) x = toFiniteNumber(source.x, 0) + (toFiniteNumber(source.w, 1) - MIN_ELEMENT_IN);
    }
    if (handle.includes("n")) {
      h = Math.max(MIN_ELEMENT_IN, h - dy);
      y = toFiniteNumber(source.y, 0) + dy;
      if (h <= MIN_ELEMENT_IN) y = toFiniteNumber(source.y, 0) + (toFiniteNumber(source.h, 1) - MIN_ELEMENT_IN);
    }

    if (keepAspect) {
      const ratio = Math.max(1e-6, toFiniteNumber(source.w, 1) / Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1)));
      if (Math.abs(dx) >= Math.abs(dy)) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }
      if (handle.includes("w")) {
        x = toFiniteNumber(source.x, 0) + (toFiniteNumber(source.w, 1) - w);
      }
      if (handle.includes("n")) {
        y = toFiniteNumber(source.y, 0) + (toFiniteNumber(source.h, 1) - h);
      }
    }

    element.x = x;
    element.y = y;
    element.w = Math.max(MIN_ELEMENT_IN, w);
    element.h = Math.max(MIN_ELEMENT_IN, h);
  }

  _onKeyDown(event) {
    if (!this.root || this.root.style.display === "none") return;
    if (!this.sheetDraft) return;

    if (event.key === "Escape" && this._pmiPickerOpen) {
      event.preventDefault();
      this._closePmiPicker();
      return;
    }

    if (event.key === "Escape" && this._openSheetMenuId) {
      event.preventDefault();
      this._closeSheetMenu();
      return;
    }

    if (event.key === "Escape" && this._contextMenu?.style.display !== "none") {
      event.preventDefault();
      this._hideContextMenu();
      return;
    }

    if (this._cropModeElementId && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault();
      this._exitCropMode();
      return;
    }

    const active = document.activeElement;
    const tag = String(active?.tagName || "").toUpperCase();
    const editable = !!active?.isContentEditable;
    if (editable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "d") {
      event.preventDefault();
      this._duplicateSelectedElement();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this._deleteSelectedElement();
      return;
    }

    const selected = this._getSelectedElement();
    if (!selected) return;

    const stepPx = event.shiftKey ? 10 : 1;
    const stepIn = stepPx / this._pxPerIn();

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this._nudgeSelected(-stepIn, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this._nudgeSelected(stepIn, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this._nudgeSelected(0, -stepIn);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this._nudgeSelected(0, stepIn);
    }
  }

  _nudgeSelected(dx, dy) {
    const selected = this._getSelectedElement();
    if (!selected) return;

    if (selected.type === "line") {
      selected.x = toFiniteNumber(selected.x, 0) + dx;
      selected.y = toFiniteNumber(selected.y, 0) + dy;
      selected.x2 = toFiniteNumber(selected.x2, selected.x) + dx;
      selected.y2 = toFiniteNumber(selected.y2, selected.y) + dy;
    } else {
      selected.x = toFiniteNumber(selected.x, 0) + dx;
      selected.y = toFiniteNumber(selected.y, 0) + dy;
    }

    this._commitSheetDraft("nudge");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _setSelectedTransformField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!element) return;

    const ppi = this._pxPerIn();

    if (key === "x" || key === "y" || key === "w" || key === "h") {
      const px = toFiniteNumber(rawValue, Number.NaN);
      if (!Number.isFinite(px)) return;
      const inches = px / ppi;
      if (key === "w" || key === "h") {
        element[key] = Math.max(MIN_ELEMENT_IN, inches);
      } else {
        element[key] = inches;
      }
    } else if (key === "rotationDeg") {
      element.rotationDeg = toFiniteNumber(rawValue, toFiniteNumber(element.rotationDeg, 0));
    }

    this._commitSheetDraft(`set-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _setSelectedStyleField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!element) return;

    if (key === "fill") {
      element.fill = String(rawValue || "#000000");
    } else if (key === "opacity") {
      element.opacity = clamp(toFiniteNumber(rawValue, element.opacity ?? 1), 0, 1);
    } else if (key === "z") {
      element.z = Math.round(toFiniteNumber(rawValue, element.z ?? 0));
    }

    this._commitSheetDraft(`style-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _resetSelectedFill() {
    const element = this._getSelectedElement();
    if (!element || element.type === "line" || element.type === "pmiInset") return;
    element.fill = this._defaultFillForElement(element);
    this._commitSheetDraft("style-fill-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _setSelectedTextField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsText(element)) return;

    if (key === "fontSize") {
      const px = toFiniteNumber(rawValue, toFiniteNumber(element.fontSize, 0.32) * this._pxPerIn());
      element.fontSize = Math.max(0.08, px / this._pxPerIn());
    } else if (key === "text") {
      element.text = String(rawValue || "");
    } else if (key === "fontFamily") {
      element.fontFamily = String(rawValue || "Arial, Helvetica, sans-serif");
    } else if (key === "color") {
      element.color = String(rawValue || "#111111");
    } else if (key === "textAlign") {
      const fallbackAlign = element.type === "text" ? "left" : "center";
      element.textAlign = ["left", "center", "right"].includes(String(rawValue)) ? String(rawValue) : fallbackAlign;
    }

    this._commitSheetDraft(`text-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _resetSelectedTextColor() {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsText(element)) return;
    element.color = this._defaultTextColorForElement(element);
    this._commitSheetDraft("text-color-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _toggleTextWeight() {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsText(element)) return;
    element.fontWeight = String(element.fontWeight || "400") === "700" ? "400" : "700";
    this._commitSheetDraft("text-weight");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _toggleTextItalic() {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsText(element)) return;
    element.fontStyle = String(element.fontStyle || "normal") === "italic" ? "normal" : "italic";
    this._commitSheetDraft("text-italic");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _addSheet() {
    const manager = this._getManager();
    if (!manager?.createSheet) return;

    const count = (manager.getSheets?.() || []).length;
    const created = manager.createSheet(createOneSheetTemplate(`Instruction Sheet ${count + 1}`));
    if (!created?.id) return;

    this._openSheetMenuId = null;
    this.sheetId = String(created.id);
    this.selectedElementId = null;
    this.refreshFromHistory();
    this._setStatus("Sheet added");
  }

  _duplicateSheet(sheetId = this.sheetId) {
    const manager = this._getManager();
    const targetId = String(sheetId || "").trim();
    if (!manager?.duplicateSheet || !targetId) return;

    const copy = manager.duplicateSheet(targetId);
    if (!copy?.id) return;

    this._openSheetMenuId = null;
    this.sheetId = String(copy.id);
    this.selectedElementId = null;
    this.refreshFromHistory();
    this._setStatus("Sheet duplicated");
  }

  _deleteSheet(sheetId = this.sheetId) {
    const manager = this._getManager();
    const targetId = String(sheetId || "").trim();
    if (!manager?.removeSheet || !targetId) return;

    const sheets = manager.getSheets?.() || [];
    if (sheets.length <= 1) {
      this._setStatus("Cannot delete the last sheet");
      return;
    }

    const removedIndex = sheets.findIndex((sheet) => String(sheet?.id || "") === targetId);
    manager.removeSheet(targetId);
    const remaining = manager.getSheets?.() || [];
    if (String(this.sheetId || "") === targetId) {
      const next = remaining[Math.min(Math.max(removedIndex, 0), Math.max(0, remaining.length - 1))] || remaining[0] || null;
      this.sheetId = String(next?.id || "") || null;
      this.selectedElementId = null;
    }
    this._openSheetMenuId = null;
    this.refreshFromHistory();
    this._setStatus("Sheet deleted");
  }

  _moveSheetToIndex(sheetId, toIndex) {
    const manager = this._getManager();
    const sourceId = String(sheetId || "").trim();
    if (!manager?.moveSheet || !sourceId) return;
    const moved = manager.moveSheet(sourceId, toIndex);
    if (!moved) return;
    this._openSheetMenuId = null;
    this.refreshFromHistory();
    this._setStatus("Sheets reordered");
  }

  _resetDeck() {
    const manager = this._getManager();
    if (!manager?.setSheets || !manager?.createSheet) return;

    manager.setSheets([]);
    const created = manager.createSheet(createOneSheetTemplate("Instruction Sheet 1"));
    this.sheetId = String(created?.id || "") || null;
    this.selectedElementId = null;
    this.refreshFromHistory();
    this._setStatus("New sheets deck created");
  }

  _addElement(kind) {
    if (!this.sheetDraft) return;

    this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];

    const ppi = this._pxPerIn();
    const cxIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (160 / ppi));
    const cyIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (80 / ppi));

    let element = null;
    if (kind === "text") element = defaultTextElement(cxIn, cyIn);
    else if (kind === "rect") element = defaultRectElement(cxIn, cyIn);
    else if (kind === "ellipse") element = defaultEllipseElement(cxIn, cyIn);
    else return;

    element.z = this._nextZ();
    this.sheetDraft.elements.push(element);
    this.selectedElementId = String(element.id || "") || null;

    this._commitSheetDraft("add-element");
    this._renderAll();
    this._setStatus(`${kind} added`);
  }

  _addImageElement() {
    if (!this.sheetDraft) return;
    this._fileImageInsertPending = true;
    this._fileInput.value = "";
    this._fileInput.click();
  }

  _onImageFileChosen(input) {
    if (!this._fileImageInsertPending) return;
    this._fileImageInsertPending = false;

    const file = input?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (!src || !this.sheetDraft) return;

      const finalizeInsert = (widthIn = 3.2, heightIn = 2.0) => {
        this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];
        const xIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (widthIn * 0.5));
        const yIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (heightIn * 0.5));

        const image = defaultImageElement(xIn, yIn, src);
        image.w = widthIn;
        image.h = heightIn;
        image.z = this._nextZ();
        this.sheetDraft.elements.push(image);
        this.selectedElementId = image.id;

        this._commitSheetDraft("add-image");
        this._renderAll();
        this._setStatus("Image added");
      };

      const probe = new Image();
      probe.onload = () => {
        this._rememberMediaMetadata(src, probe.naturalWidth, probe.naturalHeight);
        const aspect = Math.max(1e-6, toFiniteNumber(probe.naturalWidth, 1) / Math.max(1, toFiniteNumber(probe.naturalHeight, 1)));
        let widthIn = 3.2;
        let heightIn = widthIn / aspect;
        if (heightIn > 2.4) {
          heightIn = 2.4;
          widthIn = heightIn * aspect;
        }
        finalizeInsert(widthIn, heightIn);
      };
      probe.onerror = () => finalizeInsert();
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  _insertPmiView(viewIndex) {
    if (!this.sheetDraft) return;

    const idx = Number(viewIndex);
    const view = Number.isInteger(idx) && idx >= 0 ? this._pmiViews[idx] : null;
    if (!view) {
      this._setStatus("No PMI view selected");
      return;
    }
    const viewName = String(view?.viewName || view?.name || "PMI View");

    this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];

    const ppi = this._pxPerIn();
    const xIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (180 / ppi));
    const yIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (120 / ppi));

    const inset = defaultPmiInsetElement(xIn, yIn, idx, viewName);
    inset.z = this._nextZ();
    this.sheetDraft.elements.push(inset);
    this.selectedElementId = inset.id;

    this._commitSheetDraft("add-pmi-inset");
    this._renderAll();
    this._setStatus("PMI view inserted");
  }

  _setSelectedCropField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsMediaCrop(element)) return;

    if (key === "mediaScale") {
      element.mediaScale = clamp(toFiniteNumber(rawValue, 100) / 100, 1, 10);
    } else if (key === "mediaOffsetX" || key === "mediaOffsetY") {
      element[key] = clamp(toFiniteNumber(rawValue, 0) / 100, -1, 1);
    }

    this._commitSheetDraft(`crop-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _resetSelectedCrop() {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsMediaCrop(element)) return;
    const snapshot = this._getMediaInteractionSnapshot(element);
    if (snapshot?.mediaRect) {
      this._applyMediaCropStateFromRect(element, {
        x: snapshot.mediaRect.x,
        y: snapshot.mediaRect.y,
        w: snapshot.mediaRect.w,
        h: snapshot.mediaRect.h,
      }, snapshot.mediaRect, snapshot.metadata);
    } else {
      element.mediaScale = 1;
      element.mediaOffsetX = 0;
      element.mediaOffsetY = 0;
    }
    this._commitSheetDraft("crop-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _setSelectedPMIField(key, value) {
    const element = this._getSelectedElement();
    if (!element || element.type !== "pmiInset") return;
    if (key === "showTitle") {
      element.showTitle = value !== false;
    } else if (key === "showBackground") {
      element.fill = value ? normalizeHex(element.fill, "#ffffff") : "transparent";
    } else if (key === "backgroundColor") {
      element.fill = String(value || "#ffffff");
    }
    this._commitSheetDraft(`pmi-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _resetSelectedPMIBackground() {
    const element = this._getSelectedElement();
    if (!element || element.type !== "pmiInset") return;
    element.fill = "transparent";
    this._commitSheetDraft("pmi-background-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _reorderSelectedToEdge(edge) {
    const selectedId = String(this.selectedElementId || "");
    if (!selectedId || !this.sheetDraft || !Array.isArray(this.sheetDraft.elements)) return;

    const ordered = sortElements(this.sheetDraft.elements || []);
    const selected = ordered.find((entry) => String(entry?.id || "") === selectedId);
    if (!selected) return;
    if (edge === "back" && ordered[0] === selected) return;
    if (edge !== "back" && ordered[ordered.length - 1] === selected) return;

    const others = ordered.filter((entry) => String(entry?.id || "") !== selectedId);
    const nextOrder = edge === "back"
      ? [selected, ...others]
      : [...others, selected];

    nextOrder.forEach((entry, index) => {
      entry.z = index;
    });
    this.sheetDraft.elements = nextOrder;

    this._commitSheetDraft(edge === "back" ? "send-to-back" : "bring-to-front");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
    this._setStatus(edge === "back" ? "Sent to back" : "Brought to front");
  }

  _bringSelectedToFront() {
    this._reorderSelectedToEdge("front");
  }

  _sendSelectedToBack() {
    this._reorderSelectedToEdge("back");
  }

  _adjustZ(delta) {
    const element = this._getSelectedElement();
    if (!element) return;
    element.z = Math.round(toFiniteNumber(element.z, 0) + toFiniteNumber(delta, 0));
    this._commitSheetDraft("adjust-z");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _duplicateSelectedElement() {
    const element = this._getSelectedElement();
    if (!element || !this.sheetDraft) return;

    const clone = deepClone(element);
    clone.id = uid("el");
    clone.z = this._nextZ();

    const offset = 24 / this._pxPerIn();
    if (clone.type === "line") {
      clone.x = toFiniteNumber(clone.x, 0) + offset;
      clone.y = toFiniteNumber(clone.y, 0) + offset;
      clone.x2 = toFiniteNumber(clone.x2, clone.x) + offset;
      clone.y2 = toFiniteNumber(clone.y2, clone.y) + offset;
    } else {
      clone.x = toFiniteNumber(clone.x, 0) + offset;
      clone.y = toFiniteNumber(clone.y, 0) + offset;
    }

    this.sheetDraft.elements.push(clone);
    this.selectedElementId = clone.id;

    this._commitSheetDraft("duplicate-element");
    this._renderAll();
    this._setStatus("Element duplicated");
  }

  _deleteSelectedElement() {
    if (!this.sheetDraft || !this.selectedElementId) return;

    const before = this.sheetDraft.elements?.length || 0;
    this.sheetDraft.elements = (this.sheetDraft.elements || []).filter(
      (item) => String(item?.id || "") !== String(this.selectedElementId || ""),
    );
    if ((this.sheetDraft.elements?.length || 0) === before) return;

    this._hideContextMenu();
    if (this._isCropModeForElement(this.selectedElementId)) {
      this._cropModeElementId = null;
    }
    this.selectedElementId = null;
    this._commitSheetDraft("delete-element");
    this._renderAll();
    this._setStatus("Element deleted");
  }

  _getElementById(elementId) {
    const id = String(elementId || "").trim();
    if (!id || !this.sheetDraft || !Array.isArray(this.sheetDraft.elements)) return null;
    return this.sheetDraft.elements.find((item) => String(item?.id || "") === id) || null;
  }

  _getSelectedElement() {
    return this._getElementById(this.selectedElementId);
  }

  _nextZ() {
    const elements = Array.isArray(this.sheetDraft?.elements) ? this.sheetDraft.elements : [];
    return Math.max(0, ...elements.map((entry) => toFiniteNumber(entry?.z, 0))) + 1;
  }

  _commitSheetDraft(reason = "edit") {
    void reason;
    if (!this.sheetDraft?.id) return;
    const manager = this._getManager();
    if (!manager?.updateSheet) return;

    this._isCommitting = true;
    try {
      manager.updateSheet(this.sheetDraft.id, this.sheetDraft);
      const latest = manager.getSheetById?.(this.sheetDraft.id);
      if (latest) this.sheetDraft = deepClone(latest);
    } finally {
      this._isCommitting = false;
    }
  }

  _eventToSlidePoint(event, rect) {
    const zoom = this._getStageZoom();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  }

  _pxPerIn() {
    return Math.max(1, toFiniteNumber(this.sheetDraft?.pxPerInch, 96));
  }

  _setStatus(message) {
    if (this._statusLeft) {
      this._statusLeft.textContent = String(message || "");
    }
  }

  _placeCaretAtEnd(node) {
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch { }
  }

  _ensureStyles() {
    if (document.getElementById("sheet-slides-editor-styles")) return;

    const style = document.createElement("style");
    style.id = "sheet-slides-editor-styles";
    style.textContent = `
      .sheet-slides-root {
        width: 100%;
        height: 100%;
        min-height: 0;
        position: relative;
        display: grid;
        grid-template-columns: 260px 1fr 320px;
        grid-template-rows: 56px 1fr 30px;
        grid-template-areas:
          "topbar topbar topbar"
          "sidebar stage inspector"
          "status status status";
        color: #e8ecf3;
        background: #0f1115;
      }
      .sheet-slides-topbar {
        grid-area: topbar;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid #30384d;
        background: linear-gradient(180deg, #151926, #111520);
      }
      .sheet-slides-brand {
        font-weight: 700;
        white-space: nowrap;
        margin-right: 6px;
        letter-spacing: .02em;
      }
      .sheet-slides-toolbar-group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-right: 4px;
        padding-right: 10px;
        border-right: 1px solid #30384d;
      }
      .sheet-slides-toolbar-group.no-divider {
        border-right: 0;
      }
      .sheet-slides-btn,
      .sheet-slides-control {
        height: 32px;
        border-radius: 8px;
        border: 1px solid #30384d;
        background: #1b2130;
        color: #e8ecf3;
        outline: none;
      }
      .sheet-slides-btn {
        padding: 0 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .sheet-slides-btn:hover,
      .sheet-slides-control:hover {
        border-color: #46516d;
      }
      .sheet-slides-btn.primary {
        border-color: #2d73ff;
        background: linear-gradient(180deg, #2d73ff, #2158c5);
        color: #fff;
      }
      .sheet-slides-btn.danger {
        border-color: #7f1d1d;
        color: #fecaca;
      }
      .sheet-slides-btn.small {
        flex: 1 1 auto;
      }
      .sheet-slides-control {
        padding: 0 8px;
      }
      .sheet-slides-hidden { display: none !important; }

      .sheet-slides-sidebar {
        grid-area: sidebar;
        border-right: 1px solid #30384d;
        background: #161a22;
        overflow: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .sheet-slides-sidebar-header,
      .sheet-slides-inspector-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .sheet-slides-muted {
        color: #98a2b3;
        font-size: 12px;
      }
      .sheet-slides-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1 1 auto;
        min-height: 0;
      }
      .sheet-slides-thumb {
        border: 1px solid #30384d;
        border-radius: 12px;
        background: #1b2130;
        padding: 8px;
        cursor: pointer;
        position: relative;
      }
      .sheet-slides-thumb:focus-visible {
        outline: 2px solid rgba(96,165,250,.9);
        outline-offset: 2px;
      }
      .sheet-slides-thumb.active {
        border-color: #6ea8fe;
        box-shadow: 0 0 0 1px rgba(110,168,254,.28);
      }
      .sheet-slides-thumb-phantom {
        border-style: dashed;
        background:
          linear-gradient(180deg, rgba(37,99,235,.08), rgba(15,23,42,.22)),
          #1b2130;
      }
      .sheet-slides-thumb-phantom:hover {
        border-color: #60a5fa;
        box-shadow: 0 0 0 1px rgba(96,165,250,.22);
      }
      .sheet-slides-thumb.is-dragging {
        opacity: .55;
      }
      .sheet-slides-thumb.is-drop-target {
        border-color: #60a5fa;
        box-shadow: 0 0 0 2px rgba(96,165,250,.22);
      }
      .sheet-slides-thumb-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 12px;
      }
      .sheet-slides-thumb-top-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .sheet-slides-thumb-top-text > span:first-child {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sheet-slides-thumb-menu-wrap {
        position: relative;
        flex: 0 0 auto;
      }
      .sheet-slides-thumb-menu-btn {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: 1px solid #30384d;
        background: #111827;
        color: #e8ecf3;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .sheet-slides-thumb-menu-btn:hover {
        border-color: #46516d;
      }
      .sheet-slides-thumb-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 146px;
        padding: 6px;
        border: 1px solid #30384d;
        border-radius: 10px;
        background: #0f1115;
        box-shadow: 0 16px 32px rgba(0,0,0,.38);
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 3;
      }
      .sheet-slides-thumb-menu-item {
        width: 100%;
        height: 32px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #e8ecf3;
        text-align: left;
        padding: 0 10px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
      }
      .sheet-slides-thumb-menu-item:hover {
        background: #1b2130;
      }
      .sheet-slides-thumb-menu-item.danger {
        color: #fecaca;
      }
      .sheet-slides-thumb-canvas {
        width: 100%;
        aspect-ratio: 4 / 3;
        border-radius: 8px;
        position: relative;
        overflow: hidden;
        background: #0f172a;
        display: grid;
        place-items: center;
      }
      .sheet-slides-thumb-canvas-phantom {
        border: 1px dashed rgba(148,163,184,.45);
        background:
          radial-gradient(circle at 50% 36%, rgba(96,165,250,.16), transparent 28%),
          linear-gradient(180deg, rgba(15,23,42,.24), rgba(15,23,42,.5));
        gap: 10px;
      }
      .sheet-slides-thumb-phantom-badge {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 28px;
        line-height: 1;
        color: #dbeafe;
        background: rgba(37,99,235,.2);
        border: 1px solid rgba(96,165,250,.45);
        box-shadow: 0 8px 22px rgba(0,0,0,.22);
      }
      .sheet-slides-thumb-phantom-label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .04em;
        color: #bfdbfe;
        text-transform: uppercase;
      }
      .sheet-slides-thumb-sheet {
        position: relative;
        transform-origin: top left;
        overflow: hidden;
        border-radius: 8px;
        box-shadow: 0 6px 18px rgba(0,0,0,.18);
      }
      .sheet-slides-thumb-element {
        position: absolute;
        overflow: hidden;
        white-space: pre-wrap;
        transform-origin: center center;
      }
      .sheet-slides-stage-wrap {
        grid-area: stage;
        overflow: auto;
        background: radial-gradient(circle at top, rgba(255,255,255,.04), transparent 30%), linear-gradient(180deg, #111520, #0c1018);
        padding: 24px;
      }
      .sheet-slides-stage-center {
        min-width: 100%;
        min-height: 100%;
        display: grid;
        place-items: center;
      }
      .sheet-slides-stage-shell {
        position: relative;
        display: inline-block;
        user-select: none;
      }
      .sheet-slides-canvas {
        position: relative;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,.45);
        transform-origin: top left;
      }
      .sheet-slides-grid {
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0;
        transition: opacity .12s ease;
        background-image:
          linear-gradient(to right, #000 1px, transparent 1px),
          linear-gradient(to bottom, #000 1px, transparent 1px);
        background-size: 40px 40px;
      }
      .sheet-slides-canvas.show-grid .sheet-slides-grid {
        opacity: .1;
      }

      .sheet-slides-element {
        position: absolute;
        transform-origin: center center;
        min-width: 10px;
        min-height: 10px;
      }
      .sheet-slides-element::after {
        content: "";
        position: absolute;
        inset: -1px;
        border: 2px solid transparent;
        pointer-events: none;
      }
      .sheet-slides-element.selected::after {
        border-color: #6ea8fe;
      }
      .sheet-slides-element-content {
        width: 100%;
        height: 100%;
        position: relative;
      }
      .sheet-slides-inline-text {
        width: 100%;
        height: 100%;
        position: relative;
        z-index: 1;
      }
      .sheet-slides-inline-text.editing {
        outline: 2px solid rgba(110,168,254,.75);
        outline-offset: -2px;
        background: rgba(255,255,255,.18);
      }
      .sheet-slides-shape-text {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sheet-slides-media-frame {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: inherit;
        cursor: default;
      }
      .sheet-slides-media-image {
        pointer-events: none;
        user-select: none;
      }
      .sheet-slides-element.crop-active .sheet-slides-media-frame,
      .sheet-slides-element.crop-active .sheet-slides-pmi-host {
        cursor: move;
      }
      .sheet-slides-crop-overlay {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        border: 1px solid #111827;
        box-sizing: border-box;
        z-index: 5;
        pointer-events: none;
      }
      .sheet-slides-crop-handle {
        position: absolute;
        background: #111827;
        border: 1px solid #fff;
        box-shadow: 0 1px 2px rgba(0,0,0,.3);
        z-index: 6;
        pointer-events: auto;
      }
      .sheet-slides-crop-handle.n,
      .sheet-slides-crop-handle.s {
        width: 16px;
        height: 8px;
        left: 50%;
        margin-left: -8px;
        cursor: ns-resize;
      }
      .sheet-slides-crop-handle.n { top: -5px; }
      .sheet-slides-crop-handle.s { bottom: -5px; }
      .sheet-slides-crop-handle.e,
      .sheet-slides-crop-handle.w {
        width: 8px;
        height: 16px;
        top: 50%;
        margin-top: -8px;
        cursor: ew-resize;
      }
      .sheet-slides-crop-handle.w { left: -5px; }
      .sheet-slides-crop-handle.e { right: -5px; }
      .sheet-slides-crop-handle.nw,
      .sheet-slides-crop-handle.ne,
      .sheet-slides-crop-handle.sw,
      .sheet-slides-crop-handle.se {
        width: 10px;
        height: 10px;
      }
      .sheet-slides-crop-handle.nw { left: -5px; top: -5px; cursor: nwse-resize; }
      .sheet-slides-crop-handle.ne { right: -5px; top: -5px; cursor: nesw-resize; }
      .sheet-slides-crop-handle.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
      .sheet-slides-crop-handle.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
      .sheet-slides-handle {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #6ea8fe;
        border: 2px solid #fff;
        border-radius: 999px;
        z-index: 4;
        box-shadow: 0 1px 3px rgba(0,0,0,.4);
      }
      .sheet-slides-handle.nw { left: -6px; top: -6px; cursor: nwse-resize; }
      .sheet-slides-handle.ne { right: -6px; top: -6px; cursor: nesw-resize; }
      .sheet-slides-handle.sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
      .sheet-slides-handle.se { right: -6px; bottom: -6px; cursor: nwse-resize; }
      .sheet-slides-rotate-line {
        position: absolute;
        width: 2px;
        height: 18px;
        top: -18px;
        left: 50%;
        transform: translateX(-1px);
        background: #6ea8fe;
      }
      .sheet-slides-rotate-handle {
        position: absolute;
        top: -34px;
        left: 50%;
        width: 14px;
        height: 14px;
        margin-left: -7px;
        border-radius: 999px;
        border: 2px solid #fff;
        background: #ffb86b;
        cursor: grab;
        box-shadow: 0 1px 3px rgba(0,0,0,.4);
      }
      .sheet-slides-context-menu {
        position: absolute;
        min-width: 168px;
        padding: 6px;
        border: 1px solid #30384d;
        border-radius: 10px;
        background: rgba(15,17,21,.98);
        box-shadow: 0 18px 40px rgba(0,0,0,.38);
        z-index: 80;
        gap: 4px;
      }
      .sheet-slides-context-menu-item {
        width: 100%;
        height: 34px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #e8ecf3;
        font: inherit;
        font-size: 13px;
        text-align: left;
        padding: 0 10px;
        cursor: pointer;
      }
      .sheet-slides-context-menu-item:hover {
        background: #1b2130;
      }
      .sheet-slides-modal-overlay {
        position: absolute;
        inset: 0;
        display: none;
        place-items: center;
        padding: 24px;
        background: rgba(5,8,14,.62);
        backdrop-filter: blur(3px);
        z-index: 90;
      }
      .sheet-slides-modal {
        width: min(980px, 100%);
        max-height: min(82vh, 760px);
        border: 1px solid #30384d;
        border-radius: 16px;
        background: linear-gradient(180deg, #151926, #10141e);
        box-shadow: 0 26px 60px rgba(0,0,0,.45);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .sheet-slides-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid #30384d;
      }
      .sheet-slides-modal-close {
        width: 34px;
        height: 34px;
        border: 1px solid #30384d;
        border-radius: 999px;
        background: #111827;
        color: #e8ecf3;
        cursor: pointer;
        font-size: 22px;
        line-height: 1;
      }
      .sheet-slides-modal-close:hover {
        border-color: #46516d;
      }
      .sheet-slides-pmi-picker-grid {
        padding: 16px;
        overflow: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
      }
      .sheet-slides-pmi-picker-card {
        border: 1px solid #30384d;
        border-radius: 14px;
        background: #1b2130;
        color: #e8ecf3;
        font: inherit;
        outline: none;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        cursor: pointer;
        text-align: left;
      }
      .sheet-slides-pmi-picker-card:hover {
        border-color: #60a5fa;
        box-shadow: 0 0 0 1px rgba(96,165,250,.18);
      }
      .sheet-slides-pmi-picker-preview {
        aspect-ratio: 4 / 3;
        border-radius: 10px;
        border: 1px solid #30384d;
        background:
          radial-gradient(circle at 50% 30%, rgba(96,165,250,.08), transparent 26%),
          linear-gradient(180deg, #0f172a, #111827);
        overflow: hidden;
        display: grid;
        place-items: center;
      }
      .sheet-slides-pmi-picker-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        background: transparent;
      }
      .sheet-slides-pmi-picker-placeholder,
      .sheet-slides-pmi-picker-empty {
        color: #98a2b3;
        font-size: 12px;
        text-align: center;
        line-height: 1.5;
      }
      .sheet-slides-pmi-picker-placeholder {
        padding: 14px;
      }
      .sheet-slides-pmi-picker-empty {
        min-height: 180px;
        display: grid;
        place-items: center;
        border: 1px dashed #30384d;
        border-radius: 14px;
        background: rgba(15,23,42,.3);
        grid-column: 1 / -1;
      }
      .sheet-slides-pmi-picker-title {
        font-size: 12px;
        font-weight: 700;
        color: #e5e7eb;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sheet-slides-pmi-host {
        position: absolute;
        left: 0;
        top: 0;
        right: 0;
        display: grid;
        place-items: center;
        min-height: 0;
        background: transparent;
        pointer-events: auto;
        overflow: hidden;
      }
      .sheet-slides-pmi-image {
        display: block;
        pointer-events: none;
      }
      .sheet-slides-pmi-body {
        display: block;
        position: relative;
      }
      .sheet-slides-pmi-placeholder {
        padding: 12px;
        text-align: center;
        color: #334155;
        font-size: 12px;
        font-weight: 600;
        pointer-events: none;
      }
      .sheet-slides-pmi-caption {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 8px;
        background: transparent;
        color: #334155;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        pointer-events: none;
      }

      .sheet-slides-inspector {
        grid-area: inspector;
        border-left: 1px solid #30384d;
        background: #161a22;
        overflow: auto;
        padding: 10px;
      }
      .sheet-slides-panel {
        border: 1px solid #30384d;
        border-radius: 12px;
        background: #1b2130;
        padding: 10px;
        margin-bottom: 10px;
      }
      .sheet-slides-panel h3 {
        margin: 0 0 8px;
        font-size: 12px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #98a2b3;
      }
      .sheet-slides-field {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      .sheet-slides-field:last-child {
        margin-bottom: 0;
      }
      .sheet-slides-readonly {
        min-height: 32px;
        display: flex;
        align-items: center;
        padding: 0 8px;
        border: 1px solid #30384d;
        border-radius: 8px;
        background: #0f1520;
        color: #e8ecf3;
      }
      .sheet-slides-checkbox {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
        color: #e8ecf3;
      }
      .sheet-slides-field-label {
        font-size: 12px;
        color: #98a2b3;
      }
      .sheet-slides-field textarea.sheet-slides-control {
        min-height: 64px;
        padding-top: 6px;
        padding-bottom: 6px;
      }
      .sheet-slides-color-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sheet-slides-crop-hint {
        margin-top: 8px;
        line-height: 1.5;
      }
      .sheet-slides-color-row .sheet-slides-control[type="color"] {
        flex: 0 0 52px;
        width: 52px;
        min-width: 52px;
        padding: 2px;
      }
      .sheet-slides-btn.color-reset {
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .sheet-slides-status {
        grid-area: status;
        border-top: 1px solid #30384d;
        background: #0d1119;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        font-size: 12px;
      }

      @media (max-width: 1200px) {
        .sheet-slides-root {
          grid-template-columns: 240px 1fr;
          grid-template-rows: 56px 1fr 1fr 30px;
          grid-template-areas:
            "topbar topbar"
            "sidebar stage"
            "inspector inspector"
            "status status";
        }
      }
      @media (max-width: 780px) {
        .sheet-slides-root {
          grid-template-columns: 1fr;
          grid-template-rows: 56px minmax(180px, 240px) 1fr minmax(240px, auto) 30px;
          grid-template-areas:
            "topbar"
            "sidebar"
            "stage"
            "inspector"
            "status";
        }
      }
    `;
    document.head.appendChild(style);
  }
}

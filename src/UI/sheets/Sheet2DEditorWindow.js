import brepHomeBannerUrl from "../../assets/brand/brep-home-banner.svg";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { listSheetSizes } from "../../sheets/sheetStandards.js";
import {
  buildWireHarnessFormboardModel,
  collectWireHarnessFormboardSegmentBranchNodeIds,
  isWireHarnessFormboardElement,
} from "../../wireHarness/wireHarnessFormboard.js";
import {
  DEFAULT_IMAGE_INSERT_HEIGHT_IN,
  DEFAULT_IMAGE_INSERT_WIDTH_IN,
  getDefaultPlacedImageSizeIn,
  resolveClipboardImageSource,
} from "./sheetMediaUtils.js";
import {
  canMergeTableCells,
  cloneTableData,
  createTableData,
  ensureTableSize,
  getTableCell,
  getTableColumnCount,
  getTableRowCount,
  getTableSelectionRect,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  normalizeTableData,
  normalizeTableCellStyle,
  resolveTableCellAnchor,
  setTableCellText,
  unmergeTableCell,
} from "../../sheets/tableUtils.js";

const DEFAULT_SHEET_SIZE_KEY = "A";
const DEFAULT_SHEET_ORIENTATION = "landscape";
const DEFAULT_ZOOM = 1;
const MIN_STAGE_ZOOM = 0.01;
const MAX_STAGE_ZOOM = 10;
const POINTS_PER_INCH = 72;
const PDF_TARGET_DPI = 300;
const PMI_TITLE_FONT_SIZE_PT = 10;
const PMI_TITLE_PAD_X_PT = 6;
const MIN_ELEMENT_IN = 0.05;
const MIN_MEDIA_SCALE = 1;
const MAX_MEDIA_SCALE = 10;
const PMI_TITLE_HEIGHT_IN = 0.3;
const STAGE_VIEWPORT_PADDING_PX = 10;
const FIT_VIEWPORT_PADDING_PX = 6;
const FIT_SAFETY_INSET_PX = 2;
const STROKE_WIDTH_OPTIONS_PT = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];
const TABLE_DEFAULT_ROWS = 3;
const TABLE_DEFAULT_COLS = 4;
const TABLE_DEFAULT_COL_WIDTH_IN = 1.05;
const TABLE_DEFAULT_ROW_HEIGHT_IN = 0.42;
const TABLE_MIN_COL_WIDTH_PX = 40;
const TABLE_CELL_PADDING_PX = 6;
const SHEET_OBJECT_CLIPBOARD_MIME = "application/x-brep-sheet-elements+json";
const SHEET_OBJECT_CLIPBOARD_TEXT = "BREP.io sheet objects";
const MIN_CUSTOM_SHEET_SIZE_IN = 1;
const LINE_STYLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "dotted", label: "Dotted" },
  { value: "dashed", label: "Dashed" },
  { value: "dashDot", label: "Dash Dot" },
  { value: "longDash", label: "Long Dash" },
  { value: "dashDotDot", label: "Dash Dot Dot" },
];
const PMI_ANCHOR_OPTIONS = [
  { value: "nw", label: "Top Left" },
  { value: "n", label: "Top" },
  { value: "ne", label: "Top Right" },
  { value: "w", label: "Left" },
  { value: "c", label: "Center" },
  { value: "e", label: "Right" },
  { value: "sw", label: "Bottom Left" },
  { value: "s", label: "Bottom" },
  { value: "se", label: "Bottom Right" },
];
const PMI_LABEL_POSITION_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "none", label: "None" },
];
const PMI_RENDER_MODE_OPTIONS = [
  { value: "shaded", label: "Shaded" },
  { value: "monochrome", label: "Monochrome" },
];
const TOOLBAR_COLOR_SWATCHS = ["#111111", "#ffffff", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

function iconSvg(content, { viewBox = "0 0 24 24" } = {}) {
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${content}</svg>`;
}

function inchesToPoints(value) {
  return toFiniteNumber(value, 0) * POINTS_PER_INCH;
}

function pointsToInches(value) {
  return toFiniteNumber(value, 0) / POINTS_PER_INCH;
}

function formatPointValue(value) {
  const rounded = Math.round(toFiniteNumber(value, 0) * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

function normalizePmiRenderMode(value, fallback = "shaded") {
  const key = String(value || fallback).trim().toLowerCase();
  return ["shaded", "monochrome"].includes(key) ? key : fallback;
}

const TOOLBAR_ICON_SVGS = {
  addText: iconSvg(`
    <path d="M6 7h12M12 7v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 17h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  addShapes: iconSvg(`
    <rect x="4.5" y="5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="17" cy="8.5" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M14.2 17.8l3.1-5.3 3.1 5.3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  addImage: iconSvg(`
    <rect x="4.5" y="5" width="15" height="14" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
    <path d="M6.2 17l4.1-4 2.4 2.3 3.6-4.2 2.2 5.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  addPmi: iconSvg(`
    <path d="M12 4.8l6.6 3.6v7.2L12 19.2 5.4 15.6V8.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 4.8v7.2m0 0 6.6-3.6M12 12l-6.6-3.6M12 12v7.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  addTable: iconSvg(`
    <rect x="4.5" y="5.5" width="15" height="13" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M4.5 10.2h15M4.5 14.1h15M9.5 5.5v13M14.5 5.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  `),
  chevronDown: iconSvg(`
    <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  shapeRect: iconSvg(`
    <rect x="4.5" y="6" width="15" height="12" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
  `),
  shapeRoundRect: iconSvg(`
    <rect x="4.5" y="6" width="15" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
  `),
  shapeEllipse: iconSvg(`
    <ellipse cx="12" cy="12" rx="7.5" ry="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
  `),
  shapeTriangle: iconSvg(`
    <path d="M12 5.5l7 13H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  shapeDiamond: iconSvg(`
    <path d="M12 4.8l7.2 7.2-7.2 7.2-7.2-7.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  shapePentagon: iconSvg(`
    <path d="M12 4.8l6.6 4.8-2.5 8-8.2.1-2.5-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  shapeHexagon: iconSvg(`
    <path d="M8 5.2h8l4 6.8-4 6.8H8L4 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  shapeParallelogram: iconSvg(`
    <path d="M8 5.5h10l-2 13H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  shapeTrapezoid: iconSvg(`
    <path d="M8 5.5h8l3 13H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  fillColor: iconSvg(`
    <path d="M7 13l6-6 4 4-6 6H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M15.5 4.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M18.2 17.2c1.2 0 2.2.9 2.2 2.1 0 1.3-1 2.2-2.2 2.2-1.3 0-2.2-.9-2.2-2.2 0-.5.2-1 .5-1.4l1.7-2.2 1.7 2.2c.2.4.3.8.3 1.3z" fill="currentColor"/>
  `),
  strokeColor: iconSvg(`
    <path d="M6 17l7.8-7.8 4 4L10 21H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M13 6l2-2 5 5-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  `),
  textColor: iconSvg(`
    <path d="M8 17l3.7-10h.6L16 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9.4 13h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5.5 20.25h13" fill="none" stroke="#ec4899" stroke-width="2.6" stroke-linecap="round"/>
  `),
  lineWeight: iconSvg(`
    <path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M4 17h16" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"/>
  `),
  lineStyle: iconSvg(`
    <path d="M4 7h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.2 2.6"/>
    <path d="M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="6 2.6"/>
  `),
  bold: iconSvg(`
    <text x="12" y="17" text-anchor="middle" font-size="16" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="currentColor">B</text>
  `),
  italic: iconSvg(`
    <text x="12" y="17" text-anchor="middle" font-size="16" font-style="italic" font-family="Georgia, serif" fill="currentColor">I</text>
  `),
  underline: iconSvg(`
    <text x="12" y="16.5" text-anchor="middle" font-size="15" font-family="Arial, Helvetica, sans-serif" fill="currentColor">U</text>
    <path d="M6.5 20h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  textAlignMenu: iconSvg(`
    <path d="M7 7h10M9 11h6M7 15h10M8 19h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M4 5.5v13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
    <path d="M20 5.5v13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
  `),
  alignLeft: iconSvg(`
    <path d="M5 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 7h10M8 11h7M8 15h10M8 19h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  alignCenter: iconSvg(`
    <path d="M7 7h10M8.5 11h7M7 15h10M9 19h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  alignRight: iconSvg(`
    <path d="M19 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M6 7h10M9 11h7M6 15h10M8 19h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  valignTop: iconSvg(`
    <path d="M5 5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M7 9h10M8.5 13h7M7 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
  valignMiddle: iconSvg(`
    <path d="M7 8h10M8.5 12h7M7 16h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 2.4"/>
  `),
  valignBottom: iconSvg(`
    <path d="M7 7h10M8.5 11h7M7 15h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `),
};

const SHAPE_INSERT_OPTIONS = [
  { kind: "rect", label: "Rectangle", iconKey: "shapeRect" },
  { kind: "roundedRect", label: "Rounded Rect", iconKey: "shapeRoundRect" },
  { kind: "ellipse", label: "Ellipse", iconKey: "shapeEllipse" },
  { kind: "triangle", label: "Triangle", iconKey: "shapeTriangle" },
  { kind: "diamond", label: "Diamond", iconKey: "shapeDiamond" },
  { kind: "pentagon", label: "Pentagon", iconKey: "shapePentagon" },
  { kind: "hexagon", label: "Hexagon", iconKey: "shapeHexagon" },
  { kind: "parallelogram", label: "Parallelogram", iconKey: "shapeParallelogram" },
  { kind: "trapezoid", label: "Trapezoid", iconKey: "shapeTrapezoid" },
];
const MAX_SHAPE_ADJUST_RATIO = 0.45;

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

function isShapeElementType(type) {
  return ["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "parallelogram", "trapezoid"].includes(String(type || ""));
}

function shapeSupportsAdjustHandle(type) {
  return ["parallelogram", "trapezoid"].includes(String(type || ""));
}

function getDefaultShapeAdjust(type) {
  return shapeSupportsAdjustHandle(type) ? 0.18 : 0;
}

function clampShapeAdjust(type, value) {
  return shapeSupportsAdjustHandle(type)
    ? clamp(toFiniteNumber(value, getDefaultShapeAdjust(type)), 0, MAX_SHAPE_ADJUST_RATIO)
    : 0;
}

function getShapePalette(type) {
  switch (String(type || "")) {
    case "ellipse":
      return { fill: "#ffd166", stroke: "#c78c00" };
    case "triangle":
      return { fill: "#86efac", stroke: "#15803d" };
    case "diamond":
      return { fill: "#f9a8d4", stroke: "#be185d" };
    case "pentagon":
      return { fill: "#fca5a5", stroke: "#b91c1c" };
    case "hexagon":
      return { fill: "#c4b5fd", stroke: "#6d28d9" };
    case "parallelogram":
      return { fill: "#fdba74", stroke: "#c2410c" };
    case "trapezoid":
      return { fill: "#93c5fd", stroke: "#1d4ed8" };
    default:
      return { fill: "#8bc4ff", stroke: "#1d4ed8" };
  }
}

function createShapeElement(type, xIn, yIn, {
  w = 2.2,
  h = 1.4,
  cornerRadius = 0,
  shapeAdjust = undefined,
} = {}) {
  const palette = getShapePalette(type);
  return {
    id: uid("el"),
    type: String(type || "rect"),
    x: xIn,
    y: yIn,
    w,
    h,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: palette.fill,
    stroke: palette.stroke,
    strokeWidth: 0.01,
    lineStyle: "solid",
    cornerRadius,
    shapeAdjust: clampShapeAdjust(type, shapeAdjust),
    text: "",
    fontSize: 0.28,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "600",
    fontStyle: "normal",
    textDecoration: "none",
    textAlign: "center",
    verticalAlign: "middle",
    color: "#0f172a",
  };
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
    lineStyle: "solid",
    text: "Double-click to edit",
    fontSize: 0.34,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
    textAlign: "left",
    verticalAlign: "top",
    color: "#111111",
    strokeEnabled: false,
  };
}

function defaultRectElement(xIn, yIn) {
  return createShapeElement("rect", xIn, yIn, { w: 2.2, h: 1.4, cornerRadius: 0.08 });
}

function defaultEllipseElement(xIn, yIn) {
  return createShapeElement("ellipse", xIn, yIn, { w: 2.0, h: 1.25 });
}

function defaultTriangleElement(xIn, yIn) {
  return createShapeElement("triangle", xIn, yIn, { w: 2.0, h: 1.7 });
}

function defaultDiamondElement(xIn, yIn) {
  return createShapeElement("diamond", xIn, yIn, { w: 1.9, h: 1.9 });
}

function defaultPentagonElement(xIn, yIn) {
  return createShapeElement("pentagon", xIn, yIn, { w: 2.0, h: 1.9 });
}

function defaultHexagonElement(xIn, yIn) {
  return createShapeElement("hexagon", xIn, yIn, { w: 2.2, h: 1.6 });
}

function defaultParallelogramElement(xIn, yIn) {
  return createShapeElement("parallelogram", xIn, yIn, { w: 2.2, h: 1.4, shapeAdjust: 0.18 });
}

function defaultTrapezoidElement(xIn, yIn) {
  return createShapeElement("trapezoid", xIn, yIn, { w: 2.2, h: 1.4, shapeAdjust: 0.18 });
}

function defaultImageElement(xIn, yIn, src = "") {
  return {
    id: uid("el"),
    type: "image",
    x: xIn,
    y: yIn,
    w: DEFAULT_IMAGE_INSERT_WIDTH_IN,
    h: DEFAULT_IMAGE_INSERT_HEIGHT_IN,
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "#ffffff",
    stroke: "#94a3b8",
    strokeWidth: 0.01,
    lineStyle: "solid",
    src: String(src || ""),
    mediaScale: 1,
    mediaOffsetX: 0,
    mediaOffsetY: 0,
  };
}

function defaultTableElement(xIn, yIn, tableData = createTableData(TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS)) {
  const normalized = normalizeTableData(tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
  const rowCount = Math.max(1, getTableRowCount(normalized, TABLE_DEFAULT_ROWS));
  const colCount = Math.max(1, getTableColumnCount(normalized, TABLE_DEFAULT_COLS));
  return {
    id: uid("el"),
    type: "table",
    x: xIn,
    y: yIn,
    w: Math.max(2.8, colCount * TABLE_DEFAULT_COL_WIDTH_IN),
    h: Math.max(1.2, rowCount * TABLE_DEFAULT_ROW_HEIGHT_IN),
    rotationDeg: 0,
    z: 1,
    opacity: 1,
    fill: "#ffffff",
    stroke: "#0f172a",
    strokeWidth: 0.01,
    lineStyle: "solid",
    tableData: normalized,
    fontSize: 0.22,
    fontFamily: "Arial, Helvetica, sans-serif",
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
    textAlign: "left",
    verticalAlign: "middle",
    color: "#111111",
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
    lineStyle: "solid",
    pmiViewIndex: Number.isInteger(pmiViewIndex) ? pmiViewIndex : -1,
    pmiViewName: String(pmiViewName || "PMI View"),
    showTitle: true,
    pmiLabelPosition: "bottom",
    mediaScale: 1,
    mediaOffsetX: 0,
    mediaOffsetY: 0,
    pmiImageRevision: 0,
    pmiModelRevision: -1,
    pmiImageCaptureKey: "",
    pmiRenderMode: "shaded",
    pmiShowCenterLines: false,
    pmiAnchor: "c",
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

let PDF_COLOR_PARSE_CONTEXT = null;

function getPdfColorComponents(value, fallback = "#000000") {
  const raw = toCssColor(value, fallback);
  if (isTransparentColor(raw)) return null;
  const hex = normalizeHex(raw, "");
  if (hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  const rgbMatch = String(raw).match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return parts.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255));
    }
  }
  if (typeof document !== "undefined") {
    try {
      PDF_COLOR_PARSE_CONTEXT = PDF_COLOR_PARSE_CONTEXT || document.createElement("canvas").getContext("2d");
      if (PDF_COLOR_PARSE_CONTEXT) {
        PDF_COLOR_PARSE_CONTEXT.fillStyle = "#000000";
        PDF_COLOR_PARSE_CONTEXT.fillStyle = raw;
        const resolved = String(PDF_COLOR_PARSE_CONTEXT.fillStyle || "");
        const resolvedHex = normalizeHex(resolved, "");
        if (resolvedHex) {
          return [
            parseInt(resolvedHex.slice(1, 3), 16),
            parseInt(resolvedHex.slice(3, 5), 16),
            parseInt(resolvedHex.slice(5, 7), 16),
          ];
        }
        const resolvedRgb = resolved.match(/^rgba?\(([^)]+)\)$/i);
        if (resolvedRgb) {
          const parts = resolvedRgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
          if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
            return parts.slice(0, 3).map((part) => clamp(Math.round(part), 0, 255));
          }
        }
      }
    } catch { /* ignore color parser failures */ }
  }
  return [0, 0, 0];
}

function rotatePoint(x, y, cx, cy, degrees) {
  const angle = (toFiniteNumber(degrees, 0) * Math.PI) / 180;
  if (Math.abs(angle) <= 1e-9) return { x, y };
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cx + (dx * cos) - (dy * sin),
    y: cy + (dx * sin) + (dy * cos),
  };
}

function makeRotatedRectPoints(x, y, w, h, rotationDeg = 0) {
  const cx = x + (w * 0.5);
  const cy = y + (h * 0.5);
  return [
    rotatePoint(x, y, cx, cy, rotationDeg),
    rotatePoint(x + w, y, cx, cy, rotationDeg),
    rotatePoint(x + w, y + h, cx, cy, rotationDeg),
    rotatePoint(x, y + h, cx, cy, rotationDeg),
  ];
}

function elementSupportsText(element) {
  const type = String(element?.type || "");
  return type === "text" || isShapeElementType(type) || type === "table";
}

function isTableElementType(element) {
  return String(element?.type || "") === "table";
}

function elementSupportsMediaCrop(element) {
  const type = String(element?.type || "");
  return type === "image";
}

function elementUsesLockedAspectMedia(element) {
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

let sheetObjectClipboardPayload = null;

export class Sheet2DEditorWindow {
  constructor(viewer) {
    this.viewer = viewer || null;

    this.overlay = null;
    this.root = null;
    this._previousBodyOverflow = "";

    this.sheetId = null;
    this.sheetDraft = null;
    this.selectedElementId = null;
    this._selectedElementIds = [];
    this._editingGroupId = "";
    this._cropModeElementId = null;
    this._selectedFormboardPivot = null;

    this.zoom = DEFAULT_ZOOM;
    this._appliedZoom = DEFAULT_ZOOM;
    this._zoomMode = "fit";
    this._stagePanX = 0;
    this._stagePanY = 0;
    this._appliedStagePanX = 0;
    this._appliedStagePanY = 0;
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
    this._pdfImageLoadCache = new Map();
    this._stageResizeObserver = null;
    this._isExportingPdf = false;

    this._contextMenu = null;
    this._contextMenuState = null;
    this._toolbarPopover = null;
    this._toolbarPopoverKind = "";
    this._toolbarPopoverAnchor = null;
    this._tableSelection = null;
    this._tableTextScope = "cell";
    this._boundPointerMove = (event) => this._onGlobalPointerMove(event);
    this._boundPointerUp = (event) => this._onGlobalPointerUp(event);
    this._boundGlobalPointerDown = (event) => this._onGlobalPointerDown(event);
    this._boundKeyDown = (event) => this._onKeyDown(event);
    this._boundCopy = (event) => this._onCopy(event);
    this._boundPaste = (event) => this._onPaste(event);
  }

  open(sheetId = null) {
    this._ensureWindow();
    if (!this.root) return;

    if (this.overlay && !document.body.contains(this.overlay)) {
      document.body.appendChild(this.overlay);
    }
    try {
      this._previousBodyOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
    } catch { }
    if (this.overlay) this.overlay.style.display = "block";
    this.root.style.display = "grid";

    this._bindGlobalEvents();
    this._bindManagerListeners();
    try { if (this.viewer) this.viewer._sheet2DEditorActive = true; } catch { }

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
    this._editingGroupId = "";
    this._cropModeElementId = null;
    this._closePmiPicker();
    this._hideContextMenu();
    this._closeToolbarPopover();
    this.root.style.display = "none";
    if (this.overlay) this.overlay.style.display = "none";
    this._unbindGlobalEvents();
    this._unbindManagerListeners();
    this._disposeUnusedPmiViewports(new Set());
    try { if (this.viewer) this.viewer._sheet2DEditorActive = false; } catch { }
    try {
      document.body.style.overflow = this._previousBodyOverflow || "";
    } catch { }
  }

  dispose() {
    this._endDrag(false);
    this._editingGroupId = "";
    this._cropModeElementId = null;
    this._closePmiPicker();
    this._hideContextMenu();
    this._closeToolbarPopover();
    this._unbindGlobalEvents();
    this._unbindManagerListeners();
    this._disposeAllPmiViewports();
    try { this._stageResizeObserver?.disconnect?.(); } catch { }
    this._stageResizeObserver = null;
    try {
      if (this.overlay?.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
    } catch { }
    this.overlay = null;
    this.root = null;
    try { if (this.viewer) this.viewer._sheet2DEditorActive = false; } catch { }
    try {
      document.body.style.overflow = this._previousBodyOverflow || "";
    } catch { }
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
      this._clearSelection();
      this._renderAll();
      return;
    }

    if (!this.sheetId || !manager.getSheetById?.(this.sheetId)) {
      this.sheetId = String(sheets[0]?.id || "") || null;
    }

    const current = this.sheetId ? manager.getSheetById?.(this.sheetId) : null;
    if (!current) {
      this.sheetDraft = null;
      this._clearSelection();
      this._renderAll();
      return;
    }

    this.sheetDraft = deepClone(current);

    this._setSelectedElementIds(this._getSelectedElementIds(), this.selectedElementId);
    this._getActiveEditingGroupId();
    this._syncTableInteractionState();

    this._renderAll();

    if (this._sheetHasStaleModelPmiInsets()) {
      void this._refreshAllPmiInsetImages();
    }
  }

  _getManager() {
    return this.viewer?.partHistory?.sheet2DManager || null;
  }

  async _triggerMainToolbarSave() {
    const saveRecord = this.viewer?.mainToolbar?._buttonRecords?.get?.("save") || null;
    const saveHandler = typeof saveRecord?.onClick === "function"
      ? saveRecord.onClick
      : (typeof saveRecord?.btn?.__mtbOnClick === "function" ? saveRecord.btn.__mtbOnClick : null);
    if (saveHandler) {
      await saveHandler();
      return true;
    }

    try {
      if (typeof this.viewer?.fileManagerWidget?.saveCurrent === "function") {
        await this.viewer.fileManagerWidget.saveCurrent();
        return true;
      }
    } catch { }

    this._setStatus("Save unavailable");
    return false;
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
    window.addEventListener("copy", this._boundCopy, true);
    window.addEventListener("paste", this._boundPaste, true);
  }

  _unbindGlobalEvents() {
    window.removeEventListener("pointerdown", this._boundGlobalPointerDown, true);
    window.removeEventListener("pointermove", this._boundPointerMove, true);
    window.removeEventListener("pointerup", this._boundPointerUp, true);
    window.removeEventListener("keydown", this._boundKeyDown, true);
    window.removeEventListener("copy", this._boundCopy, true);
    window.removeEventListener("paste", this._boundPaste, true);
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
    return this._clampStageZoom(this._appliedZoom, this.zoom);
  }

  _clampStageZoom(value, fallback = DEFAULT_ZOOM) {
    return clamp(toFiniteNumber(value, fallback), MIN_STAGE_ZOOM, MAX_STAGE_ZOOM);
  }

  _getStageRenderPpi(zoom = this._getStageZoom()) {
    return Math.max(1, this._pxPerIn() * this._clampStageZoom(zoom, DEFAULT_ZOOM));
  }

  _getLineRenderMetrics(element, ppi, { interactive = false } = {}) {
    const baseStrokePx = Math.max(0, toFiniteNumber(element?.strokeWidth, 0.02) * ppi);
    const exactFormboard = this._isFormboardElement(element);
    const paintHeightPx = exactFormboard
      ? Math.max(0.4, baseStrokePx)
      : Math.max(1, baseStrokePx);
    const hitHeightPx = interactive
      ? Math.max(1, paintHeightPx)
      : paintHeightPx;
    return {
      paintHeightPx,
      hitHeightPx,
      contentOffsetPx: Math.max(0, (hitHeightPx - paintHeightPx) * 0.5),
    };
  }

  _getSelectionUiScale(zoom = this._getStageZoom()) {
    const normalizedZoom = Math.max(1, this._clampStageZoom(zoom, DEFAULT_ZOOM));
    return clamp(1 + (Math.log2(normalizedZoom) * 0.18), 1, 1.55);
  }

  _getStageViewportMetrics() {
    const viewport = this._stageCenter || this._stageWrap || null;
    return {
      width: Math.max(1, toFiniteNumber(viewport?.clientWidth, 0)),
      height: Math.max(1, toFiniteNumber(viewport?.clientHeight, 0)),
    };
  }

  _computeFitZoom(sheet = this.sheetDraft) {
    if (!sheet) return this._clampStageZoom(this.zoom, DEFAULT_ZOOM);

    const ppi = Math.max(1, toFiniteNumber(sheet.pxPerInch, 96));
    const widthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * ppi);
    const heightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * ppi);
    const viewport = this._getStageViewportMetrics();
    const availableWidth = Math.max(
      1,
      viewport.width - (FIT_VIEWPORT_PADDING_PX * 2) - FIT_SAFETY_INSET_PX,
    );
    const availableHeight = Math.max(
      1,
      viewport.height - (FIT_VIEWPORT_PADDING_PX * 2) - FIT_SAFETY_INSET_PX,
    );
    return this._clampStageZoom(Math.min(availableWidth / widthPx, availableHeight / heightPx), DEFAULT_ZOOM);
  }

  _computeFitStagePan(sheet = this.sheetDraft, zoom = this._computeFitZoom(sheet)) {
    if (!sheet) {
      return { x: 0, y: 0 };
    }
    const ppi = Math.max(1, toFiniteNumber(sheet.pxPerInch, 96));
    const widthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * ppi);
    const heightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * ppi);
    const viewport = this._getStageViewportMetrics();
    return {
      x: Math.round((viewport.width - (widthPx * zoom)) * 0.5),
      y: Math.round((viewport.height - (heightPx * zoom)) * 0.5),
    };
  }

  _getStageWorldRect() {
    return this._stageShell?.getBoundingClientRect?.() || this._slideCanvas?.getBoundingClientRect?.() || null;
  }

  _ensureManualStageView() {
    if (this._zoomMode !== "fit") return;
    this._zoomMode = "manual";
    this.zoom = this._getStageZoom();
    this._stagePanX = toFiniteNumber(this._appliedStagePanX, 0);
    this._stagePanY = toFiniteNumber(this._appliedStagePanY, 0);
    this._syncZoomControl();
  }

  _setManualZoomAroundClientPoint(nextZoom, clientX, clientY) {
    const viewport = this._stageCenter || this._stageWrap || null;
    if (!viewport) return;

    this._ensureManualStageView();
    const viewportRect = viewport.getBoundingClientRect();
    const currentZoom = this._getStageZoom();
    const localX = clientX - viewportRect.left;
    const localY = clientY - viewportRect.top;
    const worldX = (localX - this._appliedStagePanX) / currentZoom;
    const worldY = (localY - this._appliedStagePanY) / currentZoom;

    this.zoom = this._clampStageZoom(nextZoom, currentZoom);
    this._stagePanX = localX - (worldX * this.zoom);
    this._stagePanY = localY - (worldY * this.zoom);
  }

  _syncZoomControl() {
    if (this._fitZoomOption) {
      this._fitZoomOption.textContent = this._zoomMode === "fit"
        ? `Fit (${Math.round(this._getStageZoom() * 100)}%)`
        : "Fit";
    }
    if (!this._zoomSelect) return;
    if (this._zoomMode === "fit") {
      if (this._manualZoomOption?.parentNode === this._zoomSelect) {
        this._manualZoomOption.remove();
      }
      this._zoomSelect.value = "fit";
      return;
    }

    const exactValue = String(this.zoom);
    const hasPreset = Array.from(this._zoomSelect.options).some((option) => option.value === exactValue);
    if (!hasPreset) {
      if (!this._manualZoomOption) {
        this._manualZoomOption = document.createElement("option");
      }
      this._manualZoomOption.value = exactValue;
      this._manualZoomOption.textContent = `${Math.round(this.zoom * 100)}%`;
      if (this._manualZoomOption.parentNode !== this._zoomSelect) {
        this._zoomSelect.appendChild(this._manualZoomOption);
      }
    } else if (this._manualZoomOption?.parentNode === this._zoomSelect) {
      this._manualZoomOption.remove();
    }
    this._zoomSelect.value = exactValue;
  }

  _syncViewportControls() {
    this._syncZoomControl();
    if (this._gridToggleBtn) {
      this._gridToggleBtn.classList.toggle("active", !!this.showGrid);
      this._gridToggleBtn.setAttribute("aria-pressed", this.showGrid ? "true" : "false");
    }
  }

  _ensureWindow() {
    if (this.root) return;
    this._ensureStyles();

    const overlay = document.createElement("div");
    overlay.className = "sheet-slides-overlay";
    overlay.style.display = "none";

    const root = document.createElement("div");
    root.className = "sheet-slides-root";
    root.style.display = "none";

    const topbar = document.createElement("div");
    topbar.className = "sheet-slides-topbar";

    const brand = document.createElement("div");
    brand.className = "sheet-slides-brand";

    const brandLogo = document.createElement("img");
    brandLogo.className = "sheet-slides-brand-logo";
    brandLogo.src = brepHomeBannerUrl;
    brandLogo.alt = "BREP.io";
    brand.appendChild(brandLogo);

    const brandText = document.createElement("div");
    brandText.className = "sheet-slides-brand-text";

    const brandTitle = document.createElement("div");
    brandTitle.className = "sheet-slides-brand-title";
    brandTitle.textContent = "Sheets Studio";
    brandText.appendChild(brandTitle);

    const subtitle = document.createElement("div");
    subtitle.className = "sheet-slides-subtitle";
    subtitle.textContent = "2D sheet editor";
    brandText.appendChild(subtitle);

    brand.appendChild(brandText);
    topbar.appendChild(brand);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "sheet-slides-hidden";
    fileInput.addEventListener("change", () => this._onImageFileChosen(fileInput));
    this._fileInput = fileInput;
    topbar.appendChild(fileInput);

    const addTextBtn = this._makeToolbarActionButton("addText", "Text", () => this._addElement("text"), { iconOnly: true });
    const shapesBtn = this._makeToolbarActionButton("addShapes", "Shapes", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("insertShape", shapesBtn);
    }, { menu: true, iconOnly: true });
    const addTableBtn = this._makeToolbarActionButton("addTable", "Table", () => this._addElement("table"), { iconOnly: true });
    const addImageBtn = this._makeToolbarActionButton("addImage", "Image", () => this._addImageElement(), { iconOnly: true });

    const insertPmiBtn = this._makeToolbarActionButton("addPmi", "Insert PMI", () => this._openPmiPicker(), { variant: "primary", iconOnly: true });

    const selectionStyleGroup = this._toolbarGroup([], false);
    selectionStyleGroup.classList.add("sheet-slides-selection-group");

    const toolbarFillButton = this._makeToolbarIconButton("fillColor", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("fillColor", toolbarFillButton);
    }, { title: "Background color" });
    toolbarFillButton.classList.add("sheet-slides-toolbar-menu-btn");

    const toolbarStrokeButton = this._makeToolbarIconButton("strokeColor", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("strokeColor", toolbarStrokeButton);
    }, { title: "Border color" });
    toolbarStrokeButton.classList.add("sheet-slides-toolbar-menu-btn");

    const toolbarStrokeWidthButton = this._makeToolbarIconButton("lineWeight", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("strokeWidth", toolbarStrokeWidthButton);
    }, { title: "Line weight" });
    toolbarStrokeWidthButton.classList.add("sheet-slides-toolbar-menu-btn");

    const toolbarLineStyleButton = this._makeToolbarIconButton("lineStyle", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("lineStyle", toolbarLineStyleButton);
    }, { title: "Line style" });
    toolbarLineStyleButton.classList.add("sheet-slides-toolbar-menu-btn");

    selectionStyleGroup.appendChild(toolbarFillButton);
    selectionStyleGroup.appendChild(toolbarStrokeButton);
    selectionStyleGroup.appendChild(toolbarStrokeWidthButton);
    selectionStyleGroup.appendChild(toolbarLineStyleButton);

    const selectionTextGroup = this._toolbarGroup([], false);
    selectionTextGroup.classList.add("sheet-slides-selection-group");

    const toolbarFontFamilyInput = this._buildFontFamilySelect((value) => this._setSelectedTextField("fontFamily", value));
    toolbarFontFamilyInput.classList.add("sheet-slides-toolbar-font-family");
    const toolbarFontSizeDecrementBtn = this._makeToolbarButton("A-", () => this._adjustSelectedFontSize(-1), "small");
    toolbarFontSizeDecrementBtn.title = "Decrease font size";
    const toolbarFontSizeInput = this._buildNumberInput((value) => this._setSelectedTextField("fontSize", value), {
      step: 1,
      min: 1,
      max: 288,
    });
    toolbarFontSizeInput.title = "Font size (pt)";
    toolbarFontSizeInput.classList.add("sheet-slides-toolbar-number");
    const toolbarFontSizeIncrementBtn = this._makeToolbarButton("A+", () => this._adjustSelectedFontSize(1), "small");
    toolbarFontSizeIncrementBtn.title = "Increase font size";

    const toolbarTextColorButton = this._makeToolbarIconButton("textColor", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("textColor", toolbarTextColorButton);
    }, { title: "Text color" });
    toolbarTextColorButton.classList.add("sheet-slides-toolbar-menu-btn");

    const toolbarBoldBtn = this._makeToolbarIconButton("bold", () => this._toggleTextWeight(), { title: "Bold" });
    const toolbarItalicBtn = this._makeToolbarIconButton("italic", () => this._toggleTextItalic(), { title: "Italic" });
    const toolbarUnderlineBtn = this._makeToolbarIconButton("underline", () => this._toggleTextUnderline(), { title: "Underline" });
    toolbarItalicBtn.classList.add("sheet-slides-toolbar-italic");

    const toolbarAlignmentButton = this._makeToolbarIconButton("textAlignMenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggleToolbarPopover("textAlign", toolbarAlignmentButton);
    }, { title: "Text alignment" });
    toolbarAlignmentButton.classList.add("sheet-slides-toolbar-menu-btn");

    selectionTextGroup.appendChild(toolbarFontFamilyInput);
    selectionTextGroup.appendChild(toolbarFontSizeDecrementBtn);
    selectionTextGroup.appendChild(toolbarFontSizeInput);
    selectionTextGroup.appendChild(toolbarFontSizeIncrementBtn);
    selectionTextGroup.appendChild(toolbarBoldBtn);
    selectionTextGroup.appendChild(toolbarItalicBtn);
    selectionTextGroup.appendChild(toolbarUnderlineBtn);
    selectionTextGroup.appendChild(toolbarTextColorButton);
    selectionTextGroup.appendChild(toolbarAlignmentButton);

    const zoomSelect = document.createElement("select");
    zoomSelect.className = "sheet-slides-control";
    [["fit", "Fit"], ["0.01", "1%"], ["0.02", "2%"], ["0.05", "5%"], ["0.1", "10%"], ["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"], ["3", "300%"], ["4", "400%"], ["5", "500%"], ["6", "600%"], ["8", "800%"], ["10", "1000%"]]
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
        if (this._zoomMode === "fit") {
          this._stagePanX = toFiniteNumber(this._appliedStagePanX, 0);
          this._stagePanY = toFiniteNumber(this._appliedStagePanY, 0);
        }
        this._zoomMode = "manual";
        this.zoom = this._clampStageZoom(zoomSelect.value, DEFAULT_ZOOM);
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
    gridBtn.title = "Toggle grid";
    this._gridToggleBtn = gridBtn;

    const saveBtn = this._makeToolbarButton("💾", () => {
      void this._triggerMainToolbarSave();
    });
    saveBtn.title = "Save current model";
    this._saveBtn = saveBtn;

    topbar.appendChild(this._toolbarGroup([saveBtn, addTextBtn, shapesBtn, addTableBtn, addImageBtn, insertPmiBtn]));
    topbar.appendChild(selectionStyleGroup);
    topbar.appendChild(selectionTextGroup);

    const topbarSpacer = document.createElement("div");
    topbarSpacer.className = "sheet-slides-topbar-spacer";
    topbar.appendChild(topbarSpacer);

    const pdfBtn = this._makeToolbarButton("PDF", () => {
      void this._exportSheetsToPdf();
    });
    pdfBtn.title = "Generate a PDF from all sheets";
    this._pdfBtn = pdfBtn;
    topbar.appendChild(pdfBtn);

    const finishBtn = this._makeToolbarButton("Finish", () => this.close(), "primary");
    finishBtn.title = "Exit the 2D sheet editor";
    finishBtn.classList.add("sheet-slides-finish-btn");
    this._finishBtn = finishBtn;
    topbar.appendChild(finishBtn);

    this._toolbarSelectionStyleGroup = selectionStyleGroup;
    this._toolbarSelectionTextGroup = selectionTextGroup;
    this._toolbarFillButton = toolbarFillButton;
    this._toolbarStrokeButton = toolbarStrokeButton;
    this._toolbarStrokeWidthButton = toolbarStrokeWidthButton;
    this._toolbarLineStyleButton = toolbarLineStyleButton;
    this._toolbarTextColorButton = toolbarTextColorButton;
    this._toolbarFontFamilyInput = toolbarFontFamilyInput;
    this._toolbarFontSizeInput = toolbarFontSizeInput;
    this._toolbarFontSizeDecrementBtn = toolbarFontSizeDecrementBtn;
    this._toolbarFontSizeIncrementBtn = toolbarFontSizeIncrementBtn;
    this._toolbarBoldBtn = toolbarBoldBtn;
    this._toolbarItalicBtn = toolbarItalicBtn;
    this._toolbarUnderlineBtn = toolbarUnderlineBtn;
    this._toolbarAlignmentButton = toolbarAlignmentButton;
    this._shapesBtn = shapesBtn;

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
    stageWrap.addEventListener("pointerdown", (event) => this._onStagePointerDown(event));
    stageWrap.addEventListener("contextmenu", (event) => this._onStageContextMenu(event));
    stageWrap.addEventListener("wheel", (event) => this._onStageWheel(event), { passive: false });
    this._stageWrap = stageWrap;

    const stageCenter = document.createElement("div");
    stageCenter.className = "sheet-slides-stage-center";
    this._stageCenter = stageCenter;

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

    const sheetCustomWidthInput = this._buildNumberInput(
      (value) => this._setSheetFormatField("customWidthIn", value),
      { step: 0.25, min: MIN_CUSTOM_SHEET_SIZE_IN },
    );
    this._sheetCustomWidthInput = sheetCustomWidthInput;
    this._sheetCustomWidthField = this._makeField("Width (in)", sheetCustomWidthInput);
    slidePanel.appendChild(this._sheetCustomWidthField);

    const sheetCustomHeightInput = this._buildNumberInput(
      (value) => this._setSheetFormatField("customHeightIn", value),
      { step: 0.25, min: MIN_CUSTOM_SHEET_SIZE_IN },
    );
    this._sheetCustomHeightInput = sheetCustomHeightInput;
    this._sheetCustomHeightField = this._makeField("Height (in)", sheetCustomHeightInput);
    slidePanel.appendChild(this._sheetCustomHeightField);

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
    const {
      wrap: strokeControl,
      input: strokeInput,
      reset: strokeResetBtn,
    } = this._buildColorControl(
      (value) => this._setSelectedStyleField("stroke", value),
      () => this._resetSelectedStroke(),
    );
    const strokeWidthInput = this._buildNumberInput((value) => this._setSelectedStyleField("strokeWidth", value), {
      step: 0.25,
      min: 0,
      max: 72,
    });
    const cornerRadiusInput = this._buildNumberInput((value) => this._setSelectedStyleField("cornerRadius", value), {
      step: 1,
      min: 0,
      max: 400,
    });

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
    this._strokeInput = strokeInput;
    this._strokeResetBtn = strokeResetBtn;
    this._strokeWidthInput = strokeWidthInput;
    this._cornerRadiusInput = cornerRadiusInput;
    this._opacityInput = opacityInput;
    this._zInput = zInput;

    elementPanel.appendChild(this._makeField("X", xInput));
    elementPanel.appendChild(this._makeField("Y", yInput));
    elementPanel.appendChild(this._makeField("W", wInput));
    elementPanel.appendChild(this._makeField("H", hInput));
    elementPanel.appendChild(this._makeField("Rotation", rotInput));
    const fillField = this._makeField("Background", fillControl);
    this._fillField = fillField;
    elementPanel.appendChild(fillField);
    const strokeField = this._makeField("Border", strokeControl);
    this._strokeField = strokeField;
    elementPanel.appendChild(strokeField);
    elementPanel.appendChild(this._makeField("Border W (pt)", strokeWidthInput));
    const cornerRadiusField = this._makeField("Corner R", cornerRadiusInput);
    this._cornerRadiusField = cornerRadiusField;
    elementPanel.appendChild(cornerRadiusField);
    elementPanel.appendChild(this._makeField("Opacity", opacityInput));
    elementPanel.appendChild(this._makeField("Layer", zInput));

    const textPanel = document.createElement("div");
    textPanel.className = "sheet-slides-panel";
    textPanel.innerHTML = "<h3>Text</h3>";

    const tableTextScopeInput = this._buildSelect([
      { value: "cell", label: "Selected cells" },
      { value: "table", label: "Whole table" },
    ], (value) => this._setTableTextScope(value));

    const textInput = document.createElement("textarea");
    textInput.className = "sheet-slides-control";
    textInput.rows = 3;
    textInput.addEventListener("change", () => this._setSelectedTextField("text", textInput.value));

    const fontFamilyInput = this._buildFontFamilySelect((value) => this._setSelectedTextField("fontFamily", value));

    const fontSizeInput = this._buildNumberInput((value) => this._setSelectedTextField("fontSize", value), {
      step: 1,
      min: 1,
      max: 288,
    });
    const fontSizeDecrementBtn = this._makeToolbarButton("A-", () => this._adjustSelectedFontSize(-1), "small");
    fontSizeDecrementBtn.title = "Decrease font size";
    const fontSizeIncrementBtn = this._makeToolbarButton("A+", () => this._adjustSelectedFontSize(1), "small");
    fontSizeIncrementBtn.title = "Increase font size";
    const fontSizeControl = document.createElement("div");
    fontSizeControl.className = "sheet-slides-font-size-row";
    fontSizeControl.appendChild(fontSizeDecrementBtn);
    fontSizeControl.appendChild(fontSizeInput);
    fontSizeControl.appendChild(fontSizeIncrementBtn);

    const {
      wrap: textColorControl,
      input: textColorInput,
      reset: textColorResetBtn,
    } = this._buildColorControl(
      (value) => this._setSelectedTextField("color", value),
      () => this._resetSelectedTextColor(),
    );

    const textAlignWrap = document.createElement("div");
    textAlignWrap.className = "sheet-slides-segmented-row";
    const textAlignButtons = {};
    [["left", "Left"], ["center", "Center"], ["right", "Right"]].forEach(([value, label]) => {
      const button = this._makeToolbarButton(label, () => this._setSelectedTextField("textAlign", value), "small");
      textAlignButtons[value] = button;
      textAlignWrap.appendChild(button);
    });

    const verticalAlignWrap = document.createElement("div");
    verticalAlignWrap.className = "sheet-slides-segmented-row";
    const verticalAlignButtons = {};
    [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].forEach(([value, label]) => {
      const button = this._makeToolbarButton(label, () => this._setSelectedTextField("verticalAlign", value), "small");
      verticalAlignButtons[value] = button;
      verticalAlignWrap.appendChild(button);
    });

    const boldBtn = this._makeToolbarButton("Bold", () => this._toggleTextWeight(), "small");
    const italicBtn = this._makeToolbarButton("Italic", () => this._toggleTextItalic(), "small");
    const underlineBtn = this._makeToolbarButton("Underline", () => this._toggleTextUnderline(), "small");

    this._textInput = textInput;
    this._fontFamilyInput = fontFamilyInput;
    this._fontSizeInput = fontSizeInput;
    this._fontSizeDecrementBtn = fontSizeDecrementBtn;
    this._fontSizeIncrementBtn = fontSizeIncrementBtn;
    this._textColorInput = textColorInput;
    this._textColorResetBtn = textColorResetBtn;
    this._textAlignButtons = textAlignButtons;
    this._verticalAlignButtons = verticalAlignButtons;
    this._tableTextScopeInput = tableTextScopeInput;
    this._boldBtn = boldBtn;
    this._italicBtn = italicBtn;
    this._underlineBtn = underlineBtn;
    this._textPanel = textPanel;

    const tableTextScopeField = this._makeField("Apply", tableTextScopeInput);
    this._tableTextScopeField = tableTextScopeField;
    textPanel.appendChild(tableTextScopeField);
    const textContentField = this._makeField("Content", textInput);
    this._textContentField = textContentField;
    textPanel.appendChild(textContentField);
    textPanel.appendChild(this._makeField("Font", fontFamilyInput));
    textPanel.appendChild(this._makeField("Size (pt)", fontSizeControl));
    textPanel.appendChild(this._makeField("Text", textColorControl));
    textPanel.appendChild(this._makeField("Align H", textAlignWrap));
    textPanel.appendChild(this._makeField("Align V", verticalAlignWrap));
    textPanel.appendChild(this._toolbarGroup([boldBtn, italicBtn, underlineBtn], true));

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

    const pmiLabelPositionInput = this._buildSelect(
      PMI_LABEL_POSITION_OPTIONS,
      (value) => this._setSelectedPMIField("labelPosition", value),
    );

    const pmiRenderModeInput = this._buildSelect(
      PMI_RENDER_MODE_OPTIONS,
      (value) => this._setSelectedPMIField("renderMode", value),
    );

    const showCenterLinesInput = document.createElement("input");
    showCenterLinesInput.type = "checkbox";
    showCenterLinesInput.addEventListener("change", () => this._setSelectedPMIField("showCenterLines", showCenterLinesInput.checked));

    const showCenterLinesWrap = document.createElement("div");
    showCenterLinesWrap.className = "sheet-slides-checkbox";
    showCenterLinesWrap.appendChild(showCenterLinesInput);
    showCenterLinesWrap.appendChild(document.createTextNode("Show center lines"));

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

    const pmiAnchorInput = this._buildSelect(
      PMI_ANCHOR_OPTIONS,
      (value) => this._setSelectedPMIField("anchor", value),
    );

    this._pmiPanel = pmiPanel;
    this._pmiNameValue = pmiNameValue;
    this._pmiLabelPositionInput = pmiLabelPositionInput;
    this._pmiRenderModeInput = pmiRenderModeInput;
    this._showPmiCenterLinesInput = showCenterLinesInput;
    this._showPmiBackgroundInput = showBgInput;
    this._pmiBgInput = pmiBgInput;
    this._pmiBgResetBtn = pmiBgResetBtn;
    this._pmiAnchorInput = pmiAnchorInput;

    pmiPanel.appendChild(this._makeField("View Name", pmiNameValue));
    pmiPanel.appendChild(this._makeField("Render", pmiRenderModeInput));
    this._pmiCenterLinesField = this._makeField("Center Lines", showCenterLinesWrap);
    pmiPanel.appendChild(this._pmiCenterLinesField);
    pmiPanel.appendChild(this._makeField("Anchor", pmiAnchorInput));
    pmiPanel.appendChild(this._makeField("Label", pmiLabelPositionInput));
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
    statusLeft.className = "sheet-slides-status-left";
    const statusCenter = document.createElement("div");
    statusCenter.className = "sheet-slides-status-center";
    const statusControls = document.createElement("div");
    statusControls.className = "sheet-slides-status-controls";
    statusControls.appendChild(zoomSelect);
    statusControls.appendChild(gridBtn);
    statusCenter.appendChild(statusControls);
    const statusRight = document.createElement("div");
    statusRight.className = "sheet-slides-muted sheet-slides-status-right";
    statusRight.textContent = "Ready";
    status.appendChild(statusLeft);
    status.appendChild(statusCenter);
    status.appendChild(statusRight);
    this._statusLeft = statusLeft;
    this._statusRight = statusRight;

    const contextMenu = document.createElement("div");
    contextMenu.className = "sheet-slides-context-menu";
    contextMenu.style.display = "none";
    this._contextMenu = contextMenu;

    const toolbarPopover = document.createElement("div");
    toolbarPopover.className = "sheet-slides-toolbar-popover";
    toolbarPopover.style.display = "none";
    this._toolbarPopover = toolbarPopover;

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

    const pdfProgressOverlay = document.createElement("div");
    pdfProgressOverlay.className = "sheet-slides-pdf-progress-overlay";
    pdfProgressOverlay.style.display = "none";
    pdfProgressOverlay.setAttribute("aria-hidden", "true");

    const pdfProgressCard = document.createElement("div");
    pdfProgressCard.className = "sheet-slides-pdf-progress-card";
    pdfProgressCard.addEventListener("click", (event) => event.stopPropagation());

    const pdfProgressCopy = document.createElement("div");
    pdfProgressCopy.className = "sheet-slides-pdf-progress-copy";

    const pdfProgressEyebrow = document.createElement("div");
    pdfProgressEyebrow.className = "sheet-slides-pdf-progress-eyebrow";
    pdfProgressEyebrow.textContent = "PDF Export";

    const pdfProgressTitle = document.createElement("strong");
    pdfProgressTitle.className = "sheet-slides-pdf-progress-title";
    pdfProgressTitle.textContent = "Generating PDF";

    const pdfProgressDetail = document.createElement("div");
    pdfProgressDetail.className = "sheet-slides-pdf-progress-detail";
    pdfProgressDetail.textContent = "Preparing sheets for export";

    const pdfProgressMeta = document.createElement("div");
    pdfProgressMeta.className = "sheet-slides-pdf-progress-meta";
    pdfProgressMeta.textContent = "0 of 0 sheets";

    const pdfProgressTrack = document.createElement("div");
    pdfProgressTrack.className = "sheet-slides-pdf-progress-track";

    const pdfProgressFill = document.createElement("div");
    pdfProgressFill.className = "sheet-slides-pdf-progress-fill";
    pdfProgressFill.style.width = "0%";
    pdfProgressTrack.appendChild(pdfProgressFill);

    const pdfProgressFooter = document.createElement("div");
    pdfProgressFooter.className = "sheet-slides-pdf-progress-footer";

    const pdfProgressHint = document.createElement("div");
    pdfProgressHint.className = "sheet-slides-pdf-progress-hint";
    pdfProgressHint.textContent = "Please wait while each sheet is rasterized.";

    const pdfProgressPercent = document.createElement("div");
    pdfProgressPercent.className = "sheet-slides-pdf-progress-percent";
    pdfProgressPercent.textContent = "0%";

    pdfProgressFooter.appendChild(pdfProgressHint);
    pdfProgressFooter.appendChild(pdfProgressPercent);

    pdfProgressCopy.appendChild(pdfProgressEyebrow);
    pdfProgressCopy.appendChild(pdfProgressTitle);
    pdfProgressCopy.appendChild(pdfProgressDetail);
    pdfProgressCopy.appendChild(pdfProgressMeta);
    pdfProgressCopy.appendChild(pdfProgressTrack);
    pdfProgressCopy.appendChild(pdfProgressFooter);

    const pdfProgressPreviewPanel = document.createElement("div");
    pdfProgressPreviewPanel.className = "sheet-slides-pdf-progress-preview-panel";

    const pdfProgressPreviewLabel = document.createElement("div");
    pdfProgressPreviewLabel.className = "sheet-slides-pdf-progress-preview-label";
    pdfProgressPreviewLabel.textContent = "Current sheet";

    const pdfProgressPreview = document.createElement("div");
    pdfProgressPreview.className = "sheet-slides-pdf-progress-preview";

    const pdfProgressPreviewEmpty = document.createElement("div");
    pdfProgressPreviewEmpty.className = "sheet-slides-pdf-progress-preview-empty";
    pdfProgressPreviewEmpty.textContent = "Preparing preview";
    pdfProgressPreview.appendChild(pdfProgressPreviewEmpty);

    pdfProgressPreviewPanel.appendChild(pdfProgressPreviewLabel);
    pdfProgressPreviewPanel.appendChild(pdfProgressPreview);

    pdfProgressCard.appendChild(pdfProgressCopy);
    pdfProgressCard.appendChild(pdfProgressPreviewPanel);
    pdfProgressOverlay.appendChild(pdfProgressCard);

    this._pdfProgressOverlay = pdfProgressOverlay;
    this._pdfProgressTitle = pdfProgressTitle;
    this._pdfProgressDetail = pdfProgressDetail;
    this._pdfProgressMeta = pdfProgressMeta;
    this._pdfProgressFill = pdfProgressFill;
    this._pdfProgressHint = pdfProgressHint;
    this._pdfProgressPercent = pdfProgressPercent;
    this._pdfProgressPreviewLabel = pdfProgressPreviewLabel;
    this._pdfProgressPreview = pdfProgressPreview;

    root.appendChild(topbar);
    root.appendChild(sidebar);
    root.appendChild(stageWrap);
    root.appendChild(inspector);
    root.appendChild(status);
    root.appendChild(contextMenu);
    root.appendChild(toolbarPopover);
    root.appendChild(pmiPicker);
    root.appendChild(pdfProgressOverlay);

    overlay.appendChild(root);
    document.body.appendChild(overlay);

    this.overlay = overlay;
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

  _makeToolbarIconButton(iconKey, onClick, { title = "", variant = "" } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sheet-slides-btn sheet-slides-icon-btn ${variant}`.trim();
    button.innerHTML = TOOLBAR_ICON_SVGS[iconKey] || "";
    if (title) {
      button.title = title;
      button.setAttribute("aria-label", title);
    }
    button.addEventListener("click", onClick);
    return button;
  }

  _makeToolbarActionButton(iconKey, label, onClick, { variant = "", menu = false, iconOnly = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sheet-slides-btn sheet-slides-toolbar-action-btn ${variant}${menu ? " sheet-slides-toolbar-menu-btn" : ""}${iconOnly ? " icon-only" : ""}`.trim();
    button.setAttribute("aria-label", label);
    button.title = label;

    const icon = document.createElement("span");
    icon.className = "sheet-slides-toolbar-action-icon";
    icon.innerHTML = TOOLBAR_ICON_SVGS[iconKey] || "";
    button.appendChild(icon);

    if (!iconOnly) {
      const text = document.createElement("span");
      text.className = "sheet-slides-toolbar-action-label";
      text.textContent = label;
      button.appendChild(text);
    }

    if (menu) {
      const chevron = document.createElement("span");
      chevron.className = "sheet-slides-toolbar-action-chevron";
      chevron.innerHTML = TOOLBAR_ICON_SVGS.chevronDown || "";
      button.appendChild(chevron);
    }

    button.addEventListener("click", onClick);
    return button;
  }

  _buildFontFamilySelect(onChange) {
    const select = document.createElement("select");
    select.className = "sheet-slides-control";
    [
      ["Arial, Helvetica, sans-serif", "Sans"],
      ["Georgia, serif", "Serif"],
      ["'Courier New', monospace", "Mono"],
      ["Impact, Haettenschweiler, sans-serif", "Display"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  _buildSelect(options, onChange) {
    const select = document.createElement("select");
    select.className = "sheet-slides-control";
    for (const optionConfig of Array.isArray(options) ? options : []) {
      const option = document.createElement("option");
      option.value = String(optionConfig?.value ?? "");
      option.textContent = String(optionConfig?.label ?? option.value);
      select.appendChild(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
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

  _toggleToolbarPopover(kind, anchor) {
    if (!anchor || !kind) return;
    if (this._toolbarPopoverKind === kind && this._toolbarPopoverAnchor === anchor) {
      this._closeToolbarPopover();
      return;
    }
    this._toolbarPopoverKind = String(kind);
    this._toolbarPopoverAnchor = anchor;
    this._renderToolbarPopover();
  }

  _closeToolbarPopover() {
    this._toolbarPopoverKind = "";
    this._toolbarPopoverAnchor = null;
    if (this._toolbarPopover) this._toolbarPopover.style.display = "none";
  }

  _renderToolbarPopover() {
    const popover = this._toolbarPopover;
    const root = this.root;
    const anchor = this._toolbarPopoverAnchor;
    const kind = this._toolbarPopoverKind;
    const selected = this._getSelectedElement();
    const needsSelection = kind !== "insertShape";
    if (!popover || !root || !anchor || !kind || (needsSelection && !selected)) {
      this._closeToolbarPopover();
      return;
    }

    popover.textContent = "";
    popover.className = "sheet-slides-toolbar-popover";
    const title = document.createElement("div");
    title.className = "sheet-slides-toolbar-popover-title";
    popover.appendChild(title);

    const body = document.createElement("div");
    body.className = "sheet-slides-toolbar-popover-body";
    popover.appendChild(body);

    if (kind === "insertShape") {
      title.textContent = "Shapes";
      const grid = document.createElement("div");
      grid.className = "sheet-slides-toolbar-shape-grid";
      for (const option of SHAPE_INSERT_OPTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sheet-slides-toolbar-shape-option";
        button.setAttribute("aria-label", option.label);
        button.title = option.label;

        const icon = document.createElement("span");
        icon.className = "sheet-slides-toolbar-shape-option-icon";
        icon.innerHTML = TOOLBAR_ICON_SVGS[option.iconKey] || "";
        button.appendChild(icon);

        const label = document.createElement("span");
        label.className = "sheet-slides-toolbar-shape-option-label";
        label.textContent = option.label;
        button.appendChild(label);

        button.addEventListener("click", () => {
          this._addElement(option.kind);
          this._closeToolbarPopover();
        });

        grid.appendChild(button);
      }
      body.appendChild(grid);
    } else if (kind === "fillColor" || kind === "strokeColor" || kind === "textColor") {
      title.textContent = kind === "fillColor" ? "Background color" : (kind === "strokeColor" ? "Border color" : "Text color");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "sheet-slides-toolbar-popover-color";
      const currentColor = kind === "fillColor"
        ? normalizeHex(selected.fill, normalizeHex(this._defaultFillForElement(selected), "#000000"))
        : (kind === "strokeColor"
          ? normalizeHex(selected.stroke, this._defaultStrokeForElement(selected))
          : normalizeHex(selected.color, this._defaultTextColorForElement(selected)));
      colorInput.value = currentColor;
      colorInput.addEventListener("input", () => {
        if (kind === "fillColor") this._setSelectedStyleField("fill", colorInput.value);
        else if (kind === "strokeColor") this._setSelectedStyleField("stroke", colorInput.value);
        else this._setSelectedTextField("color", colorInput.value);
      });
      body.appendChild(colorInput);

      const swatches = document.createElement("div");
      swatches.className = "sheet-slides-toolbar-swatch-grid";
      for (const swatchColor of TOOLBAR_COLOR_SWATCHS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sheet-slides-toolbar-swatch";
        button.style.background = swatchColor;
        button.title = swatchColor;
        button.setAttribute("aria-label", `Use color ${swatchColor}`);
        button.addEventListener("click", () => {
          if (kind === "fillColor") this._setSelectedStyleField("fill", swatchColor);
          else if (kind === "strokeColor") this._setSelectedStyleField("stroke", swatchColor);
          else this._setSelectedTextField("color", swatchColor);
          this._closeToolbarPopover();
        });
        swatches.appendChild(button);
      }
      body.appendChild(swatches);
    } else if (kind === "strokeWidth") {
      title.textContent = "Line weight";
      const list = document.createElement("div");
      list.className = "sheet-slides-toolbar-option-list";
      const currentPt = selected.type === "text" && !this._isTextBorderEnabled(selected)
        ? 0
        : Math.round(inchesToPoints(toFiniteNumber(selected.strokeWidth, this._defaultStrokeWidthForElement(selected))) * 100) / 100;
      for (const value of STROKE_WIDTH_OPTIONS_PT) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sheet-slides-toolbar-option${Math.abs(value - currentPt) < 0.001 ? " active" : ""}`;
        button.textContent = `${formatPointValue(value)}pt`;
        button.addEventListener("click", () => {
          this._setSelectedStyleField("strokeWidth", value);
          this._closeToolbarPopover();
        });
        list.appendChild(button);
      }
      body.appendChild(list);
    } else if (kind === "lineStyle") {
      title.textContent = "Line style";
      const list = document.createElement("div");
      list.className = "sheet-slides-toolbar-option-list";
      const currentStyle = this._getLineStyleValue(selected);
      for (const option of LINE_STYLE_OPTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sheet-slides-toolbar-option sheet-slides-toolbar-style-option${option.value === currentStyle ? " active" : ""}`;
        button.innerHTML = this._createLineStylePreviewSvg(option.value);
        button.title = option.label;
        button.setAttribute("aria-label", option.label);
        button.addEventListener("click", () => {
          this._setSelectedStyleField("lineStyle", option.value);
          this._closeToolbarPopover();
        });
        list.appendChild(button);
      }
      body.appendChild(list);
    } else if (kind === "textAlign") {
      title.textContent = "Text alignment";

      const textAlign = this._getTextAlignValue(selected);
      const verticalAlign = this._getTextVerticalAlignValue(selected);
      const sections = [
        {
          title: "Horizontal",
          field: "textAlign",
          current: textAlign,
          options: [
            { value: "left", label: "Align left", iconKey: "alignLeft" },
            { value: "center", label: "Align center", iconKey: "alignCenter" },
            { value: "right", label: "Align right", iconKey: "alignRight" },
          ],
        },
        {
          title: "Vertical",
          field: "verticalAlign",
          current: verticalAlign,
          options: [
            { value: "top", label: "Align top", iconKey: "valignTop" },
            { value: "middle", label: "Align middle", iconKey: "valignMiddle" },
            { value: "bottom", label: "Align bottom", iconKey: "valignBottom" },
          ],
        },
      ];

      for (const sectionConfig of sections) {
        const section = document.createElement("div");
        section.className = "sheet-slides-toolbar-popover-section";

        const sectionTitle = document.createElement("div");
        sectionTitle.className = "sheet-slides-toolbar-popover-section-title";
        sectionTitle.textContent = sectionConfig.title;
        section.appendChild(sectionTitle);

        const list = document.createElement("div");
        list.className = "sheet-slides-toolbar-icon-grid";
        for (const option of sectionConfig.options) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `sheet-slides-toolbar-option sheet-slides-icon-btn${option.value === sectionConfig.current ? " active" : ""}`;
          button.innerHTML = TOOLBAR_ICON_SVGS[option.iconKey] || "";
          button.title = option.label;
          button.setAttribute("aria-label", option.label);
          button.addEventListener("click", () => {
            this._setSelectedTextField(sectionConfig.field, option.value);
            this._closeToolbarPopover();
          });
          list.appendChild(button);
        }
        section.appendChild(list);
        body.appendChild(section);
      }
    }

    popover.style.display = "block";
    const rootRect = root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const popoverWidth = Math.max(180, popover.offsetWidth);
    const popoverHeight = Math.max(72, popover.offsetHeight);
    const left = clamp(
      Math.round(anchorRect.left - rootRect.left),
      8,
      Math.max(8, rootRect.width - popoverWidth - 8),
    );
    const top = clamp(
      Math.round(anchorRect.bottom - rootRect.top + 8),
      8,
      Math.max(8, rootRect.height - popoverHeight - 8),
    );
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  _createLineStylePreviewSvg(styleValue) {
    if (styleValue === "none") {
      return iconSvg(`
        <path d="M3 12h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".28"/>
        <path d="M6 18L18 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      `);
    }
    const dashArray = this._getStrokeDashArray(styleValue, 2);
    return iconSvg(`
      <path d="M2 12h20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"${dashArray ? ` stroke-dasharray="${dashArray}"` : ""}/>
    `);
  }

  _defaultSheetBackground() {
    return "#ffffff";
  }

  _setSheetFormatField(key, rawValue) {
    if (!this.sheetDraft) return;
    if (key === "sizeKey") {
      const nextSizeKey = String(rawValue || DEFAULT_SHEET_SIZE_KEY);
      if (nextSizeKey === "CUSTOM" && String(this.sheetDraft.sizeKey || "") !== "CUSTOM") {
        this.sheetDraft.customWidthIn = Math.max(
          MIN_CUSTOM_SHEET_SIZE_IN,
          toFiniteNumber(this.sheetDraft.widthIn, 11),
        );
        this.sheetDraft.customHeightIn = Math.max(
          MIN_CUSTOM_SHEET_SIZE_IN,
          toFiniteNumber(this.sheetDraft.heightIn, 8.5),
        );
      }
      this.sheetDraft.sizeKey = nextSizeKey;
    } else if (key === "orientation") {
      const nextOrientation = String(rawValue || DEFAULT_SHEET_ORIENTATION);
      if (String(this.sheetDraft.sizeKey || "") === "CUSTOM") {
        const currentWidth = Math.max(
          MIN_CUSTOM_SHEET_SIZE_IN,
          toFiniteNumber(this.sheetDraft.customWidthIn ?? this.sheetDraft.widthIn, 11),
        );
        const currentHeight = Math.max(
          MIN_CUSTOM_SHEET_SIZE_IN,
          toFiniteNumber(this.sheetDraft.customHeightIn ?? this.sheetDraft.heightIn, 8.5),
        );
        const isLandscape = nextOrientation !== "portrait";
        this.sheetDraft.customWidthIn = isLandscape
          ? Math.max(currentWidth, currentHeight)
          : Math.min(currentWidth, currentHeight);
        this.sheetDraft.customHeightIn = isLandscape
          ? Math.min(currentWidth, currentHeight)
          : Math.max(currentWidth, currentHeight);
      }
      this.sheetDraft.orientation = nextOrientation;
    } else if (key === "customWidthIn" || key === "customHeightIn") {
      const fallback = key === "customWidthIn"
        ? (this.sheetDraft.customWidthIn ?? this.sheetDraft.widthIn)
        : (this.sheetDraft.customHeightIn ?? this.sheetDraft.heightIn);
      this.sheetDraft[key] = Math.max(MIN_CUSTOM_SHEET_SIZE_IN, toFiniteNumber(rawValue, fallback));
    } else {
      return;
    }

    this._commitSheetDraft(`sheet-${key}`);
    this._renderAll();
  }

  _defaultFillForElement(element) {
    const type = String(element?.type || "");
    if (type === "text") return "transparent";
    if (isShapeElementType(type)) return getShapePalette(type).fill;
    if (type === "table") return "#ffffff";
    if (type === "image") return "#ffffff";
    if (type === "pmiInset") return "transparent";
    return "#000000";
  }

  _defaultStrokeForElement(element) {
    const type = String(element?.type || "");
    if (type === "text") return "#000000";
    if (isShapeElementType(type)) return getShapePalette(type).stroke;
    if (type === "table") return "#0f172a";
    if (type === "image") return "#94a3b8";
    if (type === "pmiInset") return "#334155";
    if (type === "line") return "#0f172a";
    return "#000000";
  }

  _defaultStrokeWidthForElement(element) {
    const type = String(element?.type || "");
    if (type === "text") return 0;
    if (type === "line") return 0.02;
    if (type === "rect" || type === "ellipse" || type === "image" || type === "pmiInset" || type === "table") return 0.01;
    return 0.01;
  }

  _defaultLineStyleForElement(_element) {
    return "solid";
  }

  _defaultTextColorForElement(element) {
    const type = String(element?.type || "");
    if (isShapeElementType(type)) return "#0f172a";
    return "#111111";
  }

  _getShapeRenderOptions(element, ppi) {
    if (!isShapeElementType(element?.type)) return null;
    const type = String(element.type || "");
    const fillColor = element.fill || this._defaultFillForElement(element);
    switch (type) {
      case "rect":
        return {
          shape: "rect",
          radiusPx: Math.max(0, toFiniteNumber(element.cornerRadius, 0.1) * ppi),
          fillColor,
          textPaddingPx: 8,
        };
      case "ellipse":
        return { shape: "ellipse", fillColor, textPaddingPx: 12 };
      case "triangle":
        return { shape: "triangle", fillColor, textPaddingPx: 14 };
      case "diamond":
        return { shape: "diamond", fillColor, textPaddingPx: 16 };
      case "pentagon":
        return { shape: "pentagon", fillColor, textPaddingPx: 14 };
      case "hexagon":
        return { shape: "hexagon", fillColor, textPaddingPx: 14 };
      case "parallelogram":
        return { shape: "parallelogram", fillColor, textPaddingPx: 14 };
      case "trapezoid":
        return { shape: "trapezoid", fillColor, textPaddingPx: 14 };
      default:
        return null;
    }
  }

  _buildShapeContentNode(element, widthPx, heightPx, ppi) {
    const shapeOptions = this._getShapeRenderOptions(element, ppi);
    if (!shapeOptions) return null;
    const content = document.createElement("div");
    content.className = "sheet-slides-element-content";
    this._appendShapeSurface(content, element, widthPx, heightPx, shapeOptions);
    const shapeText = document.createElement("div");
    shapeText.className = "sheet-slides-inline-text sheet-slides-shape-text";
    const textInner = document.createElement("div");
    textInner.className = "sheet-slides-inline-text-body";
    textInner.textContent = String(element.text || "");
    shapeText.appendChild(textInner);
    this._applyTextStyles(shapeText, element, ppi);
    shapeText.style.padding = `${Math.max(0, toFiniteNumber(shapeOptions.textPaddingPx, 8))}px`;
    content.appendChild(shapeText);
    return content;
  }

  _getNormalizedTableData(element) {
    return normalizeTableData(element?.tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
  }

  _getTableLayoutMetrics(element, widthPx, heightPx, tableData = this._getNormalizedTableData(element)) {
    const normalized = normalizeTableData(tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    const rowCount = Math.max(1, getTableRowCount(normalized, TABLE_DEFAULT_ROWS));
    const colCount = Math.max(1, getTableColumnCount(normalized, TABLE_DEFAULT_COLS));
    const safeWidth = Math.max(1, toFiniteNumber(widthPx, 1));
    const safeHeight = Math.max(1, toFiniteNumber(heightPx, 1));
    const rowStarts = [0];
    const colStarts = [0];
    const rowHeights = [];
    const colWidths = [];

    let rowCursor = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const isLast = row === rowCount - 1;
      const nextHeight = isLast
        ? Math.max(0, safeHeight - rowCursor)
        : Math.max(0, safeHeight * toFiniteNumber(normalized.rowFractions?.[row], 1 / rowCount));
      rowHeights.push(nextHeight);
      rowCursor += nextHeight;
      rowStarts.push(rowCursor);
    }

    let colCursor = 0;
    for (let col = 0; col < colCount; col += 1) {
      const isLast = col === colCount - 1;
      const nextWidth = isLast
        ? Math.max(0, safeWidth - colCursor)
        : Math.max(0, safeWidth * toFiniteNumber(normalized.colFractions?.[col], 1 / colCount));
      colWidths.push(nextWidth);
      colCursor += nextWidth;
      colStarts.push(colCursor);
    }

    return {
      tableData: normalized,
      rowCount,
      colCount,
      widthPx: safeWidth,
      heightPx: safeHeight,
      rowStarts,
      colStarts,
      rowHeights,
      colWidths,
    };
  }

  _getTableCellBoundsPx(layout, row, col, cell) {
    if (!layout || !cell) return null;
    const rowSpan = Math.max(1, Math.round(toFiniteNumber(cell.rowSpan, 1)));
    const colSpan = Math.max(1, Math.round(toFiniteNumber(cell.colSpan, 1)));
    const left = toFiniteNumber(layout.colStarts?.[col], 0);
    const top = toFiniteNumber(layout.rowStarts?.[row], 0);
    const right = toFiniteNumber(layout.colStarts?.[col + colSpan], layout.widthPx);
    const bottom = toFiniteNumber(layout.rowStarts?.[row + rowSpan], layout.heightPx);
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  _getTableTextAlignValue(element) {
    const value = String(element?.textAlign || "left");
    return ["left", "center", "right"].includes(value) ? value : "left";
  }

  _getTableVerticalAlignValue(element) {
    const value = String(element?.verticalAlign || "middle");
    return ["top", "middle", "bottom"].includes(value) ? value : "middle";
  }

  _applyTableCellTextStyles(node, element, cell, ppi) {
    if (!node || !element) return;
    node.style.fontFamily = this._resolveTableTextStyleValue(element, cell, "fontFamily");
    node.style.fontSize = `${Math.max(6, toFiniteNumber(this._resolveTableTextStyleValue(element, cell, "fontSize"), 0.22) * ppi)}px`;
    node.style.fontWeight = this._resolveTableTextStyleValue(element, cell, "fontWeight");
    node.style.fontStyle = this._resolveTableTextStyleValue(element, cell, "fontStyle");
    node.style.textDecoration = this._resolveTableTextStyleValue(element, cell, "textDecoration");
    node.style.color = toCssColor(this._resolveTableTextStyleValue(element, cell, "color"), "#111111");
    node.style.textAlign = this._resolveTableTextStyleValue(element, cell, "textAlign");
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.justifyContent = this._resolveTableTextStyleValue(element, cell, "verticalAlign") === "top"
      ? "flex-start"
      : (this._resolveTableTextStyleValue(element, cell, "verticalAlign") === "bottom" ? "flex-end" : "center");
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.boxSizing = "border-box";
    node.style.whiteSpace = "pre-wrap";
    node.style.wordBreak = "break-word";
    node.style.lineHeight = "1.2";
    node.style.overflow = "hidden";
    node.style.padding = `${TABLE_CELL_PADDING_PX}px`;
  }

  _isTableCellSelected(element, row, col, cell) {
    if (!isTableElementType(element) || !cell) return false;
    const rect = this._getActiveTableSelectionRect(element);
    if (!rect) return false;
    const cellMaxRow = row + Math.max(1, Math.round(toFiniteNumber(cell.rowSpan, 1))) - 1;
    const cellMaxCol = col + Math.max(1, Math.round(toFiniteNumber(cell.colSpan, 1))) - 1;
    return !(cellMaxRow < rect.minRow || row > rect.maxRow || cellMaxCol < rect.minCol || col > rect.maxCol);
  }

  _createTableSurfaceSvg(element, widthPx, heightPx, layout, ppi = this._pxPerIn()) {
    if (!element || !layout) return null;
    const tableData = layout.tableData || this._getNormalizedTableData(element);
    const rowCount = Math.max(1, layout.rowCount || getTableRowCount(tableData, TABLE_DEFAULT_ROWS));
    const colCount = Math.max(1, layout.colCount || getTableColumnCount(tableData, TABLE_DEFAULT_COLS));
    const styleValue = this._getLineStyleValue(element);
    const strokeWidthPx = Math.max(0, toFiniteNumber(element.strokeWidth, this._defaultStrokeWidthForElement(element)) * Math.max(1, toFiniteNumber(ppi, 96)));
    const hasStroke = strokeWidthPx > 0 && styleValue !== "none";
    const dashArray = hasStroke ? this._getStrokeDashArray(styleValue, strokeWidthPx) : "";
    const strokeColor = hasStroke ? toCssColor(element.stroke, this._defaultStrokeForElement(element)) : "none";
    const inset = hasStroke ? Math.max(0.5, strokeWidthPx * 0.5) : 0;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${Math.max(1, widthPx)} ${Math.max(1, heightPx)}`);
    svg.setAttribute("width", String(Math.max(1, widthPx)));
    svg.setAttribute("height", String(Math.max(1, heightPx)));
    svg.classList.add("sheet-slides-table-surface");

    const fillRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    fillRect.setAttribute("x", "0");
    fillRect.setAttribute("y", "0");
    fillRect.setAttribute("width", String(Math.max(1, widthPx)));
    fillRect.setAttribute("height", String(Math.max(1, heightPx)));
    fillRect.setAttribute("fill", toCssColor(element.fill, "#ffffff"));
    fillRect.setAttribute("stroke", "none");
    svg.appendChild(fillRect);

    if (hasStroke) {
      const appendLine = (x1, y1, x2, y2) => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", strokeColor);
        line.setAttribute("stroke-width", String(Math.max(1, strokeWidthPx)));
        if (dashArray) line.setAttribute("stroke-dasharray", dashArray);
        line.setAttribute("vector-effect", "non-scaling-stroke");
        line.setAttribute("stroke-linecap", "square");
        svg.appendChild(line);
      };

      const outer = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      outer.setAttribute("x", String(inset));
      outer.setAttribute("y", String(inset));
      outer.setAttribute("width", String(Math.max(0, widthPx - (inset * 2))));
      outer.setAttribute("height", String(Math.max(0, heightPx - (inset * 2))));
      outer.setAttribute("fill", "none");
      outer.setAttribute("stroke", strokeColor);
      outer.setAttribute("stroke-width", String(Math.max(1, strokeWidthPx)));
      if (dashArray) outer.setAttribute("stroke-dasharray", dashArray);
      outer.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(outer);

      for (let boundary = 1; boundary < colCount; boundary += 1) {
        const x = toFiniteNumber(layout.colStarts?.[boundary], 0);
        for (let row = 0; row < rowCount; row += 1) {
          const leftAnchor = resolveTableCellAnchor(tableData, row, boundary - 1);
          const rightAnchor = resolveTableCellAnchor(tableData, row, boundary);
          if (leftAnchor && rightAnchor && leftAnchor.row === rightAnchor.row && leftAnchor.col === rightAnchor.col) continue;
          appendLine(
            x,
            toFiniteNumber(layout.rowStarts?.[row], 0),
            x,
            toFiniteNumber(layout.rowStarts?.[row + 1], heightPx),
          );
        }
      }

      for (let boundary = 1; boundary < rowCount; boundary += 1) {
        const y = toFiniteNumber(layout.rowStarts?.[boundary], 0);
        for (let col = 0; col < colCount; col += 1) {
          const topAnchor = resolveTableCellAnchor(tableData, boundary - 1, col);
          const bottomAnchor = resolveTableCellAnchor(tableData, boundary, col);
          if (topAnchor && bottomAnchor && topAnchor.row === bottomAnchor.row && topAnchor.col === bottomAnchor.col) continue;
          appendLine(
            toFiniteNumber(layout.colStarts?.[col], 0),
            y,
            toFiniteNumber(layout.colStarts?.[col + 1], widthPx),
            y,
          );
        }
      }
    }

    return svg;
  }

  _buildTableContentNode(element, widthPx, heightPx, ppi, { interactive = false } = {}) {
    if (!isTableElementType(element)) return null;
    const layout = this._getTableLayoutMetrics(element, widthPx, heightPx);
    const tableData = layout.tableData;
    const wrap = document.createElement("div");
    wrap.className = "sheet-slides-table-wrap";
    wrap.style.background = toCssColor(element.fill, "#ffffff");

    const surface = this._createTableSurfaceSvg(element, widthPx, heightPx, layout, ppi);
    if (surface) wrap.appendChild(surface);

    const layer = document.createElement("div");
    layer.className = "sheet-slides-table-layer";
    wrap.appendChild(layer);

    for (let row = 0; row < layout.rowCount; row += 1) {
      for (let col = 0; col < layout.colCount; col += 1) {
        const cell = getTableCell(tableData, row, col);
        if (!cell || cell?.mergedInto) continue;
        const bounds = this._getTableCellBoundsPx(layout, row, col, cell);
        if (!bounds) continue;

        const cellNode = document.createElement("div");
        cellNode.className = `sheet-slides-table-cell${interactive && this._isTableCellSelected(element, row, col, cell) ? " is-selected" : ""}`;
        cellNode.style.left = `${bounds.left}px`;
        cellNode.style.top = `${bounds.top}px`;
        cellNode.style.width = `${bounds.width}px`;
        cellNode.style.height = `${bounds.height}px`;
        cellNode.dataset.tableCellRow = String(row);
        cellNode.dataset.tableCellCol = String(col);
        cellNode.dataset.tableCellRowSpan = String(Math.max(1, Math.round(toFiniteNumber(cell.rowSpan, 1))));
        cellNode.dataset.tableCellColSpan = String(Math.max(1, Math.round(toFiniteNumber(cell.colSpan, 1))));

        const body = document.createElement("div");
        body.className = "sheet-slides-table-cell-body";
        body.textContent = String(cell.text || "");
        this._applyTableCellTextStyles(body, element, cell, ppi);
        cellNode.appendChild(body);
        layer.appendChild(cellNode);
      }
    }

    return wrap;
  }

  _getTextAlignValue(element) {
    const fallbackAlign = element?.type === "text" ? "left" : "center";
    const value = String(element?.textAlign || fallbackAlign);
    return ["left", "center", "right"].includes(value) ? value : fallbackAlign;
  }

  _getTextVerticalAlignValue(element) {
    const fallbackAlign = element?.type === "text" ? "top" : "middle";
    const value = String(element?.verticalAlign || fallbackAlign);
    return ["top", "middle", "bottom"].includes(value) ? value : fallbackAlign;
  }

  _getLineStyleValue(element) {
    const value = String(element?.lineStyle || this._defaultLineStyleForElement(element));
    return LINE_STYLE_OPTIONS.some((entry) => entry.value === value) ? value : "solid";
  }

  _isTextBorderEnabled(element) {
    if (!element || element.type !== "text") return true;
    if (typeof element.strokeEnabled === "boolean") return element.strokeEnabled;
    return false;
  }

  _getStrokeDashArray(styleValue, strokeWidthPx) {
    const unit = Math.max(1, toFiniteNumber(strokeWidthPx, 1));
    switch (styleValue) {
      case "dotted":
        return `${unit} ${unit * 2.6}`;
      case "dashed":
        return `${unit * 5} ${unit * 3}`;
      case "dashDot":
        return `${unit * 5} ${unit * 2.5} ${unit} ${unit * 2.5}`;
      case "longDash":
        return `${unit * 8} ${unit * 3}`;
      case "dashDotDot":
        return `${unit * 5} ${unit * 2.3} ${unit} ${unit * 2.2} ${unit} ${unit * 2.3}`;
      default:
        return "";
    }
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

    this._renderContextMenu();
    if (!menu.childElementCount) {
      this._hideContextMenu();
      return;
    }

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
    this._contextMenuState = null;
  }

  _appendContextMenuItem(menu, label, onClick, { danger = false } = {}) {
    if (!menu || typeof onClick !== "function") return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sheet-slides-context-menu-item${danger ? " danger" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      this._hideContextMenu();
      onClick();
    });
    menu.appendChild(button);
  }

  _appendContextMenuSeparator(menu) {
    if (!menu) return;
    const divider = document.createElement("div");
    divider.className = "sheet-slides-context-menu-separator";
    menu.appendChild(divider);
  }

  _renderContextMenu() {
    const menu = this._contextMenu;
    if (!menu) return;
    menu.textContent = "";
    const selectedElements = this._getSelectedElements({ sorted: true });
    if (!selectedElements.length) return;
    const selected = selectedElements[selectedElements.length - 1] || this._getSelectedElement();
    const singleSelection = selectedElements.length === 1 ? selected : null;

    const context = this._contextMenuState || { kind: "element", elementId: String(selected?.id || "") };
    const isTableCellContext = context.kind === "table-cell"
      && !!singleSelection
      && String(context.elementId || "") === String(singleSelection.id || "")
      && isTableElementType(singleSelection);
    let addedTableItems = false;

    if (isTableCellContext) {
      this._appendContextMenuItem(menu, "Insert row above", () => this._insertTableRowAt(context.row, "above"));
      this._appendContextMenuItem(menu, "Insert row below", () => this._insertTableRowAt(context.row, "below"));
      this._appendContextMenuItem(menu, "Insert column left", () => this._insertTableColumnAt(context.col, "left"));
      this._appendContextMenuItem(menu, "Insert column right", () => this._insertTableColumnAt(context.col, "right"));
      addedTableItems = true;

      const selectionRect = this._getActiveTableSelectionRect(selected);
      if (selectionRect && canMergeTableCells(this._getNormalizedTableData(selected), selectionRect)) {
        this._appendContextMenuSeparator(menu);
        this._appendContextMenuItem(menu, "Merge cells", () => this._mergeSelectedTableCells());
        addedTableItems = true;
      }
      if (this._canUnmergeSelectedTableCell()) {
        if (!selectionRect || !canMergeTableCells(this._getNormalizedTableData(selected), selectionRect)) {
          this._appendContextMenuSeparator(menu);
        }
        this._appendContextMenuItem(menu, "Unmerge cells", () => this._unmergeSelectedTableCell());
        addedTableItems = true;
      }
    }

    if (addedTableItems) this._appendContextMenuSeparator(menu);
    if (this._canGroupSelectedElements()) {
      this._appendContextMenuItem(menu, "Group", () => this._groupSelectedElements());
    }
    if (this._canUngroupSelectedElements()) {
      this._appendContextMenuItem(menu, "Ungroup", () => this._ungroupSelectedElements());
    }
    if (this._canGroupSelectedElements() || this._canUngroupSelectedElements()) {
      this._appendContextMenuSeparator(menu);
    }
    this._appendContextMenuItem(menu, "Bring to front", () => this._bringSelectedToFront());
    this._appendContextMenuItem(menu, "Send to back", () => this._sendSelectedToBack());
    this._appendContextMenuItem(menu, "Duplicate", () => this._duplicateSelectedElement());
    this._appendContextMenuItem(menu, "Delete", () => this._deleteSelectedElement(), { danger: true });
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
      "picker-v2",
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
      .then(() => this._capturePmiViewImage(view, viewIndex))
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
    if (this._toolbarPopover?.style.display !== "none") {
      const insideToolbarPopover = event?.target?.closest?.(".sheet-slides-toolbar-popover, .sheet-slides-toolbar-menu-btn");
      if (!insideToolbarPopover) {
        this._closeToolbarPopover();
      }
    }
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

  _getPmiLabelPosition(element) {
    if (element?.type !== "pmiInset") return "none";
    const value = String(element?.pmiLabelPosition || "").trim().toLowerCase();
    if (value === "top" || value === "bottom" || value === "none") return value;
    return element?.showTitle !== false ? "bottom" : "none";
  }

  _getPmiTitleHeightIn(element) {
    return this._getPmiLabelPosition(element) === "none" ? 0 : PMI_TITLE_HEIGHT_IN;
  }

  _applyPmiCaptionStyles(node, ppi, heightPx = 0) {
    if (!node) return;
    const safePpi = Math.max(1, toFiniteNumber(ppi, this._pxPerIn()));
    const safeHeightPx = Math.max(0, toFiniteNumber(heightPx, 0));
    const fontSizePx = Math.max(8, Math.min(pointsToInches(PMI_TITLE_FONT_SIZE_PT) * safePpi, safeHeightPx * 0.6 || Infinity));
    const padXPx = Math.max(2, pointsToInches(PMI_TITLE_PAD_X_PT) * safePpi);
    node.style.fontSize = `${fontSizePx}px`;
    node.style.paddingLeft = `${padXPx}px`;
    node.style.paddingRight = `${padXPx}px`;
    node.style.paddingTop = "0px";
    node.style.paddingBottom = "0px";
    node.style.lineHeight = "1.15";
  }

  _getSuggestedPmiInsetSize(metadata = null, showLabel = true) {
    const pageWidth = Math.max(0.1, toFiniteNumber(this.sheetDraft?.widthIn, 11));
    const pageHeight = Math.max(0.1, toFiniteNumber(this.sheetDraft?.heightIn, 8.5));
    const captionHeight = showLabel ? PMI_TITLE_HEIGHT_IN : 0;
    const maxFrameWidth = Math.max(1.8, pageWidth * 0.28);
    const maxFrameHeight = Math.max(1.4, (pageHeight * 0.34) - captionHeight);

    const naturalWidth = toFiniteNumber(metadata?.width, 0);
    const naturalHeight = toFiniteNumber(metadata?.height, 0);
    if (naturalWidth > 0 && naturalHeight > 0) {
      const fit = Math.min(maxFrameWidth / naturalWidth, maxFrameHeight / naturalHeight);
      const frameWidth = Math.max(MIN_ELEMENT_IN, naturalWidth * fit);
      const frameHeight = Math.max(MIN_ELEMENT_IN, naturalHeight * fit);
      return {
        frameWidth,
        frameHeight,
        outerHeight: frameHeight + captionHeight,
      };
    }

    const frameWidth = Math.max(MIN_ELEMENT_IN, Math.min(3, maxFrameWidth));
    const frameHeight = Math.max(MIN_ELEMENT_IN, Math.min(2, maxFrameHeight));
    return {
      frameWidth,
      frameHeight,
      outerHeight: frameHeight + captionHeight,
    };
  }

  _getPmiAnchorValue(element) {
    const value = String(element?.pmiAnchor || "c");
    return PMI_ANCHOR_OPTIONS.some((option) => option.value === value) ? value : "c";
  }

  _getPmiRenderMode(element) {
    return normalizePmiRenderMode(element?.pmiRenderMode, "shaded");
  }

  _getPmiShowCenterLines(element) {
    return element?.pmiShowCenterLines === true;
  }

  _getAnchorFractions(anchor) {
    switch (String(anchor || "c")) {
      case "nw": return { x: 0, y: 0 };
      case "n": return { x: 0.5, y: 0 };
      case "ne": return { x: 1, y: 0 };
      case "w": return { x: 0, y: 0.5 };
      case "e": return { x: 1, y: 0.5 };
      case "sw": return { x: 0, y: 1 };
      case "s": return { x: 0.5, y: 1 };
      case "se": return { x: 1, y: 1 };
      default: return { x: 0.5, y: 0.5 };
    }
  }

  _getMediaFrameBox(element) {
    const x = toFiniteNumber(element?.x, 0);
    const y = toFiniteNumber(element?.y, 0);
    const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
    const outerH = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
    const captionHeight = this._getPmiTitleHeightIn(element);
    const h = Math.max(MIN_ELEMENT_IN, outerH - captionHeight);
    const labelPosition = this._getPmiLabelPosition(element);
    return {
      x,
      y: y + (labelPosition === "top" ? captionHeight : 0),
      w,
      h,
      outerH,
      captionHeight,
      labelPosition,
    };
  }

  _getPmiViewStateSignature(view = null) {
    try {
      const target = view && typeof view === "object" ? view : null;
      return JSON.stringify({
        camera: target?.camera || null,
        annotations: Array.isArray(target?.annotations) ? target.annotations : [],
        viewSettings: target?.viewSettings || target?.settings || null,
      }) || "null";
    } catch {
      return "unserializable";
    }
  }

  _getMediaLayout(element, frameWidth, frameHeight, metadata = null) {
    const safeFrameWidth = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameWidth, 1));
    const safeFrameHeight = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameHeight, 1));
    const naturalWidth = Math.max(1, toFiniteNumber(metadata?.width, safeFrameWidth));
    const naturalHeight = Math.max(1, toFiniteNumber(metadata?.height, safeFrameHeight));
    if (String(element?.type || "") === "pmiInset") {
      const fit = Math.min(safeFrameWidth / naturalWidth, safeFrameHeight / naturalHeight);
      const renderWidth = naturalWidth * fit;
      const renderHeight = naturalHeight * fit;
      return {
        naturalWidth,
        naturalHeight,
        baseWidth: renderWidth,
        baseHeight: renderHeight,
        scale: 1,
        renderWidth,
        renderHeight,
        extraX: 0,
        extraY: 0,
        left: (safeFrameWidth - renderWidth) * 0.5,
        top: (safeFrameHeight - renderHeight) * 0.5,
      };
    }

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

  _syncTableInteractionState() {
    const selected = this._getSelectedElement();
    if (!isTableElementType(selected)) {
      this._tableSelection = null;
      return;
    }
    if (!this._tableSelection || String(this._tableSelection.elementId || "") !== String(selected.id || "")) return;
    const tableData = this._getNormalizedTableData(selected);
    const rowCount = Math.max(1, getTableRowCount(tableData, TABLE_DEFAULT_ROWS));
    const colCount = Math.max(1, getTableColumnCount(tableData, TABLE_DEFAULT_COLS));
    const anchor = resolveTableCellAnchor(
      tableData,
      clamp(toFiniteNumber(this._tableSelection.anchorRow, 0), 0, rowCount - 1),
      clamp(toFiniteNumber(this._tableSelection.anchorCol, 0), 0, colCount - 1),
    );
    const focus = resolveTableCellAnchor(
      tableData,
      clamp(toFiniteNumber(this._tableSelection.focusRow, 0), 0, rowCount - 1),
      clamp(toFiniteNumber(this._tableSelection.focusCol, 0), 0, colCount - 1),
    );
    if (!anchor?.cell || !focus?.cell) {
      this._tableSelection = null;
      return;
    }
    this._tableSelection = {
      elementId: String(selected.id || ""),
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      focusRow: focus.row,
      focusCol: focus.col,
    };
  }

  _setTableSelectionForCell(element, row, col, { expand = false } = {}) {
    if (!isTableElementType(element)) {
      this._tableSelection = null;
      return false;
    }
    const tableData = this._getNormalizedTableData(element);
    const anchor = resolveTableCellAnchor(tableData, row, col);
    if (!anchor?.cell) return false;
    const previous = this._tableSelection && String(this._tableSelection.elementId || "") === String(element.id || "")
      ? this._tableSelection
      : null;
    this._tableSelection = {
      elementId: String(element.id || ""),
      anchorRow: expand && previous ? previous.anchorRow : anchor.row,
      anchorCol: expand && previous ? previous.anchorCol : anchor.col,
      focusRow: anchor.row,
      focusCol: anchor.col,
    };
    return true;
  }

  _getActiveTableSelectionRect(element = this._getSelectedElement()) {
    if (!isTableElementType(element)) return null;
    if (String(this.selectedElementId || "") !== String(element.id || "")) return null;
    if (!this._tableSelection || String(this._tableSelection.elementId || "") !== String(element.id || "")) return null;
    const tableData = this._getNormalizedTableData(element);
    const rowCount = Math.max(1, getTableRowCount(tableData, TABLE_DEFAULT_ROWS));
    const colCount = Math.max(1, getTableColumnCount(tableData, TABLE_DEFAULT_COLS));
    const rect = getTableSelectionRect(this._tableSelection);
    if (!rect) return null;
    return {
      minRow: clamp(rect.minRow, 0, rowCount - 1),
      maxRow: clamp(rect.maxRow, 0, rowCount - 1),
      minCol: clamp(rect.minCol, 0, colCount - 1),
      maxCol: clamp(rect.maxCol, 0, colCount - 1),
    };
  }

  _getPrimarySelectedTableCell() {
    const element = this._getSelectedElement();
    if (!isTableElementType(element)) return null;
    const rect = this._getActiveTableSelectionRect(element);
    if (!rect) return null;
    const tableData = this._getNormalizedTableData(element);
    const anchor = resolveTableCellAnchor(tableData, rect.minRow, rect.minCol);
    if (!anchor?.cell) return null;
    return { element, tableData, row: anchor.row, col: anchor.col, cell: anchor.cell };
  }

  _getTableTextScope() {
    return this._tableTextScope === "table" ? "table" : "cell";
  }

  _setTableTextScope(scope) {
    this._tableTextScope = scope === "table" ? "table" : "cell";
    this._renderInspector();
  }

  _getSelectedTableAnchorTargets(element = this._getSelectedElement(), tableData = this._getNormalizedTableData(element)) {
    if (!isTableElementType(element)) return [];
    const rect = this._getActiveTableSelectionRect(element);
    if (!rect) return [];
    const targets = [];
    const seen = new Set();
    for (let row = rect.minRow; row <= rect.maxRow; row += 1) {
      for (let col = rect.minCol; col <= rect.maxCol; col += 1) {
        const anchor = resolveTableCellAnchor(tableData, row, col);
        if (!anchor?.cell) continue;
        const key = `${anchor.row}:${anchor.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(anchor);
      }
    }
    return targets;
  }

  _getTableSelectionState(element = this._getSelectedElement()) {
    if (!isTableElementType(element)) return null;
    if (!this._tableSelection || String(this._tableSelection.elementId || "") !== String(element.id || "")) return null;
    return {
      elementId: String(element.id || ""),
      anchorRow: this._tableSelection.anchorRow,
      anchorCol: this._tableSelection.anchorCol,
      focusRow: this._tableSelection.focusRow,
      focusCol: this._tableSelection.focusCol,
    };
  }

  _resolveTableTextStyleValue(element, cell, key) {
    const style = cell?.style && typeof cell.style === "object" ? cell.style : null;
    if (style && style[key] != null && style[key] !== "") return style[key];
    if (key === "fontFamily") return String(element?.fontFamily || "Arial, Helvetica, sans-serif");
    if (key === "fontSize") return Math.max(0.08, toFiniteNumber(element?.fontSize, 0.22));
    if (key === "fontWeight") return String(element?.fontWeight || "400");
    if (key === "fontStyle") return String(element?.fontStyle || "normal");
    if (key === "textDecoration") return String(element?.textDecoration || "none");
    if (key === "textAlign") return this._getTableTextAlignValue(element);
    if (key === "verticalAlign") return this._getTableVerticalAlignValue(element);
    if (key === "color") return String(element?.color || this._defaultTextColorForElement(element));
    return "";
  }

  _canEditSelectedTableCellText(element = this._getSelectedElement()) {
    return this._getSelectedTableAnchorTargets(element).length === 1;
  }

  _getSelectedTextState() {
    const element = this._getSelectedElement();
    if (!element) return null;
    if (this._isFormboardElement(element)) return this._getSelectedFormboardTextState(element);
    if (!elementSupportsText(element)) return null;

    if (!isTableElementType(element)) {
      return {
        element,
        isTable: false,
        scope: "element",
        canEditTextContent: true,
        text: String(element.text || ""),
        fontFamily: String(element.fontFamily || "Arial, Helvetica, sans-serif"),
        fontSize: Math.max(0.08, toFiniteNumber(element.fontSize, 0.32)),
        fontWeight: String(element.fontWeight || "400"),
        fontStyle: String(element.fontStyle || "normal"),
        textDecoration: String(element.textDecoration || "none"),
        textAlign: this._getTextAlignValue(element),
        verticalAlign: this._getTextVerticalAlignValue(element),
        color: String(element.color || this._defaultTextColorForElement(element)),
      };
    }

    const scope = this._getTableTextScope();
    const primary = this._getPrimarySelectedTableCell();
    const styleCell = scope === "cell" ? primary?.cell : null;
    return {
      element,
      isTable: true,
      scope,
      canEditTextContent: scope === "cell" && this._canEditSelectedTableCellText(element),
      text: scope === "cell" && primary?.cell ? String(primary.cell.text || "") : "",
      fontFamily: this._resolveTableTextStyleValue(element, styleCell, "fontFamily"),
      fontSize: this._resolveTableTextStyleValue(element, styleCell, "fontSize"),
      fontWeight: this._resolveTableTextStyleValue(element, styleCell, "fontWeight"),
      fontStyle: this._resolveTableTextStyleValue(element, styleCell, "fontStyle"),
      textDecoration: this._resolveTableTextStyleValue(element, styleCell, "textDecoration"),
      textAlign: this._resolveTableTextStyleValue(element, styleCell, "textAlign"),
      verticalAlign: this._resolveTableTextStyleValue(element, styleCell, "verticalAlign"),
      color: this._resolveTableTextStyleValue(element, styleCell, "color"),
    };
  }

  _getSelectedFormboardTextElements(element = this._getSelectedElement()) {
    const target = element && this._isFormboardElement(element) ? element : null;
    const groupId = this._getElementGroupId(target);
    if (!groupId) return [];
    return (this.sheetDraft?.elements || []).filter((entry) => (
      this._getElementGroupId(entry) === groupId
      && entry?.type === "text"
      && this._isFormboardElement(entry)
    ));
  }

  _getSelectedFormboardTextState(element = this._getSelectedElement()) {
    const textElements = this._getSelectedFormboardTextElements(element);
    if (!textElements.length) return null;
    const sample = textElements[0];
    return {
      element,
      isTable: false,
      isFormboard: true,
      scope: "formboard",
      canEditTextContent: false,
      text: "",
      fontFamily: String(sample.fontFamily || "Arial, Helvetica, sans-serif"),
      fontSize: Math.max(0.08, toFiniteNumber(sample.fontSize, 0.32)),
      fontWeight: String(sample.fontWeight || "400"),
      fontStyle: String(sample.fontStyle || "normal"),
      textDecoration: String(sample.textDecoration || "none"),
      textAlign: this._getTextAlignValue(sample),
      verticalAlign: this._getTextVerticalAlignValue(sample),
      color: String(sample.color || this._defaultTextColorForElement(sample)),
      targetCount: textElements.length,
    };
  }

  _canUnmergeSelectedTableCell() {
    const current = this._getPrimarySelectedTableCell();
    return !!current?.cell && (toFiniteNumber(current.cell.rowSpan, 1) > 1 || toFiniteNumber(current.cell.colSpan, 1) > 1);
  }

  _getSuggestedTableSizeIn(tableData) {
    const rowCount = Math.max(1, getTableRowCount(tableData, TABLE_DEFAULT_ROWS));
    const colCount = Math.max(1, getTableColumnCount(tableData, TABLE_DEFAULT_COLS));
    const sheetWidth = Math.max(1, toFiniteNumber(this.sheetDraft?.widthIn, 11));
    const sheetHeight = Math.max(1, toFiniteNumber(this.sheetDraft?.heightIn, 8.5));
    let width = Math.max(1.8, colCount * TABLE_DEFAULT_COL_WIDTH_IN);
    let height = Math.max(1, rowCount * TABLE_DEFAULT_ROW_HEIGHT_IN);
    const maxWidth = Math.max(1.8, sheetWidth * 0.7);
    const maxHeight = Math.max(1, sheetHeight * 0.55);
    if (width > maxWidth) {
      const scale = maxWidth / width;
      width = maxWidth;
      height *= scale;
    }
    if (height > maxHeight) {
      const scale = maxHeight / height;
      height = maxHeight;
      width *= scale;
    }
    return { width, height };
  }

  _commitTableChange(element, nextTableData, reason = "table-edit", nextSelection = null) {
    if (!isTableElementType(element)) return false;
    element.tableData = normalizeTableData(nextTableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    if (nextSelection) {
      this._tableSelection = {
        elementId: String(element.id || ""),
        anchorRow: nextSelection.anchorRow,
        anchorCol: nextSelection.anchorCol,
        focusRow: nextSelection.focusRow,
        focusCol: nextSelection.focusCol,
      };
    }
    this._syncTableInteractionState();
    this._commitSheetDraft(reason);
    this._syncTableInteractionState();
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
    return true;
  }

  _clearTableMergeConflicts(tableData, rect) {
    let next = cloneTableData(tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    let changed = true;
    while (changed) {
      changed = false;
      const rowCount = getTableRowCount(next, TABLE_DEFAULT_ROWS);
      const colCount = getTableColumnCount(next, TABLE_DEFAULT_COLS);
      for (let row = 0; row < rowCount && !changed; row += 1) {
        for (let col = 0; col < colCount; col += 1) {
          const cell = getTableCell(next, row, col);
          if (!cell || cell?.mergedInto) continue;
          const cellRect = {
            minRow: row,
            maxRow: row + Math.max(1, Math.round(toFiniteNumber(cell.rowSpan, 1))) - 1,
            minCol: col,
            maxCol: col + Math.max(1, Math.round(toFiniteNumber(cell.colSpan, 1))) - 1,
          };
          const intersects = !(cellRect.maxRow < rect.minRow
            || cellRect.minRow > rect.maxRow
            || cellRect.maxCol < rect.minCol
            || cellRect.minCol > rect.maxCol);
          if (intersects && (cellRect.maxRow > cellRect.minRow || cellRect.maxCol > cellRect.minCol)) {
            next = unmergeTableCell(next, row, col);
            changed = true;
            break;
          }
        }
      }
    }
    return next;
  }

  _insertTableRowAt(referenceRow, position = "below") {
    const current = this._getPrimarySelectedTableCell();
    if (!current) return;
    const insertIndex = position === "above"
      ? clamp(Math.round(toFiniteNumber(referenceRow, current.row)), 0, getTableRowCount(current.tableData, TABLE_DEFAULT_ROWS))
      : clamp(Math.round(toFiniteNumber(referenceRow, current.row)) + 1, 0, getTableRowCount(current.tableData, TABLE_DEFAULT_ROWS));
    const nextData = insertTableRow(current.tableData, insertIndex);
    const selectedCol = clamp(current.col, 0, Math.max(0, getTableColumnCount(nextData, TABLE_DEFAULT_COLS) - 1));
    this._commitTableChange(current.element, nextData, "table-row-insert", {
      anchorRow: insertIndex,
      anchorCol: selectedCol,
      focusRow: insertIndex,
      focusCol: selectedCol,
    });
  }

  _insertTableColumnAt(referenceCol, position = "right") {
    const current = this._getPrimarySelectedTableCell();
    if (!current) return;
    const insertIndex = position === "left"
      ? clamp(Math.round(toFiniteNumber(referenceCol, current.col)), 0, getTableColumnCount(current.tableData, TABLE_DEFAULT_COLS))
      : clamp(Math.round(toFiniteNumber(referenceCol, current.col)) + 1, 0, getTableColumnCount(current.tableData, TABLE_DEFAULT_COLS));
    const nextData = insertTableColumn(current.tableData, insertIndex);
    const selectedRow = clamp(current.row, 0, Math.max(0, getTableRowCount(nextData, TABLE_DEFAULT_ROWS) - 1));
    this._commitTableChange(current.element, nextData, "table-col-insert", {
      anchorRow: selectedRow,
      anchorCol: insertIndex,
      focusRow: selectedRow,
      focusCol: insertIndex,
    });
  }

  _mergeSelectedTableCells() {
    const element = this._getSelectedElement();
    if (!isTableElementType(element)) return;
    const rect = this._getActiveTableSelectionRect(element);
    if (!rect) return;
    const nextData = mergeTableCells(this._getNormalizedTableData(element), rect);
    this._commitTableChange(element, nextData, "table-merge", {
      anchorRow: rect.minRow,
      anchorCol: rect.minCol,
      focusRow: rect.minRow,
      focusCol: rect.minCol,
    });
  }

  _unmergeSelectedTableCell() {
    const current = this._getPrimarySelectedTableCell();
    if (!current) return;
    const nextData = unmergeTableCell(current.tableData, current.row, current.col);
    this._commitTableChange(current.element, nextData, "table-unmerge", {
      anchorRow: current.row,
      anchorCol: current.col,
      focusRow: current.row,
      focusCol: current.col,
    });
  }

  _parseHtmlClipboardTable(html) {
    const source = String(html || "").trim();
    if (!source || typeof DOMParser === "undefined") return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(source, "text/html");
      const table = doc.querySelector("table");
      if (!table) return null;

      const rows = [];
      const occupancy = [];
      const rowNodes = Array.from(table.querySelectorAll("tr"));
      for (let rowIndex = 0; rowIndex < rowNodes.length; rowIndex += 1) {
        const rowNode = rowNodes[rowIndex];
        rows[rowIndex] = rows[rowIndex] || [];
        occupancy[rowIndex] = occupancy[rowIndex] || [];
        let colIndex = 0;
        const cellNodes = Array.from(rowNode.children).filter((node) => {
          const tag = String(node?.tagName || "").toUpperCase();
          return tag === "TD" || tag === "TH";
        });
        for (const cellNode of cellNodes) {
          while (occupancy[rowIndex]?.[colIndex]) colIndex += 1;
          const rowSpan = Math.max(1, Math.round(toFiniteNumber(cellNode.getAttribute("rowspan"), 1)));
          const colSpan = Math.max(1, Math.round(toFiniteNumber(cellNode.getAttribute("colspan"), 1)));
          rows[rowIndex][colIndex] = {
            text: String(cellNode.textContent || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim(),
            rowSpan,
            colSpan,
            mergedInto: null,
          };
          for (let fillRow = rowIndex; fillRow < rowIndex + rowSpan; fillRow += 1) {
            rows[fillRow] = rows[fillRow] || [];
            occupancy[fillRow] = occupancy[fillRow] || [];
            for (let fillCol = colIndex; fillCol < colIndex + colSpan; fillCol += 1) {
              occupancy[fillRow][fillCol] = true;
              if (fillRow === rowIndex && fillCol === colIndex) continue;
              rows[fillRow][fillCol] = {
                text: "",
                rowSpan: 1,
                colSpan: 1,
                mergedInto: { row: rowIndex, col: colIndex },
              };
            }
          }
          colIndex += colSpan;
        }
      }

      const rowCount = rows.length;
      const colCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
      if (!rowCount || !colCount) return null;
      return normalizeTableData({ cells: rows }, rowCount, colCount);
    } catch {
      return null;
    }
  }

  _parsePlainTextClipboardTable(text, { allowSingleCell = false } = {}) {
    const source = String(text || "").replace(/\r\n?/g, "\n");
    if (!source.trim()) return null;
    const rows = source.split("\n");
    while (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
    const isGridLike = source.includes("\t") || rows.length > 1 || allowSingleCell;
    if (!isGridLike) return null;
    const cells = rows.map((row) => row.split("\t").map((value) => ({
      text: String(value || ""),
      rowSpan: 1,
      colSpan: 1,
      mergedInto: null,
    })));
    const rowCount = cells.length;
    const colCount = cells.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    if (!rowCount || !colCount) return null;
    return normalizeTableData({ cells }, rowCount, colCount);
  }

  _parseClipboardTable(event, { allowSingleCell = false } = {}) {
    const clipboard = event?.clipboardData || window.clipboardData || null;
    if (!clipboard) return null;
    const html = clipboard.getData?.("text/html") || "";
    const fromHtml = this._parseHtmlClipboardTable(html);
    if (fromHtml) return fromHtml;
    const plain = clipboard.getData?.("text/plain") || "";
    return this._parsePlainTextClipboardTable(plain, { allowSingleCell });
  }

  _parseClipboardElementPayload(event) {
    const parsePayload = (raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.type !== "brep-sheet-elements" || !Array.isArray(parsed?.elements) || parsed.elements.length === 0) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    };

    const clipboard = event?.clipboardData || window.clipboardData || null;
    const fromCustom = parsePayload(clipboard?.getData?.(SHEET_OBJECT_CLIPBOARD_MIME) || "");
    if (fromCustom) return fromCustom;

    const plain = String(clipboard?.getData?.("text/plain") || "").trim();
    if (plain === SHEET_OBJECT_CLIPBOARD_TEXT && sheetObjectClipboardPayload) {
      return deepClone(sheetObjectClipboardPayload);
    }

    return null;
  }

  _getClipboardImagePayload(event) {
    const clipboard = event?.clipboardData || window.clipboardData || null;
    const items = Array.from(clipboard?.items || []);
    for (const item of items) {
      const type = String(item?.type || "").trim().toLowerCase();
      if (!type.startsWith("image/")) continue;
      const file = typeof item?.getAsFile === "function" ? item.getAsFile() : null;
      if (file) return { file, type };
    }

    const src = resolveClipboardImageSource({
      html: clipboard?.getData?.("text/html") || "",
      plainText: clipboard?.getData?.("text/plain") || "",
    });
    return src ? { src, type: "image/unknown" } : null;
  }

  _serializeSelectedElementsForClipboard() {
    const elements = this._getSelectedElements({ sorted: true });
    if (!elements.length) return null;
    return {
      type: "brep-sheet-elements",
      version: 1,
      sourceSheetId: String(this.sheetId || ""),
      elements: elements.map((element) => deepClone(element)),
    };
  }

  _copySelectedElementsToClipboard(event) {
    const payload = this._serializeSelectedElementsForClipboard();
    if (!payload) return false;

    sheetObjectClipboardPayload = deepClone(payload);

    try { event?.clipboardData?.setData?.(SHEET_OBJECT_CLIPBOARD_MIME, JSON.stringify(payload)); } catch { }
    try { event?.clipboardData?.setData?.("text/plain", SHEET_OBJECT_CLIPBOARD_TEXT); } catch { }

    this._setStatus(payload.elements.length > 1 ? `${payload.elements.length} objects copied` : "Object copied");
    return true;
  }

  _pasteClipboardElements(payload) {
    if (!this.sheetDraft || !Array.isArray(payload?.elements) || payload.elements.length === 0) return false;

    const clones = payload.elements.map((element) => deepClone(element)).filter(Boolean);
    if (!clones.length) return false;

    const sourceBounds = this._getSelectionBoundsIn(clones);
    const offsetIn = String(payload?.sourceSheetId || "") === String(this.sheetId || "")
      ? (24 / this._pxPerIn())
      : 0;
    let dx = offsetIn;
    let dy = offsetIn;

    if (sourceBounds) {
      const sheetWidth = Math.max(MIN_ELEMENT_IN, toFiniteNumber(this.sheetDraft.widthIn, 11));
      const sheetHeight = Math.max(MIN_ELEMENT_IN, toFiniteNumber(this.sheetDraft.heightIn, 8.5));
      const maxLeft = Math.max(0, sheetWidth - Math.min(sheetWidth, sourceBounds.w));
      const maxTop = Math.max(0, sheetHeight - Math.min(sheetHeight, sourceBounds.h));
      const targetLeft = clamp(sourceBounds.x + dx, 0, maxLeft);
      const targetTop = clamp(sourceBounds.y + dy, 0, maxTop);
      dx = targetLeft - sourceBounds.x;
      dy = targetTop - sourceBounds.y;
    }

    this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];

    const sourceGroupCounts = new Map();
    for (const element of clones) {
      const sourceGroupId = String(element?.groupId || "").trim();
      if (!sourceGroupId) continue;
      sourceGroupCounts.set(sourceGroupId, (sourceGroupCounts.get(sourceGroupId) || 0) + 1);
    }

    const nextSelectionIds = [];
    const nextGroupIds = new Map();
    let nextZ = this._nextZ();
    for (const clone of clones) {
      const sourceGroupId = String(clone?.groupId || "").trim();
      clone.id = uid("el");
      clone.z = nextZ;
      nextZ += 1;

      if (sourceGroupId && (sourceGroupCounts.get(sourceGroupId) || 0) > 1) {
        if (!nextGroupIds.has(sourceGroupId)) nextGroupIds.set(sourceGroupId, uid("grp"));
        clone.groupId = nextGroupIds.get(sourceGroupId);
      } else {
        delete clone.groupId;
      }

      if (clone.type === "line") {
        clone.x = toFiniteNumber(clone.x, 0) + dx;
        clone.y = toFiniteNumber(clone.y, 0) + dy;
        clone.x2 = toFiniteNumber(clone.x2, clone.x) + dx;
        clone.y2 = toFiniteNumber(clone.y2, clone.y) + dy;
      } else {
        clone.x = toFiniteNumber(clone.x, 0) + dx;
        clone.y = toFiniteNumber(clone.y, 0) + dy;
      }

      this.sheetDraft.elements.push(clone);
      nextSelectionIds.push(clone.id);
    }

    this._setSelectedElementIds(nextSelectionIds, nextSelectionIds[nextSelectionIds.length - 1] || null);
    this._commitSheetDraft("paste-elements");
    this._renderAll();
    this._setStatus(nextSelectionIds.length > 1 ? `${nextSelectionIds.length} objects pasted` : "Object pasted");
    return true;
  }

  _pasteIntoSelectedTable(pastedTableData) {
    const element = this._getSelectedElement();
    if (!isTableElementType(element)) return false;
    const selectionRect = this._getActiveTableSelectionRect(element);
    if (!selectionRect) return false;
    const pasted = normalizeTableData(pastedTableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    const pastedRows = getTableRowCount(pasted, TABLE_DEFAULT_ROWS);
    const pastedCols = getTableColumnCount(pasted, TABLE_DEFAULT_COLS);
    const startRow = selectionRect.minRow;
    const startCol = selectionRect.minCol;
    const targetRect = {
      minRow: startRow,
      maxRow: startRow + pastedRows - 1,
      minCol: startCol,
      maxCol: startCol + pastedCols - 1,
    };

    let next = ensureTableSize(this._getNormalizedTableData(element), targetRect.maxRow + 1, targetRect.maxCol + 1);
    next = this._clearTableMergeConflicts(next, targetRect);

    for (let row = targetRect.minRow; row <= targetRect.maxRow; row += 1) {
      for (let col = targetRect.minCol; col <= targetRect.maxCol; col += 1) {
        next.cells[row][col] = { text: "", rowSpan: 1, colSpan: 1, mergedInto: null };
      }
    }

    for (let row = 0; row < pastedRows; row += 1) {
      for (let col = 0; col < pastedCols; col += 1) {
        const cell = getTableCell(pasted, row, col);
        if (!cell || cell?.mergedInto) continue;
        const targetRow = startRow + row;
        const targetCol = startCol + col;
        const rowSpan = Math.max(1, Math.round(toFiniteNumber(cell.rowSpan, 1)));
        const colSpan = Math.max(1, Math.round(toFiniteNumber(cell.colSpan, 1)));
        next.cells[targetRow][targetCol] = {
          text: String(cell.text || ""),
          rowSpan,
          colSpan,
          mergedInto: null,
        };
        for (let coverRow = targetRow; coverRow < targetRow + rowSpan; coverRow += 1) {
          for (let coverCol = targetCol; coverCol < targetCol + colSpan; coverCol += 1) {
            if (coverRow === targetRow && coverCol === targetCol) continue;
            next.cells[coverRow][coverCol] = {
              text: "",
              rowSpan: 1,
              colSpan: 1,
              mergedInto: { row: targetRow, col: targetCol },
            };
          }
        }
      }
    }

    this._commitTableChange(element, next, "table-paste", {
      elementId: String(element.id || ""),
      anchorRow: startRow,
      anchorCol: startCol,
      focusRow: targetRect.maxRow,
      focusCol: targetRect.maxCol,
    });
    return true;
  }

  _insertTableFromClipboardData(tableData) {
    if (!this.sheetDraft) return false;
    const normalized = normalizeTableData(tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    const suggested = this._getSuggestedTableSizeIn(normalized);
    const xIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (suggested.width * 0.5));
    const yIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (suggested.height * 0.5));
    const table = defaultTableElement(xIn, yIn, normalized);
    table.w = suggested.width;
    table.h = suggested.height;
    table.z = this._nextZ();
    this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];
    this.sheetDraft.elements.push(table);
    this._setSelectedElementIds([String(table.id || "")], String(table.id || ""));
    this._tableSelection = {
      elementId: String(table.id || ""),
      anchorRow: 0,
      anchorCol: 0,
      focusRow: Math.max(0, getTableRowCount(normalized, TABLE_DEFAULT_ROWS) - 1),
      focusCol: Math.max(0, getTableColumnCount(normalized, TABLE_DEFAULT_COLS) - 1),
    };
    this._commitSheetDraft("table-paste-insert");
    this._syncTableInteractionState();
    this._renderAll();
    return true;
  }

  _readBlobAsDataUrl(blob) {
    if (!(blob instanceof Blob)) return Promise.resolve("");
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  }

  _measureImageInsertSizeIn(src) {
    const source = String(src || "").trim();
    if (!source) {
      return Promise.resolve({
        widthIn: DEFAULT_IMAGE_INSERT_WIDTH_IN,
        heightIn: DEFAULT_IMAGE_INSERT_HEIGHT_IN,
      });
    }

    return new Promise((resolve) => {
      const finalize = (naturalWidth = 0, naturalHeight = 0) => {
        if (naturalWidth > 0 && naturalHeight > 0) {
          this._rememberMediaMetadata(source, naturalWidth, naturalHeight);
        }
        resolve(getDefaultPlacedImageSizeIn(naturalWidth, naturalHeight));
      };

      const probe = new Image();
      probe.onload = () => finalize(probe.naturalWidth, probe.naturalHeight);
      probe.onerror = () => finalize();
      probe.src = source;
    });
  }

  async _insertImageElementFromSource(src, {
    historyLabel = "add-image",
    statusMessage = "Image added",
  } = {}) {
    const source = String(src || "").trim();
    if (!source || !this.sheetDraft) return false;

    const { widthIn, heightIn } = await this._measureImageInsertSizeIn(source);
    if (!this.sheetDraft) return false;

    this.sheetDraft.elements = Array.isArray(this.sheetDraft.elements) ? this.sheetDraft.elements : [];
    const xIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (widthIn * 0.5));
    const yIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (heightIn * 0.5));

    const image = defaultImageElement(xIn, yIn, source);
    image.w = widthIn;
    image.h = heightIn;
    image.z = this._nextZ();
    this.sheetDraft.elements.push(image);
    this._setSelectedElementIds([String(image.id || "")], String(image.id || ""));

    this._commitSheetDraft(historyLabel);
    this._renderAll();
    this._setStatus(statusMessage);
    return true;
  }

  async _pasteClipboardImage(payload) {
    if (!this.sheetDraft) return false;
    let src = String(payload?.src || "").trim();
    if (!src && payload?.file) {
      src = await this._readBlobAsDataUrl(payload.file);
    }
    if (!src) {
      this._setStatus("Clipboard image unavailable");
      return false;
    }
    return this._insertImageElementFromSource(src, {
      historyLabel: "paste-image",
      statusMessage: "Image pasted",
    });
  }

  _onPaste(event) {
    if (!this.root || this.root.style.display === "none" || !this.sheetDraft) return;
    const active = document.activeElement;
    const tag = String(active?.tagName || "").toUpperCase();
    if (active?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    const elementPayload = this._parseClipboardElementPayload(event);
    if (elementPayload) {
      if (!this._pasteClipboardElements(elementPayload)) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const imagePayload = this._getClipboardImagePayload(event);
    if (imagePayload) {
      event.preventDefault();
      event.stopPropagation();
      void this._pasteClipboardImage(imagePayload);
      return;
    }

    const selected = this._getSelectedElement();
    const allowSingleCell = isTableElementType(selected) && !!this._getActiveTableSelectionRect(selected);
    const parsed = this._parseClipboardTable(event, { allowSingleCell });
    if (!parsed) return;

    if (allowSingleCell) {
      if (!this._pasteIntoSelectedTable(parsed)) return;
      this._setStatus("Table pasted");
    } else {
      if (!this._insertTableFromClipboardData(parsed)) return;
      this._setStatus("Table inserted from clipboard");
    }

    event.preventDefault();
    event.stopPropagation();
  }

  _onCopy(event) {
    if (!this.root || this.root.style.display === "none" || !this.sheetDraft) return;
    const active = document.activeElement;
    const tag = String(active?.tagName || "").toUpperCase();
    if (active?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!this._copySelectedElementsToClipboard(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  _renderAll() {
    this._renderSidebarOnly();
    this._renderStageOnly();
    this._renderInspector();
  }

  _renderSelectionToolbar() {
    const selectionCount = this._getSelectedElementIds().length;
    const selected = selectionCount === 1 ? this._getSelectedElement() : null;
    const hasElement = !!selected;
    const textState = selectionCount === 1 ? this._getSelectedTextState() : null;
    const supportsText = !!textState;
    const formboardTextOnly = !!textState?.isFormboard;
    const isPMI = hasElement && selected.type === "pmiInset";
    const isLine = hasElement && selected.type === "line";

    if (this._toolbarSelectionStyleGroup) {
      this._toolbarSelectionStyleGroup.style.display = hasElement ? "flex" : "none";
    }
    if (this._toolbarSelectionTextGroup) {
      this._toolbarSelectionTextGroup.style.display = supportsText ? "flex" : "none";
    }

    if (!hasElement) {
      this._closeToolbarPopover();
      if (this._toolbarBoldBtn) this._toolbarBoldBtn.classList.remove("primary");
      if (this._toolbarItalicBtn) this._toolbarItalicBtn.classList.remove("primary");
      if (this._toolbarUnderlineBtn) this._toolbarUnderlineBtn.classList.remove("primary");
      if (this._toolbarAlignmentButton) {
        this._toolbarAlignmentButton.title = "Text alignment";
        this._toolbarAlignmentButton.setAttribute("aria-label", "Text alignment");
      }
      return;
    }

    if (((!supportsText || formboardTextOnly) && (this._toolbarPopoverKind === "textColor" || this._toolbarPopoverKind === "textAlign"))
      || ((isLine || isPMI) && this._toolbarPopoverKind === "fillColor")) {
      this._closeToolbarPopover();
    }

    if (this._toolbarFillButton) this._toolbarFillButton.style.display = (!isLine && !isPMI) ? "" : "none";
    if (this._toolbarStrokeButton) this._toolbarStrokeButton.style.display = "";
    if (this._toolbarStrokeWidthButton) this._toolbarStrokeWidthButton.style.display = "";
    if (this._toolbarLineStyleButton) this._toolbarLineStyleButton.style.display = "";
    if (this._toolbarFontFamilyInput) {
      this._toolbarFontFamilyInput.disabled = !supportsText || formboardTextOnly;
      this._toolbarFontFamilyInput.style.display = formboardTextOnly ? "none" : "";
    }
    if (this._toolbarFontSizeInput) this._toolbarFontSizeInput.disabled = !supportsText;
    if (this._toolbarFontSizeDecrementBtn) this._toolbarFontSizeDecrementBtn.disabled = !supportsText;
    if (this._toolbarFontSizeIncrementBtn) this._toolbarFontSizeIncrementBtn.disabled = !supportsText;
    if (this._toolbarTextColorButton) this._toolbarTextColorButton.style.display = formboardTextOnly ? "none" : "";
    if (this._toolbarBoldBtn) this._toolbarBoldBtn.style.display = formboardTextOnly ? "none" : "";
    if (this._toolbarItalicBtn) this._toolbarItalicBtn.style.display = formboardTextOnly ? "none" : "";
    if (this._toolbarUnderlineBtn) this._toolbarUnderlineBtn.style.display = formboardTextOnly ? "none" : "";
    if (this._toolbarAlignmentButton) this._toolbarAlignmentButton.style.display = formboardTextOnly ? "none" : "";

    if (!supportsText) {
      if (this._toolbarBoldBtn) this._toolbarBoldBtn.classList.remove("primary");
      if (this._toolbarItalicBtn) this._toolbarItalicBtn.classList.remove("primary");
      if (this._toolbarUnderlineBtn) this._toolbarUnderlineBtn.classList.remove("primary");
      if (this._toolbarAlignmentButton) {
        this._toolbarAlignmentButton.title = "Text alignment";
        this._toolbarAlignmentButton.setAttribute("aria-label", "Text alignment");
      }
      return;
    }

    if (this._toolbarFontFamilyInput) {
      this._toolbarFontFamilyInput.value = String(textState.fontFamily || "Arial, Helvetica, sans-serif");
    }
    if (this._toolbarFontSizeInput) {
      this._toolbarFontSizeInput.value = String(Math.round(inchesToPoints(toFiniteNumber(textState.fontSize, 0.32))));
    }
    if (this._toolbarBoldBtn) {
      this._toolbarBoldBtn.classList.toggle("primary", String(textState.fontWeight || "400") === "700");
    }
    if (this._toolbarItalicBtn) {
      this._toolbarItalicBtn.classList.toggle("primary", String(textState.fontStyle || "normal") === "italic");
    }
    if (this._toolbarUnderlineBtn) {
      this._toolbarUnderlineBtn.classList.toggle("primary", String(textState.textDecoration || "none") === "underline");
    }
    const textAlign = String(textState.textAlign || "left");
    const verticalAlign = String(textState.verticalAlign || "middle");
    if (this._toolbarAlignmentButton) {
      this._toolbarAlignmentButton.title = `Text alignment (${textAlign}, ${verticalAlign})`;
      this._toolbarAlignmentButton.setAttribute("aria-label", `Text alignment (${textAlign}, ${verticalAlign})`);
    }
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
        this._clearSelection();
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
      const { paintHeightPx } = this._getLineRenderMetrics(el, ppi);
      node.style.left = `${x1}px`;
      node.style.top = `${y1 - (paintHeightPx * 0.5)}px`;
      node.style.width = `${len}px`;
      node.style.height = `${paintHeightPx}px`;
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
          content.className = "sheet-slides-element-content";
          content.style.background = toCssColor(el.fill, "transparent");
          const textBody = document.createElement("div");
          textBody.className = "sheet-slides-inline-text";
          const textInner = document.createElement("div");
          textInner.className = "sheet-slides-inline-text-body";
          textInner.textContent = String(el.text || "");
          textBody.appendChild(textInner);
          this._applyTextStyles(textBody, el, ppi);
          textBody.style.padding = "4px";
          content.appendChild(textBody);
          node.appendChild(content);
          this._appendStrokeOverlay(node, el, wPx, hPx, { shape: "rect", radiusPx: 8 });
        } else if (isShapeElementType(el.type)) {
          const content = this._buildShapeContentNode(el, wPx, hPx, ppi);
          if (content) node.appendChild(content);
        } else if (el.type === "image") {
          node.style.background = toCssColor(el.fill, "transparent");
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
          this._appendStrokeOverlay(node, el, wPx, hPx, { shape: "rect", radiusPx: 8 });
        } else if (el.type === "pmiInset") {
          const pmiViewName = this._resolvePmiViewDisplayName(el);
          const labelPosition = this._getPmiLabelPosition(el);
          node.style.background = "transparent";
          node.style.overflow = "visible";
          const captionHeightPx = Math.max(0, this._getPmiTitleHeightIn(el) * ppi);
          const mediaHeightPx = Math.max(1, hPx - captionHeightPx);
          const frame = document.createElement("div");
          frame.className = "sheet-slides-pmi-frame";
          frame.style.height = `${mediaHeightPx}px`;
          frame.style.top = `${labelPosition === "top" ? captionHeightPx : 0}px`;
          frame.style.background = toCssColor(el.fill, "transparent");
          const host = document.createElement("div");
          host.className = "sheet-slides-pmi-host";
          host.style.height = "100%";
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
          frame.appendChild(host);
          node.appendChild(frame);
          if (labelPosition !== "none") {
            const caption = document.createElement("div");
            caption.className = `sheet-slides-pmi-caption ${labelPosition === "top" ? "is-top" : "is-bottom"}`;
            caption.textContent = pmiViewName;
            caption.style.height = `${captionHeightPx}px`;
            this._applyPmiCaptionStyles(caption, ppi, captionHeightPx);
            node.appendChild(caption);
          }
          this._appendStrokeOverlay(frame, el, wPx, mediaHeightPx, { shape: "rect", radiusPx: 8 });
        } else if (el.type === "table") {
          const tableContent = this._buildTableContentNode(el, wPx, hPx, ppi, { interactive: false });
          if (tableContent) node.appendChild(tableContent);
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
    if (!canvas || !stageShell) return;

    const sheet = this.sheetDraft;
    if (!sheet) {
      stageShell.textContent = "";
      stageShell.appendChild(canvas);
      canvas.textContent = "";
      canvas.style.width = "240px";
      canvas.style.height = "160px";
      canvas.style.transform = "none";
      stageShell.style.width = "240px";
      stageShell.style.height = "160px";
      stageShell.style.transform = "translate(0px, 0px)";
      this._appliedZoom = 1;
      this._appliedStagePanX = 0;
      this._appliedStagePanY = 0;
      this._syncZoomControl();
      this._disposeUnusedPmiViewports(new Set());
      return;
    }

    stageShell.textContent = "";
    stageShell.appendChild(canvas);
    canvas.textContent = "";
    canvas.style.background = toCssColor(sheet.background, "#ffffff");
    this._appliedZoom = this._zoomMode === "fit"
      ? this._computeFitZoom(sheet)
      : this._clampStageZoom(this.zoom, DEFAULT_ZOOM);
    const renderPpi = this._getStageRenderPpi(this._appliedZoom);
    const renderWidthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * renderPpi);
    const renderHeightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * renderPpi);
    if (this._zoomMode === "fit") {
      const fitPan = this._computeFitStagePan(sheet, this._appliedZoom);
      this._appliedStagePanX = fitPan.x;
      this._appliedStagePanY = fitPan.y;
    } else {
      this._appliedStagePanX = toFiniteNumber(this._stagePanX, 0);
      this._appliedStagePanY = toFiniteNumber(this._stagePanY, 0);
    }
    canvas.style.transform = "none";
    canvas.style.width = `${renderWidthPx}px`;
    canvas.style.height = `${renderHeightPx}px`;
    stageShell.style.width = `${Math.max(1, renderWidthPx)}px`;
    stageShell.style.height = `${Math.max(1, renderHeightPx)}px`;
    stageShell.style.transform = `translate(${this._appliedStagePanX}px, ${this._appliedStagePanY}px)`;
    canvas.classList.toggle("show-grid", !!this.showGrid);
    this._syncViewportControls();

    const grid = document.createElement("div");
    grid.className = "sheet-slides-grid";
    grid.style.setProperty("--sheet-slides-grid-step", `${Math.max(8, 40 * this._appliedZoom)}px`);
    canvas.appendChild(grid);

    const usedPmiIds = new Set();

    const elements = sortElements(sheet.elements || []);
    for (const element of elements) {
      const node = this._buildElementNode(element, usedPmiIds);
      if (!node) continue;
      canvas.appendChild(node);
    }

    const selectedOverlay = this._buildSelectionOverlay(this._getSelectedElements());
    if (selectedOverlay) {
      canvas.appendChild(selectedOverlay);
    }

    this._disposeUnusedPmiViewports(usedPmiIds);
    this._statusRight.textContent = `${Math.round(renderWidthPx)} × ${Math.round(renderHeightPx)} px @ ${Math.round(this._appliedZoom * 100)}%`;
  }

  _buildElementNode(element, usedPmiIds) {
    if (!element || typeof element !== "object") return null;

    const ppi = this._getStageRenderPpi();
    const node = document.createElement("div");
    const selected = this._isElementSelected(element.id);
    const cropActive = selected && this._getSelectedElementIds().length === 1 && this._isCropModeForElement(element) && elementSupportsMediaCrop(element);
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
      const { paintHeightPx, hitHeightPx, contentOffsetPx } = this._getLineRenderMetrics(element, ppi, { interactive: true });
      node.style.left = `${x1}px`;
      node.style.top = `${y1 - (hitHeightPx * 0.5)}px`;
      node.style.width = `${len}px`;
      node.style.height = `${hitHeightPx}px`;
      node.style.transformOrigin = "left center";
      node.style.transform = `rotate(${angle}deg)`;

      const content = document.createElement("div");
      content.className = "sheet-slides-element-content";
      content.style.width = "100%";
      content.style.height = `${paintHeightPx}px`;
      content.style.marginTop = `${contentOffsetPx}px`;
      this._applyLineStrokeStyles(content, element, paintHeightPx);
      node.appendChild(content);

      node.addEventListener("pointerdown", (event) => this._onElementPointerDown(event, element.id));
      return node;
    }

    const xPx = toFiniteNumber(element.x, 0) * ppi;
    const yPx = toFiniteNumber(element.y, 0) * ppi;
    const wPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
    const hPx = Math.max(1, toFiniteNumber(element.h, 1) * ppi);
    const mediaFrameBox = (elementSupportsMediaCrop(element) || element?.type === "pmiInset")
      ? this._getMediaFrameBox(element)
      : null;
    const mediaFrameHeightPx = mediaFrameBox ? Math.max(1, mediaFrameBox.h * ppi) : hPx;

    node.style.left = `${xPx}px`;
    node.style.top = `${yPx}px`;
    node.style.width = `${wPx}px`;
    node.style.height = `${hPx}px`;
    node.style.transform = `rotate(${toFiniteNumber(element.rotationDeg, 0)}deg)`;

    const content = document.createElement("div");
    content.className = "sheet-slides-element-content";

    if (element.type === "text") {
      content.style.background = toCssColor(element.fill, "transparent");
      const textBody = document.createElement("div");
      textBody.className = "sheet-slides-inline-text";
      const textInner = document.createElement("div");
      textInner.className = "sheet-slides-inline-text-body";
      textInner.textContent = String(element.text || "");
      textBody.appendChild(textInner);
      this._applyTextStyles(textBody, element, ppi);
      textBody.style.padding = "4px";
      content.appendChild(textBody);
      this._appendStrokeOverlay(node, element, wPx, hPx, { shape: "rect", radiusPx: 8 });
    } else if (isShapeElementType(element.type)) {
      const shapeContent = this._buildShapeContentNode(element, wPx, hPx, ppi);
      if (shapeContent) {
        while (shapeContent.firstChild) {
          content.appendChild(shapeContent.firstChild);
        }
      }
    } else if (element.type === "image") {
      content.style.background = toCssColor(element.fill, "transparent");
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
      this._appendStrokeOverlay(node, element, wPx, hPx, { shape: "rect", radiusPx: 8 });
    } else if (element.type === "pmiInset") {
      const pmiViewName = this._resolvePmiViewDisplayName(element);
      const labelPosition = this._getPmiLabelPosition(element);
      content.style.background = "transparent";
      content.style.overflow = "visible";
      content.classList.add("sheet-slides-pmi-body");
      const frame = document.createElement("div");
      frame.className = "sheet-slides-pmi-frame";
      frame.style.height = `${mediaFrameHeightPx}px`;
      frame.style.top = `${labelPosition === "top" ? (hPx - mediaFrameHeightPx) : 0}px`;
      frame.style.background = toCssColor(element.fill, "transparent");
      content.appendChild(frame);
      const host = document.createElement("div");
      host.className = "sheet-slides-pmi-host";
      host.dataset.cropTarget = "media";
      host.style.height = "100%";
      frame.appendChild(host);

      if (labelPosition !== "none") {
        const footer = document.createElement("div");
        footer.className = `sheet-slides-pmi-caption ${labelPosition === "top" ? "is-top" : "is-bottom"}`;
        footer.textContent = pmiViewName;
        footer.style.height = `${Math.max(0, hPx - mediaFrameHeightPx)}px`;
        this._applyPmiCaptionStyles(footer, ppi, Math.max(0, hPx - mediaFrameHeightPx));
        content.appendChild(footer);
      }

      this._attachPmiViewport(element, host, wPx, mediaFrameHeightPx, usedPmiIds);
      this._appendStrokeOverlay(frame, element, wPx, mediaFrameHeightPx, { shape: "rect", radiusPx: 8 });
    } else if (element.type === "table") {
      const tableContent = this._buildTableContentNode(element, wPx, hPx, ppi, { interactive: true });
      if (tableContent) {
        while (tableContent.firstChild) {
          content.appendChild(tableContent.firstChild);
        }
      }
    } else {
      content.style.background = toCssColor(element.fill, "#dbeafe");
    }

    node.appendChild(content);

    node.addEventListener("pointerdown", (event) => this._onElementPointerDown(event, element.id));
    node.addEventListener("dblclick", (event) => this._onElementDoubleClick(event, element.id));
    return node;
  }

  _annotateExportMediaFrame(frameNode, element, kind = "image") {
    if (!frameNode) return;
    frameNode.dataset.exportMediaFrame = "true";
    frameNode.dataset.exportMediaKind = String(kind || "image");
    frameNode.dataset.exportMediaScale = String(clamp(toFiniteNumber(element?.mediaScale, 1), MIN_MEDIA_SCALE, MAX_MEDIA_SCALE));
    frameNode.dataset.exportMediaOffsetX = String(clamp(toFiniteNumber(element?.mediaOffsetX, 0), -1, 1));
    frameNode.dataset.exportMediaOffsetY = String(clamp(toFiniteNumber(element?.mediaOffsetY, 0), -1, 1));
  }

  _buildPdfElementNode(element, ppi) {
    if (!element || typeof element !== "object") return null;

    const node = document.createElement("div");
    node.className = "sheet-slides-element";
    node.dataset.id = String(element.id || "");
    node.dataset.type = String(element.type || "");
    node.style.opacity = String(clamp(toFiniteNumber(element.opacity, 1), 0, 1));
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
      const { paintHeightPx } = this._getLineRenderMetrics(element, ppi);
      node.style.left = `${x1}px`;
      node.style.top = `${y1 - (paintHeightPx * 0.5)}px`;
      node.style.width = `${len}px`;
      node.style.height = `${paintHeightPx}px`;
      node.style.transformOrigin = "left center";
      node.style.transform = `rotate(${angle}deg)`;

      const content = document.createElement("div");
      content.className = "sheet-slides-element-content";
      content.style.width = "100%";
      content.style.height = "100%";
      this._applyLineStrokeStyles(content, element, paintHeightPx);
      node.appendChild(content);
      return node;
    }

    const xPx = toFiniteNumber(element.x, 0) * ppi;
    const yPx = toFiniteNumber(element.y, 0) * ppi;
    const wPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
    const hPx = Math.max(1, toFiniteNumber(element.h, 1) * ppi);
    const mediaFrameBox = (elementSupportsMediaCrop(element) || element?.type === "pmiInset")
      ? this._getMediaFrameBox(element)
      : null;
    const mediaFrameHeightPx = mediaFrameBox ? Math.max(1, mediaFrameBox.h * ppi) : hPx;

    node.style.left = `${xPx}px`;
    node.style.top = `${yPx}px`;
    node.style.width = `${wPx}px`;
    node.style.height = `${hPx}px`;
    node.style.transform = `rotate(${toFiniteNumber(element.rotationDeg, 0)}deg)`;

    const content = document.createElement("div");
    content.className = "sheet-slides-element-content";

    if (element.type === "text") {
      content.style.background = toCssColor(element.fill, "transparent");
      const textBody = document.createElement("div");
      textBody.className = "sheet-slides-inline-text";
      const textInner = document.createElement("div");
      textInner.className = "sheet-slides-inline-text-body";
      textInner.textContent = String(element.text || "");
      textBody.appendChild(textInner);
      this._applyTextStyles(textBody, element, ppi);
      textBody.style.padding = "4px";
      content.appendChild(textBody);
      this._appendStrokeOverlay(node, element, wPx, hPx, { shape: "rect", radiusPx: 8 });
    } else if (isShapeElementType(element.type)) {
      const shapeContent = this._buildShapeContentNode(element, wPx, hPx, ppi);
      if (shapeContent) {
        while (shapeContent.firstChild) {
          content.appendChild(shapeContent.firstChild);
        }
      }
    } else if (element.type === "image") {
      content.style.background = toCssColor(element.fill, "transparent");
      content.style.borderRadius = "8px";
      content.style.overflow = "hidden";
      const mediaFrame = document.createElement("div");
      mediaFrame.className = "sheet-slides-media-frame";
      this._annotateExportMediaFrame(mediaFrame, element, "image");
      mediaFrame.style.background = toCssColor(element.fill, "transparent");
      const media = document.createElement("img");
      media.className = "sheet-slides-media-image";
      media.alt = "";
      media.draggable = false;
      media.src = String(element.src || "");
      this._applyMediaCropStyles(media, element, wPx, hPx);
      mediaFrame.appendChild(media);
      content.appendChild(mediaFrame);
      this._appendStrokeOverlay(node, element, wPx, hPx, { shape: "rect", radiusPx: 8 });
    } else if (element.type === "pmiInset") {
      const labelPosition = this._getPmiLabelPosition(element);
      content.style.background = "transparent";
      content.style.overflow = "visible";
      content.classList.add("sheet-slides-pmi-body");

      const frame = document.createElement("div");
      frame.className = "sheet-slides-pmi-frame";
      frame.style.height = `${mediaFrameHeightPx}px`;
      frame.style.top = `${labelPosition === "top" ? (hPx - mediaFrameHeightPx) : 0}px`;
      frame.style.background = toCssColor(element.fill, "transparent");
      content.appendChild(frame);

      const host = document.createElement("div");
      host.className = "sheet-slides-pmi-host";
      host.style.height = "100%";
      this._annotateExportMediaFrame(host, element, "pmiInset");
      frame.appendChild(host);

      const src = String(element.src || "").trim();
      if (src) {
        const img = document.createElement("img");
        img.className = "sheet-slides-media-image sheet-slides-pmi-image";
        img.alt = this._resolvePmiViewDisplayName(element);
        img.draggable = false;
        img.src = src;
        this._applyMediaCropStyles(img, element, wPx, mediaFrameHeightPx);
        host.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "sheet-slides-pmi-placeholder";
        placeholder.textContent = "PMI image unavailable";
        host.appendChild(placeholder);
      }

      if (labelPosition !== "none") {
        const footer = document.createElement("div");
        footer.className = `sheet-slides-pmi-caption ${labelPosition === "top" ? "is-top" : "is-bottom"}`;
        footer.textContent = this._resolvePmiViewDisplayName(element);
        const captionHeightPx = Math.max(0, hPx - mediaFrameHeightPx);
        footer.style.height = `${captionHeightPx}px`;
        this._applyPmiCaptionStyles(footer, ppi, captionHeightPx);
        content.appendChild(footer);
      }

      this._appendStrokeOverlay(frame, element, wPx, mediaFrameHeightPx, { shape: "rect", radiusPx: 8 });
    } else if (element.type === "table") {
      const tableContent = this._buildTableContentNode(element, wPx, hPx, ppi, { interactive: false });
      if (tableContent) {
        while (tableContent.firstChild) {
          content.appendChild(tableContent.firstChild);
        }
      }
    } else {
      content.style.background = toCssColor(element.fill, "#dbeafe");
    }

    node.appendChild(content);
    return node;
  }

  _buildPdfPageNode(sheet) {
    if (!sheet || typeof sheet !== "object") return null;
    const ppi = Math.max(1, toFiniteNumber(sheet.pxPerInch, 96));
    const widthPx = Math.max(100, toFiniteNumber(sheet.widthIn, 11) * ppi);
    const heightPx = Math.max(100, toFiniteNumber(sheet.heightIn, 8.5) * ppi);

    const page = document.createElement("section");
    page.className = "sheet-slides-pdf-page";
    page.dataset.sheetPpi = String(ppi);
    page.style.position = "relative";
    page.style.display = "block";
    page.style.overflow = "hidden";
    page.style.background = toCssColor(sheet.background, "#ffffff");
    page.style.width = `${widthPx}px`;
    page.style.height = `${heightPx}px`;

    const canvas = document.createElement("div");
    canvas.className = "sheet-slides-canvas sheet-slides-pdf-canvas";
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    canvas.style.background = toCssColor(sheet.background, "#ffffff");
    canvas.style.borderRadius = "0";
    canvas.style.boxShadow = "none";
    canvas.style.overflow = "hidden";
    page.appendChild(canvas);

    const elements = sortElements(sheet.elements || []);
    for (const element of elements) {
      const node = this._buildPdfElementNode(element, ppi);
      if (node) canvas.appendChild(node);
    }

    return page;
  }

  _getPdfRasterScale(node) {
    const width = Math.max(1, toFiniteNumber(node?.offsetWidth, 0));
    const height = Math.max(1, toFiniteNumber(node?.offsetHeight, 0));
    const area = Math.max(1, width * height);
    const basePpi = Math.max(1, toFiniteNumber(node?.dataset?.sheetPpi, 96));
    const targetScale = PDF_TARGET_DPI / basePpi;
    const maxDimensionScale = 4096 / Math.max(width, height);
    const maxAreaScale = Math.sqrt(16000000 / area);
    return clamp(Math.min(targetScale, maxDimensionScale, maxAreaScale), 1, 4);
  }

  _applyExportMediaLayout(frame) {
    if (!frame) return;
    const img = frame.querySelector(".sheet-slides-media-image");
    if (!img) return;
    const frameWidth = Math.max(1, toFiniteNumber(frame.clientWidth, 0));
    const frameHeight = Math.max(1, toFiniteNumber(frame.clientHeight, 0));
    const metadata = {
      width: Math.max(1, toFiniteNumber(img.naturalWidth, frameWidth)),
      height: Math.max(1, toFiniteNumber(img.naturalHeight, frameHeight)),
    };
    const kind = String(frame.dataset.exportMediaKind || "image");
    const layout = this._getMediaLayout({
      type: kind,
      mediaScale: toFiniteNumber(frame.dataset.exportMediaScale, 1),
      mediaOffsetX: toFiniteNumber(frame.dataset.exportMediaOffsetX, 0),
      mediaOffsetY: toFiniteNumber(frame.dataset.exportMediaOffsetY, 0),
    }, frameWidth, frameHeight, metadata);
    img.style.position = "absolute";
    img.style.left = `${layout.left}px`;
    img.style.top = `${layout.top}px`;
    img.style.width = `${layout.renderWidth}px`;
    img.style.height = `${layout.renderHeight}px`;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "fill";
    img.style.objectPosition = "center center";
    img.style.transform = "none";
  }

  _applyExportMediaLayouts(root) {
    for (const frame of root?.querySelectorAll?.('[data-export-media-frame="true"]') || []) {
      this._applyExportMediaLayout(frame);
    }
  }

  async _waitForImagesInNode(root) {
    const images = Array.from(root?.querySelectorAll?.("img") || []);
    await Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch { }
    }
  }

  _waitForPaint(frameCount = 1) {
    const totalFrames = Math.max(1, Math.round(toFiniteNumber(frameCount, 1)));
    return new Promise((resolve) => {
      const tick = (remaining) => {
        requestAnimationFrame(() => {
          if (remaining <= 1) resolve();
          else tick(remaining - 1);
        });
      };
      tick(totalFrames);
    });
  }

  _setPdfExportBusy(active) {
    const busy = !!active;
    this._isExportingPdf = busy;
    if (this.root) {
      this.root.setAttribute("aria-busy", busy ? "true" : "false");
    }
    if (this._pdfBtn) {
      this._pdfBtn.disabled = busy;
    }
    if (this._pdfProgressOverlay) {
      this._pdfProgressOverlay.style.display = busy ? "grid" : "none";
      this._pdfProgressOverlay.setAttribute("aria-hidden", busy ? "false" : "true");
    }
  }

  _renderPdfExportPreview(sheet) {
    const preview = this._pdfProgressPreview;
    if (!preview) return;
    preview.textContent = "";
    if (!sheet) {
      const placeholder = document.createElement("div");
      placeholder.className = "sheet-slides-pdf-progress-preview-empty";
      placeholder.textContent = "Preparing preview";
      preview.appendChild(placeholder);
      return;
    }
    this._renderMiniSheet(sheet, preview);
  }

  _setPdfExportProgress({
    title = "Generating PDF",
    detail = "",
    hint = "Please wait while each sheet is prepared for export.",
    completed = 0,
    total = 0,
    sheet = null,
    sheetLabel = "",
  } = {}) {
    const safeTotal = Math.max(0, Math.round(toFiniteNumber(total, 0)));
    const clampedCompleted = clamp(toFiniteNumber(completed, 0), 0, safeTotal || 1);
    const percent = safeTotal > 0 ? Math.round((clampedCompleted / safeTotal) * 100) : 0;
    if (this._pdfProgressTitle) this._pdfProgressTitle.textContent = String(title || "Generating PDF");
    if (this._pdfProgressDetail) this._pdfProgressDetail.textContent = String(detail || "");
    if (this._pdfProgressMeta) {
      this._pdfProgressMeta.textContent = safeTotal > 0
        ? `${Math.min(safeTotal, Math.floor(clampedCompleted) + (clampedCompleted < safeTotal ? 1 : 0))} of ${safeTotal} sheets`
        : "Preparing sheets";
    }
    if (this._pdfProgressHint) this._pdfProgressHint.textContent = String(hint || "");
    if (this._pdfProgressPercent) this._pdfProgressPercent.textContent = `${percent}%`;
    if (this._pdfProgressFill) this._pdfProgressFill.style.width = `${percent}%`;
    if (this._pdfProgressPreviewLabel) {
      this._pdfProgressPreviewLabel.textContent = sheetLabel || "Current sheet";
    }
    this._renderPdfExportPreview(sheet);
  }

  _resetPdfExportProgress() {
    this._setPdfExportProgress({
      title: "Generating PDF",
      detail: "Preparing sheets for export",
      hint: "Preparing sheet geometry for export.",
      completed: 0,
      total: 0,
      sheet: null,
      sheetLabel: "Current sheet",
    });
  }

  _downloadPdfBytes(bytes, filename) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) return;
    const safeName = String(filename || "brep-io-sheets.pdf").trim() || "brep-io-sheets.pdf";
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { }
    }, 30000);
  }

  async _renderPdfPageCanvas(pageNode, rasterScale) {
    return html2canvas(pageNode, {
      backgroundColor: null,
      scale: rasterScale,
      useCORS: true,
      logging: false,
      foreignObjectRendering: true,
    });
  }

  _sheetCanUseVectorPdf(sheet) {
    const elements = Array.isArray(sheet?.elements) ? sheet.elements : [];
    return elements.every((element) => this._isVectorPdfElement(element));
  }

  _isVectorPdfElement(element) {
    const type = String(element?.type || "");
    if (type === "image" || type === "pmiInset") {
      return Math.abs(toFiniteNumber(element?.rotationDeg, 0)) <= 1e-6;
    }
    if (type === "line" || type === "text" || isShapeElementType(type)) return true;
    if (type === "table") {
      return Math.abs(toFiniteNumber(element?.rotationDeg, 0)) <= 1e-6;
    }
    return false;
  }

  _getPdfPaintMode(hasFill, hasStroke) {
    if (hasFill && hasStroke) return "DF";
    if (hasFill) return "F";
    if (hasStroke) return "S";
    return null;
  }

  _getPdfDashPattern(styleValue, strokeWidthIn) {
    const unit = Math.max(0.001, toFiniteNumber(strokeWidthIn, 0.01));
    switch (styleValue) {
      case "dotted":
        return [unit, unit * 2.6];
      case "dashed":
        return [unit * 5, unit * 3];
      case "dashDot":
        return [unit * 5, unit * 2.5, unit, unit * 2.5];
      case "longDash":
        return [unit * 8, unit * 3];
      case "dashDotDot":
        return [unit * 5, unit * 2.3, unit, unit * 2.2, unit, unit * 2.3];
      default:
        return [];
    }
  }

  _setPdfLineStyle(doc, element) {
    const styleValue = this._getLineStyleValue(element);
    const strokeWidthIn = Math.max(0, toFiniteNumber(element?.strokeWidth, this._defaultStrokeWidthForElement(element)));
    const hasStroke = strokeWidthIn > 0 && styleValue !== "none";
    if (!hasStroke) {
      doc.setLineDashPattern([], 0);
      return { hasStroke: false, strokeWidthIn: 0 };
    }
    const strokeColor = getPdfColorComponents(element?.stroke, this._defaultStrokeForElement(element));
    doc.setLineWidth(Math.max(0.001, strokeWidthIn));
    if (strokeColor) doc.setDrawColor(...strokeColor);
    doc.setLineDashPattern(this._getPdfDashPattern(styleValue, strokeWidthIn), 0);
    return { hasStroke: true, strokeWidthIn };
  }

  _withPdfGraphicsState(doc, opacity, callback) {
    if (!doc || typeof callback !== "function") return;
    doc.saveGraphicsState();
    try {
      const safeOpacity = clamp(toFiniteNumber(opacity, 1), 0, 1);
      if (safeOpacity < 0.999 && typeof doc.setGState === "function" && typeof doc.GState === "function") {
        doc.setGState(new doc.GState({ opacity: safeOpacity, strokeOpacity: safeOpacity }));
      }
      callback();
    } finally {
      doc.restoreGraphicsState();
    }
  }

  _setPdfTextStyle(doc, textState) {
    const family = String(textState?.fontFamily || "Arial").toLowerCase();
    const weight = String(textState?.fontWeight || "400");
    const style = String(textState?.fontStyle || "normal").toLowerCase();
    let pdfFamily = "helvetica";
    if (family.includes("times") || family.includes("serif") || family.includes("georgia")) pdfFamily = "times";
    else if (family.includes("courier") || family.includes("mono")) pdfFamily = "courier";
    const bold = weight === "700" || weight === "800" || weight === "900" || weight === "bold";
    const italic = style === "italic" || style === "oblique";
    const pdfStyle = bold && italic ? "bolditalic" : (bold ? "bold" : (italic ? "italic" : "normal"));
    doc.setFont(pdfFamily, pdfStyle);
    doc.setFontSize(Math.max(6, inchesToPoints(toFiniteNumber(textState?.fontSize, 0.32))));
    const color = getPdfColorComponents(textState?.color, this._defaultTextColorForElement(textState?.element || null));
    if (color) doc.setTextColor(...color);
  }

  _drawPdfClosedPolygon(doc, points, mode) {
    if (!doc || !Array.isArray(points) || points.length < 2 || !mode) return;
    const [first, ...rest] = points;
    const rel = [];
    let prev = first;
    for (const point of rest) {
      rel.push([point.x - prev.x, point.y - prev.y]);
      prev = point;
    }
    doc.lines(rel, first.x, first.y, [1, 1], mode, true);
  }

  _buildPdfShapePoints(element, x, y, w, h) {
    const type = String(element?.type || "");
    const left = x;
    const top = y;
    const right = x + w;
    const bottom = y + h;
    const cx = x + (w * 0.5);
    const cy = y + (h * 0.5);
    const adjust = clampShapeAdjust(type, element?.shapeAdjust);
    if (type === "ellipse") {
      const points = [];
      for (let index = 0; index < 32; index += 1) {
        const angle = (Math.PI * 2 * index) / 32;
        points.push({ x: cx + (Math.cos(angle) * w * 0.5), y: cy + (Math.sin(angle) * h * 0.5) });
      }
      return points;
    }
    let basePoints = [];
    if (type === "triangle") {
      basePoints = [{ x: cx, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
    } else if (type === "diamond") {
      basePoints = [{ x: cx, y: top }, { x: right, y: cy }, { x: cx, y: bottom }, { x: left, y: cy }];
    } else if (type === "pentagon") {
      for (let index = 0; index < 5; index += 1) {
        const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / 5);
        basePoints.push({ x: cx + (Math.cos(angle) * w * 0.5), y: cy + (Math.sin(angle) * h * 0.5) });
      }
    } else if (type === "hexagon") {
      basePoints = [
        { x: left + (w * 0.25), y: top },
        { x: right - (w * 0.25), y: top },
        { x: right, y: cy },
        { x: right - (w * 0.25), y: bottom },
        { x: left + (w * 0.25), y: bottom },
        { x: left, y: cy },
      ];
    } else if (type === "parallelogram") {
      const skew = w * adjust;
      basePoints = [
        { x: left + skew, y: top },
        { x: right, y: top },
        { x: right - skew, y: bottom },
        { x: left, y: bottom },
      ];
    } else if (type === "trapezoid") {
      const inset = w * adjust;
      basePoints = [
        { x: left + inset, y: top },
        { x: right - inset, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ];
    } else {
      basePoints = makeRotatedRectPoints(x, y, w, h, 0);
    }

    const rotationDeg = toFiniteNumber(element?.rotationDeg, 0);
    if (Math.abs(rotationDeg) <= 1e-6) return basePoints;
    return basePoints.map((point) => rotatePoint(point.x, point.y, cx, cy, rotationDeg));
  }

  _drawPdfTextBlock(doc, element, {
    x,
    y,
    w,
    h,
    rotationDeg = 0,
    paddingX = 4 / 96,
    paddingY = 4 / 96,
  } = {}) {
    const text = String(element?.text || "");
    if (!text) return;
    const innerX = x + Math.max(0, paddingX);
    const innerY = y + Math.max(0, paddingY);
    const innerW = Math.max(0.05, w - (Math.max(0, paddingX) * 2));
    const innerH = Math.max(0.05, h - (Math.max(0, paddingY) * 2));
    this._setPdfTextStyle(doc, { ...element, element });
    const lineHeightFactor = 1.2;
    doc.setLineHeightFactor(lineHeightFactor);
    const lines = doc.splitTextToSize(text, innerW);
    const fontSizePt = Math.max(6, inchesToPoints(toFiniteNumber(element?.fontSize, 0.32)));
    const lineHeightIn = pointsToInches(fontSizePt) * lineHeightFactor;
    const totalHeight = lines.length * lineHeightIn;
    const align = this._getTextAlignValue(element);
    const verticalAlign = this._getTextVerticalAlignValue(element);
    let startY = innerY;
    if (verticalAlign === "middle") startY = innerY + Math.max(0, (innerH - totalHeight) * 0.5);
    else if (verticalAlign === "bottom") startY = innerY + Math.max(0, innerH - totalHeight);
    const anchorX = align === "center"
      ? innerX + (innerW * 0.5)
      : (align === "right" ? innerX + innerW : innerX);
    doc.text(lines, anchorX, startY, {
      align,
      baseline: "top",
      angle: toFiniteNumber(rotationDeg, 0),
      maxWidth: innerW,
      lineHeightFactor,
    });
  }

  _drawPdfLineElement(doc, element) {
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const { hasStroke } = this._setPdfLineStyle(doc, element);
      if (!hasStroke) return;
      const x1 = toFiniteNumber(element?.x, 0);
      const y1 = toFiniteNumber(element?.y, 0);
      const x2 = toFiniteNumber(element?.x2, element?.x);
      const y2 = toFiniteNumber(element?.y2, element?.y);
      doc.line(x1, y1, x2, y2);
    });
  }

  _drawPdfTextElement(doc, element) {
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const x = toFiniteNumber(element?.x, 0);
      const y = toFiniteNumber(element?.y, 0);
      const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
      const h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
      const rotationDeg = toFiniteNumber(element?.rotationDeg, 0);
      const fillColor = isTransparentColor(element?.fill) ? null : getPdfColorComponents(element?.fill, "transparent");
      const { hasStroke } = this._setPdfLineStyle(doc, element);
      const shouldStroke = hasStroke && this._isTextBorderEnabled(element);
      const paintMode = this._getPdfPaintMode(!!fillColor, shouldStroke);
      if (paintMode) {
        if (fillColor) doc.setFillColor(...fillColor);
        if (Math.abs(rotationDeg) <= 1e-6) {
          doc.rect(x, y, w, h, paintMode);
        } else {
          this._drawPdfClosedPolygon(doc, makeRotatedRectPoints(x, y, w, h, rotationDeg), paintMode);
        }
      }
      this._drawPdfTextBlock(doc, element, { x, y, w, h, rotationDeg });
      doc.setLineDashPattern([], 0);
    });
  }

  _drawPdfShapeElement(doc, element) {
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const x = toFiniteNumber(element?.x, 0);
      const y = toFiniteNumber(element?.y, 0);
      const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
      const h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
      const rotationDeg = toFiniteNumber(element?.rotationDeg, 0);
      const options = this._getShapeRenderOptions(element, 96);
      const fillColor = isTransparentColor(options?.fillColor) ? null : getPdfColorComponents(options?.fillColor, "transparent");
      const { hasStroke } = this._setPdfLineStyle(doc, element);
      const paintMode = this._getPdfPaintMode(!!fillColor, hasStroke);
      if (paintMode) {
        if (fillColor) doc.setFillColor(...fillColor);
        if (String(options?.shape || "") === "rect" && Math.abs(rotationDeg) <= 1e-6) {
          const radiusIn = Math.max(0, toFiniteNumber(element?.cornerRadius, 0.1));
          if (radiusIn > 0) doc.roundedRect(x, y, w, h, radiusIn, radiusIn, paintMode);
          else doc.rect(x, y, w, h, paintMode);
        } else {
          this._drawPdfClosedPolygon(doc, this._buildPdfShapePoints(element, x, y, w, h), paintMode);
        }
      }
      if (String(element?.text || "").trim()) {
        this._drawPdfTextBlock(doc, element, {
          x,
          y,
          w,
          h,
          rotationDeg,
          paddingX: Math.max(0, toFiniteNumber(options?.textPaddingPx, 8)) / 96,
          paddingY: Math.max(0, toFiniteNumber(options?.textPaddingPx, 8)) / 96,
        });
      }
      doc.setLineDashPattern([], 0);
    });
  }

  _drawPdfTableElement(doc, element) {
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const x = toFiniteNumber(element?.x, 0);
      const y = toFiniteNumber(element?.y, 0);
      const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
      const h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
      const layout = this._getTableLayoutMetrics(element, w, h);
      const tableData = layout.tableData;
      const fillColor = isTransparentColor(element?.fill) ? null : getPdfColorComponents(element?.fill, "#ffffff");
      const { hasStroke, strokeWidthIn } = this._setPdfLineStyle(doc, element);
      if (fillColor) {
        doc.setFillColor(...fillColor);
        doc.rect(x, y, w, h, hasStroke ? "DF" : "F");
      } else if (hasStroke) {
        doc.rect(x, y, w, h, "S");
      }

      if (hasStroke) {
        for (let boundary = 1; boundary < layout.colCount; boundary += 1) {
          const colX = x + toFiniteNumber(layout.colStarts?.[boundary], 0);
          for (let row = 0; row < layout.rowCount; row += 1) {
            const leftAnchor = resolveTableCellAnchor(tableData, row, boundary - 1);
            const rightAnchor = resolveTableCellAnchor(tableData, row, boundary);
            if (leftAnchor && rightAnchor && leftAnchor.row === rightAnchor.row && leftAnchor.col === rightAnchor.col) continue;
            doc.line(
              colX,
              y + toFiniteNumber(layout.rowStarts?.[row], 0),
              colX,
              y + toFiniteNumber(layout.rowStarts?.[row + 1], h),
            );
          }
        }
        for (let boundary = 1; boundary < layout.rowCount; boundary += 1) {
          const rowY = y + toFiniteNumber(layout.rowStarts?.[boundary], 0);
          for (let col = 0; col < layout.colCount; col += 1) {
            const topAnchor = resolveTableCellAnchor(tableData, boundary - 1, col);
            const bottomAnchor = resolveTableCellAnchor(tableData, boundary, col);
            if (topAnchor && bottomAnchor && topAnchor.row === bottomAnchor.row && topAnchor.col === bottomAnchor.col) continue;
            doc.line(
              x + toFiniteNumber(layout.colStarts?.[col], 0),
              rowY,
              x + toFiniteNumber(layout.colStarts?.[col + 1], w),
              rowY,
            );
          }
        }
      }

      for (let row = 0; row < layout.rowCount; row += 1) {
        for (let col = 0; col < layout.colCount; col += 1) {
          const cell = getTableCell(tableData, row, col);
          if (!cell || cell?.mergedInto) continue;
          const bounds = this._getTableCellBoundsPx(layout, row, col, cell);
          if (!bounds) continue;
          const cellText = String(cell?.text || "");
          if (!cellText) continue;
          this._drawPdfTextBlock(doc, {
            ...element,
            element,
            text: cellText,
            fontFamily: this._resolveTableTextStyleValue(element, cell, "fontFamily"),
            fontSize: this._resolveTableTextStyleValue(element, cell, "fontSize"),
            fontWeight: this._resolveTableTextStyleValue(element, cell, "fontWeight"),
            fontStyle: this._resolveTableTextStyleValue(element, cell, "fontStyle"),
            textDecoration: this._resolveTableTextStyleValue(element, cell, "textDecoration"),
            textAlign: this._resolveTableTextStyleValue(element, cell, "textAlign"),
            verticalAlign: this._resolveTableTextStyleValue(element, cell, "verticalAlign"),
            color: this._resolveTableTextStyleValue(element, cell, "color"),
          }, {
            x: x + bounds.left,
            y: y + bounds.top,
            w: bounds.width,
            h: bounds.height,
            rotationDeg: 0,
            paddingX: TABLE_CELL_PADDING_PX / 96,
            paddingY: TABLE_CELL_PADDING_PX / 96,
          });
        }
      }

      if (hasStroke && strokeWidthIn > 0) doc.setLineDashPattern([], 0);
    });
  }

  async _loadPdfImage(source) {
    const src = String(source || "").trim();
    if (!src) return null;
    let pending = this._pdfImageLoadCache.get(src) || null;
    if (!pending) {
      pending = new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          const width = Math.max(1, Math.round(toFiniteNumber(image.naturalWidth, image.width)));
          const height = Math.max(1, Math.round(toFiniteNumber(image.naturalHeight, image.height)));
          this._rememberMediaMetadata(src, width, height);
          resolve(image);
        };
        image.onerror = () => {
          this._pdfImageLoadCache.delete(src);
          resolve(null);
        };
        image.src = src;
      });
      this._pdfImageLoadCache.set(src, pending);
    }
    return pending;
  }

  _getPdfMediaTileSize(frameWidthIn, frameHeightIn) {
    const widthPx = Math.max(1, Math.round(frameWidthIn * PDF_TARGET_DPI));
    const heightPx = Math.max(1, Math.round(frameHeightIn * PDF_TARGET_DPI));
    const maxDim = 2048;
    const maxArea = 4_000_000;
    const scale = clamp(Math.min(
      maxDim / Math.max(widthPx, heightPx, 1),
      Math.sqrt(maxArea / Math.max(1, widthPx * heightPx)),
      1,
    ), 0.1, 1);
    return {
      width: Math.max(1, Math.round(widthPx * scale)),
      height: Math.max(1, Math.round(heightPx * scale)),
    };
  }

  _clipRoundedCanvasRect(context, x, y, width, height, radius) {
    if (!context) return;
    const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
    context.beginPath();
    if (r <= 0) {
      context.rect(x, y, width, height);
    } else {
      context.moveTo(x + r, y);
      context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r);
      context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
      context.closePath();
    }
    context.clip();
  }

  async _renderPdfMediaTileCanvas(element, frameWidthIn, frameHeightIn, sourceOverride = null) {
    const src = String(sourceOverride || element?.src || "").trim();
    if (!src) return null;
    const image = await this._loadPdfImage(src);
    if (!image) return null;
    const metadata = this._getMediaMetadataForElement({ ...element, src }, image) || {
      width: Math.max(1, toFiniteNumber(image.naturalWidth, image.width)),
      height: Math.max(1, toFiniteNumber(image.naturalHeight, image.height)),
    };
    const layout = this._getMediaLayout({ ...element, src }, frameWidthIn, frameHeightIn, metadata);
    const size = this._getPdfMediaTileSize(frameWidthIn, frameHeightIn);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const scaleX = size.width / Math.max(MIN_ELEMENT_IN, frameWidthIn);
    const scaleY = size.height / Math.max(MIN_ELEMENT_IN, frameHeightIn);
    context.clearRect(0, 0, size.width, size.height);
    context.save();
    this._clipRoundedCanvasRect(context, 0, 0, size.width, size.height, (8 / 96) * Math.min(scaleX, scaleY));
    context.drawImage(
      image,
      layout.left * scaleX,
      layout.top * scaleY,
      layout.renderWidth * scaleX,
      layout.renderHeight * scaleY,
    );
    context.restore();
    return canvas;
  }

  _isSvgImageDataUrl(source) {
    return /^data:image\/svg\+xml/i.test(String(source || "").trim());
  }

  _decodeSvgDataUrl(source) {
    const src = String(source || "").trim();
    if (!src) return null;
    const match = src.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;(base64))?,([\s\S]*)$/i);
    if (!match) return null;
    const [, base64Flag, payload = ""] = match;
    try {
      if (base64Flag) {
        const decoder = globalThis?.atob;
        if (typeof decoder !== "function") return null;
        return decoder(payload);
      }
      return decodeURIComponent(payload);
    } catch {
      return null;
    }
  }

  _parseSvgDataUrl(source) {
    const markup = this._decodeSvgDataUrl(source);
    if (!markup || typeof DOMParser === "undefined") return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(markup, "image/svg+xml");
      if (doc.querySelector("parsererror")) return null;
      const root = doc.documentElement;
      if (!root || String(root.tagName || "").toLowerCase() !== "svg") return doc.querySelector("svg");
      return root;
    } catch {
      return null;
    }
  }

  _parseSvgNumber(value, fallback = Number.NaN) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const match = text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/i);
    if (!match) return fallback;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  _parseSvgNumberList(value) {
    return String(value ?? "")
      .trim()
      .split(/[\s,]+/u)
      .map((entry) => Number.parseFloat(entry))
      .filter((entry) => Number.isFinite(entry));
  }

  _parseSvgStyleString(value) {
    const out = {};
    const parts = String(value || "").split(";");
    for (const part of parts) {
      const [rawKey, ...rawValue] = String(part || "").split(":");
      const key = String(rawKey || "").trim().toLowerCase();
      if (!key) continue;
      out[key] = rawValue.join(":").trim();
    }
    return out;
  }

  _getSvgNodeStyle(node, inherited = null) {
    const style = inherited ? { ...inherited } : {};
    Object.assign(style, this._parseSvgStyleString(node?.getAttribute?.("style") || ""));
    const attrNames = [
      "fill",
      "fill-opacity",
      "stroke",
      "stroke-opacity",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "font-size",
      "font-family",
      "font-weight",
      "font-style",
      "text-anchor",
      "dominant-baseline",
      "vector-effect",
    ];
    for (const name of attrNames) {
      const value = node?.getAttribute?.(name);
      if (value != null && String(value).trim() !== "") {
        style[name] = String(value).trim();
      }
    }
    return style;
  }

  _parseSvgViewBox(svgNode, metadata = null) {
    const values = this._parseSvgNumberList(svgNode?.getAttribute?.("viewBox") || "");
    if (values.length >= 4 && values[2] > 0 && values[3] > 0) {
      return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
    const width = this._parseSvgNumber(svgNode?.getAttribute?.("width"), toFiniteNumber(metadata?.width, 0));
    const height = this._parseSvgNumber(svgNode?.getAttribute?.("height"), toFiniteNumber(metadata?.height, 0));
    if (width > 0 && height > 0) {
      return { x: 0, y: 0, width, height };
    }
    return null;
  }

  _parseSvgTranslateTransform(value) {
    const text = String(value || "").trim();
    if (!text) return { x: 0, y: 0 };
    const match = text.match(/translate\(\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*(?:[,\s]\s*(-?\d*\.?\d+(?:e[-+]?\d+)?))?\s*\)/i);
    if (!match) return { x: 0, y: 0 };
    return {
      x: Number.parseFloat(match[1]) || 0,
      y: Number.parseFloat(match[2]) || 0,
    };
  }

  _mapSvgPointToPdf(x, y, context) {
    const viewBox = context?.viewBox || null;
    if (!viewBox || !(viewBox.width > 0) || !(viewBox.height > 0)) return null;
    const destX = toFiniteNumber(context?.destX, 0);
    const destY = toFiniteNumber(context?.destY, 0);
    const destW = Math.max(MIN_ELEMENT_IN, toFiniteNumber(context?.destW, 1));
    const destH = Math.max(MIN_ELEMENT_IN, toFiniteNumber(context?.destH, 1));
    return {
      x: destX + (((x - viewBox.x) / viewBox.width) * destW),
      y: destY + (((y - viewBox.y) / viewBox.height) * destH),
    };
  }

  _getPdfFontDescriptor(fontFamily = "Arial", fontWeight = "400", fontStyle = "normal") {
    const family = String(fontFamily || "Arial").toLowerCase();
    const weight = String(fontWeight || "400").toLowerCase();
    const style = String(fontStyle || "normal").toLowerCase();
    let pdfFamily = "helvetica";
    if (family.includes("times") || family.includes("serif") || family.includes("georgia")) pdfFamily = "times";
    else if (family.includes("courier") || family.includes("mono")) pdfFamily = "courier";
    const bold = weight === "700" || weight === "800" || weight === "900" || weight === "bold" || Number.parseInt(weight, 10) >= 600;
    const italic = style === "italic" || style === "oblique";
    const pdfStyle = bold && italic ? "bolditalic" : (bold ? "bold" : (italic ? "italic" : "normal"));
    return { family: pdfFamily, style: pdfStyle };
  }

  _applyPdfSvgStrokeStyle(doc, style, context) {
    const strokeColor = getPdfColorComponents(style?.stroke, "transparent");
    const strokeOpacity = clamp(toFiniteNumber(style?.["stroke-opacity"], 1) * toFiniteNumber(style?.opacity, 1), 0, 1);
    const hasStroke = !!strokeColor && strokeOpacity > 0;
    doc.setLineDashPattern([], 0);
    if (!hasStroke) return { hasStroke: false, strokeOpacity: 0 };
    const scale = Math.max(1e-6, (Math.abs(toFiniteNumber(context?.scaleX, 1)) + Math.abs(toFiniteNumber(context?.scaleY, 1))) * 0.5);
    const strokeWidth = Math.max(0.001, this._parseSvgNumber(style?.["stroke-width"], 1) * scale);
    doc.setDrawColor(...strokeColor);
    doc.setLineWidth(strokeWidth);
    const cap = String(style?.["stroke-linecap"] || "").trim().toLowerCase();
    if (cap) doc.setLineCap(cap);
    const join = String(style?.["stroke-linejoin"] || "").trim().toLowerCase();
    if (join) doc.setLineJoin(join);
    const dashArray = this._parseSvgNumberList(style?.["stroke-dasharray"] || "").map((entry) => Math.abs(entry) * scale).filter((entry) => entry > 1e-6);
    doc.setLineDashPattern(dashArray, 0);
    return { hasStroke: true, strokeOpacity };
  }

  _applyPdfSvgFillStyle(doc, style) {
    const fillColor = getPdfColorComponents(style?.fill, "transparent");
    const fillOpacity = clamp(toFiniteNumber(style?.["fill-opacity"], 1) * toFiniteNumber(style?.opacity, 1), 0, 1);
    const hasFill = !!fillColor && fillOpacity > 0;
    if (!hasFill) return { hasFill: false, fillOpacity: 0 };
    doc.setFillColor(...fillColor);
    return { hasFill: true, fillOpacity };
  }

  _withPdfSvgNodeOpacity(doc, fillOpacity, strokeOpacity, callback) {
    if (!doc || typeof callback !== "function") return;
    const safeFill = clamp(toFiniteNumber(fillOpacity, 1), 0, 1);
    const safeStroke = clamp(toFiniteNumber(strokeOpacity, 1), 0, 1);
    doc.saveGraphicsState();
    try {
      if ((safeFill < 0.999 || safeStroke < 0.999) && typeof doc.setGState === "function" && typeof doc.GState === "function") {
        doc.setGState(new doc.GState({ opacity: safeFill, strokeOpacity: safeStroke }));
      }
      callback();
    } finally {
      doc.restoreGraphicsState();
    }
  }

  _parseSvgPathSubpaths(pathData) {
    const tokens = [];
    const source = String(pathData || "");
    const regex = /([MLHVZmlhvz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gu;
    let match;
    while ((match = regex.exec(source))) {
      tokens.push(match[1] || match[2]);
    }
    if (!tokens.length) return [];

    const isCommand = (token) => /^[MLHVZmlhvz]$/u.test(token);
    const readNumber = (indexRef) => {
      const value = Number.parseFloat(tokens[indexRef.index]);
      indexRef.index += 1;
      return value;
    };

    const out = [];
    const indexRef = { index: 0 };
    let command = "";
    let current = { x: 0, y: 0 };
    let start = null;
    let subpath = null;

    const pushSubpath = () => {
      if (subpath && Array.isArray(subpath.points) && subpath.points.length >= 2) {
        out.push(subpath);
      }
      subpath = null;
    };

    while (indexRef.index < tokens.length) {
      if (isCommand(tokens[indexRef.index])) {
        command = tokens[indexRef.index];
        indexRef.index += 1;
      } else if (!command) {
        break;
      }

      switch (command) {
        case "M":
        case "m": {
          let first = true;
          while (indexRef.index + 1 < tokens.length && !isCommand(tokens[indexRef.index])) {
            const xRaw = readNumber(indexRef);
            const yRaw = readNumber(indexRef);
            const point = command === "m"
              ? { x: current.x + xRaw, y: current.y + yRaw }
              : { x: xRaw, y: yRaw };
            if (first) {
              pushSubpath();
              subpath = { points: [point], closed: false };
              start = { ...point };
              first = false;
            } else if (subpath) {
              subpath.points.push(point);
            }
            current = point;
            command = command === "m" ? "l" : "L";
          }
          break;
        }
        case "L":
        case "l": {
          if (!subpath) subpath = { points: [{ ...current }], closed: false };
          while (indexRef.index + 1 <= tokens.length && !isCommand(tokens[indexRef.index])) {
            if (indexRef.index + 1 >= tokens.length) break;
            const xRaw = readNumber(indexRef);
            const yRaw = readNumber(indexRef);
            const point = command === "l"
              ? { x: current.x + xRaw, y: current.y + yRaw }
              : { x: xRaw, y: yRaw };
            subpath.points.push(point);
            current = point;
          }
          break;
        }
        case "H":
        case "h": {
          if (!subpath) subpath = { points: [{ ...current }], closed: false };
          while (indexRef.index < tokens.length && !isCommand(tokens[indexRef.index])) {
            const xRaw = readNumber(indexRef);
            const point = command === "h"
              ? { x: current.x + xRaw, y: current.y }
              : { x: xRaw, y: current.y };
            subpath.points.push(point);
            current = point;
          }
          break;
        }
        case "V":
        case "v": {
          if (!subpath) subpath = { points: [{ ...current }], closed: false };
          while (indexRef.index < tokens.length && !isCommand(tokens[indexRef.index])) {
            const yRaw = readNumber(indexRef);
            const point = command === "v"
              ? { x: current.x, y: current.y + yRaw }
              : { x: current.x, y: yRaw };
            subpath.points.push(point);
            current = point;
          }
          break;
        }
        case "Z":
        case "z": {
          if (subpath) {
            subpath.closed = true;
            pushSubpath();
          }
          if (start) current = { ...start };
          break;
        }
        default:
          indexRef.index = tokens.length;
          break;
      }
    }

    pushSubpath();
    return out;
  }

  _drawPdfSvgPathNode(doc, node, style, context) {
    const pathData = String(node?.getAttribute?.("d") || "");
    if (!pathData) return;
    const fill = this._applyPdfSvgFillStyle(doc, style);
    const stroke = this._applyPdfSvgStrokeStyle(doc, style, context);
    const mode = this._getPdfPaintMode(fill.hasFill, stroke.hasStroke);
    if (!mode) return;
    const subpaths = this._parseSvgPathSubpaths(pathData);
    if (!subpaths.length) return;

    this._withPdfSvgNodeOpacity(doc, fill.fillOpacity, stroke.strokeOpacity, () => {
      for (const subpath of subpaths) {
        const mapped = subpath.points
          .map((point) => this._mapSvgPointToPdf(
            point.x + toFiniteNumber(context?.translateX, 0),
            point.y + toFiniteNumber(context?.translateY, 0),
            context,
          ))
          .filter(Boolean);
        if (mapped.length < 2) continue;
        const [first, ...rest] = mapped;
        const rel = [];
        let prev = first;
        for (const point of rest) {
          rel.push([point.x - prev.x, point.y - prev.y]);
          prev = point;
        }
        doc.lines(rel, first.x, first.y, [1, 1], mode, subpath.closed || fill.hasFill);
      }
    });
  }

  _drawPdfSvgRectNode(doc, node, style, context) {
    const x = this._parseSvgNumber(node?.getAttribute?.("x"), 0) + toFiniteNumber(context?.translateX, 0);
    const y = this._parseSvgNumber(node?.getAttribute?.("y"), 0) + toFiniteNumber(context?.translateY, 0);
    const width = this._parseSvgNumber(node?.getAttribute?.("width"), 0);
    const height = this._parseSvgNumber(node?.getAttribute?.("height"), 0);
    if (!(width > 0) || !(height > 0)) return;
    const topLeft = this._mapSvgPointToPdf(x, y, context);
    const bottomRight = this._mapSvgPointToPdf(x + width, y + height, context);
    if (!topLeft || !bottomRight) return;
    const fill = this._applyPdfSvgFillStyle(doc, style);
    const stroke = this._applyPdfSvgStrokeStyle(doc, style, context);
    const mode = this._getPdfPaintMode(fill.hasFill, stroke.hasStroke);
    if (!mode) return;
    const rx = Math.max(0, this._parseSvgNumber(node?.getAttribute?.("rx"), 0) * Math.abs(toFiniteNumber(context?.scaleX, 1)));
    const ry = Math.max(0, this._parseSvgNumber(node?.getAttribute?.("ry"), 0) * Math.abs(toFiniteNumber(context?.scaleY, 1)));
    this._withPdfSvgNodeOpacity(doc, fill.fillOpacity, stroke.strokeOpacity, () => {
      if (rx > 0 || ry > 0) {
        doc.roundedRect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y,
          rx,
          ry || rx,
          mode,
        );
      } else {
        doc.rect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y,
          mode,
        );
      }
    });
  }

  _drawPdfSvgTextNode(doc, node, style, context) {
    const fillColor = getPdfColorComponents(style?.fill, "#000000");
    const fillOpacity = clamp(toFiniteNumber(style?.["fill-opacity"], 1) * toFiniteNumber(style?.opacity, 1), 0, 1);
    if (!fillColor || fillOpacity <= 0) return;
    const fontSizeSvg = this._parseSvgNumber(style?.["font-size"], 12);
    const fontSizeIn = Math.max(0.001, fontSizeSvg * Math.abs(toFiniteNumber(context?.scaleY, 1)));
    const font = this._getPdfFontDescriptor(style?.["font-family"], style?.["font-weight"], style?.["font-style"]);
    const alignRaw = String(style?.["text-anchor"] || "start").trim().toLowerCase();
    const align = alignRaw === "middle" ? "center" : (alignRaw === "end" ? "right" : "left");
    const baselineRaw = String(style?.["dominant-baseline"] || "alphabetic").trim().toLowerCase();
    const baseline = baselineRaw.includes("middle") ? "middle" : "alphabetic";
    const segments = [];
    const tspans = Array.from(node?.querySelectorAll?.(":scope > tspan") || []);
    if (tspans.length) {
      for (const tspan of tspans) {
        const text = String(tspan.textContent || "");
        if (!text) continue;
        const x = this._parseSvgNumber(tspan.getAttribute("x"), this._parseSvgNumber(node?.getAttribute?.("x"), 0));
        const y = this._parseSvgNumber(tspan.getAttribute("y"), this._parseSvgNumber(node?.getAttribute?.("y"), 0));
        segments.push({ text, x, y });
      }
    } else {
      const text = String(node?.textContent || "");
      if (text) {
        segments.push({
          text,
          x: this._parseSvgNumber(node?.getAttribute?.("x"), 0),
          y: this._parseSvgNumber(node?.getAttribute?.("y"), 0),
        });
      }
    }
    if (!segments.length) return;

    this._withPdfSvgNodeOpacity(doc, fillOpacity, fillOpacity, () => {
      doc.setFont(font.family, font.style);
      doc.setFontSize(Math.max(0.1, inchesToPoints(fontSizeIn)));
      doc.setTextColor(...fillColor);
      for (const segment of segments) {
        const point = this._mapSvgPointToPdf(
          segment.x + toFiniteNumber(context?.translateX, 0),
          segment.y + toFiniteNumber(context?.translateY, 0),
          context,
        );
        if (!point) continue;
        doc.text(segment.text, point.x, point.y, { align, baseline });
      }
    });
  }

  _drawPdfSvgNode(doc, node, context, inheritedStyle = null) {
    if (!doc || !node) return;
    const tag = String(node.tagName || "").toLowerCase();
    if (!tag) return;
    const style = this._getSvgNodeStyle(node, inheritedStyle);
    const translate = this._parseSvgTranslateTransform(node.getAttribute?.("transform") || "");
    const nextContext = {
      ...context,
      translateX: toFiniteNumber(context?.translateX, 0) + translate.x,
      translateY: toFiniteNumber(context?.translateY, 0) + translate.y,
    };

    if (tag === "g" || tag === "svg") {
      for (const child of Array.from(node.children || [])) {
        this._drawPdfSvgNode(doc, child, nextContext, style);
      }
      return;
    }
    if (tag === "path") {
      this._drawPdfSvgPathNode(doc, node, style, nextContext);
      return;
    }
    if (tag === "rect") {
      this._drawPdfSvgRectNode(doc, node, style, nextContext);
      return;
    }
    if (tag === "text") {
      this._drawPdfSvgTextNode(doc, node, style, nextContext);
    }
  }

  _drawPdfSvgElement(doc, element, frame) {
    const src = String(element?.src || "").trim();
    if (!this._isSvgImageDataUrl(src)) return false;
    const svgNode = this._parseSvgDataUrl(src);
    if (!svgNode) return false;

    const metadata = this._getMediaMetadataForElement(element) || {
      width: Math.max(1, this._parseSvgNumber(svgNode.getAttribute("width"), frame?.w || 1)),
      height: Math.max(1, this._parseSvgNumber(svgNode.getAttribute("height"), frame?.h || 1)),
    };
    const viewBox = this._parseSvgViewBox(svgNode, metadata);
    if (!viewBox || !(viewBox.width > 0) || !(viewBox.height > 0)) return false;

    const layout = this._getMediaLayout(element, frame.w, frame.h, metadata);
    const destX = frame.x + toFiniteNumber(layout?.left, 0);
    const destY = frame.y + toFiniteNumber(layout?.top, 0);
    const destW = Math.max(MIN_ELEMENT_IN, toFiniteNumber(layout?.renderWidth, frame.w));
    const destH = Math.max(MIN_ELEMENT_IN, toFiniteNumber(layout?.renderHeight, frame.h));
    const radius = 8 / 96;

    this._withPdfGraphicsState(doc, element?.opacity, () => {
      doc.roundedRect(frame.x, frame.y, frame.w, frame.h, radius, radius, null);
      doc.clip();
      doc.discardPath();
      this._drawPdfSvgNode(doc, svgNode, {
        viewBox,
        destX,
        destY,
        destW,
        destH,
        scaleX: destW / viewBox.width,
        scaleY: destH / viewBox.height,
        translateX: 0,
        translateY: 0,
      });
    });

    return true;
  }

  _drawPdfFramedRect(doc, x, y, w, h, { fill, stroke, radius = (8 / 96) } = {}) {
    const paintMode = this._getPdfPaintMode(!!fill, !!stroke);
    if (!paintMode) return;
    if (fill) doc.setFillColor(...fill);
    if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, paintMode);
    else doc.rect(x, y, w, h, paintMode);
  }

  async _drawPdfImageElement(doc, element) {
    const x = toFiniteNumber(element?.x, 0);
    const y = toFiniteNumber(element?.y, 0);
    const w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1));
    const h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.h, 1));
    const fillColor = isTransparentColor(element?.fill) ? null : getPdfColorComponents(element?.fill, "transparent");
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const { hasStroke } = this._setPdfLineStyle(doc, element);
      this._drawPdfFramedRect(doc, x, y, w, h, { fill: fillColor, stroke: hasStroke });
      doc.setLineDashPattern([], 0);
    });
    const tile = await this._renderPdfMediaTileCanvas(element, w, h);
    if (!tile) return;
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      doc.addImage(tile, "PNG", x, y, w, h);
    });
  }

  async _drawPdfPmiElement(doc, element) {
    const frame = this._getMediaFrameBox(element);
    if (!frame) return;
    const frameFill = isTransparentColor(element?.fill) ? null : getPdfColorComponents(element?.fill, "transparent");
    this._withPdfGraphicsState(doc, element?.opacity, () => {
      const { hasStroke } = this._setPdfLineStyle(doc, element);
      this._drawPdfFramedRect(doc, frame.x, frame.y, frame.w, frame.h, { fill: frameFill, stroke: hasStroke });
      doc.setLineDashPattern([], 0);
    });
    const renderedVector = this._drawPdfSvgElement(doc, element, frame);
    if (!renderedVector) {
      const tile = await this._renderPdfMediaTileCanvas(element, frame.w, frame.h);
      if (tile) {
        this._withPdfGraphicsState(doc, element?.opacity, () => {
          doc.addImage(tile, "PNG", frame.x, frame.y, frame.w, frame.h);
        });
      }
    }
    if (this._getPmiLabelPosition(element) !== "none") {
      const captionHeight = Math.max(0, this._getPmiTitleHeightIn(element));
      if (captionHeight > 0) {
        const captionY = frame.labelPosition === "top"
          ? toFiniteNumber(element?.y, 0)
          : (frame.y + frame.h);
        this._drawPdfTextBlock(doc, {
          ...element,
          element,
          text: this._resolvePmiViewDisplayName(element),
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: pointsToInches(PMI_TITLE_FONT_SIZE_PT),
          fontWeight: "600",
          fontStyle: "normal",
          textDecoration: "none",
          textAlign: "center",
          verticalAlign: "middle",
          color: "#111111",
        }, {
          x: toFiniteNumber(element?.x, 0),
          y: captionY,
          w: Math.max(MIN_ELEMENT_IN, toFiniteNumber(element?.w, 1)),
          h: captionHeight,
          rotationDeg: 0,
          paddingX: pointsToInches(PMI_TITLE_PAD_X_PT),
          paddingY: 0,
        });
      }
    }
  }

  async _drawVectorSheetToPdf(doc, sheet) {
    const widthIn = Math.max(0.1, toFiniteNumber(sheet?.widthIn, 11));
    const heightIn = Math.max(0.1, toFiniteNumber(sheet?.heightIn, 8.5));
    const background = getPdfColorComponents(sheet?.background, "#ffffff");
    if (background) {
      doc.setFillColor(...background);
      doc.rect(0, 0, widthIn, heightIn, "F");
    }
    for (const element of sortElements(sheet?.elements || [])) {
      const type = String(element?.type || "");
      if (type === "line") this._drawPdfLineElement(doc, element);
      else if (type === "text") this._drawPdfTextElement(doc, element);
      else if (isShapeElementType(type)) this._drawPdfShapeElement(doc, element);
      else if (type === "table") this._drawPdfTableElement(doc, element);
      else if (type === "image") await this._drawPdfImageElement(doc, element);
      else if (type === "pmiInset") await this._drawPdfPmiElement(doc, element);
    }
  }

  async generatePdfBytes({ onProgress = null } = {}) {
    this._refreshPmiViews({ bumpRevision: true });
    const emitProgress = async (payload, frameCount = 1) => {
      if (typeof onProgress === "function") {
        try { onProgress(payload); } catch { }
      }
      await this._waitForPaint(frameCount);
    };

    await emitProgress({
      detail: "Refreshing PMI views before export",
      hint: "Updating referenced PMI images",
      completed: 0,
      total: 1,
      sheet: null,
      sheetLabel: "Current sheet",
    });
    try {
      await this._refreshAllPmiInsetImages();
    } catch { }

    const manager = this._getManager();
    const sheets = typeof manager?.toSerializable === "function"
      ? manager.toSerializable()
      : deepClone(manager?.getSheets?.() || []);
    if (!Array.isArray(sheets) || sheets.length === 0) {
      return null;
    }

    const host = document.createElement("div");
    host.className = "sheet-slides-pdf-host";
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.pointerEvents = "none";
    host.style.opacity = "1";
    host.style.zIndex = "1";
    host.style.display = "block";
    document.body.appendChild(host);

    try {
      await emitProgress({
        detail: "Building sheet previews",
        hint: "Preparing pages for PDF export",
        completed: 0,
        total: sheets.length,
        sheet: sheets[0] || null,
        sheetLabel: String(sheets[0]?.name || "Sheet 1"),
      }, 2);

      let doc = null;
      for (let index = 0; index < sheets.length; index += 1) {
        const sheet = sheets[index];
        const widthIn = Math.max(0.1, toFiniteNumber(sheet?.widthIn, 11));
        const heightIn = Math.max(0.1, toFiniteNumber(sheet?.heightIn, 8.5));
        const orientation = widthIn >= heightIn ? "landscape" : "portrait";
        const useVectorPdf = this._sheetCanUseVectorPdf(sheet);

        await emitProgress({
          detail: `${useVectorPdf ? "Composing" : "Rendering"} sheet ${index + 1} of ${sheets.length}`,
          hint: useVectorPdf
            ? "Writing vector geometry directly into the PDF"
            : "Rasterizing the current sheet",
          completed: index,
          total: sheets.length,
          sheet,
          sheetLabel: String(sheet?.name || `Sheet ${index + 1}`),
        }, 2);

        if (!doc) {
          doc = new jsPDF({
            orientation,
            unit: "in",
            format: [widthIn, heightIn],
            compress: true,
          });
        } else {
          doc.addPage([widthIn, heightIn], orientation);
        }

        if (useVectorPdf) {
          await this._drawVectorSheetToPdf(doc, sheet);
        } else {
          const pageNode = this._buildPdfPageNode(sheet);
          if (!pageNode) continue;
          host.appendChild(pageNode);
          await this._waitForImagesInNode(pageNode);
          this._applyExportMediaLayouts(pageNode);
          const rasterScale = this._getPdfRasterScale(pageNode);
          const canvas = await this._renderPdfPageCanvas(pageNode, rasterScale);
          doc.addImage(canvas, "PNG", 0, 0, widthIn, heightIn);
          host.removeChild(pageNode);
        }

        await emitProgress({
          detail: `Added sheet ${index + 1} of ${sheets.length}`,
          hint: useVectorPdf
            ? "Assembling vector page data"
            : "Assembling the final PDF document",
          completed: index + 1,
          total: sheets.length,
          sheet,
          sheetLabel: String(sheet?.name || `Sheet ${index + 1}`),
        });
      }

      if (!doc) return null;

      await emitProgress({
        detail: "Preparing download",
        hint: "Writing the final PDF file",
        completed: sheets.length,
        total: sheets.length,
        sheet: sheets[sheets.length - 1] || null,
        sheetLabel: String(sheets[sheets.length - 1]?.name || `Sheet ${sheets.length}`),
      });

      const pdfBuffer = doc.output("arraybuffer");
      if (pdfBuffer instanceof ArrayBuffer) {
        return new Uint8Array(pdfBuffer);
      }
      if (ArrayBuffer.isView(pdfBuffer)) {
        return new Uint8Array(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength));
      }
      return new Uint8Array();
    } finally {
      try { host.remove(); } catch { }
    }
  }

  async _preparePdfExportState() {
    this._closeToolbarPopover();
    this._hideContextMenu();
    try {
      const active = document.activeElement;
      if (this.root?.contains?.(active) && typeof active?.blur === "function") {
        active.blur();
      }
    } catch { }
    await this._waitForPaint();
    this._commitSheetDraft("pdf-export");
    await this._waitForPaint(2);
  }

  async _exportSheetsToPdf() {
    if (this._isExportingPdf) return;
    await this._preparePdfExportState();
    this._setPdfExportBusy(true);
    this._resetPdfExportProgress();

    try {
      const bytes = await this.generatePdfBytes({
        onProgress: (payload) => this._setPdfExportProgress(payload),
      });
      if (!(bytes instanceof Uint8Array) || !bytes.length) {
        this._setStatus("No sheets available for PDF export");
        return;
      }

      const baseName = String(this.viewer?.partHistory?.name || "brep-io-sheets")
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "brep-io-sheets";

      this._downloadPdfBytes(bytes, `${baseName}.pdf`);
      const manager = this._getManager();
      const count = manager?.getSheets?.()?.length || 0;
      this._setStatus(`PDF exported for ${count} sheet${count === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Failed to export sheets PDF", error);
      this._setStatus("PDF export failed");
    } finally {
      this._setPdfExportBusy(false);
      this._resetPdfExportProgress();
    }
  }

  _getElementBoundsIn(element) {
    if (!element || typeof element !== "object") return null;
    if (element.type === "line") {
      const x1 = toFiniteNumber(element.x, 0);
      const y1 = toFiniteNumber(element.y, 0);
      const x2 = toFiniteNumber(element.x2, x1);
      const y2 = toFiniteNumber(element.y2, y1);
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.max(MIN_ELEMENT_IN, Math.abs(x2 - x1)),
        h: Math.max(MIN_ELEMENT_IN, Math.abs(y2 - y1)),
      };
    }
    return {
      x: toFiniteNumber(element.x, 0),
      y: toFiniteNumber(element.y, 0),
      w: Math.max(MIN_ELEMENT_IN, toFiniteNumber(element.w, 1)),
      h: Math.max(MIN_ELEMENT_IN, toFiniteNumber(element.h, 1)),
    };
  }

  _getSelectionBoundsIn(elements = this._getSelectedElements()) {
    const entries = Array.isArray(elements) ? elements : [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const element of entries) {
      const bounds = this._getElementBoundsIn(element);
      if (!bounds) continue;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w);
      maxY = Math.max(maxY, bounds.y + bounds.h);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return {
      x: minX,
      y: minY,
      w: Math.max(MIN_ELEMENT_IN, maxX - minX),
      h: Math.max(MIN_ELEMENT_IN, maxY - minY),
    };
  }

  _getRenderedElementBoundsPx(element) {
    if (!element || !this._slideCanvas) return null;
    const node = this._slideCanvas.querySelector(`.sheet-slides-element[data-id="${CSS.escape(String(element.id || ""))}"]`);
    if (!node) {
      const ppi = this._getStageRenderPpi();
      const bounds = this._getElementBoundsIn(element);
      return bounds ? {
        left: bounds.x * ppi,
        top: bounds.y * ppi,
        width: bounds.w * ppi,
        height: bounds.h * ppi,
      } : null;
    }
    const canvasRect = this._slideCanvas.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      left: nodeRect.left - canvasRect.left,
      top: nodeRect.top - canvasRect.top,
      width: Math.max(1, nodeRect.width),
      height: Math.max(1, nodeRect.height),
    };
  }

  _getSelectionBoundsPx(elements = this._getSelectedElements()) {
    const entries = Array.isArray(elements) ? elements : [];
    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (const element of entries) {
      const bounds = this._getRenderedElementBoundsPx(element);
      if (!bounds) continue;
      minLeft = Math.min(minLeft, bounds.left);
      minTop = Math.min(minTop, bounds.top);
      maxRight = Math.max(maxRight, bounds.left + bounds.width);
      maxBottom = Math.max(maxBottom, bounds.top + bounds.height);
    }
    if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
      return null;
    }
    return {
      left: minLeft,
      top: minTop,
      width: Math.max(1, maxRight - minLeft),
      height: Math.max(1, maxBottom - minTop),
    };
  }

  _buildSelectionOverlay(target) {
    const elements = Array.isArray(target) ? target.filter(Boolean) : [target].filter(Boolean);
    if (elements.length === 0) return null;
    if (elements.length > 1) {
      const bounds = this._getSelectionBoundsPx(elements);
      if (!bounds) return null;
      const lockedFormboardGeometry = this._selectionContainsLockedFormboardGeometry(elements);
      const overlay = document.createElement("div");
      overlay.className = "sheet-slides-selection-overlay multi";
      overlay.style.left = `${bounds.left}px`;
      overlay.style.top = `${bounds.top}px`;
      overlay.style.width = `${bounds.width}px`;
      overlay.style.height = `${bounds.height}px`;
      overlay.style.zIndex = "2147483647";
      overlay.style.setProperty("--sheet-slides-ui-scale", String(this._getSelectionUiScale()));
      overlay.addEventListener("pointerdown", (event) => this._onSelectionOverlayPointerDown(event));

      const frame = document.createElement("div");
      frame.className = "sheet-slides-selection-frame";
      overlay.appendChild(frame);

      if (!lockedFormboardGeometry) {
        ["nw", "ne", "sw", "se"].forEach((corner) => {
          const handle = document.createElement("div");
          handle.className = `sheet-slides-handle ${corner}`;
          handle.dataset.handle = corner;
          overlay.appendChild(handle);
        });
      }

      const rotateLine = document.createElement("div");
      rotateLine.className = "sheet-slides-rotate-line";
      overlay.appendChild(rotateLine);

      const rotateHandle = document.createElement("div");
      rotateHandle.className = "sheet-slides-rotate-handle";
      rotateHandle.dataset.handle = "rotate";
      overlay.appendChild(rotateHandle);
      return overlay;
    }

    const [element] = elements;
    if (!element || typeof element !== "object") return null;
    if (this._isFormboardElement(element)) {
      const groupId = this._getElementGroupId(element);
      const groupElements = (this.sheetDraft?.elements || []).filter((entry) => this._getElementGroupId(entry) === groupId);
      const bounds = this._getSelectionBoundsPx(groupElements);
      const model = buildWireHarnessFormboardModel(groupElements);
      if (!bounds || !model) return null;
      const ppi = this._getStageRenderPpi();
      const activePivotNodeId = String(this._selectedFormboardPivot?.groupId || "") === groupId
        ? String(this._selectedFormboardPivot?.nodeId || "")
        : "";
      const overlay = document.createElement("div");
      overlay.className = "sheet-slides-selection-overlay formboard-tree";
      overlay.style.left = `${bounds.left}px`;
      overlay.style.top = `${bounds.top}px`;
      overlay.style.width = `${bounds.width}px`;
      overlay.style.height = `${bounds.height}px`;
      overlay.style.zIndex = "2147483647";
      overlay.style.setProperty("--sheet-slides-ui-scale", String(this._getSelectionUiScale()));
      overlay.addEventListener("pointerdown", (event) => this._onSelectionOverlayPointerDown(event));

      const frame = document.createElement("div");
      frame.className = "sheet-slides-selection-frame";
      overlay.appendChild(frame);

      for (const node of model.nodes.values()) {
        const handle = document.createElement("div");
        handle.className = `sheet-slides-formboard-pivot-handle${activePivotNodeId === node.id ? " active" : ""}`;
        handle.dataset.handle = "formboard-node";
        handle.dataset.nodeId = String(node.id || "");
        handle.style.left = `${(toFiniteNumber(node.x, 0) * ppi) - bounds.left - 8}px`;
        handle.style.top = `${(toFiniteNumber(node.y, 0) * ppi) - bounds.top - 8}px`;
        overlay.appendChild(handle);
      }

      if (activePivotNodeId) {
        const adjacentSegments = model.segmentsByNode?.get?.(activePivotNodeId) || [];
        for (const segment of adjacentSegments) {
          if (!segment) continue;
          const otherNodeId = segment.fromNodeId === activePivotNodeId ? segment.toNodeId : segment.fromNodeId;
          const pivotNode = model.nodes.get(activePivotNodeId);
          const otherNode = model.nodes.get(otherNodeId);
          if (!pivotNode || !otherNode) continue;
          const midX = ((pivotNode.x + otherNode.x) * 0.5) * ppi;
          const midY = ((pivotNode.y + otherNode.y) * 0.5) * ppi;
          const handle = document.createElement("div");
          handle.className = "sheet-slides-formboard-segment-handle";
          handle.dataset.handle = "formboard-segment";
          handle.dataset.nodeId = activePivotNodeId;
          handle.dataset.segmentId = String(segment.id || "");
          handle.style.left = `${midX - bounds.left - 9}px`;
          handle.style.top = `${midY - bounds.top - 9}px`;
          overlay.appendChild(handle);
        }
      }
      return overlay;
    }

    const ppi = this._getStageRenderPpi();
    const targetId = String(element.id || "");
    const renderedNode = targetId
      ? Array.from(this._slideCanvas?.querySelectorAll?.(".sheet-slides-element") || [])
        .find((node) => String(node?.dataset?.id || "") === targetId)
      : null;
    const overlay = document.createElement("div");
    const cropActive = this._isCropModeForElement(element) && elementSupportsMediaCrop(element);
    const cropSnapshot = cropActive ? this._getMediaInteractionSnapshot(element, renderedNode) : null;
    const cropFrame = cropSnapshot?.frame || null;
    const cropMediaRect = cropSnapshot?.mediaRect || null;
    overlay.className = `sheet-slides-selection-overlay${cropActive ? " crop-active" : ""}`;
    overlay.dataset.id = targetId;
    overlay.dataset.type = String(element.type || "");
    if (cropActive && cropFrame && cropMediaRect) {
      const mediaLeftPx = cropMediaRect.x * ppi;
      const mediaTopPx = cropMediaRect.y * ppi;
      const mediaWidthPx = Math.max(1, cropMediaRect.w * ppi);
      const mediaHeightPx = Math.max(1, cropMediaRect.h * ppi);
      const frameCenterXPx = (cropFrame.x + (cropFrame.w * 0.5)) * ppi;
      const frameCenterYPx = (cropFrame.y + (cropFrame.h * 0.5)) * ppi;

      overlay.style.left = `${mediaLeftPx}px`;
      overlay.style.top = `${mediaTopPx}px`;
      overlay.style.width = `${mediaWidthPx}px`;
      overlay.style.height = `${mediaHeightPx}px`;
      overlay.style.transform = `rotate(${toFiniteNumber(element.rotationDeg, 0)}deg)`;
      overlay.style.transformOrigin = `${frameCenterXPx - mediaLeftPx}px ${frameCenterYPx - mediaTopPx}px`;
      overlay.dataset.cropTarget = "media";
    } else {
      overlay.style.left = renderedNode?.style?.left || `${toFiniteNumber(element.x, 0) * ppi}px`;
      overlay.style.top = renderedNode?.style?.top || `${toFiniteNumber(element.y, 0) * ppi}px`;
      overlay.style.width = renderedNode?.style?.width || `${Math.max(1, toFiniteNumber(element.w, 1) * ppi)}px`;
      overlay.style.height = renderedNode?.style?.height || `${Math.max(1, toFiniteNumber(element.h, 1) * ppi)}px`;
      overlay.style.transform = renderedNode?.style?.transform || `rotate(${toFiniteNumber(element.rotationDeg, 0)}deg)`;
      overlay.style.transformOrigin = "";
    }
    overlay.style.zIndex = "2147483647";
    overlay.style.setProperty("--sheet-slides-ui-scale", String(this._getSelectionUiScale()));
    overlay.addEventListener("pointerdown", (event) => this._onElementPointerDown(event, element.id));
    const lockedFormboardGeometry = this._isFormboardElement(element);

    if (cropActive) {
      const frame = document.createElement("div");
      frame.className = "sheet-slides-selection-frame";
      overlay.appendChild(frame);

      const cropLeftPx = (cropFrame && cropMediaRect) ? Math.max(0, (cropFrame.x - cropMediaRect.x) * ppi) : 0;
      const cropTopPx = (cropFrame && cropMediaRect) ? Math.max(0, (cropFrame.y - cropMediaRect.y) * ppi) : 0;
      const cropWidthPx = cropFrame ? Math.max(1, cropFrame.w * ppi) : Math.max(1, toFiniteNumber(element.w, 1) * ppi);
      const cropHeightPx = cropFrame ? Math.max(1, cropFrame.h * ppi) : Math.max(1, toFiniteNumber(element.h, 1) * ppi);
      const cropOverlay = document.createElement("div");
      cropOverlay.className = "sheet-slides-crop-overlay";
      cropOverlay.style.left = `${cropLeftPx}px`;
      cropOverlay.style.top = `${cropTopPx}px`;
      cropOverlay.style.width = `${cropWidthPx}px`;
      cropOverlay.style.height = `${cropHeightPx}px`;
      cropOverlay.dataset.cropTarget = "media";
      ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((corner) => {
        const handle = document.createElement("div");
        handle.className = `sheet-slides-crop-handle ${corner}`;
        handle.dataset.cropHandle = corner;
        cropOverlay.appendChild(handle);
      });
      overlay.appendChild(cropOverlay);
      return overlay;
    }

    const frame = document.createElement("div");
    frame.className = "sheet-slides-selection-frame";
    overlay.appendChild(frame);

    if (element.type === "table") {
      const widthPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
      const heightPx = Math.max(1, toFiniteNumber(element.h, 1) * ppi);
      const moveHandle = document.createElement("div");
      moveHandle.className = "sheet-slides-table-move-handle";
      moveHandle.dataset.handle = "table-move";
      moveHandle.title = "Move table";
      overlay.appendChild(moveHandle);
      const layout = this._getTableLayoutMetrics(element, widthPx, heightPx);
      for (let boundary = 1; boundary < layout.colCount; boundary += 1) {
        const handle = document.createElement("div");
        handle.className = "sheet-slides-table-col-handle";
        handle.dataset.handle = "table-col-resize";
        handle.dataset.tableColBoundary = String(boundary);
        handle.title = "Resize column";
        handle.style.left = `${toFiniteNumber(layout.colStarts?.[boundary], 0)}px`;
        handle.style.height = `${Math.max(1, heightPx)}px`;
        overlay.appendChild(handle);
      }
    } else if (element.type === "rect") {
      const widthPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
      const heightPx = Math.max(1, toFiniteNumber(element.h, 1) * ppi);
      const radiusPx = clamp(
        toFiniteNumber(element.cornerRadius, 0) * ppi,
        0,
        Math.min(widthPx, heightPx) * 0.5,
      );
      overlay.style.setProperty("--sheet-slides-corner-radius-px", `${radiusPx}px`);

      const cornerRadiusHandle = document.createElement("div");
      cornerRadiusHandle.className = "sheet-slides-corner-radius-handle";
      cornerRadiusHandle.dataset.handle = "corner-radius";
      cornerRadiusHandle.title = "Adjust corner radius";
      overlay.appendChild(cornerRadiusHandle);
    } else if (shapeSupportsAdjustHandle(element.type)) {
      const widthPx = Math.max(1, toFiniteNumber(element.w, 1) * ppi);
      const adjustPx = clampShapeAdjust(element.type, element.shapeAdjust) * widthPx;
      overlay.style.setProperty("--sheet-slides-shape-adjust-px", `${adjustPx}px`);

      const shapeAdjustHandle = document.createElement("div");
      shapeAdjustHandle.className = "sheet-slides-shape-adjust-handle";
      shapeAdjustHandle.dataset.handle = "shape-adjust";
      shapeAdjustHandle.title = "Adjust shape";
      overlay.appendChild(shapeAdjustHandle);
    }

    if (!lockedFormboardGeometry) {
      ["nw", "ne", "sw", "se"].forEach((corner) => {
        const handle = document.createElement("div");
        handle.className = `sheet-slides-handle ${corner}`;
        handle.dataset.handle = corner;
        overlay.appendChild(handle);
      });
    }

    const rotateLine = document.createElement("div");
    rotateLine.className = "sheet-slides-rotate-line";
    overlay.appendChild(rotateLine);

    const rotateHandle = document.createElement("div");
    rotateHandle.className = "sheet-slides-rotate-handle";
    rotateHandle.dataset.handle = "rotate";
    overlay.appendChild(rotateHandle);

    return overlay;
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
    node.style.textDecoration = String(element.textDecoration || "none");
    node.style.color = toCssColor(element.color, "#111111");
    node.style.textAlign = this._getTextAlignValue(element);
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.justifyContent = this._getTextVerticalAlignValue(element) === "top"
      ? "flex-start"
      : (this._getTextVerticalAlignValue(element) === "bottom" ? "flex-end" : "center");
    node.style.alignItems = "stretch";
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.boxSizing = "border-box";
    node.style.whiteSpace = "pre-wrap";
    node.style.wordBreak = "break-word";
    node.style.lineHeight = "1.2";
    node.style.overflow = "hidden";
  }

  _applyLineStrokeStyles(node, element, strokeWidthPx) {
    if (!node || !element) return;
    const color = toCssColor(element.stroke, "#1f2937");
    const styleValue = this._getLineStyleValue(element);
    if (styleValue === "none") {
      node.style.background = "transparent";
      node.style.backgroundImage = "";
      return;
    }
    if (styleValue === "solid") {
      node.style.background = color;
      node.style.backgroundImage = "";
      return;
    }
    const dashArray = this._getStrokeDashArray(styleValue, strokeWidthPx).split(/\s+/).map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const segments = [];
    let cursor = 0;
    for (let index = 0; index < dashArray.length; index += 1) {
      const length = dashArray[index];
      const next = cursor + length;
      if (index % 2 === 0) {
        segments.push(`${color} ${cursor}px ${next}px`);
      } else {
        segments.push(`transparent ${cursor}px ${next}px`);
      }
      cursor = next;
    }
    const total = Math.max(cursor, strokeWidthPx * 4);
    node.style.background = "transparent";
    node.style.backgroundImage = `repeating-linear-gradient(to right, ${segments.join(", ")})`;
    node.style.backgroundSize = `${total}px 100%`;
    node.style.backgroundRepeat = "repeat-x";
  }

  _createShapeSurfaceSvg(element, widthPx, heightPx, {
    shape = "rect",
    radiusPx = 0,
    fillColor = null,
    className = "",
    ppi = null,
  } = {}) {
    if (!element) return null;
    const styleValue = this._getLineStyleValue(element);
    const surfacePpi = Math.max(
      1,
      toFiniteNumber(ppi, Math.max(1, widthPx / Math.max(MIN_ELEMENT_IN, toFiniteNumber(element.w, 1)))),
    );
    const strokeWidthPx = element.type === "text" && !this._isTextBorderEnabled(element)
      ? 0
      : Math.max(0, toFiniteNumber(element.strokeWidth, this._defaultStrokeWidthForElement(element)) * surfacePpi);
    const hasStroke = strokeWidthPx > 0 && styleValue !== "none";
    const fill = fillColor != null
      ? toCssColor(fillColor, "transparent")
      : "none";
    const strokeColor = hasStroke ? toCssColor(element.stroke, this._defaultStrokeForElement(element)) : "none";
    const half = hasStroke ? Math.max(0.5, strokeWidthPx * 0.5) : 0;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${Math.max(1, widthPx)} ${Math.max(1, heightPx)}`);
    svg.setAttribute("width", String(Math.max(1, widthPx)));
    svg.setAttribute("height", String(Math.max(1, heightPx)));
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach((name) => svg.classList.add(name));
    }

    const dashArray = hasStroke ? this._getStrokeDashArray(styleValue, strokeWidthPx) : "";
    let shapeNode = null;
    const left = half;
    const top = half;
    const right = Math.max(left, widthPx - half);
    const bottom = Math.max(top, heightPx - half);
    const innerWidth = Math.max(0, right - left);
    const innerHeight = Math.max(0, bottom - top);
    const cx = left + (innerWidth * 0.5);
    const cy = top + (innerHeight * 0.5);
    const shapeAdjustRatio = clampShapeAdjust(element.type, element.shapeAdjust);
    if (shape === "ellipse") {
      shapeNode = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      shapeNode.setAttribute("cx", String(widthPx * 0.5));
      shapeNode.setAttribute("cy", String(heightPx * 0.5));
      shapeNode.setAttribute("rx", String(Math.max(0, (widthPx * 0.5) - half)));
      shapeNode.setAttribute("ry", String(Math.max(0, (heightPx * 0.5) - half)));
    } else if (shape === "rect") {
      shapeNode = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shapeNode.setAttribute("x", String(half));
      shapeNode.setAttribute("y", String(half));
      shapeNode.setAttribute("width", String(Math.max(0, widthPx - (half * 2))));
      shapeNode.setAttribute("height", String(Math.max(0, heightPx - (half * 2))));
      const maxRadius = Math.max(0, Math.min(innerWidth, innerHeight) * 0.5);
      shapeNode.setAttribute("rx", String(Math.min(maxRadius, Math.max(0, radiusPx - half))));
      shapeNode.setAttribute("ry", String(Math.min(maxRadius, Math.max(0, radiusPx - half))));
    } else {
      shapeNode = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      let points = [];
      if (shape === "triangle") {
        points = [[cx, top], [right, bottom], [left, bottom]];
      } else if (shape === "diamond") {
        points = [[cx, top], [right, cy], [cx, bottom], [left, cy]];
      } else if (shape === "pentagon") {
        const rx = innerWidth * 0.5;
        const ry = innerHeight * 0.5;
        for (let index = 0; index < 5; index += 1) {
          const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / 5);
          points.push([cx + (Math.cos(angle) * rx), cy + (Math.sin(angle) * ry)]);
        }
      } else if (shape === "hexagon") {
        points = [
          [left + (innerWidth * 0.25), top],
          [right - (innerWidth * 0.25), top],
          [right, cy],
          [right - (innerWidth * 0.25), bottom],
          [left + (innerWidth * 0.25), bottom],
          [left, cy],
        ];
      } else if (shape === "parallelogram") {
        const skew = innerWidth * shapeAdjustRatio;
        points = [
          [left + skew, top],
          [right, top],
          [right - skew, bottom],
          [left, bottom],
        ];
      } else if (shape === "trapezoid") {
        const inset = innerWidth * shapeAdjustRatio;
        points = [
          [left + inset, top],
          [right - inset, top],
          [right, bottom],
          [left, bottom],
        ];
      } else {
        points = [[left, top], [right, top], [right, bottom], [left, bottom]];
      }
      shapeNode.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
    }
    shapeNode.setAttribute("fill", fill);
    shapeNode.setAttribute("stroke", strokeColor);
    if (hasStroke) {
      shapeNode.setAttribute("stroke-width", String(Math.max(1, strokeWidthPx)));
      if (dashArray) shapeNode.setAttribute("stroke-dasharray", dashArray);
    } else {
      shapeNode.setAttribute("stroke-width", "0");
    }
    shapeNode.setAttribute("vector-effect", "non-scaling-stroke");
    shapeNode.setAttribute("stroke-linecap", "round");
    shapeNode.setAttribute("stroke-linejoin", "round");
    svg.appendChild(shapeNode);
    return svg;
  }

  _appendShapeSurface(host, element, widthPx, heightPx, options = {}) {
    if (!host || !element) return;
    const svg = this._createShapeSurfaceSvg(element, widthPx, heightPx, {
      ...options,
      ppi: toFiniteNumber(options.ppi, Math.max(1, widthPx / Math.max(MIN_ELEMENT_IN, toFiniteNumber(element.w, 1)))),
      className: `sheet-slides-shape-surface ${options.className || ""}`.trim(),
    });
    if (svg) host.appendChild(svg);
  }

  _appendStrokeOverlay(host, element, widthPx, heightPx, { shape = "rect", radiusPx = 0 } = {}) {
    if (!host || !element) return;
    const svg = this._createShapeSurfaceSvg(element, widthPx, heightPx, {
      shape,
      radiusPx,
      fillColor: null,
      ppi: Math.max(1, widthPx / Math.max(MIN_ELEMENT_IN, toFiniteNumber(element.w, 1))),
      className: "sheet-slides-stroke-overlay",
    });
    if (!svg) return;
    host.appendChild(svg);
  }

  _getPmiImageCaptureKey(element, view = this._resolvePmiViewForElement(element), viewIndex = this._resolvePmiViewIndexForElement(element, view)) {
    return [
      "trim-v5",
      this._getCurrentModelRevision(),
      this._pmiViewRevision,
      Number.isInteger(viewIndex) ? viewIndex : -1,
      String(view?.viewName || view?.name || element?.pmiViewName || "PMI View"),
      this._getPmiRenderMode(element),
      this._getPmiShowCenterLines(element) ? "centerlines:on" : "centerlines:off",
      this._getPmiViewStateSignature(view),
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
      .then(() => this._capturePmiViewImage(view, viewIndex, {
        renderMode: this._getPmiRenderMode(element),
        showCenterLines: this._getPmiShowCenterLines(element),
      }))
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
    const previousMetadata = this._getMediaMetadataForElement(element);
    const hadImageBefore = !!String(element.src || "").trim();
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
    element.mediaScale = 1;
    element.mediaOffsetX = 0;
    element.mediaOffsetY = 0;
    this._fitPmiInsetFrameToImage(element, dataUrl, hadImageBefore ? previousMetadata : null);
    return true;
  }

  _fitPmiInsetFrameToImage(element, src = element?.src, previousMetadata = null) {
    if (!element || element.type !== "pmiInset") return false;
    const metadata = this._mediaMetadataCache.get(String(src || "").trim()) || null;
    const naturalWidth = Math.max(1, toFiniteNumber(metadata?.width, 0));
    const naturalHeight = Math.max(1, toFiniteNumber(metadata?.height, 0));
    if (!naturalWidth || !naturalHeight) return false;

    const frame = this._getMediaFrameBox(element);
    const anchor = this._getPmiAnchorValue(element);
    const fractions = this._getAnchorFractions(anchor);
    const anchorX = frame.x + (frame.w * fractions.x);
    const anchorY = frame.y + (frame.h * fractions.y);
    const captionHeight = this._getPmiTitleHeightIn(element);

    let nextFrameWidth = frame.w;
    let nextFrameHeight = frame.h;
    const previousWidth = Math.max(1, toFiniteNumber(previousMetadata?.width, 0));
    const previousHeight = Math.max(1, toFiniteNumber(previousMetadata?.height, 0));

    if (previousWidth > 0 && previousHeight > 0) {
      const scale = Math.min(frame.w / previousWidth, frame.h / previousHeight);
      nextFrameWidth = Math.max(MIN_ELEMENT_IN, naturalWidth * scale);
      nextFrameHeight = Math.max(MIN_ELEMENT_IN, naturalHeight * scale);
    } else {
      const suggested = this._getSuggestedPmiInsetSize(metadata, this._getPmiLabelPosition(element) !== "none");
      nextFrameWidth = suggested.frameWidth;
      nextFrameHeight = suggested.frameHeight;
    }

    const nextOuterHeight = nextFrameHeight + captionHeight;

    element.w = nextFrameWidth;
    element.h = nextOuterHeight;
    element.x = anchorX - (nextFrameWidth * fractions.x);
    element.y = anchorY - (nextFrameHeight * fractions.y);
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
        const dataUrl = cached || await this._capturePmiViewImage(group.view, group.viewIndex, {
          renderMode: this._getPmiRenderMode(group.elementSnapshot),
          showCenterLines: this._getPmiShowCenterLines(group.elementSnapshot),
        });
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

  async _capturePmiViewImage(view, viewIndex, { renderMode = "shaded", showCenterLines = false } = {}) {
    const widget = this.viewer?.pmiViewsWidget || null;
    if (!widget || typeof widget.captureViewImageDataUrl !== "function") return null;

    let dataUrl = null;
    try {
      dataUrl = await widget.captureViewImageDataUrl(view, viewIndex, {
        renderMode: normalizePmiRenderMode(renderMode, "shaded"),
        showCenterLines: !!showCenterLines,
      });
    } catch {
      dataUrl = null;
    }

    if (dataUrl) {
      const source = String(dataUrl || "").trim();
      if (source.startsWith("data:image/svg+xml")) {
        await this._rememberImageDataUrlMetadata(source);
      } else {
        dataUrl = await this._trimTransparentImageDataUrl(dataUrl, 4);
      }
    }
    return dataUrl;
  }

  async _rememberImageDataUrlMetadata(dataUrl) {
    const source = String(dataUrl || "").trim();
    if (!source.startsWith("data:image/")) return false;

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const width = Math.max(1, Math.round(toFiniteNumber(image.naturalWidth, image.width)));
        const height = Math.max(1, Math.round(toFiniteNumber(image.naturalHeight, image.height)));
        resolve(this._rememberMediaMetadata(source, width, height));
      };
      image.onerror = () => resolve(false);
      image.src = source;
    });
  }

  async _trimTransparentImageDataUrl(dataUrl, paddingPx = 0) {
    const source = String(dataUrl || "").trim();
    if (!source.startsWith("data:image/")) return source;

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const width = Math.max(1, Math.round(toFiniteNumber(image.naturalWidth, image.width)));
        const height = Math.max(1, Math.round(toFiniteNumber(image.naturalHeight, image.height)));
        this._rememberMediaMetadata(source, width, height);
        if (!width || !height) {
          resolve(source);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(source);
          return;
        }

        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        let imageData;
        try {
          imageData = context.getImageData(0, 0, width, height);
        } catch {
          resolve(source);
          return;
        }

        const alphaThreshold = 8;
        const pixels = imageData.data;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y += 1) {
          const rowOffset = y * width * 4;
          for (let x = 0; x < width; x += 1) {
            const alpha = pixels[rowOffset + (x * 4) + 3];
            if (alpha <= alphaThreshold) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < minX || maxY < minY) {
          resolve(source);
          return;
        }

        const padding = Math.max(0, Math.round(toFiniteNumber(paddingPx, 0)));
        const cropX = Math.max(0, minX - padding);
        const cropY = Math.max(0, minY - padding);
        const cropRight = Math.min(width, maxX + 1 + padding);
        const cropBottom = Math.min(height, maxY + 1 + padding);
        const cropWidth = Math.max(1, cropRight - cropX);
        const cropHeight = Math.max(1, cropBottom - cropY);

        if (cropX === 0 && cropY === 0 && cropWidth === width && cropHeight === height) {
          resolve(source);
          return;
        }

        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = cropWidth;
        outputCanvas.height = cropHeight;
        const outputContext = outputCanvas.getContext("2d");
        if (!outputContext) {
          resolve(source);
          return;
        }

        outputContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        const outputDataUrl = outputCanvas.toDataURL("image/png");
        this._rememberMediaMetadata(outputDataUrl, cropWidth, cropHeight);
        resolve(outputDataUrl);
      };
      image.onerror = () => resolve(source);
      image.src = source;
    });
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
    const selectionCount = this._getSelectedElementIds().length;
    const editingGroup = !!this._getActiveEditingGroupId();
    const selected = selectionCount === 1 ? this._getSelectedElement() : null;
    const hasElement = !!selected;
    const textState = selectionCount === 1 ? this._getSelectedTextState() : null;
    const supportsText = !!textState;
    const supportsFormboardText = !!textState?.isFormboard;
    const supportsCrop = hasElement && elementSupportsMediaCrop(selected);
    const isPMI = hasElement && selected.type === "pmiInset";
    const isLine = hasElement && selected.type === "line";
    const isRect = hasElement && selected.type === "rect";
    const isTable = hasElement && isTableElementType(selected);
    const isCustomSheet = String(sheet?.sizeKey || "") === "CUSTOM";

    this._renderSelectionToolbar();

    this._sheetNameInput.value = String(sheet?.name || "");
    if (this._sheetSizeInput) this._sheetSizeInput.value = String(sheet?.sizeKey || DEFAULT_SHEET_SIZE_KEY);
    if (this._sheetOrientationInput) this._sheetOrientationInput.value = String(sheet?.orientation || DEFAULT_SHEET_ORIENTATION);
    if (this._sheetCustomWidthInput) {
      this._sheetCustomWidthInput.value = String(
        Math.max(MIN_CUSTOM_SHEET_SIZE_IN, toFiniteNumber(sheet?.customWidthIn ?? sheet?.widthIn, 11)),
      );
    }
    if (this._sheetCustomHeightInput) {
      this._sheetCustomHeightInput.value = String(
        Math.max(MIN_CUSTOM_SHEET_SIZE_IN, toFiniteNumber(sheet?.customHeightIn ?? sheet?.heightIn, 8.5)),
      );
    }
    this._sheetBgInput.value = normalizeHex(sheet?.background, this._defaultSheetBackground());
    if (this._sheetSizeInput) this._sheetSizeInput.disabled = !sheet;
    if (this._sheetOrientationInput) this._sheetOrientationInput.disabled = !sheet;
    if (this._sheetCustomWidthInput) this._sheetCustomWidthInput.disabled = !sheet || !isCustomSheet;
    if (this._sheetCustomHeightInput) this._sheetCustomHeightInput.disabled = !sheet || !isCustomSheet;
    if (this._sheetCustomWidthField) this._sheetCustomWidthField.style.display = isCustomSheet ? "flex" : "none";
    if (this._sheetCustomHeightField) this._sheetCustomHeightField.style.display = isCustomSheet ? "flex" : "none";
    this._sheetBgResetBtn.disabled = !sheet;

    this._selectionLabel.textContent = selectionCount > 1
      ? `${selectionCount} selected${editingGroup ? " · editing group" : ""}`
      : (selected
        ? `${selected.type}${selected.type === "pmiInset" ? ` · ${this._resolvePmiViewDisplayName(selected)}` : ""}${editingGroup ? " · editing group" : ""}`
        : "No selection");

    if (this._slidePanel) this._slidePanel.style.display = selectionCount === 0 ? "block" : "none";
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
    this._strokeInput.disabled = disable || isLine;
    this._strokeResetBtn.disabled = disable || isLine;
    this._strokeWidthInput.disabled = disable || isLine;
    if (this._cornerRadiusInput) this._cornerRadiusInput.disabled = !isRect;
    this._textInput.disabled = !supportsText || supportsFormboardText || !!(textState?.isTable && !textState.canEditTextContent);
    this._fontFamilyInput.disabled = !supportsText || supportsFormboardText;
    this._textColorInput.disabled = !supportsText || supportsFormboardText;
    this._textColorResetBtn.disabled = !supportsText || supportsFormboardText;
    this._fontSizeInput.disabled = !supportsText;
    this._fontSizeDecrementBtn.disabled = !supportsText;
    this._fontSizeIncrementBtn.disabled = !supportsText;
    if (this._boldBtn) this._boldBtn.disabled = !supportsText || supportsFormboardText;
    if (this._italicBtn) this._italicBtn.disabled = !supportsText || supportsFormboardText;
    if (this._underlineBtn) this._underlineBtn.disabled = !supportsText || supportsFormboardText;
    Object.values(this._textAlignButtons || {}).forEach((button) => { button.disabled = !supportsText || supportsFormboardText; });
    Object.values(this._verticalAlignButtons || {}).forEach((button) => { button.disabled = !supportsText || supportsFormboardText; });
    if (this._tableTextScopeInput) this._tableTextScopeInput.disabled = !isTable;
    this._pmiBgInput.disabled = !isPMI;
    this._pmiBgResetBtn.disabled = !isPMI;
    if (this._pmiAnchorInput) this._pmiAnchorInput.disabled = !isPMI;
    if (this._pmiLabelPositionInput) this._pmiLabelPositionInput.disabled = !isPMI;
    if (this._pmiRenderModeInput) this._pmiRenderModeInput.disabled = !isPMI;
    if (this._showPmiCenterLinesInput) {
      this._showPmiCenterLinesInput.disabled = !isPMI || this._getPmiRenderMode(selected) !== "monochrome";
    }
    if (this._pmiCenterLinesField) {
      this._pmiCenterLinesField.style.display = isPMI && this._getPmiRenderMode(selected) === "monochrome" ? "" : "none";
    }
    this._showPmiBackgroundInput.disabled = !isPMI;
    this._cropToggleBtn.disabled = !supportsCrop;
    this._resetCropBtn.disabled = !supportsCrop;
    this._fillField.style.display = hasElement && (isPMI || isLine) ? "none" : "";
    this._strokeField.style.display = hasElement ? "" : "none";
    if (this._cornerRadiusField) this._cornerRadiusField.style.display = isRect ? "" : "none";

    if (!hasElement) {
      this._xInput.value = "";
      this._yInput.value = "";
      this._wInput.value = "";
      this._hInput.value = "";
      this._rotInput.value = "";
      this._fillInput.value = "#000000";
      this._strokeInput.value = "#000000";
      this._strokeWidthInput.value = "";
      if (this._cornerRadiusInput) this._cornerRadiusInput.value = "";
      this._opacityInput.value = "";
      this._zInput.value = "";
      this._textPanel.style.display = "none";
      if (this._tableTextScopeField) this._tableTextScopeField.style.display = "none";
      if (this._textContentField) this._textContentField.style.display = "";
      this._cropPanel.style.display = "none";
      this._pmiPanel.style.display = "none";
      this._cropToggleBtn.textContent = "Crop";
      this._cropToggleBtn.classList.remove("primary");
      this._cropHint.textContent = "";
      this._pmiNameValue.textContent = "";
      if (this._pmiLabelPositionInput) this._pmiLabelPositionInput.value = "bottom";
      if (this._pmiRenderModeInput) this._pmiRenderModeInput.value = "shaded";
      if (this._showPmiCenterLinesInput) this._showPmiCenterLinesInput.checked = false;
      if (this._pmiCenterLinesField) this._pmiCenterLinesField.style.display = "none";
      this._showPmiBackgroundInput.checked = false;
      this._pmiBgInput.value = "#ffffff";
      this._pmiBgInput.disabled = true;
      this._pmiBgResetBtn.disabled = true;
      if (this._tableTextScopeInput) this._tableTextScopeInput.value = this._getTableTextScope();
      if (this._pmiAnchorInput) this._pmiAnchorInput.value = "c";
      Object.values(this._textAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
      Object.values(this._verticalAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
      if (this._underlineBtn) this._underlineBtn.classList.remove("primary");
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
      this._strokeInput.value = normalizeHex(selected.stroke, this._defaultStrokeForElement(selected));
      this._strokeWidthInput.value = formatPointValue(inchesToPoints(toFiniteNumber(selected.strokeWidth, 0.02)));
      if (this._cornerRadiusInput) this._cornerRadiusInput.value = "";
      this._opacityInput.value = String(clamp(toFiniteNumber(selected.opacity, 1), 0, 1));
      this._zInput.value = String(Math.round(toFiniteNumber(selected.z, 0)));
      this._wInput.disabled = true;
      this._hInput.disabled = true;
      this._rotInput.disabled = true;
      this._fillInput.disabled = true;
      this._fillResetBtn.disabled = true;
      this._strokeInput.disabled = false;
      this._strokeResetBtn.disabled = false;
      this._strokeWidthInput.disabled = false;
      this._textPanel.style.display = supportsFormboardText ? "block" : "none";
      this._cropPanel.style.display = "none";
      this._pmiPanel.style.display = "none";
      this._fillField.style.display = "none";
      this._strokeField.style.display = "block";
      if (supportsFormboardText) {
        if (this._tableTextScopeField) this._tableTextScopeField.style.display = "none";
        if (this._textContentField) this._textContentField.style.display = "none";
        this._textInput.value = "";
        this._fontFamilyInput.value = String(textState.fontFamily || "Arial, Helvetica, sans-serif");
        this._fontSizeInput.value = String(Math.round(inchesToPoints(toFiniteNumber(textState.fontSize, 0.32))));
        this._textColorInput.value = normalizeHex(textState.color, this._defaultTextColorForElement(selected));
        Object.values(this._textAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
        Object.values(this._verticalAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
        if (this._boldBtn) this._boldBtn.classList.remove("primary");
        if (this._italicBtn) this._italicBtn.classList.remove("primary");
        if (this._underlineBtn) this._underlineBtn.classList.remove("primary");
      }
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
    this._strokeInput.value = normalizeHex(selected.stroke, this._defaultStrokeForElement(selected));
    const strokeWidthPt = selected.type === "text" && !this._isTextBorderEnabled(selected)
      ? 0
      : (Math.round(inchesToPoints(toFiniteNumber(selected.strokeWidth, this._defaultStrokeWidthForElement(selected))) * 100) / 100);
    this._strokeWidthInput.value = formatPointValue(strokeWidthPt);
    if (this._cornerRadiusInput) {
      this._cornerRadiusInput.value = isRect
        ? String(Math.round(toFiniteNumber(selected.cornerRadius, 0) * ppi))
        : "";
    }
    this._opacityInput.value = String(clamp(toFiniteNumber(selected.opacity, 1), 0, 1));
    this._zInput.value = String(Math.round(toFiniteNumber(selected.z, 0)));

    if (isPMI) {
      this._fillInput.disabled = true;
      this._fillResetBtn.disabled = true;
    }

    this._textPanel.style.display = supportsText ? "block" : "none";
    if (this._tableTextScopeField) this._tableTextScopeField.style.display = isTable ? "" : "none";
    if (this._textContentField) {
      this._textContentField.style.display = (supportsFormboardText || (isTable && !textState?.canEditTextContent)) ? "none" : "";
    }
    this._cropPanel.style.display = supportsCrop ? "block" : "none";
    this._pmiPanel.style.display = isPMI ? "block" : "none";
    if (!supportsCrop) {
      this._cropToggleBtn.textContent = "Crop";
      this._cropToggleBtn.classList.remove("primary");
      this._cropHint.textContent = "";
    }

    if (supportsText) {
      this._textInput.value = textState.canEditTextContent ? String(textState.text || "") : "";
      if (this._tableTextScopeInput) this._tableTextScopeInput.value = textState.isTable ? textState.scope : "cell";
      this._fontFamilyInput.value = String(textState.fontFamily || "Arial, Helvetica, sans-serif");
      this._fontSizeInput.value = String(Math.round(inchesToPoints(toFiniteNumber(textState.fontSize, 0.32))));
      this._textColorInput.value = normalizeHex(textState.color, this._defaultTextColorForElement(selected));
      const textAlign = String(textState.textAlign || "left");
      const verticalAlign = String(textState.verticalAlign || "middle");
      Object.entries(this._textAlignButtons || {}).forEach(([value, button]) => {
        button.classList.toggle("primary", value === textAlign);
      });
      Object.entries(this._verticalAlignButtons || {}).forEach(([value, button]) => {
        button.classList.toggle("primary", value === verticalAlign);
      });
      this._boldBtn.classList.toggle("primary", String(textState.fontWeight || "400") === "700");
      this._italicBtn.classList.toggle("primary", String(textState.fontStyle || "normal") === "italic");
      if (this._underlineBtn) {
        this._underlineBtn.classList.toggle("primary", String(textState.textDecoration || "none") === "underline");
      }
    } else {
      if (this._tableTextScopeInput) this._tableTextScopeInput.value = this._getTableTextScope();
      Object.values(this._textAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
      Object.values(this._verticalAlignButtons || {}).forEach((button) => button.classList.remove("primary"));
      if (this._underlineBtn) this._underlineBtn.classList.remove("primary");
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
      if (this._pmiAnchorInput) this._pmiAnchorInput.value = this._getPmiAnchorValue(selected);
      if (this._pmiLabelPositionInput) this._pmiLabelPositionInput.value = this._getPmiLabelPosition(selected);
      if (this._pmiRenderModeInput) this._pmiRenderModeInput.value = this._getPmiRenderMode(selected);
      if (this._showPmiCenterLinesInput) this._showPmiCenterLinesInput.checked = this._getPmiShowCenterLines(selected);
      if (this._pmiCenterLinesField) this._pmiCenterLinesField.style.display = this._getPmiRenderMode(selected) === "monochrome" ? "" : "none";
      this._showPmiBackgroundInput.checked = !isTransparentColor(selected.fill);
      this._pmiBgInput.value = normalizeHex(selected.fill, "#ffffff");
      this._pmiBgInput.disabled = isTransparentColor(selected.fill);
    } else {
      if (this._pmiAnchorInput) this._pmiAnchorInput.value = "c";
      if (this._pmiLabelPositionInput) this._pmiLabelPositionInput.value = "bottom";
      if (this._pmiRenderModeInput) this._pmiRenderModeInput.value = "shaded";
      if (this._showPmiCenterLinesInput) this._showPmiCenterLinesInput.checked = false;
      if (this._pmiCenterLinesField) this._pmiCenterLinesField.style.display = "none";
    }
  }

  _onStagePointerDown(event) {
    if (!this.sheetDraft) return;
    if (isPointerFromInput(event)) return;

    const elementNode = event?.target?.closest?.(".sheet-slides-element");
    const isCanvasHit = event.target === this._slideCanvas || event.target?.classList?.contains?.("sheet-slides-grid");
    const shouldPan = event.button === 1 || (event.button === 2 && !elementNode);

    if (shouldPan) {
      this._ensureManualStageView();
      this._dragState = {
        pointerId: event.pointerId,
        mode: "stage-pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: toFiniteNumber(this._appliedStagePanX, 0),
        startPanY: toFiniteNumber(this._appliedStagePanY, 0),
        moved: false,
        captureTarget: this._stageWrap,
      };
      this._stageWrap?.classList?.add("is-panning");
      try { this._stageWrap?.setPointerCapture?.(event.pointerId); } catch { }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.button !== 0) return;
    if (elementNode || isCanvasHit) return;

    this._hideContextMenu();
    this._cropModeElementId = null;
    this._clearSelection();
    this._renderStageOnly();
    this._renderInspector();
    event.preventDefault();
  }

  _onStageContextMenu(event) {
    if (!this.sheetDraft) return;
    if (isPointerFromInput(event)) return;
    if (event?.target?.closest?.(".sheet-slides-element")) {
      this._onCanvasContextMenu(event);
      return;
    }
    this._hideContextMenu();
    event.preventDefault();
  }

  _onStageWheel(event) {
    if (!this.sheetDraft || isPointerFromInput(event)) return;
    const deltaY = toFiniteNumber(event.deltaY, 0);
    if (!deltaY) return;

    const currentZoom = this._getStageZoom();
    const nextZoom = this._clampStageZoom(currentZoom * Math.exp(-deltaY * 0.0015), currentZoom);
    if (Math.abs(nextZoom - currentZoom) < 0.0001) {
      event.preventDefault();
      return;
    }

    this._setManualZoomAroundClientPoint(nextZoom, event.clientX, event.clientY);
    this._renderStageOnly();
    this._setStatus(`Zoom ${Math.round(this._getStageZoom() * 100)}%`);
    event.preventDefault();
  }

  _onCanvasPointerDown(event) {
    if (!this.sheetDraft) return;
    if (event.button !== 0) return;
    if (isPointerFromInput(event)) return;
    if (event.target !== this._slideCanvas && !event.target.classList.contains("sheet-slides-grid")) return;
    this._hideContextMenu();
    this._cropModeElementId = null;
    this._clearSelection();
    this._renderStageOnly();
    this._renderInspector();
  }

  _onCanvasContextMenu(event) {
    if (!this.sheetDraft) return;
    if (isPointerFromInput(event)) return;

    const elementNode = event?.target?.closest?.(".sheet-slides-element");
    const tableCellNode = event?.target?.closest?.("[data-table-cell-row]");
    if (!elementNode) {
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

    const activeGroupId = this._getActiveEditingGroupId();
    if (activeGroupId && this._getElementGroupId(element) !== activeGroupId) {
      this._editingGroupId = "";
    }

    const elementIdText = String(elementId || "").trim();
    if (!this._isElementSelected(elementIdText)) {
      const selectedIds = (isTableElementType(element) && tableCellNode)
        ? [elementIdText]
        : this._getGroupedSelectionIds(element);
      this._setSelectedElementIds(selectedIds, elementIdText);
    }
    if (this._getSelectedElementIds().length === 1 && isTableElementType(element) && tableCellNode) {
      const tableData = this._getNormalizedTableData(element);
      const row = Math.max(0, Math.round(toFiniteNumber(tableCellNode.dataset.tableCellRow, 0)));
      const col = Math.max(0, Math.round(toFiniteNumber(tableCellNode.dataset.tableCellCol, 0)));
      const clickedAnchor = resolveTableCellAnchor(tableData, row, col);
      const activeRect = this._getActiveTableSelectionRect(element);
      const clickedInsideSelection = !!activeRect
        && clickedAnchor
        && clickedAnchor.row >= activeRect.minRow
        && clickedAnchor.row <= activeRect.maxRow
        && clickedAnchor.col >= activeRect.minCol
        && clickedAnchor.col <= activeRect.maxCol;
      if (!clickedInsideSelection) {
        this._setTableSelectionForCell(element, row, col);
      }
      this._contextMenuState = {
        kind: "table-cell",
        elementId,
        row: clickedAnchor?.row ?? row,
        col: clickedAnchor?.col ?? col,
      };
    } else {
      this._contextMenuState = { kind: "element", elementId };
    }
    this._renderStageOnly();
    this._renderInspector();
    this._showContextMenu(event.clientX, event.clientY);

    event.preventDefault();
    event.stopPropagation();
  }

  _captureSelectionSnapshot(elements = this._getSelectedElements()) {
    const entries = Array.isArray(elements) ? elements.filter(Boolean) : [];
    const bounds = this._getSelectionBoundsIn(entries);
    if (!bounds) return null;
    return {
      bounds,
      items: entries.map((element) => ({
        id: String(element.id || ""),
        source: deepClone(element),
      })),
    };
  }

  _resizeBoundsFromHandle(bounds, handle, dx, dy, keepAspect = false) {
    if (!bounds || !handle) return bounds;
    let x = toFiniteNumber(bounds.x, 0);
    let y = toFiniteNumber(bounds.y, 0);
    let w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(bounds.w, 1));
    let h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(bounds.h, 1));

    if (handle.includes("e")) w = Math.max(MIN_ELEMENT_IN, w + dx);
    if (handle.includes("s")) h = Math.max(MIN_ELEMENT_IN, h + dy);
    if (handle.includes("w")) {
      w = Math.max(MIN_ELEMENT_IN, w - dx);
      x = toFiniteNumber(bounds.x, 0) + dx;
      if (w <= MIN_ELEMENT_IN) x = toFiniteNumber(bounds.x, 0) + (toFiniteNumber(bounds.w, 1) - MIN_ELEMENT_IN);
    }
    if (handle.includes("n")) {
      h = Math.max(MIN_ELEMENT_IN, h - dy);
      y = toFiniteNumber(bounds.y, 0) + dy;
      if (h <= MIN_ELEMENT_IN) y = toFiniteNumber(bounds.y, 0) + (toFiniteNumber(bounds.h, 1) - MIN_ELEMENT_IN);
    }

    if (keepAspect) {
      const ratio = Math.max(1e-6, toFiniteNumber(bounds.w, 1) / Math.max(MIN_ELEMENT_IN, toFiniteNumber(bounds.h, 1)));
      if (Math.abs(dx) >= Math.abs(dy)) {
        h = Math.max(MIN_ELEMENT_IN, w / ratio);
      } else {
        w = Math.max(MIN_ELEMENT_IN, h * ratio);
      }

      if (handle.includes("w")) {
        x = toFiniteNumber(bounds.x, 0) + (toFiniteNumber(bounds.w, 1) - w);
      } else if (!handle.includes("e")) {
        x = toFiniteNumber(bounds.x, 0) + ((toFiniteNumber(bounds.w, 1) - w) * 0.5);
      }
      if (handle.includes("n")) {
        y = toFiniteNumber(bounds.y, 0) + (toFiniteNumber(bounds.h, 1) - h);
      } else if (!handle.includes("s")) {
        y = toFiniteNumber(bounds.y, 0) + ((toFiniteNumber(bounds.h, 1) - h) * 0.5);
      }
    }

    return { x, y, w, h };
  }

  _applySelectionMove(snapshot, dx, dy) {
    if (!snapshot?.items?.length) return;
    for (const item of snapshot.items) {
      const element = this._getElementById(item.id);
      const source = item.source;
      if (!element || !source) continue;
      if (element.type === "line") {
        element.x = toFiniteNumber(source.x, 0) + dx;
        element.y = toFiniteNumber(source.y, 0) + dy;
        element.x2 = toFiniteNumber(source.x2, source.x) + dx;
        element.y2 = toFiniteNumber(source.y2, source.y) + dy;
      } else {
        element.x = toFiniteNumber(source.x, 0) + dx;
        element.y = toFiniteNumber(source.y, 0) + dy;
      }
    }
  }

  _applySelectionResize(snapshot, handle, dx, dy, keepAspect = false) {
    if (!snapshot?.items?.length || !snapshot?.bounds || !handle) return;
    const sourceBounds = snapshot.bounds;
    const nextBounds = this._resizeBoundsFromHandle(sourceBounds, handle, dx, dy, keepAspect);
    const scaleX = Math.max(1e-6, nextBounds.w / Math.max(MIN_ELEMENT_IN, sourceBounds.w));
    const scaleY = Math.max(1e-6, nextBounds.h / Math.max(MIN_ELEMENT_IN, sourceBounds.h));

    for (const item of snapshot.items) {
      const element = this._getElementById(item.id);
      const source = item.source;
      if (!element || !source) continue;
      if (element.type === "line") {
        element.x = nextBounds.x + ((toFiniteNumber(source.x, 0) - sourceBounds.x) * scaleX);
        element.y = nextBounds.y + ((toFiniteNumber(source.y, 0) - sourceBounds.y) * scaleY);
        element.x2 = nextBounds.x + ((toFiniteNumber(source.x2, source.x) - sourceBounds.x) * scaleX);
        element.y2 = nextBounds.y + ((toFiniteNumber(source.y2, source.y) - sourceBounds.y) * scaleY);
        continue;
      }

      element.x = nextBounds.x + ((toFiniteNumber(source.x, 0) - sourceBounds.x) * scaleX);
      element.y = nextBounds.y + ((toFiniteNumber(source.y, 0) - sourceBounds.y) * scaleY);
      element.w = Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1) * scaleX);
      element.h = Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1) * scaleY);

      if (element.type === "rect") {
        element.cornerRadius = clamp(
          toFiniteNumber(source.cornerRadius, 0) * Math.min(scaleX, scaleY),
          0,
          Math.min(element.w, element.h) * 0.5,
        );
      } else if (shapeSupportsAdjustHandle(element.type)) {
        element.shapeAdjust = clampShapeAdjust(element.type, source.shapeAdjust);
      }
    }
  }

  _applySelectionRotation(snapshot, deltaDeg) {
    if (!snapshot?.items?.length || !snapshot?.bounds) return;
    const cx = snapshot.bounds.x + (snapshot.bounds.w * 0.5);
    const cy = snapshot.bounds.y + (snapshot.bounds.h * 0.5);
    const radians = toFiniteNumber(deltaDeg, 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotatePoint = (x, y) => {
      const ox = x - cx;
      const oy = y - cy;
      return {
        x: cx + (ox * cos) - (oy * sin),
        y: cy + (ox * sin) + (oy * cos),
      };
    };

    for (const item of snapshot.items) {
      const element = this._getElementById(item.id);
      const source = item.source;
      if (!element || !source) continue;
      if (element.type === "line") {
        const p1 = rotatePoint(toFiniteNumber(source.x, 0), toFiniteNumber(source.y, 0));
        const p2 = rotatePoint(toFiniteNumber(source.x2, source.x), toFiniteNumber(source.y2, source.y));
        element.x = p1.x;
        element.y = p1.y;
        element.x2 = p2.x;
        element.y2 = p2.y;
        continue;
      }

      const sourceCenter = {
        x: toFiniteNumber(source.x, 0) + (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1)) * 0.5),
        y: toFiniteNumber(source.y, 0) + (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1)) * 0.5),
      };
      const nextCenter = rotatePoint(sourceCenter.x, sourceCenter.y);
      element.x = nextCenter.x - (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1)) * 0.5);
      element.y = nextCenter.y - (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1)) * 0.5);
      element.rotationDeg = Math.round((toFiniteNumber(source.rotationDeg, 0) + toFiniteNumber(deltaDeg, 0)) * 10) / 10;
    }
  }

  _onSelectionOverlayPointerDown(event) {
    if (!this.sheetDraft) return;
    if (event.button !== 0) return;
    if (isPointerFromInput(event)) return;

    const selectedElements = this._getSelectedElements();
    const handle = String(event?.target?.dataset?.handle || "").trim();
    if (handle === "formboard-node") {
      const selectedLine = selectedElements.length === 1 ? selectedElements[0] : null;
      const groupId = this._getElementGroupId(selectedLine);
      const nodeId = String(event?.target?.dataset?.nodeId || "").trim();
      if (!groupId || !nodeId) return;
      this._selectedFormboardPivot = { groupId, nodeId };
      this._renderStageOnly();
      this._setStatus("Pivot selected. Drag a blue midpoint handle to rotate the branch attached to this node.");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (handle === "formboard-segment") {
      const selectedLine = selectedElements.length === 1 ? selectedElements[0] : null;
      const groupId = this._getElementGroupId(selectedLine);
      const nodeId = String(event?.target?.dataset?.nodeId || "").trim();
      const segmentId = String(event?.target?.dataset?.segmentId || "").trim();
      const pivotSnapshot = this._buildFormboardPivotDragSnapshot(groupId, nodeId, segmentId);
      if (!pivotSnapshot) return;
      const slideRect = this._getStageWorldRect();
      if (!slideRect) return;
      const point = this._eventToSlidePoint(event, slideRect);
      const pivotNode = pivotSnapshot.model.nodes.get(pivotSnapshot.pivotNodeId);
      if (!pivotNode) return;
      const ppi = this._pxPerIn();
      this._dragState = {
        pointerId: event.pointerId,
        mode: "formboard-pivot-rotate",
        startX: point.x,
        startY: point.y,
        formboardSnapshot: pivotSnapshot,
        startAngleRad: Math.atan2(point.y - (pivotNode.y * ppi), point.x - (pivotNode.x * ppi)),
        moved: false,
        captureTarget: event.currentTarget,
      };

      try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (selectedElements.length <= 1) return;

    this._hideContextMenu();

    const slideRect = this._getStageWorldRect();
    if (!slideRect) return;

    const point = this._eventToSlidePoint(event, slideRect);
    const selectionSnapshot = this._captureSelectionSnapshot(selectedElements);
    if (!selectionSnapshot) return;
    const lockedFormboardGeometry = this._selectionContainsLockedFormboardGeometry(selectedElements);
    if (lockedFormboardGeometry && handle && handle !== "rotate") return;

    const mode = handle === "rotate"
      ? "selection-rotate"
      : (handle ? "selection-resize" : "selection-move");
    const cx = (selectionSnapshot.bounds.x + (selectionSnapshot.bounds.w * 0.5)) * this._pxPerIn();
    const cy = (selectionSnapshot.bounds.y + (selectionSnapshot.bounds.h * 0.5)) * this._pxPerIn();

    this._dragState = {
      pointerId: event.pointerId,
      mode,
      handle,
      startX: point.x,
      startY: point.y,
      selectionSnapshot,
      startAngleRad: Math.atan2(point.y - cy, point.x - cx),
      moved: false,
      captureTarget: event.currentTarget,
    };

    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { }
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

    const cropHandle = String(event?.target?.dataset?.cropHandle || "").trim();
    const normalHandle = String(event?.target?.dataset?.handle || "").trim();
    const tableCellNode = event?.target?.closest?.("[data-table-cell-row]");
    const tableColHandle = event?.target?.closest?.("[data-handle='table-col-resize']");
    const tableColBoundary = Number(tableColHandle?.dataset?.tableColBoundary);
    const cropTarget = event?.target?.closest?.("[data-crop-target='media']");
    const previousSelectionIds = this._getSelectedElementIds();
    const previousSelectionKey = previousSelectionIds.slice().sort().join("|");
    const elementIdText = String(elementId || "").trim();
    const activeGroupId = this._getActiveEditingGroupId();
    if (activeGroupId && this._getElementGroupId(element) !== activeGroupId) {
      this._editingGroupId = "";
    }
    const wasSelected = previousSelectionIds.includes(elementIdText);
    const tableCellSelection = isTableElementType(element) && !!tableCellNode && !normalHandle;
    const clickedSelectionIds = tableCellSelection ? [elementIdText] : this._getGroupedSelectionIds(element);

    if (event.shiftKey && !tableCellSelection) {
      const nextIds = previousSelectionIds.slice();
      const toggleOff = clickedSelectionIds.every((id) => nextIds.includes(id));
      if (toggleOff) {
        const removal = new Set(clickedSelectionIds);
        this._setSelectedElementIds(nextIds.filter((id) => !removal.has(id)));
      } else {
        this._setSelectedElementIds([...nextIds, ...clickedSelectionIds], elementIdText);
      }
      this._renderStageOnly();
      this._renderInspector();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!wasSelected || previousSelectionIds.length <= 1) {
      this._setSelectedElementIds(clickedSelectionIds, elementIdText);
    }

    const currentSelectionIds = this._getSelectedElementIds();
    const selectionChanged = previousSelectionKey !== currentSelectionIds.slice().sort().join("|");
    const cropActive = currentSelectionIds.length === 1
      && this._isCropModeForElement(element)
      && elementSupportsMediaCrop(element);

    let mode = null;
    if (cropActive) {
      if (cropHandle) mode = "crop-resize";
      else if (cropTarget) mode = "crop-pan";
    } else if (currentSelectionIds.length > 1) {
      mode = "selection-move";
    } else if (isTableElementType(element) && Number.isInteger(tableColBoundary) && tableColBoundary > 0) {
      mode = "table-col-resize";
    } else if (isTableElementType(element) && tableCellNode && !normalHandle) {
      const row = Math.max(0, Math.round(toFiniteNumber(tableCellNode.dataset.tableCellRow, 0)));
      const col = Math.max(0, Math.round(toFiniteNumber(tableCellNode.dataset.tableCellCol, 0)));
      this._setTableSelectionForCell(element, row, col, { expand: !!event.shiftKey });
      if (selectionChanged) {
        this._renderStageOnly();
      } else if (event.shiftKey) {
        this._renderStageOnly();
      } else if (!event.shiftKey) {
        const existing = event.currentTarget?.querySelectorAll?.(".sheet-slides-table-cell.is-selected") || [];
        for (const node of existing) node.classList.remove("is-selected");
        tableCellNode.classList.add("is-selected");
      }
      this._renderInspector();
      event.preventDefault();
      event.stopPropagation();
      return;
    } else {
      mode = normalHandle === "rotate"
        ? "rotate"
        : (normalHandle === "table-move"
          ? "move"
        : (normalHandle === "corner-radius"
          ? "corner-radius"
          : (normalHandle === "shape-adjust"
            ? "shape-adjust"
            : (normalHandle ? "resize" : "move"))));
    }

    if (this._isFormboardElement(element) && currentSelectionIds.length === 1) {
      mode = null;
    }

    if (!mode) {
      if (this._isFormboardElement(element) && currentSelectionIds.length === 1) {
        this._setStatus("Click an orange pivot, then drag a blue midpoint handle to rotate the attached branch. Formboard segment lengths stay locked.");
      }
      if (selectionChanged) {
        this._renderStageOnly();
      }
      this._renderInspector();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const slideRect = this._getStageWorldRect();
    if (!slideRect) return;
    const point = this._eventToSlidePoint(event, slideRect);

    const mediaSnapshot = mode?.startsWith("crop")
      ? this._getMediaInteractionSnapshot(element, event.currentTarget)
      : null;
    if (mode?.startsWith("crop") && !mediaSnapshot) return;

    if (mode === "selection-move") {
      const selectionSnapshot = this._captureSelectionSnapshot(this._getSelectedElements());
      if (!selectionSnapshot) return;
      this._dragState = {
        pointerId: event.pointerId,
        mode,
        handle: null,
        startX: point.x,
        startY: point.y,
        selectionSnapshot,
        moved: false,
        captureTarget: event.currentTarget,
      };
    } else {
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
        tableColBoundary: Number.isInteger(tableColBoundary) ? tableColBoundary : null,
        captureTarget: event.currentTarget,
      };
    }

    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { }

    if (selectionChanged) {
      this._renderStageOnly();
    }
    this._renderInspector();

    event.preventDefault();
    event.stopPropagation();
  }

  _onElementDoubleClick(event, elementId) {
    const element = this._getElementById(elementId);
    if (!element) return;

    const groupId = this._getElementGroupId(element);
    if (groupId && this._getActiveEditingGroupId() !== groupId) {
      this._editingGroupId = groupId;
      this._setSelectedElementIds([String(elementId || "")], String(elementId || ""));
      this._renderStageOnly();
      this._renderInspector();
      this._setStatus("Editing group");
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this._setSelectedElementIds([String(elementId || "")], String(elementId || ""));
    if (isTableElementType(element)) {
      const cellNode = event?.target?.closest?.("[data-table-cell-row]");
      if (cellNode) {
        const row = Math.max(0, Math.round(toFiniteNumber(cellNode.dataset.tableCellRow, 0)));
        const col = Math.max(0, Math.round(toFiniteNumber(cellNode.dataset.tableCellCol, 0)));
        this._setTableSelectionForCell(element, row, col);
        this._renderInspector();
        this._beginTableCellEdit(cellNode, element, row, col);
      }
    } else if (elementSupportsMediaCrop(element)) {
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
    const editor = content?.querySelector?.(".sheet-slides-inline-text-body") || content;
    if (!content || !editor) return;

    editor.contentEditable = "true";
    editor.spellcheck = false;
    content.classList.add("editing");
    editor.focus();
    this._placeCaretAtEnd(editor);

    const commit = () => {
      editor.contentEditable = "false";
      content.classList.remove("editing");
      element.text = String(editor.innerText || editor.textContent || "").replace(/\r\n?/g, "\n");
      this._commitSheetDraft("text-inline");
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
    };

    const onKeyDown = (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        editor.blur();
      }
    };

    editor.addEventListener("keydown", onKeyDown);
    editor.addEventListener("blur", () => {
      editor.removeEventListener("keydown", onKeyDown);
      commit();
    }, { once: true });
  }

  _beginTableCellEdit(node, element, row, col) {
    if (!node || !isTableElementType(element)) return;
    const tableData = this._getNormalizedTableData(element);
    const anchor = resolveTableCellAnchor(tableData, row, col);
    if (!anchor?.cell) return;

    const editor = node.querySelector(".sheet-slides-table-cell-body");
    if (!editor) return;

    const originalText = String(anchor.cell.text || "");
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.classList.add("editing");
    editor.focus();
    this._placeCaretAtEnd(editor);

    let cancelled = false;
    const finish = () => {
      editor.contentEditable = "false";
      editor.classList.remove("editing");
      const nextText = cancelled
        ? originalText
        : String(editor.innerText || editor.textContent || "").replace(/\r\n?/g, "\n");
      if (cancelled) {
        editor.textContent = originalText;
        this._renderStageOnly();
        this._renderInspector();
        return;
      }
      if (nextText !== originalText) {
        const nextData = setTableCellText(this._getNormalizedTableData(element), anchor.row, anchor.col, nextText);
        this._commitTableChange(element, nextData, "table-cell-text", {
          anchorRow: anchor.row,
          anchorCol: anchor.col,
          focusRow: anchor.row,
          focusCol: anchor.col,
        });
      } else {
        this._renderStageOnly();
        this._renderInspector();
      }
    };

    const onKeyDown = (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        cancelled = true;
        editor.blur();
      }
    };

    editor.addEventListener("keydown", onKeyDown);
    editor.addEventListener("blur", () => {
      editor.removeEventListener("keydown", onKeyDown);
      finish();
    }, { once: true });
  }

  _onGlobalPointerMove(event) {
    if (!this._dragState || !this.sheetDraft) return;

    if (this._dragState.mode === "stage-pan") {
      const dxClient = event.clientX - toFiniteNumber(this._dragState.startClientX, event.clientX);
      const dyClient = event.clientY - toFiniteNumber(this._dragState.startClientY, event.clientY);
      if (!this._dragState.moved) {
        const travel = Math.hypot(dxClient, dyClient);
        if (travel < 3) return;
        this._dragState.moved = true;
      }
      this._stagePanX = toFiniteNumber(this._dragState.startPanX, 0) + dxClient;
      this._stagePanY = toFiniteNumber(this._dragState.startPanY, 0) + dyClient;
      this._renderStageOnly();
      return;
    }

    if (this._dragState.mode === "selection-move"
      || this._dragState.mode === "selection-resize"
      || this._dragState.mode === "selection-rotate"
      || this._dragState.mode === "formboard-pivot-rotate") {
      const slideRect = this._getStageWorldRect();
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
      const snapshot = this._dragState.selectionSnapshot;
      if (this._dragState.mode === "formboard-pivot-rotate") {
        const formboardSnapshot = this._dragState.formboardSnapshot;
        if (!formboardSnapshot) return;
        const pivotNode = formboardSnapshot.model.nodes.get(formboardSnapshot.pivotNodeId);
        if (!pivotNode) return;
        const angle = Math.atan2(point.y - (pivotNode.y * ppi), point.x - (pivotNode.x * ppi));
        const deltaDeg = (angle - toFiniteNumber(this._dragState.startAngleRad, angle)) * 180 / Math.PI;
        this._applyFormboardPivotRotation(formboardSnapshot, deltaDeg);
      } else if (!snapshot) {
        return;
      } else if (this._dragState.mode === "selection-move") {
        this._applySelectionMove(snapshot, dx, dy);
      } else if (this._dragState.mode === "selection-resize") {
        this._applySelectionResize(snapshot, this._dragState.handle, dx, dy, !!event.shiftKey);
      } else if (this._dragState.mode === "selection-rotate") {
        const cx = (snapshot.bounds.x + (snapshot.bounds.w * 0.5)) * ppi;
        const cy = (snapshot.bounds.y + (snapshot.bounds.h * 0.5)) * ppi;
        const angle = Math.atan2(point.y - cy, point.x - cx);
        const deltaDeg = (angle - toFiniteNumber(this._dragState.startAngleRad, angle)) * 180 / Math.PI;
        this._applySelectionRotation(snapshot, deltaDeg);
      }

      this._renderStageOnly();
      this._renderInspector();
      return;
    }

    const selected = this._getSelectedElement();
    if (!selected) return;

    const slideRect = this._getStageWorldRect();
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
    } else if (this._dragState.mode === "corner-radius") {
      if (selected.type === "rect") {
        const localPoint = this._slidePointToElementLocalPx(point, source);
        const maxRadiusPx = Math.max(0, Math.min(localPoint.widthPx, localPoint.heightPx) * 0.5);
        const nextRadiusPx = clamp(toFiniteNumber(localPoint.x, 0), 0, maxRadiusPx);
        selected.cornerRadius = nextRadiusPx / ppi;
      }
    } else if (this._dragState.mode === "shape-adjust") {
      if (shapeSupportsAdjustHandle(selected.type)) {
        const localPoint = this._slidePointToElementLocalPx(point, source);
        const nextAdjust = clampShapeAdjust(
          selected.type,
          toFiniteNumber(localPoint.x, 0) / Math.max(1, localPoint.widthPx),
        );
        selected.shapeAdjust = nextAdjust;
      }
    } else if (this._dragState.mode === "table-col-resize") {
      this._resizeTableColumnBoundary(selected, source, this._dragState.tableColBoundary, point);
    } else if (this._dragState.mode === "resize") {
      this._resizeElementFromHandle(
        selected,
        source,
        this._dragState.handle,
        dx,
        dy,
        !!event.shiftKey || elementUsesLockedAspectMedia(selected),
      );
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
    const dragState = this._dragState;
    const activePointerId = pointerId ?? this._dragState.pointerId;
    const moved = !!this._dragState.moved;
    try { dragState.captureTarget?.releasePointerCapture?.(activePointerId); } catch { }
    try { this._slideCanvas?.releasePointerCapture?.(activePointerId); } catch { }
    this._dragState = null;
    this._stageWrap?.classList?.remove("is-panning");
    if (dragState.mode === "stage-pan") {
      if (!moved && activePointerId != null) {
        this._stagePanX = toFiniteNumber(dragState.startPanX, 0);
        this._stagePanY = toFiniteNumber(dragState.startPanY, 0);
        this._renderStageOnly();
      }
      return;
    }
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
      const isMediaElement = elementSupportsMediaCrop(source);
      const captionHeight = isMediaElement ? this._getPmiTitleHeightIn(source) : 0;
      const sourceAspectHeight = isMediaElement
        ? Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1) - captionHeight)
        : Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1));
      const ratio = Math.max(1e-6, toFiniteNumber(source.w, 1) / sourceAspectHeight);
      if (Math.abs(dx) >= Math.abs(dy)) {
        const nextFrameHeight = Math.max(MIN_ELEMENT_IN, w / ratio);
        h = isMediaElement ? (nextFrameHeight + captionHeight) : nextFrameHeight;
      } else {
        const nextFrameHeight = isMediaElement
          ? Math.max(MIN_ELEMENT_IN, h - captionHeight)
          : Math.max(MIN_ELEMENT_IN, h);
        w = nextFrameHeight * ratio;
        if (isMediaElement) h = nextFrameHeight + captionHeight;
      }

      if (handle.includes("w")) {
        x = toFiniteNumber(source.x, 0) + (toFiniteNumber(source.w, 1) - w);
      } else if (!handle.includes("e")) {
        x = toFiniteNumber(source.x, 0) + ((toFiniteNumber(source.w, 1) - w) * 0.5);
      }
      if (handle.includes("n")) {
        y = toFiniteNumber(source.y, 0) + (toFiniteNumber(source.h, 1) - h);
      } else if (!handle.includes("s")) {
        y = toFiniteNumber(source.y, 0) + ((toFiniteNumber(source.h, 1) - h) * 0.5);
      }
    }

    element.x = x;
    element.y = y;
    element.w = Math.max(MIN_ELEMENT_IN, w);
    element.h = Math.max(MIN_ELEMENT_IN, h);
    if (element.type === "rect") {
      element.cornerRadius = clamp(
        toFiniteNumber(element.cornerRadius, 0),
        0,
        Math.min(element.w, element.h) * 0.5,
      );
    } else if (shapeSupportsAdjustHandle(element.type)) {
      element.shapeAdjust = clampShapeAdjust(element.type, element.shapeAdjust);
    }
  }

  _resizeTableColumnBoundary(element, source, boundaryIndex, point) {
    if (!isTableElementType(element) || !isTableElementType(source)) return;
    const boundary = Math.round(toFiniteNumber(boundaryIndex, -1));
    const ppi = this._pxPerIn();
    const layout = this._getTableLayoutMetrics(
      source,
      Math.max(1, toFiniteNumber(source.w, 1) * ppi),
      Math.max(1, toFiniteNumber(source.h, 1) * ppi),
      source.tableData,
    );
    if (boundary <= 0 || boundary >= layout.colCount) return;
    const previousEdge = toFiniteNumber(layout.colStarts?.[boundary - 1], 0);
    const currentEdge = toFiniteNumber(layout.colStarts?.[boundary], 0);
    const nextEdge = toFiniteNumber(layout.colStarts?.[boundary + 1], currentEdge);
    const localPoint = this._slidePointToElementLocalPx(point, source);
    const nextBoundary = clamp(
      toFiniteNumber(localPoint.x, currentEdge),
      previousEdge + TABLE_MIN_COL_WIDTH_PX,
      nextEdge - TABLE_MIN_COL_WIDTH_PX,
    );
    const nextTableData = cloneTableData(source.tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    nextTableData.colFractions[boundary - 1] = Math.max(0.0001, (nextBoundary - previousEdge) / Math.max(1, layout.widthPx));
    nextTableData.colFractions[boundary] = Math.max(0.0001, (nextEdge - nextBoundary) / Math.max(1, layout.widthPx));
    const total = nextTableData.colFractions.reduce((sum, value) => sum + Math.max(0, toFiniteNumber(value, 0)), 0);
    if (total > 0) {
      nextTableData.colFractions = nextTableData.colFractions.map((value) => Math.max(0.0001, toFiniteNumber(value, 0)) / total);
    }
    element.tableData = normalizeTableData(nextTableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
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

    if (event.key === "Escape" && this._toolbarPopover?.style.display !== "none") {
      event.preventDefault();
      this._closeToolbarPopover();
      return;
    }

    if (this._cropModeElementId && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault();
      this._exitCropMode();
      return;
    }

    if (event.key === "Escape" && this._getActiveEditingGroupId()) {
      event.preventDefault();
      this._editingGroupId = "";
      this._renderStageOnly();
      this._renderInspector();
      this._setStatus("Exited group edit");
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

    if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) this._ungroupSelectedElements();
      else this._groupSelectedElements();
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
    const selected = this._getSelectedElements();
    if (!selected.length) return;

    for (const element of selected) {
      if (element.type === "line") {
        element.x = toFiniteNumber(element.x, 0) + dx;
        element.y = toFiniteNumber(element.y, 0) + dy;
        element.x2 = toFiniteNumber(element.x2, element.x) + dx;
        element.y2 = toFiniteNumber(element.y2, element.y) + dy;
      } else {
        element.x = toFiniteNumber(element.x, 0) + dx;
        element.y = toFiniteNumber(element.y, 0) + dy;
      }
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
        if (elementUsesLockedAspectMedia(element)) {
          const frameBox = this._getMediaFrameBox(element);
          const captionHeight = this._getPmiTitleHeightIn(element);
          const sourceFrameWidth = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameBox.w, toFiniteNumber(element.w, 1)));
          const sourceFrameHeight = Math.max(MIN_ELEMENT_IN, toFiniteNumber(frameBox.h, toFiniteNumber(element.h, 1) - captionHeight));
          const ratio = Math.max(1e-6, sourceFrameWidth / sourceFrameHeight);
          if (key === "w") {
            const nextWidth = Math.max(MIN_ELEMENT_IN, inches);
            const nextFrameHeight = Math.max(MIN_ELEMENT_IN, nextWidth / ratio);
            element.w = nextWidth;
            element.h = nextFrameHeight + captionHeight;
          } else {
            const nextOuterHeight = Math.max(MIN_ELEMENT_IN, inches);
            const nextFrameHeight = Math.max(MIN_ELEMENT_IN, nextOuterHeight - captionHeight);
            element.w = Math.max(MIN_ELEMENT_IN, nextFrameHeight * ratio);
            element.h = nextFrameHeight + captionHeight;
          }
        } else {
          element[key] = Math.max(MIN_ELEMENT_IN, inches);
        }
      } else {
        element[key] = inches;
      }
    } else if (key === "rotationDeg") {
      element.rotationDeg = toFiniteNumber(rawValue, toFiniteNumber(element.rotationDeg, 0));
    }

    if (element.type === "rect") {
      element.cornerRadius = clamp(
        toFiniteNumber(element.cornerRadius, 0),
        0,
        Math.min(toFiniteNumber(element.w, 1), toFiniteNumber(element.h, 1)) * 0.5,
      );
    } else if (shapeSupportsAdjustHandle(element.type)) {
      element.shapeAdjust = clampShapeAdjust(element.type, element.shapeAdjust);
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
    } else if (key === "stroke") {
      element.stroke = String(rawValue || this._defaultStrokeForElement(element));
      if (element.type === "text") {
        element.strokeEnabled = true;
        if (toFiniteNumber(element.strokeWidth, 0) <= 0) {
          element.strokeWidth = 1 / POINTS_PER_INCH;
        }
      }
    } else if (key === "strokeWidth") {
      const points = Math.max(0, toFiniteNumber(rawValue, inchesToPoints(toFiniteNumber(element.strokeWidth, this._defaultStrokeWidthForElement(element)))));
      element.strokeWidth = pointsToInches(points);
      if (element.type === "text") {
        element.strokeEnabled = points > 0;
      }
    } else if (key === "cornerRadius") {
      if (element.type !== "rect") return;
      const radiusPx = Math.max(0, toFiniteNumber(rawValue, toFiniteNumber(element.cornerRadius, 0) * this._pxPerIn()));
      const maxRadiusPx = Math.max(
        0,
        Math.min(toFiniteNumber(element.w, 1), toFiniteNumber(element.h, 1)) * this._pxPerIn() * 0.5,
      );
      element.cornerRadius = clamp(radiusPx, 0, maxRadiusPx) / this._pxPerIn();
    } else if (key === "lineStyle") {
      element.lineStyle = this._getLineStyleValue({ ...element, lineStyle: rawValue });
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

  _resetSelectedStroke() {
    const element = this._getSelectedElement();
    if (!element) return;
    element.stroke = this._defaultStrokeForElement(element);
    element.strokeWidth = this._defaultStrokeWidthForElement(element);
    if (element.type === "text") element.strokeEnabled = false;
    this._commitSheetDraft("style-stroke-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _normalizeSelectedTextFieldValue(key, rawValue, fallbackState = this._getSelectedTextState()) {
    if (key === "fontSize") {
      const fallbackPt = Math.max(6, Math.round(inchesToPoints(toFiniteNumber(fallbackState?.fontSize, 0.32))));
      const points = toFiniteNumber(rawValue, fallbackPt);
      return Math.max(0.08, pointsToInches(Math.max(6, points)));
    }
    if (key === "fontFamily") return String(rawValue || "Arial, Helvetica, sans-serif");
    if (key === "color") return String(rawValue || "#111111");
    if (key === "fontWeight") return String(rawValue || "400") === "700" ? "700" : "400";
    if (key === "fontStyle") return String(rawValue || "normal") === "italic" ? "italic" : "normal";
    if (key === "textDecoration") return String(rawValue || "none") === "underline" ? "underline" : "none";
    if (key === "textAlign") return this._getTableTextAlignValue({ textAlign: rawValue });
    if (key === "verticalAlign") return this._getTableVerticalAlignValue({ verticalAlign: rawValue });
    if (key === "text") return String(rawValue || "");
    return rawValue;
  }

  _setSelectedTableTextField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!isTableElementType(element)) return false;

    const scope = this._getTableTextScope();
    if (scope === "table") {
      if (key === "text") return false;
      element[key] = this._normalizeSelectedTextFieldValue(key, rawValue);
      this._commitSheetDraft(`table-text-${key}`);
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
      return true;
    }

    const nextTableData = cloneTableData(element.tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    const targets = this._getSelectedTableAnchorTargets(element, nextTableData);
    const nextSelection = this._getTableSelectionState(element);
    if (!targets.length) return false;

    if (key === "text") {
      if (targets.length !== 1) return false;
      targets[0].cell.text = String(rawValue || "");
      return this._commitTableChange(element, nextTableData, "table-cell-text", nextSelection);
    }

    const normalizedValue = this._normalizeSelectedTextFieldValue(key, rawValue);
    for (const target of targets) {
      target.cell.style = normalizeTableCellStyle({
        ...(target.cell.style || {}),
        [key]: normalizedValue,
      });
    }
    return this._commitTableChange(element, nextTableData, `table-text-${key}`, nextSelection);
  }

  _resetSelectedTableTextColor() {
    const element = this._getSelectedElement();
    if (!isTableElementType(element)) return false;

    if (this._getTableTextScope() === "table") {
      element.color = this._defaultTextColorForElement(element);
      this._commitSheetDraft("table-text-color-reset");
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
      return true;
    }

    const nextTableData = cloneTableData(element.tableData, TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS);
    const targets = this._getSelectedTableAnchorTargets(element, nextTableData);
    const nextSelection = this._getTableSelectionState(element);
    if (!targets.length) return false;
    for (const target of targets) {
      const nextStyle = { ...(target.cell.style || {}) };
      delete nextStyle.color;
      target.cell.style = normalizeTableCellStyle(nextStyle);
    }
    return this._commitTableChange(element, nextTableData, "table-text-color-reset", nextSelection);
  }

  _setSelectedTextField(key, rawValue) {
    const element = this._getSelectedElement();
    if (!element) return;

    if (this._isFormboardElement(element)) {
      if (key !== "fontSize") return;
      const textElements = this._getSelectedFormboardTextElements(element);
      if (!textElements.length) return;
      const normalizedFontSize = this._normalizeSelectedTextFieldValue(key, rawValue);
      for (const textElement of textElements) {
        textElement.fontSize = normalizedFontSize;
      }
      this._commitSheetDraft(`formboard-text-${key}`);
      this._renderStageOnly();
      this._renderInspector();
      this._renderSidebarOnly();
      return;
    }

    if (!elementSupportsText(element)) return;

    if (isTableElementType(element)) {
      this._setSelectedTableTextField(key, rawValue);
      return;
    }

    if (key === "fontSize") {
      element.fontSize = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "text") {
      element.text = String(rawValue || "");
    } else if (key === "fontFamily") {
      element.fontFamily = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "color") {
      element.color = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "fontWeight") {
      element.fontWeight = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "fontStyle") {
      element.fontStyle = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "textDecoration") {
      element.textDecoration = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "textAlign") {
      element.textAlign = this._normalizeSelectedTextFieldValue(key, rawValue);
    } else if (key === "verticalAlign") {
      element.verticalAlign = this._normalizeSelectedTextFieldValue(key, rawValue);
    }

    this._commitSheetDraft(`text-${key}`);
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _adjustSelectedFontSize(deltaPt = 0) {
    const textState = this._getSelectedTextState();
    if (!textState) return;
    const currentPt = Math.max(6, Math.round(inchesToPoints(toFiniteNumber(textState.fontSize, 0.32))));
    const nextPt = Math.max(6, currentPt + Math.round(toFiniteNumber(deltaPt, 0)));
    this._setSelectedTextField("fontSize", nextPt);
  }

  _resetSelectedTextColor() {
    const element = this._getSelectedElement();
    if (!element || !elementSupportsText(element)) return;
    if (isTableElementType(element)) {
      this._resetSelectedTableTextColor();
      return;
    }
    element.color = this._defaultTextColorForElement(element);
    this._commitSheetDraft("text-color-reset");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _toggleTextWeight() {
    const textState = this._getSelectedTextState();
    if (!textState) return;
    this._setSelectedTextField("fontWeight", String(textState.fontWeight || "400") === "700" ? "400" : "700");
  }

  _toggleTextItalic() {
    const textState = this._getSelectedTextState();
    if (!textState) return;
    this._setSelectedTextField("fontStyle", String(textState.fontStyle || "normal") === "italic" ? "normal" : "italic");
  }

  _toggleTextUnderline() {
    const textState = this._getSelectedTextState();
    if (!textState) return;
    this._setSelectedTextField("textDecoration", String(textState.textDecoration || "none") === "underline" ? "none" : "underline");
  }

  _addSheet() {
    const manager = this._getManager();
    if (!manager?.createSheet) return;

    const count = (manager.getSheets?.() || []).length;
    const created = manager.createSheet(createOneSheetTemplate(`Instruction Sheet ${count + 1}`));
    if (!created?.id) return;

    this._openSheetMenuId = null;
    this.sheetId = String(created.id);
    this._clearSelection();
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
    this._clearSelection();
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
      this._clearSelection();
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
    this._clearSelection();
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
    else if (kind === "roundedRect") {
      element = defaultRectElement(cxIn, cyIn);
      element.cornerRadius = Math.min(element.w, element.h) * 0.22;
    }
    else if (kind === "table") {
      element = defaultTableElement(cxIn, cyIn);
      const suggested = this._getSuggestedTableSizeIn(element.tableData);
      element.w = suggested.width;
      element.h = suggested.height;
      element.x = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (suggested.width * 0.5));
      element.y = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (suggested.height * 0.5));
    }
    else if (kind === "ellipse") element = defaultEllipseElement(cxIn, cyIn);
    else if (kind === "triangle") element = defaultTriangleElement(cxIn, cyIn);
    else if (kind === "diamond") element = defaultDiamondElement(cxIn, cyIn);
    else if (kind === "pentagon") element = defaultPentagonElement(cxIn, cyIn);
    else if (kind === "hexagon") element = defaultHexagonElement(cxIn, cyIn);
    else if (kind === "parallelogram") element = defaultParallelogramElement(cxIn, cyIn);
    else if (kind === "trapezoid") element = defaultTrapezoidElement(cxIn, cyIn);
    else return;

    element.z = this._nextZ();
    this.sheetDraft.elements.push(element);
    this._setSelectedElementIds([String(element.id || "")], String(element.id || ""));
    this._tableSelection = kind === "table"
      ? { elementId: String(element.id || ""), anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 }
      : null;

    this._commitSheetDraft("add-element");
    this._renderAll();
    const shapeLabel = kind === "table"
      ? "Table"
      : (SHAPE_INSERT_OPTIONS.find((entry) => entry.kind === kind)?.label || kind);
    this._setStatus(`${shapeLabel} added`);
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
    void this._readBlobAsDataUrl(file).then((src) => this._insertImageElementFromSource(src));
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

    const previewKey = this._getPmiPreviewCaptureKey(view, idx);
    const previewSrc = String(this._pmiImageCache.get(previewKey) || "").trim();
    const previewMetadata = previewSrc ? (this._mediaMetadataCache.get(previewSrc) || null) : null;
    const suggested = this._getSuggestedPmiInsetSize(previewMetadata, true);
    const xIn = Math.max(0, (toFiniteNumber(this.sheetDraft.widthIn, 11) * 0.5) - (suggested.frameWidth * 0.5));
    const yIn = Math.max(0, (toFiniteNumber(this.sheetDraft.heightIn, 8.5) * 0.5) - (suggested.outerHeight * 0.5));

    const inset = defaultPmiInsetElement(xIn, yIn, idx, viewName);
    inset.w = suggested.frameWidth;
    inset.h = suggested.outerHeight;
    inset.z = this._nextZ();
    this.sheetDraft.elements.push(inset);
    this._setSelectedElementIds([String(inset.id || "")], String(inset.id || ""));

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

  _setPmiLabelPosition(element, value) {
    if (!element || element.type !== "pmiInset") return;
    const nextPosition = ["top", "bottom", "none"].includes(String(value || "").toLowerCase())
      ? String(value).toLowerCase()
      : "bottom";
    const frame = this._getMediaFrameBox(element);
    const nextCaptionHeight = nextPosition === "none" ? 0 : PMI_TITLE_HEIGHT_IN;
    element.pmiLabelPosition = nextPosition;
    element.showTitle = nextPosition !== "none";
    element.h = frame.h + nextCaptionHeight;
    element.y = frame.y - (nextPosition === "top" ? nextCaptionHeight : 0);
  }

  _setSelectedPMIField(key, value) {
    const element = this._getSelectedElement();
    if (!element || element.type !== "pmiInset") return;
    if (key === "labelPosition") {
      this._setPmiLabelPosition(element, value);
    } else if (key === "showTitle") {
      this._setPmiLabelPosition(element, value !== false ? "bottom" : "none");
    } else if (key === "showBackground") {
      element.fill = value ? normalizeHex(element.fill, "#ffffff") : "transparent";
    } else if (key === "backgroundColor") {
      element.fill = String(value || "#ffffff");
    } else if (key === "anchor") {
      element.pmiAnchor = this._getPmiAnchorValue({ pmiAnchor: value });
    } else if (key === "renderMode") {
      element.pmiRenderMode = this._getPmiRenderMode({ pmiRenderMode: value });
    } else if (key === "showCenterLines") {
      element.pmiShowCenterLines = value === true;
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
    const selectedIds = this._getSelectedElementIds();
    if (!selectedIds.length || !this.sheetDraft || !Array.isArray(this.sheetDraft.elements)) return;

    const selectedSet = new Set(selectedIds);
    const ordered = sortElements(this.sheetDraft.elements || []);
    const selected = ordered.filter((entry) => selectedSet.has(String(entry?.id || "")));
    if (!selected.length) return;
    if (edge === "back" && selected.every((entry, index) => ordered[index] === entry)) return;
    if (edge !== "back" && selected.every((entry, index) => ordered[ordered.length - selected.length + index] === entry)) return;

    const others = ordered.filter((entry) => !selectedSet.has(String(entry?.id || "")));
    const nextOrder = edge === "back"
      ? [...selected, ...others]
      : [...others, ...selected];

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
    if (this._hasMultipleSelection()) return;
    const element = this._getSelectedElement();
    if (!element) return;
    element.z = Math.round(toFiniteNumber(element.z, 0) + toFiniteNumber(delta, 0));
    this._commitSheetDraft("adjust-z");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
  }

  _canGroupSelectedElements() {
    const elements = this._getSelectedElements();
    if (elements.length < 2) return false;
    const groupIds = new Set(elements.map((element) => this._getElementGroupId(element)).filter(Boolean));
    return !(groupIds.size === 1 && elements.every((element) => this._getElementGroupId(element)));
  }

  _canUngroupSelectedElements() {
    return this._getSelectedElements().some((element) => this._getElementGroupId(element));
  }

  _groupSelectedElements() {
    if (!this.sheetDraft || !this._canGroupSelectedElements()) return;
    const groupId = uid("grp");
    for (const element of this._getSelectedElements()) {
      element.groupId = groupId;
    }
    this._commitSheetDraft("group-elements");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
    this._setStatus("Objects grouped");
  }

  _ungroupSelectedElements() {
    if (!this.sheetDraft || !this._canUngroupSelectedElements()) return;
    const targetGroups = new Set(this._getSelectedElements().map((element) => this._getElementGroupId(element)).filter(Boolean));
    if (!targetGroups.size) return;
    for (const element of this.sheetDraft.elements || []) {
      if (targetGroups.has(this._getElementGroupId(element))) {
        delete element.groupId;
      }
    }
    this._commitSheetDraft("ungroup-elements");
    this._renderStageOnly();
    this._renderInspector();
    this._renderSidebarOnly();
    this._setStatus("Objects ungrouped");
  }

  _duplicateSelectedElement() {
    const elements = this._getSelectedElements({ sorted: true });
    if (!elements.length || !this.sheetDraft) return;
    const offset = 24 / this._pxPerIn();
    const nextSelectionIds = [];
    const nextGroupIds = new Map();
    const sourceGroupCounts = new Map();
    for (const element of elements) {
      const sourceGroupId = this._getElementGroupId(element);
      if (!sourceGroupId) continue;
      sourceGroupCounts.set(sourceGroupId, (sourceGroupCounts.get(sourceGroupId) || 0) + 1);
    }
    let nextZ = this._nextZ();
    for (const element of elements) {
      const clone = deepClone(element);
      clone.id = uid("el");
      const sourceGroupId = this._getElementGroupId(element);
      if (sourceGroupId && (sourceGroupCounts.get(sourceGroupId) || 0) > 1) {
        if (!nextGroupIds.has(sourceGroupId)) nextGroupIds.set(sourceGroupId, uid("grp"));
        clone.groupId = nextGroupIds.get(sourceGroupId);
      } else {
        delete clone.groupId;
      }
      clone.z = nextZ;
      nextZ += 1;
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
      nextSelectionIds.push(clone.id);
    }

    this._setSelectedElementIds(nextSelectionIds, nextSelectionIds[nextSelectionIds.length - 1] || null);
    this._commitSheetDraft("duplicate-element");
    this._renderAll();
    this._setStatus(elements.length > 1 ? "Objects duplicated" : "Element duplicated");
  }

  _deleteSelectedElement() {
    const selectedIds = this._getSelectedElementIds();
    if (!this.sheetDraft || !selectedIds.length) return;
    const selectedSet = new Set(selectedIds);
    const before = this.sheetDraft.elements?.length || 0;
    this.sheetDraft.elements = (this.sheetDraft.elements || []).filter(
      (item) => !selectedSet.has(String(item?.id || "")),
    );
    if ((this.sheetDraft.elements?.length || 0) === before) return;

    this._hideContextMenu();
    if (selectedIds.some((id) => this._isCropModeForElement(id))) {
      this._cropModeElementId = null;
    }
    this._clearSelection();
    this._commitSheetDraft("delete-element");
    this._renderAll();
    this._setStatus(selectedIds.length > 1 ? "Objects deleted" : "Element deleted");
  }

  _getElementById(elementId) {
    const id = String(elementId || "").trim();
    if (!id || !this.sheetDraft || !Array.isArray(this.sheetDraft.elements)) return null;
    return this.sheetDraft.elements.find((item) => String(item?.id || "") === id) || null;
  }

  _isFormboardElement(element) {
    return isWireHarnessFormboardElement(element);
  }

  _selectionContainsLockedFormboardGeometry(elements = []) {
    return (Array.isArray(elements) ? elements : []).some((element) => this._isFormboardElement(element));
  }

  _buildFormboardPivotDragSnapshot(groupId, pivotNodeId, segmentId) {
    const resolvedGroupId = String(groupId || "").trim();
    const resolvedPivotNodeId = String(pivotNodeId || "").trim();
    const resolvedSegmentId = String(segmentId || "").trim();
    if (!resolvedGroupId || !resolvedPivotNodeId || !resolvedSegmentId) return null;
    const groupElements = (this.sheetDraft?.elements || []).filter((entry) => this._getElementGroupId(entry) === resolvedGroupId);
    const model = buildWireHarnessFormboardModel(groupElements);
    if (!model || !model.nodes?.has?.(resolvedPivotNodeId)) return null;

    const branchNodeIds = collectWireHarnessFormboardSegmentBranchNodeIds(model, resolvedPivotNodeId, resolvedSegmentId);
    if (!branchNodeIds.size) return null;

    const segmentIds = new Set();
    for (const segment of model.segments || []) {
      if (!segment) continue;
      if (String(segment.id || "") === resolvedSegmentId) {
        segmentIds.add(String(segment.id || ""));
        continue;
      }
      if (branchNodeIds.has(segment.fromNodeId) && branchNodeIds.has(segment.toNodeId)) {
        segmentIds.add(String(segment.id || ""));
      }
    }

    const elementSnapshots = new Map();
    for (const groupElement of groupElements) {
      const id = String(groupElement?.id || "").trim();
      if (!id) continue;
      const meta = groupElement?.formboard || {};
      const kind = String(meta?.kind || "").trim();
      const include = segmentIds.has(id)
        || (kind === "segmentLabel" && (segmentIds.has(String(meta?.lineElementId || "")) || branchNodeIds.has(String(meta?.toNodeId || "")) || branchNodeIds.has(String(meta?.fromNodeId || ""))))
        || (kind === "nodeLabel" && branchNodeIds.has(String(meta?.nodeId || "")));
      if (!include) continue;
      elementSnapshots.set(id, deepClone(groupElement));
    }

    return {
      groupId: resolvedGroupId,
      pivotNodeId: resolvedPivotNodeId,
      segmentId: resolvedSegmentId,
      elementSnapshots,
      model,
    };
  }

  _applyFormboardPivotRotation(snapshot, deltaDeg) {
    if (!snapshot?.model?.nodes || !snapshot?.elementSnapshots?.size) return;
    const pivotNodeId = String(snapshot.pivotNodeId || "").trim();
    const pivotNode = snapshot.model.nodes.get(pivotNodeId);
    if (!pivotNode) return;

    const radians = toFiniteNumber(deltaDeg, 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotatePoint = (x, y) => {
      const ox = toFiniteNumber(x, 0) - pivotNode.x;
      const oy = toFiniteNumber(y, 0) - pivotNode.y;
      return {
        x: pivotNode.x + (ox * cos) - (oy * sin),
        y: pivotNode.y + (ox * sin) + (oy * cos),
      };
    };

    for (const [elementId, source] of snapshot.elementSnapshots.entries()) {
      const element = this._getElementById(elementId);
      if (!element || !source) continue;
      if (element.type === "line") {
        const p1 = rotatePoint(source.x, source.y);
        const p2 = rotatePoint(source.x2, source.y2);
        element.x = p1.x;
        element.y = p1.y;
        element.x2 = p2.x;
        element.y2 = p2.y;
        continue;
      }

      const center = rotatePoint(
        toFiniteNumber(source.x, 0) + (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1)) * 0.5),
        toFiniteNumber(source.y, 0) + (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1)) * 0.5),
      );
      element.x = center.x - (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.w, 1)) * 0.5);
      element.y = center.y - (Math.max(MIN_ELEMENT_IN, toFiniteNumber(source.h, 1)) * 0.5);
    }
  }

  _getElementGroupId(element) {
    const groupId = String(element?.groupId || "").trim();
    return groupId || "";
  }

  _getActiveEditingGroupId() {
    const groupId = String(this._editingGroupId || "").trim();
    if (!groupId) return "";
    const exists = (this.sheetDraft?.elements || []).some((element) => this._getElementGroupId(element) === groupId);
    if (!exists) {
      this._editingGroupId = "";
      return "";
    }
    return groupId;
  }

  _getGroupedSelectionIds(element) {
    const target = element && typeof element === "object" ? element : null;
    const id = String(target?.id || "").trim();
    if (!id) return [];
    if (this._isFormboardElement(target)) return [id];
    const groupId = this._getElementGroupId(target);
    if (!groupId) return [id];
    if (this._getActiveEditingGroupId() === groupId) return [id];
    return (this.sheetDraft?.elements || [])
      .map((entry) => (entry && this._getElementGroupId(entry) === groupId ? String(entry.id || "").trim() : ""))
      .filter(Boolean);
  }

  _getSelectedElementIds() {
    const source = Array.isArray(this._selectedElementIds) ? this._selectedElementIds : [];
    const result = [];
    const seen = new Set();
    for (const rawId of source) {
      const id = String(rawId || "").trim();
      if (!id || seen.has(id) || !this._getElementById(id)) continue;
      seen.add(id);
      result.push(id);
    }
    const primaryId = String(this.selectedElementId || "").trim();
    if (primaryId && !seen.has(primaryId) && this._getElementById(primaryId)) {
      result.push(primaryId);
    }
    return result;
  }

  _isElementSelected(elementId) {
    const id = String(elementId || "").trim();
    return !!id && this._getSelectedElementIds().includes(id);
  }

  _getSelectedElements({ sorted = false } = {}) {
    const ids = new Set(this._getSelectedElementIds());
    const elements = (this.sheetDraft?.elements || []).filter((item) => ids.has(String(item?.id || "")));
    return sorted ? sortElements(elements) : elements;
  }

  _hasMultipleSelection() {
    return this._getSelectedElementIds().length > 1;
  }

  _setSelectedElementIds(elementIds, primaryId = null) {
    const seen = new Set();
    const validIds = [];
    for (const rawId of Array.isArray(elementIds) ? elementIds : []) {
      const id = String(rawId || "").trim();
      if (!id || seen.has(id) || !this._getElementById(id)) continue;
      seen.add(id);
      validIds.push(id);
    }

    let resolvedPrimary = String(primaryId || "").trim();
    if (!resolvedPrimary || !seen.has(resolvedPrimary)) {
      resolvedPrimary = validIds[validIds.length - 1] || "";
    }

    this._selectedElementIds = validIds;
    this.selectedElementId = resolvedPrimary || null;

    const selected = validIds.length === 1 ? this._getElementById(validIds[0]) : null;
    const selectedFormboardGroupId = this._isFormboardElement(selected) ? this._getElementGroupId(selected) : "";
    if (!selectedFormboardGroupId || selectedFormboardGroupId !== String(this._selectedFormboardPivot?.groupId || "")) {
      this._selectedFormboardPivot = selectedFormboardGroupId ? { groupId: selectedFormboardGroupId, nodeId: "" } : null;
    }

    if (validIds.length !== 1) {
      this._cropModeElementId = null;
      this._tableSelection = null;
      return;
    }

    if (!selected || !isTableElementType(selected)) {
      this._tableSelection = null;
    } else {
      this._syncTableInteractionState();
    }
    if (this._cropModeElementId && !this._isCropModeForElement(selected)) {
      this._cropModeElementId = null;
    }
  }

  _clearSelection() {
    this._editingGroupId = "";
    this._setSelectedElementIds([], null);
  }

  _getSelectedElement() {
    const primaryId = String(this.selectedElementId || "").trim();
    if (primaryId) {
      const primary = this._getElementById(primaryId);
      if (primary) return primary;
    }
    const fallbackId = this._getSelectedElementIds()[0] || "";
    return this._getElementById(fallbackId);
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

  _slidePointToElementLocalPx(point, element) {
    const ppi = this._pxPerIn();
    const xPx = toFiniteNumber(element?.x, 0) * ppi;
    const yPx = toFiniteNumber(element?.y, 0) * ppi;
    const widthPx = Math.max(1, toFiniteNumber(element?.w, 1) * ppi);
    const heightPx = Math.max(1, toFiniteNumber(element?.h, 1) * ppi);
    const cx = xPx + (widthPx * 0.5);
    const cy = yPx + (heightPx * 0.5);
    const dx = toFiniteNumber(point?.x, cx) - cx;
    const dy = toFiniteNumber(point?.y, cy) - cy;
    const radians = (-toFiniteNumber(element?.rotationDeg, 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    return {
      x: (dx * cos) - (dy * sin) + (widthPx * 0.5),
      y: (dx * sin) + (dy * cos) + (heightPx * 0.5),
      widthPx,
      heightPx,
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
      .sheet-slides-overlay {
        position: fixed;
        inset: 0;
        z-index: 1400;
        background: #0f1115;
      }
      .sheet-slides-root {
        width: 100%;
        height: 100%;
        min-height: 0;
        position: relative;
        display: grid;
        grid-template-columns: 260px 1fr 320px;
        grid-template-rows: auto 1fr 30px;
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
        flex-wrap: wrap;
        align-content: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid #30384d;
        background: linear-gradient(180deg, #151926, #111520);
      }
      .sheet-slides-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        margin-right: 6px;
      }
      .sheet-slides-brand-logo {
        display: block;
        width: 116px;
        max-width: 22vw;
        height: auto;
        flex: 0 0 auto;
      }
      .sheet-slides-brand-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .sheet-slides-brand-title {
        font-weight: 700;
        white-space: nowrap;
        letter-spacing: .02em;
      }
      .sheet-slides-subtitle {
        color: #98a2b3;
        font-size: 12px;
        white-space: nowrap;
      }
      .sheet-slides-topbar-spacer {
        flex: 1 1 auto;
        min-width: 12px;
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
      .sheet-slides-selection-group {
        display: none;
      }
      .sheet-slides-toolbar-label {
        color: #98a2b3;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .04em;
        white-space: nowrap;
      }
      .sheet-slides-toolbar-color {
        width: 38px;
        min-width: 38px;
        padding: 2px;
      }
      .sheet-slides-toolbar-number {
        width: 68px;
        min-width: 68px;
      }
      .sheet-slides-toolbar-font-family {
        min-width: 120px;
        max-width: 148px;
      }
      .sheet-slides-toolbar-segmented {
        display: grid;
        grid-template-columns: repeat(3, minmax(30px, auto));
        gap: 4px;
      }
      .sheet-slides-icon-btn {
        width: 32px;
        min-width: 32px;
        padding: 0;
        display: inline-grid;
        place-items: center;
      }
      .sheet-slides-icon-btn svg {
        width: 18px;
        height: 18px;
        display: block;
      }
      .sheet-slides-toolbar-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 0 12px;
      }
      .sheet-slides-toolbar-action-btn.icon-only {
        justify-content: center;
        min-width: 40px;
        padding: 0 10px;
      }
      .sheet-slides-toolbar-action-icon,
      .sheet-slides-toolbar-action-chevron {
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
      }
      .sheet-slides-toolbar-action-icon svg,
      .sheet-slides-toolbar-action-chevron svg {
        width: 18px;
        height: 18px;
        display: block;
      }
      .sheet-slides-toolbar-action-label {
        white-space: nowrap;
      }
      .sheet-slides-toolbar-action-chevron {
        opacity: .72;
      }
      .sheet-slides-toolbar-italic {
        font-style: italic;
      }
      .sheet-slides-toolbar-popover {
        position: absolute;
        min-width: 196px;
        max-width: min(320px, calc(100vw - 24px));
        padding: 10px;
        border: 1px solid #30384d;
        border-radius: 12px;
        background: rgba(15,17,21,.98);
        box-shadow: 0 18px 40px rgba(0,0,0,.38);
        z-index: 85;
      }
      .sheet-slides-toolbar-popover-title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: #98a2b3;
        margin-bottom: 10px;
      }
      .sheet-slides-toolbar-popover-body {
        display: grid;
        gap: 10px;
      }
      .sheet-slides-toolbar-shape-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .sheet-slides-toolbar-shape-option {
        min-height: 74px;
        border: 1px solid #30384d;
        border-radius: 12px;
        background: #171c28;
        color: #e8ecf3;
        cursor: pointer;
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 8px;
        padding: 10px 8px;
        font: inherit;
      }
      .sheet-slides-toolbar-shape-option:hover {
        border-color: #60a5fa;
      }
      .sheet-slides-toolbar-shape-option-icon {
        display: inline-grid;
        place-items: center;
      }
      .sheet-slides-toolbar-shape-option-icon svg {
        width: 24px;
        height: 24px;
        display: block;
      }
      .sheet-slides-toolbar-shape-option-label {
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        text-align: center;
      }
      .sheet-slides-toolbar-popover-section {
        display: grid;
        gap: 6px;
      }
      .sheet-slides-toolbar-popover-section-title {
        font-size: 11px;
        font-weight: 700;
        color: #cbd5e1;
      }
      .sheet-slides-toolbar-popover-color {
        width: 100%;
        min-height: 40px;
        padding: 2px;
        border-radius: 10px;
      }
      .sheet-slides-toolbar-swatch-grid,
      .sheet-slides-toolbar-icon-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .sheet-slides-toolbar-swatch {
        width: 100%;
        aspect-ratio: 1;
        border: 1px solid rgba(148,163,184,.4);
        border-radius: 10px;
        cursor: pointer;
      }
      .sheet-slides-toolbar-option-list {
        display: grid;
        gap: 6px;
      }
      .sheet-slides-toolbar-option {
        height: 36px;
        border: 1px solid #30384d;
        border-radius: 10px;
        background: #171c28;
        color: #e8ecf3;
        cursor: pointer;
        display: inline-grid;
        place-items: center;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
      }
      .sheet-slides-toolbar-option:hover,
      .sheet-slides-toolbar-swatch:hover {
        border-color: #60a5fa;
      }
      .sheet-slides-toolbar-option.active {
        border-color: #2d73ff;
        background: rgba(45,115,255,.16);
        box-shadow: 0 0 0 1px rgba(45,115,255,.14);
      }
      .sheet-slides-toolbar-style-option svg {
        width: 100%;
        height: 18px;
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
      .sheet-slides-btn:disabled,
      .sheet-slides-control:disabled {
        opacity: .58;
        cursor: not-allowed;
      }
      .sheet-slides-btn:disabled:hover,
      .sheet-slides-control:disabled:hover {
        border-color: #30384d;
      }
      .sheet-slides-btn.active {
        border-color: #2d73ff;
        background: rgba(45,115,255,.18);
        color: #fff;
      }
      .sheet-slides-btn.primary {
        border-color: #2d73ff;
        background: linear-gradient(180deg, #2d73ff, #2158c5);
        color: #fff;
      }
      .sheet-slides-finish-btn {
        min-width: 96px;
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
        overflow: hidden;
        background: radial-gradient(circle at top, rgba(255,255,255,.04), transparent 30%), linear-gradient(180deg, #111520, #0c1018);
        padding: ${STAGE_VIEWPORT_PADDING_PX}px;
        position: relative;
        min-width: 0;
        min-height: 0;
        user-select: none;
        z-index: 0;
      }
      .sheet-slides-stage-center {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .sheet-slides-stage-shell {
        position: absolute;
        left: 0;
        top: 0;
        overflow: visible;
        transform-origin: 0 0;
        user-select: none;
      }
      .sheet-slides-canvas {
        position: relative;
        border-radius: 10px;
        overflow: visible;
        box-shadow: 0 20px 60px rgba(0,0,0,.45);
        transform-origin: top left;
      }
      .sheet-slides-stage-wrap.is-panning,
      .sheet-slides-stage-wrap.is-panning * {
        cursor: grabbing !important;
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
        background-size: var(--sheet-slides-grid-step, 40px) var(--sheet-slides-grid-step, 40px);
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
      .sheet-slides-selection-overlay {
        position: absolute;
        transform-origin: center center;
        min-width: 10px;
        min-height: 10px;
        pointer-events: none;
        --sheet-slides-ui-scale: 1;
      }
      .sheet-slides-selection-frame {
        position: absolute;
        inset: calc(-1px * var(--sheet-slides-ui-scale));
        border: calc(2px * var(--sheet-slides-ui-scale)) solid #6ea8fe;
        pointer-events: none;
      }
      .sheet-slides-table-move-handle {
        position: absolute;
        left: calc(12px * var(--sheet-slides-ui-scale));
        right: calc(12px * var(--sheet-slides-ui-scale));
        top: calc(-10px * var(--sheet-slides-ui-scale));
        height: calc(10px * var(--sheet-slides-ui-scale));
        cursor: move;
        pointer-events: auto;
        z-index: 5;
      }
      .sheet-slides-element-content {
        width: 100%;
        height: 100%;
        position: relative;
      }
      .sheet-slides-shape-surface {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: none;
        overflow: visible;
        z-index: 0;
      }
      .sheet-slides-stroke-overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: none;
        overflow: visible;
        z-index: 2;
      }
      .sheet-slides-table-wrap {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .sheet-slides-table-surface {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: none;
        z-index: 0;
      }
      .sheet-slides-table-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
      }
      .sheet-slides-table-cell {
        position: absolute;
        box-sizing: border-box;
        overflow: hidden;
        isolation: isolate;
      }
      .sheet-slides-table-cell.is-selected {
        background: rgba(110,168,254,.16);
      }
      .sheet-slides-table-cell-body {
        width: 100%;
        height: 100%;
      }
      .sheet-slides-table-cell-body.editing {
        outline: 2px solid rgba(110,168,254,.85);
        outline-offset: -2px;
        background: rgba(255,255,255,.18);
      }
      .sheet-slides-inline-text {
        width: 100%;
        height: 100%;
        position: relative;
        z-index: 1;
      }
      .sheet-slides-inline-text-body {
        width: 100%;
      }
      .sheet-slides-inline-text.editing {
        outline: 2px solid rgba(110,168,254,.75);
        outline-offset: -2px;
        background: rgba(255,255,255,.18);
      }
      .sheet-slides-shape-text {
        position: absolute;
        inset: 0;
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
        border: calc(1px * var(--sheet-slides-ui-scale)) solid #111827;
        box-sizing: border-box;
        background: transparent;
        box-shadow: 0 0 0 99999px rgba(255,255,255,.2);
        z-index: 5;
        pointer-events: auto;
      }
      .sheet-slides-crop-handle {
        position: absolute;
        background: #111827;
        border: calc(1px * var(--sheet-slides-ui-scale)) solid #fff;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(2px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.3);
        z-index: 6;
        pointer-events: auto;
      }
      .sheet-slides-crop-handle.n,
      .sheet-slides-crop-handle.s {
        width: calc(16px * var(--sheet-slides-ui-scale));
        height: calc(8px * var(--sheet-slides-ui-scale));
        left: 50%;
        margin-left: calc(-8px * var(--sheet-slides-ui-scale));
        cursor: ns-resize;
      }
      .sheet-slides-crop-handle.n { top: calc(-5px * var(--sheet-slides-ui-scale)); }
      .sheet-slides-crop-handle.s { bottom: calc(-5px * var(--sheet-slides-ui-scale)); }
      .sheet-slides-crop-handle.e,
      .sheet-slides-crop-handle.w {
        width: calc(8px * var(--sheet-slides-ui-scale));
        height: calc(16px * var(--sheet-slides-ui-scale));
        top: 50%;
        margin-top: calc(-8px * var(--sheet-slides-ui-scale));
        cursor: ew-resize;
      }
      .sheet-slides-crop-handle.w { left: calc(-5px * var(--sheet-slides-ui-scale)); }
      .sheet-slides-crop-handle.e { right: calc(-5px * var(--sheet-slides-ui-scale)); }
      .sheet-slides-crop-handle.nw,
      .sheet-slides-crop-handle.ne,
      .sheet-slides-crop-handle.sw,
      .sheet-slides-crop-handle.se {
        width: calc(10px * var(--sheet-slides-ui-scale));
        height: calc(10px * var(--sheet-slides-ui-scale));
      }
      .sheet-slides-crop-handle.nw { left: calc(-5px * var(--sheet-slides-ui-scale)); top: calc(-5px * var(--sheet-slides-ui-scale)); cursor: nwse-resize; }
      .sheet-slides-crop-handle.ne { right: calc(-5px * var(--sheet-slides-ui-scale)); top: calc(-5px * var(--sheet-slides-ui-scale)); cursor: nesw-resize; }
      .sheet-slides-crop-handle.sw { left: calc(-5px * var(--sheet-slides-ui-scale)); bottom: calc(-5px * var(--sheet-slides-ui-scale)); cursor: nesw-resize; }
      .sheet-slides-crop-handle.se { right: calc(-5px * var(--sheet-slides-ui-scale)); bottom: calc(-5px * var(--sheet-slides-ui-scale)); cursor: nwse-resize; }
      .sheet-slides-handle {
        position: absolute;
        width: calc(12px * var(--sheet-slides-ui-scale));
        height: calc(12px * var(--sheet-slides-ui-scale));
        background: #6ea8fe;
        border: calc(2px * var(--sheet-slides-ui-scale)) solid #fff;
        border-radius: 999px;
        z-index: 4;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(3px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.4);
        pointer-events: auto;
      }
      .sheet-slides-handle.nw { left: calc(-6px * var(--sheet-slides-ui-scale)); top: calc(-6px * var(--sheet-slides-ui-scale)); cursor: nwse-resize; }
      .sheet-slides-handle.ne { right: calc(-6px * var(--sheet-slides-ui-scale)); top: calc(-6px * var(--sheet-slides-ui-scale)); cursor: nesw-resize; }
      .sheet-slides-handle.sw { left: calc(-6px * var(--sheet-slides-ui-scale)); bottom: calc(-6px * var(--sheet-slides-ui-scale)); cursor: nesw-resize; }
      .sheet-slides-handle.se { right: calc(-6px * var(--sheet-slides-ui-scale)); bottom: calc(-6px * var(--sheet-slides-ui-scale)); cursor: nwse-resize; }
      .sheet-slides-selection-overlay.formboard-tree {
        pointer-events: none;
      }
      .sheet-slides-formboard-pivot-handle {
        position: absolute;
        width: calc(16px * var(--sheet-slides-ui-scale));
        height: calc(16px * var(--sheet-slides-ui-scale));
        border-radius: 999px;
        background: #f59e0b;
        border: calc(2px * var(--sheet-slides-ui-scale)) solid #fff7ed;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(4px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.45);
        cursor: pointer;
        pointer-events: auto;
      }
      .sheet-slides-formboard-pivot-handle.active {
        background: #f97316;
        border-color: #ffffff;
      }
      .sheet-slides-formboard-segment-handle {
        position: absolute;
        width: calc(18px * var(--sheet-slides-ui-scale));
        height: calc(18px * var(--sheet-slides-ui-scale));
        border-radius: 999px;
        background: #60a5fa;
        border: calc(2px * var(--sheet-slides-ui-scale)) solid #eff6ff;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(4px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.45);
        cursor: grab;
        pointer-events: auto;
      }
      .sheet-slides-formboard-segment-handle:active {
        cursor: grabbing;
      }
      .sheet-slides-corner-radius-handle,
      .sheet-slides-shape-adjust-handle {
        position: absolute;
        top: calc(-7px * var(--sheet-slides-ui-scale));
        width: calc(14px * var(--sheet-slides-ui-scale));
        height: calc(14px * var(--sheet-slides-ui-scale));
        background: #f4b400;
        border: calc(1.5px * var(--sheet-slides-ui-scale)) solid #7c5b00;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(3px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.35);
        transform: rotate(45deg);
        transform-origin: center center;
        cursor: ew-resize;
        z-index: 5;
        pointer-events: auto;
      }
      .sheet-slides-corner-radius-handle {
        left: calc(var(--sheet-slides-corner-radius-px, 0px) - (7px * var(--sheet-slides-ui-scale)));
      }
      .sheet-slides-shape-adjust-handle {
        left: calc(var(--sheet-slides-shape-adjust-px, 0px) - (7px * var(--sheet-slides-ui-scale)));
      }
      .sheet-slides-table-col-handle {
        position: absolute;
        top: 0;
        width: calc(14px * var(--sheet-slides-ui-scale));
        transform: translateX(-50%);
        cursor: ew-resize;
        z-index: 5;
        pointer-events: auto;
      }
      .sheet-slides-table-col-handle::after {
        content: "";
        position: absolute;
        top: calc(6px * var(--sheet-slides-ui-scale));
        bottom: calc(6px * var(--sheet-slides-ui-scale));
        left: 50%;
        width: calc(4px * var(--sheet-slides-ui-scale));
        transform: translateX(-50%);
        border-radius: 999px;
        background: #6ea8fe;
        border: calc(1px * var(--sheet-slides-ui-scale)) solid #fff;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(3px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.35);
      }
      .sheet-slides-rotate-line {
        position: absolute;
        width: calc(2px * var(--sheet-slides-ui-scale));
        height: calc(18px * var(--sheet-slides-ui-scale));
        top: calc(-18px * var(--sheet-slides-ui-scale));
        left: 50%;
        transform: translateX(calc(-1px * var(--sheet-slides-ui-scale)));
        background: #6ea8fe;
        pointer-events: none;
      }
      .sheet-slides-rotate-handle {
        position: absolute;
        top: calc(-34px * var(--sheet-slides-ui-scale));
        left: 50%;
        width: calc(14px * var(--sheet-slides-ui-scale));
        height: calc(14px * var(--sheet-slides-ui-scale));
        margin-left: calc(-7px * var(--sheet-slides-ui-scale));
        border-radius: 999px;
        border: calc(2px * var(--sheet-slides-ui-scale)) solid #fff;
        background: #ffb86b;
        cursor: grab;
        box-shadow:
          0 calc(1px * var(--sheet-slides-ui-scale))
          calc(3px * var(--sheet-slides-ui-scale))
          rgba(0,0,0,.4);
        pointer-events: auto;
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
      .sheet-slides-context-menu-separator {
        height: 1px;
        margin: 4px 2px;
        background: rgba(148,163,184,.18);
      }
      .sheet-slides-context-menu-item.danger {
        color: #fecaca;
      }
      .sheet-slides-context-menu-item.danger:hover {
        background: rgba(127,29,29,.32);
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
      .sheet-slides-pdf-progress-overlay {
        position: absolute;
        inset: 0;
        display: none;
        place-items: center;
        padding: 28px;
        background: rgba(6,10,18,.76);
        backdrop-filter: blur(4px);
        z-index: 120;
      }
      .sheet-slides-pdf-progress-card {
        width: min(840px, calc(100vw - 72px));
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 18px;
        padding: 22px;
        border: 1px solid rgba(96,165,250,.24);
        border-radius: 18px;
        background:
          radial-gradient(circle at top, rgba(45,115,255,.12), transparent 42%),
          linear-gradient(180deg, rgba(19,25,37,.98), rgba(13,18,28,.98));
        box-shadow: 0 26px 60px rgba(0,0,0,.48);
      }
      .sheet-slides-pdf-progress-copy {
        display: grid;
        align-content: start;
        gap: 12px;
        min-width: 0;
      }
      .sheet-slides-pdf-progress-eyebrow {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .12em;
        text-transform: uppercase;
        color: #93c5fd;
      }
      .sheet-slides-pdf-progress-title {
        font-size: 24px;
        line-height: 1.15;
        color: #f8fafc;
      }
      .sheet-slides-pdf-progress-detail {
        min-height: 20px;
        font-size: 14px;
        color: #e5e7eb;
      }
      .sheet-slides-pdf-progress-meta,
      .sheet-slides-pdf-progress-hint {
        font-size: 12px;
        color: #94a3b8;
      }
      .sheet-slides-pdf-progress-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        border: 1px solid rgba(96,165,250,.24);
        background: rgba(15,23,42,.76);
        overflow: hidden;
      }
      .sheet-slides-pdf-progress-fill {
        height: 100%;
        width: 0;
        border-radius: inherit;
        background: linear-gradient(90deg, #2563eb, #60a5fa);
        box-shadow: 0 0 18px rgba(96,165,250,.35);
        transition: width .18s ease;
      }
      .sheet-slides-pdf-progress-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .sheet-slides-pdf-progress-percent {
        min-width: 48px;
        text-align: right;
        font-size: 20px;
        font-weight: 700;
        color: #f8fafc;
      }
      .sheet-slides-pdf-progress-preview-panel {
        display: grid;
        gap: 10px;
        min-width: 0;
      }
      .sheet-slides-pdf-progress-preview-label {
        font-size: 12px;
        font-weight: 700;
        color: #cbd5e1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sheet-slides-pdf-progress-preview {
        min-height: 220px;
        border: 1px solid rgba(96,165,250,.2);
        border-radius: 16px;
        background:
          linear-gradient(180deg, rgba(15,23,42,.9), rgba(15,23,42,.72)),
          radial-gradient(circle at top, rgba(96,165,250,.14), transparent 55%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        overflow: hidden;
        display: grid;
        place-items: center;
        padding: 14px;
      }
      .sheet-slides-pdf-progress-preview-empty {
        font-size: 13px;
        font-weight: 600;
        color: #94a3b8;
        text-align: center;
      }
      .sheet-slides-pdf-progress-preview .sheet-slides-thumb-sheet {
        border-radius: 10px;
        box-shadow: 0 14px 30px rgba(0,0,0,.3);
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
        inset: 0;
        display: grid;
        place-items: center;
        min-height: 0;
        background: transparent;
        pointer-events: auto;
        overflow: hidden;
      }
      .sheet-slides-pmi-frame {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 8px;
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
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-height: 0;
        padding: 0;
        background: transparent;
        color: #334155;
        font-weight: 600;
        line-height: 1.2;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }
      .sheet-slides-pmi-caption.is-top {
        top: 0;
      }
      .sheet-slides-pmi-caption.is-bottom {
        bottom: 0;
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
      .sheet-slides-font-size-row {
        display: grid;
        grid-template-columns: minmax(44px, auto) 1fr minmax(44px, auto);
        gap: 6px;
        align-items: center;
      }
      .sheet-slides-segmented-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .sheet-slides-segmented-row .sheet-slides-btn,
      .sheet-slides-font-size-row .sheet-slides-btn {
        padding: 0 8px;
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
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        padding: 0 10px;
        font-size: 12px;
        gap: 10px;
      }
      .sheet-slides-status-left,
      .sheet-slides-status-right {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sheet-slides-status-right {
        justify-self: end;
      }
      .sheet-slides-status-center {
        justify-self: center;
        min-width: 0;
      }
      .sheet-slides-status-controls {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .sheet-slides-status-controls .sheet-slides-btn,
      .sheet-slides-status-controls .sheet-slides-control {
        height: 24px;
        border-radius: 7px;
        font-size: 12px;
      }
      .sheet-slides-status-controls .sheet-slides-btn {
        padding: 0 10px;
      }
      .sheet-slides-status-controls .sheet-slides-control {
        width: 110px;
        min-width: 110px;
        padding: 0 8px;
      }

      @media (max-width: 1200px) {
        .sheet-slides-root {
          grid-template-columns: 240px 1fr;
          grid-template-rows: auto 1fr 1fr 30px;
          grid-template-areas:
            "topbar topbar"
            "sidebar stage"
            "inspector inspector"
            "status status";
        }
        .sheet-slides-pdf-progress-card {
          grid-template-columns: 1fr;
        }
        .sheet-slides-pdf-progress-preview {
          min-height: 180px;
        }
      }
      @media (max-width: 780px) {
        .sheet-slides-root {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(180px, 240px) 1fr minmax(240px, auto) 30px;
          grid-template-areas:
            "topbar"
            "sidebar"
            "stage"
            "inspector"
            "status";
        }
        .sheet-slides-topbar {
          min-height: 56px;
        }
        .sheet-slides-toolbar-group {
          border-right: 0;
          padding-right: 0;
        }
        .sheet-slides-selection-group {
          width: 100%;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .sheet-slides-brand-logo {
          width: 96px;
        }
        .sheet-slides-topbar-spacer {
          display: none;
        }
        .sheet-slides-finish-btn {
          margin-left: auto;
        }
        .sheet-slides-status {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .sheet-slides-status-center {
          justify-self: end;
        }
        .sheet-slides-status-right {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

export async function generateSheetsPdfBytes(viewer, options = {}) {
  const candidate = viewer?._sheet2DEditorWindow || null;
  const active = candidate
    && candidate.viewer === viewer
    && typeof candidate.generatePdfBytes === "function"
    && typeof candidate._preparePdfExportState === "function"
    ? candidate
    : null;
  const exporter = active || new Sheet2DEditorWindow(viewer);
  try {
    await exporter._preparePdfExportState();
    return await exporter.generatePdfBytes(options);
  } finally {
    if (!active) {
      try { exporter.dispose(); } catch { }
    }
  }
}

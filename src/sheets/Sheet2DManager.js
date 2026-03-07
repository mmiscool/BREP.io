import { deepClone } from "../utils/deepClone.js";
import {
  getSheetSizeByKey,
  normalizeSheetOrientation,
  resolveSheetDimensions,
} from "./sheetStandards.js";

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeText(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function sanitizeColor(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/^#[\da-fA-F]{3,8}$/.test(text)) return text;
  if (/^[a-zA-Z]+$/.test(text)) return text;
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(text)) return text;
  return fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTextAlign(value, fallback = "left") {
  const key = String(value || fallback).trim().toLowerCase();
  if (key === "middle" || key === "center") return "center";
  if (key === "end" || key === "right") return "right";
  return "left";
}

function normalizeElementType(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (token === "rect") return "rect";
  if (token === "ellipse") return "ellipse";
  if (token === "image") return "image";
  if (token === "line") return "line";
  if (token === "pmiinset" || token === "pmi_inset" || token === "pmi" || token === "pmiview") return "pmiInset";
  return "text";
}

export class Sheet2DManager {
  constructor(partHistory) {
    this.partHistory = partHistory || null;
    this.sheets = [];
    this._listeners = new Set();
  }

  reset() {
    this.sheets = [];
    this._emit();
  }

  getSheets() {
    this._normalizeSheetsArray(this.sheets);
    return this.sheets;
  }

  getSheetById(sheetId) {
    const id = String(sheetId ?? "").trim();
    if (!id) return null;
    return this.getSheets().find((sheet) => String(sheet?.id || "") === id) || null;
  }

  setSheets(rawSheets) {
    const list = Array.isArray(rawSheets) ? Array.from(rawSheets) : [];
    this.sheets = list;
    this._normalizeSheetsArray(this.sheets);
    this._emit();
    return this.sheets;
  }

  createSheet(options = {}) {
    const list = this.getSheets();
    const normalized = this._normalizeSheet({
      ...options,
      id: options?.id || this._generateSheetId(),
    }, list.length);
    list.push(normalized);
    this._emit();
    return normalized;
  }

  duplicateSheet(sheetIdOrIndex) {
    const index = this._resolveSheetIndex(sheetIdOrIndex);
    if (index < 0) return null;
    const source = this.getSheets()[index];
    const copy = deepClone(source) || {};
    copy.id = this._generateSheetId();
    copy.name = `${sanitizeText(source?.name, "Sheet")} Copy`;
    copy.elements = Array.isArray(copy.elements)
      ? copy.elements.map((el) => ({
        ...(el || {}),
        id: this._generateElementId(copy.id),
      }))
      : [];
    const next = this._normalizeSheet(copy, this.sheets.length);
    this.sheets.push(next);
    this._emit();
    return next;
  }

  updateSheet(sheetIdOrIndex, updater) {
    const index = this._resolveSheetIndex(sheetIdOrIndex);
    if (index < 0) return null;
    const current = this.sheets[index];
    let next = current;

    if (typeof updater === "function") {
      try {
        const result = updater(deepClone(current));
        if (result && typeof result === "object") next = result;
      } catch {
        next = current;
      }
    } else if (updater && typeof updater === "object") {
      next = { ...current, ...updater };
    }

    this.sheets[index] = this._normalizeSheet(next, index, current?.id);
    this._emit();
    return this.sheets[index];
  }

  moveSheet(sheetIdOrIndex, toIndex) {
    const fromIndex = this._resolveSheetIndex(sheetIdOrIndex);
    if (fromIndex < 0) return null;

    const list = this.getSheets();
    const targetIndex = clamp(Math.round(toFiniteNumber(toIndex, fromIndex)), 0, Math.max(0, list.length - 1));
    if (targetIndex === fromIndex) return list[fromIndex] || null;

    const [moved] = list.splice(fromIndex, 1);
    if (!moved) return null;
    list.splice(targetIndex, 0, moved);
    this._normalizeSheetsArray(list);
    this._emit();
    return moved;
  }

  removeSheet(sheetIdOrIndex) {
    const index = this._resolveSheetIndex(sheetIdOrIndex);
    if (index < 0) return null;
    const [removed] = this.sheets.splice(index, 1);
    this._normalizeSheetsArray(this.sheets);
    this._emit();
    return removed || null;
  }

  addListener(listener) {
    if (typeof listener !== "function") return () => { };
    this._listeners.add(listener);
    return () => {
      try { this._listeners.delete(listener); } catch { }
    };
  }

  removeListener(listener) {
    if (typeof listener !== "function") return;
    try { this._listeners.delete(listener); } catch { }
  }

  notifyChanged() {
    this._emit();
  }

  toSerializable() {
    return this.getSheets().map((sheet) => deepClone(sheet));
  }

  _resolveSheetIndex(sheetIdOrIndex) {
    if (Number.isInteger(sheetIdOrIndex)) {
      const index = Number(sheetIdOrIndex);
      return (index >= 0 && index < this.getSheets().length) ? index : -1;
    }
    const id = String(sheetIdOrIndex ?? "").trim();
    if (!id) return -1;
    return this.getSheets().findIndex((sheet) => String(sheet?.id || "") === id);
  }

  _generateSheetId() {
    const ids = new Set(this.getSheets().map((sheet) => String(sheet?.id || "")));
    let i = 1;
    while (ids.has(`sheet-${i}`)) i += 1;
    return `sheet-${i}`;
  }

  _generateElementId(sheetId = "sheet") {
    const safeSheet = String(sheetId || "sheet").replace(/[^A-Za-z0-9_-]/g, "_");
    return `${safeSheet}:el:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  }

  _normalizeSheetsArray(arrayRef) {
    if (!Array.isArray(arrayRef)) {
      this.sheets = [];
      return this.sheets;
    }
    for (let i = 0; i < arrayRef.length; i++) {
      const keepId = arrayRef[i]?.id;
      arrayRef[i] = this._normalizeSheet(arrayRef[i], i, keepId);
    }
    return arrayRef;
  }

  _normalizeSheet(rawSheet, index, keepId = null) {
    const source = (rawSheet && typeof rawSheet === "object") ? rawSheet : {};
    const size = getSheetSizeByKey(source.sizeKey);
    const orientation = normalizeSheetOrientation(source.orientation);
    const dims = resolveSheetDimensions(size.key, orientation);
    const id = sanitizeText(keepId || source.id || this._generateSheetId(), "").trim() || this._generateSheetId();
    const name = sanitizeText(source.name, "").trim() || `Sheet ${index + 1}`;

    const elementsIn = Array.isArray(source.elements) ? source.elements : [];
    const elements = [];
    const ids = new Set();
    for (let i = 0; i < elementsIn.length; i++) {
      const next = this._normalizeElement(elementsIn[i], i, id, dims);
      if (!next) continue;
      if (ids.has(next.id)) next.id = this._generateElementId(id);
      ids.add(next.id);
      elements.push(next);
    }

    return {
      id,
      name,
      sizeKey: dims.key,
      sizeLabel: dims.label,
      orientation: dims.orientation,
      units: dims.units,
      widthIn: dims.widthIn,
      heightIn: dims.heightIn,
      widthPx: dims.widthPx,
      heightPx: dims.heightPx,
      pxPerInch: dims.pxPerInch,
      background: sanitizeColor(source.background, "#ffffff"),
      elements,
      metadata: {
        createdAt: Number.isFinite(Number(source?.metadata?.createdAt))
          ? Number(source.metadata.createdAt)
          : Date.now(),
        updatedAt: Date.now(),
      },
    };
  }

  _normalizeElement(rawElement, index, sheetId, dims) {
    const source = (rawElement && typeof rawElement === "object") ? rawElement : {};
    const type = normalizeElementType(source.type);
    const pageWidth = Math.max(0.1, toFiniteNumber(dims?.widthIn, 11));
    const pageHeight = Math.max(0.1, toFiniteNumber(dims?.heightIn, 8.5));
    const minX = -pageWidth * 2;
    const minY = -pageHeight * 2;
    const maxX = pageWidth * 3;
    const maxY = pageHeight * 3;
    const defaultX = clamp(toFiniteNumber(source.x, pageWidth * 0.1), minX, maxX);
    const defaultY = clamp(toFiniteNumber(source.y, pageHeight * 0.1), minY, maxY);
    const id = sanitizeText(source.id, "").trim() || this._generateElementId(sheetId);
    const fallbackZ = Number.isInteger(source.z)
      ? source.z
      : (Number.isInteger(source.layer) ? source.layer : index);
    const common = {
      id,
      type,
      x: defaultX,
      y: defaultY,
      rotationDeg: toFiniteNumber(source.rotationDeg, 0),
      z: Number.isFinite(Number(fallbackZ)) ? Number(fallbackZ) : index,
      fill: sanitizeColor(source.fill, (type === "text" || type === "pmiInset") ? "transparent" : "#dbeafe"),
      stroke: sanitizeColor(source.stroke, "#1d4ed8"),
      strokeWidth: clamp(toFiniteNumber(source.strokeWidth, 0.02), 0.002, 1),
      opacity: clamp(toFiniteNumber(source.opacity, 1), 0, 1),
    };

    if (type === "line") {
      const x2 = clamp(toFiniteNumber(source.x2, defaultX + 1), minX, maxX);
      const y2 = clamp(toFiniteNumber(source.y2, defaultY), minY, maxY);
      return {
        ...common,
        x2,
        y2,
        strokeWidth: clamp(toFiniteNumber(source.strokeWidth, 0.035), 0.002, 1),
      };
    }

    const hasW = Number.isFinite(Number(source.w));
    const hasH = Number.isFinite(Number(source.h));
    const rawW = toFiniteNumber(
      hasW ? source.w : (source.width ?? (source.radiusX != null ? toFiniteNumber(source.radiusX, 0.8) * 2 : 1.4)),
      1.4,
    );
    const rawH = toFiniteNumber(
      hasH ? source.h : (source.height ?? (source.radiusY != null ? toFiniteNumber(source.radiusY, 0.55) * 2 : 0.9)),
      0.9,
    );
    const w = clamp(rawW, 0.05, pageWidth * 8);
    const h = clamp(rawH, 0.05, pageHeight * 8);
    const usesLegacyCenterRect = !hasW && !hasH
      && Number.isFinite(Number(source.width))
      && Number.isFinite(Number(source.height));
    const usesLegacyCenterEllipse = !hasW && !hasH
      && Number.isFinite(Number(source.radiusX))
      && Number.isFinite(Number(source.radiusY));
    const x = clamp(
      usesLegacyCenterRect
        ? toFiniteNumber(source.x, pageWidth * 0.5) - (w * 0.5)
        : (usesLegacyCenterEllipse ? toFiniteNumber(source.x, pageWidth * 0.5) - (w * 0.5) : defaultX),
      minX,
      maxX,
    );
    const y = clamp(
      usesLegacyCenterRect
        ? toFiniteNumber(source.y, pageHeight * 0.5) - (h * 0.5)
        : (usesLegacyCenterEllipse ? toFiniteNumber(source.y, pageHeight * 0.5) - (h * 0.5) : defaultY),
      minY,
      maxY,
    );

    if (type === "rect" || type === "ellipse" || type === "image" || type === "pmiInset") {
      const fontStyle = String(source.fontStyle || (source.italic ? "italic" : "normal")).toLowerCase() === "italic"
        ? "italic"
        : "normal";
      const fontWeight = String(source.fontWeight || (source.bold ? "700" : "400"));
      return {
        ...common,
        x,
        y,
        w,
        h,
        cornerRadius: clamp(toFiniteNumber(source.cornerRadius, type === "rect" ? 0.1 : 0), 0, 2),
        src: (type === "image" || type === "pmiInset") ? sanitizeText(source.src, "") : undefined,
        mediaScale: (type === "image" || type === "pmiInset")
          ? clamp(toFiniteNumber(source.mediaScale, 1), 1, 10)
          : undefined,
        mediaOffsetX: (type === "image" || type === "pmiInset")
          ? clamp(toFiniteNumber(source.mediaOffsetX, 0), -1, 1)
          : undefined,
        mediaOffsetY: (type === "image" || type === "pmiInset")
          ? clamp(toFiniteNumber(source.mediaOffsetY, 0), -1, 1)
          : undefined,
        pmiViewIndex: type === "pmiInset" ? (Number.isInteger(source.pmiViewIndex) ? source.pmiViewIndex : -1) : undefined,
        pmiViewName: type === "pmiInset" ? sanitizeText(source.pmiViewName, "PMI View") : undefined,
        pmiImageRevision: type === "pmiInset" ? (Number.isInteger(source.pmiImageRevision) ? source.pmiImageRevision : 0) : undefined,
        pmiModelRevision: type === "pmiInset" ? (Number.isInteger(source.pmiModelRevision) ? source.pmiModelRevision : -1) : undefined,
        pmiImageCaptureKey: type === "pmiInset" ? sanitizeText(source.pmiImageCaptureKey, "") : undefined,
        showTitle: type === "pmiInset" ? source.showTitle !== false : undefined,
        text: (type === "rect" || type === "ellipse") ? sanitizeText(source.text, "") : undefined,
        fontSize: (type === "rect" || type === "ellipse")
          ? clamp(toFiniteNumber(source.fontSize, 0.28), 0.08, 3)
          : undefined,
        fontFamily: (type === "rect" || type === "ellipse")
          ? sanitizeText(source.fontFamily, "Arial, Helvetica, sans-serif")
          : undefined,
        fontWeight: (type === "rect" || type === "ellipse")
          ? (/^\d{3}$/.test(fontWeight) ? fontWeight : (fontWeight === "bold" ? "700" : "400"))
          : undefined,
        fontStyle: (type === "rect" || type === "ellipse") ? fontStyle : undefined,
        textAlign: (type === "rect" || type === "ellipse")
          ? normalizeTextAlign(source.textAlign || source.textAnchor, "center")
          : undefined,
        color: (type === "rect" || type === "ellipse")
          ? sanitizeColor(source.color, sanitizeColor(source.textColor, "#0f172a"))
          : undefined,
      };
    }

    const textAlign = normalizeTextAlign(source.textAlign || source.textAnchor, "left");
    const fontStyle = String(source.fontStyle || (source.italic ? "italic" : "normal")).toLowerCase() === "italic"
      ? "italic"
      : "normal";
    const fontWeight = String(source.fontWeight || (source.bold ? "700" : "400"));
    return {
      ...common,
      w: clamp(toFiniteNumber(hasW ? source.w : source.width, 3.2), 0.1, pageWidth * 8),
      h: clamp(toFiniteNumber(hasH ? source.h : source.height, 1.1), 0.1, pageHeight * 8),
      text: sanitizeText(source.text, `Text ${index + 1}`),
      fontSize: clamp(toFiniteNumber(source.fontSize, 0.32), 0.08, 3),
      fontFamily: sanitizeText(source.fontFamily, "Arial, Helvetica, sans-serif"),
      fontWeight: /^\d{3}$/.test(fontWeight) ? fontWeight : (fontWeight === "bold" ? "700" : "400"),
      fontStyle,
      textAlign,
      color: sanitizeColor(source.color, sanitizeColor(source.textColor, sanitizeColor(source.fill, "#111111"))),
    };
  }

  _emit() {
    if (!this._listeners || this._listeners.size === 0) return;
    const sheets = this.getSheets();
    for (const listener of Array.from(this._listeners)) {
      try { listener(sheets, this.partHistory || null); } catch { }
    }
  }
}

import * as THREE from "three";
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from "three/examples/jsm/Addons.js";
import { BREP } from "../../BREP/BREP.js";
import { CombinedTransformControls } from "../../UI/controls/CombinedTransformControls.js";
import {
  buildCageSegments,
  cageCoordsFromIndex,
  cageIndex,
  cageIdFromIndex,
  cloneCageData,
  sanitizeCageDivisions,
} from "./nurbsFaceSolidUtils.js";

const noop = () => { };
const CAGE_POINT_SELECTED_COLOR = 0xff5a00;
const CAGE_POINT_RADIUS_MIN = 0.08;
const CAGE_POINT_RADIUS_SCALE = 0.012;
const CAGE_POINT_SCREEN_RADIUS_PX = 8;
const CAGE_QUAD_IDLE_OPACITY = 0;
const CAGE_QUAD_FILL_OPACITY = 0.14;
const CAGE_QUAD_INSET_BALL_RADII = 1.0;
const CAGE_QUAD_MIN_INSET_UV = 0.01;
const CAGE_QUAD_MAX_INSET_UV = 0.45;
const CAGE_QUAD_CORNER_RADIUS_RATIO = 0.85;
const CAGE_QUAD_CORNER_STEPS = 5;
const CAGE_EDGE_LINE_WIDTH_PX = 2.5;
const _tmpRendererSize = new THREE.Vector2();
const _tmpWorldPoint = new THREE.Vector3();
const _tmpCameraDir = new THREE.Vector3();
const _tmpCameraToPoint = new THREE.Vector3();
const DEFAULT_DISPLAY_OPTIONS = Object.freeze({
  showEdges: true,
  showControlPoints: true,
  allowX: true,
  allowY: true,
  allowZ: true,
  symmetryX: false,
  symmetryY: false,
  symmetryZ: false,
  cageColor: 0x70d6ff,
});

function normalizeColor(value, fallback = DEFAULT_DISPLAY_OPTIONS.cageColor) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(0xffffff, Math.floor(value)));
  }
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[\da-fA-F]{6}$/.test(normalized)) return fallback;
  return parseInt(normalized, 16);
}

function normalizeDisplayOptions(rawOptions) {
  const raw = (rawOptions && typeof rawOptions === "object") ? rawOptions : null;
  const legacySymmetry = typeof raw?.symmetryMode === "boolean" ? raw.symmetryMode : false;
  return {
    showEdges: typeof raw?.showEdges === "boolean" ? raw.showEdges : DEFAULT_DISPLAY_OPTIONS.showEdges,
    showControlPoints: typeof raw?.showControlPoints === "boolean"
      ? raw.showControlPoints
      : DEFAULT_DISPLAY_OPTIONS.showControlPoints,
    allowX: typeof raw?.allowX === "boolean" ? raw.allowX : DEFAULT_DISPLAY_OPTIONS.allowX,
    allowY: typeof raw?.allowY === "boolean" ? raw.allowY : DEFAULT_DISPLAY_OPTIONS.allowY,
    allowZ: typeof raw?.allowZ === "boolean" ? raw.allowZ : DEFAULT_DISPLAY_OPTIONS.allowZ,
    symmetryX: typeof raw?.symmetryX === "boolean"
      ? raw.symmetryX
      : (legacySymmetry ? true : DEFAULT_DISPLAY_OPTIONS.symmetryX),
    symmetryY: typeof raw?.symmetryY === "boolean"
      ? raw.symmetryY
      : (legacySymmetry ? true : DEFAULT_DISPLAY_OPTIONS.symmetryY),
    symmetryZ: typeof raw?.symmetryZ === "boolean"
      ? raw.symmetryZ
      : (legacySymmetry ? true : DEFAULT_DISPLAY_OPTIONS.symmetryZ),
    cageColor: normalizeColor(raw?.cageColor, DEFAULT_DISPLAY_OPTIONS.cageColor),
  };
}

function buildRoundedInsetUvLoop(insetUInput, insetVInput) {
  const insetU = Math.max(CAGE_QUAD_MIN_INSET_UV, Math.min(CAGE_QUAD_MAX_INSET_UV, Number(insetUInput) || 0));
  const insetV = Math.max(CAGE_QUAD_MIN_INSET_UV, Math.min(CAGE_QUAD_MAX_INSET_UV, Number(insetVInput) || 0));
  const left = insetU;
  const right = 1 - insetU;
  const bottom = insetV;
  const top = 1 - insetV;
  const maxRadius = Math.max(0, Math.min((right - left) * 0.5, (top - bottom) * 0.5));
  const targetRadius = Math.min(insetU, insetV) * CAGE_QUAD_CORNER_RADIUS_RATIO;
  const radius = Math.max(0, Math.min(targetRadius, maxRadius));
  if (radius <= 1e-6) {
    return [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
    ];
  }

  const steps = Math.max(1, Math.floor(CAGE_QUAD_CORNER_STEPS));
  const loop = [];
  const addPoint = (u, v) => {
    const prev = loop[loop.length - 1];
    if (prev && Math.abs(prev[0] - u) < 1e-9 && Math.abs(prev[1] - v) < 1e-9) return;
    loop.push([u, v]);
  };
  const addArc = (cx, cy, startAngle, endAngle) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + (endAngle - startAngle) * t;
      addPoint(
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
      );
    }
  };

  addPoint(left + radius, bottom);
  addPoint(right - radius, bottom);
  addArc(right - radius, bottom + radius, -Math.PI / 2, 0);
  addPoint(right, top - radius);
  addArc(right - radius, top - radius, 0, Math.PI / 2);
  addPoint(left + radius, top);
  addArc(left + radius, top - radius, Math.PI / 2, Math.PI);
  addPoint(left, bottom + radius);
  addArc(left + radius, bottom + radius, Math.PI, (Math.PI * 3) / 2);

  const first = loop[0];
  const last = loop[loop.length - 1];
  if (first && last && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    loop.pop();
  }
  return loop;
}

export class NurbsCageEditorSession {
  constructor(viewer, featureID, options = {}) {
    this.viewer = viewer || null;
    this.featureID = featureID != null ? String(featureID) : null;
    this.options = options || {};

    this._featureRef = options.featureRef || null;
    this._onCageChange = (typeof options.onCageChange === "function")
      ? options.onCageChange
      : noop;
    this._onSelectionChange = (typeof options.onSelectionChange === "function")
      ? options.onSelectionChange
      : noop;

    this._cageData = null;
    this._active = false;
    this._selectedId = null;
    this._selectedIds = new Set();
    this._selectedSegmentKeys = new Set();
    this._selectedQuadKeys = new Set();
    this._segmentFaceChoiceByKey = new Map();
    this._segmentMetaByKey = new Map();
    this._quadMetaByKey = new Map();
    this._pointEntries = new Map();
    this._lineSegments = [];
    this._linePickObjects = [];
    this._quadPickObjects = [];
    this._multiMoveAnchor = {
      id: null,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      valid: false,
    };

    this._previewGroup = null;
    this._lineObject = null;
    this._control = null;
    this._controlListeners = null;
    this._controlsListener = null;
    this._pointMaterials = null;
    this._pointGeometry = null;
    this._pointGeometryRadius = 0;
    this._displayOptions = normalizeDisplayOptions(options.displayOptions);
  }

  isActive() {
    return this._active;
  }

  getCageData() {
    return cloneCageData(this._cageData);
  }

  getSelectedId() {
    return this._selectedId;
  }

  getSelectedIds() {
    return Array.from(this._selectedIds);
  }

  setFeatureRef(featureRef) {
    this._featureRef = featureRef || null;
  }

  getDisplayOptions() {
    return { ...this._displayOptions };
  }

  setDisplayOptions(options = {}) {
    this._displayOptions = normalizeDisplayOptions({
      ...this._displayOptions,
      ...(options || {}),
    });
    this._applyDisplayOptions();
    this._renderOnce();
  }

  activate(initialCage, options = {}) {
    if (!this.viewer?.scene || !this.viewer?.camera || !this.viewer?.renderer) return false;
    if (this._active) this.dispose();
    this._displayOptions = normalizeDisplayOptions({
      ...this._displayOptions,
      ...(options?.displayOptions || {}),
    });
    this._ensurePointMaterials();

    this._featureRef = options.featureRef ?? this._featureRef ?? null;
    this._cageData = cloneCageData(initialCage) || null;
    if (!this._cageData) return false;

    this._buildPreviewGroup();
    this._createControl();
    this._rebuildGeometry();

    this._active = true;
    try { this.viewer.startSplineMode?.(this); } catch { }
    this._setupViewerControlsListener();

    const initialSelection = options.initialSelection || this._selectedId || this._firstPointId();
    if (initialSelection) this.selectObject(initialSelection, { silent: true });
    this._notifySelectionChange(this._selectedId);
    this._renderOnce();
    return true;
  }

  dispose() {
    try { this.viewer?.endSplineMode?.(); } catch { }
    this._teardownViewerControlsListener();
    this._destroyControl();
    this._destroyPreviewGroup();
    this._pointEntries.clear();
    this._lineSegments = [];
    this._linePickObjects = [];
    this._quadPickObjects = [];
    this._selectedIds.clear();
    this._selectedId = null;
    this._selectedSegmentKeys.clear();
    this._selectedQuadKeys.clear();
    this._segmentFaceChoiceByKey.clear();
    this._segmentMetaByKey.clear();
    this._quadMetaByKey.clear();
    this._clearMultiMoveAnchor();
    this._active = false;
    this._disposePointMaterials();
    this._disposePointGeometry();
  }

  setCageData(cageData, options = {}) {
    const { preserveSelection = true, silent = false } = options;
    this._cageData = cloneCageData(cageData) || null;
    if (!this._cageData) return;
    const previous = preserveSelection ? this.getSelectedIds() : [];
    const previousPrimary = preserveSelection ? this._selectedId : null;
    this._rebuildGeometry();
    if (preserveSelection && previous.length) {
      const valid = previous.filter((id) => this._pointEntries.has(id));
      if (valid.length) {
        this.selectObjects(valid, {
          primaryId: valid.includes(previousPrimary) ? previousPrimary : valid[valid.length - 1],
          silent: true,
        });
      } else {
        this.selectObject(null, { silent: true });
      }
    } else if (!preserveSelection) {
      this.selectObject(null, { silent: true });
    }
    if (!silent) this._notifyCageChange("manual");
    this._renderOnce();
  }

  selectObject(id, options = {}) {
    const {
      silent = false,
      additive = false,
      toggle = false,
      preserveSegmentSelection = false,
      preserveQuadSelection = false,
    } = options;
    if (!preserveSegmentSelection) this._clearSegmentSelectionState();
    if (!preserveQuadSelection) this._clearQuadSelectionState();
    const nextId = id == null ? null : String(id);
    if (nextId && !this._pointEntries.has(nextId)) return;
    if (!nextId) {
      this._selectedIds.clear();
      this._selectedId = null;
      this._clearMultiMoveAnchor();
    } else if (additive) {
      if (toggle && this._selectedIds.has(nextId)) {
        this._selectedIds.delete(nextId);
        if (this._selectedId === nextId) {
          const remaining = this.getSelectedIds();
          this._selectedId = remaining.length ? remaining[remaining.length - 1] : null;
        }
      } else {
        this._selectedIds.add(nextId);
        this._selectedId = nextId;
      }
      if (!this._selectedId && this._selectedIds.size) {
        const remaining = this.getSelectedIds();
        this._selectedId = remaining[remaining.length - 1] || null;
      }
    } else {
      this._selectedIds.clear();
      this._selectedIds.add(nextId);
      this._selectedId = nextId;
    }
    this._updateSelectionVisuals();
    this._attachControlToSelection();
    if (!silent) this._notifySelectionChange(this._selectedId);
    this._renderOnce();
  }

  selectObjects(ids, options = {}) {
    const {
      primaryId = null,
      silent = false,
      preserveSegmentSelection = false,
      preserveQuadSelection = false,
    } = options;
    if (!preserveSegmentSelection) this._clearSegmentSelectionState();
    if (!preserveQuadSelection) this._clearQuadSelectionState();
    const raw = Array.isArray(ids) ? ids : [];
    const valid = [];
    const seen = new Set();
    for (const entry of raw) {
      const id = String(entry ?? "");
      if (!id || seen.has(id)) continue;
      if (!this._pointEntries.has(id)) continue;
      seen.add(id);
      valid.push(id);
    }
    if (!valid.length) {
      this.selectObject(null, {
        silent,
        preserveSegmentSelection,
        preserveQuadSelection,
      });
      return;
    }
    this._selectedIds = new Set(valid);
    const wantedPrimary = primaryId != null ? String(primaryId) : null;
    this._selectedId = (wantedPrimary && this._selectedIds.has(wantedPrimary))
      ? wantedPrimary
      : valid[valid.length - 1];
    this._updateSelectionVisuals();
    this._attachControlToSelection();
    if (!silent) this._notifySelectionChange(this._selectedId);
    this._renderOnce();
  }

  clearSelection(options = {}) {
    this.selectObject(null, options);
  }

  _firstPointId() {
    const dims = sanitizeCageDivisions(this._cageData?.dims);
    if (!dims.length) return null;
    return cageIdFromIndex(0, dims);
  }

  _clearSegmentSelectionState() {
    this._selectedSegmentKeys.clear();
    this._segmentFaceChoiceByKey.clear();
  }

  _clearQuadSelectionState() {
    this._selectedQuadKeys.clear();
  }

  _segmentKeyFromIndices(indexA, indexB) {
    const a = Number(indexA);
    const b = Number(indexB);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    return (a <= b) ? `${a}:${b}` : `${b}:${a}`;
  }

  _buildSegmentMeta(segment, dimsInput, idA = null, idB = null) {
    if (!Array.isArray(segment) || segment.length < 2) return null;
    const dims = sanitizeCageDivisions(dimsInput);
    const ia = Number(segment[0]);
    const ib = Number(segment[1]);
    if (!Number.isInteger(ia) || !Number.isInteger(ib)) return null;
    const key = this._segmentKeyFromIndices(ia, ib);
    if (!key) return null;

    const coordsA = cageCoordsFromIndex(ia, dims);
    const coordsB = cageCoordsFromIndex(ib, dims);
    const pointIds = [];
    if (idA) pointIds.push(String(idA));
    if (idB && String(idB) !== String(idA)) pointIds.push(String(idB));

    let axis = -1;
    const fixed = coordsA ? [...coordsA] : null;
    if (coordsA && coordsB) {
      for (let dim = 0; dim < 3; dim++) {
        if (coordsA[dim] !== coordsB[dim]) {
          axis = dim;
          break;
        }
      }
    }

    const faces = [];
    if (axis >= 0 && fixed) {
      for (let dim = 0; dim < 3; dim++) {
        if (dim === axis) continue;
        const value = fixed[dim];
        const max = dims[dim] - 1;
        if (value === 0 || value === max) faces.push({ dim, value });
      }
    }

    return {
      key,
      seg: [ia, ib],
      pointIds,
      axis,
      fixed,
      faces,
    };
  }

  _collectPointIdsForSegmentKeys(keysInput) {
    const keys = Array.isArray(keysInput) ? keysInput : Array.from(keysInput || []);
    const out = new Set();
    for (const key of keys) {
      const meta = this._segmentMetaByKey.get(String(key));
      if (!meta?.pointIds?.length) continue;
      for (const id of meta.pointIds) {
        if (id) out.add(String(id));
      }
    }
    return out;
  }

  _collectPointIdsForQuadKeys(keysInput) {
    const keys = Array.isArray(keysInput) ? keysInput : Array.from(keysInput || []);
    const out = new Set();
    for (const key of keys) {
      const meta = this._quadMetaByKey.get(String(key));
      const ids = Array.isArray(meta?.ids) ? meta.ids : [];
      for (const id of ids) {
        if (id) out.add(String(id));
      }
    }
    return out;
  }

  _collectQuadKeysForFace(faceDim, faceValue) {
    const out = [];
    for (const [key, meta] of this._quadMetaByKey.entries()) {
      if (!meta) continue;
      if (meta.faceDim !== faceDim) continue;
      if (meta.faceValue !== faceValue) continue;
      out.push(key);
    }
    return out;
  }

  _areAllQuadKeysSelected(keysInput) {
    const keys = Array.isArray(keysInput) ? keysInput : Array.from(keysInput || []);
    if (!keys.length) return false;
    for (const key of keys) {
      if (!this._selectedQuadKeys.has(String(key))) return false;
    }
    return true;
  }

  _applyQuadSelectionDelta({ addKeys = [], primaryId = null } = {}) {
    const add = Array.from(new Set((Array.isArray(addKeys) ? addKeys : []).map((k) => String(k || "")).filter(Boolean)));
    for (const key of add) this._selectedQuadKeys.add(key);

    const requiredPoints = this._collectPointIdsForQuadKeys(this._selectedQuadKeys);
    const next = new Set(this._selectedIds);
    for (const id of requiredPoints) next.add(id);

    if (!next.size) {
      this.selectObject(null, { preserveQuadSelection: true });
      return;
    }

    const all = Array.from(next);
    const wantedPrimary = (primaryId != null) ? String(primaryId) : null;
    const chosenPrimary = (wantedPrimary && next.has(wantedPrimary))
      ? wantedPrimary
      : ((this._selectedId && next.has(this._selectedId)) ? this._selectedId : all[all.length - 1]);
    this.selectObjects(all, {
      primaryId: chosenPrimary,
      preserveQuadSelection: true,
    });
  }

  _handleQuadClick({ quadKey, ids, faceDim, faceValue, primaryId = null } = {}) {
    const key = quadKey ? String(quadKey) : null;
    const quadIds = Array.isArray(ids) ? ids.map((id) => String(id || "")).filter(Boolean) : [];
    if (!key || !quadIds.length) return;
    if (!this._quadMetaByKey.has(key)) {
      this._quadMetaByKey.set(key, {
        key,
        ids: quadIds,
        faceDim,
        faceValue,
      });
    }

    if (!this._selectedQuadKeys.has(key)) {
      this._applyQuadSelectionDelta({
        addKeys: [key],
        primaryId: primaryId || quadIds[quadIds.length - 1] || this._selectedId,
      });
      return;
    }

    const faceKeys = this._collectQuadKeysForFace(faceDim, faceValue);
    if (!this._areAllQuadKeysSelected(faceKeys)) {
      this._applyQuadSelectionDelta({
        addKeys: faceKeys,
        primaryId: primaryId || quadIds[quadIds.length - 1] || this._selectedId,
      });
    }
  }

  _collectSegmentKeysForFace(axis, faceDim, faceValue) {
    if (!Number.isInteger(axis) || axis < 0) return [];
    const out = [];
    for (const [key, meta] of this._segmentMetaByKey.entries()) {
      if (!meta || meta.axis !== axis || !Array.isArray(meta.fixed)) continue;
      if (meta.fixed[faceDim] !== faceValue) continue;
      out.push(key);
    }
    return out;
  }

  _collectSegmentKeysForAxis(axis) {
    if (!Number.isInteger(axis) || axis < 0) return [];
    const out = [];
    for (const [key, meta] of this._segmentMetaByKey.entries()) {
      if (meta?.axis === axis) out.push(key);
    }
    return out;
  }

  _collectSegmentKeysForLine(axis, fixedDimA, fixedValueA, fixedDimB, fixedValueB) {
    if (!Number.isInteger(axis) || axis < 0) return [];
    const out = [];
    for (const [key, meta] of this._segmentMetaByKey.entries()) {
      if (!meta || meta.axis !== axis || !Array.isArray(meta.fixed)) continue;
      if (meta.fixed[fixedDimA] !== fixedValueA) continue;
      if (meta.fixed[fixedDimB] !== fixedValueB) continue;
      out.push(key);
    }
    return out;
  }

  _collectSegmentKeysForLoop(axis, loopDim, loopValue) {
    if (!Number.isInteger(axis) || axis < 0 || !Number.isInteger(loopDim) || loopDim < 0 || loopDim > 2) return [];
    const out = [];
    for (const [key, meta] of this._segmentMetaByKey.entries()) {
      if (!meta || meta.axis !== axis || !Array.isArray(meta.fixed)) continue;
      if (meta.fixed[loopDim] !== loopValue) continue;
      out.push(key);
    }
    return out;
  }

  _areAllSegmentKeysSelected(keysInput) {
    const keys = Array.isArray(keysInput) ? keysInput : Array.from(keysInput || []);
    if (!keys.length) return false;
    for (const key of keys) {
      if (!this._selectedSegmentKeys.has(String(key))) return false;
    }
    return true;
  }

  _chooseFaceForSegment(meta) {
    if (!meta?.faces?.length) return null;
    if (meta.faces.length === 1) {
      this._segmentFaceChoiceByKey.set(meta.key, { ...meta.faces[0] });
      return meta.faces[0];
    }

    const previous = this._segmentFaceChoiceByKey.get(meta.key);
    if (previous && meta.faces.some((f) => f.dim === previous.dim && f.value === previous.value)) {
      return previous;
    }

    let best = meta.faces[0];
    let bestScore = -1;
    for (const face of meta.faces) {
      const keys = this._collectSegmentKeysForFace(meta.axis, face.dim, face.value);
      let score = 0;
      for (const key of keys) {
        if (this._selectedSegmentKeys.has(key)) score += 1;
      }
      const betterScore = score > bestScore;
      const tieBreak = (
        score === bestScore
        && (face.dim < best.dim || (face.dim === best.dim && face.value < best.value))
      );
      if (betterScore || tieBreak) {
        best = face;
        bestScore = score;
      }
    }
    this._segmentFaceChoiceByKey.set(meta.key, { ...best });
    return best;
  }

  _applySegmentSelectionDelta({ addKeys = [], removeKeys = [], primaryId = null } = {}) {
    const add = Array.from(new Set((Array.isArray(addKeys) ? addKeys : []).map((k) => String(k || "")).filter(Boolean)));
    const remove = Array.from(new Set((Array.isArray(removeKeys) ? removeKeys : []).map((k) => String(k || "")).filter(Boolean)));

    for (const key of remove) {
      this._selectedSegmentKeys.delete(key);
      this._segmentFaceChoiceByKey.delete(key);
    }
    for (const key of add) this._selectedSegmentKeys.add(key);

    const requiredPoints = this._collectPointIdsForSegmentKeys(this._selectedSegmentKeys);
    const removedPoints = this._collectPointIdsForSegmentKeys(remove);
    const next = new Set(this._selectedIds);
    for (const id of requiredPoints) next.add(id);
    for (const id of removedPoints) {
      if (!requiredPoints.has(id)) next.delete(id);
    }

    if (!next.size) {
      this.selectObject(null, { preserveSegmentSelection: true });
      return;
    }

    const all = Array.from(next);
    const wantedPrimary = (primaryId != null) ? String(primaryId) : null;
    const chosenPrimary = (wantedPrimary && next.has(wantedPrimary))
      ? wantedPrimary
      : ((this._selectedId && next.has(this._selectedId)) ? this._selectedId : all[all.length - 1]);
    this.selectObjects(all, {
      primaryId: chosenPrimary,
      preserveSegmentSelection: true,
    });
  }

  _handleLineSegmentClick(segment, idA, idB) {
    if (!Array.isArray(segment) || segment.length < 2 || !this._cageData) return;
    const dims = sanitizeCageDivisions(this._cageData.dims);
    const meta = this._buildSegmentMeta(segment, dims, idA, idB);
    if (!meta) return;
    this._segmentMetaByKey.set(meta.key, meta);

    const hasSegment = this._selectedSegmentKeys.has(meta.key);
    const face = this._chooseFaceForSegment(meta);
    const nonAxisDims = [0, 1, 2].filter((dim) => dim !== meta.axis);
    if (nonAxisDims.length !== 2 || !Array.isArray(meta.fixed)) return;

    const lineKeys = this._collectSegmentKeysForLine(
      meta.axis,
      nonAxisDims[0],
      meta.fixed[nonAxisDims[0]],
      nonAxisDims[1],
      meta.fixed[nonAxisDims[1]],
    );
    const lineTargetKeys = lineKeys.length ? lineKeys : [meta.key];

    let loopKeys = this._collectSegmentKeysForAxis(meta.axis);
    if (face && Number.isInteger(face.dim)) {
      const loopDim = nonAxisDims.find((dim) => dim !== face.dim);
      if (Number.isInteger(loopDim)) {
        const candidate = this._collectSegmentKeysForLoop(meta.axis, loopDim, meta.fixed[loopDim]);
        if (candidate.length) loopKeys = candidate;
      }
    }

    if (!hasSegment) {
      this._applySegmentSelectionDelta({
        addKeys: [meta.key],
        primaryId: idB || idA || this._selectedId,
      });
      return;
    }
    if (!this._areAllSegmentKeysSelected(lineTargetKeys)) {
      this._applySegmentSelectionDelta({
        addKeys: lineTargetKeys,
        primaryId: idB || idA || this._selectedId,
      });
      return;
    }
    if (!this._areAllSegmentKeysSelected(loopKeys)) {
      this._applySegmentSelectionDelta({
        addKeys: loopKeys,
        primaryId: idB || idA || this._selectedId,
      });
      return;
    }
  }

  _clearMultiMoveAnchor() {
    this._multiMoveAnchor.id = null;
    this._multiMoveAnchor.x = 0;
    this._multiMoveAnchor.y = 0;
    this._multiMoveAnchor.z = 0;
    this._multiMoveAnchor.qx = 0;
    this._multiMoveAnchor.qy = 0;
    this._multiMoveAnchor.qz = 0;
    this._multiMoveAnchor.qw = 1;
    this._multiMoveAnchor.valid = false;
  }

  _captureMultiMoveAnchorFromEntry(id, entry) {
    if (!id || !entry?.vertex) {
      this._clearMultiMoveAnchor();
      return;
    }
    const pos = entry.vertex.position;
    const quat = entry.vertex.quaternion;
    this._multiMoveAnchor.id = id;
    this._multiMoveAnchor.x = pos.x;
    this._multiMoveAnchor.y = pos.y;
    this._multiMoveAnchor.z = pos.z;
    this._multiMoveAnchor.qx = quat.x;
    this._multiMoveAnchor.qy = quat.y;
    this._multiMoveAnchor.qz = quat.z;
    this._multiMoveAnchor.qw = quat.w;
    this._multiMoveAnchor.valid = true;
  }

  _ensurePointMaterials() {
    if (!this._pointMaterials?.base || !this._pointMaterials?.selected) {
      const base = new THREE.MeshStandardMaterial({
        color: this._displayOptions.cageColor,
        transparent: true,
        opacity: 1,
        roughness: 0.35,
        metalness: 0.05,
        depthTest: false,
        depthWrite: false,
      });
      const selected = new THREE.MeshStandardMaterial({
        color: CAGE_POINT_SELECTED_COLOR,
        transparent: true,
        opacity: 1,
        roughness: 0.25,
        metalness: 0.1,
        depthTest: false,
        depthWrite: false,
      });
      this._pointMaterials = { base, selected };
    }
    try { this._pointMaterials.base.color.setHex(this._displayOptions.cageColor); } catch { }
  }

  _disposePointMaterials() {
    const mats = this._pointMaterials;
    if (!mats) return;
    try { mats.base?.dispose?.(); } catch { }
    try { mats.selected?.dispose?.(); } catch { }
    this._pointMaterials = null;
  }

  _ensurePointGeometry(radius) {
    const safeRadius = Math.max(CAGE_POINT_RADIUS_MIN, Number(radius) || CAGE_POINT_RADIUS_MIN);
    if (this._pointGeometry && Math.abs(this._pointGeometryRadius - safeRadius) < 1e-9) return;
    this._disposePointGeometry();
    this._pointGeometry = new THREE.SphereGeometry(safeRadius, 14, 10);
    this._pointGeometryRadius = safeRadius;
  }

  _disposePointGeometry() {
    try { this._pointGeometry?.dispose?.(); } catch { }
    this._pointGeometry = null;
    this._pointGeometryRadius = 0;
  }

  _buildPreviewGroup() {
    const scene = this.viewer?.scene;
    if (!scene) return;
    const name = `NurbsCageEditorPreview:${this.featureID || ""}`;
    const existing = scene.getObjectByName(name);
    if (existing) {
      try { scene.remove(existing); } catch { }
    }

    this._previewGroup = new THREE.Group();
    this._previewGroup.name = name;
    this._previewGroup.userData = this._previewGroup.userData || {};
    this._previewGroup.userData.excludeFromFit = true;
    this._previewGroup.userData.preventRemove = true;
    scene.add(this._previewGroup);
  }

  _destroyPreviewGroup() {
    if (!this._previewGroup) return;
    try {
      while (this._previewGroup.children.length) {
        const child = this._previewGroup.children[0];
        this._previewGroup.remove(child);
        try { child.geometry?.dispose?.(); } catch { }
        try { child.material?.dispose?.(); } catch { }
        try { child.userData?.__hoverMaterial?.dispose?.(); } catch { }
      }
    } catch { }
    try {
      if (this._previewGroup.userData) this._previewGroup.userData.preventRemove = false;
      this.viewer?.scene?.remove(this._previewGroup);
    } catch { }
    this._previewGroup = null;
    this._lineObject = null;
  }

  _createControl() {
    if (!this.viewer?.scene || !this.viewer?.camera || !this.viewer?.renderer) return;
    this._destroyControl();

    const control = new CombinedTransformControls(
      this.viewer.camera,
      this.viewer.renderer.domElement,
    );
    control.name = `NurbsCageControl:${this.featureID || ""}`;
    control.setMode("translate");
    control.showX = !!this._displayOptions.allowX;
    control.showY = !!this._displayOptions.allowY;
    control.showZ = !!this._displayOptions.allowZ;
    control.enabled = false;
    control.visible = false;
    control.userData = control.userData || {};
    control.userData.excludeFromFit = true;
    this.viewer.scene.add(control);

    const onChange = () => this._handleControlChange();
    const onDragging = (event) => this._handleControlDragging(!!event?.value);
    control.addEventListener("change", onChange);
    control.addEventListener("dragging-changed", onDragging);

    this._control = control;
    this._controlListeners = { onChange, onDragging };
  }

  _destroyControl() {
    if (!this._control) return;
    const listeners = this._controlListeners;
    if (listeners) {
      try { this._control.removeEventListener("change", listeners.onChange); } catch { }
      try { this._control.removeEventListener("dragging-changed", listeners.onDragging); } catch { }
    }
    try { this._control.detach?.(); } catch { }
    try { this.viewer?.scene?.remove(this._control); } catch { }
    try { this._control.dispose?.(); } catch { }
    this._control = null;
    this._controlListeners = null;
  }

  _setupViewerControlsListener() {
    this._teardownViewerControlsListener();
    if (!this.viewer?.controls || typeof this.viewer.controls.addEventListener !== "function") return;
    this._controlsListener = () => {
      try { this._control?.update?.(); } catch { }
      this._updatePointHandleScales();
      this._updateQuadPickGeometry();
    };
    try { this.viewer.controls.addEventListener("change", this._controlsListener); } catch { }
    try { this.viewer.controls.addEventListener("end", this._controlsListener); } catch { }
  }

  _teardownViewerControlsListener() {
    if (!this._controlsListener || !this.viewer?.controls) return;
    try { this.viewer.controls.removeEventListener("change", this._controlsListener); } catch { }
    try { this.viewer.controls.removeEventListener("end", this._controlsListener); } catch { }
    this._controlsListener = null;
  }

  _rebuildGeometry() {
    if (!this._previewGroup || !this._cageData) return;
    while (this._previewGroup.children.length) {
      const child = this._previewGroup.children[0];
      this._previewGroup.remove(child);
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
      try { child.userData?.__hoverMaterial?.dispose?.(); } catch { }
    }
    this._pointEntries.clear();
    this._linePickObjects = [];
    this._quadPickObjects = [];
    this._segmentMetaByKey.clear();
    this._quadMetaByKey.clear();
    this._clearSegmentSelectionState();
    this._clearQuadSelectionState();

    const dims = sanitizeCageDivisions(this._cageData.dims);
    this._lineSegments = buildCageSegments(dims);

    const lineGeom = new LineSegmentsGeometry();
    const lineMat = new LineMaterial({
      color: 0x70d6ff,
      linewidth: CAGE_EDGE_LINE_WIDTH_PX,
      transparent: true,
      opacity: 0.8,
      dashed: false,
      worldUnits: false,
      depthTest: false,
      depthWrite: false,
    });
    try {
      const rect = this.viewer?.renderer?.domElement?.getBoundingClientRect?.();
      if (rect?.width > 0 && rect?.height > 0) lineMat.resolution?.set?.(rect.width, rect.height);
    } catch { }
    this._lineObject = new LineSegments2(lineGeom, lineMat);
    this._lineObject.renderOrder = 10000;
    this._lineObject.userData = this._lineObject.userData || {};
    this._lineObject.userData.excludeFromFit = true;
    this._previewGroup.add(this._lineObject);

    // Create one pickable line object per segment so repeated clicks can cycle segment/face/loop selection.
    for (const seg of this._lineSegments) {
      const linePickGeom = new THREE.BufferGeometry();
      linePickGeom.setAttribute("position", new THREE.Float32BufferAttribute([
        0, 0, 0, 0, 0, 0,
      ], 3));
      const linePickMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
      });
      const linePickHoverMat = new THREE.LineBasicMaterial({
        color: this._displayOptions.cageColor,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const linePick = new THREE.LineSegments(linePickGeom, linePickMat);
      linePick.type = "EDGE";
      const idA = cageIdFromIndex(seg[0], dims);
      const idB = cageIdFromIndex(seg[1], dims);
      const segMeta = this._buildSegmentMeta(seg, dims, idA, idB);
      linePick.userData = linePick.userData || {};
      linePick.userData.excludeFromFit = true;
      linePick.userData.isSplineWeight = true;
      linePick.userData.nurbsCageSegment = [...seg];
      linePick.userData.nurbsCageSegmentKey = segMeta?.key || null;
      linePick.userData.__baseMaterial = linePickMat;
      linePick.userData.__hoverMaterial = linePickHoverMat;
      linePick.renderOrder = 10001;
      if (segMeta?.key) this._segmentMetaByKey.set(segMeta.key, segMeta);
      linePick.onClick = () => {
        if (!idA || !idB) return;
        this._handleLineSegmentClick(seg, idA, idB);
      };
      this._linePickObjects.push(linePick);
      this._previewGroup.add(linePick);
    }

    const quadDefs = this._buildSurfaceQuadPickDefs(dims);
    for (const def of quadDefs) {
      const quadGeom = new THREE.BufferGeometry();
      quadGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      const quadMat = new THREE.MeshBasicMaterial({
        color: this._displayOptions.cageColor,
        transparent: true,
        opacity: CAGE_QUAD_IDLE_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const quadHoverMat = new THREE.MeshBasicMaterial({
        color: this._displayOptions.cageColor,
        transparent: true,
        opacity: CAGE_QUAD_FILL_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const quadPick = new THREE.Mesh(quadGeom, quadMat);
      quadPick.type = "FACE";
      quadPick.userData = quadPick.userData || {};
      quadPick.userData.excludeFromFit = true;
      quadPick.userData.isSplineWeight = true;
      quadPick.userData.nurbsCageQuad = def.name;
      quadPick.userData.nurbsCageQuadKey = def.key || def.name;
      quadPick.userData.__baseMaterial = quadMat;
      quadPick.userData.__hoverMaterial = quadHoverMat;
      // Force two-sided hit testing for cage quads regardless of current hover/base material state.
      quadPick.raycast = function raycastQuadBothSides(raycaster, intersects) {
        const material = this.material;
        if (!material) return;
        if (Array.isArray(material)) {
          const prevSides = material.map((m) => m?.side);
          try {
            for (const m of material) {
              if (m && typeof m.side !== "undefined") m.side = THREE.DoubleSide;
            }
            THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
          } finally {
            for (let i = 0; i < material.length; i++) {
              const m = material[i];
              if (m && typeof m.side !== "undefined") m.side = prevSides[i];
            }
          }
          return;
        }
        const prevSide = material.side;
        try {
          material.side = THREE.DoubleSide;
          THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
        } finally {
          material.side = prevSide;
        }
      };
      quadPick.renderOrder = 9998;
      if (def.key) {
        this._quadMetaByKey.set(def.key, {
          key: def.key,
          ids: Array.isArray(def.ids) ? [...def.ids] : [],
          faceDim: def.faceDim,
          faceValue: def.faceValue,
        });
      }
      quadPick.onClick = () => {
        if (!def.ids?.length) return;
        this._handleQuadClick({
          quadKey: def.key || def.name,
          ids: def.ids,
          faceDim: def.faceDim,
          faceValue: def.faceValue,
          primaryId: this._selectedId || def.ids[def.ids.length - 1],
        });
      };
      this._quadPickObjects.push({
        key: def.key || def.name,
        mesh: quadPick,
        corners: def.corners,
        ids: def.ids,
        faceDim: def.faceDim,
        faceValue: def.faceValue,
      });
      this._previewGroup.add(quadPick);
    }

    const points = Array.isArray(this._cageData.points) ? this._cageData.points : [];
    const bounds = new THREE.Box3();
    for (const point of points) {
      if (!Array.isArray(point) || point.length < 3) continue;
      bounds.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
    }
    const ext = bounds.getSize(new THREE.Vector3());
    const maxExtent = Math.max(ext.x || 0, ext.y || 0, ext.z || 0, 1);
    this._ensurePointGeometry(maxExtent * CAGE_POINT_RADIUS_SCALE);

    for (let index = 0; index < points.length; index++) {
      const id = cageIdFromIndex(index, dims);
      if (!id) continue;
      const point = points[index];
      const vertex = new BREP.Vertex(point, { name: `NurbsCageVertex:${id}` });
      vertex.userData = vertex.userData || {};
      vertex.userData.nurbsCagePointId = id;
      vertex.userData.isSplineVertex = true;
      vertex.onClick = () => {
        this.selectObject(id, {
          additive: true,
          toggle: true,
        });
      };

      let pointObject = null;
      if (vertex._point) {
        vertex._point.userData = vertex._point.userData || {};
        vertex._point.userData.nurbsCagePointId = id;
        vertex._point.userData.isSplineVertex = true;
        vertex._point.onClick = vertex.onClick;
        vertex._point.renderOrder = 10002;
        vertex._point.visible = false;
      }

      if (this._pointGeometry && this._pointMaterials?.base) {
        const handle = new THREE.Mesh(this._pointGeometry, this._pointMaterials.base);
        handle.userData = handle.userData || {};
        handle.userData.nurbsCagePointId = id;
        handle.userData.isSplineVertex = true;
        handle.onClick = vertex.onClick;
        handle.renderOrder = 30003;
        vertex.add(handle);
        pointObject = handle;
      }

      this._previewGroup.add(vertex);
      this._pointEntries.set(id, { index, vertex, pointObject });
    }

    this._updateLineGeometry();
    this._updatePointHandleScales();
    this._updateQuadPickGeometry();
    this._applyDisplayOptions();
    this._updateSelectionVisuals();
    this._attachControlToSelection();
  }

  _updateLineGeometry() {
    if (!this._lineObject || !this._cageData) return;
    const points = Array.isArray(this._cageData.points) ? this._cageData.points : [];
    const positions = [];
    for (let i = 0; i < this._lineSegments.length; i++) {
      const seg = this._lineSegments[i];
      const a = points[seg[0]];
      const b = points[seg[1]];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);

      const linePick = this._linePickObjects[i];
      if (linePick?.geometry) {
        const pickAttr = new THREE.Float32BufferAttribute([
          a[0], a[1], a[2],
          b[0], b[1], b[2],
        ], 3);
        linePick.geometry.setAttribute("position", pickAttr);
        linePick.geometry.computeBoundingSphere();
      }
    }
    this._lineObject.geometry.setPositions(positions);
    this._lineObject.geometry.computeBoundingSphere?.();
    this._lineObject.computeLineDistances?.();
  }

  _buildSurfaceQuadPickDefs(dimsInput) {
    const dims = sanitizeCageDivisions(dimsInput);
    const [nx, ny, nz] = dims;
    const out = [];

    const pushQuad = (name, faceDim, faceValue, coordsA, coordsB, coordsC, coordsD) => {
      const ia = cageIndex(coordsA[0], coordsA[1], coordsA[2], dims);
      const ib = cageIndex(coordsB[0], coordsB[1], coordsB[2], dims);
      const ic = cageIndex(coordsC[0], coordsC[1], coordsC[2], dims);
      const id = cageIndex(coordsD[0], coordsD[1], coordsD[2], dims);
      if (ia < 0 || ib < 0 || ic < 0 || id < 0) return;
      const ids = Array.from(new Set([
        cageIdFromIndex(ia, dims),
        cageIdFromIndex(ib, dims),
        cageIdFromIndex(ic, dims),
        cageIdFromIndex(id, dims),
      ].filter(Boolean)));
      if (ids.length !== 4) return;
      out.push({
        key: name,
        name,
        faceDim,
        faceValue,
        corners: [ia, ib, ic, id],
        ids,
      });
    };

    for (const i of [0, nx - 1]) {
      for (let j = 0; j < ny - 1; j++) {
        for (let k = 0; k < nz - 1; k++) {
          pushQuad(
            `quad:i=${i}:j=${j}:k=${k}`,
            0,
            i,
            [i, j, k],
            [i, j + 1, k],
            [i, j + 1, k + 1],
            [i, j, k + 1],
          );
        }
      }
    }

    for (const j of [0, ny - 1]) {
      for (let i = 0; i < nx - 1; i++) {
        for (let k = 0; k < nz - 1; k++) {
          pushQuad(
            `quad:j=${j}:i=${i}:k=${k}`,
            1,
            j,
            [i, j, k],
            [i + 1, j, k],
            [i + 1, j, k + 1],
            [i, j, k + 1],
          );
        }
      }
    }

    for (const k of [0, nz - 1]) {
      for (let i = 0; i < nx - 1; i++) {
        for (let j = 0; j < ny - 1; j++) {
          pushQuad(
            `quad:k=${k}:i=${i}:j=${j}`,
            2,
            k,
            [i, j, k],
            [i + 1, j, k],
            [i + 1, j + 1, k],
            [i, j + 1, k],
          );
        }
      }
    }

    return out;
  }

  _updateQuadPickGeometry() {
    if (!this._cageData || !this._quadPickObjects.length) return;
    const points = Array.isArray(this._cageData.points) ? this._cageData.points : [];
    const dims = sanitizeCageDivisions(this._cageData.dims);
    const radiusFromCornerIndex = (cornerIndex) => {
      const id = cageIdFromIndex(cornerIndex, dims);
      const entry = id ? this._pointEntries.get(id) : null;
      const scale = Number(entry?.pointObject?.scale?.x);
      const factor = (Number.isFinite(scale) && scale > 0) ? scale : 1;
      const radius = (Number.isFinite(this._pointGeometryRadius) && this._pointGeometryRadius > 0)
        ? (this._pointGeometryRadius * factor)
        : CAGE_POINT_RADIUS_MIN;
      return Math.max(1e-6, radius);
    };
    const dist = (p, q) => {
      const dx = (Number(p?.[0]) || 0) - (Number(q?.[0]) || 0);
      const dy = (Number(p?.[1]) || 0) - (Number(q?.[1]) || 0);
      const dz = (Number(p?.[2]) || 0) - (Number(q?.[2]) || 0);
      return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    };
    for (const quad of this._quadPickObjects) {
      const mesh = quad?.mesh;
      const corners = Array.isArray(quad?.corners) ? quad.corners : null;
      if (!mesh?.geometry || !corners || corners.length !== 4) continue;
      const a = points[corners[0]];
      const b = points[corners[1]];
      const c = points[corners[2]];
      const d = points[corners[3]];
      if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c) || !Array.isArray(d)) continue;
      const desiredInset = CAGE_QUAD_INSET_BALL_RADII * (
        radiusFromCornerIndex(corners[0])
        + radiusFromCornerIndex(corners[1])
        + radiusFromCornerIndex(corners[2])
        + radiusFromCornerIndex(corners[3])
      ) * 0.25;
      const uLen = Math.max(1e-6, 0.5 * (dist(a, b) + dist(d, c)));
      const vLen = Math.max(1e-6, 0.5 * (dist(a, d) + dist(b, c)));
      const insetU = Math.max(CAGE_QUAD_MIN_INSET_UV, Math.min(CAGE_QUAD_MAX_INSET_UV, desiredInset / uLen));
      const insetV = Math.max(CAGE_QUAD_MIN_INSET_UV, Math.min(CAGE_QUAD_MAX_INSET_UV, desiredInset / vLen));
      const uvLoop = buildRoundedInsetUvLoop(insetU, insetV);
      const sample = (u, v) => {
        const iu = 1 - u;
        const iv = 1 - v;
        return [
          a[0] * iu * iv + b[0] * u * iv + c[0] * u * v + d[0] * iu * v,
          a[1] * iu * iv + b[1] * u * iv + c[1] * u * v + d[1] * iu * v,
          a[2] * iu * iv + b[2] * u * iv + c[2] * u * v + d[2] * iu * v,
        ];
      };
      const center = sample(0.5, 0.5);
      const positions = [];
      for (let i = 0; i < uvLoop.length; i++) {
        const uv0 = uvLoop[i];
        const uv1 = uvLoop[(i + 1) % uvLoop.length];
        const p0 = sample(uv0[0], uv0[1]);
        const p1 = sample(uv1[0], uv1[1]);
        positions.push(
          center[0], center[1], center[2],
          p0[0], p0[1], p0[2],
          p1[0], p1[1], p1[2],
        );
      }
      mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      mesh.geometry.computeBoundingSphere();
    }
  }

  _coordsFromPointId(id) {
    if (typeof id !== "string") return null;
    const match = /^cp:(\d+):(\d+):(\d+)$/.exec(id.trim());
    if (!match) return null;
    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
  }

  _getSymmetryCenter() {
    const baseMin = this._cageData?.baseBounds?.min;
    const baseMax = this._cageData?.baseBounds?.max;
    if (Array.isArray(baseMin) && Array.isArray(baseMax) && baseMin.length >= 3 && baseMax.length >= 3) {
      const x0 = Number(baseMin[0]);
      const y0 = Number(baseMin[1]);
      const z0 = Number(baseMin[2]);
      const x1 = Number(baseMax[0]);
      const y1 = Number(baseMax[1]);
      const z1 = Number(baseMax[2]);
      if ([x0, y0, z0, x1, y1, z1].every((value) => Number.isFinite(value))) {
        return [
          0.5 * (x0 + x1),
          0.5 * (y0 + y1),
          0.5 * (z0 + z1),
        ];
      }
    }

    const points = Array.isArray(this._cageData?.points) ? this._cageData.points : [];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
      if (!Array.isArray(point) || point.length < 3) continue;
      const x = Number(point[0]);
      const y = Number(point[1]);
      const z = Number(point[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (![minX, minY, minZ, maxX, maxY, maxZ].every((value) => Number.isFinite(value))) return null;
    return [
      0.5 * (minX + maxX),
      0.5 * (minY + maxY),
      0.5 * (minZ + maxZ),
    ];
  }

  _getSymmetryCenterPlaneMidIndices(dimsInput, symFlagsInput = null) {
    const dims = sanitizeCageDivisions(dimsInput || this._cageData?.dims);
    const symFlags = (Array.isArray(symFlagsInput) && symFlagsInput.length >= 3)
      ? symFlagsInput
      : [
        !!this._displayOptions?.symmetryX,
        !!this._displayOptions?.symmetryY,
        !!this._displayOptions?.symmetryZ,
      ];
    const mids = [null, null, null];
    for (let axis = 0; axis < 3; axis++) {
      if (!symFlags[axis]) continue;
      const count = Number(dims[axis]);
      if (!Number.isInteger(count) || count < 1 || (count % 2) !== 1) continue;
      mids[axis] = Math.floor((count - 1) * 0.5);
    }
    return mids;
  }

  _clampPositionToSymmetryCenterPlane(coordsInput, position, center, centerPlaneMids) {
    if (!Array.isArray(coordsInput) || coordsInput.length < 3) return;
    if (!position || !Array.isArray(center) || center.length < 3) return;
    if (!Array.isArray(centerPlaneMids) || centerPlaneMids.length < 3) return;
    if (centerPlaneMids[0] != null && coordsInput[0] === centerPlaneMids[0] && Number.isFinite(center[0])) {
      position.x = center[0];
    }
    if (centerPlaneMids[1] != null && coordsInput[1] === centerPlaneMids[1] && Number.isFinite(center[1])) {
      position.y = center[1];
    }
    if (centerPlaneMids[2] != null && coordsInput[2] === centerPlaneMids[2] && Number.isFinite(center[2])) {
      position.z = center[2];
    }
  }

  _applySymmetryFromSources(sourceIdsInput, options = {}) {
    const symX = !!this._displayOptions?.symmetryX;
    const symY = !!this._displayOptions?.symmetryY;
    const symZ = !!this._displayOptions?.symmetryZ;
    if ((!symX && !symY && !symZ) || !this._cageData) return;
    const dims = sanitizeCageDivisions(options?.dims || this._cageData.dims);
    const [nx, ny, nz] = dims;
    const center = (Array.isArray(options?.center) && options.center.length >= 3)
      ? options.center
      : this._getSymmetryCenter();
    if (!center) return;
    const centerPlaneMids = (Array.isArray(options?.centerPlaneMids) && options.centerPlaneMids.length >= 3)
      ? options.centerPlaneMids
      : this._getSymmetryCenterPlaneMidIndices(dims, [symX, symY, symZ]);

    const sourceIds = Array.isArray(sourceIdsInput) ? sourceIdsInput : Array.from(sourceIdsInput || []);
    const sourceIdSet = new Set();
    const sources = [];
    for (const rawId of sourceIds) {
      const id = String(rawId ?? "");
      if (!id || sourceIdSet.has(id)) continue;
      const coords = this._coordsFromPointId(id);
      const entry = this._pointEntries.get(id);
      if (!coords || !entry?.vertex) continue;
      const sourcePos = {
        x: entry.vertex.position.x,
        y: entry.vertex.position.y,
        z: entry.vertex.position.z,
      };
      this._clampPositionToSymmetryCenterPlane(coords, sourcePos, center, centerPlaneMids);
      const sourceNeedsSnap = (
        Math.abs(sourcePos.x - entry.vertex.position.x) > 1e-9
        || Math.abs(sourcePos.y - entry.vertex.position.y) > 1e-9
        || Math.abs(sourcePos.z - entry.vertex.position.z) > 1e-9
      );
      if (sourceNeedsSnap) {
        entry.vertex.position.set(sourcePos.x, sourcePos.y, sourcePos.z);
        const sourcePoint = this._cageData.points?.[entry.index];
        if (Array.isArray(sourcePoint) && sourcePoint.length >= 3) {
          sourcePoint[0] = sourcePos.x;
          sourcePoint[1] = sourcePos.y;
          sourcePoint[2] = sourcePos.z;
        }
      }
      sourceIdSet.add(id);
      sources.push({
        id,
        coords,
        pos: [sourcePos.x, sourcePos.y, sourcePos.z],
      });
    }
    if (!sources.length) return;

    for (const source of sources) {
      const i = source.coords[0];
      const j = source.coords[1];
      const k = source.coords[2];
      const mi = nx - 1 - i;
      const mj = ny - 1 - j;
      const mk = nz - 1 - k;

      const iOpts = (!symX || mi === i)
        ? [{ value: i, reflect: false }]
        : [{ value: i, reflect: false }, { value: mi, reflect: true }];
      const jOpts = (!symY || mj === j)
        ? [{ value: j, reflect: false }]
        : [{ value: j, reflect: false }, { value: mj, reflect: true }];
      const kOpts = (!symZ || mk === k)
        ? [{ value: k, reflect: false }]
        : [{ value: k, reflect: false }, { value: mk, reflect: true }];

      for (const io of iOpts) {
        for (const jo of jOpts) {
          for (const ko of kOpts) {
            if (!io.reflect && !jo.reflect && !ko.reflect) continue;
            const targetIndex = cageIndex(io.value, jo.value, ko.value, dims);
            if (targetIndex < 0) continue;
            const targetId = cageIdFromIndex(targetIndex, dims);
            if (!targetId || sourceIdSet.has(targetId)) continue;

            const targetEntry = this._pointEntries.get(targetId);
            if (!targetEntry?.vertex) continue;
            let tx = io.reflect ? ((2 * center[0]) - source.pos[0]) : source.pos[0];
            let ty = jo.reflect ? ((2 * center[1]) - source.pos[1]) : source.pos[1];
            let tz = ko.reflect ? ((2 * center[2]) - source.pos[2]) : source.pos[2];
            if (centerPlaneMids[0] != null && io.value === centerPlaneMids[0]) tx = center[0];
            if (centerPlaneMids[1] != null && jo.value === centerPlaneMids[1]) ty = center[1];
            if (centerPlaneMids[2] != null && ko.value === centerPlaneMids[2]) tz = center[2];

            targetEntry.vertex.position.set(tx, ty, tz);
            const targetPoint = this._cageData.points?.[targetEntry.index];
            if (Array.isArray(targetPoint) && targetPoint.length >= 3) {
              targetPoint[0] = tx;
              targetPoint[1] = ty;
              targetPoint[2] = tz;
            }
          }
        }
      }
    }
  }

  _worldUnitsPerPixelAt(worldPoint) {
    const camera = this.viewer?.camera;
    const renderer = this.viewer?.renderer;
    if (!camera || !renderer) return 0;

    let width = 0;
    let height = 0;
    try {
      renderer.getSize?.(_tmpRendererSize);
      width = _tmpRendererSize.x || renderer.domElement?.clientWidth || 0;
      height = _tmpRendererSize.y || renderer.domElement?.clientHeight || 0;
    } catch {
      width = renderer?.domElement?.clientWidth || 0;
      height = renderer?.domElement?.clientHeight || 0;
    }
    if (!width || !height) return 0;

    if (camera.isOrthographicCamera) {
      const zoom = (typeof camera.zoom === "number" && camera.zoom > 0) ? camera.zoom : 1;
      const wppX = (camera.right - camera.left) / (width * zoom);
      const wppY = (camera.top - camera.bottom) / (height * zoom);
      return Math.max(wppX, wppY);
    }

    if (camera.isPerspectiveCamera) {
      let distance = 0;
      if (worldPoint?.isVector3) {
        try {
          camera.getWorldDirection(_tmpCameraDir);
          _tmpCameraToPoint.copy(worldPoint).sub(camera.position);
          distance = Math.abs(_tmpCameraToPoint.dot(_tmpCameraDir));
        } catch {
          distance = 0;
        }
      }
      if (!Number.isFinite(distance) || distance <= 1e-6) {
        try {
          if (typeof this.viewer?._worldPerPixel === "function") {
            return this.viewer._worldPerPixel(camera, width, height);
          }
        } catch { }
        distance = camera?.position?.length?.() || 1;
      }
      const fovRad = ((camera.fov || 50) * Math.PI) / 180;
      const zoom = (typeof camera.zoom === "number" && camera.zoom > 0) ? camera.zoom : 1;
      return (2 * Math.tan(fovRad / 2) * distance) / (height * zoom);
    }

    try {
      if (typeof this.viewer?._worldPerPixel === "function") {
        return this.viewer._worldPerPixel(camera, width, height);
      }
    } catch { }
    return 0;
  }

  _updatePointHandleScales() {
    if (!this._pointEntries.size || !this._pointGeometryRadius) return;
    for (const entry of this._pointEntries.values()) {
      const handle = entry?.pointObject;
      const vertex = entry?.vertex;
      if (!handle || !vertex) continue;
      try { vertex.getWorldPosition(_tmpWorldPoint); } catch { _tmpWorldPoint.copy(vertex.position); }
      const wpp = this._worldUnitsPerPixelAt(_tmpWorldPoint);
      if (!Number.isFinite(wpp) || wpp <= 0) continue;
      const targetRadius = Math.max(1e-6, wpp * CAGE_POINT_SCREEN_RADIUS_PX);
      const nextScale = targetRadius / this._pointGeometryRadius;
      if (!Number.isFinite(nextScale) || nextScale <= 0) continue;
      handle.scale.setScalar(nextScale);
    }
  }

  _updateSelectionVisuals() {
    const showPoints = !!this._displayOptions.showControlPoints;
    for (const [id, entry] of this._pointEntries.entries()) {
      if (!entry?.vertex) continue;
      const isSelected = this._selectedIds.has(id);
      entry.vertex.selected = isSelected;
      entry.vertex.visible = showPoints;
      const pointObject = entry.pointObject || entry.vertex._point;
      if (pointObject && this._pointMaterials) {
        const nextMat = isSelected ? this._pointMaterials.selected : this._pointMaterials.base;
        pointObject.material = nextMat;
        pointObject.userData = pointObject.userData || {};
        // Keep hover restore in sync with selected/unselected cage-ball state.
        pointObject.userData.__baseMaterial = nextMat;
        pointObject.visible = showPoints;
      }
    }
  }

  _attachControlToSelection() {
    if (!this._control) return;
    if (!this._selectedId || !this._displayOptions.showControlPoints) {
      this._control.detach?.();
      this._control.enabled = false;
      this._control.visible = false;
      this._clearMultiMoveAnchor();
      return;
    }
    const entry = this._pointEntries.get(this._selectedId);
    if (!entry?.vertex) {
      this._clearMultiMoveAnchor();
      return;
    }
    this._control.attach(entry.vertex);
    this._control.enabled = true;
    this._control.visible = true;
    this._captureMultiMoveAnchorFromEntry(this._selectedId, entry);
    this._control.update?.();
  }

  _applyDisplayOptions() {
    const options = normalizeDisplayOptions(this._displayOptions);
    this._displayOptions = options;

    if (this._lineObject) {
      this._lineObject.visible = !!options.showEdges;
      try { this._lineObject.material?.color?.setHex?.(options.cageColor); } catch { }
    }
    for (const linePick of this._linePickObjects) {
      if (!linePick) continue;
      linePick.visible = !!options.showEdges;
    }
    for (const quad of this._quadPickObjects) {
      if (!quad?.mesh) continue;
      quad.mesh.visible = !!options.showEdges;
      const baseMat = quad.mesh?.userData?.__baseMaterial || quad.mesh?.material;
      if (baseMat) {
        try { baseMat.color?.setHex?.(options.cageColor); } catch { }
        try { baseMat.opacity = CAGE_QUAD_IDLE_OPACITY; } catch { }
        quad.mesh.userData = quad.mesh.userData || {};
        quad.mesh.userData.__baseMaterial = baseMat;
      }
      const hoverMat = quad.mesh?.userData?.__hoverMaterial || null;
      if (hoverMat) {
        try { hoverMat.color?.setHex?.(options.cageColor); } catch { }
        try { hoverMat.opacity = CAGE_QUAD_FILL_OPACITY; } catch { }
      }
    }

    this._ensurePointMaterials();
    this._updateSelectionVisuals();

    if (this._control) {
      this._control.showX = !!options.allowX;
      this._control.showY = !!options.allowY;
      this._control.showZ = !!options.allowZ;
      this._attachControlToSelection();
      this._control.update?.();
    }
  }

  _handleControlChange() {
    if (!this._selectedId || !this._cageData) return;
    const entry = this._pointEntries.get(this._selectedId);
    if (!entry?.vertex) return;
    const dims = sanitizeCageDivisions(this._cageData.dims);
    const symmetryCenter = this._getSymmetryCenter();
    const centerPlaneMids = symmetryCenter
      ? this._getSymmetryCenterPlaneMidIndices(dims)
      : [null, null, null];
    const pointIndex = entry.index;
    const point = this._cageData.points?.[pointIndex];
    if (!Array.isArray(point)) return;

    const pos = entry.vertex.position;
    const quat = entry.vertex.quaternion;
    this._clampPositionToSymmetryCenterPlane(
      this._coordsFromPointId(this._selectedId),
      pos,
      symmetryCenter,
      centerPlaneMids,
    );
    entry.vertex.position.copy(pos);
    point[0] = pos.x;
    point[1] = pos.y;
    point[2] = pos.z;
    const movedIds = new Set([this._selectedId]);

    if (this._selectedIds.size > 1 && this._multiMoveAnchor.valid && this._multiMoveAnchor.id === this._selectedId) {
      const prevMat = new THREE.Matrix4().compose(
        new THREE.Vector3(
          this._multiMoveAnchor.x,
          this._multiMoveAnchor.y,
          this._multiMoveAnchor.z,
        ),
        new THREE.Quaternion(
          this._multiMoveAnchor.qx,
          this._multiMoveAnchor.qy,
          this._multiMoveAnchor.qz,
          this._multiMoveAnchor.qw,
        ),
        new THREE.Vector3(1, 1, 1),
      );
      const currMat = new THREE.Matrix4().compose(
        new THREE.Vector3(pos.x, pos.y, pos.z),
        new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
        new THREE.Vector3(1, 1, 1),
      );
      const invPrev = new THREE.Matrix4().copy(prevMat);
      invPrev.invert();
      const deltaMat = new THREE.Matrix4().multiplyMatrices(currMat, invPrev);

      for (const id of this._selectedIds) {
        if (id === this._selectedId) continue;
        const selectedEntry = this._pointEntries.get(id);
        if (!selectedEntry?.vertex) continue;
        const selectedPoint = this._cageData.points?.[selectedEntry.index];
        if (!Array.isArray(selectedPoint)) continue;
        const selectedPos = selectedEntry.vertex.position.clone().applyMatrix4(deltaMat);
        this._clampPositionToSymmetryCenterPlane(
          this._coordsFromPointId(id),
          selectedPos,
          symmetryCenter,
          centerPlaneMids,
        );
        selectedEntry.vertex.position.copy(selectedPos);
        selectedPoint[0] = selectedPos.x;
        selectedPoint[1] = selectedPos.y;
        selectedPoint[2] = selectedPos.z;
        movedIds.add(id);
      }
    }
    const symmetryApplyOptions = {
      dims,
    };
    if (symmetryCenter) {
      symmetryApplyOptions.center = symmetryCenter;
      symmetryApplyOptions.centerPlaneMids = centerPlaneMids;
    }
    this._applySymmetryFromSources(movedIds, symmetryApplyOptions);
    this._captureMultiMoveAnchorFromEntry(this._selectedId, entry);
    this._updateLineGeometry();
    this._updatePointHandleScales();
    this._updateQuadPickGeometry();
    this._notifyCageChange("transform");
    this._renderOnce();
  }

  _handleControlDragging(isDragging) {
    try {
      if (this.viewer?.controls) this.viewer.controls.enabled = !isDragging;
    } catch { }
    if (!this._selectedId) return;
    const entry = this._pointEntries.get(this._selectedId);
    if (!entry?.vertex) return;
    this._captureMultiMoveAnchorFromEntry(this._selectedId, entry);
  }

  _notifyCageChange(reason) {
    try {
      this._onCageChange(this.getCageData(), reason, {
        selectedId: this._selectedId,
        selectedIds: this.getSelectedIds(),
      });
    } catch { }
  }

  _notifySelectionChange(id) {
    try {
      this._onSelectionChange(id, {
        selectedIds: this.getSelectedIds(),
        count: this._selectedIds.size,
      });
    } catch { }
  }

  _renderOnce() {
    try { this.viewer?.render?.(); } catch { }
  }

  // Called by viewer pick logic while spline mode is active.
  onClick() {
    // no-op; individual points own click handlers.
  }
}

import * as THREE from "three";
import { BREP } from "../../BREP/BREP.js";
import { CombinedTransformControls } from "../../UI/controls/CombinedTransformControls.js";
import {
  buildCageSegments,
  cageIdFromIndex,
  cloneCageData,
  sanitizeCageDivisions,
} from "./nurbsFaceSolidUtils.js";

const noop = () => { };
const CAGE_POINT_BASE_COLOR = 0x6dff3d;
const CAGE_POINT_SELECTED_COLOR = 0xff5a00;

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
    this._pointEntries = new Map();
    this._lineSegments = [];
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

  activate(initialCage, options = {}) {
    if (!this.viewer?.scene || !this.viewer?.camera || !this.viewer?.renderer) return false;
    if (this._active) this.dispose();
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
    this._selectedIds.clear();
    this._selectedId = null;
    this._clearMultiMoveAnchor();
    this._active = false;
    this._disposePointMaterials();
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
    const { silent = false, additive = false, toggle = false } = options;
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
    const { primaryId = null, silent = false } = options;
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
      this.selectObject(null, { silent });
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
    if (this._pointMaterials?.base && this._pointMaterials?.selected) return;
    const base = new THREE.PointsMaterial({
      color: CAGE_POINT_BASE_COLOR,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    const selected = new THREE.PointsMaterial({
      color: CAGE_POINT_SELECTED_COLOR,
      size: 10,
      sizeAttenuation: false,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    this._pointMaterials = { base, selected };
  }

  _disposePointMaterials() {
    const mats = this._pointMaterials;
    if (!mats) return;
    try { mats.base?.dispose?.(); } catch { }
    try { mats.selected?.dispose?.(); } catch { }
    this._pointMaterials = null;
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
    control.showX = true;
    control.showY = true;
    control.showZ = true;
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
    }
    this._pointEntries.clear();

    const dims = sanitizeCageDivisions(this._cageData.dims);
    this._lineSegments = buildCageSegments(dims);

    const lineGeom = new THREE.BufferGeometry();
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x70d6ff,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
    });
    this._lineObject = new THREE.LineSegments(lineGeom, lineMat);
    this._lineObject.renderOrder = 10000;
    this._lineObject.userData = this._lineObject.userData || {};
    this._lineObject.userData.excludeFromFit = true;
    this._previewGroup.add(this._lineObject);

    const points = Array.isArray(this._cageData.points) ? this._cageData.points : [];
    for (let index = 0; index < points.length; index++) {
      const id = cageIdFromIndex(index, dims);
      if (!id) continue;
      const point = points[index];
      const vertex = new BREP.Vertex(point, { name: `NurbsCageVertex:${id}` });
      vertex.userData = vertex.userData || {};
      vertex.userData.nurbsCagePointId = id;
      vertex.userData.isSplineVertex = true;
      vertex.onClick = (event) => {
        const additive = !!(event?.shiftKey || event?.ctrlKey || event?.metaKey);
        this.selectObject(id, {
          additive,
          toggle: additive,
        });
      };

      if (vertex._point) {
        vertex._point.userData = vertex._point.userData || {};
        vertex._point.userData.nurbsCagePointId = id;
        vertex._point.userData.isSplineVertex = true;
        vertex._point.onClick = vertex.onClick;
        vertex._point.renderOrder = 10002;
        if (this._pointMaterials?.base) vertex._point.material = this._pointMaterials.base;
      }

      this._previewGroup.add(vertex);
      this._pointEntries.set(id, { index, vertex });
    }

    this._updateLineGeometry();
    this._updateSelectionVisuals();
    this._attachControlToSelection();
  }

  _updateLineGeometry() {
    if (!this._lineObject || !this._cageData) return;
    const points = Array.isArray(this._cageData.points) ? this._cageData.points : [];
    const positions = [];
    for (const seg of this._lineSegments) {
      const a = points[seg[0]];
      const b = points[seg[1]];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const attr = new THREE.Float32BufferAttribute(positions, 3);
    this._lineObject.geometry.setAttribute("position", attr);
    this._lineObject.geometry.computeBoundingSphere();
  }

  _updateSelectionVisuals() {
    for (const [id, entry] of this._pointEntries.entries()) {
      if (!entry?.vertex) continue;
      const isSelected = this._selectedIds.has(id);
      entry.vertex.selected = isSelected;
      const pointObject = entry.vertex._point;
      if (pointObject && this._pointMaterials) {
        pointObject.material = isSelected ? this._pointMaterials.selected : this._pointMaterials.base;
      }
    }
  }

  _attachControlToSelection() {
    if (!this._control) return;
    if (!this._selectedId) {
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

  _handleControlChange() {
    if (!this._selectedId || !this._cageData) return;
    const entry = this._pointEntries.get(this._selectedId);
    if (!entry?.vertex) return;
    const pointIndex = entry.index;
    const point = this._cageData.points?.[pointIndex];
    if (!Array.isArray(point)) return;

    const pos = entry.vertex.position;
    const quat = entry.vertex.quaternion;
    point[0] = pos.x;
    point[1] = pos.y;
    point[2] = pos.z;

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
        selectedEntry.vertex.position.copy(selectedPos);
        selectedPoint[0] = selectedPos.x;
        selectedPoint[1] = selectedPos.y;
        selectedPoint[2] = selectedPos.z;
      }
    }
    this._captureMultiMoveAnchorFromEntry(this._selectedId, entry);
    this._updateLineGeometry();
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

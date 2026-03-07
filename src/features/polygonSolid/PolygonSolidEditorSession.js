import * as THREE from "three";
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from "three/examples/jsm/Addons.js";
import { BREP } from "../../BREP/BREP.js";
import { CombinedTransformControls } from "../../UI/controls/CombinedTransformControls.js";

const noop = () => { };

const POINT_SELECTED_COLOR = 0xff5a00;
const POINT_RADIUS_MIN = 0.08;
const POINT_RADIUS_SCALE = 0.012;
const POINT_SCREEN_RADIUS_PX = 8;
const TRI_IDLE_OPACITY = 0;
const TRI_HOVER_OPACITY = 0.14;
const TRI_SELECTED_OPACITY = 0.22;
const EDGE_LINE_WIDTH_PX = 2.5;

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
  meshColor: 0x70d6ff,
});

function normalizeColor(value, fallback = DEFAULT_DISPLAY_OPTIONS.meshColor) {
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
  return {
    showEdges: typeof raw?.showEdges === "boolean" ? raw.showEdges : DEFAULT_DISPLAY_OPTIONS.showEdges,
    showControlPoints: typeof raw?.showControlPoints === "boolean"
      ? raw.showControlPoints
      : DEFAULT_DISPLAY_OPTIONS.showControlPoints,
    allowX: typeof raw?.allowX === "boolean" ? raw.allowX : DEFAULT_DISPLAY_OPTIONS.allowX,
    allowY: typeof raw?.allowY === "boolean" ? raw.allowY : DEFAULT_DISPLAY_OPTIONS.allowY,
    allowZ: typeof raw?.allowZ === "boolean" ? raw.allowZ : DEFAULT_DISPLAY_OPTIONS.allowZ,
    meshColor: normalizeColor(raw?.meshColor, DEFAULT_DISPLAY_OPTIONS.meshColor),
  };
}

function cloneMeshData(meshData) {
  try {
    return JSON.parse(JSON.stringify(meshData || null));
  } catch {
    return null;
  }
}

function normalizeVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function normalizeTriangle(value, vertexCount) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const a = Number(value[0]) | 0;
  const b = Number(value[1]) | 0;
  const c = Number(value[2]) | 0;
  if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) return null;
  if (a === b || b === c || c === a) return null;
  return [a, b, c];
}

function normalizeFaceToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "SURFACE";
  return raw.replace(/[^A-Za-z0-9:_-]/g, "_") || "SURFACE";
}

function normalizeMeshData(rawMeshData) {
  const raw = (rawMeshData && typeof rawMeshData === "object") ? rawMeshData : null;
  const verticesIn = Array.isArray(raw?.vertices) ? raw.vertices : [];
  const trianglesIn = Array.isArray(raw?.triangles) ? raw.triangles : [];
  const tokensIn = Array.isArray(raw?.triangleFaceTokens) ? raw.triangleFaceTokens : [];

  const vertices = [];
  for (const v of verticesIn) {
    const normalized = normalizeVec3(v);
    if (!normalized) continue;
    vertices.push(normalized);
  }

  const triangles = [];
  const triangleFaceTokens = [];
  for (let i = 0; i < trianglesIn.length; i++) {
    const tri = normalizeTriangle(trianglesIn[i], vertices.length);
    if (!tri) continue;
    triangles.push(tri);
    triangleFaceTokens.push(normalizeFaceToken(tokensIn[i]));
  }

  return {
    vertices,
    triangles,
    triangleFaceTokens,
    sourceSignature: raw?.sourceSignature ? String(raw.sourceSignature) : null,
  };
}

function pointIdFromIndex(index) {
  return `pv:${Number(index) | 0}`;
}

function pointIndexFromId(id) {
  if (typeof id !== "string") return -1;
  const match = /^pv:(\d+)$/.exec(id.trim());
  if (!match) return -1;
  return Number(match[1]) | 0;
}

function edgeKeyFromIndices(indexA, indexB) {
  const a = Number(indexA) | 0;
  const b = Number(indexB) | 0;
  if (a <= b) return `${a}:${b}`;
  return `${b}:${a}`;
}

function splitMeshEdgeByKey(meshDataInput, edgeKey) {
  const meshData = normalizeMeshData(meshDataInput);
  const vertices = meshData.vertices.map((v) => [v[0], v[1], v[2]]);
  const triangles = meshData.triangles.map((t) => [t[0], t[1], t[2]]);
  const tokens = meshData.triangleFaceTokens.map((token) => normalizeFaceToken(token));
  const parts = String(edgeKey || "").split(":");
  if (parts.length !== 2) return null;
  const edgeA = Number(parts[0]) | 0;
  const edgeB = Number(parts[1]) | 0;
  if (edgeA < 0 || edgeB < 0 || edgeA >= vertices.length || edgeB >= vertices.length || edgeA === edgeB) return null;

  const va = vertices[edgeA];
  const vb = vertices[edgeB];
  if (!Array.isArray(va) || !Array.isArray(vb)) return null;

  const midpoint = [
    0.5 * (va[0] + vb[0]),
    0.5 * (va[1] + vb[1]),
    0.5 * (va[2] + vb[2]),
  ];
  const midpointIndex = vertices.length;
  vertices.push(midpoint);

  const nextTriangles = [];
  const nextTokens = [];
  let splitCount = 0;

  for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
    const tri = triangles[triIndex];
    const token = normalizeFaceToken(tokens[triIndex]);
    const [a, b, c] = tri;
    const hasA = (a === edgeA || b === edgeA || c === edgeA);
    const hasB = (a === edgeB || b === edgeB || c === edgeB);
    if (!hasA || !hasB) {
      nextTriangles.push([a, b, c]);
      nextTokens.push(token);
      continue;
    }

    const third = [a, b, c].find((v) => v !== edgeA && v !== edgeB);
    if (!Number.isInteger(third)) continue;
    splitCount += 1;

    const indexA = tri.indexOf(edgeA);
    const indexB = tri.indexOf(edgeB);
    const edgeForward = ((indexA + 1) % 3) === indexB;

    if (edgeForward) {
      nextTriangles.push([edgeA, midpointIndex, third]);
      nextTriangles.push([midpointIndex, edgeB, third]);
    } else {
      nextTriangles.push([edgeB, midpointIndex, third]);
      nextTriangles.push([midpointIndex, edgeA, third]);
    }
    nextTokens.push(token, token);
  }

  if (!splitCount) return null;

  return normalizeMeshData({
    vertices,
    triangles: nextTriangles,
    triangleFaceTokens: nextTokens,
    sourceSignature: meshData.sourceSignature,
  });
}

function deleteMeshVerticesByIds(meshDataInput, pointIdsInput) {
  const meshData = normalizeMeshData(meshDataInput);
  const removeIds = Array.isArray(pointIdsInput) ? pointIdsInput : Array.from(pointIdsInput || []);
  const removeSet = new Set();
  for (const rawId of removeIds) {
    const index = pointIndexFromId(String(rawId ?? ""));
    if (index >= 0 && index < meshData.vertices.length) removeSet.add(index);
  }
  if (!removeSet.size) return null;

  const keptTriangles = [];
  const keptTokens = [];
  const usedVertices = new Set();

  for (let triIndex = 0; triIndex < meshData.triangles.length; triIndex++) {
    const tri = meshData.triangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    if (removeSet.has(tri[0]) || removeSet.has(tri[1]) || removeSet.has(tri[2])) continue;
    keptTriangles.push([tri[0], tri[1], tri[2]]);
    keptTokens.push(normalizeFaceToken(meshData.triangleFaceTokens[triIndex]));
    usedVertices.add(tri[0]);
    usedVertices.add(tri[1]);
    usedVertices.add(tri[2]);
  }

  const remap = new Map();
  const nextVertices = [];
  for (let oldIndex = 0; oldIndex < meshData.vertices.length; oldIndex++) {
    if (removeSet.has(oldIndex)) continue;
    if (!usedVertices.has(oldIndex)) continue;
    const mapped = nextVertices.length;
    remap.set(oldIndex, mapped);
    const v = meshData.vertices[oldIndex];
    nextVertices.push([v[0], v[1], v[2]]);
  }

  const nextTriangles = [];
  const nextTokens = [];
  for (let triIndex = 0; triIndex < keptTriangles.length; triIndex++) {
    const tri = keptTriangles[triIndex];
    const a = remap.get(tri[0]);
    const b = remap.get(tri[1]);
    const c = remap.get(tri[2]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) continue;
    if (a === b || b === c || c === a) continue;
    nextTriangles.push([a, b, c]);
    nextTokens.push(keptTokens[triIndex] || "SURFACE");
  }

  return normalizeMeshData({
    vertices: nextVertices,
    triangles: nextTriangles,
    triangleFaceTokens: nextTokens,
    sourceSignature: meshData.sourceSignature,
  });
}

function buildMeshTopology(meshDataInput) {
  const meshData = normalizeMeshData(meshDataInput);
  const vertexCount = meshData.vertices.length;
  const edgeMap = new Map();
  const tokenToTriangleIndices = new Map();
  const vertexNeighbors = Array.from({ length: vertexCount }, () => new Set());

  const addTokenTriangle = (token, triIndex) => {
    const key = normalizeFaceToken(token);
    if (!tokenToTriangleIndices.has(key)) tokenToTriangleIndices.set(key, []);
    tokenToTriangleIndices.get(key).push(triIndex);
  };

  for (let triIndex = 0; triIndex < meshData.triangles.length; triIndex++) {
    const tri = meshData.triangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const token = normalizeFaceToken(meshData.triangleFaceTokens[triIndex]);
    addTokenTriangle(token, triIndex);
    const triEdges = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (const [va, vb] of triEdges) {
      const key = edgeKeyFromIndices(va, vb);
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = {
          key,
          a: Math.min(va, vb),
          b: Math.max(va, vb),
          triangles: [],
        };
        edgeMap.set(key, edge);
      }
      edge.triangles.push(triIndex);
      if (vertexNeighbors[va]) vertexNeighbors[va].add(vb);
      if (vertexNeighbors[vb]) vertexNeighbors[vb].add(va);
    }
  }

  const triangleEntriesByKey = new Map();
  const triangleTokenToKeys = new Map();
  const triangleTokenToPointIds = new Map();

  for (let triIndex = 0; triIndex < meshData.triangles.length; triIndex++) {
    const tri = meshData.triangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const token = normalizeFaceToken(meshData.triangleFaceTokens[triIndex]);
    const key = `tri:${triIndex}`;
    const pointIds = [
      pointIdFromIndex(tri[0]),
      pointIdFromIndex(tri[1]),
      pointIdFromIndex(tri[2]),
    ];
    triangleEntriesByKey.set(key, {
      key,
      triIndex,
      indices: [tri[0], tri[1], tri[2]],
      token,
      pointIds,
    });

    if (!triangleTokenToKeys.has(token)) triangleTokenToKeys.set(token, []);
    triangleTokenToKeys.get(token).push(key);

    if (!triangleTokenToPointIds.has(token)) triangleTokenToPointIds.set(token, new Set());
    const pointSet = triangleTokenToPointIds.get(token);
    for (const id of pointIds) pointSet.add(id);
  }

  const buildConnectedVertexIds = (seedA, seedB) => {
    const visited = new Set();
    const stack = [seedA, seedB];
    while (stack.length) {
      const next = stack.pop();
      if (!Number.isInteger(next) || next < 0 || next >= vertexCount) continue;
      if (visited.has(next)) continue;
      visited.add(next);
      for (const nb of vertexNeighbors[next] || []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    return Array.from(visited).map((index) => pointIdFromIndex(index));
  };

  const edgeEntriesByKey = new Map();
  const edgeEntries = [];
  for (const edge of edgeMap.values()) {
    const adjacentPointSet = new Set([pointIdFromIndex(edge.a), pointIdFromIndex(edge.b)]);
    let token = "SURFACE";
    if (edge.triangles.length) {
      const firstTri = edge.triangles[0];
      token = normalizeFaceToken(meshData.triangleFaceTokens[firstTri]);
    }
    for (const triIndex of edge.triangles) {
      const tri = meshData.triangles[triIndex];
      if (!Array.isArray(tri) || tri.length < 3) continue;
      adjacentPointSet.add(pointIdFromIndex(tri[0]));
      adjacentPointSet.add(pointIdFromIndex(tri[1]));
      adjacentPointSet.add(pointIdFromIndex(tri[2]));
    }

    const loopPointSet = triangleTokenToPointIds.get(token);
    const loopPointIds = (loopPointSet && loopPointSet.size)
      ? Array.from(loopPointSet)
      : buildConnectedVertexIds(edge.a, edge.b);

    const entry = {
      key: edge.key,
      a: edge.a,
      b: edge.b,
      triangles: [...edge.triangles],
      token,
      pointIds: [pointIdFromIndex(edge.a), pointIdFromIndex(edge.b)],
      adjacentPointIds: Array.from(adjacentPointSet),
      loopPointIds,
    };

    edgeEntriesByKey.set(entry.key, entry);
    edgeEntries.push(entry);
  }

  return {
    edgeEntries,
    edgeEntriesByKey,
    triangleEntriesByKey,
    triangleTokenToKeys,
  };
}

export class PolygonSolidEditorSession {
  constructor(viewer, featureID, options = {}) {
    this.viewer = viewer || null;
    this.featureID = featureID != null ? String(featureID) : null;
    this.options = options || {};

    this._featureRef = options.featureRef || null;
    this._onMeshChange = (typeof options.onMeshChange === "function")
      ? options.onMeshChange
      : noop;
    this._onSelectionChange = (typeof options.onSelectionChange === "function")
      ? options.onSelectionChange
      : noop;

    this._meshData = normalizeMeshData(options.meshData || null);
    this._active = false;

    this._selectedId = null;
    this._selectedIds = new Set();
    this._selectedEdgeKeys = new Set();
    this._selectedTriangleKeys = new Set();
    this._edgeClickStageByKey = new Map();
    this._triangleClickStageByKey = new Map();

    this._pointEntries = new Map();
    this._edgeEntriesByKey = new Map();
    this._triangleEntriesByKey = new Map();
    this._triangleTokenToKeys = new Map();

    this._lineSegments = [];
    this._edgePickObjectsByKey = new Map();
    this._trianglePickObjectsByKey = new Map();

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

  setFeatureRef(featureRef) {
    this._featureRef = featureRef || null;
  }

  getMeshData() {
    return cloneMeshData(this._meshData);
  }

  getSelectedId() {
    return this._selectedId;
  }

  getSelectedIds() {
    return Array.from(this._selectedIds);
  }

  getSelectedEdgeKeys() {
    return Array.from(this._selectedEdgeKeys);
  }

  getSelectedTriangleKeys() {
    return Array.from(this._selectedTriangleKeys);
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

  activate(initialMeshData, options = {}) {
    if (!this.viewer?.scene || !this.viewer?.camera || !this.viewer?.renderer) return false;
    if (this._active) this.dispose();

    this._displayOptions = normalizeDisplayOptions({
      ...this._displayOptions,
      ...(options?.displayOptions || {}),
    });
    this._featureRef = options.featureRef ?? this._featureRef ?? null;
    this._meshData = normalizeMeshData(cloneMeshData(initialMeshData) || this._meshData);

    this._ensurePointMaterials();
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
    this._edgeEntriesByKey.clear();
    this._triangleEntriesByKey.clear();
    this._triangleTokenToKeys.clear();
    this._edgePickObjectsByKey.clear();
    this._trianglePickObjectsByKey.clear();

    this._lineSegments = [];
    this._selectedIds.clear();
    this._selectedId = null;
    this._clearEdgeSelectionState();
    this._clearTriangleSelectionState();
    this._clearMultiMoveAnchor();

    this._active = false;
    this._disposePointMaterials();
    this._disposePointGeometry();
  }

  _firstPointId() {
    const count = Array.isArray(this._meshData?.vertices) ? this._meshData.vertices.length : 0;
    if (count <= 0) return null;
    return pointIdFromIndex(0);
  }

  _clearEdgeSelectionState() {
    this._selectedEdgeKeys.clear();
    this._edgeClickStageByKey.clear();
  }

  _clearTriangleSelectionState() {
    this._selectedTriangleKeys.clear();
    this._triangleClickStageByKey.clear();
  }

  setMeshData(meshData, options = {}) {
    const { preserveSelection = true, silent = false } = options;
    this._meshData = normalizeMeshData(meshData);

    const previous = preserveSelection ? this.getSelectedIds() : [];
    const previousPrimary = preserveSelection ? this._selectedId : null;

    this._rebuildGeometry();

    if (preserveSelection && previous.length) {
      const valid = previous.filter((id) => this._pointEntries.has(id));
      if (valid.length) {
        this.selectObjects(valid, {
          primaryId: valid.includes(previousPrimary) ? previousPrimary : valid[valid.length - 1],
          silent: true,
          preserveEdgeSelection: true,
          preserveTriangleSelection: true,
        });
      } else {
        this.selectObject(null, { silent: true, preserveEdgeSelection: true, preserveTriangleSelection: true });
      }
    } else if (!preserveSelection) {
      this.selectObject(null, { silent: true, preserveEdgeSelection: true, preserveTriangleSelection: true });
    }

    if (!silent) this._notifyMeshChange("manual");
    this._renderOnce();
  }

  splitSelectedEdges() {
    const keys = Array.from(this._selectedEdgeKeys);
    if (!keys.length) return false;

    let nextMesh = normalizeMeshData(this._meshData);
    let changed = false;

    for (const key of keys) {
      const split = splitMeshEdgeByKey(nextMesh, key);
      if (!split) continue;
      nextMesh = split;
      changed = true;
    }

    if (!changed) return false;

    this._meshData = nextMesh;
    this._clearEdgeSelectionState();
    this._clearTriangleSelectionState();
    this._selectedIds.clear();
    this._selectedId = null;
    this._rebuildGeometry();
    this._notifySelectionChange(this._selectedId);
    this._notifyMeshChange("split-edge");
    this._renderOnce();
    return true;
  }

  deleteSelectedPoints() {
    if (!this._selectedIds.size) return false;
    const result = deleteMeshVerticesByIds(this._meshData, this._selectedIds);
    if (!result) return false;

    this._meshData = result;
    this._clearEdgeSelectionState();
    this._clearTriangleSelectionState();
    this._selectedIds.clear();
    this._selectedId = null;
    this._rebuildGeometry();
    this._notifySelectionChange(this._selectedId);
    this._notifyMeshChange("delete-points");
    this._renderOnce();
    return true;
  }

  selectObject(id, options = {}) {
    const {
      silent = false,
      additive = false,
      toggle = false,
      preserveEdgeSelection = false,
      preserveTriangleSelection = false,
    } = options;

    if (!preserveEdgeSelection) this._clearEdgeSelectionState();
    if (!preserveTriangleSelection) this._clearTriangleSelectionState();

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
      preserveEdgeSelection = false,
      preserveTriangleSelection = false,
    } = options;

    if (!preserveEdgeSelection) this._clearEdgeSelectionState();
    if (!preserveTriangleSelection) this._clearTriangleSelectionState();

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
        preserveEdgeSelection,
        preserveTriangleSelection,
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

  _collectPointIdsForSelectedTriangles() {
    const out = new Set();
    for (const key of this._selectedTriangleKeys) {
      const meta = this._triangleEntriesByKey.get(String(key));
      if (!meta?.pointIds?.length) continue;
      for (const id of meta.pointIds) out.add(id);
    }
    return out;
  }

  _handleEdgeClick(edgeKey) {
    const key = String(edgeKey || "");
    const meta = this._edgeEntriesByKey.get(key);
    if (!meta) return;

    const primaryId = meta.pointIds[meta.pointIds.length - 1] || this._selectedId;
    const hasEdge = this._selectedEdgeKeys.has(key);

    if (!hasEdge) {
      this._selectedEdgeKeys.add(key);
      this._edgeClickStageByKey.set(key, 1);
      const next = new Set(this._selectedIds);
      for (const id of meta.pointIds) next.add(id);
      this.selectObjects(Array.from(next), {
        primaryId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
      return;
    }

    const stage = this._edgeClickStageByKey.get(key) || 1;
    if (stage === 1) {
      this._edgeClickStageByKey.set(key, 2);
      const next = new Set(this._selectedIds);
      for (const id of meta.adjacentPointIds) next.add(id);
      this.selectObjects(Array.from(next), {
        primaryId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
      return;
    }

    if (stage === 2) {
      this._edgeClickStageByKey.set(key, 3);
      const next = new Set(this._selectedIds);
      for (const id of meta.loopPointIds) next.add(id);
      this.selectObjects(Array.from(next), {
        primaryId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
      return;
    }

    this._clearEdgeSelectionState();
    const requiredTrianglePoints = this._collectPointIdsForSelectedTriangles();
    if (requiredTrianglePoints.size) {
      this.selectObjects(Array.from(requiredTrianglePoints), {
        primaryId: this._selectedId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
    } else {
      this.selectObject(null, {
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
    }
  }

  _handleTriangleClick(triangleKey) {
    const key = String(triangleKey || "");
    const meta = this._triangleEntriesByKey.get(key);
    if (!meta) return;

    const primaryId = meta.pointIds[meta.pointIds.length - 1] || this._selectedId;
    const hasTriangle = this._selectedTriangleKeys.has(key);

    if (!hasTriangle) {
      this._selectedTriangleKeys.add(key);
      this._triangleClickStageByKey.set(key, 1);
      const next = new Set(this._selectedIds);
      for (const id of meta.pointIds) next.add(id);
      this.selectObjects(Array.from(next), {
        primaryId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
      return;
    }

    const stage = this._triangleClickStageByKey.get(key) || 1;
    if (stage === 1) {
      const groupKeys = this._triangleTokenToKeys.get(meta.token) || [key];
      for (const groupKey of groupKeys) {
        this._selectedTriangleKeys.add(groupKey);
        this._triangleClickStageByKey.set(groupKey, 2);
      }
      const next = new Set(this._selectedIds);
      for (const groupKey of groupKeys) {
        const groupMeta = this._triangleEntriesByKey.get(groupKey);
        if (!groupMeta?.pointIds?.length) continue;
        for (const id of groupMeta.pointIds) next.add(id);
      }
      this.selectObjects(Array.from(next), {
        primaryId,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
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
        color: this._displayOptions.meshColor,
        transparent: true,
        opacity: 1,
        roughness: 0.35,
        metalness: 0.05,
        depthTest: false,
        depthWrite: false,
      });
      const selected = new THREE.MeshStandardMaterial({
        color: POINT_SELECTED_COLOR,
        transparent: true,
        opacity: 1,
        roughness: 0.25,
        metalness: 0.1,
        depthTest: false,
        depthWrite: false,
      });
      this._pointMaterials = { base, selected };
    }
    try { this._pointMaterials.base.color.setHex(this._displayOptions.meshColor); } catch { }
  }

  _disposePointMaterials() {
    const mats = this._pointMaterials;
    if (!mats) return;
    try { mats.base?.dispose?.(); } catch { }
    try { mats.selected?.dispose?.(); } catch { }
    this._pointMaterials = null;
  }

  _ensurePointGeometry(radius) {
    const safeRadius = Math.max(POINT_RADIUS_MIN, Number(radius) || POINT_RADIUS_MIN);
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

    const name = `PolygonSolidEditorPreview:${this.featureID || ""}`;
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
        try { child.userData?.__selectedMaterial?.dispose?.(); } catch { }
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
    control.name = `PolygonSolidControl:${this.featureID || ""}`;
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
      this._updateTrianglePickGeometry();
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
    if (!this._previewGroup) return;

    while (this._previewGroup.children.length) {
      const child = this._previewGroup.children[0];
      this._previewGroup.remove(child);
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
      try { child.userData?.__hoverMaterial?.dispose?.(); } catch { }
      try { child.userData?.__selectedMaterial?.dispose?.(); } catch { }
    }

    this._pointEntries.clear();
    this._edgeEntriesByKey.clear();
    this._triangleEntriesByKey.clear();
    this._triangleTokenToKeys.clear();
    this._edgePickObjectsByKey.clear();
    this._trianglePickObjectsByKey.clear();

    this._lineSegments = [];
    this._clearEdgeSelectionState();
    this._clearTriangleSelectionState();

    const topology = buildMeshTopology(this._meshData);
    this._edgeEntriesByKey = topology.edgeEntriesByKey;
    this._triangleEntriesByKey = topology.triangleEntriesByKey;
    this._triangleTokenToKeys = topology.triangleTokenToKeys;

    for (const edge of topology.edgeEntries) {
      this._lineSegments.push([edge.a, edge.b]);
    }

    const lineGeom = new LineSegmentsGeometry();
    const lineMat = new LineMaterial({
      color: this._displayOptions.meshColor,
      linewidth: EDGE_LINE_WIDTH_PX,
      transparent: true,
      opacity: 0.82,
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

    for (const edge of topology.edgeEntries) {
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
        color: this._displayOptions.meshColor,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const linePickSelectedMat = new THREE.LineBasicMaterial({
        color: POINT_SELECTED_COLOR,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });

      const linePick = new THREE.LineSegments(linePickGeom, linePickMat);
      linePick.type = "EDGE";
      linePick.userData = linePick.userData || {};
      linePick.userData.excludeFromFit = true;
      linePick.userData.isSplineWeight = true;
      linePick.userData.nurbsCageSegment = [edge.a, edge.b];
      linePick.userData.nurbsCageSegmentKey = edge.key;
      linePick.userData.__idleMaterial = linePickMat;
      linePick.userData.__baseMaterial = linePickMat;
      linePick.userData.__hoverMaterial = linePickHoverMat;
      linePick.userData.__selectedMaterial = linePickSelectedMat;
      linePick.renderOrder = 10001;
      linePick.onClick = () => this._handleEdgeClick(edge.key);

      this._edgePickObjectsByKey.set(edge.key, linePick);
      this._previewGroup.add(linePick);
    }

    for (const triMeta of this._triangleEntriesByKey.values()) {
      const triGeom = new THREE.BufferGeometry();
      triGeom.setAttribute("position", new THREE.Float32BufferAttribute([], 3));

      const triMat = new THREE.MeshBasicMaterial({
        color: this._displayOptions.meshColor,
        transparent: true,
        opacity: TRI_IDLE_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const triHoverMat = new THREE.MeshBasicMaterial({
        color: this._displayOptions.meshColor,
        transparent: true,
        opacity: TRI_HOVER_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const triSelectedMat = new THREE.MeshBasicMaterial({
        color: POINT_SELECTED_COLOR,
        transparent: true,
        opacity: TRI_SELECTED_OPACITY,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const triPick = new THREE.Mesh(triGeom, triMat);
      triPick.type = "FACE";
      triPick.userData = triPick.userData || {};
      triPick.userData.excludeFromFit = true;
      triPick.userData.isSplineWeight = true;
      triPick.userData.nurbsCageQuad = triMeta.key;
      triPick.userData.nurbsCageQuadKey = triMeta.key;
      triPick.userData.__idleMaterial = triMat;
      triPick.userData.__baseMaterial = triMat;
      triPick.userData.__hoverMaterial = triHoverMat;
      triPick.userData.__selectedMaterial = triSelectedMat;
      triPick.renderOrder = 9998;
      triPick.onClick = () => this._handleTriangleClick(triMeta.key);

      this._trianglePickObjectsByKey.set(triMeta.key, triPick);
      this._previewGroup.add(triPick);
    }

    const points = Array.isArray(this._meshData?.vertices) ? this._meshData.vertices : [];
    const bounds = new THREE.Box3();
    for (const point of points) {
      if (!Array.isArray(point) || point.length < 3) continue;
      bounds.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]));
    }
    const ext = bounds.getSize(new THREE.Vector3());
    const maxExtent = Math.max(ext.x || 0, ext.y || 0, ext.z || 0, 1);
    this._ensurePointGeometry(maxExtent * POINT_RADIUS_SCALE);

    for (let index = 0; index < points.length; index++) {
      const id = pointIdFromIndex(index);
      const point = points[index];
      const vertex = new BREP.Vertex(point, { name: `PolygonVertex:${id}` });
      vertex.userData = vertex.userData || {};
      vertex.userData.polygonPointId = id;
      vertex.userData.isSplineVertex = true;
      vertex.onClick = () => {
        this.selectObject(id, {
          additive: true,
          toggle: true,
          preserveEdgeSelection: true,
          preserveTriangleSelection: true,
        });
      };

      let pointObject = null;
      if (vertex._point) {
        vertex._point.userData = vertex._point.userData || {};
        vertex._point.userData.polygonPointId = id;
        vertex._point.userData.isSplineVertex = true;
        vertex._point.onClick = vertex.onClick;
        vertex._point.renderOrder = 10002;
        vertex._point.visible = false;
      }

      if (this._pointGeometry && this._pointMaterials?.base) {
        const handle = new THREE.Mesh(this._pointGeometry, this._pointMaterials.base);
        handle.userData = handle.userData || {};
        handle.userData.polygonPointId = id;
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
    this._updateTrianglePickGeometry();
    this._applyDisplayOptions();
    this._updateSelectionVisuals();
    this._attachControlToSelection();
  }

  _updateLineGeometry() {
    if (!this._lineObject) return;
    const points = Array.isArray(this._meshData?.vertices) ? this._meshData.vertices : [];
    const positions = [];

    for (const [aIndex, bIndex] of this._lineSegments) {
      const a = points[aIndex];
      const b = points[bIndex];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);

      const key = edgeKeyFromIndices(aIndex, bIndex);
      const linePick = this._edgePickObjectsByKey.get(key);
      if (linePick?.geometry) {
        const attr = new THREE.Float32BufferAttribute([
          a[0], a[1], a[2],
          b[0], b[1], b[2],
        ], 3);
        linePick.geometry.setAttribute("position", attr);
        linePick.geometry.computeBoundingSphere();
      }
    }

    this._lineObject.geometry.setPositions(positions);
    this._lineObject.geometry.computeBoundingSphere?.();
    this._lineObject.computeLineDistances?.();
  }

  _updateTrianglePickGeometry() {
    const points = Array.isArray(this._meshData?.vertices) ? this._meshData.vertices : [];
    for (const [key, triPick] of this._trianglePickObjectsByKey.entries()) {
      const meta = this._triangleEntriesByKey.get(key);
      if (!meta || !triPick?.geometry) continue;
      const a = points[meta.indices[0]];
      const b = points[meta.indices[1]];
      const c = points[meta.indices[2]];
      if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) continue;

      triPick.geometry.setAttribute("position", new THREE.Float32BufferAttribute([
        a[0], a[1], a[2],
        b[0], b[1], b[2],
        c[0], c[1], c[2],
      ], 3));
      triPick.geometry.computeBoundingSphere();
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
      const targetRadius = Math.max(1e-6, wpp * POINT_SCREEN_RADIUS_PX);
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
        pointObject.userData.__baseMaterial = nextMat;
        pointObject.visible = showPoints;
      }
    }

    for (const [key, edgePick] of this._edgePickObjectsByKey.entries()) {
      if (!edgePick) continue;
      const selectedMat = edgePick.userData?.__selectedMaterial || edgePick.material;
      const idleMat = edgePick.userData?.__idleMaterial || edgePick.material;
      if (this._selectedEdgeKeys.has(key)) {
        edgePick.material = selectedMat;
        edgePick.userData = edgePick.userData || {};
        edgePick.userData.__baseMaterial = selectedMat;
      } else {
        edgePick.material = idleMat;
        edgePick.userData = edgePick.userData || {};
        edgePick.userData.__baseMaterial = idleMat;
      }
    }

    for (const [key, triPick] of this._trianglePickObjectsByKey.entries()) {
      if (!triPick) continue;
      const selectedMat = triPick.userData?.__selectedMaterial || triPick.material;
      const idleMat = triPick.userData?.__idleMaterial || triPick.material;
      if (this._selectedTriangleKeys.has(key)) {
        triPick.material = selectedMat;
        triPick.userData = triPick.userData || {};
        triPick.userData.__baseMaterial = selectedMat;
      } else {
        triPick.material = idleMat;
        triPick.userData = triPick.userData || {};
        triPick.userData.__baseMaterial = idleMat;
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
      try { this._lineObject.material?.color?.setHex?.(options.meshColor); } catch { }
    }

    for (const edgePick of this._edgePickObjectsByKey.values()) {
      if (!edgePick) continue;
      edgePick.visible = !!options.showEdges;
      const idleMat = edgePick.userData?.__idleMaterial || null;
      const hoverMat = edgePick.userData?.__hoverMaterial || null;
      if (idleMat) {
        try { idleMat.color?.setHex?.(options.meshColor); } catch { }
        edgePick.userData.__idleMaterial = idleMat;
      }
      if (hoverMat) {
        try { hoverMat.color?.setHex?.(options.meshColor); } catch { }
      }
    }

    for (const triPick of this._trianglePickObjectsByKey.values()) {
      if (!triPick) continue;
      triPick.visible = !!options.showEdges;
      const idleMat = triPick.userData?.__idleMaterial || null;
      const hoverMat = triPick.userData?.__hoverMaterial || null;
      if (idleMat) {
        try { idleMat.color?.setHex?.(options.meshColor); } catch { }
        try { idleMat.opacity = TRI_IDLE_OPACITY; } catch { }
        triPick.userData.__idleMaterial = idleMat;
      }
      if (hoverMat) {
        try { hoverMat.color?.setHex?.(options.meshColor); } catch { }
        try { hoverMat.opacity = TRI_HOVER_OPACITY; } catch { }
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
    if (!this._selectedId || !this._meshData) return;
    const entry = this._pointEntries.get(this._selectedId);
    if (!entry?.vertex) return;

    const pointIndex = entry.index;
    const point = this._meshData.vertices?.[pointIndex];
    if (!Array.isArray(point)) return;

    const pos = entry.vertex.position;
    const quat = entry.vertex.quaternion;
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
        const selectedPoint = this._meshData.vertices?.[selectedEntry.index];
        if (!Array.isArray(selectedPoint)) continue;
        const selectedPos = selectedEntry.vertex.position.clone().applyMatrix4(deltaMat);
        selectedEntry.vertex.position.copy(selectedPos);
        selectedPoint[0] = selectedPos.x;
        selectedPoint[1] = selectedPos.y;
        selectedPoint[2] = selectedPos.z;
        movedIds.add(id);
      }
    }

    this._captureMultiMoveAnchorFromEntry(this._selectedId, entry);
    this._updateLineGeometry();
    this._updatePointHandleScales();
    this._updateTrianglePickGeometry();
    this._notifyMeshChange("transform", {
      movedIds: Array.from(movedIds),
    });
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

  _notifyMeshChange(reason, details = {}) {
    try {
      this._onMeshChange(this.getMeshData(), reason, {
        selectedId: this._selectedId,
        selectedIds: this.getSelectedIds(),
        selectedEdgeKeys: this.getSelectedEdgeKeys(),
        selectedTriangleKeys: this.getSelectedTriangleKeys(),
        ...(details || {}),
      });
    } catch { }
  }

  _notifySelectionChange(id) {
    try {
      this._onSelectionChange(id, {
        selectedIds: this.getSelectedIds(),
        selectedEdgeKeys: this.getSelectedEdgeKeys(),
        selectedTriangleKeys: this.getSelectedTriangleKeys(),
        count: this._selectedIds.size,
      });
    } catch { }
  }

  _renderOnce() {
    try { this.viewer?.render?.(); } catch { }
  }

  // Called by viewer pick logic while spline mode is active.
  onClick() {
    // no-op; individual point/edge/face handles own click handlers.
  }
}

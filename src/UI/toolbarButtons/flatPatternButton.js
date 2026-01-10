import JSZip from 'jszip';
import * as THREE from 'three';
import { Line2, LineGeometry, LineMaterial } from 'three/examples/jsm/Addons.js';
import { FloatingWindow } from '../FloatingWindow.js';
import { CADmaterials } from '../CADmaterials.js';
import {
  buildSheetMetalFlatPatternDebugSteps,
  buildSheetMetalFlatPatternDxfs,
  buildSheetMetalFlatPatternSvgs,
} from '../../exporters/sheetMetalFlatPattern.js';
import { resolveSheetMetalFaceType } from '../../features/sheetMetal/sheetMetalFaceTypes.js';

const PANEL_KEY = '__flatPatternUnfoldPanel';
const BASE_LINE_WIDTH_SCALE = 4;
const ACTIVE_LINE_WIDTH_SCALE = 2.5;

function _collectSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const solids = [];
  scene.traverse((o) => {
    if (!o || !o.visible) return;
    if (o.type === 'SOLID' && typeof o.toSTL === 'function') solids.push(o);
  });
  const selected = solids.filter((o) => o.selected === true);
  return selected.length ? selected : solids;
}

function _safeName(raw, fallback = 'flat') {
  const s = String(raw || '').trim();
  return (s.length ? s : fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

function _download(filename, data, mime = 'application/octet-stream') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

function _fitBoxToView(viewer, box, margin = 1.1) {
  const camera = viewer?.camera;
  const controls = viewer?.controls;
  if (!viewer || !camera || !controls || !box || box.isEmpty()) return;
  try { camera.updateMatrixWorld(true); } catch { }

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const inv = new THREE.Matrix4().copy(camera.matrixWorld).invert();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of corners) {
    p.applyMatrix4(inv);
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const camWidth = Math.max(1e-6, (maxX - minX));
  const camHeight = Math.max(1e-6, (maxY - minY));
  const size = (typeof viewer._getContainerSize === 'function')
    ? viewer._getContainerSize()
    : { width: window.innerWidth || 1, height: window.innerHeight || 1 };
  const aspect = Math.max(1e-6, size.width / size.height);
  const v = viewer.viewSize || 1;
  const halfW = camWidth / 2 * Math.max(1, margin);
  const halfH = camHeight / 2 * Math.max(1, margin);
  const maxZoomByHeight = v / halfH;
  const maxZoomByWidth = (v * aspect) / halfW;
  const targetZoom = Math.min(maxZoomByHeight, maxZoomByWidth);
  const currentZoom = camera.zoom || 1;
  const sizeFactor = Math.max(1e-6, targetZoom / currentZoom);
  const center = box.getCenter(new THREE.Vector3());

  try { controls.updateMatrixState && controls.updateMatrixState(); } catch { }
  controls.focus(center, sizeFactor);
  try { controls.update && controls.update(); } catch { }
  try { viewer.render && viewer.render(); } catch { }
}

function _ensureFlatPatternUnfoldStyles() {
  if (document.getElementById('flat-unfold-styles')) return;
  const style = document.createElement('style');
  style.id = 'flat-unfold-styles';
  style.textContent = `
      .flat-unfold-content { display:flex; flex-direction:column; gap:10px; padding:10px; width:100%; height:100%; min-height:0; box-sizing:border-box; color:#e5e7eb; }
      .flat-unfold-row { display:flex; align-items:center; gap:8px; }
      .flat-unfold-label { min-width:70px; font-size:12px; color:#9aa0aa; }
      .flat-unfold-select, .flat-unfold-input { flex:1 1 auto; padding:6px 8px; border-radius:8px; background:#0b0e14; color:#e5e7eb; border:1px solid #374151; outline:none; font-size:12px; }
      .flat-unfold-select:focus, .flat-unfold-input:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
      .flat-unfold-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
      .flat-unfold-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .flat-unfold-btn:active { transform: translateY(1px); }
      .flat-unfold-slider { width: 100%; }
      .flat-unfold-step { font-size:12px; color:#cbd5f5; }
      .flat-unfold-hint { font-size:12px; color:#9aa0aa; }
      .flat-unfold-detail { flex:1 1 auto; min-height:0; font-size:12px; color:#cfd6e4; background:rgba(8,10,14,.55); border:1px solid #1f2937; border-radius:8px; padding:8px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; line-height:1.35; }
      .flat-unfold-empty { font-size:12px; color:#9aa0aa; }
    `;
  document.head.appendChild(style);
}

class FlatPatternUnfoldPanel {
  constructor(viewer) {
    this.viewer = viewer;
    this.window = null;
    this.root = null;
    this.content = null;
    this.edgeGroup = null;
    this.flatOffset = { x: 0, y: 0, z: 0 };
    this.flatBasis = null;
    this.hiddenObjects = [];
    this.hiddenSet = new Set();
    this.aFaces = [];
    this.aEdgeNames = new Set();
    this.aEdgeLabels = new Set();
    this.aFaceLabels = new Set();
    this.activeSolid = null;
    this.highlightMesh = null;
    this.highlightMaterial = null;
    this.entries = [];
    this.activeIndex = 0;
    this.stepIndex = 0;
    this.steps = [];
    this.playTimer = null;
    this.playDelay = 650;
    this._solids = [];
    this.ui = {};
  }

  toggle() {
    if (this.root && this.root.style.display !== 'none') this.close();
    else this.open();
  }

  open() {
    this._ensureWindow();
    if (!this.root) return;
    this.root.style.display = 'flex';
    this._refreshData();
  }

  close() {
    this._stopPlayback();
    this._restoreScene();
    if (this.root) {
      try { this.root.style.display = 'none'; } catch { }
    }
  }

  _ensureWindow() {
    if (this.root) return;
    _ensureFlatPatternUnfoldStyles();
    const fw = new FloatingWindow({
      title: 'Flat Pattern Unfold',
      width: 520,
      height: 260,
      right: 16,
      top: 64,
      shaded: false,
      onClose: () => this.close(),
    });

    const btnExport = document.createElement('button');
    btnExport.className = 'flat-unfold-btn';
    btnExport.textContent = 'Export SVG';
    btnExport.addEventListener('click', () => this._exportSvg());

    const btnExportDxf = document.createElement('button');
    btnExportDxf.className = 'flat-unfold-btn';
    btnExportDxf.textContent = 'Export DXF';
    btnExportDxf.addEventListener('click', () => this._exportDxf());

    const content = document.createElement('div');
    content.className = 'flat-unfold-content';
    fw.content.appendChild(content);
    this.window = fw;
    this.root = fw.root;
    this.content = content;

    const rowSolid = document.createElement('div');
    rowSolid.className = 'flat-unfold-row';
    const labSolid = document.createElement('div');
    labSolid.className = 'flat-unfold-label';
    labSolid.textContent = 'Solid';
    const selSolid = document.createElement('select');
    selSolid.className = 'flat-unfold-select';
    selSolid.addEventListener('change', () => this._setActiveIndex(selSolid.selectedIndex));
    rowSolid.appendChild(labSolid);
    rowSolid.appendChild(selSolid);

    const rowActions = document.createElement('div');
    rowActions.className = 'flat-unfold-row';
    rowActions.appendChild(btnExport);
    rowActions.appendChild(btnExportDxf);

    const empty = document.createElement('div');
    empty.className = 'flat-unfold-empty';
    empty.textContent = '';

    content.appendChild(rowSolid);
    content.appendChild(rowActions);
    content.appendChild(empty);

    this.ui = {
      selSolid,
      empty,
    };
  }

  _refreshData() {
    const solids = _collectSolids(this.viewer);
    this._solids = solids;
    this.entries = [];
    this.steps = [];
    this.stepIndex = 0;
    this.activeIndex = 0;
    this._stopPlayback();
    this._clearEdgeGroup();
    this._clearHighlightedFace();
    this._clearVisualizationMeshes();
    this.aFaces = [];
    this.aEdgeNames = new Set();
    this.aEdgeLabels = new Set();
    this.aFaceLabels = new Set();
    this.flatBasis = null;
    this.activeSolid = null;

    const sel = this.ui.selSolid;
    if (sel) sel.innerHTML = '';

    if (!solids.length) {
      this._setEmpty('No solids in the scene.');
      return;
    }

    const metadataManager = this.viewer?.partHistory?.metadataManager || null;
    const entries = buildSheetMetalFlatPatternDebugSteps(solids, { metadataManager });
    this.entries = entries;

    if (!entries.length) {
      this._setEmpty('No sheet metal flat pattern steps available.');
      return;
    }

    // Display visualization meshes for A faces
    this._renderVisualizationMeshes(entries);

    for (const entry of entries) {
      const opt = document.createElement('option');
      opt.value = entry.name || 'SHEET';
      opt.textContent = entry.name || 'SHEET';
      sel.appendChild(opt);
    }

    this._setEmpty('');
    this._setActiveIndex(0);
  }

  _setActiveIndex(idx) {
    const next = Math.max(0, Math.min(idx, this.entries.length - 1));
    this.activeIndex = next;
    const entry = this.entries[next];
    this.steps = [];
    this.stepIndex = 0;
    if (this.ui.selSolid) this.ui.selSolid.selectedIndex = next;
    const solid = (entry && Number.isFinite(entry.sourceIndex))
      ? this._solids?.[entry.sourceIndex]
      : this._solids?.[next];
    this._clearHighlightedFace();
    this.activeSolid = solid || null;
    this._applyFaceVisibility(solid);
    this._resolveFlatBasis(solid);
    if (!this.aFaces.length) {
      this._setEmpty('No A-side faces found for preview.');
    } else {
      this._setEmpty('');
    }
    this._clearEdgeGroup();
    this._clearHighlightedFace();
  }

  _setStepIndex(idx) {
    const max = Math.max(0, this.steps.length - 1);
    const next = Math.max(0, Math.min(idx, max));
    this.stepIndex = next;
    this._renderStep(false);
  }

  _resolveFlatBasis(solid) {
    this.flatBasis = null;
    try { solid?.updateMatrixWorld?.(true); } catch { }
    if (this.steps && this.steps.length) {
      for (const step of this.steps) {
        const raw = step?.baseBasis || step?.basis;
        if (raw && raw.origin && raw.uAxis && raw.vAxis) {
          this.flatBasis = this._basisToWorld(raw, solid);
          if (this.flatBasis) return;
        }
      }
    }
    const baseFace = this._pickLargestFace(solid);
    if (baseFace) this.flatBasis = this._buildFaceBasis(baseFace);
  }

  _basisToWorld(raw, solid) {
    if (!raw || !raw.origin || !raw.uAxis || !raw.vAxis) return null;
    const originLocal = new THREE.Vector3(raw.origin[0], raw.origin[1], raw.origin[2]);
    const uLocal = new THREE.Vector3(raw.uAxis[0], raw.uAxis[1], raw.uAxis[2]);
    const vLocal = new THREE.Vector3(raw.vAxis[0], raw.vAxis[1], raw.vAxis[2]);
    const originWorld = originLocal.clone();
    if (solid?.matrixWorld) {
      originWorld.applyMatrix4(solid.matrixWorld);
    }
    const uWorld = uLocal.clone().add(originLocal);
    const vWorld = vLocal.clone().add(originLocal);
    if (solid?.matrixWorld) {
      uWorld.applyMatrix4(solid.matrixWorld);
      vWorld.applyMatrix4(solid.matrixWorld);
    }
    uWorld.sub(originWorld);
    vWorld.sub(originWorld);
    if (uWorld.lengthSq() < 1e-12 || vWorld.lengthSq() < 1e-12) return null;
    const normal = new THREE.Vector3().crossVectors(uWorld, vWorld).normalize();
    return { origin: originWorld, uAxis: uWorld, vAxis: vWorld, normal };
  }

  _pickLargestFace(solid) {
    const faces = [];
    try { solid?.updateMatrixWorld?.(true); } catch { }
    if (solid && typeof solid.traverse === 'function') {
      solid.traverse((obj) => {
        if (obj && obj.type === 'FACE') faces.push(obj);
      });
    }
    if (!faces.length) return null;
    let bestPlanarA = null;
    let bestPlanarAArea = -Infinity;
    let bestA = null;
    let bestAArea = -Infinity;
    let bestPlanar = null;
    let bestPlanarArea = -Infinity;
    let best = null;
    let bestArea = -Infinity;
    for (const face of faces) {
      if (!face) continue;
      const area = this._faceArea(face);
      const faceType = resolveSheetMetalFaceType(face);
      if (area > bestArea) { best = face; bestArea = area; }
      let meta = null;
      try { meta = typeof face.getMetadata === 'function' ? face.getMetadata() : null; } catch { meta = null; }
      const isCyl = meta?.type === 'cylindrical';
      if (faceType === 'A') {
        if (!isCyl && area > bestPlanarAArea) {
          bestPlanarA = face;
          bestPlanarAArea = area;
        } else if (area > bestAArea) {
          bestA = face;
          bestAArea = area;
        }
      }
      if (!isCyl && area > bestPlanarArea) {
        bestPlanar = face;
        bestPlanarArea = area;
      }
    }
    return bestPlanarA || bestA || bestPlanar || best;
  }

  _applyBasisToMesh(mesh, basis) {
    if (!mesh || !basis || !basis.origin || !basis.uAxis || !basis.vAxis) return;
    const uAxis = basis.uAxis.clone().normalize();
    const vAxis = basis.vAxis.clone().normalize();
    const normal = basis.normal
      ? basis.normal.clone().normalize()
      : new THREE.Vector3().crossVectors(uAxis, vAxis).normalize();
    const rot = new THREE.Matrix4().makeBasis(uAxis, vAxis, normal);
    const quat = new THREE.Quaternion().setFromRotationMatrix(rot);
    mesh.position.copy(basis.origin);
    mesh.quaternion.copy(quat);
    mesh.scale.set(1, 1, 1);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  }

  _computeFlatMeshEdgeAngle(meshData, opts = {}) {
    const positions = meshData?.positions;
    const triangles = meshData?.triangles;
    if (!positions || !triangles || !triangles.length) return 0;
    const targetFaceId = Number.isFinite(opts.faceId) ? opts.faceId : null;
    const faceIds = Array.isArray(meshData?.triangleFaceIds) ? meshData.triangleFaceIds : null;
    const edgeCounts = new Map();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    if (targetFaceId != null && faceIds && faceIds.length === triangles.length) {
      for (let i = 0; i < triangles.length; i++) {
        const tri = triangles[i];
        if (!tri || tri.length < 3) continue;
        const faceId = faceIds[i];
        const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
        for (const [a, b] of edges) {
          const key = edgeKey(a, b);
          let entry = edgeCounts.get(key);
          if (!entry) {
            entry = { count: 0, faces: new Set(), a, b };
            edgeCounts.set(key, entry);
          }
          entry.count += 1;
          entry.faces.add(faceId);
        }
      }
    } else {
      for (const tri of triangles) {
        if (!tri || tri.length < 3) continue;
        const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
        for (const [a, b] of edges) {
          const key = edgeKey(a, b);
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
      }
    }
    let bestDx = 1;
    let bestDy = 0;
    let bestLen = -Infinity;
    for (const [key, entry] of edgeCounts.entries()) {
      let a = null;
      let b = null;
      let isBoundary = false;
      if (entry && typeof entry === 'object' && entry.faces instanceof Set) {
        if (!entry.faces.has(targetFaceId)) continue;
        isBoundary = entry.count === 1 || entry.faces.size > 1;
        if (!isBoundary) continue;
        a = entry.a;
        b = entry.b;
      } else {
        if (entry !== 1) continue;
        const [aStr, bStr] = key.split('|');
        a = Number(aStr);
        b = Number(bStr);
      }
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      if (len > bestLen) {
        bestLen = len;
        bestDx = dx;
        bestDy = dy;
      }
    }
    if (bestLen < 0 && targetFaceId != null) {
      const fallbackCounts = new Map();
      for (const tri of triangles) {
        if (!tri || tri.length < 3) continue;
        const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
        for (const [a, b] of edges) {
          const key = edgeKey(a, b);
          fallbackCounts.set(key, (fallbackCounts.get(key) || 0) + 1);
        }
      }
      for (const [key, count] of fallbackCounts.entries()) {
        if (count !== 1) continue;
        const [aStr, bStr] = key.split('|');
        const a = Number(aStr);
        const b = Number(bStr);
        const ax = positions[a * 3 + 0];
        const ay = positions[a * 3 + 1];
        const bx = positions[b * 3 + 0];
        const by = positions[b * 3 + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy;
        if (len > bestLen) {
          bestLen = len;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    return Math.atan2(bestDy, bestDx);
  }

  _resolveFaceIdFromFace(solid, face) {
    if (!solid || !face) return null;
    const faceName = face.userData?.faceName || face.name;
    const idToName = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (!faceName || !idToName) return null;
    for (const [id, name] of idToName.entries()) {
      if (name === faceName) return id;
    }
    return null;
  }

  _projectPointToBasis(point, basis) {
    if (!point || !basis?.origin || !basis?.uAxis || !basis?.vAxis) return null;
    const rel = point.clone().sub(basis.origin);
    return {
      x: rel.dot(basis.uAxis),
      y: rel.dot(basis.vAxis),
    };
  }

  _computeFaceCentroid2D(face, basis) {
    const geom = face?.geometry;
    const pos = geom?.getAttribute?.('position');
    if (!geom || !pos || pos.itemSize !== 3 || pos.count < 3) return null;
    const idx = geom.getIndex?.();
    const toWorld = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(face.matrixWorld);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const triCentroid = new THREE.Vector3();
    let areaSum = 0;

    const addTri = (i0, i1, i2) => {
      toWorld(i0, a);
      toWorld(i1, b);
      toWorld(i2, c);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const area = 0.5 * ab.cross(ac).length();
      if (!(area > 0)) return;
      triCentroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      centroid.add(triCentroid.multiplyScalar(area));
      areaSum += area;
    };

    if (idx) {
      const triCount = (idx.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        addTri(idx.getX(3 * t + 0) >>> 0, idx.getX(3 * t + 1) >>> 0, idx.getX(3 * t + 2) >>> 0);
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        addTri(3 * t + 0, 3 * t + 1, 3 * t + 2);
      }
    }

    if (!(areaSum > 0)) return null;
    centroid.multiplyScalar(1 / areaSum);
    return this._projectPointToBasis(centroid, basis);
  }

  _computeFlatFaceCentroid2D(meshData, faceId) {
    const positions = meshData?.positions;
    const triangles = meshData?.triangles;
    const faceIds = meshData?.triangleFaceIds;
    if (!positions || !triangles || !Array.isArray(faceIds) || faceIds.length !== triangles.length) return null;
    let areaSum = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < triangles.length; i++) {
      if (faceIds[i] !== faceId) continue;
      const tri = triangles[i];
      if (!tri || tri.length < 3) continue;
      const a = tri[0];
      const b = tri[1];
      const c = tri[2];
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      const cx0 = positions[c * 3 + 0];
      const cy0 = positions[c * 3 + 1];
      const area = 0.5 * Math.abs((bx - ax) * (cy0 - ay) - (by - ay) * (cx0 - ax));
      if (!(area > 0)) continue;
      const mx = (ax + bx + cx0) / 3;
      const my = (ay + by + cy0) / 3;
      cx += mx * area;
      cy += my * area;
      areaSum += area;
    }
    if (!(areaSum > 0)) return null;
    return { x: cx / areaSum, y: cy / areaSum };
  }

  _getFaceBoundaryEdges2D(face, basis) {
    const geom = face?.geometry;
    const pos = geom?.getAttribute?.('position');
    if (!geom || !pos || pos.itemSize !== 3 || pos.count < 3) return [];
    const idx = geom.getIndex?.();
    const toWorld = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(face.matrixWorld);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      toWorld(i, tmp);
      if (tmp.x < minX) minX = tmp.x;
      if (tmp.y < minY) minY = tmp.y;
      if (tmp.z < minZ) minZ = tmp.z;
      if (tmp.x > maxX) maxX = tmp.x;
      if (tmp.y > maxY) maxY = tmp.y;
      if (tmp.z > maxZ) maxZ = tmp.z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const tol = Math.max(1e-6, diag * 1e-6);
    const keyFor = (v) => (
      `${Math.round(v.x / tol)},${Math.round(v.y / tol)},${Math.round(v.z / tol)}`
    );

    const pointByKey = new Map();
    const edgeCounts = new Map();
    const addEdge = (ka, kb) => {
      if (ka === kb) return;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let entry = edgeCounts.get(key);
      if (!entry) {
        entry = { count: 0, a: ka, b: kb };
        edgeCounts.set(key, entry);
      }
      entry.count += 1;
    };
    const pushVertex = (idxValue) => {
      const v = new THREE.Vector3();
      toWorld(idxValue, v);
      const key = keyFor(v);
      if (!pointByKey.has(key)) pointByKey.set(key, v);
      return key;
    };

    if (idx) {
      const triCount = (idx.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const aIdx = idx.getX(3 * t + 0) >>> 0;
        const bIdx = idx.getX(3 * t + 1) >>> 0;
        const cIdx = idx.getX(3 * t + 2) >>> 0;
        const ka = pushVertex(aIdx);
        const kb = pushVertex(bIdx);
        const kc = pushVertex(cIdx);
        addEdge(ka, kb);
        addEdge(kb, kc);
        addEdge(kc, ka);
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const aIdx = 3 * t + 0;
        const bIdx = 3 * t + 1;
        const cIdx = 3 * t + 2;
        const ka = pushVertex(aIdx);
        const kb = pushVertex(bIdx);
        const kc = pushVertex(cIdx);
        addEdge(ka, kb);
        addEdge(kb, kc);
        addEdge(kc, ka);
      }
    }

    const edges = [];
    for (const entry of edgeCounts.values()) {
      if (entry.count !== 1) continue;
      const pa = pointByKey.get(entry.a);
      const pb = pointByKey.get(entry.b);
      if (!pa || !pb) continue;
      const a2d = this._projectPointToBasis(pa, basis);
      const b2d = this._projectPointToBasis(pb, basis);
      if (!a2d || !b2d) continue;
      const dx = b2d.x - a2d.x;
      const dy = b2d.y - a2d.y;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      edges.push({
        a: a2d,
        b: b2d,
        aKey: entry.a,
        bKey: entry.b,
        mid: { x: (a2d.x + b2d.x) / 2, y: (a2d.y + b2d.y) / 2 },
        len,
      });
    }
    return edges;
  }

  _getFlatFaceBoundaryEdges2D(meshData, faceId) {
    const positions = meshData?.positions;
    const triangles = meshData?.triangles;
    const faceIds = meshData?.triangleFaceIds;
    if (!positions || !triangles || !Array.isArray(faceIds) || faceIds.length !== triangles.length) return [];
    const edgeCounts = new Map();
    const addEdge = (a, b) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    };
    for (let i = 0; i < triangles.length; i++) {
      if (faceIds[i] !== faceId) continue;
      const tri = triangles[i];
      if (!tri || tri.length < 3) continue;
      addEdge(tri[0], tri[1]);
      addEdge(tri[1], tri[2]);
      addEdge(tri[2], tri[0]);
    }
    const edges = [];
    for (const [key, count] of edgeCounts.entries()) {
      if (count !== 1) continue;
      const [aStr, bStr] = key.split('|');
      const a = Number(aStr);
      const b = Number(bStr);
      const ax = positions[a * 3 + 0];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3 + 0];
      const by = positions[b * 3 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      edges.push({
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
        aKey: a,
        bKey: b,
        mid: { x: (ax + bx) / 2, y: (ay + by) / 2 },
        len,
      });
    }
    return edges;
  }

  _computeFlatMeshPlacement(meshData, baseFace, baseFaceId, basis) {
    if (!meshData || !baseFace || !basis || !Number.isFinite(baseFaceId)) return null;
    const baseEdges = this._getFaceBoundaryEdges2D(baseFace, basis);
    if (!baseEdges.length) return null;
    const baseCentroid = this._computeFaceCentroid2D(baseFace, basis);

    const flatEdges = this._getFlatFaceBoundaryEdges2D(meshData, baseFaceId);
    if (!flatEdges.length) return null;
    const flatCentroid = this._computeFlatFaceCentroid2D(meshData, baseFaceId);

    const buildPointMap = (edges) => {
      const map = new Map();
      for (const edge of edges) {
        if (edge && edge.aKey != null) map.set(edge.aKey, edge.a);
        if (edge && edge.bKey != null) map.set(edge.bKey, edge.b);
      }
      return map;
    };
    const mergeColinearEdges2D = (edges, points) => {
      if (!edges.length) return [];
      const edgeKey = (a, b) => {
        const sa = String(a);
        const sb = String(b);
        return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
      };
      const edgeByKey = new Map();
      const unvisited = new Set();
      const adj = new Map();
      const addAdj = (a, b) => {
        let list = adj.get(a);
        if (!list) { list = []; adj.set(a, list); }
        list.push(b);
      };
      for (const edge of edges) {
        if (!edge || edge.aKey == null || edge.bKey == null) continue;
        const a = edge.aKey;
        const b = edge.bKey;
        const key = edgeKey(a, b);
        if (!edgeByKey.has(key)) edgeByKey.set(key, { a, b });
        unvisited.add(key);
        addAdj(a, b);
        addAdj(b, a);
      }
      const hasEdge = (a, b) => unvisited.has(edgeKey(a, b));
      const takeEdge = (a, b) => unvisited.delete(edgeKey(a, b));
      const isColinear = (a, b, c) => {
        const pa = points.get(a);
        const pb = points.get(b);
        const pc = points.get(c);
        if (!pa || !pb || !pc) return false;
        const v1x = pa.x - pb.x;
        const v1y = pa.y - pb.y;
        const v2x = pc.x - pb.x;
        const v2y = pc.y - pb.y;
        const len1 = Math.hypot(v1x, v1y);
        const len2 = Math.hypot(v2x, v2y);
        if (len1 < 1e-9 || len2 < 1e-9) return false;
        const cross = v1x * v2y - v1y * v2x;
        return Math.abs(cross) <= 1e-6 * len1 * len2;
      };

      const mergedKeys = [];
      while (unvisited.size) {
        const key = unvisited.values().next().value;
        const entry = edgeByKey.get(key);
        if (!entry) { unvisited.delete(key); continue; }
        const a = entry.a;
        const b = entry.b;
        takeEdge(a, b);
        let start = a;
        let end = b;
        let prev = start;
        let curr = end;
        while (true) {
          const neighbors = (adj.get(curr) || []).filter((n) => n !== prev);
          if (neighbors.length !== 1) break;
          const next = neighbors[0];
          if (!hasEdge(curr, next)) break;
          if (!isColinear(prev, curr, next)) break;
          takeEdge(curr, next);
          prev = curr;
          curr = next;
          end = curr;
        }
        prev = end;
        curr = start;
        while (true) {
          const neighbors = (adj.get(curr) || []).filter((n) => n !== prev);
          if (neighbors.length !== 1) break;
          const next = neighbors[0];
          if (!hasEdge(curr, next)) break;
          if (!isColinear(prev, curr, next)) break;
          takeEdge(curr, next);
          prev = curr;
          curr = next;
          start = curr;
        }
        mergedKeys.push([start, end]);
      }

      const merged = [];
      for (const [a, b] of mergedKeys) {
        const pa = points.get(a);
        const pb = points.get(b);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy);
        if (!(len > 0)) continue;
        merged.push({
          a: pa,
          b: pb,
          aKey: a,
          bKey: b,
          mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
          len,
        });
      }
      return merged;
    };
    const buildAdjacency = (edges) => {
      const adj = new Map();
      const add = (key, edge, otherKey) => {
        if (key == null || otherKey == null) return;
        let list = adj.get(key);
        if (!list) { list = []; adj.set(key, list); }
        list.push({ edge, otherKey });
      };
      for (const edge of edges) {
        if (!edge) continue;
        add(edge.aKey, edge, edge.bKey);
        add(edge.bKey, edge, edge.aKey);
      }
      return adj;
    };
    const basePoints = buildPointMap(baseEdges);
    const flatPoints = buildPointMap(flatEdges);
    const baseMergedEdges = mergeColinearEdges2D(baseEdges, basePoints);
    const flatMergedEdges = mergeColinearEdges2D(flatEdges, flatPoints);
    const baseEdgesForAlign = baseMergedEdges.length ? baseMergedEdges : baseEdges;
    const flatEdgesForAlign = flatMergedEdges.length ? flatMergedEdges : flatEdges;
    baseEdgesForAlign.sort((a, b) => b.len - a.len);
    const baseEdge = baseEdgesForAlign[0];
    if (!baseEdge) return null;

    const baseLen = baseEdge.len;
    const lenTol = Math.max(1e-6, baseLen * 0.01);
    let candidates = flatEdgesForAlign.filter((edge) => Math.abs(edge.len - baseLen) <= lenTol);
    if (!candidates.length) candidates = flatEdgesForAlign.slice();

    const baseAdj = buildAdjacency(baseEdgesForAlign);
    const flatAdj = buildAdjacency(flatEdgesForAlign);
    const endpointSignature = (edge, key, points, adj) => {
      if (!edge || key == null) return null;
      const endPt = points.get(key);
      if (!endPt) return null;
      const otherKey = key === edge.aKey ? edge.bKey : edge.aKey;
      const otherPt = points.get(otherKey);
      if (!otherPt) return null;
      const neighbors = adj.get(key) || [];
      let best = null;
      for (const entry of neighbors) {
        if (!entry || entry.edge === edge) continue;
        if (!best || entry.edge.len > best.edge.len) best = entry;
      }
      if (!best) return null;
      const adjPt = points.get(best.otherKey);
      if (!adjPt) return null;
      const mainDx = otherPt.x - endPt.x;
      const mainDy = otherPt.y - endPt.y;
      const adjDx = adjPt.x - endPt.x;
      const adjDy = adjPt.y - endPt.y;
      const mainLen = Math.hypot(mainDx, mainDy);
      const adjLen = Math.hypot(adjDx, adjDy);
      if (!(mainLen > 0) || !(adjLen > 0)) return null;
      const dot = (mainDx * adjDx + mainDy * adjDy) / (mainLen * adjLen);
      const cross = (mainDx * adjDy - mainDy * adjDx) / (mainLen * adjLen);
      const angle = Math.atan2(cross, dot);
      return { angle, len: best.edge.len };
    };
    const wrapAngleDiff = (a, b) => {
      const d = a - b;
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    };
    const sigDist = (s1, s2) => {
      if (!s1 || !s2) return Infinity;
      const angleDiff = wrapAngleDiff(s1.angle, s2.angle);
      const lenDiff = (s1.len - s2.len) / (baseLen || 1);
      return angleDiff * angleDiff + lenDiff * lenDiff;
    };
    const orderByXY = (p0, p1, tol = 1e-6) => {
      if (p0.x < p1.x - tol) return { start: p0, end: p1 };
      if (p0.x > p1.x + tol) return { start: p1, end: p0 };
      if (p0.y <= p1.y) return { start: p0, end: p1 };
      return { start: p1, end: p0 };
    };
    const baseSigA = endpointSignature(baseEdge, baseEdge.aKey, basePoints, baseAdj);
    const baseSigB = endpointSignature(baseEdge, baseEdge.bKey, basePoints, baseAdj);
    const baseOrderFallback = orderByXY(baseEdge.a, baseEdge.b, baseEdge.len * 1e-6);
    const baseStartFallback = baseOrderFallback.end;
    const baseEndFallback = baseOrderFallback.start;

    const evalTransform = (baseStart, baseEnd, flatStart, flatEnd) => {
      const baseDx = baseEnd.x - baseStart.x;
      const baseDy = baseEnd.y - baseStart.y;
      const baseAngle = Math.atan2(baseDy, baseDx);
      const flatAngle = Math.atan2(flatEnd.y - flatStart.y, flatEnd.x - flatStart.x);
      const angle = baseAngle - flatAngle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rot = (pt) => ({
        x: cos * pt.x - sin * pt.y,
        y: sin * pt.x + cos * pt.y,
      });
      const ra = rot(flatStart);
      const rb = rot(flatEnd);
      const tx = ((baseStart.x - ra.x) + (baseEnd.x - rb.x)) / 2;
      const ty = ((baseStart.y - ra.y) + (baseEnd.y - rb.y)) / 2;
      const ax = ra.x + tx - baseStart.x;
      const ay = ra.y + ty - baseStart.y;
      const bx = rb.x + tx - baseEnd.x;
      const by = rb.y + ty - baseEnd.y;
      let score = (ax * ax + ay * ay) + (bx * bx + by * by);
      if (flatCentroid && baseCentroid) {
        const rc = rot(flatCentroid);
        const dx = (rc.x + tx) - baseCentroid.x;
        const dy = (rc.y + ty) - baseCentroid.y;
        score += dx * dx + dy * dy;
      }
      return { angle, tx, ty, score };
    };

    let best = null;
    for (const edge of candidates) {
      const flatSigA = endpointSignature(edge, edge.aKey, flatPoints, flatAdj);
      const flatSigB = endpointSignature(edge, edge.bKey, flatPoints, flatAdj);
      const useSig = baseSigA && baseSigB && flatSigA && flatSigB;
      const baseStart = basePoints.get(baseEdge.bKey) || baseStartFallback;
      const baseEnd = basePoints.get(baseEdge.aKey) || baseEndFallback;
      let mappingScoreA = 0;
      let mappingScoreB = 0;
      if (useSig) {
        mappingScoreA = sigDist(baseSigB, flatSigA) + sigDist(baseSigA, flatSigB);
        mappingScoreB = sigDist(baseSigB, flatSigB) + sigDist(baseSigA, flatSigA);
      }
      const candA = evalTransform(baseStart, baseEnd, edge.a, edge.b);
      const candB = evalTransform(baseStart, baseEnd, edge.b, edge.a);
      const lenDiff = edge.len - baseLen;
      candA.score += mappingScoreA + (lenDiff * lenDiff) * 1e-6;
      candB.score += mappingScoreB + (lenDiff * lenDiff) * 1e-6;
      const winner = candA.score <= candB.score ? candA : candB;
      if (!best || winner.score < best.score) best = winner;
    }

    if (!best) return null;
    const uAxis = basis.uAxis.clone().normalize();
    const vAxis = basis.vAxis.clone().normalize();
    const normal = basis.normal
      ? basis.normal.clone().normalize()
      : new THREE.Vector3().crossVectors(uAxis, vAxis).normalize();
    const rot = new THREE.Matrix4().makeBasis(uAxis, vAxis, normal);
    const basisQuat = new THREE.Quaternion().setFromRotationMatrix(rot);
    const localQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), best.angle);
    const finalQuat = basisQuat.clone().multiply(localQuat);
    const worldPos = basis.origin.clone()
      .add(uAxis.multiplyScalar(best.tx))
      .add(vAxis.multiplyScalar(best.ty));
    return { position: worldPos, quaternion: finalQuat };
  }

  _faceArea(face) {
    if (!face) return 0;
    if (typeof face.surfaceArea === 'function') {
      const area = face.surfaceArea();
      if (Number.isFinite(area)) return area;
    }
    const geom = face.geometry;
    const pos = geom?.getAttribute?.('position');
    if (!pos || pos.itemSize !== 3) return 0;
    const idx = geom.getIndex?.();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const toWorld = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(face.matrixWorld);
    let area = 0;
    if (idx) {
      const triCount = (idx.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx.getX(3 * t + 0) >>> 0;
        const i1 = idx.getX(3 * t + 1) >>> 0;
        const i2 = idx.getX(3 * t + 2) >>> 0;
        toWorld(i0, a); toWorld(i1, b); toWorld(i2, c);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        area += 0.5 * ab.cross(ac).length();
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const i0 = 3 * t + 0;
        const i1 = 3 * t + 1;
        const i2 = 3 * t + 2;
        toWorld(i0, a); toWorld(i1, b); toWorld(i2, c);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        area += 0.5 * ab.cross(ac).length();
      }
    }
    return area;
  }

  _buildFaceBasis(face) {
    const geom = face?.geometry;
    const pos = geom?.getAttribute?.('position');
    if (!pos || pos.itemSize !== 3 || pos.count < 3) return null;
    const idx = geom.getIndex?.();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    let origin = null;
    const toWorld = (i, out) => out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(face.matrixWorld);

    const addTri = (i0, i1, i2) => {
      toWorld(i0, a); toWorld(i1, b); toWorld(i2, c);
      if (!origin) origin = a.clone();
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.add(ac.cross(ab));
    };

    if (idx) {
      const triCount = (idx.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        addTri(idx.getX(3 * t + 0) >>> 0, idx.getX(3 * t + 1) >>> 0, idx.getX(3 * t + 2) >>> 0);
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        addTri(3 * t + 0, 3 * t + 1, 3 * t + 2);
      }
    }

    if (!origin) origin = toWorld(0, new THREE.Vector3());
    if (normal.lengthSq() > 1e-12) normal.normalize();
    else normal.set(0, 0, 1);

    let uAxis = null;
    let maxEdgeLen = -Infinity;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const proj = new THREE.Vector3();
    const considerEdge = (i0, i1) => {
      toWorld(i0, p0);
      toWorld(i1, p1);
      edge.subVectors(p1, p0);
      const dot = edge.dot(normal);
      proj.copy(edge).addScaledVector(normal, -dot);
      const len = proj.lengthSq();
      if (len > maxEdgeLen) {
        maxEdgeLen = len;
        uAxis = proj.clone().normalize();
      }
    };
    const edgeCounts = new Map();
    const addEdge = (i0, i1) => {
      if (i0 === i1) return;
      const a = i0 < i1 ? i0 : i1;
      const b = i0 < i1 ? i1 : i0;
      const key = `${a}|${b}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    };

    if (idx) {
      const triCount = (idx.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const aIdx = idx.getX(3 * t + 0) >>> 0;
        const bIdx = idx.getX(3 * t + 1) >>> 0;
        const cIdx = idx.getX(3 * t + 2) >>> 0;
        addEdge(aIdx, bIdx);
        addEdge(bIdx, cIdx);
        addEdge(cIdx, aIdx);
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) {
        const aIdx = 3 * t + 0;
        const bIdx = 3 * t + 1;
        const cIdx = 3 * t + 2;
        addEdge(aIdx, bIdx);
        addEdge(bIdx, cIdx);
        addEdge(cIdx, aIdx);
      }
    }

    let hasBoundary = false;
    for (const [key, count] of edgeCounts.entries()) {
      if (count !== 1) continue;
      hasBoundary = true;
      const [aStr, bStr] = key.split('|');
      considerEdge(Number(aStr), Number(bStr));
    }

    if (!hasBoundary) {
      if (idx) {
        const triCount = (idx.count / 3) | 0;
        for (let t = 0; t < triCount; t++) {
          const aIdx = idx.getX(3 * t + 0) >>> 0;
          const bIdx = idx.getX(3 * t + 1) >>> 0;
          const cIdx = idx.getX(3 * t + 2) >>> 0;
          considerEdge(aIdx, bIdx);
          considerEdge(bIdx, cIdx);
          considerEdge(cIdx, aIdx);
        }
      } else {
        const triCount = (pos.count / 3) | 0;
        for (let t = 0; t < triCount; t++) {
          const aIdx = 3 * t + 0;
          const bIdx = 3 * t + 1;
          const cIdx = 3 * t + 2;
          considerEdge(aIdx, bIdx);
          considerEdge(bIdx, cIdx);
          considerEdge(cIdx, aIdx);
        }
      }
    }
    if (!uAxis || uAxis.lengthSq() < 1e-12) {
      let far = null;
      let maxDist = -Infinity;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        toWorld(i, tmp);
        const d = tmp.distanceToSquared(origin);
        if (d > maxDist) {
          maxDist = d;
          far = tmp.clone();
        }
      }
      if (!far) return null;
      uAxis = far.clone().sub(origin).normalize();
      if (Math.abs(uAxis.dot(normal)) > 0.99) {
        const ref = new THREE.Vector3(1, 0, 0);
        const alt = new THREE.Vector3(0, 1, 0);
        const fallback = new THREE.Vector3().crossVectors(normal, ref);
        if (fallback.lengthSq() < 1e-12) fallback.crossVectors(normal, alt);
        uAxis.copy(fallback.normalize());
      }
    }
    const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
    return { origin, uAxis, vAxis, normal };
  }

  _stepBy(delta) {
    if (!this.steps.length) return;
    this._setStepIndex(this.stepIndex + delta);
  }

  _togglePlayback() {
    if (this.playTimer) this._stopPlayback();
    else this._startPlayback();
  }

  _startPlayback() {
    if (this.playTimer) return;
    if (!this.steps.length) return;
    this.playTimer = setInterval(() => {
      const next = (this.stepIndex + 1) % this.steps.length;
      this._setStepIndex(next);
    }, this.playDelay);
    if (this.ui.btnPlay) this.ui.btnPlay.textContent = 'Pause';
  }

  _stopPlayback() {
    if (!this.playTimer) return;
    clearInterval(this.playTimer);
    this.playTimer = null;
    if (this.ui.btnPlay) this.ui.btnPlay.textContent = 'Play';
  }

  _renderStep(shouldFit) {
    if (!this.steps.length) {
      this._clearEdgeGroup();
      this._updateStepLabel(null, 0, 0);
      this._clearHighlightedFace();
      this._updateStepDetail(null, null, null);
      return;
    }
    const step = this.steps[this.stepIndex];
    
    // If this is the first step (offset calculation), don't render paths
    // Just show the visualization meshes and offset info
    if (step?.offsetInfo) {
      this._updateStepLabel(step?.label || 'A-Face Offset', this.stepIndex + 1, this.steps.length);
      if (this.ui.slider) {
        this.ui.slider.max = String(Math.max(0, this.steps.length - 1));
        this.ui.slider.value = String(this.stepIndex);
      }
      this._clearEdgeGroup();
      this._clearHighlightedFace();
      this._updateStepDetail(step, null, null);
      if (shouldFit) this._fitToCurrent();
      return;
    }
    
    this._updateStepLabel(step?.label || 'Step', this.stepIndex + 1, this.steps.length);
    if (this.ui.slider) {
      this.ui.slider.max = String(Math.max(0, this.steps.length - 1));
      this.ui.slider.value = String(this.stepIndex);
    }
    const prevStep = this.stepIndex > 0 ? this.steps[this.stepIndex - 1] : null;
    const stepPaths = this._filterPathsToAEdges(step?.paths || []);
    const prevPaths = prevStep ? this._filterPathsToAEdges(prevStep?.paths || []) : [];
    const highlightLabels = this._collectNewEdgeLabelsFromPaths(stepPaths, prevPaths);
    const highlightFaceId = this._resolveHighlightFaceId(step);
    this._renderStepPaths(stepPaths, { highlightLabels, highlightFaceId, showEmptyMessage: true });
    this._highlightStepFace(step);
    this._updateStepDetail(step, prevStep, highlightLabels, stepPaths);
    if (shouldFit) this._fitToCurrent();
  }

  _updateStepLabel(label, index, total) {
    if (!this.ui.stepLabel) return;
    if (!total) {
      this.ui.stepLabel.textContent = '';
      return;
    }
    const name = label ? String(label) : 'Step';
    this.ui.stepLabel.textContent = `${name} (${index}/${total})`;
  }

  _formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    const s = value.toFixed(3);
    return s.replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1');
  }

  _pathLength(points, closed) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      total += Math.hypot(dx, dy);
    }
    if (closed) {
      const a = points[points.length - 1];
      const b = points[0];
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  }

  _updateStepDetail(step, prevStep, highlightLabels, pathsOverride = null) {
    if (!this.ui.detail) return;
    if (!step) {
      this.ui.detail.textContent = '';
      return;
    }
    
    const lines = [];
    
    // Check if this is the offset calculation step
    if (step.offsetInfo) {
      const info = step.offsetInfo;
      lines.push(`=== A-FACE OFFSET CALCULATION ===`);
      lines.push('');
      lines.push(`Neutral Factor (k-factor): ${info.neutralFactor.toFixed(4)}`);
      lines.push(`Sheet Thickness: ${info.thickness.toFixed(3)} mm`);
      lines.push('');
      lines.push(`📐 OFFSET DISTANCE: ${info.offsetDistance.toFixed(4)} mm`);
      lines.push('');
      lines.push(`Formula: Offset = neutralFactor × thickness`);
      lines.push(`         ${info.offsetDistance.toFixed(4)} = ${info.neutralFactor.toFixed(4)} × ${info.thickness.toFixed(3)}`);
      lines.push('');
      lines.push(`A-Faces to Offset: ${info.aFaceCount}`);
      lines.push('');
      lines.push(`This offset accounts for bend allowance in the flat pattern.`);
      lines.push(`Each triangle is offset along its normal by this distance.`);
      lines.push('');
      lines.push(`VISUALIZATION MESHES:`);
      lines.push(`🔴 Red = Original A-faces (planar)`);
      lines.push(`🔵 Blue = Offset A-faces (planar)`);
      lines.push(`🟢 Green = Original Bend-faces (cylindrical)`);
      lines.push(`🟡 Yellow = Offset Bend-faces (cylindrical)`);
      
      this.ui.detail.textContent = lines.join('\n');
      return;
    }
    
    const solid = this.activeSolid;
    const faceId = this._resolveHighlightFaceId(step);
    const faceName = solid ? this._resolveFaceNameFromStep(step, solid, faceId) : null;
    let purpose = 'Update unfold placement.';
    if (this.stepIndex === 0) {
      purpose = faceName ? `Initialize from base face ${faceName}.` : 'Initialize from base face.';
    } else if (faceName) {
      purpose = `Add face ${faceName} to the unfolded set.`;
    } else if (typeof step.label === 'string' && step.label.trim()) {
      purpose = step.label.trim();
    }

    const highlightSet = highlightLabels instanceof Set ? highlightLabels : this._collectNewEdgeLabelsFromPaths(
      Array.isArray(step.paths) ? step.paths : [],
      prevStep && Array.isArray(prevStep.paths) ? prevStep.paths : [],
    );
    const paths = Array.isArray(pathsOverride) ? pathsOverride : (Array.isArray(step.paths) ? step.paths : []);
    const newPaths = paths.filter((path) => highlightSet.has(path?.edgeLabel || path?.name));
    
    lines.push(`Purpose: ${purpose}`);
    
    // Check if no paths at all were generated
    if (!paths || paths.length === 0) {
      lines.push('⚠️ WARNING: No flat pattern geometry generated for this step.');
      lines.push('This indicates a problem with the unfolding algorithm.');
      lines.push('The face could not be unfolded to 2D coordinates.');
      lines.push('Check the Copy Debug JSON for detailed information.');
    } else if (newPaths.length) {
      lines.push(`Curves created (${newPaths.length}):`);
      for (const path of newPaths) {
        const label = path?.edgeLabel || path?.name || 'edge';
        const length = this._pathLength(path?.points || [], !!path?.closed);
        const face = path?.faceName || path?.faceLabel || '';
        const closed = path?.closed ? 'closed' : 'open';
        const faceInfo = face ? ` face=${face}` : '';
        lines.push(`- ${label}${faceInfo} ${closed} len=${this._formatNumber(length)}`);
      }
    } else {
      lines.push('Curves created: none (no new edges).');
      lines.push(`Total paths in step: ${paths.length}`);
      if (this.stepIndex > 0) {
        lines.push('(All edges were already present in previous steps)');
      }
      // Get face metadata to provide more context
      if (faceName && solid) {
        const face = this._findFaceByName(solid, faceName);
        if (face) {
          try {
            const faceMeta = typeof face.getMetadata === 'function' ? face.getMetadata() : null;
            if (faceMeta?.type === 'cylindrical') {
              const radius = faceMeta.radius || faceMeta.pmiRadiusOverride || faceMeta.pmiRadius;
              if (Number.isFinite(radius)) {
                lines.push(`Note: Cylindrical face (R=${this._formatNumber(radius)})`);
                lines.push('Bend edges may be shared with adjacent planar faces.');
              }
            }
          } catch {}
        }
      }
    }
    this.ui.detail.textContent = lines.join('\n');
  }

  _basisToPlain(basis) {
    if (!basis) return null;
    const toArray = (value) => {
      if (!value) return null;
      if (Array.isArray(value)) return value.slice(0, 3);
      if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number') {
        return [value.x, value.y, value.z];
      }
      return null;
    };
    return {
      origin: toArray(basis.origin),
      uAxis: toArray(basis.uAxis),
      vAxis: toArray(basis.vAxis),
      normal: toArray(basis.normal),
    };
  }

  _summarizePath(path) {
    if (!path) return null;
    const pts = Array.isArray(path.points) ? path.points : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      if (!pt) continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
    const bbox = Number.isFinite(minX)
      ? { minX, minY, maxX, maxY }
      : null;
    return {
      edgeLabel: path.edgeLabel || path.name || null,
      name: path.name || null,
      faceId: Number.isFinite(path.faceId) ? path.faceId : null,
      faceName: path.faceName || null,
      faceLabel: path.faceLabel || null,
      closed: !!path.closed,
      shared: !!path.shared,
      otherFaceId: Number.isFinite(path.otherFaceId) ? path.otherFaceId : null,
      color: path.color || null,
      strokeWidth: Number.isFinite(path.strokeWidth) ? path.strokeWidth : null,
      pointCount: pts.length,
      length: this._pathLength(pts, !!path.closed),
      bbox,
      points: pts.map((pt) => ({ x: pt.x, y: pt.y })),
      indices: Array.isArray(path.indices) ? path.indices.slice() : null,
    };
  }

  _buildDebugInfo() {
    const entry = this.entries?.[this.activeIndex];
    const step = this.steps?.[this.stepIndex];
    if (!entry || !step) return null;
    const prevStep = this.stepIndex > 0 ? this.steps[this.stepIndex - 1] : null;
    const rawPaths = Array.isArray(step.paths) ? step.paths : [];
    const filteredPaths = this._filterPathsToAEdges(rawPaths);
    const prevPaths = prevStep ? this._filterPathsToAEdges(prevStep.paths || []) : [];
    const highlightLabels = this._collectNewEdgeLabelsFromPaths(filteredPaths, prevPaths);
    const newPaths = filteredPaths.filter((path) => highlightLabels.has(path?.edgeLabel || path?.name));
    const highlightFaceId = this._resolveHighlightFaceId(step);
    const solid = this.activeSolid;
    const faceName = solid ? this._resolveFaceNameFromStep(step, solid, highlightFaceId) : null;
    const face = faceName ? this._findFaceByName(solid, faceName) : null;
    const faceType = face ? resolveSheetMetalFaceType(face) : null;
    let faceMeta = null;
    try { faceMeta = typeof face?.getMetadata === 'function' ? face.getMetadata() : null; } catch { }
    let solidFaceMeta = null;
    if (solid && faceName && typeof solid.getFaceMetadata === 'function') {
      try { solidFaceMeta = solid.getFaceMetadata(faceName); } catch { }
    }
    const newEdgeLabels = Array.from(highlightLabels);
    const filteredEdgeLabels = filteredPaths.map((path) => path?.edgeLabel || path?.name).filter(Boolean);
    const rawEdgeLabels = rawPaths.map((path) => path?.edgeLabel || path?.name).filter(Boolean);

    return {
      version: 1,
      timestamp: new Date().toISOString(),
      solid: {
        name: this.activeSolid?.name || entry?.name || null,
        index: this.activeIndex,
        sourceIndex: Number.isFinite(entry?.sourceIndex) ? entry.sourceIndex : null,
        thickness: Number.isFinite(entry?.thickness) ? entry.thickness : null,
      },
      step: {
        index: this.stepIndex,
        total: this.steps.length,
        label: step.label || null,
        faceId: Number.isFinite(highlightFaceId) ? highlightFaceId : null,
        faceName,
        addedFaceId: Number.isFinite(step.addedFaceId) ? step.addedFaceId : null,
        addedFaceName: step.addedFaceName || null,
        baseFaceId: Number.isFinite(step.baseFaceId) ? step.baseFaceId : null,
        baseBasis: this._basisToPlain(step.baseBasis),
        basis: this._basisToPlain(step.basis),
      },
      face: {
        name: faceName,
        id: Number.isFinite(highlightFaceId) ? highlightFaceId : null,
        sheetMetalFaceType: faceType || null,
        metadata: faceMeta,
        solidMetadata: solidFaceMeta,
      },
      flat: {
        basis: this._basisToPlain(this.flatBasis),
        offset: { ...this.flatOffset },
      },
      filters: {
        aFaceLabels: Array.from(this.aFaceLabels || []),
        aEdgeLabels: Array.from(this.aEdgeLabels || []),
        aEdgeNames: Array.from(this.aEdgeNames || []),
      },
      paths: {
        rawCount: rawPaths.length,
        filteredCount: filteredPaths.length,
        newCount: newPaths.length,
        rawEdgeLabels,
        filteredEdgeLabels,
        newEdgeLabels,
        raw: rawPaths.map((path) => this._summarizePath(path)).filter(Boolean),
        filtered: filteredPaths.map((path) => this._summarizePath(path)).filter(Boolean),
        newlyAdded: newPaths.map((path) => this._summarizePath(path)).filter(Boolean),
      },
    };
  }

  async _copyDebugJson() {
    const debugInfo = this._buildDebugInfo();
    if (!debugInfo) {
      this._setEmpty('No debug data available.');
      return;
    }
    const json = JSON.stringify(debugInfo, null, 2);
    const copied = await this._copyText(json);
    const btn = this.ui.btnDebugJson;
    if (copied) {
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = prev; }, 900);
      } else {
        try { this.viewer?._toast?.('Debug JSON copied'); } catch { }
      }
    } else {
      this._setEmpty('Failed to copy debug JSON.');
    }
  }

  async _copyText(text) {
    if (typeof text !== 'string' || !text.length) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'true');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch { }
    return false;
  }

  _collectEdgeLabels(paths) {
    const labels = new Set();
    if (!Array.isArray(paths)) return labels;
    for (const path of paths) {
      const label = path?.edgeLabel || path?.name;
      if (label) labels.add(label);
    }
    return labels;
  }

  _collectNewEdgeLabelsFromPaths(paths, prevPaths) {
    const current = this._collectEdgeLabels(paths || []);
    const previous = this._collectEdgeLabels(prevPaths || []);
    const added = new Set();
    for (const label of current) {
      if (!previous.has(label)) added.add(label);
    }
    return added;
  }

  _safeEdgeName(value) {
    return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  }

  _normalizeEdgeLabel(name) {
    if (!name) return null;
    const raw = String(name);
    const match = /^(.+?)\|(.+?)(\[\d+\])?$/.exec(raw);
    if (match) {
      const faceA = this._safeEdgeName(match[1]);
      const faceB = this._safeEdgeName(match[2]);
      return `${faceA}|${faceB}${match[3] || ''}`;
    }
    return this._safeEdgeName(raw);
  }

  _splitEdgeLabel(name) {
    if (!name) return null;
    const raw = String(name);
    const match = /^(.+?)\|(.+?)(\[\d+\])?$/.exec(raw);
    if (!match) return null;
    return {
      faceA: this._safeEdgeName(match[1]),
      faceB: this._safeEdgeName(match[2]),
    };
  }

  _filterPathsToAEdges(paths) {
    const list = Array.isArray(paths) ? paths : [];
    if (!this.aFaceLabels || !this.aFaceLabels.size) return list;
    return list.filter((path) => {
      if (!path) return false;
      const faceLabel = path.faceLabel || this._safeEdgeName(path.faceName);
      if (faceLabel && this.aFaceLabels.has(faceLabel)) return true;
      const label = path.edgeLabel || path.name;
      if (!label) return false;
      if (this.aEdgeLabels && this.aEdgeLabels.size) {
        if (this.aEdgeLabels.has(label)) return true;
        const normalized = this._normalizeEdgeLabel(label);
        if (normalized && this.aEdgeLabels.has(normalized)) return true;
      }
      const parts = this._splitEdgeLabel(label);
      if (!parts) return false;
      return this.aFaceLabels.has(parts.faceA) || this.aFaceLabels.has(parts.faceB);
    });
  }

  _resolveHighlightFaceId(step) {
    if (!step) return null;
    if (Number.isFinite(step.addedFaceId)) return step.addedFaceId;
    if (Number.isFinite(step.faceId)) return step.faceId;
    if (Number.isFinite(step.baseFaceId) && this.stepIndex === 0) return step.baseFaceId;
    return null;
  }

  _resolveFaceNameFromStep(step, solid, faceId) {
    if (!step || !solid) return null;
    if (typeof step.addedFaceName === 'string' && step.addedFaceName) return step.addedFaceName;
    if (typeof step.faceName === 'string' && step.faceName) return step.faceName;
    if (Array.isArray(step.paths) && Number.isFinite(faceId)) {
      const match = step.paths.find((path) => path?.faceId === faceId && path?.faceName);
      if (match && match.faceName) return match.faceName;
    }
    if (typeof step.label === 'string') {
      const match = /\((?:root\s+|\+)([^)]+)\)/.exec(step.label);
      if (match && match[1]) return match[1].trim();
    }
    const map = solid._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (map && typeof map.get === 'function' && Number.isFinite(faceId)) {
      return map.get(faceId) || null;
    }
    return null;
  }

  _getSolidFaceObjects(solid) {
    if (!solid) return [];
    try {
      const children = Array.isArray(solid.children) ? solid.children : [];
      const faces = children.filter((child) => child && child.type === 'FACE');
      if (faces.length) return faces;
    } catch { }
    try {
      if (Array.isArray(solid.faces) && solid.faces.length) return solid.faces;
    } catch { }
    try {
      const faces = typeof solid.getFaces === 'function' ? solid.getFaces() : [];
      if (Array.isArray(faces) && faces.length && faces[0]?.type === 'FACE') return faces;
    } catch { }
    return [];
  }

  _findFaceByName(solid, name) {
    if (!solid || !name) return null;
    const faces = this._getSolidFaceObjects(solid);
    for (const face of faces) {
      if (!face || face.type !== 'FACE') continue;
      const faceName = face.userData?.faceName || face.name;
      if (faceName === name) return face;
    }
    return null;
  }

  _highlightStepFace(step) {
    this._clearHighlightedFace();
    const solid = this.activeSolid;
    if (!solid || !step) return;
    try { solid.updateMatrixWorld?.(true); } catch { }
    const faceId = this._resolveHighlightFaceId(step);
    if (!Number.isFinite(faceId)) return;
    const faceName = this._resolveFaceNameFromStep(step, solid, faceId);
    const face = this._findFaceByName(solid, faceName);
    if (!face) return;
    const geom = face.geometry ? face.geometry.clone() : null;
    if (!geom) return;
    try { geom.applyMatrix4(face.matrixWorld); } catch { }
    try { geom.computeBoundingBox(); geom.computeBoundingSphere(); } catch { }
    const highlightMat = this._getHighlightMaterial(face.material);
    if (!highlightMat) return;
    const mesh = new THREE.Mesh(geom, highlightMat);
    mesh.name = `FlatPatternStepFace_${faceName || faceId}`;
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    mesh.userData = {
      tool: 'flat-pattern-unfold',
      kind: 'highlight-face',
      sourceFace: faceName || null,
    };
    const scene = this._getScene();
    try { scene?.add(mesh); } catch { }
    this.highlightMesh = mesh;
    try { this.viewer?.render?.(); } catch { }
  }

  _getHighlightMaterial(baseMaterial) {
    if (this.highlightMaterial) return this.highlightMaterial;
    let mat = null;
    if (baseMaterial && typeof baseMaterial.clone === 'function') {
      try { mat = baseMaterial.clone(); } catch { mat = null; }
    }
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: 0xffd24a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
        roughness: 0.6,
        metalness: 0.1,
        flatShading: false,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    }
    if (mat.color && typeof mat.color.set === 'function') mat.color.set('#ffd24a');
    mat.side = THREE.DoubleSide;
    if (mat.emissive && typeof mat.emissive.set === 'function') {
      mat.emissive.set('#2a1d00');
      mat.emissiveIntensity = Math.max(0.2, mat.emissiveIntensity || 0);
    }
    try { mat.transparent = true; } catch { }
    try { mat.opacity = 0.6; } catch { }
    try {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -1;
    } catch { }
    try { mat.needsUpdate = true; } catch { }
    this.highlightMaterial = mat;
    return mat;
  }

  _clearHighlightedFace() {
    if (this.highlightMesh) {
      const scene = this._getScene();
      try { scene?.remove(this.highlightMesh); } catch { }
      try { this.highlightMesh.geometry?.dispose?.(); } catch { }
      this.highlightMesh = null;
    }
  }

  _syncLineMaterialResolution(material) {
    if (!material || !material.resolution || typeof material.resolution.set !== 'function') return;
    const size = typeof this.viewer?._getContainerSize === 'function'
      ? this.viewer._getContainerSize()
      : { width: window.innerWidth || 1, height: window.innerHeight || 1 };
    material.resolution.set(size.width || 1, size.height || 1);
  }

  _renderStepPaths(paths, opts = {}) {
    this._ensureEdgeGroup();
    this._clearEdgeGroup();
    if (!Array.isArray(paths) || !paths.length) {
      // Show message if no paths were generated for this step
      if (opts.showEmptyMessage) {
        this._setEmpty('No flat pattern geometry generated for this step.');
      }
      return;
    }
    const basis = null;
    const useBasis = false;
    const highlightLabels = opts.highlightLabels instanceof Set ? opts.highlightLabels : new Set();
    const highlightFaceId = Number.isFinite(opts.highlightFaceId) ? opts.highlightFaceId : null;
    let renderedCount = 0;
    for (const path of paths) {
      const pts = Array.isArray(path?.points) ? path.points : [];
      if (pts.length < 2) continue;
      const count = path.closed ? (pts.length + 1) : pts.length;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < pts.length; i += 1) {
        const px = pts[i].x;
        const py = pts[i].y;
        if (useBasis) {
          positions[i * 3 + 0] = basis.origin.x + basis.uAxis.x * px + basis.vAxis.x * py;
          positions[i * 3 + 1] = basis.origin.y + basis.uAxis.y * px + basis.vAxis.y * py;
          positions[i * 3 + 2] = basis.origin.z + basis.uAxis.z * px + basis.vAxis.z * py;
        } else {
          positions[i * 3 + 0] = px + this.flatOffset.x;
          positions[i * 3 + 1] = py + this.flatOffset.y;
          positions[i * 3 + 2] = this.flatOffset.z;
        }
      }
      if (path.closed) {
        const px = pts[0].x;
        const py = pts[0].y;
        if (useBasis) {
          positions[(count - 1) * 3 + 0] = basis.origin.x + basis.uAxis.x * px + basis.vAxis.x * py;
          positions[(count - 1) * 3 + 1] = basis.origin.y + basis.uAxis.y * px + basis.vAxis.y * py;
          positions[(count - 1) * 3 + 2] = basis.origin.z + basis.uAxis.z * px + basis.vAxis.z * py;
        } else {
          positions[(count - 1) * 3 + 0] = px + this.flatOffset.x;
          positions[(count - 1) * 3 + 1] = py + this.flatOffset.y;
          positions[(count - 1) * 3 + 2] = this.flatOffset.z;
        }
      }
      const color = path.color || '#000000';
      const label = path?.edgeLabel || path?.name || '';
      const stroke = Number.isFinite(path.strokeWidth) ? path.strokeWidth : 0.2;
      const baseWidth = Math.max(1, stroke * BASE_LINE_WIDTH_SCALE);
      const isHighlight = highlightLabels.has(label) || (highlightFaceId != null && path.faceId === highlightFaceId);
      const lineWidth = isHighlight ? baseWidth * ACTIVE_LINE_WIDTH_SCALE : baseWidth;
      const geom = new LineGeometry();
      geom.setPositions(Array.from(positions));
      const mat = new LineMaterial({
        color,
        linewidth: lineWidth,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        worldUnits: false,
      });
      this._syncLineMaterialResolution(mat);
      const line = new Line2(geom, mat);
      line.renderOrder = isHighlight ? 3 : 2;
      this.edgeGroup.add(line);
      renderedCount++;
    }
    // Show message if no valid paths were rendered
    if (renderedCount === 0 && opts.showEmptyMessage) {
      this._setEmpty('No valid flat pattern geometry generated for this step.');
    }
    try { this.edgeGroup.updateMatrixWorld(true); } catch { }
    try { this.viewer?.render?.(); } catch { }
  }

  _ensureEdgeGroup() {
    if (this.edgeGroup) return;
    this.edgeGroup = new THREE.Group();
    this.edgeGroup.name = 'FlatPatternUnfoldEdges';
    this.edgeGroup.userData = { tool: 'flat-pattern-unfold', kind: 'edges' };
    const scene = this._getScene();
    try { scene?.add(this.edgeGroup); } catch { }
  }

  _clearEdgeGroup() {
    if (!this.edgeGroup) return;
    const children = this.edgeGroup.children.slice();
    for (const child of children) {
      try { this.edgeGroup.remove(child); } catch { }
      try { child.geometry?.dispose?.(); } catch { }
      try { child.material?.dispose?.(); } catch { }
    }
  }

  _renderVisualizationMeshes(entries) {
    // Clear any existing visualization meshes
    this._clearVisualizationMeshes();
    
    if (!entries || !entries.length) {
      console.log('[FlatPattern] No entries for visualization');
      return;
    }
    
    const scene = this._getScene();
    if (!scene) {
      console.log('[FlatPattern] No scene available for visualization');
      return;
    }
    
    this.visualizationMeshes = [];
    let meshCount = 0;
    const faceColor = (faceId) => {
      const seed = (Number(faceId) + 1) * 2654435761;
      const hue = (seed % 360) / 360;
      const color = new THREE.Color();
      color.setHSL(hue, 0.6, 0.55);
      return color;
    };
    const planarColor = new THREE.Color('#1f7a3a');
    const bendColor = new THREE.Color('#8b2f1f');
    
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];
      if (!entry.visualizationMeshes || !entry.visualizationMeshes.length) {
        console.log(`[FlatPattern] Entry "${entry.name}" has no visualization meshes`);
        continue;
      }

      console.log(`[FlatPattern] Rendering ${entry.visualizationMeshes.length} visualization meshes for "${entry.name}"`);
      
      for (const meshData of entry.visualizationMeshes) {
        if (meshData.name === 'Offset A Faces (Unified)') {
          continue;
        }
        console.log(`[FlatPattern]   - ${meshData.name}: ${meshData.triangles.length} triangles, ${meshData.positions.length / 3} vertices`);
        
        const geometry = new THREE.BufferGeometry();
        const isFlatUnfold = meshData.name && meshData.name.includes('Flat A Faces');
        const hasFaceIds = Array.isArray(meshData.triangleFaceIds);
        if (isFlatUnfold && hasFaceIds) {
          const faceMetaById = meshData.faceMetaById || null;
          const isBendFace = (faceId) => {
            if (!faceMetaById) return null;
            const meta = faceMetaById instanceof Map ? faceMetaById.get(faceId) : faceMetaById[faceId];
            if (meta?.type !== 'cylindrical') return false;
            const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
            return Number.isFinite(radius) && radius > 0;
          };
          const colorForFace = (faceId) => {
            const bend = isBendFace(faceId);
            if (bend === true) return bendColor;
            if (bend === false) return planarColor;
            return faceColor(faceId);
          };
          const triCount = meshData.triangles.length;
          const flatPositions = new Float32Array(triCount * 9);
          const flatColors = new Float32Array(triCount * 9);
          let writeIdx = 0;
          let colorIdx = 0;
          for (let i = 0; i < triCount; i++) {
            const tri = meshData.triangles[i];
            const color = colorForFace(meshData.triangleFaceIds[i]);
            for (let k = 0; k < 3; k++) {
              const vIdx = tri[k];
              flatPositions[writeIdx++] = meshData.positions[vIdx * 3 + 0];
              flatPositions[writeIdx++] = meshData.positions[vIdx * 3 + 1];
              flatPositions[writeIdx++] = meshData.positions[vIdx * 3 + 2];
              flatColors[colorIdx++] = color.r;
              flatColors[colorIdx++] = color.g;
              flatColors[colorIdx++] = color.b;
            }
          }
          geometry.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3));
          geometry.setAttribute('color', new THREE.BufferAttribute(flatColors, 3));
        } else {
          geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
          
          // Convert triangles to indices
          const indices = [];
          for (const tri of meshData.triangles) {
            indices.push(tri[0], tri[1], tri[2]);
          }
          geometry.setIndex(indices);
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(meshData.color[0], meshData.color[1], meshData.color[2]),
          transparent: true,
          opacity: meshData.name.includes('Offset A Faces') ? 0.8 : 0.3, // Higher opacity for offset A faces
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          emissive: new THREE.Color(meshData.color[0], meshData.color[1], meshData.color[2]),
          emissiveIntensity: 0.2,
          vertexColors: isFlatUnfold && hasFaceIds,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `VisualizationMesh_${meshData.name.replace(/\s/g, '_')}`;
        mesh.renderOrder = 1; // Low order so diagnostic tools render after
        mesh.userData = {
          tool: 'flat-pattern-unfold',
          kind: 'visualization',
          vizName: meshData.name,
          flatPatternEntry: entry.name || null,
        };
        if (isFlatUnfold) {
          mesh.scale.set(1, 1, 1);
        }

        if (isFlatUnfold && hasFaceIds) {
          const pos2d = (idx) => ({
            x: meshData.positions[idx * 3 + 0],
            y: meshData.positions[idx * 3 + 1],
          });
          const isColinear = (a, b, c) => {
            const pa = pos2d(a);
            const pb = pos2d(b);
            const pc = pos2d(c);
            const v1x = pa.x - pb.x;
            const v1y = pa.y - pb.y;
            const v2x = pc.x - pb.x;
            const v2y = pc.y - pb.y;
            const len1 = Math.hypot(v1x, v1y);
            const len2 = Math.hypot(v2x, v2y);
            if (len1 < 1e-9 || len2 < 1e-9) return false;
            const cross = v1x * v2y - v1y * v2x;
            return Math.abs(cross) <= 1e-6 * len1 * len2;
          };
          const mergeColinearEdges = (segments) => {
            const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
            const adj = new Map();
            const unvisited = new Set();
            for (const [a, b] of segments) {
              const key = edgeKey(a, b);
              unvisited.add(key);
              if (!adj.has(a)) adj.set(a, []);
              if (!adj.has(b)) adj.set(b, []);
              adj.get(a).push(b);
              adj.get(b).push(a);
            }
            const hasEdge = (a, b) => unvisited.has(edgeKey(a, b));
            const takeEdge = (a, b) => unvisited.delete(edgeKey(a, b));
            const merged = [];
            while (unvisited.size) {
              const key = unvisited.values().next().value;
              const [aStr, bStr] = key.split('|');
              const a = Number(aStr);
              const b = Number(bStr);
              takeEdge(a, b);
              let start = a;
              let end = b;
              const startNeighbor = b;
              let prev = start;
              let curr = end;
              while (true) {
                const nbrs = (adj.get(curr) || []).filter((n) => n !== prev);
                if (nbrs.length !== 1) break;
                const next = nbrs[0];
                if (!hasEdge(curr, next)) break;
                if (!isColinear(prev, curr, next)) break;
                takeEdge(curr, next);
                prev = curr;
                curr = next;
                end = curr;
              }
              prev = startNeighbor;
              curr = start;
              while (true) {
                const nbrs = (adj.get(curr) || []).filter((n) => n !== prev);
                if (nbrs.length !== 1) break;
                const next = nbrs[0];
                if (!hasEdge(curr, next)) break;
                if (!isColinear(prev, curr, next)) break;
                takeEdge(curr, next);
                prev = curr;
                curr = next;
                start = curr;
              }
              merged.push([start, end]);
            }
            return merged;
          };

          const faceMetaById = meshData.faceMetaById || null;
          const isCylFace = (faceId) => {
            if (!faceMetaById) return false;
            const meta = faceMetaById instanceof Map ? faceMetaById.get(faceId) : faceMetaById[faceId];
            if (meta?.type !== 'cylindrical') return false;
            const radius = Number(meta?.radius ?? meta?.pmiRadiusOverride ?? meta?.pmiRadius);
            return Number.isFinite(radius) && radius > 0;
          };
          const faceCentroids = new Map();
          const faceVertexCounts = new Map();
          for (let i = 0; i < meshData.triangles.length; i++) {
            const tri = meshData.triangles[i];
            const faceId = meshData.triangleFaceIds[i];
            for (let k = 0; k < 3; k++) {
              const vIdx = tri[k];
              const p = pos2d(vIdx);
              const acc = faceCentroids.get(faceId) || { x: 0, y: 0 };
              acc.x += p.x;
              acc.y += p.y;
              faceCentroids.set(faceId, acc);
              faceVertexCounts.set(faceId, (faceVertexCounts.get(faceId) || 0) + 1);
            }
          }
          for (const [faceId, acc] of faceCentroids.entries()) {
            const count = faceVertexCounts.get(faceId) || 1;
            acc.x /= count;
            acc.y /= count;
          }

          const edgeMap = new Map();
          const pushEdge = (a, b, faceId) => {
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (!edgeMap.has(key)) edgeMap.set(key, []);
            edgeMap.get(key).push(faceId);
          };
          for (let i = 0; i < meshData.triangles.length; i++) {
            const tri = meshData.triangles[i];
            const faceId = meshData.triangleFaceIds[i];
            pushEdge(tri[0], tri[1], faceId);
            pushEdge(tri[1], tri[2], faceId);
            pushEdge(tri[2], tri[0], faceId);
          }

          const pinkSegments = [];
          const whiteSegments = [];
          for (const [key, faces] of edgeMap.entries()) {
            const [aStr, bStr] = key.split('|');
            const a = Number(aStr);
            const b = Number(bStr);
            const faceSet = new Set(faces);
            if (faces.length === 1) {
              pinkSegments.push([a, b]);
            } else if (faceSet.size > 1) {
              whiteSegments.push([a, b]);
            }
          }

          const bendEdgeMap = new Map();
          for (const [key, faces] of edgeMap.entries()) {
            const [aStr, bStr] = key.split('|');
            const a = Number(aStr);
            const b = Number(bStr);
            const faceSet = new Set(faces);
            if (faceSet.size > 1) {
              for (const faceId of faceSet) {
                if (!isCylFace(faceId)) continue;
                if (!bendEdgeMap.has(faceId)) bendEdgeMap.set(faceId, []);
                bendEdgeMap.get(faceId).push([a, b]);
              }
            }
          }

          const addEdgeLines = (segments, material, fallbackColor, style = null) => {
            if (!segments.length) return;
            const mergedEdges = mergeColinearEdges(segments);
            if (!mergedEdges.length) return;
            let dashSize = style?.dashSize;
            let gapSize = style?.gapSize;
            if (style?.count) {
              let minLen = Infinity;
              for (const [a, b] of mergedEdges) {
                const ax = meshData.positions[a * 3 + 0];
                const ay = meshData.positions[a * 3 + 1];
                const az = meshData.positions[a * 3 + 2];
                const bx = meshData.positions[b * 3 + 0];
                const by = meshData.positions[b * 3 + 1];
                const bz = meshData.positions[b * 3 + 2];
                const len = Math.hypot(bx - ax, by - ay, bz - az);
                if (len > 1e-9 && len < minLen) minLen = len;
              }
              if (!Number.isFinite(minLen) || minLen <= 0) minLen = 1;
              const seg = minLen / style.count;
              const ratio = Number.isFinite(style.dashRatio) ? style.dashRatio : 0.2;
              dashSize = Math.max(1e-4, seg * ratio);
              gapSize = Math.max(1e-4, seg - dashSize);
            }
            const matColor = material?.color && typeof material.color.getHex === 'function'
              ? material.color.getHex()
              : fallbackColor;
            const lineMaterial = style?.dashed
              ? new THREE.LineDashedMaterial({
                color: matColor,
                linewidth: 2,
                dashSize: dashSize ?? 0.2,
                gapSize: gapSize ?? 9.8,
                depthTest: true,
                depthWrite: false,
              })
              : new THREE.LineBasicMaterial({
                color: matColor,
                linewidth: 2,
                depthTest: true,
                depthWrite: false,
              });
            let edgeIndex = 0;
            for (const [a, b] of mergedEdges) {
              const linePositions = new Float32Array(6);
              linePositions[0] = meshData.positions[a * 3 + 0];
              linePositions[1] = meshData.positions[a * 3 + 1];
              linePositions[2] = meshData.positions[a * 3 + 2];
              linePositions[3] = meshData.positions[b * 3 + 0];
              linePositions[4] = meshData.positions[b * 3 + 1];
              linePositions[5] = meshData.positions[b * 3 + 2];
              const lineGeometry = new THREE.BufferGeometry();
              lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
              const line = new THREE.LineSegments(lineGeometry, lineMaterial);
              if (style?.dashed && typeof line.computeLineDistances === 'function') {
                line.computeLineDistances();
              }
              line.name = `VisualizationEdge_${edgeIndex++}`;
              line.renderOrder = 2;
              mesh.add(line);
              this.visualizationMeshes.push(line);
            }
          };

          addEdgeLines(
            pinkSegments,
            CADmaterials?.FLAT_PATTERN?.OUTER_EDGE,
            0xff5fa2
          );
          addEdgeLines(
            whiteSegments,
            CADmaterials?.FLAT_PATTERN?.INNER_EDGE,
            0x00ffff,
            { dashed: true, count: 10, dashRatio: 0.2 }
          );

          const buildCenterline = (edges, faceId) => {
            if (!edges || edges.length < 2) return null;
            const merged = mergeColinearEdges(edges);
            if (merged.length < 2) return null;
            const centroid = faceCentroids.get(faceId);
            if (!centroid) return null;
            const edgeDir = (a, b) => {
              const pa = pos2d(a);
              const pb = pos2d(b);
              const dx = pb.x - pa.x;
              const dy = pb.y - pa.y;
              const len = Math.hypot(dx, dy);
              if (len < 1e-9) return null;
              return { x: dx / len, y: dy / len };
            };
            const baseDir = edgeDir(merged[0][0], merged[0][1]);
            if (!baseDir) return null;
            const perp = { x: -baseDir.y, y: baseDir.x };
            const groupA = [];
            const groupB = [];
            for (const [a, b] of merged) {
              const dir = edgeDir(a, b);
              if (!dir) continue;
              const dot = dir.x * baseDir.x + dir.y * baseDir.y;
              if (Math.abs(dot) < 0.98) continue;
              const pa = pos2d(a);
              const cross = (baseDir.x * (centroid.y - pa.y)) - (baseDir.y * (centroid.x - pa.x));
              if (cross >= 0) groupA.push([a, b]);
              else groupB.push([a, b]);
            }
            if (!groupA.length || !groupB.length) return null;
            const buildLine = (group) => {
              let minT = Infinity;
              let maxT = -Infinity;
              let offSum = 0;
              let offCount = 0;
              for (const [a, b] of group) {
                const pa = pos2d(a);
                const pb = pos2d(b);
                const ta = pa.x * baseDir.x + pa.y * baseDir.y;
                const tb = pb.x * baseDir.x + pb.y * baseDir.y;
                minT = Math.min(minT, ta, tb);
                maxT = Math.max(maxT, ta, tb);
                offSum += pa.x * perp.x + pa.y * perp.y;
                offSum += pb.x * perp.x + pb.y * perp.y;
                offCount += 2;
              }
              return {
                minT,
                maxT,
                off: offSum / offCount,
              };
            };
            const lineA = buildLine(groupA);
            const lineB = buildLine(groupB);
            if (!lineA || !lineB) return null;
            const minT = Math.min(lineA.minT, lineB.minT);
            const maxT = Math.max(lineA.maxT, lineB.maxT);
            const midOff = (lineA.off + lineB.off) * 0.5;
            const start = {
              x: baseDir.x * minT + perp.x * midOff,
              y: baseDir.y * minT + perp.y * midOff,
            };
            const end = {
              x: baseDir.x * maxT + perp.x * midOff,
              y: baseDir.y * maxT + perp.y * midOff,
            };
            return { start, end };
          };

          const centerMat = CADmaterials?.FLAT_PATTERN?.CENTERLINE;
          const centerColor = centerMat?.color && typeof centerMat.color.getHex === 'function'
            ? centerMat.color.getHex()
            : 0x00ffff;
          const centerlinesInfo = [];
          let minCenterLen = Infinity;
          for (const [faceId, edges] of bendEdgeMap.entries()) {
            const lineInfo = buildCenterline(edges, faceId);
            if (!lineInfo) continue;
            centerlinesInfo.push(lineInfo);
            const len = Math.hypot(
              lineInfo.end.x - lineInfo.start.x,
              lineInfo.end.y - lineInfo.start.y,
            );
            if (len > 1e-9 && len < minCenterLen) minCenterLen = len;
          }
          if (!Number.isFinite(minCenterLen) || minCenterLen <= 0) minCenterLen = 1;
          const centerSeg = minCenterLen / 10;
          const centerDash = Math.max(1e-4, centerSeg * 0.5);
          const centerGap = Math.max(1e-4, centerSeg - centerDash);
          const centerlineMaterial = new THREE.LineDashedMaterial({
            color: centerColor,
            linewidth: 2,
            dashSize: centerDash,
            gapSize: centerGap,
            depthTest: true,
            depthWrite: false,
          });
          let centerlineIndex = 0;
          for (const lineInfo of centerlinesInfo) {
            const linePositions = new Float32Array([
              lineInfo.start.x, lineInfo.start.y, 0,
              lineInfo.end.x, lineInfo.end.y, 0,
            ]);
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
            const line = new THREE.LineSegments(lineGeometry, centerlineMaterial);
            if (typeof line.computeLineDistances === 'function') {
              line.computeLineDistances();
            }
            line.name = `VisualizationCenterline_${centerlineIndex++}`;
            line.renderOrder = 2;
            mesh.add(line);
            this.visualizationMeshes.push(line);
          }
        }
        
        scene.add(mesh);
        this.visualizationMeshes.push(mesh);
        meshCount++;
      }
      
      // Render diagnostic rays if present
      if (entry.visualizationMeshes?.[0]?.diagnosticRays) {
        const rayData = entry.visualizationMeshes[0].diagnosticRays;
        console.log(`[FlatPattern] Rendering ${rayData.length} diagnostic rays`);
        
        for (const ray of rayData) {
          // Create ray line
          const rayEnd = [
            ray.origin[0] + ray.direction[0] * ray.length,
            ray.origin[1] + ray.direction[1] * ray.length,
            ray.origin[2] + ray.direction[2] * ray.length,
          ];
          
          const rayGeometry = new THREE.BufferGeometry();
          rayGeometry.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([...ray.origin, ...rayEnd]), 3
          ));
          
          const rayColor = ray.hitsOriginal && ray.hitsOffsetPositive ? 0x00ff00 : 0xff0000;
          const rayMaterial = new THREE.LineBasicMaterial({ 
            color: rayColor,
            linewidth: 3,
            depthTest: false,
            depthWrite: false,
          });
          
          const rayLine = new THREE.Line(rayGeometry, rayMaterial);
          rayLine.name = `DiagnosticRay_${ray.faceId}`;
          rayLine.renderOrder = 9999;
          scene.add(rayLine);
          this.visualizationMeshes.push(rayLine);
          
          // Create sphere at ray origin (blue)
          const originGeometry = new THREE.SphereGeometry(0.02);
          const originMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x0000ff,
            depthTest: false,
            depthWrite: false,
          });
          const originSphere = new THREE.Mesh(originGeometry, originMaterial);
          originSphere.position.set(ray.origin[0], ray.origin[1], ray.origin[2]);
          originSphere.renderOrder = 10000;
          scene.add(originSphere);
          this.visualizationMeshes.push(originSphere);
          
          // Create sphere at original hit point (green)
          if (ray.originalHitPoint) {
            const hitGeometry = new THREE.SphereGeometry(0.015);
            const hitMaterial = new THREE.MeshBasicMaterial({ 
              color: 0x00ff00,
              depthTest: false,
              depthWrite: false,
            });
            const hitSphere = new THREE.Mesh(hitGeometry, hitMaterial);
            hitSphere.position.set(
              ray.originalHitPoint[0], 
              ray.originalHitPoint[1], 
              ray.originalHitPoint[2]
            );
            hitSphere.renderOrder = 10000;
            scene.add(hitSphere);
            this.visualizationMeshes.push(hitSphere);
          }
          
          // Create sphere at offset hit point (yellow)
          if (ray.offsetHitPoint) {
            const offsetGeometry = new THREE.SphereGeometry(0.015);
            const offsetMaterial = new THREE.MeshBasicMaterial({ 
              color: 0xffff00,
              depthTest: false,
              depthWrite: false,
            });
            const offsetSphere = new THREE.Mesh(offsetGeometry, offsetMaterial);
            offsetSphere.position.set(
              ray.offsetHitPoint[0], 
              ray.offsetHitPoint[1], 
              ray.offsetHitPoint[2]
            );
            offsetSphere.renderOrder = 10000;
            scene.add(offsetSphere);
            this.visualizationMeshes.push(offsetSphere);
          }
        }
      }
    }
    
    console.log(`[FlatPattern] Added ${meshCount} visualization meshes to scene`);
    try { this.viewer?.render?.(); } catch { }
  }

  _clearVisualizationMeshes() {
    if (!this.visualizationMeshes || !this.visualizationMeshes.length) return;
    
    console.log(`[FlatPattern] Clearing ${this.visualizationMeshes.length} visualization meshes`);
    const scene = this._getScene();
    for (const mesh of this.visualizationMeshes) {
      try { scene?.remove(mesh); } catch { }
      try { mesh.geometry?.dispose?.(); } catch { }
      try { mesh.material?.dispose?.(); } catch { }
    }
    this.visualizationMeshes = [];
  }

  _ensureSolidFaces(solid) {
    if (!solid || typeof solid.visualize !== 'function') return;
    const children = Array.isArray(solid.children) ? solid.children : [];
    const hasFaces = children.some((ch) => ch && ch.type === 'FACE');
    const hasEdges = children.some((ch) => ch && ch.type === 'EDGE');
    const hasVerts = children.some((ch) => ch && ch.type === 'VERTEX');
    if (!hasFaces || !hasEdges || !hasVerts) {
      try { solid.visualize(); } catch { }
    }
  }

  _applyFaceVisibility(solid) {
    this._restoreVisibility();
    this.aFaces = [];
    this.aEdgeNames = new Set();
    this.aEdgeLabels = new Set();
    this.aFaceLabels = new Set();
    this.flatOffset = { x: 0, y: 0, z: 0 };
    if (solid) this._ensureSolidFaces(solid);
    const scene = this._getScene();
    if (!scene) return;

    const getFaceTypeByName = (edge, name) => {
      if (!name) return null;
      const parentSolid = edge?.parentSolid || solid;
      if (!parentSolid || typeof parentSolid.getFaceMetadata !== 'function') return null;
      try {
        const meta = parentSolid.getFaceMetadata(name);
        return meta?.sheetMetalFaceType || null;
      } catch { return null; }
    };

    const isAEdge = (edge) => {
      const udType = edge?.userData?.sheetMetalEdgeType;
      if (udType === 'A') return true;
      let hasA = false;
      const faces = Array.isArray(edge?.faces) ? edge.faces : [];
      for (const face of faces) {
        if (resolveSheetMetalFaceType(face) === 'A') {
          hasA = true;
          break;
        }
      }
      if (!hasA) {
        const fa = edge?.userData?.faceA;
        const fb = edge?.userData?.faceB;
        if (getFaceTypeByName(edge, fa) === 'A' || getFaceTypeByName(edge, fb) === 'A') {
          hasA = true;
        }
      }
      if (hasA) return true;
      return false;
    };

    scene.traverse((obj) => {
      if (!obj || obj === this.edgeGroup) return;
      if (obj.type === 'EDGE') {
        if (isAEdge(obj)) {
          if (obj.name) {
            this.aEdgeNames.add(obj.name);
            const label = this._normalizeEdgeLabel(obj.name);
            if (label) this.aEdgeLabels.add(label);
          }
        } else {
          this._hideObject(obj);
        }
        return;
      }
      if (obj.type === 'DATUM' || obj.type === 'PLANE') {
        this._hideObject(obj);
      }
    });

    scene.traverse((obj) => {
      if (!obj || obj.type !== 'FACE') return;
      const faceType = resolveSheetMetalFaceType(obj);
      if (faceType === 'A') {
        this.aFaces.push(obj);
        const faceName = obj.userData?.faceName || obj.name;
        if (faceName) this.aFaceLabels.add(this._safeEdgeName(faceName));
      } else {
        this._hideObject(obj);
      }
    });

    const vertexEdgesFromName = (name) => {
      const match = /^VERTEX\[([^\]]+)\]/.exec(String(name || ''));
      if (!match) return [];
      return match[1].split('+').map((part) => part.trim()).filter(Boolean);
    };

    scene.traverse((obj) => {
      if (!obj) return;
      if (obj.type === 'VERTEX') {
        const edges = vertexEdgesFromName(obj.name);
        const keep = edges.some((edgeName) => this.aEdgeNames.has(edgeName));
        if (!keep) this._hideObject(obj);
        return;
      }
      if (obj.isPoints && obj.parent && obj.parent.type === 'VERTEX') {
        return;
      }
      if (obj.isPoints) {
        this._hideObject(obj);
      }
    });
  }

  _hideObject(obj) {
    if (!obj || this.hiddenSet.has(obj)) return;
    if (obj.visible !== false) {
      this.hiddenObjects.push({ obj, prev: obj.visible });
      this.hiddenSet.add(obj);
      obj.visible = false;
    }
  }

  _restoreVisibility() {
    if (!this.hiddenObjects || !this.hiddenObjects.length) return;
    for (const entry of this.hiddenObjects) {
      const obj = entry?.obj;
      if (!obj) continue;
      if (obj.visible === false) {
        try { obj.visible = entry.prev; } catch { }
      }
    }
    this.hiddenObjects = [];
    this.hiddenSet = new Set();
  }

  _restoreScene() {
    this._clearHighlightedFace();
    this._restoreVisibility();
    this.aFaces = [];
    this.aEdgeNames = new Set();
    this.aEdgeLabels = new Set();
    this.aFaceLabels = new Set();
    this.activeSolid = null;
    if (this.edgeGroup) {
      const scene = this._getScene();
      try { scene?.remove(this.edgeGroup); } catch { }
      this._clearEdgeGroup();
      this.edgeGroup = null;
    }
    try { this.viewer?.render?.(); } catch { }
  }

  _getScene() {
    return this.viewer?.partHistory?.scene || this.viewer?.scene || null;
  }

  _fitToCurrent() {
    if (!this.edgeGroup && (!this.aFaces || !this.aFaces.length)) return;
    const box = new THREE.Box3();
    let has = false;
    if (this.aFaces && this.aFaces.length) {
      for (const face of this.aFaces) {
        if (!face || face.visible === false) continue;
        try {
          const faceBox = new THREE.Box3().setFromObject(face);
          if (!faceBox.isEmpty()) { box.union(faceBox); has = true; }
        } catch { }
      }
    }
    if (this.edgeGroup) {
      try {
        const edgeBox = new THREE.Box3().setFromObject(this.edgeGroup);
        if (!edgeBox.isEmpty()) { box.union(edgeBox); has = true; }
      } catch { }
    }
    if (!has) return;
    _fitBoxToView(this.viewer, box, 1.15);
  }

  _getFlatPatternColors() {
    const flat = CADmaterials?.FLAT_PATTERN || {};
    const asHex = (mat, fallback) => {
      if (mat?.color && typeof mat.color.getHexString === 'function') {
        return `#${mat.color.getHexString()}`;
      }
      return fallback;
    };
    return {
      outer: asHex(flat.OUTER_EDGE, '#ff5fa2'),
      inner: asHex(flat.INNER_EDGE, '#00ffff'),
      center: asHex(flat.CENTERLINE, '#00ffff'),
    };
  }

  async _exportSvg() {
    const solids = this._solids?.length ? this._solids : _collectSolids(this.viewer);
    if (!solids.length) {
      this._setEmpty('No solids to export.');
      return;
    }
    const metadataManager = this.viewer?.partHistory?.metadataManager || null;
    const svgEntries = buildSheetMetalFlatPatternSvgs(solids, {
      metadataManager,
      flatPatternColors: this._getFlatPatternColors(),
    });
    if (!svgEntries.length) {
      this._setEmpty('No flat pattern SVGs available.');
      return;
    }
    if (svgEntries.length === 1) {
      const entry = svgEntries[0];
      const safe = _safeName(entry.name || 'flat');
      _download(`${safe}_flat.svg`, entry.svg, 'image/svg+xml');
      return;
    }
    const zip = new JSZip();
    for (const entry of svgEntries) {
      const safe = _safeName(entry.name || 'flat');
      zip.file(`${safe}_flat.svg`, entry.svg);
    }
    const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const base = _safeName(this.viewer?.fileManagerWidget?.currentName || 'flatpattern');
    _download(`${base}_flatpattern.zip`, blob, 'application/zip');
  }

  async _exportDxf() {
    const solids = this._solids?.length ? this._solids : _collectSolids(this.viewer);
    if (!solids.length) {
      this._setEmpty('No solids to export.');
      return;
    }
    const metadataManager = this.viewer?.partHistory?.metadataManager || null;
    const dxfEntries = buildSheetMetalFlatPatternDxfs(solids, {
      metadataManager,
      flatPatternColors: this._getFlatPatternColors(),
    });
    if (!dxfEntries.length) {
      this._setEmpty('No flat pattern DXFs available.');
      return;
    }
    if (dxfEntries.length === 1) {
      const entry = dxfEntries[0];
      const safe = _safeName(entry.name || 'flat');
      _download(`${safe}_flat.dxf`, entry.dxf, 'application/dxf');
      return;
    }
    const zip = new JSZip();
    for (const entry of dxfEntries) {
      const safe = _safeName(entry.name || 'flat');
      zip.file(`${safe}_flat.dxf`, entry.dxf);
    }
    const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const base = _safeName(this.viewer?.fileManagerWidget?.currentName || 'flatpattern');
    _download(`${base}_flatpattern_dxf.zip`, blob, 'application/zip');
  }

  _setEmpty(text) {
    if (!this.ui.empty) return;
    this.ui.empty.textContent = String(text || '');
  }
}

export function createFlatPatternButton(viewer) {
  const onClick = () => {
    if (!viewer) return;
    if (!viewer[PANEL_KEY]) viewer[PANEL_KEY] = new FlatPatternUnfoldPanel(viewer);
    viewer[PANEL_KEY].toggle();
  };
  return { label: 'FP', title: 'Flat Pattern Unfold', onClick };
}

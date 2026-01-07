import JSZip from 'jszip';
import * as THREE from 'three';
import { Line2, LineGeometry, LineMaterial } from 'three/examples/jsm/Addons.js';
import { FloatingWindow } from '../FloatingWindow.js';
import {
  buildSheetMetalFlatPatternDebugSteps,
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
      .flat-unfold-content { display:flex; flex-direction:column; gap:10px; padding:10px; width:100%; height:100%; box-sizing:border-box; color:#e5e7eb; }
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
      .flat-unfold-detail { font-size:12px; color:#cfd6e4; background:rgba(8,10,14,.55); border:1px solid #1f2937; border-radius:8px; padding:8px; max-height:120px; overflow:auto; white-space:pre-wrap; line-height:1.35; }
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

    const btnFit = document.createElement('button');
    btnFit.className = 'flat-unfold-btn';
    btnFit.textContent = 'Fit';
    btnFit.addEventListener('click', () => this._fitToCurrent());

    const btnExport = document.createElement('button');
    btnExport.className = 'flat-unfold-btn';
    btnExport.textContent = 'Export SVG';
    btnExport.addEventListener('click', () => this._exportSvg());

    fw.addHeaderAction(btnFit);
    fw.addHeaderAction(btnExport);

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

    const rowControls = document.createElement('div');
    rowControls.className = 'flat-unfold-row';
    const btnPrev = document.createElement('button');
    btnPrev.className = 'flat-unfold-btn';
    btnPrev.textContent = 'Prev';
    btnPrev.addEventListener('click', () => this._stepBy(-1));
    const btnPlay = document.createElement('button');
    btnPlay.className = 'flat-unfold-btn';
    btnPlay.textContent = 'Play';
    btnPlay.addEventListener('click', () => this._togglePlayback());
    const btnNext = document.createElement('button');
    btnNext.className = 'flat-unfold-btn';
    btnNext.textContent = 'Next';
    btnNext.addEventListener('click', () => this._stepBy(1));
    const stepLabel = document.createElement('div');
    stepLabel.className = 'flat-unfold-step';
    rowControls.appendChild(btnPrev);
    rowControls.appendChild(btnPlay);
    rowControls.appendChild(btnNext);
    rowControls.appendChild(stepLabel);

    const rowSlider = document.createElement('div');
    rowSlider.className = 'flat-unfold-row';
    const labStep = document.createElement('div');
    labStep.className = 'flat-unfold-label';
    labStep.textContent = 'Step';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'flat-unfold-slider';
    slider.min = '0';
    slider.max = '0';
    slider.step = '1';
    slider.value = '0';
    slider.addEventListener('input', () => this._setStepIndex(Number(slider.value)));
    rowSlider.appendChild(labStep);
    rowSlider.appendChild(slider);

    const hint = document.createElement('div');
    hint.className = 'flat-unfold-hint';
    hint.textContent = 'Unfolds the A-side sheet metal faces. Cylindrical bends are stretched/shrunk on the neutral surface.';

    const detail = document.createElement('div');
    detail.className = 'flat-unfold-detail';
    detail.textContent = '';

    const empty = document.createElement('div');
    empty.className = 'flat-unfold-empty';
    empty.textContent = '';

    content.appendChild(rowSolid);
    content.appendChild(rowControls);
    content.appendChild(rowSlider);
    content.appendChild(hint);
    content.appendChild(detail);
    content.appendChild(empty);

    this.ui = {
      selSolid,
      btnPlay,
      stepLabel,
      slider,
      detail,
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
    const allSteps = Array.isArray(entry?.debugSteps) ? entry.debugSteps : [];
    const placementSteps = allSteps.filter((step) => /^Component\s/.test(String(step?.label || '')));
    this.steps = placementSteps.length ? placementSteps : allSteps;
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
    this._renderStep(true);
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
    const baseFace = this._pickBaseFace();
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

  _pickBaseFace() {
    if (!this.aFaces || !this.aFaces.length) return null;
    let bestPlanar = null;
    let bestPlanarArea = -Infinity;
    let best = null;
    let bestArea = -Infinity;
    for (const face of this.aFaces) {
      if (!face) continue;
      const area = this._faceArea(face);
      if (area > bestArea) { best = face; bestArea = area; }
      let meta = null;
      try { meta = typeof face.getMetadata === 'function' ? face.getMetadata() : null; } catch { meta = null; }
      const isCyl = meta?.type === 'cylindrical';
      if (!isCyl && area > bestPlanarArea) {
        bestPlanar = face;
        bestPlanarArea = area;
      }
    }
    return bestPlanar || best;
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
    const uAxis = far.clone().sub(origin).normalize();
    if (Math.abs(uAxis.dot(normal)) > 0.99) {
      const ref = new THREE.Vector3(1, 0, 0);
      const alt = new THREE.Vector3(0, 1, 0);
      const fallback = new THREE.Vector3().crossVectors(normal, ref);
      if (fallback.lengthSq() < 1e-12) fallback.crossVectors(normal, alt);
      uAxis.copy(fallback.normalize());
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
    this._renderStepPaths(stepPaths, { highlightLabels, highlightFaceId });
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
    const lines = [];
    lines.push(`Purpose: ${purpose}`);
    if (newPaths.length) {
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
    }
    this.ui.detail.textContent = lines.join('\n');
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
    if (!Array.isArray(paths) || !paths.length) return;
    const basis = this.flatBasis;
    const useBasis = !!(basis && basis.origin && basis.uAxis && basis.vAxis);
    const highlightLabels = opts.highlightLabels instanceof Set ? opts.highlightLabels : new Set();
    const highlightFaceId = Number.isFinite(opts.highlightFaceId) ? opts.highlightFaceId : null;
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

  async _exportSvg() {
    const solids = this._solids?.length ? this._solids : _collectSolids(this.viewer);
    if (!solids.length) {
      this._setEmpty('No solids to export.');
      return;
    }
    const metadataManager = this.viewer?.partHistory?.metadataManager || null;
    const svgEntries = buildSheetMetalFlatPatternSvgs(solids, { metadataManager });
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

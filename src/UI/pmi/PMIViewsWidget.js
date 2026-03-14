// PMIViewsWidget.js
// ES6, no frameworks. Provides a simple list of saved PMI views
// (camera snapshots) with capture, rename, apply, and delete.
// Views are persisted with the PartHistory instance.

import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { AnnotationHistory } from './AnnotationHistory.js';
import { CADmaterials } from '../CADmaterials.js';
import { adjustOrthographicFrustum, applyCameraSnapshot, captureCameraSnapshot } from './annUtils.js';

const UPDATE_CAMERA_TOOLTIP = 'Update this view to match the current camera';
const PMI_EXPORT_CAPTURE_WIDTH_PX = 2400;
const PMI_EXPORT_CAPTURE_HEIGHT_PX = 1800;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class PMIViewsWidget {
  constructor(viewer, { readOnly = false } = {}) {
    this.viewer = viewer;
    this._readOnly = !!readOnly;
    this.uiElement = document.createElement('div');
    this.uiElement.className = 'pmi-views-root';
    this._ensureStyles();

    this.views = [];
    this._activeViewIndex = null;
    this._activeMenu = null;
    this._menuOutsideHandler = null;
    this._onHistoryViewsChanged = (views) => {
      this.views = Array.isArray(views) ? views : this._getViewsFromHistory();
      this._renderList();
    };

    this._buildUI();
    this.refreshFromHistory();
    this._renderList();

    try {
      const manager = this.viewer?.partHistory?.pmiViewsManager;
      this._removeHistoryListener = manager ? manager.addListener(this._onHistoryViewsChanged) : null;
    } catch {
      this._removeHistoryListener = null;
    }
  }

  dispose() {
    if (typeof this._removeHistoryListener === 'function') {
      try { this._removeHistoryListener(); } catch {}
    }
    this._removeHistoryListener = null;
    this._closeActiveMenu();
  }

  refreshFromHistory() {
    this.views = this._getViewsFromHistory();
  }

  _getViewsFromHistory() {
    try {
      const manager = this.viewer?.partHistory?.pmiViewsManager;
      if (!manager || typeof manager.getViews !== 'function') return [];
      const views = manager.getViews();
      return Array.isArray(views) ? views : [];
    } catch {
      return [];
    }
  }

  _getActiveViewIndex() {
    const modeIndex = this.viewer?._pmiMode?.viewIndex;
    if (Number.isInteger(modeIndex) && modeIndex >= 0) return modeIndex;
    if (Number.isInteger(this._activeViewIndex) && this._activeViewIndex >= 0) return this._activeViewIndex;
    return null;
  }

  _setActiveViewIndex(index) {
    if (Number.isInteger(index) && index >= 0) {
      this._activeViewIndex = index;
    } else {
      this._activeViewIndex = null;
    }
  }

  _resolveViewName(view, index) {
    const fallback = `View ${index + 1}`;
    if (!view || typeof view !== 'object') return fallback;
    const name = typeof view.viewName === 'string' ? view.viewName : (typeof view.name === 'string' ? view.name : '');
    const trimmed = String(name || '').trim();
    return trimmed || fallback;
  }

  _getViewerViewportMetrics() {
    const dom = this.viewer?.renderer?.domElement || null;
    const rect = dom?.getBoundingClientRect?.();
    const width = Math.max(1, Number(rect?.width) || Number(dom?.clientWidth) || Number(dom?.width) || 1);
    const height = Math.max(1, Number(rect?.height) || Number(dom?.clientHeight) || Number(dom?.height) || 1);
    return { width, height };
  }

  _getSavedViewViewport(view) {
    const viewport = view?.camera?.viewport;
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  }

  _getCaptureViewportMetrics(_view) {
    return {
      width: PMI_EXPORT_CAPTURE_WIDTH_PX,
      height: PMI_EXPORT_CAPTURE_HEIGHT_PX,
    };
  }

  _updateViewportSensitiveRendering(width, height, viewerContext = this.viewer) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    try {
      const scene = viewerContext?.partHistory?.scene || viewerContext?.scene || null;
      scene?.traverse?.((obj) => {
        const material = obj?.material;
        if (!material) return;
        const apply = (mat) => {
          if (mat?.resolution && typeof mat.resolution.set === 'function') {
            mat.resolution.set(safeWidth, safeHeight);
          }
        };
        if (Array.isArray(material)) material.forEach(apply);
        else apply(material);
      });
    } catch { /* ignore */ }
    try { viewerContext?._updateOverlayDashSpacing?.(safeWidth, safeHeight); } catch { /* ignore */ }
  }

  async _withTemporaryCaptureViewport(viewport, fn) {
    const renderer = this.viewer?.renderer || null;
    if (!renderer || typeof fn !== 'function') return await fn(viewport);

    const size = typeof renderer.getSize === 'function' ? renderer.getSize(new THREE.Vector2()) : null;
    const originalWidth = Math.max(1, Number(size?.x) || Number(renderer.domElement?.width) || 1);
    const originalHeight = Math.max(1, Number(size?.y) || Number(renderer.domElement?.height) || 1);
    const originalPixelRatio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;

    try {
      if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(1);
      renderer.setSize(viewport.width, viewport.height, false);
      this._updateViewportSensitiveRendering(viewport.width, viewport.height);
      return await fn(viewport);
    } finally {
      try {
        if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(originalPixelRatio);
        renderer.setSize(originalWidth, originalHeight, false);
      } catch { /* ignore restore errors */ }
      this._updateViewportSensitiveRendering(originalWidth, originalHeight);
      try { this.viewer?.render?.(); } catch { /* ignore restore render */ }
    }
  }

  _cameraChildContainsLight(node) {
    if (!node) return false;
    if (node.isLight) return true;
    const children = Array.isArray(node.children) ? node.children : [];
    return children.some((child) => this._cameraChildContainsLight(child));
  }

  _cloneCameraLightChildren(sourceCamera, targetCamera) {
    if (!sourceCamera || !targetCamera) return;
    const existingChildren = Array.isArray(targetCamera.children) ? targetCamera.children.slice() : [];
    for (const child of existingChildren) {
      if (!this._cameraChildContainsLight(child)) continue;
      try { targetCamera.remove(child); } catch { /* ignore remove failures */ }
    }

    const sourceChildren = Array.isArray(sourceCamera.children) ? sourceCamera.children : [];
    for (const child of sourceChildren) {
      if (!this._cameraChildContainsLight(child)) continue;
      try { targetCamera.add(child.clone(true)); } catch { /* ignore clone failures */ }
    }
  }

  _createExportCamera(view, viewport) {
    const sourceCamera = this.viewer?.camera || null;
    const viewType = String(view?.camera?.type || '');
    const projectionKind = String(view?.camera?.projection?.kind || '').toLowerCase();
    let camera = null;

    if ((viewType === 'PerspectiveCamera' || projectionKind === 'perspective') && sourceCamera?.isPerspectiveCamera) {
      camera = sourceCamera.clone(true);
    } else if ((viewType === 'OrthographicCamera' || projectionKind === 'orthographic') && sourceCamera?.isOrthographicCamera) {
      camera = sourceCamera.clone(true);
    } else if (viewType === 'PerspectiveCamera' || projectionKind === 'perspective') {
      camera = new THREE.PerspectiveCamera(
        sourceCamera?.fov || 50,
        Math.max(1, viewport?.width || 1) / Math.max(1, viewport?.height || 1),
        sourceCamera?.near || 0.01,
        sourceCamera?.far || 2000,
      );
    } else if (viewType === 'OrthographicCamera' || projectionKind === 'orthographic') {
      camera = new THREE.OrthographicCamera(
        -1,
        1,
        1,
        -1,
        sourceCamera?.near || 0.01,
        sourceCamera?.far || 2000,
      );
    } else if (sourceCamera?.clone) {
      camera = sourceCamera.clone(true);
    }

    if (!camera) {
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000);
    }

    this._cloneCameraLightChildren(sourceCamera, camera);
    return camera;
  }

  _copyRendererState(sourceRenderer, targetRenderer) {
    if (!sourceRenderer || !targetRenderer) return;
    try {
      if ('outputColorSpace' in sourceRenderer && 'outputColorSpace' in targetRenderer) {
        targetRenderer.outputColorSpace = sourceRenderer.outputColorSpace;
      }
    } catch { /* ignore */ }
    try {
      if ('toneMapping' in sourceRenderer && 'toneMapping' in targetRenderer) {
        targetRenderer.toneMapping = sourceRenderer.toneMapping;
      }
      if ('toneMappingExposure' in sourceRenderer && 'toneMappingExposure' in targetRenderer) {
        targetRenderer.toneMappingExposure = sourceRenderer.toneMappingExposure;
      }
    } catch { /* ignore */ }
    try {
      if ('sortObjects' in sourceRenderer && 'sortObjects' in targetRenderer) {
        targetRenderer.sortObjects = sourceRenderer.sortObjects;
      }
      if ('autoClear' in sourceRenderer && 'autoClear' in targetRenderer) {
        targetRenderer.autoClear = sourceRenderer.autoClear;
      }
      if ('localClippingEnabled' in sourceRenderer && 'localClippingEnabled' in targetRenderer) {
        targetRenderer.localClippingEnabled = sourceRenderer.localClippingEnabled;
      }
    } catch { /* ignore */ }
    try {
      const srcShadowMap = sourceRenderer.shadowMap;
      const dstShadowMap = targetRenderer.shadowMap;
      if (srcShadowMap && dstShadowMap) {
        if ('enabled' in srcShadowMap) dstShadowMap.enabled = srcShadowMap.enabled;
        if ('autoUpdate' in srcShadowMap) dstShadowMap.autoUpdate = srcShadowMap.autoUpdate;
        if ('needsUpdate' in srcShadowMap) dstShadowMap.needsUpdate = srcShadowMap.needsUpdate;
        if ('type' in srcShadowMap) dstShadowMap.type = srcShadowMap.type;
      }
    } catch { /* ignore */ }
  }

  _updateExportCameraLightRig(renderContext) {
    const sourceRig = this.viewer?._cameraLightRig || null;
    const camera = renderContext?.camera || null;
    const viewport = renderContext?.viewport || null;
    if (!sourceRig || !camera || !viewport) return;

    const pointLights = (Array.isArray(camera.children) ? camera.children : [])
      .filter((child) => child?.isPointLight);
    const lightDirections = Array.isArray(sourceRig.lightDirections) ? sourceRig.lightDirections : [];
    const baseLightRadius = Number(sourceRig.baseLightRadius) || 15;
    if (!pointLights.length || !lightDirections.length) return;

    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const wpp = this._worldPerPixel(camera, width, height);
    const screenDiagonal = Math.sqrt(width * width + height * height);
    const radius = Math.max(baseLightRadius, wpp * screenDiagonal * 1.4);

    pointLights.forEach((light, idx) => {
      const dir = lightDirections[idx] || lightDirections[lightDirections.length - 1] || [0, 0, 0];
      light.position.set(
        Number(dir[0]) * radius,
        Number(dir[1]) * radius,
        Number(dir[2]) * radius,
      );
    });
  }

  _normalizeExportRenderMode(renderMode, fallback = 'shaded') {
    const key = String(renderMode || fallback).trim().toLowerCase();
    return key === 'monochrome' ? 'monochrome' : 'shaded';
  }

  _isMonochromeExport(renderContext = null) {
    return this._normalizeExportRenderMode(renderContext?.renderMode, 'shaded') === 'monochrome';
  }

  _shouldRenderMonochromeCenterLines(renderContext = null) {
    return this._isMonochromeExport(renderContext) && renderContext?.showCenterLines === true;
  }

  _createTransparentImageDataUrl(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Number(width) || 1);
    canvas.height = Math.max(1, Number(height) || 1);
    return canvas.toDataURL('image/png');
  }

  _applyMonochromeAnnotationStyle(group) {
    group?.traverse?.((obj) => {
      const applyMaterial = (material) => {
        if (!material || typeof material !== 'object') return;
        try { material.color?.set?.(0x000000); } catch { /* ignore */ }
        try { material.emissive?.set?.(0x000000); } catch { /* ignore */ }
        try {
          if ('toneMapped' in material) material.toneMapped = false;
        } catch { /* ignore */ }
        return material;
      };
      if (Array.isArray(obj?.material)) {
        obj.material = obj.material.map((material) => applyMaterial(this._cloneExportMaterial(material)));
      } else if (obj?.material) {
        obj.material = applyMaterial(this._cloneExportMaterial(obj.material));
      }
    });
  }

  _applyMonochromeCenterlineStyle(objects = [], renderContext = null) {
    const viewport = renderContext?.viewport || {};
    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const applyMaterial = (material) => {
      const clone = this._cloneExportMaterial(material);
      if (!clone || typeof clone !== 'object') return clone;
      try { clone.color?.set?.(0x000000); } catch { /* ignore */ }
      try { clone.emissive?.set?.(0x000000); } catch { /* ignore */ }
      try {
        if ('toneMapped' in clone) clone.toneMapped = false;
        if ('depthTest' in clone) clone.depthTest = false;
        if ('depthWrite' in clone) clone.depthWrite = false;
        if ('transparent' in clone) clone.transparent = true;
        if ('opacity' in clone) clone.opacity = 1;
        if ('dashed' in clone) clone.dashed = true;
        if ('dashSize' in clone && !(Number.isFinite(clone.dashSize) && clone.dashSize > 0)) clone.dashSize = 0.5;
        if ('gapSize' in clone && !(Number.isFinite(clone.gapSize) && clone.gapSize > 0)) clone.gapSize = 0.5;
        if (clone.resolution && typeof clone.resolution.set === 'function') clone.resolution.set(width, height);
      } catch { /* ignore */ }
      return clone;
    };
    for (const obj of objects) {
      if (!obj) continue;
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(applyMaterial);
      } else if (obj.material) {
        obj.material = applyMaterial(obj.material);
      }
    }
  }

  _applyMonochromeEdgeStyle(objects = [], renderContext = null) {
    const viewport = renderContext?.viewport || {};
    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const applyMaterial = (material) => {
      const clone = this._cloneExportMaterial(material);
      if (!clone || typeof clone !== 'object') return clone;
      try { clone.color?.set?.(0x000000); } catch { /* ignore */ }
      try { clone.emissive?.set?.(0x000000); } catch { /* ignore */ }
      try {
        if ('toneMapped' in clone) clone.toneMapped = false;
        if ('depthTest' in clone) clone.depthTest = false;
        if ('depthWrite' in clone) clone.depthWrite = false;
        if ('transparent' in clone) clone.transparent = true;
        if ('opacity' in clone) clone.opacity = 1;
        if (clone.resolution && typeof clone.resolution.set === 'function') clone.resolution.set(width, height);
      } catch { /* ignore */ }
      return clone;
    };
    for (const obj of objects) {
      if (!obj) continue;
      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(applyMaterial);
      } else if (obj.material) {
        obj.material = applyMaterial(obj.material);
      }
    }
  }

  _buildSvgLineFromLine2(obj) {
    const geom = obj?.geometry;
    const start = geom?.attributes?.instanceStart;
    const end = geom?.attributes?.instanceEnd;
    let positions = null;
    if (start && end && Number.isFinite(start.count) && start.count > 0) {
      const count = Math.min(start.count, end.count);
      positions = new Float32Array(count * 6);
      for (let i = 0; i < count; i += 1) {
        positions[i * 6] = start.getX(i);
        positions[i * 6 + 1] = start.getY(i);
        positions[i * 6 + 2] = start.getZ(i);
        positions[i * 6 + 3] = end.getX(i);
        positions[i * 6 + 4] = end.getY(i);
        positions[i * 6 + 5] = end.getZ(i);
      }
    } else if (geom?.attributes?.position?.count >= 2) {
      const pos = geom.attributes.position;
      const segCount = pos.count - 1;
      positions = new Float32Array(segCount * 6);
      for (let i = 0; i < segCount; i += 1) {
        positions[i * 6] = pos.getX(i);
        positions[i * 6 + 1] = pos.getY(i);
        positions[i * 6 + 2] = pos.getZ(i);
        positions[i * 6 + 3] = pos.getX(i + 1);
        positions[i * 6 + 4] = pos.getY(i + 1);
        positions[i * 6 + 5] = pos.getZ(i + 1);
      }
    }

    if (!positions || positions.length < 6) return null;

    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const geomOut = new THREE.BufferGeometry();
    geomOut.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const color = material?.color ? material.color : new THREE.Color('#000000');
    const opacity = Number.isFinite(material?.opacity) ? material.opacity : 1;
    const transparent = Boolean(material?.transparent) || opacity < 1;
    const linewidth = Number.isFinite(material?.linewidth) ? material.linewidth : 1;
    let matOut = null;

    if (material?.dashed || material?.isLineDashedMaterial) {
      matOut = new THREE.LineDashedMaterial({
        color,
        linewidth,
        transparent,
        opacity,
        dashSize: Number.isFinite(material?.dashSize) ? material.dashSize : 0.5,
        gapSize: Number.isFinite(material?.gapSize) ? material.gapSize : 0.5,
      });
    } else {
      matOut = new THREE.LineBasicMaterial({
        color,
        linewidth,
        transparent,
        opacity,
      });
    }

    try {
      if ('depthTest' in matOut) matOut.depthTest = false;
      if ('depthWrite' in matOut) matOut.depthWrite = false;
    } catch { /* ignore */ }

    const line = new THREE.LineSegments(geomOut, matOut);
    line.matrixAutoUpdate = false;
    try { line.matrix.copy(obj.matrixWorld); } catch { /* ignore */ }
    try { line.matrixWorld.copy(obj.matrixWorld); } catch { /* ignore */ }
    line.renderOrder = Number.isFinite(obj?.renderOrder) ? obj.renderOrder : 2;
    line.visible = true;
    if (matOut.isLineDashedMaterial) {
      try { line.computeLineDistances(); } catch { /* ignore */ }
    }
    return line;
  }

  _collectMeshContourSegments(mesh, camera, out = []) {
    const geom = mesh?.geometry;
    const posAttr = geom?.attributes?.position;
    if (!mesh?.isMesh || !posAttr || posAttr.count < 3 || !camera) return out;

    const indexAttr = geom.index;
    const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
    if (triCount <= 0) return out;

    const edgeMap = new Map();
    const aLocal = this._svgContourVecA || (this._svgContourVecA = new THREE.Vector3());
    const bLocal = this._svgContourVecB || (this._svgContourVecB = new THREE.Vector3());
    const cLocal = this._svgContourVecC || (this._svgContourVecC = new THREE.Vector3());
    const aWorld = this._svgContourWorldA || (this._svgContourWorldA = new THREE.Vector3());
    const bWorld = this._svgContourWorldB || (this._svgContourWorldB = new THREE.Vector3());
    const cWorld = this._svgContourWorldC || (this._svgContourWorldC = new THREE.Vector3());
    const ab = this._svgContourAb || (this._svgContourAb = new THREE.Vector3());
    const ac = this._svgContourAc || (this._svgContourAc = new THREE.Vector3());
    const normal = this._svgContourNormal || (this._svgContourNormal = new THREE.Vector3());
    const center = this._svgContourCenter || (this._svgContourCenter = new THREE.Vector3());
    const viewToCamera = this._svgContourView || (this._svgContourView = new THREE.Vector3());
    const orthoViewToCamera = this._svgContourOrthoView || (this._svgContourOrthoView = new THREE.Vector3());
    const cameraWorld = this._svgContourCameraWorld || (this._svgContourCameraWorld = new THREE.Vector3());
    const isOrtho = camera.isOrthographicCamera;

    if (isOrtho) {
      try { camera.getWorldDirection(orthoViewToCamera); } catch { orthoViewToCamera.set(0, 0, -1); }
      orthoViewToCamera.multiplyScalar(-1);
    } else {
      try { camera.getWorldPosition(cameraWorld); } catch { cameraWorld.copy(camera.position || new THREE.Vector3()); }
    }

    const quantize = (value) => Number(Number(value).toFixed(6));
    const nonIndexedKey = (ax, ay, az, bx, by, bz) => {
      const aKey = `${quantize(ax)},${quantize(ay)},${quantize(az)}`;
      const bKey = `${quantize(bx)},${quantize(by)},${quantize(bz)}`;
      return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    };
    const addEdge = (key, startWorld, endWorld, frontFacing) => {
      if (!key) return;
      const entry = edgeMap.get(key) || {
        ax: startWorld.x,
        ay: startWorld.y,
        az: startWorld.z,
        bx: endWorld.x,
        by: endWorld.y,
        bz: endWorld.z,
        front: false,
        back: false,
        count: 0,
      };
      entry.count += 1;
      if (frontFacing) entry.front = true;
      else entry.back = true;
      edgeMap.set(key, entry);
    };

    for (let tri = 0; tri < triCount; tri += 1) {
      const ia = indexAttr ? indexAttr.getX(tri * 3) : tri * 3;
      const ib = indexAttr ? indexAttr.getX(tri * 3 + 1) : tri * 3 + 1;
      const ic = indexAttr ? indexAttr.getX(tri * 3 + 2) : tri * 3 + 2;
      if (![ia, ib, ic].every((index) => Number.isFinite(index) && index >= 0)) continue;

      aLocal.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
      bLocal.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
      cLocal.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
      aWorld.copy(aLocal).applyMatrix4(mesh.matrixWorld);
      bWorld.copy(bLocal).applyMatrix4(mesh.matrixWorld);
      cWorld.copy(cLocal).applyMatrix4(mesh.matrixWorld);

      ab.subVectors(bWorld, aWorld);
      ac.subVectors(cWorld, aWorld);
      normal.crossVectors(ab, ac);
      if (normal.lengthSq() <= 1e-12) continue;
      normal.normalize();

      if (isOrtho) {
        viewToCamera.copy(orthoViewToCamera);
      } else {
        center.copy(aWorld).add(bWorld).add(cWorld).multiplyScalar(1 / 3);
        viewToCamera.subVectors(cameraWorld, center);
        if (viewToCamera.lengthSq() <= 1e-12) continue;
        viewToCamera.normalize();
      }

      const frontFacing = normal.dot(viewToCamera) >= 0;
      addEdge(
        indexAttr ? (ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`) : nonIndexedKey(aLocal.x, aLocal.y, aLocal.z, bLocal.x, bLocal.y, bLocal.z),
        aWorld,
        bWorld,
        frontFacing,
      );
      addEdge(
        indexAttr ? (ib < ic ? `${ib}:${ic}` : `${ic}:${ib}`) : nonIndexedKey(bLocal.x, bLocal.y, bLocal.z, cLocal.x, cLocal.y, cLocal.z),
        bWorld,
        cWorld,
        frontFacing,
      );
      addEdge(
        indexAttr ? (ic < ia ? `${ic}:${ia}` : `${ia}:${ic}`) : nonIndexedKey(cLocal.x, cLocal.y, cLocal.z, aLocal.x, aLocal.y, aLocal.z),
        cWorld,
        aWorld,
        frontFacing,
      );
    }

    for (const entry of edgeMap.values()) {
      if (entry.count < 2) continue;
      if (!entry.front || !entry.back) continue;
      out.push(entry.ax, entry.ay, entry.az, entry.bx, entry.by, entry.bz);
    }
    return out;
  }

  _buildMonochromeSvgContourGroup(renderContext) {
    const scene = renderContext?.scene || null;
    const camera = renderContext?.camera || null;
    if (!scene?.traverse || !camera) return null;

    const positions = [];
    scene.traverse((obj) => {
      if (!obj?.visible || !obj.isMesh || obj.type !== 'FACE') return;
      this._collectMeshContourSegments(obj, camera, positions);
    });
    if (positions.length < 6) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
    const lineWidth = Number(CADmaterials?.EDGE?.BASE?.linewidth);
    const material = new THREE.LineBasicMaterial({
      color: 0x000000,
      linewidth: Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : 1,
      transparent: true,
      opacity: 1,
    });
    material.depthTest = false;
    material.depthWrite = false;

    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = 2;
    const group = new THREE.Group();
    group.name = '__PMI_MONO_SVG_CONTOURS__';
    group.userData.__pmiSvgContent = true;
    group.add(line);
    return group;
  }

  _buildLabelLayout(labels, width, height, cssWidth = null, renderContext = null, { svgCentered = false } = {}) {
    const camera = renderContext?.viewer?.camera || this.viewer?.camera;
    const isMonochrome = this._isMonochromeExport(renderContext);
    const safeCssWidth = Math.max(1, cssWidth || width);
    const dpr = Math.max(1, width / safeCssWidth);
    const paddingX = 8 * dpr;
    const paddingY = 6 * dpr;
    const lineHeight = 18 * dpr;
    const radius = 8 * dpr;
    const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const fontSize = 14 * dpr;

    const layout = [];
    labels.forEach((label) => {
      if (!label || !label.world || label.text == null) return;
      const screen = svgCentered
        ? this._projectWorldToSvgScreen(label.world, camera, { width, height })
        : this._projectWorldToScreen(label.world, camera, { width, height });
      if (!screen) return;
      const lines = String(label.text).split(/\r?\n/);
      const textWidth = lines.reduce((max, line) => Math.max(max, this._measureTextApprox(line, fontSize, fontFamily)), 0);
      const boxWidth = textWidth + paddingX * 2;
      const boxHeight = lines.length * lineHeight + paddingY * 2;
      const { ox, oy } = this._resolveLabelAnchorOffsets(label.anchor);
      const x = screen.x - ox * boxWidth;
      const y = screen.y - oy * boxHeight;
      layout.push({ x, y, boxWidth, boxHeight, lines });
    });

    return {
      dpr,
      isMonochrome,
      paddingX,
      paddingY,
      lineHeight,
      radius,
      fontFamily,
      fontSize,
      layout,
    };
  }

  _appendSvgLabels(target, labels, width, height, renderContext = null) {
    if (!target || !Array.isArray(labels) || labels.length === 0) return null;
    const layoutData = this._buildLabelLayout(labels, width, height, width, renderContext, { svgCentered: true });
    if (!layoutData.layout.length) return null;

    const labelGroup = document.createElementNS(SVG_NS, 'g');
    labelGroup.setAttribute('data-pmi-labels', 'true');
    const {
      isMonochrome,
      paddingX,
      paddingY,
      lineHeight,
      radius,
      fontFamily,
      fontSize,
      layout,
    } = layoutData;

    for (const entry of layout) {
      if (!isMonochrome) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', entry.x.toFixed(3));
        rect.setAttribute('y', entry.y.toFixed(3));
        rect.setAttribute('rx', String(radius));
        rect.setAttribute('ry', String(radius));
        rect.setAttribute('width', entry.boxWidth.toFixed(3));
        rect.setAttribute('height', entry.boxHeight.toFixed(3));
        rect.setAttribute('fill', 'rgba(17,24,39,0.92)');
        rect.setAttribute('stroke', '#111827');
        rect.setAttribute('stroke-width', '1');
        labelGroup.appendChild(rect);
      }

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', (entry.x + paddingX).toFixed(3));
      text.setAttribute('font-family', fontFamily);
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute('font-weight', isMonochrome ? '600' : '700');
      text.setAttribute('fill', isMonochrome ? '#000000' : '#ffffff');
      text.setAttribute('dominant-baseline', 'middle');

      const startY = entry.y + paddingY + lineHeight / 2;
      entry.lines.forEach((lineText, idx) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', (entry.x + paddingX).toFixed(3));
        tspan.setAttribute('y', (startY + lineHeight * idx).toFixed(3));
        tspan.textContent = lineText;
        text.appendChild(tspan);
      });
      labelGroup.appendChild(text);
    }

    target.appendChild(labelGroup);
    return labelGroup;
  }

  _applySvgVectorDisplayStyle(svgRoot) {
    if (!svgRoot?.querySelectorAll) return;
    svgRoot.setAttribute('xmlns', SVG_NS);
    svgRoot.setAttribute('shape-rendering', 'geometricPrecision');
    svgRoot.style.background = 'transparent';
    const stroked = svgRoot.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text');
    stroked.forEach((node) => {
      try { node.setAttribute('vector-effect', 'non-scaling-stroke'); } catch { /* ignore */ }
      try { node.setAttribute('stroke-linecap', 'round'); } catch { /* ignore */ }
      try { node.setAttribute('stroke-linejoin', 'round'); } catch { /* ignore */ }
    });
  }

  _fitSvgToRenderedContent(svgRoot, contentRoot, viewport, paddingPx = 0) {
    const fallbackWidth = Math.max(1, Number(viewport?.width) || 1);
    const fallbackHeight = Math.max(1, Number(viewport?.height) || 1);
    let bbox = null;
    let host = null;

    try {
      if (typeof document === 'undefined' || !document.body || !svgRoot?.getBBox) {
        throw new Error('SVG measurement DOM is unavailable');
      }
      host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '-100000px';
      host.style.top = '-100000px';
      host.style.width = '0';
      host.style.height = '0';
      host.style.opacity = '0';
      host.style.pointerEvents = 'none';
      host.style.overflow = 'hidden';
      document.body.appendChild(host);
      host.appendChild(svgRoot);
      bbox = contentRoot?.getBBox?.() || svgRoot.getBBox?.() || null;
    } catch {
      bbox = null;
    } finally {
      try { host?.remove?.(); } catch { /* ignore */ }
    }

    const padding = Math.max(0, Number(paddingPx) || 0);
    const x = Number.isFinite(bbox?.x) ? bbox.x - padding : 0;
    const y = Number.isFinite(bbox?.y) ? bbox.y - padding : 0;
    const width = Number.isFinite(bbox?.width) && bbox.width > 0 ? bbox.width + padding * 2 : fallbackWidth;
    const height = Number.isFinite(bbox?.height) && bbox.height > 0 ? bbox.height + padding * 2 : fallbackHeight;
    svgRoot.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    svgRoot.setAttribute('width', `${Math.max(1, Math.ceil(width))}`);
    svgRoot.setAttribute('height', `${Math.max(1, Math.ceil(height))}`);
  }

  _encodeSvgDataUrl(svgRoot) {
    if (!svgRoot) return null;
    svgRoot.setAttribute('xmlns', SVG_NS);
    const markup = new XMLSerializer().serializeToString(svgRoot);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }

  async _captureMonochromeSvgDataUrl(labels = [], renderContext = null) {
    const scene = renderContext?.scene || null;
    const camera = renderContext?.camera || null;
    const viewport = renderContext?.viewport || null;
    if (!scene || !camera || !viewport) {
      throw new Error('Monochrome SVG export scene is not ready');
    }

    const svgRenderer = new SVGRenderer();
    svgRenderer.setQuality?.('high');
    svgRenderer.setSize(viewport.width, viewport.height);
    try {
      svgRenderer.setClearColor?.(new THREE.Color(0xffffff));
    } catch { /* ignore */ }

    const contourGroup = this._buildMonochromeSvgContourGroup(renderContext);
    const annotationGroup = renderContext?.annotationGroup || null;
    const edgeObjects = [];
    const centerlineObjects = [];
    scene.traverse((obj) => {
      if (obj?.type !== 'EDGE') return;
      if (obj.userData?.auxEdge && obj.userData?.centerline) {
        centerlineObjects.push(obj);
        return;
      }
      edgeObjects.push(obj);
    });
    this._applyMonochromeEdgeStyle(edgeObjects, renderContext);
    if (centerlineObjects.length) {
      this._applyMonochromeCenterlineStyle(centerlineObjects, renderContext);
    }

    const originalVisibility = this._snapshotSceneVisibility(scene);
    const tempLineGroup = new THREE.Group();
    tempLineGroup.name = '__PMI_MONO_SVG_LINES__';
    tempLineGroup.userData.__pmiSvgContent = true;
    const hiddenFatLines = [];
    const disposableLines = [];
    const hadParent = camera.parent === scene;

    try {
      if (!hadParent) scene.add(camera);
      if (contourGroup) scene.add(contourGroup);
      try { scene.updateMatrixWorld(true); } catch { /* ignore */ }
      try { camera.updateMatrixWorld?.(); } catch { /* ignore */ }

      this._applyRenderableVisibility(scene, originalVisibility, (obj) => {
        if (annotationGroup && this._isObjectWithinGroup(obj, annotationGroup)) return true;
        if (contourGroup && this._isObjectWithinGroup(obj, contourGroup)) return true;
        if (obj?.type === 'EDGE') {
          if (obj.userData?.auxEdge && obj.userData?.centerline) {
            return this._shouldRenderMonochromeCenterLines(renderContext);
          }
          return true;
        }
        return false;
      });

      scene.traverse((obj) => {
        if (!obj?.visible) return;
        if (!obj.isLine2 && !obj.isLineSegments2) return;
        const svgLine = this._buildSvgLineFromLine2(obj);
        if (!svgLine) return;
        hiddenFatLines.push([obj, obj.visible !== false]);
        obj.visible = false;
        tempLineGroup.add(svgLine);
        disposableLines.push(svgLine);
      });
      if (tempLineGroup.children.length) {
        scene.add(tempLineGroup);
      }

      svgRenderer.render(scene, camera);

      const svgRoot = svgRenderer.domElement.cloneNode(true);
      svgRoot.removeAttribute('style');
      svgRoot.setAttribute('width', String(viewport.width));
      svgRoot.setAttribute('height', String(viewport.height));

      const contentGroup = document.createElementNS(SVG_NS, 'g');
      while (svgRoot.firstChild) {
        contentGroup.appendChild(svgRoot.firstChild);
      }
      svgRoot.appendChild(contentGroup);
      this._appendSvgLabels(contentGroup, labels, viewport.width, viewport.height, renderContext);
      this._applySvgVectorDisplayStyle(svgRoot);
      this._fitSvgToRenderedContent(svgRoot, contentGroup, viewport, 4);
      return this._encodeSvgDataUrl(svgRoot);
    } finally {
      for (const [obj, wasVisible] of hiddenFatLines) {
        try { obj.visible = wasVisible; } catch { /* ignore */ }
      }
      try {
        if (tempLineGroup.children.length) scene.remove(tempLineGroup);
      } catch { /* ignore */ }
      for (const line of disposableLines) {
        try { line.geometry?.dispose?.(); } catch { /* ignore */ }
        try { line.material?.dispose?.(); } catch { /* ignore */ }
      }
      try {
        if (contourGroup) {
          scene.remove(contourGroup);
          contourGroup.traverse?.((obj) => {
            try { obj.geometry?.dispose?.(); } catch { /* ignore */ }
            if (Array.isArray(obj.material)) {
              obj.material.forEach((entry) => { try { entry?.dispose?.(); } catch { /* ignore */ } });
            } else {
              try { obj.material?.dispose?.(); } catch { /* ignore */ }
            }
          });
        }
      } catch { /* ignore */ }
      if (!hadParent) {
        try { scene.remove(camera); } catch { /* ignore */ }
      }
      this._restoreSceneVisibility(originalVisibility);
    }
  }

  _createExportRenderContext(viewport, view = null, options = {}) {
    const viewer = this.viewer;
    const sourceScene = viewer?.partHistory?.scene || viewer?.scene || null;
    const scene = this._cloneExportScene(sourceScene);
    if (!viewer || !scene) throw new Error('Viewer scene is not available for PMI export');
    const renderMode = this._normalizeExportRenderMode(options?.renderMode, 'shaded');
    const showCenterLines = options?.showCenterLines === true;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    this._copyRendererState(viewer?.renderer || null, renderer);
    const clearColor = viewer?._clearColor instanceof THREE.Color
      ? viewer._clearColor
      : new THREE.Color(0x000000);
    const clearAlpha = Number.isFinite(viewer?._clearAlpha) ? viewer._clearAlpha : 1;
    renderer.setClearColor(clearColor, clearAlpha);

    const canvas = renderer.domElement;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: viewport.width,
      bottom: viewport.height,
      width: viewport.width,
      height: viewport.height,
      toJSON() {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: viewport.width,
          bottom: viewport.height,
          width: viewport.width,
          height: viewport.height,
        };
      },
    });

    const camera = this._createExportCamera(view, viewport);
    const exportPartHistory = viewer?.partHistory
      ? Object.assign(Object.create(Object.getPrototypeOf(viewer.partHistory)), viewer.partHistory, { scene })
      : { scene };
    const exportViewer = {
      partHistory: exportPartHistory,
      scene,
      camera,
      renderer,
      controls: null,
    };

    return {
      viewer: exportViewer,
      scene,
      camera,
      renderer,
      viewport,
      renderMode,
      showCenterLines,
      dispose: () => {
        try {
          if (camera.parent === scene) scene.remove(camera);
        } catch { /* ignore */ }
        try { this._disposeExportScene(scene); } catch { /* ignore */ }
        try { renderer.dispose(); } catch { /* ignore */ }
      },
    };
  }

  _cloneExportScene(scene) {
    if (!scene) return null;
    try {
      const clonedScene = this._cloneExportNode(scene, null);
      try { clonedScene.updateMatrixWorld(true); } catch { /* ignore */ }
      return clonedScene;
    } catch (error) {
      console.warn('PMI export scene clone failed; falling back to live scene', error);
      return scene;
    }
  }

  _cloneExportNode(source, owningSolid = null) {
    if (!source) return null;
    if (source.name === '__WORLD_AXES__') return null;

    let target = null;
    if (source.isScene) {
      target = new THREE.Scene();
      target.copy(source, false);
    } else if (source?.type === 'SOLID') {
      try {
        target = source.clone();
        target.copy?.(source, false);
      } catch {
        target = new THREE.Group();
        target.copy?.(source, false);
        target.type = 'SOLID';
      }
    } else if (typeof source.clone === 'function') {
      target = source.clone(false);
    } else {
      target = new THREE.Object3D();
      target.copy?.(source, false);
    }

    const srcUserData = (source.userData && typeof source.userData === 'object') ? source.userData : {};
    target.userData = { ...srcUserData };
    target.userData.__pmiExportSourceUuid = source.uuid || null;
    target.userData.__pmiExportSourceId = Number.isInteger(source.id) ? source.id : null;
    target.userData.__pmiExportSourceName = String(source.name || '');

    if (source.material) {
      target.material = this._cloneExportMaterial(source.material);
    }

    const solidForChildren = source?.type === 'SOLID' ? target : owningSolid;
    if (target?.type === 'FACE' || target?.type === 'EDGE') {
      target.parentSolid = solidForChildren || null;
    }

    if (Array.isArray(target.children) && target.children.length) {
      for (const child of target.children.slice()) {
        try { target.remove(child); } catch { /* ignore */ }
      }
    }

    const sourceChildren = Array.isArray(source.children) ? source.children : [];
    for (const sourceChild of sourceChildren) {
      const targetChild = this._cloneExportNode(sourceChild, solidForChildren);
      if (!targetChild) continue;
      target.add(targetChild);
    }

    if (source?.type === 'SOLID') {
      this._relinkExportSolidTopology(source, target);
    }
    return target;
  }

  _relinkExportSolidTopology(sourceSolid, targetSolid) {
    if (!sourceSolid?.traverse || !targetSolid?.traverse) return;
    const sourceByUuid = new Map();
    const targetBySourceUuid = new Map();

    sourceSolid.traverse((obj) => {
      if (!obj?.uuid) return;
      sourceByUuid.set(obj.uuid, obj);
    });
    targetSolid.traverse((obj) => {
      const sourceUuid = obj?.userData?.__pmiExportSourceUuid;
      if (!sourceUuid) return;
      targetBySourceUuid.set(sourceUuid, obj);
    });

    targetSolid.traverse((obj) => {
      const sourceUuid = obj?.userData?.__pmiExportSourceUuid;
      const sourceObj = sourceUuid ? sourceByUuid.get(sourceUuid) : null;
      if (!sourceObj) return;

      if (obj.type === 'FACE') {
        obj.parentSolid = targetSolid;
        obj.edges = Array.isArray(sourceObj.edges)
          ? sourceObj.edges.map((edge) => targetBySourceUuid.get(edge?.uuid)).filter(Boolean)
          : [];
      } else if (obj.type === 'EDGE') {
        obj.parentSolid = targetSolid;
        obj.faces = Array.isArray(sourceObj.faces)
          ? sourceObj.faces.map((face) => targetBySourceUuid.get(face?.uuid)).filter(Boolean)
          : [];
      }
    });
  }

  _cloneExportMaterial(material) {
    if (Array.isArray(material)) {
      return material.map((entry) => this._cloneExportMaterial(entry));
    }
    if (!material) return material;
    try {
      const clone = material.clone?.() || material;
      if (clone && typeof clone === 'object') {
        clone.userData = {
          ...(clone.userData && typeof clone.userData === 'object' ? clone.userData : {}),
          __pmiExportClonedMaterial: true,
        };
      }
      return clone;
    } catch {
      return material;
    }
  }

  _disposeExportScene(scene) {
    if (!scene?.traverse) return;
    scene.traverse((obj) => {
      const material = obj?.material;
      if (!material) return;
      const disposeMaterial = (entry) => {
        if (!entry?.userData?.__pmiExportClonedMaterial) return;
        try { entry.dispose?.(); } catch { /* ignore */ }
      };
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else disposeMaterial(material);
    });
  }

  _setDescendantLightVisibility(root, visible) {
    const prior = [];
    if (!root?.traverse) return prior;
    root.traverse((obj) => {
      if (!obj?.isLight) return;
      prior.push([obj, obj.visible !== false]);
      obj.visible = !!visible;
    });
    return prior;
  }

  _restoreLightVisibility(states = []) {
    for (const entry of states) {
      const [light, visible] = Array.isArray(entry) ? entry : [];
      if (!light) continue;
      try { light.visible = visible; } catch { /* ignore */ }
    }
  }

  _setNonExportCameraLightsVisible(scene, exportCamera, visible) {
    const prior = [];
    if (!scene?.traverse) return prior;
    scene.traverse((obj) => {
      if (!obj?.isCamera || obj === exportCamera) return;
      prior.push(...this._setDescendantLightVisibility(obj, visible));
    });
    return prior;
  }

  _collectExportFaceOutlineObjects(renderContext) {
    const out = [];
    const scene = renderContext?.scene || null;
    if (!scene?.traverse) return out;
    scene.traverse((obj) => {
      if (!obj || obj.type !== 'SOLID') return;
      const children = Array.isArray(obj.children) ? obj.children : [];
      for (const child of children) {
        if (child?.type === 'FACE' && child.isMesh) out.push(child);
      }
    });
    return out;
  }

  _collectExportCenterlineObjects(renderContext) {
    const out = [];
    const scene = renderContext?.scene || null;
    if (!scene?.traverse) return out;
    scene.traverse((obj) => {
      if (!obj || obj.type !== 'EDGE') return;
      if (!obj.userData?.auxEdge || !obj.userData?.centerline) return;
      out.push(obj);
    });
    return out;
  }

  _captureTransparentOverlayDataUrl(renderContext) {
    const renderer = renderContext?.renderer;
    const scene = renderContext?.scene;
    const camera = renderContext?.camera;
    if (!renderer?.isWebGLRenderer || !scene || !camera) return null;

    const oldTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const oldClearColor = new THREE.Color();
    renderer.getClearColor(oldClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    const oldBackground = scene.background;

    try {
      scene.background = null;
      renderer.autoClear = true;
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      scene.background = oldBackground;
      renderer.setClearColor(oldClearColor, oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }
  }

  _renderExportSolidFaceOutlineEdgeMask(renderContext, edgeMaskTarget, depthMaterial) {
    const renderer = renderContext?.renderer;
    const scene = renderContext?.scene;
    const camera = renderContext?.camera;
    if (!renderer?.isWebGLRenderer || !scene || !camera || !edgeMaskTarget || !depthMaterial) return;

    const originalVisibility = new Map();
    scene.traverse((obj) => {
      if (obj) originalVisibility.set(obj, obj.visible !== false);
    });

    const applyRenderableVisibility = (predicate) => {
      scene.traverse((obj) => {
        if (!obj) return;
        const baseVisible = originalVisibility.get(obj) !== false;
        if (!baseVisible) {
          obj.visible = false;
          return;
        }
        if (obj.isMesh || obj.isLine || obj.isLine2 || obj.isLineSegments || obj.isLineLoop || obj.isPoints || obj.isSprite) {
          obj.visible = !!predicate(obj);
          return;
        }
        obj.visible = true;
      });
    };

    const oldClearColor = new THREE.Color();
    renderer.getClearColor(oldClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    const oldTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const oldBackground = scene.background;
    const oldOverrideMaterial = scene.overrideMaterial;

    try {
      scene.background = null;
      renderer.autoClear = true;
      renderer.setRenderTarget(edgeMaskTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);

      applyRenderableVisibility((obj) => obj.isMesh);
      scene.overrideMaterial = depthMaterial;
      renderer.render(scene, camera);

      applyRenderableVisibility((obj) => {
        if (obj?.type !== 'EDGE') return false;
        if (obj.userData?.auxEdge) return false;
        return obj.material?.depthTest !== false;
      });
      scene.overrideMaterial = null;
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = oldOverrideMaterial;
      scene.background = oldBackground;
      originalVisibility.forEach((visible, obj) => {
        if (obj) obj.visible = visible;
      });
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(oldClearColor, oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }
  }

  _snapshotSceneVisibility(scene) {
    const originalVisibility = new Map();
    scene?.traverse?.((obj) => {
      if (obj) originalVisibility.set(obj, obj.visible !== false);
    });
    return originalVisibility;
  }

  _restoreSceneVisibility(originalVisibility) {
    originalVisibility?.forEach?.((visible, obj) => {
      if (obj) obj.visible = visible;
    });
  }

  _isObjectWithinGroup(obj, group) {
    let current = obj;
    while (current) {
      if (current === group) return true;
      current = current.parent;
    }
    return false;
  }

  _applyRenderableVisibility(scene, originalVisibility, predicate) {
    scene?.traverse?.((obj) => {
      if (!obj) return;
      const baseVisible = originalVisibility.get(obj) !== false;
      if (!baseVisible) {
        obj.visible = false;
        return;
      }
      if (obj.isMesh || obj.isLine || obj.isLine2 || obj.isLineSegments || obj.isLineLoop || obj.isPoints || obj.isSprite) {
        obj.visible = !!predicate(obj);
        return;
      }
      obj.visible = true;
    });
  }

  _renderExportScene(renderContext) {
    const { viewer, renderer, scene, camera, viewport } = renderContext || {};
    if (!renderer?.isWebGLRenderer || !scene || !camera || !viewport) {
      throw new Error('PMI export renderer is not ready');
    }
    const renderMode = this._normalizeExportRenderMode(renderContext?.renderMode, 'shaded');
    const isMonochrome = renderMode === 'monochrome';

    this._updateViewportSensitiveRendering(viewport.width, viewport.height, viewer);

    const sceneCameraLightStates = this._setNonExportCameraLightsVisible(scene, camera, false);
    const exportLightStates = this._setDescendantLightVisibility(camera, true);
    const hadParent = camera.parent === scene;
    const oldTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const annotationGroup = renderContext?.annotationGroup || null;
    const originalVisibility = this._snapshotSceneVisibility(scene);

    const outlinePass = new OutlinePass(new THREE.Vector2(viewport.width, viewport.height), scene, camera, []);
    const outlineReadBuffer = new THREE.WebGLRenderTarget(viewport.width, viewport.height);
    const edgeMaskTarget = new THREE.WebGLRenderTarget(viewport.width, viewport.height);
    const depthMaterial = new THREE.MeshDepthMaterial();
    depthMaterial.side = THREE.DoubleSide;
    depthMaterial.colorWrite = false;
    depthMaterial.depthWrite = true;
    depthMaterial.depthTest = true;
    depthMaterial.blending = THREE.NoBlending;

    try {
      if (!hadParent) scene.add(camera);

      if (annotationGroup) annotationGroup.visible = false;
      if (isMonochrome) {
        renderContext.baseImageDataUrl = this._createTransparentImageDataUrl(viewport.width, viewport.height);
      } else {
        renderer.setRenderTarget(oldTarget);
        renderer.clear?.(true, true, true);
        renderer.render(scene, camera);
        renderContext.baseImageDataUrl = renderer.domElement.toDataURL('image/png');
      }

      try {
        const outputColorSpace = renderer.outputColorSpace;
        if (outlineReadBuffer?.texture && outputColorSpace) {
          outlineReadBuffer.texture.colorSpace = outputColorSpace;
        }
      } catch { /* ignore */ }

      try { this.viewer?._patchOutlinePassHiddenEdgeAlpha?.(outlinePass); } catch { /* ignore */ }
      try { this.viewer?._patchOutlinePassPerFaceRendering?.(outlinePass); } catch { /* ignore */ }
      try { this.viewer?._patchOutlinePassSolidOverlay?.(outlinePass); } catch { /* ignore */ }

      outlinePass.downSampleRatio = 1;
      const edgeColor = isMonochrome ? new THREE.Color(0x000000) : CADmaterials?.EDGE?.BASE?.color;
      if (edgeColor?.isColor) {
        outlinePass.visibleEdgeColor.copy(edgeColor);
      } else {
        outlinePass.visibleEdgeColor.set(isMonochrome ? 0x000000 : 0x009dff);
      }
      outlinePass.hiddenEdgeColor.set(0x000000);
      outlinePass.edgeGlow = 0;
      const edgeLineWidth = Number(CADmaterials?.EDGE?.BASE?.linewidth);
      outlinePass.edgeThickness = Number.isFinite(edgeLineWidth) && edgeLineWidth > 0
        ? edgeLineWidth * 0.5
        : 1;
      outlinePass.edgeStrength = 3;
      outlinePass.selectedObjects = this._collectExportFaceOutlineObjects(renderContext);

      if (outlinePass.overlayMaterial?.uniforms?.edgeMaskTexture) {
        outlinePass.overlayMaterial.uniforms.edgeMaskTexture.value = edgeMaskTarget.texture;
      }

      outlinePass.setSize(viewport.width, viewport.height);
      outlinePass.renderToScreen = true;

      renderer.setRenderTarget(edgeMaskTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      if (!isMonochrome) {
        this._renderExportSolidFaceOutlineEdgeMask(renderContext, edgeMaskTarget, depthMaterial);
      }
      renderer.setRenderTarget(outlineReadBuffer);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      outlinePass.render(renderer, null, outlineReadBuffer, 0, false);
      renderContext.outlineImageDataUrl = renderer.domElement.toDataURL('image/png');

      if (this._shouldRenderMonochromeCenterLines(renderContext)) {
        const centerlineObjects = this._collectExportCenterlineObjects(renderContext);
        if (centerlineObjects.length) {
          const centerlineSet = new Set(centerlineObjects);
          this._restoreSceneVisibility(originalVisibility);
          this._applyMonochromeCenterlineStyle(centerlineObjects, renderContext);
          this._applyRenderableVisibility(scene, originalVisibility, (obj) => centerlineSet.has(obj));
          renderContext.centerlineImageDataUrl = this._captureTransparentOverlayDataUrl(renderContext);
        }
      }

      if (annotationGroup) {
        this._restoreSceneVisibility(originalVisibility);
        this._applyRenderableVisibility(scene, originalVisibility, (obj) => this._isObjectWithinGroup(obj, annotationGroup));
        renderContext.annotationImageDataUrl = this._captureTransparentOverlayDataUrl(renderContext);
      }
    } finally {
      try {
        if (!hadParent && camera.parent === scene) scene.remove(camera);
      } catch { /* ignore */ }
      this._restoreSceneVisibility(originalVisibility);
      this._restoreLightVisibility(exportLightStates);
      this._restoreLightVisibility(sceneCameraLightStates);
      try { outlinePass.dispose?.(); } catch { /* ignore */ }
      try { outlineReadBuffer.dispose?.(); } catch { /* ignore */ }
      try { edgeMaskTarget.dispose?.(); } catch { /* ignore */ }
      try { depthMaterial.dispose?.(); } catch { /* ignore */ }
      this._updateViewportSensitiveRendering(
        this._getViewerViewportMetrics().width,
        this._getViewerViewportMetrics().height,
        this.viewer,
      );
    }
  }

  async captureViewImageDataUrl(view, viewIndex, { hideViewCube = true, renderMode = 'shaded', showCenterLines = false } = {}) {
    const viewer = this.viewer;
    if (!viewer) throw new Error('Viewer is not ready to export images');

    const captureViewport = this._getCaptureViewportMetrics(view);
    const originalWireframe = this._detectWireframe(viewer.scene);
    const renderContext = this._createExportRenderContext(captureViewport, view, { renderMode, showCenterLines });

    let dataUrl = null;
    const runCapture = async () => {
      let overlay = null;
      try {
        this._applyViewToRenderContext(view, renderContext, { index: viewIndex });
        overlay = await this._buildExportAnnotations(view, renderContext);
        if (this._isMonochromeExport(renderContext)) {
          try {
            dataUrl = await this._captureMonochromeSvgDataUrl(overlay?.labels || [], renderContext);
          } catch (error) {
            console.warn('PMI monochrome SVG export fell back to raster capture', error);
            this._renderExportScene(renderContext);
            dataUrl = await this._captureCanvasImage(overlay?.labels || [], renderContext);
          }
        } else {
          this._renderExportScene(renderContext);
          dataUrl = await this._captureCanvasImage(overlay?.labels || [], renderContext);
        }
      } finally {
        try { overlay?.cleanup?.(); } catch { /* ignore */ }
      }
    };

    try {
      void hideViewCube;
      await runCapture();
    } finally {
      try { this._applyWireframe(viewer?.scene, originalWireframe); } catch { /* ignore */ }
      try { renderContext.dispose?.(); } catch { /* ignore */ }
      try { viewer?.render?.(); } catch { /* ignore */ }
    }

    return dataUrl;
  }

  // ---- UI ----
  _ensureStyles() {
    if (document.getElementById('pmi-views-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'pmi-views-widget-styles';
    style.textContent = `
      .pmi-views-root { padding: 6px; }
      .pmi-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-bottom: 1px solid #1f2937; background: transparent; transition: background-color .12s ease; position: relative; }
      .pmi-row:hover { background: #0f172a; }
      .pmi-row.header { background: #111827; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-bottom: 6px; border-radius: 4px; }
      .pmi-row.active { background: #0f172a; border-color: #2563eb; box-shadow: 0 0 0 1px rgba(37,99,235,.35); }
      .pmi-grow { flex: 1 1 auto; min-width: 0; }
      .pmi-input { width: 100%; box-sizing: border-box; padding: 6px 8px; background: #0b0e14; color: #e5e7eb; border: 1px solid #374151; border-radius: 8px; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
      .pmi-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
      .pmi-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; height: 26px; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, background-color .15s ease, transform .05s ease; }
      .pmi-btn.icon { width: 26px; padding: 0; font-size: 16px; }
      .pmi-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .pmi-btn:active { transform: translateY(1px); }
      .pmi-btn.danger { border-color: #7f1d1d; color: #fecaca; }
      .pmi-btn.danger:hover { border-color: #ef4444; background: rgba(239,68,68,.15); color: #fff; }
      .pmi-list { display: flex; flex-direction: column; gap: 2px; }
      .pmi-name { font-weight: 600; color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pmi-name-btn { background: none; border: none; padding: 0; margin: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; display: block; width: 100%; }
      .pmi-name-btn:hover { color: #93c5fd; }
      .pmi-name-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
      .pmi-row-menu { position: absolute; right: 6px; top: calc(100% + 4px); background: #0b1120; border: 1px solid #1f2937; border-radius: 10px; padding: 8px; display: none; flex-direction: column; gap: 6px; min-width: 180px; box-shadow: 0 12px 24px rgba(0,0,0,.45); z-index: 20; }
      .pmi-row-menu.open { display: flex; }
      .pmi-row-menu .pmi-btn { width: 100%; justify-content: flex-start; }
      .pmi-row-menu .pmi-btn.danger { justify-content: center; }
      .pmi-row-menu-wireframe { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #e5e7eb; }
      .pmi-row-menu hr { border: none; border-top: 1px solid #1f2937; margin: 4px 0; }
    `;
    document.head.appendChild(style);
  }

  _buildUI() {
    // Header row
    const header = document.createElement('div');
    header.className = 'pmi-row header';

    const titleLabel = document.createElement('div');
    titleLabel.className = 'pmi-name pmi-grow';
    titleLabel.textContent = this._readOnly ? 'Views' : 'New view';
    titleLabel.title = this._readOnly
      ? 'Apply a saved PMI view'
      : 'Capture the current camera as a new PMI view';
    header.appendChild(titleLabel);

    if (!this._readOnly) {
      const capBtn = document.createElement('button');
      capBtn.className = 'pmi-btn';
      capBtn.title = 'Capture current camera as a view';
      capBtn.textContent = 'Capture';
      capBtn.addEventListener('click', () => this._captureCurrent());
      header.appendChild(capBtn);
    }

    const exportBtn = document.createElement('button');
    exportBtn.className = 'pmi-btn';
    exportBtn.title = 'Export all PMI views as images';
    exportBtn.textContent = 'Export Images';
    exportBtn.addEventListener('click', () => { this._exportImages(); });
    header.appendChild(exportBtn);

    this.uiElement.appendChild(header);

    this.listEl = document.createElement('div');
    this.listEl.className = 'pmi-list';
    this.uiElement.appendChild(this.listEl);
  }

  _renderList() {
    this._closeActiveMenu();
    this.listEl.textContent = '';
    const views = Array.isArray(this.views) ? this.views : [];
    const activeIndex = this._getActiveViewIndex();
    views.forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'pmi-row';
      if (idx === activeIndex) {
        row.classList.add('active');
        row.setAttribute('aria-current', 'true');
      }

      const viewName = this._resolveViewName(v, idx);
      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'pmi-name pmi-name-btn pmi-grow';
      nameButton.textContent = viewName;
      nameButton.title = this._readOnly
        ? 'Click to apply this view'
        : 'Click to edit annotations for this view';
      nameButton.addEventListener('click', () => {
        if (this._readOnly) {
          this._applyView(v, { index: idx });
          return;
        }
        this._enterEditMode(v, idx);
        setTimeout(() => this._enterEditMode(v, idx), 200);
      });
      row.appendChild(nameButton);

      const startRename = () => {
        this._closeActiveMenu();
        if (!row.contains(nameButton)) {
          const existingInput = row.querySelector('input.pmi-input');
          if (existingInput) {
            existingInput.focus();
            existingInput.select?.();
          }
          return;
        }
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = viewName;
        nameInput.className = 'pmi-input pmi-grow';

        let finished = false;
        const finishRename = (commit) => {
          if (finished) return;
          finished = true;
          if (commit) {
            const fallback = viewName;
            const newName = nameInput.value.trim();
            const finalName = newName || fallback;
            if (finalName !== viewName) {
              const updateFn = (entry) => {
                if (!entry || typeof entry !== 'object') return entry;
                entry.viewName = finalName;
                entry.name = finalName;
                return entry;
              };
              const manager = this.viewer?.partHistory?.pmiViewsManager;
              const updated = manager?.updateView?.(idx, updateFn);
              if (!updated) {
                updateFn(v);
                this.refreshFromHistory();
              }
            }
          }
          this._renderList();
        };

        nameInput.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            finishRename(true);
          } else if (evt.key === 'Escape') {
            finishRename(false);
          }
        });
        nameInput.addEventListener('blur', () => finishRename(true));

        row.replaceChild(nameInput, nameButton);
        nameInput.focus();
        nameInput.select();
      };

      const deleteView = () => {
        const manager = this.viewer?.partHistory?.pmiViewsManager;
        const removed = manager?.removeView?.(idx);
        if (!removed) {
          this.views.splice(idx, 1);
          this.refreshFromHistory();
        }
        this._renderList();
      };

      if (!this._readOnly) {
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'pmi-btn icon';
        menuBtn.title = 'View options';
        menuBtn.setAttribute('aria-label', 'View options');
        menuBtn.textContent = '⋯';

        const menu = document.createElement('div');
        menu.className = 'pmi-row-menu';

        const makeMenuButton = (label, handler, opts = {}) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `pmi-btn${opts.danger ? ' danger' : ''}`;
          btn.textContent = label;
          if (opts.title) btn.title = opts.title;
          btn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            handler();
            this._closeActiveMenu();
          });
          return btn;
        };

        menu.appendChild(makeMenuButton('Update Camera', () => this._updateViewCamera(idx), { title: UPDATE_CAMERA_TOOLTIP }));
        menu.appendChild(makeMenuButton('Rename View', startRename));
        menu.appendChild(makeMenuButton('Delete View', deleteView, { danger: true, title: 'Delete this view' }));
        const divider = document.createElement('hr');
        menu.appendChild(divider);

        const wireframeLabel = document.createElement('label');
        wireframeLabel.className = 'pmi-row-menu-wireframe';
        const wireframeCheckbox = document.createElement('input');
        wireframeCheckbox.type = 'checkbox';
        const storedWireframe = (v.viewSettings || v.settings)?.wireframe;
        wireframeCheckbox.checked = (typeof storedWireframe === 'boolean') ? storedWireframe : false;
        wireframeCheckbox.addEventListener('change', (evt) => {
          evt.stopPropagation();
          this._setViewWireframe(idx, Boolean(wireframeCheckbox.checked));
        });
        const wireframeText = document.createElement('span');
        wireframeText.textContent = 'Wireframe';
        wireframeLabel.appendChild(wireframeCheckbox);
        wireframeLabel.appendChild(wireframeText);
        menu.appendChild(wireframeLabel);

        menuBtn.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this._toggleRowMenu(menu, menuBtn);
        });

        row.appendChild(menuBtn);
        row.appendChild(menu);

        row.addEventListener('dblclick', (e) => {
          const target = e.target;
          const tagName = target?.tagName;
          if (menu.contains(target) || target === menuBtn || tagName === 'INPUT') return;
          this._applyView(v, { index: idx });
        });
      } else {
        row.addEventListener('dblclick', () => {
          this._applyView(v, { index: idx });
        });
      }

      this.listEl.appendChild(row);
    });
  }

  _toggleRowMenu(menu, trigger) {
    if (this._activeMenu && this._activeMenu !== menu) {
      this._closeActiveMenu();
    }
    if (menu.classList.contains('open')) {
      this._closeActiveMenu();
      return;
    }
    menu.classList.add('open');
    this._activeMenu = menu;
    this._menuOutsideHandler = (evt) => {
      if (!this._activeMenu) return;
      if (this._activeMenu.contains(evt.target) || trigger.contains(evt.target)) return;
      this._closeActiveMenu();
    };
    setTimeout(() => {
      if (this._menuOutsideHandler) {
        document.addEventListener('mousedown', this._menuOutsideHandler);
      }
    }, 0);
  }

  _closeActiveMenu() {
    if (this._activeMenu) {
      this._activeMenu.classList.remove('open');
      this._activeMenu = null;
    }
    if (this._menuOutsideHandler) {
      document.removeEventListener('mousedown', this._menuOutsideHandler);
      this._menuOutsideHandler = null;
    }
  }

  // ---- Actions ----
  async _captureCurrent() {
    if (this._readOnly) return;
    try {
      const v = this.viewer;
      const cam = v?.camera;
      if (!cam) return;
      const cameraSnap = captureCameraSnapshot(cam, {
        controls: this.viewer?.controls,
        viewport: this._getViewerViewportMetrics(),
      });
      if (!cameraSnap) return;
      const fallbackIndex = Array.isArray(this.views) ? this.views.length : 0;
      const defaultName = `View ${fallbackIndex + 1}`;
      const promptFn = (typeof window !== 'undefined' && typeof prompt === 'function')
        ? prompt.bind(window)
        : (typeof prompt === 'function' ? prompt : null);
      const response = promptFn ? await promptFn('Enter a name for this view', defaultName) : defaultName;
      if (response === null) return; // user cancelled
      const name = String(response || '').trim() || defaultName;
      const snap = {
        viewName: name,
        name,
        camera: cameraSnap,
        // Persist basic view settings (extensible). Currently only wireframe render mode.
        viewSettings: {
          wireframe: this._detectWireframe(v?.scene)
        },
        annotations: [],
      };
      const manager = this.viewer?.partHistory?.pmiViewsManager;
      const added = manager?.addView?.(snap);
      if (!added) {
        this.views.push(snap);
        this.refreshFromHistory();
      }
      const newIndex = Array.isArray(this.views) ? Math.max(0, (this.views.length - 1)) : 0;
      this._setActiveViewIndex(newIndex);
      this._renderList();
    } catch { /* ignore */ }
  }

  async _exportImages() {
    if (this._exportingImages) return;
    const views = Array.isArray(this.views) ? this.views : [];
    if (!views.length) {
      alert('No PMI views to export.');
      return;
    }

    const viewer = this.viewer;
    if (!viewer) {
      alert('Viewer is not ready to export images.');
      return;
    }

    const captures = [];
    try {
      this._exportingImages = true;
      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        const name = this._resolveViewName(view, i);
        const dataUrl = await this.captureViewImageDataUrl(view, i);
        if (!dataUrl) {
          throw new Error(`Failed to capture image for view "${name}"`);
        }
        captures.push({ name, dataUrl });
      }
    } catch (err) {
      console.error('PMI export failed:', err);
      alert(`Export failed: ${err?.message || err}`);
      return;
    } finally {
      this._exportingImages = false;
    }

    if (!captures.length) {
      alert('No images were captured.');
      return;
    }

    const popup = (typeof window !== 'undefined' && typeof window.open === 'function')
      ? window.open('', '_blank')
      : null;
    if (!popup) {
      alert('Images generated, but pop-ups were blocked. Please allow pop-ups to view them.');
      return;
    }

    const doc = popup.document;
    doc.title = 'PMI View Images';
    doc.body.textContent = '';

    this._injectExportStyles(doc);

    const title = doc.createElement('div');
    title.className = 'pmi-export-title';
    title.textContent = 'PMI View Images';
    doc.body.appendChild(title);

    const grid = doc.createElement('div');
    grid.className = 'pmi-export-grid';
    doc.body.appendChild(grid);

    for (const { name, dataUrl } of captures) {
      const card = doc.createElement('div');
      card.className = 'pmi-export-card';
      const img = doc.createElement('img');
      img.src = dataUrl;
      img.alt = name;
      const caption = doc.createElement('div');
      caption.className = 'pmi-export-caption';
      caption.textContent = name;
      card.appendChild(img);
      card.appendChild(caption);
      grid.appendChild(card);
    }
  }

  // Generate labeled PNGs for all views (for packaging into 3MF). Throws on failure.
  async captureViewImagesForPackage() {
    if (this._exportingImages) throw new Error('PMI view export already in progress');
    const views = Array.isArray(this.views) ? this.views : [];
    if (!views.length) return {};

    const viewer = this.viewer;
    if (!viewer) throw new Error('Viewer is not ready to export images');

    const captures = [];
    this._exportingImages = true;
    try {
      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        const name = this._resolveViewName(view, i);
        const dataUrl = await this.captureViewImageDataUrl(view, i);
        if (!dataUrl) {
          throw new Error(`Failed to capture image for view "${name}"`);
        }
        captures.push({ name, dataUrl });
      }
    } finally {
      this._exportingImages = false;
    }
    const files = {};
    captures.forEach(({ name, dataUrl }) => {
      const fileName = `${this._safeFileName(name, 'view')}.png`;
      const path = `views/${fileName}`;
      files[path] = this._dataUrlToUint8Array(dataUrl);
    });
    return files;
  }

  _applyViewToRenderContext(view, renderContext, { index = null } = {}) {
    try {
      const targetViewer = renderContext?.viewer || null;
      const camera = targetViewer?.camera || null;
      if (!camera || !view?.camera) return;

      const viewport = renderContext?.viewport || this._getCaptureViewportMetrics(view);
      const applied = applyCameraSnapshot(camera, view.camera, {
        controls: null,
        respectParent: false,
        syncControls: false,
        viewport,
      });

      if (!applied) {
        const legacy = view.camera;
        if (legacy.position) {
          camera.position.set(legacy.position.x, legacy.position.y, legacy.position.z);
        }
        if (legacy.quaternion) {
          camera.quaternion.set(legacy.quaternion.x, legacy.quaternion.y, legacy.quaternion.z, legacy.quaternion.w);
        }
        if (legacy.up) {
          camera.up.set(legacy.up.x, legacy.up.y, legacy.up.z);
        }
        if (typeof legacy.zoom === 'number' && Number.isFinite(legacy.zoom) && legacy.zoom > 0) {
          camera.zoom = legacy.zoom;
        }
      }

      adjustOrthographicFrustum(camera, view.camera?.projection || null, viewport);
      try { camera.updateProjectionMatrix?.(); } catch { /* ignore */ }
      try { camera.updateMatrixWorld?.(true); } catch { /* ignore */ }
      try { this._updateExportCameraLightRig(renderContext); } catch { /* ignore */ }

      try {
        const vs = view.viewSettings || {};
        if (typeof vs.wireframe === 'boolean') {
          this._applyWireframe(renderContext?.scene, vs.wireframe);
        }
      } catch { /* ignore */ }

      void index;
    } catch { /* ignore */ }
  }

  async _buildExportAnnotations(view, renderContext = null) {
    const cleanup = () => {};
    const exportViewer = renderContext?.viewer || this.viewer;
    const scene = exportViewer?.partHistory?.scene || exportViewer?.scene;
    if (!exportViewer || !scene) return { labels: [], cleanup };

    const pmimode = {
      viewer: exportViewer,
      _opts: {
        dimDecimals: 3,
        angleDecimals: 1,
        noteText: '',
        leaderText: 'TEXT HERE',
      },
      __explodeTraceState: new Map(),
    };
    const history = new AnnotationHistory(pmimode);
    try { history.load(Array.isArray(view?.annotations) ? view.annotations : []); } catch { }
    const entries = history.getEntries();
    if (!entries.length) return { labels: [], cleanup };

    const group = new THREE.Group();
    group.name = '__PMI_EXPORT_ANN__';
    group.renderOrder = 9994;
    scene.add(group);
    if (renderContext && typeof renderContext === 'object') {
      renderContext.annotationGroup = group;
    }

    const labels = [];
    const ctx = {
      screenSizeWorld: (px) => this._screenSizeWorld(px, renderContext),
      alignNormal: (alignment, ann) => this._alignNormal(alignment, ann, renderContext),
      formatReferenceLabel: (ann, text) => this._formatReferenceLabel(ann, text),
      updateLabel: (idx, text, worldPos, ann) => {
        if (!worldPos || text == null) return;
        const world = this._normalizeLabelPosition(worldPos);
        if (!world) return;
        labels[idx] = {
          text: String(text),
          world,
          anchor: ann?.anchorPosition || ann?.alignmentAnchor || null,
        };
      },
    };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || typeof entry.run !== 'function' || entry.enabled === false) continue;
      try {
        await entry.run({ pmimode, group, idx: i, ctx });
      } catch (error) {
        console.warn('PMI export skipped annotation render failure', {
          view: this._resolveViewName(view, 0),
          annotationType: entry?.type || entry?.inputParams?.type || 'unknown',
          error,
        });
      }
    }

    if (this._isMonochromeExport(renderContext)) {
      this._applyMonochromeAnnotationStyle(group);
    }

    const cleanupFn = () => {
      try { scene.remove(group); } catch { /* ignore */ }
      try {
        for (let i = group.children.length - 1; i >= 0; i -= 1) {
          const child = group.children[i];
          group.remove(child);
          child.geometry?.dispose?.();
          if (Array.isArray(child.material)) child.material.forEach((mat) => mat?.dispose?.());
          else child.material?.dispose?.();
        }
      } catch { /* ignore */ }
    };
    return { labels: labels.filter(Boolean), cleanup: cleanupFn };
  }

  async _captureCanvasImage(labels = [], renderContext = null) {
    const exportViewer = renderContext?.viewer || this.viewer;
    const canvas = exportViewer?.renderer?.domElement;
    const camera = exportViewer?.camera;
    if (!canvas || !camera) throw new Error('Renderer not ready for capture');
    const width = canvas.width || canvas.clientWidth || 1;
    const height = canvas.height || canvas.clientHeight || 1;
    let baseData = renderContext?.baseImageDataUrl || canvas.toDataURL('image/png');
    const overlayLayers = [
      renderContext?.outlineImageDataUrl || null,
      renderContext?.centerlineImageDataUrl || null,
      renderContext?.annotationImageDataUrl || null,
    ].filter(Boolean);
    if (renderContext?.baseImageDataUrl && overlayLayers.length) {
      try {
        baseData = await this._composeImageLayers(renderContext.baseImageDataUrl, ...overlayLayers);
      } catch {
        baseData = renderContext.baseImageDataUrl;
      }
    }
    if (!Array.isArray(labels) || labels.length === 0) return baseData;

    const cssWidth = canvas.clientWidth || width;
    const svgMarkup = this._composeLabelSVG(baseData, labels, width, height, cssWidth, renderContext);
    if (!svgMarkup) throw new Error('Failed to compose SVG for labels');
    const svgPng = await this._svgToPngDataUrl(svgMarkup, width, height);
    if (!svgPng) throw new Error('Failed to convert SVG to PNG');
    return svgPng;
  }

  _resolveLabelAnchorOffsets(anchor) {
    const key = String(anchor || '').toLowerCase();
    if (key === 'left top') return { ox: 1, oy: 0 };
    if (key === 'left middle') return { ox: 1, oy: 0.5 };
    if (key === 'left bottom') return { ox: 1, oy: 1 };
    if (key === 'right top') return { ox: 0, oy: 0 };
    if (key === 'right middle') return { ox: 0, oy: 0.5 };
    if (key === 'right bottom') return { ox: 0, oy: 1 };
    return { ox: 0.5, oy: 0.5 };
  }

  _projectWorldToScreen(world, camera, viewport) {
    try {
      if (!world || !camera) return null;
      const { width = 1, height = 1 } = viewport || {};
      const v = world.clone ? world.clone() : new THREE.Vector3(world.x || 0, world.y || 0, world.z || 0);
      v.project(camera);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
      return {
        x: (v.x * 0.5 + 0.5) * width,
        y: (-v.y * 0.5 + 0.5) * height,
      };
    } catch { return null; }
  }

  _projectWorldToSvgScreen(world, camera, viewport) {
    try {
      if (!world || !camera) return null;
      const { width = 1, height = 1 } = viewport || {};
      const v = world.clone ? world.clone() : new THREE.Vector3(world.x || 0, world.y || 0, world.z || 0);
      v.project(camera);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
      return {
        x: v.x * (width * 0.5),
        y: -v.y * (height * 0.5),
      };
    } catch { return null; }
  }

  _normalizeLabelPosition(worldPos) {
    try {
      if (!worldPos) return null;
      if (worldPos.isVector3) return worldPos.clone();
      if (Array.isArray(worldPos) && worldPos.length >= 3) {
        return new THREE.Vector3(Number(worldPos[0]) || 0, Number(worldPos[1]) || 0, Number(worldPos[2]) || 0);
      }
      if (typeof worldPos === 'object') {
    return new THREE.Vector3(Number(worldPos.x) || 0, Number(worldPos.y) || 0, Number(worldPos.z) || 0);
      }
      return null;
    } catch { return null; }
  }

  _drawRoundedRect(ctx, x, y, w, h, r = 6, fill = '#0f172a', stroke = '#1f2937') {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _screenSizeWorld(pixels = 1, renderContext = null) {
    try {
      const exportViewer = renderContext?.viewer || this.viewer;
      const canvasRect = exportViewer?.renderer?.domElement?.getBoundingClientRect?.() || { width: 800, height: 600 };
      const wpp = this._worldPerPixel(exportViewer?.camera, canvasRect.width, canvasRect.height);
      return Math.max(0.0001, wpp * (pixels || 1));
    } catch { return 0.01; }
  }

  _worldPerPixel(camera, width, height) {
    try {
      if (camera && camera.isOrthographicCamera) {
        const zoom = (typeof camera.zoom === 'number' && camera.zoom > 0) ? camera.zoom : 1;
        const safeW = width || 1;
        const safeH = height || 1;
        const wppX = (camera.right - camera.left) / (safeW * zoom);
        const wppY = (camera.top - camera.bottom) / (safeH * zoom);
        return Math.max(Math.abs(wppX), Math.abs(wppY));
      }
      const dist = camera?.position?.length?.() || 1;
      const fovRad = (camera?.fov || 60) * Math.PI / 180;
      const h = 2 * Math.tan(fovRad / 2) * dist;
      return h / (height || 1);
    } catch { return 1; }
  }

  _alignNormal(alignment, ann, renderContext = null) {
    try {
      const exportViewer = renderContext?.viewer || this.viewer;
      const name = ann?.planeRefName || ann?.planeRef || '';
      if (name) {
        const scene = exportViewer?.partHistory?.scene || exportViewer?.scene;
        const obj = scene?.getObjectByName(name);
        if (obj) {
          if (obj.type === 'FACE' && typeof obj.getAverageNormal === 'function') {
            const local = obj.getAverageNormal().clone();
            const nm = new THREE.Matrix3(); nm.getNormalMatrix(obj.matrixWorld);
            return local.applyMatrix3(nm).normalize();
          }
          const w = new THREE.Vector3(0, 0, 1);
          try { obj.updateMatrixWorld(true); w.applyMatrix3(new THREE.Matrix3().getNormalMatrix(obj.matrixWorld)); } catch { }
          if (w.lengthSq()) return w.normalize();
        }
      }
    } catch { /* ignore */ }
    const mode = String(alignment || 'view').toLowerCase();
    if (mode === 'xy') return new THREE.Vector3(0, 0, 1);
    if (mode === 'yz') return new THREE.Vector3(1, 0, 0);
    if (mode === 'zx') return new THREE.Vector3(0, 1, 0);
    const n = new THREE.Vector3();
    try { (renderContext?.viewer?.camera || this.viewer?.camera)?.getWorldDirection?.(n); } catch { }
    return n.lengthSq() ? n : new THREE.Vector3(0, 0, 1);
  }

  _formatReferenceLabel(ann, text) {
    try {
      const t = String(text ?? '');
      if (!t) return t;
      if (ann && (ann.isReference === true)) return `(${t})`;
      return t;
    } catch { return text; }
  }

  _composeLabelSVG(baseImage, labels, width, height, cssWidth = null, renderContext = null) {
    if (!baseImage) throw new Error('Base image missing for SVG composition');
    const camera = renderContext?.viewer?.camera || this.viewer?.camera;
    const isMonochrome = this._isMonochromeExport(renderContext);
    const safeCssWidth = Math.max(1, cssWidth || width);
    const dpr = Math.max(1, width / safeCssWidth);
    const paddingX = 8 * dpr;
    const paddingY = 6 * dpr;
    const lineHeight = 18 * dpr;
    const radius = 8 * dpr;
    const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const fontSize = 14 * dpr;

    const layout = [];
    labels.forEach((label) => {
      if (!label || !label.world || label.text == null) return;
      const screen = this._projectWorldToScreen(label.world, camera, { width, height });
      if (!screen) return;
      const lines = String(label.text).split(/\r?\n/);
      const textWidth = lines.reduce((max, line) => Math.max(max, this._measureTextApprox(line, fontSize, fontFamily)), 0);
      const boxWidth = textWidth + paddingX * 2;
      const boxHeight = lines.length * lineHeight + paddingY * 2;
      const { ox, oy } = this._resolveLabelAnchorOffsets(label.anchor);
      const x = screen.x - ox * boxWidth;
      const y = screen.y - oy * boxHeight;
      layout.push({ x, y, boxWidth, boxHeight, lines });
    });

    if (!layout.length && labels.length) {
      throw new Error('No label positions resolved for SVG composition');
    }

    const escape = (s) => this._escapeXML(String(s));
    const rects = isMonochrome
      ? ''
      : layout.map(({ x, y, boxWidth, boxHeight }) =>
        `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" rx="${radius}" ry="${radius}" width="${boxWidth.toFixed(3)}" height="${boxHeight.toFixed(3)}" fill="rgba(17,24,39,0.92)" stroke="#111827" stroke-width="1"/>`).join('');

    const texts = layout.map(({ x, y, lines }) => {
      const parts = [];
      const startY = y + paddingY + lineHeight / 2;
      const textX = x + paddingX;
      lines.forEach((line, idx) => {
        const ty = startY + lineHeight * idx;
        parts.push(`<text x="${textX.toFixed(3)}" y="${ty.toFixed(3)}" font-family="${escape(fontFamily)}" font-size="${fontSize}" font-weight="${isMonochrome ? '600' : '700'}" fill="${isMonochrome ? '#000000' : '#ffffff'}" dominant-baseline="middle">${escape(line)}</text>`);
      });
      return parts.join('');
    }).join('');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <image href="${baseImage}" x="0" y="0" width="${width}" height="${height}" />
        ${rects}
        ${texts}
      </svg>
    `;
    return svg;
  }

  _measureTextApprox(text, fontSize = 14, _family = '') {
    if (!text) return 0;
    const avg = fontSize * 0.56; // rough average width per char
    return Math.max(fontSize, avg * String(text).length);
  }

  async _svgToPngDataUrl(svgMarkup, width, height) {
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      const dataUrl = await new Promise((resolve, reject) => {
        img.onload = () => {
          try {
            const out = document.createElement('canvas');
            out.width = width;
            out.height = height;
            const ctx = out.getContext('2d');
            if (!ctx) { reject(new Error('No 2D context for SVG rasterization')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            resolve(out.toDataURL('image/png'));
          } catch (e) { reject(e); }
        };
        img.onerror = (e) => reject(e || new Error('Image load error for SVG'));
        img.src = url;
      });
      return dataUrl;
    } finally {
      try { URL.revokeObjectURL(url); } catch { }
    }
  }

  async _composeImageLayers(baseDataUrl, ...overlayDataUrls) {
    const dataUrls = [baseDataUrl, ...overlayDataUrls.filter(Boolean)];
    const images = await Promise.all(dataUrls.map((dataUrl) => this._loadImageFromDataUrl(dataUrl)));
    const [baseImage, ...overlayImages] = images;
    const width = Math.max(
      1,
      ...images.map((image) => image.naturalWidth || image.width || 1),
    );
    const height = Math.max(
      1,
      ...images.map((image) => image.naturalHeight || image.height || 1),
    );

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) return baseDataUrl;
    outputCtx.drawImage(baseImage, 0, 0, width, height);
    for (const overlayImage of overlayImages) {
      outputCtx.drawImage(overlayImage, 0, 0, width, height);
    }
    return outputCanvas.toDataURL('image/png');
  }

  _loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (error) => reject(error || new Error('Failed to load image data URL'));
      img.src = dataUrl;
    });
  }

  _escapeXML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _dataUrlToUint8Array(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new Error('Invalid data URL for PNG export');
    }
    const parts = dataUrl.split(',');
    if (parts.length < 2) throw new Error('Malformed data URL');
    const base64 = parts[1];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  _safeFileName(raw, fallback = 'view') {
    const s = String(raw || '').trim() || fallback;
    return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || fallback;
  }


  _injectExportStyles(doc) {
    try {
      if (!doc || doc.getElementById('pmi-export-styles')) return;
      const style = doc.createElement('style');
      style.id = 'pmi-export-styles';
      style.textContent = `
        body { margin: 16px; background: #0b0e14; color: #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .pmi-export-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
        .pmi-export-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .pmi-export-card { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 8px 20px rgba(0,0,0,.45); }
        .pmi-export-card img { width: 100%; border-radius: 8px; background: #000; }
        .pmi-export-caption { font-weight: 600; word-break: break-word; }
      `;
      doc.head.appendChild(style);
    } catch { /* ignore style injection failures */ }
  }

  _awaitNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async _renderAndWait(frames = 1) {
    const count = Math.max(1, frames | 0);
    for (let i = 0; i < count; i++) {
      try { this.viewer?.render?.(); } catch { }
      await this._awaitNextFrame();
    }
    try { this.viewer?.render?.(); } catch { }
  }

  _withViewCubeHidden(fn) {
    const cube = this.viewer?.viewCube || null;
    if (!cube) return fn();
    this._viewCubeHideDepth = Math.max(0, Number(this._viewCubeHideDepth) || 0);
    this._viewCubeHideState = this._viewCubeHideState || null;
    return (async () => {
      this._viewCubeHideDepth += 1;
      try {
        if (this._viewCubeHideDepth === 1) {
          this._viewCubeHideState = {
            cube,
            render: cube.render,
            visible: cube.scene?.visible,
            overlayVisible: cube._overlayVisible,
            toggleButtonVisibility: this.viewer?._cameraProjectionToggleButton?.style?.visibility ?? "",
            toggleButtonPointerEvents: this.viewer?._cameraProjectionToggleButton?.style?.pointerEvents ?? "",
          };
          if (cube.scene) cube.scene.visible = false;
          try { cube.setOverlayVisible?.(false); } catch { /* ignore overlay hide errors */ }
          cube.render = () => {};
          if (this.viewer?._cameraProjectionToggleButton?.style) {
            this.viewer._cameraProjectionToggleButton.style.visibility = "hidden";
            this.viewer._cameraProjectionToggleButton.style.pointerEvents = "none";
          }
        }
        return await fn();
      } finally {
        this._viewCubeHideDepth = Math.max(0, this._viewCubeHideDepth - 1);
        if (this._viewCubeHideDepth === 0) {
          const state = this._viewCubeHideState;
          this._viewCubeHideState = null;
          const targetCube = state?.cube || cube;
          try {
            if (targetCube) targetCube.render = state?.render || targetCube.render;
          } catch { /* ignore restore errors */ }
          try {
            if (targetCube?.scene && state && state.visible !== undefined) {
              targetCube.scene.visible = state.visible;
            }
          } catch { /* ignore restore errors */ }
          try {
            if (targetCube) targetCube.setOverlayVisible?.(state?.overlayVisible !== false);
          } catch { /* ignore overlay restore errors */ }
          try {
            const toggleButton = this.viewer?._cameraProjectionToggleButton || null;
            if (toggleButton?.style) {
              toggleButton.style.visibility = state?.toggleButtonVisibility ?? "";
              toggleButton.style.pointerEvents = state?.toggleButtonPointerEvents ?? "";
            }
            this.viewer?._positionCameraProjectionToggle?.();
          } catch { /* ignore restore errors */ }
          try { this.viewer?.render?.(); } catch { /* ignore restore render errors */ }
        }
      }
    })();
  }

  _restoreViewState(snapshot, wireframe) {
    try {
      const viewer = this.viewer;
      if (snapshot && viewer?.camera) {
        const dom = viewer?.renderer?.domElement;
        const rect = dom?.getBoundingClientRect?.();
        const viewport = {
          width: rect?.width || dom?.width || 1,
          height: rect?.height || dom?.height || 1,
        };
        applyCameraSnapshot(viewer.camera, snapshot, { controls: viewer.controls, respectParent: true, syncControls: true, viewport });
        adjustOrthographicFrustum(viewer.camera, snapshot?.projection || null, viewport);
      }
      if (typeof wireframe === 'boolean') {
        this._applyWireframe(viewer?.scene, wireframe);
      }
      try { viewer?.render?.(); } catch { }
    } catch { /* ignore restore errors */ }
  }

  _applyView(view, { index = null, suppressActive = false, viewport = null } = {}) {
    try {
      const v = this.viewer;
      const cam = v?.camera;
      if (!cam || !view || !view.camera) return;

      const ctrls = this.viewer?.controls;
      const resolvedViewport = viewport || this._getViewerViewportMetrics();
      const applied = applyCameraSnapshot(cam, view.camera, { controls: ctrls, respectParent: true, syncControls: false, viewport: resolvedViewport });

      if (!applied) {
        // Fallback for legacy snapshots that somehow failed the structured restore
        const legacy = view.camera;
        if (legacy.position) {
          cam.position.set(legacy.position.x, legacy.position.y, legacy.position.z);
        }
        if (legacy.quaternion) {
          cam.quaternion.set(legacy.quaternion.x, legacy.quaternion.y, legacy.quaternion.z, legacy.quaternion.w);
        }
        if (legacy.up) {
          cam.up.set(legacy.up.x, legacy.up.y, legacy.up.z);
        }
        if (typeof legacy.zoom === 'number' && Number.isFinite(legacy.zoom) && legacy.zoom > 0) {
          cam.zoom = legacy.zoom;
        }
        if (legacy.target && ctrls) {
          try {
            if (typeof ctrls.setTarget === 'function') {
              ctrls.setTarget(legacy.target.x, legacy.target.y, legacy.target.z);
            } else if (ctrls.target) {
              ctrls.target.set(legacy.target.x, legacy.target.y, legacy.target.z);
            }
          } catch { /* ignore */ }
        }
        adjustOrthographicFrustum(cam, legacy?.projection || null, resolvedViewport);
        cam.updateMatrixWorld(true);
        try { ctrls?.update?.(); } catch {}
      }
      adjustOrthographicFrustum(cam, view.camera?.projection || null, resolvedViewport);
      try { ctrls?.updateMatrixState?.(); } catch {}
      // Apply persisted view settings (e.g., wireframe) if present
      try {
        const vs = view.viewSettings || {};
        if (typeof vs.wireframe === 'boolean') {
          this._applyWireframe(v?.scene, vs.wireframe);
        }
      } catch { }
      try { this.viewer.render(); } catch { }
      if (!suppressActive && Number.isInteger(index)) {
        this._setActiveViewIndex(index);
        this._renderList();
        if (this._readOnly) {
          try { this.viewer?.startPMIPreviewMode?.(view, index, this); } catch { }
        }
      }
    } catch { /* ignore */ }
  }

  _setViewWireframe(index, isWireframe) {
    if (this._readOnly) return;
    const applyFlag = (entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      if (!entry.viewSettings || typeof entry.viewSettings !== 'object') {
        entry.viewSettings = {};
      }
      entry.viewSettings.wireframe = isWireframe;
      return entry;
    };

    let updated = false;
    const manager = this.viewer?.partHistory?.pmiViewsManager;
    if (manager && typeof manager.updateView === 'function') {
      const result = manager.updateView(index, (entry) => applyFlag(entry));
      updated = Boolean(result);
    } else if (Array.isArray(this.views) && this.views[index]) {
      applyFlag(this.views[index]);
      updated = true;
      this.refreshFromHistory();
    }

    if (!updated) {
      this.refreshFromHistory();
      this._renderList();
    }

    const activePMI = this.viewer?._pmiMode;
    if (activePMI && Number.isInteger(activePMI.viewIndex) && activePMI.viewIndex === index) {
      try {
        this._applyWireframe(this.viewer?.scene, isWireframe);
      } catch { /* ignore */ }
    }
  }

  _updateViewCamera(index) {
    if (this._readOnly) return;
    try {
      const camera = this.viewer?.camera;
      if (!camera) return;
      const ctrls = this.viewer?.controls;
      const snap = captureCameraSnapshot(camera, {
        controls: ctrls,
        viewport: this._getViewerViewportMetrics(),
      });
      if (!snap) return;

      let updated = false;
      const manager = this.viewer?.partHistory?.pmiViewsManager;
      if (manager && typeof manager.updateView === 'function') {
        const result = manager.updateView(index, (entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          entry.camera = snap;
          return entry;
        });
        updated = Boolean(result);
      } else if (Array.isArray(this.views) && this.views[index]) {
        this.views[index].camera = snap;
        updated = true;
        this.refreshFromHistory();
      }

      if (!updated) {
        this.refreshFromHistory();
        this._renderList();
      }
    } catch { /* ignore */ }
  }

  async _enterEditMode(view, index) {
    if (this._readOnly) {
      try { this._applyView(view, { index }); } catch {}
      return;
    }
    const wasInPMIWorkbench = this.viewer?._getActiveWorkbenchId?.() === 'PMI';
    try {
      const activePMI = this.viewer?._pmiMode;
      if (activePMI) {
        try {
          if (wasInPMIWorkbench) this.viewer._suspendWorkbenchReturn = true;
          await activePMI.finish();
        } catch (err) {
          console.warn('PMI Views: failed to finish active PMI session before switching', err);
        } finally {
          if (wasInPMIWorkbench) this.viewer._suspendWorkbenchReturn = false;
        }
      }
    } catch (err) {
      console.warn('PMI Views: unexpected PMI session check failure', err);
    }

    try { this._applyView(view, { index }); } catch {}
    try { this.viewer.startPMIMode?.(view, index, this, { fromViewClick: true }); } catch {}
  }

  // --- Helpers: view settings ---
  _isFaceObject(obj) {
    return !!obj && (obj.type === 'FACE' || (obj.isMesh && typeof obj.userData?.faceName === 'string'));
  }

  _detectWireframe(scene) {
    try {
      if (!scene) return false;
      let wf = false;
      scene.traverse((obj) => {
        if (wf) return;
        if (!this._isFaceObject(obj)) return;
        const m = obj?.material;
        if (!m) return;
        if (Array.isArray(m)) {
          for (const mm of m) { if (mm && 'wireframe' in mm && mm.wireframe) { wf = true; break; } }
        } else if ('wireframe' in m && m.wireframe) {
          wf = true;
        }
      });
      return wf;
    } catch { return false; }
  }

  _applyWireframe(scene, isWireframe) {
    try {
      if (!scene) return;
      const apply = (mat) => { if (mat && 'wireframe' in mat) mat.wireframe = !!isWireframe; };
      scene.traverse((obj) => {
        if (!this._isFaceObject(obj)) return;
        const m = obj?.material;
        if (!m) return;
        if (Array.isArray(m)) {
          for (const mm of m) apply(mm);
        } else {
          apply(m);
        }
      });
    } catch { /* ignore */ }
  }

}

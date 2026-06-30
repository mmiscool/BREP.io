import * as THREE from 'three';
import { FloatingWindow } from '../FloatingWindow.js';
import { SelectionFilter } from '../SelectionFilter.js';
import {
  analyzeSolidFaceOverlaps,
  analyzeSolidPairFaceOverlaps,
  SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS,
} from '../solidOverlapDiagnostics.js';

const PANEL_KEY = Symbol('SolidOverlapDiagnosticsPanel');
const OVERLAY_GROUP_NAME = '__solid_overlap_diagnostics_overlay__';

type AnyRecord = Record<string | symbol, any>;

function getScene(viewer) {
  return viewer?.partHistory?.scene || viewer?.scene || null;
}

function getSelection(viewer) {
  const scene = getScene(viewer);
  return SelectionFilter.getSelectedObjects({ scene }) || [];
}

function resolveTargetLabel(target) {
  if (!target) return 'Nothing selected';
  const type = String(target?.type || 'OBJECT').toUpperCase();
  const name = target?.name || target?.userData?.faceName || target?.userData?.edgeName || target?.userData?.solidName || null;
  return name ? `${type} ${name}` : type;
}

function resolveSolidLabel(solid) {
  return String(solid?.name || solid?.userData?.solidName || '').trim() || '(unnamed solid)';
}

class SolidOverlapDiagnosticsPanel {
  viewer: AnyRecord | null;
  window: any;
  root: HTMLElement | null;
  content: HTMLElement | null;
  open: boolean;
  currentTarget: any;
  currentSolids: any[];
  currentAnalysis: any;
  _analysisKey: string | null;
  _overlayGroup: any;
  _overlayMeshes: any[];
  _overlayMaterials: any[];
  _pollTimer: any;
  _selectionChanged: () => void;

  constructor(viewer) {
    this.viewer = viewer || null;
    this.window = null;
    this.root = null;
    this.content = null;
    this.open = false;
    this.currentTarget = null;
    this.currentSolids = [];
    this.currentAnalysis = null;
    this._analysisKey = null;
    this._overlayGroup = null;
    this._overlayMeshes = [];
    this._overlayMaterials = [];
    this._pollTimer = null;
    this._selectionChanged = this._handleSelectionChanged.bind(this);
    try { this.viewer.__solidOverlapDiagnosticsController = this; } catch {
      // best effort
    }
    try { window.addEventListener('selection-changed', this._selectionChanged); } catch {
      // best effort
    }
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel() {
    this._ensureWindow();
    this.open = true;
    try { this.root.style.display = 'flex'; } catch {
      // best effort
    }
    this._handleSelectionChanged();
    this._startPolling();
  }

  close() {
    this.open = false;
    this.currentTarget = null;
    this.currentSolids = [];
    this.currentAnalysis = null;
    this._analysisKey = null;
    this._stopPolling();
    this._clearOverlay();
    if (this.root) {
      try { this.root.style.display = 'none'; } catch {
        // best effort
      }
    }
  }

  handleSelection(target) {
    this.currentTarget = target || null;
    this.currentSolids = this._collectCandidateSolids(target);
    if (this.open) this._refreshCurrentAnalysis();
  }

  _ensureWindow() {
    if (this.root) return;

    const fw = new FloatingWindow({
      title: 'Solid Overlap Diagnostics',
      width: 500,
      height: 520,
      right: 16,
      top: 120,
      shaded: false,
      onClose: () => this.close(),
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'fw-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.title = 'Recompute overlaps for the active solid comparison';
    refreshBtn.addEventListener('click', () => this._refreshCurrentAnalysis({ force: true }));
    fw.addHeaderAction(refreshBtn);

    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '10px';
    content.style.padding = '10px';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.minHeight = '0';
    content.style.boxSizing = 'border-box';
    content.style.overflowX = 'hidden';
    content.style.overflowY = 'auto';
    fw.content.appendChild(content);

    this.window = fw;
    this.root = fw.root;
    this.content = content;
    try { this.root.style.display = 'none'; } catch {
      // best effort
    }
  }

  _handleSelectionChanged() {
    const selection = getSelection(this.viewer);
    if (!selection.length) {
      const fallback = this.currentTarget || this.viewer?._lastInspectorTarget || null;
      if (fallback) {
        this.handleSelection(fallback);
        return;
      }
      this.currentTarget = null;
      this.currentSolids = [];
      if (this.open) {
        this.currentAnalysis = null;
        this._analysisKey = null;
        this._clearOverlay();
        this._renderPlaceholder('Select one solid for self-diagnostics, or select two solids to compare them.');
      }
      return;
    }

    const preferred = this.viewer?._lastInspectorTarget || selection[selection.length - 1] || selection[0] || null;
    this.handleSelection(preferred);
  }

  _resolveSolid(target) {
    let current = target || null;
    while (current) {
      if (String(current?.type || '').toUpperCase() === 'SOLID') return current;
      if (current?.parentSolid && String(current.parentSolid?.type || '').toUpperCase() === 'SOLID') return current.parentSolid;
      current = current.parent || null;
    }
    return null;
  }

  _collectCandidateSolids(preferredTarget = null) {
    const solids = [];
    const seen = new Set();
    const addSolid = (target) => {
      const solid = this._resolveSolid(target);
      if (!solid) return;
      const key = String(solid.uuid || solid.name || solids.length);
      if (seen.has(key)) return;
      seen.add(key);
      solids.push(solid);
    };

    addSolid(preferredTarget);
    addSolid(this.viewer?._lastInspectorTarget || null);
    for (const item of getSelection(this.viewer)) {
      addSolid(item);
      if (solids.length >= 2) break;
    }

    return solids.slice(0, 2);
  }

  _resolveLiveSolid(solid, scene) {
    if (!solid) return null;
    if (scene && solid.name && typeof scene.getObjectByName === 'function') {
      const live = scene.getObjectByName(solid.name);
      if (live) return this._resolveSolid(live) || live;
    }
    return this._resolveSolid(solid) || solid;
  }

  _computeAnalysisKey(solids) {
    if (!Array.isArray(solids) || !solids.length) return null;
    return solids.map((solid) => {
      const faceCount = Array.isArray(solid?.children)
        ? solid.children.filter((child) => String(child?.type || '').toUpperCase() === 'FACE').length
        : 0;
      return [
        solid?.uuid || '',
        solid?.name || '',
        Number.isFinite(Number(solid?.timestamp)) ? String(Number(solid.timestamp)) : '',
        String(faceCount),
      ].join('|');
    }).join('::');
  }

  _refreshCurrentAnalysis({ force = false } = {}) {
    if (!this.open) return;

    const scene = getScene(this.viewer);
    if (!scene || !Array.isArray(this.currentSolids) || this.currentSolids.length === 0) {
      this.currentAnalysis = null;
      this._analysisKey = null;
      this._clearOverlay();
      this._renderPlaceholder('Select one solid for self-diagnostics, or select two solids to compare them.');
      return;
    }

    this.currentSolids = this.currentSolids
      .map((solid) => this._resolveLiveSolid(solid, scene))
      .filter(Boolean)
      .slice(0, 2);

    if (!this.currentSolids.length) {
      this.currentAnalysis = null;
      this._analysisKey = null;
      this._clearOverlay();
      this._renderPlaceholder('Select one solid for self-diagnostics, or select two solids to compare them.');
      return;
    }

    const nextKey = this._computeAnalysisKey(this.currentSolids);
    if (!force && nextKey && nextKey === this._analysisKey && this.currentAnalysis) {
      this._renderAnalysis();
      return;
    }

    this._analysisKey = nextKey;
    this.currentAnalysis = this.currentSolids.length >= 2
      ? analyzeSolidPairFaceOverlaps(this.currentSolids[0], this.currentSolids[1], SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS)
      : analyzeSolidFaceOverlaps(this.currentSolids[0], SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS);
    this._renderAnalysis();
  }

  _renderPlaceholder(message) {
    this._ensureWindow();
    if (!this.content) return;
    this.content.textContent = '';
    const text = document.createElement('div');
    text.textContent = message;
    text.style.color = '#9aa4b2';
    text.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    this.content.appendChild(text);
  }

  _renderAnalysis() {
    this._ensureWindow();
    if (!this.content) return;

    const analysis = this.currentAnalysis;
    if (!analysis) {
      this._clearOverlay();
      this._renderPlaceholder('Select one solid for self-diagnostics, or select two solids to compare them.');
      return;
    }

    this.content.textContent = '';

    const makeSection = (title, value) => {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '130px 1fr';
      row.style.gap = '8px';
      row.style.alignItems = 'start';

      const label = document.createElement('div');
      label.textContent = title;
      label.style.color = '#8b98a5';
      label.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

      const text = document.createElement('div');
      text.textContent = value;
      text.style.color = '#e6edf3';
      text.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      text.style.wordBreak = 'break-word';

      row.appendChild(label);
      row.appendChild(text);
      this.content.appendChild(row);
    };

    makeSection('Picked target', resolveTargetLabel(this.currentTarget));
    makeSection('Mode', analysis.mode === 'pair' ? 'Between two solids' : 'Within one solid');
    if (analysis.mode === 'pair') {
      makeSection('Solid A', resolveSolidLabel(this.currentSolids[0]));
      makeSection('Solid B', resolveSolidLabel(this.currentSolids[1]));
      makeSection('Faces scanned', `${analysis.faceCountA || 0} + ${analysis.faceCountB || 0}`);
    } else {
      makeSection('Solid', resolveSolidLabel(this.currentSolids[0]));
      makeSection('Faces scanned', String(analysis.faceCount || 0));
    }
    makeSection('Overlap pairs', String(analysis.overlaps?.length || 0));
    makeSection(
      'Highlighted faces',
      String((Object.values(analysis.highlightedBySolid || {}) as AnyRecord[]).reduce((sum, record) => sum + (record?.faceNames?.length || 0), 0)),
    );
    makeSection(
      'Tolerance',
      `angle <= ${SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS.normalToleranceDeg} deg, plane <= ${SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS.planeDistanceTolerance}`,
    );

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.marginTop = '4px';
    this.content.appendChild(list);

    if (!Array.isArray(analysis.overlaps) || analysis.overlaps.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = analysis.mode === 'pair'
        ? 'No positive-area near-coplanar face overlaps were found between the two solids.'
        : 'No positive-area near-coplanar face overlaps were found inside this solid.';
      empty.style.color = '#9aa4b2';
      empty.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      list.appendChild(empty);
      this._clearOverlay();
      return;
    }

    for (const entry of analysis.overlaps) {
      const item = document.createElement('div');
      item.style.border = '1px solid rgba(255,255,255,0.08)';
      item.style.borderRadius = '8px';
      item.style.padding = '8px 10px';
      item.style.background = 'rgba(255,255,255,0.03)';

      const title = document.createElement('div');
      title.textContent = analysis.mode === 'pair'
        ? `${entry.solidA || 'Solid A'}:${entry.faceA} <> ${entry.solidB || 'Solid B'}:${entry.faceB}`
        : `${entry.faceA} <> ${entry.faceB}`;
      title.style.color = '#fbe4a5';
      title.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      title.style.fontWeight = '700';
      item.appendChild(title);

      const details = document.createElement('div');
      details.textContent = `overlap area=${entry.overlapArea.toFixed(6)}  plane distance=${entry.planeDistance.toExponential(2)}  angle=${entry.angleDeg.toFixed(4)} deg`;
      details.style.marginTop = '4px';
      details.style.color = '#d6dde6';
      details.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      details.style.wordBreak = 'break-word';
      item.appendChild(details);

      list.appendChild(item);
    }

    this._syncOverlay();
  }

  _ensureOverlayGroup() {
    const scene = getScene(this.viewer);
    if (!scene) return null;
    if (this._overlayGroup?.parent === scene) return this._overlayGroup;

    let group = null;
    try { group = scene.getObjectByName(OVERLAY_GROUP_NAME) || null; } catch {
      group = null;
    }
    if (!group) {
      group = new THREE.Group();
      group.name = OVERLAY_GROUP_NAME;
      group.userData = {
        ...(group.userData || {}),
        preventRemove: true,
        excludeFromFit: true,
        solidOverlapDiagnostics: true,
      };
      group.renderOrder = 10030;
      group.raycast = () => { };
      scene.add(group);
    }

    this._overlayGroup = group;
    return group;
  }

  _syncOverlay() {
    const analysis = this.currentAnalysis;
    const solids = Array.isArray(this.currentSolids) ? this.currentSolids : [];
    if (!analysis || !solids.length) {
      this._clearOverlay();
      return;
    }

    const highlightedBySolid = analysis.highlightedBySolid || {};
    const highlightedKeys = Object.keys(highlightedBySolid);
    if (!highlightedKeys.length) {
      this._clearOverlay();
      return;
    }

    const group = this._ensureOverlayGroup();
    if (!group) return;
    this._clearOverlayChildren();

    const paletteByIndex = [
      { fill: '#ff4d4f', line: '#ffd166' },
      { fill: '#3abff8', line: '#c5f1ff' },
    ];
    const materialCache = new Map();

    const getMaterials = (solidKey, solidIndex) => {
      if (materialCache.has(solidKey)) return materialCache.get(solidKey);
      const palette = paletteByIndex[Math.min(Math.max(solidIndex, 0), paletteByIndex.length - 1)];
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: palette.fill,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      const lineMaterial = new THREE.LineBasicMaterial({
        color: palette.line,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      this._overlayMaterials.push(fillMaterial, lineMaterial);
      const value = { fillMaterial, lineMaterial };
      materialCache.set(solidKey, value);
      return value;
    };

    solids.forEach((solid, solidIndex) => {
      const solidKey = String(solid?.uuid || solid?.name || solidIndex);
      const record = highlightedBySolid[solidKey] || null;
      if (!record?.faceNames?.length) return;
      const faceSet = new Set(record.faceNames.map((name) => String(name)));
      const materials = getMaterials(solidKey, solidIndex);

      const faces = Array.isArray(solid.children) ? solid.children : [];
      for (const face of faces) {
        if (!face || String(face?.type || '').toUpperCase() !== 'FACE') continue;
        const faceName = String(face?.name || face?.userData?.faceName || '').trim();
        if (!faceSet.has(faceName)) continue;

        face.updateMatrixWorld?.(true);
        const worldGeometry = face.geometry?.clone?.();
        if (!worldGeometry) continue;
        worldGeometry.applyMatrix4(face.matrixWorld);

        const mesh = new THREE.Mesh(worldGeometry, materials.fillMaterial);
        mesh.name = `__solid_overlap_face__${solidKey}__${faceName}`;
        mesh.renderOrder = 10030;
        mesh.userData = {
          ...(mesh.userData || {}),
          preventRemove: true,
          excludeFromFit: true,
        };
        mesh.raycast = () => { };
        group.add(mesh);
        this._overlayMeshes.push(mesh);

        const edgeGeometry = new THREE.EdgesGeometry(worldGeometry);
        const lines = new THREE.LineSegments(edgeGeometry, materials.lineMaterial);
        lines.name = `__solid_overlap_face_edges__${solidKey}__${faceName}`;
        lines.renderOrder = 10031;
        lines.userData = {
          ...(lines.userData || {}),
          preventRemove: true,
          excludeFromFit: true,
        };
        lines.raycast = () => { };
        group.add(lines);
        this._overlayMeshes.push(lines);
      }
    });

    try { this.viewer?.render?.(); } catch {
      // best effort
    }
  }

  _clearOverlayChildren() {
    const group = this._overlayGroup;
    if (!group || !Array.isArray(this._overlayMeshes)) return;
    for (const mesh of this._overlayMeshes.splice(0)) {
      try { group.remove(mesh); } catch {
        // best effort
      }
      try { mesh.geometry?.dispose?.(); } catch {
        // best effort
      }
    }
    for (const material of this._overlayMaterials.splice(0)) {
      try { material?.dispose?.(); } catch {
        // best effort
      }
    }
  }

  _clearOverlay() {
    this._clearOverlayChildren();
    const group = this._overlayGroup;
    if (!group) return;
    try {
      if (group.parent && group.children.length === 0) group.parent.remove(group);
    } catch {
      // best effort
    }
    this._overlayGroup = null;
    try { this.viewer?.render?.(); } catch {
      // best effort
    }
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = window.setInterval(() => {
      if (!this.open || !this.currentSolids.length) return;
      this._refreshCurrentAnalysis();
    }, 500);
  }

  _stopPolling() {
    if (!this._pollTimer) return;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }
}

export function createSolidOverlapDiagnosticsButton(viewer) {
  if (!viewer) return null;
  const targetViewer = viewer as AnyRecord;
  if (!targetViewer[PANEL_KEY]) {
    targetViewer[PANEL_KEY] = new SolidOverlapDiagnosticsPanel(targetViewer);
  }
  const panel = targetViewer[PANEL_KEY];
  return {
    label: 'Solid diag',
    title: 'Diagnose overlapping coplanar faces inside one solid or between two solids',
    onClick: () => panel.toggle(),
  };
}

import JSZip from 'jszip';
import * as THREE from 'three';
import { FloatingWindow } from '../FloatingWindow.js';
import { buildSheetMetalFlatPatternSolids, buildSheetMetalFlatPatternSvgs } from '../../exporters/sheetMetalFlatPattern.js';
import { buildDebugLineSegments } from '../../exporters/sheetMetalUnfold.js';

const PANEL_KEY = '__flatPatternPanel';

function _collectSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const solids = [];
  scene.traverse((o) => {
    if (!o || !o.visible) return;
    if (o.type === 'SOLID' && typeof o.getMesh === 'function') solids.push(o);
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

function _ensureStyles() {
  if (document.getElementById('flat-pattern-styles')) return;
  const style = document.createElement('style');
  style.id = 'flat-pattern-styles';
  style.textContent = `
      .flat-pattern-content { display:flex; flex-direction:column; gap:10px; padding:10px; width:100%; height:100%; min-height:0; box-sizing:border-box; color:#e5e7eb; }
      .flat-pattern-row { display:flex; align-items:center; gap:8px; }
      .flat-pattern-label { min-width:70px; font-size:12px; color:#9aa0aa; }
      .flat-pattern-select { flex:1 1 auto; padding:6px 8px; border-radius:8px; background:#0b0e14; color:#e5e7eb; border:1px solid #374151; outline:none; font-size:12px; }
      .flat-pattern-select:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
      .flat-pattern-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
      .flat-pattern-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .flat-pattern-btn:active { transform: translateY(1px); }
      .flat-pattern-check { display:flex; align-items:center; gap:6px; font-size:12px; color:#cbd5f5; }
      .flat-pattern-detail { flex:1 1 auto; min-height:0; font-size:12px; color:#cfd6e4; background:rgba(8,10,14,.55); border:1px solid #1f2937; border-radius:8px; padding:8px; overflow:auto; white-space:pre-wrap; line-height:1.35; }
      .flat-pattern-empty { font-size:12px; color:#9aa0aa; }
    `;
  document.head.appendChild(style);
}

class FlatPatternPanel {
  constructor(viewer) {
    this.viewer = viewer;
    this.window = null;
    this.root = null;
    this.content = null;
    this.previewGroup = null;
    this.solids = [];
    this.activeEntry = null;
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
    this._refreshSolids();
  }

  close() {
    this._clearPreview();
    if (this.root) {
      try { this.root.style.display = 'none'; } catch { }
    }
  }

  _ensureWindow() {
    if (this.window && this.root) return;
    _ensureStyles();
    const fw = new FloatingWindow({
      title: 'Flat Pattern',
      width: 420,
      height: 360,
      right: 14,
      top: 80,
      shaded: false,
      onClose: () => this.close(),
    });
    const content = document.createElement('div');
    content.className = 'flat-pattern-content';
    fw.content.appendChild(content);

    const rowSolid = document.createElement('div');
    rowSolid.className = 'flat-pattern-row';
    const labSolid = document.createElement('div');
    labSolid.className = 'flat-pattern-label';
    labSolid.textContent = 'Solid';
    const selSolid = document.createElement('select');
    selSolid.className = 'flat-pattern-select';
    rowSolid.appendChild(labSolid);
    rowSolid.appendChild(selSolid);

    const rowActions = document.createElement('div');
    rowActions.className = 'flat-pattern-row';
    const btnGenerate = document.createElement('button');
    btnGenerate.className = 'flat-pattern-btn';
    btnGenerate.textContent = 'Generate';
    const btnExport = document.createElement('button');
    btnExport.className = 'flat-pattern-btn';
    btnExport.textContent = 'Export SVG';
    const btnExportAll = document.createElement('button');
    btnExportAll.className = 'flat-pattern-btn';
    btnExportAll.textContent = 'Export All';
    rowActions.appendChild(btnGenerate);
    rowActions.appendChild(btnExport);
    rowActions.appendChild(btnExportAll);

    const rowPreview = document.createElement('div');
    rowPreview.className = 'flat-pattern-row';
    const previewLabel = document.createElement('label');
    previewLabel.className = 'flat-pattern-check';
    const previewCheck = document.createElement('input');
    previewCheck.type = 'checkbox';
    previewLabel.appendChild(previewCheck);
    previewLabel.appendChild(document.createTextNode('Show preview lines'));
    rowPreview.appendChild(previewLabel);

    const detail = document.createElement('div');
    detail.className = 'flat-pattern-detail';
    detail.textContent = 'Select a solid and click Generate.';

    content.appendChild(rowSolid);
    content.appendChild(rowActions);
    content.appendChild(rowPreview);
    content.appendChild(detail);

    btnGenerate.addEventListener('click', () => this._generate());
    btnExport.addEventListener('click', () => this._exportSingle());
    btnExportAll.addEventListener('click', () => this._exportAll());
    previewCheck.addEventListener('change', () => this._refreshPreview());
    selSolid.addEventListener('change', () => {
      this.activeEntry = null;
      detail.textContent = 'Select a solid and click Generate.';
      this._clearPreview();
    });

    this.window = fw;
    this.root = fw.root;
    this.content = content;
    this.ui = { selSolid, detail, previewCheck };
    if (this.viewer) this.viewer[PANEL_KEY] = this;
  }

  _refreshSolids() {
    const solids = _collectSolids(this.viewer);
    this.solids = solids;
    const select = this.ui.selSolid;
    if (!select) return;
    select.innerHTML = '';
    solids.forEach((solid, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = solid?.name || `SOLID_${idx + 1}`;
      select.appendChild(opt);
    });
    if (!solids.length) {
      const opt = document.createElement('option');
      opt.value = '-1';
      opt.textContent = 'No solids found';
      select.appendChild(opt);
    }
  }

  _getSelectedSolid() {
    const idx = Number(this.ui.selSolid?.value ?? -1);
    if (!Number.isFinite(idx) || idx < 0 || idx >= this.solids.length) return null;
    return this.solids[idx] || null;
  }

  _generate() {
    const solid = this._getSelectedSolid();
    if (!solid) {
      this._setDetail('No solid selected.');
      return;
    }

    const entries = buildSheetMetalFlatPatternSolids([solid], {});
    const entry = Array.isArray(entries) && entries.length ? entries[0] : null;
    if (!entry || !entry.flatPattern) {
      this._setDetail('No flat pattern generated. Check that the solid has faceId + bend metadata.');
      this.activeEntry = null;
      this._clearPreview();
      return;
    }

    this.activeEntry = entry;
    const fp = entry.flatPattern;
    const outlineCount = Array.isArray(fp.outlines) ? fp.outlines.length : 0;
    const holeCount = Array.isArray(fp.holes) ? fp.holes.length : 0;
    const bendCount = Array.isArray(fp.bendLines) ? fp.bendLines.length : 0;
    const line1 = `Flat pattern ready for ${entry.name}.`;
    const line2 = `Outlines: ${outlineCount}, Holes: ${holeCount}, Bends: ${bendCount}.`;
    const warnings = Array.isArray(entry.warnings) && entry.warnings.length
      ? `Warnings:\n- ${entry.warnings.join('\n- ')}`
      : null;
    this._setDetail([line1, line2, warnings].filter(Boolean).join('\n'));
    this._refreshPreview();
  }

  _exportSingle() {
    if (!this.activeEntry || !this.activeEntry.svg) {
      this._setDetail('Generate a flat pattern before exporting.');
      return;
    }
    const safe = _safeName(this.activeEntry.name || 'flat');
    _download(`${safe}_flat.svg`, this.activeEntry.svg, 'image/svg+xml');
  }

  async _exportAll() {
    const solids = this.solids.length ? this.solids : _collectSolids(this.viewer);
    if (!solids.length) {
      this._setDetail('No solids available to export.');
      return;
    }
    const entries = buildSheetMetalFlatPatternSvgs(solids, {});
    if (!entries.length) {
      this._setDetail('No flat pattern SVGs available.');
      return;
    }
    const zip = new JSZip();
    for (const entry of entries) {
      const safe = _safeName(entry.name || 'flat');
      zip.file(`${safe}_flat.svg`, entry.svg);
    }
    const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const base = _safeName(this.viewer?.fileManagerWidget?.currentName || 'flatpattern');
    _download(`${base}_flatpattern.zip`, blob, 'application/zip');
  }

  _refreshPreview() {
    if (!this.ui.previewCheck?.checked || !this.activeEntry?.flatPattern) {
      this._clearPreview();
      return;
    }
    this._clearPreview();
    const solid = this._getSelectedSolid();
    if (!solid || !this.viewer?.scene) return;

    const { cut, bends } = buildDebugLineSegments(this.activeEntry.flatPattern);
    const group = new THREE.Group();
    group.add(cut);
    group.add(bends);
    group.userData = { tool: 'flat-pattern-preview' };

    const solidBox = new THREE.Box3().setFromObject(solid);
    const flatBox = new THREE.Box3().setFromObject(group);
    if (!solidBox.isEmpty() && !flatBox.isEmpty()) {
      const size = solidBox.getSize(new THREE.Vector3());
      const margin = Math.max(size.length() * 0.2, 1);
      const offsetX = solidBox.max.x - flatBox.min.x + margin;
      const offsetY = solidBox.min.y - flatBox.min.y;
      group.position.set(offsetX, offsetY, solidBox.min.z);
    }

    this.viewer.scene.add(group);
    this.previewGroup = group;
    try { this.viewer.render && this.viewer.render(); } catch { }
  }

  _clearPreview() {
    const group = this.previewGroup;
    if (group && this.viewer?.scene) {
      try { this.viewer.scene.remove(group); } catch { }
      try {
        group.traverse((child) => {
          child.geometry?.dispose?.();
          child.material?.dispose?.();
        });
      } catch { }
    }
    this.previewGroup = null;
  }

  _setDetail(text) {
    if (this.ui.detail) this.ui.detail.textContent = text || '';
  }
}

export function createFlatPatternButton(viewer) {
  const onClick = () => {
    let panel = viewer?.[PANEL_KEY];
    if (!panel) panel = new FlatPatternPanel(viewer);
    panel.toggle();
  };
  return { label: '📐', title: 'Flat Pattern', onClick };
}

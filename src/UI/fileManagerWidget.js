// fileManagerWidget.js
// A lightweight widget to save/load/delete models using IndexedDB storage.
// Designed to be embedded as an Accordion section (similar to expressionsManager).
import * as THREE from 'three';
import JSZip from 'jszip';
import { generate3MF, computeTriangleMaterialIndices } from '../exporters/threeMF.js';
import { CADmaterials } from './CADmaterials.js';
import { localStorage as LS, STORAGE_BACKEND_EVENT } from '../idbStorage.js';
import {
  listComponentRecords,
  getComponentRecord,
  setComponentRecord,
  removeComponentRecord,
  MODEL_STORAGE_PREFIX,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../services/componentLibrary.js';
import { HISTORY_COLLECTION_REFRESH_EVENT } from './history/HistoryCollectionWidget.js';

export class FileManagerWidget {
  constructor(viewer) {
    this.viewer = viewer;
    this.uiElement = document.createElement('div');
    // Per-model storage prefix
    this._modelPrefix = MODEL_STORAGE_PREFIX;
    this._lastKey = '__BREP_MODELS_LASTNAME__';
    this.currentName = this._loadLastName() || '';
    this._iconsOnly = this._loadIconsPref();
    this._loadSeq = 0; // guards async load races
    this._thumbCache = new Map();
    this._pendingGithubMeta = new Map();
    this._saveOverlay = null;
    this._saveLogEl = null;
    this._ensureStyles();
    this._buildUI();
    void this.refreshList();

    // Refresh UI thumbnails/list when any model key changes via storage events (cross-tab and other code paths)
    try {
      this._onStorage = (ev) => {
        try {
          const key = (ev && (ev.key ?? (ev.detail && ev.detail.key))) || '';
          if (!key) return;
          if (key.startsWith(this._modelPrefix)) {
            // Invalidate cache for this model and refresh list
            try {
              const encName = key.slice(this._modelPrefix.length);
              const name = decodeURIComponent(encName);
              if (name) this._thumbCache.delete(name);
            } catch { }
            void this.refreshList();
          } else if (key === this._lastKey || key === '__BREP_FM_ICONSVIEW__') {
            // Preferences updated elsewhere; re-sync
            this.currentName = this._loadLastName() || this.currentName || '';
            this._iconsOnly = this._loadIconsPref();
            void this.refreshList();
          }
        } catch { /* ignore */ }
      };
      window.addEventListener('storage', this._onStorage);
    } catch { /* ignore */ }

    // Refresh list when storage backend switches (local ↔ GitHub)
    try {
      this._onBackendChange = () => {
        Promise.resolve(LS.ready()).then(() => {
          try {
            this.currentName = this._loadLastName() || this.currentName || '';
            this._iconsOnly = this._loadIconsPref();
            void this.refreshList();
          } catch { /* ignore */ }
        });
      };
      window.addEventListener(STORAGE_BACKEND_EVENT, this._onBackendChange);
    } catch { /* ignore */ }

    // Ensure storage hydration completes, then re-sync prefs/list and auto-load last
    try {
      Promise.resolve(LS.ready()).then(() => {
        try {
          this.currentName = this._loadLastName() || this.currentName || '';
          this._iconsOnly = this._loadIconsPref();
        void this.refreshList();
          this.autoLoadLast();
        } catch { alert('Failed to initialize File Manager storage.'); }
      });
    } catch { alert('Failed to initialize File Manager storage.'); }
  }


  async autoLoadLast() {
    if (await confirm('Load the last opened model?', 5)) {
      try {
        const last = this._loadLastName();
        if (last) {
          const exists = this._getModel(last);
          if (exists) {
            // Fire and forget; constructor cannot be async
            this.loadModel(last);
          }
        }
      } catch { /* ignore auto-load failures */ }
    }

  }



  // ----- Storage helpers -----
  // List all saved model records from per-model keys
  async _listModels() {
    const records = await listComponentRecords();
    return records.map(({ name, savedAt, record }) => ({
      name,
      savedAt,
      data: record?.data,
      data3mf: record?.data3mf,
      thumbnail: record?.thumbnail,
    }));
  }
  // Fetch one model record
  async _getModel(name, options) {
    return await getComponentRecord(name, options);
  }
  // Persist one model record
  async _setModel(name, dataObj) {
    await setComponentRecord(name, dataObj);
  }
  // Remove one model record
  async _removeModel(name) {
    await removeComponentRecord(name);
  }
  _saveLastName(name) {
    if (name) LS.setItem(this._lastKey, name);
  }
  _loadLastName() {
    return LS.getItem(this._lastKey) || '';
  }
  _saveIconsPref(v) {
    try { LS.setItem('__BREP_FM_ICONSVIEW__', v ? '1' : '0'); } catch { }
  }
  _loadIconsPref() {
    try { return LS.getItem('__BREP_FM_ICONSVIEW__') === '1'; } catch { return false; }
  }



  // ----- UI -----
  _ensureStyles() {
    if (document.getElementById('file-manager-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'file-manager-widget-styles';
    style.textContent = `
      /* Layout */
      .fm-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-bottom: 1px solid #1f2937; background: transparent; transition: background-color .12s ease; }
      .fm-row:hover { background: #0f172a; }
      .fm-row.header { background: #111827; border-bottom: 1px solid #1f2937; padding-bottom: 8px; margin-bottom: 4px; }
      .fm-row:last-child { border-bottom: 0; }
      .fm-grow { flex: 1 1 auto; overflow: hidden; }
      .fm-thumb { flex: 0 0 auto; width: 60px; height: 60px; border-radius: 6px; border: 1px solid #1f2937; background: #0b0e14; object-fit: contain; image-rendering: auto; }

      /* Inputs (keep text size and padding) */
      .fm-input { width: 100%; box-sizing: border-box; padding: 6px 8px; background: #0b0e14; color: #e5e7eb; border: 1px solid #374151; border-radius: 8px; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
      .fm-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

      /* Buttons (keep text size and padding) */
      .fm-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 2px 6px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; min-width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; transition: border-color .15s ease, background-color .15s ease, transform .05s ease; }
      .fm-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .fm-btn:active { transform: translateY(1px); }
      .fm-btn.danger { border-color: #7f1d1d; color: #fecaca; }
      .fm-btn.danger:hover { border-color: #ef4444; background: rgba(239,68,68,.15); color: #fff; }

      /* List + text (keep sizes) */
      .fm-list { padding: 4px 0; }
      .fm-left { display: flex; flex-direction: column; min-width: 0; }
      .fm-name { font-weight: 600; color: #e5e7eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
      .fm-date { font-size: 11px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }

      /* Icons view */
      .fm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; padding: 6px; }
      .fm-item { position: relative; display: flex; align-items: center; justify-content: center; padding: 8px; border: 1px solid #1f2937; border-radius: 8px; background: transparent; transition: background-color .12s ease, border-color .12s ease; }
      .fm-item:hover { background: #0f172a; border-color: #334155; }
      .fm-item .fm-thumb { width: 60px; height: 60px; border: 1px solid #1f2937; background: #0b0e14; border-radius: 6px; }
      .fm-item .fm-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; line-height: 1; }

      /* Blocking save overlay */
      .fm-save-overlay { position: fixed; inset: 0; background: rgba(2,6,23,0.65); display: flex; align-items: center; justify-content: center; z-index: 10050; }
      .fm-save-panel { width: min(520px, 90vw); max-height: 80vh; background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 12px; padding: 16px 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
      .fm-save-title { font-weight: 700; font-size: 14px; letter-spacing: .01em; margin-bottom: 10px; }
      .fm-save-log { font-size: 12px; line-height: 1.4; max-height: 52vh; overflow: auto; white-space: pre-wrap; color: #cbd5f5; background: #0a0f1a; border: 1px solid #1f2937; border-radius: 8px; padding: 10px; }
      .fm-save-line { margin-bottom: 6px; }
    `;
    document.head.appendChild(style);
  }

  _setSaveBusy(isBusy) {
    try {
      if (this.saveBtn) this.saveBtn.disabled = !!isBusy;
      if (this.nameInput) this.nameInput.disabled = !!isBusy;
    } catch { /* ignore */ }
  }

  _startSaveProgress(title) {
    try {
      this._endSaveProgress();
      const overlay = document.createElement('div');
      overlay.className = 'fm-save-overlay';
      const panel = document.createElement('div');
      panel.className = 'fm-save-panel';
      const header = document.createElement('div');
      header.className = 'fm-save-title';
      header.textContent = title || 'Saving...';
      const log = document.createElement('div');
      log.className = 'fm-save-log';
      panel.appendChild(header);
      panel.appendChild(log);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      this._saveOverlay = overlay;
      this._saveLogEl = log;
    } catch { /* ignore */ }
  }

  _logSaveProgress(message) {
    try {
      if (!this._saveLogEl) return;
      const line = document.createElement('div');
      line.className = 'fm-save-line';
      line.textContent = message || '';
      this._saveLogEl.appendChild(line);
      this._saveLogEl.scrollTop = this._saveLogEl.scrollHeight;
    } catch { /* ignore */ }
  }

  _endSaveProgress() {
    try {
      if (this._saveOverlay && this._saveOverlay.parentNode) {
        this._saveOverlay.parentNode.removeChild(this._saveOverlay);
      }
    } catch { /* ignore */ }
    this._saveOverlay = null;
    this._saveLogEl = null;
  }

  _buildUI() {
    // Header: name input + Save
    const header = document.createElement('div');
    header.className = 'fm-row header';

    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Model name';
    this.nameInput.value = this.currentName;
    this.nameInput.className = 'fm-input fm-grow';
    header.appendChild(this.nameInput);

    // View toggle: list ↔ icons-only
    this.viewToggleBtn = document.createElement('button');
    this.viewToggleBtn.className = 'fm-btn';
    this.viewToggleBtn.addEventListener('click', () => this.toggleViewMode());
    header.appendChild(this.viewToggleBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'fm-btn';
    saveBtn.addEventListener('click', () => this.saveCurrent());
    this.saveBtn = saveBtn;
    header.appendChild(saveBtn);
    this.uiElement.appendChild(header);

    // List container
    this.listEl = document.createElement('div');
    this.listEl.className = 'fm-list';
    this.uiElement.appendChild(this.listEl);

    this._updateViewToggleUI();
  }

  // ----- Actions -----
  async newModel() {
    if (!this.viewer || !this.viewer.partHistory) return;
    const proceed = await confirm('Clear current model and start a new one?');
    if (!proceed) return;
    await this.viewer.partHistory.reset();
    this.viewer.partHistory.currentHistoryStepId = null;
    await this.viewer.partHistory.runHistory();
    this.currentName = '';
    this.nameInput.value = '';
    this._refreshHistoryCollections('new-model');
  }

  async _retryGithubOperation(action, op, progress) {
    while (true) {
      try {
        const value = await op();
        return { ok: true, value };
      } catch (err) {
        const msg = (err && typeof err.message === 'string' && err.message.trim())
          ? err.message.trim()
          : (err ? String(err) : '');
        const details = msg ? `\n\n${msg}` : '';
        try { if (typeof progress === 'function') progress(`${action} failed.${details}`); } catch { }
        const retry = await window.confirm(`${action} failed.${details}\n\nRetry?`);
        try { if (typeof progress === 'function') progress(retry ? 'Retrying...' : 'Save canceled by user.'); } catch { }
        if (!retry) return { ok: false, error: err };
      }
    }
  }

  async saveCurrent() {
    if (!this.viewer || !this.viewer.partHistory) return;
    let name = (this.nameInput.value || '').trim();
    if (!name) {
      name = await prompt('Enter a name for this model:') || '';
      name = name.trim();
      if (!name) return;
      this.nameInput.value = name;
    }

    try { console.log('[FileManagerWidget] saveCurrent: begin', { name }); } catch { }
    this._setSaveBusy(true);
    this._startSaveProgress(`Saving "${name}"...`);
    try {
      this._logSaveProgress('Preparing feature history...');
      // Get feature history JSON (now includes PMI views) and embed into a 3MF archive as Metadata/featureHistory.json
      const jsonString = await this.viewer.partHistory.toJSON();
      try { console.log('[FileManagerWidget] saveCurrent: feature history', { bytes: jsonString ? jsonString.length : 0 }); } catch { }
      let additionalFiles = {};
      let modelMetadata = undefined;
      if (jsonString) {
        additionalFiles['Metadata/featureHistory.json'] = jsonString;
        modelMetadata = { featureHistoryPath: '/Metadata/featureHistory.json' };
      }
      // Embed PMI view images under /views
      try {
        this._logSaveProgress('Capturing PMI view images...');
        const viewFiles = await this.viewer?.pmiViewsWidget?.captureViewImagesForPackage?.();
        if (viewFiles && typeof viewFiles === 'object') {
          additionalFiles = { ...(additionalFiles || {}), ...viewFiles };
        }
      } catch (err) {
        console.error('Failed to embed PMI view images:', err);
      }
      // Capture a 60x60 thumbnail of the current view
      let thumbnail = null;
      try {
        this._logSaveProgress('Capturing thumbnail...');
        thumbnail = await this._captureThumbnail(60);
      } catch { /* ignore thumbnail failures */ }

      // Collect solids for full 3MF export (so slicers can open it).
      this._logSaveProgress('Collecting solids...');
      const solids = this._collectSolidsForExport();
      try { console.log('[FileManagerWidget] saveCurrent: collected solids', { count: solids.length, names: solids.map(s => s?.name).filter(Boolean) }); } catch { }
      const solidsForExport = [];
      const skipped = [];
      solids.forEach((s, idx) => {
        try {
          const mesh = s?.getMesh?.();
          if (mesh && mesh.vertProperties && mesh.triVerts) {
            solidsForExport.push(s);
          } else {
            skipped.push(s?.name || `solid_${idx}`);
          }
        } catch {
          skipped.push(s?.name || `solid_${idx}`);
        }
      });
      try { console.log('[FileManagerWidget] saveCurrent: solids for export', { count: solidsForExport.length, skipped }); } catch { }

      // Attach BREP-specific metadata for mesh-based restores (face names, colors, centerlines).
      try {
        this._logSaveProgress('Packaging BREP metadata...');
        const extras = this._buildBrepExtras(solidsForExport);
        try { console.log('[FileManagerWidget] saveCurrent: brepExtras', { hasExtras: !!extras, solidCount: extras?.solids ? Object.keys(extras.solids).length : 0 }); } catch { }
        if (extras) {
          additionalFiles = additionalFiles || {};
          additionalFiles['Metadata/brepExtras.json'] = JSON.stringify(extras);
        }
      } catch (err) {
        console.warn('[FileManagerWidget] Failed to embed BREP extras:', err);
      }

      let threeMfBytes;
      try {
        this._logSaveProgress('Exporting 3MF...');
        const metadataManager = this.viewer?.partHistory?.metadataManager || null;
        const defaultFaceColor = (() => {
          try {
            const color = CADmaterials?.FACE?.BASE?.color;
            if (color && typeof color.getHexString === 'function') {
              return `#${color.getHexString()}`;
            }
            if (typeof color === 'string') return color;
          } catch { }
          return null;
        })();
        threeMfBytes = await generate3MF(solidsForExport, {
          unit: 'millimeter',
          precision: 6,
          scale: 1,
          additionalFiles,
          modelMetadata,
          thumbnail,
          metadataManager,
          defaultFaceColor,
          includeFaceTags: false,
        });
        try { console.log('[FileManagerWidget] saveCurrent: 3MF exported', { bytes: threeMfBytes?.length || 0 }); } catch { }
        try {
          const zip = await JSZip.loadAsync(threeMfBytes);
          const files = {};
          Object.keys(zip.files || {}).forEach(p => { files[p.toLowerCase()] = p; });
          const modelPath = files['3d/3dmodel.model'] || files['/3d/3dmodel.model'];
          const modelFile = modelPath ? zip.file(modelPath) : null;
          if (modelFile) {
            const xml = await modelFile.async('string');
            const triCount = (xml.match(/<triangle\b/gi) || []).length;
            const objCount = (xml.match(/<object\b/gi) || []).length;
            console.log('[FileManagerWidget] saveCurrent: 3MF model stats', { objects: objCount, triangles: triCount });
          } else {
            console.warn('[FileManagerWidget] saveCurrent: 3MF model file not found in zip');
          }
        } catch (err) {
          try { console.warn('[FileManagerWidget] saveCurrent: 3MF model stats failed', err?.message || err); } catch { }
        }
      } catch (e) {
        // Fallback: history only 3MF
        const metadataManager = this.viewer?.partHistory?.metadataManager || null;
        const defaultFaceColor = (() => {
          try {
            const color = CADmaterials?.FACE?.BASE?.color;
            if (color && typeof color.getHexString === 'function') {
              return `#${color.getHexString()}`;
            }
            if (typeof color === 'string') return color;
          } catch { }
          return null;
        })();
        threeMfBytes = await generate3MF([], {
          unit: 'millimeter',
          precision: 6,
          scale: 1,
          additionalFiles,
          modelMetadata,
          thumbnail,
          metadataManager,
          defaultFaceColor,
          includeFaceTags: false,
        });
        console.warn('[FileManagerWidget] 3MF export failed for solids, saved history-only 3MF.', e);
        try { console.log('[FileManagerWidget] saveCurrent: 3MF exported (history only)', { bytes: threeMfBytes?.length || 0 }); } catch { }
        try {
          const zip = await JSZip.loadAsync(threeMfBytes);
          const files = {};
          Object.keys(zip.files || {}).forEach(p => { files[p.toLowerCase()] = p; });
          const modelPath = files['3d/3dmodel.model'] || files['/3d/3dmodel.model'];
          const modelFile = modelPath ? zip.file(modelPath) : null;
          if (modelFile) {
            const xml = await modelFile.async('string');
            const triCount = (xml.match(/<triangle\b/gi) || []).length;
            const objCount = (xml.match(/<object\b/gi) || []).length;
            console.log('[FileManagerWidget] saveCurrent: 3MF model stats (history only)', { objects: objCount, triangles: triCount });
          } else {
            console.warn('[FileManagerWidget] saveCurrent: 3MF model file not found in zip (history only)');
          }
        } catch (err) {
          try { console.warn('[FileManagerWidget] saveCurrent: 3MF model stats failed (history only)', err?.message || err); } catch { }
        }
      }
      const threeMfB64 = uint8ArrayToBase64(threeMfBytes);
      const now = new Date().toISOString();

      // Store only the 3MF (with embedded thumbnail) and timestamp
      const record = { savedAt: now, data3mf: threeMfB64 };
      if (thumbnail) record.thumbnail = thumbnail;
      if (LS?.isGithub?.()) {
        this._logSaveProgress('Saving to GitHub...');
        try { console.log('[FileManagerWidget] saveCurrent: saving to GitHub', { name }); } catch { }
        const res = await this._retryGithubOperation(
          `Save "${name}" to GitHub`,
          () => this._setModel(name, record),
          (msg) => this._logSaveProgress(msg)
        );
        if (!res.ok) {
          this._logSaveProgress('Save canceled.');
          return;
        }
        try {
          this._pendingGithubMeta.set(name, {
            savedAt: record.savedAt || null,
            thumbnail: record.thumbnail || null,
          });
        } catch { /* ignore */ }
      } else {
        this._logSaveProgress('Saving to local storage...');
        try { console.log('[FileManagerWidget] saveCurrent: saving locally', { name }); } catch { }
        await this._setModel(name, record);
      }
      // Update in-memory thumbnail cache so UI reflects the new preview immediately
      try { if (thumbnail) this._thumbCache.set(name, thumbnail); } catch { }
      this.currentName = name;
      this._saveLastName(name);
      this._logSaveProgress('Refreshing list...');
      await this.refreshList();
      this._logSaveProgress('Save complete.');
      try { console.log('[FileManagerWidget] saveCurrent: complete', { name }); } catch { }
      if (skipped.length) {
        try { console.warn('[FileManagerWidget] Skipped non-manifold solids:', skipped); } catch {}
      }
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err || 'Unknown error');
      this._logSaveProgress(`Save failed: ${msg}`);
      try { console.warn('[FileManagerWidget] saveCurrent: failed', { name, error: msg }); } catch { }
      throw err;
    } finally {
      this._endSaveProgress();
      this._setSaveBusy(false);
    }
  }

  _collectSolidsForExport() {
    const scene = this.viewer?.partHistory?.scene || this.viewer?.scene;
    if (!scene) return [];
    const solids = [];
    scene.traverse((o) => {
      if (!o || !o.visible) return;
      if (o.type === 'SOLID' && typeof o.toSTL === 'function') solids.push(o);
    });
    const selected = solids.filter(o => o.selected === true);
    return selected.length ? selected : solids;
  }

  _buildBrepExtras(solids) {
    if (!Array.isArray(solids) || solids.length === 0) return null;

    const cleanMeta = (value) => {
      if (value == null) return null;
      try {
        return JSON.parse(JSON.stringify(value, (key, v) => {
          if (typeof v === 'function') return undefined;
          if (v && v.isColor && typeof v.getHexString === 'function') {
            try { return `#${v.getHexString()}`; } catch { return v; }
          }
          return v;
        }));
      } catch {
        return null;
      }
    };

    const mapToObject = (map) => {
      if (!(map instanceof Map) || map.size === 0) return null;
      const out = {};
      for (const [key, val] of map.entries()) {
        if (key == null) continue;
        const cleaned = cleanMeta(val);
        if (cleaned != null) out[String(key)] = cleaned;
      }
      return Object.keys(out).length ? out : null;
    };

    const encodeTriIds = (triIds) => {
      if (!triIds || triIds.length === 0) return '';
      const u32 = triIds instanceof Uint32Array ? triIds : Uint32Array.from(triIds);
      const u8 = new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength);
      return uint8ArrayToBase64(u8);
    };

    const solidsOut = {};
    const metadataManager = this.viewer?.partHistory?.metadataManager;
    for (const solid of solids) {
      if (!solid || solid.type !== 'SOLID') continue;
      const name = String(solid.name || '').trim();
      if (!name) continue;

      const authorTriCount = Array.isArray(solid._triVerts) ? (solid._triVerts.length / 3) : 0;
      const authorTriIdCount = Array.isArray(solid._triIDs) ? solid._triIDs.length : 0;
      let triIds = solid._triIDs || [];
      let triCount = (Array.isArray(triIds) || triIds instanceof Uint32Array) ? triIds.length : 0;
      let triIdsOrdered = triIds;
      let mesh = null;
      let triMat = null;
      let meshTriCount = 0;
      let meshFaceIdCount = 0;
      try {
        if (typeof solid.getMesh === 'function') {
          mesh = solid.getMesh();
          if (mesh && mesh.faceID && mesh.faceID.length) {
            triIds = Array.from(mesh.faceID);
            triCount = triIds.length;
          }
          meshTriCount = (mesh?.triVerts && mesh.triVerts.length) ? (mesh.triVerts.length / 3) : 0;
          meshFaceIdCount = (mesh?.faceID && mesh.faceID.length) ? mesh.faceID.length : 0;
          try {
            triMat = computeTriangleMaterialIndices(solid, mesh, {
              metadataManager,
              includeFaceTags: false,
              useMetadataColors: true,
            });
          } catch { /* ignore material mapping */ }
        }
      } catch { /* ignore mesh failures */ }
      finally { try { mesh?.delete?.(); } catch { } }

      if (triMat && Array.isArray(triMat) && triMat.length === triCount && triCount > 0) {
        const buckets = new Map();
        let defaultBucket = null;
        for (let t = 0; t < triCount; t++) {
          const fid = triIds[t];
          const midx = triMat[t];
          if (midx == null || !Number.isFinite(midx)) {
            if (!defaultBucket) defaultBucket = [];
            defaultBucket.push(fid);
          } else {
            const key = Number(midx);
            let arr = buckets.get(key);
            if (!arr) { arr = []; buckets.set(key, arr); }
            arr.push(fid);
          }
        }
        if (buckets.size || (defaultBucket && defaultBucket.length)) {
          const ordered = [];
          const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
          for (const k of keys) {
            const arr = buckets.get(k);
            if (arr && arr.length) ordered.push(...arr);
          }
          if (defaultBucket && defaultBucket.length) ordered.push(...defaultBucket);
          triIdsOrdered = ordered;
          triCount = triIdsOrdered.length;
        }
      } else {
        triIdsOrdered = triIds;
        triCount = (Array.isArray(triIdsOrdered) || triIdsOrdered instanceof Uint32Array) ? triIdsOrdered.length : 0;
      }
      try {
        console.log('[FileManagerWidget] brepExtras: counts', {
          name,
          authorTriCount,
          authorTriIdCount,
          meshTriCount,
          meshFaceIdCount,
          triIdsCount: (Array.isArray(triIds) || triIds instanceof Uint32Array) ? triIds.length : 0,
          triIdsOrderedCount: (Array.isArray(triIdsOrdered) || triIdsOrdered instanceof Uint32Array) ? triIdsOrdered.length : 0,
          triMatCount: Array.isArray(triMat) ? triMat.length : 0,
        });
      } catch { }
      try {
        console.log('[FileManagerWidget] brepExtras: solid', {
          name,
          triCount,
          faceMapCount: idToFaceName ? Object.keys(idToFaceName).length : 0,
          faceMetaCount: faceMetadata ? Object.keys(faceMetadata).length : 0,
          edgeMetaCount: edgeMetadata ? Object.keys(edgeMetadata).length : 0,
          triFaceOrder: 'material',
        });
      } catch { }
      let idToFaceName = (solid._idToFaceName instanceof Map)
        ? Object.fromEntries(Array.from(solid._idToFaceName.entries()).map(([k, v]) => [String(k), String(v)]))
        : null;
      if (!idToFaceName && solid._faceNameToID instanceof Map) {
        const inverted = {};
        for (const [faceName, faceId] of solid._faceNameToID.entries()) {
          if (faceId == null || faceName == null) continue;
          inverted[String(faceId)] = String(faceName);
        }
        if (Object.keys(inverted).length) idToFaceName = inverted;
      }

      let faceMetadata = mapToObject(solid._faceMetadata);
      const edgeMetadata = mapToObject(solid._edgeMetadata);
      const solidUserMeta = cleanMeta(solid?.userData?.metadata || null);
      const solidManagerMeta = (metadataManager && typeof metadataManager.getMetadata === 'function')
        ? cleanMeta(metadataManager.getMetadata(name))
        : null;
      const solidMetadata = solidManagerMeta
        ? { ...(solidManagerMeta || {}), ...(solidUserMeta || {}) }
        : solidUserMeta;

      if (metadataManager && typeof metadataManager.getMetadata === 'function' && idToFaceName) {
        const mergedFaceMeta = faceMetadata || {};
        for (const faceName of Object.values(idToFaceName)) {
          if (!faceName) continue;
          const meta = cleanMeta(metadataManager.getMetadata(faceName));
          if (meta && typeof meta === 'object' && Object.keys(meta).length) {
            mergedFaceMeta[faceName] = { ...(meta || {}), ...(mergedFaceMeta[faceName] || {}) };
          }
        }
        faceMetadata = Object.keys(mergedFaceMeta).length ? mergedFaceMeta : faceMetadata;
      }

      let auxEdges = null;
      if (Array.isArray(solid._auxEdges) && solid._auxEdges.length) {
        auxEdges = solid._auxEdges.map((e) => {
          const pts = Array.isArray(e?.points)
            ? e.points
                .map((p) => (Array.isArray(p) && p.length === 3 ? [p[0], p[1], p[2]] : null))
                .filter(Boolean)
            : [];
          return {
            name: e?.name || '',
            points: pts,
            closedLoop: !!e?.closedLoop,
            polylineWorld: !!e?.polylineWorld,
            materialKey: e?.materialKey || undefined,
            centerline: !!e?.centerline,
            faceA: typeof e?.faceA === 'string' ? e.faceA : undefined,
            faceB: typeof e?.faceB === 'string' ? e.faceB : undefined,
          };
        }).filter((e) => Array.isArray(e.points) && e.points.length >= 2);
      }

      if (faceMetadata && Object.keys(faceMetadata).length === 0) faceMetadata = null;
      solidsOut[name] = {
        triCount,
        triFaceIdsB64: encodeTriIds(triIdsOrdered),
        triFaceOrder: 'material',
        idToFaceName,
        faceMetadata,
        edgeMetadata,
        auxEdges,
        solidMetadata,
      };
    }

    if (!Object.keys(solidsOut).length) return null;
    return { version: 1, solids: solidsOut };
  }

  async loadModel(name) {
    if (!this.viewer || !this.viewer.partHistory) return;
    const seq = ++this._loadSeq; // only the last call should win
    let rec = null;
    if (LS?.isGithub?.()) {
      const res = await this._retryGithubOperation(`Load "${name}" from GitHub`, () => this._getModel(name, { throwOnError: true }));
      if (!res.ok) return;
      rec = res.value;
    } else {
      rec = await this._getModel(name);
    }
    if (!rec) return alert('Model not found.');
    await this.viewer.partHistory.reset();
    // Prefer new 3MF-based storage
    if (rec.data3mf && typeof rec.data3mf === 'string') {
      try {
        let b64 = rec.data3mf;
        if (b64.startsWith('data:') && b64.includes(';base64,')) {
          b64 = b64.split(';base64,')[1];
        }
        const bytes = base64ToUint8Array(b64);
        // Try to extract feature history from 3MF
        const zip = await JSZip.loadAsync(bytes.buffer);
        const files = {};
        Object.keys(zip.files || {}).forEach(p => files[p.toLowerCase()] = p);
        let fhKey = files['metadata/featurehistory.json'];
        if (!fhKey) {
          for (const k of Object.keys(files)) { if (k.endsWith('featurehistory.json')) { fhKey = files[k]; break; } }
        }
        if (fhKey) {
          const jsonData = await zip.file(fhKey).async('string');
          let root = null;
          try { root = JSON.parse(jsonData); } catch { }
          // Ensure expressions is a string if present
          if (root && root.expressions != null && typeof root.expressions !== 'string') {
            try { root.expressions = String(root.expressions); } catch { root.expressions = String(root.expressions); }
          }
          if (root) {
            await this.viewer.partHistory.fromJSON(JSON.stringify(root));
            // Sync Expressions UI with imported code
            try { if (this.viewer?.expressionsManager?.textArea) this.viewer.expressionsManager.textArea.value = this.viewer.partHistory.expressions || ''; } catch { }

            // Refresh PMI views widget from PartHistory
            try {
              if (this.viewer?.pmiViewsWidget) {
                this.viewer.pmiViewsWidget.refreshFromHistory?.();
                this.viewer.pmiViewsWidget._renderList?.();
              }
            } catch { }

            if (seq !== this._loadSeq) return;
            this.currentName = name;
            this.nameInput.value = name;
            this._saveLastName(name);
            await this.viewer.partHistory.runHistory();
            this._refreshHistoryCollections('load-model');
            return;
          }
        }
        // No feature history found → fallback to import raw 3MF as mesh via Import3D feature
        try {
          const feat = await this.viewer?.partHistory?.newFeature?.('IMPORT3D');
          if (feat) {
            feat.inputParams.fileToImport = bytes.buffer; // Import3dModelFeature can auto-detect 3MF zip
            feat.inputParams.deflectionAngle = 15;
            feat.inputParams.centerMesh = true;
          }
          await this.viewer?.partHistory?.runHistory?.();
          this._refreshHistoryCollections('load-model');
          if (seq !== this._loadSeq) return;
          this.currentName = name;
          this.nameInput.value = name;
          this._saveLastName(name);
          return;
        } catch { }
      } catch (e) {
        console.warn('[FileManagerWidget] Failed to load 3MF from storage; falling back to JSON if present.', e);
      }
    }
    // JSON fallback path
    try {
      const payload = (typeof rec.data === 'string') ? rec.data : JSON.stringify(rec.data);
      await this.viewer.partHistory.fromJSON(payload);
      // Sync Expressions UI with imported code
      try { if (this.viewer?.expressionsManager?.textArea) this.viewer.expressionsManager.textArea.value = this.viewer.partHistory.expressions || ''; } catch { }
    } catch (e) {
      alert('Failed to load model (invalid data).');
      console.error(e);
      return;
    }
    if (seq !== this._loadSeq) return;
    this.currentName = name;
    this.nameInput.value = name;
    this._saveLastName(name);
    await this.viewer.partHistory.runHistory();
    this._refreshHistoryCollections('load-model');
  }

  async deleteModel(name) {
    const rec = await this._getModel(name);
    if (!rec) return;
    const proceed = confirm(`Delete model "${name}"? This cannot be undone.`);
    if (!proceed) return;
    await this._removeModel(name);
    if (this.currentName === name) {
      this.currentName = '';
      if (this.nameInput.value === name) this.nameInput.value = '';
    }
    await this.refreshList();
  }

  _refreshHistoryCollections(reason = 'manual') {
    const detail = { source: 'file-manager', reason };
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const evt = (typeof CustomEvent === 'function')
          ? new CustomEvent(HISTORY_COLLECTION_REFRESH_EVENT, { detail })
          : null;
        if (evt) window.dispatchEvent(evt);
        else window.dispatchEvent({ type: HISTORY_COLLECTION_REFRESH_EVENT, detail });
      }
    } catch { /* ignore */ }

    try { this.viewer?.historyWidget?.render?.(); } catch { }
    try { this.viewer?.assemblyConstraintsWidget?.render?.(); } catch { }
    try {
      if (this.viewer?.pmiViewsWidget) {
        this.viewer.pmiViewsWidget.refreshFromHistory?.();
        this.viewer.pmiViewsWidget._renderList?.();
      }
    } catch { /* ignore */ }
  }

  async refreshList() {
    const items = await this._listModels();
    if (LS?.isGithub?.() && this._pendingGithubMeta && this._pendingGithubMeta.size) {
      for (const it of items) {
        const pending = this._pendingGithubMeta.get(it.name);
        if (!pending) continue;
        const itemTime = it.savedAt ? Date.parse(it.savedAt) : NaN;
        const pendingTime = pending.savedAt ? Date.parse(pending.savedAt) : NaN;
        if (!Number.isFinite(itemTime) || (Number.isFinite(pendingTime) && pendingTime > itemTime)) {
          if (pending.savedAt) it.savedAt = pending.savedAt;
          if (it.record && pending.savedAt) it.record.savedAt = pending.savedAt;
          if (pending.thumbnail) {
            it.thumbnail = pending.thumbnail;
            if (it.record) it.record.thumbnail = pending.thumbnail;
            try { this._thumbCache.set(it.name, pending.thumbnail); } catch { }
          }
        } else {
          // Remote metadata caught up; drop the pending override.
          this._pendingGithubMeta.delete(it.name);
        }
      }
    }
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'fm-row';
      empty.textContent = 'No saved models yet.';
      this.listEl.appendChild(empty);
      return;
    }

    const sorted = items.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    if (this._iconsOnly) {
      this._renderIconsView(sorted);
      return;
    }

    for (const it of sorted) {
      const row = document.createElement('div');
      row.className = 'fm-row';

      const thumb = document.createElement('img');
      thumb.className = 'fm-thumb';
      thumb.alt = `${it.name} thumbnail`;
      this._applyThumbnailToImg(it, thumb);
      thumb.addEventListener('click', () => this.loadModel(it.name));
      row.appendChild(thumb);

      const left = document.createElement('div');
      left.className = 'fm-left fm-grow';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'fm-name';
      nameDiv.textContent = it.name;
      nameDiv.addEventListener('click', () => this.loadModel(it.name));
      left.appendChild(nameDiv);
      const dt = new Date(it.savedAt);
      const dateEl = document.createElement('div');
      dateEl.className = 'fm-date';
      dateEl.textContent = isNaN(dt) ? String(it.savedAt || '') : dt.toLocaleString();
      left.appendChild(dateEl);
      row.appendChild(left);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'fm-btn';
      openBtn.textContent = '📂';
      openBtn.addEventListener('click', () => this.loadModel(it.name));
      row.appendChild(openBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'fm-btn danger';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => this.deleteModel(it.name));
      row.appendChild(delBtn);

      this.listEl.appendChild(row);
    }
  }

  toggleViewMode() {
    this._iconsOnly = !this._iconsOnly;
    this._saveIconsPref(this._iconsOnly);
    this._updateViewToggleUI();
    void this.refreshList();
  }
  _updateViewToggleUI() {
    if (!this.viewToggleBtn) return;
    if (this._iconsOnly) {
      this.viewToggleBtn.textContent = '☰';
      this.viewToggleBtn.title = 'Switch to list view';
    } else {
      this.viewToggleBtn.textContent = '🔳';
      this.viewToggleBtn.title = 'Switch to icons view';
    }
  }

  _renderIconsView(items) {
    const grid = document.createElement('div');
    grid.className = 'fm-grid';
    this.listEl.appendChild(grid);

    for (const it of items) {
      const cell = document.createElement('div');
      cell.className = 'fm-item';
      const dt = new Date(it.savedAt);
      cell.title = `${it.name}\n${isNaN(dt) ? String(it.savedAt || '') : dt.toLocaleString()}`;
      cell.addEventListener('click', () => this.loadModel(it.name));

      const img = document.createElement('img');
      img.className = 'fm-thumb';
      img.alt = `${it.name} thumbnail`;
      this._applyThumbnailToImg(it, img);
      cell.appendChild(img);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fm-btn danger fm-del';
      del.textContent = '✕';
      del.title = `Delete ${it.name}`;
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.deleteModel(it.name);
      });
      cell.appendChild(del);

      grid.appendChild(cell);
    }
  }
  async _applyThumbnailToImg(rec, imgEl) {
    try {
      if (!imgEl) return;
      if (!rec?.data3mf) {
        try {
          const full = await this._getModel(rec?.name);
          if (full && full.data3mf) {
            rec = { ...rec, data3mf: full.data3mf, thumbnail: full.thumbnail };
          }
        } catch { /* ignore */ }
      }
      if (!rec?.data3mf) {
        imgEl.style.display = 'none';
        return;
      }
      imgEl.style.display = '';
      if (rec.thumbnail) {
        imgEl.src = rec.thumbnail;
        if (this._thumbCache) this._thumbCache.set(rec.name, rec.thumbnail);
        return;
      }
      if (this._thumbCache && this._thumbCache.has(rec.name)) {
        const cached = this._thumbCache.get(rec.name);
        if (cached) imgEl.src = cached;
        return;
      }
      const src = await extractThumbnailFrom3MFBase64(rec.data3mf);
      if (src) {
        imgEl.src = src;
        if (this._thumbCache) this._thumbCache.set(rec.name, src);
        this._persistThumbnail(rec.name, src);
      } else {
        imgEl.style.display = 'none';
      }
    } catch {
      if (imgEl) imgEl.style.display = 'none';
    }
  }

  async _persistThumbnail(name, thumbnail) {
    if (!name || !thumbnail) return;
    const existing = await getComponentRecord(name);
    if (!existing) return;
    const payload = {
      savedAt: existing.savedAt || new Date().toISOString(),
      data3mf: existing.data3mf,
      data: existing.data,
      thumbnail,
    };
    await setComponentRecord(name, payload);
  }

  async _captureThumbnail(size = 60) {
    try {
      const renderer = this.viewer?.renderer;
      const canvas = renderer?.domElement;
      const cam = this.viewer?.camera;
      const controls = this.viewer?.controls;
      if (!canvas || !cam) return null;

      // Temporarily reorient exactly like clicking the ViewCube corner (top-front-right)
      try {
        const dir = new THREE.Vector3(1, 1, 1); // matches TOP FRONT RIGHT corner
        if (this.viewer?.viewCube && typeof this.viewer.viewCube._reorientCamera === 'function') {
          this.viewer.viewCube._reorientCamera(dir, 'SAVE THUMBNAIL');
        } else {
          // Fallback: replicate ViewCube corner logic if widget unavailable
          const pivot = (controls && controls._gizmos && controls._gizmos.position)
            ? controls._gizmos.position.clone()
            : new THREE.Vector3(0, 0, 0);
          const dist = cam.position.distanceTo(pivot) || cam.position.length() || 10;
          const pos = pivot.clone().add(dir.clone().normalize().multiplyScalar(dist));
          const useZup = Math.abs(dir.y) > 0.9;
          const up = useZup ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
          cam.position.copy(pos);
          cam.up.copy(up);
          cam.lookAt(pivot);
          cam.updateMatrixWorld(true);
          if (controls?.updateMatrixState) { try { controls.updateMatrixState(); } catch { } }
        }
        // Fit geometry within this oriented view
        try { this.viewer.zoomToFit(1.1); } catch { }
      } catch { /* ignore orientation failures */ }

      // Ensure a fresh frame before capture
      try { this.viewer.render(); } catch { }

      // Wait one frame to be safe
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const srcW = canvas.width || canvas.clientWidth || 1;
      const srcH = canvas.height || canvas.clientHeight || 1;
      const dst = document.createElement('canvas');
      dst.width = size; dst.height = size;
      const ctx = dst.getContext('2d');
      if (!ctx) return null;
      // Leave background transparent so captures can be composited cleanly
      try { ctx.clearRect(0, 0, size, size); } catch { }
      // Compute contain fit
      const scale = Math.min(size / srcW, size / srcH);
      const dw = Math.max(1, Math.floor(srcW * scale));
      const dh = Math.max(1, Math.floor(srcH * scale));
      const dx = Math.floor((size - dw) / 2);
      const dy = Math.floor((size - dh) / 2);
      try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch { }
      ctx.drawImage(canvas, 0, 0, srcW, srcH, dx, dy, dw, dh);
      const dataUrl = dst.toDataURL('image/png');
      return dataUrl;
    } catch {
      return null;
    }
  }
}

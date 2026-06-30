import * as THREE from 'three';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';
import { FloatingWindow } from './FloatingWindow.js';

const DEFAULT_BG = 0x0b0d10;
const INFO_PLACEHOLDER = 'Select a triangle to see details.';
const AREA_FILTER_MODE_ALL = 'all';
const AREA_FILTER_MODE_HIDE_BELOW = 'hide-below';
const AREA_FILTER_MODE_HIDE_ABOVE = 'hide-above';

function ensureStyles() {
    if (document.getElementById('triangle-debugger-styles')) return;
    const style = document.createElement('style');
    style.id = 'triangle-debugger-styles';
    style.textContent = `
    .tri-debugger {
        height: 100%;
        width: 100%;
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 10px;
        padding: 6px;
        box-sizing: border-box;
        background: #0b0d10;
        color: #e5e7eb;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .tri-debugger__sidebar {
        background: #0f141a;
        border: 1px solid #1e2430;
        border-radius: 12px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.22);
        min-height: 0;
    }
    .tri-debugger__solid {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .tri-debugger__solid-name {
        font-weight: 700;
        letter-spacing: 0.2px;
        color: #e5e7eb;
    }
    .tri-debugger__solid-meta {
        color: #9aa4b2;
        font-size: 11px;
    }
    .tri-debugger__search {
        width: 100%;
        box-sizing: border-box;
        background: #0b0f14;
        border: 1px solid #1e2430;
        color: #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
    }
    .tri-debugger__list {
        flex: 1 1 auto;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 0;
    }
    .tri-debugger__row {
        width: 100%;
        border: 1px solid #1e2430;
        background: #121821;
        color: #e5e7eb;
        border-radius: 10px;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
        transition: border-color .12s ease, background .12s ease, transform .08s ease;
    }
    .tri-debugger__row:hover { border-color: #7aa2f7; background: #162033; transform: translateY(-1px); }
    .tri-debugger__row.is-selected { border-color: #7aa2f7; background: rgba(122,162,247,0.12); box-shadow: 0 4px 14px rgba(0,0,0,0.24); }
    .tri-debugger__row-title { font-weight: 700; display: flex; gap: 6px; align-items: center; }
    .tri-debugger__row-face { color: #9aa4b2; font-weight: 600; }
    .tri-debugger__row-meta { color: #9aa4b2; font-size: 11px; margin-top: 2px; }
    .tri-debugger__empty { color: #9aa4b2; font-style: italic; padding: 6px 2px; }
    .tri-debugger__filters {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .tri-debugger__filter-line {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        flex-wrap: wrap;
    }
    .tri-debugger__filter-line--area {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px;
        align-items: end;
        gap: 8px;
    }
    .tri-debugger__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        flex: 1 1 0;
    }
    .tri-debugger__field--compact {
        flex: 0 0 120px;
    }
    .tri-debugger__field-label {
        color: #9aa4b2;
        font-size: 11px;
    }
    .tri-debugger__toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #9aa4b2;
        font-size: 11px;
        user-select: none;
        min-height: 32px;
        white-space: nowrap;
        align-self: flex-start;
    }
    .tri-debugger__toggle input {
        accent-color: #7aa2f7;
    }
    .tri-debugger__control {
        width: 100%;
        box-sizing: border-box;
        background: #0b0f14;
        border: 1px solid #1e2430;
        color: #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
    }
    .tri-debugger__filter-summary {
        color: #9aa4b2;
        font-size: 11px;
        min-height: 16px;
    }

    .tri-debugger__main { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
    .tri-debugger__viewport {
        position: relative;
        flex: 1 1 auto;
        background: #0b0d10;
        border: 1px solid #1e2430;
        border-radius: 12px;
        overflow: hidden;
        min-height: 280px;
        box-shadow: 0 10px 32px rgba(0,0,0,0.28);
    }
    .tri-debugger__canvas-host {
        position: absolute;
        inset: 0;
    }
    .tri-debugger__status {
        position: absolute;
        top: 10px;
        left: 12px;
        padding: 6px 10px;
        background: rgba(15,20,26,0.9);
        border: 1px solid #1e2430;
        border-radius: 8px;
        color: #9aa4b2;
        z-index: 2;
        pointer-events: none;
    }
    .tri-debugger__info {
        background: #0f141a;
        border: 1px solid #1e2430;
        border-radius: 12px;
        padding: 10px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px 12px;
        box-sizing: border-box;
    }
    .tri-debugger__info h4 {
        margin: 0;
        font-size: 12px;
        color: #9aa4b2;
        letter-spacing: 0.3px;
    }
    .tri-debugger__info .value {
        font-weight: 700;
        color: #e5e7eb;
        margin-top: 2px;
        word-break: break-word;
    }
    .tri-debugger__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .tri-debugger__badge {
        border-radius: 8px;
        padding: 4px 6px;
        background: #162033;
        border: 1px solid #1e2430;
        font-size: 11px;
        color: #e5e7eb;
        cursor: pointer;
    }
    .tri-debugger__badge.is-selected {
        border-color: #7aa2f7;
        background: rgba(122,162,247,0.12);
    }
    @media (max-width: 1100px) {
        .tri-debugger { grid-template-columns: 280px 1fr; }
    }
    @media (max-width: 900px) {
        .tri-debugger { grid-template-columns: 1fr; grid-template-rows: 240px 1fr; }
        .tri-debugger__sidebar { min-height: 220px; }
    }
    @media (max-width: 420px) {
        .tri-debugger__filter-line--area {
            grid-template-columns: 1fr;
        }
        .tri-debugger__field--compact {
            flex-basis: auto;
        }
    }
    `;
    document.head.appendChild(style);
}

type AnyRecord = Record<string, any>;

const round = (n: any) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    if (Math.abs(v) < 1e-12) return 0;
    return Number(v.toFixed(6));
};

export class TriangleDebuggerWindow {
    [key: string]: any;

    constructor({ viewer }: AnyRecord = {}) {
        this.viewer = viewer || null;
        this.window = null;
        this.root = null;
        this.content = null;
        this.listEl = null;
        this.infoEl = null;
        this.canvasHost = null;
        this.statusEl = null;
        this.filterInput = null;
        this.areaThresholdInput = null;
        this.areaModeSelect = null;
        this.filterSummaryEl = null;
        this.solidNameEl = null;
        this.solidMetaEl = null;

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.controls = null;

        this.baseMesh = null;
        this.edgeLines = null;
        this.highlightMesh = null;
        this.adjacentMesh = null;

        this.triangles = [];
        this._listButtons = new Map();
        this._filterText = '';
        this._filterHighValence = false;
        this._areaThreshold = null;
        this._areaFilterMode = AREA_FILTER_MODE_ALL;
        this._selectedIndex = null;
        this._visibleTriangleIndices = [];
        this._visibleTriangleSet = new Set();
        this._resizeObserver = null;
        this._raf = null;
        this._currentTarget = null;
        this._orthoSize = 4;
        this._raycaster = new THREE.Raycaster();
        this._pointer = new THREE.Vector2();
        this._pointerGesture = { active: false, pointerId: null, button: null, startX: 0, startY: 0, moved: false };
        this._onCanvasPointerDown = (ev) => this._handleCanvasPointerDown(ev);
        this._onWindowPointerMove = (ev) => this._handleCanvasPointerMove(ev);
        this._onWindowPointerUp = (ev) => this._handleCanvasPointerUp(ev);
        this._onWindowPointerCancel = (ev) => this._handleCanvasPointerCancel(ev);
        this._onWindowResize = () => this._onResize();
        this._onInfoClick = (ev) => this._handleInfoClick(ev);
        this._selectedEdgeKey = null;
    }

    isOpen() {
        return !!(this.root && this.root.style.display !== 'none');
    }

    close() {
        if (this.root) this.root.style.display = 'none';
        this._stopRenderLoop();
    }

    openFor(target) {
        this._currentTarget = target || null;
        this._ensureWindow();
        this._startRenderLoop();
        if (this.root) this.root.style.display = 'flex';
        this._bringToFront();
        const solid = this._extractSolid(target);
        if (!solid) {
            this._setStatus('Select a Solid to debug.');
            this._clearGeometry();
            return;
        }
        this._setStatus('');
        this._loadSolid(solid);
    }

    refreshTarget(target) {
        this._currentTarget = target || null;
        if (!this.isOpen()) return;
        this.openFor(target);
    }

    _bringToFront() {
        try { this.window?.bringToFront?.(); } catch { /* ignore */ }
    }

    _ensureWindow() {
        if (this.root) return;
        ensureStyles();
        const fw = new FloatingWindow({
            title: 'Triangle Debugger',
            width: 1120,
            height: 740,
            right: 12,
            top: 40,
            shaded: false,
            onClose: () => this.close(),
        });

        const btnFit = document.createElement('button');
        btnFit.className = 'fw-btn';
        btnFit.textContent = 'Fit view';
        btnFit.addEventListener('click', () => this._fitCamera());
        fw.addHeaderAction(btnFit);

        const btnClear = document.createElement('button');
        btnClear.className = 'fw-btn';
        btnClear.textContent = 'Clear';
        btnClear.addEventListener('click', () => this._clearGeometry());
        fw.addHeaderAction(btnClear);

        const content = document.createElement('div');
        content.className = 'tri-debugger';
        content.style.width = '100%';
        content.style.height = '100%';
        fw.content.appendChild(content);

        const sidebar = document.createElement('div');
        sidebar.className = 'tri-debugger__sidebar';
        const solidBox = document.createElement('div');
        solidBox.className = 'tri-debugger__solid';
        this.solidNameEl = document.createElement('div');
        this.solidNameEl.className = 'tri-debugger__solid-name';
        this.solidNameEl.textContent = 'No solid selected';
        this.solidMetaEl = document.createElement('div');
        this.solidMetaEl.className = 'tri-debugger__solid-meta';
        this.solidMetaEl.textContent = '-';
        solidBox.append(this.solidNameEl, this.solidMetaEl);

        const filterControls = document.createElement('div');
        filterControls.className = 'tri-debugger__filters';
        const searchRow = document.createElement('div');
        searchRow.className = 'tri-debugger__filter-line';
        this.filterInput = document.createElement('input');
        this.filterInput.className = 'tri-debugger__search';
        this.filterInput.placeholder = 'Filter by face or triangle #';
        this.filterInput.addEventListener('input', () => {
            this._filterText = (this.filterInput.value || '').trim().toLowerCase();
            this._applyFilters();
        });
        searchRow.appendChild(this.filterInput);

        const areaRow = document.createElement('div');
        areaRow.className = 'tri-debugger__filter-line tri-debugger__filter-line--area';

        const areaModeField = document.createElement('label');
        areaModeField.className = 'tri-debugger__field';
        const areaModeLabel = document.createElement('span');
        areaModeLabel.className = 'tri-debugger__field-label';
        areaModeLabel.textContent = 'Area visibility';
        this.areaModeSelect = document.createElement('select');
        this.areaModeSelect.className = 'tri-debugger__control';
        for (const { value, label } of [
            { value: AREA_FILTER_MODE_ALL, label: 'Show all' },
            { value: AREA_FILTER_MODE_HIDE_BELOW, label: 'Hide below threshold' },
            { value: AREA_FILTER_MODE_HIDE_ABOVE, label: 'Hide above threshold' },
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.areaModeSelect.appendChild(option);
        }
        this.areaModeSelect.value = this._areaFilterMode;
        this.areaModeSelect.addEventListener('change', () => {
            this._areaFilterMode = this.areaModeSelect?.value || AREA_FILTER_MODE_ALL;
            this._applyFilters();
        });
        areaModeField.append(areaModeLabel, this.areaModeSelect);

        const areaThresholdField = document.createElement('label');
        areaThresholdField.className = 'tri-debugger__field tri-debugger__field--compact';
        const areaThresholdLabel = document.createElement('span');
        areaThresholdLabel.className = 'tri-debugger__field-label';
        areaThresholdLabel.textContent = 'Area threshold';
        this.areaThresholdInput = document.createElement('input');
        this.areaThresholdInput.type = 'number';
        this.areaThresholdInput.min = '0';
        this.areaThresholdInput.step = 'any';
        this.areaThresholdInput.className = 'tri-debugger__control';
        this.areaThresholdInput.placeholder = 'Disabled';
        this.areaThresholdInput.addEventListener('input', () => {
            const raw = String(this.areaThresholdInput?.value || '').trim();
            const next = raw ? Number(raw) : null;
            this._areaThreshold = Number.isFinite(next) ? Math.max(0, next) : null;
            this._applyFilters();
        });
        areaThresholdField.append(areaThresholdLabel, this.areaThresholdInput);

        const toggleWrap = document.createElement('label');
        toggleWrap.className = 'tri-debugger__toggle';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.addEventListener('change', () => {
            this._filterHighValence = !!toggle.checked;
            this._applyFilters();
        });
        const toggleText = document.createElement('span');
        toggleText.textContent = 'Only edges with >2 adjacents';
        toggleWrap.append(toggle, toggleText);
        areaRow.append(areaModeField, areaThresholdField);

        this.filterSummaryEl = document.createElement('div');
        this.filterSummaryEl.className = 'tri-debugger__filter-summary';
        this.filterSummaryEl.textContent = 'No triangles loaded.';

        this.listEl = document.createElement('div');
        this.listEl.className = 'tri-debugger__list';

        filterControls.append(searchRow, areaRow, toggleWrap, this.filterSummaryEl);
        sidebar.append(solidBox, filterControls, this.listEl);

        const main = document.createElement('div');
        main.className = 'tri-debugger__main';

        const viewport = document.createElement('div');
        viewport.className = 'tri-debugger__viewport';
        this.statusEl = document.createElement('div');
        this.statusEl.className = 'tri-debugger__status';
        this.statusEl.textContent = 'Select a Solid to debug.';

        this.canvasHost = document.createElement('div');
        this.canvasHost.className = 'tri-debugger__canvas-host';
        viewport.append(this.canvasHost, this.statusEl);

        this.infoEl = document.createElement('div');
        this.infoEl.className = 'tri-debugger__info';
        this.infoEl.innerHTML = '<div class="tri-debugger__empty">Select a triangle to see details.</div>';
        this.infoEl.addEventListener('click', this._onInfoClick);

        main.append(viewport, this.infoEl);
        content.append(sidebar, main);

        this.window = fw;
        this.root = fw.root;
        this.content = content;

        this._initThree();
        try { window.addEventListener('resize', this._onWindowResize, { passive: true }); } catch { /* ignore */ }
        this._startRenderLoop();
    }

    _initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(DEFAULT_BG);
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.75);
        dir1.position.set(3, 4, 3);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.45);
        dir2.position.set(-3, -2, 2);
        this.scene.add(ambient, dir1, dir2);

        this.camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.001, 10000);
        this.camera.position.set(6, 5, 6);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(100, 100, false);
        this.renderer.setClearColor(new THREE.Color(DEFAULT_BG), 1);
        if (this.canvasHost) this.canvasHost.appendChild(this.renderer.domElement);
        this.renderer.domElement.addEventListener('pointerdown', this._onCanvasPointerDown, { capture: true });
        try { window.addEventListener('pointermove', this._onWindowPointerMove, { capture: true, passive: true }); } catch { /* ignore */ }
        try { window.addEventListener('pointerup', this._onWindowPointerUp, { capture: true, passive: true }); } catch { /* ignore */ }
        try { window.addEventListener('pointercancel', this._onWindowPointerCancel, { capture: true, passive: true }); } catch { /* ignore */ }

        this.controls = new ArcballControls(this.camera, this.renderer.domElement, this.scene);
        try { this.controls.setGizmosVisible(false); } catch { /* ignore */ }
        this.controls.addEventListener('change', () => this._renderOnce());

        if (window.ResizeObserver && this.canvasHost) {
            this._resizeObserver = new ResizeObserver(() => this._onResize());
            this._resizeObserver.observe(this.canvasHost);
        }
        this._onResize();
    }

    _onResize() {
        if (!this.canvasHost || !this.renderer || !this.camera) return;
        const rect = this.canvasHost.getBoundingClientRect();
        const width = Math.max(50, rect.width || 0);
        const height = Math.max(50, rect.height || 0);
        this.renderer.setSize(width, height, false);
        this._applyOrthoFrustum(width / height);
        this._renderOnce();
    }

    _startRenderLoop() {
        if (this._raf) return;
        const loop = () => {
            this._raf = window.requestAnimationFrame(loop);
            if (this.controls) this.controls.update();
            this._renderOnce();
        };
        this._raf = window.requestAnimationFrame(loop);
    }

    _stopRenderLoop() {
        if (this._raf) window.cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    _renderOnce() {
        if (!this.renderer || !this.scene || !this.camera) return;
        try { this.renderer.render(this.scene, this.camera); } catch { /* ignore */ }
    }

    _applyOrthoFrustum(aspect = 1) {
        if (!this.camera || !(this.camera instanceof THREE.OrthographicCamera)) return;
        const size = Math.max(0.001, this._orthoSize || 4);
        const a = Math.max(0.001, aspect || 1);
        this.camera.left = -size * a;
        this.camera.right = size * a;
        this.camera.top = size;
        this.camera.bottom = -size;
        this.camera.updateProjectionMatrix();
    }

    _getDragThreshold() {
        const threshold = this.viewer && typeof this.viewer._dragThreshold === 'number' ? this.viewer._dragThreshold : 5;
        return Math.max(0, threshold || 0);
    }

    _resetPointerGesture() {
        this._pointerGesture.active = false;
        this._pointerGesture.pointerId = null;
        this._pointerGesture.button = null;
        this._pointerGesture.startX = 0;
        this._pointerGesture.startY = 0;
        this._pointerGesture.moved = false;
    }

    _handleCanvasPointerDown(ev) {
        if (!ev || ev.button !== 0) return;
        this._pointerGesture.active = true;
        this._pointerGesture.pointerId = ev.pointerId;
        this._pointerGesture.button = ev.button;
        this._pointerGesture.startX = ev.clientX;
        this._pointerGesture.startY = ev.clientY;
        this._pointerGesture.moved = false;
    }

    _handleCanvasPointerMove(ev) {
        const state = this._pointerGesture;
        if (!state.active || state.pointerId !== ev?.pointerId) return;
        if (state.moved) return;
        const dx = Math.abs(ev.clientX - state.startX);
        const dy = Math.abs(ev.clientY - state.startY);
        if ((dx + dy) > this._getDragThreshold()) state.moved = true;
    }

    _handleCanvasPointerUp(ev) {
        const state = this._pointerGesture;
        if (!state.active || state.pointerId !== ev?.pointerId) return;
        const dx = Math.abs(ev.clientX - state.startX);
        const dy = Math.abs(ev.clientY - state.startY);
        const moved = state.moved || (dx + dy) > this._getDragThreshold();
        const shouldPick = state.button === 0 && ev.button === 0 && !moved;
        this._resetPointerGesture();
        if (!shouldPick) return;
        this._pickTriangle(ev);
    }

    _handleCanvasPointerCancel(ev) {
        const state = this._pointerGesture;
        if (!state.active) return;
        if (ev && state.pointerId !== ev.pointerId) return;
        this._resetPointerGesture();
    }

    _pickTriangle(ev) {
        if (!this.baseMesh || !this.baseMesh.visible || !this.renderer || !this.camera) return;
        if (!this._visibleTriangleIndices.length) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        this._pointer.set(x, y);
        this._raycaster.setFromCamera(this._pointer, this.camera);
        const hits = this._raycaster.intersectObject(this.baseMesh, false);
        if (!hits.length) return;
        const idx = hits[0]?.faceIndex;
        if (!Number.isFinite(idx)) return;
        const triIdx = this._visibleTriangleIndices[idx | 0];
        if (!this.triangles[triIdx]) return;
        this._selectTriangle(triIdx);
    }

    _getAreaThresholdValue() {
        const value = Number(this._areaThreshold);
        if (!Number.isFinite(value)) return null;
        return Math.max(0, value);
    }

    _isTriangleAreaVisible(tri) {
        if (!tri) return false;
        const threshold = this._getAreaThresholdValue();
        if (this._areaFilterMode === AREA_FILTER_MODE_HIDE_BELOW && threshold !== null) {
            return Number(tri.area || 0) >= threshold;
        }
        if (this._areaFilterMode === AREA_FILTER_MODE_HIDE_ABOVE && threshold !== null) {
            return Number(tri.area || 0) <= threshold;
        }
        return true;
    }

    _matchesTriangleTextFilter(tri) {
        if (!tri) return false;
        const filter = this._filterText;
        if (!filter) return true;
        const label = `#${tri.index} ${tri.faceName || ''}`.toLowerCase();
        return label.includes(filter);
    }

    _isTriangleVisible(tri) {
        if (!tri) return false;
        if (!this._isTriangleAreaVisible(tri)) return false;
        if (!this._matchesTriangleTextFilter(tri)) return false;
        if (this._filterHighValence && !tri.hasCrowdedEdge) return false;
        return true;
    }

    _filterVisibleTriangleIndices(indices) {
        if (!Array.isArray(indices) || !indices.length) return [];
        const out = [];
        for (const idx of indices) {
            if (this._visibleTriangleSet.has(idx)) out.push(idx);
        }
        return out;
    }

    _setInfoPlaceholder(message = INFO_PLACEHOLDER) {
        if (!this.infoEl) return;
        this.infoEl.innerHTML = `<div class="tri-debugger__empty">${message}</div>`;
    }

    _updateFilterSummary(visibleCount) {
        if (!this.filterSummaryEl) return;
        const total = this.triangles.length || 0;
        if (!total) {
            this.filterSummaryEl.textContent = 'No triangles loaded.';
            return;
        }
        const parts = [`Visible ${visibleCount}/${total}`];
        const threshold = this._getAreaThresholdValue();
        if (this._areaFilterMode === AREA_FILTER_MODE_HIDE_BELOW && threshold !== null) {
            parts.push(`hide < ${round(threshold)}`);
        } else if (this._areaFilterMode === AREA_FILTER_MODE_HIDE_ABOVE && threshold !== null) {
            parts.push(`hide > ${round(threshold)}`);
        }
        if (this._filterHighValence) parts.push('crowded only');
        if (this._filterText) parts.push(`search "${this._filterText}"`);
        this.filterSummaryEl.textContent = parts.join(' • ');
    }

    _rebuildEdgeLinesGeometry() {
        if (!this.edgeLines || !this.baseMesh?.geometry) return;
        const oldGeometry = this.edgeLines.geometry;
        let nextGeometry = null;
        try { nextGeometry = new THREE.WireframeGeometry(this.baseMesh.geometry); } catch { /* ignore */ }
        if (nextGeometry) {
            this.edgeLines.geometry = nextGeometry;
            this.edgeLines.visible = this._visibleTriangleIndices.length > 0;
        } else {
            this.edgeLines.visible = false;
        }
        if (oldGeometry && oldGeometry !== nextGeometry) {
            try { oldGeometry.dispose(); } catch { /* ignore */ }
        }
    }

    _rebuildVisibleGeometry() {
        const mesh = this.baseMesh;
        if (!mesh || !this.triangles.length) {
            this._visibleTriangleIndices = [];
            this._visibleTriangleSet = new Set();
            if (mesh) mesh.visible = false;
            if (this.edgeLines) this.edgeLines.visible = false;
            return 0;
        }
        const visible = [];
        for (const tri of this.triangles) {
            if (this._isTriangleVisible(tri)) visible.push(tri.index);
        }
        this._visibleTriangleIndices = visible;
        this._visibleTriangleSet = new Set(visible);
        const nextGeometry = new THREE.BufferGeometry();
        if (visible.length) {
            const positions = new Float32Array(visible.length * 9);
            let w = 0;
            for (const triIndex of visible) {
                const tri = this.triangles[triIndex];
                if (!tri) continue;
                for (const p of [tri.p1, tri.p2, tri.p3]) {
                    positions[w++] = p[0];
                    positions[w++] = p[1];
                    positions[w++] = p[2];
                }
            }
            nextGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            nextGeometry.computeVertexNormals();
            nextGeometry.computeBoundingBox();
            nextGeometry.computeBoundingSphere();
        } else {
            nextGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
        }
        const oldGeometry = mesh.geometry;
        mesh.geometry = nextGeometry;
        mesh.visible = visible.length > 0;
        this._rebuildEdgeLinesGeometry();
        if (oldGeometry && oldGeometry !== nextGeometry) {
            try { oldGeometry.dispose(); } catch { /* ignore */ }
        }
        return visible.length;
    }

    _applyFilters() {
        const visibleCount = this._rebuildVisibleGeometry();
        this._populateList(visibleCount);
        if (!this.triangles.length) {
            this._selectedIndex = null;
            this._selectedEdgeKey = null;
            this._setInfoPlaceholder(INFO_PLACEHOLDER);
            this._highlightListSelection();
            this._renderOnce();
            return;
        }
        if (!visibleCount) {
            this._selectedIndex = null;
            this._selectedEdgeKey = null;
            if (this.highlightMesh) this.highlightMesh.visible = false;
            if (this.adjacentMesh) this.adjacentMesh.visible = false;
            this._setStatus('No triangles visible for the current filters.');
            this._setInfoPlaceholder('No triangles match the current filters.');
            this._highlightListSelection();
            this._renderOnce();
            return;
        }
        this._setStatus('');
        if (!this._visibleTriangleSet.has(this._selectedIndex)) {
            const nextIndex = this._visibleTriangleIndices[0];
            if (Number.isFinite(nextIndex)) {
                this._selectTriangle(nextIndex);
                return;
            }
        }
        const tri = this.triangles[this._selectedIndex];
        if (tri) {
            this._updateHighlight(tri);
            this._updateAdjacentHighlight(tri);
            this._renderInfo(tri);
        }
        this._highlightListSelection();
        this._renderOnce();
    }

    _setStatus(msg) {
        if (this.statusEl) this.statusEl.textContent = msg || '';
    }

    _extractSolid(target) {
        if (!target) return null;
        const isSolid = (obj) => obj && (String(obj.type || '').toUpperCase() === 'SOLID');
        if (isSolid(target)) return target;
        if (target.parentSolid && isSolid(target.parentSolid)) return target.parentSolid;
        if (target.userData && target.userData.parentSolid && isSolid(target.userData.parentSolid)) return target.userData.parentSolid;
        let cur = target.parent || null;
        while (cur) {
            if (isSolid(cur)) return cur;
            if (cur.parentSolid && isSolid(cur.parentSolid)) return cur.parentSolid;
            cur = cur.parent || null;
        }
        return null;
    }

    _clearGeometry(showPlaceholder = true) {
        if (this.baseMesh) {
            try { this.scene.remove(this.baseMesh); } catch { /* ignore */ }
            try { this.baseMesh.geometry?.dispose(); } catch { /* ignore */ }
            try {
                const mat = this.baseMesh.material;
                if (Array.isArray(mat)) mat.forEach(m => m?.dispose && m.dispose());
                else if (mat && typeof mat.dispose === 'function') mat.dispose();
            } catch { /* ignore */ }
        }
        if (this.edgeLines) {
            try { this.scene.remove(this.edgeLines); } catch { /* ignore */ }
            try { this.edgeLines.geometry?.dispose(); } catch { /* ignore */ }
            try { this.edgeLines.material?.dispose?.(); } catch { /* ignore */ }
        }
        this.baseMesh = null;
        this.edgeLines = null;
        this.triangles = [];
        this._listButtons.clear();
        this._selectedIndex = null;
        this._selectedEdgeKey = null;
        this._visibleTriangleIndices = [];
        this._visibleTriangleSet = new Set();
        this._resetPointerGesture();
        if (this.listEl) {
            this.listEl.innerHTML = '';
            if (showPlaceholder) {
                const empty = document.createElement('div');
                empty.className = 'tri-debugger__empty';
                empty.textContent = 'No triangles loaded.';
                this.listEl.appendChild(empty);
            }
        }
        if (showPlaceholder) this._setInfoPlaceholder(INFO_PLACEHOLDER);
        this._updateFilterSummary(0);
        if (this.highlightMesh) this.highlightMesh.visible = false;
        if (this.adjacentMesh) this.adjacentMesh.visible = false;
        this._renderOnce();
    }

    _loadSolid(solid) {
        if (!solid || typeof solid.getMesh !== 'function') {
            this._setStatus('Selected item is not a Solid.');
            this._clearGeometry();
            return;
        }
        this._filterText = '';
        if (this.filterInput) this.filterInput.value = '';
        this._clearGeometry(false);
        let mesh = null;
        try {
            mesh = solid.getMesh();
            const vp = mesh?.vertProperties || [];
            const tv = mesh?.triVerts || [];
            const faceIDs = (mesh?.faceID && mesh.faceID.length === (tv.length / 3)) ? mesh.faceID : null;
            const triCount = (tv.length / 3) | 0;
            const fallbackIDs = (!faceIDs && Array.isArray(solid._triIDs) && solid._triIDs.length === triCount) ? solid._triIDs : null;
            if (!triCount) {
                this._setStatus('Solid has no triangles.');
                this._clearGeometry();
                return;
            }

            const idToFace = new Map();
            try { if (solid._idToFaceName && solid._idToFaceName.forEach) solid._idToFaceName.forEach((name, id) => idToFace.set(id, name)); } catch { /* ignore */ }
            const faceNameFor = (id, idx) => {
                if (idToFace.has(id)) return idToFace.get(id);
                if (id !== undefined && id !== null) return `Face ${id}`;
                return `Face ${idx}`;
            };

            const positions = new Float32Array(triCount * 9);
            const triangles = new Array(triCount);
            const edgeToTris = new Map();
            const posEdgeToTris = new Map();
            let pw = 0;

            const edgeKeyFromPoints = (a, b) => {
                const pa = [round(a[0]), round(a[1]), round(a[2])];
                const pb = [round(b[0]), round(b[1]), round(b[2])];
                const sa = pa.join(',');
                const sb = pb.join(',');
                return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
            };

            for (let t = 0; t < triCount; t++) {
                const base = t * 3;
                const i0 = tv[base + 0] | 0;
                const i1 = tv[base + 1] | 0;
                const i2 = tv[base + 2] | 0;
                const p0 = [vp[i0 * 3 + 0], vp[i0 * 3 + 1], vp[i0 * 3 + 2]];
                const p1 = [vp[i1 * 3 + 0], vp[i1 * 3 + 1], vp[i1 * 3 + 2]];
                const p2 = [vp[i2 * 3 + 0], vp[i2 * 3 + 1], vp[i2 * 3 + 2]];
                const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
                const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
                const nx = uy * vz - uz * vy;
                const ny = uz * vx - ux * vz;
                const nz = ux * vy - uy * vx;
                const nlen = Math.hypot(nx, ny, nz) || 1;
                const area = 0.5 * nlen;
                const normal = [round(nx / nlen), round(ny / nlen), round(nz / nlen)];
                const centroid = [round((p0[0] + p1[0] + p2[0]) / 3), round((p0[1] + p1[1] + p2[1]) / 3), round((p0[2] + p1[2] + p2[2]) / 3)];
                const fid = faceIDs ? faceIDs[t] : (fallbackIDs ? fallbackIDs[t] : undefined);
                const faceName = faceNameFor(fid, t);

                triangles[t] = {
                    index: t,
                    faceName,
                    indices: [i0, i1, i2],
                    p1: p0, p2: p1, p3: p2,
                    normal,
                    area: round(area),
                    centroid,
                    adjacent: new Set(),
                    hasCrowdedEdge: false,
                    edgeAdjacencies: [],
                    _edgeDefs: [],
                };

                positions[pw++] = p0[0]; positions[pw++] = p0[1]; positions[pw++] = p0[2];
                positions[pw++] = p1[0]; positions[pw++] = p1[1]; positions[pw++] = p1[2];
                positions[pw++] = p2[0]; positions[pw++] = p2[1]; positions[pw++] = p2[2];

                const edges = [
                    { verts: [i0, i1], pts: [p0, p1] },
                    { verts: [i1, i2], pts: [p1, p2] },
                    { verts: [i2, i0], pts: [p2, p0] },
                ];
                for (const edge of edges) {
                    const [a0, b0] = edge.verts;
                    const a = Math.min(a0, b0);
                    const b = Math.max(a0, b0);
                    const key = `${a}|${b}`;
                    const posKey = edgeKeyFromPoints(edge.pts[0], edge.pts[1]);
                    let arr = edgeToTris.get(key);
                    if (!arr) { arr = []; edgeToTris.set(key, arr); }
                    arr.push(t);
                    let arrPos = posEdgeToTris.get(posKey);
                    if (!arrPos) { arrPos = []; posEdgeToTris.set(posKey, arrPos); }
                    arrPos.push(t);
                    triangles[t]._edgeDefs.push({ verts: [a0, b0], keyIndex: key, keyPos: posKey });
                }
            }

            const addAdjacencyFromMap = (map) => {
                for (const [, arr] of map.entries()) {
                    if (!arr || arr.length < 2) continue;
                    const isCrowded = arr.length > 2;
                    for (let i = 0; i < arr.length; i++) {
                        const ti = arr[i];
                        const tri = triangles[ti];
                        if (!tri) continue;
                        for (let j = 0; j < arr.length; j++) {
                            if (i === j) continue;
                            tri.adjacent.add(arr[j]);
                        }
                        if (isCrowded) tri.hasCrowdedEdge = true;
                    }
                }
            };

            addAdjacencyFromMap(edgeToTris);
            addAdjacencyFromMap(posEdgeToTris);

            // Build per-triangle edge adjacency detail (triangles that share each edge, index or position keyed)
            for (const tri of triangles) {
                const detailMap = new Map();
                for (const def of tri._edgeDefs) {
                    const { verts, keyIndex, keyPos } = def;
                    const addEntry = (key, neighborList) => {
                        if (!neighborList || neighborList.length < 2) return;
                        let entry = detailMap.get(key);
                        if (!entry) {
                            entry = { key, verts, neighbors: new Set(), crowded: neighborList.length > 2 };
                            detailMap.set(key, entry);
                        }
                        for (const n of neighborList) {
                            if (Number.isInteger(n) && n !== tri.index) entry.neighbors.add(n);
                        }
                        if (neighborList.length > 2) entry.crowded = true;
                    };
                    addEntry(keyIndex, edgeToTris.get(keyIndex));
                    addEntry(keyPos, posEdgeToTris.get(keyPos));
                }
                tri.edgeAdjacencies = Array.from(detailMap.values()).map(e => ({
                    key: e.key,
                    verts: e.verts,
                    neighbors: Array.from(e.neighbors),
                    crowded: !!e.crowded,
                }));
                tri._edgeDefs = null;
            }
            for (const tri of triangles) tri.adjacent = Array.from(tri.adjacent);

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geom.computeVertexNormals();
            geom.computeBoundingBox();
            geom.computeBoundingSphere();

            const mat = new THREE.MeshBasicMaterial({
                color: 0x2a3545,
                transparent: true,
                opacity: 0.16,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            this.baseMesh = new THREE.Mesh(geom, mat);
            this.baseMesh.renderOrder = 1;
            this.scene.add(this.baseMesh);

            try {
                const edgesGeom = new THREE.WireframeGeometry(geom);
                const edgesMat = new THREE.LineBasicMaterial({ color: 0x506784, transparent: true, opacity: 0.7 });
                this.edgeLines = new THREE.LineSegments(edgesGeom, edgesMat);
                this.edgeLines.renderOrder = 2;
                this.scene.add(this.edgeLines);
            } catch { /* ignore */ }

            if (!this.highlightMesh) {
                const hGeom = new THREE.BufferGeometry();
                hGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
                this.highlightMesh = new THREE.Mesh(hGeom, new THREE.MeshBasicMaterial({
                    color: 0xffc857,
                    transparent: true,
                    opacity: 0.9,
                    side: THREE.DoubleSide,
                    depthTest: false,
                    depthWrite: false,
                }));
                this.highlightMesh.renderOrder = 3;
                this.highlightMesh.visible = false;
                this.scene.add(this.highlightMesh);
            }
            if (!this.adjacentMesh) {
                this.adjacentMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
                    color: 0x4cc9f0,
                    transparent: true,
                    opacity: 0.35,
                    side: THREE.DoubleSide,
                    depthTest: false,
                    depthWrite: false,
                }));
                this.adjacentMesh.renderOrder = 2.5;
                this.adjacentMesh.visible = false;
                this.scene.add(this.adjacentMesh);
            }

            this.triangles = triangles;
            const faceCount = new Set(triangles.map(t => t.faceName)).size;
            if (this.solidNameEl) this.solidNameEl.textContent = solid.name || 'Solid';
            if (this.solidMetaEl) this.solidMetaEl.textContent = `${triCount} triangles | ${faceCount} faces`;

            this._applyFilters();
            this._fitCamera();
            this._renderOnce();
        } catch (e) {
            console.warn('[TriangleDebugger] Failed to load solid:', e);
            this._setStatus('Failed to build debug view.');
            this._clearGeometry();
        } finally {
            try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore */ }
        }
    }

    _populateList(visibleCount = this._visibleTriangleIndices.length) {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';
        this._listButtons.clear();
        const frag = document.createDocumentFragment();
        for (const tri of this.triangles) {
            if (!this._isTriangleVisible(tri)) continue;
            const btn = document.createElement('button');
            btn.className = 'tri-debugger__row';
            btn.dataset.index = String(tri.index);
            const adjCount = Array.isArray(tri.adjacent) ? tri.adjacent.length : 0;
            const adjText = `Adj ${adjCount}${tri.hasCrowdedEdge ? ' • crowd' : ''}`;
            btn.innerHTML = `<div class="tri-debugger__row-title">#${tri.index}<span class="tri-debugger__row-face">${tri.faceName || 'face'}</span></div>
                <div class="tri-debugger__row-meta">Area ${tri.area ?? 0} | Normal (${tri.normal.join(', ')}) | ${adjText}</div>`;
            btn.addEventListener('click', () => this._selectTriangle(tri.index));
            frag.appendChild(btn);
            this._listButtons.set(tri.index, btn);
        }
        if (visibleCount === 0) {
            const empty = document.createElement('div');
            empty.className = 'tri-debugger__empty';
            empty.textContent = this.triangles.length ? 'No triangles match this filter.' : 'No triangles.';
            this.listEl.appendChild(empty);
        } else {
            this.listEl.appendChild(frag);
        }
        this._updateFilterSummary(visibleCount);
        this._highlightListSelection();
    }

    _highlightListSelection() {
        for (const [idx, btn] of this._listButtons.entries()) {
            btn.classList.toggle('is-selected', idx === this._selectedIndex);
        }
    }

    _selectTriangle(index) {
        if (!this.triangles || !this.triangles.length) return;
        const tri = this.triangles[index];
        if (!tri || !this._visibleTriangleSet.has(index)) return;
        this._selectedIndex = index;
        this._selectedEdgeKey = null;
        this._highlightListSelection();
        this._updateHighlight(tri);
        this._updateAdjacentHighlight(tri);
        this._renderInfo(tri);
        this._renderOnce();
        // Scroll into view if needed
        const btn = this._listButtons.get(index);
        if (btn && typeof btn.scrollIntoView === 'function') {
            try { btn.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch { /* ignore */ }
        }
    }

    _updateHighlight(tri) {
        if (!this.highlightMesh) return;
        const g = this.highlightMesh.geometry;
        const attr = g.getAttribute('position');
        if (!attr || attr.count < 3) {
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
        }
        const pos = g.getAttribute('position');
        const pts = [tri.p1, tri.p2, tri.p3];
        let w = 0;
        for (const p of pts) {
            pos.array[w++] = p[0]; pos.array[w++] = p[1]; pos.array[w++] = p[2];
        }
        pos.needsUpdate = true;
        g.computeVertexNormals();
        this.highlightMesh.visible = true;
    }

    _updateAdjacentHighlight(tri) {
        if (!this.adjacentMesh) return;
        const adj = (tri.adjacent || []).map(i => this.triangles[i]).filter(Boolean);
        if (!adj.length) {
            this.adjacentMesh.visible = false;
            return;
        }
        const arr = new Float32Array(adj.length * 9);
        let w = 0;
        for (const t of adj) {
            arr[w++] = t.p1[0]; arr[w++] = t.p1[1]; arr[w++] = t.p1[2];
            arr[w++] = t.p2[0]; arr[w++] = t.p2[1]; arr[w++] = t.p2[2];
            arr[w++] = t.p3[0]; arr[w++] = t.p3[1]; arr[w++] = t.p3[2];
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        geom.computeVertexNormals();
        if (this.adjacentMesh.geometry) {
            try { this.adjacentMesh.geometry.dispose(); } catch { /* ignore */ }
        }
        this.adjacentMesh.geometry = geom;
        this.adjacentMesh.visible = true;
    }

    _renderInfo(tri) {
        if (!this.infoEl || !tri) return;
        const adjacent = Array.isArray(tri.adjacent) ? tri.adjacent : [];
        const adjBadges = adjacent.map((idx) => {
            const face = this.triangles[idx]?.faceName || 'face';
            const sel = idx === this._selectedIndex;
            return `<span class="tri-debugger__badge${sel ? ' is-selected' : ''}" data-adj-index="${idx}">#${idx} | ${face}</span>`;
        }).join('') || '<span class="tri-debugger__badge">None</span>';
        const edges = Array.isArray(tri.edgeAdjacencies) ? tri.edgeAdjacencies : [];
        const edgeBadges = edges.map((e) => {
            const sel = this._selectedEdgeKey === e.key;
            const count = e.neighbors?.length ?? 0;
            const tag = e.crowded ? ' • crowd' : '';
            return `<span class="tri-debugger__badge${sel ? ' is-selected' : ''}" data-edge-key="${e.key}">${e.verts[0]}-${e.verts[1]} | ${count} adj${tag}</span>`;
        }).join('') || '<span class="tri-debugger__badge">None</span>';
        const selEdge = edges.find(e => e.key === this._selectedEdgeKey) || null;
        const edgeNeighbors = selEdge ? (selEdge.neighbors || []) : [];
        const edgeNeighborBadges = edgeNeighbors.length
            ? edgeNeighbors.map(idx => {
                const face = this.triangles[idx]?.faceName || 'face';
                return `<span class="tri-debugger__badge" data-adj-index="${idx}">#${idx} | ${face}</span>`;
            }).join('')
            : '<span class="tri-debugger__badge">Select an edge</span>';
        this.infoEl.innerHTML = `
            <div>
                <h4>Triangle</h4>
                <div class="value">#${tri.index}</div>
            </div>
            <div>
                <h4>Face</h4>
                <div class="value">${tri.faceName || '-'}</div>
            </div>
            <div>
                <h4>Indices</h4>
                <div class="value">${tri.indices.join(', ')}</div>
            </div>
            <div>
                <h4>Area</h4>
                <div class="value">${tri.area}</div>
            </div>
            <div>
                <h4>Normal</h4>
                <div class="value">(${tri.normal.join(', ')})</div>
            </div>
            <div>
                <h4>Centroid</h4>
                <div class="value">(${tri.centroid.join(', ')})</div>
            </div>
            <div style="grid-column: 1 / -1;">
                <h4>Adjacent triangles</h4>
                <div class="tri-debugger__badges">${adjBadges}</div>
            </div>
            <div>
                <h4>Edges</h4>
                <div class="tri-debugger__badges">${edgeBadges}</div>
            </div>
            <div>
                <h4>Edge neighbors</h4>
                <div class="tri-debugger__badges">${edgeNeighborBadges}</div>
            </div>
        `;
    }

    _fitCamera(geom = null) {
        if (!this.camera || !this.controls) return;
        if (!geom && !this._visibleTriangleIndices.length) return;
        const g = geom || this.baseMesh?.geometry;
        if (!g) return;
        try { if (!g.boundingSphere) g.computeBoundingSphere(); } catch { /* ignore */ }
        const sphere = g.boundingSphere;
        if (!sphere) return;
        const { center, radius } = sphere;
        const safeRadius = Math.max(0.001, radius);
        const aspect = (() => {
            const rect = this.renderer?.domElement?.getBoundingClientRect();
            return rect && rect.height > 0 ? (rect.width / rect.height) : 1;
        })();
        const size = safeRadius * 1.6;
        this._orthoSize = Math.max(size, 0.001);
        this._applyOrthoFrustum(aspect);

        const dir = new THREE.Vector3(1, 0.8, 1).normalize();
        const dist = safeRadius * 4;
        const pos = dir.multiplyScalar(dist).add(center);
        this.camera.position.copy(pos);
        this.controls.target.copy(center);
        this.camera.near = Math.max(0.001, dist - safeRadius * 6);
        this.camera.far = dist + safeRadius * 6;
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this._renderOnce();
    }

    _handleInfoClick(ev) {
        const target = ev.target;
        if (!target) return;
        const edge = target.closest && target.closest('[data-edge-key]');
        if (edge) {
            const key = edge.dataset.edgeKey || null;
            this._selectedEdgeKey = key;
            const tri = this.triangles[this._selectedIndex];
            if (tri) this._renderInfo(tri);
            return;
        }
        const badge = target.closest && target.closest('[data-adj-index]');
        if (!badge) return;
        const idx = Number(badge.dataset.adjIndex);
        if (!Number.isFinite(idx)) return;
        if (!this.triangles[idx]) return;
        ev.preventDefault();
        ev.stopPropagation();
        this._selectTriangle(idx);
    }
}

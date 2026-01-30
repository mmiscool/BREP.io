"use strict";

import { SelectionFilter } from './SelectionFilter.js';
import * as THREE from 'three';
import { Line2, LineGeometry, LineMaterial } from 'three/examples/jsm/Addons.js';
// Use hybrid translate+rotate gizmo used by the Viewer
import { CombinedTransformControls } from './controls/CombinedTransformControls.js';
import { getWidgetRenderer } from './featureDialogWidgets/index.js';
import { normalizeReferenceList, normalizeReferenceName } from './featureDialogWidgets/utils.js';
const REF_PREVIEW_COLORS = {
    EDGE: '#ff00ff',
    FACE: '#ffc400',
    PLANE: '#2eff2e',
    VERTEX: '#00ffff',
};






////////////////////////////////////////////////////////////////////////////////////////////////////
// SchemaForm: dark-mode, framework-free, ES module UI generator for schema-driven dialogs.
// - Renders inputs from a schema and keeps a provided `params` object in sync.
// - refreshFromParams() updates inputs when params are changed elsewhere.
// - Supports feature dialogs and annotation dialogs with shared widget implementations.
// - Special: type === "reference_selection" uses a scene-driven picker instead of a text box.
export class SchemaForm {
    // Track a single globally-active reference selection input across all instances
    static __activeRefInput = null;
    static __setGlobalActiveRefInput(el) {
        try {
            // If another input was active, clear its visual + attribute
            const prev = SchemaForm.__activeRefInput;
            if (prev && prev !== el) {
                try { prev.style.filter = 'none'; } catch (_) { }
                try { prev.removeAttribute('active-reference-selection'); } catch (_) { }
                try { if (typeof prev.__refPreviewCleanup === 'function') prev.__refPreviewCleanup(); } catch (_) { }
            }
        } catch (_) { }
        SchemaForm.__activeRefInput = el || null;
    }

    // Track a single globally-active transform controls session across all instances
    static __activeXform = {
        owner: null,
        key: null,
        inputEl: null,
        wrapEl: null,
        target: null,
        controls: null,
        viewer: null,
        group: null,
        controlsChangeHandler: null,
        captureHandlers: null,
        stepId: null,
        valueAdapter: null,
        baseTransform: null,
    };
    static __stopGlobalActiveXform() {
        const s = SchemaForm.__activeXform;
        if (!s || !s.controls) return;
        try {
            // Detach and dispose controls
            s.controls.detach();
            if (s.viewer && s.viewer.scene) {
                try { if (s.controls && s.controls.isObject3D) s.viewer.scene.remove(s.controls); } catch (_) { }
                try { if (s.controls && s.controls.__helper && s.controls.__helper.isObject3D) s.viewer.scene.remove(s.controls.__helper); } catch (_) { }
                try { if (s.group && s.group.isObject3D) s.viewer.scene.remove(s.group); } catch (_) { }
            }
            try { s.controls.dispose(); } catch (_) { }
        } catch (_) { }
        try {
            // Remove any capture-phase event listeners installed during activation
            const h = s.captureHandlers;
            if (h && h.canvas && h.onDownCapture) {
                h.canvas.removeEventListener('pointerdown', h.onDownCapture, true);
            }
            if (h && h.win && h.onUpCapture) {
                h.win.removeEventListener('pointerup', h.onUpCapture, true);
            }
        } catch (_) { }
        try {
            if (s && s.viewer && s.viewer.controls && s.controlsChangeHandler && typeof s.viewer.controls.removeEventListener === 'function') {
                s.viewer.controls.removeEventListener('change', s.controlsChangeHandler);
            }
        } catch (_) { }
        try {
            // Remove target object
            if (s.viewer && s.viewer.scene && s.target) s.viewer.scene.remove(s.target);
        } catch (_) { }
        try { if (window.__BREP_activeXform) window.__BREP_activeXform = null; } catch (_) { }
        try {
            // Restore camera controls
            if (s.viewer && s.viewer.controls) s.viewer.controls.enabled = true;
        } catch (_) { }
        try {
            // Clear highlight
            if (s.inputEl) s.inputEl.removeAttribute('active-transform');
            const wrap = s.wrapEl;
            if (wrap) wrap.classList.remove('ref-active');
        } catch (_) { }
        SchemaForm.__activeXform = {
            owner: null,
            key: null,
            stepId: null,
            inputEl: null,
            wrapEl: null,
            target: null,
            controls: null,
            viewer: null,
            group: null,
            captureHandlers: null,
            controlsChangeHandler: null,
            valueAdapter: null,
            baseTransform: null,
        };
    }

    static getActiveTransformState() {
        return SchemaForm.__activeXform;
    }

    static getActiveReferenceInput() {
        return SchemaForm.__activeRefInput;
    }

    get activeTransform() {
        return SchemaForm.__activeXform;
    }

    get activeReferenceInput() {
        return SchemaForm.__activeRefInput;
    }

    isTransformSessionActiveFor(inputEl) {
        const active = SchemaForm.__activeXform;
        return Boolean(active && active.inputEl === inputEl);
    }

    setActiveTransformMode(inputEl, mode) {
        const active = SchemaForm.__activeXform;
        if (!active || active.inputEl !== inputEl || !active.controls) return;
        try { active.controls.setMode(mode); } catch (_) { }
    }

    stopTransformSessionIfOwnedByThis() {
        const active = SchemaForm.__activeXform;
        if (active && active.owner === this) {
            SchemaForm.__stopGlobalActiveXform();
        }
    }
    /**
     * @param {Object} schema - e.g. { sizeX: {type:'number', default_value:'2*t', hint:'Width formula' }, ... }
     * @param {Object} params - a live object to keep in sync with user edits
     * @param {Object} [options]
     * @param {(featureID:string|null)=>void} [options.onChange] - Callback fired on any field change
     */
    constructor(schema, params, options = {}) {
        if (!schema || typeof schema !== 'object') throw new Error('schema must be an object');
        if (!params || typeof params !== 'object') throw new Error('params must be an object');

        this.schema = schema;
        this.params = params;
        this.options = options;
        this._useShadowDOM = options && Object.prototype.hasOwnProperty.call(options, 'useShadowDOM')
            ? options.useShadowDOM !== false
            : true;
        this._inputs = new Map();
        this._widgets = new Map();
        this._skipDefaultRefresh = new Set();
        this._excludedKeys = new Set(['id', 'featureID']); // exclude from defaults & rendering
        if (Array.isArray(options.excludeKeys)) {
            for (const key of options.excludeKeys) {
                if (typeof key === 'string' && key.length) this._excludedKeys.add(key);
            }
        }

        this.uiElement = document.createElement('div');
        if (!this._useShadowDOM) {
            this.uiElement.classList.add('schema-form-host');
        }
        this._shadow = this._useShadowDOM
            ? this.uiElement.attachShadow({ mode: 'open' })
            : this.uiElement;

        this._shadow.appendChild(this._makeStyle());
        this._panel = document.createElement('div');
        this._panel.className = 'panel';
        this._shadow.appendChild(this._panel);

        this._fieldsWrap = document.createElement('div');
        this._fieldsWrap.className = 'fields';
        this._panel.appendChild(this._fieldsWrap);

        this._renderAllFields();

        // Deactivate reference selection when focusing or clicking into any other control
        const stopIfOtherControl = (target) => {
            try {
                // If the active input is not the current focus target, stop selection
                const active = SchemaForm.__activeRefInput || null;
                if (!active) return;
                if (target === active) return;
                // If target is inside the same active element (e.g., clicking within the input), skip
                if (target && typeof target.closest === 'function') {
                    if (target.closest('[active-reference-selection]')) return;
                    if (target.closest('.ref-active')) return;
                }
                this._stopActiveReferenceSelection();
            } catch (_) { }
            try {
                // Close active transform session if clicking outside its wrapper; commit changes
                const s = SchemaForm.__activeXform;
                if (s && s.owner === this) {
                    if (!(target && typeof target.closest === 'function' && target.closest('.transform-wrap'))) {
                        const val = this.params[s.key];
                        SchemaForm.__stopGlobalActiveXform();
                        this._emitParamsChange(s.key, val);
                    }
                }
            } catch (_) { }
        };
        // Capture focus changes within this form
        this._shadow.addEventListener('focusin', (ev) => {
            stopIfOtherControl(ev.target);
        }, true);
        // Also capture mouse interactions to be safe
        this._shadow.addEventListener('mousedown', (ev) => {
            stopIfOtherControl(ev.target);
        }, true);
    }

    destroy() {
        // If this form owns the active reference selector, clear it before tearing down
        try {
            const activeRef = (typeof SchemaForm.getActiveReferenceInput === 'function')
                ? SchemaForm.getActiveReferenceInput()
                : (SchemaForm.__activeRefInput || null);
            const ownsActiveRef = activeRef
                && (
                    (this._shadow && typeof this._shadow.contains === 'function' && this._shadow.contains(activeRef))
                    || (this.uiElement && typeof this.uiElement.contains === 'function' && this.uiElement.contains(activeRef))
                    || (typeof activeRef.getRootNode === 'function' && activeRef.getRootNode && activeRef.getRootNode() === this._shadow)
                );
            if (ownsActiveRef) this._stopActiveReferenceSelection();
        } catch (_) { /* ignore */ }

        // Clean up any active transform session owned by this instance
        try {
            const s = SchemaForm.__activeXform;
            if (s && s.owner === this) SchemaForm.__stopGlobalActiveXform();
        } catch (_) { }
        for (const widget of this._widgets.values()) {
            if (widget && typeof widget.destroy === 'function') {
                try { widget.destroy(); } catch (_) { /* ignore widget destroy errors */ }
            }
        }
        this._widgets.clear();
    }

    /** Returns the live params object (already kept in sync). */
    getParams() {
        return this.params;
    }

    /** Programmatically refresh input widgets from the current params object. */
    refreshFromParams() {
        for (const [key, widget] of this._widgets.entries()) {
            if (widget && typeof widget.refreshFromParams === 'function') {
                try {
                    widget.refreshFromParams(this.params[key], {
                        ui: this,
                        key,
                        def: this.schema[key] || {},
                        params: this.params,
                    });
                } catch (_) { }
            }
        }

        for (const [key, el] of this._inputs.entries()) {
            const def = this.schema[key] || {};
            if (this._skipDefaultRefresh.has(key)) {
                continue;
            }
            const v = this._pickInitialValue(key, def);
            // Special composite types handle their own refresh
            if (def && def.type === 'boolean_operation') {
                const row = this._fieldsWrap.querySelector(`[data-key="${key}"]`);
                const select = row ? row.querySelector('select[data-role="bool-op"]') : null;
                if (select) {
                    const opVal = (v && typeof v === 'object') ? (v.operation) : null;
                    select.value = opVal ? String(opVal) : 'NONE';
                }
                const chips = row ? row.querySelector('.ref-chips') : null;
                const targets = (v && typeof v === 'object' && Array.isArray(v.targets)) ? v.targets : [];
                if (chips) this._renderChips(chips, key, targets);
                continue;
            }
            this._setInputValue(el, def.type, v);

            // If this is a reference selection, refresh custom UI
            if (def && def.type === 'reference_selection') {
                const row = this._fieldsWrap.querySelector(`[data-key="${key}"]`);
                if (def.multiple) {
                    const normalized = normalizeReferenceList(Array.isArray(v) ? v : []);
                    this.params[key] = normalized;
                    const chips = row ? row.querySelector('.ref-chips') : null;
                    if (chips) this._renderChips(chips, key, normalized);
                } else {
                    const display = row ? row.querySelector('.ref-single-display') : null;
                    const normalized = normalizeReferenceName(v);
                    this.params[key] = normalized ?? null;
                    if (display) {
                        const label = display.querySelector('.ref-single-label');
                        const placeholder = display.dataset?.placeholder || 'Click then select in scene…';
                        if (label) label.textContent = normalized || placeholder;
                        else display.textContent = normalized || placeholder;
                        const clearBtn = display.querySelector('.ref-chip-remove');
                        if (clearBtn) clearBtn.style.visibility = normalized ? 'visible' : 'hidden';
                    }
                    try {
                        const inputEl = this._inputs.get(key);
                        if (inputEl && inputEl === SchemaForm.__activeRefInput) {
                            this._syncActiveReferenceSelectionHighlight(inputEl, def);
                        }
                    } catch (_) { }
                }
                continue;
            }

            // Transform widget: refresh info line
            if (def && def.type === 'transform') {
                const row = this._fieldsWrap.querySelector(`[data-key="${key}"]`);
                const info = row ? row.querySelector('.transform-info') : null;
                if (info) {
                    const fmt = (n) => {
                        const x = Number(n);
                        if (!Number.isFinite(x)) return '0';
                        const a = Math.abs(x);
                        const prec = a >= 100 ? 0 : (a >= 10 ? 1 : 2);
                        return String(x.toFixed(prec));
                    };
                    const p = Array.isArray(v?.position) ? v.position : [0, 0, 0];
                    const r = Array.isArray(v?.rotationEuler) ? v.rotationEuler : [0, 0, 0];
                    info.textContent = `pos(${fmt(p[0])}, ${fmt(p[1])}, ${fmt(p[2])})  rot(${fmt(r[0])}, ${fmt(r[1])}, ${fmt(r[2])})`;
                }
                continue;
            }
        }
    }

    // --- Internal: rendering & behavior ---------------------------------------

    _renderAllFields() {
        // Ensure params has defaults for missing keys (without clobbering provided values)
        for (const key in this.schema) {
            if (!Object.prototype.hasOwnProperty.call(this.schema, key)) continue;
            const defRaw = this.schema[key];
            const def = (defRaw && typeof defRaw === 'object') ? defRaw : {};
            if (this._excludedKeys.has(key)) continue;
            if (!(key in this.params)) {
                const raw = ('default_value' in def) ? def.default_value : this._defaultForType(def.type);
                this.params[key] = this._cloneDefault(raw);
            }
        }

        this._widgets.clear();
        this._skipDefaultRefresh.clear();

        // Build field rows
        for (const key in this.schema) {
            if (!Object.prototype.hasOwnProperty.call(this.schema, key)) continue;
            const defRaw = this.schema[key];
            const def = (defRaw && typeof defRaw === 'object') ? defRaw : {};
            if (this._excludedKeys.has(key)) continue;

            const row = document.createElement('div');
            row.className = 'field-row';
            row.dataset.key = key;

            if (def.hint != null && def.hint !== '') {
                row.setAttribute('title', String(def.hint));
            }

            const id = 'gfu_' + key + '_' + Math.random().toString(36).slice(2, 8);

            const label = document.createElement('label');
            label.className = 'label';
            label.setAttribute('for', id);
            // Allow schema to override the row label via `label`
            label.textContent = String((def && def.label) ? def.label : this._prettyLabel(key));
            row.appendChild(label);

            const controlWrap = document.createElement('div');
            controlWrap.className = 'control-wrap';

            let inputEl;
            let inputRegistered = true;

            // Allow schema defs to supply inline renderer without touching global registry.
            const renderer =
                typeof def.renderWidget === 'function'
                    ? def.renderWidget
                    : typeof def.widgetRenderer === 'function'
                        ? def.widgetRenderer
                        : getWidgetRenderer(def.type);
            const widget = renderer({
                ui: this,
                key,
                def,
                id,
                controlWrap,
                row,
            }) || {};

            inputEl = widget.inputEl;
            if (typeof widget.inputRegistered === 'boolean') {
                inputRegistered = widget.inputRegistered;
            }

            if (widget && typeof widget === 'object') {
                this._widgets.set(key, widget);
                // Custom widgets can opt out of default refresh handling.
                if (widget.skipDefaultRefresh === true) {
                    this._skipDefaultRefresh.add(key);
                }
            }

            if (!inputEl || !(inputEl instanceof HTMLElement)) {
                inputRegistered = false;
                const placeholder = document.createElement('div');
                placeholder.className = 'control-placeholder';
                placeholder.textContent = 'Control unavailable';
                controlWrap.appendChild(placeholder);
            } else if (!inputEl.parentNode) {
                controlWrap.appendChild(inputEl);
            }

            row.appendChild(controlWrap);
            this._fieldsWrap.appendChild(row);
            if (inputRegistered && inputEl instanceof HTMLElement) {
                this._inputs.set(key, inputEl);
            }
        }
    }

    activateField(key) {
        const widget = this._widgets.get(key);
        if (widget && typeof widget.activate === 'function') {
            try { widget.activate(); } catch (_) { }
            return true;
        }
        return false;
    }

    readFieldValue(key) {
        const widget = this._widgets.get(key);
        if (widget && typeof widget.readValue === 'function') {
            try { return widget.readValue(); } catch (_) { }
        }
        return this.params[key];
    }

    _cloneDefault(val) {
        if (val == null) return val;
        if (Array.isArray(val)) return val.map(v => this._cloneDefault(v));
        if (typeof val === 'object') {
            const proto = Object.getPrototypeOf(val);
            if (proto === Object.prototype || proto === null) {
                const out = {};
                for (const k of Object.keys(val)) out[k] = this._cloneDefault(val[k]);
                return out;
            }
        }
        return val;
    }

    // Public: Activate the first reference_selection input in this form (if any)
    activateFirstReferenceSelection() {
        try {
            for (const key in this.schema) {
                if (!Object.prototype.hasOwnProperty.call(this.schema, key)) continue;
                const def = this.schema[key];
                if (def && def.type === 'reference_selection') {
                    const inputEl = this._inputs.get(key);
                    if (inputEl) {
                        this._activateReferenceSelection(inputEl, def);
                        return true;
                    }
                }
            }
        } catch (_) { }
        return false;
    }

    _getReferenceSelectionScene() {
        return this.options?.scene
            || this.options?.viewer?.partHistory?.scene
            || this.options?.viewer?.scene
            || null;
    }

    _getReferencePreviewCacheRoot() {
        const holder = this.options?.featureRef || this;
        if (!holder) return null;
        if (!holder.__refPreviewCache) {
            try {
                Object.defineProperty(holder, '__refPreviewCache', {
                    value: new Map(),
                    configurable: true,
                    enumerable: false,
                    writable: true,
                });
            } catch (_) {
                holder.__refPreviewCache = new Map();
            }
        }
        return holder.__refPreviewCache;
    }

    _getReferencePreviewCache(inputEl) {
        const root = this._getReferencePreviewCacheRoot();
        if (!root) return null;
        const key = (inputEl?.dataset?.key || inputEl?.dataset?.refKey || inputEl?.__refPreviewKey || '__default');
        let bucket = root.get(key);
        if (!bucket) {
            bucket = new Map();
            root.set(key, bucket);
        }
        return bucket;
    }

    _getReferencePreviewPersistentBucket(inputEl) {
        const entry = this.options?.featureRef || null;
        if (!entry) return null;
        if (!entry.persistentData || typeof entry.persistentData !== 'object') {
            entry.persistentData = {};
        }
        if (!entry.persistentData.__refPreviewSnapshots || typeof entry.persistentData.__refPreviewSnapshots !== 'object') {
            entry.persistentData.__refPreviewSnapshots = {};
        }
        const key = (inputEl?.dataset?.key || inputEl?.dataset?.refKey || inputEl?.__refPreviewKey || '__default');
        if (!entry.persistentData.__refPreviewSnapshots[key] || typeof entry.persistentData.__refPreviewSnapshots[key] !== 'object') {
            entry.persistentData.__refPreviewSnapshots[key] = {};
        }
        return entry.persistentData.__refPreviewSnapshots[key];
    }

    _resolveReferencePreviewName(obj) {
        if (!obj) return null;
        const raw = obj.name != null ? String(obj.name).trim() : '';
        if (raw) return raw;
        const type = obj.type || 'OBJECT';
        const pos = obj.position || {};
        const x = Number.isFinite(pos.x) ? pos.x : 0;
        const y = Number.isFinite(pos.y) ? pos.y : 0;
        const z = Number.isFinite(pos.z) ? pos.z : 0;
        return `${type}(${x},${y},${z})`;
    }

    _extractEdgeWorldPositions(obj) {
        if (!obj) return [];
        try {
            if (typeof obj.points === 'function') {
                const pts = obj.points(true);
                if (Array.isArray(pts) && pts.length) {
                    const flat = [];
                    for (const p of pts) {
                        if (!p) continue;
                        const x = Number(p.x);
                        const y = Number(p.y);
                        const z = Number(p.z);
                        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
                        flat.push(x, y, z);
                    }
                    if (flat.length >= 6) return flat;
                }
            }
        } catch (_) { /* ignore */ }

        try {
            const geom = obj.geometry;
            const pos = geom && typeof geom.getAttribute === 'function' ? geom.getAttribute('position') : null;
            if (!pos || pos.itemSize !== 3 || pos.count < 2) return [];
            const tmp = new THREE.Vector3();
            const flat = [];
            for (let i = 0; i < pos.count; i++) {
                tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
                tmp.applyMatrix4(obj.matrixWorld);
                flat.push(tmp.x, tmp.y, tmp.z);
            }
            return flat.length >= 6 ? flat : [];
        } catch (_) { /* ignore */ }
        return [];
    }

    _syncPreviewLineResolution(mat) {
        if (!mat || !mat.resolution || typeof mat.resolution.set !== 'function') return;
        let width = 0;
        let height = 0;
        try {
            const viewer = this.options?.viewer || null;
            const el = viewer?.renderer?.domElement || null;
            if (el && typeof el.getBoundingClientRect === 'function') {
                const rect = el.getBoundingClientRect();
                width = rect.width || rect.right - rect.left;
                height = rect.height || rect.bottom - rect.top;
            }
            if ((!width || !height) && viewer?.container) {
                width = viewer.container.clientWidth || width;
                height = viewer.container.clientHeight || height;
            }
        } catch (_) { /* ignore */ }
        if (!width || !height) {
            try {
                if (typeof window !== 'undefined') {
                    width = window.innerWidth || width;
                    height = window.innerHeight || height;
                }
            } catch (_) { /* ignore */ }
        }
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            try { mat.resolution.set(width, height); } catch (_) { }
        }
    }

    _createPreviewLineMaterial(sourceMat, colorHex = REF_PREVIEW_COLORS.EDGE) {
        let mat = null;
        if (sourceMat && typeof sourceMat.clone === 'function') {
            try { mat = sourceMat.clone(); } catch (_) { mat = null; }
        }
        if (!mat) {
            try {
                mat = new LineMaterial({ color: colorHex, linewidth: 3, transparent: true, opacity: 0.95, worldUnits: false, dashed: false });
            } catch (_) { mat = null; }
        }
        if (mat && mat.color && typeof mat.color.set === 'function') {
            try { mat.color.set(colorHex); } catch (_) { }
        }
        if (mat) {
            try { mat.transparent = true; } catch (_) { }
            try { mat.opacity = Number.isFinite(mat.opacity) ? Math.min(0.95, mat.opacity) : 0.95; } catch (_) { }
            try { mat.depthTest = false; } catch (_) { }
            try { mat.depthWrite = false; } catch (_) { }
            try { if (typeof mat.dashed !== 'undefined') mat.dashed = false; } catch (_) { }
            try { if (typeof mat.dashScale !== 'undefined') mat.dashScale = 1; } catch (_) { }
            try { if (typeof mat.dashSize !== 'undefined') mat.dashSize = 1; } catch (_) { }
            try { if (typeof mat.gapSize !== 'undefined') mat.gapSize = 0; } catch (_) { }
            try { this._syncPreviewLineResolution(mat); } catch (_) { }
        }
        return mat;
    }

    _createPreviewMeshMaterial(sourceMat, colorHex = REF_PREVIEW_COLORS.FACE) {
        let mat = null;
        if (sourceMat && typeof sourceMat.clone === 'function') {
            try { mat = sourceMat.clone(); } catch (_) { mat = null; }
        }
        if (!mat) {
            try {
                mat = new THREE.MeshStandardMaterial({
                    color: colorHex,
                    transparent: true,
                    opacity: 0.25,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            } catch (_) { mat = null; }
        }
        if (mat && mat.color && typeof mat.color.set === 'function') {
            try { mat.color.set(colorHex); } catch (_) { }
        }
        if (mat) {
            try { mat.transparent = true; } catch (_) { }
            try { mat.opacity = 0.25; } catch (_) { }
            try { mat.depthWrite = false; } catch (_) { }
            try { mat.depthTest = true; } catch (_) { }
            try { mat.side = THREE.DoubleSide; } catch (_) { }
            try { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; } catch (_) { }
        }
        return mat;
    }

    _createPreviewPointMaterial(sourceMat, colorHex = REF_PREVIEW_COLORS.VERTEX) {
        let mat = null;
        if (sourceMat && typeof sourceMat.clone === 'function') {
            try { mat = sourceMat.clone(); } catch (_) { mat = null; }
        }
        if (!mat || !mat.isPointsMaterial) {
            try {
                mat = new THREE.PointsMaterial({
                    color: colorHex,
                    size: 7,
                    sizeAttenuation: false,
                    transparent: true,
                    opacity: 0.9,
                });
            } catch (_) { mat = null; }
        }
        if (mat && mat.color && typeof mat.color.set === 'function') {
            try { mat.color.set(colorHex); } catch (_) { }
        }
        if (mat) {
            try { mat.transparent = true; } catch (_) { }
            try { mat.opacity = 0.9; } catch (_) { }
        }
        return mat;
    }

    _configurePreviewObject(obj, refName, previewType) {
        if (!obj) return obj;
        try { obj.name = `__refPreview__${refName}`; } catch (_) { }
        try {
            obj.userData = obj.userData || {};
            obj.userData.refPreview = true;
            obj.userData.refName = refName;
            obj.userData.previewType = previewType;
            obj.userData.excludeFromFit = true;
        } catch (_) { }
        try { obj.renderOrder = Math.max(10050, obj.renderOrder || 0); } catch (_) { }
        try { obj.raycast = () => { }; } catch (_) { }
        try {
            obj.traverse?.((child) => {
                if (!child || child === obj) return;
                try { child.raycast = () => { }; } catch (_) { }
                try {
                    child.userData = child.userData || {};
                    child.userData.refPreview = true;
                    child.userData.refName = refName;
                    if (!child.userData.previewType && child.type) child.userData.previewType = child.type;
                } catch (_) { }
            });
        } catch (_) { }
        return obj;
    }

    _getOwningFeatureIdForObject(obj) {
        let cur = obj;
        let guard = 0;
        while (cur && guard < 8) {
            if (cur.owningFeatureID != null) return cur.owningFeatureID;
            cur = cur.parent || null;
            guard += 1;
        }
        return null;
    }

    _buildEdgePreviewFromObject(obj, refName, colorHex = REF_PREVIEW_COLORS.EDGE) {
        if (!obj) return null;
        const positions = this._extractEdgeWorldPositions(obj);
        if (!positions || positions.length < 6) return null;
        const geom = new LineGeometry();
        geom.setPositions(positions);
        try { geom.computeBoundingSphere(); } catch (_) { }
        const mat = this._createPreviewLineMaterial(obj.material, colorHex);
        const line = new Line2(geom, mat || undefined);
        try { line.computeLineDistances?.(); } catch (_) { }
        try { if (line.material && typeof line.material.dashed !== 'undefined') line.material.dashed = false; } catch (_) { }
        line.type = 'REF_PREVIEW_EDGE';
        return this._configurePreviewObject(line, refName, 'EDGE');
    }

    _extractFaceEdgePositions(face) {
        if (!face) return [];
        const out = [];
        const addEdge = (edge) => {
            const positions = this._extractEdgeWorldPositions(edge);
            if (positions && positions.length >= 6) out.push(positions);
        };

        if (Array.isArray(face.edges) && face.edges.length) {
            for (const edge of face.edges) addEdge(edge);
            return out;
        }

        const faceName = face?.name || face?.userData?.faceName || null;
        const parentSolid = face?.parentSolid || face?.userData?.parentSolid || face?.parent || null;
        if (!faceName || !parentSolid || !Array.isArray(parentSolid.children)) return out;

        for (const child of parentSolid.children) {
            if (!child || child.type !== SelectionFilter.EDGE) continue;
            const faceA = child?.userData?.faceA || null;
            const faceB = child?.userData?.faceB || null;
            if (faceA === faceName || faceB === faceName) {
                addEdge(child);
            }
        }
        return out;
    }

    _buildReferencePreviewObject(obj, refName) {
        if (!obj) return null;
        const type = String(obj.type || '').toUpperCase();
        if (type === SelectionFilter.EDGE || type === 'EDGE') {
            return this._buildEdgePreviewFromObject(obj, refName, REF_PREVIEW_COLORS.EDGE);
        }
        if (type === SelectionFilter.FACE || type === SelectionFilter.PLANE || type === 'FACE' || type === 'PLANE') {
            const geom = obj.geometry && typeof obj.geometry.clone === 'function' ? obj.geometry.clone() : null;
            if (!geom) return null;
            try { geom.applyMatrix4(obj.matrixWorld); } catch (_) { }
            const color = (type === SelectionFilter.PLANE || type === 'PLANE') ? REF_PREVIEW_COLORS.PLANE : REF_PREVIEW_COLORS.FACE;
            const mat = this._createPreviewMeshMaterial(obj.material, color);
            const mesh = new THREE.Mesh(geom, mat || undefined);
            mesh.type = (type === SelectionFilter.PLANE || type === 'PLANE') ? 'REF_PREVIEW_PLANE' : 'REF_PREVIEW_FACE';
            try { mesh.matrixAutoUpdate = false; } catch (_) { }
            const edges = Array.isArray(obj.edges) ? obj.edges : [];
            if (edges.length) {
                const group = new THREE.Group();
                group.type = mesh.type;
                try { group.userData = group.userData || {}; } catch (_) { }
                try { group.userData.previewHasEdges = true; } catch (_) { }
                try { group.userData.previewHasFace = true; } catch (_) { }
                group.add(mesh);
                for (const edge of edges) {
                    const edgePreview = this._buildEdgePreviewFromObject(edge, refName, REF_PREVIEW_COLORS.EDGE);
                    if (edgePreview) group.add(edgePreview);
                }
                return this._configurePreviewObject(group, refName, mesh.type);
            }
            return this._configurePreviewObject(mesh, refName, mesh.type);
        }
        if (type === SelectionFilter.VERTEX || type === 'VERTEX') {
            const pos = new THREE.Vector3();
            try {
                if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(pos);
                else pos.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
            } catch (_) { }
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
            const mat = this._createPreviewPointMaterial(obj.material, REF_PREVIEW_COLORS.VERTEX);
            const pts = new THREE.Points(geom, mat || undefined);
            pts.position.copy(pos);
            pts.type = 'REF_PREVIEW_VERTEX';
            return this._configurePreviewObject(pts, refName, 'VERTEX');
        }
        return null;
    }

    _buildReferencePreviewFromSnapshot(refName, snapshot) {
        if (!snapshot || !refName) return null;
        const type = String(snapshot.type || '').toUpperCase();
        if (type === 'EDGE') {
            const positions = Array.isArray(snapshot.positions) ? snapshot.positions : null;
            if (!positions || positions.length < 6) return null;
            const geom = new LineGeometry();
            geom.setPositions(positions);
            try { geom.computeBoundingSphere(); } catch (_) { }
            const mat = this._createPreviewLineMaterial(null, REF_PREVIEW_COLORS.EDGE);
            const line = new Line2(geom, mat || undefined);
            try { line.computeLineDistances?.(); } catch (_) { }
            try { if (line.material && typeof line.material.dashed !== 'undefined') line.material.dashed = false; } catch (_) { }
            line.type = 'REF_PREVIEW_EDGE';
            return this._configurePreviewObject(line, refName, 'EDGE');
        }
        if (type === 'FACE' || type === 'PLANE') {
            const group = new THREE.Group();
            group.type = type === 'PLANE' ? 'REF_PREVIEW_PLANE' : 'REF_PREVIEW_FACE';
            try { group.userData = group.userData || {}; } catch (_) { }
            try { group.userData.previewHasEdges = true; } catch (_) { }
            const edges = Array.isArray(snapshot.edgePositions) ? snapshot.edgePositions : [];
            for (const positions of edges) {
                if (!Array.isArray(positions) || positions.length < 6) continue;
                const geom = new LineGeometry();
                geom.setPositions(positions);
                try { geom.computeBoundingSphere(); } catch (_) { }
                const mat = this._createPreviewLineMaterial(null, REF_PREVIEW_COLORS.EDGE);
                const line = new Line2(geom, mat || undefined);
                try { line.computeLineDistances?.(); } catch (_) { }
                try { if (line.material && typeof line.material.dashed !== 'undefined') line.material.dashed = false; } catch (_) { }
                line.type = 'REF_PREVIEW_EDGE';
                this._configurePreviewObject(line, refName, 'EDGE');
                group.add(line);
            }
            if (group.children.length === 0) return null;
            return this._configurePreviewObject(group, refName, group.type);
        }
        if (type === 'VERTEX') {
            const pos = snapshot.position;
            if (!Array.isArray(pos) || pos.length < 3) return null;
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
            const mat = this._createPreviewPointMaterial(null, REF_PREVIEW_COLORS.VERTEX);
            const pts = new THREE.Points(geom, mat || undefined);
            pts.position.set(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
            pts.type = 'REF_PREVIEW_VERTEX';
            return this._configurePreviewObject(pts, refName, 'VERTEX');
        }
        return null;
    }

    _ensureReferencePreviewGroup(inputEl) {
        const scene = this._getReferenceSelectionScene();
        if (!scene || !inputEl) return null;
        const existing = inputEl.__refPreviewGroup;
        if (existing && existing.isObject3D) {
            if (existing.parent !== scene) {
                try { scene.add(existing); } catch (_) { }
            }
            return existing;
        }
        const group = new THREE.Group();
        try { group.name = `__REF_PREVIEW_GROUP__${inputEl?.dataset?.key || ''}`; } catch (_) { }
        try {
            group.userData = group.userData || {};
            group.userData.preventRemove = true;
            group.userData.excludeFromFit = true;
            group.userData.refPreview = true;
        } catch (_) { }
        try { group.renderOrder = 10040; } catch (_) { }
        try { group.raycast = () => { }; } catch (_) { }
        inputEl.__refPreviewGroup = group;
        try { scene.add(group); } catch (_) { }
        return group;
    }

    _removeReferencePreviewGroup(inputEl) {
        const group = inputEl?.__refPreviewGroup;
        if (!group || !group.isObject3D) return;
        try { if (group.userData) group.userData.preventRemove = false; } catch (_) { }
        try { if (group.parent) group.parent.remove(group); } catch (_) { }
    }

    _syncActiveReferenceSelectionPreview(inputEl, def = null) {
        try {
            const active = SchemaForm.__activeRefInput;
            if (!active || active !== inputEl) return;
            const scene = this._getReferenceSelectionScene();
            if (!scene) return;
            const names = this._collectReferenceSelectionNames(inputEl, def);
            if (!names.length) {
                this._removeReferencePreviewGroup(inputEl);
                return;
            }
            const cache = this._getReferencePreviewCache(inputEl);
            if (!cache || cache.size === 0) return;
            const group = this._ensureReferencePreviewGroup(inputEl);
            const wanted = new Set(names);
            if (group && Array.isArray(group.children)) {
                for (const child of group.children.slice()) {
                    const refName = child?.userData?.refName;
                    if (!refName || !wanted.has(refName)) {
                        try { group.remove(child); } catch (_) { }
                    }
                }
            }
            for (const name of names) {
                const entry = cache.get(name);
                let ghost = entry && entry.object ? entry.object : entry;
                if (!ghost) continue;
                const sourceUuid = entry?.sourceUuid || null;
                let originalPresent = false;
                if (sourceUuid && typeof scene.getObjectByProperty === 'function') {
                    try { originalPresent = !!scene.getObjectByProperty('uuid', sourceUuid); } catch (_) { originalPresent = false; }
                } else {
                    const real = scene.getObjectByName(name);
                    originalPresent = !!real;
                }
                if (originalPresent) {
                    const keepGhost = !!(entry?.showWhenOriginalPresent || ghost?.userData?.previewHasEdges);
                    if (!keepGhost) {
                        if (ghost.parent === group) {
                            try { group.remove(ghost); } catch (_) { }
                        }
                        continue;
                    }
                    try {
                        ghost.traverse?.((child) => {
                            if (!child || !child.userData?.refPreview) return;
                            const pType = String(child.userData.previewType || child.type || '').toUpperCase();
                            if (pType.includes('REF_PREVIEW_FACE') || pType.includes('REF_PREVIEW_PLANE')) {
                                child.visible = false;
                            } else if (child.type === 'REF_PREVIEW_EDGE') {
                                child.visible = true;
                            }
                        });
                    } catch (_) { }
                    if (ghost.parent !== group) {
                        try { group.add(ghost); } catch (_) { }
                    }
                    continue;
                }
                if (ghost.parent !== group) {
                    try { group.add(ghost); } catch (_) { }
                }
                try { ghost.visible = true; } catch (_) { }
            }
        } catch (_) { }
    }

    _seedReferencePreviewCacheFromScene(inputEl, def = null, names = null, sceneOverride = null) {
        if (!inputEl) return;
        const scene = sceneOverride || this._getReferenceSelectionScene();
        if (!scene) return;
        const list = Array.isArray(names) ? names : this._collectReferenceSelectionNames(inputEl, def);
        if (!list.length) return;
        const cache = this._getReferencePreviewCache(inputEl);
        if (!cache) return;
        const store = this._getReferencePreviewPersistentBucket(inputEl);
        for (const name of list) {
            if (!name) continue;
            const existing = cache.get(name) || null;
            const snapshot = store ? store[name] : null;
            if (snapshot) {
                const snapType = String(snapshot.type || '').toUpperCase();
                const snapEdges = Array.isArray(snapshot.edgePositions) ? snapshot.edgePositions : null;
                const isFaceSnap = (snapType === 'FACE' || snapType === 'PLANE') && snapEdges && snapEdges.length;
                const isEdgeSnap = snapType === 'EDGE' && Array.isArray(snapshot.positions) && snapshot.positions.length >= 6;
                const isVertexSnap = snapType === 'VERTEX' && Array.isArray(snapshot.position) && snapshot.position.length >= 3;
                if (isFaceSnap || isEdgeSnap || isVertexSnap) {
                    const shouldOverride = !existing || !existing.fromSnapshot || isFaceSnap;
                    if (shouldOverride) {
                        const ghost = this._buildReferencePreviewFromSnapshot(name, snapshot);
                        if (ghost) {
                            cache.set(name, {
                                object: ghost,
                                type: snapshot.type || null,
                                sourceUuid: snapshot.sourceUuid || null,
                                sourceFeatureId: snapshot.sourceFeatureId || null,
                                showWhenOriginalPresent: isFaceSnap || !!ghost?.userData?.previewHasEdges,
                                fromSnapshot: true,
                            });
                            continue;
                        }
                    }
                }
            }
            if (cache.has(name)) continue;
            const obj = scene.getObjectByName(name);
            if (obj && !obj?.userData?.refPreview) {
                this._storeReferencePreviewSnapshot(inputEl, def, obj);
                continue;
            }
            if (store && store[name]) {
                const snapshot = store[name];
                const ghost = this._buildReferencePreviewFromSnapshot(name, snapshot);
                if (ghost) {
                    cache.set(name, {
                        object: ghost,
                        type: snapshot.type || null,
                        sourceUuid: snapshot.sourceUuid || null,
                        sourceFeatureId: snapshot.sourceFeatureId || null,
                        showWhenOriginalPresent: String(snapshot.type || '').toUpperCase() === 'FACE' || String(snapshot.type || '').toUpperCase() === 'PLANE' || !!ghost?.userData?.previewHasEdges,
                        fromSnapshot: true,
                    });
                }
            }
        }
    }

    _storeReferencePreviewSnapshot(inputEl, def, obj) {
        try {
            if (!inputEl || !obj) return;
            const refName = this._resolveReferencePreviewName(obj);
            if (!refName) return;
            const cache = this._getReferencePreviewCache(inputEl);
            if (!cache) return;
            const ghost = this._buildReferencePreviewObject(obj, refName);
            if (!ghost) return;
            const sourceUuid = obj.uuid || null;
            const sourceFeatureId = this._getOwningFeatureIdForObject(obj);
            cache.set(refName, {
                object: ghost,
                type: obj.type || null,
                sourceUuid,
                sourceFeatureId,
                showWhenOriginalPresent: !!ghost?.userData?.previewHasEdges,
            });
            try {
                const store = this._getReferencePreviewPersistentBucket(inputEl);
                if (store) {
                    const objType = String(obj.type || '').toUpperCase();
                    if (objType === SelectionFilter.EDGE || objType === 'EDGE') {
                        const positions = this._extractEdgeWorldPositions(obj);
                        if (positions && positions.length >= 6) {
                            store[refName] = { type: 'EDGE', positions, sourceUuid, sourceFeatureId };
                        }
                    } else if (objType === SelectionFilter.VERTEX || objType === 'VERTEX') {
                        const pos = new THREE.Vector3();
                        try {
                            if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(pos);
                            else pos.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
                        } catch (_) { }
                        store[refName] = { type: 'VERTEX', position: [pos.x, pos.y, pos.z], sourceUuid, sourceFeatureId };
                    }
                }
            } catch (_) { }
            if (SchemaForm.__activeRefInput === inputEl) {
                try { this._syncActiveReferenceSelectionPreview(inputEl, def); } catch (_) { }
            }
        } catch (_) { }
    }

    _startReferencePreviewWatcher(inputEl, def) {
        if (!inputEl) return;
        if (this._refPreviewWatcher && this._refPreviewWatcher.inputEl === inputEl) return;
        this._stopReferencePreviewWatcher();
        const tick = () => {
            if (!this._refPreviewWatcher || this._refPreviewWatcher.inputEl !== inputEl) return;
            if (SchemaForm.__activeRefInput !== inputEl) {
                this._stopReferencePreviewWatcher();
                return;
            }
            try { this._syncActiveReferenceSelectionPreview(inputEl, def); } catch (_) { }
            this._refPreviewWatcher.timer = setTimeout(tick, 300);
        };
        this._refPreviewWatcher = { inputEl, timer: null };
        inputEl.__refPreviewCleanup = () => {
            try { this._stopReferencePreviewWatcher(); } catch (_) { }
            try { this._removeReferencePreviewGroup(inputEl); } catch (_) { }
        };
        tick();
    }

    _stopReferencePreviewWatcher() {
        if (!this._refPreviewWatcher) return;
        const timer = this._refPreviewWatcher.timer;
        if (timer) {
            clearTimeout(timer);
        }
        this._refPreviewWatcher = null;
    }

    _collectReferenceSelectionNames(inputEl, def = null) {
        if (!inputEl) return [];
        const isMulti = Boolean(def && def.multiple) || (inputEl.dataset && inputEl.dataset.multiple === 'true');
        if (isMulti) {
            let list = null;
            if (typeof inputEl.__getSelectionList === 'function') {
                try { list = inputEl.__getSelectionList(); } catch (_) { list = null; }
            }
            if (!Array.isArray(list) && inputEl.dataset && inputEl.dataset.selectedValues) {
                try {
                    const parsed = JSON.parse(inputEl.dataset.selectedValues);
                    if (Array.isArray(parsed)) list = parsed;
                } catch (_) { /* ignore */ }
            }
            if (!Array.isArray(list) && inputEl.dataset && inputEl.dataset.key && this.params && Array.isArray(this.params[inputEl.dataset.key])) {
                list = this.params[inputEl.dataset.key];
            }
            return normalizeReferenceList(Array.isArray(list) ? list : []);
        }
        let value = null;
        if (inputEl.value != null && String(inputEl.value).trim() !== '') {
            value = inputEl.value;
        } else if (inputEl.dataset && inputEl.dataset.key && this.params && this.params[inputEl.dataset.key] != null) {
            value = this.params[inputEl.dataset.key];
        }
        const normalized = normalizeReferenceName(value);
        return normalized ? [normalized] : [];
    }

    _syncActiveReferenceSelectionHighlight(inputEl, def = null) {
        try {
            const active = SchemaForm.__activeRefInput;
            if (!active || active !== inputEl) return;
            const scene = this._getReferenceSelectionScene();
            if (!scene) return;
            const names = this._collectReferenceSelectionNames(inputEl, def);
            try { this._seedReferencePreviewCacheFromScene(inputEl, def, names, scene); } catch (_) { }
            SelectionFilter.unselectAll(scene);
            for (const name of names) {
                if (!name) continue;
                try { SelectionFilter.selectItem(scene, name); } catch (_) { }
            }
            try { this._syncActiveReferenceSelectionPreview(inputEl, def); } catch (_) { }
        } catch (_) { }
    }

    _ensureReferencePreviewSnapshots(inputEl, def) {
        try {
            if (!inputEl) return;
            if (inputEl.__refPreviewBackfillPromise) return;
            const names = this._collectReferenceSelectionNames(inputEl, def);
            if (!names.length) return;
            const store = this._getReferencePreviewPersistentBucket(inputEl);
            let missing = false;
            if (!store) missing = true;
            if (!missing) {
                for (const name of names) {
                    const snap = store ? store[name] : null;
                    const type = String(snap?.type || '').toUpperCase();
                    if (!snap) { missing = true; break; }
                    if (type === 'EDGE') {
                        if (!Array.isArray(snap.positions) || snap.positions.length < 6) { missing = true; break; }
                    } else if (type === 'VERTEX') {
                        if (!Array.isArray(snap.position) || snap.position.length < 3) { missing = true; break; }
                    } else if (type === 'FACE' || type === 'PLANE') {
                        if (!Array.isArray(snap.edgePositions) || snap.edgePositions.length === 0) { missing = true; break; }
                    } else {
                        missing = true;
                        break;
                    }
                }
            }
            if (!missing) return;

            const partHistory = this.options?.partHistory || this.options?.viewer?.partHistory || null;
            if (!partHistory || typeof partHistory.runHistory !== 'function') return;

            const prevStep = partHistory.currentHistoryStepId;
            const featureId = this.params?.id ?? this.params?.featureID ?? this.params?.featureId ?? null;
            if (featureId != null) {
                try { partHistory.currentHistoryStepId = String(featureId); } catch (_) { }
            }
            inputEl.__refPreviewBackfillPromise = Promise.resolve()
                .then(() => partHistory.runHistory())
                .catch(() => { /* ignore */ })
                .then(() => {
                    if (featureId != null) {
                        try { partHistory.currentHistoryStepId = prevStep; } catch (_) { }
                    }
                })
                .then(() => {
                    inputEl.__refPreviewBackfillPromise = null;
                    if (SchemaForm.__activeRefInput !== inputEl) return;
                    const scene = this._getReferenceSelectionScene();
                    const latest = this._collectReferenceSelectionNames(inputEl, def);
                    try { this._seedReferencePreviewCacheFromScene(inputEl, def, latest, scene); } catch (_) { }
                    try { this._syncActiveReferenceSelectionPreview(inputEl, def); } catch (_) { }
                })
                .finally(() => {
                    inputEl.__refPreviewBackfillPromise = null;
                });
        } catch (_) { }
    }

    _hoverReferenceSelectionItem(inputEl, def, name) {
        try {
            if (!inputEl) return;
            const activeInput = SchemaForm.__activeRefInput || null;
            if (activeInput !== inputEl) {
                const wrap = inputEl.closest?.('.ref-active') || null;
                if (!wrap) return;
            }
            const normalized = normalizeReferenceName(name);
            if (!normalized) return;
            const scene = this._getReferenceSelectionScene();
            if (!scene) return;
            try { console.log('[ReferenceSelection] Hover', { name: normalized }); } catch (_) { }
            try { this._ensureReferencePreviewSnapshots(inputEl, def); } catch (_) { }
            try { this._seedReferencePreviewCacheFromScene(inputEl, def, [normalized], scene); } catch (_) { }
            try { this._syncActiveReferenceSelectionPreview(inputEl, def); } catch (_) { }

            let target = null;
            try { target = scene.getObjectByName(normalized); } catch (_) { target = null; }
            if (!target) {
                const cache = this._getReferencePreviewCache(inputEl);
                const entry = cache ? cache.get(normalized) : null;
                target = entry?.object || entry || null;
            }
            if (!target) {
                try { target = scene.getObjectByName(`__refPreview__${normalized}`); } catch (_) { target = null; }
            }
            if (!target) return;
            if (!target.material && target.traverse) {
                let candidate = null;
                try {
                    target.traverse((child) => {
                        if (!child || candidate) return;
                        if (child.type === 'REF_PREVIEW_EDGE') { candidate = child; return; }
                        if (child.material) candidate = child;
                    });
                } catch (_) { }
                if (candidate) target = candidate;
            }
            try {
                console.log('[ReferenceSelection] Hover target', {
                    name: normalized,
                    target: target || null,
                    inScene: !!(target && target.parent),
                });
            } catch (_) { }
            inputEl.__refChipHoverActive = true;
            try { SelectionFilter.setHoverObject(target, { ignoreFilter: true }); } catch (_) { }
        } catch (_) { }
    }

    _clearReferenceSelectionHover(inputEl) {
        try {
            if (!inputEl || SchemaForm.__activeRefInput !== inputEl) return;
            if (!inputEl.__refChipHoverActive) return;
            inputEl.__refChipHoverActive = false;
            SelectionFilter.clearHover();
        } catch (_) { }
    }

    _activateReferenceSelection(inputEl, def) {
        // Clear any lingering scene selection so the new reference starts fresh
        try {
            const scene = this._getReferenceSelectionScene();
            if (scene) {
                SchemaForm.__setGlobalActiveRefInput(null);
                SelectionFilter.unselectAll(scene);
            }
        } catch (_) { }

        // Ensure only one control is globally marked as active
        SchemaForm.__setGlobalActiveRefInput(inputEl);

        // Also clear any duplicates within this shadow root (defensive)
        const clearLocal = (root) => {
            if (!root || typeof root.querySelectorAll !== 'function') return;
            root.querySelectorAll('[active-reference-selection="true"],[active-reference-selection=true]').forEach(el => {
                if (el !== inputEl) {
                    try { el.style.filter = 'none'; } catch (_) { }
                    try { el.removeAttribute('active-reference-selection'); } catch (_) { }
                    try {
                        const wrap = el.closest('.ref-single-wrap, .ref-multi-wrap');
                        if (wrap) wrap.classList.remove('ref-active');
                    } catch (_) { }
                }
            });
        };
        clearLocal(this._shadow);

        // Mark this control active with a recency timestamp for any external scanners
        try { inputEl.dataset.activatedAt = String(Date.now()); } catch (_) { }
        inputEl.style.filter = 'invert(1)';
        inputEl.setAttribute('active-reference-selection', 'true');
        try {
            const wrap = inputEl.closest('.ref-single-wrap, .ref-multi-wrap');
            if (wrap) wrap.classList.add('ref-active');
        } catch (_) { }

        // Apply selection filter from schema
        SelectionFilter.stashAllowedSelectionTypes();
        SelectionFilter.SetSelectionTypes(def.selectionFilter);
        try { window.__BREP_activeRefInput = inputEl; } catch (_) { }

        // Log current selected objects for this reference field on activation
        try {
            const scene = this._getReferenceSelectionScene();
            const names = this._collectReferenceSelectionNames(inputEl, def);
            const keyLabel = inputEl?.dataset?.key ? ` (${inputEl.dataset.key})` : '';
            if (!names.length) {
                console.log(`[ReferenceSelection] Activated${keyLabel}: no selections`);
            } else {
                const cache = this._getReferencePreviewCache(inputEl);
                for (const name of names) {
                    if (!name) continue;
                    const obj = scene ? scene.getObjectByName(name) : null;
                    const cached = cache ? cache.get(name) : null;
                    const cachedObj = cached && cached.object ? cached.object : null;
                    console.log(`[ReferenceSelection] Selected${keyLabel}: ${name}`, {
                        object: obj || cachedObj || null,
                        inScene: !!obj,
                        cached: !!cachedObj,
                    });
                }
            }
        } catch (_) { }

        // Highlight existing selections while this reference field is active
        try { this._syncActiveReferenceSelectionHighlight(inputEl, def); } catch (_) { }
        try { this._ensureReferencePreviewSnapshots(inputEl, def); } catch (_) { }
        try {
            if (typeof inputEl.__captureReferencePreview !== 'function') {
                inputEl.__captureReferencePreview = (obj) => this._storeReferencePreviewSnapshot(inputEl, def, obj);
            }
        } catch (_) { }
        try { this._startReferencePreviewWatcher(inputEl, def); } catch (_) { }
    }

    // Activate a TransformControls session for a transform widget
    _activateTransformWidget({ inputEl, wrapEl, key, def, valueAdapter = null }) {
        try { this._stopActiveReferenceSelection(); } catch (_) { }
        // Toggle logic: if already active for this input, stop and hide
        try {
            const s = SchemaForm.__activeXform;
            if (s && s.inputEl === inputEl) {
                const currentVal = this.params[key];
                SchemaForm.__stopGlobalActiveXform();
                this._emitParamsChange(key, currentVal);
                return;
            }
            // If a different transform is active, stop it before starting this one
            if (s && s.inputEl !== inputEl) {
                SchemaForm.__stopGlobalActiveXform();
            }
        } catch (_) { }

        const viewer = this.options?.viewer || null;
        if (!viewer || !viewer.scene || !viewer.camera || !viewer.renderer) return;

        // (Toggle handled above)

        const adapter = (valueAdapter && typeof valueAdapter === 'object') ? valueAdapter : null;
        const ensureArray3 = (arr, fallback) => {
            const out = Array.isArray(arr) ? arr.slice(0, 3) : [];
            while (out.length < 3) out.push(fallback);
            return out;
        };
        const ensureArray4 = (arr, fallback) => {
            if (Array.isArray(arr) && arr.length >= 4) {
                const vals = [];
                for (let i = 0; i < 4; i++) {
                    const n = Number(arr[i]);
                    vals.push(Number.isFinite(n) ? n : (i === 3 ? 1 : 0));
                }
                return vals;
            }
            return fallback;
        };
        const sanitizeTRS = (value) => {
            const obj = (value && typeof value === 'object') ? value : {};
            return {
                position: ensureArray3(obj.position, 0),
                rotationEuler: ensureArray3(obj.rotationEuler, 0),
                scale: ensureArray3(obj.scale, 1),
            };
        };
        const sanitizeBase = (value) => {
            const obj = (value && typeof value === 'object') ? value : {};
            const base = {
                position: ensureArray3(obj.position, 0),
                rotationEuler: ensureArray3(obj.rotationEuler, 0),
                quaternion: ensureArray4(obj.quaternion, null),
                scale: ensureArray3(obj.scale, 1),
            };
            if (!base.quaternion) {
                try {
                    const e = base.rotationEuler;
                    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                        THREE.MathUtils.degToRad(e[0] || 0),
                        THREE.MathUtils.degToRad(e[1] || 0),
                        THREE.MathUtils.degToRad(e[2] || 0),
                        'XYZ'
                    ));
                    base.quaternion = [q.x, q.y, q.z, q.w];
                } catch (_) {
                    base.quaternion = [0, 0, 0, 1];
                }
            }
            return base;
        };
        const safeNumber = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        const safeDiv = (num, denom) => {
            const d = safeNumber(denom, 1);
            if (Math.abs(d) < 1e-12) return safeNumber(num, 0);
            return safeNumber(num, 0) / d;
        };
        const readBaseValue = () => {
            if (adapter && typeof adapter.getBase === 'function') {
                try { return sanitizeBase(adapter.getBase()); } catch (_) { return sanitizeBase(null); }
            }
            return sanitizeBase(null);
        };
        const readCurrentValue = () => {
            if (adapter && typeof adapter.get === 'function') {
                try { return sanitizeTRS(adapter.get()); } catch (_) { return sanitizeTRS(null); }
            }
            return sanitizeTRS(this._pickInitialValue(key, def));
        };
        const writeCurrentValue = (next) => {
            const sanitized = sanitizeTRS(next);
            if (adapter && typeof adapter.set === 'function') {
                try { adapter.set(sanitized); } catch (_) { }
            } else {
                this.params[key] = sanitized;
            }
            return sanitized;
        };
        const base = readBaseValue();
        const cur = readCurrentValue();
        const combineWithBase = (baseTransform, deltaTransform) => {
            const basePos = new THREE.Vector3(
                safeNumber(baseTransform.position[0], 0),
                safeNumber(baseTransform.position[1], 0),
                safeNumber(baseTransform.position[2], 0),
            );
            const baseQuat = new THREE.Quaternion().fromArray(baseTransform.quaternion);
            const baseScale = new THREE.Vector3(
                safeNumber(baseTransform.scale[0], 1),
                safeNumber(baseTransform.scale[1], 1),
                safeNumber(baseTransform.scale[2], 1),
            );

            const deltaPos = new THREE.Vector3(
                safeNumber(deltaTransform.position[0], 0),
                safeNumber(deltaTransform.position[1], 0),
                safeNumber(deltaTransform.position[2], 0),
            );
            const deltaQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(safeNumber(deltaTransform.rotationEuler[0], 0)),
                THREE.MathUtils.degToRad(safeNumber(deltaTransform.rotationEuler[1], 0)),
                THREE.MathUtils.degToRad(safeNumber(deltaTransform.rotationEuler[2], 0)),
                'XYZ',
            ));
            const deltaScale = new THREE.Vector3(
                safeNumber(deltaTransform.scale[0], 1),
                safeNumber(deltaTransform.scale[1], 1),
                safeNumber(deltaTransform.scale[2], 1),
            );

            const absPos = basePos.clone().add(deltaPos);
            const absQuat = baseQuat.clone().multiply(deltaQuat);
            const absScale = baseScale.clone().multiply(deltaScale);
            return { position: absPos, quaternion: absQuat, scale: absScale };
        };
        const absolute = combineWithBase(base, cur);

        const target = new THREE.Object3D();
        try {
            target.position.copy(absolute.position);
            target.quaternion.copy(absolute.quaternion);
            target.scale.copy(absolute.scale);
        } catch (_) { }
        viewer.scene.add(target);

        const TCctor = CombinedTransformControls;
        if (!TCctor) {
            console.warn('[TransformControls] CombinedTransformControls not available; skipping gizmo.');
            return;
        }
        const tc = new TCctor(viewer.camera, viewer.renderer.domElement);
        const desiredMode = (inputEl && inputEl.dataset && inputEl.dataset.xformMode) ? String(inputEl.dataset.xformMode) : 'translate';
        const safeMode = (desiredMode === 'scale') ? 'translate' : desiredMode;
        tc.setMode(safeMode);
        // Newer three.js TransformControls emit mouseDown/mouseUp instead of dragging-changed
        let __lastCommitAt = 0;
        const commitTransform = () => {
            const now = Date.now();
            if (now - __lastCommitAt < 5) return; // dedupe if two events fire together
            __lastCommitAt = now;
            try {
                const featureID = (this.params && Object.prototype.hasOwnProperty.call(this.params, 'featureID'))
                    ? this.params.featureID
                    : (this.params?.id ?? null);
                if (typeof this.options.onChange === 'function') {
                    this.options.onChange(featureID);
                }
            } catch (_) { }
            // After history re-runs (which clears the scene), re-add the gizmo and target so it stays active
            try {
                const addBack = () => {
                    try {
                        const activeState = SchemaForm.__activeXform;
                        if (!activeState) return;
                        if (activeState.owner !== this) return;
                        if (activeState.inputEl !== inputEl) return;
                        if (activeState.key !== key) return;
                        if (adapter && typeof adapter.stepId === 'string' && activeState.stepId && activeState.stepId !== adapter.stepId) return;
                        if (!viewer || !viewer.scene) return;
                        if (!tc || typeof tc.attach !== 'function') return;
                        if (target && target.isObject3D) { try { viewer.scene.add(target); } catch (_) { } }
                        const helper = (typeof tc.getHelper === 'function') ? tc.getHelper() : null;
                        if (helper && helper.isObject3D) { try { viewer.scene.add(helper); tc.__helper = helper; } catch (_) { } }
                        else if (tc && tc.isObject3D) { try { viewer.scene.add(tc); } catch (_) { } }
                        else if (tc.__fallbackGroup && tc.__fallbackGroup.isObject3D) { try { viewer.scene.add(tc.__fallbackGroup); } catch (_) { } }
                        try { if (typeof tc.attach === 'function') tc.attach(target); } catch (_) { }
                        try {
                            const m = (typeof tc.getMode === 'function') ? tc.getMode() : (tc.mode || 'translate');
                            if (typeof tc.setMode === 'function') tc.setMode(m);
                        } catch (_) { }
                        try { viewer.render && viewer.render(); } catch (_) { }
                        try { refreshOverlay(); } catch (_) { }
                        try { updateForCamera(); } catch (_) { }
                    } catch (_) { }
                };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(addBack);
                else setTimeout(addBack, 0);
            } catch (_) { }
        };
        const markOverlay = (obj) => {
            if (!obj || !obj.isObject3D) return;
            const apply = (node) => {
                try {
                    if (!node || !node.isObject3D) return;
                    const ud = node.userData || (node.userData = {});
                    if (ud.__brepOverlayHook) return;
                    const prev = node.onBeforeRender;
                    node.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
                        try { renderer.clearDepth(); } catch (_) { }
                        if (typeof prev === 'function') {
                            prev.call(this, renderer, scene, camera, geometry, material, group);
                        }
                    };
                    ud.__brepOverlayHook = true;
                } catch (_) { }
            };
            apply(obj);
            if (typeof obj.traverse === 'function') obj.traverse((child) => apply(child));
        };

        const refreshOverlay = () => {
            try {
                markOverlay(tc);
                markOverlay(tc._gizmo);
                markOverlay(tc._helper);
                markOverlay(tc.gizmo);
                markOverlay(tc.helper);
                markOverlay(tc.__helper);
                markOverlay(tc.__fallbackGroup);
            } catch (_) { }
        };

        const updateForCamera = () => {
            try {
                if (typeof tc.update === 'function') tc.update();
                else tc.updateMatrixWorld(true);
            } catch (_) { }
            refreshOverlay();
        };
        try { updateForCamera(); } catch (_) { }
        try {
            if (viewer?.controls && typeof viewer.controls.addEventListener === 'function') {
                viewer.controls.addEventListener('change', updateForCamera);
            }
        } catch (_) { }

        try { tc.addEventListener('mouseDown', () => { try { if (viewer.controls) viewer.controls.enabled = false; } catch (_) { } refreshOverlay(); }); } catch (_) { }
        try { tc.addEventListener('mouseUp', () => { try { if (viewer.controls) viewer.controls.enabled = true; } catch (_) { } commitTransform(); refreshOverlay(); }); } catch (_) { }
        // Backward/compat: older builds fire dragging-changed
        try {
            tc.addEventListener('dragging-changed', (ev) => {
                try { if (viewer.controls) viewer.controls.enabled = !ev.value; } catch (_) { }
                if (!ev.value) commitTransform();
                refreshOverlay();
            });
        } catch (_) { }

        const updateParamFromTarget = () => {
            const basePosVec = new THREE.Vector3(
                safeNumber(base.position[0], 0),
                safeNumber(base.position[1], 0),
                safeNumber(base.position[2], 0),
            );
            const relPosVec = new THREE.Vector3(target.position.x, target.position.y, target.position.z).sub(basePosVec);

            const baseQuatObj = new THREE.Quaternion().fromArray(base.quaternion);
            const relQuat = baseQuatObj.clone().invert().multiply(target.quaternion.clone());
            const relEuler = new THREE.Euler().setFromQuaternion(relQuat, 'XYZ');

            const baseScaleVec = new THREE.Vector3(
                safeNumber(base.scale[0], 1),
                safeNumber(base.scale[1], 1),
                safeNumber(base.scale[2], 1),
            );
            const relScaleVec = new THREE.Vector3(
                safeDiv(target.scale.x, baseScaleVec.x),
                safeDiv(target.scale.y, baseScaleVec.y),
                safeDiv(target.scale.z, baseScaleVec.z),
            );

            const next = {
                position: [relPosVec.x, relPosVec.y, relPosVec.z],
                rotationEuler: [
                    THREE.MathUtils.radToDeg(relEuler.x),
                    THREE.MathUtils.radToDeg(relEuler.y),
                    THREE.MathUtils.radToDeg(relEuler.z)
                ],
                scale: [relScaleVec.x, relScaleVec.y, relScaleVec.z],
            };
            const stored = writeCurrentValue(next);
            if (!adapter) {
                try {
                    const row = this._fieldsWrap.querySelector(`[data-key="${key}"]`);
                    const info = row ? row.querySelector('.transform-info') : null;
                    if (info) {
                        const fmt = (n) => {
                            const x = Number(n);
                            if (!Number.isFinite(x)) return '0';
                            const a = Math.abs(x);
                            const prec = a >= 100 ? 0 : (a >= 10 ? 1 : 2);
                            return String(x.toFixed(prec));
                        };
                        info.textContent = `pos(${fmt(stored.position[0])}, ${fmt(stored.position[1])}, ${fmt(stored.position[2])})  rot(${fmt(stored.rotationEuler[0])}, ${fmt(stored.rotationEuler[1])}, ${fmt(stored.rotationEuler[2])})`;
                    }
                    try {
                        const pairs = [
                            ['.tf-pos-x', stored.position[0]],
                            ['.tf-pos-y', stored.position[1]],
                            ['.tf-pos-z', stored.position[2]],
                            ['.tf-rot-x', stored.rotationEuler[0]],
                            ['.tf-rot-y', stored.rotationEuler[1]],
                            ['.tf-rot-z', stored.rotationEuler[2]],
                        ];
                        for (const [sel, val] of pairs) {
                            const el = row ? row.querySelector(sel) : null;
                            if (el) this._setInputValue(el, 'number', val);
                        }
                    } catch (_) { }
                } catch (_) { }
            }
        };
        tc.addEventListener('change', (ev) => { updateParamFromTarget(ev); refreshOverlay(); });
        // Fallback commit for cases where mouseUp/dragging-changed are unreliable (some builds)
        try { tc.addEventListener('objectChange', () => { try { if (!tc.dragging) commitTransform(); } catch (_) { } refreshOverlay(); }); } catch (_) { }

        // Expose an isOver helper for Viewer to suppress its own handlers when interacting with gizmo
        const isOver = (ev) => {
            try {
                const canvas = viewer.renderer.domElement;
                const rect = canvas.getBoundingClientRect();
                const x = (ev.clientX - rect.left) / rect.width; // 0..1
                const y = (ev.clientY - rect.top) / rect.height; // 0..1
                // Use viewer helper for consistent NDC mapping
                const ndc = (typeof viewer._getPointerNDC === 'function')
                    ? viewer._getPointerNDC({ clientX: ev.clientX, clientY: ev.clientY })
                    : new THREE.Vector2(x * 2 - 1, -(y * 2 - 1));
                viewer.raycaster.setFromCamera(ndc, viewer.camera);
                // Prefer precise picker meshes for the current mode; fallback to whole gizmo
                const mode = (typeof tc.getMode === 'function') ? tc.getMode() : (tc.mode || desiredMode || 'translate');
                const giz = tc._gizmo || tc.gizmo || null;
                const pick = (giz && giz.picker) ? (giz.picker[mode] || giz.picker.translate || giz.picker.rotate) : null;
                const pickRoot = pick || giz || tc.__fallbackGroup || null;
                if (!pickRoot) return false;
                const hits = viewer.raycaster.intersectObject(pickRoot, true) || [];
                return hits.length > 0;
            } catch (_) { return false; }
        };
        try {
            window.__BREP_activeXform = {
                controls: tc,
                viewer,
                isOver,
                target,
                group: tc.__fallbackGroup || (tc && tc.isObject3D ? tc : null),
                updateForCamera,
            };
        } catch (_) { }

        let addedToScene = false;
        try { markOverlay(tc._gizmo); } catch (_) { }
        try { markOverlay(tc._helper); } catch (_) { }
        try { markOverlay(tc.gizmo); } catch (_) { }
        try { markOverlay(tc.helper); } catch (_) { }

        try {
            // Preferred modern API: helper root on the controls
            const helper = (typeof tc.getHelper === 'function') ? tc.getHelper() : null;
            if (helper && helper.isObject3D) {
                try { helper.userData = helper.userData || {}; helper.userData.excludeFromFit = true; } catch (_) { }
                markOverlay(helper);
                viewer.scene.add(helper); addedToScene = true; tc.__helper = helper;
            }
            else if (tc && tc.isObject3D) {
                try { tc.userData = tc.userData || {}; tc.userData.excludeFromFit = true; } catch (_) { }
                markOverlay(tc);
                viewer.scene.add(tc); addedToScene = true;
            }
        } catch (_) { /* tolerate builds where controls aren't Object3D */ }
        if (!addedToScene) {
            // Fallback: try adding known internal object3D parts if present
            try {
                const group = new THREE.Group();
                group.name = 'TransformControlsGroup';
                const candidates = [tc?.gizmo, tc?._gizmo, tc?.picker, tc?._picker, tc?.helper, tc?._helper];
                let attached = 0;
                for (const cand of candidates) {
                    if (cand && cand.isObject3D) { try { group.add(cand); attached++; } catch (_) { } }
                }
                if (attached > 0) {
                    try { group.userData = group.userData || {}; group.userData.excludeFromFit = true; } catch (_) { }
                    markOverlay(group);
                    viewer.scene.add(group); addedToScene = true; tc.__fallbackGroup = group;
                }
            } catch (_) { /* ignore */ }
            if (!addedToScene) {
                // eslint-disable-next-line no-console
                console.warn('[TransformControls] Could not add gizmo to scene (no Object3D found).');
            }
        }
        try { tc.showX = true; tc.showY = true; tc.showZ = true; } catch (_) { }
        try { tc.setSpace('world'); } catch (_) { }
        try { tc.addEventListener('change', () => { try { viewer.render(); } catch (_) { } }); } catch (_) { }
        try { tc.attach(target); markOverlay(tc); markOverlay(tc.__helper); markOverlay(tc.__fallbackGroup); } catch (_) { }

        // Mark active
        inputEl.setAttribute('active-transform', 'true');
        try { wrapEl.classList.add('ref-active'); } catch (_) { }

        SchemaForm.__activeXform = {
            owner: this,
            key,
            stepId: adapter && typeof adapter.stepId === 'string' ? adapter.stepId : null,
            inputEl,
            wrapEl,
            target,
            controls: tc,
            viewer,
            group: tc.__fallbackGroup || (tc && tc.isObject3D ? tc : null),
            captureHandlers: null,
            controlsChangeHandler: updateForCamera,
            valueAdapter: adapter || null,
            baseTransform: base,
        };

        // Install capture-phase listeners to disable ArcballControls early when pressing gizmo
        try {
            const canvas = viewer && viewer.renderer ? viewer.renderer.domElement : null;
            if (canvas && typeof canvas.addEventListener === 'function') {
                const onDownCapture = (ev) => {
                    try {
                        if (isOver(ev)) {
                            if (viewer && viewer.controls) viewer.controls.enabled = false;
                        }
                    } catch (_) { }
                };
                const onUpCapture = (ev) => {
                    // Re-enable controls on pointer release to be safe
                    try { if (viewer && viewer.controls) viewer.controls.enabled = true; } catch (_) { }
                    void ev;
                };
                canvas.addEventListener('pointerdown', onDownCapture, { passive: true, capture: true });
                // Use window to ensure we catch release even if released off-canvas
                window.addEventListener('pointerup', onUpCapture, { passive: true, capture: true });
                SchemaForm.__activeXform.captureHandlers = { canvas, win: window, onDownCapture, onUpCapture };
            }
        } catch (_) { /* ignore */ }
    }

    _stopActiveTransformWidget() {
        try { SchemaForm.__stopGlobalActiveXform(); } catch (_) { }
    }


    _stopActiveReferenceSelection() {
        // Clear global active if it belongs to this instance
        const activeInput = SchemaForm.__activeRefInput || null;
        try {
            if (activeInput) {
                try { activeInput.style.filter = 'none'; } catch (_) { }
                try { activeInput.removeAttribute('active-reference-selection'); } catch (_) { }
                try {
                    const wrap = activeInput.closest('.ref-single-wrap, .ref-multi-wrap');
                    if (wrap) wrap.classList.remove('ref-active');
                } catch (_) { }
            }
        } catch (_) { }
        const hadActive = !!activeInput;
        try {
            if (activeInput && typeof activeInput.__refPreviewCleanup === 'function') {
                activeInput.__refPreviewCleanup();
            } else if (activeInput) {
                this._removeReferencePreviewGroup(activeInput);
            }
        } catch (_) { }
        SchemaForm.__activeRefInput = null;
        try { if (window.__BREP_activeRefInput === undefined || window.__BREP_activeRefInput === SchemaForm.__activeRefInput) window.__BREP_activeRefInput = null; } catch (_) { }
        if (hadActive) {
            try {
                const scene = this._getReferenceSelectionScene();
                if (scene) SelectionFilter.unselectAll(scene);
            } catch (_) { }
        }
        SelectionFilter.restoreAllowedSelectionTypes();
    }

    _renderChips(chipsWrap, key, values) {
        chipsWrap.textContent = '';
        const arr = Array.isArray(values) ? values : [];
        const normalizedValues = normalizeReferenceList(arr);
        let inputEl = (this._inputs && typeof this._inputs.get === 'function') ? this._inputs.get(key) : null;
        const resolveInput = () => {
            if (inputEl) return inputEl;
            const wrap = chipsWrap?.closest?.('.ref-multi-wrap, .ref-single-wrap') || null;
            const hidden = wrap ? wrap.querySelector('input[type="hidden"]') : null;
            if (hidden) inputEl = hidden;
            return inputEl;
        };
        const resolveDef = () => {
            const el = resolveInput();
            return (el && el.__refSelectionDef) || (this.schema ? (this.schema[key] || null) : null);
        };
        const def = resolveDef();
        if (chipsWrap && !chipsWrap.__refHoverBound) {
            chipsWrap.__refHoverBound = true;
            chipsWrap.__refHoverName = null;
            chipsWrap.addEventListener('mousemove', (ev) => {
                try {
                    const chip = ev.target?.closest?.('.ref-chip');
                    const refName = chip?.dataset?.refName || null;
                    if (!refName) {
                        chipsWrap.__refHoverName = null;
                        this._clearReferenceSelectionHover(resolveInput());
                        return;
                    }
                    if (chipsWrap.__refHoverName === refName) return;
                    chipsWrap.__refHoverName = refName;
                    this._hoverReferenceSelectionItem(resolveInput(), resolveDef(), refName);
                } catch (_) { }
            });
            chipsWrap.addEventListener('mouseleave', () => {
                chipsWrap.__refHoverName = null;
                this._clearReferenceSelectionHover(resolveInput());
            });
        }
        if (inputEl) {
            if (typeof inputEl.__updateSelectionMetadata === 'function') {
                try { inputEl.__updateSelectionMetadata(normalizedValues); } catch (_) { }
            } else if (inputEl.dataset && inputEl.dataset.multiple === 'true') {
                try { inputEl.dataset.selectedCount = String(normalizedValues.length); } catch (_) { }
                try { inputEl.dataset.selectedValues = JSON.stringify(normalizedValues); } catch (_) { }
            }
        }
        if (Array.isArray(this.params[key])) {
            this.params[key] = normalizedValues;
        } else if (this.params[key] && typeof this.params[key] === 'object' && Array.isArray(this.params[key].targets)) {
            this.params[key].targets = normalizedValues;
        }
        for (const name of normalizedValues) {
            const chip = document.createElement('span');
            chip.className = 'ref-chip';
            try { chip.dataset.refName = name; } catch (_) { }

            const label = document.createElement('span');
            label.className = 'ref-chip-label';
            label.textContent = name;
            chip.appendChild(label);

            // Hover highlight on chip hover
            chip.addEventListener('mouseenter', () => {
                const liveInput = resolveInput();
                const liveDef = resolveDef();
                if (liveDef && liveDef.type === 'reference_selection') {
                    this._hoverReferenceSelectionItem(liveInput, liveDef, name);
                    return;
                }
                try { SelectionFilter.setHoverByName(this.options?.scene || null, name); } catch (_) { }
            });
            chip.addEventListener('mouseleave', () => {
                const liveInput = resolveInput();
                const liveDef = resolveDef();
                if (liveDef && liveDef.type === 'reference_selection') {
                    this._clearReferenceSelectionHover(liveInput);
                    return;
                }
                try { SelectionFilter.clearHover(); } catch (_) { }
            });

            const btn = document.createElement('span');
            btn.className = 'ref-chip-remove';
            btn.textContent = '✕';
            btn.title = 'Remove';
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                // Support both plain array params and object-with-targets
                let currentArrayRef = null;
                if (Array.isArray(this.params[key])) {
                    currentArrayRef = this.params[key];
                } else if (this.params[key] && typeof this.params[key] === 'object' && Array.isArray(this.params[key].targets)) {
                    currentArrayRef = this.params[key].targets;
                } else {
                    // Initialize as array if nothing sensible exists
                    this.params[key] = [];
                    currentArrayRef = this.params[key];
                }
                const idx = currentArrayRef.indexOf(name);
                if (idx >= 0) currentArrayRef.splice(idx, 1);
                this._renderChips(chipsWrap, key, currentArrayRef);
                this._emitParamsChange(key, this.params[key]);
                try {
                    if (typeof this.options.onReferenceChipRemove === 'function') {
                        this.options.onReferenceChipRemove(name, key);
                    }
                } catch (_) { }
            });
            chip.appendChild(btn);

            chipsWrap.appendChild(chip);
        }
        if (normalizedValues.length === 0) {
            const hint = document.createElement('span');
            hint.className = 'ref-chip';
            hint.style.opacity = '0.6';
            let hintText = 'Click then pick items in scene';
            if (inputEl && inputEl.dataset) {
                const minAttr = Number(inputEl.dataset.minSelections);
                if (Number.isFinite(minAttr) && minAttr > 0) {
                    hintText = `Select at least ${minAttr} item${minAttr === 1 ? '' : 's'}`;
                }
            }
            hint.textContent = hintText;
            chipsWrap.appendChild(hint);
        } else if (inputEl && inputEl.dataset) {
            const minAttr = Number(inputEl.dataset.minSelections);
            if (Number.isFinite(minAttr) && minAttr > 0 && normalizedValues.length < minAttr) {
                const hint = document.createElement('span');
                hint.className = 'ref-chip';
                hint.style.opacity = '0.6';
                hint.textContent = `Need ${minAttr - normalizedValues.length} more`;
                chipsWrap.appendChild(hint);
            }
        }

        try {
            if (inputEl && inputEl === SchemaForm.__activeRefInput) {
                const def = (inputEl && inputEl.__refSelectionDef) || (this.schema ? (this.schema[key] || {}) : null);
                this._syncActiveReferenceSelectionHighlight(inputEl, def);
            }
        } catch (_) { }
    }

    _emitParamsChange(key, value) {
        // Suppress auto-run if a transform editing session is active on this form
        try {
            const s = SchemaForm.__activeXform;
            if (s && s.owner === this) return;
        } catch (_) { }
        if (typeof this.options.onChange === 'function') {
            const featureID = (this.params && Object.prototype.hasOwnProperty.call(this.params, 'featureID'))
                ? this.params.featureID
                : (this.params?.id ?? null);
            const details = { key, value, params: this.params, form: this };
            try {
                this.options.onChange(featureID, details);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.log(error);
            }
        }
    }

    _pickInitialValue(key, def) {
        if (this.params[key] !== undefined && this.params[key] !== null) return this.params[key];
        if (Object.prototype.hasOwnProperty.call(def, 'default_value')) return def.default_value;
        return this._defaultForType(def.type);
    }

    _defaultForType(type) {
        switch (type) {
            case 'boolean': return false;
            case 'options': return '';
            case 'reference_selection': return null;
            case 'transform': return { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] };
            case 'vec3': return [0, 0, 0];
            default: return '';
        }
    }

    _setInputValue(el, type, value) {
        switch (type) {
            case 'boolean':
                el.checked = Boolean(value);
                break;
            case 'number': {
                // Accept formulas or plain numbers. If the value is not purely numeric,
                // render the input as text so the expression is visible. Some inputs
                // force text rendering to avoid type switching.
                const rawStr = value == null ? '' : String(value);
                const numericLike = /^\s*[-+]?((\d+(?:\.\d*)?)|(\.\d+))(?:[eE][-+]?\d+)?\s*$/.test(rawStr);
                const forceText = el && el.dataset && el.dataset.forceText === 'true';
                try {
                    if (!forceText && numericLike) {
                        if (el.type !== 'number') el.type = 'number';
                        // Re-apply numeric attributes if we previously toggled away
                        if (el.dataset && el.dataset.step) el.step = el.dataset.step;
                        if (el.dataset && el.dataset.min) el.min = el.dataset.min;
                        if (el.dataset && el.dataset.max) el.max = el.dataset.max;
                    } else {
                        if (el.type !== 'text') el.type = 'text';
                    }
                } catch (_) { /* ignore */ }
                // Limit programmatically-set numeric text to 6 decimal places.
                const format6 = (v) => {
                    let n = Number(v);
                    if (!Number.isFinite(n)) return rawStr;
                    if (Math.abs(n) < 1e-12) n = 0; // avoid tiny scientific notation
                    let s = n.toFixed(6);
                    s = s.replace(/\.0+$/, ''); // trim trailing .000000
                    s = s.replace(/(\.\d*?[1-9])0+$/, '$1'); // trim trailing zeros
                    if (s === '-0') s = '0';
                    return s;
                };
                el.value = numericLike ? format6(value) : rawStr;
                break;
            }
            case 'options': {
                const asStr = String(value == null ? '' : value);
                let has = false;
                for (let i = 0; i < el.options.length; i++) {
                    if (el.options[i].value === asStr) { has = true; break; }
                }
                el.value = has ? asStr : (el.options[0] ? el.options[0].value : '');
                break;
            }
            case 'file': {
                // Update the info label adjacent to the button
                try {
                    const wrap = el && el.parentNode ? el.parentNode : null;
                    const info = wrap ? wrap.querySelector('.file-info') : null;
                    if (info) {
                        if (typeof value === 'string' && value.startsWith('data:') && value.includes(';base64,')) {
                            const b64 = value.split(',')[1] || '';
                            const size = Math.floor((b64.length * 3) / 4);
                            info.textContent = `Loaded (${size} bytes)`;
                        } else if (value && String(value).length) {
                            info.textContent = `Loaded (${String(value).length} chars)`;
                        } else {
                            info.textContent = 'No file selected';
                        }
                    }
                } catch (_) { }
                break;
            }
            default:
                el.value = value == null ? '' : String(value);
                break;
        }
    }

    _prettyLabel(key) {
        const withSpaces = String(key)
            .replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim();
        return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
    }

    _makeStyle() {
        const style = document.createElement('style');
        style.textContent = `
      :host, .schema-form-host, .panel {
        --bg: #0f1117;
        --bg-elev: #12141b;
        --border: #262b36;
        --text: #e6e6e6;
        --muted: #9aa4b2;
        --accent: #6ea8fe;
        --focus: #3b82f6;
        --input-bg: #0b0e14;
        --radius: 12px;
        --gap: 3px;
        color-scheme: dark;
      }

      .panel {
        color: var(--text);
        background: transparent;
        border-radius: var(--radius);
        max-width: 100%;
      }

      .fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .field-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
      }

      .label {
        color: var(--muted);
      }

      .control-wrap { display: flex; flex-direction: column; gap: 6px; }

      .input, .select {
   
        background: var(--input-bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
        outline: none;
        transition: border-color .15s ease, box-shadow .15s ease;
        width: 100%;
        box-sizing: border-box;
      }
      .number-input-wrap {
        position: relative;
        width: 100%;
      }
      .number-input {
        padding-right: 36px;
      }
      .number-stepper {
        position: absolute;
        top: 4px;
        bottom: 4px;
        right: 4px;
        width: 26px;
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        background: rgba(255,255,255,.02);
      }
      .number-stepper-btn {
        appearance: none;
        border: 0;
        padding: 0;
        margin: 0;
        background: transparent;
        cursor: pointer;
        flex: 1 1 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .number-stepper-btn::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
      }
      .number-stepper-up { border-bottom: 1px solid var(--border); }
      .number-stepper-up::before { border-bottom: 6px solid var(--muted); }
      .number-stepper-down::before { border-top: 6px solid var(--muted); }
      .number-stepper-up:hover::before { border-bottom-color: var(--text); }
      .number-stepper-down:hover::before { border-top-color: var(--text); }
      .number-stepper-btn:active { background: rgba(255,255,255,.06); }
      textarea.input {
        resize: vertical;
        line-height: 1.4;
        min-height: 72px;
        font-family: inherit;
      }
      .btn {
        appearance: none;
        background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        transition: border-color .15s ease, box-shadow .15s ease, transform .05s ease;
      }
      .btn.btn-slim { padding: 6px 10px; border-radius: 8px; font-size: 12px; }
      .btn.selected { border-color: var(--focus); color: #fff; }
      .btn:hover { border-color: var(--focus); box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
      .btn:active { transform: translateY(1px); }
      .input:focus, .select:focus {
        border-color: var(--focus);
        
      }
      .file-info { font-size: 12px; color: var(--muted); }

      .checkbox {
        width: 18px; height: 18px;
        accent-color: var(--accent);
      }

      .ref-select-placeholder {
        min-height: 36px;
        border: 1px dashed var(--border);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
      }
      /* Single reference display (replaces textbox) */
      .ref-single-wrap { display: block; }
      .ref-single-display {
        appearance: none;
        background: var(--input-bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
        outline: none;
        cursor: pointer;
        user-select: none;
        min-height: 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ref-single-label { flex: 1 1 auto; overflow-wrap: anywhere; text-align: left; }
      /* Active highlight for ref widgets */
      .ref-single-wrap.ref-active .ref-single-display,
      .ref-multi-wrap.ref-active .ref-chips {
        border-color: var(--focus);
        box-shadow: 0 0 0 3px rgba(59,130,246,.15);
      }
      /* Multi reference chips */
      .ref-multi-wrap { display: flex; flex-direction: column; gap: 6px; }
      .ref-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px; border: 1px dashed var(--border); border-radius: 10px; cursor: pointer; background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01)); max-width: 100%; }
      .ref-multi-wrap.ref-limit-reached .ref-chips { border-color: #f97316; animation: refLimitPulse 0.48s ease; }
      @keyframes refLimitPulse {
        0% { box-shadow: 0 0 0 0 rgba(249,115,22,0.32); }
        100% { box-shadow: 0 0 0 12px rgba(249,115,22,0); }
      }
      .ref-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; background: #1a2030; border: 1px solid var(--border); font-size: 12px; max-width: 100%; }
      .ref-chip-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; white-space: normal; }
      .ref-chip-remove { color: var(--muted); cursor: pointer; flex: 0 0 auto; }
      .ref-chip-remove:hover { color: var(--danger); }

      /* Transform widget */
      .transform-wrap { display: flex; flex-direction: column; gap: 8px; }
      .transform-modes { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .transform-info { font-size: 12px; color: var(--muted); }
      .transform-details { display: none; }
      .transform-wrap.ref-active .transform-details { display: block; }
      .transform-grid { display: flex; flex-direction: column; gap: 6px; }
      .transform-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; }
      .transform-label { color: var(--muted); font-size: 12px; }
      .transform-inputs { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 6px; }
      .transform-input { padding: 6px 8px; }
      .transform-wrap.ref-active .btn { border-color: var(--focus); box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

      .multi-transform-wrap { display: flex; flex-direction: column; gap: 10px; }
      .mt-list { display: flex; flex-direction: column; gap: 10px; }
      .mt-item { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid var(--border); background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)); }
      .mt-item-header { display: flex; justify-content: space-between; align-items: center; font-weight: 500; }
      .mt-item-actions { display: inline-flex; gap: 4px; }
      .mt-item-actions .btn-icon { font-size: 12px; line-height: 1; padding: 4px 6px; }
      .mt-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; }
      .mt-row-label { font-size: 12px; color: var(--muted); }
      .mt-row-inputs { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 6px; }
      .mt-number { padding: 6px 8px; }
      .control-placeholder { padding: 8px; font-size: 12px; color: var(--muted); border: 1px dashed var(--border); border-radius: 10px; background: rgba(15,23,42,0.35); }
    `;
        return style;
    }
}

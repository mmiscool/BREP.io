import * as THREE from 'three';

import { SelectionFilter } from '../SelectionFilter.js';
import { debugLog } from './debug.js';

export const selectionMethods: any = {
    _getPointerNDC(event: any) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        // Convert to NDC (-1..1)
        return new THREE.Vector2(x * 2 - 1, -(y * 2 - 1));
    },

    _isEventOverRenderer(event: any) {
        if (!event || !this.renderer?.domElement) return false;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = event.clientX;
        const y = event.clientY;
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    },

    _mapIntersectionToTarget(intersection: any, options: any = {}) {
        if (!intersection || !intersection.object) return null;
        const { allowAnyAllowedType = false, ignoreSelectionFilter = false } = options;
        const isAllowed = (type) => {
            if (!type) return false;
            if (ignoreSelectionFilter) return true;
            if (allowAnyAllowedType && typeof SelectionFilter.matchesAllowedType === 'function') {
                return SelectionFilter.matchesAllowedType(type);
            }
            if (typeof SelectionFilter.IsAllowed === 'function') {
                return SelectionFilter.IsAllowed(type);
            }
            return true;
        };

        // Prefer the intersected object if it is clickable
        let obj = intersection.object;
        if (obj && obj.type === 'POINTS' && obj.parent && String(obj.parent.type || '').toUpperCase() === SelectionFilter.VERTEX) {
            obj = obj.parent;
        }

        // If the object (or its ancestors) doesn't expose onClick, climb to one that does
        let target = obj;
        while (target && typeof target.onClick !== 'function' && target.visible) target = target.parent;
        if (!target) target = obj;
        if (!target) return null;

        // Respect selection filter: ensure target is a permitted type, or ALL
        if (typeof isAllowed === 'function') {
            // Allow selecting already-selected items regardless (toggle off), consistent with SceneListing
            if (!isAllowed(target.type) && !target.selected) {
                // Try to find a closer ancestor of allowed type
                // Ascend first (e.g., FACE hit while EDGE is active should try parent SOLID only if allowed)
                let t = target.parent;
                while (t && !isAllowed(t.type)) t = t.parent;
                if (t && isAllowed(t.type)) target = t;
                else return null;
            }
        }
        return target;
    },

    _pickAtEvent(event: any, options: any = {}) {
        const { collectAll = false, allowAnyAllowedType = false, ignoreSelectionFilter = false } = options;
        // While Sketch Mode is active, suppress normal scene picking
        // SketchMode3D manages its own picking for sketch points/curves and model edges.
        if (this._sketchMode) return collectAll ? { hit: null, target: null, candidates: [] } : { hit: null, target: null };

        // Auto-clear stale spline mode so normal picking resumes after leaving the spline dialog
        if (this._splineMode) {
            try {
                const validSession = typeof this._splineMode.isActive === 'function';
                const stillActive = validSession ? this._splineMode.isActive() : false;
                if (!validSession || !stillActive) {
                    this.endSplineMode();
                }
            } catch {
                this.endSplineMode();
            }
        }

        // In spline mode, allow picking only spline vertices, suppress other scene picking
        if (this._splineMode) {
            if (!event) return collectAll ? { hit: null, target: null, candidates: [] } : { hit: null, target: null };
            const ndc = this._getPointerNDC(event);
            try { this.camera.updateMatrixWorld(true); } catch { /* ignore */ }
            try { this.camera.updateProjectionMatrix?.(); } catch { /* ignore */ }
            this.raycaster.setFromCamera(ndc, this.camera);
            // Set up raycaster params for vertex picking
            try {
                const rect = this.renderer.domElement.getBoundingClientRect();
                const wpp = this._worldPerPixel(this.camera, rect.width, rect.height);
                this.raycaster.params.Points = this.raycaster.params.Points || {};
                this.raycaster.params.Points.threshold = Math.max(0.05, wpp * 6);
                this.raycaster.params.Line = this.raycaster.params.Line || {};
                this.raycaster.params.Line.threshold = Math.max(0.05, wpp * 6);
                const dpr = (window.devicePixelRatio || 1);
                this.raycaster.params.Line2 = this.raycaster.params.Line2 || {};
                this.raycaster.params.Line2.threshold = Math.max(1, 2 * dpr);
            } catch { /* ignore selection fallback failures */ }
            // Keep spline-mode ray origin behavior consistent with normal picking.
            try {
                const ray = this.raycaster.ray;
                const dir = ray.direction.clone().normalize();
                const span = Math.max(
                    1,
                    Math.abs(this.camera.far || 0),
                    Math.abs(this.camera.near || 0),
                    this.viewSize * 40
                );
                ray.origin.addScaledVector(dir, -span);
            } catch { /* ignore selection fallback failures */ }

            // Only intersect spline vertices
            const intersects = this._withDoubleSidedPicking(() => this.raycaster.intersectObjects(this.scene.children, true));
            const splineCandidates = [];
            const splineCategory = (obj) => {
                const ud = obj?.userData || {};
                // Prioritize control-point balls first, then cage lines, then cage quads.
                if (ud.isSplineVertex) return 0;
                if (ud.isPortChild) return 1;
                if (ud.nurbsCageSegment) return 1;
                if (ud.nurbsCageQuad) return 2;
                return 3;
            };
            for (const it of intersects) {
                if (!it || !it.object) continue;
                if (!(it.object.userData?.isSplineVertex || it.object.userData?.isSplineWeight || it.object.userData?.isPortChild)) continue;
                const target = it.object;
                if (typeof target.onClick !== 'function') continue;
                splineCandidates.push({
                    hit: it,
                    target,
                    category: splineCategory(target),
                    distance: Number.isFinite(it.distance) ? it.distance : Infinity,
                });
            }
            if (splineCandidates.length) {
                splineCandidates.sort((a, b) => {
                    if (a.category !== b.category) return a.category - b.category;
                    const d = a.distance - b.distance;
                    if (Math.abs(d) > 1e-7) return d;
                    const ap = a.target?.userData?.isSplineVertex ? 0 : 1;
                    const bp = b.target?.userData?.isSplineVertex ? 0 : 1;
                    return ap - bp;
                });
                const best = splineCandidates[0];
                return { hit: best.hit, target: best.target };
            }
            return collectAll ? { hit: null, target: null, candidates: [] } : { hit: null, target: null };
        }

        if (!event) return collectAll ? { hit: null, target: null, candidates: [] } : { hit: null, target: null };
        const ndc = this._getPointerNDC(event);
        try { this.camera.updateMatrixWorld(true); } catch { /* ignore */ }
        this.raycaster.setFromCamera(ndc, this.camera);
        // Tune line picking thresholds per-frame based on zoom and DPI
        try {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const wpp = this._worldPerPixel(this.camera, rect.width, rect.height);
            this.raycaster.params.Line = this.raycaster.params.Line || {};
            this.raycaster.params.Line.threshold = Math.max(0.05, wpp * 6);
            const dpr = (window.devicePixelRatio || 1);
            this.raycaster.params.Line2 = this.raycaster.params.Line2 || {};
            this.raycaster.params.Line2.threshold = Math.max(1, 2 * dpr);
            // Improve point picking tolerance using world-units per pixel
            this.raycaster.params.Points = this.raycaster.params.Points || {};
            this.raycaster.params.Points.threshold = Math.max(0.05, wpp * 6);
        } catch { /* ignore selection fallback failures */ }
        // Fix ray origin - ensure it starts from behind the camera for large scenes
        try {
            const ray = this.raycaster.ray;
            const dir = ray.direction.clone().normalize();
            const span = Math.max(
                1,
                Math.abs(this.camera.far || 0),
                Math.abs(this.camera.near || 0),
                this.viewSize * 40
            );
            ray.origin.addScaledVector(dir, -span);
        } catch { /* ignore selection fallback failures */ }
        // Intersect everything; raycaster will skip non-geometry nodes
        const intersects = this._withDoubleSidedPicking(() => this.raycaster.intersectObjects(this.scene.children, true));

        // DEBUG: Log all objects under mouse pointer in normal mode
        if (intersects.length > 0) {
            debugLog(`NORMAL MODE CLICK DEBUG:`);
            debugLog(`- Mouse NDC: (${ndc.x.toFixed(3)}, ${ndc.y.toFixed(3)})`);
            debugLog(`- Total intersections found: ${intersects.length}`);
        }

        const candidates = [];
        for (const it of intersects) {
            // skip entities that are not visible (or have invisible parents)
            if (!it || !it.object) continue;
            const testVisible = (obj) => {
                if (obj.parent === null) {
                    return true;
                }
                if (obj.visible === false) return false;
                return testVisible(obj.parent);
            }

            const visibleResult = testVisible(it.object);

            if (visibleResult) {

                const target = this._mapIntersectionToTarget(it, { allowAnyAllowedType, ignoreSelectionFilter });
                if (target) {
                    if (collectAll) {
                        candidates.push({ hit: it, target, distance: it.distance ?? Infinity });
                        continue;
                    }
                    return { hit: it, target };
                }
            }



        }
        if (collectAll) {
            return {
                hit: candidates[0]?.hit || null,
                target: candidates[0]?.target || null,
                candidates,
            };
        }
        return { hit: null, target: null };
    },

    // Three's Line2 raycast expects a live material.resolution; cloned or restored
    // sketch edge materials can miss it until the next resize/render sync.
    _syncLineMaterialResolutionForPicking() {
        if (!this.scene || typeof this.scene.traverse !== 'function') return;
        const rect = this.renderer?.domElement?.getBoundingClientRect?.();
        const width = Math.max(1, Math.floor(rect?.width || this.renderer?.domElement?.clientWidth || 1));
        const height = Math.max(1, Math.floor(rect?.height || this.renderer?.domElement?.clientHeight || 1));
        const syncMaterial = (mat) => {
            if (!mat) return;
            let resolution = null;
            try { resolution = mat.resolution || null; } catch { resolution = null; }
            if (!resolution && mat.uniforms?.resolution?.value) {
                resolution = mat.uniforms.resolution.value;
                try { mat.resolution = resolution; } catch { /* ignore selection fallback failures */ }
            }
            if (resolution && typeof resolution.set === 'function') {
                try { resolution.set(width, height); } catch { /* ignore selection fallback failures */ }
                return;
            }
            if (resolution && Number.isFinite(resolution.width) && Number.isFinite(resolution.height)) {
                try {
                    resolution.width = width;
                    resolution.height = height;
                } catch { /* ignore selection fallback failures */ }
                return;
            }
            try { mat.resolution = new THREE.Vector2(width, height); } catch { /* ignore selection fallback failures */ }
        };
        this.scene.traverse((obj) => {
            if (!obj || (!obj.isLine2 && !obj.isLineSegments2)) return;
            const mat = obj.material;
            if (Array.isArray(mat)) mat.forEach(syncMaterial);
            else syncMaterial(mat);
        });
    },

    // Temporarily make FrontSide materials DoubleSide for picking without changing render appearance.
    _withDoubleSidedPicking(fn) {
        if (!fn) return null;
        const touched = new Set<any>();
        const markMaterial = (mat: any) => {
            if (!mat || typeof mat.side === 'undefined') return;
            if (mat.side === THREE.FrontSide) {
                touched.add(mat);
                mat.side = THREE.DoubleSide;
            }
        };
        try {
            this._syncLineMaterialResolutionForPicking();
            if (this.scene && typeof this.scene.traverse === 'function') {
                this.scene.traverse((obj) => {
                    if (!obj) return;
                    const m = obj.material;
                    if (Array.isArray(m)) m.forEach(markMaterial); else markMaterial(m);
                });
            }
            return fn();
        } finally {
            for (const mat of touched) {
                try { mat.side = THREE.FrontSide; } catch { /* ignore */ }
            }
        }
    },

    _updateHover(event) {
        if (this._shouldSuppressSceneHover()) {
            try { SelectionFilter.clearHover(); } catch { /* ignore selection fallback failures */ }
            return;
        }
        const { primary } = this._collectSelectionCandidates(event);
        if (primary) {
            try { SelectionFilter.setHoverObject(primary); } catch { /* ignore selection fallback failures */ }
        } else {
            try { SelectionFilter.clearHover(); } catch { /* ignore selection fallback failures */ }
        }
    },

    _isFeatureDimensionDragActive() {
        try { return !!this.historyWidget?.isFeatureDimensionDragging?.(); } catch { return false; }
    },

    _shouldSuppressSceneHover() {
        return this._isFeatureDimensionDragActive();
    },

    _collectSelectionCandidates(event) {
        const allowedTypes = (() => {
            try {
                const list = SelectionFilter.getAvailableTypes?.() || [];
                if (Array.isArray(list) && list.length > 0) return list;
                if (Array.isArray(SelectionFilter.TYPES)) return SelectionFilter.TYPES.filter(t => t !== SelectionFilter.ALL);
            } catch { /* ignore selection fallback failures */ }
            return [];
        })();
        const normType = (t) => String(t || '').toUpperCase();
        const allowedSet = new Set(allowedTypes.map(normType));
        const priorityOrder = [
            SelectionFilter.VERTEX,
            SelectionFilter.EDGE,
            SelectionFilter.FACE,
            SelectionFilter.PLANE,
            SelectionFilter.SKETCH,
            SelectionFilter.DATUM,
            SelectionFilter.HELIX,
            SelectionFilter.LOOP,
            SelectionFilter.SOLID,
            SelectionFilter.COMPONENT,
        ].map(t => normType(t));
        const normSolid = normType(SelectionFilter.SOLID);
        const normComponent = normType(SelectionFilter.COMPONENT);
        const nonSolidAllowed = Array.from(allowedSet).some(t => t && t !== normSolid && t !== normComponent);
        const getPriority = (type) => {
            const nt = normType(type);
            if (nonSolidAllowed && (nt === normSolid || nt === normComponent)) {
                // Always push SOLID/COMPONENT to the end when any other type is allowed.
                return priorityOrder.length + 2;
            }
            const idx = priorityOrder.indexOf(nt);
            return idx === -1 ? priorityOrder.length : idx;
        };
        const isAllowedType = (type) => {
            if (allowedSet.size === 0) return true;
            return allowedSet.has(normType(type));
        };

        const { target, candidates = [] } = this._pickAtEvent(event, { collectAll: true, allowAnyAllowedType: true });
        const deduped = [];
        const seen = new Set();
        const normalizeTarget = (obj) => {
            if (!obj) return null;
            let o = obj;
            const nt = normType(o.type);
            if (nt === 'POINTS' && o.parent && normType(o.parent.type) === normType(SelectionFilter.VERTEX)) {
                o = o.parent;
            }
            if (!isAllowedType(o.type) && o.parent && isAllowedType(o.parent.type)) {
                o = o.parent;
            }
            return o;
        };
        const addEntry = (obj, distance) => {
            const normalized = normalizeTarget(obj);
            if (!normalized) return;
            if (!isAllowedType(normalized.type)) return;
            const key = normalized.uuid || normalized.name || `${normalized.type}-${seen.size}`;
            if (seen.has(key)) return;
            seen.add(key);
            deduped.push({
                target: normalized,
                distance: Number.isFinite(distance) ? distance : Infinity,
                label: this._describeSelectionCandidate(normalized),
            });
        };
        for (const entry of candidates) {
            const obj = entry?.target;
            if (!obj) continue;
            const distance = Number.isFinite(entry?.distance) ? entry.distance : (entry?.hit?.distance ?? Infinity);
            addEntry(obj, distance);
        }
        deduped.sort((a, b) => a.distance - b.distance);

        // When all types are allowed, also include ancestor SOLID/COMPONENT entries at the end
        const extras = [];
        const addExtra = (obj, distance) => {
            const normalized = normalizeTarget(obj);
            if (!normalized) return;
            if (!isAllowedType(normalized.type)) return;
            const key = normalized.uuid || normalized.name || `${normalized.type}-${seen.size}`;
            if (seen.has(key)) return;
            seen.add(key);
            extras.push({
                target: normalized,
                distance: Number.isFinite(distance) ? distance : Infinity,
                label: this._describeSelectionCandidate(normalized),
            });
        };
        const findAncestorOfType = (obj, type) => {
            let cur = obj?.parent || null;
            while (cur) {
                if (normType(cur.type) === normType(type)) return cur;
                cur = cur.parent || null;
            }
            return null;
        };
        for (const entry of deduped.slice()) {
            const obj = entry.target;
            const dist = entry.distance;
            const solid = findAncestorOfType(obj, SelectionFilter.SOLID);
            const component = findAncestorOfType(obj, SelectionFilter.COMPONENT);
            addExtra(component, dist);
            addExtra(solid, dist);
        }
        extras.sort((a, b) => a.distance - b.distance);
        const ordered = deduped.concat(extras);
        ordered.sort((a, b) => {
            const pa = getPriority(a?.target?.type);
            const pb = getPriority(b?.target?.type);
            if (pa !== pb) return pa - pb;
            return (a?.distance ?? Infinity) - (b?.distance ?? Infinity);
        });
        const primary = ordered[0]?.target || target || null;
        return { ordered, primary };
    },

    _selectAt(event) {
        const { ordered, primary } = this._collectSelectionCandidates(event);
        if (!primary) {
            return;
        }

        if (ordered.length > 1) {
            this._scheduleSelectionOverlay(event, ordered);
            return;
        }

        this._hideSelectionOverlay();
        this._applySelectionTarget(primary, { pointerEvent: event });
    },

    _applySelectionTarget(target: any, options: any = {}) {
        if (!target) return;
        this._lastInspectorTarget = target;
        this._lastInspectorSolid = this._findParentSolid(target);
        if (this._triangleDebugger && this._triangleDebugger.isOpen && this._triangleDebugger.isOpen()) {
            try { this._triangleDebugger.refreshTarget(target); } catch { /* ignore selection fallback failures */ }
        }
        const {
            triggerOnClick = true,
            allowDiagnostics = true,
            pointerEvent = undefined,
        } = options;
        // One-shot diagnostic inspector
        if (allowDiagnostics && this._diagPickOnce) {
            this._diagPickOnce = false;
            try { this._showDiagnosticsFor(target); } catch (e) { try { console.warn('Diagnostics failed:', e); } catch { /* ignore selection fallback failures */ } }
            // Restore selection filter if we changed it
            if (this._diagRestoreFilter) {
                try { SelectionFilter.restoreAllowedSelectionTypes && SelectionFilter.restoreAllowedSelectionTypes(); } catch { /* ignore selection fallback failures */ }
                this._diagRestoreFilter = false;
            }
        }
        // If inspector panel is open, update it immediately for the clicked object
        if (this._inspectorOpen) {
            try { this._updateInspectorFor(target); } catch (e) { try { console.warn('Inspector update failed:', e); } catch { /* ignore selection fallback failures */ } }
        }
        const metadataPanel = this.__metadataPanelController;
        if (metadataPanel && typeof metadataPanel.handleSelection === 'function') {
            try { metadataPanel.handleSelection(target); }
            catch (e) { try { console.warn('Metadata panel update failed:', e); } catch { /* ignore selection fallback failures */ } }
        }
        const solidOverlapDiagnostics = this.__solidOverlapDiagnosticsController;
        if (solidOverlapDiagnostics && typeof solidOverlapDiagnostics.handleSelection === 'function') {
            try { solidOverlapDiagnostics.handleSelection(target); }
            catch (e) { try { console.warn('Solid overlap diagnostics update failed:', e); } catch { /* ignore selection fallback failures */ } }
        }
        if (triggerOnClick && typeof target.onClick === 'function') {
            try { target.onClick(pointerEvent); } catch { /* ignore selection fallback failures */ }
        }
    },

    _scheduleHoverRefresh() {
        if (this._disposed || this._hoverRefreshRaf != null) return;
        this._hoverRefreshRaf = requestAnimationFrame(() => {
            this._hoverRefreshRaf = null;
            if (this._disposed) return;
            try { this.render(); } catch { /* ignore selection fallback failures */ }
        });
    },

    _onHoverChanged() {
        this._scheduleHoverRefresh();
    },

    _clearSelectionOverlayTimer() {
        if (this._selectionOverlayTimer) {
            clearTimeout(this._selectionOverlayTimer);
            this._selectionOverlayTimer = null;
        }
        this._pendingSelectionOverlay = null;
    },

    _isAssemblyChildSelection(obj) {
        if (!obj) return false;
        const type = (obj.type || '').toUpperCase();
        const isRefType = type === SelectionFilter.FACE || type === SelectionFilter.EDGE || type === SelectionFilter.VERTEX || type === 'POINTS';
        if (!isRefType) return false;
        const findAncestorOfType = (node, targetType) => {
            const norm = (t) => (t || '').toUpperCase();
            let cur = node?.parent || null;
            while (cur) {
                if (norm(cur.type) === norm(targetType)) return cur;
                cur = cur.parent || null;
            }
            return null;
        };
        const solid = findAncestorOfType(obj, SelectionFilter.SOLID);
        if (!solid) return false;
        const parent = solid.parent || null;
        if (!parent) return false;
        const normParentType = (parent.type || '').toUpperCase();
        const isComponent = normParentType === SelectionFilter.COMPONENT || normParentType === 'COMPONENT' || parent.isAssemblyComponent;
        return !!isComponent;
    },

    _shouldDelaySelectionOverlay(candidates = []) {
        try {
            const sfAll = SelectionFilter.allowedSelectionTypes === SelectionFilter.ALL;
            if (!sfAll) return false;
            const top = Array.isArray(candidates) && candidates.length ? candidates[0].target : null;
            return this._isAssemblyChildSelection(top);
        } catch {
            return false;
        }
    },

    _scheduleSelectionOverlay(event, candidates) {
        this._clearSelectionOverlayTimer();
        const shouldDelay = this._shouldDelaySelectionOverlay(candidates);
        if (!shouldDelay) {
            this._showSelectionOverlay(event, candidates);
            return;
        }
        const eventSnapshot = event ? { clientX: event.clientX, clientY: event.clientY } : null;
        this._pendingSelectionOverlay = { event: eventSnapshot, candidates };
        this._selectionOverlayTimer = setTimeout(() => {
            this._selectionOverlayTimer = null;
            const pending = this._pendingSelectionOverlay;
            this._pendingSelectionOverlay = null;
            if (pending) this._showSelectionOverlay(pending.event, pending.candidates);
        }, 300);
    },

    _describeSelectionCandidate(obj) {
        if (!obj) return 'Selection';
        const name = (obj.name && String(obj.name).trim()) ? String(obj.name).trim() : null;
        const type = obj.type || 'object';
        return name || type;
    },

    _showSelectionOverlay(event, candidates) {
        this._clearSelectionOverlayTimer();
        this._hideSelectionOverlay();
        if (!Array.isArray(candidates) || candidates.length === 0) return;

        const wrap = document.createElement('div');
        wrap.className = 'selection-picker';
        wrap.classList.add('is-hovered');
        const title = document.createElement('div');
        title.className = 'selection-picker__title selection-picker__handle';
        title.textContent = 'Select an object';
        const headerRow = document.createElement('div');
        headerRow.className = 'selection-picker__header';
        headerRow.appendChild(title);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear Selection';
        clearBtn.className = 'selection-picker__clear';
        clearBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            try {
                const scene = this.partHistory?.scene || this.scene;
                if (scene) SelectionFilter.unselectAll(scene);
            } catch { /* ignore selection fallback failures */ }
            this._hideSelectionOverlay();
        });
        headerRow.appendChild(clearBtn);
        wrap.appendChild(headerRow);

        const overlayState: any = { wrap, drag: { active: false }, peekTimer: null };
        const triggerPeek = () => {
            if (overlayState.peekTimer) {
                clearTimeout(overlayState.peekTimer);
                overlayState.peekTimer = null;
            }
            try { wrap.style.opacity = '0.8'; } catch { /* ignore selection fallback failures */ }
            overlayState.peekTimer = setTimeout(() => {
                try { wrap.style.opacity = ''; } catch { /* ignore selection fallback failures */ }
                overlayState.peekTimer = null;
            }, 500);
        };

        const list = document.createElement('div');
        list.className = 'selection-picker__list';
        const listMetrics = { itemHeight: 0, gap: 0, paddingTop: 0 };
        const readListStyles = () => {
            try {
                const styles = getComputedStyle(list);
                const gap = parseFloat(styles.rowGap || styles.gap || '0') || 0;
                const paddingTop = parseFloat(styles.paddingTop || '0') || 0;
                listMetrics.gap = gap;
                listMetrics.paddingTop = paddingTop;
            } catch { /* ignore selection fallback failures */ }
        };
        const ensureItemMetrics = () => {
            if (!listMetrics.gap && !listMetrics.paddingTop) readListStyles();
            if (listMetrics.itemHeight) return listMetrics.itemHeight;
            const first = list.querySelector('.selection-picker__item');
            if (!first) return 0;
            const rect = first.getBoundingClientRect();
            listMetrics.itemHeight = rect.height || (first as HTMLElement).offsetHeight || 0;
            return listMetrics.itemHeight;
        };
        const updateListPadding = () => {
            readListStyles();
            const first = list.querySelector('.selection-picker__item');
            if (!first) return;
            const listRect = list.getBoundingClientRect();
            const rect = first.getBoundingClientRect();
            listMetrics.itemHeight = rect.height || listMetrics.itemHeight || 0;
            const padding = Math.max(0, Math.round(listRect.height - listMetrics.paddingTop - rect.height));
            list.style.paddingBottom = `${padding}px`;
        };
        candidates.forEach((entry) => {
            if (!entry?.target) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'selection-picker__item';
            const line = document.createElement('div');
            line.className = 'selection-picker__line';
            const typeSpan = document.createElement('div');
            typeSpan.className = 'selection-picker__type';
            typeSpan.textContent = String(entry.target.type || '').toUpperCase() || 'OBJECT';
            const nameSpan = document.createElement('div');
            nameSpan.className = 'selection-picker__name';
            nameSpan.textContent = entry.label;
            line.appendChild(typeSpan);
            line.appendChild(nameSpan);
            btn.appendChild(line);
            btn.addEventListener('mouseenter', () => {
                triggerPeek();
                try { SelectionFilter.setHoverObject(entry.target, { ignoreFilter: true }); } catch { /* ignore selection fallback failures */ }
            });
            btn.addEventListener('mouseleave', () => {
                try { SelectionFilter.clearHover(); } catch { /* ignore selection fallback failures */ }
            });
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ev.preventDefault?.();
                try {
                    console.log('Selection picker selected:', {
                        type: entry.target?.type,
                        label: entry.label,
                        target: entry.target,
                    });
                } catch { /* ignore */ }
                this._hideSelectionOverlay();
                this._applySelectionTarget(entry.target);
            });
            list.appendChild(btn);
        });
        const onWheelSnapScroll = (ev) => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch { /* ignore selection fallback failures */ }
            if (!list || list.children.length === 0) return;
            const dir = Math.sign(ev.deltaY || 0);
            if (!dir) return;
            const itemHeight = ensureItemMetrics();
            if (!itemHeight) return;
            const step = Math.max(1, Math.round(itemHeight + listMetrics.gap));
            const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
            const next = Math.min(maxScroll, Math.max(0, list.scrollTop + (dir * step)));
            list.scrollTo({ top: next });
        };
        list.addEventListener('wheel', onWheelSnapScroll, { passive: false });
        wrap.appendChild(list);

        const startX = event?.clientX ?? (window.innerWidth / 2);
        const startY = event?.clientY ?? (window.innerHeight / 2);
        wrap.style.left = `${startX}px`;
        wrap.style.top = `${startY}px`;

        document.body.appendChild(wrap);

        const adjustWithinViewport = () => {
            const bounds = wrap.getBoundingClientRect();
            const firstItem = wrap.querySelector('.selection-picker__item');
            let nextLeft = startX;
            let nextTop = startY;
            if (firstItem) {
                const firstBounds = firstItem.getBoundingClientRect();
                // Align pointer roughly to the center of the first item so the cursor is directly on it.
                const offsetX = (firstBounds.left - bounds.left) + (firstBounds.width / 2);
                const offsetY = (firstBounds.top - bounds.top) + (firstBounds.height / 2);
                nextLeft = startX - offsetX;
                nextTop = startY - offsetY;
            }
            const margin = 12;
            const width = bounds.width;
            const height = bounds.height;
            if (nextLeft + width > window.innerWidth - margin) nextLeft = Math.max(margin, window.innerWidth - width - margin);
            if (nextTop + height > window.innerHeight - margin) nextTop = Math.max(margin, window.innerHeight - height - margin);
            if (nextLeft < margin) nextLeft = margin;
            if (nextTop < margin) nextTop = margin;
            wrap.style.left = `${nextLeft}px`;
            wrap.style.top = `${nextTop}px`;
        };
        // Wait a frame so layout is accurate before aligning and padding the list.
        requestAnimationFrame(() => {
            updateListPadding();
            adjustWithinViewport();
        });

        const onEnter = () => {
            wrap.classList.add('is-hovered');
        };
        const onLeave = () => {
            if (!overlayState.drag.active) wrap.classList.remove('is-hovered');
        };

        const onDragMove = (ev) => {
            if (!overlayState.drag.active) return;
            const margin = 12;
            const bounds = wrap.getBoundingClientRect();
            const width = bounds.width;
            const height = bounds.height;
            let nextLeft = ev.clientX - overlayState.drag.offsetX;
            let nextTop = ev.clientY - overlayState.drag.offsetY;
            if (nextLeft + width > window.innerWidth - margin) nextLeft = Math.max(margin, window.innerWidth - width - margin);
            if (nextTop + height > window.innerHeight - margin) nextTop = Math.max(margin, window.innerHeight - height - margin);
            if (nextLeft < margin) nextLeft = margin;
            if (nextTop < margin) nextTop = margin;
            wrap.style.left = `${nextLeft}px`;
            wrap.style.top = `${nextTop}px`;
        };

        const stopDrag = (ev) => {
            if (!overlayState.drag.active) return;
            overlayState.drag.active = false;
            wrap.classList.remove('dragging');
            if (!wrap.matches(':hover')) wrap.classList.remove('is-hovered');
            window.removeEventListener('pointermove', onDragMove, { passive: true } as any);
            window.removeEventListener('pointerup', stopDrag, { passive: true, capture: true } as any);
            if (ev) { try { ev.stopPropagation(); } catch { /* ignore selection fallback failures */ } }
        };

        const onDragStart = (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            const rect = wrap.getBoundingClientRect();
            overlayState.drag.active = true;
            overlayState.drag.offsetX = ev.clientX - rect.left;
            overlayState.drag.offsetY = ev.clientY - rect.top;
            wrap.classList.add('dragging');
            wrap.classList.add('is-hovered');
            window.addEventListener('pointermove', onDragMove, { passive: true });
            window.addEventListener('pointerup', stopDrag, { passive: true, capture: true });
        };

        title.addEventListener('pointerdown', onDragStart);
        wrap.addEventListener('pointerenter', onEnter);
        wrap.addEventListener('pointerleave', onLeave);

        const onPointerDown = (ev) => {
            if (!wrap.contains(ev.target)) this._hideSelectionOverlay();
        };
        const onKey = (ev) => {
            if (ev.key === 'Escape') this._hideSelectionOverlay();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKey, true);

        this._selectionOverlay = {
            wrap,
            onPointerDown,
            onKey,
            onEnter,
            onLeave,
            onDragStart,
            onDragMove,
            stopDrag,
            onWheelRotate: onWheelSnapScroll,
            list,
            overlayState,
        };
    },

    _hideSelectionOverlay() {
        const overlay = this._selectionOverlay;
        if (!overlay) return;
        this._clearSelectionOverlayTimer();
        try { overlay.stopDrag?.(); } catch { /* ignore selection fallback failures */ }
        document.removeEventListener('pointerdown', overlay.onPointerDown, true);
        document.removeEventListener('keydown', overlay.onKey, true);
        try { overlay.wrap.removeEventListener('pointerenter', overlay.onEnter); } catch { /* ignore selection fallback failures */ }
        try { overlay.wrap.removeEventListener('pointerleave', overlay.onLeave); } catch { /* ignore selection fallback failures */ }
        try { overlay.wrap.querySelector('.selection-picker__handle')?.removeEventListener('pointerdown', overlay.onDragStart); } catch { /* ignore selection fallback failures */ }
        try { window.removeEventListener('pointermove', overlay.onDragMove, { passive: true } as any); } catch { /* ignore selection fallback failures */ }
        try { window.removeEventListener('pointerup', overlay.stopDrag, { passive: true, capture: true } as any); } catch { /* ignore selection fallback failures */ }
        try { overlay.list?.removeEventListener('wheel', overlay.onWheelRotate, { passive: false }); } catch { /* ignore selection fallback failures */ }
        try {
            if (overlay.overlayState?.peekTimer) {
                clearTimeout(overlay.overlayState.peekTimer);
                overlay.overlayState.peekTimer = null;
            }
        } catch { /* ignore selection fallback failures */ }
        try { overlay.wrap.style.opacity = ''; } catch { /* ignore selection fallback failures */ }
        try { overlay.wrap.remove(); } catch { /* ignore selection fallback failures */ }
        this._selectionOverlay = null;
        try { SelectionFilter.clearHover(); } catch { /* ignore selection fallback failures */ }
        // Restore hover state based on the last pointer position on the canvas
        try {
            if (this._lastPointerEvent) this._updateHover(this._lastPointerEvent);
        } catch { /* ignore selection fallback failures */ }
    },

    // ----------------------------------------
    // Internal: Event Handlers
    // ----------------------------------------

    _onPointerMove(event) {
        if (this._disposed) return;
        // Keep last pointer position and refresh hover
        this._lastPointerEvent = event;
        // If hovering over the view cube, avoid main-scene hover
        try {
            if (this.viewCube) {
                try { this.viewCube.handlePointerMove?.(event); } catch { /* ignore selection fallback failures */ }
                if (this.viewCube.isEventInside(event)) return;
            }
        } catch { /* ignore selection fallback failures */ }
        // If hovering TransformControls gizmo, skip scene hover handling
        try {
            const ax = (typeof window !== 'undefined') ? ((window as any).__BREP_activeXform || null) : null;
            if (ax && typeof ax.isOver === 'function' && ax.isOver(event)) return;
        } catch { /* ignore selection fallback failures */ }
        if (this._shouldSuppressSceneHover()) {
            try { SelectionFilter.clearHover(); } catch { /* ignore selection fallback failures */ }
            return;
        }
        this._updateHover(event);
    },

    _onPointerDown(event) {
        if (this._disposed) return;
        this._hideSelectionOverlay();
        // If pointer is over TransformControls gizmo, let it handle the interaction
        try {
            const ax = (typeof window !== 'undefined') ? ((window as any).__BREP_activeXform || null) : null;
            if (ax && typeof ax.isOver === 'function' && ax.isOver(event)) { try { event.preventDefault(); } catch { /* ignore selection fallback failures */ }; return; }
        } catch { /* ignore selection fallback failures */ }
        this._clearSelectionOverlayTimer();
        try {
            if (this._isEventOverRenderer(event)) {
                this._lastCanvasPointerDownAt = Date.now();
            }
        } catch { /* ignore selection fallback failures */ }
        // If pressing in the view cube region, disable controls for this gesture
        try {
            this._cubeActive = !!(this.viewCube && this.viewCube.isEventInside(event));
        } catch { this._cubeActive = false; }
        this._pointerDown = true;
        this._downButton = event.button;
        this._downPos.x = event.clientX;
        this._downPos.y = event.clientY;
        this.controls.enabled = !this._cubeActive;
        // Prevent default to avoid unwanted text selection/scroll on drag
        try { event.preventDefault(); } catch { /* ignore selection fallback failures */ }
    },

    _onPointerUp(event) {
        if (this._disposed) return;
        // If releasing over TransformControls gizmo, skip scene selection
        try {
            const ax = (typeof window !== 'undefined') ? ((window as any).__BREP_activeXform || null) : null;
            if (ax && typeof ax.isOver === 'function' && ax.isOver(event)) { try { event.preventDefault(); } catch { /* ignore selection fallback failures */ }; return; }
        } catch { /* ignore selection fallback failures */ }
        // If the gesture began in the cube, handle click there exclusively
        if (this._cubeActive) {
            try { if (this.viewCube && this.viewCube.handleClick(event)) { this._cubeActive = false; return; } } catch { /* ignore selection fallback failures */ }
            this._cubeActive = false;
        }
        // Click selection if within drag threshold and left button
        const dx = Math.abs(event.clientX - this._downPos.x);
        const dy = Math.abs(event.clientY - this._downPos.y);
        const moved = (dx + dy) > this._dragThreshold;
        if (this._pointerDown && this._downButton === 0 && !moved) {
            this._selectAt(event);
        }
        // Reset flags and keep controls enabled
        this._pointerDown = false;
        this.controls.enabled = true;
        void event;
    },

    _onContextMenu(event) {
        // No interactive targets; allow default context menu
        void event;
    },

    _handleEscapeAction() {
        if (this._disposed) return;
        try { this._clearSelectionOverlayTimer(); } catch { /* ignore selection fallback failures */ }
        try { this._hideSelectionOverlay(); } catch { /* ignore selection fallback failures */ }
        try { this._splineMode?.clearSelection?.(); } catch { /* ignore selection fallback failures */ }
        try { this._toggleComponentTransform?.(null); } catch { /* ignore selection fallback failures */ }
        try { this._stopComponentTransformSession?.(); } catch { /* ignore selection fallback failures */ }
        try {
            const scene = this.partHistory?.scene || this.scene;
            if (scene) {
                SelectionFilter.unselectAll(scene);
                SelectionFilter.restoreAllowedSelectionTypes();
            }
        } catch { /* ignore selection fallback failures */ }
    },

    _onKeyDown(event) {
        if (this._disposed) return;
        if (this._sheet2DEditorActive) return;
        const target = event?.target || null;
        const tag = target?.tagName ? String(target.tagName).toLowerCase() : '';
        const isEditable = !!(
            target
            && (target.isContentEditable
                || tag === 'input'
                || tag === 'textarea'
                || tag === 'select')
        );
        const key = (event?.key || '').toLowerCase();
        const isMod = !!(event?.ctrlKey || event?.metaKey);
        const isUndo = isMod && !event?.altKey && key === 'z' && !event?.shiftKey;
        const isRedo = isMod && !event?.altKey && (key === 'y' || (event?.shiftKey && key === 'z'));
        if ((isUndo || isRedo) && !isEditable) {
            if (this._viewerOnlyMode) {
                try { event.preventDefault(); } catch { /* ignore selection fallback failures */ }
                try { event.stopImmediatePropagation(); } catch { /* ignore selection fallback failures */ }
                return;
            }
            if (this._imageEditorActive) return;
            try {
                if (this._sketchMode && typeof this._sketchMode.undo === 'function' && typeof this._sketchMode.redo === 'function') {
                    if (isUndo) this._sketchMode.undo();
                    else this._sketchMode.redo();
                } else if (this.partHistory) {
                    void this._runFeatureHistoryUndoRedo(isRedo ? 'redo' : 'undo');
                }
                try { event.preventDefault(); } catch { /* ignore selection fallback failures */ }
                try { event.stopImmediatePropagation(); } catch { /* ignore selection fallback failures */ }
            } catch { /* ignore selection fallback failures */ }
            return;
        }
        const k = event?.key || event?.code || '';
        if (k === 'Escape' || k === 'Esc') {
            this._handleEscapeAction();
        }
    }
};

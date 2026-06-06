import { buildWireHarnessBundleSegments, routeWireHarnessConnections } from '../../wireHarness/wireHarnessRouting.js';
import { clearWireHarnessRouteGroup, renderWireHarnessRoutes } from '../../wireHarness/wireHarnessRouteRenderer.js';
import {
    getActiveWorkbench,
    isSidePanelAllowed,
    normalizeWorkbenchId,
    setActiveWorkbench as setPartActiveWorkbench,
} from '../../workbenches/index.js';

import { SelectionFilter } from '../SelectionFilter.js';
import { ASSEMBLY_CONSTRAINTS_TITLE } from './constants.js';

export const workbenchMethods = {
    _getActiveWorkbenchId() {
        return getActiveWorkbench(this.partHistory);
    },

    setActiveWorkbench(workbenchId, options = {}) {
        const previous = this._getActiveWorkbenchId();
        const next = setPartActiveWorkbench(this.partHistory, normalizeWorkbenchId(workbenchId, previous));
        if (previous === next) return false;
        if (next === 'SIMULATION' && previous !== 'SIMULATION') {
            this._simulationWorkbenchReturnTarget = previous || 'MODELING';
        } else if (previous === 'SIMULATION' && next !== 'SIMULATION') {
            this._simulationWorkbenchReturnTarget = null;
        }
        if (next === 'SIMULATION') {
            try { SelectionFilter.SetSelectionTypes([SelectionFilter.SOLID]); } catch { }
        }
        if (next !== 'PMI') {
            this._workbenchReturnTarget = null;
        }
        this.refreshWorkbenchUi();
        if (options.queueHistorySnapshot !== false) {
            this.partHistory?.queueHistorySnapshot?.({ debounceMs: 0, reason: 'workbench' });
        }
        return true;
    },

    _setWorkbenchReturnTarget(targetWorkbenchId = null) {
        this._workbenchReturnTarget = targetWorkbenchId
            ? normalizeWorkbenchId(targetWorkbenchId, null)
            : null;
    },

    _restoreWorkbenchAfterPMI() {
        if (this._suspendWorkbenchReturn) return false;
        const target = this._workbenchReturnTarget;
        this._workbenchReturnTarget = null;
        if (!target) return false;
        return this.setActiveWorkbench(target, { queueHistorySnapshot: true });
    },

    finishSimulationWorkbench() {
        const target = this._simulationWorkbenchReturnTarget || 'MODELING';
        this._simulationWorkbenchReturnTarget = null;
        try { this.simulationWorkbenchManager?.setPlaying?.(false); } catch { }
        return this.setActiveWorkbench(target, { queueHistorySnapshot: true });
    },

    _syncSimulationFinishUi() {
        const active = this._getActiveWorkbenchId() === 'SIMULATION';
        if (active) return this._mountSimulationFinishUi();
        return this._removeSimulationFinishUi();
    },

    _mountSimulationFinishUi() {
        if (this._simulationFinishUi?.isConnected) return this._simulationFinishUi;
        const host = this.container || document.body || null;
        if (!host) return null;
        if (!document.getElementById('simulation-finish-ui-styles')) {
            const style = document.createElement('style');
            style.id = 'simulation-finish-ui-styles';
            style.textContent = `
                .simulation-top-right {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    display: flex;
                    gap: 8px;
                    z-index: 1000;
                }
                .simulation-top-right-btn {
                    appearance: none;
                    border: 1px solid #262b36;
                    border-radius: 8px;
                    padding: 6px 10px;
                    cursor: pointer;
                    color: #e6e6e6;
                    background: linear-gradient(180deg, rgba(110,168,254,.25), rgba(110,168,254,.15));
                }
            `;
            document.head.appendChild(style);
        }
        try {
            const pos = (typeof window !== 'undefined' && window.getComputedStyle)
                ? window.getComputedStyle(host).position
                : host.style.position;
            if (!pos || pos === 'static') host.style.position = 'relative';
        } catch {
            if (!host.style.position) host.style.position = 'relative';
        }
        const wrap = document.createElement('div');
        wrap.className = 'simulation-top-right';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'simulation-top-right-btn';
        btn.textContent = 'Finish';
        btn.title = 'Finish simulation';
        btn.addEventListener('click', () => {
            try { this.finishSimulationWorkbench(); } catch { }
        });
        wrap.appendChild(btn);
        host.appendChild(wrap);
        this._simulationFinishUi = wrap;
        try {
            this.mainToolbar?.reserveRightSpaceForElement?.(
                this._simulationFinishReserveKey,
                wrap,
                { extraPx: 16, minPx: 84 },
            );
        } catch { }
        return wrap;
    },

    _removeSimulationFinishUi() {
        try { this._simulationFinishUi?.remove?.(); } catch { }
        this._simulationFinishUi = null;
        try { this.mainToolbar?.clearRightReserve?.(this._simulationFinishReserveKey); } catch { }
        return null;
    },

    async _ensureSimulationWorkbenchManager() {
        if (this.simulationWorkbenchManager) return this.simulationWorkbenchManager;
        if (this._simulationWorkbenchManagerPromise) return this._simulationWorkbenchManagerPromise;

        this._simulationWorkbenchManagerPromise = (async () => {
            try {
                const moduleUrl = new URL('../../simulation/SimulationWorkbenchManager.js', import.meta.url).href;
                const { SimulationWorkbenchManager } = await import(/* @vite-ignore */ moduleUrl);
                if (this._disposed) return null;
                if (!this.simulationWorkbenchManager) {
                    this.simulationWorkbenchManager = new SimulationWorkbenchManager(this);
                }
                return this.simulationWorkbenchManager;
            } catch (error) {
                try { console.warn('[Viewer] Failed to load simulation workbench manager', error); } catch { }
                return null;
            } finally {
                this._simulationWorkbenchManagerPromise = null;
            }
        })();

        return this._simulationWorkbenchManagerPromise;
    },

    refreshWorkbenchUi() {
        if (this._viewerOnlyMode) return;
        const isSimulationWorkbench = this._getActiveWorkbenchId() === 'SIMULATION';
        if (isSimulationWorkbench) {
            void this._ensureSimulationWorkbenchManager().then((manager) => {
                try { manager?.setActive?.(this._getActiveWorkbenchId() === 'SIMULATION'); } catch { }
            });
        } else {
            try { this.simulationWorkbenchManager?.setActive?.(false); } catch { }
        }
        try { this.historyWidget?.refreshWorkbenchUi?.(); } catch { }
        try { SelectionFilter.refreshSelectionActions?.(); } catch { }
        try { this._refreshWorkbenchPanelVisibility(); } catch { }
        try { this.mainToolbar?.refreshButtons?.(); } catch { }
        try { this._syncSimulationFinishUi(); } catch { }
    },

    _normalizeToolbarButtonInput(labelOrSpec, title, onClick, fallbackSource = 'plugin') {
        const source = fallbackSource || 'plugin';
        if (labelOrSpec && typeof labelOrSpec === 'object' && !Array.isArray(labelOrSpec)) {
            return {
                ...labelOrSpec,
                id: String(labelOrSpec.id || `toolbar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
                source: labelOrSpec.source || source,
            };
        }
        return {
            id: `toolbar-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            label: labelOrSpec,
            title,
            onClick,
            source,
        };
    },

    // Public: allow plugins to add toolbar buttons even before MainToolbar is constructed

    addToolbarButton(labelOrSpec, title, onClick) {
        if (this._viewerOnlyMode) return null;
        const item = this._normalizeToolbarButtonInput(labelOrSpec, title, onClick, 'plugin');
        if (this.mainToolbar && typeof this.mainToolbar.addCustomButton === 'function') {
            try { return this.mainToolbar.addCustomButton(item); } catch { return null; }
        }
        this._pendingToolbarButtons = this._pendingToolbarButtons || [];
        this._pendingToolbarButtons.push(item);
        return null;
    },

    _syncHistoryUiAfterUndoRedo() {
        try {
            this.expressionsManager?.refreshFromPartHistory?.();
        } catch { }
        try {
            if (this.pmiViewsWidget) {
                this.pmiViewsWidget.refreshFromHistory?.();
                this.pmiViewsWidget._renderList?.();
            }
        } catch { }
        try {
            if (this.sheet2DWidget) {
                this.sheet2DWidget.refreshFromHistory?.();
                this.sheet2DWidget._renderList?.();
            }
            this._sheet2DEditorWindow?.refreshFromHistory?.();
        } catch { }
        try {
            this.simulationHistoryWidget?.refreshFromHistory?.();
        } catch { }
        try {
            if (this.wireHarnessConnectionsWidget) {
                this.wireHarnessConnectionsWidget.refreshFromHistory?.();
                this.wireHarnessConnectionsWidget._renderList?.();
            }
        } catch { }
        try { this.historyWidget?.render?.(); } catch { }
        try { this.refreshWorkbenchUi(); } catch { }
    },

    async _syncWireHarnessRoutesFromHistoryState(_options = {}) {
        const scene = this.partHistory?.scene || this.scene || null;
        const manager = this.partHistory?.wireHarnessManager || null;
        if (!scene || !manager) {
            clearWireHarnessRouteGroup(scene);
            return null;
        }

        const pendingRoutes = manager.consumePendingRestoredRouteResults?.();
        if (Array.isArray(pendingRoutes) && pendingRoutes.length) {
            const bundleSegments = buildWireHarnessBundleSegments(this.partHistory, pendingRoutes);
            renderWireHarnessRoutes(scene, pendingRoutes, bundleSegments);
            manager.setRouteResults?.(pendingRoutes, { preservePendingRestore: true });
            try { this.render?.(); } catch { /* ignore */ }
            return pendingRoutes;
        }

        clearWireHarnessRouteGroup(scene);
        manager.clearRouteResults?.();
        try { this.render?.(); } catch { /* ignore */ }
        return null;
    },

    async refreshWireHarnessRoutes(_options = {}) {
        const scene = this.partHistory?.scene || this.scene || null;
        const manager = this.partHistory?.wireHarnessManager || null;
        if (!scene || !manager) {
            clearWireHarnessRouteGroup(scene);
            return null;
        }

        const connections = Array.isArray(manager.getConnections?.()) ? manager.getConnections() : [];
        if (!connections.length) {
            clearWireHarnessRouteGroup(scene);
            manager.setRouteResults?.([]);
            return null;
        }

        try {
            const { routes, bundleSegments } = await routeWireHarnessConnections(this.partHistory, connections);
            renderWireHarnessRoutes(scene, routes, bundleSegments);
            manager.setRouteResults?.(routes);
            try { this.render?.(); } catch { /* ignore */ }
            return routes;
        } catch (error) {
            console.warn('[Viewer] Failed to refresh wire harness routes:', error);
            clearWireHarnessRouteGroup(scene);
            manager.setRouteResults?.(
                connections.map((connection) => ({
                    connectionId: String(connection?.id || ''),
                    connectionName: String(connection?.name || connection?.id || 'Wire'),
                    feasible: false,
                    error: error?.message || 'Failed to route wire harness connections.',
                    distance: null,
                    polyline: [],
                    segmentIds: [],
                })),
            );
            return null;
        }
    },

    async clearWireHarnessRoutes(_options = {}) {
        const scene = this.partHistory?.scene || this.scene || null;
        const manager = this.partHistory?.wireHarnessManager || null;
        clearWireHarnessRouteGroup(scene);
        manager?.clearRouteResults?.();
        try { this.render?.(); } catch { /* ignore */ }
        return null;
    },

    async _runFeatureHistoryUndoRedo(direction) {
        if (this._viewerOnlyMode) return false;
        const ph = this.partHistory;
        if (!ph) return false;
        let changed = false;
        try {
            if (direction === 'redo') changed = await ph.redoFeatureHistory();
            else changed = await ph.undoFeatureHistory();
        } catch { }
        try { this._syncHistoryUiAfterUndoRedo(); } catch { }
        return changed;
    },

    _registerWorkbenchPanel(record = {}) {
        const id = String(record.id || '').trim();
        if (!id) return null;
        const normalized = { ...record, id };
        this._workbenchPanelRecords.set(id, normalized);
        return normalized;
    },

    _refreshWorkbenchPanelVisibility() {
        if (this._viewerOnlyMode) return;
        if (!this.accordion) return;
        const workbenchId = this._getActiveWorkbenchId();
        for (const record of this._workbenchPanelRecords.values()) {
            const title = String(record.title || '');
            if (!title) continue;
            const visible = isSidePanelAllowed(record, workbenchId);
            if (visible) this.accordion.showSection?.(title);
            else this.accordion.hideSection?.(title);
        }
    },

    _normalizePluginSidePanelInput(titleOrSpec, content) {
        if (titleOrSpec && typeof titleOrSpec === 'object' && !Array.isArray(titleOrSpec)) {
            return {
                ...titleOrSpec,
                id: String(titleOrSpec.id || `plugin-panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
                title: String(titleOrSpec.title || titleOrSpec.id || 'Plugin'),
                content: titleOrSpec.content,
                source: titleOrSpec.source || 'plugin',
            };
        }
        return {
            id: `plugin-panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: String(titleOrSpec || 'Plugin'),
            content,
            source: 'plugin',
        };
    },

    // Apply a single queued plugin side panel entry

    async _applyPluginSidePanel(item) {
        if (this._viewerOnlyMode) return null;
        if (!this.accordion || typeof this.accordion.addSection !== 'function') return null;
        const panel = this._normalizePluginSidePanelInput(item);
        const t = String(panel.title || 'Plugin');
        const sec = await this.accordion.addSection(t);
        if (!sec) return null;
        try {
            if (typeof panel.content === 'function') {
                const el = await panel.content();
                if (el) sec.uiElement.appendChild(el);
            } else if (panel.content instanceof HTMLElement) {
                sec.uiElement.appendChild(panel.content);
            } else if (panel.content != null) {
                const pre = document.createElement('pre');
                pre.textContent = String(panel.content);
                sec.uiElement.appendChild(pre);
            }
            // Reposition this plugin section to immediately before the Display Settings panel, if present
            try {
                const root = this.accordion.uiElement;
                const targetTitle = root.querySelector('.accordion-title[name="accordion-title-Display Settings"]');
                if (targetTitle) {
                    const secTitle = root.querySelector(`.accordion-title[name="accordion-title-${t}"]`);
                    if (secTitle && sec.uiElement && secTitle !== targetTitle) {
                        root.insertBefore(secTitle, targetTitle);
                        root.insertBefore(sec.uiElement, targetTitle);
                    }
                }
            } catch { }
        } catch { }
        this._registerWorkbenchPanel({
            ...panel,
            title: t,
            section: sec,
        });
        this._refreshWorkbenchPanelVisibility();
        return sec;
    },

    // Public: allow plugins to register side panels; queued until core UI/toolbar are ready

    async addPluginSidePanel(titleOrSpec, content) {
        if (this._viewerOnlyMode) return null;
        const item = this._normalizePluginSidePanelInput(titleOrSpec, content);
        if (this._pluginUiReady) {
            try { return await this._applyPluginSidePanel(item); } catch { return null; }
        }
        this._pendingSidePanels = this._pendingSidePanels || [];
        this._pendingSidePanels.push(item);
        return null;
    },

    _refreshAssemblyConstraintsPanelVisibility() {
        if (this._viewerOnlyMode) return;
        if (!this.accordion || !this.accordion.uiElement) return;
        const shouldShow = isSidePanelAllowed({
            id: 'assemblyConstraints',
            source: 'builtin',
        }, this._getActiveWorkbenchId());
        const prevVisible = this._assemblyConstraintsVisible;
        this._assemblyConstraintsVisible = shouldShow;

        if (shouldShow) {
            this.accordion.showSection?.(ASSEMBLY_CONSTRAINTS_TITLE);
            if (prevVisible === false) {
                try { this.accordion.expandSection?.(ASSEMBLY_CONSTRAINTS_TITLE); } catch { /* ignore */ }
            }
        } else {
            const applied = this.accordion.hideSection?.(ASSEMBLY_CONSTRAINTS_TITLE);
            if (!applied) {
                // Retry once after next paint in case the nodes weren't available yet.
                setTimeout(() => {
                    try { this.accordion.hideSection?.(ASSEMBLY_CONSTRAINTS_TITLE); } catch { /* ignore */ }
                }, 0);
            }
        }

        if (prevVisible !== shouldShow) {
            // No-op; kept for future hooks
        }
    }

    // ----------------------------------------
    // Public API
    // ----------------------------------------
};

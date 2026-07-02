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

    setActiveWorkbench(workbenchId, options: any = {}) {
        const previous = this._getActiveWorkbenchId();
        const next = setPartActiveWorkbench(this.partHistory, normalizeWorkbenchId(workbenchId, previous));
        if (previous === next) return false;
        if (next === 'SIMULATION' && previous !== 'SIMULATION') {
            this._simulationWorkbenchReturnTarget = previous || 'MODELING';
        } else if (previous === 'SIMULATION' && next !== 'SIMULATION') {
            this._simulationWorkbenchReturnTarget = null;
        }
        if (next === 'CAM' && previous !== 'CAM') {
            this._camWorkbenchReturnTarget = previous || 'MODELING';
        } else if (previous === 'CAM' && next !== 'CAM') {
            this._camWorkbenchReturnTarget = null;
        }
        if (next === 'SIMULATION') {
            try { SelectionFilter.SetSelectionTypes([SelectionFilter.SOLID]); } catch { /* ignore */ }
        }
        if (next === 'CAM') {
            try { SelectionFilter.SetSelectionTypes([SelectionFilter.SOLID]); } catch { /* ignore */ }
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
        try { this.simulationWorkbenchManager?.setPlaying?.(false); } catch { /* ignore */ }
        return this.setActiveWorkbench(target, { queueHistorySnapshot: true });
    },

    finishCamWorkbench() {
        const target = this._camWorkbenchReturnTarget || 'MODELING';
        this._camWorkbenchReturnTarget = null;
        return this.setActiveWorkbench(target, { queueHistorySnapshot: true });
    },

    _syncSimulationFinishUi() {
        const active = this._getActiveWorkbenchId() === 'SIMULATION';
        if (active) return this._mountSimulationFinishUi();
        return this._removeSimulationFinishUi();
    },

    _syncCamFinishUi() {
        const active = this._getActiveWorkbenchId() === 'CAM';
        if (active) return this._mountCamFinishUi();
        return this._removeCamFinishUi();
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
            try { this.finishSimulationWorkbench(); } catch { /* ignore */ }
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
        } catch { /* ignore */ }
        return wrap;
    },

    _removeSimulationFinishUi() {
        try { this._simulationFinishUi?.remove?.(); } catch { /* ignore */ }
        this._simulationFinishUi = null;
        try { this.mainToolbar?.clearRightReserve?.(this._simulationFinishReserveKey); } catch { /* ignore */ }
        return null;
    },

    _mountCamFinishUi() {
        if (this._camFinishUi?.isConnected) return this._camFinishUi;
        const host = this.container || document.body || null;
        if (!host) return null;
        if (!document.getElementById('cam-finish-ui-styles')) {
            const style = document.createElement('style');
            style.id = 'cam-finish-ui-styles';
            style.textContent = `
                .cam-top-right {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    display: flex;
                    gap: 8px;
                    z-index: 1000;
                }
                .cam-top-right-btn {
                    appearance: none;
                    border: 1px solid #3c3424;
                    border-radius: 8px;
                    padding: 6px 10px;
                    cursor: pointer;
                    color: #fff7ed;
                    background: linear-gradient(180deg, rgba(234, 137, 51, .28), rgba(234, 137, 51, .16));
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
        wrap.className = 'cam-top-right';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cam-top-right-btn';
        btn.textContent = 'Finish';
        btn.title = 'Finish CAM';
        btn.addEventListener('click', () => {
            try { this.finishCamWorkbench(); } catch { /* ignore */ }
        });
        wrap.appendChild(btn);
        host.appendChild(wrap);
        this._camFinishUi = wrap;
        try {
            this.mainToolbar?.reserveRightSpaceForElement?.(
                this._camFinishReserveKey,
                wrap,
                { extraPx: 16, minPx: 84 },
            );
        } catch { /* ignore */ }
        return wrap;
    },

    _removeCamFinishUi() {
        try { this._camFinishUi?.remove?.(); } catch { /* ignore */ }
        this._camFinishUi = null;
        try { this.mainToolbar?.clearRightReserve?.(this._camFinishReserveKey); } catch { /* ignore */ }
        return null;
    },

    async _ensureSimulationWorkbenchManager() {
        if (this.simulationWorkbenchManager) return this.simulationWorkbenchManager;
        if (this._simulationWorkbenchManagerPromise) return this._simulationWorkbenchManagerPromise;

        this._simulationWorkbenchManagerPromise = (async () => {
            try {
                const { SimulationWorkbenchManager } = await import('../../simulation/SimulationWorkbenchManager.js');
                if (this._disposed) return null;
                if (!this.simulationWorkbenchManager) {
                    this.simulationWorkbenchManager = new SimulationWorkbenchManager(this);
                }
                return this.simulationWorkbenchManager;
            } catch (error) {
                try { console.warn('[Viewer] Failed to load simulation workbench manager', error); } catch { /* ignore */ }
                return null;
            } finally {
                this._simulationWorkbenchManagerPromise = null;
            }
        })();

        return this._simulationWorkbenchManagerPromise;
    },

    async _ensureCamWorkbenchManager() {
        if (this.camWorkbenchManager) return this.camWorkbenchManager;
        if (this._camWorkbenchManagerPromise) return this._camWorkbenchManagerPromise;

        this._camWorkbenchManagerPromise = (async () => {
            try {
                const { CamWorkbenchManager } = await import('../../cam/CamWorkbenchManager.js');
                if (this._disposed) return null;
                if (!this.camWorkbenchManager) {
                    this.camWorkbenchManager = new CamWorkbenchManager(this);
                }
                return this.camWorkbenchManager;
            } catch (error) {
                try { console.warn('[Viewer] Failed to load CAM workbench manager', error); } catch { /* ignore */ }
                return null;
            } finally {
                this._camWorkbenchManagerPromise = null;
            }
        })();

        return this._camWorkbenchManagerPromise;
    },

    refreshWorkbenchUi() {
        if (this._viewerOnlyMode) return;
        const isSimulationWorkbench = this._getActiveWorkbenchId() === 'SIMULATION';
        const isCamWorkbench = this._getActiveWorkbenchId() === 'CAM';
        if (isSimulationWorkbench) {
            void this._ensureSimulationWorkbenchManager().then((manager) => {
                try { manager?.setActive?.(this._getActiveWorkbenchId() === 'SIMULATION'); } catch { /* ignore */ }
            });
        } else {
            try { this.simulationWorkbenchManager?.setActive?.(false); } catch { /* ignore */ }
        }
        if (isCamWorkbench) {
            void this._ensureCamWorkbenchManager().then((manager) => {
                try { manager?.setActive?.(this._getActiveWorkbenchId() === 'CAM'); } catch { /* ignore */ }
            });
        } else {
            try { this.camWorkbenchManager?.setActive?.(false); } catch { /* ignore */ }
        }
        try { this.historyWidget?.refreshWorkbenchUi?.(); } catch { /* ignore */ }
        try { SelectionFilter.refreshSelectionActions?.(); } catch { /* ignore */ }
        try { this._refreshWorkbenchPanelVisibility(); } catch { /* ignore */ }
        try { this.mainToolbar?.refreshButtons?.(); } catch { /* ignore */ }
        try { this._syncSimulationFinishUi(); } catch { /* ignore */ }
        try { this._syncCamFinishUi(); } catch { /* ignore */ }
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
        } catch { /* ignore */ }
        try {
            if (this.pmiViewsWidget) {
                this.pmiViewsWidget.refreshFromHistory?.();
                this.pmiViewsWidget._renderList?.();
            }
        } catch { /* ignore */ }
        try {
            if (this.sheet2DWidget) {
                this.sheet2DWidget.refreshFromHistory?.();
                this.sheet2DWidget._renderList?.();
            }
            this._sheet2DEditorWindow?.refreshFromHistory?.();
        } catch { /* ignore */ }
        try {
            this.simulationHistoryWidget?.refreshFromHistory?.();
        } catch { /* ignore */ }
        try {
            this.camHistoryWidget?.refreshFromHistory?.();
        } catch { /* ignore */ }
        try {
            if (this.wireHarnessConnectionsWidget) {
                this.wireHarnessConnectionsWidget.refreshFromHistory?.();
                this.wireHarnessConnectionsWidget._renderList?.();
            }
        } catch { /* ignore */ }
        try { this.historyWidget?.render?.(); } catch { /* ignore */ }
        try { this.refreshWorkbenchUi(); } catch { /* ignore */ }
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
        } catch { /* ignore */ }
        try { this._syncHistoryUiAfterUndoRedo(); } catch { /* ignore */ }
        return changed;
    },

    _registerWorkbenchPanel(record: any = {}) {
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
            if (record._visible !== visible) {
                record._visible = visible;
                if (typeof record.onVisibilityChange === 'function') {
                    try { record.onVisibilityChange(visible, record, workbenchId); } catch { /* ignore panel visibility hooks */ }
                }
            }
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
            // Reposition this plugin section to immediately before the built-in Plugins panel, if present.
            try {
                const root = this.accordion.uiElement;
                const targetTitle = root.querySelector('.accordion-title[name="accordion-title-Plugins"]');
                if (targetTitle) {
                    const secTitle = root.querySelector(`.accordion-title[name="accordion-title-${t}"]`);
                    if (secTitle && sec.uiElement && secTitle !== targetTitle) {
                        root.insertBefore(secTitle, targetTitle);
                        root.insertBefore(sec.uiElement, targetTitle);
                    }
                }
            } catch { /* ignore */ }
        } catch { /* ignore */ }
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

import brepHomeBannerSvg from '../../assets/brand/brep-home-banner.svg?raw';
import { loadSavedPlugins } from '../../plugins/pluginManager.js';

import { AccordionWidget } from '../AccordionWidget.js';
import { AssemblyConstraintsWidget } from '../assembly/AssemblyConstraintsWidget.js';
import { CamHistoryWidget } from '../cam/CamHistoryWidget.js';
import { CADmaterialWidget } from '../CADmaterials.js';
import { expressionsManager } from '../expressionsManager.js';
import { SchemaForm } from '../featureDialogs.js';
import { FloatingWindow } from '../FloatingWindow.js';
import { FileManagerWidget } from '../fileManagerWidget.js';
import { HistoryWidget } from '../HistoryWidget.js';
import { MainToolbar } from '../MainToolbar.js';
import { PluginsWidget } from '../PluginsWidget.js';
import { PMIViewsWidget } from '../pmi/PMIViewsWidget.js';
import { SceneListing } from '../SceneListing.js';
import { SelectionFilter } from '../SelectionFilter.js';
import { SimulationHistoryWidget } from '../simulation/SimulationHistoryWidget.js';
import { Sheet2DWidget } from '../sheets/Sheet2DWidget.js';
import { maybeStartStartupTour } from '../startupTour.js';
import { navigateHomeWithGuard } from '../toolbarButtons/homeButton.js';
import { registerDefaultToolbarButtons } from '../toolbarButtons/registerDefaultButtons.js';
import { registerSelectionToolbarButtons } from '../toolbarButtons/registerSelectionButtons.js';
import { WireHarnessConnectionsWidget } from '../wireHarness/WireHarnessConnectionsWidget.js';
import { ASSEMBLY_CONSTRAINTS_TITLE, SIDEBAR_HOME_BANNER_HEIGHT_PX } from './constants.js';

export const sidebarMethods = {
    _ensureSettingsWindowStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('cad-settings-window-styles')) return;
        const style = document.createElement('style');
        style.id = 'cad-settings-window-styles';
        style.textContent = `
            .cad-settings-window {
                display: flex;
                flex-direction: column;
                gap: 0;
                width: 100%;
                height: 100%;
                min-height: 0;
                box-sizing: border-box;
            }
            .cad-settings-window .cmw {
                max-width: none;
            }
        `;
        document.head.appendChild(style);
    },

    openSettingsDialog() {
        if (typeof document === 'undefined') return null;
        this._ensureSettingsWindowStyles();
        if (!this.cadMaterialsUi) {
            try { this.cadMaterialsUi = new CADmaterialWidget(this); } catch { return null; }
        }
        if (this._settingsWindow?.root?.isConnected) {
            try {
                this._settingsWindow.show?.();
            } catch { /* ignore */ }
            return this._settingsWindow;
        }

        const pageWidth = Number(window?.innerWidth) || 900;
        const pageHeight = Number(window?.innerHeight) || 720;
        const fw = new FloatingWindow({
            title: 'Display Settings',
            width: Math.max(420, Math.min(760, pageWidth - 32)),
            height: Math.max(360, Math.min(720, pageHeight - 80)),
            minWidth: 360,
            minHeight: 260,
            right: 16,
            top: 56,
            shaded: false,
            onClose: () => {
                try { fw.hide(); } catch { /* ignore */ }
            },
        });

        const content = document.createElement('div');
        content.className = 'cad-settings-window';
        content.appendChild(this.cadMaterialsUi.uiElement);
        fw.content.appendChild(content);
        this._settingsWindow = fw;
        return fw;
    },

    _setSidebarAutoHideSuspended(suspended) {
        const next = !!suspended;
        if (this._sidebarAutoHideSuspended === next) return;
        this._sidebarAutoHideSuspended = next;
        this._syncSidebarVisibility();
    },

    _setSidebarPinned(pinned) {
        const next = !!pinned;
        if (this._sidebarPinned === next) return;
        this._sidebarPinned = next;
        if (!next && this._sidebarAutoHideSuspended) {
            // Allow explicit user collapse even when auto-hide is suspended (e.g. sketch mode).
            this._sidebarAutoHideSuspended = false;
        }
        if (next) {
            this._sidebarHoverVisible = false;
        } else {
            if (this._sidebarHoverTargets) this._sidebarHoverTargets.clear();
            this._sidebarHoverVisible = false;
        }
        this._syncSidebarVisibility();
    },

    _setSidebarHoverVisible(visible) {
        const next = !!visible;
        if (this._sidebarHoverVisible === next) return;
        this._sidebarHoverVisible = next;
        this._syncSidebarVisibility();
    },

    _refreshSidebarHoverTargetsFromPointer() {
        const targets = this._sidebarHoverTargets;
        const pos = this._sidebarLastPointer;
        if (!targets || !pos) return;
        targets.clear();
        const { x, y } = pos;
        const addIfHit = (el, requireVisible = false) => {
            if (!el) return;
            if (requireVisible && !this._isSidebarVisible()) return;
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            if (!rect || rect.width <= 0 || rect.height <= 0) return;
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                targets.add(el);
            }
        };
        addIfHit(this._sidebarHoverStrip);
        addIfHit(this._sidebarPinTab, true);
        addIfHit(this.sidebar, true);
        addIfHit(this._sidebarResizer, true);
    },

    _getSidebarShouldShow() {
        if (!this.sidebar) return false;
        if (this._sidebarAutoHideSuspended) return true;
        if (this._sidebarPinned) return true;
        return !!this._sidebarHoverVisible;
    },

    _isSidebarVisible() {
        if (!this.sidebar) return false;
        return !this._sidebarOffscreen
            && !this.sidebar.hidden
            && this.sidebar.style.display !== 'none'
            && this.sidebar.style.visibility !== 'hidden';
    },

    _setSidebarElementVisible(visible) {
        if (!this.sidebar) return;
        const isVisible = this._isSidebarVisible();
        // Ensure the sidebar stays in the render tree even when collapsed.
        try { if (this.sidebar.hidden) this.sidebar.hidden = false; } catch { /* ignore detached sidebar state */ }
        if (this.sidebar.style.display === 'none') {
            if (this._sidebarStoredDisplay != null) {
                this.sidebar.style.display = this._sidebarStoredDisplay;
            } else {
                try { this.sidebar.style.removeProperty('display'); } catch { /* ignore readonly style failures */ }
                this.sidebar.style.display = this.sidebar.style.display || '';
            }
        }
        if (this.sidebar.style.visibility === 'hidden') {
            const visibility = this._sidebarStoredVisibility;
            this.sidebar.style.visibility = visibility && visibility !== 'hidden' ? visibility : 'visible';
        }
        if (visible) {
            if (!isVisible) {
                if (this._sidebarStoredTransform != null) {
                    this.sidebar.style.transform = this._sidebarStoredTransform;
                } else {
                    try { this.sidebar.style.removeProperty('transform'); } catch { /* ignore readonly style failures */ }
                    this.sidebar.style.transform = this.sidebar.style.transform || '';
                }
                if (this._sidebarStoredPointerEvents != null) {
                    this.sidebar.style.pointerEvents = this._sidebarStoredPointerEvents;
                } else {
                    try { this.sidebar.style.removeProperty('pointer-events'); } catch { /* ignore readonly style failures */ }
                    this.sidebar.style.pointerEvents = this.sidebar.style.pointerEvents || '';
                }
            }
            this.sidebar.style.opacity = .9;
            this.sidebar.style.zIndex = String(7);
            this._sidebarOffscreen = false;
        } else {
            if (!this._sidebarOffscreen) {
                this._sidebarStoredDisplay = this.sidebar.style.display || '';
                this._sidebarStoredVisibility = this.sidebar.style.visibility || '';
                this._sidebarStoredTransform = this.sidebar.style.transform || '';
                this._sidebarStoredPointerEvents = this.sidebar.style.pointerEvents || '';
            }
            this.sidebar.style.transform = 'translateX(calc(-100% - 12px))';
            this.sidebar.style.pointerEvents = 'none';
            this._sidebarOffscreen = true;
        }
        try { this.mainToolbar?._positionWithSidebar?.(); } catch { /* ignore toolbar layout failures */ }
    },

    _updateSidebarDockUI() {
        const tab = this._sidebarPinTab;
        const strip = this._sidebarHoverStrip;
        const pinned = !!this._sidebarPinned;
        const hoverActive = !pinned && !this._sidebarAutoHideSuspended;
        if (tab) {
            tab.classList.toggle('is-pinned', pinned);
            tab.setAttribute('aria-pressed', pinned ? 'true' : 'false');
            tab.textContent = '📌';
            tab.title = pinned ? 'Collapse sidebar' : 'Pin sidebar';
        }
        if (strip) {
            strip.classList.toggle('is-active', hoverActive);
            strip.style.pointerEvents = hoverActive ? 'auto' : 'none';
        }
        this._positionSidebarPinTab();
    },

    _positionSidebarPinTab() {
        const tab = this._sidebarPinTab;
        if (!tab) return;
        let left = 0;
        let top = 72;
        const rect = this.sidebar?.getBoundingClientRect?.();
        if (rect && rect.width > 0) {
            left = Math.max(0, Math.round(rect.right - 1));
        }
        if (rect && rect.height > 0) {
            const tabHeight = tab.getBoundingClientRect ? tab.getBoundingClientRect().height : tab.offsetHeight;
            const nextTop = rect.top + (rect.height - (tabHeight || 0)) / 2;
            if (Number.isFinite(nextTop)) top = Math.max(0, Math.round(nextTop));
        }
        tab.style.left = `${left}px`;
        tab.style.top = `${top}px`;
    },

    _syncSidebarVisibility() {
        const shouldShow = this._getSidebarShouldShow();
        this._setSidebarElementVisible(shouldShow);
        this._updateSidebarDockUI();
    },

    _syncSidebarHomeBannerHeight() {
        const banner = this._sidebarHomeBanner;
        if (!banner) return;
        const px = `${SIDEBAR_HOME_BANNER_HEIGHT_PX}px`;
        banner.style.height = px;
        banner.style.minHeight = px;
        banner.style.maxHeight = px;
    },

    _bindSidebarHomeBannerHeightSync() {
        try { this._sidebarHomeBannerRO?.disconnect?.(); } catch { /* ignore */ }
        this._sidebarHomeBannerRO = null;
    },

    _ensureSidebarHomeBanner() {
        if (!this.sidebar || typeof document === 'undefined') return;
        const opensExternalHome = !!this._homeBannerUrl;
        let banner = this._sidebarHomeBanner;
        if (!banner || !banner.isConnected) {
            try {
                const existing = this.sidebar.querySelector('.cad-sidebar-home-banner');
                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            } catch { /* ignore */ }

            banner = document.createElement('A');
            banner.href = this._homeBannerUrl + "../" || '#';
            banner.type = 'button';
            banner.className = 'cad-sidebar-home-banner';
            banner.title = opensExternalHome ? 'Open BREP.io' : 'Back to workspace';
            banner.setAttribute('aria-label', opensExternalHome ? 'Open BREP.io' : 'Back to workspace');
            banner.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this._homeBannerUrl) {
                    try {
                        console.error('Opening home page' + (this._homeBannerOpenInNewTab ? ' in a new tab.' : '.'));
                        const target = this._homeBannerOpenInNewTab ? '_blank' : '_self';
                        const opened = window.open(
                            this._homeBannerUrl,
                            target,
                            this._homeBannerOpenInNewTab ? 'noopener,noreferrer' : 'noopener',
                        );
                        if (opened && this._homeBannerOpenInNewTab) {
                            try { opened.opener = null; } catch { /* ignore */ }
                        }
                    } catch {
                        try { window.location.href = this._homeBannerUrl; } catch { /* ignore */ }
                    }
                    return;
                }
                alert('No home URL configured');
                void navigateHomeWithGuard(this);
            });

            const logo = document.createElement('span');
            logo.className = 'cad-sidebar-home-banner-img';
            logo.setAttribute('aria-hidden', 'true');
            logo.innerHTML = brepHomeBannerSvg;
            const svg = logo.querySelector('svg');
            if (svg) {
                svg.setAttribute('focusable', 'false');
            }
            banner.appendChild(logo);

            this.sidebar.prepend(banner);
            this._sidebarHomeBanner = banner;
        } else if (banner.parentNode !== this.sidebar) {
            this.sidebar.prepend(banner);
        }
        this._syncSidebarHomeBannerHeight();
    },

    async setupAccordion() {
        const shouldShowSidebarHomeBanner = !this._viewerOnlyMode || !!this._homeBannerUrl;
        if (shouldShowSidebarHomeBanner) this._ensureSidebarHomeBanner();
        // Setup accordion
        this.accordion = await new AccordionWidget();
        await this.sidebar.appendChild(this.accordion.uiElement);

        if (!this._viewerOnlyMode) {
            // Load saved plugins early (before File Manager autoloads last model)
            // Defer rendering of plugin side panels until proper placement later.
            try {
                await loadSavedPlugins(this);
            } catch (e) { console.warn('Plugin auto-load failed:', e); }
        }

        const fm = new FileManagerWidget(this, { autoLoadLast: this._autoLoadLastModel });
        // Keep FileManagerWidget as a headless service for save/load/new actions,
        // but do not mount it in the CAD sidebar accordion.
        this.fileManagerWidget = fm;

        this.partHistory.callbacks.run = async (featureID) => {
            void featureID;
        };
        this.partHistory.callbacks.reset = async () => {
            // no-op
        };
        this.partHistory.callbacks.afterRunHistory = () => {
            this._refreshAssemblyConstraintsPanelVisibility();
            this.refreshWorkbenchUi();
            this.applyMetadataColors();
            this._axisHelpersDirty = true;
            void this._syncWireHarnessRoutesFromHistoryState({ reason: 'after-run-history' });
        };
        this.partHistory.callbacks.afterReset = () => {
            try {
                SchemaForm.clearReferenceSelectionGhosts?.(this.partHistory?.scene || this.scene || null);
            } catch { /* ignore */ }
            this._refreshAssemblyConstraintsPanelVisibility();
            this.refreshWorkbenchUi();
            this.applyMetadataColors();
            this._axisHelpersDirty = true;
            void this.clearWireHarnessRoutes({ reason: 'after-reset' });
        };

        if (this._viewerOnlyMode) {
            // Viewer-only layout: keep only read-only panels for embedding.
            this.sceneManagerUi = await new SceneListing(this.scene, {
                onSelection: (obj) => this._applySelectionTarget(obj, { triggerOnClick: false, allowDiagnostics: false }),
                onRender: () => this.render(),
            });
            const sceneSection = await this.accordion.addSection("Scene Manager");
            await sceneSection.uiElement.appendChild(this.sceneManagerUi.uiElement);

            this.pmiViewsWidget = new PMIViewsWidget(this, { readOnly: true });
            const pmiViewsSection = await this.accordion.addSection("PMI Views");
            pmiViewsSection.uiElement.appendChild(this.pmiViewsWidget.uiElement);

            this.sheet2DWidget = new Sheet2DWidget(this, { readOnly: true });
            const sheetsSection = await this.accordion.addSection("2D Sheets");
            sheetsSection.uiElement.appendChild(this.sheet2DWidget.uiElement);

            this.cadMaterialsUi = await new CADmaterialWidget(this);

            this._pluginUiReady = false;
            await this.accordion.collapseAll();
            await this.accordion.expandSection("Scene Manager");
            await this.accordion.expandSection("PMI Views");
            await this.accordion.expandSection("2D Sheets");

            this._refreshAssemblyConstraintsPanelVisibility();
            this._syncSidebarHomeBannerHeight();
            this._bindSidebarHomeBannerHeightSync();
            try { this.renderer.domElement.style.marginTop = '0px'; } catch { /* ignore renderer style failures */ }
            return;
        }

        // Setup historyWidget
        this.historyWidget = await new HistoryWidget(this);
        const historySection = await this.accordion.addSection("History");
        await historySection.uiElement.appendChild(await this.historyWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'featureHistory',
            title: 'History',
            section: historySection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
            onVisibilityChange: (visible) => this.historyWidget?.setContextSuppressionEnabled?.(visible),
        });

        this.assemblyConstraintsWidget = new AssemblyConstraintsWidget(this);
        this._assemblyConstraintsSection = await this.accordion.addSection(ASSEMBLY_CONSTRAINTS_TITLE);
        this._assemblyConstraintsSection.uiElement.appendChild(this.assemblyConstraintsWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'assemblyConstraints',
            title: ASSEMBLY_CONSTRAINTS_TITLE,
            section: this._assemblyConstraintsSection,
            source: 'builtin',
        });

        // setup expressions
        this.expressionsManager = await new expressionsManager(this);
        const expressionsSection = await this.accordion.addSection("Expressions");
        await expressionsSection.uiElement.appendChild(await this.expressionsManager.uiElement);
        this._registerWorkbenchPanel({
            id: 'expressions',
            title: 'Expressions',
            section: expressionsSection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'SIMULATION', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
        });

        // Setup sceneManagerUi
        this.sceneManagerUi = await new SceneListing(this.scene, {
            onSelection: (obj) => this._applySelectionTarget(obj, { triggerOnClick: false, allowDiagnostics: false }),
            onRender: () => this.render(),
        });
        const sceneSection = await this.accordion.addSection("Scene Manager");
        await sceneSection.uiElement.appendChild(this.sceneManagerUi.uiElement);
        this._registerWorkbenchPanel({
            id: 'sceneManager',
            title: 'Scene Manager',
            section: sceneSection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'SIMULATION', 'CAM', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
        });

        // PMI Views (saved camera snapshots)
        this.pmiViewsWidget = new PMIViewsWidget(this);
        const pmiViewsSection = await this.accordion.addSection("PMI Views");
        pmiViewsSection.uiElement.appendChild(this.pmiViewsWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'pmiViews',
            title: 'PMI Views',
            section: pmiViewsSection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
        });

        this.sheet2DWidget = new Sheet2DWidget(this);
        const sheetsSection = await this.accordion.addSection("2D Sheets");
        sheetsSection.uiElement.appendChild(this.sheet2DWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'sheets2D',
            title: '2D Sheets',
            section: sheetsSection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
        });

        this.wireHarnessConnectionsWidget = new WireHarnessConnectionsWidget(this);
        const wireHarnessSection = await this.accordion.addSection('Wire Harness');
        wireHarnessSection.uiElement.appendChild(this.wireHarnessConnectionsWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'wireHarnessConnections',
            title: 'Wire Harness',
            section: wireHarnessSection,
            source: 'builtin',
        });

        this.simulationHistoryWidget = new SimulationHistoryWidget(this);
        const simulationSection = await this.accordion.addSection('Simulation');
        simulationSection.uiElement.appendChild(this.simulationHistoryWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'simulationHistory',
            title: 'Simulation',
            section: simulationSection,
            source: 'builtin',
            workbenches: ['SIMULATION'],
            onVisibilityChange: (visible) => this.simulationHistoryWidget?.setPanelVisible?.(visible),
        });

        this.camHistoryWidget = new CamHistoryWidget(this);
        const camHistorySection = await this.accordion.addSection('CAM History');
        camHistorySection.uiElement.appendChild(this.camHistoryWidget.historyEl);
        this._registerWorkbenchPanel({
            id: 'camHistory',
            title: 'CAM History',
            section: camHistorySection,
            source: 'builtin',
            workbenches: ['CAM'],
            defaultExpanded: true,
            onVisibilityChange: (visible) => this.camHistoryWidget?.setPanelVisible?.(visible),
        });

        const camMachineSection = await this.accordion.addSection('Machine Configuration');
        camMachineSection.uiElement.appendChild(this.camHistoryWidget.machineConfigEl);
        this._registerWorkbenchPanel({
            id: 'camMachineConfiguration',
            title: 'Machine Configuration',
            section: camMachineSection,
            source: 'builtin',
            workbenches: ['CAM'],
            defaultExpanded: false,
        });

        const camGcodeSection = await this.accordion.addSection('G-code');
        camGcodeSection.uiElement.appendChild(this.camHistoryWidget.gcodeEl);
        this._registerWorkbenchPanel({
            id: 'camGcode',
            title: 'G-code',
            section: camGcodeSection,
            source: 'builtin',
            workbenches: ['CAM'],
            defaultExpanded: false,
        });

        // CADmaterials (Settings dialog)
        this.cadMaterialsUi = await new CADmaterialWidget(this);

        // From this point on, plugin UI can be added immediately,
        // and should be inserted before the built-in Plugins panel.
        this._pluginUiReady = true;

        // Drain any queued plugin side panels so they appear immediately before settings
        try {
            const q = Array.isArray(this._pendingSidePanels) ? this._pendingSidePanels : [];
            this._pendingSidePanels = [];
            for (const it of q) {
                try { await this._applyPluginSidePanel(it); } catch { /* ignore invalid queued plugin panels */ }
            }
        } catch { /* ignore plugin side panel drain failures */ }

        // Plugin setup panel (after settings)
        const pluginsSection = await this.accordion.addSection('Plugins');
        const pluginsWidget = new PluginsWidget(this);
        pluginsSection.uiElement.appendChild(pluginsWidget.uiElement);
        this._registerWorkbenchPanel({
            id: 'plugins',
            title: 'Plugins',
            section: pluginsSection,
            source: 'builtin',
            workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'],
        });

        await this.accordion.collapseAll();
        await this.accordion.expandSection("Scene Manager");

        await this.accordion.expandSection("History");
        if (this._getActiveWorkbenchId() === 'ASSEMBLIES') {
            await this.accordion.expandSection(ASSEMBLY_CONSTRAINTS_TITLE);
        }
        await this.accordion.expandSection("PMI Views");

        this._refreshAssemblyConstraintsPanelVisibility();
        this._refreshWorkbenchPanelVisibility();


        // Mount the main toolbar (layout only; buttons registered externally)
        this.mainToolbar = new MainToolbar(this);
        // Register core/default toolbar buttons via the public API
        try { registerDefaultToolbarButtons(this); } catch { /* ignore toolbar registration failures */ }
        // Register selection-context toolbar buttons (shown based on selection)
        try { registerSelectionToolbarButtons(this); } catch { /* ignore selection toolbar registration failures */ }
        try { SelectionFilter.refreshSelectionActions?.(); } catch { /* ignore selection action refresh failures */ }
        // Drain any queued custom toolbar buttons from early plugin registration
        try {
            const q = Array.isArray(this._pendingToolbarButtons) ? this._pendingToolbarButtons : [];
            this._pendingToolbarButtons = [];
            for (const it of q) {
                try { this.mainToolbar.addCustomButton(it); } catch { /* ignore invalid queued toolbar button */ }
            }
        } catch { /* ignore queued toolbar drain failures */ }
        try { this.refreshWorkbenchUi(); } catch { /* ignore initial workbench UI refresh failures */ }
        void this.clearWireHarnessRoutes({ reason: 'setup-accordion' });
        this._syncSidebarHomeBannerHeight();
        this._bindSidebarHomeBannerHeightSync();

        // Ensure toolbar sits above the canvas and doesn't block controls when not hovered
        try { this.renderer.domElement.style.marginTop = '0px'; } catch { /* ignore renderer style failures */ }

        // Start the startup tour once the core UI is mounted, if not already completed.
        try { await maybeStartStartupTour(this); } catch { /* ignore startup tour failures */ }
    }
};

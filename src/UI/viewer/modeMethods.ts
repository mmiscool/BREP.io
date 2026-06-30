import { setSketchFeatureSceneVisibility } from '../../utils/sketchFeatureVisibility.js';

import { SchemaForm } from '../featureDialogs.js';
import { PMIMode } from '../pmi/PMIMode.js';
import { Sheet2DEditorWindow } from '../sheets/Sheet2DEditorWindow.js';
import { SketchMode3D } from '../sketcher/SketchMode3D.js';
import { debugLog } from './debug.js';
import { safe } from './utils.js';

export const modeMethods = {
    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        try { this.simulationWorkbenchManager?.dispose?.(); } catch { /* ignore */ }
        cancelAnimationFrame(this._raf);
        if (this._hoverRefreshRaf != null) {
            cancelAnimationFrame(this._hoverRefreshRaf);
            this._hoverRefreshRaf = null;
        }
        try { this.endPMIPreviewMode(); } catch { /* ignore */ }
        try { this._stopComponentTransformSession(); } catch { /* ignore */ }
        try { this.sheet2DWidget?.dispose?.(); } catch { /* ignore */ }
        try { this.wireHarnessConnectionsWidget?.dispose?.(); } catch { /* ignore */ }
        try { this._sheet2DEditorWindow?.dispose?.(); } catch { /* ignore */ }
        this._sheet2DEditorWindow = null;
        safe(() => this._sidebarDockController?.dispose());
        this._sidebarDockController = null;
        safe(() => this._sidebarHomeBannerRO?.disconnect?.());
        this._sidebarHomeBannerRO = null;
        safe(() => {
            if (this._sidebarHomeBanner && this._sidebarHomeBanner.parentNode) {
                this._sidebarHomeBanner.parentNode.removeChild(this._sidebarHomeBanner);
            }
        });
        this._sidebarHomeBanner = null;
        const el = this.renderer?.domElement;
        this._detachRendererEvents(el);
        try { this.camera?.disableIdleCallbacks?.(); } catch { /* ignore */ }
        window.removeEventListener('pointerup', this._onPointerUp, { capture: true });
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('hover-changed', this._onHoverChanged);
        try {
            const btn = this._cameraProjectionToggleButton;
            if (btn) {
                btn.removeEventListener('click', this._onCameraProjectionToggleClick);
                btn.remove();
            }
        } catch { /* ignore */ }
        this._cameraProjectionToggleButton = null;
        try { this.viewCube?.dispose?.(); } catch { /* ignore */ }
        this.viewCube = null;
        this.controls?.dispose?.();
        this._disposeWebglPostProcessing();
        this.renderer?.dispose?.();
        if (this._webglRenderer && this._webglRenderer !== this.renderer) {
            try { this._webglRenderer.dispose(); } catch { /* ignore */ }
        }
        try {
            for (const fw of this._inspectorLinkedWindows || []) {
                try { fw.destroy?.(); } catch { /* ignore */ }
            }
            this._inspectorLinkedWindows?.clear?.();
        } catch { /* ignore */ }
        try { if (this._sketchMode) this._sketchMode.dispose(); } catch { /* ignore */ }
        try { if (this._splineMode) this._splineMode.dispose(); } catch { /* ignore */ }
        if (el && el.parentNode) el.parentNode.removeChild(el);
    },

    // ----------------------------------------
    // Sketch Mode API
    // ----------------------------------------

    deactivateSketchPlaneSelection() {
        try {
            return SchemaForm.deactivateActiveReferenceSelection?.('sketchPlane', this.partHistory?.scene || this.scene || null) === true;
        } catch {
            return false;
        }
    },

    startSketchMode(featureID) {
        if (this._viewerOnlyMode) return;
        // Hide the sketch in the scene if it exists
        setSketchFeatureSceneVisibility(this.partHistory, featureID, false);

        debugLog('Starting Sketch Mode for featureID:', featureID);
        debugLog(this.partHistory.scene);
        debugLog(this.partHistory);
        debugLog(this);

        try { if (this._sketchMode) this._sketchMode.dispose(); } catch { /* ignore */ }
        try {
            if (!this._sketchSidebarPrev) {
                this._sketchSidebarPrev = {
                    pinned: this._sidebarPinned,
                    autoHideSuspended: this._sidebarAutoHideSuspended,
                    hoverVisible: this._sidebarHoverVisible,
                };
            }
            this._setSidebarPinned(false);
            this._setSidebarAutoHideSuspended(false);
            this._setSidebarHoverVisible(false);
        } catch { /* ignore */ }
        this._sketchMode = new SketchMode3D(this, featureID, {
            useFatCurveLines: true,
        });
        this._sketchMode.open();


    },

    onSketchFinished(featureID, sketchObject) {
        const ph = this.partHistory;
        if (!ph || !featureID) return;
        // Always restore normal UI first
        this.endSketchMode(featureID);
        const f = Array.isArray(ph.features) ? ph.features.find(x => x?.inputParams?.featureID === featureID) : null;
        if (!f) return;
        f.lastRunInputParams = {};
        f.timestamp = 0;
        f.dirty = true;
        f.persistentData = f.persistentData || {};
        f.persistentData.sketch = sketchObject || {};
        // re-run to keep downstream in sync (even if SketchFeature.run has no output yet)
        try {
            const runPromise = ph.runHistory();
            if (runPromise && typeof runPromise.then === 'function') {
                void (async () => {
                    try {
                        await runPromise;
                        ph.queueHistorySnapshot?.({ debounceMs: 0, reason: 'sketch' });
                    } catch (error) {
                        console.warn('[Viewer] Sketch history run failed:', error);
                    } finally {
                        setSketchFeatureSceneVisibility(ph, featureID, true);
                    }
                })();
            } else {
                setSketchFeatureSceneVisibility(ph, featureID, true);
                ph.queueHistorySnapshot?.({ debounceMs: 0, reason: 'sketch' });
            }
        } catch {
            setSketchFeatureSceneVisibility(ph, featureID, true);
        }
    },

    onSketchCancelled(featureID) {
        this.endSketchMode(featureID);
    },

    endSketchMode(featureID = null) {
        const activeSketchFeatureID = featureID || this._sketchMode?.featureID || null;
        try { if (this._sketchMode) this._sketchMode.close(); } catch { /* ignore */ }
        this._sketchMode = null;
        setSketchFeatureSceneVisibility(this.partHistory, activeSketchFeatureID, true);
        // Ensure core UI is visible and controls enabled
        const prevSidebar = this._sketchSidebarPrev;
        this._sketchSidebarPrev = null;
        if (prevSidebar) {
            try { this._setSidebarPinned(!!prevSidebar.pinned); } catch { /* ignore */ }
            try { this._setSidebarAutoHideSuspended(!!prevSidebar.autoHideSuspended); } catch { /* ignore */ }
            try { this._setSidebarHoverVisible(!!prevSidebar.hoverVisible); } catch { /* ignore */ }
        } else {
            try { this._setSidebarAutoHideSuspended(false); } catch { /* ignore */ }
        }
        try { if (this.controls) this.controls.enabled = true; } catch { /* ignore */ }

        // Clean up any legacy overlays that might still be mounted (from old 2D mode)
        try {
            const c = this.container;
            if (c && typeof c.querySelectorAll === 'function') {
                const leftovers = c.querySelectorAll('.sketch-overlay');
                leftovers.forEach(el => { try { el.parentNode && el.parentNode.removeChild(el); } catch { /* ignore */ } });
            }
        } catch { /* ignore */ }
    },

    // ----------------------------------------
    // Spline Mode API
    // ----------------------------------------

    startSplineMode(splineSession) {
        if (this._viewerOnlyMode) return;
        debugLog('Starting Spline Mode for session:', splineSession);
        this._splineMode = splineSession;
    },

    endSplineMode() {
        debugLog('Ending Spline Mode');
        this._splineMode = null;
    },

    // ----------------------------------------
    // PMI Edit Mode API
    // ----------------------------------------

    _collapseExpandedDialogsForModeSwitch() {
        try { this.historyWidget?.collapseExpandedEntries?.({ clearOpenState: true, notify: false }); } catch { /* ignore */ }
        try { this.assemblyConstraintsWidget?.collapseExpandedDialogs?.(); } catch { /* ignore */ }
        try { this._pmiMode?.collapseExpandedDialogs?.(); } catch { /* ignore */ }
    },

    startPMIPreviewMode(viewEntry, viewIndex, widget = this.pmiViewsWidget) {
        if (!this._viewerOnlyMode) return;
        try { this.endPMIPreviewMode(); } catch { /* ignore */ }
        try {
            this._pmiPreviewMode = new PMIMode(this, viewEntry, viewIndex, widget, { displayOnly: true });
            this._pmiPreviewMode.open();
        } catch {
            this._pmiPreviewMode = null;
        }
    },

    endPMIPreviewMode() {
        const preview = this._pmiPreviewMode;
        this._pmiPreviewMode = null;
        if (!preview) return;
        try {
            const maybePromise = preview.dispose?.();
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.catch(() => { });
            }
        } catch { /* ignore */ }
    },

    startPMIMode(viewEntry, viewIndex, widget = this.pmiViewsWidget, options: any = {}) {
        if (this._viewerOnlyMode) return;
        try { this.endPMIPreviewMode(); } catch { /* ignore */ }
        const alreadyActive = !!this._pmiMode;
        const enteredFromViewClick = !!options?.fromViewClick;
        const currentWorkbench = this._getActiveWorkbenchId();
        if (enteredFromViewClick && !alreadyActive && currentWorkbench !== 'PMI') {
            this._setWorkbenchReturnTarget(currentWorkbench);
            this.setActiveWorkbench('PMI', { queueHistorySnapshot: true });
        } else if (!enteredFromViewClick && !alreadyActive) {
            this._setWorkbenchReturnTarget(null);
        }
        try { this._collapseExpandedDialogsForModeSwitch(); } catch { /* ignore */ }
        if (!alreadyActive) {
            try { this.assemblyConstraintsWidget?.onPMIModeEnter?.(); } catch { /* ignore */ }
        }
        try { if (this._pmiMode) this._pmiMode.dispose(); } catch { /* ignore */ }
        try {
            if (!alreadyActive) this._setSidebarAutoHideSuspended(true);
            this._pmiMode = new PMIMode(this, viewEntry, viewIndex, widget);
            this._pmiMode.open();
        } catch (error) {
            this._pmiMode = null;
            if (!alreadyActive) {
                try { this.assemblyConstraintsWidget?.onPMIModeExit?.(); } catch { /* ignore */ }
                try { this._setSidebarAutoHideSuspended(false); } catch { /* ignore */ }
            }
            throw error;
        }
    },

    onPMIFinished(_updatedView) {
        this._restoreWorkbenchAfterPMI();
        this.endPMIMode();
    },

    onPMICancelled() {
        this._restoreWorkbenchAfterPMI();
        this.endPMIMode();
    },

    endPMIMode() {
        const hadMode = !!this._pmiMode;
        if (hadMode) {
            try { this._collapseExpandedDialogsForModeSwitch(); } catch { /* ignore */ }
        }
        try { if (this._pmiMode) this._pmiMode.dispose(); } catch { /* ignore */ }
        this._pmiMode = null;
        if (hadMode) {
            try { this.assemblyConstraintsWidget?.onPMIModeExit?.(); } catch { /* ignore */ }
        }
        // Robustly restore core UI similar to endSketchMode
        try { this._setSidebarAutoHideSuspended(false); } catch { /* ignore */ }
        try { if (this.controls) this.controls.enabled = true; } catch { /* ignore */ }
    },

    openSheet2DEditor(sheetId = null) {
        const manager = this.partHistory?.sheet2DManager;
        if (!manager) return;
        let targetId = sheetId ? String(sheetId) : "";
        if (!targetId) {
            const first = manager.getSheets?.()?.[0] || null;
            if (first?.id) targetId = String(first.id);
        }
        if (!targetId) {
            const created = manager.createSheet?.({
                name: "Instruction Sheet 1",
                sizeKey: "A",
                orientation: "landscape",
                elements: [],
            }) || null;
            if (created?.id) targetId = String(created.id);
        }
        if (!this._sheet2DEditorWindow) {
            this._sheet2DEditorWindow = new Sheet2DEditorWindow(this);
        }
        this._sheet2DEditorWindow.open(targetId || null);
    },

    closeSheet2DEditor() {
        try { this._sheet2DEditorWindow?.close?.(); } catch { /* ignore */ }
    }
};

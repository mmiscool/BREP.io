// ES6 module
// Requires three and ArcballControls from three/examples:
//   import * as THREE from 'three';
//   import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';

import * as THREE from 'three';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';

import { BREP } from '../BREP/BREP.js';
import { PartHistory } from '../PartHistory.js';
import { createAxisHelperGroup, DEFAULT_AXIS_HELPER_PX } from '../utils/axisHelpers.js';
import { readBrowserStorageValue } from '../utils/browserStorage.js';
import './dialogs.js';
import './expressionsManager.js';
import './mobile.js';
import { OrthoCameraIdle } from './OrthoCameraIdle.js';
import { annotationRegistry } from './pmi/AnnotationRegistry.js';
import { SelectionFilter } from './SelectionFilter.js';
import { cameraMethods } from './viewer/cameraMethods.js';
import { componentTransformMethods } from './viewer/componentTransformMethods.js';
import { CAD_MATERIAL_SETTINGS_KEY } from './viewer/constants.js';
import { displayMethods } from './viewer/displayMethods.js';
import { inspectorMethods } from './viewer/inspectorMethods.js';
import { modeMethods } from './viewer/modeMethods.js';
import { rendererMethods } from './viewer/rendererMethods.js';
import { selectionMethods } from './viewer/selectionMethods.js';
import { SidebarDockController } from './viewer/sidebarDock.js';
import { sidebarMethods } from './viewer/sidebarMethods.js';
import { ensureSelectionPickerStyles } from './viewer/styles.js';
import { workbenchMethods } from './viewer/workbenchMethods.js';

function applyViewerMethods(target, ...methodGroups) {
    for (const group of methodGroups) {
        for (const name of Reflect.ownKeys(group)) {
            Object.defineProperty(target, name, {
                value: (group as any)[name],
                writable: true,
                configurable: true,
            });
        }
    }
}

export class Viewer {
    [key: string]: any;

    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container - DOM node to mount the canvas
     * @param {number} [opts.viewSize=10] - Ortho half-height at zoom=1 (world units)
     * @param {number} [opts.near=-1000]
     * @param {number} [opts.far=1000]
     * @param {number} [opts.pixelRatio=window.devicePixelRatio || 1]
     * @param {THREE.Color | number | string} [opts.clearColor=0x0b0d10] - base clear color (alpha set separately)
     * @param {number} [opts.clearAlpha=0] - clear alpha for transparent captures
     */
    constructor({
        container,
        viewSize = 10,
        near = -10000000,
        far = 10000000,
        pixelRatio = (window.devicePixelRatio || 1),
        clearColor = 0x0b0d10,
        clearAlpha = 0,
        sidebar = null,
        partHistory = new PartHistory(),
        autoLoadLastModel = false,
        viewerOnlyMode = false,
        homeBannerUrl = '',
        homeBannerOpenInNewTab = false,

    }) {
        if (!container) throw new Error('Viewer requires { container }');
        this.BREP = BREP;

        this.partHistory = partHistory instanceof PartHistory ? partHistory : new PartHistory();
        this._autoLoadLastModel = !!autoLoadLastModel;
        this._viewerOnlyMode = !!viewerOnlyMode;
        this._homeBannerUrl = String(homeBannerUrl || '').trim();
        this._homeBannerOpenInNewTab = !!homeBannerOpenInNewTab;
        this._triangleDebugger = null;
        this._lastInspectorTarget = null;
        this._lastInspectorSolid = null;
        this._workbenchReturnTarget = null;
        this._suspendWorkbenchReturn = false;
        this._workbenchPanelRecords = new Map();
        this.simulationWorkbenchManager = null;
        this._simulationWorkbenchManagerPromise = null;
        this._camWorkbenchReturnTarget = null;




        // Core
        this.container = container;
        this.sidebar = sidebar;
        this._sidebarResizer = null;
        this._sidebarDockController = null;
        this._sidebarPinned = true;
        this._sidebarHoverVisible = false;
        this._sidebarAutoHideSuspended = false;
        this._sidebarPinTab = null;
        this._sidebarHoverStrip = null;
        this._sidebarHoverTargets = null;
        this._sidebarStoredDisplay = null;
        this._sidebarStoredVisibility = null;
        this._sidebarStoredTransform = null;
        this._sidebarStoredPointerEvents = null;
        this._sidebarLastPointer = null;
        this._sidebarOffscreen = false;
        this._sidebarHomeBanner = null;
        this._sidebarHomeBannerRO = null;
        this._sketchSidebarPrev = null;
        this.scene = partHistory instanceof PartHistory ? partHistory.scene : new THREE.Scene();
        this._axisHelpers = new Set();
        this._axisHelpersDirty = true;
        this._axisHelperPx = DEFAULT_AXIS_HELPER_PX;
        try {
            this._worldAxisHelper = createAxisHelperGroup({
                name: "__WORLD_AXES__",
                selectable: false,
                axisHelperPx: this._axisHelperPx,
            });
            this._worldAxisHelper.userData = this._worldAxisHelper.userData || {};
            this._worldAxisHelper.userData.preventRemove = true;
            this.scene.add(this._worldAxisHelper);
        } catch { /* ignore axis helper failures */ }
        ensureSelectionPickerStyles();

        // Apply persisted sidebar width early (before building UI)
        try {
            if (this.sidebar) {
                const raw = readBrowserStorageValue(CAD_MATERIAL_SETTINGS_KEY, {
                    fallback: '',
                });
                if (raw) {
                    try {
                        const obj = JSON.parse(raw);
                        const w = parseInt(obj && obj['__SIDEBAR_WIDTH__']);
                        if (Number.isFinite(w) && w > 0) this.sidebar.style.width = `${w}px`;
                    } catch { /* ignore parse errors */ }
                }
            }
        } catch { /* ignore */ }

        this._sidebarDockController = new SidebarDockController(this);
        this._sidebarDockController.init();

        // Renderer
        this.pixelRatio = pixelRatio; // persist for future resizes
        this._clearColor = new THREE.Color(clearColor);
        this._clearAlpha = clearAlpha;
        this._rendererMode = 'webgl';
        this._simulationFinishUi = null;
        this._simulationFinishReserveKey = 'simulation-workbench-finish';
        this._camFinishUi = null;
        this._camFinishReserveKey = 'cam-workbench-finish';
        this._svgRenderer = null;
        this._webglRenderer = null;
        this._webglComposer = null;
        this._webglComposerRenderer = null;
        this._renderPass = null;
        this._solidFaceOutlinePass = null;
        this._solidFaceOutlineSelection = [];
        this._solidFaceOutlineEdgeMaskTarget = null;
        this._solidFaceOutlineDepthMaterial = null;
        this._forcePostProcessingDepth = 0;
        this.renderer = this._createWebGLRenderer();
        this._webglRenderer = this.renderer;
        this.container.appendChild(this.renderer.domElement);





        // Camera (Orthographic)
        this.viewSize = viewSize;
        const { width, height } = this._getContainerSize();
        const aspect = width / height || 1;
        this.camera = new OrthoCameraIdle(
            -viewSize * aspect,
            viewSize * aspect,
            viewSize,
            -viewSize,
            near,
            far
        );
        this._defaultNear = near;
        this._defaultFar = far;
        this._defaultPerspectiveNear = 0.01;
        this._perspectiveFov = 50;
        this._cameraProjectionToggleButton = null;
        this._onCameraProjectionToggleClick = (event) => {
            try { event?.preventDefault?.(); } catch { /* ignore projection toggle event prevention failures */ }
            try { event?.stopPropagation?.(); } catch { /* ignore projection toggle propagation failures */ }
            this.toggleCameraProjection();
        };




        // Camera-anchored light rig: four evenly bright point lights + ambient to keep surfaces lit at any zoom
        const lightIntensity = 5;
        const baseLightRadius = Math.max(15, viewSize * 1.4);
        const ambientLight = new THREE.AmbientLight(0xffffff, 1);
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 0.25);
        const lightDirections = [
            [-20, -20, -20],
            [-1, 1, -1],
            [1, -1, -1],
            [-1, -1, 1],
        ];
        const pointLights = lightDirections.map(() => {
            const light = new THREE.PointLight(0xffffff, lightIntensity);
            // No distance attenuation so brightness stays consistent with huge scenes
            light.distance = 0;
            light.decay = 0;
            return light;
        });
        pointLights.forEach((light) => this.camera.add(light));
        this.camera.add(ambientLight);
        this.camera.add(hemiLight);
        this._cameraLightRig = { pointLights, lightDirections, baseLightRadius };
        this._updateCameraLightRig();








        // Ensure the camera (and its light) participate in the scene graph for lighting calculations
        try { this.camera.userData = { ...(this.camera.userData || {}), preventRemove: true }; } catch { /* ignore */ }
        if (this.camera.parent !== this.scene) {
            try { this.scene.add(this.camera); } catch { /* ignore */ }
        }
        try { this.partHistory.camera = this.camera; } catch { /* ignore */ }









        // Nice default vantage
        this.camera.position.set(15, 12, 15);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, 0, 0);

        // Controls (Arcball)
        this.controls = new ArcballControls(this.camera, this.renderer.domElement, this.scene);
        this.controls.enableAnimations = false;
        this.controls.setGizmosVisible(false);
        this.controls.minDistance = 0.01; // relevant when switching to perspective; harmless here

        this._configureCameraIdleCallbacks();




        // State for interaction
        this._pointerDown = false;
        this._downButton = 0;           // 0 left, 2 right
        this._downPos = { x: 0, y: 0 };
        this._dragThreshold = 5;        // pixels
        this._raf = null;
        this._disposed = false;
        this._sketchMode = null;
        this._splineMode = null;
        this._pmiPreviewMode = null;
        this._imageEditorActive = false;
        this._sheet2DEditorActive = false;
        this._cameraMoving = false;
        this._sceneBoundsCache = null;
        this._lastPointerEvent = null;
        this._lastDashWpp = null;
        this._selectionOverlay = null;
        this._hoverRefreshRaf = null;
        this._cubeActive = false;
        // Inspector panel state
        this._inspectorOpen = false;
        this._inspectorEl = null;
        this._inspectorContent = null;
        this._inspectorLinkedWindows = new Set();
        this._inspectorLinkedWindowSeed = 0;
        // Plugin-related state
        this._pendingToolbarButtons = [];
        // Component transform gizmo session state
        this._componentTransformSession = null;
        // Assembly constraints accordion visibility state
        this._assemblyConstraintsVisible = null;

        // Raycaster for picking
        this.raycaster = new THREE.Raycaster();
        this.raycaster.near = 0;
        this.raycaster.far = Infinity;
        // Initialize params containers; thresholds set per-pick for stability
        try { this.raycaster.params.Line = this.raycaster.params.Line || {}; } catch { /* ignore raycaster line params setup failures */ }
        try { this.raycaster.params.Line2 = this.raycaster.params.Line2 || {}; } catch { /* ignore raycaster line2 params setup failures */ }

        this._lastCanvasPointerDownAt = 0;
        this._selectionOverlayTimer = null;
        this._pendingSelectionOverlay = null;
        // Bindings
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onResize = this._onResize.bind(this);
        this._onControlsChange = this._onControlsChange.bind(this);
        this._loop = this._loop.bind(this);
        this._updateHover = this._updateHover.bind(this);
        this._selectAt = this._selectAt.bind(this);
        this._onHoverChanged = this._onHoverChanged.bind(this);
        this._onPointerLeave = () => {
            try { SelectionFilter.clearHover(); } catch (_) { /* ignore hover clear failures */ }
            try { this.viewCube?.clearHover?.(); } catch (_) { /* ignore view cube hover clear failures */ }
            this._lastPointerEvent = null;
        };
        this._onPointerEnter = (ev) => { this._lastPointerEvent = ev; };

        // Events
        const el = this.renderer.domElement;
        this._attachRendererEvents(el);

        SelectionFilter.viewer = this;
        try { SelectionFilter.startClickWatcher(this); } catch (_) { /* ignore selection watcher startup failures */ }
        if (!this._viewerOnlyMode) {
            try { SelectionFilter._ensureSelectionFilterIndicator?.(this); } catch (_) { /* ignore selection indicator setup failures */ }
        } else {
            try { SelectionFilter._selectionFilterIndicator?.remove?.(); } catch (_) { /* ignore selection indicator removal failures */ }
            try { SelectionFilter._selectionFilterIndicator = null; } catch (_) { /* ignore selection indicator reset failures */ }
            try { SelectionFilter._selectionActionBar?.remove?.(); } catch (_) { /* ignore selection action bar removal failures */ }
            try { SelectionFilter._selectionActionBar = null; } catch (_) { /* ignore selection action bar reset failures */ }
        }
        // Use capture on pointerup to ensure we end interactions even if pointerup fires off-element
        window.addEventListener('pointerup', this._onPointerUp, { passive: false, capture: true });
        window.addEventListener('resize', this._onResize);
        this._onKeyDown = this._onKeyDown.bind(this);
        window.addEventListener('keydown', this._onKeyDown, { passive: false });
        window.addEventListener('hover-changed', this._onHoverChanged);
        // Keep camera updates; no picking to sync
        this.controls.addEventListener('change', this._onControlsChange);

        this.SelectionFilter = SelectionFilter;

        // Expose annotation registry for PMI modules and plugins
        this.annotationRegistry = annotationRegistry;

        // View cube overlay
        this._ensureViewCube();

        // Initial sizing + start
        this._resizeRendererToDisplaySize();
        this._loop();
        this.ready = this.setupAccordion();
    }
}

applyViewerMethods(
    Viewer.prototype,
    rendererMethods,
    cameraMethods,
    sidebarMethods,
    workbenchMethods,
    modeMethods,
    displayMethods,
    selectionMethods,
    componentTransformMethods,
    inspectorMethods,
);

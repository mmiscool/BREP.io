import * as THREE from 'three';

import { CADmaterials } from '../CADmaterials.js';
import { SchemaForm } from '../featureDialogs.js';
import { OrthoCameraIdle } from '../OrthoCameraIdle.js';
import { SelectionFilter } from '../SelectionFilter.js';
import { ViewCube } from '../ViewCube.js';
import { ensureViewCubeCameraToggleStyles } from './styles.js';

export const cameraMethods = {
    _onCameraMove() {
        if (this.sidebar) this.sidebar.style.opacity = 0.9;
        this._cameraMoving = true;
        this._updateDepthRange();
    },

    _onCameraIdle() {
        if (this.sidebar) this.sidebar.style.opacity = 0.9;
        this._cameraMoving = false;
        // Recompute cached bounds once interaction settles.
        this.scene.traverse((object) => {
            const g = object && object.geometry;
            if (g && typeof g.computeBoundingSphere === 'function') {
                try { g.computeBoundingSphere(); } catch { /* ignore */ }
            }
        });
        this._updateDepthRange();
        try { this.render(); } catch { /* ignore */ }
    },

    _configureCameraIdleCallbacks() {
        try { this.camera?.disableIdleCallbacks?.(); } catch { /* ignore */ }
        try { this.camera?.attachControls?.(this.controls); } catch { /* ignore */ }
        if (typeof this.camera?.enableIdleCallbacks !== 'function') return;
        try {
            this.camera.enableIdleCallbacks({
                controls: this.controls,
                idleMs: 300,
                onMove: () => this._onCameraMove(),
                onIdle: () => this._onCameraIdle(),
            });
        } catch { /* ignore */ }
    },

    _syncActiveTransformGizmosForCamera({ resetSize = false } = {}) {
        const camera = this.camera || null;
        const domElement = this.renderer?.domElement || null;

        const applyGizmoCamera = (controls, updateFn = null) => {
            if (!controls) return;
            let setCameraHandledReset = false;
            try {
                if (typeof controls.setCamera === 'function') {
                    controls.setCamera(camera, { resetSize, refresh: false });
                    setCameraHandledReset = true;
                } else if (camera) {
                    controls.camera = camera;
                }
            } catch { /* ignore */ }
            try {
                if (typeof controls.setDomElement === 'function') controls.setDomElement(domElement);
                else if (domElement) controls.domElement = domElement;
            } catch { /* ignore */ }
            if (resetSize && !setCameraHandledReset) {
                try {
                    if (typeof controls.resetSize === 'function') controls.resetSize();
                    else if (typeof controls.setSize === 'function') controls.setSize(2);
                } catch { /* ignore */ }
            }
            try {
                if (typeof updateFn === 'function') updateFn();
                else if (typeof controls.update === 'function') controls.update();
                else controls.updateMatrixWorld?.(true);
            } catch { /* ignore */ }
        };

        const rebindCameraChange = (state, handlerKey = 'cameraChangeHandler', sourceKey = 'cameraChangeSource') => {
            if (!state) return;
            const handler = state[handlerKey];
            if (typeof handler !== 'function') return;
            const prevSource = state[sourceKey];
            if (prevSource && prevSource !== this.controls && typeof prevSource.removeEventListener === 'function') {
                try { prevSource.removeEventListener('change', handler); } catch { /* ignore */ }
            }
            if (this.controls && typeof this.controls.addEventListener === 'function') {
                try { this.controls.addEventListener('change', handler); } catch { /* ignore */ }
            }
            state[sourceKey] = this.controls || null;
        };

        const componentSession = this._componentTransformSession;
        if (componentSession?.controls) {
            applyGizmoCamera(componentSession.controls, componentSession.globalState?.updateForCamera || null);
            rebindCameraChange(componentSession, 'cameraChangeHandler', 'cameraChangeSource');
        }

        const formState = SchemaForm?.getActiveTransformState?.() || SchemaForm?.__activeXform || null;
        if (formState?.viewer === this && formState.controls) {
            applyGizmoCamera(formState.controls, formState.controlsChangeHandler || null);
            rebindCameraChange(formState, 'controlsChangeHandler', 'controlsChangeSource');
        }

        try {
            const globalState = (typeof window !== 'undefined') ? window.__BREP_activeXform : null;
            if (globalState?.viewer === this && globalState.controls) {
                applyGizmoCamera(globalState.controls, globalState.updateForCamera || null);
            }
        } catch { /* ignore */ }
    },

    _refreshCameraProjectionToggleButton() {
        const btn = this._cameraProjectionToggleButton;
        if (!btn || !this.camera) return;
        const isOrtho = !!this.camera.isOrthographicCamera;
        btn.textContent = isOrtho ? 'ORTHO' : 'PERSP';
        btn.classList.toggle('is-perspective', !isOrtho);
        btn.title = isOrtho ? 'Switch to perspective camera' : 'Switch to orthographic camera';
        btn.setAttribute('aria-label', btn.title);
    },

    _positionCameraProjectionToggle() {
        const btn = this._cameraProjectionToggleButton;
        if (!btn) return;
        if (!this.viewCube || this._rendererMode !== 'webgl') {
            btn.style.display = 'none';
            return;
        }
        const cubeRect = this.viewCube?._viewportRect?.();
        if (!cubeRect) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        const gapPx = 10;
        const x = Math.max(10, Math.round(cubeRect.xCss - gapPx));
        const y = Math.round(cubeRect.yCss + cubeRect.h - 8);
        btn.style.left = `${x}px`;
        btn.style.top = `${y}px`;
    },

    _ensureCameraProjectionToggle() {
        if (!this.container || typeof document === 'undefined') return;
        if (!this._cameraProjectionToggleButton) {
            ensureViewCubeCameraToggleStyles();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'viewcube-camera-toggle';
            btn.addEventListener('click', this._onCameraProjectionToggleClick);
            btn.addEventListener('pointerdown', (event) => {
                try { event.stopPropagation(); } catch { /* ignore */ }
            });
            try {
                const computed = window.getComputedStyle(this.container);
                if (computed?.position === 'static') this.container.style.position = 'relative';
            } catch { /* ignore */ }
            this.container.appendChild(btn);
            this._cameraProjectionToggleButton = btn;
        }
        this._refreshCameraProjectionToggleButton();
        this._positionCameraProjectionToggle();
    },

    setCameraProjection(mode = 'orthographic') {
        if (!this.camera) return false;
        const requested = String(mode || '').toLowerCase();
        const nextKind = requested.startsWith('pers') ? 'perspective' : 'orthographic';
        const isAlready = (nextKind === 'perspective')
            ? !!this.camera.isPerspectiveCamera
            : !!this.camera.isOrthographicCamera;
        if (isAlready) {
            this._refreshCameraProjectionToggleButton();
            this._positionCameraProjectionToggle();
            return true;
        }

        const currentCamera = this.camera;
        const oldTarget = this.controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0);
        const { width, height } = this._getContainerSize();
        const aspect = Math.max(1e-6, width / Math.max(1, height));
        let nextCamera = null;

        if (nextKind === 'perspective') {
            const fov = Number.isFinite(this._perspectiveFov) ? this._perspectiveFov : 50;
            const near = Math.max(1e-4, Number(this._defaultPerspectiveNear) || 0.01);
            const far = Math.max(100, Number(currentCamera.far) || Math.abs(this._defaultFar) || 1000000);
            nextCamera = new THREE.PerspectiveCamera(fov, aspect, near, far);
            let distance = currentCamera.position.distanceTo(oldTarget);
            if (currentCamera.isOrthographicCamera) {
                const zoom = (typeof currentCamera.zoom === 'number' && currentCamera.zoom > 0) ? currentCamera.zoom : 1;
                const spanY = Math.abs((Number(currentCamera.top) - Number(currentCamera.bottom)) / zoom);
                const denom = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
                if (Number.isFinite(spanY) && spanY > 1e-6 && Number.isFinite(denom) && denom > 1e-6) {
                    distance = (spanY * 0.5) / denom;
                }
            }
            if (!Number.isFinite(distance) || distance < 1e-4) distance = 10;
            const viewDir = currentCamera.position.clone().sub(oldTarget);
            if (viewDir.lengthSq() < 1e-12) {
                try {
                    currentCamera.getWorldDirection(viewDir);
                    viewDir.multiplyScalar(-1);
                } catch {
                    viewDir.set(1, 1, 1);
                }
            }
            viewDir.normalize();
            nextCamera.position.copy(oldTarget).addScaledVector(viewDir, distance);
            nextCamera.up.copy(currentCamera.up);
            nextCamera.lookAt(oldTarget);
            nextCamera.zoom = (typeof currentCamera.zoom === 'number' && currentCamera.zoom > 0) ? currentCamera.zoom : 1;
            this._perspectiveFov = fov;
        } else {
            let spanY = this.viewSize * 2;
            if (currentCamera.isPerspectiveCamera) {
                const dist = Math.max(1e-6, currentCamera.position.distanceTo(oldTarget));
                const fovRad = THREE.MathUtils.degToRad(Number(currentCamera.fov) || 50);
                const zoom = (typeof currentCamera.zoom === 'number' && currentCamera.zoom > 0) ? currentCamera.zoom : 1;
                const fitSpan = 2 * Math.tan(fovRad * 0.5) * dist / zoom;
                if (Number.isFinite(fitSpan) && fitSpan > 1e-6) spanY = fitSpan;
                this._perspectiveFov = Number.isFinite(currentCamera.fov) ? currentCamera.fov : this._perspectiveFov;
            } else if (currentCamera.isOrthographicCamera) {
                const zoom = (typeof currentCamera.zoom === 'number' && currentCamera.zoom > 0) ? currentCamera.zoom : 1;
                const curSpan = Math.abs((Number(currentCamera.top) - Number(currentCamera.bottom)) / zoom);
                if (Number.isFinite(curSpan) && curSpan > 1e-6) spanY = curSpan;
            }
            const halfHeight = Math.max(1e-6, spanY * 0.5);
            const halfWidth = halfHeight * aspect;
            nextCamera = new OrthoCameraIdle(
                -halfWidth,
                halfWidth,
                halfHeight,
                -halfHeight,
                this._defaultNear,
                this._defaultFar
            );
            nextCamera.zoom = 1;
            this.viewSize = halfHeight;
            nextCamera.position.copy(currentCamera.position);
            nextCamera.quaternion.copy(currentCamera.quaternion);
            nextCamera.up.copy(currentCamera.up);
        }

        if (!nextCamera) return false;
        try { currentCamera.disableIdleCallbacks?.(); } catch { /* ignore */ }
        const lightNodes = Array.isArray(currentCamera.children)
            ? currentCamera.children.filter((node) => node?.isLight)
            : [];
        for (const light of lightNodes) {
            try { currentCamera.remove(light); } catch { /* ignore */ }
            try { nextCamera.add(light); } catch { /* ignore */ }
        }
        try { nextCamera.userData = { ...(currentCamera.userData || {}), preventRemove: true }; } catch { /* ignore */ }

        try { this.scene.add(nextCamera); } catch { /* ignore */ }
        try { this.scene.remove(currentCamera); } catch { /* ignore */ }
        this.camera = nextCamera;
        try { this.partHistory.camera = nextCamera; } catch { /* ignore */ }

        this._rebuildControls(this.renderer.domElement);
        try { this.controls?.addEventListener?.('change', this._onControlsChange); } catch { /* ignore */ }
        try { this.controls?.target?.copy?.(oldTarget); } catch { /* ignore */ }
        this._configureCameraIdleCallbacks();
        this._syncActiveTransformGizmosForCamera({ resetSize: true });

        if (this.viewCube) {
            this.viewCube.targetCamera = this.camera;
            this.viewCube.controls = this.controls;
        }

        this._resizeRendererToDisplaySize();
        this._updateDepthRange();
        this._refreshCameraProjectionToggleButton();
        this._positionCameraProjectionToggle();
        this.render();
        return true;
    },

    toggleCameraProjection() {
        const nextKind = this.camera?.isOrthographicCamera ? 'perspective' : 'orthographic';
        return this.setCameraProjection(nextKind);
    },

    _ensureViewCube() {
        if (this.viewCube && this.viewCube.renderer === this.renderer) {
            this.viewCube.targetCamera = this.camera;
            this.viewCube.controls = this.controls;
            this._ensureCameraProjectionToggle();
            return;
        }
        try { this.viewCube?.dispose?.(); } catch { /* ignore */ }
        this.viewCube = new ViewCube({
            renderer: this.renderer,
            targetCamera: this.camera,
            controls: this.controls,
            size: 110,
            margin: 25,
        });
        this._ensureCameraProjectionToggle();
    },

    _computeSceneBounds({ reuse = false, includeExcluded = false } = {}) {
        if (reuse && this._sceneBoundsCache) return this._sceneBoundsCache;
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        let hasBounds = false;
        if (!this.scene) return null;
        try { this.scene.updateMatrixWorld(true); } catch { }

        const shouldSkip = (obj) => {
            const ud = obj?.userData;
            if (ud?.axisHelper) return true;
            if (!includeExcluded && ud?.excludeFromFit) return true;
            return false;
        };
        const visit = (obj, skipParent) => {
            if (!obj) return;
            const skip = skipParent || shouldSkip(obj);
            if (!skip) {
                const geom = obj.geometry;
                if (geom) {
                    let bbox = null;
                    if (obj.boundingBox !== undefined) {
                        if (obj.boundingBox == null && typeof obj.computeBoundingBox === 'function') {
                            try { obj.computeBoundingBox(); } catch { }
                        }
                        bbox = obj.boundingBox;
                    } else {
                        if (geom.boundingBox == null && typeof geom.computeBoundingBox === 'function') {
                            try { geom.computeBoundingBox(); } catch { }
                        }
                        bbox = geom.boundingBox;
                    }
                    if (bbox) {
                        tmp.copy(bbox);
                        tmp.applyMatrix4(obj.matrixWorld);
                        box.union(tmp);
                        hasBounds = true;
                    }
                }
            }
            const children = obj.children || [];
            for (const child of children) visit(child, skip);
        };
        visit(this.scene, false);

        if (!hasBounds || box.isEmpty()) return null;
        this._sceneBoundsCache = box;
        return box;
    },

    _updateDepthRange({ reuseBounds = false } = {}) {
        if (!this.camera) return false;
        const box = this._computeSceneBounds({ reuse: reuseBounds, includeExcluded: true });
        if (!box) return false;
        try { this.camera.updateMatrixWorld(true); } catch { /* ignore */ }

        const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        const inv = new THREE.Matrix4().copy(this.camera.matrixWorld).invert();
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of corners) {
            p.applyMatrix4(inv);
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return false;

        const range = Math.max(1e-6, maxZ - minZ);
        const diag = box.min.distanceTo(box.max);
        const pad = Math.max(range * 0.1, diag * 0.1, 0.5);
        if (maxZ > (-pad + 1e-6)) {
            const dir = new THREE.Vector3();
            try { this.camera.getWorldDirection(dir); } catch { dir.set(0, 0, -1); }
            if (dir.lengthSq() > 0) {
                const shift = maxZ + pad;
                dir.normalize();
                this.camera.position.addScaledVector(dir, -shift);
                minZ -= shift;
                maxZ -= shift;
                try { this.camera.updateMatrixWorld(true); } catch { /* ignore */ }
                try { this.controls?.updateMatrixState?.(); } catch { /* ignore */ }
            }
        }

        const far = Math.max(1, -minZ + pad);
        if (!Number.isFinite(far)) return false;
        const near = this.camera.isPerspectiveCamera
            ? Math.max(1e-4, Math.min(1, far * 0.001))
            : 0;

        const nearChanged = Math.abs((this.camera.near || 0) - near) > 1e-6;
        const farChanged = Math.abs((this.camera.far || 0) - far) > 1e-6;
        if (nearChanged || farChanged) {
            this.camera.near = near;
            this.camera.far = far;
            try { this.camera.updateProjectionMatrix(); } catch { /* ignore */ }
        }
        return true;
    },

    // Zoom-to-fit using only ArcballControls operations (pan + zoom).
    // Does not alter camera orientation or frustum parameters (left/right/top/bottom).

    zoomToFit(margin = 1.1) {
        try {
            const c = this.controls;
            if (!c) return;

            const box = this._computeSceneBounds();
            if (!box) return;

            // Ensure matrices are current
            this.camera.updateMatrixWorld(true);

            // Compute extents in camera space (preserve orientation)
            const corners = [
                new THREE.Vector3(box.min.x, box.min.y, box.min.z),
                new THREE.Vector3(box.min.x, box.min.y, box.max.z),
                new THREE.Vector3(box.min.x, box.max.y, box.min.z),
                new THREE.Vector3(box.min.x, box.max.y, box.max.z),
                new THREE.Vector3(box.max.x, box.min.y, box.min.z),
                new THREE.Vector3(box.max.x, box.min.y, box.max.z),
                new THREE.Vector3(box.max.x, box.max.y, box.min.z),
                new THREE.Vector3(box.max.x, box.max.y, box.max.z),
            ];
            const inv = new THREE.Matrix4().copy(this.camera.matrixWorld).invert();
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of corners) {
                p.applyMatrix4(inv);
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
            const camWidth = Math.max(1e-6, (maxX - minX));
            const camHeight = Math.max(1e-6, (maxY - minY));

            // Compute world center of the box
            const center = box.getCenter(new THREE.Vector3());
            if (this.camera.isOrthographicCamera) {
                // Compute target zoom for orthographic camera using current frustum and viewport aspect.
                const { width, height } = this._getContainerSize();
                const aspect = Math.max(1e-6, width / height);
                const v = this.viewSize; // current half-height before zoom scaling
                const halfW = camWidth / 2 * Math.max(1, margin);
                const halfH = camHeight / 2 * Math.max(1, margin);
                const maxZoomByHeight = v / halfH;
                const maxZoomByWidth = (v * aspect) / halfW;
                const targetZoom = Math.min(maxZoomByHeight, maxZoomByWidth);
                const currentZoom = this.camera.zoom || 1;
                const sizeFactor = Math.max(1e-6, targetZoom / currentZoom);

                // Perform pan+zoom via ArcballControls only
                try { c.updateMatrixState && c.updateMatrixState(); } catch { }
                c.focus(center, sizeFactor);
            } else if (this.camera.isPerspectiveCamera) {
                const fovRad = THREE.MathUtils.degToRad(this.camera.fov || 50);
                const vertical = Math.max(1e-6, camHeight * Math.max(1, margin));
                const horizontal = Math.max(1e-6, camWidth * Math.max(1, margin));
                const distByHeight = (vertical * 0.5) / Math.max(1e-6, Math.tan(fovRad * 0.5));
                const hFov = 2 * Math.atan(Math.tan(fovRad * 0.5) * Math.max(1e-6, this.camera.aspect || 1));
                const distByWidth = (horizontal * 0.5) / Math.max(1e-6, Math.tan(hFov * 0.5));
                const targetDistance = Math.max(distByHeight, distByWidth, 1e-3);
                const viewDir = this.camera.position.clone().sub(c.target || center);
                if (viewDir.lengthSq() < 1e-12) viewDir.set(1, 1, 1);
                viewDir.normalize();
                this.camera.position.copy(center).addScaledVector(viewDir, targetDistance);
                if (c.target) c.target.copy(center);
                this.camera.lookAt(center);
                try { c.updateMatrixState && c.updateMatrixState(); } catch { }
            }

            // Sync and render
            try { c.update && c.update(); } catch { }
            this.render();
        } catch { /* noop */ }
    },

    // Wireframe toggle for all materials

    _getContainerSize() {
        // Prefer clientWidth/Height so we get the laid-out CSS size.
        // Fallback to window size if the container hasn't been laid out yet.
        const w = this.container.clientWidth || window.innerWidth || 1;
        const h = this.container.clientHeight || window.innerHeight || 1;
        return { width: Math.max(1, w), height: Math.max(1, h) };
    },

    // REPLACE: _resizeRendererToDisplaySize()

    _resizeRendererToDisplaySize() {
        const { width, height } = this._getContainerSize();

        const isWebGL = !!this.renderer?.isWebGLRenderer;
        let targetPR = 1;
        if (isWebGL && typeof this.renderer.getPixelRatio === 'function' && typeof this.renderer.setPixelRatio === 'function') {
            // Keep DPR current (handles moving across monitors)
            const dpr = window.devicePixelRatio || 1;
            targetPR = Math.max(1, Math.min(this.pixelRatio || dpr, dpr));
            if (this.renderer.getPixelRatio() !== targetPR) {
                this.renderer.setPixelRatio(targetPR);
            }
        }

        if (isWebGL) {
            // Ensure canvas CSS size matches container (use updateStyle=true)
            const canvas = this.renderer.domElement;
            const needResize =
                canvas.width !== Math.floor(width * targetPR) ||
                canvas.height !== Math.floor(height * targetPR);

            if (needResize) {
                this.renderer.setSize(width, height, true);
            }
            if (this._webglComposer && this._webglComposerRenderer === this.renderer) {
                if (typeof this._webglComposer.setPixelRatio === 'function') {
                    this._webglComposer.setPixelRatio(targetPR);
                }
                this._webglComposer.setSize(width, height);
            }
            if (this._solidFaceOutlineEdgeMaskTarget && typeof this._solidFaceOutlineEdgeMaskTarget.setSize === 'function') {
                this._solidFaceOutlineEdgeMaskTarget.setSize(
                    Math.max(1, Math.round(width * targetPR)),
                    Math.max(1, Math.round(height * targetPR))
                );
            }
        } else if (this.renderer && typeof this.renderer.setSize === 'function') {
            this.renderer.setSize(width, height);
            try {
                const el = this.renderer.domElement;
                if (el) {
                    el.style.width = '100%';
                    el.style.height = '100%';
                }
            } catch { }
        }

        // Keep fat-line materials in sync with canvas resolution
        try {
            const setRes = (mat) => mat && mat.resolution && typeof mat.resolution.set === 'function' && mat.resolution.set(width, height);
            if (CADmaterials?.EDGE) {
                setRes(CADmaterials.EDGE.BASE);
                setRes(CADmaterials.EDGE.SELECTED);
                if (CADmaterials.EDGE.OVERLAY) setRes(CADmaterials.EDGE.OVERLAY);
                if (CADmaterials.EDGE.THREAD_SYMBOLIC_MAJOR) setRes(CADmaterials.EDGE.THREAD_SYMBOLIC_MAJOR);
            }
            if (CADmaterials?.LOOP) {
                setRes(CADmaterials.LOOP.BASE);
                setRes(CADmaterials.LOOP.SELECTED);
            }
        } catch { }
        // Ensure any per-object line materials stay in sync (metadata color clones, etc.)
        try {
            const scene = this.partHistory?.scene || this.scene;
            if (scene) {
                scene.traverse((obj) => {
                    const mat = obj?.material;
                    if (!mat) return;
                    const apply = (m) => {
                        if (m?.resolution && typeof m.resolution.set === 'function') {
                            m.resolution.set(width, height);
                        }
                    };
                    if (Array.isArray(mat)) mat.forEach(apply);
                    else apply(mat);
                });
            }
        } catch { }
        // Keep dashed overlays visually consistent in screen space
        this._updateOverlayDashSpacing(width, height);

        // Update orthographic frustum for new aspect
        const aspect = width / height || 1;
        if (this.camera?.isOrthographicCamera) {
            const spanYRaw = Number.isFinite(this.camera.top) && Number.isFinite(this.camera.bottom)
                ? this.camera.top - this.camera.bottom
                : (this.viewSize * 2);
            const spanY = Math.abs(spanYRaw) > 1e-6 ? spanYRaw : (this.viewSize * 2);
            const centerY = (Number.isFinite(this.camera.top) && Number.isFinite(this.camera.bottom))
                ? (this.camera.top + this.camera.bottom) * 0.5
                : 0;
            const centerX = (Number.isFinite(this.camera.left) && Number.isFinite(this.camera.right))
                ? (this.camera.left + this.camera.right) * 0.5
                : 0;
            const halfHeight = Math.abs(spanY) * 0.5;
            const halfWidth = halfHeight * aspect;
            const signY = spanY >= 0 ? 1 : -1;
            this.camera.top = centerY + halfHeight * signY;
            this.camera.bottom = centerY - halfHeight * signY;
            this.camera.left = centerX - halfWidth;
            this.camera.right = centerX + halfWidth;
        } else if (this.camera?.isPerspectiveCamera) {
            this.camera.aspect = aspect;
        }
        this.camera?.updateProjectionMatrix?.();

        // Optional: let controls know something changed
        if (this.controls && typeof this.controls.update === 'function') {
            this.controls.update();
        }
    },

    // REPLACE: _onResize()

    _onResize() {
        // Coalesce rapid resize events to one rAF
        if (this._resizeScheduled) return;
        this._resizeScheduled = true;
        requestAnimationFrame(() => {
            this._resizeScheduled = false;
            this._resizeRendererToDisplaySize();
            this.render();
            // Keep overlayed labels/leaders in sync with new viewport
            try { this._sketchMode?.onCameraChanged?.(); } catch { }
        });
    },

    // Re-evaluate hover while the camera animates/moves (e.g., orbiting)

    _onControlsChange() {
        if (this._disposed) return;
        // Re-evaluate hover while camera moves (if we have a last pointer)
        if (this._shouldSuppressSceneHover()) {
            try { SelectionFilter.clearHover(); } catch { }
        } else if (this._lastPointerEvent) {
            this._updateHover(this._lastPointerEvent);
        }
        // Keep dash lengths stable while zooming/panning/orbiting
        try {
            const size = this.renderer?.getSize?.(new THREE.Vector2()) || null;
            const w = size?.width || this.renderer?.domElement?.clientWidth || 0;
            const h = size?.height || this.renderer?.domElement?.clientHeight || 0;
            if (w && h) this._updateOverlayDashSpacing(w, h);
        } catch { }
        // While orbiting/panning/zooming, reposition dimension labels/leaders
        try { this._sketchMode?.onCameraChanged?.(); } catch { }
    },

    // Compute world-units per screen pixel for current camera and viewport

    _worldPerPixel(camera, width, height) {
        if (camera && camera.isOrthographicCamera) {
            const zoom = (typeof camera.zoom === 'number' && camera.zoom > 0) ? camera.zoom : 1;
            const wppX = (camera.right - camera.left) / (width * zoom);
            const wppY = (camera.top - camera.bottom) / (height * zoom);
            return Math.max(wppX, wppY);
        }
        const target = this.controls?.target;
        const dist = (target && camera?.position?.distanceTo?.(target))
            || camera?.position?.length?.()
            || 1;
        const fovRad = ((camera?.fov || 50) * Math.PI) / 180;
        const zoom = (typeof camera?.zoom === 'number' && camera.zoom > 0) ? camera.zoom : 1;
        return (2 * Math.tan(fovRad / 2) * dist) / (height * zoom);
    },

    _updateOverlayDashSpacing(width, height) {
        if (!this.camera || !this.renderer) return;
        const w = width || this.renderer.domElement?.clientWidth || 0;
        const h = height || this.renderer.domElement?.clientHeight || 0;
        if (!w || !h) return;
        let wpp = null;
        try { wpp = this._worldPerPixel(this.camera, w, h); } catch { wpp = null; }
        if (!Number.isFinite(wpp) || wpp <= 0) return;
        if (this._lastDashWpp && Math.abs(this._lastDashWpp - wpp) < (this._lastDashWpp * 0.0005)) return;
        this._lastDashWpp = wpp;
        const dashPx = 10; // desired dash length in pixels
        const gapPx = 8;  // desired gap length in pixels
        const setDash = (mat) => {
            if (!mat) return;
            try {
                mat.dashSize = dashPx * wpp;
                mat.gapSize = gapPx * wpp;
                mat.needsUpdate = true;
            } catch { }
        };
        try {
            const edges = CADmaterials?.EDGE || {};
            setDash(edges.OVERLAY);
            setDash(edges.THREAD_SYMBOLIC_MAJOR);
        } catch { }
    }
};

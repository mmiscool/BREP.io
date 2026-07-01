import * as THREE from 'three';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';

import { CADmaterials } from '../CADmaterials.js';

export const rendererMethods: any = {
    _createWebGLRenderer() {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setClearColor(this._clearColor, this._clearAlpha);
        renderer.setPixelRatio(this.pixelRatio || 1);
        this._applyRendererElementStyles(renderer);
        return renderer;
    },

    _createSvgRenderer() {
        const renderer = new SVGRenderer();
        renderer.setQuality('high');
        renderer.setClearColor(this._clearColor);
        this._applyRendererElementStyles(renderer);
        return renderer;
    },

    _disposeWebglPostProcessing() {
        try { this._webglComposer?.dispose?.(); } catch { /* ignore */ }
        try { this._solidFaceOutlinePass?.dispose?.(); } catch { /* ignore */ }
        try { this._renderPass?.dispose?.(); } catch { /* ignore */ }
        try { this._solidFaceOutlineEdgeMaskTarget?.dispose?.(); } catch { /* ignore */ }
        try { this._solidFaceOutlineDepthMaterial?.dispose?.(); } catch { /* ignore */ }
        this._webglComposer = null;
        this._webglComposerRenderer = null;
        this._renderPass = null;
        this._solidFaceOutlinePass = null;
        this._solidFaceOutlineEdgeMaskTarget = null;
        this._solidFaceOutlineDepthMaterial = null;
    },

    _patchOutlinePassHiddenEdgeAlpha(outlinePass) {
        const material = outlinePass?.edgeDetectionMaterial;
        if (!material || material.userData?.__transparentHiddenEdgesPatched) return;
        const source = material.fragmentShader || '';
        const target = 'gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);';
        if (!source.includes(target)) return;
        material.fragmentShader = source.replace(
            target,
            [
                'float edgeAlpha = 1.0 - visibilityFactor > 0.001 ? 1.0 : 0.0;',
                'gl_FragColor = vec4(edgeColor, edgeAlpha) * vec4(d);',
            ].join('\n\t\t\t\t\t')
        );
        material.userData = {
            ...(material.userData || {}),
            __transparentHiddenEdgesPatched: true,
        };
        material.needsUpdate = true;
    },

    _patchOutlinePassPerFaceRendering(outlinePass) {
        if (!outlinePass || outlinePass.userData?.__perFaceRenderingPatched) return;
        const originalRender = typeof outlinePass.render === 'function'
            ? outlinePass.render.bind(outlinePass)
            : null;
        if (!originalRender) return;
        outlinePass.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
            const selected = Array.isArray(outlinePass.selectedObjects)
                ? outlinePass.selectedObjects.filter(Boolean)
                : [];
            if (selected.length <= 1) {
                originalRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
                return;
            }
            const priorSelected = outlinePass.selectedObjects;
            const priorRenderToScreen = outlinePass.renderToScreen;
            try {
                for (let index = 0; index < selected.length; index += 1) {
                    outlinePass.selectedObjects = [selected[index]];
                    outlinePass.renderToScreen = priorRenderToScreen && index === selected.length - 1;
                    originalRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
                }
            } finally {
                outlinePass.selectedObjects = priorSelected;
                outlinePass.renderToScreen = priorRenderToScreen;
            }
        };
        outlinePass.userData = {
            ...(outlinePass.userData || {}),
            __perFaceRenderingPatched: true,
        };
    },

    _patchOutlinePassSolidOverlay(outlinePass) {
        const material = outlinePass?.overlayMaterial;
        if (!material || material.userData?.__solidOverlayPatched) return;
        const source = material.fragmentShader || '';
        let patched = source;
        if (!patched.includes('uniform sampler2D edgeMaskTexture;')) {
            patched = patched.replace(
                'uniform sampler2D patternTexture;',
                'uniform sampler2D patternTexture;\n\t\t\t\tuniform sampler2D edgeMaskTexture;'
            );
        }
        patched = patched.replace(
            /vec4 edgeValue = edgeValue1 \+ edgeValue2 \* edgeGlow;[\s\S]*?gl_FragColor = finalColor;/,
            [
                'vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;',
                'float edgeSignal = max(max(edgeValue.r, edgeValue.g), max(edgeValue.b, edgeValue.a));',
                'float edgeMask = smoothstep(0.02, 0.08, edgeSignal);',
                'vec4 realEdgeSample = texture2D(edgeMaskTexture, vUv);',
                'float realEdgeSignal = max(max(realEdgeSample.r, realEdgeSample.g), max(realEdgeSample.b, realEdgeSample.a));',
                'float realEdgeMask = 1.0 - smoothstep(0.02, 0.12, realEdgeSignal);',
                'float finalAlpha = min(1.0, edgeStrength * maskColor.r * edgeMask) * realEdgeMask;',
                'vec3 finalRgb = edgeSignal > 1e-5 ? (edgeValue.rgb / edgeSignal) : vec3(0.0);',
                'vec4 finalColor = vec4(finalRgb, finalAlpha);',
                'if(usePatternTexture)',
                '\tfinalColor += vec4(vec3(visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r)), 0.0);',
                'gl_FragColor = finalColor;'
            ].join('\n\t\t\t\t\t')
        );
        if (patched === source) return;
        material.uniforms = {
            ...(material.uniforms || {}),
            edgeMaskTexture: { value: null },
        };
        material.fragmentShader = patched;
        material.blending = THREE.NormalBlending;
        material.userData = {
            ...(material.userData || {}),
            __solidOverlayPatched: true,
        };
        material.needsUpdate = true;
    },

    _ensureWebglPostProcessing() {
        if (!this.renderer?.isWebGLRenderer || !this.scene || !this.camera) return;
        if (!this._webglComposer || this._webglComposerRenderer !== this.renderer) {
            this._disposeWebglPostProcessing();
            const { width, height } = this._getContainerSize();
            const pixelRatio = typeof this.renderer.getPixelRatio === 'function'
                ? Math.max(1, Number(this.renderer.getPixelRatio()) || 1)
                : 1;
            const composer = new EffectComposer(this.renderer);
            const renderPass = new RenderPass(this.scene, this.camera);
            const outlinePass = new OutlinePass(new THREE.Vector2(width, height), this.scene, this.camera, []);
            const edgeMaskTarget = new THREE.WebGLRenderTarget(
                Math.max(1, Math.round(width * pixelRatio)),
                Math.max(1, Math.round(height * pixelRatio))
            );
            edgeMaskTarget.texture.name = 'Viewer.SolidFaceOutlineEdgeMask';
            edgeMaskTarget.texture.generateMipmaps = false;
            const depthMaterial = new THREE.MeshDepthMaterial();
            depthMaterial.side = THREE.DoubleSide;
            depthMaterial.colorWrite = false;
            depthMaterial.depthWrite = true;
            depthMaterial.depthTest = true;
            depthMaterial.blending = THREE.NoBlending;
            outlinePass.downSampleRatio = 1;
            outlinePass.visibleEdgeColor.set(0xffff00);
            outlinePass.hiddenEdgeColor.set(0x000000);
            outlinePass.edgeGlow = 0;
            outlinePass.edgeThickness = 1;
            outlinePass.edgeStrength = 3;
            this._patchOutlinePassHiddenEdgeAlpha(outlinePass);
            this._patchOutlinePassPerFaceRendering(outlinePass);
            this._patchOutlinePassSolidOverlay(outlinePass);
            composer.addPass(renderPass);
            composer.addPass(outlinePass);
            if (typeof composer.setPixelRatio === 'function' && typeof this.renderer.getPixelRatio === 'function') {
                composer.setPixelRatio(this.renderer.getPixelRatio());
            }
            composer.setSize(width, height);
            outlinePass.setSize(width, height);
            this._webglComposer = composer;
            this._webglComposerRenderer = this.renderer;
            this._renderPass = renderPass;
            this._solidFaceOutlinePass = outlinePass;
            this._solidFaceOutlineEdgeMaskTarget = edgeMaskTarget;
            this._solidFaceOutlineDepthMaterial = depthMaterial;
        }
        if (this._renderPass) {
            this._renderPass.scene = this.scene;
            this._renderPass.camera = this.camera;
        }
        if (this._solidFaceOutlinePass) {
            this._solidFaceOutlinePass.renderScene = this.scene;
            this._solidFaceOutlinePass.renderCamera = this.camera;
            if (this._solidFaceOutlinePass.overlayMaterial?.uniforms?.edgeMaskTexture) {
                this._solidFaceOutlinePass.overlayMaterial.uniforms.edgeMaskTexture.value = this._solidFaceOutlineEdgeMaskTarget?.texture || null;
            }
        }
    },

    _isObjectEffectivelyVisible(obj) {
        let current = obj;
        while (current) {
            if (current.visible === false) return false;
            current = current.parent;
        }
        return true;
    },

    _collectSolidFaceOutlineObjects() {
        const out = this._solidFaceOutlineSelection || [];
        out.length = 0;
        const scene = this.scene;
        if (!scene) return out;
        scene.traverse((obj) => {
            if (!obj || obj.type !== 'SOLID' || !this._isObjectEffectivelyVisible(obj)) return;
            const children = Array.isArray(obj.children) ? obj.children : [];
            for (const child of children) {
                if (!child || child.type !== 'FACE' || !child.isMesh) continue;
                if (!this._isObjectEffectivelyVisible(child)) continue;
                out.push(child);
            }
        });
        return out;
    },

    _renderSolidFaceOutlineEdgeMask() {
        this._ensureWebglPostProcessing();
        const renderer = this.renderer;
        const scene = this.scene;
        const camera = this.camera;
        const target = this._solidFaceOutlineEdgeMaskTarget;
        const depthMaterial = this._solidFaceOutlineDepthMaterial;
        if (!renderer?.isWebGLRenderer || !scene || !camera || !target || !depthMaterial) return;

        const originalVisibility = new Map();
        scene.traverse((obj) => {
            if (obj) originalVisibility.set(obj, obj.visible !== false);
        });

        const applyRenderableVisibility = (predicate) => {
            scene.traverse((obj) => {
                if (!obj) return;
                const baseVisible = originalVisibility.get(obj) !== false;
                if (!baseVisible) {
                    obj.visible = false;
                    return;
                }
                if (obj.isMesh || obj.isLine || obj.isLine2 || obj.isLineSegments || obj.isLineLoop || obj.isPoints || obj.isSprite) {
                    obj.visible = !!predicate(obj);
                    return;
                }
                obj.visible = true;
            });
        };

        const oldClearColor = new THREE.Color();
        renderer.getClearColor(oldClearColor);
        const oldClearAlpha = renderer.getClearAlpha();
        const oldAutoClear = renderer.autoClear;
        const oldTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        const oldBackground = scene.background;
        const oldOverrideMaterial = scene.overrideMaterial;

        try {
            scene.background = null;
            renderer.autoClear = true;
            renderer.setRenderTarget(target);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true, true, true);

            applyRenderableVisibility((obj) => obj.isMesh);
            scene.overrideMaterial = depthMaterial;
            renderer.render(scene, camera);

            applyRenderableVisibility((obj) => {
                if (obj?.type !== 'EDGE') return false;
                if (obj.userData?.auxEdge) return false;
                return obj.material?.depthTest !== false;
            });
            scene.overrideMaterial = null;
            renderer.render(scene, camera);
        } finally {
            scene.overrideMaterial = oldOverrideMaterial;
            scene.background = oldBackground;
            originalVisibility.forEach((visible, obj) => {
                if (obj) obj.visible = visible;
            });
            renderer.setRenderTarget(oldTarget);
            renderer.setClearColor(oldClearColor, oldClearAlpha);
            renderer.autoClear = oldAutoClear;
        }
    },

    _syncSolidFaceOutlinePass() {
        this._ensureWebglPostProcessing();
        if (!this._solidFaceOutlinePass) return;
        const edgeColor = CADmaterials?.EDGE?.BASE?.color;
        if (edgeColor && typeof this._solidFaceOutlinePass.visibleEdgeColor?.copy === 'function') {
            this._solidFaceOutlinePass.visibleEdgeColor.copy(edgeColor);
        }
        const edgeLineWidth = Number(CADmaterials?.EDGE?.BASE?.linewidth);
        if (Number.isFinite(edgeLineWidth) && edgeLineWidth > 0) {
            this._solidFaceOutlinePass.edgeThickness = edgeLineWidth * 0.5;
        }
        this._solidFaceOutlinePass.selectedObjects = this._collectSolidFaceOutlineObjects();
    },

    async withForcedPostProcessing(fn) {
        if (typeof fn !== 'function') return null;
        this._forcePostProcessingDepth = Math.max(0, Number(this._forcePostProcessingDepth) || 0) + 1;
        try {
            return await fn();
        } finally {
            this._forcePostProcessingDepth = Math.max(0, (Number(this._forcePostProcessingDepth) || 1) - 1);
            try { this.render(); } catch { /* ignore */ }
        }
    },

    _applyRendererElementStyles(renderer) {
        const el = renderer?.domElement;
        if (!el) return;
        el.style.display = 'block';
        el.style.outline = 'none';
        el.style.userSelect = 'none';
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.background = this._clearAlpha === 0 ? 'transparent' : this._clearColor.getStyle();
    },

    _attachRendererEvents(el) {
        if (!el) return;
        el.addEventListener('pointermove', this._onPointerMove, { passive: true });
        el.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
        el.addEventListener('pointerenter', this._onPointerEnter, { passive: true });
        el.addEventListener('pointerdown', this._onPointerDown, { passive: false });
        el.addEventListener('contextmenu', this._onContextMenu);
    },

    _detachRendererEvents(el) {
        if (!el) return;
        el.removeEventListener('pointermove', this._onPointerMove);
        el.removeEventListener('pointerleave', this._onPointerLeave);
        el.removeEventListener('pointerenter', this._onPointerEnter);
        el.removeEventListener('pointerdown', this._onPointerDown);
        el.removeEventListener('contextmenu', this._onContextMenu);
    },

    _rebuildControls(domElement) {
        const prev = this.controls;
        const prevState = prev ? {
            target: prev.target ? prev.target.clone() : null,
            enabled: prev.enabled,
            minDistance: prev.minDistance,
            maxDistance: prev.maxDistance,
            enableAnimations: prev.enableAnimations
        } : null;
        try { prev?.removeEventListener?.('change', this._onControlsChange); } catch { /* ignore renderer fallback failures */ }
        try { prev?.dispose?.(); } catch { /* ignore renderer fallback failures */ }

        const controls = new ArcballControls(this.camera, domElement, this.scene);
        controls.enableAnimations = prevState ? !!prevState.enableAnimations : false;
        controls.setGizmosVisible(false);
        controls.minDistance = prevState && Number.isFinite(prevState.minDistance) ? prevState.minDistance : 0.01;
        if (prevState && Number.isFinite(prevState.maxDistance)) controls.maxDistance = prevState.maxDistance;
        if (prevState?.target) controls.target.copy(prevState.target);
        if (typeof prevState?.enabled === 'boolean') controls.enabled = prevState.enabled;
        this.controls = controls;
    },

    setRendererMode(mode) {
        const nextMode = mode === 'svg' ? 'svg' : 'webgl';
        if (nextMode === this._rendererMode && this.renderer) return;
        this._rendererMode = nextMode;

        try { this._stopComponentTransformSession?.(); } catch { /* ignore renderer fallback failures */ }

        const prevEl = this.renderer?.domElement;
        this._detachRendererEvents(prevEl);
        if (prevEl && prevEl.parentNode) prevEl.parentNode.removeChild(prevEl);

        let nextRenderer = null;
        if (nextMode === 'svg') {
            if (!this._svgRenderer) this._svgRenderer = this._createSvgRenderer();
            nextRenderer = this._svgRenderer;
        } else {
            if (!this._webglRenderer) this._webglRenderer = this._createWebGLRenderer();
            nextRenderer = this._webglRenderer;
        }

        this.renderer = nextRenderer;
        this._applyRendererElementStyles(this.renderer);
        this.container.appendChild(this.renderer.domElement);
        this._attachRendererEvents(this.renderer.domElement);
        this._rebuildControls(this.renderer.domElement);
        try { this.controls?.addEventListener?.('change', this._onControlsChange); } catch { /* ignore renderer fallback failures */ }
        this._configureCameraIdleCallbacks();
        this._syncActiveTransformGizmosForCamera({ resetSize: false });

        if (nextMode === 'webgl') {
            this._ensureWebglPostProcessing();
            this._ensureViewCube();
        } else {
            try { this.viewCube?.dispose?.(); } catch { /* ignore */ }
            this.viewCube = null;
            this._positionCameraProjectionToggle();
        }

        try { this.renderer.domElement.style.marginTop = '0px'; } catch { /* ignore renderer fallback failures */ }
        this._resizeRendererToDisplaySize();
        this.render();
    },

    render() {
        // Keep the camera (and its attached light) anchored in the scene
        if (this.camera && this.camera.parent !== this.scene) {
            try { this.scene.add(this.camera); } catch { /* ignore add errors */ }
        }
        this._positionCameraProjectionToggle();
        this._updateAxisHelpers();
        this._updateCameraLightRig();
        this._updateDepthRange();
        if (this._rendererMode === 'svg') {
            this._renderSvgScene();
        } else {
            this.renderer.render(this.scene, this.camera);
            try { this.viewCube && this.viewCube.render(); } catch { /* ignore renderer fallback failures */ }
        }
    },

    _renderSvgScene() {
        if (!this.renderer || !this.scene || !this.camera) return;
        const el = this.renderer.domElement;
        if (!el) return;
        try { this.scene.updateMatrixWorld(true); } catch { /* ignore renderer fallback failures */ }
        try { this.camera.updateMatrixWorld?.(); } catch { /* ignore renderer fallback failures */ }
        this._resizeRendererToDisplaySize();

        const rect = el.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || this.container?.clientWidth || 0));
        const height = Math.max(1, Math.floor(rect.height || this.container?.clientHeight || 0));
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) return;

        try {
            if (typeof this.renderer.setClearColor === 'function') {
                this.renderer.setClearColor(this._clearColor);
            }
        } catch { /* ignore renderer fallback failures */ }

        const pointAdjustments = [];
        const sideAdjustments = [];
        const tempLines = [];
        const tempGroup = new THREE.Group();
        const hiddenLines = [];
        try {
            if (this.camera?.isOrthographicCamera) {
                const span = (Number(this.camera.right) - Number(this.camera.left)) || 0;
                if (Number.isFinite(span) && span > 0) {
                    const scaleFactor = span / width;
                    this.scene.traverse((obj) => {
                        if (!obj?.isPoints) return;
                        const mat = obj.material;
                        if (Array.isArray(mat)) {
                            for (const m of mat) {
                                if (!m?.isPointsMaterial || !Number.isFinite(m.size)) continue;
                                pointAdjustments.push([m, m.size]);
                                m.size = m.size * scaleFactor;
                            }
                        } else if (mat?.isPointsMaterial && Number.isFinite(mat.size)) {
                            pointAdjustments.push([mat, mat.size]);
                            mat.size = mat.size * scaleFactor;
                        }
                    });
                }
            }

            const occluders = this._collectSvgOccluders(sideAdjustments);
            const raycaster = this._svgRaycaster || new THREE.Raycaster();
            this._svgRaycaster = raycaster;
            const occlusionEps = this._computeSvgOcclusionEps();

            this.scene.traverse((obj) => {
                if (!obj?.visible) return;
                if (!obj.isLine2 && !obj.isLineSegments2) return;
                const line = this._buildSvgLineFromLine2(obj, {
                    camera: this.camera,
                    occluders,
                    raycaster,
                    occlusionEps,
                });
                if (!line) return;
                tempLines.push(line);
                tempGroup.add(line);
                hiddenLines.push([obj, obj.visible]);
                obj.visible = false;
            });
            if (tempLines.length) {
                this.scene.add(tempGroup);
            }

            this._restoreSvgMaterialSides(sideAdjustments);

            this.renderer.render(this.scene, this.camera);
            try { el.style.background = this._clearAlpha === 0 ? 'transparent' : this._clearColor.getStyle(); } catch { /* ignore renderer fallback failures */ }
        } catch { /* ignore renderer fallback failures */ } finally {
            try {
                if (tempLines.length) {
                    this.scene.remove(tempGroup);
                    for (const line of tempLines) {
                        try { line.geometry?.dispose?.(); } catch { /* ignore renderer fallback failures */ }
                        try { line.material?.dispose?.(); } catch { /* ignore renderer fallback failures */ }
                    }
                }
            } catch { /* ignore renderer fallback failures */ }
            for (const [obj, wasVisible] of hiddenLines) {
                try { obj.visible = wasVisible; } catch { /* ignore renderer fallback failures */ }
            }
            this._restoreSvgMaterialSides(sideAdjustments);
            for (const [mat, size] of pointAdjustments) {
                try { mat.size = size; } catch { /* ignore renderer fallback failures */ }
            }
        }
    },

    _buildSvgLineFromLine2(obj, { camera, occluders, raycaster, occlusionEps }: any = {}) {
        const geom = obj.geometry;
        const start = geom?.attributes?.instanceStart;
        const end = geom?.attributes?.instanceEnd;
        let positions = null;
        if (start && end && Number.isFinite(start.count) && start.count > 0) {
            const count = Math.min(start.count, end.count);
            positions = new Float32Array(count * 6);
            for (let i = 0; i < count; i += 1) {
                positions[i * 6] = start.getX(i);
                positions[i * 6 + 1] = start.getY(i);
                positions[i * 6 + 2] = start.getZ(i);
                positions[i * 6 + 3] = end.getX(i);
                positions[i * 6 + 4] = end.getY(i);
                positions[i * 6 + 5] = end.getZ(i);
            }
        } else if (geom?.attributes?.position?.count >= 2) {
            const pos = geom.attributes.position;
            const segCount = pos.count - 1;
            positions = new Float32Array(segCount * 6);
            for (let i = 0; i < segCount; i += 1) {
                positions[i * 6] = pos.getX(i);
                positions[i * 6 + 1] = pos.getY(i);
                positions[i * 6 + 2] = pos.getZ(i);
                positions[i * 6 + 3] = pos.getX(i + 1);
                positions[i * 6 + 4] = pos.getY(i + 1);
                positions[i * 6 + 5] = pos.getZ(i + 1);
            }
        }

        if (!positions || positions.length < 6) return null;

        const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        const wantsOcclusion = material?.depthTest !== false
            && obj?.type === 'EDGE'
            && Array.isArray(occluders)
            && occluders.length
            && camera
            && raycaster;

        if (wantsOcclusion) {
            const edgeFaces = Array.isArray(obj.faces) ? new Set(obj.faces) : null;
            const w1 = this._svgTmpVecA || (this._svgTmpVecA = new THREE.Vector3());
            const w2 = this._svgTmpVecB || (this._svgTmpVecB = new THREE.Vector3());
            const visible = [];
            for (let i = 0; i < positions.length; i += 6) {
                w1.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(obj.matrixWorld);
                w2.set(positions[i + 3], positions[i + 4], positions[i + 5]).applyMatrix4(obj.matrixWorld);
                if (this._isSvgSegmentVisible(w1, w2, camera, raycaster, occluders, edgeFaces, occlusionEps)) {
                    visible.push(
                        positions[i], positions[i + 1], positions[i + 2],
                        positions[i + 3], positions[i + 4], positions[i + 5]
                    );
                }
            }
            if (!visible.length) return null;
            positions = new Float32Array(visible);
        }

        const geomOut = new THREE.BufferGeometry();
        geomOut.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const color = material?.color ? material.color : new THREE.Color('#ffffff');
        const opacity = Number.isFinite(material?.opacity) ? material.opacity : 1;
        const transparent = Boolean(material?.transparent) || opacity < 1;
        const linewidth = Number.isFinite(material?.linewidth) ? material.linewidth : 1;
        let matOut = null;

        if (material?.dashed || material?.isLineDashedMaterial) {
            matOut = new THREE.LineDashedMaterial({
                color,
                linewidth,
                transparent,
                opacity,
                dashSize: Number.isFinite(material?.dashSize) ? material.dashSize : 0.5,
                gapSize: Number.isFinite(material?.gapSize) ? material.gapSize : 0.5,
            });
        } else {
            matOut = new THREE.LineBasicMaterial({
                color,
                linewidth,
                transparent,
                opacity,
            });
        }

        const line = new THREE.LineSegments(geomOut, matOut);
        line.matrixAutoUpdate = false;
        try { line.matrix.copy(obj.matrixWorld); } catch { /* ignore renderer fallback failures */ }
        try { line.matrixWorld.copy(obj.matrixWorld); } catch { /* ignore renderer fallback failures */ }
        line.renderOrder = 2;
        line.visible = true;
        if (matOut.isLineDashedMaterial) {
            try { line.computeLineDistances(); } catch { /* ignore renderer fallback failures */ }
        }
        return line;
    },

    _collectSvgOccluders(sideAdjustments) {
        const occluders = [];
        try {
            this.scene.traverse((obj) => {
                if (!obj?.visible || !obj.isMesh) return;
                if (obj.type && obj.type !== 'FACE') return;
                const mat = obj.material;
                const mats = Array.isArray(mat) ? mat : [mat];
                if (!mats.some((m) => m && m.opacity !== 0)) return;
                if (Array.isArray(sideAdjustments)) {
                    for (const m of mats) {
                        if (!m || m.side === THREE.DoubleSide) continue;
                        sideAdjustments.push([m, m.side]);
                        m.side = THREE.DoubleSide;
                    }
                }
                occluders.push(obj);
            });
        } catch { /* ignore renderer fallback failures */ }
        return occluders;
    },

    _restoreSvgMaterialSides(sideAdjustments) {
        if (!Array.isArray(sideAdjustments) || !sideAdjustments.length) return;
        for (const [mat, side] of sideAdjustments) {
            if (!mat) continue;
            try { mat.side = side; } catch { /* ignore renderer fallback failures */ }
        }
        sideAdjustments.length = 0;
    },

    _computeSvgOcclusionEps() {
        const cam = this.camera;
        if (!cam) return 1e-4;
        if (cam.isOrthographicCamera) {
            const span = Math.abs(Number(cam.right) - Number(cam.left)) || 0;
            return Math.max(1e-4, span * 1e-4);
        }
        const target = this.controls?.target;
        const dist = (target && cam.position?.distanceTo?.(target)) || cam.position?.length?.() || 1;
        return Math.max(1e-4, dist * 1e-4);
    },

    _isSvgSegmentVisible(a, b, camera, raycaster, occluders, edgeFaces, eps) {
        if (!camera || !raycaster || !Array.isArray(occluders) || !occluders.length) return true;
        const samples = this._svgEdgeSamples || (this._svgEdgeSamples = [0.2, 0.5, 0.8]);
        const p = this._svgTmpVecC || (this._svgTmpVecC = new THREE.Vector3());
        for (const t of samples) {
            p.lerpVectors(a, b, t);
            if (!this._isSvgPointOccluded(p, camera, raycaster, occluders, edgeFaces, eps)) return true;
        }
        return false;
    },

    _isSvgPointOccluded(point, camera, raycaster, occluders, edgeFaces, eps) {
        const ndc = this._svgTmpVecD || (this._svgTmpVecD = new THREE.Vector3());
        ndc.copy(point).project(camera);
        if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || !Number.isFinite(ndc.z)) return false;
        if (ndc.z < -1 || ndc.z > 1) return true;
        raycaster.setFromCamera({ x: ndc.x, y: ndc.y }, camera);
        const dist = raycaster.ray.origin.distanceTo(point);
        const pad = Number.isFinite(eps) ? eps : 1e-4;
        raycaster.near = 0;
        raycaster.far = Math.max(0, dist - pad);
        const hits = raycaster.intersectObjects(occluders, true);
        if (!hits.length) return false;
        if (edgeFaces && edgeFaces.size) {
            for (const hit of hits) {
                if (!this._isSvgHitFromEdgeFace(hit, edgeFaces)) return true;
            }
            return false;
        }
        return true;
    },

    _isSvgHitFromEdgeFace(hit, edgeFaces) {
        let obj = hit?.object || null;
        for (let i = 0; i < 3 && obj; i += 1) {
            if (edgeFaces.has(obj)) return true;
            obj = obj.parent || null;
        }
        return false;
    },

    _loop() {
        this._raf = requestAnimationFrame(this._loop);
        this.controls.update();
        let hasActiveTransformControls = false;
        try {
            const ax = (typeof window !== 'undefined') ? ((window as any).__BREP_activeXform || null) : null;
            const tc = ax && ax.controls;
            if (tc) {
                hasActiveTransformControls = true;
                if (typeof tc.update === 'function') tc.update();
                else tc.updateMatrixWorld(true);
            }
        } catch { /* ignore renderer fallback failures */ }
        if (this._cameraMoving || this._sketchMode || hasActiveTransformControls) {
            this.render();
        }
    }

    // ----------------------------------------
    // Internal: Picking helpers
    // ----------------------------------------
};

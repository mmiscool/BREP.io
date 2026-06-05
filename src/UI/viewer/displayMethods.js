import * as THREE from 'three';

import { DEFAULT_AXIS_HELPER_PX } from '../../utils/axisHelpers.js';
import { CADmaterials } from '../CADmaterials.js';
import { SelectionState } from '../SelectionState.js';

export const displayMethods = {
    _updateCameraLightRig() {
        if (!this._cameraLightRig || !this.camera || !this.renderer) return;
        const { pointLights, lightDirections, baseLightRadius } = this._cameraLightRig;
        if (!pointLights?.length || !lightDirections?.length) return;
        const sizeVec = this.renderer.getSize ? this.renderer.getSize(new THREE.Vector2()) : null;
        const width = sizeVec?.width || this.renderer?.domElement?.clientWidth || 0;
        const height = sizeVec?.height || this.renderer?.domElement?.clientHeight || 0;
        if (!width || !height) return;

        const wpp = this._worldPerPixel(this.camera, width, height);
        const screenDiagonal = Math.sqrt(width * width + height * height);
        // Scale radius with visible span so lights spread further when zoomed out and stay even when zoomed in
        const radius = Math.max(baseLightRadius, wpp * screenDiagonal * 1.4);

        pointLights.forEach((light, idx) => {
            const dir = lightDirections[idx] || [0, 0, 0];
            light.position.set(dir[0] * radius, dir[1] * radius, dir[2] * radius);
        });
    },

    _collectAxisHelpers() {
        this._axisHelpers = new Set();
        if (!this.scene || typeof this.scene.traverse !== 'function') {
            this._axisHelpersDirty = false;
            return;
        }
        this.scene.traverse((obj) => {
            if (obj?.userData?.axisHelper) this._axisHelpers.add(obj);
        });
        this._axisHelpersDirty = false;
    },

    _updateAxisHelpers() {
        if (!this.camera || !this.scene) return;
        if (this._axisHelpersDirty) this._collectAxisHelpers();
        if (!this._axisHelpers || this._axisHelpers.size === 0) return;

        const { width, height } = this._getContainerSize();
        const wpp = this._worldPerPixel(this.camera, width, height);
        if (!Number.isFinite(wpp) || wpp <= 0) return;

        const parentScale = new THREE.Vector3(1, 1, 1);
        const eps = 1e-9;
        const setRes = (mat) => {
            if (mat?.resolution && typeof mat.resolution.set === 'function') {
                mat.resolution.set(width, height);
            }
        };

        for (const helper of this._axisHelpers) {
            if (!helper || !helper.isObject3D) continue;
            const px = Number(helper.userData?.axisHelperPx);
            const axisPx = Number.isFinite(px) ? px : (this._axisHelperPx || DEFAULT_AXIS_HELPER_PX);
            const axisLen = wpp * axisPx;

            let sx = axisLen;
            let sy = axisLen;
            let sz = axisLen;
            const compensate = helper.userData?.axisHelperCompensateScale !== false;
            if (compensate && helper.parent && typeof helper.parent.getWorldScale === 'function') {
                try { helper.parent.updateMatrixWorld?.(true); } catch { }
                helper.parent.getWorldScale(parentScale);
                const safe = (v) => (Math.abs(v) < eps ? 1 : Math.abs(v));
                sx /= safe(parentScale.x);
                sy /= safe(parentScale.y);
                sz /= safe(parentScale.z);
            }

            const last = helper.userData._axisHelperScale;
            if (!last
                || Math.abs(last.x - sx) > 1e-6
                || Math.abs(last.y - sy) > 1e-6
                || Math.abs(last.z - sz) > 1e-6) {
                helper.scale.set(sx, sy, sz);
                helper.userData._axisHelperScale = { x: sx, y: sy, z: sz };
            }

            helper.traverse?.((node) => {
                const mat = node?.material;
                if (!mat) return;
                if (Array.isArray(mat)) mat.forEach(setRes);
                else setRes(mat);
            });
        }
    },

    setWireframe(enabled) {
        this._wireframeEnabled = !!enabled;
        try {
            this.scene.traverse((obj) => {
                if (!obj) return;
                // Exclude transform gizmo hierarchy from wireframe toggling
                try {
                    let p = obj;
                    while (p) {
                        if (p.isTransformGizmo) return;
                        p = p.parent;
                    }
                } catch { }
                // Exclude edge/loop/line objects from wireframe toggling
                if (obj.type === 'EDGE' || obj.type === 'LOOP' || obj.isLine || obj.isLine2 || obj.isLineSegments || obj.isLineLoop) return;

                const apply = (mat) => { if (mat && 'wireframe' in mat) mat.wireframe = !!enabled; };
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(apply); else apply(obj.material);
                }
            });
        } catch { /* ignore */ }
        this.render();
    },

    toggleWireframe() { this.setWireframe(!this._wireframeEnabled); },

    applyMetadataColors(target = null) {
        const metadataManager = this.partHistory?.metadataManager;
        const scene = this.partHistory?.scene || this.scene;
        if (!metadataManager || !scene) return;

        const size = this.renderer?.getSize?.(new THREE.Vector2()) || null;
        const width = Math.max(1, size?.width || this.renderer?.domElement?.clientWidth || 1);
        const height = Math.max(1, size?.height || this.renderer?.domElement?.clientHeight || 1);

        const solidKeys = ['solidColor', 'color'];
        const faceKeys = ['faceColor', 'color'];
        const edgeKeys = ['edgeColor', 'color'];
        const solidEdgeKeys = ['edgeColor'];

        const pickColorValue = (meta, keys) => {
            if (!meta || typeof meta !== 'object') return null;
            for (const key of keys) {
                if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
                const raw = meta[key];
                if (raw == null) continue;
                if (typeof raw === 'string' && raw.trim() === '') continue;
                return raw;
            }
            return null;
        };

        const parseColor = (raw) => {
            if (raw == null) return null;
            if (raw?.isColor) {
                try { return typeof raw.clone === 'function' ? raw.clone() : raw; } catch { return raw; }
            }
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                try { return new THREE.Color(raw); } catch { return null; }
            }
            if (typeof raw === 'string') {
                const v = raw.trim();
                if (!v) return null;
                const lower = v.toLowerCase();
                const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(lower);
                const isHex0x = /^0x[0-9a-f]{6}$/.test(lower);
                const isFunc = /^(rgb|rgba|hsl|hsla)\(/.test(lower);
                if (!isHex && !isHex0x && !isFunc) return null;
                if (isHex0x) {
                    const num = Number(v);
                    if (Number.isFinite(num)) {
                        try { return new THREE.Color(num); } catch { return null; }
                    }
                }
                try { return new THREE.Color(v); } catch { return null; }
            }
            if (Array.isArray(raw) && raw.length >= 3) {
                const r = Number(raw[0]);
                const g = Number(raw[1]);
                const b = Number(raw[2]);
                if (![r, g, b].every(Number.isFinite)) return null;
                const max = Math.max(r, g, b);
                try {
                    if (max > 1) return new THREE.Color(r / 255, g / 255, b / 255);
                    return new THREE.Color(r, g, b);
                } catch { return null; }
            }
            if (typeof raw === 'object') {
                const r = Number(raw.r);
                const g = Number(raw.g);
                const b = Number(raw.b);
                if ([r, g, b].every(Number.isFinite)) {
                    const max = Math.max(r, g, b);
                    try {
                        if (max > 1) return new THREE.Color(r / 255, g / 255, b / 255);
                        return new THREE.Color(r, g, b);
                    } catch { return null; }
                }
            }
            return null;
        };

        const getMeta = (name) => {
            if (!name || typeof metadataManager.getMetadata !== 'function') return null;
            try { return metadataManager.getMetadata(name); } catch { return null; }
        };

        const applyMaterial = (obj, baseMaterial, color) => {
            if (!obj || !baseMaterial) return;
            if (!obj.userData) obj.userData = {};
            const ud = obj.userData;
            const defaultMaterial = ud.__defaultMaterial ?? baseMaterial;
            if (!ud.__defaultMaterial) ud.__defaultMaterial = baseMaterial;
            const applyBase = (mat) => {
                SelectionState.setBaseMaterial(obj, mat);
            };

            if (!color) {
                if (ud.__metadataMaterial && ud.__metadataMaterial !== defaultMaterial) {
                    try { ud.__metadataMaterial.dispose?.(); } catch { }
                }
                try { delete ud.__metadataMaterial; } catch { }
                try { delete ud.__metadataColor; } catch { }
                applyBase(defaultMaterial);
                return;
            }

            const colorHex = color.getHexString();
            if (ud.__metadataColor === colorHex && ud.__metadataMaterial) {
                applyBase(ud.__metadataMaterial);
                return;
            }

            let nextMat = null;
            try { nextMat = typeof baseMaterial.clone === 'function' ? baseMaterial.clone() : null; } catch { nextMat = null; }
            if (!nextMat) return;
            try {
                if (nextMat.color && typeof nextMat.color.set === 'function') nextMat.color.set(color);
            } catch { }
            try {
                if (nextMat.resolution && typeof nextMat.resolution.set === 'function') {
                    nextMat.resolution.set(width, height);
                }
            } catch { }
            try { nextMat.needsUpdate = true; } catch { }

            if (ud.__metadataMaterial && ud.__metadataMaterial !== defaultMaterial) {
                try { ud.__metadataMaterial.dispose?.(); } catch { }
            }
            ud.__metadataColor = colorHex;
            ud.__metadataMaterial = nextMat;
            applyBase(nextMat);
        };

        const applyToSolid = (solid) => {
            if (!solid || solid.type !== 'SOLID') return;
            const solidMeta = getMeta(solid.name);
            const solidUserMeta = solid?.userData?.metadata || null;
            const solidColor = parseColor(
                pickColorValue(solidMeta, solidKeys)
                ?? pickColorValue(solidUserMeta, solidKeys)
            );
            const solidEdgeColor = parseColor(
                pickColorValue(solidMeta, solidEdgeKeys)
                ?? pickColorValue(solidUserMeta, solidEdgeKeys)
            );
            const children = Array.isArray(solid.children) ? solid.children : [];

            for (const child of children) {
                if (!child) continue;
                if (child.type === 'FACE') {
                    const faceName = child.name || child.userData?.faceName || null;
                    const managerMeta = faceName ? getMeta(faceName) : null;
                    let faceMeta = null;
                    if (faceName && typeof solid.getFaceMetadata === 'function') {
                        try { faceMeta = solid.getFaceMetadata(faceName); } catch { faceMeta = null; }
                    }
                    const faceColor = parseColor(
                        pickColorValue(managerMeta, faceKeys)
                        ?? pickColorValue(faceMeta, faceKeys)
                    ) || solidColor;
                    const baseFace = CADmaterials.FACE?.BASE ?? child.material;
                    applyMaterial(child, baseFace, faceColor);
                } else if (child.type === 'EDGE') {
                    const edgeName = child.name || null;
                    const managerMeta = edgeName ? getMeta(edgeName) : null;
                    let edgeMeta = null;
                    if (edgeName && typeof solid.getEdgeMetadata === 'function') {
                        try { edgeMeta = solid.getEdgeMetadata(edgeName); } catch { edgeMeta = null; }
                    }
                    let edgeColor = parseColor(
                        pickColorValue(managerMeta, edgeKeys)
                        ?? pickColorValue(edgeMeta, edgeKeys)
                    );
                    if (!edgeColor && solidEdgeColor) edgeColor = solidEdgeColor;

                    const isBoundary = !!(child.userData?.faceA || child.userData?.faceB);
                    const defaultEdge = child.userData?.__defaultMaterial ?? child.material;
                    const baseEdge = isBoundary
                        ? (defaultEdge ?? CADmaterials.EDGE?.BASE ?? child.material)
                        : defaultEdge;
                    applyMaterial(child, baseEdge, edgeColor);
                }
            }
        };

        const resolveSolid = (obj) => {
            if (!obj) return null;
            if (obj.type === 'SOLID') return obj;
            if (obj.parentSolid) return obj.parentSolid;
            let current = obj.parent;
            while (current) {
                if (current.type === 'SOLID') return current;
                current = current.parent;
            }
            return null;
        };

        if (target) {
            let obj = target;
            if (typeof obj === 'string') {
                try { obj = scene.getObjectByName(obj); } catch { obj = null; }
            }
            const solid = resolveSolid(obj);
            if (solid) {
                applyToSolid(solid);
            } else if (obj && (obj.type === 'FACE' || obj.type === 'EDGE')) {
                const name = obj.name || null;
                const managerMeta = name ? getMeta(name) : null;
                const keys = obj.type === 'FACE' ? faceKeys : edgeKeys;
                const color = parseColor(pickColorValue(managerMeta, keys));
                const baseMat = obj.type === 'FACE'
                    ? (CADmaterials.FACE?.BASE ?? obj.material)
                    : (CADmaterials.EDGE?.BASE ?? obj.material);
                applyMaterial(obj, baseMat, color);
            }
        } else {
            scene.traverse((obj) => {
                if (obj && obj.type === 'SOLID') applyToSolid(obj);
            });
        }

        try { this.render(); } catch { }
    }

    // ----------------------------------------
    // Internal: Animation Loop
    // ----------------------------------------
};

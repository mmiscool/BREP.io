import * as THREE from 'three';

import { CombinedTransformControls } from '../controls/CombinedTransformControls.js';
import { SchemaForm } from '../featureDialogs.js';
import { SelectionFilter } from '../SelectionFilter.js';

type AnyRecord = Record<string, any>;

export const componentTransformMethods = {
    _findOwningComponent(obj: AnyRecord | null | undefined) {
        let cur = obj;
        while (cur) {
            if (cur.isAssemblyComponent || cur.type === SelectionFilter.COMPONENT || cur.type === 'COMPONENT') {
                return cur;
            }
            cur = cur.parent;
        }
        return null;
    },

    _stopComponentTransformSession() {
        const session = this._componentTransformSession;
        if (!session) return;
        const {
            controls,
            helper,
            target,
            changeHandler,
            dragHandler,
            objectChangeHandler,
            cameraChangeHandler,
            cameraChangeSource,
            globalState
        } = session;

        try { controls?.removeEventListener('change', changeHandler); } catch { /* ignore */ }
        try { controls?.removeEventListener('dragging-changed', dragHandler); } catch { /* ignore */ }
        try { controls?.removeEventListener('objectChange', objectChangeHandler); } catch { /* ignore */ }
        try { cameraChangeSource?.removeEventListener?.('change', cameraChangeHandler); } catch { /* ignore */ }

        try { controls?.detach?.(); } catch { /* ignore */ }

        if (this.scene) {
            try { if (controls && controls.isObject3D) this.scene.remove(controls); } catch { /* ignore */ }
            try { if (helper && helper.isObject3D) this.scene.remove(helper); } catch { /* ignore */ }
            try { if (target && target.isObject3D) this.scene.remove(target); } catch { /* ignore */ }
        }

        try { controls?.dispose?.(); } catch { /* ignore */ }

        try {
            if ((window as any).__BREP_activeXform === globalState) {
                (window as any).__BREP_activeXform = null;
            }
        } catch { /* ignore */ }

        this._componentTransformSession = null;
        try { if (this.controls) this.controls.enabled = true; } catch { /* ignore */ }
        try { this.render(); } catch { /* ignore */ }
    },

    _activateComponentTransform(component: AnyRecord | null | undefined) {
        if (!component) return;
        if (component.fixed) return;
        const TCctor = CombinedTransformControls;
        if (!TCctor) {
            console.warn('[Viewer] TransformControls unavailable; cannot activate component gizmo.');
            return;
        }

        this._stopComponentTransformSession();
        try { if (SchemaForm && typeof SchemaForm.__stopGlobalActiveXform === 'function') SchemaForm.__stopGlobalActiveXform(); } catch { /* ignore */ }

        const controls: any = new (TCctor as any)(this.camera, this.renderer.domElement);
        const initialMode = 'translate';
        try { controls.setMode(initialMode); } catch { controls.mode = initialMode; }
        try { controls.showX = controls.showY = controls.showZ = true; } catch { /* ignore */ }

        const target = new THREE.Object3D();
        target.name = `ComponentTransformTarget:${component.name || component.uuid || ''}`;

        try { this.scene.updateMatrixWorld?.(true); } catch { /* ignore */ }
        try { component.updateMatrixWorld?.(true); } catch { /* ignore */ }

        const box = new THREE.Box3();
        const center = box.setFromObject(component).isEmpty()
            ? component.getWorldPosition(new THREE.Vector3())
            : box.getCenter(new THREE.Vector3());
        target.position.copy(center);

        const componentWorldQuat = component.getWorldQuaternion(new THREE.Quaternion());
        target.quaternion.copy(componentWorldQuat);

        const parent = component.parent || this.scene;
        try { parent?.updateMatrixWorld?.(true); } catch { /* ignore */ }

        const offsetLocal = component.getWorldPosition(new THREE.Vector3()).sub(center);
        const initialTargetQuatInv = componentWorldQuat.clone().invert();
        offsetLocal.applyQuaternion(initialTargetQuatInv);

        const parentInverse = new THREE.Matrix4();
        if (parent && parent.isObject3D) {
            parentInverse.copy(parent.matrixWorld).invert();
        } else {
            parentInverse.identity();
        }

        this.scene.add(target);
        try { controls.attach(target); } catch { /* ignore */ }
        try {
            controls.userData = controls.userData || {};
            controls.userData.excludeFromFit = true;
            this.scene.add(controls);
        } catch { /* ignore */ }

        let helper: any = null;
        try {
            helper = typeof controls.getHelper === 'function' ? controls.getHelper() : null;
            if (helper && helper.isObject3D) {
                helper.userData = helper.userData || {};
                helper.userData.excludeFromFit = true;
                this.scene.add(helper);
            }
        } catch { helper = null; }

        const markOverlay = (obj: any) => {
            if (!obj || !obj.isObject3D) return;
            const apply = (node: any) => {
                if (!node || !node.isObject3D) return;
                const ud = node.userData || (node.userData = {});
                if (ud.__brepOverlayHook) return;
                const prev = node.onBeforeRender;
                node.onBeforeRender = function (this: any, renderer: any, scene: any, camera: any, geometry: any, material: any, group: any) {
                    try { renderer.clearDepth(); } catch { /* ignore */ }
                    if (typeof prev === 'function') {
                        prev.call(this, renderer, scene, camera, geometry, material, group);
                    }
                };
                ud.__brepOverlayHook = true;
            };
            apply(obj);
            try { obj.traverse((child) => apply(child)); } catch { /* ignore */ }
        };
        try { markOverlay(controls); } catch { /* ignore */ }
        try { markOverlay(helper); } catch { /* ignore */ }
        try { markOverlay(controls?._gizmo); } catch { /* ignore */ }
        try { markOverlay(controls?.gizmo); } catch { /* ignore */ }

        const scratchTargetWorld = new THREE.Vector3();
        const scratchComponentWorld = new THREE.Vector3();
        const scratchLocal = new THREE.Vector3();
        const scratchRotatedOffset = new THREE.Vector3();
        const scratchTargetQuat = new THREE.Quaternion();
        const scratchParentQuat = new THREE.Quaternion();
        const scratchParentQuatInv = new THREE.Quaternion();
        const scratchComponentQuat = new THREE.Quaternion();

        const updateComponentTransform = (commit = false) => {
            try {
                try { this.scene.updateMatrixWorld?.(true); } catch { /* ignore */ }
                try { target.updateMatrixWorld?.(true); } catch { /* ignore */ }
                if (parent && parent.isObject3D) {
                    try { parent.updateMatrixWorld?.(true); } catch { /* ignore */ }
                    parentInverse.copy(parent.matrixWorld).invert();
                    parent.getWorldQuaternion(scratchParentQuat);
                    scratchParentQuatInv.copy(scratchParentQuat).invert();
                } else {
                    parentInverse.identity();
                    scratchParentQuat.set(0, 0, 0, 1);
                    scratchParentQuatInv.copy(scratchParentQuat);
                }

                target.getWorldPosition(scratchTargetWorld);
                target.getWorldQuaternion(scratchTargetQuat);

                scratchRotatedOffset.copy(offsetLocal).applyQuaternion(scratchTargetQuat);
                scratchComponentWorld.copy(scratchTargetWorld).add(scratchRotatedOffset);
                scratchLocal.copy(scratchComponentWorld);
                if (parent && parent.isObject3D) {
                    scratchLocal.applyMatrix4(parentInverse);
                }
                component.position.copy(scratchLocal);
                if (parent && parent.isObject3D) {
                    scratchComponentQuat.copy(scratchParentQuatInv).multiply(scratchTargetQuat);
                    component.quaternion.copy(scratchComponentQuat);
                } else {
                    component.quaternion.copy(scratchTargetQuat);
                }
                component.updateMatrixWorld?.(true);
                this.render();
                if (commit && this.partHistory && typeof this.partHistory.syncAssemblyComponentTransforms === 'function') {
                    this.partHistory.syncAssemblyComponentTransforms();
                }
            } catch (err) {
                console.warn('[Viewer] Failed to apply transform to component:', err);
            }
        };

        const changeHandler = () => { updateComponentTransform(false); };
        const dragHandler = (ev: any) => {
            const dragging = !!(ev && ev.value);
            try { if (this.controls) this.controls.enabled = !dragging; } catch { /* ignore */ }
            if (!dragging) updateComponentTransform(true);
        };
        const objectChangeHandler = () => {
            if (!controls || controls.dragging) return;
            updateComponentTransform(true);
        };

        controls.addEventListener('change', changeHandler);
        controls.addEventListener('dragging-changed', dragHandler);
        try { controls.addEventListener('objectChange', objectChangeHandler); } catch { /* ignore */ }

        const isOver = (ev: any) => {
            try {
                if (!ev) return false;
                const ndc = this._getPointerNDC(ev);
                this.raycaster.setFromCamera(ndc, this.camera);
                const mode = (typeof controls.getMode === 'function') ? controls.getMode() : (controls.mode || 'translate');
                const giz = controls._gizmo || controls.gizmo || null;
                const pickRoot = (giz && giz.picker) ? (giz.picker[mode] || giz.picker.translate || giz.picker.rotate || giz.picker.scale) : giz;
                const root = pickRoot || giz || helper || controls;
                if (!root) return false;
                const hits = this.raycaster.intersectObject(root, true) || [];
                return hits.length > 0;
            } catch { return false; }
        };

        const updateForCamera = () => {
            try {
                if (typeof controls.update === 'function') controls.update();
                else controls.updateMatrixWorld(true);
            } catch { /* ignore */ }
        };
        const cameraChangeHandler = () => { updateForCamera(); };
        try { this.controls?.addEventListener?.('change', cameraChangeHandler); } catch { /* ignore */ }

        const globalState = {
            controls,
            viewer: this,
            target,
            isOver,
            updateForCamera,
        };
        try { (window as any).__BREP_activeXform = globalState; } catch { /* ignore */ }

        const sessionMode = (typeof controls.getMode === 'function') ? controls.getMode() : (controls.mode || initialMode);

        this._componentTransformSession = {
            component,
            controls,
            helper,
            target,
            changeHandler,
            dragHandler,
            objectChangeHandler,
            cameraChangeHandler,
            cameraChangeSource: this.controls || null,
            globalState,
            mode: sessionMode,
        };

        updateComponentTransform(false);
        this.render();
    },

    _toggleComponentTransform(component: AnyRecord | null | undefined) {
        if (!component) {
            this._stopComponentTransformSession();
            return;
        }

        if (component.fixed) {
            try {
                if (typeof this._toast === 'function') this._toast('Component is fixed and cannot be moved.');
            } catch { /* ignore */ }
            return;
        }

        const session = this._componentTransformSession;
        if (session && session.component === component) {
            const controls = session.controls;
            const currentMode = (typeof controls?.getMode === 'function')
                ? controls.getMode()
                : (controls?.mode || session.mode || 'translate');
            if (currentMode === 'translate') {
                const nextMode = 'rotate';
                try { controls?.setMode(nextMode); } catch { if (controls) controls.mode = nextMode; }
                session.mode = nextMode;
                try { session.globalState?.updateForCamera?.(); } catch { /* ignore */ }
                try { this.render(); } catch { /* ignore */ }
                return;
            }
            if (currentMode === 'rotate') {
                this._stopComponentTransformSession();
                return;
            }
            this._stopComponentTransformSession();
            return;
        }

        this._activateComponentTransform(component);
    }

    // ----------------------------------------
    // Diagnostics (one‑shot picker)
    // ----------------------------------------
};

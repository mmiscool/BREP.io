"use strict";

import * as THREE from 'three';
import {
  allowSceneOverlayRemoval,
  markSceneOverlayObject,
} from './sceneOverlayUtils.js';

type TransformControlLike = (THREE.Object3D & Record<string, any>) | (Record<string, any> & { isObject3D?: boolean });
type ViewerLike = {
  scene?: {
    add?: (object: any) => void;
    remove?: (object: any) => void;
  };
  render?: () => void;
};
type AddTransformControlOptions = {
  createFallbackGroup?: boolean;
};
type TransformControlSceneBinding = {
  addedToScene: boolean;
  group: any;
  helper: any;
};
type RemoveTransformControlState = {
  viewer?: ViewerLike | null;
  controls?: TransformControlLike | null;
  group?: any;
  target?: any;
};

export function markTransformControlTarget(target: any): void {
  markSceneOverlayObject(target, {
    preserve: true,
    overlayType: 'transformControlTarget',
    deep: true,
  });
}

function markTransformControlObject(object: any): void {
  markSceneOverlayObject(object, {
    preserve: true,
    overlayType: 'transformControl',
    deep: true,
  });
  installTransformControlDepthOverlay(object);
}

function installTransformControlDepthOverlay(object: any): void {
  if (!object || !object.isObject3D) return;
  const apply = (node: any) => {
    try {
      if (!node || !node.isObject3D) return;
      const userData = node.userData || (node.userData = {});
      if (userData.__brepOverlayHook) return;
      const previous = node.onBeforeRender;
      node.onBeforeRender = function (this: any, renderer: any, scene: any, camera: any, geometry: any, material: any, group: any) {
        try { renderer.clearDepth(); } catch { /* ignore depth clear failures */ }
        if (typeof previous === 'function') {
          previous.call(this, renderer, scene, camera, geometry, material, group);
        }
      };
      userData.__brepOverlayHook = true;
    } catch { /* ignore overlay hook failures */ }
  };
  apply(object);
  if (typeof object.traverse === 'function') object.traverse((child) => apply(child));
}

export function refreshTransformControlSceneOverlay(controls: any): void {
  try {
    installTransformControlDepthOverlay(controls);
    installTransformControlDepthOverlay(controls?._gizmo);
    installTransformControlDepthOverlay(controls?._helper);
    installTransformControlDepthOverlay(controls?.gizmo);
    installTransformControlDepthOverlay(controls?.helper);
    installTransformControlDepthOverlay(controls?.__helper);
    installTransformControlDepthOverlay(controls?.__fallbackGroup);
  } catch { /* ignore transform overlay refresh failures */ }
}

export function getTransformControlSceneGroup(controls: any): any {
  if (!controls) return null;
  if (controls.__fallbackGroup && controls.__fallbackGroup.isObject3D) return controls.__fallbackGroup;
  return controls.isObject3D ? controls : null;
}

export function addTransformControlToScene(
  viewer: ViewerLike | null | undefined,
  controls: TransformControlLike | null | undefined,
  { createFallbackGroup = true }: AddTransformControlOptions = {},
): TransformControlSceneBinding {
  if (!viewer?.scene || !controls) {
    return { addedToScene: false, group: null, helper: null };
  }

  let addedToScene = false;
  let helper: any = null;
  try {
    helper = (typeof controls.getHelper === 'function') ? controls.getHelper() : null;
    if (helper && helper.isObject3D) {
      markTransformControlObject(helper);
      viewer.scene.add(helper);
      addedToScene = true;
      controls.__helper = helper;
    } else if (controls.isObject3D) {
      markTransformControlObject(controls);
      viewer.scene.add(controls);
      addedToScene = true;
    }
  } catch { /* ignore direct transform-control scene add failures */ }

  if (!addedToScene && controls.__fallbackGroup && controls.__fallbackGroup.isObject3D) {
    try {
      markTransformControlObject(controls.__fallbackGroup);
      viewer.scene.add(controls.__fallbackGroup);
      addedToScene = true;
    } catch { /* ignore fallback group add failures */ }
  }

  if (!addedToScene && createFallbackGroup) {
    try {
      const group = new THREE.Group();
      group.name = 'TransformControlsGroup';
      const candidates = [
        controls?.gizmo,
        controls?._gizmo,
        controls?.picker,
        controls?._picker,
        controls?.helper,
        controls?._helper,
      ];
      let attached = 0;
      for (const candidate of candidates) {
        if (candidate && candidate.isObject3D) {
          try {
            group.add(candidate);
            attached++;
          } catch { /* ignore invalid transform-control child */ }
        }
      }
      if (attached > 0) {
        markTransformControlObject(group);
        viewer.scene.add(group);
        addedToScene = true;
        controls.__fallbackGroup = group;
      }
    } catch { /* ignore fallback transform-control group creation failures */ }
  }

  refreshTransformControlSceneOverlay(controls);
  return {
    addedToScene,
    group: getTransformControlSceneGroup(controls),
    helper: controls.__helper || helper || null,
  };
}

export function restoreTransformControlSceneObjects(
  viewer: ViewerLike | null | undefined,
  controls: TransformControlLike | null | undefined,
  target: any,
): TransformControlSceneBinding | undefined {
  if (!viewer?.scene || !controls) return;
  if (target && target.isObject3D) {
    markTransformControlTarget(target);
    try { viewer.scene.add?.(target); } catch { /* ignore target scene add failures */ }
  }
  const sceneBinding = addTransformControlToScene(viewer, controls, { createFallbackGroup: false });
  try { if (typeof controls.attach === 'function') controls.attach(target); } catch { /* ignore attach failures */ }
  try {
    const mode = (typeof controls.getMode === 'function') ? controls.getMode() : (controls.mode || 'translate');
    if (typeof controls.setMode === 'function') controls.setMode(mode);
  } catch { /* ignore mode restore failures */ }
  try { viewer.render && viewer.render(); } catch { /* ignore render failures */ }
  refreshTransformControlSceneOverlay(controls);
  try {
    if (typeof controls.update === 'function') controls.update();
    else controls.updateMatrixWorld(true);
  } catch { /* ignore transform-control update failures */ }
  return sceneBinding;
}

export function removeTransformControlSceneObjects(state: RemoveTransformControlState | null | undefined): void {
  if (!state?.viewer?.scene) return;
  const { viewer, controls, group, target } = state;
  try { allowSceneOverlayRemoval(controls, { deep: true }); } catch { /* ignore overlay cleanup failures */ }
  try { allowSceneOverlayRemoval(controls?.__helper, { deep: true }); } catch { /* ignore helper cleanup failures */ }
  try { allowSceneOverlayRemoval(group, { deep: true }); } catch { /* ignore group cleanup failures */ }
  try { allowSceneOverlayRemoval(target, { deep: true }); } catch { /* ignore target cleanup failures */ }
  try { if (controls?.isObject3D) viewer.scene.remove?.(controls); } catch { /* ignore controls removal failures */ }
  try { if (controls?.__helper?.isObject3D) viewer.scene.remove?.(controls.__helper); } catch { /* ignore helper removal failures */ }
  try { if (group?.isObject3D) viewer.scene.remove?.(group); } catch { /* ignore group removal failures */ }
  try { if (target) viewer.scene.remove?.(target); } catch { /* ignore target removal failures */ }
}

"use strict";

import * as THREE from 'three';
import {
  allowSceneOverlayRemoval,
  markSceneOverlayObject,
} from './sceneOverlayUtils.js';

export function markTransformControlTarget(target) {
  markSceneOverlayObject(target, {
    preserve: true,
    overlayType: 'transformControlTarget',
    deep: true,
  });
}

export function markTransformControlObject(object) {
  markSceneOverlayObject(object, {
    preserve: true,
    overlayType: 'transformControl',
    deep: true,
  });
  installTransformControlDepthOverlay(object);
}

export function installTransformControlDepthOverlay(object) {
  if (!object || !object.isObject3D) return;
  const apply = (node) => {
    try {
      if (!node || !node.isObject3D) return;
      const userData = node.userData || (node.userData = {});
      if (userData.__brepOverlayHook) return;
      const previous = node.onBeforeRender;
      node.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
        try { renderer.clearDepth(); } catch (_) { }
        if (typeof previous === 'function') {
          previous.call(this, renderer, scene, camera, geometry, material, group);
        }
      };
      userData.__brepOverlayHook = true;
    } catch (_) { }
  };
  apply(object);
  if (typeof object.traverse === 'function') object.traverse((child) => apply(child));
}

export function refreshTransformControlSceneOverlay(controls) {
  try {
    installTransformControlDepthOverlay(controls);
    installTransformControlDepthOverlay(controls?._gizmo);
    installTransformControlDepthOverlay(controls?._helper);
    installTransformControlDepthOverlay(controls?.gizmo);
    installTransformControlDepthOverlay(controls?.helper);
    installTransformControlDepthOverlay(controls?.__helper);
    installTransformControlDepthOverlay(controls?.__fallbackGroup);
  } catch (_) { }
}

export function getTransformControlSceneGroup(controls) {
  if (!controls) return null;
  if (controls.__fallbackGroup && controls.__fallbackGroup.isObject3D) return controls.__fallbackGroup;
  return controls.isObject3D ? controls : null;
}

export function addTransformControlToScene(viewer, controls, { createFallbackGroup = true } = {}) {
  if (!viewer?.scene || !controls) {
    return { addedToScene: false, group: null, helper: null };
  }

  let addedToScene = false;
  let helper = null;
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
  } catch (_) { }

  if (!addedToScene && controls.__fallbackGroup && controls.__fallbackGroup.isObject3D) {
    try {
      markTransformControlObject(controls.__fallbackGroup);
      viewer.scene.add(controls.__fallbackGroup);
      addedToScene = true;
    } catch (_) { }
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
          } catch (_) { }
        }
      }
      if (attached > 0) {
        markTransformControlObject(group);
        viewer.scene.add(group);
        addedToScene = true;
        controls.__fallbackGroup = group;
      }
    } catch (_) { }
  }

  refreshTransformControlSceneOverlay(controls);
  return {
    addedToScene,
    group: getTransformControlSceneGroup(controls),
    helper: controls.__helper || helper || null,
  };
}

export function restoreTransformControlSceneObjects(viewer, controls, target) {
  if (!viewer?.scene || !controls) return;
  if (target && target.isObject3D) {
    markTransformControlTarget(target);
    try { viewer.scene.add(target); } catch (_) { }
  }
  const sceneBinding = addTransformControlToScene(viewer, controls, { createFallbackGroup: false });
  try { if (typeof controls.attach === 'function') controls.attach(target); } catch (_) { }
  try {
    const mode = (typeof controls.getMode === 'function') ? controls.getMode() : (controls.mode || 'translate');
    if (typeof controls.setMode === 'function') controls.setMode(mode);
  } catch (_) { }
  try { viewer.render && viewer.render(); } catch (_) { }
  refreshTransformControlSceneOverlay(controls);
  try {
    if (typeof controls.update === 'function') controls.update();
    else controls.updateMatrixWorld(true);
  } catch (_) { }
  return sceneBinding;
}

export function removeTransformControlSceneObjects(state) {
  if (!state?.viewer?.scene) return;
  const { viewer, controls, group, target } = state;
  try { allowSceneOverlayRemoval(controls, { deep: true }); } catch (_) { }
  try { allowSceneOverlayRemoval(controls?.__helper, { deep: true }); } catch (_) { }
  try { allowSceneOverlayRemoval(group, { deep: true }); } catch (_) { }
  try { allowSceneOverlayRemoval(target, { deep: true }); } catch (_) { }
  try { if (controls?.isObject3D) viewer.scene.remove(controls); } catch (_) { }
  try { if (controls?.__helper?.isObject3D) viewer.scene.remove(controls.__helper); } catch (_) { }
  try { if (group?.isObject3D) viewer.scene.remove(group); } catch (_) { }
  try { if (target) viewer.scene.remove(target); } catch (_) { }
}

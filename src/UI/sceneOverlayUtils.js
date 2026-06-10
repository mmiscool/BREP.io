export function markSceneOverlayObject(object, {
  preserve = false,
  excludeFromFit = true,
  overlayType = '',
  deep = false,
} = {}) {
  if (!object || typeof object !== 'object') return object;
  const apply = (node) => {
    if (!node || typeof node !== 'object') return;
    try {
      const userData = node.userData || (node.userData = {});
      userData.sceneOverlay = true;
      if (overlayType) userData.sceneOverlayType = overlayType;
      if (excludeFromFit) userData.excludeFromFit = true;
      if (preserve) userData.preventRemove = true;
    } catch { /* ignore overlay marking failures */ }
  };

  apply(object);
  if (deep && typeof object.traverse === 'function') {
    try { object.traverse((child) => apply(child)); } catch { /* ignore traversal failures */ }
  }
  return object;
}

export function allowSceneOverlayRemoval(object, { deep = false } = {}) {
  if (!object || typeof object !== 'object') return object;
  const apply = (node) => {
    if (!node || typeof node !== 'object') return;
    try {
      if (node.userData) node.userData.preventRemove = false;
    } catch { /* ignore overlay unmark failures */ }
  };

  apply(object);
  if (deep && typeof object.traverse === 'function') {
    try { object.traverse((child) => apply(child)); } catch { /* ignore traversal failures */ }
  }
  return object;
}

export function isSceneRemovalProtected(object) {
  let cursor = object || null;
  let guard = 0;
  while (cursor && guard < 64) {
    try {
      if (cursor.userData?.preventRemove === true) return true;
    } catch { /* ignore userData access failures */ }
    cursor = cursor.parent || null;
    guard += 1;
  }
  return false;
}

export function removeSceneOverlayObject(scene, object) {
  if (!object) return;
  allowSceneOverlayRemoval(object, { deep: true });
  try {
    if (object.parent && typeof object.parent.remove === 'function') object.parent.remove(object);
    else if (scene && typeof scene.remove === 'function') scene.remove(object);
  } catch { /* ignore overlay removal failures */ }
}

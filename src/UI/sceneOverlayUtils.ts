type SceneOverlayObject = {
  userData?: Record<string, any>;
  parent?: SceneOverlayObject | null;
  traverse?: (callback: (child: SceneOverlayObject) => void) => void;
};

type SceneOverlayOptions = {
  preserve?: boolean;
  excludeFromFit?: boolean;
  overlayType?: string;
  deep?: boolean;
};

type SceneOverlayRemovalOptions = {
  deep?: boolean;
};

export function markSceneOverlayObject<T extends SceneOverlayObject | null | undefined>(object: T, {
  preserve = false,
  excludeFromFit = true,
  overlayType = '',
  deep = false,
}: SceneOverlayOptions = {}): T {
  if (!object || typeof object !== 'object') return object;
  const apply = (node: SceneOverlayObject | null | undefined) => {
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

export function allowSceneOverlayRemoval<T extends SceneOverlayObject | null | undefined>(
  object: T,
  { deep = false }: SceneOverlayRemovalOptions = {},
): T {
  if (!object || typeof object !== 'object') return object;
  const apply = (node: SceneOverlayObject | null | undefined) => {
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

export function isSceneRemovalProtected(object: SceneOverlayObject | null | undefined): boolean {
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

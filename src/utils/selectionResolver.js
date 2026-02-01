const DEFAULT_SPLIT_REGEX = /›|>|\/|\||→|->/;

export function scoreObjectForNormal(object) {
  if (!object) return -Infinity;
  const type = object.userData?.type || object.userData?.brepType || object.type;
  if (String(type).toUpperCase() === 'FACE') return 3;
  if (object.geometry) return 2;
  return 1;
}

export function resolveSelectionObject(scene, selection, options = {}) {
  const {
    scoreFn = null,
    nameResolver = null,
    arrayMode = 'firstResolved',
    allowJson = true,
    allowUuid = undefined,
    allowUuidString = true,
    allowUuidObject = true,
    allowFuzzyName = true,
    allowNameContains = true,
    allowPath = true,
    allowReference = true,
    allowTarget = true,
    allowSelectionName = true,
    allowObjectPassthrough = false,
  } = options;

  const uuidString = allowUuid ?? allowUuidString;
  const uuidObject = allowUuid ?? allowUuidObject;

  return internalResolveSelectionObject(scene, selection, {
    scoreFn,
    nameResolver,
    arrayMode,
    allowJson,
    allowUuidString: uuidString,
    allowUuidObject: uuidObject,
    allowFuzzyName,
    allowNameContains,
    allowPath,
    allowReference,
    allowTarget,
    allowSelectionName,
    allowObjectPassthrough,
  });
}

function internalResolveSelectionObject(scene, selection, options) {
  if (selection == null) return null;
  if (selection.isObject3D) return selection;

  if (Array.isArray(selection)) {
    if (options.arrayMode === 'first') {
      const first = selection.find((item) => item != null);
      return internalResolveSelectionObject(scene, first, options);
    }
    for (const item of selection) {
      const resolved = internalResolveSelectionObject(scene, item, options);
      if (resolved) return resolved;
    }
    return null;
  }

  if (typeof selection === 'string') {
    return resolveObjectFromString(scene, selection, options);
  }

  if (typeof selection === 'object') {
    if (selection.isObject3D) return selection;

    const {
      uuid,
      name,
      id,
      path,
      reference,
      target,
      selectionName,
    } = selection;

    if (options.allowUuidObject && typeof uuid === 'string' && scene?.getObjectByProperty) {
      try {
        const found = scene.getObjectByProperty('uuid', uuid);
        if (found) return found;
      } catch { /* ignore */ }
    }

    const resolveCandidate = (candidate) => (
      typeof candidate === 'string'
        ? resolveObjectFromString(scene, candidate, options)
        : null
    );

    const nameCandidate = typeof name === 'string'
      ? name
      : (options.allowSelectionName && typeof selectionName === 'string' ? selectionName : null);
    const idCandidate = typeof id === 'string' ? id : null;

    const nameResolved = resolveCandidate(nameCandidate);
    if (nameResolved) return nameResolved;

    const idResolved = resolveCandidate(idCandidate);
    if (idResolved) return idResolved;

    if (options.allowPath && Array.isArray(path)) {
      for (let i = path.length - 1; i >= 0; i -= 1) {
        const segment = path[i];
        if (typeof segment !== 'string') continue;
        const resolved = resolveObjectFromString(scene, segment, options);
        if (resolved) return resolved;
      }
    }

    if (options.allowReference && reference != null) {
      const resolved = internalResolveSelectionObject(scene, reference, options);
      if (resolved) return resolved;
    }

    if (options.allowTarget && target != null) {
      const resolved = internalResolveSelectionObject(scene, target, options);
      if (resolved) return resolved;
    }

    return options.allowObjectPassthrough ? selection : null;
  }

  return null;
}

function resolveObjectFromString(scene, value, options) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (options.allowJson && isProbablyJson(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed != null) {
        const resolved = internalResolveSelectionObject(scene, parsed, options);
        if (resolved) return resolved;
      }
    } catch { /* ignore JSON parse errors */ }
  }

  if (typeof options.nameResolver === 'function') {
    try {
      const direct = options.nameResolver(trimmed);
      if (direct) return direct;
    } catch { /* ignore */ }
  }

  if (scene) {
    const direct = findObjectByName(scene, trimmed, options.scoreFn);
    if (direct) return direct;
  }

  if (options.allowUuidString && scene?.getObjectByProperty && looksLikeUUID(trimmed)) {
    try {
      const byUuid = scene.getObjectByProperty('uuid', trimmed);
      if (byUuid) return byUuid;
    } catch { /* ignore */ }
  }

  if (!scene) return null;

  if (options.allowFuzzyName) {
    const candidates = new Set();
    candidates.add(trimmed);

    const splitByDelims = trimmed.split(DEFAULT_SPLIT_REGEX);
    if (splitByDelims.length > 1) {
      for (const segment of splitByDelims) {
        const s = segment.trim();
        if (s) candidates.add(s);
      }
    }

    if (trimmed.includes(':')) {
      for (const segment of trimmed.split(':')) {
        const s = segment.trim();
        if (s) candidates.add(s);
      }
    }

    for (const candidate of candidates) {
      const found = findObjectByName(scene, candidate, options.scoreFn);
      if (found) return found;
    }
  }

  if (options.allowNameContains) {
    let fallback = null;
    try {
      scene.traverse?.((obj) => {
        if (fallback || !obj?.name) return;
        if (!trimmed.includes(obj.name)) return;
        if (!fallback) {
          fallback = obj;
          return;
        }
        const currentScore = scoreObject(fallback, options.scoreFn);
        const nextScore = scoreObject(obj, options.scoreFn);
        if (nextScore > currentScore || obj.name.length > fallback.name.length) {
          fallback = obj;
        }
      });
    } catch { /* ignore */ }
    return fallback;
  }

  return null;
}

function findObjectByName(scene, name, scoreFn) {
  if (!scene || typeof name !== 'string' || !name) return null;

  if (typeof scene.traverse !== 'function') {
    return scene?.getObjectByName?.(name) || null;
  }

  let best = null;
  scene.traverse((obj) => {
    if (!obj || obj.name !== name) return;
    if (!best) {
      best = obj;
      return;
    }
    const currentScore = scoreObject(best, scoreFn);
    const nextScore = scoreObject(obj, scoreFn);
    if (nextScore > currentScore) best = obj;
  });

  if (best) return best;
  if (typeof scene.getObjectByName === 'function') return scene.getObjectByName(name);
  return null;
}

function scoreObject(object, scoreFn) {
  if (typeof scoreFn !== 'function') return 0;
  try {
    const score = scoreFn(object);
    return Number.isFinite(score) ? score : 0;
  } catch {
    return 0;
  }
}

function looksLikeUUID(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length !== 36) return false;
  return /^[0-9a-fA-F-]{36}$/.test(trimmed);
}

function isProbablyJson(value) {
  return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'));
}

function normalizeFeatureId(value) {
  if (value === 0) return '0';
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function getObjectType(obj) {
  return String(obj?.type || '').toUpperCase();
}

function getSelectionTarget(item) {
  return item?.object || item?.target || item || null;
}

function getFeatureIdFromSplineMetadata(obj) {
  let current = obj || null;
  while (current) {
    const resolved = normalizeFeatureId(current?.userData?.splineFeatureId);
    if (resolved) return resolved;
    current = current.parent || null;
  }
  return null;
}

function findParentSolid(obj) {
  let current = obj || null;
  while (current) {
    if (String(current?.type || '').toUpperCase() === 'SOLID') return current;
    if (current?.parentSolid && String(current.parentSolid?.type || '').toUpperCase() === 'SOLID') {
      return current.parentSolid;
    }
    current = current.parent || null;
  }
  return null;
}

function getPreciseFeatureIdFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const directKeys = [
    'sourceFeatureId',
    'sourceFeatureID',
    'createdByFeatureId',
  ];
  for (const key of directKeys) {
    const resolved = normalizeFeatureId(metadata?.[key]);
    if (resolved) return resolved;
  }
  return null;
}

function getFeatureIdFromFaceMetadata(obj) {
  const direct = getPreciseFeatureIdFromMetadata(obj?.userData);
  if (direct) return direct;
  const faceName = obj?.userData?.faceName || obj?.name || null;
  if (!faceName) return null;
  const solid = findParentSolid(obj);
  if (!solid || typeof solid.getFaceMetadata !== 'function') return null;
  try {
    return getPreciseFeatureIdFromMetadata(solid.getFaceMetadata(faceName));
  } catch {
    return null;
  }
}

function getFeatureIdFromEdgeMetadata(obj) {
  const direct = getPreciseFeatureIdFromMetadata(obj?.userData);
  if (direct) return direct;
  const edgeName = obj?.userData?.edgeName || obj?.name || null;
  if (!edgeName) return null;
  const solid = findParentSolid(obj);
  if (!solid || typeof solid.getEdgeMetadata !== 'function') return null;
  try {
    return getPreciseFeatureIdFromMetadata(solid.getEdgeMetadata(edgeName));
  } catch {
    return null;
  }
}

export function resolveOwningFeatureIdForObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const type = getObjectType(obj);
  if (type === 'FACE' || type === 'PLANE') {
    return getFeatureIdFromFaceMetadata(obj);
  }
  if (type === 'EDGE') {
    return getFeatureIdFromEdgeMetadata(obj);
  }
  return null;
}

export function resolveOwningFeatureIdForSelection(selection) {
  const items = Array.isArray(selection) ? selection : [];
  if (items.length !== 1) return null;
  return resolveOwningFeatureIdForObject(getSelectionTarget(items[0]));
}

export function resolveSplineFeatureIdForObject(obj) {
  return getFeatureIdFromSplineMetadata(obj);
}

export function resolveSplineFeatureIdForSelection(selection) {
  const items = Array.isArray(selection) ? selection : [];
  if (items.length !== 1) return null;
  return resolveSplineFeatureIdForObject(getSelectionTarget(items[0]));
}

export function isSingleSplineSelection(selection) {
  return !!resolveSplineFeatureIdForSelection(selection);
}

export function isSingleSelectionOfTypes(selection, allowedTypes = []) {
  const items = Array.isArray(selection) ? selection : [];
  if (items.length !== 1) return false;
  const typeSet = new Set((allowedTypes || []).map((type) => String(type || '').toUpperCase()));
  if (!typeSet.size) return false;
  const target = getSelectionTarget(items[0]);
  return typeSet.has(getObjectType(target));
}

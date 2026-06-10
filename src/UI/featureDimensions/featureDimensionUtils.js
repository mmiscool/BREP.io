import * as THREE from 'three';
export {
  normalizeFeatureDimensionFeatureKey,
  supportsFeatureDimensionFeatureKey,
  supportsTransformDimensionToggle,
} from './FeatureDimensionRegistry.js';

const EPS = 1e-9;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function getFeatureDimensionObjectTypeTag(object) {
  if (!object) return '';
  const rawType = object?.userData?.type || object?.userData?.brepType || object?.type || '';
  return String(rawType).toUpperCase();
}

export function collectFeatureDimensionReferenceNames(selection) {
  const out = [];
  const addName = (candidate) => {
    if (candidate == null) return;
    const name = String(candidate).trim();
    if (!name) return;
    if (!out.includes(name)) out.push(name);
  };

  const consume = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) consume(item);
      return;
    }
    if (typeof value === 'string') {
      addName(value);
      return;
    }
    if (typeof value === 'object') {
      if (value.isObject3D) addName(value.name);
      addName(value.name);
      addName(value.selectionName);
      addName(value.id);
      addName(value.faceName);
      addName(value.edgeName);
      if (value.reference != null) consume(value.reference);
      if (value.target != null) consume(value.target);
    }
  };

  consume(selection);
  return out;
}

export function resolveFeatureDimensionEffectReferenceObject(entry, selection = null, allowedTypes = null) {
  const names = collectFeatureDimensionReferenceNames(selection);
  if (!names.length) return null;
  const nameSet = new Set(names);
  const typeSet = allowedTypes instanceof Set
    ? allowedTypes
    : (Array.isArray(allowedTypes) ? new Set(allowedTypes.map((type) => String(type).toUpperCase())) : null);
  const acceptsType = (object) => {
    if (!(typeSet instanceof Set) || typeSet.size === 0) return true;
    return typeSet.has(getFeatureDimensionObjectTypeTag(object));
  };
  const sources = [
    ...(Array.isArray(entry?.effects?.removed) ? entry.effects.removed : []),
    ...(Array.isArray(entry?.effects?.added) ? entry.effects.added : []),
  ].filter(Boolean);

  const findInTree = (root) => {
    let match = null;
    const visit = (obj) => {
      if (!obj || match) return;
      if (nameSet.has(String(obj.name || '')) && acceptsType(obj)) {
        match = obj;
        return;
      }
      const kids = Array.isArray(obj.children) ? obj.children : [];
      for (const child of kids) visit(child);
    };
    visit(root);
    return match;
  };

  for (const source of sources) {
    const match = findInTree(source);
    if (match) return match;
  }
  return null;
}

export function resolvePortExtensionAnnotationGeometry(portDefinition, minVisibleLength = 0) {
  const pointRaw = Array.isArray(portDefinition?.point) ? portDefinition.point : null;
  const directionRaw = Array.isArray(portDefinition?.direction) ? portDefinition.direction : null;
  if (!pointRaw || pointRaw.length < 3 || !directionRaw || directionRaw.length < 3) return null;

  const pointA = new THREE.Vector3(
    toFiniteNumber(pointRaw[0], 0),
    toFiniteNumber(pointRaw[1], 0),
    toFiniteNumber(pointRaw[2], 0),
  );
  const direction = new THREE.Vector3(
    toFiniteNumber(directionRaw[0], 0),
    toFiniteNumber(directionRaw[1], 0),
    toFiniteNumber(directionRaw[2], 0),
  );
  if (direction.lengthSq() <= EPS) return null;
  direction.normalize();

  const extension = Math.max(0, toFiniteNumber(portDefinition?.extension, 0));
  const dragPlaneValue = Math.max(extension, Math.max(0, toFiniteNumber(minVisibleLength, 0)));
  const pointB = pointA.clone().addScaledVector(direction, dragPlaneValue);

  return {
    pointA,
    pointB,
    value: extension,
    dragPlaneValue,
  };
}

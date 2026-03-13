import * as THREE from 'three';

const EPS = 1e-9;
const SUPPORTED_FEATURE_KEYS = new Set(['P.CU', 'P.CY', 'P.CO', 'P.S', 'P.PY', 'P.T', 'E', 'R', 'PORT']);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeFeatureDimensionFeatureKey(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase();
}

export function supportsFeatureDimensionFeatureKey(key) {
  return SUPPORTED_FEATURE_KEYS.has(normalizeFeatureDimensionFeatureKey(key));
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

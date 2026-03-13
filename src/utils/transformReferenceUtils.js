import * as THREE_NS from 'three';
import { combineBaseWithDeltaDeg } from './xformMath.js';

const EPS = 1e-9;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizeVec3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [
    toFiniteNumber(source?.[0], fallback[0] || 0),
    toFiniteNumber(source?.[1], fallback[1] || 0),
    toFiniteNumber(source?.[2], fallback[2] || 0),
  ];
}

function normalizeReferenceName(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (name) return name;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (id) return id;
  }
  return '';
}

function pickOrthogonalUnit(direction, THREE = THREE_NS) {
  const dir = direction.clone().normalize();
  const worldUp = Math.abs(dir.dot(new THREE.Vector3(0, 0, 1))) > 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  const yAxis = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
  if (yAxis.lengthSq() <= EPS) return new THREE.Vector3(0, 1, 0);
  return yAxis;
}

function resolveScene(source) {
  if (source?.scene?.getObjectByName) return source.scene;
  if (source?.partHistory?.scene?.getObjectByName) return source.partHistory.scene;
  if (source?.viewer?.scene?.getObjectByName) return source.viewer.scene;
  if (source?.getObjectByName) return source;
  return null;
}

function resolveWorldPosition(object, THREE = THREE_NS) {
  const origin = new THREE.Vector3();
  try { object?.getWorldPosition?.(origin); } catch { /* ignore */ }
  return origin;
}

function resolveFaceCenter(object, THREE = THREE_NS) {
  try {
    const geometry = object?.geometry || null;
    if (geometry) {
      const sphere = geometry.boundingSphere || (geometry.computeBoundingSphere(), geometry.boundingSphere);
      if (sphere) return object.localToWorld(sphere.center.clone());
    }
  } catch { /* ignore */ }
  return resolveWorldPosition(object, THREE);
}

function resolveFaceDirection(object, THREE = THREE_NS) {
  let normal = null;
  try {
    if (typeof object?.getAverageNormal === 'function') {
      normal = object.getAverageNormal()?.clone?.() || null;
    }
  } catch { /* ignore */ }
  if (!normal || normal.lengthSq() <= EPS) {
    const quat = new THREE.Quaternion();
    try { object?.getWorldQuaternion?.(quat); } catch { /* ignore */ }
    normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  }
  if (!normal || normal.lengthSq() <= EPS) return new THREE.Vector3(1, 0, 0);
  return normal.normalize();
}

function resolveEdgePolyline(object, THREE = THREE_NS) {
  try {
    if (typeof object?.points === 'function') {
      const pts = object.points(true) || [];
      return pts
        .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z))
        .map((pt) => new THREE.Vector3(pt.x, pt.y, pt.z));
    }
  } catch { /* ignore */ }
  return [];
}

function resolveClosestPointOnEdge(points, pickPoint, THREE = THREE_NS) {
  const target = pickPoint?.clone?.();
  if (!target || !Array.isArray(points) || points.length < 2) return null;
  let best = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = end.clone().sub(start);
    const lengthSq = segment.lengthSq();
    if (lengthSq <= EPS) continue;
    const t = THREE.MathUtils.clamp(target.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    const projected = start.clone().addScaledVector(segment, t);
    const distanceSq = projected.distanceToSquared(target);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = {
        origin: projected,
        direction: segment.normalize(),
      };
    }
  }
  return best;
}

function resolveEdgeAnchor(object, pickPoint = null, THREE = THREE_NS) {
  const points = resolveEdgePolyline(object, THREE);
  if (points.length >= 2) {
    if (pickPoint?.isVector3) {
      const picked = resolveClosestPointOnEdge(points, pickPoint, THREE);
      if (picked) return picked;
    }

    const segmentLengths = [];
    let totalLength = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const length = points[index].distanceTo(points[index + 1]);
      segmentLengths.push(length);
      totalLength += length;
    }
    if (totalLength > EPS) {
      const half = totalLength * 0.5;
      let walked = 0;
      for (let index = 0; index < segmentLengths.length; index += 1) {
        const length = segmentLengths[index];
        if (walked + length >= half) {
          const t = THREE.MathUtils.clamp((half - walked) / Math.max(length, EPS), 0, 1);
          return {
            origin: points[index].clone().lerp(points[index + 1], t),
            direction: points[index + 1].clone().sub(points[index]).normalize(),
          };
        }
        walked += length;
      }
      return {
        origin: points[points.length - 1].clone(),
        direction: points[points.length - 1].clone().sub(points[points.length - 2]).normalize(),
      };
    }
  }
  return {
    origin: pickPoint?.clone?.() || resolveWorldPosition(object, THREE),
    direction: new THREE.Vector3(1, 0, 0),
  };
}

function makeBasisTransform(origin, xAxis, THREE = THREE_NS) {
  const x = xAxis.clone().normalize();
  const ySeed = pickOrthogonalUnit(x, THREE);
  const z = new THREE.Vector3().crossVectors(x, ySeed).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return {
    position: [origin.x, origin.y, origin.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: [1, 1, 1],
  };
}

export function sanitizeTransformReference(value) {
  if (value == null) return null;
  if (value?.isObject3D) {
    const name = normalizeReferenceName(value);
    return name ? {
      name,
      type: String(value.type || '').toUpperCase(),
    } : null;
  }

  if (typeof value === 'string') {
    const name = normalizeReferenceName(value);
    return name ? name : null;
  }

  if (typeof value === 'object') {
    const name = normalizeReferenceName(value);
    if (!name) return null;
    const next = { name };
    const type = String(value.type || '').trim().toUpperCase();
    if (type) next.type = type;
    if (Array.isArray(value.pickPoint) && value.pickPoint.length >= 3) {
      next.pickPoint = sanitizeVec3(value.pickPoint, [0, 0, 0]);
    }
    if (Number.isFinite(Number(value.faceIndex)) && Number(value.faceIndex) >= 0) {
      next.faceIndex = Math.floor(Number(value.faceIndex));
    }
    return next;
  }

  return null;
}

export function resolveTransformReferenceName(value) {
  const sanitized = sanitizeTransformReference(value);
  if (typeof sanitized === 'string') return sanitized;
  return typeof sanitized?.name === 'string' ? sanitized.name : '';
}

export function sanitizeTransformValue(value) {
  const source = value && typeof value === 'object' ? value : {};
  const next = {
    position: sanitizeVec3(source.position, [0, 0, 0]),
    rotationEuler: sanitizeVec3(source.rotationEuler, [0, 0, 0]),
    scale: sanitizeVec3(source.scale, [1, 1, 1]),
  };
  const reference = sanitizeTransformReference(source.reference);
  if (reference) next.reference = reference;
  return next;
}

export function resolveTransformReferenceObject(reference, source) {
  if (reference?.isObject3D) return reference;
  const scene = resolveScene(source);
  const name = resolveTransformReferenceName(reference);
  if (!scene || !name || typeof scene.getObjectByName !== 'function') return null;
  try { return scene.getObjectByName(name) || null; } catch { return null; }
}

export function resolveTransformReferenceBase(reference, source, options = {}, THREE = THREE_NS) {
  const fallbackDirection = new THREE.Vector3(...sanitizeVec3(options?.fallbackDirection, [1, 0, 0]));
  if (fallbackDirection.lengthSq() <= EPS) fallbackDirection.set(1, 0, 0);
  fallbackDirection.normalize();

  const fallbackOrigin = new THREE.Vector3(...sanitizeVec3(options?.fallbackOrigin, [0, 0, 0]));
  const referenceMeta = sanitizeTransformReference(reference);
  const pickPoint = Array.isArray(referenceMeta?.pickPoint) ? new THREE.Vector3(...referenceMeta.pickPoint) : null;
  const object = resolveTransformReferenceObject(reference, source);
  const type = String(referenceMeta?.type || object?.type || '').trim().toUpperCase();

  if (!object) {
    return makeBasisTransform(pickPoint || fallbackOrigin, fallbackDirection, THREE);
  }

  if (type === 'FACE') {
    return makeBasisTransform(pickPoint || resolveFaceCenter(object, THREE), resolveFaceDirection(object, THREE), THREE);
  }

  if (type === 'EDGE') {
    const anchor = resolveEdgeAnchor(object, pickPoint, THREE);
    return makeBasisTransform(anchor.origin, anchor.direction, THREE);
  }

  if (type === 'VERTEX') {
    return makeBasisTransform(pickPoint || resolveWorldPosition(object, THREE), fallbackDirection, THREE);
  }

  const origin = pickPoint || resolveWorldPosition(object, THREE);
  if (type === 'PLANE') {
    const quat = new THREE.Quaternion();
    try { object.getWorldQuaternion?.(quat); } catch { /* ignore */ }
    const xAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    return makeBasisTransform(origin, xAxis.lengthSq() > EPS ? xAxis : fallbackDirection, THREE);
  }

  const quat = new THREE.Quaternion();
  try { object.getWorldQuaternion?.(quat); } catch { /* ignore */ }
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  return makeBasisTransform(origin, xAxis.lengthSq() > EPS ? xAxis : fallbackDirection, THREE);
}

export function composeReferencedTransformMatrix(transform, source, options = {}, THREE = THREE_NS) {
  const delta = sanitizeTransformValue(transform);
  const base = resolveTransformReferenceBase(delta.reference, source, options, THREE);
  return combineBaseWithDeltaDeg(base, delta, THREE);
}

export function resolveReferencedTransform(transform, source, options = {}, THREE = THREE_NS) {
  const matrix = composeReferencedTransformMatrix(transform, source, options, THREE);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  const sanitized = sanitizeTransformValue(transform);
  const resolved = {
    position: [position.x, position.y, position.z],
    rotationEuler: [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: [scale.x, scale.y, scale.z],
  };
  if (sanitized.reference) resolved.reference = sanitized.reference;
  return resolved;
}

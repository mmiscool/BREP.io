import * as THREE from 'three';
import { BREP } from '../BREP/BREP.js';

const ROUTE_GROUP_NAME = '__WireHarnessRoutes';
const DEFAULT_ROUTE_COLOR = '#8b949e';

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function dedupePoints(points, tolerance = 1e-6) {
  const out = [];
  const toleranceSq = tolerance * tolerance;
  for (const point of Array.isArray(points) ? points : []) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const next = new THREE.Vector3(
      normalizeNumber(point[0], 0),
      normalizeNumber(point[1], 0),
      normalizeNumber(point[2], 0),
    );
    const prev = out[out.length - 1];
    if (!prev || prev.distanceToSquared(next) > toleranceSq) {
      out.push(next);
    }
  }
  return out;
}

function disposeObjectTree(object) {
  if (!object) return;
  const children = Array.isArray(object.children) ? object.children.slice() : [];
  for (const child of children) {
    disposeObjectTree(child);
  }
  if (object.parent) {
    try { object.parent.remove(object); } catch { /* ignore */ }
  }
  const geometry = object.geometry;
  if (geometry?.dispose) {
    try { geometry.dispose(); } catch { /* ignore */ }
  }
  const material = object.material;
  if (Array.isArray(material)) {
    for (const entry of material) {
      try { entry?.dispose?.(); } catch { /* ignore */ }
    }
  } else {
    try { material?.dispose?.(); } catch { /* ignore */ }
  }
  try { object.free?.(); } catch { /* ignore */ }
}

function tintRouteMaterial(material, color) {
  const next = material?.clone?.() || material;
  if (!next) return next;
  try { next.color?.set?.(color); } catch { /* ignore */ }
  try {
    if (next.emissive?.set) {
      next.emissive.set(color);
      if (typeof next.emissive.multiplyScalar === 'function') next.emissive.multiplyScalar(0.18);
    }
  } catch { /* ignore */ }
  if (typeof next.roughness === 'number') next.roughness = 0.62;
  if (typeof next.metalness === 'number') next.metalness = 0.08;
  if (typeof next.opacity === 'number') next.opacity = 1;
  if (typeof next.transparent === 'boolean') next.transparent = false;
  if (typeof next.polygonOffset === 'boolean') next.polygonOffset = true;
  if (typeof next.polygonOffsetFactor === 'number') next.polygonOffsetFactor = -1;
  if (typeof next.polygonOffsetUnits === 'number') next.polygonOffsetUnits = -2;
  return next;
}

function applyRouteAppearance(solid, color) {
  if (!solid?.traverse) return;
  solid.renderOrder = 5000;
  solid.traverse((object) => {
    if (!object?.material) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((entry) => tintRouteMaterial(entry, color));
    } else {
      object.material = tintRouteMaterial(object.material, color);
    }
    try { object.userData = { ...(object.userData || {}), __defaultMaterial: object.material }; } catch { /* ignore */ }
    object.renderOrder = 5000;
  });
}

function createBundleSolid(segment) {
  const points = dedupePoints(segment?.polyline);
  if (points.length < 2) return null;

  const radius = Math.max(0.01, normalizeNumber(segment?.diameter, 1) * 0.5);
  const color = new THREE.Color(DEFAULT_ROUTE_COLOR);
  const solid = new BREP.Tube({
    points: points.map((point) => [point.x, point.y, point.z]),
    radius,
    innerRadius: 0,
    resolution: 14,
    closed: false,
    name: String(segment?.featureId || segment?.segmentId || 'Wire Bundle').trim() || 'Wire Bundle',
    preferFast: true,
    autoVisualize: false,
  });
  if (!solid || solid.type !== 'SOLID') return null;
  const triCount = ((solid?._triVerts?.length || 0) / 3) | 0;
  if (triCount <= 0) return null;
  solid.visualize({ showEdges: false });
  applyRouteAppearance(solid, color);
  solid.castShadow = false;
  solid.receiveShadow = false;
  solid.userData = {
    ...(solid.userData || {}),
    isWireHarnessRoute: true,
    isWireHarnessBundleSegment: true,
    segmentId: segment?.segmentId || '',
    featureId: segment?.featureId || '',
    wireCount: Math.max(0, normalizeNumber(segment?.wireCount, 0)),
    wireDiameters: Array.isArray(segment?.wireDiameters)
      ? segment.wireDiameters.slice()
      : (Number.isFinite(Number(segment?.diameter)) ? [Math.max(0.01, normalizeNumber(segment?.diameter, 1))] : []),
    connectionIds: Array.isArray(segment?.connectionIds)
      ? segment.connectionIds.slice()
      : (segment?.connectionId ? [String(segment.connectionId)] : []),
    connectionNames: Array.isArray(segment?.connectionNames)
      ? segment.connectionNames.slice()
      : (segment?.connectionName ? [String(segment.connectionName)] : []),
    bundleDiameter: Math.max(0, normalizeNumber(segment?.diameter, 0)),
    color: color.getHexString ? `#${color.getHexString()}` : DEFAULT_ROUTE_COLOR,
  };
  return solid;
}

export function clearWireHarnessRouteGroup(scene) {
  if (!scene?.getObjectByName) return null;
  const existing = scene.getObjectByName(ROUTE_GROUP_NAME);
  if (!existing) return null;
  disposeObjectTree(existing);
  return null;
}

export function listWireHarnessRouteObjectsForConnection(scene, connectionId) {
  const targetId = String(connectionId == null ? '' : connectionId).trim();
  if (!scene?.getObjectByName || !targetId) return [];
  const group = scene.getObjectByName(ROUTE_GROUP_NAME);
  if (!group) return [];
  const matches = [];
  group.traverse?.((object) => {
    if (!object?.userData?.isWireHarnessRoute) return;
    const ids = Array.isArray(object?.userData?.connectionIds) ? object.userData.connectionIds : [];
    if (ids.some((id) => String(id == null ? '' : id).trim() === targetId)) matches.push(object);
  });
  return matches;
}

export function renderWireHarnessRoutes(scene, routes = [], bundleSegments = []) {
  if (!scene) return null;
  clearWireHarnessRouteGroup(scene);

  const group = new THREE.Group();
  group.name = ROUTE_GROUP_NAME;
  group.renderOrder = 5000;
  group.userData = {
    isWireHarnessRouteGroup: true,
  };

  const segments = Array.isArray(bundleSegments) && bundleSegments.length
    ? bundleSegments
    : Array.isArray(routes)
      ? routes.filter((route) => route?.feasible)
      : [];

  for (const segment of segments) {
    const solid = createBundleSolid(segment);
    if (solid) group.add(solid);
  }

  scene.add(group);
  return group;
}

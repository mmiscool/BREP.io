import * as THREE from 'three';

const ROUTE_GROUP_NAME = '__WireHarnessRoutes';
const DEFAULT_ROUTE_COLOR = '#f59e0b';

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
}

function buildRouteCurve(points) {
  const curve = new THREE.CurvePath();
  for (let index = 0; index < points.length - 1; index += 1) {
    curve.add(new THREE.LineCurve3(points[index], points[index + 1]));
  }
  return curve;
}

function createBundleMesh(segment) {
  const points = dedupePoints(segment?.polyline);
  if (points.length < 2) return null;

  const curve = buildRouteCurve(points);
  const tubularSegments = Math.max(16, (points.length - 1) * 12);
  const radius = Math.max(0.01, normalizeNumber(segment?.diameter, 1) * 0.5);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 14, false);
  const color = new THREE.Color(DEFAULT_ROUTE_COLOR);
  const material = new THREE.MeshStandardMaterial({
    color: color.getStyle(),
    emissive: color.clone().multiplyScalar(0.18),
    roughness: 0.62,
    metalness: 0.08,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = String(segment?.featureId || segment?.segmentId || 'Wire Bundle').trim() || 'Wire Bundle';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 5000;
  mesh.userData = {
    isWireHarnessRoute: true,
    isWireHarnessBundleSegment: true,
    segmentId: segment?.segmentId || '',
    featureId: segment?.featureId || '',
    wireCount: Math.max(0, normalizeNumber(segment?.wireCount, 0)),
    wireDiameters: Array.isArray(segment?.wireDiameters) ? segment.wireDiameters.slice() : [],
    connectionIds: Array.isArray(segment?.connectionIds) ? segment.connectionIds.slice() : [],
    connectionNames: Array.isArray(segment?.connectionNames) ? segment.connectionNames.slice() : [],
    bundleDiameter: Math.max(0, normalizeNumber(segment?.diameter, 0)),
    color: color.getHexString ? `#${color.getHexString()}` : DEFAULT_ROUTE_COLOR,
  };
  return mesh;
}

export function clearWireHarnessRouteGroup(scene) {
  if (!scene?.getObjectByName) return null;
  const existing = scene.getObjectByName(ROUTE_GROUP_NAME);
  if (!existing) return null;
  disposeObjectTree(existing);
  return null;
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
    const mesh = createBundleMesh(segment);
    if (mesh) group.add(mesh);
  }

  scene.add(group);
  return group;
}

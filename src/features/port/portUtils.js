import * as THREE from 'three';
import { BREP } from '../../BREP/BREP.js';
import { SelectionFilter } from '../../UI/SelectionFilter.js';
import { SelectionState } from '../../UI/SelectionState.js';

const PORT_COLOR = '#b14cff';
const PORT_WAYPOINT_COLOR = '#d78cff';
const DEFAULT_EXTENSION = 2;
const DEFAULT_DISPLAY_LENGTH = 6;

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeString(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function sanitizeVec3(value, fallback = [0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  return [
    toFiniteNumber(source?.[0], fallback[0] || 0),
    toFiniteNumber(source?.[1], fallback[1] || 0),
    toFiniteNumber(source?.[2], fallback[2] || 0),
  ];
}

function normalizeDirectionArray(value, fallback = [1, 0, 0]) {
  const next = new THREE.Vector3(...sanitizeVec3(value, fallback));
  if (next.lengthSq() <= 1e-12) {
    return fallback.slice();
  }
  next.normalize();
  return [next.x, next.y, next.z];
}

function cloneTransform(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    position: sanitizeVec3(source.position, [0, 0, 0]),
    rotationEuler: sanitizeVec3(source.rotationEuler, [0, 0, 0]),
    scale: sanitizeVec3(source.scale, [1, 1, 1]),
  };
}

export function normalizePortKind(value) {
  const raw = String(value || 'termination').trim().toLowerCase();
  return raw === 'waypoint' ? 'waypoint' : 'termination';
}

export function normalizePortDefinition(raw, fallbackFeatureId = 'Port') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const direction = normalizeDirectionArray(source.direction, [1, 0, 0]);
  return {
    version: 1,
    featureId: normalizeString(source.featureId, fallbackFeatureId),
    name: normalizeString(source.name, normalizeString(source.featureId, fallbackFeatureId)),
    kind: normalizePortKind(source.kind),
    point: sanitizeVec3(source.point, [0, 0, 0]),
    direction,
    rotation: Array.isArray(source.rotation) && source.rotation.length === 9
      ? source.rotation.slice(0, 9).map((value, index) => toFiniteNumber(value, index === 0 || index === 4 || index === 8 ? 1 : 0))
      : createRotationArrayFromDirection(direction),
    extension: Math.max(0, toFiniteNumber(source.extension, DEFAULT_EXTENSION)),
    displayLength: Math.max(0.1, toFiniteNumber(source.displayLength, DEFAULT_DISPLAY_LENGTH)),
    anchorName: normalizeString(source.anchorName, ''),
    directionRefName: normalizeString(source.directionRefName, ''),
    transform: cloneTransform(source.transform),
    reverseDirection: !!source.reverseDirection,
    objectName: normalizeString(source.objectName, normalizeString(source.featureId, fallbackFeatureId)),
    sourceComponentFeatureId: normalizeString(source.sourceComponentFeatureId, ''),
    sourcePortFeatureId: normalizeString(source.sourcePortFeatureId, normalizeString(source.featureId, fallbackFeatureId)),
    componentInstanceName: normalizeString(source.componentInstanceName, ''),
  };
}

export function clonePortDefinition(definition) {
  return JSON.parse(JSON.stringify(normalizePortDefinition(definition)));
}

function pickOrthogonalUnit(direction) {
  const dir = direction.clone().normalize();
  const worldUp = Math.abs(dir.dot(new THREE.Vector3(0, 0, 1))) > 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  const yAxis = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
  if (yAxis.lengthSq() <= 1e-12) {
    return new THREE.Vector3(0, 1, 0);
  }
  return yAxis;
}

export function createRotationArrayFromDirection(directionArray) {
  const xAxis = new THREE.Vector3(...normalizeDirectionArray(directionArray, [1, 0, 0]));
  const yAxis = pickOrthogonalUnit(xAxis);
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const yFixed = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yFixed, zAxis);
  return new THREE.Matrix3().setFromMatrix4(matrix).elements.slice();
}

function resolveFaceCenter(refObj) {
  const origin = new THREE.Vector3();
  try {
    const geometry = refObj?.geometry || null;
    if (geometry) {
      const sphere = geometry.boundingSphere || (geometry.computeBoundingSphere(), geometry.boundingSphere);
      if (sphere) {
        origin.copy(refObj.localToWorld(sphere.center.clone()));
        return origin;
      }
    }
  } catch { }
  try { refObj?.getWorldPosition?.(origin); } catch { }
  return origin;
}

function resolveFaceDirection(refObj) {
  let normal = null;
  try {
    if (typeof refObj?.getAverageNormal === 'function') {
      normal = refObj.getAverageNormal()?.clone?.() || null;
    }
  } catch {
    normal = null;
  }
  if (!normal || normal.lengthSq() <= 1e-12) {
    const quat = new THREE.Quaternion();
    try { refObj?.getWorldQuaternion?.(quat); } catch { }
    normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  }
  if (!normal || normal.lengthSq() <= 1e-12) {
    return new THREE.Vector3(1, 0, 0);
  }
  return normal.normalize();
}

function resolveEdgePolyline(refObj) {
  try {
    if (typeof refObj?.points === 'function') {
      const pts = refObj.points(true) || [];
      const vectors = pts
        .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z))
        .map((pt) => new THREE.Vector3(pt.x, pt.y, pt.z));
      if (vectors.length >= 2) return vectors;
    }
  } catch { }
  return [];
}

function resolveEdgeAnchor(refObj) {
  const points = resolveEdgePolyline(refObj);
  if (points.length >= 2) {
    const segmentLengths = [];
    let totalLength = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const length = points[index].distanceTo(points[index + 1]);
      segmentLengths.push(length);
      totalLength += length;
    }
    if (totalLength > 1e-12) {
      const half = totalLength * 0.5;
      let walked = 0;
      for (let index = 0; index < segmentLengths.length; index += 1) {
        const length = segmentLengths[index];
        if (walked + length >= half) {
          const t = Math.min(1, Math.max(0, (half - walked) / Math.max(length, 1e-12)));
          const origin = points[index].clone().lerp(points[index + 1], t);
          const direction = points[index + 1].clone().sub(points[index]).normalize();
          return { origin, direction };
        }
        walked += length;
      }
      return {
        origin: points[points.length - 1].clone(),
        direction: points[points.length - 1].clone().sub(points[points.length - 2]).normalize(),
      };
    }
  }
  const origin = new THREE.Vector3();
  try { refObj?.getWorldPosition?.(origin); } catch { }
  return { origin, direction: new THREE.Vector3(1, 0, 0) };
}

function resolveObjectBasis(refObj, options = {}) {
  const fallbackDirection = new THREE.Vector3(...normalizeDirectionArray(options.fallbackDirection, [1, 0, 0]));
  if (!refObj || typeof refObj !== 'object') {
    const yAxis = pickOrthogonalUnit(fallbackDirection);
    const zAxis = new THREE.Vector3().crossVectors(fallbackDirection, yAxis).normalize();
    return {
      origin: new THREE.Vector3(),
      x: fallbackDirection.clone(),
      y: yAxis,
      z: zAxis,
    };
  }

  const type = String(refObj.type || '').toUpperCase();
  if (type === 'FACE') {
    const x = resolveFaceDirection(refObj);
    const y = pickOrthogonalUnit(x);
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    return {
      origin: resolveFaceCenter(refObj),
      x,
      y: new THREE.Vector3().crossVectors(z, x).normalize(),
      z,
    };
  }

  if (type === 'EDGE') {
    const edgeAnchor = resolveEdgeAnchor(refObj);
    const x = edgeAnchor.direction.lengthSq() > 1e-12 ? edgeAnchor.direction : fallbackDirection.clone();
    const y = pickOrthogonalUnit(x);
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    return {
      origin: edgeAnchor.origin,
      x,
      y: new THREE.Vector3().crossVectors(z, x).normalize(),
      z,
    };
  }

  if (type === 'VERTEX') {
    const origin = new THREE.Vector3();
    try { refObj.getWorldPosition(origin); } catch { }
    const x = fallbackDirection.clone();
    const y = pickOrthogonalUnit(x);
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    return {
      origin,
      x,
      y: new THREE.Vector3().crossVectors(z, x).normalize(),
      z,
    };
  }

  const origin = new THREE.Vector3();
  try { refObj.getWorldPosition(origin); } catch { }
  const quat = new THREE.Quaternion();
  try { refObj.getWorldQuaternion(quat); } catch { }
  let xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  let yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  let zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

  if (type === 'PLANE') {
    xAxis = zAxis.clone();
    yAxis = pickOrthogonalUnit(xAxis);
    zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  } else if (type === 'DATUM') {
    if (xAxis.lengthSq() <= 1e-12) xAxis = fallbackDirection.clone();
    yAxis = pickOrthogonalUnit(xAxis);
    zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  }

  if (xAxis.lengthSq() <= 1e-12) xAxis = fallbackDirection.clone();
  if (yAxis.lengthSq() <= 1e-12) yAxis = pickOrthogonalUnit(xAxis);
  if (zAxis.lengthSq() <= 1e-12) zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  return {
    origin,
    x: xAxis.normalize(),
    y: yAxis.normalize(),
    z: zAxis.normalize(),
  };
}

export function buildPortDefinitionFromInputs({ featureId, inputParams = {} } = {}) {
  const normalizedFeatureId = normalizeString(featureId, 'Port');
  const anchor = Array.isArray(inputParams.anchor) ? inputParams.anchor[0] || null : inputParams.anchor || null;
  const directionRef = Array.isArray(inputParams.directionRef) ? inputParams.directionRef[0] || null : inputParams.directionRef || null;
  const directionBasis = resolveObjectBasis(directionRef, {
    fallbackDirection: anchor ? resolveObjectBasis(anchor).x.toArray() : [1, 0, 0],
  });
  const anchorBasis = resolveObjectBasis(anchor, {
    fallbackDirection: directionBasis.x.toArray(),
  });
  const transform = cloneTransform(inputParams.transform);
  const anchorMatrix = new THREE.Matrix4().makeBasis(anchorBasis.x, anchorBasis.y, anchorBasis.z);
  anchorMatrix.setPosition(anchorBasis.origin);

  const rotationEuler = transform.rotationEuler;
  const localQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotationEuler[0]),
    THREE.MathUtils.degToRad(rotationEuler[1]),
    THREE.MathUtils.degToRad(rotationEuler[2]),
    'XYZ',
  ));
  const localMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    localQuat,
    new THREE.Vector3(1, 1, 1),
  );
  const worldMatrix = new THREE.Matrix4().multiplyMatrices(anchorMatrix, localMatrix);
  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  worldMatrix.decompose(worldPosition, worldQuaternion, worldScale);

  const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuaternion).normalize();
  const finalDirection = (inputParams.reverseDirection ? direction.multiplyScalar(-1) : direction).normalize();

  const definition = normalizePortDefinition({
    featureId: normalizedFeatureId,
    name: normalizeString(inputParams.portName, normalizedFeatureId),
    kind: inputParams.kind,
    point: [worldPosition.x, worldPosition.y, worldPosition.z],
    direction: [finalDirection.x, finalDirection.y, finalDirection.z],
    rotation: createRotationArrayFromDirection([finalDirection.x, finalDirection.y, finalDirection.z]),
    extension: Math.max(0, toFiniteNumber(inputParams.extension, DEFAULT_EXTENSION)),
    displayLength: Math.max(0.1, toFiniteNumber(inputParams.displayLength, DEFAULT_DISPLAY_LENGTH)),
    anchorName: normalizeString(anchor?.name, ''),
    directionRefName: normalizeString(directionRef?.name, ''),
    transform,
    reverseDirection: !!inputParams.reverseDirection,
    objectName: normalizedFeatureId,
  }, normalizedFeatureId);

  return definition;
}

function createPortLine(points, color, name) {
  const start = new THREE.Vector3(points[0], points[1], points[2]);
  const end = new THREE.Vector3(points[3], points[4], points[5]);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (!(length > 1e-9)) return null;

  const radius = 0.14;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 10, 1, false);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.05,
  });
  const edge = new THREE.Mesh(geometry, material);
  edge.type = 'EDGE';
  edge.name = name;
  edge.renderOrder = 2;
  edge.castShadow = false;
  edge.receiveShadow = false;

  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  edge.position.copy(midpoint);
  edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

  edge.userData = edge.userData || {};
  edge.userData.__defaultMaterial = material;
  edge.userData.polylineLocal = [
    [points[0], points[1], points[2]],
    [points[3], points[4], points[5]],
  ];
  edge.userData.polylineWorld = true;

  edge.points = (applyWorld = true) => {
    const source = edge.userData?.polylineLocal || [];
    return source.map((point) => {
      const vec = new THREE.Vector3(point[0], point[1], point[2]);
      if (applyWorld) vec.applyMatrix4(edge.matrixWorld);
      return { x: vec.x, y: vec.y, z: vec.z };
    });
  };

  SelectionState.setBaseMaterial(edge, material, { force: true });
  return edge;
}

function createPortVertex(position, name, color) {
  const vertex = new BREP.Vertex(position, { name });
  try {
    const material = vertex?._point?.material?.clone?.() || null;
    if (material) {
      material.color?.set?.(color);
      material.depthTest = true;
      SelectionState.setBaseMaterial(vertex, material, { force: true });
      vertex.userData = vertex.userData || {};
      vertex.userData.__defaultMaterial = material;
    }
  } catch { }
  try { vertex.renderOrder = 3; } catch { }
  try { if (vertex._point) vertex._point.renderOrder = 3; } catch { }
  return vertex;
}

function markPortObject(target, runtime, rootName) {
  if (!target || typeof target !== 'object') return;
  target.userData = target.userData || {};
  target.userData.isPortChild = true;
  target.userData.portObjectName = rootName;
  target.userData.portData = runtime;
}

export function createPortGroupFromDefinition(definition, options = {}) {
  const port = normalizePortDefinition(definition);
  const rootName = normalizeString(options.nameOverride, port.objectName || port.featureId || 'Port');
  const group = new THREE.Group();
  group.name = rootName;
  group.type = 'DATUM';
  group.userData = group.userData || {};
  group.userData.isPortRoot = true;
  group.userData.portData = {
    ...clonePortDefinition(port),
    objectName: rootName,
    linkName: port.componentInstanceName
      ? `${port.componentInstanceName}-${port.name}`
      : port.name,
  };

  const runtime = group.userData.portData;
  const point = runtime.point;
  const direction = new THREE.Vector3(...runtime.direction).normalize();
  const displayLength = Math.max(runtime.displayLength, runtime.extension, 0.1);
  const color = runtime.kind === 'waypoint' ? PORT_WAYPOINT_COLOR : PORT_COLOR;

  const baseVertex = createPortVertex(point, `${rootName}:Base`, color);
  markPortObject(baseVertex, runtime, rootName);
  if (baseVertex._point) {
    markPortObject(baseVertex._point, runtime, rootName);
  }
  group.add(baseVertex);

  if (runtime.kind === 'waypoint') {
    const aEnd = new THREE.Vector3(...point).addScaledVector(direction, displayLength * 0.5);
    const bEnd = new THREE.Vector3(...point).addScaledVector(direction, -displayLength * 0.5);
    const line = createPortLine([
      bEnd.x, bEnd.y, bEnd.z,
      aEnd.x, aEnd.y, aEnd.z,
    ], color, `${rootName}:Path`);
    markPortObject(line, runtime, rootName);
    line.userData.portSideA = [direction.x, direction.y, direction.z];
    line.userData.portSideB = [-direction.x, -direction.y, -direction.z];
    group.add(line);
  } else {
    const end = new THREE.Vector3(...point).addScaledVector(direction, displayLength);
    const line = createPortLine([
      point[0], point[1], point[2],
      end.x, end.y, end.z,
    ], color, `${rootName}:Path`);
    markPortObject(line, runtime, rootName);
    group.add(line);
  }

  try { SelectionFilter.ensureSelectionHandlers(group, { deep: true }); } catch { }
  return group;
}

export function findPortOwner(object) {
  let current = object || null;
  while (current) {
    if (current?.userData?.isPortRoot) return current;
    current = current.parent || null;
  }
  return null;
}

export function extractPortRuntimeData(object) {
  const owner = findPortOwner(object);
  const source = owner?.userData?.portData;
  if (!source) return null;

  const runtime = {
    ...source,
    point: sanitizeVec3(source.point, [0, 0, 0]),
    direction: normalizeDirectionArray(source.direction, [1, 0, 0]),
  };

  try {
    owner.updateWorldMatrix(true, false);
    const worldPoint = owner.localToWorld(new THREE.Vector3(...runtime.point));
    const worldDirection = new THREE.Vector3(...runtime.direction);
    const worldQuaternion = new THREE.Quaternion();
    owner.getWorldQuaternion(worldQuaternion);
    worldDirection.applyQuaternion(worldQuaternion).normalize();
    runtime.point = [worldPoint.x, worldPoint.y, worldPoint.z];
    runtime.direction = [worldDirection.x, worldDirection.y, worldDirection.z];
    runtime.rotation = createRotationArrayFromDirection(runtime.direction);
  } catch { /* ignore transform resolution failures */ }

  return runtime;
}

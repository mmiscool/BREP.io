import * as THREE from 'three';
import { BREP } from '../../BREP/BREP.js';
import { SelectionFilter } from '../../UI/SelectionFilter.js';
import { SelectionState } from '../../UI/SelectionState.js';
import {
  composeReferencedTransformMatrix,
  resolveTransformReferenceBase,
  resolveTransformReferenceName,
  resolveTransformReferenceObject,
  sanitizeTransformValue,
} from '../../utils/transformReferenceUtils.js';

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
  return sanitizeTransformValue(value);
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

function firstReferenceValue(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function basisDirectionFromBase(base) {
  const quaternion = Array.isArray(base?.quaternion) && base.quaternion.length >= 4
    ? new THREE.Quaternion(
      toFiniteNumber(base.quaternion[0], 0),
      toFiniteNumber(base.quaternion[1], 0),
      toFiniteNumber(base.quaternion[2], 0),
      toFiniteNumber(base.quaternion[3], 1),
    )
    : new THREE.Quaternion();
  const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  return direction.lengthSq() > 1e-12 ? direction.normalize() : new THREE.Vector3(1, 0, 0);
}

export function buildPortDefinitionFromInputs({ featureId, inputParams = {}, referenceSource = null } = {}) {
  const normalizedFeatureId = normalizeString(featureId, 'Port');
  const legacyAnchor = firstReferenceValue(inputParams.anchor);
  const directionRef = firstReferenceValue(inputParams.directionRef);
  const transform = cloneTransform(inputParams.transform);
  const reference = transform.reference || legacyAnchor || null;
  const directionBase = resolveTransformReferenceBase(directionRef, referenceSource, { fallbackDirection: [1, 0, 0] }, THREE);
  const directionBasis = basisDirectionFromBase(directionBase);
  const transformForCompose = reference && !transform.reference
    ? { ...transform, reference }
    : transform;
  const worldMatrix = composeReferencedTransformMatrix(
    transformForCompose,
    referenceSource,
    { fallbackDirection: directionBasis.toArray() },
    THREE,
  );
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
    anchorName: normalizeString(
      resolveTransformReferenceObject(reference, referenceSource)?.name || resolveTransformReferenceName(reference),
      '',
    ),
    directionRefName: normalizeString(
      resolveTransformReferenceObject(directionRef, referenceSource)?.name || resolveTransformReferenceName(directionRef),
      '',
    ),
    transform: transformForCompose,
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

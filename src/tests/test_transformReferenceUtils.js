import * as THREE from 'three';
import { buildPortDefinitionFromInputs } from '../features/port/portUtils.js';
import {
  composeReferencedTransformMatrix,
  resolveTransformReferenceBase,
  sanitizeTransformValue,
} from '../utils/transformReferenceUtils.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function approxEqual(a, b, tolerance = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function assertVec3(vector, expected, message) {
  const values = [vector.x, vector.y, vector.z];
  for (let index = 0; index < 3; index += 1) {
    if (!approxEqual(values[index], expected[index])) {
      throw new Error(message || `Expected vector ${expected.join(', ')}, got ${values.join(', ')}.`);
    }
  }
}

export function test_transform_reference_sanitize_preserves_metadata() {
  const sanitized = sanitizeTransformValue({
    position: [1, 2, 3],
    rotationEuler: [4, 5, 6],
    scale: [1, 1, 1],
    reference: {
      name: 'FACE_REF',
      type: 'FACE',
      pickPoint: [7, 8, 9],
      faceIndex: 3,
    },
  });

  assert(sanitized.reference && typeof sanitized.reference === 'object', 'Expected transform reference metadata to be preserved.');
  assert(sanitized.reference.name === 'FACE_REF', 'Expected transform reference name to persist.');
  assert(sanitized.reference.type === 'FACE', 'Expected transform reference type to persist.');
  assert(Array.isArray(sanitized.reference.pickPoint), 'Expected pick point metadata to persist.');
  assert(sanitized.reference.faceIndex === 3, 'Expected face index metadata to persist.');
}

export const test_transform_reference_sanitizer_preserves_reference_metadata = test_transform_reference_sanitize_preserves_metadata;

export function test_transform_reference_base_uses_face_pick_point() {
  const scene = new THREE.Scene();
  const face = new THREE.Object3D();
  face.name = 'FACE_PICK';
  face.type = 'FACE';
  scene.add(face);

  const base = resolveTransformReferenceBase({
    name: 'FACE_PICK',
    type: 'FACE',
    pickPoint: [3, 4, 5],
  }, scene, {}, THREE);

  const position = new THREE.Vector3(
    Number(base.position[0]) || 0,
    Number(base.position[1]) || 0,
    Number(base.position[2]) || 0,
  );
  assertVec3(position, [3, 4, 5], 'Expected face reference base to use the stored pick point.');
}

export function test_referenced_transform_matrix_uses_vertex_reference_origin() {
  const scene = new THREE.Scene();
  const vertex = new THREE.Object3D();
  vertex.name = 'VERTEX_REF';
  vertex.type = 'VERTEX';
  vertex.position.set(10, 20, 30);
  scene.add(vertex);

  const matrix = composeReferencedTransformMatrix({
    position: [1, 2, 3],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
    reference: {
      name: 'VERTEX_REF',
      type: 'VERTEX',
    },
  }, scene, {}, THREE);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  assertVec3(position, [11, 22, 33], 'Expected referenced transform to offset from the selected vertex.');
}

export const test_transform_reference_matrix_uses_vertex_origin = test_referenced_transform_matrix_uses_vertex_reference_origin;

export function test_port_definition_uses_transform_reference_without_anchor() {
  const scene = new THREE.Scene();
  const vertex = new THREE.Object3D();
  vertex.name = 'PORT_VERTEX';
  vertex.type = 'VERTEX';
  vertex.position.set(5, 0, 0);
  scene.add(vertex);

  const definition = buildPortDefinitionFromInputs({
    featureId: 'PORT_REF_TEST',
    inputParams: {
      portName: 'Port Ref Test',
      transform: {
        position: [2, 0, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        reference: {
          name: 'PORT_VERTEX',
          type: 'VERTEX',
        },
      },
      extension: 2,
      displayLength: 4,
    },
    referenceSource: scene,
  });

  assert(Array.isArray(definition.point), 'Expected port definition point to resolve.');
  assert(approxEqual(definition.point[0], 7), 'Expected port point to be offset from the transform reference.');
  assert(approxEqual(definition.point[1], 0) && approxEqual(definition.point[2], 0), 'Expected port point to remain aligned to the reference origin.');
  assert(definition.anchorName === 'PORT_VERTEX', 'Expected anchorName compatibility field to reflect the transform reference.');
  assert(definition.transform?.reference, 'Expected normalized port transform to retain its reference.');
}

export function test_port_definition_uses_transform_reference_and_direction_reference() {
  const scene = new THREE.Scene();

  const vertex = new THREE.Object3D();
  vertex.name = 'PORT_VERTEX_DIR';
  vertex.type = 'VERTEX';
  vertex.position.set(1, 2, 3);
  scene.add(vertex);

  const datum = new THREE.Object3D();
  datum.name = 'PORT_DATUM_DIR';
  datum.type = 'DATUM';
  datum.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  scene.add(datum);
  scene.updateMatrixWorld(true);

  const definition = buildPortDefinitionFromInputs({
    featureId: 'PORT_DIR_TEST',
    inputParams: {
      transform: {
        position: [2, 0, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
        reference: {
          name: 'PORT_VERTEX_DIR',
          type: 'VERTEX',
        },
      },
      directionRef: [{
        name: 'PORT_DATUM_DIR',
        type: 'DATUM',
      }],
    },
    referenceSource: scene,
  });

  assertVec3(new THREE.Vector3(...definition.point), [1, 4, 3], 'Expected point reference to inherit the direction reference basis.');
  assertVec3(new THREE.Vector3(...definition.direction), [0, 1, 0], 'Expected port direction to align with the direction reference.');
}

import { BREP } from '../BREP/BREP.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function faceAxisMin(solid, faceName, axisIndex = 0) {
  const triangles = typeof solid?.getFace === 'function' ? solid.getFace(faceName) : [];
  let min = Number.POSITIVE_INFINITY;
  for (const tri of triangles) {
    for (const point of [tri?.p1, tri?.p2, tri?.p3]) {
      if (!Array.isArray(point) || point.length < 3) continue;
      min = Math.min(min, Number(point[axisIndex]));
    }
  }
  return min;
}

function faceAxisMax(solid, faceName, axisIndex = 0) {
  const triangles = typeof solid?.getFace === 'function' ? solid.getFace(faceName) : [];
  let max = Number.NEGATIVE_INFINITY;
  for (const tri of triangles) {
    for (const point of [tri?.p1, tri?.p2, tri?.p3]) {
      if (!Array.isArray(point) || point.length < 3) continue;
      max = Math.max(max, Number(point[axisIndex]));
    }
  }
  return max;
}

function makeTouchingCubePair(baseName, toolName) {
  const base = new BREP.Cube({ x: 1, y: 1, z: 1, name: baseName });
  const tool = new BREP.Cube({ x: 1, y: 1, z: 1, name: toolName });
  tool.bakeTRS({
    position: [1, 0, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  });
  return { base, tool };
}

function makeFakePartHistory() {
  return {
    scene: {
      getObjectByName() {
        return null;
      },
    },
  };
}

async function captureUnionConditionedFaces(booleanParam) {
  const { base, tool } = makeTouchingCubePair('BASE', 'TOOL');
  const proto = Object.getPrototypeOf(base);
  const originalUnion = proto.union;
  let observedBasePXMax = null;
  let observedToolNXMin = null;

  proto.union = function patchedUnion(other) {
    if (observedBasePXMax === null) {
      observedBasePXMax = faceAxisMax(this, 'BASE_PX', 0);
      observedToolNXMin = faceAxisMin(other, 'TOOL_NX', 0);
    }
    return originalUnion.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), base, {
      operation: 'UNION',
      targets: [tool],
      ...booleanParam,
    }, 'BOOL_OVERLAP_UNION');
  } finally {
    proto.union = originalUnion;
  }

  return { observedBasePXMax, observedToolNXMin };
}

async function captureSubtractOperandMinX(booleanParam) {
  const { base: target, tool: cutter } = makeTouchingCubePair('TARGET', 'CUTTER');
  const proto = Object.getPrototypeOf(target);
  const originalSubtract = proto.subtract;
  let observedMinX = null;

  proto.subtract = function patchedSubtract(other) {
    if (observedMinX === null) {
      observedMinX = faceAxisMin(other, 'CUTTER_NX', 0);
    }
    return originalSubtract.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), cutter, {
      operation: 'SUBTRACT',
      targets: [target],
      ...booleanParam,
    }, 'BOOL_OVERLAP_SUBTRACT');
  } finally {
    proto.subtract = originalSubtract;
  }

  return observedMinX;
}

async function captureSubtractOperandMinZForEntryCap(booleanParam) {
  const target = new BREP.Cube({ x: 1, y: 1, z: 1, name: 'TARGET_Z' });
  const cutter = new BREP.Cube({ x: 1, y: 1, z: 2, name: 'CUTTER_Z' });
  const proto = Object.getPrototypeOf(target);
  const originalSubtract = proto.subtract;
  let observedMinZ = null;
  let observedMaxZ = null;

  proto.subtract = function patchedSubtract(other) {
    if (observedMinZ === null) {
      observedMinZ = faceAxisMin(other, 'CUTTER_Z_NZ', 2);
      observedMaxZ = faceAxisMax(other, 'CUTTER_Z_NZ', 2);
    }
    return originalSubtract.call(this, other);
  };

  try {
    await BREP.applyBooleanOperation(makeFakePartHistory(), cutter, {
      operation: 'SUBTRACT',
      targets: [target],
      ...booleanParam,
    }, 'BOOL_OVERLAP_SUBTRACT_CAP');
  } finally {
    proto.subtract = originalSubtract;
  }

  return { observedMinZ, observedMaxZ };
}

export async function test_boolean_overlap_conditioning_union_enabled_by_default() {
  const { observedBasePXMax } = await captureUnionConditionedFaces({});
  assert(Number.isFinite(observedBasePXMax), 'Expected union test to observe the conditioned base face.');
  assert(observedBasePXMax > 1 + 1e-7, `Expected default union edge-point conditioning to push BASE_PX into the target solid, got maxX=${observedBasePXMax}`);
}

export async function test_boolean_overlap_conditioning_union_can_be_disabled() {
  const { observedBasePXMax, observedToolNXMin } = await captureUnionConditionedFaces({ overlapConditioningEnabled: false });
  assert(Number.isFinite(observedBasePXMax) && Number.isFinite(observedToolNXMin), 'Expected disabled union test to observe the faces.');
  assert(Math.abs(observedBasePXMax - 1) <= 1e-12, `Expected disabled union conditioning to leave BASE_PX at x=1, got maxX=${observedBasePXMax}`);
  assert(Math.abs(observedToolNXMin - 1) <= 1e-12, `Expected disabled union conditioning to leave TOOL_NX at x=1, got minX=${observedToolNXMin}`);
}

export async function test_boolean_overlap_conditioning_subtract_enabled_by_default() {
  const observedMinX = await captureSubtractOperandMinX({});
  assert(Number.isFinite(observedMinX), 'Expected subtract test to observe the conditioned cutter face.');
  assert(observedMinX > 1 + 1e-7, `Expected default subtract edge-point conditioning to push CUTTER_NX outside the target solid, got minX=${observedMinX}`);
}

export async function test_boolean_overlap_conditioning_subtract_expands_tool_entry_cap_outward() {
  const { observedMinZ, observedMaxZ } = await captureSubtractOperandMinZForEntryCap({});
  assert(Number.isFinite(observedMinZ) && Number.isFinite(observedMaxZ), 'Expected subtract cap test to observe the conditioned cutter cap face.');
  assert(observedMinZ < 0 - 1e-7, `Expected subtract conditioning to expand CUTTER_Z_NZ outward beyond z=0, got minZ=${observedMinZ}`);
  assert(Math.abs(observedMaxZ - observedMinZ) <= 1e-12, `Expected CUTTER_Z_NZ to remain planar after conditioning, got minZ=${observedMinZ}, maxZ=${observedMaxZ}`);
}

export async function test_boolean_overlap_conditioning_subtract_can_be_disabled() {
  const observedMinX = await captureSubtractOperandMinX({ overlapConditioningEnabled: false });
  assert(Number.isFinite(observedMinX), 'Expected disabled subtract test to observe the cutter face.');
  assert(Math.abs(observedMinX - 1) <= 1e-12, `Expected disabled subtract conditioning to leave CUTTER_NX at x=1, got minX=${observedMinX}`);
}

export async function test_boolean_overlap_conditioning_direct_api_enabled_by_default() {
  const { base, tool } = makeTouchingCubePair('BASE_API', 'TOOL_API');
  const result = base.union(tool);
  assert(result, 'Expected direct union to return a result solid.');
  assert(faceAxisMax(base, 'BASE_API_PX', 0) === 1, 'Direct union should not mutate the source solid.');

  const target = new BREP.Cube({ x: 1, y: 1, z: 1, name: 'TARGET_API' });
  const cutter = new BREP.Cube({ x: 1, y: 1, z: 1, name: 'CUTTER_API' });
  cutter.bakeTRS({
    position: [1, 0, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  });
  const subtractResult = target.subtract(cutter);
  assert(subtractResult, 'Expected direct subtract to return a result solid.');
  assert(faceAxisMin(cutter, 'CUTTER_API_NX', 0) === 1, 'Direct subtract should not mutate the cutter solid.');
}

export async function test_boolean_overlap_conditioning_direct_api_can_be_disabled() {
  const { base, tool } = makeTouchingCubePair('BASE_API_OFF', 'TOOL_API_OFF');
  const proto = Object.getPrototypeOf(base);
  const originalUnion = proto.union;
  let observedBasePXMax = null;
  proto.union = function patchedUnion(other, options) {
    observedBasePXMax = faceAxisMax(this, 'BASE_API_OFF_PX', 0);
    return originalUnion.call(this, other, options);
  };
  try {
    base.union(tool, { overlapConditioningEnabled: false });
  } finally {
    proto.union = originalUnion;
  }
  assert(Math.abs(observedBasePXMax - 1) <= 1e-12, `Expected disabled direct union conditioning to leave BASE_API_OFF_PX at x=1, got ${observedBasePXMax}`);
}

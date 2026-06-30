import { BREP } from "../BREP/BREP.js";
import { PatternFeature } from "../features/pattern/PatternFeature.js";

const THREE = BREP.THREE;

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

function approxEqual(a, b, tolerance = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function makeFakeSolid() {
  return {
    type: "SOLID",
    name: "PATTERN_SOURCE",
    clone() {
      return {
        type: "SOLID",
        _triIDs: [],
        _idToFaceName: new Map(),
        bakeTransform(matrix) {
          const p = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix);
          this.rotationDeg = THREE.MathUtils.radToDeg(Math.atan2(-p.z, p.x));
        },
        visualize() {},
      };
    },
  };
}

function makeYAxisEdge() {
  return {
    type: "EDGE",
    matrixWorld: new THREE.Matrix4(),
    userData: {
      polylineLocal: [
        [0, 0, 0],
        [0, 1, 0],
      ],
    },
  };
}

export async function test_pattern_circular_count_pitch_uses_angle_as_step() {
  const feature = new PatternFeature();
  feature.inputParams = {
    featureID: "PATTERN_TEST",
    solids: [makeFakeSolid()],
    mode: "CIRCULAR",
    count: 3,
    countMode: "count and pitch",
    axisRef: makeYAxisEdge(),
    centerOffset: 0,
    totalAngleDeg: 90,
    booleanMode: "NONE",
  };

  const result = await feature.run(null);
  const added = Array.isArray(result?.added) ? result.added : [];

  assert(added.length === 2, "Expected count=3 to create two circular pattern clones.");
  assert(approxEqual(added[0]?.rotationDeg, 90), `Expected first clone at 90 degrees, received ${added[0]?.rotationDeg}.`);
  assert(approxEqual(Math.abs(added[1]?.rotationDeg), 180), `Expected second clone at 180 degrees, received ${added[1]?.rotationDeg}.`);
}

import { manifoldBuildSource } from "../BREP/setupManifold.js";

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function isSyntheticFaceName(name) {
  return /^FACE(?:_\d+)?$/.test(String(name || "")) || /_REPAIR_\d+$/.test(String(name || ""));
}

export async function test_primitive_boolean_union_preserves_face_grouping(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const cube = await partHistory.newFeature("P.CU");
  Object.assign(cube.inputParams, {
    id: "P.CU1",
    sizeX: 14,
    sizeY: 10,
    sizeZ: 8,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: [],
      operation: "NONE",
    },
  });

  const cylinder = await partHistory.newFeature("P.CY");
  Object.assign(cylinder.inputParams, {
    id: "P.CY2",
    radius: 3,
    height: 12,
    resolution: 64,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["P.CU1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });
}

export async function afterRun_primitive_boolean_union_preserves_face_grouping(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const solid = getSolidByName(partHistory, "P.CU1");
  if (!solid) {
    throw new Error("[primitive_boolean_union_preserves_face_grouping] Expected final solid P.CU1 to exist.");
  }

  const faceNames = (solid.getFaceNames?.() || []).map((name) => String(name || ""));
  const synthetic = faceNames.filter(isSyntheticFaceName);
  if (synthetic.length > 0) {
    throw new Error(`[primitive_boolean_union_preserves_face_grouping] Expected native primitive union to avoid fallback face labels, found ${synthetic.join(", ")}.`);
  }

  const expected = [
    "P.CU1_NX",
    "P.CU1_NY",
    "P.CU1_NZ",
    "P.CU1_PX",
    "P.CU1_PY",
    "P.CU1_PZ",
    "P.CY2_B",
    "P.CY2_T",
    "P.CY2_S",
  ];
  for (const faceName of expected) {
    if (!faceNames.includes(faceName)) {
      throw new Error(`[primitive_boolean_union_preserves_face_grouping] Missing expected face ${faceName}. Faces: ${faceNames.join(", ")}`);
    }
  }
}

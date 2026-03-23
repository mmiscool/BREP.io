import { manifoldBuildSource } from "../BREP/setupManifold.js";

const GENERATED_SKETCH = {
  points: [
    { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
    { id: 1, x: 8.169619, y: 7.413411, fixed: false, construction: false, externalReference: false },
    { id: 2, x: -9.973789, y: -7.834762, fixed: false, construction: false, externalReference: false },
    { id: 3, x: 8.169619, y: 7.413411, fixed: false, construction: false, externalReference: false },
    { id: 4, x: -9.445161, y: 8.001406, fixed: false, construction: false, externalReference: false },
    { id: 5, x: -9.445161, y: 8.001406, fixed: false, construction: false, externalReference: false },
    { id: 6, x: -9.973789, y: -7.834762, fixed: false, construction: false, externalReference: false },
    { id: 7, x: 7.640988, y: -8.422764, fixed: false, construction: false, externalReference: false },
    { id: 8, x: 7.640988, y: -8.422764, fixed: false, construction: false, externalReference: false },
    { id: 9, x: 10.931753, y: 7.321209, fixed: false, construction: false, externalReference: false },
    { id: 10, x: 12.857816, y: 7.805148, fixed: false, construction: false, externalReference: false },
    { id: 11, x: 14.257523, y: 2.315756, fixed: false, construction: false, externalReference: false },
    { id: 12, x: 15.389563, y: -2.123894, fixed: false, construction: false, externalReference: false },
    { id: 13, x: 19.41103, y: -0.405785, fixed: false, construction: false, externalReference: false },
    { id: 14, x: 18.53984, y: -4.577753, fixed: false, construction: false, externalReference: false },
    { id: 15, x: 17.348496, y: -10.282882, fixed: false, construction: false, externalReference: false },
    { id: 16, x: 13.605762, y: -8.621875, fixed: false, construction: false, externalReference: false },
  ],
  geometries: [
    { id: 1, type: "line", points: [1, 4], construction: false },
    { id: 2, type: "line", points: [5, 2], construction: false },
    { id: 3, type: "line", points: [6, 7], construction: false },
    { id: 4, type: "line", points: [8, 3], construction: true },
    { id: 5, type: "bezier", points: [1, 9, 10, 11], construction: false },
    { id: 6, type: "line", points: [1, 9], construction: true },
    { id: 7, type: "line", points: [11, 10], construction: true },
    { id: 8, type: "bezier", points: [11, 12, 13, 14], construction: false },
    { id: 9, type: "line", points: [11, 12], construction: true },
    { id: 10, type: "line", points: [14, 13], construction: true },
    { id: 11, type: "bezier", points: [14, 15, 16, 7], construction: false },
    { id: 12, type: "line", points: [14, 15], construction: true },
    { id: 13, type: "line", points: [7, 16], construction: true },
  ],
  constraints: [],
};

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function isSyntheticFaceName(name) {
  return /^FACE(?:_\d+)?$/.test(String(name || "")) || /_REPAIR_\d+$/.test(String(name || ""));
}

export async function test_generated_history_20260322222832(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const feature1 = await partHistory.newFeature("P.CY");
  Object.assign(feature1.inputParams, {
    id: "P.CY1",
    radius: "4",
    height: 10,
    resolution: 64,
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

  const feature2 = await partHistory.newFeature("S");
  Object.assign(feature2.inputParams, {
    id: "S5",
    sketchPlane: "P.CY1_T",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 32,
  });
  feature2.persistentData = { sketch: GENERATED_SKETCH };

  const feature3 = await partHistory.newFeature("E");
  Object.assign(feature3.inputParams, {
    id: "E6",
    profile: "S5:PROFILE",
    consumeProfileSketch: true,
    distance: "5",
    distanceBack: "4",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });
}

export async function afterRun_generated_history_20260322222832(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const solid = getSolidByName(partHistory, "P.CY1");
  if (!solid) {
    throw new Error("[generated_history_20260322222832] Expected final solid P.CY1 to exist.");
  }

  const faceNames = (solid.getFaceNames?.() || []).map((name) => String(name || ""));
  const synthetic = faceNames.filter(isSyntheticFaceName);
  if (synthetic.length > 0) {
    throw new Error(`[generated_history_20260322222832] Expected boolean reconstruction to avoid repair face labels, found ${synthetic.join(", ")}.`);
  }

  const expected = [
    "P.CY1_S",
    "P.CY1_B",
    "E6:S5:G1_SW",
    "E6:S5:G2_SW",
    "E6:S5:G5_SW",
    "E6:S5:G3_SW",
    "E6:S5:PROFILE_END",
    "E6:S5:G8_SW",
    "E6:S5:G11_SW",
    "E6:S5:PROFILE_START",
  ];
  for (const faceName of expected) {
    if (!faceNames.includes(faceName)) {
      throw new Error(`[generated_history_20260322222832] Missing expected face ${faceName}. Faces: ${faceNames.join(", ")}`);
    }
  }
}

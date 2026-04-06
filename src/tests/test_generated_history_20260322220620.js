import { manifold, manifoldBuildSource } from "../BREP/setupManifold.js";

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

function summarizeSolid(solid) {
  if (!solid || typeof solid.getFaceNames !== "function") return null;
  const faceNames = (solid.getFaceNames() || []).map((name) => String(name || ""));
  return {
    name: solid.name || null,
    faceCount: faceNames.length,
    faces: faceNames,
  };
}

function isSyntheticFaceName(name) {
  return /^FACE(?:_\d+)?$/.test(String(name || "")) || /_REPAIR_\d+$/.test(String(name || ""));
}

export async function test_generated_history_20260322220620(partHistory) {
  if (manifoldBuildSource !== "local") return;

  if (typeof manifold?.buildSolidAuthoringStateFromMesh === "function") {
    const original = manifold.buildSolidAuthoringStateFromMesh;
    const state = {
      original,
      e16RestoreCalls: 0,
    };
    partHistory.__generatedHistory20260322220620FaceRestoreState = state;
    manifold.buildSolidAuthoringStateFromMesh = function (...args) {
      if (partHistory?.runningFeatureId === "E16") {
        state.e16RestoreCalls += 1;
      }
      return original.apply(this, args);
    };
  }

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
    distance: "5",
    distanceBack: "4",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
    consumeProfileSketch: true,
  });

  const feature4 = await partHistory.newFeature("R");
  Object.assign(feature4.inputParams, {
    id: "R9",
    profile: "E6:S5:PROFILE_END",
    axis: "E6:S5:G2_SW|E6:S5:PROFILE_END[0]",
    angle: 34,
    resolution: "256",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: false,
    },
  });

  const feature5 = await partHistory.newFeature("F");
  Object.assign(feature5.inputParams, {
    id: "F14",
    edges: [
      "E6:S5:G2_SW|E6:S5:PROFILE_END_END[0]",
      "E6:S5:G2_SW",
      "E6:S5:PROFILE_END_END",
      "P.CY1_B",
      "E6:S5:PROFILE_START",
    ],
    radius: "1",
    resolution: 32,
    inflate: 0.1,
    nudgeFaceDistance: 0.0001,
    direction: "AUTO",
    debug: "NONE",
    showTangentOverlays: false,
  });

  const feature6 = await partHistory.newFeature("E");
  Object.assign(feature6.inputParams, {
    id: "E16",
    profile: "P.CY1_B",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 98.4,
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  const feature7 = await partHistory.newFeature("CH");
  Object.assign(feature7.inputParams, {
    id: "CH18",
    edges: [
      "E16:P.CY1_B_START|E16:P.CY1_B_SW[0]",
    ],
    distance: 1,
    inflate: 0.1,
    direction: "INSET",
    debug: false,
  });
}

export async function afterRun_generated_history_20260322220620(partHistory) {
  if (manifoldBuildSource !== "local") return;
  const faceRestoreState = partHistory.__generatedHistory20260322220620FaceRestoreState || null;
  if (faceRestoreState?.original) {
    manifold.buildSolidAuthoringStateFromMesh = faceRestoreState.original;
  }
  const solid = getSolidByName(partHistory, "P.CY1");
  const summary = summarizeSolid(solid);
  if (!solid || !summary) {
    throw new Error("[generated_history_20260322220620] Expected final solid P.CY1 to exist.");
  }

  if ((faceRestoreState?.e16RestoreCalls || 0) !== 0) {
    throw new Error(`[generated_history_20260322220620] Expected E16 union to skip fallback face tracking restore, observed ${faceRestoreState.e16RestoreCalls} mesh rebuild(s).`);
  }

  if (summary.faces.includes("P.CY1_B")) {
    throw new Error("[generated_history_20260322220620] Expected the consumed P.CY1_B profile face to be replaced by the E16 side wall in the final reconstruction.");
  }
  if (!summary.faces.includes("P.CY1_S")) {
    throw new Error("[generated_history_20260322220620] Expected P.CY1_S face to survive final reconstruction.");
  }
  if (!summary.faces.includes("E6:S5:G11_SW")) {
    throw new Error("[generated_history_20260322220620] Expected E6:S5:G11_SW to survive the F14/E16 boolean chain.");
  }
  if (!summary.faces.includes("E16:P.CY1_B_SW")) {
    throw new Error("[generated_history_20260322220620] Expected grouped E16:P.CY1_B_SW face after extruding P.CY1_B.");
  }
  if (!summary.faces.includes("CHAMFER_E16:P.CY1_B_START|E16:P.CY1_B_SW_BEVEL")) {
    throw new Error("[generated_history_20260322220620] Expected chamfer bevel face to be created on the E16 grouped side wall edge.");
  }
  const synthetic = summary.faces.filter(isSyntheticFaceName);
  if (synthetic.length > 0) {
    throw new Error(`[generated_history_20260322220620] Expected boolean reconstruction to avoid synthetic face labels, found ${synthetic.join(", ")}.`);
  }

}

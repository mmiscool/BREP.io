import { PartHistory } from "../PartHistory.js";

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  const counts = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const a = triVerts[(triIndex * 3) + 0] >>> 0;
    const b = triVerts[(triIndex * 3) + 1] >>> 0;
    const c = triVerts[(triIndex * 3) + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const value of counts.values()) {
    if (value === 1) boundaryEdgeCount += 1;
    else if (value !== 2) nonManifoldEdgeCount += 1;
  }
  return { boundaryEdgeCount, nonManifoldEdgeCount, triangleCount: triCount };
}

function assertClosedManifold(solid, label) {
  if (!solid) throw new Error(`[${label}] Expected offset shell result solid.`);
  const topology = analyzeMeshTopology(solid);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[${label}] Expected closed manifold shell. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}, triangles=${topology.triangleCount}.`,
    );
  }
  if (typeof solid._isCoherentlyOrientedManifold === "function" && solid._isCoherentlyOrientedManifold() !== true) {
    throw new Error(`[${label}] Expected coherent manifold orientation.`);
  }
}

export async function buildGeneratedHistory20260607180752(partHistory, offsetDistance = "-0.5", offsetShellOverrides = {}) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 16;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("S");
  Object.assign(feature1.inputParams, {
    id: "S1",
    sketchPlane: null,
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  feature1.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -7.158141, y: -7.907776, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 8.426984, y: 5.71041, fixed: false, construction: false, externalReference: false },
        { id: 3, x: -7.158141, y: -7.907776, fixed: false, construction: false, externalReference: false },
        { id: 4, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
        { id: 5, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
        { id: 6, x: 8.426984, y: 5.71041, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -6.291516, y: 6.590214, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -6.291516, y: 6.590214, fixed: false, construction: false, externalReference: false },
        { id: 9, x: -1.237185, y: 0.019114, fixed: false, construction: false, externalReference: false },
        { id: 10, x: -2.794092, y: -2.205038, fixed: false, construction: false, externalReference: false },
        { id: 11, x: 7.560362, y: -8.787576, fixed: false, construction: false, externalReference: false },
        { id: 12, x: 7.484115, y: -11.495576, fixed: false, construction: false, externalReference: false },
        { id: 13, x: -7.437728, y: -13.144076, fixed: false, construction: false, externalReference: false },
        { id: 14, x: -2.88781, y: -12.825321, fixed: false, construction: false, externalReference: false },
        { id: 15, x: -4.301049, y: -12.388265, fixed: false, construction: false, externalReference: false },
        { id: 16, x: -5.585603, y: -11.991006, fixed: false, construction: false, externalReference: false },
        { id: 17, x: 2.463262, y: -12.023261, fixed: false, construction: false, externalReference: false },
        { id: 18, x: 0.123113, y: -13.639996, fixed: false, construction: false, externalReference: false },
        { id: 19, x: -1.794938, y: -14.965129, fixed: false, construction: false, externalReference: false },
        { id: 20, x: 5.529604, y: -10.376861, fixed: false, construction: false, externalReference: false },
        { id: 21, x: 3.628537, y: -11.397603, fixed: false, construction: false, externalReference: false },
        { id: 22, x: 2.463262, y: -12.023261, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: "line", points: [1, 4], construction: true },
        { id: 2, type: "line", points: [5, 2], construction: false },
        { id: 3, type: "line", points: [6, 7], construction: false },
        { id: 4, type: "line", points: [8, 3], construction: false },
        { id: 5, type: "circle", points: [9, 10], construction: false },
        { id: 6, type: "bezier", points: [11, 12, 20, 21, 22, 17, 18, 19, 14, 15, 16, 13, 1], construction: false },
        { id: 7, type: "line", points: [11, 12], construction: true },
        { id: 8, type: "line", points: [1, 13], construction: true },
        { id: 9, type: "line", points: [15, 14], construction: true },
        { id: 10, type: "line", points: [15, 16], construction: true },
        { id: 11, type: "line", points: [18, 17], construction: true },
        { id: 12, type: "line", points: [18, 19], construction: true },
        { id: 13, type: "line", points: [21, 20], construction: true },
        { id: 14, type: "line", points: [21, 22], construction: true },
      ],
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
        { id: 1, type: "≡", points: [1, 3], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "1:-7.158141,-7.907776,0;3:-7.158141,-7.907776,0;" },
        { id: 2, type: "≡", points: [4, 5], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "4:7.560362,-8.787576,0;5:7.560362,-8.787576,0;" },
        { id: 3, type: "≡", points: [2, 6], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "2:8.426984,5.71041,0;6:8.426984,5.71041,0;" },
        { id: 4, type: "≡", points: [7, 8], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "7:-6.291516,6.590214,0;8:-6.291516,6.590214,0;" },
        { id: 5, type: "⟂", points: [1, 4, 5, 2], status: "", error: "Angle constraint not satisfied\n            270 != 270.0000134908769\n            Diff: 0.0000\n            ", value: 270, _previousSolveValue: 270, previousPointValues: "1:-6.147545,-8.776163,0;4:8.562776,-9.214374,0;5:8.562777,-9.214374,0;2:9.012993,5.898861,0;" },
        { id: 6, type: "⟂", points: [5, 2, 6, 7], status: "solved", error: null, value: 270, _previousSolveValue: 270, previousPointValues: "5:7.560362853424748,-8.787576051013701,0;2:8.426983146575251,5.710410051013703,0;6:8.426984,5.71041,0;7:-6.291516,6.590214,0;" },
        { id: 7, type: "⟂", points: [6, 7, 8, 3], status: "solved", error: null, value: 270, _previousSolveValue: 270, previousPointValues: "6:8.426984,5.71041,0;7:-6.291516,6.590214,0;8:-6.291516,6.590214,0;3:-7.158141,-7.907776,0;" },
        { id: 8, type: "≡", points: [11, 4], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "11:7.560362,-8.787576,0;4:7.560362,-8.787576,0;" },
        { id: 9, type: "≡", points: [22, 17], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "22:2.463262,-12.023261,0;17:2.463262,-12.023261,0;" },
      ],
    },
  };

  const feature2 = await partHistory.newFeature("E");
  Object.assign(feature2.inputParams, {
    id: "E2",
    profile: "S1:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const feature3 = await partHistory.newFeature("R");
  Object.assign(feature3.inputParams, {
    id: "R3",
    profile: "E2:S1:PROFILE_START",
    consumeProfileSketch: true,
    axis: "E2:S1:G3_SW|E2:S1:PROFILE_START[0]",
    angle: 53,
    resolution: "resolution",
    boolean: { targets: ["E2"], operation: "UNION", overlapConditioningEnabled: false },
  });

  const feature4 = await partHistory.newFeature("THK");
  Object.assign(feature4.inputParams, {
    id: "THK18",
    face: [
      "E2:S1:G5_SW",
      "E2:S1:G5_SW|E2:S1:PROFILE_START[0]_RV",
      "E2:S1:G4_SW",
      "E2:S1:G6_SW",
      "E2:S1:G4_SW|E2:S1:PROFILE_START[0]_RV",
      "E2:S1:G6_SW|E2:S1:PROFILE_START[0]_RV",
      "E2:S1:G2_SW|E2:S1:PROFILE_START[0]_RV",
      "E2:S1:G2_SW",
      "E2:S1:G3_SW",
      "E2:S1:PROFILE_END",
    ],
    distance: 1,
  });

  const feature5 = await partHistory.newFeature("B");
  Object.assign(feature5.inputParams, {
    id: "B19",
    targetSolid: "THK18_08_E2_S1_PROFILE_END",
    boolean: {
      targets: [
        "THK18_01_E2_S1_G5_SW",
        "THK18_02_E2_S1_G5_SW_E2_S1_PROFILE_START_0__RV",
        "THK18_03_E2_S1_G4_SW",
        "THK18_05_E2_S1_G6_SW_E2_S1_PROFILE_START_0__RV",
        "THK18_06_E2_S1_G2_SW_E2_S1_PROFILE_START_0__RV",
        "THK18_04_E2_S1_G6_SW",
        "THK18_07_E2_S1_G3_SW",
      ],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  const feature6 = await partHistory.newFeature("O.S");
  Object.assign(feature6.inputParams, {
    id: "O.S20",
    distance: offsetDistance,
    faces: ["E2:S1:PROFILE_START_END"],
    replaceOriginalSolid: true,
    debugSeparateRoundedCornerPipe: false,
    ...offsetShellOverrides,
  });

  return partHistory;
}

export async function test_generated_history_20260607180752_offset_shell_negative_half_is_manifold() {
  const partHistory = new PartHistory();
  await buildGeneratedHistory20260607180752(partHistory, "-0.5");
  await partHistory.runHistory({ throwOnFeatureError: true });

  const shell = partHistory.scene.getObjectByName("E2_O.S20");
  assertClosedManifold(shell, "generated_history_20260607180752_offset_shell_negative_half");

  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "O.S20");
  const diagnostics = feature?.persistentData?.diagnostics || {};
  if (diagnostics.buildMethod !== "face_thicken_union_shell_with_rounded_corners") {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_half] Expected rounded-corner shell build, got ${diagnostics.buildMethod || "unknown"}.`,
    );
  }
  const rounded = diagnostics.roundedCorners || {};
  if (rounded.cleanupRollback?.rolledBack === true) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_half] Expected area-loss cleanup to stay applied, got rollback `
      + `${JSON.stringify(rounded.cleanupRollback)}.`,
    );
  }
  if (rounded.areaLossSidewallReassign?.applied !== true || !(Number(rounded.areaLossSidewallReassign?.reassignedTriangles) > 0)) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_half] Expected area-loss sidewall reassignment, got `
      + `${JSON.stringify(rounded.areaLossSidewallReassign)}.`,
    );
  }
  const faceNames = typeof shell.getFaceNames === "function" ? shell.getFaceNames() : [];
  const remainingJunkFaces = (rounded.sidewallAreaLoss?.collapseFaceNames || []).filter((faceName) => faceNames.includes(faceName));
  if (remainingJunkFaces.length > 0) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_half] Expected junk sidewall faces to be removed, still present: `
      + `${remainingJunkFaces.join(", ")}.`,
    );
  }
}

export async function test_generated_history_20260607180752_offset_shell_negative_one_keeps_cleanup() {
  const partHistory = new PartHistory();
  await buildGeneratedHistory20260607180752(partHistory, "-1");
  await partHistory.runHistory({ throwOnFeatureError: true });

  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "O.S20");
  const rounded = feature?.persistentData?.diagnostics?.roundedCorners || {};
  if (rounded.cleanupRollback?.rolledBack === true) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_one] Expected cleanup to remain applied, got rollback `
      + `${JSON.stringify(rounded.cleanupRollback)}.`,
    );
  }
  if (rounded.pipeSliverCollapse?.applied !== true || !(Number(rounded.pipeSliverCollapseCount) > 0)) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_one] Expected pipe sliver cleanup to apply, got `
      + `${JSON.stringify(rounded.pipeSliverCollapse)}.`,
    );
  }
  if (rounded.pipeSliverCollapse?.manifoldCheck?.ok !== true) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_negative_one] Expected cleaned shell to pass manifold build, got `
      + `${JSON.stringify(rounded.pipeSliverCollapse?.manifoldCheck)}.`,
    );
  }
}

export async function test_generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse() {
  const partHistory = new PartHistory();
  await buildGeneratedHistory20260607180752(partHistory, "-0.5", {
    roundedCornerPipeSliverCollapseEnabled: false,
  });
  await partHistory.runHistory({ throwOnFeatureError: true });

  const shell = partHistory.scene.getObjectByName("E2_O.S20");
  assertClosedManifold(shell, "generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse");

  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "O.S20");
  const rounded = feature?.persistentData?.diagnostics?.roundedCorners || {};
  if (rounded.pipeSliverCollapse?.enabled !== false || rounded.pipeSliverCollapseCount !== 0) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse] Expected pipe collapse disabled, got `
      + `${JSON.stringify(rounded.pipeSliverCollapse)}.`,
    );
  }
  if (rounded.areaLossSidewallReassign?.applied !== true || rounded.areaLossSidewallReassign?.allowRoundedPipeNeighbors !== true) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse] Expected area-loss reassignment with pipe neighbors, got `
      + `${JSON.stringify(rounded.areaLossSidewallReassign)}.`,
    );
  }
  const faceNames = typeof shell.getFaceNames === "function" ? shell.getFaceNames() : [];
  const remainingJunkFaces = (rounded.sidewallAreaLoss?.collapseFaceNames || []).filter((faceName) => faceNames.includes(faceName));
  if (remainingJunkFaces.length > 0) {
    throw new Error(
      `[generated_history_20260607180752_offset_shell_cleanup_toggles_disable_pipe_collapse] Expected junk sidewall faces to be removed, still present: `
      + `${remainingJunkFaces.join(", ")}.`,
    );
  }
}

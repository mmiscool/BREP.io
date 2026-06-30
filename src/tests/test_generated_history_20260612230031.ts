function getSolidByName(partHistory, name) {
  return (partHistory?.scene?.children || []).find((obj) => obj?.type === "SOLID" && obj?.name === name) || null;
}

export async function test_generated_history_20260612230031(partHistory) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("S");
  Object.assign(feature1.inputParams, {
    id: "S1",
    sketchPlane: null,
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 32,
  });
  feature1.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 0, y: 0, fixed: true, construction: false, externalReference: false },
        { id: 3, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
        { id: 4, x: 8.905728, y: 14.930946, fixed: false, construction: false, externalReference: false },
        { id: 5, x: -10.96543, y: 26.783322, fixed: false, construction: false, externalReference: false },
        { id: 6, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -19.87116, y: 11.852382, fixed: false, construction: false, externalReference: false },
        { id: 9, x: -21.942782, y: -8.205132, fixed: false, construction: false, externalReference: false },
        { id: 10, x: -14.391155, y: -11.020762, fixed: false, construction: false, externalReference: false },
        { id: 12, x: -14.391155, y: -11.020762, fixed: false, construction: false, externalReference: false },
        { id: 13, x: -14.466292, y: 8.628587, fixed: false, construction: false, externalReference: false },
        { id: 14, x: -5.143845, y: 3.068105, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: "line", points: [0, 3], construction: false },
        { id: 2, type: "line", points: [4, 1], construction: false },
        { id: 3, type: "line", points: [5, 6], construction: false },
        { id: 6, type: "line", points: [10, 9], construction: false },
        { id: 8, type: "line", points: [7, 13], construction: false },
        { id: 9, type: "line", points: [14, 2], construction: false },
        { id: 10, type: "line", points: [14, 12], construction: false },
        { id: 11, type: "line", points: [13, 9], construction: false },
      ],
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
        { id: 1, type: "≡", points: [0, 2], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;2:0,0,1;" },
        { id: 2, type: "≡", points: [3, 4], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "3:8.905728,14.930946,0;4:8.905728,14.930946,0;" },
        { id: 3, type: "≡", points: [1, 5], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "1:-10.96543,26.783322,0;5:-10.96543,26.783322,0;" },
        { id: 4, type: "≡", points: [6, 7], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "6:-19.87116,11.852382,0;7:-19.87116,11.852382,0;" },
        { id: 5, type: "⟂", points: [0, 3, 4, 1], status: "solved", value: 270, error: null, _previousSolveValue: 270, previousPointValues: "0:0,0,1;3:8.905728,14.930946,0;4:8.905728,14.930946,0;1:-10.96543,26.783322,0;" },
        { id: 6, type: "⟂", points: [4, 1, 5, 6], status: "solved", value: 270, error: null, _previousSolveValue: 270, previousPointValues: "4:8.905728,14.930946,0;1:-10.96543,26.783322,0;5:-10.96543,26.783322,0;6:-19.87116,11.852382,0;" },
        { id: 7, type: "⟂", points: [5, 6, 7, 2], status: "solved", value: 270, error: null, _previousSolveValue: 270, previousPointValues: "5:-10.96543,26.783322,0;6:-19.87116,11.852382,0;7:-19.87116,11.852382,0;2:0,0,1;" },
        { id: 8, type: "≡", points: [12, 10], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "12:-14.391155,-11.020762,0;10:-14.391155,-11.020762,0;" },
      ],
    },
  };

  const feature2 = await partHistory.newFeature("E");
  Object.assign(feature2.inputParams, {
    id: "E2",
    profile: "S1:PROFILE",
    consumeProfileSketch: true,
    distance: 43.1,
    distanceBack: 23,
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const feature3 = await partHistory.newFeature("F");
  Object.assign(feature3.inputParams, {
    id: "F8",
    edges: [
      "E2:S1:G1_SW|E2:S1:G2_SW[0]",
      "E2:S1:G2_SW|E2:S1:G3_SW[0]",
    ],
    radius: "6.7",
    resolution: "resolution",
    direction: "AUTO",
    debug: "ADVANCED OPTIONS",
    inflate: "0",
    nudgeFaceDistance: "0.0001",
    renameFaces: true,
  });

  await partHistory.runHistory();
  return partHistory;
}

export async function afterRun_generated_history_20260612230031(partHistory) {
  const solid = getSolidByName(partHistory, "E2");
  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected filleted solid E2 to exist.");
  }
  const faceNames = solid.getFaceNames().map((name) => String(name || ""));
  const leakedWedgeSideWalls = faceNames.filter((name) => /_(?:SURFACE_CA|SURFACE_CB|WEDGE_A|WEDGE_B)$/u.test(name));
  if (leakedWedgeSideWalls.length > 0) {
    throw new Error(`Expected wedge sidewall faces to be collapsed and renamed, found: ${leakedWedgeSideWalls.join(", ")}`);
  }
  const summary = solid.__filletSideWallCollapseSummary || {};
  if ('movedSideWallVertices' in summary && !(Number(summary.movedSideWallVertices || 0) > 0)) {
    throw new Error("Expected fillet sidewall collapse to move wedge sidewall vertices.");
  }
  if (
    solid.__filletSideWallCollapseRoundFaceMergeCount != null
    && !(Number(solid.__filletSideWallCollapseRoundFaceMergeCount || 0) > 0)
  ) {
    throw new Error("Expected collapsed wedge sidewall faces to be merged into round faces.");
  }
}

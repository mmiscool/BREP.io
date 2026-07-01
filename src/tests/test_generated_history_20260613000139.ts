function getSolidByName(partHistory, name) {
  return (partHistory?.scene?.children || []).find((obj) => obj?.type === "SOLID" && obj?.name === name) || null;
}

export async function test_generated_history_20260613000139(partHistory) {
  partHistory.expressions = "resolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("D");
  Object.assign(feature1.inputParams, {
    id: "D1",
    transform: {
      position: [0.2565036028836988, 5.286649371275551, -3.590228990331272],
      rotationEuler: [-32.818971321018715, 30.63210260878807, -2.671532847188412],
      scale: [1, 1, 1],
    },
  });

  const feature2 = await partHistory.newFeature("S");
  Object.assign(feature2.inputParams, {
    id: "S2",
    sketchPlane: "D1:XY",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  feature2.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 3, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 6, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 15, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 16, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 17, x: 1.764345, y: -4.025491, fixed: false, construction: false, externalReference: false },
        { id: 18, x: 6.391665, y: 4.346518, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 3, type: "line", points: [6, 7], construction: false },
        { id: 4, type: "line", points: [8, 3], construction: false },
        { id: 9, type: "line", points: [1, 17], construction: false },
        { id: 10, type: "line", points: [16, 17], construction: false },
        { id: 11, type: "line", points: [18, 15], construction: false },
        { id: 12, type: "line", points: [18, 2], construction: false },
      ],
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
        { id: 1, type: "≡", points: [1, 3], status: "", error: null, _previousSolveValue: null, previousPointValues: "1:-2.504334,-3.287135,0;3:-2.504334,-3.287135,0;" },
        { id: 3, type: "≡", points: [2, 6], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "2:6.391665,6.452413,0;6:6.391665,6.452413,0;" },
        { id: 4, type: "≡", points: [7, 8], status: "", error: null, _previousSolveValue: null, previousPointValues: "7:-2.504333,6.452412,0;8:-2.504333,6.452412,0;" },
        { id: 7, type: "⟂", points: [6, 7, 8, 3], status: "", error: null, value: 270, _previousSolveValue: 270, previousPointValues: "6:5.357399948061701,6.756693642653996,0;7:-2.8534559480617006,6.093104357346005,0;8:-2.853456,6.093105,0;3:-2.150647,-2.603049,0;" },
        { id: 8, type: "│", points: [8, 3], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "", error: null, _previousSolveValue: null, previousPointValues: "8:-2.504327,6.4524,0;3:-2.504327,-3.27361,0;" },
        { id: 12, type: "≡", points: [15, 16], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "15:1.803917,3.614373,0;16:1.803917,3.614373,0;" },
      ],
    },
  };

  const feature3 = await partHistory.newFeature("E");
  Object.assign(feature3.inputParams, {
    id: "E3",
    profile: "S2:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const feature4 = await partHistory.newFeature("F");
  Object.assign(feature4.inputParams, {
    id: "F4",
    edges: ["E3:S2:G10_SW|E3:S2:G11_SW[0]"],
    radius: "1.9",
    resolution: "resolution",
    direction: "AUTO",
    debug: "NONE",
    inflate: "0",
    nudgeFaceDistance: ".0001",
    renameFaces: true,
    simplifyResult: true,
    cleanupNativeTinyFaceIslands: true,
    reverseEndCapNudge: false,
    mergeCoplanarEndCaps: true,
    reassignSliverTriangles: true,
    collapseTinyTriangles: true,
    cleanupPostCollapseTinyFaceIslands: true,
  });

  await partHistory.runHistory();
  return partHistory;
}

export async function afterRun_generated_history_20260613000139(partHistory) {
  const solid = getSolidByName(partHistory, "E3");
  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected filleted solid E3 to exist.");
  }
  const leakedWedgeSideWalls = solid.getFaceNames()
    .map((name) => String(name || ""))
    .filter((name) => /_(?:SURFACE_CA|SURFACE_CB|WEDGE_A|WEDGE_B)$/u.test(name));
  if (leakedWedgeSideWalls.length > 0) {
    throw new Error(`Expected wedge sidewall faces to be collapsed and renamed, found: ${leakedWedgeSideWalls.join(", ")}`);
  }
  const leakedEndCaps = solid.getFaceNames()
    .map((name) => String(name || ""))
    .filter((name) => /_END_CAP_[12]$/u.test(name));
  if (leakedEndCaps.length > 0) {
    throw new Error(`Expected fillet end caps to merge into the round face, found: ${leakedEndCaps.join(", ")}`);
  }
  const summary = solid.__filletSideWallCollapseSummary || {};
  if (Array.isArray(summary.sideWallFaceNames)) {
    const hostFaces = summary.sideWallFaceNames.filter((name) => /_(?:FACE_A|FACE_B|SIDE_A|SIDE_B)(?:$|_)/u.test(String(name || "")));
    if (hostFaces.length > 0) {
      throw new Error(`Expected fillet sidewall collapse to leave host/intermediate side faces unmoved, collapsed: ${hostFaces.join(", ")}`);
    }
  }
}

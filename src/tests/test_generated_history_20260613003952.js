function getSolidByName(partHistory, name) {
  return (partHistory?.scene?.children || []).find((obj) => obj?.type === "SOLID" && obj?.name === name) || null;
}

function triangleArea(triangle) {
  const a = triangle.p1;
  const b = triangle.p2;
  const c = triangle.p3;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return 0.5 * Math.hypot(
    (uy * vz) - (uz * vy),
    (uz * vx) - (ux * vz),
    (ux * vy) - (uy * vx),
  );
}

export async function test_generated_history_20260613003952(partHistory) {
  partHistory.configurator = { fields: [], values: {} };

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
  feature2.persistentData = {
    sketch: {
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
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null },
        { id: 1, type: "≡", points: [1, 3], status: "solved", error: null, _previousSolveValue: null },
        { id: 2, type: "≡", points: [4, 5], status: "solved", error: null, _previousSolveValue: null },
        { id: 3, type: "≡", points: [2, 6], status: "solved", error: null, _previousSolveValue: null },
        { id: 4, type: "≡", points: [7, 8], status: "solved", error: null, _previousSolveValue: null },
        { id: 5, type: "⟂", points: [1, 4, 5, 2], status: "", value: 270, error: null, _previousSolveValue: 270 },
        { id: 6, type: "⟂", points: [5, 2, 6, 7], status: "", value: 270, error: null, _previousSolveValue: 270 },
        { id: 7, type: "⟂", points: [6, 7, 8, 3], status: "", value: 270, error: null, _previousSolveValue: 270 },
        { id: 8, type: "∥", points: [1, 9, 1, 4], value: 167.5456, valueNeedsSetup: true, status: "", error: null, _previousSolveValue: 167.5456 },
        { id: 9, type: "∥", points: [11, 12, 11, 10], value: 212.2672, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: 212.2672 },
        { id: 10, type: "∥", points: [7, 16, 6, 7], value: 355.4457, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: 355.4457 },
        { id: 11, type: "∥", points: [14, 13, 14, 15], value: 181.0668, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: 181.0668 },
      ],
    },
  };

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
    inflate: "0.2",
    nudgeFaceDistance: 0.0001,
    direction: "AUTO",
    debug: "ADVANCED OPTIONS",
    showTangentOverlays: false,
    collapseFilletSideWalls: true,
    renameFaces: true,
  });

  await partHistory.runHistory();
  return partHistory;
}

export async function afterRun_generated_history_20260613003952(partHistory) {
  const solid = getSolidByName(partHistory, "P.CY1");
  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected filleted target solid P.CY1 to exist.");
  }
  const summary = solid.__filletSideWallCollapseSummary || {};
  if (Array.isArray(summary.sideWallFaceNames)) {
    const hostFaces = summary.sideWallFaceNames.filter((name) => /_(?:FACE_A|FACE_B|SIDE_A|SIDE_B)(?:$|_)/u.test(String(name || "")));
    if (hostFaces.length > 0) {
      throw new Error(`Expected fillet sidewall collapse to leave host/intermediate side faces unmoved, collapsed: ${hostFaces.join(", ")}`);
    }
  }
  let maxFilletTriangleArea = 0;
  let maxFilletTriangleFace = "";
  for (const faceName of solid.getFaceNames()) {
    if (!String(faceName || "").startsWith("F14_FILLET_")) continue;
    for (const triangle of solid.getFace(faceName) || []) {
      const area = triangleArea(triangle);
      if (area <= maxFilletTriangleArea) continue;
      maxFilletTriangleArea = area;
      maxFilletTriangleFace = faceName;
    }
  }
  if (maxFilletTriangleArea > 5) {
    throw new Error(`Expected fillet sidewall collapse to avoid stretched fan triangles; max area ${maxFilletTriangleArea} on ${maxFilletTriangleFace}.`);
  }
}

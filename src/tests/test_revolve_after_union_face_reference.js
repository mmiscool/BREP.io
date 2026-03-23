function makeRectSketch(x0, y0, x1, y1, geomBase = 100) {
  return {
    points: [
      { id: 0, x: x0, y: y0, fixed: true },
      { id: 1, x: x1, y: y0, fixed: false },
      { id: 2, x: x1, y: y1, fixed: false },
      { id: 3, x: x0, y: y1, fixed: false },
    ],
    geometries: [
      { id: geomBase + 0, type: "line", points: [0, 1], construction: false },
      { id: geomBase + 1, type: "line", points: [1, 2], construction: false },
      { id: geomBase + 2, type: "line", points: [2, 3], construction: false },
      { id: geomBase + 3, type: "line", points: [3, 0], construction: false },
    ],
    constraints: [{ id: 0, type: "⏚", points: [0] }],
  };
}

export async function test_revolve_after_union_preserves_face_reference_resolution(partHistory) {
  const cylinder = await partHistory.newFeature("P.CY");
  Object.assign(cylinder.inputParams, {
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

  const sketch = await partHistory.newFeature("S");
  Object.assign(sketch.inputParams, {
    id: "S5",
    sketchPlane: "P.CY1_T",
    curveResolution: 32,
  });
  sketch.persistentData = {
    sketch: makeRectSketch(4, -2, 7, 2, 200),
  };

  const extrude = await partHistory.newFeature("E");
  Object.assign(extrude.inputParams, {
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

  await partHistory.runHistory();

  const extrudedTarget = partHistory.getObjectByName("P.CY1");
  if (!extrudedTarget) {
    throw new Error("Expected extrude boolean target solid to exist.");
  }
  extrudedTarget.visualize();
  const profileFace = partHistory.getObjectByName("E6:S5:PROFILE_END");
  if (!profileFace) {
    throw new Error("Expected post-union face reference E6:S5:PROFILE_END to resolve before revolve.");
  }
  const axisEdge = Array.isArray(profileFace.edges) ? profileFace.edges[0] : null;
  if (!axisEdge?.name) {
    throw new Error("Expected a boundary edge on the resolved extrude end face.");
  }

  const volumeBefore = extrudedTarget.volume();

  const revolve = await partHistory.newFeature("R");
  Object.assign(revolve.inputParams, {
    id: "R9",
    profile: "E6:S5:PROFILE_END",
    axis: axisEdge.name,
    angle: 34,
    resolution: "128",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: false,
    },
  });

  await partHistory.runHistory();

  const finalSolid = partHistory.getObjectByName("P.CY1");
  if (!finalSolid) {
    throw new Error("Expected final boolean target solid to exist after revolve.");
  }
  const volumeAfter = finalSolid.volume();
  if (!(volumeAfter > volumeBefore + 1e-6)) {
    throw new Error(`Expected revolve union to add volume. Before=${volumeBefore}, After=${volumeAfter}.`);
  }

  const faceNames = finalSolid.getFaceNames();
  if (!faceNames.some((name) => String(name || "").includes("_RV"))) {
    throw new Error("Expected final solid to retain revolve side-wall face names.");
  }
}

export async function test_fillet_occ_closed_extrude_edge_history(partHistory) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const cube = await partHistory.newFeature("P.CU");
  Object.assign(cube.inputParams, {
    id: "P.CU1",
    sizeX: 10,
    sizeY: 10,
    sizeZ: 10,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: [],
      operation: "NONE",
      overlapConditioningEnabled: true,
    },
  });

  const sketch = await partHistory.newFeature("S");
  Object.assign(sketch.inputParams, {
    id: "S5",
    sketchPlane: "P.CU1_PY",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  sketch.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: 1.002607, y: -1.788009, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: "circle", points: [0, 1], construction: false },
      ],
      constraints: [
        {
          id: 0,
          type: "⏚",
          points: [0],
          status: "solved",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "0:0,0,1;",
        },
      ],
    },
  };

  const extrude = await partHistory.newFeature("E");
  Object.assign(extrude.inputParams, {
    id: "E6",
    profile: "S5:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 5.9,
    boolean: {
      targets: ["P.CU1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  const fillet = await partHistory.newFeature("F");
  Object.assign(fillet.inputParams, {
    id: "F4",
    edges: [
      "E6:S5:G1_SW|P.CU1_PY[0]",
      "E6:S5:PROFILE_END",
      "P.CU1_NZ|P.CU1_PY[0]",
      "P.CU1_NX|P.CU1_PY[0]",
      "P.CU1_PY|P.CU1_PZ[0]",
      "P.CU1_PX|P.CU1_PY[0]",
    ],
    radius: ".5",
  });

  return partHistory;
}

export async function afterRun_fillet_occ_closed_extrude_edge_history(partHistory) {
  const solids = [];
  partHistory.scene.traverse((obj) => {
    if (obj?.type === "SOLID") solids.push(obj);
  });
  const result = solids.find((solid) => solid?.owningFeatureID === "F4");
  if (!result) throw new Error("Expected closed extrude-edge fillet history to produce the F4 result solid.");

  const faceNames = result.getFaceNames();
  const filletFaces = faceNames.filter((name) => /^F4_FILLET_FACE_/.test(name));
  if (filletFaces.length !== 6) {
    throw new Error(`Expected analytic OCC fillet to create six blend faces for this selection, got ${filletFaces.length}.`);
  }
  if (!faceNames.includes("P.CU1_PY") || !faceNames.includes("E6:S5:G1_SW") || !faceNames.includes("E6:S5:PROFILE_END")) {
    throw new Error("Expected analytic OCC fillet to preserve adjacent source face names.");
  }

  const mesh = result.getMesh();
  const triCount = (mesh.triVerts.length / 3) | 0;
  try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
  if (triCount < 500 || triCount > 1200) {
    throw new Error(`Expected analytic OCC fillet tessellation, got ${triCount} triangles.`);
  }
}

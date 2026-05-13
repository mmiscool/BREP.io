export async function test_fillet_occ_top_loop_history(partHistory) {
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

  const fillet = await partHistory.newFeature("F");
  Object.assign(fillet.inputParams, {
    id: "F2",
    edges: [
      "P.CU1_PY|P.CU1_PZ[0]",
      "P.CU1_PX|P.CU1_PY[0]",
      "P.CU1_NZ|P.CU1_PY[0]",
      "P.CU1_NX|P.CU1_PY[0]",
    ],
    radius: 1,
  });

  return partHistory;
}

export async function afterRun_fillet_occ_top_loop_history(partHistory) {
  const solids = [];
  partHistory.scene.traverse((obj) => {
    if (obj?.type === "SOLID") solids.push(obj);
  });
  const result = solids.find((solid) => solid?.owningFeatureID === "F2");
  if (!result) throw new Error("Expected top-loop fillet history to produce the F2 result solid.");

  const mesh = result.getMesh();
  const triCount = (mesh.triVerts.length / 3) | 0;
  const vertCount = (mesh.vertProperties.length / 3) | 0;
  try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
  if (triCount <= 0 || vertCount <= 0) {
    throw new Error(`Expected OCC fillet result to tessellate, got triangles=${triCount}, vertices=${vertCount}.`);
  }

  const filletFaces = result.getFaceNames().filter((name) => /^F2_FILLET_FACE_/.test(name));
  if (filletFaces.length < 4) {
    throw new Error(`Expected at least four OCC fillet faces for the cube top loop, got ${filletFaces.length}.`);
  }
}

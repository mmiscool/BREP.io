export async function test_offsetShell_thickens_all_faces_except_selected(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const cube = await partHistory.newFeature("P.CU");
  Object.assign(cube.inputParams, {
    id: "P.CU1",
    x: 4,
    y: 4,
    z: 4,
  });

  const shell = await partHistory.newFeature("O.S");
  Object.assign(shell.inputParams, {
    id: "OS2",
    faces: ["P.CU1_PZ"],
    distance: 1,
    replaceOriginalSolid: false,
  });

  return partHistory;
}

export async function afterRun_offsetShell_thickens_all_faces_except_selected(partHistory) {
  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "OS2");
  const diagnostics = feature?.persistentData?.diagnostics || {};
  if (diagnostics.buildMethod !== "face_thicken_union_shell") {
    throw new Error(`Expected face_thicken_union_shell, got ${diagnostics.buildMethod || "unknown"}.`);
  }
  if (diagnostics.faceCount !== 6) {
    throw new Error(`Expected six source cube faces, got ${diagnostics.faceCount}.`);
  }
  if (diagnostics.selectedFaceCount !== 1) {
    throw new Error(`Expected one selected/excluded face, got ${diagnostics.selectedFaceCount}.`);
  }
  if (diagnostics.thickenedFaceCount !== 5) {
    throw new Error(`Expected five thickened faces, got ${diagnostics.thickenedFaceCount}.`);
  }
  if (diagnostics.generatedFaceCount !== 5 || diagnostics.skippedFaceCount !== 0) {
    throw new Error(`Expected five generated face thickens and no skips, got ${JSON.stringify(diagnostics)}.`);
  }
  if (diagnostics.thickenDistance !== -1) {
    throw new Error(`Expected distance 1 to thicken by -1, got ${diagnostics.thickenDistance}.`);
  }

  const selectedFaceNames = feature?.persistentData?.selectedFaceNames || [];
  if (!selectedFaceNames.includes("P.CU1_PZ")) {
    throw new Error(`Expected selected face P.CU1_PZ, got ${selectedFaceNames.join(", ")}.`);
  }

  const shell = partHistory.scene.getObjectByName("P.CU1_OS2");
  if (!shell) {
    throw new Error("Expected offset shell result P.CU1_OS2 in the scene.");
  }
}

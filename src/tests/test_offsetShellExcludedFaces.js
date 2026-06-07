import { Solid } from '../BREP/BetterSolid.js';

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

export async function test_offsetShell_negative_distance_rounds_unselected_solid_edges(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const cube = await partHistory.newFeature("P.CU");
  Object.assign(cube.inputParams, {
    id: "P.CU_NEG",
    x: 4,
    y: 4,
    z: 4,
  });

  const shell = await partHistory.newFeature("O.S");
  Object.assign(shell.inputParams, {
    id: "OS_NEG",
    faces: ["P.CU_NEG_PZ"],
    distance: -0.5,
    replaceOriginalSolid: false,
  });

  return partHistory;
}

export async function afterRun_offsetShell_negative_distance_rounds_unselected_solid_edges(partHistory) {
  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "OS_NEG");
  const diagnostics = feature?.persistentData?.diagnostics || {};
  const rounded = diagnostics.roundedCorners || {};

  if (diagnostics.buildMethod !== "face_thicken_union_shell_with_rounded_corners") {
    throw new Error(`Expected rounded-corner offset shell build, got ${diagnostics.buildMethod || "unknown"}.`);
  }
  if (rounded.requested !== true || rounded.status !== "applied") {
    throw new Error(`Expected rounded corners to be applied, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.edgeCount !== 8) {
    throw new Error(`Expected the cube top face exclusion to leave 8 rounded edges, got ${rounded.edgeCount}.`);
  }
  if (Math.abs(Number(rounded.radius) - 0.5) > 1e-9) {
    throw new Error(`Expected rounded corner radius 0.5, got ${rounded.radius}.`);
  }
  if (!(Number(rounded.pathCount) > 0) || !(Number(rounded.tubeSolidCount) > 0)) {
    throw new Error(`Expected rounded-corner pipe paths and tube solids, got ${JSON.stringify(rounded)}.`);
  }

  const shell = partHistory.scene.getObjectByName("P.CU_NEG_OS_NEG");
  if (!shell) {
    throw new Error("Expected negative offset shell result P.CU_NEG_OS_NEG in the scene.");
  }
}

export async function test_offsetShell_debug_separates_rounded_tube_remainder(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const cube = await partHistory.newFeature("P.CU");
  Object.assign(cube.inputParams, {
    id: "P.CU_DBG",
    x: 4,
    y: 4,
    z: 4,
  });

  const shell = await partHistory.newFeature("O.S");
  Object.assign(shell.inputParams, {
    id: "OS_DBG",
    faces: ["P.CU_DBG_PZ"],
    distance: -0.5,
    replaceOriginalSolid: false,
    debugSeparateRoundedCornerPipe: true,
  });

  return partHistory;
}

export async function afterRun_offsetShell_debug_separates_rounded_tube_remainder(partHistory) {
  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "OS_DBG");
  const diagnostics = feature?.persistentData?.diagnostics || {};
  const rounded = diagnostics.roundedCorners || {};

  if (diagnostics.buildMethod !== "face_thicken_union_shell_with_separate_rounded_corner_pipe") {
    throw new Error(`Expected separated rounded-corner offset shell build, got ${diagnostics.buildMethod || "unknown"}.`);
  }
  if (rounded.status !== "separated" || rounded.shellUnionStrategy !== "debug_separate") {
    throw new Error(`Expected shell/tube union to be skipped in debug mode, got ${JSON.stringify(rounded)}.`);
  }

  const shell = partHistory.scene.getObjectByName("P.CU_DBG_OS_DBG");
  const pipe = partHistory.scene.getObjectByName("P.CU_DBG_OS_DBG_ROUND_PIPE_REMAINDER");
  if (!shell) {
    throw new Error("Expected debug offset shell result P.CU_DBG_OS_DBG in the scene.");
  }
  if (!pipe) {
    throw new Error("Expected debug rounded tube remainder P.CU_DBG_OS_DBG_ROUND_PIPE_REMAINDER in the scene.");
  }

  const debugNames = feature?.persistentData?.debugAddedSolidNames || [];
  if (!debugNames.includes("P.CU_DBG_OS_DBG_ROUND_PIPE_REMAINDER")) {
    throw new Error(`Expected debugAddedSolidNames to include the tube remainder, got ${debugNames.join(", ")}.`);
  }
}

function buildCubeWithSplitBottomFace() {
  const solid = new Solid();
  solid.name = "SPLIT_CUBE";

  const p000 = [0, 0, 0];
  const p100 = [4, 0, 0];
  const p110 = [4, 4, 0];
  const p010 = [0, 4, 0];
  const p200 = [2, 0, 0];
  const p210 = [2, 4, 0];
  const p004 = [0, 0, 4];
  const p104 = [4, 0, 4];
  const p114 = [4, 4, 4];
  const p014 = [0, 4, 4];

  solid
    .addTriangle("SPLIT_BOTTOM_A", p000, p010, p210)
    .addTriangle("SPLIT_BOTTOM_A", p000, p210, p200)
    .addTriangle("SPLIT_BOTTOM_B", p200, p210, p110)
    .addTriangle("SPLIT_BOTTOM_B", p200, p110, p100)
    .addTriangle("SPLIT_TOP", p004, p104, p114)
    .addTriangle("SPLIT_TOP", p004, p114, p014)
    .addTriangle("SPLIT_FRONT", p000, p100, p104)
    .addTriangle("SPLIT_FRONT", p000, p104, p004)
    .addTriangle("SPLIT_BACK", p010, p114, p110)
    .addTriangle("SPLIT_BACK", p010, p014, p114)
    .addTriangle("SPLIT_LEFT", p000, p014, p010)
    .addTriangle("SPLIT_LEFT", p000, p004, p014)
    .addTriangle("SPLIT_RIGHT", p100, p110, p114)
    .addTriangle("SPLIT_RIGHT", p100, p114, p104);

  return solid;
}

export async function test_offsetShell_negative_distance_skips_edges_without_union_sidewall() {
  const source = buildCubeWithSplitBottomFace();
  const shell = source.offsetShell(["SPLIT_TOP"], -0.5, {
    featureId: "OS_SPLIT",
    newSolidName: "SPLIT_CUBE_OS_SPLIT",
  });

  const diagnostics = shell?.__offsetDiagnostics || {};
  const rounded = diagnostics.roundedCorners || {};

  if (diagnostics.buildMethod !== "face_thicken_union_shell_with_rounded_corners") {
    throw new Error(`Expected rounded-corner offset shell build, got ${diagnostics.buildMethod || "unknown"}.`);
  }
  if (rounded.status !== "applied") {
    throw new Error(`Expected rounded corners to be applied, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.sidewallFilterAvailable !== true) {
    throw new Error(`Expected rounded corner sidewall filtering to be available, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.sidewallFilterUsesActualGeometry !== true) {
    throw new Error(`Expected rounded corner filtering to use actual sidewall geometry, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.skippedMissingSidewallFaceCount !== 1) {
    throw new Error(`Expected one edge without a surviving sidewall face to be skipped, got ${rounded.skippedMissingSidewallFaceCount}.`);
  }
  if (!(Number(rounded.edgeCount) > 0) || Number(rounded.edgeCount) >= 7) {
    throw new Error(`Expected sidewall filtering to reduce the rounded edge set, got ${rounded.edgeCount}.`);
  }
  if (shell.name !== "SPLIT_CUBE_OS_SPLIT") {
    throw new Error(`Expected named split shell result, got ${shell.name || "unnamed"}.`);
  }
}

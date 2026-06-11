import { Solid } from '../BREP/BetterSolid.js';
import {
  __testOnlyBuildSidewallAreaLossCollapseTargets,
  __testOnlyCollapseOffsetShellRoundedPipeSlivers,
  __testOnlyReassignAreaLossSidewallFacesToDominantNeighbor,
} from '../BREP/SolidMethods/offsetShell.js';

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function metadataRole(metadata = {}) {
  return normalizeRole(metadata?.offsetShellFaceRole || metadata?.faceRole || metadata?.faceType || metadata?.type || '');
}

function setOffsetShellRole(solid, faceName, metadata) {
  if (typeof solid?.setFaceMetadata === 'function') {
    solid.setFaceMetadata(faceName, metadata);
  }
}

function findVertexIndexByCoords(solid, coords, tolerance = 1e-9) {
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  for (let i = 0; i + 2 < vp.length; i += 3) {
    if (
      Math.abs(Number(vp[i + 0]) - Number(coords[0])) <= tolerance
      && Math.abs(Number(vp[i + 1]) - Number(coords[1])) <= tolerance
      && Math.abs(Number(vp[i + 2]) - Number(coords[2])) <= tolerance
    ) {
      return (i / 3) | 0;
    }
  }
  return -1;
}

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
  if (!rounded.pipeSliverCollapse || !Number.isFinite(Number(rounded.pipeSliverCollapseCount))) {
    throw new Error(`Expected rounded-corner pipe sliver collapse diagnostics, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.pipeRemainderFaceNamesDeduplicated !== true || rounded.shellFaceNamesDeduplicated !== true) {
    throw new Error(`Expected rounded-corner pipe remainder and final shell face names to be deduplicated, got ${JSON.stringify(rounded)}.`);
  }

  const shell = partHistory.scene.getObjectByName("P.CU_NEG_OS_NEG");
  if (!shell) {
    throw new Error("Expected negative offset shell result P.CU_NEG_OS_NEG in the scene.");
  }
  const auxEdges = Array.isArray(shell._auxEdges) ? shell._auxEdges : [];
  const pipeCenterlines = auxEdges.filter((aux) => {
    const name = String(aux?.name || "");
    return aux?.centerline === true && name.startsWith("OS_NEG_ROUND_PIPE") && name.endsWith("_PATH");
  });
  if (!pipeCenterlines.length) {
    throw new Error(`Expected final offset shell to preserve generated rounded-pipe centerlines, got ${auxEdges.map((aux) => aux?.name || "").join(", ")}.`);
  }

  const pipeFaceName = (typeof shell.getFaceNames === "function" ? shell.getFaceNames() : [])
    .find((faceName) => {
      const metadata = typeof shell.getFaceMetadata === "function" ? (shell.getFaceMetadata(faceName) || {}) : {};
      return metadata.offsetShellRoundedPipe === true || metadataRole(metadata) === "rounded_pipe";
    });
  if (!pipeFaceName) {
    throw new Error("Expected final offset shell to retain rounded-pipe face metadata.");
  }
  const pipeMetadata = shell.getFaceMetadata(pipeFaceName) || {};
  if (Math.abs(Number(pipeMetadata.pmiRadiusOverride) - 0.5) > 1e-9) {
    throw new Error(`Expected rounded-pipe PMI radius override 0.5 on ${pipeFaceName}, got ${JSON.stringify(pipeMetadata)}.`);
  }
  const centerlineName = String(pipeMetadata.pmiCenterlineAuxName || pipeMetadata.centerlineAuxName || pipeMetadata.pathName || "");
  if (!centerlineName || !pipeCenterlines.some((aux) => aux?.name === centerlineName)) {
    throw new Error(`Expected rounded-pipe metadata to reference a preserved centerline, got ${JSON.stringify(pipeMetadata)}.`);
  }
}

export async function test_offsetShell_repro_20260607082324_removes_area_loss_sidewall(partHistory) {
  await partHistory.reset();
  partHistory.features = [];
  partHistory.expressions = "resolution = 16;\n";
  partHistory.configurator = { fields: [], values: {} };

  const points = [
    [0, 0, 0, true, true],
    [-7.158141, -7.907776],
    [8.426984, 5.71041],
    [-7.158141, -7.907776],
    [7.560362, -8.787576],
    [7.560362, -8.787576],
    [8.426984, 5.71041],
    [-6.291516, 6.590214],
    [-6.291516, 6.590214],
    [-1.237185, 0.019114],
    [-2.794092, -2.205038],
    [7.560362, -8.787576],
    [7.484115, -11.495576],
    [-7.437728, -13.144076],
    [-2.88781, -12.825321],
    [-4.301049, -12.388265],
    [-5.585603, -11.991006],
    [2.463262, -12.023261],
    [0.123113, -13.639996],
    [-1.794938, -14.965129],
    [5.529604, -10.376861],
    [3.628537, -11.397603],
    [2.463262, -12.023261],
  ].map((point, id) => ({
    id,
    x: point[0],
    y: point[1],
    fixed: !!point[3],
    construction: !!point[4],
    externalReference: false,
  }));
  const geometries = [
    [1, "line", [1, 4], true],
    [2, "line", [5, 2], false],
    [3, "line", [6, 7], false],
    [4, "line", [8, 3], false],
    [5, "circle", [9, 10], false],
    [6, "bezier", [11, 12, 20, 21, 22, 17, 18, 19, 14, 15, 16, 13, 1], false],
    [7, "line", [11, 12], true],
    [8, "line", [1, 13], true],
    [9, "line", [15, 14], true],
    [10, "line", [15, 16], true],
    [11, "line", [18, 17], true],
    [12, "line", [18, 19], true],
    [13, "line", [21, 20], true],
    [14, "line", [21, 22], true],
  ].map(([id, type, geometryPoints, construction]) => ({
    id,
    type,
    points: geometryPoints,
    construction,
  }));

  const sketch = await partHistory.newFeature("S");
  Object.assign(sketch.inputParams, {
    id: "S1",
    sketchPlane: null,
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  sketch.persistentData = { sketch: { points, geometries, constraints: [] } };

  const extrude = await partHistory.newFeature("E");
  Object.assign(extrude.inputParams, {
    id: "E2",
    profile: "S1:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const revolve = await partHistory.newFeature("R");
  Object.assign(revolve.inputParams, {
    id: "R3",
    profile: "E2:S1:PROFILE_START",
    consumeProfileSketch: true,
    axis: "E2:S1:G3_SW|E2:S1:PROFILE_START[0]",
    angle: 53,
    resolution: "resolution",
    boolean: { targets: ["E2"], operation: "UNION", overlapConditioningEnabled: false },
  });

  const offsetShell = await partHistory.newFeature("O.S");
  Object.assign(offsetShell.inputParams, {
    id: "O.S17",
    distance: "-1",
    faces: ["E2:S1:PROFILE_START_END"],
    replaceOriginalSolid: true,
    debugSeparateRoundedCornerPipe: false,
  });
}

export async function afterRun_offsetShell_repro_20260607082324_removes_area_loss_sidewall(partHistory) {
  const targetFaceName = "E2_S1_G6_SW_E2_S1_PROFILE_END_0_SW";
  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "O.S17");
  const rounded = feature?.persistentData?.diagnostics?.roundedCorners || {};
  const areaLossTarget = (rounded.sidewallAreaLoss?.targets || []).find((target) => target?.faceName === targetFaceName);
  if (!areaLossTarget || !(Number(areaLossTarget.areaLossRatio) >= 0.98)) {
    throw new Error(`Expected ${targetFaceName} to be selected by area loss, got ${JSON.stringify(rounded.sidewallAreaLoss)}.`);
  }
  const reassignTarget = (rounded.areaLossSidewallReassign?.targets || []).find((target) => target?.faceName === targetFaceName);
  if (!reassignTarget || reassignTarget.toFaceName !== "E2:S1:G6_SW_END") {
    throw new Error(`Expected ${targetFaceName} to reassign into E2:S1:G6_SW_END, got ${JSON.stringify(rounded.areaLossSidewallReassign)}.`);
  }
  const shell = partHistory.scene.getObjectByName("E2_O.S17");
  if (!shell) {
    throw new Error("Expected offset shell result E2_O.S17.");
  }
  if (shell.getFaceNames().includes(targetFaceName)) {
    throw new Error(`Expected ${targetFaceName} to be removed from final solid.`);
  }
  const faceNames = shell.getFaceNames();
  if (faceNames.includes("E2:S1:G6_SW_START")) {
    throw new Error("Expected source sidewall start cap E2:S1:G6_SW_START to merge into E2:S1:G6_SW.");
  }
  if (!faceNames.includes("E2:S1:G6_SW")) {
    throw new Error(`Expected merged source sidewall E2:S1:G6_SW to remain, got ${faceNames.join(", ")}.`);
  }
  if (faceNames.includes("E2:S1:PROFILE_END_START")) {
    throw new Error("Expected source cap E2:S1:PROFILE_END_START to merge into E2:S1:PROFILE_END.");
  }
  if (!faceNames.includes("E2:S1:PROFILE_END")) {
    throw new Error(`Expected merged source cap E2:S1:PROFILE_END to remain, got ${faceNames.join(", ")}.`);
  }
  const mergedSidewallMetadata = typeof shell.getFaceMetadata === "function"
    ? (shell.getFaceMetadata("E2:S1:G6_SW") || {})
    : {};
  if (metadataRole(mergedSidewallMetadata) !== "sidewall") {
    throw new Error(`Expected merged E2:S1:G6_SW metadata to remain sidewall, got ${JSON.stringify(mergedSidewallMetadata)}.`);
  }
  const mergedEndCapMetadata = typeof shell.getFaceMetadata === "function"
    ? (shell.getFaceMetadata("E2:S1:PROFILE_END") || {})
    : {};
  if (metadataRole(mergedEndCapMetadata) !== "start_cap") {
    throw new Error(`Expected merged E2:S1:PROFILE_END metadata to remain a start cap, got ${JSON.stringify(mergedEndCapMetadata)}.`);
  }
}

function getFaceAreaStats(solid, faceName) {
  const face = (typeof solid?.getFaces === "function" ? solid.getFaces(false) : [])
    .find((entry) => entry?.faceName === faceName);
  let area = 0;
  for (const tri of face?.triangles || []) {
    const p1 = tri?.p1;
    const p2 = tri?.p2;
    const p3 = tri?.p3;
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
    const ux = p2[0] - p1[0];
    const uy = p2[1] - p1[1];
    const uz = p2[2] - p1[2];
    const vx = p3[0] - p1[0];
    const vy = p3[1] - p1[1];
    const vz = p3[2] - p1[2];
    area += 0.5 * Math.hypot(
      (uy * vz) - (uz * vy),
      (uz * vx) - (ux * vz),
      (ux * vy) - (uy * vx),
    );
  }
  return { found: !!face, triangleCount: face?.triangles?.length || 0, area };
}

export async function test_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces(partHistory) {
  await test_offsetShell_repro_20260607082324_removes_area_loss_sidewall(partHistory);
  const offsetShell = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "O.S17");
  Object.assign(offsetShell.inputParams, {
    distance: "-.5",
    roundedCornerAreaLossDetectionEnabled: true,
    roundedCornerPipeSliverCollapseEnabled: true,
    roundedCornerAreaLossReassignEnabled: true,
    roundedCornerCleanupRollbackEnabled: false,
    debugMode: "DEBUG",
  });
}

export async function afterRun_offsetShell_repro_20260608054724_reassign_preserves_g3_end_and_start_end_faces(partHistory) {
  const shell = partHistory.scene.getObjectByName("E2_O.S17");
  if (!shell) {
    throw new Error("Expected offset shell result E2_O.S17.");
  }

  const endStats = getFaceAreaStats(shell, "E2:S1:G3_SW_END");
  if (!endStats.found || endStats.triangleCount <= 0 || !(endStats.area > 200)) {
    throw new Error(`Expected E2:S1:G3_SW_END to keep its output face area, got ${JSON.stringify(endStats)}.`);
  }

  const startEndStats = getFaceAreaStats(shell, "E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW");
  if (!startEndStats.found || startEndStats.triangleCount <= 0 || !(startEndStats.area > 1)) {
    throw new Error(
      "Expected E2_S1_G3_SW_E2_S1_PROFILE_START_END_0_SW to remain a separate output face, got "
      + `${JSON.stringify(startEndStats)}.`,
    );
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

  if (!(Number(rounded.pipeRemainderBoundaryFaceTaggedCount) > 0)) {
    throw new Error(`Expected non-pipe tube remainder faces to be tagged as boundary caps, got ${JSON.stringify(rounded)}.`);
  }
  if (rounded.pipeRemainderFaceNamesDeduplicated !== true) {
    throw new Error(`Expected debug tube remainder face names to be deduplicated, got ${JSON.stringify(rounded)}.`);
  }

  const pipeFaceNames = typeof pipe.getFaceNames === "function" ? pipe.getFaceNames() : [];
  const nonPipeNames = pipeFaceNames.filter((faceName) => {
    const metadata = typeof pipe.getFaceMetadata === "function" ? (pipe.getFaceMetadata(faceName) || {}) : {};
    return metadata.offsetShellRoundedPipe !== true && metadataRole(metadata) !== "rounded_pipe";
  });
  if (!nonPipeNames.length) {
    throw new Error(`Expected debug rounded tube remainder to contain non-pipe faces, got ${pipeFaceNames.join(", ")}.`);
  }
  const untaggedBoundaryNames = nonPipeNames.filter((faceName) => {
    const metadata = typeof pipe.getFaceMetadata === "function" ? (pipe.getFaceMetadata(faceName) || {}) : {};
    return metadata.offsetShellPipeRemainderBoundary !== true || metadataRole(metadata) !== "start_cap";
  });
  if (untaggedBoundaryNames.length) {
    throw new Error(`Expected non-pipe tube remainder faces to be tagged as start caps, got ${untaggedBoundaryNames.join(", ")}.`);
  }

  const boundaryTaggedPipeNames = pipeFaceNames.filter((faceName) => {
    const metadata = typeof pipe.getFaceMetadata === "function" ? (pipe.getFaceMetadata(faceName) || {}) : {};
    return (metadata.offsetShellRoundedPipe === true || metadataRole(metadata) === "rounded_pipe")
      && metadata.offsetShellPipeRemainderBoundary === true;
  });
  if (boundaryTaggedPipeNames.length) {
    throw new Error(`Expected rounded pipe faces not to be tagged as boundary caps, got ${boundaryTaggedPipeNames.join(", ")}.`);
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

export async function test_offsetShell_pipe_sliver_collapse_moves_only_pipe_vertices() {
  const solid = new Solid();
  solid.name = "PIPE_SLIVER_COLLAPSE";
  solid
    .addTriangle("BASE_FACE", [0, 0, 0], [1, 0, 0], [0, 1, 0])
    .addTriangle("PIPE_FACE", [0, 0, 0], [1, 0, 0], [0.02, 0.01, 0]);
  setOffsetShellRole(solid, "BASE_FACE", { type: "sidewall", faceRole: "sidewall" });
  setOffsetShellRole(solid, "PIPE_FACE", { type: "rounded_pipe", faceRole: "rounded_pipe", offsetShellRoundedPipe: true });

  const sidewallFaceID = solid._faceNameToID.get("BASE_FACE");
  const pipeVertexIndex = findVertexIndexByCoords(solid, [0.02, 0.01, 0]);
  if (pipeVertexIndex < 0) {
    throw new Error("Expected to locate pipe-only vertex before collapse.");
  }
  const sidewallVertexIndices = [];
  for (let i = 0; i < solid._triIDs.length; i += 1) {
    if (solid._triIDs[i] !== sidewallFaceID) continue;
    const base = i * 3;
    sidewallVertexIndices.push(
      solid._triVerts[base + 0],
      solid._triVerts[base + 1],
      solid._triVerts[base + 2],
    );
  }
  const beforeSidewallCoords = sidewallVertexIndices.map((vertexIndex) => [
    solid._vertProperties[(vertexIndex * 3) + 0],
    solid._vertProperties[(vertexIndex * 3) + 1],
    solid._vertProperties[(vertexIndex * 3) + 2],
  ]);

  const areaLoss = __testOnlyBuildSidewallAreaLossCollapseTargets(solid, new Map([
    ["BASE_FACE", 50],
  ]), {
    areaLossThreshold: 0.98,
  });
  if (!areaLoss.collapseFaceNames.includes("BASE_FACE")) {
    throw new Error(`Expected BASE_FACE to be selected by >98% area loss, got ${JSON.stringify(areaLoss)}.`);
  }

  const summary = __testOnlyCollapseOffsetShellRoundedPipeSlivers(solid, {
    featureId: "OS_TEST",
    radius: 1,
    pipeSliverHeightTolerance: 0.05,
    collapseSidewallFaceNames: areaLoss.collapseFaceNames,
  });

  if (summary.collapsedPipeVertices !== 1) {
    throw new Error(`Expected one pipe vertex collapse, got ${JSON.stringify(summary)}.`);
  }
  if (summary.removedDegenerateTriangles !== 1) {
    throw new Error(`Expected the collapsed pipe triangle to be removed, got ${JSON.stringify(summary)}.`);
  }
  const pipeAfter = [
    solid._vertProperties[(pipeVertexIndex * 3) + 0],
    solid._vertProperties[(pipeVertexIndex * 3) + 1],
    solid._vertProperties[(pipeVertexIndex * 3) + 2],
  ];
  if (pipeAfter[0] !== 0 || pipeAfter[1] !== 0 || pipeAfter[2] !== 0) {
    throw new Error(`Expected pipe-only vertex to move onto sidewall edge endpoint, got ${pipeAfter.join(",")}.`);
  }

  for (let i = 0; i < sidewallVertexIndices.length; i += 1) {
    const vertexIndex = sidewallVertexIndices[i];
    const before = beforeSidewallCoords[i];
    const after = [
      solid._vertProperties[(vertexIndex * 3) + 0],
      solid._vertProperties[(vertexIndex * 3) + 1],
      solid._vertProperties[(vertexIndex * 3) + 2],
    ];
    if (after[0] !== before[0] || after[1] !== before[1] || after[2] !== before[2]) {
      throw new Error(`Sidewall vertex ${vertexIndex} moved from ${before.join(",")} to ${after.join(",")}.`);
    }
  }
}

export async function test_offsetShell_pipe_sliver_collapse_falls_back_to_shortest_edge() {
  const solid = new Solid();
  solid.name = "PIPE_SLIVER_COLLAPSE_SHORTEST_EDGE";
  solid
    .addTriangle("BASE_FACE", [0, 0, 0], [1, 0, 0], [0, 1, 0])
    .addTriangle("PIPE_FACE", [0, 0, 0], [1, 0, 0], [0.02, 0.01, 0])
    .addTriangle("ADJACENT_KEEPER", [0.02, 0.01, 0], [0.02, 0.02, 0], [0.03, 0.01, 0]);
  setOffsetShellRole(solid, "BASE_FACE", { type: "sidewall", faceRole: "sidewall" });
  setOffsetShellRole(solid, "PIPE_FACE", { type: "rounded_pipe", faceRole: "rounded_pipe", offsetShellRoundedPipe: true });

  const pipeVertexIndex = findVertexIndexByCoords(solid, [0.02, 0.01, 0]);
  if (pipeVertexIndex < 0) {
    throw new Error("Expected to locate pipe vertex before shortest-edge collapse.");
  }
  const areaLoss = __testOnlyBuildSidewallAreaLossCollapseTargets(solid, new Map([
    ["BASE_FACE", 50],
  ]), {
    areaLossThreshold: 0.98,
  });
  if (!areaLoss.collapseFaceNames.includes("BASE_FACE")) {
    throw new Error(`Expected BASE_FACE to be selected by >98% area loss, got ${JSON.stringify(areaLoss)}.`);
  }

  const summary = __testOnlyCollapseOffsetShellRoundedPipeSlivers(solid, {
    featureId: "OS_TEST",
    radius: 1,
    pipeSliverHeightTolerance: 0.05,
    collapseSidewallFaceNames: areaLoss.collapseFaceNames,
  });

  if (summary.collapsedPipeVertices !== 1 || summary.shortestEdgeFallbackCollapses !== 1) {
    throw new Error(`Expected one shortest-edge fallback collapse, got ${JSON.stringify(summary)}.`);
  }
  const pipeAfter = [
    solid._vertProperties[(pipeVertexIndex * 3) + 0],
    solid._vertProperties[(pipeVertexIndex * 3) + 1],
    solid._vertProperties[(pipeVertexIndex * 3) + 2],
  ];
  if (pipeAfter[0] !== 0 || pipeAfter[1] !== 0 || pipeAfter[2] !== 0) {
    throw new Error(`Expected shared pipe vertex to collapse along the shortest edge, got ${pipeAfter.join(",")}.`);
  }
}

export async function test_offsetShell_area_loss_sidewall_reassigns_to_dominant_neighbor() {
  const solid = new Solid();
  solid.name = "AREA_LOSS_SIDEWALL_REASSIGN";
  solid
    .addTriangle("HOST_FACE", [0, 0, 0], [1, 0, 0], [0, -1, 0])
    .addTriangle("TARGET_SW", [0, 0, 0], [1, 0, 0], [0.05, 0.001, 0])
    .addTriangle("TARGET_SW", [0.05, 0.001, 0], [1, 0, 0], [1, 0.001, 0]);

  solid.setFaceMetadata("TARGET_SW", { type: "sidewall" });
  const summary = __testOnlyReassignAreaLossSidewallFacesToDominantNeighbor(solid, {
    collapseSidewallFaceNames: ["TARGET_SW"],
  });

  if (summary.reassignedFaces !== 1 || summary.reassignedTriangles !== 2) {
    throw new Error(`Expected TARGET_SW to reassign all triangles to HOST_FACE, got ${JSON.stringify(summary)}.`);
  }
  if (solid.getFaceNames().includes("TARGET_SW")) {
    throw new Error(`Expected TARGET_SW face label to be pruned, got ${solid.getFaceNames().join(", ")}`);
  }
  const hostFaceID = solid._faceNameToID.get("HOST_FACE");
  if (!solid._triIDs.every((faceID) => faceID === hostFaceID)) {
    throw new Error("Expected every triangle to be assigned to HOST_FACE after sidewall reassign.");
  }
}

export async function test_offsetShell_area_loss_sidewall_reassign_skips_protected_open_face_neighbor() {
  const solid = new Solid();
  solid.name = "AREA_LOSS_SIDEWALL_REASSIGN_PROTECTED_NEIGHBOR";
  solid
    .addTriangle("PROTECTED_OPEN_FACE", [0, 0, 0], [1, 0, 0], [0, -1, 0])
    .addTriangle("PROTECTED_OPEN_FACE", [1, 0, 0], [2, 0, 0], [1, -1, 0])
    .addTriangle("HOST_FACE", [0, 1, 0], [1, 1, 0], [0, 0, 0])
    .addTriangle("TARGET_SW", [0, 0, 0], [1, 0, 0], [0, 1, 0])
    .addTriangle("TARGET_SW", [1, 0, 0], [2, 0, 0], [1, 1, 0]);

  solid.setFaceMetadata("TARGET_SW", { type: "sidewall" });
  const summary = __testOnlyReassignAreaLossSidewallFacesToDominantNeighbor(solid, {
    collapseSidewallFaceNames: ["TARGET_SW"],
    protectedNeighborFaceNames: ["PROTECTED_OPEN_FACE"],
  });

  const target = (summary.targets || []).find((entry) => entry?.faceName === "TARGET_SW");
  if (!target || target.toFaceName !== "HOST_FACE") {
    throw new Error(`Expected TARGET_SW to skip protected open face and reassign to HOST_FACE, got ${JSON.stringify(summary)}.`);
  }

  const protectedFaceID = solid._faceNameToID.get("PROTECTED_OPEN_FACE");
  const protectedTriangleCount = solid._triIDs.filter((faceID) => faceID === protectedFaceID).length;
  if (protectedTriangleCount !== 2) {
    throw new Error(`Expected protected open face to keep only its original triangles, got ${protectedTriangleCount}.`);
  }
}

export async function test_offsetShell_area_loss_sidewall_reassign_preserves_source_sidewall_end_cap() {
  const solid = new Solid();
  solid.name = "AREA_LOSS_SIDEWALL_REASSIGN_PRESERVE_SOURCE_END";
  solid
    .addTriangle("SOURCE_SIDEWALL", [0, 0, 0], [1, 0, 0], [0, -1, 0])
    .addTriangle("SOURCE_SIDEWALL_END_CAP", [0, 0, 0], [1, 0, 0], [0.05, 0.001, 0])
    .addTriangle("SOURCE_SIDEWALL_END_CAP", [0.05, 0.001, 0], [1, 0, 0], [1, 0.001, 0]);

  solid.setFaceMetadata("SOURCE_SIDEWALL", { type: "sidewall", faceRole: "sidewall" });
  solid.setFaceMetadata("SOURCE_SIDEWALL_END_CAP", { type: "end_cap", faceRole: "end_cap", sourceFaceRole: "sidewall" });
  const summary = __testOnlyReassignAreaLossSidewallFacesToDominantNeighbor(solid, {
    collapseSidewallFaceNames: ["SOURCE_SIDEWALL_END_CAP"],
  });

  if (summary.reassignedTriangles !== 0 || summary.reassignedFaces !== 0) {
    throw new Error(`Expected source sidewall end cap to be preserved, got ${JSON.stringify(summary)}.`);
  }
  if (!solid.getFaceNames().includes("SOURCE_SIDEWALL_END_CAP")) {
    throw new Error("Expected SOURCE_SIDEWALL_END_CAP face label to remain after sidewall reassign.");
  }
}

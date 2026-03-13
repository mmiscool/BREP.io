function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed.");
  }
}

function getFeatureEntry(partHistory, type) {
  return (partHistory?.features || []).find((entry) => entry?.type === type) || null;
}

export async function test_offsetFace_preserves_individual_edges(partHistory) {
  const cube = await partHistory.newFeature("P.CU");
  cube.inputParams.sizeX = 5;
  cube.inputParams.sizeY = 5;
  cube.inputParams.sizeZ = 5;

  const cubeId = String(cube?.inputParams?.featureID || "");
  assert(cubeId, "Cube feature should have a featureID.");

  const offset = await partHistory.newFeature("O.F");
  offset.inputParams.faces = [`${cubeId}_PZ`];
  offset.inputParams.distance = 2;
}

export async function afterRun_offsetFace_preserves_individual_edges(partHistory) {
  const cube = getFeatureEntry(partHistory, "P.CU");
  const offset = getFeatureEntry(partHistory, "O.F");
  const cubeId = String(cube?.inputParams?.featureID || "");
  const offsetId = String(offset?.inputParams?.featureID || "");

  assert(cubeId, "Cube featureID missing after history run.");
  assert(offsetId, "Offset-face featureID missing after history run.");

  const groupName = `${offsetId}:${cubeId}_PZ`;
  const group = partHistory?.scene?.getObjectByName?.(groupName) || null;
  assert(group && group.type === "SKETCH", `Expected offset-face sketch group "${groupName}".`);

  const edges = (group.children || []).filter((obj) => obj?.type === "EDGE");
  const vertices = (group.children || []).filter((obj) => obj?.type === "VERTEX");
  const profile = (group.children || []).find((obj) => obj?.type === "FACE" && obj?.name === `${groupName}:PROFILE`) || null;

  assert(profile, "Expected offset-face profile face.");
  assert(edges.length === 4, `Expected 4 individual offset edges for square face, got ${edges.length}.`);
  assert(vertices.length === 4, `Expected 4 boundary points for square face, got ${vertices.length}.`);
  assert(Array.isArray(profile.edges) && profile.edges.length === 4, "Profile face should retain the 4 individual edges.");
  assert(edges.every((edge) => edge?.closedLoop === false), "Square-face offset edges should remain individual open edges.");

  const loops = Array.isArray(profile?.userData?.boundaryLoopsWorld) ? profile.userData.boundaryLoopsWorld : [];
  assert(loops.length === 1, `Expected one outer boundary loop, got ${loops.length}.`);

  const boundaryEdgeGroups = Array.isArray(profile?.userData?.boundaryEdgeGroups) ? profile.userData.boundaryEdgeGroups : [];
  assert(boundaryEdgeGroups.length === 4, `Expected 4 boundary edge groups, got ${boundaryEdgeGroups.length}.`);
  assert(boundaryEdgeGroups.every((groupEntry) => Array.isArray(groupEntry?.pts) && groupEntry.pts.length === 2), "Cube edge groups should remain 2-point segments.");
  assert(edges.every((edge) => edge?.userData?.isHole === false), "Outer square edges should not be marked as holes.");
}

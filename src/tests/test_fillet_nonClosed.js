export async function test_Fillet_NonClosed(partHistory) {
  // Create base solid: a cube
  const cube = await partHistory.newFeature("P.CU");
  cube.inputParams.width = 10;
  cube.inputParams.height = 10;
  cube.inputParams.depth = 10;

  // Fillet a single cube edge (non-closed path segment).
  const fillet = await partHistory.newFeature("F");
  fillet.inputParams.edges = [
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_NY[0]`,
  ];
  fillet.inputParams.radius = 0.5;
  fillet.inputParams.direction = "INSET";

  return partHistory;
}

export async function afterRun_Fillet_NonClosed(partHistory) {
  // Verify that the fillet feature was created successfully
  const filletFeature = partHistory.features.find((f) => f?.type === "F");
  if (!filletFeature) {
    throw new Error("Fillet feature missing from history");
  }

  const stubbed = filletFeature?.persistentData?.stubbed === true;
  const strategy = String(filletFeature?.persistentData?.strategy || "");
  if (!stubbed || strategy !== "miter_tangent_boolean") {
    throw new Error("Fillet feature should report stub metadata.");
  }

  // Verify that the fillet solid exists in the scene
  const filletGroup = (partHistory.scene?.children || []).find(
    (obj) => obj?.owningFeatureID === filletFeature.inputParams.featureID
  );
  if (!filletGroup) throw new Error("Fillet group not found in scene");

  // Stub path still returns a cloned solid so downstream features can reference it.
  let solidCount = 0;
  filletGroup.traverse((obj) => {
    if (obj?.type === "SOLID") solidCount++;
  });

  if (solidCount === 0) {
    throw new Error("Fillet feature should produce at least one solid");
  }

  console.log(`✓ Non-closed fillet stub test passed: ${solidCount} solid(s) created`);
}

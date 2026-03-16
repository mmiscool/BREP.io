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

  const usedSheetMetalPath = filletFeature?.persistentData?.usedSheetMetalPath === true;
  const decision = filletFeature?.persistentData?.edgeDirectionDecision || null;
  if (usedSheetMetalPath || !decision || Number(decision.totalEdges || 0) !== 1) {
    throw new Error("Non-closed fillet should produce a normal single-edge fillet result.");
  }

  // Verify that the fillet solid exists in the scene
  let solidCount = 0;
  for (const obj of (partHistory.scene?.children || [])) {
    if (obj?.owningFeatureID === filletFeature.inputParams.featureID && obj?.type === "SOLID") {
      solidCount++;
    }
    if (typeof obj?.traverse === "function") {
      obj.traverse((child) => {
        if (child?.owningFeatureID === filletFeature.inputParams.featureID && child?.type === "SOLID") solidCount++;
      });
    }
  }

  if (solidCount === 0) {
    throw new Error("Fillet feature should produce at least one solid");
  }

  console.log(`✓ Non-closed fillet test passed: ${solidCount} solid(s) created`);
}

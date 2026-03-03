export async function test_fillet_corner_bridge(partHistory) {
  const cube = await partHistory.newFeature("P.CU");
  cube.inputParams.sizeX = 10;
  cube.inputParams.sizeY = 10;
  cube.inputParams.sizeZ = 10;

  const fillet = await partHistory.newFeature("F");
  fillet.inputParams.edges = [
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_NY[0]`,
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_PZ[0]`,
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_PY[0]`,
  ];
  fillet.inputParams.radius = 1.2;
  fillet.inputParams.direction = "INSET";
  fillet.inputParams.resolution = 32;

  return partHistory;
}

export async function afterRun_fillet_corner_bridge(partHistory) {
  const filletFeature = partHistory.features.find((feature) => feature?.type === "F");
  if (!filletFeature) {
    throw new Error("Fillet feature missing from history.");
  }

  const summary = filletFeature?.persistentData?.miterSummary || null;
  if (!summary || typeof summary !== "object") {
    throw new Error("Fillet corner bridge summary metadata missing.");
  }

  const cornerBridgeCount = Number(summary?.cornerBridgeCount || 0);
  if (cornerBridgeCount < 1) {
    throw new Error(`Expected at least one corner bridge, received ${cornerBridgeCount}.`);
  }

  const filletGroup = (partHistory.scene?.children || []).find(
    (obj) => obj?.owningFeatureID === filletFeature.inputParams.featureID,
  );
  if (!filletGroup) {
    throw new Error("Fillet group not found in scene.");
  }

  let filletSolid = null;
  filletGroup.traverse((obj) => {
    if (!filletSolid && obj?.type === "SOLID") filletSolid = obj;
  });
  if (!filletSolid || typeof filletSolid._manifoldize !== "function") {
    throw new Error("Corner-bridge fillet did not produce a manifold-capable solid.");
  }

  try {
    filletSolid._manifoldize();
  } catch (error) {
    const message = String(error?.message || error || "Unknown manifold error");
    throw new Error(`Corner-bridge fillet manifoldization failed: ${message}`);
  }

  console.log(`✓ Fillet corner bridge test passed: bridges=${cornerBridgeCount}`);
}

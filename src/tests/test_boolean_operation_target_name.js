export async function test_boolean_operation_target_name_preserved(partHistory) {
  const target = await partHistory.newFeature("P.CU");
  target.inputParams.sizeX = 10;
  target.inputParams.sizeY = 10;
  target.inputParams.sizeZ = 10;

  const tool = await partHistory.newFeature("P.CU");
  tool.inputParams.sizeX = 10;
  tool.inputParams.sizeY = 10;
  tool.inputParams.sizeZ = 10;
  tool.inputParams.transform = {
    position: [5, 0, 0],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  };
  tool.inputParams.boolean = {
    operation: "UNION",
    targets: [target.inputParams.featureID],
  };

  return partHistory;
}

export async function afterRun_boolean_operation_target_name_preserved(partHistory) {
  const cubeFeatures = (partHistory?.features || []).filter((feature) => feature?.type === "P.CU");
  if (cubeFeatures.length < 2) {
    throw new Error("[boolean target name] Expected at least two primitive cube features.");
  }
  const targetName = cubeFeatures[0]?.inputParams?.featureID;
  const toolName = cubeFeatures[1]?.inputParams?.featureID;
  if (!targetName || !toolName) {
    throw new Error("[boolean target name] Missing feature IDs for cube setup.");
  }

  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  if (solids.length !== 1) {
    throw new Error(`[boolean target name] Expected exactly one solid after union, got ${solids.length}.`);
  }

  const result = solids[0];
  if (String(result?.name || "") !== String(targetName)) {
    throw new Error(`[boolean target name] Expected result name "${targetName}", got "${String(result?.name || "")}".`);
  }

  const lingeringTool = partHistory?.scene?.getObjectByName?.(toolName);
  if (lingeringTool) {
    throw new Error(`[boolean target name] Tool-named solid "${toolName}" should have been replaced.`);
  }
}

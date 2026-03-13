export async function test_smooth_with_subdivision_replaces_source_solid(partHistory) {
  const base = await partHistory.newFeature("P.CY");
  base.inputParams.id = "SMOOTH_SRC";
  base.inputParams.radius = 5;
  base.inputParams.height = 12;
  base.inputParams.resolution = 16;
  const smooth = await partHistory.newFeature("SWS");
  smooth.inputParams.targetSolid = base.inputParams.featureID;
  smooth.inputParams.subdivisionLoops = 1;
  return partHistory;
}

export async function afterRun_smooth_with_subdivision_replaces_source_solid(partHistory) {
  const smoothFeature = (partHistory.features || []).find((entry) => String(entry?.type || "").toUpperCase() === "SWS");
  if (!smoothFeature) throw new Error("[smooth with subdivision] Feature entry was not created.");

  const stats = smoothFeature.persistentData || {};
  if (!(Number(stats.sourceTriangleCount) > 0)) {
    throw new Error("[smooth with subdivision] Source triangle count was not captured.");
  }
  if (!(Number(stats.outputTriangleCount) > Number(stats.sourceTriangleCount))) {
    throw new Error("[smooth with subdivision] Expected subdivision to increase triangle count.");
  }

  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  if (solids.length !== 1) {
    throw new Error(`[smooth with subdivision] Expected one replacement solid, found ${solids.length}.`);
  }

  const outputSolid = solids[0];
  const marker = outputSolid?.userData?.smoothWithSubdivision || null;
  if (!marker) {
    throw new Error("[smooth with subdivision] Output solid is missing feature metadata.");
  }
  if (Number(marker.subdivisionLoops) !== 1) {
    throw new Error("[smooth with subdivision] Output solid metadata has the wrong subdivision loop count.");
  }
  if (!(Number(marker.outputTriangleCount) > Number(marker.sourceTriangleCount))) {
    throw new Error("[smooth with subdivision] Output solid metadata did not record increased triangle count.");
  }

  const expectedFaceNames = new Set(["SMOOTH_SRC_B", "SMOOTH_SRC_T", "SMOOTH_SRC_S"]);
  const outputFaceNames = new Set(
    (typeof outputSolid.getFaceNames === "function" ? outputSolid.getFaceNames() : [])
      .map((name) => String(name || "").trim())
      .filter((name) => name.length > 0),
  );
  if (outputFaceNames.size !== expectedFaceNames.size) {
    throw new Error(
      `[smooth with subdivision] Expected ${expectedFaceNames.size} retained face names, found ${outputFaceNames.size}.`,
    );
  }
  for (const faceName of expectedFaceNames) {
    if (!outputFaceNames.has(faceName)) {
      throw new Error(`[smooth with subdivision] Missing retained face name "${faceName}".`);
    }
  }

  const sideMeta = typeof outputSolid.getFaceMetadata === "function"
    ? outputSolid.getFaceMetadata("SMOOTH_SRC_S")
    : null;
  if (!sideMeta || sideMeta.type !== "cylindrical") {
    throw new Error("[smooth with subdivision] Cylindrical side face metadata was not preserved.");
  }
  if (Number(sideMeta.radius) !== 5 || Number(sideMeta.height) !== 12) {
    throw new Error("[smooth with subdivision] Cylindrical side face metadata has the wrong dimensions.");
  }
}

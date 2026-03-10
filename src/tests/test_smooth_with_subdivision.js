export async function test_smooth_with_subdivision_replaces_source_solid(partHistory) {
  const base = await partHistory.newFeature("P.CU");
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
}

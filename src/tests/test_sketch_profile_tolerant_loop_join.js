import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/slowsketch.json";

export async function test_sketch_profile_tolerant_loop_join(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  partHistory.currentHistoryStepId = "S3";
  return partHistory;
}

export async function afterRun_sketch_profile_tolerant_loop_join(partHistory) {
  const feature = partHistory.features.find((entry) => entry?.inputParams?.id === "S3");
  if (!feature) throw new Error("S3 sketch feature missing from slowsketch part file.");

  const profile = partHistory.getObjectByName("S3:PROFILE");
  if (!profile || String(profile?.type || "").toUpperCase() !== "FACE") {
    throw new Error("Expected S3 to emit a sketch profile face.");
  }

  const diag = feature?.persistentData?.lastProfileDiagnostics || null;
  if (!diag || diag.status !== "ok") {
    throw new Error(`Expected S3 profile diagnostics to succeed, got ${diag?.status || "null"}.`);
  }

  const loopCount = Array.isArray(diag.loops2D) ? diag.loops2D.length : 0;
  const groupCount = Array.isArray(diag.groups) ? diag.groups.length : 0;
  const openChainCount = Array.isArray(diag.openChains2D) ? diag.openChains2D.length : 0;
  const boundaryEdges = Array.isArray(diag.boundaryEdges) ? diag.boundaryEdges : [];
  const firstGroup = Array.isArray(diag.groups) ? diag.groups[0] : null;
  const holeCount = Array.isArray(firstGroup?.holes) ? firstGroup.holes.length : 0;

  if (loopCount !== 2) {
    throw new Error(`Expected S3 to reconstruct two closed loops, got ${loopCount}.`);
  }
  if (groupCount !== 1 || holeCount !== 1) {
    throw new Error(`Expected S3 to reconstruct one outer loop with one hole, got groups=${groupCount}, holes=${holeCount}.`);
  }
  if (openChainCount !== 0) {
    throw new Error(`Expected tolerant loop joining to eliminate open chains, got ${openChainCount}.`);
  }
  if (boundaryEdges.length !== 15) {
    throw new Error(`Expected S3 profile to retain all 15 boundary edges, got ${boundaryEdges.length}.`);
  }

  console.log(`✓ S3 tolerant loop join rebuilt ${loopCount} loops with ${boundaryEdges.length} boundary edges`);
}

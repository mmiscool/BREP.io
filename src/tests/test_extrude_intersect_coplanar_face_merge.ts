import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/slowsketch.json";

export async function test_extrude_intersect_coplanar_face_merge(partHistory) {
  const content = await (fs.promises as any).readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  partHistory.currentHistoryStepId = "E4";
  return partHistory;
}

export async function afterRun_extrude_intersect_coplanar_face_merge(partHistory) {
  const solid = partHistory.getObjectByName("E2");
  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected intersect result solid E2 to exist after E4.");
  }

  const faceNames = new Set(solid.getFaceNames() || []);
  if (!faceNames.has("E2:S1:PROFILE_START")) {
    throw new Error("Expected E2:S1:PROFILE_START to survive the intersect result.");
  }
  if (faceNames.has("E4:S3:G9_SW")) {
    throw new Error("Expected coplanar sidewall E4:S3:G9_SW to merge into E2:S1:PROFILE_START.");
  }

  const metadata = solid.getFaceMetadata?.("E2:S1:PROFILE_START") || {};
  if (metadata.faceType !== "STARTCAP" || metadata.sourceFeatureId !== "E2") {
    throw new Error("Expected merged host face metadata on E2:S1:PROFILE_START to be preserved.");
  }

  const triangles = solid.getFace?.("E2:S1:PROFILE_START") || [];
  if (triangles.length <= 42) {
    throw new Error(`Expected merged host face to gain triangles from the coplanar fragment, got ${triangles.length}.`);
  }

  console.log(`✓ E4 intersect merged coplanar sidewall into PROFILE_START (${triangles.length} triangles)`);
}

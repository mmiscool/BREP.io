import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/medium_fillets.BREP.json";
const PRE_FILLET_STEP_ID = "E2";
const POST_FILLET_STEP_ID = "F3";

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || solids[0] || null;
}

export async function test_fillet_preserves_original_face_names(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  partHistory.currentHistoryStepId = PRE_FILLET_STEP_ID;
  return partHistory;
}

export async function afterRun_fillet_preserves_original_face_names(partHistory) {
  const preSolid = getSolidByName(partHistory, PRE_FILLET_STEP_ID);
  if (!preSolid || typeof preSolid.getFaceNames !== "function") {
    throw new Error("[fillet face-name preserve] Failed to resolve pre-fillet solid.");
  }

  const originalNames = (preSolid.getFaceNames() || [])
    .map((name) => String(name || "").trim())
    .filter((name) => name.length > 0);
  if (originalNames.length === 0) {
    throw new Error("[fillet face-name preserve] Pre-fillet solid has no face names.");
  }

  partHistory.currentHistoryStepId = POST_FILLET_STEP_ID;
  await partHistory.runHistory();

  const postSolid = getSolidByName(partHistory, PRE_FILLET_STEP_ID);
  if (!postSolid || typeof postSolid.getFaceNames !== "function") {
    throw new Error("[fillet face-name preserve] Failed to resolve post-fillet solid.");
  }

  const postNames = new Set(
    (postSolid.getFaceNames() || [])
      .map((name) => String(name || "").trim())
      .filter((name) => name.length > 0),
  );
  const missing = originalNames.filter((name) => !postNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[fillet face-name preserve] Lost ${missing.length} original face names: ${missing.join(", ")}`,
    );
  }

  console.log(
    `✓ Fillet preserved ${originalNames.length} original face names on ${String(postSolid?.name || "solid")}.`,
  );
}

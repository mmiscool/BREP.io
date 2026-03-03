import { computeFilletCenterline } from "../BREP/fillets/fillet.js";
import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/fillet_angle_test.BREP.json";

export async function test_fillet_angle(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  partHistory.expressions = "//Examples:\nangle = 35;";
  // Stop after the extrude so we can inspect the source edge selection.
  partHistory.currentHistoryStepId = "E2";
  return partHistory;
}

export async function afterRun_fillet_angle(partHistory) {
  const filletFeature = partHistory.features.find((feature) => feature?.type === "F");
  if (!filletFeature) {
    throw new Error("Fillet feature missing from part file.");
  }

  const edgeNames = Array.isArray(filletFeature.inputParams?.edges)
    ? filletFeature.inputParams.edges
    : [];
  const edgeName = edgeNames.find((name) => typeof name === "string") || null;
  if (!edgeName) {
    throw new Error("Fillet edge name not found in test part file.");
  }

  const edgeObj = partHistory.getObjectByName(edgeName);
  if (!edgeObj) {
    throw new Error(`Edge object "${edgeName}" not found after extrude.`);
  }

  const radius = Number(filletFeature.inputParams?.radius) || 2;
  const side = String(filletFeature.inputParams?.direction || "INSET").toUpperCase();
  const res = computeFilletCenterline(edgeObj, radius, side);

  if (!Array.isArray(res.points) || !Array.isArray(res.edge)) {
    throw new Error("computeFilletCenterline should return point arrays.");
  }
  if (!Array.isArray(res.tangentA) || !Array.isArray(res.tangentB)) {
    throw new Error("computeFilletCenterline should return tangent arrays.");
  }

  console.log(
    `✓ Fillet angle tangent test passed: points=${res.points.length}, tangentsA=${res.tangentA.length}, tangentsB=${res.tangentB.length}`,
  );
}

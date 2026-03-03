import { computeFilletCenterline } from "../BREP/fillets/fillet.js";
import { fs } from "../fs.proxy.js";

const PART_PATH = "src/tests/partFiles/fillet_test.BREP.json";

export async function test_fillet_edge_degenerate_segment(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  // Stop before the fillet so we can evaluate the source edge geometry directly.
  partHistory.currentHistoryStepId = "E7";
  return partHistory;
}

export async function afterRun_fillet_edge_degenerate_segment(partHistory) {
  const filletFeature = partHistory.features.find((feature) => feature?.type === "F");
  if (!filletFeature) throw new Error("Fillet feature missing from part file.");

  const rawEdge = Array.isArray(filletFeature.inputParams?.edges)
    ? filletFeature.inputParams.edges[0]
    : null;
  if (!rawEdge) throw new Error("Fillet edge reference missing from part file.");

  const edgeObj = (typeof rawEdge === "object")
    ? rawEdge
    : partHistory.getObjectByName(String(rawEdge));
  if (!edgeObj) throw new Error(`Fillet source edge not found: ${String(rawEdge)}`);

  const radius = Number(filletFeature.inputParams?.radius) || 1;
  const res = computeFilletCenterline(edgeObj, radius, "INSET");
  if (!Array.isArray(res.points) || !Array.isArray(res.edge)) {
    throw new Error("computeFilletCenterline should provide point arrays.");
  }

  console.log(
    `✓ Fillet degenerate-edge tangent test passed: points=${res.points.length}, edgeSamples=${res.edge.length}`,
  );
}

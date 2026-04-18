import { fs } from "../fs.proxy.js";
import { FilletFeature } from "../features/fillet/FilletFeature.js";

const PART_PATH = "src/tests/partFiles/slowsketch.json";

export async function test_fillet_compound_snapshot_resolution(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, "utf8");
  await partHistory.reset();
  await partHistory.fromJSON(content);
  partHistory.currentHistoryStepId = "F5";
  return partHistory;
}

export async function afterRun_fillet_compound_snapshot_resolution(partHistory) {
  const featureEntry = partHistory.features.find((feature) => feature?.inputParams?.id === "F6");
  if (!featureEntry) throw new Error("F6 fillet feature missing from slowsketch part file.");

  const targetSolid = partHistory.getObjectByName("E2");
  if (!targetSolid || typeof targetSolid !== "object") {
    throw new Error("Failed to resolve the post-F5 target solid E2.");
  }

  const feature = new FilletFeature();
  feature.persistentData = featureEntry?.persistentData || {};
  feature.inputParams = await partHistory.sanitizeInputParams(
    FilletFeature.inputParamsSchema,
    featureEntry.inputParams,
  );
  feature.inputParams.id = "F6";
  feature.inputParams.featureID = "F6";

  let capturedEdges = null;
  const originalFillet = targetSolid.fillet;
  const originalCollapseTinyTriangles = targetSolid.collapseTinyTriangles;
  const originalVisualize = targetSolid.visualize;
  targetSolid.fillet = async (options = {}) => {
    capturedEdges = Array.isArray(options.edges) ? options.edges.slice() : [];
    return targetSolid;
  };
  targetSolid.collapseTinyTriangles = async () => {};
  targetSolid.visualize = () => {};

  try {
    await feature.run(partHistory);
  } finally {
    targetSolid.fillet = originalFillet;
    targetSolid.collapseTinyTriangles = originalCollapseTinyTriangles;
    targetSolid.visualize = originalVisualize;
  }

  if (!Array.isArray(capturedEdges) || capturedEdges.length !== 4) {
    throw new Error(`Expected F6 to recover 4 live edges from preview snapshots, received ${capturedEdges?.length ?? 0}.`);
  }

  const uniqueEdges = Array.from(new Set(capturedEdges));
  if (uniqueEdges.length !== 4) {
    throw new Error(`Expected F6 to recover 4 unique live edges, received ${uniqueEdges.length}.`);
  }

  const recoveredFaces = new Set();
  for (const edge of capturedEdges) {
    if (String(edge?.type || "").toUpperCase() !== "EDGE") {
      throw new Error("Recovered F6 selections must be concrete edge objects.");
    }
    if ((edge?.parentSolid || edge?.parent) !== targetSolid) {
      throw new Error("Recovered F6 edges must belong to the target solid E2.");
    }
    const faceA = String(edge?.userData?.faceA || edge?.faces?.[0]?.name || "");
    const faceB = String(edge?.userData?.faceB || edge?.faces?.[1]?.name || "");
    if (faceA.includes("G12") || faceB.includes("G12")) recoveredFaces.add("G12");
    if (faceA.includes("G14") || faceB.includes("G14")) recoveredFaces.add("G14");
  }

  if (!recoveredFaces.has("G12") || !recoveredFaces.has("G14")) {
    throw new Error(`Recovered F6 edges should cover both surviving side faces, got ${JSON.stringify(Array.from(recoveredFaces))}.`);
  }

  console.log(`✓ F6 snapshot recovery resolved ${capturedEdges.length} edges without face expansion`);
}

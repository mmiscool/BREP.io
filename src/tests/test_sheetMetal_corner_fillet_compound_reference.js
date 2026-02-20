import { FilletFeature } from "../features/fillet/FilletFeature.js";
import { __test_buildRenderableSheetModelFromTree } from "../features/sheetMetal/sheetMetalEngineBridge.js";
import { sheetMetalNonManifoldSmF18Fixture } from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findFlatById(flat, id) {
  if (!flat) return null;
  if (String(flat.id) === String(id)) return flat;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    const bend = edge?.bend;
    const children = Array.isArray(bend?.children) ? bend.children : [];
    for (const child of children) {
      const found = findFlatById(child?.flat, id);
      if (found) return found;
    }
  }
  return null;
}

export async function test_sheetMetal_corner_fillet_compound_reference(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const built = __test_buildRenderableSheetModelFromTree({
    featureID: "SM.TAB3",
    tree: clone(sheetMetalNonManifoldSmF18Fixture.tree),
    rootMatrix: sheetMetalNonManifoldSmF18Fixture.rootTransform,
    showFlatPattern: true,
  });
  const sourceSolid = built?.root || null;
  if (!sourceSolid) throw new Error("Failed to build source sheet-metal solid for compound-reference fillet test.");
  partHistory.scene.add(sourceSolid);

  const beforeFlat = findFlatById(sourceSolid?.userData?.sheetMetalModel?.tree?.root, "SM.TAB3:flat_root");
  const beforeOutlineCount = Array.isArray(beforeFlat?.outline) ? beforeFlat.outline.length : 0;
  const compoundToken = "SM.TAB3:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e2|SM.TAB3:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e3[0]";
  const selectionObject = {
    type: "EDGE",
    name: compoundToken,
    userData: {},
  };

  const fillet = new FilletFeature();
  fillet.inputParams = await partHistory.sanitizeInputParams(FilletFeature.inputParamsSchema, {
    id: "F19",
    edges: [
      selectionObject,
    ],
    radius: "2.5",
    resolution: 32,
    inflate: 0.1,
    direction: "INSET",
    showTangentOverlays: false,
    cleanupTinyFaceIslandsArea: 0.01,
    debug: false,
  });
  fillet.inputParams.id = "F19";
  fillet.inputParams.featureID = "F19";

  const result = await fillet.run(partHistory);
  const outputSolid = Array.isArray(result?.added)
    ? result.added.find((item) => item?.userData?.sheetMetalModel?.tree)
    : null;
  if (!outputSolid) {
    throw new Error("Compound reference sheet-metal fillet produced no output solid.");
  }

  const summary = fillet?.persistentData?.sheetMetalFilletSummary || null;
  if (!(Number(summary?.applied || 0) > 0 && Number(summary?.appliedCorners || 0) > 0)) {
    throw new Error(`Compound reference sheet-metal fillet did not apply: ${JSON.stringify(summary)}`);
  }
  if (Number(summary?.appliedCorners || 0) !== 1) {
    throw new Error(`Compound reference corner selection should round exactly one corner, got ${Number(summary?.appliedCorners || 0)}.`);
  }

  const afterFlat = findFlatById(outputSolid?.userData?.sheetMetalModel?.tree?.root, "SM.TAB3:flat_root");
  const afterOutlineCount = Array.isArray(afterFlat?.outline) ? afterFlat.outline.length : 0;
  if (!(afterOutlineCount > beforeOutlineCount)) {
    throw new Error("Compound reference sheet-metal fillet did not add rounded vertices to flat pattern outline.");
  }
  const curvedOuterEdges = (Array.isArray(afterFlat?.edges) ? afterFlat.edges : [])
    .filter((edge) => !edge?.isInternalCutoutEdge && !edge?.isAttachEdge && Array.isArray(edge?.polyline) && edge.polyline.length > 2);
  if (curvedOuterEdges.length < 1) {
    throw new Error("Compound reference sheet-metal fillet should rebuild the rounded span as a single curved edge polyline.");
  }
}

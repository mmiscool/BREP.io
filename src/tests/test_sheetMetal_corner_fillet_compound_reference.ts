import { FilletFeature } from "../features/fillet/FilletFeature.js";
import { __test_buildRenderableSheetModelFromTree } from "../features/sheetMetal/sheetMetalEngineBridge.js";
import { sheetMetalNonManifoldSmF18Fixture } from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function test_sheetMetal_corner_fillet_compound_reference(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const built = (__test_buildRenderableSheetModelFromTree as any)({
    featureID: "SM.TAB3",
    tree: clone(sheetMetalNonManifoldSmF18Fixture.tree),
    rootMatrix: sheetMetalNonManifoldSmF18Fixture.rootTransform,
    showFlatPattern: true,
  });
  const sourceSolid = built?.root || null;
  if (!sourceSolid) throw new Error("Failed to build source sheet-metal solid for fillet stub test.");
  partHistory.scene.add(sourceSolid);

  const compoundToken = "SM.TAB3:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e2|SM.TAB3:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e3[0]";
  const selectionObject = {
    type: "EDGE",
    name: compoundToken,
    userData: {},
  };

  const fillet = new FilletFeature();
  fillet.inputParams = await partHistory.sanitizeInputParams(FilletFeature.inputParamsSchema, {
    id: "F19",
    edges: [selectionObject],
    radius: "2.5",
    direction: "INSET",
  });
  fillet.inputParams.id = "F19";
  fillet.inputParams.featureID = "F19";

  const result = await fillet.run(partHistory);
  const addedCount = Array.isArray(result?.added) ? result.added.length : 0;
  const removedCount = Array.isArray(result?.removed) ? result.removed.length : 0;
  if (addedCount !== 1 || removedCount !== 1) {
    throw new Error("Compound corner reference should resolve to a sheet-metal fillet replacement.");
  }

  const persistent = fillet?.persistentData || {};
  if (persistent.usedSheetMetalPath !== true) {
    throw new Error("Compound corner reference should use the sheet-metal fillet path.");
  }
  const summary = persistent.sheetMetalFilletSummary || {};
  if (summary.applied !== 1 || summary.appliedCorners !== 1) {
    throw new Error("Compound corner reference should apply exactly one sheet-metal corner fillet.");
  }
  const appliedTarget = Array.isArray(summary.appliedTargets) ? summary.appliedTargets[0] : null;
  const cornerEdgeIds = Array.isArray(appliedTarget?.cornerEdgeIds) ? appliedTarget.cornerEdgeIds.join(",") : "";
  if (cornerEdgeIds !== "SM.TAB3:flat_root:e2,SM.TAB3:flat_root:e3") {
    throw new Error(`Compound corner reference should preserve both corner edges, got ${cornerEdgeIds}.`);
  }
}

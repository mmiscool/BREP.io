import {
  __test_buildRenderableSheetModelFromTree,
  runSheetMetalCornerFillet,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import {
  sheetMetalNonManifoldSmF18Fixture,
} from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function test_sheetMetal_corner_fillet_selection_resolution(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const built = __test_buildRenderableSheetModelFromTree({
    featureID: sheetMetalNonManifoldSmF18Fixture.featureID,
    tree: clone(sheetMetalNonManifoldSmF18Fixture.tree),
    rootMatrix: sheetMetalNonManifoldSmF18Fixture.rootTransform,
    showFlatPattern: false,
  });
  const carrier = built?.root || null;
  if (!carrier) throw new Error("Failed to build source carrier for corner-fillet selection test.");

  const selectionE2 = {
    type: "FACE",
    name: "SM.F18:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e2",
    parentSolid: carrier,
    userData: {},
  };
  const selectionE3 = {
    type: "FACE",
    name: "SM.F18:FLAT:SM.TAB3:flat_root:SIDE:SM.TAB3:flat_root:e3",
    parentSolid: carrier,
    userData: {},
  };

  const result = runSheetMetalCornerFillet({
    sourceCarrier: carrier,
    selections: [selectionE2, selectionE3],
    edgeSelections: [],
    radius: 1,
    resolution: 32,
    featureID: "SM.TEST.FILLET.SELECT",
    showFlatPattern: false,
  });

  if (!result?.handled) {
    throw new Error("runSheetMetalCornerFillet did not handle a valid sheet-metal source.");
  }
  if (Number(result?.summary?.applied || 0) < 1) {
    throw new Error("Selection-based corner fillet did not resolve selected side faces.");
  }
  if (!result?.root || typeof result.root._manifoldize !== "function") {
    throw new Error("Selection-based corner fillet did not produce a manifold-capable result.");
  }

  try {
    result.root._manifoldize();
  } catch (error) {
    const message = String(error?.message || error || "Unknown manifold error");
    throw new Error(`sheetMetal_corner_fillet_selection_resolution manifoldization failed: ${message}`);
  }

  return partHistory;
}

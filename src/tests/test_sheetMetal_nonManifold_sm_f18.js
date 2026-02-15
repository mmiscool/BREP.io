import {
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import {
  sheetMetalNonManifoldSmF18Fixture,
} from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

export async function test_sheetMetal_nonManifold_sm_f18(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const { featureID, tree, rootTransform } = sheetMetalNonManifoldSmF18Fixture;
  const result = __test_buildRenderableSheetModelFromTree({
    featureID,
    tree,
    rootMatrix: rootTransform,
    showFlatPattern: false,
  });

  const solid = result?.root || null;
  if (!solid || typeof solid._manifoldize !== "function") {
    throw new Error("Sheet-metal fixture did not produce a solid with manifold support.");
  }

  try {
    solid._manifoldize();
  } catch (error) {
    const message = String(error?.message || error || "Unknown manifold error");
    throw new Error(`sheetMetal_nonManifold_sm_f18 failed manifoldization: ${message}`);
  }

  const faces = typeof solid.getFaces === "function" ? (solid.getFaces(false) || []) : [];
  if (!Array.isArray(faces) || faces.length === 0) {
    throw new Error("sheetMetal_nonManifold_sm_f18 produced an empty solid.");
  }

  return partHistory;
}

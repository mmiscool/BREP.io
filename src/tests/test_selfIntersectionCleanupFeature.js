import { Solid } from "../BREP/BetterSolid.js";
import { SelfIntersectionCleanupFeature } from "../features/selfIntersectionCleanup/SelfIntersectionCleanupFeature.js";
import { isFeatureAllowedInWorkbench } from "../workbenches/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

export async function test_self_intersection_cleanup_feature_splits_selected_solid() {
  const target = new Solid();
  target.name = "SELF_INTERSECTION_SOURCE";
  target.addTriangle("A", [0, 0, 0], [2, 0, 0], [0, 2, 0]);
  target.addTriangle("B", [0.5, -0.25, -1], [0.5, 1.5, 1], [0.5, 1.5, -1]);

  const fakeHistory = {
    scene: {
      getObjectByName(name) {
        return name === target.name ? target : null;
      },
    },
  };

  const feature = new SelfIntersectionCleanupFeature();
  feature.inputParams = {
    targetSolid: target.name,
    removeInternal: false,
    validate: false,
    maxPasses: 1,
  };

  const effects = await feature.run(fakeHistory);
  const result = effects?.added?.[0] || null;
  assert(result && result.type === "SOLID", "[self-intersection feature] Expected a replacement solid.");
  assert(effects.removed?.[0] === target, "[self-intersection feature] Expected the selected solid to be removed.");
  assert(result._triVerts.length / 3 > target._triVerts.length / 3, "[self-intersection feature] Expected self-intersection splitting to add triangles.");
  assert(result._triIDs.length === result._triVerts.length / 3, "[self-intersection feature] Face IDs must stay per-triangle.");
  assert(feature.persistentData.cleanupReport?.intersectionsFound === 1, "[self-intersection feature] Expected cleanup report to record the detected intersection.");
}

export async function test_self_intersection_cleanup_feature_context_button_for_single_solid() {
  const target = new Solid();
  target.name = "CTX_SELF_INTERSECTION_SOURCE";

  const result = SelfIntersectionCleanupFeature.showContexButton([target]);
  assert(result && result.params?.targetSolid === target.name, "[self-intersection feature] Expected context action to prefill targetSolid.");
}

export async function test_self_intersection_cleanup_feature_is_available_in_modeling_and_surfacing() {
  assert(isFeatureAllowedInWorkbench(SelfIntersectionCleanupFeature, "MODELING"), "[self-intersection feature] Expected Modeling workbench availability.");
  assert(isFeatureAllowedInWorkbench(SelfIntersectionCleanupFeature, "SURFACING"), "[self-intersection feature] Expected Surfacing workbench availability.");
}

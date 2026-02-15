import {
  __test_applyCornerFilletsToTree,
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import {
  sheetMetalNonManifoldSmF18Fixture,
} from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

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

function findEdgeById(flat, edgeId) {
  const edges = Array.isArray(flat?.edges) ? flat.edges : [];
  return edges.find((edge) => String(edge?.id) === String(edgeId)) || null;
}

function polylineLength2(polyline) {
  const points = Array.isArray(polyline) ? polyline : [];
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot((b[0] - a[0]), (b[1] - a[1]));
  }
  return length;
}

export async function test_sheetMetal_corner_fillet(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const fixtureTree = clone(sheetMetalNonManifoldSmF18Fixture.tree);
  const baseFlat = findFlatById(fixtureTree.root, "SM.TAB3:flat_root");
  if (!baseFlat) throw new Error("Fixture flat SM.TAB3:flat_root not found.");

  const baseEdge = findEdgeById(baseFlat, "SM.TAB3:flat_root:e2");
  if (!baseEdge) throw new Error("Fixture edge SM.TAB3:flat_root:e2 not found.");

  const beforeOutlineCount = Array.isArray(baseFlat.outline) ? baseFlat.outline.length : 0;
  const beforeEdgeLength = polylineLength2(baseEdge.polyline);

  const applied = __test_applyCornerFilletsToTree({
    tree: fixtureTree,
    featureID: "SM.TEST.FILLET",
    targets: [{
      flatId: "SM.TAB3:flat_root",
      edgeId: "SM.TAB3:flat_root:e2",
    }],
    radius: 1.2,
    resolution: 48,
  });

  if (Number(applied?.summary?.applied || 0) < 1) {
    throw new Error("Corner fillet did not apply to the target edge.");
  }
  if (Number(applied?.summary?.appliedCorners || 0) < 1) {
    throw new Error("Corner fillet did not apply to any corners.");
  }

  const flatAfter = findFlatById(applied.tree?.root, "SM.TAB3:flat_root");
  if (!flatAfter) throw new Error("Updated fixture flat SM.TAB3:flat_root not found.");
  const afterOutlineCount = Array.isArray(flatAfter.outline) ? flatAfter.outline.length : 0;
  if (!(afterOutlineCount > beforeOutlineCount)) {
    throw new Error("Corner fillet did not add rounded vertices to the flat outline.");
  }

  const edgeAfter = findEdgeById(flatAfter, "SM.TAB3:flat_root:e2");
  if (!edgeAfter) throw new Error("Updated edge SM.TAB3:flat_root:e2 not found.");
  const afterEdgeLength = polylineLength2(edgeAfter.polyline);
  if (!(afterEdgeLength + 1e-6 < beforeEdgeLength)) {
    throw new Error("Corner fillet did not trim the selected edge span.");
  }

  const built = __test_buildRenderableSheetModelFromTree({
    featureID: "SM.TEST.FILLET",
    tree: applied.tree,
    rootMatrix: sheetMetalNonManifoldSmF18Fixture.rootTransform,
    showFlatPattern: false,
  });
  const solid = built?.root || null;
  if (!solid || typeof solid._manifoldize !== "function") {
    throw new Error("Corner-fillet tree did not build a manifold-capable solid.");
  }

  try {
    solid._manifoldize();
  } catch (error) {
    const message = String(error?.message || error || "Unknown manifold error");
    throw new Error(`sheetMetal_corner_fillet failed manifoldization: ${message}`);
  }

  return partHistory;
}

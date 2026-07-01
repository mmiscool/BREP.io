import {
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import * as THREE from "three";

function countFlatPatternPreviewGroups(solid) {
  if (!solid || !Array.isArray(solid.children)) return 0;
  return solid.children.filter((child) => (
    child?.userData?.sheetMetalFlatPattern === true
    || String(child?.name || "").endsWith(":2D")
  )).length;
}

function getFlatPatternPreviewCenterX(solid) {
  const preview = solid?.children?.find?.((child) => (
    child?.userData?.sheetMetalFlatPattern === true
    || String(child?.name || "").endsWith(":2D")
  ));
  if (!preview) return null;
  const box = new THREE.Box3().setFromObject(preview);
  if (box.isEmpty()) return null;
  return (box.min.x + box.max.x) * 0.5;
}

export async function test_sheetMetal_flat_pattern_preview_visualize_is_idempotent() {
  const featureID = "SM.PREVIEW";
  const flatId = `${featureID}:flat_root`;
  const tree = {
    thickness: 2,
    root: {
      kind: "flat",
      id: flatId,
      label: "Preview Root",
      outline: [
        [0, 0],
        [40, 0],
        [40, 20],
        [0, 20],
      ],
      edges: [
        { id: `${flatId}:e1`, polyline: [[0, 0], [40, 0]] },
        { id: `${flatId}:e2`, polyline: [[40, 0], [40, 20]] },
        { id: `${flatId}:e3`, polyline: [[40, 20], [0, 20]] },
        { id: `${flatId}:e4`, polyline: [[0, 20], [0, 0]] },
      ],
    },
  };

  const { root: solid } = (__test_buildRenderableSheetModelFromTree as any)({
    featureID,
    tree,
    showFlatPattern: true,
  });

  await solid.visualize();
  const firstCenterX = getFlatPatternPreviewCenterX(solid);
  await solid.visualize();
  const secondCenterX = getFlatPatternPreviewCenterX(solid);
  await solid.visualize();
  const thirdCenterX = getFlatPatternPreviewCenterX(solid);

  const previewCount = countFlatPatternPreviewGroups(solid);
  if (previewCount !== 1) {
    throw new Error(`Expected one flat pattern preview after repeated visualize calls, got ${previewCount}.`);
  }
  if (
    firstCenterX == null
    || secondCenterX == null
    || thirdCenterX == null
    || Math.abs(firstCenterX - secondCenterX) > 1e-6
    || Math.abs(secondCenterX - thirdCenterX) > 1e-6
  ) {
    throw new Error(`Expected stable flat pattern preview center, got ${firstCenterX}, ${secondCenterX}, ${thirdCenterX}.`);
  }

  return solid;
}

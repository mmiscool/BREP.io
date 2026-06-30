import {
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";

function makeCircleLoop(cx, cy, radius, segments, clockwise = true) {
  const out = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const angle = clockwise ? -t : t;
    out.push([
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius,
    ]);
  }
  return out;
}

export async function test_sheetMetal_tab_circular_hole_wall() {
  const featureID = "SM_TAB_CIRCULAR_HOLE";
  const flatId = `${featureID}:flat_root`;
  const holeId = `${flatId}:hole_1`;
  const tree = {
    thickness: 3,
    root: {
      kind: "flat",
      id: flatId,
      label: "Tab Root",
      outline: [
        [0, 0],
        [80, 0],
        [80, 50],
        [0, 50],
      ],
      edges: [
        { id: `${flatId}:e1`, polyline: [[0, 0], [80, 0]] },
        { id: `${flatId}:e2`, polyline: [[80, 0], [80, 50]] },
        { id: `${flatId}:e3`, polyline: [[80, 50], [0, 50]] },
        { id: `${flatId}:e4`, polyline: [[0, 50], [0, 0]] },
      ],
      holes: [{
        id: holeId,
        outline: makeCircleLoop(40, 25, 10, 32, true),
      }],
    },
  };

  const { root: solid } = (__test_buildRenderableSheetModelFromTree as any)({
    featureID,
    tree,
    showFlatPattern: false,
  });

  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected circular-hole tab to produce a solid.");
  }
  if (!solid._isCoherentlyOrientedManifold()) {
    throw new Error("Circular-hole tab solid is not manifold.");
  }

  const cutoutFaces = solid.getFaceNames().filter((name) => (
    String(name).includes(`CUTOUT:${holeId}`)
  ));
  if (cutoutFaces.length !== 1) {
    throw new Error(`Expected one cylindrical cutout wall face, got ${cutoutFaces.length}: ${cutoutFaces.join(", ")}`);
  }

  const metadata = solid.getFaceMetadata(cutoutFaces[0]);
  if (!metadata || metadata.type !== "cylindrical") {
    throw new Error(`Expected cylindrical metadata on "${cutoutFaces[0]}".`);
  }
  if (Math.abs(metadata.radius - 10) > 1e-3) {
    throw new Error(`Expected circular-hole radius 10, got ${metadata.radius}.`);
  }

  return solid;
}

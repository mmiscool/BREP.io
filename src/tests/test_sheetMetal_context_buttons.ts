import { SheetMetalFlangeFeature } from "../features/sheetMetal/SheetMetalFlangeFeature.js";
import { SheetMetalTabFeature } from "../features/sheetMetal/SheetMetalTabFeature.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed.");
  }
}

export async function test_sheetMetal_tab_and_flange_context_buttons() {
  const sketch = {
    type: "SKETCH",
    name: "S_TAB",
    userData: {},
  };
  const sketchFace = {
    type: "FACE",
    name: "S_TAB:PROFILE",
    parent: sketch,
    userData: { faceName: "S_TAB:PROFILE" },
  };

  const sketchResult: any = SheetMetalTabFeature.showContexButton([sketch]);
  assert(sketchResult?.field === "profile", "Sketch selection should seed the tab profile field.");
  assert(sketchResult?.value === sketch, "Sketch selection should pass the sketch object for tab profile.");

  const sketchFaceResult: any = SheetMetalTabFeature.showContexButton([sketchFace]);
  assert(sketchFaceResult?.field === "profile", "Sketch face selection should seed the tab profile field.");
  assert(sketchFaceResult?.value === sketch, "Sketch face selection should promote to the owning sketch for tab profile.");

  assert(
    SheetMetalTabFeature.showContexButton([{ type: "FACE", name: "BODY:FACE", userData: {} }]) === false,
    "Plain model faces should not show the sheet metal tab context button.",
  );

  const carrier = {
    type: "SOLID",
    name: "SM_BODY",
    userData: { sheetMetalModel: { tree: { root: { id: "flat_root" } } } },
    getEdgeMetadata(name) {
      if (name !== "SM_BODY:EDGE") return null;
      return {
        sheetMetal: {
          kind: "edge",
          flatId: "flat_root",
          edgeId: "flat_root:e1",
        },
      };
    },
  };
  const thicknessFace = {
    type: "FACE",
    name: "SM_BODY:SIDE",
    parent: carrier,
    userData: {
      sheetMetal: {
        kind: "flat_edge_wall",
        flatId: "flat_root",
        edgeId: "flat_root:e1",
      },
    },
  };
  const edge = {
    type: "EDGE",
    name: "SM_BODY:EDGE",
    parent: carrier,
    userData: {},
  };
  const plainEdge = {
    type: "EDGE",
    name: "PLAIN:EDGE",
    userData: {},
  };

  const faceResult: any = SheetMetalFlangeFeature.showContexButton([thicknessFace]);
  assert(faceResult?.field === "faces", "Sheet-metal thickness face should seed the flange faces field.");
  assert(faceResult?.value?.[0] === thicknessFace, "Sheet-metal thickness face should be passed to the flange feature.");

  const edgeResult: any = SheetMetalFlangeFeature.showContexButton([edge]);
  assert(edgeResult?.field === "faces", "Sheet-metal edge should seed the flange faces field.");
  assert(edgeResult?.value?.[0] === edge, "Sheet-metal edge should be passed to the flange feature.");

  assert(
    SheetMetalFlangeFeature.showContexButton([plainEdge]) === false,
    "Plain edges should not show the sheet metal flange context button.",
  );
  assert(
    SheetMetalFlangeFeature.showContexButton([sketchFace]) === false,
    "Sketch faces should not show the sheet metal flange context button.",
  );
}

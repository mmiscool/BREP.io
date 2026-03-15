import { SheetMetalCutoutFeature } from "../features/sheetMetal/SheetMetalCutoutFeature.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed.");
  }
}

export async function test_sheetMetal_cutout_context_button() {
  const sketch = {
    type: "SKETCH",
    name: "SK_001",
  };
  const sketchFace = {
    type: "FACE",
    name: "SK_001:PROFILE",
    parent: sketch,
  };
  const solid = {
    type: "SOLID",
    name: "CUTTER_001",
  };
  const plainFace = {
    type: "FACE",
    name: "BODY:FACE_1",
  };

  const sketchResult = SheetMetalCutoutFeature.showContexButton([sketch]);
  assert(sketchResult?.field === "profile", "Sketch selection should target the profile field.");
  assert(sketchResult?.value === "SK_001", "Sketch selection should seed the sketch name.");

  const sketchFaceResult = SheetMetalCutoutFeature.showContexButton([sketchFace]);
  assert(sketchFaceResult?.field === "profile", "Sketch-face selection should target the profile field.");
  assert(sketchFaceResult?.value === "SK_001:PROFILE", "Sketch-face selection should seed the selected face name.");

  const solidResult = SheetMetalCutoutFeature.showContexButton([solid]);
  assert(solidResult?.field === "profile", "Solid selection should target the profile field.");
  assert(solidResult?.value === "CUTTER_001", "Solid selection should seed the selected solid name.");

  assert(
    SheetMetalCutoutFeature.showContexButton([plainFace]) === false,
    "Non-sketch faces should not show the sheet metal cutout context button.",
  );
  assert(
    SheetMetalCutoutFeature.showContexButton([sketchFace, solid]) === false,
    "Multiple selections should not show the sheet metal cutout context button.",
  );
}

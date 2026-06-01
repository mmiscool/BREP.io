import { SheetMetalContourFlangeFeature } from "../features/sheetMetal/SheetMetalContourFlangeFeature.js";

export async function test_sheetMetal_contour_flange_whole_sketch_selection(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const sketch = await partHistory.newFeature("S");
  sketch.inputParams.id = "S_CF_PATH";
  sketch.inputParams.featureID = "S_CF_PATH";
  sketch.persistentData.sketch = {
    points: [
      { id: 0, x: 0, y: 0, fixed: true },
      { id: 1, x: 20, y: 0, fixed: false },
      { id: 2, x: 20, y: 10, fixed: false },
      { id: 3, x: 35, y: 10, fixed: false },
    ],
    geometries: [
      { id: 1, type: "line", points: [0, 1], construction: false },
      { id: 2, type: "line", points: [1, 2], construction: false },
      { id: 3, type: "line", points: [2, 3], construction: false },
    ],
    constraints: [
      { id: 0, type: "⏚", points: [0] },
    ],
  };

  const contour = await partHistory.newFeature("SM.CF");
  Object.assign(contour.inputParams, {
    id: "SM_CF_FROM_SKETCH",
    path: ["S_CF_PATH"],
    distance: 12,
    thickness: 1.5,
    bendRadius: 2,
    consumePathSketch: false,
  });
}

export async function afterRun_sheetMetal_contour_flange_whole_sketch_selection(partHistory) {
  const contour = partHistory.features.find((entry) => entry?.inputParams?.id === "SM_CF_FROM_SKETCH");
  const status = contour?.persistentData?.sheetMetal?.status || null;
  if (status !== "ok") {
    throw new Error(`Expected contour flange from whole sketch to succeed, got ${status || "null"}.`);
  }

  const summary = contour?.persistentData?.sheetMetal?.contourSummary || null;
  if (!summary || summary.segmentCount !== 3 || summary.bendCount !== 2) {
    throw new Error(`Expected 3 contour segments and 2 bends, got ${JSON.stringify(summary)}.`);
  }

  const solid = partHistory.getObjectByName("SM_CF_FROM_SKETCH");
  if (!solid || String(solid.type || "").toUpperCase() !== "SOLID") {
    throw new Error("Expected contour flange solid generated from whole sketch selection.");
  }
}

export async function test_sheetMetal_contour_flange_context_button_prefers_sketch() {
  const sketch = { type: "SKETCH", name: "S_PATH", userData: {} };
  const edge = { type: "EDGE", name: "S_PATH:G1", parent: sketch, userData: {} };
  const face = { type: "FACE", name: "S_PATH:PROFILE", parent: sketch, userData: { faceName: "S_PATH:PROFILE" } };
  const modelEdge = { type: "EDGE", name: "MODEL:edge", userData: {} };

  const sketchResult = SheetMetalContourFlangeFeature.showContexButton([sketch]);
  if (!sketchResult || sketchResult.field !== "path" || sketchResult.value?.[0] !== "S_PATH") {
    throw new Error("Expected contour flange context action to use selected sketch.");
  }

  const edgeResult = SheetMetalContourFlangeFeature.showContexButton([edge]);
  if (!edgeResult || edgeResult.value?.[0] !== "S_PATH") {
    throw new Error("Expected contour flange context action to promote sketch edge to parent sketch.");
  }

  const faceResult = SheetMetalContourFlangeFeature.showContexButton([face]);
  if (!faceResult || faceResult.value?.[0] !== "S_PATH") {
    throw new Error("Expected contour flange context action to promote sketch face to parent sketch.");
  }

  const modelEdgeResult = SheetMetalContourFlangeFeature.showContexButton([modelEdge]);
  if (!modelEdgeResult || modelEdgeResult.value?.[0] !== "MODEL:edge") {
    throw new Error("Expected contour flange context action to preserve standalone edge selection.");
  }
}

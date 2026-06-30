function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed.");
  }
}

export async function test_sheetMetal_cutout_preserves_multiple_profile_loops(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const baseSketch = await partHistory.newFeature("S");
  Object.assign(baseSketch.inputParams, {
    id: "S_SM_MULTI_BASE",
    sketchPlane: null,
    editSketch: null,
    curveResolution: 32,
  });
  baseSketch.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true },
        { id: 1, x: -8, y: -5, fixed: false, construction: false },
        { id: 2, x: 8, y: -5, fixed: false, construction: false },
        { id: 3, x: 8, y: 5, fixed: false, construction: false },
        { id: 4, x: -8, y: 5, fixed: false, construction: false },
      ],
      geometries: [
        { id: 1, type: "line", points: [1, 2], construction: false },
        { id: 2, type: "line", points: [2, 3], construction: false },
        { id: 3, type: "line", points: [3, 4], construction: false },
        { id: 4, type: "line", points: [4, 1], construction: false },
      ],
      constraints: [{ id: 0, type: "⏚", points: [0] }],
    },
  };

  const tab = await partHistory.newFeature("SM.TAB");
  Object.assign(tab.inputParams, {
    id: "SM_MULTI_TAB",
    profile: "S_SM_MULTI_BASE",
    thickness: 0.125,
    placementMode: "forward",
    bendRadius: 0.125,
    neutralFactor: 0.5,
    consumeProfileSketch: false,
  });

  const cutSketch = await partHistory.newFeature("S");
  Object.assign(cutSketch.inputParams, {
    id: "S_SM_MULTI_CUT",
    sketchPlane: "SM_MULTI_TAB:FLAT:SM_MULTI_TAB:flat_root:A",
    editSketch: null,
    curveResolution: 24,
  });
  cutSketch.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true },
        { id: 1, x: -4.5, y: 2.5, fixed: false, construction: false },
        { id: 2, x: -3.8, y: 2.5, fixed: false, construction: false },
        { id: 3, x: 0, y: 2.5, fixed: false, construction: false },
        { id: 4, x: 0.8, y: 2.5, fixed: false, construction: false },
        { id: 5, x: 4.5, y: 2.5, fixed: false, construction: false },
        { id: 6, x: 5.1, y: 2.5, fixed: false, construction: false },
        { id: 7, x: -1.2, y: -3.2, fixed: false, construction: false },
        { id: 8, x: 1.2, y: -3.2, fixed: false, construction: false },
        { id: 9, x: 1.2, y: -1.4, fixed: false, construction: false },
        { id: 10, x: -1.2, y: -1.4, fixed: false, construction: false },
      ],
      geometries: [
        { id: 1, type: "circle", points: [1, 2], construction: false },
        { id: 2, type: "circle", points: [3, 4], construction: false },
        { id: 3, type: "circle", points: [5, 6], construction: false },
        { id: 4, type: "line", points: [7, 8], construction: false },
        { id: 5, type: "line", points: [8, 9], construction: false },
        { id: 6, type: "line", points: [9, 10], construction: false },
        { id: 7, type: "line", points: [10, 7], construction: false },
      ],
      constraints: [{ id: 0, type: "⏚", points: [0] }],
    },
  };

  const cutout = await partHistory.newFeature("SM.CUTOUT");
  Object.assign(cutout.inputParams, {
    id: "SM_MULTI_CUTOUT",
    sheet: "SM_MULTI_TAB",
    profile: "S_SM_MULTI_CUT:PROFILE",
    consumeProfileSketch: false,
    forwardDistance: 1,
    backDistance: 1,
    keepTool: true,
    debugCutter: true,
  });
}

export async function afterRun_sheetMetal_cutout_preserves_multiple_profile_loops(partHistory) {
  const cutout = partHistory.features.find((entry) => entry?.inputParams?.id === "SM_MULTI_CUTOUT");
  const sheetMetal = cutout?.persistentData?.sheetMetal || null;
  assert(sheetMetal?.status === "ok", `Expected sheet-metal cutout status ok, got ${sheetMetal?.status || "null"}.`);

  const treeSummary = sheetMetal?.cutoutSummary?.tree || null;
  assert(treeSummary?.requestedLoops === 4, `Expected 4 requested cut loops, got ${treeSummary?.requestedLoops}.`);
  assert(treeSummary?.applied === 4, `Expected 4 applied cut loops, got ${treeSummary?.applied}.`);

  const rootHoles = Array.isArray(sheetMetal?.tree?.root?.holes) ? sheetMetal.tree.root.holes : [];
  assert(rootHoles.length === 4, `Expected 4 sheet-metal root holes, got ${rootHoles.length}.`);

  const cutter = partHistory.getObjectByName("SM_MULTI_CUTOUT:CUTTER");
  assert(cutter, "Expected debug cutter to be kept in scene.");
}

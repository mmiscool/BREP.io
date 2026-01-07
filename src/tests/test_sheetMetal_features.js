const makeRectSketch = (x0, y0, x1, y1, geomBase = 100) => ({
  points: [
    { id: 0, x: x0, y: y0, fixed: true },
    { id: 1, x: x1, y: y0, fixed: false },
    { id: 2, x: x1, y: y1, fixed: false },
    { id: 3, x: x0, y: y1, fixed: false },
  ],
  geometries: [
    { id: geomBase + 0, type: "line", points: [0, 1], construction: false },
    { id: geomBase + 1, type: "line", points: [1, 2], construction: false },
    { id: geomBase + 2, type: "line", points: [2, 3], construction: false },
    { id: geomBase + 3, type: "line", points: [3, 0], construction: false },
  ],
  constraints: [{ id: 0, type: "⏚", points: [0] }],
});

async function buildBaseTab(partHistory, { size = 10, thickness = 1, geomBase = 100 } = {}) {
  const plane = await partHistory.newFeature("P");
  plane.inputParams.orientation = "XY";

  const sketch = await partHistory.newFeature("S");
  sketch.inputParams.sketchPlane = plane.inputParams.featureID;
  sketch.persistentData.sketch = makeRectSketch(0, 0, size, size, geomBase);

  const tab = await partHistory.newFeature("SM.TAB");
  tab.inputParams.profile = sketch.inputParams.featureID;
  tab.inputParams.thickness = thickness;
  tab.inputParams.consumeProfileSketch = false;

  const edgeFaceName = `${tab.inputParams.featureID}:${sketch.inputParams.featureID}:G${geomBase}_SW`;
  return { plane, sketch, tab, edgeFaceName };
}

export async function test_sheetMetal_tab(partHistory) {
  await buildBaseTab(partHistory, { size: 12, thickness: 1, geomBase: 100 });
  return partHistory;
}

export async function test_sheetMetal_flange(partHistory) {
  const { edgeFaceName } = await buildBaseTab(partHistory, { size: 16, thickness: 1, geomBase: 100 });

  const flange = await partHistory.newFeature("SM.F");
  flange.inputParams.faces = [edgeFaceName];
  flange.inputParams.angle = 90;

  return partHistory;
}

export async function test_sheetMetal_hem(partHistory) {
  const { edgeFaceName } = await buildBaseTab(partHistory, { size: 14, thickness: 1, geomBase: 110 });

  const hem = await partHistory.newFeature("SM.HEM");
  hem.inputParams.faces = [edgeFaceName];

  return partHistory;
}

export async function test_sheetMetal_cutout(partHistory) {
  const sheetSize = 20;
  const { tab } = await buildBaseTab(partHistory, { size: sheetSize, thickness: 1, geomBase: 100 });

  const datum = await partHistory.newFeature("D");
  datum.inputParams.transform = {
    position: [sheetSize / 2, sheetSize / 2, 0],
    rotationEuler: [45, 0, 0],
    scale: [1, 1, 1],
  };

  const cutSketch = await partHistory.newFeature("S");
  cutSketch.inputParams.sketchPlane = `${datum.inputParams.featureID}:XY`;
  cutSketch.persistentData.sketch = makeRectSketch(-2, -2, 2, 2, 200);

  const cutout = await partHistory.newFeature("SM.CUTOUT");
  cutout.inputParams.sheet = tab.inputParams.featureID;
  cutout.inputParams.profile = cutSketch.inputParams.featureID;
  cutout.inputParams.forwardDistance = 5;
  cutout.inputParams.backDistance = 5;

  return partHistory;
}

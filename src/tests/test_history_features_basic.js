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

const makeLineSketch = (ax, ay, bx, by, geomId = 200) => ({
  points: [
    { id: 0, x: ax, y: ay, fixed: true },
    { id: 1, x: bx, y: by, fixed: false },
  ],
  geometries: [{ id: geomId, type: "line", points: [0, 1], construction: false }],
  constraints: [{ id: 0, type: "⏚", points: [0] }],
});

export async function test_history_features_basic(partHistory) {
  const datum = await partHistory.newFeature("D");
  datum.inputParams.transform = {
    position: [1, 2, 3],
    rotationEuler: [0, 30, 0],
    scale: [1, 1, 1],
  };

  const spline = await partHistory.newFeature("SP");
  spline.persistentData.spline = {
    points: [
      { id: "p0", position: [0, 0, 0], forwardDistance: 1, backwardDistance: 1, flipDirection: false },
      { id: "p1", position: [5, 2, 0], forwardDistance: 1, backwardDistance: 1, flipDirection: false },
      { id: "p2", position: [10, 0, 0], forwardDistance: 1, backwardDistance: 1, flipDirection: false },
    ],
  };

  const helix = await partHistory.newFeature("HX");
  helix.inputParams.radius = 2;
  helix.inputParams.endRadius = 1.5;
  helix.inputParams.height = 8;
  helix.inputParams.turns = 2;
  helix.inputParams.resolution = 32;

  const planeA = await partHistory.newFeature("P");
  planeA.inputParams.orientation = "XY";
  const planeB = await partHistory.newFeature("P");
  planeB.inputParams.orientation = "XY";
  planeB.inputParams.offset_distance = 5;

  const loftSketchA = await partHistory.newFeature("S");
  loftSketchA.inputParams.sketchPlane = planeA.inputParams.featureID;
  loftSketchA.persistentData.sketch = makeRectSketch(0, 0, 10, 10, 100);

  const loftSketchB = await partHistory.newFeature("S");
  loftSketchB.inputParams.sketchPlane = planeB.inputParams.featureID;
  loftSketchB.persistentData.sketch = makeRectSketch(2, 2, 8, 8, 200);

  const loft = await partHistory.newFeature("LOFT");
  loft.inputParams.profiles = [
    loftSketchA.inputParams.featureID,
    loftSketchB.inputParams.featureID,
  ];

  const axisSketch = await partHistory.newFeature("S");
  axisSketch.inputParams.sketchPlane = planeA.inputParams.featureID;
  axisSketch.persistentData.sketch = makeLineSketch(0, -5, 0, 5, 300);
  const axisEdgeName = `${axisSketch.inputParams.featureID}:G300`;

  const revolveSketch = await partHistory.newFeature("S");
  revolveSketch.inputParams.sketchPlane = planeA.inputParams.featureID;
  revolveSketch.persistentData.sketch = makeRectSketch(4, -2, 7, 2, 400);

  const revolve = await partHistory.newFeature("R");
  revolve.inputParams.profile = revolveSketch.inputParams.featureID;
  revolve.inputParams.axis = axisEdgeName;
  revolve.inputParams.angle = 180;
  revolve.inputParams.resolution = 32;

  const remeshBase = await partHistory.newFeature("P.CU");
  const remesh = await partHistory.newFeature("RM");
  remesh.inputParams.targetSolid = remeshBase.inputParams.featureID;
  remesh.inputParams.mode = "Simplify";
  remesh.inputParams.tolerance = 0.05;

  const xformBase = await partHistory.newFeature("P.CU");
  const xform = await partHistory.newFeature("XFORM");
  xform.inputParams.solids = [xformBase.inputParams.featureID];
  xform.inputParams.translate = [2, 0, 0];
  xform.inputParams.rotateEulerDeg = [0, 0, 45];
  xform.inputParams.copy = true;

  const overlapBase = await partHistory.newFeature("P.CU");
  const overlap = await partHistory.newFeature("OVL");
  overlap.inputParams.targetSolid = overlapBase.inputParams.featureID;
  overlap.inputParams.distance = 0.0005;

  const patLinBase = await partHistory.newFeature("P.CU");
  const patLin = await partHistory.newFeature("PATLIN");
  patLin.inputParams.solids = [patLinBase.inputParams.featureID];
  patLin.inputParams.count = 3;
  patLin.inputParams.offset = { position: [3, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] };

  const patRadBase = await partHistory.newFeature("P.CU");
  const patRad = await partHistory.newFeature("PATRAD");
  patRad.inputParams.solids = [patRadBase.inputParams.featureID];
  patRad.inputParams.axisRef = axisEdgeName;
  patRad.inputParams.count = 4;
  patRad.inputParams.totalAngleDeg = 180;

  const patLegacyBase = await partHistory.newFeature("P.CU");
  const patLegacy = await partHistory.newFeature("PATTERN");
  patLegacy.inputParams.solids = [patLegacyBase.inputParams.featureID];
  patLegacy.inputParams.mode = "LINEAR";
  patLegacy.inputParams.count = 2;

  const acomp = await partHistory.newFeature("ACOMP");
  acomp.inputParams.componentName = "missing_component";

  const image = await partHistory.newFeature("IMAGE");
  image.inputParams.fileToImport = "";

  const heightmap = await partHistory.newFeature("HEIGHTMAP");
  heightmap.inputParams.fileToImport = "";

  return partHistory;
}

export async function afterRun_history_features_basic(partHistory) {
  const requireFeatureObject = (type, label) => {
    const entry = partHistory.features.find((f) => f?.type === type);
    if (!entry) throw new Error(`${label} feature missing from history`);
    const fid = entry?.inputParams?.featureID;
    if (!fid) throw new Error(`${label} feature missing featureID`);
    const obj = partHistory.scene.getObjectByName(fid);
    if (!obj) throw new Error(`${label} object not found in scene`);
  };

  requireFeatureObject("D", "Datium");
  requireFeatureObject("SP", "Spline");
  requireFeatureObject("HX", "Helix");
  requireFeatureObject("LOFT", "Loft");
  requireFeatureObject("R", "Revolve");
}

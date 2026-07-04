import { PartHistory } from '../PartHistory.js';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

export async function test_cam_shadow_cutter_generated_history_20260704000935_keeps_outer_loop() {
  const partHistory = new PartHistory();
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("P.CU");
  Object.assign(feature1.inputParams, {
    id: "P.CU1",
    sizeX: 10,
    sizeY: 10,
    sizeZ: 10,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: [],
      operation: "NONE",
      overlapConditioningEnabled: true,
    },
  });

  const feature2 = await partHistory.newFeature("S");
  Object.assign(feature2.inputParams, {
    id: "S2",
    sketchPlane: "P.CU1_PY",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  feature2.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: 1.116238, y: -2.608167, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: "circle", points: [0, 1], construction: false },
      ],
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
      ],
    },
  };

  const feature3 = await partHistory.newFeature("E");
  Object.assign(feature3.inputParams, {
    id: "E3",
    profile: "S2:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: {
      targets: ["P.CU1"],
      operation: "SUBTRACT",
      overlapConditioningEnabled: true,
    },
  });

  const feature4 = await partHistory.newFeature("CH");
  Object.assign(feature4.inputParams, {
    id: "CH4",
    edges: ["E3:S2:G1_SW|P.CU1_PY[0]"],
    distance: 1,
    inflate: 0.1,
    direction: "AUTO",
    debug: "NONE",
  });

  const feature5 = await partHistory.newFeature("S");
  Object.assign(feature5.inputParams, {
    id: "S5",
    sketchPlane: "P.CU1_PX",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  feature5.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 1.345003, y: 6.007376, fixed: false, construction: false, externalReference: false },
        { id: 4, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 5, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 6, x: -7.869525, y: 8.202379, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -7.869525, y: 8.202379, fixed: false, construction: false, externalReference: false },
        { id: 8, x: 1.345003, y: 6.007376, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: "line", points: [1, 2], construction: false },
        { id: 3, type: "line", points: [5, 6], construction: false },
        { id: 4, type: "line", points: [7, 8], construction: false },
      ],
      constraints: [
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
        { id: 2, type: "≡", points: [1, 4], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "1:-5.948429,-1.76656,0;4:-5.948429,-1.76656,0;" },
        { id: 3, type: "≡", points: [4, 5], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "4:-5.948429,-1.76656,0;5:-5.948429,-1.76656,0;" },
        { id: 4, type: "≡", points: [6, 7], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "6:-7.869525,8.202379,0;7:-7.869525,8.202379,0;" },
        { id: 5, type: "≡", points: [2, 8], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "solved", error: null, _previousSolveValue: null, previousPointValues: "2:1.345003,6.007376,0;8:1.345003,6.007376,0;" },
      ],
    },
  };

  const feature6 = await partHistory.newFeature("E");
  Object.assign(feature6.inputParams, {
    id: "E6",
    profile: "S5:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: {
      targets: ["P.CU1"],
      operation: "SUBTRACT",
      overlapConditioningEnabled: true,
    },
  });

  const feature7 = await partHistory.newFeature("P.CY");
  Object.assign(feature7.inputParams, {
    id: "P.CY8",
    radius: 5,
    height: 10,
    resolution: "resolution",
    transform: {
      position: [3.900050910184973, 0, 13.054629944047662],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["P.CU1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  partHistory.camPlanManager.loadSerializable({
    operations: [{
      type: "shadow-cutter",
      inputParams: {
        id: "SC333",
        targetSolids: ["P.CU1"],
        toolDiameter: "3",
      },
    }],
    machineProfile: {
      name: "Generic 3 Axis Mill",
      controller: "grbl",
      units: "mm",
      maxSpindleRPM: 24000,
      defaultRapidRate: 2500,
      safeParkZ: 15,
      tokenSpacer: true,
      stripComments: false,
      header: "",
      footer: "",
    },
    stockProfile: {
      mode: "auto",
      margin: 6.35,
      sizeX: null,
      sizeY: null,
      sizeZ: null,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });
  const program = partHistory.camPlanManager.generateAll();
  const outerPaths = program.paths.filter((path) => path.metadata?.loopRole === 'outer');
  const holePaths = program.paths.filter((path) => path.metadata?.loopRole === 'hole');
  assert(outerPaths.length >= 1, 'Generated history should produce an outside Shadow Cutter path');
  assert(holePaths.length >= 1, 'Generated history should produce an inside-hole Shadow Cutter path');
}

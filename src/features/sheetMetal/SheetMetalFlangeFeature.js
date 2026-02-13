const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the flange feature",
  },
  faces: {
    type: "reference_selection",
    selectionFilter: ["FACE"],
    multiple: true,
    default_value: null,
    hint: "Select one or more thin side faces where the flange will be constructed.",
  },
  useOppositeCenterline: {
    label: "Reverse direction",
    type: "boolean",
    default_value: false,
    hint: "Flip the fold direction (up/down) for the selected hinge.",
  },
  flangeLength: {
    type: "number",
    default_value: 10,
    min: 0,
    hint: "Placeholder: retained for UI compatibility (currently unused).",
  },
  flangeLengthReference: {
    type: "options",
    options: ["inside", "outside", "web"],
    default_value: "outside",
    hint: "Placeholder: retained for UI compatibility (currently unused).",
  },
  angle: {
    type: "number",
    default_value: 90,
    min: 0,
    max: 180,
    hint: "Flange angle relative to the parent sheet (0° = flat, 90° = perpendicular).",
  },
  inset: {
    type: "options",
    options: ["material_inside", "material_outside", "bend_outside"],
    default_value: "material_inside",
    hint: "Placeholder: retained for UI compatibility (currently unused).",
  },
  reliefWidth: {
    type: "number",
    default_value: 0,
    step: 0.1,
    min: 0,
    hint: "Placeholder reserved for future relief cut options.",
  },
  bendRadius: {
    type: "number",
    default_value: 0,
    min: 0,
    hint: "Placeholder reserved for future bend radius overrides.",
  },
  offset: {
    type: "number",
    default_value: 0,
    hint: "Placeholder reserved for future offset support.",
  },
  debugSkipUnion: {
    type: "boolean",
    default_value: false,
    hint: "Debug: Skip boolean union with the parent sheet metal.",
  },
};

function buildStubPersistentData(instance) {
  const featureID = instance?.inputParams?.featureID ?? instance?.inputParams?.id ?? null;
  return {
    ...(instance?.persistentData || {}),
    sheetMetal: {
      stubbed: true,
      feature: instance?.constructor?.shortName || instance?.constructor?.name || "SheetMetal",
      featureID,
      message: "Sheet metal execution is intentionally disabled.",
    },
  };
}

export class SheetMetalFlangeFeature {
  static shortName = "SM.F";
  static longName = "Sheet Metal Flange";
  static inputParamsSchema = inputParamsSchema;
  static baseType = "FLANGE";
  static logTag = "SheetMetalFlange";
  static defaultAngle = 90;
  static angleOverride = null;
  static defaultBendRadius = null;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run() {
    this.persistentData = buildStubPersistentData(this);
    return { added: [], removed: [] };
  }
}

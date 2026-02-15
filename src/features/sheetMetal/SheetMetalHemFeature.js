import { runSheetMetalFlange } from "./sheetMetalEngineBridge.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the hem feature",
  },
  faces: {
    type: "reference_selection",
    selectionFilter: ["FACE", "EDGE"],
    multiple: true,
    default_value: null,
    hint: "Select one or more sheet-metal edge overlays where the hem will be constructed.",
  },
  useOppositeCenterline: {
    label: "Reverse direction",
    type: "boolean",
    default_value: false,
    hint: "Flip the fold direction (up/down) for the selected hinge.",
  },
  flangeLength: {
    type: "number",
    default_value: 5,
    min: 0,
    hint: "Hem leg length extending away from the bend edge.",
  },
  inset: {
    type: "options",
    options: ["material_inside", "material_outside", "bend_outside"],
    default_value: "material_inside",
    hint: "Edge shift before bend: material_inside = thickness + bendRadius, material_outside = bendRadius, bend_outside = 0.",
  },
  bendRadius: {
    type: "number",
    default_value: 0,
    min: 0,
    hint: "Inside bend radius override. Defaults to the model’s stored value.",
  },
  offset: {
    type: "number",
    default_value: 0,
    hint: "Additional signed offset for bend-edge repositioning (positive = outward, negative = inward).",
  },
};

export class SheetMetalHemFeature {
  static shortName = "SM.HEM";
  static longName = "Sheet Metal Hem";
  static inputParamsSchema = inputParamsSchema;
  static baseType = "HEM";
  static logTag = "SheetMetalHem";

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest() {
    return [];
  }

  async run(partHistory) {
    void partHistory;
    return runSheetMetalFlange(this, {
      baseType: "HEM",
      angleDeg: 180,
      defaultInsideRadius: 0.0001,
      lockAngleToAbsolute: true,
      flangeLengthReference: "web",
    });
  }
}

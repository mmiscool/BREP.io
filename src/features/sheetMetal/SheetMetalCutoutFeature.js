import { runSheetMetalCutout } from "./sheetMetalEngineBridge.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the sheet metal cutout",
  },
  sheet: {
    type: "reference_selection",
    selectionFilter: ["SOLID"],
    multiple: false,
    default_value: null,
    hint: "Target sheet metal solid to cut",
  },
  profile: {
    type: "reference_selection",
    selectionFilter: ["SOLID", "FACE", "SKETCH"],
    multiple: false,
    default_value: null,
    hint: "Solid tool or sketch/face to extrude as a cutting tool.",
  },
  consumeProfileSketch: {
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced sketch after creating the cutout. Turn off to keep it in the scene.",
  },
  forwardDistance: {
    type: "number",
    default_value: 1,
    min: 0,
    hint: "Extrude distance forward from the profile (sketch/face only).",
  },
  backDistance: {
    type: "number",
    default_value: 0,
    min: 0,
    hint: "Extrude distance backward from the profile (sketch/face only).",
  },
  keepTool: {
    type: "boolean",
    default_value: false,
    hint: "Keep the generated cutting tool in the scene (for debugging).",
  },
  debugCutter: {
    type: "boolean",
    default_value: false,
    hint: "Keep the internal cleanup cutter used for the final subtract.",
  },
};

export class SheetMetalCutoutFeature {
  static shortName = "SM.CUTOUT";
  static longName = "Sheet Metal Cutout";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
    this.debugTool = null;
  }

  uiFieldsTest() {
    return [];
  }

  async run(partHistory) {
    void partHistory;
    this.debugTool = null;
    return runSheetMetalCutout(this);
  }
}

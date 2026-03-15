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
    hint: "Target sheet metal solid to cut.",
  },
  profile: {
    type: "reference_selection",
    selectionFilter: ["SOLID", "FACE", "SKETCH"],
    multiple: false,
    default_value: null,
    hint: "Select a sketch profile or external solid/face cutter (do not pick a face from the same target sheet body).",
  },
  consumeProfileSketch: {
    label: "Consume input object",
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced input object after creating the cutout. Sketch inputs remove the sketch; solid/face inputs remove the source solid.",
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
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    if (items.length !== 1) return false;

    const pick = items[0] || null;
    const type = String(pick?.type || "").toUpperCase();
    const parentType = String(pick?.parent?.type || "").toUpperCase();
    const isSketch = type === "SKETCH";
    const isSketchFace = type === "FACE" && parentType === "SKETCH";
    const isSolid = type === "SOLID";
    if (!isSketch && !isSketchFace && !isSolid) return false;

    const name = pick?.name
      || pick?.userData?.faceName
      || pick?.userData?.solidName
      || null;
    if (!name) return false;

    return { field: "profile", value: name };
  }

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

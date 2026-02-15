import { runSheetMetalTab } from "./sheetMetalEngineBridge.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the sheet metal tab",
  },
  profile: {
    type: "reference_selection",
    selectionFilter: ["FACE", "SKETCH"],
    multiple: false,
    default_value: null,
    hint: "Closed sketch or face defining the tab footprint",
  },
  thickness: {
    type: "number",
    default_value: 1,
    min: 0,
    hint: "Sheet metal thickness. Also used as the tab extrusion distance.",
  },
  placementMode: {
    type: "options",
    options: ["forward", "reverse", "midplane"],
    default_value: "forward",
    hint: "Controls whether material is added forward, backward, or split about the sketch plane.",
  },
  bendRadius: {
    type: "number",
    default_value: 0.125,
    min: 0,
    hint: "Default bend radius captured with the sheet-metal base feature.",
  },
  neutralFactor: {
    type: "number",
    default_value: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Neutral factor used for flat pattern bend allowance (0-1).",
  },
  consumeProfileSketch: {
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced sketch after creating the tab. Turn off to keep it in the scene.",
  },
};

export class SheetMetalTabFeature {
  static shortName = "SM.TAB";
  static longName = "Sheet Metal Tab";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest() {
    return [];
  }

  async run(partHistory) {
    void partHistory;
    return runSheetMetalTab(this);
  }
}

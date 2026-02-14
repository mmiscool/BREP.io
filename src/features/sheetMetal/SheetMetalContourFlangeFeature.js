import { runSheetMetalContourFlange } from "./sheetMetalEngineBridge.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the contour flange feature",
  },
  path: {
    type: "reference_selection",
    selectionFilter: ["SKETCH", "EDGE", "FACE"],
    multiple: true,
    default_value: null,
    hint: "Open sketch (or connected edges) defining the flange centerline.",
  },
  distance: {
    type: "number",
    default_value: 20,
    min: 0,
    hint: "How far the sheet extends from the selected path (strip width).",
  },
  thickness: {
    type: "number",
    default_value: 2,
    min: 0,
    hint: "Sheet metal thickness (extruded normal to the sketch plane).",
  },
  reverseSheetSide: {
    type: "boolean",
    default_value: false,
    hint: "Flip the sheet offset to the opposite side of the sketch.",
  },
  bendRadius: {
    type: "number",
    default_value: 2,
    min: 0,
    hint: "Default inside bend radius inserted wherever two lines meet.",
  },
  neutralFactor: {
    type: "number",
    default_value: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Neutral factor used for flat pattern bend allowance (0-1).",
  },
  consumePathSketch: {
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced sketch after creating the flange. Turn off to keep it in the scene.",
  },
};

export class SheetMetalContourFlangeFeature {
  static shortName = "SM.CF";
  static longName = "Sheet Metal Contour Flange";
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
    return runSheetMetalContourFlange(this);
  }
}

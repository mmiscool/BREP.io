import { runSheetMetalFlange } from "./sheetMetalEngineBridge.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the flange feature",
  },
  faces: {
    type: "reference_selection",
    selectionFilter: ["FACE", "EDGE"],
    multiple: true,
    default_value: null,
    hint: "Select one or more sheet-metal edge overlays where the flange will be constructed.",
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
    hint: "Straight leg length extending away from the bend edge.",
  },
  edgeStartSetback: {
    label: "Start setback",
    type: "number",
    default_value: 0,
    min: 0,
    hint: "Distance from the selected edge start point where the flange span begins.",
  },
  edgeEndSetback: {
    label: "End setback",
    type: "number",
    default_value: 0,
    min: 0,
    hint: "Distance from the selected edge end point where the flange span ends.",
  },
  flangeLengthReference: {
    type: "options",
    options: ["inside", "outside", "web"],
    default_value: "outside",
    hint: "Specifies how the flange length dimension is interpreted for the new web face (inside/outside/web).",
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

  async run(partHistory) {
    void partHistory;
    const angleOverride = this.constructor?.angleOverride;
    const defaultBendRadius = this.constructor?.defaultBendRadius;
    const flangeLengthReferenceOverride = this.constructor?.flangeLengthReferenceOverride;
    const hasAngleOverride = angleOverride != null && Number.isFinite(Number(angleOverride));
    const hasDefaultBendRadius = defaultBendRadius != null && Number.isFinite(Number(defaultBendRadius));

    return runSheetMetalFlange(this, {
      baseType: this.constructor?.baseType || "FLANGE",
      angleDeg: hasAngleOverride ? Number(angleOverride) : undefined,
      defaultInsideRadius: hasDefaultBendRadius ? Number(defaultBendRadius) : undefined,
      lockAngleToAbsolute: hasAngleOverride,
      flangeLengthReference: flangeLengthReferenceOverride != null ? String(flangeLengthReferenceOverride) : undefined,
    });
  }
}

import { SheetMetalFlangeFeature } from "./SheetMetalFlangeFeature.js";

const baseSchema = SheetMetalFlangeFeature.inputParamsSchema || {};
const inputParamsSchema = {
  ...baseSchema,
  id: {
    ...(baseSchema.id || {}),
    hint: "Unique identifier for the hem feature",
  },
  flangeLength: {
    ...(baseSchema.flangeLength || {}),
    label: "Hem length",
    hint: "Optional straight leg length extruded from the hem end face. Set to 0 to create only the bend.",
  },
  flangeLengthReference: {
    ...(baseSchema.flangeLengthReference || {}),
    label: "Hem length reference",
    hint: "Measurement basis for the hem leg: inside, outside, or web.",
  },
  angle: {
    ...(baseSchema.angle || {}),
    default_value: 180,
    min: 180,
    max: 180,
    hint: "Hem angle is fixed at 180 degrees.",
  },
  bendRadius: {
    ...(baseSchema.bendRadius || {}),
    default_value: 0.0001,
    hint: "Hem bend radius (inside). Defaults to 0.0001.",
  },
};

export class SheetMetalHemFeature extends SheetMetalFlangeFeature {
  static shortName = "SM.HEM";
  static longName = "Sheet Metal Hem";
  static inputParamsSchema = inputParamsSchema;
  static baseType = "HEM";
  static logTag = "SheetMetalHem";
  static defaultAngle = 180;
  static angleOverride = 180;
  static defaultBendRadius = 0.0001;
}

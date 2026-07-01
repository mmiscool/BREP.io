import { runSheetMetalFlange } from "./sheetMetalEngineBridge.js";

type AnyRecord = Record<string, any>;

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
  static angleOverride: any = null;
  static defaultBendRadius: any = null;
  static flangeLengthReferenceOverride: any = null;
  static showContexButton(selectedItems: any) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    if (!items.length) return false;

    const picks = items.filter((item) => {
      const type = String(item?.type || "").toUpperCase();
      if (type !== "FACE" && type !== "EDGE") return false;
      if (String(item?.parent?.type || "").toUpperCase() === "SKETCH") return false;
      return hasSheetMetalFlangeSelectionMetadata(item);
    });
    if (!picks.length || picks.length !== items.length) return false;

    return { field: "faces", value: picks };
  }

  inputParams: AnyRecord;
  persistentData: AnyRecord;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory: any) {
    void partHistory;
    const ctor = this.constructor as typeof SheetMetalFlangeFeature & AnyRecord;
    const angleOverride = ctor.angleOverride;
    const defaultBendRadius = ctor.defaultBendRadius;
    const flangeLengthReferenceOverride = ctor.flangeLengthReferenceOverride;
    const hasAngleOverride = angleOverride != null && Number.isFinite(Number(angleOverride));
    const hasDefaultBendRadius = defaultBendRadius != null && Number.isFinite(Number(defaultBendRadius));

    return runSheetMetalFlange(this, {
      baseType: ctor.baseType || "FLANGE",
      angleDeg: hasAngleOverride ? Number(angleOverride) : undefined,
      defaultInsideRadius: hasDefaultBendRadius ? Number(defaultBendRadius) : undefined,
      lockAngleToAbsolute: hasAngleOverride,
      flangeLengthReference: flangeLengthReferenceOverride != null ? String(flangeLengthReferenceOverride) : undefined,
    });
  }
}

function hasSheetMetalFlangeSelectionMetadata(selection: any) {
  const meta = selection?.userData?.sheetMetal;
  if (meta && typeof meta === "object") {
    if (hasFlangeTargetMetadata(meta)) {
      return true;
    }
  }
  const type = String(selection?.type || "").toUpperCase();
  const name = selection?.name || selection?.userData?.faceName || selection?.userData?.edgeName || null;
  const carrier = findSheetMetalCarrier(selection);
  if (!carrier || !name) return false;

  try {
    const metadata = type === "FACE"
      ? (typeof carrier.getFaceMetadata === "function" ? carrier.getFaceMetadata(name) : null)
      : (type === "EDGE" ? (typeof carrier.getEdgeMetadata === "function" ? carrier.getEdgeMetadata(name) : null) : null);
    const sheetMetal = metadata?.sheetMetal;
    if (sheetMetal && typeof sheetMetal === "object") {
      if (hasFlangeTargetMetadata(sheetMetal)) {
        return true;
      }
    }
    return hasFlangeTargetMetadata(metadata);
  } catch {
    return false;
  }
}

function hasFlangeTargetMetadata(meta: any) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.edgeId != null || meta.defaultEdgeId != null) return true;
  const kind = String(meta.kind || "").trim().toLowerCase();
  return (kind === "flat_edge_wall" || kind === "flat_cutout_wall" || kind === "edge")
    && meta.flatId != null;
}

function findSheetMetalCarrier(selection: any) {
  let current = selection?.parentSolid || selection?.parent || null;
  while (current) {
    if (current?.userData?.sheetMetalModel?.tree) return current;
    current = current.parent || null;
  }
  return null;
}

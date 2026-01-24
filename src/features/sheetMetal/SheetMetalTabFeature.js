import { BREP } from "../../BREP/BREP.js";
import { selectionHasSketch } from "../selectionUtils.js";
import { normalizeThickness, normalizeBendRadius, normalizeNeutralFactor, applySheetMetalMetadata } from "./sheetMetalMetadata.js";
import { propagateSheetMetalFaceTypesToEdges } from "./sheetMetalFaceTypes.js";
import { resolveProfileFace, collectSketchParents } from "./profileUtils.js";
import { cleanupSheetMetalOppositeEdgeFaces } from "./sheetMetalCleanup.js";
import { SheetMetalObject } from "./SheetMetalObject.js";
import { cloneSheetMetalTree, createSheetMetalTree, createSheetMetalTabNode } from "./sheetMetalTree.js";
import { resolvePlacementMode } from "./sheetMetalTabUtils.js";
import { cloneProfileGroups, collectProfileEdges } from "./sheetMetalProfileUtils.js";

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
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: "NONE" },
    hint: "Optional boolean operation with existing solids.",
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

  uiFieldsTest(context) {
    const params = this.inputParams || context?.params || {};
    const partHistory = context?.history || null;
    return selectionHasSketch(params.profile, partHistory) ? [] : ["consumeProfileSketch"];
  }

  async run(partHistory) {
    const faceObj = resolveProfileFace(this.inputParams?.profile, partHistory);
    if (!faceObj) {
      throw new Error("Sheet Metal Tab requires a valid FACE or SKETCH selection.");
    }

    const sketchParentsToRemove = collectSketchParents(faceObj);
    const { magnitude: thicknessAbs, signed: signedThickness } = normalizeThickness(
      this.inputParams?.thickness ?? 1
    );
    const bendRadius = normalizeBendRadius(this.inputParams?.bendRadius ?? 0.125);
    const neutralFactor = normalizeNeutralFactor(this.inputParams?.neutralFactor ?? 0.5);
    const placement = resolvePlacementMode(this.inputParams?.placementMode, signedThickness);
    const sheetMetal = new SheetMetalObject({
      tree: createSheetMetalTree(),
      kFactor: neutralFactor,
      thickness: thicknessAbs,
      bendRadius,
    });
    const profileGroups = cloneProfileGroups(faceObj);
    const profileEdges = collectProfileEdges(faceObj);
    const tabNode = createSheetMetalTabNode({
      featureID: this.inputParams?.featureID || null,
      profileRef: this.inputParams?.profile ?? null,
      profileName: faceObj?.name || null,
      profileGroups,
      profileEdges,
      thickness: thicknessAbs,
      placementMode: placement,
      bendRadius,
      neutralFactor,
      signedThickness,
      consumeProfileSketch: this.inputParams?.consumeProfileSketch !== false,
    });
    sheetMetal.appendNode(tabNode);
    await sheetMetal.generate({
      partHistory,
      metadataManager: partHistory?.metadataManager,
      mode: "solid",
    });

    const effects = await BREP.applyBooleanOperation(
      partHistory || {},
      sheetMetal,
      this.inputParams?.boolean,
      this.inputParams?.featureID
    );

    const consumeSketch = this.inputParams?.consumeProfileSketch !== false;
    const removedArtifacts = [
      ...(consumeSketch ? sketchParentsToRemove : []),
      ...(effects?.removed || []),
    ];
    const added = effects?.added || [];

    cleanupSheetMetalOppositeEdgeFaces(added);
    propagateSheetMetalFaceTypesToEdges(added);

    applySheetMetalMetadata(added, partHistory?.metadataManager, {
      featureID: this.inputParams?.featureID || null,
      thickness: thicknessAbs,
      bendRadius,
      baseType: "TAB",
      extra: { placementMode: placement, signedThickness, consumeProfileSketch: consumeSketch },
      neutralFactor,
      forceBaseOverwrite: true,
    });

    for (const solid of added) {
      if (!solid) continue;
      solid.userData = solid.userData || {};
      solid.userData.sheetMetalTree = cloneSheetMetalTree(sheetMetal.tree);
      solid.userData.sheetMetalKFactor = neutralFactor;
    }

    this.persistentData = this.persistentData || {};
    this.persistentData.sheetMetal = {
      baseType: "TAB",
      thickness: thicknessAbs,
      bendRadius,
      neutralFactor,
      placementMode: placement,
      signedThickness,
      consumeProfileSketch: consumeSketch,
      profileName: faceObj?.name || null,
      tree: sheetMetal.tree,
    };

    // Flag removed parents so history cleans them up
    try {
      for (const obj of removedArtifacts) {
        if (obj) obj.__removeFlag = true;
      }
    } catch { /* flag optional */ }

    return { added, removed: removedArtifacts };
  }
}

import { Solid } from "../../BREP/BetterSolid.js";
import { buildSheetMetalFlatPatternSolids } from "../../exporters/sheetMetalFlatPattern.js";
import { applySheetMetalMetadata } from "./sheetMetalMetadata.js";
import { propagateSheetMetalFaceTypesToEdges } from "./sheetMetalFaceTypes.js";
import { buildSheetMetalSolidFromTree } from "./sheetMetalPipeline.js";
import {
  SHEET_METAL_NODE_TYPES,
  appendSheetMetalNode,
  cloneSheetMetalTree,
  getSheetMetalBaseNode,
} from "./sheetMetalTree.js";

export class SheetMetalObject extends Solid {
  constructor({ tree = null, kFactor = null, thickness = null, bendRadius = null } = {}) {
    super();
    this.tree = tree ? cloneSheetMetalTree(tree) : { version: 1, nodes: [] };
    this.kFactor = kFactor;
    this.thickness = thickness;
    this.bendRadius = bendRadius;
  }

  cloneWithNode(node) {
    const next = new SheetMetalObject({
      tree: appendSheetMetalNode(this.tree, node),
      kFactor: this.kFactor,
      thickness: this.thickness,
      bendRadius: this.bendRadius,
    });
    next.name = this.name;
    return next;
  }

  appendNode(node) {
    this.tree = appendSheetMetalNode(this.tree, node);
    return this;
  }

  async generate({
    partHistory = null,
    metadataManager = null,
    mode = "solid",
    flatPatternOptions = null,
  } = {}) {
    const built = await buildSheetMetalSolidFromTree(this.tree, { partHistory });
    this._replaceFromSolid(built);

    const baseNode = getSheetMetalBaseNode(this.tree);
    const baseParams = baseNode?.params || {};
    const baseType = baseNode?.type === SHEET_METAL_NODE_TYPES.CONTOUR_FLANGE
      ? "CONTOUR_FLANGE"
      : "TAB";
    let baseExtra = {};
    if (baseType === "CONTOUR_FLANGE") {
      const signedDistanceRaw = Number(baseParams.signedDistance ?? baseParams.distance);
      const signedDistance = Number.isFinite(signedDistanceRaw) ? signedDistanceRaw : 0;
      const distance = Math.abs(signedDistance);
      baseExtra = {
        signedThickness: baseParams.signedThickness,
        sheetSide: baseParams.sheetSide,
        reverseSheetSide: baseParams.reverseSheetSide,
        signedDistance,
        distance,
        consumePathSketch: baseParams.consumePathSketch,
        pathRefCount: Array.isArray(baseParams.pathRefs) ? baseParams.pathRefs.length : null,
      };
    } else {
      baseExtra = {
        placementMode: baseParams.placementMode,
        signedThickness: baseParams.signedThickness,
        consumeProfileSketch: baseParams.consumeProfileSketch,
        profileName: baseParams.profileName,
      };
    }
    applySheetMetalMetadata([this], metadataManager, {
      featureID: baseParams.featureID || null,
      thickness: this.thickness ?? baseParams.thickness ?? null,
      bendRadius: this.bendRadius ?? baseParams.bendRadius ?? null,
      neutralFactor: this.kFactor ?? baseParams.neutralFactor ?? null,
      baseType,
      extra: baseExtra,
      forceBaseOverwrite: true,
    });
    propagateSheetMetalFaceTypesToEdges([this]);

    this.userData = this.userData || {};
    this.userData.sheetMetalTree = cloneSheetMetalTree(this.tree);
    this.userData.sheetMetalKFactor = this.kFactor;

    let flat = null;
    if (mode === "flat" || mode === "both") {
      const flatOptions = { ...(flatPatternOptions || {}) };
      if (flatOptions.metadataManager == null && metadataManager) {
        flatOptions.metadataManager = metadataManager;
      }
      if (flatOptions.thickness == null) {
        const thickness = this.thickness ?? baseParams.thickness ?? null;
        if (thickness != null) flatOptions.thickness = thickness;
      }
      if (flatOptions.neutralFactor == null) {
        const neutralFactor = this.kFactor ?? baseParams.neutralFactor ?? null;
        if (neutralFactor != null) flatOptions.neutralFactor = neutralFactor;
      }
      const entries = buildSheetMetalFlatPatternSolids([this], flatOptions);
      flat = Array.isArray(entries) && entries.length ? entries[0] : null;
    }

    if (mode === "solid") return { solid: this };
    if (mode === "flat") return { solid: this, flat };
    if (mode === "both") return { solid: this, flat };
    return { solid: this };
  }

  _replaceFromSolid(source) {
    this._numProp = source._numProp;
    this._vertProperties = source._vertProperties.slice();
    this._triVerts = source._triVerts.slice();
    this._triIDs = source._triIDs.slice();
    this._vertKeyToIndex = new Map(source._vertKeyToIndex);
    this._faceNameToID = new Map(source._faceNameToID);
    this._idToFaceName = new Map(source._idToFaceName);
    this._faceMetadata = new Map(source._faceMetadata);
    this._edgeMetadata = new Map(source._edgeMetadata);
    this._auxEdges = Array.isArray(source._auxEdges)
      ? source._auxEdges.map((edge) => ({
          name: edge?.name,
          closedLoop: !!edge?.closedLoop,
          polylineWorld: !!edge?.polylineWorld,
          materialKey: edge?.materialKey,
          centerline: !!edge?.centerline,
          points: Array.isArray(edge?.points)
            ? edge.points.map((p) => (Array.isArray(p) ? [p[0], p[1], p[2]] : p))
            : [],
        }))
      : [];
    this._dirty = true;
    this._manifold = null;
    this._faceIndex = null;
    this.type = "SOLID";
    this.renderOrder = source.renderOrder ?? this.renderOrder;
  }
}

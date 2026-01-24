import { BREP } from "../../BREP/BREP.js";
import { resolveProfileFace } from "./profileUtils.js";
import { buildContourFlangeSolidFromParams } from "./SheetMetalContourFlangeFeature.js";
import { buildSheetMetalCutoutSolids } from "./SheetMetalCutoutFeature.js";
import { buildSheetMetalFlangeSolids } from "./SheetMetalFlangeFeature.js";
import { SHEET_METAL_NODE_TYPES } from "./sheetMetalTree.js";
import { resolvePlacementMode, toExtrudeDistances, tagTabFaceTypes } from "./sheetMetalTabUtils.js";
import { buildFaceFromProfileGroups } from "./sheetMetalProfileUtils.js";

export async function buildSheetMetalSolidFromTree(tree, context = {}) {
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    throw new Error("Sheet metal tree has no nodes to build.");
  }

  let current = null;
  for (const node of tree.nodes) {
    if (!node || !node.type) continue;
    switch (node.type) {
      case SHEET_METAL_NODE_TYPES.TAB:
        current = buildTabSolid(node, context);
        break;
      case SHEET_METAL_NODE_TYPES.CONTOUR_FLANGE:
        current = buildContourFlangeSolid(node, context);
        break;
      case SHEET_METAL_NODE_TYPES.FLANGE:
        current = await applyFlangeNode(current, node, context);
        break;
      case SHEET_METAL_NODE_TYPES.CUTOUT:
        current = await applyCutoutNode(current, node, context);
        break;
      default:
        throw new Error(`Unsupported sheet metal node type: ${node.type}`);
    }
  }
  if (!current) {
    throw new Error("Sheet metal tree did not produce a solid.");
  }
  return current;
}

function buildTabSolid(node, context) {
  const params = node.params || {};
  let faceObj = resolveProfileFace(params.profileRef, context.partHistory);
  if (!faceObj && params.profileGroups) {
    faceObj = buildFaceFromProfileGroups(
      params.profileGroups,
      params.profileName || params.profileRef || "PROFILE",
      params.profileEdges,
    );
  }
  if (!faceObj) {
    throw new Error("Sheet Metal Tab requires a valid FACE or SKETCH selection.");
  }

  const placement = resolvePlacementMode(params.placementMode, params.signedThickness);
  const extrudeDistances = toExtrudeDistances(Math.abs(params.thickness), placement);

  const sweep = new BREP.Sweep({
    face: faceObj,
    distance: extrudeDistances.distance,
    distanceBack: extrudeDistances.distanceBack,
    mode: "translate",
    name: params.featureID || null,
    omitBaseCap: false,
  });
  sweep.visualize();
  tagTabFaceTypes(sweep);
  return sweep;
}

function buildContourFlangeSolid(node, context) {
  const params = node.params || {};
  const buildParams = {
    ...params,
    path: params.pathRefs || params.path || params.profile,
  };
  const result = buildContourFlangeSolidFromParams(buildParams, context.partHistory);
  return result.solid;
}

async function applyFlangeNode(current, node, context) {
  if (!current) {
    throw new Error("Sheet metal flange requires an existing solid.");
  }
  const params = node.params || {};
  const faces = resolveFaceRefsOnSolid(current, params.faceRefs);
  if (!faces.length) {
    throw new Error("Sheet metal flange could not resolve any target faces on the current solid.");
  }
  const featureDefaults = {
    longName: "Sheet Metal Flange",
    logTag: "SheetMetalFlange",
    baseType: params.baseType || "FLANGE",
    defaultAngle: Number.isFinite(params.defaultAngle) ? params.defaultAngle : 90,
    angleOverride: Number.isFinite(params.angleOverride) ? params.angleOverride : null,
    defaultBendRadius: Number.isFinite(params.defaultBendRadius) ? params.defaultBendRadius : null,
  };
  const result = await buildSheetMetalFlangeSolids({
    params,
    partHistory: context.partHistory,
    faces,
    featureClass: featureDefaults,
    applyMetadata: false,
  });
  return pickPrimarySolid(result?.added, current);
}

async function applyCutoutNode(current, node, context) {
  if (!current) {
    throw new Error("Sheet metal cutout requires an existing solid.");
  }
  ensureSolidVisualized(current);
  const params = node.params || {};
  const buildParams = {
    ...params,
    sheet: params.sheetRef || params.sheet,
    profile: params.profileRef || params.profile,
  };
  const result = await buildSheetMetalCutoutSolids({
    params: buildParams,
    partHistory: context.partHistory,
    sheetSolid: current,
    applyMetadata: false,
  });
  return pickPrimarySolid(result?.added, current);
}

function ensureSolidVisualized(solid) {
  try {
    if (solid && typeof solid.visualize === "function") solid.visualize();
  } catch { /* ignore */ }
}

function resolveFaceRefsOnSolid(solid, refs) {
  const list = Array.isArray(refs) ? refs : (refs ? [refs] : []);
  if (!solid || !list.length) return [];
  ensureSolidVisualized(solid);
  const out = [];
  for (const ref of list) {
    if (!ref) continue;
    if (ref?.type === "FACE") {
      out.push(ref);
      continue;
    }
    const name = typeof ref === "string" ? ref : (ref?.name || ref?.id || null);
    if (!name) continue;
    let face = null;
    if (typeof solid.getObjectByName === "function") {
      face = solid.getObjectByName(name);
    }
    if (!face || face.type !== "FACE") {
      const children = Array.isArray(solid.children) ? solid.children : [];
      face = children.find((child) => child?.type === "FACE" && child?.name === name) || null;
    }
    if (face && face.type === "FACE") out.push(face);
  }
  return out;
}

function pickPrimarySolid(added, fallback) {
  if (Array.isArray(added) && added.length) {
    if (fallback?.name) {
      const match = added.find((solid) => solid?.name === fallback.name);
      if (match) return match;
    }
    return added[0];
  }
  return fallback;
}

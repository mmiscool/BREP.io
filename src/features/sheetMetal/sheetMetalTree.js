import { normalizeSelectionList, normalizeSelectionName } from "../selectionUtils.js";

export const SHEET_METAL_NODE_TYPES = {
  TAB: "TAB",
  CONTOUR_FLANGE: "CONTOUR_FLANGE",
  FLANGE: "FLANGE",
  CUTOUT: "CUTOUT",
};

export function createSheetMetalTree(nodes = []) {
  return {
    version: 1,
    nodes: Array.isArray(nodes) ? nodes.slice() : [],
  };
}

export function cloneSheetMetalTree(tree) {
  if (!tree || typeof tree !== "object") return createSheetMetalTree();
  const cloneValue = (value) => {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, val] of Object.entries(value)) {
        out[key] = cloneValue(val);
      }
      return out;
    }
    return value;
  };
  const nodes = Array.isArray(tree.nodes)
    ? tree.nodes.map((node) => ({
        ...node,
        params: node?.params ? cloneValue(node.params) : null,
      }))
    : [];
  return {
    version: tree.version ?? 1,
    nodes,
  };
}

export function appendSheetMetalNode(tree, node) {
  const next = cloneSheetMetalTree(tree);
  next.nodes.push(node);
  return next;
}

export function createSheetMetalTabNode({
  featureID,
  profileRef,
  profileName,
  profileGroups,
  profileEdges,
  thickness,
  placementMode,
  bendRadius,
  neutralFactor,
  signedThickness,
  consumeProfileSketch,
}) {
  const resolvedProfile = normalizeSelectionName(
    Array.isArray(profileRef) ? (profileRef[0] || null) : profileRef
  );
  const baseName = profileName || "TAB";
  const tag = featureID ? `${featureID}` : `SM.TAB:${baseName}`;
  return {
    type: SHEET_METAL_NODE_TYPES.TAB,
    id: tag,
    params: {
      featureID: featureID || null,
      profileRef: resolvedProfile || null,
      profileName: baseName,
      profileGroups: Array.isArray(profileGroups) ? profileGroups : null,
      profileEdges: Array.isArray(profileEdges) ? profileEdges : null,
      thickness,
      placementMode,
      bendRadius,
      neutralFactor,
      signedThickness,
      consumeProfileSketch,
    },
  };
}

export function createSheetMetalContourFlangeNode({
  featureID,
  pathRefs,
  distance,
  thickness,
  signedThickness,
  signedDistance,
  reverseSheetSide,
  sheetSide,
  bendRadius,
  neutralFactor,
  consumePathSketch,
}) {
  const refs = normalizeSelectionList(
    Array.isArray(pathRefs) ? pathRefs : (pathRefs ? [pathRefs] : [])
  );
  const tag = featureID ? `${featureID}` : "SM.CF";
  return {
    type: SHEET_METAL_NODE_TYPES.CONTOUR_FLANGE,
    id: tag,
    params: {
      featureID: featureID || null,
      pathRefs: refs,
      distance,
      thickness,
      signedThickness,
      signedDistance,
      reverseSheetSide,
      sheetSide,
      bendRadius,
      neutralFactor,
      consumePathSketch,
    },
  };
}

export function createSheetMetalFlangeNode({
  featureID,
  faceRefs,
  useOppositeCenterline,
  flangeLength,
  flangeLengthReference,
  angle,
  inset,
  reliefWidth,
  bendRadius,
  offset,
  debugSkipUnion,
  baseType,
  defaultAngle,
  angleOverride,
  defaultBendRadius,
}) {
  const refs = normalizeSelectionList(
    Array.isArray(faceRefs) ? faceRefs : (faceRefs ? [faceRefs] : [])
  );
  const tag = featureID ? `${featureID}` : "SM.F";
  return {
    type: SHEET_METAL_NODE_TYPES.FLANGE,
    id: tag,
    params: {
      featureID: featureID || null,
      faceRefs: refs,
      useOppositeCenterline,
      flangeLength,
      flangeLengthReference,
      angle,
      inset,
      reliefWidth,
      bendRadius,
      offset,
      debugSkipUnion,
      baseType: baseType || null,
      defaultAngle,
      angleOverride,
      defaultBendRadius,
    },
  };
}

export function createSheetMetalCutoutNode({
  featureID,
  sheetRef,
  profileRef,
  profileFaceName,
  profileGroups,
  profileEdges,
  consumeProfileSketch,
  forwardDistance,
  backDistance,
  keepTool,
  debugCutter,
}) {
  const sheetName = normalizeSelectionName(
    Array.isArray(sheetRef) ? (sheetRef[0] || null) : sheetRef
  );
  const profileRefName = normalizeSelectionName(
    Array.isArray(profileRef) ? (profileRef[0] || null) : profileRef
  );
  const tag = featureID ? `${featureID}` : "SM.CUTOUT";
  return {
    type: SHEET_METAL_NODE_TYPES.CUTOUT,
    id: tag,
    params: {
      featureID: featureID || null,
      sheetRef: sheetName || null,
      profileRef: profileRefName || null,
      profileName: profileFaceName || profileRefName || null,
      profileGroups: Array.isArray(profileGroups) ? profileGroups : null,
      profileEdges: Array.isArray(profileEdges) ? profileEdges : null,
      consumeProfileSketch,
      forwardDistance,
      backDistance,
      keepTool,
      debugCutter,
    },
  };
}

export function getSheetMetalBaseNode(tree) {
  if (!tree || !Array.isArray(tree.nodes)) return null;
  return tree.nodes.find((node) => (
    node?.type === SHEET_METAL_NODE_TYPES.TAB
    || node?.type === SHEET_METAL_NODE_TYPES.CONTOUR_FLANGE
  )) || null;
}

import {
  ENGINE_TAG,
  MIN_LEG,
  MIN_THICKNESS,
  clamp,
  cloneTree,
  featureIdFromInstance,
  matrixFromAny,
  matrixToArray,
  normalizeSelectionArray,
  toFiniteNumber,
} from "./shared.js";
import { applySolidCutoutToTree } from "./cutoutTree.js";
import {
  applyCutoutLoopsToTree,
  buildContourFlangeFromPath,
  buildCutoutCutterFromProfile,
  buildFlatFromFace,
  collectConsumableInputObjects,
  collectCutoutProfileLoops,
  collectSketchParents,
  resolveProfileFace,
} from "./profiles.js";
import { ensureSheetMeta } from "./treeCore.js";
import {
  addFlangesToTree,
  computeFlangeLengthReferenceSetback,
  normalizeFlangeInsetMode,
  normalizeFlangeLengthReference,
  profileReferencesTargetSheetFace,
  resolveEdgeTargets,
  resolveSheetSourceFromSelections,
  resolveSheetSourceWithFallback,
} from "./flanges.js";
import { buildRenderableSheetModel, preserveSheetMetalFaceNames } from "./render.js";

function summarizeEvaluatedModel(evaluated) {
  return {
    flatCount3D: Array.isArray(evaluated?.flats3D) ? evaluated.flats3D.length : 0,
    flatCount2D: Array.isArray(evaluated?.flats2D) ? evaluated.flats2D.length : 0,
    bendCount3D: Array.isArray(evaluated?.bends3D) ? evaluated.bends3D.length : 0,
    bendCount2D: Array.isArray(evaluated?.bends2D) ? evaluated.bends2D.length : 0,
  };
}

function basePersistentPayload(instance) {
  return {
    ...(instance?.persistentData || {}),
    sheetMetal: {
      engine: ENGINE_TAG,
      feature: instance?.constructor?.shortName || instance?.constructor?.name || "SheetMetal",
      featureID: featureIdFromInstance(instance),
      status: "ok",
    },
  };
}

function dedupeObjects(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = item.uuid || item.id || item.name || item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function runSheetMetalTab(instance) {
  const featureID = featureIdFromInstance(instance, "SM_TAB");
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(instance?.inputParams?.thickness, 1)));
  const bendRadius = Math.max(MIN_LEG, toFiniteNumber(instance?.inputParams?.bendRadius, thickness * 0.5));
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, 0.5), 0, 1);
  const placementMode = String(instance?.inputParams?.placementMode || "forward").toLowerCase();

  const profileSelections = normalizeSelectionArray(instance?.inputParams?.profile);
  const faceObj = resolveProfileFace(profileSelections[0] || null);

  if (!faceObj) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_profile",
        message: "Select a sketch or face profile to build a sheet metal tab.",
      },
    };
    return { added: [], removed: [] };
  }

  const built = buildFlatFromFace(faceObj, featureID, "Tab Root");
  if (!built) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Unable to derive a closed flat outline from the selected profile.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = { thickness, root: built.flat };
  const meta = ensureSheetMeta(tree);
  meta.baseType = "TAB";
  meta.defaultInsideRadius = bendRadius;
  meta.defaultKFactor = kFactor;
  meta.lastFeatureID = featureID;

  const rootMatrix = built.frame.matrix.clone();
  const placementOffset = (() => {
    if (placementMode === "reverse") return -thickness * 0.5;
    if (placementMode === "midplane") return 0;
    return thickness * 0.5;
  })();
  const pos = built.frame.origin.clone().addScaledVector(built.frame.normal, placementOffset);
  rootMatrix.setPosition(pos);

  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });

  const removed = [];
  if (instance?.inputParams?.consumeProfileSketch !== false) {
    removed.push(...collectSketchParents(profileSelections));
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects(removed) };
}

export function runSheetMetalContourFlange(instance) {
  const featureID = featureIdFromInstance(instance, "SM_CF");
  const pathSelections = normalizeSelectionArray(instance?.inputParams?.path);
  const thickness = Math.max(MIN_THICKNESS, Math.abs(toFiniteNumber(instance?.inputParams?.thickness, 1)));
  const distance = toFiniteNumber(instance?.inputParams?.distance, 20);
  const reverseSheetSide = !!instance?.inputParams?.reverseSheetSide;
  const bendRadius = Math.max(0, toFiniteNumber(instance?.inputParams?.bendRadius, thickness * 0.5));
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, 0.5), 0, 1);

  const built = buildContourFlangeFromPath(pathSelections, featureID, {
    distance,
    thickness,
    bendRadius,
    kFactor,
    reverseSheetSide,
  });
  if (!built) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_path",
        message: "Select connected sketch edges (or an edge chain) for contour flange.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = built.tree;
  const meta = ensureSheetMeta(tree);
  meta.baseType = "CONTOUR_FLANGE";
  meta.defaultInsideRadius = built.insideRadius;
  meta.defaultKFactor = built.kFactor;
  meta.lastFeatureID = featureID;

  const rootMatrix = built.frame.matrix.clone();
  // The contour tree is built from midplane-segment data anchored at local origin.
  // Re-apply the midplane path start offset so the solved body lands on the sketch edge.
  const midplaneStart = Array.isArray(built.path2?.[0]) ? built.path2[0] : [0, 0];
  const rootOrigin = built.frame.origin
    .clone()
    .addScaledVector(built.frame.xAxis, toFiniteNumber(midplaneStart[0], 0))
    .addScaledVector(built.frame.zAxis, toFiniteNumber(midplaneStart[1], 0));
  rootMatrix.setPosition(rootOrigin);

  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });

  const removed = [];
  if (instance?.inputParams?.consumePathSketch !== false) {
    removed.push(...collectSketchParents(pathSelections));
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      contourSummary: {
        segmentCount: built.segments.length,
        bendCount: built.bends.length,
        wallHeight: built.height,
      },
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects(removed) };
}

export function runSheetMetalFlange(instance, options = {}) {
  const featureID = featureIdFromInstance(instance, "SM_FLANGE");
  const selections = normalizeSelectionArray(instance?.inputParams?.faces);
  const source = resolveSheetSourceFromSelections(selections);

  if (!source) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_source",
        message: "Select edge overlays from an existing sheet metal model.",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = cloneTree(source.tree);
  const meta = ensureSheetMeta(tree);
  const thickness = Math.max(MIN_THICKNESS, toFiniteNumber(tree?.thickness, 1));

  const defaultInsideRadius = toFiniteNumber(
    options.defaultInsideRadius,
    toFiniteNumber(meta.defaultInsideRadius, thickness * 0.5)
  );
  const requestedInsideRadius = toFiniteNumber(instance?.inputParams?.bendRadius, defaultInsideRadius);
  const resolvedInsideRadius = requestedInsideRadius <= 0 ? defaultInsideRadius : requestedInsideRadius;
  const insideRadius = Math.max(MIN_LEG, toFiniteNumber(resolvedInsideRadius, defaultInsideRadius));
  const midRadius = Math.max(MIN_LEG, insideRadius + thickness * 0.5);

  const defaultKFactor = clamp(toFiniteNumber(meta.defaultKFactor, 0.5), 0, 1);
  const kFactor = clamp(toFiniteNumber(instance?.inputParams?.neutralFactor, defaultKFactor), 0, 1);

  const explicitAngle = options.angleDeg != null
    ? toFiniteNumber(options.angleDeg, 90)
    : toFiniteNumber(instance?.inputParams?.angle, 90);
  let angleDeg = Math.max(0, Math.abs(explicitAngle));
  if (!options.lockAngleToAbsolute && instance?.inputParams?.useOppositeCenterline) {
    angleDeg *= -1;
  }

  const legLengthRaw = Math.max(MIN_LEG, toFiniteNumber(instance?.inputParams?.flangeLength, options.defaultLegLength ?? 10));
  const legLengthReference = normalizeFlangeLengthReference(
    options?.flangeLengthReference != null
      ? options.flangeLengthReference
      : instance?.inputParams?.flangeLengthReference
  );
  const legLengthReferenceSetback = computeFlangeLengthReferenceSetback({
    lengthReference: legLengthReference,
    insideRadius,
    thickness,
    angleDeg,
  });
  const legLength = Math.max(MIN_LEG, legLengthRaw - legLengthReferenceSetback);
  const insetMode = normalizeFlangeInsetMode(instance?.inputParams?.inset);
  const offset = toFiniteNumber(instance?.inputParams?.offset, 0);
  const edgeStartSetback = Math.max(0, toFiniteNumber(instance?.inputParams?.edgeStartSetback, 0));
  const edgeEndSetback = Math.max(0, toFiniteNumber(instance?.inputParams?.edgeEndSetback, 0));

  const targets = resolveEdgeTargets(selections, tree, source.carrier);
  const flangeSummary = addFlangesToTree(tree, featureID, targets, {
    angleDeg,
    midRadius,
    kFactor,
    legLength,
    requestedLegLength: legLengthRaw,
    legLengthReference,
    legLengthReferenceSetback,
    insideRadius,
    thickness,
    insetMode,
    offset,
    edgeStartSetback,
    edgeEndSetback,
  });

  if (flangeSummary.applied === 0) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "no_targets",
        message: "No eligible sheet-metal edges selected for flange creation.",
        targets: flangeSummary,
      },
    };
    return { added: [], removed: [] };
  }

  meta.defaultInsideRadius = insideRadius;
  meta.defaultKFactor = kFactor;
  meta.defaultFlangeLengthReference = legLengthReference;
  meta.defaultInsetMode = insetMode;
  meta.lastFeatureID = featureID;
  meta.baseType = options.baseType || "FLANGE";

  const rootMatrix = source.rootMatrix || matrixFromAny(source.carrier?.userData?.sheetMetalModel?.rootTransform);
  const { root, evaluated } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });
  preserveSheetMetalFaceNames(root, source.carrier);
  if (source?.carrier && typeof source.carrier.name === "string") {
    root.name = source.carrier.name;
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      flangeSummary,
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: [root], removed: dedupeObjects([source.carrier]) };
}

export function runSheetMetalCutout(instance) {
  const featureID = featureIdFromInstance(instance, "SM_CUTOUT");
  const sheetSelections = normalizeSelectionArray(instance?.inputParams?.sheet);
  const profileSelections = normalizeSelectionArray(instance?.inputParams?.profile);
  const sourceResolution = resolveSheetSourceWithFallback(sheetSelections, profileSelections);
  const source = sourceResolution?.source || null;

  if (!source) {
    const invalidExplicitSheet = String(sourceResolution?.resolution || "") === "invalid_explicit_sheet";
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: invalidExplicitSheet ? "invalid_sheet" : "no_source",
        message: invalidExplicitSheet
          ? "Selected target is not a sheet-metal solid."
          : "Select a sheet-metal target (or provide a profile near an existing sheet-metal model).",
        sourceResolution: sourceResolution?.resolution || "unresolved",
      },
    };
    return { added: [], removed: [] };
  }

  if (profileReferencesTargetSheetFace(profileSelections, source?.carrier)) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Selected profile is a face on the target sheet-metal body. Select a sketch profile (or external tool solid) for cutout.",
        reason: "profile_is_target_sheet_face",
      },
    };
    return { added: [], removed: [] };
  }

  const tree = cloneTree(source.tree);
  const meta = ensureSheetMeta(tree);
  if (!Array.isArray(meta.cutouts)) meta.cutouts = [];

  const forwardDistance = Math.max(0, toFiniteNumber(instance?.inputParams?.forwardDistance, 1));
  const backDistance = Math.max(0, toFiniteNumber(instance?.inputParams?.backDistance, 0));
  const cutterBuild = buildCutoutCutterFromProfile(profileSelections, featureID, {
    forwardDistance,
    backDistance,
  });
  if (!cutterBuild?.cutter) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Select a valid cutout profile (solid/face/sketch) with non-zero cut depth.",
        reason: cutterBuild?.reason || "invalid_profile",
      },
    };
    return { added: [], removed: [] };
  }

  const cutter = cutterBuild.cutter;
  if (cutterBuild?.sourceType === "solid" && cutterBuild?.profileSolid && cutterBuild.profileSolid === source.carrier) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "invalid_profile",
        message: "Cutout profile solid cannot be the same as the target sheet-metal solid.",
        reason: "profile_matches_target",
      },
    };
    return { added: [], removed: [] };
  }

  const rootMatrix = source.rootMatrix || matrixFromAny(source.carrier?.userData?.sheetMetalModel?.rootTransform);
  const isSolidProfile = String(cutterBuild?.sourceType || "").toLowerCase() === "solid";
  const profileLoopData = isSolidProfile
    ? {
      sourceType: "solid",
      faceCount: 0,
      loops: [],
    }
    : collectCutoutProfileLoops(profileSelections, featureID);
  const treeCutSummary = isSolidProfile
    ? applySolidCutoutToTree({
      tree,
      featureID,
      cutter,
      rootMatrix,
    })
    : applyCutoutLoopsToTree({
      tree,
      featureID,
      profileLoops3: profileLoopData.loops,
      rootMatrix,
    });
  if (treeCutSummary.applied <= 0) {
    instance.persistentData = {
      ...basePersistentPayload(instance),
      sheetMetal: {
        ...basePersistentPayload(instance).sheetMetal,
        status: "mapping_failed",
        message: "Cutout profile could not be mapped onto a sheet-metal flat in the midplane tree.",
        treeCutSummary,
      },
    };
    return { added: [], removed: [] };
  }
  const mode = "midplane_tree";

  const profileNames = profileSelections
    .map((item) => item?.name || item?.userData?.faceName || item?.userData?.edgeName || null)
    .filter(Boolean);

  const existingCutoutIndex = meta.cutouts.findIndex((entry) => String(entry?.id || "") === featureID);
  if (existingCutoutIndex >= 0) meta.cutouts.splice(existingCutoutIndex, 1);
  const cutoutEntry = {
    id: featureID,
    mode,
    sourceType: cutterBuild?.sourceType || profileLoopData?.sourceType || null,
    profileNames,
    profileLoopCount: isSolidProfile
      ? Math.max(0, toFiniteNumber(treeCutSummary?.requestedLoops, 0) | 0)
      : (Array.isArray(profileLoopData?.loops) ? profileLoopData.loops.length : 0),
    mappedLoopCount: treeCutSummary.applied,
    mappedLoops: Array.isArray(treeCutSummary.assignments) ? treeCutSummary.assignments : [],
    skippedLoops: Array.isArray(treeCutSummary.skippedLoops) ? treeCutSummary.skippedLoops : [],
    forwardDistance,
    backDistance,
    keepTool: !!instance?.inputParams?.keepTool,
    debugCutter: !!instance?.inputParams?.debugCutter,
    recordedAt: Date.now(),
  };
  meta.cutouts.push(cutoutEntry);

  meta.lastFeatureID = featureID;

  const { root, evaluated, cutoutSummary } = buildRenderableSheetModel({
    featureID,
    tree,
    rootMatrix,
    showFlatPattern: true,
  });
  preserveSheetMetalFaceNames(root, source.carrier);
  if (source?.carrier && typeof source.carrier.name === "string") {
    root.name = source.carrier.name;
  }

  const removed = [source.carrier];
  if (instance?.inputParams?.consumeProfileSketch !== false) {
    removed.push(...collectConsumableInputObjects(profileSelections));
  }
  const added = [root];
  if (instance?.inputParams?.keepTool || instance?.inputParams?.debugCutter) {
    cutter.name = `${featureID}:CUTTER`;
    cutter.userData = {
      ...(cutter.userData || {}),
      sheetMetalCutoutTool: true,
      featureID,
    };
    added.push(cutter);
  }

  instance.persistentData = {
    ...basePersistentPayload(instance),
    sheetMetal: {
      ...basePersistentPayload(instance).sheetMetal,
      status: "ok",
      tree: cloneTree(tree),
      rootTransform: matrixToArray(rootMatrix),
      cutoutSummary: {
        mode,
        tree: treeCutSummary,
        boolean: cutoutSummary,
      },
      sourceResolution: sourceResolution?.resolution || "explicit_sheet",
      summary: summarizeEvaluatedModel(evaluated),
    },
  };

  return { added: dedupeObjects(added), removed: dedupeObjects(removed) };
}

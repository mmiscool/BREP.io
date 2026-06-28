import { BREP } from "../../BREP/BREP.js";
import {
  applySolidAuthoringStateSnapshot,
  getSolidAuthoringStateSnapshot,
} from "../../BREP/CppSolidCore.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the self-intersection cleanup feature",
  },
  targetSolid: {
    type: "reference_selection",
    selectionFilter: ["SOLID"],
    multiple: false,
    default_value: null,
    hint: "Select a solid to split and clean up self-intersections",
  },
  mode: {
    type: "options",
    options: ["Split only", "Full cleanup"],
    default_value: "Split only",
    hint: "Split intersections only, or run the full cleanup pipeline",
  },
  maxPasses: {
    type: "number",
    step: 1,
    default_value: 3,
    hint: "Maximum cleanup passes when intersections remain after splitting",
  },
  removeInternal: {
    type: "boolean",
    default_value: true,
    hint: "Remove hidden fragments after splitting",
  },
  includeCoplanar: {
    type: "boolean",
    default_value: true,
    hint: "Detect and split coplanar triangle overlaps",
  },
  validate: {
    type: "boolean",
    default_value: true,
    hint: "Validate the cleaned solid with the manifold runtime when available",
  },
};

function resolveTargetSolid(targetSolid, partHistory) {
  const scene = partHistory?.scene || null;
  const targetEntry = Array.isArray(targetSolid)
    ? (targetSolid[0] || null)
    : (targetSolid || null);
  if (targetEntry && typeof targetEntry === "object") return targetEntry;
  if (!targetEntry) return null;
  const name = String(targetEntry);
  if (partHistory && typeof partHistory.getObjectByName === "function") {
    const resolved = partHistory.getObjectByName(name);
    if (resolved) return resolved;
  }
  if (scene && typeof scene.getObjectByName === "function") {
    return scene.getObjectByName(name);
  }
  return null;
}

function cloneSolidForCleanup(target) {
  if (target && typeof target.clone === "function") {
    try {
      const cloned = target.clone();
      if (cloned?.type === "SOLID") return cloned;
    } catch {
      // Imported solids can require constructor arguments, so fall back to the
      // authoring snapshot path below.
    }
  }

  const fallback = new BREP.Solid();
  applySolidAuthoringStateSnapshot(fallback, getSolidAuthoringStateSnapshot(target));
  fallback.type = "SOLID";
  fallback.renderOrder = target?.renderOrder ?? fallback.renderOrder;
  return fallback;
}

function isSingleSolidSelection(selectedItems) {
  const items = Array.isArray(selectedItems) ? selectedItems : [];
  if (items.length !== 1) return false;
  const item = items[0]?.object || items[0]?.target || items[0];
  return item && String(item.type || "").toUpperCase() === "SOLID" ? item : false;
}

function countTouchedTriangles(intersections) {
  const touched = new Set();
  for (const hit of Array.isArray(intersections) ? intersections : []) {
    if (Number.isInteger(hit?.triangleA)) touched.add(hit.triangleA);
    if (Number.isInteger(hit?.triangleB)) touched.add(hit.triangleB);
  }
  return touched.size;
}

export class SelfIntersectionCleanupFeature {
  static shortName = "SIC";
  static longName = "Self Intersection Cleanup";
  static inputParamsSchema = inputParamsSchema;

  static showContexButton(selectedItems) {
    const solid = isSingleSolidSelection(selectedItems);
    if (!solid) return false;
    return {
      label: "Self Intersection Cleanup",
      params: {
        targetSolid: solid.name || solid,
      },
    };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest(context) {
    const params = this.inputParams && Object.keys(this.inputParams).length > 0
      ? this.inputParams
      : context?.params || {};
    const mode = String(params?.mode || "Split only").toLowerCase();
    return mode === "split only" ? ["maxPasses", "removeInternal", "validate"] : [];
  }

  async run(partHistory) {
    const target = resolveTargetSolid(this.inputParams.targetSolid, partHistory);
    if (!target || target.type !== "SOLID") return { added: [], removed: [] };

    const outSolid = cloneSolidForCleanup(target);
    const maxPassesRaw = Number(this.inputParams.maxPasses);
    const maxPasses = Number.isFinite(maxPassesRaw) && maxPassesRaw > 0
      ? Math.max(1, Math.floor(maxPassesRaw))
      : 3;

    const includeCoplanar = this.inputParams.includeCoplanar !== false;
    const mode = String(this.inputParams.mode || "Split only").toLowerCase();
    let report = null;
    if (mode === "full cleanup") {
      report = outSolid.cleanupSelfIntersections({
        maxPasses,
        removeInternal: this.inputParams.removeInternal !== false,
        includeCoplanar,
        validate: this.inputParams.validate !== false,
      });
    } else {
      const beforeTriangleCount = (outSolid._triVerts?.length / 3) | 0;
      const intersections = typeof outSolid.findSelfIntersections === "function"
        ? outSolid.findSelfIntersections({ includeCoplanar })
        : [];
      const splitPairs = typeof outSolid.splitSelfIntersectingTriangles === "function"
        ? Number(outSolid.splitSelfIntersectingTriangles({ includeCoplanar }) || 0)
        : 0;
      const finalIntersections = typeof outSolid.findSelfIntersections === "function"
        ? outSolid.findSelfIntersections({ includePointContacts: false, includeCoplanar })
        : [];
      const finalTriangleCount = (outSolid._triVerts?.length / 3) | 0;
      report = {
        intersectionsFound: intersections.length,
        passes: splitPairs > 0 ? 1 : 0,
        sourceTrianglesSplit: countTouchedTriangles(intersections),
        trianglesAdded: Math.max(0, finalTriangleCount - beforeTriangleCount),
        internalTrianglesRemoved: 0,
        duplicateTrianglesRemoved: 0,
        finalTriangleCount,
        intersectionFree: finalIntersections.length === 0,
        closed: null,
        complete: finalIntersections.length === 0,
      };
    }
    this.persistentData.cleanupReport = report;

    const baseName = target.name || this.inputParams.id || "Solid";
    try { outSolid.name = `${baseName}_SelfIntersectionCleanup`; } catch { }
    try { outSolid.visualize(); } catch { }

    try { target.__removeFlag = true; } catch { }
    return { added: [outSolid], removed: [target] };
  }
}

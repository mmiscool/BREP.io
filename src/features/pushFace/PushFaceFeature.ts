import { getSolidGeometryCounts } from "../edgeFeatureUtils.js";
import { resolveSelectionObject } from "../selectionUtils.js";

type AnyRecord = Record<string, any>;

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Optional identifier for the push face feature",
  },
  faces: {
    type: "reference_selection",
    selectionFilter: ["FACE"],
    timestampDependency: "parentSolid",
    multiple: true,
    default_value: [],
    hint: "Select one or more faces on a single solid to push",
  },
  distance: {
    type: "number",
    default_value: 1,
    hint: "Signed distance to push the selected faces along their normals",
  },
};

function getFaceName(entry: any) {
  const raw = entry?.userData?.faceName ?? entry?.name ?? null;
  if (raw == null) return null;
  const name = String(raw).trim();
  return name || null;
}

function getParentSolid(entry: any) {
  const direct = entry?.parentSolid || null;
  if (direct?.type === "SOLID") return direct;
  const parent = entry?.parent || null;
  return parent?.type === "SOLID" ? parent : null;
}

function collectSelectedFaces(faceEntries: any, partHistory: any) {
  const faces: AnyRecord[] = [];
  const seen = new Set();
  for (const rawEntry of (Array.isArray(faceEntries) ? faceEntries : [])) {
    const entry = resolveSelectionObject(rawEntry, partHistory);
    if (!entry || String(entry?.type || "").toUpperCase() !== "FACE") continue;
    const solid = getParentSolid(entry);
    const faceName = getFaceName(entry);
    if (!solid || !faceName) continue;
    const solidKey = solid?.uuid || solid?.id || solid?.name || "";
    const key = `${solidKey}::${faceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push({ entry, solid, faceName });
  }
  return faces;
}

export class PushFaceFeature {
  static shortName = "PF";
  static longName = "Push Face";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems: any) {
    const faces = (Array.isArray(selectedItems) ? selectedItems : [])
      .filter((item) => String(item?.type || "").toUpperCase() === "FACE")
      .filter((item) => !!getParentSolid(item) && !!getFaceName(item));
    if (!faces.length) return false;
    return { params: { faces } };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  inputParams: AnyRecord;
  persistentData: AnyRecord;

  async run(partHistory: any) {
    const selections = collectSelectedFaces(this.inputParams.faces, partHistory);
    if (!selections.length) {
      console.warn("[PushFaceFeature] No valid faces selected.");
      return { added: [], removed: [] };
    }

    const solids = new Set(selections.map((selection) => selection.solid).filter(Boolean));
    if (!solids.size) {
      console.warn("[PushFaceFeature] Selected faces are not attached to a solid.");
      return { added: [], removed: [] };
    }
    if (solids.size > 1) {
      console.warn("[PushFaceFeature] Faces from multiple solids selected; aborting push face.");
      return { added: [], removed: [] };
    }

    const distance = Number(this.inputParams.distance);
    if (!Number.isFinite(distance) || distance === 0) {
      console.warn("[PushFaceFeature] Distance must be a non-zero finite number.");
      return { added: [], removed: [] };
    }

    const targetSolid = solids.values().next().value;
    const faceNames = [...new Set(selections.map((selection) => selection.faceName).filter(Boolean))];
    if (!faceNames.length) {
      console.warn("[PushFaceFeature] No face names resolved from selection.");
      return { added: [], removed: [] };
    }

    let result = null;
    try {
      result = targetSolid.clone();
      for (const faceName of faceNames) {
        result.pushFace(faceName, distance);
      }
    } catch (error) {
      console.error("[PushFaceFeature] Failed to push selected faces.", error);
      return { added: [], removed: [] };
    }

    const { triCount, vertCount } = getSolidGeometryCounts(result);
    if (!result || triCount === 0 || vertCount === 0) {
      console.error("[PushFaceFeature] pushFace produced an empty result; skipping scene replacement.", {
        featureID: this.inputParams.featureID || this.inputParams.id || null,
        triangleCount: triCount,
        vertexCount: vertCount,
        faceNames,
      });
      return { added: [], removed: [] };
    }

    try { result.name = targetSolid.name; } catch { /* ignore */ }
    try {
      const featureID = this.inputParams.featureID || this.inputParams.id || null;
      if (featureID) result.owningFeatureID = featureID;
    } catch { /* ignore */ }
    try {
      result.userData = {
        ...(result.userData || {}),
        pushFace: {
          faceNames: faceNames.slice(),
          distance,
          sourceSolid: targetSolid.name || null,
        },
      };
    } catch { /* ignore */ }
    try { result.visualize(); } catch { /* ignore */ }
    try { targetSolid.__removeFlag = true; } catch { /* ignore */ }
    return { added: [result], removed: [targetSolid] };
  }
}

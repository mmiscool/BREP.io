import * as THREE from "three";
import { Solid } from "../../../BREP/BetterSolid.js";
import { deepClone } from "../../../utils/deepClone.js";

const EPS = 1e-8;
const POINT_EPS = 1e-4;
const MIN_THICKNESS = 1e-4;
const MIN_LEG = 1e-3;
const ENGINE_TAG = "sheet-metal-core";
const TRIANGLE_AREA_EPS = 1e-14;
const COORD_QUANT = 1e-7;
const EDGE_MATCH_EPS = 1e-3;
const OVERLAP_RELIEF_GAP = .0001;
const FLAT_PATTERN_OVERLAY_Z = 1e-3;
const FLAT_PATTERN_TEXT_RENDER_ORDER = 38;
const FLAT_PATTERN_LINE_RENDER_ORDER = 36;
const FLAT_PATTERN_TEXT_FONT_PX = 220;
const FLAT_PATTERN_TEXT_FONT_FAMILY = "Arial, Helvetica, sans-serif";

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stableStringHash32(value = "") {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sanitizeFaceNameToken(value, fallback = "FACE") {
  const text = String(value || "").trim();
  const cleaned = text.replace(/[^A-Za-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function featureIdFromInstance(instance, fallback = "SheetMetal") {
  const raw =
    instance?.inputParams?.featureID ??
    instance?.inputParams?.id ??
    instance?.inputParams?.name ??
    fallback;
  return String(raw || fallback);
}

function matrixToArray(matrix) {
  if (matrix && matrix.isMatrix4 && Array.isArray(matrix.elements)) {
    return matrix.elements.slice();
  }
  return new THREE.Matrix4().identity().elements.slice();
}

function matrixFromAny(value) {
  if (value && value.isMatrix4) return value.clone();
  if (Array.isArray(value) && value.length === 16) {
    const m = new THREE.Matrix4();
    try {
      m.fromArray(value);
      return m;
    } catch {
      return new THREE.Matrix4().identity();
    }
  }
  if (value && Array.isArray(value.elements) && value.elements.length === 16) {
    const m = new THREE.Matrix4();
    try {
      m.fromArray(value.elements);
      return m;
    } catch {
      return new THREE.Matrix4().identity();
    }
  }
  return new THREE.Matrix4().identity();
}

function applyMatrixToObject(object, matrix) {
  if (!object || !matrix) return;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(pos, quat, scale);
  object.position.copy(pos);
  object.quaternion.copy(quat);
  object.scale.copy(scale);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function cloneTree(tree) {
  return deepClone(tree || {});
}

function isSolidLikeObject(value) {
  return !!(
    value
    && typeof value === "object"
    && (
      String(value.type || "").toUpperCase() === "SOLID"
      || typeof value.subtract === "function"
      || typeof value.union === "function"
      || typeof value._manifoldize === "function"
    )
  );
}

function cloneSolidWorldBaked(solid, nameHint = null) {
  if (!isSolidLikeObject(solid) || typeof solid.clone !== "function") return null;
  const clone = solid.clone();
  try { solid.updateMatrixWorld?.(true); } catch {
    // ignore
  }
  const worldMatrix = matrixFromAny(solid?.matrixWorld);
  try {
    clone.bakeTransform(worldMatrix);
  } catch {
    // best effort; if bake fails use raw clone
  }
  if (nameHint) clone.name = String(nameHint);
  return clone;
}

function serializeSolidSnapshot(solid) {
  if (!isSolidLikeObject(solid)) return null;
  const vertProperties = Array.isArray(solid?._vertProperties) ? solid._vertProperties.slice() : null;
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts.slice() : null;
  const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs.slice() : null;
  if (!vertProperties || !triVerts || !triIDs || !triVerts.length || !triIDs.length) return null;
  return {
    vertProperties,
    triVerts,
    triIDs,
    idToFaceName: (solid?._idToFaceName instanceof Map)
      ? Array.from(solid._idToFaceName.entries()).map(([id, name]) => [toFiniteNumber(id, 0), String(name || "")])
      : [],
    faceMetadata: (solid?._faceMetadata instanceof Map)
      ? Array.from(solid._faceMetadata.entries()).map(([faceName, metadata]) => [String(faceName || ""), deepClone(metadata)])
      : [],
  };
}

function solidFromSnapshot(snapshot, name = "SheetMetalCutout:CUTTER") {
  if (!snapshot || typeof snapshot !== "object") return null;
  const vertProperties = Array.isArray(snapshot.vertProperties) ? snapshot.vertProperties : [];
  const triVerts = Array.isArray(snapshot.triVerts) ? snapshot.triVerts : [];
  const triIDs = Array.isArray(snapshot.triIDs) ? snapshot.triIDs : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!vertProperties.length || triCount <= 0) return null;

  const solid = new Solid();
  solid.name = String(name || "SheetMetalCutout:CUTTER");
  solid._numProp = 3;
  solid._vertProperties = vertProperties.map((value) => toFiniteNumber(value, 0));
  solid._triVerts = triVerts.map((value) => Math.max(0, toFiniteNumber(value, 0) | 0));
  solid._triIDs = (triIDs.length === triCount)
    ? triIDs.map((value) => Math.max(0, toFiniteNumber(value, 0) | 0))
    : new Array(triCount).fill(0);
  solid._vertKeyToIndex = new Map();
  for (let i = 0; i < solid._vertProperties.length; i += 3) {
    const x = solid._vertProperties[i];
    const y = solid._vertProperties[i + 1];
    const z = solid._vertProperties[i + 2];
    solid._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
  }

  const idToFaceName = new Map();
  const entries = Array.isArray(snapshot.idToFaceName) ? snapshot.idToFaceName : [];
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const id = Math.max(0, toFiniteNumber(pair[0], 0) | 0);
    const faceName = String(pair[1] || `CUTOUT_FACE_${id}`);
    if (!idToFaceName.has(id)) idToFaceName.set(id, faceName);
  }
  for (const id of solid._triIDs) {
    if (!idToFaceName.has(id)) idToFaceName.set(id, `CUTOUT_FACE_${id}`);
  }
  solid._idToFaceName = idToFaceName;
  solid._faceNameToID = new Map(Array.from(idToFaceName.entries()).map(([id, faceName]) => [faceName, id]));
  const faceMetadata = new Map();
  const metadataEntries = Array.isArray(snapshot.faceMetadata) ? snapshot.faceMetadata : [];
  for (const pair of metadataEntries) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const faceName = String(pair[0] || "");
    if (!faceName) continue;
    faceMetadata.set(faceName, deepClone(pair[1]));
  }
  solid._faceMetadata = faceMetadata;
  solid._edgeMetadata = new Map();
  solid._auxEdges = [];
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  return solid;
}

function legacyBooleanCutoutGroupKey(faceName, metadata) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const fmt = (value) => Number(toFiniteNumber(value, 0)).toFixed(4);
  const fmtVec = (value) => (Array.isArray(value) ? value.map((item) => fmt(item)).join(",") : "");
  if (meta?.sourceEdgeName) return `sourceEdge:${String(meta.sourceEdgeName)}`;
  if (meta?.sourceFaceName) return `sourceFace:${String(meta.sourceFaceName)}`;
  if (meta?.filletSideWallEdge) return `filletEdge:${String(meta.filletSideWallEdge)}`;
  if (String(meta?.type || "").toLowerCase() === "cylindrical") {
    return `type:cylindrical|radius:${fmt(meta.radius)}|axis:${fmtVec(meta.axis)}|center:${fmtVec(meta.center)}`;
  }
  if (String(meta?.type || "").toLowerCase() === "conical") {
    return `type:conical|r1:${fmt(meta.radiusBottom)}|r2:${fmt(meta.radiusTop)}|axis:${fmtVec(meta.axis)}|center:${fmtVec(meta.center)}`;
  }
  if (meta?.type) return `type:${String(meta.type)}|face:${String(faceName || "")}`;
  return `face:${String(faceName || "")}`;
}

function mergeLegacyBooleanCutoutCutterFaces(cutterSolid, cutoutId) {
  if (!cutterSolid || typeof cutterSolid.getFaceNames !== "function" || typeof cutterSolid.renameFace !== "function") {
    return cutterSolid;
  }

  const targetByFaceName = new Map();
  const representativeMetaByTarget = new Map();
  const faceNames = cutterSolid.getFaceNames();
  for (const faceName of faceNames) {
    if (!faceName) continue;
    const meta = typeof cutterSolid.getFaceMetadata === "function" ? cutterSolid.getFaceMetadata(faceName) : null;
    const groupKey = legacyBooleanCutoutGroupKey(faceName, meta);
    const token = sanitizeFaceNameToken(groupKey, "CUTTER_FACE");
    const hash = stableStringHash32(groupKey).toString(16).slice(-8).padStart(8, "0");
    const targetName = `${String(cutoutId || "CUTOUT")}:CUTTER:${token}:${hash}`;
    targetByFaceName.set(String(faceName), targetName);
    if (!representativeMetaByTarget.has(targetName) && meta && typeof meta === "object") {
      representativeMetaByTarget.set(targetName, deepClone(meta));
    }
  }

  for (const faceName of faceNames) {
    const targetName = targetByFaceName.get(String(faceName));
    if (!targetName || targetName === faceName) continue;
    try {
      cutterSolid.renameFace(faceName, targetName);
    } catch {
      // best effort
    }
  }

  for (const [targetName, meta] of representativeMetaByTarget.entries()) {
    try { cutterSolid.setFaceMetadata(targetName, meta); } catch { }
  }
  return cutterSolid;
}

function mergeLegacyBooleanCutoutFaces(resultSolid, cutterSolid, cutoutId) {
  if (!resultSolid || !cutterSolid) return resultSolid;
  if (typeof resultSolid.renameFace !== "function" || typeof resultSolid.getFaceNames !== "function") return resultSolid;
  if (typeof cutterSolid.getFaceNames !== "function") return resultSolid;

  const groupTargetByFaceName = new Map();
  const representativeMetaByTarget = new Map();
  const cutterFaceNames = cutterSolid.getFaceNames();
  for (const faceName of cutterFaceNames) {
    if (!faceName) continue;
    const meta = typeof cutterSolid.getFaceMetadata === "function" ? cutterSolid.getFaceMetadata(faceName) : null;
    const groupKey = legacyBooleanCutoutGroupKey(faceName, meta);
    const token = sanitizeFaceNameToken(groupKey, "CUTTER_FACE");
    const hash = stableStringHash32(groupKey).toString(16).slice(-8).padStart(8, "0");
    const targetName = `${String(cutoutId || "CUTOUT")}:LEGACY:${token}:${hash}`;
    groupTargetByFaceName.set(String(faceName), targetName);
    if (!representativeMetaByTarget.has(targetName) && meta && typeof meta === "object") {
      representativeMetaByTarget.set(targetName, deepClone(meta));
    }
  }

  const resultFaceNames = resultSolid.getFaceNames();
  for (const currentName of resultFaceNames) {
    const targetName = groupTargetByFaceName.get(String(currentName));
    if (!targetName || targetName === currentName) continue;
    try {
      resultSolid.renameFace(currentName, targetName);
    } catch {
      // best effort
    }
  }

  for (const [targetName, meta] of representativeMetaByTarget.entries()) {
    try {
      resultSolid.setFaceMetadata(targetName, {
        ...meta,
        cutoutId: String(cutoutId || "CUTOUT"),
      });
    } catch {
      // best effort
    }
  }
  return resultSolid;
}

function applyRecordedCutoutsToSolid(baseSolid, tree) {
  const summary = {
    requested: 0,
    applied: 0,
    skipped: 0,
    skippedNonBoolean: 0,
    appliedCutouts: [],
    skippedCutouts: [],
  };
  if (!isSolidLikeObject(baseSolid)) return { solid: baseSolid, summary };

  const cutouts = Array.isArray(tree?.__sheetMeta?.cutouts) ? tree.__sheetMeta.cutouts : [];
  summary.requested = cutouts.length;
  if (!cutouts.length) return { solid: baseSolid, summary };

  let result = baseSolid;
  for (let i = 0; i < cutouts.length; i += 1) {
    const cutout = cutouts[i] || {};
    const cutoutId = String(cutout?.id || `cutout_${i + 1}`);
    const mode = String(cutout?.mode || "").toLowerCase();
    const isLegacyBoolean = !mode || mode === "legacy_boolean";
    if (!isLegacyBoolean) {
      summary.skippedNonBoolean += 1;
      continue;
    }
    const cutter = solidFromSnapshot(cutout?.cutterSnapshot, `${cutoutId}:CUTTER`);
    if (!cutter) {
      summary.skipped += 1;
      summary.skippedCutouts.push({ id: cutoutId, reason: "missing_cutter_snapshot" });
      continue;
    }

    try {
      result = result.subtract(cutter);
      mergeLegacyBooleanCutoutFaces(result, cutter, cutoutId);
      summary.applied += 1;
      summary.appliedCutouts.push({ id: cutoutId });
    } catch (error) {
      summary.skipped += 1;
      summary.skippedCutouts.push({
        id: cutoutId,
        reason: "boolean_subtract_failed",
        message: String(error?.message || error || "Unknown boolean failure"),
      });
    }
  }

  return { solid: result, summary };
}

function normalizeSelectionArray(value) {
  if (!Array.isArray(value)) return value ? [value] : [];
  return value.filter(Boolean);
}

export {
  COORD_QUANT,
  EDGE_MATCH_EPS,
  ENGINE_TAG,
  EPS,
  FLAT_PATTERN_LINE_RENDER_ORDER,
  FLAT_PATTERN_OVERLAY_Z,
  FLAT_PATTERN_TEXT_FONT_FAMILY,
  FLAT_PATTERN_TEXT_FONT_PX,
  FLAT_PATTERN_TEXT_RENDER_ORDER,
  MIN_LEG,
  MIN_THICKNESS,
  OVERLAP_RELIEF_GAP,
  POINT_EPS,
  TRIANGLE_AREA_EPS,
  applyMatrixToObject,
  applyRecordedCutoutsToSolid,
  clamp,
  cloneSolidWorldBaked,
  cloneTree,
  featureIdFromInstance,
  isSolidLikeObject,
  legacyBooleanCutoutGroupKey,
  matrixFromAny,
  matrixToArray,
  mergeLegacyBooleanCutoutCutterFaces,
  normalizeSelectionArray,
  sanitizeFaceNameToken,
  serializeSolidSnapshot,
  stableStringHash32,
  toFiniteNumber,
};

// applyBooleanOperation.js
// Helper to apply a boolean operation between a newly created base solid and
// a list of scene solids referenced by name via the boolean param widget.

import * as THREE from 'three';
import { Solid } from "./BetterSolid.js";
import { Manifold } from "./SolidShared.js";
import {
  applySolidAuthoringStateSnapshot,
  getSyncedCppSolidCore,
  getSolidAuthoringStateSnapshot,
  syncSolidAuthoringStateFromCpp,
} from "./CppSolidCore.js";
import { MeshRepairer } from "./MeshRepairer.js";
import { computeBoundsFromVertices } from "./boundsUtils.js";
import { manifold } from "./setupManifold.js";
import {
  buildBooleanOverlapConditioningPlan,
  SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS,
} from './solidOverlapDiagnosticsCore.js';

const BOOLEAN_TINY_FACE_MAX_AREA = 0.001;
const BOOLEAN_EDGE_POINT_PROXIMITY = 0.0001;

const __booleanDebugConfig = (() => {
  try {
    const runtimeProcess = globalThis?.process;
    if (!runtimeProcess?.env) return null;
    const raw = runtimeProcess.env.DEBUG_BOOLEAN;
    if (!raw) return null;
    const tokens = String(raw)
      .split(/[,;|]+|\s+/g)
      .map(t => t.trim())
      .filter(Boolean);
    if (!tokens.length) return null;
    const cfg = {
      all: false,
      ids: new Set(),
      names: [],
      ops: new Set(),
    };
    for (const tokenRaw of tokens) {
      const token = tokenRaw.trim();
      if (!token) continue;
      const upper = token.toUpperCase();
      if (upper === '*' || upper === 'ALL' || upper === 'TRUE' || upper === '1') {
        cfg.all = true;
        continue;
      }
      if (upper.startsWith('NAME:')) {
        const idx = token.indexOf(':');
        const namePart = idx >= 0 ? token.slice(idx + 1).trim().toLowerCase() : '';
        if (namePart) cfg.names.push(namePart);
        continue;
      }
      if (upper.startsWith('OP:')) {
        const opPart = upper.slice(3).trim();
        if (opPart) cfg.ops.add(opPart);
        continue;
      }
      cfg.ids.add(token);
    }
    return cfg;
  } catch {
    return null;
  }
})();

function __booleanDebugSummarizeSolid(solid) {
  if (!solid || typeof solid !== 'object') return { name: '(null)' };
  const summary = {
    name: solid.name || solid.owningFeatureID || solid.id || solid.uuid || '(unnamed)',
  };
  if (solid.owningFeatureID && solid.owningFeatureID !== summary.name) {
    summary.owningFeatureID = solid.owningFeatureID;
  }
  try {
    const vp = solid._vertProperties;
    if (Array.isArray(vp)) summary.vertexCount = Math.floor(vp.length / 3);
  } catch { }
  try {
    const tris = solid._triVerts || solid._triangles;
    if (Array.isArray(tris)) summary.triangleCount = Math.floor(tris.length / 3);
  } catch { }
  return summary;
}

function __booleanDebugMatch(featureID, op, baseSolid, tools) {
  const cfg = __booleanDebugConfig;
  if (!cfg) return false;
  if (cfg.all) return true;

  const ids = cfg.ids;
  const names = cfg.names;
  const ops = cfg.ops;

  const normalizeName = (obj) => {
    if (!obj || typeof obj !== 'object') return '';
    const raw = obj.name || obj.owningFeatureID || obj.id || obj.uuid || '';
    return String(raw || '').trim();
  };

  const matchesNamePattern = (value) => {
    if (!names || names.length === 0) return false;
    const lower = String(value || '').toLowerCase();
    if (!lower) return false;
    for (const pat of names) {
      if (lower.includes(pat)) return true;
    }
    return false;
  };

  if (featureID != null && ids.has(String(featureID))) return true;

  const opUpper = String(op || '').toUpperCase();
  if (opUpper && ops.has(opUpper)) return true;

  const baseName = normalizeName(baseSolid);
  if (baseName) {
    if (ids.has(baseName)) return true;
    if (matchesNamePattern(baseName)) return true;
  }

  for (const tool of tools || []) {
    const toolName = normalizeName(tool);
    if (!toolName) continue;
    if (ids.has(toolName)) return true;
    if (matchesNamePattern(toolName)) return true;
  }

  return false;
}

function __booleanDebugLogger(featureID, op, baseSolid, tools) {
  const shouldLog = __booleanDebugMatch(featureID, op, baseSolid, tools);
  if (!shouldLog) return () => {};
  const tag = (featureID != null) ? `[BooleanDebug ${featureID}]` : '[BooleanDebug]';
  return (...args) => {
    try { console.log(tag, ...args); } catch { }
  };
}

function __booleanIsFallbackFaceName(name) {
  if (name == null) return true;
  const raw = String(name).trim();
  return !raw || raw === 'FACE' || /^FACE_\d+$/.test(raw);
}

function __booleanIsSyntheticFaceName(name) {
  if (__booleanIsFallbackFaceName(name)) return true;
  const raw = String(name || '').trim();
  if (!raw) return true;
  return /_REPAIR_\d+$/.test(raw);
}

function __booleanGetFaceTrackingStats(solid, sourceFaceNames = null) {
  if (!solid || typeof solid !== 'object') {
    return {
      total: 0,
      descriptive: 0,
      synthetic: 0,
      sourceMatches: 0,
    };
  }
  const names = (solid._faceNameToID instanceof Map)
    ? Array.from(solid._faceNameToID.keys())
    : (typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
  const normalizedNames = Array.isArray(names)
    ? names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  let descriptive = 0;
  let synthetic = 0;
  let sourceMatches = 0;
  for (const faceName of normalizedNames) {
    if (__booleanIsSyntheticFaceName(faceName)) synthetic += 1;
    else descriptive += 1;
    if (sourceFaceNames instanceof Set && sourceFaceNames.has(faceName)) {
      sourceMatches += 1;
    }
  }
  return {
    total: normalizedNames.length,
    descriptive,
    synthetic,
    sourceMatches,
  };
}

function __booleanCollectSourceFaceNames(...sourceSolids) {
  const names = new Set();
  for (const solid of sourceSolids) {
    if (!solid || typeof solid !== 'object') continue;
    const faceNames = (solid._faceNameToID instanceof Map)
      ? Array.from(solid._faceNameToID.keys())
      : (typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
    for (const faceName of Array.isArray(faceNames) ? faceNames : []) {
      const normalized = String(faceName || '').trim();
      if (!normalized || __booleanIsSyntheticFaceName(normalized)) continue;
      names.add(normalized);
    }
  }
  return names;
}

function __booleanCountFaceNameMatches(solid, faceNames) {
  if (!(faceNames instanceof Set) || faceNames.size === 0) return 0;
  const names = (solid?._faceNameToID instanceof Map)
    ? Array.from(solid._faceNameToID.keys())
    : (typeof solid?.getFaceNames === 'function' ? solid.getFaceNames() : []);
  let matches = 0;
  for (const faceName of Array.isArray(names) ? names : []) {
    if (faceNames.has(String(faceName || '').trim())) matches += 1;
  }
  return matches;
}

function __booleanShouldPreferRestoredFaceTracking(originalSolid, restoredSolid, sourceFaceNames, preferredFaceNames = null) {
  const originalStats = __booleanGetFaceTrackingStats(originalSolid, sourceFaceNames);
  const restoredStats = __booleanGetFaceTrackingStats(restoredSolid, sourceFaceNames);
  const originalPreferredMatches = __booleanCountFaceNameMatches(originalSolid, preferredFaceNames);
  const restoredPreferredMatches = __booleanCountFaceNameMatches(restoredSolid, preferredFaceNames);
  if (restoredPreferredMatches > originalPreferredMatches) return true;
  if (restoredStats.sourceMatches > originalStats.sourceMatches) return true;
  if (restoredStats.synthetic < originalStats.synthetic && restoredStats.descriptive >= originalStats.descriptive) {
    return true;
  }
  if (originalStats.descriptive === 0 && restoredStats.descriptive > 0) return true;
  return false;
}

function __booleanHasMeaningfulFaceTracking(solid) {
  if (!solid || typeof solid !== 'object') return false;
  const names = (solid._faceNameToID instanceof Map)
    ? Array.from(solid._faceNameToID.keys())
    : (typeof solid.getFaceNames === 'function' ? solid.getFaceNames() : []);
  if (Array.isArray(names) && names.some((name) => !__booleanIsSyntheticFaceName(name))) {
    return true;
  }
  return solid._faceMetadata instanceof Map && solid._faceMetadata.size > 0;
}

function __booleanCloneMetadataValue(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => __booleanCloneMetadataValue(entry));
  return { ...value };
}

function __booleanCollectMetadataEntries(...sourceSolids) {
  const faceMetadata = new Map();
  const edgeMetadata = new Map();
  const auxEdges = [];
  for (const source of sourceSolids) {
    if (!source) continue;
    const snapshot = getSolidAuthoringStateSnapshot(source);
    const faceEntries = snapshot?.faceMetadataJson instanceof Map
      ? snapshot.faceMetadataJson.entries()
      : Array.isArray(snapshot?.faceMetadataJson) ? snapshot.faceMetadataJson : [];
    for (const [faceName, metadataJson] of faceEntries) {
      const normalizedName = String(faceName || '').trim();
      if (!normalizedName) continue;
      let normalizedJson = String(metadataJson || '').trim();
      if (!normalizedJson) {
        normalizedJson = JSON.stringify({});
      } else {
        try {
          normalizedJson = JSON.stringify(__booleanCloneMetadataValue(JSON.parse(normalizedJson)) || {});
        } catch {
          normalizedJson = JSON.stringify({});
        }
      }
      faceMetadata.set(normalizedName, normalizedJson);
    }
    const edgeEntries = snapshot?.edgeMetadataJson instanceof Map
      ? snapshot.edgeMetadataJson.entries()
      : Array.isArray(snapshot?.edgeMetadataJson) ? snapshot.edgeMetadataJson : [];
    for (const [edgeName, metadataJson] of edgeEntries) {
      const normalizedName = String(edgeName || '').trim();
      if (!normalizedName) continue;
      let normalizedJson = String(metadataJson || '').trim();
      if (!normalizedJson) {
        normalizedJson = JSON.stringify({});
      } else {
        try {
          normalizedJson = JSON.stringify(__booleanCloneMetadataValue(JSON.parse(normalizedJson)) || {});
        } catch {
          normalizedJson = JSON.stringify({});
        }
      }
      edgeMetadata.set(normalizedName, normalizedJson);
    }
    const aux = Array.isArray(snapshot?.auxEdges) ? snapshot.auxEdges : null;
    if (aux && aux.length > 0) {
      for (const entry of aux) auxEdges.push(entry);
    }
  }
  return {
    faceMetadataJson: Array.from(faceMetadata.entries()),
    edgeMetadataJson: Array.from(edgeMetadata.entries()),
    auxEdges,
  };
}

function __booleanApproxScale(solid) {
  try {
    const vp = solid && solid._vertProperties;
    if (!Array.isArray(vp) || vp.length < 3) return 1;
    let minX = +Infinity, minY = +Infinity, minZ = +Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
      const x = vp[i], y = vp[i + 1], z = vp[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const diag = Math.hypot(dx, dy, dz);
    return (diag > 0) ? diag : Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  } catch {
    return 1;
  }
}

function __booleanResolveConditioningOptions(scaleHint = 1) {
  const scale = Math.max(1, Number(scaleHint) || 1);
  return {
    ...SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS,
    planeDistanceTolerance: Math.max(
      SOLID_OVERLAP_DIAGNOSTIC_DEFAULTS.planeDistanceTolerance,
      1e-6 * scale,
    ),
    scaleHint: scale,
  };
}

function __booleanApplyFaceAdjustments(solid, faceAdjustments, debugLog, logContext = null) {
  if (!solid || typeof solid.pushFace !== 'function' || !Array.isArray(faceAdjustments) || faceAdjustments.length === 0) {
    return [];
  }
  const applied = [];
  for (const adjustment of faceAdjustments) {
    const faceName = String(adjustment?.faceName || '').trim();
    const distance = Number(adjustment?.distance);
    if (!faceName || !Number.isFinite(distance) || distance === 0) continue;
    try {
      solid.pushFace(faceName, distance, { warnMissing: false, warnInvalidNormal: false });
      applied.push({
        faceName,
        distance,
        sign: adjustment?.sign || Math.sign(distance) || 0,
        overlapCount: adjustment?.overlapCount || 0,
        overlapArea: adjustment?.overlapArea || 0,
      });
    } catch (err) {
      debugLog?.('Failed to condition boolean face overlap', {
        context: logContext,
        faceName,
        distance,
        message: err?.message || err,
      });
    }
  }
  return applied;
}

function __booleanPointKey(point, precision = 12) {
  return [
    Number(point?.[0] || 0).toFixed(precision),
    Number(point?.[1] || 0).toFixed(precision),
    Number(point?.[2] || 0).toFixed(precision),
  ].join(',');
}

function __booleanGetFaceBoundaryPoints(solid, faceName) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return [];
  const triangles = solid.getFace(faceName) || [];
  if (!Array.isArray(triangles) || triangles.length === 0) return [];

  const edgeMap = new Map();
  const addEdge = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return;
    const ka = __booleanPointKey(a);
    const kb = __booleanPointKey(b);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const current = edgeMap.get(key);
    if (current) {
      current.count += 1;
    } else {
      edgeMap.set(key, {
        count: 1,
        points: [
          [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0],
          [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0],
        ],
      });
    }
  };

  for (const triangle of triangles) {
    const p1 = Array.isArray(triangle?.p1) ? triangle.p1 : null;
    const p2 = Array.isArray(triangle?.p2) ? triangle.p2 : null;
    const p3 = Array.isArray(triangle?.p3) ? triangle.p3 : null;
    if (!p1 || !p2 || !p3) continue;
    addEdge(p1, p2);
    addEdge(p2, p3);
    addEdge(p3, p1);
  }

  const out = [];
  const seen = new Set();
  for (const edge of edgeMap.values()) {
    if (edge.count !== 1) continue;
    for (const point of edge.points) {
      const key = __booleanPointKey(point);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(point);
    }
  }
  return out;
}

function __booleanFaceHasNearTargetEdgePoint(targetSolid, points, tolerance) {
  if (!targetSolid || typeof targetSolid.minGapToPoint !== 'function') return false;
  for (const point of points) {
    const records = targetSolid.minGapToPoint(point, tolerance);
    if (Array.isArray(records) && records.some((record) => Number(record?.distance) <= tolerance)) {
      return true;
    }
  }
  return false;
}

function __booleanScoreFaceSide(targetSolid, solid, faceName, desiredInside, sampleLimit = 8) {
  if (!targetSolid || typeof targetSolid.minGapToPoint !== 'function') return -Infinity;
  const points = __booleanGetFaceBoundaryPoints(solid, faceName);
  if (points.length === 0) return -Infinity;
  const stride = Math.max(1, Math.ceil(points.length / sampleLimit));
  const searchLength = Math.max(__booleanApproxScale(targetSolid) * 2, BOOLEAN_EDGE_POINT_PROXIMITY * 10);
  let score = 0;
  let samples = 0;
  for (let i = 0; i < points.length; i += stride) {
    samples += 1;
    const records = targetSolid.minGapToPoint(points[i], searchLength);
    const inside = Array.isArray(records) && records.length > 0 ? records[0].inside === true : false;
    if (inside === desiredInside) score += 1;
  }
  return samples > 0 ? score / samples : -Infinity;
}

function __booleanConditionEdgePointProximity(op, targetSolid, candidateSolid, debugLog, context = null) {
  const normalizedOp = String(op || '').toUpperCase();
  if (normalizedOp !== 'UNION' && normalizedOp !== 'SUBTRACT') {
    return { solid: candidateSolid, applied: [] };
  }
  if (
    !targetSolid
    || !candidateSolid
    || typeof targetSolid.minGapToPoint !== 'function'
    || typeof candidateSolid.getFaceNames !== 'function'
    || typeof candidateSolid.pushFace !== 'function'
  ) {
    return { solid: candidateSolid, applied: [] };
  }

  const desiredInside = normalizedOp === 'UNION';
  const tolerance = BOOLEAN_EDGE_POINT_PROXIMITY;
  const nudgeDistance = tolerance * 2;
  const faceNames = candidateSolid.getFaceNames() || [];
  const candidates = [];
  for (const rawFaceName of faceNames) {
    const faceName = String(rawFaceName || '').trim();
    if (!faceName) continue;
    const boundaryPoints = __booleanGetFaceBoundaryPoints(candidateSolid, faceName);
    if (boundaryPoints.length === 0) continue;
    if (!__booleanFaceHasNearTargetEdgePoint(targetSolid, boundaryPoints, tolerance)) continue;
    candidates.push(faceName);
  }
  if (candidates.length === 0) return { solid: candidateSolid, applied: [] };

  const working = typeof candidateSolid.clone === 'function' ? candidateSolid.clone() : candidateSolid;
  const applied = [];
  for (const faceName of candidates) {
    let best = null;
    for (const sign of [1, -1]) {
      const probe = typeof working.clone === 'function' ? working.clone() : null;
      if (!probe) continue;
      try {
        probe.pushFace(faceName, sign * nudgeDistance, { warnMissing: false, warnInvalidNormal: false });
        const score = __booleanScoreFaceSide(targetSolid, probe, faceName, desiredInside);
        if (!best || score > best.score) best = { sign, score };
      } catch { /* ignore failed probe */ }
    }
    if (!best || !(best.score > -Infinity)) continue;
    try {
      working.pushFace(faceName, best.sign * nudgeDistance, { warnMissing: false, warnInvalidNormal: false });
      applied.push({
        faceName,
        distance: best.sign * nudgeDistance,
        desiredInside,
        score: best.score,
      });
    } catch (err) {
      debugLog?.('Failed to apply boolean edge-point proximity nudge', {
        context,
        operation: normalizedOp,
        faceName,
        message: err?.message || err,
      });
    }
  }

  if (applied.length > 0) {
    debugLog?.('Applied boolean edge-point proximity nudge', {
      context,
      operation: normalizedOp,
      desiredInside,
      tolerance,
      nudgeDistance,
      adjustments: applied,
    });
    return { solid: working, applied };
  }
  return { solid: candidateSolid, applied: [] };
}

function __booleanConditionOperands(op, stationarySolid, movingSolid, debugLog, context = null) {
  const normalizedOp = String(op || '').toUpperCase();
  if ((normalizedOp !== 'UNION' && normalizedOp !== 'SUBTRACT') || !stationarySolid || !movingSolid) {
    return {
      stationarySolid,
      movingSolid,
      conditioningApplied: false,
      faceAdjustments: [],
      fallbackFaceAdjustments: [],
      plan: null,
      fallbackPlan: null,
    };
  }

  const scaleHint = Math.max(__booleanApproxScale(stationarySolid), __booleanApproxScale(movingSolid), 1);
  const options = {
    ...__booleanResolveConditioningOptions(scaleHint),
    conditioningMode: normalizedOp,
  };
  const moveClone = typeof movingSolid.clone === 'function' ? movingSolid.clone() : movingSolid;
  const plan = buildBooleanOverlapConditioningPlan(stationarySolid, moveClone, options);
  const faceAdjustments = __booleanApplyFaceAdjustments(moveClone, plan?.faceAdjustments, debugLog, context);
  if (faceAdjustments.length > 0) {
    debugLog?.('Applied boolean overlap conditioning', {
      context,
      operation: normalizedOp,
      overlapCount: plan?.overlapCount || 0,
      adjustments: faceAdjustments,
    });
    return {
      stationarySolid,
      movingSolid: moveClone,
      conditioningApplied: true,
      faceAdjustments,
      fallbackFaceAdjustments: [],
      plan,
      fallbackPlan: null,
    };
  }

  if (normalizedOp !== 'UNION' || typeof stationarySolid.clone !== 'function') {
    return {
      stationarySolid,
      movingSolid,
      conditioningApplied: false,
      faceAdjustments: [],
      fallbackFaceAdjustments: [],
      plan,
      fallbackPlan: null,
    };
  }

  const stationaryClone = stationarySolid.clone();
  const fallbackPlan = buildBooleanOverlapConditioningPlan(movingSolid, stationaryClone, options);
  const fallbackFaceAdjustments = __booleanApplyFaceAdjustments(stationaryClone, fallbackPlan?.faceAdjustments, debugLog, context);
  if (fallbackFaceAdjustments.length > 0) {
    debugLog?.('Applied boolean overlap conditioning via stationary fallback', {
      context,
      operation: normalizedOp,
      overlapCount: fallbackPlan?.overlapCount || 0,
      adjustments: fallbackFaceAdjustments,
    });
    return {
      stationarySolid: stationaryClone,
      movingSolid,
      conditioningApplied: true,
      faceAdjustments: [],
      fallbackFaceAdjustments,
      plan,
      fallbackPlan,
    };
  }

  return {
    stationarySolid,
    movingSolid,
    conditioningApplied: false,
    faceAdjustments: [],
    fallbackFaceAdjustments: [],
    plan,
    fallbackPlan,
  };
}

function __booleanCloneMetadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...metadata };
}

function __booleanRefreshAuthoringStateFromNative(solid) {
  if (!solid || typeof solid !== 'object') return;
  const snapshot = getSolidAuthoringStateSnapshot(solid);
  if (!snapshot || typeof snapshot !== 'object') return;
  applySolidAuthoringStateSnapshot(solid, snapshot);
}

function __booleanGetFaceFeatureId(faceName, metadata = null) {
  const explicit = String(
    metadata?.sourceFeatureId
    || metadata?.sourceFeatureID
    || metadata?.featureID
    || '',
  ).trim();
  if (explicit) return explicit;
  const rawName = String(faceName || '').trim();
  if (!rawName) return '';
  const colonIndex = rawName.indexOf(':');
  if (colonIndex <= 0) return '';
  return rawName.slice(0, colonIndex).trim();
}

function __booleanGetFaceType(faceName, metadata = null) {
  const explicit = String(metadata?.faceType || '').trim().toUpperCase();
  if (explicit) return explicit;
  const rawName = String(faceName || '').trim().toUpperCase();
  if (!rawName) return '';
  if (rawName.endsWith('_SW')) return 'SIDEWALL';
  if (rawName.endsWith('PROFILE_START')) return 'STARTCAP';
  if (rawName.endsWith('PROFILE_END')) return 'ENDCAP';
  return '';
}

function __booleanInvalidateSolidCaches(solid) {
  if (!solid || typeof solid !== 'object') return;
  solid._dirty = true;
  solid._faceIndex = null;
  try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
  solid._manifold = null;
}

function __booleanDeriveSolidToleranceFromVerts(solid, baseTol = 1e-5) {
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  if (!vp || vp.length < 6) return baseTol;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i + 0];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const diag = Math.hypot(dx, dy, dz) || 1;
  return Math.max(baseTol, diag * 1e-6);
}

function __booleanBoundaryPolylineLength(points) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  let length = 0;
  if (typeof points[0] === 'number') {
    for (let i = 3; i + 2 < points.length; i += 3) {
      length += Math.hypot(
        (points[i + 0] || 0) - (points[i - 3] || 0),
        (points[i + 1] || 0) - (points[i - 2] || 0),
        (points[i + 2] || 0) - (points[i - 1] || 0),
      );
    }
    return length;
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) continue;
    length += Math.hypot(
      (b[0] || 0) - (a[0] || 0),
      (b[1] || 0) - (a[1] || 0),
      (b[2] || 0) - (a[2] || 0),
    );
  }
  return length;
}

function __booleanAnalyzePlanarFace(solid, faceName) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return null;
  const triangles = solid.getFace(faceName) || [];
  if (!Array.isArray(triangles) || triangles.length === 0) return null;

  let area = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let planePoint = null;
  const points = [];

  for (const triangle of triangles) {
    const p1 = Array.isArray(triangle?.p1) ? triangle.p1 : null;
    const p2 = Array.isArray(triangle?.p2) ? triangle.p2 : null;
    const p3 = Array.isArray(triangle?.p3) ? triangle.p3 : null;
    if (!p1 || !p2 || !p3) continue;
    const ux = (p2[0] || 0) - (p1[0] || 0);
    const uy = (p2[1] || 0) - (p1[1] || 0);
    const uz = (p2[2] || 0) - (p1[2] || 0);
    const vx = (p3[0] || 0) - (p1[0] || 0);
    const vy = (p3[1] || 0) - (p1[1] || 0);
    const vz = (p3[2] || 0) - (p1[2] || 0);
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const triArea = 0.5 * Math.hypot(cx, cy, cz);
    if (!(triArea > 0)) continue;
    nx += cx;
    ny += cy;
    nz += cz;
    area += triArea;
    if (!planePoint) planePoint = [p1[0] || 0, p1[1] || 0, p1[2] || 0];
    points.push(p1, p2, p3);
  }

  const normalLen = Math.hypot(nx, ny, nz);
  if (!(area > 0) || !(normalLen > 1e-12) || !planePoint) return null;
  const normal = [nx / normalLen, ny / normalLen, nz / normalLen];

  return {
    faceName,
    area,
    normal,
    point: planePoint,
    points,
  };
}

function __booleanArePlanarFaceAnalysesCoplanar(faceA, faceB, {
  distanceTolerance = 1e-4,
  normalTolerance = 2e-4,
} = {}) {
  if (!faceA || !faceB) return false;
  const dot = (
    faceA.normal[0] * faceB.normal[0]
    + faceA.normal[1] * faceB.normal[1]
    + faceA.normal[2] * faceB.normal[2]
  );
  if (Math.abs(Math.abs(dot) - 1) > normalTolerance) return false;

  const distanceFromPlane = (normal, planePoint, point) => Math.abs(
    normal[0] * ((point[0] || 0) - (planePoint[0] || 0))
    + normal[1] * ((point[1] || 0) - (planePoint[1] || 0))
    + normal[2] * ((point[2] || 0) - (planePoint[2] || 0))
  );

  if (distanceFromPlane(faceA.normal, faceA.point, faceB.point) > distanceTolerance) return false;
  if (distanceFromPlane(faceB.normal, faceB.point, faceA.point) > distanceTolerance) return false;
  return true;
}

function __booleanMergeCoplanarAdjacentIntersectSidewalls(solid, debugLog, context = null) {
  const op = String(context?.op || '').toUpperCase();
  const featureID = String(context?.featureID || '').trim();
  if (op !== 'INTERSECT' || !featureID) return { mergedFaces: 0 };
  if (
    !solid
    || typeof solid.getFaceNames !== 'function'
    || typeof solid.getFaceMetadata !== 'function'
    || typeof solid.getBoundaryEdgePolylines !== 'function'
    || typeof solid.renameFace !== 'function'
    || typeof solid.setFaceMetadata !== 'function'
  ) {
    return { mergedFaces: 0 };
  }

  const solidTol = __booleanDeriveSolidToleranceFromVerts(solid, 1e-5);
  const distanceTolerance = Math.max(solidTol * 4, 2e-4);
  const normalTolerance = 2e-4;
  const minSharedBoundaryLength = Math.max(distanceTolerance * 10, 1e-3);

  const collectNeighborSharedLengths = () => {
    const map = new Map();
    const add = (from, to, length) => {
      if (!from || !to || !(length > 0)) return;
      let inner = map.get(from);
      if (!inner) {
        inner = new Map();
        map.set(from, inner);
      }
      inner.set(to, (inner.get(to) || 0) + length);
    };

    const boundaries = solid.getBoundaryEdgePolylines() || [];
    for (const boundary of boundaries) {
      const faceA = String(boundary?.faceA || '').trim();
      const faceB = String(boundary?.faceB || '').trim();
      if (!faceA || !faceB || faceA === faceB) continue;
      const sharedLength = __booleanBoundaryPolylineLength(boundary?.positions || boundary?.pts || []);
      if (!(sharedLength > 0)) continue;
      add(faceA, faceB, sharedLength);
      add(faceB, faceA, sharedLength);
    }
    return map;
  };

  const getFaceAnalysis = (() => {
    const cache = new Map();
    return (faceName) => {
      if (!cache.has(faceName)) cache.set(faceName, __booleanAnalyzePlanarFace(solid, faceName));
      return cache.get(faceName);
    };
  })();

  let mergedFaces = 0;
  const maxPasses = Math.max(1, (solid.getFaceNames() || []).length);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const neighborSharedLengths = collectNeighborSharedLengths();
    const currentFeatureFaces = (solid.getFaceNames() || [])
      .map((name) => String(name || '').trim())
      .filter((name) => {
        if (!name) return false;
        const metadata = solid.getFaceMetadata(name) || {};
        return (
          __booleanGetFaceFeatureId(name, metadata) === featureID
          && __booleanGetFaceType(name, metadata) === 'SIDEWALL'
        );
      });
    if (currentFeatureFaces.length === 0) break;

    let mergedThisPass = false;
    for (const faceName of currentFeatureFaces) {
      const faceAnalysis = getFaceAnalysis(faceName);
      if (!faceAnalysis) continue;
      const neighbors = neighborSharedLengths.get(faceName);
      if (!neighbors || neighbors.size === 0) continue;

      let best = null;
      for (const [neighborName, sharedLength] of neighbors.entries()) {
        if (!(sharedLength > minSharedBoundaryLength)) continue;
        const neighborMetadata = solid.getFaceMetadata(neighborName) || {};
        if (__booleanGetFaceFeatureId(neighborName, neighborMetadata) === featureID) continue;
        const neighborFaceType = __booleanGetFaceType(neighborName, neighborMetadata);
        if (neighborFaceType !== 'STARTCAP' && neighborFaceType !== 'ENDCAP') continue;

        const neighborAnalysis = getFaceAnalysis(neighborName);
        if (!neighborAnalysis) continue;
        if (!__booleanArePlanarFaceAnalysesCoplanar(faceAnalysis, neighborAnalysis, {
          distanceTolerance,
          normalTolerance,
        })) {
          continue;
        }

        const candidate = {
          faceName: neighborName,
          sharedLength,
          area: Number(neighborAnalysis.area) || 0,
        };
        if (
          !best
          || candidate.sharedLength > best.sharedLength
          || (candidate.sharedLength === best.sharedLength && candidate.area > best.area)
        ) {
          best = candidate;
        }
      }

      if (!best?.faceName) continue;

      const targetMetadata = __booleanCloneMetadataObject(solid.getFaceMetadata(best.faceName) || {});
      if (!solid.renameFace(faceName, best.faceName)) continue;
      const core = getSyncedCppSolidCore(solid);
      core.setFaceMetadata(best.faceName, targetMetadata);
      syncSolidAuthoringStateFromCpp(solid, core);
      __booleanInvalidateSolidCaches(solid);
      mergedFaces += 1;
      mergedThisPass = true;

      debugLog?.('Merged coplanar intersect sidewall into host face', {
        context,
        sourceFaceName: faceName,
        targetFaceName: best.faceName,
        sharedLength: best.sharedLength,
        distanceTolerance,
        normalTolerance,
      });
      break;
    }

    if (!mergedThisPass) break;
  }

  return {
    mergedFaces,
    distanceTolerance,
    normalTolerance,
  };
}

async function __booleanPostTinyFaceCleanup(solid, debugLog, context = null) {
  if (!solid || typeof solid !== 'object') return solid;
  try {
    if (typeof solid.cleanupTinyFaceIslands === 'function') {
      await solid.cleanupTinyFaceIslands(BOOLEAN_TINY_FACE_MAX_AREA);
    }
  } catch (err) {
    debugLog?.('Post-boolean tiny-face cleanup failed', {
      maxArea: BOOLEAN_TINY_FACE_MAX_AREA,
      context,
      message: err?.message || err,
    });
  }
  try {
    __booleanRefreshAuthoringStateFromNative(solid);
  } catch (err) {
    debugLog?.('Post-boolean authoring-state refresh failed', {
      context,
      message: err?.message || err,
    });
  }
  try {
    __booleanMergeCoplanarAdjacentIntersectSidewalls(solid, debugLog, context);
  } catch (err) {
    debugLog?.('Post-boolean coplanar intersect merge failed', {
      context,
      message: err?.message || err,
    });
  }
  return solid;
}

function __booleanResolveFoldNameSource(baseSolid, tools, featureID) {
  const base = (baseSolid && typeof baseSolid === 'object') ? baseSolid : null;
  const targets = Array.isArray(tools) ? tools.filter(Boolean) : [];
  if (!base && targets.length === 0) return null;
  if (targets.length === 0) return base;

  const featureLabel = (featureID == null) ? '' : String(featureID).trim();
  if (!featureLabel) return base || targets[0] || null;

  const baseName = (base?.name == null) ? '' : String(base.name).trim();
  const baseOwner = (base?.owningFeatureID == null) ? '' : String(base.owningFeatureID).trim();
  const baseLooksLikeFeatureBody = (
    (baseName && baseName === featureLabel)
    || (baseOwner && baseOwner === featureLabel)
  );
  if (baseLooksLikeFeatureBody) {
    return targets[0] || base;
  }
  return base || targets[0];
}

function __booleanSolidToGeometry(solid) {
  try {
    if (!solid || typeof solid !== 'object') return null;
    const vp = solid._vertProperties;
    const tv = solid._triVerts;
    const ids = solid._triIDs;
    if (!Array.isArray(vp) || vp.length < 9) return null;
    if (!Array.isArray(tv) || tv.length < 3) return null;
    if (!Array.isArray(ids) || ids.length !== (tv.length / 3)) return null;

    const vertArray = Float32Array.from(vp);
    const triArray = Uint32Array.from(tv);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(vertArray, 3));
    geom.setIndex(new THREE.BufferAttribute(triArray, 1));

    const bounds = computeBoundsFromVertices(vertArray);
    const size = bounds ? bounds.size : [0, 0, 0];
    const diag = bounds ? bounds.diag : 0;
    const dx = size[0], dy = size[1], dz = size[2];
    const scale = Math.max(diag || 0, Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);

    const idToFaceName = solid._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
    const solidLabel = solid.name || solid.owningFeatureID || 'SOLID';
    const triangles = [];

    for (let t = 0; t < triArray.length; t += 3) {
      const triIndex = t / 3;
      const i0 = triArray[t];
      const i1 = triArray[t + 1];
      const i2 = triArray[t + 2];
      const ax = vertArray[i0 * 3], ay = vertArray[i0 * 3 + 1], az = vertArray[i0 * 3 + 2];
      const bx = vertArray[i1 * 3], by = vertArray[i1 * 3 + 1], bz = vertArray[i1 * 3 + 2];
      const cx = vertArray[i2 * 3], cy = vertArray[i2 * 3 + 1], cz = vertArray[i2 * 3 + 2];

      const centerX = (ax + bx + cx) / 3;
      const centerY = (ay + by + cy) / 3;
      const centerZ = (az + bz + cz) / 3;

      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) {
        nx /= len; ny /= len; nz /= len;
      } else {
        nx = 0; ny = 0; nz = 1;
      }

      const rawName = idToFaceName.get(ids[triIndex]);
      const faceName = rawName ? String(rawName) : `${solidLabel}_FACE_${ids[triIndex] ?? triIndex}`;
      triangles.push({
        center: [centerX, centerY, centerZ],
        normal: [nx, ny, nz],
        faceName,
      });
    }

    return {
      geometry: geom,
      triangles,
      scale,
      fallbackPrefix: `${solidLabel}_REPAIR`,
    };
  } catch {
    return null;
  }
}

function __booleanAssignFaceData(geometry, sourceMeta, debugLog, options = {}) {
  try {
    if (!geometry) return null;
    const indexAttr = geometry.getIndex();
    const posAttr = geometry.getAttribute('position');
    if (!indexAttr || !posAttr) return null;
    const idx = indexAttr.array;
    const pos = posAttr.array;
    if (!idx || !pos) return null;
    const triCount = idx.length / 3;
    if (!(triCount > 0)) return null;

    const triangles = Array.isArray(sourceMeta?.triangles) ? sourceMeta.triangles : [];
    if (!triangles.length) return null;

    const scale = Math.max(1, Number(sourceMeta?.scale) || 1);
    const distLimit = Math.max(1e-9, Math.pow(scale * 5e-3, 2));
    const fallbackPrefix = sourceMeta?.fallbackPrefix || 'REPAIRED';

    const targetTriangles = Array.isArray(options?.targetTriangles) ? options.targetTriangles : null;
    const preferTriangleNearestSourceLabel = options?.preferTriangleNearestSourceLabel === true;
    const regionCandidates = new Map();
    const triRegions = new Array(triCount);
    const triAssignments = new Array(triCount);

    for (let t = 0; t < triCount; t++) {
      const i0 = idx[t * 3];
      const i1 = idx[t * 3 + 1];
      const i2 = idx[t * 3 + 2];
      const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
      const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
      const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];

      const centerX = (ax + bx + cx) / 3;
      const centerY = (ay + by + cy) / 3;
      const centerZ = (az + bz + cz) / 3;

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 0; nz = 1; }

      let bestName = null;
      let bestScore = Infinity;
      let bestPriority = Infinity;

      for (const tri of triangles) {
        const dx = centerX - tri.center[0];
        const dy = centerY - tri.center[1];
        const dz = centerZ - tri.center[2];
        const dist2 = dx * dx + dy * dy + dz * dz;

        const tn = tri.normal;
        const dot = Math.max(0, Math.min(1, Math.abs(nx * tn[0] + ny * tn[1] + nz * tn[2])));
        const normalPenalty = 1 - dot;

        const score = dist2 + normalPenalty * distLimit;
        const priority = Number.isFinite(tri?.sourcePriority) ? Number(tri.sourcePriority) : 0;
        if (score < bestScore || (Math.abs(score - bestScore) <= 1e-12 && priority < bestPriority)) {
          bestScore = score;
          bestName = tri.faceName;
          bestPriority = priority;
        }
      }

      const regionName = String(targetTriangles?.[t]?.faceName || `__tri_${t}`).trim() || `__tri_${t}`;
      triRegions[t] = regionName;
      const isMatched = !!bestName;
      triAssignments[t] = {
        bestName,
        bestPriority,
        bestScore,
        matched: isMatched,
      };
      if (preferTriangleNearestSourceLabel) continue;
      let region = regionCandidates.get(regionName);
      if (!region) {
        region = { candidates: new Map(), triangleCount: 0 };
        regionCandidates.set(regionName, region);
      }
      region.triangleCount += 1;
      if (isMatched) {
        const current = region.candidates.get(bestName) || { totalScore: 0, count: 0, bestPriority: Infinity };
        current.totalScore += bestScore;
        current.count += 1;
        current.bestPriority = Math.min(current.bestPriority, bestPriority);
        region.candidates.set(bestName, current);
      }
    }

    const faceIDs = new Uint32Array(triCount);
    const nameToID = new Map();
    const idToName = new Map();
    let fallbackCount = 0;
    const nextFallbackName = () => `${fallbackPrefix}_${++fallbackCount}`;
    const regionAssignments = new Map();
    let splitRegionCount = 0;

    if (preferTriangleNearestSourceLabel) {
      for (let t = 0; t < triCount; t++) {
        const triAssignment = triAssignments[t] || null;
        let faceName = String(triAssignment?.bestName || '').trim();
        if (!faceName) faceName = nextFallbackName();
        let id = nameToID.get(faceName);
        if (!id) {
          id = Manifold.reserveIDs(1);
          nameToID.set(faceName, id);
          idToName.set(id, faceName);
        }
        faceIDs[t] = id;
      }
      return { faceIDs, idToFaceName: idToName };
    }

    for (const [regionName, region] of regionCandidates.entries()) {
      let bestFaceName = null;
      let bestAverageScore = Infinity;
      let bestPriority = Infinity;
      let matchedTriangleCount = 0;
      let bestMatchCount = 0;
      for (const [candidateName, candidate] of region.candidates.entries()) {
        if (!candidate?.count) continue;
        matchedTriangleCount += candidate.count;
        const averageScore = candidate.totalScore / candidate.count;
        const priority = Number.isFinite(candidate?.bestPriority) ? Number(candidate.bestPriority) : Infinity;
        if (
          averageScore < bestAverageScore
          || (Math.abs(averageScore - bestAverageScore) <= 1e-12 && priority < bestPriority)
        ) {
          bestAverageScore = averageScore;
          bestFaceName = candidateName;
          bestPriority = priority;
        }
        if (candidate.count > bestMatchCount) bestMatchCount = candidate.count;
      }
      if (!bestFaceName) {
        regionAssignments.set(regionName, {
          mode: 'collapse',
          faceName: nextFallbackName(),
        });
        continue;
      }
      const dominantCoverage = matchedTriangleCount > 0 ? (bestMatchCount / matchedTriangleCount) : 1;
      const shouldSplitRegion = region.candidates.size > 1 && matchedTriangleCount > 0 && dominantCoverage < 0.85;
      if (shouldSplitRegion) {
        splitRegionCount += 1;
        regionAssignments.set(regionName, {
          mode: 'split',
          fallbackName: nextFallbackName(),
        });
        continue;
      }
      regionAssignments.set(regionName, {
        mode: 'collapse',
        faceName: bestFaceName,
      });
    }
    if (splitRegionCount > 0) {
      debugLog?.('Boolean face restore split mixed result regions', {
        splitRegionCount,
        totalRegions: regionAssignments.size,
      });
    }

    for (let t = 0; t < triCount; t++) {
      const regionName = triRegions[t] || `__tri_${t}`;
      const regionAssignment = regionAssignments.get(regionName);
      let faceName = regionAssignment?.faceName || null;
      if (regionAssignment?.mode === 'split') {
        const triAssignment = triAssignments[t];
        faceName = triAssignment?.matched && triAssignment?.bestName
          ? triAssignment.bestName
          : regionAssignment.fallbackName;
      }
      if (!faceName) faceName = nextFallbackName();
      let id = nameToID.get(faceName);
      if (!id) {
        id = Manifold.reserveIDs(1);
        nameToID.set(faceName, id);
        idToName.set(id, faceName);
      }
      faceIDs[t] = id;
    }

    return { faceIDs, idToFaceName: idToName };
  } catch (err) {
    debugLog?.('Face reassignment failed', { message: err?.message || err });
    return null;
  }
}

function __booleanMakeSolidFromGeometry(geometry, faceIDs, idToFaceName, debugLog, ...sourceSolids) {
  try {
    if (!geometry || !faceIDs || !idToFaceName) return null;
    if (typeof manifold?.buildSolidAuthoringStateFromMesh !== 'function') {
      throw new Error('Native mesh-to-solid rebuild helper is unavailable.');
    }
    const indexAttr = geometry.getIndex();
    const posAttr = geometry.getAttribute('position');
    if (!indexAttr || !posAttr) return null;
    const metadataEntries = __booleanCollectMetadataEntries(...sourceSolids);
    const faceNameToID = Array.from(idToFaceName.entries(), ([id, faceName]) => [faceName, id]);
    const snapshot = manifold.buildSolidAuthoringStateFromMesh({
      numProp: 3,
      vertProperties: Array.from(posAttr.array || []),
      triVerts: Array.from(indexAttr.array || []),
      faceID: Array.from(faceIDs instanceof Uint32Array ? faceIDs : Uint32Array.from(faceIDs)),
      faceNameToID,
      idToFaceName: Array.from(idToFaceName.entries()),
      faceMetadataJson: metadataEntries.faceMetadataJson,
      edgeMetadataJson: metadataEntries.edgeMetadataJson,
      auxEdges: metadataEntries.auxEdges,
    });
    const rebuilt = new Solid();
    applySolidAuthoringStateSnapshot(rebuilt, snapshot);
    const restoredIdToFaceName = new Map(idToFaceName);
    if (restoredIdToFaceName.size > 0) {
      rebuilt._idToFaceName = restoredIdToFaceName;
      rebuilt._faceNameToID = new Map(Array.from(restoredIdToFaceName.entries(), ([id, faceName]) => [faceName, id]));
      rebuilt._faceMetadata = new Map(
        Array.from(metadataEntries.faceMetadataJson || [], ([faceName, raw]) => {
          try { return [faceName, JSON.parse(raw || "{}")]; } catch { return [faceName, {}]; }
        }).filter(([faceName]) => rebuilt._faceNameToID.has(faceName))
      );
      rebuilt._edgeMetadata = new Map(
        Array.from(metadataEntries.edgeMetadataJson || [], ([edgeName, raw]) => {
          try { return [edgeName, JSON.parse(raw || "{}")]; } catch { return [edgeName, {}]; }
        })
      );
    }
    rebuilt._dirty = true;
    rebuilt._manifold = null;
    rebuilt._faceIndex = null;
    return rebuilt;
  } catch (err) {
    debugLog?.('Solid rebuild failed', { message: err?.message || err });
    return null;
  }
}

function __booleanRestoreFaceTrackingFromSources(solid, debugLog, ...sourceSolids) {
  try {
    if (!solid || typeof solid !== 'object') return solid;
    const validSources = sourceSolids.filter(Boolean);
    if (!validSources.length) return solid;
    const sourceFaceNames = __booleanCollectSourceFaceNames(...validSources);
    const preferredFaceNames = __booleanCollectSourceFaceNames(validSources[0]);
    const solidStats = __booleanGetFaceTrackingStats(solid, sourceFaceNames);
    const operandTrackingLost = validSources.some((entry) => {
      const operandFaceNames = __booleanCollectSourceFaceNames(entry);
      if (operandFaceNames.size === 0) return false;
      return __booleanCountFaceNameMatches(solid, operandFaceNames) === 0;
    });
    const shouldAttemptRestore = (
      !__booleanHasMeaningfulFaceTracking(solid)
      || solidStats.synthetic > 0
      // Boolean operations legitimately consume some source faces (for example,
      // entry/exit caps or the target face being replaced). Treating any
      // missing source label as broken tracking forces an expensive
      // triangle-to-triangle reassignment pass even when the native boolean
      // already preserved descriptive labels correctly. Only rebuild when
      // tracking is synthetic/empty or an entire operand lost all of its
      // descriptive face names in the result.
      || operandTrackingLost
    );
    if (!shouldAttemptRestore) return solid;

    const targetMeta = __booleanSolidToGeometry(solid);
    if (!targetMeta?.geometry) return solid;

    const sourceGeometries = validSources.map((entry) => __booleanSolidToGeometry(entry)).filter(Boolean);
    if (!sourceGeometries.length) {
      try { targetMeta.geometry.dispose(); } catch { }
      return solid;
    }

    try {
      const faceData = __booleanAssignFaceData(targetMeta.geometry, {
        triangles: sourceGeometries.flatMap((entry, sourceIndex) => (
          Array.isArray(entry?.triangles)
            ? entry.triangles.map((triangle) => ({ ...triangle, sourcePriority: sourceIndex }))
            : []
        )),
        scale: Math.max(1, ...sourceGeometries.map((entry) => Number(entry?.scale) || 1)),
        fallbackPrefix: `${solid?.name || validSources[0]?.name || 'BOOLEAN'}_REPAIR`,
      }, debugLog, {
        targetTriangles: targetMeta.triangles,
        preferTriangleNearestSourceLabel: true,
      });
      if (!faceData) return solid;

      const rebuilt = __booleanMakeSolidFromGeometry(
        targetMeta.geometry,
        faceData.faceIDs,
        faceData.idToFaceName,
        debugLog,
        ...validSources,
      );
      if (!rebuilt || !__booleanHasMeaningfulFaceTracking(rebuilt)) return solid;
      if (!__booleanShouldPreferRestoredFaceTracking(solid, rebuilt, sourceFaceNames, preferredFaceNames)) {
        return solid;
      }
      try { rebuilt.name = solid.name || rebuilt.name; } catch { }
      try { rebuilt.owningFeatureID = solid.owningFeatureID || rebuilt.owningFeatureID; } catch { }
      return rebuilt;
    } finally {
      try { targetMeta.geometry.dispose(); } catch { }
      for (const entry of sourceGeometries) {
        try { entry?.geometry?.dispose?.(); } catch { }
      }
    }
  } catch (err) {
    debugLog?.('Face tracking restore failed', { message: err?.message || err });
    return solid;
  }
}

function __booleanAttemptRepairSolid(solid, eps, debugLog) {
  const source = __booleanSolidToGeometry(solid);
  if (!source) return null;

  const baseGeom = source.geometry;
  const repairer = new MeshRepairer();
  const baseWeld = Math.max(1e-5, Math.abs(eps || 0) * 10);
  const attemptScales = [1, 4, 16];

  try {
    for (const scale of attemptScales) {
      const weld = baseWeld * scale;
      const line = Math.max(1e-5, weld);
      const grid = Math.max(1e-4, weld * 2);

      const workingGeom = baseGeom.clone();
      let repairedGeom;
      try {
        repairedGeom = repairer.repairAll(workingGeom, { weldEps: weld, lineEps: line, gridCell: grid }) || workingGeom;
      } catch (err) {
        debugLog?.('Repair attempt failed', {
          attemptScale: scale,
          message: err?.message || err,
        });
        try { workingGeom.dispose(); } catch { }
        continue;
      }

      const faceData = __booleanAssignFaceData(repairedGeom, source, debugLog, {
        targetTriangles: source?.triangles,
      });
      if (!faceData) {
        try { repairedGeom.dispose(); } catch { }
        continue;
      }

      const rebuilt = __booleanMakeSolidFromGeometry(
        repairedGeom, faceData.faceIDs, faceData.idToFaceName, debugLog, solid,
      );
      try { repairedGeom.dispose(); } catch { }
      if (rebuilt) {
        try {
          rebuilt.name = solid.name || rebuilt.name;
          rebuilt.owningFeatureID = solid.owningFeatureID || rebuilt.owningFeatureID;
        } catch { }
        return rebuilt;
      }
    }
  } finally {
    try { baseGeom.dispose(); } catch { }
  }

  return null;
}

function __booleanMeshMergeUnion(baseSolid, toolSolid, eps, debugLog) {
  const srcA = __booleanSolidToGeometry(baseSolid);
  const srcB = __booleanSolidToGeometry(toolSolid);
  if (!srcA || !srcB) {
    try { srcA?.geometry?.dispose?.(); } catch { }
    try { srcB?.geometry?.dispose?.(); } catch { }
    return null;
  }

  const geomA = srcA.geometry;
  const geomB = srcB.geometry;

  const posA = geomA.getAttribute('position')?.array;
  const posB = geomB.getAttribute('position')?.array;
  const idxA = geomA.getIndex()?.array;
  const idxB = geomB.getIndex()?.array;
  if (!posA || !posB || !idxA || !idxB) {
    try { geomA.dispose(); } catch { }
    try { geomB.dispose(); } catch { }
    return null;
  }

  const mergedPosBase = new Float32Array(posA.length + posB.length);
  mergedPosBase.set(posA, 0);
  mergedPosBase.set(posB, posA.length);

  const mergedIdxBase = new Uint32Array(idxA.length + idxB.length);
  mergedIdxBase.set(idxA, 0);
  const offset = (posA.length / 3) >>> 0;
  for (let i = 0; i < idxB.length; i++) {
    mergedIdxBase[idxA.length + i] = idxB[i] + offset;
  }

  try { geomA.dispose(); } catch { }
  try { geomB.dispose(); } catch { }

  const sourceMeta = {
    triangles: [...srcA.triangles, ...srcB.triangles],
    scale: Math.max(srcA.scale || 1, srcB.scale || 1),
    fallbackPrefix: `${baseSolid?.name || toolSolid?.name || 'UNION'}_REPAIR`,
  };

  const repairer = new MeshRepairer();
  const baseWeld = Math.max(1e-5, Math.abs(eps || 0) * 10);
  const attemptScales = [1, 4, 16];

  const buildGeometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mergedPosBase.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(mergedIdxBase.slice(), 1));
    return g;
  };

  for (const scale of attemptScales) {
    const weld = baseWeld * scale;
    const line = Math.max(1e-5, weld);
    const grid = Math.max(1e-4, weld * 2);

    const workingGeom = buildGeometry();
    let repairedGeom;
    try {
      repairedGeom = repairer.repairAll(workingGeom, { weldEps: weld, lineEps: line, gridCell: grid }) || workingGeom;
    } catch (err) {
      debugLog?.('Mesh-merge repair attempt failed', {
        attemptScale: scale,
        message: err?.message || err,
      });
      try { workingGeom.dispose(); } catch { }
      continue;
    }

    const faceData = __booleanAssignFaceData(repairedGeom, sourceMeta, debugLog);
    if (!faceData) {
      try { repairedGeom.dispose(); } catch { }
      continue;
    }

    const rebuilt = __booleanMakeSolidFromGeometry(
      repairedGeom, faceData.faceIDs, faceData.idToFaceName, debugLog, baseSolid, toolSolid,
    );
    try { repairedGeom.dispose(); } catch { }
    if (rebuilt) {
      try {
        rebuilt.name = baseSolid?.name || rebuilt.name;
        rebuilt.owningFeatureID = baseSolid?.owningFeatureID || rebuilt.owningFeatureID;
      } catch { }
      return rebuilt;
    }
  }

  return null;
}

export async function applyBooleanOperation(partHistory, baseSolid, booleanParam, featureID) {
  try {
    if (!booleanParam || typeof booleanParam !== 'object') return { added: [baseSolid], removed: [] };
    // Read canonical operation only
    const opRaw = booleanParam.operation;
    const op = String(opRaw || 'NONE').toUpperCase();
    const tgt = Array.isArray(booleanParam.targets) ? booleanParam.targets.filter(Boolean) : [];

    if (op === 'NONE' || tgt.length === 0) {
      return { added: [baseSolid], removed: [] };
    }

    const scene = partHistory && partHistory.scene ? partHistory.scene : null;
    if (!scene) return { added: [baseSolid], removed: [] };

    // Collect unique tool solids: support either objects or names for back-compat
    const seen = new Set();
    const tools = [];
    for (const entry of tgt) {
      if (!entry) continue;
      if (typeof entry === 'object') {
        const obj = entry;
        const key = obj.uuid || obj.id || obj.name || `${Date.now()}_${tools.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tools.push(obj);
      } else {
        const key = String(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        const obj = await scene.getObjectByName(key);
        if (obj) tools.push(obj);
      }
    }

    if (tools.length === 0) return { added: [baseSolid], removed: [] };

    const debugLog = __booleanDebugLogger(featureID, op, baseSolid, tools);
    const overlapConditioningEnabled = booleanParam?.overlapConditioningEnabled !== false;
    debugLog('Starting boolean', {
      featureID,
      operation: op,
      base: __booleanDebugSummarizeSolid(baseSolid),
      tools: tools.map(__booleanDebugSummarizeSolid),
      targetCount: tools.length,
      overlapConditioningEnabled,
    });

    // Apply selected boolean
    if (op === 'SUBTRACT') {
      // Inverted semantics for subtract: subtract the new baseSolid (tool)
      // FROM each selected target solid. Add robust fallbacks similar to UNION.
      const results = [];
      let idx = 0;
      const preCleanLocal = (solid, eps) => {
        try { if (typeof solid.setEpsilon === 'function') solid.setEpsilon(eps); } catch {}
        try { if (typeof solid.fixTriangleWindingsByAdjacency === 'function') solid.fixTriangleWindingsByAdjacency(); } catch {}
      };

      const addResult = async (solid, target) => {
        solid = await __booleanPostTinyFaceCleanup(solid, debugLog, { op: 'SUBTRACT', featureID });
        const inheritedName = target?.name || target?.uuid || null;
        const finalName = inheritedName || (featureID ? `${featureID}_${++idx}` : solid.name || 'RESULT');
        try { solid.name = finalName; } catch (_) { }
        try {
          if (target?.owningFeatureID) solid.owningFeatureID = target.owningFeatureID;
        } catch (_) { }
        results.push(solid);
      };

      for (const target of tools) {
        let conditionedTarget = target;
        let conditionedTool = baseSolid;
        if (overlapConditioningEnabled) {
          const edgePointConditioning = __booleanConditionEdgePointProximity('SUBTRACT', conditionedTarget, conditionedTool, debugLog, {
            featureID,
            target: conditionedTarget?.name || conditionedTarget?.uuid || null,
            tool: conditionedTool?.name || conditionedTool?.uuid || null,
          });
          conditionedTool = edgePointConditioning.solid || conditionedTool;
          const conditioning = __booleanConditionOperands('SUBTRACT', conditionedTarget, conditionedTool, debugLog, {
            featureID,
            target: conditionedTarget?.name || conditionedTarget?.uuid || null,
            tool: conditionedTool?.name || conditionedTool?.uuid || null,
          });
          conditionedTarget = conditioning.stationarySolid || conditionedTarget;
          conditionedTool = conditioning.movingSolid || conditionedTool;
        }
        let success = false;
        try {
          let out = conditionedTarget.subtract(conditionedTool, { overlapConditioningEnabled: false });
          out = __booleanRestoreFaceTrackingFromSources(out, debugLog, conditionedTarget, conditionedTool);
          await addResult(out, target);
          success = true;
        } catch (e1) {
          debugLog('Primary subtract failed; attempting welded fallback', {
            message: e1?.message || e1,
            target: __booleanDebugSummarizeSolid(target),
            tool: __booleanDebugSummarizeSolid(baseSolid),
          });
        }
        if (success) continue;

        try {
          const a = typeof conditionedTarget.clone === 'function' ? conditionedTarget.clone() : conditionedTarget;
          const b = typeof conditionedTool.clone === 'function' ? conditionedTool.clone() : conditionedTool;
          const scale = Math.max(1, __booleanApproxScale(a));
          const eps = Math.max(1e-9, 1e-6 * scale);
          preCleanLocal(a, eps);
          preCleanLocal(b, eps);
          let out = a.subtract(b, { overlapConditioningEnabled: false });
          out = __booleanRestoreFaceTrackingFromSources(out, debugLog, a, b);
          await addResult(out, target);
          success = true;
        } catch (e2) {
          debugLog('Welded subtract fallback failed; passing target through', {
            message: e2?.message || e2,
            target: __booleanDebugSummarizeSolid(target),
          });
        }
        if (!success) results.push(target);
      }
      // In SUBTRACT: removed = [all targets, baseSolid]
      const removed = [...tools];
      if (baseSolid) removed.push(baseSolid);
      debugLog('Subtract boolean finished', {
        results: results.map(__booleanDebugSummarizeSolid),
        removed: removed.map(__booleanDebugSummarizeSolid),
      });


      return { added: results.length ? results : [baseSolid], removed };
    }

    // Helper: light pre-clean in authoring space (no manifold build)
    const preClean = (solid, eps) => {
      try { if (typeof solid.fixTriangleWindingsByAdjacency === 'function') solid.fixTriangleWindingsByAdjacency(); } catch {}
      try { if (typeof solid.setEpsilon === 'function') solid.setEpsilon(eps); } catch (e) {console.warn(e, solid)}
    };

    // UNION / INTERSECT: fold tools into the new baseSolid and replace base
    let result = baseSolid;
    for (const tool of tools) {
      if (op !== 'UNION' && op !== 'INTERSECT') {
        // Unknown op → pass through
        return { added: [baseSolid], removed: [] };
      }

      let workingResult = result;
      let workingTool = tool;
      if (overlapConditioningEnabled && op === 'UNION') {
        const edgePointConditioning = __booleanConditionEdgePointProximity('UNION', workingTool, workingResult, debugLog, {
          featureID,
          base: workingResult?.name || workingResult?.uuid || null,
          target: workingTool?.name || workingTool?.uuid || null,
        });
        workingResult = edgePointConditioning.solid || workingResult;
        const conditioning = __booleanConditionOperands('UNION', workingResult, workingTool, debugLog, {
          featureID,
          base: workingResult?.name || workingResult?.uuid || null,
          tool: workingTool?.name || workingTool?.uuid || null,
        });
        workingResult = conditioning.stationarySolid || workingResult;
        workingTool = conditioning.movingSolid || tool;
      }

      const scale = Math.max(1, __booleanApproxScale(workingResult));
      const eps = Math.max(1e-9, 1e-6 * scale);

      try {
        // Attempt the boolean directly; repair fallback handles welding if needed.
        result = (op === 'UNION') ? workingResult.union(workingTool, { overlapConditioningEnabled: false }) : workingResult.intersect(workingTool);
        result = __booleanRestoreFaceTrackingFromSources(result, debugLog, workingResult, workingTool);
      } catch (e1) {
        debugLog('Primary union/intersect failed; attempting welded fallback', {
          message: e1?.message || e1,
          tool: __booleanDebugSummarizeSolid(workingTool),
          epsilon: eps,
        });
        let repaired = false;
        try {
          const repairedBase = __booleanAttemptRepairSolid(workingResult, eps, debugLog);
          const repairedTool = __booleanAttemptRepairSolid(workingTool, eps, debugLog);
          if (repairedBase || repairedTool) {
            debugLog('Attempting repair fallback', {
              repairedBase: !!repairedBase,
              repairedTool: !!repairedTool,
            });
            const baseOperand = repairedBase || (typeof workingResult.clone === 'function' ? workingResult.clone() : workingResult);
            const toolOperand = repairedTool || (typeof workingTool.clone === 'function' ? workingTool.clone() : workingTool);
            preClean(baseOperand, eps);
            preClean(toolOperand, eps);
            result = (op === 'UNION') ? baseOperand.union(toolOperand, { overlapConditioningEnabled: false }) : baseOperand.intersect(toolOperand);
            result = __booleanRestoreFaceTrackingFromSources(result, debugLog, baseOperand, toolOperand);
            repaired = true;
          }
        } catch (repairErr) {
          debugLog('Repair fallback failed', { message: repairErr?.message || repairErr });
        }
        if (repaired) continue;
        // Fallback A: try on welded clones with tiny epsilon
        try {
          const a = typeof workingResult.clone === 'function' ? workingResult.clone() : workingResult;
          const b = typeof workingTool.clone === 'function' ? workingTool.clone() : workingTool;
          preClean(a, eps);
          preClean(b, eps);
          result = (op === 'UNION') ? a.union(b, { overlapConditioningEnabled: false }) : a.intersect(b);
          result = __booleanRestoreFaceTrackingFromSources(result, debugLog, a, b);
        } catch (e2) {
          let meshRecovered = false;
          if (op === 'UNION') {
            try {
              const merged = __booleanMeshMergeUnion(workingResult, workingTool, eps, debugLog);
              if (merged) {
                debugLog('Mesh-merge fallback succeeded');
                const repairedMerged = __booleanAttemptRepairSolid(merged, eps, debugLog);
                const mergedHasTracking = __booleanHasMeaningfulFaceTracking(merged);
                const repairedMergedHasTracking = __booleanHasMeaningfulFaceTracking(repairedMerged);
                const finalMerged = (repairedMerged && (!mergedHasTracking || repairedMergedHasTracking))
                  ? repairedMerged
                  : merged;
                if (finalMerged !== merged) {
                  debugLog('Mesh-merge result repaired');
                }
                result = finalMerged;
                meshRecovered = true;
              }
            } catch (meshErr) {
              debugLog('Mesh-merge fallback failed', { message: meshErr?.message || meshErr });
            }
          }
          if (meshRecovered) continue;
          throw e2;
        }
      }
    }
    result = await __booleanPostTinyFaceCleanup(result, debugLog, { op, featureID });
    debugLog('Boolean successful', {
      result: __booleanDebugSummarizeSolid(result),
      removedCount: tools.length + (baseSolid ? 1 : 0),
    });
    const nameSource = __booleanResolveFoldNameSource(baseSolid, tools, featureID);
    const inheritedName = nameSource?.name || nameSource?.uuid || nameSource?.id || null;
    const fallbackName = featureID || result.name || 'RESULT';
    try { result.name = inheritedName || fallbackName; } catch (_) { }
    // UNION/INTERSECT: remove tools and the base solid (replace base with result)
    const removed = tools.slice();
    if (baseSolid) removed.push(baseSolid);
    return { added: [result], removed };
  } catch (err) {
    // On failure, pass through original to avoid breaking the pipeline
    console.warn('[applyBooleanOperation] failed:', err?.message || err);
    const debugLog = __booleanDebugLogger(featureID, booleanParam?.operation, baseSolid, []);
    debugLog('applyBooleanOperation threw; returning base solid', {
      error: err?.message || err,
      stack: err?.stack || null,
    });
    return { added: [baseSolid], removed: [] };
  }
}

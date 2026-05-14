// applyBooleanOperation.js
// Helper to apply a boolean operation between a newly created base solid and
// a list of scene solids referenced by name via the boolean param widget.

const BOOLEAN_TINY_FACE_MAX_AREA = 0.001;

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
  void sourceSolids;
  return {
    faceMetadataJson: [],
    edgeMetadataJson: [],
    auxEdges: [],
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

function __booleanCloneMetadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...metadata };
}

function __booleanRefreshAuthoringStateFromNative(_solid) {
  return;
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
      if (typeof solid.setFaceMetadata === 'function') solid.setFaceMetadata(best.faceName, targetMetadata);
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
  void solid;
  return null;
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
          id = nameToID.size + 1;
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
        id = nameToID.size + 1;
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
  void geometry;
  void faceIDs;
  void idToFaceName;
  void debugLog;
  void sourceSolids;
  return null;
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
  void solid;
  void eps;
  void debugLog;
  return null;
}

function __booleanMeshMergeUnion(baseSolid, toolSolid, eps, debugLog) {
  void baseSolid;
  void toolSolid;
  void eps;
  void debugLog;
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
    debugLog('Starting boolean', {
      featureID,
      operation: op,
      base: __booleanDebugSummarizeSolid(baseSolid),
      tools: tools.map(__booleanDebugSummarizeSolid),
      targetCount: tools.length,
    });

    // Apply selected boolean
    if (op === 'SUBTRACT') {
      // Inverted semantics for subtract: subtract the new baseSolid (tool)
      // FROM each selected target solid. Add robust fallbacks similar to UNION.
      const results = [];
      let idx = 0;
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
        let success = false;
        try {
          let out = conditionedTarget.subtract(conditionedTool);
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
          let out = a.subtract(b);
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

    // UNION / INTERSECT: fold tools into the new baseSolid and replace base
    let result = baseSolid;
    for (const tool of tools) {
      if (op !== 'UNION' && op !== 'INTERSECT') {
        // Unknown op → pass through
        return { added: [baseSolid], removed: [] };
      }

      let workingResult = result;
      let workingTool = tool;

      try {
        // Attempt the boolean directly; repair fallback handles welding if needed.
        result = (op === 'UNION') ? workingTool.union(workingResult) : workingResult.intersect(workingTool);
      } catch (e1) {
        debugLog('Primary union/intersect failed; attempting welded fallback', {
          message: e1?.message || e1,
          tool: __booleanDebugSummarizeSolid(workingTool),
        });
        // Retry once on cloned operands with the same OCCT boolean path.
        const a = typeof workingResult.clone === 'function' ? workingResult.clone() : workingResult;
        const b = typeof workingTool.clone === 'function' ? workingTool.clone() : workingTool;
        result = (op === 'UNION') ? b.union(a) : a.intersect(b);
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

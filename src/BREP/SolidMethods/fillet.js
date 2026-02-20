// Solid.fillet implementation: consolidates fillet logic so features call this API.
// Usage: solid.fillet({ radius, edgeNames, featureID, direction, inflate, resolution, debug, debugSolidsLevel, showTangentOverlays, patchFilletEndCaps })
import { Vertex } from '../Vertex.js';
import { resolveEdgesFromInputs } from './edgeResolution.js';
import { computeFaceAreaFromTriangles } from '../fillets/filletGeometry.js';
import { createQuantizer } from '../../utils/geometryTolerance.js';

// Threshold for collapsing tiny end caps into the round face.
const END_CAP_AREA_RATIO_THRESHOLD = 0.05;

function computeFaceAreaByName(solid, faceName) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return 0;
  try {
    const tris = solid.getFace(faceName);
    return computeFaceAreaFromTriangles(tris);
  } catch {
    return 0;
  }
}

function buildFaceAreaCache(solid) {
  const cache = new Map();
  return {
    get(name) {
      if (!name) return 0;
      if (cache.has(name)) return cache.get(name);
      const area = computeFaceAreaByName(solid, name);
      cache.set(name, area);
      return area;
    }
  };
}

function findNeighborRoundFace(resultSolid, capName, areaCache, boundaryCache) {
  if (!resultSolid || !capName) return null;
  const boundaries = boundaryCache.current || resultSolid.getBoundaryEdgePolylines() || [];
  boundaryCache.current = boundaries;
  let best = null;
  let bestArea = 0;
  for (const poly of boundaries) {
    const a = poly?.faceA;
    const b = poly?.faceB;
    if (a !== capName && b !== capName) continue;
    const other = (a === capName) ? b : a;
    if (!other || typeof other !== 'string') continue;
    if (!other.includes('TUBE_Outer')) continue;
    const aVal = areaCache.get(other);
    if (aVal > bestArea) {
      bestArea = aVal;
      best = other;
    }
  }
  return best;
}

function findLargestRoundFace(resultSolid, areaCache) {
  if (!resultSolid || typeof resultSolid.getFaceNames !== 'function') return null;
  let best = null;
  let bestArea = 0;
  for (const name of resultSolid.getFaceNames()) {
    if (typeof name !== 'string' || !name.includes('TUBE_Outer')) continue;
    const a = areaCache.get(name);
    if (a > bestArea) {
      bestArea = a;
      best = name;
    }
  }
  return best;
}

function getFilletMergeCandidateNames(filletSolid) {
  if (!filletSolid || typeof filletSolid.getFaceNames !== 'function') return [];
  const names = filletSolid.getFaceNames();
  const out = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const meta = (typeof filletSolid.getFaceMetadata === 'function') ? filletSolid.getFaceMetadata(n) : {};
    if (meta && (meta.filletRoundFace || meta.filletSourceArea || meta.filletEndCap)) {
      out.push(n);
      continue;
    }
    if (n.includes('_END_CAP') || n.includes('_CapStart') || n.includes('_CapEnd') || n.includes('_WEDGE_A') || n.includes('_WEDGE_B')) {
      out.push(n);
    }
  }
  return out;
}

function guessRoundFaceName(filletSolid, filletName) {
  const faces = (filletSolid && typeof filletSolid.getFaceNames === 'function')
    ? filletSolid.getFaceNames()
    : [];
  const explicitOuter = faces.find(n => typeof n === 'string' && n.includes('_TUBE_Outer'));
  if (explicitOuter) return explicitOuter;
  if (filletName) {
    const guess = `${filletName}_TUBE_Outer`;
    if (faces.includes(guess)) return guess;
    return guess;
  }
  return null;
}

function mergeFaceIntoTarget(resultSolid, sourceFaceName, targetFaceName) {
  if (!resultSolid || !sourceFaceName || !targetFaceName) return false;
  const faceToId = resultSolid._faceNameToID instanceof Map ? resultSolid._faceNameToID : new Map();
  const idToFace = resultSolid._idToFaceName instanceof Map ? resultSolid._idToFaceName : new Map();
  const sourceID = faceToId.get(sourceFaceName);
  if (sourceID === undefined) return false;
  const targetID = faceToId.get(targetFaceName);

  // If target doesn't exist yet, just relabel the source.
  if (targetID === undefined) {
    idToFace.set(sourceID, targetFaceName);
    faceToId.delete(sourceFaceName);
    faceToId.set(targetFaceName, sourceID);
    if (resultSolid._faceMetadata instanceof Map) {
      const meta = resultSolid._faceMetadata;
      if (!meta.has(targetFaceName) && meta.has(sourceFaceName)) {
        meta.set(targetFaceName, meta.get(sourceFaceName));
      }
      meta.delete(sourceFaceName);
    }
    resultSolid._idToFaceName = idToFace;
    resultSolid._faceNameToID = faceToId;
    resultSolid._faceIndex = null;
    resultSolid._dirty = true;
    return true;
  }

  if (targetID === sourceID) return false;

  const triIDs = Array.isArray(resultSolid._triIDs) ? resultSolid._triIDs : null;
  let replaced = 0;
  if (triIDs) {
    for (let i = 0; i < triIDs.length; i++) {
      if ((triIDs[i] >>> 0) === sourceID) {
        triIDs[i] = targetID;
        replaced++;
      }
    }
    resultSolid._triIDs = triIDs;
  }

  idToFace.delete(sourceID);
  faceToId.delete(sourceFaceName);
  if (resultSolid._faceMetadata instanceof Map) {
    const meta = resultSolid._faceMetadata;
    if (!meta.has(targetFaceName) && meta.has(sourceFaceName)) {
      meta.set(targetFaceName, meta.get(sourceFaceName));
    }
    meta.delete(sourceFaceName);
  }
  resultSolid._idToFaceName = idToFace;
  resultSolid._faceNameToID = faceToId;
  resultSolid._faceIndex = null;
  resultSolid._dirty = true;
  return replaced > 0;
}

function mergeTinyFacesIntoRoundFace(
  resultSolid,
  filletSolid,
  candidateNames,
  roundFaceName,
  boundaryCache,
  resultAreaCache,
  filletAreaCache = null,
) {
  if (!resultSolid || !filletSolid || !Array.isArray(candidateNames) || candidateNames.length === 0) return;
  const areaCacheResult = resultAreaCache || buildFaceAreaCache(resultSolid);
  const areaCacheFillet = filletAreaCache || buildFaceAreaCache(filletSolid);

  for (const capName of candidateNames) {
    const capMeta = (typeof resultSolid.getFaceMetadata === 'function') ? resultSolid.getFaceMetadata(capName) : {};
    const referenceArea = Number(capMeta?.filletSourceArea) > 0 ? Number(capMeta.filletSourceArea) : areaCacheFillet.get(capName);
    if (!(referenceArea > 0)) continue;
    const finalArea = areaCacheResult.get(capName);
    if (!(finalArea > 0)) continue;
    if (finalArea < referenceArea * END_CAP_AREA_RATIO_THRESHOLD) {
      let targetFace = capMeta?.filletRoundFace || roundFaceName;
      const neighborRound = findNeighborRoundFace(resultSolid, capName, areaCacheResult, boundaryCache);
      if (neighborRound) targetFace = neighborRound;
      if (!targetFace) targetFace = findLargestRoundFace(resultSolid, areaCacheResult);
      if (!targetFace) continue;
      mergeFaceIntoTarget(resultSolid, capName, targetFace);
    }
  }
}

function mergeSideFacesIntoRoundFace(resultSolid, filletName, roundFaceName) {
  if (!resultSolid || !filletName || !roundFaceName) return;
  const sideA = `${filletName}_SIDE_A`;
  const sideB = `${filletName}_SIDE_B`;
  const surfaceCA = `${filletName}_SURFACE_CA`;
  const surfaceCB = `${filletName}_SURFACE_CB`;
  mergeFaceIntoTarget(resultSolid, sideA, roundFaceName);
  mergeFaceIntoTarget(resultSolid, sideB, roundFaceName);
  mergeFaceIntoTarget(resultSolid, surfaceCA, roundFaceName);
  mergeFaceIntoTarget(resultSolid, surfaceCB, roundFaceName);
}

function averageFaceNormalSimple(solid, faceName) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return null;
  const tris = solid.getFace(faceName);
  if (!Array.isArray(tris) || tris.length === 0) return null;
  let nx = 0, ny = 0, nz = 0;
  for (const tri of tris) {
    const p1 = tri?.p1;
    const p2 = tri?.p2;
    const p3 = tri?.p3;
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
    const ax = Number(p1[0]) || 0, ay = Number(p1[1]) || 0, az = Number(p1[2]) || 0;
    const bx = Number(p2[0]) || 0, by = Number(p2[1]) || 0, bz = Number(p2[2]) || 0;
    const cx = Number(p3[0]) || 0, cy = Number(p3[1]) || 0, cz = Number(p3[2]) || 0;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const cxn = uy * vz - uz * vy;
    const cyn = uz * vx - ux * vz;
    const czn = ux * vy - uy * vx;
    nx += cxn;
    ny += cyn;
    nz += czn;
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12)) return null;
  return [nx / len, ny / len, nz / len];
}

function deriveSolidToleranceFromVerts(solid, baseTol = 1e-5) {
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

function buildAdjacencyFromBoundaryPolylines(solid) {
  const map = new Map();
  if (!solid || typeof solid.getBoundaryEdgePolylines !== 'function') return map;
  const boundaries = solid.getBoundaryEdgePolylines() || [];
  for (const poly of boundaries) {
    const a = poly?.faceA;
    const b = poly?.faceB;
    if (!a || !b) continue;
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a).add(b);
    map.get(b).add(a);
  }
  return map;
}

function buildAdjacencyFromFaceEdges(solid, faceNames, tol) {
  const { q, k } = createQuantizer(tol);
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToFaces = new Map();
  const faceToEdges = new Map();
  for (const faceName of faceNames) {
    const tris = solid.getFace(faceName);
    if (!Array.isArray(tris) || tris.length === 0) continue;
    const counts = new Map();
    for (const tri of tris) {
      const p1 = tri?.p1;
      const p2 = tri?.p2;
      const p3 = tri?.p3;
      if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
      const v1 = k(q(p1));
      const v2 = k(q(p2));
      const v3 = k(q(p3));
      const e12 = edgeKey(v1, v2);
      const e23 = edgeKey(v2, v3);
      const e31 = edgeKey(v3, v1);
      counts.set(e12, (counts.get(e12) || 0) + 1);
      counts.set(e23, (counts.get(e23) || 0) + 1);
      counts.set(e31, (counts.get(e31) || 0) + 1);
    }
    const boundary = new Set();
    for (const [key, count] of counts.entries()) {
      if (count === 1) boundary.add(key);
    }
    faceToEdges.set(faceName, boundary);
    for (const key of boundary) {
      let set = edgeToFaces.get(key);
      if (!set) { set = new Set(); edgeToFaces.set(key, set); }
      set.add(faceName);
    }
  }
  const adj = new Map();
  for (const [faceName, edges] of faceToEdges.entries()) {
    const set = new Set();
    for (const key of edges) {
      const faces = edgeToFaces.get(key);
      if (!faces) continue;
      for (const f of faces) {
        if (f !== faceName) set.add(f);
      }
    }
    adj.set(faceName, set);
  }
  return adj;
}

function computeFacePlaneInfo(solid, faceName) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return null;
  const tris = solid.getFace(faceName);
  if (!Array.isArray(tris) || tris.length === 0) return null;

  let nx = 0, ny = 0, nz = 0;
  let cx = 0, cy = 0, cz = 0;
  let wSum = 0;
  let rawCx = 0, rawCy = 0, rawCz = 0;
  let rawCount = 0;

  const pushRaw = (p) => {
    if (!Array.isArray(p) || p.length < 3) return;
    const x = Number(p[0]) || 0;
    const y = Number(p[1]) || 0;
    const z = Number(p[2]) || 0;
    rawCx += x;
    rawCy += y;
    rawCz += z;
    rawCount += 1;
  };

  for (const tri of tris) {
    const p1 = tri?.p1;
    const p2 = tri?.p2;
    const p3 = tri?.p3;
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
    pushRaw(p1);
    pushRaw(p2);
    pushRaw(p3);

    const ax = Number(p1[0]) || 0, ay = Number(p1[1]) || 0, az = Number(p1[2]) || 0;
    const bx = Number(p2[0]) || 0, by = Number(p2[1]) || 0, bz = Number(p2[2]) || 0;
    const cxTri = Number(p3[0]) || 0, cyTri = Number(p3[1]) || 0, czTri = Number(p3[2]) || 0;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cxTri - ax, vy = cyTri - ay, vz = czTri - az;
    const crossX = (uy * vz) - (uz * vy);
    const crossY = (uz * vx) - (ux * vz);
    const crossZ = (ux * vy) - (uy * vx);
    const weight = Math.hypot(crossX, crossY, crossZ);
    if (!(weight > 1e-18)) continue;

    nx += crossX;
    ny += crossY;
    nz += crossZ;
    const tx = (ax + bx + cxTri) / 3;
    const ty = (ay + by + cyTri) / 3;
    const tz = (az + bz + czTri) / 3;
    cx += tx * weight;
    cy += ty * weight;
    cz += tz * weight;
    wSum += weight;
  }

  const nLen = Math.hypot(nx, ny, nz);
  if (!(nLen > 1e-12)) return null;
  const n = [nx / nLen, ny / nLen, nz / nLen];
  const center = (wSum > 1e-18)
    ? [cx / wSum, cy / wSum, cz / wSum]
    : (rawCount > 0 ? [rawCx / rawCount, rawCy / rawCount, rawCz / rawCount] : [0, 0, 0]);
  const offset = (n[0] * center[0]) + (n[1] * center[1]) + (n[2] * center[2]);

  return { normal: n, offset, tris };
}

function maxFaceDistanceToPlane(tris, normal, offset) {
  if (!Array.isArray(tris) || !normal || !Number.isFinite(offset)) return Infinity;
  let maxDist = 0;
  const check = (p) => {
    if (!Array.isArray(p) || p.length < 3) return;
    const x = Number(p[0]) || 0;
    const y = Number(p[1]) || 0;
    const z = Number(p[2]) || 0;
    const d = Math.abs((normal[0] * x) + (normal[1] * y) + (normal[2] * z) - offset);
    if (d > maxDist) maxDist = d;
  };
  for (const tri of tris) {
    check(tri?.p1);
    check(tri?.p2);
    check(tri?.p3);
  }
  return maxDist;
}

function areFacesCoplanar(solid, faceA, faceB, planeCache, dotThreshold, planeTol) {
  if (!solid || !faceA || !faceB || faceA === faceB) return false;
  const getPlane = (name) => {
    if (planeCache.has(name)) return planeCache.get(name);
    const info = computeFacePlaneInfo(solid, name);
    planeCache.set(name, info);
    return info;
  };
  const planeA = getPlane(faceA);
  const planeB = getPlane(faceB);
  if (!planeA || !planeB) return false;

  const dot =
    (planeA.normal[0] * planeB.normal[0]) +
    (planeA.normal[1] * planeB.normal[1]) +
    (planeA.normal[2] * planeB.normal[2]);
  if (Math.abs(dot) < dotThreshold) return false;

  const distAToB = maxFaceDistanceToPlane(planeA.tris, planeB.normal, planeB.offset);
  if (!(distAToB <= planeTol)) return false;
  const distBToA = maxFaceDistanceToPlane(planeB.tris, planeA.normal, planeA.offset);
  if (!(distBToA <= planeTol)) return false;
  return true;
}

function mergeOutsetEndCapsByCoplanarity(resultSolid, filletEntries, direction, featureID) {
  if (!resultSolid || String(direction).toUpperCase() !== 'OUTSET') return 0;
  if (typeof resultSolid.getFaceNames !== 'function') return 0;

  const faceHasTris = (name) => {
    if (!name || typeof resultSolid.getFace !== 'function') return false;
    const tris = resultSolid.getFace(name);
    return Array.isArray(tris) && tris.length > 0;
  };

  const endCapCandidates = new Set();
  for (const entry of (Array.isArray(filletEntries) ? filletEntries : [])) {
    const fallbackNames = getFilletMergeCandidateNames(entry?.filletSolid);
    const names = (Array.isArray(entry?.mergeCandidates) && entry.mergeCandidates.length > 0)
      ? entry.mergeCandidates
      : fallbackNames;
    for (const name of names) {
      if (!name || typeof name !== 'string') continue;
      if (isFilletEndCapFaceName(name)) {
        endCapCandidates.add(name);
        continue;
      }
      const meta = (typeof resultSolid.getFaceMetadata === 'function') ? resultSolid.getFaceMetadata(name) : {};
      if (meta?.filletEndCap) endCapCandidates.add(name);
    }
  }

  // Fallback for cases where mergeCandidates did not retain end-cap labels.
  if (endCapCandidates.size === 0) {
    const featurePrefix = featureID ? `${featureID}_FILLET_` : '';
    for (const name of (resultSolid.getFaceNames() || [])) {
      if (typeof name !== 'string') continue;
      if (featurePrefix && !name.startsWith(featurePrefix)) continue;
      if (isFilletEndCapFaceName(name)) endCapCandidates.add(name);
    }
  }
  if (endCapCandidates.size === 0) return 0;

  const endCapFaces = Array.from(endCapCandidates).filter(faceHasTris);
  if (endCapFaces.length === 0) return 0;

  const activeFaceNames = (resultSolid.getFaceNames() || []).filter(faceHasTris);
  const boundaryAdj = buildAdjacencyFromBoundaryPolylines(resultSolid);
  let edgeAdj = null;
  let edgeAdjReady = false;
  const areaCache = buildFaceAreaCache(resultSolid);
  const planeCache = new Map();
  const dotThreshold = 0.999;
  const planeTol = Math.max(deriveSolidToleranceFromVerts(resultSolid, 1e-5) * 25, 1e-6);
  let merged = 0;

  const pickCoplanarNeighbor = (capName, neighbors) => {
    if (!(neighbors instanceof Set) || neighbors.size === 0) return null;
    let best = null;
    let bestArea = -Infinity;
    for (const neighbor of neighbors) {
      if (!neighbor || neighbor === capName) continue;
      if (!faceHasTris(neighbor)) continue;
      if (endCapCandidates.has(neighbor) || isFilletEndCapFaceName(neighbor)) continue;
      if (!areFacesCoplanar(resultSolid, capName, neighbor, planeCache, dotThreshold, planeTol)) continue;
      const area = areaCache.get(neighbor);
      if (area > bestArea) {
        best = neighbor;
        bestArea = area;
      }
    }
    return best;
  };

  for (const capName of endCapFaces) {
    if (!faceHasTris(capName)) continue;
    let targetFace = pickCoplanarNeighbor(capName, boundaryAdj.get(capName));
    if (!targetFace) {
      if (!edgeAdjReady) {
        const tol = deriveSolidToleranceFromVerts(resultSolid, 1e-5);
        edgeAdj = buildAdjacencyFromFaceEdges(resultSolid, activeFaceNames, tol);
        edgeAdjReady = true;
      }
      targetFace = pickCoplanarNeighbor(capName, edgeAdj?.get(capName));
    }
    if (targetFace && mergeFaceIntoTarget(resultSolid, capName, targetFace)) {
      planeCache.delete(capName);
      merged += 1;
    }
  }
  return merged;
}

function mergeInsetEndCapsByNormal(resultSolid, featureID, direction, dotThreshold = 0.999) {
  if (!resultSolid || String(direction).toUpperCase() !== 'INSET') return;
  if (typeof resultSolid.getFaceNames !== 'function') return;
  const faceNames = resultSolid.getFaceNames() || [];
  if (!Array.isArray(faceNames) || faceNames.length === 0) return;
  const faceHasTris = (name) => {
    if (!name || typeof resultSolid.getFace !== 'function') return false;
    const tris = resultSolid.getFace(name);
    return Array.isArray(tris) && tris.length > 0;
  };
  const activeFaceNames = faceNames.filter(faceHasTris);
  const prefix = featureID ? `${featureID}_FILLET_` : '';
  const endCapFaces = activeFaceNames.filter((name) => {
    if (typeof name !== 'string') return false;
    if (prefix && !name.startsWith(prefix)) return false;
    return /_END_CAP_\d+$/.test(name);
  });
  if (!endCapFaces.length) return;

  const adjacentMap = buildAdjacencyFromBoundaryPolylines(resultSolid);
  let edgeAdjMap = null;
  let edgeAdjReady = false;

  const normalCache = new Map();
  const getNormal = (name) => {
    if (normalCache.has(name)) return normalCache.get(name);
    const n = averageFaceNormalSimple(resultSolid, name);
    normalCache.set(name, n);
    return n;
  };
  const tryMergeWithAdj = (capName, adj) => {
    if (!adj || adj.size === 0) return false;
    const nCap = getNormal(capName);
    if (!nCap) return false;
    for (const neighbor of adj) {
      if (neighbor === capName) continue;
      const nAdj = getNormal(neighbor);
      if (!nAdj) continue;
      const dot = (nCap[0] * nAdj[0]) + (nCap[1] * nAdj[1]) + (nCap[2] * nAdj[2]);
      if (dot >= dotThreshold) {
        mergeFaceIntoTarget(resultSolid, capName, neighbor);
        return true;
      }
    }
    return false;
  };

  for (const capName of endCapFaces) {
    const adj = adjacentMap.get(capName);
    if (tryMergeWithAdj(capName, adj)) {
      continue;
    }
    if (!edgeAdjReady) {
      const tol = deriveSolidToleranceFromVerts(resultSolid, 1e-5);
      edgeAdjMap = buildAdjacencyFromFaceEdges(resultSolid, activeFaceNames, tol);
      edgeAdjReady = true;
    }
    if (tryMergeWithAdj(capName, edgeAdjMap?.get(capName))) {
      continue;
    }
  }
}

function isFilletFaceName(faceName, filletNamePrefixes, featureID) {
  if (!faceName || typeof faceName !== 'string') return false;
  if (Array.isArray(filletNamePrefixes) && filletNamePrefixes.length > 0) {
    for (const prefix of filletNamePrefixes) {
      if (prefix && faceName.startsWith(prefix)) return true;
    }
  }
  if (featureID && faceName.startsWith(`${featureID}_CORNER_`)) return true;
  return false;
}

function isFilletEndCapFaceName(faceName) {
  if (!faceName || typeof faceName !== 'string') return false;
  if (/_END_CAP_\d+$/.test(faceName)) return true;
  if (/_TUBE_CapStart$/.test(faceName)) return true;
  if (/_TUBE_CapEnd$/.test(faceName)) return true;
  return false;
}

function closeThreeFaceFilletPointGaps(resultSolid, filletEntries, featureID, captureOriginalPositions = false) {
  const vp = Array.isArray(resultSolid?._vertProperties) ? resultSolid._vertProperties : null;
  const tv = Array.isArray(resultSolid?._triVerts) ? resultSolid._triVerts : null;
  const ids = Array.isArray(resultSolid?._triIDs) ? resultSolid._triIDs : null;
  if (!vp || !tv || !ids) return 0;

  const vertexCount = (vp.length / 3) | 0;
  const triCount = (tv.length / 3) | 0;
  if (vertexCount === 0 || triCount === 0 || ids.length < triCount) return 0;

  const filletNamePrefixes = [];
  for (const entry of (Array.isArray(filletEntries) ? filletEntries : [])) {
    const filletName = entry?.filletName;
    if (typeof filletName === 'string' && filletName.length > 0) {
      filletNamePrefixes.push(filletName);
    }
  }
  if (filletNamePrefixes.length === 0 && !featureID) return 0;

  const faceNameToID = resultSolid?._faceNameToID instanceof Map ? resultSolid._faceNameToID : null;
  const idToFaceName = resultSolid?._idToFaceName instanceof Map ? resultSolid._idToFaceName : null;
  if (!faceNameToID || !idToFaceName) return 0;

  const endCapFaceIDs = new Set();
  for (const [faceName, faceID] of faceNameToID.entries()) {
    if (!isFilletFaceName(faceName, filletNamePrefixes, featureID)) continue;
    if (isFilletEndCapFaceName(faceName)) {
      endCapFaceIDs.add(faceID >>> 0);
    }
  }
  if (endCapFaceIDs.size === 0) return 0;

  const vertexFaces = new Array(vertexCount);
  const edgeMap = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addFaceToVertex = (v, faceID) => {
    let set = vertexFaces[v];
    if (!set) {
      set = new Set();
      vertexFaces[v] = set;
    }
    set.add(faceID >>> 0);
  };
  const addFaceToEdge = (a, b, faceID) => {
    const key = edgeKey(a, b);
    let rec = edgeMap.get(key);
    if (!rec) {
      rec = { a, b, faces: new Set() };
      edgeMap.set(key, rec);
    }
    rec.faces.add(faceID >>> 0);
  };

  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
    const faceID = ids[t] >>> 0;
    addFaceToVertex(i0, faceID);
    addFaceToVertex(i1, faceID);
    addFaceToVertex(i2, faceID);
    addFaceToEdge(i0, i1, faceID);
    addFaceToEdge(i1, i2, faceID);
    addFaceToEdge(i2, i0, faceID);
  }

  const vertexEdges = new Array(vertexCount);
  for (const rec of edgeMap.values()) {
    const a = rec.a >>> 0;
    const b = rec.b >>> 0;
    if (!vertexEdges[a]) vertexEdges[a] = [];
    if (!vertexEdges[b]) vertexEdges[b] = [];
    vertexEdges[a].push({ other: b, faces: rec.faces });
    vertexEdges[b].push({ other: a, faces: rec.faces });
  }

  const edgeHasFacePair = (facesSet, faceA, faceB) => {
    if (!(facesSet instanceof Set) || facesSet.size !== 2) return false;
    let hasA = false;
    let hasB = false;
    for (const raw of facesSet) {
      const f = raw >>> 0;
      if (f === (faceA >>> 0)) hasA = true;
      else if (f === (faceB >>> 0)) hasB = true;
    }
    return hasA && hasB;
  };

  // Walk exactly one cap/support edge chain from the moved tip.
  // Returns interior vertices to collapse plus the fixed endpoint vertex.
  const collectFacePairChainMidpoints = (
    startVertex,
    firstNeighbor,
    capFace,
    supportFaceID,
    oppositeCapFace,
  ) => {
    const start = startVertex >>> 0;
    const first = firstNeighbor >>> 0;
    const oppCap = oppositeCapFace >>> 0;
    if (first >= vertexCount || first === start) return null;

    let prev = start;
    let cur = first;
    let guard = 0;
    const guardLimit = Math.max(16, vertexCount * 2);
    const visited = new Set([start]);
    const mids = [];

    while (guard++ < guardLimit) {
      if (cur >= vertexCount || visited.has(cur)) return null;
      visited.add(cur);

      const incidentAtCur = vertexFaces[cur];
      if (incidentAtCur instanceof Set && incidentAtCur.has(oppCap)) {
        // Do not move the endpoint where the edge meets the opposite cap.
        return { mids, endpoint: cur >>> 0 };
      }

      const recs = vertexEdges[cur];
      if (!Array.isArray(recs) || recs.length === 0) {
        return { mids, endpoint: cur >>> 0 };
      }

      const pairNeighbors = [];
      for (const rec of recs) {
        if (!edgeHasFacePair(rec?.faces, capFace, supportFaceID)) continue;
        const other = rec?.other >>> 0;
        if (other >= vertexCount) continue;
        if (!pairNeighbors.includes(other)) pairNeighbors.push(other);
      }

      // Endpoint on this face-pair chain: only the previous vertex continues.
      if (pairNeighbors.length === 1) {
        if ((pairNeighbors[0] >>> 0) !== (prev >>> 0)) return null;
        return { mids, endpoint: cur >>> 0 };
      }
      if (pairNeighbors.length === 0) {
        return { mids, endpoint: cur >>> 0 };
      }

      // Interior chain vertices should have exactly two neighbors.
      if (pairNeighbors.length !== 2) return null;
      if (!pairNeighbors.includes(prev)) return null;

      mids.push(cur >>> 0);
      const next = (pairNeighbors[0] === prev) ? pairNeighbors[1] : pairNeighbors[0];
      if (next === start || visited.has(next)) {
        return { mids, endpoint: cur >>> 0 };
      }
      prev = cur;
      cur = next >>> 0;
    }
    return null;
  };

  const isEndCapFaceID = (id) => {
    const fid = id >>> 0;
    if (endCapFaceIDs.has(fid)) return true;
    const faceName = idToFaceName.get(fid);
    return isFilletFaceName(faceName, filletNamePrefixes, featureID) && isFilletEndCapFaceName(faceName);
  };

  const movedEndCapFaceIDs = new Set();
  const movedVertexIndices = new Set();
  const movedVertexOriginalPositions = captureOriginalPositions ? new Map() : null;
  let moved = 0;
  let collapsed = 0;
  const recordOriginalPosition = (vi) => {
    if (!(movedVertexOriginalPositions instanceof Map)) return;
    const idx = vi >>> 0;
    if (movedVertexOriginalPositions.has(idx)) return;
    const base = idx * 3;
    if (base + 2 >= vp.length) return;
    movedVertexOriginalPositions.set(idx, [vp[base + 0], vp[base + 1], vp[base + 2]]);
  };
  for (let vi = 0; vi < vertexCount; vi++) {
    const incidentFaces = vertexFaces[vi];
    if (!incidentFaces || incidentFaces.size !== 3) continue;

    const endCapsAtVertex = [];
    const nonEndCapsAtVertex = [];
    for (const faceID of incidentFaces) {
      if (isEndCapFaceID(faceID)) endCapsAtVertex.push(faceID >>> 0);
      else nonEndCapsAtVertex.push(faceID >>> 0);
    }
    if (endCapsAtVertex.length !== 2) continue;
    if ((endCapsAtVertex[0] >>> 0) === (endCapsAtVertex[1] >>> 0)) continue;
    if (nonEndCapsAtVertex.length !== 1) continue;
    const supportFaceID = nonEndCapsAtVertex[0] >>> 0;
    const supportFaceName = idToFaceName.get(supportFaceID);
    // Never drive tip-collapse from the fillet round face; that pulls collapse
    // chains into the rounded area instead of the intended two local edges.
    if (typeof supportFaceName === 'string' && supportFaceName.includes('TUBE_Outer')) continue;
    const capA = endCapsAtVertex[0] >>> 0;
    const capB = endCapsAtVertex[1] >>> 0;

    const edgeRecs = vertexEdges[vi];
    if (!Array.isArray(edgeRecs) || edgeRecs.length < 2) continue;
    const neighborsByCap = new Map([[capA, new Set()], [capB, new Set()]]);
    for (const edgeRec of edgeRecs) {
      const facesOnEdge = edgeRec?.faces;
      if (!(facesOnEdge instanceof Set)) continue;
      if (facesOnEdge.size !== 2) continue;
      const edgeFaces = Array.from(facesOnEdge, (f) => f >>> 0);
      const capFaces = edgeFaces.filter((f) => (f === capA || f === capB));
      if (capFaces.length !== 1) continue;
      const capFace = capFaces[0] >>> 0;
      const otherFace = edgeFaces[0] === capFace ? edgeFaces[1] : edgeFaces[0];
      if ((otherFace >>> 0) !== supportFaceID) continue;
      if (isEndCapFaceID(otherFace)) continue;
      const neighbor = edgeRec.other >>> 0;
      if (neighbor >= vertexCount || neighbor === vi) continue;
      const bucket = neighborsByCap.get(capFace);
      if (!bucket) continue;
      bucket.add(neighbor);
    }

    const neighborsA = Array.from(neighborsByCap.get(capA) || []);
    const neighborsB = Array.from(neighborsByCap.get(capB) || []);
    if (neighborsA.length !== 1 || neighborsB.length !== 1) continue;
    const a = neighborsA[0] >>> 0;
    const b = neighborsB[0] >>> 0;
    if (a === b) continue;
    const chainA = collectFacePairChainMidpoints(vi, a, capA, supportFaceID, capB);
    const chainB = collectFacePairChainMidpoints(vi, b, capB, supportFaceID, capA);
    if (!chainA && !chainB) continue;

    const endpointA = Number.isFinite(chainA?.endpoint) ? (chainA.endpoint >>> 0) : (a >>> 0);
    const endpointB = Number.isFinite(chainB?.endpoint) ? (chainB.endpoint >>> 0) : (b >>> 0);
    if (endpointA >= vertexCount || endpointB >= vertexCount) continue;
    if (endpointA === endpointB) continue;

    const iea = endpointA * 3;
    const ieb = endpointB * 3;
    const iv = vi * 3;
    if (iea + 2 >= vp.length || ieb + 2 >= vp.length || iv + 2 >= vp.length) continue;

    // Move tip to midpoint between the two fixed edge endpoints.
    const mx = 0.5 * (vp[iea + 0] + vp[ieb + 0]);
    const my = 0.5 * (vp[iea + 1] + vp[ieb + 1]);
    const mz = 0.5 * (vp[iea + 2] + vp[ieb + 2]);

    const collapseVertices = new Set();
    for (const cv of (Array.isArray(chainA?.mids) ? chainA.mids : [])) collapseVertices.add(cv >>> 0);
    for (const cv of (Array.isArray(chainB?.mids) ? chainB.mids : [])) collapseVertices.add(cv >>> 0);

    const dx = vp[iv + 0] - mx;
    const dy = vp[iv + 1] - my;
    const dz = vp[iv + 2] - mz;
    const d2 = (dx * dx) + (dy * dy) + (dz * dz);
    if (!(d2 > 1e-24)) continue;

    recordOriginalPosition(vi);
    vp[iv + 0] = mx;
    vp[iv + 1] = my;
    vp[iv + 2] = mz;
    for (const cv of collapseVertices) {
      const ic = (cv >>> 0) * 3;
      if (ic + 2 >= vp.length) continue;
      const ddx = vp[ic + 0] - mx;
      const ddy = vp[ic + 1] - my;
      const ddz = vp[ic + 2] - mz;
      const dd2 = (ddx * ddx) + (ddy * ddy) + (ddz * ddz);
      if (!(dd2 > 1e-24)) continue;
      recordOriginalPosition(cv);
      vp[ic + 0] = mx;
      vp[ic + 1] = my;
      vp[ic + 2] = mz;
      movedVertexIndices.add(cv >>> 0);
      collapsed++;
    }
    movedEndCapFaceIDs.add(capA);
    movedEndCapFaceIDs.add(capB);
    movedVertexIndices.add(vi >>> 0);
    moved++;
  }

  if (moved > 0) {
    resultSolid._vertProperties = vp;
    resultSolid._dirty = true;
    resultSolid._faceIndex = null;
    const keyToIndex = new Map();
    for (let i = 0; i < vp.length; i += 3) {
      const key = `${vp[i + 0]},${vp[i + 1]},${vp[i + 2]}`;
      keyToIndex.set(key, (i / 3) | 0);
    }
    resultSolid._vertKeyToIndex = keyToIndex;
  }

  return {
    movedVertices: moved,
    collapsedVertices: collapsed,
    movedVertexOriginalPositions: movedVertexOriginalPositions || undefined,
    endCapFaceIDs: movedEndCapFaceIDs,
    movedVertexIndices,
  };
}

function buildBoundaryEdgesForRemovedTriangles(tv, ids, removeMask) {
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeMap = new Map();
  const triCount = (tv.length / 3) | 0;

  const markEdge = (a, b, removed, faceID) => {
    const key = edgeKey(a, b);
    let rec = edgeMap.get(key);
    if (!rec) {
      rec = { a: a >>> 0, b: b >>> 0, removed: 0, kept: 0, removedFaceIDs: new Set() };
      edgeMap.set(key, rec);
    }
    if (removed) {
      rec.removed++;
      rec.removedFaceIDs.add(faceID >>> 0);
    } else {
      rec.kept++;
    }
  };

  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    const removed = removeMask[t] === 1;
    const faceID = Array.isArray(ids) ? (ids[t] >>> 0) : 0;
    markEdge(i0, i1, removed, faceID);
    markEdge(i1, i2, removed, faceID);
    markEdge(i2, i0, removed, faceID);
  }

  const boundaryEdges = [];
  for (const rec of edgeMap.values()) {
    if (rec.removed > 0 && rec.kept > 0) {
      boundaryEdges.push({
        a: rec.a >>> 0,
        b: rec.b >>> 0,
        removedFaceIDs: Array.from(rec.removedFaceIDs || [], (id) => id >>> 0),
      });
    }
  }
  return boundaryEdges;
}

function buildBoundaryLoopsFromEdges(boundaryEdges) {
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const adjacency = new Map();
  const unusedEdges = new Set();

  for (const edge of (Array.isArray(boundaryEdges) ? boundaryEdges : [])) {
    if (!Array.isArray(edge) || edge.length < 2) continue;
    const a = edge[0] >>> 0;
    const b = edge[1] >>> 0;
    if (a === b) continue;
    const key = edgeKey(a, b);
    if (unusedEdges.has(key)) continue;
    unusedEdges.add(key);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }

  const loops = [];
  const guardLimit = Math.max(32, unusedEdges.size * 4);
  while (unusedEdges.size > 0) {
    const firstKey = unusedEdges.values().next().value;
    if (!firstKey) break;
    unusedEdges.delete(firstKey);
    const parts = String(firstKey).split('|');
    if (parts.length !== 2) continue;
    const start = Number(parts[0]) >>> 0;
    let prev = start;
    let current = Number(parts[1]) >>> 0;
    const loop = [start, current];

    let guard = 0;
    let closed = false;
    while (guard++ < guardLimit) {
      const neighbors = adjacency.get(current);
      if (!(neighbors instanceof Set) || neighbors.size === 0) break;
      let next = null;
      for (const n of neighbors) {
        if ((n >>> 0) === (prev >>> 0)) continue;
        const k = edgeKey(current, n);
        if (unusedEdges.has(k)) {
          next = n >>> 0;
          break;
        }
      }
      if (next === null) {
        const closeKey = edgeKey(current, start);
        if (unusedEdges.has(closeKey)) next = start;
      }
      if (next === null) break;
      const nextKey = edgeKey(current, next);
      unusedEdges.delete(nextKey);
      if ((next >>> 0) === (start >>> 0)) {
        closed = true;
        break;
      }
      loop.push(next >>> 0);
      prev = current;
      current = next >>> 0;
    }
    if (closed && loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function pruneUnusedFaceIDs(resultSolid) {
  if (!resultSolid) return;
  const triIDs = Array.isArray(resultSolid._triIDs) ? resultSolid._triIDs : null;
  const faceToId = resultSolid._faceNameToID instanceof Map ? resultSolid._faceNameToID : null;
  const idToFace = resultSolid._idToFaceName instanceof Map ? resultSolid._idToFaceName : null;
  if (!triIDs || !faceToId || !idToFace) return;

  const used = new Set();
  for (let i = 0; i < triIDs.length; i++) used.add(triIDs[i] >>> 0);

  for (const [name, id] of Array.from(faceToId.entries())) {
    if (!used.has(id >>> 0)) {
      faceToId.delete(name);
      if (resultSolid._faceMetadata instanceof Map) resultSolid._faceMetadata.delete(name);
    }
  }
  for (const [id] of Array.from(idToFace.entries())) {
    if (!used.has(id >>> 0)) idToFace.delete(id);
  }

  resultSolid._faceNameToID = faceToId;
  resultSolid._idToFaceName = idToFace;
}

function cleanLoopVertexIndices(loop) {
  const out = [];
  if (!Array.isArray(loop)) return out;
  let prev = null;
  for (const raw of loop) {
    const v = raw >>> 0;
    if (prev !== null && v === prev) continue;
    out.push(v);
    prev = v;
  }
  if (out.length >= 2 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function buildLoopEdgeKeys(loop) {
  const keys = new Set();
  if (!Array.isArray(loop) || loop.length < 3) return keys;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] >>> 0;
    const b = loop[(i + 1) % loop.length] >>> 0;
    if (a === b) continue;
    const key = (a < b) ? `${a}|${b}` : `${b}|${a}`;
    keys.add(key);
  }
  return keys;
}

function buildEdgeKeySetFromTriVerts(tv) {
  const out = new Set();
  const triCount = (Array.isArray(tv) ? (tv.length / 3) : 0) | 0;
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    const k01 = (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`;
    const k12 = (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`;
    const k20 = (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`;
    out.add(k01);
    out.add(k12);
    out.add(k20);
  }
  return out;
}

function countSpecificEdgeUses(tv, edgeKeys) {
  const counts = new Map();
  if (!(edgeKeys instanceof Set) || edgeKeys.size === 0) return counts;
  for (const key of edgeKeys) counts.set(key, 0);
  const triCount = (Array.isArray(tv) ? (tv.length / 3) : 0) | 0;
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    const k01 = (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`;
    const k12 = (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`;
    const k20 = (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`;
    if (counts.has(k01)) counts.set(k01, (counts.get(k01) || 0) + 1);
    if (counts.has(k12)) counts.set(k12, (counts.get(k12) || 0) + 1);
    if (counts.has(k20)) counts.set(k20, (counts.get(k20) || 0) + 1);
  }
  return counts;
}

function loopEdgesHaveUseCount(tv, loopEdgeKeys, expectedCount) {
  if (!(loopEdgeKeys instanceof Set) || loopEdgeKeys.size === 0) return false;
  const counts = countSpecificEdgeUses(tv, loopEdgeKeys);
  if (counts.size !== loopEdgeKeys.size) return false;
  const target = expectedCount >>> 0;
  for (const count of counts.values()) {
    if ((count >>> 0) !== target) return false;
  }
  return true;
}

function summarizeEdgeManifoldIssues(tv, vp) {
  const triVerts = Array.isArray(tv) ? tv : [];
  const numVerts = Array.isArray(vp) ? ((vp.length / 3) | 0) : 0;
  const triCount = (triVerts.length / 3) | 0;
  if (triCount <= 0 || numVerts <= 0) {
    return { boundaryEdges: 0, nonManifoldEdges: 0, badOrientationEdges: 0, totalEdges: 0 };
  }
  const NV = BigInt(Math.max(1, numVerts));
  const ukey = (a, b) => {
    const A = BigInt(a >>> 0);
    const B = BigInt(b >>> 0);
    return A < B ? (A * NV + B) : (B * NV + A);
  };

  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = triVerts[base + 0] >>> 0;
    const i1 = triVerts[base + 1] >>> 0;
    const i2 = triVerts[base + 2] >>> 0;
    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (const e of edges) {
      const key = ukey(e[0], e[1]);
      let arr = edgeMap.get(key);
      if (!arr) {
        arr = [];
        edgeMap.set(key, arr);
      }
      arr.push({ a: e[0], b: e[1] });
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let badOrientationEdges = 0;
  for (const arr of edgeMap.values()) {
    if (arr.length < 2) {
      boundaryEdges++;
      continue;
    }
    if (arr.length > 2) {
      nonManifoldEdges++;
      continue;
    }
    const e0 = arr[0];
    const e1 = arr[1];
    if (!((e0.a === e1.b) && (e0.b === e1.a))) {
      badOrientationEdges++;
    }
  }

  return { boundaryEdges, nonManifoldEdges, badOrientationEdges, totalEdges: edgeMap.size };
}

function getVertexPointFromBuffer(vp, vi) {
  const base = (vi >>> 0) * 3;
  if (!Array.isArray(vp) || base + 2 >= vp.length) return null;
  return [vp[base + 0], vp[base + 1], vp[base + 2]];
}

function buildCollapseEdgeDebugVertices(solid, vertexIndices, featureID, originalPositions = null) {
  if (!solid || !(vertexIndices instanceof Set) || vertexIndices.size === 0) return [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  if (!vp || vp.length < 3) return [];
  const uniquePoints = [];
  const seen = new Set();
  const out = [];
  const sorted = Array.from(vertexIndices, (v) => (v >>> 0)).sort((a, b) => a - b);
  for (const vi of sorted) {
    let p = null;
    if (originalPositions instanceof Map && originalPositions.has(vi >>> 0)) {
      const raw = originalPositions.get(vi >>> 0);
      if (Array.isArray(raw) && raw.length >= 3) {
        p = [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0];
      }
    }
    if (!p) {
      const base = (vi >>> 0) * 3;
      if (base + 2 >= vp.length) continue;
      p = [vp[base + 0], vp[base + 1], vp[base + 2]];
    }
    const key = `${p[0]},${p[1]},${p[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePoints.push({ vi, p });
  }
  for (const rec of uniquePoints) {
    const vi = rec.vi >>> 0;
    const p = rec.p;
    const marker = new Vertex(p, { name: `${featureID || 'FILLET'}_COLLAPSE_EDGE_POINT_V${vi}` });
    try {
      const ptMat = marker?._point?.material;
      if (ptMat && ptMat.isPointsMaterial) {
        const mat = ptMat.clone();
        mat.color.set('#ff2b2b');
        mat.size = 11;
        mat.sizeAttenuation = false;
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.transparent = true;
        mat.opacity = 1.0;
        marker._point.material = mat;
      }
      if (marker?._point) {
        marker._point.renderOrder = 10050;
        marker._point.frustumCulled = false;
      }
      marker.renderOrder = 10050;
      marker.frustumCulled = false;
    } catch { }
    try {
      marker.userData = {
        ...(marker.userData || {}),
        filletDebug: true,
        debugType: 'collapse_edge_point',
        vertexIndex: vi >>> 0,
      };
    } catch { }
    out.push(marker);
  }
  return out;
}

function distanceSqBetweenVertices(vp, a, b) {
  const pa = getVertexPointFromBuffer(vp, a);
  const pb = getVertexPointFromBuffer(vp, b);
  if (!pa || !pb) return Infinity;
  const dx = pa[0] - pb[0];
  const dy = pa[1] - pb[1];
  const dz = pa[2] - pb[2];
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function buildCapGuidedChainsFromLoop(loop, edgeFaceIDsByKey, movedVertexIndices, vp) {
  if (!Array.isArray(loop) || loop.length < 4) return null;
  const n = loop.length;
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const movedSet = (movedVertexIndices instanceof Set) ? movedVertexIndices : new Set();

  const uniquePositions = (positions) => {
    const out = [];
    const seen = new Set();
    for (const raw of (Array.isArray(positions) ? positions : [])) {
      const p = ((raw % n) + n) % n;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  };

  const chooseMostSeparatedPair = (positions) => {
    const uniq = uniquePositions(positions);
    if (uniq.length < 2) return null;
    let best = null;
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i] >>> 0;
        const b = uniq[j] >>> 0;
        const cw = (b - a + n) % n;
        const ccw = (a - b + n) % n;
        if (cw <= 0 || ccw <= 0) continue;
        const separation = Math.min(cw, ccw);
        const balance = Math.abs(cw - ccw);
        if (!best
          || separation > best.separation
          || (separation === best.separation && balance < best.balance)) {
          best = { a, b, separation, balance };
        }
      }
    }
    return best ? [best.a >>> 0, best.b >>> 0] : null;
  };

  const buildChain = (startPos, endPos, step) => {
    const out = [loop[startPos] >>> 0];
    let pos = startPos;
    let guard = 0;
    while (pos !== endPos && guard++ < (n + 2)) {
      pos = (pos + step + n) % n;
      out.push(loop[pos] >>> 0);
    }
    if (pos !== endPos) return null;
    return out;
  };

  let anchorPair = null;
  const movedPositions = [];
  for (let i = 0; i < n; i++) {
    const v = loop[i] >>> 0;
    if (movedSet.has(v)) movedPositions.push(i);
  }
  if (movedPositions.length >= 2) {
    anchorPair = chooseMostSeparatedPair(movedPositions);
  }

  if (!anchorPair && (edgeFaceIDsByKey instanceof Map)) {
    const edgeIDs = new Array(n);
    const labelCounts = new Map();
    for (let i = 0; i < n; i++) {
      const a = loop[i] >>> 0;
      const b = loop[(i + 1) % n] >>> 0;
      const idsRaw = edgeFaceIDsByKey.get(edgeKey(a, b));
      const ids = Array.isArray(idsRaw) ? Array.from(new Set(idsRaw.map((id) => id >>> 0))) : [];
      edgeIDs[i] = ids;
      for (const id of ids) labelCounts.set(id, (labelCounts.get(id) || 0) + 1);
    }
    if (labelCounts.size >= 2) {
      const top = Array.from(labelCounts.entries())
        .sort((lhs, rhs) => rhs[1] - lhs[1])
        .slice(0, 2)
        .map((entry) => entry[0] >>> 0);
      const l0 = top[0] >>> 0;
      const l1 = top[1] >>> 0;
      if (l0 !== l1) {
        const labels = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          const ids = edgeIDs[i] || [];
          const has0 = ids.includes(l0);
          const has1 = ids.includes(l1);
          if (has0 && !has1) labels[i] = l0;
          else if (has1 && !has0) labels[i] = l1;
        }

        const nearestLabel = (start, step) => {
          let pos = start;
          for (let dist = 1; dist < n; dist++) {
            pos = (pos + step + n) % n;
            const label = labels[pos] >>> 0;
            if (label !== 0) return { label, dist };
          }
          return null;
        };

        for (let i = 0; i < n; i++) {
          if ((labels[i] >>> 0) !== 0) continue;
          const left = nearestLabel(i, -1);
          const right = nearestLabel(i, +1);
          if (left && !right) {
            labels[i] = left.label >>> 0;
          } else if (!left && right) {
            labels[i] = right.label >>> 0;
          } else if (left && right) {
            if ((left.label >>> 0) === (right.label >>> 0)) labels[i] = left.label >>> 0;
            else labels[i] = (left.dist <= right.dist) ? (left.label >>> 0) : (right.label >>> 0);
          }
        }

        const junctionPos = [];
        for (let i = 0; i < n; i++) {
          const prev = labels[(i - 1 + n) % n] >>> 0;
          const next = labels[i] >>> 0;
          if (prev !== 0 && next !== 0 && prev !== next) junctionPos.push(i);
        }
        if (junctionPos.length >= 2) {
          anchorPair = chooseMostSeparatedPair(junctionPos);
        }
      }
    }
  }

  if (!anchorPair) return null;
  const startPos = anchorPair[0] >>> 0;
  const endPos = anchorPair[1] >>> 0;
  let chainA = buildChain(startPos, endPos, +1);
  let chainB = buildChain(startPos, endPos, -1);
  if (!Array.isArray(chainA) || !Array.isArray(chainB)) return null;
  if (chainA.length < 2 || chainB.length < 2) return null;
  if ((chainA[0] >>> 0) !== (chainB[0] >>> 0)) return null;
  if ((chainA[chainA.length - 1] >>> 0) !== (chainB[chainB.length - 1] >>> 0)) return null;

  const startV = chainA[0] >>> 0;
  const endV = chainA[chainA.length - 1] >>> 0;
  const startIsMoved = movedSet.has(startV);
  const endIsMoved = movedSet.has(endV);
  let reverse = false;
  if (startIsMoved !== endIsMoved) {
    reverse = endIsMoved;
  } else {
    const startWidth = distanceSqBetweenVertices(
      vp,
      chainA[Math.min(1, chainA.length - 1)],
      chainB[Math.min(1, chainB.length - 1)],
    );
    const endWidth = distanceSqBetweenVertices(
      vp,
      chainA[Math.max(0, chainA.length - 2)],
      chainB[Math.max(0, chainB.length - 2)],
    );
    if (Number.isFinite(startWidth) && Number.isFinite(endWidth) && (endWidth < startWidth)) {
      reverse = true;
    }
  }

  if (reverse) {
    chainA = chainA.slice().reverse();
    chainB = chainB.slice().reverse();
  }

  return { chainA, chainB };
}

function triangulateLoopCapGuided(loop, vp, edgeFaceIDsByKey, movedVertexIndices, blockedEdgeKeys = null) {
  if (!Array.isArray(loop) || loop.length < 4) return null;
  const movedSet = (movedVertexIndices instanceof Set) ? movedVertexIndices : new Set();
  const nLoop = loop.length;

  const loopPoints = [];
  for (const vi of loop) {
    const p = getVertexPointFromBuffer(vp, vi);
    if (!p) return null;
    loopPoints.push(p);
  }
  const targetNormal = computeLoopNormal(loopPoints);

  let maxEdgeLenSq = 0;
  for (let k = 0; k < loopPoints.length; k++) {
    const a = loopPoints[k];
    const b = loopPoints[(k + 1) % loopPoints.length];
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    const d2 = (dx * dx) + (dy * dy) + (dz * dz);
    if (d2 > maxEdgeLenSq) maxEdgeLenSq = d2;
  }
  const areaEpsSq = Math.max(1e-32, (maxEdgeLenSq * maxEdgeLenSq) * 1e-24);

  const buildChain = (startPos, endPos, step) => {
    const out = [loop[startPos] >>> 0];
    let pos = startPos;
    let guard = 0;
    while (pos !== endPos && guard++ < (nLoop + 2)) {
      pos = (pos + step + nLoop) % nLoop;
      out.push(loop[pos] >>> 0);
    }
    if (pos !== endPos) return null;
    return out;
  };

  const buildChainsFromAnchors = (startPos, endPos) => {
    const chainA = buildChain(startPos, endPos, +1);
    const chainB = buildChain(startPos, endPos, -1);
    if (!Array.isArray(chainA) || !Array.isArray(chainB)) return null;
    if (chainA.length < 2 || chainB.length < 2) return null;
    if ((chainA[0] >>> 0) !== (chainB[0] >>> 0)) return null;
    if ((chainA[chainA.length - 1] >>> 0) !== (chainB[chainB.length - 1] >>> 0)) return null;
    return { chainA, chainB };
  };

  const orientChains = (chainAIn, chainBIn) => {
    let chainA = Array.isArray(chainAIn) ? chainAIn : [];
    let chainB = Array.isArray(chainBIn) ? chainBIn : [];
    if (chainA.length < 2 || chainB.length < 2) return null;
    const startV = chainA[0] >>> 0;
    const endV = chainA[chainA.length - 1] >>> 0;
    const startIsMoved = movedSet.has(startV);
    const endIsMoved = movedSet.has(endV);
    let reverse = false;
    if (startIsMoved !== endIsMoved) {
      reverse = endIsMoved;
    } else {
      const startWidth = distanceSqBetweenVertices(
        vp,
        chainA[Math.min(1, chainA.length - 1)],
        chainB[Math.min(1, chainB.length - 1)],
      );
      const endWidth = distanceSqBetweenVertices(
        vp,
        chainA[Math.max(0, chainA.length - 2)],
        chainB[Math.max(0, chainB.length - 2)],
      );
      if (Number.isFinite(startWidth) && Number.isFinite(endWidth) && (endWidth < startWidth)) {
        reverse = true;
      }
    }
    if (reverse) {
      chainA = chainA.slice().reverse();
      chainB = chainB.slice().reverse();
    }
    return { chainA, chainB };
  };

  const candidateKey = (chainA, chainB) => `${chainA.join(',')}::${chainB.join(',')}`;
  const seenCandidates = new Set();
  const candidates = [];
  const loopEdgeKeys = buildLoopEdgeKeys(loop);
  const addCandidate = (chainAIn, chainBIn, priority = 0) => {
    const oriented = orientChains(chainAIn, chainBIn);
    if (!oriented) return;
    const chainA = oriented.chainA;
    const chainB = oriented.chainB;
    if (!Array.isArray(chainA) || !Array.isArray(chainB)) return;
    if (chainA.length < 2 || chainB.length < 2) return;
    if ((chainA[0] >>> 0) !== (chainB[0] >>> 0)) return;
    if ((chainA[chainA.length - 1] >>> 0) !== (chainB[chainB.length - 1] >>> 0)) return;
    const key = candidateKey(chainA, chainB);
    if (seenCandidates.has(key)) return;
    seenCandidates.add(key);

    const movedEndpoints =
      (movedSet.has(chainA[0] >>> 0) ? 1 : 0)
      + (movedSet.has(chainA[chainA.length - 1] >>> 0) ? 1 : 0);
    const sep = Math.min(chainA.length, chainB.length);
    const balance = Math.abs(chainA.length - chainB.length);
    const startWidth = distanceSqBetweenVertices(
      vp,
      chainA[Math.min(1, chainA.length - 1)],
      chainB[Math.min(1, chainB.length - 1)],
    );
    const endWidth = distanceSqBetweenVertices(
      vp,
      chainA[Math.max(0, chainA.length - 2)],
      chainB[Math.max(0, chainB.length - 2)],
    );
    const narrow = Number.isFinite(startWidth) && Number.isFinite(endWidth)
      ? Math.min(startWidth, endWidth)
      : Infinity;
    const score = priority
      + (movedEndpoints * 1_000_000)
      + (sep * 1_000)
      - balance
      - (Number.isFinite(narrow) ? (narrow * 1e-3) : 0);
    candidates.push({ chainA, chainB, score });
  };

  const preferredChains = buildCapGuidedChainsFromLoop(loop, edgeFaceIDsByKey, movedVertexIndices, vp);
  if (preferredChains) addCandidate(preferredChains.chainA, preferredChains.chainB, 2_000_000);

  const movedPositions = [];
  for (let i = 0; i < nLoop; i++) {
    if (movedSet.has(loop[i] >>> 0)) movedPositions.push(i);
  }
  for (let i = 0; i < movedPositions.length; i++) {
    for (let j = i + 1; j < movedPositions.length; j++) {
      const pair = buildChainsFromAnchors(movedPositions[i], movedPositions[j]);
      if (!pair) continue;
      addCandidate(pair.chainA, pair.chainB, 1_500_000);
    }
  }

  for (let i = 0; i < nLoop; i++) {
    for (let j = i + 1; j < nLoop; j++) {
      const cw = (j - i + nLoop) % nLoop;
      const ccw = (i - j + nLoop) % nLoop;
      if (cw <= 1 || ccw <= 1) continue;
      const pair = buildChainsFromAnchors(i, j);
      if (!pair) continue;
      const endpointBonus =
        (movedSet.has(loop[i] >>> 0) ? 1 : 0)
        + (movedSet.has(loop[j] >>> 0) ? 1 : 0);
      addCandidate(pair.chainA, pair.chainB, endpointBonus > 0 ? 1_000_000 : 0);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((lhs, rhs) => rhs.score - lhs.score);

  const triAreaSqByIndices = (ia, ib, ic) => {
    const pa = getVertexPointFromBuffer(vp, ia);
    const pb = getVertexPointFromBuffer(vp, ib);
    const pc = getVertexPointFromBuffer(vp, ic);
    if (!pa || !pb || !pc) return 0;
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    return (nx * nx) + (ny * ny) + (nz * nz);
  };

  const triDot = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const dot = (nx * targetNormal[0]) + (ny * targetNormal[1]) + (nz * targetNormal[2]);
    return dot;
  };

  const loopEdgesCoveredExactlyOnce = (rawTris) => {
    if (!(loopEdgeKeys instanceof Set) || loopEdgeKeys.size === 0) return false;
    if (!Array.isArray(rawTris) || rawTris.length === 0) return false;
    const counts = new Map();
    for (const key of loopEdgeKeys) counts.set(key, 0);
    for (const tri of rawTris) {
      if (!Array.isArray(tri) || tri.length < 3) continue;
      const i0 = tri[0] >>> 0;
      const i1 = tri[1] >>> 0;
      const i2 = tri[2] >>> 0;
      const edges = [
        (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`,
        (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`,
        (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`,
      ];
      for (const key of edges) {
        if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    for (const count of counts.values()) {
      if ((count >>> 0) !== 1) return false;
    }
    return true;
  };
  const patchTopologyValid = (rawTris) => {
    if (!Array.isArray(rawTris) || rawTris.length === 0) return false;
    const triKeys = new Set();
    const edgeCounts = new Map();
    for (const tri of rawTris) {
      if (!Array.isArray(tri) || tri.length < 3) return false;
      const i0 = tri[0] >>> 0;
      const i1 = tri[1] >>> 0;
      const i2 = tri[2] >>> 0;
      if (i0 === i1 || i1 === i2 || i2 === i0) return false;
      const triKey = [i0, i1, i2].sort((a, b) => a - b).join('|');
      if (triKeys.has(triKey)) return false;
      triKeys.add(triKey);
      const edges = [
        (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`,
        (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`,
        (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`,
      ];
      for (const key of edges) edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
    for (const [key, count] of edgeCounts.entries()) {
      const c = count >>> 0;
      if (loopEdgeKeys.has(key)) {
        if (c !== 1) return false;
      } else if (c !== 2) {
        return false;
      }
    }
    for (const key of loopEdgeKeys) {
      if ((edgeCounts.get(key) || 0) !== 1) return false;
    }
    return true;
  };
  const summarizeLoopEdgeCoverage = (rawTris) => {
    const counts = new Map();
    if (!(loopEdgeKeys instanceof Set) || loopEdgeKeys.size === 0) {
      return { ok: false, exact: 0, total: 0, missing: [], overused: [] };
    }
    for (const key of loopEdgeKeys) counts.set(key, 0);
    for (const tri of (Array.isArray(rawTris) ? rawTris : [])) {
      if (!Array.isArray(tri) || tri.length < 3) continue;
      const i0 = tri[0] >>> 0;
      const i1 = tri[1] >>> 0;
      const i2 = tri[2] >>> 0;
      const edges = [
        (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`,
        (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`,
        (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`,
      ];
      for (const key of edges) {
        if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    let exact = 0;
    const missing = [];
    const overused = [];
    for (const [key, count] of counts.entries()) {
      const c = count >>> 0;
      if (c === 1) exact++;
      else if (c === 0) missing.push(key);
      else overused.push(`${key}:${c}`);
    }
    const total = counts.size;
    const ok = exact === total;
    return { ok, exact, total, missing, overused };
  };
  const usesBlockedInternalEdges = (rawTris) => {
    if (!(blockedEdgeKeys instanceof Set) || blockedEdgeKeys.size === 0) return false;
    for (const tri of (Array.isArray(rawTris) ? rawTris : [])) {
      if (!Array.isArray(tri) || tri.length < 3) continue;
      const i0 = tri[0] >>> 0;
      const i1 = tri[1] >>> 0;
      const i2 = tri[2] >>> 0;
      const edges = [
        (i0 < i1) ? `${i0}|${i1}` : `${i1}|${i0}`,
        (i1 < i2) ? `${i1}|${i2}` : `${i2}|${i1}`,
        (i2 < i0) ? `${i2}|${i0}` : `${i0}|${i2}`,
      ];
      for (const key of edges) {
        if (loopEdgeKeys.has(key)) continue;
        if (blockedEdgeKeys.has(key)) return true;
      }
    }
    return false;
  };
  const evaluateTriangulationQuality = (rawTris) => {
    if (!Array.isArray(rawTris) || rawTris.length === 0) return Infinity;
    const internalEdges = new Map();
    const addInternalEdge = (a, b) => {
      const va = a >>> 0;
      const vb = b >>> 0;
      if (va === vb) return;
      const key = (va < vb) ? `${va}|${vb}` : `${vb}|${va}`;
      if (loopEdgeKeys.has(key)) return;
      if (internalEdges.has(key)) return;
      const d2 = distanceSqBetweenVertices(vp, va, vb);
      internalEdges.set(key, Number.isFinite(d2) ? d2 : 1e12);
    };
    for (const tri of rawTris) {
      if (!Array.isArray(tri) || tri.length < 3) continue;
      const i0 = tri[0] >>> 0;
      const i1 = tri[1] >>> 0;
      const i2 = tri[2] >>> 0;
      addInternalEdge(i0, i1);
      addInternalEdge(i1, i2);
      addInternalEdge(i2, i0);
    }

    const scale = Math.max(maxEdgeLenSq, 1e-12);
    let maxInternal = 0;
    let sumInternal = 0;
    const incidentInternal = new Map();
    for (const [key, d2] of internalEdges.entries()) {
      if (d2 > maxInternal) maxInternal = d2;
      sumInternal += d2;
      const parts = key.split('|');
      if (parts.length !== 2) continue;
      const a = Number(parts[0]) >>> 0;
      const b = Number(parts[1]) >>> 0;
      incidentInternal.set(a, (incidentInternal.get(a) || 0) + 1);
      incidentInternal.set(b, (incidentInternal.get(b) || 0) + 1);
    }
    let maxInternalDegree = 0;
    for (const degree of incidentInternal.values()) {
      const d = degree >>> 0;
      if (d > maxInternalDegree) maxInternalDegree = d;
    }
    const fanPenalty = Math.max(0, maxInternalDegree - 4);
    return (maxInternal / scale) * 1_000_000
      + (sumInternal / scale) * 10_000
      + (fanPenalty * fanPenalty * 100_000);
  };

  const triangulateChains = (chainA, chainB) => {
    triangulateChains.lastReason = null;
    const fail = (reason) => {
      triangulateChains.lastReason = reason;
      return null;
    };
    if (!Array.isArray(chainA) || !Array.isArray(chainB)) return fail('invalid_chain_input');
    const sanitizeChain = (chainIn) => {
      const out = [];
      for (const raw of (Array.isArray(chainIn) ? chainIn : [])) {
        const v = raw >>> 0;
        if (out.length > 0 && (out[out.length - 1] >>> 0) === v) continue;
        out.push(v);
      }
      return out;
    };
    chainA = sanitizeChain(chainA);
    chainB = sanitizeChain(chainB);
    if (chainA.length < 2 || chainB.length < 2) return fail('chain_too_short');
    if ((chainA[0] >>> 0) !== (chainB[0] >>> 0)) return fail('start_vertices_do_not_match');
    if ((chainA[chainA.length - 1] >>> 0) !== (chainB[chainB.length - 1] >>> 0)) return fail('end_vertices_do_not_match');

    const m = chainA.length;
    const n = chainB.length;
    const progressScale = Math.max(maxEdgeLenSq, 1e-12);
    const distTerm = (a, b) => {
      const d2 = distanceSqBetweenVertices(vp, a, b);
      return Number.isFinite(d2) ? d2 : 1e12;
    };
    const isValidTri = (a, b, c) => {
      if ((a >>> 0) === (b >>> 0) || (b >>> 0) === (c >>> 0) || (c >>> 0) === (a >>> 0)) return false;
      const areaSq = triAreaSqByIndices(a, b, c);
      return Number.isFinite(areaSq) && (areaSq >= 0);
    };
    const triStepCost = (a, b, c, bridgeA, bridgeB) => {
      if (!isValidTri(a, b, c)) return Infinity;
      const ab = distTerm(a, b);
      const bc = distTerm(b, c);
      const ca = distTerm(c, a);
      const maxEdge = Math.max(ab, bc, ca);
      const minEdge = Math.max(Math.min(ab, bc, ca), 1e-30);
      const sumEdges = ab + bc + ca;
      const aspect = maxEdge / minEdge;
      const areaSq = triAreaSqByIndices(a, b, c);
      const bridge = distTerm(bridgeA, bridgeB);
      const sliverPenaltyRaw = Number.isFinite(areaSq)
        ? (1 / Math.max(areaSq, areaEpsSq))
        : 1e12;
      const sliverPenalty = Math.min(1e8, sliverPenaltyRaw);

      // Strongly favor local triangles by minimizing the longest edge first,
      // then total edge length. This discourages long radiating fans.
      return (maxEdge * 1000)
        + (sumEdges * 20)
        + (bridge * 5)
        + (aspect * 0.5)
        + (sliverPenalty * 1e-4);
    };
    const transitionProgressPenalty = (nextI, nextJ) => {
      const denomA = Math.max(1, m - 1);
      const denomB = Math.max(1, n - 1);
      const pA = (nextI >>> 0) / denomA;
      const pB = (nextJ >>> 0) / denomB;
      const imbalance = Math.abs(pA - pB);
      // Penalize one-sided advancement to avoid endpoint-centered fans.
      return (imbalance * imbalance) * progressScale * 250;
    };
    const makeTri = (a, b, c) => {
      const ia = a >>> 0;
      const ib = b >>> 0;
      const ic = c >>> 0;
      if (!isValidTri(ia, ib, ic)) return null;
      return [ia, ib, ic];
    };
    const buildFan = (apex, chain, reverse = false) => {
      const out = [];
      const a = apex >>> 0;
      if (!Array.isArray(chain) || chain.length < 3) return out;
      for (let j = 1; j < chain.length - 1; j++) {
        const b = chain[j] >>> 0;
        const c = chain[j + 1] >>> 0;
        const tri = reverse ? makeTri(a, c, b) : makeTri(a, b, c);
        if (!tri) return null;
        out.push(tri);
      }
      return out;
    };

    if (m === 2 && n === 2) return fail('degenerate_two_edge_loop');
    let raw = null;
    if (m === 2) {
      const s = chainA[0] >>> 0;
      const e = chainA[1] >>> 0;
      raw = buildFan(s, chainB, false);
      if (!raw) raw = buildFan(e, chainB, true);
    } else if (n === 2) {
      const s = chainB[0] >>> 0;
      const e = chainB[1] >>> 0;
      raw = buildFan(s, chainA, true);
      if (!raw) raw = buildFan(e, chainA, false);
    } else {
      const at = (i, j) => (i * n) + j;
      const size = m * n;
      const INF = Number.POSITIVE_INFINITY;
      const runDPWithSeed = (seedI, seedJ, seedTrisIn) => {
        const seedTris = Array.isArray(seedTrisIn) ? seedTrisIn : [];
        if (!(seedI >= 1 && seedI < m && seedJ >= 1 && seedJ < n)) return null;
        const cost = new Array(size).fill(INF);
        const prev = new Array(size).fill(-1);
        const prevTri = new Array(size).fill(null);

        let seedCost = 0;
        for (const tri of seedTris) {
          if (!Array.isArray(tri) || tri.length < 3) return null;
          seedCost += triStepCost(tri[0], tri[1], tri[2], tri[1], tri[2]);
        }
        const startIdx = at(seedI, seedJ);
        cost[startIdx] = seedCost;
        prev[startIdx] = -1;

        for (let i = 1; i < m; i++) {
          for (let j = 1; j < n; j++) {
            const curIdx = at(i, j);
            const curCost = cost[curIdx];
            if (!Number.isFinite(curCost)) continue;
            const ai = chainA[i] >>> 0;
            const bj = chainB[j] >>> 0;

            if (i + 1 < m) {
              const ai1 = chainA[i + 1] >>> 0;
              const tri = makeTri(ai, ai1, bj);
              if (tri) {
                const stepCost = triStepCost(tri[0], tri[1], tri[2], ai1, bj);
                const nxt = at(i + 1, j);
                const cand = curCost + stepCost + transitionProgressPenalty(i + 1, j);
                if (cand < cost[nxt]) {
                  cost[nxt] = cand;
                  prev[nxt] = curIdx;
                  prevTri[nxt] = tri;
                }
              }
            }
            if (j + 1 < n) {
              const bj1 = chainB[j + 1] >>> 0;
              const tri = makeTri(ai, bj1, bj);
              if (tri) {
                const stepCost = triStepCost(tri[0], tri[1], tri[2], ai, bj1);
                const nxt = at(i, j + 1);
                const cand = curCost + stepCost + transitionProgressPenalty(i, j + 1);
                if (cand < cost[nxt]) {
                  cost[nxt] = cand;
                  prev[nxt] = curIdx;
                  prevTri[nxt] = tri;
                }
              }
            }
          }
        }

        const buildTail = (i, j) => {
          const tail = [];
          if (i === (m - 1) && j < (n - 1)) {
            const e = chainA[m - 1] >>> 0;
            for (let k = j; k < n - 2; k++) {
              const tri = makeTri(e, chainB[k + 1] >>> 0, chainB[k] >>> 0);
              if (!tri) return null;
              tail.push(tri);
            }
            return tail;
          }
          if (j === (n - 1) && i < (m - 1)) {
            const e = chainB[n - 1] >>> 0;
            for (let k = i; k < m - 2; k++) {
              const tri = makeTri(e, chainA[k] >>> 0, chainA[k + 1] >>> 0);
              if (!tri) return null;
              tail.push(tri);
            }
            return tail;
          }
          if (i === (m - 1) && j === (n - 1)) return tail;
          return null;
        };

        let endIdx = -1;
        let endTail = null;
        let bestCost = INF;
        const considerEnd = (i, j) => {
          if (!(i >= 1 && i < m && j >= 1 && j < n)) return;
          const idx = at(i, j);
          if (!(idx >= 0 && idx < size)) return;
          const baseCost = cost[idx];
          if (!Number.isFinite(baseCost)) return;
          const tail = buildTail(i, j);
          if (!Array.isArray(tail)) return;
          let tailCost = 0;
          for (const tri of tail) {
            tailCost += triStepCost(tri[0], tri[1], tri[2], tri[1], tri[2]);
          }
          const remainA = (m - 1) - i;
          const remainB = (n - 1) - j;
          const tailImbalance = Math.abs(remainA - remainB);
          const tailPenalty = (tailImbalance * tailImbalance) * progressScale * 100;
          const totalCost = baseCost + tailCost + tailPenalty;
          if (totalCost < bestCost) {
            bestCost = totalCost;
            endIdx = idx;
            endTail = tail;
          }
        };
        for (let j = 1; j < n; j++) considerEnd(m - 1, j);
        for (let i = 1; i < m; i++) considerEnd(i, n - 1);
        if (endIdx < 0 || !Array.isArray(endTail)) return null;

        const pathRev = [];
        let cur = endIdx;
        while (cur !== startIdx) {
          const tri = prevTri[cur];
          if (!Array.isArray(tri) || tri.length < 3) return null;
          pathRev.push([tri[0] >>> 0, tri[1] >>> 0, tri[2] >>> 0]);
          cur = prev[cur];
          if (cur < 0) return null;
        }
        const outRaw = seedTris
          .map((tri) => [tri[0] >>> 0, tri[1] >>> 0, tri[2] >>> 0])
          .concat(pathRev.reverse())
          .concat(endTail.map((tri) => [tri[0] >>> 0, tri[1] >>> 0, tri[2] >>> 0]));
        return { raw: outRaw, cost: bestCost };
      };

      const seedSpecs = [];
      const s = chainA[0] >>> 0;
      const a1 = chainA[1] >>> 0;
      const b1 = chainB[1] >>> 0;
      const basicStart = makeTri(s, a1, b1);
      if (basicStart) {
        seedSpecs.push({ i: 1, j: 1, tris: [basicStart], tag: 'basic_start' });
      }
      if (n >= 3) {
        const b2 = chainB[2] >>> 0;
        const t1 = makeTri(s, a1, b2);
        const t2 = makeTri(s, b2, b1);
        if (t1 && t2) {
          seedSpecs.push({ i: 1, j: 2, tris: [t1, t2], tag: 'b_side_two_tri_seed' });
        }
      }
      if (m >= 3) {
        const a2 = chainA[2] >>> 0;
        const t1 = makeTri(s, a1, a2);
        const t2 = makeTri(s, a2, b1);
        if (t1 && t2) {
          seedSpecs.push({ i: 2, j: 1, tris: [t1, t2], tag: 'a_side_two_tri_seed' });
        }
      }
      if (seedSpecs.length === 0) return fail('start_triangle_invalid');

      let bestRes = null;
      for (const seed of seedSpecs) {
        const res = runDPWithSeed(seed.i, seed.j, seed.tris);
        if (!res || !Array.isArray(res.raw) || res.raw.length === 0) continue;
        if (!bestRes || res.cost < bestRes.cost) {
          bestRes = { ...res, seedTag: seed.tag };
        }
      }
      if (!bestRes || !Array.isArray(bestRes.raw) || bestRes.raw.length === 0) {
        return fail('no_terminal_state');
      }
      raw = bestRes.raw;
    }
    if (!Array.isArray(raw) || raw.length === 0) return fail('no_triangles_generated');

    const out = [];
    const rawOriented = [];
    for (const tri of raw) {
      const p0 = getVertexPointFromBuffer(vp, tri[0]);
      const p1 = getVertexPointFromBuffer(vp, tri[1]);
      const p2 = getVertexPointFromBuffer(vp, tri[2]);
      if (!p0 || !p1 || !p2) continue;
      const q0 = [p0[0], p0[1], p0[2]];
      const q1 = [p1[0], p1[1], p1[2]];
      const q2 = [p2[0], p2[1], p2[2]];
      const dot = triDot(q0, q1, q2);
      if (dot < 0) {
        out.push([q0, q2, q1]);
        rawOriented.push([tri[0] >>> 0, tri[2] >>> 0, tri[1] >>> 0]);
      } else {
        out.push([q0, q1, q2]);
        rawOriented.push([tri[0] >>> 0, tri[1] >>> 0, tri[2] >>> 0]);
      }
    }
    if (out.length === 0) return fail('failed_to_materialize_triangles');
    return { out, raw: rawOriented };
  };

  let bestFailure = null;
  let bestSuccess = null;
  const considerSuccess = (raw, tris, meta = {}) => {
    if (!Array.isArray(raw) || raw.length === 0) return;
    if (!Array.isArray(tris) || tris.length === 0) return;
    const quality = evaluateTriangulationQuality(raw);
    if (!Number.isFinite(quality)) return;
    if (
      !bestSuccess
      || (quality < bestSuccess.quality)
      || (
        quality === bestSuccess.quality
        && ((meta.score ?? -Infinity) > (bestSuccess.score ?? -Infinity))
      )
    ) {
      bestSuccess = {
        quality,
        raw,
        tris,
        score: meta.score ?? -Infinity,
        candidateIndex: meta.candidateIndex ?? -1,
        orientation: meta.orientation ?? null,
      };
    }
  };
  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx];
    const attempts = [
      {
        chainA: candidate.chainA,
        chainB: candidate.chainB,
        orientation: 'forward',
      },
      {
        chainA: Array.isArray(candidate?.chainA) ? candidate.chainA.slice().reverse() : null,
        chainB: Array.isArray(candidate?.chainB) ? candidate.chainB.slice().reverse() : null,
        orientation: 'reverse',
      },
    ];
    for (const attempt of attempts) {
      const triRes = triangulateChains(attempt.chainA, attempt.chainB);
      if (!triRes || !Array.isArray(triRes.out) || triRes.out.length === 0) {
        const diag = {
          candidateIndex: idx,
          score: candidate?.score ?? null,
          chainALen: Array.isArray(candidate?.chainA) ? candidate.chainA.length : 0,
          chainBLen: Array.isArray(candidate?.chainB) ? candidate.chainB.length : 0,
          orientation: attempt.orientation,
          reason: 'triangulate_failed',
          triReason: triangulateChains.lastReason || null,
          exactBoundaryEdges: -1,
        };
        if (!bestFailure || (diag.score ?? -Infinity) > (bestFailure.score ?? -Infinity)) {
          bestFailure = diag;
        }
        continue;
      }
      if (!patchTopologyValid(triRes.raw)) {
        const diag = {
          candidateIndex: idx,
          score: candidate?.score ?? null,
          chainALen: Array.isArray(candidate?.chainA) ? candidate.chainA.length : 0,
          chainBLen: Array.isArray(candidate?.chainB) ? candidate.chainB.length : 0,
          orientation: attempt.orientation,
          reason: 'patch_topology_failed',
          exactBoundaryEdges: -1,
        };
        if (!bestFailure || (diag.score ?? -Infinity) > (bestFailure.score ?? -Infinity)) {
          bestFailure = diag;
        }
        continue;
      }
      if (usesBlockedInternalEdges(triRes.raw)) {
        const diag = {
          candidateIndex: idx,
          score: candidate?.score ?? null,
          chainALen: Array.isArray(candidate?.chainA) ? candidate.chainA.length : 0,
          chainBLen: Array.isArray(candidate?.chainB) ? candidate.chainB.length : 0,
          orientation: attempt.orientation,
          reason: 'blocked_internal_edge',
          exactBoundaryEdges: -1,
        };
        if (!bestFailure || (diag.score ?? -Infinity) > (bestFailure.score ?? -Infinity)) {
          bestFailure = diag;
        }
        continue;
      }
      if (!loopEdgesCoveredExactlyOnce(triRes.raw)) {
        const cov = summarizeLoopEdgeCoverage(triRes.raw);
        const parseEdgeKey = (key) => {
          const parts = String(key || '').split('|');
          if (parts.length !== 2) return null;
          const a = Number(parts[0]) >>> 0;
          const b = Number(parts[1]) >>> 0;
          if (a === b) return null;
          return [a, b];
        };
        if (cov.missing.length === 2 && cov.overused.length === 0) {
          const e0 = parseEdgeKey(cov.missing[0]);
          const e1 = parseEdgeKey(cov.missing[1]);
          if (e0 && e1) {
            let shared = null;
            if ((e0[0] >>> 0) === (e1[0] >>> 0) || (e0[0] >>> 0) === (e1[1] >>> 0)) shared = e0[0] >>> 0;
            else if ((e0[1] >>> 0) === (e1[0] >>> 0) || (e0[1] >>> 0) === (e1[1] >>> 0)) shared = e0[1] >>> 0;
            if (shared !== null) {
              const x = ((e0[0] >>> 0) === shared) ? (e0[1] >>> 0) : (e0[0] >>> 0);
              const y = ((e1[0] >>> 0) === shared) ? (e1[1] >>> 0) : (e1[0] >>> 0);
              if (x !== y && x !== shared && y !== shared) {
                const repairedRaw = triRes.raw.concat([[x, shared, y]]);
                if (
                  patchTopologyValid(repairedRaw)
                  && !usesBlockedInternalEdges(repairedRaw)
                  && loopEdgesCoveredExactlyOnce(repairedRaw)
                ) {
                  const px = getVertexPointFromBuffer(vp, x);
                  const ps = getVertexPointFromBuffer(vp, shared);
                  const py = getVertexPointFromBuffer(vp, y);
                  if (px && ps && py) {
                    const qx = [px[0], px[1], px[2]];
                    const qs = [ps[0], ps[1], ps[2]];
                    const qy = [py[0], py[1], py[2]];
                    const dot = triDot(qx, qs, qy);
                    const repairedTri = (dot < 0) ? [qx, qy, qs] : [qx, qs, qy];
                    const repairedRawTri = (dot < 0)
                      ? [x >>> 0, y >>> 0, shared >>> 0]
                      : [x >>> 0, shared >>> 0, y >>> 0];
                    considerSuccess(
                      triRes.raw.concat([repairedRawTri]),
                      triRes.out.concat([repairedTri]),
                      {
                        score: candidate?.score ?? null,
                        candidateIndex: idx,
                        orientation: attempt.orientation,
                      },
                    );
                    continue;
                  }
                }
              }
            }
          }
        }
        const diag = {
          candidateIndex: idx,
          score: candidate?.score ?? null,
          chainALen: Array.isArray(candidate?.chainA) ? candidate.chainA.length : 0,
          chainBLen: Array.isArray(candidate?.chainB) ? candidate.chainB.length : 0,
          orientation: attempt.orientation,
          reason: 'boundary_coverage_failed',
          exactBoundaryEdges: cov.exact,
          totalBoundaryEdges: cov.total,
          missingEdgeCount: cov.missing.length,
          overusedEdgeCount: cov.overused.length,
          sampleMissingEdges: cov.missing.slice(0, 6),
        };
        if (
          !bestFailure
          || (diag.exactBoundaryEdges > (bestFailure.exactBoundaryEdges ?? -1))
          || (
            diag.exactBoundaryEdges === (bestFailure.exactBoundaryEdges ?? -1)
            && (diag.score ?? -Infinity) > (bestFailure.score ?? -Infinity)
          )
        ) {
          bestFailure = diag;
        }
        continue;
      }
      considerSuccess(triRes.raw, triRes.out, {
        score: candidate?.score ?? null,
        candidateIndex: idx,
        orientation: attempt.orientation,
      });
      continue;
    }
  }
  if (bestSuccess) {
    triangulateLoopCapGuided.lastFailure = null;
    return { tris: bestSuccess.tris, raw: bestSuccess.raw };
  }
  triangulateLoopCapGuided.lastFailure = {
    candidateCount: candidates.length,
    bestFailure,
  };
  return null;
}

function generateCapGuidedPatchFace(
  solid,
  faceName,
  loop,
  vp,
  edgeFaceIDsByKey,
  movedVertexIndices,
  blockedEdgeKeys = null,
  blockedEdgeKeysTracker = null,
) {
  const triPack = triangulateLoopCapGuided(
    loop,
    vp,
    edgeFaceIDsByKey,
    movedVertexIndices,
    blockedEdgeKeys,
  );
  if (!triPack || !Array.isArray(triPack.raw) || triPack.raw.length === 0) return 0;

  const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
  const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  if (!faceToId || !idToFace) return 0;

  let fid = faceToId.get(faceName);
  if (!(Number.isFinite(fid))) {
    let maxID = 0;
    for (const id of idToFace.keys()) {
      const v = id >>> 0;
      if (v > maxID) maxID = v;
    }
    fid = (maxID + 1) >>> 0;
    faceToId.set(faceName, fid);
    idToFace.set(fid, faceName);
  }

  let added = 0;
  const edgeKey = (x, y) => ((x >>> 0) < (y >>> 0) ? `${x >>> 0}|${y >>> 0}` : `${y >>> 0}|${x >>> 0}`);
  for (const tri of triPack.raw) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = tri[0] >>> 0;
    const b = tri[1] >>> 0;
    const c = tri[2] >>> 0;
    if (a === b || b === c || c === a) continue;
    solid._triVerts.push(a, b, c);
    solid._triIDs.push(fid >>> 0);
    if (blockedEdgeKeysTracker instanceof Set) {
      blockedEdgeKeysTracker.add(edgeKey(a, b));
      blockedEdgeKeysTracker.add(edgeKey(b, c));
      blockedEdgeKeysTracker.add(edgeKey(c, a));
    }
    added++;
  }
  if (added > 0) {
    solid._manifold = null;
    solid._faceIndex = null;
    solid._dirty = true;
  }
  return added;
}

function computeLoopNormal(points) {
  let nx = 0, ny = 0, nz = 0;
  if (!Array.isArray(points) || points.length < 3) return [0, 0, 1];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    nx += (p0[1] - p1[1]) * (p0[2] + p1[2]);
    ny += (p0[2] - p1[2]) * (p0[0] + p1[0]);
    nz += (p0[0] - p1[0]) * (p0[1] + p1[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-16)) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

function removeSelectedEndCapTrianglesAndPatch(resultSolid, endCapFaceIDs, featureID, movedVertexIndices) {
  const vp = Array.isArray(resultSolid?._vertProperties) ? resultSolid._vertProperties : null;
  const tv = Array.isArray(resultSolid?._triVerts) ? resultSolid._triVerts : null;
  const ids = Array.isArray(resultSolid?._triIDs) ? resultSolid._triIDs : null;
  if (!vp || !tv || !ids) {
    throw new Error('[Solid.fillet] End-cap patch: missing mesh buffers.');
  }
  if (!(endCapFaceIDs instanceof Set) || endCapFaceIDs.size === 0) {
    return { removedTriangles: 0, patchedTriangles: 0, patchedLoops: 0 };
  }

  const triCount = (tv.length / 3) | 0;
  if (triCount === 0 || ids.length < triCount) {
    throw new Error('[Solid.fillet] End-cap patch: invalid triangle buffers.');
  }

  const removeMask = new Uint8Array(triCount);
  let removedTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const id = ids[t] >>> 0;
    if (endCapFaceIDs.has(id)) {
      removeMask[t] = 1;
      removedTriangles++;
    }
  }
  if (removedTriangles === 0) {
    throw new Error('[Solid.fillet] End-cap patch: no triangles matched selected end-cap face IDs.');
  }

  const boundaryEdgeRecords = buildBoundaryEdgesForRemovedTriangles(tv, ids, removeMask);
  if (boundaryEdgeRecords.length === 0) {
    throw new Error('[Solid.fillet] End-cap patch: no boundary edges found after removing selected triangles.');
  }
  const boundaryEdges = boundaryEdgeRecords.map((rec) => [rec.a >>> 0, rec.b >>> 0]);
  const edgeFaceIDsByKey = new Map();
  for (const rec of boundaryEdgeRecords) {
    const a = rec?.a >>> 0;
    const b = rec?.b >>> 0;
    const key = (a < b) ? `${a}|${b}` : `${b}|${a}`;
    edgeFaceIDsByKey.set(key, Array.from(rec?.removedFaceIDs || [], (id) => id >>> 0));
  }
  const loops = buildBoundaryLoopsFromEdges(boundaryEdges)
    .map(cleanLoopVertexIndices)
    .filter((loop) => Array.isArray(loop) && loop.length >= 3);
  if (loops.length === 0) {
    throw new Error('[Solid.fillet] End-cap patch: failed to build boundary loops.');
  }

  const newTV = [];
  const newIDs = [];
  for (let t = 0; t < triCount; t++) {
    if (removeMask[t] === 1) continue;
    const base = t * 3;
    newTV.push(tv[base + 0] >>> 0, tv[base + 1] >>> 0, tv[base + 2] >>> 0);
    newIDs.push(ids[t] >>> 0);
  }

  resultSolid._triVerts = newTV;
  resultSolid._triIDs = newIDs;
  pruneUnusedFaceIDs(resultSolid);
  resultSolid._manifold = null;
  resultSolid._faceIndex = null;
  resultSolid._dirty = true;

  const patchFaceBase = `${featureID || 'FILLET'}_ENDCAP_PATCH`;
  let patchedTriangles = 0;
  let patchedLoops = 0;
  const blockedEdgeKeys = buildEdgeKeySetFromTriVerts(resultSolid._triVerts);
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i];
    if (!Array.isArray(loop) || loop.length < 3) {
      throw new Error(`[Solid.fillet] End-cap patch: invalid loop at index ${i}.`);
    }
    const loopEdgeKeys = buildLoopEdgeKeys(loop);
    // Immediately after removal, loop edges must be boundary edges (used by 1 tri).
    if (!loopEdgesHaveUseCount(resultSolid._triVerts, loopEdgeKeys, 1)) {
      throw new Error(`[Solid.fillet] End-cap patch: loop ${i} is not an open boundary after removal.`);
    }
    for (const vi of loop) {
      const base = (vi >>> 0) * 3;
      if (base + 2 >= vp.length) {
        throw new Error(`[Solid.fillet] End-cap patch: loop ${i} references out-of-range vertex index ${vi}.`);
      }
    }
    const uniqueLoopVertices = new Set(loop.map((vi) => vi >>> 0)).size;
    const movedOnLoop = (movedVertexIndices instanceof Set)
      ? loop.reduce((acc, vi) => acc + (movedVertexIndices.has(vi >>> 0) ? 1 : 0), 0)
      : 0;
    const loopRemovedFaceLabels = new Set();
    for (let e = 0; e < loop.length; e++) {
      const a = loop[e] >>> 0;
      const b = loop[(e + 1) % loop.length] >>> 0;
      const key = (a < b) ? `${a}|${b}` : `${b}|${a}`;
      const idsOnEdge = edgeFaceIDsByKey.get(key);
      for (const id of (Array.isArray(idsOnEdge) ? idsOnEdge : [])) {
        loopRemovedFaceLabels.add(id >>> 0);
      }
    }
    const faceName = `${patchFaceBase}_${i}`;
    let added = generateCapGuidedPatchFace(
      resultSolid,
      faceName,
      loop,
      vp,
      edgeFaceIDsByKey,
      movedVertexIndices,
      blockedEdgeKeys,
      blockedEdgeKeys,
    );
    if (!(added > 0)) {
      const triDiag = triangulateLoopCapGuided?.lastFailure;
      const triDiagText = triDiag ? `, triangulationDiagnostics=${JSON.stringify(triDiag)}` : '';
      throw new Error(
        `[Solid.fillet] End-cap patch: cap-guided triangulation failed for loop ${i} `
        + `(vertices=${loop.length}, uniqueVertices=${uniqueLoopVertices}, movedVerticesOnLoop=${movedOnLoop}, `
        + `removedFaceLabelsOnLoop=${loopRemovedFaceLabels.size}${triDiagText}).`
      );
    }
    // After patching this loop, each boundary edge should be back to 2-triangle use.
    let isClosed = loopEdgesHaveUseCount(resultSolid._triVerts, loopEdgeKeys, 2);
    if (!isClosed) {
      let postCounts = countSpecificEdgeUses(resultSolid._triVerts, loopEdgeKeys);
      let boundaryEdgeCount = 0;
      let overusedEdgeCount = 0;
      let underusedEdgeCount = 0;
      for (const count of postCounts.values()) {
        if ((count >>> 0) === 1) boundaryEdgeCount++;
        if ((count >>> 0) > 2) overusedEdgeCount++;
        if ((count >>> 0) < 2) underusedEdgeCount++;
      }

      if (!isClosed) {
        const missingEdgeKeys = [];
        for (const [key, count] of postCounts.entries()) {
          if ((count >>> 0) === 1) missingEdgeKeys.push(String(key));
        }
        throw new Error(
          `[Solid.fillet] End-cap patch: loop ${i} did not close after triangulation `
          + `(vertices=${loop.length}, uniqueVertices=${uniqueLoopVertices}, `
          + `boundaryEdges=${boundaryEdgeCount}, underusedEdges=${underusedEdgeCount}, `
          + `overusedEdges=${overusedEdgeCount}, `
          + `missingEdgeKeys=${missingEdgeKeys.slice(0, 8).join(',')}).`
        );
      }
    }
    patchedTriangles += added;
    patchedLoops++;
  }
  if (patchedLoops !== loops.length) {
    throw new Error('[Solid.fillet] End-cap patch: not all loops were patched.');
  }

  if (typeof resultSolid.fixTriangleWindingsByAdjacency === 'function') {
    resultSolid.fixTriangleWindingsByAdjacency();
  }
  if (typeof resultSolid._isCoherentlyOrientedManifold === 'function') {
    const manifoldOk = !!resultSolid._isCoherentlyOrientedManifold();
    if (!manifoldOk) {
      const stats = summarizeEdgeManifoldIssues(resultSolid._triVerts, resultSolid._vertProperties);
      throw new Error(
        `[Solid.fillet] End-cap patch: mesh is not a coherently oriented manifold after patch `
        + `(boundaryEdges=${stats.boundaryEdges}, nonManifoldEdges=${stats.nonManifoldEdges}, `
        + `badOrientationEdges=${stats.badOrientationEdges}, totalEdges=${stats.totalEdges}).`
      );
    }
  }
  if (typeof resultSolid._manifoldize === 'function') {
    resultSolid._manifoldize();
  }

  return { removedTriangles, patchedTriangles, patchedLoops };
}
/**
 * Apply fillets to this Solid and return a new Solid with the result.
 * Accepts either `edgeNames` (preferred) or explicit `edges` objects.
 *
 * @param {Object} opts
 * @param {number} opts.radius Required fillet radius (> 0)
 * @param {string[]} [opts.edgeNames] Optional edge names to fillet (resolved from this Solid's children)
 * @param {any[]} [opts.edges] Optional pre-resolved Edge objects (must belong to this Solid)
 * @param {'INSET'|'OUTSET'|string} [opts.direction='INSET'] Boolean behavior (subtract vs union)
 * @param {number} [opts.inflate=0.1] Inflation for cutting tube
 * @param {number} [opts.resolution=32] Tube resolution (segments around circumference)
 * @param {boolean} [opts.debug=false] Enable debug visuals in fillet builder
 * @param {number} [opts.debugSolidsLevel=0] 0=tube+wedge, 1=edge fillet boolean result, 2=all intermediate solids
 * @param {boolean} [opts.showTangentOverlays=false] Show pre-inflate tangent overlays on the fillet tube
 * @param {boolean} [opts.patchFilletEndCaps=false] Enable three-face tip cleanup and end-cap triangle replacement patching
 * @param {string} [opts.featureID='FILLET'] For naming of intermediates and result
 * @param {number} [opts.cleanupTinyFaceIslandsArea=0.001] area threshold for face-island relabeling (<= 0 disables)
 * @returns {import('../BetterSolid.js').Solid}
 */
export async function fillet(opts = {}) {
  const { filletSolid } = await import("../fillets/fillet.js");
  const radius = Number(opts.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Solid.fillet: radius must be > 0, got ${opts.radius}`);
  }
  const dir = String(opts.direction || 'INSET').toUpperCase();
  const inflate = Number.isFinite(opts.inflate) ? Number(opts.inflate) : 0.1;
  const debug = !!opts.debug;
  const debugSolidsLevelRaw = Number(opts.debugSolidsLevel);
  const debugSolidsLevel = Number.isFinite(debugSolidsLevelRaw)
    ? Math.max(0, Math.min(2, Math.floor(debugSolidsLevelRaw)))
    : 0;
  const resolutionRaw = Number(opts.resolution);
  const resolution = (Number.isFinite(resolutionRaw) && resolutionRaw > 0)
    ? Math.max(8, Math.floor(resolutionRaw))
    : 32;
  const showTangentOverlays = !!opts.showTangentOverlays;
  const patchFilletEndCaps = !!opts.patchFilletEndCaps;
  const featureID = opts.featureID || 'FILLET';
  const cleanupTinyFaceIslandsAreaRaw = Number(opts.cleanupTinyFaceIslandsArea);
  const cleanupTinyFaceIslandsArea = Number.isFinite(cleanupTinyFaceIslandsAreaRaw)
    ? cleanupTinyFaceIslandsAreaRaw
    : 0.001;

  // Resolve edges from names and/or provided objects
  const unique = resolveEdgesFromInputs(this, { edgeNames: opts.edgeNames, edges: opts.edges });
  if (unique.length === 0) {
    console.warn('[Solid.fillet] No edges resolved on target solid; returning clone.', { featureID, solid: this?.name });
    // Nothing to do - return an unchanged clone so caller can replace scene node safely
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }

  // Build fillet solids per edge using existing core implementation
  const filletEntries = [];
  let idx = 0;
  const debugAdded = [];
  const attachDebugSolids = (target) => {
    if (!target || debugAdded.length === 0) return;
    try { target.__debugAddedSolids = debugAdded; } catch { }
  };
  const pushDebugSolid = (solid) => {
    if (!debug || !solid) return;
    debugAdded.push(solid);
  };
  const pushTubeAndWedgeDebug = (res) => {
    if (!debug || !res) return;
    try { if (res.tube) pushDebugSolid(res.tube); } catch { }
    try { if (res.wedge) pushDebugSolid(res.wedge); } catch { }
  };
  for (const e of unique) {
    const name = `${featureID}_FILLET_${idx++}`;
    const res = filletSolid({ edgeToFillet: e, radius, sideMode: dir, inflate, resolution, debug, name, showTangentOverlays }) || {};
    if (res.error) {
      console.warn(`Fillet failed for edge ${e?.name || idx}: ${res.error}`);
    }
    if (!res.finalSolid) {
      // When finalSolid is missing, always keep tube/wedge to help diagnose failure.
      pushTubeAndWedgeDebug(res);
      console.warn('[Solid.fillet] Fillet builder returned no finalSolid.', {
        featureID,
        edge: e?.name,
        error: res.error,
        hasTube: !!res.tube,
        hasWedge: !!res.wedge,
      });
      continue;
    }

    const mergeCandidates = getFilletMergeCandidateNames(res.finalSolid);
    const roundFaceName = guessRoundFaceName(res.finalSolid, name);
    filletEntries.push({
      filletSolid: res.finalSolid,
      filletName: name,
      mergeCandidates,
      roundFaceName,
      wedgeSolid: res.wedge || null,
      tubeSolid: res.tube || null,
    });
    if (debug) {
      if (debugSolidsLevel === 0) {
        pushTubeAndWedgeDebug(res);
      } else if (debugSolidsLevel === 1) {
        pushDebugSolid(res.finalSolid);
      } else {
        pushTubeAndWedgeDebug(res);
        pushDebugSolid(res.finalSolid);
      }
    }
  }
  if (filletEntries.length === 0) {
    console.error('[Solid.fillet] All edge fillets failed; returning clone.', { featureID, edgeCount: unique.length });
    const c = this.clone();
    try { c.name = this.name; } catch { }
    attachDebugSolids(c);
    return c;
  }

  // Apply to base solid (union for OUTSET, subtract for INSET)
  let result = this;
  const solidsToApply = filletEntries.map(entry => entry.filletSolid);
  try {
    let applyStep = 0;
    for (const filletSolid of solidsToApply) {
      const operation = (dir === 'OUTSET') ? 'union' : 'subtract';
      result = (operation === 'union') ? result.union(filletSolid) : result.subtract(filletSolid);

      // Name the result for scene grouping/debugging
      try { result.name = this.name; } catch { }

      if (debug && debugSolidsLevel >= 2 && result && typeof result.clone === 'function') {
        try {
          const stepSnapshot = result.clone();
          try { stepSnapshot.name = `${featureID}_BOOLEAN_STEP_${applyStep}`; } catch { }
          debugAdded.push(stepSnapshot);
        } catch { }
      }
      applyStep += 1;
    }
    if (typeof result?.visualize === 'function') {
      result.visualize();
    }
  } catch (err) {
    console.error('[Solid.fillet] Fillet boolean failed; returning clone.', { featureID, error: err?.message || err });
    const fallback = this.clone();
    try { fallback.name = this.name; } catch { }
    attachDebugSolids(fallback);
    return fallback;
  }

  try {
    const coplanarMerged = mergeOutsetEndCapsByCoplanarity(result, filletEntries, dir, featureID);
    if (coplanarMerged > 0) {
      console.log('[Solid.fillet] Merged coplanar end-cap faces after boolean.', {
        featureID,
        mergedFaces: coplanarMerged,
      });
    }
  } catch (err) {
    console.warn('[Solid.fillet] OUTSET coplanar end-cap merge failed', { featureID, error: err?.message || err });
  }

  try {
    const boundaryCache = { current: null };
    const resultAreaCache = buildFaceAreaCache(result);
    const filletAreaCacheBySolid = new WeakMap();
    for (const entry of filletEntries) {
      const { filletSolid, filletName } = entry;
      const mergeSolid = filletSolid;
      const roundFaceName = entry.roundFaceName || guessRoundFaceName(mergeSolid, filletName);
      const candidateNames = (Array.isArray(entry.mergeCandidates) && entry.mergeCandidates.length)
        ? entry.mergeCandidates
        : getFilletMergeCandidateNames(mergeSolid);
      let filletAreaCache = filletAreaCacheBySolid.get(mergeSolid);
      if (!filletAreaCache) {
        filletAreaCache = buildFaceAreaCache(mergeSolid);
        filletAreaCacheBySolid.set(mergeSolid, filletAreaCache);
      }
      mergeTinyFacesIntoRoundFace(
        result,
        mergeSolid,
        candidateNames,
        roundFaceName,
        boundaryCache,
        resultAreaCache,
        filletAreaCache,
      );
      mergeSideFacesIntoRoundFace(result, filletName, roundFaceName);
    }
  } catch (err) {
    console.warn('[Solid.fillet] Tiny fillet face merge failed', { featureID, error: err?.message || err });
  }

  try {
    if (cleanupTinyFaceIslandsArea > 0 && typeof result.cleanupTinyFaceIslands === 'function') {
      await result.cleanupTinyFaceIslands(cleanupTinyFaceIslandsArea);
    }
  } catch (err) {
    console.warn('[Solid.fillet] cleanupTinyFaceIslands failed', { featureID, error: err?.message || err });
  }

  try {
    if (typeof result.mergeTinyFaces === 'function') {
      await result.mergeTinyFaces(0.1);
    }
  } catch (err) {
    console.warn('[Solid.fillet] mergeTinyFaces failed', { featureID, error: err?.message || err });
  }

  try {
    await mergeInsetEndCapsByNormal(result, featureID, dir);
  } catch (err) {
    console.warn('[Solid.fillet] Inset end cap merge failed', { featureID, error: err?.message || err });
  }

  let collapseEdgeDebugMarkers = [];
  if (patchFilletEndCaps) {
    let tipCleanup = null;
    try {
      tipCleanup = closeThreeFaceFilletPointGaps(result, filletEntries, featureID, debug);
      const movedVertexIndices = tipCleanup?.movedVertexIndices;
      const movedVertexOriginalPositions = tipCleanup?.movedVertexOriginalPositions;
      if (debug && movedVertexIndices instanceof Set && movedVertexIndices.size > 0) {
        collapseEdgeDebugMarkers = buildCollapseEdgeDebugVertices(
          result,
          movedVertexIndices,
          featureID,
          movedVertexOriginalPositions,
        );
      }
      if (Number(tipCleanup?.movedVertices) > 0 || Number(tipCleanup?.collapsedVertices) > 0) {
        console.log('[Solid.fillet] Closed three-face fillet point gaps.', {
          featureID,
          movedVertices: tipCleanup.movedVertices,
          collapsedVertices: Number(tipCleanup?.collapsedVertices) || 0,
        });
      }
    } catch (err) {
      console.warn('[Solid.fillet] Three-face fillet point cleanup failed', { featureID, error: err?.message || err });
    }

    const faceIDs = tipCleanup?.endCapFaceIDs;
    if (faceIDs instanceof Set && faceIDs.size > 0) {
      const patchRes = removeSelectedEndCapTrianglesAndPatch(
        result,
        faceIDs,
        featureID,
        tipCleanup?.movedVertexIndices,
      );
      if ((patchRes.removedTriangles > 0) || (patchRes.patchedTriangles > 0)) {
        console.log('[Solid.fillet] Removed selected end-cap triangles and patched resulting holes.', {
          featureID,
          removedTriangles: patchRes.removedTriangles,
          patchedTriangles: patchRes.patchedTriangles,
          patchedLoops: patchRes.patchedLoops,
        });
      }
    }
  }

  try {
    await result.collapseTinyTriangles(0.0009);
  } catch (err) {
    console.warn('[Solid.fillet] collapseTinyTriangles failed', { featureID, error: err?.message || err });
  }

  // Attach debug artifacts for callers that want to add them to the scene
  attachDebugSolids(result);

  // Simplify the final result in place to clean up artifacts from booleans.
  try {
    await result.removeSmallIslands();
  } catch (err) {
    console.warn('[Solid.fillet] simplify failed; continuing without simplification', { featureID, error: err?.message || err });
  }

  if (debug && collapseEdgeDebugMarkers.length > 0) {
    try {
      for (const marker of collapseEdgeDebugMarkers) {
        if (!marker) continue;
        result.add(marker);
      }
      console.log('[Solid.fillet] Added collapse-edge debug points.', {
        featureID,
        pointCount: collapseEdgeDebugMarkers.length,
      });
    } catch (err) {
      console.warn('[Solid.fillet] Failed to attach collapse-edge debug points', { featureID, error: err?.message || err });
    }
  }

  const finalTriCount = Array.isArray(result?._triVerts) ? (result._triVerts.length / 3) : 0;
  const finalVertCount = Array.isArray(result?._vertProperties) ? (result._vertProperties.length / 3) : 0;
  if (!result || finalTriCount === 0 || finalVertCount === 0) {
    console.error('[Solid.fillet] Fillet result is empty or missing geometry.', {
      featureID,
      finalTriCount,
      finalVertCount,
      edgeCount: unique.length,
      direction: dir,
      inflate,
    });
  }

  return result;
}

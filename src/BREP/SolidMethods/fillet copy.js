// Solid.fillet implementation: consolidates fillet logic so features call this API.
// Usage: solid.fillet({ radius, edgeNames, featureID, direction, inflate, resolution, debug, showTangentOverlays, combineEdges })
import { Manifold } from '../SolidShared.js';
import { resolveEdgesFromInputs } from './edgeResolution.js';
import { computeFaceAreaFromTriangles } from '../fillets/filletGeometry.js';
import { createQuantizer, deriveTolerance } from '../../utils/geometryTolerance.js';

const debugMode = false;

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

function mergeTinyFacesIntoRoundFace(resultSolid, filletSolid, candidateNames, roundFaceName, featureID, boundaryCache, resultAreaCache) {
  if (!resultSolid || !filletSolid || !Array.isArray(candidateNames) || candidateNames.length === 0) return;
  const areaCacheResult = resultAreaCache || buildFaceAreaCache(resultSolid);
  const areaCacheFillet = buildFaceAreaCache(filletSolid);

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
      const merged = mergeFaceIntoTarget(resultSolid, capName, targetFace);
      if (merged) {
        consoleLogReplacement('[Solid.fillet] Merged tiny fillet face into round face', {
          featureID,
          capName,
          roundFaceName: targetFace,
          ratio: finalArea / referenceArea,
        });
      }
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

function getEdgePolylineLocal(edgeObj) {
  if (!edgeObj) return [];
  const cached = edgeObj?.userData?.polylineLocal;
  if (Array.isArray(cached) && cached.length >= 2) {
    return cached.map(p => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
  }
  if (typeof edgeObj.points === 'function') {
    const pts = edgeObj.points(false);
    if (Array.isArray(pts) && pts.length >= 2) {
      return pts.map(p => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]);
    }
  }
  const pos = edgeObj?.geometry?.getAttribute?.('position');
  if (pos && pos.itemSize === 3 && pos.count >= 2) {
    const out = [];
    for (let i = 0; i < pos.count; i++) {
      out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    }
    return out;
  }
  return [];
}

function dedupePoints(points, tol = 1e-5) {
  const out = [];
  const seen = new Set();
  const { q, k } = createQuantizer(tol);
  for (const p of points || []) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const qp = q(p);
    const key = k(qp);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(qp);
  }
  return out;
}

function collectFacePoints(solid, faceName, out) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return out;
  const tris = solid.getFace(faceName);
  if (!Array.isArray(tris) || tris.length === 0) return out;
  const dst = Array.isArray(out) ? out : [];
  for (const tri of tris) {
    const p1 = tri?.p1;
    const p2 = tri?.p2;
    const p3 = tri?.p3;
    if (Array.isArray(p1) && p1.length >= 3) dst.push([Number(p1[0]) || 0, Number(p1[1]) || 0, Number(p1[2]) || 0]);
    if (Array.isArray(p2) && p2.length >= 3) dst.push([Number(p2[0]) || 0, Number(p2[1]) || 0, Number(p2[2]) || 0]);
    if (Array.isArray(p3) && p3.length >= 3) dst.push([Number(p3[0]) || 0, Number(p3[1]) || 0, Number(p3[2]) || 0]);
  }
  return dst;
}

function buildHullSolidFromPoints(points, name, SolidCtor, tol = 1e-5) {
  const unique = dedupePoints(points, tol);
  if (unique.length < 4) return null;
  let hull = null;
  try {
    hull = Manifold.hull(unique);
  } catch {
    return null;
  }
  try {
    const solid = SolidCtor._fromManifold(hull, new Map([[0, name]]));
    try { solid.name = name; } catch { }
    const faceNames = (typeof solid.getFaceNames === 'function') ? solid.getFaceNames() : [];
    for (const faceName of faceNames) {
      if (!faceName || faceName === name) continue;
      mergeFaceIntoTarget(solid, faceName, name);
    }
    return solid;
  } catch {
    return null;
  }
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

function toArrayPoint(p) {
  if (Array.isArray(p) && p.length >= 3) {
    const x = Number(p[0]); const y = Number(p[1]); const z = Number(p[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
    return null;
  }
  if (p && typeof p === 'object') {
    const x = Number(p.x); const y = Number(p.y); const z = Number(p.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  }
  return null;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function buildPolylineSampler(points, tol = 1e-9) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const eps = Math.max(1e-12, Math.abs(tol || 0));
  const eps2 = eps * eps;
  const pts = [];
  let prev = null;
  for (const p of points) {
    const q = toArrayPoint(p);
    if (!q) continue;
    if (prev && dist2(prev, q) <= eps2) continue;
    pts.push(q);
    prev = q;
  }
  if (pts.length < 2) return null;

  const segCount = pts.length - 1;
  const segLen = new Array(segCount);
  const segLen2 = new Array(segCount);
  const segDx = new Array(segCount);
  const segDy = new Array(segCount);
  const segDz = new Array(segCount);
  const cum = new Array(segCount + 1);
  cum[0] = 0;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len2 = dx * dx + dy * dy + dz * dz;
    const len = Math.sqrt(len2);
    segLen[i] = len;
    segLen2[i] = len2;
    segDx[i] = dx;
    segDy[i] = dy;
    segDz[i] = dz;
    cum[i + 1] = cum[i] + len;
  }
  const totalLen = cum[segCount];
  if (!(totalLen > eps)) return null;

  const project = (p) => {
    let bestDist2 = Infinity;
    let bestS = 0;
    let bestQ = pts[0];
    for (let i = 0; i < segCount; i++) {
      const len2 = segLen2[i];
      if (len2 <= eps2) continue;
      const a = pts[i];
      const dx = segDx[i];
      const dy = segDy[i];
      const dz = segDz[i];
      const tRaw = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len2;
      const t = tRaw < 0 ? 0 : (tRaw > 1 ? 1 : tRaw);
      const qx = a[0] + dx * t;
      const qy = a[1] + dy * t;
      const qz = a[2] + dz * t;
      const ddx = p[0] - qx;
      const ddy = p[1] - qy;
      const ddz = p[2] - qz;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestS = cum[i] + segLen[i] * t;
        bestQ = [qx, qy, qz];
      }
    }
    return { s: bestS, point: bestQ, dist2: bestDist2 };
  };

  const pointAt = (s) => {
    const t = Math.max(0, Math.min(totalLen, Number.isFinite(s) ? s : 0));
    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] < t) lo = mid + 1; else hi = mid;
    }
    const i = lo;
    const len = segLen[i];
    if (!(len > eps)) return [pts[i][0], pts[i][1], pts[i][2]];
    const u = (t - cum[i]) / len;
    return [
      pts[i][0] + segDx[i] * u,
      pts[i][1] + segDy[i] * u,
      pts[i][2] + segDz[i] * u
    ];
  };

  return {
    points: pts,
    totalLen,
    avgSegLen: totalLen / Math.max(1, segCount),
    project,
    pointAt,
  };
}

function monotonicPenalty(seq, tol = 0) {
  let penalty = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    if (d < -tol) penalty += -d;
  }
  return penalty;
}

function isotonicRegressionNonDecreasing(values) {
  const n = values.length;
  if (n <= 1) return values.slice();
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ start: i, end: i, sum: values[i], weight: 1 });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if ((a.sum / a.weight) <= (b.sum / b.weight)) break;
      blocks.pop();
      blocks.pop();
      blocks.push({
        start: a.start,
        end: b.end,
        sum: a.sum + b.sum,
        weight: a.weight + b.weight,
      });
    }
  }
  const out = new Array(n);
  for (const block of blocks) {
    const avg = block.sum / block.weight;
    for (let i = block.start; i <= block.end; i++) out[i] = avg;
  }
  return out;
}

function rotateArray(arr, start) {
  const n = arr.length;
  if (!n || start <= 0) return arr.slice();
  const out = new Array(n);
  let idx = 0;
  for (let i = start; i < n; i++) out[idx++] = arr[i];
  for (let i = 0; i < start; i++) out[idx++] = arr[i];
  return out;
}

function unrotateArray(arr, start) {
  const n = arr.length;
  if (!n || start <= 0) return arr.slice();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[(i + start) % n] = arr[i];
  }
  return out;
}

function findWorstDropIndex(seq) {
  let worst = 0;
  let idx = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1];
    if (d < worst) { worst = d; idx = i; }
  }
  const wrap = seq[0] - seq[seq.length - 1];
  if (wrap < worst) idx = 0;
  return idx;
}

function computeBoundaryLength(indices, vp) {
  if (!Array.isArray(indices) || indices.length < 2 || !vp) return 0;
  let len = 0;
  for (let i = 1; i < indices.length; i++) {
    const a = indices[i - 1] >>> 0;
    const b = indices[i] >>> 0;
    const ax = vp[a * 3 + 0], ay = vp[a * 3 + 1], az = vp[a * 3 + 2];
    const bx = vp[b * 3 + 0], by = vp[b * 3 + 1], bz = vp[b * 3 + 2];
    const dx = ax - bx, dy = ay - by, dz = az - bz;
    len += Math.hypot(dx, dy, dz);
  }
  return len;
}

function resolveFilletRoundFaceName(resultSolid, entry) {
  if (!resultSolid || !entry) return null;
  const faceNames = (typeof resultSolid.getFaceNames === 'function')
    ? resultSolid.getFaceNames()
    : [];
  if (entry.roundFaceName && faceNames.includes(entry.roundFaceName)) return entry.roundFaceName;
  if (entry.filletName) {
    const expected = `${entry.filletName}_TUBE_Outer`;
    if (faceNames.includes(expected)) return expected;
  }
  let best = null;
  for (const name of faceNames) {
    const meta = (typeof resultSolid.getFaceMetadata === 'function')
      ? resultSolid.getFaceMetadata(name)
      : null;
    if (!meta || meta.source !== 'FilletFeature') continue;
    if (entry.filletName && meta.featureID !== entry.filletName) continue;
    if (meta.type === 'pipe' || (typeof name === 'string' && name.includes('TUBE_Outer'))) {
      best = name;
      break;
    }
    if (!best) best = name;
  }
  return best;
}

function isFilletGeneratedFace(resultSolid, faceName) {
  if (!resultSolid || !faceName || typeof faceName !== 'string') return false;
  if (typeof resultSolid.getFaceMetadata === 'function') {
    const meta = resultSolid.getFaceMetadata(faceName);
    if (meta && (meta.source === 'FilletFeature' || meta.filletRoundFace || meta.filletSourceArea || meta.filletEndCap)) {
      return true;
    }
  }
  if (faceName.includes('_END_CAP_') || faceName.includes('_CapStart') || faceName.includes('_CapEnd')) return true;
  if (faceName.includes('_WEDGE_') || faceName.includes('_SURFACE_') || faceName.includes('_SIDE_')) return true;
  return false;
}

function collectFaceVertexIndices(resultSolid, faceNames) {
  const out = new Set();
  if (!resultSolid || typeof resultSolid.getFace !== 'function') return out;
  if (!Array.isArray(faceNames) || faceNames.length === 0) return out;
  for (const name of faceNames) {
    if (!name) continue;
    const tris = resultSolid.getFace(name);
    if (!Array.isArray(tris) || tris.length === 0) continue;
    for (const tri of tris) {
      const idx = tri?.indices;
      if (Array.isArray(idx) && idx.length >= 3) {
        out.add(idx[0] >>> 0);
        out.add(idx[1] >>> 0);
        out.add(idx[2] >>> 0);
      }
    }
  }
  return out;
}

function collectFilletEndcapIndices(resultSolid) {
  if (!resultSolid || typeof resultSolid.getFaceNames !== 'function') return new Set();
  const faceNames = resultSolid.getFaceNames();
  const endcaps = [];
  for (const name of faceNames) {
    if (!name || typeof name !== 'string') continue;
    let isEndcap = false;
    if (name.includes('_END_CAP_') || name.includes('_CapStart') || name.includes('_CapEnd')) {
      isEndcap = true;
    } else if (typeof resultSolid.getFaceMetadata === 'function') {
      const meta = resultSolid.getFaceMetadata(name);
      if (meta && meta.filletEndCap) isEndcap = true;
    }
    if (isEndcap) endcaps.push(name);
  }
  return collectFaceVertexIndices(resultSolid, endcaps);
}

function dist2PointTriangle(p, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = a[0] + v * abx;
    const qy = a[1] + v * aby;
    const qz = a[2] + v * abz;
    const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = a[0] + w * acx;
    const qy = a[1] + w * acy;
    const qz = a[2] + w * acz;
    const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = b[0] + w * (c[0] - b[0]);
    const qy = b[1] + w * (c[1] - b[1]);
    const qz = b[2] + w * (c[2] - b[2]);
    const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = a[0] + abx * v + acx * w;
  const qy = a[1] + aby * v + acy * w;
  const qz = a[2] + abz * v + acz * w;
  const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
  return dx * dx + dy * dy + dz * dz;
}

function averageDistanceToTris(boundary, tris, vp, maxSamples = 12) {
  const indicesRaw = Array.isArray(boundary?.indices) ? boundary.indices : [];
  if (!indicesRaw.length || !Array.isArray(tris) || tris.length === 0 || !vp) return Infinity;
  const closed = !!boundary?.closedLoop || (indicesRaw[0] === indicesRaw[indicesRaw.length - 1]);
  const indices = closed ? indicesRaw.slice(0, -1) : indicesRaw.slice();
  if (indices.length === 0) return Infinity;
  const stride = Math.max(1, Math.floor(indices.length / Math.max(1, maxSamples)));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < indices.length; i += stride) {
    const idx = indices[i] >>> 0;
    const base = idx * 3;
    const p = [vp[base + 0], vp[base + 1], vp[base + 2]];
    let best = Infinity;
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      const a = tri?.p1;
      const b = tri?.p2;
      const c = tri?.p3;
      if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) continue;
      const d2 = dist2PointTriangle(p, a, b, c);
      if (d2 < best) best = d2;
    }
    if (Number.isFinite(best)) {
      sum += Math.sqrt(best);
      count++;
    }
  }
  if (!count) return Infinity;
  return sum / count;
}

function filterCandidatesByOtherFace(candidates, roundFace, otherFace) {
  if (!otherFace) return [];
  return candidates.filter(c => {
    const a = c.boundary?.faceA;
    const b = c.boundary?.faceB;
    const other = (a === roundFace) ? b : (b === roundFace ? a : null);
    return other === otherFace;
  });
}

function buildVertexFaceMap(resultSolid) {
  const out = new Map();
  if (!resultSolid || !Array.isArray(resultSolid._triVerts) || !Array.isArray(resultSolid._triIDs)) return out;
  const tv = resultSolid._triVerts;
  const ids = resultSolid._triIDs;
  const idToName = resultSolid._idToFaceName instanceof Map ? resultSolid._idToFaceName : null;
  const triCount = (tv.length / 3) | 0;
  if (!idToName || triCount === 0) return out;
  for (let t = 0; t < triCount; t++) {
    const faceName = idToName.get(ids[t]);
    if (!faceName) continue;
    const base = t * 3;
    for (let k = 0; k < 3; k++) {
      const vi = tv[base + k] >>> 0;
      let set = out.get(vi);
      if (!set) { set = new Set(); out.set(vi, set); }
      set.add(faceName);
    }
  }
  return out;
}

function collectVerticesOutsideFacePair(vertexFaceMap, allowedFaces) {
  const out = new Set();
  if (!vertexFaceMap || !allowedFaces) return out;
  for (const [vi, faces] of vertexFaceMap.entries()) {
    let ok = true;
    for (const f of faces) {
      if (!allowedFaces.has(f)) { ok = false; break; }
    }
    if (!ok) out.add(vi);
  }
  return out;
}

function pickBestBoundaryForTangent(candidates, sampler, vp, assigned, opts) {
  if (!Array.isArray(candidates) || !sampler) return null;
  const tol = opts?.tol || 0;
  const maxSnapDist = Number.isFinite(opts?.maxSnapDist)
    ? opts.maxSnapDist
    : Math.max(sampler.avgSegLen * 0.5, tol * 500);
  let best = null;
  for (const item of candidates) {
    const boundary = item.boundary;
    const id = item.id;
    if (assigned && assigned.has(id)) continue;
    const indices = Array.isArray(boundary?.indices) ? boundary.indices : [];
    if (indices.length < 2) continue;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i] >>> 0;
      const base = idx * 3;
      const p = [vp[base + 0], vp[base + 1], vp[base + 2]];
      const proj = sampler.project(p);
      const d = Math.sqrt(proj.dist2);
      if (!Number.isFinite(d)) continue;
      sum += d;
      count++;
    }
    if (!count) continue;
    const avg = sum / count;
    if (avg > maxSnapDist) continue;
    const boundaryLen = computeBoundaryLength(indices, vp);
    const lengthRatio = sampler.totalLen > 0 ? Math.abs(boundaryLen - sampler.totalLen) / sampler.totalLen : 0;
    const cost = avg + lengthRatio * sampler.avgSegLen * 0.5;
    if (!best || cost < best.cost) {
      best = { boundary, id, avg, maxSnapDist, cost };
    }
  }
  return best;
}

function snapBoundaryToTangent(boundary, sampler, vp, opts = {}) {
  const indicesRaw = Array.isArray(boundary?.indices) ? boundary.indices : [];
  if (!indicesRaw.length || !sampler || !vp) return 0;
  const closed = !!boundary?.closedLoop || (indicesRaw[0] === indicesRaw[indicesRaw.length - 1]);
  const indices = closed ? indicesRaw.slice(0, -1) : indicesRaw.slice();
  if (indices.length < 2) return 0;

  const tol = Number.isFinite(opts.tol) ? opts.tol : 0;
  const locked = opts.lockedIndices instanceof Set ? opts.lockedIndices : null;

  const sVals = new Array(indices.length);
  const snapped = new Array(indices.length);
  let totalLen = 0;
  for (let i = 1; i < indices.length; i++) {
    const a = indices[i - 1] >>> 0;
    const b = indices[i] >>> 0;
    const ba = a * 3;
    const bb = b * 3;
    totalLen += Math.hypot(
      vp[bb + 0] - vp[ba + 0],
      vp[bb + 1] - vp[ba + 1],
      vp[bb + 2] - vp[ba + 2],
    );
  }
  if (!(totalLen > 1e-12)) return 0;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] >>> 0;
    const base = idx * 3;
    const p = [vp[base + 0], vp[base + 1], vp[base + 2]];
    const proj = sampler.project(p);
    let s = proj.s;
    if (!Number.isFinite(s)) s = 0;
    if (s < 0) s = 0;
    if (s > sampler.totalLen) s = sampler.totalLen;
    sVals[i] = s;
    snapped[i] = proj.point ? proj.point : sampler.pointAt(s);
  }

  const minMove2 = Number.isFinite(opts.minMove) ? opts.minMove * opts.minMove : 0;
  const maxMoveRatio = Number.isFinite(opts.maxMoveRatio) ? opts.maxMoveRatio : 0.1;
  const maxMove = (Number.isFinite(maxMoveRatio) && maxMoveRatio > 0)
    ? maxMoveRatio * totalLen
    : Infinity;

  let moved = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] >>> 0;
    if (locked && locked.has(idx)) continue;
    const base = idx * 3;
    const pos = snapped[i];
    if (!pos) continue;
    const nx = pos[0], ny = pos[1], nz = pos[2];
    const dx = nx - vp[base + 0];
    const dy = ny - vp[base + 1];
    const dz = nz - vp[base + 2];
    let adjX = nx, adjY = ny, adjZ = nz;
    if (Number.isFinite(maxMove) && maxMove >= 0) {
      const dLen = Math.hypot(dx, dy, dz);
      if (dLen > maxMove && dLen > 1e-12) {
        const scale = maxMove / dLen;
        adjX = vp[base + 0] + dx * scale;
        adjY = vp[base + 1] + dy * scale;
        adjZ = vp[base + 2] + dz * scale;
      }
    }
    const ddx = adjX - vp[base + 0];
    const ddy = adjY - vp[base + 1];
    const ddz = adjZ - vp[base + 2];
    if (ddx * ddx + ddy * ddy + ddz * ddz > minMove2) moved++;
    vp[base + 0] = adjX;
    vp[base + 1] = adjY;
    vp[base + 2] = adjZ;
  }

  // Fix reversed segments by swapping coordinates in decreasing-s runs.
  const eps = Math.max(1e-8, tol * 10);
  const isLockedAt = (i) => {
    const idx = indices[i] >>> 0;
    return !!(locked && locked.has(idx));
  };
  let i = 1;
  while (i < sVals.length) {
    if (sVals[i] < sVals[i - 1] - eps) {
      let start = i - 1;
      let end = i;
      while (end + 1 < sVals.length && sVals[end + 1] < sVals[end] - eps) {
        end++;
      }
      let runStart = start;
      for (let k = start; k <= end; k++) {
        if (isLockedAt(k)) {
          if (runStart < k - 1) {
            for (let a = runStart, b = k - 1; a < b; a++, b--) {
              const ia = indices[a] >>> 0;
              const ib = indices[b] >>> 0;
              const ba = ia * 3;
              const bb = ib * 3;
              const tx = vp[ba + 0], ty = vp[ba + 1], tz = vp[ba + 2];
              vp[ba + 0] = vp[bb + 0]; vp[ba + 1] = vp[bb + 1]; vp[ba + 2] = vp[bb + 2];
              vp[bb + 0] = tx; vp[bb + 1] = ty; vp[bb + 2] = tz;
              const ts = sVals[a]; sVals[a] = sVals[b]; sVals[b] = ts;
            }
          }
          runStart = k + 1;
        }
      }
      if (runStart < end) {
        for (let a = runStart, b = end; a < b; a++, b--) {
          const ia = indices[a] >>> 0;
          const ib = indices[b] >>> 0;
          const ba = ia * 3;
          const bb = ib * 3;
          const tx = vp[ba + 0], ty = vp[ba + 1], tz = vp[ba + 2];
          vp[ba + 0] = vp[bb + 0]; vp[ba + 1] = vp[bb + 1]; vp[ba + 2] = vp[bb + 2];
          vp[bb + 0] = tx; vp[bb + 1] = ty; vp[bb + 2] = tz;
          const ts = sVals[a]; sVals[a] = sVals[b]; sVals[b] = ts;
        }
      }
      i = end + 1;
      continue;
    }
    i++;
  }

  return moved;
}

function snapFilletEdgesToTangents(resultSolid, filletEntries, opts = {}) {
  const vp = Array.isArray(resultSolid?._vertProperties) ? resultSolid._vertProperties : null;
  if (!vp || !Array.isArray(filletEntries) || filletEntries.length === 0) {
    return { movedVertices: 0, snappedEdges: 0, skipped: 0 };
  }
  if (typeof resultSolid.getBoundaryEdgePolylines !== 'function') {
    return { movedVertices: 0, snappedEdges: 0, skipped: filletEntries.length };
  }

  const boundaries = resultSolid.getBoundaryEdgePolylines() || [];
  if (!boundaries.length) {
    return { movedVertices: 0, snappedEdges: 0, skipped: filletEntries.length };
  }

  const tol = Number.isFinite(opts.tol) ? opts.tol : deriveSolidToleranceFromVerts(resultSolid, 1e-5);
  const candidatesAll = boundaries.map((boundary, id) => ({ boundary, id }));
  let movedVertices = 0;
  let snappedEdges = 0;
  let skipped = 0;

  const endcapLocked = collectFilletEndcapIndices(resultSolid);
  const vertexFaceMap = buildVertexFaceMap(resultSolid);

  for (const entry of filletEntries) {
    const roundFace = resolveFilletRoundFaceName(resultSolid, entry);
    if (!roundFace) { skipped++; continue; }
    const candidates = candidatesAll.filter(c => {
      const a = c.boundary?.faceA;
      const b = c.boundary?.faceB;
      if (a !== roundFace && b !== roundFace) return false;
      const other = (a === roundFace) ? b : a;
      if (!other) return false;
      if (isFilletGeneratedFace(resultSolid, other)) return false;
      return true;
    });
    if (!candidates.length) { skipped++; continue; }

    const tangents = [entry?.tangentASeam, entry?.tangentBSeam];
    const targetFaces = [entry?.edgeFaceAName || null, entry?.edgeFaceBName || null];
    const sourceSolid = entry?.edgeObj?.parentSolid || entry?.edgeObj?.parent || resultSolid;
    const trisA = (targetFaces[0] && sourceSolid && typeof sourceSolid.getFace === 'function')
      ? sourceSolid.getFace(targetFaces[0])
      : null;
    const trisB = (targetFaces[1] && sourceSolid && typeof sourceSolid.getFace === 'function')
      ? sourceSolid.getFace(targetFaces[1])
      : null;
    const assigned = new Set();
    const picks = [];
    for (let t = 0; t < tangents.length; t++) {
      const points = tangents[t];
      if (!Array.isArray(points) || points.length < 2) { picks.push(null); continue; }
      const sampler = buildPolylineSampler(points, tol);
      if (!sampler) { picks.push(null); continue; }

      let candidatesForT = candidates;
      const targetFace = targetFaces[t];
      const filteredByFace = filterCandidatesByOtherFace(candidates, roundFace, targetFace);
      if (filteredByFace.length) {
        candidatesForT = filteredByFace;
      } else {
        const tris = (t === 0 ? trisA : trisB);
        if (Array.isArray(tris) && tris.length) {
          const scored = candidates
            .map(c => ({ c, score: averageDistanceToTris(c.boundary, tris, vp, 12) }))
            .filter(item => Number.isFinite(item.score))
            .sort((a, b) => a.score - b.score);
          const first = scored.find(item => !assigned.has(item.c.id));
          if (first) {
            const pick = first.c;
            picks.push({ pick, sampler });
            assigned.add(pick.id);
            continue;
          }
        }
      }

      const pick = pickBestBoundaryForTangent(candidatesForT, sampler, vp, assigned, { tol });
      if (!pick) { picks.push(null); continue; }
      picks.push({ pick, sampler });
      assigned.add(pick.id);
    }

    const locked = new Set(endcapLocked);
    if (picks[0]?.pick && picks[1]?.pick) {
      const idxA = new Set(Array.isArray(picks[0].pick.boundary?.indices) ? picks[0].pick.boundary.indices : []);
      const idxB = Array.isArray(picks[1].pick.boundary?.indices) ? picks[1].pick.boundary.indices : [];
      for (const idx of idxB) {
        const v = idx >>> 0;
        if (idxA.has(v)) locked.add(v);
      }
    }

    for (const item of picks) {
      if (!item) continue;
      const otherFace = (() => {
        const a = item.pick.boundary?.faceA;
        const b = item.pick.boundary?.faceB;
        return (a === roundFace) ? b : (b === roundFace ? a : null);
      })();
      if (otherFace) {
        const allowed = new Set([roundFace, otherFace]);
        const outside = collectVerticesOutsideFacePair(vertexFaceMap, allowed);
        for (const v of outside) locked.add(v);
      }
      const moved = snapBoundaryToTangent(item.pick.boundary, item.sampler, vp, { tol, minMove: tol * 0.1, maxMoveRatio: 0.1, lockedIndices: locked });
      if (moved > 0) {
        movedVertices += moved;
        snappedEdges += 1;
      }
    }
  }

  if (movedVertices > 0) {
    resultSolid._vertKeyToIndex = new Map();
    for (let i = 0; i < vp.length; i += 3) {
      const x = vp[i], y = vp[i + 1], z = vp[i + 2];
      resultSolid._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }
    resultSolid._dirty = true;
    resultSolid._faceIndex = null;
  }

  return { movedVertices, snappedEdges, skipped };
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
  consoleLogReplacement('[Solid.fillet] Inset end cap scan', {
    featureID,
    direction,
    endCapFaces,
  });

  if (!endCapFaces.length) return;

  const adjacentMap = buildAdjacencyFromBoundaryPolylines(resultSolid);
  const tol = deriveSolidToleranceFromVerts(resultSolid, 1e-5);
  const edgeAdjMap = buildAdjacencyFromFaceEdges(resultSolid, activeFaceNames, tol);

  const normalCache = new Map();
  const getNormal = (name) => {
    if (normalCache.has(name)) return normalCache.get(name);
    const n = averageFaceNormalSimple(resultSolid, name);
    normalCache.set(name, n);
    return n;
  };
  const fmtNormal = (n) => (Array.isArray(n) && n.length >= 3)
    ? [Number(n[0].toFixed(6)), Number(n[1].toFixed(6)), Number(n[2].toFixed(6))]
    : null;

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

  let mergedCount = 0;
  for (const capName of endCapFaces) {
    const adj = adjacentMap.get(capName);
    const adjEdge = edgeAdjMap.get(capName);
    const adjAll = new Set([
      ...(adj ? Array.from(adj) : []),
      ...(adjEdge ? Array.from(adjEdge) : []),
    ]);
    consoleLogReplacement('[Solid.fillet] Inset end cap normals', {
      featureID,
      capName,
      capNormal: fmtNormal(getNormal(capName)),
      adjacent: Array.from(adjAll).map((name) => ({
        name,
        normal: fmtNormal(getNormal(name)),
      })),
    });
    if (tryMergeWithAdj(capName, adj)) {
      consoleLogReplacement('[Solid.fillet] Inset end cap merged', { featureID, capName });
      mergedCount++;
      continue;
    }
    if (tryMergeWithAdj(capName, edgeAdjMap.get(capName))) {
      consoleLogReplacement('[Solid.fillet] Inset end cap merged', { featureID, capName });
      mergedCount++;
      continue;
    }
  }
  consoleLogReplacement('[Solid.fillet] Inset end cap merge summary', { featureID, mergedCount });
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
 * @param {boolean} [opts.combineEdges=false] Combine connected edges that share face pairs into single paths
 * @param {boolean} [opts.debug=false] Enable debug visuals in fillet builder
 * @param {boolean} [opts.showTangentOverlays=false] Show pre-inflate tangent overlays on the fillet tube
 * @param {boolean} [opts.snapTangentOverlays=true] Snap resulting fillet edge vertices onto the tangent overlays
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
  const resolutionRaw = Number(opts.resolution);
  const resolution = (Number.isFinite(resolutionRaw) && resolutionRaw > 0)
    ? Math.max(8, Math.floor(resolutionRaw))
    : 32;
  const combineEdges = (dir !== 'INSET') && !!opts.combineEdges;
  const showTangentOverlays = !!opts.showTangentOverlays;
  const snapTangentOverlays = opts.snapTangentOverlays !== false;
  const featureID = opts.featureID || 'FILLET';
  const cleanupTinyFaceIslandsAreaRaw = Number(opts.cleanupTinyFaceIslandsArea);
  const cleanupTinyFaceIslandsArea = Number.isFinite(cleanupTinyFaceIslandsAreaRaw)
    ? cleanupTinyFaceIslandsAreaRaw
    : 0.001;
  const SolidCtor = this?.constructor;
  consoleLogReplacement('[Solid.fillet] Begin', {
    featureID,
    solid: this?.name,
    radius,
    direction: dir,
    inflate,
    resolution,
    debug,
    showTangentOverlays,
    snapTangentOverlays,
    combineEdges,
    cleanupTinyFaceIslandsArea,
    requestedEdgeNames: Array.isArray(opts.edgeNames) ? opts.edgeNames : [],
    providedEdgeCount: Array.isArray(opts.edges) ? opts.edges.length : 0,
  });

  // Resolve edges from names and/or provided objects
  const unique = resolveEdgesFromInputs(this, { edgeNames: opts.edgeNames, edges: opts.edges });
  if (unique.length === 0) {
    console.warn('[Solid.fillet] No edges resolved on target solid; returning clone.', { featureID, solid: this?.name });
    // Nothing to do - return an unchanged clone so caller can replace scene node safely
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }

  const combineCornerHulls = combineEdges && unique.length > 1;
  let filletEdges = unique;
  if (combineCornerHulls) {
    consoleLogReplacement('[Solid.fillet] combineEdges enabled: using corner hulls for shared endpoints.');
  }

  // Build fillet solids per edge using existing core implementation
  const filletEntries = [];
  let idx = 0;
  const debugAdded = [];
  const attachDebugSolids = (target, reason = '') => {
    if (!target || debugAdded.length === 0) return;
    try { target.__debugAddedSolids = debugAdded; } catch { }
    const prefix = debug ? '🐛 Debug' : '⚠️ Failure Debug';
    const suffix = reason ? ` (${reason})` : '';
    consoleLogReplacement(`${prefix}: Added ${debugAdded.length} debug solids to result${suffix}`);
  };
  for (const e of filletEdges) {
    const name = `${featureID}_FILLET_${idx++}`;
    const res = filletSolid({ edgeToFillet: e, radius, sideMode: dir, inflate, resolution, debug, name, showTangentOverlays }) || {};

    // Handle debug solids even on failure
    if (debug || !res.finalSolid) {
      try { if (res.tube) debugAdded.push(res.tube); } catch { }
      try { if (res.wedge) debugAdded.push(res.wedge); } catch { }

      // If there was an error, log it and add debug info
      if (res.error) {
        console.warn(`Fillet failed for edge ${e?.name || idx}: ${res.error}`);
      }
    }
    if (!res.finalSolid) {
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
      edgeObj: e,
      edgePoints: Array.isArray(res.edge) ? res.edge : [],
      edgeFaceAName: e?.faces?.[0]?.name || e?.userData?.faceA || null,
      edgeFaceBName: e?.faces?.[1]?.name || e?.userData?.faceB || null,
      tangentASeam: (Array.isArray(res.tangentASeam) && res.tangentASeam.length)
        ? res.tangentASeam
        : (Array.isArray(res.tangentA) ? res.tangentA : []),
      tangentBSeam: (Array.isArray(res.tangentBSeam) && res.tangentBSeam.length)
        ? res.tangentBSeam
        : (Array.isArray(res.tangentB) ? res.tangentB : []),
    });
    if (debug) {
      try { if (res.tube) debugAdded.push(res.tube); } catch { }
      try { if (res.wedge) debugAdded.push(res.wedge); } catch { }
    }
  }
  if (filletEntries.length === 0) {
    console.error('[Solid.fillet] All edge fillets failed; returning clone.', { featureID, edgeCount: unique.length });
    const c = this.clone();
    try { c.name = this.name; } catch { }
    attachDebugSolids(c, 'all fillets failed');
    return c;
  }
  consoleLogReplacement('[Solid.fillet] Built fillet solids for edges', filletEntries.length);

  const cornerWedgeHulls = [];
  const cornerTubeHulls = [];
  let combinedFilletSolid = null;
  if (combineCornerHulls && SolidCtor && filletEntries.length > 1) {
    try {
      const polylines = [];
      for (const entry of filletEntries) {
        const poly = getEdgePolylineLocal(entry.edgeObj);
        if (poly.length >= 2) polylines.push(poly);
      }
      const cornerTol = deriveTolerance(polylines, 1e-5);
      const { q, k } = createQuantizer(cornerTol);
      const groups = new Map();

      const addEndpoint = (pt, entry, cap) => {
        if (!Array.isArray(pt) || pt.length < 3) return;
        const qp = q(pt);
        const key = k(qp);
        if (!groups.has(key)) groups.set(key, { point: qp, items: [] });
        groups.get(key).items.push({ entry, cap });
      };

      for (const entry of filletEntries) {
        let poly = getEdgePolylineLocal(entry.edgeObj);
        if (poly.length < 2 && Array.isArray(entry.edgePoints) && entry.edgePoints.length >= 2) {
          poly = entry.edgePoints.map(p => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]);
        }
        if (poly.length < 2) continue;
        addEndpoint(poly[0], entry, 'start');
        addEndpoint(poly[poly.length - 1], entry, 'end');
      }

      let cornerIdx = 0;
      for (const group of groups.values()) {
        if (!group || !Array.isArray(group.items) || group.items.length < 2) continue;
        const wedgePoints = [];
        const tubePoints = [];
        for (const item of group.items) {
          const entry = item.entry;
          if (!entry) continue;
          const filletName = entry.filletName;
          const wedge = entry.wedgeSolid;
          const tube = entry.tubeSolid;
          const capSuffix = (item.cap === 'start') ? '_END_CAP_1' : '_END_CAP_2';
          const tubeSuffix = (item.cap === 'start') ? '_TUBE_CapStart' : '_TUBE_CapEnd';
          if (wedge) collectFacePoints(wedge, `${filletName}${capSuffix}`, wedgePoints);
          if (tube) collectFacePoints(tube, `${filletName}${tubeSuffix}`, tubePoints);
        }

        const wedgeHull = buildHullSolidFromPoints(wedgePoints, `${featureID}_CORNER_${cornerIdx}_WEDGE_HULL`, SolidCtor, cornerTol);
        const tubeHull = buildHullSolidFromPoints(tubePoints, `${featureID}_CORNER_${cornerIdx}_TUBE_HULL`, SolidCtor, cornerTol);
        if (!wedgeHull || !tubeHull) {
          cornerIdx++;
          continue;
        }
        cornerWedgeHulls.push(wedgeHull);
        cornerTubeHulls.push(tubeHull);
        if (debug) {
          debugAdded.push(wedgeHull);
          debugAdded.push(tubeHull);
        }
        cornerIdx++;
      }
      const wedgeParts = [];
      const tubeParts = [];
      for (const entry of filletEntries) {
        if (entry.wedgeSolid) wedgeParts.push(entry.wedgeSolid);
        if (entry.tubeSolid) tubeParts.push(entry.tubeSolid);
      }
      if (cornerWedgeHulls.length) wedgeParts.push(...cornerWedgeHulls);
      if (cornerTubeHulls.length) tubeParts.push(...cornerTubeHulls);

      const unionAll = (parts) => {
        let acc = null;
        for (const solid of parts) {
          acc = acc ? acc.union(solid) : solid;
        }
        return acc;
      };

      const combinedWedge = unionAll(wedgeParts);
      const combinedTube = unionAll(tubeParts);
      if (combinedWedge && combinedTube) {
        combinedFilletSolid = combinedWedge.subtract(combinedTube);
        try { combinedFilletSolid.name = `${featureID}_FILLET_COMBINED`; } catch { }
        if (debug) {
          debugAdded.push(combinedWedge);
          debugAdded.push(combinedTube);
        }
      }
    } catch (err) {
      console.warn('[Solid.fillet] Corner hull build failed', { featureID, error: err?.message || err });
    }
  }

  // Apply to base solid (union for OUTSET, subtract for INSET)
  let result = this;
  const solidsToApply = combinedFilletSolid ? [combinedFilletSolid] : filletEntries.map(entry => entry.filletSolid);
  try {
    for (const filletSolid of solidsToApply) {
      const operation = (dir === 'OUTSET') ? 'union' : 'subtract';
      result = (operation === 'union') ? result.union(filletSolid) : result.subtract(filletSolid);

      result.visualize();

      // Name the result for scene grouping/debugging
      try { result.name = this.name; } catch { }
    }
  } catch (err) {
    console.error('[Solid.fillet] Fillet boolean failed; returning clone.', { featureID, error: err?.message || err });
    const fallback = this.clone();
    try { fallback.name = this.name; } catch { }
    attachDebugSolids(fallback, 'boolean failure');
    return fallback;
  }

  try {
    const boundaryCache = { current: null };
    const resultAreaCache = buildFaceAreaCache(result);
    for (const entry of filletEntries) {
      const { filletSolid, filletName } = entry;
      const mergeSolid = combinedFilletSolid || filletSolid;
      const roundFaceName = entry.roundFaceName || guessRoundFaceName(mergeSolid, filletName);
      const candidateNames = (Array.isArray(entry.mergeCandidates) && entry.mergeCandidates.length)
        ? entry.mergeCandidates
        : getFilletMergeCandidateNames(mergeSolid);
      mergeTinyFacesIntoRoundFace(result, mergeSolid, candidateNames, roundFaceName, featureID, boundaryCache, resultAreaCache);
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
    if (snapTangentOverlays) {
      const stats = snapFilletEdgesToTangents(result, filletEntries, { tol: deriveSolidToleranceFromVerts(result, 1e-5) });
      if (debug && stats?.movedVertices) {
        console.log('[Solid.fillet] Snapped fillet tangents', stats);
      }
    }
  } catch (err) {
    console.warn('[Solid.fillet] tangent snap failed', { featureID, error: err?.message || err });
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
  } else {
    consoleLogReplacement('[Solid.fillet] Completed', { featureID, triangles: finalTriCount, vertices: finalVertCount });
  }

  return result;
}



function consoleLogReplacement(args){
  if (debugMode) console.log(...args);
}

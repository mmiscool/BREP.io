// Solid.fillet implementation: consolidates fillet logic so features call this API.
// Usage: solid.fillet({ radius, edges, featureID, direction, inflate, resolution, debug, debugSolidsLevel, debugShowCombinedBeforeTarget, showTangentOverlays, patchFilletEndCaps })
import { Vertex } from '../Vertex.js';
import { resolveEdgesFromInputs } from './edgeResolution.js';
import { computeFaceAreaFromTriangles } from '../fillets/filletGeometry.js';
import { getCachedFaceDataForTris, localFaceNormalAtPoint, averageFaceNormalObjectSpace } from '../fillets/inset.js';
import { createQuantizer } from '../../utils/geometryTolerance.js';
import { applyConstrainedVertexTargets } from '../../features/edgeSmooth/vertexTargetConstraints.js';
import { Manifold } from '../SolidShared.js';

// Threshold for collapsing tiny end caps into the round face.
const END_CAP_AREA_RATIO_THRESHOLD = 0.05;
// Temporary kill-switch: keep fillet face names stable while debugging patch flow.
const ENABLE_FILLET_FACE_RENAMING = false;

function createFaceTrianglesAccessor(solid) {
  const cache = new Map();
  let lastFaceIndexRef = solid?._faceIndex || null;
  return (faceName) => {
    if (!solid || typeof solid.getFace !== 'function' || !faceName) return [];
    const currentFaceIndexRef = solid?._faceIndex || null;
    if (currentFaceIndexRef !== lastFaceIndexRef) {
      cache.clear();
      lastFaceIndexRef = currentFaceIndexRef;
    }
    if (cache.has(faceName)) return cache.get(faceName);
    const tris = solid.getFace(faceName);
    const out = Array.isArray(tris) ? tris : [];
    const refreshedFaceIndexRef = solid?._faceIndex || null;
    if (refreshedFaceIndexRef !== lastFaceIndexRef) {
      cache.clear();
      lastFaceIndexRef = refreshedFaceIndexRef;
    }
    cache.set(faceName, out);
    return out;
  };
}

function computeFaceAreaByName(solid, faceName, getFaceTris = null) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return 0;
  try {
    const tris = (typeof getFaceTris === 'function')
      ? getFaceTris(faceName)
      : solid.getFace(faceName);
    return computeFaceAreaFromTriangles(tris);
  } catch {
    return 0;
  }
}

function buildFaceAreaCache(solid, getFaceTris = null) {
  const cache = new Map();
  return {
    get(name) {
      if (!name) return 0;
      if (cache.has(name)) return cache.get(name);
      const area = computeFaceAreaByName(solid, name, getFaceTris);
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

function averageFaceNormalSimple(solid, faceName, getFaceTris = null) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return null;
  const tris = (typeof getFaceTris === 'function')
    ? getFaceTris(faceName)
    : solid.getFace(faceName);
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

function normalizeFilletDirectionMode(rawDirection) {
  const dir = String(rawDirection || 'AUTO').toUpperCase();
  if (dir === 'INSET' || dir === 'OUTSET' || dir === 'AUTO') return dir;
  return 'AUTO';
}

function normalizeFilletSectionDebuggerName(name) {
  if (name == null) return null;
  const raw = String(name).trim();
  if (!raw) return null;
  return raw.replace(/\[\d+\]$/, '');
}

function filletSectionDebuggerMatchesEdge(state, featureID, edgeObj) {
  if (!state || !state.enabled) return false;
  const feature = featureID == null ? null : String(featureID);
  if (state.featureID != null && state.featureID !== '' && feature != null) {
    if (String(state.featureID) !== feature) return false;
  }
  const targetRaw = normalizeFilletSectionDebuggerName(state.edgeName);
  if (!targetRaw) return true;
  const edgeNameRaw = normalizeFilletSectionDebuggerName(edgeObj?.name);
  if (!edgeNameRaw) return false;
  return edgeNameRaw === targetRaw;
}

function buildSectionPlaneBasis(normal) {
  if (!Array.isArray(normal) || normal.length < 3) return null;
  const nx = Number(normal[0]) || 0;
  const ny = Number(normal[1]) || 0;
  const nz = Number(normal[2]) || 0;
  const nLen = Math.hypot(nx, ny, nz);
  if (!(nLen > 1e-12)) return null;
  const uxN = nx / nLen;
  const uyN = ny / nLen;
  const uzN = nz / nLen;

  const ref = (Math.abs(uxN) < 0.8) ? [1, 0, 0] : [0, 1, 0];
  let ux = uyN * ref[2] - uzN * ref[1];
  let uy = uzN * ref[0] - uxN * ref[2];
  let uz = uxN * ref[1] - uyN * ref[0];
  let uLen = Math.hypot(ux, uy, uz);
  if (!(uLen > 1e-12)) {
    ux = uyN * 1 - uzN * 0;
    uy = uzN * 0 - uxN * 1;
    uz = uxN * 0 - uyN * 0;
    uLen = Math.hypot(ux, uy, uz);
  }
  if (!(uLen > 1e-12)) return null;
  ux /= uLen; uy /= uLen; uz /= uLen;

  let vx = uyN * uz - uzN * uy;
  let vy = uzN * ux - uxN * uz;
  let vz = uxN * uy - uyN * ux;
  const vLen = Math.hypot(vx, vy, vz);
  if (!(vLen > 1e-12)) return null;
  vx /= vLen; vy /= vLen; vz /= vLen;

  return {
    n: [uxN, uyN, uzN],
    u: [ux, uy, uz],
    v: [vx, vy, vz],
  };
}

function sectionPolylineTangent(points, idx) {
  const pts = Array.isArray(points) ? points : [];
  const n = pts.length;
  if (n < 2) return [1, 0, 0];
  const i = Math.max(0, Math.min(n - 1, idx | 0));
  const prev = pts[Math.max(0, i - 1)];
  const next = pts[Math.min(n - 1, i + 1)];
  if (!prev || !next) return [1, 0, 0];
  let tx = (next.x - prev.x);
  let ty = (next.y - prev.y);
  let tz = (next.z - prev.z);
  let len = Math.hypot(tx, ty, tz);
  if (!(len > 1e-12)) {
    if (i + 1 < n) {
      const cur = pts[i];
      const n1 = pts[i + 1];
      tx = n1.x - cur.x; ty = n1.y - cur.y; tz = n1.z - cur.z;
      len = Math.hypot(tx, ty, tz);
    }
  }
  if (!(len > 1e-12)) return [1, 0, 0];
  return [tx / len, ty / len, tz / len];
}

function distPoint3(a, b) {
  if (!a || !b) return NaN;
  return Math.hypot((a.x - b.x), (a.y - b.y), (a.z - b.z));
}

function pushUniquePoint3(list, point, eps2) {
  if (!Array.isArray(list) || !point) return;
  const px = Number(point.x);
  const py = Number(point.y);
  const pz = Number(point.z);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
  for (const q of list) {
    const dx = px - q.x;
    const dy = py - q.y;
    const dz = pz - q.z;
    if (((dx * dx) + (dy * dy) + (dz * dz)) <= eps2) return;
  }
  list.push({ x: px, y: py, z: pz });
}

function pickFarthestPointPair(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return null;
  let bestI = 0;
  let bestJ = 1;
  let bestD2 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i];
      const b = pts[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d2 = (dx * dx) + (dy * dy) + (dz * dz);
      if (d2 > bestD2) {
        bestD2 = d2;
        bestI = i;
        bestJ = j;
      }
    }
  }
  if (!(bestD2 > 0)) return null;
  return [pts[bestI], pts[bestJ]];
}

function buildPlaneIntersectionSegments(solid, planePoint, planeNormal, tolerance = 1e-5) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  if (!tv || !vp || tv.length < 3 || vp.length < 9) return [];

  const eps = Math.max(1e-9, Math.abs(Number(tolerance) || 0));
  const eps2 = eps * eps;
  const nx = Number(planeNormal?.[0]) || 0;
  const ny = Number(planeNormal?.[1]) || 0;
  const nz = Number(planeNormal?.[2]) || 0;
  const px = Number(planePoint?.x);
  const py = Number(planePoint?.y);
  const pz = Number(planePoint?.z);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return [];
  if (!(Math.hypot(nx, ny, nz) > 1e-12)) return [];

  const triCount = (tv.length / 3) | 0;
  const segments = [];
  const evalSigned = (p) => ((p.x - px) * nx) + ((p.y - py) * ny) + ((p.z - pz) * nz);
  const intersectEdge = (a, b, da, db) => {
    const denom = da - db;
    if (Math.abs(denom) <= 1e-20) return null;
    const t = da / denom;
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  };

  for (let ti = 0; ti < triCount; ti++) {
    const b = ti * 3;
    const ia = (tv[b + 0] >>> 0) * 3;
    const ib = (tv[b + 1] >>> 0) * 3;
    const ic = (tv[b + 2] >>> 0) * 3;
    if (ia + 2 >= vp.length || ib + 2 >= vp.length || ic + 2 >= vp.length) continue;
    const pA = { x: vp[ia + 0], y: vp[ia + 1], z: vp[ia + 2] };
    const pB = { x: vp[ib + 0], y: vp[ib + 1], z: vp[ib + 2] };
    const pC = { x: vp[ic + 0], y: vp[ic + 1], z: vp[ic + 2] };
    const dA = evalSigned(pA);
    const dB = evalSigned(pB);
    const dC = evalSigned(pC);

    if ((dA > eps && dB > eps && dC > eps) || (dA < -eps && dB < -eps && dC < -eps)) continue;

    const hits = [];
    if (Math.abs(dA) <= eps) pushUniquePoint3(hits, pA, eps2);
    if (Math.abs(dB) <= eps) pushUniquePoint3(hits, pB, eps2);
    if (Math.abs(dC) <= eps) pushUniquePoint3(hits, pC, eps2);

    if (dA * dB < -eps2) {
      const p = intersectEdge(pA, pB, dA, dB);
      if (p) pushUniquePoint3(hits, p, eps2);
    }
    if (dB * dC < -eps2) {
      const p = intersectEdge(pB, pC, dB, dC);
      if (p) pushUniquePoint3(hits, p, eps2);
    }
    if (dC * dA < -eps2) {
      const p = intersectEdge(pC, pA, dC, dA);
      if (p) pushUniquePoint3(hits, p, eps2);
    }

    if (hits.length < 2) continue;
    const pair = pickFarthestPointPair(hits);
    if (!pair) continue;
    segments.push(pair);
  }
  return segments;
}

function stitchPlaneIntersectionPolylines(segments, tolerance = 1e-5) {
  const segs = Array.isArray(segments) ? segments : [];
  if (!segs.length) return [];
  const tol = Math.max(1e-9, Math.abs(Number(tolerance) || 0));
  const invTol = 1 / tol;
  const keyOf = (p) => {
    const x = Math.round((Number(p.x) || 0) * invTol);
    const y = Math.round((Number(p.y) || 0) * invTol);
    const z = Math.round((Number(p.z) || 0) * invTol);
    return `${x},${y},${z}`;
  };
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const keyToPoint = new Map();
  const adj = new Map();
  const uniqueEdges = new Set();

  for (const seg of segs) {
    const a = Array.isArray(seg) ? seg[0] : null;
    const b = Array.isArray(seg) ? seg[1] : null;
    if (!a || !b) continue;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (!ka || !kb || ka === kb) continue;
    const ek = edgeKey(ka, kb);
    if (uniqueEdges.has(ek)) continue;
    uniqueEdges.add(ek);
    if (!keyToPoint.has(ka)) keyToPoint.set(ka, { x: a.x, y: a.y, z: a.z });
    if (!keyToPoint.has(kb)) keyToPoint.set(kb, { x: b.x, y: b.y, z: b.z });
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka).add(kb);
    adj.get(kb).add(ka);
  }

  const visitedEdges = new Set();
  const buildWalk = (start) => {
    const path = [start];
    let prev = null;
    let cur = start;
    while (true) {
      const neighbors = Array.from(adj.get(cur) || []);
      let next = null;
      for (const cand of neighbors) {
        const ek = edgeKey(cur, cand);
        if (visitedEdges.has(ek)) continue;
        if (prev !== null && cand === prev && neighbors.length > 1) continue;
        next = cand;
        break;
      }
      if (next === null) break;
      const ek = edgeKey(cur, next);
      visitedEdges.add(ek);
      prev = cur;
      cur = next;
      path.push(cur);
      if (cur === start) break;
    }
    return path;
  };

  const starts = Array.from(adj.keys()).sort((a, b) => {
    const da = (adj.get(a)?.size || 0);
    const db = (adj.get(b)?.size || 0);
    return da - db;
  });
  const polylines = [];

  for (const s of starts) {
    const walk = buildWalk(s);
    if (!Array.isArray(walk) || walk.length < 2) continue;
    const pts = [];
    for (const key of walk) {
      const p = keyToPoint.get(key);
      if (!p) continue;
      pts.push({ x: p.x, y: p.y, z: p.z });
    }
    if (pts.length >= 2) polylines.push(pts);
  }

  return polylines;
}

function createSectionDebugMarker(position, name, colorHex = '#ffcc00') {
  const p = position || { x: 0, y: 0, z: 0 };
  const marker = new Vertex([p.x || 0, p.y || 0, p.z || 0], { name });
  try {
    const ptMat = marker?._point?.material;
    if (ptMat && ptMat.isPointsMaterial) {
      const mat = ptMat.clone();
      mat.color.set(colorHex);
      mat.size = 9;
      mat.sizeAttenuation = false;
      mat.depthTest = false;
      mat.depthWrite = false;
      mat.transparent = true;
      mat.opacity = 1;
      marker._point.material = mat;
    }
    if (marker?._point) {
      marker._point.renderOrder = 10045;
      marker._point.frustumCulled = false;
    }
    marker.renderOrder = 10045;
    marker.frustumCulled = false;
    marker.userData = {
      ...(marker.userData || {}),
      filletDebug: true,
      debugType: 'section_debug_marker',
    };
  } catch { }
  return marker;
}

function buildFilletSectionDebugSolid({
  baseSolid = null,
  edgeObj = null,
  featureID = 'FILLET',
  filletName = 'FILLET',
  centerline = null,
  tangentA = null,
  tangentB = null,
  edgePoints = null,
  radius = 1,
  rawStepIndex = 0,
  DebugSolidClass = null,
} = {}) {
  const c = Array.isArray(centerline) ? centerline : [];
  const a = Array.isArray(tangentA) ? tangentA : [];
  const b = Array.isArray(tangentB) ? tangentB : [];
  const e = Array.isArray(edgePoints) ? edgePoints : [];
  const sampleCount = Math.min(c.length, a.length, b.length, e.length);
  if (sampleCount < 1) return null;

  const raw = Number(rawStepIndex);
  const stepRaw = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  let step = stepRaw % sampleCount;
  if (step < 0) step += sampleCount;

  const centerPt = c[step];
  const tangentAPt = a[step];
  const tangentBPt = b[step];
  const edgePt = e[step];
  if (!centerPt || !tangentAPt || !tangentBPt || !edgePt) return null;

  const tangentDir = sectionPolylineTangent(c, step);
  const basis = buildSectionPlaneBasis(tangentDir);
  if (!basis) return null;

  const localRadius = Math.max(
    Math.abs(Number(radius) || 0),
    distPoint3(centerPt, edgePt) || 0,
    distPoint3(centerPt, tangentAPt) || 0,
    distPoint3(centerPt, tangentBPt) || 0,
    1e-3,
  );
  const prevCenter = c[Math.max(0, step - 1)] || centerPt;
  const nextCenter = c[Math.min(sampleCount - 1, step + 1)] || centerPt;
  const localStep = Math.max(1e-3, distPoint3(prevCenter, nextCenter) || 0);
  const planeSize = Math.max(localRadius * 2.75, localStep * 1.5, 0.5);

  const ux = basis.u[0], uy = basis.u[1], uz = basis.u[2];
  const vx = basis.v[0], vy = basis.v[1], vz = basis.v[2];
  const px = edgePt.x, py = edgePt.y, pz = edgePt.z;
  const c0 = [px + (-ux - vx) * planeSize, py + (-uy - vy) * planeSize, pz + (-uz - vz) * planeSize];
  const c1 = [px + (ux - vx) * planeSize, py + (uy - vy) * planeSize, pz + (uz - vz) * planeSize];
  const c2 = [px + (ux + vx) * planeSize, py + (uy + vy) * planeSize, pz + (uz + vz) * planeSize];
  const c3 = [px + (-ux + vx) * planeSize, py + (-uy + vy) * planeSize, pz + (-uz + vz) * planeSize];

  const tol = deriveSolidToleranceFromVerts(baseSolid, 1e-5) * 2;
  const segs = buildPlaneIntersectionSegments(baseSolid, edgePt, basis.n, tol);
  const sectionPolylines = stitchPlaneIntersectionPolylines(segs, tol);

  const SolidClass = DebugSolidClass || baseSolid?.constructor?.BaseSolid || baseSolid?.constructor;
  if (typeof SolidClass !== 'function') return null;
  const debugSolid = new SolidClass();
  const rootName = `${featureID || 'FILLET'}_SECTION_STEP_${step + 1}`;
  debugSolid.name = `${rootName}_DEBUG`;
  debugSolid.addTriangle(`${rootName}_SECTION_PLANE`, c0, c1, c2);
  debugSolid.addTriangle(`${rootName}_SECTION_PLANE`, c0, c2, c3);

  const partialCenter = c.slice(0, step + 1).map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const partialA = a.slice(0, step + 1).map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const partialB = b.slice(0, step + 1).map((p) => ({ x: p.x, y: p.y, z: p.z }));
  if (partialCenter.length >= 2) debugSolid.addAuxEdge(`${rootName}_CENTERLINE`, partialCenter, { materialKey: 'OVERLAY' });
  if (partialA.length >= 2) debugSolid.addAuxEdge(`${rootName}_TANGENT_A`, partialA, { materialKey: 'OVERLAY' });
  if (partialB.length >= 2) debugSolid.addAuxEdge(`${rootName}_TANGENT_B`, partialB, { materialKey: 'OVERLAY' });

  debugSolid.addAuxEdge(`${rootName}_SECTION_CENTER_TO_EDGE`, [centerPt, edgePt], { materialKey: 'OVERLAY' });
  debugSolid.addAuxEdge(`${rootName}_SECTION_CENTER_TO_TA`, [centerPt, tangentAPt], { materialKey: 'OVERLAY' });
  debugSolid.addAuxEdge(`${rootName}_SECTION_CENTER_TO_TB`, [centerPt, tangentBPt], { materialKey: 'OVERLAY' });
  debugSolid.addAuxEdge(`${rootName}_SECTION_TANGENT_CHORD`, [tangentAPt, tangentBPt], { materialKey: 'OVERLAY' });
  debugSolid.addAuxEdge(`${rootName}_SECTION_NORMAL`, [
    edgePt,
    {
      x: edgePt.x + basis.n[0] * planeSize * 0.8,
      y: edgePt.y + basis.n[1] * planeSize * 0.8,
      z: edgePt.z + basis.n[2] * planeSize * 0.8,
    },
  ], { materialKey: 'OVERLAY' });

  for (let i = 0; i < sectionPolylines.length; i++) {
    const poly = sectionPolylines[i];
    if (!Array.isArray(poly) || poly.length < 2) continue;
    debugSolid.addAuxEdge(`${rootName}_MESH_SECTION_${i}`, poly, { materialKey: 'OVERLAY' });
  }

  debugSolid.add(createSectionDebugMarker(edgePt, `${rootName}_EDGE_PT`, '#ff44ff'));
  debugSolid.add(createSectionDebugMarker(centerPt, `${rootName}_CENTER_PT`, '#ffd166'));
  debugSolid.add(createSectionDebugMarker(tangentAPt, `${rootName}_TANGENT_A_PT`, '#2ce6ff'));
  debugSolid.add(createSectionDebugMarker(tangentBPt, `${rootName}_TANGENT_B_PT`, '#76ff03'));

  try {
    debugSolid.userData = {
      ...(debugSolid.userData || {}),
      filletDebug: true,
      debugType: 'fillet_section_step',
      filletName: filletName || null,
      featureID: featureID || null,
      edgeName: edgeObj?.name || null,
      sampleCount,
      stepIndex: step,
      stepDisplayIndex: step + 1,
      rawStepIndex: stepRaw,
      planeIntersectionPolylines: sectionPolylines.length,
    };
  } catch { }

  return { debugSolid, sampleCount, resolvedStep: step };
}

function buildPointInsideTester(solid) {
  if (!solid) return null;
  const tv = solid._triVerts;
  const vp = solid._vertProperties;
  if (!tv || !vp || typeof tv.length !== 'number' || typeof vp.length !== 'number') return null;
  const triCount = (tv.length / 3) | 0;
  if (triCount === 0 || vp.length < 9) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const jitter = 1e-6 * diag;

  const rayTri = (ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const EPS = 1e-12;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) return null;
    const invDet = 1.0 / det;
    const tvecx = ox - ax, tvecy = oy - ay, tvecz = oz - az;
    const u = (tvecx * px + tvecy * py + tvecz * pz) * invDet;
    if (u < -1e-12 || u > 1 + 1e-12) return null;
    const qx = tvecy * e1z - tvecz * e1y;
    const qy = tvecz * e1x - tvecx * e1z;
    const qz = tvecx * e1y - tvecy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < -1e-12 || u + v > 1 + 1e-12) return null;
    const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return tHit > 1e-10 ? tHit : null;
  };

  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  return (pt) => {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) return false;
    const px = pt.x, py = pt.y, pz = pt.z;
    let votes = 0;
    for (let k = 0; k < dirs.length; k++) {
      const dir = dirs[k];
      const ox = px + (k + 1) * jitter;
      const oy = py + (k + 2) * jitter;
      const oz = pz + (k + 3) * jitter;
      let hits = 0;
      for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const ia = (tv[b + 0] >>> 0) * 3;
        const ib = (tv[b + 1] >>> 0) * 3;
        const ic = (tv[b + 2] >>> 0) * 3;
        const hit = rayTri(
          ox, oy, oz,
          dir[0], dir[1], dir[2],
          vp[ia + 0], vp[ia + 1], vp[ia + 2],
          vp[ib + 0], vp[ib + 1], vp[ib + 2],
          vp[ic + 0], vp[ic + 1], vp[ic + 2]
        );
        if (hit !== null) hits++;
      }
      if ((hits % 2) === 1) votes++;
    }
    return votes >= 2;
  };
}

function getEdgeFaceNames(edgeObj) {
  const faceAName = edgeObj?.faces?.[0]?.name || edgeObj?.userData?.faceA || null;
  const faceBName = edgeObj?.faces?.[1]?.name || edgeObj?.userData?.faceB || null;
  return { faceAName, faceBName };
}

function getEdgePolylineLocal(edgeObj) {
  const poly = edgeObj?.userData?.polylineLocal;
  if (!Array.isArray(poly) || poly.length < 2) return null;
  return poly;
}

function samplePolylineAt(polylineLocal, tNorm) {
  if (!Array.isArray(polylineLocal) || polylineLocal.length < 2) return null;
  const clamped = Math.max(0, Math.min(1, Number(tNorm)));
  const segCount = polylineLocal.length - 1;
  const f = clamped * segCount;
  const i = Math.min(segCount - 1, Math.floor(f));
  const t = f - i;
  const a = polylineLocal[i];
  const b = polylineLocal[i + 1];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return null;
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function buildEdgeSamplePointsForCount(edgeObj, sampleCount) {
  const count = Number.isFinite(Number(sampleCount)) ? Math.max(0, Math.floor(Number(sampleCount))) : 0;
  if (count < 1) return [];
  const poly = getEdgePolylineLocal(edgeObj);
  if (!Array.isArray(poly) || poly.length < 2) return [];
  if (count === 1) {
    const p0 = samplePolylineAt(poly, 0);
    if (!Array.isArray(p0) || p0.length < 3) return [];
    return [{ x: p0[0], y: p0[1], z: p0[2] }];
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const p = samplePolylineAt(poly, t);
    if (!Array.isArray(p) || p.length < 3) continue;
    out.push({ x: p[0], y: p[1], z: p[2] });
  }
  return out;
}

function toPoint3Object(point) {
  if (Array.isArray(point) && point.length >= 3) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const z = Number(point[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    return null;
  }
  if (point && typeof point === 'object') {
    const x = Number(point.x);
    const y = Number(point.y);
    const z = Number(point.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
  }
  return null;
}

function point3DistanceSq(a, b) {
  const pa = toPoint3Object(a);
  const pb = toPoint3Object(b);
  if (!pa || !pb) return Infinity;
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  const dz = pa.z - pb.z;
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function normalizePoint3Vector(vx, vy, vz) {
  const len = Math.hypot(vx, vy, vz);
  if (!(len > 1e-12)) return null;
  return [vx / len, vy / len, vz / len];
}

function collectFaceUniquePoints(solid, faceName, eps = 1e-6) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return [];
  const tris = solid.getFace(faceName);
  if (!Array.isArray(tris) || tris.length === 0) return [];
  const out = [];
  const eps2 = Math.max(1e-16, Math.abs(Number(eps) || 0) ** 2);
  for (const tri of tris) {
    const p1 = toPoint3Object(tri?.p1);
    const p2 = toPoint3Object(tri?.p2);
    const p3 = toPoint3Object(tri?.p3);
    if (p1) pushUniquePoint3(out, p1, eps2);
    if (p2) pushUniquePoint3(out, p2, eps2);
    if (p3) pushUniquePoint3(out, p3, eps2);
  }
  return out;
}

function centroidOfPointSet(points) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const raw of pts) {
    const p = toPoint3Object(raw);
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    sz += p.z;
    count += 1;
  }
  if (!(count > 0)) return null;
  return { x: sx / count, y: sy / count, z: sz / count };
}

function estimatePointSetRadius(points, center) {
  const c = toPoint3Object(center);
  const pts = Array.isArray(points) ? points : [];
  if (!c || pts.length === 0) return NaN;
  const dists = [];
  for (const raw of pts) {
    const p = toPoint3Object(raw);
    if (!p) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    if (d > 1e-12) dists.push(d);
  }
  if (dists.length === 0) return NaN;
  dists.sort((a, b) => a - b);
  return dists[(dists.length / 2) | 0];
}

function resolveEntryPathPoints(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.edgePathPoints) && entry.edgePathPoints.length >= 2) {
    return entry.edgePathPoints.map(toPoint3Object).filter(Boolean);
  }
  const poly = Array.isArray(entry.edgePolyline) ? entry.edgePolyline : null;
  if (poly && poly.length >= 2) {
    return poly.map(toPoint3Object).filter(Boolean);
  }
  const edgeObj = entry.edgeObj;
  if (edgeObj && typeof edgeObj.points === 'function') {
    try {
      const pts = edgeObj.points(false);
      if (Array.isArray(pts) && pts.length >= 2) {
        return pts.map(toPoint3Object).filter(Boolean);
      }
    } catch { }
  }
  return [];
}

function resolveEntryEndpoints(entry) {
  const pathPoints = resolveEntryPathPoints(entry);
  if (pathPoints.length < 2) return null;
  return {
    pathPoints,
    start: pathPoints[0],
    end: pathPoints[pathPoints.length - 1],
  };
}

function tangentAwayFromEndpoint(pathPoints, endpointIndex, eps = 1e-10) {
  const points = Array.isArray(pathPoints) ? pathPoints : [];
  if (points.length < 2) return null;
  const tol2 = Math.max(1e-20, eps * eps);
  if ((endpointIndex | 0) === 0) {
    const anchor = toPoint3Object(points[0]);
    if (!anchor) return null;
    for (let i = 1; i < points.length; i++) {
      const p = toPoint3Object(points[i]);
      if (!p) continue;
      if (point3DistanceSq(anchor, p) <= tol2) continue;
      return normalizePoint3Vector(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
    }
    return null;
  }
  const anchor = toPoint3Object(points[points.length - 1]);
  if (!anchor) return null;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = toPoint3Object(points[i]);
    if (!p) continue;
    if (point3DistanceSq(anchor, p) <= tol2) continue;
    return normalizePoint3Vector(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
  }
  return null;
}

function resolveSharedEndpointInfo(entryA, entryB, endpointTol = 1e-5) {
  const a = resolveEntryEndpoints(entryA);
  const b = resolveEntryEndpoints(entryB);
  if (!a || !b) return null;
  const endA = [a.start, a.end];
  const endB = [b.start, b.end];
  const tol2 = Math.max(1e-20, endpointTol * endpointTol);
  let best = null;
  for (let ai = 0; ai < endA.length; ai++) {
    for (let bi = 0; bi < endB.length; bi++) {
      const pa = endA[ai];
      const pb = endB[bi];
      const d2 = point3DistanceSq(pa, pb);
      if (!(d2 <= tol2)) continue;
      if (!best || d2 < best.d2) {
        best = { aEndIndex: ai, bEndIndex: bi, d2, pa, pb };
      }
    }
  }
  if (!best) return null;
  const sharedPoint = {
    x: (best.pa.x + best.pb.x) * 0.5,
    y: (best.pa.y + best.pb.y) * 0.5,
    z: (best.pa.z + best.pb.z) * 0.5,
  };
  const tangentA = tangentAwayFromEndpoint(a.pathPoints, best.aEndIndex, endpointTol * 1e-4);
  const tangentB = tangentAwayFromEndpoint(b.pathPoints, best.bEndIndex, endpointTol * 1e-4);
  let tangentDot = NaN;
  if (Array.isArray(tangentA) && Array.isArray(tangentB)) {
    tangentDot = (tangentA[0] * tangentB[0]) + (tangentA[1] * tangentB[1]) + (tangentA[2] * tangentB[2]);
  }
  const absTangentDot = Number.isFinite(tangentDot) ? Math.min(1, Math.abs(tangentDot)) : NaN;
  return {
    sharedPoint,
    aEndIndex: best.aEndIndex,
    bEndIndex: best.bEndIndex,
    distance: Math.sqrt(best.d2),
    tangentA,
    tangentB,
    tangentDot,
    absTangentDot,
  };
}

function resolveEntryCenterlinePoints(entry) {
  if (!entry) return [];
  const centerline = Array.isArray(entry.centerlinePathPoints)
    ? entry.centerlinePathPoints
    : (Array.isArray(entry.centerline) ? entry.centerline : null);
  if (centerline && centerline.length >= 2) {
    return centerline.map(toPoint3Object).filter(Boolean);
  }
  return [];
}

function resolveCenterlineCornerSegments(entry, endpointIndex, maxSegments = 3, eps = 1e-10) {
  const pathPoints = resolveEntryCenterlinePoints(entry);
  if (pathPoints.length < 2) return { endpoint: null, segments: [] };

  const atStart = ((endpointIndex | 0) === 0);
  const ordered = [];
  const tol2 = Math.max(1e-20, Math.abs(Number(eps) || 0) ** 2);
  const limit = Math.max(1, Math.floor(Number(maxSegments) || 1)) + 1;
  if (atStart) {
    for (let i = 0; i < pathPoints.length && ordered.length < limit; i++) {
      const p = toPoint3Object(pathPoints[i]);
      if (!p) continue;
      if (ordered.length > 0 && point3DistanceSq(ordered[ordered.length - 1], p) <= tol2) continue;
      ordered.push(p);
    }
  } else {
    for (let i = pathPoints.length - 1; i >= 0 && ordered.length < limit; i--) {
      const p = toPoint3Object(pathPoints[i]);
      if (!p) continue;
      if (ordered.length > 0 && point3DistanceSq(ordered[ordered.length - 1], p) <= tol2) continue;
      ordered.push(p);
    }
  }

  const segments = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    segments.push({
      a: ordered[i],
      b: ordered[i + 1],
      index: i,
    });
  }

  return {
    endpoint: ordered[0] || null,
    segments,
  };
}

function closestPointsBetweenSegments3D(a0, a1, b0, b1) {
  const p0 = toPoint3Object(a0);
  const p1 = toPoint3Object(a1);
  const q0 = toPoint3Object(b0);
  const q1 = toPoint3Object(b1);
  if (!p0 || !p1 || !q0 || !q1) return null;

  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const vx = q1.x - q0.x;
  const vy = q1.y - q0.y;
  const vz = q1.z - q0.z;
  const wx = p0.x - q0.x;
  const wy = p0.y - q0.y;
  const wz = p0.z - q0.z;

  const a = (ux * ux) + (uy * uy) + (uz * uz);
  const b = (ux * vx) + (uy * vy) + (uz * vz);
  const c = (vx * vx) + (vy * vy) + (vz * vz);
  const d = (ux * wx) + (uy * wy) + (uz * wz);
  const e = (vx * wx) + (vy * wy) + (vz * wz);
  const D = (a * c) - (b * b);
  const EPS = 1e-14;

  let sN;
  let sD = D;
  let tN;
  let tD = D;

  if (a <= EPS && c <= EPS) {
    const distance = distPoint3(p0, q0);
    return {
      distance,
      s: 0,
      t: 0,
      pointA: p0,
      pointB: q0,
    };
  }

  if (a <= EPS) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else if (c <= EPS) {
    tN = 0;
    tD = 1;
    sN = -d;
    sD = a;
  } else {
    sN = (b * e) - (c * d);
    tN = (a * e) - (b * d);
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0) {
    tN = 0;
    if (-d < 0) {
      sN = 0;
    } else if (-d > a) {
      sN = sD;
    } else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if ((-d + b) < 0) {
      sN = 0;
    } else if ((-d + b) > a) {
      sN = sD;
    } else {
      sN = -d + b;
      sD = a;
    }
  }

  const s = Math.abs(sN) <= EPS ? 0 : (sN / (Math.abs(sD) <= EPS ? 1 : sD));
  const t = Math.abs(tN) <= EPS ? 0 : (tN / (Math.abs(tD) <= EPS ? 1 : tD));
  const sc = Math.max(0, Math.min(1, s));
  const tc = Math.max(0, Math.min(1, t));

  const pointA = {
    x: p0.x + (sc * ux),
    y: p0.y + (sc * uy),
    z: p0.z + (sc * uz),
  };
  const pointB = {
    x: q0.x + (tc * vx),
    y: q0.y + (tc * vy),
    z: q0.z + (tc * vz),
  };
  const distance = distPoint3(pointA, pointB);
  return {
    distance,
    s: sc,
    t: tc,
    pointA,
    pointB,
  };
}

function detectCenterlineCrossNearSharedCorner(entryA, entryB, sharedInfo, options = {}) {
  const shared = sharedInfo || {};
  const endpointTol = Math.max(1e-10, Math.abs(Number(options.endpointTol) || 0));
  const crossTolerance = Math.max(endpointTol, Math.abs(Number(options.crossTolerance) || 0));
  const interiorParamEps = Math.max(1e-4, Math.min(0.2, Math.abs(Number(options.interiorParamEps) || 0.02)));
  const maxSegments = Math.max(1, Math.floor(Number(options.maxSegments) || 3));

  const aCorner = resolveCenterlineCornerSegments(entryA, shared.aEndIndex, maxSegments, endpointTol * 1e-3);
  const bCorner = resolveCenterlineCornerSegments(entryB, shared.bEndIndex, maxSegments, endpointTol * 1e-3);
  const segsA = Array.isArray(aCorner?.segments) ? aCorner.segments : [];
  const segsB = Array.isArray(bCorner?.segments) ? bCorner.segments : [];
  if (segsA.length === 0 || segsB.length === 0) {
    return {
      crosses: false,
      reason: 'missing_centerline_segments',
      minDistance: Infinity,
    };
  }

  let best = null;
  for (const segA of segsA) {
    for (const segB of segsB) {
      const closest = closestPointsBetweenSegments3D(segA?.a, segA?.b, segB?.a, segB?.b);
      if (!closest || !Number.isFinite(closest.distance)) continue;
      if (!best || closest.distance < best.distance) {
        best = {
          ...closest,
          segAIndex: Number(segA?.index) || 0,
          segBIndex: Number(segB?.index) || 0,
        };
      }

      if (closest.distance > crossTolerance) continue;
      if (closest.s <= interiorParamEps || closest.s >= (1 - interiorParamEps)) continue;
      if (closest.t <= interiorParamEps || closest.t >= (1 - interiorParamEps)) continue;

      return {
        crosses: true,
        reason: 'interior_segment_cross',
        minDistance: closest.distance,
        segAIndex: Number(segA?.index) || 0,
        segBIndex: Number(segB?.index) || 0,
        pointA: closest.pointA,
        pointB: closest.pointB,
      };
    }
  }

  return {
    crosses: false,
    reason: 'no_cross',
    minDistance: best ? best.distance : Infinity,
    segAIndex: best ? best.segAIndex : null,
    segBIndex: best ? best.segBIndex : null,
    pointA: best ? best.pointA : null,
    pointB: best ? best.pointB : null,
  };
}

function resolveEntryEndCapData(entry, endpointIndex, pointTol = 1e-6) {
  const filletName = entry?.filletName;
  if (!filletName || typeof filletName !== 'string') return null;
  const atStart = ((endpointIndex | 0) === 0);
  const wedgeFaceName = `${filletName}_END_CAP_${atStart ? 1 : 2}`;
  const tubeFaceName = `${filletName}_TUBE_${atStart ? 'CapStart' : 'CapEnd'}`;
  const wedgePoints = collectFaceUniquePoints(entry?.wedgeSolid, wedgeFaceName, pointTol);
  const preNudgeRaw = atStart
    ? entry?.tubeCapPointsBeforeNudge?.start
    : entry?.tubeCapPointsBeforeNudge?.end;
  const tubePointsBeforeNudge = Array.isArray(preNudgeRaw)
    ? preNudgeRaw.map(toPoint3Object).filter(Boolean)
    : [];
  const tubePointsAfterNudge = collectFaceUniquePoints(entry?.tubeSolid, tubeFaceName, pointTol);
  const tubePoints = (tubePointsBeforeNudge.length >= 3)
    ? tubePointsBeforeNudge
    : tubePointsAfterNudge;
  return {
    wedgeFaceName,
    tubeFaceName,
    wedgePoints,
    tubePoints,
    tubePointsBeforeNudge,
    tubePointsAfterNudge,
    wedgeCenter: centroidOfPointSet(wedgePoints),
    tubeCenter: centroidOfPointSet(tubePoints),
  };
}

function createHullSolidFromPoints(points, SolidClass, faceName, pointRadius = 1e-5, sphereResolution = 8) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (!SolidClass || typeof SolidClass._fromManifold !== 'function') return null;
  const unique = [];
  const eps2 = Math.max(1e-16, (Math.abs(Number(pointRadius) || 1e-5) * 1e-2) ** 2);
  for (const raw of points) {
    const p = toPoint3Object(raw);
    if (!p) continue;
    pushUniquePoint3(unique, p, eps2);
  }
  if (unique.length < 2) return null;

  const sphereRadius = Math.max(1e-6, Math.abs(Number(pointRadius) || 0));
  const segs = Math.max(6, Math.floor(Number(sphereResolution) || 8));
  let baseSphere = null;
  let hull = null;
  const seeds = [];
  try {
    baseSphere = Manifold.sphere(sphereRadius, segs);
    for (const p of unique) {
      seeds.push(baseSphere.translate([p.x, p.y, p.z]));
    }
    if (seeds.length === 1) {
      hull = seeds[0];
    } else {
      hull = Manifold.hull(seeds);
    }
    if (!hull) return null;
    const solid = SolidClass._fromManifold(hull, new Map([[0, faceName || 'CORNER_WEDGE_BRIDGE']]));
    try { solid.name = faceName || 'CORNER_WEDGE_BRIDGE'; } catch { }
    return solid;
  } catch {
    if (hull) {
      try { if (typeof hull.delete === 'function') hull.delete(); } catch { }
    }
    return null;
  } finally {
    if (baseSphere) {
      try { if (typeof baseSphere.delete === 'function') baseSphere.delete(); } catch { }
    }
    for (const seed of seeds) {
      if (!seed || seed === hull) continue;
      try { if (typeof seed.delete === 'function') seed.delete(); } catch { }
    }
  }
}

function collectBridgeEndCapFaceNames(solid, preferredFacePrefix = null) {
  if (!solid) return [];
  const names = (typeof solid.getFaceNames === 'function') ? solid.getFaceNames() : [];
  const faceSet = new Set((Array.isArray(names) ? names : []).filter((name) => typeof name === 'string' && name.length > 0));
  if (faceSet.size === 0) return [];

  const candidates = [];
  const addCandidate = (name) => {
    if (!name || !faceSet.has(name)) return;
    if (!candidates.includes(name)) candidates.push(name);
  };

  const prefix = (typeof preferredFacePrefix === 'string' && preferredFacePrefix.length > 0)
    ? preferredFacePrefix
    : null;
  if (prefix) {
    addCandidate(`${prefix}_CapStart`);
    addCandidate(`${prefix}_CapEnd`);
    addCandidate(`${prefix}_END_CAP_1`);
    addCandidate(`${prefix}_END_CAP_2`);
  }

  for (const name of faceSet) {
    if (/_CapStart$/.test(name) || /_CapEnd$/.test(name) || /_END_CAP_[12]$/.test(name)) {
      addCandidate(name);
    }
  }
  return candidates;
}

function nudgeBridgeEndCapsOutward(solid, preferredFacePrefix = null, pushDistance = 0.001) {
  if (!solid || typeof solid.pushFace !== 'function') return 0;
  const candidates = collectBridgeEndCapFaceNames(solid, preferredFacePrefix);
  if (candidates.length === 0) return 0;
  const amount = Number.isFinite(Number(pushDistance)) ? Number(pushDistance) : 0.001;
  let pushed = 0;
  for (const faceName of candidates) {
    try {
      solid.pushFace(faceName, amount);
      pushed += 1;
    } catch { }
  }
  return pushed;
}

function stableStringHash32(value = '') {
  const text = String(value == null ? '' : value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sanitizeFaceNameToken(value, fallback = 'TOKEN') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\[\d+\]$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || fallback;
}

function resolveBridgeEntryEdgeName(entry, fallback = 'EDGE') {
  const edgeObjName = (typeof entry?.edgeObj?.name === 'string' && entry.edgeObj.name.trim().length > 0)
    ? entry.edgeObj.name.trim()
    : null;
  if (edgeObjName) return edgeObjName;
  const explicitEdgeName = (typeof entry?.edgeName === 'string' && entry.edgeName.trim().length > 0)
    ? entry.edgeName.trim()
    : null;
  if (explicitEdgeName) return explicitEdgeName;
  const filletName = (typeof entry?.filletName === 'string' && entry.filletName.trim().length > 0)
    ? entry.filletName.trim()
    : '';
  return filletName || fallback;
}

function buildDeterministicBridgeName(featureID, edgeNameA, edgeNameB, label = 'BRIDGE') {
  const rawA = String(edgeNameA == null ? 'EDGE_A' : edgeNameA);
  const rawB = String(edgeNameB == null ? 'EDGE_B' : edgeNameB);
  const orderedRaw = [rawA, rawB].sort((a, b) => a.localeCompare(b));
  const featureRaw = String(featureID == null ? 'FILLET' : featureID).trim();
  const featureToken = featureRaw || 'FILLET';
  const tokenA = sanitizeFaceNameToken(orderedRaw[0], 'EDGE_A');
  const tokenB = sanitizeFaceNameToken(orderedRaw[1], 'EDGE_B');
  const pairHash = stableStringHash32(`${orderedRaw[0]}|${orderedRaw[1]}`)
    .toString(16)
    .padStart(8, '0');
  const labelToken = sanitizeFaceNameToken(label, 'BRIDGE');
  return `${featureToken}_${labelToken}_${tokenA}__${tokenB}_${pairHash}`;
}

function collapseSolidToSingleFaceName(solid, faceName = 'FILLET_CORNER_BRIDGE') {
  if (!solid) return null;
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  if (!triVerts || triVerts.length < 9) return null;
  const triCount = (triVerts.length / 3) | 0;
  const unifiedName = (typeof faceName === 'string' && faceName.length > 0)
    ? faceName
    : 'FILLET_CORNER_BRIDGE';
  const unifiedID = 0;

  const mergedMeta = {};
  if (solid._faceMetadata instanceof Map && solid._faceMetadata.size > 0) {
    for (const meta of solid._faceMetadata.values()) {
      if (!meta || typeof meta !== 'object') continue;
      Object.assign(mergedMeta, meta);
    }
  }

  try {
    if (solid._manifold && typeof solid._manifold.delete === 'function') {
      solid._manifold.delete();
    }
  } catch { }
  solid._manifold = null;
  solid._triIDs = new Array(triCount).fill(unifiedID);
  solid._idToFaceName = new Map([[unifiedID, unifiedName]]);
  solid._faceNameToID = new Map([[unifiedName, unifiedID]]);
  solid._faceMetadata = new Map([[unifiedName, mergedMeta]]);
  solid._faceIndex = null;
  solid._dirty = true;
  return solid;
}

function collapseTangentCornerTransitionFaces({
  filletEntries = [],
  featureID = 'FILLET',
  endpointTolerance = 1e-5,
  tangentDotThreshold = 0.995,
  debug = false,
} = {}) {
  const entries = Array.isArray(filletEntries) ? filletEntries : [];
  if (entries.length < 2) {
    return {
      tangentPairs: 0,
      participantEntries: 0,
      collapsedEntries: 0,
    };
  }

  const endpointTol = Number.isFinite(Number(endpointTolerance))
    ? Math.max(1e-8, Number(endpointTolerance))
    : 1e-5;
  const dotThreshold = Number.isFinite(Number(tangentDotThreshold))
    ? Math.max(-1, Math.min(1, Number(tangentDotThreshold)))
    : 0.995;

  const participantIndexes = new Set();
  const faceNameByEntryIndex = new Map();
  const setEntryFaceName = (entryIndex, candidateName) => {
    if (!Number.isInteger(entryIndex) || typeof candidateName !== 'string' || !candidateName.length) return;
    const prev = faceNameByEntryIndex.get(entryIndex);
    if (!prev || candidateName.localeCompare(prev) < 0) {
      faceNameByEntryIndex.set(entryIndex, candidateName);
    }
  };
  let tangentPairs = 0;

  for (let i = 0; i < entries.length; i++) {
    const entryA = entries[i];
    if (!entryA || entryA.cornerBridge === true || !entryA.filletSolid) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const entryB = entries[j];
      if (!entryB || entryB.cornerBridge === true || !entryB.filletSolid) continue;

      const dirA = String(entryA?.edgeDirection || 'INSET').toUpperCase();
      const dirB = String(entryB?.edgeDirection || 'INSET').toUpperCase();
      if (dirA !== dirB) continue;

      const shared = resolveSharedEndpointInfo(entryA, entryB, endpointTol);
      if (!shared) continue;
      if (!Number.isFinite(shared.absTangentDot) || shared.absTangentDot < dotThreshold) continue;

      const edgeNameA = resolveBridgeEntryEdgeName(entryA, `${featureID}_EDGE_${i}`);
      const edgeNameB = resolveBridgeEntryEdgeName(entryB, `${featureID}_EDGE_${j}`);
      const bridgePairName = buildDeterministicBridgeName(
        featureID,
        edgeNameA,
        edgeNameB,
        'TANGENT_CORNER_BRIDGE',
      );
      const edgeTokenA = sanitizeFaceNameToken(edgeNameA, `EDGE_${i}`);
      const edgeTokenB = sanitizeFaceNameToken(edgeNameB, `EDGE_${j}`);
      const edgeHashA = stableStringHash32(edgeNameA).toString(16).slice(-6).padStart(6, '0');
      const edgeHashB = stableStringHash32(edgeNameB).toString(16).slice(-6).padStart(6, '0');
      setEntryFaceName(i, `${bridgePairName}_ON_${edgeTokenA}_${edgeHashA}`);
      setEntryFaceName(j, `${bridgePairName}_ON_${edgeTokenB}_${edgeHashB}`);

      tangentPairs += 1;
      participantIndexes.add(i);
      participantIndexes.add(j);
    }
  }

  let collapsedEntries = 0;
  const orderedParticipants = Array.from(participantIndexes).sort((a, b) => a - b);
  for (const idx of orderedParticipants) {
    const entry = entries[idx];
    const solid = entry?.filletSolid;
    if (!solid || !Array.isArray(solid?._triVerts) || solid._triVerts.length < 9) continue;

    const singleFaceName = faceNameByEntryIndex.get(idx)
      || `${String(featureID == null ? 'FILLET' : featureID)}_TANGENT_CORNER_BRIDGE_ENTRY_${idx}`;
    const collapsedSolid = collapseSolidToSingleFaceName(solid, singleFaceName);
    if (!collapsedSolid) continue;

    entry.filletSolid = collapsedSolid;
    entry.mergeCandidates = [singleFaceName];
    entry.roundFaceName = singleFaceName;
    if (!entry.directionDetail || typeof entry.directionDetail !== 'object') {
      entry.directionDetail = {};
    }
    entry.directionDetail.tangentCornerTransitionFaceCollapsed = true;
    entry.directionDetail.tangentCornerTransitionFaceName = singleFaceName;
    collapsedEntries += 1;
  }

  if (debug && collapsedEntries > 0) {
    console.log('[Solid.fillet] Collapsed tangent corner transition faces before fillet combine.', {
      featureID,
      tangentPairs,
      participantEntries: participantIndexes.size,
      collapsedEntries,
      endpointTolerance: endpointTol,
      tangentDotThreshold: dotThreshold,
    });
  }

  return {
    tangentPairs,
    participantEntries: participantIndexes.size,
    collapsedEntries,
  };
}

function buildNonTangentCornerTransitionEntries({
  filletEntries = [],
  featureID = 'FILLET',
  radius = 1,
  resolution = 32,
  SolidClass = null,
  TubeClass = null,
  debug = false,
} = {}) {
  const entries = Array.isArray(filletEntries) ? filletEntries : [];
  if (!entries.length || !SolidClass || typeof SolidClass._fromManifold !== 'function') return [];

  const radiusAbs = Math.abs(Number(radius) || 0);
  const endpointTol = Math.max(1e-6, radiusAbs * 1e-4);
  const capPointTol = Math.max(1e-7, endpointTol * 0.5);
  const tangentDotThreshold = 0.995;
  const { q, k } = createQuantizer(Math.max(endpointTol, 1e-6));
  const generated = [];
  const emittedKeys = new Set();

  for (let i = 0; i < entries.length; i++) {
    const entryA = entries[i];
    if (!entryA || !entryA.filletSolid || !entryA.wedgeSolid || !entryA.tubeSolid) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const entryB = entries[j];
      if (!entryB || !entryB.filletSolid || !entryB.wedgeSolid || !entryB.tubeSolid) continue;

      const dirA = String(entryA?.edgeDirection || 'INSET').toUpperCase();
      const dirB = String(entryB?.edgeDirection || 'INSET').toUpperCase();
      if (dirA !== dirB) continue;

      const shared = resolveSharedEndpointInfo(entryA, entryB, endpointTol);
      if (!shared) continue;
      if (Number.isFinite(shared.absTangentDot) && shared.absTangentDot >= tangentDotThreshold) continue;

      const sourceEdgeNameA = resolveBridgeEntryEdgeName(entryA, `${featureID}_EDGE_${i}`);
      const sourceEdgeNameB = resolveBridgeEntryEdgeName(entryB, `${featureID}_EDGE_${j}`);
      const cornerKey = `${[sourceEdgeNameA, sourceEdgeNameB].sort().join('|')}:${k(q([shared.sharedPoint.x, shared.sharedPoint.y, shared.sharedPoint.z]))}`;
      if (emittedKeys.has(cornerKey)) continue;
      emittedKeys.add(cornerKey);

      const capA = resolveEntryEndCapData(entryA, shared.aEndIndex, capPointTol);
      const capB = resolveEntryEndCapData(entryB, shared.bEndIndex, capPointTol);
      if (!capA || !capB) continue;
      if (capA.wedgePoints.length < 3 || capB.wedgePoints.length < 3) continue;

      const centerlineCornerA = resolveCenterlineCornerSegments(entryA, shared.aEndIndex, 4, capPointTol);
      const centerlineCornerB = resolveCenterlineCornerSegments(entryB, shared.bEndIndex, 4, capPointTol);
      const centerlineEndA = toPoint3Object(centerlineCornerA?.endpoint) || null;
      const centerlineEndB = toPoint3Object(centerlineCornerB?.endpoint) || null;
      const rawTubePointA = toPoint3Object(capA.tubeCenter) || toPoint3Object(capA.wedgeCenter) || null;
      const rawTubePointB = toPoint3Object(capB.tubeCenter) || toPoint3Object(capB.wedgeCenter) || null;
      const tubePointA = rawTubePointA || centerlineEndA || null;
      const tubePointB = rawTubePointB || centerlineEndB || null;
      const tubeDistance = (tubePointA && tubePointB) ? distPoint3(tubePointA, tubePointB) : NaN;

      const capRadiusA = estimatePointSetRadius(capA.tubePoints, rawTubePointA || tubePointA);
      const capRadiusB = estimatePointSetRadius(capB.tubePoints, rawTubePointB || tubePointB);
      let bridgeTubeRadius = radiusAbs;
      if (Number.isFinite(capRadiusA) && Number.isFinite(capRadiusB)) bridgeTubeRadius = Math.min(capRadiusA, capRadiusB);
      else if (Number.isFinite(capRadiusA)) bridgeTubeRadius = capRadiusA;
      else if (Number.isFinite(capRadiusB)) bridgeTubeRadius = capRadiusB;
      bridgeTubeRadius = Math.max(1e-6, bridgeTubeRadius);

      const minBridgeGap = Math.max(endpointTol * 2, capPointTol * 4, 1e-6);
      if (!Number.isFinite(tubeDistance) || !(tubeDistance > minBridgeGap)) {
        if (debug) {
          console.log('[Solid.fillet] Skipping non-tangent corner bridge: no measurable centerline gap.', {
            featureID,
            sourceFillets: [entryA?.filletName || null, entryB?.filletName || null],
            tubeDistance: Number.isFinite(tubeDistance) ? tubeDistance : null,
            minBridgeGap,
          });
        }
        continue;
      }

      const centerlineCross = detectCenterlineCrossNearSharedCorner(entryA, entryB, shared, {
        endpointTol,
        crossTolerance: Math.max(minBridgeGap, bridgeTubeRadius * 1e-3, 5e-6),
        maxSegments: 4,
        interiorParamEps: 0.02,
      });
      if (centerlineCross?.crosses) {
        if (debug) {
          console.log('[Solid.fillet] Skipping non-tangent corner bridge: adjacent centerlines cross.', {
            featureID,
            sourceFillets: [entryA?.filletName || null, entryB?.filletName || null],
            crossInfo: centerlineCross,
            tubeDistance,
          });
        }
        continue;
      }

      const hullPoints = [];
      const hullDedupEps2 = Math.max(1e-16, capPointTol * capPointTol);
      for (const p of capA.wedgePoints) pushUniquePoint3(hullPoints, p, hullDedupEps2);
      for (const p of capB.wedgePoints) pushUniquePoint3(hullPoints, p, hullDedupEps2);
      if (hullPoints.length < 4) continue;

      const cornerName = `${buildDeterministicBridgeName(featureID, sourceEdgeNameA, sourceEdgeNameB, 'CORNER')}_${stableStringHash32(cornerKey).toString(16).padStart(8, '0')}`;
      const wedgeBridgeName = `${cornerName}_WEDGE_BRIDGE`;
      const tubeBridgeName = `${cornerName}_TUBE_BRIDGE`;

      const hullPointRadius = Math.max(1e-6, radiusAbs * 1e-4, capPointTol * 0.2);
      const wedgeBridgeSolid = createHullSolidFromPoints(
        hullPoints,
        SolidClass,
        wedgeBridgeName,
        hullPointRadius,
        Math.max(6, Math.min(16, Math.floor(Number(resolution) / 4) || 8)),
      );
      if (!wedgeBridgeSolid) continue;
      if (!Array.isArray(wedgeBridgeSolid?._triVerts) || wedgeBridgeSolid._triVerts.length < 9) continue;
      let wedgeBridgeTrimmed = wedgeBridgeSolid;
      try { wedgeBridgeTrimmed.name = wedgeBridgeName; } catch { }
      const adjacentTubeCutters = [entryA?.tubeSolid, entryB?.tubeSolid]
        .filter((solid) => solid && Array.isArray(solid?._triVerts) && solid._triVerts.length >= 9);
      let adjacentTubeSubtractionsApplied = 0;
      if (adjacentTubeCutters.length > 0) {
        for (let cutterIndex = 0; cutterIndex < adjacentTubeCutters.length; cutterIndex++) {
          const cutter = adjacentTubeCutters[cutterIndex];
          try {
            const trimmed = wedgeBridgeTrimmed.subtract(cutter);
            if (!trimmed || !Array.isArray(trimmed?._triVerts) || trimmed._triVerts.length < 9) {
              wedgeBridgeTrimmed = null;
              break;
            }
            wedgeBridgeTrimmed = trimmed;
            adjacentTubeSubtractionsApplied += 1;
          } catch {
            wedgeBridgeTrimmed = null;
            break;
          }
        }
        if (!wedgeBridgeTrimmed) continue;
        try { wedgeBridgeTrimmed.name = wedgeBridgeName; } catch { }
      }

      const tubeHullPoints = [];
      const tubeHullDedupEps2 = Math.max(1e-16, capPointTol * capPointTol);
      for (const p of capA.tubePoints) pushUniquePoint3(tubeHullPoints, p, tubeHullDedupEps2);
      for (const p of capB.tubePoints) pushUniquePoint3(tubeHullPoints, p, tubeHullDedupEps2);
      const bridgeEndCapPushDistance = 0.01;

      let tubeBridgeSolid = null;
      let tubeBridgeMode = 'none';
      if (tubeHullPoints.length >= 4) {
        tubeBridgeSolid = createHullSolidFromPoints(
          tubeHullPoints,
          SolidClass,
          tubeBridgeName,
          Math.max(1e-6, bridgeTubeRadius * 1e-3, capPointTol * 0.25),
          Math.max(6, Math.min(16, Math.floor(Number(resolution) / 4) || 8)),
        );
        if (tubeBridgeSolid) tubeBridgeMode = 'tube_cap_hull';
      }
      if (
        !tubeBridgeSolid
        &&
        TubeClass
        &&
        tubePointA && tubePointB
        && Number.isFinite(tubeDistance)
        && tubeDistance > minBridgeGap
      ) {
        try {
          tubeBridgeSolid = new TubeClass({
            points: [
              [tubePointA.x, tubePointA.y, tubePointA.z],
              [tubePointB.x, tubePointB.y, tubePointB.z],
            ],
            radius: bridgeTubeRadius,
            innerRadius: 0,
            resolution: Math.max(8, Math.floor(Number(resolution) || 32)),
            selfUnion: true,
            name: tubeBridgeName,
          });
          if (!Array.isArray(tubeBridgeSolid?._triVerts) || tubeBridgeSolid._triVerts.length < 9) {
            tubeBridgeSolid = null;
          } else {
            tubeBridgeMode = 'tube_centerline_fallback';
          }
        } catch {
          tubeBridgeSolid = null;
        }
      }
      if (!tubeBridgeSolid || !Array.isArray(tubeBridgeSolid?._triVerts) || tubeBridgeSolid._triVerts.length < 9) continue;
      let tubeBridgeTrimmed = tubeBridgeSolid;
      try { tubeBridgeTrimmed.name = tubeBridgeName; } catch { }
      let bridgeEndCapsPushed = nudgeBridgeEndCapsOutward(tubeBridgeTrimmed, tubeBridgeName, bridgeEndCapPushDistance);
      if (bridgeEndCapsPushed <= 0) {
        // Fallback: push directly on the source bridge tube when cap labels are missing.
        const pushedSourceCaps = nudgeBridgeEndCapsOutward(tubeBridgeSolid, tubeBridgeName, bridgeEndCapPushDistance);
        if (pushedSourceCaps > 0) {
          bridgeEndCapsPushed = pushedSourceCaps;
        }
      }
      const singleFaceBridgeName = `${tubeBridgeName}_SINGLE_FACE`;
      const tubeBridgeSingleFace = collapseSolidToSingleFaceName(tubeBridgeTrimmed, singleFaceBridgeName);
      if (!tubeBridgeSingleFace) continue;

      let finalSolid = wedgeBridgeTrimmed;
      try {
        finalSolid = wedgeBridgeTrimmed.subtract(tubeBridgeSingleFace);
        try { finalSolid.name = `${cornerName}_FINAL_FILLET`; } catch { }
      } catch {
        continue;
      }
      if (!finalSolid || !Array.isArray(finalSolid?._triVerts) || finalSolid._triVerts.length < 9) continue;

      generated.push({
        filletSolid: finalSolid,
        filletName: cornerName,
        mergeCandidates: getFilletMergeCandidateNames(finalSolid),
        roundFaceName: guessRoundFaceName(finalSolid, cornerName),
        wedgeSolid: wedgeBridgeTrimmed,
        tubeSolid: tubeBridgeSingleFace,
        edgeDirection: dirA,
        directionReason: 'corner_bridge_non_tangent',
        directionDetail: {
          sourceFillets: [entryA?.filletName || null, entryB?.filletName || null],
          sourceEdges: [sourceEdgeNameA, sourceEdgeNameB],
          sharedPoint: shared.sharedPoint,
          tangentDot: Number.isFinite(shared.tangentDot) ? shared.tangentDot : null,
          endpointDistance: shared.distance,
          tubeCenterlineGap: Number.isFinite(tubeDistance) ? tubeDistance : null,
          minBridgeGap,
          centerlineCrossCheck: centerlineCross || null,
          tubeBridgeMode,
          bridgeEndCapPushDistance,
          adjacentEdgeTubeCutters: adjacentTubeCutters.length,
          adjacentEdgeTubeSubtractionsApplied: adjacentTubeSubtractionsApplied,
          trimmedByAdjacentWedges: 0,
          finalBridgeRetrimmedByAdjacentWedges: 0,
          bridgeEndCapsPushed,
          bridgeSingleFaceName: singleFaceBridgeName,
        },
        edgeObj: null,
        edgePolyline: null,
        edgePathPoints: [],
        cornerBridge: true,
      });
    }
  }

  if (debug && generated.length > 0) {
    console.log('[Solid.fillet] Built non-tangent corner bridge entries.', {
      featureID,
      generatedCorners: generated.length,
      endpointTolerance: endpointTol,
      tangentDotThreshold,
    });
  }
  return generated;
}

function findBoundaryPolylineForEdge(baseSolid, edgeObj, faceAName, faceBName, boundaryPolylines = null) {
  if (!baseSolid || typeof baseSolid.getBoundaryEdgePolylines !== 'function') return null;
  const boundaries = Array.isArray(boundaryPolylines)
    ? boundaryPolylines
    : (baseSolid.getBoundaryEdgePolylines() || []);
  const edgeName = edgeObj?.name;
  if (edgeName) {
    const named = boundaries.find((b) => b?.name === edgeName);
    if (named) return named;
  }
  if (!faceAName || !faceBName) return null;
  return boundaries.find((b) => {
    const a = b?.faceA;
    const c = b?.faceB;
    return (a === faceAName && c === faceBName) || (a === faceBName && c === faceAName);
  }) || null;
}

function findDirectedEdgeOrientationInFace(baseSolid, faceName, ia, ib) {
  if (!baseSolid || !faceName || !Number.isInteger(ia) || !Number.isInteger(ib)) return 0;
  const faceID = baseSolid?._faceNameToID instanceof Map ? baseSolid._faceNameToID.get(faceName) : undefined;
  if (faceID === undefined) return 0;
  const triVerts = Array.isArray(baseSolid?._triVerts) ? baseSolid._triVerts : null;
  const triIDs = Array.isArray(baseSolid?._triIDs) ? baseSolid._triIDs : null;
  if (!triVerts || !triIDs || triVerts.length !== triIDs.length * 3) return 0;
  for (let t = 0; t < triIDs.length; t++) {
    if ((triIDs[t] >>> 0) !== (faceID >>> 0)) continue;
    const base = t * 3;
    const a = triVerts[base + 0];
    const b = triVerts[base + 1];
    const c = triVerts[base + 2];
    if ((a === ia && b === ib) || (b === ia && c === ib) || (c === ia && a === ib)) return 1;
    if ((a === ib && b === ia) || (b === ib && c === ia) || (c === ib && a === ia)) return -1;
  }
  return 0;
}

function resolveOrientedEdgeTangent(baseSolid, faceAName, boundaryPolyline) {
  const ids = Array.isArray(boundaryPolyline?.indices) ? boundaryPolyline.indices : null;
  const vp = Array.isArray(baseSolid?._vertProperties) ? baseSolid._vertProperties : null;
  if (!ids || ids.length < 2 || !vp) return null;

  const segmentOrder = [];
  const center = (ids.length - 1) / 2;
  for (let i = 0; i < ids.length - 1; i++) segmentOrder.push(i);
  segmentOrder.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));

  for (const segIdx of segmentOrder) {
    const ia = Number(ids[segIdx]);
    const ib = Number(ids[segIdx + 1]);
    if (!Number.isInteger(ia) || !Number.isInteger(ib) || ia === ib) continue;
    const orient = findDirectedEdgeOrientationInFace(baseSolid, faceAName, ia, ib);
    if (!orient) continue;

    const iaBase = ia * 3;
    const ibBase = ib * 3;
    if (iaBase + 2 >= vp.length || ibBase + 2 >= vp.length) continue;

    let tx = vp[ibBase + 0] - vp[iaBase + 0];
    let ty = vp[ibBase + 1] - vp[iaBase + 1];
    let tz = vp[ibBase + 2] - vp[iaBase + 2];
    if (orient < 0) {
      tx = -tx;
      ty = -ty;
      tz = -tz;
    }
    const len = Math.hypot(tx, ty, tz);
    if (!(len > 1e-12)) continue;
    tx /= len; ty /= len; tz /= len;
    return {
      tangent: [tx, ty, tz],
      midpoint: [
        (vp[iaBase + 0] + vp[ibBase + 0]) * 0.5,
        (vp[iaBase + 1] + vp[ibBase + 1]) * 0.5,
        (vp[iaBase + 2] + vp[ibBase + 2]) * 0.5,
      ],
      segmentIndex: segIdx,
    };
  }
  return null;
}

function classifyEdgeFilletDirectionBySignedDihedral(
  baseSolid,
  edgeObj,
  fallbackDirection = 'INSET',
  threshold = 0.2,
  boundaryPolylines = null,
  getFaceTris = null,
) {
  const fallback = (String(fallbackDirection || 'INSET').toUpperCase() === 'OUTSET') ? 'OUTSET' : 'INSET';
  if (!baseSolid || !edgeObj) return { direction: fallback, reason: 'missing_context' };

  const { faceAName, faceBName } = getEdgeFaceNames(edgeObj);
  if (!faceAName || !faceBName) return { direction: fallback, reason: 'missing_faces' };

  const boundary = findBoundaryPolylineForEdge(baseSolid, edgeObj, faceAName, faceBName, boundaryPolylines);
  if (!boundary) return { direction: fallback, reason: 'missing_boundary_polyline' };

  const tangentInfo = resolveOrientedEdgeTangent(baseSolid, faceAName, boundary);
  if (!tangentInfo) return { direction: fallback, reason: 'missing_oriented_tangent' };

  const trisA = (typeof getFaceTris === 'function')
    ? getFaceTris(faceAName)
    : ((typeof baseSolid.getFace === 'function') ? baseSolid.getFace(faceAName) : null);
  const trisB = (typeof getFaceTris === 'function')
    ? getFaceTris(faceBName)
    : ((typeof baseSolid.getFace === 'function') ? baseSolid.getFace(faceBName) : null);
  if (!Array.isArray(trisA) || !trisA.length || !Array.isArray(trisB) || !trisB.length) {
    return { direction: fallback, reason: 'missing_face_geometry' };
  }

  const solidId = baseSolid?.uuid || baseSolid?.name || 'SOLID';
  const faceKeyA = `${solidId}:${faceAName}:AUTO_SIGNED`;
  const faceKeyB = `${solidId}:${faceBName}:AUTO_SIGNED`;
  const faceDataA = getCachedFaceDataForTris(trisA, faceKeyA);
  const faceDataB = getCachedFaceDataForTris(trisB, faceKeyB);
  const fallbackNormalA = averageFaceNormalObjectSpace(baseSolid, faceAName);
  const fallbackNormalB = averageFaceNormalObjectSpace(baseSolid, faceBName);
  const samplePoint = { x: tangentInfo.midpoint[0], y: tangentInfo.midpoint[1], z: tangentInfo.midpoint[2] };
  const nA = localFaceNormalAtPoint(baseSolid, faceAName, samplePoint, faceDataA, faceKeyA) || fallbackNormalA;
  const nB = localFaceNormalAtPoint(baseSolid, faceBName, samplePoint, faceDataB, faceKeyB) || fallbackNormalB;
  if (!nA || !nB) return { direction: fallback, reason: 'missing_normals' };

  const cx = (Number(nA.y) * Number(nB.z)) - (Number(nA.z) * Number(nB.y));
  const cy = (Number(nA.z) * Number(nB.x)) - (Number(nA.x) * Number(nB.z));
  const cz = (Number(nA.x) * Number(nB.y)) - (Number(nA.y) * Number(nB.x));
  const tx = tangentInfo.tangent[0];
  const ty = tangentInfo.tangent[1];
  const tz = tangentInfo.tangent[2];
  const signedDihedral = (cx * tx) + (cy * ty) + (cz * tz);
  if (!Number.isFinite(signedDihedral)) return { direction: fallback, reason: 'invalid_signed_dihedral' };

  if (signedDihedral > threshold) {
    return { direction: 'INSET', reason: 'signed_dihedral', signedDihedral };
  }
  if (signedDihedral < -threshold) {
    return { direction: 'OUTSET', reason: 'signed_dihedral', signedDihedral };
  }
  return { direction: fallback, reason: 'signed_dihedral_ambiguous', signedDihedral };
}

function classifyEdgeFilletDirectionByInsideOutside(
  baseSolid,
  edgeObj,
  insideTester,
  radius = 1,
  fallbackDirection = 'INSET',
  boundaryPolylines = null,
  getFaceTris = null,
) {
  const fallback = (String(fallbackDirection || 'INSET').toUpperCase() === 'OUTSET') ? 'OUTSET' : 'INSET';
  if (!baseSolid || !edgeObj) {
    return { direction: fallback, reason: 'missing_context' };
  }

  const signed = classifyEdgeFilletDirectionBySignedDihedral(
    baseSolid,
    edgeObj,
    fallbackDirection,
    0.2,
    boundaryPolylines,
    getFaceTris,
  );
  if (signed?.reason === 'signed_dihedral') return signed;
  if (typeof insideTester !== 'function') {
    return { direction: fallback, reason: 'missing_inside_tester', signedDihedral: signed?.signedDihedral };
  }

  const { faceAName, faceBName } = getEdgeFaceNames(edgeObj);
  if (!faceAName || !faceBName) {
    return { direction: fallback, reason: 'missing_faces' };
  }

  const polylineLocal = getEdgePolylineLocal(edgeObj);
  if (!polylineLocal) {
    return { direction: fallback, reason: 'missing_polyline' };
  }

  const trisA = (typeof getFaceTris === 'function')
    ? getFaceTris(faceAName)
    : ((typeof baseSolid.getFace === 'function') ? baseSolid.getFace(faceAName) : null);
  const trisB = (typeof getFaceTris === 'function')
    ? getFaceTris(faceBName)
    : ((typeof baseSolid.getFace === 'function') ? baseSolid.getFace(faceBName) : null);
  if (!Array.isArray(trisA) || trisA.length === 0 || !Array.isArray(trisB) || trisB.length === 0) {
    return { direction: fallback, reason: 'missing_face_geometry' };
  }

  const solidId = baseSolid?.uuid || baseSolid?.name || 'SOLID';
  const faceKeyA = `${solidId}:${faceAName}:AUTO_DIR`;
  const faceKeyB = `${solidId}:${faceBName}:AUTO_DIR`;
  const faceDataA = getCachedFaceDataForTris(trisA, faceKeyA);
  const faceDataB = getCachedFaceDataForTris(trisB, faceKeyB);
  const fallbackNormalA = averageFaceNormalObjectSpace(baseSolid, faceAName);
  const fallbackNormalB = averageFaceNormalObjectSpace(baseSolid, faceBName);

  const probeDistance = Math.max(
    deriveSolidToleranceFromVerts(baseSolid, 1e-6) * 8,
    Math.abs(Number(radius) || 0) * 1e-4,
    1e-6,
  );

  const sampleTs = [0.2, 0.5, 0.8];
  let insetVotes = 0;
  let outsetVotes = 0;
  let ambiguousSamples = 0;
  let usedSamples = 0;

  for (const t of sampleTs) {
    const pointArray = samplePolylineAt(polylineLocal, t);
    if (!pointArray) continue;
    const point = { x: pointArray[0], y: pointArray[1], z: pointArray[2] };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;

    const nA = localFaceNormalAtPoint(baseSolid, faceAName, point, faceDataA, faceKeyA) || fallbackNormalA;
    const nB = localFaceNormalAtPoint(baseSolid, faceBName, point, faceDataB, faceKeyB) || fallbackNormalB;
    if (!nA || !nB) {
      ambiguousSamples++;
      continue;
    }

    let sx = Number(nA.x) + Number(nB.x);
    let sy = Number(nA.y) + Number(nB.y);
    let sz = Number(nA.z) + Number(nB.z);
    const len = Math.hypot(sx, sy, sz);
    if (!(len > 1e-12)) {
      ambiguousSamples++;
      continue;
    }
    sx /= len; sy /= len; sz /= len;

    const plus = { x: point.x + sx * probeDistance, y: point.y + sy * probeDistance, z: point.z + sz * probeDistance };
    const minus = { x: point.x - sx * probeDistance, y: point.y - sy * probeDistance, z: point.z - sz * probeDistance };
    const plusInside = !!insideTester(plus);
    const minusInside = !!insideTester(minus);
    usedSamples++;

    if (minusInside && !plusInside) insetVotes++;
    else if (plusInside && !minusInside) outsetVotes++;
    else ambiguousSamples++;
  }

  if (insetVotes > outsetVotes) {
    return { direction: 'INSET', reason: 'classified', insetVotes, outsetVotes, ambiguousSamples, usedSamples };
  }
  if (outsetVotes > insetVotes) {
    return { direction: 'OUTSET', reason: 'classified', insetVotes, outsetVotes, ambiguousSamples, usedSamples };
  }
  return { direction: fallback, reason: 'ambiguous', insetVotes, outsetVotes, ambiguousSamples, usedSamples };
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

function buildAdjacencyFromFaceEdges(solid, faceNames, tol, getFaceTris = null) {
  const { q, k } = createQuantizer(tol);
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToFaces = new Map();
  const faceToEdges = new Map();
  for (const faceName of faceNames) {
    const tris = (typeof getFaceTris === 'function')
      ? getFaceTris(faceName)
      : solid.getFace(faceName);
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

function computeFacePlaneInfo(solid, faceName, getFaceTris = null) {
  if (!solid || typeof solid.getFace !== 'function' || !faceName) return null;
  const tris = (typeof getFaceTris === 'function')
    ? getFaceTris(faceName)
    : solid.getFace(faceName);
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

function areFacesCoplanar(solid, faceA, faceB, planeCache, dotThreshold, planeTol, getFaceTris = null) {
  if (!solid || !faceA || !faceB || faceA === faceB) return false;
  const getPlane = (name) => {
    if (planeCache.has(name)) return planeCache.get(name);
    const info = computeFacePlaneInfo(solid, name, getFaceTris);
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

function createFaceHasTrianglesPredicate(resultSolid, getFaceTris = null) {
  return (name) => {
    if (!name || typeof resultSolid?.getFace !== 'function') return false;
    const tris = (typeof getFaceTris === 'function')
      ? getFaceTris(name)
      : resultSolid.getFace(name);
    return Array.isArray(tris) && tris.length > 0;
  };
}

function mergeFilletEndCapsByAdjacencyStrategy(resultSolid, endCapFaces, pickNeighbor, getFaceTris = null) {
  if (!resultSolid || typeof resultSolid.getFaceNames !== 'function') return 0;
  const faceHasTris = createFaceHasTrianglesPredicate(resultSolid, getFaceTris);
  const caps = (Array.isArray(endCapFaces) ? endCapFaces : []).filter(faceHasTris);
  if (caps.length === 0 || typeof pickNeighbor !== 'function') return 0;

  const activeFaceNames = (resultSolid.getFaceNames() || []).filter(faceHasTris);
  const boundaryAdj = buildAdjacencyFromBoundaryPolylines(resultSolid);
  let edgeAdj = null;
  let edgeAdjReady = false;
  let merged = 0;

  for (const capName of caps) {
    let targetFace = pickNeighbor(capName, boundaryAdj.get(capName), 'boundary');
    if (!targetFace) {
      if (!edgeAdjReady) {
        const tol = deriveSolidToleranceFromVerts(resultSolid, 1e-5);
        edgeAdj = buildAdjacencyFromFaceEdges(resultSolid, activeFaceNames, tol, getFaceTris);
        edgeAdjReady = true;
      }
      targetFace = pickNeighbor(capName, edgeAdj?.get(capName), 'edge');
    }
    if (targetFace && mergeFaceIntoTarget(resultSolid, capName, targetFace)) {
      merged += 1;
    }
  }
  return merged;
}

function collectOutsetEndCapCandidates(resultSolid, filletEntries, featureID) {
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
      const meta = (typeof resultSolid?.getFaceMetadata === 'function') ? resultSolid.getFaceMetadata(name) : {};
      if (meta?.filletEndCap) endCapCandidates.add(name);
    }
  }

  // Fallback for cases where mergeCandidates did not retain end-cap labels.
  if (endCapCandidates.size === 0 && typeof resultSolid?.getFaceNames === 'function') {
    const featurePrefix = featureID ? `${featureID}_FILLET_` : '';
    for (const name of (resultSolid.getFaceNames() || [])) {
      if (typeof name !== 'string') continue;
      if (featurePrefix && !name.startsWith(featurePrefix)) continue;
      if (isFilletEndCapFaceName(name)) endCapCandidates.add(name);
    }
  }
  return endCapCandidates;
}

function mergeOutsetEndCapsByCoplanarity(resultSolid, filletEntries, direction, featureID, getFaceTris = null) {
  if (!resultSolid || String(direction).toUpperCase() !== 'OUTSET') return 0;
  if (typeof resultSolid.getFaceNames !== 'function') return 0;

  const faceHasTris = createFaceHasTrianglesPredicate(resultSolid, getFaceTris);
  const endCapCandidates = collectOutsetEndCapCandidates(resultSolid, filletEntries, featureID);
  if (endCapCandidates.size === 0) return 0;

  const areaCache = buildFaceAreaCache(resultSolid, getFaceTris);
  const planeCache = new Map();
  const dotThreshold = 0.999;
  const planeTol = Math.max(deriveSolidToleranceFromVerts(resultSolid, 1e-5) * 25, 1e-6);

  const pickCoplanarNeighbor = (capName, neighbors) => {
    if (!(neighbors instanceof Set) || neighbors.size === 0) return null;
    let best = null;
    let bestArea = -Infinity;
    for (const neighbor of neighbors) {
      if (!neighbor || neighbor === capName) continue;
      if (!faceHasTris(neighbor)) continue;
      if (endCapCandidates.has(neighbor) || isFilletEndCapFaceName(neighbor)) continue;
      if (!areFacesCoplanar(resultSolid, capName, neighbor, planeCache, dotThreshold, planeTol, getFaceTris)) continue;
      const area = areaCache.get(neighbor);
      if (area > bestArea) {
        best = neighbor;
        bestArea = area;
      }
    }
    return best;
  };

  const merged = mergeFilletEndCapsByAdjacencyStrategy(
    resultSolid,
    Array.from(endCapCandidates),
    pickCoplanarNeighbor,
    getFaceTris,
  );
  for (const capName of endCapCandidates) planeCache.delete(capName);
  return merged;
}

function mergeInsetEndCapsByNormal(
  resultSolid,
  featureID,
  direction,
  allowedFilletPrefixes = null,
  dotThreshold = 0.999,
  getFaceTris = null,
) {
  if (!resultSolid || String(direction).toUpperCase() !== 'INSET') return 0;
  if (typeof resultSolid.getFaceNames !== 'function') return 0;
  const faceNames = resultSolid.getFaceNames() || [];
  if (!Array.isArray(faceNames) || faceNames.length === 0) return 0;

  const allowedPrefixes = Array.isArray(allowedFilletPrefixes)
    ? allowedFilletPrefixes.filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  const hasPrefixFilter = allowedPrefixes.length > 0;
  const faceHasTris = createFaceHasTrianglesPredicate(resultSolid, getFaceTris);
  const activeFaceNames = faceNames.filter(faceHasTris);
  const prefix = featureID ? `${featureID}_FILLET_` : '';
  const endCapFaces = activeFaceNames.filter((name) => {
    if (typeof name !== 'string') return false;
    if (prefix && !name.startsWith(prefix)) return false;
    if (hasPrefixFilter && !allowedPrefixes.some((edgePrefix) => name.startsWith(`${edgePrefix}_`))) return false;
    return /_END_CAP_\d+$/.test(name);
  });
  if (!endCapFaces.length) return 0;

  const normalCache = new Map();
  const getNormal = (name) => {
    if (normalCache.has(name)) return normalCache.get(name);
    const n = averageFaceNormalSimple(resultSolid, name, getFaceTris);
    normalCache.set(name, n);
    return n;
  };
  const pickNormalAlignedNeighbor = (capName, neighbors) => {
    if (!(neighbors instanceof Set) || neighbors.size === 0) return null;
    const nCap = getNormal(capName);
    if (!nCap) return null;
    for (const neighbor of neighbors) {
      if (!neighbor || neighbor === capName) continue;
      const nAdj = getNormal(neighbor);
      if (!nAdj) continue;
      const dot = (nCap[0] * nAdj[0]) + (nCap[1] * nAdj[1]) + (nCap[2] * nAdj[2]);
      if (dot >= dotThreshold) return neighbor;
    }
    return null;
  };

  return mergeFilletEndCapsByAdjacencyStrategy(
    resultSolid,
    endCapFaces,
    pickNormalAlignedNeighbor,
    getFaceTris,
  );
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

function isFinitePoint3Array(point) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && Number.isFinite(point[2]);
}

function pointsMatchWithinTolerance(a, b, eps = 1e-9) {
  if (!isFinitePoint3Array(a) || !isFinitePoint3Array(b)) return false;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return ((dx * dx) + (dy * dy) + (dz * dz)) <= (eps * eps);
}

function filletEdgeSmoothClonePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map((p) => isFinitePoint3Array(p) ? [p[0], p[1], p[2]] : [0, 0, 0]);
}

function filletEdgeSmoothDot(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function filletEdgeSmoothHasBacktrackingAgainstSourceOpen(sourcePoints, candidatePoints) {
  const source = Array.isArray(sourcePoints) ? sourcePoints : [];
  const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
  if (source.length !== candidate.length || source.length < 2) return true;
  for (let i = 0; i < source.length - 1; i++) {
    const s0 = source[i];
    const s1 = source[i + 1];
    const c0 = candidate[i];
    const c1 = candidate[i + 1];
    if (!isFinitePoint3Array(s0) || !isFinitePoint3Array(s1) || !isFinitePoint3Array(c0) || !isFinitePoint3Array(c1)) {
      return true;
    }
    const srcSeg = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]];
    const candSeg = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const srcLen = Math.hypot(srcSeg[0], srcSeg[1], srcSeg[2]);
    const candLen = Math.hypot(candSeg[0], candSeg[1], candSeg[2]);
    if (!(srcLen > 1e-12) || !(candLen > 1e-12)) continue;
    const cos = filletEdgeSmoothDot(srcSeg, candSeg) / (srcLen * candLen);
    if (cos < -1e-6) return true;
  }
  return false;
}

function filletEdgeSmoothHasBacktrackingAgainstSourceClosed(sourcePoints, candidatePoints) {
  const source = Array.isArray(sourcePoints) ? sourcePoints : [];
  const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
  const count = source.length;
  if (count !== candidate.length || count < 3) return true;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const s0 = source[i];
    const s1 = source[next];
    const c0 = candidate[i];
    const c1 = candidate[next];
    if (!isFinitePoint3Array(s0) || !isFinitePoint3Array(s1) || !isFinitePoint3Array(c0) || !isFinitePoint3Array(c1)) {
      return true;
    }
    const srcSeg = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]];
    const candSeg = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const srcLen = Math.hypot(srcSeg[0], srcSeg[1], srcSeg[2]);
    const candLen = Math.hypot(candSeg[0], candSeg[1], candSeg[2]);
    if (!(srcLen > 1e-12) || !(candLen > 1e-12)) continue;
    const cos = filletEdgeSmoothDot(srcSeg, candSeg) / (srcLen * candLen);
    if (cos < -1e-6) return true;
  }
  return false;
}

function filletEdgeSmoothBlendPolylines(sourcePoints, candidatePoints, alpha, isClosedLoop) {
  const source = Array.isArray(sourcePoints) ? sourcePoints : [];
  const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
  const count = Math.min(source.length, candidate.length);
  const out = new Array(count);
  const t = Math.max(0, Math.min(1, Number(alpha) || 0));
  const u = 1 - t;
  for (let i = 0; i < count; i++) {
    if (!isClosedLoop && (i === 0 || i === (count - 1))) {
      out[i] = [source[i][0], source[i][1], source[i][2]];
      continue;
    }
    out[i] = [
      (source[i][0] * u) + (candidate[i][0] * t),
      (source[i][1] * u) + (candidate[i][1] * t),
      (source[i][2] * u) + (candidate[i][2] * t),
    ];
  }
  return out;
}

function filletEdgeSmoothEnforceNoBacktracking(sourcePoints, candidatePoints, isClosedLoop) {
  const source = Array.isArray(sourcePoints) ? sourcePoints : [];
  const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
  const hasBacktracking = isClosedLoop
    ? filletEdgeSmoothHasBacktrackingAgainstSourceClosed(source, candidate)
    : filletEdgeSmoothHasBacktrackingAgainstSourceOpen(source, candidate);
  if (!hasBacktracking) return candidate;

  let lo = 0;
  let hi = 1;
  let safe = filletEdgeSmoothClonePoints(source);
  for (let i = 0; i < 14; i++) {
    const alpha = (lo + hi) * 0.5;
    const blended = filletEdgeSmoothBlendPolylines(source, candidate, alpha, isClosedLoop);
    const bad = isClosedLoop
      ? filletEdgeSmoothHasBacktrackingAgainstSourceClosed(source, blended)
      : filletEdgeSmoothHasBacktrackingAgainstSourceOpen(source, blended);
    if (bad) hi = alpha;
    else {
      lo = alpha;
      safe = blended;
    }
  }
  return safe;
}

function filletEdgeSmoothPolylineKinks(points, options = {}) {
  const source = Array.isArray(points) ? points : [];
  const count = source.length;
  const isClosedLoop = !!options?.closedLoop;
  const rawStrength = Number(options?.strength);
  const strength = Number.isFinite(rawStrength)
    ? Math.max(0, Math.min(1, rawStrength))
    : 1;
  if (count < 3 || strength <= 0) return filletEdgeSmoothClonePoints(source);
  if (!source.every((p) => isFinitePoint3Array(p))) return filletEdgeSmoothClonePoints(source);

  const iterations = 1 + Math.floor(strength * 2); // 1..3 passes
  let current = filletEdgeSmoothClonePoints(source);
  for (let pass = 0; pass < iterations; pass++) {
    const next = filletEdgeSmoothClonePoints(current);
    let movedInPass = false;
    for (let i = 0; i < count; i++) {
      if (!isClosedLoop && (i === 0 || i === (count - 1))) continue;
      const prevIndex = (i + count - 1) % count;
      const nextIndex = (i + 1) % count;
      const prev = current[prevIndex];
      const cur = current[i];
      const after = current[nextIndex];
      if (!isFinitePoint3Array(prev) || !isFinitePoint3Array(cur) || !isFinitePoint3Array(after)) continue;

      const vPrev = [cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]];
      const vNext = [after[0] - cur[0], after[1] - cur[1], after[2] - cur[2]];
      const lenPrev = Math.hypot(vPrev[0], vPrev[1], vPrev[2]);
      const lenNext = Math.hypot(vNext[0], vNext[1], vNext[2]);
      if (!(lenPrev > 1e-12) || !(lenNext > 1e-12)) continue;

      const dotRaw = filletEdgeSmoothDot(vPrev, vNext) / (lenPrev * lenNext);
      const dot = Math.max(-1, Math.min(1, dotRaw));
      const kinkFactor = Math.max(0, (1 - dot) * 0.5);
      if (kinkFactor < 0.01) continue;

      const localWeight = strength * Math.sqrt(kinkFactor);
      if (!(localWeight > 1e-6)) continue;

      const tx = (prev[0] + after[0]) * 0.5;
      const ty = (prev[1] + after[1]) * 0.5;
      const tz = (prev[2] + after[2]) * 0.5;
      let mx = (tx - cur[0]) * localWeight;
      let my = (ty - cur[1]) * localWeight;
      let mz = (tz - cur[2]) * localWeight;
      const moveLen = Math.hypot(mx, my, mz);
      if (!(moveLen > 1e-12)) continue;
      const maxMove = Math.min(lenPrev, lenNext) * 0.45;
      if (moveLen > maxMove && maxMove > 1e-12) {
        const s = maxMove / moveLen;
        mx *= s;
        my *= s;
        mz *= s;
      }

      next[i] = [
        cur[0] + mx,
        cur[1] + my,
        cur[2] + mz,
      ];
      movedInPass = true;
    }
    current = next;
    if (!movedInPass) break;
  }

  return filletEdgeSmoothEnforceNoBacktracking(source, current, isClosedLoop);
}

function collectFilletGeneratedEdgeSmoothTargets(resultSolid, filletEntries, featureID, smoothStrength = 1) {
  const targetMap = new Map();
  const lockedEndpointIndices = new Set();
  const filletNamePrefixes = [];
  for (const entry of (Array.isArray(filletEntries) ? filletEntries : [])) {
    const filletName = entry?.filletName;
    if (typeof filletName === 'string' && filletName.length > 0) {
      filletNamePrefixes.push(filletName);
    }
  }

  let consideredEdges = 0;
  let eligibleEdges = 0;
  let smoothedEdges = 0;
  let skippedClosedLoops = 0;
  let targetAssignments = 0;

  if (!resultSolid || typeof resultSolid.getBoundaryEdgePolylines !== 'function') {
    return {
      targetMap,
      consideredEdges,
      eligibleEdges,
      smoothedEdges,
      skippedClosedLoops,
      targetAssignments,
      lockedEndpointCount: 0,
    };
  }

  const clampedStrength = Number.isFinite(Number(smoothStrength))
    ? Math.max(0, Math.min(1, Number(smoothStrength)))
    : 1;
  const boundaries = resultSolid.getBoundaryEdgePolylines() || [];
  for (const boundary of boundaries) {
    const faceA = boundary?.faceA;
    const faceB = boundary?.faceB;
    const isClosedLoop = !!boundary?.closedLoop;
    const involvesFilletFace = isFilletFaceName(faceA, filletNamePrefixes, featureID)
      || isFilletFaceName(faceB, filletNamePrefixes, featureID);
    if (!involvesFilletFace) continue;

    consideredEdges++;

    const indices = Array.isArray(boundary?.indices) ? boundary.indices : [];
    const positions = Array.isArray(boundary?.positions) ? boundary.positions : [];
    const count = Math.min(indices.length, positions.length);
    if (count < 3) continue;

    const cleanedIndices = [];
    const cleanedPositions = [];
    for (let i = 0; i < count; i++) {
      const idx = Number(indices[i]);
      const p = positions[i];
      if (!Number.isInteger(idx) || idx < 0 || !isFinitePoint3Array(p)) continue;
      cleanedIndices.push(idx);
      cleanedPositions.push([p[0], p[1], p[2]]);
    }
    if (cleanedIndices.length < 3) continue;

    if (isClosedLoop && cleanedIndices.length >= 3) {
      const last = cleanedIndices.length - 1;
      const repeatsStart = cleanedIndices[0] === cleanedIndices[last]
        || pointsMatchWithinTolerance(cleanedPositions[0], cleanedPositions[last]);
      if (repeatsStart) {
        cleanedIndices.pop();
        cleanedPositions.pop();
      }
      if (cleanedIndices.length < 3) {
        skippedClosedLoops++;
        continue;
      }
    }

    eligibleEdges++;
    const snapped = filletEdgeSmoothPolylineKinks(cleanedPositions, {
      closedLoop: isClosedLoop,
      strength: clampedStrength,
    });
    if (!Array.isArray(snapped) || snapped.length !== cleanedPositions.length) continue;
    smoothedEdges++;

    if (!isClosedLoop) {
      lockedEndpointIndices.add(cleanedIndices[0]);
      lockedEndpointIndices.add(cleanedIndices[cleanedIndices.length - 1]);
    }
    const start = isClosedLoop ? 0 : 1;
    const endExclusive = isClosedLoop ? cleanedIndices.length : (cleanedIndices.length - 1);
    for (let i = start; i < endExclusive; i++) {
      const idx = cleanedIndices[i];
      const pt = snapped[i];
      if (!Number.isInteger(idx) || idx < 0 || !isFinitePoint3Array(pt)) continue;
      targetAssignments++;
      const aggregate = targetMap.get(idx) || { x: 0, y: 0, z: 0, count: 0 };
      aggregate.x += pt[0];
      aggregate.y += pt[1];
      aggregate.z += pt[2];
      aggregate.count += 1;
      targetMap.set(idx, aggregate);
    }
  }

  for (const endpointIndex of lockedEndpointIndices) {
    targetMap.delete(endpointIndex);
  }

  return {
    targetMap,
    consideredEdges,
    eligibleEdges,
    smoothedEdges,
    skippedClosedLoops,
    targetAssignments,
    lockedEndpointCount: lockedEndpointIndices.size,
  };
}

function applyFilletEdgeSmoothTargets(resultSolid, targetMap) {
  const vp = Array.isArray(resultSolid?._vertProperties) ? resultSolid._vertProperties : null;
  const tv = Array.isArray(resultSolid?._triVerts) ? resultSolid._triVerts : null;
  if (!vp || vp.length < 3 || !(targetMap instanceof Map) || targetMap.size === 0) {
    return { movedVertices: 0, constrainedVertices: 0, rejectedVertices: 0 };
  }

  const moveStats = applyConstrainedVertexTargets(vp, tv, targetMap, {
    minArea2Ratio: 0.04,
    minNormalDot: 0.1,
    minArea2Abs: 1e-24,
  });
  const movedVertices = Number(moveStats?.movedVertices) || 0;
  if (movedVertices <= 0) {
    return {
      movedVertices: 0,
      constrainedVertices: Number(moveStats?.constrainedVertices) || 0,
      rejectedVertices: Number(moveStats?.rejectedVertices) || 0,
    };
  }

  resultSolid._vertProperties = vp;
  resultSolid._dirty = true;
  resultSolid._faceIndex = null;
  const keyToIndex = new Map();
  for (let i = 0; i < vp.length; i += 3) {
    const key = `${vp[i + 0]},${vp[i + 1]},${vp[i + 2]}`;
    keyToIndex.set(key, (i / 3) | 0);
  }
  resultSolid._vertKeyToIndex = keyToIndex;

  try {
    if (resultSolid._manifold && typeof resultSolid._manifold.delete === 'function') {
      resultSolid._manifold.delete();
    }
  } catch { }
  resultSolid._manifold = null;
  try {
    if (typeof resultSolid._manifoldize === 'function') {
      resultSolid._manifoldize();
    }
  } catch { }
  return {
    movedVertices,
    constrainedVertices: Number(moveStats?.constrainedVertices) || 0,
    rejectedVertices: Number(moveStats?.rejectedVertices) || 0,
  };
}

function smoothFilletGeneratedEdges(resultSolid, filletEntries, featureID, smoothStrength = 1) {
  const targetInfo = collectFilletGeneratedEdgeSmoothTargets(
    resultSolid,
    filletEntries,
    featureID,
    smoothStrength,
  );
  const moveStats = applyFilletEdgeSmoothTargets(resultSolid, targetInfo.targetMap);
  const movedVertices = Number(moveStats?.movedVertices) || 0;
  return {
    consideredEdges: targetInfo.consideredEdges,
    eligibleEdges: targetInfo.eligibleEdges,
    smoothedEdges: targetInfo.smoothedEdges,
    skippedClosedLoops: targetInfo.skippedClosedLoops,
    targetAssignments: targetInfo.targetAssignments,
    lockedEndpointCount: targetInfo.lockedEndpointCount,
    movedVertices,
    constrainedVertices: Number(moveStats?.constrainedVertices) || 0,
    rejectedVertices: Number(moveStats?.rejectedVertices) || 0,
    smoothStrength: Number.isFinite(Number(smoothStrength))
      ? Math.max(0, Math.min(1, Number(smoothStrength)))
      : 1,
  };
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
    if (!incidentFaces || incidentFaces.size < 3) continue;

    const endCapsAtVertex = [];
    const nonEndCapsAtVertex = [];
    for (const faceID of incidentFaces) {
      if (isEndCapFaceID(faceID)) endCapsAtVertex.push(faceID >>> 0);
      else nonEndCapsAtVertex.push(faceID >>> 0);
    }
    if (endCapsAtVertex.length !== 2) continue;
    if ((endCapsAtVertex[0] >>> 0) === (endCapsAtVertex[1] >>> 0)) continue;
    const capA = endCapsAtVertex[0] >>> 0;
    const capB = endCapsAtVertex[1] >>> 0;

    const edgeRecs = vertexEdges[vi];
    if (!Array.isArray(edgeRecs) || edgeRecs.length < 2) continue;
    if (nonEndCapsAtVertex.length < 1) continue;

    // Boolean artifacts can add extra tiny faces at the tip vertex. Prefer the
    // support face that still forms a clean cap/support chain on both caps.
    let supportFaceID = null;
    let neighborsA = null;
    let neighborsB = null;
    for (const supportCandidateRaw of nonEndCapsAtVertex) {
      const supportCandidate = supportCandidateRaw >>> 0;
      const supportFaceName = idToFaceName.get(supportCandidate);
      // Never drive tip-collapse from the fillet round face; that pulls collapse
      // chains into the rounded area instead of the intended two local edges.
      if (typeof supportFaceName === 'string' && supportFaceName.includes('TUBE_Outer')) continue;

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
        if ((otherFace >>> 0) !== supportCandidate) continue;
        if (isEndCapFaceID(otherFace)) continue;
        const neighbor = edgeRec.other >>> 0;
        if (neighbor >= vertexCount || neighbor === vi) continue;
        const bucket = neighborsByCap.get(capFace);
        if (!bucket) continue;
        bucket.add(neighbor);
      }

      const localA = Array.from(neighborsByCap.get(capA) || []);
      const localB = Array.from(neighborsByCap.get(capB) || []);
      if (localA.length !== 1 || localB.length !== 1) continue;
      supportFaceID = supportCandidate;
      neighborsA = localA;
      neighborsB = localB;
      break;
    }
    if (!Number.isFinite(supportFaceID)) continue;

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
    if (!(d2 > 1e-24)) {
      // Even if the tip is already at midpoint, patching the selected cap faces
      // can still remove the residual overlap fan at this junction.
      movedEndCapFaceIDs.add(capA);
      movedEndCapFaceIDs.add(capB);
      continue;
    }

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
 * Accepts explicit `edges` objects.
 *
 * @param {Object} opts
 * @param {number} opts.radius Required fillet radius (> 0)
 * @param {any[]} [opts.edges] Optional pre-resolved Edge objects (must belong to this Solid)
 * @param {'AUTO'|'INSET'|'OUTSET'|string} [opts.direction='AUTO'] Choose boolean side per edge automatically (AUTO) or force INSET/OUTSET
 * @param {number} [opts.inflate=0.1] Inflation for cutting tube
 * @param {number} [opts.nudgeFaceDistance=0.0001] pushFace amount applied to wedge faces/end caps before boolean
 * @param {number} [opts.resolution=32] Tube resolution (segments around circumference)
 * @param {boolean} [opts.debug=false] Enable debug visuals in fillet builder
 * @param {number} [opts.debugSolidsLevel=0] -1=none, 0=tube+wedge, 1=edge fillet boolean result, 2=all intermediate solids
 * @param {boolean} [opts.debugShowCombinedBeforeTarget=false] Emit the combined fillet solid before target boolean
 * @param {boolean} [opts.showTangentOverlays=false] Show pre-inflate tangent overlays on the fillet tube
 * @param {boolean} [opts.patchFilletEndCaps=false] Enable three-face tip cleanup and end-cap triangle replacement patching
 * @param {boolean} [opts.smoothGeneratedEdges=false] Apply localized kink smoothing to fillet-generated boundary edges
 * @param {string} [opts.featureID='FILLET'] For naming of intermediates and result
 * @param {number} [opts.cleanupTinyFaceIslandsArea=0.001] area threshold for face-island relabeling (<= 0 disables)
 * @returns {import('../BetterSolid.js').Solid}
 */
export async function fillet(opts = {}) {
  const {
    filletSolid,
    getFilletSectionDebuggerState,
    setFilletSectionDebuggerState,
  } = await import("../fillets/fillet.js");
  const { Tube: TubeClass } = await import("../Tube.js");
  const radius = Number(opts.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Solid.fillet: radius must be > 0, got ${opts.radius}`);
  }
  const directionMode = normalizeFilletDirectionMode(opts.direction);
  const fallbackDirection = (directionMode === 'OUTSET') ? 'OUTSET' : 'INSET';
  const autoDirection = directionMode === 'AUTO';
  const inflate = Number.isFinite(opts.inflate) ? Number(opts.inflate) : 0.1;
  const nudgeFaceDistanceRaw = Number(opts.nudgeFaceDistance);
  const nudgeFaceDistance = Number.isFinite(nudgeFaceDistanceRaw) ? nudgeFaceDistanceRaw : 0.0001;
  const debug = !!opts.debug;
  const debugSolidsLevelRaw = Number(opts.debugSolidsLevel);
  const debugSolidsLevel = Number.isFinite(debugSolidsLevelRaw)
    ? Math.max(-1, Math.min(2, Math.floor(debugSolidsLevelRaw)))
    : 0;
  const debugShowCombinedBeforeTarget = !!opts.debugShowCombinedBeforeTarget;
  const resolutionRaw = Number(opts.resolution);
  const resolution = (Number.isFinite(resolutionRaw) && resolutionRaw > 0)
    ? Math.max(8, Math.floor(resolutionRaw))
    : 32;
  const showTangentOverlays = !!opts.showTangentOverlays;
  const patchFilletEndCaps = !!opts.patchFilletEndCaps;
  const smoothGeneratedEdges = !!opts.smoothGeneratedEdges;
  const featureID = opts.featureID || 'FILLET';
  const cleanupTinyFaceIslandsAreaRaw = Number(opts.cleanupTinyFaceIslandsArea);
  const cleanupTinyFaceIslandsArea = Number.isFinite(cleanupTinyFaceIslandsAreaRaw)
    ? cleanupTinyFaceIslandsAreaRaw
    : 0.001;

  // Resolve pre-selected edge objects.
  const unique = resolveEdgesFromInputs(this, { edges: opts.edges });
  if (unique.length === 0) {
    console.warn('[Solid.fillet] No edges resolved on target solid; returning clone.', { featureID, solid: this?.name });
    // Nothing to do - return an unchanged clone so caller can replace scene node safely
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }
  const baseBoundaryPolylines = autoDirection && typeof this.getBoundaryEdgePolylines === 'function'
    ? (() => {
      try { return this.getBoundaryEdgePolylines() || []; } catch { return null; }
    })()
    : null;
  const getBaseFaceTris = autoDirection ? createFaceTrianglesAccessor(this) : null;

  // Build fillet solids per edge using existing core implementation
  const filletEntries = [];
  let idx = 0;
  const debugAdded = [];
  const sectionDebuggerState = getFilletSectionDebuggerState();
  const sectionDebuggerEnabled = !!sectionDebuggerState?.enabled;
  let sectionDebuggerCaptured = false;
  const attachDebugSolids = (target) => {
    if (!target || debugAdded.length === 0) return;
    try { target.__debugAddedSolids = debugAdded; } catch { }
  };
  const buildFallbackResult = () => {
    const fallback = this.clone();
    try { fallback.name = this.name; } catch { }
    attachDebugSolids(fallback);
    return fallback;
  };
  const pushDebugSolid = (solid, force = false) => {
    if ((!debug && !force) || !solid) return;
    debugAdded.push(solid);
  };
  const pushNamedDebugSnapshot = (solid, snapshotName, requireClone = false) => {
    if (!debug || !solid) return;
    if (requireClone && typeof solid.clone !== 'function') return;
    try {
      const snapshot = (typeof solid.clone === 'function') ? solid.clone() : solid;
      try { snapshot.name = snapshotName; } catch { }
      debugAdded.push(snapshot);
    } catch { }
  };
  const pushTubeAndWedgeDebug = (res) => {
    if (!debug || !res) return;
    try { if (res.tube) pushDebugSolid(res.tube); } catch { }
    try { if (res.wedge) pushDebugSolid(res.wedge); } catch { }
  };
  const combineFilletEntrySolids = (entries, groupLabel) => {
    const solids = (Array.isArray(entries) ? entries : []).map((entry) => entry?.filletSolid).filter(Boolean);
    if (solids.length === 0) return null;
    let combined = solids[0];
    for (let i = 1; i < solids.length; i++) {
      combined = combined.union(solids[i]);
      try { combined.name = `${featureID}_COMBINED_FILLET_${groupLabel}`; } catch { }
      if (debug && debugSolidsLevel >= 2 && combined && typeof combined.clone === 'function') {
        pushNamedDebugSnapshot(combined, `${featureID}_COMBINED_${groupLabel}_STEP_${i - 1}`, true);
      }
    }
    try { combined.name = `${featureID}_COMBINED_FILLET_${groupLabel}`; } catch { }
    return combined;
  };
  const booleanGroups = [
    {
      mode: 'INSET',
      operation: 'subtract',
      stepIndex: 0,
      stepLabel: 'SUBTRACT',
      entries: [],
      combinedSolid: null,
    },
    {
      mode: 'OUTSET',
      operation: 'union',
      stepIndex: 1,
      stepLabel: 'UNION',
      entries: [],
      combinedSolid: null,
    },
  ];
  const getBooleanGroupForDirection = (direction) => (
    String(direction || 'INSET').toUpperCase() === 'OUTSET'
      ? booleanGroups[1]
      : booleanGroups[0]
  );

  const insideTester = autoDirection ? buildPointInsideTester(this) : null;
  const sectionDebuggerEdgeTarget = normalizeFilletSectionDebuggerName(sectionDebuggerState?.edgeName);
  const sectionDebuggerExplicitEdge = !!sectionDebuggerEdgeTarget;
  const sectionDebuggerSingleEdgeFallback = sectionDebuggerExplicitEdge && unique.length === 1;
  let cornerBridgeCount = 0;
  let tangentCornerTransitionCollapse = {
    tangentPairs: 0,
    participantEntries: 0,
    collapsedEntries: 0,
  };
  const directionDecision = {
    mode: directionMode,
    autoEnabled: autoDirection,
    fallbackDirection,
    totalEdges: unique.length,
    insetEdges: 0,
    outsetEdges: 0,
    fallbackEdges: 0,
    ambiguousEdges: 0,
  };
  const captureSectionDebuggerForEdge = (edgeObj, filletName, filletResult) => {
    if (!sectionDebuggerEnabled || sectionDebuggerCaptured) return;
    const edgeMatchesTarget = filletSectionDebuggerMatchesEdge(sectionDebuggerState, featureID, edgeObj);
    if (!edgeMatchesTarget && !sectionDebuggerSingleEdgeFallback) return;

    const centerline = Array.isArray(filletResult?.centerline) ? filletResult.centerline : [];
    const tangentA = Array.isArray(filletResult?.tangentA) ? filletResult.tangentA : [];
    const tangentB = Array.isArray(filletResult?.tangentB) ? filletResult.tangentB : [];
    const sampleCountHint = Math.min(centerline.length, tangentA.length, tangentB.length);
    const rawStep = Number(sectionDebuggerState?.stepIndex);
    const requestedStep = Number.isFinite(rawStep) ? Math.trunc(rawStep) : 0;
    const resolvedFallbackStep = sampleCountHint > 0
      ? ((requestedStep % sampleCountHint) + sampleCountHint) % sampleCountHint
      : 0;

    if (!(sampleCountHint > 0)) {
      if (sectionDebuggerExplicitEdge) {
        sectionDebuggerCaptured = true;
        setFilletSectionDebuggerState({
          enabled: true,
          featureID,
          edgeName: edgeObj?.name || sectionDebuggerEdgeTarget || null,
          lastSampleCount: 0,
          lastResolvedStepIndex: 0,
          lastEdgeName: edgeObj?.name || null,
        });
      }
      return;
    }

    let edgePoints = Array.isArray(filletResult?.edge) ? filletResult.edge : [];
    if (edgePoints.length < sampleCountHint) {
      edgePoints = buildEdgeSamplePointsForCount(edgeObj, sampleCountHint);
    }
    if (edgePoints.length < sampleCountHint) {
      if (sectionDebuggerExplicitEdge) {
        sectionDebuggerCaptured = true;
        setFilletSectionDebuggerState({
          enabled: true,
          featureID,
          edgeName: edgeObj?.name || sectionDebuggerEdgeTarget || null,
          lastSampleCount: sampleCountHint,
          lastResolvedStepIndex: resolvedFallbackStep,
          lastEdgeName: edgeObj?.name || null,
        });
      }
      return;
    }

    const sectionDebug = buildFilletSectionDebugSolid({
      baseSolid: this,
      edgeObj,
      featureID,
      filletName,
      centerline,
      tangentA,
      tangentB,
      edgePoints,
      radius,
      rawStepIndex: requestedStep,
      DebugSolidClass: this?.constructor?.BaseSolid || this?.constructor || null,
    });
    if (!sectionDebug?.debugSolid) {
      if (sectionDebuggerExplicitEdge) {
        sectionDebuggerCaptured = true;
        setFilletSectionDebuggerState({
          enabled: true,
          featureID,
          edgeName: edgeObj?.name || sectionDebuggerEdgeTarget || null,
          lastSampleCount: sampleCountHint,
          lastResolvedStepIndex: resolvedFallbackStep,
          lastEdgeName: edgeObj?.name || null,
        });
      }
      return;
    }

    pushDebugSolid(sectionDebug.debugSolid, true);
    sectionDebuggerCaptured = true;
    setFilletSectionDebuggerState({
      enabled: true,
      featureID,
      edgeName: edgeObj?.name || sectionDebuggerEdgeTarget || null,
      lastSampleCount: sectionDebug.sampleCount,
      lastResolvedStepIndex: sectionDebug.resolvedStep,
      lastEdgeName: edgeObj?.name || null,
    });
    console.log('[Solid.fillet] Section debugger captured step.', {
      featureID,
      edge: edgeObj?.name || null,
      requestedEdge: sectionDebuggerEdgeTarget || null,
      sampleCount: sectionDebug.sampleCount,
      requestedStep,
      resolvedStep: sectionDebug.resolvedStep,
      usedSingleEdgeFallback: (!edgeMatchesTarget && sectionDebuggerSingleEdgeFallback),
    });
  };

  for (const e of unique) {
    const name = `${featureID}_FILLET_${idx++}`;
    let edgeDirection = fallbackDirection;
    let directionReason = autoDirection ? 'fallback' : 'explicit';
    let directionDetail = null;
    if (autoDirection) {
      const classified = classifyEdgeFilletDirectionByInsideOutside(
        this,
        e,
        insideTester,
        radius,
        fallbackDirection,
        baseBoundaryPolylines,
        getBaseFaceTris,
      );
      edgeDirection = classified?.direction || fallbackDirection;
      directionReason = classified?.reason || 'fallback';
      directionDetail = classified || null;
      const isClassified = directionReason === 'classified' || directionReason === 'signed_dihedral';
      if (!isClassified) {
        directionDecision.fallbackEdges += 1;
        if (String(directionReason || '').includes('ambiguous')) directionDecision.ambiguousEdges += 1;
      }
    }
    if (edgeDirection === 'OUTSET') directionDecision.outsetEdges += 1;
    else directionDecision.insetEdges += 1;

    const res = filletSolid({
      edgeToFillet: e,
      radius,
      sideMode: edgeDirection,
      inflate,
      nudgeFaceDistance,
      resolution,
      debug,
      name,
      showTangentOverlays,
    }) || {};
    if (res.error) {
      console.warn(`Fillet failed for edge ${e?.name || idx}: ${res.error}`);
    }
    try {
      captureSectionDebuggerForEdge(e, name, res);
    } catch (err) {
      console.warn('[Solid.fillet] Failed to build section debugger solid.', {
        featureID,
        edge: e?.name || null,
        error: err?.message || err,
      });
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
    const edgePolyline = getEdgePolylineLocal(e);
    const centerlinePathPoints = (Array.isArray(res?.centerline) && res.centerline.length >= 2)
      ? res.centerline.map((pt) => toPoint3Object(pt)).filter(Boolean)
      : [];
    const edgePathPoints = (Array.isArray(res?.edge) && res.edge.length >= 2)
      ? res.edge.map((pt) => toPoint3Object(pt)).filter(Boolean)
      : (Array.isArray(edgePolyline) ? edgePolyline.map((pt) => toPoint3Object(pt)).filter(Boolean) : []);
    filletEntries.push({
      filletSolid: res.finalSolid,
      filletName: name,
      mergeCandidates,
      roundFaceName,
      wedgeSolid: res.wedge || null,
      tubeSolid: res.tube || null,
      tubeCapPointsBeforeNudge: res.tubeCapPointsBeforeNudge || null,
      edgeDirection,
      directionReason,
      directionDetail,
      edgeObj: e || null,
      edgePolyline,
      centerlinePathPoints,
      edgePathPoints,
    });
    if (debug && debugSolidsLevel >= 0) {
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
  try {
    const SolidClass = this?.constructor?.BaseSolid || this?.constructor || null;
    const cornerBridgeEntries = buildNonTangentCornerTransitionEntries({
      filletEntries,
      featureID,
      radius,
      resolution,
      SolidClass,
      TubeClass,
      debug,
    });
    if (cornerBridgeEntries.length > 0) {
      cornerBridgeCount = cornerBridgeEntries.length;
      for (const entry of cornerBridgeEntries) {
        filletEntries.push(entry);
      }
      if (debug && debugSolidsLevel >= 0) {
        for (const entry of cornerBridgeEntries) {
          if (debugSolidsLevel === 0) {
            if (entry?.tubeSolid) pushDebugSolid(entry.tubeSolid);
            if (entry?.wedgeSolid) pushDebugSolid(entry.wedgeSolid);
          } else if (debugSolidsLevel === 1) {
            if (entry?.filletSolid) pushDebugSolid(entry.filletSolid);
          } else {
            if (entry?.tubeSolid) pushDebugSolid(entry.tubeSolid);
            if (entry?.wedgeSolid) pushDebugSolid(entry.wedgeSolid);
            if (entry?.filletSolid) pushDebugSolid(entry.filletSolid);
          }
        }
      }
      console.log('[Solid.fillet] Added non-tangent corner transition fillets.', {
        featureID,
        addedCorners: cornerBridgeEntries.length,
      });
    }
  } catch (err) {
    console.warn('[Solid.fillet] Failed to build non-tangent corner transitions.', {
      featureID,
      error: err?.message || err,
    });
  }
  if (sectionDebuggerEnabled && !sectionDebuggerCaptured && sectionDebuggerExplicitEdge) {
    setFilletSectionDebuggerState({
      enabled: true,
      featureID,
      edgeName: sectionDebuggerEdgeTarget,
      lastSampleCount: 0,
      lastResolvedStepIndex: 0,
      lastEdgeName: null,
    });
    console.warn('[Solid.fillet] Section debugger did not match any edge.', {
      featureID,
      requestedEdge: sectionDebuggerEdgeTarget,
      candidateEdges: unique.map((edgeObj) => edgeObj?.name).filter(Boolean),
    });
  }
  if (autoDirection) {
    console.log('[Solid.fillet] AUTO direction classification complete.', {
      featureID,
      insetEdges: directionDecision.insetEdges,
      outsetEdges: directionDecision.outsetEdges,
      fallbackEdges: directionDecision.fallbackEdges,
      ambiguousEdges: directionDecision.ambiguousEdges,
    });
  }
  if (filletEntries.length === 0) {
    console.error('[Solid.fillet] All edge fillets failed; returning clone.', { featureID, edgeCount: unique.length });
    return buildFallbackResult();
  }
  tangentCornerTransitionCollapse = collapseTangentCornerTransitionFaces({
    filletEntries,
    featureID,
    endpointTolerance: Math.max(1e-6, Math.abs(Number(radius) || 0) * 1e-4),
    tangentDotThreshold: 0.995,
    debug,
  });
  for (const entry of filletEntries) {
    getBooleanGroupForDirection(entry?.edgeDirection).entries.push(entry);
  }
  const insetEntries = booleanGroups[0].entries;
  const outsetEntries = booleanGroups[1].entries;
  try {
    for (const group of booleanGroups) {
      group.combinedSolid = combineFilletEntrySolids(group.entries, group.mode);
    }

    if (debug && debugShowCombinedBeforeTarget) {
      for (const group of booleanGroups) {
        if (!group.combinedSolid) continue;
        pushNamedDebugSnapshot(
          group.combinedSolid,
          `${featureID}_COMBINED_FILLET_${group.mode}_PRE_TARGET`,
          false,
        );
      }
    }
  } catch (err) {
    console.error('[Solid.fillet] Fillet combine failed; returning clone.', { featureID, error: err?.message || err });
    return buildFallbackResult();
  }
  if (!booleanGroups.some((group) => !!group.combinedSolid)) {
    console.error('[Solid.fillet] No combined fillet solids available; returning clone.', { featureID, edgeCount: unique.length });
    return buildFallbackResult();
  }

  // Apply booleans in one unified path: subtract INSET tools, union OUTSET tools.
  let result = this;
  try {
    for (const group of booleanGroups) {
      if (!group.combinedSolid) continue;
      result = (group.operation === 'subtract')
        ? result.subtract(group.combinedSolid)
        : result.union(group.combinedSolid);
      if (debug && debugSolidsLevel >= 2 && result && typeof result.clone === 'function') {
        pushNamedDebugSnapshot(
          result,
          `${featureID}_TARGET_BOOLEAN_STEP_${group.stepIndex}_${group.stepLabel}`,
          true,
        );
      }
    }
    try { result.name = this.name; } catch { }
    if (debug && typeof result?.visualize === 'function') {
      result.visualize();
    }
  } catch (err) {
    console.error('[Solid.fillet] Fillet boolean failed; returning clone.', { featureID, error: err?.message || err });
    return buildFallbackResult();
  }

  let getResultFaceTris = createFaceTrianglesAccessor(result);

  const runPostPatchFaceMerges = async () => {
    try {
      const coplanarMerged = mergeOutsetEndCapsByCoplanarity(
        result,
        outsetEntries,
        'OUTSET',
        featureID,
        getResultFaceTris,
      );
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
      const resultAreaCache = buildFaceAreaCache(result, getResultFaceTris);
      const filletAreaCacheBySolid = new WeakMap();
      const filletFaceAccessorBySolid = new WeakMap();
      for (const entry of filletEntries) {
        const { filletSolid, filletName } = entry;
        const mergeSolid = filletSolid;
        const roundFaceName = entry.roundFaceName || guessRoundFaceName(mergeSolid, filletName);
        const candidateNames = (Array.isArray(entry.mergeCandidates) && entry.mergeCandidates.length)
          ? entry.mergeCandidates
          : getFilletMergeCandidateNames(mergeSolid);
        let filletAreaCache = filletAreaCacheBySolid.get(mergeSolid);
        if (!filletAreaCache) {
          let getMergeSolidFaceTris = filletFaceAccessorBySolid.get(mergeSolid);
          if (!getMergeSolidFaceTris) {
            getMergeSolidFaceTris = createFaceTrianglesAccessor(mergeSolid);
            filletFaceAccessorBySolid.set(mergeSolid, getMergeSolidFaceTris);
          }
          filletAreaCache = buildFaceAreaCache(mergeSolid, getMergeSolidFaceTris);
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
      if (insetEntries.length > 0) {
        const insetPrefixes = insetEntries
          .map((entry) => entry?.filletName)
          .filter((name) => typeof name === 'string' && name.length > 0);
        await mergeInsetEndCapsByNormal(result, featureID, 'INSET', insetPrefixes, 0.999, getResultFaceTris);
      }
    } catch (err) {
      console.warn('[Solid.fillet] Inset end cap merge failed', { featureID, error: err?.message || err });
    }
  };

  let collapseEdgeDebugMarkers = [];
  let prePatchResultSnapshot = null;
  if (patchFilletEndCaps) {
    try {
      prePatchResultSnapshot = (typeof result?.clone === 'function') ? result.clone() : null;
      if (prePatchResultSnapshot) {
        try { prePatchResultSnapshot.name = result.name; } catch { }
      }
    } catch {
      prePatchResultSnapshot = null;
    }

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
      try {
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
      } catch (err) {
        console.warn('[Solid.fillet] End-cap triangle replacement patch failed', {
          featureID,
          error: err?.message || err,
        });
        if (prePatchResultSnapshot) {
          // Avoid leaving partially edited topology when patching throws.
          result = prePatchResultSnapshot;
          getResultFaceTris = createFaceTrianglesAccessor(result);
        }
      }
    }
  }

  // Keep face relabel/merge passes after patching, and allow temporarily
  // disabling them entirely while debugging end-cap patch behavior.
  if (ENABLE_FILLET_FACE_RENAMING) {
    await runPostPatchFaceMerges();
  }

  try {
    await result.collapseTinyTriangles(0.0009);
  } catch (err) {
    console.warn('[Solid.fillet] collapseTinyTriangles failed', { featureID, error: err?.message || err });
  }

  // Attach debug artifacts for callers that want to add them to the scene
  attachDebugSolids(result);
  try {
    result.__filletDirectionDecision = {
      ...directionDecision,
      insetEntries: insetEntries.length,
      outsetEntries: outsetEntries.length,
      cornerBridgeEntries: cornerBridgeCount,
      tangentCornerTransitionPairs: Number(tangentCornerTransitionCollapse?.tangentPairs) || 0,
      tangentCornerTransitionParticipants: Number(tangentCornerTransitionCollapse?.participantEntries) || 0,
      tangentCornerTransitionCollapsedEntries: Number(tangentCornerTransitionCollapse?.collapsedEntries) || 0,
    };
  } catch { }
  try { result.__filletCornerBridgeCount = cornerBridgeCount; } catch { }

  // Simplify the final result in place to clean up artifacts from booleans.
  try {
    await result.removeSmallIslands();
  } catch (err) {
    console.warn('[Solid.fillet] simplify failed; continuing without simplification', { featureID, error: err?.message || err });
  }

  if (smoothGeneratedEdges) {
    // Smooth newly generated fillet edges using localized kink cleanup.
    try {
      const edgeSmoothing = smoothFilletGeneratedEdges(result, filletEntries, featureID, 1);
      try { result.__filletEdgeSmoothing = edgeSmoothing; } catch { }
      if ((Number(edgeSmoothing?.consideredEdges) || 0) > 0) {
        console.log('[Solid.fillet] Applied edge smoothing to fillet-generated edges.', {
          featureID,
          consideredEdges: edgeSmoothing.consideredEdges,
          eligibleEdges: edgeSmoothing.eligibleEdges,
          smoothedEdges: edgeSmoothing.smoothedEdges,
          skippedClosedLoops: edgeSmoothing.skippedClosedLoops,
          movedVertices: edgeSmoothing.movedVertices,
          constrainedVertices: edgeSmoothing.constrainedVertices,
          rejectedVertices: edgeSmoothing.rejectedVertices,
        });
      }
    } catch (err) {
      console.warn('[Solid.fillet] Fillet edge smoothing failed; continuing without smoothing', {
        featureID,
        error: err?.message || err,
      });
    }
  } else {
    try { result.__filletEdgeSmoothing = null; } catch { }
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
      direction: directionMode,
      inflate,
    });
  }

  return result;
}

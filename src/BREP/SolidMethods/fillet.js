// Solid.fillet implementation: consolidates fillet logic so features call this API.
// Usage: solid.fillet({ radius, edges, featureID, direction, inflate, resolution, debug, debugSolidsLevel, debugShowCombinedBeforeTarget, showTangentOverlays })
import { resolveEdgesFromInputs } from './edgeResolution.js';
import { getCachedFaceDataForTris, localFaceNormalAtPoint, averageFaceNormalObjectSpace } from '../fillets/inset.js';
import { createQuantizer } from '../../utils/geometryTolerance.js';
import { buildPointInsideTester } from '../utils/pointInsideTester.js';
import { Manifold } from '../SolidShared.js';

const __SEEN_FACE_NAME_MUTATION_BREAKS = new Set();
function breakOnFaceNameMutation(faceName, reason = 'face_name_mutation', once = false) {
  const key = String(faceName || '').trim();
  if (!key) return;
  if (once) {
    const dedupeKey = `${reason}:${key}`;
    if (__SEEN_FACE_NAME_MUTATION_BREAKS.has(dedupeKey)) return;
    __SEEN_FACE_NAME_MUTATION_BREAKS.add(dedupeKey);
  }
  // eslint-disable-next-line no-debugger
}

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
    breakOnFaceNameMutation(faceName || 'CORNER_WEDGE_BRIDGE', 'createHullSolidFromPoints._fromManifold');
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

function buildEdgeDerivedSideWallFaceName(entry, featureID = 'FILLET') {
  const edgeRawName = resolveBridgeEntryEdgeName(entry, `${featureID}_EDGE`);
  const edgeToken = sanitizeFaceNameToken(edgeRawName, 'EDGE');
  const edgeTokenShort = (edgeToken.length > 48) ? edgeToken.slice(0, 48) : edgeToken;
  const edgeHash = stableStringHash32(edgeRawName).toString(16).slice(-8).padStart(8, '0');
  return `${featureID}_FILLET_SIDEWALL_${edgeTokenShort}_${edgeHash}`;
}

function computeFilletEntryEndpointAdjacency(entries, endpointTol = 1e-5) {
  const out = new Map();
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => (
    !!entry
    && !!entry.edgeObj
    && !!entry.filletSolid
    && !entry.cornerBridge
  ));
  for (const entry of list) out.set(entry, { start: false, end: false });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const entryA = list[i];
      const entryB = list[j];
      const shared = resolveSharedEndpointInfo(entryA, entryB, endpointTol);
      if (!shared) continue;
      const aAdj = out.get(entryA);
      const bAdj = out.get(entryB);
      if (aAdj) {
        if ((shared.aEndIndex | 0) === 0) aAdj.start = true;
        else aAdj.end = true;
      }
      if (bAdj) {
        if ((shared.bEndIndex | 0) === 0) bAdj.start = true;
        else bAdj.end = true;
      }
    }
  }
  return out;
}

function mergeEntrySideWallFaces({
  entry = null,
  featureID = 'FILLET',
  includeStartCap = false,
  includeEndCap = false,
} = {}) {
  const solid = entry?.filletSolid;
  const filletName = entry?.filletName;
  if (!solid || typeof solid.getFaceNames !== 'function' || typeof solid.renameFace !== 'function') {
    return { mergedFaceName: null, mergedCount: 0, mergedFaces: [] };
  }
  if (!filletName || typeof filletName !== 'string') {
    return { mergedFaceName: null, mergedCount: 0, mergedFaces: [] };
  }

  const names = solid.getFaceNames();
  const faceSet = new Set((Array.isArray(names) ? names : []).filter((name) => typeof name === 'string'));
  const sideCandidates = [
    `${filletName}_SURFACE_CA`,
    `${filletName}_SURFACE_CB`,
    `${filletName}_FACE_A`,
    `${filletName}_FACE_B`,
    `${filletName}_WEDGE_A`,
    `${filletName}_WEDGE_B`,
    `${filletName}_SIDE_A`,
    `${filletName}_SIDE_B`,
  ];
  if (includeStartCap) sideCandidates.push(`${filletName}_END_CAP_1`);
  if (includeEndCap) sideCandidates.push(`${filletName}_END_CAP_2`);

  const candidates = sideCandidates.filter((name) => faceSet.has(name));
  if (candidates.length === 0) {
    return { mergedFaceName: null, mergedCount: 0, mergedFaces: [] };
  }

  const tubeOuterFaceName = `${filletName}_TUBE_Outer`;
  const targetFaceName = faceSet.has(tubeOuterFaceName)
    ? tubeOuterFaceName
    : buildEdgeDerivedSideWallFaceName(entry, featureID);
  if (faceSet.has(targetFaceName) && !candidates.includes(targetFaceName)) {
    candidates.unshift(targetFaceName);
  }

  const mergedFaces = [];
  for (const oldName of candidates) {
    if (!oldName || oldName === targetFaceName) continue;
    breakOnFaceNameMutation(targetFaceName, 'mergeEntrySideWallFaces.target', true);
    breakOnFaceNameMutation(oldName, 'mergeEntrySideWallFaces.source');
    solid.renameFace(oldName, targetFaceName);
    mergedFaces.push(oldName);
  }

  const edgeReference = resolveBridgeEntryEdgeName(entry, `${featureID}_EDGE`);
  solid.setFaceMetadata(targetFaceName, {
    filletMergedSideWall: true,
    filletSideWall: true,
    filletSideWallEdge: edgeReference,
    filletSideWallIncludesStartCap: !!includeStartCap,
    filletSideWallIncludesEndCap: !!includeEndCap,
  });

  return {
    mergedFaceName: targetFaceName,
    mergedCount: mergedFaces.length + (faceSet.has(targetFaceName) ? 0 : 1),
    mergedFaces,
  };
}

function mergeFilletEntrySideWallsByEdge({
  entries = [],
  featureID = 'FILLET',
  endpointTol = 1e-5,
  debug = false,
} = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => (
    !!entry
    && !!entry.edgeObj
    && !!entry.filletSolid
    && !entry.cornerBridge
  ));
  if (list.length === 0) {
    return { processedEntries: 0, mergedEntries: 0, mergedFaces: 0 };
  }

  const adjacency = computeFilletEntryEndpointAdjacency(list, endpointTol);
  let mergedEntries = 0;
  let mergedFaces = 0;

  for (const entry of list) {
    const adj = adjacency.get(entry) || { start: false, end: false };
    const result = mergeEntrySideWallFaces({
      entry,
      featureID,
      includeStartCap: !!adj.start,
      includeEndCap: !!adj.end,
    });
    if (result?.mergedFaceName) {
      mergedEntries += 1;
      mergedFaces += Number(result.mergedFaces?.length || 0);
      entry.sideWallFaceName = result.mergedFaceName;
      entry.sideWallMergedFaces = Array.isArray(result.mergedFaces) ? result.mergedFaces.slice() : [];
      entry.sideWallAdjacency = { start: !!adj.start, end: !!adj.end };
      if (Array.isArray(entry.mergeCandidates) && !entry.mergeCandidates.includes(result.mergedFaceName)) {
        entry.mergeCandidates.push(result.mergedFaceName);
      }
      if (debug) {
        console.log('[Solid.fillet] Merged fillet side-wall faces.', {
          featureID,
          filletName: entry.filletName,
          edge: resolveBridgeEntryEdgeName(entry, null),
          sideWallFaceName: result.mergedFaceName,
          mergedFaces: result.mergedFaces,
          includeStartCap: !!adj.start,
          includeEndCap: !!adj.end,
        });
      }
    }
  }

  return {
    processedEntries: list.length,
    mergedEntries,
    mergedFaces,
  };
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
  breakOnFaceNameMutation(unifiedName, 'collapseSolidToSingleFaceName.unified');
  solid._manifold = null;
  solid._triIDs = new Array(triCount).fill(unifiedID);
  solid._idToFaceName = new Map([[unifiedID, unifiedName]]);
  solid._faceNameToID = new Map([[unifiedName, unifiedID]]);
  solid._faceMetadata = new Map([[unifiedName, mergedMeta]]);
  solid._faceIndex = null;
  solid._dirty = true;
  return solid;
}

function relabelDisconnectedFaceComponents({
  solid = null,
  sourceFaceName = '',
  desiredNames = [],
  anchorPoints = [],
} = {}) {
  if (!solid || typeof sourceFaceName !== 'string' || sourceFaceName.length === 0) {
    return { componentCount: 0, names: [] };
  }

  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
  const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
  const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  if (!tv || !vp || !ids || !faceToId || !idToFace) {
    return { componentCount: 0, names: [] };
  }

  const sourceID = faceToId.get(sourceFaceName);
  if (sourceID === undefined) return { componentCount: 0, names: [] };

  const triCount = Math.min(ids.length, (tv.length / 3) | 0);
  if (triCount <= 0) return { componentCount: 0, names: [] };

  const sourceTriIndices = [];
  for (let t = 0; t < triCount; t++) {
    if ((ids[t] >>> 0) === (sourceID >>> 0)) sourceTriIndices.push(t);
  }
  if (sourceTriIndices.length === 0) return { componentCount: 0, names: [] };

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToTris = new Map();
  const triAdj = new Map();
  for (const t of sourceTriIndices) triAdj.set(t, []);

  for (const t of sourceTriIndices) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      let triList = edgeToTris.get(key);
      if (!triList) {
        triList = [];
        edgeToTris.set(key, triList);
      }
      triList.push(t);
    }
  }

  for (const triList of edgeToTris.values()) {
    if (!Array.isArray(triList) || triList.length < 2) continue;
    for (let i = 0; i < triList.length; i++) {
      for (let j = i + 1; j < triList.length; j++) {
        const a = triList[i];
        const b = triList[j];
        if (!triAdj.has(a) || !triAdj.has(b)) continue;
        triAdj.get(a).push(b);
        triAdj.get(b).push(a);
      }
    }
  }

  const visited = new Set();
  const components = [];
  const toPoint = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const triCentroid = (t) => {
    const base = t * 3;
    const ia = (tv[base + 0] >>> 0) * 3;
    const ib = (tv[base + 1] >>> 0) * 3;
    const ic = (tv[base + 2] >>> 0) * 3;
    const ax = Number(vp[ia + 0]) || 0;
    const ay = Number(vp[ia + 1]) || 0;
    const az = Number(vp[ia + 2]) || 0;
    const bx = Number(vp[ib + 0]) || 0;
    const by = Number(vp[ib + 1]) || 0;
    const bz = Number(vp[ib + 2]) || 0;
    const cx = Number(vp[ic + 0]) || 0;
    const cy = Number(vp[ic + 1]) || 0;
    const cz = Number(vp[ic + 2]) || 0;
    return toPoint(
      (ax + bx + cx) / 3,
      (ay + by + cy) / 3,
      (az + bz + cz) / 3,
    );
  };

  for (const seed of sourceTriIndices) {
    if (visited.has(seed)) continue;
    const queue = [seed];
    visited.add(seed);
    const tris = [];
    let minTri = seed;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sc = 0;

    while (queue.length > 0) {
      const t = queue.pop();
      tris.push(t);
      if (t < minTri) minTri = t;
      const c = triCentroid(t);
      sx += c.x;
      sy += c.y;
      sz += c.z;
      sc += 1;
      const neighbors = triAdj.get(t) || [];
      for (const n of neighbors) {
        if (visited.has(n)) continue;
        visited.add(n);
        queue.push(n);
      }
    }

    components.push({
      tris,
      minTri,
      center: (sc > 0) ? toPoint(sx / sc, sy / sc, sz / sc) : toPoint(0, 0, 0),
    });
  }

  if (components.length === 0) return { componentCount: 0, names: [] };
  components.sort((a, b) => a.minTri - b.minTri);

  const anchors = (Array.isArray(anchorPoints) ? anchorPoints : [])
    .map((p) => toPoint3Object(p))
    .filter(Boolean);
  let preferredNames = Array.isArray(desiredNames)
    ? desiredNames.map((n) => (typeof n === 'string' ? n.trim() : '')).filter((n) => n.length > 0)
    : [];

  if (components.length === 2 && preferredNames.length >= 2 && anchors.length >= 2) {
    const c0 = components[0].center;
    const c1 = components[1].center;
    const a0 = anchors[0];
    const a1 = anchors[1];
    const directScore = (distPoint3(c0, a0) || 0) + (distPoint3(c1, a1) || 0);
    const swappedScore = (distPoint3(c0, a1) || 0) + (distPoint3(c1, a0) || 0);
    if (Number.isFinite(swappedScore) && swappedScore < directScore) {
      preferredNames = [preferredNames[1], preferredNames[0], ...preferredNames.slice(2)];
    }
  }

  const reservedNames = new Set(faceToId.keys());
  reservedNames.delete(sourceFaceName);
  const makeUniqueName = (baseName, index) => {
    const fallback = `${sourceFaceName}_PART_${index + 1}`;
    const base = (typeof baseName === 'string' && baseName.length > 0) ? baseName : fallback;
    let candidate = base;
    let suffix = 2;
    while (reservedNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    reservedNames.add(candidate);
    return candidate;
  };

  const names = components.map((_, idx) => makeUniqueName(preferredNames[idx], idx));
  if (components.length === 1) {
    if (names[0] !== sourceFaceName) {
      breakOnFaceNameMutation(names[0], 'relabelDisconnectedFaceComponents.single_component');
      faceToId.delete(sourceFaceName);
      faceToId.set(names[0], sourceID);
      idToFace.set(sourceID, names[0]);
      if (solid._faceMetadata instanceof Map) {
        const meta = solid._faceMetadata.get(sourceFaceName);
        if (meta !== undefined) solid._faceMetadata.set(names[0], meta);
        solid._faceMetadata.delete(sourceFaceName);
      }
      solid._faceIndex = null;
      solid._dirty = true;
    }
    return { componentCount: 1, names };
  }

  let nextID = 0;
  for (const id of idToFace.keys()) {
    const num = Number(id);
    if (Number.isFinite(num) && num >= nextID) nextID = num + 1;
  }
  for (let t = 0; t < triCount; t++) {
    const id = Number(ids[t]);
    if (Number.isFinite(id) && id >= nextID) nextID = id + 1;
  }

  const metadataMap = solid._faceMetadata instanceof Map ? solid._faceMetadata : null;
  const sourceMeta = metadataMap ? metadataMap.get(sourceFaceName) : undefined;

  breakOnFaceNameMutation(names[0], 'relabelDisconnectedFaceComponents.primary_component');
  faceToId.delete(sourceFaceName);
  faceToId.set(names[0], sourceID);
  idToFace.set(sourceID, names[0]);

  if (metadataMap) {
    if (sourceMeta !== undefined) metadataMap.set(names[0], sourceMeta);
    metadataMap.delete(sourceFaceName);
  }

  for (let i = 1; i < components.length; i++) {
    const comp = components[i];
    while (idToFace.has(nextID)) nextID += 1;
    const newID = nextID;
    nextID += 1;
    for (const triIdx of comp.tris) ids[triIdx] = newID >>> 0;
    breakOnFaceNameMutation(names[i], 'relabelDisconnectedFaceComponents.additional_component');
    idToFace.set(newID, names[i]);
    faceToId.set(names[i], newID);
    if (metadataMap && sourceMeta !== undefined) {
      if (sourceMeta && typeof sourceMeta === 'object') metadataMap.set(names[i], { ...sourceMeta });
      else metadataMap.set(names[i], sourceMeta);
    }
  }

  solid._triIDs = ids;
  solid._faceNameToID = faceToId;
  solid._idToFaceName = idToFace;
  solid._faceIndex = null;
  solid._dirty = true;
  return { componentCount: components.length, names };
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
      const edgeTokenA = sanitizeFaceNameToken(sourceEdgeNameA, `EDGE_${i}`);
      const edgeTokenB = sanitizeFaceNameToken(sourceEdgeNameB, `EDGE_${j}`);
      const edgeHashA = stableStringHash32(sourceEdgeNameA).toString(16).slice(-6).padStart(6, '0');
      const edgeHashB = stableStringHash32(sourceEdgeNameB).toString(16).slice(-6).padStart(6, '0');
      const wedgeBridgeFaceNameA = `${cornerName}_WEDGE_BRIDGE_ON_${edgeTokenA}_${edgeHashA}`;
      const wedgeBridgeFaceNameB = `${cornerName}_WEDGE_BRIDGE_ON_${edgeTokenB}_${edgeHashB}`;

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
      const bridgeFaceRelabel = relabelDisconnectedFaceComponents({
        solid: finalSolid,
        sourceFaceName: wedgeBridgeName,
        desiredNames: [wedgeBridgeFaceNameA, wedgeBridgeFaceNameB],
        anchorPoints: [capA.wedgeCenter, capB.wedgeCenter],
      });
      const bridgeTransitionFaceNames = Array.isArray(bridgeFaceRelabel?.names)
        ? bridgeFaceRelabel.names
        : [];
      const bridgeMergeCandidates = getFilletMergeCandidateNames(finalSolid);
      for (const name of bridgeTransitionFaceNames) {
        if (!name || bridgeMergeCandidates.includes(name)) continue;
        bridgeMergeCandidates.push(name);
      }

      generated.push({
        filletSolid: finalSolid,
        filletName: cornerName,
        mergeCandidates: bridgeMergeCandidates,
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
          bridgeTransitionFaceNames,
          bridgeTransitionFaceComponents: Number(bridgeFaceRelabel?.componentCount) || 0,
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
 * @param {string} [opts.featureID='FILLET'] For naming of intermediates and result
 * @returns {import('../BetterSolid.js').Solid}
 */
export async function fillet(opts = {}) {
  const {
    filletSolid,
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
  const featureID = opts.featureID || 'FILLET';

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
  let cornerBridgeCount = 0;
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

  for (const e of unique) {
    const edgeRawName = (typeof e?.name === 'string' && e.name.trim().length > 0)
      ? e.name.trim()
      : `EDGE_${idx}`;
    const edgeToken = sanitizeFaceNameToken(edgeRawName, `EDGE_${idx}`);
    const edgeTokenShort = (edgeToken.length > 48) ? edgeToken.slice(0, 48) : edgeToken;
    const edgeHash = stableStringHash32(edgeRawName).toString(16).slice(-8).padStart(8, '0');
    const name = `${featureID}_FILLET_${edgeTokenShort}_${edgeHash}_${idx++}`;
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
  try {
    const sideWallEndpointTol = Math.max(
      1e-6,
      Math.min(1e-3, deriveSolidToleranceFromVerts(this, 1e-5)),
    );
    const sideWallMergeStats = mergeFilletEntrySideWallsByEdge({
      entries: filletEntries,
      featureID,
      endpointTol: sideWallEndpointTol,
      debug,
    });
    if (debug && sideWallMergeStats.mergedEntries > 0) {
      console.log('[Solid.fillet] Merged per-edge fillet side walls.', {
        featureID,
        ...sideWallMergeStats,
      });
    }
  } catch (err) {
    console.warn('[Solid.fillet] Failed to merge per-edge fillet side walls; continuing.', {
      featureID,
      error: err?.message || err,
    });
  }
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
    };
  } catch { }
  try { result.__filletCornerBridgeCount = cornerBridgeCount; } catch { }

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
      direction: directionMode,
      inflate,
    });
  }

  return result;
}

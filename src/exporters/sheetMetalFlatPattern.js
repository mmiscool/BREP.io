/**
 * Sheet Metal Flat Pattern generation (sketch path).
 *
 * See FLAT_PATTERN_REWRITE.md for behavior requirements.
 */

import { BREP } from "../BREP/BREP.js";
import { computeTriangleArea } from "../BREP/triangleUtils.js";
import { SHEET_METAL_FACE_TYPES } from "../features/sheetMetal/sheetMetalFaceTypes.js";

const EPS = 1e-6;
const ANGLE_EPS = 1e-8;
const GROUND_CONSTRAINT = "\u23DA";

function normalizeSolids(solids) {
  if (!solids) return [];
  return Array.isArray(solids) ? solids.filter(Boolean) : [solids].filter(Boolean);
}

function resolveSheetMetalSettings(solid, opts = {}) {
  const pickNum = (...values) => {
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const sm = solid?.userData?.sheetMetal || {};
  const thickness = pickNum(
    opts.thickness,
    sm.thickness,
    sm.baseThickness,
    solid?.userData?.sheetThickness,
  );
  const bendRadius = pickNum(
    opts.bendRadius,
    sm.bendRadius,
    sm.baseBendRadius,
    solid?.userData?.sheetBendRadius,
  );
  const neutralFactor = pickNum(
    opts.neutralFactor ?? opts.kFactor,
    sm.neutralFactor,
    sm.baseNeutralFactor,
    solid?.userData?.sheetMetalNeutralFactor,
  );
  return {
    thickness: Number.isFinite(thickness) && thickness > 0 ? Math.abs(thickness) : null,
    bendRadius: Number.isFinite(bendRadius) && bendRadius >= 0 ? bendRadius : null,
    neutralFactor: Number.isFinite(neutralFactor) ? Math.max(0, Math.min(1, neutralFactor)) : 0.5,
  };
}

function resolvePlanarAllowedTypes(faceData, opts = {}) {
  const raw = String(opts.planarFaceType ?? opts.flatFaceType ?? opts.sheetSide ?? "A").trim().toUpperCase();
  const allowBoth = raw === "BOTH" || raw === "ALL" || raw === "AB";
  const allowed = new Set();
  if (allowBoth) {
    allowed.add(SHEET_METAL_FACE_TYPES.A);
    allowed.add(SHEET_METAL_FACE_TYPES.B);
  } else if (raw === "B") {
    allowed.add(SHEET_METAL_FACE_TYPES.B);
  } else {
    allowed.add(SHEET_METAL_FACE_TYPES.A);
  }

  const hasAllowed = Array.from(faceData.values()).some((f) => allowed.has(f.sheetType));
  if (!hasAllowed && raw !== "BOTH" && raw !== "ALL" && raw !== "AB") {
    const fallback = raw === "B" ? SHEET_METAL_FACE_TYPES.A : SHEET_METAL_FACE_TYPES.B;
    const hasFallback = Array.from(faceData.values()).some((f) => f.sheetType === fallback);
    if (hasFallback && opts.allowPlanarFallback === true) {
      allowed.add(fallback);
    }
  }
  return allowed;
}

function axisGroupKey(axisDir, center) {
  const axis = axisDir.clone();
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  let sign = 1;
  if (az >= ax && az >= ay) sign = axis.z < 0 ? -1 : 1;
  else if (ay >= ax) sign = axis.y < 0 ? -1 : 1;
  else sign = axis.x < 0 ? -1 : 1;
  axis.multiplyScalar(sign);
  const t = center.dot(axis);
  const offset = center.clone().addScaledVector(axis, -t);
  return [
    axis.x.toFixed(4),
    axis.y.toFixed(4),
    axis.z.toFixed(4),
    offset.x.toFixed(3),
    offset.y.toFixed(3),
    offset.z.toFixed(3),
    t.toFixed(2),
  ].join("|");
}

function filterCylindricalFaces(faceData, planarAllowed, edgesByFace, opts = {}) {
  const bendSideRaw = String(opts.bendRadiusSide ?? opts.bendSide ?? "smaller").trim().toLowerCase();
  const bendSide = bendSideRaw === "larger" || bendSideRaw === "smaller" ? bendSideRaw : "smaller";
  const cylindrical = Array.from(faceData.values()).filter((f) => f.kind === "cylindrical");
  if (cylindrical.length <= 1) return;

  const allowedTypes = new Set(
    Array.from(planarAllowed || []).filter((t) => t === SHEET_METAL_FACE_TYPES.A || t === SHEET_METAL_FACE_TYPES.B),
  );
  const adjacentToPlanar = new Set();
  if (edgesByFace && allowedTypes.size) {
    for (const face of cylindrical) {
      const edges = edgesByFace.get(face.name) || [];
      for (const edge of edges) {
        const other = edge.faceA === face.name ? edge.faceB : edge.faceA;
        const otherData = faceData.get(other);
        if (otherData?.kind === "planar" && allowedTypes.has(otherData.sheetType)) {
          adjacentToPlanar.add(face.name);
          break;
        }
      }
    }
  }

  const groups = new Map();
  for (const face of cylindrical) {
    const key = face.bendKey || (face.axisDir && face.center ? axisGroupKey(face.axisDir, face.center) : face.name);
    const list = groups.get(key) || [];
    list.push(face);
    groups.set(key, list);
  }

  const keep = new Set();
  for (const faces of groups.values()) {
    if (faces.length <= 1) {
      for (const face of faces) keep.add(face.name);
      continue;
    }
    const valid = faces.filter((f) => Number.isFinite(f.radius));
    if (!valid.length) {
      for (const face of faces) keep.add(face.name);
      continue;
    }
    let chosen = valid[0];
    for (const face of valid) {
      if (bendSide === "larger") {
        if (face.radius > chosen.radius) chosen = face;
      } else if (face.radius < chosen.radius) {
        chosen = face;
      }
    }
    if (adjacentToPlanar.size && !adjacentToPlanar.has(chosen.name)) {
      const adjacent = valid.filter((f) => adjacentToPlanar.has(f.name));
      if (adjacent.length) {
        let adjChosen = adjacent[0];
        for (const face of adjacent) {
          if (bendSide === "larger") {
            if (face.radius > adjChosen.radius) adjChosen = face;
          } else if (face.radius < adjChosen.radius) {
            adjChosen = face;
          }
        }
        chosen = adjChosen;
      }
    }
    keep.add(chosen.name);
  }

  for (const face of cylindrical) {
    if (!keep.has(face.name)) faceData.delete(face.name);
  }
}

function computeFaceNormalAndOrigin(triangles, matrixWorld, THREE) {
  const n = new THREE.Vector3();
  const accum = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let count = 0;
  for (const tri of triangles) {
    a.fromArray(tri.p1).applyMatrix4(matrixWorld);
    b.fromArray(tri.p2).applyMatrix4(matrixWorld);
    c.fromArray(tri.p3).applyMatrix4(matrixWorld);
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    n.add(ac.cross(ab));
    accum.add(a).add(b).add(c);
    count += 3;
  }
  if (n.lengthSq() < 1e-14) return { normal: null, origin: null };
  n.normalize();
  const origin = count ? accum.multiplyScalar(1 / count) : new THREE.Vector3();
  return { normal: n, origin };
}

function computeFaceArea(triangles, matrixWorld, THREE) {
  let area = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const tri of triangles) {
    a.fromArray(tri.p1).applyMatrix4(matrixWorld);
    b.fromArray(tri.p2).applyMatrix4(matrixWorld);
    c.fromArray(tri.p3).applyMatrix4(matrixWorld);
    area += computeTriangleArea(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  return area;
}

function computeCylRadiusFromTriangles(triangles, axisDir, center, matrixWorld, THREE) {
  const a = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let sum = 0;
  let count = 0;
  for (const tri of triangles) {
    for (const p of [tri.p1, tri.p2, tri.p3]) {
      a.fromArray(p).applyMatrix4(matrixWorld);
      const t = a.clone().sub(center).dot(axisDir);
      tmp.copy(center).addScaledVector(axisDir, t);
      const r = a.distanceTo(tmp);
      if (Number.isFinite(r)) {
        sum += r;
        count += 1;
      }
    }
  }
  if (!count) return null;
  return sum / count;
}

function pickPlanarBasis(normal, hintDir, THREE) {
  const axisU = new THREE.Vector3();
  const safeNormal = normal && normal.lengthSq() > 1e-12 ? normal : new THREE.Vector3(0, 0, 1);
  if (hintDir && hintDir.lengthSq() > 1e-12) {
    axisU.copy(hintDir);
  } else {
    const fallback = Math.abs(safeNormal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    axisU.crossVectors(fallback, safeNormal);
  }
  if (axisU.lengthSq() < 1e-12) axisU.set(1, 0, 0);
  axisU.normalize();
  const axisV = new THREE.Vector3().crossVectors(safeNormal, axisU).normalize();
  return { axisU, axisV };
}

function mapPointToPlane(point, origin, axisU, axisV, THREE) {
  const safeOrigin = origin && origin.isVector3 ? origin : new THREE.Vector3();
  const v = new THREE.Vector3().copy(point).sub(safeOrigin);
  return { x: v.dot(axisU), y: v.dot(axisV) };
}

function mapPolylineToPlane(polyline, origin, axisU, axisV, THREE) {
  return polyline.map((p) => mapPointToPlane(p, origin, axisU, axisV, THREE));
}

function computeCylAngle(axisDir, refDir, radial) {
  const cos = Math.max(-1, Math.min(1, refDir.dot(radial)));
  const cross = refDir.clone().cross(radial);
  const sin = axisDir.dot(cross);
  return Math.atan2(sin, cos);
}

function unwrapAngles(angles) {
  if (!angles.length) return [];
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let a = angles[i];
    let prev = out[i - 1];
    let delta = a - prev;
    while (delta > Math.PI) { a -= Math.PI * 2; delta = a - prev; }
    while (delta < -Math.PI) { a += Math.PI * 2; delta = a - prev; }
    out.push(a);
  }
  return out;
}

function mapPolylineToCylinder(polyline, cyl, THREE) {
  const { axisDir, center, radius, refDir } = cyl;
  const useRadius = Number.isFinite(radius) ? radius : null;
  const uVals = [];
  const angles = [];
  let radiusSum = 0;
  let radiusCount = 0;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  for (const p of polyline) {
    const v = tmp.copy(p).sub(center);
    const t = v.dot(axisDir);
    uVals.push(t);
    proj.copy(center).addScaledVector(axisDir, t);
    const radial = tmp.copy(p).sub(proj);
    const rLen = radial.length();
    if (Number.isFinite(rLen) && rLen > EPS) {
      radiusSum += rLen;
      radiusCount += 1;
    }
    if (radial.lengthSq() < 1e-16) {
      angles.push(0);
      continue;
    }
    radial.normalize();
    angles.push(computeCylAngle(axisDir, refDir, radial));
  }
  const unwrapped = unwrapAngles(angles);
  const finalRadius = useRadius != null
    ? useRadius
    : (radiusCount ? radiusSum / radiusCount : 1);
  const points = [];
  for (let i = 0; i < uVals.length; i++) {
    points.push({ x: uVals[i], y: unwrapped[i] * finalRadius });
  }
  return points;
}

function resolveBendScale(faceData, settings, insideRadiusOverride = null) {
  const actualRadius = faceData.radius;
  const thickness = settings.thickness;
  const k = settings.neutralFactor;
  if (!Number.isFinite(actualRadius) || actualRadius <= 0) {
    return { scale: 1, neutralRadius: null, inside: null, insideRadius: null };
  }
  if (!Number.isFinite(thickness) || thickness <= 0) {
    return { scale: 1, neutralRadius: null, inside: null, insideRadius: null };
  }
  let insideRadius = Number.isFinite(insideRadiusOverride) ? insideRadiusOverride : settings.bendRadius;
  if (!Number.isFinite(insideRadius) || insideRadius <= 0) insideRadius = actualRadius;
  const outsideRadius = insideRadius + thickness;
  const diffInside = Math.abs(actualRadius - insideRadius);
  const diffOutside = Math.abs(actualRadius - outsideRadius);
  const inside = diffInside <= diffOutside;
  let neutralRadius = insideRadius + k * thickness;
  if (!Number.isFinite(neutralRadius) || neutralRadius <= EPS) neutralRadius = actualRadius;
  const scale = neutralRadius / actualRadius;
  return { scale, neutralRadius, inside, insideRadius };
}

function edgeEndpoints(points) {
  if (!points || points.length < 2) return null;
  const a = points[0];
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (Math.abs(b.x - a.x) > EPS || Math.abs(b.y - a.y) > EPS) {
      return { a, b };
    }
  }
  return null;
}

function computeRotationAndTranslation(a0, a1, b0, b1) {
  const vx = a1.x - a0.x;
  const vy = a1.y - a0.y;
  const wx = b1.x - b0.x;
  const wy = b1.y - b0.y;
  const vLen = Math.hypot(vx, vy);
  const wLen = Math.hypot(wx, wy);
  if (vLen < EPS || wLen < EPS) return null;
  const cos = (vx * wx + vy * wy) / (vLen * wLen);
  const sin = (vx * wy - vy * wx) / (vLen * wLen);
  const tx = b0.x - (cos * a0.x - sin * a0.y);
  const ty = b0.y - (sin * a0.x + cos * a0.y);
  return { cos, sin, tx, ty };
}

function reflectPointAcrossLine(point, lineA, lineB) {
  const dx = lineB.x - lineA.x;
  const dy = lineB.y - lineA.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: point.x, y: point.y };
  const t = ((point.x - lineA.x) * dx + (point.y - lineA.y) * dy) / len2;
  const projX = lineA.x + t * dx;
  const projY = lineA.y + t * dy;
  return { x: projX * 2 - point.x, y: projY * 2 - point.y };
}

function applyPlacement(placement, point) {
  const scale = placement.scale ?? 1;
  const anchorV = placement.anchorV;
  const v = Number.isFinite(anchorV)
    ? anchorV + (point.y - anchorV) * scale
    : point.y * scale;
  const x = placement.cos * point.x - placement.sin * v + placement.tx;
  const y = placement.sin * point.x + placement.cos * v + placement.ty;
  const out = { x, y };
  if (placement.reflect && placement.reflectLine) {
    return reflectPointAcrossLine(out, placement.reflectLine.a, placement.reflectLine.b);
  }
  return out;
}

function computeSideSign(lineA, lineB, point) {
  const dx = lineB.x - lineA.x;
  const dy = lineB.y - lineA.y;
  return dx * (point.y - lineA.y) - dy * (point.x - lineA.x);
}

function buildFaceCentroid(points) {
  if (!points || !points.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function computePolylineCentroid(points) {
  if (!points || !points.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function computePolylineLength(points) {
  if (!points || points.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.hypot(dx, dy);
  }
  return len;
}

function computePolylineBounds(points) {
  if (!points || !points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function buildBendCenterline(edgeInfos, faceBounds = null) {
  if (!Array.isArray(edgeInfos) || edgeInfos.length === 0) return null;
  const axisCandidates = edgeInfos.filter((info) => {
    const bounds = info.bounds || computePolylineBounds(info.points);
    return (bounds.maxX - bounds.minX) >= (bounds.maxY - bounds.minY);
  });
  const candidates = axisCandidates.length ? axisCandidates : edgeInfos;

  if (candidates.length >= 2) {
    let bestPair = null;
    let bestDist = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        const dx = a.centroid.x - b.centroid.x;
        const dy = a.centroid.y - b.centroid.y;
        const dist = dx * dx + dy * dy;
        if (dist > bestDist) {
          bestDist = dist;
          bestPair = [a, b];
        }
      }
    }
    if (!bestPair || bestDist < EPS * EPS) return null;
    const [a, b] = bestPair;
    const template = (a.length || 0) >= (b.length || 0) ? a : b;
    const mid = {
      x: (a.centroid.x + b.centroid.x) * 0.5,
      y: (a.centroid.y + b.centroid.y) * 0.5,
    };
    const offset = {
      x: mid.x - template.centroid.x,
      y: mid.y - template.centroid.y,
    };
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
    return template.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
  }

  if (!faceBounds) return null;
  const template = candidates.reduce((best, curr) => (curr.length > (best?.length || 0) ? curr : best), candidates[0]);
  const midY = (faceBounds.minY + faceBounds.maxY) * 0.5;
  const offsetY = midY - template.centroid.y;
  if (!Number.isFinite(offsetY)) return null;
  return template.points.map((p) => ({ x: p.x, y: p.y + offsetY }));
}

function collectLocalPoints(faceData, edgesByFace, mapEdgeToLocal) {
  const edges = edgesByFace.get(faceData.name) || [];
  const points = [];
  for (const edge of edges) {
    const local = mapEdgeToLocal(faceData, edge);
    if (!local || !local.points) continue;
    for (const p of local.points) points.push(p);
  }
  return points;
}

function buildSketchFromEdges(edgePolylines, opts = {}) {
  const precision = Number.isFinite(opts.precision) ? Math.max(0, opts.precision) : 6;
  const keyFor = (x, y) => `${x.toFixed(precision)},${y.toFixed(precision)}`;
  const points = [];
  const pointMap = new Map();
  const geometries = [];
  const segmentMap = new Map();
  let pointId = 0;
  let geomId = 0;

  const getPointId = (pt) => {
    const key = keyFor(pt.x, pt.y);
    if (pointMap.has(key)) return pointMap.get(key);
    const id = pointId++;
    points.push({ id, x: pt.x, y: pt.y, fixed: true });
    pointMap.set(key, id);
    return id;
  };

  const addSegment = (a, b, construction) => {
    const aId = getPointId(a);
    const bId = getPointId(b);
    if (aId === bId) return;
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
    if (segmentMap.has(key)) {
      if (construction) {
        const idx = segmentMap.get(key);
        if (geometries[idx] && !geometries[idx].construction) geometries[idx].construction = true;
      }
      return;
    }
    segmentMap.set(key, geomId);
    geometries.push({
      id: geomId++,
      type: "line",
      points: [aId, bId],
      construction: !!construction,
    });
  };

  for (const poly of edgePolylines) {
    let pointsList = null;
    let construction = false;
    if (Array.isArray(poly)) {
      pointsList = poly;
    } else if (poly && Array.isArray(poly.points)) {
      pointsList = poly.points;
      construction = !!poly.construction;
    }
    if (!Array.isArray(pointsList) || pointsList.length < 2) continue;
    for (let i = 0; i < pointsList.length - 1; i++) {
      addSegment(pointsList[i], pointsList[i + 1], construction);
    }
  }

  const constraints = [];
  let originId = null;
  const originKey = keyFor(0, 0);
  if (pointMap.has(originKey)) {
    originId = pointMap.get(originKey);
  } else {
    originId = pointId++;
    points.push({ id: originId, x: 0, y: 0, fixed: true });
    pointMap.set(originKey, originId);
  }
  constraints.push({ id: 0, type: GROUND_CONSTRAINT, points: [originId] });

  return { points, geometries, constraints };
}

function buildFlatPatternForSolid(solid, opts = {}) {
  const THREE = BREP.THREE;
  const settings = resolveSheetMetalSettings(solid, opts);
  const matrixWorld = solid?.matrixWorld && solid.matrixWorld.isMatrix4
    ? solid.matrixWorld
    : new THREE.Matrix4();

  const faceData = new Map();
  const faceSheetTypes = new Map();
  const faceNames = typeof solid?.getFaceNames === "function" ? solid.getFaceNames() : [];
  for (const name of faceNames) {
    const triangles = solid.getFace(name);
    if (!Array.isArray(triangles) || !triangles.length) continue;
    const meta = solid.getFaceMetadata(name) || {};
    const sheetType = meta.sheetMetalFaceType || null;
    const { normal, origin } = computeFaceNormalAndOrigin(triangles, matrixWorld, THREE);
    const area = computeFaceArea(triangles, matrixWorld, THREE);
    faceSheetTypes.set(name, sheetType);
    faceData.set(name, {
      name,
      meta,
      sheetType,
      triangles,
      normal,
      origin,
      area,
      kind: null,
      axisDir: null,
      center: null,
      radius: null,
      refDir: null,
      basisU: null,
      basisV: null,
      scale: 1,
      neutralRadius: null,
      inside: null,
      bendKey: null,
      includeInFlat: false,
      localEdges: new Map(),
      placedEdges: new Map(),
      centroidLocal: null,
      localBounds: null,
      centroidPlaced: null,
      bounds: null,
      placement: null,
    });
  }

  const edgePolylines = typeof solid?.getBoundaryEdgePolylines === "function"
    ? (solid.getBoundaryEdgePolylines() || [])
    : [];
  const edges = [];
  for (const edge of edgePolylines) {
    const positions = Array.isArray(edge?.positions) ? edge.positions : [];
    if (positions.length < 2) continue;
    const pts = positions.map((p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(matrixWorld);
      return v;
    });
    edges.push({
      key: edge?.name || `${edge?.faceA || "FACE"}|${edge?.faceB || "FACE"}`,
      faceA: edge.faceA,
      faceB: edge.faceB,
      points: pts,
      closedLoop: !!edge.closedLoop,
    });
  }

  const edgesByFace = new Map();
  for (const edge of edges) {
    if (faceData.has(edge.faceA)) {
      const list = edgesByFace.get(edge.faceA) || [];
      list.push(edge);
      edgesByFace.set(edge.faceA, list);
    }
    if (faceData.has(edge.faceB)) {
      const list = edgesByFace.get(edge.faceB) || [];
      list.push(edge);
      edgesByFace.set(edge.faceB, list);
    }
  }

  const planarAllowed = resolvePlanarAllowedTypes(faceData, opts);
  const isSheetPlanar = (type) => type === SHEET_METAL_FACE_TYPES.A || type === SHEET_METAL_FACE_TYPES.B;
  // Identify planar faces (A/B) for bend detection; keep includeInFlat for A-only output.
  let planarCount = 0;
  for (const data of faceData.values()) {
    if (!isSheetPlanar(data.sheetType)) continue;
    if (data.meta?.type === "cylindrical") continue;
    if (data.kind) continue;
    data.kind = "planar";
    data.includeInFlat = planarAllowed.has(data.sheetType);
    planarCount += 1;
  }
  if (planarCount === 0) {
    const candidates = [];
    for (const data of faceData.values()) {
      if (data.kind) continue;
      if (data.meta?.type === "cylindrical") continue;
      if (!data.normal || data.normal.lengthSq() < 1e-12) continue;
      candidates.push(data);
    }
    if (!candidates.length) {
      for (const data of faceData.values()) {
        if (data.kind) continue;
        if (data.meta?.type === "cylindrical") continue;
        if (!data.normal || data.normal.lengthSq() < 1e-12) continue;
        candidates.push(data);
      }
    }
    if (!candidates.length) {
      for (const data of faceData.values()) {
        if (data.kind) continue;
        if (!data.normal || data.normal.lengthSq() < 1e-12) continue;
        candidates.push(data);
      }
    }
    if (candidates.length) {
      const base = candidates.reduce((best, curr) => (curr.area > (best?.area || 0) ? curr : best), candidates[0]);
      const baseNormal = base.normal.clone().normalize();
      const cosTol = Number.isFinite(opts.fallbackPlanarNormalDot) ? opts.fallbackPlanarNormalDot : 0.95;
      const sameDir = [];
      const oppositeDir = [];
      for (const data of candidates) {
        const dot = baseNormal.dot(data.normal);
        if (dot >= cosTol) sameDir.push(data);
        else if (dot <= -cosTol) oppositeDir.push(data);
      }
      for (const data of sameDir) {
        data.kind = "planar";
        data.sheetType = SHEET_METAL_FACE_TYPES.A;
        data.includeInFlat = planarAllowed.has(SHEET_METAL_FACE_TYPES.A);
      }
      for (const data of oppositeDir) {
        data.kind = "planar";
        data.sheetType = SHEET_METAL_FACE_TYPES.B;
        data.includeInFlat = planarAllowed.has(SHEET_METAL_FACE_TYPES.B);
      }
      planarCount = sameDir.length + oppositeDir.length;
    }
  }

  // Identify cylindrical bend faces.
  for (const data of faceData.values()) {
    if (data.kind) continue;
    if (data.sheetType === SHEET_METAL_FACE_TYPES.THICKNESS) continue;
    if (data.meta?.type !== "cylindrical") continue;
    const axis = Array.isArray(data.meta.axis) ? data.meta.axis : null;
    const center = Array.isArray(data.meta.center) ? data.meta.center : null;
    if (!axis || !center) continue;
    const axisDir = new THREE.Vector3(axis[0], axis[1], axis[2]);
    if (axisDir.lengthSq() < 1e-12) continue;
    axisDir.normalize();
    const centerVec = new THREE.Vector3(center[0], center[1], center[2]);
    const neighborFaces = edgesByFace.get(data.name) || [];
    let isBend = false;
    for (const edge of neighborFaces) {
      const other = edge.faceA === data.name ? edge.faceB : edge.faceA;
      const otherData = faceData.get(other);
      if (!otherData || otherData.kind !== "planar" || !otherData.normal) continue;
      const dot = Math.abs(axisDir.dot(otherData.normal));
      if (dot < 0.3) {
        isBend = true;
        break;
      }
    }
    if (!isBend) continue;
    data.kind = "cylindrical";
    data.axisDir = axisDir;
    data.center = centerVec;
    data.bendKey = axisGroupKey(axisDir, centerVec);
    const radius = Number.isFinite(data.meta.radius) ? data.meta.radius : null;
    data.radius = radius != null
      ? radius
      : computeCylRadiusFromTriangles(data.triangles, axisDir, centerVec, matrixWorld, THREE);
  }

  // Drop faces that are not planar or cylindrical bends.
  for (const [name, data] of faceData.entries()) {
    if (data.kind !== "planar" && data.kind !== "cylindrical") {
      faceData.delete(name);
    }
  }

  const bendInsideRadius = new Map();
  for (const data of faceData.values()) {
    if (data.kind !== "cylindrical") continue;
    const key = data.bendKey || (data.axisDir && data.center ? axisGroupKey(data.axisDir, data.center) : null);
    if (!key || !Number.isFinite(data.radius)) continue;
    const current = bendInsideRadius.get(key);
    if (current == null || data.radius < current) bendInsideRadius.set(key, data.radius);
  }

  filterCylindricalFaces(faceData, planarAllowed, edgesByFace, opts);

  for (const data of faceData.values()) {
    if (data.kind !== "cylindrical") continue;
    const key = data.bendKey || (data.axisDir && data.center ? axisGroupKey(data.axisDir, data.center) : null);
    const scaleInfo = resolveBendScale(data, settings, key ? bendInsideRadius.get(key) : null);
    data.scale = scaleInfo.scale;
    data.neutralRadius = scaleInfo.neutralRadius;
    data.inside = scaleInfo.inside;
    data.insideRadius = scaleInfo.insideRadius;
  }

  for (const [name, data] of faceData.entries()) {
    if (data.kind === "planar" && !data.includeInFlat) {
      faceData.delete(name);
    }
  }

  const mapEdgeToLocal = (face, edge) => {
    if (face.localEdges.has(edge.key)) return face.localEdges.get(edge.key);
    let points = [];
    let anchorV = null;
    if (face.kind === "planar") {
      if (!face.basisU || !face.basisV) {
        const hint = edge?.points?.length >= 2
          ? edge.points[1].clone().sub(edge.points[0])
          : null;
        const basis = pickPlanarBasis(face.normal, hint, THREE);
        face.basisU = basis.axisU;
        face.basisV = basis.axisV;
      }
      points = mapPolylineToPlane(edge.points, face.origin, face.basisU, face.basisV, THREE);
    } else if (face.kind === "cylindrical") {
      if (!face.refDir) {
        let ref = null;
        if (edge?.points?.length) {
          const p = edge.points[0];
          const v = new THREE.Vector3().copy(p).sub(face.center);
          const t = v.dot(face.axisDir);
          const proj = face.center.clone().addScaledVector(face.axisDir, t);
          ref = new THREE.Vector3().copy(p).sub(proj);
        }
        if (!ref || ref.lengthSq() < 1e-12) {
          const fallback = Math.abs(face.axisDir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          ref = new THREE.Vector3().crossVectors(face.axisDir, fallback);
        }
        if (ref.lengthSq() < 1e-12) ref.set(1, 0, 0);
        ref.normalize();
        face.refDir = ref;
      }
      points = mapPolylineToCylinder(edge.points, face, THREE);
      if (points.length) {
        let sum = 0;
        for (const p of points) sum += p.y;
        anchorV = sum / points.length;
      }
    }
    const entry = { points, anchorV };
    face.localEdges.set(edge.key, entry);
    return entry;
  };

  // Prepare local centroids.
  for (const data of faceData.values()) {
    const points = collectLocalPoints(data, edgesByFace, mapEdgeToLocal);
    data.centroidLocal = buildFaceCentroid(points);
    data.localBounds = computePolylineBounds(points);
  }

  const adjacency = new Map();
  for (const edge of edges) {
    if (!faceData.has(edge.faceA) || !faceData.has(edge.faceB)) continue;
    const listA = adjacency.get(edge.faceA) || [];
    listA.push({ neighbor: edge.faceB, edge });
    adjacency.set(edge.faceA, listA);
    const listB = adjacency.get(edge.faceB) || [];
    listB.push({ neighbor: edge.faceA, edge });
    adjacency.set(edge.faceB, listB);
  }

  const placed = new Map();
  const faceOrder = Array.from(faceData.values());
  const unplaced = new Set(faceOrder.map((f) => f.name));

  const pickBaseFace = (list) => {
    const planarA = list.filter((f) => f.sheetType === SHEET_METAL_FACE_TYPES.A);
    if (planarA.length) return planarA.sort((a, b) => b.area - a.area)[0];
    const planarB = list.filter((f) => f.sheetType === SHEET_METAL_FACE_TYPES.B);
    if (planarB.length) return planarB.sort((a, b) => b.area - a.area)[0];
    return list.sort((a, b) => b.area - a.area)[0] || null;
  };

  const components = [];
  while (unplaced.size) {
    const remaining = faceOrder.filter((f) => unplaced.has(f.name));
    const base = pickBaseFace(remaining);
    if (!base) break;
    const basePlacement = { cos: 1, sin: 0, tx: 0, ty: 0, scale: 1, anchorV: null, reflect: false };
    base.placement = basePlacement;
    base.centroidPlaced = applyPlacement(basePlacement, base.centroidLocal);
    placed.set(base.name, basePlacement);
    unplaced.delete(base.name);
    const queue = [base.name];
    const componentFaces = [base.name];

    while (queue.length) {
      const current = queue.shift();
      const currentData = faceData.get(current);
      const neighbors = adjacency.get(current) || [];
      for (const { neighbor, edge } of neighbors) {
        if (!unplaced.has(neighbor)) continue;
        const neighborData = faceData.get(neighbor);
        if (!neighborData) continue;

        const parentEdgeLocal = mapEdgeToLocal(currentData, edge);
        const neighborEdgeLocal = mapEdgeToLocal(neighborData, edge);
        if (!parentEdgeLocal?.points?.length || !neighborEdgeLocal?.points?.length) continue;

        const parentEdgePlaced = parentEdgeLocal.points.map((p) => applyPlacement(currentData.placement, p));
        const parentEndpoints = edgeEndpoints(parentEdgePlaced);
        const neighborEndpoints = edgeEndpoints(neighborEdgeLocal.points);
        if (!parentEndpoints || !neighborEndpoints) continue;

        const anchorV = neighborEdgeLocal.anchorV;
        const scale = neighborData.kind === "cylindrical" ? neighborData.scale : 1;

        const scaledNeighborA = {
          x: neighborEndpoints.a.x,
          y: Number.isFinite(anchorV) ? anchorV + (neighborEndpoints.a.y - anchorV) * scale : neighborEndpoints.a.y,
        };
        const scaledNeighborB = {
          x: neighborEndpoints.b.x,
          y: Number.isFinite(anchorV) ? anchorV + (neighborEndpoints.b.y - anchorV) * scale : neighborEndpoints.b.y,
        };

        const rotations = [
          computeRotationAndTranslation(scaledNeighborA, scaledNeighborB, parentEndpoints.a, parentEndpoints.b),
          computeRotationAndTranslation(scaledNeighborA, scaledNeighborB, parentEndpoints.b, parentEndpoints.a),
        ].filter(Boolean);

        if (!rotations.length) continue;

        const lineA = parentEndpoints.a;
        const lineB = parentEndpoints.b;
        const parentSign = computeSideSign(lineA, lineB, currentData.centroidPlaced);
        const candidates = [];
        for (const rot of rotations) {
          const basePlacementCandidate = {
            cos: rot.cos,
            sin: rot.sin,
            tx: rot.tx,
            ty: rot.ty,
            scale,
            anchorV,
            reflect: false,
          };
          candidates.push({ placement: basePlacementCandidate, reflect: false });
          candidates.push({
            placement: {
              ...basePlacementCandidate,
              reflect: true,
              reflectLine: { a: lineA, b: lineB },
            },
            reflect: true,
          });
        }

        let chosen = null;
        let bestScore = -Infinity;
        for (const cand of candidates) {
          const centroidPlaced = applyPlacement(cand.placement, neighborData.centroidLocal);
          const sign = computeSideSign(lineA, lineB, centroidPlaced);
          let score = Math.abs(sign);
          if (Math.abs(parentSign) > ANGLE_EPS) {
            const opposite = sign * parentSign < 0;
            score = opposite ? score + 1 : score - 1;
          }
          if (score > bestScore) {
            bestScore = score;
            chosen = cand.placement;
          }
        }

        if (!chosen) continue;
        neighborData.placement = chosen;
        neighborData.centroidPlaced = applyPlacement(chosen, neighborData.centroidLocal);
        placed.set(neighbor, chosen);
        unplaced.delete(neighbor);
        queue.push(neighbor);
        componentFaces.push(neighbor);
      }
    }

    components.push(componentFaces);
  }

  // Apply spacing between disconnected components.
  const placedFaces = Array.from(placed.keys()).map((name) => faceData.get(name)).filter(Boolean);

  const updateBoundsFromFace = (face) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const edges = edgesByFace.get(face.name) || [];
    for (const edge of edges) {
      const local = mapEdgeToLocal(face, edge);
      const placedPts = local.points.map((p) => applyPlacement(face.placement, p));
      face.placedEdges.set(edge.key, placedPts);
      for (const p of placedPts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = 0; maxY = 0;
    }
    face.bounds = { minX, minY, maxX, maxY };
    return face.bounds;
  };

  for (const face of placedFaces) {
    updateBoundsFromFace(face);
  }

  const bendEdges = new Set();
  const bendEdgesByFace = new Map();
  const bendEdgeTol = Number.isFinite(opts.bendEdgeTol) ? opts.bendEdgeTol : 1e-4;
  for (const face of placedFaces) {
    if (face.kind !== "cylindrical") continue;
    const edgesForFace = edgesByFace.get(face.name) || [];
    const candidates = new Map();
    const addCandidate = (key, pts) => {
      if (!key || !Array.isArray(pts) || pts.length < 2) return;
      if (candidates.has(key)) return;
      candidates.set(key, {
        key,
        points: pts,
        length: computePolylineLength(pts),
      });
    };
    for (const edge of edgesForFace) {
      const local = mapEdgeToLocal(face, edge);
      const pts = local?.points;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const bounds = computePolylineBounds(pts);
      const xRange = bounds.maxX - bounds.minX;
      const yRange = bounds.maxY - bounds.minY;
      const tol = Math.max(bendEdgeTol, xRange * 1e-3);
      if (yRange <= tol) addCandidate(edge.key, pts);
    }
    if (candidates.size < 2) {
      for (const edge of edgesForFace) {
        const other = edge.faceA === face.name ? edge.faceB : edge.faceA;
        const otherType = faceSheetTypes.get(other);
        if (otherType === SHEET_METAL_FACE_TYPES.A || otherType === SHEET_METAL_FACE_TYPES.B) {
          const local = mapEdgeToLocal(face, edge);
          addCandidate(edge.key, local?.points);
        }
      }
    }
    if (candidates.size < 2) {
      for (const edge of edgesForFace) {
        const local = mapEdgeToLocal(face, edge);
        addCandidate(edge.key, local?.points);
      }
    }
    const picked = Array.from(candidates.values()).sort((a, b) => b.length - a.length).slice(0, 2);
    if (!picked.length) continue;
    for (const entry of picked) bendEdges.add(entry.key);
    bendEdgesByFace.set(face.name, picked);
  }

  const componentMargin = Number.isFinite(opts.componentMargin) ? opts.componentMargin : 10;
  let runningMaxX = null;
  for (let i = 0; i < components.length; i++) {
    const names = components[i];
    if (!names || !names.length) continue;
    let compMinX = Infinity;
    let compMaxX = -Infinity;
    for (const name of names) {
      const face = faceData.get(name);
      if (!face?.bounds) continue;
      compMinX = Math.min(compMinX, face.bounds.minX);
      compMaxX = Math.max(compMaxX, face.bounds.maxX);
    }
    if (!Number.isFinite(compMinX) || !Number.isFinite(compMaxX)) continue;
    const offsetX = i === 0 || runningMaxX == null
      ? 0
      : runningMaxX - compMinX + componentMargin;
    if (Math.abs(offsetX) > EPS) {
      for (const name of names) {
        const face = faceData.get(name);
        if (!face?.placement) continue;
        face.placement.tx += offsetX;
        face.centroidPlaced = applyPlacement(face.placement, face.centroidLocal);
        face.placedEdges.clear();
        updateBoundsFromFace(face);
      }
      compMinX += offsetX;
      compMaxX += offsetX;
    }
    runningMaxX = Math.max(runningMaxX ?? -Infinity, compMaxX);
  }

  const bendCenterlinesByFace = new Map();
  for (const face of placedFaces) {
    if (face.kind !== "cylindrical") continue;
    const bendEdgesForFace = bendEdgesByFace.get(face.name) || [];
    let edgeInfos = [];
    for (const entry of bendEdgesForFace) {
      const pts = entry?.points;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      edgeInfos.push({
        points: pts,
        centroid: computePolylineCentroid(pts),
        length: computePolylineLength(pts),
        bounds: computePolylineBounds(pts),
      });
    }
    if (!edgeInfos.length) {
      const edgesForFace = edgesByFace.get(face.name) || [];
      for (const edge of edgesForFace) {
        const local = mapEdgeToLocal(face, edge);
        const pts = local?.points;
        if (!Array.isArray(pts) || pts.length < 2) continue;
        edgeInfos.push({
          points: pts,
          centroid: computePolylineCentroid(pts),
          length: computePolylineLength(pts),
          bounds: computePolylineBounds(pts),
        });
      }
    }
    const centerlineLocal = buildBendCenterline(edgeInfos, face.localBounds);
    if (centerlineLocal && face.placement) {
      const placed = centerlineLocal.map((p) => applyPlacement(face.placement, p));
      bendCenterlinesByFace.set(face.name, [placed]);
    }
  }

  // Build extract layout.
  const globalBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const face of placedFaces) {
    if (!face?.bounds) continue;
    globalBounds.minX = Math.min(globalBounds.minX, face.bounds.minX);
    globalBounds.minY = Math.min(globalBounds.minY, face.bounds.minY);
    globalBounds.maxX = Math.max(globalBounds.maxX, face.bounds.maxX);
    globalBounds.maxY = Math.max(globalBounds.maxY, face.bounds.maxY);
  }
  const extractMargin = Number.isFinite(opts.extractMargin) ? opts.extractMargin : 10;
  const inPlaceBounds = { ...globalBounds };
  const extractStartX = Number.isFinite(inPlaceBounds.maxX) ? inPlaceBounds.maxX + extractMargin : 0;
  let cursorY = Number.isFinite(inPlaceBounds.minY) ? inPlaceBounds.minY : 0;
  const extracts = [];
  for (const face of placedFaces) {
    const bounds = face.bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const offset = {
      x: extractStartX - bounds.minX,
      y: cursorY - bounds.minY,
    };
    const edgeCopies = [];
    for (const [key, pts] of face.placedEdges.entries()) {
      edgeCopies.push({
        points: pts.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
        construction: bendEdges.has(key),
      });
    }
    const centerlineCopies = [];
    const centerlines = bendCenterlinesByFace.get(face.name) || [];
    for (const pts of centerlines) {
      centerlineCopies.push({
        points: pts.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
        construction: true,
      });
    }
    extracts.push({ faceName: face.name, edges: edgeCopies, centerlines: centerlineCopies, offset });
    cursorY += (bounds.maxY - bounds.minY) + extractMargin;
  }

  const edgePolylines2D = [];
  for (const face of placedFaces) {
    for (const [key, pts] of face.placedEdges.entries()) {
      edgePolylines2D.push({ points: pts, construction: bendEdges.has(key) });
    }
    const centerlines = bendCenterlinesByFace.get(face.name) || [];
    for (const pts of centerlines) {
      edgePolylines2D.push({ points: pts, construction: true });
    }
  }
  for (const extract of extracts) {
    for (const entry of extract.edges || []) {
      if (Array.isArray(entry)) {
        edgePolylines2D.push(entry);
      } else if (entry && Array.isArray(entry.points)) {
        edgePolylines2D.push(entry);
      }
    }
    for (const entry of extract.centerlines || []) {
      if (entry && Array.isArray(entry.points)) {
        edgePolylines2D.push(entry);
      }
    }
  }

  const sketch = buildSketchFromEdges(edgePolylines2D, { precision: opts.sketchPrecision ?? 6 });

  return {
    solidName: solid?.name || null,
    settings,
    faces: placedFaces.map((face) => ({
      name: face.name,
      kind: face.kind,
      sheetType: face.sheetType || null,
      bounds: face.bounds,
      bend: face.kind === "cylindrical"
        ? {
          radius: face.radius,
          neutralRadius: face.neutralRadius,
          scale: face.scale,
          inside: face.inside,
        }
        : null,
    })),
    extracts,
    sketch,
  };
}

export function buildSheetMetalFlatPatternSolids(solids, opts = {}) {
  const list = normalizeSolids(solids);
  return list.map((solid) => buildFlatPatternForSolid(solid, opts));
}

export function buildSheetMetalFlatPatternDxfs(solids, opts = {}) {
  // DXF export not implemented yet.
  return [];
}

export function buildSheetMetalFlatPatternDebugSteps(solids, opts = {}) {
  const list = normalizeSolids(solids);
  return list.map((solid) => {
    const result = buildFlatPatternForSolid(solid, opts);
    return {
      solidName: result.solidName,
      steps: [
        {
          label: "final",
          sketch: result.sketch,
          faces: result.faces,
          extracts: result.extracts,
        },
      ],
    };
  });
}

export function buildSheetMetalFlatPatternSvgs(solids, opts = {}) {
  // SVG export not implemented yet.
  return [];
}

import { resolveEdgesFromInputs } from "./edgeResolution.js";
const DEBUG_MODE_NONE = "NONE";
const DEBUG_MODE_TOOLS = "MITER TOOLS";
const DEBUG_MODE_TOOLS_AND_RESULT = "MITER TOOLS + RESULT";

function normalizeFilletDirectionMode(value) {
  const text = String(value || "AUTO").trim().toUpperCase();
  if (text === "INSET") return "INSET";
  if (text === "OUTSET") return "OUTSET";
  return "AUTO";
}

function normalizeFilletDebugMode(value) {
  const text = String(value || DEBUG_MODE_NONE).trim().toUpperCase();
  if (text === DEBUG_MODE_TOOLS) return DEBUG_MODE_TOOLS;
  if (text === DEBUG_MODE_TOOLS_AND_RESULT) return DEBUG_MODE_TOOLS_AND_RESULT;
  return DEBUG_MODE_NONE;
}

function clamp(value, min, max) {
  const lo = Number.isFinite(min) ? min : value;
  const hi = Number.isFinite(max) ? max : value;
  return Math.max(lo, Math.min(hi, value));
}

function vectorLength(v) {
  if (!v || typeof v !== "object") return 0;
  const x = Number(v.x);
  const y = Number(v.y);
  const z = Number(v.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  return Math.hypot(x, y, z);
}

function normalizeVector(v) {
  const length = vectorLength(v);
  if (!(length > 1e-12)) return null;
  return {
    x: Number(v.x) / length,
    y: Number(v.y) / length,
    z: Number(v.z) / length,
  };
}

function getFaceAverageNormal(face) {
  try {
    if (!face || typeof face.getAverageNormal !== "function") return null;
    return normalizeVector(face.getAverageNormal());
  } catch {
    return null;
  }
}

function computeMiterDistanceFromRadius(edge, radius) {
  const fallback = {
    distance: radius,
    angleDeg: null,
    interiorAngleDeg: null,
    source: "fallback_radius",
  };
  const faceA = edge?.faces?.[0] || null;
  const faceB = edge?.faces?.[1] || null;
  const nA = getFaceAverageNormal(faceA);
  const nB = getFaceAverageNormal(faceB);
  if (!nA || !nB) return fallback;

  const dotRaw = (nA.x * nB.x) + (nA.y * nB.y) + (nA.z * nB.z);
  const dot = clamp(dotRaw, -1, 1);
  const normalAngle = Math.acos(dot);
  if (!Number.isFinite(normalAngle)) return fallback;
  const interiorAngle = Math.max(1e-6, Math.PI - normalAngle);
  const tanHalf = Math.tan(interiorAngle * 0.5);
  if (!Number.isFinite(tanHalf) || Math.abs(tanHalf) <= 1e-6) return fallback;

  const rawDistance = Math.abs(radius * tanHalf);
  const minDistance = Math.max(1e-6, radius * 0.02);
  const maxDistance = Math.max(minDistance * 2, radius * 8);
  const distance = clamp(rawDistance, minDistance, maxDistance);

  return {
    distance,
    angleDeg: normalAngle * (180 / Math.PI),
    interiorAngleDeg: interiorAngle * (180 / Math.PI),
    source: Number(distance !== rawDistance) ? "face_angle_clamped" : "face_angle",
  };
}

function getGeometryCounts(solid) {
  const triCount = Array.isArray(solid?._triVerts) ? (solid._triVerts.length / 3) : 0;
  const vertCount = Array.isArray(solid?._vertProperties) ? (solid._vertProperties.length / 3) : 0;
  return { triCount, vertCount };
}

function buildPayload({
  featureID,
  requestedDirection,
  resolvedDefaultDirection,
  radius,
  inflate,
  resolution,
  edges,
  entries,
  cornerEntries,
  failures,
  appliedCount,
}) {
  const edgeList = Array.isArray(edges) ? edges : [];
  const appliedEntries = Array.isArray(entries) ? entries : [];
  const cornerBridgeEntries = Array.isArray(cornerEntries)
    ? cornerEntries
    : [];
  const failedEntries = Array.isArray(failures) ? failures : [];
  const edgeToolEntries = appliedEntries.filter((entry) => !entry?.isCornerBridge);
  return {
    implemented: true,
    strategy: "miter_tangent_boolean",
    featureID: featureID || null,
    radius,
    inflate,
    resolution,
    requestedDirection,
    resolvedDefaultDirection,
    requestedEdgeCount: edgeList.length,
    builtToolCount: edgeToolEntries.length,
    cornerBridgeCount: cornerBridgeEntries.length,
    failedToolCount: failedEntries.length,
    appliedBooleanCount: Number.isFinite(appliedCount) ? appliedCount : 0,
    edgeDecisions: edgeToolEntries.map((entry) => ({
      edgeName: entry?.edgeName || null,
      requested: requestedDirection,
      resolved: entry?.resolvedDirection || resolvedDefaultDirection,
      operation: entry?.operation || entry?.targetOperation || entry?.wedgeOperation || "subtract",
      targetOperation: entry?.targetOperation || entry?.operation || entry?.wedgeOperation || "subtract",
      toolPairOperation: entry?.toolPairOperation || entry?.tubeOperation || "subtract",
      wedgeOperation: entry?.wedgeOperation || null,
      tubeOperation: entry?.tubeOperation || null,
      miterDistance: entry?.distance || radius,
      inflate: Number.isFinite(entry?.inflate) ? entry.inflate : inflate,
      edgeOvershoot: Number.isFinite(entry?.edgeOvershoot) ? entry.edgeOvershoot : null,
      endExtension: Number.isFinite(entry?.endExtension) ? entry.endExtension : null,
      angleDeg: Number.isFinite(entry?.angleDeg) ? entry.angleDeg : null,
      interiorAngleDeg: Number.isFinite(entry?.interiorAngleDeg) ? entry.interiorAngleDeg : null,
      distanceSource: entry?.distanceSource || "unknown",
    })),
    cornerBridges: cornerBridgeEntries.map((entry) => ({
      edgeName: entry?.edgeName || null,
      sourceEdgeNames: Array.isArray(entry?.sourceEdgeNames) ? entry.sourceEdgeNames : [],
      operation: entry?.operation || entry?.targetOperation || entry?.wedgeOperation || "subtract",
      targetOperation: entry?.targetOperation || entry?.operation || entry?.wedgeOperation || "subtract",
      toolPairOperation: entry?.toolPairOperation || entry?.tubeOperation || "subtract",
      fallbackMode: entry?.cornerFallbackMode || null,
    })),
    failures: failedEntries.map((entry) => ({
      edgeName: entry?.edgeName || null,
      stage: entry?.stage || "unknown",
      error: entry?.error || "unknown",
    })),
  };
}

function attachFilletMetadata(result, payload) {
  try { result.__filletStub = payload; } catch { }
  try {
    result.__filletDirectionDecision = {
      mode: "MITER_TANGENT_BOOLEAN",
      requested: payload?.requestedDirection || "AUTO",
      resolvedDefault: payload?.resolvedDefaultDirection || "INSET",
      edgeCount: Number(payload?.requestedEdgeCount || 0),
      builtToolCount: Number(payload?.builtToolCount || 0),
      appliedBooleanCount: Number(payload?.appliedBooleanCount || 0),
      edgeDecisions: Array.isArray(payload?.edgeDecisions) ? payload.edgeDecisions : [],
    };
  } catch { }
}

function cloneWithMetadata(sourceSolid, payload) {
  const clone = sourceSolid.clone();
  try { clone.name = sourceSolid.name; } catch { }
  attachFilletMetadata(clone, payload);
  return clone;
}

function toAuxEdgePoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const point of points) {
    if (!point || typeof point !== "object") continue;
    const x = Number(point.x);
    const y = Number(point.y);
    const z = Number(point.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push([x, y, z]);
  }
  return out;
}

function toNumericPoint(point) {
  if (!point || typeof point !== "object") return null;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function toNumericArrayPoint(point) {
  if (!Array.isArray(point) || point.length < 3) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  const z = Number(point[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function pointAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function pointSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function pointScale(point, scalar) {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar };
}

function pointLength(point) {
  return Math.hypot(point.x, point.y, point.z);
}

function normalizePoint(point, eps = 1e-12) {
  const len = pointLength(point);
  if (!(len > eps)) return null;
  return pointScale(point, 1 / len);
}

function pointDistance(a, b) {
  return pointLength(pointSub(a, b));
}

function pointsAlmostEqual(a, b, tol = 1e-6) {
  if (!a || !b) return false;
  return pointDistance(a, b) <= tol;
}

function sanitizeRail(points, dedupeTol = 1e-8) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const point of points) {
    const p = toNumericPoint(point);
    if (!p) continue;
    const prev = out[out.length - 1] || null;
    if (prev && pointsAlmostEqual(prev, p, dedupeTol)) continue;
    out.push(p);
  }
  return out;
}

function trimClosedLoopDuplicate(rail, tol = 1e-6) {
  if (!Array.isArray(rail) || rail.length < 3) return rail;
  const first = rail[0];
  const last = rail[rail.length - 1];
  if (!pointsAlmostEqual(first, last, tol)) return rail;
  return rail.slice(0, rail.length - 1);
}

function averageSectionDepth(railP, railA, railB) {
  const n = Math.min(railP.length, railA.length, railB.length);
  if (n <= 0) return 0;
  let accum = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const p = railP[i];
    const a = railA[i];
    const b = railB[i];
    if (!p || !a || !b) continue;
    const da = pointDistance(p, a);
    const db = pointDistance(p, b);
    if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
    accum += 0.5 * (da + db);
    used += 1;
  }
  if (used <= 0) return 0;
  return accum / used;
}

function buildMiterToolFromTangents({
  TubeClass,
  centerlineData,
  radius,
  inflateRaw,
  resolution,
  featureID,
  edgeIndex,
}) {
  const centerlineRaw = sanitizeRail(centerlineData?.points);
  const tangentARaw = sanitizeRail(centerlineData?.tangentA);
  const tangentBRaw = sanitizeRail(centerlineData?.tangentB);
  const edgeRailRaw = sanitizeRail(centerlineData?.edge);

  let n = Math.min(centerlineRaw.length, tangentARaw.length, tangentBRaw.length);
  if (edgeRailRaw.length > 0) n = Math.min(n, edgeRailRaw.length);
  if (n < 2) return null;

  let centerline = centerlineRaw.slice(0, n);
  let tangentAActual = tangentARaw.slice(0, n);
  let tangentBActual = tangentBRaw.slice(0, n);
  let edgeRail = edgeRailRaw.length > 0 ? edgeRailRaw.slice(0, n) : centerline.slice(0, n);

  const closedLoop = !!centerlineData?.closedLoop;
  if (closedLoop) {
    centerline = trimClosedLoopDuplicate(centerline);
    tangentAActual = trimClosedLoopDuplicate(tangentAActual);
    tangentBActual = trimClosedLoopDuplicate(tangentBActual);
    edgeRail = trimClosedLoopDuplicate(edgeRail);
    n = Math.min(centerline.length, tangentAActual.length, tangentBActual.length, edgeRail.length);
    if (n < 2) return null;
    centerline = centerline.slice(0, n);
    tangentAActual = tangentAActual.slice(0, n);
    tangentBActual = tangentBActual.slice(0, n);
    edgeRail = edgeRail.slice(0, n);
  }

  // Tube tools follow the stitched centerline exactly (no extra extension on
  // centerline or tangents), so tangent-adjacent edges can share identical caps.
  const radiusAbs = Math.abs(Number(radius) || 0);
  if (!(radiusAbs > 0)) return null;
  if (typeof TubeClass !== "function") return null;
  const tubePoints = centerline.map((pt) => [pt.x, pt.y, pt.z]);
  if (tubePoints.length < 2) return null;
  if (closedLoop && tubePoints.length < 3) return null;

  const baseName = `${featureID}_TUBE_${edgeIndex + 1}`;
  const tubeResolution = (Number.isFinite(Number(resolution)) && Number(resolution) > 0)
    ? Math.max(8, Math.floor(Number(resolution)))
    : 32;
  const tool = new TubeClass({
    points: tubePoints,
    radius: radiusAbs,
    innerRadius: 0,
    resolution: tubeResolution,
    closed: closedLoop,
    name: baseName,
    preferFast: false,
    selfUnion: true,
  });

  const depth = averageSectionDepth(edgeRail, tangentAActual, tangentBActual);
  return {
    tool,
    miterDistance: Number.isFinite(depth) && depth > 0 ? depth : radius,
    edgeOvershoot: 0,
    endExtension: 0,
    startExtension: 0,
    endExtensionStart: 0,
    endExtensionEnd: 0,
    inflate: Math.abs(Number(inflateRaw) || 0),
    toolTangentA: tangentAActual,
    toolTangentB: tangentBActual,
    toolEdgeRail: centerline,
    toolFaceNames: {
      sideA: `${baseName}_Outer`,
      sideB: `${baseName}_Outer`,
      bevel: `${baseName}_Outer`,
      cap0: `${baseName}_CapStart`,
      cap1: `${baseName}_CapEnd`,
    },
    centerlineData: {
      ...centerlineData,
      points: centerline,
      tangentA: tangentAActual,
      tangentB: tangentBActual,
      edge: edgeRail,
      closedLoop,
    },
  };
}

function buildWedgeToolForEdge({
  ChamferSolidClass,
  edge,
  distance,
  resolvedDirection,
  inflateRaw,
  featureID,
  edgeIndex,
}) {
  if (typeof ChamferSolidClass !== "function") return null;
  if (!edge) return null;
  const distanceAbs = Math.abs(Number(distance) || 0);
  if (!(distanceAbs > 0)) return null;
  const inflateAbs = Math.abs(Number(inflateRaw) || 0);
  const chamferInflate = resolvedDirection === "OUTSET" ? -inflateAbs : inflateAbs;
  const wedge = new ChamferSolidClass({
    edgeToChamfer: edge,
    distance: distanceAbs,
    direction: resolvedDirection,
    inflate: chamferInflate,
    debug: false,
    snapSeamToEdge: true,
  });
  try { wedge.name = `${featureID}_WEDGE_${edgeIndex + 1}`; } catch { }
  return wedge;
}

function averagePointCloud(points) {
  const list = Array.isArray(points) ? points : [];
  if (list.length <= 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let used = 0;
  for (const p of list) {
    if (!p) continue;
    const x = Number(p.x);
    const y = Number(p.y);
    const z = Number(p.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    sx += x;
    sy += y;
    sz += z;
    used += 1;
  }
  if (used <= 0) return null;
  return { x: sx / used, y: sy / used, z: sz / used };
}

function collectOpenEdgeEndpointRecords(entries) {
  const out = [];
  const list = Array.isArray(entries) ? entries : [];
  for (let entryIndex = 0; entryIndex < list.length; entryIndex++) {
    const entry = list[entryIndex];
    const data = entry?.centerlineData;
    if (!data || data.closedLoop) continue;

    const centerline = Array.isArray(data.points) ? data.points : [];
    const tangentA = Array.isArray(data.tangentA) ? data.tangentA : [];
    const tangentB = Array.isArray(data.tangentB) ? data.tangentB : [];
    const edgeRail = Array.isArray(data.edge) && data.edge.length > 0 ? data.edge : centerline;
    const n = Math.min(centerline.length, tangentA.length, tangentB.length, edgeRail.length);
    if (n < 2) continue;

    const buildRecord = (side) => {
      const atStart = side === "start";
      const idx = atStart ? 0 : (n - 1);
      const nearIdx = atStart ? 1 : (n - 2);
      const centerPoint = toNumericPoint(centerline[idx]);
      const tangentPointA = toNumericPoint(tangentA[idx]);
      const tangentPointB = toNumericPoint(tangentB[idx]);
      const edgePoint = toNumericPoint(edgeRail[idx]);
      const edgeNear = toNumericPoint(edgeRail[nearIdx]);
      if (!centerPoint || !tangentPointA || !tangentPointB || !edgePoint || !edgeNear) return null;
      const tangentDir = normalizePoint(pointSub(edgeNear, edgePoint));
      const localScale = pointDistance(edgePoint, edgeNear);

      const sourcePolyline = Array.isArray(entry?.edge?.userData?.polylineLocal)
        ? entry.edge.userData.polylineLocal
        : [];
      const srcCount = sourcePolyline.length;
      const srcIdx = atStart ? 0 : (srcCount - 1);
      const srcNearIdx = atStart ? 1 : (srcCount - 2);
      const topologyPoint = srcCount >= 2
        ? toNumericArrayPoint(sourcePolyline[srcIdx])
        : null;
      const topologyNear = srcCount >= 2
        ? toNumericArrayPoint(sourcePolyline[srcNearIdx])
        : null;
      const topologyDir = (topologyPoint && topologyNear)
        ? normalizePoint(pointSub(topologyNear, topologyPoint))
        : null;
      const topologyScale = (topologyPoint && topologyNear)
        ? pointDistance(topologyPoint, topologyNear)
        : 0;
      return {
        entryIndex,
        side,
        index: idx,
        centerPoint,
        tangentPointA,
        tangentPointB,
        edgePoint,
        topologyPoint: topologyPoint || edgePoint,
        topologyDir,
        topologyScale: Number.isFinite(topologyScale) ? topologyScale : 0,
        tangentDir,
        localScale: Number.isFinite(localScale) ? localScale : 0,
      };
    };

    const start = buildRecord("start");
    if (start) out.push(start);
    const end = buildRecord("end");
    if (end) out.push(end);
  }
  return out;
}

function groupEndpointRecordsByJoinCriteria(endpoints, {
  radius = 1,
  tangentDotMin = null,
} = {}) {
  const nodes = Array.isArray(endpoints) ? endpoints : [];
  const n = nodes.length;
  if (n < 2) return [];
  const parent = new Array(n);
  const rank = new Array(n).fill(0);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) {
      parent[ra] = rb;
      return;
    }
    if (rank[ra] > rank[rb]) {
      parent[rb] = ra;
      return;
    }
    parent[rb] = ra;
    rank[ra] += 1;
  };

  const requireTangentAlignment = Number.isFinite(Number(tangentDotMin));
  const tangentMin = requireTangentAlignment ? Number(tangentDotMin) : null;
  for (let i = 0; i < n - 1; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      if (a.entryIndex === b.entryIndex) continue;
      const topoA = a.topologyPoint || a.edgePoint;
      const topoB = b.topologyPoint || b.edgePoint;
      if (!topoA || !topoB) continue;
      const minScale = Math.max(1e-8, Math.min(a.localScale || 0, b.localScale || 0));
      const minTopoScale = Math.max(1e-8, Math.min(a.topologyScale || 0, b.topologyScale || 0));
      const snapTol = Math.max(1e-5, Math.abs(Number(radius) || 0) * 0.05, minScale * 0.12);
      const topologyTol = Math.max(1e-6, Math.abs(Number(radius) || 0) * 1e-4, minTopoScale * 2e-3);
      const usingTopology = !!(a.topologyPoint && b.topologyPoint);
      const joinDistance = pointDistance(topoA, topoB);
      if (!(joinDistance <= (usingTopology ? topologyTol : snapTol))) continue;
      if (requireTangentAlignment) {
        const dirA = a.topologyDir || a.tangentDir;
        const dirB = b.topologyDir || b.tangentDir;
        if (!dirA || !dirB) continue;
        const tangentDot = Math.abs(clamp(pointDot(dirA, dirB), -1, 1));
        if (!(tangentDot >= tangentMin)) continue;
      }
      union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(nodes[i]);
  }
  return [...groups.values()].filter((group) => Array.isArray(group) && group.length >= 2);
}

function stitchTangentConnectedEdgeEndpoints(entries, { radius = 1 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length < 2) {
    return { stitchedEndpoints: 0, stitchedGroups: 0 };
  }

  const endpoints = collectOpenEdgeEndpointRecords(list);
  if (endpoints.length < 2) {
    return { stitchedEndpoints: 0, stitchedGroups: 0 };
  }

  const tangentDotMin = Math.cos((10 * Math.PI) / 180);
  const groupedEndpoints = groupEndpointRecordsByJoinCriteria(endpoints, {
    radius,
    tangentDotMin,
  });
  if (groupedEndpoints.length === 0) {
    return { stitchedEndpoints: 0, stitchedGroups: 0 };
  }

  let stitchedEndpoints = 0;
  let stitchedGroups = 0;
  for (const group of groupedEndpoints) {
    const reference = group[0];
    const refA = reference.tangentPointA;
    const refB = reference.tangentPointB;
    if (!refA || !refB) continue;

    const nodes = [];
    for (const node of group) {
      const direct = pointDistance(node.tangentPointA, refA) + pointDistance(node.tangentPointB, refB);
      const swapped = pointDistance(node.tangentPointA, refB) + pointDistance(node.tangentPointB, refA);
      const swapAB = swapped + 1e-9 < direct;
      nodes.push({ ...node, swapAB });
    }
    if (nodes.length < 2) continue;

    const centerSnap = averagePointCloud(nodes.map((node) => node.centerPoint));
    const edgeSnap = averagePointCloud(nodes.map((node) => node.edgePoint));
    const tangentASnap = averagePointCloud(nodes.map((node) => (node.swapAB ? node.tangentPointB : node.tangentPointA)));
    const tangentBSnap = averagePointCloud(nodes.map((node) => (node.swapAB ? node.tangentPointA : node.tangentPointB)));
    if (!centerSnap || !edgeSnap || !tangentASnap || !tangentBSnap) continue;

    for (const node of nodes) {
      const entry = list[node.entryIndex];
      const data = entry?.centerlineData;
      if (!entry || !data) continue;
      const index = node.index;
      if (Array.isArray(data.points) && data.points.length > index) data.points[index] = clonePoint(centerSnap);
      if (Array.isArray(data.edge) && data.edge.length > index) data.edge[index] = clonePoint(edgeSnap);
      if (Array.isArray(data.tangentA) && data.tangentA.length > index) {
        data.tangentA[index] = clonePoint(node.swapAB ? tangentBSnap : tangentASnap);
      }
      if (Array.isArray(data.tangentB) && data.tangentB.length > index) {
        data.tangentB[index] = clonePoint(node.swapAB ? tangentASnap : tangentBSnap);
      }
      if (!entry.sharedEndpointMask || typeof entry.sharedEndpointMask !== "object") {
        entry.sharedEndpointMask = { start: false, end: false };
      }
      entry.sharedEndpointMask[node.side] = true;
      stitchedEndpoints += 1;
    }
    stitchedGroups += 1;
  }

  return { stitchedEndpoints, stitchedGroups };
}

function buildCornerBridgeTools({
  entries = [],
  radius = 1,
  resolution = 32,
  featureID = "FILLET",
  SphereClass = null,
  debugMode = DEBUG_MODE_NONE,
}) {
  const list = Array.isArray(entries) ? entries : [];
  if (typeof SphereClass !== "function") {
    return { entries: [], failures: [] };
  }
  if (list.length < 2) {
    return { entries: [], failures: [] };
  }

  const radiusAbs = Math.abs(Number(radius) || 0);
  if (!(radiusAbs > 0)) {
    return { entries: [], failures: [] };
  }

  const endpoints = collectOpenEdgeEndpointRecords(list);
  if (endpoints.length < 2) {
    return { entries: [], failures: [] };
  }

  const groupedEndpoints = groupEndpointRecordsByJoinCriteria(endpoints, {
    radius: radiusAbs,
    tangentDotMin: null,
  });
  if (groupedEndpoints.length === 0) {
    return { entries: [], failures: [] };
  }

  const sphereResolution = (Number.isFinite(Number(resolution)) && Number(resolution) > 0)
    ? Math.max(8, Math.floor(Number(resolution) * 0.75))
    : 24;
  const cornerEntries = [];
  const failures = [];

  for (let groupIndex = 0; groupIndex < groupedEndpoints.length; groupIndex++) {
    const group = groupedEndpoints[groupIndex];
    if (!Array.isArray(group) || group.length < 2) continue;

    const nodesByEntry = new Map();
    for (const node of group) {
      if (!node) continue;
      if (!nodesByEntry.has(node.entryIndex)) nodesByEntry.set(node.entryIndex, node);
    }
    const nodes = [...nodesByEntry.values()];
    if (nodes.length < 2) continue;

    const endpointCoreData = [];
    for (const node of nodes) {
      const e = node?.edgePoint || null;
      const a = node?.tangentPointA || null;
      const b = node?.tangentPointB || null;
      if (!e || !a || !b) continue;
      const core = {
        x: (e.x + a.x + b.x) / 3,
        y: (e.y + a.y + b.y) / 3,
        z: (e.z + a.z + b.z) / 3,
      };
      const scale = Math.max(
        pointDistance(e, a),
        pointDistance(e, b),
        pointDistance(a, b) * 0.5,
      );
      endpointCoreData.push({ core, scale });
    }

    const cornerAnchor = averagePointCloud(nodes.map((node) => node.topologyPoint || node.edgePoint));
    const centerlineCenter = averagePointCloud(nodes.map((node) => node.centerPoint));
    const wedgeCoreCenter = averagePointCloud(endpointCoreData.map((item) => item.core));
    const centerSources = [wedgeCoreCenter, cornerAnchor, centerlineCenter].filter(Boolean);
    const center = averagePointCloud(centerSources);
    if (!center) continue;
    const centerKey = [
      Math.round(center.x * 1e6),
      Math.round(center.y * 1e6),
      Math.round(center.z * 1e6),
    ].join(":");

    for (let i = 0; i < nodes.length - 1; i++) {
      const nodeA = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeB = nodes[j];
        const entryA = list[nodeA.entryIndex];
        const entryB = list[nodeB.entryIndex];
        if (!entryA || !entryB) continue;
        if (!entryA.wedgeTool || !entryA.tool || !entryB.wedgeTool || !entryB.tool) continue;

        const targetOperationA = entryA.targetOperation || entryA.operation || entryA.wedgeOperation || "subtract";
        const targetOperationB = entryB.targetOperation || entryB.operation || entryB.wedgeOperation || "subtract";
        if (targetOperationA !== targetOperationB) {
          failures.push({
            edgeName: `${entryA.edgeName || `edge_${nodeA.entryIndex}`}|${entryB.edgeName || `edge_${nodeB.entryIndex}`}`,
            stage: "build_corner_bridge_operation_mismatch",
            error: `Mismatched target operations: ${targetOperationA} vs ${targetOperationB}`,
          });
          continue;
        }

        const pairOperationA = entryA.toolPairOperation || entryA.tubeOperation || "subtract";
        const pairOperationB = entryB.toolPairOperation || entryB.tubeOperation || "subtract";
        const pairOperation = (pairOperationA === "union" && pairOperationB === "union")
          ? "union"
          : "subtract";

        const sourceEdgeNames = [entryA.edgeName, entryB.edgeName].filter(Boolean);
        const edgeName = sourceEdgeNames.length > 0
          ? sourceEdgeNames.join("~")
          : `corner_pair_${nodeA.entryIndex}_${nodeB.entryIndex}`;
        const bridgeName = `${featureID}_CORNER_BRIDGE_${cornerEntries.length + 1}`;
        const localA = Number(nodeA.topologyScale || nodeA.localScale || 0);
        const localB = Number(nodeB.topologyScale || nodeB.localScale || 0);
        const localMin = Math.max(0, Math.min(localA, localB));
        const anchorToCenterline = (cornerAnchor && centerlineCenter)
          ? pointDistance(cornerAnchor, centerlineCenter)
          : 0;
        const anchorToWedge = (cornerAnchor && wedgeCoreCenter)
          ? pointDistance(cornerAnchor, wedgeCoreCenter)
          : 0;
        const wedgeScaleAvg = endpointCoreData.length > 0
          ? endpointCoreData.reduce((sum, item) => sum + Number(item.scale || 0), 0) / endpointCoreData.length
          : 0;
        const bridgeRadius = Math.max(
          radiusAbs * 1.2,
          localMin * 0.75,
          anchorToCenterline + (radiusAbs * 0.65),
          anchorToWedge + (radiusAbs * 0.6),
          wedgeScaleAvg * 0.9,
        );

        try {
          const bridgeSphere = new SphereClass({
            r: bridgeRadius,
            resolution: sphereResolution,
            name: bridgeName,
          });
          bridgeSphere.bakeTRS({ t: [center.x, center.y, center.z] });

          if (!entryA.combinedTool || !entryB.combinedTool) {
            failures.push({
              edgeName,
              stage: "build_corner_bridge_missing_pair_tool",
              error: "Missing per-edge combined tools for corner bridge delta.",
            });
            continue;
          }

          const cornerWedgeUnion = entryA.wedgeTool.union(entryB.wedgeTool);
          const cornerTubeUnion = entryA.tool.union(entryB.tool);
          const cornerPairUnion = entryA.combinedTool.union(entryB.combinedTool);
          const cornerComposite = pairOperation === "union"
            ? cornerWedgeUnion.union(cornerTubeUnion)
            : cornerWedgeUnion.subtract(cornerTubeUnion);
          const bridgeDelta = cornerComposite.subtract(cornerPairUnion);
          let bridgeTool = bridgeDelta;
          const clippedDelta = bridgeDelta.intersect(bridgeSphere);
          let usedFallback = false;
          let clipApplied = false;
          const clippedCounts = getGeometryCounts(clippedDelta);
          if (clippedCounts.triCount > 0 && clippedCounts.vertCount > 0) {
            bridgeTool = clippedDelta;
            clipApplied = true;
          } else {
            bridgeTool = bridgeDelta;
          }

          if (pairOperation === "union" && !clipApplied) {
            // OUTSET can degenerate to zero-delta near nearly tangent corners.
            const wedgeClip = cornerWedgeUnion.intersect(bridgeSphere);
            const wedgeClipCounts = getGeometryCounts(wedgeClip);
            if (wedgeClipCounts.triCount > 0 && wedgeClipCounts.vertCount > 0) {
              bridgeTool = wedgeClip;
              usedFallback = true;
            }
          }

          let { triCount, vertCount } = getGeometryCounts(bridgeTool);
          if ((triCount <= 0 || vertCount <= 0) && pairOperation !== "union") {
            const wedgeClip = cornerWedgeUnion.intersect(bridgeSphere);
            const wedgeClipCounts = getGeometryCounts(wedgeClip);
            if (wedgeClipCounts.triCount > 0 && wedgeClipCounts.vertCount > 0) {
              bridgeTool = wedgeClip;
              triCount = wedgeClipCounts.triCount;
              vertCount = wedgeClipCounts.vertCount;
              usedFallback = true;
            }
          }
          if (triCount <= 0 || vertCount <= 0) {
            failures.push({
              edgeName,
              stage: "build_corner_bridge_empty",
              error: `Bridge tool empty geometry (tri=${triCount}, vert=${vertCount})`,
            });
            continue;
          }
          try { bridgeTool.name = bridgeName; } catch { }

          const bridgeEntry = {
            edgeName,
            sourceEdgeNames,
            sourceEntryIndices: [nodeA.entryIndex, nodeB.entryIndex],
            isCornerBridge: true,
            combinedTool: bridgeTool,
            resolvedDirection: entryA.resolvedDirection || entryB.resolvedDirection || "INSET",
            operation: targetOperationA,
            targetOperation: targetOperationA,
            wedgeOperation: targetOperationA,
            toolPairOperation: pairOperation,
            tubeOperation: pairOperation,
            distance: radiusAbs,
            cornerCenter: clonePoint(center),
            cornerGroupIndex: groupIndex,
            cornerCenterKey: centerKey,
            cornerFallbackMode: usedFallback ? "wedge_clip" : (clipApplied ? null : "delta_unclipped"),
          };

          if (debugMode !== DEBUG_MODE_NONE) {
            try {
              if (bridgeTool && typeof bridgeTool.clone === "function") {
                bridgeEntry.debugCombinedTool = bridgeTool.clone();
              }
            } catch {
              bridgeEntry.debugCombinedTool = bridgeTool;
            }
          }
          cornerEntries.push(bridgeEntry);
        } catch (error) {
          failures.push({
            edgeName,
            stage: "build_corner_bridge_tool",
            error: error?.message || String(error),
          });
          console.warn("[Solid.fillet] Failed to build corner bridge tool.", {
            featureID,
            edgeName,
            error: error?.message || error,
          });
        }
      }
    }
  }

  return { entries: cornerEntries, failures };
}

function pointDot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function attachComputedTangentAuxEdges({
  solid = null,
  entries = [],
  radius = 1,
  featureID = "FILLET",
  computeFilletCenterline = null,
}) {
  if (!solid || typeof solid.addAuxEdge !== "function") {
    return { added: 0, failed: 0 };
  }
  if (typeof computeFilletCenterline !== "function") {
    return { added: 0, failed: 0 };
  }

  let added = 0;
  let failed = 0;
  const list = Array.isArray(entries) ? entries : [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const edge = entry?.edge || null;
    if (!edge) continue;
    const sideMode = entry?.resolvedDirection || "INSET";
    let centerlineData = (entry?.centerlineData && typeof entry.centerlineData === "object")
      ? entry.centerlineData
      : null;
    if (!centerlineData) {
      try {
        centerlineData = computeFilletCenterline(edge, radius, sideMode);
      } catch {
        failed += 1;
        continue;
      }
    }
    if (!centerlineData || typeof centerlineData !== "object") {
      failed += 1;
      continue;
    }

    const centerline = toAuxEdgePoints(centerlineData.points);
    const tangentA = toAuxEdgePoints(centerlineData.tangentA);
    const tangentB = toAuxEdgePoints(centerlineData.tangentB);
    const closedLoop = !!centerlineData.closedLoop;

    try {
      if (centerline.length >= 2) {
        solid.addAuxEdge(
          `${featureID}_CENTERLINE_${i + 1}`,
          centerline,
          { centerline: true, materialKey: "OVERLAY", closedLoop },
        );
        added += 1;
      }
      if (tangentA.length >= 2) {
        solid.addAuxEdge(
          `${featureID}_TANGENT_A_${i + 1}`,
          tangentA,
          { centerline: true, materialKey: "OVERLAY", closedLoop },
        );
        added += 1;
      }
      if (tangentB.length >= 2) {
        solid.addAuxEdge(
          `${featureID}_TANGENT_B_${i + 1}`,
          tangentB,
          { centerline: true, materialKey: "OVERLAY", closedLoop },
        );
        added += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { added, failed };
}

function attachToolOffsetAuxEdges({
  solid = null,
  entries = [],
  featureID = "FILLET",
}) {
  if (!solid || typeof solid.addAuxEdge !== "function") {
    return { added: 0, failed: 0 };
  }

  let added = 0;
  let failed = 0;
  const list = Array.isArray(entries) ? entries : [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const tangentATool = toAuxEdgePoints(entry?.toolTangentA);
    const tangentBTool = toAuxEdgePoints(entry?.toolTangentB);
    const closedLoop = !!entry?.centerlineData?.closedLoop;
    try {
      if (tangentATool.length >= 2) {
        solid.addAuxEdge(
          `${featureID}_TOOL_TANGENT_A_${i + 1}`,
          tangentATool,
          { centerline: false, materialKey: "BASE", closedLoop },
        );
        added += 1;
      }
      if (tangentBTool.length >= 2) {
        solid.addAuxEdge(
          `${featureID}_TOOL_TANGENT_B_${i + 1}`,
          tangentBTool,
          { centerline: false, materialKey: "BASE", closedLoop },
        );
        added += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { added, failed };
}

function collectDebugSolidsForMode({
  debugMode = DEBUG_MODE_NONE,
  entries = [],
  result = null,
  featureID = "FILLET",
}) {
  if (debugMode === DEBUG_MODE_NONE) return [];
  const out = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tools = entry?.isCornerBridge
      ? [{ solid: entry?.debugCombinedTool || entry?.combinedTool || null, suffix: "CORNER" }]
      : [
        { solid: entry?.debugWedgeTool || entry?.wedgeTool || null, suffix: "WEDGE" },
        { solid: entry?.debugTubeTool || entry?.debugTool || entry?.tool || null, suffix: "TUBE" },
        { solid: entry?.debugCombinedTool || entry?.combinedTool || null, suffix: "PAIR" },
      ];
    for (const item of tools) {
      const tool = item.solid;
      if (!tool) continue;
      try {
        if (typeof tool.clone === "function") {
          const clone = tool.clone();
          clone.name = `${featureID}_DEBUG_${item.suffix}_${i + 1}`;
          out.push(clone);
          continue;
        }
      } catch {
        // Some solids cannot be cloned without constructor arguments.
      }
      try {
        tool.name = `${featureID}_DEBUG_${item.suffix}_${i + 1}`;
        out.push(tool);
      } catch { }
    }
  }

  if (debugMode === DEBUG_MODE_TOOLS_AND_RESULT && result && typeof result.clone === "function") {
    try {
      const snapshot = result.clone();
      snapshot.name = `${featureID}_DEBUG_RESULT`;
      out.push(snapshot);
    } catch { }
  }

  return out;
}

/**
 * Fillet replacement:
 * - Computes centerlines/tangent rails from computeFilletCenterline.
 * - Builds per-edge miter wedges and centerline tube tools.
 * - Snaps shared tangent endpoints across adjacent edges so tube caps align.
 * - Combines each wedge/tube pair into a single fillet tool first.
 * - Builds corner-bridge tools across shared sharp endpoints to patch cap gaps.
 * - Applies that combined tool to the target by direction
 *   (INSET subtract, OUTSET union).
 * - AUTO currently defaults to INSET while retaining decision metadata.
 */
export async function fillet(opts = {}) {
  const radius = Number(opts.radius);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Solid.fillet: radius must be > 0, got ${opts.radius}`);
  }

  const featureID = opts.featureID || "FILLET";
  const requestedDirection = normalizeFilletDirectionMode(opts.direction);
  const resolvedDefaultDirection = requestedDirection === "AUTO" ? "INSET" : requestedDirection;
  const inflateRaw = Number.isFinite(Number(opts.inflate)) ? Math.abs(Number(opts.inflate)) : 0.0005;
  const resolution = (Number.isFinite(Number(opts.resolution)) && Number(opts.resolution) > 0)
    ? Math.max(8, Math.floor(Number(opts.resolution)))
    : 32;
  const debugMode = normalizeFilletDebugMode(opts.debugMode ?? opts.debug);
  const { computeFilletCenterline } = await import("../fillets/fillet.js");
  const { Tube: TubeClass } = await import("../Tube.js");
  const { ChamferSolid: ChamferSolidClass } = await import("../chamfer.js");
  const { Sphere: SphereClass } = await import("../primitives.js");

  const edges = resolveEdgesFromInputs(this, {
    edgeNames: opts.edgeNames,
    edges: opts.edges,
  });

  if (edges.length === 0) {
    const payload = buildPayload({
      featureID,
      requestedDirection,
      resolvedDefaultDirection,
      radius,
      inflate: inflateRaw,
      resolution,
      edges,
      entries: [],
      cornerEntries: [],
      failures: [],
      appliedCount: 0,
    });
    console.warn("[Solid.fillet] No edges resolved; returning unchanged clone.", {
      featureID,
      solid: this?.name,
    });
    const fallback = cloneWithMetadata(this, payload);
    attachComputedTangentAuxEdges({
      solid: fallback,
      entries: [],
      radius,
      featureID,
      computeFilletCenterline,
    });
    try { fallback.__debugAddedSolids = []; } catch { }
    return fallback;
  }

  const preEntries = [];
  const entries = [];
  const failures = [];

  let idx = 0;
  for (const edge of edges) {
    const edgeName = edge?.name || `edge_${idx}`;
    const resolvedDirection = resolvedDefaultDirection;
    const targetOperation = resolvedDirection === "OUTSET" ? "union" : "subtract";
    const toolPairOperation = "subtract";
    const sizing = computeMiterDistanceFromRadius(edge, radius);
    const inflate = inflateRaw;
    let centerlineData = null;

    try {
      centerlineData = computeFilletCenterline(edge, radius, resolvedDirection);
      preEntries.push({
        edgeName,
        edge,
        centerlineData,
        faceNormalA: getFaceAverageNormal(edge?.faces?.[0] || null),
        faceNormalB: getFaceAverageNormal(edge?.faces?.[1] || null),
        resolvedDirection,
        operation: targetOperation,
        targetOperation,
        wedgeOperation: targetOperation,
        toolPairOperation,
        tubeOperation: toolPairOperation,
        sizing,
        inflate,
        sharedEndpointMask: { start: false, end: false },
      });
    } catch (error) {
      failures.push({
        edgeName,
        stage: "compute_centerline",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to compute fillet centerline for edge.", {
        featureID,
        edgeName,
        error: error?.message || error,
      });
    }
    idx += 1;
  }

  stitchTangentConnectedEdgeEndpoints(preEntries, { radius });

  for (let i = 0; i < preEntries.length; i++) {
    const seed = preEntries[i];
    const edgeName = seed?.edgeName || `edge_${i}`;
    try {
      const built = buildMiterToolFromTangents({
        TubeClass,
        centerlineData: seed.centerlineData,
        radius,
        inflateRaw: seed.inflate,
        resolution,
        featureID,
        edgeIndex: i,
      });
      if (!built || !built.tool) {
        throw new Error("Unable to build tube tool from centerline data.");
      }
      const wedgeDistance = Number.isFinite(built.miterDistance) && built.miterDistance > 0
        ? built.miterDistance
        : (seed?.sizing?.distance || radius);
      const wedgeTool = buildWedgeToolForEdge({
        ChamferSolidClass,
        edge: seed.edge,
        distance: wedgeDistance,
        resolvedDirection: seed.resolvedDirection,
        inflateRaw: seed.inflate,
        featureID,
        edgeIndex: i,
      });
      if (!wedgeTool) {
        throw new Error("Unable to build wedge tool for edge.");
      }

      const tubeTool = built.tool;
      let debugWedgeTool = wedgeTool;
      let debugTubeTool = tubeTool;
      if (debugMode !== DEBUG_MODE_NONE) {
        try {
          if (wedgeTool && typeof wedgeTool.clone === "function") {
            debugWedgeTool = wedgeTool.clone();
          }
        } catch {
          debugWedgeTool = wedgeTool;
        }
        try {
          if (tubeTool && typeof tubeTool.clone === "function") {
            debugTubeTool = tubeTool.clone();
          }
        } catch {
          debugTubeTool = tubeTool;
        }
      }
      try { tubeTool.name = `${featureID}_TUBE_${i + 1}`; } catch { }
      entries.push({
        edgeName,
        edge: seed.edge,
        centerlineData: built.centerlineData || seed.centerlineData,
        faceNormalA: seed.faceNormalA,
        faceNormalB: seed.faceNormalB,
        debugTool: debugTubeTool,
        debugWedgeTool,
        debugTubeTool,
        wedgeTool,
        tool: tubeTool,
        toolFaceNames: built.toolFaceNames,
        resolvedDirection: seed.resolvedDirection,
        operation: seed.targetOperation,
        targetOperation: seed.targetOperation,
        wedgeOperation: seed.targetOperation,
        toolPairOperation: seed.toolPairOperation,
        tubeOperation: seed.toolPairOperation,
        distance: Number.isFinite(built.miterDistance) ? built.miterDistance : seed?.sizing?.distance,
        inflate: built.inflate,
        edgeOvershoot: built.edgeOvershoot,
        endExtension: built.endExtension,
        startExtension: built.startExtension,
        endExtensionStart: built.endExtensionStart,
        endExtensionEnd: built.endExtensionEnd,
        toolTangentA: built.toolTangentA,
        toolTangentB: built.toolTangentB,
        toolEdgeRail: built.toolEdgeRail,
        angleDeg: seed?.sizing?.angleDeg,
        interiorAngleDeg: seed?.sizing?.interiorAngleDeg,
        distanceSource: seed?.sizing?.source,
      });
    } catch (error) {
      failures.push({
        edgeName,
        stage: "build_tool",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to build fillet tools for edge.", {
        featureID,
        edgeName,
        error: error?.message || error,
      });
    }
  }

  if (entries.length === 0) {
    const payload = buildPayload({
      featureID,
      requestedDirection,
      resolvedDefaultDirection,
      radius,
      inflate: inflateRaw,
      resolution,
      edges,
      entries,
      cornerEntries: [],
      failures,
      appliedCount: 0,
    });
    console.warn("[Solid.fillet] No fillet tools built; returning unchanged clone.", {
      featureID,
      solid: this?.name,
      failed: failures.length,
    });
    const fallback = cloneWithMetadata(this, payload);
    attachComputedTangentAuxEdges({
      solid: fallback,
      entries: preEntries,
      radius,
      featureID,
      computeFilletCenterline,
    });
    try { fallback.__debugAddedSolids = []; } catch { }
    return fallback;
  }

  let result = this;
  let appliedBooleanCount = 0;
  let cornerEntries = [];

  // Stage 1: combine each wedge/tube pair into one tool.
  for (const entry of entries) {
    try {
      const pairOperation = entry.toolPairOperation || entry.tubeOperation || "subtract";
      const combinedTool = pairOperation === "union"
        ? entry.wedgeTool.union(entry.tool)
        : entry.wedgeTool.subtract(entry.tool);
      entry.combinedTool = combinedTool;
      if (debugMode !== DEBUG_MODE_NONE) {
        try {
          if (combinedTool && typeof combinedTool.clone === "function") {
            entry.debugCombinedTool = combinedTool.clone();
          }
        } catch {
          entry.debugCombinedTool = combinedTool;
        }
      }
    } catch (error) {
      failures.push({
        edgeName: entry.edgeName,
        stage: "combine_wedge_tube_boolean",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to combine wedge and tube tools for edge.", {
        featureID,
        edgeName: entry.edgeName,
        operation: entry.toolPairOperation || entry.tubeOperation || "subtract",
        error: error?.message || error,
      });
    }
  }

  const cornerBridgeBuild = buildCornerBridgeTools({
    entries,
    radius,
    resolution,
    featureID,
    SphereClass,
    debugMode,
  });
  cornerEntries = Array.isArray(cornerBridgeBuild?.entries) ? cornerBridgeBuild.entries : [];
  if (Array.isArray(cornerBridgeBuild?.failures) && cornerBridgeBuild.failures.length > 0) {
    failures.push(...cornerBridgeBuild.failures);
  }

  const entriesToApply = [...entries, ...cornerEntries];

  // Stage 2: apply the combined fillet tool to the target body.
  for (const entry of entriesToApply) {
    if (!entry.combinedTool) continue;
    try {
      const targetOperation = entry.targetOperation || entry.operation || entry.wedgeOperation || "subtract";
      result = targetOperation === "union"
        ? result.union(entry.combinedTool)
        : result.subtract(entry.combinedTool);
      appliedBooleanCount += 1;
      try { result.name = this.name; } catch { }
    } catch (error) {
      failures.push({
        edgeName: entry.edgeName,
        stage: "apply_combined_tool_boolean",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to apply combined fillet tool for edge.", {
        featureID,
        edgeName: entry.edgeName,
        operation: entry.targetOperation || entry.operation || entry.wedgeOperation || "subtract",
        error: error?.message || error,
      });
    }
  }

  const payload = buildPayload({
    featureID,
    requestedDirection,
    resolvedDefaultDirection,
    radius,
    inflate: inflateRaw,
    resolution,
    edges,
    entries,
    cornerEntries,
    failures,
    appliedCount: appliedBooleanCount,
  });

  if (appliedBooleanCount <= 0) {
    console.warn("[Solid.fillet] No booleans applied successfully; returning unchanged clone.", {
      featureID,
      solid: this?.name,
      failed: failures.length,
    });
    const fallback = cloneWithMetadata(this, payload);
    attachComputedTangentAuxEdges({
      solid: fallback,
      entries,
      radius,
      featureID,
      computeFilletCenterline,
    });
    try { fallback.__debugAddedSolids = []; } catch { }
    return fallback;
  }

  const { triCount, vertCount } = getGeometryCounts(result);
  if (!result || triCount === 0 || vertCount === 0) {
    console.warn("[Solid.fillet] Fillet booleans produced empty geometry; returning unchanged clone.", {
      featureID,
      solid: this?.name,
      triCount,
      vertCount,
    });
    const fallback = cloneWithMetadata(this, payload);
    attachComputedTangentAuxEdges({
      solid: fallback,
      entries,
      radius,
      featureID,
      computeFilletCenterline,
    });
    try { fallback.__debugAddedSolids = []; } catch { }
    return fallback;
  }

  const debugSolids = collectDebugSolidsForMode({
    debugMode,
    entries: entriesToApply,
    result,
    featureID,
  });
  attachComputedTangentAuxEdges({
    solid: result,
    entries,
    radius,
    featureID,
    computeFilletCenterline,
  });
  if (debugMode !== DEBUG_MODE_NONE) {
    attachToolOffsetAuxEdges({
      solid: result,
      entries,
      featureID,
    });
  }
  attachFilletMetadata(result, payload);
  try { result.__debugAddedSolids = debugSolids; } catch { }
  return result;
}

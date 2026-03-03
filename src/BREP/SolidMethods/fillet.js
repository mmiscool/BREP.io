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
  failures,
  appliedCount,
}) {
  const edgeList = Array.isArray(edges) ? edges : [];
  const appliedEntries = Array.isArray(entries) ? entries : [];
  const failedEntries = Array.isArray(failures) ? failures : [];
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
    builtToolCount: appliedEntries.length,
    failedToolCount: failedEntries.length,
    appliedBooleanCount: Number.isFinite(appliedCount) ? appliedCount : 0,
    edgeDecisions: appliedEntries.map((entry) => ({
      edgeName: entry?.edgeName || null,
      requested: requestedDirection,
      resolved: entry?.resolvedDirection || resolvedDefaultDirection,
      operation: entry?.operation || entry?.wedgeOperation || "subtract",
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
      return {
        entryIndex,
        side,
        index: idx,
        centerPoint,
        tangentPointA,
        tangentPointB,
        edgePoint,
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

function stitchTangentConnectedEdgeEndpoints(entries, { radius = 1 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length < 2) {
    return { stitchedEndpoints: 0, stitchedGroups: 0 };
  }

  const endpoints = collectOpenEdgeEndpointRecords(list);
  if (endpoints.length < 2) {
    return { stitchedEndpoints: 0, stitchedGroups: 0 };
  }

  const n = endpoints.length;
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

  const tangentDotMin = Math.cos((10 * Math.PI) / 180);
  for (let i = 0; i < n - 1; i++) {
    const a = endpoints[i];
    for (let j = i + 1; j < n; j++) {
      const b = endpoints[j];
      if (a.entryIndex === b.entryIndex) continue;
      const minScale = Math.max(1e-8, Math.min(a.localScale || 0, b.localScale || 0));
      const snapTol = Math.max(1e-5, Math.abs(Number(radius) || 0) * 0.05, minScale * 0.12);
      const joinDistance = pointDistance(a.edgePoint, b.edgePoint);
      if (!(joinDistance <= snapTol)) continue;
      if (!a.tangentDir || !b.tangentDir) continue;
      const tangentDot = Math.abs(clamp(pointDot(a.tangentDir, b.tangentDir), -1, 1));
      if (!(tangentDot >= tangentDotMin)) continue;
      union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(endpoints[i]);
  }

  let stitchedEndpoints = 0;
  let stitchedGroups = 0;
  for (const group of groups.values()) {
    if (!Array.isArray(group) || group.length < 2) continue;
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
    const tools = [
      { solid: entry?.debugWedgeTool || entry?.wedgeTool || null, suffix: "WEDGE" },
      { solid: entry?.debugTubeTool || entry?.debugTool || entry?.tool || null, suffix: "TUBE" },
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
 * - Applies wedge boolean by direction first (INSET subtract, OUTSET union),
 *   then applies the opposite boolean with the tubes.
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
    const wedgeOperation = resolvedDirection === "OUTSET" ? "union" : "subtract";
    const tubeOperation = wedgeOperation === "union" ? "subtract" : "union";
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
        operation: wedgeOperation,
        wedgeOperation,
        tubeOperation,
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
        operation: seed.wedgeOperation,
        wedgeOperation: seed.wedgeOperation,
        tubeOperation: seed.tubeOperation,
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

  // Stage 1: apply miter wedges by direction.
  for (const entry of entries) {
    try {
      result = entry.wedgeOperation === "union"
        ? result.union(entry.wedgeTool)
        : result.subtract(entry.wedgeTool);
      appliedBooleanCount += 1;
      entry.wedgeApplied = true;
      try { result.name = this.name; } catch { }
    } catch (error) {
      failures.push({
        edgeName: entry.edgeName,
        stage: "apply_wedge_boolean",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to apply wedge boolean for edge.", {
        featureID,
        edgeName: entry.edgeName,
        operation: entry.wedgeOperation,
        error: error?.message || error,
      });
    }
  }

  // Stage 2: apply tube booleans opposite to wedge booleans.
  for (const entry of entries) {
    if (!entry.wedgeApplied) continue;
    try {
      result = entry.tubeOperation === "union"
        ? result.union(entry.tool)
        : result.subtract(entry.tool);
      appliedBooleanCount += 1;
      try { result.name = this.name; } catch { }
    } catch (error) {
      failures.push({
        edgeName: entry.edgeName,
        stage: "apply_tube_boolean",
        error: error?.message || String(error),
      });
      console.warn("[Solid.fillet] Failed to apply tube boolean for edge.", {
        featureID,
        edgeName: entry.edgeName,
        operation: entry.tubeOperation,
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
    entries,
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

import { OpenCascade as oc } from "./setupOpenCascade.js";
import {
  DEFAULT_OCC_TRIANGULATION_ANGLE,
  DEFAULT_OCC_TRIANGULATION_DEFLECTION,
  DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES,
  MAX_OCC_VISUALIZATION_CURVE_SAMPLES,
} from "./occTriangulationSettings.js";

const DEFAULT_DEFLECTION = DEFAULT_OCC_TRIANGULATION_DEFLECTION;
const DEFAULT_ANGLE = DEFAULT_OCC_TRIANGULATION_ANGLE;
const OCC_BOOLEAN_UNIFY_EDGES = true;
const OCC_BOOLEAN_UNIFY_FACES = true;
const OCC_BOOLEAN_UNIFY_ANGULAR_TOLERANCE = 1e-7;

const cloneMap = (value) => new Map(value instanceof Map ? value.entries() : []);

export function createOccState({ shape, faceNames = [], faceMetadata = new Map(), edgeMetadata = new Map(), ...rest } = {}) {
  return {
    ...rest,
    shape,
    faceNames: Array.from(faceNames || []),
    faceMetadata: cloneMap(faceMetadata),
    edgeMetadata: cloneMap(edgeMetadata),
    faceNameByIndex: Array.isArray(rest.faceNameByIndex) ? Array.from(rest.faceNameByIndex) : null,
    meshCache: null,
  };
}

export function hasOccShape(solid) {
  return !!solid?._occ?.shape;
}

export function setOccState(solid, state) {
  solid._kernel = "opencascade";
  solid._occ = createOccState(state);
  solid._dirty = false;
  solid._faceIndex = null;
  solid._vertProperties = [];
  solid._triVerts = [];
  solid._triIDs = [];
  solid._vertKeyToIndex = new Map();
  solid._faceNameToID = new Map();
  solid._idToFaceName = new Map();
  solid._faceMetadata = cloneMap(solid._occ.faceMetadata);
  solid._edgeMetadata = cloneMap(solid._occ.edgeMetadata);
  for (const name of solid._occ.faceNames) solid._getOrCreateID(name);
  return solid;
}

export function makeBox({ x = 1, y = 1, z = 1, name = "Cube" } = {}) {
  const shape = new oc.BRepPrimAPI_MakeBox_1(x, y, z).Shape();
  const faceNames = [`${name}_NX`, `${name}_PX`, `${name}_NY`, `${name}_PY`, `${name}_NZ`, `${name}_PZ`];
  const state = createOccState({ shape, faceNames, primitive: { kind: "box", x, y, z, name } });
  bindPrimitiveFaceNames(state);
  return state;
}

function yAxisPlacement() {
  return new oc.gp_Ax2_2(
    new oc.gp_Pnt_3(0, 0, 0),
    new oc.gp_Dir_4(0, 1, 0),
    new oc.gp_Dir_4(1, 0, 0),
  );
}

export function makeCylinder({ radius = 1, height = 1, name = "Cylinder" } = {}) {
  const shape = new oc.BRepPrimAPI_MakeCylinder_4(yAxisPlacement(), radius, height, Math.PI * 2).Shape();
  const faceNames = [`${name}_S`, `${name}_B`, `${name}_T`];
  const faceMetadata = new Map([
    [`${name}_S`, { type: "cylindrical", radius, height }],
  ]);
  const state = createOccState({ shape, faceNames, faceMetadata, primitive: { kind: "cylinder", radius, height, name } });
  bindPrimitiveFaceNames(state);
  return state;
}

export function makeCone({ r1 = 0.5, r2 = 1, h = 1, name = "Cone" } = {}) {
  const shape = new oc.BRepPrimAPI_MakeCone_4(yAxisPlacement(), r2, r1, h, Math.PI * 2).Shape();
  const faceNames = [`${name}_S`, `${name}_B`, `${name}_T`];
  const faceMetadata = new Map([
    [`${name}_S`, { type: "conical", radiusBottom: r2, radiusTop: r1, height: h }],
  ]);
  const state = createOccState({ shape, faceNames, faceMetadata, primitive: { kind: "cone", r1, r2, h, name } });
  bindPrimitiveFaceNames(state);
  return state;
}

function makePolygonWire(points) {
  const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
  const pts = Array.isArray(points) ? points : [];
  const usable = pts.length >= 2 && pointDistanceSq(pts[0], pts[pts.length - 1]) <= 1e-18
    ? pts.slice(0, -1)
    : pts;
  for (const point of usable) polygon.Add_1(new oc.gp_Pnt_3(point[0], point[1], point[2]));
  polygon.Close();
  return polygon.Wire();
}

function addVecToPoint(point, vec) {
  return [
    Number(point?.[0] || 0) + Number(vec?.[0] || 0),
    Number(point?.[1] || 0) + Number(vec?.[1] || 0),
    Number(point?.[2] || 0) + Number(vec?.[2] || 0),
  ];
}

function translateEdgeInputs(edgeInputs, vec) {
  return (Array.isArray(edgeInputs) ? edgeInputs : []).map((edge) => ({
    ...edge,
    polyline: (Array.isArray(edge?.polyline) ? edge.polyline : []).map((point) => addVecToPoint(point, vec)),
    bezierPoles: Array.isArray(edge?.bezierPoles) ? edge.bezierPoles.map((point) => addVecToPoint(point, vec)) : edge?.bezierPoles,
    circleCenter: Array.isArray(edge?.circleCenter) ? addVecToPoint(edge.circleCenter, vec) : edge?.circleCenter,
    arcCenter: Array.isArray(edge?.arcCenter) ? addVecToPoint(edge.arcCenter, vec) : edge?.arcCenter,
  }));
}

function pointInLoop2D(point, loop, normal) {
  const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
  if (!Array.isArray(point) || !Array.isArray(pts) || pts.length < 3) return false;
  const n = normalizeVector(normal);
  let ux = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const nd = dot(ux, n);
  ux = normalizeVector([ux[0] - n[0] * nd, ux[1] - n[1] * nd, ux[2] - n[2] * nd]);
  const uy = [
    n[1] * ux[2] - n[2] * ux[1],
    n[2] * ux[0] - n[0] * ux[2],
    n[0] * ux[1] - n[1] * ux[0],
  ];
  const p2 = [dot(point, ux), dot(point, uy)];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const pi = pts[i];
    const pj = pts[j];
    if (!Array.isArray(pi) || !Array.isArray(pj)) continue;
    const xi = dot(pi, ux), yi = dot(pi, uy);
    const xj = dot(pj, ux), yj = dot(pj, uy);
    const crosses = ((yi > p2[1]) !== (yj > p2[1]))
      && (p2[0] < ((xj - xi) * (p2[1] - yi)) / ((yj - yi) || 1e-30) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function circleEdgeMatchesLoop(edgeInput, loop, normal) {
  if (String(edgeInput?.curveType || edgeInput?.sketchGeomType || "").toLowerCase() !== "circle") return false;
  const center = Array.isArray(edgeInput?.circleCenter) ? edgeInput.circleCenter : null;
  const radius = Number(edgeInput?.circleRadius);
  const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
  if (!center || !Number.isFinite(radius) || radius <= 0 || !Array.isArray(pts) || pts.length < 3) return false;
  if (!pointInLoop2D(center, pts, normal)) return false;
  let sum = 0;
  let count = 0;
  let maxErr = 0;
  for (const p of pts) {
    if (!Array.isArray(p)) continue;
    const d = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
    const err = Math.abs(d - radius);
    sum += err;
    maxErr = Math.max(maxErr, err);
    count += 1;
  }
  const tol = Math.max(1e-5, radius * 1e-3);
  return count > 0 && (sum / count) <= tol && maxErr <= tol * 4;
}

function findCircleEdgeForLoop(loop, circleEdges, normal, used = new Set()) {
  for (const edge of circleEdges || []) {
    if (used.has(edge)) continue;
    if (circleEdgeMatchesLoop(edge, loop, normal)) return edge;
  }
  return null;
}

function signedLoopAreaOnPlane(points, normal) {
  const pts = Array.isArray(points) ? points.filter((point) => Array.isArray(point) && point.length >= 3) : [];
  if (pts.length < 3) return 0;
  const n = normalizeVector(normal);
  let ux = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const nd = dot(ux, n);
  ux = normalizeVector([ux[0] - n[0] * nd, ux[1] - n[1] * nd, ux[2] - n[2] * nd]);
  const uy = [
    n[1] * ux[2] - n[2] * ux[1],
    n[2] * ux[0] - n[0] * ux[2],
    n[0] * ux[1] - n[1] * ux[0],
  ];
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += dot(a, ux) * dot(b, uy) - dot(b, ux) * dot(a, uy);
  }
  return area * 0.5;
}

function sketchChainPolyline(chain) {
  const out = [];
  for (const item of chain || []) {
    const raw = Array.isArray(item?.edgeInput?.polyline) ? item.edgeInput.polyline : [];
    const pts = item?.reverse ? raw.slice().reverse() : raw;
    for (const point of pts) {
      if (!Array.isArray(point) || point.length < 3) continue;
      const last = out[out.length - 1];
      if (last && pointDistanceSq(last, point) <= 1e-16) continue;
      out.push(point);
    }
  }
  return out;
}

function reverseSketchChainInPlace(chain) {
  chain.reverse();
  for (const item of chain) item.reverse = !item.reverse;
}

function translatedLoops(loops, vec) {
  return (loops || []).map((loop) => ({
    ...loop,
    pts: (Array.isArray(loop?.pts) ? loop.pts : loop || []).map((point) => addVecToPoint(point, vec)),
  }));
}

function fallbackCircleXAxis(normal) {
  const n = normalizeVector(normal);
  const basis = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return normalizeVector([
    (n[1] * basis[2]) - (n[2] * basis[1]),
    (n[2] * basis[0]) - (n[0] * basis[2]),
    (n[0] * basis[1]) - (n[1] * basis[0]),
  ]);
}

function makeCircleWireFromEdgeInput(edgeInput, normal) {
  const center = Array.isArray(edgeInput?.circleCenter) ? edgeInput.circleCenter : null;
  const radius = Number(edgeInput?.circleRadius);
  const kind = String(edgeInput?.curveType || edgeInput?.sketchGeomType || "").toLowerCase();
  if (kind !== "circle") return null;
  if (!center || !Number.isFinite(radius) || radius <= 0) return null;
  const n = normalizeVector(normal);
  if (Math.hypot(n[0], n[1], n[2]) <= 1e-12) return null;
  const first = Array.isArray(edgeInput?.polyline?.[0]) ? edgeInput.polyline[0] : null;
  let xDir = first ? sub(first, center) : [0, 0, 0];
  const normalDot = dot(xDir, n);
  xDir = [
    xDir[0] - n[0] * normalDot,
    xDir[1] - n[1] * normalDot,
    xDir[2] - n[2] * normalDot,
  ];
  if (Math.hypot(xDir[0], xDir[1], xDir[2]) <= 1e-12) xDir = fallbackCircleXAxis(n);
  xDir = normalizeVector(xDir);
  const axis = new oc.gp_Ax2_2(
    new oc.gp_Pnt_3(center[0], center[1], center[2]),
    new oc.gp_Dir_4(n[0], n[1], n[2]),
    new oc.gp_Dir_4(xDir[0], xDir[1], xDir[2]),
  );
  const edge = new oc.BRepBuilderAPI_MakeEdge_8(new oc.gp_Circ_2(axis, radius)).Edge();
  return new oc.BRepBuilderAPI_MakeWire_2(edge).Wire();
}

function makePlaneFromLoop(loop, normal) {
  const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
  const origin = (Array.isArray(pts) ? pts : []).find((point) => Array.isArray(point) && point.length >= 3);
  if (!origin) return null;
  const n = normalizeVector(normal);
  if (Math.hypot(n[0], n[1], n[2]) <= 1e-12) return null;
  try {
    return new oc.gp_Pln_3(
      new oc.gp_Pnt_3(origin[0], origin[1], origin[2]),
      new oc.gp_Dir_4(n[0], n[1], n[2]),
    );
  } catch {
    return null;
  }
}

function makeArcEdgeFromEdgeInput(edgeInput) {
  const pts = Array.isArray(edgeInput?.polyline) ? edgeInput.polyline.filter((point) => Array.isArray(point) && point.length >= 3) : [];
  if (pts.length < 3) return null;
  const first = pts[0];
  const middle = pts[(pts.length / 2) | 0];
  const last = pts[pts.length - 1];
  if (pointDistanceSq(first, last) <= 1e-18) return null;
  try {
    const arc = new oc.GC_MakeArcOfCircle_4(
      new oc.gp_Pnt_3(first[0], first[1], first[2]),
      new oc.gp_Pnt_3(middle[0], middle[1], middle[2]),
      new oc.gp_Pnt_3(last[0], last[1], last[2]),
    ).Value();
    const curve = new oc.Handle_Geom_Curve_2(arc.get());
    const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve).Edge();
    return edge && !edge.IsNull?.() ? edge : null;
  } catch {
    return null;
  }
}

function makeEdgeFromSketchInput(edgeInput) {
  const kind = String(edgeInput?.curveType || edgeInput?.sketchGeomType || "").toLowerCase();
  const pts = Array.isArray(edgeInput?.polyline) ? edgeInput.polyline.filter((point) => Array.isArray(point) && point.length >= 3) : [];
  if (kind === "line") return pts.length >= 2 ? makeLineEdge(pts[0], pts[pts.length - 1]) : null;
  if (kind === "arc") return makeArcEdgeFromEdgeInput(edgeInput);
  if (kind === "bezier") return makeBezierEdge(edgeInput?.bezierPoles || pts);
  return pts.length >= 2 ? makeLineEdge(pts[0], pts[pts.length - 1]) : null;
}

function reverseOccEdge(edge) {
  if (!edge) return edge;
  try {
    return oc.TopoDS.Edge_1(edge.Reversed());
  } catch {
    return edge;
  }
}

function makeWireFromSketchLoop(loop, edgeInputs, normal) {
  const segmentIds = Array.isArray(loop?.segmentIds) ? loop.segmentIds : [];
  const circleEdges = (Array.isArray(edgeInputs) ? edgeInputs : [])
    .filter((edge) => String(edge?.curveType || edge?.sketchGeomType || "").toLowerCase() === "circle" && Number(edge?.circleRadius) > 0);
  const circleEdge = findCircleEdgeForLoop(loop, circleEdges, normal);
  if (circleEdge) return makeCircleWireFromEdgeInput(circleEdge, normal);
  if (!segmentIds.length) return null;
  const selectedInputs = segmentIds.map((segmentId) => (
    (edgeInputs || []).find((edge) => String(edge?.sketchGeometryId) === String(segmentId))
  )).filter(Boolean);
  if (selectedInputs.length !== segmentIds.length) return null;
  const endpointTolSq = 1e-8;
  const endpoint = (edgeInput, useEnd = false) => {
    const pts = Array.isArray(edgeInput?.polyline) ? edgeInput.polyline : [];
    return useEnd ? pts[pts.length - 1] : pts[0];
  };
  const samePoint = (a, b) => Array.isArray(a) && Array.isArray(b) && pointDistanceSq(a, b) <= endpointTolSq;
  const remaining = selectedInputs.slice(1);
  const chain = [{ edgeInput: selectedInputs[0], reverse: false }];
  let chainStart = endpoint(selectedInputs[0], false);
  let chainEnd = endpoint(selectedInputs[0], true);
  while (remaining.length) {
    let consumed = -1;
    let entry = null;
    let prepend = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const start = endpoint(candidate, false);
      const end = endpoint(candidate, true);
      if (samePoint(chainEnd, start)) {
        consumed = i; entry = { edgeInput: candidate, reverse: false }; chainEnd = end; break;
      }
      if (samePoint(chainEnd, end)) {
        consumed = i; entry = { edgeInput: candidate, reverse: true }; chainEnd = start; break;
      }
      if (samePoint(chainStart, end)) {
        consumed = i; entry = { edgeInput: candidate, reverse: false }; chainStart = start; prepend = true; break;
      }
      if (samePoint(chainStart, start)) {
        consumed = i; entry = { edgeInput: candidate, reverse: true }; chainStart = end; prepend = true; break;
      }
    }
    if (consumed < 0 || !entry) return null;
    remaining.splice(consumed, 1);
    if (prepend) chain.unshift(entry);
    else chain.push(entry);
  }
  if (!samePoint(chainStart, chainEnd)) return null;
  const targetArea = signedLoopAreaOnPlane(loop?.pts, normal);
  const chainArea = signedLoopAreaOnPlane(sketchChainPolyline(chain), normal);
  if (Math.abs(targetArea) > 1e-12 && Math.abs(chainArea) > 1e-12 && Math.sign(targetArea) !== Math.sign(chainArea)) {
    reverseSketchChainInPlace(chain);
  }
  const simpleStartIndex = chain.findIndex((item) => {
    const kind = String(item?.edgeInput?.curveType || item?.edgeInput?.sketchGeomType || "").toLowerCase();
    return kind === "line" || kind === "arc";
  });
  if (simpleStartIndex > 0) {
    chain.push(...chain.splice(0, simpleStartIndex));
  }

  const wire = new oc.BRepBuilderAPI_MakeWire_1();
  let added = 0;
  for (const item of chain) {
    let edge = makeEdgeFromSketchInput(item.edgeInput);
    if (!edge) return null;
    if (item.reverse) edge = reverseOccEdge(edge);
    try {
      wire.Add_1(edge);
    } catch {
      return null;
    }
    added += 1;
  }
  if (!added) return null;
  let result = null;
  try {
    result = wire.Wire();
  } catch {
    return null;
  }
  return result && !result.IsNull?.() ? result : null;
}

function makeFaceFromOuterAndHoleWires(outerWire, holeWires, plane = null) {
  const attempts = [true, false];
  for (const reverseHoles of attempts) {
    try {
      const maker = plane
        ? new oc.BRepBuilderAPI_MakeFace_16(plane, outerWire, true)
        : new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);
      for (const wire of holeWires || []) {
        maker.Add(reverseHoles ? reverseWire(wire) : wire);
      }
      if (typeof maker.IsDone === "function" && !maker.IsDone()) continue;
      return oc.TopoDS.Face_1(maker.Shape());
    } catch {
      // Try the other orientation.
    }
  }
  return null;
}

function makeAnalyticFaceFromBoundaryLoops(loops, edgeInputs, normal) {
  const normalizedLoops = (loops || [])
    .map((loop) => ({
      pts: Array.isArray(loop?.pts) ? loop.pts : loop,
      isHole: !!loop?.isHole,
      segmentIds: Array.isArray(loop?.segmentIds) ? loop.segmentIds.slice() : [],
    }))
    .filter((loop) => Array.isArray(loop.pts) && loop.pts.length >= 3);
  const outerLoops = normalizedLoops.filter((loop) => !loop.isHole);
  const holeLoops = normalizedLoops.filter((loop) => loop.isHole);
  if (outerLoops.length !== 1) return null;
  const circleEdges = (Array.isArray(edgeInputs) ? edgeInputs : [])
    .filter((edge) => String(edge?.curveType || edge?.sketchGeomType || "").toLowerCase() === "circle" && Number(edge?.circleRadius) > 0);
  const hasSketchLoopSegments = normalizedLoops.some((loop) => Array.isArray(loop.segmentIds) && loop.segmentIds.length);
  if (!circleEdges.length && !hasSketchLoopSegments) return null;
  const used = new Set();
  const outerCircle = findCircleEdgeForLoop(outerLoops[0], circleEdges.filter((edge) => !edge?.isHole), normal, used)
    || (holeLoops.length ? null : findCircleEdgeForLoop(outerLoops[0], circleEdges, normal, used));
  const outerWire = outerCircle
    ? makeCircleWireFromEdgeInput(outerCircle, normal)
    : (outerLoops[0].segmentIds.length ? makeWireFromSketchLoop(outerLoops[0], edgeInputs, normal) : makePolygonWire(outerLoops[0].pts));
  if (!outerWire) return null;
  if (outerCircle) used.add(outerCircle);
  const holeWires = [];
  for (const loop of holeLoops) {
    const holeCircle = findCircleEdgeForLoop(loop, circleEdges.filter((edge) => edge?.isHole || edge !== outerCircle), normal, used);
    const wire = holeCircle
      ? makeCircleWireFromEdgeInput(holeCircle, normal)
      : (loop.segmentIds.length ? makeWireFromSketchLoop(loop, edgeInputs, normal) : makePolygonWire(loop.pts));
    if (!wire) return null;
    if (holeCircle) used.add(holeCircle);
    holeWires.push(wire);
  }
  return makeFaceFromOuterAndHoleWires(outerWire, holeWires, makePlaneFromLoop(outerLoops[0], normal));
}

function makeFaceFromBoundaryLoops(loops, edgeInputs = [], normal = [0, 0, 1]) {
  let analytic = null;
  try {
    analytic = makeAnalyticFaceFromBoundaryLoops(loops, edgeInputs, normal);
  } catch {
    analytic = null;
  }
  if (analytic) return analytic;
  const requiresAnalyticSketch = (loops || []).some((loop) => Array.isArray(loop?.segmentIds) && loop.segmentIds.length);
  if (requiresAnalyticSketch) {
    throw new Error("OpenCASCADE sketch face construction failed for authored curve geometry.");
  }
  const normalized = (loops || [])
    .map((loop) => ({
      pts: Array.isArray(loop?.pts) ? loop.pts : loop,
      isHole: !!loop?.isHole,
      segmentIds: Array.isArray(loop?.segmentIds) ? loop.segmentIds.slice() : [],
    }))
    .filter((loop) => Array.isArray(loop.pts) && loop.pts.length >= 3);
  const outer = normalized.find((loop) => !loop.isHole) || normalized[0];
  if (!outer) throw new Error("OpenCASCADE extrusion requires at least one closed boundary loop.");
  const plane = makePlaneFromLoop(outer, normal);
  const face = makeFaceFromOuterAndHoleWires(
    makePolygonWire(outer.pts),
    normalized.filter((loop) => loop !== outer && loop.isHole).map((loop) => makePolygonWire(loop.pts)),
    plane,
  );
  if (!face) {
    throw new Error("OpenCASCADE could not build a face from extrusion boundary loops.");
  }
  return face;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function makePyramid({ bL = 1, s = 4, h = 1, name = "Pyramid" } = {}) {
  const sides = Math.max(3, Math.floor(Number(s) || 4));
  const baseLength = Number(bL) || 1;
  const height = Number(h) || 1;
  const radius = baseLength / (2 * Math.sin(Math.PI / sides));
  const ring = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    ring.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
  }

  const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  loft.AddWire(makePolygonWire(ring));
  loft.AddVertex(new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt_3(0, height, 0)).Vertex());
  loft.Build();
  const faceNames = [`${name}_Base`, ...Array.from({ length: sides }, (_, index) => `${name}_S[${index}]`)];
  const state = createOccState({ shape: loft.Shape(), faceNames, primitive: { kind: "pyramid", bL: baseLength, s: sides, h: height, name } });
  bindPrimitiveFaceNames(state);
  return state;
}

function dot(a, b) {
  return (Number(a?.[0] || 0) * Number(b?.[0] || 0))
    + (Number(a?.[1] || 0) * Number(b?.[1] || 0))
    + (Number(a?.[2] || 0) * Number(b?.[2] || 0));
}

function sub(a, b) {
  return [
    Number(a?.[0] || 0) - Number(b?.[0] || 0),
    Number(a?.[1] || 0) - Number(b?.[1] || 0),
    Number(a?.[2] || 0) - Number(b?.[2] || 0),
  ];
}

function closestSegmentDistanceSq(point, a, b) {
  const ab = sub(b, a);
  const ap = sub(point, a);
  const len2 = dot(ab, ab);
  const t = len2 > 1e-20 ? Math.max(0, Math.min(1, dot(ap, ab) / len2)) : 0;
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  const d = sub(point, q);
  return dot(d, d);
}

function closestSegmentPoint(point, a, b) {
  const ab = sub(b, a);
  const ap = sub(point, a);
  const len2 = dot(ab, ab);
  const t = len2 > 1e-20 ? Math.max(0, Math.min(1, dot(ap, ab) / len2)) : 0;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

function closestPathPoint(point, points, closed = false) {
  let best = null;
  const count = Array.isArray(points) ? points.length : 0;
  for (let i = 0; i < count - 1; i += 1) {
    const q = closestSegmentPoint(point, points[i], points[i + 1]);
    const dist2 = dot(sub(point, q), sub(point, q));
    if (!best || dist2 < best.dist2) best = { point: q, dist2 };
  }
  if (closed && count > 2) {
    const q = closestSegmentPoint(point, points[count - 1], points[0]);
    const dist2 = dot(sub(point, q), sub(point, q));
    if (!best || dist2 < best.dist2) best = { point: q, dist2 };
  }
  return best;
}

function averageDistanceToPath(pointsToClassify, pathPoints, closed = false) {
  const samples = (Array.isArray(pointsToClassify) ? pointsToClassify : [])
    .filter((point) => Array.isArray(point) && point.length >= 3);
  if (!samples.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (const point of samples) {
    const closest = closestPathPoint(point, pathPoints, closed);
    if (!closest || !Number.isFinite(closest.dist2)) continue;
    sum += Math.sqrt(Math.max(0, closest.dist2));
    count += 1;
  }
  return count ? sum / count : Infinity;
}

function loopSegmentsWithNames(boundaryLoops, edgeInputs, defaultName, normal = [0, 0, 1]) {
  const segments = [];
  const named = Array.isArray(edgeInputs) ? edgeInputs : [];
  const namedSegmentIds = new Set(
    named
      .map((edge) => edge?.sketchGeometryId)
      .filter((id) => id !== undefined && id !== null)
      .map((id) => String(id)),
  );
  const circleLoopCovered = new Set();
  for (const edge of named) {
    const pts = Array.isArray(edge?.polyline) ? edge.polyline : [];
    if (edge?.curveType === "circle" && pts.length >= 2) {
      for (let loopIndex = 0; loopIndex < (boundaryLoops || []).length; loopIndex += 1) {
        if (circleEdgeMatchesLoop(edge, boundaryLoops[loopIndex], normal)) circleLoopCovered.add(loopIndex);
      }
      segments.push({
        a: pts[0],
        b: pts[Math.max(0, pts.length - 2)],
        name: edge.name || defaultName,
        metadata: parseJsonObject(edge.metadataJson),
        curveType: "circle",
        center: Array.isArray(edge.circleCenter) ? edge.circleCenter.slice() : null,
        radius: Number(edge.circleRadius),
      });
      continue;
    }
    for (let i = 0; i + 1 < pts.length; i += 1) {
      segments.push({
        a: pts[i],
        b: pts[i + 1],
        name: edge.name || defaultName,
        metadata: parseJsonObject(edge.metadataJson),
      });
    }
  }
  let segmentIndex = 0;
  for (let loopIndex = 0; loopIndex < (boundaryLoops || []).length; loopIndex += 1) {
    if (circleLoopCovered.has(loopIndex)) continue;
    const loop = boundaryLoops[loopIndex];
    const segmentIds = Array.isArray(loop?.segmentIds) ? loop.segmentIds : [];
    if (segmentIds.length && segmentIds.every((id) => namedSegmentIds.has(String(id)))) continue;
    const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i < pts.length; i += 1) {
      segments.push({
        a: pts[i],
        b: pts[(i + 1) % pts.length],
        name: `${defaultName}_${segmentIndex++}`,
        metadata: { faceType: "SIDEWALL" },
      });
    }
  }
  return segments;
}

function classifyPrismFace(stats, params) {
  const dir = params.direction;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len <= 1e-12) return params.startName;
  const unit = [dir[0] / len, dir[1] / len, dir[2] / len];
  const t = dot(sub(stats.centroid, params.startOrigin), unit);
  const capTol = Math.max(1e-6, len * 1e-5);
  if (Math.abs(t) <= capTol) return params.startName;
  if (Math.abs(t - len) <= capTol) return params.endName;

  const midOffset = [dir[0] * 0.5, dir[1] * 0.5, dir[2] * 0.5];
  let best = null;
  for (const segment of params.segments || []) {
    let dist;
    if (segment?.curveType === "circle" && Array.isArray(segment.center) && Number(segment.radius) > 0) {
      const center = addVecToPoint(segment.center, midOffset);
      const rel = sub(stats.centroid, center);
      const axial = dot(rel, unit);
      const radial = [
        rel[0] - unit[0] * axial,
        rel[1] - unit[1] * axial,
        rel[2] - unit[2] * axial,
      ];
      const radialError = Math.hypot(radial[0], radial[1], radial[2]) - Number(segment.radius);
      dist = radialError * radialError;
    } else {
      const a = addVecToPoint(segment.a, midOffset);
      const b = addVecToPoint(segment.b, midOffset);
      dist = closestSegmentDistanceSq(stats.centroid, a, b);
    }
    if (!best || dist < best.dist) best = { dist, segment };
  }
  return best?.segment?.name || params.defaultSideName;
}

function bindPrismFaceNames(state, params) {
  state.faceNameByIndex = [];
  new oc.BRepMesh_IncrementalMesh_2(state.shape, DEFAULT_DEFLECTION, false, DEFAULT_ANGLE, false);
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    state.faceNameByIndex[faceIndex] = classifyPrismFace(statsFromOccFace(face), params);
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

function bindSingleFacePrismFaceNames(state, params) {
  state.faceNameByIndex = [];
  new oc.BRepMesh_IncrementalMesh_2(state.shape, DEFAULT_DEFLECTION, false, DEFAULT_ANGLE, false);
  const dir = params.direction || [0, 0, 1];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const unit = len > 1e-12 ? [dir[0] / len, dir[1] / len, dir[2] / len] : [0, 0, 1];
  const sourceStats = params.sourceFace ? statsFromOccFace(params.sourceFace) : null;
  const startOrigin = sourceStats?.centroid || [0, 0, 0];
  const capTol = Math.max(1e-6, len * 1e-5);
  let sideIndex = 0;
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const stats = statsFromOccFace(face);
    const t = dot(sub(stats.centroid, startOrigin), unit);
    if (Math.abs(t) <= capTol) {
      state.faceNameByIndex[faceIndex] = params.startName;
    } else if (Math.abs(t - len) <= capTol) {
      state.faceNameByIndex[faceIndex] = params.endName;
    } else {
      state.faceNameByIndex[faceIndex] = `${params.sidePrefix}_E${sideIndex++}_SW`;
    }
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

function bindLoftFaceNames(state, params) {
  state.faceNameByIndex = [];
  new oc.BRepMesh_IncrementalMesh_2(state.shape, DEFAULT_DEFLECTION, false, DEFAULT_ANGLE, false);
  const sections = Array.isArray(params.sections) ? params.sections : [];
  const first = sections[0] || [];
  const last = sections[sections.length - 1] || [];
  const sideNames = Array.isArray(params.sideNames) ? params.sideNames : [];
  const startCentroid = makeFaceStats(first).centroid;
  const endCentroid = makeFaceStats(last).centroid;
  const modelSize = Math.max(1, Math.hypot(...sub(startCentroid, endCentroid)));
  const axis = sub(endCentroid, startCentroid);
  const axisLenSq = Math.max(1e-20, dot(axis, axis));
  const capTol = Math.max(1e-5, modelSize * 1e-4);
  const startNormal = finiteNormalOrFallback(params.startNormal, first);
  const endNormal = finiteNormalOrFallback(params.endNormal, last);

  const rails = [];
  const sectionCount = sections.length;
  const edgeCount = sideNames.length;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const rail = [];
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
      const pts = sections[sectionIndex] || [];
      const n = pts.length;
      if (!n) continue;
      const a = pts[edgeIndex % n];
      const b = pts[(edgeIndex + 1) % n];
      if (!a || !b) continue;
      rail.push([
        (Number(a[0] || 0) + Number(b[0] || 0)) * 0.5,
        (Number(a[1] || 0) + Number(b[1] || 0)) * 0.5,
        (Number(a[2] || 0) + Number(b[2] || 0)) * 0.5,
      ]);
    }
    rails.push(rail);
  }

  let created = 0;
  let faceIndex = 0;
  const sideFaces = [];
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const stats = statsFromOccFace(face);
    const ds = Math.hypot(...sub(stats.centroid, startCentroid));
    const de = Math.hypot(...sub(stats.centroid, endCentroid));
    const t = dot(sub(stats.centroid, startCentroid), axis) / axisLenSq;
    const startPlaneDistance = Math.abs(dot(sub(stats.centroid, first[0] || startCentroid), startNormal));
    const endPlaneDistance = Math.abs(dot(sub(stats.centroid, last[0] || endCentroid), endNormal));
    if (ds <= capTol || startPlaneDistance <= capTol || t <= capTol / modelSize) {
      state.faceNameByIndex[faceIndex] = params.startName;
      continue;
    }
    if (de <= capTol || endPlaneDistance <= capTol || t >= 1 - (capTol / modelSize)) {
      state.faceNameByIndex[faceIndex] = params.endName;
      continue;
    }

    const candidates = [];
    for (let i = 0; i < rails.length; i += 1) {
      const rail = rails[i];
      if (!Array.isArray(rail) || rail.length < 2) continue;
      let dist = Infinity;
      for (let j = 0; j + 1 < rail.length; j += 1) {
        dist = Math.min(dist, closestSegmentDistanceSq(stats.centroid, rail[j], rail[j + 1]));
      }
      candidates.push({ dist, name: sideNames[i] });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    sideFaces.push({ faceIndex, candidates });
  }
  const assignedFaces = new Set();
  for (const sideName of sideNames) {
    let best = null;
    for (const entry of sideFaces) {
      if (assignedFaces.has(entry.faceIndex)) continue;
      const candidate = entry.candidates.find((item) => item.name === sideName);
      if (!candidate) continue;
      if (!best || candidate.dist < best.dist) best = { faceIndex: entry.faceIndex, dist: candidate.dist };
    }
    if (best) {
      state.faceNameByIndex[best.faceIndex] = sideName;
      assignedFaces.add(best.faceIndex);
    }
  }
  for (const entry of sideFaces) {
    if (assignedFaces.has(entry.faceIndex)) continue;
    state.faceNameByIndex[entry.faceIndex] = entry.candidates[0]?.name || `${params.featureID || "LOFT"}_FACE_${created++}`;
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

function makeLoftSectionWire(section, wireInput = null) {
  const loops = Array.isArray(wireInput?.loops) && wireInput.loops.length ? wireInput.loops : [{ pts: section, isHole: false }];
  const edgeInputs = Array.isArray(wireInput?.edgeInputs) ? wireInput.edgeInputs : [];
  const normal = Array.isArray(wireInput?.normal) ? wireInput.normal : [0, 0, 1];
  const normalizedLoops = loops
    .map((loop) => ({
      pts: Array.isArray(loop?.pts) ? loop.pts : loop,
      isHole: !!loop?.isHole,
    }))
    .filter((loop) => Array.isArray(loop.pts) && loop.pts.length >= 3);
  const outerLoops = normalizedLoops.filter((loop) => !loop.isHole);
  const holeLoops = normalizedLoops.filter((loop) => loop.isHole);
  if (outerLoops.length === 1 && holeLoops.length === 0) {
    const circleEdges = edgeInputs.filter((edge) => (
      String(edge?.curveType || edge?.sketchGeomType || "").toLowerCase() === "circle"
      && Number(edge?.circleRadius) > 0
    ));
    if (circleEdges.length === 1) {
      const circleWire = makeCircleWireFromEdgeInput(circleEdges[0], normal);
      if (circleWire) return circleWire;
    }
  }
  const outer = outerLoops[0] || normalizedLoops[0];
  if (!outer) throw new Error("OpenCASCADE loft section requires a closed loop.");
  return makePolygonWire(outer.pts);
}

export function makeLoft({
  sections = [],
  sectionWireInputs = [],
  sideNames = [],
  startName = "LOFT_START",
  endName = "LOFT_END",
  featureID = "LOFT",
} = {}) {
  const normalizedSections = (Array.isArray(sections) ? sections : [])
    .map((pts) => (Array.isArray(pts) ? pts : [])
      .filter((point) => Array.isArray(point) && point.length >= 3)
      .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]))
    .map((pts) => (pts.length >= 2 && pointDistanceSq(pts[0], pts[pts.length - 1]) <= 1e-18) ? pts.slice(0, -1) : pts)
    .filter((pts) => pts.length >= 3);
  if (normalizedSections.length < 2) {
    throw new Error("OpenCASCADE loft requires at least two closed profile sections.");
  }

  const op = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  for (let i = 0; i < normalizedSections.length; i += 1) {
    op.AddWire(makeLoftSectionWire(normalizedSections[i], sectionWireInputs[i] || null));
  }
  op.Build();
  if (typeof op.IsDone === "function" && !op.IsDone()) {
    throw new Error("OpenCASCADE loft failed.");
  }

  const normalizedSideNames = Array.isArray(sideNames) && sideNames.length
    ? sideNames.map((name, index) => String(name || `${featureID}_SIDE_${index}`))
    : Array.from({ length: normalizedSections[0].length }, (_, index) => `${featureID}_SIDE_${index}`);
  const faceMetadata = new Map([
    [startName, { faceType: "STARTCAP" }],
    [endName, { faceType: "ENDCAP" }],
  ]);
  for (const name of normalizedSideNames) faceMetadata.set(name, { faceType: "SIDEWALL" });
  const state = createOccState({
    shape: op.Shape(),
    faceNames: uniqueNames([startName, endName, ...normalizedSideNames]),
    faceMetadata,
    feature: { kind: "loft", featureID },
  });
  bindLoftFaceNames(state, {
    sections: normalizedSections,
    sideNames: normalizedSideNames,
    startName,
    endName,
    featureID,
    startNormal: sectionWireInputs?.[0]?.normal,
    endNormal: sectionWireInputs?.[normalizedSections.length - 1]?.normal,
  });
  return state;
}

function makeHelixWireOnSurface({ radius, radiusEnd = radius, length, turns, phase = 0, leftHanded = false } = {}) {
  const r = Math.max(1e-9, Number(radius) || 0);
  const rEnd = Math.max(1e-9, Number(radiusEnd) || r);
  const h = Math.max(1e-9, Number(length) || 0);
  const nTurns = Math.max(1e-9, Math.abs(Number(turns) || 0));
  const u0 = Number(phase) || 0;
  const u1 = u0 + (leftHanded ? -1 : 1) * Math.PI * 2 * nTurns;
  const ax3 = new oc.gp_Ax3_3(
    new oc.gp_Pnt_3(0, 0, 0),
    new oc.gp_Dir_4(0, 0, 1),
    new oc.gp_Dir_4(1, 0, 0),
  );
  const taper = (rEnd - r) / h;
  const semiAngle = Math.atan(taper);
  const v1 = Math.abs(taper) > 1e-12 ? h / Math.cos(semiAngle) : h;
  const surfaceObject = Math.abs(taper) > 1e-12
    ? new oc.Geom_ConicalSurface_1(ax3, semiAngle, r)
    : new oc.Geom_CylindricalSurface_1(ax3, r);
  const surface = new oc.Handle_Geom_Surface_2(surfaceObject);
  const dir = new oc.gp_Dir2d_4(u1 - u0, v1);
  const line = new oc.Geom2d_Line_1(new oc.gp_Ax2d_2(new oc.gp_Pnt2d_3(u0, 0), dir));
  const curve = new oc.Handle_Geom2d_Curve_2(line);
  const edge = new oc.BRepBuilderAPI_MakeEdge_31(curve, surface, 0, Math.hypot(u1 - u0, v1)).Edge();
  oc.BRepLib.BuildCurve3d(edge, 1e-7, oc.GeomAbs_Shape.GeomAbs_C1, 14, 1000);
  oc.BRepLib.BuildCurves3d_2(edge);
  return new oc.BRepBuilderAPI_MakeWire_2(edge).Wire();
}

export function makeHelicalPipe({
  radius = 1,
  radiusEnd = radius,
  length = 1,
  turns = 1,
  profilePoints = [],
  phase = 0,
  leftHanded = false,
  sideNames = [],
  startName = "PIPE_START",
  endName = "PIPE_END",
  featureID = "PIPE",
} = {}) {
  const normalizedProfile = (Array.isArray(profilePoints) ? profilePoints : [])
    .filter((point) => Array.isArray(point) && point.length >= 3)
    .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]);
  if (normalizedProfile.length < 3) {
    throw new Error("OpenCASCADE helical pipe requires a closed profile with at least three points.");
  }

  const spine = makeHelixWireOnSurface({ radius, radiusEnd, length, turns, phase, leftHanded });
  const profileWire = makePolygonWire(normalizedProfile);
  const profileFace = new oc.BRepBuilderAPI_MakeFace_15(profileWire, true).Face();
  const pipe = new oc.BRepOffsetAPI_MakePipe_2(
    spine,
    profileFace,
    oc.GeomFill_Trihedron.GeomFill_IsFrenet,
    false,
  );
  pipe.Build();
  const normalizedSideNames = Array.isArray(sideNames) && sideNames.length
    ? sideNames.map((name, index) => String(name || `${featureID}_SIDE_${index}`))
    : Array.from({ length: normalizedProfile.length }, (_, index) => `${featureID}_SIDE_${index}`);
  const faceMetadata = new Map([
    [startName, { faceType: "STARTCAP" }],
    [endName, { faceType: "ENDCAP" }],
  ]);
  for (const name of normalizedSideNames) faceMetadata.set(name, { faceType: "SIDEWALL" });
  return createOccState({
    shape: pipe.Shape(),
    faceNames: uniqueNames([startName, endName, ...normalizedSideNames]),
    faceMetadata,
    meshOptions: { deflection: 0.02, angle: 0.18 },
    feature: { kind: "helicalPipe", featureID, radius, radiusEnd, length, turns, phase, leftHanded },
  });
}

export function makeExtrusion({
  boundaryLoops = [],
  faceName = "Face",
  name = "Extrude",
  direction = [0, 0, 1],
  normal = null,
  distanceBack = 0,
  edgeInputs = [],
  omitBaseCap = false,
} = {}) {
  const dir = [Number(direction[0]) || 0, Number(direction[1]) || 0, Number(direction[2]) || 0];
  const normalVec = Array.isArray(normal) ? [Number(normal[0]) || 0, Number(normal[1]) || 0, Number(normal[2]) || 0] : null;
  const back = Number(distanceBack) || 0;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const normalLen = Math.hypot(normalVec?.[0] || 0, normalVec?.[1] || 0, normalVec?.[2] || 0);
  const backUnit = len > 1e-12
    ? [dir[0] / len, dir[1] / len, dir[2] / len]
    : (normalLen > 1e-12 ? [normalVec[0] / normalLen, normalVec[1] / normalLen, normalVec[2] / normalLen] : [0, 0, 1]);
  let backVec = [0, 0, 0];
  if (back > 0) backVec = [-backUnit[0] * back, -backUnit[1] * back, -backUnit[2] * back];
  const totalDir = [dir[0] - backVec[0], dir[1] - backVec[1], dir[2] - backVec[2]];
  const loops = translatedLoops(boundaryLoops, backVec);
  const translatedEdges = translateEdgeInputs(edgeInputs, backVec);
  const face = makeFaceFromBoundaryLoops(loops, translatedEdges, normalLen > 1e-12 ? normalVec : backUnit);
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, new oc.gp_Vec_4(totalDir[0], totalDir[1], totalDir[2]), false, true);
  if (typeof prism.IsDone === "function" && !prism.IsDone()) {
    throw new Error("OpenCASCADE prism extrusion failed.");
  }

  const featureTag = name ? `${name}:` : "";
  const startName = `${featureTag}${faceName}_START`;
  const endName = `${featureTag}${faceName}_END`;
  const defaultSideName = `${featureTag}${faceName}_SW`;
  const segments = loopSegmentsWithNames(loops, translatedEdges, defaultSideName, normalLen > 1e-12 ? normalVec : backUnit);
  const profileNormal = normalLen > 1e-12 ? normalVec : backUnit;
  const faceMetadata = new Map([
    [startName, {
      faceType: "STARTCAP",
      boundaryLoopsWorld: loops,
      sketchEdgeInputsWorld: translatedEdges,
      profileNormal,
    }],
    [endName, {
      faceType: "ENDCAP",
      boundaryLoopsWorld: translatedLoops(loops, totalDir),
      sketchEdgeInputsWorld: translateEdgeInputs(translatedEdges, totalDir),
      profileNormal,
    }],
  ]);
  for (const segment of segments) {
    if (!segment.name) continue;
    faceMetadata.set(segment.name, Object.keys(segment.metadata || {}).length ? segment.metadata : { faceType: "SIDEWALL" });
  }
  if (omitBaseCap) faceMetadata.delete(startName);

  const state = createOccState({
    shape: prism.Shape(),
    faceNames: uniqueNames([startName, endName, ...segments.map((segment) => segment.name)]),
    faceMetadata,
    primitive: null,
    feature: { kind: "extrude", name, faceName },
  });
  bindPrismFaceNames(state, {
    startName,
    endName,
    defaultSideName,
    direction: totalDir,
    startOrigin: loops?.[0]?.pts?.[0] || [0, 0, 0],
    segments,
  });
  if (omitBaseCap) {
    state.faceNames = state.faceNames.filter((entry) => entry !== startName);
    state.faceNameByIndex = state.faceNameByIndex.map((entry) => entry === startName ? defaultSideName : entry);
  }
  return state;
}

export function makeFacePrismFromOccSolid(solid, faceName, {
  distance,
  sourceFaceName = faceName,
  featureID = "THICKEN",
} = {}) {
  if (!hasOccShape(solid)) return null;
  const selectedFaceName = String(faceName || "").trim();
  if (!selectedFaceName) return null;
  const source = String(sourceFaceName || selectedFaceName).trim() || selectedFaceName;
  const d = Number(distance);
  if (!Number.isFinite(d) || Math.abs(d) <= 1e-12) {
    throw new Error(`OpenCASCADE face thicken distance must be non-zero, got ${distance}`);
  }
  const face = findOccFaceByName(solid, selectedFaceName);
  if (!face) return null;
  const surfaceType = occFaceSurfaceTypeValue(face);
  const planeSurfaceType = Number(
    oc.GeomAbs_SurfaceType.GeomAbs_Plane?.value
    ?? oc.GeomAbs_SurfaceType.GeomAbs_Plane,
  );
  if (!sameOccSurfaceType(surfaceType, planeSurfaceType)) {
    throw new Error("OpenCASCADE face thicken currently requires a planar BREP face.");
  }
  const normal = surfaceNormalFromOccFace(face) || occFaceNormal(solid, selectedFaceName)?.normal || [0, 0, 1];
  const direction = [normal[0] * d, normal[1] * d, normal[2] * d];
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, new oc.gp_Vec_4(direction[0], direction[1], direction[2]), false, true);
  if (typeof prism.IsDone === "function" && !prism.IsDone()) {
    throw new Error("OpenCASCADE face prism thicken failed.");
  }
  const startName = `${source}_START`;
  const endName = `${source}_END`;
  const faceMetadata = new Map([
    [startName, { faceType: "STARTCAP", sourceFaceName: source, profileNormal: normal }],
    [endName, { faceType: "ENDCAP", sourceFaceName: source, profileNormal: normal }],
  ]);
  const state = createOccState({
    shape: prism.Shape(),
    faceNames: [startName, endName],
    faceMetadata,
    feature: { kind: "faceThicken", featureID, sourceFaceName: source, distance: d },
  });
  bindSingleFacePrismFaceNames(state, {
    sourceFace: face,
    startName,
    endName,
    sidePrefix: source,
    direction,
  });
  for (const name of state.faceNames || []) {
    if (name !== startName && name !== endName && !faceMetadata.has(name)) {
      faceMetadata.set(name, { faceType: "SIDEWALL", sourceFaceName: source });
    }
  }
  state.faceMetadata = faceMetadata;
  return state;
}

function rotatePointAroundAxis(point, origin, axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ux = axis[0] / len, uy = axis[1] / len, uz = axis[2] / len;
  const x = point[0] - origin[0], y = point[1] - origin[1], z = point[2] - origin[2];
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = ux * x + uy * y + uz * z;
  return [
    origin[0] + x * c + (uy * z - uz * y) * s + ux * d * (1 - c),
    origin[1] + y * c + (uz * x - ux * z) * s + uy * d * (1 - c),
    origin[2] + z * c + (ux * y - uy * x) * s + uz * d * (1 - c),
  ];
}

function loopsCentroid(loops) {
  const sum = [0, 0, 0];
  let count = 0;
  for (const loop of loops || []) {
    const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
    if (!Array.isArray(pts)) continue;
    for (const p of pts) {
      sum[0] += Number(p?.[0] || 0);
      sum[1] += Number(p?.[1] || 0);
      sum[2] += Number(p?.[2] || 0);
      count += 1;
    }
  }
  return count ? [sum[0] / count, sum[1] / count, sum[2] / count] : [0, 0, 0];
}

function classifyRevolveSideFace(stats, params) {
  const midAngle = Number(params.angleRad || 0) * 0.5;
  const profilePoint = rotatePointAroundAxis(stats.centroid, params.axisOrigin, params.axisDirection, -midAngle);
  let best = null;
  for (const segment of params.segments || []) {
    let dist;
    if (segment?.curveType === "circle" && Array.isArray(segment.center) && Number(segment.radius) > 0) {
      const radiusError = Math.hypot(...sub(profilePoint, segment.center)) - Number(segment.radius);
      dist = radiusError * radiusError;
    } else {
      dist = closestSegmentDistanceSq(profilePoint, segment.a, segment.b);
    }
    if (!best || dist < best.dist) best = { dist, segment };
  }
  return best?.segment?.name || params.defaultSideName;
}

function edgeInputSegments(edgeInput) {
  const pts = Array.isArray(edgeInput?.polyline) ? edgeInput.polyline : [];
  const segments = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    if (pointDistanceSq(pts[i], pts[i + 1]) > 1e-16) segments.push([pts[i], pts[i + 1]]);
  }
  return segments;
}

function matchEdgeInputToOccEdge(edgeInputs, occEdge) {
  let best = null;
  for (const edgeInput of edgeInputs || []) {
    const name = String(edgeInput?.name || "").trim();
    if (!name) continue;
    const segments = edgeInputSegments(edgeInput);
    if (!segments.length) continue;
    let score = curvePolylineMatchScore(segments, occEdge);
    const endpoints = occEdgeEndpoints(occEdge);
    const pts = Array.isArray(edgeInput?.polyline) ? edgeInput.polyline : [];
    const inputClosed = pts.length > 2 && pointDistanceSq(pts[0], pts[pts.length - 1]) <= 1e-16;
    if (endpoints && !inputClosed) {
      const endpointScore = Math.min(
        pointDistanceSq(pts[0], endpoints[0]) + pointDistanceSq(pts[pts.length - 1], endpoints[1]),
        pointDistanceSq(pts[0], endpoints[1]) + pointDistanceSq(pts[pts.length - 1], endpoints[0]),
      );
      score = Math.min(score, endpointScore);
    }
    if (!best || score < best.score) best = { name, score };
  }
  return best?.name || null;
}

function collectNamedSourceEdges(sourceFace, edgeInputs) {
  if (!sourceFace || !Array.isArray(edgeInputs) || !edgeInputs.length) return [];
  const out = [];
  const used = new Set();
  try {
    const explorer = new oc.TopExp_Explorer_2(
      sourceFace,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; explorer.More(); explorer.Next()) {
      const edge = oc.TopoDS.Edge_1(explorer.Current());
      const name = matchEdgeInputToOccEdge(edgeInputs, edge);
      if (!name) continue;
      const key = `${name}:${out.length}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push({ edge, name });
    }
  } catch {
    return [];
  }
  return out;
}

function generatedFaceNameFromSourceEdges(resultFace, namedSourceEdges, operation) {
  if (!operation || typeof operation.Generated !== "function") return null;
  for (const source of namedSourceEdges || []) {
    try {
      if (listContainsSameShape(operation.Generated(source.edge), resultFace)) return source.name;
    } catch {
      // Fall back to geometric naming below.
    }
  }
  return null;
}

function bindRevolveFaceNames(state, params) {
  state.faceNameByIndex = [];
  new oc.BRepMesh_IncrementalMesh_2(state.shape, DEFAULT_DEFLECTION, false, DEFAULT_ANGLE, false);
  const full = Math.abs(params.angleDegrees) >= 360 - 1e-6;
  const namedSourceEdges = collectNamedSourceEdges(params.sourceFace, params.edgeInputs);
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const generatedName = generatedFaceNameFromSourceEdges(face, namedSourceEdges, params.operation);
    if (generatedName) {
      state.faceNameByIndex[faceIndex] = generatedName;
      continue;
    }
    const stats = statsFromOccFace(face);
    if (!full) {
      const startPlaneDistance = Math.abs(dot(sub(stats.centroid, params.startOrigin), params.startNormal));
      const endPlaneDistance = Math.abs(dot(sub(stats.centroid, params.endOrigin), params.endNormal));
      const ds = Math.hypot(...sub(stats.centroid, params.startCentroid));
      const de = Math.hypot(...sub(stats.centroid, params.endCentroid));
      const tol = Math.max(1e-5, params.modelSize * 1e-4);
      if (startPlaneDistance <= tol || ds <= tol || ds < de * 0.1) {
        state.faceNameByIndex[faceIndex] = params.startName;
        continue;
      }
      if (endPlaneDistance <= tol || de <= tol || de < ds * 0.1) {
        state.faceNameByIndex[faceIndex] = params.endName;
        continue;
      }
    }
    state.faceNameByIndex[faceIndex] = classifyRevolveSideFace(stats, params);
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

export function makeRevolution({
  sourceFace = null,
  boundaryLoops = [],
  faceName = "Face",
  axisOrigin = [0, 0, 0],
  axisDirection = [0, 1, 0],
  angleDegrees = 360,
  edgeInputs = [],
  normal = [0, 0, 1],
} = {}) {
  const face = sourceFace || makeFaceFromBoundaryLoops(boundaryLoops, edgeInputs, normal);
  const axisLen = Math.hypot(axisDirection[0], axisDirection[1], axisDirection[2]) || 1;
  const ax = new oc.gp_Ax1_2(
    new oc.gp_Pnt_3(axisOrigin[0], axisOrigin[1], axisOrigin[2]),
    new oc.gp_Dir_4(axisDirection[0] / axisLen, axisDirection[1] / axisLen, axisDirection[2] / axisLen),
  );
  const angleRad = -(Number(angleDegrees) || 360) * Math.PI / 180;
  const revol = new oc.BRepPrimAPI_MakeRevol_1(face, ax, angleRad, false);
  if (typeof revol.IsDone === "function" && !revol.IsDone()) {
    throw new Error("OpenCASCADE revolve failed.");
  }

  const full = Math.abs(Number(angleDegrees) || 360) >= 360 - 1e-6;
  const startName = `${faceName}_START`;
  const endName = `${faceName}_END`;
  const defaultSideName = `${faceName}_RV`;
  const segments = loopSegmentsWithNames(boundaryLoops, edgeInputs, defaultSideName, normal);
  const faceMetadata = new Map();
  if (!full) {
    const endLoops = translatedLoops(boundaryLoops, [0, 0, 0]).map((loop) => ({
      ...loop,
      pts: loop.pts.map((point) => rotatePointAroundAxis(point, axisOrigin, axisDirection, angleRad)),
    }));
    const endEdges = (Array.isArray(edgeInputs) ? edgeInputs : []).map((edge) => ({
      ...edge,
      polyline: (Array.isArray(edge?.polyline) ? edge.polyline : []).map((point) => rotatePointAroundAxis(point, axisOrigin, axisDirection, angleRad)),
      bezierPoles: Array.isArray(edge?.bezierPoles) ? edge.bezierPoles.map((point) => rotatePointAroundAxis(point, axisOrigin, axisDirection, angleRad)) : edge?.bezierPoles,
      circleCenter: Array.isArray(edge?.circleCenter) ? rotatePointAroundAxis(edge.circleCenter, axisOrigin, axisDirection, angleRad) : edge?.circleCenter,
      arcCenter: Array.isArray(edge?.arcCenter) ? rotatePointAroundAxis(edge.arcCenter, axisOrigin, axisDirection, angleRad) : edge?.arcCenter,
    }));
    const startCentroidForNormal = loopsCentroid(boundaryLoops);
    const endCentroidForNormal = rotatePointAroundAxis(startCentroidForNormal, axisOrigin, axisDirection, angleRad);
    const normalTip = addVecToPoint(startCentroidForNormal, normal);
    const endNormalTip = rotatePointAroundAxis(normalTip, axisOrigin, axisDirection, angleRad);
    faceMetadata.set(startName, {
      faceType: "STARTCAP",
      boundaryLoopsWorld: boundaryLoops,
      sketchEdgeInputsWorld: edgeInputs,
      profileNormal: normal,
    });
    faceMetadata.set(endName, {
      faceType: "ENDCAP",
      boundaryLoopsWorld: endLoops,
      sketchEdgeInputsWorld: endEdges,
      profileNormal: sub(endNormalTip, endCentroidForNormal),
    });
  }
  for (const segment of segments) {
    if (!segment.name) continue;
    faceMetadata.set(segment.name, Object.keys(segment.metadata || {}).length ? segment.metadata : { faceType: "SIDEWALL" });
  }
  const startCentroid = loopsCentroid(boundaryLoops);
  const endCentroid = rotatePointAroundAxis(startCentroid, axisOrigin, axisDirection, angleRad);
  const startOrigin = (boundaryLoops || []).find((loop) => Array.isArray(loop?.pts) && loop.pts.length)?.pts?.[0] || startCentroid;
  const endOrigin = rotatePointAroundAxis(startOrigin, axisOrigin, axisDirection, angleRad);
  const startNormal = normalizeVector(normal);
  const endNormal = normalizeVector(sub(rotatePointAroundAxis(addVecToPoint(startCentroid, startNormal), axisOrigin, axisDirection, angleRad), endCentroid));
  const modelSize = Math.max(1, Math.hypot(...sub(startCentroid, axisOrigin)), Math.hypot(...sub(endCentroid, axisOrigin)));
  const state = createOccState({
    shape: revol.Shape(),
    faceNames: uniqueNames([...(full ? [] : [startName, endName]), ...segments.map((segment) => segment.name)]),
    faceMetadata,
    feature: { kind: "revolve", faceName },
  });
  bindRevolveFaceNames(state, {
    sourceFace: face,
    edgeInputs,
    operation: revol,
    startName,
    endName,
    defaultSideName,
    angleDegrees: Number(angleDegrees) || 360,
    angleRad,
    axisOrigin,
    axisDirection,
    startOrigin,
    endOrigin,
    startNormal,
    endNormal,
    startCentroid,
    endCentroid,
    modelSize,
    segments,
  });
  return state;
}

export function makeSphere({ r = 1, name = "Sphere" } = {}) {
  const shape = new oc.BRepPrimAPI_MakeSphere_1(r).Shape();
  const faceMetadata = new Map([[name, { type: "spherical", radius: r }]]);
  return createOccState({ shape, faceNames: [name], faceMetadata, primitive: { kind: "sphere", r, name } });
}

export function makeTorus({ mR = 2, tR = 0.5, arcDegrees = 360, name = "Torus" } = {}) {
  const shape = new oc.BRepPrimAPI_MakeTorus_1(mR, tR).Shape();
  const sideName = `${name}_Side`;
  const faceMetadata = new Map([[sideName, { type: "toroidal", majorRadius: mR, tubeRadius: tR }]]);
  const faceNames = Number(arcDegrees) >= 360 ? [sideName] : [sideName, `${name}_Cap0`, `${name}_Cap1`];
  return createOccState({ shape, faceNames, faceMetadata, primitive: { kind: "torus", mR, tR, arcDegrees, name } });
}

function normalizePathPoints(points) {
  const pts = (Array.isArray(points) ? points : [])
    .filter((point) => Array.isArray(point) && point.length >= 3)
    .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]);
  const deduped = [];
  for (const point of pts) {
    const last = deduped[deduped.length - 1];
    if (!last || pointDistanceSq(last, point) > 1e-18) deduped.push(point);
  }
  return deduped;
}

function pathIsStraight(points) {
  if (!Array.isArray(points) || points.length <= 2) return true;
  const a = points[0];
  const b = points.find((point, index) => index > 0 && pointDistanceSq(a, point) > 1e-18);
  if (!b) return true;
  const axis = sub(b, a);
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen <= 1e-12) return true;
  const tol = Math.max(1e-8, axisLen * 1e-6);
  for (const point of points) {
    const ap = sub(point, a);
    const cross = [
      (ap[1] * axis[2]) - (ap[2] * axis[1]),
      (ap[2] * axis[0]) - (ap[0] * axis[2]),
      (ap[0] * axis[1]) - (ap[1] * axis[0]),
    ];
    if (Math.hypot(cross[0], cross[1], cross[2]) / axisLen > tol) return false;
  }
  return true;
}

function makePolylineWire(points, closed = false) {
  const pts = normalizePathPoints(points);
  if (pts.length < 2) throw new Error("OpenCASCADE tube requires at least two path points.");
  const wire = new oc.BRepBuilderAPI_MakeWire_1();
  const addEdge = (a, b) => {
    if (pointDistanceSq(a, b) <= 1e-18) return;
    wire.Add_1(new oc.BRepBuilderAPI_MakeEdge_3(
      new oc.gp_Pnt_3(a[0], a[1], a[2]),
      new oc.gp_Pnt_3(b[0], b[1], b[2]),
    ).Edge());
  };
  for (let i = 0; i < pts.length - 1; i += 1) addEdge(pts[i], pts[i + 1]);
  if (closed && pointDistanceSq(pts[0], pts[pts.length - 1]) > 1e-18) addEdge(pts[pts.length - 1], pts[0]);
  const result = wire.Wire();
  if (!result || result.IsNull?.()) throw new Error("OpenCASCADE could not build tube path wire.");
  return result;
}

function endpointFrameFromCurveEdge(edge) {
  try {
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const firstParam = Number(curve.FirstParameter());
    const lastParam = Number(curve.LastParameter());
    if (!Number.isFinite(firstParam) || !Number.isFinite(lastParam)) return null;
    const startPoint = new oc.gp_Pnt_1();
    const endPoint = new oc.gp_Pnt_1();
    const startVector = new oc.gp_Vec_1();
    const endVector = new oc.gp_Vec_1();
    curve.D1(firstParam, startPoint, startVector);
    curve.D1(lastParam, endPoint, endVector);
    return {
      startPoint: [startPoint.X(), startPoint.Y(), startPoint.Z()],
      endPoint: [endPoint.X(), endPoint.Y(), endPoint.Z()],
      startTangent: normalizeVector([startVector.X(), startVector.Y(), startVector.Z()]),
      endTangent: normalizeVector([endVector.X(), endVector.Y(), endVector.Z()]),
    };
  } catch {
    return null;
  }
}

function makeLineEdge(a, b) {
  if (pointDistanceSq(a, b) <= 1e-18) return null;
  const edge = new oc.BRepBuilderAPI_MakeEdge_3(
    new oc.gp_Pnt_3(a[0], a[1], a[2]),
    new oc.gp_Pnt_3(b[0], b[1], b[2]),
  ).Edge();
  return edge && !edge.IsNull?.() ? edge : null;
}

function normalizeCurvePoles(poles) {
  return (Array.isArray(poles) ? poles : [])
    .filter((point) => Array.isArray(point) && point.length >= 3)
    .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]);
}

function makePoleArray(poles) {
  const pts = normalizeCurvePoles(poles);
  if (pts.length < 2) return null;
  if (pointDistanceSq(pts[0], pts[pts.length - 1]) <= 1e-18) return null;
  const arr = new oc.TColgp_Array1OfPnt_2(1, pts.length);
  for (let i = 0; i < pts.length; i += 1) {
    const point = pts[i];
    arr.SetValue(i + 1, new oc.gp_Pnt_3(point[0], point[1], point[2]));
  }
  return arr;
}

function makeBezierEdge(poles) {
  const pts = normalizeCurvePoles(poles);
  if (pts.length < 2) return null;
  if (pts.length > 4 && ((pts.length - 1) % 3) === 0) {
    const splineEdge = makeCompositeCubicBezierEdge(pts);
    if (splineEdge) return splineEdge;
  }
  const arr = makePoleArray(pts);
  if (!arr) return null;
  try {
    const bezier = new oc.Geom_BezierCurve_1(arr);
    const curve = new oc.Handle_Geom_Curve_2(bezier);
    const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve).Edge();
    return edge && !edge.IsNull?.() ? edge : null;
  } catch {
    return null;
  }
}

function makeCompositeCubicBezierEdge(poles) {
  const pts = normalizeCurvePoles(poles);
  const segmentCount = (pts.length - 1) / 3;
  if (!Number.isInteger(segmentCount) || segmentCount < 1) return null;
  try {
    const poleArray = new oc.TColgp_Array1OfPnt_2(1, pts.length);
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      poleArray.SetValue(i + 1, new oc.gp_Pnt_3(p[0], p[1], p[2]));
    }
    const knotCount = segmentCount + 1;
    const knotArray = new oc.TColStd_Array1OfReal_2(1, knotCount);
    const multArray = new oc.TColStd_Array1OfInteger_2(1, knotCount);
    for (let i = 0; i < knotCount; i += 1) {
      knotArray.SetValue(i + 1, i);
      multArray.SetValue(i + 1, (i === 0 || i === knotCount - 1) ? 4 : 3);
    }
    const spline = new oc.Geom_BSplineCurve_1(poleArray, knotArray, multArray, 3, false);
    const curve = new oc.Handle_Geom_Curve_2(spline);
    const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve).Edge();
    return edge && !edge.IsNull?.() ? edge : null;
  } catch {
    return null;
  }
}

function makeBSplinePathWire(points) {
  const pts = normalizePathPoints(points);
  if (pts.length < 3) return makePolylineWire(pts, false);
  const arr = new oc.TColgp_Array1OfPnt_2(1, pts.length);
  for (let i = 0; i < pts.length; i += 1) {
    const point = pts[i];
    arr.SetValue(i + 1, new oc.gp_Pnt_3(point[0], point[1], point[2]));
  }
  const maxDegree = Math.min(3, Math.max(2, pts.length - 1));
  const minDegree = Math.min(3, maxDegree);
  const continuity = maxDegree >= 3 ? oc.GeomAbs_Shape.GeomAbs_C2 : oc.GeomAbs_Shape.GeomAbs_C1;
  const builder = new oc.GeomAPI_PointsToBSpline_2(arr, minDegree, maxDegree, continuity, 1e-6);
  if (typeof builder.IsDone === "function" && !builder.IsDone()) {
    throw new Error("OpenCASCADE could not build tube spline path.");
  }
  const bspline = builder.Curve();
  const curve = new oc.Handle_Geom_Curve_2(bspline.get());
  const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve).Edge();
  if (!edge || edge.IsNull?.()) throw new Error("OpenCASCADE could not build tube spline edge.");
  const wire = new oc.BRepBuilderAPI_MakeWire_2(edge).Wire();
  if (!wire || wire.IsNull?.()) throw new Error("OpenCASCADE could not build tube spline wire.");
  return { wire, ...(endpointFrameFromCurveEdge(edge) || {}) };
}

function splinePointPosition(point) {
  const src = Array.isArray(point?.position) ? point.position : [0, 0, 0];
  return [Number(src[0]) || 0, Number(src[1]) || 0, Number(src[2]) || 0];
}

function splinePointDirection(point) {
  const rotation = Array.isArray(point?.rotation) && point.rotation.length >= 3
    ? point.rotation
    : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const sign = point?.flipDirection ? -1 : 1;
  const direction = normalizeVector([
    Number(rotation[0]) * sign || 0,
    Number(rotation[1]) * sign || 0,
    Number(rotation[2]) * sign || 0,
  ]);
  return Math.hypot(direction[0], direction[1], direction[2]) > 1e-12 ? direction : [1, 0, 0];
}

function splineExtensionPoint(anchor, pointData, isForward) {
  const direction = splinePointDirection(pointData);
  const rawDistance = isForward ? pointData?.forwardDistance : pointData?.backwardDistance;
  const distance = rawDistance == null ? 1.0 : Math.max(0, Number(rawDistance) || 0);
  return vectorAdd(anchor, vectorScale(direction, isForward ? distance : -distance));
}

function makeHermiteSplineWire(pathCurve, endpointExtension = 0) {
  const pointsData = Array.isArray(pathCurve?.spline?.points) ? pathCurve.spline.points : [];
  if (pointsData.length < 2) return null;
  const clampedBendRadius = Math.max(0.1, Math.min(5.0, Number(pathCurve?.bendRadius) || 1.0));
  const wire = new oc.BRepBuilderAPI_MakeWire_1();
  const edges = [];
  const addEdge = (edge) => {
    if (!edge || edge.IsNull?.()) return;
    wire.Add_1(edge);
    edges.push(edge);
  };
  const addLine = (a, b) => addEdge(makeLineEdge(a, b));
  const addBezier = (poles) => addEdge(makeBezierEdge(poles));
  const anchors = pointsData.map((point) => splinePointPosition(point));
  const extra = Math.max(0, Number(endpointExtension) || 0);

  if (extra > 0) {
    const startDir = splinePointDirection(pointsData[0]);
    addLine(vectorAdd(anchors[0], vectorScale(startDir, -extra)), anchors[0]);
  }

  for (let i = 0; i < pointsData.length - 1; i += 1) {
    const currentAnchor = anchors[i];
    const nextAnchor = anchors[i + 1];
    const currentData = pointsData[i];
    const nextData = pointsData[i + 1];
    const currentForwardExt = splineExtensionPoint(currentAnchor, currentData, true);
    const nextBackwardExt = splineExtensionPoint(nextAnchor, nextData, false);

    addLine(currentAnchor, currentForwardExt);

    const currentExtDirection = normalizeVector(sub(currentForwardExt, currentAnchor));
    const nextExtDirection = normalizeVector(sub(nextAnchor, nextBackwardExt));
    const extDistance = Math.hypot(...sub(currentForwardExt, nextBackwardExt));
    const avgExtDistance = ((Number(currentData?.forwardDistance) || 0) + (Number(nextData?.backwardDistance) || 0)) * 0.5;
    const baseScale = Math.max(extDistance * 0.3, avgExtDistance * 0.5);
    const tangentScale = baseScale * clampedBendRadius;
    const t0 = vectorScale(currentExtDirection, tangentScale);
    const t1 = vectorScale(nextExtDirection, tangentScale);
    addBezier([
      currentForwardExt,
      vectorAdd(currentForwardExt, vectorScale(t0, 1 / 3)),
      vectorAdd(nextBackwardExt, vectorScale(t1, -1 / 3)),
      nextBackwardExt,
    ]);

    addLine(nextBackwardExt, nextAnchor);
  }

  if (extra > 0) {
    const lastIndex = pointsData.length - 1;
    const endDir = splinePointDirection(pointsData[lastIndex]);
    addLine(anchors[lastIndex], vectorAdd(anchors[lastIndex], vectorScale(endDir, extra)));
  }

  if (!edges.length) return null;
  const result = wire.Wire();
  if (!result || result.IsNull?.()) throw new Error("OpenCASCADE could not build tube spline wire.");
  return {
    wire: result,
    startPoint: extra > 0 ? vectorAdd(anchors[0], vectorScale(splinePointDirection(pointsData[0]), -extra)) : anchors[0],
    endPoint: extra > 0 ? vectorAdd(anchors[anchors.length - 1], vectorScale(splinePointDirection(pointsData[pointsData.length - 1]), extra)) : anchors[anchors.length - 1],
    startTangent: splinePointDirection(pointsData[0]),
    endTangent: splinePointDirection(pointsData[pointsData.length - 1]),
  };
}

function canBuildHermiteSplineWire(pathCurve) {
  if (pathCurve?.type !== "hermite-extension-spline") return false;
  const pointsData = Array.isArray(pathCurve?.spline?.points) ? pathCurve.spline.points : [];
  if (pointsData.length < 2) return false;
  return pointsData.every((point) => Array.isArray(point?.rotation) && point.rotation.length >= 9);
}

function vectorAdd(a, b) {
  return [
    Number(a?.[0] || 0) + Number(b?.[0] || 0),
    Number(a?.[1] || 0) + Number(b?.[1] || 0),
    Number(a?.[2] || 0) + Number(b?.[2] || 0),
  ];
}

function vectorScale(v, scale) {
  return [
    Number(v?.[0] || 0) * scale,
    Number(v?.[1] || 0) * scale,
    Number(v?.[2] || 0) * scale,
  ];
}

function makeTubeSpineWire(points, closed = false, pathCurve = null) {
  const pts = normalizePathPoints(points);
  if (pts.length < 2) throw new Error("OpenCASCADE tube requires at least two path points.");
  const hermite = !closed && canBuildHermiteSplineWire(pathCurve)
    ? makeHermiteSplineWire(pathCurve)
    : null;
  if (hermite) return hermite;
  if (closed || pts.length <= 2 || pathIsStraight(pts)) {
    return {
      wire: makePolylineWire(pts, closed),
      startPoint: pts[0],
      endPoint: pts[pts.length - 1],
      startTangent: normalizeVector(sub(pts[1], pts[0])),
      endTangent: normalizeVector(sub(pts[pts.length - 1], pts[pts.length - 2])),
    };
  }
  return makeBSplinePathWire(pts);
}

function tubePathPrimitiveData(pathPoints, pathCurve = null, endpointExtension = 0, spineFrame = null) {
  const pointsData = Array.isArray(pathCurve?.spline?.points) ? pathCurve.spline.points : [];
  const sampledStart = Array.isArray(spineFrame?.startPoint) ? spineFrame.startPoint : pathPoints[0];
  const sampledEnd = Array.isArray(spineFrame?.endPoint) ? spineFrame.endPoint : pathPoints[pathPoints.length - 1];
  const sampledStartTangent = normalizeVector(sub(
    Array.isArray(spineFrame?.startTangent) ? vectorAdd(sampledStart, spineFrame.startTangent) : (pathPoints.find((point, index) => index > 0 && pointDistanceSq(sampledStart, point) > 1e-18) || pathPoints[1]),
    sampledStart,
  ));
  const sampledEndTangent = normalizeVector(sub(
    sampledEnd,
    Array.isArray(spineFrame?.endTangent) ? vectorAdd(sampledEnd, vectorScale(spineFrame.endTangent, -1)) : ([...pathPoints].reverse().find((point, index) => index > 0 && pointDistanceSq(sampledEnd, point) > 1e-18) || pathPoints[pathPoints.length - 2]),
  ));
  if (pathCurve?.type === "hermite-extension-spline" && pointsData.length >= 2) {
    const extra = Math.max(0, Number(endpointExtension) || 0);
    return {
      points: pathPoints,
      startPoint: extra > 0 ? vectorAdd(sampledStart, vectorScale(sampledStartTangent, -extra)) : sampledStart,
      endPoint: extra > 0 ? vectorAdd(sampledEnd, vectorScale(sampledEndTangent, extra)) : sampledEnd,
      startTangent: sampledStartTangent,
      endTangent: sampledEndTangent,
    };
  }
  return { points: pathPoints, startTangent: sampledStartTangent, endTangent: sampledEndTangent };
}

function makeCircleWire(center, normal, xDirection, radius) {
  const n = normalizeVector(normal);
  const x = normalizeVector(xDirection);
  const axis = new oc.gp_Ax2_2(
    new oc.gp_Pnt_3(center[0], center[1], center[2]),
    new oc.gp_Dir_4(n[0], n[1], n[2]),
    new oc.gp_Dir_4(x[0], x[1], x[2]),
  );
  return new oc.BRepBuilderAPI_MakeWire_2(
    new oc.BRepBuilderAPI_MakeEdge_8(new oc.gp_Circ_2(axis, radius)).Edge(),
  ).Wire();
}

function tubeProfileFrame(points, pathCurve = null, endpointExtension = 0, spineFrame = null) {
  const pathData = tubePathPrimitiveData(points, pathCurve, endpointExtension, spineFrame);
  const start = Array.isArray(pathData.startPoint) ? pathData.startPoint : points[0];
  const tangent = normalizeVector(
    Array.isArray(pathData.startTangent)
      ? pathData.startTangent
      : sub(
        points.find((point, index) => index > 0 && pointDistanceSq(start, point) > 1e-18) || points[1],
        start,
      ),
  );
  let xDir = Math.abs(tangent[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const tangentDot = dot(xDir, tangent);
  xDir = normalizeVector([
    xDir[0] - tangent[0] * tangentDot,
    xDir[1] - tangent[1] * tangentDot,
    xDir[2] - tangent[2] * tangentDot,
  ]);
  return { start, tangent, xDir, pathData };
}

function reverseWire(wire) {
  try {
    return oc.TopoDS.Wire_1(wire.Reversed());
  } catch {
    return wire;
  }
}

function tubeProfileFace(points, outerRadius, innerRadius = 0, pathCurve = null, endpointExtension = 0, spineFrame = null) {
  const { start, tangent, xDir, pathData } = tubeProfileFrame(points, pathCurve, endpointExtension, spineFrame);
  const outerWire = makeCircleWire(start, tangent, xDir, outerRadius);
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);
  const insideRadius = Math.max(0, Number(innerRadius) || 0);
  if (insideRadius > 0) {
    faceMaker.Add(reverseWire(makeCircleWire(start, tangent, xDir, insideRadius)));
  }
  if (typeof faceMaker.IsDone === "function" && !faceMaker.IsDone()) {
    throw new Error("OpenCASCADE could not build tube profile face.");
  }
  return {
    face: oc.TopoDS.Face_1(faceMaker.Shape()),
    pathData,
  };
}

function makePipeShape(spine, profile) {
  const pipe = new oc.BRepOffsetAPI_MakePipe_1(spine, profile);
  if (typeof pipe.IsDone === "function" && !pipe.IsDone()) throw new Error("OpenCASCADE tube pipe failed.");
  return pipe.Shape();
}

function centroidOfLoops(loops) {
  const points = [];
  for (const loop of loops || []) {
    const arr = Array.isArray(loop?.pts) ? loop.pts : loop;
    if (!Array.isArray(arr)) continue;
    for (const point of arr) {
      if (Array.isArray(point) && point.length >= 3) points.push(point);
    }
  }
  if (!points.length) return [0, 0, 0];
  const sum = [0, 0, 0];
  for (const point of points) {
    sum[0] += Number(point[0]) || 0;
    sum[1] += Number(point[1]) || 0;
    sum[2] += Number(point[2]) || 0;
  }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function cross(a, b) {
  return [
    (Number(a?.[1] || 0) * Number(b?.[2] || 0)) - (Number(a?.[2] || 0) * Number(b?.[1] || 0)),
    (Number(a?.[2] || 0) * Number(b?.[0] || 0)) - (Number(a?.[0] || 0) * Number(b?.[2] || 0)),
    (Number(a?.[0] || 0) * Number(b?.[1] || 0)) - (Number(a?.[1] || 0) * Number(b?.[0] || 0)),
  ];
}

function rotateVectorBetween(point, fromNormal, toNormal, origin) {
  const from = normalizeVector(fromNormal);
  const to = normalizeVector(toNormal);
  const p = sub(point, origin);
  const fromLen = Math.hypot(from[0], from[1], from[2]);
  const toLen = Math.hypot(to[0], to[1], to[2]);
  if (fromLen <= 1e-12 || toLen <= 1e-12) return point.slice();

  const c = Math.max(-1, Math.min(1, dot(from, to)));
  if (c > 1 - 1e-12) return point.slice();

  let axis = cross(from, to);
  let s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s <= 1e-12) {
    axis = Math.abs(from[0]) < 0.8 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]);
    s = Math.hypot(axis[0], axis[1], axis[2]);
  }
  axis = [axis[0] / s, axis[1] / s, axis[2] / s];
  const angle = Math.acos(c);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const axisDot = dot(axis, p);
  const axisCrossP = cross(axis, p);
  return [
    origin[0] + (p[0] * cosA) + (axisCrossP[0] * sinA) + (axis[0] * axisDot * (1 - cosA)),
    origin[1] + (p[1] * cosA) + (axisCrossP[1] * sinA) + (axis[1] * axisDot * (1 - cosA)),
    origin[2] + (p[2] * cosA) + (axisCrossP[2] * sinA) + (axis[2] * axisDot * (1 - cosA)),
  ];
}

function rotateAroundAxis(point, axisOrigin, axisDirection, angleRadians) {
  const axis = normalizeVector(axisDirection);
  if (Math.hypot(axis[0], axis[1], axis[2]) <= 1e-12 || Math.abs(angleRadians) <= 1e-12) return point.slice();
  const p = sub(point, axisOrigin);
  const cosA = Math.cos(angleRadians);
  const sinA = Math.sin(angleRadians);
  const axisDot = dot(axis, p);
  const axisCrossP = cross(axis, p);
  return [
    axisOrigin[0] + (p[0] * cosA) + (axisCrossP[0] * sinA) + (axis[0] * axisDot * (1 - cosA)),
    axisOrigin[1] + (p[1] * cosA) + (axisCrossP[1] * sinA) + (axis[1] * axisDot * (1 - cosA)),
    axisOrigin[2] + (p[2] * cosA) + (axisCrossP[2] * sinA) + (axis[2] * axisDot * (1 - cosA)),
  ];
}

function transformPointForSweep(point, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile) {
  const rotated = rotateProfile
    ? rotateVectorBetween(point, sourceNormal, targetNormal, profileCentroid)
    : point.slice();
  return [
    rotated[0] + targetStart[0] - profileCentroid[0],
    rotated[1] + targetStart[1] - profileCentroid[1],
    rotated[2] + targetStart[2] - profileCentroid[2],
  ];
}

function transformSweepLoops(loops, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile) {
  return (Array.isArray(loops) ? loops : []).map((loop) => ({
    ...loop,
    pts: (Array.isArray(loop?.pts) ? loop.pts : loop || [])
      .map((point) => transformPointForSweep(point, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile)),
  }));
}

function transformSweepEdgeInputs(edgeInputs, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile) {
  const xform = (point) => (
    Array.isArray(point) && point.length >= 3
      ? transformPointForSweep(point, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile)
      : point
  );
  return (Array.isArray(edgeInputs) ? edgeInputs : []).map((edge) => ({
    ...edge,
    polyline: (Array.isArray(edge?.polyline) ? edge.polyline : []).map(xform),
    bezierPoles: Array.isArray(edge?.bezierPoles) ? edge.bezierPoles.map(xform) : edge?.bezierPoles,
    circleCenter: xform(edge?.circleCenter),
    arcCenter: xform(edge?.arcCenter),
  }));
}

function sweepPathPointsForMode(pathPoints, profileCentroid, mode) {
  const pts = normalizePathPoints(pathPoints);
  if (pts.length < 2) throw new Error("OpenCASCADE sweep requires at least two path points.");
  if (mode === "pathAlign") return pts;
  const start = pts[0];
  return pts.map((point) => [
    profileCentroid[0] + point[0] - start[0],
    profileCentroid[1] + point[1] - start[1],
    profileCentroid[2] + point[2] - start[2],
  ]);
}

function sweepSideNames(edgeInputs, featureID) {
  const out = [];
  for (let i = 0; i < (edgeInputs || []).length; i += 1) {
    const edge = edgeInputs[i];
    const raw = String(edge?.name || edge?.sketchGeometryId || "").trim();
    out.push(raw || `${featureID}_SIDE_${i}`);
  }
  return uniqueNames(out);
}

function pathSegmentLengths(points) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const len = Math.hypot(...sub(points[i + 1], points[i]));
    lengths.push(len);
    total += len;
  }
  return { lengths, total };
}

function sampleSweepPath(points, count) {
  const { lengths, total } = pathSegmentLengths(points);
  if (!(total > 1e-12)) return [];
  const samples = [];
  const sampleCount = Math.max(2, Math.floor(count) || 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    let distance = total * t;
    let segIndex = 0;
    while (segIndex < lengths.length - 1 && distance > lengths[segIndex]) {
      distance -= lengths[segIndex];
      segIndex += 1;
    }
    const a = points[segIndex];
    const b = points[segIndex + 1];
    const len = lengths[segIndex] || 1;
    const u = Math.max(0, Math.min(1, distance / len));
    const point = [
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
    ];
    samples.push({
      t,
      point,
      tangent: normalizeVector(sub(b, a)),
    });
  }
  return samples;
}

function makeTwistedSweepLoftForLoop(loop, normal, spinePoints, mode, twistAngle, name) {
  const profileCentroid = centroidOfLoops([loop]);
  const sourceNormal = finiteNormalOrFallback(normal, loop.pts);
  const { total } = pathSegmentLengths(spinePoints);
  const sectionCount = Math.min(80, Math.max(6, Math.ceil(total / 2) + 1, Math.ceil(Math.abs(twistAngle) / 12) + 2));
  const samples = sampleSweepPath(spinePoints, sectionCount);
  if (samples.length < 2) throw new Error("OpenCASCADE twisted sweep path is too short.");

  const op = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  for (const sample of samples) {
    const targetNormal = mode === "pathAlign" ? sample.tangent : sourceNormal;
    const aligned = loop.pts.map((point) => (
      transformPointForSweep(point, profileCentroid, sample.point, sourceNormal, targetNormal, mode === "pathAlign")
    ));
    const twisted = aligned.map((point) => rotateAroundAxis(point, sample.point, targetNormal, (twistAngle * Math.PI / 180) * sample.t));
    op.AddWire(makeLoftSectionWire(twisted, { loops: [{ pts: twisted, isHole: false }], normal: targetNormal }));
  }
  op.Build();
  if (typeof op.IsDone === "function" && !op.IsDone()) {
    throw new Error("OpenCASCADE twisted sweep loft failed.");
  }
  const shape = op.Shape();
  if (!shape || shape.IsNull?.()) throw new Error(`OpenCASCADE twisted sweep "${name || "Sweep"}" produced an empty shape.`);
  return shape;
}

function makeTwistedSweepShape({ boundaryLoops, normal, spinePoints, mode, twistAngle, name }) {
  const loops = (Array.isArray(boundaryLoops) ? boundaryLoops : [])
    .map((loop) => ({ ...loop, pts: Array.isArray(loop?.pts) ? loop.pts : loop }))
    .filter((loop) => Array.isArray(loop.pts) && loop.pts.length >= 3);
  const solidLoops = loops.filter((loop) => !loop.isHole);
  const holeLoops = loops.filter((loop) => !!loop.isHole);
  if (solidLoops.length !== 1) {
    throw new Error("OpenCASCADE twisted sweep requires one solid profile loop at a time.");
  }

  let shape = makeTwistedSweepLoftForLoop(solidLoops[0], normal, spinePoints, mode, twistAngle, name);
  for (const holeLoop of holeLoops) {
    const holeShape = makeTwistedSweepLoftForLoop(holeLoop, normal, spinePoints, mode, twistAngle, `${name || "Sweep"}_HOLE`);
    const cut = new oc.BRepAlgoAPI_Cut_3(shape, holeShape);
    cut.Build();
    if (typeof cut.IsDone === "function" && !cut.IsDone()) {
      throw new Error("OpenCASCADE twisted sweep hole cut failed.");
    }
    const nextShape = cut.Shape();
    if (!nextShape || nextShape.IsNull?.()) throw new Error("OpenCASCADE twisted sweep hole cut produced an empty shape.");
    shape = nextShape;
  }
  return shape;
}

export function makePathSweep({
  boundaryLoops = [],
  edgeInputs = [],
  normal = [0, 0, 1],
  pathPoints = [],
  mode = "translate",
  name = "Sweep",
  faceName = "Face",
  omitBaseCap = false,
  twistAngle = 0,
} = {}) {
  const normalizedPath = normalizePathPoints(pathPoints);
  if (normalizedPath.length < 2) throw new Error("OpenCASCADE path sweep requires a path edge.");
  const twist = Number(twistAngle) || 0;

  const profileCentroid = centroidOfLoops(boundaryLoops);
  const pathMode = mode === "pathAlign" ? "pathAlign" : "translate";
  const spinePoints = sweepPathPointsForMode(normalizedPath, profileCentroid, pathMode);
  const sourceNormal = finiteNormalOrFallback(normal, boundaryLoops?.[0]?.pts || boundaryLoops?.[0] || []);
  const closed = pointDistanceSq(spinePoints[0], spinePoints[spinePoints.length - 1]) <= 1e-18;
  let shape = null;
  if (Math.abs(twist) > 1e-12) {
    shape = makeTwistedSweepShape({
      boundaryLoops,
      normal: sourceNormal,
      spinePoints,
      mode: pathMode,
      twistAngle: twist,
      name,
    });
  } else {
    const targetStart = spinePoints[0];
    const startTangent = normalizeVector(sub(spinePoints[1], spinePoints[0]));
    const targetNormal = pathMode === "pathAlign" ? startTangent : sourceNormal;
    const rotateProfile = pathMode === "pathAlign";
    const profileLoops = transformSweepLoops(boundaryLoops, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile);
    const profileEdges = transformSweepEdgeInputs(edgeInputs, profileCentroid, targetStart, sourceNormal, targetNormal, rotateProfile);
    const profileFace = makeFaceFromBoundaryLoops(profileLoops, profileEdges, targetNormal);
    const spine = makeTubeSpineWire(spinePoints, closed, null);
    shape = makePipeShape(spine.wire, profileFace);
  }
  const featureTag = name ? `${name}:` : "";
  const startName = `${featureTag}${faceName}_START`;
  const endName = `${featureTag}${faceName}_END`;
  const sideNames = sweepSideNames(edgeInputs, name || "SWEEP");
  const capNames = closed || omitBaseCap ? [] : [startName, endName];
  const faceMetadata = new Map();
  for (const sideName of sideNames) faceMetadata.set(sideName, { faceType: "SIDEWALL" });
  if (!closed && !omitBaseCap) {
    faceMetadata.set(startName, { faceType: "STARTCAP" });
    faceMetadata.set(endName, { faceType: "ENDCAP" });
  }
  return createOccState({
    shape,
    faceNames: uniqueNames([...capNames, ...sideNames]),
    faceMetadata,
    meshOptions: { deflection: 0.08, angle: 0.35 },
    feature: {
      kind: "sweep",
      name,
      faceName,
      mode: pathMode,
      pathPoints: spinePoints,
      profileCentroid,
    },
  });
}

export function makeTube({ points = [], radius = 1, innerRadius = 0, closed = false, name = "Tube", pathCurve = null, endpointExtension = 0 } = {}) {
  const pathPoints = normalizePathPoints(points);
  const outerRadius = Number(radius);
  const insideRadius = Math.max(0, Number(innerRadius) || 0);
  if (!(outerRadius > 0)) throw new Error("OpenCASCADE tube requires a positive outer radius.");
  if (insideRadius >= outerRadius) throw new Error("OpenCASCADE tube inner radius must be smaller than the outer radius.");
  const spine = makeTubeSpineWire(pathPoints, closed, pathCurve);
  const { face: profile, pathData } = tubeProfileFace(pathPoints, outerRadius, insideRadius, pathCurve, endpointExtension, spine);
  const shape = makePipeShape(spine.wire, profile);
  const faceNames = insideRadius > 0
    ? [`${name}_Outer`, `${name}_Inner`, ...(closed ? [] : [`${name}_CapStart`, `${name}_CapEnd`])]
    : [`${name}_Outer`, ...(closed ? [] : [`${name}_CapStart`, `${name}_CapEnd`])];
  const faceMetadata = new Map([
    [`${name}_Outer`, { type: "tube", radius: outerRadius, innerRadius: insideRadius }],
  ]);
  if (insideRadius > 0) faceMetadata.set(`${name}_Inner`, { type: "tube_inner", radius: insideRadius, outerRadius });
  const state = createOccState({
    shape,
    faceNames,
    faceMetadata,
    meshOptions: {
      deflection: Math.max(outerRadius * 0.1, 0.04),
      angle: 0.35,
    },
    primitive: {
      kind: "tube",
      ...pathData,
      radius: outerRadius,
      innerRadius: insideRadius,
      closed: !!closed,
      name,
    },
  });
  bindPrimitiveFaceNames(state);
  return state;
}

export function transformOccState(state, matrixLike) {
  const elements = Array.from(matrixLike?.elements || []);
  if (!state?.shape || elements.length !== 16) return state;
  const trsf = new oc.gp_Trsf_1();
  trsf.SetValues(
    elements[0], elements[4], elements[8], elements[12],
    elements[1], elements[5], elements[9], elements[13],
    elements[2], elements[6], elements[10], elements[14],
  );
  const transformed = new oc.BRepBuilderAPI_Transform_2(state.shape, trsf, true).Shape();
  return createOccState({
    ...state,
    shape: transformed,
  });
}

function uniqueNames(names) {
  const seen = new Set();
  const out = [];
  for (const name of names || []) {
    const value = String(name || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function cloneMetadataMaps(left, right) {
  return {
    faceMetadata: new Map([
      ...(left?._faceMetadata instanceof Map ? left._faceMetadata.entries() : []),
      ...(right?._faceMetadata instanceof Map ? right._faceMetadata.entries() : []),
    ]),
    edgeMetadata: new Map([
      ...(left?._edgeMetadata instanceof Map ? left._edgeMetadata.entries() : []),
      ...(right?._edgeMetadata instanceof Map ? right._edgeMetadata.entries() : []),
    ]),
  };
}

function cloneMetadataMapsMany(solids) {
  const faceMetadata = new Map();
  const edgeMetadata = new Map();
  for (const solid of solids || []) {
    for (const entry of solid?._faceMetadata instanceof Map ? solid._faceMetadata.entries() : []) {
      faceMetadata.set(entry[0], entry[1]);
    }
    for (const entry of solid?._edgeMetadata instanceof Map ? solid._edgeMetadata.entries() : []) {
      edgeMetadata.set(entry[0], entry[1]);
    }
  }
  return { faceMetadata, edgeMetadata };
}

function getFaceNameForIndex(state, index, stats = null) {
  if (Array.isArray(state?.faceNameByIndex) && state.faceNameByIndex[index]) return state.faceNameByIndex[index];
  const classified = classifyPrimitiveFace(state, stats);
  if (classified) {
    if (!Array.isArray(state.faceNameByIndex)) state.faceNameByIndex = [];
    state.faceNameByIndex[index] = classified;
    return classified;
  }
  const names = Array.isArray(state?.faceNames) ? state.faceNames : [];
  return names[index] || names[names.length - 1] || `FACE_${index + 1}`;
}

function bindPrimitiveFaceNames(state) {
  state.meshCache = null;
  state.faceNameByIndex = null;
  tessellateOccState(state, { bindOnly: true });
  state.meshCache = null;
}

function classifyPrimitiveFace(state, stats) {
  const primitive = state?.primitive || null;
  const name = primitive?.name || "";
  if (!primitive || !stats) return null;
  const c = stats.centroid;
  if (primitive.kind === "box") {
    const candidates = [
      [`${name}_NX`, Math.abs(c[0])],
      [`${name}_PX`, Math.abs(c[0] - primitive.x)],
      [`${name}_NY`, Math.abs(c[1])],
      [`${name}_PY`, Math.abs(c[1] - primitive.y)],
      [`${name}_NZ`, Math.abs(c[2])],
      [`${name}_PZ`, Math.abs(c[2] - primitive.z)],
    ];
    candidates.sort((a, b) => a[1] - b[1]);
    return candidates[0]?.[0] || null;
  }
  if (primitive.kind === "cylinder") {
    if (Math.abs(c[1]) < 1e-6) return `${name}_B`;
    if (Math.abs(c[1] - primitive.height) < 1e-6) return `${name}_T`;
    return `${name}_S`;
  }
  if (primitive.kind === "cone") {
    if (Math.abs(c[1]) < 1e-6) return `${name}_B`;
    if (Math.abs(c[1] - primitive.h) < 1e-6) return `${name}_T`;
    return `${name}_S`;
  }
  if (primitive.kind === "tube") {
    const points = Array.isArray(primitive.points) ? primitive.points : [];
    const first = Array.isArray(primitive.startPoint) ? primitive.startPoint : points[0];
    const last = Array.isArray(primitive.endPoint) ? primitive.endPoint : points[points.length - 1];
    const closed = !!primitive.closed;
    if (!closed && first && points[1] && last && points.length >= 2) {
      const startDir = normalizeVector(primitive.startTangent || sub(points[1], first));
      const endDir = normalizeVector(primitive.endTangent || sub(last, points[points.length - 2]));
      const scale = Math.max(Number(primitive.radius) || 1, 1);
      if (pointDistanceSq(c, first) <= scale * scale * 0.25) return `${name}_CapStart`;
      if (pointDistanceSq(c, last) <= scale * scale * 0.25) return `${name}_CapEnd`;
      if (Math.abs(dot(sub(c, first), startDir)) <= scale * 1e-3) return `${name}_CapStart`;
      if (Math.abs(dot(sub(c, last), endDir)) <= scale * 1e-3) return `${name}_CapEnd`;
    }
    if ((Number(primitive.innerRadius) || 0) > 0) {
      const midpointRadius = ((Number(primitive.radius) || 0) + (Number(primitive.innerRadius) || 0)) * 0.5;
      const averageRadius = averageDistanceToPath(stats.points, points, closed);
      if (Number.isFinite(averageRadius)) {
        return averageRadius < midpointRadius ? `${name}_Inner` : `${name}_Outer`;
      }
      const closest = closestPathPoint(c, points, closed);
      const radial = normalizeVector(sub(c, closest?.point || c));
      const normal = normalizeVector(stats.normal);
      const normalDot = dot(normal, radial);
      if (Math.abs(normalDot) > 1e-6) {
        return normalDot < 0 ? `${name}_Inner` : `${name}_Outer`;
      }
      const dist2 = closest?.dist2 ?? Infinity;
      return Math.sqrt(dist2) < midpointRadius ? `${name}_Inner` : `${name}_Outer`;
    }
    return `${name}_Outer`;
  }
  if (primitive.kind === "pyramid") {
    if (Math.abs(c[1]) < 1e-6) return `${name}_Base`;
    const sides = Math.max(3, Math.floor(Number(primitive.s) || 4));
    let angle = Math.atan2(c[2], c[0]);
    if (angle < 0) angle += Math.PI * 2;
    const index = Math.floor((angle / (Math.PI * 2)) * sides + 1e-9) % sides;
    return `${name}_S[${index}]`;
  }
  if (primitive.kind === "sphere") return name;
  if (primitive.kind === "torus") return `${name}_Side`;
  return null;
}

function makeFaceStats(points) {
  if (!points.length) return { centroid: [0, 0, 0] };
  const sum = [0, 0, 0];
  for (const point of points) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  return { centroid: [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length] };
}

function pointWithLocation(point, location) {
  try {
    if (location && !location.IsIdentity?.()) {
      const transformed = point.Transformed(location.Transformation());
      return [transformed.X(), transformed.Y(), transformed.Z()];
    }
  } catch {
    // Fall back to the raw triangulation node.
  }
  return [point.X(), point.Y(), point.Z()];
}

function occFaceIsForward(face) {
  try {
    return face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_FORWARD;
  } catch {
    return true;
  }
}

function occFaceNeedsTriangleReverse(face) {
  return !occFaceIsForward(face);
}

function occFaceTriangulation(face, location) {
  try {
    return oc.BRep_Tool.Triangulation(face, location, 0);
  } catch {
    return oc.BRep_Tool.Triangulation(face, location);
  }
}

function cleanOccTriangulation(shape) {
  try {
    if (shape && typeof oc.BRepTools?.Clean === "function") oc.BRepTools.Clean(shape);
  } catch {
    // Some OCCT.js builds may omit this binding; remeshing still works when the
    // shape has no cached Poly_Triangulation yet.
  }
}

function statsFromOccFace(face) {
  const points = [];
  try {
    const location = new oc.TopLoc_Location_1();
    const handle = occFaceTriangulation(face, location);
    if (!handle || handle.IsNull()) return { centroid: [0, 0, 0], points: [], normal: surfaceNormalFromOccFace(face) || [0, 0, 0] };
    const triangulation = handle.get();
    for (let i = 1; i <= triangulation.NbNodes(); i += 1) {
      const point = triangulation.Node(i);
      points.push(pointWithLocation(point, location));
    }
  } catch {
    // Fall through to the zero-centroid result below.
  }
  return { ...makeFaceStats(points), points, normal: surfaceNormalFromOccFace(face) || [0, 0, 0] };
}

function occFaceSurfaceTypeValue(face) {
  try {
    const adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    return Number(adaptor.GetType?.()?.value);
  } catch {
    return NaN;
  }
}

function normalizeVector(v) {
  const len = Math.hypot(v?.[0] || 0, v?.[1] || 0, v?.[2] || 0);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

function triangleNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function polygonPlaneNormal(points) {
  const pts = Array.isArray(points) ? points : [];
  const accum = [0, 0, 0];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    accum[0] += (Number(a[1] || 0) - Number(b[1] || 0)) * (Number(a[2] || 0) + Number(b[2] || 0));
    accum[1] += (Number(a[2] || 0) - Number(b[2] || 0)) * (Number(a[0] || 0) + Number(b[0] || 0));
    accum[2] += (Number(a[0] || 0) - Number(b[0] || 0)) * (Number(a[1] || 0) + Number(b[1] || 0));
  }
  return normalizeVector(accum);
}

function finiteNormalOrFallback(normal, fallbackPoints) {
  const n = normalizeVector(normal);
  if (Math.hypot(n[0], n[1], n[2]) > 1e-12) return n;
  const fallback = polygonPlaneNormal(fallbackPoints);
  if (Math.hypot(fallback[0], fallback[1], fallback[2]) > 1e-12) return fallback;
  return [0, 0, 1];
}

function collectNamedOccFaces(solid, options = {}) {
  const state = solid?._occ;
  if (!state?.shape) return [];
  state.faceNameToID = solid._faceNameToID;
  tessellateOccState(state, options);

  const faces = [];
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    faces.push({
      name: getFaceNameForIndex(state, faceIndex),
      face,
      surfaceType: occFaceSurfaceTypeValue(face),
      ...statsFromOccFace(face),
    });
  }
  return faces;
}

function listContainsSameShape(list, shape) {
  if (!list || !shape) return false;
  const size = Number(list.Size?.() || 0);
  if (size <= 0) return false;
  try {
    for (const candidate of [list.First_1?.(), list.First_2?.()]) {
      if (candidate && (candidate.IsSame?.(shape) || candidate.IsEqual?.(shape))) return true;
    }
  } catch {
    // The list API varies by binding; fall back to geometric matching.
  }
  return false;
}

function occVerticesForShape(shape) {
  const vertices = [];
  if (!shape) return vertices;
  try {
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; explorer.More(); explorer.Next()) {
      vertices.push(oc.TopoDS.Vertex_1(explorer.Current()));
    }
  } catch {
    return [];
  }
  return vertices;
}

function occVertexPoint(vertex) {
  if (!vertex) return null;
  try {
    const p = oc.BRep_Tool.Pnt(vertex);
    return [p.X(), p.Y(), p.Z()];
  } catch {
    return null;
  }
}

function occVertexKey(vertex) {
  const point = occVertexPoint(vertex);
  return point ? pointKeyFromArray(point) : null;
}

function historyMapsShapeToResult(history, sourceShape, resultShape) {
  if (!history || !sourceShape || !resultShape) return false;
  try {
    if (listContainsSameShape(history.Modified(sourceShape), resultShape)) return true;
  } catch {
    // Optional history API.
  }
  try {
    if (listContainsSameShape(history.Generated(sourceShape), resultShape)) return true;
  } catch {
    // Optional history API.
  }
  return false;
}

function sameOccSurfaceType(a, b) {
  const av = Number(a);
  const bv = Number(b);
  return Number.isFinite(av) && Number.isFinite(bv) && av === bv;
}

function chooseSourceFaceName(resultFace, sources, booleanOp = null) {
  for (const source of sources) {
    try {
      if (resultFace.IsSame?.(source.face) || resultFace.IsEqual?.(source.face)) return source.name;
    } catch {
      // Continue with history/geometric matching.
    }
    if (historyMapsShapeToResult(booleanOp, source.face, resultFace)) return source.name;
  }

  const stats = statsFromOccFace(resultFace);
  let best = null;
  for (const source of sources) {
    const dot = Math.abs(
      (stats.normal[0] * source.normal[0])
      + (stats.normal[1] * source.normal[1])
      + (stats.normal[2] * source.normal[2])
    );
    const dist = Math.hypot(
      stats.centroid[0] - source.centroid[0],
      stats.centroid[1] - source.centroid[1],
      stats.centroid[2] - source.centroid[2],
    );
    const score = dot - Math.min(dist, 1000) * 1e-4;
    if (!best || score > best.score + 1e-9) best = { name: source.name, score };
  }
  return best?.name || null;
}

function simplifyOccBooleanResult(booleanOp) {
  if (!booleanOp || typeof booleanOp.Shape !== "function") {
    return { shape: null, history: booleanOp };
  }
  if (typeof booleanOp.SimplifyResult === "function") {
    try {
      booleanOp.SimplifyResult(
        OCC_BOOLEAN_UNIFY_EDGES,
        OCC_BOOLEAN_UNIFY_FACES,
        OCC_BOOLEAN_UNIFY_ANGULAR_TOLERANCE,
      );
      return { shape: booleanOp.Shape(), history: booleanOp };
    } catch {
      // Fall back to explicit same-domain unification below.
    }
  }

  const shape = booleanOp.Shape();
  if (!shape || typeof oc.ShapeUpgrade_UnifySameDomain_2 !== "function") {
    return { shape, history: booleanOp };
  }
  try {
    const unify = new oc.ShapeUpgrade_UnifySameDomain_2(
      shape,
      OCC_BOOLEAN_UNIFY_EDGES,
      OCC_BOOLEAN_UNIFY_FACES,
      true,
    );
    try { unify.SetAngularTolerance(OCC_BOOLEAN_UNIFY_ANGULAR_TOLERANCE); } catch { /* optional OCCT binding */ }
    unify.Build();
    return { shape: unify.Shape(), history: unify };
  } catch {
    return { shape, history: booleanOp };
  }
}

function chooseUnusedSourceFaceName(resultFace, sources, usedNames = new Set()) {
  const stats = statsFromOccFace(resultFace);
  const surfaceType = occFaceSurfaceTypeValue(resultFace);
  let best = null;
  for (const source of sources || []) {
    if (!source?.name || usedNames.has(source.name)) continue;
    const normalDot = (stats.normal[0] * source.normal[0])
      + (stats.normal[1] * source.normal[1])
      + (stats.normal[2] * source.normal[2]);
    const dist = Math.hypot(
      stats.centroid[0] - source.centroid[0],
      stats.centroid[1] - source.centroid[1],
      stats.centroid[2] - source.centroid[2],
    );
    const typeBonus = sameOccSurfaceType(surfaceType, source.surfaceType) ? 2 : 0;
    const score = typeBonus + normalDot - Math.min(dist, 1000) * 1e-4;
    if (!best || score > best.score) best = { name: source.name, score };
  }
  return best?.name || null;
}

function normalizedGeneratedEdgeSources(edgeSources) {
  const out = [];
  const seen = new Set();
  for (const source of Array.isArray(edgeSources) ? edgeSources : []) {
    const name = String(source?.name || "").trim();
    if (!name || !source?.edge) continue;
    const key = `${name}:${occEdgeKey(source.edge) || out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ edge: source.edge, name, order: out.length });
  }
  return out;
}

function collectGeneratedVertexSources(edgeSources) {
  const byKey = new Map();
  for (const source of edgeSources || []) {
    for (const vertex of occVerticesForShape(source.edge)) {
      const key = occVertexKey(vertex);
      if (!key) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { vertex, names: new Set(), firstOrder: source.order };
        byKey.set(key, entry);
      }
      entry.names.add(source.name);
      entry.firstOrder = Math.min(entry.firstOrder, source.order);
    }
  }
  return Array.from(byKey.values())
    .map((entry) => ({
      vertex: entry.vertex,
      names: Array.from(entry.names).sort(),
      firstOrder: entry.firstOrder,
    }))
    .sort((a, b) => a.firstOrder - b.firstOrder);
}

function combinedGeneratedVertexFaceName(names) {
  const unique = Array.from(new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)))
    .sort();
  if (unique.length >= 3) return unique.join("+");
  return unique[0] || null;
}

function generatedFaceNameFromEdgeSources(resultFace, edgeSources, operation) {
  if (!operation || typeof operation.Generated !== "function") return null;
  const sources = normalizedGeneratedEdgeSources(edgeSources);
  for (const source of sources) {
    try {
      if (listContainsSameShape(operation.Generated(source.edge), resultFace)) return source.name;
    } catch {
      // Some OCCT history calls are optional in the wasm binding.
    }
  }

  for (const source of collectGeneratedVertexSources(sources)) {
    try {
      if (!listContainsSameShape(operation.Generated(source.vertex), resultFace)) continue;
      return combinedGeneratedVertexFaceName(source.names);
    } catch {
      // Continue with the next source vertex.
    }
  }
  return null;
}

function bindBooleanFaceNames(state, left, right, booleanOp, operation) {
  const leftFaces = collectNamedOccFaces(left);
  const rightFaces = collectNamedOccFaces(right);
  const sourceFaces = operation === "SUBTRACT" || operation === "DIFFERENCE"
    ? [...leftFaces, ...rightFaces]
    : [...leftFaces, ...rightFaces];
  state.faceNameByIndex = [];
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    state.faceNameByIndex[faceIndex] = chooseSourceFaceName(face, sourceFaces, booleanOp) || `FACE_${faceIndex + 1}`;
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

function makeTopToolsShapeList(shapes) {
  const list = new oc.TopTools_ListOfShape_1();
  for (const shape of shapes || []) {
    if (shape) list.Append_1(shape);
  }
  return list;
}

function makeOccBooleanOperation(opName, argumentShapes, toolShapes) {
  let booleanOp;
  if (opName === "SUBTRACT" || opName === "DIFFERENCE") {
    booleanOp = new oc.BRepAlgoAPI_Cut_1();
  } else if (opName === "INTERSECT" || opName === "COMMON") {
    booleanOp = new oc.BRepAlgoAPI_Common_1();
  } else {
    booleanOp = new oc.BRepAlgoAPI_Fuse_1();
  }
  booleanOp.SetArguments(makeTopToolsShapeList(argumentShapes));
  booleanOp.SetTools(makeTopToolsShapeList(toolShapes));
  try { booleanOp.SetToFillHistory(true); } catch { /* optional OCCT binding */ }
  try { booleanOp.SetNonDestructive(false); } catch { /* optional OCCT binding */ }
  try { booleanOp.SetCheckInverted(false); } catch { /* optional OCCT binding */ }
  try { booleanOp.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift); } catch { /* optional OCCT binding */ }
  booleanOp.Build();
  return booleanOp;
}

function bindBooleanFaceNamesFromSources(state, sourceFaces, booleanOp, operation) {
  state.faceNameByIndex = [];
  let faceIndex = 0;
  const opName = String(operation || "").toUpperCase();
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    state.faceNameByIndex[faceIndex] = chooseSourceFaceName(face, sourceFaces || [], booleanOp) || `${opName || "BOOLEAN"}_FACE_${faceIndex + 1}`;
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

export function booleanOccSolids(left, right, operation = "UNION") {
  if (!hasOccShape(left) || !hasOccShape(right)) return null;
  const opName = String(operation || "UNION").toUpperCase();
  const leftShape = left._occ.shape;
  const rightShape = right._occ.shape;
  const booleanOp = makeOccBooleanOperation(opName, [leftShape], [rightShape]);
  if (typeof booleanOp.IsDone === "function" && !booleanOp.IsDone()) {
    throw new Error(`OpenCASCADE ${opName} boolean failed.`);
  }
  const simplified = simplifyOccBooleanResult(booleanOp);
  const { faceMetadata, edgeMetadata } = cloneMetadataMaps(left, right);
  const state = createOccState({
    shape: simplified.shape || booleanOp.Shape(),
    faceNames: uniqueNames([...(left._occ.faceNames || []), ...(right._occ.faceNames || [])]),
    faceMetadata,
    edgeMetadata,
    booleanOperation: opName,
  });
  bindBooleanFaceNames(state, left, right, simplified.history || booleanOp, opName);
  return state;
}

export function subtractOccSolidTools(target, toolSolids = []) {
  const tools = (Array.isArray(toolSolids) ? toolSolids : []).filter((solid) => hasOccShape(solid));
  if (!hasOccShape(target) || !tools.length) return null;
  const cut = new oc.BRepAlgoAPI_Cut_1();
  cut.SetArguments(makeTopToolsShapeList([target._occ.shape]));
  cut.SetTools(makeTopToolsShapeList(tools.map((solid) => solid._occ.shape)));
  try { cut.SetToFillHistory(true); } catch { /* optional OCCT binding */ }
  try { cut.SetNonDestructive(false); } catch { /* optional OCCT binding */ }
  try { cut.SetCheckInverted(false); } catch { /* optional OCCT binding */ }
  try { cut.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift); } catch { /* optional OCCT binding */ }
  cut.Build();
  if (typeof cut.IsDone === "function" && !cut.IsDone()) {
    throw new Error("OpenCASCADE multi-tool subtract failed.");
  }
  const simplified = simplifyOccBooleanResult(cut);
  const allSolids = [target, ...tools];
  const { faceMetadata, edgeMetadata } = cloneMetadataMapsMany(allSolids);
  const state = createOccState({
    shape: simplified.shape || cut.Shape(),
    faceNames: uniqueNames(allSolids.flatMap((solid) => solid?._occ?.faceNames || [])),
    faceMetadata,
    edgeMetadata,
    booleanOperation: "SUBTRACT",
  });
  bindBooleanFaceNamesFromSources(
    state,
    allSolids.flatMap((solid) => collectNamedOccFaces(solid)),
    simplified.history || cut,
    "SUBTRACT",
  );
  return state;
}

export function occVolume(solid) {
  if (!hasOccShape(solid)) return null;
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(solid._occ.shape, props, true, false, false);
  return Math.abs(Number(props.Mass() || 0));
}

export function occSurfaceArea(solid) {
  if (!hasOccShape(solid)) return null;
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(solid._occ.shape, props, true, false);
  return Math.abs(Number(props.Mass() || 0));
}

export function occSTEP(solid, name = "part") {
  if (!hasOccShape(solid)) return null;
  const writer = new oc.STEPControl_Writer_1();
  writer.Transfer(solid._occ.shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  const fileName = "test.step";
  writer.Write(fileName);
  try {
    return oc.FS.readFile(fileName, { encoding: "utf8" });
  } finally {
    try { oc.FS.unlink(fileName); } catch { }
  }
}

function pointDistanceSq(a, b) {
  const dx = Number(a?.[0] || 0) - Number(b?.[0] || 0);
  const dy = Number(a?.[1] || 0) - Number(b?.[1] || 0);
  const dz = Number(a?.[2] || 0) - Number(b?.[2] || 0);
  return dx * dx + dy * dy + dz * dz;
}

function pointToPolylineDistanceSq(point, segments) {
  let best = Infinity;
  for (const segment of segments || []) {
    best = Math.min(best, closestSegmentDistanceSq(point, segment[0], segment[1]));
  }
  return best;
}

function edgeEndpointsFromPolyline(edgeObj) {
  const pts = edgeObj?.userData?.polylineLocal;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  return [pts[0], pts[pts.length - 1]];
}

function edgeSegmentsFromPolyline(edgeObj) {
  const pts = edgeObj?.userData?.polylineLocal;
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const segments = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (pointDistanceSq(a, b) > 1e-16) segments.push([a, b]);
  }
  return segments;
}

function occEdgeEndpoints(edge) {
  const pts = [];
  try {
    const explorer = new oc.TopExp_Explorer_2(
      edge,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; explorer.More(); explorer.Next()) {
      const vertex = oc.TopoDS.Vertex_1(explorer.Current());
      const p = oc.BRep_Tool.Pnt(vertex);
      pts.push([p.X(), p.Y(), p.Z()]);
    }
  } catch {
    return null;
  }
  if (pts.length < 2) return null;
  return [pts[0], pts[pts.length - 1]];
}

function clampOccEdgeSampleCount(value) {
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count)) return DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES;
  return Math.max(2, Math.min(MAX_OCC_VISUALIZATION_CURVE_SAMPLES, count));
}

function polylineApproxLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot(
      Number(b?.[0] || 0) - Number(a?.[0] || 0),
      Number(b?.[1] || 0) - Number(a?.[1] || 0),
      Number(b?.[2] || 0) - Number(a?.[2] || 0),
    );
  }
  return length;
}

function pointToLineDistanceSq(point, a, b) {
  const px = Number(point?.[0] || 0);
  const py = Number(point?.[1] || 0);
  const pz = Number(point?.[2] || 0);
  const ax = Number(a?.[0] || 0);
  const ay = Number(a?.[1] || 0);
  const az = Number(a?.[2] || 0);
  const bx = Number(b?.[0] || 0);
  const by = Number(b?.[1] || 0);
  const bz = Number(b?.[2] || 0);
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 <= 1e-24) return (px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2));
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  const qz = az + abz * t;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

function isPolylineNearlyLinear(points, length) {
  if (!Array.isArray(points) || points.length < 3) return true;
  const first = points[0];
  const last = points[points.length - 1];
  const tolerance = Math.max(1e-7, Math.max(1, Number(length) || 0) * 1e-6);
  const toleranceSq = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i += 1) {
    if (pointToLineDistanceSq(points[i], first, last) > toleranceSq) return false;
  }
  return true;
}

function sampleOccEdgeCurve(edge, count) {
  const points = [];
  try {
    const curve = new oc.BRepAdaptor_Curve_2(edge);
    const first = Number(curve.FirstParameter());
    const last = Number(curve.LastParameter());
    if (!Number.isFinite(first) || !Number.isFinite(last)) return points;
    const steps = Math.max(2, Math.floor(count));
    for (let i = 0; i < steps; i += 1) {
      const t = steps === 1 ? first : first + ((last - first) * i) / (steps - 1);
      const p = new oc.gp_Pnt_1();
      curve.D0(t, p);
      points.push([p.X(), p.Y(), p.Z()]);
    }
  } catch {
    // Some edge kinds do not expose a usable adaptor in the wasm binding.
  }
  return points;
}

function occEdgeSampleCount(edge, options = {}) {
  if (Number.isFinite(options?.edgeSampleCount)) return clampOccEdgeSampleCount(options.edgeSampleCount);

  const coarse = sampleOccEdgeCurve(edge, 17);
  if (coarse.length < 2) return DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES;

  const length = polylineApproxLength(coarse);
  if (isPolylineNearlyLinear(coarse, length)) return 2;

  const deflection = Number(options?.deflection);
  const angle = Number(options?.angle);
  const byDeflection = Number.isFinite(deflection) && deflection > 0
    ? Math.ceil(length / Math.max(deflection * 0.25, 0.001))
    : DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES;
  const byAngle = Number.isFinite(angle) && angle > 0
    ? Math.ceil(DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES * Math.max(1, DEFAULT_ANGLE / angle))
    : DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES;

  return clampOccEdgeSampleCount(Math.max(DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES, byDeflection, byAngle));
}

function occEdgeSamplePoints(edge, countOrOptions = 17) {
  const count = typeof countOrOptions === "number"
    ? countOrOptions
    : occEdgeSampleCount(edge, countOrOptions || {});
  return sampleOccEdgeCurve(edge, count);
}

function selectedEdgeMatchScore(edgeObj, occEdge) {
  const selected = edgeEndpointsFromPolyline(edgeObj);
  const candidate = occEdgeEndpoints(occEdge);
  if (!selected || !candidate) return Infinity;
  const forward = pointDistanceSq(selected[0], candidate[0]) + pointDistanceSq(selected[1], candidate[1]);
  const reverse = pointDistanceSq(selected[0], candidate[1]) + pointDistanceSq(selected[1], candidate[0]);
  return Math.min(forward, reverse);
}

function segmentEdgeMatchScore(segment, occEdge) {
  const candidate = occEdgeEndpoints(occEdge);
  if (!segment || !candidate) return Infinity;
  const forward = pointDistanceSq(segment[0], candidate[0]) + pointDistanceSq(segment[1], candidate[1]);
  const reverse = pointDistanceSq(segment[0], candidate[1]) + pointDistanceSq(segment[1], candidate[0]);
  return Math.min(forward, reverse);
}

function curvePolylineMatchScore(segments, occEdge) {
  if (!Array.isArray(segments) || segments.length === 0) return Infinity;
  const samples = occEdgeSamplePoints(occEdge);
  if (samples.length === 0) return Infinity;
  let maxDistance = 0;
  let sumDistance = 0;
  for (const point of samples) {
    const dist = pointToPolylineDistanceSq(point, segments);
    maxDistance = Math.max(maxDistance, dist);
    sumDistance += dist;
  }
  return Math.max(maxDistance, sumDistance / samples.length);
}

function occEdgeKey(edge) {
  const endpoints = occEdgeEndpoints(edge);
  if (!endpoints) return null;
  return edgeKeyForPoints(endpoints[0], endpoints[1]);
}

function sameOccShape(a, b) {
  if (!a || !b) return false;
  try {
    return !!(a.IsSame?.(b) || a.IsEqual?.(b));
  } catch {
    return false;
  }
}

function occEdgeTriangulationPolyline(face, edge) {
  try {
    const location = new oc.TopLoc_Location_1();
    const handle = occFaceTriangulation(face, location);
    if (!handle || handle.IsNull()) return [];
    const polygon = oc.BRep_Tool.PolygonOnTriangulation_1(edge, handle, location);
    if (!polygon || polygon.IsNull()) return [];

    const triangulation = handle.get();
    const nodes = polygon.get().Nodes();
    const length = Number(nodes.Length?.() || 0);
    const positions = [];
    for (let i = 1; i <= length; i += 1) {
      const nodeIndex = Number(nodes.Value(i));
      if (!Number.isFinite(nodeIndex) || nodeIndex < 1 || nodeIndex > triangulation.NbNodes()) continue;
      positions.push(pointWithLocation(triangulation.Node(nodeIndex), location));
    }
    return positions;
  } catch {
    return [];
  }
}

function findOccEdgesForSelection(solid, edgeObj, tolerance = 1e-4) {
  if (!hasOccShape(solid) || !edgeObj) return null;
  const tol2 = tolerance * tolerance;
  const curveTol2 = Math.max(tol2 * 100, 1e-3);
  const segments = edgeSegmentsFromPolyline(edgeObj);
  const selectedIsChain = segments.length > 1;
  const matches = [];
  const seen = new Set();
  let best = null;
  const explorer = new oc.TopExp_Explorer_2(
    solid._occ.shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    let score = selectedEdgeMatchScore(edgeObj, edge);
    if (selectedIsChain) {
      score = Infinity;
      for (const segment of segments) score = Math.min(score, segmentEdgeMatchScore(segment, edge));
      score = Math.min(score, curvePolylineMatchScore(segments, edge));
      if (score <= curveTol2) {
        const key = occEdgeKey(edge) || String(matches.length);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push(edge);
        }
      }
    }
    if (!best || score < best.score) best = { edge, score };
  }
  if (matches.length) return matches;
  return best && best.score <= tol2 * 2 ? [best.edge] : [];
}

function findOccOwnerSolidForEdgeObject(edgeObj) {
  let obj = edgeObj?.parent || null;
  while (obj) {
    if (hasOccShape(obj)) return obj;
    obj = obj.parent || null;
  }
  return null;
}

function findOccOwnerSolidForFaceObject(faceObj) {
  let obj = faceObj?.parent || null;
  while (obj) {
    if (hasOccShape(obj)) return obj;
    obj = obj.parent || null;
  }
  return null;
}

export function occFaceFromSelectedFace(faceObj) {
  const owner = findOccOwnerSolidForFaceObject(faceObj);
  const faceName = String(faceObj?.name || faceObj?.userData?.faceName || "").trim();
  if (!owner || !faceName) return null;
  const face = findOccFaceByName(owner, faceName);
  return face ? { owner, face, faceName } : null;
}

export function occAxisFromSelectedEdge(edgeObj) {
  const owner = findOccOwnerSolidForEdgeObject(edgeObj);
  if (!owner) return null;
  const edges = findOccEdgesForSelection(owner, edgeObj);
  const edge = Array.isArray(edges) && edges.length === 1 ? edges[0] : null;
  if (!edge) return null;
  const endpoints = occEdgeEndpoints(edge);
  if (!endpoints || endpoints.length < 2) return null;
  const axis = sub(endpoints[1], endpoints[0]);
  if (Math.hypot(...axis) <= 1e-12) return null;
  return {
    start: endpoints[0],
    end: endpoints[1],
  };
}

function bindFeatureResultFaceNames(state, sourceSolid, featureFacePrefix, operation, options = {}) {
  const sourceFaces = collectNamedOccFaces(sourceSolid);
  state.faceNameByIndex = [];
  let created = 0;
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const surfaceType = occFaceSurfaceTypeValue(face);
    let name = null;
    for (const source of sourceFaces) {
      try {
        if (face.IsSame?.(source.face) || face.IsEqual?.(source.face)) {
          name = source.name;
          break;
        }
      } catch { }
      try {
        if (
          operation
          && sameOccSurfaceType(surfaceType, source.surfaceType)
          && listContainsSameShape(operation.Modified(source.face), face)
        ) {
          name = source.name;
          break;
        }
      } catch { }
    }
    if (!name) {
      name = generatedFaceNameFromEdgeSources(face, options.generatedEdgeSources, operation);
    }
    state.faceNameByIndex[faceIndex] = name || `${featureFacePrefix}_${created++}`;
  }
  state.faceNames = uniqueNames(state.faceNameByIndex);
}

function featureResultStateFromOperation(solid, operation, featureID, kind, options = {}) {
  if (typeof operation.Build === "function") operation.Build();
  if (typeof operation.IsDone === "function" && !operation.IsDone()) {
    throw new Error(`OpenCASCADE ${kind} failed.`);
  }
  const state = createOccState({
    shape: operation.Shape(),
    faceNames: Array.from(solid?._occ?.faceNames || []),
    faceMetadata: solid?._faceMetadata instanceof Map ? new Map(solid._faceMetadata.entries()) : new Map(),
    edgeMetadata: solid?._edgeMetadata instanceof Map ? new Map(solid._edgeMetadata.entries()) : new Map(),
    feature: { kind, featureID },
  });
  bindFeatureResultFaceNames(state, solid, `${featureID}_${String(kind || "FEATURE").toUpperCase()}_FACE`, operation, options);
  return state;
}

export function filletOccSolid(solid, edgeObjs = [], { radius, featureID = "FILLET" } = {}) {
  if (!hasOccShape(solid)) return null;
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) throw new Error(`OpenCASCADE fillet radius must be > 0, got ${radius}`);
  const op = new oc.BRepFilletAPI_MakeFillet(solid._occ.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  let added = 0;
  const generatedEdgeSources = [];
  for (const edgeObj of edgeObjs || []) {
    const edges = findOccEdgesForSelection(solid, edgeObj);
    const sourceName = String(edgeObj?.name || edgeObj?.userData?.edgeName || "").trim();
    for (const edge of edges || []) {
      op.Add_2(r, edge);
      added += 1;
      if (sourceName) generatedEdgeSources.push({ edge, name: sourceName });
    }
  }
  if (!added) return null;
  return featureResultStateFromOperation(solid, op, featureID, "fillet", { generatedEdgeSources });
}

export function chamferOccSolid(solid, edgeObjs = [], { distance, featureID = "CHAMFER" } = {}) {
  if (!hasOccShape(solid)) return null;
  const d = Number(distance);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`OpenCASCADE chamfer distance must be > 0, got ${distance}`);
  const op = new oc.BRepFilletAPI_MakeChamfer(solid._occ.shape);
  let added = 0;
  for (const edgeObj of edgeObjs || []) {
    const edges = findOccEdgesForSelection(solid, edgeObj);
    for (const edge of edges || []) {
      op.Add_2(d, edge);
      added += 1;
    }
  }
  if (!added) return null;
  return featureResultStateFromOperation(solid, op, featureID, "chamfer");
}

export function offsetShellOccSolid(solid, removedFaceNames = [], { distance, featureID = "OFFSET" } = {}) {
  if (!hasOccShape(solid)) return null;
  const d = Number(distance);
  if (!Number.isFinite(d) || Math.abs(d) <= 0) {
    throw new Error(`OpenCASCADE offset shell distance must be non-zero, got ${distance}`);
  }
  const removeSet = new Set((Array.isArray(removedFaceNames) ? removedFaceNames : [removedFaceNames])
    .map((name) => String(name || "").trim())
    .filter(Boolean));
  let op = null;
  if (removeSet.size) {
    const facesToRemove = new oc.TopTools_ListOfShape_1();
    for (const entry of collectNamedOccFaces(solid)) {
      if (removeSet.has(entry.name)) facesToRemove.Append_1(entry.face);
    }
    if (Number(facesToRemove.Size?.() || 0) <= 0) return null;

    op = new oc.BRepOffsetAPI_MakeThickSolid_1();
    op.MakeThickSolidByJoin(
      solid._occ.shape,
      facesToRemove,
      d,
      1e-4,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
    );
  } else {
    op = new oc.BRepOffsetAPI_MakeOffsetShape_1();
    op.PerformByJoin(
      solid._occ.shape,
      d,
      1e-4,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
    );
  }
  if (typeof op.IsDone === "function" && !op.IsDone()) {
    throw new Error("OpenCASCADE offset shell failed.");
  }

  const state = createOccState({
    shape: op.Shape(),
    faceNames: Array.from(solid?._occ?.faceNames || []).filter((name) => !removeSet.has(name)),
    faceMetadata: solid?._faceMetadata instanceof Map ? new Map(solid._faceMetadata.entries()) : new Map(),
    edgeMetadata: solid?._edgeMetadata instanceof Map ? new Map(solid._edgeMetadata.entries()) : new Map(),
    feature: { kind: "offsetShell", featureID, removedFaceNames: Array.from(removeSet), distance: d },
  });
  bindFeatureResultFaceNames(state, solid, `${featureID}_OFFSET_FACE`, op);
  if (!removeSet.size) {
    const sources = collectNamedOccFaces(solid);
    const usedNames = new Set();
    state.faceNameByIndex = [];
    let faceIndex = 0;
    const explorer = new oc.TopExp_Explorer_2(
      state.shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; explorer.More(); explorer.Next(), faceIndex += 1) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const sourceName = chooseUnusedSourceFaceName(face, sources, usedNames);
      if (sourceName) usedNames.add(sourceName);
      state.faceNameByIndex[faceIndex] = sourceName || `${featureID}_OFFSET_FACE_${faceIndex}`;
    }
  }
  state.faceNames = uniqueNames((state.faceNameByIndex || []).filter((name) => name && !removeSet.has(name)));
  return state;
}

export function tessellateOccState(state, options = {}) {
  if (!state?.shape) return { numProp: 3, vertProperties: new Float32Array(), triVerts: new Uint32Array(), faceID: new Uint32Array(), delete() {} };

  const meshOptions = state.meshOptions || {};
  const deflection = Number.isFinite(options.deflection)
    ? options.deflection
    : (Number.isFinite(meshOptions.deflection) ? meshOptions.deflection : DEFAULT_DEFLECTION);
  const angle = Number.isFinite(options.angle)
    ? options.angle
    : (Number.isFinite(meshOptions.angle) ? meshOptions.angle : DEFAULT_ANGLE);
  const cacheKey = `${deflection}:${angle}`;
  if (state.meshCache && state.meshCacheKey === cacheKey) return state.meshCache;
  cleanOccTriangulation(state.shape);
  new oc.BRepMesh_IncrementalMesh_2(state.shape, deflection, false, angle, false);

  const vertices = [];
  const triVerts = [];
  const faceIDs = [];
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const handle = occFaceTriangulation(face, location);
    if (!handle || handle.IsNull()) continue;
    const triangulation = handle.get();
    const base = (vertices.length / 3) | 0;
    const facePoints = [];
    for (let i = 1; i <= triangulation.NbNodes(); i += 1) {
      const point = triangulation.Node(i);
      const p = pointWithLocation(point, location);
      facePoints.push(p);
      vertices.push(p[0], p[1], p[2]);
    }
    const faceName = getFaceNameForIndex(state, faceIndex, {
      ...makeFaceStats(facePoints),
      points: facePoints,
      normal: surfaceNormalFromOccFace(face) || [0, 0, 0],
    });
    const faceID = state.faceNameToID?.get?.(faceName) ?? faceIndex + 1;
    const isReversed = occFaceNeedsTriangleReverse(face);
    for (let i = 1; i <= triangulation.NbTriangles(); i += 1) {
      const tri = triangulation.Triangle(i);
      const i0 = base + tri.Value(1) - 1;
      const i1 = base + tri.Value(2) - 1;
      const i2 = base + tri.Value(3) - 1;
      if (isReversed) triVerts.push(i0, i2, i1);
      else triVerts.push(i0, i1, i2);
      faceIDs.push(faceID);
    }
  }

  state.meshCache = {
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(triVerts),
    faceID: new Uint32Array(faceIDs),
    delete() {},
  };
  state.meshCacheKey = cacheKey;
  return state.meshCache;
}

export function occFaces(solid, options = {}) {
  const state = solid?._occ;
  if (!state?.shape) return null;
  state.faceNameToID = solid._faceNameToID;
  const mesh = tessellateOccState(state, options);
  const faces = new Map();
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const ids = mesh.faceID;
  const triCount = (tv.length / 3) | 0;
  for (let t = 0; t < triCount; t += 1) {
    const id = ids[t];
    const faceName = solid._idToFaceName.get(id) || `FACE_${id}`;
    if (!faces.has(faceName)) faces.set(faceName, []);
    const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
    faces.get(faceName).push({
      faceName,
      indices: [i0, i1, i2],
      p1: [vp[i0 * 3], vp[i0 * 3 + 1], vp[i0 * 3 + 2]],
      p2: [vp[i1 * 3], vp[i1 * 3 + 1], vp[i1 * 3 + 2]],
      p3: [vp[i2 * 3], vp[i2 * 3 + 1], vp[i2 * 3 + 2]],
    });
  }
  return Array.from(faces.entries(), ([faceName, triangles]) => ({ faceName, triangles }));
}

function findOccFaceByName(solid, faceName) {
  const state = solid?._occ;
  if (!state?.shape) return null;
  state.faceNameToID = solid._faceNameToID;
  tessellateOccState(state);
  let faceIndex = 0;
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next(), faceIndex += 1) {
    if (getFaceNameForIndex(state, faceIndex) === faceName) {
      return oc.TopoDS.Face_1(explorer.Current());
    }
  }
  return null;
}

function finiteMidpoint(a, b, fallback = 0) {
  const av = Number(a);
  const bv = Number(b);
  if (Number.isFinite(av) && Number.isFinite(bv)) return (av + bv) / 2;
  if (Number.isFinite(av)) return av;
  if (Number.isFinite(bv)) return bv;
  return fallback;
}

function surfaceNormalFromOccFace(face) {
  if (!face) return null;
  try {
    const surface = new oc.BRepAdaptor_Surface_2(face, true);
    const u = finiteMidpoint(surface.FirstUParameter(), surface.LastUParameter());
    const v = finiteMidpoint(surface.FirstVParameter(), surface.LastVParameter());
    const props = new oc.BRepLProp_SLProps_1(surface, u, v, 1, 1e-7);
    if (!props.IsNormalDefined()) return null;
    const normal = props.Normal();
    let out = normalizeVector([normal.X(), normal.Y(), normal.Z()]);
    if (occFaceNeedsTriangleReverse(face)) {
      out = [-out[0], -out[1], -out[2]];
    }
    return out;
  } catch {
    return null;
  }
}

export function occFaceNormal(solid, faceName) {
  const faceEntry = (occFaces(solid) || []).find((entry) => entry.faceName === faceName);
  if (!faceEntry) {
    return { faceFound: false, validNormal: false, normal: [0, 0, 0], planarRatio: 0, affectedVertexCount: 0 };
  }

  let normal = surfaceNormalFromOccFace(findOccFaceByName(solid, faceName));
  const weighted = [0, 0, 0];
  for (const tri of faceEntry.triangles || []) {
    const n = triangleNormal(tri.p1, tri.p2, tri.p3);
    weighted[0] += n[0];
    weighted[1] += n[1];
    weighted[2] += n[2];
  }
  if (!normal || Math.hypot(normal[0], normal[1], normal[2]) <= 1e-12) {
    normal = normalizeVector(weighted);
  }

  const validNormal = Math.hypot(normal[0], normal[1], normal[2]) > 1e-12;
  const vertices = new Set();
  let area = 0;
  let alignedArea = 0;
  for (const tri of faceEntry.triangles || []) {
    for (const p of [tri.p1, tri.p2, tri.p3]) vertices.add(pointKeyFromArray(p));
    const n = triangleNormal(tri.p1, tri.p2, tri.p3);
    const triArea = Math.hypot(n[0], n[1], n[2]);
    if (triArea <= 1e-12) continue;
    area += triArea;
    const unit = [n[0] / triArea, n[1] / triArea, n[2] / triArea];
    alignedArea += triArea * Math.abs(unit[0] * normal[0] + unit[1] * normal[1] + unit[2] * normal[2]);
  }

  return {
    faceFound: true,
    validNormal,
    normal,
    planarRatio: area > 1e-12 ? alignedArea / area : (validNormal ? 1 : 0),
    affectedVertexCount: vertices.size,
  };
}

const EDGE_KEY_SCALE = 1e8;

function pointKeyFromArray(point) {
  return [
    Math.round(Number(point?.[0] || 0) * EDGE_KEY_SCALE),
    Math.round(Number(point?.[1] || 0) * EDGE_KEY_SCALE),
    Math.round(Number(point?.[2] || 0) * EDGE_KEY_SCALE),
  ].join(",");
}

function edgeKeyForPoints(a, b) {
  const ka = pointKeyFromArray(a);
  const kb = pointKeyFromArray(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function edgePairName(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  return left < right ? [left, right] : [right, left];
}

function buildPolylinesFromSegments(segments) {
  const pointByKey = new Map();
  const adjacency = new Map();
  const edgeVisited = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const segment of segments) {
    const aKey = pointKeyFromArray(segment[0]);
    const bKey = pointKeyFromArray(segment[1]);
    if (aKey === bKey) continue;
    if (!pointByKey.has(aKey)) pointByKey.set(aKey, segment[0]);
    if (!pointByKey.has(bKey)) pointByKey.set(bKey, segment[1]);
    if (!adjacency.has(aKey)) adjacency.set(aKey, new Set());
    if (!adjacency.has(bKey)) adjacency.set(bKey, new Set());
    adjacency.get(aKey).add(bKey);
    adjacency.get(bKey).add(aKey);
  }

  const walk = (startKey) => {
    const polyKeys = [startKey];
    let prev = null;
    let current = startKey;
    let closedLoop = false;

    while (true) {
      const neighbors = Array.from(adjacency.get(current) || []);
      let next = neighbors.find((candidate) => candidate !== prev && !edgeVisited.has(edgeKey(current, candidate)));
      if (!next && prev === null) {
        next = neighbors.find((candidate) => !edgeVisited.has(edgeKey(current, candidate)));
      }
      if (!next) break;
      const eKey = edgeKey(current, next);
      if (edgeVisited.has(eKey)) break;
      edgeVisited.add(eKey);
      prev = current;
      current = next;
      if (current === startKey) {
        closedLoop = true;
        break;
      }
      polyKeys.push(current);
    }

    const positions = polyKeys.map((key) => pointByKey.get(key)).filter(Boolean);
    if (closedLoop && positions.length) positions.push(positions[0]);
    return { positions, closedLoop };
  };

  const polylines = [];
  const starts = Array.from(adjacency.keys()).sort((a, b) => {
    const da = adjacency.get(a)?.size || 0;
    const db = adjacency.get(b)?.size || 0;
    return (da === 1 ? -1 : 0) - (db === 1 ? -1 : 0);
  });

  for (const start of starts) {
    const neighbors = Array.from(adjacency.get(start) || []);
    if (!neighbors.some((neighbor) => !edgeVisited.has(edgeKey(start, neighbor)))) continue;
    const polyline = walk(start);
    if (polyline.positions.length >= 2) polylines.push(polyline);
  }

  return polylines;
}

export function occBoundaryEdgePolylines(solid, options = {}) {
  const state = solid?._occ;
  if (!state?.shape) return [];
  const faces = collectNamedOccFaces(solid, options);
  const edges = [];
  const explorer = new oc.TopExp_Explorer_2(
    state.shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; explorer.More(); explorer.Next()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    let entry = edges.find((candidate) => sameOccShape(candidate.edge, edge));
    if (!entry) {
      entry = { edge, faceUses: [], polygons: [] };
      edges.push(entry);
    }
  }

  for (const faceEntry of faces) {
    const faceExplorer = new oc.TopExp_Explorer_2(
      faceEntry.face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; faceExplorer.More(); faceExplorer.Next()) {
      const faceEdge = oc.TopoDS.Edge_1(faceExplorer.Current());
      const edgeEntry = edges.find((candidate) => sameOccShape(candidate.edge, faceEdge));
      if (edgeEntry) {
        edgeEntry.faceUses.push(faceEntry.name);
        const positions = occEdgeTriangulationPolyline(faceEntry.face, faceEdge);
        if (positions.length >= 2) {
          edgeEntry.polygons.push({ faceName: faceEntry.name, positions });
        }
      }
    }
  }

  const pairEdges = new Map();
  for (const entry of edges) {
    const names = (entry.faceUses || []).filter(Boolean);
    if (!names.length) continue;
    const polygon = (entry.polygons || []).find((item) => Array.isArray(item.positions) && item.positions.length >= 2);
    if (!polygon) continue;
    const uniqueNames = Array.from(new Set(names));
    if (uniqueNames.length < 2) continue;
    let faceA = uniqueNames[0];
    let faceB = uniqueNames[1] || uniqueNames[0];
    [faceA, faceB] = edgePairName(faceA, faceB);
    const pairKey = JSON.stringify([faceA, faceB]);
    if (!pairEdges.has(pairKey)) pairEdges.set(pairKey, []);
    pairEdges.get(pairKey).push(polygon.positions);
  }

  const out = [];
  for (const [pairKey, polylinesForPair] of pairEdges.entries()) {
    const [faceA, faceB] = JSON.parse(pairKey);
    polylinesForPair.forEach((positions, index) => {
      if (positions.length < 2) return;
      const closedLoop = pointDistanceSq(positions[0], positions[positions.length - 1]) <= 1e-12;
      out.push({
        name: `${faceA}|${faceB}[${index}]`,
        faceA,
        faceB,
        positions,
        closedLoop,
      });
    });
  }
  return out;
}

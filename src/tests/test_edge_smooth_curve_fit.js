import {
  fitAndSnapOpenEdgePolyline,
  fitAndSnapClosedEdgePolyline,
  hasLocalBacktrackingAgainstSource,
} from "../features/edgeSmooth/edgeCurveFit.js";
import { applyConstrainedVertexTargets } from "../features/edgeSmooth/vertexTargetConstraints.js";
import { EdgeSmoothFeature } from "../features/edgeSmooth/EdgeSmoothFeature.js";

function pointDistanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function assertPointNear(actual, expected, eps = 1e-12) {
  if (pointDistanceSq(actual, expected) > (eps * eps)) {
    throw new Error(`Expected point ${JSON.stringify(actual)} near ${JSON.stringify(expected)} (eps=${eps})`);
  }
}

export async function test_edge_smooth_curve_fit() {
  const source = [
    [0, 0, 0],
    [1, 0.35, 0],
    [2, -0.5, 0],
    [3, 0.45, 0],
    [4, 0, 0],
  ];

  const fitted = fitAndSnapOpenEdgePolyline(source, { fitStrength: 1 });
  if (!Array.isArray(fitted) || fitted.length !== source.length) {
    throw new Error("Curve fit should return one output point per input point.");
  }

  assertPointNear(fitted[0], source[0], 1e-12);
  assertPointNear(fitted[fitted.length - 1], source[source.length - 1], 1e-12);

  if (hasLocalBacktrackingAgainstSource(source, fitted)) {
    throw new Error("Fitted polyline should not locally reverse direction against the source edge.");
  }

  let movedInteriorCount = 0;
  for (let i = 1; i < source.length - 1; i++) {
    if (pointDistanceSq(source[i], fitted[i]) > 1e-12) movedInteriorCount++;
  }
  if (movedInteriorCount <= 0) {
    throw new Error("At least one interior point should be snapped to the fitted curve.");
  }

  const unchanged = fitAndSnapOpenEdgePolyline(source, { fitStrength: 0 });
  for (let i = 0; i < source.length; i++) {
    assertPointNear(unchanged[i], source[i], 1e-12);
  }
}

function hasLocalBacktrackingAgainstSourceClosed(sourcePoints, candidatePoints) {
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
    const srcSeg = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]];
    const candSeg = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const srcLen = Math.hypot(srcSeg[0], srcSeg[1], srcSeg[2]);
    const candLen = Math.hypot(candSeg[0], candSeg[1], candSeg[2]);
    if (!(srcLen > 1e-12) || !(candLen > 1e-12)) continue;
    const cos = ((srcSeg[0] * candSeg[0]) + (srcSeg[1] * candSeg[1]) + (srcSeg[2] * candSeg[2])) / (srcLen * candLen);
    if (cos < -1e-6) return true;
  }
  return false;
}

export async function test_edge_smooth_curve_fit_closed_loop() {
  const source = [
    [1.0, 0.0, 0.0],
    [0.45, 0.95, 0.02],
    [-0.55, 0.8, -0.03],
    [-1.0, 0.0, 0.0],
    [-0.45, -0.85, 0.03],
    [0.55, -0.75, -0.02],
  ];

  const fitted = fitAndSnapClosedEdgePolyline(source, { fitStrength: 1 });
  if (!Array.isArray(fitted) || fitted.length !== source.length) {
    throw new Error("Closed-loop curve fit should return one output point per input point.");
  }

  if (hasLocalBacktrackingAgainstSourceClosed(source, fitted)) {
    throw new Error("Closed-loop fitted polyline should not locally reverse direction.");
  }

  let movedCount = 0;
  for (let i = 0; i < source.length; i++) {
    if (pointDistanceSq(source[i], fitted[i]) > 1e-12) movedCount++;
  }
  if (movedCount <= 0) {
    throw new Error("Closed-loop fit should move at least one loop point.");
  }

  const unchanged = fitAndSnapClosedEdgePolyline(source, { fitStrength: 0 });
  for (let i = 0; i < source.length; i++) {
    assertPointNear(unchanged[i], source[i], 1e-12);
  }
}

export async function test_edge_smooth_constraints_prevent_triangle_foldback() {
  const vp = [
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ];
  const tv = [
    0, 1, 2,
    0, 2, 3,
  ];

  const targetMap = new Map();
  targetMap.set(1, { x: 0.2, y: 0.8, z: 0, count: 1 });

  const res = applyConstrainedVertexTargets(vp, tv, targetMap, {
    minArea2Ratio: 0.04,
    minNormalDot: 0.1,
    minArea2Abs: 1e-24,
  });

  if ((Number(res?.movedVertices) || 0) !== 1) {
    throw new Error("Constrained edge smoothing should move the target vertex.");
  }
  if ((Number(res?.constrainedVertices) || 0) <= 0) {
    throw new Error("Constrained edge smoothing should scale back fold-causing targets.");
  }

  const x = vp[3];
  const y = vp[4];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Constrained edge smoothing produced invalid coordinates.");
  }
  if (Math.abs(x - 0.2) < 1e-9 && Math.abs(y - 0.8) < 1e-9) {
    throw new Error("Constrained smoothing should not apply a fold-causing target at full displacement.");
  }

  const triNormalZ = (ia, ib, ic) => {
    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const ux = vp[b + 0] - vp[a + 0];
    const uy = vp[b + 1] - vp[a + 1];
    const vx = vp[c + 0] - vp[a + 0];
    const vy = vp[c + 1] - vp[a + 1];
    return (ux * vy) - (uy * vx);
  };

  if (!(triNormalZ(0, 1, 2) > 0)) {
    throw new Error("Primary triangle normal flipped after constrained smoothing.");
  }
  if (!(triNormalZ(0, 2, 3) > 0)) {
    throw new Error("Adjacent triangle normal flipped after constrained smoothing.");
  }
}

function makeMockSolidFromPolyline(polylinePoints) {
  const sourcePolyline = Array.isArray(polylinePoints)
    ? polylinePoints.map((p) => [p[0], p[1], p[2]])
    : [];
  const vertProperties = [];
  for (const p of sourcePolyline) {
    vertProperties.push(p[0], p[1], p[2]);
  }

  const createSolid = (vpSeed, polySeed) => {
    const vp = vpSeed.slice();
    const poly = polySeed.map((p) => [p[0], p[1], p[2]]);
    const edge = {
      type: "EDGE",
      name: "MOCK_EDGE_0",
      userData: {
        faceA: "FACE_A",
        faceB: "FACE_B",
        polylineLocal: poly.map((p) => [p[0], p[1], p[2]]),
      },
      parent: null,
      parentSolid: null,
    };

    const solid = {
      type: "SOLID",
      name: "MOCK_SOLID",
      _vertProperties: vp,
      _triVerts: [0, 1, 2, 0, 2, 3, 0, 3, 4],
      _triIDs: [0, 0, 0],
      _vertKeyToIndex: new Map(),
      _dirty: false,
      _faceIndex: null,
      _manifold: null,
      traverse(visitor) {
        if (typeof visitor === "function") visitor(edge);
      },
      visualize() { },
      _manifoldize() { },
      getBoundaryEdgePolylines() {
        return [{
          name: edge.name,
          faceA: edge.userData.faceA,
          faceB: edge.userData.faceB,
          indices: [0, 1, 2, 3, 4],
          positions: poly.map((p) => [p[0], p[1], p[2]]),
          closedLoop: false,
        }];
      },
      clone() {
        return createSolid(vp, poly);
      },
    };

    const face = {
      type: "FACE",
      name: "MOCK_FACE_0",
      edges: [edge],
      parent: solid,
      parentSolid: solid,
      userData: { faceName: "MOCK_FACE_0" },
    };

    edge.parent = solid;
    edge.parentSolid = solid;
    solid.__testFace = face;
    return solid;
  };

  return createSolid(vertProperties, sourcePolyline);
}

export async function test_edge_smooth_whole_solid_selection() {
  const source = [
    [0, 0, 0],
    [1, 0.4, 0],
    [2, -0.45, 0],
    [3, 0.35, 0],
    [4, 0, 0],
  ];
  const sourceSolid = makeMockSolidFromPolyline(source);

  const feature = new EdgeSmoothFeature();
  feature.inputParams = {
    edges: [sourceSolid],
    fitStrength: 1,
    id: "EDGE_SMOOTH_SOLID_TEST",
  };

  const result = await feature.run();
  if (!result || !Array.isArray(result.added) || result.added.length !== 1) {
    throw new Error("EdgeSmoothFeature should add one smoothed solid when selecting a whole solid.");
  }
  if (!Array.isArray(result.removed) || result.removed.length !== 1 || result.removed[0] !== sourceSolid) {
    throw new Error("EdgeSmoothFeature should remove exactly the selected source solid.");
  }

  const outSolid = result.added[0];
  const vp = Array.isArray(outSolid?._vertProperties) ? outSolid._vertProperties : [];
  if (vp.length < 15) {
    throw new Error("Smoothed solid is missing expected vertex properties.");
  }

  const outPolyline = [];
  for (let i = 0; i < 5; i++) {
    const base = i * 3;
    outPolyline.push([vp[base + 0], vp[base + 1], vp[base + 2]]);
  }

  assertPointNear(outPolyline[0], source[0], 1e-12);
  assertPointNear(outPolyline[outPolyline.length - 1], source[source.length - 1], 1e-12);

  if (hasLocalBacktrackingAgainstSource(source, outPolyline)) {
    throw new Error("Whole-solid smoothing should not create local edge backtracking.");
  }

  let movedInteriorCount = 0;
  for (let i = 1; i < source.length - 1; i++) {
    if (pointDistanceSq(source[i], outPolyline[i]) > 1e-12) movedInteriorCount++;
  }
  if (movedInteriorCount <= 0) {
    throw new Error("Whole-solid smoothing should move at least one interior edge point.");
  }

  if (!feature.persistentData || feature.persistentData.selectedSolidCount < 1) {
    throw new Error("Feature metadata should record at least one selected solid.");
  }
}

export async function test_edge_smooth_face_selection() {
  const source = [
    [0, 0, 0],
    [1, 0.3, 0],
    [2, -0.35, 0],
    [3, 0.25, 0],
    [4, 0, 0],
  ];
  const sourceSolid = makeMockSolidFromPolyline(source);
  const sourceFace = sourceSolid.__testFace;
  if (!sourceFace || sourceFace.type !== "FACE") {
    throw new Error("Mock setup should provide a face selection target.");
  }

  const feature = new EdgeSmoothFeature();
  feature.inputParams = {
    edges: [sourceFace],
    fitStrength: 1,
    id: "EDGE_SMOOTH_FACE_TEST",
  };

  const result = await feature.run();
  if (!result || !Array.isArray(result.added) || result.added.length !== 1) {
    throw new Error("EdgeSmoothFeature should add one smoothed solid when selecting a face.");
  }
  if (!Array.isArray(result.removed) || result.removed.length !== 1 || result.removed[0] !== sourceSolid) {
    throw new Error("EdgeSmoothFeature should remove exactly the source solid for face selection.");
  }

  const outSolid = result.added[0];
  const vp = Array.isArray(outSolid?._vertProperties) ? outSolid._vertProperties : [];
  if (vp.length < 15) {
    throw new Error("Face-selected smoothing output is missing expected vertex properties.");
  }

  const outPolyline = [];
  for (let i = 0; i < 5; i++) {
    const base = i * 3;
    outPolyline.push([vp[base + 0], vp[base + 1], vp[base + 2]]);
  }

  assertPointNear(outPolyline[0], source[0], 1e-12);
  assertPointNear(outPolyline[outPolyline.length - 1], source[source.length - 1], 1e-12);

  if (hasLocalBacktrackingAgainstSource(source, outPolyline)) {
    throw new Error("Face-selected smoothing should not create local edge backtracking.");
  }

  if (!feature.persistentData || feature.persistentData.selectedFaceCount < 1) {
    throw new Error("Feature metadata should record at least one selected face.");
  }
}

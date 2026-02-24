import {
  fitAndSnapOpenEdgePolyline,
  hasLocalBacktrackingAgainstSource,
} from "../features/edgeSmooth/edgeCurveFit.js";
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

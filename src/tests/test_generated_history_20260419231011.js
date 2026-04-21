import { buildSolidAuthoringStateSnapshot } from "../BREP/CppSolidCore.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function measureFaceTriangleExtremes(snapshot, faceName) {
  const numProp = Math.max(3, Number(snapshot?.numProp ?? 3));
  const vertProperties = Array.isArray(snapshot?.vertProperties) ? snapshot.vertProperties : [];
  const triVerts = Array.isArray(snapshot?.triVerts) ? snapshot.triVerts : [];
  const triIDs = Array.isArray(snapshot?.triIDs) ? snapshot.triIDs : [];
  const idToFaceName = new Map(snapshot?.idToFaceName || []);

  let triangleCount = 0;
  let tinyAreaCount = 0;
  let tinyHeightCount = 0;
  let minHeight = Infinity;
  let maxEdge = 0;
  for (let triIndex = 0; triIndex < triIDs.length; triIndex += 1) {
    if (String(idToFaceName.get(triIDs[triIndex]) || "") !== faceName) continue;
    triangleCount += 1;
    const triBase = triIndex * 3;
    const indices = [triVerts[triBase], triVerts[triBase + 1], triVerts[triBase + 2]];
    const points = indices.map((vertexIndex) => {
      const base = vertexIndex * numProp;
      return [
        Number(vertProperties[base] || 0),
        Number(vertProperties[base + 1] || 0),
        Number(vertProperties[base + 2] || 0),
      ];
    });
    const [a, b, c] = points;
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    maxEdge = Math.max(maxEdge, ab, ac, bc);
    const ux = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const vx = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = 0.5 * Math.hypot(
      ux[1] * vx[2] - ux[2] * vx[1],
      ux[2] * vx[0] - ux[0] * vx[2],
      ux[0] * vx[1] - ux[1] * vx[0],
    );
    if (area < 1e-4) tinyAreaCount += 1;
    const minHeightCandidate = (2 * area) / Math.max(ab, ac, bc, 1e-12);
    minHeight = Math.min(minHeight, minHeightCandidate);
    if (minHeightCandidate < 1e-3) tinyHeightCount += 1;
  }
  return {
    triangleCount,
    tinyAreaCount,
    tinyHeightCount,
    minHeight: Number.isFinite(minHeight) ? minHeight : 0,
    maxEdge,
  };
}

function countFaceTriangleComponents(snapshot, faceName) {
  const triVerts = Array.isArray(snapshot?.triVerts) ? snapshot.triVerts : [];
  const triIDs = Array.isArray(snapshot?.triIDs) ? snapshot.triIDs : [];
  const idToFaceName = new Map(snapshot?.idToFaceName || []);
  const triangleIndices = [];
  for (let triIndex = 0; triIndex < triIDs.length; triIndex += 1) {
    if (String(idToFaceName.get(triIDs[triIndex]) || "") === faceName) {
      triangleIndices.push(triIndex);
    }
  }
  if (triangleIndices.length === 0) return 0;

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToTriangles = new Map();
  for (const triIndex of triangleIndices) {
    const base = triIndex * 3;
    const i0 = triVerts[base + 0];
    const i1 = triVerts[base + 1];
    const i2 = triVerts[base + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let list = edgeToTriangles.get(key);
      if (!list) {
        list = [];
        edgeToTriangles.set(key, list);
      }
      list.push(triIndex);
    }
  }

  const adjacency = new Map(triangleIndices.map((triIndex) => [triIndex, new Set()]));
  for (const triList of edgeToTriangles.values()) {
    for (let i = 0; i < triList.length; i += 1) {
      for (let j = i + 1; j < triList.length; j += 1) {
        adjacency.get(triList[i])?.add(triList[j]);
        adjacency.get(triList[j])?.add(triList[i]);
      }
    }
  }

  let componentCount = 0;
  const visited = new Set();
  for (const triIndex of triangleIndices) {
    if (visited.has(triIndex)) continue;
    componentCount += 1;
    const stack = [triIndex];
    visited.add(triIndex);
    while (stack.length > 0) {
      const current = stack.pop();
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
  }
  return componentCount;
}

export async function test_generated_history_20260419231011(partHistory) {
  if (manifoldBuildSource !== "local") return;

  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = {
    fields: [],
    values: {},
  };

  const feature1 = await partHistory.newFeature("D");
  Object.assign(feature1.inputParams, {
    id: "D1",
    transform: {
      position: [
        0.2565036028836988,
        5.286649371275551,
        -3.590228990331272,
      ],
      rotationEuler: [
        -32.818971321018715,
        30.63210260878807,
        -2.671532847188412,
      ],
      scale: [1, 1, 1],
    },
  });

  const feature2 = await partHistory.newFeature("S");
  Object.assign(feature2.inputParams, {
    id: "S2",
    sketchPlane: "D1:XY",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: "resolution",
  });
  feature2.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 3, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 6, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 15, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 16, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 17, x: 1.764345, y: -4.025491, fixed: false, construction: false, externalReference: false },
        { id: 18, x: 6.391665, y: 4.346518, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 3, type: "line", points: [6, 7], construction: false },
        { id: 4, type: "line", points: [8, 3], construction: false },
        { id: 9, type: "line", points: [1, 17], construction: false },
        { id: 10, type: "line", points: [16, 17], construction: false },
        { id: 11, type: "line", points: [18, 15], construction: false },
        { id: 12, type: "line", points: [18, 2], construction: false },
      ],
      constraints: [
        {
          id: 0,
          type: "⏚",
          points: [0],
          status: "solved",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "0:0,0,1;",
        },
        {
          id: 1,
          type: "≡",
          points: [1, 3],
          status: "",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "1:-2.504334,-3.287135,0;3:-2.504334,-3.287135,0;",
        },
        {
          id: 3,
          type: "≡",
          points: [2, 6],
          status: "solved",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "2:6.391665,6.452413,0;6:6.391665,6.452413,0;",
        },
        {
          id: 4,
          type: "≡",
          points: [7, 8],
          status: "",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "7:-2.504333,6.452412,0;8:-2.504333,6.452412,0;",
        },
        {
          id: 7,
          type: "⟂",
          points: [6, 7, 8, 3],
          status: "",
          error: null,
          value: 270,
          _previousSolveValue: 270,
          previousPointValues: "6:5.357399948061701,6.756693642653996,0;7:-2.8534559480617006,6.093104357346005,0;8:-2.853456,6.093105,0;3:-2.150647,-2.603049,0;",
        },
        {
          id: 8,
          type: "│",
          points: [8, 3],
          labelX: 0,
          labelY: 0,
          displayStyle: "",
          value: null,
          valueNeedsSetup: true,
          status: "",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "8:-2.504327,6.4524,0;3:-2.504327,-3.27361,0;",
        },
        {
          id: 12,
          type: "≡",
          points: [15, 16],
          status: "solved",
          error: null,
          _previousSolveValue: null,
          previousPointValues: "15:1.803917,3.614373,0;16:1.803917,3.614373,0;",
        },
      ],
    },
  };

  const feature3 = await partHistory.newFeature("E");
  Object.assign(feature3.inputParams, {
    id: "E3",
    profile: "S2:PROFILE",
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: {
      targets: [],
      operation: "NONE",
      overlapConditioningEnabled: true,
    },
  });

  const feature4 = await partHistory.newFeature("F");
  Object.assign(feature4.inputParams, {
    id: "F4",
    edges: [
      "E3:S2:G10_SW|E3:S2:G9_SW[0]",
      "E3:S2:G12_SW|E3:S2:G3_SW[0]",
      "E3:S2:G3_SW|E3:S2:G4_SW[0]",
      "E3:S2:G10_SW|E3:S2:G11_SW[0]",
      "E3:S2:G4_SW|E3:S2:G9_SW[0]",
      "E3:S2:G11_SW|E3:S2:G12_SW[0]",
    ],
    radius: 1,
    resolution: "resolution",
    inflate: "1.2",
    nudgeFaceDistance: "0.0002",
    direction: "AUTO",
    debug: "NONE",
  });
}

export async function afterRun_generated_history_20260419231011(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const solid = getSolidByName(partHistory, "E3");
  if (!solid) {
    throw new Error("[generated_history_20260419231011] Expected final solid E3 to exist.");
  }

  const faceNames = Array.from(solid.getFaceNames?.() || []);
  const mergedEndCapNames = [
    "F4_FILLET_E3_S2_G10_SW_E3_S2_G11_SW_e44b5ee8_3_END_CAP_1",
    "F4_FILLET_E3_S2_G10_SW_E3_S2_G11_SW_e44b5ee8_3_END_CAP_2",
  ];
  for (const faceName of mergedEndCapNames) {
    if (faceNames.includes(faceName)) {
      throw new Error(`[generated_history_20260419231011] Expected ${faceName} to merge into its coplanar host face.`);
    }
  }

  const remainingEndCaps = faceNames.filter((faceName) => {
    const metadata = solid.getFaceMetadata?.(faceName) || {};
    return metadata?.filletEndCap === true;
  });
  if (remainingEndCaps.length !== 0) {
    throw new Error(`[generated_history_20260419231011] Expected all post-boolean fillet end caps to merge, found ${remainingEndCaps.join(", ")}.`);
  }

  if (!(Number(solid.__filletEndCapMergeCount || 0) >= 4)) {
    throw new Error(`[generated_history_20260419231011] Expected four merged end caps for the rotated-datum fillet, received ${solid.__filletEndCapMergeCount}.`);
  }

  const hostFaceName = "E3:S2:PROFILE_START";
  if (!faceNames.includes(hostFaceName)) {
    throw new Error(`[generated_history_20260419231011] Expected merged host face ${hostFaceName} to survive.`);
  }
  const hostMetadata = solid.getFaceMetadata?.(hostFaceName) || {};
  if (hostMetadata.filletEndCap === true) {
    throw new Error("[generated_history_20260419231011] Expected merged host face metadata to exclude filletEndCap.");
  }
  if (hostMetadata.faceType !== "STARTCAP" || hostMetadata.sourceFeatureId !== "E3") {
    throw new Error(`[generated_history_20260419231011] Expected ${hostFaceName} metadata to survive the merge.`);
  }

  if (!(Number(solid.__filletEndCapReverseNudgeCount || 0) > 0)) {
    throw new Error("[generated_history_20260419231011] Expected post-boolean fillet end-cap nudge reversal to run.");
  }

  const directionDecision = solid.__filletDirectionDecision || {};
  if (Number(directionDecision.outsetEdges || 0) !== 0) {
    throw new Error(`[generated_history_20260419231011] Expected AUTO direction smoothing to avoid an isolated outset edge, received ${directionDecision.outsetEdges} outset edge(s).`);
  }

  const problematicTubeFace = "F4_FILLET_E3_S2_G10_SW_E3_S2_G11_SW_e44b5ee8_3_TUBE_Outer";
  const snapshot = buildSolidAuthoringStateSnapshot(solid);
  const faceStats = measureFaceTriangleExtremes(snapshot, problematicTubeFace);
  if (!(faceStats.triangleCount > 0)) {
    throw new Error(`[generated_history_20260419231011] Expected ${problematicTubeFace} to exist after AUTO fillet smoothing.`);
  }
  if (!(faceStats.maxEdge < 14)) {
    throw new Error(`[generated_history_20260419231011] Expected ${problematicTubeFace} max edge length < 14 after AUTO smoothing, received ${faceStats.maxEdge}.`);
  }

  if (!(Number(solid.__filletPostCollapseTinyFaceIslandCleanupCount || 0) > 0)) {
    throw new Error("[generated_history_20260419231011] Expected post-collapse tiny-face island cleanup to repair merged host faces.");
  }

  for (const hostFaceName of ["E3:S2:PROFILE_START", "E3:S2:PROFILE_END", "E3:S2:G11_SW"]) {
    const componentCount = countFaceTriangleComponents(snapshot, hostFaceName);
    if (componentCount > 1) {
      throw new Error(`[generated_history_20260419231011] Expected ${hostFaceName} triangles to remain edge-connected after fillet cleanup, found ${componentCount} components.`);
    }
  }
}

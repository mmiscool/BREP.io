import { manifoldBuildSource } from "../BREP/setupManifold.js";

const FALLBACK_FACE_PATTERN = /^FACE(?:_\d+)?$/;

const GENERATED_SKETCH = {
  points: [
    { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
    { id: 1, x: 8.169619, y: 7.413411, fixed: false, construction: false, externalReference: false },
    { id: 2, x: -9.973789, y: -7.834762, fixed: false, construction: false, externalReference: false },
    { id: 3, x: 8.169619, y: 7.413411, fixed: false, construction: false, externalReference: false },
    { id: 4, x: -9.445161, y: 8.001406, fixed: false, construction: false, externalReference: false },
    { id: 5, x: -9.445161, y: 8.001406, fixed: false, construction: false, externalReference: false },
    { id: 6, x: -9.973789, y: -7.834762, fixed: false, construction: false, externalReference: false },
    { id: 7, x: 7.640988, y: -8.422764, fixed: false, construction: false, externalReference: false },
    { id: 8, x: 7.640988, y: -8.422764, fixed: false, construction: false, externalReference: false },
    { id: 9, x: 10.931753, y: 7.321209, fixed: false, construction: false, externalReference: false },
    { id: 10, x: 12.857816, y: 7.805148, fixed: false, construction: false, externalReference: false },
    { id: 11, x: 14.257523, y: 2.315756, fixed: false, construction: false, externalReference: false },
    { id: 12, x: 15.389563, y: -2.123894, fixed: false, construction: false, externalReference: false },
    { id: 13, x: 19.41103, y: -0.405785, fixed: false, construction: false, externalReference: false },
    { id: 14, x: 18.53984, y: -4.577753, fixed: false, construction: false, externalReference: false },
    { id: 15, x: 17.348496, y: -10.282882, fixed: false, construction: false, externalReference: false },
    { id: 16, x: 13.605762, y: -8.621875, fixed: false, construction: false, externalReference: false },
  ],
  geometries: [
    { id: 1, type: "line", points: [1, 4], construction: false },
    { id: 2, type: "line", points: [5, 2], construction: false },
    { id: 3, type: "line", points: [6, 7], construction: false },
    { id: 4, type: "line", points: [8, 3], construction: true },
    { id: 5, type: "bezier", points: [1, 9, 10, 11], construction: false },
    { id: 6, type: "line", points: [1, 9], construction: true },
    { id: 7, type: "line", points: [11, 10], construction: true },
    { id: 8, type: "bezier", points: [11, 12, 13, 14], construction: false },
    { id: 9, type: "line", points: [11, 12], construction: true },
    { id: 10, type: "line", points: [14, 13], construction: true },
    { id: 11, type: "bezier", points: [14, 15, 16, 7], construction: false },
    { id: 12, type: "line", points: [14, 15], construction: true },
    { id: 13, type: "line", points: [7, 16], construction: true },
  ],
  constraints: [],
};

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function findTinyEnclosedFaceIslands(solid, maxArea = 0.01) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const triCount = (tv.length / 3) | 0;
  if (triCount === 0 || ids.length < triCount || vp.length < 9) return [];

  const triArea = (triIndex) => {
    const base = triIndex * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    const x0 = vp[i0 * 3 + 0], y0 = vp[i0 * 3 + 1], z0 = vp[i0 * 3 + 2];
    const x1 = vp[i1 * 3 + 0], y1 = vp[i1 * 3 + 1], z1 = vp[i1 * 3 + 2];
    const x2 = vp[i2 * 3 + 0], y2 = vp[i2 * 3 + 1], z2 = vp[i2 * 3 + 2];
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    return 0.5 * Math.hypot(cx, cy, cz);
  };

  const triAreas = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) triAreas[t] = triArea(t);

  const nv = (vp.length / 3) | 0;
  const NV = BigInt(Math.max(1, nv));
  const edgeKey = (a, b) => {
    const A = BigInt(a);
    const B = BigInt(b);
    return A < B ? (A * NV + B) : (B * NV + A);
  };

  const edgeToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = tv[base + 0] >>> 0;
    const i1 = tv[base + 1] >>> 0;
    const i2 = tv[base + 2] >>> 0;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let list = edgeToTris.get(key);
      if (!list) {
        list = [];
        edgeToTris.set(key, list);
      }
      list.push(t);
    }
  }

  const triAdj = Array.from({ length: triCount }, () => []);
  for (const tris of edgeToTris.values()) {
    if (tris.length !== 2) continue;
    const a = tris[0] | 0;
    const b = tris[1] | 0;
    triAdj[a].push(b);
    triAdj[b].push(a);
  }

  const seen = new Uint8Array(triCount);
  const stack = [];
  const enclosed = [];
  const idToFaceName = (solid?._idToFaceName instanceof Map) ? solid._idToFaceName : new Map();

  for (let seed = 0; seed < triCount; seed++) {
    if (seen[seed]) continue;
    const faceId = ids[seed] >>> 0;
    seen[seed] = 1;
    stack.push(seed);
    const compTris = [];
    const neighborCounts = new Map();
    let compArea = 0;

    while (stack.length > 0) {
      const t = stack.pop() | 0;
      compTris.push(t);
      compArea += triAreas[t] || 0;
      const nbrs = triAdj[t];
      for (let i = 0; i < nbrs.length; i++) {
        const u = nbrs[i] | 0;
        const neighborFaceId = ids[u] >>> 0;
        if (neighborFaceId === faceId) {
          if (!seen[u]) {
            seen[u] = 1;
            stack.push(u);
          }
          continue;
        }
        neighborCounts.set(neighborFaceId, (neighborCounts.get(neighborFaceId) || 0) + 1);
      }
    }

    if (!(compArea <= maxArea) || neighborCounts.size !== 1) continue;

    const [[neighborFaceId, sharedAdjCount]] = Array.from(neighborCounts.entries());
    enclosed.push({
      faceName: String(idToFaceName.get(faceId) || `FACE_${faceId}`),
      neighborFaceName: String(idToFaceName.get(neighborFaceId) || `FACE_${neighborFaceId}`),
      triangleCount: compTris.length,
      area: compArea,
      sharedAdjCount,
    });
  }

  return enclosed;
}

export async function test_fillet_generated_history_20260321144106(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const cylinder = await partHistory.newFeature("P.CY");
  Object.assign(cylinder.inputParams, {
    id: "P.CY1",
    radius: "4",
    height: 10,
    resolution: 64,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: [],
      operation: "NONE",
    },
  });

  const sketch = await partHistory.newFeature("S");
  Object.assign(sketch.inputParams, {
    id: "S5",
    sketchPlane: "P.CY1_T",
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 32,
  });
  sketch.persistentData = {
    sketch: GENERATED_SKETCH,
  };

  const extrude = await partHistory.newFeature("E");
  Object.assign(extrude.inputParams, {
    id: "E6",
    profile: "S5:PROFILE",
    distance: "5",
    distanceBack: "4",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
    consumeProfileSketch: true,
  });

  const revolve = await partHistory.newFeature("R");
  Object.assign(revolve.inputParams, {
    id: "R9",
    profile: "E6:S5:PROFILE_END",
    axis: "E6:S5:G2_SW|E6:S5:PROFILE_END[0]",
    angle: 34,
    resolution: "256",
    boolean: {
      targets: ["P.CY1"],
      operation: "UNION",
      overlapConditioningEnabled: false,
    },
  });

  const fillet = await partHistory.newFeature("F");
  Object.assign(fillet.inputParams, {
    id: "F14",
    edges: [
      "E6:S5:G2_SW|E6:S5:PROFILE_END_END[0]",
      "E6:S5:G2_SW",
      "E6:S5:PROFILE_END_END",
      "P.CY1_B",
    ],
    radius: "1",
    resolution: 32,
    inflate: 0.1,
    nudgeFaceDistance: 0.0001,
    direction: "AUTO",
    debug: "NONE",
    showTangentOverlays: false,
  });

  return partHistory;
}

export async function afterRun_fillet_generated_history_20260321144106(partHistory) {
  if (manifoldBuildSource !== "local") return;

  const solid = getSolidByName(partHistory, "P.CY1");
  if (!solid || typeof solid.getFaceNames !== "function" || typeof solid.getFaceMetadata !== "function") {
    throw new Error("[generated fillet history] Failed to resolve final solid P.CY1.");
  }

  const faceNames = (solid.getFaceNames() || [])
    .map((name) => String(name || "").trim())
    .filter((name) => name.length > 0);
  if (faceNames.length === 0) {
    throw new Error("[generated fillet history] Fillet result has no face names.");
  }

  const fallbackFaces = faceNames.filter((name) => FALLBACK_FACE_PATTERN.test(name));
  if (fallbackFaces.length > 0) {
    throw new Error(`[generated fillet history] Found fallback face names after fillet: ${fallbackFaces.join(", ")}`);
  }

  const leakedIntermediateNames = faceNames.filter((name) => /(?:^|_)(?:FACE_A|FACE_B|WEDGE_A|WEDGE_B|SIDE_A|SIDE_B)(?:$|_)/.test(name));
  if (leakedIntermediateNames.length > 0) {
    throw new Error(`[generated fillet history] Found leaked intermediate fillet face names: ${leakedIntermediateNames.join(", ")}`);
  }

  for (const required of ["P.CY1_B", "P.CY1_S", "E6:S5:PROFILE_END_END"]) {
    if (!faceNames.includes(required)) {
      throw new Error(`[generated fillet history] Expected preserved face name "${required}" in final solid.`);
    }
  }

  const sideWallFaces = [];
  for (const faceName of faceNames) {
    const metadata = solid.getFaceMetadata(faceName) || {};
    if (metadata.filletSideWall !== true) continue;
    sideWallFaces.push({ faceName, metadata });
  }
  if (sideWallFaces.length !== 10) {
    throw new Error(`[generated fillet history] Expected 10 fillet side-wall faces, found ${sideWallFaces.length}.`);
  }

  const expectedEdges = new Set([
    "E6:S5:G2_SW|E6:S5:PROFILE_START[0]",
    "E6:S5:G1_SW|E6:S5:G2_SW[0]",
    "P.CY1_B|P.CY1_S[0]",
  ]);
  const seenEdges = new Set();

  for (const { faceName, metadata } of sideWallFaces) {
    if (metadata.filletMergedSideWall !== true) {
      throw new Error(`[generated fillet history] Side-wall face "${faceName}" is missing filletMergedSideWall metadata.`);
    }
    if (typeof metadata.filletSideWallEdge !== "string" || metadata.filletSideWallEdge.trim().length === 0) {
      throw new Error(`[generated fillet history] Side-wall face "${faceName}" is missing filletSideWallEdge metadata.`);
    }
    seenEdges.add(metadata.filletSideWallEdge);
    if (metadata.sourceFeatureId !== "F14") {
      throw new Error(`[generated fillet history] Side-wall face "${faceName}" should retain sourceFeatureId=F14.`);
    }
  }

  for (const edgeName of expectedEdges) {
    if (!seenEdges.has(edgeName)) {
      throw new Error(`[generated fillet history] Expected fillet side-wall edge "${edgeName}" to survive final reconstruction.`);
    }
  }

  const tinyEnclosedIslands = findTinyEnclosedFaceIslands(solid, 0.01);
  if (tinyEnclosedIslands.length > 0) {
    const summary = tinyEnclosedIslands
      .map((entry) => `${entry.faceName}->${entry.neighborFaceName} area=${entry.area.toExponential(3)} tris=${entry.triangleCount}`)
      .join("; ");
    throw new Error(`[generated fillet history] Found tiny enclosed face-label islands: ${summary}`);
  }

  console.log(`✓ Generated fillet history preserved ${faceNames.length} descriptive face names with ${sideWallFaces.length} fillet side walls.`);
}

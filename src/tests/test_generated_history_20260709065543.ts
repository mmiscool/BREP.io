// Generated from a user part history on 2026-07-09 (image replaced with an
// equivalent synthetic one). Regression test for the HEIGHTMAP feature: the
// bulk mesh construction must produce a closed, coherently oriented manifold
// (correct triangle winding, no zero-thickness membranes over base-height
// regions) that survives simplify and a subsequent boolean subtract.

// Terrain blobs on a pure-black background. Black pixels land exactly at the
// base height, which is what used to produce coincident top/bottom membrane
// triangles and a non-manifold mesh.
function buildHeightmapImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const blobs = [
    { cx: 0.3, cy: 0.35, r: 0.22, peak: 235 },
    { cx: 0.68, cy: 0.3, r: 0.16, peak: 180 },
    { cx: 0.55, cy: 0.68, r: 0.26, peak: 210 },
    { cx: 0.2, cy: 0.75, r: 0.12, peak: 120 },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const v = y / (height - 1);
      let value = 0;
      for (const blob of blobs) {
        const d = Math.hypot(u - blob.cx, v - blob.cy) / blob.r;
        if (d < 1) value = Math.max(value, blob.peak * (1 - d * d));
      }
      // Terrace the blobs so the surface has plateaus and steep steps.
      const g = value > 0 ? Math.min(255, (Math.floor(value / 32) + 1) * 32) : 0;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = g;
      data[o + 3] = 255;
    }
  }
  class NodeImageData {
    width; height; data;
    constructor(w, h, d) { this.width = w; this.height = h; this.data = d; }
  }
  if (typeof (globalThis as any).ImageData === "undefined") {
    (globalThis as any).ImageData = NodeImageData;
  }
  const img = Object.create((globalThis as any).ImageData.prototype);
  img.width = width;
  img.height = height;
  img.data = data;
  return img;
}

export async function test_generated_history_20260709065543(partHistory) {
  return buildHeightmapHistory(partHistory, "0");
}

// baseHeight > 0 gives the solid a base slab: the bottom face stays at Z=0
// and the black background carries slab-thick material instead of collapsing
// to zero thickness.
export async function test_generated_history_20260709065543_base_thickness(partHistory) {
  return buildHeightmapHistory(partHistory, "3");
}

async function buildHeightmapHistory(partHistory, baseHeight) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("HEIGHTMAP");
  Object.assign(feature1.inputParams, {
    id: "HEIGHTMAP1",
    fileToImport: buildHeightmapImage(200, 200),
    editImage: null,
    heightScale: "40",
    baseHeight,
    invertHeights: false,
    pixelScale: 1,
    center: true,
    sampleStride: "5",
    placementPlane: null,
    simplifyTolerance: "0.1",
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const feature2 = await partHistory.newFeature("P.CU");
  Object.assign(feature2.inputParams, {
    id: "P.CU2",
    sizeX: 10,
    sizeY: 84.9,
    sizeZ: 49.8,
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["HEIGHTMAP1"],
      operation: "SUBTRACT",
      overlapConditioningEnabled: true,
    },
  });

  await partHistory.runHistory();
  assertHeightmapSceneIsManifold(partHistory);
  return partHistory;
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  const counts = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const a = triVerts[(triIndex * 3) + 0] >>> 0;
    const b = triVerts[(triIndex * 3) + 1] >>> 0;
    const c = triVerts[(triIndex * 3) + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const value of counts.values()) {
    if (value === 1) boundaryEdgeCount += 1;
    else if (value !== 2) nonManifoldEdgeCount += 1;
  }
  return { boundaryEdgeCount, nonManifoldEdgeCount, triangleCount: triCount };
}

function assertHeightmapSceneIsManifold(partHistory) {
  const label = "generated_history_20260709065543";
  const solids = (partHistory.scene?.children || []).filter((child) => child?.type === "SOLID");
  if (solids.length === 0) {
    throw new Error(`[${label}] Expected at least one solid in the scene after the heightmap + subtract history.`);
  }
  for (const solid of solids) {
    const topology = analyzeMeshTopology(solid);
    if (topology.triangleCount === 0) {
      throw new Error(`[${label}] Solid ${solid.name} has no triangles.`);
    }
    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
      throw new Error(
        `[${label}] Solid ${solid.name} is not a closed manifold: `
        + `boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}, triangles=${topology.triangleCount}.`,
      );
    }
    if (typeof solid._isCoherentlyOrientedManifold === "function" && solid._isCoherentlyOrientedManifold() !== true) {
      throw new Error(`[${label}] Solid ${solid.name} triangle winding is not coherently oriented.`);
    }
    if (typeof solid.volume === "function") {
      const vol = solid.volume();
      if (!(vol > 0)) {
        throw new Error(`[${label}] Solid ${solid.name} has non-positive volume ${vol}; triangle winding is inverted.`);
      }
    }
  }
}

export async function afterRun_generated_history_20260709065543(partHistory) {
  assertHeightmapSceneIsManifold(partHistory);
}

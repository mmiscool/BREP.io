// Generated from part history captured on 2026-07-09T03:51:43.970Z
// Spline -> tube -> offset shell (opening at TU2_CapEnd).
//
// Guards that the offset shell prefers the original solid's face names:
// patch-rim triangles that land coincident on an original face surface (here
// the ring at the closed CapStart corner) must be reassigned to that face
// instead of surviving as a generated sidewall face like
// TU2_CapStart_TU2_Outer_0_SW. The only sidewall faces allowed to survive are
// the rims bordering the removed (opening) face.

function faceTriangleCounts(solid) {
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const idToFaceName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
  const counts = new Map();
  for (const id of ids) {
    const name = String(idToFaceName.get(id) || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
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

export async function test_generated_history_20260709035143_offset_shell_prefers_source_face_names(partHistory) {
  const label = "generated_history_20260709035143_offset_shell_prefers_source_face_names";
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("SP");
  Object.assign(feature1.inputParams, {
    id: "SP1",
    curveResolution: "resolution",
    portRefs: [],
    bendRadius: "8",
    splinePoints: "636:2271297654",
  });
  feature1.persistentData = {
    spline: {
      points: [
        {
          id: "p0",
          position: [0, 5.760922185501727, 0],
          rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          forwardDistance: 1,
          backwardDistance: 1,
          flipDirection: false,
          attachment: null,
        },
        {
          id: "pmrcymkrdvwp8",
          position: [2.5, 2.8804609775543204, -3.867124027782186],
          rotation: [
            -0.7068748444973842, -0.7073386418235598, 0,
            0, 2.220446049250313e-16, 0.9999999999999998,
            -0.7073386418235598, 0.7068748444973845, 2.220446049250313e-16,
          ],
          forwardDistance: 0.1,
          backwardDistance: 0.1,
          flipDirection: false,
          attachment: null,
        },
        {
          id: "p1",
          position: [5, 0, 0],
          rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          forwardDistance: 1,
          backwardDistance: 1,
          flipDirection: false,
          attachment: null,
        },
      ],
    },
  };

  const feature2 = await partHistory.newFeature("TU");
  Object.assign(feature2.inputParams, {
    id: "TU2",
    path: ["SP1:SplineEdge"],
    radius: "1",
    innerRadius: 0,
    resolution: "resolution",
    mode: "Light (fast)",
    debug: false,
    boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
  });

  const feature3 = await partHistory.newFeature("O.S");
  Object.assign(feature3.inputParams, {
    id: "O.S3",
    distance: ".1",
    faces: ["TU2_CapEnd"],
    replaceOriginalSolid: true,
    debugMode: "NORMAL",
    debugSeparateRoundedCornerPipe: false,
    roundedCornerAreaLossDetectionEnabled: true,
    roundedCornerPipeSliverCollapseEnabled: true,
    roundedCornerAreaLossReassignEnabled: true,
    roundedCornerCleanupRollbackEnabled: true,
  });

  await partHistory.runHistory({ throwOnFeatureError: true });

  const shell = (partHistory.scene?.children || []).find(
    (child) => child?.type === "SOLID" && String(child?.name || "") === "TU2_O.S3",
  );
  if (!shell) {
    const solidNames = (partHistory.scene?.children || [])
      .filter((child) => child?.type === "SOLID")
      .map((child) => String(child?.name || ""));
    throw new Error(`[${label}] Expected offset shell solid TU2_O.S3. Solids: ${solidNames.join(", ")}`);
  }

  const topology = analyzeMeshTopology(shell);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[${label}] Expected closed manifold shell. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}, triangles=${topology.triangleCount}.`,
    );
  }

  const counts = faceTriangleCounts(shell);
  const faceNames = Array.from(counts.keys());

  for (const required of ["TU2_Outer", "TU2_CapStart"]) {
    if (!(counts.get(required) > 0)) {
      throw new Error(`[${label}] Expected original face ${required} to survive. Faces: ${faceNames.join(", ")}`);
    }
  }

  // Sidewall faces may only survive along the removed (opening) face; the rim
  // at the closed CapStart corner must fold into the original face names.
  const openingFaceName = "TU2_CapEnd";
  const straySidewalls = faceNames.filter(
    (name) => /_SW$/.test(name) && !name.includes(openingFaceName),
  );
  if (straySidewalls.length) {
    throw new Error(
      `[${label}] Expected sidewall faces only at the ${openingFaceName} opening; `
      + `stray sidewalls: ${straySidewalls.map((name) => `${name}(${counts.get(name)})`).join(", ")}`,
    );
  }

  return partHistory;
}

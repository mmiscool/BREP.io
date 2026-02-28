export async function test_SweepFace(partHistory) {
    const cone = await partHistory.newFeature("P.CO");
    cone.inputParams.radiusTop = 3;
    cone.inputParams.radiusBottom = .5;
    cone.inputParams.height = 5.2;
    cone.inputParams.resolution = 20;

    // Build a simple sketch with a straight path edge of length 5 along +Z.
    // We place the sketch on an XZ plane so the line from (0,0)→(0,5) maps to +Z in world.
    const plane = await partHistory.newFeature("P");
    plane.inputParams.orientation = "YZ";

    const sketch = await partHistory.newFeature("S");
    sketch.inputParams.sketchPlane = plane.inputParams.featureID;
    // Define a minimal sketch: one path line (id:100) and a tiny closed loop so edges get added to the scene.
    sketch.persistentData.sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },   // ground
            { id: 1, x: 8, y: 20, fixed: false },  // path end (+Z since XZ plane)
            // tiny square to ensure a profile face is created (so edges are added to scene)
            { id: 10, x: -0.5, y: -0.5, fixed: false },
            { id: 11, x:  0.5, y: -0.5, fixed: false },
            { id: 12, x:  0.5, y:  0.5, fixed: false },
            { id: 13, x: -0.5, y:  0.5, fixed: false },
        ],
        geometries: [
            // Path edge geometry (name will be G100)
            { id: 100, type: "line", points: [0, 1], construction: false },
            // Closed loop (small square) so the sketch emits edges and a face group
            { id: 200, type: "line", points: [10, 11], construction: false },
            { id: 201, type: "line", points: [11, 12], construction: false },
            { id: 202, type: "line", points: [12, 13], construction: false },
            { id: 203, type: "line", points: [13, 10], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] }, // ground point 0
        ],
    };

    // Create the path-based Sweep from the cone's top face, following the sketch edge G100.
    const sweep = await partHistory.newFeature("SW");
    sweep.inputParams.profile = `${cone.inputParams.featureID}_T`;
    sweep.inputParams.path = [`${sketch.inputParams.featureID}:G100`]; // resolve to the sketch edge created above
    sweep.inputParams.orientationMode = "translate"; // default, but make explicit

    // perform a boolean operation between the 2 solids.
    const boolean = await partHistory.newFeature("B");
    boolean.inputParams.targetSolid = cone.inputParams.featureID;
    boolean.inputParams.boolean = {
        targets: [sweep.inputParams.featureID],
        operation: "UNION",
    };

    return partHistory;
}

export async function test_SweepFace_pathAlign_multi_loop_islands(partHistory) {
    const profilePlane = await partHistory.newFeature("P");
    profilePlane.inputParams.orientation = "YZ";

    const profileSketch = await partHistory.newFeature("S");
    profileSketch.inputParams.sketchPlane = profilePlane.inputParams.featureID;
    // Three nested closed loops: outer (solid), hole, and inner island (solid).
    profileSketch.persistentData.sketch = {
        points: [
            { id: 10, x: -5, y: -5, fixed: false },
            { id: 11, x: 5, y: -5, fixed: false },
            { id: 12, x: 5, y: 5, fixed: false },
            { id: 13, x: -5, y: 5, fixed: false },

            { id: 20, x: -3, y: -3, fixed: false },
            { id: 21, x: 3, y: -3, fixed: false },
            { id: 22, x: 3, y: 3, fixed: false },
            { id: 23, x: -3, y: 3, fixed: false },

            { id: 30, x: -1, y: -1, fixed: false },
            { id: 31, x: 1, y: -1, fixed: false },
            { id: 32, x: 1, y: 1, fixed: false },
            { id: 33, x: -1, y: 1, fixed: false },
        ],
        geometries: [
            { id: 200, type: "line", points: [10, 11], construction: false },
            { id: 201, type: "line", points: [11, 12], construction: false },
            { id: 202, type: "line", points: [12, 13], construction: false },
            { id: 203, type: "line", points: [13, 10], construction: false },

            { id: 210, type: "line", points: [20, 21], construction: false },
            { id: 211, type: "line", points: [21, 22], construction: false },
            { id: 212, type: "line", points: [22, 23], construction: false },
            { id: 213, type: "line", points: [23, 20], construction: false },

            { id: 220, type: "line", points: [30, 31], construction: false },
            { id: 221, type: "line", points: [31, 32], construction: false },
            { id: 222, type: "line", points: [32, 33], construction: false },
            { id: 223, type: "line", points: [33, 30], construction: false },
        ],
        constraints: [],
    };

    // Separate path sketch on XY so the path is not coplanar with profile loops.
    const pathPlane = await partHistory.newFeature("P");
    pathPlane.inputParams.orientation = "XY";

    const pathSketch = await partHistory.newFeature("S");
    pathSketch.inputParams.sketchPlane = pathPlane.inputParams.featureID;
    pathSketch.persistentData.sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 12, y: 0, fixed: false },
        ],
        geometries: [
            { id: 100, type: "line", points: [0, 1], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
        ],
    };

    const sweep = await partHistory.newFeature("SW");
    sweep.inputParams.profile = profileSketch.inputParams.featureID;
    sweep.inputParams.path = [`${pathSketch.inputParams.featureID}:G100`];
    sweep.inputParams.orientationMode = "pathAlign";
    sweep.inputParams.consumeProfileSketch = false;

    return partHistory;
}

export async function afterRun_sweepFace_pathAlign_multi_loop_islands(partHistory) {
    const sweepFeature = (partHistory?.features || []).find((entry) => String(entry?.type || "").toUpperCase() === "SW");
    const islandCount = Number(sweepFeature?.persistentData?.profileIslandCount) || 0;
    const islandEdgeCounts = Array.isArray(sweepFeature?.persistentData?.profileIslandEdgeCounts)
        ? sweepFeature.persistentData.profileIslandEdgeCounts
        : [];
    if (islandCount > 1) {
        if (islandEdgeCounts.length !== islandCount) {
            throw new Error("[sweep_path_align_multi_loop_islands] Missing per-island edge counts.");
        }
        if (islandEdgeCounts.some((count) => !(Number(count) > 0))) {
            throw new Error("[sweep_path_align_multi_loop_islands] One or more profile islands lost edge data.");
        }
    }

    const solids = (partHistory?.scene?.children || []).filter((obj) => String(obj?.type || "").toUpperCase() === "SOLID");
    if (!solids.length) {
        throw new Error("[sweep_path_align_multi_loop_islands] Expected sweep to produce a solid.");
    }
    const sweepSolid = solids.find((obj) => String(obj?.name || "").startsWith("SW")) || solids[0];
    let mesh = null;
    try {
        mesh = sweepSolid.getMesh();
    } catch (err) {
        throw new Error(`[sweep_path_align_multi_loop_islands] Sweep solid is not manifold: ${err?.message || err}`);
    }
    let triCount = 0;
    try {
        triCount = (typeof mesh?.numTri === "function")
            ? Number(mesh.numTri()) || 0
            : ((mesh?.triVerts?.length || 0) / 3);
    } finally {
        try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
    }
    if (!(triCount > 0)) {
        throw new Error("[sweep_path_align_multi_loop_islands] Sweep solid has no triangles.");
    }
}

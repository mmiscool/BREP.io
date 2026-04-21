import { Cube } from "../BREP/primitives.js";
import { manifold, manifoldBuildSource } from "../BREP/setupManifold.js";
import { PartHistory } from "../PartHistory.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

const FOLDBACK_FIXTURE_SKETCH = {
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
        { id: 0, type: "⏚", points: [0], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "0:0,0,1;" },
        { id: 1, type: "≡", points: [1, 3], status: "", error: null, _previousSolveValue: null, previousPointValues: "1:-2.504334,-3.287135,0;3:-2.504334,-3.287135,0;" },
        { id: 3, type: "≡", points: [2, 6], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "2:6.391665,6.452413,0;6:6.391665,6.452413,0;" },
        { id: 4, type: "≡", points: [7, 8], status: "", error: null, _previousSolveValue: null, previousPointValues: "7:-2.504333,6.452412,0;8:-2.504333,6.452412,0;" },
        { id: 7, type: "⟂", points: [6, 7, 8, 3], status: "", error: null, value: 270, _previousSolveValue: 270, previousPointValues: "6:5.357399948061701,6.756693642653996,0;7:-2.8534559480617006,6.093104357346005,0;8:-2.853456,6.093105,0;3:-2.150647,-2.603049,0;" },
        { id: 8, type: "│", points: [8, 3], labelX: 0, labelY: 0, displayStyle: "", value: null, valueNeedsSetup: true, status: "", error: null, _previousSolveValue: null, previousPointValues: "8:-2.504327,6.4524,0;3:-2.504327,-3.27361,0;" },
        { id: 12, type: "≡", points: [15, 16], status: "solved", error: null, _previousSolveValue: null, previousPointValues: "15:1.803917,3.614373,0;16:1.803917,3.614373,0;" },
    ],
};

function keyOfPoint(point) {
    return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)},${Number(point[2]).toFixed(6)}`;
}

function pointFromKey(key) {
    return key.split(",").map((value) => Number(value));
}

function addUndirectedEdge(edgeCounts, a, b) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
}

function buildFaceBoundaryLoop(face) {
    const edgeCounts = new Map();
    for (const tri of face?.triangles || []) {
        const a = keyOfPoint(tri.p1);
        const b = keyOfPoint(tri.p2);
        const c = keyOfPoint(tri.p3);
        addUndirectedEdge(edgeCounts, a, b);
        addUndirectedEdge(edgeCounts, b, c);
        addUndirectedEdge(edgeCounts, c, a);
    }

    const adjacency = new Map();
    for (const [edgeKey, count] of edgeCounts) {
        if (count !== 1) continue;
        const [a, b] = edgeKey.split("|");
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a).push(b);
        adjacency.get(b).push(a);
    }
    const start = adjacency.keys().next().value;
    if (!start) return [];

    const loop = [start];
    let prev = null;
    let curr = start;
    while (loop.length <= adjacency.size + 1) {
        const nextCandidates = (adjacency.get(curr) || []).filter((candidate) => candidate !== prev);
        if (nextCandidates.length === 0) break;
        const next = nextCandidates[0];
        if (next === start) break;
        loop.push(next);
        prev = curr;
        curr = next;
    }
    return loop.map(pointFromKey);
}

function pointDistance(a, b) {
    return Math.hypot(
        Number(a[0]) - Number(b[0]),
        Number(a[1]) - Number(b[1]),
        Number(a[2]) - Number(b[2]),
    );
}

function distanceToPolyline(point, polyline) {
    let best = Infinity;
    for (const candidate of polyline || []) {
        const dist = pointDistance(point, candidate);
        if (dist < best) best = dist;
    }
    return best;
}

function longestTrueRun(flags) {
    const count = Array.isArray(flags) ? flags.length : 0;
    let best = { start: 0, length: 0 };
    for (let start = 0; start < count; start += 1) {
        if (!flags[start] || flags[(start - 1 + count) % count]) continue;
        let length = 0;
        while (length < count && flags[(start + length) % count]) length += 1;
        if (length > best.length) best = { start, length };
    }
    return best;
}

function extractChamferSideChains(loop, sourcePolyline, threshold) {
    const nearSource = loop.map((point) => distanceToPolyline(point, sourcePolyline) <= threshold);
    const run = longestTrueRun(nearSource);
    const edgeChain = [];
    for (let i = 0; i < run.length; i += 1) {
        edgeChain.push(loop[(run.start + i) % loop.length]);
    }
    const offsetChain = [];
    for (let i = 0; i < loop.length - run.length; i += 1) {
        offsetChain.push(loop[(run.start + run.length + i) % loop.length]);
    }
    offsetChain.reverse();
    return { edgeChain, offsetChain };
}

function minimumSegmentAlignment(edgeChain, offsetChain) {
    const segmentCount = Math.min(edgeChain.length, offsetChain.length) - 1;
    let minDot = Infinity;
    for (let i = 0; i < segmentCount; i += 1) {
        const edgeDir = [
            edgeChain[i + 1][0] - edgeChain[i][0],
            edgeChain[i + 1][1] - edgeChain[i][1],
            edgeChain[i + 1][2] - edgeChain[i][2],
        ];
        const offsetDir = [
            offsetChain[i + 1][0] - offsetChain[i][0],
            offsetChain[i + 1][1] - offsetChain[i][1],
            offsetChain[i + 1][2] - offsetChain[i][2],
        ];
        const edgeLen = Math.hypot(edgeDir[0], edgeDir[1], edgeDir[2]);
        const offsetLen = Math.hypot(offsetDir[0], offsetDir[1], offsetDir[2]);
        if (!(edgeLen > 1e-9) || !(offsetLen > 1e-9)) continue;
        const dot =
            ((edgeDir[0] * offsetDir[0]) + (edgeDir[1] * offsetDir[1]) + (edgeDir[2] * offsetDir[2]))
            / (edgeLen * offsetLen);
        if (dot < minDot) minDot = dot;
    }
    return minDot;
}

async function buildFoldbackFixture(partHistory = new PartHistory()) {
    partHistory.expressions = "resolution = 32;\n";
    partHistory.configurator = { fields: [], values: {} };

    const datum = await partHistory.newFeature("D");
    Object.assign(datum.inputParams, {
        id: "D1",
        transform: {
            position: [0.2565036028836988, 5.286649371275551, -3.590228990331272],
            rotationEuler: [-32.818971321018715, 30.63210260878807, -2.671532847188412],
            scale: [1, 1, 1],
        },
    });

    const sketch = await partHistory.newFeature("S");
    Object.assign(sketch.inputParams, {
        id: "S2",
        sketchPlane: "D1:XY",
        editSketch: null,
        dumpSketchDiagnostics: null,
        curveResolution: "resolution",
    });
    sketch.persistentData = { sketch: FOLDBACK_FIXTURE_SKETCH };

    const extrude = await partHistory.newFeature("E");
    Object.assign(extrude.inputParams, {
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

    const fillet = await partHistory.newFeature("F");
    Object.assign(fillet.inputParams, {
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
        inflate: "0.2",
        nudgeFaceDistance: ".0001",
        direction: "AUTO",
        debug: "NONE",
        simplifyResult: true,
        cleanupNativeTinyFaceIslands: true,
        reverseEndCapNudge: false,
        mergeCoplanarEndCaps: true,
        reassignSliverTriangles: true,
        collapseTinyTriangles: true,
        cleanupPostCollapseTinyFaceIslands: true,
    });

    await partHistory.runHistory();
    const solid = (partHistory.scene?.children || []).find((obj) => obj?.type === "SOLID" && obj?.name === "E3");
    assert(solid, "Expected foldback fixture to produce solid E3.");

    const edge = (solid.children || []).find(
        (child) => child?.type === "EDGE"
            && child?.name === "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G10_SW_E3_S2_G11_SW_e44b5ee8_3_TUBE_Outer[0]",
    );
    assert(edge, "Expected foldback fixture to expose the fillet outer edge for chamfer testing.");
    return { solid, edge };
}

export async function test_cppChamfer_single_edge_builds_native_named_tool_and_result() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 20, y: 20, z: 20, name: "CPP_CHAMFER_CUBE" });
    cube.visualize();

    const edge = (cube.children || []).find((child) => child?.type === "EDGE" && child?.faces?.length === 2);
    assert(edge, "Expected visualized cube to expose a boundary edge for chamfer testing.");

    const result = await cube.chamfer({
        distance: 3,
        edges: [edge],
        direction: "INSET",
        inflate: 0.0005,
        debug: true,
        featureID: "CPP_CHAMFER",
    });

    assert(result && result.getTriangleCount() > 0, "Expected native chamfer result to contain triangles.");
    const debugChamfer = Array.isArray(result.__debugChamferSolids) ? result.__debugChamferSolids[0] : null;
    assert(debugChamfer, "Expected native chamfer path to retain the built chamfer tool solid for debug inspection.");

    const faceA = String(edge.faces[0]?.name || "");
    const faceB = String(edge.faces[1]?.name || "");
    const baseName = `CHAMFER_${faceA}|${faceB}`;
    const faceNames = new Set(debugChamfer.getFaceNames());
    assert(faceNames.has(`${baseName}_SIDE_A`), "Expected native chamfer tool to expose SIDE_A face.");
    assert(faceNames.has(`${baseName}_SIDE_B`), "Expected native chamfer tool to expose SIDE_B face.");
    assert(faceNames.has(`${baseName}_BEVEL`), "Expected native chamfer tool to expose BEVEL face.");
}

export async function test_cppChamfer_auto_direction_uses_native_classifier() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 20, y: 20, z: 20, name: "CPP_CHAMFER_AUTO_CUBE" });
    cube.visualize();

    const edge = (cube.children || []).find((child) => child?.type === "EDGE" && child?.faces?.length === 2);
    assert(edge, "Expected visualized cube to expose a boundary edge for AUTO chamfer testing.");

    const result = await cube.chamfer({
        distance: 2,
        edges: [edge],
        direction: "AUTO",
        inflate: 0.0005,
        debug: true,
        featureID: "CPP_CHAMFER_AUTO",
    });

    assert(result && result.getTriangleCount() > 0, "Expected AUTO native chamfer result to contain triangles.");
    const debugChamfer = Array.isArray(result.__debugChamferSolids) ? result.__debugChamferSolids[0] : null;
    assert(debugChamfer, "Expected AUTO native chamfer path to retain the built chamfer tool.");
    assert(debugChamfer.getTriangleCount() > 0, "Expected AUTO native chamfer tool to contain triangles.");
}

export async function test_cppChamfer_stabilizes_tiny_terminal_segments_before_offsetting(partHistory = new PartHistory()) {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const { solid, edge } = await buildFoldbackFixture(partHistory);
    const result = await solid.chamfer({
        distance: 0.5,
        edges: [edge],
        direction: "AUTO",
        inflate: 0.1,
        debug: true,
        featureID: "CPP_CHAMFER_FOLDBACK",
    });

    const debugChamfer = Array.isArray(result.__debugChamferSolids) ? result.__debugChamferSolids[0] : null;
    assert(debugChamfer, "Expected foldback regression fixture to retain the native chamfer tool.");

    const sideA = (debugChamfer.getFaces(false) || []).find((face) => face?.faceName?.endsWith("_SIDE_A"));
    assert(sideA, "Expected foldback regression fixture to expose the SIDE_A face.");

    const boundaryLoop = buildFaceBoundaryLoop(sideA);
    assert(boundaryLoop.length >= 6, "Expected SIDE_A boundary loop to expose both edge and offset chains.");

    const { edgeChain, offsetChain } = extractChamferSideChains(boundaryLoop, edge.userData?.polylineLocal || [], 0.2);
    assert(edgeChain.length >= 4, `Expected chamfer edge-side chain to contain several samples, received ${edgeChain.length}.`);
    assert(offsetChain.length >= 4, `Expected chamfer offset-side chain to contain several samples, received ${offsetChain.length}.`);

    const minAlignment = minimumSegmentAlignment(edgeChain, offsetChain);
    assert(
        Number.isFinite(minAlignment) && minAlignment > 0.25,
        `Expected chamfer offset rail to stay monotonic after tiny terminal segments are smoothed; min alignment=${minAlignment}.`,
    );
}

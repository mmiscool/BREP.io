import { Cube } from "../BREP/primitives.js";
import { manifold, manifoldBuildSource } from "../BREP/setupManifold.js";
import { buildSolidAuthoringStateSnapshot } from "../BREP/CppSolidCore.js";
import { PartHistory } from "../PartHistory.js";
import { ChamferFeature } from "../features/chamfer/ChamferFeature.js";
import { ExtrudeFeature } from "../features/extrude/ExtrudeFeature.js";

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

const MULTI_EDGE_TANGENT_CAP_FIXTURE_EDGE_NAMES = [
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G10_SW_E3_S2_G11_SW_e44b5ee8_3_TUBE_Outer[0]",
    "E3:S2:G11_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:G10_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G11_SW_E3_S2_G12_SW_78da4f1c_5_TUBE_Outer[0]",
    "E3:S2:G12_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G12_SW_E3_S2_G3_SW_90d5733b_1_TUBE_Outer[0]",
    "E3:S2:G3_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G3_SW_E3_S2_G4_SW_6a443286_2_TUBE_Outer[0]",
    "E3:S2:G4_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G4_SW_E3_S2_G9_SW_6e866edc_4_TUBE_Outer[0]",
    "E3:S2:G9_SW|E3:S2:PROFILE_START[0]",
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G10_SW_E3_S2_G9_SW_478767db_0_TUBE_Outer[0]",
];

const CHAMFER_END_CAP_PLANE_FIXTURE_EDGE_NAME =
    "E3:S2:PROFILE_START|F4_FILLET_E3_S2_G11_SW_E3_S2_G12_SW_78da4f1c_5_TUBE_Outer[0]";

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

function subtractPoints(a, b) {
    return [
        Number(a[0]) - Number(b[0]),
        Number(a[1]) - Number(b[1]),
        Number(a[2]) - Number(b[2]),
    ];
}

function dotPoints(a, b) {
    return (Number(a[0]) * Number(b[0])) + (Number(a[1]) * Number(b[1])) + (Number(a[2]) * Number(b[2]));
}

function normalizePoint(vector) {
    const length = Math.hypot(Number(vector[0]), Number(vector[1]), Number(vector[2]));
    if (!(length > 1e-12)) return [0, 0, 0];
    return [
        Number(vector[0]) / length,
        Number(vector[1]) / length,
        Number(vector[2]) / length,
    ];
}

function computeChamferTangentSampleDistance(polyline, closedLoop = false) {
    if (!Array.isArray(polyline) || polyline.length < 2) return 1e-6;
    const segmentCount = closedLoop ? polyline.length : (polyline.length - 1);
    let totalLength = 0;
    let maxSegmentLength = 0;
    let positiveCount = 0;
    for (let i = 0; i < segmentCount; i += 1) {
        const a = polyline[i];
        const b = polyline[(i + 1) % polyline.length];
        const length = pointDistance(a, b);
        if (!(length > 1e-12)) continue;
        totalLength += length;
        maxSegmentLength = Math.max(maxSegmentLength, length);
        positiveCount += 1;
    }
    if (positiveCount === 0) return 1e-6;
    const averageSegmentLength = totalLength / positiveCount;
    return Math.max(1e-6, averageSegmentLength * 0.5, maxSegmentLength * 0.1);
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

function collectUniqueFacePoints(face) {
    const points = [];
    for (const tri of face?.triangles || []) {
        for (const point of [tri.p1, tri.p2, tri.p3]) {
            const candidate = [Number(point[0]), Number(point[1]), Number(point[2])];
            if (points.some((existing) => pointDistance(existing, candidate) <= 1e-6)) continue;
            points.push(candidate);
        }
    }
    return points;
}

function triangleArea3(a, b, c) {
    const ab = subtractPoints(b, a);
    const ac = subtractPoints(c, a);
    const cross = [
        (ab[1] * ac[2]) - (ab[2] * ac[1]),
        (ab[2] * ac[0]) - (ab[0] * ac[2]),
        (ab[0] * ac[1]) - (ab[1] * ac[0]),
    ];
    return 0.5 * Math.hypot(cross[0], cross[1], cross[2]);
}

function computeChamferStableTangent(polyline, pointIndex, minDistance, closedLoop = false) {
    if (!Array.isArray(polyline) || polyline.length < 2 || pointIndex >= polyline.length) {
        return [0, 0, 0];
    }
    const count = polyline.length;
    const minSpan = Number.isFinite(minDistance) ? Math.max(1e-6, minDistance) : 1e-6;
    let prevIndex = pointIndex;
    let nextIndex = pointIndex;

    if (closedLoop) {
        let backwardDistance = 0;
        let backwardSteps = 0;
        while ((backwardSteps + 1) < count && backwardDistance < minSpan) {
            const nextPrev = (prevIndex + count - 1) % count;
            backwardDistance += pointDistance(polyline[prevIndex], polyline[nextPrev]);
            prevIndex = nextPrev;
            backwardSteps += 1;
        }
        let forwardDistance = 0;
        let forwardSteps = 0;
        while ((forwardSteps + 1) < count && forwardDistance < minSpan) {
            const nextNext = (nextIndex + 1) % count;
            forwardDistance += pointDistance(polyline[nextNext], polyline[nextIndex]);
            nextIndex = nextNext;
            forwardSteps += 1;
        }
    } else {
        let backwardDistance = 0;
        while (prevIndex > 0 && backwardDistance < minSpan) {
            backwardDistance += pointDistance(polyline[prevIndex], polyline[prevIndex - 1]);
            prevIndex -= 1;
        }
        let forwardDistance = 0;
        while ((nextIndex + 1) < count && forwardDistance < minSpan) {
            forwardDistance += pointDistance(polyline[nextIndex + 1], polyline[nextIndex]);
            nextIndex += 1;
        }
    }

    const tangent = subtractPoints(polyline[nextIndex], polyline[prevIndex]);
    if ((dotPoints(tangent, tangent)) > 1e-14) return normalizePoint(tangent);

    const fallbackPrev = closedLoop ? ((pointIndex + count - 1) % count) : (pointIndex > 0 ? (pointIndex - 1) : 0);
    const fallbackNext = closedLoop ? ((pointIndex + 1) % count) : Math.min(count - 1, pointIndex + 1);
    return normalizePoint(subtractPoints(polyline[fallbackNext], polyline[fallbackPrev]));
}

function maxCapDistanceFromEndpointPlane(debugChamfer, edge, capFaceName) {
    const face = (debugChamfer?.getFaces?.(false) || []).find((candidate) => candidate?.faceName === capFaceName);
    const points = collectUniqueFacePoints(face);
    const polyline = Array.isArray(edge?.userData?.polylineLocal) ? edge.userData.polylineLocal : [];
    assert(points.length >= 3, `Expected cap face ${capFaceName} to expose three unique points.`);
    assert(polyline.length >= 2, "Expected chamfer regression edge to expose a polyline.");

    const endpointOptions = [0, polyline.length - 1].map((polylineIndex, endpointIndex) => {
        const endpoint = polyline[polylineIndex];
        const minDistance = Math.min(...points.map((point) => pointDistance(point, endpoint)));
        return { endpointIndex, endpoint, minDistance };
    });
    endpointOptions.sort((a, b) => a.minDistance - b.minDistance);
    const chosen = endpointOptions[0];
    const tangentSampleDistance = computeChamferTangentSampleDistance(polyline, false);
    const tangent = computeChamferStableTangent(
        polyline,
        chosen.endpointIndex === 0 ? 0 : (polyline.length - 1),
        tangentSampleDistance,
        false,
    );
    assert(Math.hypot(...tangent) > 1e-9, `Expected endpoint tangent for ${capFaceName} to be finite.`);

    const anchor = points.reduce((best, point) => (
        pointDistance(point, chosen.endpoint) < pointDistance(best, chosen.endpoint) ? point : best
    ), points[0]);
    return Math.max(...points.map((point) => Math.abs(dotPoints(subtractPoints(point, anchor), tangent))));
}

function maxSectionDistanceFromEndpointPlane(sectionSolid, edge, endpointIndex) {
    const face = (sectionSolid?.getFaces?.(false) || [])[0];
    const points = collectUniqueFacePoints(face);
    const polyline = Array.isArray(edge?.userData?.polylineLocal) ? edge.userData.polylineLocal : [];
    assert(points.length >= 3, "Expected chamfer section debug solid to expose three unique points.");
    assert(polyline.length >= 2, "Expected chamfer regression edge to expose a polyline.");

    const polylineIndex = endpointIndex === 0 ? 0 : (polyline.length - 1);
    const endpoint = polyline[polylineIndex];
    const tangentSampleDistance = computeChamferTangentSampleDistance(polyline, false);
    const tangent = computeChamferStableTangent(polyline, polylineIndex, tangentSampleDistance, false);
    assert(Math.hypot(...tangent) > 1e-9, "Expected endpoint tangent for chamfer section to be finite.");

    const anchor = points.reduce((best, point) => (
        pointDistance(point, endpoint) < pointDistance(best, endpoint) ? point : best
    ), points[0]);
    return Math.max(...points.map((point) => Math.abs(dotPoints(subtractPoints(point, anchor), tangent))));
}

function maxSectionEntryDistanceFromEndpointPlane(sectionEntry, edge, endpointIndex) {
    const points = [sectionEntry?.a, sectionEntry?.b, sectionEntry?.c].map((point) => [
        Number(point?.[0]),
        Number(point?.[1]),
        Number(point?.[2]),
    ]);
    const polyline = Array.isArray(edge?.userData?.polylineLocal) ? edge.userData.polylineLocal : [];
    assert(points.length === 3, "Expected chamfer section debug entry to expose exactly three points.");
    assert(points.every((point) => point.every((value) => Number.isFinite(value))), "Expected chamfer section debug entry to expose finite point coordinates.");
    assert(polyline.length >= 2, "Expected chamfer regression edge to expose a polyline.");

    const polylineIndex = endpointIndex === 0 ? 0 : (polyline.length - 1);
    const endpoint = polyline[polylineIndex];
    const tangentSampleDistance = computeChamferTangentSampleDistance(polyline, false);
    const tangent = computeChamferStableTangent(polyline, polylineIndex, tangentSampleDistance, false);
    assert(Math.hypot(...tangent) > 1e-9, "Expected endpoint tangent for chamfer section entry to be finite.");

    const anchor = points.reduce((best, point) => (
        pointDistance(point, endpoint) < pointDistance(best, endpoint) ? point : best
    ), points[0]);
    return Math.max(...points.map((point) => Math.abs(dotPoints(subtractPoints(point, anchor), tangent))));
}

function buildNativeChamferToolSnapshot(solid, edge, {
    distance,
    inflate = 0,
    direction = "INSET",
    name = "CPP_CHAMFER_NATIVE_TOOL",
    debugCrossSections = false,
}: any = {}) {
    const snapshot = buildSolidAuthoringStateSnapshot(solid);
    assert(snapshot, "Expected solid to expose an authoring snapshot for native chamfer testing.");

    const faceAName = String(edge?.faces?.[0]?.name || "");
    const faceBName = String(edge?.faces?.[1]?.name || "");
    assert(faceAName && faceBName, "Expected chamfer test edge to expose two adjacent face names.");

    const polyline = Array.isArray(edge?.userData?.polylineLocal)
        ? edge.userData.polylineLocal
        : (Array.isArray(edge?.points) ? edge.points : []);
    assert(polyline.length >= 2, "Expected chamfer test edge to expose a polyline.");

    return manifold.buildChamferAuthoringState({
        snapshot,
        faceAName,
        faceBName,
        polyline,
        distance,
        inflate,
        direction,
        name,
        debugCrossSections,
    });
}

function snapshotFaceNames(snapshot) {
    return Array.isArray(snapshot?.faceNameToID)
        ? snapshot.faceNameToID.map((entry) => String(Array.isArray(entry) ? entry[0] : ""))
        : [];
}

function sectionIndexOf(entry) {
    const match = /_SECTION_(\d+)$/.exec(String(entry?.name || ""));
    return match ? Number(match[1]) : -1;
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

function resolveFixtureEdgesByName(solid, edgeNames) {
    const children = Array.isArray(solid?.children) ? solid.children : [];
    return edgeNames.map((edgeName) => children.find(
        (child) => child?.type === "EDGE" && String(child?.name || "") === String(edgeName),
    ));
}

export async function test_cppChamfer_single_edge_builds_native_named_tool_and_result() {
    if (
        manifoldBuildSource !== "local"
        || typeof manifold?.buildChamferWorkflowAuthoringState !== "function"
        || typeof manifold?.buildChamferAuthoringState !== "function"
    ) {
        return;
    }

    const cube = new Cube({ x: 20, y: 20, z: 20, name: "CPP_CHAMFER_CUBE" });
    cube.visualize();

    const edge = (cube.children || []).find((child) => child?.type === "EDGE" && child?.faces?.length === 2);
    assert(edge, "Expected visualized cube to expose a boundary edge for chamfer testing.");

    const nativeToolSnapshot = buildNativeChamferToolSnapshot(cube, edge, {
        distance: 3,
        inflate: 0.0005,
        direction: "INSET",
        name: "CPP_CHAMFER_SINGLE_EDGE_TOOL",
    });
    assert(nativeToolSnapshot?.chamferBuildMode === "CHAIN_HULL", "Expected native chamfer tool to be built from chained hull segments.");
    const nativeToolFaceNames = snapshotFaceNames(nativeToolSnapshot);
    assert(nativeToolFaceNames.length > 0, "Expected native chained-hull chamfer tool to expose faces.");
    const faceA = String(edge.faces[0]?.name || "");
    const faceB = String(edge.faces[1]?.name || "");
    const baseName = `CHAMFER_${faceA}|${faceB}`;
    assert(
        nativeToolFaceNames.includes(`${baseName}_SIDE_A`)
            && nativeToolFaceNames.includes(`${baseName}_SIDE_B`)
            && nativeToolFaceNames.includes(`${baseName}_BEVEL`)
            && nativeToolFaceNames.includes(`${baseName}_CAP0`)
            && nativeToolFaceNames.includes(`${baseName}_CAP1`),
        "Expected native chained-hull chamfer tool to restore the legacy semantic chamfer face names.",
    );

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
    assert(debugChamfer.getTriangleCount() > 0, "Expected debug chamfer tool solid to contain triangles.");
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
    if (
        manifoldBuildSource !== "local"
        || typeof manifold?.buildChamferWorkflowAuthoringState !== "function"
        || typeof manifold?.buildChamferAuthoringState !== "function"
    ) {
        return;
    }

    const { solid, edge } = await buildFoldbackFixture(partHistory);
    const nativeToolSnapshot = buildNativeChamferToolSnapshot(solid, edge, {
        distance: 0.5,
        inflate: 0.1,
        direction: "INSET",
        name: "CPP_CHAMFER_FOLDBACK_TOOL",
        debugCrossSections: true,
    });
    assert(nativeToolSnapshot?.chamferBuildMode === "CHAIN_HULL", "Expected foldback regression tool to use chained hull construction.");
    const faceNames = snapshotFaceNames(nativeToolSnapshot);
    const baseName = `CHAMFER_${String(edge.faces[0]?.name || "")}|${String(edge.faces[1]?.name || "")}`;
    assert(
        faceNames.includes(`${baseName}_SIDE_A`)
            && faceNames.includes(`${baseName}_SIDE_B`)
            && faceNames.includes(`${baseName}_BEVEL`)
            && faceNames.includes(`${baseName}_CAP0`)
            && faceNames.includes(`${baseName}_CAP1`),
        "Expected foldback regression tool to restore the legacy semantic chamfer face names.",
    );

    const crossSections = Array.isArray(nativeToolSnapshot?.debugCrossSectionSnapshots)
        ? nativeToolSnapshot.debugCrossSectionSnapshots
        : [];
    assert(crossSections.length >= 4, `Expected foldback regression tool to emit several cross sections; received ${crossSections.length}.`);
    for (const section of crossSections) {
        const a = section?.a || [];
        const b = section?.b || [];
        const c = section?.c || [];
        assert(
            triangleArea3(a, b, c) > 1e-8,
            `Expected foldback regression cross section ${section?.name || "<unknown>"} to remain a valid triangle.`,
        );
    }
}

export async function test_cppChamfer_bridges_nearly_tangent_adjacent_end_caps(partHistory = new PartHistory()) {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const { solid } = await buildFoldbackFixture(partHistory);
    const edges = resolveFixtureEdgesByName(solid, MULTI_EDGE_TANGENT_CAP_FIXTURE_EDGE_NAMES);
    assert(
        edges.every((edge) => edge),
        "Expected tangent-cap regression fixture to expose all requested chamfer edges.",
    );

    const result = await solid.chamfer({
        distance: 0.5,
        edges,
        direction: "AUTO",
        inflate: 0.1,
        debug: true,
        featureID: "CPP_CHAMFER_TANGENT_CAPS",
    });

    assert(result && result.getTriangleCount() > 0, "Expected tangent-cap chamfer regression to produce geometry.");
    const directionDecision = result.__chamferDirectionDecision || {};
    assert(
        Number(directionDecision.tangentCapBridges) >= 1,
        `Expected native chamfer workflow to add at least one tangent cap bridge; received ${directionDecision.tangentCapBridges}.`,
    );

    const debugChamferSolids = Array.isArray(result.__debugChamferSolids) ? result.__debugChamferSolids : [];
    const bridgeSolids = debugChamferSolids.filter((solidEntry) => String(solidEntry?.name || "").includes("TANGENT_CAP_BRIDGE"));
    assert(bridgeSolids.length >= 1, "Expected tangent-cap regression to emit a debug bridge solid.");
    assert(
        bridgeSolids.every((solidEntry) => typeof solidEntry?.getTriangleCount === "function" && solidEntry.getTriangleCount() > 0),
        "Expected each tangent cap bridge debug solid to contain triangles.",
    );
    assert(
        bridgeSolids.some((solidEntry) => {
            const faceNames = new Set(typeof solidEntry?.getFaceNames === "function" ? solidEntry.getFaceNames() : []);
            return Array.from(faceNames).some((faceName) => String(faceName || "").includes("_SOURCE_CAP"))
                && Array.from(faceNames).some((faceName) => String(faceName || "").includes("_TARGET_CAP"));
        }),
        "Expected tangent cap bridge debug geometry to expose source/target cap faces from the extension prism.",
    );
}

export async function test_cppChamfer_projects_open_end_caps_back_to_endpoint_plane(partHistory = new PartHistory()) {
    if (
        manifoldBuildSource !== "local"
        || typeof manifold?.buildChamferWorkflowAuthoringState !== "function"
        || typeof manifold?.buildChamferAuthoringState !== "function"
    ) {
        return;
    }

    const { solid } = await buildFoldbackFixture(partHistory);
    const edge = resolveFixtureEdgesByName(solid, [CHAMFER_END_CAP_PLANE_FIXTURE_EDGE_NAME])[0];
    assert(edge, "Expected end-cap plane regression fixture to expose the target chamfer edge.");

    for (const inflate of [0.101, -0.101]) {
        const nativeToolSnapshot = buildNativeChamferToolSnapshot(solid, edge, {
            distance: 0.5,
            inflate,
            direction: "INSET",
            name: `CPP_CHAMFER_CAP_PLANE_${inflate > 0 ? "POS" : "NEG"}`,
            debugCrossSections: true,
        });
        const crossSections = Array.isArray(nativeToolSnapshot?.debugCrossSectionSnapshots)
            ? nativeToolSnapshot.debugCrossSectionSnapshots
            : [];
        const lastSection = crossSections[crossSections.length - 1];
        assert(lastSection, "Expected chamfer debug snapshot to expose the terminal cross section.");

        const maxPlaneDeviation = maxSectionEntryDistanceFromEndpointPlane(lastSection, edge, 1);
        assert(
            Number.isFinite(maxPlaneDeviation) && maxPlaneDeviation <= 1e-4,
            `Expected terminal chamfer cross section to stay on the endpoint tangent plane after inflate=${inflate}; max deviation=${maxPlaneDeviation}.`,
        );
    }
}

export async function test_cppChamfer_debug_emits_cross_section_face_per_sample(partHistory = new PartHistory()) {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const { solid } = await buildFoldbackFixture(partHistory);
    const edge = resolveFixtureEdgesByName(solid, [CHAMFER_END_CAP_PLANE_FIXTURE_EDGE_NAME])[0];
    assert(edge, "Expected cross-section debug fixture to expose the target chamfer edge.");

    const expectedSectionCount = Array.isArray(edge?.userData?.polylineLocal) ? edge.userData.polylineLocal.length : 0;
    assert(expectedSectionCount >= 2, "Expected cross-section debug fixture edge to expose sampled polyline points.");

    const result = await solid.chamfer({
        distance: 0.5,
        edges: [edge],
        direction: "AUTO",
        inflate: 0.101,
        debug: true,
        featureID: "CPP_CHAMFER_DEBUG_SECTIONS",
    });

    const debugChamferSolids = Array.isArray(result.__debugChamferSolids) ? result.__debugChamferSolids : [];
    const sectionSolids = debugChamferSolids.filter((solidEntry) => /_SECTION_\d+$/.test(String(solidEntry?.name || "")));
    assert(
        sectionSolids.length >= Math.max(2, expectedSectionCount - 1),
        `Expected debug cross-section faces for nearly every edge sample; expected about ${expectedSectionCount}, received ${sectionSolids.length}.`,
    );
    assert(
        sectionSolids.every((solidEntry) => Array.isArray(solidEntry?._triVerts) && solidEntry._triVerts.length === 3),
        "Expected every chamfer cross-section debug solid to contain exactly one triangle.",
    );
    assert(
        sectionSolids.every((solidEntry) => {
            const faceNames = typeof solidEntry?.getFaceNames === "function" ? solidEntry.getFaceNames() : [];
            return Array.isArray(faceNames) && faceNames.length === 1 && /_SECTION_\d+$/.test(String(faceNames[0] || ""));
        }),
        "Expected each chamfer cross-section debug solid to expose a single named section face.",
    );
    const firstSection = sectionSolids[0];
    assert(firstSection, "Expected at least one chamfer cross-section debug solid.");
    const triPoints = [];
    for (const rawIndex of firstSection._triVerts || []) {
        const index = Number(rawIndex);
        triPoints.push([
            Number(firstSection._vertProperties[index * 3 + 0]),
            Number(firstSection._vertProperties[index * 3 + 1]),
            Number(firstSection._vertProperties[index * 3 + 2]),
        ]);
    }
    for (const auxEdge of firstSection._auxEdges || []) {
        for (const point of auxEdge?.points || []) {
            const matched = triPoints.some((triPoint) =>
                Math.abs(Number(point[0]) - triPoint[0]) <= 1e-12
                && Math.abs(Number(point[1]) - triPoint[1]) <= 1e-12
                && Math.abs(Number(point[2]) - triPoint[2]) <= 1e-12);
            assert(matched, "Expected every cross-section edge endpoint to use the exact stored triangle vertex.");
        }
    }
    firstSection.visualize({ showEdges: true, authoringOnly: true });
    const faceChildren = (firstSection.children || []).filter((child) => child?.type === "FACE");
    const edgeChildren = (firstSection.children || []).filter((child) => child?.type === "EDGE");
    const vertexChildren = (firstSection.children || []).filter((child) => child?.type === "VERTEX");
    assert(faceChildren.length === 1, `Expected the first cross-section to visualize one face, received ${faceChildren.length}.`);
    assert(edgeChildren.length === 3, `Expected the first cross-section to visualize three edges, received ${edgeChildren.length}.`);
    assert(vertexChildren.length === 3, `Expected the first cross-section to visualize three vertices, received ${vertexChildren.length}.`);
    const sectionFace = faceChildren[0];
    assert(sectionFace, "Expected the first cross-section visualization to expose its section face.");
    const sectionFaceName = String(sectionFace.name || "");
    const faceMetadata = typeof firstSection.getFaceMetadata === "function"
        ? (firstSection.getFaceMetadata(sectionFaceName) || {})
        : {};
    assert(faceMetadata?.debugSketchFace === true, "Expected the cross-section face to carry sketch-face metadata.");
    assert(
        edgeChildren.every((edgeChild) => edgeChild?.faces?.length === 1 && String(edgeChild.faces[0]?.name || "") === sectionFaceName),
        "Expected each chamfer cross-section edge to be attached to the single section face.",
    );
    const edgeNames = edgeChildren.map((edgeChild) => String(edgeChild?.name || ""));
    assert(edgeNames.some((name) => /_EDGE_A_B$/.test(name)), "Expected the cross-section to include edge A-B.");
    assert(edgeNames.some((name) => /_EDGE_B_C$/.test(name)), "Expected the cross-section to include edge B-C.");
    assert(edgeNames.some((name) => /_EDGE_C_A$/.test(name)), "Expected the cross-section to include edge C-A.");
    assert(edgeChildren.every((edgeChild) => edgeChild?.userData?.auxEdge !== true), "Expected cross-section edges to behave like normal boundary edges, not aux helpers.");
    assert(edgeChildren.every((edgeChild) => edgeChild?.material?.dashed === false), "Expected cross-section edges to render as full triangle sides, not dashed helper segments.");
    const boundaryLoops = Array.isArray(sectionFace?.userData?.boundaryLoopsWorld) ? sectionFace.userData.boundaryLoopsWorld : [];
    assert(boundaryLoops.length === 1, `Expected one boundary loop on the cross-section face, received ${boundaryLoops.length}.`);
    assert(Array.isArray(boundaryLoops[0]?.pts) && boundaryLoops[0].pts.length === 3, "Expected the cross-section boundary loop to contain exactly the triangle vertices.");

    try {
        firstSection.updateMatrixWorld(true);
        sectionFace.updateMatrixWorld(true);
    } catch { /* ignore matrix updates in tests */ }
    const extrudeFeature = new ExtrudeFeature();
    extrudeFeature.inputParams = {
        featureID: "CPP_CHAMFER_SECTION_EXTRUDE",
        profile: sectionFace,
        distance: 0.5,
        distanceBack: 0,
        boolean: { targets: [], operation: "NONE" },
    };
    const extrudeResult = await extrudeFeature.run(partHistory);
    const extrudedSolid = Array.isArray(extrudeResult?.added) ? extrudeResult.added[0] : null;
    assert(
        extrudedSolid && typeof extrudedSolid.getTriangleCount === "function" && extrudedSolid.getTriangleCount() > 0,
        "Expected a chamfer cross-section face to extrude directly like a sketch face.",
    );
}

export async function test_cppChamfer_debug_sections_materialize_as_sketch_profiles(partHistory = new PartHistory()) {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildChamferWorkflowAuthoringState !== "function") {
        return;
    }

    const { solid } = await buildFoldbackFixture(partHistory);
    const edge = resolveFixtureEdgesByName(solid, [CHAMFER_END_CAP_PLANE_FIXTURE_EDGE_NAME])[0];
    assert(edge, "Expected sketch-profile debug fixture to expose the target chamfer edge.");

    const chamferFeature = new ChamferFeature();
    chamferFeature.inputParams = {
        featureID: "CPP_CHAMFER_DEBUG_PROFILE",
        edges: [edge],
        distance: 0.5,
        inflate: 0.101,
        direction: "AUTO",
        debug: true,
    };
    const runResult = await chamferFeature.run(partHistory);
    const added = Array.isArray(runResult?.added) ? runResult.added : [];
    const sketchSection = added.find((entry) => entry?.type === "SKETCH" && /_SECTION_\d+$/.test(String(entry?.name || "")));
    assert(sketchSection, "Expected chamfer debug cross sections to be added to the scene as sketch-style groups.");

    const profileFace = (sketchSection.children || []).find((child) => child?.type === "FACE" && /:PROFILE$/.test(String(child?.name || "")));
    assert(profileFace, "Expected the sketch-style chamfer section to expose a :PROFILE face child.");
    assert(
        Array.isArray(profileFace?.edges) && profileFace.edges.length === 3,
        `Expected the chamfer debug sketch profile to expose three boundary edges, received ${profileFace?.edges?.length || 0}.`,
    );
    assert(
        profileFace.edges.every((edgeChild) => edgeChild?.userData?.auxEdge !== true),
        "Expected chamfer debug sketch profile edges to behave like normal sketch boundaries.",
    );
    const sketchBasis = sketchSection?.userData?.sketchBasis;
    assert(
        Array.isArray(sketchBasis?.origin) && Array.isArray(sketchBasis?.x) && Array.isArray(sketchBasis?.y),
        "Expected chamfer debug sketch sections to expose a sketch basis.",
    );
}

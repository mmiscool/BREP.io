import { Tube, tubeHasNativeBuilder } from "../BREP/Tube.js";
import { Solid } from "../BREP/BetterSolid.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";
import { __testOnlyTubeFeatureInternals } from "../features/tube/TubeFeature.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

function faceTriangleCount(solid, faceName) {
    const faceID = solid?._faceNameToID instanceof Map ? solid._faceNameToID.get(faceName) : undefined;
    if (!Number.isFinite(faceID)) return 0;
    let count = 0;
    for (const id of solid?._triIDs || []) {
        if (id === faceID) count += 1;
    }
    return count;
}

export async function test_cppTube_open_tube_preserves_expected_face_labels() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tube = new Tube({
        points: [[0, 0, 0], [0, 20, 0], [10, 20, 0]],
        radius: 2,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_OPEN",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_OPEN_Outer"), "Expected open native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapStart"), "Expected open native tube to expose CapStart face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapEnd"), "Expected open native tube to expose CapEnd face.");
    assert(!faceNames.has("CPP_TUBE_OPEN_Inner"), "Did not expect Inner face for solid native tube.");
    assert(tube.getTriangleCount() > 0, "Expected open native tube to contain triangles.");
}

export async function test_cppTube_closed_hollow_tube_preserves_expected_face_labels() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tube = new Tube({
        points: [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 0]],
        radius: 3,
        innerRadius: 1,
        resolution: 24,
        closed: true,
        name: "CPP_TUBE_CLOSED",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_CLOSED_Outer"), "Expected closed native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_CLOSED_Inner"), "Expected closed hollow native tube to expose Inner face.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapStart"), "Did not expect CapStart face for closed native tube.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapEnd"), "Did not expect CapEnd face for closed native tube.");
    assert(Array.isArray(tube._auxEdges) && tube._auxEdges.length === 1, "Expected native tube to keep the centerline aux edge.");
    assert(tube._auxEdges[0]?.closedLoop === true, "Expected closed native tube centerline aux edge to be marked closed.");
    assert(tube.getTriangleCount() > 0, "Expected closed native tube to contain triangles.");
}

export async function test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tubeA = new Tube({
        points: [[0, 0, 0], [0, 12, 0]],
        radius: 1.5,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_UNION_A",
    });
    const tubeB = new Tube({
        points: [[20, 0, 0], [20, 12, 0]],
        radius: 1.5,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_UNION_B",
    });

    const unioned = tubeA.union(tubeB);
    const faceNames = new Set(unioned.getFaceNames());
    assert(faceNames.has("CPP_TUBE_UNION_A_Outer"), "Expected unioned native tubes to preserve tube A Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_A_CapStart"), "Expected unioned native tubes to preserve tube A CapStart face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_Outer"), "Expected unioned native tubes to preserve tube B Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_CapEnd"), "Expected unioned native tubes to preserve tube B CapEnd face.");
}

export async function test_cppTube_slow_fallback_union_preserves_external_cap_label() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const slowTubeName = "CPP_TUBE_SLOW_CAP_A";
    const slowTube = new Tube({
        points: [
            [0, 0, 10],
            [0, 0, -10],
            [10, 0, -10],
            [10, 10, -10],
            [0, 10, -10],
            [0, 0, -10],
        ],
        radius: 1,
        resolution: 16,
        closed: false,
        name: slowTubeName,
        preferFast: true,
    });
    const straightTubeName = "CPP_TUBE_SLOW_CAP_B";
    const straightTube = new Tube({
        points: [
            [10, 0, 10],
            [10, 0, -10],
        ],
        radius: 1,
        resolution: 16,
        closed: false,
        name: straightTubeName,
        preferFast: true,
    });

    assert(slowTube._tubeBuildMode === "slow", `Expected self-touching tube to use slow fallback, got ${slowTube._tubeBuildMode}.`);
    assert(faceTriangleCount(slowTube, `${slowTubeName}_Outer`) > 0, "Expected slow fallback tube to preserve its Outer label.");
    assert(faceTriangleCount(slowTube, `${slowTubeName}_CapStart`) > 0, "Expected slow fallback tube to preserve its external CapStart label.");

    const unioned = Solid.unionMany([slowTube, straightTube], { name: "CPP_TUBE_SLOW_CAP_UNION" });
    assert(faceTriangleCount(unioned, `${slowTubeName}_CapStart`) > 0, "Expected union to keep the slow fallback tube external cap as its own face.");
    assert(faceTriangleCount(unioned, `${straightTubeName}_CapStart`) > 0, "Expected union to keep the adjacent straight tube external cap as its own face.");
    assert(faceTriangleCount(unioned, `${slowTubeName}_Outer`) > 0, "Expected union to keep the slow fallback tube outer wall label.");
}

export async function test_cppTube_native_builder_reports_selected_build_mode() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const points = [[0, 0, 0], [0, 20, 0]];
    const tube = new Tube({
        points,
        radius: 2,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_MODE",
        preferFast: true,
    });

    assert(tube._tubeBuildMode === "fast", `Expected default tube generate() path to use native build-mode annotation, got ${tube._tubeBuildMode}.`);

    const fastSnapshot = tube.buildNativeSnapshot({ preferFast: true, allowSlowFallback: false });
    assert(fastSnapshot?.buildMode === "fast", `Expected explicit fast native tube build, got ${fastSnapshot?.buildMode}.`);
    assert(fastSnapshot?.requestedFast === true, "Expected explicit fast native tube build to record requestedFast=true.");
    assert(fastSnapshot?.fallbackFromFast === false, "Did not expect explicit fast native tube build to mark fallbackFromFast.");

    const slowSnapshot = tube.buildNativeSnapshot({ preferFast: false });
    assert(slowSnapshot?.buildMode === "slow", `Expected explicit slow native tube build, got ${slowSnapshot?.buildMode}.`);
    assert(slowSnapshot?.requestedFast === false, "Expected explicit slow native tube build to record requestedFast=false.");
    assert(slowSnapshot?.fallbackFromFast === false, "Did not expect explicit slow native tube build to mark fallbackFromFast.");
}

export async function test_cppTube_native_auto_falls_back_to_slow_on_foldback_path() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const points = [[0, 0, 0], [10, 0, 0], [10, 2, 0], [0, 2, 0]];
    const autoTube = new Tube({
        points,
        radius: 1.5,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_FOLDBACK",
        preferFast: true,
    });

    assert(autoTube._tubeBuildMode === "slow", `Expected native auto tube build to fall back to slow for foldback path, got ${autoTube._tubeBuildMode}.`);

    const autoSnapshot = autoTube.buildNativeSnapshot({ preferFast: true, allowSlowFallback: true });
    assert(autoSnapshot?.buildMode === "slow", `Expected native auto tube snapshot to fall back to slow, got ${autoSnapshot?.buildMode}.`);
    assert(autoSnapshot?.fallbackFromFast === true, "Expected native auto tube snapshot to record fallbackFromFast=true.");
    assert(autoSnapshot?.fallbackReason === "path_foldback_proximity", `Expected path_foldback_proximity fallback, got ${autoSnapshot?.fallbackReason}.`);

    const forcedFastSnapshot = autoTube.buildNativeSnapshot({ preferFast: true, allowSlowFallback: false });
    assert(forcedFastSnapshot?.buildMode === "fast", `Expected explicit force-fast tube build, got ${forcedFastSnapshot?.buildMode}.`);
    assert(forcedFastSnapshot?.selfUnionStats?.pathFoldbackLikely === true, "Expected force-fast tube build to expose the same pathFoldbackLikely signal.");
}

export async function test_cppTube_feature_inner_cutter_nudges_open_end_caps() {
    if (manifoldBuildSource !== "local" || !tubeHasNativeBuilder()) {
        return;
    }

    const tube = new Tube({
        points: [[0, 0, 0], [0, 10, 0]],
        radius: 1,
        resolution: 24,
        closed: false,
        name: "CPP_TUBE_INNER_NUDGE",
    });
    const amount = 0.2;
    assert(__testOnlyTubeFeatureInternals.tubeEndCapNudgeDistance() === 0.001, "Expected tube feature inner cutter cap nudge distance to be 0.001.");
    __testOnlyTubeFeatureInternals.nudgeTubeEndCaps(tube, "CPP_TUBE_INNER_NUDGE", amount, {
        pathPoints: [[0, 0, 0], [0, 10, 0]],
    });

    const yValues = [];
    for (let i = 1; i < tube._vertProperties.length; i += 3) {
        yValues.push(tube._vertProperties[i]);
    }
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    assert(minY < -amount * 0.9, `Expected nudged start cap to move before y=0, got minY=${minY}.`);
    assert(maxY > 10 + amount * 0.9, `Expected nudged end cap to move after y=10, got maxY=${maxY}.`);
}

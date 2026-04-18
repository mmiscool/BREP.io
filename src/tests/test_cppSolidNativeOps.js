import { Solid } from "../BREP/BetterSolid.js";
import { __testOnlyMergeCoplanarAdjacentFilletEndCaps } from "../BREP/SolidMethods/fillet.js";
import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
    cppSolidCoreHasNativeManifoldPrep,
    cppSolidCoreHasNativeInternalTriangleCleanup,
    cppSolidCoreHasNativeOffsetFace,
    cppSolidCoreHasNativePushFace,
    cppSolidCoreHasNativeSmallIslandCleanup,
    cppSolidCoreHasNativeTinyFaceIslandCleanup,
    cppSolidCoreHasNativeTinyFaceMerge,
    cppSolidCoreHasNativeWeldVerticesByEpsilon,
} from "../BREP/CppSolidCore.js";
import { Cube } from "../BREP/primitives.js";
import { manifold, manifoldBuildSource } from "../BREP/setupManifold.js";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

export async function test_cppSolidNative_setEpsilon_welds_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeWeldVerticesByEpsilon) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_A", [0, 0, 0], [1, 0, 0], [0, 1, 0])
        .addTriangle("FACE_B", [0, 0, 0], [0, 0, 1], [1, 0, 0])
        .addTriangle("FACE_C", [1, 0, 0], [0, 0, 1.0000001], [0, 1, 0])
        .addTriangle("FACE_D", [0, 0, 0], [0, 1, 0], [0, 0, 1.0000001]);

    const beforeVertices = solid._vertProperties.length / 3;
    if (beforeVertices !== 5) {
        throw new Error(`Expected 5 authored vertices before weld, received ${beforeVertices}.`);
    }

    solid.setEpsilon(1e-5);

    const afterVertices = solid._vertProperties.length / 3;
    if (afterVertices !== 4) {
        throw new Error(`Expected 4 authored vertices after weld, received ${afterVertices}.`);
    }
    if (solid._triVerts.length / 3 !== 4) {
        throw new Error(`Expected 4 triangles after weld, received ${solid._triVerts.length / 3}.`);
    }
}

export async function test_cppSolidNative_cleanupTinyFaceIslands_reassigns_small_face_and_prunes_metadata() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeTinyFaceIslandCleanup) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("BIG", [0.4, 0, 0], [2, 0, 0], [2, 1, 0])
        .addTriangle("BIG", [0.4, 0, 0], [2, 1, 0], [0, 1, 0])
        .addTriangle("TINY", [0, 0, 0], [0.4, 0, 0], [0, 1, 0]);

    solid._faceMetadata.set("BIG", { group: "main" });
    solid._faceMetadata.set("TINY", { group: "tiny" });

    const reassigned = solid.cleanupTinyFaceIslands(0.25);
    if (reassigned !== 1) {
        throw new Error(`Expected native tiny-face cleanup to reassign 1 triangle, received ${reassigned}.`);
    }

    const faceNames = Array.from(solid._faceNameToID.keys()).sort();
    if (faceNames.join("|") !== "BIG") {
        throw new Error(`Expected TINY face to be pruned after native cleanup, received ${faceNames.join(", ")}.`);
    }

    if (solid._triIDs.length !== 3) {
        throw new Error(`Expected 3 authored triangles after native cleanup, received ${solid._triIDs.length}.`);
    }

    const bigId = solid._faceNameToID.get("BIG");
    if (!Number.isFinite(bigId)) {
        throw new Error("Expected BIG face ID to survive native cleanup.");
    }
    for (const triId of solid._triIDs) {
        if (triId !== bigId) {
            throw new Error(`Expected all triangles to be reassigned to BIG, received triangle face ID ${triId}.`);
        }
    }

    if (solid._faceMetadata.get("BIG")?.group !== "main") {
        throw new Error("Expected BIG face metadata to survive native tiny-face cleanup.");
    }
    if (solid._faceMetadata.has("TINY")) {
        throw new Error("Expected pruned TINY face metadata to be removed after native cleanup.");
    }
}

export async function test_cppSolidNative_removeSmallIslands_drops_external_shell_and_prunes_metadata() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeSmallIslandCleanup) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("BIG_A", [0, 0, 0], [1, 0, 0], [0, 1, 0])
        .addTriangle("BIG_B", [0, 0, 0], [0, 0, 1], [1, 0, 0])
        .addTriangle("BIG_C", [1, 0, 0], [0, 0, 1], [0, 1, 0])
        .addTriangle("BIG_D", [0, 0, 0], [0, 1, 0], [0, 0, 1])
        .addTriangle("SMALL_A", [5, 5, 5], [5.1, 5, 5], [5, 5.1, 5])
        .addTriangle("SMALL_B", [5, 5, 5], [5, 5, 5.1], [5.1, 5, 5])
        .addTriangle("SMALL_C", [5.1, 5, 5], [5, 5, 5.1], [5, 5.1, 5])
        .addTriangle("SMALL_D", [5, 5, 5], [5, 5.1, 5], [5, 5, 5.1]);

    solid._faceMetadata.set("BIG_A", { group: "big" });
    solid._faceMetadata.set("SMALL_A", { group: "small" });

    const removed = solid.removeSmallIslands({
        maxTriangles: 4,
        removeInternal: false,
        removeExternal: true,
    });
    if (removed !== 4) {
        throw new Error(`Expected native small-island cleanup to remove 4 triangles, received ${removed}.`);
    }

    const faceNames = Array.from(solid._faceNameToID.keys()).sort();
    if (faceNames.join("|") !== "BIG_A|BIG_B|BIG_C|BIG_D") {
        throw new Error(`Unexpected surviving face names after native small-island cleanup: ${faceNames.join(", ")}.`);
    }
    if (solid._faceMetadata.get("BIG_A")?.group !== "big") {
        throw new Error("Expected big-shell metadata to survive native small-island cleanup.");
    }
    if (solid._faceMetadata.has("SMALL_A")) {
        throw new Error("Expected removed small-shell metadata to be pruned after native small-island cleanup.");
    }
}

export async function test_cppSolidNative_mergeTinyFaces_merges_small_adjacent_face() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeTinyFaceMerge) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("BIG", [0.4, 0, 0], [2, 0, 0], [2, 1, 0])
        .addTriangle("BIG", [0.4, 0, 0], [2, 1, 0], [0, 1, 0])
        .addTriangle("TINY", [0, 0, 0], [0.4, 0, 0], [0, 1, 0]);

    solid._faceMetadata.set("BIG", { group: "main" });
    solid._faceMetadata.set("TINY", { group: "tiny" });

    const returned = solid.mergeTinyFaces(0.25);
    if (returned !== solid) {
        throw new Error("Expected mergeTinyFaces to remain chainable when routed through the native core.");
    }

    const faceNames = Array.from(solid._faceNameToID.keys()).sort();
    if (faceNames.join("|") !== "BIG") {
        throw new Error(`Expected TINY face to merge into BIG, received ${faceNames.join(", ")}.`);
    }
    if (solid._faceMetadata.get("BIG")?.group !== "main") {
        throw new Error("Expected BIG face metadata to survive native tiny-face merge.");
    }
    if (solid._faceMetadata.has("TINY")) {
        throw new Error("Expected merged TINY face metadata to be pruned after native mergeTinyFaces.");
    }
}

export async function test_cppSolidNative_removeInternalTriangles_preserves_clean_manifold_shell() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeInternalTriangleCleanup) {
        return;
    }

    const solid = new Cube(2, 2, 2);
    solid._faceMetadata.set("Cube_PZ", { kind: "top" });

    const removed = solid.removeInternalTriangles();
    if (removed !== 0) {
        throw new Error(`Expected native internal-triangle cleanup to leave a clean cube untouched, received removal count ${removed}.`);
    }

    const faceNames = Array.from(solid._faceNameToID.keys()).sort();
    if (faceNames.join("|") !== "Cube_NX|Cube_NY|Cube_NZ|Cube_PX|Cube_PY|Cube_PZ") {
        throw new Error(`Unexpected face names after native internal-triangle cleanup on a clean cube: ${faceNames.join(", ")}.`);
    }
    if (solid._faceMetadata.get("Cube_PZ")?.kind !== "top") {
        throw new Error("Expected cube face metadata to survive native internal-triangle cleanup on a clean shell.");
    }
    if (solid._triVerts.length / 3 !== 12) {
        throw new Error(`Expected clean cube triangle count to remain 12, received ${solid._triVerts.length / 3}.`);
    }
}

export async function test_cppSolidNative_pushFace_updates_planar_face_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativePushFace) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);

    solid.pushFace("FACE_TOP", 0.25, { warnMissing: false, warnInvalidNormal: false });

    for (let i = 2; i < solid._vertProperties.length; i += 3) {
        if (!approx(solid._vertProperties[i], 0.25)) {
            throw new Error(`Expected FACE_TOP z=0.25 after native pushFace, received ${solid._vertProperties[i]} at index ${i}.`);
        }
    }
    if (solid._faceNameToID.get("FACE_TOP") !== solid._triIDs[0]) {
        throw new Error("Expected face ID mapping to remain stable after native pushFace.");
    }
}

export async function test_cppSolidNative_offsetFace_updates_planar_face_vertices() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeOffsetFace) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);

    solid.offsetFace("FACE_TOP", 0.25);

    for (let i = 2; i < solid._vertProperties.length; i += 3) {
        if (!approx(solid._vertProperties[i], 0.25)) {
            throw new Error(`Expected FACE_TOP z=0.25 after native offsetFace, received ${solid._vertProperties[i]} at index ${i}.`);
        }
    }
    if (solid._faceNameToID.get("FACE_TOP") !== solid._triIDs[0]) {
        throw new Error("Expected face ID mapping to remain stable after native offsetFace.");
    }
}

export async function test_cppSolidNative_invertNormals_and_manifoldize_rebuilds_coherent_mesh() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeManifoldPrep) {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("F0", [0, 0, 0], [1, 0, 0], [0, 1, 0])
        .addTriangle("F1", [0, 0, 0], [1, 0, 0], [0, 0, 1])
        .addTriangle("F2", [1, 0, 0], [0, 1, 0], [0, 0, 1])
        .addTriangle("F3", [0, 1, 0], [0, 0, 0], [0, 0, 1]);

    if (solid._isCoherentlyOrientedManifold()) {
        throw new Error("Expected test fixture to begin with inconsistent winding.");
    }

    solid._manifoldize();

    if (!solid._isCoherentlyOrientedManifold()) {
        throw new Error("Expected native _manifoldize() to repair triangle winding coherence.");
    }
    if (!solid._manifold) {
        throw new Error("Expected native _manifoldize() to cache a manifold instance.");
    }
}

export async function test_cppSolidNative_classifyFilletEdgeDirection_cubeConvexEdge_isInset() {
    if (manifoldBuildSource !== "local" || typeof manifold?.classifyFilletEdgeDirection !== "function") {
        return;
    }

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_DIR_CUBE" });
    const result = manifold.classifyFilletEdgeDirection({
        snapshot: buildSolidAuthoringStateSnapshot(cube),
        faceAName: "CPP_DIR_CUBE_NX",
        faceBName: "CPP_DIR_CUBE_NY",
        radius: 0.5,
        fallbackDirection: "OUTSET",
        threshold: 0.2,
    });

    if (result?.direction !== "INSET") {
        throw new Error(`Expected convex cube edge to classify as INSET, received ${result?.direction}.`);
    }
    const reason = String(result?.reason || "");
    if (reason !== "signed_dihedral" && reason !== "classified") {
        throw new Error(`Expected native classifier to produce a geometric reason, received ${reason || "(empty)"}.`);
    }
}

export async function test_cppSolidNative_buildFilletEdgeAuthoringState_returns_standard_edge_snapshots() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletEdgeAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_FILLET_EDGE_CUBE" });
    const boundaries = cube.getBoundaryEdgePolylines() || [];
    const boundary = boundaries.find((candidate) => {
        const a = String(candidate?.faceA || "");
        const b = String(candidate?.faceB || "");
        return (a === "CPP_FILLET_EDGE_CUBE_NX" && b === "CPP_FILLET_EDGE_CUBE_NY")
            || (a === "CPP_FILLET_EDGE_CUBE_NY" && b === "CPP_FILLET_EDGE_CUBE_NX");
    });
    if (!boundary || !Array.isArray(boundary.positions) || boundary.positions.length < 2) {
        throw new Error("Expected cube to expose a boundary polyline for the native fillet edge test.");
    }

    const result = manifold.buildFilletEdgeAuthoringState({
        snapshot: buildSolidAuthoringStateSnapshot(cube),
        faceAName: boundary.faceA,
        faceBName: boundary.faceB,
        polyline: boundary.positions,
        radius: 0.25,
        requestedRadius: 0.25,
        sideMode: "INSET",
        inflate: 0.1,
        nudgeFaceDistance: 0.0001,
        resolution: 24,
        closedLoop: false,
        name: "CPP_FILLET_EDGE",
        edgeReference: boundary.name,
    });

    if (!Array.isArray(result?.centerline) || result.centerline.length < 2) {
        throw new Error("Expected native fillet edge builder to return a centerline.");
    }
    if (!result?.wedgeSnapshot || !result?.tubeSnapshot || !result?.finalSnapshot) {
        throw new Error("Expected native fillet edge builder to return wedge/tube/final snapshots.");
    }
    if (!(Number(result?.wedgeSnapshot?.triangleCount) > 0)) {
        throw new Error("Expected native fillet edge builder to return a non-empty wedge snapshot.");
    }
    if (!(Number(result?.tubeSnapshot?.triangleCount) > 0)) {
        throw new Error("Expected native fillet edge builder to return a non-empty tube snapshot.");
    }

    const capStart = Array.isArray(result?.tubeCapPointsBeforeNudge?.start)
        ? result.tubeCapPointsBeforeNudge.start
        : [];
    const capEnd = Array.isArray(result?.tubeCapPointsBeforeNudge?.end)
        ? result.tubeCapPointsBeforeNudge.end
        : [];
    if (capStart.length === 0 || capEnd.length === 0) {
        throw new Error("Expected native fillet edge builder to return pre-nudge tube cap points.");
    }

    if (!Array.isArray(result?.finalSnapshot?.triVerts)) {
        throw new Error("Expected native fillet edge builder to return a final snapshot payload.");
    }
}

export async function test_cppSolidNative_filletEdge_finalSnapshot_preserves_face_names_and_metadata() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletEdgeAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_FILLET_EDGE_COMPARE" });
    const boundaries = cube.getBoundaryEdgePolylines() || [];
    const boundary = boundaries.find((candidate) => {
        const a = String(candidate?.faceA || "");
        const b = String(candidate?.faceB || "");
        return (a === "CPP_FILLET_EDGE_COMPARE_NX" && b === "CPP_FILLET_EDGE_COMPARE_NY")
            || (a === "CPP_FILLET_EDGE_COMPARE_NY" && b === "CPP_FILLET_EDGE_COMPARE_NX");
    });
    if (!boundary || !Array.isArray(boundary.positions) || boundary.positions.length < 2) {
        throw new Error("Expected cube boundary polyline for native final snapshot comparison.");
    }

    const result = manifold.buildFilletEdgeAuthoringState({
        snapshot: buildSolidAuthoringStateSnapshot(cube),
        faceAName: boundary.faceA,
        faceBName: boundary.faceB,
        polyline: boundary.positions,
        radius: 0.25,
        requestedRadius: 0.25,
        sideMode: "INSET",
        inflate: 0.1,
        nudgeFaceDistance: 0.0001,
        resolution: 24,
        closedLoop: false,
        name: "CPP_FILLET_EDGE_COMPARE",
        edgeReference: boundary.name,
    });

    const wedgeSolid = new Solid();
    const tubeSolid = new Solid();
    const nativeFinalSolid = new Solid();
    applySolidAuthoringStateSnapshot(wedgeSolid, result?.wedgeSnapshot, { remapFaceIDs: true });
    applySolidAuthoringStateSnapshot(tubeSolid, result?.tubeSnapshot, { remapFaceIDs: true });
    applySolidAuthoringStateSnapshot(nativeFinalSolid, result?.finalSnapshot, { remapFaceIDs: true });

    const legacyFinalSolid = wedgeSolid.subtract(tubeSolid);
    const nativeFaceNames = Array.from(nativeFinalSolid.getFaceNames?.() || []).sort();
    const legacyFaceNames = Array.from(legacyFinalSolid.getFaceNames?.() || []).sort();

    if (nativeFaceNames.join("|") !== legacyFaceNames.join("|")) {
        throw new Error(`Expected native finalSnapshot face names to match legacy wedge.subtract(tube). Native=${nativeFaceNames.join(", ")} Legacy=${legacyFaceNames.join(", ")}`);
    }

    const fallback = nativeFaceNames.filter((name) => /^FACE(?:_\\d+)?$/.test(String(name || "")));
    if (fallback.length > 0) {
        throw new Error(`Expected native finalSnapshot to avoid fallback face names, found ${fallback.join(", ")}.`);
    }

    const nativeMetadata = nativeFinalSolid._faceMetadata instanceof Map ? nativeFinalSolid._faceMetadata : new Map();
    const requiredMetadataFaces = [
        "CPP_FILLET_EDGE_COMPARE_TUBE_Outer",
        "CPP_FILLET_EDGE_COMPARE_END_CAP_1",
        "CPP_FILLET_EDGE_COMPARE_END_CAP_2",
    ];
    for (const faceName of nativeFaceNames) {
        if (!legacyFinalSolid._faceNameToID?.has(faceName)) {
            throw new Error(`Expected native finalSnapshot face ${faceName} to exist in the legacy boolean result.`);
        }
    }
    for (const faceName of requiredMetadataFaces) {
        if (!nativeMetadata.has(faceName)) {
            throw new Error(`Expected native finalSnapshot to preserve metadata for ${faceName}.`);
        }
    }
}

export async function test_cppSolidNative_postBoolean_fillet_merges_coplanar_cube_end_caps() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_POST_BOOL_FILLET" });
    const boundary = (cube.getBoundaryEdgePolylines() || []).find((candidate) => {
        const faceA = String(candidate?.faceA || "");
        const faceB = String(candidate?.faceB || "");
        return (faceA === "CPP_POST_BOOL_FILLET_NX" && faceB === "CPP_POST_BOOL_FILLET_NY")
            || (faceA === "CPP_POST_BOOL_FILLET_NY" && faceB === "CPP_POST_BOOL_FILLET_NX");
    });
    if (!boundary || !Array.isArray(boundary.positions) || boundary.positions.length < 2) {
        throw new Error("Expected cube boundary polyline between CPP_POST_BOOL_FILLET_NX and CPP_POST_BOOL_FILLET_NY.");
    }
    const edge = {
        name: String(boundary.name || "CPP_POST_BOOL_FILLET_NX|CPP_POST_BOOL_FILLET_NY[0]"),
        parentSolid: cube,
        faces: [{ name: boundary.faceA }, { name: boundary.faceB }],
        userData: {
            faceA: boundary.faceA,
            faceB: boundary.faceB,
            polylineLocal: boundary.positions.map((point) => Array.from(point || [])),
            closedLoop: !!boundary.closedLoop,
        },
        closedLoop: !!boundary.closedLoop,
    };

    const result = await cube.fillet({
        radius: 0.25,
        edges: [edge],
        direction: "INSET",
        resolution: 24,
        featureID: "CPP_POST_BOOL_FILLET",
    });
    if (!result || typeof result.getFaceNames !== "function" || typeof result.getFaceMetadata !== "function") {
        throw new Error("Expected Solid.fillet() to return a readable solid.");
    }

    const faceNames = Array.from(result.getFaceNames() || []);
    for (const required of ["CPP_POST_BOOL_FILLET_NZ", "CPP_POST_BOOL_FILLET_PZ"]) {
        if (!faceNames.includes(required)) {
            throw new Error(`Expected post-boolean fillet result to preserve face ${required}.`);
        }
    }

    const survivingEndCapNames = faceNames.filter((faceName) => /(?:_END_CAP_[12]|_TUBE_CapStart|_TUBE_CapEnd)$/.test(String(faceName || "")));
    if (survivingEndCapNames.length !== 0) {
        throw new Error(`Expected single-edge cube fillet to merge its coplanar end caps, found ${survivingEndCapNames.join(", ")}.`);
    }

    const survivingEndCapMetadata = faceNames.filter((faceName) => {
        const metadata = result.getFaceMetadata(faceName) || {};
        return metadata?.filletEndCap === true;
    });
    if (survivingEndCapMetadata.length !== 0) {
        throw new Error(`Expected single-edge cube fillet to clear filletEndCap metadata after merging, found ${survivingEndCapMetadata.join(", ")}.`);
    }

    if (Number(result.__filletEndCapMergeCount || 0) !== 2) {
        throw new Error(`Expected two end-cap merges for a single-edge cube fillet, received ${result.__filletEndCapMergeCount}.`);
    }
}

function buildSyntheticCoplanarEndCapSolid() {
    const solid = new Solid();
    const A0 = [0, 0, 0];
    const B0 = [1, 0, 0];
    const C0 = [1, 1, 0];
    const D0 = [0, 1, 0];
    const A = [0, 0, 1];
    const E = [0.2, 0, 1];
    const F = [0, 0.2, 1];
    const B = [1, 0, 1];
    const C = [1, 1, 1];
    const D = [0, 1, 1];

    solid
        .addTriangle("BOTTOM", A0, C0, B0)
        .addTriangle("BOTTOM", A0, D0, C0)
        .addTriangle("FILLET_ENDCAP", A, E, F)
        .addTriangle("TOP_MAIN", E, B, C)
        .addTriangle("TOP_MAIN", E, C, F)
        .addTriangle("TOP_MAIN", F, C, D)
        .addTriangle("FRONT", A0, B0, B)
        .addTriangle("FRONT", A0, B, E)
        .addTriangle("FRONT", A0, E, A)
        .addTriangle("LEFT", A0, A, F)
        .addTriangle("LEFT", A0, F, D)
        .addTriangle("LEFT", A0, D, D0)
        .addTriangle("RIGHT", B0, C0, C)
        .addTriangle("RIGHT", B0, C, B)
        .addTriangle("BACK", D0, D, C)
        .addTriangle("BACK", D0, C, C0);

    solid.setFaceMetadata("TOP_MAIN", { marker: "top-main" });
    solid.setFaceMetadata("FILLET_ENDCAP", {
        filletSourceArea: 0.02,
        filletRoundFace: "F_TEST_TUBE_Outer",
        filletEndCap: true,
        sourceFeatureId: "F_TEST",
    });
    return solid;
}

export async function test_cppSolidNative_mergeCoplanarAdjacentFilletEndCaps_retags_triangles_to_planar_neighbor() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletAuthoringState !== "function") {
        return;
    }

    const solid = buildSyntheticCoplanarEndCapSolid();
    const summary = __testOnlyMergeCoplanarAdjacentFilletEndCaps(solid, { featureID: "F_TEST" });
    if (Number(summary?.mergedEndCaps || 0) !== 1) {
        throw new Error(`Expected one coplanar adjacent fillet end cap to merge, received ${summary?.mergedEndCaps}.`);
    }

    const faceNames = new Set(solid.getFaceNames?.() || []);
    if (faceNames.has("FILLET_ENDCAP")) {
        throw new Error("Expected FILLET_ENDCAP face to be retagged into TOP_MAIN.");
    }
    if (!faceNames.has("TOP_MAIN")) {
        throw new Error("Expected TOP_MAIN to survive the end-cap merge.");
    }

    const topTriangles = solid.getFace("TOP_MAIN") || [];
    if (topTriangles.length !== 4) {
        throw new Error(`Expected TOP_MAIN to own 4 triangles after merge, received ${topTriangles.length}.`);
    }

    const topMetadata = solid.getFaceMetadata("TOP_MAIN") || {};
    if (topMetadata.marker !== "top-main") {
        throw new Error("Expected merged target face to preserve its original metadata.");
    }
    if (topMetadata.filletEndCap === true) {
        throw new Error("Expected merged target face metadata to exclude filletEndCap.");
    }
}

export async function test_cppSolidNative_booleanCombinedAuthoringState_preserves_face_names_and_metadata() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildBooleanCombinedAuthoringState !== "function") {
        return;
    }

    const base = new Cube({ x: 10, y: 10, z: 10, name: "CPP_BOOL_BASE" });
    const tool = new Cube({ x: 6, y: 6, z: 6, name: "CPP_BOOL_TOOL" });
    base.setFaceMetadata("CPP_BOOL_BASE_NX", { sourceFeatureId: "BASE_FEATURE", marker: "base-nx" });
    tool.setFaceMetadata("CPP_BOOL_TOOL_PX", { sourceFeatureId: "TOOL_FEATURE", marker: "tool-px" });
    tool.setEdgeMetadata("CPP_BOOL_TOOL_NX|CPP_BOOL_TOOL_NY[0]", { smooth: false, marker: "tool-edge" });
    tool.bakeTRS({
        position: [7, 2, 2],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
    });

    const snapshot = manifold.buildBooleanCombinedAuthoringState({
        leftSnapshot: buildSolidAuthoringStateSnapshot(base),
        rightSnapshot: buildSolidAuthoringStateSnapshot(tool),
        operation: "UNION",
        featureID: "CPP_BOOL",
        name: "CPP_BOOL_RESULT",
        cleanupTinyFaceIslandsArea: 0.01,
        disconnectedIslandMinVolume: 0.01,
    });

    const result = new Solid();
    applySolidAuthoringStateSnapshot(result, snapshot);

    const faceNames = new Set(result.getFaceNames?.() || []);
    if (!faceNames.has("CPP_BOOL_BASE_NX")) {
        throw new Error("Expected native boolean builder to preserve target face name CPP_BOOL_BASE_NX.");
    }

    const baseFaceMeta = result.getFaceMetadata?.("CPP_BOOL_BASE_NX") || {};
    if (baseFaceMeta.sourceFeatureId !== "BASE_FEATURE" || baseFaceMeta.marker !== "base-nx") {
        throw new Error("Expected native boolean builder to preserve base face metadata.");
    }

    const toolEdgeMeta = result.getEdgeMetadata?.("CPP_BOOL_TOOL_NX|CPP_BOOL_TOOL_NY[0]") || {};
    if (toolEdgeMeta.marker !== "tool-edge" || toolEdgeMeta.smooth !== false) {
        throw new Error("Expected native boolean builder to preserve merged edge metadata.");
    }
}

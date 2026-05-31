import { Solid } from "../BREP/BetterSolid.js";
import {
    __testOnlyMergeCoplanarAdjacentFilletEndCaps,
    __testOnlyReversePostBooleanFilletEndCapNudge,
    __testOnlyCollapseFilletSideWallFaces,
    __testOnlyReassignTinyFilletSidewallSliverTriangles,
} from "../BREP/SolidMethods/fillet.js";
import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
    cppSolidCoreHasNativeManifoldPrep,
    cppSolidCoreHasNativeInternalTriangleCleanup,
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
    if (afterVertices !== 5) {
        throw new Error(`Expected authored vertex count to stay 5 after setEpsilon, received ${afterVertices}.`);
    }
    if (solid._triVerts.length / 3 !== 4) {
        throw new Error(`Expected 4 triangles after weld, received ${solid._triVerts.length / 3}.`);
    }
    const zA = solid._vertProperties[11];
    const zB = solid._vertProperties[14];
    if (!approx(zA, 1.00000005, 1e-6) || !approx(zB, 1.00000005, 1e-6)) {
        throw new Error(`Expected welded authored vertices to share z=1.00000005, received ${zA} and ${zB}.`);
    }
    if (!solid._manifold) {
        throw new Error("Expected setEpsilon to rebuild a manifold after aligning the authored vertices.");
    }
}

export async function test_cppSolidNative_setEpsilon_merges_cell_boundary_pair_and_rebuilds_manifold() {
    if (manifoldBuildSource !== "local" || !cppSolidCoreHasNativeWeldVerticesByEpsilon) {
        return;
    }

    const solid = new Solid();
    const A = [0, 0, 0];
    const B = [1, 0, 0];
    const C = [0, 1, 0];
    const D = [0, 0, 0.99995];
    const D2 = [0, 0, 1.00004];

    solid
        .addTriangle("F1", A, C, B)
        .addTriangle("F2", A, B, D)
        .addTriangle("F3", A, D2, C)
        .addTriangle("F4", B, C, D);

    solid.setEpsilon(1e-4);

    const afterVertices = solid._vertProperties.length / 3;
    if (afterVertices !== 5) {
        throw new Error(`Expected authored vertex count to stay 5 after cell-boundary weld, received ${afterVertices}.`);
    }
    if (solid._triVerts.length / 3 !== 4) {
        throw new Error(`Expected 4 triangles after cell-boundary weld, received ${solid._triVerts.length / 3}.`);
    }
    if (!approx(solid._vertProperties[11], 0.999995, 1e-6) || !approx(solid._vertProperties[14], 0.999995, 1e-6)) {
        throw new Error(`Expected cell-boundary vertices to share z=0.999995, received ${solid._vertProperties[11]} and ${solid._vertProperties[14]}.`);
    }
    if (!solid._manifold) {
        throw new Error("Expected setEpsilon to rebuild a manifold result after welding the closed tetra shell.");
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

export async function test_cppSolidNative_getFaceNormal_reports_planar_face_normal() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const solid = new Solid();
    solid
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 0, 0], [1, 1, 0])
        .addTriangle("FACE_TOP", [0, 0, 0], [1, 1, 0], [0, 1, 0]);

    const result = solid.getFaceNormal("FACE_TOP");
    if (!result?.faceFound || !result?.validNormal) {
        throw new Error(`Expected getFaceNormal to return a valid normal for FACE_TOP, received ${JSON.stringify(result)}.`);
    }
    if (!approx(result.normal?.[0] ?? NaN, 0) || !approx(result.normal?.[1] ?? NaN, 0) || !approx(result.normal?.[2] ?? NaN, 1)) {
        throw new Error(`Expected FACE_TOP normal [0, 0, 1], received ${JSON.stringify(result.normal)}.`);
    }
    if (!approx(Number(result.planarRatio ?? NaN), 1, 1e-6)) {
        throw new Error(`Expected planar FACE_TOP to report planarRatio 1, received ${result.planarRatio}.`);
    }
    if (Number(result.affectedVertexCount || 0) !== 4) {
        throw new Error(`Expected FACE_TOP to touch 4 vertices, received ${result.affectedVertexCount}.`);
    }
}

export async function test_cppSolidNative_manifoldize_repairs_incoherent_winding() {
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

export async function test_cppSolidNative_filletEdge_nudgeFaceDistance_moves_only_end_cap_vertices() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletEdgeAuthoringState !== "function") {
        return;
    }

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_FILLET_NUDGE_SCOPE" });
    const boundary = (cube.getBoundaryEdgePolylines() || []).find((candidate) => {
        const a = String(candidate?.faceA || "");
        const b = String(candidate?.faceB || "");
        return (a === "CPP_FILLET_NUDGE_SCOPE_NX" && b === "CPP_FILLET_NUDGE_SCOPE_NY")
            || (a === "CPP_FILLET_NUDGE_SCOPE_NY" && b === "CPP_FILLET_NUDGE_SCOPE_NX");
    });
    if (!boundary || !Array.isArray(boundary.positions) || boundary.positions.length < 2) {
        throw new Error("Expected cube boundary polyline for native wedge nudge scope test.");
    }

    const buildResult = (nudgeFaceDistance) => manifold.buildFilletEdgeAuthoringState({
        snapshot: buildSolidAuthoringStateSnapshot(cube),
        faceAName: boundary.faceA,
        faceBName: boundary.faceB,
        polyline: boundary.positions,
        radius: 0.25,
        requestedRadius: 0.25,
        sideMode: "INSET",
        inflate: 0.0,
        nudgeFaceDistance,
        resolution: 24,
        closedLoop: false,
        name: "CPP_FILLET_NUDGE_SCOPE",
        edgeReference: boundary.name,
    });

    const baseline = buildResult(0.0);
    const nudged = buildResult(0.1);
    const baselineSnapshot = baseline?.wedgeSnapshot;
    const nudgedSnapshot = nudged?.wedgeSnapshot;
    if (!baselineSnapshot || !nudgedSnapshot) {
        throw new Error("Expected native fillet edge builder to return wedge snapshots for nudge scope comparison.");
    }

    const baselineVerts = Array.isArray(baselineSnapshot.vertProperties) ? baselineSnapshot.vertProperties : [];
    const nudgedVerts = Array.isArray(nudgedSnapshot.vertProperties) ? nudgedSnapshot.vertProperties : [];
    const baselineTriVerts = Array.isArray(baselineSnapshot.triVerts) ? baselineSnapshot.triVerts : [];
    const baselineTriIDs = Array.isArray(baselineSnapshot.triIDs) ? baselineSnapshot.triIDs : [];
    const faceNameToID = new Map(baselineSnapshot.faceNameToID || []);
    if (baselineVerts.length !== nudgedVerts.length) {
        throw new Error("Expected wedge vertex buffers to keep the same size when only nudgeFaceDistance changes.");
    }

    const endCapFaceIDs = [
        faceNameToID.get("CPP_FILLET_NUDGE_SCOPE_END_CAP_1"),
        faceNameToID.get("CPP_FILLET_NUDGE_SCOPE_END_CAP_2"),
    ].filter((value) => Number.isFinite(value));
    if (endCapFaceIDs.length !== 2) {
        throw new Error(`Expected two wedge end-cap face IDs, received ${JSON.stringify(endCapFaceIDs)}.`);
    }

    const endCapVertexIndices = new Set();
    for (let triIndex = 0; triIndex < baselineTriIDs.length; triIndex += 1) {
        if (!endCapFaceIDs.includes(baselineTriIDs[triIndex])) continue;
        const base = triIndex * 3;
        endCapVertexIndices.add(baselineTriVerts[base + 0]);
        endCapVertexIndices.add(baselineTriVerts[base + 1]);
        endCapVertexIndices.add(baselineTriVerts[base + 2]);
    }

    let movedEndCapVertices = 0;
    let movedNonEndCapVertices = 0;
    for (let vertexIndex = 0; vertexIndex * 3 + 2 < baselineVerts.length; vertexIndex += 1) {
        const base = vertexIndex * 3;
        const dx = Math.abs(Number(nudgedVerts[base + 0] || 0) - Number(baselineVerts[base + 0] || 0));
        const dy = Math.abs(Number(nudgedVerts[base + 1] || 0) - Number(baselineVerts[base + 1] || 0));
        const dz = Math.abs(Number(nudgedVerts[base + 2] || 0) - Number(baselineVerts[base + 2] || 0));
        const moved = Math.max(dx, dy, dz) > 1e-8;
        if (!moved) continue;
        if (endCapVertexIndices.has(vertexIndex)) {
            movedEndCapVertices += 1;
        } else {
            movedNonEndCapVertices += 1;
        }
    }

    if (movedEndCapVertices <= 0) {
        throw new Error("Expected positive nudgeFaceDistance to move at least one wedge end-cap vertex.");
    }
    if (movedNonEndCapVertices !== 0) {
        throw new Error(`Expected nudgeFaceDistance to leave non-end-cap wedge vertices untouched, but ${movedNonEndCapVertices} moved.`);
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

    if (result.__filletEndCapMergeEnabled !== true) {
        throw new Error("Expected coplanar end-cap merge cleanup to be enabled for a single-edge cube fillet.");
    }
}

export async function test_cppSolidNative_postBoolean_fillet_reverse_end_cap_nudge_requires_merge() {
    if (manifoldBuildSource !== "local" || typeof manifold?.buildFilletAuthoringState !== "function") {
        return;
    }

    const buildEdge = (cube) => {
        const boundary = (cube.getBoundaryEdgePolylines() || []).find((candidate) => {
            const faceA = String(candidate?.faceA || "");
            const faceB = String(candidate?.faceB || "");
            return (faceA === `${cube.name}_NX` && faceB === `${cube.name}_NY`)
                || (faceA === `${cube.name}_NY` && faceB === `${cube.name}_NX`);
        });
        if (!boundary || !Array.isArray(boundary.positions) || boundary.positions.length < 2) {
            throw new Error(`Expected cube boundary polyline between ${cube.name}_NX and ${cube.name}_NY.`);
        }
        return {
            name: String(boundary.name || `${cube.name}_NX|${cube.name}_NY[0]`),
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
    };

    const cube = new Cube({ x: 2, y: 2, z: 2, name: "CPP_POST_BOOL_FILLET_SUPPRESS" });
    const result = await cube.fillet({
        radius: 0.25,
        edges: [buildEdge(cube)],
        direction: "INSET",
        resolution: 24,
        featureID: "CPP_POST_BOOL_FILLET_SUPPRESS",
        mergeCoplanarEndCaps: false,
    });

    if (result.__filletEndCapReverseNudgeEnabled !== false) {
        throw new Error("Expected reverse-end-cap nudge to stay disabled when mergeCoplanarEndCaps is off.");
    }
    if (Number(result.__filletEndCapReverseNudgeCount || 0) !== 0) {
        throw new Error(`Expected zero reversed end caps when merge is disabled, received ${result.__filletEndCapReverseNudgeCount}.`);
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

export async function test_cppSolidNative_reversePostBooleanFilletEndCapNudge_skips_faces_that_share_vertices_with_fillet_sidewalls() {
    const solid = buildSyntheticCoplanarEndCapSolid();
    solid.setFaceMetadata("TOP_MAIN", {
        ...(solid.getFaceMetadata("TOP_MAIN") || {}),
        filletSideWall: true,
        filletRoundFace: "F_TEST_TUBE_Outer",
    });
    const before = buildSolidAuthoringStateSnapshot(solid);
    const summary = __testOnlyReversePostBooleanFilletEndCapNudge(solid, 0.05, { featureID: "F_TEST" });
    if (Number(summary?.reversedFaces || 0) !== 0) {
        throw new Error(`Expected reversePostBooleanFilletEndCapNudge to skip shared sidewall vertices, received ${summary?.reversedFaces} reversed faces.`);
    }
    if (Number(summary?.skippedFaces || 0) !== 1) {
        throw new Error(`Expected reversePostBooleanFilletEndCapNudge to report one skipped face, received ${summary?.skippedFaces}.`);
    }
    const after = buildSolidAuthoringStateSnapshot(solid);
    const comparableBefore = JSON.stringify({
        vertProperties: before.vertProperties,
        triVerts: before.triVerts,
        triIDs: before.triIDs,
    });
    const comparableAfter = JSON.stringify({
        vertProperties: after.vertProperties,
        triVerts: after.triVerts,
        triIDs: after.triIDs,
    });
    if (comparableBefore !== comparableAfter) {
        throw new Error("Expected reversePostBooleanFilletEndCapNudge skip path to leave geometry unchanged.");
    }
}

export async function test_cppSolidNative_reassignTinyFilletSidewallSliverTriangles_merges_triangle_whose_vertices_lie_on_single_planar_face_boundary() {
    const solid = new Solid();
    solid
        .addTriangle("MAIN", [0, 0, 0], [2, 0, 0], [2, 2, 0])
        .addTriangle("MAIN", [0, 0, 0], [2, 2, 0], [0, 2, 0])
        .addTriangle("SLIVER", [0.0001, 0, 0], [0.0002, 0, 0], [0, 0.0001, 0]);

    solid.setFaceMetadata("MAIN", { marker: "main-face", sourceFeatureId: "BASE" });
    solid.setFaceMetadata("SLIVER", {
        filletSideWall: true,
        filletRoundFace: "F_TEST_TUBE_Outer",
        sourceFeatureId: "F_TEST",
    });

    const summary = __testOnlyReassignTinyFilletSidewallSliverTriangles(solid, { featureID: "F_TEST" });
    if (Number(summary?.reassignedTriangles || 0) !== 1) {
        throw new Error(`Expected one boundary-hosted sliver triangle to merge into MAIN, received ${summary?.reassignedTriangles}.`);
    }

    const faceNames = new Set(solid.getFaceNames?.() || []);
    if (!faceNames.has("MAIN")) {
        throw new Error("Expected MAIN to survive sliver-triangle reassignment.");
    }
    if (faceNames.has("SLIVER")) {
        throw new Error("Expected SLIVER face to be pruned after reassignment into MAIN.");
    }

    const mainFaceID = solid._faceNameToID.get("MAIN");
    const mainTriangleCount = Array.from(solid._triIDs || []).filter((triID) => triID === mainFaceID).length;
    if (mainTriangleCount !== 3) {
        throw new Error(`Expected MAIN to own 3 triangles after sliver reassignment, received ${mainTriangleCount}.`);
    }

    const metadata = solid.getFaceMetadata("MAIN") || {};
    if (metadata.marker !== "main-face" || metadata.sourceFeatureId !== "BASE") {
        throw new Error("Expected MAIN metadata to survive sliver-triangle reassignment.");
    }
}

export async function test_cppSolidNative_collapseFilletSideWallFaces_collapses_strip_vertices() {
    const solid = new Solid();
    const sideWallName = "F_TEST_FILLET_SIDEWALL_EDGE_abcd1234";
    solid
        .addTriangle("MAIN_A", [0, 0, 0], [2, 0, 0], [2, 1, 0])
        .addTriangle("MAIN_A", [0, 0, 0], [2, 1, 0], [0, 1, 0])
        .addTriangle(sideWallName, [0, 1, 0], [2, 1, 0], [2, 1.1, 0])
        .addTriangle(sideWallName, [0, 1, 0], [2, 1.1, 0], [0, 1.1, 0])
        .addTriangle("MAIN_B", [0, 1.1, 0], [2, 1.1, 0], [2, 2, 0])
        .addTriangle("MAIN_B", [0, 1.1, 0], [2, 2, 0], [0, 2, 0]);

    solid.setFaceMetadata("MAIN_A", { marker: "a" });
    solid.setFaceMetadata("MAIN_B", { marker: "b" });
    solid.setFaceMetadata(sideWallName, {
        filletSideWall: true,
        filletMergedSideWall: true,
        filletSideWallEdge: "EDGE",
        sourceFeatureId: "F_TEST",
    });

    const summary = __testOnlyCollapseFilletSideWallFaces(solid, { featureID: "F_TEST" });
    if (Number(summary?.collapsedTriangles || 0) !== 2) {
        throw new Error(`Expected two side-wall triangles to be collapsed, received ${summary?.collapsedTriangles}.`);
    }
    if (!(Number(summary?.collapsedEdges || 0) >= 2)) {
        throw new Error(`Expected at least two side-wall edge collapses, received ${summary?.collapsedEdges}.`);
    }

    const faceNames = new Set(solid.getFaceNames?.() || []);
    if (!faceNames.has(sideWallName)) {
        throw new Error("Expected coordinate-only side-wall collapse to leave cleanup to simplify.");
    }
    if (!faceNames.has("MAIN_A") || !faceNames.has("MAIN_B")) {
        throw new Error("Expected adjacent faces to survive side-wall collapse.");
    }

    const mainBID = solid._faceNameToID.get("MAIN_B");
    const yValues = [];
    for (let triIndex = 0; triIndex < solid._triIDs.length; triIndex += 1) {
        if ((solid._triIDs[triIndex] >>> 0) !== (mainBID >>> 0)) continue;
        const base = triIndex * 3;
        for (const vertexIndex of [
            solid._triVerts[base + 0],
            solid._triVerts[base + 1],
            solid._triVerts[base + 2],
        ]) {
            yValues.push(solid._vertProperties[(vertexIndex * 3) + 1]);
        }
    }
    if (!yValues.some((y) => approx(y, 1, 1e-9))) {
        throw new Error("Expected MAIN_B boundary vertices to move onto MAIN_A boundary at y=1.");
    }
    if (yValues.some((y) => approx(y, 1.1, 1e-9))) {
        throw new Error("Expected old side-wall boundary y=1.1 to be eliminated from MAIN_B.");
    }
}

export async function test_cppSolidNative_collapseFilletSideWallFaces_collapses_away_from_round_face() {
    const solid = new Solid();
    const sideWallName = "F_TEST_FILLET_SIDEWALL_EDGE_abcd1234";
    const roundFaceName = "F_TEST_FILLET_EDGE_abcd1234_TUBE_Outer";
    solid
        .addTriangle("HOST", [0, 0, 0], [2, 0, 0], [2, 1, 0])
        .addTriangle("HOST", [0, 0, 0], [2, 1, 0], [0, 1, 0])
        .addTriangle(sideWallName, [0, 1, 0], [2, 1, 0], [2, 1.1, 0])
        .addTriangle(sideWallName, [0, 1, 0], [2, 1.1, 0], [0, 1.1, 0])
        .addTriangle(roundFaceName, [0, 1.1, 0], [2, 1.1, 0], [2, 2, 0])
        .addTriangle(roundFaceName, [0, 1.1, 0], [2, 2, 0], [0, 2, 0]);

    solid.setFaceMetadata("HOST", { marker: "preserve-me" });
    solid.setFaceMetadata(roundFaceName, { filletRoundFace: true });
    solid.setFaceMetadata(sideWallName, {
        filletSideWall: true,
        filletMergedSideWall: true,
        filletSideWallEdge: "EDGE",
        sourceFeatureId: "F_TEST",
    });

    const summary = __testOnlyCollapseFilletSideWallFaces(solid, { featureID: "F_TEST" });
    if (Number(summary?.collapsedTriangles || 0) !== 2) {
        throw new Error(`Expected two side-wall triangles to be collapsed, received ${summary?.collapsedTriangles}.`);
    }

    const collectYValuesForFace = (faceName) => {
        const faceID = solid._faceNameToID.get(faceName);
        const out = [];
        for (let triIndex = 0; triIndex < solid._triIDs.length; triIndex += 1) {
            if ((solid._triIDs[triIndex] >>> 0) !== (faceID >>> 0)) continue;
            const base = triIndex * 3;
            for (const vertexIndex of [
                solid._triVerts[base + 0],
                solid._triVerts[base + 1],
                solid._triVerts[base + 2],
            ]) {
                out.push(solid._vertProperties[(vertexIndex * 3) + 1]);
            }
        }
        return out;
    };

    const hostYValues = collectYValuesForFace("HOST");
    if (hostYValues.some((y) => approx(y, 1.1, 1e-9))) {
        throw new Error("Expected preserved host face vertices to stay away from the old round-face boundary y=1.1.");
    }
    if (!hostYValues.some((y) => approx(y, 1, 1e-9))) {
        throw new Error("Expected preserved host boundary at y=1 to remain in place.");
    }

    const roundYValues = collectYValuesForFace(roundFaceName);
    if (!roundYValues.some((y) => approx(y, 1, 1e-9))) {
        throw new Error("Expected round-face boundary vertices to collapse toward the preserved host boundary at y=1.");
    }
    if (roundYValues.some((y) => approx(y, 1.1, 1e-9))) {
        throw new Error("Expected old round-side sidewall boundary y=1.1 to be eliminated from the round face.");
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

export async function test_cppSolidNative_booleanResults_apply_fixed_post_weld_epsilon() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const makePair = () => {
        const base = new Cube({ x: 10, y: 10, z: 10, name: "BOOL_WELD_BASE" });
        const tool = new Cube({ x: 6, y: 6, z: 6, name: "BOOL_WELD_TOOL" });
        tool.bakeTRS({
            position: [4, 2, 2],
            rotationEuler: [0, 0, 0],
            scale: [1, 1, 1],
        });
        return { base, tool };
    };

    const unionPair = makePair();
    const unioned = unionPair.base.union(unionPair.tool);
    const subtractPair = makePair();
    const subtracted = subtractPair.base.subtract(subtractPair.tool);
    const intersectPair = makePair();
    const intersected = intersectPair.base.intersect(intersectPair.tool);

    for (const [label, result] of [
        ["union", unioned],
        ["subtract", subtracted],
        ["intersect", intersected],
    ]) {
        if (!approx(result?._epsilon, 0.0015, 1e-12)) {
            throw new Error(`Expected ${label} result to set fixed post-boolean weld epsilon 0.0015, received ${result?._epsilon}.`);
        }
        if (!result?._manifold) {
            throw new Error(`Expected ${label} result to rebuild its manifold after the fixed post-boolean weld.`);
        }
    }
}

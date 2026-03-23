import { Solid } from "../BREP/BetterSolid.js";
import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
    cppSolidCoreHasNativeManifoldPrep,
    cppSolidCoreHasNativeOffsetFace,
    cppSolidCoreHasNativePushFace,
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

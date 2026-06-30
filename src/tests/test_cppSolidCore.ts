import { CppSolidCore } from "../BREP/CppSolidCore.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

export async function test_cppSolidCore_preserves_face_ids_and_metadata() {
    if (manifoldBuildSource !== "local") {
        return;
    }
    const core = new CppSolidCore();
    try {
        core
            .addTriangle("FACE_A", [0, 0, 0], [1, 0, 0], [0, 1, 0])
            .addTriangle("FACE_A", [0, 0, 0], [0, 1, 0], [0, 0, 1])
            .addTriangle("FACE_B", [0, 0, 0], [1, 0, 0], [0, 0, 1]);

        core.setFaceMetadata("FACE_A", { radius: 12.5, kind: "cylindrical" });
        core.setEdgeMetadata("FACE_A|FACE_B[0]", { smooth: false });

        const snapshot = core.getAuthoringState();
        if (snapshot.vertexCount !== 4) {
            throw new Error(`Expected 4 unique vertices, received ${snapshot.vertexCount}.`);
        }
        if (snapshot.triangleCount !== 3) {
            throw new Error(`Expected 3 triangles, received ${snapshot.triangleCount}.`);
        }

        const faceAId = snapshot.faceNameToID.get("FACE_A");
        const faceBId = snapshot.faceNameToID.get("FACE_B");
        if (!Number.isFinite(faceAId) || !Number.isFinite(faceBId) || faceAId === faceBId) {
            throw new Error("Expected distinct preserved face IDs for FACE_A and FACE_B.");
        }

        if (snapshot.idToFaceName.get(faceAId) !== "FACE_A") {
            throw new Error("FACE_A ID did not round-trip through the C++ core.");
        }
        if (snapshot.idToFaceName.get(faceBId) !== "FACE_B") {
            throw new Error("FACE_B ID did not round-trip through the C++ core.");
        }

        const faceMeta = core.getFaceMetadata("FACE_A");
        if (faceMeta.radius !== 12.5 || faceMeta.kind !== "cylindrical") {
            throw new Error("Face metadata did not round-trip through the C++ core.");
        }

        const edgeMeta = core.getEdgeMetadata("FACE_A|FACE_B[0]");
        if (edgeMeta.smooth !== false) {
            throw new Error("Edge metadata did not round-trip through the C++ core.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_setAuthoringState_and_bakeTransform() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ],
            triVerts: [0, 1, 2],
            triIDs: [42],
            faceNameToID: [["FACE_A", 42]],
            idToFaceName: [[42, "FACE_A"]],
            faceMetadataJson: [[
                "FACE_A",
                JSON.stringify({
                    kind: "planar",
                    center: [0.25, 0.5, 0],
                    axis: [1, 0, 0],
                }),
            ]],
            edgeMetadataJson: [["FACE_A|EDGE_0", JSON.stringify({ smooth: true })]],
        });

        core.bakeTransform([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            5, -2, 3, 1,
        ]);

        const snapshot = core.getAuthoringState();
        const expectedVerts = [
            5, -2, 3,
            6, -2, 3,
            5, -1, 3,
        ];
        if (snapshot.vertProperties.length !== expectedVerts.length) {
            throw new Error("Unexpected transformed vertex buffer length.");
        }
        for (let i = 0; i < expectedVerts.length; i++) {
            if (Math.abs(snapshot.vertProperties[i] - expectedVerts[i]) > 1e-6) {
                throw new Error(`Transformed vertex mismatch at index ${i}: expected ${expectedVerts[i]}, received ${snapshot.vertProperties[i]}.`);
            }
        }

        if (snapshot.faceNameToID.get("FACE_A") !== 42) {
            throw new Error("Face name to ID mapping was not preserved across setAuthoringState/bakeTransform.");
        }
        if (snapshot.idToFaceName.get(42) !== "FACE_A") {
            throw new Error("Face ID to name mapping was not preserved across setAuthoringState/bakeTransform.");
        }
        const faceMetadata = core.getFaceMetadata("FACE_A");
        if (faceMetadata.kind !== "planar") {
            throw new Error("Face metadata kind was not preserved across setAuthoringState/bakeTransform.");
        }
        if (Math.abs((faceMetadata.center?.[0] ?? NaN) - 5.25) > 1e-6
            || Math.abs((faceMetadata.center?.[1] ?? NaN) - (-1.5)) > 1e-6
            || Math.abs((faceMetadata.center?.[2] ?? NaN) - 3) > 1e-6) {
            throw new Error(`Face metadata center was not transformed natively: ${JSON.stringify(faceMetadata.center)}.`);
        }
        if (Math.abs((faceMetadata.axis?.[0] ?? NaN) - 1) > 1e-6
            || Math.abs((faceMetadata.axis?.[1] ?? NaN) - 0) > 1e-6
            || Math.abs((faceMetadata.axis?.[2] ?? NaN) - 0) > 1e-6) {
            throw new Error(`Face metadata axis was not transformed natively: ${JSON.stringify(faceMetadata.axis)}.`);
        }
        if (core.getEdgeMetadata("FACE_A|EDGE_0").smooth !== true) {
            throw new Error("Edge metadata was not preserved across setAuthoringState/bakeTransform.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_weldVerticesByEpsilon_aligns_authoring_points_without_compacting_buffers() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                1.0000001, 0, 0,
            ],
            triVerts: [0, 1, 2, 0, 3, 2],
            triIDs: [7, 7],
            faceNameToID: [["FACE_A", 7]],
            idToFaceName: [[7, "FACE_A"]],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        core.weldVerticesByEpsilon(1e-5);
        const snapshot = core.getAuthoringState();

        if (snapshot.vertexCount !== 4) {
            throw new Error(`Expected authored vertex count to stay 4 after weldVerticesByEpsilon, received ${snapshot.vertexCount}.`);
        }
        if (snapshot.triangleCount !== 2) {
            throw new Error(`Expected authored triangle count to stay 2 after weldVerticesByEpsilon, received ${snapshot.triangleCount}.`);
        }

        const x1 = snapshot.vertProperties[3];
        const x3 = snapshot.vertProperties[9];
        if (Math.abs(x1 - 1.00000005) > 1e-6 || Math.abs(x3 - 1.00000005) > 1e-6) {
            throw new Error(`Expected welded vertices to share the averaged x position, received x1=${x1}, x3=${x3}.`);
        }
        if (snapshot.faceNameToID.get("FACE_A") !== 7 || snapshot.idToFaceName.get(7) !== "FACE_A") {
            throw new Error("Face mappings were not preserved across weldVerticesByEpsilon.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_weldVerticesByEpsilon_aligns_neighboring_cells_by_true_distance() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                0, 0, 0.99995,
                0, 0, 1.00004,
            ],
            triVerts: [
                0, 2, 1,
                0, 1, 3,
                0, 4, 2,
                1, 2, 3,
            ],
            triIDs: [11, 12, 13, 14],
            faceNameToID: [
                ["F1", 11],
                ["F2", 12],
                ["F3", 13],
                ["F4", 14],
            ],
            idToFaceName: [
                [11, "F1"],
                [12, "F2"],
                [13, "F3"],
                [14, "F4"],
            ],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        core.weldVerticesByEpsilon(1e-4);
        const snapshot = core.getAuthoringState();

        if (snapshot.vertexCount !== 5) {
            throw new Error(`Expected authored vertex count to stay 5 after neighboring-cell weld, received ${snapshot.vertexCount}.`);
        }
        if (snapshot.triangleCount !== 4) {
            throw new Error(`Expected the tetra shell to remain intact after weldVerticesByEpsilon, received ${snapshot.triangleCount} triangles.`);
        }

        const apexZ = snapshot.vertProperties[11];
        const apexZ2 = snapshot.vertProperties[14];
        if (Math.abs(apexZ - 0.999995) > 1e-6 || Math.abs(apexZ2 - 0.999995) > 1e-6) {
            throw new Error(`Expected neighboring-cell vertices to share z=0.999995 after cluster averaging, received z1=${apexZ}, z2=${apexZ2}.`);
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_pushFace_moves_vertices_for_face() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                1, 1, 0,
                0, 1, 0,
            ],
            triVerts: [0, 1, 2, 0, 2, 3],
            triIDs: [9, 9],
            faceNameToID: [["FACE_TOP", 9]],
            idToFaceName: [[9, "FACE_TOP"]],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        const result = core.pushFace("FACE_TOP", 0.25);
        if (!result?.faceFound || !result?.moved) {
            throw new Error(`Expected pushFace to move FACE_TOP, received ${JSON.stringify(result)}.`);
        }

        const snapshot = core.getAuthoringState();
        const expectedZ = 0.25;
        for (let i = 2; i < snapshot.vertProperties.length; i += 3) {
            if (Math.abs(snapshot.vertProperties[i] - expectedZ) > 1e-6) {
                throw new Error(`Expected pushed face z=${expectedZ}, received ${snapshot.vertProperties[i]} at index ${i}.`);
            }
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_prepareManifoldMesh_repairs_orientation() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                0, 0, 1,
            ],
            triVerts: [
                0, 1, 2,
                0, 1, 3,
                1, 2, 3,
                2, 0, 3,
            ],
            triIDs: [21, 22, 23, 24],
            faceNameToID: [
                ["F0", 21],
                ["F1", 22],
                ["F2", 23],
                ["F3", 24],
            ],
            idToFaceName: [
                [21, "F0"],
                [22, "F1"],
                [23, "F2"],
                [24, "F3"],
            ],
            faceMetadataJson: [],
            edgeMetadataJson: [],
        });

        if (core.isCoherentlyOrientedManifold()) {
            throw new Error("Expected tetrahedron with inconsistent winding to start incoherent.");
        }

        const prepared = core.prepareManifoldMesh();
        if (!core.isCoherentlyOrientedManifold()) {
            throw new Error("Expected prepareManifoldMesh to repair triangle winding coherence.");
        }
        if ((prepared?.triangleCount ?? 0) !== 4 || (prepared?.vertexCount ?? 0) !== 4) {
            throw new Error(`Unexpected prepared manifold mesh counts: ${JSON.stringify(prepared)}.`);
        }
        if (!Array.isArray(prepared?.triVerts) || prepared.triVerts.length !== 12) {
            throw new Error("Expected prepareManifoldMesh to return triangle indices.");
        }
        if (!Array.isArray(prepared?.faceID) || prepared.faceID.length !== 4) {
            throw new Error("Expected prepareManifoldMesh to preserve triangle face IDs.");
        }
        if (!Array.isArray(prepared?.mergeFromVert) || !Array.isArray(prepared?.mergeToVert)) {
            throw new Error("Expected prepareManifoldMesh to expose merge arrays.");
        }
        if (prepared.mergeFromVert.length !== prepared.mergeToVert.length) {
            throw new Error("Expected prepareManifoldMesh merge arrays to stay aligned.");
        }

        const preparedTyped = core.prepareManifoldMeshTyped();
        if (!(preparedTyped?.vertProperties instanceof Float32Array)) {
            throw new Error("Expected prepareManifoldMeshTyped to return Float32Array vertex properties.");
        }
        if (!(preparedTyped?.triVerts instanceof Uint32Array) || !(preparedTyped?.faceID instanceof Uint32Array)) {
            throw new Error("Expected prepareManifoldMeshTyped to return Uint32Array triangle buffers.");
        }
        if (preparedTyped.triVerts.length !== prepared.triVerts.length
            || preparedTyped.faceID.length !== prepared.faceID.length
            || preparedTyped.vertProperties.length !== prepared.vertProperties.length) {
            throw new Error("Expected prepareManifoldMeshTyped buffers to match prepareManifoldMesh lengths.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_topologyQueries_return_native_face_and_edge_payloads() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                0, 0, 1,
            ],
            triVerts: [
                0, 1, 2,
                0, 3, 1,
                1, 3, 2,
                2, 3, 0,
            ],
            triIDs: [31, 32, 33, 34],
            faceNameToID: [
                ["F0", 31],
                ["F1", 32],
                ["F2", 33],
                ["F3", 34],
            ],
            idToFaceName: [
                [31, "F0"],
                [32, "F1"],
                [33, "F2"],
                [34, "F3"],
            ],
            faceMetadataJson: [["F0", JSON.stringify({ kind: "planar" })]],
            edgeMetadataJson: [["F0|F1[0]", JSON.stringify({ smooth: false })]],
        });

        const face = core.getFace("F0");
        if (!Array.isArray(face) || face.length !== 1) {
            throw new Error(`Expected native getFace("F0") to return 1 triangle, received ${face?.length}.`);
        }
        if (face[0]?.faceName !== "F0" || !Array.isArray(face[0]?.indices) || face[0].indices.length !== 3) {
            throw new Error("Expected native getFace() to return triangle descriptors with faceName and indices.");
        }

        const faces = core.getFaces(true);
        if (!Array.isArray(faces) || faces.length !== 4) {
            throw new Error(`Expected native getFaces(true) to return 4 named faces, received ${faces?.length}.`);
        }
        const faceNames = faces.map((entry) => entry?.faceName).sort();
        if (faceNames.join("|") !== "F0|F1|F2|F3") {
            throw new Error(`Unexpected native face names: ${faceNames.join(", ")}.`);
        }

        const boundaries = core.getBoundaryEdgePolylines();
        if (!Array.isArray(boundaries) || boundaries.length !== 6) {
            throw new Error(`Expected tetrahedron native boundary extraction to return 6 labeled edges, received ${boundaries?.length}.`);
        }
        const sample = boundaries.find((edge) => edge?.name === "F0|F1[0]") || boundaries[0];
        if (!sample || !Array.isArray(sample?.positions) || sample.positions.length < 2) {
            throw new Error("Expected native boundary edges to expose polyline positions.");
        }
        if (!Array.isArray(sample?.indices) || sample.indices.length < 2) {
            throw new Error("Expected native boundary edges to expose vertex indices.");
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_boundaryQueries_match_geometric_edges_on_split_authoring_mesh() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                1.0000002, 0, 0,
                0.0000002, 1, 0,
                1, 1, 0,
            ],
            triVerts: [
                0, 1, 2,
                3, 5, 4,
            ],
            triIDs: [101, 202],
            faceNameToID: [
                ["FA", 101],
                ["FB", 202],
            ],
            idToFaceName: [
                [101, "FA"],
                [202, "FB"],
            ],
        });

        const boundaries = core.getBoundaryEdgePolylines();
        if (!Array.isArray(boundaries) || boundaries.length !== 1) {
            throw new Error(`Expected one geometric shared edge between split faces, received ${boundaries?.length}.`);
        }

        const edge = boundaries[0];
        if (edge?.name !== "FA|FB[0]") {
            throw new Error(`Expected native split-mesh edge name FA|FB[0], received ${edge?.name}.`);
        }
        if (!Array.isArray(edge?.positions) || edge.positions.length !== 2) {
            throw new Error("Expected native split-mesh boundary extraction to return a 2-point polyline.");
        }
        const [[x0, y0, z0], [x1, y1, z1]] = edge.positions;
        const endpoints = [
            `${x0.toFixed(6)},${y0.toFixed(6)},${z0.toFixed(6)}`,
            `${x1.toFixed(6)},${y1.toFixed(6)},${z1.toFixed(6)}`,
        ].sort();
        if (endpoints.join("|") !== "0.000000,1.000000,0.000000|1.000000,0.000000,0.000000") {
            throw new Error(`Unexpected geometric edge endpoints from native split-mesh query: ${endpoints.join(" | ")}.`);
        }
    } finally {
        core.dispose();
    }
}

export async function test_cppSolidCore_removeDisconnectedIslandsByVolume_drops_small_shells() {
    if (manifoldBuildSource !== "local") {
        return;
    }

    const core = new CppSolidCore();
    try {
        core.setAuthoringState({
            numProp: 3,
            vertProperties: [
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
                0, 0, 1,
                5, 5, 5,
                5.1, 5, 5,
                5, 5.1, 5,
                5, 5, 5.1,
            ],
            triVerts: [
                0, 1, 2,
                0, 3, 1,
                1, 3, 2,
                2, 3, 0,
                4, 5, 6,
                4, 7, 5,
                5, 7, 6,
                6, 7, 4,
            ],
            triIDs: [51, 52, 53, 54, 61, 62, 63, 64],
            faceNameToID: [
                ["BIG_A", 51],
                ["BIG_B", 52],
                ["BIG_C", 53],
                ["BIG_D", 54],
                ["SMALL_A", 61],
                ["SMALL_B", 62],
                ["SMALL_C", 63],
                ["SMALL_D", 64],
            ],
            idToFaceName: [
                [51, "BIG_A"],
                [52, "BIG_B"],
                [53, "BIG_C"],
                [54, "BIG_D"],
                [61, "SMALL_A"],
                [62, "SMALL_B"],
                [63, "SMALL_C"],
                [64, "SMALL_D"],
            ],
            faceMetadataJson: [
                ["BIG_A", JSON.stringify({ group: "big" })],
                ["SMALL_A", JSON.stringify({ group: "small" })],
            ],
            edgeMetadataJson: [],
        });

        const removed = core.removeDisconnectedIslandsByVolume(0.01);
        if (removed !== 4) {
            throw new Error(`Expected 4 removed triangles from the small shell, received ${removed}.`);
        }

        const snapshot = core.getAuthoringState();
        if (snapshot.triangleCount !== 4) {
            throw new Error(`Expected only the main shell triangles to remain, received ${snapshot.triangleCount}.`);
        }
        if (snapshot.vertexCount !== 4) {
            throw new Error(`Expected only the main shell vertices to remain, received ${snapshot.vertexCount}.`);
        }

        const faceNames = Array.from(snapshot.faceNameToID.keys()).sort();
        if (faceNames.join("|") !== "BIG_A|BIG_B|BIG_C|BIG_D") {
            throw new Error(`Unexpected surviving face names after native island cleanup: ${faceNames.join(", ")}.`);
        }

        if (core.getFaceMetadata("BIG_A").group !== "big") {
            throw new Error("Expected big-shell face metadata to survive native island cleanup.");
        }
        if (Object.keys(core.getFaceMetadata("SMALL_A") || {}).length !== 0) {
            throw new Error("Expected removed small-shell face metadata to be pruned.");
        }
    } finally {
        core.dispose();
    }
}

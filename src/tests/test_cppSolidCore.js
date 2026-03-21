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

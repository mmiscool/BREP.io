import { Cube } from "../BREP/primitives.js";
import { manifold, manifoldBuildSource } from "../BREP/setupManifold.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
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

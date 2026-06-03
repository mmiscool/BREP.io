import { RemeshFeature } from "../features/remesh/RemeshFeature.js";
import { Cylinder, primitiveHasNativeBuilder } from "../BREP/primitives.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";
import { fs } from "../fs.proxy.js";

const IMPORT_FIXTURE_STL_PATH = "src/tests/importTestingData/import_test.stl";

function analyzeSolidTopology(solid) {
    const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const triCount = (triVerts.length / 3) | 0;
    const edgeUses = new Map();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const a = triVerts[triIndex * 3 + 0] >>> 0;
        const b = triVerts[triIndex * 3 + 1] >>> 0;
        const c = triVerts[triIndex * 3 + 2] >>> 0;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = edgeKey(u, v);
            edgeUses.set(key, (edgeUses.get(key) || 0) + 1);
        }
    }
    let boundaryEdgeCount = 0;
    let nonManifoldEdgeCount = 0;
    for (const count of edgeUses.values()) {
        if (count === 1) boundaryEdgeCount += 1;
        else if (count !== 2) nonManifoldEdgeCount += 1;
    }
    return { boundaryEdgeCount, nonManifoldEdgeCount };
}

function assertClosedManifold(solid, label) {
    const topology = analyzeSolidTopology(solid);
    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
        throw new Error(
            `[${label}] Expected closed manifold result. `
            + `Boundary edges=${topology.boundaryEdgeCount}, non-manifold edges=${topology.nonManifoldEdgeCount}.`,
        );
    }
    if (typeof solid?._isCoherentlyOrientedManifold === "function" && solid._isCoherentlyOrientedManifold() !== true) {
        throw new Error(`[${label}] Expected coherently oriented manifold result.`);
    }
}

export async function test_remesh_simplify_uses_kernel_simplify_without_full_tolerance_weld() {
    const callLog = [];

    const outSolid = {
        type: "SOLID",
        simplify(tolerance) {
            callLog.push(["simplify", tolerance]);
            return this;
        },
        _weldVerticesByEpsilon(epsilon, options) {
            callLog.push(["weld", epsilon, options?.rebuildManifold]);
            return this;
        },
        fixTriangleWindingsByAdjacency() {
            callLog.push(["fixWindings"]);
            return this;
        },
        visualize() {
            callLog.push(["visualize"]);
        },
    };

    const targetSolid = {
        type: "SOLID",
        name: "REMESH_SRC",
        clone() {
            callLog.push(["clone"]);
            return outSolid;
        },
    };

    const fakeHistory = {
        scene: {
            async getObjectByName(name) {
                return name === "REMESH_SRC" ? targetSolid : null;
            },
        },
    };

    const feature = new RemeshFeature();
    feature.inputParams = {
        targetSolid: "REMESH_SRC",
        mode: "Simplify",
        tolerance: 0.05,
    };

    const effects = await feature.run(fakeHistory);
    if (!Array.isArray(effects?.added) || effects.added[0] !== outSolid) {
        throw new Error("Expected remesh simplify feature to return the cloned output solid.");
    }
    if (!Array.isArray(effects?.removed) || effects.removed[0] !== targetSolid) {
        throw new Error("Expected remesh simplify feature to mark the source solid for removal.");
    }

    const operationLog = callLog.map((entry) => {
        const [name, value, extra] = entry;
        if (name === "weld") return `${name}:${value}:${String(extra)}`;
        return value === undefined ? name : `${name}:${value}`;
    });
    const expected = ["clone", "fixWindings", "simplify:0.05", "visualize"];
    if (operationLog.join("|") !== expected.join("|")) {
        throw new Error(
            `Expected remesh simplify to use kernel simplify without full-tolerance weld; received ${operationLog.join("|")}.`,
        );
    }
}

export async function test_remesh_simplify_imported_fixture_stl(partHistory) {
    if (manifoldBuildSource !== "local") return partHistory;

    const stl = await fs.promises.readFile(IMPORT_FIXTURE_STL_PATH, "utf8");
    const import3d = await partHistory.newFeature("IMPORT3D");
    Object.assign(import3d.inputParams, {
        id: "REMESH_IMPORT_FIXTURE_SOURCE",
        featureID: "REMESH_IMPORT_FIXTURE_SOURCE",
        fileToImport: stl,
        centerMesh: true,
        deflectionAngle: 8,
        decimationLevel: 100,
        meshRepairLevel: "NONE",
        extractMultipleSolids: false,
        extractPlanarFaces: true,
        planarFaceMinAreaPercent: 1,
        segmentAnalyticPrimitives: false,
    });

    const remesh = await partHistory.newFeature("RM");
    remesh.inputParams.targetSolid = "REMESH_IMPORT_FIXTURE_SOURCE";
    remesh.inputParams.mode = "Simplify";
    remesh.inputParams.tolerance = 0.02;

    return partHistory;
}

export async function afterRun_remesh_simplify_imported_fixture_stl(partHistory) {
    if (manifoldBuildSource !== "local") return;

    const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === "SOLID");
    const remeshed = solids.find((obj) => String(obj?.name || "") === "(REMESH_IMPORT_FIXTURE_SOURCE)");
    if (!remeshed) {
        throw new Error("[remesh imported fixture] Expected remeshed imported solid.");
    }
    const triangleCount = Math.floor((Array.isArray(remeshed._triVerts) ? remeshed._triVerts.length : 0) / 3);
    if (!(triangleCount > 0 && triangleCount < 17228)) {
        throw new Error(`[remesh imported fixture] Expected simplified triangle count below 17228, got ${triangleCount}.`);
    }
    assertClosedManifold(remeshed, "remesh imported fixture");
}

export async function test_solid_simplify_preserves_face_tags_and_metadata() {
    if (manifoldBuildSource !== "local" || !primitiveHasNativeBuilder()) return;

    const cylinder = new Cylinder({ radius: 1, height: 2, resolution: 64, name: "SIMPLIFY_CYL" });
    const beforeTriangles = cylinder.getTriangleCount();
    const simplified = cylinder.simplify(0.1);
    const afterTriangles = simplified.getTriangleCount();
    if (!(afterTriangles > 0 && afterTriangles < beforeTriangles)) {
        throw new Error(`Expected simplify to reduce triangle count from ${beforeTriangles}; got ${afterTriangles}.`);
    }

    const faceNames = new Set(simplified.getFaceNames());
    for (const faceName of ["SIMPLIFY_CYL_B", "SIMPLIFY_CYL_T", "SIMPLIFY_CYL_S"]) {
        if (!faceNames.has(faceName)) {
            throw new Error(`Expected simplified cylinder to preserve face tag "${faceName}".`);
        }
    }

    const sideMetadata = simplified.getFaceMetadata("SIMPLIFY_CYL_S");
    if (sideMetadata?.type !== "cylindrical" || Math.abs((sideMetadata?.radius || 0) - 1) > 1e-9) {
        throw new Error("Expected simplified cylinder to preserve side-face metadata.");
    }
}

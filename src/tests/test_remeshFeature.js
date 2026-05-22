import { RemeshFeature } from "../features/remesh/RemeshFeature.js";
import { Cylinder, primitiveHasNativeBuilder } from "../BREP/primitives.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

export async function test_remesh_simplify_welds_by_tolerance_before_simplify() {
    const callLog = [];

    const outSolid = {
        type: "SOLID",
        simplify(tolerance) {
            callLog.push(["simplify", tolerance]);
            return this;
        },
        _weldVerticesByEpsilon(epsilon, options) {
            callLog.push(["weld", epsilon, options?.rebuildManifold]);
            if (options?.rebuildManifold !== false) {
                throw new Error("Expected pre-simplify weld to skip immediate manifold rebuild.");
            }
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
    const expected = ["clone", "weld:0.05:false", "fixWindings", "simplify:0.05", "visualize"];
    if (operationLog.join("|") !== expected.join("|")) {
        throw new Error(
            `Expected remesh simplify to weld before simplify using the same tolerance; received ${operationLog.join("|")}.`,
        );
    }
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

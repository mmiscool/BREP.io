import { BREP } from "../BREP/BREP.js";
import { RevolveFeature } from "../features/revolve/RevolveFeature.js";

export async function test_revolve_feature_resolves_face_and_edge_string_references() {
    const fakeHistory = {
        scene: new BREP.THREE.Scene(),
        getObjectByName(name) {
            return this.scene.getObjectByName(name);
        },
    };

    const cube = new BREP.Cube({ x: 4, y: 4, z: 4, name: "REVOLVE_SRC" });
    cube.visualize();
    fakeHistory.scene.add(cube);

    const face = cube.children.find((obj) => obj.type === "FACE" && /_PZ$/.test(obj.name));
    const axis = face?.edges?.[0] || null;
    if (!face || !axis) {
        throw new Error("Failed to create source face/edge fixtures for revolve feature test.");
    }

    const feature = new RevolveFeature();
    feature.inputParams = {
        profile: face.name,
        axis: axis.name,
        angle: 34,
        resolution: 64,
        featureID: "REVOLVE_FEATURE_TEST",
        boolean: { operation: "UNION", targets: [cube] },
    };

    const effects = await feature.run(fakeHistory);
    const added = Array.isArray(effects?.added) ? effects.added : [];
    if (!added.length) {
        throw new Error("Expected revolve feature to resolve string face/edge references and produce a result.");
    }
}

import { BREP } from "../BREP/BREP.js";
import { computeBoundaryLoopsFromFaceNative } from "../BREP/Sweep.js";
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

export async function test_revolve_generates_manifold_native_faces_for_axis_edge_profile() {
    const cube = new BREP.Cube({ x: 4, y: 4, z: 4, name: "REVOLVE_VIS_SRC" });
    cube.visualize();

    const face = cube.children.find((obj) => obj.type === "FACE" && /_PZ$/.test(obj.name));
    const axis = face?.edges?.[0] || null;
    if (!face || !axis) {
        throw new Error("Failed to create source face/edge fixtures for revolve visualization test.");
    }

    const revolve = new BREP.Revolve({
        face,
        axis,
        angle: 360,
        resolution: 8,
        name: "REVOLVE_VIS_TEST",
    });

    if (!Array.isArray(revolve._triIDs) || revolve._triIDs.length === 0) {
        throw new Error("Expected revolve to produce authored triangles.");
    }

    const nativeFaces = revolve.getFaces(false);
    if (!Array.isArray(nativeFaces) || nativeFaces.length === 0) {
        throw new Error("Expected axis-edge revolve to produce native queryable faces.");
    }

    for (const nativeFace of nativeFaces) {
        if (!Array.isArray(nativeFace.triangles) || nativeFace.triangles.length === 0) {
            throw new Error(`Native revolve face ${nativeFace.faceName || "UNKNOWN"} has no triangles.`);
        }
    }

    revolve.visualize();
    const renderedFaces = revolve.children.filter((obj) => obj.type === "FACE");
    if (renderedFaces.length !== nativeFaces.length) {
        throw new Error(`Expected rendered revolve face count to match native faces. Native=${nativeFaces.length}, Rendered=${renderedFaces.length}.`);
    }

    const volume = revolve.volume();
    if (!(volume > 0)) {
        throw new Error(`Expected axis-edge revolve to have positive manifold volume. Volume=${volume}.`);
    }
}

export async function test_revolve_face_profile_boundary_recovery_marks_inner_loop_as_hole() {
    const THREE = BREP.THREE;
    const points = [
        [-2, -2, 0],
        [2, -2, 0],
        [2, 2, 0],
        [-2, 2, 0],
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0],
    ];
    const triangles = [
        [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 0, 4], [3, 4, 7],
    ];
    const positions = [];
    for (const tri of triangles) {
        for (const index of tri) positions.push(...points[index]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const face = new BREP.Face(geometry);
    face.updateMatrixWorld?.(true);

    const loops = computeBoundaryLoopsFromFaceNative(face);
    const outerCount = loops.filter((loop) => !loop.isHole).length;
    const holeCount = loops.filter((loop) => loop.isHole).length;
    if (outerCount !== 1 || holeCount !== 1) {
        throw new Error(`Expected recovered annular profile to have one outer loop and one hole. Outer=${outerCount}, Holes=${holeCount}.`);
    }
}

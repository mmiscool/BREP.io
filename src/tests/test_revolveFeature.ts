import { BREP } from "../BREP/BREP.js";
import { computeBoundaryLoopsFromFaceNative } from "../BREP/Sweep.js";
import { RevolveFeature } from "../features/revolve/RevolveFeature.js";
import { PartHistory } from "../PartHistory.js";

function analyzeMeshTopology(solid) {
    const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const triCount = (triVerts.length / 3) | 0;
    const counts = new Map();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
        const a = triVerts[triIndex * 3] >>> 0;
        const b = triVerts[triIndex * 3 + 1] >>> 0;
        const c = triVerts[triIndex * 3 + 2] >>> 0;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = edgeKey(u, v);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    let boundaryEdgeCount = 0;
    let nonManifoldEdgeCount = 0;
    for (const count of counts.values()) {
        if (count === 1) boundaryEdgeCount += 1;
        else if (count !== 2) nonManifoldEdgeCount += 1;
    }
    return { boundaryEdgeCount, nonManifoldEdgeCount, triangleCount: triCount };
}

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

export async function test_revolve_axis_edge_profile_reuses_axis_vertices_for_partial_sweep() {
    const THREE = BREP.THREE;
    const loop = [
        [0, 0, 0],
        [8.905728, 14.930946, 0],
        [-10.96543, 26.783322, 0],
        [-19.87116, 11.852382, 0],
    ];
    const positions = [
        ...loop[0], ...loop[1], ...loop[2],
        ...loop[0], ...loop[2], ...loop[3],
    ];

    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    faceGeometry.computeVertexNormals();
    const face = new BREP.Face(faceGeometry);
    face.name = "REVOLVE_AXIS_EDGE_PROFILE";
    face.userData.boundaryLoopsWorld = [{ pts: loop, isHole: false }];
    face.updateMatrixWorld?.(true);

    const axisGeometry = new THREE.BufferGeometry();
    axisGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
        ...loop[0],
        ...loop[3],
    ], 3));
    const axis = new THREE.Line(axisGeometry);
    axis.name = "REVOLVE_AXIS_EDGE";
    axis.type = "EDGE";
    axis.updateMatrixWorld?.(true);

    const revolve = new BREP.Revolve({
        face,
        axis,
        angle: 144,
        resolution: 64,
        name: "REVOLVE_AXIS_EDGE_PARTIAL_TEST",
    });

    const topology = analyzeMeshTopology(revolve);
    if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
        throw new Error(
            "Expected partial revolve around a profile edge to be closed and manifold. "
            + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}, triangles=${topology.triangleCount}.`,
        );
    }
    if (typeof revolve._isCoherentlyOrientedManifold === "function" && revolve._isCoherentlyOrientedManifold() !== true) {
        throw new Error("Expected partial revolve around a profile edge to be coherently oriented.");
    }
}

export async function test_revolve_restored_consumed_sketch_keeps_edge_sidewalls_after_angle_edit(partHistory = new PartHistory()) {
    partHistory.expressions = "resolution = 32;";

    const sketch = await partHistory.newFeature("S");
    Object.assign(sketch.inputParams, {
        id: "S1",
        sketchPlane: null,
        curveResolution: "resolution",
    });
    sketch.persistentData = {
        sketch: {
            points: [
                { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
                { id: 1, x: 0, y: 0, fixed: false, construction: false, externalReference: false },
                { id: 2, x: 3, y: 0, fixed: false, construction: false, externalReference: false },
                { id: 3, x: 3, y: 0, fixed: false, construction: false, externalReference: false },
                { id: 4, x: 3, y: 4, fixed: false, construction: false, externalReference: false },
                { id: 5, x: 3, y: 4, fixed: false, construction: false, externalReference: false },
                { id: 6, x: 0, y: 4, fixed: false, construction: false, externalReference: false },
                { id: 7, x: 0, y: 4, fixed: false, construction: false, externalReference: false },
                { id: 8, x: 0, y: 0, fixed: false, construction: false, externalReference: false },
            ],
            geometries: [
                { id: 1, type: "line", points: [1, 2], construction: false },
                { id: 2, type: "line", points: [3, 4], construction: false },
                { id: 3, type: "line", points: [5, 6], construction: false },
                { id: 4, type: "line", points: [7, 8], construction: false },
            ],
            constraints: [
                { id: 1, type: "≡", points: [2, 3] },
                { id: 2, type: "≡", points: [4, 5] },
                { id: 3, type: "≡", points: [6, 7] },
                { id: 4, type: "≡", points: [8, 1] },
            ],
        },
    };

    const revolve = await partHistory.newFeature("R");
    Object.assign(revolve.inputParams, {
        id: "R2",
        profile: "S1",
        consumeProfileSketch: true,
        axis: "S1:G4",
        angle: 120,
        resolution: "resolution",
        boolean: { targets: [], operation: "NONE", overlapConditioningEnabled: true },
    });

    const assertEdgeSidewalls = (context) => {
        const solid = partHistory.getObjectByName("R2");
        if (!solid) throw new Error(`${context} Expected revolve output R2.`);
        const faceNames = typeof solid.getFaceNames === "function" ? solid.getFaceNames() : [];
        for (const faceName of ["S1:G1_RV", "S1:G2_RV", "S1:G3_RV"]) {
            if (!faceNames.includes(faceName)) {
                throw new Error(`${context} Missing revolve sidewall ${faceName}. Faces: ${faceNames.join(", ")}`);
            }
        }
        if (faceNames.some((faceName) => faceName === "S1:PROFILE_RV" || faceName === "R2:S1:PROFILE_RV")) {
            throw new Error(`${context} Revolve sidewalls collapsed to profile-level face. Faces: ${faceNames.join(", ")}`);
        }
    };

    await partHistory.runHistory({ throwOnFeatureError: true });
    assertEdgeSidewalls("[revolve restored sketch initial]");

    revolve.inputParams.angle = 180;
    await partHistory.runHistory({ throwOnFeatureError: true });
    assertEdgeSidewalls("[revolve restored sketch angle edit]");

    console.log("✓ Revolve keeps edge side wall faces after editing a consumed sketch profile");
    return partHistory;
}

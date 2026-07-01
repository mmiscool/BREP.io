import { Cone, Cube, Cylinder, Pyramid, Torus, primitiveHasNativeBuilder, Sphere } from "../BREP/primitives.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";
import {
    assertSolidVolume,
    expectedBoxVolume,
    expectedConeVolume,
    expectedCylinderVolume,
    expectedPyramidVolume,
    expectedSphereVolume,
    expectedTorusVolume,
    volumeTolerance,
} from "./solidVolumeTestUtils.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

function shouldSkip() {
    return manifoldBuildSource !== "local" || !primitiveHasNativeBuilder();
}

export async function test_cppPrimitive_cube_preserves_expected_face_labels() {
    if (shouldSkip()) return;

    const x = 2;
    const y = 3;
    const z = 4;
    const cube = new Cube({ x, y, z, name: "CPP_CUBE" });
    const expectedVolume = expectedBoxVolume(x, y, z);
    assertSolidVolume(cube, expectedVolume, volumeTolerance(expectedVolume), "native cube primitive");

    const faceNames = new Set(cube.getFaceNames());
    const expected = ["CPP_CUBE_NX", "CPP_CUBE_PX", "CPP_CUBE_NY", "CPP_CUBE_PY", "CPP_CUBE_NZ", "CPP_CUBE_PZ"];

    for (const faceName of expected) {
        assert(faceNames.has(faceName), `Expected native cube to expose face "${faceName}".`);
    }
    assert(faceNames.size === expected.length, `Expected ${expected.length} cube faces, got ${faceNames.size}.`);
}

export async function test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata() {
    if (shouldSkip()) return;

    const radius = 2;
    const height = 7;
    const resolution = 24;
    const cylinder = new Cylinder({ radius, height, resolution, name: "CPP_CYL" });
    const expectedVolume = expectedCylinderVolume(radius, height, resolution);
    assertSolidVolume(cylinder, expectedVolume, volumeTolerance(expectedVolume), "native cylinder primitive");

    const faceNames = new Set(cylinder.getFaceNames());
    assert(faceNames.has("CPP_CYL_B"), "Expected native cylinder to expose bottom face.");
    assert(faceNames.has("CPP_CYL_T"), "Expected native cylinder to expose top face.");
    assert(faceNames.has("CPP_CYL_S"), "Expected native cylinder to expose side face.");

    const metadata = cylinder.getFaceMetadata("CPP_CYL_S");
    assert(metadata?.type === "cylindrical", "Expected native cylinder side metadata to remain cylindrical.");
    assert(Math.abs((metadata?.radius || 0) - 2) <= 1e-9, "Expected native cylinder side metadata to preserve radius.");
    assert(Math.abs((metadata?.height || 0) - 7) <= 1e-9, "Expected native cylinder side metadata to preserve height.");

    const aux = Array.isArray(cylinder._auxEdges) ? cylinder._auxEdges : [];
    const axis = aux.find((entry) => entry?.name === "CPP_CYL_AXIS");
    assert(axis?.centerline === true, "Expected native cylinder primitive to create its axis centerline.");
    assert(Array.isArray(axis?.points) && axis.points.length === 2, "Expected native cylinder axis centerline to contain two points.");
    assert(Math.abs((axis.points[0]?.[1] || 0) - 0) <= 1e-9, "Expected native cylinder axis centerline to start at y=0.");
    assert(Math.abs((axis.points[1]?.[1] || 0) - 7) <= 1e-9, "Expected native cylinder axis centerline to end at y=height.");
}

export async function test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata() {
    if (shouldSkip()) return;

    const radiusTop = 1;
    const radiusBottom = 3;
    const height = 5;
    const resolution = 24;
    const cone = new Cone({ r1: radiusTop, r2: radiusBottom, h: height, resolution, name: "CPP_CONE" });
    const expectedVolume = expectedConeVolume(radiusTop, radiusBottom, height, resolution);
    assertSolidVolume(cone, expectedVolume, volumeTolerance(expectedVolume), "native cone primitive");

    const faceNames = new Set(cone.getFaceNames());
    assert(faceNames.has("CPP_CONE_B"), "Expected native cone to expose bottom face.");
    assert(faceNames.has("CPP_CONE_T"), "Expected native cone to expose top face.");
    assert(faceNames.has("CPP_CONE_S"), "Expected native cone to expose side face.");

    const metadata = cone.getFaceMetadata("CPP_CONE_S");
    assert(metadata?.type === "conical", "Expected native cone side metadata to remain conical.");
    assert(Math.abs((metadata?.radiusBottom || 0) - 3) <= 1e-9, "Expected native cone metadata to preserve bottom radius.");
    assert(Math.abs((metadata?.radiusTop || 0) - 1) <= 1e-9, "Expected native cone metadata to preserve top radius.");
    assert(Math.abs((metadata?.height || 0) - 5) <= 1e-9, "Expected native cone metadata to preserve height.");

    const aux = Array.isArray(cone._auxEdges) ? cone._auxEdges : [];
    const axis = aux.find((entry) => entry?.name === "CPP_CONE_AXIS");
    assert(axis?.centerline === true, "Expected native cone primitive to create its axis centerline.");
    assert(Array.isArray(axis?.points) && axis.points.length === 2, "Expected native cone axis centerline to contain two points.");
    assert(Math.abs((axis.points[0]?.[1] || 0) - 0) <= 1e-9, "Expected native cone axis centerline to start at y=0.");
    assert(Math.abs((axis.points[1]?.[1] || 0) - 5) <= 1e-9, "Expected native cone axis centerline to end at y=height.");
}

export async function test_cppPrimitive_torus_and_pyramid_preserve_face_labels() {
    if (shouldSkip()) return;

    const torusMajorRadius = 10;
    const torusTubeRadius = 2;
    const torusResolution = 24;
    const torusArc = 270;
    const torus = new Torus({
        mR: torusMajorRadius,
        tR: torusTubeRadius,
        resolution: torusResolution,
        arcDegrees: torusArc,
        name: "CPP_TORUS",
    });
    const expectedTorusPartialVolume = expectedTorusVolume(torusMajorRadius, torusTubeRadius, torusResolution, torusArc);
    assertSolidVolume(torus, expectedTorusPartialVolume, volumeTolerance(expectedTorusPartialVolume), "native partial torus primitive");

    const torusFaceNames = new Set(torus.getFaceNames());
    assert(torusFaceNames.has("CPP_TORUS_Side"), "Expected native torus to expose side face.");
    assert(torusFaceNames.has("CPP_TORUS_Cap0"), "Expected native partial torus to expose start cap.");
    assert(torusFaceNames.has("CPP_TORUS_Cap1"), "Expected native partial torus to expose end cap.");
    const torusMeta = torus.getFaceMetadata("CPP_TORUS_Side");
    if (torusMeta?.type) {
        assert(torusMeta.type === "toroidal", "Expected native torus side metadata to remain toroidal.");
        assert(Math.abs((torusMeta?.majorRadius || 0) - 10) <= 1e-9, "Expected native torus metadata to preserve major radius.");
        assert(Math.abs((torusMeta?.tubeRadius || 0) - 2) <= 1e-9, "Expected native torus metadata to preserve tube radius.");
    }
    const torusAux = Array.isArray(torus._auxEdges) ? torus._auxEdges : [];
    const torusAxis = torusAux.find((entry) => entry?.name === "CPP_TORUS_AXIS");
    const torusTubeCenterline = torusAux.find((entry) => entry?.name === "CPP_TORUS_TUBE_CENTERLINE");
    assert(torusAxis?.centerline === true, "Expected native torus primitive to create its axis centerline.");
    assert(Array.isArray(torusAxis?.points) && torusAxis.points.length === 2, "Expected native torus axis centerline to contain two points.");
    assert(torusTubeCenterline?.centerline === true, "Expected native torus primitive to create its tube centerline.");
    assert(torusTubeCenterline?.closedLoop === false, "Expected partial native torus tube centerline to be open.");
    assert(Array.isArray(torusTubeCenterline?.points) && torusTubeCenterline.points.length === 25, "Expected partial native torus tube centerline to include arc endpoints.");

    const fullTorusArc = 360;
    const fullTorus = new Torus({
        mR: torusMajorRadius,
        tR: torusTubeRadius,
        resolution: torusResolution,
        arcDegrees: fullTorusArc,
        name: "CPP_TORUS_FULL",
    });
    const expectedFullTorusVolume = expectedTorusVolume(torusMajorRadius, torusTubeRadius, torusResolution, fullTorusArc);
    assertSolidVolume(fullTorus, expectedFullTorusVolume, volumeTolerance(expectedFullTorusVolume), "native full torus primitive");

    const fullTorusFaceNames = new Set(fullTorus.getFaceNames());
    assert(fullTorusFaceNames.has("CPP_TORUS_FULL_Side"), "Expected closed native torus to expose side face.");
    assert(!fullTorusFaceNames.has("CPP_TORUS_FULL_Cap0"), "Did not expect start cap on closed native torus.");
    assert(!fullTorusFaceNames.has("CPP_TORUS_FULL_Cap1"), "Did not expect end cap on closed native torus.");
    const fullTorusAux = Array.isArray(fullTorus._auxEdges) ? fullTorus._auxEdges : [];
    const fullTorusTubeCenterline = fullTorusAux.find((entry) => entry?.name === "CPP_TORUS_FULL_TUBE_CENTERLINE");
    assert(fullTorusTubeCenterline?.centerline === true, "Expected full native torus primitive to create its tube centerline.");
    assert(fullTorusTubeCenterline?.closedLoop === true, "Expected full native torus tube centerline to be closed.");
    assert(Array.isArray(fullTorusTubeCenterline?.points) && fullTorusTubeCenterline.points.length === 24, "Expected full native torus tube centerline to match major resolution.");

    const baseSideLength = 6;
    const sides = 4;
    const height = 8;
    const pyramid = new Pyramid({ bL: baseSideLength, s: sides, h: height, name: "CPP_PYRAMID" });
    const pyramidVolume = expectedPyramidVolume(baseSideLength, sides, height);
    assertSolidVolume(pyramid, pyramidVolume, volumeTolerance(pyramidVolume), "native pyramid primitive");

    const pyramidFaceNames = new Set(pyramid.getFaceNames());
    assert(pyramidFaceNames.has("CPP_PYRAMID_Base"), "Expected native pyramid to expose base face.");
    for (let i = 0; i < 4; i++) {
        assert(pyramidFaceNames.has(`CPP_PYRAMID_S[${i}]`), `Expected native pyramid to expose side face ${i}.`);
    }
}

export async function test_cppPrimitive_sphere_preserves_single_face_label() {
    if (shouldSkip()) return;

    const radius = 5;
    const resolution = 16;
    const sphere = new Sphere({ r: radius, resolution, name: "CPP_SPHERE" });
    const expectedVolume = expectedSphereVolume(radius, resolution);
    assertSolidVolume(sphere, expectedVolume, volumeTolerance(expectedVolume), "native sphere primitive");

    const faceNames = sphere.getFaceNames();
    assert(faceNames.length === 1 && faceNames[0] === "CPP_SPHERE", "Expected native sphere to expose a single named face.");
    assert(sphere.getTriangleCount() > 0, "Expected native sphere to contain triangles.");
    const metadata = sphere.getFaceMetadata("CPP_SPHERE");
    if (metadata?.type) {
        assert(metadata.type === "spherical", "Expected native sphere metadata to remain spherical.");
        assert(Math.abs((metadata?.radius || 0) - 5) <= 1e-9, "Expected native sphere metadata to preserve radius.");
    }
}

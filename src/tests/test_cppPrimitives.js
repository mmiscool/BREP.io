import { LineGeometry } from "three/examples/jsm/Addons.js";
import { BREP } from "../BREP/BREP.js";
import { Cone, Cube, Cylinder, Pyramid, Torus, primitiveHasNativeBuilder, Sphere } from "../BREP/primitives.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

function shouldSkip() {
    return manifoldBuildSource !== "local" || !primitiveHasNativeBuilder();
}

export async function test_cppPrimitive_cube_preserves_expected_face_labels() {
    if (shouldSkip()) return;

    const cube = new Cube({ x: 2, y: 3, z: 4, name: "CPP_CUBE" });
    const faceNames = new Set(cube.getFaceNames());
    const expected = ["CPP_CUBE_NX", "CPP_CUBE_PX", "CPP_CUBE_NY", "CPP_CUBE_PY", "CPP_CUBE_NZ", "CPP_CUBE_PZ"];

    for (const faceName of expected) {
        assert(faceNames.has(faceName), `Expected native cube to expose face "${faceName}".`);
    }
    assert(faceNames.size === expected.length, `Expected ${expected.length} cube faces, got ${faceNames.size}.`);
}

export async function test_cppPrimitive_cylinder_preserves_expected_face_labels_and_metadata() {
    if (shouldSkip()) return;

    const cylinder = new Cylinder({ radius: 2, height: 7, resolution: 24, name: "CPP_CYL" });
    const faceNames = new Set(cylinder.getFaceNames());
    assert(faceNames.has("CPP_CYL_B"), "Expected native cylinder to expose bottom face.");
    assert(faceNames.has("CPP_CYL_T"), "Expected native cylinder to expose top face.");
    assert(faceNames.has("CPP_CYL_S"), "Expected native cylinder to expose side face.");

    const metadata = cylinder.getFaceMetadata("CPP_CYL_S");
    assert(metadata?.type === "cylindrical", "Expected native cylinder side metadata to remain cylindrical.");
    assert(Math.abs((metadata?.radius || 0) - 2) <= 1e-9, "Expected native cylinder side metadata to preserve radius.");
    assert(Math.abs((metadata?.height || 0) - 7) <= 1e-9, "Expected native cylinder side metadata to preserve height.");
}

export async function test_cppPrimitive_cylinder_sidewall_visualizes_cap_edges_and_seam() {
    if (shouldSkip()) return;

    const cylinder = new Cylinder({ radius: 2, height: 7, resolution: 24, name: "CPP_CYL_TOPO" });
    cylinder.visualize();

    const side = cylinder.children.find((child) => child?.type === "FACE" && child.name === "CPP_CYL_TOPO_S");
    assert(side, "Expected visualized cylinder side face.");
    assert(Array.isArray(side.edges), "Expected visualized cylinder side to carry topology edges.");
    assert(side.edges.length === 3, `Expected cylinder side to have 3 edges, got ${side.edges.length}.`);
    assert(side.edges.some((edge) => edge?.userData?.faceA === edge?.userData?.faceB), "Expected cylinder side seam self-edge.");
    assert(side.edges.filter((edge) => edge?.closedLoop).length === 2, "Expected cylinder side to have two circular cap edges.");
}

export async function test_cppExtrude_circle_profile_sidewall_visualizes_cap_edges_and_seam() {
    if (shouldSkip()) return;

    const radius = 2;
    const segments = 24;
    const loop = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        loop.push([radius * Math.cos(t), radius * Math.sin(t), 0]);
    }
    loop[loop.length - 1] = loop[0].slice();

    const positions = [];
    for (let i = 1; i + 1 < loop.length - 1; i += 1) {
        const a = loop[0];
        const b = loop[i];
        const c = loop[i + 1];
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }
    const geom = new BREP.THREE.BufferGeometry();
    geom.setAttribute("position", new BREP.THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    const face = new BREP.Face(geom);
    face.name = "SKETCH_CIRCLE:PROFILE";
    face.userData.faceName = face.name;
    face.userData.boundaryLoopsWorld = [{ pts: loop.slice(0, -1), isHole: false }];

    const line = new LineGeometry();
    line.setPositions(loop.flat());
    const edge = new BREP.Edge(line);
    edge.name = "SKETCH_CIRCLE:G1";
    edge.closedLoop = true;
    edge.userData = {
        polylineLocal: loop,
        polylineWorld: true,
        sketchGeomType: "circle",
        circleCenter: [0, 0, 0],
        circleRadius: radius,
    };
    face.edges = [edge];

    const extrude = new BREP.Sweep({
        face,
        distance: 5,
        mode: "translate",
        name: "EXTRUDE_CIRCLE",
        omitBaseCap: false,
    });
    extrude.visualize();

    const side = extrude.children.find((child) => child?.type === "FACE" && /_SW(?:_\d+)?$/.test(String(child.name || "")));
    assert(side, "Expected extruded circle sidewall face.");
    assert(side.edges.length === 3, `Expected extruded circle sidewall to have 3 edges, got ${side.edges.length}.`);
    assert(side.edges.some((edgeObj) => edgeObj?.userData?.faceA === edgeObj?.userData?.faceB), "Expected extruded circle sidewall seam self-edge.");
    assert(side.edges.filter((edgeObj) => edgeObj?.closedLoop).length === 2, "Expected extruded circle sidewall to have two circular cap edges.");
}

export async function test_cppExtrude_sketch_circle_hole_builds_distinct_analytic_sidewall() {
    if (shouldSkip()) return;

    const makeEdge = (name, curveType, points, extra = {}) => {
        const line = new LineGeometry();
        line.setPositions(points.flat());
        const edge = new BREP.Edge(line);
        edge.name = name;
        edge.userData = {
            polylineLocal: points,
            polylineWorld: true,
            sketchGeomType: curveType,
            sketchGeometryId: name,
            ...extra,
        };
        return edge;
    };

    const outer = [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]];
    const outerEdges = outer.map((point, index) => makeEdge(`L${index}`, "line", [point, outer[(index + 1) % outer.length]]));
    const radius = 1.5;
    const hole = [];
    for (let i = 0; i < 32; i += 1) {
        const t = (i / 32) * Math.PI * 2;
        hole.push([radius * Math.cos(t), radius * Math.sin(t), 0]);
    }
    const circle = makeEdge("C0", "circle", hole.concat([hole[0]]), {
        circleCenter: [0, 0, 0],
        circleRadius: radius,
        isHole: true,
    });

    const geom = new BREP.THREE.BufferGeometry();
    geom.setAttribute("position", new BREP.THREE.Float32BufferAttribute([
        -5, -5, 0, 5, -5, 0, 5, 5, 0,
        -5, -5, 0, 5, 5, 0, -5, 5, 0,
    ], 3));
    geom.computeVertexNormals();

    const face = new BREP.Face(geom);
    face.name = "SKETCH_HOLE:PROFILE";
    face.edges = [...outerEdges, circle];
    face.userData.boundaryLoopsWorld = [
        { pts: outer, isHole: false, segmentIds: ["L0", "L1", "L2", "L3"] },
        { pts: hole, isHole: true, segmentIds: ["C0"] },
    ];

    const extrude = new BREP.Sweep({ face, distance: 4, name: "EXTRUDE_HOLE" });
    extrude.visualize();

    const sideFaces = extrude.children.filter((child) => child?.type === "FACE" && /_SW(?:_\d+)?$/.test(String(child.name || "")));
    assert(sideFaces.length === 5, `Expected 4 outer sidewalls plus 1 circular hole sidewall, got ${sideFaces.length}.`);
    const circularSide = sideFaces.find((side) => side.edges.length === 3 && side.edges.some((edge) => edge?.userData?.faceA === edge?.userData?.faceB));
    assert(circularSide, "Expected circular hole sidewall to be a distinct analytic cylindrical face with cap edges and seam.");
}

export async function test_cppExtrude_sketch_bezier_edge_builds_single_sidewall() {
    if (shouldSkip()) return;

    const makeEdge = (name, curveType, points, extra = {}) => {
        const line = new LineGeometry();
        line.setPositions(points.flat());
        const edge = new BREP.Edge(line);
        edge.name = name;
        edge.userData = {
            polylineLocal: points,
            polylineWorld: true,
            sketchGeomType: curveType,
            sketchGeometryId: name,
            ...extra,
        };
        return edge;
    };

    const p0 = [-5, -4, 0];
    const p1 = [5, -4, 0];
    const p2 = [5, 4, 0];
    const b0 = [5, 4, 0];
    const b1 = [2, 7, 0];
    const b2 = [-2, 7, 0];
    const b3 = [-5, 4, 0];
    const p3 = [-5, 4, 0];

    const bezierSamples = [];
    for (let i = 0; i <= 32; i += 1) {
        const t = i / 32;
        const mt = 1 - t;
        bezierSamples.push([
            mt * mt * mt * b0[0] + 3 * mt * mt * t * b1[0] + 3 * mt * t * t * b2[0] + t * t * t * b3[0],
            mt * mt * mt * b0[1] + 3 * mt * mt * t * b1[1] + 3 * mt * t * t * b2[1] + t * t * t * b3[1],
            0,
        ]);
    }

    const edges = [
        makeEdge("L0", "line", [p0, p1]),
        makeEdge("L1", "line", [p1, p2]),
        makeEdge("B0", "bezier", bezierSamples, { bezierPoles: [b0, b1, b2, b3] }),
        makeEdge("L2", "line", [p3, p0]),
    ];

    const loop = [p0, p1, p2, ...bezierSamples.slice(1, -1), p3];
    const geom = new BREP.THREE.BufferGeometry();
    geom.setAttribute("position", new BREP.THREE.Float32BufferAttribute([
        -5, -4, 0, 5, -4, 0, 5, 4, 0,
        -5, -4, 0, 5, 4, 0, -5, 4, 0,
    ], 3));
    geom.computeVertexNormals();

    const face = new BREP.Face(geom);
    face.name = "SKETCH_BEZIER:PROFILE";
    face.edges = edges;
    face.userData.boundaryLoopsWorld = [
        { pts: loop, isHole: false, segmentIds: ["L0", "L1", "B0", "L2"] },
    ];

    const extrude = new BREP.Sweep({ face, distance: 4, name: "EXTRUDE_BEZIER" });
    extrude.visualize();

    const sideFaces = extrude.children.filter((child) => child?.type === "FACE" && /_SW(?:_\d+)?$/.test(String(child.name || "")));
    assert(sideFaces.length === 4, `Expected three line sidewalls plus one Bezier sidewall, got ${sideFaces.length}.`);
    const bezierSide = sideFaces.find((side) => side.name.endsWith("_SW_2"));
    assert(bezierSide, "Expected Bezier sidewall face.");
    assert(bezierSide.edges.length === 4, `Expected Bezier sidewall to have 4 topology edges, got ${bezierSide.edges.length}.`);
}

export async function test_cppRevolve_extruded_sketch_cap_reuses_analytic_profile() {
    if (shouldSkip()) return;

    const makeEdge = (name, curveType, points, extra = {}) => {
        const line = new LineGeometry();
        line.setPositions(points.flat());
        const edge = new BREP.Edge(line);
        edge.name = name;
        edge.userData = {
            polylineLocal: points,
            polylineWorld: true,
            sketchGeomType: curveType,
            sketchGeometryId: name,
            ...extra,
        };
        return edge;
    };

    const p0 = [-5, -4, 0];
    const p1 = [5, -4, 0];
    const p2 = [5, 4, 0];
    const b0 = [5, 4, 0];
    const b1 = [2, 7, 0];
    const b2 = [-2, 7, 0];
    const b3 = [-5, 4, 0];
    const p3 = [-5, 4, 0];
    const bezierSamples = [];
    for (let i = 0; i <= 32; i += 1) {
        const t = i / 32;
        const mt = 1 - t;
        bezierSamples.push([
            mt * mt * mt * b0[0] + 3 * mt * mt * t * b1[0] + 3 * mt * t * t * b2[0] + t * t * t * b3[0],
            mt * mt * mt * b0[1] + 3 * mt * mt * t * b1[1] + 3 * mt * t * t * b2[1] + t * t * t * b3[1],
            0,
        ]);
    }

    const radius = 1.2;
    const hole = [];
    for (let i = 0; i < 32; i += 1) {
        const t = (i / 32) * Math.PI * 2;
        hole.push([radius * Math.cos(t), radius * Math.sin(t), 0]);
    }

    const loop = [p0, p1, p2, ...bezierSamples.slice(1, -1), p3];
    const edges = [
        makeEdge("L0", "line", [p0, p1]),
        makeEdge("L1", "line", [p1, p2]),
        makeEdge("B0", "bezier", bezierSamples, { bezierPoles: [b0, b1, b2, b3] }),
        makeEdge("L2", "line", [p3, p0]),
        makeEdge("C0", "circle", hole.concat([hole[0]]), { circleCenter: [0, 0, 0], circleRadius: radius, isHole: true }),
    ];

    const geom = new BREP.THREE.BufferGeometry();
    geom.setAttribute("position", new BREP.THREE.Float32BufferAttribute([
        -5, -4, 0, 5, -4, 0, 5, 4, 0,
        -5, -4, 0, 5, 4, 0, -5, 4, 0,
    ], 3));
    geom.computeVertexNormals();

    const face = new BREP.Face(geom);
    face.name = "REVOLVE_SRC:PROFILE";
    face.edges = edges;
    face.userData.boundaryLoopsWorld = [
        { pts: loop, isHole: false, segmentIds: ["L0", "L1", "B0", "L2"] },
        { pts: hole, isHole: true, segmentIds: ["C0"] },
    ];

    const extrude = new BREP.Sweep({ face, distance: 4, name: "EXTRUDE_REVOLVE_SRC" });
    extrude.visualize();
    const startCap = extrude.children.find((child) => child?.type === "FACE" && child.name === "EXTRUDE_REVOLVE_SRC:REVOLVE_SRC:PROFILE_START");
    assert(startCap, "Expected extrude start cap to be selectable.");
    assert(Array.isArray(startCap.userData?.boundaryLoopsWorld) && startCap.userData.boundaryLoopsWorld.length === 2, "Expected extrude cap to preserve analytic boundary loops.");
    const storedTypes = (startCap.userData.sketchEdgeInputsWorld || []).map((entry) => entry.curveType).sort();
    assert(storedTypes.includes("bezier") && storedTypes.includes("circle"), "Expected extrude cap to preserve Bezier and circle edge inputs.");

    const axis = startCap.edges.find((edge) => edge?.name && String(edge.name).includes("L1")) || startCap.edges[0];
    const revolve = new BREP.Revolve({ face: startCap, axis, angle: 103, name: "REVOLVE_FROM_EXTRUDE_CAP" });
    revolve.visualize();
    const sideNames = revolve.getFaceNames().filter((name) => String(name || "").endsWith("_RV"));
    assert(sideNames.length >= 3, `Expected revolve to create multiple sidewall face labels, got ${sideNames.length}.`);
    const capMeta = revolve.getFaceMetadata("EXTRUDE_REVOLVE_SRC:REVOLVE_SRC:PROFILE_START_START");
    assert(Array.isArray(capMeta?.boundaryLoopsWorld) && capMeta.boundaryLoopsWorld.length === 2, "Expected revolve cap to retain analytic loops.");
    const revolvedTypes = (capMeta.sketchEdgeInputsWorld || []).map((entry) => entry.curveType).sort();
    assert(revolvedTypes.includes("bezier") && revolvedTypes.includes("circle"), "Expected revolve to reuse analytic Bezier and circle inputs.");
}

export async function test_cppPrimitive_cone_preserves_expected_face_labels_and_metadata() {
    if (shouldSkip()) return;

    const cone = new Cone({ r1: 1, r2: 3, h: 5, resolution: 24, name: "CPP_CONE" });
    const faceNames = new Set(cone.getFaceNames());
    assert(faceNames.has("CPP_CONE_B"), "Expected native cone to expose bottom face.");
    assert(faceNames.has("CPP_CONE_T"), "Expected native cone to expose top face.");
    assert(faceNames.has("CPP_CONE_S"), "Expected native cone to expose side face.");

    const metadata = cone.getFaceMetadata("CPP_CONE_S");
    assert(metadata?.type === "conical", "Expected native cone side metadata to remain conical.");
    assert(Math.abs((metadata?.radiusBottom || 0) - 3) <= 1e-9, "Expected native cone metadata to preserve bottom radius.");
    assert(Math.abs((metadata?.radiusTop || 0) - 1) <= 1e-9, "Expected native cone metadata to preserve top radius.");
    assert(Math.abs((metadata?.height || 0) - 5) <= 1e-9, "Expected native cone metadata to preserve height.");
}

export async function test_cppPrimitive_torus_and_pyramid_preserve_face_labels() {
    if (shouldSkip()) return;

    const torus = new Torus({ mR: 10, tR: 2, resolution: 24, arcDegrees: 270, name: "CPP_TORUS" });
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

    const fullTorus = new Torus({ mR: 10, tR: 2, resolution: 24, arcDegrees: 360, name: "CPP_TORUS_FULL" });
    const fullTorusFaceNames = new Set(fullTorus.getFaceNames());
    assert(fullTorusFaceNames.has("CPP_TORUS_FULL_Side"), "Expected closed native torus to expose side face.");
    assert(!fullTorusFaceNames.has("CPP_TORUS_FULL_Cap0"), "Did not expect start cap on closed native torus.");
    assert(!fullTorusFaceNames.has("CPP_TORUS_FULL_Cap1"), "Did not expect end cap on closed native torus.");

    const pyramid = new Pyramid({ bL: 6, s: 4, h: 8, name: "CPP_PYRAMID" });
    const pyramidFaceNames = new Set(pyramid.getFaceNames());
    assert(pyramidFaceNames.has("CPP_PYRAMID_Base"), "Expected native pyramid to expose base face.");
    for (let i = 0; i < 4; i++) {
        assert(pyramidFaceNames.has(`CPP_PYRAMID_S[${i}]`), `Expected native pyramid to expose side face ${i}.`);
    }
}

export async function test_cppPrimitive_sphere_preserves_single_face_label() {
    if (shouldSkip()) return;

    const sphere = new Sphere({ r: 5, resolution: 16, name: "CPP_SPHERE" });
    const faceNames = sphere.getFaceNames();
    assert(faceNames.length === 1 && faceNames[0] === "CPP_SPHERE", "Expected native sphere to expose a single named face.");
    assert(sphere.getTriangleCount() > 0, "Expected native sphere to contain triangles.");
    const metadata = sphere.getFaceMetadata("CPP_SPHERE");
    if (metadata?.type) {
        assert(metadata.type === "spherical", "Expected native sphere metadata to remain spherical.");
        assert(Math.abs((metadata?.radius || 0) - 5) <= 1e-9, "Expected native sphere metadata to preserve radius.");
    }
}

import { Tube } from "../BREP/Tube.js";

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

export async function test_cppTube_open_tube_preserves_expected_face_labels() {
    const tube = new Tube({
        points: [[0, 0, 0], [0, 20, 0], [10, 20, 0]],
        radius: 2,
        closed: false,
        name: "CPP_TUBE_OPEN",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_OPEN_Outer"), "Expected open native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapStart"), "Expected open native tube to expose CapStart face.");
    assert(faceNames.has("CPP_TUBE_OPEN_CapEnd"), "Expected open native tube to expose CapEnd face.");
    assert(!faceNames.has("CPP_TUBE_OPEN_Inner"), "Did not expect Inner face for solid native tube.");
    assert(tube.getTriangleCount() > 0, "Expected open native tube to contain triangles.");
}

export async function test_cppTube_closed_hollow_tube_preserves_expected_face_labels() {
    const tube = new Tube({
        points: [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 0]],
        radius: 3,
        innerRadius: 1,
        closed: true,
        name: "CPP_TUBE_CLOSED",
    });

    const faceNames = new Set(tube.getFaceNames());
    assert(faceNames.has("CPP_TUBE_CLOSED_Outer"), "Expected closed native tube to expose Outer face.");
    assert(faceNames.has("CPP_TUBE_CLOSED_Inner"), "Expected closed hollow native tube to expose Inner face.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapStart"), "Did not expect CapStart face for closed native tube.");
    assert(!faceNames.has("CPP_TUBE_CLOSED_CapEnd"), "Did not expect CapEnd face for closed native tube.");
    assert(Array.isArray(tube._auxEdges) && tube._auxEdges.length === 1, "Expected native tube to keep the centerline aux edge.");
    assert(tube._auxEdges[0]?.closedLoop === true, "Expected closed native tube centerline aux edge to be marked closed.");
    assert(tube.getTriangleCount() > 0, "Expected closed native tube to contain triangles.");
}

export async function test_cppTube_hollow_tube_visualizes_distinct_inner_and_outer_faces() {
    const tube = new Tube({
        points: [[0, 0, 0], [0, 20, 0], [10, 20, 0]],
        radius: 3,
        innerRadius: 1,
        closed: false,
        name: "CPP_TUBE_HOLLOW_DISTINCT",
    });

    tube.visualize({ showEdges: true });
    const faceMeshes = tube.children.filter((child) => child?.type === "FACE");
    const faceNames = new Set(faceMeshes.map((child) => child.name));
    assert(faceNames.has("CPP_TUBE_HOLLOW_DISTINCT_Outer"), "Expected hollow tube to visualize an Outer sidewall face.");
    assert(faceNames.has("CPP_TUBE_HOLLOW_DISTINCT_Inner"), "Expected hollow tube to visualize an Inner sidewall face.");
}

export async function test_cppTube_union_preserves_distinct_face_labels_across_native_snapshots() {
    const tubeA = new Tube({
        points: [[0, 0, 0], [0, 12, 0]],
        radius: 1.5,
        closed: false,
        name: "CPP_TUBE_UNION_A",
    });
    const tubeB = new Tube({
        points: [[20, 0, 0], [20, 12, 0]],
        radius: 1.5,
        closed: false,
        name: "CPP_TUBE_UNION_B",
    });

    const unioned = tubeA.union(tubeB);
    const faceNames = new Set(unioned.getFaceNames());
    assert(faceNames.has("CPP_TUBE_UNION_A_Outer"), "Expected unioned native tubes to preserve tube A Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_A_CapStart"), "Expected unioned native tubes to preserve tube A CapStart face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_Outer"), "Expected unioned native tubes to preserve tube B Outer face.");
    assert(faceNames.has("CPP_TUBE_UNION_B_CapEnd"), "Expected unioned native tubes to preserve tube B CapEnd face.");
}

export async function test_cppTube_hollow_spline_path_visualizes_side_faces() {
    const pathCurve = {
        type: "hermite-extension-spline",
        bendRadius: 1,
        spline: {
            points: [
                { id: "p0", position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], forwardDistance: 10, backwardDistance: 1, flipDirection: false },
                { id: "p1", position: [20, 10, 0], rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1], forwardDistance: 10, backwardDistance: 10, flipDirection: false },
                { id: "p2", position: [40, 0, 10], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], forwardDistance: 1, backwardDistance: 10, flipDirection: false },
            ],
        },
    };
    const tube = new Tube({
        points: [[0, 0, 0], [10, 0, 0], [20, 10, 0], [20, 0, 0], [30, 0, 5], [40, 0, 10]],
        radius: 1,
        innerRadius: 0.8,
        name: "CPP_TUBE_SPLINE",
        pathCurve,
    });

    tube.visualize({ showEdges: true });
    const faceMeshes = tube.children.filter((child) => child?.type === "FACE");
    const sideFace = faceMeshes.find((child) => (child?.geometry?.index?.count || 0) > 300);
    assert(faceMeshes.length >= 3, "Expected hollow spline tube to visualize cap and side face meshes.");
    assert(sideFace, "Expected hollow spline tube to visualize a side face mesh, not just end rings.");
    assert(sideFace.material?.side === 2, "Expected OpenCascade tube side face to render double-sided.");
}

export async function test_cppTube_spline_solid_has_three_faces_and_no_cross_section_edges() {
    const points = [];
    for (let i = 0; i < 35; i++) {
        const t = i / 34;
        points.push([
            Math.sin(t * Math.PI * 3) * 8,
            t * 80,
            Math.cos(t * Math.PI * 1.5) * 2,
        ]);
    }
    const tube = new Tube({
        points,
        radius: 1,
        innerRadius: 0,
        name: "CPP_TUBE_SPLINE_SOLID",
        pathCurve: {
            type: "hermite-extension-spline",
            spline: { points: [{ position: points[0] }, { position: points[points.length - 1] }] },
        },
    });

    tube.visualize({ showEdges: true });
    const faceNames = tube.getFaceNames();
    assert(faceNames.length === 3, `Expected non-hollow spline tube to have exactly 3 faces, got ${faceNames.join(", ")}.`);
    assert(faceNames.includes("CPP_TUBE_SPLINE_SOLID_Outer"), "Expected solid spline tube outer face.");
    assert(faceNames.includes("CPP_TUBE_SPLINE_SOLID_CapStart"), "Expected solid spline tube start cap.");
    assert(faceNames.includes("CPP_TUBE_SPLINE_SOLID_CapEnd"), "Expected solid spline tube end cap.");

    const faceMeshes = tube.children.filter((child) => child?.type === "FACE");
    assert(faceMeshes.length === 3, `Expected exactly 3 visible face meshes, got ${faceMeshes.length}.`);
    const crossSectionEdges = tube.children.filter((child) => child?.type === "EDGE" && String(child.name || "").includes("_Outer|CPP_TUBE_SPLINE_SOLID_Outer"));
    assert(crossSectionEdges.length === 0, "Did not expect same-face cross-section edges on a smooth spline tube.");

    const startCap = faceMeshes.find((child) => child.name === "CPP_TUBE_SPLINE_SOLID_CapStart");
    const tangent = [
        points[1][0] - points[0][0],
        points[1][1] - points[0][1],
        points[1][2] - points[0][2],
    ];
    const tangentLength = Math.hypot(...tangent);
    const normal = startCap?.getAverageNormal?.();
    const dot = Math.abs(
        ((normal?.x || 0) * tangent[0] + (normal?.y || 0) * tangent[1] + (normal?.z || 0) * tangent[2]) / tangentLength,
    );
    assert(dot > 0.85, `Expected start cap normal to align with path tangent; dot=${dot}.`);
}

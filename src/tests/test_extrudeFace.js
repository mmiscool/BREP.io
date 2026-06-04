export async function test_ExtrudeFace(partHistory) {
    const cone = await partHistory.newFeature("P.CO");
    cone.inputParams.radiusTop = 3;
    cone.inputParams.radiusBottom = .5;
    cone.inputParams.height = 5.2;
    cone.inputParams.resolution = 20;


    const extrude = await partHistory.newFeature("E");
    extrude.inputParams.profile = `${cone.inputParams.featureID}_T`;
    // Use back distance instead of negative distance
    extrude.inputParams.distance = 0;
    extrude.inputParams.distanceBack = 5;

    // Use internal boolean on the extrude feature to union with the cone
    extrude.inputParams.boolean = {
        targets: [cone.inputParams.featureID],
        operation: "UNION",
    };

    // No separate boolean feature; handled internally by the extrude

    return partHistory;
}

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

export async function test_extrude_solid_face_uses_boundary_edge_sidewalls(partHistory) {
    const cube = await partHistory.newFeature("P.CU");
    cube.inputParams.id = "FACE_EDGE_SRC";
    cube.inputParams.sizeX = 12;
    cube.inputParams.sizeY = 8;
    cube.inputParams.sizeZ = 10;

    const extrude = await partHistory.newFeature("E");
    extrude.inputParams.id = "FACE_EDGE_EXTRUDE";
    extrude.inputParams.profile = "FACE_EDGE_SRC_PY";
    extrude.inputParams.consumeProfileSketch = true;
    extrude.inputParams.distance = 4;
    extrude.inputParams.distanceBack = 0;
    extrude.inputParams.boolean = {
        targets: [],
        operation: "NONE",
    };

    return partHistory;
}

export async function afterRun_extrude_solid_face_uses_boundary_edge_sidewalls(partHistory) {
    const solid = (partHistory?.scene?.children || [])
        .find((obj) => obj?.type === "SOLID" && obj.name === "FACE_EDGE_EXTRUDE");
    assert(solid && typeof solid.getFaceNames === "function", "[extrude-face-sidewalls] Expected extrude result solid.");

    const faceNames = solid.getFaceNames().map((name) => String(name || ""));
    const sidewalls = faceNames.filter((name) => name.startsWith("FACE_EDGE_EXTRUDE:") && name.endsWith("_SW"));
    assert(sidewalls.length === 4, `[extrude-face-sidewalls] Expected 4 boundary-edge sidewalls, found ${sidewalls.length}: ${sidewalls.join(", ")}`);
    assert(!faceNames.includes("FACE_EDGE_EXTRUDE:FACE_EDGE_SRC_PY_SW"), "[extrude-face-sidewalls] Solid face extrusion should not collapse all boundary edges into the default sidewall.");
}

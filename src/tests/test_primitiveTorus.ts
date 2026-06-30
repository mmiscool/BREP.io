function getSolidByName(partHistory, name) {
    const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
    return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

function distance3(a, b) {
    return Math.hypot(
        Number(a?.[0]) - Number(b?.[0]),
        Number(a?.[1]) - Number(b?.[1]),
        Number(a?.[2]) - Number(b?.[2]),
    );
}

export async function test_primitiveTorus(partHistory) {
    const torus = await partHistory.newFeature("P.T");
    torus.inputParams.id = "P.T_TORUS_PARTIAL";
    torus.inputParams.majorRadius = 20;
    torus.inputParams.tubeRadius = 5;
    torus.inputParams.resolution = 10;
    torus.inputParams.arc =  300;


    const torus2 = await partHistory.newFeature("P.T");
    torus2.inputParams.id = "P.T_TORUS_FULL";
    torus2.inputParams.majorRadius = 5;
    torus2.inputParams.tubeRadius = 3;
    torus2.inputParams.resolution = 30;
    torus2.inputParams.arc =  360;

    
    return partHistory;
}

export async function afterRun_primitiveTorus(partHistory) {
    const partial = getSolidByName(partHistory, "P.T_TORUS_PARTIAL");
    assert(partial, "Expected partial primitive torus solid to exist.");
    const partialAux = Array.isArray(partial._auxEdges) ? partial._auxEdges : [];
    const partialAxis = partialAux.find((entry) => entry?.name === "P.T_TORUS_PARTIAL_AXIS");
    const partialTube = partialAux.find((entry) => entry?.name === "P.T_TORUS_PARTIAL_TUBE_CENTERLINE");
    assert(partialAxis?.centerline === true, "Expected partial torus axis centerline.");
    assert(Array.isArray(partialAxis?.points) && partialAxis.points.length === 2, "Expected partial torus axis centerline to contain two points.");
    assert(Math.abs(distance3(partialAxis.points[0], partialAxis.points[1]) - 15) <= 1e-9, "Expected partial torus axis centerline length to equal tube diameter times 1.5.");
    assert(partialTube?.centerline === true, "Expected partial torus tube centerline.");
    assert(partialTube?.closedLoop === false, "Expected partial torus tube centerline to be open.");
    assert(Array.isArray(partialTube?.points) && partialTube.points.length === 11, "Expected partial torus tube centerline to include arc endpoints.");

    const full = getSolidByName(partHistory, "P.T_TORUS_FULL");
    assert(full, "Expected full primitive torus solid to exist.");
    const fullAux = Array.isArray(full._auxEdges) ? full._auxEdges : [];
    const fullTube = fullAux.find((entry) => entry?.name === "P.T_TORUS_FULL_TUBE_CENTERLINE");
    assert(fullTube?.centerline === true, "Expected full torus tube centerline.");
    assert(fullTube?.closedLoop === true, "Expected full torus tube centerline to be closed.");
    assert(Array.isArray(fullTube?.points) && fullTube.points.length === 30, "Expected full torus tube centerline to match major resolution.");
}

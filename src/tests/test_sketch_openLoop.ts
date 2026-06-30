export async function test_sketch_openLoop(partHistory) {
    const plane = await partHistory.newFeature("P");
    plane.inputParams.orientation = "XY";

    const sketch = await partHistory.newFeature("S");
    sketch.inputParams.sketchPlane = plane.inputParams.featureID;
    sketch.persistentData.sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 20, y: 0, fixed: false },
            { id: 2, x: 20, y: 15, fixed: false },
        ],
        geometries: [
            { id: 100, type: "line", points: [0, 1], construction: false },
            { id: 101, type: "line", points: [1, 2], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
        ],
    };
}

export async function afterRun_sketch_openLoop(partHistory) {
    const sketchFeature = partHistory.features.find((f) => f?.type === "S");
    if (!sketchFeature) {
        throw new Error("Sketch feature missing from history");
    }
    const sketchGroup = partHistory.scene.getObjectByName(sketchFeature.inputParams.featureID);
    if (!sketchGroup) {
        throw new Error("Sketch group not found in scene");
    }
    let faceCount = 0;
    let edgeCount = 0;
    let missingClickHandler = 0;
    let missingLineDistances = 0;
    sketchGroup.traverse((obj) => {
        if (!obj) return;
        if (obj.type === "FACE") faceCount++;
        else if (obj.type === "EDGE") {
            edgeCount++;
            if (typeof obj.onClick !== "function") missingClickHandler++;
            const hasDistances = !!(
                obj.geometry?.attributes?.instanceDistanceStart
                && obj.geometry?.attributes?.instanceDistanceEnd
            );
            if (!hasDistances) missingLineDistances++;
        }
    });
    if (faceCount !== 0) {
        throw new Error(`Open sketch generated ${faceCount} face(s)`);
    }
    if (edgeCount === 0) {
        throw new Error("Open sketch should expose at least one EDGE");
    }
    if (missingClickHandler !== 0) {
        throw new Error(`Open sketch has ${missingClickHandler} EDGE object(s) without an immediate click handler`);
    }
    if (missingLineDistances !== 0) {
        throw new Error(`Open sketch has ${missingLineDistances} EDGE object(s) without Line2 distance attributes`);
    }
}

export async function test_sketch_snapshot_restore_selection_handlers(partHistory) {
    const plane = await partHistory.newFeature("P");
    plane.inputParams.orientation = "XY";

    const sketch = await partHistory.newFeature("S");
    sketch.inputParams.sketchPlane = plane.inputParams.featureID;
    sketch.persistentData.sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 20, y: 0, fixed: false },
            { id: 2, x: 20, y: 15, fixed: false },
            { id: 3, x: 0, y: 15, fixed: false },
        ],
        geometries: [
            { id: 100, type: "line", points: [0, 1], construction: false },
            { id: 101, type: "line", points: [1, 2], construction: false },
            { id: 102, type: "line", points: [2, 3], construction: false },
            { id: 103, type: "line", points: [3, 0], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
        ],
    };
}

export async function afterRun_sketch_snapshot_restore_selection_handlers(partHistory) {
    const sketchFeature = partHistory.features.find((f) => f?.type === "S");
    if (!sketchFeature) {
        throw new Error("Sketch feature missing from history");
    }

    sketchFeature.dirty = false;
    partHistory.currentHistoryStepId = null;
    await partHistory.runHistory();

    const sketchGroup = partHistory.scene.getObjectByName(sketchFeature.inputParams.featureID);
    if (!sketchGroup) {
        throw new Error("Restored sketch group not found in scene");
    }

    let faceCount = 0;
    let edgeCount = 0;
    const missingHandlers = [];
    sketchGroup.traverse((obj) => {
        if (!obj) return;
        if (obj.type === "FACE") {
            faceCount++;
            if (typeof obj.onClick !== "function") missingHandlers.push(obj.name || "FACE");
        } else if (obj.type === "EDGE") {
            edgeCount++;
            if (typeof obj.onClick !== "function") missingHandlers.push(obj.name || "EDGE");
        }
    });

    if (faceCount !== 1) {
        throw new Error(`Closed sketch should restore one FACE, found ${faceCount}`);
    }
    if (edgeCount !== 4) {
        throw new Error(`Closed sketch should restore four EDGE objects, found ${edgeCount}`);
    }
    if (missingHandlers.length) {
        throw new Error(`Restored sketch objects missing click handlers: ${missingHandlers.join(", ")}`);
    }
}

function makeCenteredRingSketch() {
  return {
    points: [
      { id: 10, x: -5, y: -5, fixed: false },
      { id: 11, x: 5, y: -5, fixed: false },
      { id: 12, x: 5, y: 5, fixed: false },
      { id: 13, x: -5, y: 5, fixed: false },
      { id: 20, x: -3, y: -3, fixed: false },
      { id: 21, x: 3, y: -3, fixed: false },
      { id: 22, x: 3, y: 3, fixed: false },
      { id: 23, x: -3, y: 3, fixed: false },
    ],
    geometries: [
      { id: 200, type: "line", points: [10, 11], construction: false },
      { id: 201, type: "line", points: [11, 12], construction: false },
      { id: 202, type: "line", points: [12, 13], construction: false },
      { id: 203, type: "line", points: [13, 10], construction: false },
      { id: 210, type: "line", points: [20, 21], construction: false },
      { id: 211, type: "line", points: [21, 22], construction: false },
      { id: 212, type: "line", points: [22, 23], construction: false },
      { id: 213, type: "line", points: [23, 20], construction: false },
    ],
    constraints: [],
  };
}

function nearestMirrorError(vertices, axis) {
  let max = 0;
  let sum = 0;
  const verts = Array.isArray(vertices) ? vertices : [];
  for (const vertex of verts) {
    const target = axis === "x"
      ? [-vertex[0], vertex[1], vertex[2]]
      : [vertex[0], -vertex[1], vertex[2]];
    let best = Infinity;
    for (const candidate of verts) {
      const distance = Math.hypot(
        candidate[0] - target[0],
        candidate[1] - target[1],
        candidate[2] - target[2],
      );
      if (distance < best) best = distance;
    }
    if (best > max) max = best;
    sum += best;
  }
  return {
    max,
    mean: verts.length ? (sum / verts.length) : 0,
  };
}

export async function test_smooth_with_subdivision_replaces_source_solid(partHistory) {
  const base = await partHistory.newFeature("P.CY");
  base.inputParams.id = "SMOOTH_SRC";
  base.inputParams.radius = 5;
  base.inputParams.height = 12;
  base.inputParams.resolution = 16;
  const smooth = await partHistory.newFeature("SWS");
  smooth.inputParams.targetSolid = base.inputParams.featureID;
  smooth.inputParams.subdivisionLoops = 1;
  return partHistory;
}

export async function afterRun_smooth_with_subdivision_replaces_source_solid(partHistory) {
  const smoothFeature = (partHistory.features || []).find((entry) => String(entry?.type || "").toUpperCase() === "SWS");
  if (!smoothFeature) throw new Error("[smooth with subdivision] Feature entry was not created.");

  const stats = smoothFeature.persistentData || {};
  if (!(Number(stats.sourceTriangleCount) > 0)) {
    throw new Error("[smooth with subdivision] Source triangle count was not captured.");
  }
  if (!(Number(stats.outputTriangleCount) > Number(stats.sourceTriangleCount))) {
    throw new Error("[smooth with subdivision] Expected subdivision to increase triangle count.");
  }

  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  if (solids.length !== 1) {
    throw new Error(`[smooth with subdivision] Expected one replacement solid, found ${solids.length}.`);
  }

  const outputSolid = solids[0];
  const marker = outputSolid?.userData?.smoothWithSubdivision || null;
  if (!marker) {
    throw new Error("[smooth with subdivision] Output solid is missing feature metadata.");
  }
  if (Number(marker.subdivisionLoops) !== 1) {
    throw new Error("[smooth with subdivision] Output solid metadata has the wrong subdivision loop count.");
  }
  if (!(Number(marker.outputTriangleCount) > Number(marker.sourceTriangleCount))) {
    throw new Error("[smooth with subdivision] Output solid metadata did not record increased triangle count.");
  }

  const expectedFaceNames = new Set(["SMOOTH_SRC_B", "SMOOTH_SRC_T", "SMOOTH_SRC_S"]);
  const outputFaceNames = new Set(
    (typeof outputSolid.getFaceNames === "function" ? outputSolid.getFaceNames() : [])
      .map((name) => String(name || "").trim())
      .filter((name) => name.length > 0),
  );
  if (outputFaceNames.size !== expectedFaceNames.size) {
    throw new Error(
      `[smooth with subdivision] Expected ${expectedFaceNames.size} retained face names, found ${outputFaceNames.size}.`,
    );
  }
  for (const faceName of expectedFaceNames) {
    if (!outputFaceNames.has(faceName)) {
      throw new Error(`[smooth with subdivision] Missing retained face name "${faceName}".`);
    }
  }

  const sideMeta = typeof outputSolid.getFaceMetadata === "function"
    ? outputSolid.getFaceMetadata("SMOOTH_SRC_S")
    : null;
  if (!sideMeta || sideMeta.type !== "cylindrical") {
    throw new Error("[smooth with subdivision] Cylindrical side face metadata was not preserved.");
  }
  if (Number(sideMeta.radius) !== 5 || Number(sideMeta.height) !== 12) {
    throw new Error("[smooth with subdivision] Cylindrical side face metadata has the wrong dimensions.");
  }
}

export async function test_smooth_with_subdivision_preserves_centered_ring_symmetry(partHistory) {
  const plane = await partHistory.newFeature("P");
  plane.inputParams.orientation = "XY";

  const sketch = await partHistory.newFeature("S");
  sketch.inputParams.sketchPlane = plane.inputParams.featureID;
  sketch.persistentData.sketch = makeCenteredRingSketch();

  const extrude = await partHistory.newFeature("E");
  extrude.inputParams.profile = sketch.inputParams.featureID;
  extrude.inputParams.consumeProfileSketch = false;
  extrude.inputParams.distance = 6;

  const smooth = await partHistory.newFeature("SWS");
  smooth.inputParams.targetSolid = extrude.inputParams.featureID;
  smooth.inputParams.subdivisionLoops = 1;

  return partHistory;
}

export async function afterRun_smooth_with_subdivision_preserves_centered_ring_symmetry(partHistory) {
  const extrudeEntry = (partHistory.features || []).find((entry) => entry?.type === "E");
  if (!extrudeEntry?.inputParams?.featureID) {
    throw new Error("[smooth with subdivision symmetry] Missing extrude feature.");
  }

  const outputSolid = partHistory.scene.getObjectByName(extrudeEntry.inputParams.featureID);
  if (!outputSolid || typeof outputSolid.getMesh !== "function") {
    throw new Error("[smooth with subdivision symmetry] Smoothed solid missing from scene.");
  }

  const mesh = outputSolid.getMesh();
  const vertices = [];
  try {
    for (let i = 0; i < mesh.vertProperties.length; i += 3) {
      vertices.push([
        mesh.vertProperties[i + 0],
        mesh.vertProperties[i + 1],
        mesh.vertProperties[i + 2],
      ]);
    }
  } finally {
    try { mesh?.delete?.(); } catch { /* ignore mesh cleanup failure */ }
  }

  const mirrorX = nearestMirrorError(vertices, "x");
  const mirrorY = nearestMirrorError(vertices, "y");
  const tolerance = 1e-5;
  if (mirrorX.max > tolerance || mirrorY.max > tolerance) {
    throw new Error(
      `[smooth with subdivision symmetry] Expected centered ring symmetry. `
      + `mirrorX.max=${mirrorX.max}, mirrorY.max=${mirrorY.max}`,
    );
  }
}

export async function test_smooth_with_subdivision_preserves_mirrored_union_symmetry(partHistory) {
  const sketchPlane = await partHistory.newFeature("P");
  sketchPlane.inputParams.orientation = "XY";

  const sketch = await partHistory.newFeature("S");
  sketch.inputParams.sketchPlane = sketchPlane.inputParams.featureID;
  sketch.persistentData.sketch = makeCenteredRingSketch();

  const extrude = await partHistory.newFeature("E");
  extrude.inputParams.profile = sketch.inputParams.featureID;
  extrude.inputParams.consumeProfileSketch = false;
  extrude.inputParams.distance = 6;

  const cutter = await partHistory.newFeature("P.CU");
  cutter.inputParams.sizeX = 20;
  cutter.inputParams.sizeY = 20;
  cutter.inputParams.sizeZ = 20;
  cutter.inputParams.transform = {
    position: [-20, -10, -10],
    rotationEuler: [0, 0, 0],
    scale: [1, 1, 1],
  };

  const cut = await partHistory.newFeature("B");
  cut.inputParams.targetSolid = extrude.inputParams.featureID;
  cut.inputParams.boolean = {
    operation: "SUBTRACT",
    targets: [cutter.inputParams.featureID],
  };

  const mirrorPlane = await partHistory.newFeature("P");
  mirrorPlane.inputParams.orientation = "YZ";

  const mirror = await partHistory.newFeature("M");
  mirror.inputParams.solids = [extrude.inputParams.featureID];
  mirror.inputParams.mirrorPlane = mirrorPlane.inputParams.featureID;

  const union = await partHistory.newFeature("B");
  union.inputParams.targetSolid = extrude.inputParams.featureID;
  union.inputParams.boolean = {
    operation: "UNION",
    targets: [`${mirror.inputParams.featureID}:${extrude.inputParams.featureID}:M`],
  };

  const smooth = await partHistory.newFeature("SWS");
  smooth.inputParams.targetSolid = extrude.inputParams.featureID;
  smooth.inputParams.subdivisionLoops = 1;

  return partHistory;
}

export async function afterRun_smooth_with_subdivision_preserves_mirrored_union_symmetry(partHistory) {
  const extrudeEntry = (partHistory.features || []).find((entry) => entry?.type === "E");
  if (!extrudeEntry?.inputParams?.featureID) {
    throw new Error("[smooth with subdivision mirrored symmetry] Missing extrude feature.");
  }

  const outputSolid = partHistory.scene.getObjectByName(extrudeEntry.inputParams.featureID);
  if (!outputSolid || typeof outputSolid.getMesh !== "function") {
    throw new Error("[smooth with subdivision mirrored symmetry] Smoothed mirrored-union solid missing.");
  }

  const mesh = outputSolid.getMesh();
  const vertices = [];
  try {
    for (let i = 0; i < mesh.vertProperties.length; i += 3) {
      vertices.push([
        mesh.vertProperties[i + 0],
        mesh.vertProperties[i + 1],
        mesh.vertProperties[i + 2],
      ]);
    }
  } finally {
    try { mesh?.delete?.(); } catch { /* ignore mesh cleanup failure */ }
  }

  const mirrorX = nearestMirrorError(vertices, "x");
  const tolerance = 1e-5;
  if (mirrorX.max > tolerance) {
    throw new Error(
      `[smooth with subdivision mirrored symmetry] Expected mirrored-union symmetry. `
      + `mirrorX.max=${mirrorX.max}`,
    );
  }
}

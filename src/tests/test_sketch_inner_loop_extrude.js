function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

function pointInPoly(point, poly) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const pi = poly[i];
    const pj = poly[j];
    const crosses = ((pi[1] > y) !== (pj[1] > y))
      && (x < ((pj[0] - pi[0]) * (y - pi[1])) / ((pj[1] - pi[1]) || 1e-30) + pi[0]);
    if (crosses) inside = !inside;
  }
  return inside;
}

const reproSketch = {
  points: [
    { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
    { id: 1, x: -24.244146, y: -23.69515, fixed: false, construction: false, externalReference: false },
    { id: 2, x: 0, y: 0, fixed: true, construction: false, externalReference: false },
    { id: 3, x: -24.244144, y: 0.000006, fixed: false, construction: false, externalReference: false },
    { id: 4, x: -24.244144, y: 0.000006, fixed: false, construction: false, externalReference: false },
    { id: 5, x: -24.244146, y: -23.69515, fixed: false, construction: false, externalReference: false },
    { id: 6, x: 0, y: -23.695149, fixed: false, construction: false, externalReference: false },
    { id: 7, x: 0, y: -23.695149, fixed: false, construction: false, externalReference: false },
    { id: 8, x: -24.244148, y: -32.399992, fixed: false, construction: false, externalReference: false },
    { id: 9, x: 0, y: -30.318538, fixed: false, construction: false, externalReference: false },
    { id: 10, x: -22.333029, y: -33.020496, fixed: false, construction: false, externalReference: false },
    { id: 11, x: -20.284826, y: -34.329163, fixed: false, construction: false, externalReference: false },
    { id: 12, x: -17.203488, y: -36.297934, fixed: false, construction: false, externalReference: false },
    { id: 13, x: -11.647803, y: -30.693275, fixed: false, construction: false, externalReference: false },
    { id: 14, x: -8.962283, y: -31.443889, fixed: false, construction: false, externalReference: false },
    { id: 15, x: 1.059521, y: -34.245026, fixed: false, construction: false, externalReference: false },
    { id: 16, x: -15.752067, y: -16.904143, fixed: false, construction: false, externalReference: false },
    { id: 17, x: -11.323036, y: -11.49297, fixed: false, construction: false, externalReference: false },
    { id: 18, x: -15.752067, y: -16.904143, fixed: false, construction: false, externalReference: false },
    { id: 19, x: -11.329591, y: -16.909493, fixed: false, construction: false, externalReference: false },
    { id: 20, x: -11.329591, y: -16.909493, fixed: false, construction: false, externalReference: false },
    { id: 21, x: -11.323036, y: -11.49297, fixed: false, construction: false, externalReference: false },
    { id: 22, x: -15.745507, y: -11.487614, fixed: false, construction: false, externalReference: false },
    { id: 23, x: -15.745507, y: -11.487614, fixed: false, construction: false, externalReference: false },
    { id: 24, x: -13.540815, y: -16.906828, fixed: false, construction: false, externalReference: false },
    { id: 25, x: -15.752067, y: -16.904143, fixed: false, construction: false, externalReference: false },
    { id: 26, x: -11.329591, y: -16.909493, fixed: false, construction: false, externalReference: false },
  ],
  geometries: [
    { id: 1, type: "line", points: [0, 3], construction: false },
    { id: 2, type: "line", points: [4, 1], construction: false },
    { id: 3, type: "line", points: [5, 6], construction: true },
    { id: 4, type: "line", points: [7, 2], construction: false },
    { id: 5, type: "bezier", points: [1, 8, 10, 11, 12, 13, 14, 15, 9, 6], construction: false },
    { id: 13, type: "line", points: [20, 17], construction: false },
    { id: 14, type: "line", points: [21, 22], construction: false },
    { id: 15, type: "line", points: [23, 18], construction: false },
    { id: 16, type: "arc", points: [24, 25, 26], construction: false },
  ],
  constraints: [{ id: 0, type: "⏚", points: [0] }],
};

export async function test_sketch_inner_loop_extrude_repro_20260515(partHistory) {
  partHistory.expressions = "resolution = 32;";

  const sketch = await partHistory.newFeature("S");
  Object.assign(sketch.inputParams, {
    id: "S1",
    sketchPlane: null,
    curveResolution: "resolution",
  });
  sketch.persistentData.sketch = JSON.parse(JSON.stringify(reproSketch));

  const extrude = await partHistory.newFeature("E");
  Object.assign(extrude.inputParams, {
    id: "E2",
    profile: "S1:PROFILE",
    consumeProfileSketch: false,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: [], operation: "NONE" },
  });

  return partHistory;
}

export async function afterRun_sketch_inner_loop_extrude_repro_20260515(partHistory) {
  const sketchFeature = partHistory.features.find((entry) => entry?.inputParams?.id === "S1");
  const diag = sketchFeature?.persistentData?.lastProfileDiagnostics;
  assert(diag?.status === "ok", `Expected sketch profile diagnostics to succeed, got ${diag?.status || "null"}.`);
  assert(diag.groups?.length === 1, `Expected one profile group, got ${diag.groups?.length || 0}.`);
  assert(diag.groups[0]?.holes?.length === 1, `Expected one inner loop hole, got ${diag.groups[0]?.holes?.length || 0}.`);

  const solid = partHistory.getObjectByName("E2");
  assert(solid && typeof solid.getFaces === "function", "Expected E2 extrude solid.");
  solid.visualize?.();

  const bezierSide = solid.children?.find((child) => child?.type === "FACE" && child.name === "E2:S1:G5_SW");
  const arcSide = solid.children?.find((child) => child?.type === "FACE" && child.name === "E2:S1:G16_SW");
  assert(bezierSide, "Expected the outer Bezier edge to generate one authored-curve sidewall face.");
  assert(arcSide, "Expected the inner arc edge to generate one authored-curve sidewall face.");
  assert(bezierSide.edges?.length === 4, `Expected Bezier sidewall to have 4 topology edges, got ${bezierSide.edges?.length || 0}.`);
  assert(arcSide.edges?.length === 4, `Expected arc sidewall to have 4 topology edges, got ${arcSide.edges?.length || 0}.`);

  const startFace = solid.getFaces(false).find((entry) => String(entry?.faceName || "") === "E2:S1:PROFILE_START");
  assert(startFace, "Expected E2 start cap face.");

  const hole = diag.profileGroups?.[0]?.holes2D?.[0];
  assert(Array.isArray(hole) && hole.length >= 3, "Expected diagnostic inner loop points.");

  const insideHoleTriangles = (startFace.triangles || []).filter((tri) => {
    const cx = (tri.p1[0] + tri.p2[0] + tri.p3[0]) / 3;
    const cy = (tri.p1[1] + tri.p2[1] + tri.p3[1]) / 3;
    return pointInPoly([cx, cy], hole);
  });
  assert(
    insideHoleTriangles.length === 0,
    `Expected extrude start cap to leave the inner loop open, found ${insideHoleTriangles.length} cap triangles inside it.`,
  );
}

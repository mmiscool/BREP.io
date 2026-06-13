function getSolidByName(partHistory, name) {
  return (partHistory?.scene?.children || []).find((obj) => obj?.type === "SOLID" && obj?.name === name) || null;
}

export async function test_generated_history_20260612232755(partHistory) {
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const feature1 = await partHistory.newFeature("P.CY");
  Object.assign(feature1.inputParams, {
    id: "P.CY2",
    radius: 5,
    height: 10,
    resolution: "resolution",
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: [],
      operation: "NONE",
      overlapConditioningEnabled: true,
    },
  });

  const feature2 = await partHistory.newFeature("P.CY");
  Object.assign(feature2.inputParams, {
    id: "P.CY3",
    radius: 2.5,
    height: 10,
    resolution: "resolution",
    transform: {
      position: [0, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["P.CY2"],
      operation: "SUBTRACT",
      overlapConditioningEnabled: true,
    },
  });

  const feature3 = await partHistory.newFeature("F");
  Object.assign(feature3.inputParams, {
    id: "F4",
    edges: ["P.CY2_S|P.CY2_T[0]"],
    radius: 1,
    resolution: "resolution",
    direction: "AUTO",
    debug: "NONE",
    inflate: 0,
    nudgeFaceDistance: 0.0001,
    renameFaces: true,
  });

  await partHistory.runHistory();
  return partHistory;
}

export async function afterRun_generated_history_20260612232755(partHistory) {
  const solid = getSolidByName(partHistory, "P.CY2");
  if (!solid || typeof solid.getFaceNames !== "function") {
    throw new Error("Expected filleted solid P.CY2 to exist.");
  }
  const faceNames = solid.getFaceNames().map((name) => String(name || ""));
  const leakedWedgeSideWalls = faceNames.filter((name) => /_(?:SURFACE_CA|SURFACE_CB|WEDGE_A|WEDGE_B)$/u.test(name));
  if (leakedWedgeSideWalls.length > 0) {
    throw new Error(`Expected closed-loop wedge sidewall faces to be collapsed and renamed, found: ${leakedWedgeSideWalls.join(", ")}`);
  }
  const summary = solid.__filletSideWallCollapseSummary || {};
  if ("movedSideWallVertices" in summary && !(Number(summary.movedSideWallVertices || 0) > 0)) {
    throw new Error("Expected closed-loop fillet sidewall collapse to move wedge sidewall vertices.");
  }
  const vp = Array.isArray(solid._vertProperties) ? solid._vertProperties : [];
  const sideRingRadii = [];
  for (let i = 0; i + 2 < vp.length; i += 3) {
    const y = Number(vp[i + 1]) || 0;
    if (Math.abs(y - 9) > 1e-5) continue;
    sideRingRadii.push(Math.hypot(Number(vp[i]) || 0, Number(vp[i + 2]) || 0));
  }
  if (sideRingRadii.length === 0) {
    throw new Error("Expected closed-loop fillet to retain an outer side ring just below the fillet.");
  }
  const minSideRingRadius = Math.min(...sideRingRadii);
  const maxSideRingRadius = Math.max(...sideRingRadii);
  if (minSideRingRadius < 4.9 || maxSideRingRadius < 4.99) {
    throw new Error(`Expected closed-loop fillet to preserve the outer side wall radius near 5, got ${minSideRingRadius}..${maxSideRingRadius}.`);
  }
}

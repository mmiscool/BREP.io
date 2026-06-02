export async function test_thicken_sphere_torus_union(partHistory) {
  await partHistory.reset();
  partHistory.features = [];
  partHistory.expressions = "resolution = 32;\n";

  const feature1 = await partHistory.newFeature("P.T");
  Object.assign(feature1.inputParams, {
    id: "P.T1",
    majorRadius: 10,
    tubeRadius: 2,
    resolution: "resolution",
    arc: 143,
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

  const feature2 = await partHistory.newFeature("P.S");
  Object.assign(feature2.inputParams, {
    id: "P.S2",
    radius: 5,
    resolution: "resolution",
    transform: {
      position: [10, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["P.T1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  const feature3 = await partHistory.newFeature("THK");
  Object.assign(feature3.inputParams, {
    id: "THK3",
    face: ["P.T1_Side", "P.S2"],
    distance: 2,
  });

  return partHistory;
}

export async function afterRun_thicken_sphere_torus_union(partHistory) {
  const feature = (partHistory.features || []).find((entry) => entry?.inputParams?.id === "THK3");
  const failures = Array.isArray(feature?.persistentData?.failures) ? feature.persistentData.failures : [];
  if (failures.length) {
    throw new Error(`Expected no thicken failures, got ${JSON.stringify(failures)}.`);
  }

  const solids = [];
  const walk = (obj) => {
    if (!obj) return;
    if (obj.type === "SOLID" && String(obj.name || "").startsWith("THK3_")) solids.push(obj);
    for (const child of obj.children || []) walk(child);
  };
  walk(partHistory.scene);

  if (solids.length !== 2) {
    throw new Error(`Expected two thickened solids, got ${solids.length}.`);
  }

  for (const solid of solids) {
    if (typeof solid._isCoherentlyOrientedManifold === "function" && solid._isCoherentlyOrientedManifold() !== true) {
      throw new Error(`Expected ${solid.name} to be manifold.`);
    }
  }

  const sphereSolid = solids.find((solid) => solid.name === "THK3_02_P.S2");
  if (!sphereSolid) {
    throw new Error("Expected thickened sphere solid THK3_02_P.S2.");
  }

  const sphereFaceNames = Array.from(new Set((sphereSolid.faces || [])
    .map((face) => String(face.name || ""))
    .filter(Boolean)));
  if (sphereFaceNames.length !== 3) {
    throw new Error(`Expected three spherical thicken faces, got ${sphereFaceNames.length}: ${sphereFaceNames.join(", ")}`);
  }
  if (sphereFaceNames.some((name) => name.includes("INTERSECTION_CAP"))) {
    throw new Error(`Expected spherical repair triangles to stay on existing faces, got: ${sphereFaceNames.join(", ")}`);
  }
  for (const requiredName of ["P.S2_START", "P.S2_END", "P.S2_P.T1_Side_0_SW"]) {
    if (!sphereFaceNames.includes(requiredName)) {
      throw new Error(`Expected spherical thicken face ${requiredName}; got ${sphereFaceNames.join(", ")}`);
    }
  }

  const sphereDiagnostics = sphereSolid.__thickenDiagnostics || {};
  if ((sphereDiagnostics.boundaryCapTriangleCount || 0) !== 0) {
    throw new Error(`Expected spherical thicken to preserve the exact shell without repair caps, got ${sphereDiagnostics.boundaryCapTriangleCount}.`);
  }
  if ((sphereDiagnostics.nonManifoldCulledTriangleCount || 0) !== 0) {
    throw new Error(`Expected spherical thicken to avoid destructive non-manifold culling, got ${sphereDiagnostics.nonManifoldCulledTriangleCount}.`);
  }

  const collectSphereRadiiForFace = (solid, faceName) => {
    const faceID = Number(solid?._faceNameToID?.get?.(faceName)) >>> 0;
    const triVerts = solid?._triVerts || [];
    const triIDs = solid?._triIDs || [];
    const vertProperties = solid?._vertProperties || [];
    const vertices = new Set();
    for (let triIndex = 0; triIndex < triIDs.length; triIndex++) {
      if ((triIDs[triIndex] >>> 0) !== faceID) continue;
      vertices.add(triVerts[(triIndex * 3) + 0] >>> 0);
      vertices.add(triVerts[(triIndex * 3) + 1] >>> 0);
      vertices.add(triVerts[(triIndex * 3) + 2] >>> 0);
    }
    return Array.from(vertices, (vertexIndex) => {
      const base = vertexIndex * 3;
      return Math.hypot(
        (Number(vertProperties[base + 0]) || 0) - 10,
        Number(vertProperties[base + 1]) || 0,
        Number(vertProperties[base + 2]) || 0,
      );
    }).filter(Number.isFinite);
  };
  const startRadii = collectSphereRadiiForFace(sphereSolid, "P.S2_START");
  const endRadii = collectSphereRadiiForFace(sphereSolid, "P.S2_END");
  if (!startRadii.length || !endRadii.length) {
    throw new Error(`Expected spherical start/end caps to have raw vertices, got start=${startRadii.length}, end=${endRadii.length}.`);
  }
  const maxStartRadius = Math.max(...startRadii);
  const minEndRadius = Math.min(...endRadii);
  if (!(maxStartRadius < 5.1)) {
    throw new Error(`Expected all spherical source-cap vertices to remain on the source face, max radius=${maxStartRadius}.`);
  }
  if (!(minEndRadius > 6.9)) {
    throw new Error(`Expected all spherical offset-cap vertices to remain on the offset face, min radius=${minEndRadius}.`);
  }

  const sphereBoundaryEdges = typeof sphereSolid.getBoundaryEdgePolylines === "function"
    ? (sphereSolid.getBoundaryEdgePolylines() || [])
    : [];
  for (const edge of sphereBoundaryEdges) {
    const faceA = String(edge?.faceA || "");
    const faceB = String(edge?.faceB || "");
    const directCapBoundary = (faceA.endsWith("_START") && faceB.endsWith("_END"))
      || (faceA.endsWith("_END") && faceB.endsWith("_START"));
    if (directCapBoundary) {
      throw new Error(`Expected sphere start/end caps to be separated by sidewall, got ${faceA}|${faceB}.`);
    }
  }

  const torusSideSolid = solids.find((solid) => solid.name === "THK3_01_P.T1_Side");
  if (!torusSideSolid) {
    throw new Error("Expected thickened torus side solid THK3_01_P.T1_Side.");
  }

  const sidewallFaceNames = Array.from(new Set((torusSideSolid.faces || [])
    .map((face) => String(face.name || ""))
    .filter((name) => name.endsWith("_SW"))));
  if (sidewallFaceNames.length !== 2) {
    throw new Error(`Expected two logical torus sidewall faces, got ${sidewallFaceNames.length}: ${sidewallFaceNames.join(", ")}`);
  }

  const segmentDerivedNames = sidewallFaceNames.filter((name) => /_E\d+_SW$|_L\d+_E\d+_SW$/.test(name));
  if (segmentDerivedNames.length) {
    throw new Error(`Expected sidewall names to derive from logical source edges, got segment-derived names: ${segmentDerivedNames.join(", ")}`);
  }

  for (const requiredToken of ["P.T1_Side_0_SW"]) {
    if (!sidewallFaceNames.some((name) => name.includes(requiredToken))) {
      throw new Error(`Expected sidewall face derived from source edge token ${requiredToken}; got ${sidewallFaceNames.join(", ")}`);
    }
  }

  const torusFaceNames = Array.from(new Set((torusSideSolid.faces || [])
    .map((face) => String(face.name || ""))
    .filter(Boolean)));
  if (torusFaceNames.some((name) => name.includes("INTERSECTION_CAP"))) {
    throw new Error(`Expected torus repair triangles to stay on existing faces, got: ${torusFaceNames.join(", ")}`);
  }

  const boundaryEdges = typeof torusSideSolid.getBoundaryEdgePolylines === "function"
    ? (torusSideSolid.getBoundaryEdgePolylines() || [])
    : [];
  const edgePairCounts = new Map();
  for (const edge of boundaryEdges) {
    const faceA = String(edge?.faceA || "");
    const faceB = String(edge?.faceB || "");
    if (faceA.includes("INTERSECTION_CAP") || faceB.includes("INTERSECTION_CAP")) {
      throw new Error(`Expected no torus boundary edge against INTERSECTION_CAP, got ${faceA}|${faceB}.`);
    }
    const directCapBoundary = (faceA.endsWith("_START") && faceB.endsWith("_END"))
      || (faceA.endsWith("_END") && faceB.endsWith("_START"));
    if (directCapBoundary) {
      throw new Error(`Expected torus start/end caps to be separated by sidewall, got ${faceA}|${faceB}.`);
    }
    const key = `${faceA}|${faceB}`;
    edgePairCounts.set(key, (edgePairCounts.get(key) || 0) + 1);
  }
  if (boundaryEdges.length !== 4) {
    throw new Error(`Expected four clean torus boundary edge polylines, got ${boundaryEdges.length}.`);
  }
  for (const [pair, count] of edgePairCounts) {
    if (count !== 1) {
      throw new Error(`Expected one torus boundary polyline for ${pair}, got ${count}.`);
    }
  }
}

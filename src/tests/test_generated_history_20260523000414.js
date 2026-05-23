import { buildSolidAuthoringStateSnapshot } from "../BREP/CppSolidCore.js";
import { manifoldBuildSource } from "../BREP/setupManifold.js";

function getSolidByName(partHistory, name) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  return solids.find((solid) => String(solid?.name || "") === String(name)) || null;
}

function getFaceComponentStats(snapshot) {
  const numProp = Math.max(3, Number(snapshot?.numProp ?? 3));
  const vertProperties = Array.isArray(snapshot?.vertProperties) ? snapshot.vertProperties : [];
  const triVerts = Array.isArray(snapshot?.triVerts) ? snapshot.triVerts : [];
  const triIDs = Array.isArray(snapshot?.triIDs) ? snapshot.triIDs : [];
  const idToFaceName = new Map(snapshot?.idToFaceName || []);
  const triCount = Math.floor(triVerts.length / 3);

  const triangleArea = (triIndex) => {
    const triBase = triIndex * 3;
    const points = [0, 1, 2].map((offset) => {
      const vertexBase = Number(triVerts[triBase + offset] || 0) * numProp;
      return [
        Number(vertProperties[vertexBase + 0] || 0),
        Number(vertProperties[vertexBase + 1] || 0),
        Number(vertProperties[vertexBase + 2] || 0),
      ];
    });
    const [a, b, c] = points;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    return 0.5 * Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    );
  };

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeToTris = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const base = triIndex * 3;
    const i0 = triVerts[base + 0];
    const i1 = triVerts[base + 1];
    const i2 = triVerts[base + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = edgeKey(a, b);
      let list = edgeToTris.get(key);
      if (!list) {
        list = [];
        edgeToTris.set(key, list);
      }
      list.push(triIndex);
    }
  }

  const adjacency = Array.from({ length: triCount }, () => []);
  for (const list of edgeToTris.values()) {
    if (list.length !== 2) continue;
    adjacency[list[0]].push(list[1]);
    adjacency[list[1]].push(list[0]);
  }

  const seen = new Uint8Array(triCount);
  const components = [];
  for (let seed = 0; seed < triCount; seed += 1) {
    if (seen[seed]) continue;
    const faceId = triIDs[seed] >>> 0;
    const stack = [seed];
    seen[seed] = 1;
    let area = 0;
    let triangles = 0;
    const neighborFaceIds = new Set();

    while (stack.length > 0) {
      const triIndex = stack.pop();
      triangles += 1;
      area += triangleArea(triIndex);
      for (const neighborIndex of adjacency[triIndex]) {
        const neighborFaceId = triIDs[neighborIndex] >>> 0;
        if (neighborFaceId === faceId) {
          if (seen[neighborIndex]) continue;
          seen[neighborIndex] = 1;
          stack.push(neighborIndex);
        } else {
          neighborFaceIds.add(neighborFaceId);
        }
      }
    }

    components.push({
      faceName: String(idToFaceName.get(faceId) || `FACE_${faceId}`),
      triangles,
      area,
      neighborFaceNames: Array.from(neighborFaceIds, (id) => String(idToFaceName.get(id) || `FACE_${id}`)),
    });
  }

  return components;
}

function assertNoSingleNeighborFilletFaceIslands(solid) {
  const snapshot = buildSolidAuthoringStateSnapshot(solid);
  const components = getFaceComponentStats(snapshot);
  const isRoundFace = (faceName) => {
    const metadata = typeof solid.getFaceMetadata === "function"
      ? (solid.getFaceMetadata(faceName) || {})
      : {};
    return metadata?.filletSideWall === true
      || metadata?.filletMergedSideWall === true
      || typeof metadata?.filletRoundFace === "string"
      || String(faceName || "").endsWith("_TUBE_Outer");
  };
  const byFace = new Map();
  for (const component of components) {
    let list = byFace.get(component.faceName);
    if (!list) {
      list = [];
      byFace.set(component.faceName, list);
    }
    list.push(component);
  }

  const islands = [];
  for (const [faceName, faceComponents] of byFace.entries()) {
    if (faceComponents.length <= 1) continue;
    for (const component of faceComponents) {
      if (component.neighborFaceNames.length !== 1) continue;
      const neighborFaceName = component.neighborFaceNames[0];
      if (isRoundFace(faceName) === isRoundFace(neighborFaceName)) continue;
      islands.push({
          faceName,
          triangles: component.triangles,
          area: Number(component.area.toFixed(6)),
          neighborFaceNames: component.neighborFaceNames,
      });
    }
  }

  if (islands.length > 0) {
    throw new Error(`[generated_history_20260523000414] Expected fillet cleanup to merge single-neighbor face islands, found ${JSON.stringify(islands)}.`);
  }
}

function assertRoundFilletFaceSurvives(solid) {
  const faceNames = typeof solid.getFaceNames === "function" ? Array.from(solid.getFaceNames() || []) : [];
  const roundFaceNames = faceNames.filter((faceName) => {
    const metadata = typeof solid.getFaceMetadata === "function"
      ? (solid.getFaceMetadata(faceName) || {})
      : {};
    return metadata?.filletSideWall === true
      || metadata?.filletMergedSideWall === true
      || typeof metadata?.filletRoundFace === "string"
      || String(faceName || "").endsWith("_TUBE_Outer");
  });
  const hasSubstantialRoundFace = roundFaceNames.some((faceName) => {
    const triangles = typeof solid.getFace === "function" ? (solid.getFace(faceName) || []) : [];
    return triangles.length > 100;
  });
  if (!hasSubstantialRoundFace) {
    throw new Error(`[generated_history_20260523000414] Expected the round fillet face to survive as its own face. Round candidates: ${roundFaceNames.join(", ")}`);
  }
}

export async function test_generated_history_20260523000414(partHistory) {
  if (manifoldBuildSource !== "local") return;

  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = {
    fields: [],
    values: {},
  };

  const feature1 = await partHistory.newFeature("P.T");
  Object.assign(feature1.inputParams, {
    id: "P.T1",
    majorRadius: 48.6,
    tubeRadius: 10.2,
    resolution: "resolution*2",
    arc: 360,
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
    id: "P.CY2",
    radius: "5",
    height: 37.2,
    resolution: "resolution",
    transform: {
      position: [48.05356774966094, 0, 0],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: {
      targets: ["P.T1"],
      operation: "UNION",
      overlapConditioningEnabled: true,
    },
  });

  const feature3 = await partHistory.newFeature("F");
  Object.assign(feature3.inputParams, {
    id: "F3",
    edges: ["P.CY2_S|P.T1_Side[0]"],
    radius: "4",
    resolution: "resolution",
    inflate: "2.7",
    nudgeFaceDistance: 0.0001,
    direction: "AUTO",
    debug: "NONE",
    collapseFilletSideWalls: true,
    renameFaces: true,
  });

  await partHistory.runHistory();
  const solid = getSolidByName(partHistory, "P.T1");
  if (!solid) {
    throw new Error("[generated_history_20260523000414] Expected final solid P.T1 to exist.");
  }

  const cleanupCount = Number(solid.__filletPostCollapseTinyFaceIslandCleanupCount || 0)
    + Number(solid.__filletTinyFaceIslandCleanupCount || 0)
    + Number(solid.__filletSingleNeighborIslandCleanupCount || 0)
    + Number(solid.__filletPostSingleNeighborIslandCleanupCount || 0);
  if (!(cleanupCount > 0)) {
    throw new Error("[generated_history_20260523000414] Expected fillet tiny-face island cleanup to reassign triangles.");
  }
  assertNoSingleNeighborFilletFaceIslands(solid);
  assertRoundFilletFaceSurvives(solid);
}

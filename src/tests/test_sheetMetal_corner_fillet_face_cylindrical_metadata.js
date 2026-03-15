import {
  __test_applyCornerFilletsToTree,
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import {
  sheetMetalNonManifoldSmF18Fixture,
} from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approxEqual(a, b, tol = 1e-3) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function findFlatById(flat, id) {
  if (!flat) return null;
  if (String(flat.id) === String(id)) return flat;
  const edges = Array.isArray(flat.edges) ? flat.edges : [];
  for (const edge of edges) {
    const children = Array.isArray(edge?.bend?.children) ? edge.bend.children : [];
    for (const child of children) {
      const found = findFlatById(child?.flat, id);
      if (found) return found;
    }
  }
  return null;
}

function distancePointToAxis(point, center, axis) {
  const px = point[0] - center[0];
  const py = point[1] - center[1];
  const pz = point[2] - center[2];
  const dot = px * axis[0] + py * axis[1] + pz * axis[2];
  const rx = px - axis[0] * dot;
  const ry = py - axis[1] * dot;
  const rz = pz - axis[2] * dot;
  return Math.hypot(rx, ry, rz);
}

function collectFaceVertexAxisDistances(solid, faceName, center, axis) {
  const faceId = solid?._faceNameToID?.get(faceName);
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const vertProperties = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  if (faceId == null || !triVerts.length || !triIDs.length || !vertProperties.length) return [];

  const distances = [];
  for (let triIndex = 0; triIndex < triIDs.length; triIndex += 1) {
    if (triIDs[triIndex] !== faceId) continue;
    const base = triIndex * 3;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = triVerts[base + corner] * 3;
      distances.push(distancePointToAxis([
        vertProperties[vertexIndex],
        vertProperties[vertexIndex + 1],
        vertProperties[vertexIndex + 2],
      ], center, axis));
    }
  }
  return distances;
}

function distance3(a, b) {
  return Math.hypot(
    Number(a?.[0] || 0) - Number(b?.[0] || 0),
    Number(a?.[1] || 0) - Number(b?.[1] || 0),
    Number(a?.[2] || 0) - Number(b?.[2] || 0),
  );
}

export async function test_sheetMetal_corner_fillet_face_cylindrical_metadata(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const requestedRadius = 1.2;
  const workingTree = clone(sheetMetalNonManifoldSmF18Fixture.tree);
  const applied = __test_applyCornerFilletsToTree({
    tree: workingTree,
    featureID: "SM.TEST.FILLET",
    targets: [{
      flatId: "SM.TAB3:flat_root",
      edgeId: "SM.TAB3:flat_root:e2",
    }],
    radius: requestedRadius,
    resolution: 48,
  });

  const flatAfter = findFlatById(applied?.tree?.root, "SM.TAB3:flat_root");
  if (!flatAfter) {
    throw new Error("Updated flat for sheet-metal corner fillet metadata test was not found.");
  }

  const filletEdges = (Array.isArray(flatAfter.edges) ? flatAfter.edges : []).filter((edge) => Array.isArray(edge?.polyline) && edge.polyline.length > 2);
  if (!filletEdges.length) {
    throw new Error("Corner fillet test did not create a rounded thickness edge.");
  }

  const built = __test_buildRenderableSheetModelFromTree({
    featureID: "SM.TEST.FILLET",
    tree: applied.tree,
    rootMatrix: sheetMetalNonManifoldSmF18Fixture.rootTransform,
    showFlatPattern: false,
  });
  const solid = built?.root || null;
  if (!solid || typeof solid.getFaceMetadata !== "function") {
    throw new Error("Corner fillet metadata test did not build a readable solid.");
  }

  let matchedRequestedRadius = false;
  for (const filletEdge of filletEdges) {
    const faceName = `SM.TEST.FILLET:FLAT:${flatAfter.id}:SIDE:${filletEdge.id}`;
    const metadata = solid.getFaceMetadata(faceName);
    if (!metadata || metadata.type !== "cylindrical") {
      throw new Error(`Expected cylindrical metadata on corner-fillet thickness face "${faceName}".`);
    }

    if (!Array.isArray(metadata.axis) || metadata.axis.length !== 3 || !Array.isArray(metadata.center) || metadata.center.length !== 3) {
      throw new Error(`Corner-fillet thickness face "${faceName}" is missing axis/center metadata.`);
    }
    if (!Number.isFinite(metadata.radius) || metadata.radius <= 0) {
      throw new Error(`Corner-fillet thickness face "${faceName}" is missing a positive radius.`);
    }
    if (!approxEqual(metadata.height, sheetMetalNonManifoldSmF18Fixture.tree.thickness, 1e-3)) {
      throw new Error(`Corner-fillet thickness face "${faceName}" should use the sheet thickness as cylinder height.`);
    }

    const distances = collectFaceVertexAxisDistances(solid, faceName, metadata.center, metadata.axis);
    if (!distances.length) {
      throw new Error(`Could not sample corner-fillet thickness face "${faceName}".`);
    }
    const averageRadius = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const minRadius = Math.min(...distances);
    const maxRadius = Math.max(...distances);
    if (!approxEqual(averageRadius, metadata.radius, 1e-3)) {
      throw new Error(`Corner-fillet thickness face "${faceName}" radius metadata does not match geometry.`);
    }
    if (maxRadius - minRadius > 2e-3) {
      throw new Error(`Corner-fillet thickness face "${faceName}" is not geometrically cylindrical.`);
    }
    if (approxEqual(metadata.radius, requestedRadius, 1e-3)) {
      matchedRequestedRadius = true;
    }

    const auxEdges = Array.isArray(solid._auxEdges) ? solid._auxEdges : [];
    const centerline = auxEdges.find((entry) => entry?.name === `${faceName}:CENTERLINE`);
    if (!centerline || !centerline.centerline) {
      throw new Error(`Expected a centerline auxiliary edge for corner-fillet thickness face "${faceName}".`);
    }
    if (!Array.isArray(centerline.points) || centerline.points.length !== 2) {
      throw new Error(`Corner-fillet centerline "${faceName}:CENTERLINE" should contain exactly 2 points.`);
    }
    const midpoint = [
      (centerline.points[0][0] + centerline.points[1][0]) * 0.5,
      (centerline.points[0][1] + centerline.points[1][1]) * 0.5,
      (centerline.points[0][2] + centerline.points[1][2]) * 0.5,
    ];
    if (!approxEqual(distance3(midpoint, metadata.center), 0, 1e-4)) {
      throw new Error(`Corner-fillet centerline "${faceName}:CENTERLINE" is not centered on the cylindrical face axis.`);
    }
    if (!approxEqual(distance3(centerline.points[0], centerline.points[1]), metadata.height, 1e-3)) {
      throw new Error(`Corner-fillet centerline "${faceName}:CENTERLINE" should span the cylindrical face height.`);
    }
  }

  if (!matchedRequestedRadius) {
    throw new Error("No corner-fillet thickness face preserved the requested fillet radius.");
  }

  return partHistory;
}

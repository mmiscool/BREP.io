import {
  __test_buildRenderableSheetModelFromTree,
} from "../features/sheetMetal/sheetMetalEngineBridge.js";
import {
  sheetMetalNonManifoldSmF18Fixture,
} from "./fixtures/sheetMetal_nonManifold_sm_f18.js";

function approxEqual(a, b, tol = 1e-3) {
  return Math.abs(Number(a) - Number(b)) <= tol;
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
      const point = [
        vertProperties[vertexIndex],
        vertProperties[vertexIndex + 1],
        vertProperties[vertexIndex + 2],
      ];
      distances.push(distancePointToAxis(point, center, axis));
    }
  }
  return distances;
}

function validateBendFaceMetadata(solid, faceName, metadata) {
  if (!metadata || metadata.type !== "cylindrical") {
    throw new Error(`Expected cylindrical metadata on bend face "${faceName}".`);
  }
  if (!Number.isFinite(metadata.radius) || metadata.radius <= 0) {
    throw new Error(`Expected positive bend-face radius on "${faceName}".`);
  }
  if (!Number.isFinite(metadata.height) || metadata.height <= 0) {
    throw new Error(`Expected positive bend-face height on "${faceName}".`);
  }
  if (!Array.isArray(metadata.axis) || metadata.axis.length !== 3) {
    throw new Error(`Expected axis triplet on bend face "${faceName}".`);
  }
  if (!Array.isArray(metadata.center) || metadata.center.length !== 3) {
    throw new Error(`Expected center triplet on bend face "${faceName}".`);
  }

  const axisLength = Math.hypot(metadata.axis[0], metadata.axis[1], metadata.axis[2]);
  if (!approxEqual(axisLength, 1, 1e-3)) {
    throw new Error(`Expected normalized bend-face axis on "${faceName}".`);
  }

  const distances = collectFaceVertexAxisDistances(solid, faceName, metadata.center, metadata.axis);
  if (!distances.length) {
    throw new Error(`Could not sample bend-face vertices for "${faceName}".`);
  }

  const avgRadius = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const minRadius = Math.min(...distances);
  const maxRadius = Math.max(...distances);
  if (!approxEqual(avgRadius, metadata.radius, 1e-3)) {
    throw new Error(`Bend-face radius metadata does not match geometry on "${faceName}".`);
  }
  if (maxRadius - minRadius > 2e-3) {
    throw new Error(`Bend-face vertices are not consistent with a cylindrical radius on "${faceName}".`);
  }
}

export async function test_sheetMetal_bend_face_cylindrical_metadata(partHistory) {
  await partHistory.reset();
  partHistory.features = [];

  const { featureID, tree, rootTransform } = sheetMetalNonManifoldSmF18Fixture;
  const result = __test_buildRenderableSheetModelFromTree({
    featureID,
    tree,
    rootMatrix: rootTransform,
    showFlatPattern: false,
  });

  const solid = result?.root || null;
  const bends = Array.isArray(result?.evaluated?.bends3D) ? result.evaluated.bends3D : [];
  if (!solid || typeof solid.getFaceMetadata !== "function") {
    throw new Error("Sheet-metal bend metadata test did not produce a readable solid.");
  }
  if (!bends.length) {
    throw new Error("Sheet-metal bend metadata test did not produce any bends.");
  }

  const bendPlacement = bends.find((entry) => entry?.bend?.id && Number.isFinite(entry?.midRadius));
  if (!bendPlacement) {
    throw new Error("Could not find a bend placement with radius data.");
  }

  const faceA = `${featureID}:BEND:${bendPlacement.bend.id}:A`;
  const faceB = `${featureID}:BEND:${bendPlacement.bend.id}:B`;
  const metaA = solid.getFaceMetadata(faceA);
  const metaB = solid.getFaceMetadata(faceB);

  validateBendFaceMetadata(solid, faceA, metaA);
  validateBendFaceMetadata(solid, faceB, metaB);

  const thickness = Number(tree?.thickness);
  if (!Number.isFinite(thickness) || thickness <= 0) {
    throw new Error("Sheet-metal test fixture has invalid thickness.");
  }

  const expectedRadii = [
    Math.max(1e-6, bendPlacement.midRadius - thickness * 0.5),
    bendPlacement.midRadius + thickness * 0.5,
  ].sort((a, b) => a - b);
  const actualRadii = [metaA.radius, metaB.radius].sort((a, b) => a - b);

  if (!approxEqual(actualRadii[0], expectedRadii[0], 1e-3) || !approxEqual(actualRadii[1], expectedRadii[1], 1e-3)) {
    throw new Error(`Bend-face metadata radii do not match inside/outside bend radii for bend "${bendPlacement.bend.id}".`);
  }

  if (!approxEqual(Math.abs(metaA.radius - metaB.radius), thickness, 1e-3)) {
    throw new Error(`Bend-face metadata radii should differ by sheet thickness for bend "${bendPlacement.bend.id}".`);
  }

  return partHistory;
}

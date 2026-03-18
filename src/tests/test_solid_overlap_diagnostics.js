import * as THREE from 'three';
import { analyzeSolidFaceOverlaps, analyzeSolidPairFaceOverlaps } from '../UI/solidOverlapDiagnostics.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function makeFaceMesh(faceName, triangles) {
  const positions = [];
  for (const [p1, p2, p3] of triangles) {
    positions.push(...p1, ...p2, ...p3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const face = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  face.type = 'FACE';
  face.name = faceName;
  face.userData = { faceName };
  return face;
}

function buildSolidWithFaces(definitions) {
  const solid = new THREE.Group();
  solid.type = 'SOLID';
  solid.name = 'TEST_SOLID';
  for (const [faceName, triangles] of definitions) {
    solid.add(makeFaceMesh(faceName, triangles));
  }
  solid.updateMatrixWorld(true);
  return solid;
}

function makeQuad(minX, minY, maxX, maxY, z = 0) {
  return [
    [
      [minX, minY, z],
      [maxX, minY, z],
      [maxX, maxY, z],
    ],
    [
      [minX, minY, z],
      [maxX, maxY, z],
      [minX, maxY, z],
    ],
  ];
}

export async function test_solid_overlap_diagnostics_detects_coplanar_overlap() {
  const solid = buildSolidWithFaces([
    ['FACE_A', makeQuad(0, 0, 1, 1, 0)],
    ['FACE_B', makeQuad(0.5, 0, 1.5, 1, 0)],
    ['FACE_OFF_PLANE', makeQuad(0, 0, 1, 1, 0.01)],
  ]);

  const analysis = analyzeSolidFaceOverlaps(solid, {
    normalToleranceDeg: 0.5,
    planeDistanceTolerance: 1e-5,
    overlapAreaTolerance: 1e-6,
  });

  assert(analysis.faceCount === 3, `Expected 3 planar faces, got ${analysis.faceCount}`);
  assert(analysis.overlaps.length === 1, `Expected exactly one overlap pair, got ${analysis.overlaps.length}`);
  assert(analysis.overlaps[0].faceA === 'FACE_A', `Expected FACE_A first, got ${analysis.overlaps[0].faceA}`);
  assert(analysis.overlaps[0].faceB === 'FACE_B', `Expected FACE_B second, got ${analysis.overlaps[0].faceB}`);
  assert(
    Math.abs(analysis.overlaps[0].overlapArea - 0.5) < 1e-6,
    `Expected overlap area close to 0.5, got ${analysis.overlaps[0].overlapArea}`,
  );
  assert(
    analysis.highlightedFaceNames.includes('FACE_A') && analysis.highlightedFaceNames.includes('FACE_B'),
    'Expected both overlapping faces to be highlighted.',
  );
  assert(
    !analysis.highlightedFaceNames.includes('FACE_OFF_PLANE'),
    'Expected off-plane face to be ignored.',
  );
}

export async function test_solid_overlap_diagnostics_ignores_boundary_touching_faces() {
  const solid = buildSolidWithFaces([
    ['FACE_A', makeQuad(0, 0, 1, 1, 0)],
    ['FACE_TOUCH_ONLY', makeQuad(1, 0, 2, 1, 0)],
  ]);

  const analysis = analyzeSolidFaceOverlaps(solid, {
    normalToleranceDeg: 0.5,
    planeDistanceTolerance: 1e-5,
    overlapAreaTolerance: 1e-6,
  });

  assert(analysis.overlaps.length === 0, `Expected no overlap pairs, got ${analysis.overlaps.length}`);
  assert(analysis.highlightedFaceNames.length === 0, 'Expected no highlighted faces for boundary-only contact.');
}

export async function test_solid_overlap_diagnostics_detects_cross_solid_overlap() {
  const solidA = buildSolidWithFaces([
    ['A_FACE_1', makeQuad(0, 0, 1, 1, 0)],
    ['A_FACE_2', makeQuad(2, 0, 3, 1, 0)],
  ]);
  solidA.name = 'SOLID_A';

  const solidB = buildSolidWithFaces([
    ['B_FACE_1', makeQuad(0.5, 0, 1.5, 1, 0)],
    ['B_FACE_2', makeQuad(5, 0, 6, 1, 0)],
  ]);
  solidB.name = 'SOLID_B';

  const analysis = analyzeSolidFaceOverlaps(solidA, {
    normalToleranceDeg: 0.5,
    planeDistanceTolerance: 1e-5,
    overlapAreaTolerance: 1e-6,
  });
  assert(analysis.overlaps.length === 0, 'Single-solid analysis should not report cross-solid pairs.');

  const pairAnalysis = analyzeSolidPairFaceOverlaps(solidA, solidB, {
    normalToleranceDeg: 0.5,
    planeDistanceTolerance: 1e-5,
    overlapAreaTolerance: 1e-6,
  });

  assert(pairAnalysis.overlaps.length === 1, `Expected one cross-solid overlap pair, got ${pairAnalysis.overlaps.length}`);
  assert(pairAnalysis.overlaps[0].solidA === 'SOLID_A', `Expected solidA label SOLID_A, got ${pairAnalysis.overlaps[0].solidA}`);
  assert(pairAnalysis.overlaps[0].solidB === 'SOLID_B', `Expected solidB label SOLID_B, got ${pairAnalysis.overlaps[0].solidB}`);
  assert(pairAnalysis.overlaps[0].faceA === 'A_FACE_1', `Expected A_FACE_1, got ${pairAnalysis.overlaps[0].faceA}`);
  assert(pairAnalysis.overlaps[0].faceB === 'B_FACE_1', `Expected B_FACE_1, got ${pairAnalysis.overlaps[0].faceB}`);
  assert(
    Math.abs(pairAnalysis.overlaps[0].overlapArea - 0.5) < 1e-6,
    `Expected cross-solid overlap area close to 0.5, got ${pairAnalysis.overlaps[0].overlapArea}`,
  );
  assert(
    Array.isArray(pairAnalysis.highlightedBySolid[pairAnalysis.solidAKey]?.faceNames)
    && pairAnalysis.highlightedBySolid[pairAnalysis.solidAKey].faceNames.includes('A_FACE_1'),
    'Expected SOLID_A highlight set to include A_FACE_1.',
  );
  assert(
    Array.isArray(pairAnalysis.highlightedBySolid[pairAnalysis.solidBKey]?.faceNames)
    && pairAnalysis.highlightedBySolid[pairAnalysis.solidBKey].faceNames.includes('B_FACE_1'),
    'Expected SOLID_B highlight set to include B_FACE_1.',
  );
}

export async function test_solid_overlap_diagnostics(partHistory) {
  await test_solid_overlap_diagnostics_detects_coplanar_overlap(partHistory);
  await test_solid_overlap_diagnostics_ignores_boundary_touching_faces(partHistory);
  await test_solid_overlap_diagnostics_detects_cross_solid_overlap(partHistory);
  return partHistory;
}

import { Solid } from '../BREP/BetterSolid.js';
import { repairGeneratedFaceIDProvenance } from '../BREP/faceIdRepair.js';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed.');
}

function setRole(solid: any, faceName, metadata) {
  if (!(solid._faceMetadata instanceof Map)) solid._faceMetadata = new Map();
  solid._faceMetadata.set(faceName, { ...metadata });
}

function makeDirectCapBoundaryFixture(names: any = {}) {
  const start = names.start || 'START_ROLE_ONLY';
  const end = names.end || 'END_ROLE_ONLY';
  const sidewall = names.sidewall || 'SIDE_ROLE_ONLY';
  const solid: any = new Solid();
  solid.name = 'FACE_ID_REPAIR_FIXTURE';
  solid
    .addTriangle(start, [0, 0, 0], [1, 0, 0], [0, 1, 0])
    .addTriangle(end, [0, 0, 0], [1, 0, 0], [0, 0, 1])
    .addTriangle(sidewall, [0, 0, 0], [0, 1, 0], [0, 0, 1]);
  setRole(solid, start, { type: 'start_cap' });
  setRole(solid, end, { type: 'end_cap' });
  setRole(solid, sidewall, { type: 'sidewall' });
  return { solid, start, end, sidewall };
}

export async function test_face_id_repair_uses_metadata_roles_without_name_suffixes() {
  const { solid, end, sidewall } = makeDirectCapBoundaryFixture();
  const endID = solid._faceNameToID.get(end);
  const sidewallID = solid._faceNameToID.get(sidewall);

  const result = repairGeneratedFaceIDProvenance(solid);

  assert(result.directStartEndCapBoundaryReassignedTriangles === 1, 'Expected one direct cap-boundary triangle to be reassigned.');
  assert(solid._triIDs.includes(sidewallID), 'Expected sidewall face ID to be present after repair.');
  assert(!solid._triIDs.includes(endID), 'Expected the end cap triangle sharing a direct start/end boundary to be reassigned.');
}

export async function test_face_id_repair_accepts_feature_scoped_metadata_roles() {
  const { solid, end, sidewall } = makeDirectCapBoundaryFixture({
    start: 'FEATURE_START_ROLE_ONLY',
    end: 'FEATURE_END_ROLE_ONLY',
    sidewall: 'FEATURE_SIDE_ROLE_ONLY',
  });
  setRole(solid, 'FEATURE_START_ROLE_ONLY', { offsetShellFaceRole: 'start_cap' });
  setRole(solid, end, { offsetShellFaceRole: 'end_cap' });
  setRole(solid, sidewall, { offsetShellFaceRole: 'sidewall' });
  const endID = solid._faceNameToID.get(end);
  const sidewallID = solid._faceNameToID.get(sidewall);

  const result = repairGeneratedFaceIDProvenance(solid);

  assert(result.directStartEndCapBoundaryReassignedTriangles === 1, 'Expected feature-scoped roles to drive direct cap-boundary repair.');
  assert(solid._triIDs.includes(sidewallID), 'Expected sidewall face ID to be present after feature-scoped repair.');
  assert(!solid._triIDs.includes(endID), 'Expected feature-scoped end cap triangle to be reassigned.');
}

export async function test_visualize_does_not_repair_face_ids() {
  const { solid } = makeDirectCapBoundaryFixture({
    start: 'PROFILE_START',
    end: 'PROFILE_END',
    sidewall: 'PROFILE_SW',
  });
  const before = solid._triIDs.slice();

  solid.visualize({ authoringOnly: true, showEdges: false, forceRebuild: true });

  assert(
    JSON.stringify(solid._triIDs) === JSON.stringify(before),
    'Solid.visualize() must not mutate authored triangle face IDs.',
  );
}

export async function test_solid_face_queries_fall_back_to_authoring_arrays_for_non_manifold_meshes() {
  const solid: any = new Solid();
  solid.name = 'OPEN_AUTHORING_FACE_QUERY_FIXTURE';
  solid
    .addTriangle('OPEN_A', [0, 0, 0], [1, 0, 0], [0, 1, 0])
    .addTriangle('OPEN_B', [1, 0, 0], [1, 1, 0], [0, 1, 0]);

  const faces = solid.getFaces(false);
  const names = faces.map((face) => face.faceName).sort();
  assert(names.join('|') === 'OPEN_A|OPEN_B', `Expected authored open faces, got ${names.join('|')}.`);
  assert(
    faces.every((face) => Array.isArray(face.triangles) && face.triangles.length === 1),
    'Expected one authored triangle per open face.',
  );

  const face = solid.getFace('OPEN_A');
  assert(Array.isArray(face) && face.length === 1, 'Expected getFace() to return authored triangles when native topology query is empty.');
}

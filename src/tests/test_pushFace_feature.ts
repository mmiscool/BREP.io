const BASE_ID = "PUSH_FACE_FEATURE_BASE";
const PUSH_DISTANCE = 1.5;

function collectSolidBounds(solid) {
  const values = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  if (!values.length) throw new Error("[pushFace-feature] Solid has no vertices.");
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (let i = 0; i < values.length; i += 3) {
    const x = Number(values[i + 0]);
    const y = Number(values[i + 1]);
    const z = Number(values[i + 2]);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

export async function test_pushFace_feature(partHistory) {
  const base = await partHistory.newFeature("P.CU");
  base.inputParams.id = BASE_ID;
  base.inputParams.sizeX = 4;
  base.inputParams.sizeY = 3;
  base.inputParams.sizeZ = 2;

  const pushFace = await partHistory.newFeature("PF");
  pushFace.inputParams.faces = [`${BASE_ID}_PX`, `${BASE_ID}_PZ`];
  pushFace.inputParams.distance = PUSH_DISTANCE;

  return partHistory;
}

export async function afterRun_pushFace_feature(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === "SOLID");
  if (solids.length !== 1) {
    throw new Error(`[pushFace-feature] Expected one final solid, found ${solids.length}.`);
  }

  const solid = solids[0];
  if (solid.name !== BASE_ID) {
    throw new Error(`[pushFace-feature] Expected result solid to retain name ${BASE_ID}, received ${solid.name}.`);
  }

  const bounds = collectSolidBounds(solid);
  const tol = 1e-6;
  if (Math.abs(bounds.minX - 0) > tol || Math.abs(bounds.minY - 0) > tol || Math.abs(bounds.minZ - 0) > tol) {
    throw new Error(`[pushFace-feature] Expected mins to remain at the origin, got ${JSON.stringify(bounds)}.`);
  }
  if (Math.abs(bounds.maxX - (4 + PUSH_DISTANCE)) > tol) {
    throw new Error(`[pushFace-feature] Expected maxX ${4 + PUSH_DISTANCE}, received ${bounds.maxX}.`);
  }
  if (Math.abs(bounds.maxY - 3) > tol) {
    throw new Error(`[pushFace-feature] Expected maxY 3, received ${bounds.maxY}.`);
  }
  if (Math.abs(bounds.maxZ - (2 + PUSH_DISTANCE)) > tol) {
    throw new Error(`[pushFace-feature] Expected maxZ ${2 + PUSH_DISTANCE}, received ${bounds.maxZ}.`);
  }

  const faceNames = new Set(typeof solid.getFaceNames === "function" ? solid.getFaceNames() : []);
  for (const faceName of [`${BASE_ID}_PX`, `${BASE_ID}_PZ`]) {
    if (!faceNames.has(faceName)) {
      throw new Error(`[pushFace-feature] Expected pushed face ${faceName} to survive on the result.`);
    }
  }
}

export async function test_fillet_corner_bridge(partHistory) {
  const cube = await partHistory.newFeature("P.CU");
  cube.inputParams.id = "P.CU1";
  cube.inputParams.sizeX = 10;
  cube.inputParams.sizeY = 10;
  cube.inputParams.sizeZ = 10;

  const fillet = await partHistory.newFeature("F");
  fillet.inputParams.edges = [
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_NY[0]`,
    `${cube.inputParams.featureID}_NX|${cube.inputParams.featureID}_NZ[0]`,
    `${cube.inputParams.featureID}_NY|${cube.inputParams.featureID}_NZ[0]`,
  ];
  fillet.inputParams.radius = 1.2;
  fillet.inputParams.direction = "INSET";
  fillet.inputParams.resolution = 32;

  return partHistory;
}

export async function afterRun_fillet_corner_bridge(partHistory) {
  const filletFeature = partHistory.features.find((feature) => feature?.type === "F");
  if (!filletFeature) {
    throw new Error("Fillet feature missing from history.");
  }

  const summary = filletFeature?.persistentData?.miterSummary || null;
  if (!summary || typeof summary !== "object") {
    throw new Error("Fillet corner bridge summary metadata missing.");
  }

  const cornerBridgeCount = Number(summary?.cornerBridgeCount || 0);
  if (!Number.isFinite(cornerBridgeCount) || cornerBridgeCount < 0) {
    throw new Error(`Fillet corner bridge count should be a non-negative number, received ${cornerBridgeCount}.`);
  }

  let filletSolid = null;
  for (const obj of (partHistory.scene?.children || [])) {
    if (obj?.owningFeatureID === filletFeature.inputParams.featureID && obj?.type === "SOLID") {
      filletSolid = obj;
      break;
    }
    if (typeof obj?.traverse === "function") {
      obj.traverse((child) => {
        if (!filletSolid && child?.owningFeatureID === filletFeature.inputParams.featureID && child?.type === "SOLID") {
          filletSolid = child;
        }
      });
    }
    if (filletSolid) break;
  }
  if (!filletSolid || typeof filletSolid.getMesh !== "function") {
    throw new Error("Corner-bridge fillet did not produce a mesh-capable solid.");
  }

  const faceNames = filletSolid.getFaceNames();
  const fallbackFilletFaces = faceNames.filter((name) => /^F\d+_FILLET_FACE_/.test(name));
  if (fallbackFilletFaces.length > 0) {
    throw new Error(`Trihedral corner fillet should use selected edge names, found fallback labels: ${fallbackFilletFaces.join(", ")}`);
  }
  const missingEdgeFaces = (filletFeature.inputParams.edges || []).filter((name) => !faceNames.includes(name));
  if (missingEdgeFaces.length > 0) {
    throw new Error(`Trihedral corner fillet is missing edge-derived face labels: ${missingEdgeFaces.join(", ")}`);
  }
  const expectedCornerFaceName = (filletFeature.inputParams.edges || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .sort()
    .join("+");
  if (!faceNames.includes(expectedCornerFaceName)) {
    throw new Error(`Trihedral spherical corner face should combine its three edge labels as "${expectedCornerFaceName}".`);
  }

  let mesh = null;
  try {
    mesh = filletSolid.getMesh();
    const triCount = (mesh.triVerts.length / 3) | 0;
    if (triCount <= 0) {
      throw new Error(`triangles=${triCount}`);
    }
  } catch (error) {
    const message = String(error?.message || error || "Unknown mesh error");
    throw new Error(`Corner-bridge fillet mesh generation failed: ${message}`);
  } finally {
    try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
  }

  console.log(`✓ Fillet corner bridge test passed: bridges=${cornerBridgeCount}`);
}

import { setSheetMetalFaceTypeMetadata, SHEET_METAL_FACE_TYPES } from "./sheetMetalFaceTypes.js";

export function resolvePlacementMode(requested, signedThickness) {
  const normalized = String(requested || "").toLowerCase();
  if (normalized === "forward" || normalized === "reverse" || normalized === "midplane") {
    return normalized;
  }
  return signedThickness < 0 ? "reverse" : "forward";
}

export function toExtrudeDistances(thickness, placementMode) {
  if (placementMode === "reverse") return { distance: 0, distanceBack: thickness };
  if (placementMode === "midplane") {
    const half = thickness / 2;
    return { distance: half, distanceBack: half };
  }
  return { distance: thickness, distanceBack: 0 };
}

export function tagTabFaceTypes(sweep) {
  if (!sweep || typeof sweep.getFaceNames !== "function") return;
  const faceNames = sweep.getFaceNames();
  const startFaces = faceNames.filter((name) => name.endsWith("_START"));
  const endFaces = faceNames.filter((name) => name.endsWith("_END"));
  const thicknessFaces = faceNames.filter((name) => name.endsWith("_SW"));
  setSheetMetalFaceTypeMetadata(sweep, startFaces, SHEET_METAL_FACE_TYPES.A);
  setSheetMetalFaceTypeMetadata(sweep, endFaces, SHEET_METAL_FACE_TYPES.B);
  setSheetMetalFaceTypeMetadata(sweep, thicknessFaces, SHEET_METAL_FACE_TYPES.THICKNESS);
}

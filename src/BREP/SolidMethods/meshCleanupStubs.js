function removed(name) {
  throw new Error(`Solid.${name}() has been removed. Use OpenCASCADE-backed modeling operations.`);
}

export function removeSmallIslands() { return removed("removeSmallIslands"); }
export function removeSmallInternalIslands() { return removed("removeSmallInternalIslands"); }
export function removeOppositeSingleEdgeFaces() { return removed("removeOppositeSingleEdgeFaces"); }
export function removeTinyBoundaryTriangles() { return removed("removeTinyBoundaryTriangles"); }
export function collapseTinyTriangles() { return removed("collapseTinyTriangles"); }
export function cleanupTinyFaceIslands() { return removed("cleanupTinyFaceIslands"); }
export function remesh() { return removed("remesh"); }
export function splitSelfIntersectingTriangles() { return removed("splitSelfIntersectingTriangles"); }
export function removeDegenerateTriangles() { return removed("removeDegenerateTriangles"); }
export function removeInternalTriangles() { return removed("removeInternalTriangles"); }
export function removeInternalTrianglesByRaycast() { return removed("removeInternalTrianglesByRaycast"); }
export function removeInternalTrianglesByWinding() { return removed("removeInternalTrianglesByWinding"); }
export function mergeTinyFaces() { return removed("mergeTinyFaces"); }

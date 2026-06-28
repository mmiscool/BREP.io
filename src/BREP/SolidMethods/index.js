export { constructorImpl, clone, free } from "./lifecycle.js";
export {
    _key,
    _getPointIndex,
    _getOrCreateID,
    addTriangle,
    addAuxEdge,
    addCenterline,
} from "./authoring.js";
export {
    setFaceMetadata,
    getFaceMetadata,
    getFaceNames,
    deduplicateFaceNames,
    renameFace,
    setEdgeMetadata,
    getEdgeMetadata,
} from "./metadata.js";
export {
    bakeTransform,
    bakeTRS,
    mirrorAcrossPlane,
    pushFace,
} from "./transforms.js";
export {
    _manifoldize,
    setEpsilon,
    _weldVerticesByEpsilon,
    fixTriangleWindingsByAdjacency,
    _isCoherentlyOrientedManifold,
} from "./manifoldOps.js";
export {
    removeSmallIslands,
    removeOppositeSingleEdgeFaces,
    removeTinyBoundaryTriangles,
    collapseTinyTriangles,
    cleanupTinyFaceIslands,
    remesh,
    removeDegenerateTriangles,
    removeInternalTriangles,
    removeInternalTrianglesByRaycast,
    mergeTinyFaces,
} from "./meshCleanup.js";
export {
    findSelfIntersections,
    splitSelfIntersectingTriangles,
    cleanupSelfIntersections,
    removeInternalTrianglesByWinding,
} from "./selfIntersectionCleanup.js";
export {
    getMesh,
    _ensureFaceIndex,
    getFace,
    getFaceNormal,
    getFaces,
    getBoundaryEdgePolylines,
} from "./meshQueries.js";
export {
    union,
    unionMany,
    subtract,
    intersect,
    _expandTriIDsFromMesh as _expandTriIDsFromMeshStatic,
    simplify,
} from "./booleanOps.js";
export { toSTL, toSTEP } from "./io.js";
export { volume, surfaceArea, minGapToPoint, getTriangleCount } from "./metrics.js";
export { visualize } from "./visualize.js";
export { fillet } from "./fillet.js";
export { chamfer } from "./chamfer.js";
export { offsetShell } from "./offsetShell.js";

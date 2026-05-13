/**
 * Mesh queries and face utilities.
 */

import {
    cppSolidCoreHasNativeTopologyQueries,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
} from "../CppSolidCore.js";
import {
    hasOccShape,
    occBoundaryEdgePolylines,
    occFaceNormal,
    occFaces,
    tessellateOccState,
} from "../OpenCascadeKernel.js";

/** Return the underlying MeshGL (fresh from Manifold so it reflects any CSG). */
export function getMesh() {
    if (hasOccShape(this)) {
        this._occ.faceNameToID = this._faceNameToID;
        return tessellateOccState(this._occ);
    }
    return this._manifoldize().getMesh();
}

/** Build a cache: faceID -> array of triangle indices. */
export function _ensureFaceIndex() {
    if (this._faceIndex) return;
    const mesh = this.getMesh();
    const { triVerts, faceID } = mesh;
    const triCount = (triVerts.length / 3) | 0;
    const map = new Map();
    if (faceID && faceID.length === triCount) {
        for (let t = 0; t < triCount; t++) {
            const id = faceID[t];
            let arr = map.get(id);
            if (!arr) { arr = []; map.set(id, arr); }
            arr.push(t);
        }
    }
    this._faceIndex = map;
    try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { }
}

/**
 * Get all triangles belonging to a face by name.
 * Returns objects with positions; also includes vertex indices.
 */
export function getFace(name) {
    if (hasOccShape(this)) {
        return (occFaces(this) || []).find((entry) => entry.faceName === name) || { faceName: name, triangles: [] };
    }
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFace");
    return getSyncedCppSolidCore(this).getFace(name);
}

/**
 * Get the averaged authored normal for a face.
 * Returns { faceFound, validNormal, normal: [x, y, z], planarRatio, affectedVertexCount }.
 */
export function getFaceNormal(name) {
    if (hasOccShape(this)) return occFaceNormal(this, name);
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFaceNormal");
    return getSyncedCppSolidCore(this).getFaceNormal(name);
}

/**
 * Enumerate faces with their triangles in one pass.
 */
export function getFaces(includeEmpty = false) {
    if (hasOccShape(this)) {
        const faces = occFaces(this) || [];
        if (!includeEmpty) return faces.filter((face) => face.triangles?.length);
        const seen = new Set(faces.map((face) => face.faceName));
        for (const name of this.getFaceNames()) {
            if (!seen.has(name)) faces.push({ faceName: name, triangles: [] });
        }
        return faces;
    }
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFaces");
    return getSyncedCppSolidCore(this).getFaces(includeEmpty);
}

/**
 * Compute connected polylines for boundary edges between pairs of face labels.
 */
export function getBoundaryEdgePolylines() {
    if (hasOccShape(this)) return occBoundaryEdgePolylines(this);
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getBoundaryEdgePolylines");
    return getSyncedCppSolidCore(this).getBoundaryEdgePolylines();
}

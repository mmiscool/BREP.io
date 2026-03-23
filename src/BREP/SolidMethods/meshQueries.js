/**
 * Mesh queries and face utilities.
 */

import {
    cppSolidCoreHasNativeTopologyQueries,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
} from "../CppSolidCore.js";

/** Return the underlying MeshGL (fresh from Manifold so it reflects any CSG). */
export function getMesh() {
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
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFace");
    return getSyncedCppSolidCore(this).getFace(name);
}

/**
 * Enumerate faces with their triangles in one pass.
 */
export function getFaces(includeEmpty = false) {
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFaces");
    return getSyncedCppSolidCore(this).getFaces(includeEmpty);
}

/**
 * Compute connected polylines for boundary edges between pairs of face labels.
 */
export function getBoundaryEdgePolylines() {
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getBoundaryEdgePolylines");
    return getSyncedCppSolidCore(this).getBoundaryEdgePolylines();
}

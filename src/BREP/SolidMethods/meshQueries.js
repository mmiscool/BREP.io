/**
 * Mesh queries and face utilities.
 */

import {
    cppSolidCoreHasNativeTopologyQueries,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
} from "../CppSolidCore.js";

function pointFromAuthoringBuffers(vertProperties, vertexIndex, numProp = 3) {
    const stride = Math.max(3, Number(numProp) || 3);
    const base = (vertexIndex >>> 0) * stride;
    return [
        Number(vertProperties[base + 0]) || 0,
        Number(vertProperties[base + 1]) || 0,
        Number(vertProperties[base + 2]) || 0,
    ];
}

function getAuthoringFaceNameByID(solid, faceID) {
    const id = faceID >>> 0;
    if (solid?._idToFaceName instanceof Map) {
        const faceName = solid._idToFaceName.get(id);
        if (faceName != null) return String(faceName);
    }
    if (solid?._faceNameToID instanceof Map) {
        for (const [faceName, mappedID] of solid._faceNameToID.entries()) {
            if ((mappedID >>> 0) === id) return String(faceName);
        }
    }
    return String(id);
}

function buildAuthoringFaces(solid, includeEmpty = false) {
    const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
    const vertProperties = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
    const triCount = Math.min(triIDs.length, (triVerts.length / 3) | 0);
    const facesByName = new Map();

    if (includeEmpty && solid?._faceNameToID instanceof Map) {
        for (const faceName of solid._faceNameToID.keys()) {
            const key = String(faceName || "");
            if (key) facesByName.set(key, { faceName: key, triangles: [] });
        }
    }

    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const faceID = triIDs[triIndex] >>> 0;
        const faceName = getAuthoringFaceNameByID(solid, faceID);
        if (!facesByName.has(faceName)) facesByName.set(faceName, { faceName, triangles: [] });
        const base = triIndex * 3;
        const indices = [
            triVerts[base + 0] >>> 0,
            triVerts[base + 1] >>> 0,
            triVerts[base + 2] >>> 0,
        ];
        facesByName.get(faceName).triangles.push({
            faceName,
            indices,
            p1: pointFromAuthoringBuffers(vertProperties, indices[0], solid?._numProp),
            p2: pointFromAuthoringBuffers(vertProperties, indices[1], solid?._numProp),
            p3: pointFromAuthoringBuffers(vertProperties, indices[2], solid?._numProp),
        });
    }

    return Array.from(facesByName.values()).filter((face) => includeEmpty || face.triangles.length > 0);
}

function authoringTriangleCount(solid) {
    const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const triIDs = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
    return Math.min(triIDs.length, (triVerts.length / 3) | 0);
}

function returnedTriangleCount(faces) {
    return Array.isArray(faces)
        ? faces.reduce((sum, face) => sum + (Array.isArray(face?.triangles) ? face.triangles.length : 0), 0)
        : 0;
}

function shouldUseAuthoringFaceQueryFallback(solid, faces) {
    return authoringTriangleCount(solid) > 0 && returnedTriangleCount(faces) === 0;
}

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
    const nativeFace = getSyncedCppSolidCore(this).getFace(name);
    if (Array.isArray(nativeFace) && nativeFace.length > 0) return nativeFace;
    if (authoringTriangleCount(this) <= 0) return nativeFace;
    const faceName = String(name || "");
    const authoringFace = buildAuthoringFaces(this, false).find((face) => face.faceName === faceName);
    return authoringFace?.triangles || nativeFace;
}

/**
 * Get the averaged authored normal for a face.
 * Returns { faceFound, validNormal, normal: [x, y, z], planarRatio, affectedVertexCount }.
 */
export function getFaceNormal(name) {
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFaceNormal");
    return getSyncedCppSolidCore(this).getFaceNormal(name);
}

/**
 * Enumerate faces with their triangles in one pass.
 */
export function getFaces(includeEmpty = false) {
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getFaces");
    const nativeFaces = getSyncedCppSolidCore(this).getFaces(includeEmpty);
    if (!shouldUseAuthoringFaceQueryFallback(this, nativeFaces)) return nativeFaces;
    return buildAuthoringFaces(this, includeEmpty);
}

/**
 * Compute connected polylines for boundary edges between pairs of face labels.
 */
export function getBoundaryEdgePolylines() {
    requireCppSolidCoreCapability(cppSolidCoreHasNativeTopologyQueries, "Solid.getBoundaryEdgePolylines");
    return getSyncedCppSolidCore(this).getBoundaryEdgePolylines();
}

/**
 * Mesh queries and face utilities.
 */

import {
    hasOccShape,
    occBoundaryEdgePolylines,
    occFaceNormal,
    occFaces,
    tessellateOccState,
} from "../OpenCascadeKernel.js";

/** Return a tessellated mesh snapshot of the OCCT-backed solid. */
export function getMesh(options = {}) {
    if (hasOccShape(this)) {
        this._occ.faceNameToID = this._faceNameToID;
        return tessellateOccState(this._occ, options);
    }
    throw new Error("Solid.getMesh() requires an OpenCASCADE-backed solid.");
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
    throw new Error("Solid.getFace() requires an OpenCASCADE-backed solid.");
}

/**
 * Get the averaged authored normal for a face.
 * Returns { faceFound, validNormal, normal: [x, y, z], planarRatio, affectedVertexCount }.
 */
export function getFaceNormal(name) {
    if (hasOccShape(this)) return occFaceNormal(this, name);
    throw new Error("Solid.getFaceNormal() requires an OpenCASCADE-backed solid.");
}

/**
 * Enumerate faces with their triangles in one pass.
 */
export function getFaces(includeEmpty = false, options = {}) {
    if (hasOccShape(this)) {
        const faces = occFaces(this, options) || [];
        if (!includeEmpty) return faces.filter((face) => face.triangles?.length);
        const seen = new Set(faces.map((face) => face.faceName));
        for (const name of this.getFaceNames()) {
            if (!seen.has(name)) faces.push({ faceName: name, triangles: [] });
        }
        return faces;
    }
    throw new Error("Solid.getFaces() requires an OpenCASCADE-backed solid.");
}

/**
 * Compute connected polylines for boundary edges between pairs of face labels.
 */
export function getBoundaryEdgePolylines(options = {}) {
    if (hasOccShape(this)) return occBoundaryEdgePolylines(this, options);
    throw new Error("Solid.getBoundaryEdgePolylines() requires an OpenCASCADE-backed solid.");
}

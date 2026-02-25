import { Manifold } from "../SolidShared.js";

/**
 * Boolean operations and manifold reconstruction helpers.
 */

export function _combineIdMaps(other) {
    const merged = new Map(this._idToFaceName);
    for (const [id, name] of other._idToFaceName.entries()) {
        merged.set(id, name);
    }
    return merged;
}

function _invertFaceNameMap(nameToId) {
    const idToName = new Map();
    if (!nameToId || typeof nameToId.entries !== 'function') return idToName;
    for (const [name, id] of nameToId.entries()) {
        idToName.set(id, name);
    }
    return idToName;
}

function _collapseFaceIdsByName(solid) {
    if (!solid || !solid._faceNameToID || !solid._idToFaceName || !Array.isArray(solid._triIDs)) return false;
    const nameToId = solid._faceNameToID;
    const idToName = solid._idToFaceName;
    const triIDs = solid._triIDs;
    const canonicalById = new Map();
    let changed = false;

    for (let i = 0; i < triIDs.length; i++) {
        const id = triIDs[i];
        let canonical = canonicalById.get(id);
        if (canonical === undefined) {
            const name = idToName.get(id);
            canonical = (name !== undefined) ? (nameToId.get(name) ?? id) : id;
            canonicalById.set(id, canonical);
        }
        if (canonical !== id) {
            triIDs[i] = canonical;
            changed = true;
        }
    }

    if (!changed) return false;

    solid._idToFaceName = _invertFaceNameMap(solid._faceNameToID);
    solid._faceIndex = null;
    solid._dirty = true;
    try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
    solid._manifold = null;
    return true;
}

function baseSolidCtor(obj) {
    const ctor = obj && obj.constructor;
    return (ctor && ctor.BaseSolid) ? ctor.BaseSolid : ctor;
}

export function union(other) {
    const Solid = baseSolidCtor(this);
    const outManifold = Manifold.union(this._manifoldize(), other._manifoldize());
    const mergedMap = this._combineIdMaps(other);
    const out = Solid._fromManifold(outManifold, mergedMap);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    try { out._auxEdges = [...(this._auxEdges || []), ...(other?._auxEdges || [])]; } catch { }
    try { out._faceMetadata = this._combineFaceMetadata(other); } catch { }
    try { out._edgeMetadata = this._combineEdgeMetadata(other); } catch { }
    return out;
}

export function subtract(other) {
    const Solid = baseSolidCtor(this);
    const outManifold = this._manifoldize().subtract(other._manifoldize());

    const mergedMap = this._combineIdMaps(other);
    const out = Solid._fromManifold(outManifold, mergedMap);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    try { out._auxEdges = [...(this._auxEdges || []), ...(other?._auxEdges || [])]; } catch { }
    try { out._faceMetadata = this._combineFaceMetadata(other); } catch { }
    try { out._edgeMetadata = this._combineEdgeMetadata(other); } catch { }

    return out;
}

export function intersect(other) {
    const Solid = baseSolidCtor(this);
    const outManifold = Manifold.intersection(this._manifoldize(), other._manifoldize());
    const mergedMap = this._combineIdMaps(other);
    const out = Solid._fromManifold(outManifold, mergedMap);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    try { out._auxEdges = [...(this._auxEdges || []), ...(other?._auxEdges || [])]; } catch { }
    try { out._faceMetadata = this._combineFaceMetadata(other); } catch { }
    try { out._edgeMetadata = this._combineEdgeMetadata(other); } catch { }
    return out;
}

/**
 * Boolean difference A − B using Manifold's built-in API.
 * Equivalent to `subtract`, provided for semantic clarity.
 */
export function difference(other) {
    const Solid = baseSolidCtor(this);
    const outManifold = Manifold.difference(this._manifoldize(), other._manifoldize());
    const mergedMap = this._combineIdMaps(other);
    const out = Solid._fromManifold(outManifold, mergedMap);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    try { out._auxEdges = [...(this._auxEdges || []), ...(other?._auxEdges || [])]; } catch { }
    try { out._faceMetadata = this._combineFaceMetadata(other); } catch { }
    try { out._edgeMetadata = this._combineEdgeMetadata(other); } catch { }
    return out;
}

export function setTolerance(tolerance) {
    const Solid = baseSolidCtor(this);
    const m = this._manifoldize();
    const outM = m.setTolerance(tolerance);
    const mapCopy = new Map(this._idToFaceName);
    const out = Solid._fromManifold(outM, mapCopy);
    try { out._auxEdges = Array.isArray(this._auxEdges) ? this._auxEdges.slice() : []; } catch { }
    try { out._faceMetadata = new Map(this._faceMetadata); } catch { }
    try { out._edgeMetadata = new Map(this._edgeMetadata); } catch { }
    return out;
}
export function simplify(tolerance = undefined, updateInPlace = false) {
    const Solid = this.constructor;
    const m = this._manifoldize();

    // Run simplify on the manifold
    const outM = (tolerance === undefined) ? m.simplify() : m.simplify(tolerance);

    // Read back the simplified mesh and update this Solid in-place
    let meshOut = null;
    try {
        meshOut = outM.getMesh();

        // Replace geometry arrays
        this._numProp = meshOut.numProp;
        this._vertProperties = Array.from(meshOut.vertProperties);
        this._triVerts = Array.from(meshOut.triVerts);
        this._triIDs = Solid._expandTriIDsFromMesh(meshOut);

        // Defer rebuilding key map until authoring methods need it.
        this._vertKeyToIndex = new Map();

        // Keep existing face name map; best-effort completion for any new IDs
        const completeMap = new Map(this._idToFaceName);
        try {
            const ids = meshOut.faceID && meshOut.faceID.length ? meshOut.faceID : null;
            const triCount = (meshOut.triVerts?.length || 0) / 3 | 0;
            if (ids && ids.length === triCount) {
                const seen = new Set();
                for (let t = 0; t < triCount; t++) {
                    const id = ids[t] >>> 0;
                    if (seen.has(id)) continue;
                    seen.add(id);
                    if (!completeMap.has(id)) completeMap.set(id, `FACE_${id}`);
                }
            } else if (!ids) {
                if (!completeMap.has(0)) completeMap.set(0, 'FACE_0');
            }
        } catch { /* ignore */ }
        this._idToFaceName = completeMap;
        this._faceNameToID = new Map();
        for (const [id, name] of this._idToFaceName.entries()) {
            this._faceNameToID.set(name, id);
        }

        // Replace cached manifold and reset caches
        try { if (this._manifold && this._manifold !== outM && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
        this._manifold = outM;
        this._dirty = false;
        this._faceIndex = null;
    } finally {
        try { if (meshOut && typeof meshOut.delete === 'function') meshOut.delete(); } catch { }
    }

    if (updateInPlace) {
        _collapseFaceIdsByName(this);
        this._manifoldize();
        return this;
    }

    const mapForReturn = new Map(this._idToFaceName);

    // Detach this solid from `outM` before rebuilding a second solid from it.
    // This avoids sharing/deleting one manifold object between two Solid instances.
    this._manifold = null;
    this._dirty = true;
    this._faceIndex = null;
    _collapseFaceIdsByName(this);

    const returnObject = Solid._fromManifold(outM, mapForReturn);
    this._manifoldize();
    return returnObject;
}

export function _expandTriIDsFromMesh(mesh) {
    if (mesh.faceID && mesh.faceID.length) {
        return Array.from(mesh.faceID);
    }
    return new Array((mesh.triVerts.length / 3) | 0).fill(0);
}

export function _fromManifold(manifoldObj, idToFaceName) {
    const Solid = this;
    const mesh = manifoldObj.getMesh();
    const solid = new Solid();

    solid._numProp = mesh.numProp;
    solid._vertProperties = Array.from(mesh.vertProperties);
    solid._triVerts = Array.from(mesh.triVerts);
    solid._triIDs = Solid._expandTriIDsFromMesh(mesh);
    // Avoid O(vertexCount) string allocations here; authoring methods lazily rebuild this map.
    solid._vertKeyToIndex = new Map();

    const completeMap = new Map(idToFaceName);
    try {
        const ids = mesh.faceID && mesh.faceID.length ? mesh.faceID : null;
        const triCount = (mesh.triVerts?.length || 0) / 3 | 0;
        if (ids && ids.length === triCount) {
            const seen = new Set();
            for (let t = 0; t < triCount; t++) {
                const id = ids[t] >>> 0;
                if (seen.has(id)) continue;
                seen.add(id);
                if (!completeMap.has(id)) completeMap.set(id, `FACE_${id}`);
            }
        } else if (!ids) {
            if (!completeMap.has(0)) completeMap.set(0, 'FACE_0');
        }
    } catch (_) { /* best-effort completion */ }

    solid._idToFaceName = new Map(completeMap);
    solid._faceNameToID = new Map();
    for (const [id, name] of solid._idToFaceName.entries()) {
        solid._faceNameToID.set(name, id);
    }

    solid._manifold = manifoldObj;
    solid._dirty = false;
    _collapseFaceIdsByName(solid);
    try { return solid; } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { } }
}

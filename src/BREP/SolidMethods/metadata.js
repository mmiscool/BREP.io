/**
 * Face and edge metadata helpers.
 */

function collapseFaceIdsByName(solid) {
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

    const rebuiltIdToName = new Map();
    for (const [name, id] of nameToId.entries()) {
        if (id === undefined) continue;
        rebuiltIdToName.set(id, name);
    }
    solid._idToFaceName = rebuiltIdToName;

    if (changed) {
        solid._dirty = true;
        solid._faceIndex = null;
        try {
            if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete();
        } catch { }
        solid._manifold = null;
    }
    return changed;
}

function renameFaceIdsInMap(solid, oldName, newName) {
    if (!solid || !(solid._idToFaceName instanceof Map)) return;
    for (const [id, currentName] of solid._idToFaceName.entries()) {
        if (currentName !== oldName) continue;
        solid._idToFaceName.set(id, newName);
    }
}

/** Set metadata for a face (e.g., radius for cylindrical faces). */
export function setFaceMetadata(faceName, metadata) {
    if (!metadata || typeof metadata !== 'object') return this;
    const existing = this.getFaceMetadata(faceName);
    const base = existing && typeof existing === 'object' ? existing : {};
    this._faceMetadata.set(faceName, { ...base, ...metadata });
    return this;
}

/** Get metadata for a face. */
export function getFaceMetadata(faceName) {
    return this._faceMetadata.get(faceName) || {};
}

/** Convenience: list all face names present in this solid. */
export function getFaceNames() {
    return [...this._faceNameToID.keys()];
}

/** Rename a face; if newName exists, merge triangles/metadata into it. */
export function renameFace(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return this;
    const oldId = this._faceNameToID.get(oldName);
    if (oldId === undefined) return this;

    const newId = this._faceNameToID.get(newName);
    const oldMeta = (this._faceMetadata && this._faceMetadata.get(oldName));
    const newMeta = (this._faceMetadata && this._faceMetadata.get(newName));
    const mergedMeta = (oldMeta || newMeta) ? { ...(oldMeta || {}), ...(newMeta || {}) } : null;

    // Simple rename when the target name is unused (or maps to the same ID).
    if (newId === undefined || newId === oldId) {
        this._faceNameToID.delete(oldName);
        this._faceNameToID.set(newName, oldId);
        renameFaceIdsInMap(this, oldName, newName);
        if (this._faceMetadata) {
            if (mergedMeta) this._faceMetadata.set(newName, mergedMeta);
            this._faceMetadata.delete(oldName);
        }
        collapseFaceIdsByName(this);
        return this;
    }

    // Merge: retarget all triangles using oldId to the existing newId.
    let changed = false;
    for (let i = 0; i < this._triIDs.length; i++) {
        if (this._triIDs[i] === oldId) {
            this._triIDs[i] = newId;
            changed = true;
        }
    }

    this._faceNameToID.delete(oldName);
    if (this._idToFaceName) {
        this._idToFaceName.delete(oldId);
        renameFaceIdsInMap(this, oldName, newName);
        this._idToFaceName.set(newId, newName);
    }
    if (this._faceMetadata) {
        if (mergedMeta) this._faceMetadata.set(newName, mergedMeta);
        this._faceMetadata.delete(oldName);
    }
    if (changed) {
        this._dirty = true;
        this._faceIndex = null;
    }
    collapseFaceIdsByName(this);
    return this;
}

/** Set metadata for an edge. */
export function setEdgeMetadata(edgeName, metadata) {
    if (!metadata || typeof metadata !== 'object') return this;
    const existing = this.getEdgeMetadata(edgeName);
    const base = existing && typeof existing === 'object' ? existing : {};
    this._edgeMetadata.set(edgeName, { ...base, ...metadata });
    return this;
}

/** Get metadata for an edge. */
export function getEdgeMetadata(edgeName) {
    return this._edgeMetadata.get(edgeName) || null;
}

/** Combine face metadata maps across two solids. */
export function _combineFaceMetadata(other) {
    const merged = new Map(this._faceMetadata);
    if (other && other._faceMetadata) {
        for (const [faceName, metadata] of other._faceMetadata.entries()) {
            merged.set(faceName, { ...metadata });
        }
    }
    return merged;
}

/** Combine edge metadata maps across two solids. */
export function _combineEdgeMetadata(other) {
    const merged = new Map(this._edgeMetadata);
    if (other && other._edgeMetadata) {
        for (const [edgeName, metadata] of other._edgeMetadata.entries()) {
            merged.set(edgeName, { ...metadata });
        }
    }
    return merged;
}

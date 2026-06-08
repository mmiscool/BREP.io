/**
 * Face and edge metadata helpers.
 */

import {
    cppSolidCoreHasAuthoringBridge,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
} from "../CppSolidCore.js";

/** Set metadata for a face (e.g., radius for cylindrical faces). */
export function setFaceMetadata(faceName, metadata) {
    if (!metadata || typeof metadata !== 'object') return this;
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.setFaceMetadata");
    const core = getSyncedCppSolidCore(this);
    const existing = core.getFaceMetadata(faceName);
    const base = existing && typeof existing === 'object' ? existing : {};
    core.setFaceMetadata(faceName, { ...base, ...metadata });
    syncSolidAuthoringStateFromCpp(this, core);
    return this;
}

/** Get metadata for a face. */
export function getFaceMetadata(faceName) {
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getFaceMetadata");
    if (this._faceMetadata instanceof Map) {
        return this._faceMetadata.get(faceName) || {};
    }
    try { return this._cppSolidCore?.getFaceMetadata(faceName) || {}; } catch { return {}; }
}

/** Convenience: list all face names present in this solid. */
export function getFaceNames() {
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getFaceNames");
    if (this._faceNameToID instanceof Map && this._faceNameToID.size > 0) {
        return Array.from(this._faceNameToID.keys());
    }
    if (this._idToFaceName instanceof Map && this._idToFaceName.size > 0) {
        return Array.from(this._idToFaceName.values());
    }
    try { return this._cppSolidCore?.getFaceNames() || []; } catch { return []; }
}

/** Deduplicate face name tracking by keeping the first ID for each face name. */
export function deduplicateFaceNames() {
    const idToFaceName = this._idToFaceName instanceof Map ? this._idToFaceName : new Map();
    const faceNameToID = this._faceNameToID instanceof Map ? this._faceNameToID : new Map();
    if (idToFaceName.size === 0 && faceNameToID.size === 0) return this;

    const firstIDByName = new Map();
    const duplicateIDToFirstID = new Map();
    const nextIDToFaceName = new Map();

    for (const [id, faceName] of idToFaceName.entries()) {
        if (!firstIDByName.has(faceName)) {
            firstIDByName.set(faceName, id);
            nextIDToFaceName.set(id, faceName);
        } else {
            duplicateIDToFirstID.set(id, firstIDByName.get(faceName));
        }
    }

    for (const [faceName, id] of faceNameToID.entries()) {
        if (!firstIDByName.has(faceName)) {
            firstIDByName.set(faceName, id);
            nextIDToFaceName.set(id, faceName);
        }
    }

    if (duplicateIDToFirstID.size === 0) {
        this._idToFaceName = nextIDToFaceName;
        this._faceNameToID = new Map(Array.from(nextIDToFaceName.entries(), ([id, faceName]) => [faceName, id]));
        return this;
    }

    this._triIDs = Array.isArray(this._triIDs)
        ? this._triIDs.map((id) => duplicateIDToFirstID.get(id) ?? id)
        : [];
    this._idToFaceName = nextIDToFaceName;
    this._faceNameToID = new Map(Array.from(nextIDToFaceName.entries(), ([id, faceName]) => [faceName, id]));
    this._dirty = true;
    this._manifold = null;
    this._faceIndex = null;
    this._visualizeCache = null;
    this._cppSolidCoreSyncStamp = null;
    return this;
}

/** Rename a face; if newName exists, merge triangles/metadata into it. */
export function renameFace(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return this;
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.renameFace");
    const core = getSyncedCppSolidCore(this);
    const hadOldMetadata = this._faceMetadata instanceof Map && this._faceMetadata.has(oldName);
    const oldMetadata = hadOldMetadata ? (core.getFaceMetadata(oldName) || {}) : null;
    const existingMetadata = (this._faceMetadata instanceof Map && this._faceMetadata.has(newName))
        ? (core.getFaceMetadata(newName) || {})
        : null;
    const renamed = core.renameFace(oldName, newName);
    if (!renamed) return this;
    syncSolidAuthoringStateFromCpp(this, core);
    if (hadOldMetadata) {
        core.setFaceMetadata(newName, {
            ...(existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {}),
            ...(oldMetadata && typeof oldMetadata === 'object' ? oldMetadata : {}),
        });
        syncSolidAuthoringStateFromCpp(this, core);
    }
    this._dirty = true;
    this._faceIndex = null;
    return this;
}

/** Set metadata for an edge. */
export function setEdgeMetadata(edgeName, metadata) {
    if (!metadata || typeof metadata !== 'object') return this;
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.setEdgeMetadata");
    const core = getSyncedCppSolidCore(this);
    const existing = core.getEdgeMetadata(edgeName);
    const base = existing && typeof existing === 'object' ? existing : {};
    core.setEdgeMetadata(edgeName, { ...base, ...metadata });
    syncSolidAuthoringStateFromCpp(this, core);
    return this;
}

/** Get metadata for an edge. */
export function getEdgeMetadata(edgeName) {
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getEdgeMetadata");
    if (this._edgeMetadata instanceof Map) {
        return this._edgeMetadata.get(edgeName) || null;
    }
    try { return this._cppSolidCore?.getEdgeMetadata(edgeName) || null; } catch { return null; }
}

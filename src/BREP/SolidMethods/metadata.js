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

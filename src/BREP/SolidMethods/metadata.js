/**
 * Face and edge metadata helpers.
 */

import {
    cppSolidCoreHasAuthoringBridge,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
} from "../CppSolidCore.js";
import { hasOccShape } from "../OpenCascadeKernel.js";

/** Set metadata for a face (e.g., radius for cylindrical faces). */
export function setFaceMetadata(faceName, metadata) {
    if (!metadata || typeof metadata !== 'object') return this;
    if (hasOccShape(this)) {
        const existing = this._faceMetadata instanceof Map ? (this._faceMetadata.get(faceName) || {}) : {};
        if (!(this._faceMetadata instanceof Map)) this._faceMetadata = new Map();
        this._faceMetadata.set(faceName, { ...existing, ...metadata });
        if (this._occ) {
            if (!(this._occ.faceMetadata instanceof Map)) this._occ.faceMetadata = new Map();
            this._occ.faceMetadata.set(faceName, this._faceMetadata.get(faceName));
        }
        this._faceMetadataVersion = (this._faceMetadataVersion || 0) + 1;
        return this;
    }
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
    if (this._faceMetadata instanceof Map) {
        return this._faceMetadata.get(faceName) || {};
    }
    if (hasOccShape(this)) return {};
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getFaceMetadata");
    try { return this._cppSolidCore?.getFaceMetadata(faceName) || {}; } catch { return {}; }
}

/** Convenience: list all face names present in this solid. */
export function getFaceNames() {
    if (this._faceNameToID instanceof Map && this._faceNameToID.size > 0) {
        return Array.from(this._faceNameToID.keys());
    }
    if (this._idToFaceName instanceof Map && this._idToFaceName.size > 0) {
        return Array.from(this._idToFaceName.values());
    }
    if (hasOccShape(this)) return Array.from(this._occ?.faceNames || []);
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getFaceNames");
    try { return this._cppSolidCore?.getFaceNames() || []; } catch { return []; }
}

/** Rename a face; if newName exists, merge triangles/metadata into it. */
export function renameFace(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return this;
    if (hasOccShape(this)) {
        const id = this._faceNameToID?.get?.(oldName);
        if (id == null) return this;
        this._faceNameToID.delete(oldName);
        this._faceNameToID.set(newName, id);
        this._idToFaceName.set(id, newName);
        if (this._occ) {
            this._occ.faceNames = Array.from(this._occ.faceNames || []).map((name) => name === oldName ? newName : name);
            if (Array.isArray(this._occ.faceNameByIndex)) {
                this._occ.faceNameByIndex = this._occ.faceNameByIndex.map((name) => name === oldName ? newName : name);
            }
            this._occ.meshCache = null;
        }
        if (this._faceMetadata instanceof Map && this._faceMetadata.has(oldName)) {
            const oldMetadata = this._faceMetadata.get(oldName);
            const existing = this._faceMetadata.get(newName) || {};
            this._faceMetadata.delete(oldName);
            this._faceMetadata.set(newName, { ...existing, ...oldMetadata });
        }
        this._faceMetadataVersion = (this._faceMetadataVersion || 0) + 1;
        this._faceIndex = null;
        return this;
    }
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
    if (hasOccShape(this)) {
        const existing = this._edgeMetadata instanceof Map ? (this._edgeMetadata.get(edgeName) || {}) : {};
        if (!(this._edgeMetadata instanceof Map)) this._edgeMetadata = new Map();
        this._edgeMetadata.set(edgeName, { ...existing, ...metadata });
        if (this._occ) {
            if (!(this._occ.edgeMetadata instanceof Map)) this._occ.edgeMetadata = new Map();
            this._occ.edgeMetadata.set(edgeName, this._edgeMetadata.get(edgeName));
        }
        this._edgeMetadataVersion = (this._edgeMetadataVersion || 0) + 1;
        return this;
    }
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
    if (this._edgeMetadata instanceof Map) {
        return this._edgeMetadata.get(edgeName) || null;
    }
    if (hasOccShape(this)) return null;
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.getEdgeMetadata");
    try { return this._cppSolidCore?.getEdgeMetadata(edgeName) || null; } catch { return null; }
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

import { booleanOccSolids, hasOccShape, setOccState } from "../OpenCascadeKernel.js";

/**
 * Boolean operations and manifold reconstruction helpers.
 */

const BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME = 0.01;
const BOOLEAN_RESULT_WELD_EPSILON = 0.0015;

function _isFallbackFaceName(name, idHint = null) {
    if (name == null) return true;
    const raw = String(name).trim();
    if (!raw) return true;
    if (raw === 'FACE') return true;
    if (/^FACE_\d+$/.test(raw)) return true;
    if (Number.isFinite(idHint) && raw === `FACE_${idHint >>> 0}`) return true;
    return false;
}

export function _combineIdMaps(other) {
    const left = (this?._idToFaceName instanceof Map) ? this._idToFaceName : new Map();
    const right = (other?._idToFaceName instanceof Map) ? other._idToFaceName : new Map();
    const merged = new Map(left);
    for (const [id, name] of right.entries()) {
        const incoming = (name == null) ? '' : String(name);
        const existing = merged.get(id);
        if (existing === undefined) {
            merged.set(id, incoming);
            continue;
        }
        if (existing === incoming) continue;

        const idNum = Number(id);
        const idHint = Number.isFinite(idNum) ? (idNum >>> 0) : null;
        const existingIsFallback = _isFallbackFaceName(existing, idHint);
        const incomingIsFallback = _isFallbackFaceName(incoming, idHint);

        // Prefer descriptive names over fallback FACE_* labels.
        if (existingIsFallback && !incomingIsFallback) {
            merged.set(id, incoming);
            continue;
        }
        if (!existingIsFallback && incomingIsFallback) continue;

        // For true collisions between two descriptive labels, keep the left
        // side name so target-solid face names remain stable through booleans.
    }
    return merged;
}

function baseSolidCtor(obj) {
    const ctor = obj && obj.constructor;
    return (ctor && ctor.BaseSolid) ? ctor.BaseSolid : ctor;
}

function toMetadataJsonEntries(entriesLike) {
    if (entriesLike instanceof Map) {
        return Array.from(entriesLike.entries(), ([name, metadata]) => [
            String(name || ""),
            String(metadata || ""),
        ]).filter((entry) => entry[0]);
    }
    if (Array.isArray(entriesLike)) {
        return Array.from(entriesLike, ([name, metadata]) => [
            String(name || ""),
            String(metadata || ""),
        ]).filter((entry) => entry[0]);
    }
    return [];
}

function toSnapshotEntries(entriesLike) {
    if (entriesLike instanceof Map) {
        return Array.from(entriesLike.entries());
    }
    if (Array.isArray(entriesLike)) {
        return Array.from(entriesLike);
    }
    return [];
}

function buildNativeBooleanResult(left, right, operation, SolidCtor) {
    if (!hasOccShape(left) || !hasOccShape(right)) {
        throw new Error(`Solid.${String(operation || "boolean").toLowerCase()} requires OpenCASCADE-backed solids.`);
    }
    const occState = booleanOccSolids(left, right, operation);
    if (occState) {
        const solid = new SolidCtor();
        setOccState(solid, occState);
        solid._auxEdges = [
            ...(Array.isArray(left?._auxEdges) ? left._auxEdges : []),
            ...(Array.isArray(right?._auxEdges) ? right._auxEdges : []),
        ];
        try { solid.name = left?.name || `${operation}_RESULT`; } catch { }
        return solid;
    }
    throw new Error(`OpenCASCADE ${String(operation || "boolean").toLowerCase()} failed.`);
}

function _dropDisconnectedIslandsByVolume(solid, minVolume = BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME) {
    return 0;
}

function _applyFixedBooleanResultWeld(solid) {
    const epsilon = Number(BOOLEAN_RESULT_WELD_EPSILON);
    if (!solid || typeof solid.setEpsilon !== "function") return solid;
    if (!Number.isFinite(epsilon) || epsilon <= 0) return solid;
    solid.setEpsilon(epsilon);
    return solid;
}

function _cleanupBooleanResult(solid) {
    try { _dropDisconnectedIslandsByVolume(solid, BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME); } catch { }
    return _applyFixedBooleanResultWeld(solid);
}

export function union(other) {
    const Solid = baseSolidCtor(this);
    const out = buildNativeBooleanResult(this, other, "UNION", Solid);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    return _cleanupBooleanResult(out);
}

export function subtract(other) {
    const Solid = baseSolidCtor(this);
    const out = buildNativeBooleanResult(this, other, "SUBTRACT", Solid);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }

    return _cleanupBooleanResult(out);
}

export function intersect(other) {
    const Solid = baseSolidCtor(this);
    const out = buildNativeBooleanResult(this, other, "INTERSECT", Solid);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    return _cleanupBooleanResult(out);
}

/**
 * Boolean difference A − B using Manifold's built-in API.
 * Equivalent to `subtract`, provided for semantic clarity.
 */
export function difference(other) {
    const Solid = baseSolidCtor(this);
    const out = buildNativeBooleanResult(this, other, "DIFFERENCE", Solid);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    return _cleanupBooleanResult(out);
}

export function setTolerance(tolerance) {
    return this.clone();
}
export function simplify(tolerance = undefined, updateInPlace = false) {
    const out = this.clone();
    if (updateInPlace) {
        if (hasOccShape(out)) setOccState(this, out._occ);
        return this;
    }
    return out;
}

export function _expandTriIDsFromMesh(mesh) {
    if (mesh.faceID && mesh.faceID.length) {
        return Array.from(mesh.faceID);
    }
    return new Array((mesh.triVerts.length / 3) | 0).fill(0);
}

export function _fromManifold(manifoldObj, idToFaceName, opts = {}) {
    throw new Error("Solid._fromManifold() is disabled in the OpenCASCADE kernel.");
}

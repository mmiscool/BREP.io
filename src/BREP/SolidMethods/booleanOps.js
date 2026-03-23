import {
    applySolidAuthoringStateSnapshot,
    cppSolidCoreHasNativeDisconnectedIslandCleanup,
    getSolidAuthoringStateSnapshot,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
} from "../CppSolidCore.js";
import { manifold } from "../setupManifold.js";

/**
 * Boolean operations and manifold reconstruction helpers.
 */

const BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME = 0.01;

function hasNativeBooleanCombinedBuilder() {
    return typeof manifold?.buildBooleanCombinedAuthoringState === "function";
}

function requireNativeBooleanCombinedBuilder(methodName) {
    if (hasNativeBooleanCombinedBuilder()) return;
    throw new Error(`${methodName} requires the custom local manifold build with native boolean result reconstruction support.`);
}

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

function solidFromNativeBooleanSnapshot(SolidCtor, snapshot, name) {
    const solid = new SolidCtor();
    applySolidAuthoringStateSnapshot(solid, snapshot);
    solid._dirty = true;
    solid._manifold = null;
    solid._faceIndex = null;
    try { solid.name = name || snapshot?.name || solid?.name; } catch { }
    return solid;
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

function toNativeBooleanSnapshot(snapshot) {
    return {
        numProp: Number(snapshot?.numProp ?? 3),
        vertProperties: Array.from(snapshot?.vertProperties ?? []),
        triVerts: Array.from(snapshot?.triVerts ?? []),
        triIDs: Array.from(snapshot?.triIDs ?? []),
        faceNameToID: toSnapshotEntries(snapshot?.faceNameToID),
        idToFaceName: toSnapshotEntries(snapshot?.idToFaceName),
        faceMetadataJson: toMetadataJsonEntries(snapshot?.faceMetadataJson),
        edgeMetadataJson: toMetadataJsonEntries(snapshot?.edgeMetadataJson),
        auxEdges: Array.isArray(snapshot?.auxEdges) ? snapshot.auxEdges : [],
        vertexCount: Number(snapshot?.vertexCount ?? 0),
        triangleCount: Number(snapshot?.triangleCount ?? 0),
    };
}

function buildNativeSnapshotFromManifold(manifoldObj, idToFaceName, opts = {}) {
    requireCppSolidCoreCapability(
        typeof manifold?.buildSolidAuthoringStateFromMesh === "function",
        "Solid._fromManifold",
    );
    const mesh = manifoldObj.getMesh();
    try {
        const resolvedIdToFaceName = new Map(idToFaceName instanceof Map ? idToFaceName : []);
        const faceNameToID = new Map();
        for (const [id, name] of resolvedIdToFaceName.entries()) {
            if (!faceNameToID.has(name)) faceNameToID.set(name, id);
        }
        return manifold.buildSolidAuthoringStateFromMesh({
            numProp: Number(mesh?.numProp ?? 3),
            vertProperties: Array.from(mesh?.vertProperties ?? []),
            triVerts: Array.from(mesh?.triVerts ?? []),
            faceID: Array.from(mesh?.faceID ?? []),
            faceNameToID: Array.from(faceNameToID.entries()),
            idToFaceName: Array.from(resolvedIdToFaceName.entries()),
            faceMetadataJson: toMetadataJsonEntries(opts?.faceMetadataJson),
            edgeMetadataJson: toMetadataJsonEntries(opts?.edgeMetadataJson),
            auxEdges: Array.isArray(opts?.auxEdges) ? opts.auxEdges : [],
            name: opts?.name || "",
        });
    } finally {
        try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
    }
}

function buildNativeBooleanResult(left, right, operation, SolidCtor) {
    requireNativeBooleanCombinedBuilder(`Solid.${String(operation || "boolean").toLowerCase()}`);
    const leftSnapshot = getSolidAuthoringStateSnapshot(left);
    const rightSnapshot = getSolidAuthoringStateSnapshot(right);
    const snapshot = manifold.buildBooleanCombinedAuthoringState({
        // Native synced snapshots expose face/edge tables as JS Maps; serialize them
        // to plain entry arrays so the C++ boolean builder can read them reliably.
        leftSnapshot: toNativeBooleanSnapshot(leftSnapshot),
        rightSnapshot: toNativeBooleanSnapshot(rightSnapshot),
        operation,
        featureID: String(left?.owningFeatureID || left?.name || operation || "BOOLEAN"),
        name: String(left?.name || `${operation}_RESULT`),
        cleanupTinyFaceIslandsArea: BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME,
        disconnectedIslandMinVolume: BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME,
    });
    return solidFromNativeBooleanSnapshot(SolidCtor, snapshot, left?.name || `${operation}_RESULT`);
}

function _dropDisconnectedIslandsByVolume(solid, minVolume = BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME) {
    const threshold = Number(minVolume);
    if (!Number.isFinite(threshold) || threshold <= 0) return 0;
    if (!solid || typeof solid !== "object") return 0;
    requireCppSolidCoreCapability(
        cppSolidCoreHasNativeDisconnectedIslandCleanup,
        "Solid._dropDisconnectedIslandsByVolume",
    );
    const core = getSyncedCppSolidCore(solid);
    const removed = core.removeDisconnectedIslandsByVolume(threshold);
    if (removed > 0) {
        syncSolidAuthoringStateFromCpp(solid, core);
        solid._dirty = true;
        solid._faceIndex = null;
        try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
        solid._manifold = null;
    }
    return removed;
}

function _cleanupBooleanResult(solid) {
    try { _dropDisconnectedIslandsByVolume(solid, BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME); } catch { }
    return solid;
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
    const Solid = baseSolidCtor(this);
    const m = this._manifoldize();
    const outM = m.setTolerance(tolerance);
    const authoringSnapshot = getSolidAuthoringStateSnapshot(this);
    const out = Solid._fromManifold(outM, new Map(this._idToFaceName), {
        faceMetadataJson: authoringSnapshot?.faceMetadataJson,
        edgeMetadataJson: authoringSnapshot?.edgeMetadataJson,
        auxEdges: authoringSnapshot?.auxEdges,
        name: this?.name || "",
    });
    return out;
}
export function simplify(tolerance = undefined, updateInPlace = false) {
    const Solid = this.constructor;
    const m = this._manifoldize();
    const authoringSnapshot = getSolidAuthoringStateSnapshot(this);

    // Run simplify on the manifold
    const outM = (tolerance === undefined) ? m.simplify() : m.simplify(tolerance);
    const outSnapshot = buildNativeSnapshotFromManifold(outM, this._idToFaceName, {
        faceMetadataJson: authoringSnapshot?.faceMetadataJson,
        edgeMetadataJson: authoringSnapshot?.edgeMetadataJson,
        auxEdges: authoringSnapshot?.auxEdges,
        name: this?.name || "",
    });

    applySolidAuthoringStateSnapshot(this, outSnapshot);
    try { if (this._manifold && this._manifold !== outM && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
    this._manifold = outM;
    this._dirty = false;
    this._faceIndex = null;

    if (updateInPlace) {
        return this;
    }

    // Detach this solid from `outM` before rebuilding a second solid from it.
    // This avoids sharing/deleting one manifold object between two Solid instances.
    this._manifold = null;
    this._dirty = true;
    this._faceIndex = null;
    const returnObject = solidFromNativeBooleanSnapshot(Solid, outSnapshot, this?.name || "");
    this._manifoldize();
    return returnObject;
}

export function _expandTriIDsFromMesh(mesh) {
    if (mesh.faceID && mesh.faceID.length) {
        return Array.from(mesh.faceID);
    }
    return new Array((mesh.triVerts.length / 3) | 0).fill(0);
}

export function _fromManifold(manifoldObj, idToFaceName, opts = {}) {
    const Solid = this;
    const solid = new Solid();
    const snapshot = buildNativeSnapshotFromManifold(manifoldObj, idToFaceName, opts);
    applySolidAuthoringStateSnapshot(solid, snapshot);
    solid._manifold = manifoldObj;
    solid._dirty = false;
    solid._faceIndex = null;
    return solid;
}

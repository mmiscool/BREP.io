import { Manifold } from "../SolidShared.js";

/**
 * Boolean operations and manifold reconstruction helpers.
 */

const BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME = 0.01;

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

function _dropDisconnectedIslandsByVolume(solid, minVolume = BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME) {
    const threshold = Number(minVolume);
    if (!Number.isFinite(threshold) || threshold <= 0) return 0;
    if (!solid || typeof solid !== "object") return 0;

    const tv = solid._triVerts;
    const vp = solid._vertProperties;
    const triCount = (tv?.length || 0) / 3 | 0;
    if (!Array.isArray(tv) || !Array.isArray(vp) || triCount <= 1) return 0;

    const nv = (vp.length / 3) | 0;
    if (nv <= 0) return 0;
    const triIDs = (Array.isArray(solid._triIDs) && solid._triIDs.length >= triCount)
        ? solid._triIDs
        : new Array(triCount).fill(0);

    const stride = Math.max(1, nv + 1);
    const edgeKey = (a, b) => {
        const A = a >>> 0;
        const B = b >>> 0;
        return (A < B) ? (A * stride + B) : (B * stride + A);
    };

    const edgeToTris = new Map();
    for (let t = 0; t < triCount; t++) {
        const base = t * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;
        const edges = [[i0, i1], [i1, i2], [i2, i0]];
        for (let k = 0; k < 3; k++) {
            const key = edgeKey(edges[k][0], edges[k][1]);
            let arr = edgeToTris.get(key);
            if (!arr) { arr = []; edgeToTris.set(key, arr); }
            arr.push(t);
        }
    }

    const adj = new Array(triCount);
    for (let t = 0; t < triCount; t++) adj[t] = [];
    for (const tris of edgeToTris.values()) {
        if (!tris || tris.length < 2) continue;
        const root = tris[0] | 0;
        for (let i = 1; i < tris.length; i++) {
            const other = tris[i] | 0;
            if (other === root) continue;
            adj[root].push(other);
            adj[other].push(root);
        }
    }

    const compId = new Int32Array(triCount).fill(-1);
    const compVol6 = [];
    const compSizes = [];
    const stack = [];
    let compCount = 0;

    for (let seed = 0; seed < triCount; seed++) {
        if (compId[seed] !== -1) continue;

        stack.length = 0;
        stack.push(seed);
        compId[seed] = compCount;
        compVol6.push(0);
        compSizes.push(0);
        while (stack.length) {
            const t = stack.pop() | 0;
            compSizes[compCount] += 1;

            const b = t * 3;
            const i0 = (tv[b + 0] >>> 0) * 3;
            const i1 = (tv[b + 1] >>> 0) * 3;
            const i2 = (tv[b + 2] >>> 0) * 3;
            if (i0 + 2 < vp.length && i1 + 2 < vp.length && i2 + 2 < vp.length) {
                const x0 = vp[i0 + 0], y0 = vp[i0 + 1], z0 = vp[i0 + 2];
                const x1 = vp[i1 + 0], y1 = vp[i1 + 1], z1 = vp[i1 + 2];
                const x2 = vp[i2 + 0], y2 = vp[i2 + 1], z2 = vp[i2 + 2];
                compVol6[compCount] += x0 * (y1 * z2 - z1 * y2)
                    - y0 * (x1 * z2 - z1 * x2)
                    + z0 * (x1 * y2 - y1 * x2);
            }

            const nbrs = adj[t];
            for (let j = 0; j < nbrs.length; j++) {
                const u = nbrs[j] | 0;
                if (compId[u] !== -1) continue;
                compId[u] = compCount;
                stack.push(u);
            }
        }
        compCount++;
    }

    if (compCount <= 1) return 0;

    let mainIdx = 0;
    for (let i = 1; i < compCount; i++) {
        const bestVol = Math.abs(compVol6[mainIdx] || 0);
        const nextVol = Math.abs(compVol6[i] || 0);
        if (nextVol > bestVol + 1e-12 || (Math.abs(nextVol - bestVol) <= 1e-12 && compSizes[i] > compSizes[mainIdx])) {
            mainIdx = i;
        }
    }

    const removeComp = new Uint8Array(compCount);
    for (let i = 0; i < compCount; i++) {
        if (i === mainIdx) continue;
        const compVolume = Math.abs(compVol6[i] || 0) / 6.0;
        if (compVolume < threshold) removeComp[i] = 1;
    }
    let removed = 0;
    for (let t = 0; t < triCount; t++) if (removeComp[compId[t]]) removed++;
    if (removed === 0) return 0;

    const usedVert = new Uint8Array(nv);
    const newTriVerts = [];
    const newTriIDs = [];
    for (let t = 0; t < triCount; t++) {
        if (removeComp[compId[t]]) continue;
        const b = t * 3;
        const a = tv[b + 0] >>> 0;
        const c = tv[b + 1] >>> 0;
        const d = tv[b + 2] >>> 0;
        if (a >= nv || c >= nv || d >= nv) continue;
        newTriVerts.push(a, c, d);
        newTriIDs.push(triIDs[t] ?? 0);
        usedVert[a] = 1;
        usedVert[c] = 1;
        usedVert[d] = 1;
    }

    const oldToNew = new Int32Array(nv);
    for (let i = 0; i < nv; i++) oldToNew[i] = -1;
    const newVP = [];
    let write = 0;
    for (let i = 0; i < nv; i++) {
        if (!usedVert[i]) continue;
        oldToNew[i] = write++;
        newVP.push(vp[i * 3 + 0], vp[i * 3 + 1], vp[i * 3 + 2]);
    }
    for (let i = 0; i < newTriVerts.length; i++) {
        newTriVerts[i] = oldToNew[newTriVerts[i]];
    }

    solid._vertProperties = newVP;
    solid._triVerts = newTriVerts;
    solid._triIDs = newTriIDs;
    solid._vertKeyToIndex = new Map();
    for (let i = 0; i < newVP.length; i += 3) {
        const x = newVP[i], y = newVP[i + 1], z = newVP[i + 2];
        solid._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }
    solid._dirty = true;
    solid._faceIndex = null;
    try { if (solid._manifold && typeof solid._manifold.delete === 'function') solid._manifold.delete(); } catch { }
    solid._manifold = null;

    return removed;
}

function _cleanupBooleanResult(solid) {
    try { _dropDisconnectedIslandsByVolume(solid, BOOLEAN_DISCONNECTED_ISLAND_MIN_VOLUME); } catch { }
    return solid;
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
    return _cleanupBooleanResult(out);
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

    return _cleanupBooleanResult(out);
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
    return _cleanupBooleanResult(out);
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
    return _cleanupBooleanResult(out);
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

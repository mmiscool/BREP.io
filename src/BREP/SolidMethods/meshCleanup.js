import {
    cppSolidCoreHasAuthoringBridge,
    cppSolidCoreHasNativeInternalTriangleCleanup,
    cppSolidCoreHasNativeSmallIslandCleanup,
    cppSolidCoreHasNativeTinyFaceIslandCleanup,
    cppSolidCoreHasNativeTinyFaceMerge,
    getSyncedCppSolidCore,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
} from "../CppSolidCore.js";

/**
 * Mesh cleanup and refinement utilities.
 */
/**
 * Remove small disconnected triangle islands relative to the largest shell.
 * @param {object} [options]
 * @param {number} [options.maxTriangles=30] triangle-count threshold for removal
 * @param {boolean} [options.removeInternal=true] drop islands inside the main shell
 * @param {boolean} [options.removeExternal=true] drop islands outside the main shell
 */
export function removeSmallIslands({ maxTriangles = 30, removeInternal = true, removeExternal = true } = {}) {
    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeSmallIslandCleanup,
        "Solid.removeSmallIslands()"
    );
    const core = getSyncedCppSolidCore(this);
    const removed = core.removeSmallIslands(maxTriangles, removeInternal, removeExternal);
    if (removed > 0) {
        syncSolidAuthoringStateFromCpp(this, core);
        this._dirty = true;
        this._faceIndex = null;
        try { if (this._manifold && typeof this._manifold.delete === "function") this._manifold.delete(); } catch { }
        this._manifold = null;
    }
    return removed;
}

/**
 * Remove faces that only connect via a single shared edge chain to an opposite-facing neighbor.
 * @param {object} [options]
 * @param {number} [options.normalDotThreshold=-0.95] dot-product threshold for opposite normals
 * @returns {number} triangles removed
 */
export function removeOppositeSingleEdgeFaces({ normalDotThreshold = -0.95 } = {}) {
    const tv = this._triVerts;
    const vp = this._vertProperties;
    const ids = this._triIDs;
    if (!tv || !vp || !ids) return 0;
    const triCount = (tv.length / 3) | 0;
    if (triCount === 0 || ids.length !== triCount) return 0;
    const nv = (vp.length / 3) | 0;
    if (nv === 0) return 0;

    const NV = BigInt(Math.max(1, nv));
    const eKey = (a, b) => {
        const A = BigInt(a), B = BigInt(b);
        return A < B ? (A * NV + B) : (B * NV + A);
    };

    const faceNormals = new Map(); // id -> [nx, ny, nz]
    const addNormal = (id, nx, ny, nz) => {
        let entry = faceNormals.get(id);
        if (!entry) { entry = [0, 0, 0]; faceNormals.set(id, entry); }
        entry[0] += nx; entry[1] += ny; entry[2] += nz;
    };

    const edgeMap = new Map(); // key -> {faces:Set, a, b}

    for (let t = 0; t < triCount; t++) {
        const id = ids[t];
        if (id === undefined || id === null) continue;
        const base = t * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;

        const ax = vp[i0 * 3 + 0], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
        const bx = vp[i1 * 3 + 0], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
        const cx = vp[i2 * 3 + 0], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        addNormal(id, nx, ny, nz);

        const edges = [[i0, i1], [i1, i2], [i2, i0]];
        for (let k = 0; k < 3; k++) {
            let a = edges[k][0];
            let b = edges[k][1];
            if (a === b) continue;
            const key = eKey(a, b);
            let entry = edgeMap.get(key);
            if (!entry) {
                if (a > b) { const tmp = a; a = b; b = tmp; }
                entry = { faces: new Set(), a, b };
                edgeMap.set(key, entry);
            }
            entry.faces.add(id);
        }
    }

    const pairEdges = new Map(); // key -> { ids: [idA, idB], edges: [[u, v], ...] }
    const facePairs = new Map(); // faceId -> Set(pairKey)
    const addPair = (faceId, pairKey) => {
        let set = facePairs.get(faceId);
        if (!set) { set = new Set(); facePairs.set(faceId, set); }
        set.add(pairKey);
    };

    for (const entry of edgeMap.values()) {
        if (entry.faces.size !== 2) continue;
        const faces = Array.from(entry.faces);
        const idA = faces[0];
        const idB = faces[1];
        if (idA === idB) continue;
        const pairKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
        let pair = pairEdges.get(pairKey);
        if (!pair) {
            pair = {
                ids: idA < idB ? [idA, idB] : [idB, idA],
                edges: [],
            };
            pairEdges.set(pairKey, pair);
        }
        pair.edges.push([entry.a, entry.b]);
        addPair(idA, pairKey);
        addPair(idB, pairKey);
    }

    const isSingleEdgeChain = (edges) => {
        if (!edges || edges.length === 0) return false;
        const adj = new Map();
        const verts = new Set();
        for (const [u, v] of edges) {
            verts.add(u); verts.add(v);
            if (!adj.has(u)) adj.set(u, new Set());
            if (!adj.has(v)) adj.set(v, new Set());
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        let components = 0;
        const visited = new Set();
        for (const v of verts) {
            if (visited.has(v)) continue;
            components++;
            if (components > 1) return false;
            const stack = [v];
            visited.add(v);
            while (stack.length) {
                const cur = stack.pop();
                const nbrs = adj.get(cur);
                if (!nbrs) continue;
                for (const n of nbrs) {
                    if (visited.has(n)) continue;
                    visited.add(n);
                    stack.push(n);
                }
            }
        }
        return components === 1;
    };

    const toRemove = new Set();
    for (const [faceId, pairs] of facePairs.entries()) {
        if (pairs.size !== 1) continue;
        const pairKey = pairs.values().next().value;
        const pair = pairEdges.get(pairKey);
        if (!pair || !pair.edges.length) continue;
        if (!isSingleEdgeChain(pair.edges)) continue;
        const otherId = pair.ids[0] === faceId ? pair.ids[1] : pair.ids[0];
        const n0 = faceNormals.get(faceId);
        const n1 = faceNormals.get(otherId);
        if (!n0 || !n1) continue;
        const len0 = Math.hypot(n0[0], n0[1], n0[2]);
        const len1 = Math.hypot(n1[0], n1[1], n1[2]);
        if (!(len0 > 1e-12) || !(len1 > 1e-12)) continue;
        const dot = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (len0 * len1);
        if (dot <= normalDotThreshold) toRemove.add(faceId);
    }

    if (!toRemove.size) return 0;

    const keepTri = new Uint8Array(triCount);
    let removed = 0;
    for (let t = 0; t < triCount; t++) {
        if (toRemove.has(ids[t])) {
            removed++;
            continue;
        }
        keepTri[t] = 1;
    }
    if (removed === 0) return 0;

    const usedVert = new Uint8Array(nv);
    const newTriVerts = [];
    const newTriIDs = [];
    for (let t = 0; t < triCount; t++) {
        if (!keepTri[t]) continue;
        const b = t * 3;
        const a = tv[b + 0] >>> 0;
        const b1 = tv[b + 1] >>> 0;
        const c = tv[b + 2] >>> 0;
        newTriVerts.push(a, b1, c);
        newTriIDs.push(ids[t]);
        usedVert[a] = 1; usedVert[b1] = 1; usedVert[c] = 1;
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

    this._vertProperties = newVP;
    this._triVerts = newTriVerts;
    this._triIDs = newTriIDs;
    this._vertKeyToIndex = new Map();
    for (let i = 0; i < this._vertProperties.length; i += 3) {
        const x = this._vertProperties[i], y = this._vertProperties[i + 1], z = this._vertProperties[i + 2];
        this._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }
    this._dirty = true;
    this._faceIndex = null;
    this._manifold = null;
    return removed;
}

/**
 * Remove tiny triangles that lie along boundaries between faces by performing
 * local 2–2 edge flips across inter-face edges.
 */
export function removeTinyBoundaryTriangles(areaThreshold, maxIterations = 1) {
    const thr = Number(areaThreshold);
    if (!Number.isFinite(thr) || thr <= 0) return 0;
    const vp = this._vertProperties;
    if (!vp || vp.length < 9 || this._triVerts.length < 3) return 0;

    const triArea = (i0, i1, i2) => {
        const x0 = vp[i0 * 3 + 0], y0 = vp[i0 * 3 + 1], z0 = vp[i0 * 3 + 2];
        const x1 = vp[i1 * 3 + 0], y1 = vp[i1 * 3 + 1], z1 = vp[i1 * 3 + 2];
        const x2 = vp[i2 * 3 + 0], y2 = vp[i2 * 3 + 1], z2 = vp[i2 * 3 + 2];
        const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
        const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        return 0.5 * Math.hypot(cx, cy, cz);
    };

    let totalFlips = 0;
    const iterMax = Math.max(1, (maxIterations | 0));

    for (let iter = 0; iter < iterMax; iter++) {
        const tv = this._triVerts;
        const ids = this._triIDs;
        const triCount = (tv.length / 3) | 0;
        if (triCount < 2) break;

        const tris = new Array(triCount);
        const areas = new Float64Array(triCount);
        for (let t = 0; t < triCount; t++) {
            const b = t * 3;
            const i0 = tv[b + 0] >>> 0;
            const i1 = tv[b + 1] >>> 0;
            const i2 = tv[b + 2] >>> 0;
            tris[t] = [i0, i1, i2];
            areas[t] = triArea(i0, i1, i2);
        }

        const nv = (vp.length / 3) | 0;
        const NV = BigInt(nv);
        const eKey = (a, b) => {
            const A = BigInt(a), B = BigInt(b);
            return A < B ? A * NV + B : B * NV + A;
        };
        const e2t = new Map(); // key -> [{tri, id, a, b}]
        for (let t = 0; t < triCount; t++) {
            const [i0, i1, i2] = tris[t];
            const face = ids[t];
            const edges = [[i0, i1], [i1, i2], [i2, i0]];
            for (let k = 0; k < 3; k++) {
                const a = edges[k][0], b = edges[k][1];
                const key = eKey(a, b);
                let arr = e2t.get(key);
                if (!arr) { arr = []; e2t.set(key, arr); }
                arr.push({ tri: t, id: face, a, b });
            }
        }

        const candidates = [];
        for (const [key, arr] of e2t.entries()) {
            if (arr.length !== 2) continue;
            const a = arr[0], b = arr[1];
            if (a.id === b.id) continue;
            const areaA = areas[a.tri];
            const areaB = areas[b.tri];
            const minAB = Math.min(areaA, areaB);
            if (!(minAB < thr)) continue;
            candidates.push({ key, a, b, minAB });
        }

        candidates.sort((p, q) => p.minAB - q.minAB);

        const triLocked = new Uint8Array(triCount);
        let flipsThisIter = 0;

        const removeUse = (aa, bb, triIdx) => {
            const k = eKey(aa, bb);
            const arr = e2t.get(k);
            if (!arr) return;
            for (let i = 0; i < arr.length; i++) {
                const u = arr[i];
                if (u.tri === triIdx && u.a === aa && u.b === bb) { arr.splice(i, 1); break; }
            }
            if (arr.length === 0) e2t.delete(k);
        };

        const addUse = (aa, bb, triIdx, id) => {
            const k = eKey(aa, bb);
            let arr = e2t.get(k);
            if (!arr) { arr = []; e2t.set(k, arr); }
            arr.push({ tri: triIdx, id, a: aa, b: bb });
        };

        for (const { a, b } of candidates) {
            const t0 = a.tri, t1 = b.tri;
            if (triLocked[t0] || triLocked[t1]) continue;

            const u = a.a, v = a.b;
            if (!(b.a === v && b.b === u)) {
                continue;
            }

            const tri0 = tris[t0];
            const tri1 = tris[t1];
            let c0 = -1, c1 = -1;
            for (let k = 0; k < 3; k++) { const idx = tri0[k]; if (idx !== u && idx !== v) { c0 = idx; break; } }
            for (let k = 0; k < 3; k++) { const idx = tri1[k]; if (idx !== u && idx !== v) { c1 = idx; break; } }
            if (c0 < 0 || c1 < 0 || c0 === c1) continue;

            const diagKey = eKey(c0, c1);
            const diagUses = e2t.get(diagKey);
            if (diagUses && diagUses.length) continue;

            const area0 = areas[t0];
            const area1 = areas[t1];
            const minArea = Math.min(area0, area1);
            if (minArea >= thr) continue;

            const newArea0 = triArea(c0, c1, u);
            const newArea1 = triArea(c1, c0, v);
            if (!(Number.isFinite(newArea0) && Number.isFinite(newArea1))) continue;
            if (newArea0 <= 0 || newArea1 <= 0) continue;
            const newMin = Math.min(newArea0, newArea1);
            if (newMin < minArea) continue;

            tris[t0] = [c0, c1, u];
            tris[t1] = [c1, c0, v];
            areas[t0] = newArea0;
            areas[t1] = newArea1;

            removeUse(u, v, t0);
            removeUse(v, u, t1);
            removeUse(v, u, t0);
            removeUse(u, v, t1);
            addUse(c0, c1, t0, ids[t0]);
            addUse(c1, c0, t0, ids[t0]);
            addUse(c1, c0, t1, ids[t1]);
            addUse(c0, c1, t1, ids[t1]);

            triLocked[t0] = 1;
            triLocked[t1] = 1;
            flipsThisIter++;
        }

        if (!flipsThisIter) break;
        totalFlips += flipsThisIter;

        for (let t = 0; t < triCount; t++) {
            const tri = tris[t];
            const base = t * 3;
            tv[base + 0] = tri[0];
            tv[base + 1] = tri[1];
            tv[base + 2] = tri[2];
        }
        this._dirty = true;
        this._faceIndex = null;
    }

    if (totalFlips > 0) {
        this.fixTriangleWindingsByAdjacency();
    }
    return totalFlips;
}

/**
 * Remesh by splitting long edges to improve triangle regularity while
 * preserving face labels.
 * @param {object} [options]
 * @param {number} options.maxEdgeLength maximum allowed edge length before splitting (required)
 * @param {number} [options.maxIterations=10] number of remesh passes to attempt
 */
export function remesh({ maxEdgeLength, maxIterations = 10 } = {}) {
    const Lmax = Number(maxEdgeLength);
    if (!Number.isFinite(Lmax) || Lmax <= 0) return this;
    const L2 = Lmax * Lmax;

    const pass = () => {
        const vp = this._vertProperties;
        const tv = this._triVerts;
        const ids = this._triIDs;
        const triCount = (tv.length / 3) | 0;
        const nv = (vp.length / 3) | 0;
        const NV = BigInt(Math.max(1, nv));
        const ukey = (a, b) => {
            const A = BigInt(a); const B = BigInt(b); return A < B ? A * NV + B : B * NV + A;
        };
        const len2 = (i, j) => {
            const ax = vp[i * 3 + 0], ay = vp[i * 3 + 1], az = vp[i * 3 + 2];
            const bx = vp[j * 3 + 0], by = vp[j * 3 + 1], bz = vp[j * 3 + 2];
            const dx = ax - bx, dy = ay - by, dz = az - bz; return dx * dx + dy * dy + dz * dz;
        };

        const longEdge = new Set();
        for (let t = 0; t < triCount; t++) {
            const b = t * 3;
            const i0 = tv[b + 0] >>> 0;
            const i1 = tv[b + 1] >>> 0;
            const i2 = tv[b + 2] >>> 0;
            if (len2(i0, i1) > L2) longEdge.add(ukey(i0, i1));
            if (len2(i1, i2) > L2) longEdge.add(ukey(i1, i2));
            if (len2(i2, i0) > L2) longEdge.add(ukey(i2, i0));
        }

        if (longEdge.size === 0) return false;

        const newVP = vp.slice();
        const edgeMid = new Map(); // key -> new vert index
        const midpointIndex = (a, b) => {
            const key = ukey(a, b);
            let idx = edgeMid.get(key);
            if (idx !== undefined) return idx;
            const ax = vp[a * 3 + 0], ay = vp[a * 3 + 1], az = vp[a * 3 + 2];
            const bx = vp[b * 3 + 0], by = vp[b * 3 + 1], bz = vp[b * 3 + 2];
            const mx = 0.5 * (ax + bx), my = 0.5 * (ay + by), mz = 0.5 * (az + bz);
            idx = (newVP.length / 3) | 0;
            newVP.push(mx, my, mz);
            edgeMid.set(key, idx);
            return idx;
        };

        const newTV = [];
        const newIDs = [];
        const emit = (i, j, k, faceId) => { newTV.push(i, j, k); newIDs.push(faceId); };

        for (let t = 0; t < triCount; t++) {
            const base = t * 3;
            const i0 = tv[base + 0] >>> 0;
            const i1 = tv[base + 1] >>> 0;
            const i2 = tv[base + 2] >>> 0;
            const fid = ids[t];

            const k01 = ukey(i0, i1), k12 = ukey(i1, i2), k20 = ukey(i2, i0);
            const s01 = longEdge.has(k01);
            const s12 = longEdge.has(k12);
            const s20 = longEdge.has(k20);

            const count = (s01 ? 1 : 0) + (s12 ? 1 : 0) + (s20 ? 1 : 0);

            if (count === 0) {
                emit(i0, i1, i2, fid);
                continue;
            }

            if (count === 1) {
                if (s01) {
                    const m01 = midpointIndex(i0, i1);
                    emit(i0, m01, i2, fid);
                    emit(m01, i1, i2, fid);
                } else if (s12) {
                    const m12 = midpointIndex(i1, i2);
                    emit(i1, m12, i0, fid);
                    emit(m12, i2, i0, fid);
                } else {
                    const m20 = midpointIndex(i2, i0);
                    emit(i2, m20, i1, fid);
                    emit(m20, i0, i1, fid);
                }
                continue;
            }

            if (count === 2) {
                if (s01 && s12) {
                    const m01 = midpointIndex(i0, i1);
                    const m12 = midpointIndex(i1, i2);
                    emit(i0, m01, i2, fid);
                    emit(i1, m12, m01, fid);
                    emit(m01, m12, i2, fid);
                } else if (s12 && s20) {
                    const m12 = midpointIndex(i1, i2);
                    const m20 = midpointIndex(i2, i0);
                    emit(i1, m12, i0, fid);
                    emit(i2, m20, m12, fid);
                    emit(m12, m20, i0, fid);
                } else {
                    const m20 = midpointIndex(i2, i0);
                    const m01 = midpointIndex(i0, i1);
                    emit(i2, m20, i1, fid);
                    emit(i0, m01, m20, fid);
                    emit(m20, m01, i1, fid);
                }
                continue;
            }

            const m01 = midpointIndex(i0, i1);
            const m12 = midpointIndex(i1, i2);
            const m20 = midpointIndex(i2, i0);
            emit(i0, m01, m20, fid);
            emit(i1, m12, m01, fid);
            emit(i2, m20, m12, fid);
            emit(m01, m12, m20, fid);
        }

        this._vertProperties = newVP;
        this._triVerts = newTV;
        this._triIDs = newIDs;
        this._vertKeyToIndex = new Map();
        for (let i = 0; i < this._vertProperties.length; i += 3) {
            const x = this._vertProperties[i], y = this._vertProperties[i + 1], z = this._vertProperties[i + 2];
            this._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
        }
        this._dirty = true;
        this._faceIndex = null;
        return true;
    };

    let changed = false;
    for (let it = 0; it < maxIterations; it++) {
        const did = pass();
        if (!did) break;
        changed = true;
    }

    if (changed) {
        this.fixTriangleWindingsByAdjacency();
    }
    return this;
}

/**
 * Collapse tiny triangles by snapping the shortest edge of any triangle
 * below a length threshold. The collapse is implemented by moving one
 * endpoint of the short edge onto the other (preferring the lower index
 * as the representative), which produces degenerate triangles. Those are
 * then cleaned up by intersecting the result with a large bounding box
 * and adopting the manifold surface back into this Solid.
 *
 * Returns the number of edge-collapses (unique unions) applied.
 */
export function collapseTinyTriangles(lengthThreshold) {
    const thr = Number(lengthThreshold);
    if (!Number.isFinite(thr) || thr <= 0) return 0;
    const vp = this._vertProperties;
    const tv = this._triVerts;
    const triCount = (tv.length / 3) | 0;
    const nv = (vp.length / 3) | 0;
    if (triCount === 0 || nv === 0) return 0;

    const thr2 = thr * thr;

    // Disjoint set union (union-find) to map vertices to representatives
    const parent = new Int32Array(nv);
    for (let i = 0; i < nv; i++) parent[i] = i;
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const unite = (a, b) => {
        let ra = find(a), rb = find(b);
        if (ra === rb) return false;
        // Prefer lower index as stable representative
        if (rb < ra) { const tmp = ra; ra = rb; rb = tmp; }
        parent[rb] = ra;
        return true;
    };
    const len2 = (i, j) => {
        const ax = vp[i * 3 + 0], ay = vp[i * 3 + 1], az = vp[i * 3 + 2];
        const bx = vp[j * 3 + 0], by = vp[j * 3 + 1], bz = vp[j * 3 + 2];
        const dx = ax - bx, dy = ay - by, dz = az - bz;
        return dx * dx + dy * dy + dz * dz;
    };

    // Identify and unify the endpoints of the shortest edge in triangles
    // that fall below the threshold.
    let unions = 0;
    for (let t = 0; t < triCount; t++) {
        const base = t * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;
        const d01 = len2(i0, i1);
        const d12 = len2(i1, i2);
        const d20 = len2(i2, i0);
        let minD = d01, a = i0, b = i1;
        if (d12 < minD) { minD = d12; a = i1; b = i2; }
        if (d20 < minD) { minD = d20; a = i2; b = i0; }
        if (minD < thr2) {
            if (unite(a, b)) unions++;
        }
    }

    if (unions === 0) return 0;

    // Apply the collapse: move non-representative vertices onto their root.
    for (let i = 0; i < nv; i++) {
        const r = find(i);
        if (r !== i) {
            vp[i * 3 + 0] = vp[r * 3 + 0];
            vp[i * 3 + 1] = vp[r * 3 + 1];
            vp[i * 3 + 2] = vp[r * 3 + 2];
        }
    }

    // Mark dirty and refresh quick vertex index map
    this._vertKeyToIndex = new Map();
    for (let i = 0; i < nv; i++) {
        const x = vp[i * 3 + 0], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
        this._vertKeyToIndex.set(`${x},${y},${z}`, i);
    }
    this._dirty = true;
    this._faceIndex = null;

    // Cleanup degenerate triangles by intersecting with a large bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < nv; i++) {
        const x = vp[i * 3 + 0], y = vp[i * 3 + 1], z = vp[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return unions;
    const dx = Math.max(1e-9, maxX - minX);
    const dy = Math.max(1e-9, maxY - minY);
    const dz = Math.max(1e-9, maxZ - minZ);
    const maxDim = Math.max(dx, dy, dz, thr);
    const margin = Math.max(thr * 10, maxDim * 0.1 + 1e-6);
    const width = dx + 2 * margin;
    const height = dy + 2 * margin;
    const depth = dz + 2 * margin;
    const ox = minX - margin, oy = minY - margin, oz = minZ - margin;

    // Build a box Solid inline (avoid importing primitives to keep dependencies acyclic)
    const SolidCtor = this.constructor;
    const box = new SolidCtor();
    const p000 = [ox, oy, oz];
    const p100 = [ox + width, oy, oz];
    const p010 = [ox, oy + height, oz];
    const p110 = [ox + width, oy + height, oz];
    const p001 = [ox, oy, oz + depth];
    const p101 = [ox + width, oy, oz + depth];
    const p011 = [ox, oy + height, oz + depth];
    const p111 = [ox + width, oy + height, oz + depth];
    box.addTriangle('__BIGBOX_NX', p000, p001, p011);
    box.addTriangle('__BIGBOX_NX', p000, p011, p010);
    box.addTriangle('__BIGBOX_PX', p100, p110, p111);
    box.addTriangle('__BIGBOX_PX', p100, p111, p101);
    box.addTriangle('__BIGBOX_NY', p000, p100, p101);
    box.addTriangle('__BIGBOX_NY', p000, p101, p001);
    box.addTriangle('__BIGBOX_PY', p010, p011, p111);
    box.addTriangle('__BIGBOX_PY', p010, p111, p110);
    box.addTriangle('__BIGBOX_NZ', p000, p010, p110);
    box.addTriangle('__BIGBOX_NZ', p000, p110, p100);
    box.addTriangle('__BIGBOX_PZ', p001, p101, p111);
    box.addTriangle('__BIGBOX_PZ', p001, p111, p011);

    const result = this.intersect(box);

    // Adopt the result's manifold surface back into this Solid
    const mesh = result.getMesh();
    try {
        this._numProp = mesh.numProp || 3;
        this._vertProperties = Array.from(mesh.vertProperties || []);
        this._triVerts = Array.from(mesh.triVerts || []);
        const triCountAfter = (this._triVerts.length / 3) | 0;
        if (mesh.faceID && mesh.faceID.length === triCountAfter) {
            this._triIDs = Array.from(mesh.faceID);
        } else {
            const SolidClass = this.constructor;
            this._triIDs = SolidClass._expandTriIDsFromMesh(mesh);
        }
        this._vertKeyToIndex = new Map();
        for (let i = 0; i < this._vertProperties.length; i += 3) {
            const x = this._vertProperties[i], y = this._vertProperties[i + 1], z = this._vertProperties[i + 2];
            this._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
        }
        // Adopt face label mapping from the boolean result to keep IDs consistent
        try { this._idToFaceName = new Map(result._idToFaceName); } catch { 
            // throw an error if it fails
            throw new Error("Failed to adopt face label mapping from boolean result");
        }
        try { this._faceNameToID = new Map([...this._idToFaceName.entries()].map(([id, name]) => [name, id])); } catch { }
        this._dirty = false;
        this._faceIndex = null;
        this._manifold = null; // Rebuild lazily on next need
    } finally {
        try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { }
    }

    return unions;
}

/**
 * Split triangles wherever they intersect other triangles, producing a conforming
 * triangle mesh suitable for internal-triangle classification.
 *
 * This is intentionally arrangement-based: every original triangle collects all
 * intersection segments first, then touched triangles are rebuilt from a local
 * planar straight-line graph. That avoids the old "split one pair, restart"
 * behavior that could miss interactions between multiple intersections on the
 * same source triangle.
 *
 * @param {boolean|object} [diagnostics=false]
 * @returns {number} number of triangle-pair intersections that caused a split
 */
export function splitSelfIntersectingTriangles(diagnostics = false) {
    const opts = diagnostics && typeof diagnostics === "object" ? diagnostics : {};
    const logDiagnostics = diagnostics === true || opts.diagnostics === true;
    const detectOnly = opts.detectOnly === true || opts.probeOnly === true;
    const maxIntersections = Math.max(0, Number(opts.maxIntersections) || 0);
    const sourceVP = Array.from(this._vertProperties || []);
    const sourceTV = Array.from(this._triVerts || []);
    const sourceIDs = Array.from(this._triIDs || []);
    const triCount0 = (sourceTV.length / 3) | 0;
    if (triCount0 < 2 || sourceVP.length < 9) return 0;

    const vec = {
        add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
        sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
        mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
        dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
        cross(a, b) {
            return [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ];
        },
        len(a) { return Math.hypot(a[0], a[1], a[2]); },
        dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
        norm(a) {
            const length = Math.hypot(a[0], a[1], a[2]);
            return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
        },
    };

    const v2 = {
        sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; },
        cross(a, b) { return a[0] * b[1] - a[1] * b[0]; },
        dot(a, b) { return a[0] * b[0] + a[1] * b[1]; },
        dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); },
    };

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < sourceVP.length; i += 3) {
        const x = sourceVP[i + 0], y = sourceVP[i + 1], z = sourceVP[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const modelScale = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
    const snapEps = Math.max(1e-9, Number(opts.snapTolerance) || modelScale * 1e-9);
    const planeEps = Math.max(snapEps * 8, modelScale * 1e-10);
    const areaEps = Math.max(1e-18, modelScale * modelScale * 1e-18);
    const qPoint = (p) => [
        Math.round(p[0] / snapEps),
        Math.round(p[1] / snapEps),
        Math.round(p[2] / snapEps),
    ].join(",");

    const sourcePoint = (index) => [
        sourceVP[index * 3 + 0],
        sourceVP[index * 3 + 1],
        sourceVP[index * 3 + 2],
    ];

    const triangleArea3 = (a, b, c) => vec.len(vec.cross(vec.sub(b, a), vec.sub(c, a))) * 0.5;
    const planeOf = (a, b, c) => {
        const raw = vec.cross(vec.sub(b, a), vec.sub(c, a));
        const length = vec.len(raw);
        if (!(length > 1e-18)) return null;
        const n = vec.mul(raw, 1 / length);
        return { n, d: -vec.dot(n, a) };
    };
    const signedDistance = (plane, point) => vec.dot(plane.n, point) + plane.d;

    const makeBasis = (a, b, c) => {
        const n = vec.norm(vec.cross(vec.sub(b, a), vec.sub(c, a)));
        if (vec.len(n) <= 0) return null;
        let u = vec.sub(b, a);
        if (vec.len(u) <= snapEps) u = vec.sub(c, a);
        u = vec.norm(u);
        if (vec.len(u) <= 0) return null;
        const v = vec.norm(vec.cross(n, u));
        if (vec.len(v) <= 0) return null;
        const origin = a;
        return {
            origin,
            u,
            v,
            n,
            project(point) {
                const p = vec.sub(point, origin);
                return [vec.dot(p, u), vec.dot(p, v)];
            },
            unproject(point) {
                return vec.add(origin, vec.add(vec.mul(u, point[0]), vec.mul(v, point[1])));
            },
        };
    };

    const pointInTri2D = (p, a, b, c, eps = 1e-12) => {
        const ab = v2.sub(b, a);
        const bc = v2.sub(c, b);
        const ca = v2.sub(a, c);
        const ap = v2.sub(p, a);
        const bp = v2.sub(p, b);
        const cp = v2.sub(p, c);
        const c0 = v2.cross(ab, ap);
        const c1 = v2.cross(bc, bp);
        const c2 = v2.cross(ca, cp);
        return (c0 >= -eps && c1 >= -eps && c2 >= -eps)
            || (c0 <= eps && c1 <= eps && c2 <= eps);
    };

    const segmentIntersection2D = (a, b, c, d, eps = 1e-12) => {
        const r = v2.sub(b, a);
        const s = v2.sub(d, c);
        const denom = v2.cross(r, s);
        const ca = v2.sub(c, a);
        const out = [];
        if (Math.abs(denom) > eps) {
            const t = v2.cross(ca, s) / denom;
            const u = v2.cross(ca, r) / denom;
            if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
                out.push([a[0] + r[0] * t, a[1] + r[1] * t]);
            }
            return out;
        }
        if (Math.abs(v2.cross(ca, r)) > eps) return out;

        const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
        const a0 = a[axis], a1 = b[axis], c0 = c[axis], c1 = d[axis];
        const minA = Math.min(a0, a1), maxA = Math.max(a0, a1);
        const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
        const lo = Math.max(minA, minC);
        const hi = Math.min(maxA, maxC);
        if (hi < lo - eps) return out;
        const pointAt = (value) => {
            const denomAxis = a1 - a0;
            const t = Math.abs(denomAxis) > eps ? (value - a0) / denomAxis : 0;
            return [a[0] + r[0] * t, a[1] + r[1] * t];
        };
        out.push(pointAt(lo));
        if (hi > lo + eps) out.push(pointAt(hi));
        return out;
    };

    const pointOnSegment2D = (p, a, b, eps = 1e-10) => {
        const ab = v2.sub(b, a);
        const ap = v2.sub(p, a);
        const abLenSq = v2.dot(ab, ab);
        if (!(abLenSq > eps * eps)) return false;
        const cross = Math.abs(v2.cross(ab, ap));
        if (cross > eps * Math.sqrt(abLenSq)) return false;
        const t = v2.dot(ap, ab) / abLenSq;
        return t >= -eps && t <= 1 + eps;
    };

    const pointOnSegment3D = (p, a, b, eps = snapEps) => {
        const ab = vec.sub(b, a);
        const ap = vec.sub(p, a);
        const abLen = vec.len(ab);
        if (!(abLen > eps)) return vec.dist(p, a) <= eps;
        const cross = vec.len(vec.cross(ab, ap));
        if (cross > eps * abLen) return false;
        const t = vec.dot(ap, ab) / (abLen * abLen);
        return t >= -eps && t <= 1 + eps;
    };

    const convexHull2D = (points) => {
        const keyed = [];
        const seen = new Set();
        const q2 = (p) => `${Math.round(p[0] / snapEps)},${Math.round(p[1] / snapEps)}`;
        for (const p of points) {
            const key = q2(p);
            if (seen.has(key)) continue;
            seen.add(key);
            keyed.push(p);
        }
        keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (keyed.length <= 2) return keyed;
        const cross = (o, a, b) => v2.cross(v2.sub(a, o), v2.sub(b, o));
        const lower = [];
        for (const p of keyed) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= snapEps) lower.pop();
            lower.push(p);
        }
        const upper = [];
        for (let i = keyed.length - 1; i >= 0; i--) {
            const p = keyed[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= snapEps) upper.pop();
            upper.push(p);
        }
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    };

    const polygonArea2D = (loop, pointsAccessor = (p) => p) => {
        let area = 0;
        for (let i = 0; i < loop.length; i++) {
            const a = pointsAccessor(loop[i]);
            const b = pointsAccessor(loop[(i + 1) % loop.length]);
            area += a[0] * b[1] - b[0] * a[1];
        }
        return area * 0.5;
    };

    const trianglePlaneSegment = (tri, plane) => {
        const pts = [];
        const add = (p) => {
            for (const q of pts) {
                if (vec.dist(p, q) <= snapEps) return;
            }
            pts.push(p);
        };
        const distances = tri.map((p) => signedDistance(plane, p));
        for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3;
            const p = tri[i], q = tri[j];
            const dp = distances[i], dq = distances[j];
            if (Math.abs(dp) <= planeEps) add(p);
            if (Math.abs(dp) <= planeEps && Math.abs(dq) <= planeEps) {
                add(q);
                continue;
            }
            if ((dp < -planeEps && dq > planeEps) || (dp > planeEps && dq < -planeEps)) {
                const t = dp / (dp - dq);
                add([
                    p[0] + (q[0] - p[0]) * t,
                    p[1] + (q[1] - p[1]) * t,
                    p[2] + (q[2] - p[2]) * t,
                ]);
            }
        }
        if (pts.length <= 2) return pts;
        let best = [pts[0], pts[1]];
        let bestDist = -Infinity;
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const dist = vec.dist(pts[i], pts[j]);
                if (dist > bestDist) {
                    best = [pts[i], pts[j]];
                    bestDist = dist;
                }
            }
        }
        return best;
    };

    const coplanarTriangleOverlap = (triA, triB, basis) => {
        const a2 = triA.map((p) => basis.project(p));
        const b2 = triB.map((p) => basis.project(p));
        const pts = [];
        const add2 = (p) => {
            for (const q of pts) {
                if (v2.dist(p, q) <= snapEps) return;
            }
            pts.push(p);
        };
        for (const p of a2) {
            if (pointInTri2D(p, b2[0], b2[1], b2[2], snapEps)) add2(p);
        }
        for (const p of b2) {
            if (pointInTri2D(p, a2[0], a2[1], a2[2], snapEps)) add2(p);
        }
        for (let i = 0; i < 3; i++) {
            const a0 = a2[i], a1 = a2[(i + 1) % 3];
            for (let j = 0; j < 3; j++) {
                const b0 = b2[j], b1 = b2[(j + 1) % 3];
                for (const p of segmentIntersection2D(a0, a1, b0, b1, snapEps)) add2(p);
            }
        }
        if (pts.length < 2) return null;
        const hull = convexHull2D(pts);
        if (hull.length >= 3 && Math.abs(polygonArea2D(hull)) > areaEps) {
            const segments = [];
            for (let i = 0; i < hull.length; i++) {
                segments.push([basis.unproject(hull[i]), basis.unproject(hull[(i + 1) % hull.length])]);
            }
            return { type: "segments", segments };
        }
        if (hull.length >= 2 && v2.dist(hull[0], hull[hull.length - 1]) > snapEps) {
            return { type: "segments", segments: [[basis.unproject(hull[0]), basis.unproject(hull[hull.length - 1])]] };
        }
        return null;
    };

    const triangleIntersection = (triA, triB) => {
        const planeA = planeOf(triA[0], triA[1], triA[2]);
        const planeB = planeOf(triB[0], triB[1], triB[2]);
        if (!planeA || !planeB) return null;

        const distB = triB.map((p) => signedDistance(planeA, p));
        const distA = triA.map((p) => signedDistance(planeB, p));
        const allPositive = (arr) => arr.every((v) => v > planeEps);
        const allNegative = (arr) => arr.every((v) => v < -planeEps);
        if (allPositive(distB) || allNegative(distB) || allPositive(distA) || allNegative(distA)) return null;

        const normalsCross = vec.cross(planeA.n, planeB.n);
        const crossLength = vec.len(normalsCross);
        const coplanar = crossLength <= 1e-8
            && distB.every((v) => Math.abs(v) <= planeEps)
            && distA.every((v) => Math.abs(v) <= planeEps);
        if (coplanar) {
            const basis = makeBasis(triA[0], triA[1], triA[2]);
            return basis ? coplanarTriangleOverlap(triA, triB, basis) : null;
        }
        if (!(crossLength > 1e-14)) return null;

        const segA = trianglePlaneSegment(triA, planeB);
        const segB = trianglePlaneSegment(triB, planeA);
        if (segA.length < 2 || segB.length < 2) {
            if (segA.length === 1 && segB.length === 2 && pointOnSegment3D(segA[0], segB[0], segB[1])) {
                return { type: "point", point: segA[0] };
            }
            if (segB.length === 1 && segA.length === 2 && pointOnSegment3D(segB[0], segA[0], segA[1])) {
                return { type: "point", point: segB[0] };
            }
            const candidates = segA.concat(segB);
            const unique = [];
            for (const candidate of candidates) {
                if (unique.some((p) => vec.dist(p, candidate) <= snapEps)) continue;
                unique.push(candidate);
            }
            if (unique.length === 1) return { type: "point", point: unique[0] };
            return null;
        }

        const axis = vec.mul(normalsCross, 1 / crossLength);
        const origin = segA[0];
        const intervalA = segA.map((p) => vec.dot(vec.sub(p, origin), axis)).sort((a, b) => a - b);
        const intervalB = segB.map((p) => vec.dot(vec.sub(p, origin), axis)).sort((a, b) => a - b);
        const lo = Math.max(intervalA[0], intervalB[0]);
        const hi = Math.min(intervalA[1], intervalB[1]);
        if (hi < lo - snapEps) return null;
        const p = vec.add(origin, vec.mul(axis, lo));
        const q = vec.add(origin, vec.mul(axis, hi));
        if (vec.dist(p, q) > snapEps) return { type: "segments", segments: [[p, q]] };
        return { type: "point", point: p };
    };

    const records = new Array(triCount0);
    for (let t = 0; t < triCount0; t++) {
        const base = t * 3;
        const i0 = sourceTV[base + 0] >>> 0;
        const i1 = sourceTV[base + 1] >>> 0;
        const i2 = sourceTV[base + 2] >>> 0;
        const points = [sourcePoint(i0), sourcePoint(i1), sourcePoint(i2)];
        const min = [
            Math.min(points[0][0], points[1][0], points[2][0]),
            Math.min(points[0][1], points[1][1], points[2][1]),
            Math.min(points[0][2], points[1][2], points[2][2]),
        ];
        const max = [
            Math.max(points[0][0], points[1][0], points[2][0]),
            Math.max(points[0][1], points[1][1], points[2][1]),
            Math.max(points[0][2], points[1][2], points[2][2]),
        ];
        records[t] = {
            indices: [i0, i1, i2],
            id: sourceIDs[t] ?? 0,
            points,
            min,
            max,
            segments: [],
            pointsOnly: [],
            segmentKeys: new Set(),
            pointKeys: new Set(),
        };
    }

    const addPointOnly = (record, point) => {
        const key = qPoint(point);
        if (record.pointKeys.has(key)) return;
        record.pointKeys.add(key);
        record.pointsOnly.push(point);
    };

    const addSegment = (record, a, b) => {
        if (vec.dist(a, b) <= snapEps) {
            addPointOnly(record, a);
            return;
        }
        const ka = qPoint(a), kb = qPoint(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (record.segmentKeys.has(key)) return;
        record.segmentKeys.add(key);
        record.segments.push([a, b]);
    };

    const sharedCoordinatePoints = (recordA, recordB) => {
        const common = [];
        const add = (point) => {
            if (common.some((existing) => vec.dist(existing, point) <= snapEps)) return;
            common.push(point);
        };
        for (const pa of recordA.points) {
            for (const pb of recordB.points) {
                if (vec.dist(pa, pb) <= snapEps) add(pa);
            }
        }
        return common;
    };

    const isOnlySharedEdge = (recordA, recordB, a, b) => {
        const common = sharedCoordinatePoints(recordA, recordB);
        if (common.length !== 2) return false;
        const a0 = vec.dist(a, common[0]) <= snapEps && vec.dist(b, common[1]) <= snapEps;
        const a1 = vec.dist(a, common[1]) <= snapEps && vec.dist(b, common[0]) <= snapEps;
        return a0 || a1;
    };

    const isOnlySharedPoint = (recordA, recordB, point) => {
        const common = sharedCoordinatePoints(recordA, recordB);
        return common.length > 0 && common.some((p) => vec.dist(p, point) <= snapEps);
    };

    const overlapAABB = (a, b) => !(
        a.max[0] < b.min[0] - planeEps || b.max[0] < a.min[0] - planeEps
        || a.max[1] < b.min[1] - planeEps || b.max[1] < a.min[1] - planeEps
        || a.max[2] < b.min[2] - planeEps || b.max[2] < a.min[2] - planeEps
    );

    const order = Array.from({ length: triCount0 }, (_, i) => i)
        .sort((a, b) => records[a].min[0] - records[b].min[0]);
    let pairIntersections = 0;
    let pointIntersections = 0;
    let testedPairs = 0;
    for (let oi = 0; oi < order.length; oi++) {
        const ai = order[oi];
        const a = records[ai];
        if (triangleArea3(a.points[0], a.points[1], a.points[2]) <= areaEps) continue;
        for (let oj = oi + 1; oj < order.length; oj++) {
            const bi = order[oj];
            const b = records[bi];
            if (b.min[0] > a.max[0] + planeEps) break;
            if (!overlapAABB(a, b)) continue;
            if (triangleArea3(b.points[0], b.points[1], b.points[2]) <= areaEps) continue;
            testedPairs++;
            const hit = triangleIntersection(a.points, b.points);
            if (!hit) continue;
            const commonPoints = sharedCoordinatePoints(a, b);
            if (commonPoints.length > 0) {
                const touchesCommonPoint = (point) => commonPoints.some((common) => vec.dist(point, common) <= snapEps);
                if (hit.type === "point" && touchesCommonPoint(hit.point)) continue;
                if (hit.type === "segments") {
                    const segments = hit.segments || [];
                    if (segments.length && segments.every(([p, q]) => touchesCommonPoint(p) || touchesCommonPoint(q))) {
                        continue;
                    }
                }
            }
            if (hit.type === "point") {
                if (isOnlySharedPoint(a, b, hit.point)) continue;
                addPointOnly(a, hit.point);
                addPointOnly(b, hit.point);
                pointIntersections++;
                if (detectOnly && maxIntersections > 0 && (pairIntersections + pointIntersections) >= maxIntersections) {
                    return pairIntersections + pointIntersections;
                }
                continue;
            }
            let addedForPair = false;
            for (const [p, q] of hit.segments || []) {
                if (isOnlySharedEdge(a, b, p, q)) continue;
                addSegment(a, p, q);
                addSegment(b, p, q);
                addedForPair = true;
            }
            if (addedForPair) {
                pairIntersections++;
                if (detectOnly && maxIntersections > 0 && (pairIntersections + pointIntersections) >= maxIntersections) {
                    return pairIntersections + pointIntersections;
                }
            }
        }
    }

    const totalIntersections = pairIntersections + pointIntersections;
    if (totalIntersections === 0) {
        if (logDiagnostics) {
            console.log("[splitSelfIntersectingTriangles] no splittable intersections", { triCount: triCount0, testedPairs });
        }
        return 0;
    }

    // Keep the triangle arrangement conforming across existing mesh edges. If
    // an intersection inserts a vertex on one triangle's edge, every triangle
    // sharing that geometric edge must also be retriangulated with the same
    // point; otherwise the split leaves T-junctions that appear as boundary and
    // non-manifold edges in the indexed mesh.
    const propagatedEdgePointKeys = new Set();
    const edgeSplitPoints = [];
    const addEdgeSplitPoint = (point) => {
        const key = qPoint(point);
        if (propagatedEdgePointKeys.has(key)) return;
        propagatedEdgePointKeys.add(key);
        edgeSplitPoints.push(point);
    };
    for (const record of records) {
        for (const [a, b] of record.segments) {
            addEdgeSplitPoint(a);
            addEdgeSplitPoint(b);
        }
        for (const point of record.pointsOnly) {
            addEdgeSplitPoint(point);
        }
    }
    if (edgeSplitPoints.length && edgeSplitPoints.length <= 1024) {
        for (const record of records) {
            for (const point of edgeSplitPoints) {
                if (record.points.some((vertex) => vec.dist(vertex, point) <= snapEps)) continue;
                let liesOnEdge = false;
                for (let i = 0; i < 3; i++) {
                    const a = record.points[i];
                    const b = record.points[(i + 1) % 3];
                    if (!pointOnSegment3D(point, a, b, snapEps)) continue;
                    liesOnEdge = true;
                    break;
                }
                if (liesOnEdge) addPointOnly(record, point);
            }
        }
    }

    this._vertProperties = sourceVP.slice();
    this._vertKeyToIndex = new Map();
    const globalVertexByKey = new Map();
    for (let i = 0; i < this._vertProperties.length; i += 3) {
        const index = (i / 3) | 0;
        const p = [this._vertProperties[i + 0], this._vertProperties[i + 1], this._vertProperties[i + 2]];
        this._vertKeyToIndex.set(`${p[0]},${p[1]},${p[2]}`, index);
        if (!globalVertexByKey.has(qPoint(p))) globalVertexByKey.set(qPoint(p), index);
    }

    const getOrCreateVertex = (point) => {
        const key = qPoint(point);
        const existing = globalVertexByKey.get(key);
        if (existing !== undefined) return existing;
        const index = (this._vertProperties.length / 3) | 0;
        this._vertProperties.push(point[0], point[1], point[2]);
        globalVertexByKey.set(key, index);
        this._vertKeyToIndex.set(`${point[0]},${point[1]},${point[2]}`, index);
        return index;
    };

    const makeLocalRetriangulator = (record) => {
        const basis = makeBasis(record.points[0], record.points[1], record.points[2]);
        if (!basis) return null;
        const localPoints = [];
        const localByGlobal = new Map();
        const localByKey = new Map();
        const localSegments = [];
        const localScale = Math.max(
            v2.dist(basis.project(record.points[0]), basis.project(record.points[1])),
            v2.dist(basis.project(record.points[1]), basis.project(record.points[2])),
            v2.dist(basis.project(record.points[2]), basis.project(record.points[0])),
            1,
        );
        const eps2 = Math.max(snapEps, localScale * 1e-10);
        const area2 = Math.max(1e-18, localScale * localScale * 1e-16);
        const localKey = (p) => `${Math.round(p[0] / eps2)},${Math.round(p[1] / eps2)}`;
        const addLocalPoint = (point) => {
            const global = getOrCreateVertex(point);
            const globalExisting = localByGlobal.get(global);
            if (globalExisting !== undefined) return globalExisting;
            const p2 = basis.project(point);
            const key = localKey(p2);
            const keyed = localByKey.get(key);
            if (keyed !== undefined) {
                localByGlobal.set(global, keyed);
                return keyed;
            }
            const index = localPoints.length;
            localPoints.push({ global, p3: point, p2 });
            localByGlobal.set(global, index);
            localByKey.set(key, index);
            return index;
        };
        const addLocalSegment = (a, b) => {
            const ia = addLocalPoint(a);
            const ib = addLocalPoint(b);
            if (ia === ib) return;
            localSegments.push([ia, ib]);
        };
        const original = record.points.map(addLocalPoint);
        addLocalSegment(record.points[0], record.points[1]);
        addLocalSegment(record.points[1], record.points[2]);
        addLocalSegment(record.points[2], record.points[0]);
        for (const [a, b] of record.segments) addLocalSegment(a, b);
        for (const point of record.pointsOnly) {
            const ip = addLocalPoint(point);
            for (const io of original) {
                if (ip !== io) localSegments.push([ip, io]);
            }
        }
        return { basis, localPoints, localSegments, original, eps2, area2 };
    };

    const segmentProperlyCrosses = (a, b, c, d, eps) => {
        const ab = v2.sub(b, a);
        const ac = v2.sub(c, a);
        const ad = v2.sub(d, a);
        const cd = v2.sub(d, c);
        const ca = v2.sub(a, c);
        const cb = v2.sub(b, c);
        const o1 = v2.cross(ab, ac);
        const o2 = v2.cross(ab, ad);
        const o3 = v2.cross(cd, ca);
        const o4 = v2.cross(cd, cb);
        return o1 * o2 < -eps * eps && o3 * o4 < -eps * eps;
    };

    const retriangulateRecord = (record) => {
        if (!record.segments.length && !record.pointsOnly.length) {
            return [[record.indices[0], record.indices[1], record.indices[2]]];
        }
        const rt = makeLocalRetriangulator(record);
        if (!rt) return [[record.indices[0], record.indices[1], record.indices[2]]];
        const { localPoints, localSegments, original, eps2, area2 } = rt;
        const sourceNormal = vec.norm(vec.cross(
            vec.sub(record.points[1], record.points[0]),
            vec.sub(record.points[2], record.points[0]),
        ));

        const addSegmentIntersections = () => {
            const originalLength = localSegments.length;
            for (let i = 0; i < originalLength; i++) {
                const [a0, a1] = localSegments[i];
                const a = localPoints[a0].p2;
                const b = localPoints[a1].p2;
                for (let j = i + 1; j < originalLength; j++) {
                    const [b0, b1] = localSegments[j];
                    const c = localPoints[b0].p2;
                    const d = localPoints[b1].p2;
                    for (const p of segmentIntersection2D(a, b, c, d, eps2)) {
                        const p3 = rt.basis.unproject(p);
                        const index = (() => {
                            const global = getOrCreateVertex(p3);
                            const existing = localPoints.findIndex((entry) => entry.global === global);
                            if (existing >= 0) return existing;
                            const next = localPoints.length;
                            localPoints.push({ global, p3, p2: p });
                            return next;
                        })();
                        if (index === a0 || index === a1 || index === b0 || index === b1) continue;
                    }
                }
            }
        };

        const connectInteriorComponents = () => {
            const parent = new Int32Array(localPoints.length);
            for (let i = 0; i < parent.length; i++) parent[i] = i;
            const find = (x) => {
                let r = x;
                while (parent[r] !== r) r = parent[r];
                while (parent[x] !== x) {
                    const p = parent[x];
                    parent[x] = r;
                    x = p;
                }
                return r;
            };
            const unite = (a, b) => {
                const ra = find(a), rb = find(b);
                if (ra !== rb) parent[rb] = ra;
            };
            for (const [a, b] of localSegments) unite(a, b);
            const boundaryRoot = find(original[0]);
            const components = new Map();
            for (let i = 0; i < localPoints.length; i++) {
                const root = find(i);
                let list = components.get(root);
                if (!list) { list = []; components.set(root, list); }
                list.push(i);
            }
            const existingSegments = () => localSegments.map(([a, b]) => [localPoints[a].p2, localPoints[b].p2]);
            for (const [root, members] of components.entries()) {
                if (root === boundaryRoot || members.some((i) => original.includes(i))) continue;
                let best = null;
                const blockers = existingSegments();
                for (const member of members) {
                    const p = localPoints[member].p2;
                    for (const target of original) {
                        const q = localPoints[target].p2;
                        let visible = true;
                        for (const [s0, s1] of blockers) {
                            if (v2.dist(p, s0) <= eps2 || v2.dist(p, s1) <= eps2 || v2.dist(q, s0) <= eps2 || v2.dist(q, s1) <= eps2) continue;
                            if (segmentProperlyCrosses(p, q, s0, s1, eps2)) {
                                visible = false;
                                break;
                            }
                        }
                        if (!visible) continue;
                        const dist = v2.dist(p, q);
                        if (!best || dist < best.dist) best = { member, target, dist };
                    }
                }
                if (best) localSegments.push([best.member, best.target]);
            }
        };

        connectInteriorComponents();
        addSegmentIntersections();

        const edgeSet = new Set();
        const addEdge = (a, b) => {
            if (a === b) return;
            if (v2.dist(localPoints[a].p2, localPoints[b].p2) <= eps2) return;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (edgeSet.has(key)) return;
            edgeSet.add(key);
        };

        for (const [a, b] of localSegments) {
            const pa = localPoints[a].p2;
            const pb = localPoints[b].p2;
            const ab = v2.sub(pb, pa);
            const abLenSq = v2.dot(ab, ab);
            if (!(abLenSq > eps2 * eps2)) continue;
            const split = [];
            for (let i = 0; i < localPoints.length; i++) {
                const p = localPoints[i].p2;
                if (!pointOnSegment2D(p, pa, pb, eps2)) continue;
                const t = v2.dot(v2.sub(p, pa), ab) / abLenSq;
                split.push({ index: i, t });
            }
            split.sort((u, v) => u.t - v.t);
            for (let i = 0; i + 1 < split.length; i++) addEdge(split[i].index, split[i + 1].index);
        }

        const adjacency = new Map();
        for (const key of edgeSet) {
            const [aRaw, bRaw] = key.split("|");
            const a = Number(aRaw), b = Number(bRaw);
            if (!adjacency.has(a)) adjacency.set(a, new Set());
            if (!adjacency.has(b)) adjacency.set(b, new Set());
            adjacency.get(a).add(b);
            adjacency.get(b).add(a);
        }
        for (const [index, set] of adjacency.entries()) {
            const p = localPoints[index].p2;
            adjacency.set(index, Array.from(set).sort((a, b) => {
                const pa = localPoints[a].p2;
                const pb = localPoints[b].p2;
                return Math.atan2(pa[1] - p[1], pa[0] - p[0]) - Math.atan2(pb[1] - p[1], pb[0] - p[0]);
            }));
        }

        const directedVisited = new Set();
        const directedKey = (a, b) => `${a}>${b}`;
        const loops = [];
        for (const key of edgeSet) {
            const [aRaw, bRaw] = key.split("|");
            for (const start of [[Number(aRaw), Number(bRaw)], [Number(bRaw), Number(aRaw)]]) {
                let [from, to] = start;
                if (directedVisited.has(directedKey(from, to))) continue;
                const loop = [];
                const guardMax = Math.max(12, edgeSet.size * 4);
                let guard = 0;
                while (!directedVisited.has(directedKey(from, to)) && guard++ < guardMax) {
                    directedVisited.add(directedKey(from, to));
                    loop.push(from);
                    const neighbors = adjacency.get(to) || [];
                    const incoming = neighbors.indexOf(from);
                    if (incoming < 0 || neighbors.length === 0) break;
                    const next = neighbors[(incoming - 1 + neighbors.length) % neighbors.length];
                    from = to;
                    to = next;
                    if (from === start[0] && to === start[1]) break;
                }
                if (loop.length >= 3) {
                    const area = polygonArea2D(loop, (i) => localPoints[i].p2);
                    if (area > area2) loops.push(loop);
                }
            }
        }

        const pointStrictlyInTri2D = (p, a, b, c) => {
            const area = Math.abs(v2.cross(v2.sub(b, a), v2.sub(c, a)));
            if (!(area > area2)) return false;
            const a0 = Math.abs(v2.cross(v2.sub(a, p), v2.sub(b, p)));
            const a1 = Math.abs(v2.cross(v2.sub(b, p), v2.sub(c, p)));
            const a2 = Math.abs(v2.cross(v2.sub(c, p), v2.sub(a, p)));
            if (Math.abs((a0 + a1 + a2) - area) > Math.max(area2, area * 1e-8)) return false;
            return a0 > area2 && a1 > area2 && a2 > area2;
        };

        const triangulateLoop = (loop) => {
            const out = [];
            const indices = loop.slice();
            const signedArea = polygonArea2D(indices, (i) => localPoints[i].p2);
            if (signedArea < 0) indices.reverse();
            let guard = 0;
            while (indices.length > 3 && guard++ < loop.length * loop.length * 4) {
                let clipped = false;
                for (let i = 0; i < indices.length; i++) {
                    const i0 = indices[(i - 1 + indices.length) % indices.length];
                    const i1 = indices[i];
                    const i2 = indices[(i + 1) % indices.length];
                    const p0 = localPoints[i0].p2;
                    const p1 = localPoints[i1].p2;
                    const p2 = localPoints[i2].p2;
                    if (v2.cross(v2.sub(p1, p0), v2.sub(p2, p1)) <= area2) continue;
                    let contains = false;
                    for (const candidate of indices) {
                        if (candidate === i0 || candidate === i1 || candidate === i2) continue;
                        if (pointStrictlyInTri2D(localPoints[candidate].p2, p0, p1, p2)) {
                            contains = true;
                            break;
                        }
                    }
                    if (contains) continue;
                    out.push([i0, i1, i2]);
                    indices.splice(i, 1);
                    clipped = true;
                    break;
                }
                if (!clipped) {
                    for (let i = 1; i + 1 < indices.length; i++) out.push([indices[0], indices[i], indices[i + 1]]);
                    indices.length = 0;
                }
            }
            if (indices.length === 3) out.push([indices[0], indices[1], indices[2]]);
            return out;
        };

        const out = [];
        for (const loop of loops) {
            for (const tri of triangulateLoop(loop)) {
                const a = localPoints[tri[0]], b = localPoints[tri[1]], c = localPoints[tri[2]];
                if (triangleArea3(a.p3, b.p3, c.p3) <= areaEps) continue;
                const triNormal = vec.cross(vec.sub(b.p3, a.p3), vec.sub(c.p3, a.p3));
                if (vec.dot(triNormal, sourceNormal) < 0) out.push([a.global, c.global, b.global]);
                else out.push([a.global, b.global, c.global]);
            }
        }
        return out.length ? out : [[record.indices[0], record.indices[1], record.indices[2]]];
    };

    const newTV = [];
    const newIDs = [];
    let touchedTriangles = 0;
    for (let t = 0; t < triCount0; t++) {
        const record = records[t];
        const tris = retriangulateRecord(record);
        if (record.segments.length || record.pointsOnly.length) touchedTriangles++;
        for (const tri of tris) {
            newTV.push(tri[0], tri[1], tri[2]);
            newIDs.push(record.id);
        }
    }

    this._triVerts = newTV;
    this._triIDs = newIDs;
    this._dirty = true;
    this._faceIndex = null;
    this._manifold = null;

    try { this.removeDegenerateTriangles(); } catch { /* best effort */ }

    const removeDuplicateTriangles = () => {
        const tv = this._triVerts || [];
        const vp = this._vertProperties || [];
        const ids = this._triIDs || [];
        const triCount = (tv.length / 3) | 0;
        const seen = new Set();
        const keepTV = [];
        const keepIDs = [];
        let removed = 0;
        for (let t = 0; t < triCount; t++) {
            const base = t * 3;
            const verts = [tv[base + 0] >>> 0, tv[base + 1] >>> 0, tv[base + 2] >>> 0];
            const key = verts
                .map((index) => qPoint([vp[index * 3 + 0], vp[index * 3 + 1], vp[index * 3 + 2]]))
                .sort()
                .join("|");
            if (seen.has(key)) {
                removed++;
                continue;
            }
            seen.add(key);
            keepTV.push(verts[0], verts[1], verts[2]);
            keepIDs.push(ids[t]);
        }
        if (!removed) return 0;
        this._triVerts = keepTV;
        this._triIDs = keepIDs;
        this._dirty = true;
        this._faceIndex = null;
        this._manifold = null;
        return removed;
    };
    const duplicateRemovals = removeDuplicateTriangles();

    const compactVertices = () => {
        const tv = this._triVerts || [];
        const vp = this._vertProperties || [];
        const nv = (vp.length / 3) | 0;
        const used = new Uint8Array(nv);
        for (const index of tv) used[index >>> 0] = 1;
        const oldToNew = new Int32Array(nv);
        for (let i = 0; i < nv; i++) oldToNew[i] = -1;
        const compact = [];
        let next = 0;
        for (let i = 0; i < nv; i++) {
            if (!used[i]) continue;
            oldToNew[i] = next++;
            compact.push(vp[i * 3 + 0], vp[i * 3 + 1], vp[i * 3 + 2]);
        }
        for (let i = 0; i < tv.length; i++) tv[i] = oldToNew[tv[i] >>> 0];
        this._vertProperties = compact;
        this._vertKeyToIndex = new Map();
        for (let i = 0; i < compact.length; i += 3) {
            this._vertKeyToIndex.set(`${compact[i]},${compact[i + 1]},${compact[i + 2]}`, (i / 3) | 0);
        }
    };
    compactVertices();

    if (logDiagnostics) {
        console.log("[splitSelfIntersectingTriangles] complete", {
            initialTriangles: triCount0,
            finalTriangles: (this._triVerts.length / 3) | 0,
            testedPairs,
            pairIntersections,
            pointIntersections,
            touchedTriangles,
            duplicateRemovals,
        });
    }

    return totalIntersections;
}

/**
 * Removes triangles with duplicate or collinear vertices (degenerate triangles)
 * @returns {number} Number of triangles removed
 */
export function removeDegenerateTriangles() {
    if (!this._triVerts || !this._vertProperties) {
        return 0;
    }
    try{ this._manifoldize(); } catch { 
        console.log("[removeDegenerateTriangles] manifoldization failed, proceeding with best effort cleanup");
        /* best effort */ 
    }

    // Vector utilities
    const vec = {
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        len: (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]),
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    };

    const originalCount = this._triVerts.length / 3;
    const newTriVerts = [];
    const newTriIDs = [];
    let removedCount = 0;

    // Helper function to check if triangle is degenerate
    const isDegenerate = (triIndex) => {
        const i = triIndex * 3;
        const v1Idx = this._triVerts[i] * 3;
        const v2Idx = this._triVerts[i + 1] * 3;
        const v3Idx = this._triVerts[i + 2] * 3;

        // Get vertex positions
        const v1 = [
            this._vertProperties[v1Idx],
            this._vertProperties[v1Idx + 1], 
            this._vertProperties[v1Idx + 2]
        ];
        const v2 = [
            this._vertProperties[v2Idx],
            this._vertProperties[v2Idx + 1],
            this._vertProperties[v2Idx + 2]
        ];
        const v3 = [
            this._vertProperties[v3Idx],
            this._vertProperties[v3Idx + 1],
            this._vertProperties[v3Idx + 2]
        ];

        // Check for duplicate vertices (tolerance based)
        const tolerance = 1e-10;
        const dist12 = vec.len(vec.sub(v1, v2));
        const dist23 = vec.len(vec.sub(v2, v3)); 
        const dist31 = vec.len(vec.sub(v3, v1));

        if (dist12 < tolerance || dist23 < tolerance || dist31 < tolerance) {
            return true; // Duplicate vertices
        }

        // Check for zero area (collinear vertices)
        const cross = vec.cross(vec.sub(v2, v1), vec.sub(v3, v1));
        const area = 0.5 * vec.len(cross);
        
        return area < 1e-12; // Near-zero area
    };

    // Filter out degenerate triangles
    for (let i = 0; i < originalCount; i++) {
        if (!isDegenerate(i)) {
            // Keep this triangle
            const triStart = i * 3;
            newTriVerts.push(this._triVerts[triStart]);
            newTriVerts.push(this._triVerts[triStart + 1]);
            newTriVerts.push(this._triVerts[triStart + 2]);
            newTriIDs.push(this._triIDs[i]);
        } else {
            removedCount++;
        }
    }

    // Update arrays
    this._triVerts = newTriVerts;
    this._triIDs = newTriIDs;
    if (removedCount > 0) {
        this._dirty = true;
        this._faceIndex = null;
        this._manifold = null;
    }

    return removedCount;
}

/**
 * Remove internal triangles by rebuilding from the native runtime Manifold surface.
 * - Returns the number of triangles removed.
 */
export function removeInternalTriangles() {
    const triCountBefore = (this._triVerts.length / 3) | 0;
    if (triCountBefore === 0) return 0;

    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeInternalTriangleCleanup,
        "Solid.removeInternalTriangles()"
    );
    const core = getSyncedCppSolidCore(this);
    const removed = core.removeInternalTriangles();
    syncSolidAuthoringStateFromCpp(this, core);
    this._dirty = false;
    this._faceIndex = null;
    try { if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
    this._manifold = null;
    return removed > 0 ? removed : 0;
}

/**
 * Remove internal triangles using a point-in-solid ray test.
 * Does not require manifold to succeed. For each triangle, cast a ray from its
 * centroid along +X and count intersections with all triangles. If the count is
 * odd (inside), the triangle is removed. Returns the number of triangles removed.
 */
export function removeInternalTrianglesByRaycast() {
    const vp = this._vertProperties;
    const tv = this._triVerts;
    const ids = this._triIDs;
    const triCount = (tv.length / 3) | 0;
    if (triCount === 0) return 0;

    // Build triangle list in point form for ray tests
    const faces = new Array(triCount);
    for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const i0 = tv[b + 0] >>> 0;
        const i1 = tv[b + 1] >>> 0;
        const i2 = tv[b + 2] >>> 0;
        faces[t] = [
            [vp[i0 * 3 + 0], vp[i0 * 3 + 1], vp[i0 * 3 + 2]],
            [vp[i1 * 3 + 0], vp[i1 * 3 + 1], vp[i1 * 3 + 2]],
            [vp[i2 * 3 + 0], vp[i2 * 3 + 1], vp[i2 * 3 + 2]],
        ];
    }

    // Bounding box for jitter
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = vp[i], y = vp[i + 1], z = vp[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const jitter = 1e-6 * diag;

    // Robust ray-triangle intersection (Möller–Trumbore), returns t > 0
    const rayTri = (orig, dir, tri) => {
        const EPS = 1e-12;
        const ax = tri[0][0], ay = tri[0][1], az = tri[0][2];
        const bx = tri[1][0], by = tri[1][1], bz = tri[1][2];
        const cx = tri[2][0], cy = tri[2][1], cz = tri[2][2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const px = dir[1] * e2z - dir[2] * e2y;
        const py = dir[2] * e2x - dir[0] * e2z;
        const pz = dir[0] * e2y - dir[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < EPS) return null;
        const invDet = 1.0 / det;
        const tvecx = orig[0] - ax, tvecy = orig[1] - ay, tvecz = orig[2] - az;
        const u = (tvecx * px + tvecy * py + tvecz * pz) * invDet;
        if (u < -1e-12 || u > 1 + 1e-12) return null;
        const qx = tvecy * e1z - tvecz * e1y;
        const qy = tvecz * e1x - tvecx * e1z;
        const qz = tvecx * e1y - tvecy * e1x;
        const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
        if (v < -1e-12 || u + v > 1 + 1e-12) return null;
        const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        return tHit > 1e-10 ? tHit : null;
    };

    const pointInside = (p) => {
        // Three-axis majority vote with jitter
        const dirs = [
            [1, 0, 0], [0, 1, 0], [0, 0, 1],
        ];
        let votes = 0;
        for (let k = 0; k < dirs.length; k++) {
            const dir = dirs[k];
            const offset = [p[0] + (k + 1) * jitter, p[1] + (k + 2) * jitter, p[2] + (k + 3) * jitter];
            let hits = 0;
            for (let i = 0; i < faces.length; i++) {
                const th = rayTri(offset, dir, faces[i]);
                if (th !== null) hits++;
            }
            if ((hits % 2) === 1) votes++;
        }
        return votes >= 2; // at least 2 of 3 say inside
    };

    // Compute slightly jittered centroids to avoid t≈0 self-hits
    const triProbe = (t) => {
        const [A, B, C] = faces[t];
        const px = (A[0] + B[0] + C[0]) / 3 + jitter;
        const py = (A[1] + B[1] + C[1]) / 3 + jitter;
        const pz = (A[2] + B[2] + C[2]) / 3 + jitter;
        return [px, py, pz];
    };

    const keepTri = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) keepTri[t] = 1;

    let removed = 0;
    for (let t = 0; t < triCount; t++) {
        const p = triProbe(t);
        if (pointInside(p)) { keepTri[t] = 0; removed++; }
    }

    if (removed === 0) return 0;

    // Rebuild compact mesh
    const nv = (vp.length / 3) | 0;
    const usedVert = new Uint8Array(nv);
    const newTV = [];
    const newIDs = [];
    for (let t = 0; t < triCount; t++) {
        if (!keepTri[t]) continue;
        const b = t * 3;
        const a = tv[b + 0] >>> 0;
        const b1 = tv[b + 1] >>> 0;
        const c = tv[b + 2] >>> 0;
        newTV.push(a, b1, c);
        newIDs.push(ids[t]);
        usedVert[a] = 1; usedVert[b1] = 1; usedVert[c] = 1;
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
    for (let i = 0; i < newTV.length; i++) newTV[i] = oldToNew[newTV[i]];

    this._vertProperties = newVP;
    this._triVerts = newTV;
    this._triIDs = newIDs;
    this._vertKeyToIndex = new Map();
    for (let i = 0; i < this._vertProperties.length; i += 3) {
        const x = this._vertProperties[i], y = this._vertProperties[i + 1], z = this._vertProperties[i + 2];
        this._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }
    this._dirty = true;
    this._faceIndex = null;
    // Fix orientation just in case
    this.fixTriangleWindingsByAdjacency();
    return removed;
}

/**
 * Remove internal triangles using solid-angle (winding number) test.
 * Computes sum of solid angles of all triangles at each triangle's centroid.
 * If |sumOmega| > threshold (≈ 2π), marks that triangle as inside and removes it.
 * Robust to self-intersections and coplanar cases; does not require Manifold.
 * @param {object} [options]
 * @param {number} [options.offsetScale=1e-5] centroid offset scale relative to bounding box diagonal
 * @param {number} [options.crossingTolerance=0.05] tolerance for deciding inside/outside crossings
 */
export function removeInternalTrianglesByWinding({ offsetScale = 1e-5, crossingTolerance = 0.05 } = {}) {
    // Do not run adjacency winding repair before classification here. A
    // self-intersecting mesh is non-manifold by definition, and adjacency repair
    // can propagate orientation across crossing/intersection edges in a way that
    // makes exterior pieces look internal. Classify using the authored triangle
    // orientations; repair the remaining shell after culling.
    const vp = this._vertProperties;
    const tv = this._triVerts;
    const ids = this._triIDs;
    const triCount = (tv.length / 3) | 0;
    if (triCount === 0) return 0;

    // Bounding box for epsilon offset scaling
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = vp[i], y = vp[i + 1], z = vp[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const eps = offsetScale * diag;

    // Prepare faces and normals
    const faces = new Array(triCount);
    const centroids = new Array(triCount);
    const normals = new Array(triCount);
    for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const i0 = tv[b + 0] >>> 0;
        const i1 = tv[b + 1] >>> 0;
        const i2 = tv[b + 2] >>> 0;
        const ax = vp[i0 * 3 + 0], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
        const bx = vp[i1 * 3 + 0], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
        const cx = vp[i2 * 3 + 0], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
        faces[t] = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
        centroids[t] = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-18) {
            normals[t] = [0, 0, 0];
        } else {
            normals[t] = [nx / nl, ny / nl, nz / nl];
        }
    }

    // Oriented solid angle of triangle ABC as seen from point P
    const solidAngle = (P, A, B, C) => {
        const ax = A[0] - P[0], ay = A[1] - P[1], az = A[2] - P[2];
        const bx = B[0] - P[0], by = B[1] - P[1], bz = B[2] - P[2];
        const cx = C[0] - P[0], cy = C[1] - P[1], cz = C[2] - P[2];
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
        if (la < 1e-18 || lb < 1e-18 || lc < 1e-18) return 0;
        const dotAB = ax * bx + ay * by + az * bz;
        const dotBC = bx * cx + by * cy + bz * cz;
        const dotCA = cx * ax + cy * ay + cz * az;
        const crossx = ay * bz - az * by;
        const crossy = az * bx - ax * bz;
        const crossz = ax * by - ay * bx;
        const triple = crossx * cx + crossy * cy + crossz * cz; // a·(b×c)
        const denom = la * lb * lc + dotAB * lc + dotBC * la + dotCA * lb;
        return 2 * Math.atan2(triple, denom);
    };

    // Generalized winding number w(P) in [−1,1]; normalized by 4π
    const winding = (P) => {
        let omega = 0;
        for (let u = 0; u < triCount; u++) {
            const [A, B, C] = faces[u];
            omega += solidAngle(P, A, B, C);
        }
        return omega / (4 * Math.PI);
    };

    const keepTri = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) keepTri[t] = 1;
    let removed = 0;
    const tau = Math.max(0, Math.min(0.49, crossingTolerance));

    for (let t = 0; t < triCount; t++) {
        const N = normals[t];
        if (!N || (N[0] === 0 && N[1] === 0 && N[2] === 0)) { continue; } // keep degenerate-orientation tris
        const C = centroids[t];
        const Pplus = [C[0] + N[0] * eps, C[1] + N[1] * eps, C[2] + N[2] * eps];
        const Pminus = [C[0] - N[0] * eps, C[1] - N[1] * eps, C[2] - N[2] * eps];
        const wPlus = winding(Pplus);
        const wMinus = winding(Pminus);
        const a = Math.abs(wPlus) - 0.5;
        const b = Math.abs(wMinus) - 0.5;
        const crosses = (a < -tau && b > tau) || (a > tau && b < -tau) || (a * b < -tau * tau);
        if (!crosses) { keepTri[t] = 0; removed++; }
    }

    if (removed === 0) return 0;

    // Rebuild compact mesh
    const nv = (vp.length / 3) | 0;
    const usedVert = new Uint8Array(nv);
    const newTV = [];
    const newIDs = [];
    for (let t = 0; t < triCount; t++) {
        if (!keepTri[t]) continue;
        const b = t * 3;
        const a = tv[b + 0] >>> 0;
        const b1 = tv[b + 1] >>> 0;
        const c = tv[b + 2] >>> 0;
        newTV.push(a, b1, c);
        newIDs.push(ids[t]);
        usedVert[a] = 1; usedVert[b1] = 1; usedVert[c] = 1;
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
    for (let i = 0; i < newTV.length; i++) newTV[i] = oldToNew[newTV[i]];

    this._vertProperties = newVP;
    this._triVerts = newTV;
    this._triIDs = newIDs;
    this._vertKeyToIndex = new Map();
    for (let i = 0; i < this._vertProperties.length; i += 3) {
        const x = this._vertProperties[i], y = this._vertProperties[i + 1], z = this._vertProperties[i + 2];
        this._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
    }
    this._dirty = true;
    this._faceIndex = null;
    this.fixTriangleWindingsByAdjacency();
    return removed;
}

/**
 * Reassign tiny disconnected islands within the same face label to the
 * largest adjacent face by surface area.
 *
 * This targets defects where a face name/ID is applied to multiple
 * disconnected triangle groups; small groups are relabeled.
 *
 * @param {number} size area threshold; components below this are reassigned
 * @returns {number} number of triangles reassigned
 */
export function cleanupTinyFaceIslands(size) {
    const maxArea = Number(size);
    if (!Number.isFinite(maxArea) || maxArea <= 0) return 0;

    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeTinyFaceIslandCleanup,
        "Solid.cleanupTinyFaceIslands()"
    );
    const core = getSyncedCppSolidCore(this);
    const reassigned = core.cleanupTinyFaceIslands(maxArea);
    if (reassigned > 0) {
        syncSolidAuthoringStateFromCpp(this, core);
        this._dirty = true;
        this._faceIndex = null;
        try { if (this._manifold && typeof this._manifold.delete === "function") this._manifold.delete(); } catch { }
        this._manifold = null;
    }
    return reassigned;
}

// Merge faces whose area is below a threshold into their largest adjacent neighbor.
export function mergeTinyFaces(maxArea = 0.001) {
    if (!Number.isFinite(maxArea) || maxArea <= 0) return this;

    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeTinyFaceMerge,
        "Solid.mergeTinyFaces()"
    );
    const core = getSyncedCppSolidCore(this);
    const merged = core.mergeTinyFaces(maxArea);
    if (merged > 0) {
        syncSolidAuthoringStateFromCpp(this, core);
        this._faceIndex = null;
        this._dirty = true;
        try { if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
        this._manifold = null;
        try {
            if (typeof this._manifoldize === 'function') {
                this._manifoldize();
                if (typeof this._ensureFaceIndex === 'function') this._ensureFaceIndex();
            }
        } catch { }
    }
    return this;
}

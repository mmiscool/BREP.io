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

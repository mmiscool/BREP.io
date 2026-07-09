/**
 * Self-intersection detection, splitting, and cleanup utilities.
 *
 * These methods operate directly on Solid authoring arrays and deliberately
 * avoid manifoldization during detection and splitting.
 */

import { manifold } from "../setupManifold.js";

type AnyRecord = Record<string, any>;

function invalidateGeometryCaches(solid: any) {
    solid._dirty = true;
    solid._faceIndex = null;
    solid._visualizeCache = null;
    solid._minGapIndex = null;
    solid._cppSolidCoreSyncStamp = null;
    try { if (solid._manifold && typeof solid._manifold.delete === "function") solid._manifold.delete(); } catch { /* ignore */ }
    solid._manifold = null;
}

function rebuildVertexKeyToIndex(solid: any) {
    solid._vertKeyToIndex = new Map();
    const vp = solid._vertProperties || [];
    for (let i = 0; i < vp.length; i += 3) {
        solid._vertKeyToIndex.set(`${vp[i]},${vp[i + 1]},${vp[i + 2]}`, (i / 3) | 0);
    }
}

function modelTolerance(solid: any, explicit: any = null) {
    if (Number.isFinite(Number(explicit)) && Number(explicit) > 0) return Number(explicit);
    const vp = solid._vertProperties || [];
    if (vp.length < 3) return 1e-9;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = vp[i], y = vp[i + 1], z = vp[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    return Math.max(1e-9, (Number.isFinite(diag) && diag > 0 ? diag : 1) * 1e-9);
}

function validateAuthoringArrays(solid: any) {
    const vp = solid._vertProperties;
    const tv = solid._triVerts;
    const ids = solid._triIDs;
    if (!Array.isArray(vp) || !Array.isArray(tv) || !Array.isArray(ids)) {
        throw new Error("Solid self-intersection cleanup requires array-backed authoring buffers.");
    }
    if (vp.length % 3 !== 0 || tv.length % 3 !== 0) {
        throw new Error("Invalid Solid authoring buffers: vertex and triangle arrays must be multiples of 3.");
    }
    const vertexCount = (vp.length / 3) | 0;
    const triCount = (tv.length / 3) | 0;
    if (ids.length !== triCount) {
        throw new Error("Invalid Solid authoring buffers: _triIDs length must match triangle count.");
    }
    for (let i = 0; i < vp.length; i++) {
        if (!Number.isFinite(vp[i])) throw new Error(`Invalid Solid vertex coordinate at _vertProperties[${i}].`);
    }
    for (let i = 0; i < tv.length; i++) {
        const index = tv[i];
        if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
            throw new Error(`Invalid Solid triangle vertex index at _triVerts[${i}].`);
        }
    }
}

function triangleAreaFromIndices(vp: any[], a: number, b: number, c: number) {
    const ax = vp[a * 3], ay = vp[a * 3 + 1], az = vp[a * 3 + 2];
    const bx = vp[b * 3], by = vp[b * 3 + 1], bz = vp[b * 3 + 2];
    const cx = vp[c * 3], cy = vp[c * 3 + 1], cz = vp[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
}

function removeInvalidAndDuplicateTriangles(solid: any, tolerance = modelTolerance(solid)) {
    const vp = solid._vertProperties || [];
    const tv = solid._triVerts || [];
    const ids = solid._triIDs || [];
    const triCount = (tv.length / 3) | 0;
    const areaEps = Math.max(1e-18, tolerance * tolerance);
    const q = (index) => {
        const i = index * 3;
        return `${Math.round(vp[i] / tolerance)},${Math.round(vp[i + 1] / tolerance)},${Math.round(vp[i + 2] / tolerance)}`;
    };
    const seen = new Map();
    const newTV = [];
    const newIDs = [];
    let removedDegenerate = 0;
    let removedDuplicate = 0;
    for (let t = 0; t < triCount; t++) {
        const base = t * 3;
        const a = tv[base] >>> 0, b = tv[base + 1] >>> 0, c = tv[base + 2] >>> 0;
        if (a === b || b === c || c === a || triangleAreaFromIndices(vp, a, b, c) <= areaEps) {
            removedDegenerate++;
            continue;
        }
        const key = [q(a), q(b), q(c)].sort().join("|");
        if (seen.has(key)) {
            removedDuplicate++;
            continue;
        }
        seen.set(key, t);
        newTV.push(a, b, c);
        newIDs.push(ids[t]);
    }
    if (removedDegenerate || removedDuplicate) {
        solid._triVerts = newTV;
        solid._triIDs = newIDs;
        invalidateGeometryCaches(solid);
    }
    return { removedDegenerate, removedDuplicate };
}

function compactUnusedVertices(solid: any) {
    const vp = solid._vertProperties || [];
    const tv = solid._triVerts || [];
    const vertexCount = (vp.length / 3) | 0;
    const used = new Uint8Array(vertexCount);
    for (const index of tv) used[index >>> 0] = 1;
    const oldToNew = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) oldToNew[i] = -1;
    const newVP = [];
    let next = 0;
    for (let i = 0; i < vertexCount; i++) {
        if (!used[i]) continue;
        oldToNew[i] = next++;
        newVP.push(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]);
    }
    for (let i = 0; i < tv.length; i++) tv[i] = oldToNew[tv[i] >>> 0];
    if (newVP.length !== vp.length) {
        solid._vertProperties = newVP;
        invalidateGeometryCaches(solid);
    }
    rebuildVertexKeyToIndex(solid);
}

function meshClosedAndCoherent(solid: any) {
    const tv = solid._triVerts || [];
    const triCount = (tv.length / 3) | 0;
    const edges = new Map();
    const key = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    for (let t = 0; t < triCount; t++) {
        const a = tv[t * 3] >>> 0, b = tv[t * 3 + 1] >>> 0, c = tv[t * 3 + 2] >>> 0;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const k = key(u, v);
            let entry = edges.get(k);
            if (!entry) { entry = []; edges.set(k, entry); }
            entry.push(`${u}>${v}`);
        }
    }
    for (const uses of edges.values()) {
        if (uses.length !== 2) return false;
        const [a0, b0] = uses[0].split(">");
        const [a1, b1] = uses[1].split(">");
        if (!(a0 === b1 && b0 === a1)) return false;
    }
    return true;
}

function normalizeSplitOptions(options: any = false): AnyRecord {
    if (options === true || options === false) return { diagnostics: options === true };
    return options && typeof options === "object" ? { ...options } : {};
}

export function findSelfIntersections(this: any, options: any = {}) {
    validateAuthoringArrays(this);
    const opts = {
        ...normalizeSplitOptions(options),
        detectOnly: true,
        returnIntersections: true,
        snapTolerance: modelTolerance(this, options?.tolerance ?? null),
        includePointContacts: options?.includePointContacts !== false,
        includeCoplanar: options?.includeCoplanar !== false,
    };
    return splitSelfIntersectingTriangles.call(this, opts);
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
export function splitSelfIntersectingTriangles(this: any, diagnostics: any = false) {
    const opts = normalizeSplitOptions(diagnostics);
    const logDiagnostics = opts.diagnostics === true;
    const detectOnly = opts.detectOnly === true || opts.probeOnly === true;
    const returnIntersections = opts.returnIntersections === true;
    const includePointContacts = opts.includePointContacts !== false;
    const includeCoplanar = opts.includeCoplanar !== false;
    const maxIntersections = Math.max(0, Number(opts.maxIntersections) || 0);
    const sourceVP = Array.from(this._vertProperties || []) as number[];
    const sourceTV = Array.from(this._triVerts || []) as number[];
    const sourceIDs = Array.from(this._triIDs || []) as any[];
    const triCount0 = (sourceTV.length / 3) | 0;
    if (triCount0 < 2 || sourceVP.length < 9) return detectOnly && returnIntersections ? [] : 0;

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
    const snapEps = Math.max(1e-9, Number(opts.snapTolerance) || Number(opts.tolerance) || modelScale * 1e-9);
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
            return { type: "coplanar", segments };
        }
        if (hull.length >= 2 && v2.dist(hull[0], hull[hull.length - 1]) > snapEps) {
            return { type: "coplanar", segments: [[basis.unproject(hull[0]), basis.unproject(hull[hull.length - 1])]] };
        }
        return null;
    };

    const triangleIntersection = (triA: any, triB: any): any => {
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
        if (vec.dist(p, q) > snapEps) return { type: "segment", segments: [[p, q]] };
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
    const intersectionRecords = [];
    const addIntersectionRecord = (triangleA, triangleB, hit, segments = []) => {
        const points = [];
        const add = (point) => {
            if (!point) return;
            if (points.some((existing) => vec.dist(existing, point) <= snapEps)) return;
            points.push([point[0], point[1], point[2]]);
        };
        if (hit.type === "point") add(hit.point);
        for (const [p, q] of segments) {
            add(p);
            add(q);
        }
        intersectionRecords.push({
            triangleA,
            triangleB,
            type: hit.type === "coplanar" ? "coplanar" : hit.type === "point" ? "point" : "segment",
            points,
            segments: segments.map(([p, q]) => [[p[0], p[1], p[2]], [q[0], q[1], q[2]]]),
        });
    };
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
            if (hit.type === "point" && !includePointContacts) continue;
            if (hit.type === "coplanar" && !includeCoplanar) continue;
            const commonPoints = sharedCoordinatePoints(a, b);
            if (commonPoints.length > 0) {
                const touchesCommonPoint = (point) => commonPoints.some((common) => vec.dist(point, common) <= snapEps);
                if (hit.type === "point" && touchesCommonPoint(hit.point)) continue;
                if (hit.type === "segment" || hit.type === "coplanar" || hit.type === "segments") {
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
                addIntersectionRecord(ai, bi, hit);
                pointIntersections++;
                if (detectOnly && maxIntersections > 0 && (pairIntersections + pointIntersections) >= maxIntersections) {
                    return returnIntersections ? intersectionRecords : pairIntersections + pointIntersections;
                }
                continue;
            }
            let addedForPair = false;
            const acceptedSegments = [];
            for (const [p, q] of hit.segments || []) {
                if (isOnlySharedEdge(a, b, p, q)) continue;
                addSegment(a, p, q);
                addSegment(b, p, q);
                acceptedSegments.push([p, q]);
                addedForPair = true;
            }
            if (addedForPair) {
                addIntersectionRecord(ai, bi, hit, acceptedSegments);
                pairIntersections++;
                if (detectOnly && maxIntersections > 0 && (pairIntersections + pointIntersections) >= maxIntersections) {
                    return returnIntersections ? intersectionRecords : pairIntersections + pointIntersections;
                }
            }
        }
    }

    const totalIntersections = pairIntersections + pointIntersections;
    if (detectOnly) return returnIntersections ? intersectionRecords : totalIntersections;
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

        const edgeSet = new Set<string>();
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

        const adjacency = new Map<number, any>();
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
            adjacency.set(index, (Array.from(set) as number[]).sort((a, b) => {
                const pa = localPoints[a].p2;
                const pb = localPoints[b].p2;
                return Math.atan2(pa[1] - p[1], pa[0] - p[0]) - Math.atan2(pb[1] - p[1], pb[0] - p[0]);
            }));
        }

        const directedVisited = new Set<string>();
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
    invalidateGeometryCaches(this);

    removeInvalidAndDuplicateTriangles(this, snapEps);

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
        invalidateGeometryCaches(this);
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
        rebuildVertexKeyToIndex(this);
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
 * Remove internal triangles using solid-angle (winding number) test.
 * Computes sum of solid angles of all triangles at each triangle's centroid.
 * If |sumOmega| > threshold (≈ 2π), marks that triangle as inside and removes it.
 * Robust to self-intersections and coplanar cases; does not require Manifold.
 * @param {object} [options]
 * @param {number} [options.offsetScale=1e-5] centroid offset scale relative to bounding box diagonal
 * @param {number} [options.crossingTolerance=0.05] tolerance for deciding inside/outside crossings
 */
export function removeInternalTrianglesByWinding(this: any, { offsetScale = 1e-5, crossingTolerance = 0.05 }: any = {}) {
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

    // Native classifier runs the same O(T^2) winding classification in WASM;
    // the JS loop below is the fallback when the binding is unavailable.
    let keepTri: Uint8Array | null = null;
    let removed = 0;
    if (typeof (manifold as any)?.classifyInternalTrianglesByWinding === "function") {
        try {
            const mask = (manifold as any).classifyInternalTrianglesByWinding(
                vp,
                tv,
                Number(offsetScale) || 0,
                Number(crossingTolerance) || 0,
            );
            if (mask && mask.length === triCount) {
                keepTri = mask;
                for (let t = 0; t < triCount; t++) {
                    if (!mask[t]) removed++;
                }
            }
        } catch {
            keepTri = null;
            removed = 0;
        }
    }
    if (!keepTri) {
        const classified = classifyInternalTrianglesByWindingJs(vp, tv, triCount, offsetScale, crossingTolerance);
        keepTri = classified.keepTri;
        removed = classified.removed;
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
    invalidateGeometryCaches(this);
    this.fixTriangleWindingsByAdjacency();
    return removed;
}

function classifyInternalTrianglesByWindingJs(vp, tv, triCount, offsetScale, crossingTolerance) {
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

    // Prepare faces and normals in flat typed arrays (hot O(T^2) loop below).
    const triCoords = new Float64Array(triCount * 9);
    const centroids = new Float64Array(triCount * 3);
    const normals = new Float64Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const i0 = tv[b + 0] >>> 0;
        const i1 = tv[b + 1] >>> 0;
        const i2 = tv[b + 2] >>> 0;
        const ax = vp[i0 * 3 + 0], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
        const bx = vp[i1 * 3 + 0], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
        const cx = vp[i2 * 3 + 0], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
        const c9 = t * 9;
        triCoords[c9 + 0] = ax; triCoords[c9 + 1] = ay; triCoords[c9 + 2] = az;
        triCoords[c9 + 3] = bx; triCoords[c9 + 4] = by; triCoords[c9 + 5] = bz;
        triCoords[c9 + 6] = cx; triCoords[c9 + 7] = cy; triCoords[c9 + 8] = cz;
        centroids[b + 0] = (ax + bx + cx) / 3;
        centroids[b + 1] = (ay + by + cy) / 3;
        centroids[b + 2] = (az + bz + cz) / 3;
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl >= 1e-18) {
            normals[b + 0] = nx / nl;
            normals[b + 1] = ny / nl;
            normals[b + 2] = nz / nl;
        }
    }

    const keepTri = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) keepTri[t] = 1;
    let removed = 0;
    const tau = Math.max(0, Math.min(0.49, crossingTolerance));
    const FOUR_PI = 4 * Math.PI;

    for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const nx = normals[b + 0], ny = normals[b + 1], nz = normals[b + 2];
        if (nx === 0 && ny === 0 && nz === 0) { continue; } // keep degenerate-orientation tris
        const cx0 = centroids[b + 0], cy0 = centroids[b + 1], cz0 = centroids[b + 2];
        const pxP = cx0 + nx * eps, pyP = cy0 + ny * eps, pzP = cz0 + nz * eps;
        const pxM = cx0 - nx * eps, pyM = cy0 - ny * eps, pzM = cz0 - nz * eps;
        // Generalized winding numbers at centroid +/- eps along the normal,
        // accumulated in the same triangle order for both query points.
        let omegaP = 0;
        let omegaM = 0;
        for (let u = 0, c9 = 0; u < triCount; u++, c9 += 9) {
            const Ax = triCoords[c9 + 0], Ay = triCoords[c9 + 1], Az = triCoords[c9 + 2];
            const Bx = triCoords[c9 + 3], By = triCoords[c9 + 4], Bz = triCoords[c9 + 5];
            const Cx = triCoords[c9 + 6], Cy = triCoords[c9 + 7], Cz = triCoords[c9 + 8];
            {
                const ax = Ax - pxP, ay = Ay - pyP, az = Az - pzP;
                const bx = Bx - pxP, by = By - pyP, bz = Bz - pzP;
                const cx = Cx - pxP, cy = Cy - pyP, cz = Cz - pzP;
                const la = Math.sqrt(ax * ax + ay * ay + az * az);
                const lb = Math.sqrt(bx * bx + by * by + bz * bz);
                const lc = Math.sqrt(cx * cx + cy * cy + cz * cz);
                if (la >= 1e-18 && lb >= 1e-18 && lc >= 1e-18) {
                    const dotAB = ax * bx + ay * by + az * bz;
                    const dotBC = bx * cx + by * cy + bz * cz;
                    const dotCA = cx * ax + cy * ay + cz * az;
                    const triple = (ay * bz - az * by) * cx + (az * bx - ax * bz) * cy + (ax * by - ay * bx) * cz;
                    const denom = la * lb * lc + dotAB * lc + dotBC * la + dotCA * lb;
                    omegaP += 2 * Math.atan2(triple, denom);
                }
            }
            {
                const ax = Ax - pxM, ay = Ay - pyM, az = Az - pzM;
                const bx = Bx - pxM, by = By - pyM, bz = Bz - pzM;
                const cx = Cx - pxM, cy = Cy - pyM, cz = Cz - pzM;
                const la = Math.sqrt(ax * ax + ay * ay + az * az);
                const lb = Math.sqrt(bx * bx + by * by + bz * bz);
                const lc = Math.sqrt(cx * cx + cy * cy + cz * cz);
                if (la >= 1e-18 && lb >= 1e-18 && lc >= 1e-18) {
                    const dotAB = ax * bx + ay * by + az * bz;
                    const dotBC = bx * cx + by * cy + bz * cz;
                    const dotCA = cx * ax + cy * ay + cz * az;
                    const triple = (ay * bz - az * by) * cx + (az * bx - ax * bz) * cy + (ax * by - ay * bx) * cz;
                    const denom = la * lb * lc + dotAB * lc + dotBC * la + dotCA * lb;
                    omegaM += 2 * Math.atan2(triple, denom);
                }
            }
        }
        const wPlus = omegaP / FOUR_PI;
        const wMinus = omegaM / FOUR_PI;
        const a = Math.abs(wPlus) - 0.5;
        const b2 = Math.abs(wMinus) - 0.5;
        const crosses = (a < -tau && b2 > tau) || (a > tau && b2 < -tau) || (a * b2 < -tau * tau);
        if (!crosses) { keepTri[t] = 0; removed++; }
    }

    return { keepTri, removed };
}

export function cleanupSelfIntersections(this: any, options: any = {}) {
    const opts: AnyRecord = options && typeof options === "object" ? options : {};
    const tolerance = modelTolerance(this, opts.tolerance ?? null);
    const maxPasses = Math.max(1, Number.isInteger(opts.maxPasses) ? opts.maxPasses : 3);
    const report = {
        intersectionsFound: 0,
        passes: 0,
        sourceTrianglesSplit: 0,
        trianglesAdded: 0,
        internalTrianglesRemoved: 0,
        duplicateTrianglesRemoved: 0,
        finalTriangleCount: (this._triVerts?.length / 3) | 0,
        intersectionFree: true,
        closed: true,
        complete: true,
    };

    validateAuthoringArrays(this);
    const pre = removeInvalidAndDuplicateTriangles(this, tolerance);
    report.duplicateTrianglesRemoved += pre.removedDuplicate;
    compactUnusedVertices(this);

    for (let pass = 0; pass < maxPasses; pass++) {
        const beforeTriCount = (this._triVerts.length / 3) | 0;
        const intersections = findSelfIntersections.call(this, {
            tolerance,
            includePointContacts: true,
            includeCoplanar: opts.includeCoplanar !== false,
        });
        if (pass === 0) report.intersectionsFound = intersections.length;
        if (intersections.length === 0) {
            if (pass === 0 && opts.removeInternal !== false) {
                try {
                    report.internalTrianglesRemoved += removeInternalTrianglesByWinding.call(this, {
                        offsetScale: 1e-5,
                        crossingTolerance: 0.05,
                    });
                } catch {
                    report.complete = false;
                }
                const removed = removeInvalidAndDuplicateTriangles(this, tolerance);
                report.duplicateTrianglesRemoved += removed.removedDuplicate;
                compactUnusedVertices(this);
            }
            break;
        }

        const touched = new Set();
        for (const hit of intersections) {
            touched.add(hit.triangleA);
            touched.add(hit.triangleB);
        }
        const splitCount = splitSelfIntersectingTriangles.call(this, {
            diagnostics: opts.diagnostics === true,
            tolerance,
            snapTolerance: tolerance,
            includePointContacts: true,
            includeCoplanar: opts.includeCoplanar !== false,
        });
        report.passes++;
        report.sourceTrianglesSplit += touched.size || splitCount;
        report.trianglesAdded += Math.max(0, ((this._triVerts.length / 3) | 0) - beforeTriCount);

        if (opts.removeInternal !== false) {
            try {
                report.internalTrianglesRemoved += removeInternalTrianglesByWinding.call(this, {
                    offsetScale: 1e-5,
                    crossingTolerance: 0.05,
                });
            } catch {
                report.complete = false;
            }
        }

        const removed = removeInvalidAndDuplicateTriangles(this, tolerance);
        report.duplicateTrianglesRemoved += removed.removedDuplicate;
        compactUnusedVertices(this);
    }

    const finalDuplicates = removeInvalidAndDuplicateTriangles(this, tolerance);
    report.duplicateTrianglesRemoved += finalDuplicates.removedDuplicate;
    compactUnusedVertices(this);
    try { this.fixTriangleWindingsByAdjacency(); } catch { report.complete = false; }

    const remaining = findSelfIntersections.call(this, {
        tolerance,
        includePointContacts: false,
        includeCoplanar: opts.includeCoplanar !== false,
    });
    report.finalTriangleCount = (this._triVerts.length / 3) | 0;
    report.intersectionFree = remaining.length === 0;
    report.closed = meshClosedAndCoherent(this);
    report.complete = report.complete && report.intersectionFree && report.closed && this._triIDs.length === report.finalTriangleCount;

    if (opts.validate !== false) {
        try {
            if (typeof this._manifoldize === "function") {
                this._manifoldize();
                this._dirty = true;
                try { if (this._manifold && typeof this._manifold.delete === "function") this._manifold.delete(); } catch { /* ignore */ }
                this._manifold = null;
            }
        } catch {
            report.complete = false;
        }
    }
    invalidateGeometryCaches(this);
    return report;
}

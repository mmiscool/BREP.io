import * as THREE from 'three';
import { Solid } from "../BetterSolid.js";
import { Tube } from "../Tube.js";
import { computeFaceAreaFromTriangles } from "./filletGeometry.js";
import { buildPointInsideTester } from '../utils/pointInsideTester.js';
import {
    averageFaceNormalObjectSpace,
    batchProjectPointsOntoFace,
    clamp,
    getAngleTolerance,
    getCachedFaceDataForTris,
    getDistanceTolerance,
    getScaleAdaptiveTolerance,
    isFiniteVec3,
    localFaceNormalAtPoint,
    projectPointOntoFaceTriangles,
} from './inset.js';
import {
    solveCenterFromOffsetPlanesAnchored,
} from './outset.js';

export { clearFilletCaches, trimFilletCaches } from './inset.js';
export { fixTJunctionsAndPatchHoles } from './outset.js';

function normalizeFilletSideMode(sideMode = 'INSET') {
    return String(sideMode || 'INSET').toUpperCase() === 'OUTSET' ? 'OUTSET' : 'INSET';
}

function createFilletSidePolicy(sideMode = 'INSET') {
    const mode = normalizeFilletSideMode(sideMode);
    const isOutset = mode === 'OUTSET';
    return {
        mode,
        isOutset,
        isInset: !isOutset,
        preferOutsetCenter: isOutset,
        bisectorFlipForOutset: isOutset,
        defaultWedgeOffsetSign: isOutset ? 1 : -1, // +1 => toward centerline, -1 => away
        useInsideCheckForWedge: isOutset,
        applyOpenEndCapPush: !isOutset,
    };
}

function visualizeCenterlineDebug(name, points, closedLoop, options = {}) {
    const marker = String(options.marker || '').trim();
    const label = String(options.label || 'CENTERLINE').trim();
    const materialKey = String(options.materialKey || 'YELLOW').trim();
    const auxName = String(options.auxName || label).trim();
    const suffix = String(options.nameSuffix || label).trim();
    const onSuccess = String(options.successMessage || '').trim();
    const onFailure = String(options.failureMessage || '').trim();
    const prefix = marker ? `${marker} ` : '';
    if (!Array.isArray(points) || points.length < 2) return;

    console.log(`${prefix}${label}:`);
    const visualization = new Solid();
    visualization.name = `${name}_${suffix}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        console.log(`  Segment ${i}: (${p1.x.toFixed(3)}, ${p1.y.toFixed(3)}, ${p1.z.toFixed(3)}) → (${p2.x.toFixed(3)}, ${p2.y.toFixed(3)}, ${p2.z.toFixed(3)})`);
    }

    const centerlineArray = points.map((pt) => [pt.x, pt.y, pt.z]);
    visualization.addAuxEdge(auxName, centerlineArray, {
        materialKey,
        closedLoop: !!closedLoop,
        lineWidth: 3.0
    });

    try {
        visualization.visualize();
        if (onSuccess) console.log(onSuccess);
    } catch (error) {
        if (onFailure) console.warn(onFailure, error?.message || error);
    }
}

function collectFaceVertices(tris) {
    const verts = [];
    if (!Array.isArray(tris)) return verts;
    for (const t of tris) {
        if (t?.p1) verts.push(t.p1);
        if (t?.p2) verts.push(t.p2);
        if (t?.p3) verts.push(t.p3);
    }
    return verts;
}

function createFilletResultPayload({
    tube = null,
    wedge = null,
    finalSolid = null,
    centerline = [],
    tangentA = [],
    tangentB = [],
    edge = [],
    edgeWedge = [],
    tangentASeam = [],
    tangentBSeam = [],
    tubeCapPointsBeforeNudge = { start: [], end: [] },
    error = null,
} = {}) {
    const out = {
        tube,
        wedge,
        finalSolid,
        centerline,
        tangentA,
        tangentB,
        edge,
        edgeWedge,
        tangentASeam,
        tangentBSeam,
        tubeCapPointsBeforeNudge,
    };
    if (error != null) out.error = String(error);
    return out;
}

function point3ArrayFromAny(point) {
    if (Array.isArray(point) && point.length >= 3) {
        const x = Number(point[0]);
        const y = Number(point[1]);
        const z = Number(point[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
        return null;
    }
    if (point && typeof point === 'object') {
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
    }
    return null;
}

function pushUniquePoint3Array(target, point, eps2 = 1e-14) {
    if (!Array.isArray(target)) return;
    const p = point3ArrayFromAny(point);
    if (!p) return;
    const px = p[0], py = p[1], pz = p[2];
    for (let i = 0; i < target.length; i++) {
        const q = target[i];
        const dx = px - q[0];
        const dy = py - q[1];
        const dz = pz - q[2];
        if (((dx * dx) + (dy * dy) + (dz * dz)) <= eps2) return;
    }
    target.push([px, py, pz]);
}

function collectUniqueFacePointArrays(solid, faceName, eps = 1e-7) {
    if (!solid || typeof solid.getFace !== 'function' || !faceName) return [];
    const tris = solid.getFace(faceName);
    if (!Array.isArray(tris) || tris.length === 0) return [];
    const out = [];
    const tol = Math.max(1e-12, Math.abs(Number(eps) || 1e-7));
    const eps2 = tol * tol;
    for (const tri of tris) {
        pushUniquePoint3Array(out, tri?.p1, eps2);
        pushUniquePoint3Array(out, tri?.p2, eps2);
        pushUniquePoint3Array(out, tri?.p3, eps2);
    }
    return out;
}

function captureOpenTubeCapPointsForPath(pathPoints, radius, resolution, probeName) {
    const pts = Array.isArray(pathPoints) ? pathPoints.map(point3ArrayFromAny).filter(Boolean) : [];
    if (pts.length < 2) return { start: [], end: [] };
    const name = String(probeName || 'FILLET_TUBE_CAP_CAPTURE');
    let probeTube = null;
    try {
        probeTube = new Tube({
            points: pts,
            radius: Number(radius) || 0,
            innerRadius: 0,
            resolution: Number.isFinite(Number(resolution)) ? Math.max(8, Math.floor(Number(resolution))) : 16,
            selfUnion: true,
            name,
        });
        return {
            start: collectUniqueFacePointArrays(probeTube, `${name}_CapStart`, 1e-7),
            end: collectUniqueFacePointArrays(probeTube, `${name}_CapEnd`, 1e-7),
        };
    } catch {
        return { start: [], end: [] };
    } finally {
        try { probeTube?.free?.(); } catch { }
    }
}

function sanitizeFilletInputPolyline(polylineLocal, tolerance = 1e-9) {
    const src = Array.isArray(polylineLocal) ? polylineLocal : [];
    if (src.length === 0) return [];

    const tol = Number.isFinite(tolerance)
        ? Math.max(1e-12, Math.abs(tolerance))
        : 1e-9;
    const tol2 = tol * tol;
    const parsed = [];

    for (let i = 0; i < src.length; i++) {
        const pt = src[i];
        if (!Array.isArray(pt) || pt.length < 3) continue;
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        const z = Number(pt[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        parsed.push([x, y, z]);
    }
    if (parsed.length === 0) return [];

    const out = [];
    for (let i = 0; i < parsed.length; i++) {
        const pt = parsed[i];
        const x = pt[0];
        const y = pt[1];
        const z = pt[2];

        if (out.length > 0) {
            const prev = out[out.length - 1];
            const dx = x - prev[0];
            const dy = y - prev[1];
            const dz = z - prev[2];
            if (((dx * dx) + (dy * dy) + (dz * dz)) <= tol2) continue;
        }
        out.push([x, y, z]);
    }
    if (out.length < 3) return out;

    // Second pass: strip micro-segments relative to the edge scale so cleanup
    // does not flip behavior based on fillet radius.
    let totalLen = 0;
    let maxSegLen = 0;
    for (let i = 1; i < out.length; i++) {
        const a = out[i - 1];
        const b = out[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (!Number.isFinite(len) || len <= 0) continue;
        totalLen += len;
        if (len > maxSegLen) maxSegLen = len;
    }
    const adaptiveTol = Math.max(
        tol,
        totalLen * 1e-7,
        maxSegLen * 1e-6,
    );
    const adaptiveTol2 = adaptiveTol * adaptiveTol;
    if (adaptiveTol2 <= tol2) return out;

    const refined = [];
    for (let i = 0; i < out.length; i++) {
        const p = out[i];
        if (refined.length === 0) {
            refined.push(p);
            continue;
        }
        const prev = refined[refined.length - 1];
        const dx = p[0] - prev[0];
        const dy = p[1] - prev[1];
        const dz = p[2] - prev[2];
        if (((dx * dx) + (dy * dy) + (dz * dz)) <= adaptiveTol2) continue;
        refined.push(p);
    }
    return refined.length >= 2 ? refined : out;
}

function computeProjectionRange(verts, dir) {
    if (!Array.isArray(verts) || verts.length === 0 || !dir) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of verts) {
        const x = v[0], y = v[1], z = v[2];
        const dot = x * dir.x + y * dir.y + z * dir.z;
        if (dot < min) min = dot;
        if (dot > max) max = dot;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
}

function isFiniteFilletPoint(point) {
    return !!point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && Number.isFinite(point.z);
}

function cloneFilletPoint(point) {
    if (!isFiniteFilletPoint(point)) return { x: 0, y: 0, z: 0 };
    return { x: point.x, y: point.y, z: point.z };
}

function cloneFilletPolyline(points, count = null) {
    const src = Array.isArray(points) ? points : [];
    const n = Number.isInteger(count)
        ? Math.max(0, Math.min(src.length, count))
        : src.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = cloneFilletPoint(src[i]);
    return out;
}

function filletPointsMatchWithinTolerance(a, b, eps = 1e-9) {
    if (!isFiniteFilletPoint(a) || !isFiniteFilletPoint(b)) return false;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return ((dx * dx) + (dy * dy) + (dz * dz)) <= (eps * eps);
}

function filletPolylineBacktrackingStats(referencePoints, candidatePoints) {
    const ref = Array.isArray(referencePoints) ? referencePoints : [];
    const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
    const count = Math.min(ref.length, candidate.length);
    if (count < 2) {
        return { checkedSegments: 0, backtrackingSegments: 0, worstCos: 1 };
    }

    let checkedSegments = 0;
    let backtrackingSegments = 0;
    let worstCos = 1;
    for (let i = 0; i < count - 1; i++) {
        const r0 = ref[i];
        const r1 = ref[i + 1];
        const c0 = candidate[i];
        const c1 = candidate[i + 1];
        if (!isFiniteFilletPoint(r0) || !isFiniteFilletPoint(r1)
            || !isFiniteFilletPoint(c0) || !isFiniteFilletPoint(c1)) {
            continue;
        }

        const rdx = r1.x - r0.x;
        const rdy = r1.y - r0.y;
        const rdz = r1.z - r0.z;
        const cdx = c1.x - c0.x;
        const cdy = c1.y - c0.y;
        const cdz = c1.z - c0.z;
        const rLen = Math.hypot(rdx, rdy, rdz);
        const cLen = Math.hypot(cdx, cdy, cdz);
        if (!(rLen > 1e-12) || !(cLen > 1e-12)) continue;

        checkedSegments++;
        const cos = (rdx * cdx + rdy * cdy + rdz * cdz) / (rLen * cLen);
        if (cos < worstCos) worstCos = cos;
        if (cos < -1e-6) backtrackingSegments++;
    }

    return { checkedSegments, backtrackingSegments, worstCos };
}

function filletSmoothPolylineKinks(points, options = {}) {
    const source = Array.isArray(points) ? points : [];
    const count = source.length;
    const rawStrength = Number(options?.strength);
    const strength = Number.isFinite(rawStrength)
        ? Math.max(0, Math.min(1, rawStrength))
        : 1;
    if (count < 3 || strength <= 0) return cloneFilletPolyline(source);
    if (!source.every((p) => isFiniteFilletPoint(p))) return cloneFilletPolyline(source);

    const iterations = 1 + Math.floor(strength * 2); // 1..3 passes
    let current = cloneFilletPolyline(source);
    for (let pass = 0; pass < iterations; pass++) {
        const next = cloneFilletPolyline(current);
        let movedInPass = false;
        for (let i = 1; i < count - 1; i++) {
            const prev = current[i - 1];
            const cur = current[i];
            const after = current[i + 1];
            if (!isFiniteFilletPoint(prev) || !isFiniteFilletPoint(cur) || !isFiniteFilletPoint(after)) continue;

            const vPrevX = cur.x - prev.x;
            const vPrevY = cur.y - prev.y;
            const vPrevZ = cur.z - prev.z;
            const vNextX = after.x - cur.x;
            const vNextY = after.y - cur.y;
            const vNextZ = after.z - cur.z;
            const lenPrev = Math.hypot(vPrevX, vPrevY, vPrevZ);
            const lenNext = Math.hypot(vNextX, vNextY, vNextZ);
            if (!(lenPrev > 1e-12) || !(lenNext > 1e-12)) continue;

            const dotRaw = ((vPrevX * vNextX) + (vPrevY * vNextY) + (vPrevZ * vNextZ)) / (lenPrev * lenNext);
            const dot = Math.max(-1, Math.min(1, dotRaw));
            const kinkFactor = Math.max(0, (1 - dot) * 0.5);
            if (kinkFactor < 0.01) continue;

            const localWeight = strength * Math.sqrt(kinkFactor);
            if (!(localWeight > 1e-6)) continue;

            const targetX = (prev.x + after.x) * 0.5;
            const targetY = (prev.y + after.y) * 0.5;
            const targetZ = (prev.z + after.z) * 0.5;
            let moveX = (targetX - cur.x) * localWeight;
            let moveY = (targetY - cur.y) * localWeight;
            let moveZ = (targetZ - cur.z) * localWeight;
            const moveLen = Math.hypot(moveX, moveY, moveZ);
            if (!(moveLen > 1e-12)) continue;

            const maxMove = Math.min(lenPrev, lenNext) * 0.45;
            if (moveLen > maxMove && maxMove > 1e-12) {
                const scale = maxMove / moveLen;
                moveX *= scale;
                moveY *= scale;
                moveZ *= scale;
            }

            next[i] = {
                x: cur.x + moveX,
                y: cur.y + moveY,
                z: cur.z + moveZ,
            };
            movedInPass = true;
        }
        current = next;
        if (!movedInPass) break;
    }
    return current;
}

function filletEnforcePolylineForwardProgress(referencePoints, candidatePoints, options = {}) {
    const ref = Array.isArray(referencePoints) ? referencePoints : [];
    const source = Array.isArray(candidatePoints) ? candidatePoints : [];
    const count = Math.min(ref.length, source.length);
    const out = cloneFilletPolyline(source, count);
    if (count < 2) return { points: out, correctedSegments: 0 };

    const lockEndpoints = !!options?.lockEndpoints;
    const passes = Number.isFinite(Number(options?.passes))
        ? Math.max(1, Math.min(8, Math.floor(Number(options.passes))))
        : 4;

    let correctedSegments = 0;
    for (let pass = 0; pass < passes; pass++) {
        let changedInPass = false;
        for (let i = 0; i < count - 1; i++) {
            const r0 = ref[i];
            const r1 = ref[i + 1];
            const p0 = out[i];
            const p1 = out[i + 1];
            if (!isFiniteFilletPoint(r0) || !isFiniteFilletPoint(r1)
                || !isFiniteFilletPoint(p0) || !isFiniteFilletPoint(p1)) {
                continue;
            }

            const rdx = r1.x - r0.x;
            const rdy = r1.y - r0.y;
            const rdz = r1.z - r0.z;
            const rLen = Math.hypot(rdx, rdy, rdz);
            if (!(rLen > 1e-12)) continue;
            const invLen = 1 / rLen;
            const ux = rdx * invLen;
            const uy = rdy * invLen;
            const uz = rdz * invLen;

            const segX = p1.x - p0.x;
            const segY = p1.y - p0.y;
            const segZ = p1.z - p0.z;
            const forward = (segX * ux) + (segY * uy) + (segZ * uz);
            const minForward = Math.max(1e-10, rLen * 1e-6);
            if (forward >= minForward) continue;

            const correction = minForward - forward;
            const canMovePrev = !lockEndpoints || (i > 0);
            const canMoveNext = !lockEndpoints || ((i + 1) < (count - 1));
            if (!canMovePrev && !canMoveNext) continue;

            if (canMovePrev && canMoveNext) {
                const half = correction * 0.5;
                p0.x -= ux * half;
                p0.y -= uy * half;
                p0.z -= uz * half;
                p1.x += ux * half;
                p1.y += uy * half;
                p1.z += uz * half;
            } else if (canMoveNext) {
                p1.x += ux * correction;
                p1.y += uy * correction;
                p1.z += uz * correction;
            } else {
                p0.x -= ux * correction;
                p0.y -= uy * correction;
                p0.z -= uz * correction;
            }

            correctedSegments++;
            changedInPass = true;
        }
        if (!changedInPass) break;
    }

    return { points: out, correctedSegments };
}

function sanitizeFilletTangentPolyline(centerlinePoints, tangentPoints, options = {}) {
    const ref = Array.isArray(centerlinePoints) ? centerlinePoints : [];
    const tangent = Array.isArray(tangentPoints) ? tangentPoints : [];
    const count = Math.min(ref.length, tangent.length);
    const closedLoop = !!options?.closedLoop;
    const rawStrength = Number(options?.strength);
    const strength = Number.isFinite(rawStrength)
        ? Math.max(0, Math.min(1, rawStrength))
        : 1;

    if (count < 2) {
        return {
            points: cloneFilletPolyline(tangent, count),
            stats: {
                checkedSegments: 0,
                backtrackingBefore: 0,
                backtrackingAfter: 0,
                worstCosBefore: 1,
                worstCosAfter: 1,
                correctedSegments: 0,
            },
        };
    }

    const source = cloneFilletPolyline(tangent, count);
    const statsBefore = filletPolylineBacktrackingStats(ref, source);
    let working = (strength > 0)
        ? filletSmoothPolylineKinks(source, { strength })
        : cloneFilletPolyline(source);

    const primary = filletEnforcePolylineForwardProgress(ref, working, {
        lockEndpoints: true,
        passes: 4,
    });
    working = primary.points;
    let correctedSegments = primary.correctedSegments;

    if (closedLoop && working.length >= 2 && filletPointsMatchWithinTolerance(source[0], source[source.length - 1])) {
        working[working.length - 1] = cloneFilletPoint(working[0]);
    }

    let statsAfter = filletPolylineBacktrackingStats(ref, working);
    if (statsAfter.backtrackingSegments > 0) {
        const fallback = filletEnforcePolylineForwardProgress(ref, working, {
            lockEndpoints: false,
            passes: 4,
        });
        working = fallback.points;
        correctedSegments += fallback.correctedSegments;
        if (closedLoop && working.length >= 2 && filletPointsMatchWithinTolerance(source[0], source[source.length - 1])) {
            working[working.length - 1] = cloneFilletPoint(working[0]);
        }
        statsAfter = filletPolylineBacktrackingStats(ref, working);
    }

    if (tangent.length > count) {
        for (let i = count; i < tangent.length; i++) {
            working.push(cloneFilletPoint(tangent[i]));
        }
    }

    return {
        points: working,
        stats: {
            checkedSegments: Math.max(statsBefore.checkedSegments, statsAfter.checkedSegments),
            backtrackingBefore: statsBefore.backtrackingSegments,
            backtrackingAfter: statsAfter.backtrackingSegments,
            worstCosBefore: statsBefore.worstCos,
            worstCosAfter: statsAfter.worstCos,
            correctedSegments,
        },
    };
}

function filletPointDistance(a, b) {
    if (!isFiniteFilletPoint(a) || !isFiniteFilletPoint(b)) return NaN;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function filletMedian(values) {
    const arr = (Array.isArray(values) ? values : [])
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    if (!arr.length) return NaN;
    const mid = (arr.length / 2) | 0;
    if ((arr.length % 2) === 1) return arr[mid];
    return 0.5 * (arr[mid - 1] + arr[mid]);
}

function filletCopyOffsetSampleToEndpoint(samples, edgePts, fromIdx, toIdx) {
    if (!Array.isArray(samples) || !Array.isArray(edgePts)) return false;
    const from = samples[fromIdx];
    const edgeFrom = edgePts[fromIdx];
    const edgeTo = edgePts[toIdx];
    if (!isFiniteFilletPoint(from) || !isFiniteFilletPoint(edgeFrom) || !isFiniteFilletPoint(edgeTo)) return false;
    samples[toIdx] = {
        x: edgeTo.x + (from.x - edgeFrom.x),
        y: edgeTo.y + (from.y - edgeFrom.y),
        z: edgeTo.z + (from.z - edgeFrom.z),
    };
    return true;
}

function stabilizeOpenFilletEndpoints(centerlinePoints, tangentA, tangentB, edgePoints, radius = 1) {
    const c = Array.isArray(centerlinePoints) ? centerlinePoints : [];
    const a = Array.isArray(tangentA) ? tangentA : [];
    const b = Array.isArray(tangentB) ? tangentB : [];
    const e = Array.isArray(edgePoints) ? edgePoints : [];
    const n = Math.min(c.length, a.length, b.length, e.length);
    if (n < 3) return { stabilized: 0 };

    const d = new Array(n);
    for (let i = 0; i < n; i++) d[i] = filletPointDistance(c[i], e[i]);

    const interior = [];
    for (let i = 1; i < n - 1; i++) {
        const v = d[i];
        if (Number.isFinite(v) && v > 1e-9) interior.push(v);
    }
    const all = d.filter((v) => Number.isFinite(v) && v > 1e-9);
    const baseDist = Number.isFinite(filletMedian(interior))
        ? filletMedian(interior)
        : filletMedian(all);
    if (!(baseDist > 0)) return { stabilized: 0 };

    const r = Math.max(0, Math.abs(Number(radius) || 0));
    const outlierThreshold = Math.max(baseDist * 2.25, r * 2.5, baseDist + Math.max(0.5, r));
    let stabilized = 0;

    const maybeStabilize = (idx, neighborIdx) => {
        const dist = d[idx];
        const neighborDist = d[neighborIdx];
        const tooFar = Number.isFinite(dist)
            ? (dist > outlierThreshold && (!Number.isFinite(neighborDist) || dist > (neighborDist * 2.25)))
            : true;
        if (!tooFar) return;
        const okCenter = filletCopyOffsetSampleToEndpoint(c, e, neighborIdx, idx);
        const okA = filletCopyOffsetSampleToEndpoint(a, e, neighborIdx, idx);
        const okB = filletCopyOffsetSampleToEndpoint(b, e, neighborIdx, idx);
        if (okCenter && okA && okB) stabilized++;
    };

    maybeStabilize(0, 1);
    maybeStabilize(n - 1, n - 2);
    return { stabilized };
}

/**
 * Compute the fillet centerline polyline for an input edge without building the fillet solid.
 *
 * Returns polylines for:
 *  - points: locus of arc centers (centerline)
 *  - tangentA: tangency curve on face A (cylinder-face A intersection)
 *  - tangentB: tangency curve on face B (cylinder-face B intersection)
 * All points are returned as objects {x,y,z} for readability.
 * Downstream consumers that require array triples are still supported
 * via Solid.addAuxEdge, which now accepts both objects and [x,y,z] arrays.
 *
 * @param {any} edgeObj Edge object (expects `.faces[0/1]`, `.userData.polylineLocal`, and `.parent` solid)
 * @param {number} radius Fillet radius (> 0)
 * @param {'INSET'|'OUTSET'} sideMode Preferred side relative to outward normals (default 'INSET')
 * @returns {{ points: {x:number,y:number,z:number}[], tangentA?: {x:number,y:number,z:number}[], tangentB?: {x:number,y:number,z:number}[], edge?: {x:number,y:number,z:number}[], closedLoop: boolean }}
 */
export function computeFilletCenterline(edgeObj, radius = 1, sideMode = 'INSET') {
    const out = { points: [], tangentA: [], tangentB: [], edge: [], closedLoop: false };
    try {
        if (!edgeObj || !Number.isFinite(radius) || radius <= 0) return out;
        const sidePolicy = createFilletSidePolicy(sideMode);
        const solid = edgeObj.parentSolid || edgeObj.parent;
        if (!solid) return out;
        const faceA = edgeObj.faces?.[0] || null;
        const faceB = edgeObj.faces?.[1] || null;
        const faceNameA = faceA?.name || edgeObj?.userData?.faceA || null;
        const faceNameB = faceB?.name || edgeObj?.userData?.faceB || null;
        const segmentFacePairs = Array.isArray(edgeObj?.userData?.segmentFacePairs) ? edgeObj.userData.segmentFacePairs : null;
        const useSegmentPairs = Array.isArray(segmentFacePairs) && segmentFacePairs.length > 0;
        if (!useSegmentPairs && (!faceNameA || !faceNameB)) return out;

        const polyLocalRaw = edgeObj.userData?.polylineLocal;
        if (!Array.isArray(polyLocalRaw) || polyLocalRaw.length < 2) return out;

        // Tolerances (scale-adaptive to radius)
        const eps = getScaleAdaptiveTolerance(radius, 1e-12);
        const distTol = getDistanceTolerance(radius);
        const angleTol = getAngleTolerance();
        const vecLengthTol = getScaleAdaptiveTolerance(radius, 1e-14);
        const polyLocal = sanitizeFilletInputPolyline(polyLocalRaw, distTol);
        if (!Array.isArray(polyLocal) || polyLocal.length < 2) return out;

        // Average outward normals per face (object space)
        let nAavg = null;
        let nBavg = null;
        let trisA = null;
        let trisB = null;
        let faceKeyA = null;
        let faceKeyB = null;
        let faceDataA = null;
        let faceDataB = null;
        let faceVertsA = null;
        let faceVertsB = null;

        // Create unique cache keys that include solid identity and geometry hash to prevent cross-contamination
        const solidId = solid.uuid || solid.name || solid.constructor.name;
        if (!useSegmentPairs) {
            nAavg = averageFaceNormalObjectSpace(solid, faceNameA);
            nBavg = averageFaceNormalObjectSpace(solid, faceNameB);
            if (!isFiniteVec3(nAavg) || !isFiniteVec3(nBavg)) return out;

            // Fetch triangles and cached data for both faces once
            trisA = solid.getFace(faceNameA);
            trisB = solid.getFace(faceNameB);
            if (!Array.isArray(trisA) || !trisA.length || !Array.isArray(trisB) || !trisB.length) return out;

            const geometryHashA = trisA.length > 0 ? `${trisA.length}_${trisA[0].p1?.[0]?.toFixed(3) || 0}` : '0';
            const geometryHashB = trisB.length > 0 ? `${trisB.length}_${trisB[0].p1?.[0]?.toFixed(3) || 0}` : '0';
            faceKeyA = `${solidId}:${faceNameA}:${geometryHashA}`;
            faceKeyB = `${solidId}:${faceNameB}:${geometryHashB}`;
            faceDataA = getCachedFaceDataForTris(trisA, faceKeyA);
            faceDataB = getCachedFaceDataForTris(trisB, faceKeyB);
            faceVertsA = collectFaceVertices(trisA);
            faceVertsB = collectFaceVertices(trisB);
        }

        // Robust closed-loop detection (prefer flags, else compare endpoints)
        let isClosed = !!(edgeObj.closedLoop || edgeObj.userData?.closedLoop);
        if (!isClosed && polyLocal.length > 2) {
            const a = polyLocal[0];
            const b = polyLocal[polyLocal.length - 1];
            if (a && b) {
                const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
                const d2 = dx * dx + dy * dy + dz * dz;
                const eps2 = distTol * distTol;
                if (d2 <= eps2) isClosed = true;
            }
        }
        out.closedLoop = isClosed;

        // Build sampling points: original vertices + midpoints (wrap for closed)
        let samples;
        let sampleSegmentIdx = null;
        {
            const src = polyLocal.slice();
            if (isClosed && src.length > 2) {
                const a = src[0], b = src[src.length - 1];
                if (a && b) {
                    const dx = a[0] - b[0];
                    const dy = a[1] - b[1];
                    const dz = a[2] - b[2];
                    if (((dx * dx) + (dy * dy) + (dz * dz)) <= (distTol * distTol)) src.pop();
                }
            }

            const outPts = [];
            const segIdxs = [];
            const segCount = useSegmentPairs
                ? Math.max(1, segmentFacePairs.length)
                : Math.max(1, (isClosed ? src.length : (src.length - 1)));
            for (let i = 0; i < src.length; i++) {
                const a = src[i];
                const segIdxVertex = isClosed
                    ? ((i - 1 + segCount) % segCount)
                    : Math.max(0, Math.min(i - 1, segCount - 1));
                const segIdxMid = isClosed ? (i % segCount) : Math.min(i, segCount - 1);
                outPts.push(new THREE.Vector3(a[0], a[1], a[2]));
                segIdxs.push(segIdxVertex);
                const j = i + 1;
                if (isClosed) {
                    const b = src[(i + 1) % src.length];
                    const dx = b[0] - a[0];
                    const dy = b[1] - a[1];
                    const dz = b[2] - a[2];
                    if (((dx * dx) + (dy * dy) + (dz * dz)) > (distTol * distTol)) {
                        outPts.push(new THREE.Vector3(0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])));
                        segIdxs.push(segIdxMid);
                    }
                } else if (j < src.length) {
                    const b = src[j];
                    const dx = b[0] - a[0];
                    const dy = b[1] - a[1];
                    const dz = b[2] - a[2];
                    if (((dx * dx) + (dy * dy) + (dz * dz)) > (distTol * distTol)) {
                        outPts.push(new THREE.Vector3(0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])));
                        segIdxs.push(segIdxMid);
                    }
                }
            }
            samples = outPts;
            if (useSegmentPairs) sampleSegmentIdx = segIdxs;
        }

        // Project samples to both faces and compute local normals
        const sampleCount = samples.length;
        let qAList = null;
        let qBList = null;
        let normalsA = null;
        let normalsB = null;
        let getFaceEntry = null;
        if (!useSegmentPairs) {
            qAList = batchProjectPointsOntoFace(trisA, samples, faceDataA, faceKeyA);
            qBList = batchProjectPointsOntoFace(trisB, samples, faceDataB, faceKeyB);
            normalsA = new Array(sampleCount);
            normalsB = new Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                normalsA[i] = localFaceNormalAtPoint(solid, faceNameA, qAList[i], faceDataA, faceKeyA) || nAavg;
                normalsB[i] = localFaceNormalAtPoint(solid, faceNameB, qBList[i], faceDataB, faceKeyB) || nBavg;
            }
        } else {
            const faceCache = new Map();
            getFaceEntry = (faceName) => {
                if (!faceName) return null;
                if (faceCache.has(faceName)) return faceCache.get(faceName);
                const tris = solid.getFace(faceName);
                if (!Array.isArray(tris) || !tris.length) return null;
                const geometryHash = tris.length > 0 ? `${tris.length}_${tris[0].p1?.[0]?.toFixed(3) || 0}` : '0';
                const faceKey = `${solidId}:${faceName}:${geometryHash}`;
                const data = getCachedFaceDataForTris(tris, faceKey);
                const avg = averageFaceNormalObjectSpace(solid, faceName);
                if (!isFiniteVec3(avg)) return null;
                const verts = collectFaceVertices(tris);
                const entry = { tris, data, key: faceKey, avg, verts };
                faceCache.set(faceName, entry);
                return entry;
            };
        }

        // Scratch vectors
        const tangent = new THREE.Vector3();
        const tempU = new THREE.Vector3();
        const tempV = new THREE.Vector3();
        const fallbackDir = new THREE.Vector3();
        const bisector3 = new THREE.Vector3();
        const avgNormalScratch = new THREE.Vector3();

        const rEff = Math.max(eps, radius);
        const preferOutset = sidePolicy.preferOutsetCenter;
        let maxAllowedRadius = Infinity;
        let maxAllowedSamples = 0;
        let centers = [];
        let tanA = [];
        let tanB = [];
        let edgePts = [];
        for (let i = 0; i < sampleCount; i++) {
            const p = samples[i];
            const pPrev = isClosed ? samples[(i - 1 + sampleCount) % sampleCount] : samples[Math.max(0, i - 1)];
            const pNext = isClosed ? samples[(i + 1) % sampleCount] : samples[Math.min(sampleCount - 1, i + 1)];

            tangent.copy(pNext).sub(pPrev);

            if (tangent.lengthSq() < vecLengthTol) continue;
            tangent.normalize();

            let qA = null;
            let qB = null;
            let nA = null;
            let nB = null;
            let faceNameAUse = faceNameA;
            let faceNameBUse = faceNameB;
            let faceDataAUse = faceDataA;
            let faceDataBUse = faceDataB;
            let trisAUse = trisA;
            let trisBUse = trisB;
            let faceKeyAUse = faceKeyA;
            let faceKeyBUse = faceKeyB;
            let nAavgUse = nAavg;
            let nBavgUse = nBavg;
            let faceVertsAUse = faceVertsA;
            let faceVertsBUse = faceVertsB;
            let allowRefine = true;
            if (useSegmentPairs && typeof getFaceEntry === 'function') {
                const segIdx = Array.isArray(sampleSegmentIdx) ? sampleSegmentIdx[i] : 0;
                const pair = segmentFacePairs[segIdx] || segmentFacePairs[segmentFacePairs.length - 1];
                if (pair && typeof pair === 'object' && !Array.isArray(pair) && pair.base && pair.sideA && pair.sideB) {
                    const baseName = pair.base;
                    const sideAName = pair.sideA;
                    const sideBName = pair.sideB;
                    const tBlend = Number.isFinite(pair.t) ? Math.max(0, Math.min(1, Number(pair.t))) : 0.5;
                    const entryBase = getFaceEntry(baseName);
                    const entrySideA = getFaceEntry(sideAName);
                    const entrySideB = getFaceEntry(sideBName);
                    if (!entryBase || !entrySideA || !entrySideB) continue;
                    faceNameAUse = baseName;
                    faceDataAUse = entryBase.data;
                    trisAUse = entryBase.tris;
                    faceKeyAUse = entryBase.key;
                    nAavgUse = entryBase.avg;
                    faceVertsAUse = entryBase.verts;

                    const qBase = projectPointOntoFaceTriangles(trisAUse, p, faceDataAUse, faceKeyAUse);
                    nA = localFaceNormalAtPoint(solid, baseName, qBase, faceDataAUse, faceKeyAUse) || nAavgUse;
                    qA = qBase;

                    const qSideA = projectPointOntoFaceTriangles(entrySideA.tris, p, entrySideA.data, entrySideA.key);
                    const qSideB = projectPointOntoFaceTriangles(entrySideB.tris, p, entrySideB.data, entrySideB.key);
                    const nSideA = localFaceNormalAtPoint(solid, sideAName, qSideA, entrySideA.data, entrySideA.key) || entrySideA.avg;
                    const nSideB = localFaceNormalAtPoint(solid, sideBName, qSideB, entrySideB.data, entrySideB.key) || entrySideB.avg;
                    const blend = nSideA.clone().multiplyScalar(1 - tBlend).addScaledVector(nSideB, tBlend);
                    nB = (blend.lengthSq() > 0) ? blend.normalize() : nSideA.clone();
                    qB = qSideA.clone().lerp(qSideB, tBlend);
                    faceNameBUse = sideAName;
                    faceDataBUse = entrySideA.data;
                    trisBUse = entrySideA.tris;
                    faceKeyBUse = entrySideA.key;
                    nBavgUse = entrySideA.avg;
                    faceVertsBUse = entrySideA.verts;
                    allowRefine = false;
                } else {
                    const segA = Array.isArray(pair) ? pair[0] : (pair?.faceA || pair?.a || null);
                    const segB = Array.isArray(pair) ? pair[1] : (pair?.faceB || pair?.b || null);
                    if (!segA || !segB) continue;
                    faceNameAUse = segA;
                    faceNameBUse = segB;
                    const entryA = getFaceEntry(faceNameAUse);
                    const entryB = getFaceEntry(faceNameBUse);
                    if (!entryA || !entryB) continue;
                    faceDataAUse = entryA.data;
                    faceDataBUse = entryB.data;
                    trisAUse = entryA.tris;
                    trisBUse = entryB.tris;
                    faceKeyAUse = entryA.key;
                    faceKeyBUse = entryB.key;
                    nAavgUse = entryA.avg;
                    nBavgUse = entryB.avg;
                    faceVertsAUse = entryA.verts;
                    faceVertsBUse = entryB.verts;
                    qA = projectPointOntoFaceTriangles(trisAUse, p, faceDataAUse, faceKeyAUse);
                    qB = projectPointOntoFaceTriangles(trisBUse, p, faceDataBUse, faceKeyBUse);
                    nA = localFaceNormalAtPoint(solid, faceNameAUse, qA, faceDataAUse, faceKeyAUse) || nAavgUse;
                    nB = localFaceNormalAtPoint(solid, faceNameBUse, qB, faceDataBUse, faceKeyBUse) || nBavgUse;
                }
            } else {
                qA = qAList[i];
                qB = qBList[i];
                nA = normalsA[i] || nAavgUse;
                nB = normalsB[i] || nBavgUse;
            }

            const vA3 = tempU.copy(nA).cross(tangent);
            const vB3 = tempV.copy(nB).cross(tangent);
            if (vA3.lengthSq() < eps || vB3.lengthSq() < eps) continue;
            vA3.normalize(); vB3.normalize();

            const u = vA3.clone();
            const v = new THREE.Vector3().crossVectors(tangent, u).normalize();

            // 2D inward normals in section plane for fallback and angle magnitude.
            // Use inward normals to get the interior angle consistently.
            const inA3 = tangent.clone().cross(vA3).negate();
            const inB3 = tangent.clone().cross(vB3).negate();
            const n0_2 = new THREE.Vector2(inA3.dot(u), inA3.dot(v));
            const n1_2 = new THREE.Vector2(inB3.dot(u), inB3.dot(v));
            if (n0_2.lengthSq() < 1e-16 || n1_2.lengthSq() < 1e-16) continue;
            n0_2.normalize();
            n1_2.normalize();

            const dotN = clamp(n0_2.x * n1_2.x + n0_2.y * n1_2.y, -1, 1);
            const angAbs = Math.acos(dotN);
            const sinHalf = Math.sin(0.5 * angAbs);
            if (Math.abs(sinHalf) < angleTol) continue;
            let bis2 = new THREE.Vector2(n0_2.x + n1_2.x, n0_2.y + n1_2.y);
            const lenBis2 = bis2.length();
            if (lenBis2 > 1e-9) bis2.multiplyScalar(1 / lenBis2); else bis2.set(0, 0);

            if (faceVertsAUse && faceVertsBUse) {
                const tanHalf = Math.tan(0.5 * angAbs);
                if (Number.isFinite(tanHalf) && tanHalf > angleTol && bis2.lengthSq() > 1e-16) {
                    const dir3 = fallbackDir.set(0, 0, 0).addScaledVector(u, bis2.x).addScaledVector(v, bis2.y);
                    if (preferOutset) dir3.negate();
                    const dirLen = dir3.length();
                    if (dirLen > 1e-12) {
                        dir3.multiplyScalar(1 / dirLen);
                        const rangeA = computeProjectionRange(faceVertsAUse, vA3);
                        const rangeB = computeProjectionRange(faceVertsBUse, vB3);
                        if (rangeA && rangeB) {
                            const pDotA = p.x * vA3.x + p.y * vA3.y + p.z * vA3.z;
                            const pDotB = p.x * vB3.x + p.y * vB3.y + p.z * vB3.z;
                            const signA = Math.sign(vA3.dot(dir3)) || 1;
                            const signB = Math.sign(vB3.dot(dir3)) || 1;
                            const availA = signA >= 0 ? (rangeA.max - pDotA) : (pDotA - rangeA.min);
                            const availB = signB >= 0 ? (rangeB.max - pDotB) : (pDotB - rangeB.min);
                            const availMin = Math.min(availA, availB);
                            if (Number.isFinite(availMin) && availMin > eps) {
                                const maxR = availMin * tanHalf;
                                if (Number.isFinite(maxR) && maxR > eps) {
                                    if (maxR < maxAllowedRadius) maxAllowedRadius = maxR;
                                    maxAllowedSamples++;
                                }
                            }
                        }
                    }
                }
            }
            const expectDist = rEff / Math.abs(sinHalf);

            // Solve with anchored offset planes in 3D
            const C_in = solveCenterFromOffsetPlanesAnchored(p, tangent, nA, qA, -1, nB, qB, -1, rEff);
            const C_out = solveCenterFromOffsetPlanesAnchored(p, tangent, nA, qA, +1, nB, qB, +1, rEff);
            const outwardAvg = avgNormalScratch.copy(nA).add(nB);
            const outwardLen = outwardAvg.length();
            if (outwardLen > eps) outwardAvg.multiplyScalar(1 / outwardLen);

            // Pick the center (in/out) that best keeps tangency points on the faces.
            let pick = preferOutset ? 'out' : 'in';
            let center = null;
            if (C_in || C_out) {
                const desiredSign = preferOutset ? 1 : -1;
                const scoreCandidate = (cand, tag) => {
                    if (!cand) return { score: Infinity, pick: tag, center: cand };
                    const sLocal = (tag === 'in') ? -1 : 1;
                    const tA0 = cand.clone().addScaledVector(nA, -sLocal * rEff);
                    const tB0 = cand.clone().addScaledVector(nB, -sLocal * rEff);
                    const qA0 = projectPointOntoFaceTriangles(trisAUse, tA0, faceDataAUse, faceKeyAUse);
                    const qB0 = projectPointOntoFaceTriangles(trisBUse, tB0, faceDataBUse, faceKeyBUse);
                    const dA = qA0 ? tA0.distanceTo(qA0) : Infinity;
                    const dB = qB0 ? tB0.distanceTo(qB0) : Infinity;
                    let sidePenalty = 0;
                    if (outwardLen > eps) {
                        const dir = cand.clone().sub(p);
                        const sign = Math.sign(dir.dot(outwardAvg)) || 0;
                        if (sign && sign !== desiredSign) sidePenalty = rEff;
                    }
                    const distPenalty = Math.abs(cand.distanceTo(p) - expectDist);
                    return { score: dA + dB + 0.2 * distPenalty + sidePenalty, pick: tag, center: cand };
                };
                const sIn = scoreCandidate(C_in, 'in');
                const sOut = scoreCandidate(C_out, 'out');
                const best = (sIn.score <= sOut.score) ? sIn : sOut;
                pick = best.pick;
                center = best.center;
            }



            // Initial tangency points from center (used to refine/fallback)
            const sA = (pick === 'in') ? -1 : +1;
            const sB = sA;
            let tA = center ? center.clone().addScaledVector(nA, -sA * rEff) : p.clone();
            let tB = center ? center.clone().addScaledVector(nB, -sB * rEff) : p.clone();

            // Fallback if intersection failed
            if (!center) {
                if (bis2.lengthSq() > eps) {
                    const dir3 = fallbackDir.set(0, 0, 0).addScaledVector(u, bis2.x).addScaledVector(v, bis2.y);
                    if (pick === 'out') dir3.negate();
                    dir3.normalize();
                    center = p.clone().addScaledVector(dir3, expectDist);
                } else {
                    const avgN = avgNormalScratch.copy(nA).add(nB);
                    if (avgN.lengthSq() > eps) {
                        avgN.normalize();
                        const sign = (pick === 'in') ? -1 : 1;
                        center = p.clone().addScaledVector(avgN, sign * expectDist);
                    } else {
                        // give up on this sample
                        continue;
                    }
                }
            }
            if (center) {
                tA = center.clone().addScaledVector(nA, -sA * rEff);
                tB = center.clone().addScaledVector(nB, -sB * rEff);
            }

            // Optional refinement: if initial p->center distance far from expected, or angle is acute,
            // recompute using normals at the projected tangency points (helps curved faces).
            const initialDist = center.distanceTo(p);
            const needsRefinement = Math.abs(initialDist - expectDist) > 0.1 * rEff;
            const acuteAngle = Math.abs(sinHalf) < 0.5; // < ~60°
            const refineIters = (allowRefine && (needsRefinement || acuteAngle)) ? (acuteAngle ? 2 : 1) : 0;
            if (refineIters > 0) {
                try {
                    for (let iter = 0; iter < refineIters; iter++) {
                        const qA1 = projectPointOntoFaceTriangles(trisAUse, tA, faceDataAUse, faceKeyAUse);
                        const qB1 = projectPointOntoFaceTriangles(trisBUse, tB, faceDataBUse, faceKeyBUse);
                        const nA1 = localFaceNormalAtPoint(solid, faceNameAUse, qA1, faceDataAUse, faceKeyAUse) || nAavgUse;
                        const nB1 = localFaceNormalAtPoint(solid, faceNameBUse, qB1, faceDataBUse, faceKeyBUse) || nBavgUse;
                        const C_ref = solveCenterFromOffsetPlanesAnchored(p, tangent, nA1, qA1, sA, nB1, qB1, sB, rEff);
                        if (!C_ref) break;
                        const prev = center;
                        center = C_ref;
                        // Update normals used at tangency too
                        nA = nA1;
                        nB = nB1;
                        tA = center.clone().addScaledVector(nA, -sA * rEff);
                        tB = center.clone().addScaledVector(nB, -sB * rEff);
                        if (prev.distanceTo(center) < 1e-6 * Math.max(1, rEff)) break;
                    }
                } catch { /* ignore */ }
            }

            // Safety cap: if center is unreasonably far, snap to 2D bisector expectation
            {
                const pToC = center.distanceTo(p);
                const hardCap = 6 * rEff;
                const factor = 3.0;
                const expectDistSafe = (() => {
                    try {
                        const vPA = tA.clone().sub(p);
                        const vPB = tB.clone().sub(p);
                        const lenA = vPA.length();
                        const lenB = vPB.length();
                        if (lenA > eps && lenB > eps) {
                            const dotAB = clamp(vPA.dot(vPB) / (lenA * lenB), -1, 1);
                            const ang = Math.acos(dotAB);
                            const sinH = Math.sin(0.5 * ang);
                            if (Math.abs(sinH) > angleTol) {
                                return rEff / Math.abs(sinH);
                            }
                        }
                    } catch { /* ignore */ }
                    return expectDist;
                })();
                if (!Number.isFinite(pToC) || pToC > hardCap || pToC > factor * expectDistSafe) {
                    let dir2 = new THREE.Vector2(bis2.x, bis2.y);
                    if (sidePolicy.bisectorFlipForOutset) dir2.multiplyScalar(-1);
                    if (dir2.lengthSq() > 1e-16) {
                        dir2.normalize();
                        const dir3 = bisector3.set(0, 0, 0).addScaledVector(u, dir2.x).addScaledVector(v, dir2.y).normalize();
                        // Clamp the bisector distance so acute/near-parallel face
                        // configurations do not explode the centerline far from the edge.
                        const safeDist = Math.min(expectDistSafe, hardCap);
                        center = p.clone().addScaledVector(dir3, safeDist);
                        // Recompute tangency points using latest normals
                        tA = center.clone().addScaledVector(nA, -sA * rEff);
                        tB = center.clone().addScaledVector(nB, -sB * rEff);
                    }
                }
            }

            centers.push({ x: center.x, y: center.y, z: center.z });
            tanA.push({ x: tA.x, y: tA.y, z: tA.z });
            tanB.push({ x: tB.x, y: tB.y, z: tB.z });
            edgePts.push({ x: p.x, y: p.y, z: p.z });
        }

        // For closed loops, explicitly duplicate the start point at the end
        // so the centerline is a closed polyline (last point equals first point).
        if (!isClosed && centers.length >= 3 && tanA.length >= 3 && tanB.length >= 3 && edgePts.length >= 3) {
            try {
                stabilizeOpenFilletEndpoints(centers, tanA, tanB, edgePts, rEff);
            } catch { /* best-effort stabilization */ }
        }
        if (isClosed && centers.length >= 2) {
            const firstCenter = centers[0];
            const lastCenter = centers[centers.length - 1];

            const exactlyEqual = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

            if (!exactlyEqual(firstCenter, lastCenter)) {
                // Always append an explicit duplicate of the first point
                centers.push({ x: firstCenter.x, y: firstCenter.y, z: firstCenter.z });

                // Mirror closure on tangency curves and sampled edge points to keep arrays aligned
                if (tanA.length > 0) {
                    const a0 = tanA[0];
                    tanA.push({ x: a0.x, y: a0.y, z: a0.z });
                }
                if (tanB.length > 0) {
                    const b0 = tanB[0];
                    tanB.push({ x: b0.x, y: b0.y, z: b0.z });
                }
                if (edgePts.length > 0) {
                    const e0 = edgePts[0];
                    edgePts.push({ x: e0.x, y: e0.y, z: e0.z });
                }
            }
        }
        const winding = fixPolylineWinding(centers, tanA, tanB, radius);
        if (winding?.centerlineReversed) {
            centers.reverse();
            edgePts.reverse();
        }
        if (winding?.tangentAReversed) tanA.reverse();
        if (winding?.tangentBReversed) tanB.reverse();
        if (!isClosed && centers.length >= 2) {
            const endpointCost = (poly, refA, refB) => {
                if (!Array.isArray(poly) || poly.length < 2) return Infinity;
                const a = poly[0];
                const b = poly[poly.length - 1];
                if (!a || !b || !refA || !refB) return Infinity;
                const d1 = Math.hypot((a.x - refA.x), (a.y - refA.y), (a.z - refA.z));
                const d2 = Math.hypot((b.x - refB.x), (b.y - refB.y), (b.z - refB.z));
                return d1 + d2;
            };
            const alignPolylineToCenterlineEnds = (poly) => {
                if (!Array.isArray(poly) || poly.length < 2) return;
                const c0 = centers[0];
                const cN = centers[centers.length - 1];
                const forward = endpointCost(poly, c0, cN);
                const reverse = endpointCost(poly, cN, c0);
                if (reverse + 1e-9 < forward) poly.reverse();
            };
            alignPolylineToCenterlineEnds(tanA);
            alignPolylineToCenterlineEnds(tanB);
            alignPolylineToCenterlineEnds(edgePts);
        }

        out.points = centers;
        out.tangentA = tanA;
        out.tangentB = tanB;
        out.edge = edgePts;
        if (Number.isFinite(maxAllowedRadius) && maxAllowedRadius < rEff && maxAllowedSamples > 0) {
            out.radiusClamp = { requested: radius, maxAllowed: maxAllowedRadius, samples: maxAllowedSamples };
        }
        return out;
    } catch (e) {
        console.warn('[computeFilletCenterline] failed:', e?.message || e);
        return out;
    }
}

/**
 * Fix polyline winding order to ensure consistent triangle orientation.
 * Checks all three polylines (centerline, tangentA, tangentB) for consistent winding.
 * 
 * @param {Array} centerline - Array of center points {x, y, z}
 * @param {Array} tangentA - Array of tangent A points {x, y, z}  
 * @param {Array} tangentB - Array of tangent B points {x, y, z}
 * @returns {Object} - {centerlineReversed: boolean, tangentAReversed: boolean, tangentBReversed: boolean}
 */
// Decide which polylines to reverse so that point i across
// centerline/tangentA/tangentB correspond to a consistent cross‑section.
// Uses an objective based on how close the tangent points are to the fillet
// radius from the centerline at sampled indices (quarter/half/three‑quarter).
// Falls back to direction/cross heuristics when radius is unavailable.
function fixPolylineWinding(centerline, tangentA, tangentB, expectedRadius = null) {
    try {
        // Fast-path: if any array is too small or lengths differ, do nothing
        if (!Array.isArray(centerline) || !Array.isArray(tangentA) || !Array.isArray(tangentB)) {
            return { centerlineReversed: false, tangentAReversed: false, tangentBReversed: false };
        }
        const isValidPoint = isFiniteFilletPoint;
        const n = Math.min(centerline.length, tangentA.length, tangentB.length);
        if (n < 3) {
            return { centerlineReversed: false, tangentAReversed: false, tangentBReversed: false };
        }

        // If we have a target radius, use it to search over combinations of
        // {reverse centerline, reverse A, reverse B} that best satisfy
        // dist(center[i], tangentX[i]) ≈ radius at a few sample locations.
        if (Number.isFinite(expectedRadius) && expectedRadius > 0) {
            const dist = (p, q) => {
                const dx = (q.x - p.x), dy = (q.y - p.y), dz = (q.z - p.z);
                return Math.hypot(dx, dy, dz);
            };

            // Choose robust sample indices near 1/4, 1/2, 3/4 along the polyline
            const idxs = [];
            const idxFromT = (t) => Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
            const pushUnique = (i) => { if (!idxs.includes(i)) idxs.push(i); };
            pushUnique(idxFromT(0.25));
            pushUnique(idxFromT(0.5));
            pushUnique(idxFromT(0.75));

            const combos = [
                [false, false, false],
                [false, true, false],
                [false, false, true],
                [true, false, false],
                [true, true, false],
                [true, false, true],
                [false, true, true],
                [true, true, true]
            ];

            let best = { cost: Infinity, rc: false, ra: false, rb: false };
            for (const [rc, ra, rb] of combos) {
                let cost = 0;
                for (const i of idxs) {
                    const ci = centerline[rc ? (n - 1 - i) : i];
                    const ai = tangentA[ra ? (n - 1 - i) : i];
                    const bi = tangentB[rb ? (n - 1 - i) : i];
                    const dA = dist(ci, ai);
                    const dB = dist(ci, bi);
                    // Sum absolute deviations from expected radius
                    cost += Math.abs(dA - expectedRadius) + Math.abs(dB - expectedRadius);
                }
                if (cost < best.cost) best = { cost, rc, ra, rb };
            }

            if (best.cost < Infinity) {
                return {
                    centerlineReversed: best.rc,
                    tangentAReversed: best.ra,
                    tangentBReversed: best.rb
                };
            }
        }

        // Primary heuristic: align the progression direction of tangents to the centerline.
        // We compare average segment directions (normalized sum) and flip if the dot is negative.
        const avgDir = (pts) => {
            let sx = 0, sy = 0, sz = 0;
            for (let i = 0; i < n - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                sx += (b.x - a.x); sy += (b.y - a.y); sz += (b.z - a.z);
            }
            const len = Math.hypot(sx, sy, sz) || 1;
            return { x: sx / len, y: sy / len, z: sz / len };
        };
        const cDir = avgDir(centerline);
        const aDir = avgDir(tangentA);
        const bDir = avgDir(tangentB);

        const dot = (u, v) => (u.x * v.x + u.y * v.y + u.z * v.z);
        let centerlineReversed = false;
        let tangentAReversed = false;
        let tangentBReversed = false;

        // If a tangent flows opposite the centerline, flip it.
        if (dot(cDir, aDir) < 0) tangentAReversed = true;
        if (dot(cDir, bDir) < 0) tangentBReversed = true;

        // If both tangents are flipped by the above, it may be easier to flip the centerline
        // instead to keep A/B in their original indexing. Choose the minimal total reversals.
        if (tangentAReversed && tangentBReversed) {
            centerlineReversed = true;
            tangentAReversed = false;
            tangentBReversed = false;
        }

        // Secondary heuristic (legacy): examine relative cross-product signs to detect
        // inconsistent relationships. This complements the direction-alignment above
        // and only proposes additional flips if still inconsistent.
        // Sample several points along the polylines to determine consistent orientation
        const sampleCount = Math.min(8, Math.floor(centerline.length / 3));
        const sampleIndices = [];
        for (let i = 1; i < sampleCount - 1; i++) {
            const idx = Math.floor(i * (centerline.length - 2) / (sampleCount - 1));
            if (idx + 1 < centerline.length) {
                sampleIndices.push(idx);
            }
        }

        let centerlineToTangentA_CrossProducts = [];
        let centerlineToTangentB_CrossProducts = [];
        let tangentAToTangentB_CrossProducts = [];

        // Analyze the relationship between each pair of polylines
        for (const idx of sampleIndices) {
            if (idx + 1 >= centerline.length) continue;

            const c1 = centerline[idx];
            const c2 = centerline[idx + 1];
            const tA1 = tangentA[idx];
            const tA2 = tangentA[idx + 1];
            const tB1 = tangentB[idx];
            const tB2 = tangentB[idx + 1];

            // Validate all points are finite
            if (!isValidPoint(c1) || !isValidPoint(c2) ||
                !isValidPoint(tA1) || !isValidPoint(tA2) ||
                !isValidPoint(tB1) || !isValidPoint(tB2)) {
                continue; // Skip this sample if any point is invalid
            }

            // Vector along centerline
            const centerVec = { x: c2.x - c1.x, y: c2.y - c1.y, z: c2.z - c1.z };

            // Vector along tangent A
            const tangentAVec = { x: tA2.x - tA1.x, y: tA2.y - tA1.y, z: tA2.z - tA1.z };

            // Vector from centerline to tangent A
            const centerToTangentA = { x: tA1.x - c1.x, y: tA1.y - c1.y, z: tA1.z - c1.z };

            // Vector from centerline to tangent B
            const centerToTangentB = { x: tB1.x - c1.x, y: tB1.y - c1.y, z: tB1.z - c1.z };

            // Vector from tangent A to tangent B
            const tangentAToTangentB = { x: tB1.x - tA1.x, y: tB1.y - tA1.y, z: tB1.z - tA1.z };

            // Calculate cross products to determine relative orientations
            // We'll use the dot product of cross products with a consistent reference vector

            // Cross product: centerline direction × (center to tangentA)
            const cross1 = {
                x: centerVec.y * centerToTangentA.z - centerVec.z * centerToTangentA.y,
                y: centerVec.z * centerToTangentA.x - centerVec.x * centerToTangentA.z,
                z: centerVec.x * centerToTangentA.y - centerVec.y * centerToTangentA.x
            };

            // Cross product: centerline direction × (center to tangentB)
            const cross2 = {
                x: centerVec.y * centerToTangentB.z - centerVec.z * centerToTangentB.y,
                y: centerVec.z * centerToTangentB.x - centerVec.x * centerToTangentB.z,
                z: centerVec.x * centerToTangentB.y - centerVec.y * centerToTangentB.x
            };

            // Cross product: tangentA direction × (tangentA to tangentB)
            const cross3 = {
                x: tangentAVec.y * tangentAToTangentB.z - tangentAVec.z * tangentAToTangentB.y,
                y: tangentAVec.z * tangentAToTangentB.x - tangentAVec.x * tangentAToTangentB.z,
                z: tangentAVec.x * tangentAToTangentB.y - tangentAVec.y * tangentAToTangentB.x
            };

            // Use the magnitude of the Z component as a simple 2D projection heuristic
            centerlineToTangentA_CrossProducts.push(cross1.z);
            centerlineToTangentB_CrossProducts.push(cross2.z);
            tangentAToTangentB_CrossProducts.push(cross3.z);
        }

        // Analyze the consistency of cross products
        const validCenterToA = centerlineToTangentA_CrossProducts.filter(x => isFinite(x));
        const validCenterToB = centerlineToTangentB_CrossProducts.filter(x => isFinite(x));
        const validAToB = tangentAToTangentB_CrossProducts.filter(x => isFinite(x));

        const avgCenterToA = validCenterToA.length > 0 ?
            validCenterToA.reduce((a, b) => a + Math.sign(b), 0) / validCenterToA.length : 0;
        const avgCenterToB = validCenterToB.length > 0 ?
            validCenterToB.reduce((a, b) => a + Math.sign(b), 0) / validCenterToB.length : 0;
        const avgAToB = validAToB.length > 0 ?
            validAToB.reduce((a, b) => a + Math.sign(b), 0) / validAToB.length : 0;

        // For a proper fillet, we expect:
        // 1. Centerline and tangents should have consistent progression direction
        // 2. Tangent A and B should generally go in opposite directions relative to each other
        // 3. All three should form a consistent right-handed coordinate system

        const centerRelationshipInconsistent = (avgCenterToA > 0) !== (avgCenterToB > 0);
        const tangentsGoSameDirection = avgAToB > 0.5; // Strong positive correlation means same direction
        if (centerRelationshipInconsistent && !(centerlineReversed || tangentAReversed || tangentBReversed)) {
            // If centerline relationships are inconsistent AND tangents go in same direction,
            // this suggests the centerline itself might need reversal
            if (tangentsGoSameDirection) {
                centerlineReversed = true;
            } else {
                // Heuristic: reverse the tangent with stronger inconsistency
                if (Math.abs(avgCenterToB) > Math.abs(avgCenterToA)) {
                    tangentBReversed = true;
                } else {
                    tangentAReversed = true;
                }
            }
        } else if (tangentsGoSameDirection && !(centerlineReversed || tangentAReversed || tangentBReversed)) {
            // Even if center relationships are consistent, if tangents go in same direction,
            // we likely need to reverse one tangent
            tangentBReversed = true;
        }

        return {
            centerlineReversed,
            tangentAReversed,
            tangentBReversed
        };
    } catch (error) {
        console.warn('Winding order analysis failed:', error?.message || error);
        return { centerlineReversed: false, tangentAReversed: false, tangentBReversed: false };
    }
}

/**
 * Convenience: compute and attach the fillet centerline as an auxiliary edge on a Solid.
 *
 * @param {any} solid Target solid to receive the aux edge (overlay)
 * @param {any} edgeObj Edge to analyze (must belong to `solid`)
 * @param {number} radius Fillet radius (>0)
 * @param {'INSET'|'OUTSET'} sideMode Side preference
 * @param {string} name Edge name (default 'FILLET_CENTERLINE')
 * @param {object} [options] Additional aux edge options
 * @param {boolean} [options.closedLoop=false] Render as closed loop when visualized
 * @param {boolean} [options.polylineWorld=false] Whether points are already in world space
 * @param {'OVERLAY'|'BASE'|string} [options.materialKey='OVERLAY'] Visualization material tag
 * @returns {{ points: {x:number,y:number,z:number}[], closedLoop: boolean } | null}
 */
export function attachFilletCenterlineAuxEdge(solid, edgeObj, radius = 1, sideMode = 'INSET', name = 'FILLET_CENTERLINE', options = {}) {
    try {
        if (!solid || !edgeObj) return null;
        const res = computeFilletCenterline(edgeObj, radius, sideMode);
        if (res && Array.isArray(res.points) && res.points.length >= 2) {
            const opts = { materialKey: 'OVERLAY', closedLoop: !!res.closedLoop, ...(options || {}) };
            solid.addAuxEdge(name, res.points, opts);
            return res;
        }
        return null;
    } catch (e) {
        console.warn('[attachFilletCenterlineAuxEdge] failed:', e?.message || e);
        return null;
    }
}


// Functional API: builds fillet tube and wedge and returns them.
export function filletSolid({
    edgeToFillet,
    radius = 1,
    sideMode = 'INSET',
    debug = false,
    name = 'fillet',
    inflate = 0.1,
    nudgeFaceDistance = 0.0001,
    resolution = 32,
    showTangentOverlays = false
} = {}) {
    try {
        // Validate inputs
        if (!edgeToFillet) {
            throw new Error('filletSolid: edgeToFillet is required');
        }
        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error(`filletSolid: radius must be a positive number, got ${radius}`);
        }

        const sidePolicy = createFilletSidePolicy(sideMode);
        const side = sidePolicy.mode;
        const requestedRadius = radius;
        let radiusUsed = radius;
        const tubeResolution = (Number.isFinite(Number(resolution)) && Number(resolution) > 0)
            ? Math.max(8, Math.floor(Number(resolution)))
            : 32;
        const faceNudgeDistance = Number.isFinite(Number(nudgeFaceDistance))
            ? Number(nudgeFaceDistance)
            : 0.0001;
        const logDebug = (...args) => { if (debug) console.log(...args); };
        logDebug(`🔧 Starting fillet operation: edge=${edgeToFillet?.name || 'unnamed'}, radius=${radiusUsed}, side=${side}`);

        let res = computeFilletCenterline(edgeToFillet, radiusUsed, side);
        logDebug('The fillet centerline result is:', res);

        if (!res) {
            throw new Error('computeFilletCenterline returned null/undefined');
        }
        if (res.radiusClamp && Number.isFinite(res.radiusClamp.maxAllowed)) {
            const maxAllowed = res.radiusClamp.maxAllowed;
            if (maxAllowed > 0 && maxAllowed < radiusUsed * 0.999) {
                const adjusted = Math.max(maxAllowed * 0.999, 1e-9);
                if (adjusted < radiusUsed) {
                    console.warn('[filletSolid] Requested radius exceeds face extents; clamping.', {
                        edge: edgeToFillet?.name || 'unnamed',
                        requested: radiusUsed,
                        clamped: adjusted,
                        maxAllowed,
                    });
                    radiusUsed = adjusted;
                    res = computeFilletCenterline(edgeToFillet, radiusUsed, side);
                    logDebug('Recomputed fillet centerline with clamped radius:', radiusUsed, res);
                    if (!res) {
                        throw new Error('computeFilletCenterline returned null/undefined after radius clamp');
                    }
                }
            }
        }

        const centerline = Array.isArray(res?.points) ? res.points : [];
        const tangentA = Array.isArray(res?.tangentA) ? res.tangentA : [];
        const tangentB = Array.isArray(res?.tangentB) ? res.tangentB : [];
        const edgePts = Array.isArray(res?.edge) ? res.edge : [];
        const closedLoop = !!res?.closedLoop;

        if (debug) {
            try { logDebug('filletSolid: centerline/tangent edges computed'); } catch { }
        }

        // Clone into plain objects
        const centerlineCopy = centerline.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        let tangentACopy = tangentA.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        let tangentBCopy = tangentB.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        const tangentSmoothStrength = 1;
        const tangentASanitized = sanitizeFilletTangentPolyline(centerlineCopy, tangentACopy, {
            closedLoop,
            strength: tangentSmoothStrength,
        });
        const tangentBSanitized = sanitizeFilletTangentPolyline(centerlineCopy, tangentBCopy, {
            closedLoop,
            strength: tangentSmoothStrength,
        });
        tangentACopy = tangentASanitized.points;
        tangentBCopy = tangentBSanitized.points;
        if (debug) {
            try {
                const aStats = tangentASanitized.stats || {};
                const bStats = tangentBSanitized.stats || {};
                const changedA = (aStats.correctedSegments > 0)
                    || (aStats.backtrackingBefore > aStats.backtrackingAfter);
                const changedB = (bStats.correctedSegments > 0)
                    || (bStats.backtrackingBefore > bStats.backtrackingAfter);
                if (changedA || changedB) {
                    logDebug('Sanitized tangent polylines before wedge build.', {
                        tangentA: aStats,
                        tangentB: bStats,
                    });
                }
            } catch { }
        }
        const tangentASnap = tangentACopy.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        const tangentBSnap = tangentBCopy.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        const edgeCopy = edgePts.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));
        // Working copy of the original edge points used for wedge construction.
        // Kept separate from `edgeCopy` so we can apply small insets/offsets without
        // disturbing other consumers that rely on the original edge sampling.
        const edgeWedgeCopy = edgeCopy.map(pt => ({ x: pt.x, y: pt.y, z: pt.z }));

        if (debug && centerlineCopy.length >= 2) {
            visualizeCenterlineDebug(name, centerlineCopy, closedLoop, {
                marker: '🟡',
                label: 'ORIGINAL CENTERLINE (Yellow)',
                materialKey: 'YELLOW',
                auxName: 'ORIGINAL_CENTERLINE',
                nameSuffix: 'ORIGINAL_CENTERLINE',
                successMessage: '🟡 Original centerline visualization created (Yellow)',
                failureMessage: 'Failed to visualize original centerline:',
            });
        }

        logDebug('Checking all polyline winding orders...');
        if (centerlineCopy.length >= 2) {
            const c1 = centerlineCopy[0];
            const c2 = centerlineCopy[1];
            const cLast = centerlineCopy[centerlineCopy.length - 1];
            logDebug(`Centerline: start=(${c1.x.toFixed(3)}, ${c1.y.toFixed(3)}, ${c1.z.toFixed(3)}) → (${c2.x.toFixed(3)}, ${c2.y.toFixed(3)}, ${c2.z.toFixed(3)}) ... end=(${cLast.x.toFixed(3)}, ${cLast.y.toFixed(3)}, ${cLast.z.toFixed(3)})`);
        }

        // Apply a small offset to the tangent curves relative to the centerline.
        // Keep OUTSET behavior unchanged: move tangents slightly toward the centerline;
        // INSET moves them outward. Closed loops skip inflation to avoid self‑intersection.
        // Respect the sign of `inflate` so callers can shrink the tool for
        // OUTSET (negative) while expanding for INSET (positive).
        const offsetDistance = Number.isFinite(inflate) ? Number(inflate) : 0;
        const hasTangentOffset = Math.abs(offsetDistance) > 1e-12;
        if (hasTangentOffset) {
            const n = Math.min(centerlineCopy.length, tangentACopy.length, tangentBCopy.length);
            for (let i = 0; i < n; i++) {
                const c = centerlineCopy[i];
                const ta = tangentACopy[i];
                const tb = tangentBCopy[i];
                if (c && ta) {
                    const dax = ta.x - c.x, day = ta.y - c.y, daz = ta.z - c.z;
                    const daL = Math.hypot(dax, day, daz);
                    if (daL > 1e-12) {
                        ta.x += (dax / daL) * offsetDistance;
                        ta.y += (day / daL) * offsetDistance;
                        ta.z += (daz / daL) * offsetDistance;
                    }
                }
                if (c && tb) {
                    const dbx = tb.x - c.x, dby = tb.y - c.y, dbz = tb.z - c.z;
                    const dbL = Math.hypot(dbx, dby, dbz);
                    if (dbL > 1e-12) {
                        tb.x += (dbx / dbL) * offsetDistance;
                        tb.y += (dby / dbL) * offsetDistance;
                        tb.z += (dbz / dbL) * offsetDistance;
                    }
                }
            }
            try { logDebug(`Applied tangent offsetDistance=${offsetDistance} to ${n} samples`); } catch { }
        }

        // Final guard after inflation: enforce forward progression against centerline
        // so local tangent kinks cannot flip segment direction and fold wedge strips.
        if (hasTangentOffset) {
            const tangentAAfterOffset = sanitizeFilletTangentPolyline(centerlineCopy, tangentACopy, {
                closedLoop,
                strength: 0,
            });
            const tangentBAfterOffset = sanitizeFilletTangentPolyline(centerlineCopy, tangentBCopy, {
                closedLoop,
                strength: 0,
            });
            tangentACopy = tangentAAfterOffset.points;
            tangentBCopy = tangentBAfterOffset.points;
            if (debug) {
                try {
                    const aStats = tangentAAfterOffset.stats || {};
                    const bStats = tangentBAfterOffset.stats || {};
                    const changedA = (aStats.correctedSegments > 0)
                        || (aStats.backtrackingBefore > aStats.backtrackingAfter);
                    const changedB = (bStats.correctedSegments > 0)
                        || (bStats.backtrackingBefore > bStats.backtrackingAfter);
                    if (changedA || changedB) {
                        logDebug('Applied post-offset tangent backtracking guard.', {
                            tangentA: aStats,
                            tangentB: bStats,
                        });
                    }
                } catch { }
            }
        }

        // Push wedge edge points slightly relative to the centerline to ensure
        // the wedge doesn't extend beyond the original geometry. For OUTSET this
        // nudge is inward (toward the centerline). For INSET it must be the
        // opposite direction (away from the centerline) to build the correct wedge.
        // Slightly offset edge points to guarantee robust boolean overlap.
        // Use a small radius-scaled inward nudge for OUTSET, capped to avoid
        // large displacements on big models.
        const outsetInsetMagnitude = Math.max(1e-4, Math.min(0.05, Math.abs(radiusUsed) * 0.05));
        const wedgeInsetMagnitude = closedLoop
            ? 0
            : (sidePolicy.isInset ? Math.abs(inflate) : outsetInsetMagnitude);
        const useInsideCheck = wedgeInsetMagnitude && sidePolicy.useInsideCheckForWedge;
        const pointInsideTarget = useInsideCheck
            ? buildPointInsideTester(edgeToFillet?.parentSolid || edgeToFillet?.parent || null)
            : null;
        let preferredDirSign = null;
        if (wedgeInsetMagnitude) {
            const insetCandidates = new Array(edgeWedgeCopy.length);
            let countIn = 0;
            let countOut = 0;

            for (let i = 0; i < edgeWedgeCopy.length; i++) {
                const edgeWedgePt = edgeWedgeCopy[i];
                const centerPt = centerlineCopy[i] || centerlineCopy[centerlineCopy.length - 1];
                if (!edgeWedgePt || !centerPt) continue;
                const inwardDirX = centerPt.x - edgeWedgePt.x;
                const inwardDirY = centerPt.y - edgeWedgePt.y;
                const inwardDirZ = centerPt.z - edgeWedgePt.z;
                const inwardLength = Math.sqrt((inwardDirX * inwardDirX) + (inwardDirY * inwardDirY) + (inwardDirZ * inwardDirZ));
                if (inwardLength <= 1e-12) {
                    console.warn(`Edge point ${i} is too close to centerline, skipping wedge inset`);
                    continue;
                }
                const nx = inwardDirX / inwardLength;
                const ny = inwardDirY / inwardLength;
                const nz = inwardDirZ / inwardLength;
                const candidateIn = {
                    x: edgeWedgePt.x + nx * wedgeInsetMagnitude,
                    y: edgeWedgePt.y + ny * wedgeInsetMagnitude,
                    z: edgeWedgePt.z + nz * wedgeInsetMagnitude
                };
                const candidateOut = {
                    x: edgeWedgePt.x - nx * wedgeInsetMagnitude,
                    y: edgeWedgePt.y - ny * wedgeInsetMagnitude,
                    z: edgeWedgePt.z - nz * wedgeInsetMagnitude
                };

                let inInside = null;
                let outInside = null;
                if (pointInsideTarget) {
                    inInside = pointInsideTarget(candidateIn);
                    outInside = pointInsideTarget(candidateOut);
                    if (inInside !== outInside) {
                        if (inInside) countIn++;
                        else countOut++;
                    }
                }

                insetCandidates[i] = {
                    original: { ...edgeWedgePt },
                    candidateIn,
                    candidateOut,
                    inInside,
                    outInside,
                };
            }

            if (pointInsideTarget && (countIn || countOut)) {
                preferredDirSign = countIn >= countOut ? 1 : -1;
            }

            for (let i = 0; i < edgeWedgeCopy.length; i++) {
                const edgeWedgePt = edgeWedgeCopy[i];
                const candidate = insetCandidates[i];
                if (!edgeWedgePt || !candidate) continue;
                try {
                    let chosen = null;
                    if (pointInsideTarget && candidate.inInside !== candidate.outInside) {
                        chosen = candidate.inInside ? candidate.candidateIn : candidate.candidateOut;
                    }
                    if (!chosen) {
                        const dirSign = (preferredDirSign !== null)
                            ? preferredDirSign
                            : sidePolicy.defaultWedgeOffsetSign;
                        chosen = (dirSign >= 0) ? candidate.candidateIn : candidate.candidateOut;
                    }

                    edgeWedgePt.x = chosen.x;
                    edgeWedgePt.y = chosen.y;
                    edgeWedgePt.z = chosen.z;
                    if (!isFiniteVec3(edgeWedgePt)) {
                        console.warn(`Invalid wedge edge point after inset at index ${i}, reverting to original`);
                        Object.assign(edgeWedgePt, candidate.original);
                    }
                } catch (insetError) {
                    console.warn(`Wedge edge inset failed at index ${i}: ${insetError?.message || insetError}`);
                }
            }
        }

        if (wedgeInsetMagnitude) logDebug(`Applied wedge inset of ${wedgeInsetMagnitude} units (inside-aware) to ${edgeWedgeCopy.length} edge points`);

        // Do not reorder edge points. Centerline/tangent/edge points are produced in
        // lockstep elsewhere; reindexing the edge points breaks correspondence and
        // can create long crossing triangles. If orientation issues arise, reverse
        // whole polylines, never reorder internal indices.

        if (debug && centerlineCopy.length >= 2) {
            visualizeCenterlineDebug(name, centerlineCopy, closedLoop, {
                marker: '🔵',
                label: 'MANIPULATED CENTERLINE (Blue)',
                materialKey: 'BLUE',
                auxName: 'MANIPULATED_CENTERLINE',
                nameSuffix: 'MANIPULATED_CENTERLINE',
                successMessage: '🔵 Manipulated centerline visualization created (Blue)',
                failureMessage: 'Failed to visualize manipulated centerline:',
            });
        }

        logDebug('centerlines all generated fine');

        // Validate spacing/variation for the path we will actually use for the tube
        const tubePathOriginal = Array.isArray(centerline) ? centerline : [];
        let tubeCapPointsBeforeNudge = { start: [], end: [] };
        const buildResult = ({
            tube = null,
            wedge = null,
            finalSolid = null,
            error = null,
        } = {}) => createFilletResultPayload({
            tube,
            wedge,
            finalSolid,
            centerline: centerlineCopy,
            tangentA: tangentACopy,
            tangentB: tangentBCopy,
            edge: edgeCopy,
            edgeWedge: edgeWedgeCopy,
            tangentASeam: tangentASnap,
            tangentBSeam: tangentBSnap,
            tubeCapPointsBeforeNudge,
            error,
        });
        if (tubePathOriginal.length < 2) {
            console.error('Insufficient centerline points for tube generation');
            return buildResult({ error: 'Insufficient centerline points for tube generation' });
        }
        {
            const firstPt = tubePathOriginal[0];
            const hasVariation = tubePathOriginal.some(pt =>
                Math.abs(pt.x - firstPt.x) > 1e-6 ||
                Math.abs(pt.y - firstPt.y) > 1e-6 ||
                Math.abs(pt.z - firstPt.z) > 1e-6
            );
            if (!hasVariation) {
                console.error('Degenerate centerline: all points are identical');
                return buildResult({ error: 'Degenerate centerline: all points are identical' });
            }
            const minSpacing = radiusUsed * 0.01;
            for (let i = 1; i < tubePathOriginal.length; i++) {
                const curr = tubePathOriginal[i];
                const prev = tubePathOriginal[i - 1];
                const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);
                if (distance < minSpacing) {
                    console.warn(`Centerline points ${i - 1} and ${i} are too close (distance: ${distance}), this may cause tube generation issues`);
                }
            }
        }

        // Build tube from the ORIGINAL centerline (not the modified copy)
        let filletTube = null;
        try {
            // Tube expects [x,y,z] arrays; convert original {x,y,z} objects
            let tubePoints = tubePathOriginal.map(p => [p.x, p.y, p.z]);

            if (closedLoop) {
                logDebug('Closed loop detected: preparing tube centerline...');
                // For closed loops: ensure the tube polyline has the same point at start and end
                if (tubePoints.length >= 2) {
                    const firstPt = tubePoints[0];

                    // Add the first point at the end to close the loop
                    tubePoints.push([firstPt[0], firstPt[1], firstPt[2]]);
                    logDebug('Closed loop: Added first point at end for tube generation');

                }
            } else {
                logDebug('Non-closed loop detected: preparing tube centerline...');
                // For non-closed loops: extend the start and end segments of the centerline polyline for tube only
                if (tubePoints.length >= 2) {
                    try {
                        tubeCapPointsBeforeNudge = captureOpenTubeCapPointsForPath(
                            tubePoints,
                            radiusUsed,
                            tubeResolution,
                            `${name}_TUBE_PRE_NUDGE_CAPTURE`,
                        );
                    } catch {
                        tubeCapPointsBeforeNudge = { start: [], end: [] };
                    }
                    logDebug('Non-closed loop: Extending tube centerline segments...');
                    const extensionDistance = 0.1;

                    // Extend first segment backwards
                    const p0 = tubePoints[0];
                    const p1 = tubePoints[1];
                    const dir0 = [p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]];
                    const len0 = Math.sqrt(dir0[0] * dir0[0] + dir0[1] * dir0[1] + dir0[2] * dir0[2]);

                    if (len0 > 1e-12) {
                        const norm0 = [dir0[0] / len0, dir0[1] / len0, dir0[2] / len0];
                        const extendedStart = [
                            p0[0] + norm0[0] * extensionDistance,
                            p0[1] + norm0[1] * extensionDistance,
                            p0[2] + norm0[2] * extensionDistance
                        ];
                        tubePoints[0] = extendedStart;
                    }

                    // Extend last segment forwards
                    const lastIdx = tubePoints.length - 1;
                    const pLast = tubePoints[lastIdx];
                    const pPrev = tubePoints[lastIdx - 1];
                    const dirLast = [pLast[0] - pPrev[0], pLast[1] - pPrev[1], pLast[2] - pPrev[2]];
                    const lenLast = Math.sqrt(dirLast[0] * dirLast[0] + dirLast[1] * dirLast[1] + dirLast[2] * dirLast[2]);

                    if (lenLast > 1e-12) {
                        const normLast = [dirLast[0] / lenLast, dirLast[1] / lenLast, dirLast[2] / lenLast];
                        const extendedEnd = [
                            pLast[0] + normLast[0] * extensionDistance,
                            pLast[1] + normLast[1] * extensionDistance,
                            pLast[2] + normLast[2] * extensionDistance
                        ];
                        tubePoints[lastIdx] = extendedEnd;
                    }

                    logDebug(`Extended tube centerline by ${extensionDistance} units at both ends`);
                }
            }

            const inflatedTubeRadius = radiusUsed ;
            filletTube = new Tube({
                points: tubePoints,
                radius: inflatedTubeRadius,
                innerRadius: 0,
                resolution: tubeResolution,
                selfUnion: true,
                name: `${name}_TUBE`,
            });

            // Store PMI metadata on the outer pipe face so downstream annotations
            // can recover the user radius instead of the inflated geometry value.
            try {
                const faceTag = `${name}_TUBE_Outer`;
                const overrideMeta = {
                    type: 'pipe',
                    source: 'FilletFeature',
                    featureID: name,
                    inflatedRadius: inflatedTubeRadius,
                    pmiRadiusOverride: radiusUsed,
                    radiusOverride: radiusUsed,
                };
                if (requestedRadius !== radiusUsed) overrideMeta.requestedRadius = requestedRadius;
                if (edgeToFillet?.name) overrideMeta.edgeReference = edgeToFillet.name;
                filletTube.setFaceMetadata(faceTag, overrideMeta);

                if (showTangentOverlays) {
                    const auxOpts = { materialKey: 'OVERLAY', closedLoop: !!closedLoop };
                    if (Array.isArray(tangentASnap) && tangentASnap.length >= 2) {
                        filletTube.addAuxEdge(`${name}_TANGENT_A_PATH`, tangentASnap, auxOpts);
                    }
                    if (Array.isArray(tangentBSnap) && tangentBSnap.length >= 2) {
                        filletTube.addAuxEdge(`${name}_TANGENT_B_PATH`, tangentBSnap, auxOpts);
                    }
                }

                // Capture tube cap area + round face label for post-boolean retagging (non-closed only).
                if (!closedLoop) {
                    const roundFaceName = faceTag;
                    const markTubeCap = (capName) => {
                        const tris = filletTube.getFace(capName);
                        const area = computeFaceAreaFromTriangles(tris);
                        if (area > 0) {
                            filletTube.setFaceMetadata(capName, {
                                filletSourceArea: area,
                                filletRoundFace: roundFaceName,
                                filletEndCap: true,
                            });
                        }
                    };
                    markTubeCap(`${name}_TUBE_CapStart`);
                    markTubeCap(`${name}_TUBE_CapEnd`);
                }
            } catch {
                // Best-effort – lack of metadata should not abort fillet creation.
            }
        } catch (tubeError) {
            console.error('Tube creation failed:', tubeError?.message || tubeError);

            const debugWedge = new Solid();
            debugWedge.name = `${name}_FAILED_TUBE_DEBUG`;
            return buildResult({
                wedge: debugWedge,
                error: `Tube generation failed: ${tubeError?.message || tubeError}`,
            });
        }


        // Build wedge solid from triangles between centerline and tangency edges
        logDebug('Creating wedge solid...');
        const wedgeSolid = new Solid();
        wedgeSolid.name = `${name}_WEDGE`;

        if (closedLoop) {
            // CLOSED LOOP PATH - preserve existing logic exactly
            try {
                const minTriangleArea = radiusUsed * radiusUsed * 1e-8;
                let validTriangles = 0;
                let skippedTriangles = 0;
                const isValidTriangle = (p1, p2, p3) => {
                    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
                    const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
                    const cross = {
                        x: v1.y * v2.z - v1.z * v2.y,
                        y: v1.z * v2.x - v1.x * v2.z,
                        z: v1.x * v2.y - v1.y * v2.x
                    };
                    const area = 0.5 * Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z);
                    return area > minTriangleArea;
                };
                const isValidPoint = isFiniteFilletPoint;
                const addTriangleWithValidation = (groupName, p1, p2, p3) => {
                    if (!isValidPoint(p1) || !isValidPoint(p2) || !isValidPoint(p3)) {
                        console.warn(`Invalid points detected - p1:(${p1.x},${p1.y},${p1.z}) p2:(${p2.x},${p2.y},${p2.z}) p3:(${p3.x},${p3.y},${p3.z})`);
                        return false;
                    }
                    wedgeSolid.addTriangle(groupName, [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z], [p3.x, p3.y, p3.z]);
                    return true;
                };
                for (let i = 0; i < centerlineCopy.length - 1; i++) {
                    const c1 = centerlineCopy[i];
                    const c2 = centerlineCopy[i + 1];
                    const tA1 = tangentACopy[i];
                    const tA2 = tangentACopy[i + 1];
                    const tB1 = tangentBCopy[i];
                    const tB2 = tangentBCopy[i + 1];

                    // Tangent A side
                    if (isValidTriangle(c1, tA1, c2) && addTriangleWithValidation(`${name}_WEDGE_A`, c1, tA1, c2)) validTriangles++; else skippedTriangles++;
                    if (isValidTriangle(c2, tA1, tA2) && addTriangleWithValidation(`${name}_WEDGE_A`, c2, tA1, tA2)) validTriangles++; else skippedTriangles++;
                    // Tangent B side
                    if (isValidTriangle(c1, c2, tB1) && addTriangleWithValidation(`${name}_WEDGE_B`, c1, c2, tB1)) validTriangles++; else skippedTriangles++;
                    if (isValidTriangle(c2, tB2, tB1) && addTriangleWithValidation(`${name}_WEDGE_B`, c2, tB2, tB1)) validTriangles++; else skippedTriangles++;

                    // Side walls on original faces - use inset wedge edge points
                    const e1 = edgeWedgeCopy[i];
                    const e2 = edgeWedgeCopy[i + 1];
                    if (e1 && e2) {
                        if (isValidTriangle(e1, tA1, e2) && addTriangleWithValidation(`${name}_SIDE_A`, e1, tA1, e2)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(e2, tA1, tA2) && addTriangleWithValidation(`${name}_SIDE_A`, e2, tA1, tA2)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(e1, e2, tB1) && addTriangleWithValidation(`${name}_SIDE_B`, e1, e2, tB1)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(e2, tB2, tB1) && addTriangleWithValidation(`${name}_SIDE_B`, e2, tB2, tB1)) validTriangles++; else skippedTriangles++;
                    }
                }
                logDebug(`Wedge triangles added successfully (closed loop): ${validTriangles} valid, ${skippedTriangles} skipped`);
                if (validTriangles === 0) {
                    console.error('No valid triangles could be created for wedge solid - all were degenerate');
                    return buildResult({
                        tube: filletTube,
                        wedge: wedgeSolid,
                        error: 'No valid triangles could be created for wedge solid - all were degenerate',
                    });
                }
            } catch (wedgeError) {
                console.error('Failed to create wedge triangles (closed loop):', wedgeError?.message || wedgeError);
                return buildResult({
                    tube: filletTube,
                    wedge: wedgeSolid,
                    error: `Wedge triangle creation failed: ${wedgeError?.message || wedgeError}`,
                });
            }
        } else {
            // NON-CLOSED LOOP PATH - specialized handling for open edges
            try {
                logDebug('Creating wedge solid for non-closed loop...');
                const minTriangleArea = radiusUsed * radiusUsed * 1e-8;
                let validTriangles = 0;
                let skippedTriangles = 0;

                const isValidTriangle = (p1, p2, p3) => {
                    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
                    const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
                    const cross = {
                        x: v1.y * v2.z - v1.z * v2.y,
                        y: v1.z * v2.x - v1.x * v2.z,
                        z: v1.x * v2.y - v1.y * v2.x
                    };
                    const area = 0.5 * Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z);
                    return area > minTriangleArea;
                };
                const isValidPoint = isFiniteFilletPoint;
                const addTriangleWithValidation = (groupName, p1, p2, p3) => {
                    if (!isValidPoint(p1) || !isValidPoint(p2) || !isValidPoint(p3)) {
                        console.warn(`Invalid points detected - p1:(${p1.x},${p1.y},${p1.z}) p2:(${p2.x},${p2.y},${p2.z}) p3:(${p3.x},${p3.y},${p3.z})`);
                        return false;
                    }
                    wedgeSolid.addTriangle(groupName, [p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z], [p3.x, p3.y, p3.z]);
                    return true;
                };

                // Create triangular strip along the fillet path
                // For open edges, we create a proper triangulated surface between centerline and tangent lines
                for (let i = 0; i < centerlineCopy.length - 1; i++) {
                    const c1 = centerlineCopy[i];
                    const c2 = centerlineCopy[i + 1];
                    const tA1 = tangentACopy[i];
                    const tA2 = tangentACopy[i + 1];
                    const tB1 = tangentBCopy[i];
                    const tB2 = tangentBCopy[i + 1];
                    const e1 = edgeWedgeCopy[i];
                    const e2 = edgeWedgeCopy[i + 1];

                    // Create triangulated surfaces between each pair of curves
                    // Surface between centerline and tangent A
                    if (isValidTriangle(c1, c2, tA1) && addTriangleWithValidation(`${name}_SURFACE_CA`, c1, c2, tA1)) validTriangles++; else skippedTriangles++;
                    if (isValidTriangle(c2, tA2, tA1) && addTriangleWithValidation(`${name}_SURFACE_CA`, c2, tA2, tA1)) validTriangles++; else skippedTriangles++;

                    // Surface between centerline and tangent B
                    if (isValidTriangle(c1, tB1, c2) && addTriangleWithValidation(`${name}_SURFACE_CB`, c1, tB1, c2)) validTriangles++; else skippedTriangles++;
                    if (isValidTriangle(c2, tB1, tB2) && addTriangleWithValidation(`${name}_SURFACE_CB`, c2, tB1, tB2)) validTriangles++; else skippedTriangles++;

                    // Surface between tangent A and edge (original face A)
                    if (e1 && e2) {
                        if (isValidTriangle(tA1, tA2, e1) && addTriangleWithValidation(`${name}_FACE_A`, tA1, tA2, e1)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(tA2, e2, e1) && addTriangleWithValidation(`${name}_FACE_A`, tA2, e2, e1)) validTriangles++; else skippedTriangles++;

                        // Surface between tangent B and edge (original face B)  
                        if (isValidTriangle(tB1, e1, tB2) && addTriangleWithValidation(`${name}_FACE_B`, tB1, e1, tB2)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(tB2, e1, e2) && addTriangleWithValidation(`${name}_FACE_B`, tB2, e1, e2)) validTriangles++; else skippedTriangles++;
                    }
                }

                // Add end caps for open edges to create a closed solid
                if (centerlineCopy.length >= 2) {
                    logDebug('Adding end caps for non-closed loop...');

                    // First end cap
                    const firstC = centerlineCopy[0];
                    const firstTA = tangentACopy[0];
                    const firstTB = tangentBCopy[0];
                    const firstE = edgeWedgeCopy[0];

                    if (firstE && isValidPoint(firstC) && isValidPoint(firstTA) && isValidPoint(firstTB) && isValidPoint(firstE)) {
                        // Create triangular fan from centerline to form end cap
                        if (isValidTriangle(firstC, firstTB, firstTA) && addTriangleWithValidation(`${name}_END_CAP_1`, firstC, firstTB, firstTA)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(firstTA, firstTB, firstE) && addTriangleWithValidation(`${name}_END_CAP_1`, firstTA, firstTB, firstE)) validTriangles++; else skippedTriangles++;
                    }

                    // Last end cap
                    const lastIndex = centerlineCopy.length - 1;
                    const lastC = centerlineCopy[lastIndex];
                    const lastTA = tangentACopy[lastIndex];
                    const lastTB = tangentBCopy[lastIndex];
                    const lastE = edgeWedgeCopy[lastIndex];

                    if (lastE && isValidPoint(lastC) && isValidPoint(lastTA) && isValidPoint(lastTB) && isValidPoint(lastE)) {
                        // Create triangular fan from centerline to form end cap (reversed winding for proper normal)
                        if (isValidTriangle(lastC, lastTA, lastTB) && addTriangleWithValidation(`${name}_END_CAP_2`, lastC, lastTA, lastTB)) validTriangles++; else skippedTriangles++;
                        if (isValidTriangle(lastTA, lastE, lastTB) && addTriangleWithValidation(`${name}_END_CAP_2`, lastTA, lastE, lastTB)) validTriangles++; else skippedTriangles++;
                    }
                }

                logDebug(`Wedge triangles added successfully (non-closed loop): ${validTriangles} valid, ${skippedTriangles} skipped`);
                if (validTriangles === 0) {
                    console.error('No valid triangles could be created for non-closed wedge solid - all were degenerate');
                    return buildResult({
                        tube: filletTube,
                        wedge: wedgeSolid,
                        error: 'No valid triangles could be created for non-closed wedge solid - all were degenerate',
                    });
                }
            } catch (wedgeError) {
                console.error('Failed to create wedge triangles (non-closed loop):', wedgeError?.message || wedgeError);
                return buildResult({
                    tube: filletTube,
                    wedge: wedgeSolid,
                    error: `Non-closed wedge triangle creation failed: ${wedgeError?.message || wedgeError}`,
                });
            }
        }

        // Triangle winding fix for all cases
        try {
            wedgeSolid.fixTriangleWindingsByAdjacency();
        } catch (windingError) {
            console.warn('Triangle winding fix failed:', windingError?.message || windingError);
        }

        if (debug) {
            console.log('Debug mode: wedge solid stored');
        }
        logDebug('Wedge solid creation completed');
        const triangleCount = wedgeSolid._triVerts ? wedgeSolid._triVerts.length / 3 : 0;
        logDebug('Wedge solid created with', triangleCount, 'triangles (raw count)');
        if (debug) {
            try { wedgeSolid.visualize(); } catch { }
        }

        if (Math.abs(faceNudgeDistance) > 1e-12) {
            wedgeSolid.pushFace(`${name}_FACE_A`, faceNudgeDistance);
            wedgeSolid.pushFace(`${name}_FACE_B`, faceNudgeDistance);
        }

        // Apply end cap offset for INSET fillets using pushFace method
        if (sidePolicy.applyOpenEndCapPush && !closedLoop) {
            logDebug('Applying end cap offset to INSET fillet using pushFace...');
            try {
                if (Math.abs(faceNudgeDistance) > 1e-12) {
                    wedgeSolid.pushFace(`${name}_END_CAP_1`, faceNudgeDistance);
                    wedgeSolid.pushFace(`${name}_END_CAP_2`, faceNudgeDistance);
                    logDebug('End cap offset applied successfully');
                } else {
                    logDebug('Skipping end cap offset because nudgeFaceDistance is 0.');
                }
                if (debug) wedgeSolid.visualize();
            } catch (pushError) {
                console.warn('Failed to apply end cap offset:', pushError?.message || pushError);
            }
        }

        // Record areas and target round-face label for post-boolean relabeling.
        const roundFaceName = `${name}_TUBE_Outer`;
        const markFace = (faceName, isEndCap = false) => {
            const tris = wedgeSolid.getFace(faceName);
            const area = computeFaceAreaFromTriangles(tris);
            if (area > 0) {
                wedgeSolid.setFaceMetadata(faceName, {
                    filletSourceArea: area,
                    filletRoundFace: roundFaceName,
                    filletEndCap: !!isEndCap,
                });
            }
        };
        if (!closedLoop) {
            markFace(`${name}_END_CAP_1`, true);
            markFace(`${name}_END_CAP_2`, true);
        }
        markFace(`${name}_WEDGE_A`, false);
        markFace(`${name}_WEDGE_B`, false);

        try {
            const finalSolid = wedgeSolid.subtract(filletTube);
            finalSolid.name = `${name}_FINAL_FILLET`;
            if (debug) {
                try { finalSolid.visualize(); } catch { }
            }
            logDebug('Final fillet solid created by subtracting tube from wedge', finalSolid);

            return buildResult({
                tube: filletTube,
                wedge: wedgeSolid,
                finalSolid,
            });
        } catch (booleanError) {
            console.error('Boolean operation failed:', booleanError?.message || booleanError);
            return buildResult({
                tube: filletTube,
                wedge: wedgeSolid,
                error: `Boolean operation failed: ${booleanError?.message || booleanError}`,
            });
        }
    } catch (globalError) {
        console.error('Fillet operation failed completely:', globalError?.message || globalError);
        return createFilletResultPayload({
            error: `Fillet operation failed: ${globalError?.message || globalError}`,
        });
    }
}

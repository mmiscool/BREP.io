const MIN_PARAM_GAP = 1e-12;
const MIN_MATRIX_DET = 1e-18;
const MIN_SEGMENT_LENGTH = 1e-12;
const BACKTRACK_COS_TOL = -1e-6;
const BACKTRACK_SEARCH_STEPS = 14;

function isPoint3(p) {
    return Array.isArray(p)
        && p.length === 3
        && Number.isFinite(p[0])
        && Number.isFinite(p[1])
        && Number.isFinite(p[2]);
}

function clonePoint3(p) {
    return [p[0], p[1], p[2]];
}

function lerpPoint3(a, b, t) {
    const u = 1 - t;
    return [
        (a[0] * u) + (b[0] * t),
        (a[1] * u) + (b[1] * t),
        (a[2] * u) + (b[2] * t),
    ];
}

function computeArcLengthParams(points) {
    const count = Array.isArray(points) ? points.length : 0;
    const params = new Array(count).fill(0);
    if (count <= 1) return params;

    let total = 0;
    for (let i = 1; i < count; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (!isPoint3(a) || !isPoint3(b)) {
            params[i] = total;
            continue;
        }
        total += Math.hypot(
            b[0] - a[0],
            b[1] - a[1],
            b[2] - a[2],
        );
        params[i] = total;
    }

    if (!(total > MIN_PARAM_GAP)) {
        const denom = Math.max(1, count - 1);
        for (let i = 0; i < count; i++) params[i] = i / denom;
        return params;
    }

    for (let i = 1; i < count; i++) params[i] /= total;
    params[count - 1] = 1;
    return params;
}

function fitOpenPolylineEndpointsExact(points) {
    const source = Array.isArray(points) ? points : [];
    const count = source.length;
    if (count < 3) return source.map((p) => (isPoint3(p) ? clonePoint3(p) : [0, 0, 0]));
    if (!source.every((p) => isPoint3(p))) return source.map((p) => (isPoint3(p) ? clonePoint3(p) : [0, 0, 0]));

    const params = computeArcLengthParams(source);
    const start = source[0];
    const end = source[count - 1];
    const delta = [
        end[0] - start[0],
        end[1] - start[1],
        end[2] - start[2],
    ];

    let s00 = 0;
    let s01 = 0;
    let s11 = 0;
    const r0 = [0, 0, 0];
    const r1 = [0, 0, 0];
    let rows = 0;

    for (let i = 1; i < count - 1; i++) {
        const t = params[i];
        const w = t * (1 - t);
        if (!(w > MIN_PARAM_GAP)) continue;

        const base = [
            start[0] + (delta[0] * t),
            start[1] + (delta[1] * t),
            start[2] + (delta[2] * t),
        ];
        const err = [
            source[i][0] - base[0],
            source[i][1] - base[1],
            source[i][2] - base[2],
        ];
        const a0 = w;
        const a1 = w * t;

        s00 += a0 * a0;
        s01 += a0 * a1;
        s11 += a1 * a1;
        r0[0] += a0 * err[0];
        r0[1] += a0 * err[1];
        r0[2] += a0 * err[2];
        r1[0] += a1 * err[0];
        r1[1] += a1 * err[1];
        r1[2] += a1 * err[2];
        rows++;
    }

    if (rows < 2) return source.map((p) => clonePoint3(p));

    const det = (s00 * s11) - (s01 * s01);
    if (!Number.isFinite(det) || Math.abs(det) <= MIN_MATRIX_DET) {
        return source.map((p) => clonePoint3(p));
    }

    const invDet = 1 / det;
    const u = [
        ((r0[0] * s11) - (r1[0] * s01)) * invDet,
        ((r0[1] * s11) - (r1[1] * s01)) * invDet,
        ((r0[2] * s11) - (r1[2] * s01)) * invDet,
    ];
    const v = [
        ((s00 * r1[0]) - (s01 * r0[0])) * invDet,
        ((s00 * r1[1]) - (s01 * r0[1])) * invDet,
        ((s00 * r1[2]) - (s01 * r0[2])) * invDet,
    ];

    if (!u.every((n) => Number.isFinite(n)) || !v.every((n) => Number.isFinite(n))) {
        return source.map((p) => clonePoint3(p));
    }

    const out = new Array(count);
    out[0] = clonePoint3(start);
    out[count - 1] = clonePoint3(end);
    for (let i = 1; i < count - 1; i++) {
        const t = params[i];
        const w = t * (1 - t);
        const base = [
            start[0] + (delta[0] * t),
            start[1] + (delta[1] * t),
            start[2] + (delta[2] * t),
        ];
        out[i] = [
            base[0] + (w * (u[0] + (v[0] * t))),
            base[1] + (w * (u[1] + (v[1] * t))),
            base[2] + (w * (u[2] + (v[2] * t))),
        ];
    }
    return out;
}

function segmentDirection(a, b) {
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}

function vectorLength(v) {
    return Math.hypot(v[0], v[1], v[2]);
}

function dot(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

export function hasLocalBacktrackingAgainstSource(sourcePoints, candidatePoints) {
    const source = Array.isArray(sourcePoints) ? sourcePoints : [];
    const candidate = Array.isArray(candidatePoints) ? candidatePoints : [];
    if (source.length !== candidate.length || source.length < 2) return true;
    for (let i = 0; i < source.length - 1; i++) {
        const s0 = source[i];
        const s1 = source[i + 1];
        const c0 = candidate[i];
        const c1 = candidate[i + 1];
        if (!isPoint3(s0) || !isPoint3(s1) || !isPoint3(c0) || !isPoint3(c1)) return true;

        const srcSeg = segmentDirection(s0, s1);
        const candSeg = segmentDirection(c0, c1);
        const srcLen = vectorLength(srcSeg);
        const candLen = vectorLength(candSeg);
        if (!(srcLen > MIN_SEGMENT_LENGTH) || !(candLen > MIN_SEGMENT_LENGTH)) continue;
        const cos = dot(srcSeg, candSeg) / (srcLen * candLen);
        if (cos < BACKTRACK_COS_TOL) return true;
    }
    return false;
}

function blendPolylines(sourcePoints, fittedPoints, alpha) {
    const source = Array.isArray(sourcePoints) ? sourcePoints : [];
    const fitted = Array.isArray(fittedPoints) ? fittedPoints : [];
    const count = Math.min(source.length, fitted.length);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
        if (i === 0 || i === count - 1) {
            out[i] = clonePoint3(source[i]);
            continue;
        }
        out[i] = lerpPoint3(source[i], fitted[i], alpha);
    }
    return out;
}

function enforceNoBacktracking(sourcePoints, fittedPoints) {
    const source = Array.isArray(sourcePoints) ? sourcePoints : [];
    const fitted = Array.isArray(fittedPoints) ? fittedPoints : [];
    if (!hasLocalBacktrackingAgainstSource(source, fitted)) return fitted;

    let lo = 0;
    let hi = 1;
    let safe = source.map((p) => clonePoint3(p));

    for (let i = 0; i < BACKTRACK_SEARCH_STEPS; i++) {
        const alpha = (lo + hi) * 0.5;
        const blended = blendPolylines(source, fitted, alpha);
        if (hasLocalBacktrackingAgainstSource(source, blended)) hi = alpha;
        else {
            lo = alpha;
            safe = blended;
        }
    }
    return safe;
}

export function fitAndSnapOpenEdgePolyline(points, options = {}) {
    const source = Array.isArray(points) ? points : [];
    if (source.length < 2) return [];
    if (!source.every((p) => isPoint3(p))) return source.map((p) => (isPoint3(p) ? clonePoint3(p) : [0, 0, 0]));

    const rawStrength = Number(options?.fitStrength);
    const fitStrength = Number.isFinite(rawStrength)
        ? Math.max(0, Math.min(1, rawStrength))
        : 1;

    if (source.length < 3 || fitStrength <= 0) {
        return source.map((p) => clonePoint3(p));
    }

    const fitted = fitOpenPolylineEndpointsExact(source);
    const blended = blendPolylines(source, fitted, fitStrength);
    return enforceNoBacktracking(source, blended);
}


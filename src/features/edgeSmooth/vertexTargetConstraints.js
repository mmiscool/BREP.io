const DEFAULT_STEP_FACTORS = Object.freeze([1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.1, 0.05]);
const DEFAULT_MIN_AREA2_RATIO = 0.04;
const DEFAULT_MIN_NORMAL_DOT = 0.1;
const DEFAULT_MIN_AREA2_ABS = 1e-24;

function triArea2AndNormal(vp, tv, triIndex, movedVertex = -1, mx = 0, my = 0, mz = 0) {
    const triBase = triIndex * 3;
    const i0 = tv[triBase + 0] >>> 0;
    const i1 = tv[triBase + 1] >>> 0;
    const i2 = tv[triBase + 2] >>> 0;

    const b0 = i0 * 3;
    const b1 = i1 * 3;
    const b2 = i2 * 3;
    if ((b0 + 2) >= vp.length || (b1 + 2) >= vp.length || (b2 + 2) >= vp.length) return null;

    const ax = (i0 === movedVertex) ? mx : Number(vp[b0 + 0]);
    const ay = (i0 === movedVertex) ? my : Number(vp[b0 + 1]);
    const az = (i0 === movedVertex) ? mz : Number(vp[b0 + 2]);
    const bx = (i1 === movedVertex) ? mx : Number(vp[b1 + 0]);
    const by = (i1 === movedVertex) ? my : Number(vp[b1 + 1]);
    const bz = (i1 === movedVertex) ? mz : Number(vp[b1 + 2]);
    const cx = (i2 === movedVertex) ? mx : Number(vp[b2 + 0]);
    const cy = (i2 === movedVertex) ? my : Number(vp[b2 + 1]);
    const cz = (i2 === movedVertex) ? mz : Number(vp[b2 + 2]);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)
        || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)
        || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) {
        return null;
    }

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = (uy * vz) - (uz * vy);
    const ny = (uz * vx) - (ux * vz);
    const nz = (ux * vy) - (uy * vx);
    const area2 = (nx * nx) + (ny * ny) + (nz * nz);
    if (!(area2 > 0) || !Number.isFinite(area2)) return null;
    const invLen = 1 / Math.sqrt(area2);
    return { area2, nx: nx * invLen, ny: ny * invLen, nz: nz * invLen };
}

function buildVertexIncidentTriangles(tv, vertexCount) {
    const incident = Array.from({ length: vertexCount }, () => []);
    const triCount = (tv.length / 3) | 0;
    for (let t = 0; t < triCount; t++) {
        const base = t * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;
        if (i0 < vertexCount) incident[i0].push(t);
        if (i1 < vertexCount) incident[i1].push(t);
        if (i2 < vertexCount) incident[i2].push(t);
    }
    return incident;
}

export function applyConstrainedVertexTargets(vp, tv, targetMap, options = {}) {
    if (!Array.isArray(vp) || vp.length < 3 || !(targetMap instanceof Map) || targetMap.size === 0) {
        return { movedVertices: 0, constrainedVertices: 0, rejectedVertices: 0 };
    }

    const vertexCount = (vp.length / 3) | 0;
    const maxIndex = vertexCount - 1;
    const hasTopology = Array.isArray(tv) && tv.length >= 3;
    const incident = hasTopology ? buildVertexIncidentTriangles(tv, vertexCount) : null;

    const minArea2RatioRaw = Number(options?.minArea2Ratio);
    const minArea2Ratio = Number.isFinite(minArea2RatioRaw)
        ? Math.max(0, Math.min(1, minArea2RatioRaw))
        : DEFAULT_MIN_AREA2_RATIO;

    const minNormalDotRaw = Number(options?.minNormalDot);
    const minNormalDot = Number.isFinite(minNormalDotRaw)
        ? Math.max(-1, Math.min(1, minNormalDotRaw))
        : DEFAULT_MIN_NORMAL_DOT;

    const minArea2AbsRaw = Number(options?.minArea2Abs);
    const minArea2Abs = Number.isFinite(minArea2AbsRaw) && minArea2AbsRaw > 0
        ? minArea2AbsRaw
        : DEFAULT_MIN_AREA2_ABS;

    const stepFactorsRaw = Array.isArray(options?.stepFactors) ? options.stepFactors : null;
    const stepFactors = (stepFactorsRaw && stepFactorsRaw.length)
        ? stepFactorsRaw
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v > 0)
            .map((v) => Math.min(1, v))
            .sort((a, b) => b - a)
        : DEFAULT_STEP_FACTORS;

    let movedVertices = 0;
    let constrainedVertices = 0;
    let rejectedVertices = 0;

    for (const [rawIndex, aggregate] of targetMap.entries()) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index) || index < 0 || index > maxIndex) continue;

        const count = Number(aggregate?.count);
        if (!(count > 0)) continue;
        const tx = Number(aggregate?.x) / count;
        const ty = Number(aggregate?.y) / count;
        const tz = Number(aggregate?.z) / count;
        if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) continue;

        const base = index * 3;
        const ox = Number(vp[base + 0]);
        const oy = Number(vp[base + 1]);
        const oz = Number(vp[base + 2]);
        if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) continue;

        const dx = tx - ox;
        const dy = ty - oy;
        const dz = tz - oz;
        const distSq = (dx * dx) + (dy * dy) + (dz * dz);
        if (distSq <= 1e-30) continue;

        if (!hasTopology) {
            vp[base + 0] = tx;
            vp[base + 1] = ty;
            vp[base + 2] = tz;
            movedVertices++;
            continue;
        }

        const triList = incident?.[index];
        if (!Array.isArray(triList) || triList.length === 0) {
            vp[base + 0] = tx;
            vp[base + 1] = ty;
            vp[base + 2] = tz;
            movedVertices++;
            continue;
        }

        const baselines = [];
        for (const triIndex of triList) {
            const info = triArea2AndNormal(vp, tv, triIndex, -1, 0, 0, 0);
            if (!info || !(info.area2 > minArea2Abs)) continue;
            baselines.push({ triIndex, area2: info.area2, nx: info.nx, ny: info.ny, nz: info.nz });
        }

        let acceptedFactor = null;
        let acceptedX = ox;
        let acceptedY = oy;
        let acceptedZ = oz;
        if (!baselines.length) {
            acceptedFactor = 1;
            acceptedX = tx;
            acceptedY = ty;
            acceptedZ = tz;
        } else {
            for (const factor of stepFactors) {
                const cx = ox + (dx * factor);
                const cy = oy + (dy * factor);
                const cz = oz + (dz * factor);
                let valid = true;
                for (const baseline of baselines) {
                    const candidate = triArea2AndNormal(vp, tv, baseline.triIndex, index, cx, cy, cz);
                    if (!candidate || !(candidate.area2 > minArea2Abs)) {
                        valid = false;
                        break;
                    }
                    const minArea2 = Math.max(minArea2Abs, baseline.area2 * minArea2Ratio);
                    if (!(candidate.area2 >= minArea2)) {
                        valid = false;
                        break;
                    }
                    const dot = (candidate.nx * baseline.nx) + (candidate.ny * baseline.ny) + (candidate.nz * baseline.nz);
                    if (!Number.isFinite(dot) || dot < minNormalDot) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) continue;
                acceptedFactor = factor;
                acceptedX = cx;
                acceptedY = cy;
                acceptedZ = cz;
                break;
            }
        }

        if (acceptedFactor === null) {
            rejectedVertices++;
            continue;
        }

        const adx = acceptedX - ox;
        const ady = acceptedY - oy;
        const adz = acceptedZ - oz;
        const acceptedDistSq = (adx * adx) + (ady * ady) + (adz * adz);
        if (!(acceptedDistSq > 1e-30)) continue;

        vp[base + 0] = acceptedX;
        vp[base + 1] = acceptedY;
        vp[base + 2] = acceptedZ;
        movedVertices++;
        if (acceptedFactor < 0.999999) constrainedVertices++;
    }

    return {
        movedVertices,
        constrainedVertices,
        rejectedVertices,
    };
}


/**
 * Geometric measurements.
 */
import { computeTriangleArea } from '../triangleUtils.js';

function normalizePoint3(point, label = 'point') {
    if (Array.isArray(point)) {
        const x = Number(point[0]);
        const y = Number(point[1]);
        const z = Number(point[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    } else if (point && typeof point === 'object') {
        const x = Number(point.x ?? point[0]);
        const y = Number(point.y ?? point[1]);
        const z = Number(point.z ?? point[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    }
    throw new Error(`Solid.minGapToPoint() requires a finite ${label} as [x, y, z] or { x, y, z }.`);
}

function pointTriangleClosest(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const result = (qx, qy, qz) => {
        const dx = qx - px, dy = qy - py, dz = qz - pz;
        return { distanceSquared: dx * dx + dy * dy + dz * dz, closestPoint: { x: qx, y: qy, z: qz } };
    };

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;

    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return result(ax, ay, az);

    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return result(bx, by, bz);

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return result(ax + v * abx, ay + v * aby, az + v * abz);
    }

    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return result(cx, cy, cz);

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return result(ax + w * acx, ay + w * acy, az + w * acz);
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return result(bx + w * bcx, by + w * bcy, bz + w * bcz);
    }

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const nn = nx * nx + ny * ny + nz * nz;
    if (nn <= 1e-30) {
        return [result(ax, ay, az), result(bx, by, bz), result(cx, cy, cz)]
            .sort((a, b) => a.distanceSquared - b.distanceSquared)[0];
    }
    const signed = (apx * nx + apy * ny + apz * nz) / nn;
    return result(px - signed * nx, py - signed * ny, pz - signed * nz);
}

function rayIntersectsTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const EPS = 1e-12;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) return false;
    const invDet = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < -EPS || u > 1 + EPS) return false;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < -EPS || u + v > 1 + EPS) return false;
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return t > 1e-10;
}

function pointInsideMesh(point, vp, tv, bounds = null) {
    let minX = bounds?.minX ?? Infinity;
    let minY = bounds?.minY ?? Infinity;
    let minZ = bounds?.minZ ?? Infinity;
    let maxX = bounds?.maxX ?? -Infinity;
    let maxY = bounds?.maxY ?? -Infinity;
    let maxZ = bounds?.maxZ ?? -Infinity;
    if (!bounds) {
        for (let i = 0; i < vp.length; i += 3) {
            const x = vp[i], y = vp[i + 1], z = vp[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
    }
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY || point.z < minZ || point.z > maxZ) {
        return false;
    }

    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const jitter = 1e-6 * diag;
    const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const triCount = (tv.length / 3) | 0;
    // Per-triangle AABBs (from the min-gap index) let each axis ray skip
    // triangles that cannot intersect it. The margin is far larger than the
    // intersection epsilon, so the reject test is conservative.
    const triRecords = Array.isArray(bounds?.triangles) && bounds.triangles.length === triCount
        ? bounds.triangles
        : null;
    const margin = 2 * jitter;
    let votes = 0;
    for (let k = 0; k < dirs.length; k++) {
        const dir = dirs[k];
        const ox = point.x + (k + 1) * jitter;
        const oy = point.y + (k + 2) * jitter;
        const oz = point.z + (k + 3) * jitter;
        let hits = 0;
        for (let t = 0; t < triCount; t++) {
            if (triRecords) {
                const r = triRecords[t];
                if (k === 0) {
                    if (r.maxX < ox - margin || r.minY > oy + margin || r.maxY < oy - margin
                        || r.minZ > oz + margin || r.maxZ < oz - margin) continue;
                } else if (k === 1) {
                    if (r.maxY < oy - margin || r.minX > ox + margin || r.maxX < ox - margin
                        || r.minZ > oz + margin || r.maxZ < oz - margin) continue;
                } else {
                    if (r.maxZ < oz - margin || r.minX > ox + margin || r.maxX < ox - margin
                        || r.minY > oy + margin || r.maxY < oy - margin) continue;
                }
            }
            const base = t * 3;
            const ia = tv[base] * 3, ib = tv[base + 1] * 3, ic = tv[base + 2] * 3;
            if (rayIntersectsTriangle(
                ox, oy, oz,
                dir[0], dir[1], dir[2],
                vp[ia], vp[ia + 1], vp[ia + 2],
                vp[ib], vp[ib + 1], vp[ib + 2],
                vp[ic], vp[ic + 1], vp[ic + 2]
            )) hits++;
        }
        if ((hits % 2) === 1) votes++;
    }
    return votes >= 2;
}

function arraySampleSignature(arrayLike: any) {
    const length = Array.isArray(arrayLike) || ArrayBuffer.isView(arrayLike) ? (arrayLike as any).length : 0;
    if (!length) return '0';
    const mid = length >> 1;
    return `${length}:${arrayLike[0]}:${arrayLike[mid]}:${arrayLike[length - 1]}`;
}

function minGapGeometryStamp(solid) {
    return {
        numProp: Number(solid?._numProp ?? 3),
        vertPropertiesRef: solid?._vertProperties || null,
        vertPropertiesSig: arraySampleSignature(solid?._vertProperties),
        triVertsRef: solid?._triVerts || null,
        triVertsSig: arraySampleSignature(solid?._triVerts),
    };
}

function minGapStampMatches(a, b) {
    return !!a && !!b
        && a.numProp === b.numProp
        && a.vertPropertiesRef === b.vertPropertiesRef
        && a.vertPropertiesSig === b.vertPropertiesSig
        && a.triVertsRef === b.triVertsRef
        && a.triVertsSig === b.triVertsSig;
}

function clampCell(value, cellsPerAxis) {
    return Math.max(0, Math.min(cellsPerAxis - 1, value | 0));
}

function buildMinGapIndex(mesh, stamp) {
    const vp = Float64Array.from(mesh?.vertProperties ?? []);
    const tv = Uint32Array.from(mesh?.triVerts ?? []);
    const triCount = (tv.length / 3) | 0;
    const triangles = new Array(triCount);
    const allTriangleIndices = new Uint32Array(triCount);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = vp[i], y = vp[i + 1], z = vp[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
        minX = minY = minZ = 0;
        maxX = maxY = maxZ = 0;
    }

    for (let tri = 0; tri < triCount; tri++) {
        allTriangleIndices[tri] = tri;
        const base = tri * 3;
        const ia = (tv[base + 0] >>> 0) * 3;
        const ib = (tv[base + 1] >>> 0) * 3;
        const ic = (tv[base + 2] >>> 0) * 3;
        const ax = vp[ia], ay = vp[ia + 1], az = vp[ia + 2];
        const bx = vp[ib], by = vp[ib + 1], bz = vp[ib + 2];
        const cx = vp[ic], cy = vp[ic + 1], cz = vp[ic + 2];
        triangles[tri] = {
            ia,
            ib,
            ic,
            minX: Math.min(ax, bx, cx),
            minY: Math.min(ay, by, cy),
            minZ: Math.min(az, bz, cz),
            maxX: Math.max(ax, bx, cx),
            maxY: Math.max(ay, by, cy),
            maxZ: Math.max(az, bz, cz),
        };
    }

    const extentX = Math.max(1e-12, maxX - minX);
    const extentY = Math.max(1e-12, maxY - minY);
    const extentZ = Math.max(1e-12, maxZ - minZ);
    const diag = Math.hypot(extentX, extentY, extentZ) || 1;
    const cellsPerAxis = triCount >= 128
        ? Math.max(4, Math.min(48, Math.ceil(Math.cbrt(triCount))))
        : 0;
    const grid = cellsPerAxis > 0 ? new Map() : null;
    const cellSizeX = cellsPerAxis > 0 ? extentX / cellsPerAxis : 1;
    const cellSizeY = cellsPerAxis > 0 ? extentY / cellsPerAxis : 1;
    const cellSizeZ = cellsPerAxis > 0 ? extentZ / cellsPerAxis : 1;
    const cellCoordX = (x) => clampCell(Math.floor((x - minX) / cellSizeX), cellsPerAxis);
    const cellCoordY = (y) => clampCell(Math.floor((y - minY) / cellSizeY), cellsPerAxis);
    const cellCoordZ = (z) => clampCell(Math.floor((z - minZ) / cellSizeZ), cellsPerAxis);
    const cellKey = (ix, iy, iz) => ix + cellsPerAxis * (iy + cellsPerAxis * iz);

    if (grid) {
        for (let tri = 0; tri < triCount; tri++) {
            const record = triangles[tri];
            const ix0 = cellCoordX(record.minX);
            const ix1 = cellCoordX(record.maxX);
            const iy0 = cellCoordY(record.minY);
            const iy1 = cellCoordY(record.maxY);
            const iz0 = cellCoordZ(record.minZ);
            const iz1 = cellCoordZ(record.maxZ);
            for (let ix = ix0; ix <= ix1; ix++) {
                for (let iy = iy0; iy <= iy1; iy++) {
                    for (let iz = iz0; iz <= iz1; iz++) {
                        const key = cellKey(ix, iy, iz);
                        let bucket = grid.get(key);
                        if (!bucket) {
                            bucket = [];
                            grid.set(key, bucket);
                        }
                        bucket.push(tri);
                    }
                }
            }
        }
    }

    return {
        stamp,
        vp,
        tv,
        triangles,
        allTriangleIndices,
        grid,
        cellsPerAxis,
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
        diag,
        cellCoordX,
        cellCoordY,
        cellCoordZ,
        cellKey,
    };
}

function getMinGapIndex(solid) {
    const stamp = minGapGeometryStamp(solid);
    if (minGapStampMatches(solid?._minGapIndex?.stamp, stamp)) return solid._minGapIndex;

    const mesh = solid.getMesh();
    try {
        const index = buildMinGapIndex(mesh, minGapGeometryStamp(solid));
        solid._minGapIndex = index;
        return index;
    } finally {
        try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore mesh cleanup failure */ }
    }
}

function pointAabbDistanceSquared(point, record) {
    const dx = point.x < record.minX ? record.minX - point.x : (point.x > record.maxX ? point.x - record.maxX : 0);
    const dy = point.y < record.minY ? record.minY - point.y : (point.y > record.maxY ? point.y - record.maxY : 0);
    const dz = point.z < record.minZ ? record.minZ - point.z : (point.z > record.maxZ ? point.z - record.maxZ : 0);
    return dx * dx + dy * dy + dz * dz;
}

function queryMinGapCandidates(index, point, cap) {
    if (!index?.grid || cap === Infinity) return index?.allTriangleIndices || [];
    const qMinX = point.x - cap, qMaxX = point.x + cap;
    const qMinY = point.y - cap, qMaxY = point.y + cap;
    const qMinZ = point.z - cap, qMaxZ = point.z + cap;
    if (
        qMaxX < index.minX || qMinX > index.maxX
        || qMaxY < index.minY || qMinY > index.maxY
        || qMaxZ < index.minZ || qMinZ > index.maxZ
    ) {
        return [];
    }
    if (
        qMinX <= index.minX && qMaxX >= index.maxX
        && qMinY <= index.minY && qMaxY >= index.maxY
        && qMinZ <= index.minZ && qMaxZ >= index.maxZ
    ) {
        return index.allTriangleIndices;
    }

    const ix0 = index.cellCoordX(qMinX);
    const ix1 = index.cellCoordX(qMaxX);
    const iy0 = index.cellCoordY(qMinY);
    const iy1 = index.cellCoordY(qMaxY);
    const iz0 = index.cellCoordZ(qMinZ);
    const iz1 = index.cellCoordZ(qMaxZ);
    const out = [];
    const seen = new Set();
    for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
            for (let iz = iz0; iz <= iz1; iz++) {
                const bucket = index.grid.get(index.cellKey(ix, iy, iz));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const tri = bucket[i];
                    if (seen.has(tri)) continue;
                    seen.add(tri);
                    out.push(tri);
                }
            }
        }
    }
    return out;
}

function buildGapRecord(point, closest, distanceSquared) {
    const distance = Math.sqrt(Math.max(0, distanceSquared));
    const vx = closest.closestPoint.x - point.x;
    const vy = closest.closestPoint.y - point.y;
    const vz = closest.closestPoint.z - point.z;
    const invDistance = distance > 0 ? 1 / distance : 0;
    return {
        inside: false,
        distance,
        directionVector: {
            x: vx * invDistance,
            y: vy * invDistance,
            z: vz * invDistance,
        },
    };
}

export function volume() {
    const mesh = this.getMesh();
    try {
        const vp = mesh.vertProperties;
        const tv = mesh.triVerts;
        let vol6 = 0;
        for (let t = 0; t < tv.length; t += 3) {
            const i0 = tv[t] * 3, i1 = tv[t + 1] * 3, i2 = tv[t + 2] * 3;
            const x0 = vp[i0], y0 = vp[i0 + 1], z0 = vp[i0 + 2];
            const x1 = vp[i1], y1 = vp[i1 + 1], z1 = vp[i1 + 2];
            const x2 = vp[i2], y2 = vp[i2 + 1], z2 = vp[i2 + 2];
            vol6 += x0 * (y1 * z2 - z1 * y2)
                - y0 * (x1 * z2 - z1 * x2)
                + z0 * (x1 * y2 - y1 * x2);
        }
        return Math.abs(vol6) / 6.0;
    } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore mesh cleanup failure */ } }
}

export function surfaceArea() {
    const mesh = this.getMesh();
    try {
        const vp = mesh.vertProperties;
        const tv = mesh.triVerts;
        let area = 0;
        for (let t = 0; t < tv.length; t += 3) {
            const i0 = tv[t] * 3, i1 = tv[t + 1] * 3, i2 = tv[t + 2] * 3;
            const ax = vp[i0], ay = vp[i0 + 1], az = vp[i0 + 2];
            const bx = vp[i1], by = vp[i1 + 1], bz = vp[i1 + 2];
            const cx = vp[i2], cy = vp[i2 + 1], cz = vp[i2 + 2];
            area += computeTriangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
        }
        return area;
    } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore mesh cleanup failure */ } }
}

/**
 * Return mesh-surface proximity records between this solid and a point.
 * Records are returned for every triangle within searchLength, sorted nearest first.
 */
export function minGapToPoint(pointInput, searchLength = Infinity, options: any = {}) {
    const point = normalizePoint3(pointInput);
    const cap = searchLength === undefined ? Infinity : Number(searchLength);
    if (!(cap >= 0)) throw new Error('Solid.minGapToPoint() requires searchLength to be a non-negative number.');

    const index = getMinGapIndex(this);
    const vp = index.vp;
    const tv = index.tv;
    const triCount = (tv.length / 3) | 0;
    if (triCount === 0) return [];

    const capSquared = cap === Infinity ? Infinity : cap * cap;
    const surfaceEpsSquared = 1e-24;
    const nearestOnly = !!options?.nearestOnly;
    const records = [];
    const candidates = queryMinGapCandidates(index, point, cap);
    let minDistanceSquared = Infinity;
    let nearestRecord = null;

    for (const tri of candidates) {
        const record = index.triangles[tri];
        if (!record) continue;
        if (cap !== Infinity && pointAabbDistanceSquared(point, record) > capSquared) continue;
        const ia = record.ia, ib = record.ib, ic = record.ic;
        const closest = pointTriangleClosest(
            point.x, point.y, point.z,
            vp[ia], vp[ia + 1], vp[ia + 2],
            vp[ib], vp[ib + 1], vp[ib + 2],
            vp[ic], vp[ic + 1], vp[ic + 2]
        );
        const distanceSquared = closest.distanceSquared;
        if (distanceSquared < minDistanceSquared) minDistanceSquared = distanceSquared;
        if (distanceSquared > capSquared) continue;

        const gapRecord = buildGapRecord(point, closest, distanceSquared);
        if (nearestOnly) {
            if (!nearestRecord || gapRecord.distance < nearestRecord.distance) nearestRecord = gapRecord;
        } else {
            records.push(gapRecord);
        }
    }

    if (nearestOnly && nearestRecord) records.push(nearestRecord);
    const inside = pointInsideMesh(point, vp, tv, index) || minDistanceSquared <= surfaceEpsSquared;
    if (!nearestOnly) {
        records.sort((a, b) => a.distance - b.distance);
    }
    for (const record of records) record.inside = inside;
    return records;
}

/**
 * Count triangles in the current mesh.
 */
export function getTriangleCount() {
    const mesh = this.getMesh();
    try {
        const tv = mesh.triVerts;
        return (tv.length / 3) | 0;
    } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore mesh cleanup failure */ } }
}

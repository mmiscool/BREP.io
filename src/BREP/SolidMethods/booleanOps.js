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
const BOOLEAN_RESULT_WELD_EPSILON = 0.0015;
const BOOLEAN_EDGE_POINT_PROXIMITY = 0.0001;

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

function booleanApproxScale(solid) {
    const vp = solid && solid._vertProperties;
    if (!Array.isArray(vp) || vp.length < 3) return 1;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = vp[i], y = vp[i + 1], z = vp[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ), 1);
}

function pointKey(point, precision = 12) {
    return [
        Number(point?.[0] || 0).toFixed(precision),
        Number(point?.[1] || 0).toFixed(precision),
        Number(point?.[2] || 0).toFixed(precision),
    ].join(",");
}

function faceBoundaryPoints(solid, faceName) {
    if (!solid || typeof solid.getFace !== "function" || !faceName) return [];
    const triangles = solid.getFace(faceName) || [];
    const edgeMap = new Map();
    const addEdge = (a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b)) return;
        const ka = pointKey(a);
        const kb = pointKey(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const current = edgeMap.get(key);
        if (current) {
            current.count += 1;
        } else {
            edgeMap.set(key, {
                count: 1,
                points: [
                    [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0],
                    [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0],
                ],
            });
        }
    };
    for (const triangle of triangles) {
        const p1 = Array.isArray(triangle?.p1) ? triangle.p1 : null;
        const p2 = Array.isArray(triangle?.p2) ? triangle.p2 : null;
        const p3 = Array.isArray(triangle?.p3) ? triangle.p3 : null;
        if (!p1 || !p2 || !p3) continue;
        addEdge(p1, p2);
        addEdge(p2, p3);
        addEdge(p3, p1);
    }
    const out = [];
    const seen = new Set();
    for (const edge of edgeMap.values()) {
        if (edge.count !== 1) continue;
        for (const point of edge.points) {
            const key = pointKey(point);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(point);
        }
    }
    return out;
}

function hasNearTargetEdgePoint(targetSolid, points, tolerance) {
    if (!targetSolid || typeof targetSolid.minGapToPoint !== "function") return false;
    for (const point of points) {
        const records = targetSolid.minGapToPoint(point, tolerance);
        if (Array.isArray(records) && records.some((record) => Number(record?.distance) <= tolerance)) return true;
    }
    return false;
}

function scoreFaceSide(targetSolid, solid, faceName, desiredInside, sampleLimit = 8) {
    const points = faceBoundaryPoints(solid, faceName);
    if (!points.length || typeof targetSolid?.minGapToPoint !== "function") return -Infinity;
    const stride = Math.max(1, Math.ceil(points.length / sampleLimit));
    const searchLength = Math.max(booleanApproxScale(targetSolid) * 2, BOOLEAN_EDGE_POINT_PROXIMITY * 10);
    let score = 0;
    let samples = 0;
    for (let i = 0; i < points.length; i += stride) {
        samples += 1;
        const records = targetSolid.minGapToPoint(points[i], searchLength);
        const inside = Array.isArray(records) && records.length > 0 ? records[0].inside === true : false;
        if (inside === desiredInside) score += 1;
    }
    return samples > 0 ? score / samples : -Infinity;
}

function conditionEdgePointProximity(operation, targetSolid, candidateSolid) {
    const op = String(operation || "").toUpperCase();
    if (op !== "UNION" && op !== "SUBTRACT") return candidateSolid;
    if (
        !targetSolid
        || !candidateSolid
        || typeof targetSolid.minGapToPoint !== "function"
        || typeof candidateSolid.getFaceNames !== "function"
        || typeof candidateSolid.pushFace !== "function"
    ) {
        return candidateSolid;
    }

    const desiredInside = op === "UNION";
    const tolerance = BOOLEAN_EDGE_POINT_PROXIMITY;
    const nudgeDistance = tolerance * 2;
    const candidates = [];
    for (const rawFaceName of candidateSolid.getFaceNames() || []) {
        const faceName = String(rawFaceName || "").trim();
        if (!faceName) continue;
        const points = faceBoundaryPoints(candidateSolid, faceName);
        if (points.length && hasNearTargetEdgePoint(targetSolid, points, tolerance)) candidates.push(faceName);
    }
    if (!candidates.length || typeof candidateSolid.clone !== "function") return candidateSolid;

    const working = candidateSolid.clone();
    let changed = false;
    for (const faceName of candidates) {
        let best = null;
        for (const sign of [1, -1]) {
            const probe = typeof working.clone === "function" ? working.clone() : null;
            if (!probe) continue;
            try {
                probe.pushFace(faceName, sign * nudgeDistance, { warnMissing: false, warnInvalidNormal: false });
                const score = scoreFaceSide(targetSolid, probe, faceName, desiredInside);
                if (!best || score > best.score) best = { sign, score };
            } catch { /* ignore failed probe */ }
        }
        if (!best || !(best.score > -Infinity)) continue;
        try {
            working.pushFace(faceName, best.sign * nudgeDistance, { warnMissing: false, warnInvalidNormal: false });
            changed = true;
        } catch { /* ignore failed push */ }
    }
    return changed ? working : candidateSolid;
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

function buildNativeSnapshotFromMesh(mesh, idToFaceName, opts = {}) {
    requireCppSolidCoreCapability(
        typeof manifold?.buildSolidAuthoringStateFromMesh === "function",
        "Solid._fromManifold",
    );
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
}

function buildNativeSnapshotFromManifold(manifoldObj, idToFaceName, opts = {}) {
    const mesh = manifoldObj.getMesh();
    try {
        return buildNativeSnapshotFromMesh(mesh, idToFaceName, opts);
    } finally {
        try { if (mesh && typeof mesh.delete === "function") mesh.delete(); } catch { }
    }
}

function _vec3FromMesh(mesh, vertIndex) {
    const stride = Number(mesh?.numProp ?? 3) || 3;
    const base = (vertIndex >>> 0) * stride;
    const vp = mesh?.vertProperties ?? [];
    return [Number(vp[base + 0]) || 0, Number(vp[base + 1]) || 0, Number(vp[base + 2]) || 0];
}

function _triangleNormalAndArea(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) return { normal: [0, 0, 0], area2: 0 };
    nx /= len; ny /= len; nz /= len;
    return { normal: [nx, ny, nz], area2: len };
}

function _pointSegmentDistanceSq(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    const denom = abx * abx + aby * aby + abz * abz;
    const t = denom > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / denom)) : 0;
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
}

function _pointTriangleDistanceSq(p, a, b, c) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    const d00 = abx * abx + aby * aby + abz * abz;
    const d01 = abx * acx + aby * acy + abz * acz;
    const d11 = acx * acx + acy * acy + acz * acz;
    const d20 = apx * abx + apy * aby + apz * abz;
    const d21 = apx * acx + apy * acy + apz * acz;
    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) > 1e-18) {
        const v = (d11 * d20 - d01 * d21) / denom;
        const w = (d00 * d21 - d01 * d20) / denom;
        const u = 1 - v - w;
        if (u >= 0 && v >= 0 && w >= 0) {
            const qx = a[0] + abx * v + acx * w;
            const qy = a[1] + aby * v + acy * w;
            const qz = a[2] + abz * v + acz * w;
            const dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
            return dx * dx + dy * dy + dz * dz;
        }
    }
    return Math.min(
        _pointSegmentDistanceSq(p, a, b),
        _pointSegmentDistanceSq(p, b, c),
        _pointSegmentDistanceSq(p, c, a),
    );
}

function _buildTaggedSourceTrianglesFromSolid(solid) {
    const source = {
        numProp: Number(solid?._numProp ?? 3) || 3,
        vertProperties: solid?._vertProperties ?? [],
        triVerts: solid?._triVerts ?? [],
        faceID: solid?._triIDs ?? [],
    };
    const triCount = Math.min(
        (source.triVerts.length / 3) | 0,
        source.faceID.length | 0,
    );
    const triangles = [];
    for (let tri = 0; tri < triCount; tri++) {
        const base = tri * 3;
        const a = _vec3FromMesh(source, source.triVerts[base + 0]);
        const b = _vec3FromMesh(source, source.triVerts[base + 1]);
        const c = _vec3FromMesh(source, source.triVerts[base + 2]);
        const { normal, area2 } = _triangleNormalAndArea(a, b, c);
        if (!(area2 > 0)) continue;
        triangles.push({
            a,
            b,
            c,
            id: source.faceID[tri] >>> 0,
            normal,
            centroid: [
                (a[0] + b[0] + c[0]) / 3,
                (a[1] + b[1] + c[1]) / 3,
                (a[2] + b[2] + c[2]) / 3,
            ],
        });
    }
    return triangles;
}

function _buildRetagCandidateIndex(sourceTriangles) {
    if (!Array.isArray(sourceTriangles) || sourceTriangles.length < 512) {
        return { all: sourceTriangles, candidatesForPoint: () => sourceTriangles };
    }

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const triangle of sourceTriangles) {
        const c = triangle.centroid;
        for (let axis = 0; axis < 3; axis++) {
            if (c[axis] < min[axis]) min[axis] = c[axis];
            if (c[axis] > max[axis]) max[axis] = c[axis];
        }
    }
    const extent = [
        Math.max(1e-9, max[0] - min[0]),
        Math.max(1e-9, max[1] - min[1]),
        Math.max(1e-9, max[2] - min[2]),
    ];
    const targetCellsPerAxis = Math.max(4, Math.min(64, Math.ceil(Math.cbrt(sourceTriangles.length))));
    const cellSize = [
        extent[0] / targetCellsPerAxis,
        extent[1] / targetCellsPerAxis,
        extent[2] / targetCellsPerAxis,
    ];
    const cells = new Map();
    const cellCoord = (point, axis) => Math.max(0, Math.min(targetCellsPerAxis - 1, Math.floor((point[axis] - min[axis]) / cellSize[axis])));
    const cellKey = (ix, iy, iz) => `${ix},${iy},${iz}`;
    for (const triangle of sourceTriangles) {
        const ix = cellCoord(triangle.centroid, 0);
        const iy = cellCoord(triangle.centroid, 1);
        const iz = cellCoord(triangle.centroid, 2);
        const key = cellKey(ix, iy, iz);
        let bucket = cells.get(key);
        if (!bucket) {
            bucket = [];
            cells.set(key, bucket);
        }
        bucket.push(triangle);
    }

    return {
        all: sourceTriangles,
        candidatesForPoint(point) {
            const cx = cellCoord(point, 0);
            const cy = cellCoord(point, 1);
            const cz = cellCoord(point, 2);
            const candidates = [];
            for (let radius = 0; radius <= 3 && candidates.length < 32; radius++) {
                for (let ix = Math.max(0, cx - radius); ix <= Math.min(targetCellsPerAxis - 1, cx + radius); ix++) {
                    for (let iy = Math.max(0, cy - radius); iy <= Math.min(targetCellsPerAxis - 1, cy + radius); iy++) {
                        for (let iz = Math.max(0, cz - radius); iz <= Math.min(targetCellsPerAxis - 1, cz + radius); iz++) {
                            const bucket = cells.get(cellKey(ix, iy, iz));
                            if (bucket) candidates.push(...bucket);
                        }
                    }
                }
            }
            return candidates.length ? candidates : sourceTriangles;
        },
    };
}

function retagSimplifiedMeshFromSourceSolid(mesh, sourceSolid) {
    const sourceTriangles = _buildTaggedSourceTrianglesFromSolid(sourceSolid);
    const triCount = (mesh?.triVerts?.length / 3) | 0;
    if (!triCount || sourceTriangles.length === 0) return mesh;
    const sourceIndex = _buildRetagCandidateIndex(sourceTriangles);

    const faceID = new Uint32Array(triCount);
    for (let tri = 0; tri < triCount; tri++) {
        const base = tri * 3;
        const a = _vec3FromMesh(mesh, mesh.triVerts[base + 0]);
        const b = _vec3FromMesh(mesh, mesh.triVerts[base + 1]);
        const c = _vec3FromMesh(mesh, mesh.triVerts[base + 2]);
        const centroid = [
            (a[0] + b[0] + c[0]) / 3,
            (a[1] + b[1] + c[1]) / 3,
            (a[2] + b[2] + c[2]) / 3,
        ];
        const { normal, area2 } = _triangleNormalAndArea(a, b, c);
        let bestID = sourceTriangles[0].id;
        let bestScore = Infinity;
        for (const candidate of sourceIndex.candidatesForPoint(centroid)) {
            const distanceSq = _pointTriangleDistanceSq(centroid, candidate.a, candidate.b, candidate.c);
            const normalDot = area2 > 0
                ? Math.max(-1, Math.min(1, normal[0] * candidate.normal[0] + normal[1] * candidate.normal[1] + normal[2] * candidate.normal[2]))
                : 1;
            const score = distanceSq + (1 - normalDot) * 1e-6;
            if (score < bestScore) {
                bestScore = score;
                bestID = candidate.id;
            }
        }
        faceID[tri] = bestID >>> 0;
    }
    mesh.faceID = faceID;
    return mesh;
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

export function union(other, options = {}) {
    const Solid = baseSolidCtor(this);
    const left = options?.overlapConditioningEnabled === false
        ? this
        : conditionEdgePointProximity("UNION", other, this);
    const out = buildNativeBooleanResult(left, other, "UNION", Solid);
    try { out.owningFeatureID = this?.owningFeatureID || other?.owningFeatureID || out?.owningFeatureID || null; } catch { }
    return _cleanupBooleanResult(out);
}

export function subtract(other, options = {}) {
    const Solid = baseSolidCtor(this);
    const cutter = options?.overlapConditioningEnabled === false
        ? other
        : conditionEdgePointProximity("SUBTRACT", this, other);
    const out = buildNativeBooleanResult(this, cutter, "SUBTRACT", Solid);
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
    if (updateInPlace && typeof updateInPlace === "object") {
        updateInPlace = false;
    }
    const Solid = this.constructor;
    const m = this._manifoldize();
    const authoringSnapshot = getSolidAuthoringStateSnapshot(this);
    const outM = (tolerance === undefined) ? m.simplify() : m.simplify(tolerance);
    let outSnapshot = null;
    const outMesh = outM.getMesh();
    try {
        retagSimplifiedMeshFromSourceSolid(outMesh, this);
        outSnapshot = buildNativeSnapshotFromMesh(outMesh, this._idToFaceName, {
            faceMetadataJson: authoringSnapshot?.faceMetadataJson,
            edgeMetadataJson: authoringSnapshot?.edgeMetadataJson,
            auxEdges: authoringSnapshot?.auxEdges,
            name: this?.name || "",
        });
    } finally {
        try { if (outMesh && typeof outMesh.delete === "function") outMesh.delete(); } catch { }
    }

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

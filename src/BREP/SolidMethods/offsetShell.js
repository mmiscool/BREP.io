import { applySolidAuthoringStateSnapshot } from "../CppSolidCore.js";
import {
    groupConnectedFacesBySharedEdges,
    thickenFacesToSolid,
} from "../faceThicken.js";
import { THREE } from "../SolidShared.js";
import { manifold } from "../setupManifold.js";
import { unionMany } from "./booleanOps.js";

const DEFAULT_ROUNDED_CORNER_RESOLUTION = 32;
const SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD = 0.7;

function hasNativeTubeBuilder() {
    return typeof manifold?.buildTubeAuthoringState === "function";
}

function baseSolidCtor(obj) {
    const ctor = obj && obj.constructor;
    return (ctor && ctor.BaseSolid) ? ctor.BaseSolid : ctor;
}

function getFaceName(entry) {
    if (!entry) return null;
    if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed || null;
    }
    const raw = entry?.userData?.faceName ?? entry?.faceName ?? entry?.name ?? null;
    if (raw == null) return null;
    const name = String(raw).trim();
    return name || null;
}

function getSelectedFaceNames(faces, sourceFaces) {
    const sourceNames = new Set();
    for (const face of sourceFaces) {
        const name = getFaceName(face);
        if (name) sourceNames.add(name);
    }

    const selected = new Set();
    for (const entry of Array.isArray(faces) ? faces : [faces]) {
        if (!entry) continue;
        const name = getFaceName(entry);
        if (name && sourceNames.has(name)) selected.add(name);
    }
    return selected;
}

function cloneCenterlineAuxEdges(sourceSolid) {
    const source = Array.isArray(sourceSolid?._auxEdges) ? sourceSolid._auxEdges : [];
    const out = [];
    for (const aux of source) {
        const name = String(aux?.name || "EDGE");
        const isCenterline = !!aux?.centerline || /centerline/i.test(name);
        if (!isCenterline) continue;

        const points = Array.isArray(aux?.points)
            ? aux.points.map((point) => {
                if (Array.isArray(point) && point.length >= 3) {
                    const x = Number(point[0]);
                    const y = Number(point[1]);
                    const z = Number(point[2]);
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
                    return null;
                }
                if (point && typeof point === "object") {
                    const x = Number(point.x);
                    const y = Number(point.y);
                    const z = Number(point.z);
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
                }
                return null;
            }).filter(Boolean)
            : [];
        if (points.length < 2) continue;

        const entry = {
            name,
            points,
            closedLoop: !!aux?.closedLoop,
            polylineWorld: !!aux?.polylineWorld,
            centerline: true,
        };
        const materialKey = String(aux?.materialKey || "").trim();
        if (materialKey) entry.materialKey = materialKey;
        const faceA = String(aux?.faceA || "").trim();
        const faceB = String(aux?.faceB || "").trim();
        if (faceA) entry.faceA = faceA;
        if (faceB) entry.faceB = faceB;
        out.push(entry);
    }
    return out;
}

function appendSourceCenterlines(targetSolid, sourceSolid) {
    if (!targetSolid) return targetSolid;
    const centerlines = cloneCenterlineAuxEdges(sourceSolid);
    if (!centerlines.length) return targetSolid;
    const existing = Array.isArray(targetSolid._auxEdges) ? targetSolid._auxEdges : [];
    const keyFor = (aux) => JSON.stringify({
        name: String(aux?.name || "EDGE"),
        points: Array.isArray(aux?.points) ? aux.points : [],
        closedLoop: !!aux?.closedLoop,
    });
    const seen = new Set(existing.map(keyFor));
    const additions = centerlines.filter((aux) => {
        const key = keyFor(aux);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!additions.length) return targetSolid;
    targetSolid._auxEdges = [...existing, ...additions];
    targetSolid._visualizeCache = null;
    targetSolid._cppSolidCoreSyncStamp = null;
    return targetSolid;
}

function pointArrayFromAny(point) {
    if (Array.isArray(point) && point.length >= 3) {
        const x = Number(point[0]);
        const y = Number(point[1]);
        const z = Number(point[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
        return null;
    }
    if (point && typeof point === "object") {
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
    }
    return null;
}

function sanitizePathPoints(points) {
    const out = [];
    if (!Array.isArray(points)) return out;
    for (const point of points) {
        const parsed = pointArrayFromAny(point);
        if (parsed) out.push(parsed);
    }
    return out;
}

function dedupeConsecutivePoints(points, eps = 1e-7) {
    const source = sanitizePathPoints(points);
    if (!source.length) return [];
    const epsSq = eps * eps;
    const out = [source[0]];
    for (let i = 1; i < source.length; i += 1) {
        const prev = out[out.length - 1];
        const point = source[i];
        const dx = point[0] - prev[0];
        const dy = point[1] - prev[1];
        const dz = point[2] - prev[2];
        if (((dx * dx) + (dy * dy) + (dz * dz)) > epsSq) out.push(point);
    }
    return out;
}

function pointDistanceSq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const dx = Number(a[0]) - Number(b[0]);
    const dy = Number(a[1]) - Number(b[1]);
    const dz = Number(a[2]) - Number(b[2]);
    return (dx * dx) + (dy * dy) + (dz * dz);
}

function edgeName(edge, fallback = "") {
    const raw = edge?.name ?? edge?.userData?.edgeName ?? edge?.id ?? fallback;
    const name = String(raw || "").trim();
    return name || fallback || "";
}

function sanitizeToken(value, fallback = "EDGE") {
    const raw = value == null ? "" : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    return trimmed
        .replace(/[:[\]]+/g, "_")
        .replace(/\s+/g, "_")
        .replace(/[^A-Za-z0-9_.-]/g, "_")
        || fallback;
}

function sidewallLabelForSourceEdgeName(name) {
    const raw = String(name || "").trim();
    if (!raw) return null;
    const token = sanitizeToken(raw, "").replace(/_+$/g, "");
    return token ? `${token}_SW` : null;
}

function edgeFaceNames(edge) {
    const names = [];
    const add = (value) => {
        const name = String(value || "").trim();
        if (name && !names.includes(name)) names.push(name);
    };
    add(edge?.userData?.faceA);
    add(edge?.userData?.faceB);
    if (Array.isArray(edge?.faces)) {
        for (const face of edge.faces) add(getFaceName(face));
    }
    return names;
}

function edgeTouchesSelectedFace(edge, selectedFaceNames) {
    if (!(selectedFaceNames instanceof Set) || selectedFaceNames.size === 0) return false;
    return edgeFaceNames(edge).some((name) => selectedFaceNames.has(name));
}

function edgeSidewallMatchKeys(edge) {
    const keys = {
        faceNames: new Set(),
        sourceEdgeNames: new Set(),
        sourceEdgeKeys: new Set(),
    };
    const addName = (value) => {
        const name = String(value || "").trim();
        if (!name) return;
        keys.sourceEdgeNames.add(name);
        const sidewallName = sidewallLabelForSourceEdgeName(name);
        if (sidewallName) keys.faceNames.add(sidewallName);
    };

    addName(edge?.name);
    addName(edge?.userData?.edgeName);
    const fallbackName = edgeName(edge);
    if (fallbackName && fallbackName !== String(edge?.id ?? "")) addName(fallbackName);

    const uuid = String(edge?.uuid || edge?.userData?.sourceEdgeKey || "").trim();
    if (uuid) keys.sourceEdgeKeys.add(uuid);
    return keys;
}

function getSolidFaceNames(solid) {
    try {
        const names = typeof solid?.getFaceNames === "function" ? solid.getFaceNames() : null;
        if (Array.isArray(names)) return names.map((name) => String(name || "").trim()).filter(Boolean);
    } catch { /* fall through */ }
    if (solid?._faceNameToID instanceof Map) {
        return Array.from(solid._faceNameToID.keys(), (name) => String(name || "").trim()).filter(Boolean);
    }
    if (solid?._idToFaceName instanceof Map) {
        return Array.from(solid._idToFaceName.values(), (name) => String(name || "").trim()).filter(Boolean);
    }
    return [];
}

function createSurvivingSidewallFaceIndex(shellSolid) {
    const faceNames = getSolidFaceNames(shellSolid);
    const index = {
        available: faceNames.length > 0,
        faceNames: new Set(faceNames),
        sourceEdgeNames: new Set(),
        sourceEdgeKeys: new Set(),
    };

    for (const faceName of faceNames) {
        if (!/_SW$/.test(faceName)) continue;
        let metadata = null;
        try { metadata = shellSolid?.getFaceMetadata?.(faceName) || null; } catch { metadata = null; }
        if (!metadata || typeof metadata !== "object") continue;

        const sourceEdgeName = String(metadata.sourceEdgeName || "").trim();
        if (sourceEdgeName) {
            index.sourceEdgeNames.add(sourceEdgeName);
            const sidewallName = sidewallLabelForSourceEdgeName(sourceEdgeName);
            if (sidewallName) index.faceNames.add(sidewallName);
        }
        const sourceEdgeKey = String(metadata.sourceEdgeKey || "").trim();
        if (sourceEdgeKey) index.sourceEdgeKeys.add(sourceEdgeKey);
    }
    return index;
}

function edgeHasSurvivingSidewallFace(edge, sidewallFaceIndex) {
    if (!sidewallFaceIndex?.available) return true;
    const keys = edgeSidewallMatchKeys(edge);
    for (const faceName of keys.faceNames) {
        if (sidewallFaceIndex.faceNames.has(faceName)) return true;
    }
    for (const sourceEdgeName of keys.sourceEdgeNames) {
        if (sidewallFaceIndex.sourceEdgeNames.has(sourceEdgeName)) return true;
    }
    for (const sourceEdgeKey of keys.sourceEdgeKeys) {
        if (sidewallFaceIndex.sourceEdgeKeys.has(sourceEdgeKey)) return true;
    }
    return false;
}

function extractEdgePolylineWorld(edgeObj) {
    if (!edgeObj) return [];
    try { edgeObj.updateMatrixWorld?.(true); } catch { /* ignore */ }

    if (typeof edgeObj.points === "function") {
        try {
            const points = sanitizePathPoints(edgeObj.points(true));
            if (points.length >= 2) return dedupeConsecutivePoints(points);
        } catch { /* fall through */ }
    }

    const cached = Array.isArray(edgeObj?.userData?.polylineLocal)
        ? edgeObj.userData.polylineLocal
        : null;
    const isWorld = !!edgeObj?.userData?.polylineWorld;
    const matrixWorld = edgeObj?.matrixWorld || null;
    const vector = new THREE.Vector3();
    const points = [];
    if (Array.isArray(cached) && cached.length >= 2) {
        for (const point of cached) {
            const parsed = pointArrayFromAny(point);
            if (!parsed) continue;
            if (isWorld || !matrixWorld) {
                points.push(parsed);
            } else {
                vector.set(parsed[0], parsed[1], parsed[2]).applyMatrix4(matrixWorld);
                points.push([vector.x, vector.y, vector.z]);
            }
        }
        if (points.length >= 2) return dedupeConsecutivePoints(points);
    }

    const posAttr = edgeObj?.geometry?.getAttribute?.("position");
    if (posAttr && posAttr.itemSize === 3 && posAttr.count >= 2) {
        for (let i = 0; i < posAttr.count; i += 1) {
            vector.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            if (matrixWorld) vector.applyMatrix4(matrixWorld);
            points.push([vector.x, vector.y, vector.z]);
        }
        if (points.length >= 2) return dedupeConsecutivePoints(points);
    }

    const aStart = edgeObj?.geometry?.attributes?.instanceStart;
    const aEnd = edgeObj?.geometry?.attributes?.instanceEnd;
    if (aStart && aEnd && aStart.itemSize === 3 && aEnd.itemSize === 3 && aStart.count === aEnd.count && aStart.count >= 1) {
        vector.set(aStart.getX(0), aStart.getY(0), aStart.getZ(0));
        if (matrixWorld) vector.applyMatrix4(matrixWorld);
        points.push([vector.x, vector.y, vector.z]);
        for (let i = 0; i < aEnd.count; i += 1) {
            vector.set(aEnd.getX(i), aEnd.getY(i), aEnd.getZ(i));
            if (matrixWorld) vector.applyMatrix4(matrixWorld);
            points.push([vector.x, vector.y, vector.z]);
        }
    }
    return points.length >= 2 ? dedupeConsecutivePoints(points) : [];
}

function collectRoundedCornerEdges(sourceSolid, sourceFaces, selectedFaceNames, sidewallFaceIndex = null) {
    try { sourceSolid?.updateMatrixWorld?.(true); } catch { /* ignore */ }
    const records = [];
    const seenObjects = new Set();
    const seenNames = new Set();
    const seenGeometry = new Set();
    let skippedMissingSidewallCount = 0;
    let matchedSidewallCount = 0;

    for (const face of sourceFaces) {
        const faceName = getFaceName(face);
        if (!faceName || selectedFaceNames.has(faceName)) continue;
        const edges = Array.isArray(face?.edges) ? face.edges : [];
        for (const edge of edges) {
            if (!edge || edge?.userData?.auxEdge || edge?.userData?.centerline) continue;
            if (seenObjects.has(edge)) continue;
            if (edgeTouchesSelectedFace(edge, selectedFaceNames)) continue;
            if (!edgeHasSurvivingSidewallFace(edge, sidewallFaceIndex)) {
                skippedMissingSidewallCount += 1;
                seenObjects.add(edge);
                continue;
            }

            const points = extractEdgePolylineWorld(edge);
            if (points.length < 2) continue;

            const name = edgeName(edge);
            if (name) {
                if (seenNames.has(name)) continue;
                seenNames.add(name);
            }

            const geometryKey = `${points[0].map((v) => Number(v).toPrecision(12)).join(",")}|${points[points.length - 1].map((v) => Number(v).toPrecision(12)).join(",")}|${points.length}`;
            if (!name && seenGeometry.has(geometryKey)) continue;
            seenGeometry.add(geometryKey);
            seenObjects.add(edge);
            if (sidewallFaceIndex?.available) matchedSidewallCount += 1;
            records.push({ edge, name, points });
        }
    }
    try {
        Object.defineProperty(records, "__skippedMissingSidewallFaceCount", {
            value: skippedMissingSidewallCount,
            enumerable: false,
        });
        Object.defineProperty(records, "__matchedSidewallFaceCount", {
            value: matchedSidewallCount,
            enumerable: false,
        });
        Object.defineProperty(records, "__sidewallFilterAvailable", {
            value: !!sidewallFaceIndex?.available,
            enumerable: false,
        });
    } catch { /* ignore */ }
    return records;
}

function pathScale(records) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const record of records) {
        for (const point of record?.points || []) {
            const x = Number(point[0]);
            const y = Number(point[1]);
            const z = Number(point[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
    }
    if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return 1;
    return Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ), 1);
}

function buildRoundedTubePathTasks(edgeRecords) {
    const records = Array.isArray(edgeRecords)
        ? edgeRecords.filter((record) => Array.isArray(record?.points) && record.points.length >= 2)
        : [];
    if (!records.length) return [];

    const tolerance = Math.max(pathScale(records) * 1e-7, 1e-7);
    const invTol = 1 / tolerance;
    const keyForPoint = (point) => [
        Math.round(Number(point[0]) * invTol),
        Math.round(Number(point[1]) * invTol),
        Math.round(Number(point[2]) * invTol),
    ].join(",");

    const nodeEdges = new Map();
    const endpoints = [];
    const register = (key, index) => {
        let set = nodeEdges.get(key);
        if (!set) {
            set = new Set();
            nodeEdges.set(key, set);
        }
        set.add(index);
    };

    for (let i = 0; i < records.length; i += 1) {
        const points = records[i].points;
        const startKey = keyForPoint(points[0]);
        const endKey = keyForPoint(points[points.length - 1]);
        endpoints.push({ startKey, endKey });
        register(startKey, i);
        register(endKey, i);
    }

    const unused = new Set(records.map((_, index) => index));
    const unusedDegree = (nodeKey) => {
        let count = 0;
        for (const index of nodeEdges.get(nodeKey) || []) {
            if (unused.has(index)) count += 1;
        }
        return count;
    };
    const nextUnusedEdgeAt = (nodeKey) => {
        for (const index of nodeEdges.get(nodeKey) || []) {
            if (unused.has(index)) return index;
        }
        return null;
    };
    const chooseStart = () => {
        for (const index of unused) {
            const endpointsForEdge = endpoints[index];
            if (unusedDegree(endpointsForEdge.startKey) !== 2) return { index, nodeKey: endpointsForEdge.startKey };
            if (unusedDegree(endpointsForEdge.endKey) !== 2) return { index, nodeKey: endpointsForEdge.endKey };
        }
        const index = unused.values().next().value;
        return { index, nodeKey: endpoints[index].startKey };
    };

    const tasks = [];
    while (unused.size > 0) {
        const start = chooseStart();
        let cursorKey = start.nodeKey;
        const path = [];
        const usedEdges = [];

        while (cursorKey) {
            const edgeIndex = nextUnusedEdgeAt(cursorKey);
            if (edgeIndex == null) break;
            unused.delete(edgeIndex);
            usedEdges.push(records[edgeIndex]);

            const record = records[edgeIndex];
            const edgeEndpoints = endpoints[edgeIndex];
            const forward = edgeEndpoints.startKey === cursorKey;
            const oriented = forward ? record.points : record.points.slice().reverse();
            if (!path.length) {
                path.push(...oriented);
            } else {
                const last = path[path.length - 1];
                const first = oriented[0];
                path.push(...(pointDistanceSq(last, first) <= (tolerance * tolerance) ? oriented.slice(1) : oriented));
            }
            cursorKey = forward ? edgeEndpoints.endKey : edgeEndpoints.startKey;
        }

        const cleanPath = dedupeConsecutivePoints(path, tolerance * 0.1);
        if (cleanPath.length >= 2) tasks.push({ points: cleanPath, edges: usedEdges });
    }
    return tasks;
}

function isClosedPath(points, tolerance) {
    return Array.isArray(points)
        && points.length > 2
        && pointDistanceSq(points[0], points[points.length - 1]) <= (tolerance * tolerance);
}

function buildNativeTubeSolid(sourceSolid, points, radius, {
    closed = false,
    featureId = "OffsetShell",
    name = "OffsetShell_RoundedPipe",
    resolution = DEFAULT_ROUNDED_CORNER_RESOLUTION,
    preferFast = true,
} = {}) {
    if (!hasNativeTubeBuilder()) return null;
    const SolidCtor = baseSolidCtor(sourceSolid);
    if (typeof SolidCtor !== "function") return null;

    const pathPoints = sanitizePathPoints(points);
    if (pathPoints.length < 2) return null;
    const snapshot = manifold.buildTubeAuthoringState({
        points: pathPoints,
        radius: Number(radius),
        innerRadius: 0,
        resolution: Math.max(8, Math.floor(Number(resolution) || DEFAULT_ROUNDED_CORNER_RESOLUTION)),
        closed: !!closed,
        preferFast: preferFast !== false,
        allowSlowFallback: preferFast !== false,
        selfUnion: true,
        name: name || `${featureId}_RoundedPipe`,
    });
    const solid = new SolidCtor();
    applySolidAuthoringStateSnapshot(solid, snapshot, { remapFaceIDs: true });
    solid._dirty = true;
    solid._manifold = null;
    solid._faceIndex = null;
    solid._auxEdges = [];
    try { solid.name = name || `${featureId}_RoundedPipe`; } catch { /* ignore */ }
    try { solid.owningFeatureID = featureId; } catch { /* ignore */ }
    const triCount = Array.isArray(solid._triVerts) ? Math.floor(solid._triVerts.length / 3) : 0;
    return triCount > 0 ? solid : null;
}

function buildRoundedCornerPipeSolid(sourceSolid, edgeRecords, radius, options = {}) {
    const diagnostics = {
        requested: true,
        status: "not_run",
        radius,
        edgeCount: Array.isArray(edgeRecords) ? edgeRecords.length : 0,
        sidewallFilterAvailable: !!edgeRecords?.__sidewallFilterAvailable,
        matchedSidewallFaceCount: Number(edgeRecords?.__matchedSidewallFaceCount || 0),
        skippedMissingSidewallFaceCount: Number(edgeRecords?.__skippedMissingSidewallFaceCount || 0),
        pathCount: 0,
        tubeSolidCount: 0,
        tubeBuildWallMs: 0,
        tubeUnionWallMs: 0,
        unionStrategy: "none",
        firstError: null,
    };
    if (!(Number(radius) > 0)) {
        diagnostics.status = "invalid_radius";
        return { solid: null, diagnostics };
    }
    if (!hasNativeTubeBuilder()) {
        diagnostics.status = "tube_builder_unavailable";
        return { solid: null, diagnostics };
    }
    if (!Array.isArray(edgeRecords) || !edgeRecords.length) {
        diagnostics.status = "no_edges";
        return { solid: null, diagnostics };
    }

    const pathBuildStart = nowMs();
    const tasks = buildRoundedTubePathTasks(edgeRecords);
    diagnostics.pathCount = tasks.length;
    if (!tasks.length) {
        diagnostics.status = "no_paths";
        diagnostics.tubeBuildWallMs = roundMs(nowMs() - pathBuildStart);
        return { solid: null, diagnostics };
    }

    const resolution = options?.roundedCornerResolution ?? options?.resolution ?? DEFAULT_ROUNDED_CORNER_RESOLUTION;
    const featureId = String(options?.featureId || "OffsetShell");
    const tubeSolids = [];
    const tolerance = Math.max(pathScale(edgeRecords) * 1e-7, 1e-7);

    for (let i = 0; i < tasks.length; i += 1) {
        const rawPoints = dedupeConsecutivePoints(tasks[i].points, tolerance * 0.1);
        if (rawPoints.length < 2) continue;
        const closed = isClosedPath(rawPoints, tolerance);
        const finalPoints = closed ? rawPoints.slice(0, -1) : rawPoints;
        if (finalPoints.length < 2) continue;
        try {
            const tubeSolid = buildNativeTubeSolid(sourceSolid, finalPoints, radius, {
                closed,
                featureId,
                name: tasks.length === 1
                    ? `${featureId}_ROUND_PIPE`
                    : `${featureId}_ROUND_PIPE_${i + 1}`,
                resolution,
                preferFast: options?.roundedCornerTubePreferFast !== false,
            });
            if (tubeSolid) tubeSolids.push(tubeSolid);
        } catch (error) {
            if (!diagnostics.firstError) diagnostics.firstError = String(error?.message || error || "unknown error").slice(0, 240);
        }
    }

    diagnostics.tubeBuildWallMs = roundMs(nowMs() - pathBuildStart);
    diagnostics.tubeSolidCount = tubeSolids.length;
    if (!tubeSolids.length) {
        diagnostics.status = diagnostics.firstError ? "tube_build_failed" : "no_tube_solids";
        return { solid: null, diagnostics };
    }

    const unionStart = nowMs();
    let pipe = null;
    try {
        pipe = unionMany(tubeSolids, {
            featureID: featureId,
            owningFeatureID: featureId,
            name: `${featureId}_ROUND_PIPE`,
            nativeBatchUnion: options?.nativeBatchUnion,
            unionStrategy: options?.roundedCornerTubeUnionStrategy || options?.offsetShellUnionStrategy,
            skipFailed: true,
        });
    } catch (error) {
        if (!diagnostics.firstError) diagnostics.firstError = String(error?.message || error || "unknown error").slice(0, 240);
    }
    diagnostics.tubeUnionWallMs = roundMs(nowMs() - unionStart);
    diagnostics.unionStrategy = pipe?.__unionManyDiagnostics?.unionStrategy || "none";
    diagnostics.status = pipe ? "pipe_built" : "pipe_union_failed";
    return { solid: pipe, diagnostics };
}

function nowMs() {
    try {
        if (globalThis.performance && typeof globalThis.performance.now === "function") {
            return globalThis.performance.now();
        }
    } catch {
        /* fall through */
    }
    return Date.now();
}

function roundMs(value) {
    return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
}

export function offsetShell(faces, distance, options = {}) {
    const featureId = String(options?.featureId || options?.name || this?.name || "OffsetShell").trim() || "OffsetShell";
    const newSolidName = String(options?.newSolidName || `${this?.name || "Solid"}_${featureId}`).trim() || `${this?.name || "Solid"}_${featureId}`;

    const offsetDistance = Number(distance);
    if (!Number.isFinite(offsetDistance) || offsetDistance === 0) return null;

    const thickenDistance = -offsetDistance;
    let sourceFaces = [];
    try {
        sourceFaces = Array.isArray(this.faces) ? this.faces.slice() : [];
    } catch {
        sourceFaces = [];
    }
    const selectedFaceNames = getSelectedFaceNames(faces, sourceFaces);
    const faceObjects = sourceFaces.filter((face) => {
        const name = getFaceName(face);
        return name && !selectedFaceNames.has(name);
    });
    if (!faceObjects.length) return null;

    let generatedCount = 0;
    let skippedCount = 0;
    let generatedPatchCount = 0;
    let skippedPatchCount = 0;
    let thickenWallMs = 0;
    let unionWallMs = 0;
    const thickenedSolids = [];
    const thickenedFaceNames = faceObjects.map((face) => getFaceName(face)).filter(Boolean);
    const smoothAdjacentNormalDotThreshold = Number.isFinite(Number(options?.adjacentNormalDotThreshold))
        ? Number(options.adjacentNormalDotThreshold)
        : (Number.isFinite(Number(options?.smoothAdjacentNormalDotThreshold))
            ? Number(options.smoothAdjacentNormalDotThreshold)
            : SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD);
    const faceGroups = groupConnectedFacesBySharedEdges(faceObjects, {
        minSharedNormalDot: smoothAdjacentNormalDotThreshold,
        minPlanarRatio: 0.98,
    });
    const smoothSelectedAdjacentNormals = thickenedFaceNames.length > 1;

    for (let index = 0; index < faceGroups.length; index += 1) {
        const groupFaces = faceGroups[index];
        const faceObj = groupFaces[0] || null;

        let thickened = null;
        const thickenStart = nowMs();
        try {
            const thickenOptions = {
                featureId,
                name: featureId,
                skipTriangleSplit: true,
            };
            if (smoothSelectedAdjacentNormals) {
                thickenOptions.adjacentNormalFaceNames = thickenedFaceNames;
                thickenOptions.smoothAdjacentNormalDotThreshold = smoothAdjacentNormalDotThreshold;
                thickenOptions.sharedBoundaryNormalMode = "equal";
            }
            thickened = groupFaces.length > 1
                ? thickenFacesToSolid(groupFaces, thickenDistance, thickenOptions)
                : faceObj.thicken(thickenDistance, thickenOptions);
        } catch {
            thickenWallMs += nowMs() - thickenStart;
            skippedCount += Math.max(1, groupFaces.length);
            skippedPatchCount += 1;
            continue;
        }
        thickenWallMs += nowMs() - thickenStart;
        if (!thickened) {
            skippedCount += Math.max(1, groupFaces.length);
            skippedPatchCount += 1;
            continue;
        }
        thickenedSolids.push(thickened);
        generatedCount += Math.max(1, groupFaces.length);
        generatedPatchCount += 1;
    }

    const unionStart = nowMs();
    let unionDiagnostics = {};
    let combined = null;
    try {
        combined = unionMany(thickenedSolids, {
            featureID: featureId,
            owningFeatureID: featureId,
            name: newSolidName,
            nativeBatchUnion: options?.nativeBatchUnion,
            unionStrategy: options?.offsetShellUnionStrategy,
            skipFailed: true,
        });
        unionDiagnostics = combined?.__unionManyDiagnostics || {};
    } catch (error) {
        unionDiagnostics = error?.unionManyDiagnostics || {};
    }
    unionWallMs += nowMs() - unionStart;

    if (!combined) return null;
    skippedPatchCount += Number(unionDiagnostics?.skippedSolidCount || 0);
    generatedPatchCount = Number(unionDiagnostics?.contributedSolidCount || generatedPatchCount);

    const roundedCorners = {
        requested: offsetDistance < 0,
        status: offsetDistance < 0 ? "not_run" : "not_requested",
        radius: offsetDistance < 0 ? Math.abs(offsetDistance) : 0,
        separateTubeShellUnion: !!options?.debugSeparateRoundedCornerPipe,
        edgeCount: 0,
        sidewallFilterAvailable: false,
        matchedSidewallFaceCount: 0,
        skippedMissingSidewallFaceCount: 0,
        pathCount: 0,
        tubeSolidCount: 0,
        tubeBuildWallMs: 0,
        tubeUnionWallMs: 0,
        pipeSubtractWallMs: 0,
        shellUnionWallMs: 0,
        unionStrategy: "none",
        shellUnionStrategy: "none",
        firstError: null,
    };

    if (offsetDistance < 0) {
        let roundedPipe = null;
        try {
            const sidewallFaceIndex = createSurvivingSidewallFaceIndex(combined);
            const edgeRecords = collectRoundedCornerEdges(this, sourceFaces, selectedFaceNames, sidewallFaceIndex);
            const built = buildRoundedCornerPipeSolid(this, edgeRecords, Math.abs(offsetDistance), {
                ...options,
                featureId,
            });
            Object.assign(roundedCorners, built?.diagnostics || {});
            roundedPipe = built?.solid || null;
        } catch (error) {
            roundedCorners.status = "edge_collection_failed";
            roundedCorners.firstError = String(error?.message || error || "unknown error").slice(0, 240);
        }

        if (roundedPipe) {
            let pipeOutsideSource = null;
            const subtractStart = nowMs();
            try {
                pipeOutsideSource = roundedPipe.subtract(this, {
                    overlapConditioningEnabled: options?.roundedCornerSubtractOverlapConditioningEnabled,
                });
            } catch (error) {
                roundedCorners.status = "pipe_subtract_failed";
                if (!roundedCorners.firstError) roundedCorners.firstError = String(error?.message || error || "unknown error").slice(0, 240);
            }
            roundedCorners.pipeSubtractWallMs = roundMs(nowMs() - subtractStart);

            if (pipeOutsideSource) {
                // Temporary roundover tooling should not contribute visual aux edges
                // to the final shell; source centerlines are restored once below.
                try { pipeOutsideSource._auxEdges = []; } catch { /* ignore */ }
                try { pipeOutsideSource._cppSolidCoreSyncStamp = null; } catch { /* ignore */ }
                try { pipeOutsideSource.name = `${newSolidName}_ROUND_PIPE_REMAINDER`; } catch { /* ignore */ }
                try { pipeOutsideSource.owningFeatureID = featureId; } catch { /* ignore */ }
                if (options?.debugSeparateRoundedCornerPipe) {
                    roundedCorners.status = "separated";
                    roundedCorners.shellUnionStrategy = "debug_separate";
                    try { combined.__offsetDebugAddedSolids = [pipeOutsideSource]; } catch { /* ignore */ }
                } else {
                    const shellUnionStart = nowMs();
                    try {
                        const roundedShell = unionMany([combined, pipeOutsideSource], {
                            featureID: featureId,
                            owningFeatureID: featureId,
                            name: newSolidName,
                            nativeBatchUnion: options?.nativeBatchUnion,
                            unionStrategy: options?.roundedCornerShellUnionStrategy || options?.offsetShellUnionStrategy,
                            skipFailed: false,
                        });
                        if (roundedShell) {
                            combined = roundedShell;
                            roundedCorners.status = "applied";
                            roundedCorners.shellUnionStrategy = roundedShell?.__unionManyDiagnostics?.unionStrategy || "unknown";
                        } else {
                            roundedCorners.status = "shell_union_failed";
                        }
                    } catch (error) {
                        roundedCorners.status = "shell_union_failed";
                        if (!roundedCorners.firstError) roundedCorners.firstError = String(error?.message || error || "unknown error").slice(0, 240);
                    }
                    roundedCorners.shellUnionWallMs = roundMs(nowMs() - shellUnionStart);
                }
            }
        }
    }

    try { combined.name = newSolidName; } catch { /* ignore */ }
    const buildMethod = roundedCorners.status === "applied"
        ? "face_thicken_union_shell_with_rounded_corners"
        : (roundedCorners.status === "separated"
            ? "face_thicken_union_shell_with_separate_rounded_corner_pipe"
            : "face_thicken_union_shell");
    combined.__offsetMethod = buildMethod;
    combined.__offsetDiagnostics = {
        buildMethod,
        faceCount: sourceFaces.length,
        selectedFaceCount: selectedFaceNames.size,
        thickenedFaceCount: faceObjects.length,
        thickenedPatchCount: faceGroups.length,
        generatedFaceCount: generatedCount,
        skippedFaceCount: skippedCount,
        generatedPatchCount,
        skippedPatchCount,
        thickenDistance,
        adjacentBoundaryNormalDotThreshold: smoothSelectedAdjacentNormals ? smoothAdjacentNormalDotThreshold : null,
        adjacentBoundaryNormalFaceFilterCount: smoothSelectedAdjacentNormals ? Math.max(0, thickenedFaceNames.length - 1) : 0,
        thickenWallMs: roundMs(thickenWallMs),
        unionWallMs: roundMs(unionWallMs),
        unionStrategy: unionDiagnostics?.unionStrategy || "unknown",
        nativeBatchUnionAvailable: !!unionDiagnostics?.nativeBatchUnionAvailable,
        nativeBatchUnionStatus: unionDiagnostics?.nativeBatchUnionStatus || "unknown",
        nativeBatchUnionError: unionDiagnostics?.nativeBatchUnionError || null,
        unionAttemptCount: Number(unionDiagnostics?.unionAttemptCount || 0),
        unionFailureCount: Number(unionDiagnostics?.unionFailureCount || 0),
        firstUnionError: unionDiagnostics?.firstUnionError || null,
        roundedCorners,
    };
    try {
        combined.userData = {
            ...(combined.userData || {}),
            offsetShell: {
                buildMethod,
                selectedFaceNames: Array.from(selectedFaceNames),
                thickenedFaceNames: faceObjects.map((face) => getFaceName(face)).filter(Boolean),
                generatedFaceCount: generatedCount,
                skippedFaceCount: skippedCount,
                generatedPatchCount,
                skippedPatchCount,
                thickenDistance,
                adjacentBoundaryNormalDotThreshold: smoothSelectedAdjacentNormals ? smoothAdjacentNormalDotThreshold : null,
                unionStrategy: unionDiagnostics?.unionStrategy || "unknown",
                roundedCorners,
            },
        };
    } catch { /* ignore */ }
    appendSourceCenterlines(combined, this);
    return combined;
}

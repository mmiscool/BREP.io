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

function triangleAreaFromArrays(p1, p2, p3) {
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) return 0;
    const ax = Number(p1[0]);
    const ay = Number(p1[1]);
    const az = Number(p1[2]);
    const bx = Number(p2[0]);
    const by = Number(p2[1]);
    const bz = Number(p2[2]);
    const cx = Number(p3[0]);
    const cy = Number(p3[1]);
    const cz = Number(p3[2]);
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return 0;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = (uy * vz) - (uz * vy);
    const ny = (uz * vx) - (ux * vz);
    const nz = (ux * vy) - (uy * vx);
    return Math.hypot(nx, ny, nz) * 0.5;
}

function solidModelScale(solid) {
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    if (!vp || vp.length < 6) return 1;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vp.length; i += 3) {
        const x = Number(vp[i + 0]);
        const y = Number(vp[i + 1]);
        const z = Number(vp[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return 1;
    return Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ), 1);
}

function faceTriangleArea(face) {
    let area = 0;
    for (const tri of face?.triangles || []) {
        area += triangleAreaFromArrays(tri?.p1, tri?.p2, tri?.p3);
    }
    return area;
}

function isOffsetShellSidewallFaceName(faceName, metadata = {}) {
    return (
        metadata?.type === "sidewall"
        || metadata?.faceType === "sidewall"
        || /_SW(?:$|[_|])/u.test(String(faceName || ""))
    );
}

function collectSidewallFaceAreas(solid) {
    const out = new Map();
    let faces = null;
    try {
        const queried = typeof solid?.getFaces === "function" ? solid.getFaces(false) : null;
        if (Array.isArray(queried) && queried.length > 0) faces = queried;
    } catch {
        faces = null;
    }
    if (Array.isArray(faces)) {
        for (const face of faces) {
            const faceName = String(face?.faceName || "").trim();
            if (!faceName) continue;
            let metadata = {};
            try { metadata = solid?.getFaceMetadata?.(faceName) || {}; } catch { metadata = {}; }
            if (!isOffsetShellSidewallFaceName(faceName, metadata)) continue;
            const area = faceTriangleArea(face);
            if (area > 0) out.set(faceName, (out.get(faceName) || 0) + area);
        }
        return out;
    }

    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (!tv || !vp || !ids || !idToFace) return out;

    const sidewallIDs = new Map();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        let metadata = {};
        try { metadata = solid?.getFaceMetadata?.(faceName) || {}; } catch { metadata = {}; }
        if (isOffsetShellSidewallFaceName(faceName, metadata)) sidewallIDs.set(faceID, faceName);
    }

    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const faceName = sidewallIDs.get(ids[triIndex] >>> 0);
        if (!faceName) continue;
        const base = triIndex * 3;
        const point = (offset) => {
            const vertexBase = (tv[base + offset] >>> 0) * 3;
            return [
                Number(vp[vertexBase + 0]) || 0,
                Number(vp[vertexBase + 1]) || 0,
                Number(vp[vertexBase + 2]) || 0,
            ];
        };
        const area = triangleAreaFromArrays(point(0), point(1), point(2));
        if (area > 0) out.set(faceName, (out.get(faceName) || 0) + area);
    }
    return out;
}

function mergeSidewallFaceAreas(target, source) {
    if (!(target instanceof Map) || !(source instanceof Map)) return target;
    for (const [faceName, area] of source.entries()) {
        if (!(area > 0)) continue;
        target.set(faceName, (target.get(faceName) || 0) + area);
    }
    return target;
}

function buildSidewallAreaLossCollapseTargets(solid, originalAreas, opts = {}) {
    const original = originalAreas instanceof Map ? originalAreas : new Map();
    const finalAreas = collectSidewallFaceAreas(solid);
    const areaLossThreshold = Math.max(0, Math.min(1, Number(opts?.areaLossThreshold) || 0.98));
    const minOriginalArea = Math.max(0, Number(opts?.minOriginalArea) || 1e-9);
    const targets = [];
    let maxAreaLossRatio = 0;
    let matchedSidewallAreaCount = 0;

    for (const [faceName, originalAreaRaw] of original.entries()) {
        const originalArea = Number(originalAreaRaw) || 0;
        if (!(originalArea > minOriginalArea)) continue;
        const finalArea = Number(finalAreas.get(faceName) || 0);
        if (finalArea > 0) matchedSidewallAreaCount += 1;
        const areaLossRatio = Math.max(0, (originalArea - finalArea) / originalArea);
        if (areaLossRatio > maxAreaLossRatio) maxAreaLossRatio = areaLossRatio;
        if (areaLossRatio >= areaLossThreshold && finalArea > 0) {
            targets.push({
                faceName,
                originalArea,
                finalArea,
                areaLossRatio,
            });
        }
    }

    targets.sort((left, right) => right.areaLossRatio - left.areaLossRatio || left.faceName.localeCompare(right.faceName));
    return {
        areaLossThreshold,
        originalSidewallAreaCount: original.size,
        finalSidewallAreaCount: finalAreas.size,
        matchedSidewallAreaCount,
        collapseTargetCount: targets.length,
        maxAreaLossRatio,
        collapseFaceNames: targets.map((entry) => entry.faceName),
        targets,
    };
}

function pruneUnusedFaceLabelsFromTriangles(solid) {
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (!ids || !faceToId || !idToFace) return 0;

    const usedIDs = new Set();
    for (let i = 0; i < ids.length; i += 1) usedIDs.add(ids[i] >>> 0);

    let removed = 0;
    const removedNames = new Set();
    for (const [faceIDRaw, faceName] of Array.from(idToFace.entries())) {
        const faceID = faceIDRaw >>> 0;
        if (usedIDs.has(faceID)) continue;
        idToFace.delete(faceIDRaw);
        if (faceToId.has(faceName) && (faceToId.get(faceName) >>> 0) === faceID) faceToId.delete(faceName);
        removedNames.add(faceName);
        removed += 1;
    }
    for (const [faceName, faceIDRaw] of Array.from(faceToId.entries())) {
        const faceID = faceIDRaw >>> 0;
        if (usedIDs.has(faceID)) continue;
        faceToId.delete(faceName);
        idToFace.delete(faceIDRaw);
        removedNames.add(faceName);
        removed += 1;
    }
    if (solid._faceMetadata instanceof Map) {
        for (const faceName of removedNames) {
            let stillUsed = false;
            for (const [usedFaceIDRaw, usedFaceName] of idToFace.entries()) {
                if (usedFaceName === faceName && usedIDs.has(usedFaceIDRaw >>> 0)) {
                    stillUsed = true;
                    break;
                }
            }
            if (!stillUsed && !faceToId.has(faceName)) solid._faceMetadata.delete(faceName);
        }
    }
    return removed;
}

function createSurvivingSidewallFaceIndex(shellSolid) {
    let actualFaces = null;
    try {
        const queried = typeof shellSolid?.getFaces === "function" ? shellSolid.getFaces(false) : null;
        if (Array.isArray(queried)) actualFaces = queried;
    } catch {
        actualFaces = null;
    }

    const useActualFaces = Array.isArray(actualFaces);
    const faceNames = useActualFaces
        ? actualFaces.map((face) => String(face?.faceName || "").trim()).filter(Boolean)
        : getSolidFaceNames(shellSolid);
    const index = {
        available: faceNames.length > 0,
        faceNames: new Set(faceNames),
        sourceEdgeNames: new Set(),
        sourceEdgeKeys: new Set(),
        actualGeometryAvailable: useActualFaces,
        actualSidewallFaceCount: 0,
        skippedEmptySidewallFaceCount: 0,
    };

    const indexSidewallFace = (faceName, metadata = null) => {
        const isSidewall = /_SW$/.test(faceName) || metadata?.type === "sidewall";
        if (!isSidewall) return;
        index.actualSidewallFaceCount += 1;
        index.faceNames.add(faceName);
        const sourceEdgeName = String(metadata?.sourceEdgeName || "").trim();
        if (sourceEdgeName) {
            index.sourceEdgeNames.add(sourceEdgeName);
            const sidewallName = sidewallLabelForSourceEdgeName(sourceEdgeName);
            if (sidewallName) index.faceNames.add(sidewallName);
        }
        const sourceEdgeKey = String(metadata?.sourceEdgeKey || "").trim();
        if (sourceEdgeKey) index.sourceEdgeKeys.add(sourceEdgeKey);
    };

    if (useActualFaces) {
        index.faceNames.clear();
        const maxArea = actualFaces.reduce((best, face) => Math.max(best, faceTriangleArea(face)), 0);
        const areaTolerance = Math.max(maxArea * 1e-12, 1e-12);
        for (const face of actualFaces) {
            const faceName = String(face?.faceName || "").trim();
            if (!faceName) continue;
            const metadata = typeof shellSolid?.getFaceMetadata === "function"
                ? (shellSolid.getFaceMetadata(faceName) || null)
                : null;
            const isSidewall = /_SW$/.test(faceName) || metadata?.type === "sidewall";
            const area = faceTriangleArea(face);
            if (area <= areaTolerance) {
                if (isSidewall) index.skippedEmptySidewallFaceCount += 1;
                continue;
            }
            index.faceNames.add(faceName);
            if (isSidewall) indexSidewallFace(faceName, metadata);
        }
        index.available = actualFaces.length > 0;
        return index;
    }

    for (const faceName of faceNames) {
        let metadata = null;
        try { metadata = shellSolid?.getFaceMetadata?.(faceName) || null; } catch { metadata = null; }
        if (!/_SW$/.test(faceName) && metadata?.type !== "sidewall") continue;
        indexSidewallFace(faceName, metadata);
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
        Object.defineProperty(records, "__sidewallFilterUsesActualGeometry", {
            value: !!sidewallFaceIndex?.actualGeometryAvailable,
            enumerable: false,
        });
        Object.defineProperty(records, "__actualSidewallFaceCount", {
            value: Number(sidewallFaceIndex?.actualSidewallFaceCount || 0),
            enumerable: false,
        });
        Object.defineProperty(records, "__skippedEmptySidewallFaceCount", {
            value: Number(sidewallFaceIndex?.skippedEmptySidewallFaceCount || 0),
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

function collapseOffsetShellRoundedPipeSlivers(solid, opts = {}) {
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    if (!solid || !tv || !vp || !ids || !idToFace) {
        return {
            enabled: true,
            collapsedPipeVertices: 0,
            collapsedPipeTriangles: 0,
            removedDegenerateTriangles: 0,
        };
    }

    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    const vertexCount = (vp.length / 3) | 0;
    if (triCount <= 0 || vertexCount <= 0) {
        return {
            enabled: true,
            collapsedPipeVertices: 0,
            collapsedPipeTriangles: 0,
            removedDegenerateTriangles: 0,
        };
    }

    const featureId = String(opts?.featureId || opts?.featureID || "").trim();
    const modelScale = solidModelScale(solid);
    const radius = Math.abs(Number(opts?.radius ?? opts?.offsetDistance ?? opts?.distance ?? 0)) || 0;
    const pipeSliverHeightTolerance = Math.max(
        Number.isFinite(Number(opts?.pipeSliverHeightTolerance)) ? Number(opts.pipeSliverHeightTolerance) : 0,
        modelScale * 5e-5,
        radius > 0 ? radius * 0.25 : 0,
        1e-5,
    );
    const pipeSliverHeightToleranceSq = pipeSliverHeightTolerance * pipeSliverHeightTolerance;
    const debug = opts?.debug === true;
    const getFaceMetadata = (faceName) => {
        try {
            return (typeof solid.getFaceMetadata === "function") ? (solid.getFaceMetadata(faceName) || {}) : {};
        } catch {
            return {};
        }
    };
    const collapseSidewallFaceNames = new Set(
        Array.from(opts?.collapseSidewallFaceNames || [], (faceName) => String(faceName || "").trim()).filter(Boolean),
    );
    const hasCollapseSidewallFilter = Object.prototype.hasOwnProperty.call(opts || {}, "collapseSidewallFaceNames");
    const isRoundedPipeFace = (faceName, metadata = {}) => {
        if (metadata?.offsetShellRoundedPipe === true) return true;
        const name = String(faceName || "");
        if (!name.includes("ROUND_PIPE")) return false;
        if (featureId && !name.includes(`${featureId}_ROUND_PIPE`)) return false;
        return /ROUND_PIPE.*_Outer(?:$|[_|])/u.test(name);
    };

    const sidewallFaceIDs = new Set();
    const pipeFaceIDs = new Set();
    const faceNamesByID = new Map();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        faceNamesByID.set(faceID, faceName);
        const metadata = getFaceMetadata(faceName);
        if (isOffsetShellSidewallFaceName(faceName, metadata) && (!hasCollapseSidewallFilter || collapseSidewallFaceNames.has(faceName))) {
            sidewallFaceIDs.add(faceID);
        }
        if (isRoundedPipeFace(faceName, metadata)) pipeFaceIDs.add(faceID);
    }
    if (sidewallFaceIDs.size === 0 || pipeFaceIDs.size === 0) {
        return {
            enabled: true,
            collapsedPipeVertices: 0,
            collapsedPipeTriangles: 0,
            removedDegenerateTriangles: 0,
            sidewallFaceCount: sidewallFaceIDs.size,
            pipeFaceCount: pipeFaceIDs.size,
            areaLossTargetFaceCount: collapseSidewallFaceNames.size,
        };
    }

    const pointForVertex = (vertexIndex) => [
        Number(vp[(vertexIndex * 3) + 0]) || 0,
        Number(vp[(vertexIndex * 3) + 1]) || 0,
        Number(vp[(vertexIndex * 3) + 2]) || 0,
    ];
    const vertexDistanceSq = (a, b) => pointDistanceSq(pointForVertex(a), pointForVertex(b));
    const pointSegmentDistanceSq = (pointIndex, aIndex, bIndex) => {
        const p = pointForVertex(pointIndex);
        const a = pointForVertex(aIndex);
        const b = pointForVertex(bIndex);
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const abz = b[2] - a[2];
        const apx = p[0] - a[0];
        const apy = p[1] - a[1];
        const apz = p[2] - a[2];
        const denom = (abx * abx) + (aby * aby) + (abz * abz);
        const t = denom > 0
            ? Math.max(0, Math.min(1, ((apx * abx) + (apy * aby) + (apz * abz)) / denom))
            : 0;
        const dx = apx - (abx * t);
        const dy = apy - (aby * t);
        const dz = apz - (abz * t);
        return (dx * dx) + (dy * dy) + (dz * dz);
    };
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const edgeToTriangles = new Map();
    const vertexFaceIDs = new Map();
    const addVertexFace = (vertexIndex, faceID) => {
        let faceIDs = vertexFaceIDs.get(vertexIndex);
        if (!faceIDs) {
            faceIDs = new Set();
            vertexFaceIDs.set(vertexIndex, faceIDs);
        }
        faceIDs.add(faceID);
    };

    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const faceID = ids[triIndex] >>> 0;
        const base = triIndex * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;
        const record = { triIndex, faceID, vertices: [i0, i1, i2] };
        addVertexFace(i0, faceID);
        addVertexFace(i1, faceID);
        addVertexFace(i2, faceID);
        for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
            const key = edgeKey(a, b);
            let list = edgeToTriangles.get(key);
            if (!list) {
                list = [];
                edgeToTriangles.set(key, list);
            }
            list.push(record);
        }
    }

    const vertexIsPipeOnly = (vertexIndex) => {
        const faceIDs = vertexFaceIDs.get(vertexIndex);
        if (!faceIDs || faceIDs.size === 0) return false;
        for (const faceID of faceIDs) {
            if (!pipeFaceIDs.has(faceID >>> 0)) return false;
        }
        return true;
    };
    const chooseShortestEdgeCollapseCandidate = (tri, preferredSource = null) => {
        const [i0, i1, i2] = tri.vertices;
        const edges = [
            { a: i0, b: i1, lengthSq: vertexDistanceSq(i0, i1) },
            { a: i1, b: i2, lengthSq: vertexDistanceSq(i1, i2) },
            { a: i2, b: i0, lengthSq: vertexDistanceSq(i2, i0) },
        ].sort((left, right) => left.lengthSq - right.lengthSq || left.a - right.a || left.b - right.b);
        const edge = edges[0];
        if (!edge) return null;
        let source = null;
        let target = null;
        const aPipeOnly = vertexIsPipeOnly(edge.a);
        const bPipeOnly = vertexIsPipeOnly(edge.b);
        if (aPipeOnly && !bPipeOnly) {
            source = edge.a;
            target = edge.b;
        } else if (bPipeOnly && !aPipeOnly) {
            source = edge.b;
            target = edge.a;
        } else if (preferredSource === edge.a || preferredSource === edge.b) {
            source = preferredSource;
            target = preferredSource === edge.a ? edge.b : edge.a;
        } else {
            source = edge.a > edge.b ? edge.a : edge.b;
            target = edge.a > edge.b ? edge.b : edge.a;
        }
        if (source == null || target == null || source === target) return null;
        return {
            source: source >>> 0,
            target: target >>> 0,
            triIndex: tri.triIndex,
            faceID: tri.faceID,
            heightSq: 0,
            edgeLengthSq: edge.lengthSq,
            mode: "shortest-edge-fallback",
            priority: aPipeOnly || bPipeOnly ? 1 : 2,
        };
    };

    const candidateBySource = new Map();
    let skippedLargePipeTriangles = 0;
    let skippedProtectedPipeVertices = 0;
    let shortestEdgeFallbackCandidates = 0;
    const pushCandidate = (candidate) => {
        if (!candidate || candidate.source == null || candidate.target == null || candidate.source === candidate.target) return;
        const existing = candidateBySource.get(candidate.source);
        if (
            !existing
            || (candidate.priority || 0) < (existing.priority || 0)
            || (
                (candidate.priority || 0) === (existing.priority || 0)
                && (
                    candidate.heightSq < existing.heightSq
                    || (candidate.heightSq === existing.heightSq && (candidate.edgeLengthSq || 0) < (existing.edgeLengthSq || 0))
                )
            )
        ) {
            candidateBySource.set(candidate.source, candidate);
        }
    };
    for (const [key, incidentTriangles] of edgeToTriangles.entries()) {
        if (!Array.isArray(incidentTriangles) || incidentTriangles.length < 2) continue;
        const hasSidewall = incidentTriangles.some((tri) => sidewallFaceIDs.has(tri.faceID));
        if (!hasSidewall) continue;
        const [aRaw, bRaw] = key.split("|");
        const edgeA = Number(aRaw) >>> 0;
        const edgeB = Number(bRaw) >>> 0;
        for (const tri of incidentTriangles) {
            if (!pipeFaceIDs.has(tri.faceID)) continue;
            const source = tri.vertices.find((vertexIndex) => vertexIndex !== edgeA && vertexIndex !== edgeB);
            if (source == null) continue;
            const heightSq = pointSegmentDistanceSq(source, edgeA, edgeB);
            if (heightSq > pipeSliverHeightToleranceSq) {
                skippedLargePipeTriangles += 1;
                continue;
            }
            if (!vertexIsPipeOnly(source)) {
                const fallback = chooseShortestEdgeCollapseCandidate(tri, source);
                if (fallback) {
                    fallback.heightSq = heightSq;
                    shortestEdgeFallbackCandidates += 1;
                    pushCandidate(fallback);
                } else {
                    skippedProtectedPipeVertices += 1;
                }
                continue;
            }
            const target = vertexDistanceSq(source, edgeA) <= vertexDistanceSq(source, edgeB)
                ? edgeA
                : edgeB;
            pushCandidate({
                source,
                target,
                triIndex: tri.triIndex,
                faceID: tri.faceID,
                heightSq,
                edgeLengthSq: vertexDistanceSq(source, target),
                mode: "pipe-only-opposite-vertex",
                priority: 0,
            });
        }
    }

    const candidates = Array.from(candidateBySource.values())
        .sort((left, right) => (
            (left.priority || 0) - (right.priority || 0)
            || left.heightSq - right.heightSq
            || (left.edgeLengthSq || 0) - (right.edgeLengthSq || 0)
            || left.source - right.source
        ));
    if (candidates.length === 0) {
        return {
            enabled: true,
            collapsedPipeVertices: 0,
            collapsedPipeTriangles: 0,
            removedDegenerateTriangles: 0,
            sidewallFaceCount: sidewallFaceIDs.size,
            pipeFaceCount: pipeFaceIDs.size,
            areaLossTargetFaceCount: collapseSidewallFaceNames.size,
            pipeSliverHeightTolerance,
            skippedLargePipeTriangles,
            skippedProtectedPipeVertices,
            shortestEdgeFallbackCandidates,
            shortestEdgeFallbackCollapses: 0,
        };
    }

    const parent = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) parent[i] = i;
    const find = (index) => {
        let i = index;
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const uniteDirected = (source, target) => {
        const rs = find(source);
        const rt = find(target);
        if (rs === rt) return false;
        parent[rs] = rt;
        return true;
    };

    let collapsedPipeVertices = 0;
    let shortestEdgeFallbackCollapses = 0;
    const collapsedPipeFaceNames = new Set();
    for (const candidate of candidates) {
        if (uniteDirected(candidate.source, candidate.target)) {
            collapsedPipeVertices += 1;
            if (candidate.mode === "shortest-edge-fallback") shortestEdgeFallbackCollapses += 1;
            const faceName = faceNamesByID.get(candidate.faceID);
            if (faceName) collapsedPipeFaceNames.add(faceName);
        }
    }
    if (collapsedPipeVertices === 0) {
        return {
            enabled: true,
            collapsedPipeVertices: 0,
            collapsedPipeTriangles: candidates.length,
            removedDegenerateTriangles: 0,
            sidewallFaceCount: sidewallFaceIDs.size,
            pipeFaceCount: pipeFaceIDs.size,
            areaLossTargetFaceCount: collapseSidewallFaceNames.size,
            pipeSliverHeightTolerance,
            skippedLargePipeTriangles,
            skippedProtectedPipeVertices,
            shortestEdgeFallbackCandidates,
            shortestEdgeFallbackCollapses,
        };
    }

    const rootCoords = new Map();
    for (let i = 0; i < vertexCount; i += 1) {
        const root = find(i);
        if (rootCoords.has(root)) continue;
        rootCoords.set(root, pointForVertex(root));
    }
    for (let i = 0; i < vertexCount; i += 1) {
        const coords = rootCoords.get(find(i));
        vp[(i * 3) + 0] = coords[0];
        vp[(i * 3) + 1] = coords[1];
        vp[(i * 3) + 2] = coords[2];
    }

    solid._vertKeyToIndex = new Map();
    for (let i = 0; i < vp.length; i += 3) {
        solid._vertKeyToIndex.set(`${vp[i]},${vp[i + 1]},${vp[i + 2]}`, (i / 3) | 0);
    }
    solid._faceIndex = null;
    solid._dirty = true;
    try { if (solid._manifold && typeof solid._manifold.delete === "function") solid._manifold.delete(); } catch { /* ignore */ }
    solid._manifold = null;
    solid._cppSolidCoreSyncStamp = null;

    let removedDegenerateTriangles = 0;
    if (typeof solid.removeDegenerateTriangles === "function") {
        try {
            removedDegenerateTriangles = Math.max(0, Number(solid.removeDegenerateTriangles() || 0));
        } catch {
            removedDegenerateTriangles = 0;
        }
    }

    const summary = {
        enabled: true,
        collapsedPipeVertices,
        collapsedPipeTriangles: candidates.length,
        removedDegenerateTriangles,
        sidewallFaceCount: sidewallFaceIDs.size,
        pipeFaceCount: pipeFaceIDs.size,
        areaLossTargetFaceCount: collapseSidewallFaceNames.size,
        pipeSliverHeightTolerance,
        skippedLargePipeTriangles,
        skippedProtectedPipeVertices,
        shortestEdgeFallbackCandidates,
        shortestEdgeFallbackCollapses,
        pipeFaceNames: Array.from(collapsedPipeFaceNames),
    };
    if (debug) {
        console.log("[OffsetShell] Collapsed rounded-pipe sliver vertices onto sidewall edges.", summary);
    }
    return summary;
}

function reassignAreaLossSidewallFacesToDominantNeighbor(solid, opts = {}) {
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
    if (!solid || !tv || !ids || !idToFace || !faceToId) {
        return { reassignedTriangles: 0, reassignedFaces: 0, removedFaceLabels: 0 };
    }

    const collapseSidewallFaceNames = new Set(
        Array.from(opts?.collapseSidewallFaceNames || [], (faceName) => String(faceName || "").trim()).filter(Boolean),
    );
    if (collapseSidewallFaceNames.size === 0) {
        return { reassignedTriangles: 0, reassignedFaces: 0, removedFaceLabels: 0 };
    }

    const featureId = String(opts?.featureId || opts?.featureID || "").trim();
    const debug = opts?.debug === true;
    const getFaceMetadata = (faceName) => {
        try {
            return (typeof solid.getFaceMetadata === "function") ? (solid.getFaceMetadata(faceName) || {}) : {};
        } catch {
            return {};
        }
    };
    const isRoundedPipeFace = (faceName, metadata = {}) => {
        if (metadata?.offsetShellRoundedPipe === true) return true;
        const name = String(faceName || "");
        if (!name.includes("ROUND_PIPE")) return false;
        if (featureId && !name.includes(`${featureId}_ROUND_PIPE`)) return false;
        return /ROUND_PIPE.*_Outer(?:$|[_|])/u.test(name);
    };

    const targetFaceIDs = new Set();
    const targetFaceNamesByID = new Map();
    const pipeFaceIDs = new Set();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        const metadata = getFaceMetadata(faceName);
        if (collapseSidewallFaceNames.has(faceName) && isOffsetShellSidewallFaceName(faceName, metadata)) {
            targetFaceIDs.add(faceID);
            targetFaceNamesByID.set(faceID, faceName);
        }
        if (isRoundedPipeFace(faceName, metadata)) pipeFaceIDs.add(faceID);
    }
    if (targetFaceIDs.size === 0) {
        return { reassignedTriangles: 0, reassignedFaces: 0, removedFaceLabels: 0 };
    }

    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const edgeToFaceIDs = new Map();
    const trianglesByTargetFaceID = new Map();
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const faceID = ids[triIndex] >>> 0;
        if (targetFaceIDs.has(faceID)) {
            let tris = trianglesByTargetFaceID.get(faceID);
            if (!tris) {
                tris = [];
                trianglesByTargetFaceID.set(faceID, tris);
            }
            tris.push(triIndex);
        }
        const base = triIndex * 3;
        const i0 = tv[base + 0] >>> 0;
        const i1 = tv[base + 1] >>> 0;
        const i2 = tv[base + 2] >>> 0;
        for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
            const key = edgeKey(a, b);
            let faceIDs = edgeToFaceIDs.get(key);
            if (!faceIDs) {
                faceIDs = new Set();
                edgeToFaceIDs.set(key, faceIDs);
            }
            faceIDs.add(faceID);
        }
    }

    let reassignedTriangles = 0;
    const targets = [];
    for (const [targetFaceID, triIndices] of trianglesByTargetFaceID.entries()) {
        if (!Array.isArray(triIndices) || triIndices.length === 0) continue;
        const neighborCounts = new Map();
        for (const triIndex of triIndices) {
            const base = triIndex * 3;
            const i0 = tv[base + 0] >>> 0;
            const i1 = tv[base + 1] >>> 0;
            const i2 = tv[base + 2] >>> 0;
            for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
                const faceIDs = edgeToFaceIDs.get(edgeKey(a, b));
                if (!faceIDs) continue;
                for (const neighborIDRaw of faceIDs) {
                    const neighborID = neighborIDRaw >>> 0;
                    if (neighborID === targetFaceID) continue;
                    if (targetFaceIDs.has(neighborID)) continue;
                    if (pipeFaceIDs.has(neighborID)) continue;
                    const neighborName = String(idToFace.get(neighborID) || "").trim();
                    if (!neighborName) continue;
                    neighborCounts.set(neighborID, (neighborCounts.get(neighborID) || 0) + 1);
                }
            }
        }
        let bestNeighborID = null;
        let bestSharedEdgeCount = 0;
        for (const [neighborID, sharedEdgeCount] of neighborCounts.entries()) {
            if (
                bestNeighborID == null
                || sharedEdgeCount > bestSharedEdgeCount
                || (
                    sharedEdgeCount === bestSharedEdgeCount
                    && String(idToFace.get(neighborID) || "").localeCompare(String(idToFace.get(bestNeighborID) || "")) < 0
                )
            ) {
                bestNeighborID = neighborID >>> 0;
                bestSharedEdgeCount = sharedEdgeCount;
            }
        }
        if (bestNeighborID == null) continue;
        for (const triIndex of triIndices) {
            ids[triIndex] = bestNeighborID >>> 0;
            reassignedTriangles += 1;
        }
        targets.push({
            faceName: targetFaceNamesByID.get(targetFaceID) || String(idToFace.get(targetFaceID) || ""),
            toFaceName: String(idToFace.get(bestNeighborID) || ""),
            triangleCount: triIndices.length,
            sharedEdgeCount: bestSharedEdgeCount,
        });
    }

    if (reassignedTriangles <= 0) {
        return {
            reassignedTriangles: 0,
            reassignedFaces: 0,
            removedFaceLabels: 0,
            targetFaceCount: targetFaceIDs.size,
        };
    }

    solid._triIDs = ids;
    const removedFaceLabels = pruneUnusedFaceLabelsFromTriangles(solid);
    solid._faceIndex = null;
    solid._dirty = true;
    try { if (solid._manifold && typeof solid._manifold.delete === "function") solid._manifold.delete(); } catch { /* ignore */ }
    solid._manifold = null;
    solid._cppSolidCoreSyncStamp = null;

    const summary = {
        reassignedTriangles,
        reassignedFaces: targets.length,
        removedFaceLabels,
        targetFaceCount: targetFaceIDs.size,
        targets,
    };
    if (debug) {
        console.log("[OffsetShell] Reassigned area-loss sidewall remnants to dominant neighbors.", summary);
    }
    return summary;
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
        sidewallFilterUsesActualGeometry: !!edgeRecords?.__sidewallFilterUsesActualGeometry,
        actualSidewallFaceCount: Number(edgeRecords?.__actualSidewallFaceCount || 0),
        matchedSidewallFaceCount: Number(edgeRecords?.__matchedSidewallFaceCount || 0),
        skippedMissingSidewallFaceCount: Number(edgeRecords?.__skippedMissingSidewallFaceCount || 0),
        skippedEmptySidewallFaceCount: Number(edgeRecords?.__skippedEmptySidewallFaceCount || 0),
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
    const originalSidewallAreas = new Map();
    const thickenedFaceNames = faceObjects.map((face) => getFaceName(face)).filter(Boolean);
    const smoothAdjacentNormalDotThreshold = Number.isFinite(Number(options?.adjacentNormalDotThreshold))
        ? Number(options.adjacentNormalDotThreshold)
        : (Number.isFinite(Number(options?.smoothAdjacentNormalDotThreshold))
            ? Number(options.smoothAdjacentNormalDotThreshold)
            : SELECTED_PATCH_ADJACENT_NORMAL_DOT_THRESHOLD);
    const faceGroups = groupConnectedFacesBySharedEdges(faceObjects, {
        minSharedEdgeNormalDot: smoothAdjacentNormalDotThreshold,
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
        mergeSidewallFaceAreas(originalSidewallAreas, collectSidewallFaceAreas(thickened));
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
        sidewallFilterUsesActualGeometry: false,
        actualSidewallFaceCount: 0,
        matchedSidewallFaceCount: 0,
        skippedMissingSidewallFaceCount: 0,
        skippedEmptySidewallFaceCount: 0,
        pathCount: 0,
        tubeSolidCount: 0,
        tubeBuildWallMs: 0,
        tubeUnionWallMs: 0,
        pipeSubtractWallMs: 0,
        shellUnionWallMs: 0,
        pipeSliverCollapseCount: 0,
        pipeSliverCollapseRemovedDegenerateTriangles: 0,
        sidewallAreaLoss: null,
        pipeSliverCollapse: null,
        areaLossSidewallReassign: null,
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
                            const sidewallAreaLoss = buildSidewallAreaLossCollapseTargets(combined, originalSidewallAreas, {
                                areaLossThreshold: options?.roundedCornerSidewallAreaLossThreshold ?? 0.98,
                                minOriginalArea: options?.roundedCornerSidewallAreaLossMinOriginalArea,
                            });
                            const pipeSliverCollapse = collapseOffsetShellRoundedPipeSlivers(combined, {
                                featureId,
                                radius: Math.abs(offsetDistance),
                                debug: options?.debugOffsetShellPipeSliverCollapse === true,
                                pipeSliverHeightTolerance: options?.roundedCornerPipeSliverHeightTolerance,
                                collapseSidewallFaceNames: sidewallAreaLoss.collapseFaceNames,
                            });
                            const areaLossSidewallReassign = reassignAreaLossSidewallFacesToDominantNeighbor(combined, {
                                featureId,
                                debug: options?.debugOffsetShellPipeSliverCollapse === true,
                                collapseSidewallFaceNames: sidewallAreaLoss.collapseFaceNames,
                            });
                            roundedCorners.sidewallAreaLoss = sidewallAreaLoss;
                            roundedCorners.pipeSliverCollapse = pipeSliverCollapse;
                            roundedCorners.areaLossSidewallReassign = areaLossSidewallReassign;
                            roundedCorners.pipeSliverCollapseCount = Number(pipeSliverCollapse?.collapsedPipeVertices || 0);
                            roundedCorners.pipeSliverCollapseRemovedDegenerateTriangles = Number(pipeSliverCollapse?.removedDegenerateTriangles || 0);
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

export {
    buildSidewallAreaLossCollapseTargets as __testOnlyBuildSidewallAreaLossCollapseTargets,
    collapseOffsetShellRoundedPipeSlivers as __testOnlyCollapseOffsetShellRoundedPipeSlivers,
    reassignAreaLossSidewallFacesToDominantNeighbor as __testOnlyReassignAreaLossSidewallFacesToDominantNeighbor,
};

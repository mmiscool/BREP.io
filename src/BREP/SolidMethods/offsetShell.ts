import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
} from "../CppSolidCore.js";
import {
    groupConnectedFacesBySharedEdges,
    thickenFacesToSolid,
} from "../faceThicken.js";
import { repairGeneratedFaceIDProvenance } from "../faceIdRepair.js";
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

function normalizeFaceRole(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_");
}

function normalizeOffsetShellFaceRole(metadata: any = {}) {
    if (metadata?.offsetShellRoundedPipe === true) return "rounded_pipe";
    const role = normalizeFaceRole(
        metadata?.offsetShellFaceRole
        || metadata?.faceRole
        || metadata?.faceType
        || metadata?.type
        || metadata?.role
        || "",
    );
    if (role === "sidewall" || role === "side_wall") return "sidewall";
    if (role === "start_cap" || role === "startcap" || role === "start") return "start_cap";
    if (role === "end_cap" || role === "endcap" || role === "end") return "end_cap";
    if (role === "rounded_pipe" || role === "round_pipe" || role === "pipe_outer" || role === "tube_outer") return "rounded_pipe";
    return role;
}

function normalizeOffsetShellSourceFaceRole(metadata: any = {}) {
    const role = normalizeFaceRole(
        metadata?.sourceFaceRole
        || metadata?.sourceFaceType
        || metadata?.sourceType
        || metadata?.sourceMetadata?.faceRole
        || metadata?.sourceMetadata?.faceType
        || metadata?.sourceMetadata?.type
        || "",
    );
    if (role === "sidewall" || role === "side_wall") return "sidewall";
    if (role === "start_cap" || role === "startcap" || role === "start") return "start_cap";
    if (role === "end_cap" || role === "endcap" || role === "end") return "end_cap";
    return role;
}

function getFaceMetadataSafe(solid, faceName) {
    const key = String(faceName || "").trim();
    if (!key) return {};
    try {
        const metadata = typeof solid?.getFaceMetadata === "function" ? solid.getFaceMetadata(key) : null;
        return metadata && typeof metadata === "object" ? metadata : {};
    } catch {
        return {};
    }
}

function isOffsetShellSidewallFace(faceName, metadata: any = {}) {
    void faceName;
    return normalizeOffsetShellFaceRole(metadata) === "sidewall";
}

function isOffsetShellSidewallCapFace(faceName, metadata: any = {}) {
    void faceName;
    const role = normalizeOffsetShellFaceRole(metadata);
    if (role !== "start_cap" && role !== "end_cap") return false;
    return normalizeOffsetShellSourceFaceRole(metadata) === "sidewall";
}

function isOffsetShellRoundedPipeFace(faceName, metadata: any = {}) {
    void faceName;
    return normalizeOffsetShellFaceRole(metadata) === "rounded_pipe";
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

function cloneAuxEdgeRecord(aux, { forceCenterline = false }: any = {}) {
    const name = String(aux?.name || "EDGE").trim() || "EDGE";
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
    if (points.length < 2) return null;

    const entry: any = {
        name,
        points,
        closedLoop: !!aux?.closedLoop,
        polylineWorld: !!aux?.polylineWorld,
        centerline: forceCenterline || !!aux?.centerline,
    };
    const materialKey = String(aux?.materialKey || "").trim();
    if (materialKey) entry.materialKey = materialKey;
    const faceA = String(aux?.faceA || "").trim();
    const faceB = String(aux?.faceB || "").trim();
    if (faceA) entry.faceA = faceA;
    if (faceB) entry.faceB = faceB;
    return entry;
}

function cloneCenterlineAuxEdges(sourceSolid) {
    const source = Array.isArray(sourceSolid?._auxEdges) ? sourceSolid._auxEdges : [];
    const out = [];
    for (const aux of source) {
        const name = String(aux?.name || "EDGE");
        const isCenterline = !!aux?.centerline || /centerline/i.test(name);
        if (!isCenterline) continue;
        const entry = cloneAuxEdgeRecord(aux, { forceCenterline: true });
        if (entry) out.push(entry);
    }
    return out;
}

function cloneOffsetShellPipeCenterlineAuxEdges(sourceSolid, featureId = "") {
    const source = Array.isArray(sourceSolid?._auxEdges) ? sourceSolid._auxEdges : [];
    const prefix = `${String(featureId || "").trim()}_ROUND_PIPE`;
    const out = [];
    for (const aux of source) {
        const name = String(aux?.name || "").trim();
        if (!name || !name.endsWith("_PATH")) continue;
        if (prefix !== "_ROUND_PIPE" && !name.startsWith(prefix)) continue;
        if (!aux?.centerline && !/centerline/i.test(name) && !/_PATH$/i.test(name)) continue;
        const entry = cloneAuxEdgeRecord(aux, { forceCenterline: true });
        if (entry) out.push(entry);
    }
    return out;
}

function appendAuxEdges(targetSolid, auxEdges) {
    if (!targetSolid) return targetSolid;
    const additionsSource = Array.isArray(auxEdges) ? auxEdges : [];
    if (!additionsSource.length) return targetSolid;
    const existing = Array.isArray(targetSolid._auxEdges) ? targetSolid._auxEdges : [];
    const keyFor = (aux) => JSON.stringify({
        name: String(aux?.name || "EDGE"),
        points: Array.isArray(aux?.points) ? aux.points : [],
        closedLoop: !!aux?.closedLoop,
    });
    const seen = new Set(existing.map(keyFor));
    const additions = [];
    for (const aux of additionsSource) {
        const entry = cloneAuxEdgeRecord(aux, { forceCenterline: !!aux?.centerline });
        if (!entry) continue;
        const key = keyFor(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(entry);
    }
    if (!additions.length) return targetSolid;
    targetSolid._auxEdges = [...existing, ...additions];
    targetSolid._visualizeCache = null;
    targetSolid._cppSolidCoreSyncStamp = null;
    return targetSolid;
}

function appendSourceCenterlines(targetSolid, sourceSolid) {
    return appendAuxEdges(targetSolid, cloneCenterlineAuxEdges(sourceSolid));
}

function appendOffsetShellPipeCenterlines(targetSolid, centerlines) {
    return appendAuxEdges(targetSolid, centerlines);
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

function tagPipeRemainderBoundaryFaces(solid, featureId = "") {
    if (!solid || typeof solid.setFaceMetadata !== "function") return 0;

    const sourceFeatureId = String(featureId || "").trim();
    const faceNames = getSolidFaceNames(solid);
    let taggedCount = 0;

    for (const faceName of faceNames) {
        if (!faceName) continue;
        const metadata = getFaceMetadataSafe(solid, faceName);
        if (isOffsetShellRoundedPipeFace(faceName, metadata)) continue;
        const role = normalizeOffsetShellFaceRole(metadata);
        if (role === "start_cap") continue;
        if (role === "sidewall") continue;
        try {
            solid.setFaceMetadata(faceName, {
                ...metadata,
                type: "start_cap",
                faceRole: "start_cap",
                offsetShellFaceRole: "start_cap",
                offsetShellPipeRemainderBoundary: true,
                ...(sourceFeatureId ? { sourceFeatureId } : {}),
            });
            taggedCount += 1;
        } catch {
            /* ignore individual metadata failures */
        }
    }

    return taggedCount;
}

function roundedPipePathNameForFace(faceName) {
    const raw = String(faceName || "").trim();
    if (!raw) return "";
    const match = /^(.*?)(_Outer|_Inner|_CapStart|_CapEnd)(?:_\d+)?$/i.exec(raw);
    return match ? `${match[1]}_PATH` : "";
}

function enrichOffsetShellRoundedPipeMetadata(solid, {
    featureId = "",
    radius = null,
} = {}) {
    if (!solid || typeof solid.setFaceMetadata !== "function") return 0;
    const sourceFeatureId = String(featureId || "").trim();
    const radiusValue = Math.abs(Number(radius));
    const hasRadius = Number.isFinite(radiusValue) && radiusValue > 0;
    let updated = 0;

    for (const faceName of getSolidFaceNames(solid)) {
        if (!faceName) continue;
        const metadata = getFaceMetadataSafe(solid, faceName);
        const looksLikeRoundedPipe = isOffsetShellRoundedPipeFace(faceName, metadata)
            || /_ROUND_PIPE(?:_\d+)?_Outer(?:_\d+)?$/i.test(faceName);
        if (!looksLikeRoundedPipe) continue;

        const pathName = String(
            metadata.pmiCenterlineAuxName
            || metadata.centerlineAuxName
            || metadata.pathName
            || roundedPipePathNameForFace(faceName)
            || "",
        ).trim();
        try {
            solid.setFaceMetadata(faceName, {
                ...metadata,
                type: "rounded_pipe",
                faceRole: "rounded_pipe",
                offsetShellFaceRole: "rounded_pipe",
                offsetShellRoundedPipe: true,
                ...(sourceFeatureId ? { sourceFeatureId } : {}),
                ...(hasRadius ? {
                    radius: radiusValue,
                    inflatedRadius: radiusValue,
                    radiusOverride: radiusValue,
                    pmiRadiusOverride: radiusValue,
                    offsetShellRadius: radiusValue,
                } : {}),
                ...(pathName ? {
                    pathName,
                    centerlineAuxName: pathName,
                    pmiCenterlineAuxName: pathName,
                } : {}),
            });
            updated += 1;
        } catch {
            /* ignore individual metadata failures */
        }
    }
    return updated;
}

function deduplicateSolidFaceNames(solid) {
    if (!solid || typeof solid.deduplicateFaceNames !== "function") return false;
    try {
        solid.deduplicateFaceNames();
        return true;
    } catch {
        return false;
    }
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

function removeDegenerateTrianglesFromAuthoringArrays(solid) {
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    if (!tv || !vp || !ids) return 0;

    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    const nextTriVerts = [];
    const nextTriIDs = [];
    let removed = 0;
    const point = (vertexIndex) => {
        const base = (vertexIndex >>> 0) * 3;
        return [
            Number(vp[base + 0]) || 0,
            Number(vp[base + 1]) || 0,
            Number(vp[base + 2]) || 0,
        ];
    };
    const distanceSq = (a, b) => {
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        return (dx * dx) + (dy * dy) + (dz * dz);
    };
    const duplicateToleranceSq = 1e-20;

    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const base = triIndex * 3;
        const a = tv[base + 0] >>> 0;
        const b = tv[base + 1] >>> 0;
        const c = tv[base + 2] >>> 0;
        const p1 = point(a);
        const p2 = point(b);
        const p3 = point(c);
        const duplicate =
            distanceSq(p1, p2) <= duplicateToleranceSq
            || distanceSq(p2, p3) <= duplicateToleranceSq
            || distanceSq(p3, p1) <= duplicateToleranceSq;
        if (duplicate || triangleAreaFromArrays(p1, p2, p3) <= 1e-12) {
            removed += 1;
            continue;
        }
        nextTriVerts.push(a, b, c);
        nextTriIDs.push(ids[triIndex]);
    }

    if (removed > 0) {
        solid._triVerts = nextTriVerts;
        solid._triIDs = nextTriIDs;
        solid._dirty = true;
        solid._faceIndex = null;
        solid._manifold = null;
        solid._visualizeCache = null;
        solid._cppSolidCoreSyncStamp = null;
    }
    return removed;
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

function analyzeSolidMeshTopology(solid) {
    const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
    const triCount = (triVerts.length / 3) | 0;
    if (!triCount) {
        return {
            boundaryEdgeCount: 0,
            nonManifoldEdgeCount: 0,
            triangleCount: 0,
            coherentlyOriented: false,
        };
    }

    const counts = new Map<any, any>();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
        const a = triVerts[(triIndex * 3) + 0] >>> 0;
        const b = triVerts[(triIndex * 3) + 1] >>> 0;
        const c = triVerts[(triIndex * 3) + 2] >>> 0;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = edgeKey(u, v);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    let boundaryEdgeCount = 0;
    let nonManifoldEdgeCount = 0;
    for (const value of counts.values()) {
        if (value === 1) boundaryEdgeCount += 1;
        else if (value !== 2) nonManifoldEdgeCount += 1;
    }

    let coherentlyOriented = null;
    if (typeof solid?._isCoherentlyOrientedManifold === "function") {
        try {
            coherentlyOriented = solid._isCoherentlyOrientedManifold() === true;
        } catch {
            coherentlyOriented = false;
        }
    }
    return {
        boundaryEdgeCount,
        nonManifoldEdgeCount,
        triangleCount: triCount,
        coherentlyOriented,
    };
}

function checkSolidManifoldBuild(solid) {
    if (!solid || typeof solid._manifoldize !== "function") return { ok: true, error: null };
    let probe = null;
    try {
        const SolidCtor = baseSolidCtor(solid);
        if (typeof SolidCtor === "function") {
            probe = new SolidCtor();
            applySolidAuthoringStateSnapshot(probe, buildSolidAuthoringStateSnapshot(solid));
            probe._dirty = true;
            probe._manifold = null;
            probe._faceIndex = null;
            probe._visualizeCache = null;
            probe._cppSolidCoreSyncStamp = null;
        }
        (probe || solid)._manifoldize();
        return { ok: true, error: null };
    } catch (error) {
        return {
            ok: false,
            error: String(error?.message || error || "unknown error").slice(0, 240),
        };
    } finally {
        if (probe && typeof probe.free === "function") {
            try { probe.free(); } catch { /* ignore */ }
        }
    }
}

function shouldRollbackOffsetShellCleanup(manifoldCheck) {
    return manifoldCheck?.ok === false;
}

function faceTriangleArea(face) {
    let area = 0;
    for (const tri of face?.triangles || []) {
        area += triangleAreaFromArrays(tri?.p1, tri?.p2, tri?.p3);
    }
    return area;
}

function collectSidewallFaceAreas(solid) {
    const out = new Map<any, any>();
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
            const metadata = getFaceMetadataSafe(solid, faceName);
            if (!isOffsetShellSidewallFace(faceName, metadata)) continue;
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

    const sidewallIDs = new Map<any, any>();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        const metadata = getFaceMetadataSafe(solid, faceName);
        if (isOffsetShellSidewallFace(faceName, metadata)) sidewallIDs.set(faceID, faceName);
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

function buildSidewallAreaLossCollapseTargets(solid, originalAreas, opts: any = {}) {
    const original = originalAreas instanceof Map ? originalAreas : new Map<any, any>();
    const finalAreas = collectSidewallFaceAreas(solid);
    const areaLossThreshold = Math.max(0, Math.min(1, Number(opts?.areaLossThreshold) || 0.98));
    const minOriginalArea = Math.max(0, Number(opts?.minOriginalArea) || 1e-9);
    const targets = [];
    let maxAreaLossRatio = 0;
    let matchedSidewallAreaCount = 0;

    for (const [faceName, originalAreaRaw] of original.entries()) {
        const metadata = getFaceMetadataSafe(solid, faceName);
        if (isOffsetShellSidewallCapFace(faceName, metadata)) continue;
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
    const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID as Map<any, any> : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName as Map<any, any> : null;
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
        if (!isOffsetShellSidewallFace(faceName, metadata || {})) return;
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
            const isSidewall = isOffsetShellSidewallFace(faceName, metadata || {});
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
        const metadata = getFaceMetadataSafe(shellSolid, faceName);
        if (!isOffsetShellSidewallFace(faceName, metadata)) continue;
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

function collapseOffsetShellRoundedPipeSlivers(solid, opts: any = {}): any {
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
    const collapseSidewallFaceNames = new Set(
        Array.from(opts?.collapseSidewallFaceNames || [], (faceName) => String(faceName || "").trim()).filter(Boolean),
    );
    const hasCollapseSidewallFilter = Object.prototype.hasOwnProperty.call(opts || {}, "collapseSidewallFaceNames");

    const sidewallFaceIDs = new Set();
    const pipeFaceIDs = new Set();
    const faceNamesByID = new Map<any, any>();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        faceNamesByID.set(faceID, faceName);
        const metadata = getFaceMetadataSafe(solid, faceName);
        if (isOffsetShellSidewallFace(faceName, metadata) && (!hasCollapseSidewallFilter || collapseSidewallFaceNames.has(faceName))) {
            sidewallFaceIDs.add(faceID);
        }
        if (isOffsetShellRoundedPipeFace(faceName, metadata)) pipeFaceIDs.add(faceID);
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
    const edgeToTriangles = new Map<any, any>();
    const vertexFaceIDs = new Map<any, any>();
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

    const candidateBySource = new Map<any, any>();
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

    const rootCoords = new Map<any, any>();
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

    solid._vertKeyToIndex = new Map<any, any>();
    for (let i = 0; i < vp.length; i += 3) {
        solid._vertKeyToIndex.set(`${vp[i]},${vp[i + 1]},${vp[i + 2]}`, (i / 3) | 0);
    }
    solid._faceIndex = null;
    solid._dirty = true;
    try { if (solid._manifold && typeof solid._manifold.delete === "function") solid._manifold.delete(); } catch { /* ignore */ }
    solid._manifold = null;
    solid._cppSolidCoreSyncStamp = null;

    let removedDegenerateTriangles = 0;
    removedDegenerateTriangles = removeDegenerateTrianglesFromAuthoringArrays(solid);

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

function reassignAreaLossSidewallFacesToDominantNeighbor(solid, opts: any = {}): any {
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

    const debug = opts?.debug === true;
    const allowRoundedPipeNeighbors = opts?.allowRoundedPipeNeighbors === true;
    const preferRoundedPipeNeighbors = opts?.preferRoundedPipeNeighbors === true;
    const protectedNeighborFaceNames = new Set(
        Array.from(opts?.protectedNeighborFaceNames || [], (faceName) => String(faceName || "").trim()).filter(Boolean),
    );
    const targetFaceIDs = new Set();
    const targetFaceNamesByID = new Map<any, any>();
    const pipeFaceIDs = new Set();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        const metadata = getFaceMetadataSafe(solid, faceName);
        if (collapseSidewallFaceNames.has(faceName) && isOffsetShellSidewallFace(faceName, metadata)) {
            if (isOffsetShellSidewallCapFace(faceName, metadata)) continue;
            targetFaceIDs.add(faceID);
            targetFaceNamesByID.set(faceID, faceName);
        }
        if (isOffsetShellRoundedPipeFace(faceName, metadata)) pipeFaceIDs.add(faceID);
    }
    if (targetFaceIDs.size === 0) {
        return { reassignedTriangles: 0, reassignedFaces: 0, removedFaceLabels: 0 };
    }

    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const edgeToFaceIDs = new Map<any, any>();
    const trianglesByTargetFaceID = new Map<any, any>();
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
        const neighborCounts = new Map<any, any>();
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
                    if (!allowRoundedPipeNeighbors && pipeFaceIDs.has(neighborID)) continue;
                    const neighborName = String(idToFace.get(neighborID) || "").trim();
                    if (!neighborName) continue;
                    if (protectedNeighborFaceNames.has(neighborName)) continue;
                    neighborCounts.set(neighborID, (neighborCounts.get(neighborID) || 0) + 1);
                }
            }
        }
        let bestNeighborID = null;
        let bestSharedEdgeCount = 0;
        for (const [neighborID, sharedEdgeCount] of neighborCounts.entries()) {
            const bestNeighborIsPipe = bestNeighborID != null && pipeFaceIDs.has(bestNeighborID);
            const neighborIsPipe = pipeFaceIDs.has(neighborID);
            if (
                bestNeighborID == null
                || sharedEdgeCount > bestSharedEdgeCount
                || (
                    sharedEdgeCount === bestSharedEdgeCount
                    && preferRoundedPipeNeighbors
                    && neighborIsPipe
                    && !bestNeighborIsPipe
                )
                || (
                    sharedEdgeCount === bestSharedEdgeCount
                    && (!preferRoundedPipeNeighbors || neighborIsPipe === bestNeighborIsPipe)
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

// Squared distance from point (px,py,pz) to the triangle at coords[o..o+8].
function pointToFlatTriangleDistanceSq(px, py, pz, coords, o) {
    const ax = coords[o + 0], ay = coords[o + 1], az = coords[o + 2];
    const abx = coords[o + 3] - ax, aby = coords[o + 4] - ay, abz = coords[o + 5] - az;
    const acx = coords[o + 6] - ax, acy = coords[o + 7] - ay, acz = coords[o + 8] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

    const bpx = px - coords[o + 3], bpy = py - coords[o + 4], bpz = pz - coords[o + 5];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

    const vc = (d1 * d4) - (d3 * d2);
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        const dx = px - (ax + abx * v), dy = py - (ay + aby * v), dz = pz - (az + abz * v);
        return dx * dx + dy * dy + dz * dz;
    }

    const cpx = px - coords[o + 6], cpy = py - coords[o + 7], cpz = pz - coords[o + 8];
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

    const vb = (d5 * d2) - (d1 * d6);
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        const dx = px - (ax + acx * w), dy = py - (ay + acy * w), dz = pz - (az + acz * w);
        return dx * dx + dy * dy + dz * dz;
    }

    const va = (d3 * d6) - (d5 * d4);
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const bcx = coords[o + 6] - coords[o + 3], bcy = coords[o + 7] - coords[o + 4], bcz = coords[o + 8] - coords[o + 5];
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        const dx = px - (coords[o + 3] + bcx * w), dy = py - (coords[o + 4] + bcy * w), dz = pz - (coords[o + 5] + bcz * w);
        return dx * dx + dy * dy + dz * dz;
    }

    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    const dx = px - (ax + abx * v + acx * w);
    const dy = py - (ay + aby * v + acy * w);
    const dz = pz - (az + abz * v + acz * w);
    return dx * dx + dy * dy + dz * dz;
}

// Uniform hash grid over flat triangle coords; cells sized so any triangle
// inflated by `tol` registers in every cell a within-tol query point can hash to.
function buildFlatTriangleGrid(coords, tol) {
    const count = (coords.length / 9) | 0;
    let maxExtent = 0;
    for (let i = 0; i < count; i++) {
        const o = i * 9;
        const ext = Math.max(
            Math.max(coords[o], coords[o + 3], coords[o + 6]) - Math.min(coords[o], coords[o + 3], coords[o + 6]),
            Math.max(coords[o + 1], coords[o + 4], coords[o + 7]) - Math.min(coords[o + 1], coords[o + 4], coords[o + 7]),
            Math.max(coords[o + 2], coords[o + 5], coords[o + 8]) - Math.min(coords[o + 2], coords[o + 5], coords[o + 8]),
        );
        if (ext > maxExtent) maxExtent = ext;
    }
    const cellSize = Math.max(tol * 4, maxExtent, 1e-12);
    const inv = 1 / cellSize;
    const cells = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
        const o = i * 9;
        const ix0 = Math.floor((Math.min(coords[o], coords[o + 3], coords[o + 6]) - tol) * inv);
        const ix1 = Math.floor((Math.max(coords[o], coords[o + 3], coords[o + 6]) + tol) * inv);
        const iy0 = Math.floor((Math.min(coords[o + 1], coords[o + 4], coords[o + 7]) - tol) * inv);
        const iy1 = Math.floor((Math.max(coords[o + 1], coords[o + 4], coords[o + 7]) + tol) * inv);
        const iz0 = Math.floor((Math.min(coords[o + 2], coords[o + 5], coords[o + 8]) - tol) * inv);
        const iz1 = Math.floor((Math.max(coords[o + 2], coords[o + 5], coords[o + 8]) + tol) * inv);
        for (let ix = ix0; ix <= ix1; ix++) {
            for (let iy = iy0; iy <= iy1; iy++) {
                for (let iz = iz0; iz <= iz1; iz++) {
                    const key = ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
                    let list = cells.get(key);
                    if (!list) {
                        list = [];
                        cells.set(key, list);
                    }
                    list.push(i);
                }
            }
        }
    }
    return { coords, cells, inv };
}

function flatTriangleGridDistanceSq(grid, px, py, pz, limitSq) {
    const key = (((Math.floor(px * grid.inv) * 73856093)
        ^ (Math.floor(py * grid.inv) * 19349663)
        ^ (Math.floor(pz * grid.inv) * 83492791))) | 0;
    const list = grid.cells.get(key);
    if (!list) return Infinity;
    let best = Infinity;
    for (let k = 0; k < list.length; k++) {
        const distSq = pointToFlatTriangleDistanceSq(px, py, pz, grid.coords, list[k] * 9);
        if (distSq < best) {
            best = distSq;
            if (best <= limitSq) break;
        }
    }
    return best;
}

// After the patch union, coincident sheets can survive with a generated
// sidewall label even though they lie exactly on one of the original source
// faces (e.g. a patch rim landing on an adjacent face's plane). Reassign such
// triangles to the original face so the shell prefers source face names.
function reassignSidewallTrianglesCoincidentWithSourceFaces(solid, sourceSolid, thickenedFaceNames, opts: any = {}): any {
    const none = { reassignedTriangles: 0, reassignedFaces: 0, removedFaceLabels: 0, targetFaceCount: 0 };
    const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : null;
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : null;
    const idToFace = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    const faceToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
    if (!solid || !tv || !vp || !ids || !idToFace || !faceToId) return none;

    const targetFaceIDs = new Set<number>();
    for (const [faceIDRaw, faceNameRaw] of idToFace.entries()) {
        const faceID = faceIDRaw >>> 0;
        const faceName = String(faceNameRaw || "").trim();
        if (!faceName) continue;
        if (!isOffsetShellSidewallFace(faceName, getFaceMetadataSafe(solid, faceName))) continue;
        targetFaceIDs.add(faceID);
    }
    if (!targetFaceIDs.size) return none;

    const receivingFaceIDByName = new Map<string, number>();
    for (const nameRaw of thickenedFaceNames || []) {
        const name = String(nameRaw || "").trim();
        if (!name || receivingFaceIDByName.has(name)) continue;
        const faceID = Number(faceToId.get(name)) >>> 0;
        if (faceID) receivingFaceIDByName.set(name, faceID);
    }
    if (!receivingFaceIDByName.size) return none;

    const stv = Array.isArray(sourceSolid?._triVerts) ? sourceSolid._triVerts : null;
    const svp = Array.isArray(sourceSolid?._vertProperties) ? sourceSolid._vertProperties : null;
    const sids = Array.isArray(sourceSolid?._triIDs) ? sourceSolid._triIDs : null;
    const sIdToFace = sourceSolid?._idToFaceName instanceof Map ? sourceSolid._idToFaceName : null;
    if (!stv || !svp || !sids || !sIdToFace) return none;

    try { sourceSolid.updateMatrixWorld?.(true); } catch { /* ignore */ }
    const matrix = sourceSolid?.matrixWorld || new THREE.Matrix4();
    const point = new THREE.Vector3();
    const coordsByFaceName = new Map<string, number[]>();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const sourceTriCount = Math.min((stv.length / 3) | 0, sids.length);
    for (let t = 0; t < sourceTriCount; t++) {
        const faceName = String(sIdToFace.get(sids[t]) || "").trim();
        if (!receivingFaceIDByName.has(faceName)) continue;
        let coords = coordsByFaceName.get(faceName);
        if (!coords) {
            coords = [];
            coordsByFaceName.set(faceName, coords);
        }
        for (let corner = 0; corner < 3; corner++) {
            const base = (stv[(t * 3) + corner] >>> 0) * 3;
            point.set(
                Number(svp[base + 0]) || 0,
                Number(svp[base + 1]) || 0,
                Number(svp[base + 2]) || 0,
            ).applyMatrix4(matrix);
            coords.push(point.x, point.y, point.z);
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
            if (point.z < minZ) minZ = point.z;
            if (point.z > maxZ) maxZ = point.z;
        }
    }
    if (!coordsByFaceName.size) return none;

    const scale = Number.isFinite(minX) ? Math.max(1e-9, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)) : 1;
    const tol = Math.max(
        Number(opts?.tolerance) || 0,
        Math.abs(Number(opts?.thickenDistance) || 0) * 1e-3,
        scale * 1e-5,
        1e-6,
    );
    const tolSq = tol * tol;
    const grids = [];
    for (const [faceName, coords] of coordsByFaceName.entries()) {
        grids.push({
            faceName,
            faceID: receivingFaceIDByName.get(faceName) >>> 0,
            grid: buildFlatTriangleGrid(coords, tol),
        });
    }
    grids.sort((a, b) => a.faceName.localeCompare(b.faceName));

    let reassignedTriangles = 0;
    const reassignedByFace = new Map<string, number>();
    const triCount = Math.min(ids.length, (tv.length / 3) | 0);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
        if (!targetFaceIDs.has(ids[triIndex] >>> 0)) continue;
        let bestEntry = null;
        let bestDistanceSq = Infinity;
        for (const entry of grids) {
            let maxCornerDistSq = 0;
            for (let corner = 0; corner < 3; corner++) {
                const base = (tv[(triIndex * 3) + corner] >>> 0) * 3;
                const distSq = flatTriangleGridDistanceSq(
                    entry.grid,
                    Number(vp[base + 0]) || 0,
                    Number(vp[base + 1]) || 0,
                    Number(vp[base + 2]) || 0,
                    0,
                );
                if (distSq > maxCornerDistSq) maxCornerDistSq = distSq;
                if (maxCornerDistSq > tolSq) break;
            }
            if (maxCornerDistSq <= tolSq && maxCornerDistSq < bestDistanceSq) {
                bestDistanceSq = maxCornerDistSq;
                bestEntry = entry;
            }
        }
        if (!bestEntry) continue;
        ids[triIndex] = bestEntry.faceID;
        reassignedTriangles += 1;
        reassignedByFace.set(bestEntry.faceName, (reassignedByFace.get(bestEntry.faceName) || 0) + 1);
    }
    if (!reassignedTriangles) return { ...none, targetFaceCount: targetFaceIDs.size };

    solid._triIDs = ids;
    const removedFaceLabels = pruneUnusedFaceLabelsFromTriangles(solid);
    solid._faceIndex = null;
    solid._dirty = true;
    try { if (solid._manifold && typeof solid._manifold.delete === "function") solid._manifold.delete(); } catch { /* ignore */ }
    solid._manifold = null;
    solid._cppSolidCoreSyncStamp = null;

    return {
        reassignedTriangles,
        reassignedFaces: reassignedByFace.size,
        removedFaceLabels,
        targetFaceCount: targetFaceIDs.size,
        tolerance: tol,
        targets: Array.from(reassignedByFace.entries(), ([faceName, triangleCount]) => ({ faceName, triangleCount })),
    };
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

    const nodeEdges = new Map<any, any>();
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

function tagNativeTubeOuterFaces(solid, tubeName, featureId = "", radius = null) {
    if (!solid || typeof solid.setFaceMetadata !== "function") return 0;
    const outerFaceName = `${String(tubeName || "").trim() || "Tube"}_Outer`;
    const sourceFeatureId = String(featureId || "").trim();
    const pathName = `${String(tubeName || "").trim() || "Tube"}_PATH`;
    const radiusValue = Math.abs(Number(radius));
    const hasRadius = Number.isFinite(radiusValue) && radiusValue > 0;
    const faceNames = getSolidFaceNames(solid);
    let taggedCount = 0;
    for (const faceName of faceNames) {
        if (faceName !== outerFaceName) continue;
        const metadata = getFaceMetadataSafe(solid, faceName);
        try {
            solid.setFaceMetadata(faceName, {
                ...metadata,
                type: "rounded_pipe",
                faceRole: "rounded_pipe",
                offsetShellFaceRole: "rounded_pipe",
                offsetShellRoundedPipe: true,
                ...(sourceFeatureId ? { sourceFeatureId } : {}),
                ...(hasRadius ? {
                    radius: radiusValue,
                    inflatedRadius: radiusValue,
                    radiusOverride: radiusValue,
                    pmiRadiusOverride: radiusValue,
                    offsetShellRadius: radiusValue,
                } : {}),
                pathName,
                centerlineAuxName: pathName,
                pmiCenterlineAuxName: pathName,
            });
            taggedCount += 1;
        } catch {
            /* ignore individual metadata failures */
        }
    }
    return taggedCount;
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
    solid._auxEdges = cloneCenterlineAuxEdges(solid);
    try { solid.name = name || `${featureId}_RoundedPipe`; } catch { /* ignore */ }
    try { solid.owningFeatureID = featureId; } catch { /* ignore */ }
    tagNativeTubeOuterFaces(solid, name || `${featureId}_RoundedPipe`, featureId, radius);
    const triCount = Array.isArray(solid._triVerts) ? Math.floor(solid._triVerts.length / 3) : 0;
    return triCount > 0 ? solid : null;
}

function buildRoundedCornerPipeSolid(sourceSolid, edgeRecords, radius, options: any = {}) {
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

export function offsetShell(faces, distance, options: any = {}) {
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
    const originalSidewallAreas = new Map<any, any>();
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
            const thickenOptions: any = {
                featureId,
                name: featureId,
                skipTriangleSplit: true,
                mergeSourceStartCaps: true,
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
    let unionDiagnostics: any = {};
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

    const roundedCorners: any = {
        requested: offsetDistance < 0,
        status: offsetDistance < 0 ? "not_run" : "not_requested",
        radius: offsetDistance < 0 ? Math.abs(offsetDistance) : 0,
        separateTubeShellUnion: !!options?.debugSeparateRoundedCornerPipe,
        cleanupOptions: {
            areaLossDetectionEnabled: options?.roundedCornerAreaLossDetectionEnabled !== false,
            pipeSliverCollapseEnabled: options?.roundedCornerPipeSliverCollapseEnabled !== false,
            areaLossReassignEnabled: options?.roundedCornerAreaLossReassignEnabled !== false,
            rollbackEnabled: options?.roundedCornerCleanupRollbackEnabled !== false,
        },
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
        pipeRemainderBoundaryFaceTaggedCount: 0,
        pipeRemainderFaceNamesDeduplicated: false,
        shellFaceNamesDeduplicated: false,
        sidewallAreaLoss: null,
        pipeSliverCollapse: null,
        areaLossSidewallReassign: null,
        unionStrategy: "none",
        shellUnionStrategy: "none",
        firstError: null,
    };

    let roundedPipeCenterlines = [];
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
            if (roundedPipe) {
                roundedPipeCenterlines = cloneOffsetShellPipeCenterlineAuxEdges(roundedPipe, featureId);
                enrichOffsetShellRoundedPipeMetadata(roundedPipe, {
                    featureId,
                    radius: Math.abs(offsetDistance),
                });
            }
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
                // Keep only the generated tube centerlines; other temporary/source aux
                // records are restored from their owning solids separately.
                try { pipeOutsideSource._auxEdges = roundedPipeCenterlines.map((aux) => cloneAuxEdgeRecord(aux, { forceCenterline: true })).filter(Boolean); } catch { /* ignore */ }
                try { pipeOutsideSource._cppSolidCoreSyncStamp = null; } catch { /* ignore */ }
                try { pipeOutsideSource.name = `${newSolidName}_ROUND_PIPE_REMAINDER`; } catch { /* ignore */ }
                try { pipeOutsideSource.owningFeatureID = featureId; } catch { /* ignore */ }
                enrichOffsetShellRoundedPipeMetadata(pipeOutsideSource, {
                    featureId,
                    radius: Math.abs(offsetDistance),
                });
                roundedCorners.pipeRemainderBoundaryFaceTaggedCount = tagPipeRemainderBoundaryFaces(pipeOutsideSource, featureId);
                roundedCorners.pipeRemainderFaceNamesDeduplicated = deduplicateSolidFaceNames(pipeOutsideSource);
                roundedCorners.pipeRemainderFaceIDRepair = repairGeneratedFaceIDProvenance(pipeOutsideSource);
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
                            appendOffsetShellPipeCenterlines(combined, roundedPipeCenterlines);
                            enrichOffsetShellRoundedPipeMetadata(combined, {
                                featureId,
                                radius: Math.abs(offsetDistance),
                            });
                            roundedCorners.shellFaceNamesDeduplicated = deduplicateSolidFaceNames(combined);
                            const cleanupBaselineSnapshot = buildSolidAuthoringStateSnapshot(combined);
                            const cleanupBaselineTopology = analyzeSolidMeshTopology(combined);
                            const areaLossDetectionEnabled = options?.roundedCornerAreaLossDetectionEnabled !== false;
                            const pipeSliverCollapseEnabled = options?.roundedCornerPipeSliverCollapseEnabled !== false;
                            const areaLossReassignEnabled = options?.roundedCornerAreaLossReassignEnabled !== false;
                            const cleanupRollbackEnabled = options?.roundedCornerCleanupRollbackEnabled !== false;
                            const sidewallAreaLoss = areaLossDetectionEnabled
                                ? buildSidewallAreaLossCollapseTargets(combined, originalSidewallAreas, {
                                    areaLossThreshold: options?.roundedCornerSidewallAreaLossThreshold ?? 0.98,
                                    minOriginalArea: options?.roundedCornerSidewallAreaLossMinOriginalArea,
                                })
                                : {
                                    enabled: false,
                                    areaLossThreshold: options?.roundedCornerSidewallAreaLossThreshold ?? 0.98,
                                    originalSidewallAreaCount: originalSidewallAreas instanceof Map ? originalSidewallAreas.size : 0,
                                    finalSidewallAreaCount: 0,
                                    matchedSidewallAreaCount: 0,
                                    collapseTargetCount: 0,
                                    maxAreaLossRatio: 0,
                                    collapseFaceNames: [],
                                    targets: [],
                                };
                            const pipeSliverCollapseOptions: any = {
                                featureId,
                                radius: Math.abs(offsetDistance),
                                debug: options?.debugOffsetShellPipeSliverCollapse === true,
                                pipeSliverHeightTolerance: options?.roundedCornerPipeSliverHeightTolerance,
                            };
                            if (areaLossDetectionEnabled) {
                                pipeSliverCollapseOptions.collapseSidewallFaceNames = sidewallAreaLoss.collapseFaceNames;
                            }
                            let pipeSliverCollapse: any = pipeSliverCollapseEnabled
                                ? collapseOffsetShellRoundedPipeSlivers(combined, pipeSliverCollapseOptions)
                                : {
                                    enabled: false,
                                    collapsedPipeVertices: 0,
                                    collapsedPipeTriangles: 0,
                                    removedDegenerateTriangles: 0,
                                    areaLossTargetFaceCount: sidewallAreaLoss.collapseTargetCount || 0,
                                };
                            const collapseAfterTopology = analyzeSolidMeshTopology(combined);
                            const collapseManifoldCheck = checkSolidManifoldBuild(combined);
                            const rollbackPipeSliverCollapse = !cleanupRollbackEnabled || !pipeSliverCollapseEnabled
                                ? false
                                : shouldRollbackOffsetShellCleanup(collapseManifoldCheck);
                            if (rollbackPipeSliverCollapse) {
                                applySolidAuthoringStateSnapshot(combined, cleanupBaselineSnapshot);
                                combined._dirty = true;
                                combined._manifold = null;
                                combined._faceIndex = null;
                                combined._visualizeCache = null;
                                combined._cppSolidCoreSyncStamp = null;
                                const pipeSliverCollapseRollback = {
                                    rolledBack: true,
                                    reason: "pipe_sliver_collapse_failed_manifold_build",
                                    beforeTopology: cleanupBaselineTopology,
                                    afterTopology: collapseAfterTopology,
                                    manifoldCheck: collapseManifoldCheck,
                                };
                                pipeSliverCollapse = {
                                    ...(pipeSliverCollapse || {}),
                                    applied: false,
                                    ...pipeSliverCollapseRollback,
                                };
                            } else {
                                pipeSliverCollapse = {
                                    ...(pipeSliverCollapse || {}),
                                    applied: true,
                                    manifoldCheck: collapseManifoldCheck,
                                };
                            }
                            const allowRoundedPipeReassign = rollbackPipeSliverCollapse || !pipeSliverCollapseEnabled;
                            let areaLossSidewallReassign: any = areaLossReassignEnabled && areaLossDetectionEnabled
                                ? reassignAreaLossSidewallFacesToDominantNeighbor(combined, {
                                    featureId,
                                    debug: options?.debugOffsetShellPipeSliverCollapse === true,
                                    collapseSidewallFaceNames: sidewallAreaLoss.collapseFaceNames,
                                    protectedNeighborFaceNames: selectedFaceNames,
                                    allowRoundedPipeNeighbors: allowRoundedPipeReassign,
                                    preferRoundedPipeNeighbors: allowRoundedPipeReassign,
                                })
                                : {
                                    enabled: false,
                                    reassignedTriangles: 0,
                                    reassignedFaces: 0,
                                    removedFaceLabels: 0,
                                    targetFaceCount: sidewallAreaLoss.collapseTargetCount || 0,
                                    reason: areaLossDetectionEnabled ? "disabled" : "area_loss_detection_disabled",
                                };
                            const cleanupAfterTopology = analyzeSolidMeshTopology(combined);
                            const cleanupManifoldCheck = checkSolidManifoldBuild(combined);
                            const rollbackCleanup = !cleanupRollbackEnabled
                                ? false
                                : shouldRollbackOffsetShellCleanup(cleanupManifoldCheck);
                            if (rollbackCleanup) {
                                applySolidAuthoringStateSnapshot(combined, cleanupBaselineSnapshot);
                                combined._dirty = true;
                                combined._manifold = null;
                                combined._faceIndex = null;
                                combined._visualizeCache = null;
                                combined._cppSolidCoreSyncStamp = null;
                                const cleanupRollback = {
                                    rolledBack: true,
                                    reason: "cleanup_failed_manifold_build",
                                    beforeTopology: cleanupBaselineTopology,
                                    afterTopology: cleanupAfterTopology,
                                    manifoldCheck: cleanupManifoldCheck,
                                };
                                pipeSliverCollapse = {
                                    ...(pipeSliverCollapse || {}),
                                    applied: false,
                                    ...cleanupRollback,
                                };
                                areaLossSidewallReassign = {
                                    ...(areaLossSidewallReassign || {}),
                                    applied: false,
                                    ...cleanupRollback,
                                };
                                roundedCorners.cleanupRollback = cleanupRollback;
                            } else {
                                areaLossSidewallReassign = {
                                    ...(areaLossSidewallReassign || {}),
                                    applied: areaLossReassignEnabled && areaLossDetectionEnabled,
                                    manifoldCheck: cleanupManifoldCheck,
                                    allowRoundedPipeNeighbors: allowRoundedPipeReassign,
                                    preferRoundedPipeNeighbors: allowRoundedPipeReassign,
                                };
                                roundedCorners.cleanupRollback = null;
                            }
                            roundedCorners.sidewallAreaLoss = sidewallAreaLoss;
                            roundedCorners.pipeSliverCollapse = pipeSliverCollapse;
                            roundedCorners.areaLossSidewallReassign = areaLossSidewallReassign;
                            appendOffsetShellPipeCenterlines(combined, roundedPipeCenterlines);
                            enrichOffsetShellRoundedPipeMetadata(combined, {
                                featureId,
                                radius: Math.abs(offsetDistance),
                            });
                            roundedCorners.pipeSliverCollapseCount = (rollbackCleanup || rollbackPipeSliverCollapse)
                                ? 0
                                : Number(pipeSliverCollapse?.collapsedPipeVertices || 0);
                            roundedCorners.pipeSliverCollapseRemovedDegenerateTriangles = (rollbackCleanup || rollbackPipeSliverCollapse)
                                ? 0
                                : Number(pipeSliverCollapse?.removedDegenerateTriangles || 0);
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

    const coincidentSidewallReassign = reassignSidewallTrianglesCoincidentWithSourceFaces(
        combined,
        this,
        thickenedFaceNames,
        { thickenDistance },
    );
    const faceIDRepair = repairGeneratedFaceIDProvenance(combined);
    if (offsetDistance < 0) {
        appendOffsetShellPipeCenterlines(combined, roundedPipeCenterlines);
        enrichOffsetShellRoundedPipeMetadata(combined, {
            featureId,
            radius: Math.abs(offsetDistance),
        });
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
        coincidentSidewallReassign,
        faceIDRepair,
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
                faceIDRepair,
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

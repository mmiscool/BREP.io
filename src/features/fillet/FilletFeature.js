import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";
import { runSheetMetalCornerFillet } from "../sheetMetal/sheetMetalEngineBridge.js";
import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
} from "../../BREP/CppSolidCore.js";
import { cleanupFilletSingleNeighborIslands } from "../../BREP/SolidMethods/fillet.js";

const DEBUG_MODE_NONE = "NONE";
const DEBUG_MODE_WEDGE_AND_TUBE = "WEDGE AND TUBE";
const DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN = "WEDGE AND TUBE AFTER BOOLEAN";
const DEBUG_MODE_COMBINED_BEFORE_TARGET = "COMBINED FILLET BEFORE TARGET BOOLEAN";
const FINAL_FILLET_SIMPLIFY_TOLERANCE = 0.0009;
const FILLET_NATIVE_TINY_FACE_ISLAND_CLEANUP_AREA = 0.01;
const FILLET_POST_COLLAPSE_TINY_TRIANGLE_THRESHOLD = 0.001;
const FILLET_POST_COLLAPSE_TINY_FACE_ISLAND_CLEANUP_AREA = 0.01;
const FILLET_CACHE_VERSION = 2;

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the fillet feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["FACE", "EDGE"],
        multiple: true,
        default_value: null,
        hint: "Select faces (or an edge) to fillet along shared edges",
    },
    radius: {
        type: "number",
        step: 0.1,
        default_value: 1,
        hint: "Fillet radius",
    },
    resolution: {
        type: "number",
        step: 1,
        default_value: "resolution",
        hint: "Segments around the fillet tube circumference",
    },
    inflate: {
        type: "number",
        step: 0.1,
        default_value: 0.1,
        hint: "Grow the cutting solid by this amount (units). Keep tiny (e.g. 0.0005). Closed loops ignore inflation to avoid self‑intersection.",
    },
    nudgeFaceDistance: {
        type: "number",
        step: 0.0001,
        default_value: 0.0001,
        hint: "Push fillet wedge end caps outward by this amount before booleaning (0 disables).",
    },
    collapseFilletSideWalls: {
        type: "boolean",
        default_value: true,
        hint: "Collapse deterministic fillet side-wall faces so adjacent faces meet directly.",
    },
    renameFaces: {
        type: "boolean",
        default_value: true,
        hint: "Allow fillet cleanup to rename/relabel generated faces.",
    },
    direction: {
        type: "options",
        options: ["AUTO", "INSET", "OUTSET"],
        default_value: "AUTO",
        hint: "AUTO classifies each selected edge as inside/outside and applies subtract/union automatically.",
    },
    debug: {
        type: "options",
        options: [
            DEBUG_MODE_NONE,
            DEBUG_MODE_WEDGE_AND_TUBE,
            DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN,
            DEBUG_MODE_COMBINED_BEFORE_TARGET,
        ],
        default_value: DEBUG_MODE_NONE,
        hint: "Controls which fillet debug solids are emitted.",
    },
};

function resolveDebugMode(rawValue) {
    const normalized = String(rawValue).trim().toUpperCase();
    if (normalized === DEBUG_MODE_NONE) return DEBUG_MODE_NONE;
    if (normalized === DEBUG_MODE_WEDGE_AND_TUBE) return DEBUG_MODE_WEDGE_AND_TUBE;
    if (normalized === DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN) {
        return DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN;
    }
    if (normalized === DEBUG_MODE_COMBINED_BEFORE_TARGET) {
        return DEBUG_MODE_COMBINED_BEFORE_TARGET;
    }
    return DEBUG_MODE_NONE;
}

function getDebugConfig(debugMode) {
    if (debugMode === DEBUG_MODE_WEDGE_AND_TUBE) {
        return { enabled: true, solidsLevel: 0, showCombinedBeforeTarget: false };
    }
    if (debugMode === DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN) {
        return { enabled: true, solidsLevel: 1, showCombinedBeforeTarget: false };
    }
    if (debugMode === DEBUG_MODE_COMBINED_BEFORE_TARGET) {
        return { enabled: true, solidsLevel: -1, showCombinedBeforeTarget: true };
    }
    return { enabled: false, solidsLevel: -1, showCombinedBeforeTarget: false };
}

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function createFilletProfiler(featureID) {
    const steps = [];
    const starts = new Map();
    const totalStart = nowMs();
    const start = (name) => {
        starts.set(name, nowMs());
    };
    const end = (name, extra = null) => {
        const startedAt = starts.get(name);
        if (!Number.isFinite(startedAt)) return;
        starts.delete(name);
        const entry = {
            name,
            ms: Number((nowMs() - startedAt).toFixed(3)),
        };
        if (extra && typeof extra === 'object') entry.extra = extra;
        steps.push(entry);
    };
    const instant = (name, startedAt, extra = null) => {
        const entry = {
            name,
            ms: Number((nowMs() - startedAt).toFixed(3)),
        };
        if (extra && typeof extra === 'object') entry.extra = extra;
        steps.push(entry);
    };
    const finish = (extra = null) => ({
        featureID: featureID || null,
        totalMs: Number((nowMs() - totalStart).toFixed(3)),
        steps,
        ...(extra && typeof extra === 'object' ? extra : {}),
    });
    return { start, end, instant, finish };
}

function stableStringHash32(value = '') {
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function appendHashToken(parts, value) {
    if (typeof value === 'number') {
        if (Number.isFinite(value)) parts.push(Number(value).toPrecision(12));
        else parts.push('NaN');
        return;
    }
    if (Array.isArray(value)) {
        parts.push('[');
        for (const item of value) appendHashToken(parts, item);
        parts.push(']');
        return;
    }
    if (value && typeof value === 'object') {
        parts.push('{');
        for (const key of Object.keys(value).sort()) {
            parts.push(key);
            appendHashToken(parts, value[key]);
        }
        parts.push('}');
        return;
    }
    parts.push(String(value));
}

function stableValueHash(value) {
    const parts = [];
    appendHashToken(parts, value);
    return stableStringHash32(parts.join('|'));
}

function cloneAuthoringSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    return {
        numProp: Number(snapshot.numProp ?? 3),
        vertProperties: Array.from(snapshot.vertProperties ?? []),
        triVerts: Array.from(snapshot.triVerts ?? []),
        triIDs: Array.from(snapshot.triIDs ?? []),
        faceNameToID: Array.from(snapshot.faceNameToID ?? [], (entry) => [entry?.[0], entry?.[1]]),
        idToFaceName: Array.from(snapshot.idToFaceName ?? [], (entry) => [entry?.[0], entry?.[1]]),
        faceMetadataJson: Array.from(snapshot.faceMetadataJson ?? [], (entry) => [entry?.[0], entry?.[1]]),
        edgeMetadataJson: Array.from(snapshot.edgeMetadataJson ?? [], (entry) => [entry?.[0], entry?.[1]]),
        auxEdges: Array.from(snapshot.auxEdges ?? [], (entry) => ({
            ...entry,
            points: Array.from(entry?.points ?? [], (point) => Array.from(point ?? [])),
        })),
    };
}

function solidFromCachedSnapshot(snapshot, SolidClass, name = null) {
    const cloned = cloneAuthoringSnapshot(snapshot);
    if (!cloned || !SolidClass) return null;
    const solid = new SolidClass();
    applySolidAuthoringStateSnapshot(solid, cloned);
    solid._dirty = true;
    solid._manifold = null;
    solid._faceIndex = null;
    if (typeof name === 'string' && name) {
        try { solid.name = name; } catch { /* ignore */ }
    }
    return solid;
}

function getEdgeFaceNamesForCache(edgeObj) {
    const faceAName = edgeObj?.faces?.[0]?.name || edgeObj?.userData?.faceA || null;
    const faceBName = edgeObj?.faces?.[1]?.name || edgeObj?.userData?.faceB || null;
    return { faceAName, faceBName };
}

function hashFaceState(solid, faceName) {
    if (!solid || !faceName) return null;
    let triangles = null;
    try {
        triangles = typeof solid.getFace === 'function' ? solid.getFace(faceName) : null;
    } catch {
        triangles = null;
    }
    let metadata = null;
    try {
        metadata = typeof solid.getFaceMetadata === 'function' ? solid.getFaceMetadata(faceName) : null;
    } catch {
        metadata = null;
    }
    return stableValueHash({
        faceName,
        triangles: Array.isArray(triangles) ? triangles : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
}

function buildFilletEdgeDependencySignature(edge, targetSolid) {
    const edgeName = typeof edge?.name === 'string' ? edge.name : '';
    const edgePolyline = Array.isArray(edge?.userData?.polylineLocal) ? edge.userData.polylineLocal : [];
    const { faceAName, faceBName } = getEdgeFaceNamesForCache(edge);
    return {
        edgeName,
        edgeHash: stableValueHash({
            name: edgeName,
            polyline: edgePolyline,
            closedLoop: !!(edge?.closedLoop || edge?.userData?.closedLoop),
        }),
        faceAName,
        faceAHash: hashFaceState(targetSolid, faceAName),
        faceBName,
        faceBHash: hashFaceState(targetSolid, faceBName),
    };
}

function buildFilletCacheKey({
    targetSolid,
    edgeObjs,
    radius,
    resolution,
    direction,
    inflate,
    nudgeFaceDistance,
    collapseFilletSideWalls,
}) {
    const edgeSignatures = (Array.isArray(edgeObjs) ? edgeObjs : [])
        .map((edge) => buildFilletEdgeDependencySignature(edge, targetSolid));
    return {
        version: FILLET_CACHE_VERSION,
        targetName: targetSolid?.name || null,
        optionsHash: stableValueHash({
            radius,
            resolution,
            direction,
            inflate,
            nudgeFaceDistance,
            collapseFilletSideWalls,
        }),
        edgeSignatures,
        dependencyHash: stableValueHash(edgeSignatures),
    };
}

function filletCacheMatches(cacheEntry, cacheKey) {
    return !!cacheEntry
        && cacheEntry.version === FILLET_CACHE_VERSION
        && cacheEntry.optionsHash === cacheKey.optionsHash
        && cacheEntry.dependencyHash === cacheKey.dependencyHash
        && Array.isArray(cacheEntry.edgeSignatures)
        && cacheEntry.edgeSignatures.length === cacheKey.edgeSignatures.length;
}

function normalizeSelectionToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    return raw.replace(/\[\d+\]$/, '');
}

function getSelectionTokenIndex(token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const match = raw.match(/\[(\d+)\]$/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) ? value : null;
}

function splitSelectionToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return [];
    return raw.includes('|') ? raw.split('|') : [raw];
}

function isEdgeObject(obj) {
    return String(obj?.type || '').toUpperCase() === 'EDGE';
}

function isFaceObject(obj) {
    const type = String(obj?.type || '').toUpperCase();
    return type === 'FACE' || type === 'PLANE';
}

function uniqueObjects(items) {
    const out = [];
    const seen = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
    }
    return out;
}

function collectEdgesForReferenceObject(obj) {
    if (!obj || typeof obj !== 'object') return [];
    if (isEdgeObject(obj)) return [obj];
    if (!isFaceObject(obj)) return [];

    if (Array.isArray(obj.edges) && obj.edges.length) {
        return uniqueObjects(obj.edges.filter((edge) => isEdgeObject(edge) && (edge.parentSolid || edge.parent)));
    }

    const faceName = typeof obj?.name === 'string' && obj.name ? obj.name : obj?.userData?.faceName;
    const parentSolid = obj?.parentSolid || obj?.parent || null;
    if (!faceName || !Array.isArray(parentSolid?.children)) return [];

    const out = [];
    for (const child of parentSolid.children) {
        if (!isEdgeObject(child) || !(child.parentSolid || child.parent)) continue;
        const faceA = child?.userData?.faceA || null;
        const faceB = child?.userData?.faceB || null;
        if (faceA === faceName || faceB === faceName) out.push(child);
    }
    return uniqueObjects(out);
}

function collectSharedEdgesFromResolvedSelections(resolvedSelections) {
    const edgeLists = (Array.isArray(resolvedSelections) ? resolvedSelections : [])
        .map((selection) => collectEdgesForReferenceObject(selection))
        .filter((edges) => edges.length > 0);
    if (edgeLists.length < 2) return [];

    let shared = edgeLists[0].slice();
    for (let i = 1; i < edgeLists.length; i += 1) {
        const current = new Set(edgeLists[i]);
        shared = shared.filter((edge) => current.has(edge));
        if (!shared.length) break;
    }
    return uniqueObjects(shared);
}

function collectCandidateEdgesFromResolvedSelections(resolvedSelections) {
    const out = [];
    for (const selection of (Array.isArray(resolvedSelections) ? resolvedSelections : [])) {
        out.push(...collectEdgesForReferenceObject(selection));
    }
    return uniqueObjects(out);
}

function extractEdgeWorldPositions(edge) {
    if (!isEdgeObject(edge)) return [];
    try { edge.updateMatrixWorld?.(true); } catch { /* ignore */ }
    try {
        if (typeof edge.points === 'function') {
            const points = edge.points(true);
            if (Array.isArray(points) && points.length) {
                const flat = [];
                for (const point of points) {
                    const x = Number(point?.x);
                    const y = Number(point?.y);
                    const z = Number(point?.z);
                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
                    flat.push(x, y, z);
                }
                if (flat.length >= 6) return flat;
            }
        }
    } catch { /* ignore */ }
    return [];
}

function sampleFlatPositions(flatPositions, sampleCount = 12) {
    if (!Array.isArray(flatPositions) || flatPositions.length < 6) return [];
    const points = [];
    for (let i = 0; i + 2 < flatPositions.length; i += 3) {
        const x = Number(flatPositions[i]);
        const y = Number(flatPositions[i + 1]);
        const z = Number(flatPositions[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        points.push([x, y, z]);
    }
    if (points.length <= sampleCount) return points;

    const sampled = [];
    for (let i = 0; i < sampleCount; i += 1) {
        const index = Math.round(i * (points.length - 1) / Math.max(1, sampleCount - 1));
        sampled.push(points[index]);
    }
    return sampled;
}

function distanceBetweenPoints(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Infinity;
    const dx = Number(a[0]) - Number(b[0]);
    const dy = Number(a[1]) - Number(b[1]);
    const dz = Number(a[2]) - Number(b[2]);
    return Math.hypot(dx, dy, dz);
}

function averagePolylineDistance(sourcePoints, targetPoints, reverse = false) {
    if (!Array.isArray(sourcePoints) || !Array.isArray(targetPoints) || !sourcePoints.length || !targetPoints.length) {
        return Infinity;
    }
    let total = 0;
    for (let i = 0; i < sourcePoints.length; i += 1) {
        const targetIndex = Math.round(i * (targetPoints.length - 1) / Math.max(1, sourcePoints.length - 1));
        const targetPoint = reverse
            ? targetPoints[targetPoints.length - 1 - targetIndex]
            : targetPoints[targetIndex];
        total += distanceBetweenPoints(sourcePoints[i], targetPoint);
    }
    return total / sourcePoints.length;
}

function edgeMatchScore(snapshotPositions, edge) {
    const snapshotPoints = sampleFlatPositions(snapshotPositions);
    const edgePoints = sampleFlatPositions(extractEdgeWorldPositions(edge));
    if (snapshotPoints.length < 2 || edgePoints.length < 2) return Infinity;

    const forward = averagePolylineDistance(snapshotPoints, edgePoints, false);
    const reverse = averagePolylineDistance(snapshotPoints, edgePoints, true);
    const endpointForward = (
        distanceBetweenPoints(snapshotPoints[0], edgePoints[0])
        + distanceBetweenPoints(snapshotPoints[snapshotPoints.length - 1], edgePoints[edgePoints.length - 1])
    ) / 2;
    const endpointReverse = (
        distanceBetweenPoints(snapshotPoints[0], edgePoints[edgePoints.length - 1])
        + distanceBetweenPoints(snapshotPoints[snapshotPoints.length - 1], edgePoints[0])
    ) / 2;

    return Math.min(forward + (endpointForward * 0.5), reverse + (endpointReverse * 0.5));
}

function candidateEdgeIndex(edge) {
    const name = typeof edge?.name === 'string' ? edge.name : '';
    const match = name.match(/\[(\d+)\]$/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) ? value : null;
}

function findBestEdgeMatch(snapshotPositions, candidateEdges, preferredIndex = null) {
    if (!Array.isArray(snapshotPositions) || snapshotPositions.length < 6) return null;
    let bestEdge = null;
    let bestScore = Infinity;
    let bestIndexDelta = Infinity;

    for (const edge of uniqueObjects(candidateEdges)) {
        const score = edgeMatchScore(snapshotPositions, edge);
        if (!Number.isFinite(score)) continue;
        const edgeIndex = candidateEdgeIndex(edge);
        const indexDelta = (preferredIndex == null || edgeIndex == null)
            ? Infinity
            : Math.abs(edgeIndex - preferredIndex);
        if (
            score < bestScore
            || (Math.abs(score - bestScore) <= 1e-9 && indexDelta < bestIndexDelta)
        ) {
            bestScore = score;
            bestIndexDelta = indexDelta;
            bestEdge = edge;
        }
    }

    return bestEdge;
}

function resolveReferenceSelectionSnapshot(snapshotStore, token) {
    if (!snapshotStore || typeof snapshotStore !== 'object') return null;
    const raw = String(token || '').trim();
    if (!raw) return null;
    if (snapshotStore[raw] && typeof snapshotStore[raw] === 'object') return snapshotStore[raw];
    const normalized = normalizeSelectionToken(raw);
    if (normalized && snapshotStore[normalized] && typeof snapshotStore[normalized] === 'object') {
        return snapshotStore[normalized];
    }
    return null;
}

function expandReferenceSelections(rawSelections, partHistory, snapshotStore = null) {
    const out = [];
    const seenObjects = new Set();
    const unresolved = [];
    const pushObject = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (seenObjects.has(obj)) return;
        seenObjects.add(obj);
        out.push(obj);
    };

    const resolveByName = (name) => {
        if (!name || typeof partHistory?.getObjectByName !== 'function') return null;
        try {
            return partHistory.getObjectByName(name) || null;
        } catch {
            return null;
        }
    };
    const resolveExactSelection = (text) => {
        const direct = resolveByName(text);
        if (direct) return direct;
        const normalized = normalizeSelectionToken(text);
        if (!normalized || normalized === text) return null;
        return resolveByName(normalized);
    };

    for (const item of (Array.isArray(rawSelections) ? rawSelections : [])) {
        if (!item) continue;
        if (typeof item === 'object') {
            pushObject(item);
            continue;
        }
        const text = String(item || '').trim();
        if (!text) continue;
        const exact = resolveExactSelection(text);
        if (exact) {
            pushObject(exact);
            continue;
        }

        const segments = splitSelectionToken(text);
        const resolvedSegments = [];
        const segmentUnresolved = [];
        for (const segment of segments) {
            const normalized = normalizeSelectionToken(segment);
            if (!normalized) continue;
            const obj = resolveByName(normalized);
            if (obj) resolvedSegments.push(obj);
            else segmentUnresolved.push(normalized);
        }

        const preferredIndex = getSelectionTokenIndex(text);
        const snapshot = resolveReferenceSelectionSnapshot(snapshotStore, text);
        const sharedEdges = collectSharedEdgesFromResolvedSelections(resolvedSegments);
        if (sharedEdges.length === 1) {
            pushObject(sharedEdges[0]);
            continue;
        }
        if (sharedEdges.length > 1) {
            const matchedEdge = findBestEdgeMatch(snapshot?.positions, sharedEdges, preferredIndex);
            if (matchedEdge) {
                pushObject(matchedEdge);
                continue;
            }
            for (const edge of sharedEdges) pushObject(edge);
            continue;
        }

        const candidateEdges = collectCandidateEdgesFromResolvedSelections(resolvedSegments);
        const matchedEdge = findBestEdgeMatch(snapshot?.positions, candidateEdges, preferredIndex);
        if (matchedEdge) {
            pushObject(matchedEdge);
            continue;
        }

        if (resolvedSegments.length) {
            for (const obj of resolvedSegments) pushObject(obj);
        }
        unresolved.push(...segmentUnresolved);
    }

    return { selections: out, unresolved };
}

function resolveSheetMetalCarrierFromSelections(rawSelections, partHistory) {
    const resolveByName = (name) => {
        if (!name || typeof partHistory?.getObjectByName !== 'function') return null;
        try {
            return partHistory.getObjectByName(name) || null;
        } catch {
            return null;
        }
    };
    const isSheetCarrier = (obj) => !!obj?.userData?.sheetMetalModel?.tree;

    const tokens = [];
    const collectTokens = (value) => {
        if (value == null) return;
        const text = String(value || '').trim();
        if (!text) return;
        const pieces = text.includes('|') ? text.split('|') : [text];
        for (const piece of pieces) {
            const normalized = normalizeSelectionToken(piece);
            if (!normalized) continue;
            tokens.push(normalized);
        }
    };
    const selections = Array.isArray(rawSelections) ? rawSelections : [];
    for (const item of selections) {
        if (item && typeof item === 'object') {
            const direct = item?.parentSolid;
            if (isSheetCarrier(direct)) return direct;
            let current = item;
            while (current && typeof current === 'object') {
                if (isSheetCarrier(current)) return current;
                current = current.parent || null;
            }
            collectTokens(item?.name);
            collectTokens(item?.userData?.edgeName);
            collectTokens(item?.userData?.faceName);
            continue;
        }
        if (typeof item !== 'string') continue;
        collectTokens(item);
    }

    for (const token of tokens) {
        const marker = ':FLAT:';
        const markerIndex = token.indexOf(marker);
        if (markerIndex <= 0) continue;
        const carrierName = token.slice(0, markerIndex);
        const resolved = resolveByName(carrierName);
        if (isSheetCarrier(resolved)) return resolved;
    }

    const scene = partHistory?.scene;
    if (scene && typeof scene.traverse === 'function') {
        const carriers = [];
        scene.traverse((obj) => {
            if (isSheetCarrier(obj)) carriers.push(obj);
        });
        if (carriers.length === 1) return carriers[0];
    }
    return null;
}

export class FilletFeature {
    static shortName = "F";
    static longName = "Fillet";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const edges = items
            .filter((it) => {
                const type = String(it?.type || '').toUpperCase();
                return type === 'EDGE' || type === 'FACE';
            })
            .map((it) => it?.name || it?.userData?.edgeName || it?.userData?.faceName)
            .filter((name) => !!name);
        if (!edges.length) return false;
        return { params: { edges } };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    uiFieldsTest() {
        return [];
    }

    async run(partHistory) {
        const fid = this.inputParams.featureID;
        const profiler = createFilletProfiler(fid);
        const debugMode = resolveDebugMode(this.inputParams?.debug);
        const debugConfig = getDebugConfig(debugMode);
        const debugEnabled = !!debugConfig.enabled;
        const configuredDebugLevel = Number(debugConfig.solidsLevel);
        const debugShowCombinedBeforeTarget = !!debugConfig.showCombinedBeforeTarget;
        console.log('[FilletFeature] Starting fillet run...', {
            featureID: this.inputParams?.featureID,
            direction: this.inputParams?.direction,
            radius: this.inputParams?.radius,
            resolution: this.inputParams?.resolution,
            inflate: this.inputParams?.inflate,
            nudgeFaceDistance: this.inputParams?.nudgeFaceDistance,
            debug: debugEnabled,
            debugMode,
            debugSolidsLevel: configuredDebugLevel,
            debugShowCombinedBeforeTarget,
        });
        const added = [];
        const removed = [];

        // Resolve inputs from sanitizeInputParams()
        profiler.start('resolve inputs');
        const rawInputSelections = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const previewSnapshots = this.persistentData?.__refPreviewSnapshots?.edges || null;
        const expanded = expandReferenceSelections(rawInputSelections, partHistory, previewSnapshots);
        const inputObjects = expanded.selections;
        const edgeObjs = collectEdgesFromSelection(inputObjects);
        const sheetCarrierFromRefs = resolveSheetMetalCarrierFromSelections(rawInputSelections, partHistory);
        profiler.end('resolve inputs', {
            rawSelections: rawInputSelections.length,
            resolvedSelections: inputObjects.length,
            edges: edgeObjs.length,
        });

        profiler.start('resolve target solid');
        let { solid: targetSolid, solids } = resolveSingleSolidFromEdges(edgeObjs);
        if (sheetCarrierFromRefs) {
            targetSolid = sheetCarrierFromRefs;
            solids = new Set([sheetCarrierFromRefs]);
        } else if (!targetSolid) {
            targetSolid = null;
        }
        if (!targetSolid) {
            if (solids.size > 1) {
                console.warn('[FilletFeature] Edges reference multiple solids; aborting fillet.', { solids: Array.from(solids).map(s => s?.name) });
            } else {
                console.warn('[FilletFeature] Edges do not reference a target solid; aborting fillet.', {
                    unresolvedRefs: expanded.unresolved,
                    rawSelectionCount: rawInputSelections.length,
                });
            }
            const profile = profiler.finish({ cacheStatus: 'abort:no-target' });
            this.persistentData = {
                ...(this.persistentData || {}),
                filletProfiler: profile,
            };
            console.log('[FilletFeature] Profile', profile);
            return { added: [], removed: [] };
        }
        profiler.end('resolve target solid', { target: targetSolid?.name || null });
        console.log('[FilletFeature] Target solid resolved', {
            name: targetSolid?.name,
            edgeCount: edgeObjs.length,
            edgeNames: edgeObjs.map(e => e?.name).filter(Boolean),
        });

        const dir = String(this.inputParams.direction || 'AUTO').toUpperCase();
        const r = Number(this.inputParams.radius);
        if (!Number.isFinite(r) || !(r > 0)) {
            console.warn('[FilletFeature] Invalid radius supplied; aborting.', { radius: this.inputParams.radius });
            const profile = profiler.finish({ cacheStatus: 'abort:invalid-radius' });
            this.persistentData = {
                ...(this.persistentData || {}),
                filletProfiler: profile,
            };
            console.log('[FilletFeature] Profile', profile);
            return { added: [], removed: [] };
        }

        const isSheetMetalCarrier = !!targetSolid?.userData?.sheetMetalModel?.tree;
        if (isSheetMetalCarrier) {
            profiler.start('sheet metal fillet');
            const sheetResult = runSheetMetalCornerFillet({
                sourceCarrier: targetSolid,
                selections: rawInputSelections,
                edgeSelections: edgeObjs,
                radius: r,
                resolution: this.inputParams?.resolution,
                featureID: fid || "SM_FILLET",
                showFlatPattern: true,
            });
            this.persistentData = {
                ...(this.persistentData || {}),
                sheetMetalFilletSummary: sheetResult?.summary || null,
                usedSheetMetalPath: true,
            };
            if (sheetResult?.root) {
                console.log('[FilletFeature] Sheet-metal corner fillet applied; replacing target solid.', {
                    featureID: fid,
                    appliedTargets: sheetResult?.summary?.applied || 0,
                    appliedCorners: sheetResult?.summary?.appliedCorners || 0,
                });
                added.push(sheetResult.root);
                removed.push(targetSolid);
            } else {
                console.warn('[FilletFeature] Sheet-metal corner fillet produced no changes.', {
                    featureID: fid,
                    summary: sheetResult?.summary || null,
                });
            }
            profiler.end('sheet metal fillet', { applied: sheetResult?.summary?.applied || 0 });
            const profile = profiler.finish({ cacheStatus: 'sheet-metal' });
            this.persistentData = {
                ...(this.persistentData || {}),
                filletProfiler: profile,
            };
            console.log('[FilletFeature] Profile', profile);
            return { added, removed };
        }

        let result = null;
        const collapseFilletSideWalls = this.inputParams?.collapseFilletSideWalls !== false;
        const renameFaces = this.inputParams?.renameFaces !== false;
        const inflate = Number(this.inputParams.inflate) || 0;
        const nudgeFaceDistance = this.inputParams?.nudgeFaceDistance;
        profiler.start('build dependency signature');
        const cacheKey = buildFilletCacheKey({
            targetSolid,
            edgeObjs,
            radius: r,
            resolution: this.inputParams?.resolution,
            direction: dir,
            inflate,
            nudgeFaceDistance,
            collapseFilletSideWalls,
        });
        profiler.end('build dependency signature', { edges: cacheKey.edgeSignatures.length });
        const cacheEntry = this.persistentData?.filletSolidCache || null;
        const hasCachedDebugSnapshots = Array.isArray(cacheEntry?.debugSnapshots) && cacheEntry.debugSnapshots.length > 0;
        const debugCacheMatches = hasCachedDebugSnapshots && cacheEntry?.debugMode === debugMode;
        const cacheHit = filletCacheMatches(cacheEntry, cacheKey) && (!debugEnabled || debugCacheMatches);
        const SolidClass = targetSolid?.constructor?.BaseSolid || targetSolid?.constructor || null;
        if (cacheHit) {
            profiler.start('restore cached solid');
            result = solidFromCachedSnapshot(cacheEntry?.finalSnapshot, SolidClass, targetSolid?.name || `${fid}_FINAL_FILLET`);
            if (result && cacheEntry?.edgeDirectionDecision) {
                try { result.__filletDirectionDecision = cacheEntry.edgeDirectionDecision; } catch { /* ignore */ }
            }
            if (result && Number.isFinite(Number(cacheEntry?.cornerBridgeCount))) {
                try { result.__filletCornerBridgeCount = Number(cacheEntry.cornerBridgeCount); } catch { /* ignore */ }
            }
            if (debugEnabled && result && debugCacheMatches) {
                const debugAdded = [];
                for (const entry of cacheEntry.debugSnapshots) {
                    const debugSolid = solidFromCachedSnapshot(entry?.snapshot, SolidClass, String(entry?.name || 'FILLET_DEBUG'));
                    if (debugSolid) debugAdded.push(debugSolid);
                }
                if (debugAdded.length > 0) {
                    try { result.__debugAddedSolids = debugAdded; } catch { /* ignore */ }
                }
            }
            profiler.end('restore cached solid', {
                debugSnapshots: Array.isArray(cacheEntry?.debugSnapshots) ? cacheEntry.debugSnapshots.length : 0,
            });
            console.log('[FilletFeature] Reused cached fillet solid.', {
                featureID: fid,
                edges: edgeObjs.length,
                debugMode,
                renameFacesRequested: renameFaces,
                cachedRenameFaces: cacheEntry?.renameFaces,
            });
        }
        if (!result) {
            profiler.start('native fillet build');
            result = await targetSolid.fillet({
                radius: r,
                resolution: this.inputParams?.resolution,
                edges: edgeObjs,
                featureID: fid,
                direction: dir,
                inflate,
                nudgeFaceDistance,
                cleanupTinyFaceIslandsArea: FILLET_NATIVE_TINY_FACE_ISLAND_CLEANUP_AREA,
                mergeCoplanarEndCaps: true,
                renameFaces,
                reassignSliverTriangles: true,
                collapseFilletSideWalls,
                debug: debugEnabled,
                debugSolidsLevel: configuredDebugLevel,
                debugShowCombinedBeforeTarget,
            });
            profiler.end('native fillet build', { cacheMiss: true });
        }
        try {
            result.__filletFinalSimplifyEnabled = true;
            result.__filletNativeTinyFaceIslandCleanupEnabled = true;
            result.__filletSideWallCollapseEnabled = collapseFilletSideWalls;
            result.__filletPostCollapseTinyTriangleCollapseEnabled = true;
            result.__filletPostCollapseTinyFaceIslandCleanupEnabled = true;
        } catch { }
        const collectDebugSolids = (res) => {
            const out = [];
            if (!Array.isArray(res?.__debugAddedSolids)) return out;
            for (const dbg of res.__debugAddedSolids) {
                if (!dbg) continue;
                try {
                    const rawName = String(dbg.name || 'DEBUG');
                    dbg.name = rawName.startsWith(`${fid}_`) ? rawName : `${fid}_${rawName}`;
                } catch { }
                console.log('[FilletFeature] Adding fillet debug solid', { featureID: fid, name: dbg.name });
                out.push(dbg);
            }
            return out;
        };
        profiler.start('collect debug solids');
        const debugSolids = collectDebugSolids(result);
        profiler.end('collect debug solids', { debugSolids: debugSolids.length });
        const edgeDirectionDecision = result?.__filletDirectionDecision || null;
        const cornerBridgeCountRaw = Number(result?.__filletCornerBridgeCount);
        const cornerBridgeCount = Number.isFinite(cornerBridgeCountRaw) ? Math.max(0, Math.trunc(cornerBridgeCountRaw)) : 0;
        this.persistentData = {
            ...(this.persistentData || {}),
            edgeDirectionDecision,
            miterSummary: {
                ...(this.persistentData?.miterSummary || {}),
                cornerBridgeCount,
            },
            usedSheetMetalPath: false,
        };
        if (!result) {
            throw new Error(`[FilletFeature] Fillet returned no result for feature ${fid || '(unknown)'}.`);
        }
        if (!cacheHit && typeof result.simplify === 'function') {
            try {
                const simplifyStart = nowMs();
                result.simplify(FINAL_FILLET_SIMPLIFY_TOLERANCE, true);
                profiler.instant('final simplify', simplifyStart, { tolerance: FINAL_FILLET_SIMPLIFY_TOLERANCE });
            } catch (e) {
                console.warn('[FilletFeature] Final simplify cleanup failed; keeping unsimplified fillet result.', {
                    featureID: fid,
                    tolerance: FINAL_FILLET_SIMPLIFY_TOLERANCE,
                    error: e,
                });
            }
        }
        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (triCount === 0 || vertCount === 0) {
            throw new Error(`[FilletFeature] Fillet produced empty geometry for feature ${fid || '(unknown)'}. `
                + `(triangles=${triCount}, vertices=${vertCount}, direction=${dir}, radius=${r}, `
                + `inflate=${this.inputParams.inflate})`);
        }
        console.log('[FilletFeature] Fillet succeeded; replacing target solid.', {
            featureID: fid,
            triangles: triCount,
            vertices: vertCount,
            edgeDirectionDecision: edgeDirectionDecision || null,
        });
        added.push(result);
        added.push(...debugSolids);
        // Replace the original geometry in the scene
        removed.push(targetSolid);




        // loop over all added objects and set the epsilon vale on the solid
        if (!cacheHit) {
            profiler.start('post cleanup and visualize');
            for (const obj of added) {
                if (obj && typeof obj === 'object' && typeof obj.setEpsilon === 'function') {
                    try {
                        const sideWallCollapseCount = Math.max(
                            0,
                            Number(obj.__filletSideWallCollapseCount || 0),
                        );
                        const runPostTinyTriangleCollapse = !(collapseFilletSideWalls && sideWallCollapseCount > 0);
                        if (runPostTinyTriangleCollapse) {
                            await obj.collapseTinyTriangles(FILLET_POST_COLLAPSE_TINY_TRIANGLE_THRESHOLD);
                        }
                        obj.__filletPostCollapseTinyTriangleCollapseEnabled = runPostTinyTriangleCollapse;
                        const runPostTinyFaceIslandCleanup = true;
                        if (typeof obj.cleanupTinyFaceIslands === 'function') {
                            obj.__filletPostCollapseTinyFaceIslandCleanupCount = Math.max(
                                0,
                                Number(obj.cleanupTinyFaceIslands(FILLET_POST_COLLAPSE_TINY_FACE_ISLAND_CLEANUP_AREA) || 0),
                            );
                        } else {
                            obj.__filletPostCollapseTinyFaceIslandCleanupCount = 0;
                        }
                        obj.__filletPostCollapseTinyFaceIslandCleanupEnabled = runPostTinyFaceIslandCleanup;
                        const singleNeighborIslandSummary = cleanupFilletSingleNeighborIslands(obj, {
                            featureID: fid,
                            debug: debugEnabled,
                        });
                        obj.__filletPostSingleNeighborIslandCleanupCount = Math.max(
                            0,
                            Number(singleNeighborIslandSummary?.reassignedTriangles || 0),
                        );
                        obj.visualize();
                    } catch (e) {
                        console.warn('[FilletFeature] Failed to set epsilon on fillet result solid.', { error: e });
                    }
                }
            }
            profiler.end('post cleanup and visualize', { objects: added.length });
        }

        profiler.start('write fillet cache');
        const debugSnapshotsForCache = [];
        for (const dbg of debugSolids) {
            try {
                debugSnapshotsForCache.push({
                    name: dbg?.name || 'FILLET_DEBUG',
                    snapshot: cloneAuthoringSnapshot(buildSolidAuthoringStateSnapshot(dbg)),
                });
            } catch { /* ignore */ }
        }
        if (debugSnapshotsForCache.length === 0 && cacheHit && hasCachedDebugSnapshots) {
            debugSnapshotsForCache.push(...cacheEntry.debugSnapshots);
        }
        const debugModeForCache = debugSnapshotsForCache.length > 0
            ? (debugSolids.length > 0 ? debugMode : (cacheEntry?.debugMode || debugMode))
            : null;
        try {
            this.persistentData = {
                ...(this.persistentData || {}),
                filletSolidCache: {
                    version: FILLET_CACHE_VERSION,
                    optionsHash: cacheKey.optionsHash,
                    dependencyHash: cacheKey.dependencyHash,
                    edgeSignatures: cacheKey.edgeSignatures,
                    renameFaces,
                    finalSnapshot: cloneAuthoringSnapshot(buildSolidAuthoringStateSnapshot(result)),
                    debugSnapshots: debugSnapshotsForCache,
                    debugMode: debugModeForCache,
                    edgeDirectionDecision,
                    cornerBridgeCount,
                    cachedAt: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.warn('[FilletFeature] Failed to write fillet cache.', {
                featureID: fid,
                error: error?.message || error,
            });
        }
        profiler.end('write fillet cache', { debugSnapshots: debugSnapshotsForCache.length });
        const profile = profiler.finish({ cacheStatus: cacheHit ? 'hit' : 'miss' });
        this.persistentData = {
            ...(this.persistentData || {}),
            filletProfiler: profile,
        };
        console.log('[FilletFeature] Profile', profile);

        return { added, removed };
    }
}

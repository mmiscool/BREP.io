import {
    getSolidGeometryCounts,
} from "../edgeFeatureUtils.js";
import { fitAndSnapOpenEdgePolyline } from "./edgeCurveFit.js";

const DEFAULT_FIT_STRENGTH = 1;
const POINT_MATCH_EPSILON = 1e-9;

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the edge-smooth feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["EDGE", "FACE", "SOLID"],
        multiple: true,
        default_value: null,
        hint: "Select edges, faces, or solids to curve-fit associated edges",
    },
    fitStrength: {
        type: "number",
        step: 0.05,
        default_value: DEFAULT_FIT_STRENGTH,
        hint: "Blend amount toward the fitted curve (0 to 1)",
    },
};

function isRenderableEdge(obj) {
    return !!obj
        && String(obj.type || "").toUpperCase() === "EDGE"
        && !obj?.userData?.auxEdge;
}

function collectCurrentSolidEdges(solid) {
    const out = [];
    if (!solid || typeof solid.traverse !== "function") return out;
    solid.traverse((obj) => {
        if (!isRenderableEdge(obj)) return;
        const owner = obj.parentSolid || obj.parent || null;
        if (owner === solid || obj.parentSolid === solid) out.push(obj);
    });
    return out;
}

function resolveSelectionObject(entry, partHistory) {
    if (entry && typeof entry === "object") return entry;
    if ((typeof entry === "string" || typeof entry === "number")
        && partHistory?.scene
        && typeof partHistory.scene.getObjectByName === "function") {
        try {
            return partHistory.scene.getObjectByName(String(entry)) || null;
        } catch {
            return null;
        }
    }
    return null;
}

function collectEdgeObjectsFromTargets(rawTargets, partHistory) {
    const out = [];
    const seen = new Set();
    const seenSolid = new Set();
    const seenFace = new Set();
    const pushEdge = (edge) => {
        if (!isRenderableEdge(edge)) return;
        if (seen.has(edge)) return;
        seen.add(edge);
        out.push(edge);
    };

    const targets = Array.isArray(rawTargets)
        ? rawTargets
        : (rawTargets != null ? [rawTargets] : []);
    for (const rawEntry of targets) {
        const entry = resolveSelectionObject(rawEntry, partHistory);
        if (!entry) continue;
        const type = String(entry?.type || "").toUpperCase();
        if (type === "EDGE") {
            pushEdge(entry);
            continue;
        }
        if (type === "FACE") {
            if (seenFace.has(entry)) continue;
            seenFace.add(entry);
            const faceEdges = Array.isArray(entry.edges) ? entry.edges : [];
            for (const edge of faceEdges) pushEdge(edge);
            continue;
        }
        if (type === "SOLID") {
            if (seenSolid.has(entry)) continue;
            seenSolid.add(entry);
            const solidEdges = collectCurrentSolidEdges(entry);
            for (const edge of solidEdges) pushEdge(edge);
        }
    }

    return {
        edgeObjects: out,
        selectedSolidCount: seenSolid.size,
        selectedFaceCount: seenFace.size,
    };
}

function getDescriptorFromEdge(edge) {
    if (!isRenderableEdge(edge)) return null;
    const solid = edge.parentSolid || edge.parent || null;
    if (!solid) return null;
    return {
        solid,
        name: edge?.name || null,
        faceA: edge?.userData?.faceA || null,
        faceB: edge?.userData?.faceB || null,
        polylineLocal: Array.isArray(edge?.userData?.polylineLocal)
            ? edge.userData.polylineLocal
            : null,
    };
}

function pointDistanceSq(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}

function isPoint3(p) {
    return Array.isArray(p)
        && p.length === 3
        && Number.isFinite(p[0])
        && Number.isFinite(p[1])
        && Number.isFinite(p[2]);
}

function pointsMatch(a, b, epsilon = POINT_MATCH_EPSILON) {
    if (!isPoint3(a) || !isPoint3(b)) return false;
    return pointDistanceSq(a, b) <= (epsilon * epsilon);
}

function polylineEndpointScore(a, b) {
    if (!Array.isArray(a) || a.length < 2 || !Array.isArray(b) || b.length < 2) return Infinity;
    const a0 = a[0];
    const a1 = a[a.length - 1];
    const b0 = b[0];
    const b1 = b[b.length - 1];
    if (!isPoint3(a0) || !isPoint3(a1) || !isPoint3(b0) || !isPoint3(b1)) return Infinity;
    const forward = pointDistanceSq(a0, b0) + pointDistanceSq(a1, b1);
    const reverse = pointDistanceSq(a0, b1) + pointDistanceSq(a1, b0);
    return Math.min(forward, reverse);
}

function matchesFacePair(edgeObj, descriptor) {
    const fa = descriptor?.faceA || null;
    const fb = descriptor?.faceB || null;
    if (!fa || !fb) return false;
    const ea = edgeObj?.userData?.faceA || null;
    const eb = edgeObj?.userData?.faceB || null;
    return (ea === fa && eb === fb) || (ea === fb && eb === fa);
}

function findMatchingEdge(edgeCandidates, descriptor) {
    if (!Array.isArray(edgeCandidates) || edgeCandidates.length === 0) return null;
    if (!descriptor) return null;

    const edgeName = descriptor?.name || null;
    if (edgeName) {
        const exact = edgeCandidates.find((e) => e?.name === edgeName);
        if (exact) return exact;
    }

    let candidates = edgeCandidates;
    if (descriptor?.faceA && descriptor?.faceB) {
        const byFacePair = edgeCandidates.filter((e) => matchesFacePair(e, descriptor));
        if (byFacePair.length === 1) return byFacePair[0];
        if (byFacePair.length > 1) candidates = byFacePair;
    }

    const sourcePolyline = Array.isArray(descriptor?.polylineLocal)
        ? descriptor.polylineLocal
        : null;
    if (sourcePolyline && sourcePolyline.length >= 2) {
        let best = null;
        let bestScore = Infinity;
        for (const candidate of candidates) {
            const score = polylineEndpointScore(sourcePolyline, candidate?.userData?.polylineLocal);
            if (score < bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        if (best) return best;
    }

    return candidates[0] || null;
}

function findMatchingBoundaryPolyline(edgeObj, boundaries) {
    if (!Array.isArray(boundaries) || boundaries.length === 0) return null;
    const edgeName = typeof edgeObj?.name === "string" && edgeObj.name ? edgeObj.name : null;
    if (edgeName) {
        const exact = boundaries.find((b) => b && b.name === edgeName);
        if (exact) return exact;
    }

    const faceA = edgeObj?.userData?.faceA;
    const faceB = edgeObj?.userData?.faceB;
    let candidates = boundaries;
    if (faceA && faceB) {
        candidates = boundaries.filter((b) => {
            if (!b) return false;
            const a = b.faceA;
            const c = b.faceB;
            return (a === faceA && c === faceB) || (a === faceB && c === faceA);
        });
        if (candidates.length === 1) return candidates[0];
    }

    const localPolyline = Array.isArray(edgeObj?.userData?.polylineLocal)
        ? edgeObj.userData.polylineLocal
        : null;
    if (!localPolyline || localPolyline.length < 2) return candidates[0] || null;

    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        const score = polylineEndpointScore(localPolyline, candidate?.positions);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

function resolveIndicesFromPolylinePoints(polylineLocal, vp) {
    if (!Array.isArray(polylineLocal) || polylineLocal.length === 0) return [];
    if (!Array.isArray(vp) || vp.length < 3) return [];
    const vertCount = (vp.length / 3) | 0;
    const keyToIndex = new Map();
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        const key = `${vp[base + 0]},${vp[base + 1]},${vp[base + 2]}`;
        if (!keyToIndex.has(key)) keyToIndex.set(key, i);
    }

    const out = [];
    const seen = new Set();
    for (const p of polylineLocal) {
        if (!isPoint3(p)) continue;
        const key = `${p[0]},${p[1]},${p[2]}`;
        let idx = keyToIndex.get(key);
        if (idx === undefined) idx = findNearestVertexIndex(vp, p, POINT_MATCH_EPSILON);
        if (!Number.isInteger(idx) || idx < 0 || seen.has(idx)) continue;
        seen.add(idx);
        out.push(idx);
    }
    return out;
}

function findNearestVertexIndex(vp, point, epsilon = POINT_MATCH_EPSILON) {
    if (!Array.isArray(vp) || !isPoint3(point) || !Number.isFinite(epsilon) || epsilon <= 0) return -1;
    const thresholdSq = epsilon * epsilon;
    const vertCount = (vp.length / 3) | 0;
    let best = -1;
    let bestSq = thresholdSq;
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        const dx = vp[base + 0] - point[0];
        const dy = vp[base + 1] - point[1];
        const dz = vp[base + 2] - point[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= bestSq) {
            bestSq = distSq;
            best = i;
        }
    }
    return best;
}

function normalizeIndexedPolyline(indicesRaw, positionsRaw, closedHint = false) {
    const indices = Array.isArray(indicesRaw) ? indicesRaw : [];
    const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
    const count = Math.min(indices.length, positions.length);
    const pairedIndices = [];
    const pairedPositions = [];

    for (let i = 0; i < count; i++) {
        const idx = Number(indices[i]);
        const p = positions[i];
        if (!Number.isInteger(idx) || idx < 0 || !isPoint3(p)) continue;
        pairedIndices.push(idx);
        pairedPositions.push([p[0], p[1], p[2]]);
    }
    if (pairedIndices.length < 2) return null;

    let closedLoop = !!closedHint;
    const lastIndex = pairedIndices.length - 1;
    const startIndex = pairedIndices[0];
    const endIndex = pairedIndices[lastIndex];
    const startPoint = pairedPositions[0];
    const endPoint = pairedPositions[lastIndex];
    if (startIndex === endIndex || pointsMatch(startPoint, endPoint)) {
        closedLoop = true;
    }

    if (closedLoop && pairedIndices.length >= 3 && (startIndex === endIndex || pointsMatch(startPoint, endPoint))) {
        pairedIndices.pop();
        pairedPositions.pop();
    }
    if (pairedIndices.length < 2) return null;
    return {
        indices: pairedIndices,
        positions: pairedPositions,
        closedLoop,
    };
}

function resolveEdgePolylineWithIndices(edgeObj, solid) {
    if (!edgeObj || !solid) return null;

    let boundaries = [];
    try {
        boundaries = (typeof solid.getBoundaryEdgePolylines === "function")
            ? (solid.getBoundaryEdgePolylines() || [])
            : [];
    } catch { boundaries = []; }

    const boundary = findMatchingBoundaryPolyline(edgeObj, boundaries);
    if (boundary) {
        const normalized = normalizeIndexedPolyline(
            boundary.indices,
            boundary.positions,
            !!boundary.closedLoop,
        );
        if (normalized) return normalized;
    }

    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    const polylineLocal = Array.isArray(edgeObj?.userData?.polylineLocal)
        ? edgeObj.userData.polylineLocal
        : [];
    const fallbackIndices = resolveIndicesFromPolylinePoints(polylineLocal, vp);
    return normalizeIndexedPolyline(
        fallbackIndices,
        polylineLocal,
        !!edgeObj?.closedLoop || !!edgeObj?.userData?.closedLoop,
    );
}

function collectCurveTargetsForEdge(edgeObj, solid, options) {
    const polyline = resolveEdgePolylineWithIndices(edgeObj, solid);
    if (!polyline) {
        return {
            eligible: false,
            closedLoop: false,
            endpointIndices: [],
            targets: [],
        };
    }

    if (polyline.closedLoop) {
        return {
            eligible: false,
            closedLoop: true,
            endpointIndices: [],
            targets: [],
        };
    }

    const indices = Array.isArray(polyline.indices) ? polyline.indices : [];
    const positions = Array.isArray(polyline.positions) ? polyline.positions : [];
    const count = Math.min(indices.length, positions.length);
    if (count < 3) {
        return {
            eligible: false,
            closedLoop: false,
            endpointIndices: [],
            targets: [],
        };
    }

    const cleanedIndices = [];
    const cleanedPositions = [];
    for (let i = 0; i < count; i++) {
        const idx = Number(indices[i]);
        const p = positions[i];
        if (!Number.isInteger(idx) || idx < 0 || !isPoint3(p)) continue;
        cleanedIndices.push(idx);
        cleanedPositions.push([p[0], p[1], p[2]]);
    }
    if (cleanedIndices.length < 3) {
        return {
            eligible: false,
            closedLoop: false,
            endpointIndices: [],
            targets: [],
        };
    }

    const snapped = fitAndSnapOpenEdgePolyline(cleanedPositions, {
        fitStrength: options?.fitStrength,
    });
    if (!Array.isArray(snapped) || snapped.length !== cleanedPositions.length) {
        return {
            eligible: true,
            closedLoop: false,
            endpointIndices: [cleanedIndices[0], cleanedIndices[cleanedIndices.length - 1]],
            targets: [],
        };
    }

    const targets = [];
    for (let i = 1; i < cleanedIndices.length - 1; i++) {
        const idx = cleanedIndices[i];
        const point = snapped[i];
        if (!Number.isInteger(idx) || idx < 0 || !isPoint3(point)) continue;
        targets.push({ index: idx, point: [point[0], point[1], point[2]] });
    }

    return {
        eligible: true,
        closedLoop: false,
        endpointIndices: [cleanedIndices[0], cleanedIndices[cleanedIndices.length - 1]],
        targets,
    };
}

function collectTargetsForDescriptors(outSolid, descriptors, options) {
    const liveEdges = collectCurrentSolidEdges(outSolid);
    const targetMap = new Map();
    const lockedEndpointIndices = new Set();
    let matchedEdges = 0;
    let eligibleEdges = 0;
    let fittedEdges = 0;
    let skippedClosedLoops = 0;
    let targetAssignments = 0;

    for (const descriptor of descriptors) {
        const liveEdge = findMatchingEdge(liveEdges, descriptor);
        if (!liveEdge) {
            console.warn("[EdgeSmoothFeature] Could not resolve edge on cloned solid.", {
                edgeName: descriptor?.name || null,
                solidName: outSolid?.name || null,
            });
            continue;
        }

        matchedEdges++;
        const fitInfo = collectCurveTargetsForEdge(liveEdge, outSolid, options);
        if (fitInfo.closedLoop) {
            skippedClosedLoops++;
            continue;
        }
        if (!fitInfo.eligible) continue;

        eligibleEdges++;
        for (const rawEndpointIndex of fitInfo.endpointIndices || []) {
            const endpointIndex = Number(rawEndpointIndex);
            if (Number.isInteger(endpointIndex) && endpointIndex >= 0) {
                lockedEndpointIndices.add(endpointIndex);
            }
        }

        if (!Array.isArray(fitInfo.targets) || fitInfo.targets.length === 0) continue;
        fittedEdges++;
        for (const target of fitInfo.targets) {
            const index = Number(target?.index);
            const point = target?.point;
            if (!Number.isInteger(index) || index < 0 || !isPoint3(point)) continue;
            targetAssignments++;
            const existing = targetMap.get(index) || { x: 0, y: 0, z: 0, count: 0 };
            existing.x += point[0];
            existing.y += point[1];
            existing.z += point[2];
            existing.count += 1;
            targetMap.set(index, existing);
        }
    }

    for (const endpointIndex of lockedEndpointIndices) {
        targetMap.delete(endpointIndex);
    }

    return {
        targetMap,
        matchedEdges,
        eligibleEdges,
        fittedEdges,
        skippedClosedLoops,
        targetAssignments,
        lockedEndpointCount: lockedEndpointIndices.size,
    };
}

function rebuildSolidVertexKeyMap(solid) {
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    if (!vp) return;
    const vertCount = (vp.length / 3) | 0;
    solid._vertKeyToIndex = new Map();
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        solid._vertKeyToIndex.set(`${vp[base + 0]},${vp[base + 1]},${vp[base + 2]}`, i);
    }
}

function applyVertexTargets(solid, targetMap) {
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    if (!vp || vp.length < 3 || !(targetMap instanceof Map) || targetMap.size === 0) return 0;

    const maxIndex = ((vp.length / 3) | 0) - 1;
    let movedVertices = 0;
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
        const ox = vp[base + 0];
        const oy = vp[base + 1];
        const oz = vp[base + 2];
        if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) continue;

        const dx = tx - ox;
        const dy = ty - oy;
        const dz = tz - oz;
        const distSq = (dx * dx) + (dy * dy) + (dz * dz);
        if (distSq > 1e-30) movedVertices++;

        vp[base + 0] = tx;
        vp[base + 1] = ty;
        vp[base + 2] = tz;
    }

    if (movedVertices <= 0) return 0;

    rebuildSolidVertexKeyMap(solid);
    solid._dirty = true;
    solid._faceIndex = null;
    try {
        if (solid._manifold && typeof solid._manifold.delete === "function") {
            solid._manifold.delete();
        }
    } catch { }
    solid._manifold = null;

    try {
        if (typeof solid._manifoldize === "function") solid._manifoldize();
    } catch (error) {
        console.warn("[EdgeSmoothFeature] Manifold rebuild failed after smoothing.", {
            solidName: solid?.name || null,
            message: error?.message || String(error || "Unknown error"),
        });
    }

    try {
        if (typeof solid.visualize === "function") solid.visualize();
    } catch (error) {
        console.warn("[EdgeSmoothFeature] visualize() failed after smoothing.", {
            solidName: solid?.name || null,
            message: error?.message || String(error || "Unknown error"),
        });
    }

    return movedVertices;
}

function groupDescriptorsBySolid(descriptors) {
    const map = new Map();
    for (const descriptor of descriptors) {
        if (!descriptor?.solid) continue;
        let list = map.get(descriptor.solid);
        if (!list) {
            list = [];
            map.set(descriptor.solid, list);
        }
        list.push(descriptor);
    }
    return map;
}

function smoothEdgesOnClone(sourceSolid, descriptors, options, featureID) {
    if (!sourceSolid || typeof sourceSolid.clone !== "function") return null;
    const outSolid = sourceSolid.clone();
    try { outSolid.name = sourceSolid.name; } catch { }
    try { if (featureID) outSolid.owningFeatureID = featureID; } catch { }
    try { outSolid.visualize(); } catch { }

    const targetInfo = collectTargetsForDescriptors(outSolid, descriptors, options);
    if (targetInfo.targetMap.size === 0) return null;

    const movedVertices = applyVertexTargets(outSolid, targetInfo.targetMap);
    if (movedVertices <= 0) return null;

    const { triCount, vertCount } = getSolidGeometryCounts(outSolid);
    if (triCount <= 0 || vertCount <= 0) {
        console.warn("[EdgeSmoothFeature] Smoothed solid is empty; skipping replacement.", {
            solidName: sourceSolid?.name || null,
            triangleCount: triCount,
            vertexCount: vertCount,
        });
        return null;
    }

    return {
        solid: outSolid,
        movedVertices,
        matchedEdges: targetInfo.matchedEdges,
        eligibleEdges: targetInfo.eligibleEdges,
        fittedEdges: targetInfo.fittedEdges,
        skippedClosedLoops: targetInfo.skippedClosedLoops,
        targetAssignments: targetInfo.targetAssignments,
        lockedEndpointCount: targetInfo.lockedEndpointCount,
    };
}

export class EdgeSmoothFeature {
    static shortName = "ES";
    static longName = "Edge smooth";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const targets = items
            .filter((it) => {
                const type = String(it?.type || "").toUpperCase();
                return type === "EDGE" || type === "FACE" || type === "SOLID";
            })
            .map((it) => it?.name || it?.userData?.edgeName || it?.userData?.faceName || null)
            .filter((name) => !!name);
        if (!targets.length) return false;
        return { params: { edges: targets } };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    async run(partHistory) {
        const selections = Array.isArray(this.inputParams.edges) ? this.inputParams.edges : [];
        const {
            edgeObjects,
            selectedSolidCount,
            selectedFaceCount,
        } = collectEdgeObjectsFromTargets(selections, partHistory);
        if (edgeObjects.length === 0) {
            console.warn("[EdgeSmoothFeature] No edges found from selected EDGE/FACE/SOLID targets.");
            return { added: [], removed: [] };
        }

        const descriptors = edgeObjects
            .map((edge) => getDescriptorFromEdge(edge))
            .filter((descriptor) => !!descriptor);
        if (!descriptors.length) {
            console.warn("[EdgeSmoothFeature] Selected targets have no owning solids.");
            return { added: [], removed: [] };
        }

        const rawStrength = Number(this.inputParams?.fitStrength);
        const fitStrength = Number.isFinite(rawStrength)
            ? Math.max(0, Math.min(1, rawStrength))
            : DEFAULT_FIT_STRENGTH;

        const grouped = groupDescriptorsBySolid(descriptors);
        const added = [];
        const removed = [];
        let totalMovedVertices = 0;
        let totalMatchedEdges = 0;
        let totalEligibleEdges = 0;
        let totalFittedEdges = 0;
        let totalSkippedClosedLoops = 0;
        let totalTargetAssignments = 0;
        let totalLockedEndpoints = 0;
        const featureID = this.inputParams?.featureID || this.inputParams?.id || null;

        for (const [sourceSolid, edgeDescriptors] of grouped.entries()) {
            const result = smoothEdgesOnClone(
                sourceSolid,
                edgeDescriptors,
                { fitStrength },
                featureID,
            );
            if (!result?.solid) continue;
            added.push(result.solid);
            removed.push(sourceSolid);
            totalMovedVertices += Number(result.movedVertices) || 0;
            totalMatchedEdges += Number(result.matchedEdges) || 0;
            totalEligibleEdges += Number(result.eligibleEdges) || 0;
            totalFittedEdges += Number(result.fittedEdges) || 0;
            totalSkippedClosedLoops += Number(result.skippedClosedLoops) || 0;
            totalTargetAssignments += Number(result.targetAssignments) || 0;
            totalLockedEndpoints += Number(result.lockedEndpointCount) || 0;
        }

        if (!added.length) {
            console.warn("[EdgeSmoothFeature] No open-edge polylines produced curve-fit updates.");
            return { added: [], removed: [] };
        }

        try {
            for (const obj of removed) {
                if (!obj) continue;
                obj.__removeFlag = true;
            }
        } catch { }

        this.persistentData = {
            ...(this.persistentData || {}),
            selectedEdgeCount: edgeObjects.length,
            selectedSolidCount,
            selectedFaceCount,
            totalMovedVertices,
            totalMatchedEdges,
            totalEligibleEdges,
            totalFittedEdges,
            totalSkippedClosedLoops,
            totalTargetAssignments,
            totalLockedEndpoints,
            targetSolidCount: added.length,
            fitStrength,
        };
        return { added, removed };
    }
}

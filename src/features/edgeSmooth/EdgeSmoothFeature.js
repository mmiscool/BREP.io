import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
} from "../edgeFeatureUtils.js";

const DEFAULT_ANGLE_THRESHOLD_DEG = 80;
const DEFAULT_MAX_RELATIVE_SEGMENT_LENGTH = 0.8;
const MIN_VECTOR_LENGTH = 1e-12;
const POINT_MATCH_EPSILON = 1e-9;

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the edge-smooth feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["EDGE"],
        multiple: true,
        default_value: null,
        hint: "Select one or more edges to smooth abrupt short kinks",
    },
    angleThresholdDeg: {
        type: "number",
        step: 1,
        default_value: DEFAULT_ANGLE_THRESHOLD_DEG,
        hint: "Minimum turn angle (degrees) considered abrupt",
    },
    maxRelativeSegmentLength: {
        type: "number",
        step: 0.05,
        default_value: DEFAULT_MAX_RELATIVE_SEGMENT_LENGTH,
        hint: "Short-segment limit relative to neighboring segments",
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

function pointDistance(a, b) {
    return Math.sqrt(pointDistanceSq(a, b));
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

function angleDegBetweenVectors(ax, ay, az, bx, by, bz) {
    const lenA = Math.hypot(ax, ay, az);
    const lenB = Math.hypot(bx, by, bz);
    if (lenA <= MIN_VECTOR_LENGTH || lenB <= MIN_VECTOR_LENGTH) return 0;
    const dot = (ax * bx) + (ay * by) + (az * bz);
    const cosTheta = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
    return Math.acos(cosTheta) * (180 / Math.PI);
}

function turnAngleDeg(prev, current, next) {
    if (!isPoint3(prev) || !isPoint3(current) || !isPoint3(next)) return 0;
    const ax = current[0] - prev[0];
    const ay = current[1] - prev[1];
    const az = current[2] - prev[2];
    const bx = next[0] - current[0];
    const by = next[1] - current[1];
    const bz = next[2] - current[2];
    return angleDegBetweenVectors(ax, ay, az, bx, by, bz);
}

function isShortSegmentAgainstNeighbors(segLength, neighborLengths, maxRelativeLength) {
    if (!Number.isFinite(segLength) || segLength <= MIN_VECTOR_LENGTH) return false;
    if (!Array.isArray(neighborLengths) || neighborLengths.length === 0) return false;
    let minNeighbor = Infinity;
    for (const len of neighborLengths) {
        if (!Number.isFinite(len) || len <= MIN_VECTOR_LENGTH) continue;
        if (len < minNeighbor) minNeighbor = len;
    }
    if (!Number.isFinite(minNeighbor)) return false;
    return segLength <= (minNeighbor * maxRelativeLength);
}

function findAbruptShortSegments(polyline, angleThresholdDeg, maxRelativeSegmentLength) {
    const points = Array.isArray(polyline?.positions) ? polyline.positions : [];
    const closedLoop = !!polyline?.closedLoop;
    if (closedLoop) {
        if (points.length < 3) return [];
    } else if (points.length < 3) {
        return [];
    }

    const segmentCount = closedLoop ? points.length : (points.length - 1);
    if (closedLoop) {
        if (segmentCount < 3) return [];
    } else if (segmentCount < 2) {
        return [];
    }

    const segmentLengths = new Array(segmentCount);
    for (let i = 0; i < segmentCount; i++) {
        const a = points[i];
        const b = closedLoop ? points[(i + 1) % points.length] : points[i + 1];
        segmentLengths[i] = pointDistance(a, b);
    }

    const threshold = Number.isFinite(angleThresholdDeg)
        ? Math.max(0, angleThresholdDeg)
        : DEFAULT_ANGLE_THRESHOLD_DEG;
    const relativeLimit = Number.isFinite(maxRelativeSegmentLength) && maxRelativeSegmentLength > 0
        ? maxRelativeSegmentLength
        : DEFAULT_MAX_RELATIVE_SEGMENT_LENGTH;

    const out = [];
    if (closedLoop) {
        for (let i = 0; i < segmentCount; i++) {
            const prevSeg = (i - 1 + segmentCount) % segmentCount;
            const nextSeg = (i + 1) % segmentCount;

            const pPrev = points[(i - 1 + points.length) % points.length];
            const pStart = points[i];
            const pEnd = points[(i + 1) % points.length];
            const pNext = points[(i + 2) % points.length];

            const startTurn = turnAngleDeg(pPrev, pStart, pEnd);
            const endTurn = turnAngleDeg(pStart, pEnd, pNext);
            if (!(startTurn > threshold && endTurn > threshold)) continue;

            const segLength = segmentLengths[i];
            const prevLength = segmentLengths[prevSeg];
            const nextLength = segmentLengths[nextSeg];
            if (!isShortSegmentAgainstNeighbors(segLength, [prevLength, nextLength], relativeLimit)) continue;
            out.push(i);
        }
        return out;
    }

    for (let i = 0; i < segmentCount; i++) {
        const isStartSegment = i === 0;
        const isEndSegment = i === (segmentCount - 1);

        let passesTurnThreshold = false;
        const neighborLengths = [];

        // Turn at the segment start vertex: ... -> points[i] -> points[i+1]
        if (!isStartSegment) {
            const startTurn = turnAngleDeg(points[i - 1], points[i], points[i + 1]);
            neighborLengths.push(segmentLengths[i - 1]);
            if (startTurn > threshold) passesTurnThreshold = true;
            if (!isEndSegment && !(startTurn > threshold)) continue;
        }

        // Turn at the segment end vertex: points[i] -> points[i+1] -> ...
        if (!isEndSegment) {
            const endTurn = turnAngleDeg(points[i], points[i + 1], points[i + 2]);
            neighborLengths.push(segmentLengths[i + 1]);
            if (endTurn > threshold) passesTurnThreshold = true;
            if (!isStartSegment && !(endTurn > threshold)) continue;
        }

        // Endpoint segments have only one available turn; interior segments require both.
        if (!passesTurnThreshold) continue;

        const segLength = segmentLengths[i];
        if (!isShortSegmentAgainstNeighbors(segLength, neighborLengths, relativeLimit)) continue;
        out.push(i);
    }
    return out;
}

function collectCollapsePairsForEdge(edgeObj, solid, options) {
    const polyline = resolveEdgePolylineWithIndices(edgeObj, solid);
    if (!polyline || !Array.isArray(polyline.indices) || polyline.indices.length < 2) return [];

    const segmentIndices = findAbruptShortSegments(
        polyline,
        options?.angleThresholdDeg,
        options?.maxRelativeSegmentLength,
    );
    if (!segmentIndices.length) return [];

    const indices = polyline.indices;
    const out = [];
    for (const rawSegmentIndex of segmentIndices) {
        const segIndex = Number(rawSegmentIndex);
        if (!Number.isInteger(segIndex) || segIndex < 0) continue;
        let a = null;
        let b = null;
        let preferredTarget = null;

        if (polyline.closedLoop) {
            if (segIndex >= indices.length) continue;
            a = indices[segIndex];
            b = indices[(segIndex + 1) % indices.length];
        } else {
            if (segIndex + 1 >= indices.length) continue;
            a = indices[segIndex];
            b = indices[segIndex + 1];
            const lastSegIndex = indices.length - 2;
            if (segIndex === 0) preferredTarget = indices[0];
            else if (segIndex === lastSegIndex) preferredTarget = indices[indices.length - 1];
        }

        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) continue;
        if (preferredTarget !== a && preferredTarget !== b) preferredTarget = null;
        out.push({ a, b, preferredTarget });
    }
    return out;
}

function collectPairsForDescriptors(outSolid, descriptors, options) {
    const liveEdges = collectCurrentSolidEdges(outSolid);
    const pairsByKey = new Map();
    let matchedEdges = 0;
    let detectedSegments = 0;

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
        const pairs = collectCollapsePairsForEdge(liveEdge, outSolid, options);
        if (!pairs.length) continue;
        detectedSegments += pairs.length;

        for (const pair of pairs) {
            const rawA = Number(pair?.a ?? pair?.[0]);
            const rawB = Number(pair?.b ?? pair?.[1]);
            if (!Number.isInteger(rawA) || !Number.isInteger(rawB) || rawA < 0 || rawB < 0 || rawA === rawB) continue;

            const a = Math.min(rawA, rawB);
            const b = Math.max(rawA, rawB);
            const key = `${a},${b}`;

            const rawPreferredTarget = Number(pair?.preferredTarget);
            const preferredTarget = (Number.isInteger(rawPreferredTarget) && (rawPreferredTarget === a || rawPreferredTarget === b))
                ? rawPreferredTarget
                : null;

            if (!pairsByKey.has(key)) {
                pairsByKey.set(key, { a, b, preferredTarget });
                continue;
            }

            const existing = pairsByKey.get(key);
            if (existing && existing.preferredTarget == null && preferredTarget != null) {
                existing.preferredTarget = preferredTarget;
            }
        }
    }

    return {
        pairs: Array.from(pairsByKey.values()).map((entry) => ({
            a: entry.a,
            b: entry.b,
            preferredTarget: (entry.preferredTarget === entry.a || entry.preferredTarget === entry.b)
                ? entry.preferredTarget
                : null,
        })),
        matchedEdges,
        detectedSegments,
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

function applyVertexPairCollapses(solid, pairs) {
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    if (!vp || vp.length < 3 || !Array.isArray(pairs) || pairs.length === 0) return 0;

    const maxIndex = ((vp.length / 3) | 0) - 1;
    let movedPairs = 0;

    for (const pair of pairs) {
        const a = Number(pair?.a ?? pair?.[0]);
        const b = Number(pair?.b ?? pair?.[1]);
        if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
        if (a < 0 || b < 0 || a > maxIndex || b > maxIndex || a === b) continue;

        const aBase = a * 3;
        const bBase = b * 3;
        const ax = vp[aBase + 0];
        const ay = vp[aBase + 1];
        const az = vp[aBase + 2];
        const bx = vp[bBase + 0];
        const by = vp[bBase + 1];
        const bz = vp[bBase + 2];
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) continue;
        if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) continue;

        const dx = ax - bx;
        const dy = ay - by;
        const dz = az - bz;
        const distSq = (dx * dx) + (dy * dy) + (dz * dz);

        const rawPreferredTarget = Number(pair?.preferredTarget);
        const preferredTarget = (Number.isInteger(rawPreferredTarget) && (rawPreferredTarget === a || rawPreferredTarget === b))
            ? rawPreferredTarget
            : null;

        let cx = 0;
        let cy = 0;
        let cz = 0;
        if (preferredTarget != null) {
            const targetBase = preferredTarget * 3;
            cx = vp[targetBase + 0];
            cy = vp[targetBase + 1];
            cz = vp[targetBase + 2];
        } else {
            cx = (ax + bx) * 0.5;
            cy = (ay + by) * 0.5;
            cz = (az + bz) * 0.5;
        }

        vp[aBase + 0] = cx;
        vp[aBase + 1] = cy;
        vp[aBase + 2] = cz;
        vp[bBase + 0] = cx;
        vp[bBase + 1] = cy;
        vp[bBase + 2] = cz;

        if (distSq > 1e-30) movedPairs++;
    }

    if (movedPairs <= 0) return 0;

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
    return movedPairs;
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

    const pairInfo = collectPairsForDescriptors(outSolid, descriptors, options);
    if (!pairInfo.pairs.length) return null;

    const movedPairs = applyVertexPairCollapses(outSolid, pairInfo.pairs);
    if (movedPairs <= 0) return null;

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
        movedPairs,
        detectedSegments: pairInfo.detectedSegments,
        matchedEdges: pairInfo.matchedEdges,
    };
}

export class EdgeSmoothFeature {
    static shortName = "ES";
    static longName = "Edge smooth";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const edges = items
            .filter((it) => String(it?.type || "").toUpperCase() === "EDGE")
            .map((it) => it?.name || it?.userData?.edgeName || null)
            .filter((name) => !!name);
        if (!edges.length) return false;
        return { params: { edges } };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    async run() {
        const inputObjects = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const edgeObjects = collectEdgesFromSelection(inputObjects).filter((edge) => isRenderableEdge(edge));
        if (edgeObjects.length === 0) {
            console.warn("[EdgeSmoothFeature] No edges selected for smoothing.");
            return { added: [], removed: [] };
        }

        const descriptors = edgeObjects
            .map((edge) => getDescriptorFromEdge(edge))
            .filter((descriptor) => !!descriptor);
        if (!descriptors.length) {
            console.warn("[EdgeSmoothFeature] Selected edges have no owning solids.");
            return { added: [], removed: [] };
        }

        const rawAngle = Number(this.inputParams?.angleThresholdDeg);
        const angleThresholdDeg = Number.isFinite(rawAngle)
            ? Math.max(0, rawAngle)
            : DEFAULT_ANGLE_THRESHOLD_DEG;

        const rawRelative = Number(this.inputParams?.maxRelativeSegmentLength);
        const maxRelativeSegmentLength = Number.isFinite(rawRelative) && rawRelative > 0
            ? rawRelative
            : DEFAULT_MAX_RELATIVE_SEGMENT_LENGTH;

        const grouped = groupDescriptorsBySolid(descriptors);
        const added = [];
        const removed = [];
        let totalMovedPairs = 0;
        let totalDetectedSegments = 0;
        let totalMatchedEdges = 0;
        const featureID = this.inputParams?.featureID || this.inputParams?.id || null;

        for (const [sourceSolid, edgeDescriptors] of grouped.entries()) {
            const result = smoothEdgesOnClone(
                sourceSolid,
                edgeDescriptors,
                { angleThresholdDeg, maxRelativeSegmentLength },
                featureID,
            );
            if (!result?.solid) continue;
            added.push(result.solid);
            removed.push(sourceSolid);
            totalMovedPairs += Number(result.movedPairs) || 0;
            totalDetectedSegments += Number(result.detectedSegments) || 0;
            totalMatchedEdges += Number(result.matchedEdges) || 0;
        }

        if (!added.length) {
            console.warn("[EdgeSmoothFeature] No abrupt short segments matched the smoothing criteria.");
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
            totalCollapsedPairs: totalMovedPairs,
            totalDetectedSegments,
            totalMatchedEdges,
            targetSolidCount: added.length,
            angleThresholdDeg,
            maxRelativeSegmentLength,
        };
        return { added, removed };
    }
}

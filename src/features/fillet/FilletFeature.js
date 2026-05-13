import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";
import { runSheetMetalCornerFillet } from "../sheetMetal/sheetMetalEngineBridge.js";

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
};

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
        console.log('[FilletFeature] Starting fillet run...', {
            featureID: this.inputParams?.featureID,
            radius: this.inputParams?.radius,
        });
        const added = [];
        const removed = [];

        // Resolve inputs from sanitizeInputParams()
        const rawInputSelections = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const previewSnapshots = this.persistentData?.__refPreviewSnapshots?.edges || null;
        const expanded = expandReferenceSelections(rawInputSelections, partHistory, previewSnapshots);
        const inputObjects = expanded.selections;
        const edgeObjs = collectEdgesFromSelection(inputObjects);
        const sheetCarrierFromRefs = resolveSheetMetalCarrierFromSelections(rawInputSelections, partHistory);

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
            return { added: [], removed: [] };
        }
        console.log('[FilletFeature] Target solid resolved', {
            name: targetSolid?.name,
            edgeCount: edgeObjs.length,
            edgeNames: edgeObjs.map(e => e?.name).filter(Boolean),
        });

        const r = Number(this.inputParams.radius);
        if (!Number.isFinite(r) || !(r > 0)) {
            console.warn('[FilletFeature] Invalid radius supplied; aborting.', { radius: this.inputParams.radius });
            return { added: [], removed: [] };
        }

        const fid = this.inputParams.featureID;

        const isSheetMetalCarrier = !!targetSolid?.userData?.sheetMetalModel?.tree;
        if (isSheetMetalCarrier) {
            const sheetResult = runSheetMetalCornerFillet({
                sourceCarrier: targetSolid,
                selections: rawInputSelections,
                edgeSelections: edgeObjs,
                radius: r,
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
            return { added, removed };
        }

        let result = null;
        result = await targetSolid.fillet({
            radius: r,
            edges: edgeObjs,
            featureID: fid,
        });
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
        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (triCount === 0 || vertCount === 0) {
            throw new Error(`[FilletFeature] Fillet produced empty geometry for feature ${fid || '(unknown)'}. `
                + `(triangles=${triCount}, vertices=${vertCount}, radius=${r})`);
        }
        console.log('[FilletFeature] Fillet succeeded; replacing target solid.', {
            featureID: fid,
            triangles: triCount,
            vertices: vertCount,
            edgeDirectionDecision: edgeDirectionDecision || null,
        });
        added.push(result);
        // Replace the original geometry in the scene
        removed.push(targetSolid);

        for (const obj of added) {
            if (obj && typeof obj === 'object' && typeof obj.visualize === 'function') {
                try {
                    obj.visualize()
                } catch (e) {
                    console.warn('[FilletFeature] Failed to visualize fillet result solid.', { error: e });
                }
            }
        }




        return { added, removed };
    }
}

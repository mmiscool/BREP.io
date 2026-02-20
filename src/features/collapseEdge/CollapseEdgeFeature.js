import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
} from "../edgeFeatureUtils.js";

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the collapse-edge feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["EDGE"],
        multiple: true,
        default_value: null,
        hint: "Select one or more edges to collapse to a point",
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

function isPoint3(p) {
    return Array.isArray(p)
        && p.length === 3
        && Number.isFinite(p[0])
        && Number.isFinite(p[1])
        && Number.isFinite(p[2]);
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

function collapseEdgesOnClone(sourceSolid, descriptors, featureID) {
    if (!sourceSolid || typeof sourceSolid.clone !== "function") return null;
    const outSolid = sourceSolid.clone();
    try { outSolid.name = sourceSolid.name; } catch { }
    try { if (featureID) outSolid.owningFeatureID = featureID; } catch { }
    try { outSolid.visualize(); } catch { }

    let collapsed = 0;
    for (const descriptor of descriptors) {
        const liveEdges = collectCurrentSolidEdges(outSolid);
        const liveEdge = findMatchingEdge(liveEdges, descriptor);
        if (!liveEdge || typeof liveEdge.collapseToPoint !== "function") {
            console.warn("[CollapseEdgeFeature] Could not resolve edge on cloned solid.", {
                edgeName: descriptor?.name || null,
                solidName: sourceSolid?.name || null,
            });
            continue;
        }
        try {
            liveEdge.collapseToPoint();
            collapsed++;
        } catch (error) {
            console.warn("[CollapseEdgeFeature] collapseToPoint() failed.", {
                edgeName: descriptor?.name || liveEdge?.name || null,
                solidName: sourceSolid?.name || null,
                message: error?.message || String(error || "Unknown error"),
            });
        }
    }

    if (collapsed <= 0) return null;
    try { outSolid.visualize(); } catch { }

    const { triCount, vertCount } = getSolidGeometryCounts(outSolid);
    if (triCount <= 0 || vertCount <= 0) {
        console.warn("[CollapseEdgeFeature] Collapsed solid is empty; skipping replacement.", {
            solidName: sourceSolid?.name || null,
            triangleCount: triCount,
            vertexCount: vertCount,
        });
        return null;
    }
    return { solid: outSolid, collapsed };
}

export class CollapseEdgeFeature {
    static shortName = "CE";
    static longName = "Collapse Edge";
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
            console.warn("[CollapseEdgeFeature] No edges selected for collapse.");
            return { added: [], removed: [] };
        }

        const descriptors = edgeObjects
            .map((edge) => getDescriptorFromEdge(edge))
            .filter((descriptor) => !!descriptor);
        if (!descriptors.length) {
            console.warn("[CollapseEdgeFeature] Selected edges have no owning solids.");
            return { added: [], removed: [] };
        }

        const grouped = groupDescriptorsBySolid(descriptors);
        const added = [];
        const removed = [];
        let totalCollapsed = 0;
        const featureID = this.inputParams?.featureID || this.inputParams?.id || null;

        for (const [sourceSolid, edgeDescriptors] of grouped.entries()) {
            const result = collapseEdgesOnClone(sourceSolid, edgeDescriptors, featureID);
            if (!result?.solid) continue;
            added.push(result.solid);
            removed.push(sourceSolid);
            totalCollapsed += Number(result.collapsed) || 0;
        }

        if (!added.length) {
            console.warn("[CollapseEdgeFeature] No edges were collapsed.");
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
            totalCollapsedEdges: totalCollapsed,
            targetSolidCount: added.length,
        };
        return { added, removed };
    }
}

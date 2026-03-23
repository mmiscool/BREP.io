import { Solid } from "../BetterSolid.js";
import {
    applySolidAuthoringStateSnapshot,
    buildSolidAuthoringStateSnapshot,
    computeFilletCenterlineForEdge,
} from "../CppSolidCore.js";
import { manifold } from "../setupManifold.js";
import { getDistanceTolerance } from './inset.js';

export { clearFilletCaches, trimFilletCaches } from './inset.js';

function solidFromSnapshot(snapshot, name, opts = {}) {
    if (!snapshot) return null;
    const solid = new Solid();
    applySolidAuthoringStateSnapshot(solid, snapshot, {
        remapFaceIDs: opts?.remapFaceIDs !== false,
    });
    solid._dirty = true;
    solid._manifold = null;
    solid._faceIndex = null;
    try { solid.name = name; } catch { }
    return solid;
}
export { fixTJunctionsAndPatchHoles } from './outset.js';

function hasNativeFilletEdgeBuilder() {
    return typeof manifold?.buildFilletEdgeAuthoringState === 'function';
}

function requireNativeFilletEdgeBuilder() {
    if (hasNativeFilletEdgeBuilder()) return;
    throw new Error('Fillet edge generation requires the custom local manifold build with native fillet edge support.');
}

function normalizeFilletSideMode(sideMode = 'INSET') {
    return String(sideMode || 'INSET').toUpperCase() === 'OUTSET' ? 'OUTSET' : 'INSET';
}

function createFilletResultPayload({
    tube = null,
    wedge = null,
    finalSolid = null,
    tubeSnapshot = null,
    wedgeSnapshot = null,
    finalSnapshot = null,
    centerline = [],
    tangentA = [],
    tangentB = [],
    edge = [],
    edgeWedge = [],
    tangentASeam = [],
    tangentBSeam = [],
    tubeCapPointsBeforeNudge = { start: [], end: [] },
    error = null,
} = {}) {
    const out = {
        tube,
        wedge,
        finalSolid,
        tubeSnapshot,
        wedgeSnapshot,
        finalSnapshot,
        centerline,
        tangentA,
        tangentB,
        edge,
        edgeWedge,
        tangentASeam,
        tangentBSeam,
        tubeCapPointsBeforeNudge,
    };
    if (error != null) out.error = String(error);
    return out;
}

function point3ArrayFromAny(point) {
    if (Array.isArray(point) && point.length >= 3) {
        const x = Number(point[0]);
        const y = Number(point[1]);
        const z = Number(point[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
        return null;
    }
    if (point && typeof point === 'object') {
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
    }
    return null;
}

function point3ObjectFromAny(point) {
    const arr = point3ArrayFromAny(point);
    if (!arr) return null;
    return { x: arr[0], y: arr[1], z: arr[2] };
}

function sanitizeFilletInputPolyline(polylineLocal, tolerance = 1e-9) {
    const src = Array.isArray(polylineLocal) ? polylineLocal : [];
    if (src.length === 0) return [];

    const tol = Number.isFinite(tolerance)
        ? Math.max(1e-12, Math.abs(tolerance))
        : 1e-9;
    const tol2 = tol * tol;
    const parsed = [];

    for (let i = 0; i < src.length; i++) {
        const pt = src[i];
        if (!Array.isArray(pt) || pt.length < 3) continue;
        const x = Number(pt[0]);
        const y = Number(pt[1]);
        const z = Number(pt[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        parsed.push([x, y, z]);
    }
    if (parsed.length === 0) return [];

    const out = [];
    for (let i = 0; i < parsed.length; i++) {
        const pt = parsed[i];
        const x = pt[0];
        const y = pt[1];
        const z = pt[2];

        if (out.length > 0) {
            const prev = out[out.length - 1];
            const dx = x - prev[0];
            const dy = y - prev[1];
            const dz = z - prev[2];
            if (((dx * dx) + (dy * dy) + (dz * dz)) <= tol2) continue;
        }
        out.push([x, y, z]);
    }
    if (out.length < 3) return out;

    // Second pass: strip micro-segments relative to the edge scale so cleanup
    // does not flip behavior based on fillet radius.
    let totalLen = 0;
    let maxSegLen = 0;
    for (let i = 1; i < out.length; i++) {
        const a = out[i - 1];
        const b = out[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (!Number.isFinite(len) || len <= 0) continue;
        totalLen += len;
        if (len > maxSegLen) maxSegLen = len;
    }
    const adaptiveTol = Math.max(
        tol,
        totalLen * 1e-7,
        maxSegLen * 1e-6,
    );
    const adaptiveTol2 = adaptiveTol * adaptiveTol;
    if (adaptiveTol2 <= tol2) return out;

    const refined = [];
    for (let i = 0; i < out.length; i++) {
        const p = out[i];
        if (refined.length === 0) {
            refined.push(p);
            continue;
        }
        const prev = refined[refined.length - 1];
        const dx = p[0] - prev[0];
        const dy = p[1] - prev[1];
        const dz = p[2] - prev[2];
        if (((dx * dx) + (dy * dy) + (dz * dz)) <= adaptiveTol2) continue;
        refined.push(p);
    }
    return refined.length >= 2 ? refined : out;
}

function buildFilletEdgeNativeStandard({
    edgeObj,
    radius,
    sideMode,
    name,
    inflate,
    nudgeFaceDistance,
    resolution,
    snapshot = null,
    segmentFacePairs = null,
} = {}) {
    requireNativeFilletEdgeBuilder();
    if (!edgeObj || !Number.isFinite(radius) || radius <= 0) {
        throw new Error('Native fillet edge builder requires a valid edge and positive radius.');
    }
    const solid = edgeObj.parentSolid || edgeObj.parent || null;
    if (!solid) {
        throw new Error('Native fillet edge builder requires the edge parent solid.');
    }
    const faceA = edgeObj.faces?.[0] || null;
    const faceB = edgeObj.faces?.[1] || null;
    const faceNameA = faceA?.name || edgeObj?.userData?.faceA || null;
    const faceNameB = faceB?.name || edgeObj?.userData?.faceB || null;
    const hasSegmentFacePairs = Array.isArray(segmentFacePairs) && segmentFacePairs.length > 0;
    if (!hasSegmentFacePairs && (!faceNameA || !faceNameB)) {
        throw new Error('Native fillet edge builder requires two owning face names.');
    }
    const polyLocalRaw = edgeObj?.userData?.polylineLocal;
    if (!Array.isArray(polyLocalRaw) || polyLocalRaw.length < 2) {
        throw new Error('Native fillet edge builder requires edge polylineLocal samples.');
    }

    const distTol = getDistanceTolerance(radius);
    const polyLocal = sanitizeFilletInputPolyline(polyLocalRaw, distTol);
    if (!Array.isArray(polyLocal) || polyLocal.length < 2) {
        throw new Error('Native fillet edge builder could not derive a valid polyline.');
    }

    let isClosed = !!(edgeObj.closedLoop || edgeObj.userData?.closedLoop);
    if (!isClosed && polyLocal.length > 2) {
        const a = polyLocal[0];
        const b = polyLocal[polyLocal.length - 1];
        if (a && b) {
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            const dz = a[2] - b[2];
            if (((dx * dx) + (dy * dy) + (dz * dz)) <= (distTol * distTol)) {
                isClosed = true;
            }
        }
    }

    const payload = {
        snapshot: snapshot || buildSolidAuthoringStateSnapshot(solid),
        polyline: polyLocal,
        radius: Number(radius),
        requestedRadius: Number(radius),
        sideMode: normalizeFilletSideMode(sideMode),
        inflate: Number.isFinite(Number(inflate)) ? Number(inflate) : 0,
        nudgeFaceDistance: Number.isFinite(Number(nudgeFaceDistance)) ? Number(nudgeFaceDistance) : 0.0001,
        resolution: Number.isFinite(Number(resolution)) ? Number(resolution) : 32,
        closedLoop: !!isClosed,
        name: String(name || 'fillet'),
        edgeReference: String(edgeObj?.name || ''),
    };
    if (faceNameA) payload.faceAName = faceNameA;
    if (faceNameB) payload.faceBName = faceNameB;
    if (hasSegmentFacePairs) {
        payload.segmentFacePairs = segmentFacePairs;
    }
    const result = manifold.buildFilletEdgeAuthoringState(payload);
    if (!result || typeof result !== 'object') {
        throw new Error('Native fillet edge builder returned an invalid result.');
    }

    return {
        centerline: Array.isArray(result.centerline) ? result.centerline.map(point3ObjectFromAny).filter(Boolean) : [],
        tangentA: Array.isArray(result.tangentA) ? result.tangentA.map(point3ObjectFromAny).filter(Boolean) : [],
        tangentB: Array.isArray(result.tangentB) ? result.tangentB.map(point3ObjectFromAny).filter(Boolean) : [],
        edge: Array.isArray(result.edge) ? result.edge.map(point3ObjectFromAny).filter(Boolean) : [],
        edgeWedge: Array.isArray(result.edgeWedge) ? result.edgeWedge.map(point3ObjectFromAny).filter(Boolean) : [],
        tangentASeam: Array.isArray(result.tangentASeam) ? result.tangentASeam.map(point3ObjectFromAny).filter(Boolean) : [],
        tangentBSeam: Array.isArray(result.tangentBSeam) ? result.tangentBSeam.map(point3ObjectFromAny).filter(Boolean) : [],
        tubeCapPointsBeforeNudge: {
            start: Array.isArray(result?.tubeCapPointsBeforeNudge?.start)
                ? result.tubeCapPointsBeforeNudge.start.map(point3ArrayFromAny).filter(Boolean)
                : [],
            end: Array.isArray(result?.tubeCapPointsBeforeNudge?.end)
                ? result.tubeCapPointsBeforeNudge.end.map(point3ArrayFromAny).filter(Boolean)
                : [],
        },
        wedgeSnapshot: result.wedgeSnapshot || null,
        tubeSnapshot: result.tubeSnapshot || null,
        finalSnapshot: result.finalSnapshot || null,
        closedLoop: !!result.closedLoop,
        radiusClamp: result.radiusClamp || null,
        nativeKernel: result.nativeKernel === true,
    };
}

/**
 * Convenience: compute and attach the fillet centerline as an auxiliary edge on a Solid.
 *
 * @param {any} solid Target solid to receive the aux edge (overlay)
 * @param {any} edgeObj Edge to analyze (must belong to `solid`)
 * @param {number} radius Fillet radius (>0)
 * @param {'INSET'|'OUTSET'} sideMode Side preference
 * @param {string} name Edge name (default 'FILLET_CENTERLINE')
 * @param {object} [options] Additional aux edge options
 * @param {boolean} [options.closedLoop=false] Render as closed loop when visualized
 * @param {boolean} [options.polylineWorld=false] Whether points are already in world space
 * @param {'OVERLAY'|'BASE'|string} [options.materialKey='OVERLAY'] Visualization material tag
 * @returns {{ points: {x:number,y:number,z:number}[], closedLoop: boolean } | null}
 */
export function attachFilletCenterlineAuxEdge(solid, edgeObj, radius = 1, sideMode = 'INSET', name = 'FILLET_CENTERLINE', options = {}) {
    try {
        if (!solid || !edgeObj) return null;
        const res = computeFilletCenterlineForEdge(edgeObj, radius, sideMode);
        if (res && Array.isArray(res.points) && res.points.length >= 2) {
            const opts = { materialKey: 'OVERLAY', closedLoop: !!res.closedLoop, ...(options || {}) };
            solid.addAuxEdge(name, res.points, opts);
            return res;
        }
        return null;
    } catch (e) {
        console.warn('[attachFilletCenterlineAuxEdge] failed:', e?.message || e);
        return null;
    }
}


// Functional API: builds fillet tube and wedge and returns them.
export function filletSolid({
    edgeToFillet,
    radius = 1,
    sideMode = 'INSET',
    debug = false,
    name = 'fillet',
    inflate = 0.1,
    nudgeFaceDistance = 0.0001,
    resolution = 32,
    showTangentOverlays = false,
    baseSnapshot = null,
} = {}) {
    try {
    // Validate inputs
        if (!edgeToFillet) {
            throw new Error('filletSolid: edgeToFillet is required');
        }
        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error(`filletSolid: radius must be a positive number, got ${radius}`);
        }

        const side = normalizeFilletSideMode(sideMode);
        let radiusUsed = radius;
        const tubeResolution = (Number.isFinite(Number(resolution)) && Number(resolution) > 0)
            ? Math.max(8, Math.floor(Number(resolution)))
            : 32;
        const faceNudgeDistance = Number.isFinite(Number(nudgeFaceDistance))
            ? Number(nudgeFaceDistance)
            : 0.0001;
        const logDebug = (...args) => { if (debug) console.log(...args); };
        logDebug(`🔧 Starting fillet operation: edge=${edgeToFillet?.name || 'unnamed'}, radius=${radiusUsed}, side=${side}`);
        const segmentFacePairs = Array.isArray(edgeToFillet?.userData?.segmentFacePairs)
            ? edgeToFillet.userData.segmentFacePairs
            : null;
        requireNativeFilletEdgeBuilder();
        let nativeEdge = buildFilletEdgeNativeStandard({
            edgeObj: edgeToFillet,
            radius: radiusUsed,
            sideMode: side,
            name,
            inflate,
            nudgeFaceDistance: faceNudgeDistance,
            resolution: tubeResolution,
            snapshot: baseSnapshot,
            segmentFacePairs,
        });
        if (nativeEdge.radiusClamp && Number.isFinite(nativeEdge.radiusClamp.maxAllowed)) {
            const maxAllowed = nativeEdge.radiusClamp.maxAllowed;
            if (maxAllowed > 0 && maxAllowed < radiusUsed * 0.999) {
                const adjusted = Math.max(maxAllowed * 0.999, 1e-9);
                if (adjusted < radiusUsed) {
                    console.warn('[filletSolid] Requested radius exceeds face extents; clamping.', {
                        edge: edgeToFillet?.name || 'unnamed',
                        requested: radiusUsed,
                        clamped: adjusted,
                        maxAllowed,
                    });
                    radiusUsed = adjusted;
                    nativeEdge = buildFilletEdgeNativeStandard({
                        edgeObj: edgeToFillet,
                        radius: radiusUsed,
                        sideMode: side,
                        name,
                        inflate,
                        nudgeFaceDistance: faceNudgeDistance,
                        resolution: tubeResolution,
                        snapshot: baseSnapshot,
                        segmentFacePairs,
                    });
                }
            }
        }

        const centerlineCopy = Array.isArray(nativeEdge?.centerline) ? nativeEdge.centerline : [];
        const tangentACopy = Array.isArray(nativeEdge?.tangentA) ? nativeEdge.tangentA : [];
        const tangentBCopy = Array.isArray(nativeEdge?.tangentB) ? nativeEdge.tangentB : [];
        const edgeCopy = Array.isArray(nativeEdge?.edge) ? nativeEdge.edge : [];
        const edgeWedgeCopy = Array.isArray(nativeEdge?.edgeWedge) ? nativeEdge.edgeWedge : [];
        const tangentASnap = Array.isArray(nativeEdge?.tangentASeam) ? nativeEdge.tangentASeam : tangentACopy;
        const tangentBSnap = Array.isArray(nativeEdge?.tangentBSeam) ? nativeEdge.tangentBSeam : tangentBCopy;
        const closedLoop = !!nativeEdge?.closedLoop;
        const tubeCapPointsBeforeNudge = nativeEdge?.tubeCapPointsBeforeNudge || { start: [], end: [] };

        const filletTube = solidFromSnapshot(nativeEdge?.tubeSnapshot, `${name}_TUBE`);
        const wedgeSolid = solidFromSnapshot(nativeEdge?.wedgeSnapshot, `${name}_WEDGE`);
        const finalSolid = solidFromSnapshot(nativeEdge?.finalSnapshot, `${name}_FINAL_FILLET`);
        if (!filletTube || !wedgeSolid || !finalSolid) {
            throw new Error('Native fillet edge builder returned incomplete snapshots.');
        }

        if (showTangentOverlays) {
            const auxOpts = { materialKey: 'OVERLAY', closedLoop };
            if (Array.isArray(tangentASnap) && tangentASnap.length >= 2) {
                filletTube.addAuxEdge(`${name}_TANGENT_A_PATH`, tangentASnap, auxOpts);
                finalSolid.addAuxEdge(`${name}_TANGENT_A_PATH`, tangentASnap, auxOpts);
            }
            if (Array.isArray(tangentBSnap) && tangentBSnap.length >= 2) {
                filletTube.addAuxEdge(`${name}_TANGENT_B_PATH`, tangentBSnap, auxOpts);
                finalSolid.addAuxEdge(`${name}_TANGENT_B_PATH`, tangentBSnap, auxOpts);
            }
        }

        if (debug) {
            try { wedgeSolid.visualize(); } catch { }
            try { finalSolid.visualize(); } catch { }
        }

        return createFilletResultPayload({
            tube: filletTube,
            wedge: wedgeSolid,
            finalSolid,
            tubeSnapshot: nativeEdge?.tubeSnapshot || null,
            wedgeSnapshot: nativeEdge?.wedgeSnapshot || null,
            finalSnapshot: nativeEdge?.finalSnapshot || null,
            centerline: centerlineCopy,
            tangentA: tangentACopy,
            tangentB: tangentBCopy,
            edge: edgeCopy,
            edgeWedge: edgeWedgeCopy,
            tangentASeam: tangentASnap,
            tangentBSeam: tangentBSnap,
            tubeCapPointsBeforeNudge,
        });
    } catch (globalError) {
        console.error('Fillet operation failed completely:', globalError?.message || globalError);
        return createFilletResultPayload({
            error: `Fillet operation failed: ${globalError?.message || globalError}`,
        });
    }
}

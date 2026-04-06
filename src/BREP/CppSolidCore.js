import { Manifold } from "./SolidShared.js";
import { manifold } from "./setupManifold.js";

const parseMetadataJson = (raw) => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
};

const cloneSnapshotEntries = (entries = []) => Array.from(entries || [], (entry) => [
    entry?.[0],
    entry?.[1],
]);

const toPlainEntryArray = (mapLike, serializer = (value) => value) => {
    if (!(mapLike instanceof Map)) return [];
    return Array.from(mapLike.entries(), ([key, value]) => [key, serializer(value)]);
};

const serializeMetadata = (metadata) => JSON.stringify(metadata && typeof metadata === "object" ? metadata : {});

const rebuildVertexKeyMap = (vertProperties = [], numProp = 3) => {
    const map = new Map();
    const stride = Math.max(3, Number(numProp) || 3);
    for (let i = 0; i + 2 < vertProperties.length; i += stride) {
        const x = vertProperties[i + 0];
        const y = vertProperties[i + 1];
        const z = vertProperties[i + 2];
        map.set(`${x},${y},${z}`, (i / stride) | 0);
    }
    return map;
};

const captureSolidCppSyncStamp = (solid) => ({
    numProp: Number(solid?._numProp ?? 3),
    vertPropertiesRef: solid?._vertProperties || null,
    vertPropertiesLength: Array.isArray(solid?._vertProperties) ? solid._vertProperties.length : 0,
    triVertsRef: solid?._triVerts || null,
    triVertsLength: Array.isArray(solid?._triVerts) ? solid._triVerts.length : 0,
    triIDsRef: solid?._triIDs || null,
    triIDsLength: Array.isArray(solid?._triIDs) ? solid._triIDs.length : 0,
    faceNameToIDRef: solid?._faceNameToID || null,
    faceNameToIDSize: solid?._faceNameToID instanceof Map ? solid._faceNameToID.size : 0,
    idToFaceNameRef: solid?._idToFaceName || null,
    idToFaceNameSize: solid?._idToFaceName instanceof Map ? solid._idToFaceName.size : 0,
    faceMetadataRef: solid?._faceMetadata || null,
    faceMetadataSize: solid?._faceMetadata instanceof Map ? solid._faceMetadata.size : 0,
    edgeMetadataRef: solid?._edgeMetadata || null,
    edgeMetadataSize: solid?._edgeMetadata instanceof Map ? solid._edgeMetadata.size : 0,
    auxEdgesRef: solid?._auxEdges || null,
    auxEdgesLength: Array.isArray(solid?._auxEdges) ? solid._auxEdges.length : 0,
    faceMetadataVersion: Number(solid?._faceMetadataVersion || 0),
    edgeMetadataVersion: Number(solid?._edgeMetadataVersion || 0),
    dirty: !!solid?._dirty,
});

const solidCppSyncStampEquals = (a, b) => !!a && !!b
    && a.numProp === b.numProp
    && a.vertPropertiesRef === b.vertPropertiesRef
    && a.vertPropertiesLength === b.vertPropertiesLength
    && a.triVertsRef === b.triVertsRef
    && a.triVertsLength === b.triVertsLength
    && a.triIDsRef === b.triIDsRef
    && a.triIDsLength === b.triIDsLength
    && a.faceNameToIDRef === b.faceNameToIDRef
    && a.faceNameToIDSize === b.faceNameToIDSize
    && a.idToFaceNameRef === b.idToFaceNameRef
    && a.idToFaceNameSize === b.idToFaceNameSize
    && a.faceMetadataRef === b.faceMetadataRef
    && a.faceMetadataSize === b.faceMetadataSize
    && a.edgeMetadataRef === b.edgeMetadataRef
    && a.edgeMetadataSize === b.edgeMetadataSize
    && a.auxEdgesRef === b.auxEdgesRef
    && a.auxEdgesLength === b.auxEdgesLength
    && a.faceMetadataVersion === b.faceMetadataVersion
    && a.edgeMetadataVersion === b.edgeMetadataVersion
    && a.dirty === b.dirty;

export const cppSolidCoreHasAuthoringBridge = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.setAuthoringState === "function"
                && typeof probe.bakeTransform === "function"
                && typeof probe.getAuthoringState === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeWeldVerticesByEpsilon = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.weldVerticesByEpsilon === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeOffsetFace = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.offsetFace === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativePushFace = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.pushFace === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeManifoldPrep = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.prepareManifoldMesh === "function"
                && typeof probe.isCoherentlyOrientedManifold === "function"
                && typeof probe.fixTriangleWindingsByAdjacency === "function"
                && typeof probe.invertNormals === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeFaceTracking = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.normalizeFaceTracking === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeTopologyQueries = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.getFace === "function"
                && typeof probe.getFaces === "function"
                && typeof probe.getBoundaryEdgePolylines === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeFilletCenterlineQuery = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.computeFilletCenterline === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeAuxEdgeMutation = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.addAuxEdge === "function"
                && typeof probe.getAuxEdges === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeMetadataTransform = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.transformMetadata === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeTinyFaceIslandCleanup = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.cleanupTinyFaceIslands === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeSmallIslandCleanup = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.removeSmallIslands === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeTinyFaceMerge = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.mergeTinyFaces === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeInternalTriangleCleanup = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.removeInternalTriangles === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const cppSolidCoreHasNativeDisconnectedIslandCleanup = (() => {
    try {
        if (typeof manifold?.BrepSolidCore !== "function") return false;
        const probe = new manifold.BrepSolidCore();
        try {
            return typeof probe.removeDisconnectedIslandsByVolume === "function";
        } finally {
            if (typeof probe.delete === "function") probe.delete();
        }
    } catch {
        return false;
    }
})();

export const requireCppSolidCoreCapability = (supported, methodName) => {
    if (supported) return;
    throw new Error(`${methodName} requires the custom local manifold build with BrepSolidCore support.`);
};

export const buildSolidAuthoringStateSnapshot = (solid) => ({
    numProp: Number(solid?._numProp ?? 3),
    vertProperties: Array.from(solid?._vertProperties ?? []),
    triVerts: Array.from(solid?._triVerts ?? []),
    triIDs: Array.from(solid?._triIDs ?? []),
    faceNameToID: toPlainEntryArray(solid?._faceNameToID),
    idToFaceName: toPlainEntryArray(solid?._idToFaceName),
    faceMetadataJson: toPlainEntryArray(solid?._faceMetadata, serializeMetadata),
    edgeMetadataJson: toPlainEntryArray(solid?._edgeMetadata, serializeMetadata),
    auxEdges: sanitizeAuxEdges(solid?._auxEdges),
});

const cloneSnapshotMapEntries = (mapLike) => new Map(cloneSnapshotEntries(mapLike));

const normalizeFilletSideMode = (sideMode = "INSET") =>
    String(sideMode || "INSET").toUpperCase() === "OUTSET" ? "OUTSET" : "INSET";

const point3ArrayFromAny = (point) => {
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
};

const point3ObjectFromAny = (point) => {
    const arr = point3ArrayFromAny(point);
    if (!arr) return null;
    return { x: arr[0], y: arr[1], z: arr[2] };
};

const sanitizeAuxEdges = (auxEdges) => {
    const source = Array.isArray(auxEdges) ? auxEdges : [];
    const out = [];
    for (const aux of source) {
        const points = Array.isArray(aux?.points)
            ? aux.points.map((point) => point3ArrayFromAny(point)).filter(Boolean)
            : [];
        if (points.length < 2) continue;
        const entry = {
            name: String(aux?.name || "EDGE"),
            points,
            closedLoop: !!aux?.closedLoop,
            polylineWorld: !!aux?.polylineWorld,
            centerline: !!aux?.centerline,
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
};

const sanitizeFilletInputPolyline = (polylineLocal, tolerance = 1e-9) => {
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
        if (out.length > 0) {
            const prev = out[out.length - 1];
            const dx = pt[0] - prev[0];
            const dy = pt[1] - prev[1];
            const dz = pt[2] - prev[2];
            if (((dx * dx) + (dy * dy) + (dz * dz)) <= tol2) continue;
        }
        out.push(pt);
    }
    if (out.length < 3) return out;

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
    const adaptiveTol = Math.max(tol, totalLen * 1e-7, maxSegLen * 1e-6);
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
};

const invertFaceNameToIDEntries = (entries = []) => {
    const idToFaceName = new Map();
    for (const [faceName, id] of cloneSnapshotEntries(entries)) {
        idToFaceName.set(id, faceName);
    }
    return idToFaceName;
};

const buildResolvedSnapshotIDToFaceName = (snapshot) => {
    const triIDs = Array.from(snapshot?.triIDs ?? []);
    const triIDSet = new Set(triIDs);
    const triIDsSorted = Array.from(triIDSet).sort((a, b) => Number(a) - Number(b));

    let idToFaceName = new Map(cloneSnapshotEntries(snapshot?.idToFaceName));
    if (idToFaceName.size === 0) {
        idToFaceName = invertFaceNameToIDEntries(snapshot?.faceNameToID);
    }

    const coversAllTriangleIDs = triIDsSorted.every((id) => idToFaceName.has(id));
    if (coversAllTriangleIDs || triIDsSorted.length === 0) {
        return idToFaceName;
    }

    if (idToFaceName.size === triIDsSorted.length) {
        const orderedNames = Array.from(idToFaceName.entries())
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map((entry) => String(entry?.[1] || ""));
        const resolved = new Map();
        for (let i = 0; i < triIDsSorted.length; i++) {
            resolved.set(triIDsSorted[i], orderedNames[i] || `FACE_${triIDsSorted[i]}`);
        }
        return resolved;
    }

    for (const id of triIDsSorted) {
        if (!idToFaceName.has(id)) idToFaceName.set(id, `FACE_${id}`);
    }
    return idToFaceName;
};

const remapSnapshotFaceIDsToReservedRange = (snapshot) => {
    const sourceIDToFaceName = buildResolvedSnapshotIDToFaceName(snapshot);

    const remappedFaceNameToID = new Map();
    const remappedIDToFaceName = new Map();
    const idRemap = new Map();
    const ensureReservedID = (rawId, fallbackName = "") => {
        const key = Number(rawId);
        if (idRemap.has(key)) return idRemap.get(key);
        const reservedID = Manifold.reserveIDs(1);
        idRemap.set(key, reservedID);
        const faceName = String(sourceIDToFaceName.get(rawId) ?? fallbackName ?? "").trim() || `FACE_${reservedID}`;
        remappedIDToFaceName.set(reservedID, faceName);
        remappedFaceNameToID.set(faceName, reservedID);
        return reservedID;
    };

    for (const [rawId, faceName] of sourceIDToFaceName.entries()) {
        ensureReservedID(rawId, faceName);
    }

    const remappedTriIDs = Array.from(snapshot?.triIDs ?? [], (rawId) => ensureReservedID(rawId, sourceIDToFaceName.get(rawId)));

    return {
        triIDs: remappedTriIDs,
        faceNameToID: remappedFaceNameToID,
        idToFaceName: remappedIDToFaceName,
    };
};

export const applySolidAuthoringStateSnapshot = (solid, snapshot, opts = {}) => {
    const numProp = Math.max(3, Number(snapshot?.numProp ?? 3));
    const vertProperties = Array.from(snapshot?.vertProperties ?? []);
    let remappedIDs = null;
    if (opts?.remapFaceIDs) {
        if (cppSolidCoreHasNativeFaceTracking) {
            const core = new manifold.BrepSolidCore();
            try {
                core.setAuthoringState(snapshot);
                core.normalizeFaceTracking();
                const normalized = core.getAuthoringState();
                remappedIDs = {
                    triIDs: Array.from(normalized?.triIDs ?? []),
                    faceNameToID: new Map(cloneSnapshotEntries(normalized?.faceNameToID)),
                    idToFaceName: new Map(cloneSnapshotEntries(normalized?.idToFaceName)),
                };
            } finally {
                if (typeof core.delete === "function") core.delete();
            }
        } else {
            remappedIDs = remapSnapshotFaceIDsToReservedRange(snapshot);
        }
    }
    solid._numProp = numProp;
    solid._vertProperties = vertProperties;
    solid._triVerts = Array.from(snapshot?.triVerts ?? []);
    solid._triIDs = remappedIDs ? remappedIDs.triIDs : Array.from(snapshot?.triIDs ?? []);
    solid._faceNameToID = remappedIDs ? remappedIDs.faceNameToID : new Map(cloneSnapshotEntries(snapshot?.faceNameToID));
    solid._idToFaceName = remappedIDs ? remappedIDs.idToFaceName : new Map(cloneSnapshotEntries(snapshot?.idToFaceName));
    solid._faceMetadata = new Map(Array.from(snapshot?.faceMetadataJson ?? [], (entry) => [
        entry?.[0],
        parseMetadataJson(entry?.[1]),
    ]));
    solid._edgeMetadata = new Map(Array.from(snapshot?.edgeMetadataJson ?? [], (entry) => [
        entry?.[0],
        parseMetadataJson(entry?.[1]),
    ]));
    solid._auxEdges = sanitizeAuxEdges(snapshot?.auxEdges);
    solid._vertKeyToIndex = rebuildVertexKeyMap(vertProperties, numProp);
    solid._faceMetadataVersion = Number(solid?._faceMetadataVersion || 0) + 1;
    solid._edgeMetadataVersion = Number(solid?._edgeMetadataVersion || 0) + 1;
    solid._cppSolidCoreSyncStamp = null;
};

export const syncSolidAuthoringStateToCpp = (solid, core) => {
    core.setAuthoringState(buildSolidAuthoringStateSnapshot(solid));
    solid._cppSolidCoreSyncStamp = captureSolidCppSyncStamp(solid);
    return core;
};

export const syncSolidAuthoringStateFromCpp = (solid, core) => {
    const snapshot = core.getAuthoringState();
    applySolidAuthoringStateSnapshot(solid, snapshot);
    solid._cppSolidCoreSyncStamp = captureSolidCppSyncStamp(solid);
    return snapshot;
};

export const syncSolidAuxEdgesFromCpp = (solid, core) => {
    solid._auxEdges = core.getAuxEdges();
    solid._cppSolidCoreSyncStamp = captureSolidCppSyncStamp(solid);
    return solid._auxEdges;
};

export const getSolidAuthoringStateSnapshot = (solid) => {
    if (cppSolidCoreHasAuthoringBridge) {
        try {
            return getSyncedCppSolidCore(solid).getAuthoringState();
        } catch {
            // Fall through to the JS-side snapshot when the native bridge is unavailable.
        }
    }
    const snapshot = buildSolidAuthoringStateSnapshot(solid);
    return {
        numProp: Number(snapshot?.numProp ?? 3),
        vertProperties: Array.from(snapshot?.vertProperties ?? []),
        triVerts: Array.from(snapshot?.triVerts ?? []),
        triIDs: Array.from(snapshot?.triIDs ?? []),
        faceNameToID: cloneSnapshotMapEntries(snapshot?.faceNameToID),
        idToFaceName: cloneSnapshotMapEntries(snapshot?.idToFaceName),
        faceMetadataJson: cloneSnapshotMapEntries(snapshot?.faceMetadataJson),
        edgeMetadataJson: cloneSnapshotMapEntries(snapshot?.edgeMetadataJson),
        auxEdges: sanitizeAuxEdges(snapshot?.auxEdges),
        vertexCount: Math.floor((Array.isArray(snapshot?.vertProperties) ? snapshot.vertProperties.length : 0) / Math.max(3, Number(snapshot?.numProp ?? 3))),
        triangleCount: Math.floor((Array.isArray(snapshot?.triVerts) ? snapshot.triVerts.length : 0) / 3),
    };
};

export const getSyncedCppSolidCore = (solid) => {
    requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "BrepSolidCore");
    solid._cppSolidCore = solid._cppSolidCore || new CppSolidCore();
    const nextStamp = captureSolidCppSyncStamp(solid);
    if (!solidCppSyncStampEquals(nextStamp, solid._cppSolidCoreSyncStamp)) {
        syncSolidAuthoringStateToCpp(solid, solid._cppSolidCore);
    }
    return solid._cppSolidCore;
};

export const computeFilletCenterlineForEdge = (edgeObj, radius = 1, sideMode = "INSET") => {
    const out = { points: [], tangentA: [], tangentB: [], edge: [], closedLoop: false };
    try {
        requireCppSolidCoreCapability(
            cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeFilletCenterlineQuery,
            "Solid.computeFilletCenterline()",
        );
        if (!edgeObj || !Number.isFinite(radius) || radius <= 0) return out;
        const solid = edgeObj.parentSolid || edgeObj.parent || null;
        if (!solid) return out;

        const faceAName = edgeObj?.faces?.[0]?.name || edgeObj?.userData?.faceA || null;
        const faceBName = edgeObj?.faces?.[1]?.name || edgeObj?.userData?.faceB || null;
        const segmentFacePairs = Array.isArray(edgeObj?.userData?.segmentFacePairs)
            ? edgeObj.userData.segmentFacePairs
            : null;
        const useSegmentPairs = Array.isArray(segmentFacePairs) && segmentFacePairs.length > 0;
        if (!useSegmentPairs && (!faceAName || !faceBName)) return out;

        const distTol = Math.max(1e-12, Math.abs(Number(radius) || 0) * 1e-9, 1e-9);
        const polyLocal = sanitizeFilletInputPolyline(edgeObj?.userData?.polylineLocal, distTol);
        if (!Array.isArray(polyLocal) || polyLocal.length < 2) return out;

        let isClosed = !!(edgeObj?.closedLoop || edgeObj?.userData?.closedLoop);
        if (!isClosed && polyLocal.length > 2) {
            const a = polyLocal[0];
            const b = polyLocal[polyLocal.length - 1];
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            const dz = a[2] - b[2];
            if (((dx * dx) + (dy * dy) + (dz * dz)) <= (distTol * distTol)) {
                isClosed = true;
            }
        }

        const payload = {
            polyline: polyLocal,
            radius: Number(radius),
            sideMode: normalizeFilletSideMode(sideMode),
            closedLoop: !!isClosed,
        };
        if (faceAName) payload.faceAName = faceAName;
        if (faceBName) payload.faceBName = faceBName;
        if (useSegmentPairs) payload.segmentFacePairs = segmentFacePairs;

        const result = getSyncedCppSolidCore(solid).computeFilletCenterline(payload);
        if (!result || typeof result !== "object") return out;

        out.nativeKernel = result.nativeKernel === true;
        out.closedLoop = !!result.closedLoop;
        out.points = Array.isArray(result.points) ? result.points.map(point3ObjectFromAny).filter(Boolean) : [];
        out.tangentA = Array.isArray(result.tangentA) ? result.tangentA.map(point3ObjectFromAny).filter(Boolean) : [];
        out.tangentB = Array.isArray(result.tangentB) ? result.tangentB.map(point3ObjectFromAny).filter(Boolean) : [];
        out.edge = Array.isArray(result.edge) ? result.edge.map(point3ObjectFromAny).filter(Boolean) : [];
        if (result.radiusClamp) out.radiusClamp = result.radiusClamp;
        if (result.nativeFinalized === true) out.nativeFinalized = true;
        return out;
    } catch (error) {
        console.warn("[computeFilletCenterlineForEdge] failed:", error?.message || error);
        return out;
    }
};

export class CppSolidCore {
    constructor(nativeCore = null) {
        if (nativeCore) {
            this._native = nativeCore;
            return;
        }
        if (typeof manifold?.BrepSolidCore !== "function") {
            throw new Error("BrepSolidCore is only available in the custom local manifold build.");
        }
        this._native = new manifold.BrepSolidCore();
    }

    clear() {
        this._native.clear();
        return this;
    }

    setAuthoringState(state) {
        this._native.setAuthoringState(state);
        return this;
    }

    addTriangle(faceName, v1, v2, v3) {
        this._native.addTriangle(faceName, v1, v2, v3);
        return this;
    }

    setFaceMetadata(faceName, metadata = {}) {
        this._native.setFaceMetadataJson(faceName, JSON.stringify(metadata || {}));
        return this;
    }

    getFaceMetadata(faceName) {
        return parseMetadataJson(this._native.getFaceMetadataJson(faceName));
    }

    renameFace(oldFaceName, newFaceName) {
        return !!this._native.renameFace(oldFaceName, newFaceName);
    }

    cleanupTinyFaceIslands(maxArea) {
        return Number(this._native.cleanupTinyFaceIslands(maxArea));
    }

    removeSmallIslands(maxTriangles, removeInternal = true, removeExternal = true) {
        return Number(this._native.removeSmallIslands(
            Math.max(0, Number(maxTriangles) | 0),
            !!removeInternal,
            !!removeExternal,
        ));
    }

    mergeTinyFaces(maxArea) {
        return Number(this._native.mergeTinyFaces(maxArea));
    }

    removeInternalTriangles() {
        return Number(this._native.removeInternalTriangles());
    }

    removeDisconnectedIslandsByVolume(minVolume) {
        return Number(this._native.removeDisconnectedIslandsByVolume(minVolume));
    }

    normalizeFaceTracking() {
        this._native.normalizeFaceTracking();
        return this;
    }

    setEdgeMetadata(edgeName, metadata = {}) {
        this._native.setEdgeMetadataJson(edgeName, JSON.stringify(metadata || {}));
        return this;
    }

    getEdgeMetadata(edgeName) {
        return parseMetadataJson(this._native.getEdgeMetadataJson(edgeName));
    }

    getFaceNames() {
        return Array.from(this._native.getFaceNames() || []);
    }

    getFace(faceName) {
        return Array.from(this._native.getFace(faceName) || [], (tri) => ({
            faceName: String(tri?.faceName || faceName || ""),
            indices: Array.from(tri?.indices || []),
            p1: Array.from(tri?.p1 || []),
            p2: Array.from(tri?.p2 || []),
            p3: Array.from(tri?.p3 || []),
        }));
    }

    getFaces(includeEmpty = false) {
        return Array.from(this._native.getFaces(!!includeEmpty) || [], (face) => ({
            faceName: String(face?.faceName || ""),
            triangles: Array.from(face?.triangles || [], (tri) => ({
                faceName: String(tri?.faceName || face?.faceName || ""),
                indices: Array.from(tri?.indices || []),
                p1: Array.from(tri?.p1 || []),
                p2: Array.from(tri?.p2 || []),
                p3: Array.from(tri?.p3 || []),
            })),
        }));
    }

    getBoundaryEdgePolylines() {
        return Array.from(this._native.getBoundaryEdgePolylines() || [], (edge) => ({
            name: String(edge?.name || ""),
            faceA: String(edge?.faceA || ""),
            faceB: String(edge?.faceB || ""),
            indices: Array.from(edge?.indices || []),
            positions: Array.from(edge?.positions || [], (point) => Array.from(point || [])),
            closedLoop: !!edge?.closedLoop,
        }));
    }

    addAuxEdge(name, points, options = {}) {
        this._native.addAuxEdge(String(name || "EDGE"), points || [], options || {});
        return this;
    }

    setAuxEdges(auxEdges = []) {
        this._native.setAuxEdges(sanitizeAuxEdges(auxEdges));
        return this;
    }

    getAuxEdges() {
        return sanitizeAuxEdges(this._native.getAuxEdges() || []);
    }

    computeFilletCenterline(options = {}) {
        const result = this._native.computeFilletCenterline(options || {});
        return {
            points: Array.from(result?.points || [], (point) => point3ObjectFromAny(point)).filter(Boolean),
            tangentA: Array.from(result?.tangentA || [], (point) => point3ObjectFromAny(point)).filter(Boolean),
            tangentB: Array.from(result?.tangentB || [], (point) => point3ObjectFromAny(point)).filter(Boolean),
            edge: Array.from(result?.edge || [], (point) => point3ObjectFromAny(point)).filter(Boolean),
            closedLoop: !!result?.closedLoop,
            radiusClamp: result?.radiusClamp || null,
            nativeKernel: result?.nativeKernel === true,
            nativeFinalized: result?.nativeFinalized === true,
        };
    }

    getAuthoringState() {
        const snapshot = this._native.getAuthoringState();
        return {
            numProp: Number(snapshot?.numProp ?? 3),
            vertProperties: Array.from(snapshot?.vertProperties ?? []),
            triVerts: Array.from(snapshot?.triVerts ?? []),
            triIDs: Array.from(snapshot?.triIDs ?? []),
            faceNameToID: new Map(cloneSnapshotEntries(snapshot?.faceNameToID)),
            idToFaceName: new Map(cloneSnapshotEntries(snapshot?.idToFaceName)),
            faceMetadataJson: new Map(cloneSnapshotEntries(snapshot?.faceMetadataJson)),
            edgeMetadataJson: new Map(cloneSnapshotEntries(snapshot?.edgeMetadataJson)),
            auxEdges: sanitizeAuxEdges(snapshot?.auxEdges),
            vertexCount: Number(snapshot?.vertexCount ?? 0),
            triangleCount: Number(snapshot?.triangleCount ?? 0),
        };
    }

    bakeTransform(matrix) {
        const values = (matrix && typeof matrix === "object" && "elements" in matrix)
            ? Array.from(matrix.elements || [])
            : Array.from(matrix || []);
        this._native.bakeTransform(values);
        return this;
    }

    transformMetadata(matrix) {
        const values = (matrix && typeof matrix === "object" && "elements" in matrix)
            ? Array.from(matrix.elements || [])
            : Array.from(matrix || []);
        this._native.transformMetadata(values);
        return this;
    }

    weldVerticesByEpsilon(epsilon) {
        this._native.weldVerticesByEpsilon(epsilon);
        return this;
    }

    offsetFace(faceName, distance) {
        return this._native.offsetFace(faceName, distance);
    }

    pushFace(faceName, distance) {
        return this._native.pushFace(faceName, distance);
    }

    isCoherentlyOrientedManifold() {
        return !!this._native.isCoherentlyOrientedManifold();
    }

    fixTriangleWindingsByAdjacency() {
        return !!this._native.fixTriangleWindingsByAdjacency();
    }

    invertNormals() {
        this._native.invertNormals();
        return this;
    }

    prepareManifoldMesh() {
        const snapshot = this._native.prepareManifoldMesh();
        return {
            numProp: Number(snapshot?.numProp ?? 3),
            vertProperties: Array.from(snapshot?.vertProperties ?? []),
            triVerts: Array.from(snapshot?.triVerts ?? []),
            faceID: Array.from(snapshot?.faceID ?? []),
            mergeFromVert: Array.from(snapshot?.mergeFromVert ?? []),
            mergeToVert: Array.from(snapshot?.mergeToVert ?? []),
            vertexCount: Number(snapshot?.vertexCount ?? 0),
            triangleCount: Number(snapshot?.triangleCount ?? 0),
        };
    }

    vertexCount() {
        return Number(this._native.vertexCount());
    }

    triangleCount() {
        return Number(this._native.triangleCount());
    }

    dispose() {
        try {
            if (this._native && typeof this._native.delete === "function") {
                this._native.delete();
            }
        } finally {
            this._native = null;
        }
    }
}

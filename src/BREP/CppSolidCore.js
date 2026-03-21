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

export class CppSolidCore {
    constructor(nativeCore = null) {
        this._native = nativeCore || new manifold.BrepSolidCore();
    }

    clear() {
        this._native.clear();
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

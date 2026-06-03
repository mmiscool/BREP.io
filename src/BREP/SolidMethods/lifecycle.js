/**
 * Solid lifecycle helpers: constructor, cloning, resource cleanup.
 */
import {
    applySolidAuthoringStateSnapshot,
    getSolidAuthoringStateSnapshot,
} from "../CppSolidCore.js";

export function constructorImpl() {
    // Geometry data (MeshGL layout, but we build incrementally in JS arrays)
    this._numProp = 3;                // x,y,z
    this._vertProperties = [];        // flat [x0,y0,z0, x1,y1,z1, ...]
    this._triVerts = [];              // flat [i0,i1,i2, i3,i4,i5, ...]
    this._triIDs = [];                // per-triangle Manifold ID (mapped from faceName)

    // Vertex uniquing
    this._vertKeyToIndex = new Map(); // "x,y,z" -> index

    // Face name <-> Manifold ID
    this._faceNameToID = new Map();
    this._idToFaceName = new Map();

    // Face and edge metadata storage
    this._faceMetadata = new Map(); // faceName -> metadata object
    this._edgeMetadata = new Map(); // edgeName -> metadata object
    this._faceMetadataVersion = 0;
    this._edgeMetadataVersion = 0;

    // Laziness & caching
    this._dirty = true;               // arrays changed and manifold needs rebuild
    this._manifold = null;            // cached Manifold object built from arrays
    this._faceIndex = null;           // lazy cache: id -> [triIndices]
    this._visualizeCache = null;      // last rendered topology/options signature
    this._minGapIndex = null;         // cached triangle spatial index for point-gap queries
    this._epsilon = 0;                // optional vertex weld tolerance (off by default)
    this._freeTimer = null;           // handle for scheduled wasm cleanup
    this._cppSolidCore = null;        // optional reusable native authoring bridge
    this._cppSolidCoreSyncStamp = null;

    this.type = 'SOLID';
    this.renderOrder = 1;
    // Custom auxiliary edges (e.g., centerlines) to visualize with this solid
    // Each item: { name?:string, points:[[x,y,z],...], closedLoop?:boolean, polylineWorld?:boolean, materialKey?:'OVERLAY'|'BASE', centerline?:boolean }
    this._auxEdges = [];
}

/**
 * Create a lightweight clone of this Solid that copies geometry arrays
 * and face maps, but not children or any THREE resources.
 */
export function clone() {
    const Solid = this.constructor;
    const s = new Solid();
    applySolidAuthoringStateSnapshot(s, getSolidAuthoringStateSnapshot(this));
    s._dirty = true;
    s._manifold = null;
    s._faceIndex = null;
    s._visualizeCache = null;
    s._minGapIndex = null;
    s._cppSolidCore = null;
    s._cppSolidCoreSyncStamp = null;
    s.type = 'SOLID';
    s.renderOrder = this.renderOrder;
    return s;
}

/**
 * Free wasm resources associated with this Solid.
 *
 * Disposes the underlying Manifold instance (if any) to prevent
 * accumulating wasm memory across rebuilds. After calling free(),
 * the Solid remains usable - any subsequent call that needs the
 * manifold will trigger a fresh _manifoldize().
 */
export function free() {
    try {
        // Clear any pending auto-free timer first
        try { if (this._freeTimer) { clearTimeout(this._freeTimer); } } catch (_) { }
        this._freeTimer = null;
        if (this._manifold) {
            try { if (typeof this._manifold.delete === 'function') this._manifold.delete(); } catch (_) { }
            this._manifold = null;
        }
        if (this._cppSolidCore) {
            try { if (typeof this._cppSolidCore.dispose === 'function') this._cppSolidCore.dispose(); } catch (_) { }
            this._cppSolidCore = null;
        }
        this._cppSolidCoreSyncStamp = null;
        this._dirty = true;
        this._faceIndex = null;
    } catch (_) { /* noop */ }
    return this;
}

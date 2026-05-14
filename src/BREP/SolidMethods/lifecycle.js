/**
 * Solid lifecycle helpers: constructor, cloning, resource cleanup.
 */

export function constructorImpl() {
    // Legacy authoring buffers retained for metadata, aux-edge, and compatibility paths.
    this._numProp = 3;                // x,y,z
    this._vertProperties = [];        // flat [x0,y0,z0, x1,y1,z1, ...]
    this._triVerts = [];              // flat [i0,i1,i2, i3,i4,i5, ...]
    this._triIDs = [];                // per-triangle face ID (mapped from faceName)

    // Vertex uniquing
    this._vertKeyToIndex = new Map(); // "x,y,z" -> index

    // Face name <-> stable face ID
    this._faceNameToID = new Map();
    this._idToFaceName = new Map();

    // Face and edge metadata storage
    this._faceMetadata = new Map(); // faceName -> metadata object
    this._edgeMetadata = new Map(); // edgeName -> metadata object
    this._faceMetadataVersion = 0;
    this._edgeMetadataVersion = 0;

    // Laziness & caching
    this._dirty = true;
    this._faceIndex = null;           // lazy cache: id -> [triIndices]
    this._epsilon = 0;                // optional vertex weld tolerance (off by default)
    this._freeTimer = null;           // handle for scheduled wasm cleanup
    this._kernel = "opencascade";
    this._occ = null;                 // OpenCASCADE TopoDS_Shape-backed state

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
    s._numProp = this._numProp || 3;
    s._vertProperties = Array.from(this._vertProperties || []);
    s._triVerts = Array.from(this._triVerts || []);
    s._triIDs = Array.from(this._triIDs || []);
    s._vertKeyToIndex = new Map(this._vertKeyToIndex instanceof Map ? this._vertKeyToIndex.entries() : []);
    s._faceNameToID = new Map(this._faceNameToID instanceof Map ? this._faceNameToID.entries() : []);
    s._idToFaceName = new Map(this._idToFaceName instanceof Map ? this._idToFaceName.entries() : []);
    s._faceMetadata = new Map(this._faceMetadata instanceof Map ? this._faceMetadata.entries() : []);
    s._edgeMetadata = new Map(this._edgeMetadata instanceof Map ? this._edgeMetadata.entries() : []);
    s._faceMetadataVersion = this._faceMetadataVersion || 0;
    s._edgeMetadataVersion = this._edgeMetadataVersion || 0;
    s._auxEdges = Array.isArray(this._auxEdges)
        ? this._auxEdges.map((edge) => ({
            ...(edge || {}),
            points: Array.isArray(edge?.points) ? edge.points.map((p) => Array.from(p || [])) : [],
        }))
        : [];
    s._dirty = true;
    s._faceIndex = null;
    s._kernel = this._kernel || "opencascade";
    s._occ = this._occ ? {
        ...this._occ,
        faceNames: Array.from(this._occ.faceNames || []),
        faceMetadata: new Map(this._occ.faceMetadata instanceof Map ? this._occ.faceMetadata.entries() : []),
        edgeMetadata: new Map(this._occ.edgeMetadata instanceof Map ? this._occ.edgeMetadata.entries() : []),
        meshCache: null,
    } : null;
    s.type = 'SOLID';
    s.renderOrder = this.renderOrder;
    return s;
}

/**
 * Free cached resources associated with this Solid.
 */
export function free() {
    try {
        // Clear any pending auto-free timer first
        try { if (this._freeTimer) { clearTimeout(this._freeTimer); } } catch (_) { }
        this._freeTimer = null;
        if (this._occ) this._occ.meshCache = null;
        this._dirty = true;
        this._faceIndex = null;
    } catch (_) { /* noop */ }
    return this;
}

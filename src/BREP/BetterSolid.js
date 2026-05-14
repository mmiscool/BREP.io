/**
 * Solid: OpenCASCADE-backed CAD solid wrapper.
 * Legacy triangle buffers remain only as compatibility data for metadata,
 * visualization snapshots, and older serialized documents.
 */
import * as SolidMethods from "./SolidMethods/index.js";
import {
    THREE,
    debugMode,
} from "./SolidShared.js";
export { Edge, Face, Vertex } from "./SolidShared.js";
/**
 * Solid
 * - Add triangles with a face name.
 * - OCCT state is authoritative for modeling operations.
 * - Face names are mapped to stable IDs for visualization and metadata.
 */
export class Solid extends THREE.Group {
    // Always reconstruct booleans as this base Solid (not subclasses) to avoid
    // re-running primitive generate() when rebuilding from kernel results.
    static BaseSolid = Solid;
    /**
     * Construct an empty Solid with authoring buffers, face/edge metadata, and aux-edge storage initialized.
     */
    constructor() {
        super(...arguments);
        SolidMethods.constructorImpl.apply(this, arguments);
    }

    /**
     * Bake a Matrix4 into authored vertices or OCCT state.
     * @param {THREE.Matrix4|{elements:number[]}} matrix Matrix or matrix-like object
     * @returns {Solid}
     */
    bakeTransform(..._args) {
        return SolidMethods.bakeTransform.apply(this, arguments);
    }

    /**
     * Compose TRS from `{ t, rDeg, s }` and bake it into authored geometry.
     * @param {{t?:number[],rDeg?:number[],s?:number[]}} trs TRS description in degrees
     * @returns {Solid}
     */
    bakeTRS(..._args) {
        return SolidMethods.bakeTRS.apply(this, arguments);
    }

    /**
     * Internal: build the exact vertex deduplication key for a coordinate triple.
     * @param {[number,number,number]} param0
     * @returns {string}
     */
    _key(..._args) {
        return SolidMethods._key.apply(this, arguments);
    }

    /**
     * Internal: fetch or create a vertex index for a point, validating finiteness.
     * @param {number[]|{x:number,y:number,z:number}} p
     * @returns {number} vertex index
     */
    _getPointIndex(..._args) {
        return SolidMethods._getPointIndex.apply(this, arguments);
    }

    /**
     * Internal: map a face name to a stable face ID (creates if missing).
     * @param {string} faceName
     * @returns {number}
     */
    _getOrCreateID(..._args) {
        return SolidMethods._getOrCreateID.apply(this, arguments);
    }

    /**
     * Add a CCW triangle labeled with the given face name to the authoring buffers.
     * @param {string} faceName
     * @param {[number,number,number]} v1
     * @param {[number,number,number]} v2
     * @param {[number,number,number]} v3
     * @returns {Solid}
     */
    addTriangle(..._args) {
        return SolidMethods.addTriangle.apply(this, arguments);
    }

    /**
     * Add an auxiliary polyline (e.g., centerline) to visualize alongside the solid.
     * @param {string} name
     * @param {Array<[number,number,number]>} points
     * @param {object} [options]
     * @param {boolean} [options.closedLoop=false] render as a closed loop when visualized
     * @param {boolean} [options.polylineWorld=false] whether points are already in world space
     * @param {'OVERLAY'|'BASE'|string} [options.materialKey='OVERLAY'] visualization material tag
     * @returns {Solid}
     */
    addAuxEdge(..._args) {
        return SolidMethods.addAuxEdge.apply(this, arguments);
    }

    /**
     * Convenience helper to add a two-point centerline as an auxiliary edge.
     * @param {number[]|{x:number,y:number,z:number}} a
     * @param {number[]|{x:number,y:number,z:number}} b
     * @param {string} [name='CENTERLINE']
     * @param {object} [options]
     * @param {boolean} [options.closedLoop=false] render as a closed loop when visualized
     * @param {boolean} [options.polylineWorld=false] whether points are already in world space
     * @param {'OVERLAY'|'BASE'|string} [options.materialKey='OVERLAY'] visualization material tag
     * @returns {Solid}
     */
    addCenterline(..._args) {
        return SolidMethods.addCenterline.apply(this, arguments);
    }

    /**
     * Merge and set metadata for a face label.
     * @param {string} faceName
     * @param {object} metadata
     * @returns {Solid}
     */
    setFaceMetadata(..._args) {
        return SolidMethods.setFaceMetadata.apply(this, arguments);
    }

    /**
     * Get metadata for a face label (empty object if none).
     * @param {string} faceName
     * @returns {object}
     */
    getFaceMetadata(..._args) {
        return SolidMethods.getFaceMetadata.apply(this, arguments);
    }

    /**
     * Rename a face; if the new name already exists, merge triangles/metadata into it.
     * @param {string} oldName
     * @param {string} newName
     * @returns {Solid}
     */
    renameFace(..._args) {
        return SolidMethods.renameFace.apply(this, arguments);
    }

    /**
     * Merge and set metadata for a boundary edge label.
     * @param {string} edgeName
     * @param {object} metadata
     * @returns {Solid}
     */
    setEdgeMetadata(..._args) {
        return SolidMethods.setEdgeMetadata.apply(this, arguments);
    }

    /**
     * Get metadata for a boundary edge label (null if none).
     * @param {string} edgeName
     * @returns {object|null}
     */
    getEdgeMetadata(..._args) {
        return SolidMethods.getEdgeMetadata.apply(this, arguments);
    }

    /**
     * Remesh by splitting edges longer than a threshold; preserves face IDs and fixes winding.
     * @param {object} [options]
     * @param {number} options.maxEdgeLength maximum allowed edge length before splitting (required)
     * @param {number} [options.maxIterations=10] number of remesh passes to attempt
     * @returns {Solid}
     */
    remesh(..._args) {
        return SolidMethods.remesh.apply(this, arguments);
    }

    /**
     * Remove small disconnected triangle islands relative to the main shell.
     * @param {object} [options]
     * @param {number} [options.maxTriangles=30] triangle-count threshold for removal
     * @param {boolean} [options.removeInternal=true] drop islands inside the main shell
     * @param {boolean} [options.removeExternal=true] drop islands outside the main shell
     * @returns {number} triangles removed
     */
    removeSmallIslands(..._args) {
        return SolidMethods.removeSmallIslands.apply(this, arguments);
    }

    /**
     * Remove only small internal islands (wrapper around removeSmallIslands).
     * @param {number} [maxTriangles=30]
     * @returns {number}
     */
    removeSmallInternalIslands(..._args) {
        return SolidMethods.removeSmallInternalIslands.apply(this, arguments);
    }

    /**
     * Remove faces that only connect via a single shared edge chain to an opposite-facing neighbor.
     * @param {object} [options]
     * @param {number} [options.normalDotThreshold=-0.95] dot-product threshold for opposite normals
     * @returns {number} triangles removed
     */
    removeOppositeSingleEdgeFaces(..._args) {
        return SolidMethods.removeOppositeSingleEdgeFaces.apply(this, arguments);
    }

    /**
     * Mirror the solid across a plane defined by a point and a normal, returning a new Solid.
     * @param {number[]|THREE.Vector3} point
     * @param {number[]|THREE.Vector3} normal
     * @returns {Solid}
     */
    mirrorAcrossPlane(..._args) {
        return SolidMethods.mirrorAcrossPlane.apply(this, arguments);
    }

    /**
     * Push a named face along its outward normal by the given distance.
     * @param {string} faceName
     * @param {number} distance
     * @returns {Solid}
     */
    pushFace(..._args) {
        return SolidMethods.pushFace.apply(this, arguments);
    }

    /**
     * Query the averaged authored normal for a named face.
     * @param {string} faceName
     * @returns {{faceFound:boolean, validNormal:boolean, normal:number[], planarRatio:number, affectedVertexCount:number}}
     */
    getFaceNormal(..._args) {
        return SolidMethods.getFaceNormal.apply(this, arguments);
    }

    /**
     * Remove tiny boundary-adjacent triangles via edge flips under an area threshold.
     * @param {number} areaThreshold
     * @param {number} [maxIterations=1]
     * @returns {number} flips applied
     */
    removeTinyBoundaryTriangles(..._args) {
        return SolidMethods.removeTinyBoundaryTriangles.apply(this, arguments);
    }

    /**
     * Collapse triangles whose shortest edge is below a threshold and clean up the mesh.
     * @param {number} lengthThreshold
     * @returns {number} edge collapses performed
     */
    collapseTinyTriangles(..._args) {
        return SolidMethods.collapseTinyTriangles.apply(this, arguments);
    }

    /**
     * Removed legacy mesh operation.
     * @returns {Solid}
     */
    invertNormals(..._args) {
        return SolidMethods.invertNormals.apply(this, arguments);
    }

    /**
     * Fix triangle winding coherency across shared edges.
     * @returns {Solid}
     */
    fixTriangleWindingsByAdjacency(..._args) {
        return SolidMethods.fixTriangleWindingsByAdjacency.apply(this, arguments);
    }

    /**
     * Set vertex weld epsilon (<=0 disables) and optionally weld existing vertices.
     * @param {number} [epsilon=0]
     * @returns {Solid}
     */
    setEpsilon(..._args) {
        return SolidMethods.setEpsilon.apply(this, arguments);
    }

    /**
     * Create a lightweight clone of this Solid (copies geometry, labels, metadata, aux edges).
     * @returns {Solid}
     */
    clone(..._args) {
        return SolidMethods.clone.apply(this, arguments);
    }

    /**
     * Internal: weld vertices within epsilon using grid hashing and drop degenerates.
     * @param {number} eps
     * @returns {Solid}
     */
    _weldVerticesByEpsilon(..._args) {
        return SolidMethods._weldVerticesByEpsilon.apply(this, arguments);
    }

    /**
     * Get a visualization mesh snapshot from the OCCT shape.
     */
    getMesh(..._args) {
        return SolidMethods.getMesh.apply(this, arguments);
    }

    /**
     * Dispose cached resources and mark the solid dirty.
     * @returns {Solid}
     */
    free(..._args) {
        return SolidMethods.free.apply(this, arguments);
    }

    /**
     * Internal: build faceID -> triangle index cache if missing.
     * @returns {void}
     */
    _ensureFaceIndex(..._args) {
        return SolidMethods._ensureFaceIndex.apply(this, arguments);
    }

    /**
     * Get triangles belonging to a face label with positions and indices.
     * @param {string} name
     * @returns {Array<{faceName:string,indices:number[],p1:number[],p2:number[],p3:number[]}>}
     */
    getFace(..._args) {
        return SolidMethods.getFace.apply(this, arguments);
    }

    /**
     * List all face labels present on this solid.
     * @returns {string[]}
     */
    getFaceNames(..._args) {
        return SolidMethods.getFaceNames.apply(this, arguments);
    }

    /**
     * Generate an ASCII STL string from the current visualization mesh.
     * @param {string} [name='solid']
     * @param {number} [precision=6]
     * @returns {string}
     */
    toSTL(..._args) {
        return SolidMethods.toSTL.apply(this, arguments);
    }

    /**
     * Write an ASCII STL file to disk (Node.js only).
     * @param {string} filePath
     * @param {string} [name='solid']
     * @param {number} [precision=6]
     * @returns {Promise<string>} resolves with file path
     */
    async writeSTL(..._args) {
        return SolidMethods.writeSTL.apply(this, arguments);
    }

    /**
     * Generate a triangulated STEP string for this solid.
     * @param {string} [name=this.name||'part']
     * @param {{unit?: string, precision?: number, scale?: number, applyWorldTransform?: boolean}} [options]
     * @returns {string}
     */
    toSTEP(..._args) {
        return SolidMethods.toSTEP.apply(this, arguments);
    }

    /**
     * Write a triangulated STEP file to disk (Node.js only).
     * @param {string} filePath
     * @param {string} [name=this.name||'part']
     * @param {{unit?: string, precision?: number, scale?: number, applyWorldTransform?: boolean}} [options]
     * @returns {Promise<string>} resolves with file path
     */
    async writeSTEP(..._args) {
        return SolidMethods.writeSTEP.apply(this, arguments);
    }

    /**
     * Enumerate faces with their triangles; optionally include empty labels.
     * @param {boolean} [includeEmpty=false]
     * @returns {Array<{faceName:string,triangles:any[]}>}
     */
    getFaces(..._args) {
        return SolidMethods.getFaces.apply(this, arguments);
    }

    /**
     * Build per-face meshes and boundary edges as children for visualization.
     * @param {object} [options]
     * @param {boolean} [options.showEdges=true] include boundary edge polylines
     * @param {boolean} [options.forceAuthoring=false] force legacy authoring arrays
     * @param {boolean} [options.authoringOnly=false] use only legacy authoring arrays
     * @returns {void}
     */
    visualize(..._args) {
        return SolidMethods.visualize.apply(this, arguments);
    }

    /**
     * Extract boundary polylines between differing face labels from the current mesh.
     * @returns {Array<{name:string,faceA:string,faceB:string,positions:number[][],indices:number[]}>}
     */
    getBoundaryEdgePolylines(..._args) {
        return SolidMethods.getBoundaryEdgePolylines.apply(this, arguments);
    }

    /**
     * Internal: merge face ID -> name maps from two solids (used during booleans).
     * @param {Solid} other
     * @returns {Map<number,string>}
     */
    _combineIdMaps(..._args) {
        return SolidMethods._combineIdMaps.apply(this, arguments);
    }

    /**
     * Internal: merge face metadata maps from two solids.
     * @param {Solid} other
     * @returns {Map<string,object>}
     */
    _combineFaceMetadata(..._args) {
        return SolidMethods._combineFaceMetadata.apply(this, arguments);
    }

    /**
     * Boolean union with another solid; merges face labels, metadata, and aux edges.
     * @param {Solid} other
     * @returns {Solid}
     */
    union(..._args) {
        return SolidMethods.union.apply(this, arguments);
    }

    /**
     * Boolean subtraction (this minus other); merges face labels, metadata, and aux edges.
     * @param {Solid} other
     * @returns {Solid}
     */
    subtract(..._args) {
        return SolidMethods.subtract.apply(this, arguments);
    }

    /**
     * Boolean intersection with another solid; merges face labels, metadata, and aux edges.
     * @param {Solid} other
     * @returns {Solid}
     */
    intersect(..._args) {
        return SolidMethods.intersect.apply(this, arguments);
    }

    /**
     * Boolean difference alias.
     * @param {Solid} other
     * @returns {Solid}
     */
    difference(..._args) {
        return SolidMethods.difference.apply(this, arguments);
    }

    /**
     * Simplify the solid representation where supported.
     * @param {number} [tolerance]
     * @param {boolean} [updateInPlace] when true, mutate this solid instead of returning a clone
     * @returns {Solid}
     */
    simplify(..._args) {
        return SolidMethods.simplify.apply(this, arguments);
    }

    /**
     * Return a clone with tolerance metadata applied where supported.
     * @param {number} tolerance
     * @returns {Solid}
     */
    setTolerance(..._args) {
        return SolidMethods.setTolerance.apply(this, arguments);
    }

    /**
     * Compute volume from the current solid.
     * @returns {number}
     */
    volume(..._args) {
        return SolidMethods.volume.apply(this, arguments);
    }

    /**
     * Compute total surface area from the current solid.
     * @returns {number}
     */
    surfaceArea(..._args) {
        return SolidMethods.surfaceArea.apply(this, arguments);
    }

    /**
     * Count triangles in the current visualization mesh.
     * @returns {number}
     */
    getTriangleCount(..._args) {
        return SolidMethods.getTriangleCount.apply(this, arguments);
    }

    /**
     * Split self-intersecting triangle pairs conservatively while preserving face IDs.
     * @param {boolean} [diagnostics=false]
     * @returns {number} splits applied
     */
    splitSelfIntersectingTriangles(..._args) {
        return SolidMethods.splitSelfIntersectingTriangles.apply(this, arguments);
    }

    /**
     * Remove triangles with duplicate or collinear vertices.
     * @returns {number} triangles removed
     */
    removeDegenerateTriangles(..._args) {
        return SolidMethods.removeDegenerateTriangles.apply(this, arguments);
    }

    /**
     * Removed legacy mesh cleanup operation.
     * @returns {number} triangles removed
     */
    removeInternalTriangles(..._args) {
        return SolidMethods.removeInternalTriangles.apply(this, arguments);
    }

    /**
     * Removed legacy mesh cleanup operation.
     * @returns {number} triangles removed
     */
    removeInternalTrianglesByRaycast(..._args) {
        return SolidMethods.removeInternalTrianglesByRaycast.apply(this, arguments);
    }

    /**
     * Remove internal triangles using solid-angle (winding number) classification.
     * @param {object} [options]
     * @param {number} [options.offsetScale=1e-5] centroid offset scale relative to the model diagonal
     * @param {number} [options.crossingTolerance=0.05] tolerance for inside/outside crossing detection
     * @returns {number} triangles removed
     */
    removeInternalTrianglesByWinding(options = {}) {
        return SolidMethods.removeInternalTrianglesByWinding.apply(this, [options]);
    }

    /**
     * Reassign tiny disconnected islands within the same face label to the
     * largest adjacent face by surface area.
     * @param {number} size area threshold
     * @returns {number} triangles reassigned
     */
    cleanupTinyFaceIslands(..._args) {
        return SolidMethods.cleanupTinyFaceIslands.apply(this, arguments);
    }

    /**
     * Merge faces smaller than the given area into their largest neighbor.
     * @param {number} [maxArea=0.001] area threshold
     * @returns {this}
     */
    mergeTinyFaces(..._args) {
        return SolidMethods.mergeTinyFaces.apply(this, arguments);
    }

    /**
     * Apply chamfers to named edges and return the booleaned result (async).
     * @param {object} [options]
     * @param {number} options.distance chamfer distance (required, > 0)
     * @param {string[]} [options.edgeNames] edge labels to chamfer
     * @param {any[]} [options.edges] pre-resolved Edge objects on this solid
     * @param {'INSET'|'OUTSET'|string} [options.direction='INSET'] subtract vs union behavior
     * @param {number} [options.inflate=0.1] tool inflation (negated for OUTSET)
     * @param {boolean} [options.debug=false] enable builder debug aids
     * @param {string} [options.featureID='CHAMFER'] name prefix for generated solids
     * @param {number} [options.sampleCount] optional sampling override for chamfer strip
     * @param {boolean} [options.snapSeamToEdge] force seam to snap to edge
     * @param {number} [options.sideStripSubdiv] side-strip subdivisions
     * @param {number} [options.seamInsetScale] inset scale for seam
     * @param {boolean} [options.flipSide] flip side selection
     * @param {number} [options.debugStride] sampling stride for debug output
     * @returns {Promise<Solid>}
     */
    chamfer(options = {}) {
        return SolidMethods.chamfer.apply(this, [options]);
    }

    /**
     * Apply constant-radius fillets to named edges and return the booleaned result (async).
     * @param {object} [options]
     * @param {number} options.radius fillet radius (required, > 0)
     * @param {any[]} [options.edges] pre-resolved Edge objects on this solid
     * @param {'AUTO'|'INSET'|'OUTSET'|string} [options.direction='AUTO'] per-edge auto classification (or forced side)
     * @param {number} [options.inflate=0.1] tube inflation for cutting/union
     * @param {number} [options.resolution=32] tube resolution (segments around circumference)
     * @param {boolean} [options.debug=false] enable builder debug aids
     * @param {string} [options.featureID='FILLET'] name prefix for generated solids
     * @returns {Promise<Solid>}
     */
    fillet(options = {}) {
        return SolidMethods.fillet.apply(this, [options]);
    }

    /**
     * Build an open shell by thickening every face except the supplied exclusions
     * and boolean-unioning the results into a single solid.
     * @param {Array<string|any>|string|any} faces face names or face objects to exclude/open
     * @param {number} distance shell thickness magnitude; per-face thickening uses `-abs(distance)`
     * @param {object} [options]
     * @param {string} [options.featureId='OffsetShell'] name prefix for generated intermediates
     * @param {string} [options.newSolidName] final result name override
     * @returns {Solid|null}
     */
    offsetShell(..._args) {
        return SolidMethods.offsetShell.apply(this, arguments);
    }


    /**
     * Getter to access current FACE children; triggers visualize() before returning them.
     * @returns {Array<any>}
     */
    get faces(){
        this.visualize();
        return this.children.filter(c=>c.type==='FACE');
    }
}

// Helper to include the owning feature ID in Solid profiling logs
const __solidProfilingOwnerTag = (solidInstance) => {
    try {
        const owner = solidInstance?.owningFeatureID ?? solidInstance?.ID ?? null;
        return owner ? ` owningFeature=${owner}` : '';
    } catch {
        return '';
    }
};

const __solidSlowMethodThresholdMs = 1000;

const __solidProfilingFormatMessage = (prefix, methodName, phase, durationMs) => {
    const rounded = Math.round(durationMs);
    const label = `${prefix} ${methodName}`;
    switch (phase) {
        case 'resolved': return `${label} resolved in ${rounded} ms`;
        case 'rejected': return `${label} rejected in ${rounded} ms`;
        case 'completed': return `${label} in ${rounded} ms`;
        case 'threw': return `${label} threw in ${rounded} ms`;
        default: return null;
    }
};

const __solidProfilingLogTiming = (prefix, methodName, phase, durationMs) => {
    const message = __solidProfilingFormatMessage(prefix, methodName, phase, durationMs);
    if (!message) return;
    if (debugMode) {
        try { console.log(message); } catch { }
    }
    if (durationMs >= __solidSlowMethodThresholdMs) {
        const slowMsg = `${message} (SLOW > ${__solidSlowMethodThresholdMs} ms)`;
        try {
            if (typeof console !== 'undefined') {
                const warnFn = (typeof console.warn === 'function')
                    ? console.warn
                    : (typeof console.log === 'function' ? console.log : null);
                if (warnFn) warnFn.call(console, slowMsg);
            }
        } catch { }
    }
};

// --- Method-level time profiling for Solid -----------------------------------
// Wrap prototype methods to log execution time when debugMode is true, and
// always flag calls that exceed __solidSlowMethodThresholdMs.
(() => {
    try {
        if (Solid.__profiled) return;
        Solid.__profiled = true;
        const nowMs = () => (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now());
        const skip = new Set(['constructor']);
        const proto = Solid.prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (skip.has(name)) continue;
            const desc = Object.getOwnPropertyDescriptor(proto, name);
            if (!desc || typeof desc.value !== 'function') continue;
            const fn = desc.value;
            const wrapped = function (...args) {
                const prefix = `[Solid${__solidProfilingOwnerTag(this)}]`;
                const t0 = nowMs();
                const logPhase = (phase) => {
                    const duration = nowMs() - t0;
                    __solidProfilingLogTiming(prefix, name, phase, duration);
                };
                try {
                    const ret = fn.apply(this, args);
                    if (ret && typeof ret.then === 'function') {
                        return ret.then(
                            (val) => { logPhase('resolved'); return val; },
                            (err) => { logPhase('rejected'); throw err; }
                        );
                    }
                    logPhase('completed');
                    return ret;
                } catch (e) {
                    logPhase('threw');
                    throw e;
                }
            };
            try { Object.defineProperty(wrapped, 'name', { value: name, configurable: true }); } catch { }
            Object.defineProperty(proto, name, { ...desc, value: wrapped });
        }
    } catch { }
})();

// --- Example usage -----------------------------------------------------------
// Build a 10 x 10 x w box by triangles, naming each face.
// Then query triangles for a face and perform a boolean op.

if (import.meta && import.meta.url && typeof window === "undefined") {
    // If running under Node for a quick test, you can comment this guard and log outputs.
}

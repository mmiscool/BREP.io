import { Manifold, ManifoldMesh, debugMode } from "../SolidShared.js";
import {
    CppSolidCore,
    cppSolidCoreHasAuthoringBridge,
    cppSolidCoreHasNativeManifoldPrep,
    cppSolidCoreHasNativeWeldVerticesByEpsilon,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
    syncSolidAuthoringStateToCpp,
} from "../CppSolidCore.js";

/**
 * Manifold lifecycle helpers: rebuild, welding, orientation fixes.
 */

/**
 * Build (or rebuild) the Manifold from our MeshGL arrays.
 * Uses faceID per triangle so face names survive CSG operations.
 */
export function _manifoldize() {
    // Measure timing for manifoldization (cache hits vs rebuilds)
    const nowMs = () => (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now());
    const __t0 = nowMs();
    // Reset the auto-free timer: always schedule cleanup 60s after last use
    try { if (this._freeTimer) { clearTimeout(this._freeTimer); } } catch { }
    try {
        this._freeTimer = setTimeout(() => {
            try { this.free(); } catch { }
        }, 60 * 1000);
    } catch { }

    this.deduplicateFaceNames()



    if (!this._dirty && this._manifold) {
        const __t1 = nowMs();
        try { if (debugMode) console.log(`[Solid] _manifoldize cache-hit in ${Math.round(__t1 - __t0)} ms`); } catch { }
        return this._manifold;
    }
    let __logged = false;
    const __logDone = (ok = true) => {
        if (__logged) return; __logged = true;
        const __t1 = nowMs();
        const triCountDbg = (this?._triVerts?.length || 0) / 3 | 0;
        const vertCountDbg = (this?._vertProperties?.length || 0) / 3 | 0;
        try {
            if (debugMode) console.log(`[Solid] _manifoldize ${ok ? 'built' : 'failed'} in ${Math.round(__t1 - __t0)} ms (tris=${triCountDbg}, verts=${vertCountDbg})`);
        } catch { }
    };
    try {
        requireCppSolidCoreCapability(
            cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeManifoldPrep,
            "Solid._manifoldize()"
        );
        this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
        syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
        const prepared = this._cppSolidCore.prepareManifoldMesh();
        syncSolidAuthoringStateFromCpp(this, this._cppSolidCore);

        const mesh = new ManifoldMesh({
            numProp: Number(prepared?.numProp ?? this._numProp ?? 3),
            vertProperties: new Float32Array(prepared?.vertProperties ?? []),
            triVerts: new Uint32Array(prepared?.triVerts ?? []),
            faceID: new Uint32Array(prepared?.faceID ?? []),
            mergeFromVert: new Uint32Array(prepared?.mergeFromVert ?? []),
            mergeToVert: new Uint32Array(prepared?.mergeToVert ?? []),
        });

        try {
            this._manifold = new Manifold(mesh);
        } catch (err) {
            // If this Solid is a FilletSolid (identified by presence of edgeToFillet),
            // emit a structured JSON log with diagnostic context for debugging.
            try {
                if (this && Object.prototype.hasOwnProperty.call(this, 'edgeToFillet')) {
                    const triCountInfo = (this._triVerts?.length || 0) / 3 | 0;
                    const vertCountInfo = (this._vertProperties?.length || 0) / 3 | 0;
                    const faces = [];
                    try {
                        if (this.edgeToFillet && Array.isArray(this.edgeToFillet.faces)) {
                            for (const f of this.edgeToFillet.faces) if (f && f.name) faces.push(f.name);
                        }
                    } catch { }
                    const failure = {
                        type: 'FilletSolidManifoldFailure',
                        message: (err && (err.message || String(err))) || 'unknown',
                        params: {
                            radius: this.radius,
                            arcSegments: this.arcSegments,
                            sampleCount: this.sampleCount,
                            sideMode: this.sideMode,
                            inflate: this.inflate,
                            sideStripSubdiv: this.sideStripSubdiv,
                            seamInsetScale: this.seamInsetScale,
                            projectStripsOpenEdges: this.projectStripsOpenEdges,
                            forceSeamInset: this.forceSeamInset,
                        },
                        edge: {
                            name: this.edgeToFillet?.name || null,
                            closedLoop: !!(this.edgeToFillet?.closedLoop || this.edgeToFillet?.userData?.closedLoop),
                            faces,
                        },
                        counts: {
                            vertices: vertCountInfo,
                            triangles: triCountInfo,
                            faceLabels: (this._faceNameToID && typeof this._faceNameToID.size === 'number') ? this._faceNameToID.size : undefined,
                        },
                    };
                    try { console.error(JSON.stringify(failure)); } catch { console.error('[FilletSolidManifoldFailure]', failure.message); }
                }
            } catch { }
            __logDone(false);
            throw err;
        }
        finally {
            try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { }
        }
        this._dirty = false;
        this._faceIndex = null; // will rebuild on demand
        __logDone(true);
        return this._manifold;
    } finally {
        // In case of unexpected control flow, ensure we log once with best-effort status.
        const ok = !!(this && this._manifold) && this._dirty === false;
        __logDone(ok);
    }
}

/**
 * Set vertex weld epsilon and optionally align existing authored
 * vertices that fall within the epsilon distance. Epsilon <= 0
 * disables welding; manifold prep handles later dedup/cleanup.
 */
export function setEpsilon(epsilon = 0) {
    this._epsilon = Number(epsilon) || 0;
    if (this._epsilon > 0) {
        this._weldVerticesByEpsilon(this._epsilon);
    }
    return this;
}

export function _weldVerticesByEpsilon(eps, options = {}) {
    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeWeldVerticesByEpsilon,
        "Solid._weldVerticesByEpsilon()"
    );
    const rebuildManifold =
        !(options?.rebuildManifold === false);
    this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
    syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
    this._cppSolidCore.weldVerticesByEpsilon(eps);
    syncSolidAuthoringStateFromCpp(this, this._cppSolidCore);
    this._dirty = true;
    this._faceIndex = null;
    try { if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
    this._manifold = null;
    if (rebuildManifold) {
        this._manifoldize();
    }
    return this;
}

/**
 * Ensures all triangles have consistent winding by making sure
 * shared edges are oriented oppositely between adjacent triangles.
 */
export function fixTriangleWindingsByAdjacency() {
    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeManifoldPrep,
        "Solid.fixTriangleWindingsByAdjacency()"
    );
    this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
    syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
    const changed = this._cppSolidCore.fixTriangleWindingsByAdjacency();
    if (!changed) return this;
    syncSolidAuthoringStateFromCpp(this, this._cppSolidCore);
    this._dirty = true;
    this._faceIndex = null;
    try { if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
    this._manifold = null;
    return this;
}

// Return true if every undirected edge is shared by exactly 2 triangles
// and their directed usages are opposite.
export function _isCoherentlyOrientedManifold() {
    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeManifoldPrep,
        "Solid._isCoherentlyOrientedManifold()"
    );
    this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
    syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
    return this._cppSolidCore.isCoherentlyOrientedManifold();
}

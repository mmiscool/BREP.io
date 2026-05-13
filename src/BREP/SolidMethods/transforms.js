import { THREE } from "../SolidShared.js";
import { composeTrsMatrixDeg } from "../../utils/xformMath.js";
import {
    CppSolidCore,
    cppSolidCoreHasAuthoringBridge,
    cppSolidCoreHasNativeMetadataTransform,
    cppSolidCoreHasNativePushFace,
    getSolidAuthoringStateSnapshot,
    requireCppSolidCoreCapability,
    syncSolidAuthoringStateFromCpp,
    syncSolidAuthoringStateToCpp,
} from "../CppSolidCore.js";
import { hasOccShape, setOccState, transformOccState } from "../OpenCascadeKernel.js";

/**
 * Geometry transforms applied directly to authored data.
 */

/**
 * Apply a Matrix4 to all authored vertices (bake transform into geometry arrays).
 * Does not modify the Object3D transform; marks manifold dirty for rebuild.
 */
export function bakeTransform(matrix) {
    try {
        if (!matrix || typeof matrix.elements === 'undefined') return this;
        if (hasOccShape(this)) {
            const m = (matrix && matrix.isMatrix4) ? matrix : new THREE.Matrix4().fromArray(matrix.elements || matrix);
            setOccState(this, transformOccState(this._occ, m));
            return this;
        }
        if (!Array.isArray(this._vertProperties) || this._vertProperties.length === 0) return this;
        const m = (matrix && matrix.isMatrix4) ? matrix : new THREE.Matrix4().fromArray(matrix.elements || matrix);
        requireCppSolidCoreCapability(cppSolidCoreHasAuthoringBridge, "Solid.bakeTransform()");
        this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
        syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
        this._cppSolidCore.bakeTransform(m);
        syncSolidAuthoringStateFromCpp(this, this._cppSolidCore);
        this._dirty = true;
        this._faceIndex = null;
        try {
            if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete();
        } catch { /* ignore */ }
        this._manifold = null;
    } catch (_) { /* ignore */ }
    return this;
}

/**
 * Convenience: compose TRS and bake transform.
 */
export function bakeTRS(trs) {
    try {
        const m = composeTrsMatrixDeg(trs, THREE);
        return this.bakeTransform(m);
    } catch (_) { return this; }
}

/**
 * Return a mirrored copy of this solid across a plane defined by a point and a normal.
 */
export function mirrorAcrossPlane(point, normal) {
    const Solid = this.constructor;
    const P0 = (point instanceof THREE.Vector3)
        ? point.clone()
        : new THREE.Vector3(point[0], point[1], point[2]);
    const n = (normal instanceof THREE.Vector3)
        ? normal.clone().normalize()
        : new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
    const nx = n.x;
    const ny = n.y;
    const nz = n.z;
    const planeDot = P0.dot(n);
    const reflection = new THREE.Matrix4().set(
        1 - (2 * nx * nx), -2 * nx * ny, -2 * nx * nz, 2 * planeDot * nx,
        -2 * ny * nx, 1 - (2 * ny * ny), -2 * ny * nz, 2 * planeDot * ny,
        -2 * nz * nx, -2 * nz * ny, 1 - (2 * nz * nz), 2 * planeDot * nz,
        0, 0, 0, 1,
    );

    if (hasOccShape(this)) {
        const mirrored = this.clone();
        mirrored.bakeTransform(reflection);
        return mirrored;
    }

    const sourceSnapshot = getSolidAuthoringStateSnapshot(this);
    const mesh = this.getMesh();
    try {
        const vp = mesh.vertProperties; // Float32Array
        const tv = mesh.triVerts;       // Uint32Array
        const faceIDs = mesh.faceID && mesh.faceID.length ? Array.from(mesh.faceID) : [];

        const mirrored = new Solid();
        mirrored._numProp = mesh.numProp || 3;

        // Reflect vertices across plane
        const outVP = new Array(vp.length);
        const X = new THREE.Vector3();
        for (let i = 0; i < vp.length; i += 3) {
            X.set(vp[i + 0], vp[i + 1], vp[i + 2]);
            const d = X.clone().sub(P0);
            const t = 2 * d.dot(n);
            const Xp = X.sub(n.clone().multiplyScalar(t));
            outVP[i + 0] = Xp.x;
            outVP[i + 1] = Xp.y;
            outVP[i + 2] = Xp.z;
        }
        mirrored._vertProperties = outVP;

        // Copy triangles and face IDs
        mirrored._triVerts = Array.from(tv);
        mirrored._triIDs = faceIDs.length ? faceIDs : new Array((tv.length / 3) | 0).fill(0);

        // Restore face name maps and metadata from the native-backed authoring snapshot.
        try {
            mirrored._idToFaceName = new Map(sourceSnapshot?.idToFaceName || []);
            mirrored._faceNameToID = new Map(sourceSnapshot?.faceNameToID || []);
            mirrored._faceMetadata = new Map(Array.from(sourceSnapshot?.faceMetadataJson || [], ([name, raw]) => [name, JSON.parse(raw || "{}")]));
            mirrored._edgeMetadata = new Map(Array.from(sourceSnapshot?.edgeMetadataJson || [], ([name, raw]) => [name, JSON.parse(raw || "{}")]));
        } catch (_) { }

        // Mirror auxiliary edges (e.g., centerlines) across the same plane.
        try {
            const aux = Array.isArray(this._auxEdges) ? this._auxEdges : [];
            const X = new THREE.Vector3();
            const d = new THREE.Vector3();
            const nScaled = new THREE.Vector3();
            mirrored._auxEdges = aux.map(edge => {
                const pts = [];
                if (Array.isArray(edge?.points)) {
                    for (const p of edge.points) {
                        if (!Array.isArray(p) || p.length !== 3) continue;
                        X.set(p[0], p[1], p[2]);
                        d.subVectors(X, P0);
                        nScaled.copy(n).multiplyScalar(2 * d.dot(n));
                        X.sub(nScaled);
                        pts.push([X.x, X.y, X.z]);
                    }
                }
                return {
                    name: edge?.name,
                    closedLoop: !!edge?.closedLoop,
                    polylineWorld: !!edge?.polylineWorld,
                    materialKey: edge?.materialKey,
                    centerline: !!edge?.centerline,
                    points: pts,
                };
            }).filter(e => Array.isArray(e.points) && e.points.length);
        } catch (_) { mirrored._auxEdges = []; }

        // Rebuild vertex key map for exact-key lookup consistency
        mirrored._vertKeyToIndex = new Map();
        for (let i = 0; i < mirrored._vertProperties.length; i += 3) {
            const x = mirrored._vertProperties[i];
            const y = mirrored._vertProperties[i + 1];
            const z = mirrored._vertProperties[i + 2];
            mirrored._vertKeyToIndex.set(`${x},${y},${z}`, (i / 3) | 0);
        }

        mirrored._dirty = true;  // manifold must rebuild on demand
        mirrored._faceIndex = null;
        mirrored._manifold = null;
        try {
            requireCppSolidCoreCapability(
                cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativeMetadataTransform,
                "Solid.mirrorAcrossPlane()",
            );
            mirrored._cppSolidCore = mirrored._cppSolidCore || new CppSolidCore();
            syncSolidAuthoringStateToCpp(mirrored, mirrored._cppSolidCore);
            mirrored._cppSolidCore.transformMetadata(reflection);
            syncSolidAuthoringStateFromCpp(mirrored, mirrored._cppSolidCore);
            mirrored._cppSolidCore.dispose();
            mirrored._cppSolidCore = null;
            mirrored._cppSolidCoreSyncStamp = null;
        } catch { /* ignore metadata reflection errors */ }
        return mirrored;
    } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { } }
}

/**
 * Push a named face outward by the specified distance.
 * Simple implementation: calculate face normal, create displacement vector, apply to all vertices.
 * 
 * @param {string} faceName - Name of the face to push
 * @param {number} distance - Distance to push the face (positive = outward along normal)
 * @param {object} [options]
 * @param {boolean} [options.warnMissing=true] - Warn when the requested face is absent
 * @param {boolean} [options.warnInvalidNormal=true] - Warn when no usable face normal can be derived
 * @returns {Solid} this for chaining
 */
export function pushFace(faceName, distance = 0.001, options = {}) {
    const dist = Number(distance);
    if (!faceName || !Number.isFinite(dist) || dist === 0) return this;
    const warnMissing = options?.warnMissing !== false;
    const warnInvalidNormal = options?.warnInvalidNormal !== false;

    // Make sure triangle windings are coherent so the averaged normal points outward.
    try { this._manifoldize(); } catch { /* best effort; fall back to existing winding */ }

    const faceID = this._faceNameToID.get(faceName);
    if (faceID === undefined) {
        if (warnMissing) console.warn(`pushFace: Face "${faceName}" not found`);
        return this;
    }

    requireCppSolidCoreCapability(
        cppSolidCoreHasAuthoringBridge && cppSolidCoreHasNativePushFace,
        "Solid.pushFace()"
    );
    this._cppSolidCore = this._cppSolidCore || new CppSolidCore();
    syncSolidAuthoringStateToCpp(this, this._cppSolidCore);
    const result = this._cppSolidCore.pushFace(faceName, dist) || {};
    if (!result.faceFound) {
        if (warnMissing) console.warn(`pushFace: Face "${faceName}" not found`);
        return this;
    }
    if (!result.moved) {
        if (result.invalidNormal && warnInvalidNormal) {
            console.warn(`pushFace: Invalid normal for face "${faceName}"`);
        }
        return this;
    }
    syncSolidAuthoringStateFromCpp(this, this._cppSolidCore);
    this._dirty = true;
    this._faceIndex = null;
    try { if (this._manifold && typeof this._manifold.delete === 'function') this._manifold.delete(); } catch { }
    this._manifold = null;
    return this;
}

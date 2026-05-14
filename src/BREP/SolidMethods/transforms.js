import { THREE } from "../SolidShared.js";
import { composeTrsMatrixDeg } from "../../utils/xformMath.js";
import { hasOccShape, setOccState, transformOccState } from "../OpenCascadeKernel.js";

/**
 * Geometry transforms applied directly to authored data.
 */

/**
 * Apply a Matrix4 to all authored vertices (bake transform into geometry arrays).
 * Does not modify the Object3D transform; marks manifold dirty for rebuild.
 */
export function bakeTransform(matrix) {
    if (!matrix || typeof matrix.elements === 'undefined') return this;
    if (hasOccShape(this)) {
        const m = (matrix && matrix.isMatrix4) ? matrix : new THREE.Matrix4().fromArray(matrix.elements || matrix);
        setOccState(this, transformOccState(this._occ, m));
        return this;
    }
    throw new Error("Solid.bakeTransform() requires an OpenCASCADE-backed solid.");
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

    throw new Error("Solid.mirrorAcrossPlane() requires an OpenCASCADE-backed solid.");
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

    void warnMissing;
    void warnInvalidNormal;
    throw new Error("Solid.pushFace() requires an OpenCASCADE-backed implementation.");
}

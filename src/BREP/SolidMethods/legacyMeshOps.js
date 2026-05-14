import { hasOccShape } from "../OpenCascadeKernel.js";

/**
 * Removed legacy mesh cleanup and orientation helpers.
 */

/**
 * Set legacy vertex weld epsilon for compatibility.
 */
export function setEpsilon(epsilon = 0) {
    this._epsilon = Number(epsilon) || 0;
    return this;
}

export function _weldVerticesByEpsilon(eps, options = {}) {
    void eps;
    void options;
    if (hasOccShape(this)) return this;
    throw new Error("Solid._weldVerticesByEpsilon() has been removed. Use OpenCASCADE-backed solids.");
}

/**
 * Ensures all triangles have consistent winding by making sure
 * shared edges are oriented oppositely between adjacent triangles.
 */
export function fixTriangleWindingsByAdjacency() {
    if (hasOccShape(this)) return this;
    throw new Error("Solid.fixTriangleWindingsByAdjacency() has been removed. Use OpenCASCADE-backed solids.");
}

export function invertNormals() {
    if (hasOccShape(this)) return this;
    throw new Error("Solid.invertNormals() has been removed. Use OpenCASCADE-backed solids.");
}

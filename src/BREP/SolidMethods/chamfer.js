// Solid.chamfer implementation: wraps native chamfer tool generation and applies booleans.
import { chamferOccSolid, hasOccShape, setOccState } from '../OpenCascadeKernel.js';
import { resolveEdgesFromInputs } from './edgeResolution.js';

/**
 * Apply chamfers to this Solid and return a new Solid with the result.
 *
 * @param {Object} opts
 * @param {number} opts.distance Required chamfer distance (> 0)
 * @param {string[]} [opts.edgeNames] Optional edge names to chamfer
 * @param {any[]} [opts.edges] Optional pre-resolved Edge objects (must belong to this Solid)
 * @param {'INSET'|'OUTSET'|string} [opts.direction='INSET'] Boolean behavior (subtract vs union)
 * @param {number} [opts.inflate=0.1] Grow/shrink chamfer tool (negated for OUTSET)
 * @param {boolean} [opts.debug=false] Enable debug helpers on ChamferSolid
 * @param {string} [opts.featureID='CHAMFER'] For naming of intermediates and result
 * @param {number} [opts.sampleCount] Optional sampling override for chamfer strip
 * @param {boolean} [opts.snapSeamToEdge] Snap seam to the edge
 * @param {number} [opts.sideStripSubdiv] Side strip subdivisions
 * @param {number} [opts.seamInsetScale] Inset scale for seam
 * @param {boolean} [opts.flipSide] Flip side selection
 * @param {number} [opts.debugStride] Sampling stride for debug output
 * @returns {import('../BetterSolid.js').Solid}
 */
export async function chamfer(opts = {}) {
  const { Solid } = await import("../BetterSolid.js");
  const distance = Number(opts.distance);
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error(`Solid.chamfer: distance must be > 0, got ${opts.distance}`);
  }
  if (hasOccShape(this)) {
    const unique = resolveEdgesFromInputs(this, { edgeNames: opts.edgeNames, edges: opts.edges });
    if (unique.length === 0) {
      const c = this.clone();
      try { c.name = this.name; } catch { }
      return c;
    }
    const occState = chamferOccSolid(this, unique, { distance, featureID: opts.featureID || 'CHAMFER' });
    if (!occState) {
      const c = this.clone();
      try { c.name = this.name; } catch { }
      return c;
    }
    const result = new Solid();
    setOccState(result, occState);
    try { result.name = this?.name || `${opts.featureID || 'CHAMFER'}_FINAL_CHAMFER`; } catch { }
    return result;
  }
  throw new Error('Solid.chamfer() requires an OpenCASCADE-backed solid; legacy Manifold chamfer fallback has been removed.');
}

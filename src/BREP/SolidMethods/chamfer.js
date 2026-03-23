// Solid.chamfer implementation: wraps native chamfer tool generation and applies booleans.
import { applySolidAuthoringStateSnapshot, buildSolidAuthoringStateSnapshot } from '../CppSolidCore.js';
import { manifold } from '../setupManifold.js';
import { resolveEdgesFromInputs } from './edgeResolution.js';

function hasNativeChamferWorkflowBuilder() {
  return typeof manifold?.buildChamferWorkflowAuthoringState === 'function';
}

function requireNativeChamferWorkflow() {
  if (!hasNativeChamferWorkflowBuilder()) {
    throw new Error('Chamfer generation requires the custom local manifold build with native chamfer workflow support.');
  }
}

function solidFromSnapshot(snapshot, name, SolidCtor) {
  if (!snapshot) return null;
  const solid = new SolidCtor();
  applySolidAuthoringStateSnapshot(solid, snapshot, { remapFaceIDs: true });
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  try { solid.name = name; } catch { }
  return solid;
}

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
  requireNativeChamferWorkflow();
  const { Solid } = await import("../BetterSolid.js");
  const distance = Number(opts.distance);
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error(`Solid.chamfer: distance must be > 0, got ${opts.distance}`);
  }
  const dirMode = String(opts.direction || 'INSET').toUpperCase();
  const autoDirection = dirMode === 'AUTO';
  const dir = dirMode === 'OUTSET' ? 'OUTSET' : (autoDirection ? 'AUTO' : 'INSET');
  const inflateRaw = Number.isFinite(opts.inflate) ? Number(opts.inflate) : 0.1;
  const debug = !!opts.debug;
  const featureID = opts.featureID || 'CHAMFER';
  console.log('[Solid.chamfer] Begin', {
    featureID,
    solid: this?.name,
    distance,
    direction: dirMode,
    inflate: inflateRaw,
    debug,
    requestedEdgeNames: Array.isArray(opts.edgeNames) ? opts.edgeNames : [],
    providedEdgeCount: Array.isArray(opts.edges) ? opts.edges.length : 0,
  });

  // Resolve edges from names and/or provided objects
  const unique = resolveEdgesFromInputs(this, { edgeNames: opts.edgeNames, edges: opts.edges });
  if (unique.length === 0) {
    console.warn('[Solid.chamfer] No edges resolved on target solid; returning clone.', { featureID, solid: this?.name });
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }

  const baseSnapshot = buildSolidAuthoringStateSnapshot(this);
  const edgePayload = [];
  let idx = 0;
  for (const e of unique) {
    const faceAName = String(e?.faces?.[0]?.name || e?.userData?.faceA || '');
    const faceBName = String(e?.faces?.[1]?.name || e?.userData?.faceB || '');
    const polyline = Array.isArray(e?.userData?.polylineLocal) ? e.userData.polylineLocal : [];
    if (!faceAName || !faceBName || polyline.length < 2) {
      console.warn('[Solid.chamfer] Skipping edge with missing faces/polyline.', { edge: e?.name });
      continue;
    }
    edgePayload.push({
      name: `${featureID}_CHAMFER_${idx++}`,
      edgeReference: String(e?.name || `EDGE_${idx}`),
      faceAName,
      faceBName,
      polyline,
      closedLoop: !!(e?.closedLoop || e?.userData?.closedLoop),
      sampleCount: opts.sampleCount,
      snapSeamToEdge: opts.snapSeamToEdge,
      flipSide: opts.flipSide,
    });
  }

  if (edgePayload.length === 0) {
    console.error('[Solid.chamfer] All chamfer inputs failed; returning clone.', { featureID, edgeCount: unique.length });
    const c = this.clone();
    try { c.name = this.name; } catch { }
    return c;
  }

  const nativeResult = manifold.buildChamferWorkflowAuthoringState({
    snapshot: baseSnapshot,
    edges: edgePayload,
    distance,
    directionMode: dir,
    inflate: inflateRaw,
    featureID,
    name: this?.name || `${featureID}_FINAL_CHAMFER`,
    cleanupTinyFaceIslandsArea: Number.isFinite(opts.cleanupTinyFaceIslandsArea)
      ? Number(opts.cleanupTinyFaceIslandsArea)
      : 0.01,
    debug,
  });
  if (autoDirection && nativeResult?.directionDecision) {
    console.log('[Solid.chamfer] AUTO direction classification complete.', {
      featureID,
      insetEdges: nativeResult.directionDecision.insetEdges,
      outsetEdges: nativeResult.directionDecision.outsetEdges,
      fallbackEdges: nativeResult.directionDecision.fallbackEdges,
      ambiguousEdges: nativeResult.directionDecision.ambiguousEdges,
    });
  }

  const finalSnapshot = nativeResult?.finalSnapshot || null;
  const result = solidFromSnapshot(finalSnapshot, this?.name || `${featureID}_FINAL_CHAMFER`, Solid);
  if (!result) {
    throw new Error('Native chamfer workflow returned no result snapshot.');
  }

  const debugChamferSolids = [];
  const debugSnapshots = Array.isArray(nativeResult?.debugSnapshots) ? nativeResult.debugSnapshots : [];
  for (const entry of debugSnapshots) {
    const debugSolid = solidFromSnapshot(entry?.snapshot, String(entry?.name || 'CHAMFER_DEBUG'), Solid);
    if (debugSolid) debugChamferSolids.push(debugSolid);
  }
  try { result.__debugChamferSolids = debugChamferSolids; } catch { }
  try { result.__chamferDirectionDecision = nativeResult?.directionDecision || null; } catch { }

  const finalTriCount = Array.isArray(result?._triVerts) ? (result._triVerts.length / 3) : 0;
  const finalVertCount = Array.isArray(result?._vertProperties) ? (result._vertProperties.length / 3) : 0;
  if (!result || finalTriCount === 0 || finalVertCount === 0) {
    console.error('[Solid.chamfer] Chamfer result is empty or missing geometry.', {
      featureID,
      finalTriCount,
      finalVertCount,
      edgeCount: unique.length,
      direction: dir,
      inflate: inflateRaw,
    });
  } else {
    console.log('[Solid.chamfer] Completed', { featureID, triangles: finalTriCount, vertices: finalVertCount });
  }

  return result;
}

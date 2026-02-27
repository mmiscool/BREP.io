import { computeFilletCenterline } from '../BREP/fillets/fillet.js';
import { fs } from '../fs.proxy.js';

const PART_PATH = 'src/tests/partFiles/fillet_test.BREP.json';

export async function test_fillet_edge_degenerate_segment(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, 'utf8');
  await partHistory.reset();
  await partHistory.fromJSON(content);
  // Stop before the fillet so we can evaluate the source edge geometry directly.
  partHistory.currentHistoryStepId = 'E7';
  return partHistory;
}

function segmentLengths(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (Number.isFinite(len)) out.push(len);
  }
  return out;
}

function countBackwardSegments(reference, candidate) {
  const n = Math.min(
    Array.isArray(reference) ? reference.length : 0,
    Array.isArray(candidate) ? candidate.length : 0,
  );
  let backward = 0;
  for (let i = 0; i < n - 1; i++) {
    const r0 = reference[i];
    const r1 = reference[i + 1];
    const c0 = candidate[i];
    const c1 = candidate[i + 1];
    if (!r0 || !r1 || !c0 || !c1) continue;
    const rdx = r1.x - r0.x;
    const rdy = r1.y - r0.y;
    const rdz = r1.z - r0.z;
    const cdx = c1.x - c0.x;
    const cdy = c1.y - c0.y;
    const cdz = c1.z - c0.z;
    const rLen = Math.hypot(rdx, rdy, rdz);
    const cLen = Math.hypot(cdx, cdy, cdz);
    if (!(rLen > 1e-12) || !(cLen > 1e-12)) continue;
    const dot = (rdx * cdx + rdy * cdy + rdz * cdz) / (rLen * cLen);
    if (dot < -1e-6) backward++;
  }
  return backward;
}

function centerlineDistanceRange(centerline, edge) {
  const n = Math.min(
    Array.isArray(centerline) ? centerline.length : 0,
    Array.isArray(edge) ? edge.length : 0,
  );
  const d = [];
  for (let i = 0; i < n; i++) {
    const c = centerline[i];
    const e = edge[i];
    if (!c || !e) continue;
    const len = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
    if (Number.isFinite(len)) d.push(len);
  }
  if (!d.length) return null;
  return {
    min: Math.min(...d),
    max: Math.max(...d),
    count: d.length,
  };
}

export async function afterRun_fillet_edge_degenerate_segment(partHistory) {
  const filletFeature = partHistory.features.find((f) => f?.type === 'F');
  if (!filletFeature) throw new Error('Fillet feature missing from part file.');

  const rawEdge = Array.isArray(filletFeature.inputParams?.edges)
    ? filletFeature.inputParams.edges[0]
    : null;
  if (!rawEdge) throw new Error('Fillet edge reference missing from part file.');

  const edgeObj = (typeof rawEdge === 'object')
    ? rawEdge
    : partHistory.getObjectByName(String(rawEdge));
  if (!edgeObj) throw new Error(`Fillet source edge not found: ${String(rawEdge)}`);

  const radius = Number(filletFeature.inputParams?.radius) || 1;
  const res = computeFilletCenterline(edgeObj, radius, 'INSET');
  if (!res || !Array.isArray(res.points) || !Array.isArray(res.edge) || res.edge.length < 2) {
    throw new Error('computeFilletCenterline returned invalid edge samples.');
  }

  const lengths = segmentLengths(res.edge);
  if (!lengths.length) throw new Error('Fillet edge samples have no measurable segments.');
  const maxLen = Math.max(...lengths);
  const tinyTol = Math.max(1e-6, maxLen * 1e-5);
  const tinySegments = lengths.filter((len) => len < tinyTol);
  if (tinySegments.length > 0) {
    throw new Error(
      `Fillet edge samples contain near-zero segments (tol=${tinyTol}, tiny=${tinySegments.map((v) => v.toExponential(6)).join(', ')})`,
    );
  }

  const backward = countBackwardSegments(res.points, res.edge);
  if (backward > 0) {
    throw new Error(`Fillet edge samples backtrack against the centerline on ${backward} segment(s).`);
  }

  const distRange = centerlineDistanceRange(res.points, res.edge);
  if (!distRange) throw new Error('Failed to compute centerline-edge distance range.');
  const allowedRatio = 2.1;
  if (distRange.max > (distRange.min * allowedRatio)) {
    throw new Error(
      `Fillet centerline has endpoint distance outlier (min=${distRange.min}, max=${distRange.max}, allowedRatio=${allowedRatio})`,
    );
  }

  console.log(
    `✓ Fillet degenerate-edge test passed: segments=${lengths.length}, tinyTol=${tinyTol.toExponential(3)}, distMin=${distRange.min.toExponential(3)}, distMax=${distRange.max.toExponential(3)}`,
  );
}

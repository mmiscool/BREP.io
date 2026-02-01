import { posix as path } from '../path.proxy.js';
import { fs } from '../fs.proxy.js';
import { computeFilletCenterline } from '../BREP/fillets/fillet.js';
import { projectPointOntoFaceTriangles } from '../BREP/fillets/inset.js';

const PART_PATH = 'src/tests/partFiles/fillet_angle_test.BREP.json';

export async function test_fillet_angle(partHistory) {
  const content = await fs.promises.readFile(PART_PATH, 'utf8');
  await partHistory.reset();
  await partHistory.fromJSON(content);
  // Force the target angle expression (test is for small-angle robustness)
  partHistory.expressions = "//Examples:\nangle = 35;";
  // Stop after the extrude so we can analyze the original edge/face geometry.
  partHistory.currentHistoryStepId = 'E2';
  return partHistory;
}

function getFaceName(edgeObj, idx) {
  const face = edgeObj?.faces?.[idx];
  if (face?.name) return face.name;
  if (idx === 0) return edgeObj?.userData?.faceA || null;
  if (idx === 1) return edgeObj?.userData?.faceB || null;
  return null;
}

function maxProjectionDistance(points, tris, faceKey) {
  if (!Array.isArray(points) || points.length === 0) return { max: 0, avg: 0, count: 0 };
  let max = 0;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (!p) continue;
    const q = projectPointOntoFaceTriangles(tris, p, null, faceKey);
    if (!q) continue;
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const dz = p.z - q.z;
    const d = Math.hypot(dx, dy, dz);
    if (Number.isFinite(d)) {
      if (d > max) max = d;
      sum += d;
      count++;
    }
  }
  const avg = count ? (sum / count) : 0;
  return { max, avg, count };
}

export async function afterRun_fillet_angle(partHistory) {
  const filletFeature = partHistory.features.find((f) => f?.type === 'F');
  if (!filletFeature) {
    throw new Error('Fillet feature missing from part file.');
  }
  const edgeNames = Array.isArray(filletFeature.inputParams?.edges)
    ? filletFeature.inputParams.edges
    : [];
  const edgeName = edgeNames.find((n) => typeof n === 'string') || null;
  if (!edgeName) {
    throw new Error('Fillet edge name not found in test part file.');
  }

  const edgeObj = partHistory.getObjectByName(edgeName);
  if (!edgeObj) {
    throw new Error(`Edge object "${edgeName}" not found after extrude.`);
  }

  const radius = Number(filletFeature.inputParams?.radius) || 2;
  const side = String(filletFeature.inputParams?.direction || 'INSET').toUpperCase();
  const res = computeFilletCenterline(edgeObj, radius, side);
  if (!res || !Array.isArray(res.tangentA) || !Array.isArray(res.tangentB)) {
    throw new Error('computeFilletCenterline did not return tangent polylines.');
  }

  const faceAName = getFaceName(edgeObj, 0);
  const faceBName = getFaceName(edgeObj, 1);
  const solid = edgeObj.parentSolid || edgeObj.parent;
  if (!solid || !faceAName || !faceBName) {
    throw new Error('Edge faces could not be resolved for tangent validation.');
  }

  const trisA = solid.getFace(faceAName);
  const trisB = solid.getFace(faceBName);
  if (!Array.isArray(trisA) || !trisA.length || !Array.isArray(trisB) || !trisB.length) {
    throw new Error('Face triangle data missing for tangent validation.');
  }

  const distA = maxProjectionDistance(res.tangentA, trisA, faceAName);
  const distB = maxProjectionDistance(res.tangentB, trisB, faceBName);

  const tol = Math.max(1e-3, radius * 0.02);
  if (distA.max > tol || distB.max > tol) {
    const msg = [
      `Tangent projection error too large (angle=35).`,
      `FaceA max=${distA.max.toFixed(6)} avg=${distA.avg.toFixed(6)} count=${distA.count}`,
      `FaceB max=${distB.max.toFixed(6)} avg=${distB.avg.toFixed(6)} count=${distB.count}`,
      `tol=${tol}`,
    ].join(' ');
    throw new Error(msg);
  }

  console.log(`✓ Fillet angle test passed: maxA=${distA.max.toFixed(6)} maxB=${distB.max.toFixed(6)} tol=${tol}`);
}

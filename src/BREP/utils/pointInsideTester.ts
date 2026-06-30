export function buildPointInsideTester(solid) {
  if (!solid) return null;
  const tv = solid._triVerts;
  const vp = solid._vertProperties;
  if (!tv || !vp || typeof tv.length !== 'number' || typeof vp.length !== 'number') return null;
  const triCount = (tv.length / 3) | 0;
  if (triCount === 0 || vp.length < 9) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i];
    const y = vp[i + 1];
    const z = vp[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const jitter = 1e-6 * diag;

  const rayTri = (ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const EPS = 1e-12;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) return null;
    const invDet = 1.0 / det;
    const tvecx = ox - ax, tvecy = oy - ay, tvecz = oz - az;
    const u = (tvecx * px + tvecy * py + tvecz * pz) * invDet;
    if (u < -1e-12 || u > 1 + 1e-12) return null;
    const qx = tvecy * e1z - tvecz * e1y;
    const qy = tvecz * e1x - tvecx * e1z;
    const qz = tvecx * e1y - tvecy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < -1e-12 || u + v > 1 + 1e-12) return null;
    const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return tHit > 1e-10 ? tHit : null;
  };

  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  return (pt) => {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) return false;
    const px = pt.x, py = pt.y, pz = pt.z;
    let votes = 0;
    for (let k = 0; k < dirs.length; k++) {
      const dir = dirs[k];
      const ox = px + (k + 1) * jitter;
      const oy = py + (k + 2) * jitter;
      const oz = pz + (k + 3) * jitter;
      let hits = 0;
      for (let t = 0; t < triCount; t++) {
        const b = t * 3;
        const ia = (tv[b + 0] >>> 0) * 3;
        const ib = (tv[b + 1] >>> 0) * 3;
        const ic = (tv[b + 2] >>> 0) * 3;
        const hit = rayTri(
          ox, oy, oz,
          dir[0], dir[1], dir[2],
          vp[ia + 0], vp[ia + 1], vp[ia + 2],
          vp[ib + 0], vp[ib + 1], vp[ib + 2],
          vp[ic + 0], vp[ic + 1], vp[ic + 2]
        );
        if (hit !== null) hits++;
      }
      if ((hits % 2) === 1) votes++;
    }
    return votes >= 2;
  };
}

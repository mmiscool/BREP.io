export function computeBoundsFromVertices(verts) {
  if (!verts || typeof verts.length !== 'number' || verts.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const x = verts[i + 0];
    const y = verts[i + 1];
    const z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [dx, dy, dz],
    diag: Math.hypot(dx, dy, dz) || 0,
  };
}

export function computeBoundsFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let saw = false;
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 3) continue;
    const x = p[0], y = p[1], z = p[2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    saw = true;
  }
  if (!saw) return null;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [dx, dy, dz],
    diag: Math.hypot(dx, dy, dz) || 0,
  };
}

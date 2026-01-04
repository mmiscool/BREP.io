export function deriveTolerance(polys, baseTol = 1e-5) {
  if (!Array.isArray(polys) || polys.length === 0) return baseTol;
  if (baseTol !== 1e-5) return baseTol;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const segLens = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      if (i > 0) {
        const a = p[i - 1];
        const dx = a[0] - v[0], dy = a[1] - v[1], dz = a[2] - v[2];
        segLens.push(Math.hypot(dx, dy, dz));
      }
    }
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diag = Math.hypot(dx, dy, dz) || 1;
  segLens.sort((a, b) => a - b);
  const med = segLens.length ? segLens[(segLens.length >> 1)] : diag;
  return Math.min(Math.max(1e-5, diag * 1e-3), med * 0.1);
}

export function createQuantizer(tol) {
  const t = tol || 1e-5;
  const q = (v) => [
    Math.round(v[0] / t) * t,
    Math.round(v[1] / t) * t,
    Math.round(v[2] / t) * t,
  ];
  const k = (v) => `${v[0]},${v[1]},${v[2]}`;
  return { q, k };
}

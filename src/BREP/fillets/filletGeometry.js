import { computeTriangleArea } from '../triangleUtils.js';

export function computeFaceAreaFromTriangles(tris) {
  if (!Array.isArray(tris) || tris.length === 0) return 0;
  let area = 0;
  for (const tri of tris) {
    const p1 = tri?.p1, p2 = tri?.p2, p3 = tri?.p3;
    if (!Array.isArray(p1) || !Array.isArray(p2) || !Array.isArray(p3)) continue;
    const ax = Number(p1[0]) || 0, ay = Number(p1[1]) || 0, az = Number(p1[2]) || 0;
    const bx = Number(p2[0]) || 0, by = Number(p2[1]) || 0, bz = Number(p2[2]) || 0;
    const cx = Number(p3[0]) || 0, cy = Number(p3[1]) || 0, cz = Number(p3[2]) || 0;
    area += computeTriangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
  return area;
}

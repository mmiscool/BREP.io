import * as THREE from 'three';

export function dedupeConsecutivePoints(points, eps = 0) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const out = [points[0]];
  const useEps = Number.isFinite(eps) && eps > 0;
  const epsSq = useEps ? eps * eps : 0;
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const prev = out[out.length - 1];
    if (!Array.isArray(curr) || !Array.isArray(prev)) {
      out.push(curr);
      continue;
    }
    if (useEps) {
      const dx = (curr[0] || 0) - (prev[0] || 0);
      const dy = (curr[1] || 0) - (prev[1] || 0);
      const dz = (curr[2] || 0) - (prev[2] || 0);
      if ((dx * dx + dy * dy + dz * dz) <= epsSq) continue;
    } else if (curr[0] === prev[0] && curr[1] === prev[1] && curr[2] === prev[2]) {
      continue;
    }
    out.push(curr);
  }
  return out;
}

export function getEdgePolylineWorld(edgeObj, { dedupe = true, eps = 0 } = {}) {
  const pts = [];
  if (!edgeObj) return pts;
  const cached = edgeObj?.userData?.polylineLocal;
  const isWorld = !!(edgeObj?.userData?.polylineWorld);
  const v = new THREE.Vector3();
  if (Array.isArray(cached) && cached.length >= 2) {
    if (isWorld) {
      for (const p of cached) pts.push([p[0], p[1], p[2]]);
    } else {
      for (const p of cached) {
        v.set(p[0], p[1], p[2]).applyMatrix4(edgeObj.matrixWorld);
        pts.push([v.x, v.y, v.z]);
      }
    }
  } else {
    const posAttr = edgeObj?.geometry?.getAttribute?.('position');
    if (posAttr && posAttr.itemSize === 3 && posAttr.count >= 2) {
      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(edgeObj.matrixWorld);
        pts.push([v.x, v.y, v.z]);
      }
    } else {
      const aStart = edgeObj?.geometry?.attributes?.instanceStart;
      const aEnd = edgeObj?.geometry?.attributes?.instanceEnd;
      if (aStart && aEnd && aStart.itemSize === 3 && aEnd.itemSize === 3 && aStart.count === aEnd.count && aStart.count >= 1) {
        v.set(aStart.getX(0), aStart.getY(0), aStart.getZ(0)).applyMatrix4(edgeObj.matrixWorld);
        pts.push([v.x, v.y, v.z]);
        for (let i = 0; i < aEnd.count; i++) {
          v.set(aEnd.getX(i), aEnd.getY(i), aEnd.getZ(i)).applyMatrix4(edgeObj.matrixWorld);
          pts.push([v.x, v.y, v.z]);
        }
      }
    }
  }
  return dedupe ? dedupeConsecutivePoints(pts, eps) : pts;
}

export function getEdgeLineEndpointsWorld(edgeObj, eps = 1e-12) {
  const pts = getEdgePolylineWorld(edgeObj, { dedupe: false });
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const first = pts[0];
  if (!Array.isArray(first)) return null;
  let second = null;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (!Array.isArray(p)) continue;
    if (Math.abs(p[0] - first[0]) > eps || Math.abs(p[1] - first[1]) > eps || Math.abs(p[2] - first[2]) > eps) {
      second = p;
      break;
    }
  }
  if (!second) return null;
  return {
    start: new THREE.Vector3(first[0], first[1], first[2]),
    end: new THREE.Vector3(second[0], second[1], second[2]),
  };
}

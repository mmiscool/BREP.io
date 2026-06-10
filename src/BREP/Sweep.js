import * as THREE from 'three';
import { Solid } from './BetterSolid.js';
import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { computeBoundsFromVertices } from './boundsUtils.js';
import { getEdgePolylineWorld } from './edgePolylineUtils.js';
import { manifold } from './setupManifold.js';

function requireNativeSweepBuilder() {
  if (typeof manifold?.buildSweepAuthoringState === 'function') return;
  throw new Error('Sweep generation requires the custom local manifold build with native sweep support.');
}

export function computeBoundaryLoopsFromFaceNative(faceObj) {
  const loops = [];
  const geom = faceObj?.geometry;
  if (!geom) return loops;
  const pos = geom.getAttribute && geom.getAttribute('position');
  if (!pos) return loops;
  const idx = geom.getIndex && geom.getIndex();
  const world = new Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(faceObj.matrixWorld);
    world[i] = [v.x, v.y, v.z];
  }

  const keyOf = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)},${p[2].toFixed(7)}`;
  const canonMap = new Map();
  const canonPts = [];
  const origToCanon = new Array(world.length);
  for (let i = 0; i < world.length; i++) {
    const key = keyOf(world[i]);
    let ci = canonMap.get(key);
    if (ci === undefined) {
      ci = canonPts.length;
      canonMap.set(key, ci);
      canonPts.push(world[i]);
    }
    origToCanon[i] = ci;
  }

  const edgeCount = new Map();
  const triIter = (cb) => {
    if (idx) {
      for (let t = 0; t < idx.count; t += 3) {
        cb(idx.getX(t + 0) >>> 0, idx.getX(t + 1) >>> 0, idx.getX(t + 2) >>> 0);
      }
    } else {
      const triCount = (pos.count / 3) | 0;
      for (let t = 0; t < triCount; t++) cb(3 * t + 0, 3 * t + 1, 3 * t + 2);
    }
  };
  const inc = (a, b) => {
    const A = origToCanon[a] >>> 0;
    const B = origToCanon[b] >>> 0;
    const i = Math.min(A, B);
    const j = Math.max(A, B);
    const key = `${i},${j}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  };
  triIter((i0, i1, i2) => {
    inc(i0, i1);
    inc(i1, i2);
    inc(i2, i0);
  });

  const adj = new Map();
  const addAdj = (a, b) => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const [key, count] of edgeCount.entries()) {
    if (count !== 1) continue;
    const [iStr, jStr] = key.split(',');
    const i = Number(iStr);
    const j = Number(jStr);
    addAdj(i, j);
    addAdj(j, i);
  }

  const visited = new Set();
  const edgeKey = (a, b) => {
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    return `${i},${j}`;
  };
  for (const [a, neigh] of adj.entries()) {
    for (const b of neigh) {
      const key = edgeKey(a, b);
      if (visited.has(key)) continue;
      const ring = [a, b];
      visited.add(key);
      let prev = a;
      let cur = b;
      let guard = 0;
      while (guard++ < 100000) {
        const nset = adj.get(cur) || new Set();
        let next = null;
        for (const n of nset) {
          if (n !== prev) {
            next = n;
            break;
          }
        }
        if (next == null) break;
        const nextKey = edgeKey(cur, next);
        if (visited.has(nextKey)) break;
        visited.add(nextKey);
        ring.push(next);
        prev = cur;
        cur = next;
        if (cur === ring[0]) break;
      }
      if (ring.length < 3) continue;
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const p = canonPts[ring[i]];
        if (pts.length) {
          const q = pts[pts.length - 1];
          if (q[0] === p[0] && q[1] === p[1] && q[2] === p[2]) continue;
        }
        pts.push([p[0], p[1], p[2]]);
      }
      if (pts.length >= 3) loops.push({ pts, isHole: false });
    }
  }

  if (loops.length) {
    const n = (typeof faceObj.getAverageNormal === 'function')
      ? faceObj.getAverageNormal().clone()
      : new THREE.Vector3(0, 0, 1);
    if (n.lengthSq() < 1e-20) n.set(0, 0, 1);
    n.normalize();
    let ux = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.dot(ux)) > 0.99) ux.set(0, 1, 0);
    const U = new THREE.Vector3().crossVectors(n, ux).normalize();
    const V = new THREE.Vector3().crossVectors(n, U).normalize();
    const area2 = (arr) => {
      let a = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const q = arr[(i + 1) % arr.length];
        a += p.x * q.y - q.x * p.y;
      }
      return 0.5 * a;
    };
    const pointInPolygon = (point, polygon) => {
      let inside = false;
      const px = point.x;
      const py = point.y;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        const crosses = ((a.y > py) !== (b.y > py))
          && (px < ((b.x - a.x) * (py - a.y)) / ((b.y - a.y) || 1e-30) + a.x);
        if (crosses) inside = !inside;
      }
      return inside;
    };
    const projectedLoops = loops.map((loop) => loop.pts.map((P) => {
        const vp = new THREE.Vector3(P[0], P[1], P[2]);
        return new THREE.Vector2(vp.dot(U), vp.dot(V));
    }));
    const loopAreas = projectedLoops.map(area2);
    for (let i = 0; i < loops.length; i++) {
      let containingLoopCount = 0;
      const areaAbs = Math.abs(loopAreas[i]);
      for (let j = 0; j < loops.length; j++) {
        if (i === j) continue;
        if (Math.abs(loopAreas[j]) <= areaAbs) continue;
        if (projectedLoops[i].some((point) => pointInPolygon(point, projectedLoops[j]))) containingLoopCount++;
      }
      loops[i].isHole = (containingLoopCount % 2) === 1;
    }
  }

  return loops;
}

function combinePathPolylines(edges, tol = 1e-5) {
  if (!Array.isArray(edges) || edges.length === 0) return [];
  const polys = [];
  for (const edge of edges) {
    const poly = getEdgePolylineWorld(edge);
    if (poly.length >= 2) polys.push(poly);
  }
  if (polys.length === 0) return [];

  if (tol === 1e-5) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const segLens = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2];
        if (p[2] > maxZ) maxZ = p[2];
        if (i > 0) {
          const a = poly[i - 1];
          const b = p;
          segLens.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
      }
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    segLens.sort((a, b) => a - b);
    const med = segLens.length ? segLens[segLens.length >> 1] : diag;
    tol = Math.min(Math.max(1e-5, diag * 1e-3), med * 0.1);
  }

  const tol2 = tol * tol;
  const d2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  };
  const q = (v) => [
    Math.round(v[0] / tol) * tol,
    Math.round(v[1] / tol) * tol,
    Math.round(v[2] / tol) * tol,
  ];
  const keyOf = (v) => `${v[0]},${v[1]},${v[2]}`;
  const nodes = new Map();
  const endpoints = [];
  const addNode = (pt) => {
    const qp = q(pt);
    const key = keyOf(qp);
    if (!nodes.has(key)) nodes.set(key, { edges: new Set() });
    return key;
  };
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    const sKey = addNode(poly[0]);
    const eKey = addNode(poly[poly.length - 1]);
    nodes.get(sKey).edges.add(i);
    nodes.get(eKey).edges.add(i);
    endpoints.push({ sKey, eKey });
  }

  let startNodeKey = null;
  for (const [key, value] of nodes.entries()) {
    if ((value.edges.size % 2) === 1) {
      startNodeKey = key;
      break;
    }
  }
  if (!startNodeKey) startNodeKey = nodes.keys().next().value;

  const used = new Array(polys.length).fill(false);
  const chain = [];
  const appendPoly = (poly, reverse = false) => {
    const pts = reverse ? poly.slice().reverse() : poly;
    if (chain.length === 0) {
      chain.push(...pts);
      return;
    }
    if (d2(chain[chain.length - 1], pts[0]) <= tol2) chain.push(...pts.slice(1));
    else chain.push(...pts);
  };
  const tryConsumeFromNode = (nodeKey) => {
    const node = nodes.get(nodeKey);
    if (!node) return false;
    for (const ei of Array.from(node.edges)) {
      if (used[ei]) continue;
      const { sKey, eKey } = endpoints[ei];
      const forward = sKey === nodeKey;
      used[ei] = true;
      nodes.get(sKey)?.edges.delete(ei);
      nodes.get(eKey)?.edges.delete(ei);
      appendPoly(polys[ei], !forward);
      return forward ? eKey : sKey;
    }
    return false;
  };

  let cursorKey = startNodeKey;
  const firstStep = tryConsumeFromNode(cursorKey);
  if (!firstStep) return polys[0].slice();
  cursorKey = firstStep;
  while (cursorKey) {
    const next = tryConsumeFromNode(cursorKey);
    if (!next) break;
    cursorKey = next;
  }

  for (let i = chain.length - 2; i >= 0; i--) {
    const a = chain[i];
    const b = chain[i + 1];
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) chain.splice(i + 1, 1);
  }
  return chain;
}

function orientSweepPathPoints(pathPts, face, mode) {
  const pts = Array.isArray(pathPts) ? pathPts.map((p) => [p[0], p[1], p[2]]) : [];
  if (pts.length < 2) return pts;

  if (mode !== 'pathAlign') {
    const isCollinear = (a, b, c, eps = 1e-12) => {
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const bcx = c[0] - b[0], bcy = c[1] - b[1], bcz = c[2] - b[2];
      const cx = aby * bcz - abz * bcy;
      const cy = abz * bcx - abx * bcz;
      const cz = abx * bcy - aby * bcx;
      return (cx * cx + cy * cy + cz * cz) <= eps;
    };
    const simplified = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      if ((cur[0] === prev[0] && cur[1] === prev[1] && cur[2] === prev[2]) || isCollinear(prev, cur, next)) continue;
      simplified.push(cur);
    }
    simplified.push(pts[pts.length - 1]);
    for (let i = simplified.length - 2; i >= 0; i--) {
      const a = simplified[i];
      const b = simplified[i + 1];
      if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) simplified.splice(i + 1, 1);
    }
    pts.splice(0, pts.length, ...simplified);
  }

  if (mode === 'pathAlign') {
    const profilePts = [];
    const loops = Array.isArray(face?.userData?.boundaryLoopsWorld) ? face.userData.boundaryLoopsWorld : null;
    if (loops && loops.length) {
      const outerLoops = loops.filter((loop) => !loop?.isHole);
      const useLoops = outerLoops.length ? outerLoops : loops;
      for (const loop of useLoops) {
        const arr = Array.isArray(loop?.pts) ? loop.pts : loop;
        if (!Array.isArray(arr)) continue;
        for (const p of arr) {
          if (Array.isArray(p) && p.length >= 3) profilePts.push([p[0], p[1], p[2]]);
        }
      }
    }
    if (!profilePts.length) {
      const posAttr = face?.geometry?.getAttribute?.('position');
      if (posAttr) {
        const v = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
          v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(face.matrixWorld);
          profilePts.push([v.x, v.y, v.z]);
        }
      }
    }
    if (profilePts.length) {
      const minD2 = (p) => {
        let best = Infinity;
        for (const q of profilePts) {
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          const dz = p[2] - q[2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) best = d;
        }
        return best;
      };
      if (minD2(pts[pts.length - 1]) < minD2(pts[0])) pts.reverse();
    }
    return pts;
  }

  let centroid = null;
  const loops = Array.isArray(face?.userData?.boundaryLoopsWorld) ? face.userData.boundaryLoopsWorld : null;
  if (loops && loops.length) {
    const outer = loops.find((loop) => !loop.isHole) || loops[0];
    const arr = Array.isArray(outer?.pts) ? outer.pts : outer;
    if (Array.isArray(arr) && arr.length >= 3) {
      centroid = new THREE.Vector3();
      for (const p of arr) centroid.add(new THREE.Vector3(p[0], p[1], p[2]));
      centroid.multiplyScalar(1 / arr.length);
    }
  }
  if (!centroid) {
    const posAttr = face?.geometry?.getAttribute?.('position');
    if (posAttr) {
      centroid = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(face.matrixWorld);
        centroid.add(v);
      }
      centroid.multiplyScalar(1 / Math.max(1, posAttr.count));
    }
  }
  if (centroid) {
    const d2 = (a, b) => {
      const dx = a[0] - b.x;
      const dy = a[1] - b.y;
      const dz = a[2] - b.z;
      return dx * dx + dy * dy + dz * dz;
    };
    if (d2(pts[pts.length - 1], centroid) < d2(pts[0], centroid)) pts.reverse();
  }
  return pts;
}

function buildSweepEdgeMetadataJson(edge, faceNormal, distance, distanceBack) {
  const metadata = { faceType: 'SIDEWALL' };
  const sourceEdgeName = String(edge?.name || edge?.userData?.edgeName || '');
  if (sourceEdgeName) metadata.sourceEdgeName = sourceEdgeName;

  const kind = edge?.userData?.sketchGeomType;
  let radius = null;
  let centerArr = null;
  if (kind === 'circle') {
    radius = edge?.userData?.circleRadius;
    centerArr = edge?.userData?.circleCenter;
  } else if (kind === 'arc') {
    radius = edge?.userData?.arcRadius;
    centerArr = edge?.userData?.arcCenter;
  }
  if (Array.isArray(centerArr) && Number.isFinite(radius) && radius > 0) {
    const center = new THREE.Vector3(centerArr[0], centerArr[1], centerArr[2]);
    if (!edge?.userData?.polylineWorld && edge?.matrixWorld) center.applyMatrix4(edge.matrixWorld);
    const normal = faceNormal.clone();
    if (normal.lengthSq() < 1e-20) normal.set(0, 1, 0);
    normal.normalize();
    const forwardVec = normal.clone().multiplyScalar(Number(distance) || 0);
    const backwardVec = normal.clone().multiplyScalar(-(Number(distanceBack) || 0));
    const startPoint = center.clone().add(backwardVec);
    const endPoint = center.clone().add(forwardVec);
    const axisVec = endPoint.clone().sub(startPoint);
    let height = axisVec.length();
    let axisDir = height > 1e-9 ? axisVec.clone().normalize() : forwardVec.clone();
    if (axisDir.lengthSq() < 1e-12) axisDir.set(0, 1, 0);
    axisDir.normalize();
    if (!Number.isFinite(height)) height = 0;
    const axisCenter = startPoint.clone().addScaledVector(axisVec, 0.5);
    metadata.type = 'cylindrical';
    metadata.radius = radius;
    metadata.height = height;
    metadata.axis = [axisDir.x, axisDir.y, axisDir.z];
    metadata.center = [axisCenter.x, axisCenter.y, axisCenter.z];
  }

  return JSON.stringify(metadata);
}

function isSyntheticSweepSourceEdgeName(name) {
  const raw = String(name || '').trim();
  if (!raw) return true;
  if (raw === 'FACE' || /^FACE_\d+$/.test(raw)) return true;
  return /_REPAIR_\d+/.test(raw);
}

function pointArrayFromWorldPoint(point) {
  if (!point) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  const z = Number(point[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function transformPolylinePoints(points, matrixWorld) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const out = [];
  const v = new THREE.Vector3();
  for (const point of points) {
    const p = pointArrayFromWorldPoint(point);
    if (!p) continue;
    v.set(p[0], p[1], p[2]);
    if (matrixWorld && typeof v.applyMatrix4 === 'function') v.applyMatrix4(matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

function buildSweepEdgeInput(name, polyline, metadataJson = '') {
  const edgeName = String(name || '').trim();
  if (!edgeName || isSyntheticSweepSourceEdgeName(edgeName)) return null;
  if (!Array.isArray(polyline) || polyline.length < 2) return null;
  return {
    name: edgeName,
    polyline,
    metadataJson: typeof metadataJson === 'string' ? metadataJson : '',
  };
}

function keySweepPoint(point, quant = 1e-5) {
  return `${Math.round((Number(point?.[0]) || 0) / quant)},${Math.round((Number(point?.[1]) || 0) / quant)},${Math.round((Number(point?.[2]) || 0) / quant)}`;
}

function buildBoundaryPointKeySet(boundaryLoops, quant = 1e-5) {
  const keys = new Set();
  for (const loop of Array.isArray(boundaryLoops) ? boundaryLoops : []) {
    const points = Array.isArray(loop?.pts) ? loop.pts : loop;
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (!Array.isArray(point) || point.length < 3) continue;
      keys.add(keySweepPoint(point, quant));
    }
  }
  return keys;
}

function edgePolylineMatchesBoundary(polyline, boundaryPointKeys, quant = 1e-5) {
  if (!Array.isArray(polyline) || polyline.length < 2 || !boundaryPointKeys?.size) return false;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    if (boundaryPointKeys.has(keySweepPoint(a, quant)) && boundaryPointKeys.has(keySweepPoint(b, quant))) {
      return true;
    }
  }
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  return boundaryPointKeys.has(keySweepPoint(first, quant)) && boundaryPointKeys.has(keySweepPoint(last, quant));
}

function getRestoredSketchBoundaryEdgeInputs(face, featureTag, boundaryLoops, faceNormal, distance, distanceBack) {
  const parent = face?.parent;
  if (!parent || String(parent?.type || '').toUpperCase() !== 'SKETCH') return [];
  const boundaryPointKeys = buildBoundaryPointKeySet(boundaryLoops);
  if (!boundaryPointKeys.size) return [];

  const inputs = [];
  const seen = new Set();
  const children = Array.isArray(parent.children) ? parent.children : [];
  for (const child of children) {
    if (!child || String(child?.type || '').toUpperCase() !== 'EDGE') continue;
    const rawName = String(child?.name || child?.userData?.edgeName || '').trim();
    if (!rawName || seen.has(rawName) || isSyntheticSweepSourceEdgeName(rawName)) continue;
    const polyline = getEdgePolylineWorld(child, { dedupe: false }).map((p) => [p[0], p[1], p[2]]);
    if (!edgePolylineMatchesBoundary(polyline, boundaryPointKeys)) continue;
    const input = buildSweepEdgeInput(
      `${featureTag}${rawName}_SW`,
      polyline,
      buildSweepEdgeMetadataJson(child, faceNormal, distance, distanceBack),
    );
    if (!input) continue;
    seen.add(rawName);
    inputs.push(input);
  }
  return inputs.length > 1 ? inputs : [];
}

function getSolidFaceBoundaryEdgeInputs(face, featureTag) {
  const faceName = String(face?.name || face?.userData?.faceName || '').trim();
  if (!faceName) return [];

  const inputs = [];
  const seen = new Set();
  const pushInput = (edgeName, polyline, metadataJson = '') => {
    const rawName = String(edgeName || '').trim();
    if (!rawName || seen.has(rawName) || isSyntheticSweepSourceEdgeName(rawName)) return;
    const input = buildSweepEdgeInput(`${featureTag}${rawName}_SW`, polyline, metadataJson);
    if (!input) return;
    seen.add(rawName);
    inputs.push(input);
  };

  if (Array.isArray(face?.edges) && face.edges.length) {
    for (const edge of face.edges) {
      const rawName = String(edge?.name || edge?.userData?.edgeName || '').trim();
      let metadataJson = '';
      try {
        const metadata = (typeof edge?.getMetadata === 'function') ? edge.getMetadata() : null;
        if (metadata && typeof metadata === 'object') metadataJson = JSON.stringify(metadata);
      } catch (_) { /* metadata is optional */ }
      pushInput(rawName, getEdgePolylineWorld(edge, { dedupe: false }), metadataJson);
    }
    return inputs.length > 1 ? inputs : [];
  }

  const solid = face?.parentSolid || face?.parent || null;
  if (!solid || typeof solid.getBoundaryEdgePolylines !== 'function') return [];
  let boundaries = [];
  try { boundaries = solid.getBoundaryEdgePolylines() || []; } catch { boundaries = []; }
  for (const boundary of boundaries) {
    if (!boundary || (boundary.faceA !== faceName && boundary.faceB !== faceName)) continue;
    const rawName = String(boundary.name || '').trim();
    let metadataJson = '';
    try {
      const metadata = (typeof solid.getEdgeMetadata === 'function') ? solid.getEdgeMetadata(rawName) : null;
      if (metadata && typeof metadata === 'object') metadataJson = JSON.stringify(metadata);
    } catch (_) { /* metadata is optional */ }
    pushInput(rawName, transformPolylinePoints(boundary.positions, solid.matrixWorld), metadataJson);
  }
  return inputs.length > 1 ? inputs : [];
}

export function generateNativeSweep(target, params = {}) {
  requireNativeSweepBuilder();
  const {
    face,
    distance = 1,
    distanceBack = 0,
    sweepPathEdges = [],
    mode = 'translate',
    name = 'Sweep',
    omitBaseCap = false,
    twistAngle = 0,
  } = params;
  if (!face || !face.geometry) return false;

  const boundaryLoops = Array.isArray(face?.userData?.boundaryLoopsWorld) && face.userData.boundaryLoopsWorld.length
    ? face.userData.boundaryLoopsWorld.map((loop) => ({
        pts: (Array.isArray(loop?.pts) ? loop.pts : loop).map((p) => [p[0], p[1], p[2]]),
        isHole: !!loop?.isHole,
      }))
    : computeBoundaryLoopsFromFaceNative(face);
  if (!boundaryLoops.length) {
    throw new Error('Sweep generation requires boundary loops on the source face.');
  }

  const faceNormal = (typeof face.getAverageNormal === 'function')
    ? face.getAverageNormal().clone()
    : new THREE.Vector3(0, 1, 0);
  if (faceNormal.lengthSq() < 1e-20) faceNormal.set(0, 1, 0);
  faceNormal.normalize();

  const sourceIsSketchFace = face?.parent?.type === 'SKETCH';
  const featureTag = name ? `${name}:` : '';
  const relevantEdges = sourceIsSketchFace && Array.isArray(face?.edges)
    ? face.edges.filter((edge) => {
        const kind = edge?.userData?.sketchGeomType;
        if (kind === 'circle' || kind === 'arc') return true;
        if (edge?.closedLoop) return false;
        const sourceEdgeName = String(edge?.name || edge?.userData?.edgeName || '').trim();
        return !isSyntheticSweepSourceEdgeName(sourceEdgeName);
      })
    : [];
  const sketchEdgeInputs = relevantEdges.map((edge) => ({
    name: `${featureTag}${edge?.name || 'EDGE'}_SW`,
    polyline: getEdgePolylineWorld(edge, { dedupe: false }).map((p) => [p[0], p[1], p[2]]),
    metadataJson: buildSweepEdgeMetadataJson(edge, faceNormal, distance, distanceBack),
  })).filter((entry) => Array.isArray(entry.polyline) && entry.polyline.length >= 2);
  const restoredSketchEdgeInputs = (sourceIsSketchFace && !sketchEdgeInputs.length)
    ? getRestoredSketchBoundaryEdgeInputs(face, featureTag, boundaryLoops, faceNormal, distance, distanceBack)
    : [];
  const solidBoundaryEdgeInputs = (!sourceIsSketchFace || !sketchEdgeInputs.length)
    ? getSolidFaceBoundaryEdgeInputs(face, featureTag)
    : [];
  const edgeInputs = sourceIsSketchFace
    ? (sketchEdgeInputs.length ? sketchEdgeInputs : (restoredSketchEdgeInputs.length ? restoredSketchEdgeInputs : solidBoundaryEdgeInputs))
    : solidBoundaryEdgeInputs;

  let pathPoints = [];
  if (Array.isArray(sweepPathEdges) && sweepPathEdges.length) {
    pathPoints = combinePathPolylines(sweepPathEdges.filter(Boolean));
    pathPoints = orientSweepPathPoints(pathPoints, face, mode === 'pathAlign' ? 'pathAlign' : 'translate');
  }

  const distanceVector = (distance && distance.isVector3)
    ? [distance.x, distance.y, distance.z]
    : null;

  const snapshot = manifold.buildSweepAuthoringState({
    name,
    faceName: face?.name || 'Face',
    mode: mode === 'pathAlign' ? 'pathAlign' : 'translate',
    distance: typeof distance === 'number' ? distance : 0,
    distanceVector,
    distanceBack: Number(distanceBack) || 0,
    omitBaseCap: !!omitBaseCap,
    twistAngle: Number.isFinite(Number(twistAngle)) ? Number(twistAngle) : 0,
    faceNormal: [faceNormal.x, faceNormal.y, faceNormal.z],
    boundaryLoops,
    edges: edgeInputs,
    pathPoints,
  });

  applySolidAuthoringStateSnapshot(target, snapshot, { remapFaceIDs: true });
  target._dirty = true;
  target._manifold = null;
  target._faceIndex = null;
  try { target.name = name || 'Sweep'; } catch {}

  let eps = Number(snapshot?.suggestedEpsilon);
  if (!(eps > 0) && Array.isArray(target._vertProperties) && target._vertProperties.length >= 6) {
    const bounds = computeBoundsFromVertices(target._vertProperties);
    const diag = (bounds && bounds.diag) ? bounds.diag : 1;
    eps = Math.min(1e-4, Math.max(1e-7, diag * 1e-6));
  }
  if (Number.isFinite(eps) && eps > 0) target.setEpsilon(eps);

  let ok = false;
  let attempt = 0;
  let errLast = null;
  while (!ok && attempt < 3) {
    try {
      const mesh = target.getMesh();
      try { /* probe */ } finally { try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {} }
      ok = true;
    } catch (error) {
      errLast = error;
      eps *= 2;
      if (!(eps > 0) || eps > 5e-4) break;
      try { target.setEpsilon(eps); } catch {}
    }
    attempt++;
  }
  if (!ok && errLast) {
    console.warn('[Sweep] Manifold build failed after native rebuild retries:', errLast.message || errLast);
  }
  return true;
}

export class Sweep extends Solid {
  constructor({ face, sweepPathEdges = [], distance = 1, distanceBack = 0, mode = 'translate', name = 'Sweep', omitBaseCap = false, twistAngle = 0 } = {}) {
    super();
    this.name = name;
    this.params = { face, distance, distanceBack, sweepPathEdges, mode, name, omitBaseCap, twistAngle };
    this.generate();
  }

  generate() {
    const { face, distance, distanceBack, sweepPathEdges, mode, omitBaseCap, twistAngle } = this.params;
    if (!face || !face.geometry) return this;
    generateNativeSweep(this, {
      face,
      distance,
      distanceBack,
      sweepPathEdges,
      mode,
      omitBaseCap,
      twistAngle,
      name: this.name || this.params?.name || 'Sweep',
    });
    return this;
  }
}

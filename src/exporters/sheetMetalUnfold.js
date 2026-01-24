import * as THREE from 'three';

/**
 * Sign convention:
 * - bend.angleRad describes the folded rotation from aFace to bFace using the
 *   right-hand rule about bend.axisDir in folded space.
 * - Unfolding rotates the moving face by -bend.angleRad when stepping from
 *   aFace -> bFace, and +bend.angleRad when stepping from bFace -> aFace.
 */

const DEFAULT_EPSILON = 1e-5;
const DEFAULT_CLIP_EXTENT = 1e6;
const EPS = 1e-12;

/**
 * @typedef {Object} Bend
 * @property {string|number} bendId
 * @property {number} aFaceId
 * @property {number} bFaceId
 * @property {THREE.Vector3} axisPoint
 * @property {THREE.Vector3} axisDir
 * @property {number} angleRad
 * @property {number} radius
 * @property {number} thickness
 * @property {number} kFactor
 * @property {'up'|'down'} upDown
 */

/**
 * @typedef {Object} FlatPattern
 * @property {Map<number, THREE.Matrix4>} faceTransforms
 * @property {Array<THREE.Vector2>} vertex2D
 * @property {Array<Array<THREE.Vector2>>} outlines
 * @property {Array<Array<THREE.Vector2>>} holes
 * @property {Array<Object>} bendLines
 */

const makeEdgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const makePairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function snapValue(value, eps) {
  if (!Number.isFinite(value)) return value;
  const inv = 1 / eps;
  return Math.round(value * inv) / inv;
}

function updateBounds(bounds, point) {
  if (!bounds) return { min: point.clone(), max: point.clone() };
  bounds.min.min(point);
  bounds.max.max(point);
  return bounds;
}

function buildFacePanels(geometry, faceIdAttr) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const triCount = (index.count / 3) | 0;
  const posArray = position.array;
  const idxArray = index.array;

  const faces = new Map();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vAB = new THREE.Vector3();
  const vAC = new THREE.Vector3();
  const vBC = new THREE.Vector3();
  const vCA = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const faceId = faceIdAttr.getX(t);
    let face = faces.get(faceId);
    if (!face) {
      face = {
        id: faceId,
        triangles: [],
        normalSum: new THREE.Vector3(),
        centroidSum: new THREE.Vector3(),
        areaSum: 0,
        refNormal: null,
        longestEdgeDir: new THREE.Vector3(),
        longestEdgeLenSq: 0,
        samplePoint: new THREE.Vector3(),
      };
      faces.set(faceId, face);
    }
    face.triangles.push(t);

    const i0 = idxArray[t * 3 + 0];
    const i1 = idxArray[t * 3 + 1];
    const i2 = idxArray[t * 3 + 2];

    vA.fromArray(posArray, i0 * 3);
    vB.fromArray(posArray, i1 * 3);
    vC.fromArray(posArray, i2 * 3);
    if (face.triangles.length === 1) {
      face.samplePoint.copy(vA);
    }

    vAB.subVectors(vB, vA);
    vAC.subVectors(vC, vA);
    n.crossVectors(vAB, vAC);
    const doubleArea = n.length();
    if (doubleArea < EPS) continue;

    const area = doubleArea * 0.5;
    n.multiplyScalar(1 / doubleArea);
    if (!face.refNormal) face.refNormal = n.clone();
    else if (n.dot(face.refNormal) < 0) n.negate();

    face.normalSum.addScaledVector(n, area);
    centroid.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3);
    face.centroidSum.addScaledVector(centroid, area);
    face.areaSum += area;

    const abLenSq = vAB.lengthSq();
    if (abLenSq > face.longestEdgeLenSq) {
      face.longestEdgeLenSq = abLenSq;
      face.longestEdgeDir.copy(vAB);
    }
    vBC.subVectors(vC, vB);
    const bcLenSq = vBC.lengthSq();
    if (bcLenSq > face.longestEdgeLenSq) {
      face.longestEdgeLenSq = bcLenSq;
      face.longestEdgeDir.copy(vBC);
    }
    vCA.subVectors(vA, vC);
    const caLenSq = vCA.lengthSq();
    if (caLenSq > face.longestEdgeLenSq) {
      face.longestEdgeLenSq = caLenSq;
      face.longestEdgeDir.copy(vCA);
    }
  }

  for (const face of faces.values()) {
    const nrm = face.normalSum.lengthSq() > EPS
      ? face.normalSum.normalize()
      : (face.refNormal ? face.refNormal.clone().normalize() : new THREE.Vector3(0, 0, 1));

    const origin = face.areaSum > EPS
      ? face.centroidSum.multiplyScalar(1 / face.areaSum)
      : face.samplePoint.clone();

    let u = new THREE.Vector3();
    if (face.longestEdgeLenSq > EPS) {
      u.copy(face.longestEdgeDir);
      u.addScaledVector(nrm, -u.dot(nrm));
      if (u.lengthSq() < EPS) u = new THREE.Vector3();
    }
    if (u.lengthSq() < EPS) {
      const tmp = Math.abs(nrm.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      u.crossVectors(tmp, nrm);
    }
    u.normalize();

    const v = new THREE.Vector3().crossVectors(nrm, u).normalize();

    face.n = nrm;
    face.u = u;
    face.v = v;
    face.origin = origin;
  }

  return faces;
}

function buildAdjacency(bends) {
  const adjacency = new Map();
  for (const bend of bends) {
    const a = bend.aFaceId;
    const b = bend.bFaceId;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(bend);
    adjacency.get(b).push(bend);
  }
  return adjacency;
}

function buildAxisRotationMatrix(axisPoint, axisDir, theta) {
  const dir = axisDir.clone().normalize();
  const rot = new THREE.Matrix4().makeRotationAxis(dir, theta);
  const t1 = new THREE.Matrix4().makeTranslation(-axisPoint.x, -axisPoint.y, -axisPoint.z);
  const t2 = new THREE.Matrix4().makeTranslation(axisPoint.x, axisPoint.y, axisPoint.z);
  return new THREE.Matrix4().multiplyMatrices(t2, rot).multiply(t1);
}

function buildFaceAlignmentTransform(face, rootFace) {
  const basisRoot = new THREE.Matrix4().makeBasis(rootFace.u, rootFace.v, rootFace.n);
  const basisFace = new THREE.Matrix4().makeBasis(face.u, face.v, face.n);
  const rotation = new THREE.Matrix4().multiplyMatrices(basisRoot, basisFace.clone().transpose());
  const t1 = new THREE.Matrix4().makeTranslation(-face.origin.x, -face.origin.y, -face.origin.z);
  const t2 = new THREE.Matrix4().makeTranslation(rootFace.origin.x, rootFace.origin.y, rootFace.origin.z);
  return new THREE.Matrix4().multiplyMatrices(t2, rotation).multiply(t1);
}

function computeUnfoldTransforms(faceMap, adjacency, bends, options = {}) {
  const faceIds = Array.from(faceMap.keys()).sort((a, b) => a - b);
  if (!faceIds.length) return { faceTransforms: new Map(), rootFaceId: null };

  const preferredRoot = options.rootFaceId;
  const rootFaceId = faceMap.has(preferredRoot) ? preferredRoot : faceIds[0];
  const rootFace = faceMap.get(rootFaceId);

  const faceTransforms = new Map();
  const pending = new Set(faceIds);
  let firstRootHandled = false;

  const queue = [];

  while (pending.size) {
    let componentRootId = null;
    if (!firstRootHandled && pending.has(rootFaceId)) {
      componentRootId = rootFaceId;
      firstRootHandled = true;
    } else {
      for (const id of faceIds) {
        if (pending.has(id)) { componentRootId = id; break; }
      }
    }
    if (componentRootId == null) break;

    const componentFace = faceMap.get(componentRootId);
    const baseTransform = componentRootId === rootFaceId
      ? new THREE.Matrix4().identity()
      : buildFaceAlignmentTransform(componentFace, rootFace);

    faceTransforms.set(componentRootId, baseTransform);
    pending.delete(componentRootId);
    queue.length = 0;
    queue.push(componentRootId);

    while (queue.length) {
      const current = queue.shift();
      const currentTransform = faceTransforms.get(current);
      const edges = adjacency.get(current) || [];

      for (const bend of edges) {
        const neighbor = bend.aFaceId === current ? bend.bFaceId : bend.aFaceId;
        if (!faceMap.has(neighbor)) continue;
        if (faceTransforms.has(neighbor)) continue;

        const theta = bend.aFaceId === current ? -bend.angleRad : bend.angleRad;
        const rotation = buildAxisRotationMatrix(bend.axisPoint, bend.axisDir, theta);
        const neighborTransform = new THREE.Matrix4().multiplyMatrices(currentTransform, rotation);
        faceTransforms.set(neighbor, neighborTransform);
        pending.delete(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return { faceTransforms, rootFaceId };
}

function projectToRootPlane(point3, rootOrigin, rootU, rootV) {
  const delta = point3.clone().sub(rootOrigin);
  return new THREE.Vector2(delta.dot(rootU), delta.dot(rootV));
}

function buildCutEdges(indexAttr, faceIdAttr, bendPairs, edgeExclusions) {
  const triCount = (indexAttr.count / 3) | 0;
  const idx = indexAttr.array;

  const edgeFaces = new Map();
  const faceEdgeCounts = new Map();
  const excluded = edgeExclusions instanceof Set ? edgeExclusions : null;

  for (let t = 0; t < triCount; t++) {
    const faceId = faceIdAttr.getX(t);
    const i0 = idx[t * 3 + 0];
    const i1 = idx[t * 3 + 1];
    const i2 = idx[t * 3 + 2];
    const edges = [[i0, i1], [i1, i2], [i2, i0]];

    for (const [a, b] of edges) {
      if (excluded && excluded.has(makeEdgeKey(a, b))) continue;
      const key = makeEdgeKey(a, b);
      let faces = edgeFaces.get(key);
      if (!faces) {
        faces = new Set();
        edgeFaces.set(key, faces);
      }
      faces.add(faceId);

      let faceEdges = faceEdgeCounts.get(faceId);
      if (!faceEdges) {
        faceEdges = new Map();
        faceEdgeCounts.set(faceId, faceEdges);
      }
      let rec = faceEdges.get(key);
      if (!rec) {
        rec = { count: 0, a, b };
        faceEdges.set(key, rec);
      }
      rec.count += 1;
    }
  }

  const cutEdges = [];
  for (const [faceId, edgeMap] of faceEdgeCounts.entries()) {
    for (const [key, rec] of edgeMap.entries()) {
      if (rec.count !== 1) continue;
      const faces = edgeFaces.get(key);
      let isBendShared = false;
      if (faces && faces.size > 1) {
        for (const other of faces) {
          if (other === faceId) continue;
          const pairKey = makePairKey(faceId, other);
          if (bendPairs.has(pairKey)) { isBendShared = true; break; }
        }
      }
      if (!isBendShared) {
        cutEdges.push({ faceId, a: rec.a, b: rec.b });
      }
    }
  }
  return cutEdges;
}

function buildLoopsFromCutEdges(cutEdges, getVertex2D, epsilon) {
  const pointMap = new Map();
  const segments = [];
  const segmentKeys = new Set();

  const snapPoint = (point) => {
    const sx = snapValue(point.x, epsilon);
    const sy = snapValue(point.y, epsilon);
    const key = `${sx},${sy}`;
    if (!pointMap.has(key)) {
      pointMap.set(key, new THREE.Vector2(sx, sy));
    }
    return { key, point: pointMap.get(key) };
  };

  for (const edge of cutEdges) {
    const p0 = getVertex2D(edge.faceId, edge.a);
    const p1 = getVertex2D(edge.faceId, edge.b);
    const s0 = snapPoint(p0);
    const s1 = snapPoint(p1);
    if (s0.key === s1.key) continue;
    const segKey = makeEdgeKey(s0.key, s1.key);
    if (segmentKeys.has(segKey)) continue;
    segmentKeys.add(segKey);
    segments.push({ k0: s0.key, k1: s1.key });
  }

  const adjacency = new Map();
  for (const seg of segments) {
    if (!adjacency.has(seg.k0)) adjacency.set(seg.k0, []);
    if (!adjacency.has(seg.k1)) adjacency.set(seg.k1, []);
    adjacency.get(seg.k0).push(seg.k1);
    adjacency.get(seg.k1).push(seg.k0);
  }
  for (const list of adjacency.values()) {
    list.sort();
  }

  const segByKey = new Map();
  for (const seg of segments) {
    segByKey.set(makeEdgeKey(seg.k0, seg.k1), seg);
  }

  const unused = new Set(segmentKeys);
  const sortedKeys = Array.from(segmentKeys).sort();
  const loops = [];

  for (const segKey of sortedKeys) {
    if (!unused.has(segKey)) continue;
    const seg = segByKey.get(segKey);
    if (!seg) continue;
    unused.delete(segKey);

    const start = seg.k0;
    let prev = seg.k0;
    let curr = seg.k1;
    const loopKeys = [start, curr];

    let guard = 0;
    while (curr !== start && guard < segments.length + 10) {
      guard += 1;
      const neighbors = adjacency.get(curr) || [];
      let next = null;
      for (const neighbor of neighbors) {
        if (neighbor === prev) continue;
        const candidateKey = makeEdgeKey(curr, neighbor);
        if (unused.has(candidateKey)) { next = neighbor; break; }
      }
      if (!next) break;
      const usedKey = makeEdgeKey(curr, next);
      unused.delete(usedKey);
      prev = curr;
      curr = next;
      loopKeys.push(curr);
    }

    if (curr === start && loopKeys.length > 2) {
      loopKeys.pop();
      const points = loopKeys.map((key) => pointMap.get(key));
      loops.push(points);
    }
  }

  const outlines = [];
  const holes = [];
  for (const loop of loops) {
    const area = signedArea(loop);
    if (area >= 0) outlines.push(loop);
    else holes.push(loop);
  }

  return { outlines, holes, loops, pointMap };
}

function signedArea(points) {
  let area = 0;
  const len = points.length;
  for (let i = 0; i < len; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % len];
    area += (p0.x * p1.y) - (p1.x * p0.y);
  }
  return area * 0.5;
}

function clipSegmentToBox(p0, p1, min, max) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  let t0 = 0;
  let t1 = 1;

  const p = [-dx, dx, -dy, dy];
  const q = [p0.x - min.x, max.x - p0.x, p0.y - min.y, max.y - p0.y];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        t0 = Math.max(t0, r);
      } else {
        t1 = Math.min(t1, r);
      }
      if (t0 > t1) return null;
    }
  }

  return {
    p0: new THREE.Vector2(p0.x + t0 * dx, p0.y + t0 * dy),
    p1: new THREE.Vector2(p0.x + t1 * dx, p0.y + t1 * dy),
  };
}

function buildBendLines(bends, faceTransforms, rootOrigin, rootU, rootV, options, faceBounds2D, fallbackBounds) {
  const bendLines = [];
  const clipExtent = Number.isFinite(options.clipExtent) ? options.clipExtent : DEFAULT_CLIP_EXTENT;

  for (const bend of bends) {
    const transformA = faceTransforms.get(bend.aFaceId);
    if (!transformA) continue;

    const axisPoint = bend.axisPoint.clone();
    const axisDir = bend.axisDir.clone().normalize();
    if (axisDir.lengthSq() < EPS) continue;

    const p0 = axisPoint.clone().applyMatrix4(transformA);
    const p1 = axisPoint.clone().add(axisDir).applyMatrix4(transformA);
    const dir = p1.sub(p0).normalize();

    const longA = p0.clone().addScaledVector(dir, -clipExtent);
    const longB = p0.clone().addScaledVector(dir, clipExtent);

    const p0_2d = projectToRootPlane(longA, rootOrigin, rootU, rootV);
    const p1_2d = projectToRootPlane(longB, rootOrigin, rootU, rootV);

    let bounds = null;
    const boundsA = faceBounds2D.get(bend.aFaceId);
    const boundsB = faceBounds2D.get(bend.bFaceId);
    if (boundsA && boundsB) {
      bounds = {
        min: boundsA.min.clone().min(boundsB.min),
        max: boundsA.max.clone().max(boundsB.max),
      };
    } else if (boundsA) {
      bounds = { min: boundsA.min.clone(), max: boundsA.max.clone() };
    } else if (boundsB) {
      bounds = { min: boundsB.min.clone(), max: boundsB.max.clone() };
    } else if (fallbackBounds) {
      bounds = { min: fallbackBounds.min.clone(), max: fallbackBounds.max.clone() };
    }

    let clipped = { p0: p0_2d, p1: p1_2d };
    if (bounds) {
      const clip = clipSegmentToBox(p0_2d, p1_2d, bounds.min, bounds.max);
      if (!clip) continue;
      clipped = clip;
    }

    const thickness = Number.isFinite(bend.thickness) ? bend.thickness : 0;
    const kFactor = Number.isFinite(bend.kFactor) ? bend.kFactor : 0;
    const radius = Number.isFinite(bend.radius) ? bend.radius : 0;
    const angle = Number.isFinite(bend.angleRad) ? bend.angleRad : 0;
    const bendAllowance = Math.abs(angle) * (radius + kFactor * thickness);

    bendLines.push({
      bendId: bend.bendId,
      aFaceId: bend.aFaceId,
      bFaceId: bend.bFaceId,
      p0: clipped.p0,
      p1: clipped.p1,
      angleRad: angle,
      radius,
      thickness,
      kFactor,
      upDown: bend.upDown,
      bendAllowance,
    });
  }

  return bendLines;
}

/**
 * Unfold sheet metal geometry into a flat pattern.
 * @param {THREE.BufferGeometry} geometry
 * @param {Array<Bend>} bends
 * @param {Object} options
 * @param {number} [options.rootFaceId]
 * @param {number} [options.epsilon]
 * @param {number} [options.clipExtent]
 * @param {Set<string>} [options.edgeExclusions]
 * @returns {FlatPattern}
 */
export function unfoldSheetMetal(geometry, bends = [], options = {}) {
  if (!geometry || !(geometry instanceof THREE.BufferGeometry)) {
    throw new Error('unfoldSheetMetal: geometry must be a THREE.BufferGeometry.');
  }
  if (!geometry.index) {
    throw new Error('unfoldSheetMetal: geometry must be indexed triangles.');
  }

  const faceIdAttr = geometry.getAttribute('faceId');
  if (!faceIdAttr) {
    throw new Error('unfoldSheetMetal: geometry is missing faceId attribute (per-triangle).');
  }

  const triCount = (geometry.index.count / 3) | 0;
  if (faceIdAttr.count !== triCount) {
    throw new Error('unfoldSheetMetal: faceId attribute count must equal triangle count.');
  }

  const epsilon = Number.isFinite(options.epsilon) ? options.epsilon : DEFAULT_EPSILON;
  const faceMap = buildFacePanels(geometry, faceIdAttr);
  const adjacency = buildAdjacency(bends);

  const bendPairs = new Set();
  for (const bend of bends) {
    bendPairs.add(makePairKey(bend.aFaceId, bend.bFaceId));
  }

  const { faceTransforms, rootFaceId } = computeUnfoldTransforms(faceMap, adjacency, bends, options);
  const rootFace = rootFaceId != null ? faceMap.get(rootFaceId) : null;
  if (!rootFace) {
    return {
      faceTransforms,
      vertex2D: [],
      outlines: [],
      holes: [],
      bendLines: [],
    };
  }

  const rootOrigin = rootFace.origin.clone();
  const rootU = rootFace.u.clone().normalize();
  const rootV = rootFace.v.clone().normalize();

  const position = geometry.getAttribute('position');
  const posArray = position.array;
  const idxArray = geometry.index.array;
  const vertexCount = position.count;

  const vertex2D = new Array(vertexCount);
  const vertex2DByFace = new Map();
  const faceBounds2D = new Map();

  const temp3 = new THREE.Vector3();

  const getVertex2D = (faceId, vertexIndex) => {
    let map = vertex2DByFace.get(faceId);
    if (!map) {
      map = new Map();
      vertex2DByFace.set(faceId, map);
    }
    if (map.has(vertexIndex)) return map.get(vertexIndex);

    const transform = faceTransforms.get(faceId) || new THREE.Matrix4().identity();
    temp3.fromArray(posArray, vertexIndex * 3).applyMatrix4(transform);
    const p2 = projectToRootPlane(temp3, rootOrigin, rootU, rootV);

    map.set(vertexIndex, p2);

    if (!vertex2D[vertexIndex]) {
      vertex2D[vertexIndex] = p2.clone();
    }

    const bounds = faceBounds2D.get(faceId);
    faceBounds2D.set(faceId, updateBounds(bounds, p2));

    return p2;
  };

  // Populate vertex2D for all triangle vertices (per-face mapping)
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIdAttr.getX(t);
    const i0 = idxArray[t * 3 + 0];
    const i1 = idxArray[t * 3 + 1];
    const i2 = idxArray[t * 3 + 2];
    getVertex2D(faceId, i0);
    getVertex2D(faceId, i1);
    getVertex2D(faceId, i2);
  }

  const cutEdges = buildCutEdges(
    geometry.index,
    faceIdAttr,
    bendPairs,
    options.edgeExclusions,
  );
  const { outlines, holes, loops, pointMap } = buildLoopsFromCutEdges(cutEdges, getVertex2D, epsilon);

  let overallBounds = null;
  for (const loop of loops) {
    for (const pt of loop) {
      overallBounds = updateBounds(overallBounds, pt);
    }
  }
  if (!overallBounds && pointMap.size) {
    for (const pt of pointMap.values()) {
      overallBounds = updateBounds(overallBounds, pt);
    }
  }

  const bendLines = buildBendLines(
    bends,
    faceTransforms,
    rootOrigin,
    rootU,
    rootV,
    options,
    faceBounds2D,
    overallBounds
  );

  return {
    faceTransforms,
    vertex2D,
    outlines,
    holes,
    bendLines,
  };
}

function formatNumber(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const fixed = n.toFixed(decimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d+?)0+$/, '$1');
}

function polylineToPath(points, close, transformPoint, decimals) {
  if (!points.length) return '';
  const first = transformPoint(points[0]);
  let d = `M ${formatNumber(first.x, decimals)} ${formatNumber(first.y, decimals)}`;
  for (let i = 1; i < points.length; i++) {
    const p = transformPoint(points[i]);
    d += ` L ${formatNumber(p.x, decimals)} ${formatNumber(p.y, decimals)}`;
  }
  if (close) d += ' Z';
  return d;
}

function segmentsToPath(segments, transformPoint, decimals) {
  let d = '';
  for (const seg of segments) {
    const p0 = transformPoint(seg.p0);
    const p1 = transformPoint(seg.p1);
    d += `M ${formatNumber(p0.x, decimals)} ${formatNumber(p0.y, decimals)} `;
    d += `L ${formatNumber(p1.x, decimals)} ${formatNumber(p1.y, decimals)} `;
  }
  return d.trim();
}

/**
 * Export flat pattern outlines + bend lines to an SVG string.
 * @param {FlatPattern} flatPattern
 * @param {Object} options
 * @param {number} [options.scale]
 * @param {number} [options.padding]
 * @param {boolean} [options.includeBends]
 * @param {boolean} [options.flipY]
 * @param {number} [options.decimals]
 * @returns {string}
 */
export function exportFlatPatternToSVG(flatPattern, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const padding = Number.isFinite(options.padding) ? options.padding : 0;
  const includeBends = options.includeBends !== false;
  const flipY = options.flipY === true;
  const decimals = Number.isFinite(options.decimals) ? options.decimals : 5;

  const outlines = Array.isArray(flatPattern?.outlines) ? flatPattern.outlines : [];
  const holes = Array.isArray(flatPattern?.holes) ? flatPattern.holes : [];
  const bends = Array.isArray(flatPattern?.bendLines) ? flatPattern.bendLines : [];

  const transformPoint = (p) => {
    const x = p.x * scale;
    const y = p.y * scale;
    return new THREE.Vector2(x, flipY ? -y : y);
  };

  let bounds = null;
  const addBounds = (pt) => { bounds = updateBounds(bounds, pt); };

  for (const loop of outlines) {
    for (const p of loop) addBounds(transformPoint(p));
  }
  for (const loop of holes) {
    for (const p of loop) addBounds(transformPoint(p));
  }
  if (includeBends) {
    for (const seg of bends) {
      addBounds(transformPoint(seg.p0));
      addBounds(transformPoint(seg.p1));
    }
  }

  if (!bounds) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"/>';
  }

  const minX = bounds.min.x - padding;
  const minY = bounds.min.y - padding;
  const maxX = bounds.max.x + padding;
  const maxY = bounds.max.y + padding;
  const width = maxX - minX;
  const height = maxY - minY;

  const outlinePath = outlines
    .map((loop) => polylineToPath(loop, true, transformPoint, decimals))
    .filter(Boolean)
    .join(' ');
  const holePath = holes
    .map((loop) => polylineToPath(loop, true, transformPoint, decimals))
    .filter(Boolean)
    .join(' ');
  const bendPath = includeBends ? segmentsToPath(bends, transformPoint, decimals) : '';

  const paths = [];
  if (outlinePath) paths.push(`<path d="${outlinePath}" fill="none" stroke="black"/>`);
  if (holePath) paths.push(`<path d="${holePath}" fill="none" stroke="black"/>`);
  if (bendPath) paths.push(`<path d="${bendPath}" fill="none" stroke="black"/>`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width, decimals)}" height="${formatNumber(height, decimals)}" viewBox="${formatNumber(minX, decimals)} ${formatNumber(minY, decimals)} ${formatNumber(width, decimals)} ${formatNumber(height, decimals)}">`,
    ...paths,
    '</svg>',
  ].join('');
}

function buildLineGeometryFromPolylines(polylines) {
  const positions = [];
  for (const loop of polylines) {
    if (!loop || loop.length < 2) continue;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      positions.push(a.x, a.y, 0, b.x, b.y, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function buildLineGeometryFromSegments(segments) {
  const positions = [];
  for (const seg of segments) {
    positions.push(seg.p0.x, seg.p0.y, 0, seg.p1.x, seg.p1.y, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Build debug line segments for cut edges and bend lines.
 * @param {FlatPattern} flatPattern
 * @returns {{cut: THREE.LineSegments, bends: THREE.LineSegments}}
 */
export function buildDebugLineSegments(flatPattern) {
  const outlines = Array.isArray(flatPattern?.outlines) ? flatPattern.outlines : [];
  const holes = Array.isArray(flatPattern?.holes) ? flatPattern.holes : [];
  const bends = Array.isArray(flatPattern?.bendLines) ? flatPattern.bendLines : [];

  const cutGeometry = buildLineGeometryFromPolylines([...outlines, ...holes]);
  const bendGeometry = buildLineGeometryFromSegments(bends);

  return {
    cut: new THREE.LineSegments(cutGeometry, new THREE.LineBasicMaterial()),
    bends: new THREE.LineSegments(bendGeometry, new THREE.LineBasicMaterial()),
  };
}

/*
Example usage (ES modules):

import * as THREE from 'three';
import { unfoldSheetMetal, exportFlatPatternToSVG } from './sheetMetalUnfold.js';

// Build a simple two-face folded sheet.
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array([
  // Base face (z = 0)
  0, 0, 0,  // 0
  1, 0, 0,  // 1
  1, 1, 0,  // 2
  0, 1, 0,  // 3
  // Flange face (y = 1, folded up)
  1, 1, 1,  // 4
  0, 1, 1,  // 5
]);
const indices = new Uint16Array([
  0, 1, 2,  0, 2, 3,  // base (faceId 0)
  3, 2, 4,  3, 4, 5,  // flange (faceId 1)
]);
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

const faceIds = new Uint16Array(indices.length / 3);
faceIds[0] = 0; faceIds[1] = 0;
faceIds[2] = 1; faceIds[3] = 1;
geometry.setAttribute('faceId', new THREE.BufferAttribute(faceIds, 1));

const bends = [{
  bendId: 'B1',
  aFaceId: 0,
  bFaceId: 1,
  axisPoint: new THREE.Vector3(0, 1, 0),
  axisDir: new THREE.Vector3(1, 0, 0),
  angleRad: Math.PI / 2,
  radius: 0.05,
  thickness: 0.1,
  kFactor: 0.4,
  upDown: 'up',
}];

const flat = unfoldSheetMetal(geometry, bends, { rootFaceId: 0 });
console.log(exportFlatPatternToSVG(flat, { includeBends: true }));
*/

// STEP (ISO 10303-21) exporter for triangulated solids.
// This writes a faceted BREP and merges coplanar regions into polygon faces.
// Optional: emit AP242 tessellated faces for non-planar regions.

function _escapeStepString(value) {
  const s = String(value == null ? '' : value);
  // STEP strings escape single quotes by doubling them.
  return s.replace(/'/g, "''");
}

function _safeStepName(value, fallback = 'NAME') {
  const raw = String(value ?? '').trim();
  return _escapeStepString(raw || fallback);
}

function _fmtNumber(n, precision) {
  if (!Number.isFinite(n)) return '0';
  let s = Number(n).toFixed(precision);
  // Trim trailing zeros for smaller files, but keep integers intact.
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s;
}

function _fmtExp(n, precision = 6) {
  if (!Number.isFinite(n) || n === 0) return '0.';
  const s = Number(n).toExponential(precision);
  const [mant, exp] = s.split('e');
  const expInt = Number(exp);
  return `${mant.toUpperCase()}E${expInt >= 0 ? '+' : ''}${expInt}`;
}

function _isIdentityMatrixElements(elements, epsilon = 1e-12) {
  if (!elements || elements.length !== 16) return true;
  const id = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  for (let i = 0; i < 16; i++) {
    if (Math.abs((elements[i] ?? id[i]) - id[i]) > epsilon) return false;
  }
  return true;
}

function _applyMatrix4(elements, x, y, z) {
  if (!elements || elements.length !== 16) return [x, y, z];
  const nx = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
  const ny = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
  const nz = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
  const nw = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
  if (nw && Math.abs(nw - 1) > 1e-12) {
    return [nx / nw, ny / nw, nz / nw];
  }
  return [nx, ny, nz];
}

function _normalize(vec, fallback = [0, 0, 1]) {
  const x = vec[0];
  const y = vec[1];
  const z = vec[2];
  const len = Math.hypot(x, y, z);
  if (!len || !Number.isFinite(len)) return fallback.slice();
  return [x / len, y / len, z / len];
}

function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function _dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function _sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function _orthogonalRefDir(normal) {
  // Pick a stable axis that is not parallel to the normal.
  const nz = Math.abs(normal[2]);
  const axis = nz < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const ref = _cross(axis, normal);
  return _normalize(ref, [1, 0, 0]);
}

function _formatEntityList(ids, breakEvery = 40) {
  if (!ids || ids.length === 0) return '()';
  if (ids.length <= breakEvery) return `(${ids.map((id) => `#${id}`).join(',')})`;
  const chunks = [];
  for (let i = 0; i < ids.length; i += breakEvery) {
    const slice = ids.slice(i, i + breakEvery).map((id) => `#${id}`).join(',');
    chunks.push(slice);
  }
  return `(\n  ${chunks.join(',\n  ')}\n)`;
}

function _quantize(value, tol) {
  if (!Number.isFinite(value) || !Number.isFinite(tol) || tol <= 0) return 0;
  return Math.round(value / tol);
}

function _planeKey(normal, d, normalTol, distTol) {
  const qx = _quantize(normal[0], normalTol);
  const qy = _quantize(normal[1], normalTol);
  const qz = _quantize(normal[2], normalTol);
  const qd = _quantize(d, distTol);
  return `${qx},${qy},${qz},${qd}`;
}

function _edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function _collectBoundaryEdges(triIndices, triData) {
  const edgeMap = new Map();
  for (const t of triIndices) {
    const tri = triData[t];
    if (!tri) continue;
    const edges = [
      [tri.i0, tri.i1],
      [tri.i1, tri.i2],
      [tri.i2, tri.i0],
    ];
    for (const [a, b] of edges) {
      const key = _edgeKey(a, b);
      const entry = edgeMap.get(key);
      if (!entry) {
        edgeMap.set(key, { count: 1, from: a, to: b });
      } else {
        entry.count += 1;
      }
    }
  }
  const boundary = [];
  for (const entry of edgeMap.values()) {
    if (entry.count === 1) boundary.push({ from: entry.from, to: entry.to });
  }
  return boundary;
}

function _buildLoopsFromEdges(boundaryEdges) {
  const startMap = new Map();
  for (const e of boundaryEdges) {
    const list = startMap.get(e.from) || [];
    list.push(e);
    startMap.set(e.from, list);
  }

  const used = new Set();
  const loops = [];
  const edgeId = (e) => `${e.from},${e.to}`;

  for (const e of boundaryEdges) {
    const key = edgeId(e);
    if (used.has(key)) continue;
    const loop = [e.from];
    let current = e;
    used.add(key);
    let guard = 0;
    while (guard++ < boundaryEdges.length + 5) {
      loop.push(current.to);
      if (current.to === loop[0]) {
        loop.pop();
        if (loop.length >= 3) loops.push(loop);
        break;
      }
      const nextEdges = startMap.get(current.to) || [];
      let next = null;
      for (const cand of nextEdges) {
        const k = edgeId(cand);
        if (!used.has(k)) { next = cand; break; }
      }
      if (!next) {
        return { loops: [], ok: false };
      }
      current = next;
      used.add(edgeId(current));
    }
  }

  return { loops, ok: loops.length > 0 };
}

function _buildBoundaryEdgePolylines(mesh, idToFaceName) {
  const { vertProperties, triVerts, faceID } = mesh || {};
  if (!vertProperties || !triVerts || !faceID) return [];
  const triCount = (triVerts.length / 3) | 0;
  const nv = (vertProperties.length / 3) | 0;
  if (triCount === 0 || nv === 0) return [];

  const NV = BigInt(nv);
  const ukey = (a, b) => {
    const A = BigInt(a);
    const B = BigInt(b);
    return A < B ? (A * NV + B) : (B * NV + A);
  };

  const e2t = new Map(); // key -> [{id, a, b, tri}...]
  for (let t = 0; t < triCount; t++) {
    const id = faceID ? faceID[t] : undefined;
    const base = t * 3;
    const i0 = triVerts[base + 0];
    const i1 = triVerts[base + 1];
    const i2 = triVerts[base + 2];
    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (let k = 0; k < 3; k++) {
      const a = edges[k][0];
      const b = edges[k][1];
      const key = ukey(a, b);
      let arr = e2t.get(key);
      if (!arr) { arr = []; e2t.set(key, arr); }
      arr.push({ id, a, b, tri: t });
    }
  }

  const pairToEdges = new Map(); // pairKey -> array of [u,v]
  for (const [, arr] of e2t.entries()) {
    if (arr.length !== 2) continue;
    const a = arr[0];
    const b = arr[1];
    if (a.id === b.id) continue;
    const nameA = idToFaceName?.get(a.id) || `FACE_${a.id}`;
    const nameB = idToFaceName?.get(b.id) || `FACE_${b.id}`;
    const pair = nameA < nameB ? [nameA, nameB] : [nameB, nameA];
    const pairKey = JSON.stringify(pair);
    let list = pairToEdges.get(pairKey);
    if (!list) { list = []; pairToEdges.set(pairKey, list); }
    const v0 = Math.min(a.a, a.b);
    const v1 = Math.max(a.a, a.b);
    list.push([v0, v1]);
  }

  const polylines = [];
  for (const [pairKey, edges] of pairToEdges.entries()) {
    const adj = new Map(); // v -> Set(neighbors)
    const edgeVisited = new Set(); // `${min},${max}`
    const ek = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
    for (const [u, v] of edges) {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u).add(v);
      adj.get(v).add(u);
    }

    const [faceA, faceB] = JSON.parse(pairKey);
    let idx = 0;

    const visitChainFrom = (start) => {
      const chain = [];
      let prev = -1;
      let curr = start;
      chain.push(curr);
      while (true) {
        const nbrs = adj.get(curr) || new Set();
        let next = undefined;
        for (const n of nbrs) {
          const key = ek(curr, n);
          if (edgeVisited.has(key)) continue;
          if (n === prev) continue;
          next = n;
          edgeVisited.add(key);
          break;
        }
        if (next === undefined) break;
        prev = curr;
        curr = next;
        chain.push(curr);
      }
      return chain;
    };

    for (const [v, nbrs] of adj.entries()) {
      if ((nbrs.size | 0) === 1) {
        const n = [...nbrs][0];
        const key = ek(v, n);
        if (edgeVisited.has(key)) continue;
        const chain = visitChainFrom(v);
        polylines.push({ name: `${faceA}|${faceB}[${idx++}]`, faceA, faceB, indices: chain, closedLoop: false });
      }
    }

    const buildLoopFromEdge = (startU, startV) => {
      const chain = [startU, startV];
      let prev = startU;
      let curr = startV;
      edgeVisited.add(ek(startU, startV));
      while (true) {
        const nbrs = adj.get(curr) || new Set();
        let next = undefined;
        for (const n of nbrs) {
          if (n === prev) continue;
          const key = ek(curr, n);
          if (edgeVisited.has(key)) continue;
          next = n;
          break;
        }
        if (next === undefined) break;
        edgeVisited.add(ek(curr, next));
        chain.push(next);
        prev = curr;
        curr = next;
      }
      const start = chain[0];
      const last = chain[chain.length - 1];
      const nbrsLast = adj.get(last) || new Set();
      if (nbrsLast.has(start)) {
        edgeVisited.add(ek(last, start));
        chain.push(start);
      }
      return chain;
    };

    for (const [u, nbrs] of adj.entries()) {
      for (const v of nbrs) {
        const key = ek(u, v);
        if (edgeVisited.has(key)) continue;
        const chain = buildLoopFromEdge(u, v);
        const closed = chain.length >= 3 && chain[0] === chain[chain.length - 1];
        polylines.push({ name: `${faceA}|${faceB}[${idx++}]`, faceA, faceB, indices: chain, closedLoop: closed });
      }
    }
  }

  return polylines;
}

function _loopArea(loop, vertexPoints, u, v) {
  let area = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = vertexPoints[loop[i]]?.pos;
    const q = vertexPoints[loop[(i + 1) % n]]?.pos;
    if (!p || !q) continue;
    const px = _dot(p, u);
    const py = _dot(p, v);
    const qx = _dot(q, u);
    const qy = _dot(q, v);
    area += (px * qy) - (qx * py);
  }
  return area * 0.5;
}

function _planeBasis(normal, refDir) {
  let u = _normalize(refDir, _orthogonalRefDir(normal));
  if (Math.abs(_dot(u, normal)) > 0.99) {
    u = _orthogonalRefDir(normal);
  }
  u = _normalize(u);
  const v = _normalize(_cross(normal, u), _orthogonalRefDir(normal));
  return { u, v };
}

function _splitComponents(triIndices, triData) {
  const edgeToTris = new Map();
  for (const t of triIndices) {
    const tri = triData[t];
    if (!tri) continue;
    const edges = [
      [tri.i0, tri.i1],
      [tri.i1, tri.i2],
      [tri.i2, tri.i0],
    ];
    for (const [a, b] of edges) {
      const key = _edgeKey(a, b);
      const list = edgeToTris.get(key) || [];
      list.push(t);
      edgeToTris.set(key, list);
    }
  }

  const visited = new Set();
  const components = [];
  for (const t of triIndices) {
    if (visited.has(t)) continue;
    const stack = [t];
    const comp = [];
    visited.add(t);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      const tri = triData[cur];
      if (!tri) continue;
      const edges = [
        [tri.i0, tri.i1],
        [tri.i1, tri.i2],
        [tri.i2, tri.i0],
      ];
      for (const [a, b] of edges) {
        const key = _edgeKey(a, b);
        const list = edgeToTris.get(key) || [];
        if (list.length < 2) continue;
        for (const nei of list) {
          if (!visited.has(nei)) {
            visited.add(nei);
            stack.push(nei);
          }
        }
      }
    }
    if (comp.length) components.push(comp);
  }
  return components;
}

function _isCoplanarGroup(triIndices, triData, normalTol, distTol) {
  if (!triIndices || triIndices.length === 0) return false;
  const tri0 = triData[triIndices[0]];
  if (!tri0) return false;
  let n0 = tri0.normal;
  let d0 = tri0.d;

  for (const idx of triIndices) {
    const tri = triData[idx];
    if (!tri) continue;
    let n = tri.normal;
    let d = tri.d;
    let dot = _dot(n, n0);
    if (dot < 0) {
      n = [-n[0], -n[1], -n[2]];
      d = -d;
      dot = -dot;
    }
    if ((1 - dot) > normalTol) return false;
    if (Math.abs(d - d0) > distTol) return false;
  }
  return true;
}

function _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, faceName = '') {
  const v0 = vertexPoints[tri.i0];
  const v1 = vertexPoints[tri.i1];
  const v2 = vertexPoints[tri.i2];
  if (!v0 || !v1 || !v2) return null;

  const normal = tri.normal;
  const refBasis = _planeBasis(normal, tri.e1);
  const axisDirId = getDirectionId(normal);
  const refDirId = getDirectionId(refBasis.u);
  const axis2Id = builder.add(`AXIS2_PLACEMENT_3D('',#${v0.pointId},#${axisDirId},#${refDirId})`);
  const planeId = builder.add(`PLANE('',#${axis2Id})`);
  const loopId = builder.add(`POLY_LOOP('',(#${v0.pointId},#${v1.pointId},#${v2.pointId}))`);
  const boundId = builder.add(`FACE_OUTER_BOUND('',#${loopId},.T.)`);
  const faceId = builder.add(`ADVANCED_FACE('${_safeStepName(faceName, '')}',(#${boundId}),#${planeId},.T.)`);
  return faceId;
}

function _emitPlanarComponent(component, triData, vertexPoints, builder, getDirectionId, precision, faceName = '', edgeContext = null) {
  if (!component.length) return { ok: false };
  const tri0 = triData[component[0]];
  if (!tri0) return { ok: false };

  const boundaryEdges = _collectBoundaryEdges(component, triData);
  if (boundaryEdges.length < 3) return { ok: false };

  const { loops, ok } = _buildLoopsFromEdges(boundaryEdges);
  if (!ok || loops.length === 0) return { ok: false };

  const normal = tri0.normal;
  const basis = _planeBasis(normal, tri0.e1);

  const loopAreas = loops.map((loop) => _loopArea(loop, vertexPoints, basis.u, basis.v));
  let outerIdx = 0;
  let maxAbs = Math.abs(loopAreas[0] || 0);
  for (let i = 1; i < loopAreas.length; i++) {
    const absA = Math.abs(loopAreas[i] || 0);
    if (absA > maxAbs) {
      maxAbs = absA;
      outerIdx = i;
    }
  }

  // Ensure outer loop is CCW (positive area)
  if (loopAreas[outerIdx] < 0) {
    loops[outerIdx].reverse();
    loopAreas[outerIdx] = -loopAreas[outerIdx];
  }

  // Ensure inner loops are CW (negative area)
  for (let i = 0; i < loops.length; i++) {
    if (i === outerIdx) continue;
    if (loopAreas[i] > 0) {
      loops[i].reverse();
      loopAreas[i] = -loopAreas[i];
    }
  }

  const originIndex = loops[outerIdx][0];
  const originPoint = vertexPoints[originIndex];
  if (!originPoint) return { ok: false };

  const axisDirId = getDirectionId(normal);
  const refDirId = getDirectionId(basis.u);
  const axis2Id = builder.add(`AXIS2_PLACEMENT_3D('',#${originPoint.pointId},#${axisDirId},#${refDirId})`);
  const planeId = builder.add(`PLANE('',#${axis2Id})`);

  const boundIds = [];
  const buildEdgeLoop = (loop, loopName) => {
    if (!edgeContext) return null;
    const orientedEdges = [];
    const count = loop.length;
    for (let i = 0; i < count; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % count];
      const key = _edgeKey(a, b);
      let edgeRec = edgeContext.edgeCurveCache.get(key);
      if (!edgeRec) {
        const name = edgeContext.edgeNameByKey.get(key)
          || edgeContext.edgeNameAllocator.allocate(`EDGE_${edgeContext.edgeCurveCache.size}`);
        const vStart = vertexPoints[a];
        const vEnd = vertexPoints[b];
        if (!vStart || !vEnd) return null;
        const polylineId = builder.add(`POLYLINE('',(#${vStart.pointId},#${vEnd.pointId}))`);
        const edgeCurveId = builder.add(`EDGE_CURVE('${_safeStepName(name)}',#${vStart.vertexId},#${vEnd.vertexId},#${polylineId},.T.)`);
        edgeRec = { id: edgeCurveId, start: a, end: b };
        edgeContext.edgeCurveCache.set(key, edgeRec);
      }
      const sense = (edgeRec.start === a && edgeRec.end === b) ? '.T.' : '.F.';
      const oeId = builder.add(`ORIENTED_EDGE('',*,*,#${edgeRec.id},${sense})`);
      orientedEdges.push(oeId);
    }
    if (!orientedEdges.length) return null;
    const loopId = builder.add(`EDGE_LOOP('${_safeStepName(loopName, '')}',(${orientedEdges.map((id) => `#${id}`).join(',')}))`);
    return loopId;
  };
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i];
    if (!loop || loop.length < 3) continue;
    const pointRefs = loop.map((idx) => {
      const pointId = vertexPoints[idx]?.pointId;
      return pointId ? `#${pointId}` : null;
    });
    if (pointRefs.length < 3 || pointRefs.some((p) => !p)) {
      return { ok: false };
    }
    let loopId = null;
    if (edgeContext) {
      loopId = buildEdgeLoop(loop, `${faceName}_LOOP_${i}`);
    }
    if (!loopId) {
      loopId = builder.add(`POLY_LOOP('',(${pointRefs.join(',')}))`);
    }
    if (i === outerIdx) {
      const boundId = builder.add(`FACE_OUTER_BOUND('',#${loopId},.T.)`);
      boundIds.push(boundId);
    } else {
      const boundId = builder.add(`FACE_BOUND('',#${loopId},.F.)`);
      boundIds.push(boundId);
    }
  }

  if (boundIds.length === 0) return { ok: false };

  const faceId = builder.add(`ADVANCED_FACE('${_safeStepName(faceName, '')}',(${boundIds.map((id) => `#${id}`).join(',')}),#${planeId},.T.)`);
  return { ok: true, faceId };
}

function _emitTessellatedFace(component, triData, vertexPoints, builder, precision, faceName = '') {
  if (!component || component.length === 0) return { ok: false };

  const usedVertices = new Map(); // mesh vertex index -> tessellated index
  const coords = [];
  const tris = [];

  const addVertex = (idx) => {
    let mapped = usedVertices.get(idx);
    if (mapped != null) return mapped;
    const v = vertexPoints[idx];
    if (!v) return null;
    const p = v.pos;
    const mappedIdx = coords.length;
    coords.push([p[0], p[1], p[2]]);
    usedVertices.set(idx, mappedIdx);
    return mappedIdx;
  };

  for (const triIdx of component) {
    const tri = triData[triIdx];
    if (!tri) continue;
    const a = addVertex(tri.i0);
    const b = addVertex(tri.i1);
    const c = addVertex(tri.i2);
    if (a == null || b == null || c == null) continue;
    tris.push([a + 1, b + 1, c + 1]); // 1-based indices
  }

  if (coords.length < 3 || tris.length === 0) return { ok: false };

  const coordList = coords
    .map((p) => `(${_fmtNumber(p[0], precision)},${_fmtNumber(p[1], precision)},${_fmtNumber(p[2], precision)})`)
    .join(',');
  const pointListId = builder.add(`CARTESIAN_POINT_LIST_3D('',(${coordList}))`);

  const triList = tris.map((t) => `(${t[0]},${t[1]},${t[2]})`).join(',');
  const faceId = builder.add(`TRIANGULATED_FACE('${_safeStepName(faceName, '')}',#${pointListId},(${triList}),$)`);
  return { ok: true, faceId };
}

class StepBuilder {
  constructor() {
    this.nextId = 1;
    this.lines = [];
  }

  add(entityBody) {
    const id = this.nextId++;
    this.lines.push(`#${id}=${entityBody};`);
    return id;
  }
}

class NameAllocator {
  constructor() {
    this.counts = new Map();
  }

  allocate(base) {
    const name = _safeStepName(base, 'NAME');
    const count = this.counts.get(name) || 0;
    this.counts.set(name, count + 1);
    if (count === 0) return name;
    return _safeStepName(`${name}[${count}]`);
  }
}

function _buildLengthUnit(builder, unitName) {
  const u = String(unitName || 'millimeter').toLowerCase();

  // Base SI metre (used directly or as a conversion reference).
  const metreUnitId = builder.add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.))');

  const siPrefixByUnit = {
    millimeter: '.MILLI.',
    centimeter: '.CENTI.',
    meter: '$',
    micron: '.MICRO.',
  };

  if (Object.prototype.hasOwnProperty.call(siPrefixByUnit, u)) {
    const prefix = siPrefixByUnit[u];
    if (prefix === '$') return metreUnitId;
    return builder.add(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(${prefix},.METRE.))`);
  }

  if (u === 'inch' || u === 'foot') {
    const factor = u === 'inch' ? 0.0254 : 0.3048;
    const name = u === 'inch' ? 'INCH' : 'FOOT';
    const measureId = builder.add(
      `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${_fmtNumber(factor, 8)}),#${metreUnitId})`,
    );
    return builder.add(`(CONVERSION_BASED_UNIT('${name}',#${measureId}) LENGTH_UNIT() NAMED_UNIT(*))`);
  }

  // Fallback to millimeters.
  return builder.add('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
}

/**
 * Generate a STEP string for one or more solids.
 * @param {Array} solids SOLID-like objects exposing getMesh() and name.
 * @param {{name?: string, unit?: string, precision?: number, scale?: number, applyWorldTransform?: boolean, mergePlanarFaces?: boolean, planarNormalTolerance?: number, planarDistanceTolerance?: number, useTessellatedFaces?: boolean, exportFaces?: boolean, exportEdgesAsPolylines?: boolean}} opts
 * @returns {{data: string, exported: number, skipped: string[]}}
 */
export function generateSTEP(solids, opts = {}) {
  const unit = opts.unit || 'millimeter';
  const precision = Number.isFinite(opts.precision) ? opts.precision : 6;
  const scale = Number.isFinite(opts.scale) ? opts.scale : 1;
  const applyWorldTransform = opts.applyWorldTransform !== false;
  const mergePlanarFaces = opts.mergePlanarFaces !== false;
  const useTessellatedFaces = opts.useTessellatedFaces !== false;
  const exportFaces = opts.exportFaces !== false;
  const exportEdgesAsPolylines = opts.exportEdgesAsPolylines !== false;
  const baseName = _escapeStepString(opts.name || solids?.[0]?.name || 'part');

  const builder = new StepBuilder();

  // Application context + protocol.
  const appCtxId = builder.add("APPLICATION_CONTEXT('automotive_design')");
  const protocolName = useTessellatedFaces ? 'ap242' : 'automotive_design';
  builder.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','${protocolName}',2000,#${appCtxId})`);

  // Units + representation context.
  const lengthUnitId = _buildLengthUnit(builder, unit);
  const angleUnitId = builder.add('(PLANE_ANGLE_UNIT() NAMED_UNIT(*) SI_UNIT($,.RADIAN.))');
  const solidAngleUnitId = builder.add('(SOLID_ANGLE_UNIT() NAMED_UNIT(*) SI_UNIT($,.STERADIAN.))');
  const uncertaintyVal = Math.max(1e-9, Math.abs(scale) * 1e-6);
  const uncertaintyId = builder.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${_fmtExp(uncertaintyVal, 6)}),#${lengthUnitId},'distance_accuracy_value','')`,
  );
  const geomCtxId = builder.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertaintyId})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnitId},#${angleUnitId},#${solidAngleUnitId})) REPRESENTATION_CONTEXT('',''))`,
  );

  // Product definition structure.
  const prodCtxId = builder.add(`PRODUCT_CONTEXT('',#${appCtxId},'mechanical')`);
  const productId = builder.add(`PRODUCT('${baseName}','${baseName}','',(#${prodCtxId}))`);
  const formationId = builder.add(`PRODUCT_DEFINITION_FORMATION('','',#${productId})`);
  const prodDefCtxId = builder.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design')`);
  const prodDefId = builder.add(`PRODUCT_DEFINITION('design','',#${formationId},#${prodDefCtxId})`);
  const prodShapeId = builder.add(`PRODUCT_DEFINITION_SHAPE('','',#${prodDefId})`);

  const brepItems = [];
  const curveItems = [];
  const skipped = [];

    const directionCache = new Map();
    const getDirectionId = (vec) => {
    const n = _normalize(vec);
    const key = `${_fmtNumber(n[0], 9)},${_fmtNumber(n[1], 9)},${_fmtNumber(n[2], 9)}`;
    let id = directionCache.get(key);
    if (id) return id;
    id = builder.add(`DIRECTION('',(${_fmtNumber(n[0], precision)},${_fmtNumber(n[1], precision)},${_fmtNumber(n[2], precision)}))`);
    directionCache.set(key, id);
    return id;
    };

    for (let solidIdx = 0; solidIdx < (solids || []).length; solidIdx++) {
      const s = solids[solidIdx];
      if (!s || typeof s.getMesh !== 'function') continue;

      let mesh = null;
      try {
        mesh = s.getMesh();
      if (!mesh || !mesh.vertProperties || !mesh.triVerts) {
        skipped.push(String(s?.name || `solid_${solidIdx + 1}`));
        continue;
      }

      let worldMatrixElements = null;
      if (applyWorldTransform) {
        try {
          if (typeof s.updateWorldMatrix === 'function') {
            s.updateWorldMatrix(true, false);
          } else if (typeof s.updateMatrixWorld === 'function') {
            s.updateMatrixWorld(true);
          }
        } catch { /* best-effort */ }
        const wm = s?.matrixWorld;
        if (wm?.elements && wm.elements.length === 16 && !_isIdentityMatrixElements(wm.elements)) {
          worldMatrixElements = wm.elements;
        }
      }

      const vp = mesh.vertProperties;
      const tv = mesh.triVerts;
      const vertexCount = (vp.length / 3) | 0;
      const triCount = (tv.length / 3) | 0;

      const vertexPoints = new Array(vertexCount);
      const boundsMin = [Infinity, Infinity, Infinity];
      const boundsMax = [-Infinity, -Infinity, -Infinity];

      for (let i = 0; i < vertexCount; i++) {
        const x0 = vp[i * 3 + 0];
        const y0 = vp[i * 3 + 1];
        const z0 = vp[i * 3 + 2];
        const [wx, wy, wz] = worldMatrixElements ? _applyMatrix4(worldMatrixElements, x0, y0, z0) : [x0, y0, z0];
        const x = wx * scale;
        const y = wy * scale;
        const z = wz * scale;
        boundsMin[0] = Math.min(boundsMin[0], x);
        boundsMin[1] = Math.min(boundsMin[1], y);
        boundsMin[2] = Math.min(boundsMin[2], z);
        boundsMax[0] = Math.max(boundsMax[0], x);
        boundsMax[1] = Math.max(boundsMax[1], y);
        boundsMax[2] = Math.max(boundsMax[2], z);
        const pointId = builder.add(
          `CARTESIAN_POINT('',(${_fmtNumber(x, precision)},${_fmtNumber(y, precision)},${_fmtNumber(z, precision)}))`,
        );
        const vertexId = builder.add(`VERTEX_POINT('',#${pointId})`);
        vertexPoints[i] = { pointId, vertexId, pos: [x, y, z] };
      }

      const faceIds = [];
      const degenerateEps = 1e-16;
      const bboxDx = boundsMax[0] - boundsMin[0];
      const bboxDy = boundsMax[1] - boundsMin[1];
      const bboxDz = boundsMax[2] - boundsMin[2];
      const bboxDiag = Math.hypot(bboxDx, bboxDy, bboxDz) || 1;
      const normalTol = Number.isFinite(opts.planarNormalTolerance) ? opts.planarNormalTolerance : 1e-5;
      const distTol = Number.isFinite(opts.planarDistanceTolerance)
        ? opts.planarDistanceTolerance
        : Math.max(1e-6, bboxDiag * 1e-6);

      const triData = new Array(triCount);
      const faceIDs = (mesh.faceID && mesh.faceID.length === triCount) ? mesh.faceID : null;
      const idToFaceName = (s && s._idToFaceName instanceof Map) ? s._idToFaceName : null;
      const faceGroups = faceIDs ? new Map() : null;
      const planeGroups = faceIDs ? null : new Map();
      const faceNameAllocator = new NameAllocator();
      const edgeNameAllocator = new NameAllocator();
      const edgeCurveCache = new Map();
      const edgeNameByKey = new Map();

      for (let t = 0; t < triCount; t++) {
        const i0 = tv[t * 3 + 0] >>> 0;
        const i1 = tv[t * 3 + 1] >>> 0;
        const i2 = tv[t * 3 + 2] >>> 0;

        const v0 = vertexPoints[i0];
        const v1 = vertexPoints[i1];
        const v2 = vertexPoints[i2];
        if (!v0 || !v1 || !v2) continue;

        const p0 = v0.pos;
        const p1 = v1.pos;
        const p2 = v2.pos;

        const e1 = _sub(p1, p0);
        const e2 = _sub(p2, p0);
        const normalRaw = _cross(e1, e2);
        const normalLen = Math.hypot(normalRaw[0], normalRaw[1], normalRaw[2]);
        if (!normalLen || normalLen < degenerateEps) continue;
        const normal = [normalRaw[0] / normalLen, normalRaw[1] / normalLen, normalRaw[2] / normalLen];
        const d = _dot(normal, p0);

        const tri = { i0, i1, i2, normal, d, e1 };
        triData[t] = tri;

        if (faceIDs) {
          const key = faceIDs[t] >>> 0;
          const list = faceGroups.get(key) || [];
          list.push(t);
          faceGroups.set(key, list);
        } else {
          const key = mergePlanarFaces ? _planeKey(normal, d, normalTol, distTol) : `tri_${t}`;
          const list = planeGroups.get(key) || [];
          list.push(t);
          planeGroups.set(key, list);
        }
      }

      const buildEdgeNames = exportEdgesAsPolylines || exportFaces;

      if (faceGroups) {
        // Build edge name map from face adjacency
        if (mergePlanarFaces && buildEdgeNames) {
          const edgeInfo = new Map(); // key -> { faces:Set }
          for (let t = 0; t < triCount; t++) {
            const tri = triData[t];
            if (!tri) continue;
            const fid = faceIDs[t] >>> 0;
            const edges = [
              [tri.i0, tri.i1],
              [tri.i1, tri.i2],
              [tri.i2, tri.i0],
            ];
            for (const [a, b] of edges) {
              const key = _edgeKey(a, b);
              let entry = edgeInfo.get(key);
              if (!entry) {
                entry = { faces: new Set() };
                edgeInfo.set(key, entry);
              }
              entry.faces.add(fid);
            }
          }

          const baseToKeys = new Map();
          for (const [key, entry] of edgeInfo.entries()) {
            const faces = [...entry.faces];
            if (faces.length === 0) continue;
            let base = null;
            if (faces.length === 1) {
              const name = idToFaceName?.get(faces[0]) || `FACE_${faces[0]}`;
              base = `${name}|BOUNDARY`;
            } else {
              const nameA = idToFaceName?.get(faces[0]) || `FACE_${faces[0]}`;
              const nameB = idToFaceName?.get(faces[1]) || `FACE_${faces[1]}`;
              const pair = nameA < nameB ? [nameA, nameB] : [nameB, nameA];
              base = `${pair[0]}|${pair[1]}`;
            }
            const list = baseToKeys.get(base) || [];
            list.push(key);
            baseToKeys.set(base, list);
          }

          for (const [base, keys] of baseToKeys.entries()) {
            keys.sort();
            if (keys.length === 1) {
              edgeNameByKey.set(keys[0], _safeStepName(base));
              continue;
            }
            for (let i = 0; i < keys.length; i++) {
              edgeNameByKey.set(keys[i], _safeStepName(`${base}[${i}]`));
            }
          }
        }

        for (const [faceId, group] of faceGroups.entries()) {
          const baseFaceName = idToFaceName?.get(faceId) || `FACE_${faceId}`;
          const components = _splitComponents(group, triData);

          // If tessellated faces are enabled, treat non-planar face groups as tessellated.
          if (useTessellatedFaces && exportFaces) {
            const isPlanarGroup = _isCoplanarGroup(group, triData, normalTol, distTol);
            if (isPlanarGroup && mergePlanarFaces) {
              for (const comp of components) {
                const faceName = faceNameAllocator.allocate(baseFaceName);
                const edgeContext = (mergePlanarFaces && exportEdgesAsPolylines) ? { edgeNameByKey, edgeCurveCache, edgeNameAllocator } : null;
                const merged = _emitPlanarComponent(comp, triData, vertexPoints, builder, getDirectionId, precision, faceName, edgeContext);
                if (merged.ok && merged.faceId) {
                  faceIds.push(merged.faceId);
                  continue;
                }
                const tess = _emitTessellatedFace(comp, triData, vertexPoints, builder, precision, faceName);
                if (tess.ok && tess.faceId) {
                  faceIds.push(tess.faceId);
                  continue;
                }
                for (const triIdx of comp) {
                  const tri = triData[triIdx];
                  if (!tri) continue;
                  const triName = faceNameAllocator.allocate(baseFaceName);
                  const faceId = _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, triName);
                  if (faceId) faceIds.push(faceId);
                }
              }
              continue;
            }

            if (!isPlanarGroup) {
              for (const comp of components) {
                const faceName = faceNameAllocator.allocate(baseFaceName);
                const tess = _emitTessellatedFace(comp, triData, vertexPoints, builder, precision, faceName);
                if (tess.ok && tess.faceId) {
                  faceIds.push(tess.faceId);
                } else {
                  for (const triIdx of comp) {
                    const tri = triData[triIdx];
                    if (!tri) continue;
                    const triName = faceNameAllocator.allocate(baseFaceName);
                    const faceId = _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, triName);
                    if (faceId) faceIds.push(faceId);
                  }
                }
              }
              continue;
            }
          }

          // No tessellated faces: still merge planar regions within the face group.
          if (mergePlanarFaces && exportFaces) {
            const subPlanes = new Map();
            for (const triIdx of group) {
              const tri = triData[triIdx];
              if (!tri) continue;
              const key = _planeKey(tri.normal, tri.d, normalTol, distTol);
              const list = subPlanes.get(key) || [];
              list.push(triIdx);
              subPlanes.set(key, list);
            }
            for (const planeGroup of subPlanes.values()) {
              const planeComponents = _splitComponents(planeGroup, triData);
              for (const comp of planeComponents) {
                const faceName = faceNameAllocator.allocate(baseFaceName);
                const edgeContext = exportEdgesAsPolylines ? { edgeNameByKey, edgeCurveCache, edgeNameAllocator } : null;
                const merged = _emitPlanarComponent(comp, triData, vertexPoints, builder, getDirectionId, precision, faceName, edgeContext);
                if (merged.ok && merged.faceId) {
                  faceIds.push(merged.faceId);
                } else {
                  for (const triIdx of comp) {
                    const tri = triData[triIdx];
                    if (!tri) continue;
                    const triName = faceNameAllocator.allocate(baseFaceName);
                    const faceId = _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, triName);
                    if (faceId) faceIds.push(faceId);
                  }
                }
              }
            }
          } else if (exportFaces) {
            for (const triIdx of group) {
              const tri = triData[triIdx];
              if (!tri) continue;
              const faceName = faceNameAllocator.allocate(baseFaceName);
              const faceId = _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, faceName);
              if (faceId) faceIds.push(faceId);
            }
          }
        }
      } else if (planeGroups) {
        let planeIndex = 0;
        for (const group of planeGroups.values()) {
          const components = mergePlanarFaces ? _splitComponents(group, triData) : [group];
          const baseFaceName = `FACE_${++planeIndex}`;
          for (const comp of components) {
            if (mergePlanarFaces && exportFaces) {
              const faceName = faceNameAllocator.allocate(baseFaceName);
              const edgeContext = (mergePlanarFaces && exportEdgesAsPolylines) ? { edgeNameByKey, edgeCurveCache, edgeNameAllocator } : null;
              const merged = _emitPlanarComponent(comp, triData, vertexPoints, builder, getDirectionId, precision, faceName, edgeContext);
              if (merged.ok && merged.faceId) {
                faceIds.push(merged.faceId);
                continue;
              }
            }
            if (exportFaces) {
              for (const triIdx of comp) {
                const tri = triData[triIdx];
                if (!tri) continue;
                const faceName = faceNameAllocator.allocate(baseFaceName);
                const faceId = _emitTriangleFace(tri, vertexPoints, builder, getDirectionId, precision, faceName);
                if (faceId) faceIds.push(faceId);
              }
            }
          }
        }
      }

      if (exportFaces) {
        if (faceIds.length === 0) {
          skipped.push(String(s?.name || `solid_${solidIdx + 1}`));
          continue;
        }

        const shellId = builder.add(`CLOSED_SHELL('',${_formatEntityList(faceIds)})`);
        const brepId = builder.add(`FACETED_BREP('',#${shellId})`);
        brepItems.push(brepId);
      }

      if (exportEdgesAsPolylines) {
        const boundaryPolys = _buildBoundaryEdgePolylines(mesh, idToFaceName);
        for (const poly of boundaryPolys) {
          const indices = Array.isArray(poly.indices) ? poly.indices : [];
          if (indices.length < 2) continue;
          const pointRefs = [];
          let hasMissing = false;
          for (const idx of indices) {
            const pointId = vertexPoints[idx]?.pointId;
            if (!pointId) { hasMissing = true; break; }
            pointRefs.push(`#${pointId}`);
          }
          if (hasMissing || pointRefs.length < 2) continue;
          const baseName = poly.name || `${poly.faceA}|${poly.faceB}`;
          const name = edgeNameAllocator.allocate(baseName);
          const polyId = builder.add(`POLYLINE('${_safeStepName(name)}',(${pointRefs.join(',')}))`);
          curveItems.push(polyId);
        }
      }
    } catch (err) {
      skipped.push(String(s?.name || `solid_${solidIdx + 1}`));
    } finally {
      try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { /* ignore */ }
    }
  }

  const repItems = [];
  if (exportFaces && brepItems.length) repItems.push(...brepItems);
  if (exportEdgesAsPolylines && curveItems.length) {
    const curveSetId = builder.add(`GEOMETRIC_CURVE_SET('EDGES',${_formatEntityList(curveItems)})`);
    repItems.push(curveSetId);
  }
  if (repItems.length === 0) {
    return { data: '', exported: 0, skipped: solids?.map((s) => s?.name || 'solid') || [] };
  }
  const shapeRepName = useTessellatedFaces ? 'tessellated' : '';
  const repEntity = exportEdgesAsPolylines ? 'SHAPE_REPRESENTATION' : 'ADVANCED_BREP_SHAPE_REPRESENTATION';
  const shapeRepId = builder.add(
    `${repEntity}('${shapeRepName}',${_formatEntityList(repItems)},#${geomCtxId})`,
  );
  builder.add(`SHAPE_DEFINITION_REPRESENTATION(#${prodShapeId},#${shapeRepId})`);

  const now = new Date();
  const isoNoMs = now.toISOString().replace(/\.\d+Z$/, '');

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('BREP STEP export'),'2;1');",
    `FILE_NAME('${baseName}','${_escapeStepString(isoNoMs)}',('BREP'),('BREP'),'Codex','BREP','');`,
    `FILE_SCHEMA(('${useTessellatedFaces ? 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING' : 'AUTOMOTIVE_DESIGN'}'));`,
    'ENDSEC;',
    'DATA;',
  ];

  const footer = [
    'ENDSEC;',
    'END-ISO-10303-21;',
  ];

  const data = `${header.join('\n')}\n${builder.lines.join('\n')}\n${footer.join('\n')}\n`;
  return { data, exported: repItems.length, skipped };
}

import { BREP } from "../../BREP/BREP.js";
import { LineGeometry } from "three/examples/jsm/Addons.js";
import { resolveSelectionObject } from "../selectionUtils.js";

const THREE = BREP.THREE;

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Optional identifier used for naming the offset faces",
  },
  faces: {
    type: "reference_selection",
    selectionFilter: ["FACE"],
    multiple: true,
    default_value: [],
    hint: "Select one or more faces to offset",
  },
  distance: {
    type: "number",
    default_value: 1,
    hint: "Offset distance along the face normal (positive or negative)",
  },
};

const sanitizeLabel = (value) => {
  const raw = value == null ? "" : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[:\[\]]+/g, "_").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.-]/g, "_");
};

const uniqueName = (base, used) => {
  let name = base;
  let idx = 1;
  while (used.has(name)) {
    idx += 1;
    name = `${base}_${idx}`;
  }
  used.add(name);
  return name;
};

const getFaceNormalWorld = (faceObj) => {
  let n = null;
  if (faceObj && typeof faceObj.getAverageNormal === "function") {
    try { n = faceObj.getAverageNormal().clone(); } catch { n = null; }
  }
  if (!n || n.lengthSq() < 1e-12) {
    try {
      const q = new THREE.Quaternion();
      faceObj.getWorldQuaternion(q);
      n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    } catch { n = new THREE.Vector3(0, 0, 1); }
  }
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  n.normalize();
  return n;
};

const getGeometryCenter = (geom) => {
  if (!geom) return new THREE.Vector3();
  try {
    geom.computeBoundingBox();
    if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
      return geom.boundingBox.getCenter(new THREE.Vector3());
    }
  } catch { }
  const pos = geom.getAttribute("position");
  if (!pos || pos.itemSize !== 3 || pos.count === 0) return new THREE.Vector3();
  const acc = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    acc.x += pos.getX(i);
    acc.y += pos.getY(i);
    acc.z += pos.getZ(i);
  }
  return acc.multiplyScalar(1 / pos.count);
};

const buildSketchBasis = (origin, normal) => {
  const z = normal.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const refUp = Math.abs(z.dot(worldUp)) > 0.9 ? new THREE.Vector3(1, 0, 0) : worldUp;
  const x = new THREE.Vector3().crossVectors(refUp, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return {
    origin: [origin.x, origin.y, origin.z],
    x: [x.x, x.y, x.z],
    y: [y.x, y.y, y.z],
    z: [z.x, z.y, z.z],
  };
};

const computeBoundaryLoopsFromFace = (faceObj) => {
  const loops = [];
  const geom = faceObj?.geometry;
  if (!geom) return loops;
  const pos = geom.getAttribute("position");
  if (!pos || pos.itemSize !== 3) return loops;
  const idx = geom.getIndex();

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
    const k = keyOf(world[i]);
    let ci = canonMap.get(k);
    if (ci === undefined) {
      ci = canonPts.length;
      canonMap.set(k, ci);
      canonPts.push(world[i]);
    }
    origToCanon[i] = ci;
  }

  const edgeCount = new Map();
  const inc = (a, b) => {
    const A = origToCanon[a] >>> 0;
    const B = origToCanon[b] >>> 0;
    const i = Math.min(A, B), j = Math.max(A, B);
    const k = `${i},${j}`;
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  };
  if (idx) {
    for (let t = 0; t < idx.count; t += 3) {
      inc(idx.getX(t + 0) >>> 0, idx.getX(t + 1) >>> 0);
      inc(idx.getX(t + 1) >>> 0, idx.getX(t + 2) >>> 0);
      inc(idx.getX(t + 2) >>> 0, idx.getX(t + 0) >>> 0);
    }
  } else {
    const triCount = (pos.count / 3) | 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = 3 * t + 0;
      const i1 = 3 * t + 1;
      const i2 = 3 * t + 2;
      inc(i0, i1);
      inc(i1, i2);
      inc(i2, i0);
    }
  }

  const adj = new Map();
  const addAdj = (a, b) => {
    let s = adj.get(a);
    if (!s) { s = new Set(); adj.set(a, s); }
    s.add(b);
  };
  for (const [k, c] of edgeCount.entries()) {
    if (c !== 1) continue;
    const parts = k.split(",");
    const i = Number(parts[0]);
    const j = Number(parts[1]);
    addAdj(i, j);
    addAdj(j, i);
  }

  const visited = new Set();
  const edgeKey = (a, b) => {
    const i = Math.min(a, b), j = Math.max(a, b);
    return `${i},${j}`;
  };
  for (const [a, neighbors] of adj.entries()) {
    for (const b of neighbors) {
      const k = edgeKey(a, b);
      if (visited.has(k)) continue;
      const ring = [a, b];
      visited.add(k);
      let prev = a, cur = b, guard = 0;
      while (guard++ < 100000) {
        const nset = adj.get(cur) || new Set();
        let next = null;
        for (const n of nset) {
          if (n === prev) continue;
          const kk = edgeKey(cur, n);
          if (!visited.has(kk)) { next = n; break; }
        }
        if (next == null) break;
        visited.add(edgeKey(cur, next));
        ring.push(next);
        prev = cur;
        cur = next;
        if (cur === ring[0]) break;
      }
      if (ring.length >= 3) {
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
  }

  if (loops.length) {
    let n = null;
    try { n = faceObj.getAverageNormal().clone(); } catch { n = null; }
    if (!n || n.lengthSq() < 1e-12) n = new THREE.Vector3(0, 0, 1);
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
        a += (p.x * q.y - q.x * p.y);
      }
      return 0.5 * a;
    };
    const loopAreas = loops.map((loop) => {
      const v2 = loop.pts.map((P) => {
        const vec = new THREE.Vector3(P[0], P[1], P[2]);
        return new THREE.Vector2(vec.dot(U), vec.dot(V));
      });
      return area2(v2);
    });
    let outerIdx = 0, outerAbs = 0;
    for (let i = 0; i < loopAreas.length; i++) {
      const ab = Math.abs(loopAreas[i]);
      if (ab > outerAbs) { outerAbs = ab; outerIdx = i; }
    }
    const outerSign = Math.sign(loopAreas[outerIdx] || 1);
    for (let i = 0; i < loops.length; i++) {
      const sign = Math.sign(loopAreas[i] || 0);
      loops[i].isHole = (sign !== outerSign);
    }
  }

  return loops;
};

const buildEdgesFromLoops = (loops, groupName) => {
  const edges = [];
  let edgeIdx = 0;
  for (const loop of loops) {
    const pts = Array.isArray(loop?.pts) ? loop.pts : loop;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const poly = pts.map((p) => [p[0], p[1], p[2]]);
    const positions = [];
    for (const p of poly) positions.push(p[0], p[1], p[2]);
    if (poly.length >= 2) {
      const first = poly[0];
      const last = poly[poly.length - 1];
      if (!(first[0] === last[0] && first[1] === last[1] && first[2] === last[2])) {
        positions.push(first[0], first[1], first[2]);
      }
    }
    const lg = new LineGeometry();
    lg.setPositions(positions);
    try { lg.computeBoundingSphere(); } catch { }
    const edge = new BREP.Edge(lg);
    edge.name = `${groupName}:L${edgeIdx++}`;
    edge.closedLoop = true;
    edge.userData = {
      polylineLocal: poly,
      polylineWorld: true,
      isHole: !!loop?.isHole,
    };
    edges.push(edge);
  }
  return edges;
};

export class OffsetFaceFeature {
  static shortName = "O.F";
  static longName = "Offset Face";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const faceEntries = Array.isArray(this.inputParams.faces) ? this.inputParams.faces.filter(Boolean) : [];
    if (!faceEntries.length) {
      console.warn("[OffsetFaceFeature] No faces selected.");
      return { added: [], removed: [] };
    }

    const dist = Number(this.inputParams.distance);
    if (!Number.isFinite(dist)) {
      console.warn("[OffsetFaceFeature] Distance must be a finite number.");
      return { added: [], removed: [] };
    }

    const featureIdRaw = this.inputParams.featureID || OffsetFaceFeature.shortName || "OffsetFace";
    const featureId = String(featureIdRaw).trim() || "OffsetFace";
    const added = [];
    const usedNames = new Set();

    let idx = 0;
    for (const entry of faceEntries) {
      const faceObj = resolveSelectionObject(entry, partHistory);
      if (!faceObj || faceObj.type !== "FACE" || !faceObj.geometry) continue;
      try { faceObj.updateMatrixWorld(true); } catch { }

      const normal = getFaceNormalWorld(faceObj);
      const offsetVec = normal.clone().multiplyScalar(dist);

      const geom = faceObj.geometry.clone();
      geom.applyMatrix4(faceObj.matrixWorld);
      if (offsetVec.lengthSq() > 0) {
        geom.applyMatrix4(new THREE.Matrix4().makeTranslation(offsetVec.x, offsetVec.y, offsetVec.z));
      }
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const sourceFaceName = String(faceObj.userData?.faceName || faceObj.name || `FACE_${idx + 1}`);
      const safeLabel = sanitizeLabel(sourceFaceName) || `FACE_${idx + 1}`;
      const baseName = `${featureId}:${safeLabel}`;
      const groupName = uniqueName(baseName, usedNames);

      const group = new THREE.Group();
      group.type = "SKETCH";
      group.name = groupName;
      group.renderOrder = 1;
      group.userData = group.userData || {};

      const offsetFace = new BREP.Face(geom);
      offsetFace.name = `${groupName}:PROFILE`;
      offsetFace.userData.faceName = offsetFace.name;
      offsetFace.userData.sourceFaceName = sourceFaceName;
      offsetFace.userData.offsetDistance = dist;

      group.userData.sourceFaceName = sourceFaceName;
      group.userData.offsetDistance = dist;
      group.userData.sketchBasis = buildSketchBasis(getGeometryCenter(geom), normal);

      try { offsetFace.updateMatrixWorld(true); } catch { }
      const loops = computeBoundaryLoopsFromFace(offsetFace);
      if (loops.length) offsetFace.userData.boundaryLoopsWorld = loops;

      const edges = buildEdgesFromLoops(loops, groupName);
      for (const edge of edges) {
        edge.faces.push(offsetFace);
        group.add(edge);
      }
      offsetFace.edges = edges;
      group.add(offsetFace);

      added.push(group);
      idx += 1;
    }

    if (!added.length) {
      console.warn("[OffsetFaceFeature] No valid faces resolved.");
      return { added: [], removed: [] };
    }

    return { added, removed: [] };
  }
}

import { BREP } from "../../BREP/BREP.js";
import { selectionHasSketch } from "../selectionUtils.js";

function readFacePickMeta(faceObj) {
  const meta = faceObj?.userData?.__lastReferencePickMeta;
  if (!meta || typeof meta !== 'object') return null;
  const faceIndexRaw = Number(meta.faceIndex);
  const faceIndex = (Number.isFinite(faceIndexRaw) && faceIndexRaw >= 0)
    ? Math.floor(faceIndexRaw)
    : null;
  let pickPoint = null;
  if (Array.isArray(meta.pickPoint) && meta.pickPoint.length >= 3) {
    const x = Number(meta.pickPoint[0]);
    const y = Number(meta.pickPoint[1]);
    const z = Number(meta.pickPoint[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      pickPoint = [x, y, z];
    }
  }
  if (faceIndex === null && !pickPoint) return null;
  return { faceIndex, pickPoint };
}

function isolatePickedFaceIsland(faceObj) {
  if (!faceObj || faceObj.type !== 'FACE' || !faceObj.geometry) return faceObj;
  const pickMeta = readFacePickMeta(faceObj);
  if (!pickMeta) return faceObj;

  const geom = faceObj.geometry;
  const posAttr = geom.getAttribute?.('position');
  if (!posAttr || posAttr.count < 3) return faceObj;
  const idxAttr = geom.getIndex?.();
  const triCount = idxAttr ? ((idxAttr.count / 3) | 0) : ((posAttr.count / 3) | 0);
  if (triCount <= 1) return faceObj;

  const THREE = BREP.THREE;
  const mat = faceObj.matrixWorld || null;
  const v = new THREE.Vector3();
  const world = new Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    if (mat && typeof v.applyMatrix4 === 'function') v.applyMatrix4(mat);
    world[i] = [v.x, v.y, v.z];
  }

  const keyOf = (p) => `${Number(p[0]).toFixed(7)},${Number(p[1]).toFixed(7)},${Number(p[2]).toFixed(7)}`;
  const canonMap = new Map();
  const origToCanon = new Int32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const k = keyOf(world[i]);
    let ci = canonMap.get(k);
    if (ci === undefined) { ci = canonMap.size; canonMap.set(k, ci); }
    origToCanon[i] = ci;
  }

  const triVerts = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    if (idxAttr) {
      triVerts[t] = [
        idxAttr.getX(t * 3 + 0) >>> 0,
        idxAttr.getX(t * 3 + 1) >>> 0,
        idxAttr.getX(t * 3 + 2) >>> 0,
      ];
    } else {
      triVerts[t] = [t * 3 + 0, t * 3 + 1, t * 3 + 2];
    }
  }

  const canonCount = Math.max(1, canonMap.size);
  const stride = canonCount + 1;
  const edgeKey = (a, b) => {
    const A = a | 0;
    const B = b | 0;
    return A < B ? (A * stride + B) : (B * stride + A);
  };

  const edgeToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    const tri = triVerts[t];
    const a = origToCanon[tri[0]] | 0;
    const b = origToCanon[tri[1]] | 0;
    const c = origToCanon[tri[2]] | 0;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, w);
      let arr = edgeToTris.get(k);
      if (!arr) { arr = []; edgeToTris.set(k, arr); }
      arr.push(t);
    }
  }

  const adj = new Array(triCount);
  for (let t = 0; t < triCount; t++) adj[t] = [];
  for (const list of edgeToTris.values()) {
    if (!list || list.length < 2) continue;
    const root = list[0] | 0;
    for (let i = 1; i < list.length; i++) {
      const n = list[i] | 0;
      if (n === root) continue;
      adj[root].push(n);
      adj[n].push(root);
    }
  }

  const compId = new Int32Array(triCount).fill(-1);
  let compCount = 0;
  const stack = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (compId[seed] !== -1) continue;
    compId[seed] = compCount;
    stack.length = 0;
    stack.push(seed);
    while (stack.length) {
      const t = stack.pop() | 0;
      for (const n of adj[t]) {
        if (compId[n] !== -1) continue;
        compId[n] = compCount;
        stack.push(n);
      }
    }
    compCount++;
  }
  if (compCount <= 1) return faceObj;

  let chosenComp = 0;
  if (Number.isFinite(pickMeta.faceIndex) && pickMeta.faceIndex >= 0 && pickMeta.faceIndex < triCount) {
    chosenComp = compId[pickMeta.faceIndex] | 0;
  } else if (Array.isArray(pickMeta.pickPoint) && pickMeta.pickPoint.length >= 3) {
    const px = pickMeta.pickPoint[0], py = pickMeta.pickPoint[1], pz = pickMeta.pickPoint[2];
    const bestByComp = new Array(compCount).fill(Infinity);
    for (let t = 0; t < triCount; t++) {
      const tri = triVerts[t];
      const p0 = world[tri[0]];
      const p1 = world[tri[1]];
      const p2 = world[tri[2]];
      const cx = (p0[0] + p1[0] + p2[0]) / 3;
      const cy = (p0[1] + p1[1] + p2[1]) / 3;
      const cz = (p0[2] + p1[2] + p2[2]) / 3;
      const dx = cx - px;
      const dy = cy - py;
      const dz = cz - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const c = compId[t] | 0;
      if (d2 < bestByComp[c]) bestByComp[c] = d2;
    }
    let best = Infinity;
    for (let c = 0; c < compCount; c++) {
      if (bestByComp[c] < best) {
        best = bestByComp[c];
        chosenComp = c;
      }
    }
  }
  if (!(chosenComp >= 0 && chosenComp < compCount)) return faceObj;

  const triPositions = [];
  for (let t = 0; t < triCount; t++) {
    if ((compId[t] | 0) !== chosenComp) continue;
    const tri = triVerts[t];
    const a = world[tri[0]];
    const b = world[tri[1]];
    const c = world[tri[2]];
    triPositions.push(
      a[0], a[1], a[2],
      b[0], b[1], b[2],
      c[0], c[1], c[2],
    );
  }
  if (triPositions.length < 9) return faceObj;

  const islandGeom = new THREE.BufferGeometry();
  islandGeom.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
  islandGeom.computeVertexNormals();
  islandGeom.computeBoundingBox();
  islandGeom.computeBoundingSphere();

  const islandFace = new BREP.Face(islandGeom);
  islandFace.name = faceObj.name;
  islandFace.userData = {
    ...(faceObj.userData || {}),
    __isIsolatedProfileIsland: true,
  };
  islandFace.edges = [];
  return islandFace;
}

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the extrude feature",
  },
  profile: {
    type: "reference_selection",
    selectionFilter: ["FACE", "SKETCH"],
    multiple: false,
    default_value: null,
    hint: "Select the profile to extrude",
  },
  consumeProfileSketch: {
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced sketch after creating the extrusion. Turn off to keep it in the scene.",
  },
  distance: {
    type: "number",
    default_value: 10,
    hint: "Extrude distance when no path is provided",
  },
  distanceBack: {
    type: "number",
    default_value: 10,
    hint: "Optional backward extrude distance (two-sided extrude)",
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: 'NONE' },
    hint: "Optional boolean operation with selected solids"
  }
};

export class ExtrudeFeature {
  static shortName = "E";
  static longName = "Extrude";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const pick = items.find((it) => {
      const type = String(it?.type || '').toUpperCase();
      return type === 'FACE' || type === 'SKETCH';
    });
    if (!pick) return false;
    const name = pick?.name || pick?.userData?.faceName || pick?.userData?.edgeName || null;
    if (!name) return false;
    return { field: 'profile', value: name };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest(context) {
    const params = this.inputParams || context?.params || {};
    const partHistory = context?.history || null;
    return selectionHasSketch(params.profile, partHistory) ? [] : ["consumeProfileSketch"];
  }

  async run(partHistory) {
    // actual code to create the extrude feature.
    const { profile, distance, distanceBack } = this.inputParams;

    // Resolve profile object: accept FACE object or a SKETCH group object
    const obj = Array.isArray(profile) ? (profile[0] || null) : (profile || null);
    let faceObj = obj;
    if (obj && obj.type === 'SKETCH') {
      // Find child FACE named PROFILE (or any FACE child)
      faceObj = obj.children.find(ch => ch.type === 'FACE') || obj.children.find(ch => ch.userData?.faceName);
    }

    const removed = [];
    const consumeSketch = this.inputParams?.consumeProfileSketch !== false;
    // if the face is a child of a sketch we need to remove the sketch from the scene
    if (consumeSketch && faceObj && faceObj.type === 'FACE' && faceObj.parent && faceObj.parent.type === 'SKETCH') {
      removed.push(faceObj.parent);
    }

    try {
      faceObj = isolatePickedFaceIsland(faceObj);
    } catch (_) { /* best effort: fallback to full face */ }



    // Create the extrude using the robust Sweep implementation (handles holes and per-edge side faces)
    // If user requests a UNION with the same solid the profile came from,
    // bias both directions slightly so the sweep fully overlaps the parent
    // instead of leaving a coplanar cap on the source face.
    const op = String(this.inputParams?.boolean?.operation || 'NONE').toUpperCase();
    const targets = Array.isArray(this.inputParams?.boolean?.targets) ? this.inputParams.boolean.targets : [];
    const parentSolid = faceObj && faceObj.parent && typeof faceObj.parent.getFaceNames === 'function' ? faceObj.parent : null;
    const unionTargetsIncludeParent = op === 'UNION' && parentSolid && targets && targets.some(t => t === parentSolid || (typeof t === 'string' && t === parentSolid.name));
    const forwardBias = (op === 'SUBTRACT' ? 0.00001 : 0) + (op === 'UNION' ? 0.00001 : 0);
    const backwardBias = unionTargetsIncludeParent ? 0.00001 : 0;

    const extrude = new BREP.Sweep({
      face: faceObj,
      distance: distance + forwardBias, // small forward nudge helps avoid z-fighting for boolean ops
      distanceBack: distanceBack + backwardBias,
      mode: 'translate',
      name: this.inputParams.featureID,
      omitBaseCap: false,
    });
    // Attach centerlines for any circular/arc sketch edges in the profile
    try {
      const THREE = BREP.THREE;
      const edges = Array.isArray(faceObj?.edges) ? faceObj.edges : (faceObj?.edges ? Array.from(faceObj.edges) : []);
      const centers = [];
      const addCenter = (arr) => {
        if (!Array.isArray(arr) || arr.length !== 3) return;
        centers.push(new THREE.Vector3(arr[0], arr[1], arr[2]));
      };
      for (const e of edges) {
        const kind = e?.userData?.sketchGeomType;
        if (kind === 'arc' && Array.isArray(e?.userData?.arcCenter)) addCenter(e.userData.arcCenter);
        else if (kind === 'circle' && Array.isArray(e?.userData?.circleCenter)) addCenter(e.userData.circleCenter);
      }
      // Deduplicate centers by hashing rounded coords
      const uniq = new Map();
      const round = (v)=> Math.round(v*1e6)/1e6;
      const uniqueCenters = [];
      for (const c of centers) { const k = `${round(c.x)},${round(c.y)},${round(c.z)}`; if (!uniq.has(k)) { uniq.set(k, true); uniqueCenters.push(c); } }

      if (uniqueCenters.length) {
        // Compute face normal for direction
        const n = (typeof faceObj.getAverageNormal === 'function') ? faceObj.getAverageNormal().clone() : new THREE.Vector3(0,1,0);
        if (n.lengthSq() < 1e-20) n.set(0,1,0); n.normalize();
        const fwd = n.clone().multiplyScalar(Number(distance) || 0);
        const back = n.clone().multiplyScalar(-(Number(distanceBack) || 0));
        let idx = 0;
        for (const c of uniqueCenters) {
          const a = new THREE.Vector3(c.x, c.y, c.z).add(back);
          const b = new THREE.Vector3(c.x, c.y, c.z).add(fwd);
          if (a.distanceToSquared(b) < 1e-16) continue;
          const name = (this.inputParams.featureID ? `${this.inputParams.featureID}_AXIS_${idx++}` : 'AXIS');
          extrude.addCenterline([a.x, a.y, a.z], [b.x, b.y, b.z], name, { materialKey: 'OVERLAY' });
        }
      }
    } catch (_) { /* best-effort centerlines */ }
    extrude.visualize();

    // Apply optional boolean operation via shared helper
    const effects = await BREP.applyBooleanOperation(partHistory || {}, extrude, this.inputParams.boolean, this.inputParams.featureID);
    const booleanRemoved = Array.isArray(effects.removed) ? effects.removed : [];
    const removedArtifacts = [...removed, ...booleanRemoved];
    // Flag removals (sketch parent + boolean effects) for PartHistory to collect
    try { for (const obj of removedArtifacts) { if (obj) obj.__removeFlag = true; } } catch {}
    const added = Array.isArray(effects.added) ? effects.added : [];
    return { added, removed: removedArtifacts };
  }
}

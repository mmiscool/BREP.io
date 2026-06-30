import { BREP } from "../../BREP/BREP.js";
import { Manifold } from "../../BREP/SolidShared.js";
const THREE = BREP.THREE;

type AnyRecord = Record<string, any>;

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the pattern feature",
  },
  solids: {
    type: "reference_selection",
    selectionFilter: ["SOLID"],
    multiple: true,
    default_value: [],
    hint: "Select solids to pattern",
  },
  mode: {
    type: "options",
    options: ["LINEAR", "CIRCULAR"],
    default_value: "LINEAR",
    hint: "Pattern type",
  },
  // Linear params
  linearInputMode: {
    type: "options",
    options: ["transform", "vector distance"],
    default_value: "vector distance",
    label: "Linear Input",
    hint: "Use transform controls or a selected direction plus distance",
  },
  count: {
    type: "number",
    default_value: 3,
    step: 1,
    hint: "Instance count (>= 1)",
  },
  countMode: {
    type: "options",
    options: ["count and pitch", "count and span"],
    default_value: "count and pitch",
    label: "Count Mode",
    hint: "Use the distance/angle as the current pitch value or divide it across the full span",
  },
  offset: {
    type: "transform",
    default_value: { position: [10, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
    label: "Offset (use gizmo)",
    hint: "Use Move gizmo to set direction and distance (position only)",
  },
  directionRef: {
    type: "reference_selection",
    selectionFilter: ["EDGE", "FACE", "PLANE"],
    multiple: false,
    default_value: null,
    label: "Direction",
    hint: "Select an EDGE direction or FACE/PLANE normal for linear spacing",
  },
  linearDistance: {
    type: "number",
    default_value: 10,
    label: "Distance",
    hint: "Distance between linear pattern instances along the selected direction",
  },
  // Circular params
  axisRef: {
    type: "reference_selection",
    selectionFilter: ["EDGE"],
    multiple: false,
    default_value: null,
    label: "Axis",
    hint: "Select an EDGE to define the circular pattern axis",
  },
  centerOffset: {
    type: "number",
    default_value: 0,
    hint: "Offset along axis from reference origin to pattern center",
  },
  totalAngleDeg: {
    type: "number",
    default_value: 360,
    hint: "Total sweep angle for CIRCULAR",
  },
  booleanMode: {
    type: "options",
    options: ["NONE", "UNION"],
    default_value: "NONE",
    hint: "Optionally union instances together",
  },
};

export class PatternFeature {
  static shortName = "PATTERN";
  static longName = "Pattern";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems: any) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const solids = items
      .filter((it) => String(it?.type || '').toUpperCase() === 'SOLID')
      .map((it) => it?.name)
      .filter((name) => !!name);
    if (!solids.length) return false;
    const edge = items.find((it) => String(it?.type || '').toUpperCase() === 'EDGE');
    const edgeName = edge?.name || edge?.userData?.edgeName || null;
    const params: AnyRecord = { solids };
    if (edgeName) {
      params.mode = 'CIRCULAR';
      params.axisRef = edgeName;
    }
    return { params };
  }

  inputParams: AnyRecord;
  persistentData: AnyRecord;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest(context: AnyRecord = {}) {
    const params = this.inputParams && Object.keys(this.inputParams).length > 0
      ? this.inputParams
      : context?.params || {};
    const mode = String(params?.mode || "LINEAR").toUpperCase();
    if (mode === "CIRCULAR") {
      return ["linearInputMode", "offset", "directionRef", "linearDistance"];
    }
    const linearInputMode = normalizeOptionKey(params?.linearInputMode || "vector distance");
    const hidden = ["axisRef", "centerOffset", "totalAngleDeg"];
    if (linearInputMode === "VECTOR_DISTANCE") hidden.push("offset");
    else hidden.push("directionRef", "linearDistance");
    return hidden;
  }

  async run(partHistory: any) {
    // Tolerant: accept SOLID directly, or objects with parentSolid
    const raw = Array.isArray(this.inputParams.solids) ? this.inputParams.solids.filter(Boolean) : [];
    const solids = [];
    for (const o of raw) {
      if (!o) continue;
      if (o.type === 'SOLID') solids.push(o);
      else if (o.parentSolid && o.parentSolid.type === 'SOLID') solids.push(o.parentSolid);
      else if (o.parent && o.parent.type === 'SOLID') solids.push(o.parent);
    }
    if (solids.length === 0) {
      console.warn('[PatternFeature] No solids resolved from selection.');
    }
    if (!solids.length) return { added: [], removed: [] };

    const mode = String(this.inputParams.mode || 'LINEAR').toUpperCase();
    const count = Math.max(1, (this.inputParams.count | 0));
    const booleanMode = (this.inputParams.booleanMode || 'NONE').toUpperCase();

    // Fallbacks: if no solids resolved, try currently selected solids; else last SOLID in scene
    let sources = solids;
    if (!sources.length && partHistory && partHistory.scene) {
      try {
        const selected = [];
        partHistory.scene.traverse((o) => { if (o && o.type === 'SOLID' && o.selected) selected.push(o); });
        if (selected.length) sources = selected;
      } catch (_) { /* ignore */ }
      if (!sources.length) {
        try {
          const solidsInScene = partHistory.scene.children.filter(ch => ch && ch.type === 'SOLID');
          if (solidsInScene.length) sources = [solidsInScene[solidsInScene.length - 1]]; // most recent
        } catch (_) { /* ignore */ }
      }
      if (!sources.length) console.warn('[PatternFeature] No sources available (selection and scene empty).');
    }

    // BOOLEAN UNION: fuse each source with its generated clones and replace original
    if (booleanMode === 'UNION') {
      const out = [];
      for (const src of sources) {
        const clones = (mode === 'LINEAR')
          ? this.#linearPattern(src, count, resolveLinearDelta(this.inputParams, count), /*doVisualize*/ false)
          : this.#circularPattern(src, count, this.inputParams.axisRef, Number(this.inputParams.totalAngleDeg) || 360, Number(this.inputParams.centerOffset) || 0, this.inputParams.countMode, /*doVisualize*/ false);

        const unionName = `${src.name || 'Pattern'}::UNION`;
        const acc = BREP.Solid.unionMany([src, ...clones], { name: unionName }) || src;
        try { acc.name = unionName; } catch { /* ignore rename failures */ }
        acc.visualize();
        try { src.__removeFlag = true; } catch { /* ignore remove flag failures */ }
        out.push(acc);
      }
      const removedSources = sources.filter(Boolean);
      return { added: out, removed: removedSources };
    }

    // NON-BOOLEAN: return clones as separate bodies
    const instances = [];
    for (const src of sources) {
      const clones = (mode === 'LINEAR')
        ? this.#linearPattern(src, count, resolveLinearDelta(this.inputParams, count))
        : this.#circularPattern(src, count, this.inputParams.axisRef, Number(this.inputParams.totalAngleDeg) || 360, Number(this.inputParams.centerOffset) || 0, this.inputParams.countMode);
      for (const c of clones) instances.push(c);
    }
    return { added: instances, removed: [] };
  }

  #linearPattern(src, count, deltaPos, doVisualize = true) {
    const d = toVec3(deltaPos, 10, 0, 0);
    const out = [];
    for (let i = 1; i <= count - 1; i++) {
      const t = new THREE.Matrix4().makeTranslation(d.x * i, d.y * i, d.z * i);
      const c = src.clone();
      c.bakeTransform(t);
      const fallbackId = PatternFeature.shortName || PatternFeature.longName || 'Pattern';
      const featureID = this.inputParams.featureID || fallbackId;
      const idx = i + 1;
      try { retagSolidFaces(c, `${featureID}_${idx}`); } catch (_) { /* best-effort */ }
      c.name = `${featureID}_${idx}`;
      if (doVisualize) c.visualize();
      out.push(c);
    }
    return out;
  }

  #circularPattern(src, count, axisRef, totalAngleDeg, centerOffset, countMode, doVisualize = true) {
    // Determine axis and center from reference
    const ref = Array.isArray(axisRef) ? axisRef[0] : axisRef;
    const axisInfo = computeAxisFromEdge(ref);
    const axis = axisInfo?.dir || new THREE.Vector3(0, 1, 0);
    const center = (axisInfo?.point || new THREE.Vector3()).clone().addScaledVector(axis, centerOffset || 0);

    const out = [];
    const divisor = normalizeOptionKey(countMode || "count and pitch") === "COUNT_AND_SPAN"
      ? Math.max(1, count - 1)
      : 1;
    const step = (count <= 1) ? 0 : THREE.MathUtils.degToRad(totalAngleDeg) / divisor;
    for (let i = 1; i <= count - 1; i++) {
      const theta = step * i;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, theta);
      const RS = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const T1 = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
      const T0 = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
      const M = new THREE.Matrix4().multiply(T1).multiply(RS).multiply(T0);

      const c = src.clone();
      c.bakeTransform(M);
      const fallbackId = PatternFeature.shortName || PatternFeature.longName || 'Pattern';
      const featureID = this.inputParams.featureID || fallbackId;
      const idx = i + 1;
      try { retagSolidFaces(c, `${featureID}_${idx}`); } catch (_) { /* best-effort */ }
      c.name = `${featureID}_${idx}`;
      if (doVisualize) c.visualize();
      out.push(c);
    }
    return out;
  }
}

function toVec3(v: any, dx: number, dy: number, dz: number) {
  if (Array.isArray(v)) return new THREE.Vector3(v[0] ?? dx, v[1] ?? dy, v[2] ?? dz);
  if (v && typeof v === 'object') return new THREE.Vector3(v.x ?? dx, v.y ?? dy, v.z ?? dz);
  return new THREE.Vector3(dx, dy, dz);
}

function toFiniteNumber(value: any, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeOptionKey(value: any) {
  return String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
}

function resolveLinearDelta(params: AnyRecord = {}, count = 1) {
  const linearInputMode = normalizeOptionKey(params?.linearInputMode || "vector distance");
  const isSpan = normalizeOptionKey(params?.countMode || "count and pitch") === "COUNT_AND_SPAN";
  const spanDivisor = isSpan ? Math.max(1, count - 1) : 1;
  if (linearInputMode !== "VECTOR_DISTANCE") {
    return toVec3((params.offset && params.offset.position) || [10, 0, 0], 10, 0, 0).multiplyScalar(1 / spanDivisor);
  }
  const ref = Array.isArray(params.directionRef) ? params.directionRef[0] : params.directionRef;
  const direction = computeDirectionFromReference(ref) || new THREE.Vector3(1, 0, 0);
  const distance = toFiniteNumber(params.linearDistance, 10);
  return direction.clone().multiplyScalar(distance / spanDivisor);
}

function computeDirectionFromReference(refObj: any) {
  if (!refObj) return null;
  const type = String(refObj?.type || '').toUpperCase();
  if (type === 'EDGE') return computeAxisFromEdge(refObj)?.dir || null;
  if (type === 'FACE') return computeFaceNormal(refObj);
  if (type === 'PLANE') return computePlaneNormal(refObj);
  return computeAxisFromEdge(refObj)?.dir || computeFaceNormal(refObj) || computePlaneNormal(refObj);
}

function computeAxisFromEdge(edgeObj: any) {
  if (!edgeObj) return null;
  const mat = edgeObj.matrixWorld;
  let A = new THREE.Vector3(0, 0, 0), B = new THREE.Vector3(0, 1, 0);
  const cached = edgeObj?.userData?.polylineLocal;
  const isWorld = !!(edgeObj?.userData?.polylineWorld);
  if (Array.isArray(cached) && cached.length >= 2) {
    const pick = [];
    for (let i = 0; i < cached.length && pick.length < 2; i++) {
      const p = cached[i];
      if (!pick.length) { pick.push(p); continue; }
      const q = pick[0];
      if (Math.abs(p[0] - q[0]) > 1e-12 || Math.abs(p[1] - q[1]) > 1e-12 || Math.abs(p[2] - q[2]) > 1e-12) pick.push(p);
    }
    if (pick.length >= 2) {
      if (isWorld) {
        A.set(pick[0][0], pick[0][1], pick[0][2]);
        B.set(pick[1][0], pick[1][1], pick[1][2]);
      } else {
        A.set(pick[0][0], pick[0][1], pick[0][2]).applyMatrix4(mat);
        B.set(pick[1][0], pick[1][1], pick[1][2]).applyMatrix4(mat);
      }
    }
  } else {
    const aStart = edgeObj?.geometry?.attributes?.instanceStart;
    const aEnd = edgeObj?.geometry?.attributes?.instanceEnd;
    if (aStart && aEnd && aStart.count >= 1) {
      const s = new THREE.Vector3(aStart.getX(0), aStart.getY(0), aStart.getZ(0)).applyMatrix4(mat);
      const e = new THREE.Vector3(aEnd.getX(0), aEnd.getY(0), aEnd.getZ(0)).applyMatrix4(mat);
      A.copy(s); B.copy(e);
    } else {
      const pos = edgeObj?.geometry?.getAttribute?.('position');
      if (pos && pos.count >= 2) {
        const s = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).applyMatrix4(mat);
        const e = new THREE.Vector3(pos.getX(pos.count - 1), pos.getY(pos.count - 1), pos.getZ(pos.count - 1)).applyMatrix4(mat);
        A.copy(s); B.copy(e);
      }
    }
  }
  const dir = B.clone().sub(A);
  if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0); else dir.normalize();
  return { point: A, dir };
}

function computeFaceNormal(faceObj: any) {
  if (!faceObj?.geometry) return null;
  const pos = faceObj.geometry.getAttribute?.('position');
  if (!pos || pos.count < 3) return null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nAccum = new THREE.Vector3();
  const toWorld = (out: any, i: number) => out
    .set(pos.getX(i), pos.getY(i), pos.getZ(i))
    .applyMatrix4(faceObj.matrixWorld);
  const triCount = (pos.count / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = 3 * t + 0;
    const i1 = 3 * t + 1;
    const i2 = 3 * t + 2;
    toWorld(a, i0); toWorld(b, i1); toWorld(c, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    nAccum.add(new THREE.Vector3().crossVectors(ac, ab));
  }
  if (nAccum.lengthSq() <= 1e-12) return null;
  return nAccum.normalize();
}

function computePlaneNormal(planeObj: any) {
  try {
    const q = new THREE.Quaternion();
    planeObj.getWorldQuaternion(q);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    if (normal.lengthSq() <= 1e-12) return null;
    return normal.normalize();
  } catch (_) {
    return null;
  }
}

// Retag all face labels in a Solid with a unique suffix so IDs remain distinct
// across patterned instances when booleaned together.
function retagSolidFaces(solid: any, suffix: any) {
  if (!solid || !suffix) return;
  try {
    const oldIdToFace = (solid._idToFaceName instanceof Map) ? solid._idToFaceName : new Map();
    const triIDs = Array.isArray(solid._triIDs) ? solid._triIDs : [];
    const presentIDs = new Set();
    for (const k of oldIdToFace.keys()) presentIDs.add(k);
    if (presentIDs.size === 0 && triIDs.length) { for (const id of triIDs) presentIDs.add(id >>> 0); }

    const idRemap = new Map();
    const newIdToFace = new Map();
    const newFaceToId = new Map();
    for (const oldID of presentIDs) {
      const fname = oldIdToFace.get(oldID);
      const base = (fname != null) ? String(fname) : `FACE_${oldID}`;
      const tagged = `${base}::${suffix}`;
      const newID = Manifold.reserveIDs(1);
      idRemap.set(oldID, newID);
      newIdToFace.set(newID, tagged);
      newFaceToId.set(tagged, newID);
    }

    if (triIDs.length && idRemap.size) {
      for (let i = 0; i < triIDs.length; i++) {
        const oldID = triIDs[i] >>> 0;
        const mapped = idRemap.get(oldID);
        if (mapped !== undefined) triIDs[i] = mapped;
      }
      solid._triIDs = triIDs;
      solid._dirty = true;
    }

    solid._idToFaceName = newIdToFace;
    solid._faceNameToID = newFaceToId;
  } catch (_) { /* best-effort */ }
}

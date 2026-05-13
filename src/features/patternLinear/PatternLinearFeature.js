import { BREP } from "../../BREP/BREP.js";
const THREE = BREP.THREE;

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
  // Linear params
  count: {
    type: "number",
    default_value: 3,
    step: 1,
    hint: "Instance count (>= 1)",
  },
  offset: {
    type: "transform",
    default_value: { position: [10, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
    label: "Offset (use gizmo)",
    hint: "Use Move gizmo to set direction and distance (position only)",
  },
};

export class PatternLinearFeature {
  static shortName = "PATLIN";
  static longName = "Pattern Linear";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const solids = items
      .filter((it) => String(it?.type || '').toUpperCase() === 'SOLID')
      .map((it) => it?.name)
      .filter((name) => !!name);
    if (!solids.length) return false;
    return { params: { solids } };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(_partHistory) {
    const raw = Array.isArray(this.inputParams.solids) ? this.inputParams.solids.filter(Boolean) : [];
    const solids = [];
    for (const o of raw) {
      if (!o) continue;
      if (o.type === 'SOLID') solids.push(o);
      else if (o.parentSolid && o.parentSolid.type === 'SOLID') solids.push(o.parentSolid);
      else if (o.parent && o.parent.type === 'SOLID') solids.push(o.parent);
    }
    if (!solids.length) return { added: [], removed: [] };

    const count = Math.max(1, (this.inputParams.count | 0));
    const d = toVec3(this.inputParams.offset?.position, 10, 0, 0);

    const instances = [];
    const fallbackId = PatternLinearFeature.shortName || PatternLinearFeature.longName || 'PatternLinear';
    const featureID = this.inputParams.featureID || fallbackId;
    for (const src of solids) {
      for (let i = 1; i <= count - 1; i++) {
        const t = new THREE.Matrix4().makeTranslation(d.x * i, d.y * i, d.z * i);
        const c = src.clone();
        c.bakeTransform(t);
        const idx = i + 1;
        try { retagSolidFaces(c, `${featureID}_${idx}`); } catch (_) {}
        c.name = `${featureID}_${idx}`;
        c.visualize();
        instances.push(c);
      }
    }
    return { added: instances, removed: [] };
  }
}

function toVec3(v, dx, dy, dz) {
  if (Array.isArray(v)) return new THREE.Vector3(v[0] ?? dx, v[1] ?? dy, v[2] ?? dz);
  if (v && typeof v === 'object') return new THREE.Vector3(v.x ?? dx, v.y ?? dy, v.z ?? dz);
  return new THREE.Vector3(dx, dy, dz);
}

function retagSolidFaces(solid, suffix) {
  if (!solid || !suffix) return;
  if (typeof solid.renameFace === 'function' && typeof solid.getFaceNames === 'function') {
    const names = solid.getFaceNames();
    for (const name of names) solid.renameFace(name, `${String(name ?? 'Face')}::${suffix}`);
  }
}

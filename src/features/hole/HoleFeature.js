import { BREP } from '../../BREP/BREP.js';
import { ThreadGeometry, ThreadStandard } from '../../BREP/threadGeometry.js';
import { hasOccShape, setOccState, subtractOccSolidTools } from '../../BREP/OpenCascadeKernel.js';
import { getClearanceDiameter } from './screwClearance.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for the hole feature',
  },
  face: {
    type: 'reference_selection',
    label: 'Placement (sketch)',
    selectionFilter: ['SKETCH'],
    multiple: false,
    minSelections: 1,
    default_value: null,
    hint: 'Select a sketch to place the hole',
  },
  holeType: {
    type: 'options',
    label: 'Hole type',
    options: ['SIMPLE', 'COUNTERSINK', 'COUNTERBORE', 'THREADED'],
    default_value: 'SIMPLE',
    hint: 'Choose the hole style',
  },
    clearanceFit: {
    type: 'options',
    label: 'Screw clearance fit',
    options: ['NONE', 'CLOSE', 'NORMAL', 'LOOSE'],
    default_value: 'NONE',
    hint: 'Use screw clearance data to size the hole (NONE keeps manual diameter)',
  },
  clearanceStandard: {
    type: 'options',
    label: 'Clearance standard',
    options: ['ISO_METRIC', 'UNIFIED'],
    default_value: 'ISO_METRIC',
    hint: 'Standard for clearance hole lookup',
  },
  clearanceDesignation: {
    type: 'thread_designation',
    label: 'Clearance screw size / designation',
    default_value: '',
    hint: 'Size to use for clearance hole lookup (e.g. M6x1, 1/4-20UNC, #10-32UNF)',
    standardField: 'clearanceStandard',
  },
  diameter: {
    type: 'number',
    label: 'Diameter',
    default_value: 6,
    min: 0,
    step: 0.1,
    hint: 'Straight hole diameter',
  },
  depth: {
    type: 'number',
    label: 'Depth',
    default_value: 10,
    min: 0,
    step: 0.1,
    hint: 'Straight portion depth (ignored when Through All)',
  },
  throughAll: {
    type: 'boolean',
    label: 'Through all',
    default_value: false,
    hint: 'Cut through the entire target thickness',
  },

  countersinkDiameter: {
    type: 'number',
    label: 'Countersink diameter',
    default_value: 10,
    min: 0,
    step: 0.1,
    hint: 'Major diameter of the countersink',
  },
  countersinkAngle: {
    type: 'number',
    label: 'Countersink angle (deg)',
    default_value: 82,
    min: 1,
    max: 179,
    step: 1,
    hint: 'Included angle of the countersink',
  },
  counterboreDiameter: {
    type: 'number',
    label: 'Counterbore diameter',
    default_value: 10,
    min: 0,
    step: 0.1,
    hint: 'Major diameter of the counterbore',
  },
  counterboreDepth: {
    type: 'number',
    label: 'Counterbore depth',
    default_value: 3,
    min: 0,
    step: 0.1,
    hint: 'Depth of the counterbore recess',
  },
  threadStandard: {
    type: 'options',
    label: 'Thread standard',
    options: ['NONE', 'ISO_METRIC', 'UNIFIED', 'TRAPEZOIDAL_METRIC', 'ACME', 'STUB_ACME', 'WHITWORTH', 'NPT'],
    default_value: 'NONE',
    hint: 'Thread specification family',
  },
  threadDesignation: {
    type: 'thread_designation',
    label: 'Thread size / designation',
    default_value: '',
    hint: 'Choose a preset for the selected thread standard or enter a custom size (e.g. M6x1, 1/4-20, Tr16x4, 1/4-18NPT, 10-32)',
  },
  threadMode: {
    type: 'options',
    label: 'Thread modeling',
    options: ['SYMBOLIC', 'MODELED'],
    default_value: 'SYMBOLIC',
    hint: 'Symbolic is faster; modeled is helical geometry',
  },
  threadRadialOffset: {
    type: 'number',
    label: 'Thread radial offset',
    default_value: 0,
    step: 0.01,
    hint: 'Optional clearance (+) or interference (-) applied to the thread profile',
  },
  debugShowSolid: {
    type: 'boolean',
    label: 'Debug: show tool solid',
    default_value: false,
    hint: 'Visualize the cutting solid even if it is non-manifold',
  },
  boolean: {
    type: 'boolean_operation',
    label: 'Boolean',
    default_value: { targets: [], operation: 'SUBTRACT' },
    hint: 'Targets to cut; defaults to the selected body',
  },
};

const THREE = BREP.THREE;
const DEBUG_HOLE_FEATURE = false;

function holeDebugLog(...args) {
  if (DEBUG_HOLE_FEATURE) console.log(...args);
}

function fallbackVector(v, def = new THREE.Vector3()) {
  if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return def.clone();
  return new THREE.Vector3(v.x, v.y, v.z);
}

function buildBasisFromNormal(normal) {
  const up = fallbackVector(normal, new THREE.Vector3(0, 1, 0)).clone();
  if (up.lengthSq() < 1e-12) up.set(0, 1, 0);
  up.normalize();
  const ref = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(ref, up);
  if (x.lengthSq() < 1e-12) x.set(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(up, x).normalize();
  const mat = new THREE.Matrix4();
  mat.makeBasis(x, up, z);
  return mat;
}

function boxDiagonalLength(obj) {
  try {
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) return box.getSize(new THREE.Vector3()).length();
  } catch {
    /* ignore */
  }
  return 0;
}

function boxExitDistanceAlongDirection(obj, origin, direction) {
  if (!obj || !origin || !direction || direction.lengthSq() < 1e-12) return 0;
  try {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return 0;
    const dir = direction.clone().normalize();
    let best = Infinity;
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
      const d = dir[axis];
      if (Math.abs(d) <= 1e-12) continue;
      const plane = d > 0 ? box.max[axis] : box.min[axis];
      const t = (plane - origin[axis]) / d;
      if (t < -1e-9 || t >= best) continue;
      const p = origin.clone().addScaledVector(dir, t);
      const inside =
        p.x >= box.min.x - 1e-7 && p.x <= box.max.x + 1e-7 &&
        p.y >= box.min.y - 1e-7 && p.y <= box.max.y + 1e-7 &&
        p.z >= box.min.z - 1e-7 && p.z <= box.max.z + 1e-7;
      if (inside) best = t;
    }
    return Number.isFinite(best) ? Math.max(0, best) : 0;
  } catch {
    return 0;
  }
}

function parseNumberLike(value) {
  if (value == null) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  const mixed = raw.match(/^([0-9]+)[-\s]+([0-9]+)\/([0-9]+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (Number.isFinite(whole) && Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return whole + num / den;
    }
  }
  const frac = raw.match(/^([0-9]+)\/([0-9]+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function unionSolids(solids) {
  if (!Array.isArray(solids) || solids.length === 0) {
    console.warn('[HoleFeature] unionSolids: no solids provided');
    return null;
  }
  holeDebugLog('[HoleFeature] unionSolids: combining', solids.length, 'solids');
  let current = solids[0];
  if (!current) {
    console.warn('[HoleFeature] unionSolids: first solid is null/undefined');
    return null;
  }
  holeDebugLog('[HoleFeature] unionSolids: first solid type:', current?.constructor?.name);
  for (let i = 1; i < solids.length; i++) {
    const next = solids[i];
    if (!next) continue;
    try { 
      holeDebugLog('[HoleFeature] unionSolids: unioning with solid', i, 'type:', next?.constructor?.name);
      current = current.union(next); 
    }
    catch (error) { console.warn('[HoleFeature] Union failed:', error); }
  }
  holeDebugLog('[HoleFeature] unionSolids: final result type:', current?.constructor?.name);
  return current;
}

async function subtractHoleToolsSequentially(partHistory, tools, booleanParam, featureID) {
  const rawTargets = Array.isArray(booleanParam?.targets) ? booleanParam.targets.filter(Boolean) : [];
  if (!tools.length) return { added: [], removed: [] };
  if (!rawTargets.length) {
    const combinedTool = tools.length === 1 ? tools[0] : unionSolids(tools);
    return BREP.applyBooleanOperation(partHistory || {}, combinedTool, booleanParam, featureID);
  }

  let currentTargets = rawTargets;
  const removed = new Set();
  let lastEffects = { added: rawTargets, removed: [] };

  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i];
    const stepParam = {
      ...booleanParam,
      operation: 'SUBTRACT',
      targets: currentTargets,
    };
    lastEffects = await BREP.applyBooleanOperation(partHistory || {}, tool, stepParam, featureID);
    for (const item of lastEffects.removed || []) {
      if (item) removed.add(item);
    }
    const nextTargets = Array.isArray(lastEffects.added) ? lastEffects.added.filter(Boolean) : [];
    if (!nextTargets.length) break;
    currentTargets = nextTargets;
  }

  return {
    added: Array.isArray(lastEffects.added) ? lastEffects.added : [],
    removed: Array.from(removed),
  };
}

async function subtractHoleToolGroupsTogether(partHistory, toolGroups, booleanParam, featureID) {
  const groups = (Array.isArray(toolGroups) ? toolGroups : [])
    .map((group) => (Array.isArray(group) ? group.filter(Boolean) : []))
    .filter((group) => group.length > 0);
  const tools = groups.flat();
  const rawTargets = Array.isArray(booleanParam?.targets) ? booleanParam.targets.filter(Boolean) : [];
  if (!tools.length) return { added: [], removed: [] };
  if (!rawTargets.length || !rawTargets.every((target) => hasOccShape(target)) || !tools.every((tool) => hasOccShape(tool))) {
    return subtractHoleToolsSequentially(partHistory, tools, booleanParam, featureID);
  }

  const added = [];
  const removed = [...rawTargets, ...tools];
  for (const target of rawTargets) {
    try {
      let current = target;
      for (const group of groups) {
        const occState = subtractOccSolidTools(current, group);
        if (!occState) throw new Error('OpenCASCADE multi-tool subtract returned no result.');
        const IntermediateCtor = target?.constructor || BREP.Solid;
        const intermediate = new IntermediateCtor();
        setOccState(intermediate, occState);
        intermediate._auxEdges = [
          ...(Array.isArray(current?._auxEdges) ? current._auxEdges : []),
          ...group.flatMap((tool) => (Array.isArray(tool?._auxEdges) ? tool._auxEdges : [])),
        ];
        try { intermediate.name = target?.name || current?.name || 'RESULT'; } catch { /* ignore */ }
        try { if (target?.owningFeatureID) intermediate.owningFeatureID = target.owningFeatureID; } catch { /* ignore */ }
        current = intermediate;
      }
      const SolidCtor = target?.constructor || BREP.Solid;
      const result = new SolidCtor();
      setOccState(result, current._occ);
      result._auxEdges = [
        ...(Array.isArray(current?._auxEdges) ? current._auxEdges : []),
      ];
      try { result.name = target?.name || (featureID ? `${featureID}_RESULT` : 'RESULT'); } catch { /* ignore */ }
      try { if (target?.owningFeatureID) result.owningFeatureID = target.owningFeatureID; } catch { /* ignore */ }
      added.push(result);
    } catch (err) {
      console.warn('[HoleFeature] Multi-tool subtract failed; falling back to sequential subtract:', err);
      return subtractHoleToolsSequentially(partHistory, tools, booleanParam, featureID);
    }
  }

  return { added, removed };
}

function getWorldPosition(obj) {
  if (!obj) return null;
  if (obj.isVector3) return obj.clone();
  const out = new THREE.Vector3();
  if (typeof obj.getWorldPosition === 'function') {
    try { return obj.getWorldPosition(out); } catch { }
  }
  if (obj.position && typeof obj.position === 'object') {
    out.copy(obj.position);
    try {
      if (obj.matrixWorld && typeof obj.matrixWorld.isMatrix4 === 'boolean') {
        out.applyMatrix4(obj.matrixWorld);
      }
    } catch {
      /* ignore */
    }
    return out;
  }
  return null;
}

function normalFromSketch(sketch) {
  const fallback = new THREE.Vector3(0, 0, 1);
  if (!sketch) return fallback;

  // Prefer an explicit sketch basis if provided by the sketch feature.
  const basis = sketch.userData?.sketchBasis;
  if (basis && Array.isArray(basis.x) && Array.isArray(basis.y)) {
    const bx = new THREE.Vector3().fromArray(basis.x);
    const by = new THREE.Vector3().fromArray(basis.y);
    const bz = Array.isArray(basis.z) ? new THREE.Vector3().fromArray(basis.z) : new THREE.Vector3().crossVectors(bx, by);
    if (bz.lengthSq() > 1e-12) return bz.normalize();
  }

  // Fallback to world transform normal if available.
  try {
    const n = new THREE.Vector3(0, 0, 1);
    const nm = new THREE.Matrix3();
    nm.getNormalMatrix(sketch.matrixWorld || new THREE.Matrix4());
    n.applyMatrix3(nm);
    if (n.lengthSq() > 1e-12) return n.normalize();
  } catch { /* ignore */ }

  return new THREE.Vector3(0, 1, 0);
}

function centerFromObject(obj) {
  try {
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
  } catch {
    /* ignore */
  }
  return new THREE.Vector3();
}

function collectSceneSolids(scene) {
  const solids = [];
  const pushIfSolid = (obj) => {
    if (!obj || obj === scene) return;
    const solidLike =
      obj.userData?.isSolid
      || obj.isSolid
      || obj.type === 'Solid'
      || obj.type === 'SOLID'
      || obj.constructor?.name === 'Solid'
      || typeof obj.union === 'function';
    if (solidLike) solids.push(obj);
  };
  if (!scene) return solids;
  if (typeof scene.traverse === 'function') {
    scene.traverse((obj) => pushIfSolid(obj));
  } else if (Array.isArray(scene.children)) {
    for (const obj of scene.children) pushIfSolid(obj);
  }
  return solids;
}

function chooseNearestSolid(solids, point) {
  if (!Array.isArray(solids) || !solids.length || !point) return null;
  let best = null;
  let bestD2 = Infinity;
  const tmpBox = new THREE.Box3();
  const nearestToBox = new THREE.Vector3();
  for (const s of solids) {
    if (!s) continue;
    try {
      tmpBox.setFromObject(s);
      const clamped = tmpBox.clampPoint(point, nearestToBox);
      const d2 = clamped.distanceToSquared(point);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    } catch {
      /* ignore solids that fail bbox */
    }
  }
  return best;
}

function collectSketchVertices(sketch) {
  const verts = [];
  try {
    if (!sketch || !Array.isArray(sketch.children)) return verts;
    for (const child of sketch.children) {
      if (!child) continue;
      const isConstructionPoint = child?.userData?.isConstructionPoint === true;
      if (isConstructionPoint) continue;
      const isVertexLike = child.type === 'Vertex' || child.isVertex || child.userData?.isVertex || child.userData?.type === 'VERTEX';
      if (isVertexLike) verts.push(child);
    }
  } catch { /* ignore */ }
  return verts;
}

function collectSketchVerticesByName(scene, sketchName) {
  const verts = [];
  if (!scene || !sketchName) return verts;
  const prefix = `${sketchName}:P`;
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  const walk = (obj) => {
    if (!obj) return;
    const nm = obj.name || '';
    const m = nm.match(re);
    if (m) {
      const isConstructionPoint = obj?.userData?.isConstructionPoint === true;
      if (!isConstructionPoint) verts.push(obj);
    }
    const children = Array.isArray(obj.children) ? obj.children : [];
    for (const c of children) walk(c);
  };
  walk(scene);
  return verts;
}

function getSceneObjectByName(partHistory, name) {
  if (!partHistory || !name) return null;
  try {
    if (typeof partHistory.getObjectByName === 'function') {
      const obj = partHistory.getObjectByName(name);
      if (obj) return obj;
    }
  } catch { /* ignore */ }
  try {
    return partHistory.scene?.getObjectByName?.(name) || null;
  } catch {
    return null;
  }
}

function findSceneObjectByName(partHistory, name, predicate = null) {
  const direct = getSceneObjectByName(partHistory, name);
  if (direct && (!predicate || predicate(direct))) return direct;
  const scene = partHistory?.scene;
  if (!scene || typeof scene.traverse !== 'function') return null;
  let found = null;
  try {
    scene.traverse((obj) => {
      if (found || !obj || obj.name !== name) return;
      if (!predicate || predicate(obj)) found = obj;
    });
  } catch { /* ignore */ }
  return found;
}

function isSketchObject(obj) {
  return String(obj?.type || '').toUpperCase() === 'SKETCH';
}

function parseSketchPointReference(value) {
  const raw = typeof value === 'string'
    ? value
    : (typeof value?.name === 'string' ? value.name : '');
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/^([^:|[\]>/]+):P(\d+)(?=$|[_:|[\]>/])/);
  if (!match) return null;
  const sketchName = match[1];
  const pointName = `${sketchName}:P${match[2]}`;
  return { sketchName, pointName };
}

function parseSketchReferenceName(value) {
  const raw = typeof value === 'string'
    ? value
    : (typeof value?.name === 'string' ? value.name : '');
  const text = raw.trim();
  if (!text) return null;
  const pointRef = parseSketchPointReference(text);
  if (pointRef?.sketchName) return pointRef.sketchName;
  const base = text.split(/[:|[\]>/]/, 1)[0];
  return base || null;
}

function resolveSketchSelection(selectionRaw, partHistory) {
  const requestedPointNames = new Set();
  let sketch = null;

  for (const item of selectionRaw) {
    if (!item) continue;
    const pointRef = parseSketchPointReference(item);
    if (pointRef?.pointName) requestedPointNames.add(pointRef.pointName);

    if (!sketch && isSketchObject(item)) sketch = item;
    if (!sketch && isSketchObject(item?.parent)) sketch = item.parent;
    if (!sketch && typeof item === 'string') {
      const direct = findSceneObjectByName(partHistory, item, isSketchObject);
      if (direct) sketch = direct;
    }
    if (!sketch) {
      const sketchName = parseSketchReferenceName(item);
      if (sketchName) {
        const resolved = findSceneObjectByName(partHistory, sketchName, isSketchObject);
        if (resolved) sketch = resolved;
      }
    }
  }

  return { sketch, requestedPointNames };
}

function dedupePlacementsByPosition(placements, tolerance = 1e-7) {
  const out = [];
  if (!Array.isArray(placements) || placements.length === 0) return out;

  const tol = Math.max(1e-12, Number(tolerance) || 1e-7);
  const invTol = 1 / tol;
  const buckets = new Map();
  const keyOf = (p) => `${Math.round(p.x * invTol)},${Math.round(p.y * invTol)},${Math.round(p.z * invTol)}`;

  for (const item of placements) {
    const p = item?.position;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    const key = keyOf(p);
    const bucket = buckets.get(key);
    let duplicate = false;
    if (bucket) {
      for (let i = 0; i < bucket.length; i++) {
        const existing = out[bucket[i]]?.position;
        if (!existing) continue;
        if (
          Math.abs(existing.x - p.x) <= tol &&
          Math.abs(existing.y - p.y) <= tol &&
          Math.abs(existing.z - p.z) <= tol
        ) {
          duplicate = true;
          break;
        }
      }
    }
    if (duplicate) continue;
    const outIndex = out.length;
    out.push(item);
    if (bucket) bucket.push(outIndex);
    else buckets.set(key, [outIndex]);
  }
  return out;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseThreadGeometry({ standard, designation, isExternal }) {
  const stdRaw = standard || 'NONE';
  const std = String(stdRaw).toUpperCase();
  const desig = String(designation || '').trim();
  if (!desig || std === 'NONE') return null;

  const clean = desig.replace(/\s+/g, '').toUpperCase();
  const gaugeToInch = (n) => 0.06 + 0.013 * n; // approx formula for # screw sizes
  const tryMetric = () => {
    const normalized = clean.replace(/×/g, 'X').replace(/M(?=\d)/, 'M');
    return ThreadGeometry.fromMetricDesignation(normalized, { isExternal });
  };
  const tryTr = () => {
    const normalized = clean.replace(/×/g, 'X').replace(/^TR?/, 'TR');
    return ThreadGeometry.fromTrapezoidalDesignation(normalized, { isExternal });
  };
  const parseDiaTpi = () => {
    const m = clean.match(/^#?([0-9./]+)-([0-9.]+)([A-Z]+)?$/);
    if (!m) return null;
    const rawDia = m[1];
    const tpi = Number(m[2]);
    const series = m[3] ? m[3].toUpperCase() : null;
    let dia = parseNumberLike(rawDia);
    const intOnly = /^[0-9]+$/.test(rawDia);
    if (intOnly && (!Number.isFinite(dia) || dia > 1.5)) {
      const g = Number(rawDia);
      if (Number.isFinite(g) && g >= 0 && g <= 14) dia = gaugeToInch(g);
    }
    if (!Number.isFinite(dia) || !Number.isFinite(tpi) || dia <= 0 || tpi <= 0) return null;
    return { dia, tpi, series };
  };
  const tryUnified = () => {
    const dt = parseDiaTpi();
    if (!dt) return null;
    const g = ThreadGeometry.fromUnified(dt.dia, dt.tpi, { isExternal });
    if (dt.series) g.series = dt.series;
    return g;
  };
  const tryAcme = () => {
    const dt = parseDiaTpi();
    if (!dt) return null;
    return ThreadGeometry.fromAcme(dt.dia, dt.tpi, { isExternal });
  };
  const tryStubAcme = () => {
    const dt = parseDiaTpi();
    if (!dt) return null;
    return ThreadGeometry.fromStubAcme(dt.dia, dt.tpi, { isExternal });
  };
  const tryWhitworth = () => {
    const dt = parseDiaTpi();
    if (!dt) return null;
    return ThreadGeometry.fromWhitworth(dt.dia, dt.tpi, { isExternal });
  };
  const tryNpt = () => {
    const m = clean.replace(/^NPT/i, '').replace(/NPT$/i, '');
    const m1 = m.match(/^([0-9./]+)-([0-9.]+)$/);
    if (!m1) return null;
    const dia = parseNumberLike(m1[1]);
    const tpi = Number(m1[2]);
    if (!Number.isFinite(dia) || !Number.isFinite(tpi) || dia <= 0 || tpi <= 0) return null;
    return ThreadGeometry.fromNPT(dia, tpi, { isExternal, taperDirection: 1 });
  };

  const tryMap = {
    [ThreadStandard.ISO_METRIC]: tryMetric,
    [ThreadStandard.TRAPEZOIDAL_METRIC]: tryTr,
    [ThreadStandard.UNIFIED]: tryUnified,
    [ThreadStandard.ACME]: tryAcme,
    [ThreadStandard.STUB_ACME]: tryStubAcme,
    [ThreadStandard.WHITWORTH]: tryWhitworth,
    [ThreadStandard.NPT]: tryNpt,
  };

  const primary = tryMap[std];
  if (primary) {
    const g = primary();
    if (g) return g;
    console.warn('[HoleFeature] Thread parse failed for requested standard, attempting fallback:', std, desig);
  }

  // Fallback inference by pattern
  if (/^M\d+/i.test(clean)) {
    const g = tryMetric();
    if (g) return g;
  }
  if (/^TR/i.test(clean)) {
    const g = tryTr();
    if (g) return g;
  }
  if (/NPT/i.test(clean)) {
    const g = tryNpt();
    if (g) return g;
  }
  if (clean.includes('-')) {
    const g = tryUnified() || tryAcme() || tryStubAcme() || tryWhitworth();
    if (g) return g;
  }

  throw new Error(`Unable to parse thread designation "${desig}" for standard ${stdRaw}.`);
}

function makeHoleTool({ holeType, radius, straightDepthTotal, sinkDia, sinkAngle, boreDia, boreDepth, res, featureID, omitStraight = false }) {
  const solids = [];
  const descriptors = [];
  if (holeType === 'COUNTERSINK') {
    const sinkRadius = Math.max(radius, sinkDia * 0.5);
    const angleRad = sinkAngle * (Math.PI / 180);
    const sinkHeight = (sinkRadius - radius) / Math.tan(angleRad * 0.5);
    const coreDepth = Math.max(0, straightDepthTotal - sinkHeight);
    if (sinkHeight > 0) {
      solids.push(new BREP.Cone({
        r1: radius,
        r2: sinkRadius,
        h: sinkHeight,
        resolution: res,
        name: featureID ? `${featureID}_CSK` : 'CSK',
      }));
    }
    if (!omitStraight && coreDepth > 0) {
      const cyl = new BREP.Cylinder({
        radius,
        height: coreDepth,
        resolution: res,
        name: featureID ? `${featureID}_Hole` : 'Hole',
      });
      cyl.bakeTRS({ position: [0, sinkHeight, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] });
      solids.push(cyl);
    }
    descriptors.push({
      type: 'COUNTERSINK',
      totalDepth: straightDepthTotal,
      straightDepth: coreDepth,
      countersinkHeight: sinkHeight,
      countersinkDiameter: sinkRadius * 2,
      diameter: radius * 2,
      countersinkAngle: sinkAngle,
      counterboreDepth: 0,
      counterboreDiameter: 0,
    });
  } else if (holeType === 'COUNTERBORE') {
    const coreDepth = Math.max(0, straightDepthTotal - boreDepth);
    if (boreDepth > 0) {
      solids.push(new BREP.Cylinder({
        radius: Math.max(radius, boreDia * 0.5),
        height: boreDepth,
        resolution: res,
        name: featureID ? `${featureID}_CBore` : 'CBore',
      }));
    }
    if (!omitStraight && coreDepth > 0) {
      const cyl = new BREP.Cylinder({
        radius,
        height: coreDepth,
        resolution: res,
        name: featureID ? `${featureID}_Hole` : 'Hole',
      });
      cyl.bakeTRS({ position: [0, boreDepth, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] });
      solids.push(cyl);
    }
    descriptors.push({
      type: 'COUNTERBORE',
      totalDepth: straightDepthTotal,
      straightDepth: coreDepth,
      countersinkHeight: 0,
      countersinkDiameter: 0,
      diameter: radius * 2,
      countersinkAngle: 0,
      counterboreDepth: boreDepth,
      counterboreDiameter: Math.max(radius, boreDia * 0.5) * 2,
    });
  } else {
    if (!omitStraight && straightDepthTotal > 0) {
      solids.push(new BREP.Cylinder({
        radius,
        height: straightDepthTotal,
        resolution: res,
        name: featureID ? `${featureID}_Hole` : 'Hole',
      }));
    }
    descriptors.push({
      type: 'SIMPLE',
      totalDepth: straightDepthTotal,
      straightDepth: straightDepthTotal,
      countersinkHeight: 0,
      countersinkDiameter: 0,
      diameter: radius * 2,
      countersinkAngle: 0,
      counterboreDepth: 0,
      counterboreDiameter: 0,
    });
  }
  return { solids, descriptors };
}

export class HoleFeature {
  static shortName = 'H';
  static longName = 'Hole';
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const sketch = items.find((it) => {
      const type = String(it?.type || '').toUpperCase();
      if (type === 'SKETCH') return true;
      if (it?.parent && String(it.parent.type || '').toUpperCase() === 'SKETCH') return true;
      return false;
    });
    if (!sketch) return false;
    const name = (String(sketch?.type || '').toUpperCase() === 'SKETCH')
      ? sketch.name
      : sketch.parent?.name;
    if (!name) return false;
    return { field: 'face', value: name };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  uiFieldsTest(context) {
    const params = this.inputParams || context?.params || {};
    const t = String(params?.holeType || 'SIMPLE').toUpperCase();
    const clearanceFit = String(params?.clearanceFit || 'NONE').toUpperCase();
    const exclude = new Set();

    const hide = (...keys) => { for (const key of keys) exclude.add(key); };
    const hideCountersink = () => hide('countersinkDiameter', 'countersinkAngle');
    const hideCounterbore = () => hide('counterboreDiameter', 'counterboreDepth');
    const hideThread = () => hide('threadStandard', 'threadDesignation', 'threadMode', 'threadRadialOffset');

    if (t === 'THREADED') {
      hideCountersink();
      hideCounterbore();
      hide('clearanceFit', 'clearanceStandard', 'clearanceDesignation', 'diameter');
    } else {
      hideThread();
      if (t === 'COUNTERSINK') {
        hideCounterbore();
      } else if (t === 'COUNTERBORE') {
        hideCountersink();
      } else {
        hideCountersink();
        hideCounterbore();
      }
      if (clearanceFit === 'NONE') {
        hide('clearanceStandard', 'clearanceDesignation');
      } else {
        hide('diameter');
      }
    }

    return Array.from(exclude);
  }

  async run(partHistory) {
    const params = this.inputParams || {};
    const featureID = params.featureID || params.id || null;
    const selectionRaw = Array.isArray(params.face) ? params.face.filter(Boolean) : (params.face ? [params.face] : []);
    const { sketch, requestedPointNames } = resolveSketchSelection(selectionRaw, partHistory);
    if (!sketch) throw new Error('HoleFeature requires a sketch selection; individual vertex picks are not supported.');

    const pointObjs = [];
    const sceneSolids = collectSceneSolids(partHistory?.scene);
    let pointPlacements = [];

    // Use sketch-defined points as hole centers (construction points are excluded).
    const filterRequestedPoints = (items) => {
      if (!(requestedPointNames instanceof Set) || requestedPointNames.size === 0) return items;
      return items.filter((item) => requestedPointNames.has(item?.name || ''));
    };
    const extraPts = filterRequestedPoints(collectSketchVertices(sketch));
    if (extraPts.length) {
      pointObjs.push(...extraPts);
      pointPlacements = pointObjs
        .map((o) => ({ pointObj: o, position: getWorldPosition(o) }))
        .filter((entry) => !!entry.position);
    }
    if (!pointPlacements.length && partHistory?.scene && sketch?.name) {
      const fallbackPts = filterRequestedPoints(collectSketchVerticesByName(partHistory.scene, sketch.name));
      if (fallbackPts.length) {
        pointObjs.push(...fallbackPts);
        pointPlacements = pointObjs
          .map((o) => ({ pointObj: o, position: getWorldPosition(o) }))
          .filter((entry) => !!entry.position);
      }
    }
    const uniquePointPlacements = dedupePlacementsByPosition(pointPlacements);
    if (pointPlacements.length > uniquePointPlacements.length) {
      const skipped = pointPlacements.length - uniquePointPlacements.length;
      holeDebugLog('[HoleFeature] Skipping duplicate coincident hole points:', skipped);
    }

    const hasPoints = uniquePointPlacements.length > 0;
    const normal = normalFromSketch(sketch); // keep hole axis perpendicular to the sketch plane
    const center = centerFromObject(sketch);

    const holeType = String(params.holeType || 'SIMPLE').toUpperCase();
    const clearanceFit = String(params.clearanceFit || 'NONE').toUpperCase();
    const clearanceStandard = String(params.clearanceStandard || params.threadStandard || 'ISO_METRIC').toUpperCase();
    const clearanceDesignation = String(params.clearanceDesignation || '').trim();
    const diameterManual = Math.max(0, Number(params.diameter) || 0);
    const straightDepthInput = Math.max(0, Number(params.depth) || 0);
    const throughAll = params.throughAll === true;
    const sinkDia = Math.max(0, Number(params.countersinkDiameter) || 0);
    const sinkAngle = Math.max(1, Math.min(179, Number(params.countersinkAngle) || 82));
    const boreDia = Math.max(0, Number(params.counterboreDiameter) || 0);
    const boreDepth = Math.max(0, Number(params.counterboreDepth) || 0);
    const threaded = String(params.holeType || '').toUpperCase() === 'THREADED';
    const threadStandard = String(params.threadStandard || 'NONE').toUpperCase();
    const threadDesignation = String(params.threadDesignation || params.threadSize || '').trim();
    const threadMode = String(params.threadMode || 'SYMBOLIC').toUpperCase();
    const threadRadialOffset = Number(params.threadRadialOffset ?? 0);
    let threadGeom = null;
    if (threaded && threadStandard !== 'NONE' && threadDesignation) {
      try {
        threadGeom = parseThreadGeometry({
          standard: threadStandard,
          designation: threadDesignation,
          isExternal: false,
        });
      } catch (err) {
        console.warn('[HoleFeature] Thread parse failed:', err);
      }
    }
    const threadUnitScale = threadGeom && threadGeom.units === 'inch' ? 25.4 : 1;
    let clearanceDia = null;
    if (!threaded && clearanceFit !== 'NONE') {
      const lookupDesig = clearanceDesignation || threadDesignation;
      clearanceDia = getClearanceDiameter({
        standard: clearanceStandard,
        designation: lookupDesig,
        fit: clearanceFit,
      });
    }

    const effectiveDiameter = clearanceDia || diameterManual;

    const radius = Math.max(
      1e-4,
      threadGeom ? (threadGeom.crestDiameter * threadUnitScale * 0.5 + threadRadialOffset) : effectiveDiameter * 0.5,
    );
    const debugShowSolid = params.debugShowSolid === true;

    let booleanParam = params.boolean || { targets: [], operation: 'SUBTRACT' };
    const rawTargets = Array.isArray(booleanParam.targets) ? booleanParam.targets : [];
    const filteredTargets = rawTargets.filter((t) => sceneSolids.includes(t));
    if (!filteredTargets.length) {
      const sketchParent = (sketch && sceneSolids.includes(sketch.parent)) ? sketch.parent : null;
      const firstParent = selectionRaw[0] && sceneSolids.includes(selectionRaw[0].parent)
        ? selectionRaw[0].parent
        : null;
      const candidate = sketchParent || firstParent || null;
      if (candidate) {
        booleanParam = { ...booleanParam, targets: [candidate], operation: booleanParam.operation || 'SUBTRACT' };
      } else if (sceneSolids.length) {
        const nearest = chooseNearestSolid(sceneSolids, center);
        if (nearest) booleanParam = { ...booleanParam, targets: [nearest], operation: booleanParam.operation || 'SUBTRACT' };
      }
    } else {
      booleanParam = { ...booleanParam, targets: filteredTargets };
    }
    if (booleanParam && typeof booleanParam.operation === 'string') {
      booleanParam = { ...booleanParam, operation: String(booleanParam.operation).toUpperCase() };
    }
    const primaryTarget = (booleanParam.targets && booleanParam.targets[0])
      || (sketch && sceneSolids.includes(sketch.parent) ? sketch.parent : null)
      || chooseNearestSolid(sceneSolids, center)
      || null;
    if (primaryTarget) {
      // Choose the normal direction that points into the target solid.
      try {
        const box = new THREE.Box3().setFromObject(primaryTarget);
        const toCenter = box.clampPoint(center, new THREE.Vector3()).sub(center);
        if (toCenter.lengthSq() < 1e-12) {
          toCenter.copy(box.getCenter(new THREE.Vector3()).sub(center));
        }
        if (toCenter.lengthSq() > 1e-10 && normal.dot(toCenter) < 0) {
          normal.multiplyScalar(-1);
        }
      } catch {
        /* ignore orientation flip issues */
      }
    }
    const diag = primaryTarget ? boxDiagonalLength(primaryTarget) : boxDiagonalLength(chooseNearestSolid(sceneSolids, center));
    const straightDepth = throughAll ? Math.max(straightDepthInput, diag || 50) : straightDepthInput;

    const res = 48;
    const backOffset = 0;
    const centers = hasPoints ? uniquePointPlacements.map((entry) => entry.position) : [center];
    const sourceNames = hasPoints ? uniquePointPlacements.map((entry) => entry?.pointObj?.name || entry?.pointObj?.uuid || null) : [null];
    const tools = [];
    const coreTools = [];
    const threadTools = [];
    const otherTools = [];
    const holeRecords = [];
    const debugToolSolids = [];
    centers.forEach((c, idx) => {
      const pointName = sourceNames[idx] || null;
      const holeFacePrefix = pointName || (featureID ? `${featureID}_${idx}` : `HOLE_${idx}`);
      const basePos = (c || center).clone();
      const localThroughDepth = throughAll && primaryTarget
        ? boxExitDistanceAlongDirection(primaryTarget, basePos, normal)
        : 0;
      const depthForHole = throughAll
        ? Math.max(straightDepthInput, localThroughDepth || straightDepth)
        : straightDepth;
      const { solids: toolSolids, descriptors } = makeHoleTool({
        holeType,
        radius,
        straightDepthTotal: depthForHole,
        sinkDia,
        sinkAngle,
        boreDia,
        boreDepth,
        res,
        featureID: holeFacePrefix,
        omitStraight: threaded,
      });
      // annotate faces with hole metadata before union so labels propagate
      const descriptor = descriptors[0] || null;
      const originPos = basePos.clone().addScaledVector(normal, -backOffset);
      if (descriptor) {
        if (holeType === 'THREADED') descriptor.type = 'THREADED';
        descriptor.center = [originPos.x, originPos.y, originPos.z];
        descriptor.normal = [normal.x, normal.y, normal.z];
        descriptor.throughAll = throughAll;
        descriptor.targetId = primaryTarget?.uuid || primaryTarget?.id || primaryTarget?.name || null;
        descriptor.featureId = featureID || null;
        descriptor.sourceName = sourceNames[idx] || null;
        for (const solid of toolSolids) {
          if (!solid || !solid.name) continue;
          const sideName = `${solid.name}_S`;
          try { solid.setFaceMetadata(sideName, { hole: { ...descriptor } }); } catch { }
        }
      }

      if (threadGeom) {
        try {
          const axialBlend = 1e-4;
          let threadLength = Math.max(
            0,
            descriptor?.straightDepth ?? descriptor?.totalDepth ?? straightDepth,
          );
          let threadStart = 0;
          if (descriptor?.type === 'COUNTERSINK') threadStart = descriptor.countersinkHeight || 0;
          else if (descriptor?.type === 'COUNTERBORE') threadStart = descriptor.counterboreDepth || 0;
          threadStart = Math.max(0, threadStart - axialBlend);
          threadLength = Math.max(0, threadLength + axialBlend);
          if (threadLength > 0) {
            holeDebugLog('[HoleFeature] Generating thread:', {
              mode: threadMode,
              length: threadLength,
              threadStart,
              majorDiameter: threadGeom.majorDiameter,
              minorDiameter: threadGeom.minorDiameter,
              crestRadius: threadGeom.crestRadius,
              rootRadius: threadGeom.rootRadius,
              pitch: threadGeom.pitch,
              isExternal: threadGeom.isExternal,
              radialOffset: threadRadialOffset,
            });
            // Scale the thread geometry to millimeters if needed
            let threadGeomScaled = threadGeom;
            if (threadUnitScale !== 1) {
              holeDebugLog('[HoleFeature] Creating scaled thread geometry with scale factor', threadUnitScale);
              // Create a new ThreadGeometry with scaled dimensions
              threadGeomScaled = new ThreadGeometry({
                standard: threadGeom.standard,
                nominalDiameter: threadGeom.nominalDiameter * threadUnitScale,
                pitch: threadGeom.pitch * threadUnitScale,
                isExternal: threadGeom.isExternal,
                starts: threadGeom.starts,
                taperDirection: threadGeom.taperDirection,
              });
            }
            // Extend modeled cutters enough to avoid end flats without doubling boolean work.
            const extraThreadLength = 0;
            const threadStartEffective = threadMode === 'MODELED'
              ? threadStart - extraThreadLength
              : threadStart;
            const threadLengthEffective = threadMode === 'MODELED'
              ? Math.max(0, threadLength + extraThreadLength * 2)
              : threadLength;
            const threadCutFaceName = `${holeFacePrefix}_THREAD_FACE`;

            const threadSolid = threadGeomScaled.toSolid({
              length: threadLengthEffective,
              mode: threadMode === 'MODELED' ? 'modeled' : 'symbolic',
              radialOffset: threadRadialOffset,
              symbolicRadius: 'crest',
              includeCore: false,
              resolution: res,
              segmentsPerTurn: params.threadSegmentsPerTurn,
              name: `${holeFacePrefix}_THREAD`,
              faceName: threadCutFaceName,
              axis: [0, 1, 0],
              origin: [0, threadStartEffective, 0],
              xDirection: [1, 0, 0],
            });
            const canonicalCoreFaceName = `${holeFacePrefix}_THREAD_CORE`;
            if (threadMode === 'MODELED') {
              try {
                if (descriptor) {
                  const threadFaceNames = typeof threadSolid.getFaceNames === 'function' ? threadSolid.getFaceNames() : [];
                  for (const faceName of threadFaceNames) {
                    if (String(faceName || '').startsWith(threadCutFaceName)) {
                      threadSolid.setFaceMetadata(faceName, { hole: { ...descriptor } });
                    }
                  }
                }
              } catch {
                /* best-effort */
              }
            }
            holeDebugLog('[HoleFeature] Thread solid created:', {
              type: threadSolid?.constructor?.name,
              faceCount: threadSolid?.faces?.size,
            });
            
            // Symbolic threads still need a separate minor-diameter core cutter.
            const minorRadiusAt = (z) => {
              try {
                const d = typeof threadGeomScaled.diametersAtZ === 'function'
                  ? threadGeomScaled.diametersAtZ(z)
                  : null;
                const minorDia = Number(d?.minor ?? threadGeomScaled.minorDiameter ?? threadGeomScaled.crestDiameter);
                if (Number.isFinite(minorDia) && minorDia > 0) {
                  return Math.max(1e-4, minorDia * 0.5 + threadRadialOffset);
                }
              } catch { /* ignore */ }
              return Math.max(1e-4, threadGeomScaled.crestRadius + threadRadialOffset);
            };
            const coreR0 = minorRadiusAt(0);
            const coreR1 = minorRadiusAt(threadLengthEffective);
            const coreName = `${holeFacePrefix}_THREAD_CORE`;
            const coreResolution = res;
            const coreHeight = threadLengthEffective;
            if (coreHeight > 0 && threadMode !== 'MODELED') {
              const coreSolid = threadGeomScaled.isTapered && Math.abs(coreR0 - coreR1) > 1e-6
                ? new BREP.Cone({
                  r1: coreR0,
                  r2: coreR1,
                  h: coreHeight,
                  resolution: coreResolution,
                  name: coreName,
                })
                : new BREP.Cylinder({
                  radius: coreR0,
                  height: coreHeight,
                  resolution: coreResolution,
                  name: coreName,
                });
              coreSolid.bakeTRS({
                position: [0, threadStartEffective, 0],
                rotationEuler: [0, 0, 0],
                scale: [1, 1, 1],
              });
              if (descriptor) {
                try { coreSolid.setFaceMetadata(`${coreName}_S`, { hole: { ...descriptor } }); } catch { /* best-effort */ }
              }
              coreSolid.userData = { ...(coreSolid.userData || {}), holeToolRole: 'core' };
              if (threadMode === 'MODELED') {
                try {
                  const coreFaces = typeof coreSolid.getFaceNames === 'function' ? coreSolid.getFaceNames() : [];
                  for (const coreFaceName of coreFaces) {
                    if (!coreFaceName || coreFaceName === canonicalCoreFaceName) continue;
                    coreSolid.renameFace(coreFaceName, canonicalCoreFaceName);
                  }
                  if (descriptor) {
                    coreSolid.setFaceMetadata(canonicalCoreFaceName, { hole: { ...descriptor } });
                  }
                } catch {
                  /* best-effort */
                }
              }
              toolSolids.push(coreSolid);
            }
            
            threadSolid.userData = { ...(threadSolid.userData || {}), holeToolRole: threadMode === 'MODELED' ? 'thread' : 'core' };
            toolSolids.push(threadSolid);
            
            if (descriptor) {
              descriptor.thread = {
                standard: threadStandard,
                designation: threadDesignation,
                series: threadGeom?.series || null,
                mode: threadMode,
                radialOffset: threadRadialOffset,
                length: threadLengthEffective,
                startOffset: threadStartEffective,
              };
            }
          }
        } catch (threadErr) {
          console.warn('[HoleFeature] Thread generation failed:', threadErr);
        }
      }

      if (descriptor) {
        holeRecords.push({ ...descriptor });
      }

      holeDebugLog('[HoleFeature] Preparing', toolSolids.length, 'tool solids for hole');
      const basis = buildBasisFromNormal(normal);
      basis.setPosition(originPos);
      for (const solid of toolSolids) {
        try { solid.bakeTransform(basis); }
        catch (error) { console.warn('[HoleFeature] Failed to transform tool solid:', error); }
      }
      // add centerline for PMI/visualization
      const totalDepth = descriptor?.totalDepth || straightDepth || 1;
      const start = originPos;
      const end = start.clone().add(normal.clone().multiplyScalar(totalDepth));
      try {
        toolSolids[0]?.addCenterline?.([start.x, start.y, start.z], [end.x, end.y, end.z], featureID ? `${featureID}_AXIS_${idx}` : `HOLE_AXIS_${idx}`, { materialKey: 'OVERLAY' });
      } catch { /* best-effort */ }
      if (debugShowSolid) {
        try {
          const tool = unionSolids(toolSolids);
          if (!tool) return;
          const debugTool = typeof tool.clone === 'function' ? tool.clone() : tool;
          debugTool.name = `${holeFacePrefix}_DEBUG_TOOL`;
          debugTool.userData = {
            ...(debugTool.userData || {}),
            isDebugVisualization: true,
            isHoleDebugTool: true,
            sourceHoleName: holeFacePrefix,
          };
          debugToolSolids.push(debugTool);
        } catch (err) {
          console.warn('[HoleFeature] Failed to create debug tool solid:', err);
        }
      }
      for (const solid of toolSolids.filter(Boolean)) {
        tools.push(solid);
        const role = String(solid?.userData?.holeToolRole || '').toLowerCase();
        if (role === 'core') coreTools.push(solid);
        else if (role === 'thread') threadTools.push(solid);
        else otherTools.push(solid);
      }
    });

    if (!tools.length) throw new Error('HoleFeature could not build cutting tool geometry.');
    const useSequentialSubtract = threadTools.length > 0;
    const subtractTools = useSequentialSubtract
      ? [...otherTools, ...threadTools, ...coreTools]
      : tools;
    const effects = String(booleanParam?.operation || '').toUpperCase() === 'SUBTRACT'
      ? (useSequentialSubtract
        ? await subtractHoleToolsSequentially(partHistory || {}, subtractTools, booleanParam, featureID)
        : await subtractHoleToolGroupsTogether(partHistory || {}, [otherTools, coreTools, threadTools], booleanParam, featureID))
      : await BREP.applyBooleanOperation(
        partHistory || {},
        tools.length === 1 ? tools[0] : unionSolids(tools),
        booleanParam,
        featureID,
      );
    try { this.persistentData.holes = holeRecords; } catch { }

    if (debugShowSolid && debugToolSolids.length > 0) {
      effects.added = [
        ...(Array.isArray(effects.added) ? effects.added : []),
        ...debugToolSolids,
      ];
    }
    
    return effects;
  }
}

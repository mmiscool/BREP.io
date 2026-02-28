import { BREP } from "../../BREP/BREP.js";
import { getEdgePolylineWorld } from "../../BREP/edgePolylineUtils.js";
import { selectionHasSketch } from "../selectionUtils.js";

function cloneLoopPoints(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const pt of points) {
    if (!Array.isArray(pt) || pt.length < 3) continue;
    out.push([Number(pt[0]) || 0, Number(pt[1]) || 0, Number(pt[2]) || 0]);
  }
  return out;
}

function buildFaceFromProfileGroup(sourceFace, group, islandIndex, islandEdges = []) {
  const THREE = BREP.THREE;
  const contour2D = Array.isArray(group?.contour2D) ? group.contour2D : [];
  const holes2D = Array.isArray(group?.holes2D) ? group.holes2D : [];
  const contourW = cloneLoopPoints(group?.contourW);
  const holesW = holes2D.map((_, idx) => cloneLoopPoints(group?.holesW?.[idx]));
  if (contour2D.length < 3 || contourW.length !== contour2D.length) return null;
  if (holesW.some((loop, idx) => loop.length !== (holes2D[idx]?.length || 0))) return null;

  const contourV2 = contour2D.map((pt) => new THREE.Vector2(Number(pt?.[0]) || 0, Number(pt?.[1]) || 0));
  const holesV2 = holes2D.map((loop) => loop.map((pt) => new THREE.Vector2(Number(pt?.[0]) || 0, Number(pt?.[1]) || 0)));
  const tris = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);
  if (!Array.isArray(tris) || !tris.length) return null;

  const allWorld = contourW.concat(...holesW);
  const triPositions = [];
  for (const tri of tris) {
    const a = allWorld[tri[0]];
    const b = allWorld[tri[1]];
    const c = allWorld[tri[2]];
    if (!a || !b || !c) continue;
    triPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  if (triPositions.length < 9) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();

  const islandFace = new BREP.Face(geom);
  islandFace.name = `${sourceFace?.name || 'PROFILE'}:ISLAND_${islandIndex + 1}`;
  const clonedGroup = {
    contour2D: contour2D.map((pt) => [Number(pt?.[0]) || 0, Number(pt?.[1]) || 0]),
    holes2D: holes2D.map((loop) => loop.map((pt) => [Number(pt?.[0]) || 0, Number(pt?.[1]) || 0])),
    contourW: contourW.map((pt) => pt.slice()),
    holesW: holesW.map((loop) => loop.map((pt) => pt.slice())),
  };
  islandFace.userData = {
    ...(sourceFace?.userData || {}),
    faceName: islandFace.name,
    boundaryLoopsWorld: [
      { pts: contourW.map((pt) => pt.slice()), isHole: false },
      ...holesW.map((loop) => ({ pts: loop.map((pt) => pt.slice()), isHole: true })),
    ],
    profileGroups: [clonedGroup],
  };
  islandFace.edges = Array.isArray(islandEdges) ? islandEdges.slice() : [];
  return islandFace;
}

function keyPoint(p, q = 1e-5) {
  return `${Math.round((Number(p?.[0]) || 0) / q)},${Math.round((Number(p?.[1]) || 0) / q)},${Math.round((Number(p?.[2]) || 0) / q)}`;
}

function collectIslandEdges(sourceFace, group, quant = 1e-5) {
  const loops = [];
  if (Array.isArray(group?.contourW)) loops.push(cloneLoopPoints(group.contourW));
  if (Array.isArray(group?.holesW)) {
    for (const hole of group.holesW) loops.push(cloneLoopPoints(hole));
  }
  const ptKeys = new Set();
  for (const loop of loops) {
    for (const p of loop) ptKeys.add(keyPoint(p, quant));
  }
  if (!ptKeys.size) return [];

  const sourceEdges = Array.isArray(sourceFace?.edges) ? sourceFace.edges : [];
  const matched = [];
  const seen = new Set();
  for (const edge of sourceEdges) {
    const poly = getEdgePolylineWorld(edge, { dedupe: true, eps: quant * 0.5 });
    if (!Array.isArray(poly) || poly.length < 2) continue;
    const firstIn = ptKeys.has(keyPoint(poly[0], quant));
    const lastIn = ptKeys.has(keyPoint(poly[poly.length - 1], quant));
    let segHit = false;
    for (let i = 0; i < poly.length - 1; i++) {
      if (ptKeys.has(keyPoint(poly[i], quant)) && ptKeys.has(keyPoint(poly[i + 1], quant))) {
        segHit = true;
        break;
      }
    }
    if (!(segHit || (firstIn && lastIn))) continue;
    const edgeKey = edge?.name || edge?.userData?.edgeName || edge?.id || edge?.uuid;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    matched.push(edge);
  }
  return matched;
}

function splitProfileFaceByIslands(faceObj) {
  const groups = Array.isArray(faceObj?.userData?.profileGroups)
    ? faceObj.userData.profileGroups.filter((group) => Array.isArray(group?.contourW) && group.contourW.length >= 3)
    : [];
  if (groups.length <= 1) return [faceObj];

  const edgeGroups = groups.map((group) => collectIslandEdges(faceObj, group));
  const faces = groups
    .map((group, idx) => buildFaceFromProfileGroup(faceObj, group, idx, edgeGroups[idx]))
    .filter(Boolean);
  if (faces.length !== groups.length || faces.length <= 1) return [faceObj];
  return faces;
}

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "unique identifier for the sweep feature",
  },
  profile: {
    type: "reference_selection",
    selectionFilter: ["SKETCH", "FACE"],
    multiple: false,
    default_value: null,
    hint: "Select the profile to sweep",
  },
  consumeProfileSketch: {
    type: "boolean",
    default_value: true,
    hint: "Remove the referenced sketch after creating the sweep. Turn off to keep it in the scene.",
  },
  path: {
    type: "reference_selection",
    selectionFilter: ["EDGE"],
    multiple: true,
    default_value: null,
    hint: "Select one or more edges to define the sweep path (connected edges are chained)",
  },
  orientationMode: {
    type: "options",
    options: ["translate", "pathAlign"],
    default_value: "translate",
    hint: "Sweep orientation mode: 'translate' (fixed) or 'pathAlign' (profile aligns and rotates with path)",
  },
  twistAngle: {
    type: "number",
    default_value: 0,
    hint: "Twist angle for the sweep",
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: 'NONE' },
    hint: "Optional boolean operation with selected solids"
  }
};

export class SweepFeature {
  static shortName = "SW";
  static longName = "Sweep";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const profileObj = items.find((it) => {
      const type = String(it?.type || '').toUpperCase();
      return type === 'FACE' || type === 'SKETCH';
    });
    if (!profileObj) return false;
    const profileName = profileObj?.name || profileObj?.userData?.faceName || null;
    if (!profileName) return false;
    const edges = items
      .filter((it) => String(it?.type || '').toUpperCase() === 'EDGE')
      .map((it) => it?.name || it?.userData?.edgeName)
      .filter((name) => !!name);
    const params = { profile: profileName };
    if (edges.length) params.path = edges;
    return { params };
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
    // actual code to create the sweep feature.
    const { profile, path, twistAngle, orientationMode } = this.inputParams;

    // Require a valid path edge; sweep now only follows a path
    const pathArr = Array.isArray(path) ? path.filter(Boolean) : (path ? [path] : []);
    if (!pathArr.length) {
      throw new Error('Sweep requires a path edge selection. Please select an EDGE to sweep along.');
    }

    // Resolve profile object: accept FACE or SKETCH group object
    const obj = Array.isArray(profile) ? (profile[0] || null) : (profile || null);
    let faceObj = obj;
    if (obj && obj.type === 'SKETCH') {
      faceObj = obj.children.find(ch => ch.type === 'FACE') || obj.children.find(ch => ch.userData?.faceName);
    }

    const removed = [];
    // if the face is a child of a sketch we need to remove the sketch from the scene
    const consumeSketch = this.inputParams?.consumeProfileSketch !== false;
    if (consumeSketch && faceObj && faceObj.type === 'FACE' && faceObj.parent && faceObj.parent.type === 'SKETCH') {
      removed.push(faceObj.parent);
    }

    const twistAngleNum = Number(twistAngle);

    const mode = (orientationMode === 'pathAlign') ? 'pathAlign' : 'translate';
    const profileFaces = splitProfileFaceByIslands(faceObj);
    this.persistentData.profileIslandCount = profileFaces.length;
    this.persistentData.profileIslandEdgeCounts = profileFaces.map((f) => Array.isArray(f?.edges) ? f.edges.length : 0);

    const sweeps = [];
    for (let i = 0; i < profileFaces.length; i++) {
      const islandFace = profileFaces[i];
      const sweepName = (profileFaces.length > 1)
        ? `${this.inputParams.featureID}:I${i + 1}`
        : this.inputParams.featureID;
      const islandSweep = new BREP.Sweep({
        face: islandFace,
        sweepPathEdges: pathArr,
        mode,
        twistAngle: Number.isFinite(twistAngleNum) ? twistAngleNum : 0,
        name: sweepName
      });
      islandSweep.collapseTinyTriangles(0.1);
      islandSweep.simplify(0.1);
      sweeps.push(islandSweep);
    }
    if (!sweeps.length) {
      throw new Error('Sweep failed to build profile islands for sweeping.');
    }

    let sweep = sweeps[0];
    for (let i = 1; i < sweeps.length; i++) {
      sweep = sweep.union(sweeps[i]);
    }
    sweep.name = this.inputParams.featureID || sweep.name;
    if (this.inputParams.featureID) {
      sweep.owningFeatureID = this.inputParams.featureID;
    }

    // Build and show the final solid.
    sweep.visualize();

    // Apply optional boolean operation via shared helper
    const effects = await BREP.applyBooleanOperation(partHistory || {}, sweep, this.inputParams.boolean, this.inputParams.featureID);
    effects.removed = [...removed, ...effects.removed];
    return effects;
  }
}

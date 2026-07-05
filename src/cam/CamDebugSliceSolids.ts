import * as THREE from 'three';
import { Solid } from '../BREP/BetterSolid.js';
import { SelectionFilter } from '../UI/SelectionFilter.js';
import {
  ensureCounterClockwise,
  pointInPolygon,
  polygonArea,
  roundCoord,
  simplifyLoop,
  type CamPoint2,
} from './ShadowCutterEntity.js';
import type { CamPoint3, CamToolpathProgram } from './CamToolpathDefinition.js';

type AnyRecord = Record<string, any>;

export const CAM_DEBUG_SLICE_SOLID_KIND = 'cam-debug-slice-solid';

function finiteNumber(value: any, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeLoopPoints(rawPoints: any): CamPoint2[] {
  if (!Array.isArray(rawPoints)) return [];
  const points: CamPoint2[] = [];
  for (const rawPoint of rawPoints) {
    if (!Array.isArray(rawPoint) || rawPoint.length < 2) continue;
    const x = Number(rawPoint[0]);
    const y = Number(rawPoint[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([roundCoord(x), roundCoord(y)]);
  }
  const simplified = simplifyLoop(points);
  return simplified.length >= 3 && Math.abs(polygonArea(simplified)) > 1e-7 ? simplified : [];
}

function normalizeOuterLoop(rawPoints: any): CamPoint2[] {
  return ensureCounterClockwise(normalizeLoopPoints(rawPoints));
}

function normalizeHoleLoop(rawPoints: any): CamPoint2[] {
  return ensureCounterClockwise(normalizeLoopPoints(rawPoints)).reverse();
}

function toScenePoint(point: CamPoint2, z: number): CamPoint3 {
  return [roundCoord(point[0]), roundCoord(z), roundCoord(point[1])];
}

function normalForTriangle(a: CamPoint3, b: CamPoint3, c: CamPoint3): CamPoint3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return [
    (uy * vz) - (uz * vy),
    (uz * vx) - (ux * vz),
    (ux * vy) - (uy * vx),
  ];
}

function dot3(a: CamPoint3, b: CamPoint3) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function addTriangleFacing(solid: Solid, faceName: string, a: CamPoint3, b: CamPoint3, c: CamPoint3, desiredNormal: CamPoint3) {
  const normal = normalForTriangle(a, b, c);
  if (dot3(normal, desiredNormal) < 0) solid.addTriangle(faceName, a, c, b);
  else solid.addTriangle(faceName, a, b, c);
}

function vector2Loop(points: CamPoint2[]) {
  return points.map((point) => new THREE.Vector2(point[0], point[1]));
}

function buildSliceComponent({
  solid,
  outer,
  holes,
  bottomZ,
  topZ,
  facePrefix,
}: {
  solid: Solid;
  outer: CamPoint2[];
  holes: CamPoint2[][];
  bottomZ: number;
  topZ: number;
  facePrefix: string;
}) {
  const vertices = outer.concat(...holes);
  const topFace = `${facePrefix}_TOP`;
  const bottomFace = `${facePrefix}_BOTTOM`;
  const topNormal: CamPoint3 = [0, 1, 0];
  const bottomNormal: CamPoint3 = [0, -1, 0];
  const faces = THREE.ShapeUtils.triangulateShape(vector2Loop(outer), holes.map(vector2Loop));

  for (const face of faces) {
    const points = face.map((index) => vertices[index]).filter(Boolean);
    if (points.length !== 3) continue;
    addTriangleFacing(
      solid,
      topFace,
      toScenePoint(points[0], topZ),
      toScenePoint(points[1], topZ),
      toScenePoint(points[2], topZ),
      topNormal,
    );
    addTriangleFacing(
      solid,
      bottomFace,
      toScenePoint(points[0], bottomZ),
      toScenePoint(points[1], bottomZ),
      toScenePoint(points[2], bottomZ),
      bottomNormal,
    );
  }

  const addWall = (loop: CamPoint2[], label: string) => {
    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index];
      const b = loop[(index + 1) % loop.length];
      const desiredNormal: CamPoint3 = [roundCoord(b[1] - a[1]), 0, roundCoord(a[0] - b[0])];
      const bottomA = toScenePoint(a, bottomZ);
      const bottomB = toScenePoint(b, bottomZ);
      const topA = toScenePoint(a, topZ);
      const topB = toScenePoint(b, topZ);
      const faceName = `${label}_${index + 1}`;
      addTriangleFacing(solid, faceName, bottomA, topB, bottomB, desiredNormal);
      addTriangleFacing(solid, faceName, bottomA, topA, topB, desiredNormal);
    }
  };

  addWall(outer, `${facePrefix}_OUTER`);
  holes.forEach((hole, index) => addWall(hole, `${facePrefix}_HOLE_${index + 1}`));
}

export function buildCamDebugSliceSolid(slice: AnyRecord = {}, options: AnyRecord = {}) {
  const rawLoops = Array.isArray(slice.loops) ? slice.loops : [];
  const outerLoops = rawLoops
    .filter((loop: AnyRecord) => loop?.role !== 'hole')
    .map((loop: AnyRecord) => normalizeOuterLoop(loop?.points))
    .filter((loop: CamPoint2[]) => loop.length >= 3);
  const holeLoops = rawLoops
    .filter((loop: AnyRecord) => loop?.role === 'hole')
    .map((loop: AnyRecord) => normalizeHoleLoop(loop?.points))
    .filter((loop: CamPoint2[]) => loop.length >= 3);
  if (!outerLoops.length) return null;

  const bottomZ = finiteNumber(slice.bottomZ, 0);
  const topZ = finiteNumber(slice.topZ, bottomZ);
  if (Math.abs(topZ - bottomZ) <= 1e-7) return null;

  const index = Math.max(1, Math.round(finiteNumber(slice.index, options.sliceIndex || 1)));
  const operationId = String(options.operationId || slice.operationId || 'CAM');
  const solid = new Solid();
  solid.name = `${operationId} Debug Slice ${index}`;
  solid.userData = {
    ...(solid.userData || {}),
    isCamDebugSliceSolid: true,
    camDebugKind: CAM_DEBUG_SLICE_SOLID_KIND,
    operationId,
    operationName: options.operationName || slice.operationName || '',
    sliceIndex: index,
    topZ: roundCoord(topZ),
    bottomZ: roundCoord(bottomZ),
  };

  outerLoops.forEach((outer, outerIndex) => {
    const holes = holeLoops.filter((hole) => hole[0] && pointInPolygon(hole[0], outer));
    buildSliceComponent({
      solid,
      outer,
      holes,
      bottomZ,
      topZ,
      facePrefix: `${solid.name}_SHELL_${outerIndex + 1}`,
    });
  });

  if (!solid._triVerts?.length) return null;
  return solid;
}

function styleDebugSolid(solid: any, sliceIndex: number) {
  const color = new THREE.Color().setHSL((sliceIndex * 0.13) % 1, 0.74, 0.58);
  solid.traverse?.((object: any) => {
    const material = object?.material;
    if (!material) return;
    const apply = (entry: any) => {
      if (!entry || typeof entry !== 'object') return;
      try { if (entry.color?.set) entry.color.set(color); } catch { /* ignore material color failures */ }
      try { entry.transparent = true; } catch { /* ignore material transparency failures */ }
      try { entry.opacity = 0.28; } catch { /* ignore material opacity failures */ }
      try { entry.depthWrite = false; } catch { /* ignore material depth failures */ }
      try { entry.needsUpdate = true; } catch { /* ignore material update failures */ }
    };
    if (Array.isArray(material)) material.forEach(apply);
    else apply(material);
  });
}

function disposeObjectTree(object: any) {
  if (!object) return;
  const children = Array.isArray(object.children) ? object.children.slice() : [];
  for (const child of children) disposeObjectTree(child);
  try { object.parent?.remove?.(object); } catch { /* ignore detach failures */ }
  try { object.free?.(); } catch { /* ignore solid cleanup failures */ }
  try { object.geometry?.dispose?.(); } catch { /* ignore geometry cleanup failures */ }
  const material = object.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      try { entry?.dispose?.(); } catch { /* ignore material cleanup failures */ }
    });
  } else {
    try { material?.dispose?.(); } catch { /* ignore material cleanup failures */ }
  }
}

export function clearCamDebugSliceSolids(scene: THREE.Scene | null | undefined, partHistory: AnyRecord | null = null) {
  if (!scene?.traverse) return 0;
  const targets: any[] = [];
  scene.traverse((object: any) => {
    if (object?.userData?.isCamDebugSliceSolid === true || object?.userData?.camDebugKind === CAM_DEBUG_SLICE_SOLID_KIND) {
      targets.push(object);
    }
  });
  for (const target of targets) {
    const name = String(target?.name || '');
    if (name) {
      try { partHistory?.metadataManager?.clearMetadata?.(name); } catch { /* ignore metadata cleanup failures */ }
    }
    disposeObjectTree(target);
  }
  return targets.length;
}

export function syncCamDebugSliceSolids({
  program,
  scene,
  partHistory = null,
}: {
  program?: CamToolpathProgram | null;
  scene?: THREE.Scene | null;
  partHistory?: AnyRecord | null;
}) {
  clearCamDebugSliceSolids(scene, partHistory);
  const debugSlices = Array.isArray(program?.metadata?.debugSlices) ? program?.metadata?.debugSlices : [];
  if (!scene || !debugSlices.length) return [];
  const solids = debugSlices
    .map((slice: AnyRecord, index: number) => buildCamDebugSliceSolid(slice, {
      sliceIndex: index + 1,
      operationId: slice.operationId || program?.operationId,
      operationName: slice.operationName || program?.operationName,
    }))
    .filter(Boolean);
  for (let index = 0; index < solids.length; index += 1) {
    const solid: any = solids[index];
    try { solid.visualize?.({ showEdges: true }); } catch { /* ignore visualize failures */ }
    styleDebugSolid(solid, index + 1);
    try { scene.add(solid); } catch { /* ignore scene add failures */ }
    try { SelectionFilter.ensureSelectionHandlers?.(solid, { deep: true }); } catch { /* ignore selection setup failures */ }
    try {
      partHistory?.metadataManager?.setMetadataObject?.(solid.name, {
        camDebugSlice: true,
        camDebugKind: CAM_DEBUG_SLICE_SOLID_KIND,
        operationId: solid.userData?.operationId || '',
        sliceIndex: solid.userData?.sliceIndex || index + 1,
        color: `#${new THREE.Color().setHSL(((index + 1) * 0.13) % 1, 0.74, 0.58).getHexString()}`,
      });
    } catch { /* ignore metadata setup failures */ }
  }
  try { partHistory?.markModelChanged?.('cam-debug-slices'); } catch { /* ignore model revision update failures */ }
  return solids;
}

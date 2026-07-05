import ClipperLib from 'clipper-lib';
import { ListEntityBase } from '../core/entities/ListEntityBase.js';
import { normalizeCamMachineProfile, type CamMachineProfile } from './CamMachineProfile.js';
import {
  CAM_TOOLPATH_SCHEMA_VERSION,
  generateGcodeForCamToolpathProgram,
  makeEmptyCamToolpathProgram,
  makeFlatEndMillCutter,
  normalizeCamOrientation,
  roundCamCoord,
  roundCamPoint,
  summarizeCamToolpathProgram,
  type CamBounds,
  type CamCutterDefinition,
  type CamCutterOrientation,
  type CamPoint3,
  type CamToolpathPath,
  type CamToolpathPoint,
  type CamToolpathSegment,
  type CamToolpathProgram,
} from './CamToolpathDefinition.js';

export const CAM_OPERATION_TYPE_SHADOW_CUTTER = 'shadow-cutter';

export type AnyRecord = Record<string, any>;
export type CamPoint2 = [number, number];

export type Triangle = [CamPoint3, CamPoint3, CamPoint3];
export type ShadowLoopRole = 'outer' | 'hole';
export type ShadowLoop = {
  role: ShadowLoopRole;
  points: CamPoint2[];
};

export const EPS = 1e-7;
const CLIPPER_SCALE = 10000;

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this shadow cutter operation.',
  },
  name: {
    type: 'string',
    default_value: 'Shadow Cutter',
    hint: 'Display name for this shadow cutter operation.',
  },
  enabled: {
    type: 'boolean',
    default_value: true,
    hint: 'Include this operation when generating CAM output.',
  },
  targetSolids: {
    type: 'reference_selection',
    selectionFilter: ['SOLID'],
    multiple: true,
    default_value: [],
    hint: 'Solids to project into the top-down shadow. Leave empty to use all visible solids.',
  },
  toolDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Cutter diameter in model units.',
  },
  toolLength: {
    type: 'number',
    default_value: 25,
    hint: 'Cutter cutting length in model units.',
  },
  stockAllowance: {
    type: 'number',
    default_value: 0,
    hint: 'Extra material to leave outside the projected outline. The cutter centerline is offset by tool radius plus this allowance.',
  },
  stepDown: {
    type: 'number',
    default_value: 1,
    hint: 'Maximum Z depth per outline pass.',
  },
  extraDepth: {
    type: 'number',
    default_value: 0,
    hint: 'Additional depth below the projected part bottom for cut-through.',
  },
  safeHeight: {
    type: 'number',
    default_value: 5,
    hint: 'Clearance above the projected part top before and after cutting.',
  },
  feedRate: {
    type: 'number',
    default_value: 800,
    hint: 'Cutting feed rate.',
  },
  plungeRate: {
    type: 'number',
    default_value: 200,
    hint: 'Vertical plunge feed rate.',
  },
  spindleRPM: {
    type: 'number',
    default_value: 12000,
    hint: 'Requested spindle speed.',
  },
};

export class ShadowCutterEntity extends ListEntityBase {
  static entityType = CAM_OPERATION_TYPE_SHADOW_CUTTER;
  static shortName = 'SC';
  static longName = 'Shadow Cutter';
  static inputParamsSchema = inputParamsSchema;

  static uiFieldsTest(context: AnyRecord = {}) {
    const exclude = ['enabled'];
    if (countVisibleSolidsFromContext(context) === 1) exclude.push('targetSolids');
    return { exclude };
  }

  run(context: AnyRecord = {}) {
    return this.generateToolpath(context);
  }

  generateToolpath(context: AnyRecord = {}): CamToolpathProgram {
    const params = this.inputParams || {};
    const machine = normalizeCamMachineProfile(context.machineProfile);
    const operationId = String(params.id || this.id || 'SC');
    const operationName = String(params.name || 'Shadow Cutter');
    const warnings: string[] = [];
    const toolDiameter = positiveNumber(params.toolDiameter, 3.175);
    const toolLength = positiveNumber(params.toolLength, 25);
    const cutter = makeFlatEndMillCutter({
      id: `${operationId}-CUTTER`,
      diameter: toolDiameter,
      cuttingLength: toolLength,
      overallLength: toolLength,
    });
    const toolRadius = toolDiameter * 0.5;
    const stockAllowance = Math.max(0, finiteNumber(params.stockAllowance, 0));
    const offsetDistance = toolRadius + stockAllowance;
    const feedRate = positiveNumber(params.feedRate, 800, 1);
    const plungeRate = positiveNumber(params.plungeRate, 200, 1);
    const stepDown = positiveNumber(params.stepDown, 1, EPS);
    const extraDepth = Math.max(0, finiteNumber(params.extraDepth, 0));
    const spindleRPM = Math.min(
      positiveNumber(params.spindleRPM, 12000, 1),
      Math.max(1, Number(machine.maxSpindleRPM) || 1),
    );

    const viewer = context.viewer || context.partHistory?.viewer || this.history?.partHistory?.viewer || null;
    const partHistory = context.partHistory || viewer?.partHistory || this.history?.partHistory || null;
    const solids = resolveTargetSolids({ viewer, partHistory }, params.targetSolids);
    const triangles: Triangle[] = [];
    let targetCount = 0;
    for (const solid of solids) {
      const solidTriangles = extractTrianglesFromSolid(solid);
      if (!solidTriangles.length) continue;
      targetCount += 1;
      triangles.push(...solidTriangles);
    }

    const targetBounds = triangleBounds(triangles);
    if (!targetBounds) {
      return makeEmptyShadowResult({
        operationId,
        operationName,
        machine,
        cutter,
        toolDiameter,
        spindleRPM,
        warnings: ['No target solids are available for Shadow Cutter generation.'],
      });
    }

    const projectedLoops = projectedShadowLoopsFromTriangles(triangles);
    const shadowLoops = buildShadowLoops(projectedLoops);
    if (!shadowLoops.length) {
      return makeEmptyShadowResult({
        operationId,
        operationName,
        machine,
        targetBounds,
        cutter,
        toolDiameter,
        spindleRPM,
        warnings: ['Projected part shadow does not have enough area to cut.'],
      });
    }
    const rawOffsetLoops = shadowLoops.flatMap((loop) => {
      const distance = loop.role === 'hole' ? -offsetDistance : offsetDistance;
      return offsetPolygon(loop.points, distance)
        .map((points) => ({ role: loop.role, points }));
    }).filter((loop) => loop.points.length >= 3);
    const offsetLoops = mergeOuterOffsetLoops(rawOffsetLoops);
    if (!offsetLoops.length) {
      return makeEmptyShadowResult({
        operationId,
        operationName,
        machine,
        targetBounds,
        cutter,
        toolDiameter,
        spindleRPM,
        warnings: ['Could not offset the projected Shadow Cutter outline.'],
      });
    }

    const topZ = targetBounds.max[2];
    const bottomZ = targetBounds.min[2] - extraDepth;
    const safeHeight = Math.max(0, finiteNumber(params.safeHeight, 5));
    const safeZ = roundCoord(Math.max(Number(machine.safeParkZ) || 0, topZ + safeHeight));
    const levels = buildDepthLevels(topZ, bottomZ, stepDown);
    const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [1, 0, 0] });
    const paths = offsetLoops.map((loop, loopIndex) => makeSteppedLoopPath({
      id: `${operationId}-${loop.role === 'hole' ? 'H' : 'O'}${loopIndex + 1}`,
      operationId,
      operationName,
      loop,
      levels,
      safeZ,
      cutter,
      orientation,
      feedRate,
      plungeRate,
      spindleRPM,
    }));
    const bounds = boundsFromLoopsAndZ(offsetLoops, topZ, bottomZ);
    const resultBase: Omit<CamToolpathProgram, 'gcode'> = {
      schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
      operationId,
      operationName,
      units: 'mm',
      coordinateSystem: 'machine',
      generatedAt: new Date().toISOString(),
      machine,
      bounds,
      targetBounds,
      safeZ,
      cutter,
      spindleRPM,
      paths,
      summary: summarizeCamToolpathProgram({
        paths,
        targetCount,
        triangleCount: triangles.length,
        levelCount: levels.length,
        warningCount: warnings.length,
        outlinePointCount: offsetLoops.reduce((sum, loop) => sum + loop.points.length, 0),
        offsetDistance: roundCoord(offsetDistance),
      }),
      warnings,
      metadata: {
        strategy: 'shadow-cutter',
        loopCount: offsetLoops.length,
        holeLoopCount: offsetLoops.filter((loop) => loop.role === 'hole').length,
        topZ: roundCoord(topZ),
        bottomZ: roundCoord(bottomZ),
      },
    };
    return { ...resultBase, gcode: generateGcodeForCamToolpathProgram(resultBase) };
  }

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

export function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function positiveNumber(value: any, fallback: number, min = EPS) {
  return Math.max(min, Math.abs(finiteNumber(value, fallback)));
}

export function roundCoord(value: number) {
  return roundCamCoord(value);
}

function toRoundedPoint3(point: CamPoint3): CamPoint3 {
  return roundCamPoint(point);
}

function scenePointToMachine(point: CamPoint3): CamPoint3 {
  return [roundCoord(point[0]), roundCoord(point[2]), roundCoord(point[1])];
}

function applyMatrix4(point: CamPoint3, matrix: any): CamPoint3 {
  const e = Array.isArray(matrix?.elements) || ArrayBuffer.isView(matrix?.elements) ? matrix.elements : null;
  if (!e || e.length < 16) return point;
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = (e[3] * x) + (e[7] * y) + (e[11] * z) + e[15];
  const invW = w && Number.isFinite(w) ? 1 / w : 1;
  return [
    ((e[0] * x) + (e[4] * y) + (e[8] * z) + e[12]) * invW,
    ((e[1] * x) + (e[5] * y) + (e[9] * z) + e[13]) * invW,
    ((e[2] * x) + (e[6] * y) + (e[10] * z) + e[14]) * invW,
  ];
}

export function extractTrianglesFromSolid(solid: any): Triangle[] {
  if (!solid) return [];
  const mesh = typeof solid.getMesh === 'function' ? solid.getMesh() : solid.mesh || null;
  if (!mesh) return [];
  try {
    const vertices = mesh.vertProperties || mesh.vertices || mesh.positions || [];
    const indices = mesh.triVerts || mesh.indices || [];
    const matrix = solid.matrixWorld || null;
    const vertexAt = (index: number): CamPoint3 => {
      const base = index * 3;
      const scenePoint: CamPoint3 = [
        Number(vertices[base]),
        Number(vertices[base + 1]),
        Number(vertices[base + 2]),
      ];
      return scenePointToMachine(applyMatrix4(scenePoint, matrix));
    };
    const out: Triangle[] = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const tri: Triangle = [
        vertexAt(Number(indices[i])),
        vertexAt(Number(indices[i + 1])),
        vertexAt(Number(indices[i + 2])),
      ];
      if (tri.every((point) => point.every(Number.isFinite))) out.push(tri);
    }
    return out;
  } finally {
    try { mesh.delete?.(); } catch { /* ignore mesh cleanup failures */ }
  }
}

export function extractTrianglesFromFace(face: any): Triangle[] {
  if (!face) return [];
  const geometry = face.geometry || null;
  const position = typeof geometry?.getAttribute === 'function'
    ? geometry.getAttribute('position')
    : geometry?.attributes?.position || null;
  if (!position || position.itemSize !== 3 || position.count < 3) return [];
  const index = typeof geometry?.getIndex === 'function' ? geometry.getIndex() : geometry?.index || null;
  const matrix = face.matrixWorld || null;
  const vertexAt = (vertexIndex: number): CamPoint3 => {
    const scenePoint: CamPoint3 = [
      Number(position.getX(vertexIndex)),
      Number(position.getY(vertexIndex)),
      Number(position.getZ(vertexIndex)),
    ];
    return scenePointToMachine(applyMatrix4(scenePoint, matrix));
  };
  const out: Triangle[] = [];
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const base = triangleIndex * 3;
    const tri: Triangle = index
      ? [vertexAt(index.getX(base)), vertexAt(index.getX(base + 1)), vertexAt(index.getX(base + 2))]
      : [vertexAt(base), vertexAt(base + 1), vertexAt(base + 2)];
    if (tri.every((point) => point.every(Number.isFinite))) out.push(tri);
  }
  return out;
}

export function collectVisibleSolids(root: any, out: any[] = []) {
  if (!root) return out;
  if ((root.type === 'SOLID' || typeof root.getMesh === 'function') && root.visible !== false) out.push(root);
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) collectVisibleSolids(child, out);
  return out;
}

export function resolveSceneFromContext(context: AnyRecord = {}) {
  const viewer = context.viewer || context.partHistory?.viewer || context.entry?.history?.partHistory?.viewer || null;
  const partHistory = context.partHistory || viewer?.partHistory || context.history?.partHistory || context.entry?.history?.partHistory || null;
  return viewer?.scene || partHistory?.scene || null;
}

export function countVisibleSolidsFromContext(context: AnyRecord = {}) {
  return collectVisibleSolids(resolveSceneFromContext(context), []).length;
}

export function resolveTargetSolids(context: AnyRecord, selection: any = null) {
  const viewer = context.viewer || null;
  const partHistory = context.partHistory || viewer?.partHistory || null;
  const scene = resolveSceneFromContext({ viewer, partHistory });
  const list = Array.isArray(selection) ? selection : (selection ? [selection] : []);
  if (!list.length) return collectVisibleSolids(scene);
  const out: any[] = [];
  for (const item of list) {
    if (item && typeof item === 'object' && (typeof item.getMesh === 'function' || item.type === 'SOLID')) {
      out.push(item);
      continue;
    }
    const name = String(item?.name || item?.id || item || '');
    const resolved = scene?.getObjectByName?.(name) || partHistory?.getObjectByName?.(name) || null;
    if (resolved) out.push(resolved);
  }
  return out;
}

export function triangleBounds(triangles: Triangle[]): CamBounds | null {
  if (!triangles.length) return null;
  const min: CamPoint3 = [Infinity, Infinity, Infinity];
  const max: CamPoint3 = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (const point of triangle) {
      min[0] = Math.min(min[0], point[0]);
      min[1] = Math.min(min[1], point[1]);
      min[2] = Math.min(min[2], point[2]);
      max[0] = Math.max(max[0], point[0]);
      max[1] = Math.max(max[1], point[1]);
      max[2] = Math.max(max[2], point[2]);
    }
  }
  return { min: toRoundedPoint3(min), max: toRoundedPoint3(max) };
}

function point2Key(point: CamPoint2) {
  return `${roundCoord(point[0])},${roundCoord(point[1])}`;
}

export function loopsFromEdges(edges: Array<{ a: CamPoint2; b: CamPoint2 }>) {
  const pointsByKey = new Map<string, CamPoint2>();
  const adjacency = new Map<string, Set<string>>();
  const edgeKeys = new Set<string>();
  const addPoint = (point: CamPoint2) => {
    const key = point2Key(point);
    if (!pointsByKey.has(key)) pointsByKey.set(key, [roundCoord(point[0]), roundCoord(point[1])]);
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return key;
  };
  for (const edge of edges) {
    const a = addPoint(edge.a);
    const b = addPoint(edge.b);
    if (a === b) continue;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
    edgeKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }

  const unused = new Set(edgeKeys);
  const loops: CamPoint2[][] = [];
  const mark = (a: string, b: string) => unused.delete(a < b ? `${a}|${b}` : `${b}|${a}`);
  const hasEdge = (a: string, b: string) => unused.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  while (unused.size) {
    const firstEdge = unused.values().next().value as string;
    const [start, firstNext] = firstEdge.split('|');
    const loopKeys = [start];
    let prev = start;
    let current = firstNext;
    mark(prev, current);
    let guard = 0;
    while (guard < edgeKeys.size + 4) {
      guard += 1;
      if (current === start) break;
      loopKeys.push(current);
      const neighbors = Array.from(adjacency.get(current) || []);
      let next = neighbors.find((candidate) => candidate !== prev && hasEdge(current, candidate));
      if (!next) next = neighbors.find((candidate) => hasEdge(current, candidate));
      if (!next) break;
      mark(current, next);
      prev = current;
      current = next;
    }
    if (current !== start || loopKeys.length < 3) continue;
    const loop = simplifyLoop(loopKeys.map((key) => pointsByKey.get(key)).filter(Boolean) as CamPoint2[]);
    if (Math.abs(polygonArea(loop)) > EPS) loops.push(ensureCounterClockwise(loop));
  }
  return loops;
}

export function projectedShadowLoopsFromTriangles(triangles: Triangle[]) {
  const contours: CamPoint2[][] = [];
  for (const triangle of triangles) {
    let loop: CamPoint2[] = triangle.map((point) => [roundCoord(point[0]), roundCoord(point[1])] as CamPoint2);
    loop = simplifyLoop(loop);
    if (loop.length < 3 || Math.abs(polygonArea(loop)) <= EPS) continue;
    if (polygonArea(loop) < 0) loop = loop.slice().reverse();
    contours.push(loop);
  }
  return unionContoursWithClipper(contours);
}

function unionContoursWithClipper(contours: CamPoint2[][]): CamPoint2[][] {
  const subject = contours
    .map((points) => points.map((point) => ({
      X: Math.round(point[0] * CLIPPER_SCALE),
      Y: Math.round(point[1] * CLIPPER_SCALE),
    })))
    .filter((path) => path.length >= 3);
  if (!subject.length) return [];
  try {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
    const solution: Array<Array<{ X: number; Y: number }>> = [];
    const succeeded = clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      solution,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    if (!succeeded) return [];
    return solution
      .map((path) => simplifyLoop(path.map((point) => [
        roundCoord(point.X / CLIPPER_SCALE),
        roundCoord(point.Y / CLIPPER_SCALE),
      ] as CamPoint2)))
      .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) > EPS);
  } catch {
    return [];
  }
}

export function ensureCounterClockwise(points: CamPoint2[]) {
  return polygonArea(points) < 0 ? points.slice().reverse() : points.slice();
}

export function simplifyLoop(points: CamPoint2[], tol = EPS) {
  let out: CamPoint2[] = [];
  for (const point of points) {
    const next: CamPoint2 = [roundCoord(point[0]), roundCoord(point[1])];
    const previous = out[out.length - 1];
    if (!previous || Math.hypot(next[0] - previous[0], next[1] - previous[1]) > tol) out.push(next);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol) out = out.slice(0, -1);
  }
  let changed = true;
  let guard = 0;
  while (changed && out.length >= 3 && guard < 64) {
    changed = false;
    guard += 1;
    const next: CamPoint2[] = [];
    for (let index = 0; index < out.length; index += 1) {
      const prev = out[(index - 1 + out.length) % out.length];
      const point = out[index];
      const after = out[(index + 1) % out.length];
      const edgeLen = Math.min(Math.hypot(point[0] - prev[0], point[1] - prev[1]), Math.hypot(after[0] - point[0], after[1] - point[1]));
      if (edgeLen <= tol || Math.abs(cross2(prev, point, after)) <= Math.max(tol, edgeLen * 1e-7)) {
        changed = true;
        continue;
      }
      next.push(point);
    }
    out = next;
  }
  return out;
}

export function pointInPolygon(point: CamPoint2, polygon: CamPoint2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi[1] > point[1]) !== (pj[1] > point[1]))
      && (point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / ((pj[1] - pi[1]) || EPS) + pi[0]);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function loopInsideLoop(loop: CamPoint2[], container: CamPoint2[]) {
  if (loop.length < 3 || container.length < 3) return false;
  return loop.every((point) => pointInPolygon(point, container));
}

export function buildShadowLoops(projectedLoops: CamPoint2[][]): ShadowLoop[] {
  // The silhouette union already yields nested loops for regions with no
  // material at any height — exactly the machinable through-holes. Classify
  // by nesting parity: even depth = outer boundary, odd depth = hole.
  const records = projectedLoops
    .map((points) => ensureCounterClockwise(simplifyLoop(points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
    .map((points) => ({ points, area: Math.abs(polygonArea(points)) }));
  const loops = records.map((candidate) => {
    const nestingDepth = records.filter((container) => (
      container.area > candidate.area + EPS
      && loopInsideLoop(candidate.points, container.points)
    )).length;
    return {
      role: nestingDepth % 2 === 0 ? 'outer' as const : 'hole' as const,
      points: candidate.points,
      area: candidate.area,
    };
  });
  return loops
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'outer' ? -1 : 1;
      return b.area - a.area;
    })
    .map((loop) => ({ role: loop.role, points: loop.points }));
}

export function unionProjectedShadowLoops(loops: ShadowLoop[]) {
  const contours = loops
    .map((loop) => {
      let points = ensureCounterClockwise(simplifyLoop(loop.points));
      if (loop.role === 'hole') points = points.slice().reverse();
      return points;
    })
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS);
  return unionContoursWithClipper(contours);
}

function cross2(origin: CamPoint2, a: CamPoint2, b: CamPoint2) {
  return ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]));
}

export function polygonArea(points: CamPoint2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return area * 0.5;
}

export function mergeOuterOffsetLoops(loops: ShadowLoop[]): ShadowLoop[] {
  const outerLoops = loops.filter((loop) => loop.role === 'outer');
  const holeLoops = loops.filter((loop) => loop.role === 'hole');
  if (outerLoops.length <= 1) return loops;
  const contours = outerLoops
    .map((loop) => ensureCounterClockwise(simplifyLoop(loop.points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS);
  if (contours.length <= 1) return loops;
  const mergedOuterLoops = unionContoursWithClipper(contours)
    .map((points) => ensureCounterClockwise(simplifyLoop(points)))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
    .map((points) => ({ role: 'outer' as const, points }));
  return mergedOuterLoops.length ? [...mergedOuterLoops, ...holeLoops] : loops;
}

export function offsetPolygon(points: CamPoint2[], distance: number): CamPoint2[][] {
  const loop = ensureCounterClockwise(simplifyLoop(points));
  if (loop.length < 3) return [];
  if (Math.abs(distance) <= EPS) return [loop];
  return offsetPolygonWithClipper(loop, distance)
    .filter((loop) => offsetLoopIsValid(loop, points, distance))
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
}

function offsetPolygonWithClipper(points: CamPoint2[], distance: number): CamPoint2[][] {
  const path = points.map((point) => ({
    X: Math.round(point[0] * CLIPPER_SCALE),
    Y: Math.round(point[1] * CLIPPER_SCALE),
  }));
  const solution: Array<Array<{ X: number; Y: number }>> = [];
  const offsetter = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
  offsetter.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  offsetter.Execute(solution, distance * CLIPPER_SCALE);
  return solution
    .map((pathPoints) => pathPoints.map((point) => [
      roundCoord(point.X / CLIPPER_SCALE),
      roundCoord(point.Y / CLIPPER_SCALE),
    ] as CamPoint2))
    .map((loop) => ensureCounterClockwise(simplifyLoop(loop)))
    .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) > EPS);
}

function offsetLoopIsValid(loop: CamPoint2[], sourceLoop: CamPoint2[], distance: number) {
  if (loop.length < 3 || Math.abs(polygonArea(loop)) <= EPS) return false;
  const radius = Math.abs(distance);
  const tolerance = Math.max(1e-3, radius * 1e-4);
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const point: CamPoint2 = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      const inside = pointInPolygon(point, sourceLoop);
      if (distance > 0 && inside) return false;
      if (distance < 0 && !inside && !pointNearPolygonBoundary(point, sourceLoop, tolerance)) return false;
      const finiteDistance = distanceToPolygonSegments(point, sourceLoop).distance;
      if (finiteDistance < radius - tolerance) return false;
    }
  }
  return true;
}

function pointNearPolygonBoundary(point: CamPoint2, polygon: CamPoint2[], tolerance: number) {
  return distanceToPolygonSegments(point, polygon).distance <= tolerance;
}

function distanceToPolygonSegments(point: CamPoint2, polygon: CamPoint2[]) {
  let best = Infinity;
  let bestIndex = -1;
  let bestT = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = (dx * dx) + (dy * dy);
    const rawT = lenSq > EPS ? (((point[0] - a[0]) * dx) + ((point[1] - a[1]) * dy)) / lenSq : 0;
    const t = Math.min(1, Math.max(0, rawT));
    const closest: CamPoint2 = [a[0] + dx * t, a[1] + dy * t];
    const distanceValue = Math.hypot(point[0] - closest[0], point[1] - closest[1]);
    if (distanceValue < best) {
      best = distanceValue;
      bestIndex = index;
      bestT = t;
    }
  }
  return { distance: best, index: bestIndex, t: bestT };
}

export function buildDepthLevels(topZ: number, bottomZ: number, stepDown: number) {
  const levels: number[] = [];
  let current = topZ;
  while (current > bottomZ + EPS) {
    current = Math.max(bottomZ, current - stepDown);
    levels.push(roundCoord(current));
  }
  return levels.length ? levels : [roundCoord(bottomZ)];
}

export function makeSteppedLoopPath({
  id,
  operationId,
  operationName,
  loop,
  levels,
  safeZ,
  cutter,
  orientation,
  feedRate,
  plungeRate,
  spindleRPM,
}: {
  id: string;
  operationId: string;
  operationName: string;
  loop: ShadowLoop;
  levels: number[];
  safeZ: number;
  cutter: CamCutterDefinition;
  orientation: CamCutterOrientation;
  feedRate: number;
  plungeRate: number;
  spindleRPM: number;
}): CamToolpathPath {
  const depthLevels = levels.map(roundCoord);
  const first2 = loop.points[0] || [0, 0] as CamPoint2;
  const points: CamToolpathPoint[] = [{
    position: [roundCoord(first2[0]), roundCoord(first2[1]), roundCoord(safeZ)],
    orientation,
    metadata: { loopRole: loop.role, safe: true },
  }];
  const segments: CamToolpathSegment[] = [];
  const addPoint = (position: CamPoint3, metadata: Record<string, any> = {}) => {
    const index = points.length;
    points.push({ position: roundCamPoint(position), orientation, metadata });
    return index;
  };
  depthLevels.forEach((z, levelIndex) => {
    const level = levelIndex + 1;
    const plungeStartIndex = points.length - 1;
    const levelStartIndex = addPoint(
      [roundCoord(first2[0]), roundCoord(first2[1]), z],
      { loopRole: loop.role, level, z },
    );
    segments.push({
      id: `${id}-L${level}-PLUNGE`,
      kind: 'plunge',
      startIndex: plungeStartIndex,
      endIndex: levelStartIndex,
      orientation,
      cutter,
      feedRate: plungeRate,
      spindleRPM,
      metadata: { level, z },
    });
    let previousIndex = levelStartIndex;
    for (let pointIndex = 1; pointIndex <= loop.points.length; pointIndex += 1) {
      const point = loop.points[pointIndex % loop.points.length];
      const nextIndex = addPoint(
        [roundCoord(point[0]), roundCoord(point[1]), z],
        { loopRole: loop.role, level, z },
      );
      segments.push({
        id: `${id}-L${level}-CUT${pointIndex}`,
        kind: 'cut',
        startIndex: previousIndex,
        endIndex: nextIndex,
        orientation,
        cutter,
        feedRate,
        spindleRPM,
        metadata: { level, z },
      });
      previousIndex = nextIndex;
    }
  });
  const retractStartIndex = points.length - 1;
  const retractEndIndex = addPoint(
    [roundCoord(first2[0]), roundCoord(first2[1]), roundCoord(safeZ)],
    { loopRole: loop.role, safe: true },
  );
  segments.push({
    id: `${id}-RETRACT`,
    kind: 'retract',
    startIndex: retractStartIndex,
    endIndex: retractEndIndex,
    orientation,
    cutter,
    spindleRPM,
  });
  return {
    id,
    operationId,
    operationName,
    points,
    segments,
    cutter,
    defaultOrientation: orientation,
    feedRate,
    plungeRate,
    spindleRPM,
    metadata: {
      loopRole: loop.role,
      loopPointCount: loop.points.length,
      zLevels: depthLevels,
    },
  };
}

export function boundsFromLoopsAndZ(loops: ShadowLoop[], topZ: number, bottomZ: number): CamBounds {
  const allPoints = loops.flatMap((loop) => loop.points);
  const xs = allPoints.map((point) => point[0]);
  const ys = allPoints.map((point) => point[1]);
  return {
    min: [roundCoord(Math.min(...xs)), roundCoord(Math.min(...ys)), roundCoord(bottomZ)],
    max: [roundCoord(Math.max(...xs)), roundCoord(Math.max(...ys)), roundCoord(topZ)],
  };
}

export function makeEmptyShadowResult({
  operationId,
  operationName,
  machine,
  targetBounds = null,
  cutter = null,
  toolDiameter = 0,
  spindleRPM = 0,
  warnings = [],
}: {
  operationId: string;
  operationName: string;
  machine: CamMachineProfile;
  targetBounds?: CamBounds | null;
  cutter?: CamCutterDefinition | null;
  toolDiameter?: number;
  spindleRPM?: number;
  warnings?: string[];
}): CamToolpathProgram {
  return makeEmptyCamToolpathProgram({
    operationId,
    operationName,
    machine,
    targetBounds,
    cutter: cutter || makeFlatEndMillCutter({ diameter: toolDiameter }),
    spindleRPM,
    warnings,
  });
}

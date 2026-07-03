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

type AnyRecord = Record<string, any>;
export type CamPoint2 = [number, number];

type Triangle = [CamPoint3, CamPoint3, CamPoint3];
type ShadowLoopRole = 'outer' | 'hole';
type ShadowLoop = {
  role: ShadowLoopRole;
  points: CamPoint2[];
};

const EPS = 1e-7;

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

  static uiFieldsTest() {
    return { exclude: ['enabled'] };
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

    const projectedPoints = uniqueProjectedPoints(triangles);
    const capLoops = projectedBoundaryLoopsFromBottomFaces(triangles, targetBounds.min[2]);
    const shadowLoops = buildShadowLoops(projectedPoints, capLoops);
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
    const offsetLoops = shadowLoops.map((loop) => ({
      role: loop.role,
      points: offsetPolygon(loop.points, loop.role === 'hole' ? -offsetDistance : offsetDistance),
    })).filter((loop) => loop.points.length >= 3);
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

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function positiveNumber(value: any, fallback: number, min = EPS) {
  return Math.max(min, Math.abs(finiteNumber(value, fallback)));
}

function roundCoord(value: number) {
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

function extractTrianglesFromSolid(solid: any): Triangle[] {
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

function collectVisibleSolids(root: any, out: any[] = []) {
  if (!root) return out;
  if ((root.type === 'SOLID' || typeof root.getMesh === 'function') && root.visible !== false) out.push(root);
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) collectVisibleSolids(child, out);
  return out;
}

function resolveTargetSolids(context: AnyRecord, selection: any = null) {
  const viewer = context.viewer || null;
  const partHistory = context.partHistory || viewer?.partHistory || null;
  const scene = viewer?.scene || partHistory?.scene || null;
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

function triangleBounds(triangles: Triangle[]): CamBounds | null {
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

function uniqueProjectedPoints(triangles: Triangle[]) {
  const seen = new Set<string>();
  const out: CamPoint2[] = [];
  for (const triangle of triangles) {
    for (const point of triangle) {
      const x = roundCoord(point[0]);
      const y = roundCoord(point[1]);
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x, y]);
    }
  }
  return out;
}

function triangleNormal(triangle: Triangle): CamPoint3 {
  const a = triangle[0];
  const b = triangle[1];
  const c = triangle[2];
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

function point2Key(point: CamPoint2) {
  return `${roundCoord(point[0])},${roundCoord(point[1])}`;
}

function undirectedEdgeKey(a: CamPoint2, b: CamPoint2) {
  const ak = point2Key(a);
  const bk = point2Key(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function projectedBoundaryLoopsFromBottomFaces(triangles: Triangle[], bottomZ: number) {
  const planeEdges = new Map<string, Map<string, { a: CamPoint2; b: CamPoint2; count: number }>>();
  for (const triangle of triangles) {
    const normal = triangleNormal(triangle);
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(normalLength > EPS) || Math.abs(normal[2] / normalLength) < 0.7) continue;
    const planeKey = String(roundCoord((triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3));
    if (Math.abs(Number(planeKey) - bottomZ) > 1e-4) continue;
    let edgeMap = planeEdges.get(planeKey);
    if (!edgeMap) {
      edgeMap = new Map();
      planeEdges.set(planeKey, edgeMap);
    }
    for (let index = 0; index < 3; index += 1) {
      const nextIndex = (index + 1) % 3;
      const a: CamPoint2 = [roundCoord(triangle[index][0]), roundCoord(triangle[index][1])];
      const b: CamPoint2 = [roundCoord(triangle[nextIndex][0]), roundCoord(triangle[nextIndex][1])];
      if (point2Key(a) === point2Key(b)) continue;
      const key = undirectedEdgeKey(a, b);
      const entry = edgeMap.get(key);
      if (entry) entry.count += 1;
      else edgeMap.set(key, { a, b, count: 1 });
    }
  }

  const uniqueEdges = new Map<string, { a: CamPoint2; b: CamPoint2 }>();
  for (const edgeMap of planeEdges.values()) {
    for (const edge of edgeMap.values()) {
      if (edge.count !== 1) continue;
      uniqueEdges.set(undirectedEdgeKey(edge.a, edge.b), { a: edge.a, b: edge.b });
    }
  }
  return loopsFromEdges(Array.from(uniqueEdges.values()));
}

function loopsFromEdges(edges: Array<{ a: CamPoint2; b: CamPoint2 }>) {
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
    const loop = loopKeys.map((key) => pointsByKey.get(key)).filter(Boolean) as CamPoint2[];
    if (Math.abs(polygonArea(loop)) > EPS) loops.push(ensureCounterClockwise(loop));
  }
  return loops;
}

function ensureCounterClockwise(points: CamPoint2[]) {
  return polygonArea(points) < 0 ? points.slice().reverse() : points.slice();
}

function pointInPolygon(point: CamPoint2, polygon: CamPoint2[]) {
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

function loopInsideLoop(loop: CamPoint2[], container: CamPoint2[]) {
  if (loop.length < 3 || container.length < 3) return false;
  return loop.every((point) => pointInPolygon(point, container));
}

function buildShadowLoops(projectedPoints: CamPoint2[], capLoops: CamPoint2[][]): ShadowLoop[] {
  const outer = ensureCounterClockwise(convexHull(projectedPoints));
  if (outer.length < 3) return [];
  const capLoopRecords = capLoops
    .map((points) => ensureCounterClockwise(points))
    .filter((points) => points.length >= 3 && Math.abs(polygonArea(points)) > EPS)
    .map((points) => ({ points, area: Math.abs(polygonArea(points)) }));
  const holeLoops = capLoopRecords.filter((candidate, candidateIndex) => {
    return capLoopRecords.some((container, containerIndex) => (
      containerIndex !== candidateIndex
      && container.area > candidate.area + EPS
      && loopInsideLoop(candidate.points, container.points)
    ));
  });
  return [
    { role: 'outer', points: outer },
    ...holeLoops.map((loop) => ({ role: 'hole' as const, points: loop.points })),
  ];
}

function cross2(origin: CamPoint2, a: CamPoint2, b: CamPoint2) {
  return ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]));
}

function convexHull(points: CamPoint2[]) {
  const sorted = points
    .slice()
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length <= 1) return sorted;
  const lower: CamPoint2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= EPS) lower.pop();
    lower.push(point);
  }
  const upper: CamPoint2[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= EPS) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(points: CamPoint2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return area * 0.5;
}

function lineIntersection(p: CamPoint2, r: CamPoint2, q: CamPoint2, s: CamPoint2): CamPoint2 | null {
  const denom = (r[0] * s[1]) - (r[1] * s[0]);
  if (Math.abs(denom) <= EPS) return null;
  const qmp: CamPoint2 = [q[0] - p[0], q[1] - p[1]];
  const t = ((qmp[0] * s[1]) - (qmp[1] * s[0])) / denom;
  return [p[0] + (r[0] * t), p[1] + (r[1] * t)];
}

function offsetPolygon(points: CamPoint2[], distance: number) {
  if (points.length < 3) return [];
  if (Math.abs(distance) <= EPS) return points.map((point) => [roundCoord(point[0]), roundCoord(point[1])] as CamPoint2);
  const out: CamPoint2[] = [];
  const edgeData = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    const len = Math.max(EPS, Math.hypot(dx, dy));
    const dir: CamPoint2 = [dx / len, dy / len];
    const normal: CamPoint2 = [dir[1], -dir[0]];
    return {
      point: [point[0] + normal[0] * distance, point[1] + normal[1] * distance] as CamPoint2,
      dir,
      normal,
    };
  });
  for (let i = 0; i < points.length; i += 1) {
    const prev = edgeData[(i - 1 + points.length) % points.length];
    const next = edgeData[i];
    const intersection = lineIntersection(prev.point, prev.dir, next.point, next.dir);
    if (intersection) {
      out.push([roundCoord(intersection[0]), roundCoord(intersection[1])]);
      continue;
    }
    const normal: CamPoint2 = [prev.normal[0] + next.normal[0], prev.normal[1] + next.normal[1]];
    const len = Math.max(EPS, Math.hypot(normal[0], normal[1]));
    out.push([
      roundCoord(points[i][0] + (normal[0] / len) * distance),
      roundCoord(points[i][1] + (normal[1] / len) * distance),
    ]);
  }
  return out;
}

function buildDepthLevels(topZ: number, bottomZ: number, stepDown: number) {
  const levels: number[] = [];
  let current = topZ;
  while (current > bottomZ + EPS) {
    current = Math.max(bottomZ, current - stepDown);
    levels.push(roundCoord(current));
  }
  return levels.length ? levels : [roundCoord(bottomZ)];
}

function makeSteppedLoopPath({
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

function boundsFromLoopsAndZ(loops: ShadowLoop[], topZ: number, bottomZ: number): CamBounds {
  const allPoints = loops.flatMap((loop) => loop.points);
  const xs = allPoints.map((point) => point[0]);
  const ys = allPoints.map((point) => point[1]);
  return {
    min: [roundCoord(Math.min(...xs)), roundCoord(Math.min(...ys)), roundCoord(bottomZ)],
    max: [roundCoord(Math.max(...xs)), roundCoord(Math.max(...ys)), roundCoord(topZ)],
  };
}

function makeEmptyShadowResult({
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

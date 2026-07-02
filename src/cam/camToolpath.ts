import * as THREE from 'three';
import {
  normalizeCamMachineProfile,
  splitMachineMacroLines,
  type CamMachineProfile,
} from './CamMachineProfile.js';

type AnyRecord = Record<string, any>;
type Point3 = [number, number, number];
type Point2 = { x: number; y: number };
type Segment2 = { a: Point2; b: Point2; z: number };
type Triangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
type Section2 = { z: number; segments: Segment2[]; loops: Point2[][] };

export type CamSerializedTargetMesh = {
  name?: string;
  triangles: number[];
};

export type CamSerializedTargetPayload = {
  targetCount: number;
  targets: CamSerializedTargetMesh[];
};

export type CamToolpathProgressEvent = {
  phase?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  operationId?: string;
  operationName?: string;
  operationIndex?: number;
  operationCount?: number;
};

export type CamToolpathPath = {
  id: string;
  z: number;
  feedRate: number;
  plungeRate: number;
  points: Point3[];
};

export type CamToolpathResult = {
  operationId: string;
  operationName: string;
  units: 'mm';
  generatedAt: string;
  bounds: {
    min: Point3;
    max: Point3;
  } | null;
  targetBounds: {
    min: Point3;
    max: Point3;
  } | null;
  safeZ: number;
  machine: CamMachineProfile;
  toolDiameter: number;
  toolLength: number;
  spindleRPM: number;
  paths: CamToolpathPath[];
  simulation: {
    samples: Point3[];
    motionPolyline: Point3[];
    motionSegments: Array<{
      start: Point3;
      end: Point3;
      kind: 'rapid' | 'plunge' | 'cut' | 'retract';
    }>;
    sweptSegments: Array<{
      start: Point3;
      end: Point3;
      radius: number;
    }>;
    sweptHulls: Array<{
      kind?: 'flat-endmill-sweep';
      start: Point3;
      end: Point3;
      radius: number;
      toolLength: number;
      length: number;
      positions?: number[];
      indices?: number[];
      vertexCount?: number;
      triangleCount?: number;
      bounds: {
        min: Point3;
        max: Point3;
      };
    }>;
  };
  gcode: string;
  summary: {
    targetCount: number;
    triangleCount: number;
    levelCount: number;
    pathCount: number;
    moveCount: number;
    motionSegmentCount: number;
    sweptSegmentCount: number;
    sweptHullCount: number;
    estimatedCutLength: number;
    warningCount: number;
  };
  warnings: string[];
};

const EPS = 1e-7;

function emitCamProgress(options: AnyRecord | null | undefined, event: CamToolpathProgressEvent) {
  const callback = options?.onProgress;
  if (typeof callback !== 'function') return;
  try {
    callback({
      total: 100,
      ...event,
    });
  } catch {
    // Progress callbacks are observational and should not break CAM generation.
  }
}

async function yieldCamProgress(options: AnyRecord | null | undefined) {
  const progressYield = options?.progressYield;
  if (typeof progressYield === 'function') {
    await progressYield();
    return;
  }
  await Promise.resolve();
}

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nullableFiniteNumber(value: any) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampPositive(value: any, fallback: number, min = EPS) {
  const num = finiteNumber(value, fallback);
  return Math.max(min, Math.abs(num));
}

function clampNonNegative(value: any, fallback: number) {
  const num = finiteNumber(value, fallback);
  return Math.max(0, Math.abs(num));
}

function pointKey2(point: Point2, tolerance = 1e-5) {
  return `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`;
}

function pointKey3(point: THREE.Vector3, tolerance = 1e-5) {
  return `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)},${Math.round(point.z / tolerance)}`;
}

function toPoint3(point: THREE.Vector3): Point3 {
  return [roundCoord(point.x), roundCoord(point.y), roundCoord(point.z)];
}

function scenePointToMachine(point: THREE.Vector3) {
  return new THREE.Vector3(point.x, point.z, point.y);
}

function toSerializableBounds(box: THREE.Box3 | null) {
  return box ? { min: toPoint3(box.min), max: toPoint3(box.max) } : null;
}

function roundCoord(value: number) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

function formatCoord(value: number) {
  const rounded = roundCoord(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4).replace(/0+$/g, '').replace(/\.$/, '');
}

function formatLine(tokens: string[], comment: string, profile: CamMachineProfile) {
  const body = tokens.filter(Boolean).join(profile.tokenSpacer ? ' ' : '');
  if (profile.stripComments || !comment) return body;
  return body ? `${body} ; ${comment}` : `; ${comment}`;
}

function clampSpindleRPM(value: any, profile: CamMachineProfile) {
  const rpm = Math.max(0, Math.round(finiteNumber(value, 12000)));
  const max = Math.max(0, Math.round(finiteNumber(profile.maxSpindleRPM, 0)));
  return max > 0 ? Math.min(rpm, max) : rpm;
}

function resultSpindleRPM(result: Partial<CamToolpathResult>, params: AnyRecord, profile: CamMachineProfile) {
  const raw = Object.prototype.hasOwnProperty.call(params || {}, 'spindleRPM')
    ? params.spindleRPM
    : result.spindleRPM;
  return clampSpindleRPM(raw, profile);
}

function normalizeReferenceNames(value: any): string[] {
  const list = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: any) => {
    const text = String(candidate ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  for (const item of list) {
    if (typeof item === 'string' || typeof item === 'number') {
      add(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    add(item.name);
    add(item.selectionName);
    add(item.id);
    add(item.userData?.selectionName);
    add(item.userData?.edgeName);
    add(item.userData?.faceName);
  }
  return out;
}

function resolveSolidCarrier(object: any) {
  let cursor = object || null;
  let guard = 0;
  while (cursor && guard < 32) {
    if (isMachinableSolid(cursor)) return cursor;
    cursor = cursor.parentSolid || cursor.parent || null;
    guard += 1;
  }
  return null;
}

function isMachinableSolid(object: any) {
  if (!object || typeof object !== 'object') return false;
  if (object.userData?.sceneOverlay) return false;
  if (object.visible === false) return false;
  return object.type === 'SOLID' || typeof object.getMesh === 'function';
}

export function collectCamTargetSolids(viewer: any, targetSelection: any = null) {
  const scene = viewer?.partHistory?.scene || viewer?.scene || null;
  const partHistory = viewer?.partHistory || null;
  const names = normalizeReferenceNames(targetSelection);
  const out: any[] = [];
  const seen = new Set<any>();
  const push = (object: any) => {
    const solid = resolveSolidCarrier(object);
    if (!solid || seen.has(solid)) return;
    seen.add(solid);
    out.push(solid);
  };

  if (names.length) {
    for (const name of names) {
      let object = null;
      try { object = partHistory?.getObjectByName?.(name) || null; } catch { object = null; }
      if (!object) {
        try { object = scene?.getObjectByName?.(name) || null; } catch { object = null; }
      }
      push(object);
    }
    return out;
  }

  if (scene && typeof scene.traverse === 'function') {
    try {
      scene.traverse((object: any) => {
        if (isMachinableSolid(object)) push(object);
      });
    } catch { /* ignore traversal failures */ }
  }
  return out;
}

function extractTrianglesFromGeometry(object: any): Triangle[] {
  const geometry = object?.geometry;
  const pos = geometry?.attributes?.position;
  if (!geometry?.isBufferGeometry || !pos || pos.count < 3) return [];
  const index = geometry.index;
  const matrix = object?.matrixWorld || new THREE.Matrix4();
  const read = (idx: number) => new THREE.Vector3(
    Number(pos.getX(idx)) || 0,
    Number(pos.getY(idx)) || 0,
    Number(pos.getZ(idx)) || 0,
  ).applyMatrix4(matrix);
  const triangles: Triangle[] = [];
  const count = index ? index.count : pos.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const a = index ? Number(index.getX(i + 0)) : i + 0;
    const b = index ? Number(index.getX(i + 1)) : i + 1;
    const c = index ? Number(index.getX(i + 2)) : i + 2;
    triangles.push([scenePointToMachine(read(a)), scenePointToMachine(read(b)), scenePointToMachine(read(c))]);
  }
  return triangles;
}

export function extractTrianglesFromSolid(solid: any): Triangle[] {
  if (!solid) return [];
  try { solid.updateMatrixWorld?.(true); } catch { /* ignore */ }
  const matrix = solid?.matrixWorld || new THREE.Matrix4();
  if (typeof solid.getMesh === 'function') {
    let mesh: AnyRecord | null = null;
    try {
      mesh = solid.getMesh();
      const vp = mesh?.vertProperties || [];
      const tv = mesh?.triVerts || [];
      const triCount = (tv.length / 3) | 0;
      const triangles: Triangle[] = [];
      const read = (idx: number) => {
        const base = idx * 3;
        return new THREE.Vector3(
          Number(vp[base + 0]) || 0,
          Number(vp[base + 1]) || 0,
          Number(vp[base + 2]) || 0,
        ).applyMatrix4(matrix);
      };
      for (let t = 0; t < triCount; t += 1) {
        const base = t * 3;
        triangles.push([
          scenePointToMachine(read(Number(tv[base + 0]) >>> 0)),
          scenePointToMachine(read(Number(tv[base + 1]) >>> 0)),
          scenePointToMachine(read(Number(tv[base + 2]) >>> 0)),
        ]);
      }
      return triangles;
    } catch {
      return extractTrianglesFromGeometry(solid);
    } finally {
      try { mesh?.delete?.(); } catch { /* ignore mesh disposal */ }
    }
  }
  return extractTrianglesFromGeometry(solid);
}

function flattenTriangles(triangles: Triangle[]) {
  const out: number[] = [];
  for (const tri of triangles) {
    for (const point of tri) {
      out.push(roundCoord(point.x), roundCoord(point.y), roundCoord(point.z));
    }
  }
  return out;
}

export function collectCamTargetMeshPayloads(viewer: any, targetSelection: any = null): CamSerializedTargetPayload {
  const solids = collectCamTargetSolids(viewer, targetSelection);
  const targets: CamSerializedTargetMesh[] = [];
  for (let index = 0; index < solids.length; index += 1) {
    const solid = solids[index];
    targets.push({
      name: String(solid?.name || `Solid ${index + 1}`),
      triangles: flattenTriangles(extractTrianglesFromSolid(solid)),
    });
  }
  return {
    targetCount: solids.length,
    targets,
  };
}

function serializedTargetMeshesFromParams(params: AnyRecord) {
  if (Array.isArray(params?.targetMeshes)) return params.targetMeshes;
  if (Array.isArray(params?.targets)) return params.targets;
  return null;
}

function readSerializedTargetTriangles(target: any, warnings: string[], index: number): Triangle[] {
  const values = Array.isArray(target?.triangles)
    ? target.triangles
    : (ArrayBuffer.isView(target?.triangles) ? Array.from(target.triangles as ArrayLike<number>) : []);
  const name = String(target?.name || `serialized target ${index + 1}`);
  const triangles: Triangle[] = [];
  for (let offset = 0; offset + 8 < values.length; offset += 9) {
    triangles.push([
      new THREE.Vector3(finiteNumber(values[offset + 0], 0), finiteNumber(values[offset + 1], 0), finiteNumber(values[offset + 2], 0)),
      new THREE.Vector3(finiteNumber(values[offset + 3], 0), finiteNumber(values[offset + 4], 0), finiteNumber(values[offset + 5], 0)),
      new THREE.Vector3(finiteNumber(values[offset + 6], 0), finiteNumber(values[offset + 7], 0), finiteNumber(values[offset + 8], 0)),
    ]);
  }
  if (!triangles.length) warnings.push(`No mesh triangles found for ${name}.`);
  return triangles;
}

function collectTargetTriangles(viewer: any, params: AnyRecord, warnings: string[]) {
  const serializedTargets = serializedTargetMeshesFromParams(params);
  if (serializedTargets) {
    const triangles: Triangle[] = [];
    for (let index = 0; index < serializedTargets.length; index += 1) {
      triangles.push(...readSerializedTargetTriangles(serializedTargets[index], warnings, index));
    }
    return {
      targetCount: Math.max(0, Math.round(finiteNumber(params.targetCount, serializedTargets.length))),
      triangles,
    };
  }

  const solids = collectCamTargetSolids(viewer, params.targetSolids);
  const triangles: Triangle[] = [];
  for (const solid of solids) {
    const extracted = extractTrianglesFromSolid(solid);
    if (!extracted.length) warnings.push(`No mesh triangles found for ${solid?.name || 'solid'}.`);
    triangles.push(...extracted);
  }
  return {
    targetCount: solids.length,
    triangles,
  };
}

function computeTriangleBounds(triangles: Triangle[]) {
  if (!triangles.length) return null;
  const box = new THREE.Box3();
  for (const tri of triangles) {
    box.expandByPoint(tri[0]);
    box.expandByPoint(tri[1]);
    box.expandByPoint(tri[2]);
  }
  if (box.isEmpty()) return null;
  return box;
}

function addUniquePoint(points: THREE.Vector3[], point: THREE.Vector3) {
  const key = pointKey3(point);
  for (const existing of points) {
    if (pointKey3(existing) === key) return;
  }
  points.push(point);
}

function intersectTriangleAtZ(triangle: Triangle, z: number): Segment2 | null {
  const d0 = triangle[0].z - z;
  const d1 = triangle[1].z - z;
  const d2 = triangle[2].z - z;
  if (Math.abs(d0) <= EPS && Math.abs(d1) <= EPS && Math.abs(d2) <= EPS) {
    return null;
  }
  const points: THREE.Vector3[] = [];
  const edges = [
    [triangle[0], triangle[1]],
    [triangle[1], triangle[2]],
    [triangle[2], triangle[0]],
  ] as const;

  for (const [a, b] of edges) {
    const da = a.z - z;
    const db = b.z - z;
    const aOn = Math.abs(da) <= EPS;
    const bOn = Math.abs(db) <= EPS;
    if (aOn && bOn) {
      addUniquePoint(points, a.clone());
      addUniquePoint(points, b.clone());
      continue;
    }
    if (aOn) {
      addUniquePoint(points, a.clone());
      continue;
    }
    if (bOn) {
      addUniquePoint(points, b.clone());
      continue;
    }
    if (da * db > 0) continue;
    const t = da / (da - db);
    if (t < -EPS || t > 1 + EPS) continue;
    addUniquePoint(points, a.clone().lerp(b, Math.min(1, Math.max(0, t))));
  }

  if (points.length < 2) return null;
  let bestA = points[0];
  let bestB = points[1];
  let bestDist = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dist = points[i].distanceToSquared(points[j]);
      if (dist > bestDist) {
        bestA = points[i];
        bestB = points[j];
        bestDist = dist;
      }
    }
  }
  if (!Number.isFinite(bestDist) || bestDist <= EPS * EPS) return null;
  return {
    a: { x: bestA.x, y: bestA.y },
    b: { x: bestB.x, y: bestB.y },
    z,
  };
}

function sliceMeshAtZ(triangles: Triangle[], z: number) {
  const out: Segment2[] = [];
  const seen = new Set<string>();
  for (const tri of triangles) {
    const segment = intersectTriangleAtZ(tri, z);
    if (!segment) continue;
    const aKey = pointKey2(segment.a);
    const bKey = pointKey2(segment.b);
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segment);
  }
  return out;
}

function sortedUnique(values: number[], tolerance = 1e-5) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > tolerance) {
      out.push(value);
    }
  }
  return out;
}

function lineIntersectionsAlongX(segments: Segment2[], y: number) {
  const xs: number[] = [];
  for (const segment of segments) {
    const y0 = segment.a.y;
    const y1 = segment.b.y;
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (Math.abs(y1 - y0) <= EPS) continue;
    if (y < minY - EPS || y >= maxY - EPS) continue;
    const t = (y - y0) / (y1 - y0);
    xs.push(segment.a.x + (segment.b.x - segment.a.x) * t);
  }
  return sortedUnique(xs);
}

function lineIntersectionsAlongY(segments: Segment2[], x: number) {
  const ys: number[] = [];
  for (const segment of segments) {
    const x0 = segment.a.x;
    const x1 = segment.b.x;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    if (Math.abs(x1 - x0) <= EPS) continue;
    if (x < minX - EPS || x >= maxX - EPS) continue;
    const t = (x - x0) / (x1 - x0);
    ys.push(segment.a.y + (segment.b.y - segment.a.y) * t);
  }
  return sortedUnique(ys);
}

function normalizeCutRegion(value: any) {
  return String(value || '').trim().toLowerCase() === 'inside' ? 'inside' : 'outside';
}

function normalizeCamStrategy(value: any) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'waterline-contour-low-hop') return 'waterline-contour-low-hop';
  if (raw === 'waterline-contour') return 'waterline-contour';
  return 'waterline-raster';
}

function polygonArea2(points: Point2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function buildSectionLoops(segments: Segment2[]) {
  const pointByKey = new Map<string, Point2>();
  const edges: Array<{ aKey: string; bKey: string; used: boolean }> = [];
  const adjacency = new Map<string, number[]>();
  const rememberPoint = (point: Point2) => {
    const key = pointKey2(point);
    if (!pointByKey.has(key)) {
      pointByKey.set(key, { x: roundCoord(point.x), y: roundCoord(point.y) });
    }
    return key;
  };
  const addAdjacency = (key: string, edgeIndex: number) => {
    const list = adjacency.get(key) || [];
    list.push(edgeIndex);
    adjacency.set(key, list);
  };

  for (const segment of segments) {
    const aKey = rememberPoint(segment.a);
    const bKey = rememberPoint(segment.b);
    if (aKey === bKey) continue;
    const edgeIndex = edges.length;
    edges.push({ aKey, bKey, used: false });
    addAdjacency(aKey, edgeIndex);
    addAdjacency(bKey, edgeIndex);
  }

  const loops: Point2[][] = [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const firstEdge = edges[edgeIndex];
    if (!firstEdge || firstEdge.used) continue;
    firstEdge.used = true;
    const startKey = firstEdge.aKey;
    let previousKey = firstEdge.aKey;
    let currentKey = firstEdge.bKey;
    const loopKeys = [startKey, currentKey];
    let closed = false;

    for (let guard = 0; guard < edges.length + 2; guard += 1) {
      if (currentKey === startKey) {
        closed = true;
        break;
      }
      const candidates = (adjacency.get(currentKey) || [])
        .filter((candidateIndex) => !edges[candidateIndex]?.used);
      if (!candidates.length) break;
      const nextEdgeIndex = candidates.find((candidateIndex) => {
        const edge = edges[candidateIndex];
        const nextKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
        return nextKey !== previousKey;
      }) ?? candidates[0];
      const edge = edges[nextEdgeIndex];
      edge.used = true;
      const nextKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
      previousKey = currentKey;
      currentKey = nextKey;
      loopKeys.push(currentKey);
    }

    if (!closed || loopKeys.length < 4) continue;
    const uniqueKeys = loopKeys.slice(0, -1);
    const loop = uniqueKeys
      .map((key) => pointByKey.get(key))
      .filter(Boolean) as Point2[];
    if (loop.length < 3 || Math.abs(polygonArea2(loop)) <= EPS) continue;
    loops.push(loop);
  }
  return loops.sort((a, b) => Math.abs(polygonArea2(b)) - Math.abs(polygonArea2(a)));
}

function lineIntersection2(a0: Point2, a1: Point2, b0: Point2, b1: Point2) {
  const dax = a1.x - a0.x;
  const day = a1.y - a0.y;
  const dbx = b1.x - b0.x;
  const dby = b1.y - b0.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) <= EPS) return null;
  const ox = b0.x - a0.x;
  const oy = b0.y - a0.y;
  const t = (ox * dby - oy * dbx) / denom;
  return {
    x: roundCoord(a0.x + dax * t),
    y: roundCoord(a0.y + day * t),
  };
}

function offsetClosedLoop(loop: Point2[], distance: number) {
  if (loop.length < 3) return null;
  const area = polygonArea2(loop);
  if (Math.abs(area) <= EPS) return null;
  if (Math.abs(distance) <= EPS) return loop.map((point) => ({ x: roundCoord(point.x), y: roundCoord(point.y) }));
  const ccw = area > 0;
  const edgeOffsets: Array<{ a: Point2; b: Point2; normal: Point2 }> = [];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPS) return null;
    const ux = dx / length;
    const uy = dy / length;
    const normal = ccw ? { x: uy, y: -ux } : { x: -uy, y: ux };
    edgeOffsets.push({
      a: { x: a.x + normal.x * distance, y: a.y + normal.y * distance },
      b: { x: b.x + normal.x * distance, y: b.y + normal.y * distance },
      normal,
    });
  }

  const out: Point2[] = [];
  const maxMiter = Math.max(Math.abs(distance) * 6, Math.abs(distance) + 1e-4);
  for (let i = 0; i < loop.length; i += 1) {
    const previous = edgeOffsets[(i + edgeOffsets.length - 1) % edgeOffsets.length];
    const current = edgeOffsets[i];
    const original = loop[i];
    let point = lineIntersection2(previous.a, previous.b, current.a, current.b);
    if (!point || Math.hypot(point.x - original.x, point.y - original.y) > maxMiter) {
      const nx = previous.normal.x + current.normal.x;
      const ny = previous.normal.y + current.normal.y;
      const nLength = Math.hypot(nx, ny);
      const fallbackNormal = nLength > EPS
        ? { x: nx / nLength, y: ny / nLength }
        : current.normal;
      point = {
        x: roundCoord(original.x + fallbackNormal.x * distance),
        y: roundCoord(original.y + fallbackNormal.y * distance),
      };
    }
    if (!out.length || pointKey2(out[out.length - 1]) !== pointKey2(point)) {
      out.push(point);
    }
  }

  if (out.length >= 2 && pointKey2(out[0]) === pointKey2(out[out.length - 1])) out.pop();
  if (out.length < 3 || Math.abs(polygonArea2(out)) <= EPS) return null;
  if (distance < 0 && Math.abs(polygonArea2(out)) >= Math.abs(area) - EPS) return null;
  return out;
}

function insideIntervals(intersections: number[], clearance: number) {
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i + 1 < intersections.length; i += 2) {
    const start = intersections[i] + clearance;
    const end = intersections[i + 1] - clearance;
    if (end > start + EPS) intervals.push([start, end]);
  }
  return intervals;
}

function mergeIntervals(intervals: Array<[number, number]>) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start + EPS)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1] + EPS) {
      merged.push([interval[0], interval[1]]);
      continue;
    }
    previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function outsideIntervalsFromProtectedIntervals(
  protectedIntervals: Array<[number, number]>,
  min: number,
  max: number,
  clearance: number,
) {
  if (max <= min + EPS) return [];
  if (!protectedIntervals.length) return [[min, max]] as Array<[number, number]>;
  const protectedExpanded = mergeIntervals(protectedIntervals.map(([start, end]) => [
    start - clearance,
    end + clearance,
  ]));
  const intervals: Array<[number, number]> = [];
  let cursor = min;
  for (const [start, end] of protectedExpanded) {
    const clippedStart = Math.max(min, start);
    const clippedEnd = Math.min(max, end);
    if (clippedStart > cursor + EPS) intervals.push([cursor, clippedStart]);
    cursor = Math.max(cursor, clippedEnd);
    if (cursor >= max - EPS) break;
  }
  if (max > cursor + EPS) intervals.push([cursor, max]);
  return intervals;
}

function protectedIntervalsAlongX(sections: Section2[], y: number) {
  const intervals: Array<[number, number]> = [];
  for (const section of sections) {
    intervals.push(...insideIntervals(lineIntersectionsAlongX(section.segments, y), 0));
  }
  return mergeIntervals(intervals);
}

function protectedIntervalsAlongY(sections: Section2[], x: number) {
  const intervals: Array<[number, number]> = [];
  for (const section of sections) {
    intervals.push(...insideIntervals(lineIntersectionsAlongY(section.segments, x), 0));
  }
  return mergeIntervals(intervals);
}

function distSqPointToSegment2(point: Point2, a: Point2, b: Point2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= EPS * EPS) {
    const ox = point.x - a.x;
    const oy = point.y - a.y;
    return ox * ox + oy * oy;
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const sx = a.x + dx * t;
  const sy = a.y + dy * t;
  const ox = point.x - sx;
  const oy = point.y - sy;
  return ox * ox + oy * oy;
}

function distanceToSectionBoundary(point: Point2, segments: Segment2[]) {
  let best = Infinity;
  for (const segment of segments) {
    const distSq = distSqPointToSegment2(point, segment.a, segment.b);
    if (distSq < best) best = distSq;
  }
  return Number.isFinite(best) ? Math.sqrt(best) : Infinity;
}

function distanceToProtectedSectionBoundary(point: Point2, sections: Section2[]) {
  let best = Infinity;
  for (const section of sections) {
    const distance = distanceToSectionBoundary(point, section.segments);
    if (distance < best) best = distance;
  }
  return Number.isFinite(best) ? best : Infinity;
}

function pointInsideProtectedSections(point: Point2, sections: Section2[]) {
  for (const section of sections) {
    if (section.loops.length) {
      if (pointInsideSectionMaterial(point, section.loops)) return true;
      continue;
    }
    const intervals = insideIntervals(lineIntersectionsAlongX(section.segments, point.y), 0);
    if (intervals.some(([start, end]) => point.x > start + EPS && point.x < end - EPS)) return true;
  }
  return false;
}

function triangleZAtXY(triangle: Triangle, point: Point2) {
  const [a, b, c] = triangle;
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denom) <= EPS) return null;
  const w0 = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denom;
  const w1 = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denom;
  const w2 = 1 - w0 - w1;
  const tolerance = 1e-6;
  if (w0 < -tolerance || w1 < -tolerance || w2 < -tolerance) return null;
  return w0 * a.z + w1 * b.z + w2 * c.z;
}

function verticalMeshIntersectionsAtXY(triangles: Triangle[], point: Point2) {
  const zs: number[] = [];
  for (const triangle of triangles) {
    const z = triangleZAtXY(triangle, point);
    if (z != null && Number.isFinite(z)) zs.push(z);
  }
  return sortedUnique(zs);
}

function pointInsideTargetMeshMaterial(point: Point3, triangles: Triangle[]) {
  if (!triangles.length) return false;
  const zs = verticalMeshIntersectionsAtXY(triangles, { x: point[0], y: point[1] });
  for (let index = 0; index + 1 < zs.length; index += 2) {
    const low = zs[index];
    const high = zs[index + 1];
    if (point[2] >= low - 1e-5 && point[2] <= high + 1e-5) return true;
  }
  return false;
}

function interpolatePoint3(a: Point3, b: Point3, t: number): Point3 {
  return [
    roundCoord(a[0] + (b[0] - a[0]) * t),
    roundCoord(a[1] + (b[1] - a[1]) * t),
    roundCoord(a[2] + (b[2] - a[2]) * t),
  ];
}

function point2FromPoint3(point: Point3): Point2 {
  return { x: Number(point[0]) || 0, y: Number(point[1]) || 0 };
}

function pointInPolygon2(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.y > point.y) !== (pj.y > point.y))
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || EPS) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInsideSectionMaterial(point: Point2, loops: Point2[][]) {
  let inside = false;
  for (const loop of loops) {
    if (pointInPolygon2(point, loop)) inside = !inside;
  }
  return inside;
}

function segmentRespectsCutRegion(
  a: Point2,
  b: Point2,
  loops: Point2[][],
  segments: Segment2[],
  cutRegion: string,
  clearance: number,
  z = 0,
  targetTriangles: Triangle[] = [],
  protectedSections: Section2[] = [],
) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const sampleSpacing = Math.max(0.25, Math.min(2, Math.max(clearance, 0.25) * 0.5));
  const sampleCount = Math.max(2, Math.min(128, Math.ceil(length / sampleSpacing)));
  const minClearance = Math.max(0, clearance - 1e-4);
  const useProtectedSections = cutRegion === 'outside' && protectedSections.length > 0;
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
    const insideMaterial = useProtectedSections
      ? pointInsideProtectedSections(point, protectedSections)
      : pointInsideSectionMaterial(point, loops);
    if (cutRegion === 'outside' ? insideMaterial : !insideMaterial) return false;
    const boundaryDistance = useProtectedSections
      ? distanceToProtectedSectionBoundary(point, protectedSections)
      : distanceToSectionBoundary(point, segments);
    if (boundaryDistance < minClearance) return false;
    if (
      cutRegion === 'outside'
      && pointInsideTargetMeshMaterial([point.x, point.y, z], targetTriangles)
    ) {
      return false;
    }
  }
  return true;
}

function loopRespectsCutRegion(
  loop: Point2[],
  loops: Point2[][],
  segments: Segment2[],
  cutRegion: string,
  clearance: number,
  z = 0,
  targetTriangles: Triangle[] = [],
  protectedSections: Section2[] = [],
) {
  if (loop.length < 3) return false;
  for (let index = 0; index < loop.length; index += 1) {
    if (!segmentRespectsCutRegion(
      loop[index],
      loop[(index + 1) % loop.length],
      loops,
      segments,
      cutRegion,
      clearance,
      z,
      targetTriangles,
      protectedSections,
    )) {
      return false;
    }
  }
  return true;
}

function findBoundaryClearanceTransition(
  a: Point3,
  b: Point3,
  segments: Segment2[],
  clearance: number,
  lo: number,
  hi: number,
  targetValid: boolean,
) {
  let left = lo;
  let right = hi;
  for (let i = 0; i < 10; i += 1) {
    const mid = (left + right) * 0.5;
    const point = interpolatePoint3(a, b, mid);
    const valid = distanceToSectionBoundary(point2FromPoint3(point), segments) >= clearance - 1e-5;
    if (valid === targetValid) right = mid;
    else left = mid;
  }
  return right;
}

function findSectionStackClearanceTransition(
  a: Point3,
  b: Point3,
  sections: Section2[],
  clearance: number,
  lo: number,
  hi: number,
  targetValid: boolean,
) {
  let left = lo;
  let right = hi;
  for (let i = 0; i < 10; i += 1) {
    const mid = (left + right) * 0.5;
    const point = interpolatePoint3(a, b, mid);
    const point2 = point2FromPoint3(point);
    const valid = !pointInsideProtectedSections(point2, sections)
      && distanceToProtectedSectionBoundary(point2, sections) >= clearance - 1e-5;
    if (valid === targetValid) right = mid;
    else left = mid;
  }
  return right;
}

function clipSegmentByBoundaryClearance(a: Point3, b: Point3, segments: Segment2[], clearance: number) {
  if (!segments.length || clearance <= EPS) return [[a, b]] as Array<[Point3, Point3]>;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!Number.isFinite(length) || length <= EPS) return [];
  const sampleSpacing = Math.max(0.05, Math.min(0.5, clearance * 0.35));
  const sampleCount = Math.max(2, Math.min(1000, Math.ceil(length / sampleSpacing)));
  const out: Array<[Point3, Point3]> = [];
  let runStart: number | null = null;
  let prevT = 0;
  let prevValid = false;

  for (let i = 0; i <= sampleCount; i += 1) {
    const t = i / sampleCount;
    const point = interpolatePoint3(a, b, t);
    const valid = distanceToSectionBoundary(point2FromPoint3(point), segments) >= clearance - 1e-5;
    if (i === 0) {
      if (valid) runStart = 0;
      prevValid = valid;
      prevT = t;
      continue;
    }
    if (valid !== prevValid) {
      if (valid) {
        runStart = findBoundaryClearanceTransition(a, b, segments, clearance, prevT, t, true);
      } else if (runStart != null) {
        const endT = findBoundaryClearanceTransition(a, b, segments, clearance, prevT, t, false);
        if (endT > runStart + 1e-6) out.push([interpolatePoint3(a, b, runStart), interpolatePoint3(a, b, endT)]);
        runStart = null;
      }
    }
    prevValid = valid;
    prevT = t;
  }
  if (runStart != null && 1 > runStart + 1e-6) {
    out.push([interpolatePoint3(a, b, runStart), b]);
  }
  return out;
}

function clipSegmentBySectionStackClearance(a: Point3, b: Point3, sections: Section2[], clearance: number) {
  if (!sections.length || clearance <= EPS) return [[a, b]] as Array<[Point3, Point3]>;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!Number.isFinite(length) || length <= EPS) return [];
  const sampleSpacing = Math.max(0.05, Math.min(0.5, clearance * 0.35));
  const sampleCount = Math.max(2, Math.min(1000, Math.ceil(length / sampleSpacing)));
  const out: Array<[Point3, Point3]> = [];
  let runStart: number | null = null;
  let prevT = 0;
  let prevValid = false;

  for (let i = 0; i <= sampleCount; i += 1) {
    const t = i / sampleCount;
    const point = interpolatePoint3(a, b, t);
    const point2 = point2FromPoint3(point);
    const valid = !pointInsideProtectedSections(point2, sections)
      && distanceToProtectedSectionBoundary(point2, sections) >= clearance - 1e-5;
    if (i === 0) {
      if (valid) runStart = 0;
      prevValid = valid;
      prevT = t;
      continue;
    }
    if (valid !== prevValid) {
      if (valid) {
        runStart = findSectionStackClearanceTransition(a, b, sections, clearance, prevT, t, true);
      } else if (runStart != null) {
        const endT = findSectionStackClearanceTransition(a, b, sections, clearance, prevT, t, false);
        if (endT > runStart + 1e-6) out.push([interpolatePoint3(a, b, runStart), interpolatePoint3(a, b, endT)]);
        runStart = null;
      }
    }
    prevValid = valid;
    prevT = t;
  }
  if (runStart != null && 1 > runStart + 1e-6) {
    out.push([interpolatePoint3(a, b, runStart), b]);
  }
  return out;
}

function findTargetMaterialTransition(
  a: Point3,
  b: Point3,
  triangles: Triangle[],
  lo: number,
  hi: number,
  targetValid: boolean,
) {
  let left = lo;
  let right = hi;
  for (let index = 0; index < 10; index += 1) {
    const mid = (left + right) * 0.5;
    const point = interpolatePoint3(a, b, mid);
    const valid = !pointInsideTargetMeshMaterial(point, triangles);
    if (valid === targetValid) right = mid;
    else left = mid;
  }
  return right;
}

function clipSegmentByTargetMaterial(a: Point3, b: Point3, triangles: Triangle[], clearance: number) {
  if (!triangles.length) return [[a, b]] as Array<[Point3, Point3]>;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!Number.isFinite(length) || length <= EPS) return [];
  const sampleSpacing = Math.max(0.05, Math.min(0.5, Math.max(clearance, 0.25) * 0.35));
  const sampleCount = Math.max(2, Math.min(1000, Math.ceil(length / sampleSpacing)));
  const out: Array<[Point3, Point3]> = [];
  let runStart: number | null = null;
  let prevT = 0;
  let prevValid = false;

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const point = interpolatePoint3(a, b, t);
    const valid = !pointInsideTargetMeshMaterial(point, triangles);
    if (index === 0) {
      if (valid) runStart = 0;
      prevValid = valid;
      prevT = t;
      continue;
    }
    if (valid !== prevValid) {
      if (valid) {
        runStart = findTargetMaterialTransition(a, b, triangles, prevT, t, true);
      } else if (runStart != null) {
        const endT = findTargetMaterialTransition(a, b, triangles, prevT, t, false);
        if (endT > runStart + 1e-6) out.push([interpolatePoint3(a, b, runStart), interpolatePoint3(a, b, endT)]);
        runStart = null;
      }
    }
    prevValid = valid;
    prevT = t;
  }
  if (runStart != null && 1 > runStart + 1e-6) {
    out.push([interpolatePoint3(a, b, runStart), b]);
  }
  return out;
}

function clipOutsideCutSegment(
  a: Point3,
  b: Point3,
  protectedSections: Section2[],
  targetTriangles: Triangle[],
  clearance: number,
) {
  const boundaryClipped = clipSegmentBySectionStackClearance(a, b, protectedSections, clearance);
  const out: Array<[Point3, Point3]> = [];
  for (const [start, end] of boundaryClipped) {
    out.push(...clipSegmentByTargetMaterial(start, end, targetTriangles, clearance));
  }
  return out;
}

function computeStockBounds(targetBounds: THREE.Box3, params: AnyRecord, toolDiameter: number) {
  const stockMargin = clampNonNegative(params.stockMargin, toolDiameter * 2);
  const stockBounds = targetBounds.clone();
  stockBounds.min.x -= stockMargin;
  stockBounds.min.y -= stockMargin;
  stockBounds.max.x += stockMargin;
  stockBounds.max.y += stockMargin;
  return stockBounds;
}

function loopFitsWithinToolCenterBounds(loop: Point2[], bounds: THREE.Box3, toolRadius: number) {
  const minX = bounds.min.x + toolRadius - 1e-6;
  const minY = bounds.min.y + toolRadius - 1e-6;
  const maxX = bounds.max.x - toolRadius + 1e-6;
  const maxY = bounds.max.y - toolRadius + 1e-6;
  return loop.every((point) => (
    point.x >= minX
    && point.x <= maxX
    && point.y >= minY
    && point.y <= maxY
  ));
}

function buildRasterPathsForLevel({
  segments,
  z,
  bounds,
  stockBounds,
  params,
  pathStartIndex,
  targetTriangles = [],
  protectedSections = [],
}: {
  segments: Segment2[];
  z: number;
  bounds: THREE.Box3;
  stockBounds: THREE.Box3;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles?: Triangle[];
  protectedSections?: Section2[];
}): CamToolpathPath[] {
  const toolDiameter = clampPositive(params.toolDiameter, 3.175);
  const stepover = Math.min(clampPositive(params.stepover, toolDiameter * 0.5), toolDiameter);
  const toolRadius = toolDiameter * 0.5;
  const clearance = Math.max(0, toolRadius + finiteNumber(params.stockAllowance, 0));
  const axis = String(params.rasterAxis || 'X').trim().toUpperCase() === 'Y' ? 'Y' : 'X';
  const cutRegion = normalizeCutRegion(params.cutRegion);
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const paths: CamToolpathPath[] = [];
  const fallbackProtectedSections = protectedSections.length
    ? protectedSections
    : [{ z, segments, loops: buildSectionLoops(segments) }];
  let alternating = false;

  if (axis === 'X') {
    const minY = cutRegion === 'inside' ? bounds.min.y + clearance : stockBounds.min.y + toolRadius;
    const maxY = cutRegion === 'inside' ? bounds.max.y - clearance : stockBounds.max.y - toolRadius;
    const minX = cutRegion === 'inside' ? bounds.min.x + clearance : stockBounds.min.x + toolRadius;
    const maxX = cutRegion === 'inside' ? bounds.max.x - clearance : stockBounds.max.x - toolRadius;
    for (let y = minY; y <= maxY + EPS; y += stepover) {
      const xs = lineIntersectionsAlongX(segments, y);
      const intervals = cutRegion === 'inside'
        ? insideIntervals(xs, clearance)
        : outsideIntervalsFromProtectedIntervals(
          protectedIntervalsAlongX(fallbackProtectedSections, y),
          minX,
          maxX,
          clearance,
        );
      for (const [start, end] of intervals) {
        const p0: Point3 = alternating ? [roundCoord(end), roundCoord(y), roundCoord(z)] : [roundCoord(start), roundCoord(y), roundCoord(z)];
        const p1: Point3 = alternating ? [roundCoord(start), roundCoord(y), roundCoord(z)] : [roundCoord(end), roundCoord(y), roundCoord(z)];
        const clippedSegments = cutRegion === 'outside'
          ? clipOutsideCutSegment(p0, p1, fallbackProtectedSections, targetTriangles, clearance)
          : clipSegmentByBoundaryClearance(p0, p1, segments, clearance);
        for (const [a, b] of clippedSegments) {
          paths.push({
            id: `P${pathStartIndex + paths.length + 1}`,
            z: roundCoord(z),
            feedRate,
            plungeRate,
            points: [a, b],
          });
        }
        alternating = !alternating;
      }
    }
    return paths;
  }

  const minX = cutRegion === 'inside' ? bounds.min.x + clearance : stockBounds.min.x + toolRadius;
  const maxX = cutRegion === 'inside' ? bounds.max.x - clearance : stockBounds.max.x - toolRadius;
  const minY = cutRegion === 'inside' ? bounds.min.y + clearance : stockBounds.min.y + toolRadius;
  const maxY = cutRegion === 'inside' ? bounds.max.y - clearance : stockBounds.max.y - toolRadius;
  for (let x = minX; x <= maxX + EPS; x += stepover) {
    const ys = lineIntersectionsAlongY(segments, x);
    const intervals = cutRegion === 'inside'
      ? insideIntervals(ys, clearance)
      : outsideIntervalsFromProtectedIntervals(
        protectedIntervalsAlongY(fallbackProtectedSections, x),
        minY,
        maxY,
        clearance,
      );
    for (const [start, end] of intervals) {
      const p0: Point3 = alternating ? [roundCoord(x), roundCoord(end), roundCoord(z)] : [roundCoord(x), roundCoord(start), roundCoord(z)];
      const p1: Point3 = alternating ? [roundCoord(x), roundCoord(start), roundCoord(z)] : [roundCoord(x), roundCoord(end), roundCoord(z)];
      const clippedSegments = cutRegion === 'outside'
        ? clipOutsideCutSegment(p0, p1, fallbackProtectedSections, targetTriangles, clearance)
        : clipSegmentByBoundaryClearance(p0, p1, segments, clearance);
      for (const [a, b] of clippedSegments) {
        paths.push({
          id: `P${pathStartIndex + paths.length + 1}`,
          z: roundCoord(z),
          feedRate,
          plungeRate,
          points: [a, b],
        });
      }
      alternating = !alternating;
    }
  }
  return paths;
}

function buildContourPathsForLevel({
  segments,
  z,
  stockBounds,
  params,
  pathStartIndex,
  targetTriangles = [],
  protectedSections = [],
}: {
  segments: Segment2[];
  z: number;
  stockBounds: THREE.Box3;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles?: Triangle[];
  protectedSections?: Section2[];
}): CamToolpathPath[] {
  const toolDiameter = clampPositive(params.toolDiameter, 3.175);
  const stepover = Math.min(clampPositive(params.stepover, toolDiameter * 0.5), toolDiameter);
  const toolRadius = toolDiameter * 0.5;
  const clearance = Math.max(0, toolRadius + finiteNumber(params.stockAllowance, 0));
  const cutRegion = normalizeCutRegion(params.cutRegion);
  const lowHop = normalizeCamStrategy(params.strategy) === 'waterline-contour-low-hop';
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const paths: CamToolpathPath[] = [];
  const loops = buildSectionLoops(segments);
  const maxPasses = Math.max(1, Math.min(500, Math.ceil(Math.max(stockBounds.max.x - stockBounds.min.x, stockBounds.max.y - stockBounds.min.y) / Math.max(stepover, EPS)) + 4));

  for (const loop of loops) {
    const linkedPasses: Point3[][] = [];
    let passGrowthSign: number | null = null;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const baseDistance = clearance + pass * stepover;
      const signs = passGrowthSign == null
        ? (cutRegion === 'inside' ? [-1, 1] : [1, -1])
        : [passGrowthSign];
      let offset: Point2[] | null = null;
      let offsetSign = passGrowthSign;
      for (const sign of signs) {
        const candidate = offsetClosedLoop(loop, sign * baseDistance);
        if (!candidate || candidate.length < 3) continue;
        if (!loopRespectsCutRegion(candidate, loops, segments, cutRegion, clearance, z, targetTriangles, protectedSections)) continue;
        offset = candidate;
        offsetSign = sign;
        break;
      }
      if (!offset || offset.length < 3) break;
      passGrowthSign = offsetSign;
      if (cutRegion === 'outside' && !loopFitsWithinToolCenterBounds(offset, stockBounds, toolRadius)) break;
      const points: Point3[] = offset.map((point) => [
        roundCoord(point.x),
        roundCoord(point.y),
        roundCoord(z),
      ]);
      points.push([...points[0]] as Point3);
      if (lowHop) {
        linkedPasses.push(points);
        continue;
      }
      paths.push({
        id: `P${pathStartIndex + paths.length + 1}`,
        z: roundCoord(z),
        feedRate,
        plungeRate,
        points,
      });
    }
    if (lowHop && linkedPasses.length) {
      const linkedPoints: Point3[] = [];
      for (const passPoints of linkedPasses) {
        if (!linkedPoints.length) {
          linkedPoints.push(...passPoints);
          continue;
        }
        if (!pointsEqual(linkedPoints[linkedPoints.length - 1], passPoints[0])) {
          if (!segmentRespectsCutRegion(
            point2FromPoint3(linkedPoints[linkedPoints.length - 1]),
            point2FromPoint3(passPoints[0]),
            loops,
            segments,
            cutRegion,
            clearance,
            z,
            targetTriangles,
            protectedSections,
          )) {
            if (linkedPoints.length >= 2) {
              paths.push({
                id: `P${pathStartIndex + paths.length + 1}`,
                z: roundCoord(z),
                feedRate,
                plungeRate,
                points: linkedPoints.splice(0, linkedPoints.length),
              });
            }
          }
          linkedPoints.push(passPoints[0]);
        }
        linkedPoints.push(...passPoints.slice(1));
      }
      if (linkedPoints.length >= 2) {
        paths.push({
          id: `P${pathStartIndex + paths.length + 1}`,
          z: roundCoord(z),
          feedRate,
          plungeRate,
          points: linkedPoints,
        });
      }
    }
  }
  return paths;
}

function buildZLevels(bounds: THREE.Box3, params: AnyRecord) {
  const topInput = nullableFiniteNumber(params.topZ);
  const bottomInput = nullableFiniteNumber(params.bottomZ);
  const topZ = topInput == null ? bounds.max.z : topInput;
  const bottomZ = bottomInput == null ? bounds.min.z : bottomInput;
  const high = Math.max(topZ, bottomZ);
  const low = Math.min(topZ, bottomZ);
  const stepDown = clampPositive(params.stepDown, 1);
  const levels: number[] = [];
  let current = high - stepDown;
  while (current > low + EPS && levels.length < 1000) {
    levels.push(roundCoord(current));
    current -= stepDown;
  }
  levels.push(roundCoord(low));
  return sortedUnique(levels).sort((a, b) => b - a);
}

function pathLength(path: CamToolpathPath) {
  let total = 0;
  for (let i = 1; i < path.points.length; i += 1) {
    const a = path.points[i - 1];
    const b = path.points[i];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

function buildSweptHullArtifacts(
  sweptSegments: Array<{ start: Point3; end: Point3; radius: number }>,
  toolLength: number,
) {
  return sweptSegments.map((segment) => {
    const start = segment.start;
    const end = segment.end;
    const radius = Math.max(0.0001, Number(segment.radius) || 0);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const min = new THREE.Vector3(
      Math.min(start[0], end[0]) - radius,
      Math.min(start[1], end[1]) - radius,
      Math.min(start[2], end[2]),
    );
    const max = new THREE.Vector3(
      Math.max(start[0], end[0]) + radius,
      Math.max(start[1], end[1]) + radius,
      Math.max(start[2], end[2]) + Math.max(0, toolLength),
    );
    const mesh = buildFlatEndmillSweepMesh(start, end, radius, toolLength);
    return {
      kind: 'flat-endmill-sweep' as const,
      start,
      end,
      radius: roundCoord(radius),
      toolLength: roundCoord(toolLength),
      length: roundCoord(length),
      positions: mesh.positions,
      indices: mesh.indices,
      vertexCount: (mesh.positions.length / 3) | 0,
      triangleCount: (mesh.indices.length / 3) | 0,
      bounds: {
        min: toPoint3(min),
        max: toPoint3(max),
      },
    };
  });
}

async function buildSweptHullArtifactsAsync(
  sweptSegments: Array<{ start: Point3; end: Point3; radius: number }>,
  toolLength: number,
  options: AnyRecord = {},
) {
  const hulls: CamToolpathResult['simulation']['sweptHulls'] = [];
  const total = Math.max(1, sweptSegments.length);
  for (let index = 0; index < sweptSegments.length; index += 1) {
    emitCamProgress(options, {
      phase: 'swept-hull-segment',
      message: 'Building swept cutter segment',
      detail: `Segment ${index + 1} of ${sweptSegments.length}`,
      current: 76 + (index / total) * 14,
    });
    await yieldCamProgress(options);
    hulls.push(...buildSweptHullArtifacts([sweptSegments[index]], toolLength));
  }
  emitCamProgress(options, {
    phase: 'swept-hulls-complete',
    message: 'Swept cutter volume ready',
    detail: `${hulls.length} segment hull${hulls.length === 1 ? '' : 's'} built.`,
    current: 90,
  });
  await yieldCamProgress(options);
  return hulls;
}

function buildFlatEndmillSweepMesh(start: Point3, end: Point3, radius: number, toolLength: number) {
  const r = Math.max(0.0001, Number(radius) || 0);
  const height = Math.max(r * 2, Math.max(0.0001, Number(toolLength) || 0));
  const sx = Number(start[0]) || 0;
  const sy = Number(start[1]) || 0;
  const ex = Number(end[0]) || 0;
  const ey = Number(end[1]) || 0;
  const bottomZ = roundCoord(Math.min(Number(start[2]) || 0, Number(end[2]) || 0));
  const topZ = roundCoord(Math.max(Number(start[2]) || 0, Number(end[2]) || 0) + height);
  const dx = ex - sx;
  const dy = ey - sy;
  const xyLength = Math.hypot(dx, dy);
  const radialSegments = 16;
  const boundary: Array<{ x: number; y: number }> = [];

  if (xyLength <= 1e-7) {
    for (let i = 0; i < radialSegments; i += 1) {
      const angle = (Math.PI * 2 * i) / radialSegments;
      boundary.push({
        x: roundCoord(sx + Math.cos(angle) * r),
        y: roundCoord(sy + Math.sin(angle) * r),
      });
    }
  } else {
    const ux = dx / xyLength;
    const uy = dy / xyLength;
    const leftAngle = Math.atan2(uy, ux) + Math.PI / 2;
    const rightAngle = Math.atan2(uy, ux) - Math.PI / 2;
    const capSteps = Math.max(4, radialSegments / 2);
    boundary.push({
      x: roundCoord(sx + Math.cos(leftAngle) * r),
      y: roundCoord(sy + Math.sin(leftAngle) * r),
    });
    for (let i = 0; i <= capSteps; i += 1) {
      const angle = leftAngle + ((rightAngle - leftAngle) * i) / capSteps;
      boundary.push({
        x: roundCoord(ex + Math.cos(angle) * r),
        y: roundCoord(ey + Math.sin(angle) * r),
      });
    }
    boundary.push({
      x: roundCoord(sx + Math.cos(rightAngle) * r),
      y: roundCoord(sy + Math.sin(rightAngle) * r),
    });
    for (let i = 0; i <= capSteps; i += 1) {
      const angle = rightAngle - (Math.PI * i) / capSteps;
      boundary.push({
        x: roundCoord(sx + Math.cos(angle) * r),
        y: roundCoord(sy + Math.sin(angle) * r),
      });
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const appendVertex = (x: number, y: number, z: number) => {
    positions.push(roundCoord(x), roundCoord(y), roundCoord(z));
    return positions.length / 3 - 1;
  };
  const bottom: number[] = [];
  const top: number[] = [];
  for (const point of boundary) {
    bottom.push(appendVertex(point.x, point.y, bottomZ));
    top.push(appendVertex(point.x, point.y, topZ));
  }
  const bottomCenter = appendVertex(
    boundary.reduce((sum, point) => sum + point.x, 0) / Math.max(1, boundary.length),
    boundary.reduce((sum, point) => sum + point.y, 0) / Math.max(1, boundary.length),
    bottomZ,
  );
  const topCenter = appendVertex(
    boundary.reduce((sum, point) => sum + point.x, 0) / Math.max(1, boundary.length),
    boundary.reduce((sum, point) => sum + point.y, 0) / Math.max(1, boundary.length),
    topZ,
  );

  for (let i = 0; i < boundary.length; i += 1) {
    const next = (i + 1) % boundary.length;
    indices.push(bottom[i], bottom[next], top[next], bottom[i], top[next], top[i]);
    indices.push(bottomCenter, bottom[next], bottom[i]);
    indices.push(topCenter, top[i], top[next]);
  }
  return { positions, indices };
}

function pointsEqual(a: Point3 | null | undefined, b: Point3 | null | undefined, tolerance = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= tolerance
    && Math.abs(a[1] - b[1]) <= tolerance
    && Math.abs(a[2] - b[2]) <= tolerance;
}

function buildMotionData(paths: CamToolpathPath[], safeZ: number) {
  const motionPolyline: Point3[] = [];
  const motionSegments: Array<{ start: Point3; end: Point3; kind: 'rapid' | 'plunge' | 'cut' | 'retract' }> = [];
  const appendPoint = (point: Point3) => {
    const rounded: Point3 = [roundCoord(point[0]), roundCoord(point[1]), roundCoord(point[2])];
    if (!motionPolyline.length || !pointsEqual(motionPolyline[motionPolyline.length - 1], rounded)) {
      motionPolyline.push(rounded);
    }
  };
  const appendMove = (start: Point3, end: Point3, kind: 'rapid' | 'plunge' | 'cut' | 'retract') => {
    if (pointsEqual(start, end)) {
      appendPoint(end);
      return;
    }
    appendPoint(start);
    appendPoint(end);
    motionSegments.push({ start, end, kind });
  };

  let current: Point3 | null = null;
  const safe = roundCoord(safeZ);
  for (const path of paths || []) {
    const points = Array.isArray(path.points) ? path.points : [];
    if (points.length < 2) continue;
    const first = points[0];
    const safeAboveFirst: Point3 = [roundCoord(first[0]), roundCoord(first[1]), safe];
    if (current) {
      const retract: Point3 = [roundCoord(current[0]), roundCoord(current[1]), safe];
      appendMove(current, retract, 'retract');
      appendMove(retract, safeAboveFirst, 'rapid');
    } else {
      appendPoint(safeAboveFirst);
    }
    appendMove(safeAboveFirst, first, 'plunge');
    for (let i = 1; i < points.length; i += 1) {
      appendMove(points[i - 1], points[i], 'cut');
    }
    current = points[points.length - 1];
  }
  if (current) {
    const retract: Point3 = [roundCoord(current[0]), roundCoord(current[1]), safe];
    appendMove(current, retract, 'retract');
  }
  return { motionPolyline, motionSegments };
}

function buildSimulationData(paths: CamToolpathPath[], toolDiameter: number, toolLength: number, safeZ: number) {
  const radius = Math.max(0.0001, toolDiameter * 0.5);
  const samples: Point3[] = [];
  const sweptSegments: Array<{ start: Point3; end: Point3; radius: number }> = [];
  const motion = buildMotionData(paths, safeZ);
  const seenSamples = new Set<string>();
  const addSample = (point: Point3) => {
    const key = point.map((value) => formatCoord(value)).join(',');
    if (seenSamples.has(key)) return;
    seenSamples.add(key);
    samples.push(point);
  };
  for (const path of paths || []) {
    const points = Array.isArray(path.points) ? path.points : [];
    for (let i = 0; i < points.length; i += 1) {
      addSample(points[i]);
    }
  }
  for (const segment of motion.motionSegments) {
    if (segment.kind !== 'cut' && segment.kind !== 'plunge') continue;
    if (pointsEqual(segment.start, segment.end)) continue;
    sweptSegments.push({
      start: segment.start,
      end: segment.end,
      radius,
    });
  }
  const sweptHulls = buildSweptHullArtifacts(sweptSegments, toolLength);
  return {
    samples,
    motionPolyline: motion.motionPolyline,
    motionSegments: motion.motionSegments,
    sweptSegments,
    sweptHulls,
  };
}

async function buildSimulationDataAsync(
  paths: CamToolpathPath[],
  toolDiameter: number,
  toolLength: number,
  safeZ: number,
  options: AnyRecord = {},
) {
  const radius = Math.max(0.0001, toolDiameter * 0.5);
  const samples: Point3[] = [];
  const sweptSegments: Array<{ start: Point3; end: Point3; radius: number }> = [];

  emitCamProgress(options, {
    phase: 'simulation-motion',
    message: 'Building cutter motion segments',
    detail: 'Expanding toolpath polylines into rapid, plunge, cut, and retract moves.',
    current: 68,
  });
  await yieldCamProgress(options);

  const motion = buildMotionData(paths, safeZ);
  const seenSamples = new Set<string>();
  const addSample = (point: Point3) => {
    const key = point.map((value) => formatCoord(value)).join(',');
    if (seenSamples.has(key)) return;
    seenSamples.add(key);
    samples.push(point);
  };
  for (const path of paths || []) {
    const points = Array.isArray(path.points) ? path.points : [];
    for (let i = 0; i < points.length; i += 1) {
      addSample(points[i]);
    }
  }
  for (const segment of motion.motionSegments) {
    if (segment.kind !== 'cut' && segment.kind !== 'plunge') continue;
    if (pointsEqual(segment.start, segment.end)) continue;
    sweptSegments.push({
      start: segment.start,
      end: segment.end,
      radius,
    });
  }

  emitCamProgress(options, {
    phase: 'swept-hulls',
    message: 'Building swept cutter hulls',
    detail: `${sweptSegments.length} cutter movement segment${sweptSegments.length === 1 ? '' : 's'} will be converted into flat-endmill sweep solids.`,
    current: 76,
  });
  await yieldCamProgress(options);
  const sweptHulls = await buildSweptHullArtifactsAsync(sweptSegments, toolLength, options);

  emitCamProgress(options, {
    phase: 'simulation-complete',
    message: 'Simulation data ready',
    detail: `${motion.motionSegments.length} motion segment${motion.motionSegments.length === 1 ? '' : 's'}, ${sweptHulls.length} swept hull${sweptHulls.length === 1 ? '' : 's'}.`,
    current: 92,
  });
  await yieldCamProgress(options);

  return {
    samples,
    motionPolyline: motion.motionPolyline,
    motionSegments: motion.motionSegments,
    sweptSegments,
    sweptHulls,
  };
}

function appendGcodePathMoves(
  lines: string[],
  paths: CamToolpathPath[],
  safeZ: number,
  profile: CamMachineProfile,
  commentPrefix = '',
) {
  for (const path of paths) {
    if (!Array.isArray(path.points) || path.points.length < 2) continue;
    const first = path.points[0];
    if (!profile.stripComments) lines.push(`; ${commentPrefix}${path.id} Z${formatCoord(path.z)}`);
    lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));
    lines.push(formatLine(['G0', `X${formatCoord(first[0])}`, `Y${formatCoord(first[1])}`], '', profile));
    lines.push(formatLine(['G1', `Z${formatCoord(first[2])}`, `F${formatCoord(path.plungeRate)}`], '', profile));
    lines.push(formatLine(['G1', `F${formatCoord(path.feedRate)}`], '', profile));
    for (let i = 1; i < path.points.length; i += 1) {
      const point = path.points[i];
      lines.push(formatLine(['G1', `X${formatCoord(point[0])}`, `Y${formatCoord(point[1])}`, `Z${formatCoord(point[2])}`], '', profile));
    }
  }
}

export function generateGcodeForToolpath(result: Omit<CamToolpathResult, 'gcode'>, params: AnyRecord = {}) {
  const profile = normalizeCamMachineProfile(params.machineProfile || result.machine);
  const spindleRPM = resultSpindleRPM(result, params, profile);
  const safeZ = Math.max(finiteNumber(result.safeZ, 5), finiteNumber(profile.safeParkZ, 0));
  const lines: string[] = [];
  if (!profile.stripComments) {
    lines.push('; Generated by BREP CAM');
    lines.push(`; Machine: ${profile.name} (${profile.controller})`);
    lines.push(`; Operation: ${result.operationName || result.operationId || 'CAM'}`);
    lines.push(`; Paths: ${result.paths.length}`);
  }
  for (const macro of splitMachineMacroLines(profile.header)) lines.push(macro);
  lines.push(formatLine(['G21'], 'units: millimeters', profile));
  lines.push(formatLine(['G90'], 'absolute coordinates', profile));
  lines.push(formatLine(['G17'], 'XY plane', profile));
  lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));
  if (spindleRPM > 0) lines.push(formatLine(['M3', `S${spindleRPM}`], 'spindle on', profile));
  appendGcodePathMoves(lines, result.paths, safeZ, profile);
  lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));
  if (spindleRPM > 0) lines.push(formatLine(['M5'], 'spindle off', profile));
  for (const macro of splitMachineMacroLines(profile.footer)) lines.push(macro);
  lines.push(formatLine(['M2'], 'program end', profile));
  return `${lines.join('\n')}\n`;
}

function generateGcodeForCombinedToolpaths(results: CamToolpathResult[], program: Omit<CamToolpathResult, 'gcode'>, options: AnyRecord = {}) {
  const profile = normalizeCamMachineProfile(options.machineProfile || program.machine);
  const safeZ = Math.max(finiteNumber(program.safeZ, 5), finiteNumber(profile.safeParkZ, 0));
  const lines: string[] = [];
  if (!profile.stripComments) {
    lines.push('; Generated by BREP CAM');
    lines.push(`; Machine: ${profile.name} (${profile.controller})`);
    lines.push(`; Program: ${program.operationName || program.operationId || 'CAM Program'}`);
    lines.push(`; Operations: ${results.length}`);
    lines.push(`; Paths: ${program.paths.length}`);
  }
  for (const macro of splitMachineMacroLines(profile.header)) lines.push(macro);
  lines.push(formatLine(['G21'], 'units: millimeters', profile));
  lines.push(formatLine(['G90'], 'absolute coordinates', profile));
  lines.push(formatLine(['G17'], 'XY plane', profile));
  lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));

  let activeSpindle = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result?.paths?.length) continue;
    const spindleRPM = resultSpindleRPM(result, {}, profile);
    if (!profile.stripComments) {
      lines.push(`; ---- Operation ${index + 1}: ${result.operationName || result.operationId || 'CAM'} ----`);
    }
    if (spindleRPM > 0 && spindleRPM !== activeSpindle) {
      lines.push(formatLine(['M3', `S${spindleRPM}`], activeSpindle ? 'spindle speed change' : 'spindle on', profile));
      activeSpindle = spindleRPM;
    } else if (spindleRPM <= 0 && activeSpindle > 0) {
      lines.push(formatLine(['M5'], 'spindle off', profile));
      activeSpindle = 0;
    }
    appendGcodePathMoves(lines, result.paths, safeZ, profile, `${result.operationId || `OP${index + 1}`}:`);
  }

  lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));
  if (activeSpindle > 0) lines.push(formatLine(['M5'], 'spindle off', profile));
  for (const macro of splitMachineMacroLines(profile.footer)) lines.push(macro);
  lines.push(formatLine(['M2'], 'program end', profile));
  return `${lines.join('\n')}\n`;
}

export function generateThreeAxisToolpath(viewer: any, params: AnyRecord = {}): CamToolpathResult {
  const warnings: string[] = [];
  const operationId = String(params.id || 'CAM3');
  const operationName = String(params.name || operationId || '3 Axis CAM Operation');
  const machine = normalizeCamMachineProfile(params.machineProfile);
  const targetData = collectTargetTriangles(viewer, params, warnings);
  const triangles = targetData.triangles;

  const bounds = computeTriangleBounds(triangles);
  const toolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const spindleRPM = resultSpindleRPM({}, params, machine);
  if (!bounds || !triangles.length) {
    const safeZ = finiteNumber(params.safeHeight, 5);
    warnings.push('No machinable solids were found.');
    const empty: Omit<CamToolpathResult, 'gcode'> = {
      operationId,
      operationName,
      units: 'mm',
      generatedAt: new Date().toISOString(),
      bounds: null,
      targetBounds: null,
      safeZ,
      machine,
      toolDiameter,
      toolLength,
      spindleRPM,
      paths: [],
      simulation: {
        samples: [],
        motionPolyline: [],
        motionSegments: [],
        sweptSegments: [],
        sweptHulls: [],
      },
      summary: {
        targetCount: targetData.targetCount,
        triangleCount: triangles.length,
        levelCount: 0,
        pathCount: 0,
        moveCount: 0,
        motionSegmentCount: 0,
        sweptSegmentCount: 0,
        sweptHullCount: 0,
        estimatedCutLength: 0,
        warningCount: warnings.length,
      },
      warnings,
    };
    return { ...empty, gcode: generateGcodeForToolpath(empty, params) };
  }

  const safeZ = roundCoord(Math.max(bounds.max.z, nullableFiniteNumber(params.topZ) ?? bounds.max.z) + Math.max(0.1, finiteNumber(params.safeHeight, 5)));
  const stockBounds = computeStockBounds(bounds, params, toolDiameter);
  const levels = buildZLevels(bounds, params);
  const strategy = normalizeCamStrategy(params.strategy);
  const paths: CamToolpathPath[] = [];
  const protectedSections: Section2[] = [];
  const topSegments = sliceMeshAtZ(triangles, bounds.max.z);
  if (topSegments.length) {
    protectedSections.push({ z: bounds.max.z, segments: topSegments, loops: buildSectionLoops(topSegments) });
  }
  for (const z of levels) {
    const segments = sliceMeshAtZ(triangles, z);
    if (!segments.length) continue;
    const section = { z, segments, loops: buildSectionLoops(segments) };
    protectedSections.push(section);
    const levelProtectedSections = protectedSections.slice();
    const levelPaths = strategy === 'waterline-contour' || strategy === 'waterline-contour-low-hop'
      ? buildContourPathsForLevel({
        segments,
        z,
        stockBounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        protectedSections: levelProtectedSections,
      })
      : buildRasterPathsForLevel({
        segments,
        z,
        bounds,
        stockBounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        protectedSections: levelProtectedSections,
      });
    paths.push(...levelPaths);
  }

  if (!paths.length) {
    warnings.push('No toolpath intervals were generated. Check tool diameter, stepover, and selected solids.');
  }

  const cutLength = paths.reduce((sum, path) => sum + pathLength(path), 0);
  const simulation = buildSimulationData(paths, toolDiameter, toolLength, safeZ);
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId,
    operationName,
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds: toSerializableBounds(stockBounds),
    targetBounds: toSerializableBounds(bounds),
    safeZ,
    toolDiameter,
    toolLength,
    spindleRPM,
    paths,
    machine,
    simulation,
    summary: {
      targetCount: targetData.targetCount,
      triangleCount: triangles.length,
      levelCount: levels.length,
      pathCount: paths.length,
      moveCount: paths.reduce((sum, path) => sum + Math.max(0, path.points.length - 1), 0),
      motionSegmentCount: simulation.motionSegments.length,
      sweptSegmentCount: simulation.sweptSegments.length,
      sweptHullCount: simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(cutLength),
      warningCount: warnings.length,
    },
    warnings,
  };
  return { ...base, gcode: generateGcodeForToolpath(base, params) };
}

export async function generateThreeAxisToolpathAsync(viewer: any, params: AnyRecord = {}): Promise<CamToolpathResult> {
  const warnings: string[] = [];
  const operationId = String(params.id || 'CAM3');
  const operationName = String(params.name || operationId || '3 Axis CAM Operation');

  emitCamProgress(params, {
    phase: 'setup',
    message: 'Preparing CAM operation',
    detail: operationName,
    current: 0,
  });
  await yieldCamProgress(params);

  const machine = normalizeCamMachineProfile(params.machineProfile);
  emitCamProgress(params, {
    phase: 'targets',
    message: 'Collecting target meshes',
    detail: serializedTargetMeshesFromParams(params)
      ? 'Reading serialized CAM mesh data.'
      : 'Reading selected CAM solids from the current part.',
    current: 4,
  });
  await yieldCamProgress(params);

  const triangles: Triangle[] = [];
  const serializedTargets = serializedTargetMeshesFromParams(params);
  let targetCount = 0;
  if (serializedTargets) {
    targetCount = Math.max(0, Math.round(finiteNumber(params.targetCount, serializedTargets.length)));
    const meshCount = Math.max(1, serializedTargets.length);
    for (let index = 0; index < serializedTargets.length; index += 1) {
      const target = serializedTargets[index];
      emitCamProgress(params, {
        phase: 'mesh-extraction',
        message: 'Loading mesh triangles',
        detail: `${target?.name || `Target ${index + 1}`} (${index + 1} of ${serializedTargets.length})`,
        current: 8 + (index / meshCount) * 12,
      });
      await yieldCamProgress(params);
      triangles.push(...readSerializedTargetTriangles(target, warnings, index));
    }
  } else {
    const solids = collectCamTargetSolids(viewer, params.targetSolids);
    targetCount = solids.length;
    const solidCount = Math.max(1, solids.length);
    for (let index = 0; index < solids.length; index += 1) {
      const solid = solids[index];
      emitCamProgress(params, {
        phase: 'mesh-extraction',
        message: 'Extracting mesh triangles',
        detail: `${solid?.name || `Solid ${index + 1}`} (${index + 1} of ${solids.length})`,
        current: 8 + (index / solidCount) * 12,
      });
      await yieldCamProgress(params);
      const extracted = extractTrianglesFromSolid(solid);
      if (!extracted.length) warnings.push(`No mesh triangles found for ${solid?.name || 'solid'}.`);
      triangles.push(...extracted);
    }
  }

  const bounds = computeTriangleBounds(triangles);
  const toolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const spindleRPM = resultSpindleRPM({}, params, machine);
  if (!bounds || !triangles.length) {
    const safeZ = finiteNumber(params.safeHeight, 5);
    warnings.push('No machinable solids were found.');
    emitCamProgress(params, {
      phase: 'empty',
      message: 'No machinable solids found',
      detail: 'CAM generation produced an empty program.',
      current: 94,
    });
    await yieldCamProgress(params);
    const empty: Omit<CamToolpathResult, 'gcode'> = {
      operationId,
      operationName,
      units: 'mm',
      generatedAt: new Date().toISOString(),
      bounds: null,
      targetBounds: null,
      safeZ,
      machine,
      toolDiameter,
      toolLength,
      spindleRPM,
      paths: [],
      simulation: {
        samples: [],
        motionPolyline: [],
        motionSegments: [],
        sweptSegments: [],
        sweptHulls: [],
      },
      summary: {
        targetCount,
        triangleCount: triangles.length,
        levelCount: 0,
        pathCount: 0,
        moveCount: 0,
        motionSegmentCount: 0,
        sweptSegmentCount: 0,
        sweptHullCount: 0,
        estimatedCutLength: 0,
        warningCount: warnings.length,
      },
      warnings,
    };
    emitCamProgress(params, {
      phase: 'gcode',
      message: 'Posting empty G-code program',
      current: 98,
    });
    await yieldCamProgress(params);
    const result = { ...empty, gcode: generateGcodeForToolpath(empty, params) };
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation complete',
      detail: '0 paths generated.',
      current: 100,
    });
    return result;
  }

  emitCamProgress(params, {
    phase: 'bounds',
    message: 'Computing stock bounds and cut depths',
    detail: `${triangles.length} mesh triangle${triangles.length === 1 ? '' : 's'} extracted.`,
    current: 22,
  });
  await yieldCamProgress(params);

  const safeZ = roundCoord(Math.max(bounds.max.z, nullableFiniteNumber(params.topZ) ?? bounds.max.z) + Math.max(0.1, finiteNumber(params.safeHeight, 5)));
  const stockBounds = computeStockBounds(bounds, params, toolDiameter);
  const levels = buildZLevels(bounds, params);
  const strategy = normalizeCamStrategy(params.strategy);
  const paths: CamToolpathPath[] = [];
  const levelCount = Math.max(1, levels.length);
  const protectedSections: Section2[] = [];
  const topSegments = sliceMeshAtZ(triangles, bounds.max.z);
  if (topSegments.length) {
    protectedSections.push({ z: bounds.max.z, segments: topSegments, loops: buildSectionLoops(topSegments) });
  }
  for (let index = 0; index < levels.length; index += 1) {
    const z = levels[index];
    emitCamProgress(params, {
      phase: 'slicing',
      message: 'Slicing toolpath level',
      detail: `Level ${index + 1} of ${levels.length} at Z ${formatCoord(z)}`,
      current: 28 + (index / levelCount) * 34,
    });
    if (index === 0 || index === levels.length - 1 || index % 4 === 0) {
      await yieldCamProgress(params);
    }
    const segments = sliceMeshAtZ(triangles, z);
    if (!segments.length) continue;
    const section = { z, segments, loops: buildSectionLoops(segments) };
    protectedSections.push(section);
    const levelProtectedSections = protectedSections.slice();
    const levelPaths = strategy === 'waterline-contour' || strategy === 'waterline-contour-low-hop'
      ? buildContourPathsForLevel({
        segments,
        z,
        stockBounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        protectedSections: levelProtectedSections,
      })
      : buildRasterPathsForLevel({
        segments,
        z,
        bounds,
        stockBounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        protectedSections: levelProtectedSections,
      });
    paths.push(...levelPaths);
  }

  if (!paths.length) {
    warnings.push('No toolpath intervals were generated. Check tool diameter, stepover, and selected solids.');
  }

  emitCamProgress(params, {
    phase: 'path-summary',
    message: 'Toolpath passes generated',
    detail: `${paths.length} path${paths.length === 1 ? '' : 's'} from ${levels.length} depth level${levels.length === 1 ? '' : 's'}.`,
    current: 64,
  });
  await yieldCamProgress(params);

  const cutLength = paths.reduce((sum, path) => sum + pathLength(path), 0);
  const simulation = await buildSimulationDataAsync(paths, toolDiameter, toolLength, safeZ, params);
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId,
    operationName,
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds: toSerializableBounds(stockBounds),
    targetBounds: toSerializableBounds(bounds),
    safeZ,
    toolDiameter,
    toolLength,
    spindleRPM,
    paths,
    machine,
    simulation,
    summary: {
      targetCount,
      triangleCount: triangles.length,
      levelCount: levels.length,
      pathCount: paths.length,
      moveCount: paths.reduce((sum, path) => sum + Math.max(0, path.points.length - 1), 0),
      motionSegmentCount: simulation.motionSegments.length,
      sweptSegmentCount: simulation.sweptSegments.length,
      sweptHullCount: simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(cutLength),
      warningCount: warnings.length,
    },
    warnings,
  };

  emitCamProgress(params, {
    phase: 'gcode',
    message: 'Posting G-code',
    detail: 'Converting generated paths to controller commands.',
    current: 96,
  });
  await yieldCamProgress(params);

  const result = { ...base, gcode: generateGcodeForToolpath(base, params) };
  emitCamProgress(params, {
    phase: 'complete',
    message: 'CAM operation complete',
    detail: `${result.summary.pathCount} path${result.summary.pathCount === 1 ? '' : 's'}, ${result.summary.moveCount} cut move${result.summary.moveCount === 1 ? '' : 's'}.`,
    current: 100,
  });
  return result;
}

export function combineCamToolpathResults(results: CamToolpathResult[], options: AnyRecord = {}) {
  const valid = (Array.isArray(results) ? results : []).filter((result) => result && Array.isArray(result.paths));
  const paths = valid.flatMap((result) => result.paths || []);
  const simulation = {
    samples: valid.flatMap((result) => result.simulation?.samples || []),
    motionPolyline: [] as Point3[],
    motionSegments: [] as Array<{ start: Point3; end: Point3; kind: 'rapid' | 'plunge' | 'cut' | 'retract' }>,
    sweptSegments: valid.flatMap((result) => result.simulation?.sweptSegments || []),
    sweptHulls: valid.flatMap((result) => result.simulation?.sweptHulls || []),
  };
  const allBounds = valid.map((result) => result.bounds).filter(Boolean) as NonNullable<CamToolpathResult['bounds']>[];
  let bounds: CamToolpathResult['bounds'] = null;
  if (allBounds.length) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const box of allBounds) {
      min.min(new THREE.Vector3(...box.min));
      max.max(new THREE.Vector3(...box.max));
    }
    bounds = { min: toPoint3(min), max: toPoint3(max) };
  }
  const allTargetBounds = valid
    .map((result) => result.targetBounds || result.bounds)
    .filter(Boolean) as NonNullable<CamToolpathResult['targetBounds']>[];
  let targetBounds: CamToolpathResult['targetBounds'] = null;
  if (allTargetBounds.length) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const box of allTargetBounds) {
      min.min(new THREE.Vector3(...box.min));
      max.max(new THREE.Vector3(...box.max));
    }
    targetBounds = { min: toPoint3(min), max: toPoint3(max) };
  }
  const safeZ = valid.reduce((max, result) => Math.max(max, finiteNumber(result.safeZ, max)), finiteNumber(options.safeZ, 5));
  const machine = normalizeCamMachineProfile(options.machineProfile || valid[0]?.machine);
  const toolDiameter = valid.length ? valid[0].toolDiameter : 3.175;
  const toolLength = valid.length ? valid[0].toolLength : 25;
  const spindleRPM = valid.length ? resultSpindleRPM(valid[0], {}, machine) : resultSpindleRPM({}, options, machine);
  const motion = buildMotionData(paths, safeZ);
  simulation.motionPolyline = motion.motionPolyline;
  simulation.motionSegments = motion.motionSegments;
  if (!simulation.sweptHulls.length && simulation.sweptSegments.length) {
    simulation.sweptHulls = buildSweptHullArtifacts(simulation.sweptSegments, toolLength);
  }
  const warnings = valid.flatMap((result) => result.warnings || []);
  const summary = {
    targetCount: valid.reduce((sum, result) => sum + (result.summary?.targetCount || 0), 0),
    triangleCount: valid.reduce((sum, result) => sum + (result.summary?.triangleCount || 0), 0),
    levelCount: valid.reduce((sum, result) => sum + (result.summary?.levelCount || 0), 0),
    pathCount: paths.length,
    moveCount: paths.reduce((sum, path) => sum + Math.max(0, path.points.length - 1), 0),
    motionSegmentCount: simulation.motionSegments.length,
    sweptSegmentCount: simulation.sweptSegments.length,
    sweptHullCount: simulation.sweptHulls.length,
    estimatedCutLength: roundCoord(paths.reduce((sum, path) => sum + pathLength(path), 0)),
    warningCount: warnings.length,
  };
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId: 'CAM_PROGRAM',
    operationName: 'CAM Program',
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds,
    targetBounds,
    safeZ,
    machine,
    toolDiameter,
    toolLength,
    spindleRPM,
    paths,
    simulation,
    summary,
    warnings,
  };
  return {
    ...base,
    gcode: valid.length
      ? generateGcodeForCombinedToolpaths(valid, base, { ...options, machineProfile: machine })
      : generateGcodeForToolpath(base, options),
  };
}

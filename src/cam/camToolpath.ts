import * as THREE from 'three';
import {
  normalizeCamMachineProfile,
  splitMachineMacroLines,
  type CamMachineProfile,
} from './CamMachineProfile.js';
import { createCamCutterProfile } from './CamCutterProfile.js';
import { normalizeCamStockProfile } from './CamStockProfile.js';
import { createDropCutterProjector, type CamCLPoint } from './camDropCutter.js';
import { filterCamToolpathPaths } from './camPathFiltering.js';
import { orderCamToolpathPaths } from './camPathOrdering.js';
import { pushCutterBatch, pushCutterFiber, type CamFiber } from './camPushCutter.js';
import { buildCamTriangleSpatialIndex, buildCamTriangleSpatialIndexWithFallback } from './camTriangleSpatialIndex.js';
import { reconstructWeaveLoops, reconstructWeaveLoopsAsync } from './camWeaveLoops.js';

type AnyRecord = Record<string, any>;
type Point3 = [number, number, number];
type Point2 = { x: number; y: number };
type Segment2 = { a: Point2; b: Point2; z: number };
type Triangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
type Section2 = { z: number; segments: Segment2[]; loops: Point2[][] };
type CamCutterProfileInstance = ReturnType<typeof createCamCutterProfile>;
type CamToolpathPathSegmentKind = 'rapid' | 'link' | 'cut';
type CamMotionSegmentKind = 'rapid' | 'plunge' | 'cut' | 'link' | 'retract';

export type CamSerializedTargetMesh = {
  name?: string;
  triangles: number[];
  driveTriangles?: number[];
  faceNames?: string[];
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
  operationId?: string;
  operationName?: string;
  sourcePathId?: string;
  simulationSamples?: Point3[];
  z: number;
  feedRate: number;
  plungeRate: number;
  linkFeedRate?: number;
  points: Point3[];
  segmentKinds?: CamToolpathPathSegmentKind[];
  orderingPriority?: number;
};

export type CamToolpathCutterProfileSnapshot = {
  kind: string;
  diameter: number;
  radius: number;
  cuttingLength: number;
  shaftLength: number;
  cornerRadius?: number;
  includedAngleDeg?: number;
  ballDiameter?: number;
  maximumDiameter?: number;
};

export type CamSweptSegment = {
  start: Point3;
  end: Point3;
  radius: number;
  toolShape?: string;
  cutterProfile?: CamToolpathCutterProfileSnapshot;
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
  toolShape: string;
  cutterProfile: CamToolpathCutterProfileSnapshot;
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
      kind: CamMotionSegmentKind;
      feedRate?: number;
      sourcePathId?: string;
      sourceSegmentIndex?: number;
    }>;
    sweptSegments: CamSweptSegment[];
    sweptHulls: Array<{
      kind?: 'flat-endmill-sweep' | 'cutter-profile-sweep';
      start: Point3;
      end: Point3;
      radius: number;
      toolShape?: string;
      cutterProfile?: CamToolpathCutterProfileSnapshot;
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
    estimatedRapidLength: number;
    warningCount: number;
    waterlineXFiberCount?: number;
    waterlineYFiberCount?: number;
    waterlineSubdivisionCount?: number;
    waterlineMaxDepthReached?: boolean;
  };
  warnings: string[];
};

type CamWaterlineStats = {
  xFiberCount: number;
  yFiberCount: number;
  subdivisionCount: number;
  maxDepthReached: boolean;
};

const EPS = 1e-7;

export class CamGenerationAbortError extends Error {
  constructor(message = 'CAM generation canceled') {
    super(message);
    this.name = 'AbortError';
  }
}

export class CamGenerationError extends Error {
  warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = 'CamGenerationError';
    this.warnings = warnings.slice();
  }
}

function abortMessageFromSignal(signal: any) {
  const reason = signal?.reason;
  return String(reason?.message || reason || 'CAM generation canceled');
}

function throwIfCamGenerationAborted(options: AnyRecord | null | undefined) {
  const signal = options?.signal;
  if (signal?.aborted) throw new CamGenerationAbortError(abortMessageFromSignal(signal));
}

function motionSafeZForMachine(safeZ: number, machine: CamMachineProfile) {
  return Math.max(finiteNumber(safeZ, 5), finiteNumber(machine?.safeParkZ, 0));
}

function emitCamProgress(options: AnyRecord | null | undefined, event: CamToolpathProgressEvent) {
  const callback = options?.onProgress;
  if (typeof callback !== 'function') return;
  const total = Math.max(1, Number(event.total) || 100);
  const rawCurrent = Number(event.current);
  const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(total, rawCurrent)) : 0;
  try {
    callback({
      ...event,
      current,
      total,
    });
  } catch {
    // Progress callbacks are observational and should not break CAM generation.
  }
}

async function yieldCamProgress(options: AnyRecord | null | undefined) {
  throwIfCamGenerationAborted(options);
  const progressYield = options?.progressYield;
  if (typeof progressYield === 'function') {
    await progressYield();
    throwIfCamGenerationAborted(options);
    return;
  }
  await Promise.resolve();
  throwIfCamGenerationAborted(options);
}

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nullableFiniteNumber(value: any) {
  if (value == null || value === '') return null;
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

function normalizeSelectionList(value: any): any[] {
  if (Array.isArray(value)) return value.filter((item) => item != null);
  if (value == null || value === '') return [];
  return [value];
}

function hasReferenceSelection(value: any) {
  return normalizeReferenceNames(value).length > 0 || normalizeSelectionList(value).length > 0;
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

export function collectCamTargetSolids(viewer: any, targetSelection: any = null, targetFaceSelection: any = null) {
  const scene = viewer?.partHistory?.scene || viewer?.scene || null;
  const partHistory = viewer?.partHistory || null;
  const names = normalizeReferenceNames(targetSelection);
  const faceNames = normalizeReferenceNames(targetFaceSelection);
  const out: any[] = [];
  const seen = new Set<any>();
  const push = (object: any) => {
    const solid = resolveSolidCarrier(object);
    if (!solid || seen.has(solid)) return;
    seen.add(solid);
    out.push(solid);
  };

  for (const item of [...normalizeSelectionList(targetSelection), ...normalizeSelectionList(targetFaceSelection)]) {
    if (item && typeof item === 'object') push(item);
  }

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

  if (faceNames.length && out.length) return out;

  if (scene && typeof scene.traverse === 'function') {
    try {
      scene.traverse((object: any) => {
        if (isMachinableSolid(object)) push(object);
      });
    } catch { /* ignore traversal failures */ }
  }
  return out;
}

function selectedFaceIdsForSolid(solid: any, faceSelection: any = null) {
  const faceNames = normalizeReferenceNames(faceSelection);
  if (!faceNames.length) return null;
  const ids = new Set<number>();
  const nameToId = solid?._faceNameToID instanceof Map ? solid._faceNameToID : null;
  for (const name of faceNames) {
    const text = String(name || '').trim();
    if (!text) continue;
    const mapped = nameToId?.get?.(text);
    const numeric = Number.isFinite(Number(mapped)) ? Number(mapped) : Number(text);
    if (Number.isFinite(numeric)) ids.add(Math.trunc(numeric) >>> 0);
  }
  return ids;
}

function meshFaceIdArray(mesh: AnyRecord | null | undefined, solid: any, triCount: number) {
  const candidates = [mesh?.faceID, mesh?.faceIds, mesh?.triIDs, mesh?.triIds, solid?._triIDs];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.length !== 'number') continue;
    if (candidate.length < triCount) continue;
    return candidate as ArrayLike<number>;
  }
  return null;
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

export function extractTrianglesFromSolid(solid: any, options: AnyRecord = {}): Triangle[] {
  if (!solid) return [];
  try { solid.updateMatrixWorld?.(true); } catch { /* ignore */ }
  const matrix = solid?.matrixWorld || new THREE.Matrix4();
  const selectedFaceIds = selectedFaceIdsForSolid(solid, options.faceSelection);
  if (typeof solid.getMesh === 'function') {
    let mesh: AnyRecord | null = null;
    try {
      mesh = solid.getMesh();
      const vp = mesh?.vertProperties || [];
      const tv = mesh?.triVerts || [];
      const triCount = (tv.length / 3) | 0;
      const faceIds = selectedFaceIds ? meshFaceIdArray(mesh, solid, triCount) : null;
      if (selectedFaceIds && !faceIds) {
        options.warnings?.push?.(`Selected face references could not be matched on ${solid?.name || 'solid'} because mesh face IDs are unavailable.`);
        return [];
      }
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
        if (selectedFaceIds && !selectedFaceIds.has((Number(faceIds?.[t]) || 0) >>> 0)) continue;
        const base = t * 3;
        triangles.push([
          scenePointToMachine(read(Number(tv[base + 0]) >>> 0)),
          scenePointToMachine(read(Number(tv[base + 1]) >>> 0)),
          scenePointToMachine(read(Number(tv[base + 2]) >>> 0)),
        ]);
      }
      if (selectedFaceIds && !triangles.length) {
        const names = normalizeReferenceNames(options.faceSelection).join(', ');
        options.warnings?.push?.(`Selected CAM face${names ? ` (${names})` : ''} produced no drive triangles on ${solid?.name || 'solid'}.`);
      }
      return triangles;
    } catch {
      if (selectedFaceIds) {
        options.warnings?.push?.(`Selected face extraction failed for ${solid?.name || 'solid'}.`);
        return [];
      }
      return extractTrianglesFromGeometry(solid);
    } finally {
      try { mesh?.delete?.(); } catch { /* ignore mesh disposal */ }
    }
  }
  if (selectedFaceIds) {
    options.warnings?.push?.(`Selected face extraction is unavailable for ${solid?.name || 'geometry target'}.`);
    return [];
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

export function collectCamTargetMeshPayloads(viewer: any, targetSelection: any = null, targetFaceSelection: any = null): CamSerializedTargetPayload {
  const solids = collectCamTargetSolids(viewer, targetSelection, targetFaceSelection);
  const targets: CamSerializedTargetMesh[] = [];
  const faceNames = normalizeReferenceNames(targetFaceSelection);
  for (let index = 0; index < solids.length; index += 1) {
    const solid = solids[index];
    const driveTriangles = faceNames.length
      ? flattenTriangles(extractTrianglesFromSolid(solid, { faceSelection: targetFaceSelection }))
      : [];
    targets.push({
      name: String(solid?.name || `Solid ${index + 1}`),
      triangles: flattenTriangles(extractTrianglesFromSolid(solid)),
      ...(faceNames.length ? {
        faceNames,
        ...(driveTriangles.length ? { driveTriangles } : {}),
      } : {}),
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

function serializedTriangleValues(source: any) {
  if (Array.isArray(source)) return source;
  if (ArrayBuffer.isView(source)) {
    const view = source as unknown as ArrayLike<number>;
    if (typeof view.length === 'number') return Array.from(view);
  }
  return [];
}

function readSerializedTrianglesFromValues(
  values: any[],
  name: string,
  role: string,
  warnings: string[],
): Triangle[] {
  const triangles: Triangle[] = [];
  for (let offset = 0; offset + 8 < values.length; offset += 9) {
    const coords = values.slice(offset, offset + 9).map((value) => Number(value));
    if (!coords.every(Number.isFinite)) {
      warnings.push(`Skipped ${role} triangle ${Math.floor(offset / 9) + 1} for ${name}: non-finite coordinate.`);
      continue;
    }
    triangles.push([
      new THREE.Vector3(coords[0], coords[1], coords[2]),
      new THREE.Vector3(coords[3], coords[4], coords[5]),
      new THREE.Vector3(coords[6], coords[7], coords[8]),
    ]);
  }
  return triangles;
}

function readSerializedTargetTriangles(target: any, warnings: string[], index: number): Triangle[] {
  const values = serializedTriangleValues(target?.triangles);
  const name = String(target?.name || `serialized target ${index + 1}`);
  const triangles = readSerializedTrianglesFromValues(values, name, 'serialized target mesh', warnings);
  if (!triangles.length) warnings.push(`No mesh triangles found for ${name}.`);
  return triangles;
}

function readSerializedDriveTriangles(target: any, warnings: string[], index: number): Triangle[] {
  const values = serializedTriangleValues(target?.driveTriangles);
  if (!values.length) return [];
  const name = String(target?.name || `serialized target ${index + 1}`);
  const triangles = readSerializedTrianglesFromValues(values, name, 'serialized drive-face mesh', warnings);
  if (!triangles.length) warnings.push(`No selected face drive triangles found for ${name}.`);
  return triangles;
}

function collectTargetTriangles(viewer: any, params: AnyRecord, warnings: string[]) {
  const serializedTargets = serializedTargetMeshesFromParams(params);
  if (serializedTargets) {
    const triangles: Triangle[] = [];
    const driveTriangles: Triangle[] = [];
    let hasSerializedFaceDrive = false;
    for (let index = 0; index < serializedTargets.length; index += 1) {
      const target = serializedTargets[index];
      triangles.push(...readSerializedTargetTriangles(target, warnings, index));
      const targetFaceNames = Array.isArray(target?.faceNames) ? target.faceNames : [];
      const drive = readSerializedDriveTriangles(target, warnings, index);
      if (targetFaceNames.length || drive.length) hasSerializedFaceDrive = true;
      if (drive.length) {
        driveTriangles.push(...drive);
      }
    }
    return {
      targetCount: Math.max(0, Math.round(finiteNumber(params.targetCount, serializedTargets.length))),
      triangles,
      driveTriangles: hasSerializedFaceDrive ? driveTriangles : triangles,
      hasFaceDrive: hasSerializedFaceDrive,
    };
  }

  const hasFaceDrive = hasReferenceSelection(params.targetFaces);
  const solids = collectCamTargetSolids(viewer, params.targetSolids, params.targetFaces);
  const triangles: Triangle[] = [];
  const driveTriangles: Triangle[] = [];
  for (const solid of solids) {
    const extracted = extractTrianglesFromSolid(solid);
    if (!extracted.length) warnings.push(`No mesh triangles found for ${solid?.name || 'solid'}.`);
    triangles.push(...extracted);
    if (hasFaceDrive) {
      driveTriangles.push(...extractTrianglesFromSolid(solid, {
        faceSelection: params.targetFaces,
        warnings,
      }));
    }
  }
  return {
    targetCount: solids.length,
    triangles,
    driveTriangles: hasFaceDrive ? driveTriangles : triangles,
    hasFaceDrive,
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

function projectedTriangleIntervalAlongX(triangle: Triangle, y: number): [number, number] | null {
  const points = triangle.map((point) => ({ x: point.x, y: point.y }));
  const xs: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (Math.abs(a.y - y) <= EPS) xs.push(a.x);
    if (Math.abs(b.y - y) <= EPS) xs.push(b.x);
    if (Math.abs(b.y - a.y) <= EPS) {
      if (Math.abs(y - a.y) <= EPS) {
        xs.push(a.x, b.x);
      }
      continue;
    }
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (y < minY - EPS || y > maxY + EPS) continue;
    const t = (y - a.y) / (b.y - a.y);
    if (t < -EPS || t > 1 + EPS) continue;
    xs.push(a.x + (b.x - a.x) * Math.max(0, Math.min(1, t)));
  }
  const unique = sortedUnique(xs);
  if (unique.length < 2) return null;
  const start = unique[0];
  const end = unique[unique.length - 1];
  return end > start + EPS ? [start, end] : null;
}

function projectedTriangleIntervalAlongY(triangle: Triangle, x: number): [number, number] | null {
  const points = triangle.map((point) => ({ x: point.x, y: point.y }));
  const ys: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (Math.abs(a.x - x) <= EPS) ys.push(a.y);
    if (Math.abs(b.x - x) <= EPS) ys.push(b.y);
    if (Math.abs(b.x - a.x) <= EPS) {
      if (Math.abs(x - a.x) <= EPS) {
        ys.push(a.y, b.y);
      }
      continue;
    }
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (x < minX - EPS || x > maxX + EPS) continue;
    const t = (x - a.x) / (b.x - a.x);
    if (t < -EPS || t > 1 + EPS) continue;
    ys.push(a.y + (b.y - a.y) * Math.max(0, Math.min(1, t)));
  }
  const unique = sortedUnique(ys);
  if (unique.length < 2) return null;
  const start = unique[0];
  const end = unique[unique.length - 1];
  return end > start + EPS ? [start, end] : null;
}

function clipIntervalsToRange(intervals: Array<[number, number]>, min: number, max: number) {
  if (max <= min + EPS) return [];
  const clipped: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const a = Math.max(min, start);
    const b = Math.min(max, end);
    if (b > a + EPS) clipped.push([a, b]);
  }
  return clipped;
}

function projectedDriveIntervalsAlongX(triangles: Triangle[], y: number, minX: number, maxX: number) {
  const intervals: Array<[number, number]> = [];
  for (const triangle of triangles || []) {
    const interval = projectedTriangleIntervalAlongX(triangle, y);
    if (interval) intervals.push(interval);
  }
  return clipIntervalsToRange(mergeIntervals(intervals), minX, maxX);
}

function projectedDriveIntervalsAlongY(triangles: Triangle[], x: number, minY: number, maxY: number) {
  const intervals: Array<[number, number]> = [];
  for (const triangle of triangles || []) {
    const interval = projectedTriangleIntervalAlongY(triangle, x);
    if (interval) intervals.push(interval);
  }
  return clipIntervalsToRange(mergeIntervals(intervals), minY, maxY);
}

type ParallelRasterBasis = {
  direction: Point2;
  normal: Point2;
};

type ParallelSourceLine = {
  start: Point3;
  end: Point3;
};

function dot2(point: Point2, vector: Point2) {
  return point.x * vector.x + point.y * vector.y;
}

function normalizeRasterAngleDeg(params: AnyRecord) {
  const raw = nullableFiniteNumber(params.rasterAngleDeg) ?? nullableFiniteNumber(params.rasterAngle);
  if (raw == null) return null;
  return raw;
}

function parallelRasterBasis(params: AnyRecord, axis: string): ParallelRasterBasis {
  const angleDeg = normalizeRasterAngleDeg(params);
  if (angleDeg != null) {
    const radians = (angleDeg * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    return {
      direction,
      normal: { x: -direction.y, y: direction.x },
    };
  }
  if (axis === 'Y') {
    return {
      direction: { x: 0, y: 1 },
      normal: { x: 1, y: 0 },
    };
  }
  return {
    direction: { x: 1, y: 0 },
    normal: { x: 0, y: 1 },
  };
}

function projectedTriangleIntervalAlongBasis(
  triangle: Triangle,
  scan: number,
  basis: ParallelRasterBasis,
): [number, number] | null {
  const points = triangle.map((point) => {
    const p = { x: point.x, y: point.y };
    return {
      u: dot2(p, basis.direction),
      v: dot2(p, basis.normal),
    };
  });
  const values: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (Math.abs(a.v - scan) <= EPS) values.push(a.u);
    if (Math.abs(b.v - scan) <= EPS) values.push(b.u);
    if (Math.abs(b.v - a.v) <= EPS) {
      if (Math.abs(scan - a.v) <= EPS) values.push(a.u, b.u);
      continue;
    }
    const minV = Math.min(a.v, b.v);
    const maxV = Math.max(a.v, b.v);
    if (scan < minV - EPS || scan > maxV + EPS) continue;
    const t = (scan - a.v) / (b.v - a.v);
    if (t < -EPS || t > 1 + EPS) continue;
    values.push(a.u + (b.u - a.u) * Math.max(0, Math.min(1, t)));
  }
  const unique = sortedUnique(values);
  if (unique.length < 2) return null;
  const start = unique[0];
  const end = unique[unique.length - 1];
  return end > start + EPS ? [start, end] : null;
}

function parallelProjectionBounds(triangles: Triangle[], bounds: THREE.Box3, basis: ParallelRasterBasis) {
  const points: Point2[] = [];
  for (const triangle of triangles || []) {
    for (const point of triangle) points.push({ x: point.x, y: point.y });
  }
  if (!points.length) {
    points.push(
      { x: bounds.min.x, y: bounds.min.y },
      { x: bounds.min.x, y: bounds.max.y },
      { x: bounds.max.x, y: bounds.min.y },
      { x: bounds.max.x, y: bounds.max.y },
    );
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of points) {
    const u = dot2(point, basis.direction);
    const v = dot2(point, basis.normal);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV };
}

function projectedDriveIntervalsAlongBasis(
  triangles: Triangle[],
  scan: number,
  minU: number,
  maxU: number,
  basis: ParallelRasterBasis,
) {
  const intervals: Array<[number, number]> = [];
  for (const triangle of triangles || []) {
    const interval = projectedTriangleIntervalAlongBasis(triangle, scan, basis);
    if (interval) intervals.push(interval);
  }
  return clipIntervalsToRange(mergeIntervals(intervals), minU, maxU);
}

function pointFromParallelCoordinates(u: number, v: number, basis: ParallelRasterBasis, z: number): Point3 {
  return [
    roundCoord(basis.direction.x * u + basis.normal.x * v),
    roundCoord(basis.direction.y * u + basis.normal.y * v),
    roundCoord(z),
  ];
}

function buildParallelFinishSourceLines({
  bounds,
  params,
  regionTriangles,
  stepover,
  floorZ,
  zigZag,
  boundaryClearance = 0,
}: {
  bounds: THREE.Box3;
  params: AnyRecord;
  regionTriangles: Triangle[];
  stepover: number;
  floorZ: number;
  zigZag: boolean;
  boundaryClearance?: number;
}): ParallelSourceLine[] {
  const axis = String(params.rasterAxis || 'X').trim().toUpperCase() === 'Y' ? 'Y' : 'X';
  const basis = parallelRasterBasis(params, axis);
  const projection = parallelProjectionBounds(regionTriangles, bounds, basis);
  if (![projection.minU, projection.maxU, projection.minV, projection.maxV].every(Number.isFinite)) return [];
  const clearance = Math.max(0, Number(boundaryClearance) || 0);
  const minScan = projection.minV + clearance;
  const maxScan = projection.maxV - clearance;
  const minU = projection.minU + clearance;
  const maxU = projection.maxU - clearance;
  if (maxScan < minScan - EPS || maxU < minU - EPS) return [];
  const cutDirection = normalizeParallelCutDirection(params.cutDirection);
  const scanValues = steppedRange(minScan, maxScan, stepover);
  const lines: ParallelSourceLine[] = [];
  for (let index = 0; index < scanValues.length; index += 1) {
    const scan = scanValues[index];
    const reverse = cutDirection === 'auto'
      ? zigZag && index % 2 === 1
      : cutDirection === 'conventional';
    const intervals = projectedDriveIntervalsAlongBasis(
      regionTriangles,
      scan,
      projection.minU,
      projection.maxU,
      basis,
    );
    for (const [startValue, endValue] of intervals) {
      const safeStart = startValue + clearance;
      const safeEnd = endValue - clearance;
      if (safeEnd < safeStart - EPS) continue;
      const startU = reverse ? safeEnd : safeStart;
      const endU = reverse ? safeStart : safeEnd;
      lines.push({
        start: pointFromParallelCoordinates(startU, scan, basis, floorZ),
        end: pointFromParallelCoordinates(endU, scan, basis, floorZ),
      });
    }
  }
  return lines;
}

function normalizeCutRegion(value: any) {
  return String(value || '').trim().toLowerCase() === 'inside' ? 'inside' : 'outside';
}

function normalizeCamStrategy(value: any) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'parallel-finish-zig') return 'parallel-finish-zig';
  if (raw === 'parallel-finish-zig-zag') return 'parallel-finish-zig-zag';
  if (raw === 'adaptive-waterline-contour' || raw === 'waterline-contour-adaptive' || raw === 'adaptive-waterline') return 'adaptive-waterline-contour';
  if (raw === 'waterline-contour-low-hop') return 'waterline-contour-low-hop';
  if (raw === 'waterline-contour') return 'waterline-contour';
  if (raw === 'waterline-raster') return 'waterline-raster';
  return 'waterline-contour';
}

function normalizeCamLinkMode(value: any) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'low-hop' || raw === 'lowhop') return 'low-hop';
  if (raw === 'feed-link' || raw === 'feedlink') return 'feed-link';
  return 'retract';
}

function effectiveCamLinkMode(params: AnyRecord, strategy = normalizeCamStrategy(params?.strategy)) {
  if (strategy === 'waterline-contour-low-hop') return 'low-hop';
  return normalizeCamLinkMode(params?.linkMode);
}

function normalizeParallelCutDirection(value: any) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'climb') return 'climb';
  if (raw === 'conventional') return 'conventional';
  return 'auto';
}

function isParallelFinishStrategy(strategy: string) {
  return strategy === 'parallel-finish-zig' || strategy === 'parallel-finish-zig-zag';
}

function isAdaptiveWaterlineStrategy(strategy: string) {
  return strategy === 'adaptive-waterline-contour';
}

function isWaterlineContourStrategy(strategy: string) {
  return strategy === 'waterline-contour' || strategy === 'waterline-contour-low-hop' || isAdaptiveWaterlineStrategy(strategy);
}

function buildCutterProfileFromParams(params: AnyRecord, toolDiameter: number, toolLength: number) {
  return createCamCutterProfile({
    kind: params.toolShape,
    diameter: params.toolDiameter ?? toolDiameter,
    toolDiameter: params.toolDiameter ?? toolDiameter,
    cuttingLength: params.toolLength ?? toolLength,
    toolLength: params.toolLength ?? toolLength,
    shaftLength: params.shaftLength,
    cornerRadius: params.cornerRadius,
    includedAngleDeg: params.includedAngleDeg ?? params.includedAngle,
    ballDiameter: params.ballDiameter,
    maximumDiameter: params.maximumDiameter,
  });
}

function effectiveToolDiameterFromProfile(profile: ReturnType<typeof createCamCutterProfile>, fallbackDiameter: number) {
  return Math.max(EPS, Number(profile.diameter) || Number(fallbackDiameter) || 0);
}

function effectiveToolDiameterFromParams(params: AnyRecord, fallbackDiameter = 3.175) {
  const nominalToolDiameter = clampPositive(params.toolDiameter, fallbackDiameter);
  const toolLength = clampPositive(params.toolLength, 25);
  return effectiveToolDiameterFromProfile(buildCutterProfileFromParams(params, nominalToolDiameter, toolLength), nominalToolDiameter);
}

function serializeCutterProfile(profile: ReturnType<typeof createCamCutterProfile>): CamToolpathCutterProfileSnapshot {
  const out: CamToolpathCutterProfileSnapshot = {
    kind: profile.kind,
    diameter: roundCoord(profile.diameter),
    radius: roundCoord(profile.radius),
    cuttingLength: roundCoord(profile.cuttingLength),
    shaftLength: roundCoord(profile.shaftLength),
  };
  if (profile.cornerRadius != null) out.cornerRadius = roundCoord(profile.cornerRadius);
  if (profile.includedAngleDeg != null) out.includedAngleDeg = roundCoord(profile.includedAngleDeg);
  if (profile.ballDiameter != null) out.ballDiameter = roundCoord(profile.ballDiameter);
  if (profile.maximumDiameter != null) out.maximumDiameter = roundCoord(profile.maximumDiameter);
  return out;
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

function trianglePoint2(triangle: Triangle, index: number): Point2 {
  const point = triangle[index];
  return { x: point.x, y: point.y };
}

function triangleZBounds(triangle: Triangle) {
  const z0 = triangle[0].z;
  const z1 = triangle[1].z;
  const z2 = triangle[2].z;
  return {
    min: Math.min(z0, z1, z2),
    max: Math.max(z0, z1, z2),
  };
}

function pointInsideTriangleProjection(point: Point2, triangle: Triangle) {
  const a = trianglePoint2(triangle, 0);
  const b = trianglePoint2(triangle, 1);
  const c = trianglePoint2(triangle, 2);
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = point.x - a.x;
  const v2y = point.y - a.y;
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) <= EPS) return false;
  const u = (v2x * v1y - v1x * v2y) / denom;
  const v = (v0x * v2y - v2x * v0y) / denom;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
}

function distSqPointToTriangleProjection(point: Point2, triangle: Triangle) {
  if (pointInsideTriangleProjection(point, triangle)) return 0;
  const a = trianglePoint2(triangle, 0);
  const b = trianglePoint2(triangle, 1);
  const c = trianglePoint2(triangle, 2);
  return Math.min(
    distSqPointToSegment2(point, a, b),
    distSqPointToSegment2(point, b, c),
    distSqPointToSegment2(point, c, a),
  );
}

function maxCutterRadiusForHeightRange(
  cutterProfile: CamCutterProfileInstance,
  minHeight: number,
  maxHeight: number,
) {
  const low = Math.max(0, minHeight);
  const high = Math.max(low, maxHeight);
  const samples = [low, high, (low + high) * 0.5];
  for (const segment of cutterProfile.segments || []) {
    const segmentLow = Math.max(low, Number(segment.minHeight));
    const segmentHigh = Math.min(high, Number(segment.maxHeight));
    if (Number.isFinite(segmentLow) && Number.isFinite(segmentHigh) && segmentHigh >= segmentLow - EPS) {
      samples.push(segmentLow, segmentHigh, (segmentLow + segmentHigh) * 0.5);
    }
  }
  let radius = 0;
  for (const height of samples) {
    const heightRadius = cutterProfile.maxRadiusAtHeight(height);
    if (heightRadius != null && Number.isFinite(heightRadius)) {
      radius = Math.max(radius, heightRadius);
    }
  }
  return radius;
}

function cutterAtPointIntersectsTargetMeshMaterial(
  point: Point3,
  triangles: Triangle[],
  cutterProfile: CamCutterProfileInstance | null,
  fallbackRadius: number,
  targetMaxZ: number,
) {
  if (!triangles.length) return false;
  if (!cutterProfile) return pointInsideTargetMeshMaterial(point, triangles);
  const tipZ = Number(point[2]);
  if (!Number.isFinite(tipZ)) return false;
  const totalHeight = Math.max(
    0,
    finiteNumber(cutterProfile.cuttingLength, 0) + finiteNumber(cutterProfile.shaftLength, 0),
  );
  const upperZ = tipZ + Math.max(totalHeight, Math.max(0, fallbackRadius) * 2);
  const boundedUpperZ = Number.isFinite(targetMaxZ) ? Math.min(upperZ, targetMaxZ + 1e-5) : upperZ;
  if (boundedUpperZ < tipZ - EPS) return false;
  if (cutterAxisIntervalIntersectsTargetMeshMaterial(point, triangles, boundedUpperZ)) return true;
  const point2 = point2FromPoint3(point);
  const radiusTolerance = 0.02;
  for (const triangle of triangles) {
    const zBounds = triangleZBounds(triangle);
    if (zBounds.max < tipZ - EPS || zBounds.min > boundedUpperZ + EPS) continue;
    const overlapMinHeight = Math.max(0, zBounds.min - tipZ);
    const overlapMaxHeight = Math.min(Math.max(totalHeight, fallbackRadius * 2), zBounds.max - tipZ);
    const radius = Math.max(
      fallbackRadius,
      maxCutterRadiusForHeightRange(cutterProfile, overlapMinHeight, overlapMaxHeight),
    );
    const unsafeRadius = Math.max(0, radius - radiusTolerance);
    if (unsafeRadius <= EPS) continue;
    if (distSqPointToTriangleProjection(point2, triangle) < unsafeRadius * unsafeRadius) return true;
  }
  return false;
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

function cutterAxisIntervalIntersectsTargetMeshMaterial(point: Point3, triangles: Triangle[], upperZ: number) {
  if (!triangles.length) return false;
  const low = Number(point[2]);
  const high = Number(upperZ);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return false;
  const minZ = Math.min(low, high);
  const maxZ = Math.max(low, high);
  if (maxZ < minZ + EPS) return false;
  const zs = verticalMeshIntersectionsAtXY(triangles, { x: point[0], y: point[1] });
  for (let index = 0; index + 1 < zs.length; index += 2) {
    const materialLow = zs[index];
    const materialHigh = zs[index + 1];
    if (materialHigh > minZ + 1e-5 && materialLow < maxZ - 1e-5) return true;
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
  cutterProfile: CamCutterProfileInstance | null = null,
  targetMaxZ = Infinity,
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
      && cutterAtPointIntersectsTargetMeshMaterial(
        [point.x, point.y, z],
        targetTriangles,
        cutterProfile,
        clearance,
        targetMaxZ,
      )
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
  cutterProfile: CamCutterProfileInstance | null = null,
  targetMaxZ = Infinity,
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
      cutterProfile,
      targetMaxZ,
    )) {
      return false;
    }
  }
  return true;
}

function loopBounds2(loop: Point2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of loop || []) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, minY, maxX, maxY };
}

function loopsApproximatelySame(a: Point2[], b: Point2[], tolerance: number) {
  const aBounds = loopBounds2(a);
  const bBounds = loopBounds2(b);
  if (!aBounds || !bBounds) return false;
  return Math.abs(aBounds.minX - bBounds.minX) <= tolerance
    && Math.abs(aBounds.minY - bBounds.minY) <= tolerance
    && Math.abs(aBounds.maxX - bBounds.maxX) <= tolerance
    && Math.abs(aBounds.maxY - bBounds.maxY) <= tolerance;
}

function outsideContourSeedIsValid({
  loop,
  materialLoops,
  segments,
  clearance,
  z,
  targetTriangles,
  protectedSections,
  stockBounds,
  toolRadius,
  cutterProfile,
  targetMaxZ,
}: {
  loop: Point2[];
  materialLoops: Point2[][];
  segments: Segment2[];
  clearance: number;
  z: number;
  targetTriangles: Triangle[];
  protectedSections: Section2[];
  stockBounds: THREE.Box3;
  toolRadius: number;
  cutterProfile: CamCutterProfileInstance;
  targetMaxZ: number;
}) {
  return loop.length >= 3
    && loopRespectsCutRegion(loop, materialLoops, segments, 'outside', clearance, z, targetTriangles, protectedSections, cutterProfile, targetMaxZ)
    && loopFitsWithinToolCenterBounds(loop, stockBounds, toolRadius);
}

function buildOutsideSectionCutterCenterSeedLoops({
  materialLoops,
  segments,
  clearance,
  z,
  targetTriangles,
  protectedSections,
  stockBounds,
  toolRadius,
  cutterProfile,
  targetMaxZ,
}: {
  materialLoops: Point2[][];
  segments: Segment2[];
  clearance: number;
  z: number;
  targetTriangles: Triangle[];
  protectedSections: Section2[];
  stockBounds: THREE.Box3;
  toolRadius: number;
  cutterProfile: CamCutterProfileInstance;
  targetMaxZ: number;
}) {
  if (clearance <= EPS) return [];
  const seeds: Point2[][] = [];
  for (const loop of materialLoops) {
    for (const sign of [1, -1]) {
      const candidate = offsetClosedLoop(loop, sign * clearance);
      if (!candidate || candidate.length < 3) continue;
      if (!outsideContourSeedIsValid({
        loop: candidate,
        materialLoops,
        segments,
        clearance,
        z,
        targetTriangles,
        protectedSections,
        stockBounds,
        toolRadius,
        cutterProfile,
        targetMaxZ,
      })) continue;
      seeds.push(candidate);
      break;
    }
  }
  return seeds;
}

function buildOutsideContourDriveLoops({
  weaveSeedLoops,
  materialLoops,
  segments,
  clearance,
  z,
  targetTriangles,
  protectedSections,
  stockBounds,
  toolRadius,
  cutterProfile,
  targetMaxZ,
}: {
  weaveSeedLoops: Point2[][];
  materialLoops: Point2[][];
  segments: Segment2[];
  clearance: number;
  z: number;
  targetTriangles: Triangle[];
  protectedSections: Section2[];
  stockBounds: THREE.Box3;
  toolRadius: number;
  cutterProfile: CamCutterProfileInstance;
  targetMaxZ: number;
}) {
  const validWeaveSeeds = weaveSeedLoops.filter((loop) => outsideContourSeedIsValid({
    loop,
    materialLoops,
    segments,
    clearance,
    z,
    targetTriangles,
    protectedSections,
    stockBounds,
    toolRadius,
    cutterProfile,
    targetMaxZ,
  }));
  const fallbackSeeds = buildOutsideSectionCutterCenterSeedLoops({
    materialLoops,
    segments,
    clearance,
    z,
    targetTriangles,
    protectedSections,
    stockBounds,
    toolRadius,
    cutterProfile,
    targetMaxZ,
  });
  const duplicateTolerance = Math.max(1e-4, clearance * 0.1);
  const driveLoops = validWeaveSeeds.slice();
  for (const fallback of fallbackSeeds) {
    if (driveLoops.some((seed) => loopsApproximatelySame(seed, fallback, duplicateTolerance))) continue;
    driveLoops.push(fallback);
  }
  return driveLoops;
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
  for (let i = 0; i < 20; i += 1) {
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
  for (let i = 0; i < 20; i += 1) {
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
  cutterProfile: CamCutterProfileInstance | null,
  clearance: number,
  targetMaxZ: number,
  lo: number,
  hi: number,
  targetValid: boolean,
) {
  let left = lo;
  let right = hi;
  for (let index = 0; index < 20; index += 1) {
    const mid = (left + right) * 0.5;
    const point = interpolatePoint3(a, b, mid);
    const valid = !cutterAtPointIntersectsTargetMeshMaterial(point, triangles, cutterProfile, clearance, targetMaxZ);
    if (valid === targetValid) right = mid;
    else left = mid;
  }
  return right;
}

function clipSegmentByTargetMaterial(
  a: Point3,
  b: Point3,
  triangles: Triangle[],
  clearance: number,
  cutterProfile: CamCutterProfileInstance | null,
  targetMaxZ: number,
) {
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
    const valid = !cutterAtPointIntersectsTargetMeshMaterial(point, triangles, cutterProfile, clearance, targetMaxZ);
    if (index === 0) {
      if (valid) runStart = 0;
      prevValid = valid;
      prevT = t;
      continue;
    }
    if (valid !== prevValid) {
      if (valid) {
        runStart = findTargetMaterialTransition(a, b, triangles, cutterProfile, clearance, targetMaxZ, prevT, t, true);
      } else if (runStart != null) {
        const endT = findTargetMaterialTransition(a, b, triangles, cutterProfile, clearance, targetMaxZ, prevT, t, false);
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
  cutterProfile: CamCutterProfileInstance | null,
  targetMaxZ: number,
) {
  const boundaryClipped = clipSegmentBySectionStackClearance(a, b, protectedSections, clearance);
  const out: Array<[Point3, Point3]> = [];
  for (const [start, end] of boundaryClipped) {
    out.push(...clipSegmentByTargetMaterial(start, end, targetTriangles, clearance, cutterProfile, targetMaxZ));
  }
  return out;
}

function computeStockBounds(targetBounds: THREE.Box3, params: AnyRecord, toolDiameter: number) {
  const hasStockProfile = params?.stockProfile && typeof params.stockProfile === 'object';
  const stockProfile = normalizeCamStockProfile(hasStockProfile
    ? params.stockProfile
    : { margin: params.stockMargin ?? toolDiameter * 2 });
  const stockMargin = hasStockProfile
    ? clampNonNegative(stockProfile.margin, toolDiameter * 2)
    : clampNonNegative(params.stockMargin, toolDiameter * 2);
  const stockBounds = targetBounds.clone();

  if (stockProfile.mode === 'fixed') {
    const targetSize = new THREE.Vector3();
    targetBounds.getSize(targetSize);
    const center = new THREE.Vector3();
    targetBounds.getCenter(center);
    const sizeX = Math.max(EPS, stockProfile.sizeX ?? (targetSize.x + stockMargin * 2));
    const sizeY = Math.max(EPS, stockProfile.sizeY ?? (targetSize.y + stockMargin * 2));
    const sizeZ = Math.max(EPS, stockProfile.sizeZ ?? targetSize.z);
    const centerX = center.x + stockProfile.offsetX;
    const centerY = center.y + stockProfile.offsetY;
    const bottomZ = targetBounds.min.z + stockProfile.offsetZ;
    stockBounds.min.set(centerX - sizeX * 0.5, centerY - sizeY * 0.5, bottomZ);
    stockBounds.max.set(centerX + sizeX * 0.5, centerY + sizeY * 0.5, bottomZ + sizeZ);
    return stockBounds;
  }

  stockBounds.min.x -= stockMargin;
  stockBounds.min.y -= stockMargin;
  stockBounds.max.x += stockMargin;
  stockBounds.max.y += stockMargin;
  return stockBounds;
}

function fixedStockContainmentWarnings(targetBounds: THREE.Box3, stockBounds: THREE.Box3, params: AnyRecord) {
  if (!params?.stockProfile || typeof params.stockProfile !== 'object') return [];
  const stockProfile = normalizeCamStockProfile(params.stockProfile);
  if (stockProfile.mode !== 'fixed') return [];
  const missesTarget = (
    stockBounds.min.x > targetBounds.min.x + EPS
    || stockBounds.min.y > targetBounds.min.y + EPS
    || stockBounds.min.z > targetBounds.min.z + EPS
    || stockBounds.max.x < targetBounds.max.x - EPS
    || stockBounds.max.y < targetBounds.max.y - EPS
    || stockBounds.max.z < targetBounds.max.z - EPS
  );
  return missesTarget
    ? ['Invalid CAM stock profile: fixed stock bounds must contain the selected target material. Increase stock size or adjust stock offset.']
    : [];
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

function point3WithinToolCenterBounds(point: Point3, bounds: THREE.Box3, toolRadius: number) {
  const minX = bounds.min.x + toolRadius - 1e-6;
  const minY = bounds.min.y + toolRadius - 1e-6;
  const maxX = bounds.max.x - toolRadius + 1e-6;
  const maxY = bounds.max.y - toolRadius + 1e-6;
  return point[0] >= minX
    && point[0] <= maxX
    && point[1] >= minY
    && point[1] <= maxY;
}

function pointRunLength(points: Point3[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}

function buildClippedOutsideContourRuns({
  loop,
  z,
  protectedSections,
  targetTriangles,
  clearance,
  stockBounds,
  toolRadius,
  cutterProfile,
  targetMaxZ,
}: {
  loop: Point2[];
  z: number;
  protectedSections: Section2[];
  targetTriangles: Triangle[];
  clearance: number;
  stockBounds: THREE.Box3;
  toolRadius: number;
  cutterProfile: CamCutterProfileInstance;
  targetMaxZ: number;
}) {
  if (loop.length < 3) return [];
  const sourcePoints: Point3[] = loop.map((point) => [roundCoord(point.x), roundCoord(point.y), roundCoord(z)]);
  sourcePoints.push([...sourcePoints[0]] as Point3);
  const runs: Point3[][] = [];
  let currentRun: Point3[] = [];
  const flushRun = () => {
    if (currentRun.length >= 2 && pointRunLength(currentRun) > EPS) runs.push(currentRun);
    currentRun = [];
  };

  for (let index = 1; index < sourcePoints.length; index += 1) {
    const a = sourcePoints[index - 1];
    const b = sourcePoints[index];
    const clippedSegments = clipOutsideCutSegment(a, b, protectedSections, targetTriangles, clearance, cutterProfile, targetMaxZ)
      .filter(([start, end]) => (
        point3WithinToolCenterBounds(start, stockBounds, toolRadius)
        && point3WithinToolCenterBounds(end, stockBounds, toolRadius)
        && Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) > EPS
      ));
    if (!clippedSegments.length) {
      flushRun();
      continue;
    }
    for (const [start, end] of clippedSegments) {
      if (!currentRun.length) {
        currentRun = [start, end];
        continue;
      }
      if (pointsEqual(currentRun[currentRun.length - 1], start, 1e-5)) {
        currentRun.push(end);
        continue;
      }
      flushRun();
      currentRun = [start, end];
    }
  }
  flushRun();

  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (pointsEqual(first[0], last[last.length - 1], 1e-5)) {
      runs[0] = [...last.slice(0, -1), ...first];
      runs.pop();
    }
  }
  return runs.filter((run) => run.length >= 2 && pointRunLength(run) > EPS);
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
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const toolDiameter = effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter);
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
  const targetMaxZ = bounds.max.z;
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
          ? clipOutsideCutSegment(p0, p1, fallbackProtectedSections, targetTriangles, clearance, cutterProfile, targetMaxZ)
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
        ? clipOutsideCutSegment(p0, p1, fallbackProtectedSections, targetTriangles, clearance, cutterProfile, targetMaxZ)
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
  targetMaxZ,
  params,
  pathStartIndex,
  targetTriangles = [],
  protectedSections = [],
  warnings,
  waterlineStats,
}: {
  segments: Segment2[];
  z: number;
  stockBounds: THREE.Box3;
  targetMaxZ: number;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles?: Triangle[];
  protectedSections?: Section2[];
  warnings?: string[];
  waterlineStats?: CamWaterlineStats;
}): CamToolpathPath[] {
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const toolDiameter = effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter);
  const stepover = Math.min(clampPositive(params.stepover, toolDiameter * 0.5), toolDiameter);
  const toolRadius = toolDiameter * 0.5;
  const clearance = Math.max(0, toolRadius + finiteNumber(params.stockAllowance, 0));
  const cutRegion = normalizeCutRegion(params.cutRegion);
  const strategy = normalizeCamStrategy(params.strategy);
  const linkMode = effectiveCamLinkMode(params, strategy);
  const feedLink = linkMode === 'feed-link';
  const lowHop = linkMode === 'low-hop' || feedLink;
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const linkFeedRate = feedLink ? feedRate : undefined;
  const paths: CamToolpathPath[] = [];
  const loops = buildSectionLoops(segments);
  const weaveSeedLoops = cutRegion === 'outside'
    ? buildPushWeaveWaterlineSeedLoopsForLevel({
      segments,
      z,
      stockBounds,
      params,
      materialLoops: loops,
      targetTriangles,
      warnings,
      waterlineStats,
    })
    : [];
  let driveLoops = loops;
  let useWeaveSeeds = false;
  if (cutRegion === 'outside' && weaveSeedLoops.length) {
    const validDriveLoops = buildOutsideContourDriveLoops({
      weaveSeedLoops,
      materialLoops: loops,
      segments,
      clearance,
      z,
      targetTriangles,
      protectedSections,
      stockBounds,
      toolRadius,
      cutterProfile,
      targetMaxZ,
    });
    if (validDriveLoops.length) {
      driveLoops = validDriveLoops;
      useWeaveSeeds = true;
    }
  }
  const maxPasses = Math.max(1, Math.min(500, Math.ceil(Math.max(stockBounds.max.x - stockBounds.min.x, stockBounds.max.y - stockBounds.min.y) / Math.max(stepover, EPS)) + 4));

  for (const loop of driveLoops) {
    const linkedPasses: Point3[][] = [];
    let passGrowthSign: number | null = null;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const baseDistance = (useWeaveSeeds ? Math.max(0, finiteNumber(params.stockAllowance, 0)) : clearance) + pass * stepover;
      const signs = useWeaveSeeds
        ? (passGrowthSign == null ? [1, -1] : [passGrowthSign])
        : passGrowthSign == null
        ? (cutRegion === 'inside' ? [-1, 1] : [1, -1])
        : [passGrowthSign];
      let offset: Point2[] | null = null;
      let offsetSign = passGrowthSign;
      let clippedRuns: Point3[][] | null = null;
      let fallbackOffset: Point2[] | null = null;
      let fallbackOffsetSign: number | null = null;
      let fallbackClippedRuns: Point3[][] | null = null;
      for (const sign of signs) {
        const candidate = offsetClosedLoop(loop, sign * baseDistance);
        if (!candidate || candidate.length < 3) continue;
        if (cutRegion === 'outside' && !loopFitsWithinToolCenterBounds(candidate, stockBounds, toolRadius)) continue;
        if (!loopRespectsCutRegion(candidate, loops, segments, cutRegion, clearance, z, targetTriangles, protectedSections, cutterProfile, targetMaxZ)) {
          if (cutRegion !== 'outside') continue;
          const runs = buildClippedOutsideContourRuns({
            loop: candidate,
            z,
            protectedSections,
            targetTriangles,
            clearance,
            stockBounds,
            toolRadius,
            cutterProfile,
            targetMaxZ,
          });
          if (!runs.length) continue;
          fallbackClippedRuns = fallbackClippedRuns || runs;
          fallbackOffset = fallbackOffset || candidate;
          fallbackOffsetSign = fallbackOffsetSign ?? sign;
          continue;
        }
        offset = candidate;
        offsetSign = sign;
        break;
      }
      if (!offset && fallbackOffset) {
        offset = fallbackOffset;
        offsetSign = fallbackOffsetSign;
        clippedRuns = fallbackClippedRuns;
      }
      if (!offset || offset.length < 3) break;
      if (!useWeaveSeeds || Math.abs(baseDistance) > EPS) passGrowthSign = offsetSign;
      if (clippedRuns) {
        for (const run of clippedRuns) {
          paths.push({
            id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
            z: roundCoord(z),
            orderingPriority: pass,
            feedRate,
            plungeRate,
            points: run,
          });
        }
        continue;
      }
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
        id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
        z: roundCoord(z),
        orderingPriority: pass,
        feedRate,
        plungeRate,
        points,
      });
    }
    if (lowHop && linkedPasses.length) {
      const linkedPoints: Point3[] = [];
      const linkedSegmentKinds: CamToolpathPathSegmentKind[] = [];
      const appendPath = () => {
        if (linkedPoints.length < 2) return;
        paths.push({
          id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
          z: roundCoord(z),
          orderingPriority: 0,
          feedRate,
          plungeRate,
          ...(linkFeedRate ? { linkFeedRate } : {}),
          points: linkedPoints.splice(0, linkedPoints.length),
          segmentKinds: linkedSegmentKinds.splice(0, linkedSegmentKinds.length),
        });
      };
      const appendPoint = (point: Point3, kind: CamToolpathPathSegmentKind) => {
        if (linkedPoints.length) linkedSegmentKinds.push(kind);
        linkedPoints.push(point);
      };
      for (const passPoints of linkedPasses) {
        if (!linkedPoints.length) {
          linkedPoints.push(passPoints[0]);
          for (const point of passPoints.slice(1)) appendPoint(point, 'cut');
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
            cutterProfile,
            targetMaxZ,
          )) {
            appendPath();
          }
          if (!linkedPoints.length) linkedPoints.push(passPoints[0]);
          else appendPoint(passPoints[0], 'link');
        }
        for (const point of passPoints.slice(1)) appendPoint(point, 'cut');
      }
      appendPath();
    }
  }
  return paths;
}

async function buildContourPathsForLevelAsync({
  segments,
  z,
  stockBounds,
  targetMaxZ,
  params,
  pathStartIndex,
  targetTriangles = [],
  protectedSections = [],
  warnings,
  waterlineStats,
}: {
  segments: Segment2[];
  z: number;
  stockBounds: THREE.Box3;
  targetMaxZ: number;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles?: Triangle[];
  protectedSections?: Section2[];
  warnings?: string[];
  waterlineStats?: CamWaterlineStats;
}): Promise<CamToolpathPath[]> {
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const toolDiameter = effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter);
  const stepover = Math.min(clampPositive(params.stepover, toolDiameter * 0.5), toolDiameter);
  const toolRadius = toolDiameter * 0.5;
  const clearance = Math.max(0, toolRadius + finiteNumber(params.stockAllowance, 0));
  const cutRegion = normalizeCutRegion(params.cutRegion);
  const strategy = normalizeCamStrategy(params.strategy);
  const linkMode = effectiveCamLinkMode(params, strategy);
  const feedLink = linkMode === 'feed-link';
  const lowHop = linkMode === 'low-hop' || feedLink;
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const linkFeedRate = feedLink ? feedRate : undefined;
  const paths: CamToolpathPath[] = [];
  const loops = buildSectionLoops(segments);
  const weaveSeedLoops = cutRegion === 'outside'
    ? await buildPushWeaveWaterlineSeedLoopsForLevelAsync({
      segments,
      z,
      stockBounds,
      params,
      materialLoops: loops,
      targetTriangles,
      warnings,
      waterlineStats,
    })
    : [];
  let driveLoops = loops;
  let useWeaveSeeds = false;
  if (cutRegion === 'outside' && weaveSeedLoops.length) {
    const validDriveLoops = buildOutsideContourDriveLoops({
      weaveSeedLoops,
      materialLoops: loops,
      segments,
      clearance,
      z,
      targetTriangles,
      protectedSections,
      stockBounds,
      toolRadius,
      cutterProfile,
      targetMaxZ,
    });
    if (validDriveLoops.length) {
      driveLoops = validDriveLoops;
      useWeaveSeeds = true;
    }
  }
  const maxPasses = Math.max(1, Math.min(500, Math.ceil(Math.max(stockBounds.max.x - stockBounds.min.x, stockBounds.max.y - stockBounds.min.y) / Math.max(stepover, EPS)) + 4));
  if (isAdaptiveWaterlineStrategy(normalizeCamStrategy(params.strategy)) && driveLoops.length) {
    emitCamProgress(params, {
      phase: 'adaptive-waterline-link',
      message: 'Constructing adaptive waterline paths',
      detail: `Z ${formatCoord(z)} - ${driveLoops.length} drive loop${driveLoops.length === 1 ? '' : 's'}`,
      current: 60,
    });
    await yieldCamProgress(params);
  }

  for (const loop of driveLoops) {
    const linkedPasses: Point3[][] = [];
    let passGrowthSign: number | null = null;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const baseDistance = (useWeaveSeeds ? Math.max(0, finiteNumber(params.stockAllowance, 0)) : clearance) + pass * stepover;
      const signs = useWeaveSeeds
        ? (passGrowthSign == null ? [1, -1] : [passGrowthSign])
        : passGrowthSign == null
        ? (cutRegion === 'inside' ? [-1, 1] : [1, -1])
        : [passGrowthSign];
      let offset: Point2[] | null = null;
      let offsetSign = passGrowthSign;
      let clippedRuns: Point3[][] | null = null;
      let fallbackOffset: Point2[] | null = null;
      let fallbackOffsetSign: number | null = null;
      let fallbackClippedRuns: Point3[][] | null = null;
      for (const sign of signs) {
        const candidate = offsetClosedLoop(loop, sign * baseDistance);
        if (!candidate || candidate.length < 3) continue;
        if (cutRegion === 'outside' && !loopFitsWithinToolCenterBounds(candidate, stockBounds, toolRadius)) continue;
        if (!loopRespectsCutRegion(candidate, loops, segments, cutRegion, clearance, z, targetTriangles, protectedSections, cutterProfile, targetMaxZ)) {
          if (cutRegion !== 'outside') continue;
          const runs = buildClippedOutsideContourRuns({
            loop: candidate,
            z,
            protectedSections,
            targetTriangles,
            clearance,
            stockBounds,
            toolRadius,
            cutterProfile,
            targetMaxZ,
          });
          if (!runs.length) continue;
          fallbackClippedRuns = fallbackClippedRuns || runs;
          fallbackOffset = fallbackOffset || candidate;
          fallbackOffsetSign = fallbackOffsetSign ?? sign;
          continue;
        }
        offset = candidate;
        offsetSign = sign;
        break;
      }
      if (!offset && fallbackOffset) {
        offset = fallbackOffset;
        offsetSign = fallbackOffsetSign;
        clippedRuns = fallbackClippedRuns;
      }
      if (!offset || offset.length < 3) break;
      if (!useWeaveSeeds || Math.abs(baseDistance) > EPS) passGrowthSign = offsetSign;
      if (clippedRuns) {
        for (const run of clippedRuns) {
          paths.push({
            id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
            z: roundCoord(z),
            orderingPriority: pass,
            feedRate,
            plungeRate,
            points: run,
          });
        }
        continue;
      }
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
        id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
        z: roundCoord(z),
        orderingPriority: pass,
        feedRate,
        plungeRate,
        points,
      });
    }
    if (lowHop && linkedPasses.length) {
      const linkedPoints: Point3[] = [];
      const linkedSegmentKinds: CamToolpathPathSegmentKind[] = [];
      const appendPath = () => {
        if (linkedPoints.length < 2) return;
        paths.push({
          id: `${useWeaveSeeds ? 'W' : 'P'}${pathStartIndex + paths.length + 1}`,
          z: roundCoord(z),
          orderingPriority: 0,
          feedRate,
          plungeRate,
          ...(linkFeedRate ? { linkFeedRate } : {}),
          points: linkedPoints.splice(0, linkedPoints.length),
          segmentKinds: linkedSegmentKinds.splice(0, linkedSegmentKinds.length),
        });
      };
      const appendPoint = (point: Point3, kind: CamToolpathPathSegmentKind) => {
        if (linkedPoints.length) linkedSegmentKinds.push(kind);
        linkedPoints.push(point);
      };
      for (const passPoints of linkedPasses) {
        if (!linkedPoints.length) {
          linkedPoints.push(passPoints[0]);
          for (const point of passPoints.slice(1)) appendPoint(point, 'cut');
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
            cutterProfile,
            targetMaxZ,
          )) {
            appendPath();
          }
          if (!linkedPoints.length) linkedPoints.push(passPoints[0]);
          else appendPoint(passPoints[0], 'link');
        }
        for (const point of passPoints.slice(1)) appendPoint(point, 'cut');
      }
      appendPath();
    }
  }
  return paths;
}

function trianglesToCamTriangleInputs(triangles: Triangle[]) {
  return (triangles || []).map((triangle, index) => ({
    id: index,
    a: [triangle[0].x, triangle[0].y, triangle[0].z] as Point3,
    b: [triangle[1].x, triangle[1].y, triangle[1].z] as Point3,
    c: [triangle[2].x, triangle[2].y, triangle[2].z] as Point3,
  }));
}

function steppedRange(min: number, max: number, step: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const spacing = Math.max(EPS, step);
  const out: number[] = [];
  for (let value = low; value <= high + EPS && out.length < 10000; value += spacing) {
    out.push(roundCoord(Math.min(value, high)));
  }
  if (!out.length || Math.abs(out[out.length - 1] - high) > EPS) out.push(roundCoord(high));
  return sortedUnique(out);
}

function clPointDistance3(a: CamCLPoint, b: CamCLPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function clFlatnessCos(a: CamCLPoint, b: CamCLPoint, c: CamCLPoint) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const bc = [c.x - b.x, c.y - b.y, c.z - b.z];
  const lab = Math.hypot(ab[0], ab[1], ab[2]);
  const lbc = Math.hypot(bc[0], bc[1], bc[2]);
  if (lab <= EPS || lbc <= EPS) return 1;
  return (ab[0] * bc[0] + ab[1] * bc[1] + ab[2] * bc[2]) / (lab * lbc);
}

function projectedPointToPathPoint(point: CamCLPoint): Point3 {
  return [roundCoord(point.x), roundCoord(point.y), roundCoord(point.z)];
}

function appendProjectedPathPoint(points: Point3[], point: CamCLPoint) {
  const next = projectedPointToPathPoint(point);
  const previous = points[points.length - 1];
  if (previous && pointsEqual(previous, next)) return;
  points.push(next);
}

function targetTopZAtXY(triangles: Triangle[], point: Point2) {
  const zs = verticalMeshIntersectionsAtXY(triangles, point);
  return zs.length ? Math.max(...zs) : null;
}

function parallelLinkHopZ(
  a: Point3,
  b: Point3,
  triangles: Triangle[],
  safeZ: number,
  clearance: number,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!Number.isFinite(length)) return null;
  const sampleSpacing = Math.max(0.25, Math.min(2, Math.max(clearance, 0.25)));
  const sampleCount = Math.max(2, Math.min(256, Math.ceil(length / sampleSpacing)));
  let topZ = Math.max(a[2], b[2]);
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const localTop = targetTopZAtXY(triangles, { x, y });
    if (localTop != null && Number.isFinite(localTop)) topZ = Math.max(topZ, localTop);
  }
  const hopZ = roundCoord(Math.min(safeZ, topZ + Math.max(0.1, clearance)));
  return hopZ < safeZ - 1e-5 ? hopZ : null;
}

function parallelFeedLinkIsSafe(
  a: Point3,
  b: Point3,
  triangles: Triangle[],
  cutterProfile: CamCutterProfileInstance,
  fallbackRadius: number,
  targetMaxZ: number,
) {
  if (!triangles.length) return false;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!Number.isFinite(length) || length <= EPS) return false;
  const sampleSpacing = Math.max(0.1, Math.min(1, Math.max(fallbackRadius, 0.25) * 0.35));
  const sampleCount = Math.max(2, Math.min(512, Math.ceil(length / sampleSpacing)));
  for (let index = 0; index <= sampleCount; index += 1) {
    const point = interpolatePoint3(a, b, index / sampleCount);
    if (cutterAtPointIntersectsTargetMeshMaterial(point, triangles, cutterProfile, fallbackRadius, targetMaxZ)) return false;
  }
  return true;
}

function appendLinkedPathPoint(
  points: Point3[],
  kinds: CamToolpathPathSegmentKind[],
  point: Point3,
  kind: CamToolpathPathSegmentKind,
) {
  const rounded: Point3 = [roundCoord(point[0]), roundCoord(point[1]), roundCoord(point[2])];
  if (points.length && pointsEqual(points[points.length - 1], rounded)) return;
  if (points.length) kinds.push(kind);
  points.push(rounded);
}

function appendProjectedCutPoints(
  points: Point3[],
  kinds: CamToolpathPathSegmentKind[],
  source: Point3[],
  includeFirst = false,
) {
  const startIndex = includeFirst ? 0 : 1;
  for (let index = startIndex; index < source.length; index += 1) {
    appendLinkedPathPoint(points, kinds, source[index], 'cut');
  }
}

function linkParallelFinishPaths(
  paths: CamToolpathPath[],
  params: AnyRecord,
  targetTriangles: Triangle[],
  safeZ: number,
) {
  const linkMode = normalizeCamLinkMode(params.linkMode);
  if (linkMode === 'retract' || paths.length < 2) return paths;
  const clearance = Math.max(0.1, finiteNumber(params.stockAllowance ?? params.lowHopClearance, 0));
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const fallbackRadius = Math.max(EPS, effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter) * 0.5);
  const targetBounds = computeTriangleBounds(targetTriangles);
  const targetMaxZ = targetBounds?.max?.z ?? Infinity;
  const linkFeedRate = linkMode === 'feed-link' ? clampPositive(params.feedRate, 800) : undefined;
  const linked: CamToolpathPath[] = [];
  let basePath: CamToolpathPath | null = null;
  let points: Point3[] = [];
  let segmentKinds: CamToolpathPathSegmentKind[] = [];

  const startPath = (path: CamToolpathPath) => {
    basePath = path;
    points = [];
    segmentKinds = [];
    appendProjectedCutPoints(points, segmentKinds, path.points || [], true);
  };
  const flushPath = () => {
    if (!basePath || points.length < 2) return;
    linked.push({
      ...basePath,
      z: roundCoord(points[0][2]),
      points: points.slice(),
      segmentKinds: segmentKinds.slice(),
      ...(linkFeedRate ? { linkFeedRate } : {}),
    });
    basePath = null;
    points = [];
    segmentKinds = [];
  };

  startPath(paths[0]);
  for (const path of paths.slice(1)) {
    const first = path.points?.[0];
    const last = points[points.length - 1];
    if (!first || !last) {
      flushPath();
      startPath(path);
      continue;
    }
    if (linkMode === 'feed-link') {
      if (!parallelFeedLinkIsSafe(last, first, targetTriangles, cutterProfile, fallbackRadius, targetMaxZ)) {
        flushPath();
        startPath(path);
        continue;
      }
      appendLinkedPathPoint(points, segmentKinds, first, 'link');
      appendProjectedCutPoints(points, segmentKinds, path.points || [], false);
      continue;
    }
    const hopZ = parallelLinkHopZ(last, first, targetTriangles, safeZ, clearance);
    if (hopZ == null) {
      flushPath();
      startPath(path);
      continue;
    }
    appendLinkedPathPoint(points, segmentKinds, [last[0], last[1], hopZ], 'link');
    appendLinkedPathPoint(points, segmentKinds, [first[0], first[1], hopZ], 'link');
    appendLinkedPathPoint(points, segmentKinds, first, 'link');
    appendProjectedCutPoints(points, segmentKinds, path.points || [], false);
  }
  flushPath();
  return linked;
}

function buildAdaptiveProjectedLinePoints({
  start,
  end,
  projector,
  floorZ,
  sampleSpacing,
  minSampleSpacing,
  flatnessCosLimit,
  maxDepth,
  warnings,
  pathId,
}: {
  start: Point3;
  end: Point3;
  projector: ReturnType<typeof createDropCutterProjector>;
  floorZ: number;
  sampleSpacing: number;
  minSampleSpacing: number;
  flatnessCosLimit: number;
  maxDepth: number;
  warnings: string[];
  pathId: string;
}) {
  const sourceAt = (t: number): CamCLPoint => ({
    x: start[0] + (end[0] - start[0]) * t,
    y: start[1] + (end[1] - start[1]) * t,
    z: floorZ,
  });
  const dropAt = (t: number) => {
    const result = projector.dropPoint(sourceAt(t));
    for (const warning of result.warnings) warnings.push(`${pathId}: ${warning}`);
    return result.point;
  };
  const sourceLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const startPoint = dropAt(0);
  const endPoint = dropAt(1);
  const points: Point3[] = [];
  appendProjectedPathPoint(points, startPoint);
  const stack = [{ t0: 0, t1: 1, p0: startPoint, p1: endPoint, depth: 0 }];

  while (stack.length) {
    const interval = stack.pop()!;
    const tm = (interval.t0 + interval.t1) * 0.5;
    const midpoint = dropAt(tm);
    const chordLength = clPointDistance3(interval.p0, interval.p1);
    const intervalSourceLength = sourceLength * Math.abs(interval.t1 - interval.t0);
    const flatness = clFlatnessCos(interval.p0, midpoint, interval.p1);
    const shouldSubdivide = interval.depth < maxDepth
      && intervalSourceLength > minSampleSpacing
      && (
        chordLength > sampleSpacing
        || (flatness < flatnessCosLimit && chordLength > minSampleSpacing)
        || (chordLength <= EPS && intervalSourceLength > sampleSpacing)
      );
    if (shouldSubdivide) {
      stack.push({ t0: tm, t1: interval.t1, p0: midpoint, p1: interval.p1, depth: interval.depth + 1 });
      stack.push({ t0: interval.t0, t1: tm, p0: interval.p0, p1: midpoint, depth: interval.depth + 1 });
      continue;
    }
    if (interval.depth >= maxDepth && (flatness < flatnessCosLimit || chordLength > sampleSpacing)) {
      warnings.push(`${pathId}: adaptive projection reached maxDepth ${maxDepth}.`);
    }
    appendProjectedPathPoint(points, interval.p1);
  }
  return points;
}

async function buildAdaptiveProjectedLinePointsAsync({
  start,
  end,
  projector,
  floorZ,
  sampleSpacing,
  minSampleSpacing,
  flatnessCosLimit,
  maxDepth,
  warnings,
  pathId,
  params,
  passIndex,
  passCount,
  progressStart,
  progressSpan,
}: {
  start: Point3;
  end: Point3;
  projector: ReturnType<typeof createDropCutterProjector>;
  floorZ: number;
  sampleSpacing: number;
  minSampleSpacing: number;
  flatnessCosLimit: number;
  maxDepth: number;
  warnings: string[];
  pathId: string;
  params: AnyRecord;
  passIndex?: number;
  passCount?: number;
  progressStart?: number;
  progressSpan?: number;
}) {
  const sourceAt = (t: number): CamCLPoint => ({
    x: start[0] + (end[0] - start[0]) * t,
    y: start[1] + (end[1] - start[1]) * t,
    z: floorZ,
  });
  const dropAt = (t: number) => {
    const result = projector.dropPoint(sourceAt(t));
    for (const warning of result.warnings) warnings.push(`${pathId}: ${warning}`);
    return result.point;
  };
  const sourceLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const startPoint = dropAt(0);
  const endPoint = dropAt(1);
  const points: Point3[] = [];
  appendProjectedPathPoint(points, startPoint);
  const stack = [{ t0: 0, t1: 1, p0: startPoint, p1: endPoint, depth: 0 }];
  let iteration = 0;
  const yieldInterval = Math.max(1, Math.round(finiteNumber(params.parallelProjectionYieldInterval, 64)));
  const resolvedPassCount = Math.max(1, Math.round(finiteNumber(passCount, 1)));
  const resolvedPassIndex = Math.max(0, Math.min(resolvedPassCount - 1, Math.round(finiteNumber(passIndex, 0))));
  const resolvedProgressStart = finiteNumber(progressStart, 32);
  const resolvedProgressSpan = finiteNumber(progressSpan, 30);

  while (stack.length) {
    iteration += 1;
    if (iteration % yieldInterval === 0) {
      const passBase = resolvedProgressStart + (resolvedPassIndex / resolvedPassCount) * resolvedProgressSpan;
      const passSpan = resolvedProgressSpan / resolvedPassCount;
      const iterationFraction = Math.min(0.95, iteration / Math.max(iteration + stack.length, 1));
      emitCamProgress(params, {
        phase: 'parallel-project',
        message: 'Projecting parallel finish pass',
        detail: `${pathId}: adaptive projection sample ${iteration}`,
        current: passBase + iterationFraction * passSpan,
      });
      await yieldCamProgress(params);
    }
    const interval = stack.pop()!;
    const tm = (interval.t0 + interval.t1) * 0.5;
    const midpoint = dropAt(tm);
    const chordLength = clPointDistance3(interval.p0, interval.p1);
    const intervalSourceLength = sourceLength * Math.abs(interval.t1 - interval.t0);
    const flatness = clFlatnessCos(interval.p0, midpoint, interval.p1);
    const shouldSubdivide = interval.depth < maxDepth
      && intervalSourceLength > minSampleSpacing
      && (
        chordLength > sampleSpacing
        || (flatness < flatnessCosLimit && chordLength > minSampleSpacing)
        || (chordLength <= EPS && intervalSourceLength > sampleSpacing)
      );
    if (shouldSubdivide) {
      stack.push({ t0: tm, t1: interval.t1, p0: midpoint, p1: interval.p1, depth: interval.depth + 1 });
      stack.push({ t0: interval.t0, t1: tm, p0: interval.p0, p1: midpoint, depth: interval.depth + 1 });
      continue;
    }
    if (interval.depth >= maxDepth && (flatness < flatnessCosLimit || chordLength > sampleSpacing)) {
      warnings.push(`${pathId}: adaptive projection reached maxDepth ${maxDepth}.`);
    }
    appendProjectedPathPoint(points, interval.p1);
  }
  return points;
}

function buildParallelFinishPaths({
  bounds,
  params,
  pathStartIndex,
  targetTriangles,
  driveTriangles,
  safeZ,
  warnings,
}: {
  bounds: THREE.Box3;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles: Triangle[];
  driveTriangles?: Triangle[];
  safeZ: number;
  warnings: string[];
}) {
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutter = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const toolDiameter = effectiveToolDiameterFromProfile(cutter, nominalToolDiameter);
  const stepover = clampPositive(params.stepover, Math.max(toolDiameter * 0.5, EPS));
  const strategy = normalizeCamStrategy(params.strategy);
  const zigZag = strategy === 'parallel-finish-zig-zag';
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const floorZ = nullableFiniteNumber(params.floorZ) ?? bounds.min.z;
  const sampleSpacing = clampPositive(params.sampleSpacing, Math.max(0.25, toolDiameter * 0.5));
  const minSampleSpacing = Math.min(sampleSpacing, clampPositive(params.minSampleSpacing, sampleSpacing * 0.25));
  const flatnessCosLimit = Math.max(-1, Math.min(1, finiteNumber(params.flatnessCosLimit, 0.999)));
  const maxDepth = Math.max(1, Math.min(32, Math.round(finiteNumber(params.maxDepth, 12))));
  const cutterErrors = cutter.validate();
  for (const error of cutterErrors) warnings.push(`Invalid cutter: ${error}`);
  if (cutterErrors.length) return [];
  const boundaryClearance = Math.max(0, toolDiameter * 0.5 + finiteNumber(params.stockAllowance, 0));

  const projector = createDropCutterProjector({
    cutter,
    triangles: trianglesToCamTriangleInputs(targetTriangles),
    floorZ,
  });
  warnings.push(...projector.warnings);
  const paths: CamToolpathPath[] = [];
  const regionTriangles = Array.isArray(driveTriangles) && driveTriangles.length ? driveTriangles : targetTriangles;
  const sourceLines = buildParallelFinishSourceLines({
    bounds,
    params,
    regionTriangles,
    stepover,
    floorZ,
    zigZag,
    boundaryClearance,
  });

  for (const line of sourceLines) {
    const id = `P${pathStartIndex + paths.length + 1}`;
    const points = buildAdaptiveProjectedLinePoints({
      start: line.start,
      end: line.end,
      projector,
      floorZ,
      sampleSpacing,
      minSampleSpacing,
      flatnessCosLimit,
      maxDepth,
      warnings,
      pathId: id,
    });
    if (points.length < 2) continue;
    paths.push({
      id,
      z: roundCoord(points[0][2]),
      feedRate,
      plungeRate,
      points,
    });
  }
  return linkParallelFinishPaths(paths, params, targetTriangles, safeZ);
}

async function buildParallelFinishPathsAsync({
  bounds,
  params,
  pathStartIndex,
  targetTriangles,
  driveTriangles,
  safeZ,
  warnings,
}: {
  bounds: THREE.Box3;
  params: AnyRecord;
  pathStartIndex: number;
  targetTriangles: Triangle[];
  driveTriangles?: Triangle[];
  safeZ: number;
  warnings: string[];
}) {
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const cutter = buildCutterProfileFromParams(params, nominalToolDiameter, clampPositive(params.toolLength, 25));
  const toolDiameter = effectiveToolDiameterFromProfile(cutter, nominalToolDiameter);
  const stepover = clampPositive(params.stepover, Math.max(toolDiameter * 0.5, EPS));
  const strategy = normalizeCamStrategy(params.strategy);
  const zigZag = strategy === 'parallel-finish-zig-zag';
  const feedRate = clampPositive(params.feedRate, 800);
  const plungeRate = clampPositive(params.plungeRate, 200);
  const floorZ = nullableFiniteNumber(params.floorZ) ?? bounds.min.z;
  const sampleSpacing = clampPositive(params.sampleSpacing, Math.max(0.25, toolDiameter * 0.5));
  const minSampleSpacing = Math.min(sampleSpacing, clampPositive(params.minSampleSpacing, sampleSpacing * 0.25));
  const flatnessCosLimit = Math.max(-1, Math.min(1, finiteNumber(params.flatnessCosLimit, 0.999)));
  const maxDepth = Math.max(1, Math.min(32, Math.round(finiteNumber(params.maxDepth, 12))));
  const cutterErrors = cutter.validate();
  for (const error of cutterErrors) warnings.push(`Invalid cutter: ${error}`);
  if (cutterErrors.length) return [];
  const boundaryClearance = Math.max(0, toolDiameter * 0.5 + finiteNumber(params.stockAllowance, 0));

  const projector = createDropCutterProjector({
    cutter,
    triangles: trianglesToCamTriangleInputs(targetTriangles),
    floorZ,
  });
  warnings.push(...projector.warnings);
  const paths: CamToolpathPath[] = [];
  const regionTriangles = Array.isArray(driveTriangles) && driveTriangles.length ? driveTriangles : targetTriangles;
  const sourceLines = buildParallelFinishSourceLines({
    bounds,
    params,
    regionTriangles,
    stepover,
    floorZ,
    zigZag,
    boundaryClearance,
  });
  const chunkSize = Math.max(1, Math.round(finiteNumber(params.parallelFinishChunkSize ?? params.chunkSize, 4)));

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const id = `P${pathStartIndex + paths.length + 1}`;
    const points = await buildAdaptiveProjectedLinePointsAsync({
      start: line.start,
      end: line.end,
      projector,
      floorZ,
      sampleSpacing,
      minSampleSpacing,
      flatnessCosLimit,
      maxDepth,
      warnings,
      pathId: id,
      params,
      passIndex: index,
      passCount: sourceLines.length,
      progressStart: 32,
      progressSpan: 30,
    });
    if (points.length >= 2) {
      paths.push({
        id,
        z: roundCoord(points[0][2]),
        feedRate,
        plungeRate,
        points,
      });
    }

    if ((index + 1) % chunkSize === 0 || index === sourceLines.length - 1) {
      emitCamProgress(params, {
        phase: 'parallel-project',
        message: 'Projecting parallel finish passes',
        detail: `${index + 1} of ${sourceLines.length} source pass${sourceLines.length === 1 ? '' : 'es'}, ${paths.length} projected path${paths.length === 1 ? '' : 's'}`,
        current: 32 + ((index + 1) / Math.max(1, sourceLines.length)) * 30,
      });
      await yieldCamProgress(params);
    }
  }
  return linkParallelFinishPaths(paths, params, targetTriangles, safeZ);
}

function boundsFromSectionGeometry(loops: Point2[][], segments: Segment2[]) {
  const points = loops.length
    ? loops.flat()
    : (segments || []).flatMap((segment) => [segment.a, segment.b]);
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX + EPS || maxY <= minY + EPS) return null;
  return { minX, minY, maxX, maxY };
}

function waterlineFiberScanValues(min: number, max: number, spacing: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const span = high - low;
  if (span <= EPS) return [roundCoord((low + high) * 0.5)];
  const step = Math.max(EPS, spacing);
  const inset = Math.min(step * 0.5, span * 0.25);
  const out: number[] = [];
  for (let value = low + inset; value < high - EPS && out.length < 10000; value += step) {
    out.push(roundCoord(value));
  }
  if (out.length < 2) {
    out.push(roundCoord(low + span * 0.25), roundCoord(low + span * 0.75));
  }
  return sortedUnique(out);
}

function stripClosedLoopDuplicate(loop: Point3[]) {
  if (loop.length > 1 && pointsEqual(loop[0], loop[loop.length - 1])) return loop.slice(0, -1);
  return loop;
}

function waterlineFiberFixedCoordinate(fiber: CamFiber) {
  return fiber.direction === 'x' ? finiteNumber(fiber.start?.[1], 0) : finiteNumber(fiber.start?.[0], 0);
}

function sortedWaterlineIntervals(fiber: CamFiber) {
  return (Array.isArray(fiber.intervals) ? fiber.intervals : [])
    .filter((interval) => Number.isFinite(interval.lowerT) && Number.isFinite(interval.upperT) && interval.upperT > interval.lowerT + EPS)
    .slice()
    .sort((a, b) => {
      const lowerDelta = finiteNumber(a.lowerT, 0) - finiteNumber(b.lowerT, 0);
      if (Math.abs(lowerDelta) > EPS) return lowerDelta;
      return finiteNumber(a.upperT, 0) - finiteNumber(b.upperT, 0);
    });
}

function waterlineFiberPointAtT(fiber: CamFiber, t: number): Point3 {
  const clampedT = Math.max(0, Math.min(1, finiteNumber(t, 0)));
  return [
    roundCoord(finiteNumber(fiber.start?.[0], 0) + (finiteNumber(fiber.end?.[0], 0) - finiteNumber(fiber.start?.[0], 0)) * clampedT),
    roundCoord(finiteNumber(fiber.start?.[1], 0) + (finiteNumber(fiber.end?.[1], 0) - finiteNumber(fiber.start?.[1], 0)) * clampedT),
    roundCoord(finiteNumber(fiber.start?.[2], 0) + (finiteNumber(fiber.end?.[2], 0) - finiteNumber(fiber.start?.[2], 0)) * clampedT),
  ];
}

function pointFlatnessCos3(a: Point3, b: Point3, c: Point3) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lab = Math.hypot(ab[0], ab[1], ab[2]);
  const lbc = Math.hypot(bc[0], bc[1], bc[2]);
  if (lab <= EPS || lbc <= EPS) return 1;
  return (ab[0] * bc[0] + ab[1] * bc[1] + ab[2] * bc[2]) / (lab * lbc);
}

function waterlineFibersAreFlatEnough(fiber0: CamFiber, midFiber: CamFiber, fiber1: CamFiber, flatnessCosLimit: number) {
  const intervals0 = sortedWaterlineIntervals(fiber0);
  const intervalsMid = sortedWaterlineIntervals(midFiber);
  const intervals1 = sortedWaterlineIntervals(fiber1);
  if (intervals0.length !== intervalsMid.length || intervalsMid.length !== intervals1.length) return false;
  if (!intervals0.length) return true;
  for (let index = 0; index < intervals0.length; index += 1) {
    const samples: Array<'lowerT' | 'upperT'> = ['lowerT', 'upperT'];
    for (const key of samples) {
      const flatness = pointFlatnessCos3(
        waterlineFiberPointAtT(fiber0, intervals0[index][key]),
        waterlineFiberPointAtT(midFiber, intervalsMid[index][key]),
        waterlineFiberPointAtT(fiber1, intervals1[index][key]),
      );
      if (flatness < flatnessCosLimit) return false;
    }
  }
  return true;
}

function makeWaterlineFiber(direction: 'x' | 'y', coordinate: number, z: number, stockBounds: THREE.Box3, id: string): CamFiber {
  return direction === 'x'
    ? {
      id,
      direction,
      start: [stockBounds.min.x, roundCoord(coordinate), roundCoord(z)] as Point3,
      end: [stockBounds.max.x, roundCoord(coordinate), roundCoord(z)] as Point3,
    }
    : {
      id,
      direction,
      start: [roundCoord(coordinate), stockBounds.min.y, roundCoord(z)] as Point3,
      end: [roundCoord(coordinate), stockBounds.max.y, roundCoord(z)] as Point3,
    };
}

function buildWaterlineSourceFibers({
  direction,
  coordinates,
  z,
  stockBounds,
  idPrefix = 'W',
}: {
  direction: 'x' | 'y';
  coordinates: number[];
  z: number;
  stockBounds: THREE.Box3;
  idPrefix?: string;
}) {
  return coordinates.map((coordinate, index) => (
    makeWaterlineFiber(direction, coordinate, z, stockBounds, `${idPrefix}${direction.toUpperCase()}${index + 1}`)
  ));
}

function buildUniformWaterlineFibers({
  direction,
  coordinates,
  z,
  stockBounds,
  push,
}: {
  direction: 'x' | 'y';
  coordinates: number[];
  z: number;
  stockBounds: THREE.Box3;
  push: (fiber: CamFiber) => CamFiber;
}) {
  return buildWaterlineSourceFibers({ direction, coordinates, z, stockBounds }).map(push);
}

function buildAdaptiveWaterlineFibers({
  direction,
  minCoordinate,
  maxCoordinate,
  z,
  stockBounds,
  push,
  sampling,
  minSampling,
  flatnessCosLimit,
  maxDepth,
  warnings,
}: {
  direction: 'x' | 'y';
  minCoordinate: number;
  maxCoordinate: number;
  z: number;
  stockBounds: THREE.Box3;
  push: (fiber: CamFiber) => CamFiber;
  sampling: number;
  minSampling: number;
  flatnessCosLimit: number;
  maxDepth: number;
  warnings?: string[];
}) {
  const low = roundCoord(Math.min(minCoordinate, maxCoordinate));
  const high = roundCoord(Math.max(minCoordinate, maxCoordinate));
  const pushedByCoordinate = new Map<string, CamFiber>();
  const acceptedByCoordinate = new Map<string, CamFiber>();
  let pushIndex = 0;
  let subdivisionCount = 0;
  let maxDepthReached = false;

  const keyFor = (coordinate: number) => String(roundCoord(coordinate));
  const pushAt = (coordinate: number) => {
    const rounded = roundCoord(coordinate);
    const key = keyFor(rounded);
    const cached = pushedByCoordinate.get(key);
    if (cached) return cached;
    pushIndex += 1;
    const fiber = push(makeWaterlineFiber(direction, rounded, z, stockBounds, `WA${direction.toUpperCase()}${pushIndex}`));
    pushedByCoordinate.set(key, fiber);
    return fiber;
  };
  const accept = (fiber: CamFiber) => {
    acceptedByCoordinate.set(keyFor(waterlineFiberFixedCoordinate(fiber)), fiber);
  };

  const startFiber = pushAt(low);
  const endFiber = pushAt(high);
  accept(startFiber);
  accept(endFiber);
  if (Math.abs(high - low) <= EPS) {
    return { fibers: Array.from(acceptedByCoordinate.values()), subdivisionCount, maxDepthReached };
  }

  const stack = [{
    coord0: low,
    coord1: high,
    fiber0: startFiber,
    fiber1: endFiber,
    depth: 0,
  }];

  while (stack.length) {
    const task = stack.pop()!;
    const span = Math.abs(task.coord1 - task.coord0);
    if (span <= EPS) continue;
    const midCoord = roundCoord((task.coord0 + task.coord1) * 0.5);
    const midFiber = pushAt(midCoord);
    const flatEnough = waterlineFibersAreFlatEnough(task.fiber0, midFiber, task.fiber1, flatnessCosLimit);
    const shouldSubdivide = span > sampling + EPS || (!flatEnough && span > minSampling + EPS);

    if (shouldSubdivide && task.depth < maxDepth && span > minSampling + EPS) {
      subdivisionCount += 1;
      accept(midFiber);
      stack.push({
        coord0: midCoord,
        coord1: task.coord1,
        fiber0: midFiber,
        fiber1: task.fiber1,
        depth: task.depth + 1,
      });
      stack.push({
        coord0: task.coord0,
        coord1: midCoord,
        fiber0: task.fiber0,
        fiber1: midFiber,
        depth: task.depth + 1,
      });
      continue;
    }

    if (shouldSubdivide && task.depth >= maxDepth) {
      maxDepthReached = true;
      accept(midFiber);
    }
    accept(task.fiber0);
    accept(task.fiber1);
  }

  if (maxDepthReached) {
    warnings?.push(`Adaptive waterline ${direction.toUpperCase()} fibers at Z ${formatCoord(z)} reached maxDepth ${maxDepth}.`);
  }

  const fibers = Array.from(acceptedByCoordinate.values())
    .sort((a, b) => waterlineFiberFixedCoordinate(a) - waterlineFiberFixedCoordinate(b));
  return { fibers, subdivisionCount, maxDepthReached };
}

async function buildAdaptiveWaterlineFibersAsync({
  direction,
  minCoordinate,
  maxCoordinate,
  z,
  stockBounds,
  push,
  sampling,
  minSampling,
  flatnessCosLimit,
  maxDepth,
  warnings,
  params,
}: {
  direction: 'x' | 'y';
  minCoordinate: number;
  maxCoordinate: number;
  z: number;
  stockBounds: THREE.Box3;
  push: (fiber: CamFiber) => CamFiber;
  sampling: number;
  minSampling: number;
  flatnessCosLimit: number;
  maxDepth: number;
  warnings?: string[];
  params: AnyRecord;
}) {
  const low = roundCoord(Math.min(minCoordinate, maxCoordinate));
  const high = roundCoord(Math.max(minCoordinate, maxCoordinate));
  const phase = `adaptive-waterline-${direction}`;
  const pushedByCoordinate = new Map<string, CamFiber>();
  const acceptedByCoordinate = new Map<string, CamFiber>();
  const chunkSize = Math.max(1, Math.round(finiteNumber(params.adaptiveWaterlineChunkSize ?? params.waterlineChunkSize ?? params.chunkSize, 64)));
  let pushIndex = 0;
  let subdivisionCount = 0;
  let maxDepthReached = false;
  let processedTaskCount = 0;

  const keyFor = (coordinate: number) => String(roundCoord(coordinate));
  const pushAt = (coordinate: number) => {
    const rounded = roundCoord(coordinate);
    const key = keyFor(rounded);
    const cached = pushedByCoordinate.get(key);
    if (cached) return cached;
    pushIndex += 1;
    const fiber = push(makeWaterlineFiber(direction, rounded, z, stockBounds, `WA${direction.toUpperCase()}${pushIndex}`));
    pushedByCoordinate.set(key, fiber);
    return fiber;
  };
  const accept = (fiber: CamFiber) => {
    acceptedByCoordinate.set(keyFor(waterlineFiberFixedCoordinate(fiber)), fiber);
  };
  const report = async (detail: string, current: number) => {
    const event = {
      phase,
      message: `Sampling adaptive waterline ${direction.toUpperCase()} fibers`,
      detail: `Z ${formatCoord(z)} - ${detail}`,
      current,
    };
    emitCamProgress(params, event);
    emitCamProgress(params, {
      ...event,
      phase: `adaptive-waterline-sample-${direction}`,
    });
    await yieldCamProgress(params);
  };

  await report('starting', direction === 'x' ? 42 : 48);
  const startFiber = pushAt(low);
  const endFiber = pushAt(high);
  accept(startFiber);
  accept(endFiber);
  if (Math.abs(high - low) <= EPS) {
    await report(`${acceptedByCoordinate.size} accepted fiber${acceptedByCoordinate.size === 1 ? '' : 's'}`, direction === 'x' ? 47 : 53);
    return { fibers: Array.from(acceptedByCoordinate.values()), subdivisionCount, maxDepthReached };
  }

  const stack = [{
    coord0: low,
    coord1: high,
    fiber0: startFiber,
    fiber1: endFiber,
    depth: 0,
  }];

  while (stack.length) {
    const task = stack.pop()!;
    processedTaskCount += 1;
    const span = Math.abs(task.coord1 - task.coord0);
    if (span <= EPS) continue;
    const midCoord = roundCoord((task.coord0 + task.coord1) * 0.5);
    const midFiber = pushAt(midCoord);
    const flatEnough = waterlineFibersAreFlatEnough(task.fiber0, midFiber, task.fiber1, flatnessCosLimit);
    const shouldSubdivide = span > sampling + EPS || (!flatEnough && span > minSampling + EPS);

    if (shouldSubdivide && task.depth < maxDepth && span > minSampling + EPS) {
      subdivisionCount += 1;
      accept(midFiber);
      stack.push({
        coord0: midCoord,
        coord1: task.coord1,
        fiber0: midFiber,
        fiber1: task.fiber1,
        depth: task.depth + 1,
      });
      stack.push({
        coord0: task.coord0,
        coord1: midCoord,
        fiber0: task.fiber0,
        fiber1: midFiber,
        depth: task.depth + 1,
      });
    } else {
      if (shouldSubdivide && task.depth >= maxDepth) {
        maxDepthReached = true;
        accept(midFiber);
      }
      accept(task.fiber0);
      accept(task.fiber1);
    }

    if (processedTaskCount % chunkSize === 0) {
      await report(
        `${processedTaskCount} interval task${processedTaskCount === 1 ? '' : 's'}, ${acceptedByCoordinate.size} accepted fiber${acceptedByCoordinate.size === 1 ? '' : 's'}, ${subdivisionCount} subdivision${subdivisionCount === 1 ? '' : 's'}`,
        direction === 'x' ? 42 + Math.min(5, processedTaskCount / chunkSize) : 48 + Math.min(5, processedTaskCount / chunkSize),
      );
    }
  }

  if (maxDepthReached) {
    warnings?.push(`Adaptive waterline ${direction.toUpperCase()} fibers at Z ${formatCoord(z)} reached maxDepth ${maxDepth}.`);
  }

  const fibers = Array.from(acceptedByCoordinate.values())
    .sort((a, b) => waterlineFiberFixedCoordinate(a) - waterlineFiberFixedCoordinate(b));
  await report(
    `${fibers.length} accepted fiber${fibers.length === 1 ? '' : 's'}, ${subdivisionCount} subdivision${subdivisionCount === 1 ? '' : 's'}`,
    direction === 'x' ? 47 : 53,
  );
  return { fibers, subdivisionCount, maxDepthReached };
}

function buildPushWeaveWaterlineSeedLoopsForLevel({
  segments,
  z,
  stockBounds,
  params,
  materialLoops,
  targetTriangles,
  warnings,
  waterlineStats,
}: {
  segments: Segment2[];
  z: number;
  stockBounds: THREE.Box3;
  params: AnyRecord;
  materialLoops: Point2[][];
  targetTriangles: Triangle[];
  warnings?: string[];
  waterlineStats?: CamWaterlineStats;
}) {
  if (!targetTriangles.length) return [];
  const sectionBounds = boundsFromSectionGeometry(materialLoops, segments);
  if (!sectionBounds) return [];
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const cutter = buildCutterProfileFromParams(params, nominalToolDiameter, toolLength);
  if (cutter.validate().length) return [];
  const toolDiameter = effectiveToolDiameterFromProfile(cutter, nominalToolDiameter);
  const strategy = normalizeCamStrategy(params.strategy);
  const adaptive = isAdaptiveWaterlineStrategy(strategy);
  const sampling = clampPositive(
    params.sampleSpacing ?? params.sampling ?? params.waterlineSampling ?? params.stepover,
    Math.max(toolDiameter * 0.5, EPS),
  );
  const minSampling = Math.min(
    sampling,
    clampPositive(params.minSampleSpacing ?? params.minSampling, Math.max(sampling * 0.25, EPS)),
  );
  const flatnessCosLimit = Math.max(-1, Math.min(1, finiteNumber(params.flatnessCosLimit, 0.999)));
  const maxDepth = Math.max(1, Math.min(32, Math.round(finiteNumber(params.maxDepth, 12))));
  const triangleInputs = trianglesToCamTriangleInputs(targetTriangles);
  const builtTriangleIndex = params.disableWaterlinePushIndex
    ? { index: null, warnings: [] }
    : buildCamTriangleSpatialIndexWithFallback(triangleInputs);
  warnings?.push(...builtTriangleIndex.warnings);
  const triangleIndex = builtTriangleIndex.index;
  const push = (fiber: CamFiber) => pushCutterFiber({
    fiber,
    cutter,
    triangles: triangleInputs,
    index: triangleIndex || undefined,
    tolerance: 1e-6,
  }).fiber;

  let xFibers: CamFiber[];
  let yFibers: CamFiber[];
  if (adaptive) {
    const xProgress = {
      phase: 'adaptive-waterline-x',
      message: 'Sampling adaptive waterline X fibers',
      detail: `Z ${formatCoord(z)}`,
      current: 42,
    };
    emitCamProgress(params, xProgress);
    emitCamProgress(params, { ...xProgress, phase: 'adaptive-waterline-sample-x' });
    const adaptiveX = buildAdaptiveWaterlineFibers({
      direction: 'x',
      minCoordinate: sectionBounds.minY,
      maxCoordinate: sectionBounds.maxY,
      z,
      stockBounds,
      push,
      sampling,
      minSampling,
      flatnessCosLimit,
      maxDepth,
      warnings,
    });
    const yProgress = {
      phase: 'adaptive-waterline-y',
      message: 'Sampling adaptive waterline Y fibers',
      detail: `Z ${formatCoord(z)}`,
      current: 48,
    };
    emitCamProgress(params, yProgress);
    emitCamProgress(params, { ...yProgress, phase: 'adaptive-waterline-sample-y' });
    const adaptiveY = buildAdaptiveWaterlineFibers({
      direction: 'y',
      minCoordinate: sectionBounds.minX,
      maxCoordinate: sectionBounds.maxX,
      z,
      stockBounds,
      push,
      sampling,
      minSampling,
      flatnessCosLimit,
      maxDepth,
      warnings,
    });
    xFibers = adaptiveX.fibers;
    yFibers = adaptiveY.fibers;
    if (waterlineStats) {
      waterlineStats.subdivisionCount += adaptiveX.subdivisionCount + adaptiveY.subdivisionCount;
      waterlineStats.maxDepthReached = waterlineStats.maxDepthReached || adaptiveX.maxDepthReached || adaptiveY.maxDepthReached;
    }
  } else {
    const xFixedValues = waterlineFiberScanValues(sectionBounds.minY, sectionBounds.maxY, sampling);
    const yFixedValues = waterlineFiberScanValues(sectionBounds.minX, sectionBounds.maxX, sampling);
    if (xFixedValues.length < 2 || yFixedValues.length < 2) return [];
    xFibers = buildUniformWaterlineFibers({ direction: 'x', coordinates: xFixedValues, z, stockBounds, push });
    yFibers = buildUniformWaterlineFibers({ direction: 'y', coordinates: yFixedValues, z, stockBounds, push });
  }

  const pushedX = xFibers.filter((fiber) => (fiber.intervals || []).length > 0);
  const pushedY = yFibers.filter((fiber) => (fiber.intervals || []).length > 0);
  if (waterlineStats) {
    waterlineStats.xFiberCount += pushedX.length;
    waterlineStats.yFiberCount += pushedY.length;
  }
  if (pushedX.length < 2 || pushedY.length < 2) return [];

  if (adaptive) {
    emitCamProgress(params, {
      phase: 'adaptive-waterline-weave',
      message: 'Reconstructing adaptive waterline loops',
      detail: `${pushedX.length} X fibers, ${pushedY.length} Y fibers`,
      current: 54,
    });
  }
  const weave = reconstructWeaveLoops({ xFibers: pushedX, yFibers: pushedY, z, tolerance: 1e-6 });
  if (adaptive) {
    for (const warning of weave.warnings || []) warnings?.push(`Adaptive waterline Z ${formatCoord(z)}: ${warning}`);
  }
  return weave.loops
    .map((loop) => stripClosedLoopDuplicate(loop as Point3[]))
    .map((loop) => loop.map((point) => ({ x: roundCoord(point[0]), y: roundCoord(point[1]) })))
    .filter((loop) => loop.length >= 3 && Math.abs(polygonArea2(loop)) > EPS);
}

async function pushWaterlineFibersBatch({
  direction,
  fibers,
  cutter,
  triangleInputs,
  triangleIndex,
  params,
  z,
  warnings,
}: {
  direction: 'x' | 'y';
  fibers: CamFiber[];
  cutter: ReturnType<typeof createCamCutterProfile>;
  triangleInputs: ReturnType<typeof trianglesToCamTriangleInputs>;
  triangleIndex: ReturnType<typeof buildCamTriangleSpatialIndex> | null;
  params: AnyRecord;
  z: number;
  warnings?: string[];
}) {
  const baseCurrent = direction === 'x' ? 40 : 48;
  const spanCurrent = 8;
  const result = await pushCutterBatch({
    fibers,
    direction,
    cutter,
    triangles: triangleInputs,
    index: triangleIndex || undefined,
    tolerance: 1e-6,
    chunkSize: Math.max(1, Math.round(finiteNumber(params.waterlineChunkSize ?? params.chunkSize, 128))),
    onProgress: (event) => {
      const localTotal = Math.max(1, Number(event.total) || 100);
      const localCurrent = Math.max(0, Math.min(localTotal, Number(event.current) || 0));
      if (event.phase === `push-index-${direction}` || event.phase === `push-fibers-${direction}`) {
        emitCamProgress(params, {
          phase: `waterline-push-${direction}`,
          message: `Processing waterline ${direction.toUpperCase()} fibers`,
          detail: `Z ${formatCoord(z)}${event.detail ? ` - ${event.detail}` : ''}`,
          current: baseCurrent + (localCurrent / localTotal) * spanCurrent,
        });
      }
      emitCamProgress(params, {
        ...event,
        detail: `Z ${formatCoord(z)}${event.detail ? ` - ${event.detail}` : ''}`,
        current: baseCurrent + (localCurrent / localTotal) * spanCurrent,
      });
    },
    progressYield: params.progressYield,
  });
  for (const warning of result.warnings || []) warnings?.push(`Waterline ${direction.toUpperCase()} push: ${warning}`);
  return result.fibers;
}

async function reconstructWaterlineWeaveLoopsAsync({
  pushedX,
  pushedY,
  z,
  params,
  adaptive = false,
}: {
  pushedX: CamFiber[];
  pushedY: CamFiber[];
  z: number;
  params: AnyRecord;
  adaptive?: boolean;
}) {
  const phase = adaptive ? 'adaptive-waterline-weave' : 'waterline-weave';
  const baseCurrent = adaptive ? 56 : 58;
  const spanCurrent = 2;
  return reconstructWeaveLoopsAsync({ xFibers: pushedX, yFibers: pushedY, z, tolerance: 1e-6 }, {
    chunkSize: Math.max(1, Math.round(finiteNumber(params.waterlineWeaveChunkSize ?? params.weaveChunkSize ?? params.chunkSize, 2048))),
    onProgress: (event) => {
      const total = Math.max(1, Number(event.total) || 1);
      const current = Math.max(0, Math.min(total, Number(event.current) || 0));
      emitCamProgress(params, {
        phase,
        message: adaptive ? 'Reconstructing adaptive waterline loops' : 'Reconstructing waterline loops',
        detail: `Z ${formatCoord(z)} - ${event.detail || event.phase}`,
        current: baseCurrent + (current / total) * spanCurrent,
      });
    },
    progressYield: () => yieldCamProgress(params),
  });
}

async function buildPushWeaveWaterlineSeedLoopsForLevelAsync({
  segments,
  z,
  stockBounds,
  params,
  materialLoops,
  targetTriangles,
  warnings,
  waterlineStats,
}: {
  segments: Segment2[];
  z: number;
  stockBounds: THREE.Box3;
  params: AnyRecord;
  materialLoops: Point2[][];
  targetTriangles: Triangle[];
  warnings?: string[];
  waterlineStats?: CamWaterlineStats;
}) {
  if (!targetTriangles.length) return [];
  const sectionBounds = boundsFromSectionGeometry(materialLoops, segments);
  if (!sectionBounds) return [];
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const cutter = buildCutterProfileFromParams(params, nominalToolDiameter, toolLength);
  if (cutter.validate().length) return [];
  const toolDiameter = effectiveToolDiameterFromProfile(cutter, nominalToolDiameter);
  const strategy = normalizeCamStrategy(params.strategy);
  const triangleInputs = trianglesToCamTriangleInputs(targetTriangles);
  const builtTriangleIndex = params.disableWaterlinePushIndex
    ? { index: null, warnings: [] }
    : buildCamTriangleSpatialIndexWithFallback(triangleInputs);
  warnings?.push(...builtTriangleIndex.warnings);
  const triangleIndex = builtTriangleIndex.index;

  if (isAdaptiveWaterlineStrategy(strategy)) {
    emitCamProgress(params, {
      phase: 'adaptive-waterline-level',
      message: 'Preparing adaptive waterline level',
      detail: `Z ${formatCoord(z)} - ${targetTriangles.length} triangle${targetTriangles.length === 1 ? '' : 's'}`,
      current: 38,
    });
    await yieldCamProgress(params);

    const sampling = clampPositive(
      params.sampleSpacing ?? params.sampling ?? params.waterlineSampling ?? params.stepover,
      Math.max(toolDiameter * 0.5, EPS),
    );
    const minSampling = Math.min(
      sampling,
      clampPositive(params.minSampleSpacing ?? params.minSampling, Math.max(sampling * 0.25, EPS)),
    );
    const flatnessCosLimit = Math.max(-1, Math.min(1, finiteNumber(params.flatnessCosLimit, 0.999)));
    const maxDepth = Math.max(1, Math.min(32, Math.round(finiteNumber(params.maxDepth, 12))));
    const push = (fiber: CamFiber) => pushCutterFiber({
      fiber,
      cutter,
      triangles: triangleInputs,
      index: triangleIndex || undefined,
      tolerance: 1e-6,
    }).fiber;
    const adaptiveX = await buildAdaptiveWaterlineFibersAsync({
      direction: 'x',
      minCoordinate: sectionBounds.minY,
      maxCoordinate: sectionBounds.maxY,
      z,
      stockBounds,
      push,
      sampling,
      minSampling,
      flatnessCosLimit,
      maxDepth,
      warnings,
      params,
    });
    const adaptiveY = await buildAdaptiveWaterlineFibersAsync({
      direction: 'y',
      minCoordinate: sectionBounds.minX,
      maxCoordinate: sectionBounds.maxX,
      z,
      stockBounds,
      push,
      sampling,
      minSampling,
      flatnessCosLimit,
      maxDepth,
      warnings,
      params,
    });
    const pushedX = adaptiveX.fibers.filter((fiber) => (fiber.intervals || []).length > 0);
    const pushedY = adaptiveY.fibers.filter((fiber) => (fiber.intervals || []).length > 0);
    if (waterlineStats) {
      waterlineStats.xFiberCount += pushedX.length;
      waterlineStats.yFiberCount += pushedY.length;
      waterlineStats.subdivisionCount += adaptiveX.subdivisionCount + adaptiveY.subdivisionCount;
      waterlineStats.maxDepthReached = waterlineStats.maxDepthReached || adaptiveX.maxDepthReached || adaptiveY.maxDepthReached;
    }
    if (pushedX.length < 2 || pushedY.length < 2) return [];

    emitCamProgress(params, {
      phase: 'adaptive-waterline-weave',
      message: 'Reconstructing adaptive waterline loops',
      detail: `Z ${formatCoord(z)} - ${pushedX.length} X fibers, ${pushedY.length} Y fibers`,
      current: 56,
    });
    await yieldCamProgress(params);
    const weave = await reconstructWaterlineWeaveLoopsAsync({
      pushedX,
      pushedY,
      z,
      params,
      adaptive: true,
    });
    for (const warning of weave.warnings || []) warnings?.push(`Adaptive waterline Z ${formatCoord(z)}: ${warning}`);
    return weave.loops
      .map((loop) => stripClosedLoopDuplicate(loop as Point3[]))
      .map((loop) => loop.map((point) => ({ x: roundCoord(point[0]), y: roundCoord(point[1]) })))
      .filter((loop) => loop.length >= 3 && Math.abs(polygonArea2(loop)) > EPS);
  }

  const sampling = clampPositive(params.sampleSpacing ?? params.sampling ?? params.waterlineSampling ?? params.stepover, Math.max(toolDiameter * 0.5, EPS));
  const xFixedValues = waterlineFiberScanValues(sectionBounds.minY, sectionBounds.maxY, sampling);
  const yFixedValues = waterlineFiberScanValues(sectionBounds.minX, sectionBounds.maxX, sampling);
  if (xFixedValues.length < 2 || yFixedValues.length < 2) return [];

  emitCamProgress(params, {
    phase: 'waterline-push-index',
    message: 'Building waterline push-cutter index',
    detail: `Z ${formatCoord(z)} - ${targetTriangles.length} triangle${targetTriangles.length === 1 ? '' : 's'}`,
    current: 38,
  });
  await yieldCamProgress(params);

  const xFibers = buildWaterlineSourceFibers({
    direction: 'x',
    coordinates: xFixedValues,
    z,
    stockBounds,
  });
  const yFibers = buildWaterlineSourceFibers({
    direction: 'y',
    coordinates: yFixedValues,
    z,
    stockBounds,
  });

  emitCamProgress(params, {
    phase: 'waterline-fibers',
    message: 'Prepared waterline fibers',
    detail: `Z ${formatCoord(z)} - ${xFibers.length} X fibers, ${yFibers.length} Y fibers`,
    current: 39,
  });
  await yieldCamProgress(params);

  const pushedX = (await pushWaterlineFibersBatch({
    direction: 'x',
    fibers: xFibers,
    cutter,
    triangleInputs,
    triangleIndex,
    params,
    z,
    warnings,
  })).filter((fiber) => (fiber.intervals || []).length > 0);
  const pushedY = (await pushWaterlineFibersBatch({
    direction: 'y',
    fibers: yFibers,
    cutter,
    triangleInputs,
    triangleIndex,
    params,
    z,
    warnings,
  })).filter((fiber) => (fiber.intervals || []).length > 0);

  if (waterlineStats) {
    waterlineStats.xFiberCount += pushedX.length;
    waterlineStats.yFiberCount += pushedY.length;
  }
  if (pushedX.length < 2 || pushedY.length < 2) return [];

  emitCamProgress(params, {
    phase: 'waterline-weave',
    message: 'Reconstructing waterline loops',
    detail: `Z ${formatCoord(z)} - ${pushedX.length} X fibers, ${pushedY.length} Y fibers`,
    current: 58,
  });
  await yieldCamProgress(params);
  const weave = await reconstructWaterlineWeaveLoopsAsync({
    pushedX,
    pushedY,
    z,
    params,
  });
  for (const warning of weave.warnings || []) warnings?.push(`Waterline Z ${formatCoord(z)}: ${warning}`);
  return weave.loops
    .map((loop) => stripClosedLoopDuplicate(loop as Point3[]))
    .map((loop) => loop.map((point) => ({ x: roundCoord(point[0]), y: roundCoord(point[1]) })))
    .filter((loop) => loop.length >= 3 && Math.abs(polygonArea2(loop)) > EPS);
}

function buildZLevels(bounds: THREE.Box3, params: AnyRecord) {
  const { high, low } = cutZRangeWithinBounds(bounds, params);
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

function cutZRangeWithinBounds(bounds: THREE.Box3, params: AnyRecord) {
  const topInput = nullableFiniteNumber(params.topZ);
  const bottomInput = nullableFiniteNumber(params.bottomZ);
  const clampZ = (z: number) => Math.max(bounds.min.z, Math.min(bounds.max.z, z));
  const topZ = clampZ(topInput == null ? bounds.max.z : topInput);
  const bottomZ = clampZ(bottomInput == null ? bounds.min.z : bottomInput);
  const high = Math.max(topZ, bottomZ);
  const low = Math.min(topZ, bottomZ);
  return { topZ, bottomZ, high, low };
}

function buildProtectedSectionStack(
  triangles: Triangle[],
  bounds: THREE.Box3,
  levels: number[],
  params: AnyRecord,
  toolDiameter: number,
) {
  const clearance = Math.max(0, toolDiameter * 0.5 + finiteNumber(params.stockAllowance, 0));
  const stepDown = clampPositive(params.stepDown, 1);
  const spacing = Math.max(0.15, Math.min(stepDown, Math.max(0.2, clearance * 0.35)));
  const zValues = [bounds.max.z, bounds.min.z, ...(levels || [])];
  for (let z = bounds.max.z - spacing; z > bounds.min.z + EPS && zValues.length < 5000; z -= spacing) {
    zValues.push(roundCoord(z));
  }
  return sortedUnique(zValues)
    .sort((a, b) => b - a)
    .map((z) => {
      const segments = sliceMeshAtZ(triangles, z);
      return segments.length ? { z, segments, loops: buildSectionLoops(segments) } : null;
    })
    .filter((section): section is Section2 => section != null);
}

function maybeWarnCutterLengthForCutDepth(
  warnings: string[],
  cutterProfile: ReturnType<typeof createCamCutterProfile>,
  cutBounds: THREE.Box3 | null,
  params: AnyRecord,
) {
  if (!cutBounds) return;
  const { topZ, bottomZ } = cutZRangeWithinBounds(cutBounds, params);
  const cutDepth = Math.abs(topZ - bottomZ);
  const cuttingLength = Number(cutterProfile.cuttingLength);
  if (!Number.isFinite(cutDepth) || !Number.isFinite(cuttingLength)) return;
  if (cutDepth <= cuttingLength + EPS) return;
  warnings.push(`Cutter length ${formatCoord(cuttingLength)} is shorter than requested cut depth ${formatCoord(cutDepth)}.`);
}

function filterToleranceFromParams(params: AnyRecord) {
  const raw = Object.prototype.hasOwnProperty.call(params || {}, 'filterTolerance')
    ? params.filterTolerance
    : params?.simplificationTolerance;
  return clampNonNegative(raw, 0);
}

function pointCoordinatesAreFinite(point: any) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function pathHasFiniteCoordinates(path: CamToolpathPath | null | undefined) {
  const points = path?.points;
  return Array.isArray(points)
    && points.length >= 2
    && points.every((point) => pointCoordinatesAreFinite(point));
}

function rejectInvalidToolpathCoordinatePaths(paths: CamToolpathPath[], warnings: string[]) {
  const valid: CamToolpathPath[] = [];
  for (let index = 0; index < (Array.isArray(paths) ? paths : []).length; index += 1) {
    const path = paths[index];
    if (pathHasFiniteCoordinates(path)) {
      valid.push(path);
      continue;
    }
    const label = String(path?.id || `path ${index + 1}`);
    warnings.push(`Rejected CAM path ${label}: non-finite cutter-location coordinate.`);
  }
  return valid;
}

function applyCutterLocationLineFilter(paths: CamToolpathPath[], params: AnyRecord, warnings?: string[]) {
  if (params?.enableLineFilter === false) return paths;
  const tolerance = filterToleranceFromParams(params);
  if (tolerance <= EPS || !Array.isArray(paths) || paths.length === 0) return paths;
  const result = filterCamToolpathPaths(paths, {
    tolerance,
    enableLineFilter: params?.enableLineFilter,
    preserveSimulationSamples: params?.preserveSimulationSamples !== false,
  });
  warnings?.push(...result.warnings);
  return result.paths;
}

function applyCamPathOrdering(paths: CamToolpathPath[], params: AnyRecord, strategy: string, safeZ: number, warnings?: string[]) {
  if (params.enablePathOrdering === false || !Array.isArray(paths) || paths.length < 2) return paths;
  if (!isWaterlineContourStrategy(strategy)) return paths;
  const result = orderCamToolpathPaths({
    paths,
    startPosition: [0, 0, roundCoord(safeZ)],
    safeHeight: safeZ,
    linkMode: effectiveCamLinkMode(params, strategy),
    allowReverse: false,
    preserveLevelOrder: true,
  });
  warnings?.push(...result.warnings);
  return result.paths;
}

function finalOutsideContourSafetyFilter(
  paths: CamToolpathPath[],
  params: AnyRecord,
  {
    protectedSections,
    targetTriangles,
    stockBounds,
    toolRadius,
    cutterProfile,
    targetMaxZ,
  }: {
    protectedSections: Section2[];
    targetTriangles: Triangle[];
    stockBounds: THREE.Box3;
    toolRadius: number;
    cutterProfile: CamCutterProfileInstance;
    targetMaxZ: number;
  },
) {
  if (!Array.isArray(paths) || !paths.length) return paths;
  if (normalizeCutRegion(params.cutRegion) !== 'outside') return paths;
  const clearance = Math.max(0, toolRadius + finiteNumber(params.stockAllowance, 0));
  const filtered: CamToolpathPath[] = [];

  for (const path of paths) {
    const source = Array.isArray(path.points) ? path.points : [];
    if (source.length < 2) continue;
    const runs: Array<{ points: Point3[]; segmentKinds: CamToolpathPathSegmentKind[] }> = [];
    let runPoints: Point3[] = [];
    let runKinds: CamToolpathPathSegmentKind[] = [];
    let changed = false;

    const flushRun = () => {
      if (runPoints.length >= 2 && pointRunLength(runPoints) > EPS) {
        runs.push({ points: runPoints, segmentKinds: runKinds });
      }
      runPoints = [];
      runKinds = [];
    };
    const appendSegment = (start: Point3, end: Point3, kind: CamToolpathPathSegmentKind) => {
      if (pointsEqual(start, end)) return;
      if (!runPoints.length) {
        runPoints.push(start);
      } else if (!pointsEqual(runPoints[runPoints.length - 1], start, 1e-5)) {
        flushRun();
        runPoints.push(start);
      }
      runKinds.push(kind);
      runPoints.push(end);
    };

    for (let index = 1; index < source.length; index += 1) {
      const a = source[index - 1];
      const b = source[index];
      const kind = pathSegmentKind(path, index - 1);
      const z = Math.min(Number(a?.[2]) || 0, Number(b?.[2]) || 0);
      const levelProtectedSections = protectedSections.filter((section) => section.z >= z - EPS);
      const clipped = clipOutsideCutSegment(
        a,
        b,
        levelProtectedSections,
        targetTriangles,
        clearance,
        cutterProfile,
        targetMaxZ,
      ).filter(([start, end]) => (
        point3WithinToolCenterBounds(start, stockBounds, toolRadius)
        && point3WithinToolCenterBounds(end, stockBounds, toolRadius)
        && Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) > EPS
      ));

      if (kind !== 'cut') {
        if (clipped.length === 1 && pointsEqual(clipped[0][0], a, 1e-5) && pointsEqual(clipped[0][1], b, 1e-5)) {
          appendSegment(a, b, kind);
        } else {
          changed = true;
          flushRun();
        }
        continue;
      }

      if (!clipped.length) {
        changed = true;
        flushRun();
        continue;
      }
      if (
        clipped.length !== 1
        || !pointsEqual(clipped[0][0], a, 1e-5)
        || !pointsEqual(clipped[0][1], b, 1e-5)
      ) {
        changed = true;
      }
      for (const [start, end] of clipped) {
        appendSegment(start, end, 'cut');
      }
    }
    flushRun();

    if (!changed && runs.length === 1) {
      filtered.push(path);
      continue;
    }

    runs.forEach((run, runIndex) => {
      const next: CamToolpathPath = {
        ...path,
        id: runs.length === 1 ? path.id : `${path.id}_${runIndex + 1}`,
        points: run.points,
      };
      delete next.simulationSamples;
      if (run.segmentKinds.length === Math.max(0, run.points.length - 1) && run.segmentKinds.some((kind) => kind !== 'cut')) {
        next.segmentKinds = run.segmentKinds;
      } else {
        delete next.segmentKinds;
      }
      filtered.push(next);
    });
  }

  return filtered;
}

function pathSegmentKind(path: CamToolpathPath, segmentIndex: number): CamToolpathPathSegmentKind {
  const kinds = Array.isArray(path.segmentKinds) ? path.segmentKinds : [];
  if (kinds.length !== Math.max(0, (path.points?.length || 0) - 1)) return 'cut';
  if (kinds[segmentIndex] === 'rapid') return 'rapid';
  if (kinds[segmentIndex] === 'link') return 'link';
  return 'cut';
}

function waterlineSummaryFields(stats: CamWaterlineStats | null | undefined) {
  if (!stats || (stats.xFiberCount <= 0 && stats.yFiberCount <= 0 && stats.subdivisionCount <= 0)) return {};
  return {
    waterlineXFiberCount: stats.xFiberCount,
    waterlineYFiberCount: stats.yFiberCount,
    waterlineSubdivisionCount: stats.subdivisionCount,
    waterlineMaxDepthReached: stats.maxDepthReached,
  };
}

function pathLength(path: CamToolpathPath) {
  let total = 0;
  const points = Array.isArray(path.points) ? path.points : [];
  for (let i = 1; i < points.length; i += 1) {
    if (pathSegmentKind(path, i - 1) !== 'cut') continue;
    const a = points[i - 1];
    const b = points[i];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

function pathCutMoveCount(path: CamToolpathPath) {
  const points = Array.isArray(path.points) ? path.points : [];
  let count = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (pathSegmentKind(path, i - 1) === 'cut') count += 1;
  }
  return count;
}

function motionSegmentLength(segment: { start?: Point3; end?: Point3 }) {
  const start = segment?.start;
  const end = segment?.end;
  if (!start || !end) return 0;
  return Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
}

function estimatedRapidLengthFromMotionSegments(
  segments: Array<{ start?: Point3; end?: Point3; kind?: CamMotionSegmentKind }> = [],
) {
  return roundCoord(segments.reduce((sum, segment) => (
    segment.kind === 'rapid' || segment.kind === 'retract'
      ? sum + motionSegmentLength(segment)
      : sum
  ), 0));
}

function sweptMeshBounds(positions: number[]) {
  if (!Array.isArray(positions) || positions.length < 3) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = Number(positions[index]);
    const y = Number(positions[index + 1]);
    const z = Number(positions[index + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    min.min(new THREE.Vector3(x, y, z));
    max.max(new THREE.Vector3(x, y, z));
  }
  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;
  return { min: toPoint3(min), max: toPoint3(max) };
}

function buildSweepFootprintBoundary(start: Point3, end: Point3, radius: number) {
  const r = Math.max(0, Number(radius) || 0);
  const sx = Number(start[0]) || 0;
  const sy = Number(start[1]) || 0;
  const ex = Number(end[0]) || 0;
  const ey = Number(end[1]) || 0;
  const dx = ex - sx;
  const dy = ey - sy;
  const xyLength = Math.hypot(dx, dy);
  const radialSegments = 16;
  const boundary: Array<{ x: number; y: number }> = [];

  if (xyLength <= 1e-7) {
    for (let i = 0; i < radialSegments; i += 1) {
      const angle = (Math.PI * 2 * i) / radialSegments;
      boundary.push({
        x: sx + Math.cos(angle) * r,
        y: sy + Math.sin(angle) * r,
      });
    }
    return boundary;
  }

  const ux = dx / xyLength;
  const uy = dy / xyLength;
  const leftAngle = Math.atan2(uy, ux) + Math.PI / 2;
  const rightAngle = Math.atan2(uy, ux) - Math.PI / 2;
  const capSteps = Math.max(4, radialSegments / 2);
  boundary.push({
    x: sx + Math.cos(leftAngle) * r,
    y: sy + Math.sin(leftAngle) * r,
  });
  for (let i = 0; i <= capSteps; i += 1) {
    const angle = leftAngle + ((rightAngle - leftAngle) * i) / capSteps;
    boundary.push({
      x: ex + Math.cos(angle) * r,
      y: ey + Math.sin(angle) * r,
    });
  }
  boundary.push({
    x: sx + Math.cos(rightAngle) * r,
    y: sy + Math.sin(rightAngle) * r,
  });
  for (let i = 0; i <= capSteps; i += 1) {
    const angle = rightAngle - (Math.PI * i) / capSteps;
    boundary.push({
      x: sx + Math.cos(angle) * r,
      y: sy + Math.sin(angle) * r,
    });
  }
  return boundary;
}

function cutterProfileHeightSamples(profile: ReturnType<typeof createCamCutterProfile>, totalLength: number) {
  const samples: number[] = [0, totalLength];
  const heightSegments = 24;
  for (let index = 0; index <= heightSegments; index += 1) {
    samples.push((totalLength * index) / heightSegments);
  }
  for (const value of [
    profile.radius,
    profile.profileHeight,
    profile.cornerRadius,
    profile.tangentHeight,
    profile.coneTopHeight,
    profile.cuttingLength,
  ]) {
    if (Number.isFinite(value)) samples.push(Number(value));
  }
  for (const segment of profile.segments || []) {
    samples.push(segment.minHeight, segment.maxHeight);
  }
  return sortedUnique(samples.map((value) => Math.max(0, Math.min(totalLength, value))), 1e-6);
}

function cutterProfileTotalLength(profile: ReturnType<typeof createCamCutterProfile>, fallbackLength: number, fallbackRadius: number) {
  const cuttingLength = Math.max(0, Number(profile.cuttingLength) || 0);
  const shaftLength = Math.max(0, Number(profile.shaftLength) || 0);
  return Math.max(
    Math.max(0.0001, Number(fallbackRadius) || 0) * 2,
    cuttingLength + shaftLength,
    Number(fallbackLength) || 0,
  );
}

function profileRadiusAtSampleHeight(profile: ReturnType<typeof createCamCutterProfile>, height: number, fallbackRadius: number) {
  const radius = profile.maxRadiusAtHeight(height);
  return Number.isFinite(radius) ? Math.max(0, Number(radius)) : Math.max(0, fallbackRadius);
}

function maxSweptProfileRadiusAtZ(
  profile: ReturnType<typeof createCamCutterProfile>,
  absoluteZ: number,
  lowBottomZ: number,
  highBottomZ: number,
  totalLength: number,
  profileHeights: number[],
  fallbackRadius: number,
) {
  const minLocal = Math.max(0, absoluteZ - highBottomZ);
  const maxLocal = Math.min(totalLength, absoluteZ - lowBottomZ);
  if (maxLocal < minLocal - 1e-7) return 0;
  const candidates = [minLocal, maxLocal];
  for (const height of profileHeights) {
    if (height >= minLocal - 1e-7 && height <= maxLocal + 1e-7) candidates.push(height);
  }
  return candidates.reduce((maxRadius, height) => (
    Math.max(maxRadius, profileRadiusAtSampleHeight(profile, height, fallbackRadius))
  ), 0);
}

export function buildCutterProfileSweepMesh(
  start: Point3,
  end: Point3,
  cutterProfileInput: AnyRecord | null | undefined,
  fallbackRadius: number,
  toolLength: number,
) {
  const fallbackR = Math.max(0.0001, Number(fallbackRadius) || 0);
  const profile = createCamCutterProfile(cutterProfileInput || {
    kind: 'flat',
    diameter: fallbackR * 2,
    cuttingLength: toolLength,
  });
  const profileRadius = Math.max(0.0001, Number(profile.radius) || fallbackR);
  const totalLength = cutterProfileTotalLength(profile, toolLength, profileRadius);
  const startZ = Number(start[2]) || 0;
  const endZ = Number(end[2]) || 0;
  const lowBottomZ = Math.min(startZ, endZ);
  const highBottomZ = Math.max(startZ, endZ);
  const profileHeights = cutterProfileHeightSamples(profile, totalLength);
  const layerZs: number[] = [lowBottomZ, highBottomZ + totalLength];
  const zSpan = Math.max(1e-7, highBottomZ + totalLength - lowBottomZ);
  const verticalSegments = 28;
  for (let index = 0; index <= verticalSegments; index += 1) {
    layerZs.push(lowBottomZ + (zSpan * index) / verticalSegments);
  }
  for (const height of profileHeights) {
    layerZs.push(lowBottomZ + height, highBottomZ + height);
  }
  const layers = sortedUnique(
    layerZs
      .filter((value) => value >= lowBottomZ - 1e-7 && value <= highBottomZ + totalLength + 1e-7)
      .map((value) => roundCoord(value)),
    1e-6,
  ).map((z) => ({
    z,
    radius: maxSweptProfileRadiusAtZ(profile, z, lowBottomZ, highBottomZ, totalLength, profileHeights, profileRadius),
  }));

  const positions: number[] = [];
  const indices: number[] = [];
  const appendVertex = (x: number, y: number, z: number) => {
    positions.push(roundCoord(x), roundCoord(y), roundCoord(z));
    return positions.length / 3 - 1;
  };

  const layerIndices: number[][] = [];
  for (const layer of layers) {
    const boundary = buildSweepFootprintBoundary(start, end, layer.radius);
    layerIndices.push(boundary.map((point) => appendVertex(point.x, point.y, layer.z)));
  }

  for (let layer = 0; layer + 1 < layerIndices.length; layer += 1) {
    const current = layerIndices[layer];
    const next = layerIndices[layer + 1];
    const count = Math.min(current.length, next.length);
    for (let index = 0; index < count; index += 1) {
      const nextIndex = (index + 1) % count;
      indices.push(current[index], current[nextIndex], next[nextIndex]);
      indices.push(current[index], next[nextIndex], next[index]);
    }
  }

  if (layerIndices.length) {
    const capLayer = (row: number[], z: number, reverse = false) => {
      const center = buildSweepFootprintBoundary(start, end, 0)
        .reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
      const centerIndex = appendVertex(center.x / Math.max(1, row.length), center.y / Math.max(1, row.length), z);
      for (let index = 0; index < row.length; index += 1) {
        const next = (index + 1) % row.length;
        if (reverse) indices.push(centerIndex, row[next], row[index]);
        else indices.push(centerIndex, row[index], row[next]);
      }
    };
    capLayer(layerIndices[0], layers[0].z, true);
    capLayer(layerIndices[layerIndices.length - 1], layers[layers.length - 1].z, false);
  }

  return { positions, indices };
}

function buildSweptHullArtifacts(
  sweptSegments: CamSweptSegment[],
  toolLength: number,
  cutterProfileInput: CamToolpathCutterProfileSnapshot | null = null,
) {
  return sweptSegments.map((segment) => {
    const start = segment.start;
    const end = segment.end;
    const profile = createCamCutterProfile(segment.cutterProfile || cutterProfileInput || {
      kind: 'flat',
      diameter: (Number(segment.radius) || 0) * 2,
      cuttingLength: toolLength,
    });
    const serializedProfile = serializeCutterProfile(profile);
    const radius = Math.max(0.0001, Number(profile.radius) || Number(segment.radius) || 0);
    const totalLength = cutterProfileTotalLength(profile, toolLength, radius);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const mesh = buildCutterProfileSweepMesh(start, end, serializedProfile, radius, totalLength);
    const bounds = sweptMeshBounds(mesh.positions) || {
      min: toPoint3(new THREE.Vector3(
        Math.min(start[0], end[0]) - radius,
        Math.min(start[1], end[1]) - radius,
        Math.min(start[2], end[2]),
      )),
      max: toPoint3(new THREE.Vector3(
        Math.max(start[0], end[0]) + radius,
        Math.max(start[1], end[1]) + radius,
        Math.max(start[2], end[2]) + totalLength,
      )),
    };
    return {
      kind: profile.kind === 'flat' ? 'flat-endmill-sweep' as const : 'cutter-profile-sweep' as const,
      start,
      end,
      radius: roundCoord(radius),
      toolShape: profile.kind,
      cutterProfile: serializedProfile,
      toolLength: roundCoord(totalLength),
      length: roundCoord(length),
      positions: mesh.positions,
      indices: mesh.indices,
      vertexCount: (mesh.positions.length / 3) | 0,
      triangleCount: (mesh.indices.length / 3) | 0,
      bounds,
    };
  });
}

async function buildSweptHullArtifactsAsync(
  sweptSegments: CamSweptSegment[],
  toolLength: number,
  cutterProfileInput: CamToolpathCutterProfileSnapshot | null,
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
    hulls.push(...buildSweptHullArtifacts([sweptSegments[index]], toolLength, cutterProfileInput));
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

function pointsEqual(a: Point3 | null | undefined, b: Point3 | null | undefined, tolerance = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= tolerance
    && Math.abs(a[1] - b[1]) <= tolerance
    && Math.abs(a[2] - b[2]) <= tolerance;
}

function buildMotionData(paths: CamToolpathPath[], safeZ: number, rapidRate = 2500) {
  const motionPolyline: Point3[] = [];
  const motionSegments: Array<{ start: Point3; end: Point3; kind: CamMotionSegmentKind; feedRate?: number; sourcePathId?: string; sourceSegmentIndex?: number }> = [];
  const appendPoint = (point: Point3) => {
    const rounded: Point3 = [roundCoord(point[0]), roundCoord(point[1]), roundCoord(point[2])];
    if (!motionPolyline.length || !pointsEqual(motionPolyline[motionPolyline.length - 1], rounded)) {
      motionPolyline.push(rounded);
    }
  };
  const appendMove = (
    start: Point3,
    end: Point3,
    kind: CamMotionSegmentKind,
    feedRate?: number,
    sourcePathId?: string,
    sourceSegmentIndex?: number,
  ) => {
    if (pointsEqual(start, end)) {
      appendPoint(end);
      return;
    }
    appendPoint(start);
    appendPoint(end);
    motionSegments.push({
      start,
      end,
      kind,
      ...(Number.isFinite(feedRate) && Number(feedRate) > 0 ? { feedRate: Number(feedRate) } : {}),
      ...(sourcePathId ? { sourcePathId } : {}),
      ...(Number.isInteger(sourceSegmentIndex) && sourceSegmentIndex! >= 0 ? { sourceSegmentIndex } : {}),
    });
  };

  let current: Point3 | null = null;
  let currentPathId = '';
  const safe = roundCoord(safeZ);
  const rapidFeed = clampPositive(rapidRate, 2500);
  const programStart: Point3 = [0, 0, safe];
  for (const path of paths || []) {
    if (!pathHasFiniteCoordinates(path)) continue;
    const points = Array.isArray(path.points) ? path.points : [];
    if (points.length < 2) continue;
    const pathId = String(path.id || '');
    const cutFeed = clampPositive(path.feedRate, 800);
    const plungeFeed = clampPositive(path.plungeRate, 200);
    const rawLinkFeed = Number(path.linkFeedRate);
    const linkFeed = Number.isFinite(rawLinkFeed) && rawLinkFeed > 0 ? rawLinkFeed : rapidFeed;
    const first = points[0];
    const safeAboveFirst: Point3 = [roundCoord(first[0]), roundCoord(first[1]), safe];
    const travelStart = current || programStart;
    const retract: Point3 = [roundCoord(travelStart[0]), roundCoord(travelStart[1]), safe];
    if (current) {
      appendMove(current, retract, 'retract', rapidFeed, currentPathId);
    }
    appendMove(retract, safeAboveFirst, 'rapid', rapidFeed, pathId);
    appendMove(safeAboveFirst, first, 'plunge', plungeFeed, pathId);
    for (let i = 1; i < points.length; i += 1) {
      const kind = pathSegmentKind(path, i - 1);
      appendMove(
        points[i - 1],
        points[i],
        kind,
        kind === 'cut' ? cutFeed : (kind === 'link' ? linkFeed : rapidFeed),
        pathId,
        i - 1,
      );
    }
    current = points[points.length - 1];
    currentPathId = pathId;
  }
  if (current) {
    const retract: Point3 = [roundCoord(current[0]), roundCoord(current[1]), safe];
    appendMove(current, retract, 'retract', rapidFeed, currentPathId);
  }
  return { motionPolyline, motionSegments };
}

function buildSimulationData(
  paths: CamToolpathPath[],
  toolDiameter: number,
  toolLength: number,
  safeZ: number,
  cutterProfileInput: CamToolpathCutterProfileSnapshot | null = null,
  rapidRate = 2500,
) {
  const cutterProfile = serializeCutterProfile(createCamCutterProfile(cutterProfileInput || {
    kind: 'flat',
    diameter: toolDiameter,
    cuttingLength: toolLength,
  }));
  const radius = Math.max(0.0001, Number(cutterProfile.radius) || toolDiameter * 0.5);
  const samples: Point3[] = [];
  const sweptSegments: CamSweptSegment[] = [];
  const motion = buildMotionData(paths, safeZ, rapidRate);
  const seenSamples = new Set<string>();
  const addSample = (point: Point3) => {
    const key = point.map((value) => formatCoord(value)).join(',');
    if (seenSamples.has(key)) return;
    seenSamples.add(key);
    samples.push(point);
  };
  for (const path of paths || []) {
    const points = Array.isArray(path.simulationSamples) ? path.simulationSamples : (Array.isArray(path.points) ? path.points : []);
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
      toolShape: cutterProfile.kind,
      cutterProfile,
    });
  }
  const sweptHulls = buildSweptHullArtifacts(sweptSegments, toolLength, cutterProfile);
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
  cutterProfileInput: CamToolpathCutterProfileSnapshot | null,
  options: AnyRecord = {},
  rapidRate = 2500,
) {
  const cutterProfile = serializeCutterProfile(createCamCutterProfile(cutterProfileInput || {
    kind: 'flat',
    diameter: toolDiameter,
    cuttingLength: toolLength,
  }));
  const radius = Math.max(0.0001, Number(cutterProfile.radius) || toolDiameter * 0.5);
  const samples: Point3[] = [];
  const sweptSegments: CamSweptSegment[] = [];

  emitCamProgress(options, {
    phase: 'simulation-motion',
    message: 'Building cutter motion segments',
    detail: 'Expanding toolpath polylines into rapid, plunge, cut, link, and retract moves.',
    current: 68,
  });
  await yieldCamProgress(options);

  const motion = buildMotionData(paths, safeZ, rapidRate);
  const seenSamples = new Set<string>();
  const addSample = (point: Point3) => {
    const key = point.map((value) => formatCoord(value)).join(',');
    if (seenSamples.has(key)) return;
    seenSamples.add(key);
    samples.push(point);
  };
  for (const path of paths || []) {
    const points = Array.isArray(path.simulationSamples) ? path.simulationSamples : (Array.isArray(path.points) ? path.points : []);
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
      toolShape: cutterProfile.kind,
      cutterProfile,
    });
  }

  emitCamProgress(options, {
    phase: 'swept-hulls',
    message: 'Building swept cutter hulls',
    detail: `${sweptSegments.length} cutter movement segment${sweptSegments.length === 1 ? '' : 's'} will be converted into ${cutterProfile.kind} cutter sweep meshes.`,
    current: 76,
  });
  await yieldCamProgress(options);
  const sweptHulls = await buildSweptHullArtifactsAsync(sweptSegments, toolLength, cutterProfile, options);

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
    if (!pathHasFiniteCoordinates(path)) continue;
    if (!Array.isArray(path.points) || path.points.length < 2) continue;
    const first = path.points[0];
    const cutFeed = clampPositive(path.feedRate, 800);
    const rawLinkFeed = Number(path.linkFeedRate);
    const linkFeed = Number.isFinite(rawLinkFeed) && rawLinkFeed > 0 ? rawLinkFeed : null;
    if (!profile.stripComments) lines.push(`; ${commentPrefix}${path.id} Z${formatCoord(path.z)}`);
    lines.push(formatLine(['G0', `Z${formatCoord(safeZ)}`], '', profile));
    lines.push(formatLine(['G0', `X${formatCoord(first[0])}`, `Y${formatCoord(first[1])}`], '', profile));
    lines.push(formatLine(['G1', `Z${formatCoord(first[2])}`, `F${formatCoord(path.plungeRate)}`], '', profile));
    let activeFeed: number | null = null;
    for (let i = 1; i < path.points.length; i += 1) {
      const point = path.points[i];
      const segmentKind = pathSegmentKind(path, i - 1);
      if (segmentKind === 'link' && linkFeed != null) {
        if (activeFeed !== linkFeed) {
          lines.push(formatLine(['G1', `F${formatCoord(linkFeed)}`], '', profile));
          activeFeed = linkFeed;
        }
        lines.push(formatLine(['G1', `X${formatCoord(point[0])}`, `Y${formatCoord(point[1])}`, `Z${formatCoord(point[2])}`], '', profile));
        continue;
      }
      if (segmentKind === 'rapid' || segmentKind === 'link') {
        lines.push(formatLine(['G0', `X${formatCoord(point[0])}`, `Y${formatCoord(point[1])}`, `Z${formatCoord(point[2])}`], '', profile));
        activeFeed = null;
        continue;
      }
      if (activeFeed !== cutFeed) {
        lines.push(formatLine(['G1', `F${formatCoord(cutFeed)}`], '', profile));
        activeFeed = cutFeed;
      }
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

function invalidCutterWarnings(cutterProfile: ReturnType<typeof createCamCutterProfile>) {
  return cutterProfile.validate().map((error) => `Invalid cutter profile: ${error}`);
}

function rawProfileParam(source: AnyRecord | null, key: string) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  const value = source[key];
  if (value == null || value === '') return null;
  return { key, value };
}

function invalidMachineProfileWarnings(rawProfile: any, machine: CamMachineProfile) {
  const warnings: string[] = [];
  const source = rawProfile && typeof rawProfile === 'object' ? rawProfile as AnyRecord : null;
  const maxSpindle = rawProfileParam(source, 'maxSpindleRPM');
  const rapid = rawProfileParam(source, 'defaultRapidRate');
  const park = rawProfileParam(source, 'safeParkZ');
  for (const param of [maxSpindle, rapid]) {
    if (!param) continue;
    const num = Number(param.value);
    if (!(Number.isFinite(num) && num > 0)) {
      warnings.push(`Invalid CAM machine profile: ${param.key} must be a positive finite number.`);
    }
  }
  if (park) {
    const num = Number(park.value);
    if (!(Number.isFinite(num) && num >= 0)) {
      warnings.push('Invalid CAM machine profile: safeParkZ must be a non-negative finite number.');
    }
  }
  if (!(Number.isFinite(machine.maxSpindleRPM) && machine.maxSpindleRPM > 0)) {
    warnings.push('Invalid CAM machine profile: maxSpindleRPM must be a positive finite number.');
  }
  if (!(Number.isFinite(machine.defaultRapidRate) && machine.defaultRapidRate > 0)) {
    warnings.push('Invalid CAM machine profile: defaultRapidRate must be a positive finite number.');
  }
  if (!(Number.isFinite(machine.safeParkZ) && machine.safeParkZ >= 0)) {
    warnings.push('Invalid CAM machine profile: safeParkZ must be a non-negative finite number.');
  }
  return Array.from(new Set(warnings));
}

function invalidStockProfileWarnings(rawProfile: any) {
  if (rawProfile == null || rawProfile === '') return [];
  if (!rawProfile || typeof rawProfile !== 'object') {
    return ['Invalid CAM stock profile: stockProfile must be an object.'];
  }
  const warnings: string[] = [];
  const source = rawProfile as AnyRecord;
  const mode = rawProfileParam(source, 'mode');
  if (mode) {
    const rawMode = String(mode.value || '').trim().toLowerCase();
    if (rawMode !== 'auto' && rawMode !== 'fixed') {
      warnings.push('Invalid CAM stock profile: mode must be auto or fixed.');
    }
  }
  const margin = rawProfileParam(source, Object.prototype.hasOwnProperty.call(source, 'margin') ? 'margin' : 'stockMargin');
  if (margin) {
    const num = Number(margin.value);
    if (!(Number.isFinite(num) && num >= 0)) {
      warnings.push(`Invalid CAM stock profile: ${margin.key} must be a non-negative finite number.`);
    }
  }
  for (const key of ['sizeX', 'sizeY', 'sizeZ']) {
    const param = rawProfileParam(source, key);
    if (!param) continue;
    const num = Number(param.value);
    if (!(Number.isFinite(num) && num > 0)) {
      warnings.push(`Invalid CAM stock profile: ${key} must be a positive finite number.`);
    }
  }
  for (const key of ['offsetX', 'offsetY', 'offsetZ']) {
    const param = rawProfileParam(source, key);
    if (!param) continue;
    const num = Number(param.value);
    if (!Number.isFinite(num)) {
      warnings.push(`Invalid CAM stock profile: ${key} must be a finite number.`);
    }
  }
  return Array.from(new Set(warnings));
}

function invalidStepDownWarnings(params: AnyRecord, strategy: string) {
  if (isParallelFinishStrategy(strategy)) return [];
  const rawStepDown = params.stepDown;
  if (rawStepDown == null || rawStepDown === '') return [];
  const stepDown = Number(rawStepDown);
  return Number.isFinite(stepDown) && stepDown > 0
    ? []
    : ['Invalid CAM stepDown: stepDown must be a positive finite number.'];
}

function firstPresentParam(params: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = params?.[key];
    if (value != null && value !== '') return { key, value };
  }
  return null;
}

function positiveFiniteParamWarning(label: string, value: any) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0
    ? null
    : `Invalid CAM ${label}: ${label} must be a positive finite number.`;
}

function positiveFiniteIntegerParamWarning(label: string, value: any) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 && Number.isInteger(num)
    ? null
    : `Invalid CAM ${label}: ${label} must be a positive finite integer.`;
}

function finiteRangeParamWarning(label: string, value: any, min: number, max: number) {
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max
    ? null
    : `Invalid CAM ${label}: ${label} must be between ${formatCoord(min)} and ${formatCoord(max)}.`;
}

function finiteParamWarning(label: string, value: any) {
  const num = Number(value);
  return Number.isFinite(num)
    ? null
    : `Invalid CAM ${label}: ${label} must be a finite number.`;
}

function nonNegativeFiniteParamWarning(label: string, value: any) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0
    ? null
    : `Invalid CAM ${label}: ${label} must be a non-negative finite number.`;
}

function invalidSamplingWarnings(params: AnyRecord, strategy: string) {
  const warnings: string[] = [];
  const usesSampleSpacing = isParallelFinishStrategy(strategy) || isWaterlineContourStrategy(strategy);
  const usesAdaptiveSampling = isParallelFinishStrategy(strategy) || isAdaptiveWaterlineStrategy(strategy);
  const sample = usesSampleSpacing
    ? firstPresentParam(params, ['sampleSpacing', 'sampling', 'waterlineSampling'])
    : null;
  const minSample = usesAdaptiveSampling
    ? firstPresentParam(params, ['minSampleSpacing', 'minSampling'])
    : null;
  if (sample) {
    const warning = positiveFiniteParamWarning(sample.key, sample.value);
    if (warning) warnings.push(warning);
  }
  if (minSample) {
    const warning = positiveFiniteParamWarning(minSample.key, minSample.value);
    if (warning) warnings.push(warning);
  }
  if (usesAdaptiveSampling && params.flatnessCosLimit != null && params.flatnessCosLimit !== '') {
    const warning = finiteRangeParamWarning('flatnessCosLimit', params.flatnessCosLimit, -1, 1);
    if (warning) warnings.push(warning);
  }
  if (usesAdaptiveSampling && params.maxDepth != null && params.maxDepth !== '') {
    const warning = positiveFiniteIntegerParamWarning('maxDepth', params.maxDepth);
    if (warning) warnings.push(warning);
  }
  return warnings;
}

function invalidMachiningControlWarnings(params: AnyRecord, strategy: string) {
  const warnings: string[] = [];
  for (const key of ['stepover', 'safeHeight', 'feedRate', 'plungeRate']) {
    const param = firstPresentParam(params, [key]);
    if (!param) continue;
    const warning = positiveFiniteParamWarning(param.key, param.value);
    if (warning) warnings.push(warning);
  }
  const spindle = firstPresentParam(params, ['spindleRPM']);
  if (spindle) {
    const warning = nonNegativeFiniteParamWarning(spindle.key, spindle.value);
    if (warning) warnings.push(warning);
  }
  for (const key of ['stockAllowance', 'topZ', 'bottomZ']) {
    const param = firstPresentParam(params, [key]);
    if (!param) continue;
    const warning = finiteParamWarning(param.key, param.value);
    if (warning) warnings.push(warning);
  }
  if (isParallelFinishStrategy(strategy)) {
    for (const key of ['floorZ', 'rasterAngleDeg']) {
      const param = firstPresentParam(params, [key]);
      if (!param) continue;
      const warning = finiteParamWarning(param.key, param.value);
      if (warning) warnings.push(warning);
    }
  }
  return warnings;
}

export function getEarlyCamToolpathValidationWarnings(params: AnyRecord = {}) {
  const machine = normalizeCamMachineProfile(params.machineProfile);
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, toolLength);
  const strategy = normalizeCamStrategy(params.strategy);
  return [
    ...invalidMachineProfileWarnings(params.machineProfile, machine),
    ...invalidStockProfileWarnings(params.stockProfile),
    ...invalidCutterWarnings(cutterProfile),
    ...invalidStepDownWarnings(params, strategy),
    ...invalidSamplingWarnings(params, strategy),
    ...invalidMachiningControlWarnings(params, strategy),
  ];
}

function buildEmptyCamToolpathResult({
  operationId,
  operationName,
  safeZ,
  machine,
  cutterProfile,
  toolDiameter,
  toolLength,
  spindleRPM,
  targetCount,
  triangleCount,
  targetBounds,
  warnings,
  params,
}: {
  operationId: string;
  operationName: string;
  safeZ: number;
  machine: CamMachineProfile;
  cutterProfile: ReturnType<typeof createCamCutterProfile>;
  toolDiameter: number;
  toolLength: number;
  spindleRPM: number;
  targetCount: number;
  triangleCount: number;
  targetBounds?: THREE.Box3 | null;
  warnings: string[];
  params: AnyRecord;
}) {
  const empty: Omit<CamToolpathResult, 'gcode'> = {
    operationId,
    operationName,
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds: null,
    targetBounds: targetBounds ? toSerializableBounds(targetBounds) : null,
    safeZ,
    machine,
    toolShape: cutterProfile.kind,
    cutterProfile: serializeCutterProfile(cutterProfile),
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
      triangleCount,
      levelCount: 0,
      pathCount: 0,
      moveCount: 0,
      motionSegmentCount: 0,
      sweptSegmentCount: 0,
      sweptHullCount: 0,
      estimatedCutLength: 0,
      estimatedRapidLength: 0,
      warningCount: warnings.length,
    },
    warnings,
  };
  return { ...empty, gcode: generateGcodeForToolpath(empty, params) };
}

function throwIfFaceSelectedToolpathsFailed(
  hasFaceDrive: boolean,
  paths: CamToolpathPath[],
  warnings: string[],
  operationName = '',
) {
  if (!hasFaceDrive || paths.length) return;
  const details = (warnings || [])
    .map((warning) => String(warning || '').trim())
    .filter(Boolean)
    .join(' ');
  const operationLabel = String(operationName || '').trim();
  const message = details || 'Selected CAM faces produced no valid finishing region.';
  throw new CamGenerationError(
    operationLabel ? `${operationLabel}: ${message}` : message,
    warnings,
  );
}

export function generateThreeAxisToolpath(viewer: any, params: AnyRecord = {}): CamToolpathResult {
  const warnings: string[] = [];
  const operationId = String(params.id || 'CAM3');
  const operationName = String(params.name || operationId || '3 Axis CAM Operation');
  const machine = normalizeCamMachineProfile(params.machineProfile);
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, toolLength);
  const toolDiameter = effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter);
  const spindleRPM = resultSpindleRPM({}, params, machine);
  const strategy = normalizeCamStrategy(params.strategy);
  const machineWarnings = invalidMachineProfileWarnings(params.machineProfile, machine);
  if (machineWarnings.length) {
    warnings.push(...machineWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }
  const stockProfileWarnings = invalidStockProfileWarnings(params.stockProfile);
  if (stockProfileWarnings.length) {
    warnings.push(...stockProfileWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }
  const cutterWarnings = invalidCutterWarnings(cutterProfile);
  if (cutterWarnings.length) {
    warnings.push(...cutterWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }
  const stepDownWarnings = invalidStepDownWarnings(params, strategy);
  if (stepDownWarnings.length) {
    warnings.push(...stepDownWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }
  const samplingWarnings = invalidSamplingWarnings(params, strategy);
  if (samplingWarnings.length) {
    warnings.push(...samplingWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }
  const machiningWarnings = invalidMachiningControlWarnings(params, strategy);
  if (machiningWarnings.length) {
    warnings.push(...machiningWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
  }

  const targetData = collectTargetTriangles(viewer, params, warnings);
  const triangles = targetData.triangles;
  const driveTriangles = targetData.driveTriangles || [];

  const bounds = computeTriangleBounds(triangles);
  const driveBounds = targetData.hasFaceDrive ? computeTriangleBounds(driveTriangles) : bounds;
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
      toolShape: cutterProfile.kind,
      cutterProfile: serializeCutterProfile(cutterProfile),
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
        estimatedRapidLength: 0,
        warningCount: warnings.length,
      },
      warnings,
    };
    return { ...empty, gcode: generateGcodeForToolpath(empty, params) };
  }

  const stockBounds = computeStockBounds(bounds, params, toolDiameter);
  const safeZ = roundCoord(Math.max(stockBounds.max.z, bounds.max.z, nullableFiniteNumber(params.topZ) ?? bounds.max.z) + Math.max(0.1, finiteNumber(params.safeHeight, 5)));
  const stockWarnings = fixedStockContainmentWarnings(bounds, stockBounds, params);
  if (stockWarnings.length) {
    warnings.push(...stockWarnings);
    return buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: targetData.targetCount,
      triangleCount: triangles.length,
      targetBounds: bounds,
      warnings,
      params,
    });
  }
  const contourStrategy = isWaterlineContourStrategy(strategy);
  const contourDriveTriangles = contourStrategy && targetData.hasFaceDrive ? driveTriangles : triangles;
  const contourDriveBounds = contourStrategy && targetData.hasFaceDrive ? driveBounds : bounds;
  const levels = buildZLevels(contourDriveBounds || bounds, params);
  maybeWarnCutterLengthForCutDepth(
    warnings,
    cutterProfile,
    isParallelFinishStrategy(strategy) ? (driveBounds || bounds) : (contourDriveBounds || bounds),
    params,
  );
  const waterlineStats: CamWaterlineStats | null = isWaterlineContourStrategy(strategy)
    ? { xFiberCount: 0, yFiberCount: 0, subdivisionCount: 0, maxDepthReached: false }
    : null;
  let paths: CamToolpathPath[] = [];
  let protectedSectionStack: Section2[] = [];
  if (isParallelFinishStrategy(strategy)) {
    if (targetData.hasFaceDrive && !driveBounds) {
      warnings.push('Selected CAM faces produced no valid finishing region.');
    } else {
      paths.push(...buildParallelFinishPaths({
        bounds: driveBounds || bounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        driveTriangles,
        safeZ,
        warnings,
      }));
    }
  } else if (contourStrategy && targetData.hasFaceDrive && !driveBounds) {
    warnings.push('Selected CAM faces produced no valid finishing region.');
  } else {
    protectedSectionStack = buildProtectedSectionStack(triangles, bounds, levels, params, toolDiameter);
    for (const z of levels) {
      const segments = sliceMeshAtZ(contourDriveTriangles, z);
      if (!segments.length) continue;
      const levelProtectedSections = protectedSectionStack.filter((section) => section.z >= z - EPS);
      const levelPaths = contourStrategy
        ? buildContourPathsForLevel({
          segments,
          z,
          stockBounds,
          targetMaxZ: bounds.max.z,
          params,
          pathStartIndex: paths.length,
          targetTriangles: triangles,
          protectedSections: levelProtectedSections,
          warnings,
          waterlineStats: waterlineStats || undefined,
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
  }

  paths = applyCutterLocationLineFilter(paths, params, warnings);
  paths = applyCamPathOrdering(paths, params, strategy, safeZ, warnings);
  if (contourStrategy) {
    paths = finalOutsideContourSafetyFilter(paths, params, {
      protectedSections: protectedSectionStack,
      targetTriangles: triangles,
      stockBounds,
      toolRadius: toolDiameter * 0.5,
      cutterProfile,
      targetMaxZ: bounds.max.z,
    });
  }
  paths = rejectInvalidToolpathCoordinatePaths(paths, warnings);

  if (!paths.length) {
    warnings.push(targetData.hasFaceDrive
      ? 'No toolpath intervals were generated. Check tool diameter, stepover, and selected faces.'
      : 'No toolpath intervals were generated. Check tool diameter, stepover, and selected solids.');
  }
  throwIfFaceSelectedToolpathsFailed(targetData.hasFaceDrive, paths, warnings, operationName);

  const cutLength = paths.reduce((sum, path) => sum + pathLength(path), 0);
  const cutterProfileSnapshot = serializeCutterProfile(cutterProfile);
  const simulationSafeZ = motionSafeZForMachine(safeZ, machine);
  const simulation = buildSimulationData(paths, toolDiameter, toolLength, simulationSafeZ, cutterProfileSnapshot, machine.defaultRapidRate);
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
    toolShape: cutterProfile.kind,
    cutterProfile: cutterProfileSnapshot,
    spindleRPM,
    paths,
    machine,
    simulation,
    summary: {
      targetCount: targetData.targetCount,
      triangleCount: triangles.length,
      levelCount: isParallelFinishStrategy(strategy) ? 1 : levels.length,
      pathCount: paths.length,
      moveCount: paths.reduce((sum, path) => sum + pathCutMoveCount(path), 0),
      motionSegmentCount: simulation.motionSegments.length,
      sweptSegmentCount: simulation.sweptSegments.length,
      sweptHullCount: simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(cutLength),
      estimatedRapidLength: estimatedRapidLengthFromMotionSegments(simulation.motionSegments),
      warningCount: warnings.length,
      ...waterlineSummaryFields(waterlineStats),
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
  const nominalToolDiameter = clampPositive(params.toolDiameter, 3.175);
  const toolLength = clampPositive(params.toolLength, 25);
  const cutterProfile = buildCutterProfileFromParams(params, nominalToolDiameter, toolLength);
  const toolDiameter = effectiveToolDiameterFromProfile(cutterProfile, nominalToolDiameter);
  const spindleRPM = resultSpindleRPM({}, params, machine);
  const strategy = normalizeCamStrategy(params.strategy);
  const machineWarnings = invalidMachineProfileWarnings(params.machineProfile, machine);
  if (machineWarnings.length) {
    warnings.push(...machineWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-machine-profile',
      message: 'Invalid CAM machine profile',
      detail: machineWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const stockProfileWarnings = invalidStockProfileWarnings(params.stockProfile);
  if (stockProfileWarnings.length) {
    warnings.push(...stockProfileWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-stock-profile',
      message: 'Invalid CAM stock profile',
      detail: stockProfileWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const cutterWarnings = invalidCutterWarnings(cutterProfile);
  if (cutterWarnings.length) {
    warnings.push(...cutterWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-cutter',
      message: 'Invalid cutter profile',
      detail: cutterWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const stepDownWarnings = invalidStepDownWarnings(params, strategy);
  if (stepDownWarnings.length) {
    warnings.push(...stepDownWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-stepdown',
      message: 'Invalid CAM stepdown',
      detail: stepDownWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const samplingWarnings = invalidSamplingWarnings(params, strategy);
  if (samplingWarnings.length) {
    warnings.push(...samplingWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-sampling',
      message: 'Invalid CAM sampling settings',
      detail: samplingWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const machiningWarnings = invalidMachiningControlWarnings(params, strategy);
  if (machiningWarnings.length) {
    warnings.push(...machiningWarnings);
    const safeZ = finiteNumber(params.safeHeight, 5);
    emitCamProgress(params, {
      phase: 'invalid-machining-controls',
      message: 'Invalid CAM machining controls',
      detail: machiningWarnings.join(' '),
      current: 4,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount: 0,
      triangleCount: 0,
      targetBounds: null,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }

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
  const driveTriangles: Triangle[] = [];
  let hasFaceDrive = false;
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
      const targetFaceNames = Array.isArray(target?.faceNames) ? target.faceNames : [];
      const drive = readSerializedDriveTriangles(target, warnings, index);
      if (targetFaceNames.length || drive.length) hasFaceDrive = true;
      if (drive.length) {
        driveTriangles.push(...drive);
      }
    }
  } else {
    hasFaceDrive = hasReferenceSelection(params.targetFaces);
    const solids = collectCamTargetSolids(viewer, params.targetSolids, params.targetFaces);
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
      if (hasFaceDrive) {
        driveTriangles.push(...extractTrianglesFromSolid(solid, {
          faceSelection: params.targetFaces,
          warnings,
        }));
      }
    }
  }

  const bounds = computeTriangleBounds(triangles);
  const effectiveDriveTriangles = hasFaceDrive ? driveTriangles : triangles;
  const driveBounds = hasFaceDrive ? computeTriangleBounds(effectiveDriveTriangles) : bounds;
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
      toolShape: cutterProfile.kind,
      cutterProfile: serializeCutterProfile(cutterProfile),
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
        estimatedRapidLength: 0,
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

  const stockBounds = computeStockBounds(bounds, params, toolDiameter);
  const safeZ = roundCoord(Math.max(stockBounds.max.z, bounds.max.z, nullableFiniteNumber(params.topZ) ?? bounds.max.z) + Math.max(0.1, finiteNumber(params.safeHeight, 5)));
  const stockWarnings = fixedStockContainmentWarnings(bounds, stockBounds, params);
  if (stockWarnings.length) {
    warnings.push(...stockWarnings);
    emitCamProgress(params, {
      phase: 'invalid-stock',
      message: 'Invalid CAM stock profile',
      detail: stockWarnings.join(' '),
      current: 24,
    });
    await yieldCamProgress(params);
    const result = buildEmptyCamToolpathResult({
      operationId,
      operationName,
      safeZ,
      machine,
      cutterProfile,
      toolDiameter,
      toolLength,
      spindleRPM,
      targetCount,
      triangleCount: triangles.length,
      targetBounds: bounds,
      warnings,
      params,
    });
    emitCamProgress(params, {
      phase: 'complete',
      message: 'CAM operation failed validation',
      detail: `${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      current: 100,
    });
    return result;
  }
  const contourStrategy = isWaterlineContourStrategy(strategy);
  const contourDriveTriangles = contourStrategy && hasFaceDrive ? effectiveDriveTriangles : triangles;
  const contourDriveBounds = contourStrategy && hasFaceDrive ? driveBounds : bounds;
  const levels = buildZLevels(contourDriveBounds || bounds, params);
  if (contourStrategy) {
    emitCamProgress(params, {
      phase: 'waterline-levels',
      message: 'Prepared waterline levels',
      detail: `${levels.length} level${levels.length === 1 ? '' : 's'} from Z ${formatCoord(levels[0] ?? 0)} to Z ${formatCoord(levels[levels.length - 1] ?? 0)}`,
      current: 24,
    });
    await yieldCamProgress(params);
  }
  maybeWarnCutterLengthForCutDepth(
    warnings,
    cutterProfile,
    isParallelFinishStrategy(strategy) ? (driveBounds || bounds) : (contourDriveBounds || bounds),
    params,
  );
  const waterlineStats: CamWaterlineStats | null = isWaterlineContourStrategy(strategy)
    ? { xFiberCount: 0, yFiberCount: 0, subdivisionCount: 0, maxDepthReached: false }
    : null;
  let paths: CamToolpathPath[] = [];
  let protectedSectionStack: Section2[] = [];
  const levelCount = Math.max(1, levels.length);
  const parallelStrategy = isParallelFinishStrategy(strategy);
  if (parallelStrategy) {
    emitCamProgress(params, {
      phase: 'parallel-region',
      message: 'Preparing parallel finish region',
      detail: hasFaceDrive ? 'Using selected face drive geometry.' : 'Using selected solid bounds.',
      current: 26,
    });
    await yieldCamProgress(params);

    emitCamProgress(params, {
      phase: 'parallel-pass-generate',
      message: 'Generating parallel finish passes',
      detail: strategy === 'parallel-finish-zig-zag' ? 'Bidirectional zig-zag' : 'One-way zig',
      current: 30,
    });
    await yieldCamProgress(params);
    if (hasFaceDrive && !driveBounds) {
      warnings.push('Selected CAM faces produced no valid finishing region.');
    } else {
      paths.push(...await buildParallelFinishPathsAsync({
        bounds: driveBounds || bounds,
        params,
        pathStartIndex: paths.length,
        targetTriangles: triangles,
        driveTriangles: effectiveDriveTriangles,
        safeZ,
        warnings,
      }));
    }
    emitCamProgress(params, {
      phase: 'parallel-project',
      message: 'Projected parallel finish passes',
      detail: `${paths.length} path${paths.length === 1 ? '' : 's'}`,
      current: 62,
    });
    await yieldCamProgress(params);
  } else if (contourStrategy && hasFaceDrive && !driveBounds) {
    warnings.push('Selected CAM faces produced no valid finishing region.');
  } else {
    protectedSectionStack = buildProtectedSectionStack(triangles, bounds, levels, params, toolDiameter);
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
      const segments = sliceMeshAtZ(contourDriveTriangles, z);
      if (!segments.length) continue;
      const levelProtectedSections = protectedSectionStack.filter((section) => section.z >= z - EPS);
      const levelPaths = contourStrategy
        ? await buildContourPathsForLevelAsync({
          segments,
          z,
          stockBounds,
          targetMaxZ: bounds.max.z,
          params,
          pathStartIndex: paths.length,
          targetTriangles: triangles,
          protectedSections: levelProtectedSections,
          warnings,
          waterlineStats: waterlineStats || undefined,
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
  }

  paths = applyCutterLocationLineFilter(paths, params, warnings);
  paths = applyCamPathOrdering(paths, params, strategy, safeZ, warnings);
  if (contourStrategy) {
    paths = finalOutsideContourSafetyFilter(paths, params, {
      protectedSections: protectedSectionStack,
      targetTriangles: triangles,
      stockBounds,
      toolRadius: toolDiameter * 0.5,
      cutterProfile,
      targetMaxZ: bounds.max.z,
    });
  }
  paths = rejectInvalidToolpathCoordinatePaths(paths, warnings);

  if (contourStrategy) {
    emitCamProgress(params, {
      phase: 'waterline-link',
      message: 'Linked waterline paths',
      detail: `${paths.length} path${paths.length === 1 ? '' : 's'} prepared for simulation.`,
      current: 63,
    });
    await yieldCamProgress(params);
  }

  if (parallelStrategy) {
    emitCamProgress(params, {
      phase: 'parallel-link',
      message: 'Linking parallel finish passes',
      detail: `${paths.length} path${paths.length === 1 ? '' : 's'} prepared for simulation.`,
      current: 64,
    });
    await yieldCamProgress(params);
  }

  if (!paths.length) {
    warnings.push(hasFaceDrive
      ? 'No toolpath intervals were generated. Check tool diameter, stepover, and selected faces.'
      : 'No toolpath intervals were generated. Check tool diameter, stepover, and selected solids.');
  }
  throwIfFaceSelectedToolpathsFailed(hasFaceDrive, paths, warnings, operationName);

  emitCamProgress(params, {
    phase: 'path-summary',
    message: 'Toolpath passes generated',
    detail: `${paths.length} path${paths.length === 1 ? '' : 's'} from ${levels.length} depth level${levels.length === 1 ? '' : 's'}.`,
    current: 64,
  });
  await yieldCamProgress(params);

  const cutLength = paths.reduce((sum, path) => sum + pathLength(path), 0);
  const cutterProfileSnapshot = serializeCutterProfile(cutterProfile);
  const simulationSafeZ = motionSafeZForMachine(safeZ, machine);
  const simulation = await buildSimulationDataAsync(paths, toolDiameter, toolLength, simulationSafeZ, cutterProfileSnapshot, params, machine.defaultRapidRate);
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
    toolShape: cutterProfile.kind,
    cutterProfile: cutterProfileSnapshot,
    spindleRPM,
    paths,
    machine,
    simulation,
    summary: {
      targetCount,
      triangleCount: triangles.length,
      levelCount: isParallelFinishStrategy(strategy) ? 1 : levels.length,
      pathCount: paths.length,
      moveCount: paths.reduce((sum, path) => sum + pathCutMoveCount(path), 0),
      motionSegmentCount: simulation.motionSegments.length,
      sweptSegmentCount: simulation.sweptSegments.length,
      sweptHullCount: simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(cutLength),
      estimatedRapidLength: estimatedRapidLengthFromMotionSegments(simulation.motionSegments),
      warningCount: warnings.length,
      ...waterlineSummaryFields(waterlineStats),
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
  if (parallelStrategy) {
    emitCamProgress(params, {
      phase: 'parallel-complete',
      message: 'Parallel finish complete',
      detail: `${result.summary.pathCount} path${result.summary.pathCount === 1 ? '' : 's'} linked and posted.`,
      current: 99,
    });
    await yieldCamProgress(params);
  }
  if (contourStrategy) {
    emitCamProgress(params, {
      phase: 'waterline-complete',
      message: 'Waterline contour complete',
      detail: `${result.summary.pathCount} path${result.summary.pathCount === 1 ? '' : 's'} linked and posted.`,
      current: 99,
    });
    await yieldCamProgress(params);
  }
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
  const qualifyPathIds = valid.length > 1;
  const seenPathIds = new Set<string>();
  const paths = valid.flatMap((result, resultIndex) => (result.paths || []).map((path, pathIndex) => {
    const sourcePathId = String(path?.id || `P${pathIndex + 1}`);
    const operationId = String(result.operationId || `OP${resultIndex + 1}`);
    const basePathId = qualifyPathIds ? `${operationId}:${sourcePathId}` : sourcePathId;
    let id = basePathId;
    let duplicateIndex = 2;
    while (seenPathIds.has(id)) {
      id = `${basePathId}#${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenPathIds.add(id);
    return {
      ...path,
      id,
      sourcePathId,
      operationId,
      operationName: String(result.operationName || operationId),
      points: (path.points || []).map((point) => [...point] as Point3),
      ...(Array.isArray(path.simulationSamples) ? { simulationSamples: path.simulationSamples.map((point) => [...point] as Point3) } : {}),
      ...(Array.isArray(path.segmentKinds) ? { segmentKinds: path.segmentKinds.slice() } : {}),
    };
  }));
  const simulation = {
    samples: valid.flatMap((result) => result.simulation?.samples || []),
    motionPolyline: [] as Point3[],
    motionSegments: [] as Array<{ start: Point3; end: Point3; kind: CamMotionSegmentKind; feedRate?: number; sourcePathId?: string }>,
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
  const cutterProfileSnapshot = valid[0]?.cutterProfile || serializeCutterProfile(buildCutterProfileFromParams(options, toolDiameter, toolLength));
  const toolShape = String(valid[0]?.toolShape || cutterProfileSnapshot.kind || 'flat');
  const spindleRPM = valid.length ? resultSpindleRPM(valid[0], {}, machine) : resultSpindleRPM({}, options, machine);
  const simulationSafeZ = motionSafeZForMachine(safeZ, machine);
  const motion = buildMotionData(paths, simulationSafeZ, machine.defaultRapidRate);
  simulation.motionPolyline = motion.motionPolyline;
  simulation.motionSegments = motion.motionSegments;
  if (!simulation.sweptHulls.length && simulation.sweptSegments.length) {
    simulation.sweptHulls = buildSweptHullArtifacts(simulation.sweptSegments, toolLength, cutterProfileSnapshot);
  }
  const warnings = valid.flatMap((result) => result.warnings || []);
  const summary = {
    targetCount: valid.reduce((sum, result) => sum + (result.summary?.targetCount || 0), 0),
    triangleCount: valid.reduce((sum, result) => sum + (result.summary?.triangleCount || 0), 0),
    levelCount: valid.reduce((sum, result) => sum + (result.summary?.levelCount || 0), 0),
    pathCount: paths.length,
    moveCount: paths.reduce((sum, path) => sum + pathCutMoveCount(path), 0),
    motionSegmentCount: simulation.motionSegments.length,
    sweptSegmentCount: simulation.sweptSegments.length,
    sweptHullCount: simulation.sweptHulls.length,
    estimatedCutLength: roundCoord(paths.reduce((sum, path) => sum + pathLength(path), 0)),
    estimatedRapidLength: estimatedRapidLengthFromMotionSegments(simulation.motionSegments),
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
    toolShape,
    cutterProfile: cutterProfileSnapshot,
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

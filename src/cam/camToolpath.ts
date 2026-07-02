import * as THREE from 'three';
import {
  normalizeCamMachineProfile,
  splitMachineMacroLines,
  type CamMachineProfile,
} from './CamMachineProfile.js';
import { normalizeCamStockProfile, type CamStockProfile } from './CamStockProfile.js';
import {
  PngcamDirection,
  PngcamFeedType,
  PngcamHeightmap,
  PngcamJob,
  PngcamOptions,
  newPngcamTool,
  type PngcamDepthSource,
  type PngcamToolpath,
} from './pngcamPort.js';

type AnyRecord = Record<string, any>;
type Point3 = [number, number, number];
type Triangle = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
type CamToolpathPathSegmentKind = 'rapid' | 'link' | 'cut';
type CamMotionSegmentKind = 'rapid' | 'plunge' | 'cut' | 'link' | 'retract';
type SupportedToolShape = 'flat' | 'ball' | 'vbit';

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
  includedAngleDeg?: number;
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
  bounds: { min: Point3; max: Point3 } | null;
  targetBounds: { min: Point3; max: Point3 } | null;
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
      bounds: { min: Point3; max: Point3 };
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
    heightmapSampleCount?: number;
    rasterLineCount?: number;
  };
  warnings: string[];
};

type PngcamAdapterSetup = {
  operationId: string;
  operationName: string;
  machine: CamMachineProfile;
  stockProfile: CamStockProfile;
  triangles: Triangle[];
  targetCount: number;
  targetBounds: NonNullable<CamToolpathResult['targetBounds']>;
  stockBounds: NonNullable<CamToolpathResult['bounds']>;
  toolDiameter: number;
  toolRadius: number;
  toolLength: number;
  toolShape: SupportedToolShape;
  includedAngleDeg: number;
  stepover: number;
  stepDown: number;
  sampleSpacing: number;
  feedRate: number;
  plungeRate: number;
  spindleRPM: number;
  safeZ: number;
  topZ: number;
  bottomZ: number;
  width: number;
  height: number;
  depth: number;
  widthPx: number;
  heightPx: number;
  warnings: string[];
};

const EPS = 1e-7;
const MAX_HEIGHTMAP_PIXELS = 90000;

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

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nullableFiniteNumber(value: any) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function positiveNumber(value: any, fallback: number, min = EPS) {
  const num = finiteNumber(value, fallback);
  return Math.max(min, Math.abs(num));
}

function roundCoord(value: number) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function toRoundedPoint(point: Point3): Point3 {
  return [roundCoord(point[0]), roundCoord(point[1]), roundCoord(point[2])];
}

function pointDistance(a: Point3, b: Point3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function pointsEqual(a: Point3, b: Point3, tolerance = 1e-7) {
  return pointDistance(a, b) <= tolerance;
}

function toPoint3(point: THREE.Vector3): Point3 {
  return [roundCoord(point.x), roundCoord(point.y), roundCoord(point.z)];
}

function scenePointToMachine(point: THREE.Vector3) {
  return new THREE.Vector3(point.x, point.z, point.y);
}

function abortMessageFromSignal(signal: any) {
  const reason = signal?.reason;
  return String(reason?.message || reason || 'CAM generation canceled');
}

function throwIfCamGenerationAborted(options: AnyRecord | null | undefined) {
  const signal = options?.signal;
  if (signal?.aborted) throw new CamGenerationAbortError(abortMessageFromSignal(signal));
}

function emitCamProgress(options: AnyRecord | null | undefined, event: CamToolpathProgressEvent) {
  const callback = options?.onProgress;
  if (typeof callback !== 'function') return;
  const total = Math.max(1, Number(event.total) || 100);
  const rawCurrent = Number(event.current);
  const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(total, rawCurrent)) : 0;
  try {
    callback({ ...event, current, total });
  } catch {
    // Progress callbacks are observational and should not break CAM generation.
  }
}

async function yieldCamProgress(options: AnyRecord | null | undefined) {
  throwIfCamGenerationAborted(options);
  const progressYield = options?.progressYield;
  if (typeof progressYield === 'function') {
    await progressYield();
  } else {
    await Promise.resolve();
  }
  throwIfCamGenerationAborted(options);
}

function normalizeToolShape(value: any): SupportedToolShape {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'ball') return 'ball';
  if (raw === 'vbit' || raw === 'v-bit' || raw === 'v') return 'vbit';
  return 'flat';
}

function makeCutterSnapshot(setupOrParams: Partial<PngcamAdapterSetup> & AnyRecord): CamToolpathCutterProfileSnapshot {
  const diameter = positiveNumber(setupOrParams.toolDiameter, 3.175);
  const shape = normalizeToolShape(setupOrParams.toolShape);
  const out: CamToolpathCutterProfileSnapshot = {
    kind: shape,
    diameter: roundCoord(diameter),
    radius: roundCoord(diameter * 0.5),
    cuttingLength: roundCoord(positiveNumber(setupOrParams.toolLength, 25)),
    shaftLength: 0,
  };
  if (shape === 'vbit') out.includedAngleDeg = roundCoord(positiveNumber(setupOrParams.includedAngleDeg ?? setupOrParams.includedAngle, 90));
  return out;
}

function triangleArea2D(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
}

function triangleHeightAtXY(triangle: Triangle, x: number, y: number) {
  const [a, b, c] = triangle;
  const area = triangleArea2D(a, b, c);
  if (Math.abs(area) <= EPS) return null;
  const w0 = (((b.x - x) * (c.y - y)) - ((b.y - y) * (c.x - x))) / area;
  const w1 = (((c.x - x) * (a.y - y)) - ((c.y - y) * (a.x - x))) / area;
  const w2 = 1 - w0 - w1;
  if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) return null;
  const z = (w0 * a.z) + (w1 * b.z) + (w2 * c.z);
  return Number.isFinite(z) ? z : null;
}

function triangleBounds2D(triangle: Triangle) {
  const [a, b, c] = triangle;
  return {
    minX: Math.min(a.x, b.x, c.x),
    maxX: Math.max(a.x, b.x, c.x),
    minY: Math.min(a.y, b.y, c.y),
    maxY: Math.max(a.y, b.y, c.y),
  };
}

function makeSurfaceSampler(triangles: Triangle[]) {
  const triangleData = triangles.map((triangle) => ({ triangle, bounds: triangleBounds2D(triangle) }));
  const cache = new Map<string, number>();
  return (x: number, y: number) => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const cached = cache.get(key);
    if (cached != null) return cached;
    let best = -Infinity;
    for (const item of triangleData) {
      if (x < item.bounds.minX - EPS || x > item.bounds.maxX + EPS) continue;
      if (y < item.bounds.minY - EPS || y > item.bounds.maxY + EPS) continue;
      const z = triangleHeightAtXY(item.triangle, x, y);
      if (z != null && z > best) best = z;
    }
    cache.set(key, best);
    return best;
  };
}

function triangleListBounds(triangles: Triangle[]) {
  if (!triangles.length) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const triangle of triangles) {
    for (const point of triangle) {
      min.min(point);
      max.max(point);
    }
  }
  return { min: toPoint3(min), max: toPoint3(max) };
}

function expandBounds(bounds: NonNullable<CamToolpathResult['targetBounds']>, stockProfile: CamStockProfile) {
  const min = [...bounds.min] as Point3;
  const max = [...bounds.max] as Point3;
  if (stockProfile.mode === 'fixed') {
    const center: Point3 = [
      (bounds.min[0] + bounds.max[0]) * 0.5 + stockProfile.offsetX,
      (bounds.min[1] + bounds.max[1]) * 0.5 + stockProfile.offsetY,
      (bounds.min[2] + bounds.max[2]) * 0.5 + stockProfile.offsetZ,
    ];
    const sizeX = stockProfile.sizeX || Math.max(EPS, bounds.max[0] - bounds.min[0] + stockProfile.margin * 2);
    const sizeY = stockProfile.sizeY || Math.max(EPS, bounds.max[1] - bounds.min[1] + stockProfile.margin * 2);
    const sizeZ = stockProfile.sizeZ || Math.max(EPS, bounds.max[2] - bounds.min[2] + stockProfile.margin * 2);
    return {
      min: [roundCoord(center[0] - sizeX * 0.5), roundCoord(center[1] - sizeY * 0.5), roundCoord(center[2] - sizeZ * 0.5)] as Point3,
      max: [roundCoord(center[0] + sizeX * 0.5), roundCoord(center[1] + sizeY * 0.5), roundCoord(center[2] + sizeZ * 0.5)] as Point3,
    };
  }
  const margin = Math.max(0, Number(stockProfile.margin) || 0);
  min[0] -= margin;
  min[1] -= margin;
  min[2] -= margin;
  max[0] += margin;
  max[1] += margin;
  max[2] += margin;
  min[0] += stockProfile.offsetX;
  max[0] += stockProfile.offsetX;
  min[1] += stockProfile.offsetY;
  max[1] += stockProfile.offsetY;
  min[2] += stockProfile.offsetZ;
  max[2] += stockProfile.offsetZ;
  return { min: toRoundedPoint(min), max: toRoundedPoint(max) };
}

function stockContainsTarget(stock: NonNullable<CamToolpathResult['bounds']>, target: NonNullable<CamToolpathResult['targetBounds']>) {
  return stock.min[0] <= target.min[0] + EPS
    && stock.min[1] <= target.min[1] + EPS
    && stock.min[2] <= target.min[2] + EPS
    && stock.max[0] >= target.max[0] - EPS
    && stock.max[1] >= target.max[1] - EPS
    && stock.max[2] >= target.max[2] - EPS;
}

function parseSerializedTriangles(meshes: any[]): { triangles: Triangle[]; targetCount: number } {
  const triangles: Triangle[] = [];
  let targetCount = 0;
  for (const mesh of meshes || []) {
    const raw = Array.isArray(mesh?.triangles) ? mesh.triangles : [];
    if (raw.length >= 9) targetCount += 1;
    for (let index = 0; index + 8 < raw.length; index += 9) {
      const points = [
        new THREE.Vector3(Number(raw[index]), Number(raw[index + 1]), Number(raw[index + 2])),
        new THREE.Vector3(Number(raw[index + 3]), Number(raw[index + 4]), Number(raw[index + 5])),
        new THREE.Vector3(Number(raw[index + 6]), Number(raw[index + 7]), Number(raw[index + 8])),
      ] as Triangle;
      if (points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) {
        triangles.push(points);
      }
    }
  }
  return { triangles, targetCount };
}

function flattenTriangles(triangles: Triangle[]) {
  const out: number[] = [];
  for (const triangle of triangles) {
    for (const point of triangle) out.push(roundCoord(point.x), roundCoord(point.y), roundCoord(point.z));
  }
  return out;
}

function resolveFaceIds(solid: any, faceSelection: any = null) {
  const rawList = Array.isArray(faceSelection) ? faceSelection : (faceSelection ? [faceSelection] : []);
  if (!rawList.length) return null;
  const ids = new Set<number>();
  const map = solid?._faceNameToID || solid?.userData?.faceNameToID || null;
  for (const item of rawList) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      ids.add(item);
      continue;
    }
    const key = String(item?.name || item?.id || item || '');
    const mapped = typeof map?.get === 'function' ? map.get(key) : map?.[key];
    const numeric = Number(mapped ?? item?.faceID ?? item?.faceId);
    if (Number.isFinite(numeric)) ids.add(numeric);
  }
  return ids.size ? ids : null;
}

export function extractTrianglesFromSolid(solid: any, options: AnyRecord = {}): Triangle[] {
  if (!solid) return [];
  if (Array.isArray(solid.triangles)) return parseSerializedTriangles([solid]).triangles;
  const mesh = typeof solid.getMesh === 'function' ? solid.getMesh() : solid.mesh || null;
  if (!mesh) return [];
  const vertices = mesh.vertProperties || mesh.vertices || mesh.positions || [];
  const indices = mesh.triVerts || mesh.indices || [];
  const faceIds = mesh.faceID || mesh.faceIds || mesh.faceIDs || null;
  const selectedFaceIds = resolveFaceIds(solid, options.faceSelection);
  const matrix = solid.matrixWorld instanceof THREE.Matrix4 ? solid.matrixWorld : null;
  const out: Triangle[] = [];
  const vertexAt = (index: number) => {
    const offset = index * 3;
    const point = new THREE.Vector3(
      Number(vertices[offset]),
      Number(vertices[offset + 1]),
      Number(vertices[offset + 2]),
    );
    if (matrix) point.applyMatrix4(matrix);
    return scenePointToMachine(point);
  };
  for (let i = 0, triIndex = 0; i + 2 < indices.length; i += 3, triIndex += 1) {
    if (selectedFaceIds && faceIds && !selectedFaceIds.has(Number(faceIds[triIndex]))) continue;
    const triangle = [vertexAt(Number(indices[i])), vertexAt(Number(indices[i + 1])), vertexAt(Number(indices[i + 2]))] as Triangle;
    if (triangle.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) {
      out.push(triangle);
    }
  }
  try { mesh.delete?.(); } catch { /* ignore mesh cleanup errors */ }
  return out;
}

function collectVisibleSolids(root: any, out: any[] = []) {
  if (!root) return out;
  if ((root.type === 'SOLID' || typeof root.getMesh === 'function') && root.visible !== false) out.push(root);
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) collectVisibleSolids(child, out);
  return out;
}

function resolveTargetSolids(viewer: any, selection: any = null) {
  const scene = viewer?.scene || viewer?.partHistory?.scene || null;
  const partHistory = viewer?.partHistory || null;
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

export function collectCamTargetMeshPayloads(
  viewer: any,
  targetSelection: any = null,
  targetFaceSelection: any = null,
): CamSerializedTargetPayload {
  const solids = resolveTargetSolids(viewer, targetSelection);
  const targets: CamSerializedTargetMesh[] = [];
  for (const solid of solids) {
    const triangles = extractTrianglesFromSolid(solid);
    if (!triangles.length) continue;
    const driveTriangles = targetFaceSelection ? extractTrianglesFromSolid(solid, { faceSelection: targetFaceSelection }) : [];
    targets.push({
      name: String(solid?.name || solid?.id || ''),
      triangles: flattenTriangles(triangles),
      driveTriangles: driveTriangles.length ? flattenTriangles(driveTriangles) : undefined,
    });
  }
  return { targetCount: targets.length, targets };
}

function collectTrianglesForGeneration(viewer: any, params: AnyRecord) {
  if (Array.isArray(params.targetMeshes)) return parseSerializedTriangles(params.targetMeshes);
  const payload = collectCamTargetMeshPayloads(viewer, params.targetSolids, null);
  return parseSerializedTriangles(payload.targets);
}

function makeSetup(viewer: any, params: AnyRecord = {}): PngcamAdapterSetup | { warnings: string[]; machine: CamMachineProfile } {
  const machine = normalizeCamMachineProfile(params.machineProfile);
  const stockProfile = normalizeCamStockProfile(params.stockProfile);
  const warnings = getEarlyCamToolpathValidationWarnings(params);
  const operationId = String(params.id || 'CAM');
  const operationName = String(params.name || 'Simple CNC Raster');
  if (warnings.length) return { warnings, machine };

  const { triangles, targetCount } = collectTrianglesForGeneration(viewer, params);
  const targetBounds = triangleListBounds(triangles);
  if (!triangles.length || !targetBounds) {
    return { warnings: ['No target mesh triangles available for CAM generation.'], machine };
  }

  const stockBounds = expandBounds(targetBounds, stockProfile);
  if (!stockContainsTarget(stockBounds, targetBounds)) {
    return { warnings: ['Fixed stock does not fully contain the selected target.'], machine };
  }

  const toolShape = normalizeToolShape(params.toolShape);
  const toolDiameter = positiveNumber(params.toolDiameter, 3.175);
  const toolRadius = toolDiameter * 0.5;
  const toolLength = positiveNumber(params.toolLength, 25);
  const includedAngleDeg = positiveNumber(params.includedAngleDeg ?? params.includedAngle, 90);
  const stepover = positiveNumber(params.stepover, Math.max(toolDiameter * 0.45, 0.25));
  const stepDown = positiveNumber(params.stepDown, 1);
  const feedRate = positiveNumber(params.feedRate, 800, 1);
  const plungeRate = positiveNumber(params.plungeRate, 200, 1);
  const spindleRPM = Math.min(positiveNumber(params.spindleRPM, 12000, 1), Math.max(1, machine.maxSpindleRPM || 1));
  const explicitTop = nullableFiniteNumber(params.topZ);
  const explicitBottom = nullableFiniteNumber(params.bottomZ);
  const topZ = explicitTop == null ? stockBounds.max[2] : Math.min(stockBounds.max[2], explicitTop);
  const bottomZ = explicitBottom == null ? stockBounds.min[2] : Math.max(stockBounds.min[2], explicitBottom);
  if (topZ <= bottomZ + EPS) return { warnings: ['Operation top Z must be above bottom Z.'], machine };

  const safeHeight = positiveNumber(params.safeHeight, 5, 0);
  const safeZ = Math.max(machine.safeParkZ, topZ + safeHeight);
  const width = Math.max(EPS, stockBounds.max[0] - stockBounds.min[0]);
  const height = Math.max(EPS, stockBounds.max[1] - stockBounds.min[1]);
  const depth = Math.max(EPS, topZ - bottomZ);
  let sampleSpacing = positiveNumber(
    params.sampleSpacing,
    Math.min(stepover, Math.max(toolRadius * 0.5, 0.25)),
    0.05,
  );
  let widthPx = Math.max(2, Math.ceil(width / sampleSpacing) + 1);
  let heightPx = Math.max(2, Math.ceil(height / sampleSpacing) + 1);
  const pixelCount = widthPx * heightPx;
  if (pixelCount > MAX_HEIGHTMAP_PIXELS) {
    sampleSpacing *= Math.sqrt(pixelCount / MAX_HEIGHTMAP_PIXELS);
    widthPx = Math.max(2, Math.ceil(width / sampleSpacing) + 1);
    heightPx = Math.max(2, Math.ceil(height / sampleSpacing) + 1);
    warnings.push(`Heightmap sampling was coarsened to ${roundCoord(sampleSpacing)} to keep generation bounded.`);
  }

  return {
    operationId,
    operationName,
    machine,
    stockProfile,
    triangles,
    targetCount,
    targetBounds,
    stockBounds,
    toolDiameter,
    toolRadius,
    toolLength,
    toolShape,
    includedAngleDeg,
    stepover,
    stepDown,
    sampleSpacing,
    feedRate,
    plungeRate,
    spindleRPM,
    safeZ,
    topZ,
    bottomZ,
    width,
    height,
    depth,
    widthPx,
    heightPx,
    warnings,
  };
}

function makeDepthSource(setup: PngcamAdapterSetup): PngcamDepthSource {
  const surfaceAt = makeSurfaceSampler(setup.triangles);
  return {
    widthPx: setup.widthPx,
    heightPx: setup.heightPx,
    getDepth: (x: number, y: number) => {
      if (x < 0 || y < 0 || x > setup.width || y > setup.height) return -setup.depth;
      const machineX = setup.stockBounds.min[0] + x;
      const machineY = setup.stockBounds.min[1] + y;
      const surfaceZ = surfaceAt(machineX, machineY);
      if (!Number.isFinite(surfaceZ)) return -setup.depth;
      return Math.max(-setup.depth, Math.min(0, surfaceZ - setup.topZ));
    },
  };
}

function makePngcamOptions(setup: PngcamAdapterSetup, params: AnyRecord = {}) {
  const toolType = setup.toolShape === 'vbit' ? `vbit${setup.includedAngleDeg}` : setup.toolShape;
  const direction = String(params.rasterAxis || '').toUpperCase() === 'Y'
    ? PngcamDirection.Vertical
    : PngcamDirection.Horizontal;
  return new PngcamOptions({
    safeZ: setup.safeZ - setup.topZ,
    rapidFeed: setup.machine.defaultRapidRate,
    xyFeed: setup.feedRate,
    zFeed: setup.plungeRate,
    rpm: setup.spindleRPM,
    width: setup.width,
    height: setup.height,
    depth: setup.depth,
    direction,
    stepOver: setup.stepover,
    stepDown: setup.stepDown,
    tool: newPngcamTool(toolType, setup.toolDiameter),
    stockToLeave: finiteNumber(params.stockAllowance, 0),
    roughingOnly: params.roughingOnly === true,
    omitTop: params.omitTop === true,
    omitBottom: params.omitBottom === true,
    rampEntry: params.rampEntry === true,
    cutBelowBottom: params.cutBelowBottom === true,
    cutBeyondEdges: params.cutBeyondEdges === true,
    xMmPerPx: setup.width / Math.max(1, setup.widthPx - 1),
    yMmPerPx: setup.height / Math.max(1, setup.heightPx - 1),
    widthPx: setup.widthPx,
    heightPx: setup.heightPx,
    maxVel: setup.machine.defaultRapidRate,
    quiet: true,
  });
}

function pngcamPointToMachine(setup: PngcamAdapterSetup, point: { x: number; y: number; z: number }): Point3 {
  return [
    roundCoord(setup.stockBounds.min[0] + point.x),
    roundCoord(setup.stockBounds.min[1] + point.y),
    roundCoord(setup.topZ + point.z),
  ];
}

function convertPngcamToolpath(setup: PngcamAdapterSetup, toolpath: PngcamToolpath) {
  const paths: CamToolpathPath[] = [];
  for (let index = 0; index < toolpath.segments.length; index += 1) {
    const segment = toolpath.segments[index];
    const points = segment.points.map((point) => pngcamPointToMachine(setup, point));
    if (points.length < 2) continue;
    paths.push({
      id: `P${index + 1}`,
      operationId: setup.operationId,
      operationName: setup.operationName,
      z: roundCoord(points[0][2]),
      feedRate: setup.feedRate,
      plungeRate: setup.plungeRate,
      points,
      segmentKinds: segment.points.slice(1).map((point) => (
        point.feed === PngcamFeedType.RapidFeed ? 'link' : 'cut'
      )),
      orderingPriority: index,
    });
  }
  return paths;
}

function buildPngcamPathsForSetup(setup: PngcamAdapterSetup, params: AnyRecord = {}) {
  const options = makePngcamOptions(setup, params);
  const heightmap = new PngcamHeightmap(makeDepthSource(setup), options);
  const job = new PngcamJob(options, heightmap);
  const toolpath = job.programToolpath();
  return {
    paths: convertPngcamToolpath(setup, toolpath),
    levelCount: Math.max(1, Math.ceil(setup.depth / setup.stepDown)),
    rasterLineCount: job.mainToolpath.segments.length,
    heightmapSampleCount: setup.widthPx * setup.heightPx,
  };
}

function buildSimulation(
  paths: CamToolpathPath[],
  safeZ: number,
  cutterProfile: CamToolpathCutterProfileSnapshot,
  machine: CamMachineProfile,
) {
  const samples: Point3[] = [];
  const motionPolyline: Point3[] = [];
  const motionSegments: CamToolpathResult['simulation']['motionSegments'] = [];
  const sweptSegments: CamSweptSegment[] = [];
  let previous: Point3 = [0, 0, safeZ];
  let estimatedCutLength = 0;
  let estimatedRapidLength = 0;

  const appendMotion = (
    start: Point3,
    end: Point3,
    kind: CamMotionSegmentKind,
    feedRate: number,
    sourcePathId?: string,
    sourceSegmentIndex?: number,
  ) => {
    if (pointsEqual(start, end)) return;
    motionSegments.push({ start, end, kind, feedRate, sourcePathId, sourceSegmentIndex });
    if (!motionPolyline.length) motionPolyline.push(start);
    motionPolyline.push(end);
    if (kind === 'cut' || kind === 'plunge') {
      sweptSegments.push({
        start,
        end,
        radius: cutterProfile.radius,
        toolShape: cutterProfile.kind,
        cutterProfile,
      });
      estimatedCutLength += pointDistance(start, end);
    } else {
      estimatedRapidLength += pointDistance(start, end);
    }
  };

  for (const path of paths) {
    const points = path.points || [];
    if (points.length < 2) continue;
    const first = points[0];
    const firstSafe: Point3 = [first[0], first[1], safeZ];
    appendMotion(previous, firstSafe, 'rapid', machine.defaultRapidRate, path.id);
    appendMotion(firstSafe, first, 'plunge', path.plungeRate, path.id);
    samples.push(first);
    for (let index = 1; index < points.length; index += 1) {
      const kind = path.segmentKinds?.[index - 1] === 'link' ? 'link' : 'cut';
      appendMotion(points[index - 1], points[index], kind, path.feedRate, path.id, index - 1);
      samples.push(points[index]);
    }
    const last = points[points.length - 1];
    const lastSafe: Point3 = [last[0], last[1], safeZ];
    appendMotion(last, lastSafe, 'retract', machine.defaultRapidRate, path.id);
    previous = lastSafe;
  }

  return {
    simulation: {
      samples,
      motionPolyline,
      motionSegments,
      sweptSegments,
      sweptHulls: [],
    },
    estimatedCutLength,
    estimatedRapidLength,
  };
}

function makeEmptyResult(params: AnyRecord, warnings: string[], machine = normalizeCamMachineProfile(params.machineProfile)): CamToolpathResult {
  const toolDiameter = positiveNumber(params.toolDiameter, 3.175);
  const toolLength = positiveNumber(params.toolLength, 25);
  const cutterProfile = makeCutterSnapshot({
    toolDiameter,
    toolLength,
    toolShape: normalizeToolShape(params.toolShape),
    includedAngleDeg: positiveNumber(params.includedAngleDeg ?? params.includedAngle, 90),
  });
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId: String(params.id || 'CAM'),
    operationName: String(params.name || 'Simple CNC Raster'),
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds: null,
    targetBounds: null,
    safeZ: Math.max(positiveNumber(params.safeHeight, 5, 0), machine.safeParkZ),
    machine,
    toolShape: cutterProfile.kind,
    cutterProfile,
    toolDiameter,
    toolLength,
    spindleRPM: Math.min(positiveNumber(params.spindleRPM, 12000, 1), Math.max(1, machine.maxSpindleRPM || 1)),
    paths: [],
    simulation: { samples: [], motionPolyline: [], motionSegments: [], sweptSegments: [], sweptHulls: [] },
    summary: {
      targetCount: 0,
      triangleCount: 0,
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
  return { ...base, gcode: generateGcodeForToolpath(base, params) };
}

function buildResultFromSetup(
  setup: PngcamAdapterSetup,
  raster: ReturnType<typeof buildPngcamPathsForSetup>,
  params: AnyRecord,
) {
  const cutterProfile = makeCutterSnapshot(setup);
  const simulation = buildSimulation(raster.paths, setup.safeZ, cutterProfile, setup.machine);
  const moveCount = raster.paths.reduce((sum, path) => sum + Math.max(0, path.points.length - 1), 0);
  const warnings = raster.paths.length
    ? setup.warnings
    : [...setup.warnings, 'No toolpaths generated. Check selected solids, stock size, cutter diameter, stepover, and cut depth.'];
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId: setup.operationId,
    operationName: setup.operationName,
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds: setup.stockBounds,
    targetBounds: setup.targetBounds,
    safeZ: roundCoord(setup.safeZ),
    machine: setup.machine,
    toolShape: setup.toolShape,
    cutterProfile,
    toolDiameter: roundCoord(setup.toolDiameter),
    toolLength: roundCoord(setup.toolLength),
    spindleRPM: roundCoord(setup.spindleRPM),
    paths: raster.paths,
    simulation: simulation.simulation,
    summary: {
      targetCount: setup.targetCount,
      triangleCount: setup.triangles.length,
      levelCount: raster.levelCount,
      pathCount: raster.paths.length,
      moveCount,
      motionSegmentCount: simulation.simulation.motionSegments.length,
      sweptSegmentCount: simulation.simulation.sweptSegments.length,
      sweptHullCount: simulation.simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(simulation.estimatedCutLength),
      estimatedRapidLength: roundCoord(simulation.estimatedRapidLength),
      warningCount: warnings.length,
      heightmapSampleCount: raster.heightmapSampleCount,
      rasterLineCount: raster.rasterLineCount,
    },
    warnings,
  };
  return { ...base, gcode: generateGcodeForToolpath(base, params) };
}

function formatWord(letter: string, value: number, precision = 4) {
  const rounded = roundCoord(value);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(precision).replace(/0+$/g, '').replace(/\.$/, '');
  return `${letter}${text}`;
}

function gcodeJoin(machine: CamMachineProfile, words: string[]) {
  return words.join(machine.tokenSpacer === false ? '' : ' ');
}

function pushComment(lines: string[], machine: CamMachineProfile, comment: string) {
  if (!machine.stripComments) lines.push(`; ${comment}`);
}

export function generateGcodeForToolpath(result: Omit<CamToolpathResult, 'gcode'>, params: AnyRecord = {}) {
  const machine = normalizeCamMachineProfile(params.machineProfile || result.machine);
  const lines: string[] = [];
  pushComment(lines, machine, 'Generated by BREP CAM');
  pushComment(lines, machine, `Machine: ${machine.name} (${machine.controller})`);
  pushComment(lines, machine, `Operation: ${result.operationName}`);
  pushComment(lines, machine, `Paths: ${result.paths.length}`);
  for (const macro of splitMachineMacroLines(machine.header)) lines.push(macro);
  lines.push(gcodeJoin(machine, ['G21', machine.stripComments ? '' : '; units: millimeters'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G90', machine.stripComments ? '' : '; absolute coordinates'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G17', machine.stripComments ? '' : '; XY plane'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', result.safeZ)]));
  if (result.spindleRPM > 0) lines.push(gcodeJoin(machine, ['M3', formatWord('S', result.spindleRPM, 0)]));
  for (const path of result.paths) {
    const points = path.points || [];
    if (points.length < 2) continue;
    pushComment(lines, machine, `${path.id} Z${roundCoord(path.z)}`);
    const first = points[0];
    lines.push(gcodeJoin(machine, ['G0', formatWord('Z', result.safeZ)]));
    lines.push(gcodeJoin(machine, ['G0', formatWord('X', first[0]), formatWord('Y', first[1])]));
    lines.push(gcodeJoin(machine, ['G1', formatWord('Z', first[2]), formatWord('F', path.plungeRate, 0)]));
    lines.push(gcodeJoin(machine, ['G1', formatWord('F', path.feedRate, 0)]));
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      lines.push(gcodeJoin(machine, ['G1', formatWord('X', point[0]), formatWord('Y', point[1]), formatWord('Z', point[2])]));
    }
  }
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', result.safeZ)]));
  lines.push('M5');
  for (const macro of splitMachineMacroLines(machine.footer)) lines.push(macro);
  lines.push('M2');
  return `${lines.join('\n')}\n`;
}

function generateGcodeForCombinedToolpaths(results: CamToolpathResult[], program: Omit<CamToolpathResult, 'gcode'>, options: AnyRecord = {}) {
  const machine = normalizeCamMachineProfile(options.machineProfile || program.machine);
  const lines: string[] = [];
  pushComment(lines, machine, 'Generated by BREP CAM');
  pushComment(lines, machine, `Machine: ${machine.name} (${machine.controller})`);
  pushComment(lines, machine, `Operations: ${results.length}`);
  for (const macro of splitMachineMacroLines(machine.header)) lines.push(macro);
  lines.push(gcodeJoin(machine, ['G21', machine.stripComments ? '' : '; units: millimeters'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G90', machine.stripComments ? '' : '; absolute coordinates'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G17', machine.stripComments ? '' : '; XY plane'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
  let activeRPM = -1;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    pushComment(lines, machine, `---- Operation ${index + 1}: ${result.operationName} ----`);
    if (result.spindleRPM !== activeRPM && result.spindleRPM > 0) {
      lines.push(gcodeJoin(machine, ['M3', formatWord('S', result.spindleRPM, 0)]));
      activeRPM = result.spindleRPM;
    }
    for (const path of result.paths || []) {
      const points = path.points || [];
      if (points.length < 2) continue;
      const first = points[0];
      lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
      lines.push(gcodeJoin(machine, ['G0', formatWord('X', first[0]), formatWord('Y', first[1])]));
      lines.push(gcodeJoin(machine, ['G1', formatWord('Z', first[2]), formatWord('F', path.plungeRate, 0)]));
      lines.push(gcodeJoin(machine, ['G1', formatWord('F', path.feedRate, 0)]));
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        lines.push(gcodeJoin(machine, ['G1', formatWord('X', point[0]), formatWord('Y', point[1]), formatWord('Z', point[2])]));
      }
    }
  }
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
  lines.push('M5');
  for (const macro of splitMachineMacroLines(machine.footer)) lines.push(macro);
  lines.push('M2');
  return `${lines.join('\n')}\n`;
}

export function getEarlyCamToolpathValidationWarnings(params: AnyRecord = {}) {
  const warnings: string[] = [];
  const toolShape = normalizeToolShape(params.toolShape);
  if (!(finiteNumber(params.toolDiameter, 3.175) > 0)) warnings.push('Tool diameter must be greater than zero.');
  if (toolShape === 'vbit' && !(finiteNumber(params.includedAngleDeg ?? params.includedAngle, 90) > 0)) {
    warnings.push('V-bit included angle must be greater than zero.');
  }
  if (!(finiteNumber(params.stepover, 1.5) > 0)) warnings.push('Stepover must be greater than zero.');
  if (!(finiteNumber(params.stepDown, 1) > 0)) warnings.push('Step-down must be greater than zero.');
  if (!(finiteNumber(params.feedRate, 800) > 0)) warnings.push('Feed rate must be greater than zero.');
  if (!(finiteNumber(params.plungeRate, 200) > 0)) warnings.push('Plunge rate must be greater than zero.');
  if (!(finiteNumber(params.spindleRPM, 12000) > 0)) warnings.push('Spindle RPM must be greater than zero.');
  const machine = normalizeCamMachineProfile(params.machineProfile);
  if (!(machine.maxSpindleRPM > 0)) warnings.push('Machine maximum spindle RPM must be greater than zero.');
  return warnings;
}

export function generateThreeAxisToolpath(viewer: any, params: AnyRecord = {}): CamToolpathResult {
  const setup = makeSetup(viewer, params);
  if (!('triangles' in setup)) return makeEmptyResult(params, setup.warnings, setup.machine);
  emitCamProgress(params, {
    phase: 'heightmap',
    message: 'Preparing pngcam heightmap',
    detail: `${setup.widthPx} x ${setup.heightPx}`,
    current: 12,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  const raster = buildPngcamPathsForSetup(setup, params);
  emitCamProgress(params, {
    phase: 'gcode',
    message: 'Posting G-code',
    detail: `${raster.paths.length} paths`,
    current: 88,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  const result = buildResultFromSetup(setup, raster, params);
  emitCamProgress(params, {
    phase: 'complete',
    message: 'CAM toolpaths ready',
    detail: `${result.summary.pathCount} paths, ${result.summary.moveCount} cut moves.`,
    current: 100,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  return result;
}

export async function generateThreeAxisToolpathAsync(viewer: any, params: AnyRecord = {}): Promise<CamToolpathResult> {
  throwIfCamGenerationAborted(params);
  emitCamProgress(params, {
    phase: 'prepare',
    message: 'Preparing CAM operation',
    current: 5,
    total: 100,
    operationId: String(params.id || 'CAM'),
    operationName: String(params.name || 'Simple CNC Raster'),
  });
  await yieldCamProgress(params);
  const setup = makeSetup(viewer, params);
  if (!('triangles' in setup)) return makeEmptyResult(params, setup.warnings, setup.machine);
  emitCamProgress(params, {
    phase: 'heightmap',
    message: 'Preparing pngcam heightmap',
    detail: `${setup.widthPx} x ${setup.heightPx}`,
    current: 12,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  await yieldCamProgress(params);
  const raster = buildPngcamPathsForSetup(setup, params);
  emitCamProgress(params, {
    phase: 'gcode',
    message: 'Posting G-code',
    detail: `${raster.paths.length} paths`,
    current: 88,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  await yieldCamProgress(params);
  const result = buildResultFromSetup(setup, raster, params);
  emitCamProgress(params, {
    phase: 'complete',
    message: 'CAM toolpaths ready',
    detail: `${result.summary.pathCount} paths, ${result.summary.moveCount} cut moves.`,
    current: 100,
    total: 100,
    operationId: setup.operationId,
    operationName: setup.operationName,
  });
  return result;
}

function unionBounds(boundsList: Array<NonNullable<CamToolpathResult['bounds']>>) {
  if (!boundsList.length) return null;
  const min: Point3 = [Infinity, Infinity, Infinity];
  const max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const bounds of boundsList) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return { min: toRoundedPoint(min), max: toRoundedPoint(max) };
}

export function combineCamToolpathResults(results: CamToolpathResult[], options: AnyRecord = {}) {
  const valid = (Array.isArray(results) ? results : []).filter((result) => result && Array.isArray(result.paths));
  const machine = normalizeCamMachineProfile(options.machineProfile || valid[0]?.machine);
  const paths = valid.flatMap((result, operationIndex) => (
    (result.paths || []).map((path) => ({
      ...path,
      id: `O${operationIndex + 1}-${path.id}`,
      sourcePathId: path.id,
      operationId: result.operationId,
      operationName: result.operationName,
    }))
  ));
  const simulation = {
    samples: valid.flatMap((result) => result.simulation?.samples || []),
    motionPolyline: valid.flatMap((result) => result.simulation?.motionPolyline || []),
    motionSegments: valid.flatMap((result) => result.simulation?.motionSegments || []),
    sweptSegments: valid.flatMap((result) => result.simulation?.sweptSegments || []),
    sweptHulls: valid.flatMap((result) => result.simulation?.sweptHulls || []),
  };
  const warnings = valid.flatMap((result) => result.warnings || []);
  const safeZ = Math.max(machine.safeParkZ, ...valid.map((result) => Number(result.safeZ) || 0), machine.safeParkZ);
  const bounds = unionBounds(valid.map((result) => result.bounds).filter(Boolean) as NonNullable<CamToolpathResult['bounds']>[]);
  const targetBounds = unionBounds(valid.map((result) => result.targetBounds).filter(Boolean) as NonNullable<CamToolpathResult['targetBounds']>[]);
  const toolDiameter = valid[0]?.toolDiameter || 3.175;
  const toolLength = valid[0]?.toolLength || 25;
  const cutterProfile = valid[0]?.cutterProfile || makeCutterSnapshot({ toolDiameter, toolLength, toolShape: 'flat' });
  const base: Omit<CamToolpathResult, 'gcode'> = {
    operationId: valid.length === 1 ? valid[0].operationId : 'CAM-PROGRAM',
    operationName: valid.length === 1 ? valid[0].operationName : 'Combined CAM Program',
    units: 'mm',
    generatedAt: new Date().toISOString(),
    bounds,
    targetBounds,
    safeZ,
    machine,
    toolShape: cutterProfile.kind,
    cutterProfile,
    toolDiameter,
    toolLength,
    spindleRPM: valid[0]?.spindleRPM || 12000,
    paths,
    simulation,
    summary: {
      targetCount: valid.reduce((sum, result) => sum + (result.summary?.targetCount || 0), 0),
      triangleCount: valid.reduce((sum, result) => sum + (result.summary?.triangleCount || 0), 0),
      levelCount: valid.reduce((sum, result) => sum + (result.summary?.levelCount || 0), 0),
      pathCount: paths.length,
      moveCount: paths.reduce((sum, path) => sum + Math.max(0, path.points.length - 1), 0),
      motionSegmentCount: simulation.motionSegments.length,
      sweptSegmentCount: simulation.sweptSegments.length,
      sweptHullCount: simulation.sweptHulls.length,
      estimatedCutLength: roundCoord(valid.reduce((sum, result) => sum + (result.summary?.estimatedCutLength || 0), 0)),
      estimatedRapidLength: roundCoord(valid.reduce((sum, result) => sum + (result.summary?.estimatedRapidLength || 0), 0)),
      warningCount: warnings.length,
      heightmapSampleCount: valid.reduce((sum, result) => sum + (result.summary?.heightmapSampleCount || 0), 0),
      rasterLineCount: valid.reduce((sum, result) => sum + (result.summary?.rasterLineCount || 0), 0),
    },
    warnings,
  };
  const gcode = valid.length > 1
    ? generateGcodeForCombinedToolpaths(valid, base, options)
    : valid[0]?.gcode || generateGcodeForToolpath(base, options);
  return { ...base, gcode };
}

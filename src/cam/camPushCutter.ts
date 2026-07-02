import {
  createCamCutterProfile,
  type CamCutterProfile,
  type CamCutterProfileInput,
} from './CamCutterProfile.js';
import {
  buildCamTriangleSpatialIndex,
  buildCamTriangleSpatialIndexWithFallback,
  normalizeCamTriangles,
  queryCamTriangleAabbBruteForce,
  type CamBounds3,
  type CamPoint3,
  type CamProjectionMode,
  type CamTriangleIndexFallbackOptions,
  type CamTriangleInput,
} from './camTriangleSpatialIndex.js';

export type CamFiberDirection = 'x' | 'y';

export type CamFiberContactType = 'vertex' | 'facet' | 'edge' | 'shaft' | 'tool-profile' | 'numeric-fallback' | 'unknown';

export type CamFiberInterval = {
  lowerT: number;
  upperT: number;
  lowerContact?: CamFiberContactType;
  upperContact?: CamFiberContactType;
  triangleIds?: number[];
};

export type CamFiber = {
  id: string;
  direction: CamFiberDirection;
  start: CamPoint3;
  end: CamPoint3;
  intervals?: CamFiberInterval[];
};

export type CamPushCutterProgress = {
  phase: string;
  message: string;
  detail?: string;
  current: number;
  total: number;
};

export type CamFiberPushInput = {
  fiber: CamFiber;
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  tolerance?: number;
};

export type CamFiberPushOutput = {
  fiber: CamFiber;
  candidateCount: number;
  intervalCount: number;
  warnings: string[];
};

export type CamBatchPushInput = {
  fibers: CamFiber[];
  direction: CamFiberDirection;
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  indexOptions?: CamTriangleIndexFallbackOptions;
  tolerance?: number;
  chunkSize?: number;
  onProgress?: (progress: CamPushCutterProgress) => void;
  progressYield?: () => Promise<void> | void;
};

export type CamBatchPushOutput = {
  fibers: CamFiber[];
  summary: {
    fiberCount: number;
    intervalCount: number;
    candidateCount: number;
    warningCount: number;
  };
  warnings: string[];
};

type NormalizedTriangle = ReturnType<typeof normalizeCamTriangles>[number];

const EPS = 1e-7;

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeCutter(cutter: CamCutterProfile | CamCutterProfileInput) {
  return cutter && typeof (cutter as any).radiusAtHeight === 'function'
    ? cutter as CamCutterProfile
    : createCamCutterProfile(cutter as CamCutterProfileInput);
}

function clonePoint(point: CamPoint3): CamPoint3 {
  return [
    finiteNumber(point?.[0], 0),
    finiteNumber(point?.[1], 0),
    finiteNumber(point?.[2], 0),
  ];
}

function isFinitePoint(point: any) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function cloneFiber(fiber: CamFiber, intervals: CamFiberInterval[] = []) {
  return {
    ...fiber,
    start: clonePoint(fiber.start),
    end: clonePoint(fiber.end),
    intervals: intervals.map((interval) => ({
      ...interval,
      triangleIds: interval.triangleIds ? interval.triangleIds.slice() : undefined,
    })),
  };
}

function triangleMap(triangles: NormalizedTriangle[]) {
  return new Map(triangles.map((triangle) => [triangle.id, triangle]));
}

function queryBoundsForFiber(fiber: CamFiber, cutter: CamCutterProfile): CamBounds3 {
  const radius = Math.max(EPS, cutter.radius);
  const verticalEnvelope = Math.max(cutter.cuttingLength + cutter.shaftLength, radius);
  const min: CamPoint3 = [
    Math.min(fiber.start[0], fiber.end[0]) - radius,
    Math.min(fiber.start[1], fiber.end[1]) - radius,
    Math.min(fiber.start[2], fiber.end[2]) - verticalEnvelope,
  ];
  const max: CamPoint3 = [
    Math.max(fiber.start[0], fiber.end[0]) + radius,
    Math.max(fiber.start[1], fiber.end[1]) + radius,
    Math.max(fiber.start[2], fiber.end[2]) + verticalEnvelope,
  ];
  return { min, max };
}

function projectionModeForDirection(direction: CamFiberDirection): CamProjectionMode {
  return direction === 'x' ? 'yz' : 'xz';
}

function coordinateAxis(direction: CamFiberDirection) {
  return direction === 'x' ? 0 : 1;
}

function fixedAxis(direction: CamFiberDirection) {
  return direction === 'x' ? 1 : 0;
}

function fiberCoordinateToT(fiber: CamFiber, coordinate: number) {
  const axis = coordinateAxis(fiber.direction);
  const span = fiber.end[axis] - fiber.start[axis];
  if (Math.abs(span) <= EPS) return null;
  return (coordinate - fiber.start[axis]) / span;
}

function addInterval(
  intervals: CamFiberInterval[],
  fiber: CamFiber,
  lowerCoordinate: number,
  upperCoordinate: number,
  contact: CamFiberContactType,
  triangleId?: number,
) {
  const t0 = fiberCoordinateToT(fiber, lowerCoordinate);
  const t1 = fiberCoordinateToT(fiber, upperCoordinate);
  if (t0 == null || t1 == null) return;
  const lowerT = Math.max(0, Math.min(1, Math.min(t0, t1)));
  const upperT = Math.max(0, Math.min(1, Math.max(t0, t1)));
  if (upperT <= lowerT + EPS) return;
  intervals.push({
    lowerT,
    upperT,
    lowerContact: contact,
    upperContact: contact,
    triangleIds: triangleId == null ? [] : [triangleId],
  });
}

function mergeIntervals(intervals: CamFiberInterval[], tolerance: number) {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.lowerT) && Number.isFinite(interval.upperT) && interval.upperT > interval.lowerT + tolerance)
    .sort((a, b) => {
      if (Math.abs(a.lowerT - b.lowerT) > tolerance) return a.lowerT - b.lowerT;
      if (Math.abs(a.upperT - b.upperT) > tolerance) return a.upperT - b.upperT;
      return String(a.lowerContact || '').localeCompare(String(b.lowerContact || ''));
    });
  const out: CamFiberInterval[] = [];
  for (const interval of sorted) {
    const previous = out[out.length - 1];
    if (!previous || interval.lowerT > previous.upperT + tolerance) {
      out.push({ ...interval, triangleIds: interval.triangleIds ? interval.triangleIds.slice() : [] });
      continue;
    }
    previous.upperT = Math.max(previous.upperT, interval.upperT);
    previous.upperContact = interval.upperContact || previous.upperContact;
    const ids = new Set(previous.triangleIds || []);
    for (const id of interval.triangleIds || []) ids.add(id);
    previous.triangleIds = Array.from(ids).sort((a, b) => a - b);
  }
  return out;
}

function uniquePoints(points: CamPoint3[], tolerance: number) {
  const out: CamPoint3[] = [];
  for (const point of points) {
    if (out.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2]) <= tolerance)) continue;
    out.push(point);
  }
  return out;
}

function triangleCrossSectionSegment(triangle: NormalizedTriangle, z: number, tolerance: number) {
  const points: CamPoint3[] = [];
  const vertices = [triangle.a, triangle.b, triangle.c];
  for (let index = 0; index < 3; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % 3];
    const da = a[2] - z;
    const db = b[2] - z;
    if (Math.abs(da) <= tolerance) points.push(clonePoint(a));
    if (da * db < -tolerance * tolerance) {
      const t = (z - a[2]) / (b[2] - a[2]);
      points.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        z,
      ]);
    }
    if (Math.abs(db) <= tolerance) points.push(clonePoint(b));
  }
  const unique = uniquePoints(points, tolerance);
  if (unique.length < 2) return null;
  return [unique[0], unique[1]] as [CamPoint3, CamPoint3];
}

function isHorizontalTriangle(triangle: NormalizedTriangle, tolerance: number) {
  const z = triangle.a[2];
  return Math.abs(triangle.b[2] - z) <= tolerance && Math.abs(triangle.c[2] - z) <= tolerance;
}

function segmentFiberIntersectionCoordinate(
  fiber: CamFiber,
  segment: [CamPoint3, CamPoint3],
  tolerance: number,
) {
  const axis = coordinateAxis(fiber.direction);
  const fixed = fixedAxis(fiber.direction);
  const fixedValue = fiber.start[fixed];
  const a = segment[0];
  const b = segment[1];
  const da = a[fixed] - fixedValue;
  const db = b[fixed] - fixedValue;
  if (Math.abs(da) <= tolerance && Math.abs(db) <= tolerance) {
    return [a[axis], b[axis]];
  }
  if (da * db > tolerance * tolerance) return [];
  const denom = b[fixed] - a[fixed];
  if (Math.abs(denom) <= tolerance) return [];
  const t = (fixedValue - a[fixed]) / denom;
  if (t < -tolerance || t > 1 + tolerance) return [];
  return [a[axis] + (b[axis] - a[axis]) * Math.max(0, Math.min(1, t))];
}

function addCrossSectionIntervals(
  intervals: CamFiberInterval[],
  fiber: CamFiber,
  triangleIntersections: Array<{ coordinate: number; triangleId: number }>,
  cutterRadius: number,
  tolerance: number,
) {
  const sorted = triangleIntersections
    .filter((item) => Number.isFinite(item.coordinate))
    .sort((a, b) => a.coordinate - b.coordinate || a.triangleId - b.triangleId);
  const unique: Array<{ coordinate: number; triangleIds: number[] }> = [];
  for (const item of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.coordinate - item.coordinate) <= tolerance) {
      if (!previous.triangleIds.includes(item.triangleId)) previous.triangleIds.push(item.triangleId);
    } else {
      unique.push({ coordinate: item.coordinate, triangleIds: [item.triangleId] });
    }
  }
  for (let index = 0; index + 1 < unique.length; index += 2) {
    const lower = unique[index].coordinate - cutterRadius;
    const upper = unique[index + 1].coordinate + cutterRadius;
    const t0 = fiberCoordinateToT(fiber, lower);
    const t1 = fiberCoordinateToT(fiber, upper);
    if (t0 == null || t1 == null) continue;
    const lowerT = Math.max(0, Math.min(1, Math.min(t0, t1)));
    const upperT = Math.max(0, Math.min(1, Math.max(t0, t1)));
    if (upperT <= lowerT + tolerance) continue;
    intervals.push({
      lowerT,
      upperT,
      lowerContact: 'facet',
      upperContact: 'facet',
      triangleIds: [...unique[index].triangleIds, ...unique[index + 1].triangleIds].sort((a, b) => a - b),
    });
  }
}

function addVertexIntervals(intervals: CamFiberInterval[], fiber: CamFiber, triangle: NormalizedTriangle, cutter: CamCutterProfile) {
  const axis = coordinateAxis(fiber.direction);
  const fixed = fixedAxis(fiber.direction);
  const z = fiber.start[2];
  const fixedValue = fiber.start[fixed];
  for (const vertex of [triangle.a, triangle.b, triangle.c]) {
    const h = vertex[2] - z;
    if (h < -EPS || h > cutter.cuttingLength + cutter.shaftLength + EPS) continue;
    const radius = cutter.maxRadiusAtHeight(h);
    if (radius == null || radius <= EPS) continue;
    const perpendicular = Math.abs(vertex[fixed] - fixedValue);
    if (perpendicular > radius + EPS) continue;
    const chord = Math.sqrt(Math.max(0, radius * radius - perpendicular * perpendicular));
    addInterval(intervals, fiber, vertex[axis] - chord, vertex[axis] + chord, h > cutter.cuttingLength + EPS ? 'shaft' : 'vertex', triangle.id);
  }
}

function addHorizontalEdgeIntervals(intervals: CamFiberInterval[], fiber: CamFiber, triangle: NormalizedTriangle, cutter: CamCutterProfile, tolerance: number) {
  const axis = coordinateAxis(fiber.direction);
  const fixed = fixedAxis(fiber.direction);
  const z = fiber.start[2];
  const fixedValue = fiber.start[fixed];
  const edges: Array<[CamPoint3, CamPoint3]> = [
    [triangle.a, triangle.b],
    [triangle.b, triangle.c],
    [triangle.c, triangle.a],
  ];
  for (const [a, b] of edges) {
    if (Math.abs(a[2] - b[2]) > tolerance) continue;
    const h = ((a[2] + b[2]) * 0.5) - z;
    if (h < -EPS || h > cutter.cuttingLength + cutter.shaftLength + EPS) continue;
    const radius = cutter.maxRadiusAtHeight(h);
    if (radius == null || radius <= EPS) continue;
    const da = a[fixed] - fixedValue;
    const db = b[fixed] - fixedValue;
    const minFixed = Math.min(da, db);
    const maxFixed = Math.max(da, db);
    const perpendicular = minFixed <= 0 && maxFixed >= 0
      ? 0
      : Math.min(Math.abs(minFixed), Math.abs(maxFixed));
    if (perpendicular > radius + EPS) continue;
    const chord = Math.sqrt(Math.max(0, radius * radius - perpendicular * perpendicular));
    const contact: CamFiberContactType = h > cutter.cuttingLength + EPS ? 'shaft' : 'edge';
    addInterval(
      intervals,
      fiber,
      Math.min(a[axis], b[axis]) - chord,
      Math.max(a[axis], b[axis]) + chord,
      contact,
      triangle.id,
    );
  }
}

function pushFiberPrepared(
  fiberInput: CamFiber,
  cutter: CamCutterProfile,
  triangles: NormalizedTriangle[],
  trianglesById: Map<number, NormalizedTriangle>,
  index: ReturnType<typeof buildCamTriangleSpatialIndex> | null,
  tolerance: number,
) {
  const warnings: string[] = [];
  if (!isFinitePoint(fiberInput?.start) || !isFinitePoint(fiberInput?.end)) {
    warnings.push(`Fiber ${fiberInput?.id || ''} must have finite start and end coordinates.`);
    return { fiber: cloneFiber(fiberInput, []), candidateCount: 0, intervalCount: 0, warnings };
  }
  const fiber = cloneFiber(fiberInput);
  if (fiber.direction !== 'x' && fiber.direction !== 'y') {
    warnings.push(`Fiber ${fiber.id || ''} has invalid direction.`);
    return { fiber: cloneFiber(fiber, []), candidateCount: 0, intervalCount: 0, warnings };
  }
  if (Math.abs(fiber.start[2] - fiber.end[2]) > tolerance) {
    warnings.push(`Fiber ${fiber.id || ''} must have constant Z.`);
    return { fiber: cloneFiber(fiber, []), candidateCount: 0, intervalCount: 0, warnings };
  }
  const cutterErrors = cutter.validate();
  if (cutterErrors.length) {
    return { fiber: cloneFiber(fiber, []), candidateCount: 0, intervalCount: 0, warnings: cutterErrors };
  }

  const queryBounds = queryBoundsForFiber(fiber, cutter);
  const mode = projectionModeForDirection(fiber.direction);
  const candidateIds = index
    ? index.queryAabb(queryBounds, mode)
    : queryCamTriangleAabbBruteForce(triangles, queryBounds, mode);
  const intervals: CamFiberInterval[] = [];
  const crossSectionIntersections: Array<{ coordinate: number; triangleId: number }> = [];
  for (const id of candidateIds) {
    const triangle = trianglesById.get(id);
    if (!triangle) continue;
    if (isHorizontalTriangle(triangle, tolerance)) continue;
    const segment = triangleCrossSectionSegment(triangle, fiber.start[2], tolerance);
    if (segment) {
      for (const coordinate of segmentFiberIntersectionCoordinate(fiber, segment, tolerance)) {
        crossSectionIntersections.push({ coordinate, triangleId: triangle.id });
      }
    }
    addHorizontalEdgeIntervals(intervals, fiber, triangle, cutter, tolerance);
    addVertexIntervals(intervals, fiber, triangle, cutter);
  }
  addCrossSectionIntervals(intervals, fiber, crossSectionIntersections, cutter.radius, tolerance);
  const merged = mergeIntervals(intervals, tolerance);
  return {
    fiber: cloneFiber(fiber, merged),
    candidateCount: candidateIds.length,
    intervalCount: merged.length,
    warnings,
  };
}

export function pushCutterFiber(input: CamFiberPushInput): CamFiberPushOutput {
  const triangles = normalizeCamTriangles(input.triangles || []);
  const cutter = normalizeCutter(input.cutter);
  return pushFiberPrepared(
    input.fiber,
    cutter,
    triangles,
    triangleMap(triangles),
    input.index || null,
    Math.max(EPS, finiteNumber(input.tolerance, 1e-6)),
  );
}

function emitProgress(input: CamBatchPushInput, progress: CamPushCutterProgress) {
  if (typeof input.onProgress !== 'function') return;
  input.onProgress({ total: 100, ...progress });
}

async function yieldProgress(input: CamBatchPushInput) {
  if (typeof input.progressYield === 'function') await input.progressYield();
}

export async function pushCutterBatch(input: CamBatchPushInput): Promise<CamBatchPushOutput> {
  const sourceFibers = Array.isArray(input.fibers) ? input.fibers : [];
  const cutter = normalizeCutter(input.cutter);
  const warnings = cutter.validate().slice();
  const batchDirection = input.direction;
  if (batchDirection !== 'x' && batchDirection !== 'y') {
    throw new Error('Batch push-cutter direction must be "x" or "y".');
  }
  if (!sourceFibers.length) {
    return {
      fibers: [],
      summary: { fiberCount: 0, intervalCount: 0, candidateCount: 0, warningCount: warnings.length },
      warnings,
    };
  }
  if (warnings.length) {
    return {
      fibers: [],
      summary: { fiberCount: sourceFibers.length, intervalCount: 0, candidateCount: 0, warningCount: warnings.length },
      warnings,
    };
  }
  const mismatchedIndex = sourceFibers.findIndex((fiber) => fiber?.direction !== batchDirection);
  if (mismatchedIndex >= 0) {
    const fiber = sourceFibers[mismatchedIndex];
    throw new Error(`Batch push-cutter fiber ${fiber?.id || mismatchedIndex} direction must match batch direction ${batchDirection}.`);
  }

  emitProgress(input, {
    phase: 'batch-push-prepare',
    message: 'Preparing push-cutter fibers',
    detail: `${sourceFibers.length} ${batchDirection.toUpperCase()} fiber${sourceFibers.length === 1 ? '' : 's'}`,
    current: 2,
    total: 100,
  });
  await yieldProgress(input);

  const triangles = normalizeCamTriangles(input.triangles || []);
  const trianglesById = triangleMap(triangles);
  emitProgress(input, {
    phase: 'batch-push-index',
    message: 'Building push-cutter triangle index',
    detail: `${batchDirection.toUpperCase()} fibers, ${triangles.length} triangle${triangles.length === 1 ? '' : 's'}`,
    current: 8,
    total: 100,
  });
  emitProgress(input, {
    phase: `batch-push-index-${batchDirection}`,
    message: 'Building push-cutter triangle index',
    detail: `${triangles.length} triangle${triangles.length === 1 ? '' : 's'}`,
    current: 8,
    total: 100,
  });
  emitProgress(input, {
    phase: `push-index-${batchDirection}`,
    message: 'Building push-cutter triangle index',
    detail: `${triangles.length} triangle${triangles.length === 1 ? '' : 's'}`,
    current: 8,
    total: 100,
  });
  await yieldProgress(input);
  const builtIndex = input.index
    ? { index: input.index, warnings: [] }
    : buildCamTriangleSpatialIndexWithFallback(triangles, input.indexOptions);
  warnings.push(...builtIndex.warnings);
  const index = builtIndex.index;
  const chunkSize = Math.max(1, Math.round(finiteNumber(input.chunkSize, 128)));
  const tolerance = Math.max(EPS, finiteNumber(input.tolerance, 1e-6));
  const fibers: CamFiber[] = [];
  let intervalCount = 0;
  let candidateCount = 0;

  for (let start = 0; start < sourceFibers.length; start += chunkSize) {
    const end = Math.min(sourceFibers.length, start + chunkSize);
    for (let indexInChunk = start; indexInChunk < end; indexInChunk += 1) {
      const source = sourceFibers[indexInChunk];
      const result = pushFiberPrepared(source, cutter, triangles, trianglesById, index, tolerance);
      fibers[indexInChunk] = result.fiber;
      intervalCount += result.intervalCount;
      candidateCount += result.candidateCount;
      warnings.push(...result.warnings.map((warning) => `Fiber ${source.id || indexInChunk}: ${warning}`));
    }
    emitProgress(input, {
      phase: 'batch-push-fibers',
      message: 'Processing push-cutter fibers',
      detail: `${batchDirection.toUpperCase()} ${end} of ${sourceFibers.length}`,
      current: 10 + (end / sourceFibers.length) * 84,
      total: 100,
    });
    emitProgress(input, {
      phase: `batch-push-fibers-${batchDirection}`,
      message: 'Processing push-cutter fibers',
      detail: `${end} of ${sourceFibers.length}`,
      current: 10 + (end / sourceFibers.length) * 84,
      total: 100,
    });
    emitProgress(input, {
      phase: `push-fibers-${batchDirection}`,
      message: 'Processing push-cutter fibers',
      detail: `${end} of ${sourceFibers.length}`,
      current: 10 + (end / sourceFibers.length) * 84,
      total: 100,
    });
    await yieldProgress(input);
  }

  emitProgress(input, {
    phase: 'batch-push-complete',
    message: 'Push-cutter batch complete',
    detail: `${intervalCount} blocked interval${intervalCount === 1 ? '' : 's'}`,
    current: 100,
    total: 100,
  });
  emitProgress(input, {
    phase: 'push-complete',
    message: 'Push-cutter batch complete',
    detail: `${intervalCount} blocked interval${intervalCount === 1 ? '' : 's'}`,
    current: 100,
    total: 100,
  });

  return {
    fibers,
    summary: {
      fiberCount: fibers.length,
      intervalCount,
      candidateCount,
      warningCount: warnings.length,
    },
    warnings,
  };
}

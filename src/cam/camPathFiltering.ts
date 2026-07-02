import type { CamToolpathPath } from './camToolpath.js';

export type CamPoint3 = [number, number, number];
export type CamPathSegmentKind = 'rapid' | 'link' | 'cut';

export type CamPathFilterOptions = {
  tolerance?: number;
  enableLineFilter?: boolean;
  preserveIndices?: Set<number> | number[];
  preserveSimulationSamples?: boolean;
  closed?: boolean;
  segmentKinds?: Array<CamPathSegmentKind | string>;
};

export type CamPathFilterResult = {
  points: CamPoint3[];
  sourceIndices: number[];
  segmentKinds?: CamPathSegmentKind[];
  removedCount: number;
  invalidPointCount: number;
  warnings: string[];
};

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function pointIsFinite(point: CamPoint3 | null | undefined) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function clonePoint(point: CamPoint3): CamPoint3 {
  return [
    Number(point[0]),
    Number(point[1]),
    Number(point[2]),
  ];
}

function pointsEqual(a: CamPoint3 | null | undefined, b: CamPoint3 | null | undefined, tolerance = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(Number(a[0]) - Number(b[0])) <= tolerance
    && Math.abs(Number(a[1]) - Number(b[1])) <= tolerance
    && Math.abs(Number(a[2]) - Number(b[2])) <= tolerance;
}

function distancePointToSegment3(point: CamPoint3, a: CamPoint3, b: CamPoint3) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const apz = point[2] - a[2];
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq <= 1e-24) return Math.hypot(apx, apy, apz);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq));
  return Math.hypot(
    apx - abx * t,
    apy - aby * t,
    apz - abz * t,
  );
}

function normalizePreserveIndices(value: CamPathFilterOptions['preserveIndices'], maxIndex: number) {
  const out = new Set<number>();
  const list = value instanceof Set ? Array.from(value) : (Array.isArray(value) ? value : []);
  for (const raw of list) {
    const index = Math.round(Number(raw));
    if (Number.isInteger(index) && index >= 0 && index <= maxIndex) out.add(index);
  }
  return out;
}

function normalizeSegmentKind(value: any): CamPathSegmentKind {
  if (value === 'rapid') return 'rapid';
  if (value === 'link') return 'link';
  return 'cut';
}

function normalizeSegmentKinds(value: any, pointCount: number) {
  if (!Array.isArray(value)) return null;
  const expected = Math.max(0, pointCount - 1);
  if (value.length !== expected) return null;
  return value.map((kind) => normalizeSegmentKind(kind));
}

function preserveMoveKindBoundaries(preserve: Set<number>, segmentKinds: CamPathSegmentKind[] | null) {
  if (!segmentKinds) return;
  for (let index = 1; index < segmentKinds.length; index += 1) {
    if (segmentKinds[index] !== segmentKinds[index - 1]) preserve.add(index);
  }
}

function hasPreservedInterior(preserve: Set<number>, start: number, end: number) {
  for (const index of preserve) {
    if (index > start && index < end) return true;
  }
  return false;
}

function runWithinTolerance(points: CamPoint3[], anchor: number, candidate: number, tolerance: number) {
  const a = points[anchor];
  const b = points[candidate];
  for (let index = anchor + 1; index < candidate; index += 1) {
    if (distancePointToSegment3(points[index], a, b) > tolerance) return false;
  }
  return true;
}

function kindForSourceSpan(segmentKinds: CamPathSegmentKind[], startIndex: number, endIndex: number): CamPathSegmentKind {
  const low = Math.max(0, Math.min(startIndex, endIndex));
  const high = Math.max(startIndex, endIndex);
  const first = normalizeSegmentKind(segmentKinds[Math.min(low, segmentKinds.length - 1)]);
  for (let index = low + 1; index < high && index < segmentKinds.length; index += 1) {
    if (normalizeSegmentKind(segmentKinds[index]) !== first) return 'cut';
  }
  return first;
}

function filteredSegmentKinds(segmentKinds: CamPathSegmentKind[] | null, sourceIndices: number[]) {
  if (!segmentKinds) return undefined;
  const out: CamPathSegmentKind[] = [];
  for (let index = 1; index < sourceIndices.length; index += 1) {
    out.push(kindForSourceSpan(segmentKinds, sourceIndices[index - 1], sourceIndices[index]));
  }
  return out;
}

export function filterCamPathPoints(
  rawPoints: CamPoint3[],
  options: CamPathFilterOptions = {},
): CamPathFilterResult {
  const source = Array.isArray(rawPoints) ? rawPoints : [];
  const invalidPointCount = source.filter((point) => !pointIsFinite(point as CamPoint3)).length;
  if (invalidPointCount > 0) {
    return {
      points: [],
      sourceIndices: [],
      removedCount: source.length,
      invalidPointCount,
      warnings: [`CAM line filter rejected ${invalidPointCount} non-finite cutter-location point${invalidPointCount === 1 ? '' : 's'}.`],
    };
  }
  const fallbackPoints = source.map((point) => clonePoint(point as CamPoint3));
  const sourceSegmentKinds = normalizeSegmentKinds(options.segmentKinds, source.length);
  const tolerance = Math.max(0, finiteNumber(options.tolerance, 0));
  if (options.enableLineFilter === false || source.length < 3 || tolerance <= 0) {
    const sourceIndices = source.map((_, index) => index);
    return {
      points: fallbackPoints,
      sourceIndices,
      segmentKinds: filteredSegmentKinds(sourceSegmentKinds, sourceIndices),
      removedCount: 0,
      invalidPointCount: 0,
      warnings: [],
    };
  }

  const inputClosed = options.closed === true || pointsEqual(source[0] as CamPoint3, source[source.length - 1] as CamPoint3);
  const hasDuplicateClosure = inputClosed && source.length > 1 && pointsEqual(source[0] as CamPoint3, source[source.length - 1] as CamPoint3);
  const workingSource = hasDuplicateClosure ? source.slice(0, -1) : source;
  const points = workingSource.map((point) => clonePoint(point as CamPoint3));
  if (points.length < 3) {
    const out = points.slice();
    const indices = points.map((_, index) => index);
    if (hasDuplicateClosure) {
      out.push(clonePoint(points[0]));
      indices.push(source.length - 1);
    }
    return {
      points: out,
      sourceIndices: indices,
      segmentKinds: filteredSegmentKinds(sourceSegmentKinds, indices),
      removedCount: source.length - out.length,
      invalidPointCount: 0,
      warnings: [],
    };
  }

  const preserve = normalizePreserveIndices(options.preserveIndices, source.length - 1);
  preserve.add(0);
  preserve.add(points.length - 1);
  if (hasDuplicateClosure && preserve.has(source.length - 1)) preserve.add(0);
  preserveMoveKindBoundaries(preserve, sourceSegmentKinds);

  const keptIndices: number[] = [0];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let best = anchor + 1;
    for (let candidate = anchor + 2; candidate < points.length; candidate += 1) {
      if (hasPreservedInterior(preserve, anchor, candidate)) break;
      if (!runWithinTolerance(points, anchor, candidate, tolerance)) break;
      best = candidate;
    }
    keptIndices.push(best);
    anchor = best;
  }

  const filteredPoints = keptIndices.map((index) => clonePoint(points[index]));
  const sourceIndices = keptIndices.slice();
  if (hasDuplicateClosure) {
    filteredPoints.push(clonePoint(filteredPoints[0]));
    sourceIndices.push(source.length - 1);
  }

  return {
    points: filteredPoints,
    sourceIndices,
    segmentKinds: filteredSegmentKinds(sourceSegmentKinds, sourceIndices),
    removedCount: Math.max(0, source.length - filteredPoints.length),
    invalidPointCount: 0,
    warnings: [],
  };
}

export function filterCamToolpathPaths(
  rawPaths: CamToolpathPath[],
  options: CamPathFilterOptions = {},
) {
  const paths = Array.isArray(rawPaths) ? rawPaths : [];
  let removedCount = 0;
  const warnings: string[] = [];
  const filteredPaths: CamToolpathPath[] = [];
  for (const path of paths) {
    const result = filterCamPathPoints(path.points || [], {
      ...options,
      closed: options.closed ?? (path as any).closed ?? pointsEqual(path.points?.[0], path.points?.[path.points.length - 1]),
      segmentKinds: (path as any).segmentKinds,
    });
    removedCount += result.removedCount;
    if (result.invalidPointCount > 0) {
      const label = String((path as any)?.id || 'unnamed path');
      warnings.push(`CAM line filter rejected path ${label}: ${result.invalidPointCount} non-finite cutter-location point${result.invalidPointCount === 1 ? '' : 's'}.`);
      continue;
    }
    const filteredPath = {
      ...path,
      points: result.points,
    } as CamToolpathPath;
    if (options.preserveSimulationSamples !== false && result.removedCount > 0) {
      filteredPath.simulationSamples = (path.points || []).map((point) => clonePoint(point as CamPoint3));
    } else {
      delete filteredPath.simulationSamples;
    }
    if (result.segmentKinds) {
      filteredPath.segmentKinds = result.segmentKinds;
    } else {
      delete filteredPath.segmentKinds;
    }
    filteredPaths.push(filteredPath);
  }
  return {
    paths: filteredPaths,
    removedCount,
    warnings,
  };
}

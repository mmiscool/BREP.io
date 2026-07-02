import {
  createCamCutterProfile,
  type CamCutterProfile,
  type CamCutterProfileInput,
} from './CamCutterProfile.js';
import {
  createDropCutterProjector,
  dropCutterBatch,
  type CamCLPoint,
  type CamDropCutterProgress,
  type CamDropCutterTolerance,
} from './camDropCutter.js';
import {
  createCamPathSpan,
  sampleCamPathSpans,
  type CamPathSpan,
  type CamPoint3,
  type SerializedCamPathSpan,
} from './camPathSpans.js';
import { buildCamTriangleSpatialIndex, type CamTriangleIndexFallbackOptions, type CamTriangleInput } from './camTriangleSpatialIndex.js';

export type CamPathDropSourcePath = {
  id: string;
  spans: SerializedCamPathSpan[];
};

export type CamDroppedPath = {
  id: string;
  points: CamCLPoint[];
  sourceSpanIds: string[];
};

export type CamUniformPathDropInput = {
  paths: CamPathDropSourcePath[];
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  sampleSpacing: number;
  floorZ: number;
  preserveSpanBoundaries?: boolean;
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  indexOptions?: CamTriangleIndexFallbackOptions;
  tolerance?: CamDropCutterTolerance;
  chunkSize?: number;
  onProgress?: (progress: CamDropCutterProgress) => void;
  progressYield?: () => Promise<void> | void;
};

export type CamAdaptivePathDropInput = CamUniformPathDropInput & {
  minSampleSpacing?: number;
  flatnessCosLimit?: number;
  maxDepth?: number;
};

export type CamPathDropOutput = {
  paths: CamDroppedPath[];
  warnings: string[];
  summary: {
    sourcePathCount: number;
    spanCount: number;
    sampleCount: number;
    candidateCount: number;
    contactCount: number;
    warningCount: number;
    acceptedIntervalCount?: number;
    subdivisionCount?: number;
    maxObservedDepth?: number;
  };
};

type SamplePath = {
  id: string;
  points: CamCLPoint[];
  sourceSpanIds: string[];
};

type PreparedSourcePath = {
  path: CamPathDropSourcePath;
  spans: CamPathSpan[];
  spanCount: number;
};

const EPS = 1e-7;

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function positiveNumber(value: any, fallback: number) {
  return Math.max(EPS, finiteNumber(value, fallback));
}

function positiveNumberWarning(value: any, label: string) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0
    ? null
    : `${label} must be a positive finite number.`;
}

function positiveInteger(value: any, fallback: number) {
  return Math.max(1, Math.round(finiteNumber(value, fallback)));
}

function emitProgress(input: { onProgress?: (progress: CamDropCutterProgress) => void }, progress: CamDropCutterProgress) {
  if (typeof input.onProgress !== 'function') return;
  input.onProgress({ total: 100, ...progress });
}

function emitProgressWithAlias(
  input: { onProgress?: (progress: CamDropCutterProgress) => void },
  progress: CamDropCutterProgress,
  aliasPhase: string | null,
) {
  emitProgress(input, progress);
  if (!aliasPhase || aliasPhase === progress.phase) return;
  emitProgress(input, { ...progress, phase: aliasPhase });
}

function emitMappedBatchProgress(
  input: { onProgress?: (progress: CamDropCutterProgress) => void },
  parentPhase: string,
  startCurrent: number,
  endCurrent: number,
) {
  return (progress: CamDropCutterProgress) => {
    const rawCurrent = Math.max(0, Math.min(Number(progress.total) || 100, Number(progress.current) || 0));
    const rawTotal = Math.max(1, Number(progress.total) || 100);
    const range = endCurrent - startCurrent;
    const phaseSuffix = String(progress.phase || '').replace(/^batch-drop-/, '') || 'progress';
    emitProgress(input, {
      ...progress,
      phase: `${parentPhase}-${phaseSuffix}`,
      current: startCurrent + (rawCurrent / rawTotal) * range,
      total: 100,
    });
  };
}

async function yieldProgress(input: { progressYield?: () => Promise<void> | void }) {
  if (typeof input.progressYield === 'function') await input.progressYield();
}

function normalizeCutter(cutter: CamCutterProfile | CamCutterProfileInput) {
  return cutter && typeof (cutter as any).heightAtRadius === 'function'
    ? cutter as CamCutterProfile
    : createCamCutterProfile(cutter as CamCutterProfileInput);
}

function normalizeSourcePaths(paths: CamPathDropSourcePath[] | null | undefined) {
  return Array.isArray(paths) ? paths : [];
}

function sourcePathSpanCount(path: CamPathDropSourcePath) {
  return Array.isArray(path?.spans) ? path.spans.length : 0;
}

function deserializePathSpans(path: CamPathDropSourcePath, warnings: string[]) {
  const spans: CamPathSpan[] = [];
  const rawSpans = Array.isArray(path.spans) ? path.spans : [];
  for (let index = 0; index < rawSpans.length; index += 1) {
    const rawSpan = rawSpans[index] as any;
    const rawSpanId = rawSpan && typeof rawSpan === 'object' && rawSpan.id != null && rawSpan.id !== ''
      ? ` (${String(rawSpan.id)})`
      : '';
    try {
      spans.push(createCamPathSpan(rawSpan, `${path.id}:span-${index}`));
    } catch (error) {
      warnings.push(`Path ${path.id} span ${index}${rawSpanId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return spans;
}

function warnDiscretizedArcSpans(path: CamPathDropSourcePath, spans: CamPathSpan[], warnings: string[]) {
  const arcCount = spans.filter((span) => span?.kind === 'arc').length;
  if (!arcCount) return;
  warnings.push(
    `Path ${path.id} contains ${arcCount} arc span${arcCount === 1 ? '' : 's'}; current CAM output discretizes arcs into linear G1 segments because arc-preserving G2/G3 output is not available yet.`,
  );
}

function prepareSourcePathSpans(sourcePaths: CamPathDropSourcePath[], warnings: string[]) {
  let spanCount = 0;
  let validSpanCount = 0;
  const prepared: PreparedSourcePath[] = [];
  for (const path of sourcePaths) {
    const spans = deserializePathSpans(path, warnings);
    warnDiscretizedArcSpans(path, spans, warnings);
    const attemptedSpanCount = sourcePathSpanCount(path);
    spanCount += attemptedSpanCount;
    validSpanCount += spans.length;
    prepared.push({ path, spans, spanCount: attemptedSpanCount });
  }
  return { prepared, spanCount, validSpanCount };
}

function point3ToCLPoint(point: CamPoint3, floorZ: number): CamCLPoint {
  return {
    x: point[0],
    y: point[1],
    z: Number.isFinite(point[2]) ? point[2] : floorZ,
  };
}

function flattenSamplePaths(paths: SamplePath[]) {
  const flat: CamCLPoint[] = [];
  const slices: Array<{ path: SamplePath; start: number; count: number }> = [];
  for (const path of paths) {
    const start = flat.length;
    flat.push(...path.points);
    slices.push({ path, start, count: path.points.length });
  }
  return { flat, slices };
}

function rebuildDroppedPaths(
  samples: SamplePath[],
  droppedPoints: CamCLPoint[],
  slices: Array<{ path: SamplePath; start: number; count: number }>,
) {
  const out: CamDroppedPath[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const slice = slices[index];
    if (!slice || slice.count <= 0) continue;
    out.push({
      id: slice.path.id,
      points: droppedPoints.slice(slice.start, slice.start + slice.count),
      sourceSpanIds: slice.path.sourceSpanIds.slice(),
    });
  }
  return out;
}

function emptyPathDropOutput(
  sourcePathCount: number,
  warnings: string[],
  adaptive = false,
  overrides: Partial<CamPathDropOutput['summary']> = {},
): CamPathDropOutput {
  return {
    paths: [],
    warnings,
    summary: {
      sourcePathCount,
      spanCount: 0,
      sampleCount: 0,
      candidateCount: 0,
      contactCount: 0,
      ...overrides,
      warningCount: warnings.length,
      ...(adaptive ? {
        acceptedIntervalCount: 0,
        subdivisionCount: 0,
        maxObservedDepth: 0,
        ...overrides,
      } : {}),
    },
  };
}

export async function uniformPathDropCutter(input: CamUniformPathDropInput): Promise<CamPathDropOutput> {
  const warnings: string[] = [];
  const sourcePaths = normalizeSourcePaths(input.paths);
  const cutter = normalizeCutter(input.cutter);
  warnings.push(...cutter.validate());
  if (warnings.length) return emptyPathDropOutput(sourcePaths.length, warnings);
  const sampleSpacingWarning = positiveNumberWarning(input.sampleSpacing, 'Uniform path drop-cutter sampleSpacing');
  if (sampleSpacingWarning) return emptyPathDropOutput(sourcePaths.length, [sampleSpacingWarning]);
  if (!Array.isArray(input.triangles) || input.triangles.length === 0) {
    return emptyPathDropOutput(sourcePaths.length, ['No mesh triangles were supplied for uniform path drop-cutter.']);
  }
  const floorZ = finiteNumber(input.floorZ, 0);
  const sampleSpacing = positiveNumber(input.sampleSpacing, 1);

  emitProgress(input, {
    phase: 'uniform-path-sample',
    message: 'Sampling source CAM paths',
    detail: `${sourcePaths.length} source path${sourcePaths.length === 1 ? '' : 's'}`,
    current: 5,
    total: 100,
  });
  await yieldProgress(input);

  const sourceSpanPreparation = prepareSourcePathSpans(sourcePaths, warnings);
  const spanCount = sourceSpanPreparation.spanCount;
  if (sourceSpanPreparation.validSpanCount === 0) {
    return emptyPathDropOutput(sourcePaths.length, warnings, false, { spanCount });
  }

  const samples: SamplePath[] = [];
  for (const { path, spans } of sourceSpanPreparation.prepared) {
    if (!spans.length) continue;
    const sampled = sampleCamPathSpans(spans, sampleSpacing, {
      suppressSharedEndpoints: input.preserveSpanBoundaries === true ? false : true,
    });
    if (!sampled.points.length) {
      warnings.push(`Path ${path.id} produced no uniform drop-cutter samples.`);
      continue;
    }
    samples.push({
      id: path.id,
      points: sampled.points.map((point) => point3ToCLPoint([point[0], point[1], floorZ], floorZ)),
      sourceSpanIds: sampled.spanIds,
    });
  }

  const { flat, slices } = flattenSamplePaths(samples);
  if (!flat.length) {
    return emptyPathDropOutput(sourcePaths.length, warnings, false, { spanCount });
  }

  emitProgress(input, {
    phase: 'uniform-path-drop',
    message: 'Projecting uniform CAM path samples',
    detail: `${flat.length} sample${flat.length === 1 ? '' : 's'}`,
    current: 20,
    total: 100,
  });
  await yieldProgress(input);

  const dropped = await dropCutterBatch({
    points: flat,
    cutter,
    triangles: input.triangles,
    floorZ,
    index: input.index,
    indexOptions: input.indexOptions,
    tolerance: input.tolerance,
    chunkSize: input.chunkSize,
    onProgress: emitMappedBatchProgress(input, 'uniform-path-drop', 22, 92),
    progressYield: input.progressYield,
  });
  warnings.push(...dropped.warnings);

  emitProgress(input, {
    phase: 'uniform-path-rebuild',
    message: 'Rebuilding projected CAM paths',
    detail: `${samples.length} path${samples.length === 1 ? '' : 's'}`,
    current: 96,
    total: 100,
  });

  const paths = rebuildDroppedPaths(samples, dropped.points, slices);
  return {
    paths,
    warnings,
    summary: {
      sourcePathCount: sourcePaths.length,
      spanCount,
      sampleCount: flat.length,
      candidateCount: dropped.summary.candidateCount,
      contactCount: dropped.summary.contactCount,
      warningCount: warnings.length,
    },
  };
}

function distance3(a: CamCLPoint, b: CamCLPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function distance2FromSpan(span: CamPathSpan, t0: number, t1: number) {
  const a = span.pointAt(t0);
  const b = span.pointAt(t1);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function flatnessCos(a: CamCLPoint, b: CamCLPoint, c: CamCLPoint, tolerance: number) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const bc = [c.x - b.x, c.y - b.y, c.z - b.z];
  const lab = Math.hypot(ab[0], ab[1], ab[2]);
  const lbc = Math.hypot(bc[0], bc[1], bc[2]);
  if (lab <= tolerance || lbc <= tolerance) return 1;
  return (ab[0] * bc[0] + ab[1] * bc[1] + ab[2] * bc[2]) / (lab * lbc);
}

function droppedSpanPoint(
  span: CamPathSpan,
  t: number,
  floorZ: number,
  projector: ReturnType<typeof createDropCutterProjector>,
  candidateContactSummary: { candidateCount: number; contactCount: number; warnings: string[] },
) {
  const source = span.pointAt(t);
  const result = projector.dropPoint({ x: source[0], y: source[1], z: floorZ });
  candidateContactSummary.candidateCount += result.candidateCount;
  candidateContactSummary.contactCount += result.contactCount;
  candidateContactSummary.warnings.push(...result.warnings);
  return result.point;
}

function appendProjectedPoint(points: CamCLPoint[], spanIds: string[], point: CamCLPoint, spanId: string, tolerance: number) {
  const previous = points[points.length - 1];
  if (previous
    && Math.abs(previous.x - point.x) <= tolerance
    && Math.abs(previous.y - point.y) <= tolerance
    && Math.abs(previous.z - point.z) <= tolerance) {
    return;
  }
  points.push(point);
  spanIds.push(spanId);
}

export async function adaptivePathDropCutter(input: CamAdaptivePathDropInput): Promise<CamPathDropOutput> {
  const warnings: string[] = [];
  const sourcePaths = normalizeSourcePaths(input.paths);
  const cutter = normalizeCutter(input.cutter);
  warnings.push(...cutter.validate());
  if (warnings.length) return emptyPathDropOutput(sourcePaths.length, warnings, true);
  const samplingWarnings = [
    positiveNumberWarning(input.sampleSpacing, 'Adaptive path drop-cutter sampleSpacing'),
    input.minSampleSpacing == null
      ? null
      : positiveNumberWarning(input.minSampleSpacing, 'Adaptive path drop-cutter minSampleSpacing'),
  ].filter((warning): warning is string => !!warning);
  if (samplingWarnings.length) return emptyPathDropOutput(sourcePaths.length, samplingWarnings, true);
  if (!Array.isArray(input.triangles) || input.triangles.length === 0) {
    return emptyPathDropOutput(sourcePaths.length, ['No mesh triangles were supplied for adaptive path drop-cutter.'], true);
  }
  const floorZ = finiteNumber(input.floorZ, 0);
  const sampleSpacing = positiveNumber(input.sampleSpacing, 1);
  const minSampleSpacing = Math.min(sampleSpacing, positiveNumber(input.minSampleSpacing, sampleSpacing * 0.25));
  const flatnessCosLimit = Math.max(-1, Math.min(1, finiteNumber(input.flatnessCosLimit, 0.999)));
  const maxDepth = Math.max(1, Math.min(32, Math.round(finiteNumber(input.maxDepth, 12))));
  const chunkSize = positiveInteger(input.chunkSize, 128);
  const sourceSpanPreparation = prepareSourcePathSpans(sourcePaths, warnings);
  const spanCount = sourceSpanPreparation.spanCount;
  if (sourceSpanPreparation.validSpanCount === 0) {
    return emptyPathDropOutput(sourcePaths.length, warnings, true, { spanCount });
  }
  const triangleCount = Array.isArray(input.triangles) ? input.triangles.length : 0;
  emitProgress(input, {
    phase: 'adaptive-path-index',
    message: 'Preparing adaptive path triangle index',
    detail: input.index ? 'Using existing drop-cutter index.' : `${triangleCount} triangle${triangleCount === 1 ? '' : 's'}`,
    current: 2,
    total: 100,
  });
  await yieldProgress(input);
  const projector = createDropCutterProjector({
    cutter,
    triangles: input.triangles,
    index: input.index,
    indexOptions: input.indexOptions,
    floorZ,
    tolerance: input.tolerance,
  });
  warnings.push(...projector.warnings);
  const summary = {
    candidateCount: 0,
    contactCount: 0,
    warnings: [] as string[],
  };

  emitProgress(input, {
    phase: 'adaptive-path-start',
    message: 'Projecting adaptive CAM paths',
    detail: `${sourcePaths.length} source path${sourcePaths.length === 1 ? '' : 's'}`,
    current: 4,
    total: 100,
  });
  await yieldProgress(input);

  emitProgress(input, {
    phase: 'adaptive-path-drop',
    message: 'Dropping adaptive CAM path samples',
    detail: 'Evaluating source endpoints and adaptive midpoint chunks.',
    current: 6,
    total: 100,
  });
  await yieldProgress(input);

  const droppedPaths: CamDroppedPath[] = [];
  let sampleCount = 0;
  let acceptedIntervalCount = 0;
  let subdivisionCount = 0;
  let maxObservedDepth = 0;
  let midpointEvaluationCount = 0;

  const preparedPaths = sourceSpanPreparation.prepared;
  for (let pathIndex = 0; pathIndex < preparedPaths.length; pathIndex += 1) {
    const { path, spans } = preparedPaths[pathIndex];
    if (!spans.length) continue;
    const points: CamCLPoint[] = [];
    const spanIds: string[] = [];

    for (const span of spans) {
      const startPoint = droppedSpanPoint(span, 0, floorZ, projector, summary);
      appendProjectedPoint(points, spanIds, startPoint, span.id, EPS);
      sampleCount += 1;

      const endPoint = droppedSpanPoint(span, 1, floorZ, projector, summary);
      sampleCount += 1;
      const stack = [{ t0: 0, t1: 1, p0: startPoint, p1: endPoint, depth: 0 }];
      while (stack.length) {
        const interval = stack.pop()!;
        midpointEvaluationCount += 1;
        maxObservedDepth = Math.max(maxObservedDepth, interval.depth);
        const tm = (interval.t0 + interval.t1) * 0.5;
        const midpoint = droppedSpanPoint(span, tm, floorZ, projector, summary);
        sampleCount += 1;
        if (midpointEvaluationCount % chunkSize === 0) {
          emitProgressWithAlias(input, {
            phase: 'adaptive-path-subdivide',
            message: 'Subdividing adaptive CAM path',
            detail: `${path.id}:${span.id} (${midpointEvaluationCount} midpoint sample${midpointEvaluationCount === 1 ? '' : 's'})`,
            current: 8 + ((pathIndex + 0.5) / Math.max(1, sourcePaths.length)) * 88,
            total: 100,
          }, 'adaptive-path-drop');
          await yieldProgress(input);
        }
        const chordLength = distance3(interval.p0, interval.p1);
        const sourceLength = distance2FromSpan(span, interval.t0, interval.t1);
        const flatness = flatnessCos(interval.p0, midpoint, interval.p1, EPS);
        const shouldSubdivide = interval.depth < maxDepth
          && sourceLength > minSampleSpacing
          && (
            chordLength > sampleSpacing
            || (flatness < flatnessCosLimit && chordLength > minSampleSpacing)
            || (chordLength <= EPS && sourceLength > sampleSpacing)
          );
        if (shouldSubdivide) {
          subdivisionCount += 1;
          stack.push({ t0: tm, t1: interval.t1, p0: midpoint, p1: interval.p1, depth: interval.depth + 1 });
          stack.push({ t0: interval.t0, t1: tm, p0: interval.p0, p1: midpoint, depth: interval.depth + 1 });
          continue;
        }
        if (interval.depth >= maxDepth && (flatness < flatnessCosLimit || chordLength > sampleSpacing)) {
          warnings.push(`Path ${path.id} span ${span.id} reached adaptive drop-cutter maxDepth ${maxDepth}.`);
        }
        acceptedIntervalCount += 1;
        appendProjectedPoint(points, spanIds, interval.p1, span.id, EPS);
      }
    }

    if (points.length) {
      droppedPaths.push({ id: path.id, points, sourceSpanIds: spanIds });
    } else {
      warnings.push(`Path ${path.id} produced no adaptive drop-cutter samples.`);
    }

    emitProgressWithAlias(input, {
      phase: 'adaptive-path-span',
      message: 'Adaptive CAM path projected',
      detail: `${pathIndex + 1} of ${sourcePaths.length}; ${acceptedIntervalCount} accepted interval${acceptedIntervalCount === 1 ? '' : 's'}`,
      current: 8 + ((pathIndex + 1) / Math.max(1, sourcePaths.length)) * 88,
      total: 100,
    }, 'adaptive-path-sample');
    await yieldProgress(input);
  }

  warnings.push(...summary.warnings);
  emitProgress(input, {
    phase: 'adaptive-path-complete',
    message: 'Adaptive CAM path projection complete',
    detail: `${sampleCount} sample${sampleCount === 1 ? '' : 's'}`,
    current: 100,
    total: 100,
  });

  return {
    paths: droppedPaths,
    warnings,
    summary: {
      sourcePathCount: sourcePaths.length,
      spanCount,
      sampleCount,
      candidateCount: summary.candidateCount,
      contactCount: summary.contactCount,
      warningCount: warnings.length,
      acceptedIntervalCount,
      subdivisionCount,
      maxObservedDepth,
    },
  };
}

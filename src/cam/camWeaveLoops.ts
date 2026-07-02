import type { CamFiber, CamFiberInterval } from './camPushCutter.js';

export type CamWeavePoint3 = [number, number, number];

export type CamWeaveInput = {
  xFibers: CamFiber[];
  yFibers: CamFiber[];
  z: number;
  tolerance?: number;
};

export type CamWeaveOutput = {
  loops: CamWeavePoint3[][];
  graphStats: {
    clVertexCount: number;
    intersectionVertexCount: number;
    edgeCount: number;
    rejectedLoopCount: number;
  };
  warnings: string[];
};

export type CamWeaveProgressEvent = {
  phase: string;
  current: number;
  total: number;
  detail?: string;
};

export type CamWeaveAsyncOptions = {
  chunkSize?: number;
  onProgress?: (event: CamWeaveProgressEvent) => void;
  progressYield?: () => void | Promise<void>;
};

type IntervalSpan = {
  fiberId: string;
  fixed: number;
  lower: number;
  upper: number;
};

type BoundaryEdge = {
  startKey: string;
  endKey: string;
  start: CamWeavePoint3;
  end: CamWeavePoint3;
  dx: number;
  dy: number;
};

const EPS = 1e-7;

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function weaveChunkSize(options?: CamWeaveAsyncOptions) {
  return Math.max(1, Math.round(finiteNumber(options?.chunkSize, 2048)));
}

async function yieldWeaveProgress(
  options: CamWeaveAsyncOptions | undefined,
  phase: string,
  current: number,
  total: number,
  detail?: string,
) {
  if (!options) return;
  try {
    options.onProgress?.({
      phase,
      current: Math.max(0, Math.min(Math.max(1, total), current)),
      total: Math.max(1, total),
      detail,
    });
  } catch {
    // Progress listeners must not make geometry reconstruction fail.
  }
  if (typeof options.progressYield === 'function') await options.progressYield();
}

function coordinateAtT(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function normalizeInterval(interval: CamFiberInterval, tolerance: number) {
  const lowerT = Math.max(0, Math.min(1, finiteNumber(interval.lowerT, 0)));
  const upperT = Math.max(0, Math.min(1, finiteNumber(interval.upperT, 0)));
  const lower = Math.min(lowerT, upperT);
  const upper = Math.max(lowerT, upperT);
  return upper > lower + tolerance ? { lower, upper } : null;
}

function intervalSpansForDirection(fibersInput: CamFiber[] | null | undefined, direction: 'x' | 'y', tolerance: number) {
  const fibers = (Array.isArray(fibersInput) ? fibersInput : [])
    .filter((fiber) => fiber?.direction === direction)
    .slice()
    .sort((a, b) => {
      const fixedAxis = direction === 'x' ? 1 : 0;
      const fixedDelta = finiteNumber(a.start?.[fixedAxis], 0) - finiteNumber(b.start?.[fixedAxis], 0);
      if (Math.abs(fixedDelta) > tolerance) return fixedDelta;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  const spans: IntervalSpan[] = [];
  for (const fiber of fibers) {
    const axis = direction === 'x' ? 0 : 1;
    const fixedAxis = direction === 'x' ? 1 : 0;
    const fixed = finiteNumber(fiber.start?.[fixedAxis], 0);
    const intervals = (Array.isArray(fiber.intervals) ? fiber.intervals : []).slice().sort((a, b) => {
      const lowerDelta = finiteNumber(a.lowerT, 0) - finiteNumber(b.lowerT, 0);
      if (Math.abs(lowerDelta) > tolerance) return lowerDelta;
      return finiteNumber(a.upperT, 0) - finiteNumber(b.upperT, 0);
    });
    for (const interval of intervals) {
      const normalized = normalizeInterval(interval, tolerance);
      if (!normalized) continue;
      const c0 = coordinateAtT(finiteNumber(fiber.start?.[axis], 0), finiteNumber(fiber.end?.[axis], 0), normalized.lower);
      const c1 = coordinateAtT(finiteNumber(fiber.start?.[axis], 0), finiteNumber(fiber.end?.[axis], 0), normalized.upper);
      spans.push({
        fiberId: fiber.id || `${direction}-fiber`,
        fixed,
        lower: Math.min(c0, c1),
        upper: Math.max(c0, c1),
      });
    }
  }
  return spans;
}

function spanContains(span: IntervalSpan, value: number, tolerance: number) {
  return value >= span.lower - tolerance && value <= span.upper + tolerance;
}

function uniqueSorted(values: number[], tolerance: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > tolerance) out.push(value);
  }
  return out;
}

function cellIsOccupied(
  centerX: number,
  centerY: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  xSpans: IntervalSpan[],
  ySpans: IntervalSpan[],
  tolerance: number,
) {
  for (const span of xSpans) {
    if (span.fixed < minY - tolerance || span.fixed > maxY + tolerance) continue;
    if (centerX >= span.lower - tolerance && centerX <= span.upper + tolerance) return true;
  }
  for (const span of ySpans) {
    if (span.fixed < minX - tolerance || span.fixed > maxX + tolerance) continue;
    if (centerY >= span.lower - tolerance && centerY <= span.upper + tolerance) return true;
  }
  return false;
}

function pointKey(i: number, j: number) {
  return `${i},${j}`;
}

function signedLoopArea(loop: CamWeavePoint3[]) {
  let area = 0;
  const count = loop.length > 1 ? loop.length - 1 : loop.length;
  for (let index = 0; index < count; index += 1) {
    const a = loop[index];
    const b = loop[(index + 1) % count];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function pointsEqual2(a: CamWeavePoint3, b: CamWeavePoint3, tolerance: number) {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

function simplifyLoop(loop: CamWeavePoint3[], tolerance: number) {
  if (loop.length < 4) return loop;
  const source = pointsEqual2(loop[0], loop[loop.length - 1], tolerance) ? loop.slice(0, -1) : loop.slice();
  const out: CamWeavePoint3[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const previous = source[(index + source.length - 1) % source.length];
    const current = source[index];
    const next = source[(index + 1) % source.length];
    const ax = current[0] - previous[0];
    const ay = current[1] - previous[1];
    const bx = next[0] - current[0];
    const by = next[1] - current[1];
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    if (Math.abs(cross) <= tolerance && dot >= -tolerance) continue;
    out.push(current);
  }
  if (out.length < 3) return loop;
  out.push([...out[0]] as CamWeavePoint3);
  return out;
}

function edgeAngle(edge: BoundaryEdge) {
  return Math.atan2(edge.dy, edge.dx);
}

function turnDelta(previous: BoundaryEdge, next: BoundaryEdge) {
  const tau = Math.PI * 2;
  let delta = edgeAngle(next) - edgeAngle(previous);
  while (delta < 0) delta += tau;
  while (delta >= tau) delta -= tau;
  return delta;
}

function traceBoundaryLoops(edges: BoundaryEdge[], tolerance: number) {
  const outgoing = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const list = outgoing.get(edge.startKey) || [];
    list.push(index);
    outgoing.set(edge.startKey, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => {
      const angleDelta = edgeAngle(edges[a]) - edgeAngle(edges[b]);
      if (Math.abs(angleDelta) > tolerance) return angleDelta;
      return edges[a].endKey.localeCompare(edges[b].endKey);
    });
  }

  const used = new Set<number>();
  const loops: CamWeavePoint3[][] = [];
  let rejectedLoopCount = 0;
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (used.has(edgeIndex)) continue;
    const startKey = edges[edgeIndex].startKey;
    let currentIndex = edgeIndex;
    const points: CamWeavePoint3[] = [edges[currentIndex].start];
    let closed = false;

    for (let guard = 0; guard <= edges.length + 1; guard += 1) {
      if (used.has(currentIndex)) break;
      const edge = edges[currentIndex];
      used.add(currentIndex);
      points.push(edge.end);
      if (edge.endKey === startKey) {
        closed = true;
        break;
      }
      const candidates = (outgoing.get(edge.endKey) || []).filter((candidate) => !used.has(candidate));
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const delta = turnDelta(edge, edges[a]) - turnDelta(edge, edges[b]);
        if (Math.abs(delta) > tolerance) return delta;
        return edges[a].endKey.localeCompare(edges[b].endKey);
      });
      currentIndex = candidates[0];
    }

    if (!closed || points.length < 4) {
      rejectedLoopCount += 1;
      continue;
    }
    const simplified = simplifyLoop(points, tolerance);
    if (Math.abs(signedLoopArea(simplified)) <= tolerance) {
      rejectedLoopCount += 1;
      continue;
    }
    loops.push(simplified);
  }

  loops.sort((a, b) => {
    const areaDelta = Math.abs(signedLoopArea(b)) - Math.abs(signedLoopArea(a));
    if (Math.abs(areaDelta) > tolerance) return areaDelta;
    const a0 = a[0];
    const b0 = b[0];
    return a0[0] - b0[0] || a0[1] - b0[1];
  });
  return { loops, rejectedLoopCount };
}

async function traceBoundaryLoopsAsync(edges: BoundaryEdge[], tolerance: number, options?: CamWeaveAsyncOptions) {
  const outgoing = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const list = outgoing.get(edge.startKey) || [];
    list.push(index);
    outgoing.set(edge.startKey, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => {
      const angleDelta = edgeAngle(edges[a]) - edgeAngle(edges[b]);
      if (Math.abs(angleDelta) > tolerance) return angleDelta;
      return edges[a].endKey.localeCompare(edges[b].endKey);
    });
  }

  const used = new Set<number>();
  const loops: CamWeavePoint3[][] = [];
  let rejectedLoopCount = 0;
  let traversed = 0;
  const chunkSize = weaveChunkSize(options);
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (used.has(edgeIndex)) continue;
    const startKey = edges[edgeIndex].startKey;
    let currentIndex = edgeIndex;
    const points: CamWeavePoint3[] = [edges[currentIndex].start];
    let closed = false;

    for (let guard = 0; guard <= edges.length + 1; guard += 1) {
      if (used.has(currentIndex)) break;
      const edge = edges[currentIndex];
      used.add(currentIndex);
      traversed += 1;
      points.push(edge.end);
      if (traversed % chunkSize === 0) {
        await yieldWeaveProgress(options, 'weave-trace', traversed, edges.length, `${used.size} of ${edges.length} boundary edges`);
      }
      if (edge.endKey === startKey) {
        closed = true;
        break;
      }
      const candidates = (outgoing.get(edge.endKey) || []).filter((candidate) => !used.has(candidate));
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const delta = turnDelta(edge, edges[a]) - turnDelta(edge, edges[b]);
        if (Math.abs(delta) > tolerance) return delta;
        return edges[a].endKey.localeCompare(edges[b].endKey);
      });
      currentIndex = candidates[0];
    }

    if (!closed || points.length < 4) {
      rejectedLoopCount += 1;
      continue;
    }
    const simplified = simplifyLoop(points, tolerance);
    if (Math.abs(signedLoopArea(simplified)) <= tolerance) {
      rejectedLoopCount += 1;
      continue;
    }
    loops.push(simplified);
  }

  await yieldWeaveProgress(options, 'weave-trace', edges.length, edges.length, `${used.size} of ${edges.length} boundary edges`);

  loops.sort((a, b) => {
    const areaDelta = Math.abs(signedLoopArea(b)) - Math.abs(signedLoopArea(a));
    if (Math.abs(areaDelta) > tolerance) return areaDelta;
    const a0 = a[0];
    const b0 = b[0];
    return a0[0] - b0[0] || a0[1] - b0[1];
  });
  return { loops, rejectedLoopCount };
}

function buildBoundaryLoopsFromIntervals(
  xSpans: IntervalSpan[],
  ySpans: IntervalSpan[],
  z: number,
  tolerance: number,
) {
  const xs = uniqueSorted([
    ...xSpans.flatMap((span) => [span.lower, span.upper]),
    ...ySpans.map((span) => span.fixed),
  ], tolerance);
  const ys = uniqueSorted([
    ...ySpans.flatMap((span) => [span.lower, span.upper]),
    ...xSpans.map((span) => span.fixed),
  ], tolerance);
  if (xs.length < 2 || ys.length < 2) return { loops: [], rejectedLoopCount: 1, edgeCount: 0 };

  const width = xs.length - 1;
  const height = ys.length - 1;
  const occupied = new Set<string>();
  for (let ix = 0; ix < width; ix += 1) {
    for (let iy = 0; iy < height; iy += 1) {
      const minX = xs[ix];
      const maxX = xs[ix + 1];
      const minY = ys[iy];
      const maxY = ys[iy + 1];
      if (maxX <= minX + tolerance || maxY <= minY + tolerance) continue;
      if (!cellIsOccupied(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        minX,
        minY,
        maxX,
        maxY,
        xSpans,
        ySpans,
        tolerance,
      )) continue;
      occupied.add(pointKey(ix, iy));
    }
  }
  if (!occupied.size) return { loops: [], rejectedLoopCount: 1, edgeCount: 0 };

  const cell = (ix: number, iy: number) => occupied.has(pointKey(ix, iy));
  const point = (ix: number, iy: number): CamWeavePoint3 => [xs[ix], ys[iy], z];
  const edges: BoundaryEdge[] = [];
  const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
    edges.push({
      startKey: pointKey(sx, sy),
      endKey: pointKey(ex, ey),
      start: point(sx, sy),
      end: point(ex, ey),
      dx: xs[ex] - xs[sx],
      dy: ys[ey] - ys[sy],
    });
  };

  for (let ix = 0; ix < width; ix += 1) {
    for (let iy = 0; iy < height; iy += 1) {
      if (!cell(ix, iy)) continue;
      if (!cell(ix, iy - 1)) addEdge(ix, iy, ix + 1, iy);
      if (!cell(ix + 1, iy)) addEdge(ix + 1, iy, ix + 1, iy + 1);
      if (!cell(ix, iy + 1)) addEdge(ix + 1, iy + 1, ix, iy + 1);
      if (!cell(ix - 1, iy)) addEdge(ix, iy + 1, ix, iy);
    }
  }

  const traced = traceBoundaryLoops(edges, tolerance);
  return {
    loops: traced.loops,
    rejectedLoopCount: traced.rejectedLoopCount,
    edgeCount: edges.length,
  };
}

async function buildBoundaryLoopsFromIntervalsAsync(
  xSpans: IntervalSpan[],
  ySpans: IntervalSpan[],
  z: number,
  tolerance: number,
  options?: CamWeaveAsyncOptions,
) {
  const xs = uniqueSorted([
    ...xSpans.flatMap((span) => [span.lower, span.upper]),
    ...ySpans.map((span) => span.fixed),
  ], tolerance);
  const ys = uniqueSorted([
    ...ySpans.flatMap((span) => [span.lower, span.upper]),
    ...xSpans.map((span) => span.fixed),
  ], tolerance);
  if (xs.length < 2 || ys.length < 2) return { loops: [], rejectedLoopCount: 1, edgeCount: 0 };

  const width = xs.length - 1;
  const height = ys.length - 1;
  const occupied = new Set<string>();
  const chunkSize = weaveChunkSize(options);
  const cellTotal = Math.max(1, width * height);
  let cellCount = 0;
  for (let ix = 0; ix < width; ix += 1) {
    for (let iy = 0; iy < height; iy += 1) {
      cellCount += 1;
      const minX = xs[ix];
      const maxX = xs[ix + 1];
      const minY = ys[iy];
      const maxY = ys[iy + 1];
      if (maxX > minX + tolerance && maxY > minY + tolerance && cellIsOccupied(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        minX,
        minY,
        maxX,
        maxY,
        xSpans,
        ySpans,
        tolerance,
      )) {
        occupied.add(pointKey(ix, iy));
      }
      if (cellCount % chunkSize === 0) {
        await yieldWeaveProgress(options, 'weave-cells', cellCount, cellTotal, `${occupied.size} occupied cells`);
      }
    }
  }
  await yieldWeaveProgress(options, 'weave-cells', cellTotal, cellTotal, `${occupied.size} occupied cells`);
  if (!occupied.size) return { loops: [], rejectedLoopCount: 1, edgeCount: 0 };

  const cell = (ix: number, iy: number) => occupied.has(pointKey(ix, iy));
  const point = (ix: number, iy: number): CamWeavePoint3 => [xs[ix], ys[iy], z];
  const edges: BoundaryEdge[] = [];
  const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
    edges.push({
      startKey: pointKey(sx, sy),
      endKey: pointKey(ex, ey),
      start: point(sx, sy),
      end: point(ex, ey),
      dx: xs[ex] - xs[sx],
      dy: ys[ey] - ys[sy],
    });
  };

  let edgeCells = 0;
  for (let ix = 0; ix < width; ix += 1) {
    for (let iy = 0; iy < height; iy += 1) {
      edgeCells += 1;
      if (cell(ix, iy)) {
        if (!cell(ix, iy - 1)) addEdge(ix, iy, ix + 1, iy);
        if (!cell(ix + 1, iy)) addEdge(ix + 1, iy, ix + 1, iy + 1);
        if (!cell(ix, iy + 1)) addEdge(ix + 1, iy + 1, ix, iy + 1);
        if (!cell(ix - 1, iy)) addEdge(ix, iy + 1, ix, iy);
      }
      if (edgeCells % chunkSize === 0) {
        await yieldWeaveProgress(options, 'weave-edges', edgeCells, cellTotal, `${edges.length} boundary edges`);
      }
    }
  }
  await yieldWeaveProgress(options, 'weave-edges', cellTotal, cellTotal, `${edges.length} boundary edges`);

  const traced = await traceBoundaryLoopsAsync(edges, tolerance, options);
  return {
    loops: traced.loops,
    rejectedLoopCount: traced.rejectedLoopCount,
    edgeCount: edges.length,
  };
}

export function reconstructWeaveLoops(input: CamWeaveInput): CamWeaveOutput {
  const tolerance = Math.max(EPS, finiteNumber(input.tolerance, 1e-6));
  const warnings: string[] = [];
  const xSpans = intervalSpansForDirection(input.xFibers, 'x', tolerance);
  const ySpans = intervalSpansForDirection(input.yFibers, 'y', tolerance);
  const clVertexCount = (xSpans.length + ySpans.length) * 2;
  let intersectionVertexCount = 0;
  for (const xSpan of xSpans) {
    for (const ySpan of ySpans) {
      if (spanContains(xSpan, ySpan.fixed, tolerance) && spanContains(ySpan, xSpan.fixed, tolerance)) {
        intersectionVertexCount += 1;
      }
    }
  }

  if (!xSpans.length || !ySpans.length) {
    warnings.push('Weave reconstruction requires both X and Y fiber intervals.');
    return {
      loops: [],
      graphStats: {
        clVertexCount,
        intersectionVertexCount,
        edgeCount: xSpans.length + ySpans.length,
        rejectedLoopCount: 1,
      },
      warnings,
    };
  }

  if (intersectionVertexCount < 4) {
    warnings.push('Weave reconstruction found an open or undersampled interval graph.');
    return {
      loops: [],
      graphStats: {
        clVertexCount,
        intersectionVertexCount,
        edgeCount: xSpans.length + ySpans.length + intersectionVertexCount * 2,
        rejectedLoopCount: 1,
      },
      warnings,
    };
  }

  const traced = buildBoundaryLoopsFromIntervals(xSpans, ySpans, finiteNumber(input.z, 0), tolerance);
  if (!traced.loops.length) {
    warnings.push('Weave reconstruction found no closed occupied fiber regions.');
  }
  return {
    loops: traced.loops,
    graphStats: {
      clVertexCount,
      intersectionVertexCount,
      edgeCount: traced.edgeCount || (xSpans.length + ySpans.length + intersectionVertexCount * 2),
      rejectedLoopCount: traced.rejectedLoopCount,
    },
    warnings,
  };
}

async function countSpanIntersectionsAsync(
  xSpans: IntervalSpan[],
  ySpans: IntervalSpan[],
  tolerance: number,
  options?: CamWeaveAsyncOptions,
) {
  let intersectionVertexCount = 0;
  let checked = 0;
  const total = Math.max(1, xSpans.length * ySpans.length);
  const chunkSize = weaveChunkSize(options);
  for (const xSpan of xSpans) {
    for (const ySpan of ySpans) {
      if (spanContains(xSpan, ySpan.fixed, tolerance) && spanContains(ySpan, xSpan.fixed, tolerance)) {
        intersectionVertexCount += 1;
      }
      checked += 1;
      if (checked % chunkSize === 0) {
        await yieldWeaveProgress(options, 'weave-intersections', checked, total, `${intersectionVertexCount} crossings`);
      }
    }
  }
  await yieldWeaveProgress(options, 'weave-intersections', total, total, `${intersectionVertexCount} crossings`);
  return intersectionVertexCount;
}

export async function reconstructWeaveLoopsAsync(input: CamWeaveInput, options: CamWeaveAsyncOptions = {}): Promise<CamWeaveOutput> {
  const tolerance = Math.max(EPS, finiteNumber(input.tolerance, 1e-6));
  const warnings: string[] = [];
  const xSpans = intervalSpansForDirection(input.xFibers, 'x', tolerance);
  const ySpans = intervalSpansForDirection(input.yFibers, 'y', tolerance);
  const clVertexCount = (xSpans.length + ySpans.length) * 2;
  await yieldWeaveProgress(options, 'weave-spans', xSpans.length + ySpans.length, Math.max(1, xSpans.length + ySpans.length), `${xSpans.length} X spans, ${ySpans.length} Y spans`);
  const intersectionVertexCount = await countSpanIntersectionsAsync(xSpans, ySpans, tolerance, options);

  if (!xSpans.length || !ySpans.length) {
    warnings.push('Weave reconstruction requires both X and Y fiber intervals.');
    return {
      loops: [],
      graphStats: {
        clVertexCount,
        intersectionVertexCount,
        edgeCount: xSpans.length + ySpans.length,
        rejectedLoopCount: 1,
      },
      warnings,
    };
  }

  if (intersectionVertexCount < 4) {
    warnings.push('Weave reconstruction found an open or undersampled interval graph.');
    return {
      loops: [],
      graphStats: {
        clVertexCount,
        intersectionVertexCount,
        edgeCount: xSpans.length + ySpans.length + intersectionVertexCount * 2,
        rejectedLoopCount: 1,
      },
      warnings,
    };
  }

  const traced = await buildBoundaryLoopsFromIntervalsAsync(xSpans, ySpans, finiteNumber(input.z, 0), tolerance, options);
  if (!traced.loops.length) {
    warnings.push('Weave reconstruction found no closed occupied fiber regions.');
  }
  return {
    loops: traced.loops,
    graphStats: {
      clVertexCount,
      intersectionVertexCount,
      edgeCount: traced.edgeCount || (xSpans.length + ySpans.length + intersectionVertexCount * 2),
      rejectedLoopCount: traced.rejectedLoopCount,
    },
    warnings,
  };
}

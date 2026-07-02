export type CamOrderingPoint3 = [number, number, number];
export type CamOrderingSegmentKind = 'rapid' | 'link' | 'cut';

export type CamOrderingPath = {
  id: string;
  z: number;
  feedRate: number;
  plungeRate: number;
  points: CamOrderingPoint3[];
  segmentKinds?: CamOrderingSegmentKind[];
  closed?: boolean;
  orderingPriority?: number;
  [key: string]: any;
};

export type CamPathOrderingInput<TPath extends CamOrderingPath = CamOrderingPath> = {
  paths: TPath[];
  startPosition?: CamOrderingPoint3;
  safeHeight?: number;
  linkMode?: 'retract' | 'low-hop' | 'feed-link';
  allowReverse?: boolean;
  preserveLevelOrder?: boolean;
  enableTwoOpt?: boolean;
  twoOptMaxPathCount?: number;
  twoOptMaxIterations?: number;
};

export type CamPathOrderingOutput<TPath extends CamOrderingPath = CamOrderingPath> = {
  paths: TPath[];
  reversedPathIds: string[];
  summary: {
    inputPathCount: number;
    outputPathCount: number;
    reversedCount: number;
    rotatedClosedLoopCount: number;
    twoOptImprovementCount: number;
    travelBefore: number;
    travelAfter: number;
  };
  warnings: string[];
};

const EPS = 1e-7;

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clonePoint(point: CamOrderingPoint3): CamOrderingPoint3 {
  return [
    finiteNumber(point?.[0], 0),
    finiteNumber(point?.[1], 0),
    finiteNumber(point?.[2], 0),
  ];
}

function pointIsFinite(point: any) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function pathHasFinitePoints(path: CamOrderingPath) {
  return Array.isArray(path.points)
    && path.points.length >= 2
    && path.points.every((point) => pointIsFinite(point));
}

function pathWarningLabel(path: CamOrderingPath, index: number) {
  return String(path?.id || `path ${index + 1}`);
}

function pointsEqual(a: CamOrderingPoint3, b: CamOrderingPoint3, tolerance = 1e-6) {
  return Math.abs(a[0] - b[0]) <= tolerance
    && Math.abs(a[1] - b[1]) <= tolerance
    && Math.abs(a[2] - b[2]) <= tolerance;
}

function xyDistance(a: CamOrderingPoint3, b: CamOrderingPoint3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function accessTravelCost(
  current: CamOrderingPoint3,
  target: CamOrderingPoint3,
  safeHeight: number,
  linkMode: CamPathOrderingInput['linkMode'],
) {
  const xy = xyDistance(current, target);
  if (linkMode !== 'retract') return xy;
  const safeZ = finiteNumber(safeHeight, current[2]);
  return xy + Math.abs(safeZ - current[2]) + Math.abs(safeZ - target[2]);
}

function pathIsClosed(path: CamOrderingPath) {
  const points = path.points || [];
  return path.closed === true || (points.length > 2 && pointsEqual(points[0], points[points.length - 1]));
}

function normalizeSegmentKinds(kinds: any[] | null | undefined) {
  if (!Array.isArray(kinds)) return null;
  return kinds.map((kind) => {
    if (kind === 'rapid') return 'rapid';
    if (kind === 'link') return 'link';
    return 'cut';
  }) as CamOrderingSegmentKind[];
}

function pathSegmentKinds(path: CamOrderingPath) {
  const points = Array.isArray(path.points) ? path.points : [];
  const expected = Math.max(0, points.length - 1);
  const kinds = normalizeSegmentKinds(path.segmentKinds);
  return kinds && kinds.length === expected ? kinds : null;
}

function clonePath<TPath extends CamOrderingPath>(path: TPath, points = path.points, segmentKinds: CamOrderingSegmentKind[] | null = pathSegmentKinds(path)): TPath {
  const cloned: TPath = {
    ...path,
    points: points.map(clonePoint),
  };
  const expected = Math.max(0, cloned.points.length - 1);
  if (segmentKinds && segmentKinds.length === expected) {
    cloned.segmentKinds = segmentKinds.slice();
  } else {
    delete cloned.segmentKinds;
  }
  return cloned;
}

function reversePath<TPath extends CamOrderingPath>(path: TPath) {
  const kinds = pathSegmentKinds(path);
  return clonePath(path, path.points.slice().reverse(), kinds ? kinds.slice().reverse() : null);
}

function rotateSegmentKindsForClosedPath(path: CamOrderingPath, startIndex: number) {
  const kinds = pathSegmentKinds(path);
  if (!kinds) return null;
  const source = path.points || [];
  const openLength = pointsEqual(source[0], source[source.length - 1])
    ? Math.max(0, source.length - 1)
    : source.length;
  if (openLength <= 0) return null;
  const closedKinds = kinds.length === openLength ? kinds : [...kinds, 'cut' as CamOrderingSegmentKind];
  if (closedKinds.length !== openLength) return null;
  return closedKinds.slice(startIndex).concat(closedKinds.slice(0, startIndex));
}

function rotateClosedPathToNearest<TPath extends CamOrderingPath>(path: TPath, current: CamOrderingPoint3) {
  const source = path.points || [];
  if (source.length < 4 || !pathIsClosed(path)) return { path: clonePath(path), rotated: false };
  const open = pointsEqual(source[0], source[source.length - 1]) ? source.slice(0, -1) : source.slice();
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < open.length; index += 1) {
    const distance = xyDistance(current, open[index]);
    if (distance < bestDistance - EPS) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  if (bestIndex === 0) return { path: clonePath(path), rotated: false };
  const rotated = open.slice(bestIndex).concat(open.slice(0, bestIndex));
  rotated.push(clonePoint(rotated[0]));
  return { path: clonePath(path, rotated, rotateSegmentKindsForClosedPath(path, bestIndex)), rotated: true };
}

function closedPathAccessCost(
  path: CamOrderingPath,
  current: CamOrderingPoint3,
  safeHeight: number,
  linkMode: CamPathOrderingInput['linkMode'],
) {
  const source = path.points || [];
  if (source.length < 2) return Infinity;
  const open = pathIsClosed(path) && pointsEqual(source[0], source[source.length - 1])
    ? source.slice(0, -1)
    : source.slice();
  let best = Infinity;
  for (const point of open) {
    best = Math.min(best, accessTravelCost(current, point, safeHeight, linkMode));
  }
  return best;
}

function pathStart(path: CamOrderingPath) {
  return path.points[0];
}

function pathEnd(path: CamOrderingPath) {
  return path.points[path.points.length - 1];
}

function pathTravelDistance(
  paths: CamOrderingPath[],
  startPosition: CamOrderingPoint3,
  safeHeight: number,
  linkMode: CamPathOrderingInput['linkMode'],
) {
  let current = startPosition;
  let total = 0;
  for (const path of paths) {
    if (!path.points || path.points.length < 2) continue;
    total += accessTravelCost(current, pathStart(path), safeHeight, linkMode);
    current = pathEnd(path);
  }
  return total;
}

function rerotateClosedPathsForSequence<TPath extends CamOrderingPath>(
  paths: TPath[],
  startPosition: CamOrderingPoint3,
) {
  const ordered: TPath[] = [];
  let current = clonePoint(startPosition);
  let rotatedClosedLoopCount = 0;
  for (const path of paths) {
    let next = clonePath(path);
    if (pathIsClosed(next)) {
      const rotated = rotateClosedPathToNearest(next, current);
      next = rotated.path;
      if (rotated.rotated) rotatedClosedLoopCount += 1;
    }
    ordered.push(next);
    current = pathEnd(next);
  }
  return {
    ordered,
    rotatedClosedLoopCount,
    endPosition: current,
  };
}

function improvePathOrderWithTwoOpt<TPath extends CamOrderingPath>(
  paths: TPath[],
  startPosition: CamOrderingPoint3,
  safeHeight: number,
  linkMode: CamPathOrderingInput['linkMode'],
  {
    enabled = true,
    maxPathCount = 80,
    maxIterations = 4000,
  }: {
    enabled?: boolean;
    maxPathCount?: number;
    maxIterations?: number;
  } = {},
) {
  const limit = Math.max(0, Math.floor(finiteNumber(maxPathCount, 80)));
  const iterationLimit = Math.max(0, Math.floor(finiteNumber(maxIterations, 4000)));
  if (!enabled || paths.length < 4 || !limit || paths.length > limit || !iterationLimit) {
    return { paths, improvementCount: 0 };
  }

  let best = paths.slice();
  let bestCost = pathTravelDistance(best, startPosition, safeHeight, linkMode);
  let improvementCount = 0;
  let iterations = 0;
  let improved = true;
  while (improved && iterations < iterationLimit) {
    improved = false;
    for (let start = 0; start < best.length - 1 && iterations < iterationLimit; start += 1) {
      for (let end = start + 1; end < best.length && iterations < iterationLimit; end += 1) {
        iterations += 1;
        const candidate = best.slice(0, start)
          .concat(best.slice(start, end + 1).reverse(), best.slice(end + 1));
        const cost = pathTravelDistance(candidate, startPosition, safeHeight, linkMode);
        if (cost < bestCost - EPS) {
          best = candidate;
          bestCost = cost;
          improvementCount += 1;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return { paths: best, improvementCount };
}

function pathOrderingPriority(path: CamOrderingPath) {
  const value = Number(path?.orderingPriority);
  return Number.isFinite(value) ? value : 0;
}

function groupByLevelAndPriority<TPath extends CamOrderingPath>(paths: TPath[]) {
  const levels: Array<{ key: string; paths: TPath[] }> = [];
  const levelKeys: string[] = [];
  for (const path of paths) {
    const key = String(Math.round(finiteNumber(path.z, path.points?.[0]?.[2] ?? 0) * 1e6));
    const existing = levelKeys.indexOf(key);
    if (existing >= 0) {
      levels[existing].paths.push(path);
    } else {
      levelKeys.push(key);
      levels.push({ key, paths: [path] });
    }
  }
  const groups: TPath[][] = [];
  for (const level of levels) {
    const priorityGroups = new Map<number, TPath[]>();
    for (const path of level.paths) {
      const priority = pathOrderingPriority(path);
      const list = priorityGroups.get(priority);
      if (list) list.push(path);
      else priorityGroups.set(priority, [path]);
    }
    const priorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
    for (const priority of priorities) {
      const group = priorityGroups.get(priority);
      if (group?.length) groups.push(group);
    }
  }
  return groups;
}

function orderPathGroup<TPath extends CamOrderingPath>(
  paths: TPath[],
  startPosition: CamOrderingPoint3,
  allowReverse: boolean,
  safeHeight: number,
  linkMode: CamPathOrderingInput['linkMode'],
  twoOptOptions: {
    enabled?: boolean;
    maxPathCount?: number;
    maxIterations?: number;
  } = {},
) {
  const remaining = paths
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => Array.isArray(path.points) && path.points.length >= 2);
  const ordered: TPath[] = [];
  const reversedPathIds: string[] = [];
  let current = clonePoint(startPosition);
  let rotatedClosedLoopCount = 0;

  while (remaining.length) {
    let bestRemainingIndex = 0;
    let bestCost = Infinity;
    let bestReverse = false;
    for (let candidateIndex = 0; candidateIndex < remaining.length; candidateIndex += 1) {
      const { path, index } = remaining[candidateIndex];
      const startCost = pathIsClosed(path)
        ? closedPathAccessCost(path, current, safeHeight, linkMode)
        : accessTravelCost(current, pathStart(path), safeHeight, linkMode);
      if (startCost < bestCost - EPS || (Math.abs(startCost - bestCost) <= EPS && index < remaining[bestRemainingIndex].index)) {
        bestRemainingIndex = candidateIndex;
        bestCost = startCost;
        bestReverse = false;
      }
      if (allowReverse && !pathIsClosed(path)) {
        const endCost = accessTravelCost(current, pathEnd(path), safeHeight, linkMode);
        if (endCost < bestCost - EPS || (Math.abs(endCost - bestCost) <= EPS && index < remaining[bestRemainingIndex].index)) {
          bestRemainingIndex = candidateIndex;
          bestCost = endCost;
          bestReverse = true;
        }
      }
    }

    const [{ path }] = remaining.splice(bestRemainingIndex, 1);
    let next = bestReverse ? reversePath(path) : clonePath(path);
    if (bestReverse) reversedPathIds.push(path.id);
    if (pathIsClosed(next)) {
      const rotated = rotateClosedPathToNearest(next, current);
      next = rotated.path;
      if (rotated.rotated) rotatedClosedLoopCount += 1;
    }
    ordered.push(next);
    current = pathEnd(next);
  }

  const improved = improvePathOrderWithTwoOpt(
    ordered,
    startPosition,
    safeHeight,
    linkMode,
    twoOptOptions,
  );
  const finalSequence = improved.improvementCount
    ? rerotateClosedPathsForSequence(improved.paths, startPosition)
    : { ordered, rotatedClosedLoopCount, endPosition: current };

  return {
    ordered: finalSequence.ordered,
    reversedPathIds,
    rotatedClosedLoopCount: finalSequence.rotatedClosedLoopCount,
    twoOptImprovementCount: improved.improvementCount,
    endPosition: finalSequence.endPosition,
  };
}

export function orderCamToolpathPaths<TPath extends CamOrderingPath = CamOrderingPath>(
  input: CamPathOrderingInput<TPath>,
): CamPathOrderingOutput<TPath> {
  const sourcePaths = Array.isArray(input.paths) ? input.paths : [];
  const warnings: string[] = [];
  const validSourcePaths = sourcePaths.filter((path, index) => {
    if (!Array.isArray(path.points) || path.points.length < 2) return false;
    if (pathHasFinitePoints(path)) return true;
    warnings.push(`CAM path ordering skipped path ${pathWarningLabel(path, index)}: non-finite cutter-location coordinate.`);
    return false;
  });
  const startPosition = clonePoint(input.startPosition || [0, 0, finiteNumber(input.safeHeight, 0)]);
  const allowReverse = input.allowReverse !== false;
  const preserveLevelOrder = input.preserveLevelOrder === true;
  const safeHeight = finiteNumber(input.safeHeight, startPosition[2]);
  const linkMode = input.linkMode;
  const groups = preserveLevelOrder ? groupByLevelAndPriority(validSourcePaths) : [validSourcePaths];
  const ordered: TPath[] = [];
  const reversedPathIds: string[] = [];
  let current = startPosition;
  let rotatedClosedLoopCount = 0;
  let twoOptImprovementCount = 0;

  for (const group of groups) {
    const result = orderPathGroup(group, current, allowReverse, safeHeight, linkMode, {
      enabled: input.enableTwoOpt !== false,
      maxPathCount: input.twoOptMaxPathCount,
      maxIterations: input.twoOptMaxIterations,
    });
    ordered.push(...result.ordered);
    reversedPathIds.push(...result.reversedPathIds);
    rotatedClosedLoopCount += result.rotatedClosedLoopCount;
    twoOptImprovementCount += result.twoOptImprovementCount;
    current = result.endPosition;
  }

  return {
    paths: ordered,
    reversedPathIds,
    summary: {
      inputPathCount: sourcePaths.length,
      outputPathCount: ordered.length,
      reversedCount: reversedPathIds.length,
      rotatedClosedLoopCount,
      twoOptImprovementCount,
      travelBefore: pathTravelDistance(validSourcePaths, startPosition, safeHeight, linkMode),
      travelAfter: pathTravelDistance(ordered, startPosition, safeHeight, linkMode),
    },
    warnings,
  };
}

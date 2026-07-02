export type CamPoint3 = [number, number, number];
export type CamProjectionMode = 'xy' | 'xz' | 'yz' | 'xyz';

export type CamBounds3 = {
  min: CamPoint3;
  max: CamPoint3;
};

export type CamTriangleInput =
  | [CamPoint3, CamPoint3, CamPoint3]
  | {
    id?: number;
    a?: CamPoint3;
    b?: CamPoint3;
    c?: CamPoint3;
    bounds?: CamBounds3;
  };

export type CamTriangleIndexOptions = {
  bucketSize?: number;
  maxDepth?: number;
  minExtent?: number;
};

export type CamTriangleIndexFallbackOptions = CamTriangleIndexOptions & {
  smallMeshFallbackLimit?: number;
};

export type CamTriangleSpatialIndex = {
  queryAabb(queryBounds: CamBounds3, mode?: CamProjectionMode): number[];
  stats(): {
    triangleCount: number;
    nodeCount: number;
    leafCount: number;
    maxDepth: number;
    implementation: string;
  };
};

type IndexedTriangle = {
  id: number;
  a: CamPoint3;
  b: CamPoint3;
  c: CamPoint3;
  bounds: CamBounds3;
  centroid: CamPoint3;
};

type IndexNode = {
  bounds: CamBounds3;
  depth: number;
  triangleIds?: number[];
  left?: IndexNode;
  right?: IndexNode;
};

const AXES_BY_MODE: Record<CamProjectionMode, number[]> = {
  xy: [0, 1],
  xz: [0, 2],
  yz: [1, 2],
  xyz: [0, 1, 2],
};

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isFinitePoint(point: any) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function clonePoint(point: CamPoint3): CamPoint3 {
  return [
    finiteNumber(point[0], 0),
    finiteNumber(point[1], 0),
    finiteNumber(point[2], 0),
  ];
}

function emptyBounds(): CamBounds3 {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function cloneBounds(bounds: CamBounds3): CamBounds3 {
  return {
    min: clonePoint(bounds.min),
    max: clonePoint(bounds.max),
  };
}

function expandBoundsByPoint(bounds: CamBounds3, point: CamPoint3) {
  for (let axis = 0; axis < 3; axis += 1) {
    if (point[axis] < bounds.min[axis]) bounds.min[axis] = point[axis];
    if (point[axis] > bounds.max[axis]) bounds.max[axis] = point[axis];
  }
}

function expandBoundsByBounds(bounds: CamBounds3, other: CamBounds3) {
  expandBoundsByPoint(bounds, other.min);
  expandBoundsByPoint(bounds, other.max);
}

function boundsAreFinite(bounds: CamBounds3 | null | undefined) {
  return isFinitePoint(bounds?.min) && isFinitePoint(bounds?.max);
}

function normalizeBounds(bounds: CamBounds3): CamBounds3 {
  const min = clonePoint(bounds.min);
  const max = clonePoint(bounds.max);
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis] <= max[axis]) continue;
    const tmp = min[axis];
    min[axis] = max[axis];
    max[axis] = tmp;
  }
  return { min, max };
}

function triangleBounds(a: CamPoint3, b: CamPoint3, c: CamPoint3) {
  const bounds = emptyBounds();
  expandBoundsByPoint(bounds, a);
  expandBoundsByPoint(bounds, b);
  expandBoundsByPoint(bounds, c);
  return bounds;
}

function triangleCentroid(a: CamPoint3, b: CamPoint3, c: CamPoint3): CamPoint3 {
  return [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
}

function normalizeTriangle(raw: CamTriangleInput, fallbackId: number): IndexedTriangle | null {
  const source: any = raw;
  const a = Array.isArray(source) ? source[0] : source?.a;
  const b = Array.isArray(source) ? source[1] : source?.b;
  const c = Array.isArray(source) ? source[2] : source?.c;
  if (!isFinitePoint(a) || !isFinitePoint(b) || !isFinitePoint(c)) return null;
  const pa = clonePoint(a);
  const pb = clonePoint(b);
  const pc = clonePoint(c);
  const rawId = Array.isArray(source) ? fallbackId : source?.id;
  const id = Number.isInteger(Number(rawId)) ? Math.trunc(Number(rawId)) : fallbackId;
  const rawBounds = !Array.isArray(source) && boundsAreFinite(source?.bounds)
    ? normalizeBounds(source.bounds)
    : triangleBounds(pa, pb, pc);
  return {
    id,
    a: pa,
    b: pb,
    c: pc,
    bounds: rawBounds,
    centroid: triangleCentroid(pa, pb, pc),
  };
}

function projectionAxes(mode: CamProjectionMode) {
  return AXES_BY_MODE[mode] || AXES_BY_MODE.xyz;
}

function boundsOverlapProjected(a: CamBounds3, b: CamBounds3, mode: CamProjectionMode) {
  for (const axis of projectionAxes(mode)) {
    if (a.max[axis] < b.min[axis] || a.min[axis] > b.max[axis]) return false;
  }
  return true;
}

function boundsExtent(bounds: CamBounds3, axis: number) {
  return Math.max(0, bounds.max[axis] - bounds.min[axis]);
}

function longestBoundsAxis(bounds: CamBounds3) {
  const extents = [boundsExtent(bounds, 0), boundsExtent(bounds, 1), boundsExtent(bounds, 2)];
  if (extents[1] > extents[0] && extents[1] >= extents[2]) return 1;
  if (extents[2] > extents[0] && extents[2] > extents[1]) return 2;
  return 0;
}

function buildCombinedBounds(ids: number[], trianglesById: Map<number, IndexedTriangle>) {
  const bounds = emptyBounds();
  for (const id of ids) {
    const triangle = trianglesById.get(id);
    if (triangle) expandBoundsByBounds(bounds, triangle.bounds);
  }
  return normalizeBounds(bounds);
}

function maxBoundsExtent(bounds: CamBounds3) {
  return Math.max(boundsExtent(bounds, 0), boundsExtent(bounds, 1), boundsExtent(bounds, 2));
}

function positiveFiniteOption(value: any, fallback: number, label: string) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`CAM triangle spatial index ${label} must be a positive finite number.`);
  }
  return num;
}

function nonNegativeFiniteOption(value: any, fallback: number, label: string) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`CAM triangle spatial index ${label} must be a non-negative finite number.`);
  }
  return num;
}

export function queryCamTriangleAabbBruteForce(
  trianglesInput: CamTriangleInput[],
  queryBounds: CamBounds3,
  mode: CamProjectionMode = 'xyz',
) {
  if (!boundsAreFinite(queryBounds)) return [];
  const bounds = normalizeBounds(queryBounds);
  const out: number[] = [];
  const seen = new Set<number>();
  const triangles = normalizeCamTriangles(trianglesInput);
  for (const triangle of triangles) {
    if (!boundsOverlapProjected(triangle.bounds, bounds, mode)) continue;
    if (seen.has(triangle.id)) continue;
    seen.add(triangle.id);
    out.push(triangle.id);
  }
  return out.sort((a, b) => a - b);
}

export function normalizeCamTriangles(trianglesInput: CamTriangleInput[]) {
  const out: IndexedTriangle[] = [];
  const usedIds = new Set<number>();
  const list = Array.isArray(trianglesInput) ? trianglesInput : [];
  for (let index = 0; index < list.length; index += 1) {
    const triangle = normalizeTriangle(list[index], index);
    if (!triangle) continue;
    let id = triangle.id;
    while (usedIds.has(id)) id += 1;
    usedIds.add(id);
    out.push({ ...triangle, id });
  }
  return out.sort((a, b) => a.id - b.id);
}

export function buildCamTriangleSpatialIndex(
  trianglesInput: CamTriangleInput[],
  options: CamTriangleIndexOptions = {},
) : CamTriangleSpatialIndex {
  const triangles = normalizeCamTriangles(trianglesInput);
  const trianglesById = new Map(triangles.map((triangle) => [triangle.id, triangle]));
  const bucketSize = Math.max(1, Math.min(256, Math.round(positiveFiniteOption(options.bucketSize, 16, 'bucketSize'))));
  const maxDepth = Math.max(1, Math.min(64, Math.round(positiveFiniteOption(options.maxDepth, 32, 'maxDepth'))));
  const minExtent = Math.max(0, nonNegativeFiniteOption(options.minExtent, 1e-9, 'minExtent'));
  let nodeCount = 0;
  let leafCount = 0;
  let observedMaxDepth = 0;

  const buildNode = (idsInput: number[], depth: number): IndexNode => {
    const ids = idsInput.slice().sort((a, b) => a - b);
    const bounds = buildCombinedBounds(ids, trianglesById);
    nodeCount += 1;
    observedMaxDepth = Math.max(observedMaxDepth, depth);

    if (ids.length <= bucketSize || depth >= maxDepth || maxBoundsExtent(bounds) <= minExtent) {
      leafCount += 1;
      return { bounds, depth, triangleIds: ids };
    }

    const axis = longestBoundsAxis(bounds);
    const sorted = ids.slice().sort((a, b) => {
      const ta = trianglesById.get(a);
      const tb = trianglesById.get(b);
      const ca = ta?.centroid?.[axis] ?? 0;
      const cb = tb?.centroid?.[axis] ?? 0;
      if (ca !== cb) return ca - cb;
      return a - b;
    });
    const mid = Math.max(1, Math.min(sorted.length - 1, Math.floor(sorted.length / 2)));
    const leftIds = sorted.slice(0, mid);
    const rightIds = sorted.slice(mid);
    if (!leftIds.length || !rightIds.length) {
      leafCount += 1;
      return { bounds, depth, triangleIds: ids };
    }
    return {
      bounds,
      depth,
      left: buildNode(leftIds, depth + 1),
      right: buildNode(rightIds, depth + 1),
    };
  };

  const root = triangles.length ? buildNode(triangles.map((triangle) => triangle.id), 0) : null;

  const queryAabb = (queryBounds: CamBounds3, mode: CamProjectionMode = 'xyz') => {
    if (!root || !boundsAreFinite(queryBounds)) return [];
    const normalizedQuery = normalizeBounds(queryBounds);
    const out: number[] = [];
    const seen = new Set<number>();
    const visit = (node: IndexNode | undefined) => {
      if (!node || !boundsOverlapProjected(node.bounds, normalizedQuery, mode)) return;
      if (Array.isArray(node.triangleIds)) {
        for (const id of node.triangleIds) {
          if (seen.has(id)) continue;
          const triangle = trianglesById.get(id);
          if (!triangle || !boundsOverlapProjected(triangle.bounds, normalizedQuery, mode)) continue;
          seen.add(id);
          out.push(id);
        }
        return;
      }
      visit(node.left);
      visit(node.right);
    };
    visit(root);
    return out.sort((a, b) => a - b);
  };

  return {
    queryAabb,
    stats() {
      return {
        triangleCount: triangles.length,
        nodeCount,
        leafCount,
        maxDepth: observedMaxDepth,
        implementation: 'cam-aabb-tree',
      };
    },
  };
}

export function buildCamTriangleSpatialIndexWithFallback(
  trianglesInput: CamTriangleInput[],
  options: CamTriangleIndexFallbackOptions = {},
): { index: CamTriangleSpatialIndex | null; warnings: string[]; triangleCount: number } {
  const { smallMeshFallbackLimit, ...indexOptions } = options;
  const triangles = normalizeCamTriangles(trianglesInput);
  try {
    return {
      index: buildCamTriangleSpatialIndex(triangles, indexOptions),
      warnings: [],
      triangleCount: triangles.length,
    };
  } catch (error) {
    const limit = Math.max(0, Math.floor(finiteNumber(smallMeshFallbackLimit, 256)));
    const message = error instanceof Error ? error.message : String(error);
    if (triangles.length <= limit) {
      return {
        index: null,
        warnings: [
          `Triangle spatial index build failed; using brute-force triangle queries for ${triangles.length} triangle${triangles.length === 1 ? '' : 's'}. Cause: ${message}`,
        ],
        triangleCount: triangles.length,
      };
    }
    throw new Error(`Triangle spatial index build failed for ${triangles.length} triangles: ${message}`);
  }
}

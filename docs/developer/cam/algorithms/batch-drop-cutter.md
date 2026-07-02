# Batch Drop Cutter

This spec defines batch processing for many point drop-cutter evaluations.

## Purpose

Batch drop-cutter projects many cutter-location points onto a target mesh using shared spatial indexing, chunked worker progress, and deterministic output ordering.

## Dependencies

- [Point Drop Cutter](./point-drop-cutter.md)
- [Triangle Spatial Index](./triangle-spatial-index.md)

## Inputs

```ts
type BatchDropInput = {
  points: CamCLPoint[];
  cutter: CamCutter;
  triangles: CamTriangle[];
  floorZ: number;
  index?: CamTriangleIndex;
  chunkSize?: number;
  onProgress?: (progress: CamProgress) => void;
  progressYield?: () => Promise<void> | void;
};
```

## Output

```ts
type BatchDropOutput = {
  points: CamCLPoint[];
  summary: {
    pointCount: number;
    candidateCount: number;
    contactCount: number;
    warningCount: number;
  };
  warnings: string[];
};
```

## Algorithm

1. Validate input points.
2. Build or reuse a triangle index in `xy` projection mode.
3. Choose a chunk size:
   - Use explicit `chunkSize` if supplied.
   - Otherwise choose a size targeting 5-20 ms per chunk.
4. For each chunk:
   - Run point drop-cutter for each point in original order.
   - Append outputs at their original indices.
   - Accumulate candidate/contact counts.
   - Emit progress with completed point count.
   - Await `progressYield`.
5. Return ordered projected points.

## Determinism

- Output point order exactly matches input point order.
- Warnings should include point index/path id where possible.
- If a point is duplicated, evaluate independently unless an explicit cache is added.

## Optional Cache

A point-result cache may be used when:

- XY and floor Z match within tolerance.
- Cutter and target mesh hash match.
- Cache key includes cutter shape and dimensions.

The cache must not alter output ordering.

## Progress Phases

- `batch-drop-prepare`
- `batch-drop-index`
- `batch-drop-points`
- `batch-drop-complete`

## Failure Behavior

- Empty point list returns empty output and no error.
- Empty triangle list is a generation-stopping error when called by a machining strategy.
- Index build failure may fall back to brute force only for small triangle counts.

## Tests

- Batch output equals repeated point-drop output.
- Output order matches input order.
- Progress advances for multi-chunk inputs.
- Empty point list succeeds.
- Brute-force fallback and indexed mode match on small fixtures.

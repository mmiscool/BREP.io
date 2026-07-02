# Batch Push Cutter

This spec defines chunked push-cutter processing for many same-direction fibers.

## Purpose

Batch push-cutter evaluates many fibers against one target mesh and cutter while sharing spatial indexing and worker progress.

## Dependencies

- [Fiber Push Cutter](./fiber-push-cutter.md)
- [Triangle Spatial Index](./triangle-spatial-index.md)

## Inputs

```ts
type BatchPushInput = {
  fibers: CamFiber[];
  direction: "x" | "y";
  cutter: CamCutter;
  triangles: CamTriangle[];
  index?: CamTriangleIndex;
  chunkSize?: number;
  onProgress?: (progress: CamProgress) => void;
  progressYield?: () => Promise<void> | void;
};
```

## Output

```ts
type BatchPushOutput = {
  fibers: CamFiber[];
  summary: {
    fiberCount: number;
    intervalCount: number;
    candidateCount: number;
    warningCount: number;
  };
  warnings: string[];
};
```

## Algorithm

1. Validate every fiber has the requested direction.
2. Build or reuse triangle index:
   - X-fiber batch prefers `yz` projection.
   - Y-fiber batch prefers `xz` projection.
3. Choose chunk size.
4. For every chunk:
   - Run fiber push-cutter on each fiber.
   - Preserve input order.
   - Accumulate interval/candidate counts.
   - Emit progress.
   - Await `progressYield`.
5. Return fibers with sorted intervals.

## Progress Phases

- `batch-push-prepare`
- `batch-push-index`
- `batch-push-fibers`
- `batch-push-complete`

## Determinism

- Output fiber order matches input.
- Intervals sorted by lower parameter.
- Equal interval endpoints sorted by upper parameter then contact type.

## Tests

- Batch result equals repeated single-fiber push result.
- X and Y batches use different projection modes.
- Progress advances across chunks.
- Empty fiber list returns empty output.
- Indexed and brute-force modes produce equivalent intervals on small fixtures.

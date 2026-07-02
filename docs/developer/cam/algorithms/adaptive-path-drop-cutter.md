# Adaptive Path Drop Cutter

This spec defines adaptive projection of source paths onto a mesh.

## Purpose

Adaptive path drop-cutter adds samples only where the projected cutter-location curve changes enough to need them. This provides smoother 3D finishing paths without globally tiny sample spacing.

## Dependencies

- [Line and Arc Path Spans](./line-arc-path-spans.md)
- [Point Drop Cutter](./point-drop-cutter.md)
- [Batch Drop Cutter](./batch-drop-cutter.md)

## Inputs

```ts
type AdaptivePathDropInput = {
  targetSelection: CamTargetSelection;
  paths: Array<{ id: string; spans: SerializedCamSpan[] }>;
  cutter: CamCutter;
  triangles: CamTriangle[];
  driveFaceRegions?: CamFaceRegion[];
  sampleSpacing: number;
  minSampleSpacing: number;
  flatnessCosLimit: number;
  floorZ: number;
  maxDepth?: number;
};
```

## Output

Same output shape as uniform path drop-cutter, with extra summary fields:

- `acceptedIntervalCount`
- `subdivisionCount`
- `maxObservedDepth`

## Algorithm

Use an explicit stack rather than recursive calls.

For each span:

1. Drop `pointAt(0)` and `pointAt(1)`.
2. Push interval `{ t0: 0, t1: 1, p0, p1, depth: 0 }`.
3. While stack is not empty:
   - Pop interval.
   - Compute `tmid = (t0 + t1) / 2`.
   - Drop `pointAt(tmid)`.
   - Compute projected chord length between `p0` and `p1`.
   - Compute flatness using vectors `p0 -> pmid` and `pmid -> p1`.
   - Subdivide if:
     - chord length is greater than `sampleSpacing`, or
     - not flat and chord length is greater than `minSampleSpacing`.
   - Also subdivide if span parameter length is large but projected chord collapses due to steep geometry, using a source-span distance guard.
   - If subdividing and `depth < maxDepth`, push right then left intervals for stable output order.
   - Otherwise accept interval endpoint `p1`.
4. Emit the span start point once, then accepted endpoints in order.

## Face-Selected Projection

- `driveFaceRegions` may constrain which source paths are generated or accepted for finishing.
- Point drops always query the full protected target mesh supplied in `triangles`.
- The selected face can be the intended contact surface, but the cutter must not penetrate adjacent faces or any other part of the target solid.
- If all samples for a selected face fail safety checks, return a generation error instead of a blank path.

## Flatness Predicate

- Normalize vectors `p0 -> pmid` and `pmid -> p1`.
- If either vector length is below tolerance, treat as flat only if source interval length is also below tolerance.
- Flat if dot product >= `flatnessCosLimit`.
- Default `flatnessCosLimit` should be high, for example `0.999`.

## Termination

Stop subdividing when any is true:

- Projected chord length <= `minSampleSpacing`.
- Source interval length <= `minSampleSpacing`.
- `depth >= maxDepth`.

If max depth is reached while still not flat, emit warning and accept the interval to avoid hanging.

## Performance

- Reuse the same triangle index for every point drop.
- Optional point cache key: `spanId + rounded(t)`.
- Yield after a configurable number of dropped midpoint evaluations.

## Progress Phases

- `adaptive-path-start`
- `adaptive-path-sample`
- `adaptive-path-drop`
- `adaptive-path-complete`

Detailed diagnostic phases may also be emitted:

- `adaptive-path-index`
- `adaptive-path-span`
- `adaptive-path-subdivide`

## Tests

- Planar horizontal path produces only endpoints when sample spacing permits.
- Sloped or curved mesh produces inserted midpoint samples.
- Smaller `flatnessCosLimit` produces fewer points than larger limit.
- Max depth warning fires on a pathological non-flat fixture.
- Output point order follows source path direction.
- Face-selected projection protects the owning solid outside the selected faces.

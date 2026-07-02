# Adaptive Waterline

This spec defines adaptive fiber placement for waterline loop generation.

## Purpose

Adaptive waterline reduces unnecessary fibers in simple regions while adding detail near changing interval topology or curved/sloped geometry.

## Dependencies

- [Fiber Push Cutter](./fiber-push-cutter.md)
- [Weave Loop Reconstruction](./weave-loop-reconstruction.md)
- [Waterline Contour Loops](./waterline-contour-loops.md)

## Inputs

Same as uniform waterline, plus:

- `minSampling`
- `flatnessCosLimit`
- `maxDepth`

## Algorithm Overview

For each Z level:

1. Build start and stop X-fibers at min/max Y.
2. Build start and stop Y-fibers at min/max X.
3. Push start/stop fibers.
4. Recursively or iteratively sample midpoint fibers.
5. Accept intervals when spacing and flatness criteria pass.
6. Sort accepted fibers.
7. Run weave loop reconstruction.

## Adaptive Fiber Sampling

Use an explicit stack:

```ts
type FiberIntervalTask = {
  coord0: number;
  coord1: number;
  fiber0: CamFiber;
  fiber1: CamFiber;
  depth: number;
};
```

For each task:

1. Compute midpoint coordinate.
2. Create and push midpoint fiber.
3. Compare `fiber0`, `midFiber`, and `fiber1`.
4. Subdivide if:
   - spacing > `sampling`, or
   - interval counts differ, or
   - interval endpoints are not flat and spacing > `minSampling`.
5. If not subdividing, accept `fiber1`.

## Fiber Flatness

Fibers are considered flat enough when:

- All three fibers have the same interval count.
- Corresponding intervals can be paired by sorted order.
- For every paired lower endpoint and upper endpoint:
  - Construct points on each fiber.
  - Compute dot product between start-mid and mid-stop vectors.
  - Require dot >= `flatnessCosLimit`.

If interval count differs, subdivision is required because topology may be changing.

## Face-Selected Regions

- Selected faces may restrict the drive region for finishing passes at each Z level.
- Fiber intervals and link safety checks must still use the full protected target mesh.
- If selected faces produce no closed loops at a level, report that level as empty with operation feedback.

## Termination

Stop subdividing when:

- coordinate spacing <= `minSampling`, or
- depth >= `maxDepth`.

If termination happens while topology still differs, keep all accepted fibers and emit a warning for that Z level.

## Output

Same as uniform waterline, with extra summary:

- X fiber count.
- Y fiber count.
- Subdivision count.
- Max depth reached.

## Progress Phases

- `adaptive-waterline-level`
- `adaptive-waterline-sample-x`
- `adaptive-waterline-sample-y`
- `adaptive-waterline-weave`
- `adaptive-waterline-link`

## Tests

- A rectangular block uses fewer fibers than uniform sampling at the same max spacing.
- A sloped side triggers extra fibers near topology/detail changes.
- Differing interval counts force subdivision.
- Max-depth warning is deterministic.
- Accepted fibers are sorted before weave.

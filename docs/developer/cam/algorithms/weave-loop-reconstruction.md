# Weave Loop Reconstruction

This spec defines reconstruction of closed loops from X/Y push-cutter interval fibers.

## Purpose

Push-cutter produces blocked intervals on X and Y fibers. Weave reconstruction converts those sampled interval boundaries into closed cutter-location loops.

## Dependencies

- [Fiber Push Cutter](./fiber-push-cutter.md)
- [Shared CAM Data Models](./shared-cam-data-models.md)

## Inputs

```ts
type WeaveInput = {
  xFibers: CamFiber[];
  yFibers: CamFiber[];
  z: number;
  tolerance: CamTolerance;
};
```

## Output

```ts
type WeaveOutput = {
  loops: CamPoint3[][];
  graphStats: {
    clVertexCount: number;
    intersectionVertexCount: number;
    edgeCount: number;
    rejectedLoopCount: number;
  };
  warnings: string[];
};
```

## Graph Model

Vertex types:

- `cl`: interval endpoint.
- `intersection`: crossing of an X interval and Y interval.

Directed edge:

- `from`, `to`.
- `twin`.
- `next`.
- `visited`.
- Geometry segment.

## Algorithm

1. Normalize fibers:
   - Remove empty intervals.
   - Sort X fibers by Y.
   - Sort Y fibers by X.
   - Sort intervals along each fiber.
2. Create CL vertices for every interval endpoint.
3. Create initial directed edges along each interval between its endpoints.
4. For each X interval and candidate Y interval:
   - Detect crossing in XY.
   - Create intersection vertex at crossing.
   - Split existing X and Y interval edges at that vertex.
5. For every vertex, sort outgoing edges by polar angle.
6. Assign `next` for each directed edge as the previous angular edge of its twin, producing face traversal.
7. Traverse every unvisited directed edge:
   - Follow `next` until returning to start or failing.
   - Convert closed cycles to loops.
8. Reject loops:
   - fewer than 3 unique points,
   - area below tolerance,
   - self-intersecting,
   - exterior unbounded face.
9. Sort loops by absolute area descending.

## Candidate Pair Optimization

Naive X/Y interval comparison is expensive. Use one of:

- Sweep line over sorted fiber coordinates.
- Spatial hash of interval bounding boxes.
- Indexed interval ranges per fiber coordinate.

Correctness is more important than first-pass speed; start simple for tests if needed.

## Loop Orientation and Classification

- Compute signed area in XY.
- Keep orientation deterministic.
- Use containment tests to classify holes.
- Return enough metadata for outside/inside cutting to choose protected regions.

## Failure Feedback

- Open graph traversal emits warning and skips that component.
- Self-intersecting loop emits warning and is skipped.
- Excessive graph size emits progress detail and may switch to a memory-safer algorithm.

## Tests

- Four fibers forming a square produce one loop.
- A square with a hole produces two loops with containment classification.
- Duplicate interval endpoints are merged.
- Open interval graph reports warning.
- Loop output is deterministic for shuffled input fibers.

# Cutter-Location Line Filter

This spec defines reduction of redundant cutter-location points.

## Purpose

Adaptive and uniform sampling can produce many nearly-collinear points. The line filter reduces output size without changing path shape beyond tolerance.

## Inputs

```ts
type CLFilterInput = {
  points: CamPoint3[];
  tolerance: number;
  preserveIndices?: Set<number>;
  closed?: boolean;
};
```

## Output

- Filtered point array.
- Mapping from output points to original indices.
- Summary count of removed points.

## Algorithm

1. Validate tolerance.
2. If fewer than 3 points, return unchanged.
3. Mark first and last points as preserved.
4. Add any caller-specified preserved indices.
5. Walk through points with an anchor:
   - Try extending the chord from anchor to candidate.
   - Measure every intermediate point's distance to the chord.
   - If all distances <= tolerance and no preserved point would be removed, keep extending.
   - If tolerance is exceeded, emit the previous point and make it the new anchor.
6. Emit final point.
7. For closed loops, ensure final closure remains valid or reclose explicitly.

## Distance Metric

- Use 3D distance to chord for surface-following paths.
- Allow 2D-only mode only for constant-Z waterline loops.
- Distance to a zero-length chord is point distance to anchor.

## Preservation Rules

Never filter across:

- Path boundaries.
- Move-kind boundaries.
- Feed-rate changes.
- Plunge/cut/retract transitions.
- Slider snap points when high-fidelity simulation is selected.

## Tests

- Five collinear points reduce to endpoints.
- A point outside tolerance is retained.
- A preserved midpoint is retained even if collinear.
- Closed loop remains closed.
- Filtering separate paths independently does not merge endpoints.

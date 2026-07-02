# Uniform Path Drop Cutter

This spec defines fixed-spacing projection of line and arc paths onto a mesh.

## Purpose

Uniform path drop-cutter samples source paths at predictable intervals and runs batch drop-cutter on those samples. It is simpler than adaptive projection and useful for debugging, deterministic tests, and coarse previews.

## Dependencies

- [Line and Arc Path Spans](./line-arc-path-spans.md)
- [Batch Drop Cutter](./batch-drop-cutter.md)

## Inputs

```ts
type UniformPathDropInput = {
  paths: Array<{ id: string; spans: SerializedCamSpan[] }>;
  cutter: CamCutter;
  triangles: CamTriangle[];
  sampleSpacing: number;
  floorZ: number;
  preserveSpanBoundaries?: boolean;
};
```

## Output

```ts
type UniformPathDropOutput = {
  paths: Array<{
    id: string;
    points: CamCLPoint[];
    sourceSpanIds: string[];
  }>;
  warnings: string[];
  summary: {
    sourcePathCount: number;
    spanCount: number;
    sampleCount: number;
  };
};
```

## Algorithm

1. Validate `sampleSpacing > 0`.
2. Deserialize spans.
3. For each source path:
   - Initialize an empty sample list.
   - For each span:
     - Compute `steps = max(1, ceil(span.length2d() / sampleSpacing))`.
     - Sample `span.pointAt(i / steps)` for `i = 0..steps`.
     - Initialize sample Z to `floorZ`.
     - Avoid duplicating the previous span endpoint unless preserving span boundary.
   - Store mapping from samples to span ids.
4. Flatten all samples for batch drop-cutter.
5. Run batch drop-cutter once for all samples.
6. Re-split projected points back into source paths.

## Boundary Rules

- Preserve path boundaries.
- Preserve first and last point of every source path.
- If a span is degenerate, skip it and warn.
- If all spans in a path are degenerate, return no generated path for that source path.

## Progress Phases

- `uniform-path-sample`
- `uniform-path-drop`
- `uniform-path-rebuild`

## Tests

- A line of length 10 with sample spacing 2 emits 6 samples including endpoints.
- Arc samples remain on the source circle before projection.
- Adjacent spans do not duplicate shared endpoints by default.
- Projected path retains source path ids.
- Degenerate span warning is deterministic.

# Parallel Finish Strategies

This spec defines the selected one-way zig and bidirectional zig-zag finishing strategies.

## Purpose

Parallel finishing generates source passes across a machining region, projects them onto the target surface with path drop-cutter, and links the resulting paths safely.

## Dependencies

- [Line and Arc Path Spans](./line-arc-path-spans.md)
- [Adaptive Path Drop Cutter](./adaptive-path-drop-cutter.md)
- [Loop and Path Ordering](./loop-and-path-ordering.md)

## Inputs

```ts
type ParallelFinishInput = {
  targetSelection: CamTargetSelection;
  targetBounds: CamBounds3;
  targetTriangles: CamTriangle[];
  driveFaceRegions?: CamFaceRegion[];
  protectedRegions?: CamProtectedRegion[];
  cutter: CamCutter;
  strategy: "parallel-zig" | "parallel-zig-zag";
  rasterAxis?: "X" | "Y";
  rasterAngleDeg?: number;
  stepover: number;
  cutRegion: "inside" | "outside";
  stockAllowance: number;
  sampleSpacing: number;
  minSampleSpacing: number;
  flatnessCosLimit: number;
  linkMode: "retract" | "low-hop" | "feed-link";
};
```

## Region Preparation

1. Compute the machining boundary in machine XY.
2. Apply cutter-radius offset and stock allowance:
   - Outside strategy keeps cutter center outside protected target material.
   - Inside strategy keeps cutter center inside pocket/region boundaries.
3. Expand stock bounds for outside roughing/finishing where needed.
4. Build protected-region checks from mesh sections or 2D loops.

## Face-Selected Finishing

- If `driveFaceRegions` are present, generate source passes from those face regions instead of the whole solid silhouette.
- Clip passes to selected face projections or sampled face boundaries before projection.
- Project every generated pass against the full target solid mesh, not only the drive faces.
- Treat adjacent unselected faces as protected material unless they are included in `driveFaceRegions`.
- If clipping or projection removes all passes for a selected face, return a generation-stopping error with feedback naming the affected operation.

## Pass Generation

For raster axis X:

1. Generate Y coordinates from min Y to max Y by `stepover`.
2. Intersect each scan line with the allowed machining region.
3. Convert each allowed interval into a line span from start X to end X.

For raster axis Y:

1. Generate X coordinates.
2. Intersect each scan line with allowed region.
3. Convert intervals into Y-directed line spans.

For raster angle:

- Build a local 2D basis.
- Generate parallel lines in that basis.
- Transform clipped intervals back to machine XY.

## One-Way Zig

Behavior:

- Every generated pass cuts in the same local direction.
- Between passes, add retract/rapid/plunge segments.
- This is predictable and often safer but has more rapid travel.

Algorithm:

1. Generate clipped pass spans.
2. Sort passes by scan coordinate.
3. Force each pass direction to the selected cutting direction.
4. Project each pass with adaptive path drop-cutter.
5. Link projected passes with selected link mode, falling back to retract.

## Bidirectional Zig-Zag

Behavior:

- Alternate pass direction to reduce rapid travel.
- Every odd pass is reversed unless climb/conventional constraints forbid reversal.

Algorithm:

1. Generate clipped pass spans.
2. Sort passes by scan coordinate.
3. Reverse every alternate pass.
4. Project with adaptive path drop-cutter.
5. Link each pass end to the next pass start.
6. If a safe link cannot be proven, retract and rapid.

## Safe Linking

Link safety checks:

- The swept cutter must not intersect protected target material.
- The tool must maintain at least stock allowance plus tolerance from protected boundaries.
- If the link crosses unknown/uncertain regions, use full retract.

Low-hop:

1. Sample the link segment against protected regions.
2. Determine minimum clearance Z that avoids material.
3. Clamp between local level clearance and full safe height.
4. If no finite clearance exists, retract.

## Output

- Projected `CamToolpathPath[]`.
- Full `CamMotionSegment[]`.
- `summary.pathCount`, `summary.moveCount`, cut length, rapid length.
- Warnings for skipped passes or unsafe links.

## Progress Phases

- `parallel-region`
- `parallel-pass-generate`
- `parallel-project`
- `parallel-link`
- `parallel-complete`

## Tests

- One-way strategy keeps all passes in the same direction.
- Zig-zag alternates direction.
- Pass clipping keeps cutter outside protected target material.
- Face-selected finishing protects adjacent faces and the rest of the owning solid.
- Low-hop falls back to retract when protected region blocks the link.
- Projected path follows sloped target surface.
- Simulation segment list includes all retracts, rapids, plunges, links, and cuts.

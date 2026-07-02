# Waterline Contour Loops

This spec defines uniform waterline contour generation at one or more Z levels.

## Purpose

Waterline contouring generates closed constant-Z cutter-location loops around target geometry. It is the main strategy for going around the part at one depth before stepping down.

## Dependencies

- [Batch Push Cutter](./batch-push-cutter.md)
- [Weave Loop Reconstruction](./weave-loop-reconstruction.md)
- [Loop and Path Ordering](./loop-and-path-ordering.md)

## Inputs

```ts
type WaterlineInput = {
  targetSelection: CamTargetSelection;
  triangles: CamTriangle[];
  driveFaceRegions?: CamFaceRegion[];
  cutter: CamCutter;
  bounds: CamBounds3;
  topZ: number;
  bottomZ: number;
  stepDown: number;
  sampling: number;
  stockAllowance: number;
  cutRegion: "inside" | "outside";
  linkMode: "retract" | "low-hop" | "feed-link";
};
```

## Output

- One or more `CamToolpathPath` loops per Z level.
- Full motion segments.
- Level summaries and warnings.

## Z-Level Generation

1. Clamp `topZ` and `bottomZ` to target/operation bounds.
2. Generate levels from `topZ` down to `bottomZ`.
3. The first generated cutting level should not exceed stock top unless explicitly requested.
4. Last level must include `bottomZ` exactly.
5. Reject `stepDown <= 0`.

## Fiber Generation Per Level

1. Expand XY bounds by at least `2 * cutter.radius + stockAllowance`.
2. Generate X-fibers:
   - fixed Y values from min Y to max Y by `sampling`.
   - start X at expanded min, end X at expanded max.
3. Generate Y-fibers:
   - fixed X values from min X to max X by `sampling`.
   - start Y at expanded min, end Y at expanded max.
4. Fiber Z is current waterline level.

## Loop Extraction

1. Run batch push-cutter for X fibers.
2. Run batch push-cutter for Y fibers.
3. Feed both fiber sets into weave loop reconstruction.
4. Remove loops whose area is below tolerance.
5. Classify outer loops and holes.

## Cutter Compensation and Region

- For outside cutting, loop centerlines must stay outside protected material by cutter radius plus stock allowance.
- For inside cutting, centerlines must stay inside selected pocket material by the same clearance.
- If loops are already cutter-location loops from push-cutter, additional offset must not double-apply compensation.
- Any offset stage must document whether loops represent contact boundary or cutter center boundary.

## Face-Selected Regions

- Selected faces may restrict where finishing loops are emitted.
- Push-cutter interval generation still uses the full target solid mesh.
- Adjacent unselected faces are protected material.
- Empty selected-face levels must be reported in generation feedback.

## Level Ordering

- Complete all paths at one Z level before descending.
- Within a level, use loop/path ordering spec.
- Preserve level order in G-code and simulation.

## Progress Phases

- `waterline-levels`
- `waterline-fibers`
- `waterline-push-x`
- `waterline-push-y`
- `waterline-weave`
- `waterline-link`
- `waterline-complete`

## Tests

- A cube produces one rectangular-ish loop per level.
- A cavity produces inner loops.
- Every level is completed before moving to next level.
- Outside paths do not enter protected target material.
- Face-selected waterline protects adjacent faces and the rest of the owning solid.
- Empty levels are reported but do not crash generation.
- Motion segments include level-to-level linking.

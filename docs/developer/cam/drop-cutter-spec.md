# Drop-Cutter Spec

This document specifies point, batch, uniform path, adaptive path, and parallel finishing behavior for BREP.io CAM.

## Purpose

Drop-cutter projects a cutter-location point or path onto a triangle mesh by lowering the cutter along machine `-Z` until the selected cutter shape first touches the protected target mesh. The result is a safe cutter-location path for 3-axis finishing.

This implementation replaces cross-section-only finishing approximations when a selected strategy requires surface-following toolpaths.

## Inputs

- Target mesh triangles in machine coordinates.
- Cutter definition from [Cutter Shapes Spec](./cutter-shapes-spec.md).
- Target solids and optional selected target faces.
- Full protected target mesh for non-penetration checks.
- Optional stock and avoid regions.
- One or more source paths made from line and arc spans in machine XY.
- Sampling controls:
  - `sampleSpacing`: maximum XY distance between evaluated points.
  - `minSampleSpacing`: minimum subdivision spacing for adaptive sampling.
  - `flatnessCosLimit`: dot-product threshold for path flatness.
  - `floorZ`: fallback minimum Z if the cutter does not contact any triangle.
- Worker progress callback and optional yield hook.

## Outputs

- Cutter-location points `{ x, y, z, contact? }`.
- Path records for the CAM result model.
- Motion segments tagged as `rapid`, `plunge`, `cut`, and `retract`.
- Warnings for invalid geometry, unsupported cutter shape, and numeric failures.
- Summary counts for points sampled, triangles queried, contacts found, and skipped points.

## Point Drop Cutter

Behavior:

- Start with an input cutter-location point `(x, y, floorZ)`.
- Query triangles whose XY bounds overlap the cutter XY envelope.
- For each candidate triangle, compute the lowest cutter-location Z that prevents gouging that triangle.
- Keep the maximum required Z across all candidates.
- Store the contact type that caused the final lift where available.

Contact classes:

- Facet contact: cutter profile tangent to the triangle plane.
- Vertex contact: cutter profile contains a triangle vertex at its XY distance from the cutter axis.
- Edge contact: cutter side/profile tangent to a triangle edge.

Required rules:

- Horizontal facets must be handled exactly.
- Vertical facets must not produce false facet contacts.
- If a triangle is already below the current safe cutter Z, it may be skipped.
- If no triangle contacts, return `floorZ` and a `none` contact marker.
- Contacts must use the selected cutter shape, including ball, bull, cone, and ball-cone profiles.

Failure feedback:

- Empty target mesh: no paths generated; warning says no mesh triangles were found.
- Invalid cutter: generation fails before sampling with a user-facing message.
- Numeric edge-contact failure: keep processing other contacts and add a warning with the point/path id.

## Batch Drop Cutter

Behavior:

- Accept an array of cutter-location points with initial Z set to `floorZ`.
- Build or reuse the shared triangle spatial index.
- Process points in chunks to keep worker progress moving.
- For each point, run point drop-cutter against indexed candidate triangles.

Progress phases:

- `prepare-drop-index`: build spatial index.
- `drop-points`: process point chunks.
- `drop-complete`: report result counts.

Chunking:

- Default chunk size should target roughly 5-20 ms of worker time.
- After each chunk, emit progress and call `progressYield`.
- Do not post one progress event per point.

## Path Spans

Supported source span types:

- Line span from point A to point B.
- Circular arc span with start point, end point, center point, and clockwise/counterclockwise direction.

Contract:

- A span has `length2d()`.
- A span has `pointAt(t)` for `0 <= t <= 1`.
- Span sampling must include both endpoints.
- Degenerate spans shorter than tolerance are skipped with a warning unless they are the only span.

## Uniform Path Drop Cutter

Behavior:

- For each source span, compute `steps = ceil(length2d / sampleSpacing)`.
- Evaluate points at `i / steps` for `i = 0..steps`.
- Initialize each point at `floorZ`.
- Run batch drop-cutter on all sampled points.
- Preserve span/path boundaries so simulation and G-code linking do not merge unrelated moves.

Use cases:

- Predictable debug mode.
- Deterministic tests.
- Coarse preview before adaptive refinement.

## Adaptive Path Drop Cutter

Behavior:

- For each span, evaluate and drop the endpoints.
- Recursively evaluate the midpoint.
- Subdivide when either condition is true:
  - Distance between dropped endpoints exceeds `sampleSpacing`.
  - The three-point polyline is not flat enough and endpoint distance is greater than `minSampleSpacing`.
- A three-point segment is flat when normalized vectors `start->mid` and `mid->end` have dot product greater than `flatnessCosLimit`.
- Add the final endpoint of each accepted interval once.

Termination:

- Stop when XY distance is below `minSampleSpacing`.
- Stop at a configurable maximum recursion depth and emit a warning if hit.
- Reject NaN or infinite dropped points.

Implementation notes:

- Recursive logic may be implemented iteratively with an explicit stack to avoid call-stack limits in browser workers.
- Cache point-drop results by span id and parameter value where useful.
- Preserve path order; do not reorder adaptive samples inside a source span.

Progress phases:

- `adaptive-path-start`: count source paths/spans.
- `adaptive-path-sample`: report accepted sample intervals.
- `adaptive-path-drop`: report point-drop chunks.
- `adaptive-path-complete`: report CL point count.

## Parallel Finish One-Way Zig

Behavior:

- Generate parallel source line paths across a machining region.
- Every pass cuts in the same direction.
- Between passes, retract to safe height, rapid to next pass start, and plunge.
- Project each pass with adaptive path drop-cutter.

Parameters:

- `rasterAxis` or `rasterAngle`.
- `stepover`.
- `boundaryRegion`: stock, silhouette, selected face projection, or explicit sketch in future.
- `cutRegion`: inside/outside.
- `sampleSpacing`, `minSampleSpacing`, `flatnessCosLimit`.
- `safeHeight`, `feedRate`, `plungeRate`.

Required clipping:

- Do not generate cutter centerline inside protected target material for outside finishing.
- Apply cutter radius and stock allowance before projection.
- Passes clipped into multiple intervals should become separate paths unless a safe in-material link is proven.

## Parallel Finish Bidirectional Zig-Zag

Behavior:

- Same as one-way zig, but reverse the cutting direction of every alternate pass.
- Link the end of pass N to the start of pass N+1 with the selected link mode.

Link modes:

- `retract`: always retract to safe height.
- `feed-link`: allow feed link only if collision/stock checks prove the cutter remains safe.
- `low-hop`: retract to a local clearance height rather than full safe height when the segment clears protected material.

Requirements:

- Preserve climb/conventional preference when the cut region and loop orientation make it meaningful.
- If no safe low-hop link exists, fall back to full retract.
- Motion polyline must include every segment so simulation follows the actual path.

## Face-Selected Finishing

- Some finishing operations may define their machining region from selected faces or face groups.
- Selected faces are drive geometry for source path generation, projection regions, and user-visible operation scope.
- The full owning solid mesh remains the protected target mesh for every drop-cutter and collision check.
- The cutter may touch the selected drive face but must not enter the target solid volume.
- Adjacent unselected faces remain protected unless the operation explicitly includes them.
- If a selected face region produces no valid cutter-location points, generation must fail with user-facing feedback instead of producing an empty success.

## Integration With CAM UI

New CAM operations should define strategy values such as:

- `parallel-finish-zig`
- `parallel-finish-zig-zag`
- `surface-follow-path-uniform`
- `surface-follow-path-adaptive`

Surface-following finishing should be explicit so users understand it follows 3D geometry rather than one Z level at a time.

## Tests

Unit tests:

- Point drop on horizontal triangle with flat, ball, bull, cone.
- Point drop near cube side verifies tool radius offset.
- Point drop on sloped triangle returns monotonic Z along an uphill line.
- Empty mesh reports feedback instead of producing blank success.
- Batch drop returns same points as repeated point drop.
- Uniform path samples line and arc endpoints exactly.
- Adaptive path inserts more points on curved/sloped surfaces than on planar surfaces.
- Recursion limit warning is deterministic.

Integration tests:

- Parallel one-way zig over sloped block never enters target mesh.
- Face-selected finishing follows the selected face while protecting adjacent faces and the rest of the solid.
- Bidirectional zig-zag alternates pass direction and reduces rapids.
- Simulation samples include every projected cut segment.
- Worker progress advances during index build and point chunks.

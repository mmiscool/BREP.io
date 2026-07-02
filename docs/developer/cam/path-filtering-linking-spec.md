# Path Filtering And Linking Spec

This document specifies cutter-location filtering, loop/path ordering, path spans, and triangle spatial indexing for BREP.io CAM.

Local BREP.io files to audit before adding new spatial-index code:

- `src/BREP/SolidMethods/meshQueries.ts`
- `src/BREP/triangleUtils.ts`
- Local spatial-hash helpers in `src/features/smoothWithSubdivision/SmoothWithSubdivisionFeature.ts`
- Any kernel/native mesh query utilities exposed through `Solid.getMesh()` or face APIs

## Purpose

These utilities are shared by drop-cutter and waterline strategies. They keep generated programs smaller, reduce unnecessary hopping, preserve simulation fidelity, and make mesh queries fast enough for browser-worker execution.

## Line And Arc Path Spans

Data model:

- `Path` is an ordered list of spans.
- `LineSpan` stores start and end points.
- `ArcSpan` stores start point, end point, center point, and direction.
- Every span exposes:
  - `length2d()`.
  - `pointAt(t)` for `0 <= t <= 1`.
  - stable `id`.

Line span requirements:

- `length2d` is XY length.
- `pointAt(t)` linearly interpolates X, Y, and Z.

Arc span requirements:

- Arc lies in the machine XY plane for the selected scope.
- Z may be constant or linearly interpolated if future use requires helical moves.
- Direction is clockwise/counterclockwise from start to end around center.
- Radius must be finite and non-zero.
- Degenerate arcs are rejected with feedback.

Sampling requirements:

- Sampling must include endpoints.
- Adjacent spans should not duplicate shared endpoints in final CL output unless a move boundary needs it.
- Arc spans can be output as G2/G3 in the future, but selected CAM simulation may initially discretize them.

## Line Cutter-Location Filter

Purpose:

- Remove redundant nearly-collinear CL points while preserving path shape within tolerance.

Input:

- Ordered CL points for one continuous move type.
- Tolerance in model units.

Output:

- Filtered CL points preserving first and last point.

Algorithm contract:

1. Start a new output list with the first point.
2. Consider triples or longer runs of points.
3. If the middle run stays within tolerance of the chord from the current anchor to a candidate future point, keep extending the run.
4. When tolerance is exceeded, emit the last accepted point and start a new run.
5. Always emit the original final point.

Preservation rules:

- Do not filter across path boundaries.
- Do not filter across move kind boundaries.
- Do not filter across feed/plunge/rapid state changes.
- Do not remove points that are slider snap points unless the UI explicitly chooses simplified simulation mode.
- Do not filter closed-loop closure points in a way that opens the loop.

Parameters:

- `filterTolerance`.
- `enableLineFilter`.
- Optional `preserveSimulationSamples`.

Tests:

- Collinear five-point path reduces to two points.
- A point farther than tolerance is preserved.
- Endpoints are always preserved.
- Separate paths are filtered independently.
- Closed loop remains closed.

## Loop And Path Ordering

Purpose:

- Choose the order and direction of generated paths to reduce rapid travel and unnecessary retracts.

First implementation:

- Use deterministic nearest-neighbor ordering with optional 2-opt improvement for moderate path counts.
- Keep a TSP-style approximation as a later optimization.

Ordering inputs:

- Paths or loops with start/end points.
- Current machine position.
- Safe height.
- Cut level.
- Link mode.
- Containment classification for loops and holes.

Ordering rules:

- Preserve required machining order:
  - all paths at one Z level before stepping down when strategy requires low-hop contouring,
  - outer/inner containment ordering for safe material removal,
  - user-selected operation order across CAM history items.
- Within a level, choose nearest safe next path by XY travel distance plus retract/plunge penalty.
- Allow path reversal when strategy and climb/conventional constraints permit it.
- For closed loops, choose the loop start vertex nearest to the previous endpoint.

Link modes:

- `retract`: always retract to full safe height before XY rapid.
- `low-hop`: compute a local clearance height over protected material and use it if safe.
- `feed-link`: keep the tool down only when the swept cutter volume is proven outside protected material.

Collision checks:

- Every link must be checked against protected mesh or protected cross-section stack.
- Face-selected operations still check links against the full protected target solid mesh.
- If uncertain, use full retract.
- Store link segments in `simulation.motionSegments`; do not hide them from preview.

Tests:

- Two paths reverse direction when allowed to reduce travel.
- Loop start rotates to nearest vertex.
- Required Z-level order is preserved.
- Unsafe low-hop falls back to retract.
- Simulation contains every rapid, plunge, feed link, cut, and retract segment.

## Triangle Spatial Index

Purpose:

- Accelerate repeated triangle queries for drop-cutter and push-cutter operations.

Reuse-first requirement:

- Before implementing a new tree, audit the local geometry/kernel utilities for an existing triangle spatial index or broad-phase query helper.
- If an existing utility can query triangles by projected bounds, wrap it behind the `CamTriangleIndex` adapter described below.
- If an existing utility only supports point nearest-neighbor or face enumeration, reuse its extraction helpers where useful but still provide the CAM-specific projected-bounds adapter.
- Do not duplicate an existing triangle AABB/BVH implementation if one is already available and works inside a web worker.

Index structure:

- Implement a bounding-volume tree or KD-like tree over triangle bounds.
- Each triangle stores:
  - vertex positions in machine coordinates,
  - axis-aligned bounding box,
  - optional normal and precomputed edge vectors.
- The tree stores:
  - node bounds,
  - child nodes or triangle indices,
  - split axis,
  - leaf bucket.

Projection modes:

- XY mode for drop-cutter: query triangles whose XY bounds overlap the cutter XY envelope.
- YZ mode for X-fiber push-cutter.
- XZ mode for Y-fiber push-cutter.
- Full XYZ mode for future collision and swept-volume checks.

Build parameters:

- `bucketSize`, default 8-32 triangles for JavaScript.
- `maxDepth`.
- `minExtent`.

Query contract:

- Query returns candidate triangle indices, not guaranteed exact contacts.
- Callers still perform exact overlap/contact tests.
- Query must be deterministic.
- Query must handle empty trees.

Adapter contract:

- `build(triangles, options)` returns an immutable index instance.
- `queryAabb(bounds, projectionMode)` returns candidate triangle indices.
- `stats()` returns node count, leaf count, triangle count, and max depth when available.
- The adapter may delegate to existing local code or to a CAM-specific tree.

Worker and caching:

- Build inside the CAM worker from serialized triangle arrays.
- Reuse per operation where target mesh and projection mode match.
- Invalidate cache when target mesh hash, tool radius envelope, or projection mode changes.

Progress phases:

- `index-build`: build tree.
- `index-query`: optional chunk-level progress for very large batches.

Tests:

- Query result includes all triangles that overlap a known box.
- Query does not miss triangles on split planes.
- Empty tree returns empty candidates.
- XY/YZ/XZ projection modes produce expected candidate sets.
- Spatial index and brute-force query produce the same drop/push results on small fixtures.

## Postprocessing Output Contract

Filtered and ordered paths must preserve:

- `paths` as actual polylines.
- `simulation.samples` for slider snapping.
- `simulation.motionPolyline`.
- `simulation.motionSegments` with move kind.
- `simulation.sweptSegments` for material-removal preview.
- `gcode` move order matching simulation order.

Failure feedback:

- If filtering removes all interior points from a path, keep endpoints and warn only if path length is below tolerance.
- If ordering cannot prove a safe link, use full retract and add no warning.
- If the spatial index build fails, fall back to brute force only for small triangle counts; otherwise fail with a clear progress-dialog message.

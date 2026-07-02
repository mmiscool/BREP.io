# Push-Cutter And Waterline Spec

This document specifies fiber push-cutter, batch push-cutter, waterline, adaptive waterline, and weave loop reconstruction behavior for BREP.io CAM.

## Purpose

Push-cutter algorithms generate constant-Z cutter-location contours. A cutter is pushed along XY fibers at one machine Z level, producing intervals where the cutter would collide with the mesh. X and Y interval samples are woven into closed loops.

This directly supports the requested CAM behavior where the tool goes around the part at one depth before stepping down, reducing side-to-side hopping.

## Inputs

- Target mesh triangles in machine coordinates.
- Cutter definition from [Cutter Shapes Spec](./cutter-shapes-spec.md).
- Target solids and optional selected target faces.
- Full protected target mesh for non-penetration checks.
- Waterline Z level or list of Z levels.
- Sampling controls:
  - `sampling`: maximum fiber spacing.
  - `minSampling`: minimum adaptive fiber spacing.
  - `flatnessCosLimit`: adaptive interval shape tolerance.
- Machining controls:
  - `stepDown`.
  - `stockAllowance`.
  - `cutRegion`: outside/inside.
  - `safeHeight`.
  - `linkMode`.

## Fiber Model

A fiber is a finite XY line segment at constant machine Z:

- X-fiber: varies X, fixed Y and Z.
- Y-fiber: varies Y, fixed X and Z.

Each fiber stores zero or more closed intervals:

- `lowerT` and `upperT` along the fiber.
- Lower and upper contact points when available.
- Contact type: vertex, facet, edge, shaft, or unknown.

Interval semantics:

- Intervals represent cutter centerline ranges that are occupied/blocked by the target mesh at that Z.
- Waterline loops are built from interval boundaries, not interval interiors.
- Overlapping intervals must be merged or consistently nested before weave reconstruction.

## Fiber Push Cutter

Behavior:

- Given one fiber and one cutter, find all parameter intervals where moving the cutter along the fiber would touch or gouge target triangles.
- Query candidate triangles from a spatial index in the plane orthogonal to the fiber direction:
  - X-fiber queries against Y/Z bounds.
  - Y-fiber queries against X/Z bounds.
- For every candidate triangle, evaluate vertex, facet, and edge contacts using the selected cutter profile.
- Add or merge the resulting blocked interval into the fiber.

Contact requirements:

- Vertex push uses `radiusAtHeight(vertex.z - fiber.z)`.
- Horizontal edge push can use an effective cutter radius at edge height.
- Shaft edge push must be considered for all selected cutters with cylindrical upper portions.
- Facet push must ignore horizontal facets because pushing along XY does not encounter a horizontal plane boundary.
- Cone and compound cutters must consider both lower profile and shaft/base contacts.

Failure feedback:

- Missing direction on a fiber batch is a programming error and should fail generation.
- If a triangle contact solve fails, add a warning and continue with other contacts.
- If all fibers are empty at a Z level, return no loops and a level warning only when the user expected material there.

## Batch Push Cutter

Behavior:

- Accept a list of same-direction fibers.
- Build or reuse a spatial index using the correct projection dimensions.
- Process fibers in chunks and yield between chunks in the worker.
- Return fibers with merged intervals and contact metadata.

Progress phases:

- `push-index-x` / `push-index-y`: build or reuse index.
- `push-fibers-x` / `push-fibers-y`: process chunks.
- `push-complete`: report interval counts.

Chunking:

- X and Y batches can run as separate worker tasks but should not block progress reporting.
- In browser JavaScript, use cooperative chunking rather than assuming native thread parallelism.

## Uniform Waterline

Behavior for one Z level:

1. Expand the target XY bounds by at least `2 * cutterRadius` plus stock allowance.
2. Generate X-fibers across the Y range at `sampling` spacing.
3. Generate Y-fibers across the X range at `sampling` spacing.
4. Run batch push-cutter for X and Y fibers.
5. Reconstruct closed loops using the weave graph.
6. Offset or classify loops according to `cutRegion` and stock allowance.
7. Convert loops to ordered `CamToolpathPath` entries at the current Z.

Behavior for multiple levels:

- Generate Z levels from top to bottom using `stepDown`, respecting optional operation top/bottom Z.
- Finish all loops at one Z level before moving to the next lower level.
- Preserve generated level order in simulation and G-code.

## Adaptive Waterline

Behavior:

- Start with boundary fibers for X and Y directions across the expanded target bounds.
- Evaluate midpoint fibers recursively.
- Subdivide when:
  - spacing between boundary fibers exceeds `sampling`, or
  - interval count differs between start/mid/stop fibers, or
  - corresponding interval endpoints are not flat enough, and
  - spacing is still greater than `minSampling`.
- Accept stop fibers when the interval structure is stable and flat enough.

Flatness predicate:

- For matching interval endpoints across start/mid/stop fibers, compute direction vectors through the endpoint coordinates.
- Accept when every checked endpoint has dot product above `flatnessCosLimit`.
- If interval counts differ, treat as not flat and subdivide.

Implementation notes:

- Use an iterative work queue to avoid recursion limits.
- Adaptive X and Y fiber generation can proceed independently.
- Always sort accepted fibers by coordinate before weave reconstruction.

Progress phases:

- `adaptive-waterline-level`: current Z level.
- `adaptive-waterline-sample-x` / `adaptive-waterline-sample-y`: recursive sample queue progress.
- `adaptive-waterline-weave`: graph/loop reconstruction.
- `adaptive-waterline-link`: loop ordering and path construction.

## Weave Graph Loop Reconstruction

Purpose:

- Convert blocked intervals from X and Y fibers into closed cutter-location loops.

Graph concepts:

- CL vertex: interval endpoint on a fiber.
- INT vertex: intersection of an X interval and Y interval.
- Directed half-edge: graph edge with `next`, `previous`, and optional `twin` relation.
- Loop face: closed traversal around a region boundary.

Algorithm target:

1. Add CL vertices for interval endpoints.
2. For every X/Y interval pair that crosses, add an INT vertex.
3. Split the affected interval edges at the INT vertex.
4. Maintain directed adjacency ordered by geometric angle around each vertex.
5. Traverse unvisited directed edges to extract closed faces.
6. Convert faces with valid area into point loops.
7. Remove duplicate, zero-area, and unbounded exterior loops.

Requirements:

- The implementation must produce closed, ordered loops from interval samples.
- It must be deterministic for equal input fibers.
- It must detect and report self-intersecting or non-manifold weave graphs.
- It must tolerate sparse adaptive fibers.

Loop classification:

- Sort loops by absolute area.
- Use winding and containment to classify outer loops and holes.
- For outside cutting, protect material loops and generate cutter centerlines outside them.
- For inside cutting, generate cutter centerlines inside selected pocket loops.
- If waterline is driven by selected faces, use the selected faces to define the drive region while still treating the full owning solid as protected material.

## Integration With CAM

New CAM operations should expose waterline contouring and low-hop contouring as first-class strategies. Low-hop contouring should use loop ordering and safe linking from [Path Filtering and Linking](./path-filtering-linking-spec.md).

Required output shape:

- Paths must be actual polylines in `CamToolpathResult.paths`.
- `simulation.motionSegments` must include every linking and cutting segment.
- Swept volume preview should be based on selected cutter shape, not cube approximations.
- Material-removal preview may use plain meshes rather than BREP topology.

## Worker And Progress Requirements

- Never run waterline generation on part load.
- Start only from explicit user generation.
- Progress should advance for:
  - target mesh extraction,
  - index build,
  - each Z level,
  - X/Y fiber processing,
  - weave reconstruction,
  - loop ordering,
  - result serialization.
- Avoid long single-step work in weave reconstruction; process graph construction and traversal in batches where possible.

## Tests

Unit tests:

- One square prism at one Z level produces one closed outer loop.
- A block with a hole produces outer and inner loops with correct containment.
- X and Y fiber intervals merge deterministically.
- Adaptive waterline uses fewer fibers than uniform on a simple rectangle.
- Adaptive waterline adds fibers near a sloped/curved boundary.
- Weave rejects or reports open interval graphs.

Integration tests:

- `waterline-contour` goes around the part at one level before stepdown.
- Outside contour does not cut target material on sloped surfaces.
- Low-hop linking falls back to retract when unsafe.
- Simulation toolhead follows every generated segment.
- Worker progress does not stall during weave or fiber processing.

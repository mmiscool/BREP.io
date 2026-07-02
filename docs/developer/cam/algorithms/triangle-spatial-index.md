# Triangle Spatial Index

This spec defines the broad-phase triangle query algorithm for CAM operations.

## Purpose

Drop-cutter and push-cutter perform many repeated triangle overlap queries. The index narrows exact contact checks to candidate triangles.

## Reuse-First Requirement

Before adding a new tree implementation:

- Audit existing local geometry/kernel utilities for triangle indexing or broad-phase mesh queries.
- Relevant known locations include:
  - `src/BREP/SolidMethods/meshQueries.ts`
  - `src/BREP/triangleUtils.ts`
  - local spatial-hash helpers in subdivision features
  - any native/kernel mesh query utility reachable from `Solid.getMesh()`
- If existing code can query projected triangle bounds, wrap it behind this adapter.
- If existing code only enumerates faces/triangles or nearest points, reuse extraction pieces but still implement this adapter.

## Adapter Interface

```ts
type CamProjectionMode = "xy" | "xz" | "yz" | "xyz";

type CamTriangleIndex = {
  queryAabb(bounds: CamBounds3, mode: CamProjectionMode): number[];
  stats(): {
    triangleCount: number;
    nodeCount?: number;
    leafCount?: number;
    maxDepth?: number;
    implementation: string;
  };
};
```

## Inputs

- Plain `CamTriangle[]`.
- Options:
  - `bucketSize`, default 16.
  - `maxDepth`, default 32.
  - `minExtent`, default scaled epsilon.
  - `implementation`, default `"auto"`.

## Output

- Immutable index instance.
- Candidate triangle id lists for projected AABB queries.

## Build Algorithm

If no existing reusable index is available:

1. Compute and store each triangle AABB.
2. Create root node containing all triangle ids and combined bounds.
3. If the node has `<= bucketSize` triangles, make it a leaf.
4. Select split axis by largest full 3D extent.
5. Split at median triangle centroid along that axis.
6. If split is empty or unbalanced beyond threshold, split by sorted id midpoint.
7. Recurse until leaf, max depth, or min extent.
8. Store child bounds.

Determinism:

- Sort equal centroids by triangle id.
- Never rely on object insertion order for split decisions.

## Query Algorithm

Input:

- Query bounds.
- Projection mode.

Steps:

1. Convert node and query bounds to projection intervals.
2. If projected node bounds do not overlap query bounds, skip subtree.
3. If leaf, test projected triangle bounds against query bounds and append overlapping ids.
4. If branch, recurse into children in stable order.
5. Return ids sorted ascending or in stable traversal order.

Projection details:

- `xy`: compare X and Y only.
- `xz`: compare X and Z only.
- `yz`: compare Y and Z only.
- `xyz`: compare X, Y, and Z.

## Exactness Contract

- The index must not miss true overlaps.
- False positives are allowed.
- Exact cutter/triangle checks remain the caller's responsibility.

## Worker Integration

- Build inside the CAM worker from serialized triangles.
- Cache by:
  - target mesh hash,
  - projection mode,
  - bucket size,
  - coordinate conversion version.
- Emit progress for large builds:
  - `index-build-start`
  - `index-build-partition`
  - `index-build-complete`

## Fallback

- For small meshes below a configured threshold, brute-force scanning is acceptable.
- For larger meshes, index build failure is generation-stopping unless an existing native query utility can replace it.

## Tests

- Query includes all triangles that overlap a known box in each projection mode.
- Query includes triangles exactly touching the query boundary.
- Query excludes obvious non-overlaps.
- Empty input returns an index whose queries return empty arrays.
- Brute-force and indexed candidate sets match for randomized small fixtures.
- Index build is deterministic for shuffled triangle input after ids are assigned.

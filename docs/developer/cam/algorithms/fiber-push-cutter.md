# Fiber Push Cutter

This spec defines push-cutter evaluation for one fiber.

## Purpose

At a fixed machine Z level, push a cutter along a finite XY fiber and compute intervals where the cutter contacts or violates target mesh triangles.

## Dependencies

- [Cutter Profile Evaluation](./cutter-profile-evaluation.md)
- [Triangle Spatial Index](./triangle-spatial-index.md)

## Inputs

```ts
type CamFiberDirection = "x" | "y";

type CamFiber = {
  id: string;
  direction: CamFiberDirection;
  start: CamPoint3;
  end: CamPoint3;
  intervals: CamFiberInterval[];
};

type FiberPushInput = {
  fiber: CamFiber;
  cutter: CamCutter;
  triangles: CamTriangle[];
  index?: CamTriangleIndex;
};
```

## Output

- The same fiber with merged blocked intervals.
- Contact metadata on interval bounds where available.
- Warnings for numeric contact failures.

## Algorithm

1. Validate fiber direction and constant Z.
2. Build query bounds:
   - X-fiber uses fixed Y/Z plus cutter radius/length envelope.
   - Y-fiber uses fixed X/Z plus cutter radius/length envelope.
3. Query triangle index:
   - X-fiber uses `yz` projection.
   - Y-fiber uses `xz` projection.
4. For each candidate triangle:
   - Compute vertex push contacts.
   - Compute facet push contacts.
   - Compute edge push contacts.
   - Convert valid contacts into interval updates.
5. Merge intervals that overlap within tolerance.
6. Return interval-sorted fiber.

## Vertex Push

1. Compute vertex local height `h = vertex.z - fiber.z`.
2. If `h < 0` or `h > cutter.cuttingLength`, no contact.
3. Get effective cutter radius at `h`.
4. Compute closest point from vertex XY to fiber line.
5. If perpendicular distance is greater than effective radius, no contact.
6. Compute entry/exit parameter along fiber using chord distance.
7. Add interval with vertex contact metadata.

## Facet Push

1. Ignore horizontal facets because pushing in XY does not encounter a horizontal plane boundary.
2. Solve for the cutter contact point on the triangle plane where profile support touches the plane while the cutter reference lies on the fiber.
3. Contact must lie inside the triangle.
4. Fiber parameter must be inside `[0, 1]`.
5. Add zero-width or small interval around contact; interval merge later expands with related contacts.

## Edge Push

Required cases:

- Horizontal edge: use cutter `radiusAtHeight(edge.z - fiber.z)`.
- Shaft edge: use cylindrical shaft radius where edge height is above lower profile.
- General edge: selected cutter shape contact against a sloped edge.

For bull/cone/ball-cone, general edge may use bounded numeric solve. Failures are warnings, not fatal unless all contacts fail.

## Interval Rules

- Parameter `t=0` at fiber start and `t=1` at fiber end.
- Clamp valid interval endpoints to `[0, 1]`.
- Discard intervals whose upper <= lower after tolerance.
- Merge overlapping intervals and retain outermost contact metadata.

## Tests

- A fiber across a cube at mid-height returns one blocked interval.
- A fiber outside the cutter radius returns no intervals.
- Vertex-only contact creates a finite interval.
- Horizontal edge contact uses effective cutter radius.
- X and Y direction queries produce symmetric results on a symmetric fixture.

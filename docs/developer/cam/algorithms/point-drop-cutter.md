# Point Drop Cutter

This spec defines the point drop-cutter algorithm.

## Purpose

Given a cutter positioned at machine XY, find the lowest safe cutter-location Z that does not gouge the target mesh.

## Dependencies

- [Shared CAM Data Models](./shared-cam-data-models.md)
- [Cutter Profile Evaluation](./cutter-profile-evaluation.md)
- [Triangle Spatial Index](./triangle-spatial-index.md)

## Inputs

```ts
type PointDropInput = {
  point: CamCLPoint;          // x/y set, z initialized to floorZ
  cutter: CamCutter;
  triangles: CamTriangle[];
  index?: CamTriangleIndex;
  floorZ: number;
  tolerance: CamTolerance;
};
```

## Output

```ts
type PointDropOutput = {
  point: CamCLPoint;
  candidateCount: number;
  contactCount: number;
  warnings: string[];
};
```

## Algorithm Stages

1. Validate point, cutter, and floor Z.
2. Build the cutter XY query AABB:
   - min X/Y = point X/Y - cutter radius.
   - max X/Y = point X/Y + cutter radius.
   - Z can be unbounded for XY projected search.
3. Query candidates:
   - Use `index.queryAabb(bounds, "xy")` if available.
   - Otherwise use brute-force scan only when allowed by caller.
4. Initialize `safeZ = floorZ`.
5. For every candidate triangle:
   - Skip if projected triangle bounds do not overlap cutter bounds.
   - If triangle is safely below current contact envelope, optional skip.
   - Evaluate facet contact.
   - Evaluate vertex contacts.
   - Evaluate edge contacts.
   - For every valid contact, compute required cutter-location Z.
   - If required Z is higher than `safeZ`, update `safeZ` and contact metadata.
6. Return point with updated Z and winning contact.

## Contact Evaluation

Facet contact:

- Ignore vertical facets for drop contact.
- For horizontal facets, required Z is facet Z minus cutter bottom height at the XY contact.
- For sloped facets, solve the cutter profile tangent to the triangle plane.
- Contact point must lie inside the triangle.

Vertex contact:

- Compute XY radius from cutter axis to vertex.
- If radius is outside cutter max radius, no vertex contact.
- Required Z = vertex Z - `cutter.heightAtRadius(radius)`.

Edge contact:

- Compute closest approach in XY between cutter axis and triangle edge.
- If XY distance is outside cutter max radius, no edge contact.
- Solve the selected cutter profile tangent to the edge.
- Contact point must lie inside the finite edge segment.

## Cutter-Specific Notes

- Flat: edge contact is a cylinder/line tangent problem.
- Ball: edge contact is equivalent to sphere center against edge cylinder.
- Bull: toroidal corner may use bounded numeric solve.
- Cone: evaluate tip, conical side, and base circle.
- Ball-cone: evaluate each active profile segment and select highest valid required Z.

## Failure Behavior

- Invalid contact math for one candidate should add warning and continue.
- If no contacts are found, return input XY and `floorZ` with contact type `none`.
- If all candidate contacts fail due to numeric errors, return `floorZ` and warnings; caller decides whether this is fatal.

## Tests

- Horizontal plane with flat cutter returns plane Z.
- Horizontal plane with ball cutter returns plane Z at the ball tip.
- Sloped triangle produces increasing Z along uphill sample points.
- Point outside cutter radius from a vertex does not contact that vertex.
- Candidate index result and brute-force result are identical on small meshes.
- Numeric failure from one triangle does not stop other triangles from lifting the point.

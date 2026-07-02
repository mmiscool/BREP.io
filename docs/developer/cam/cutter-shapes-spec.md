# Cutter Shapes Spec

This document specifies the selected cutter shape behavior for the BREP.io CAM implementation.

## Coordinate Convention

- CAM geometry uses machine coordinates.
- Current BREP.io conversion in `src/cam/camToolpath.ts` maps scene point `(x, y, z)` to machine point `(X=x, Y=z, Z=y)`.
- Cutter axis is machine `+Z`; the cutter tip/bottom reference is `Z=0` in cutter-local coordinates unless otherwise stated.
- Cutter-location points store the tool reference point. For flat and cone tools, use the physical tip/bottom. For ball and bull tools, use the lowest point of the ball/toroid profile.

## Shared Cutter Interface

Every selected cutter should implement this internal contract:

- `kind`: stable identifier such as `flat`, `ball`, `bull`, `cone`, `ball-cone`.
- `diameter`: maximum cutting diameter in model units.
- `radius`: `diameter / 2`.
- `cuttingLength`: usable cutting height.
- `shaftLength`: optional visualization/collision extension above cutting length.
- `heightAtRadius(r)`: local cutter height above the cutter tip at radial distance `r`.
- `radiusAtHeight(h)`: largest cutting radius at local height `h`.
- `maxRadiusAtHeight(h)`: same as `radiusAtHeight`, clamped to shaft radius for heights above the cutting profile.
- `validate()`: returns user-facing errors for impossible tools.
- `makePreviewMesh(resolution)`: returns a plain mesh for visualization.
- `makeSweptSegmentMesh(start, end)`: returns a plain mesh or hull-like approximation for simulation preview.

Required invariants:

- `diameter > 0`.
- `cuttingLength > 0`.
- `heightAtRadius(0) >= 0`.
- `heightAtRadius(r)` must be finite for all `0 <= r <= radius`.
- `radiusAtHeight(h)` must be finite for `0 <= h <= cuttingLength`.
- For drop-cutter and push-cutter, invalid radius/height input should return no contact rather than throw during generation.

## Flat End Mill

User-facing name: **Flat end mill**.

Parameters:

- `diameter`
- `cuttingLength`
- `shaftLength` for visualization/collision

Profile behavior:

- Bottom is planar.
- `heightAtRadius(r) = 0` for `0 <= r <= radius`.
- `radiusAtHeight(h) = radius` for `0 <= h <= cuttingLength`.
- Contact against a horizontal facet occurs at the cutter bottom plane.
- Contact against a vertex occurs when the vertex XY distance from the cutter axis is within `radius`.
- Contact against a sloped edge uses the higher of the two radial tangent-side contacts.

Implementation notes:

- This is the first cutter to support in every algorithm because it is the baseline milling tool for roughing and contouring.
- Preview mesh can be a cylinder with a separate shaft color/material.
- Swept volume for a linear segment is a capsule-like extrusion of a cylinder with flat end caps at segment endpoints.

Tests:

- A flat cutter dropped onto a horizontal plane returns the plane Z.
- A flat cutter outside a vertical wall does not produce a false facet contact.
- A flat cutter offset by half its diameter from a cube side cuts tangent to the side rather than into the cube.
- `radiusAtHeight` stays constant over the cutting length.

## Ball Nose End Mill

User-facing name: **Ball nose end mill**.

Parameters:

- `diameter`
- `cuttingLength`
- `shaftLength`

Profile behavior:

- Lower profile is a hemisphere with radius `R`.
- `heightAtRadius(r) = R - sqrt(R^2 - r^2)` for `0 <= r <= R`.
- `radiusAtHeight(h) = sqrt(R^2 - (R - h)^2)` for `0 <= h < R`.
- `radiusAtHeight(h) = R` for `h >= R` until the cutting length/shaft limit.
- The ball center is at local height `R`.

Implementation notes:

- Use ball contact for curved 3D finishing, especially adaptive path drop-cutter.
- Edge contact can be formulated as ray/line motion of the ball center against a cylinder around the triangle edge.
- For push-cutter intervals, contact is valid only on the lower hemisphere or shaft range actually represented by the cutter.

Tests:

- Dropping a ball cutter on a plane returns plane Z at the ball tip.
- A ball cutter on a sloped plane yields a smooth Z progression as XY moves.
- `heightAtRadius(R) = R`, `heightAtRadius(0) = 0`.
- `radiusAtHeight(R) = R`.

## Bull Nose Cutter

User-facing name: **Bull nose / corner radius cutter**.

Parameters:

- `diameter`
- `cornerRadius`
- `cuttingLength`
- `shaftLength`

Validation:

- `0 < cornerRadius < radius`.

Profile behavior:

- Let `R = diameter / 2`.
- Let `Rc = cornerRadius`.
- Let `Rflat = R - Rc`.
- `heightAtRadius(r) = 0` for `0 <= r <= Rflat`.
- `heightAtRadius(r) = Rc - sqrt(Rc^2 - (r - Rflat)^2)` for `Rflat < r <= R`.
- `radiusAtHeight(h) = Rflat + sqrt(Rc^2 - (Rc - h)^2)` for `0 <= h < Rc`.
- `radiusAtHeight(h) = R` for `h >= Rc`.

Implementation notes:

- Treat this as a flat center with toroidal corner.
- Edge contact against non-horizontal edges may need a small numeric solve. Specify and implement an independent bounded root-finder if an analytic formulation is not stable enough.
- Use strict iteration caps and return a warning if a contact solve fails to converge.

Tests:

- `cornerRadius` equal to or greater than tool radius is rejected.
- `cornerRadius` near zero is rejected or normalized to a flat cutter only if the UI explicitly allows it.
- A bull cutter with small corner radius approximates a flat cutter in raster output.
- A bull cutter on a sloped plane produces smoother contact than a flat cutter.

## Cone Cutter / V-Bit

User-facing name: **Cone cutter / V-bit**.

Parameters:

- `maximumDiameter`
- `includedAngle` in degrees, converted internally to half-angle
- `cuttingLength`
- `shaftLength`

Validation:

- `maximumDiameter > 0`.
- `0 < includedAngle < 180`.
- Half-angle must be greater than zero and less than 90 degrees.

Profile behavior:

- Let `R = maximumDiameter / 2`.
- Let `A = includedAngle / 2`.
- Cone height at maximum radius is `H = R / tan(A)`.
- `heightAtRadius(r) = r / tan(A)` for `0 <= r <= R`.
- `radiusAtHeight(h) = min(R, h * tan(A))`.
- Heights above `H` use shaft radius `R`.

Implementation notes:

- Contact may happen at the tip or at the circular transition to the shaft; both cases must be considered.
- UI should present included angle, not half-angle.
- Preview mesh should visibly taper to a point and include a shaft.
- V-bit engraving can later reuse path drop-cutter, but this spec only covers geometry support.

Tests:

- A 90 degree included-angle cutter has `heightAtRadius(R) = R`.
- Tip contact on a horizontal plane returns plane Z.
- A cone against a steep wall reports side/edge contact instead of only tip contact.

## Ball-To-Conical Compound Cutter

User-facing name: **Ball-to-conical compound cutter**.

Parameters:

- `ballDiameter`
- `maximumDiameter`
- `includedAngle`
- `cuttingLength`
- `shaftLength`

Validation:

- `0 < ballDiameter <= maximumDiameter`.
- Included angle constraints match cone cutter.

Profile behavior:

- Lower segment is a ball nose from radius `0` to the tangent radius.
- Upper segment is a cone tangent to the ball segment and continuing to `maximumDiameter / 2`.
- The profile must be continuous in both radius and height at the tangent.
- Add a cylindrical shaft segment above the cone.

Implementation notes:

- This selected compound cutter requires an internal piecewise cutter representation even though the generic composite cutter was not selected as a user-facing tool.
- Represent compound profiles as ordered radial/height segments with:
  - valid radius interval,
  - valid height interval,
  - local profile evaluator,
  - local Z offset.
- Drop and push contact should evaluate each segment independently and keep the highest safe drop result or the union of interfering push intervals.
- The generic composite editor does not need to be implemented for this selected scope.

Tests:

- Tangency calculation produces no height discontinuity at the ball/cone transition.
- A ball-cone with maximum diameter equal to ball diameter behaves like a ball cutter plus shaft.
- Drop-cutter and waterline paths remain finite on a sloped plane.

## Operation Parameters

CAM operations should expose cutter parameters through the new operation schema:

- Add `toolShape` with options `flat`, `ball`, `bull`, `cone`, `ball-cone`.
- Use `toolDiameter` as the common diameter field for flat, ball, and bull cutters.
- Add conditional params:
  - `cornerRadius` for bull.
  - `includedAngle` for cone and ball-cone.
  - `ballDiameter` and `maximumDiameter` for ball-cone.
- Validate the cutter before toolpath generation starts so invalid settings fail with feedback.

## Worker And Progress Requirements

- Cutter construction must be deterministic and cheap enough to run in the CAM worker.
- Progress should not emit per-triangle messages from cutter shape code.
- Contact solvers with iteration loops must accept a cancellation/progress-yield hook at batch-operation boundaries, not inside every numeric iteration.

## Failure Feedback

Return warnings instead of silent fallback for:

- Invalid cutter dimensions.
- Unsupported cutter shape in a selected strategy.
- Numeric contact solve non-convergence.
- Cutter length shorter than requested cut depth when collision checks depend on length.

## Implementation Order

1. Add cutter model and validation.
2. Implement flat and ball profile evaluators.
3. Add bull and cone profile evaluators.
4. Add ball-cone piecewise profile.
5. Add preview meshes for all selected shapes.
6. Wire `toolShape` into drop-cutter and push-cutter specs.

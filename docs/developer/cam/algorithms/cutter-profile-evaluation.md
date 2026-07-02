# Cutter Profile Evaluation

This spec defines the selected cutter profile algorithms used by drop-cutter, push-cutter, preview mesh generation, and swept-volume simulation.

## Selected Cutter Shapes

- Flat end mill.
- Ball nose end mill.
- Bull nose / corner radius cutter.
- Cone cutter / V-bit.
- Ball-to-conical compound cutter.

## Inputs

```ts
type CamCutterInput = {
  kind: "flat" | "ball" | "bull" | "cone" | "ball-cone";
  diameter?: number;
  cuttingLength?: number;
  shaftLength?: number;
  cornerRadius?: number;
  includedAngleDeg?: number;
  ballDiameter?: number;
  maximumDiameter?: number;
};
```

## Normalized Cutter

Build a normalized cutter before generation:

```ts
type CamCutter = {
  kind: string;
  radius: number;
  diameter: number;
  cuttingLength: number;
  shaftLength: number;
  profileHeight: number;
  heightAtRadius(r: number): number | null;
  radiusAtHeight(h: number): number | null;
  segmentAtRadius?(r: number): CamProfileSegment | null;
  segmentAtHeight?(h: number): CamProfileSegment | null;
};
```

Validation:

- All selected dimensions must be finite and positive.
- `cornerRadius < diameter / 2`.
- `0 < includedAngleDeg < 180`.
- `ballDiameter <= maximumDiameter` for ball-cone.
- Invalid input returns a generation-stopping error before mesh processing.

## Algorithm: Flat Profile

Inputs:

- `diameter`, `cuttingLength`.

Derived:

- `R = diameter / 2`.
- `profileHeight = 0`.

Functions:

- `heightAtRadius(r)` returns `0` for `0 <= r <= R`, otherwise `null`.
- `radiusAtHeight(h)` returns `R` for `0 <= h <= cuttingLength`, otherwise `null`.

Contact capability:

- Vertex: valid if XY distance <= `R`.
- Facet: bottom plane or side/shaft where applicable.
- Edge: tangent to a cylinder around the cutter axis.

## Algorithm: Ball Profile

Inputs:

- `diameter`, `cuttingLength`.

Derived:

- `R = diameter / 2`.
- Ball center is local `(0, 0, R)`.
- `profileHeight = R`.

Functions:

- `heightAtRadius(r) = R - sqrt(R * R - r * r)` for `0 <= r <= R`.
- `radiusAtHeight(h) = sqrt(R * R - (R - h) * (R - h))` for `0 <= h < R`.
- `radiusAtHeight(h) = R` for `R <= h <= cuttingLength`.

Contact capability:

- Vertex/facet/edge contacts must respect the spherical bottom.
- Edge contact can use standard ray/cylinder intersection between the ball center path and the triangle edge swept cylinder.

## Algorithm: Bull Profile

Inputs:

- `diameter`, `cornerRadius`, `cuttingLength`.

Derived:

- `R = diameter / 2`.
- `Rc = cornerRadius`.
- `Rf = R - Rc`.
- Toroid center ring radius is `Rf`, local Z center is `Rc`.

Functions:

- `heightAtRadius(r) = 0` for `0 <= r <= Rf`.
- `heightAtRadius(r) = Rc - sqrt(Rc * Rc - (r - Rf) * (r - Rf))` for `Rf < r <= R`.
- `radiusAtHeight(h) = Rf + sqrt(Rc * Rc - (Rc - h) * (Rc - h))` for `0 <= h < Rc`.
- `radiusAtHeight(h) = R` for `Rc <= h <= cuttingLength`.

Contact capability:

- Flat center uses flat cutter contact.
- Corner uses circular/toroidal profile contact.
- Edge contact against sloped edges may require a bounded numeric solve.

Numeric solve requirements:

- Use a local bracketed root finder with max iterations and tolerance.
- If convergence fails, skip that candidate and emit a warning.
- Keep the bull-corner solve bounded, deterministic, and covered by convergence tests.

## Algorithm: Cone Profile

Inputs:

- `maximumDiameter` or `diameter`.
- `includedAngleDeg`.
- `cuttingLength`.

Derived:

- `R = maximumDiameter / 2`.
- `A = includedAngleDeg * PI / 360`.
- `H = R / tan(A)`.
- `profileHeight = H`.

Functions:

- `heightAtRadius(r) = r / tan(A)` for `0 <= r <= R`.
- `radiusAtHeight(h) = min(R, h * tan(A))` for `0 <= h <= cuttingLength`.

Contact capability:

- Tip contact.
- Conical side contact.
- Circular transition/shaft contact above `H`.

## Algorithm: Ball-Cone Profile

Inputs:

- `ballDiameter`, `maximumDiameter`, `includedAngleDeg`, `cuttingLength`.

Derived:

- `Rb = ballDiameter / 2`.
- `Rmax = maximumDiameter / 2`.
- `A = includedAngleDeg * PI / 360`.
- Tangency radius `Rt = Rb * cos(A)`.
- Ball height at tangency `Ht = Rb - sqrt(Rb * Rb - Rt * Rt)`.
- Cone local height offset is chosen so cone height at `Rt` equals `Ht`.

Segments:

- Ball segment for `0 <= r <= Rt`.
- Cone segment for `Rt < r <= Rmax`.
- Shaft segment for heights above the cone top.

Requirements:

- `heightAtRadius` must be continuous at `Rt`.
- `radiusAtHeight` must select the segment whose height interval contains `h`.
- If `ballDiameter == maximumDiameter`, treat as a ball cutter plus shaft.

## Preview Mesh

Generate plain triangle meshes:

- Revolve profile polyline around the Z axis.
- Use configurable radial segments, default 32.
- Include cutter body and shaft as separate material groups when possible.
- Mesh generation must run in UI or worker without BREP topology.

## Swept Segment Mesh

For preview/simulation:

- Flat cutter: cylinder swept along segment with flat end caps.
- Ball cutter: capsule-like swept lower profile plus shaft.
- Bull/cone/ball-cone: acceptable first pass is a conservative triangle mesh generated by sampling profile cross-sections at segment endpoints and along the segment.
- Swept meshes are visualization/collision approximation; exact material removal must not depend on BREP topology.

## Tests

- Validate every selected cutter rejects invalid dimensions.
- Verify `heightAtRadius` and `radiusAtHeight` round-trip at representative sample points.
- Verify ball-cone continuity at the tangent radius.
- Verify preview mesh has nonzero vertices and triangles for each shape.
- Verify missing or invalid cutter shape data fails validation or receives the selected schema default before generation.

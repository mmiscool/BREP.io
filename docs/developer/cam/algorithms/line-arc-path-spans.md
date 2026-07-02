# Line And Arc Path Spans

This spec defines the source path representation used by uniform/adaptive drop-cutter and later arc-aware G-code output.

## Purpose

CAM strategies generate source paths before projection. A consistent span abstraction makes path sampling, adaptive subdivision, simulation, and future G2/G3 output share one representation.

## Types

```ts
type CamSpanKind = "line" | "arc";

type CamPathSpan = {
  id: string;
  kind: CamSpanKind;
  start: CamPoint3;
  end: CamPoint3;
  length2d(): number;
  pointAt(t: number): CamPoint3;
};
```

Arc span extension:

```ts
type CamArcSpan = CamPathSpan & {
  kind: "arc";
  center: CamPoint3;
  clockwise: boolean;
  radius: number;
  sweepRadians: number;
};
```

## Line Span Algorithm

Construction:

1. Validate start and end are finite.
2. Compute XY length.
3. Reject as degenerate if XY length and 3D length are below tolerance.

Evaluation:

- `pointAt(t)` clamps `t` to `[0, 1]`.
- Interpolate X, Y, and Z linearly.
- `length2d()` returns XY distance.

## Arc Span Algorithm

Selected scope:

- Circular arcs in machine XY.
- Constant or linearly interpolated Z.

Construction:

1. Validate start, end, center.
2. Compute start and end vectors from center in XY.
3. Validate both radii are equal within tolerance.
4. Compute signed sweep based on `clockwise`.
5. Normalize sweep to `(0, 2PI]`.
6. Store radius and sweep.

Evaluation:

- `pointAt(t)` clamps `t` to `[0, 1]`.
- Angle is `startAngle + signedSweep * t`.
- XY = center + radius * direction(angle).
- Z = linear interpolation from start Z to end Z.

Edge cases:

- Full-circle arcs need an explicit full-circle flag or split into two arcs.
- Nearly zero sweep is rejected.
- Radius mismatch beyond tolerance is rejected.

## Sampling Algorithm

Uniform sampling:

1. `steps = max(1, ceil(length2d / sampleSpacing))`.
2. Emit `pointAt(i / steps)` for `i = 0..steps`.
3. Suppress duplicated shared endpoints between adjacent spans unless a path boundary requires them.

Adaptive sampling:

- The adaptive drop-cutter algorithm owns subdivision.
- Spans only supply `pointAt(t)` and `length2d()`.

## Serialization

Plain worker payload:

```ts
type SerializedCamSpan =
  | { kind: "line"; id: string; start: CamPoint3; end: CamPoint3 }
  | { kind: "arc"; id: string; start: CamPoint3; end: CamPoint3; center: CamPoint3; clockwise: boolean };
```

## Tests

- Line midpoint equals arithmetic midpoint.
- Arc midpoint lies on the circle.
- Clockwise and counterclockwise arcs sweep the expected direction.
- Arc length equals `abs(sweepRadians) * radius`.
- Shared endpoints are not duplicated during continuous path sampling.
- Degenerate spans report user-facing feedback.

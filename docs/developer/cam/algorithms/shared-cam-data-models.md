# Shared CAM Data Models

This spec defines the common data structures used by the detailed CAM algorithms. Implement these first so each algorithm has the same contracts.

## Coordinate Space

- All algorithm inputs use machine coordinates.
- Current BREP.io mapping is `machine.X = scene.x`, `machine.Y = scene.z`, `machine.Z = scene.y`.
- The cutter axis is machine `+Z`.
- Cutting depths descend in machine Z.
- Display conversion back to scene coordinates must be centralized and tested.

## Numeric Policy

- Use one module-level tolerance object, not hard-coded tolerances in each algorithm.
- Required tolerances:
  - `pointEps`: point equality, default `1e-6`.
  - `distanceEps`: geometric distance comparisons, default `1e-7` to `1e-5` depending on model size.
  - `areaEps`: zero-area loop/triangle checks.
  - `angleEps`: dot/cross comparisons.
  - `sampleEps`: minimum accepted span/sample distance.
- Scale tolerances by model bounding-box diagonal when user models are very large or very small.
- Any `NaN` or infinite coordinate invalidates the local result and must create a warning.

## Core Types

Use names close to these in implementation, even if exact TypeScript names differ:

```ts
type CamPoint3 = [number, number, number];
type CamPoint2 = [number, number];

type CamTriangle = {
  id: number;
  a: CamPoint3;
  b: CamPoint3;
  c: CamPoint3;
  bounds: CamBounds3;
  normal?: CamPoint3;
};

type CamTargetSelection = {
  targetSolidIds: string[];
  driveFaceIds?: string[];
  protectedSolidIds: string[];
};

type CamFaceRegion = {
  solidId: string;
  faceId: string;
  triangleIds: number[];
  projectedBoundary?: CamPoint2[];
};

type CamBounds3 = {
  min: CamPoint3;
  max: CamPoint3;
};

type CamContactType =
  | "none"
  | "vertex"
  | "facet"
  | "edge"
  | "shaft"
  | "tool-profile"
  | "numeric-fallback";

type CamContact = {
  type: CamContactType;
  point?: CamPoint3;
  triangleId?: number;
  distance?: number;
  detail?: string;
};

type CamCLPoint = {
  x: number;
  y: number;
  z: number;
  contact?: CamContact;
};
```

## Toolpath Types

Toolpath output must preserve cutting and non-cutting motion separately:

```ts
type CamMoveKind = "rapid" | "plunge" | "cut" | "retract" | "link";

type CamMotionSegment = {
  start: CamPoint3;
  end: CamPoint3;
  kind: CamMoveKind;
  feedRate?: number;
  sourcePathId?: string;
};

type CamToolpathPath = {
  id: string;
  z: number;
  feedRate: number;
  plungeRate: number;
  points: CamPoint3[];
  closed?: boolean;
  strategy?: string;
};
```

Requirements:

- The actual cutter path is always represented as a polyline.
- The simulation toolhead must follow every `CamMotionSegment`.
- Slider snap points are built from motion segment endpoints and selected interior points.
- G-code order and simulation order must match.
- Face-selected operations use `driveFaceIds` to define machining scope but still build protection checks from `protectedSolidIds`.

## Progress Events

All long-running algorithms must support:

```ts
type CamProgress = {
  phase: string;
  message: string;
  detail?: string;
  current: number;
  total: number;
  operationId?: string;
};
```

Rules:

- Emit progress at algorithm-stage boundaries and chunk boundaries.
- Never emit progress for every triangle in a large mesh.
- Call `progressYield()` after meaningful chunks in web-worker-friendly async algorithms.
- If a fallback path is used, include the fallback in `detail`.

## Warnings and Errors

Use warnings for recoverable degradation:

- Empty path after clipping.
- Numeric solve did not converge for one candidate contact.
- Spatial index falls back to brute force for a small mesh.
- Arc discretized because arc-preserving output is not available yet.

Use errors for generation-stopping failures:

- No target mesh triangles for an enabled operation.
- Invalid cutter dimensions.
- Unsupported selected cutter shape for selected strategy.
- Worker serialization failure.

## Serialization Boundary

Worker jobs must pass plain data:

- Numbers, strings, booleans, arrays, and object literals.
- No `THREE.Vector3`.
- No scene objects.
- No methods/functions except local worker callbacks supplied outside serialized payload.

The worker should reconstruct internal classes from plain data at job start.

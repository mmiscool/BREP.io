# `Solid.splitSelfIntersectingTriangles()`

Detects self-intersecting triangle pairs and subdivides them conservatively in place while preserving face IDs.

## Usage

```js
solid.splitSelfIntersectingTriangles();
```

## Signature

```js
solid.splitSelfIntersectingTriangles(options = false)
```

## Parameters

- `options` (`boolean | object`, default `false`) - Passing `true` is shorthand for `{ diagnostics: true }`.

## Options

- `diagnostics` (`boolean`, default `false`) - Enables additional diagnostic logging.
- `detectOnly` (`boolean`, default `false`) - Detect intersections without mutating authored geometry.
- `probeOnly` (`boolean`, default `false`) - Detection mode treated like `detectOnly`.
- `returnIntersections` (`boolean`, default `false`) - In detection mode, return intersection records instead of a count.
- `includePointContacts` (`boolean`, default `true`) - Include point-contact intersections.
- `includeCoplanar` (`boolean`, default `true`) - Include coplanar triangle interactions.
- `maxIntersections` (`number`, default `0`) - Detection limit. `0` means no explicit limit.
- `snapTolerance` (`number`, default derived from model scale) - Tolerance for snapping generated intersection points.
- `tolerance` (`number`, optional) - Fallback tolerance used when `snapTolerance` is not provided.

## Returns

`number | object[]` - Usually the number of intersecting pairs processed. With `detectOnly` and `returnIntersections`, returns intersection records.

Pass `true` for additional diagnostics when debugging complex meshes.

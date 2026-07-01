# `Solid.findSelfIntersections()`

Detects triangle-triangle self intersections without mutating authored geometry.

## Usage

```js
const intersections = solid.findSelfIntersections({
  includeCoplanar: true,
  maxIntersections: 100
});
```

## Signature

```js
solid.findSelfIntersections(options = {})
```

## Options

- `tolerance` (`number`, optional) - Model tolerance override used for intersection detection.
- `includePointContacts` (`boolean`, default `true`) - Include point-contact intersections.
- `includeCoplanar` (`boolean`, default `true`) - Include coplanar triangle interactions.
- `maxIntersections` (`number`, default `0`) - Maximum records to collect. `0` means no explicit limit.

## Returns

`object[]` - Intersection records from the same detection engine used by `splitSelfIntersectingTriangles()`.

## Behavior

This is a detection wrapper around `splitSelfIntersectingTriangles()` with `detectOnly` and `returnIntersections` enabled.

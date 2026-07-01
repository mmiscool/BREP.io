# `Solid._getPointIndex()`

Internal helper that returns the authored vertex index for a point, adding the point to the vertex buffer if it is not already present.

## Usage

```js
const index = solid._getPointIndex([1, 2, 3]);
```

## Signature

```js
solid._getPointIndex(point)
```

## Parameters

- `point` (`[number, number, number]`) - Finite point coordinates.

## Returns

`number` - Authored vertex index.

## Errors

Throws when the point is not an array with at least three finite coordinates.

This is part of the low-level triangle authoring pipeline behind `addTriangle()`.

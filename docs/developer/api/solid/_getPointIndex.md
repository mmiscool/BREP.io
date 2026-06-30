# `Solid._getPointIndex()`

Internal helper that returns the authored vertex index for a point, adding the point to the vertex buffer if it is not already present.

## Usage

```js
const index = solid._getPointIndex([1, 2, 3]);
```

This is part of the low-level triangle authoring pipeline behind `addTriangle()`.

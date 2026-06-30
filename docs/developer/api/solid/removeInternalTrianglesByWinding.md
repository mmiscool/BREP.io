# `Solid.removeInternalTrianglesByWinding()`

Uses winding-number style classification at triangle centroids to remove interior triangles.

## Usage

```js
solid.removeInternalTrianglesByWinding({
  offsetScale: 1e-4,
  crossingTolerance: 0.05
});
```

Use this when ray-based classification is too fragile for the input mesh.

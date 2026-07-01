# `Solid.removeInternalTrianglesByWinding()`

Uses winding-number style classification at triangle centroids to remove interior triangles.

## Usage

```js
solid.removeInternalTrianglesByWinding({
  offsetScale: 1e-4,
  crossingTolerance: 0.05
});
```

## Signature

```js
solid.removeInternalTrianglesByWinding(options = {})
```

## Options

- `offsetScale` (`number`, default `1e-5`) - Centroid offset scale relative to the model bounding-box diagonal.
- `crossingTolerance` (`number`, default `0.05`) - Tolerance for deciding inside/outside crossing classification.

## Returns

`number` - Count of triangles removed.

Use this when ray-based classification is too fragile for the input mesh.

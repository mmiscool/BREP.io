# `Solid.cleanupSelfIntersections()`

Splits self-intersections, removes hidden/internal fragments, removes duplicate triangles, and validates the final shell.

## Usage

```js
const report = solid.cleanupSelfIntersections({
  maxPasses: 3,
  removeInternal: true
});
```

## Signature

```js
solid.cleanupSelfIntersections(options = {})
```

## Options

- `tolerance` (`number`, optional) - Model tolerance override for intersection and duplicate-triangle cleanup.
- `maxPasses` (`number`, default `3`) - Maximum split/cleanup passes.
- `includeCoplanar` (`boolean`, default `true`) - Include coplanar triangle interactions during intersection passes.
- `removeInternal` (`boolean`, default `true`) - Run internal-triangle removal after splitting.
- `diagnostics` (`boolean`, default `false`) - Enables diagnostics during split passes.
- `validate` (`boolean`, default `true`) - Validate that the final shell is closed/intersection-free.

## Returns

`object` - Cleanup report with `intersectionsFound`, `passes`, `sourceTrianglesSplit`, `trianglesAdded`, `internalTrianglesRemoved`, `duplicateTrianglesRemoved`, `finalTriangleCount`, `intersectionFree`, `closed`, and `complete`.

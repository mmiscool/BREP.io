# `Solid.removeInternalTriangles()`

Rebuilds the authored arrays from the manifold exterior so internal triangles are removed. If needed, it falls back to alternate classifiers.

## Usage

```js
solid.removeInternalTriangles();
solid.removeInternalTriangles({ fallback: 'raycast' });
```

Use this to strip hidden internal faces from imported or booleaned meshes.

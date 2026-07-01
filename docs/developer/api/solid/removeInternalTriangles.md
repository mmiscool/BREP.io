# `Solid.removeInternalTriangles()`

Rebuilds the authored arrays from the native manifold exterior so internal triangles are removed.

## Usage

```js
solid.removeInternalTriangles();
```

## Signature

```js
solid.removeInternalTriangles()
```

## Parameters

None.

## Returns

`number` - Count of triangles removed.

Use this to strip hidden internal faces from imported or booleaned meshes.

# `Solid._expandTriIDsFromMesh()`

Static helper that expands a Manifold mesh's `faceID` data into a plain JavaScript array.

## Usage

```js
const ids = Solid._expandTriIDsFromMesh(mesh);
```

## Signature

```js
Solid._expandTriIDsFromMesh(mesh)
```

## Parameters

- `mesh` (`ManifoldMesh`) - Mesh snapshot with optional `faceID` data.

## Returns

`number[]` - Expanded face IDs, or zeros when the mesh has no face ID data.

This is used when reconstructing `Solid` instances from Manifold output.

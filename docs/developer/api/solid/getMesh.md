# `Solid.getMesh()`

Returns a fresh Manifold mesh snapshot of the current solid.

## Usage

```js
const mesh = solid.getMesh();
// use mesh.vertProperties / mesh.triVerts / mesh.faceID
mesh.delete?.();
```

## Signature

```js
solid.getMesh()
```

## Parameters

None.

## Returns

`ManifoldMesh` - Fresh native mesh snapshot with `vertProperties`, `triVerts`, and face ID data when available.

Delete the returned mesh when you are finished with it.

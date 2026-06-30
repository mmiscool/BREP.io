# `Solid.getMesh()`

Returns a fresh Manifold mesh snapshot of the current solid.

## Usage

```js
const mesh = solid.getMesh();
// use mesh.vertProperties / mesh.triVerts / mesh.faceID
mesh.delete?.();
```

Delete the returned mesh when you are finished with it.

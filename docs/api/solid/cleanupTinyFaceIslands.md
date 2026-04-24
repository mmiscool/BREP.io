# `Solid.cleanupTinyFaceIslands()`

Reassigns tiny disconnected islands inside the same face label to a larger adjacent face and returns the number of triangles reassigned.

## Usage

```js
solid.cleanupTinyFaceIslands(0.002);
```

This is useful when a single logical face has been fragmented into tiny leftovers.

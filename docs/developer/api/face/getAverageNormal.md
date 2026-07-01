# `Face.getAverageNormal()`

Computes an area-weighted average normal for the face's triangles in world space.

## Usage

```js
const normal = face.getAverageNormal();
```

## Signature

```js
face.getAverageNormal()
```

## Parameters

None.

## Returns

`THREE.Vector3` - Area-weighted world-space average normal. Returns `(0, 1, 0)` if the geometry is missing or degenerate.

Use this when a rendered face needs a representative world-space normal.

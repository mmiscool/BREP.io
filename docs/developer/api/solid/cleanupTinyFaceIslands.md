# `Solid.cleanupTinyFaceIslands()`

Reassigns tiny disconnected islands inside the same face label to a larger adjacent face and returns the number of triangles reassigned.

## Usage

```js
solid.cleanupTinyFaceIslands(0.002);
```

## Signature

```js
solid.cleanupTinyFaceIslands(size)
```

## Parameters

- `size` (`number`) - Area threshold for reassignment.

## Returns

`number` - Count of triangles reassigned.

This is useful when a single logical face has been fragmented into tiny leftovers.

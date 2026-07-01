# `Solid.mirrorAcrossPlane()`

Returns a mirrored copy of the solid across a plane defined by a point and a normal.

## Usage

```js
const mirrored = solid.mirrorAcrossPlane([0, 0, 0], [1, 0, 0]);
```

## Signature

```js
solid.mirrorAcrossPlane(point, normal)
```

## Parameters

- `point` (`[number, number, number] | THREE.Vector3`) - A point on the mirror plane.
- `normal` (`[number, number, number] | THREE.Vector3`) - Plane normal.

## Returns

`Solid` - New mirrored solid. The original is not mutated.

This is useful for symmetry workflows where the original solid should remain unchanged.

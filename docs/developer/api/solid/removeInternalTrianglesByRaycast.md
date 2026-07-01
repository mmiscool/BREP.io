# `Solid.removeInternalTrianglesByRaycast()`

Uses centroid ray tests to classify and remove interior triangles without requiring successful manifoldization.

## Usage

```js
solid.removeInternalTrianglesByRaycast();
```

## Signature

```js
solid.removeInternalTrianglesByRaycast()
```

## Parameters

None.

## Returns

`number` - Count of triangles removed.

This is a slower fallback for problematic geometry.

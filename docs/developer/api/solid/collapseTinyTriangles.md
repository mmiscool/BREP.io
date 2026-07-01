# `Solid.collapseTinyTriangles()`

Collapses triangles whose shortest edge falls below the supplied threshold, then rebuilds supporting caches.

## Usage

```js
solid.collapseTinyTriangles(0.05);
```

## Signature

```js
solid.collapseTinyTriangles(lengthThreshold)
```

## Parameters

- `lengthThreshold` (`number`) - Triangles whose shortest edge is below this length are candidates for collapse.

## Returns

`number` - Count of edge collapses performed.

This is a stronger cleanup step than simple edge flips.

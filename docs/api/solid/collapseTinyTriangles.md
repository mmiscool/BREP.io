# `Solid.collapseTinyTriangles()`

Collapses triangles whose shortest edge falls below the supplied threshold, then rebuilds supporting caches.

## Usage

```js
solid.collapseTinyTriangles(0.05);
```

This is a stronger cleanup step than simple edge flips.

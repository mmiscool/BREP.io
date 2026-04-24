# `Solid.removeDegenerateTriangles()`

Drops triangles with duplicate vertices or near-zero area and returns the number removed.

## Usage

```js
const removed = solid.removeDegenerateTriangles();
```

Use this after low-level edits when triangle quality may have degraded.

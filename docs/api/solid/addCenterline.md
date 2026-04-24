# `Solid.addCenterline()`

Convenience wrapper around `addAuxEdge()` that records a two-point helper line and marks it as a centerline.

## Usage

```js
solid.addCenterline([0, 0, 0], [0, 0, 10], 'AXIS');
```

Use this when you want a lightweight axis or PMI reference line on the solid.

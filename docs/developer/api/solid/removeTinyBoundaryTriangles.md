# `Solid.removeTinyBoundaryTriangles()`

Performs limited boundary edge flips to remove triangles below an area threshold near inter-face boundaries.

## Usage

```js
solid.removeTinyBoundaryTriangles(0.001, 3);
```

Use this after booleans or offsets when tiny boundary triangles are causing instability.

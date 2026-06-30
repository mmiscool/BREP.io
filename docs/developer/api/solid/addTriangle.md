# `Solid.addTriangle()`

Appends a counter-clockwise triangle labeled with `faceName` to the authored mesh buffers. The solid is marked dirty and the method returns `this`.

## Usage

```js
solid.addTriangle('TOP', [0, 0, 1], [1, 0, 1], [0, 1, 1]);
```

Use identical shared vertex coordinates if you want neighboring triangles to reuse vertices.

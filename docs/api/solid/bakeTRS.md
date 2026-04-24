# `Solid.bakeTRS()`

Builds a transform from `{ t, rDeg, s }` and bakes it into the authored geometry.

## Usage

```js
solid.bakeTRS({ t: [0, 0, 10], rDeg: [0, 45, 0], s: [1, 1, 1] });
```

Use this when translation, rotation in degrees, and scale are easier to express than a raw matrix.

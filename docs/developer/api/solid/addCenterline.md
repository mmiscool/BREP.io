# `Solid.addCenterline()`

Convenience wrapper around `addAuxEdge()` that records a two-point helper line and marks it as a centerline.

## Usage

```js
solid.addCenterline([0, 0, 0], [0, 0, 10], 'AXIS');
```

## Signature

```js
solid.addCenterline(a, b, name = 'CENTERLINE', options = {})
```

## Parameters

- `a`, `b` (`[number, number, number] | { x, y, z }`) - Start and end points for the two-point centerline.
- `name` (`string`, default `'CENTERLINE'`) - Aux-edge label.
- `options` (`object`, optional) - Passed to `addAuxEdge()`. `centerline` defaults to `true` when omitted.

## Options

Supports the same options as [`addAuxEdge()`](./addAuxEdge.md): `closedLoop`, `polylineWorld`, `materialKey`, `centerline`, `faceA`, and `faceB`.

## Returns

`Solid` - The same solid, for chaining.

Use this when you want a lightweight axis or PMI reference line on the solid.

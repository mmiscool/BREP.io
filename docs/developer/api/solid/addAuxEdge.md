# `Solid.addAuxEdge()`

Stores an auxiliary polyline on the solid for visualization. Aux edges do not change the authored triangles or boolean result.

## Usage

```js
solid.addAuxEdge('CENTER', [[0, 0, 0], [0, 0, 10]], {
  closedLoop: false,
  materialKey: 'OVERLAY'
});
```

## Signature

```js
solid.addAuxEdge(name, points, options = {})
```

## Parameters

- `name` (`string`) - Label for the auxiliary edge. If the label contains `centerline` and `options.centerline` is not supplied, the edge is treated as a centerline.
- `points` (`Array<[number, number, number] | { x, y, z }>` ) - Polyline points. At least two finite points are required; invalid points are ignored.
- `options` (`object`, optional) - Aux-edge metadata and visualization flags.

## Options

- `closedLoop` (`boolean`, default `false`) - Render the polyline as a closed loop.
- `polylineWorld` (`boolean`, default `false`) - Marks the stored points as world-space coordinates.
- `materialKey` (`'OVERLAY' | 'BASE' | string`, default `'OVERLAY'`) - Visualization material bucket.
- `centerline` (`boolean`, default inferred from `name`) - Marks the aux edge as a centerline.
- `faceA` (`string`, default `''`) - Optional adjacent/source face label.
- `faceB` (`string`, default `''`) - Optional adjacent/source face label.

## Returns

`Solid` - The same solid, for chaining.

Use this for centerlines, reference curves, or debug overlays.

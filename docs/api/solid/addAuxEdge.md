# `Solid.addAuxEdge()`

Stores an auxiliary polyline on the solid for visualization. Aux edges do not change the authored triangles or boolean result.

## Usage

```js
solid.addAuxEdge('CENTER', [[0, 0, 0], [0, 0, 10]], {
  closedLoop: false,
  materialKey: 'OVERLAY'
});
```

Use this for centerlines, reference curves, or debug overlays.

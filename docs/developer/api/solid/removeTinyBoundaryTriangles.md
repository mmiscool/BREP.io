# `Solid.removeTinyBoundaryTriangles()`

Performs limited boundary edge flips to remove triangles below an area threshold near inter-face boundaries.

## Usage

```js
solid.removeTinyBoundaryTriangles(0.001, 3);
```

## Signature

```js
solid.removeTinyBoundaryTriangles(areaThreshold, maxIterations = 1)
```

## Parameters

- `areaThreshold` (`number`) - Triangles below this area near inter-face boundaries are candidates for edge-flip cleanup.
- `maxIterations` (`number`, default `1`) - Maximum number of cleanup passes.

## Returns

`number` - Count of edge flips applied.

Use this after booleans or offsets when tiny boundary triangles are causing instability.

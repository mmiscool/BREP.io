# `Solid.getBoundaryEdgePolylines()`

Extracts boundary polylines between differing face labels and returns edge descriptors with names, neighboring faces, positions, and indices.

## Usage

```js
const edges = solid.getBoundaryEdgePolylines();
```

## Signature

```js
solid.getBoundaryEdgePolylines()
```

## Parameters

None.

## Returns

`Array<{ name: string, faceA: string, faceB: string, positions: number[][], indices: number[] }>` - Boundary polyline descriptors between neighboring face labels.

This is the data source behind rendered `Edge` objects.

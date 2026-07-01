# `Solid.getEdgeMetadata()`

Reads metadata stored for a named edge. Returns `null` when the edge has no stored metadata.

## Usage

```js
const edgeMetadata = solid.getEdgeMetadata('EDGE_0');
```

## Signature

```js
solid.getEdgeMetadata(edgeName)
```

## Parameters

- `edgeName` (`string`) - Boundary edge label to read.

## Returns

`object | null` - Stored metadata for the edge, or `null` when none exists.

Use this with `getBoundaryEdgePolylines()` or rendered `Edge` objects.

# `Solid.setEdgeMetadata()`

Stores or merges metadata for a named boundary edge. Returns `this`.

## Usage

```js
solid.setEdgeMetadata('EDGE_0', { tag: 'reference' });
```

## Signature

```js
solid.setEdgeMetadata(edgeName, metadata)
```

## Parameters

- `edgeName` (`string`) - Boundary edge label.
- `metadata` (`object`) - Metadata object to merge into the edge metadata entry.

## Returns

`Solid` - The same solid, for chaining.

This is used by PMI and other edge-level tooling.

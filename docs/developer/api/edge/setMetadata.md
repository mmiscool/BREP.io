# `Edge.setMetadata()`

Writes edge metadata back to the owning solid through `parentSolid.setEdgeMetadata()`.

## Usage

```js
edge.setMetadata({ tag: 'datum' });
```

## Signature

```js
edge.setMetadata(metadata)
```

## Parameters

- `metadata` (`object`) - Metadata to merge into the owning solid's edge metadata for `edge.name`.

## Returns

`Edge` - The same edge object.

This is the edge-object convenience wrapper for the solid metadata API.

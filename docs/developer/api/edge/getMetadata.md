# `Edge.getMetadata()`

Reads metadata for this edge from the owning solid.

## Usage

```js
const metadata = edge.getMetadata();
```

## Signature

```js
edge.getMetadata()
```

## Parameters

None.

## Returns

`object | null` - Metadata returned by `parentSolid.getEdgeMetadata(edge.name)`, or `null` when no parent solid is available.

Returns `null` when the edge is not attached to a parent solid.

# `Face.getNeighbors()`

Returns neighboring `Face` objects that share an edge with this face.

## Usage

```js
const neighbors = face.getNeighbors();
```

## Signature

```js
face.getNeighbors()
```

## Parameters

None.

## Returns

`Face[]` - Deduplicated neighboring faces that share an edge with this face.

It prefers already-populated edge links and falls back to boundary polyline lookup on the parent solid.

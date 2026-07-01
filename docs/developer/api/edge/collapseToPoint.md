# `Edge.collapseToPoint()`

Collapses all vertices referenced by the edge to their average point, then rebuilds the owning solid's manifold and visualization.

## Usage

```js
edge.collapseToPoint();
```

## Signature

```js
edge.collapseToPoint()
```

## Parameters

None.

## Returns

`Edge` - The same edge object.

## Behavior

- Ignores auxiliary edges.
- Resolves the edge's referenced solid vertices.
- Moves those vertices to their average point.
- Rebuilds the parent solid's vertex key map, clears manifold/face caches, attempts manifoldization, and refreshes visualization.
- Returns unchanged when the edge cannot be resolved to authored vertices.

This is a destructive edit on the parent solid and ignores aux edges.

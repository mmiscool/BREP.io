# `Edge.collapseToPoint()`

Collapses all vertices referenced by the edge to their average point, then rebuilds the owning solid's manifold and visualization.

## Usage

```js
edge.collapseToPoint();
```

This is a destructive edit on the parent solid and ignores aux edges.

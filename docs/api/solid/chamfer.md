# `Solid.chamfer()`

Asynchronously applies chamfers to resolved edges and returns the resulting solid.

## Usage

```js
const chamfered = await solid.chamfer({
  distance: 1,
  edges: [edgeObj],
  direction: 'INSET'
});
```

Use `edgeNames` or resolved `Edge` objects to identify the target edges.

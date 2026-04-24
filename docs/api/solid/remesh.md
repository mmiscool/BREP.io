# `Solid.remesh()`

Splits long edges until triangle sizes are more uniform while preserving face IDs. The solid is mutated and returned.

## Usage

```js
solid.remesh({ maxEdgeLength: 5, maxIterations: 2 });
```

Use this before downstream operations that benefit from more even triangle density.

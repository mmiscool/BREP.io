# `Solid.remesh()`

Splits long edges until triangle sizes are more uniform while preserving face IDs. The solid is mutated and returned.

## Usage

```js
solid.remesh({ maxEdgeLength: 5, maxIterations: 2 });
```

## Signature

```js
solid.remesh(options = {})
```

## Options

- `maxEdgeLength` (`number`, required) - Maximum allowed edge length before an edge is split. Non-positive or non-finite values leave the solid unchanged.
- `maxIterations` (`number`, default `10`) - Maximum number of subdivision passes.

## Returns

`Solid` - The same solid, after in-place remeshing.

## Behavior

- Splits long triangle edges and preserves face IDs.
- Marks the solid dirty and rebuilds winding/caches as needed.

Use this before downstream operations that benefit from more even triangle density.

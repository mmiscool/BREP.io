# `Solid.removeSmallIslands()`

Removes disconnected triangle islands relative to the dominant shell, with separate controls for internal and external islands.

## Usage

```js
const removed = solid.removeSmallIslands({
  maxTriangles: 20,
  removeInternal: true,
  removeExternal: true
});
```

## Signature

```js
solid.removeSmallIslands(options = {})
```

## Options

- `maxTriangles` (`number`, default `30`) - Disconnected component triangle-count threshold.
- `removeInternal` (`boolean`, default `true`) - Remove small islands classified inside the main shell.
- `removeExternal` (`boolean`, default `true`) - Remove small islands classified outside the main shell.

## Returns

`number` - Count of triangles removed.

## Behavior

When triangles are removed, the solid's authoring state is updated from the native core, the manifold cache is cleared, and the face index is invalidated.

This is useful for cleaning up boolean debris and import artifacts.

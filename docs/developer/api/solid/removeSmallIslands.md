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

This is useful for cleaning up boolean debris and import artifacts.

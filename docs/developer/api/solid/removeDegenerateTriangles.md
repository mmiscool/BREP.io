# `Solid.removeDegenerateTriangles()`

Drops triangles with duplicate vertices or near-zero area and returns the number removed.

## Usage

```js
const removed = solid.removeDegenerateTriangles();
```

## Signature

```js
solid.removeDegenerateTriangles()
```

## Parameters

None.

## Returns

`number` - Count of triangles removed.

Use this after low-level edits when triangle quality may have degraded.

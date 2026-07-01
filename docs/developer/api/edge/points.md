# `Edge.points()`

Returns the edge polyline as `{ x, y, z }` points, optionally in world space.

## Usage

```js
const pts = edge.points(true);
```

## Signature

```js
edge.points(applyWorld = true)
```

## Parameters

- `applyWorld` (`boolean`, default `true`) - Apply `edge.matrixWorld` to each polyline point before returning it.

## Returns

`Array<{ x: number, y: number, z: number }>` - Edge polyline points.

Pass `false` to read local polyline coordinates.

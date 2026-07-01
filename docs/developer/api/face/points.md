# `Face.points()`

Returns the face's geometry points as `{ x, y, z }` objects, optionally transformed into world space.

## Usage

```js
const pts = await face.points(true);
```

## Signature

```js
await face.points(applyWorld = true)
```

## Parameters

- `applyWorld` (`boolean`, default `true`) - Apply `face.matrixWorld` to each geometry point before returning it.

## Returns

`Promise<Array<{ x: number, y: number, z: number }>>` - Face geometry points.

Pass `false` if you want local geometry coordinates.

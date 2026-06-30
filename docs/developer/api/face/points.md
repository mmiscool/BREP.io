# `Face.points()`

Returns the face's geometry points as `{ x, y, z }` objects, optionally transformed into world space.

## Usage

```js
const pts = await face.points(true);
```

Pass `false` if you want local geometry coordinates.

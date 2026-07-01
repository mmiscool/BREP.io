# `Solid.addTriangle()`

Appends a counter-clockwise triangle labeled with `faceName` to the authored mesh buffers. The solid is marked dirty and the method returns `this`.

## Usage

```js
solid.addTriangle('TOP', [0, 0, 1], [1, 0, 1], [0, 1, 1]);
```

## Signature

```js
solid.addTriangle(faceName, v1, v2, v3)
```

## Parameters

- `faceName` (`string`) - Face label assigned to the triangle. Triangles with the same label are grouped under that face name for `getFace()`, `getFaces()`, visualization, and face metadata.
- `v1`, `v2`, `v3` (`[number, number, number]`) - Triangle vertices in local solid coordinates.

## Returns

`Solid` - The same solid, for chaining.

## Behavior

- Creates or reuses a manifold face ID for `faceName`.
- Reuses vertex indices only when coordinates match exactly.
- Appends one triangle to the authoring buffers and marks the solid dirty.

Use identical shared vertex coordinates if you want neighboring triangles to reuse vertices.

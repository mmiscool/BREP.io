# `Solid.renameFace()`

Renames a face label. If the destination label already exists, authored triangles and metadata are merged into that target face.

## Usage

```js
solid.renameFace('SIDE_A', 'SIDE_MAIN');
```

Use this to normalize face names after generation or repair steps.

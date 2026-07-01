# `Solid.renameFace()`

Renames a face label. If the destination label already exists, authored triangles and metadata are merged into that target face.

## Usage

```js
solid.renameFace('SIDE_A', 'SIDE_MAIN');
```

## Signature

```js
solid.renameFace(oldName, newName)
```

## Parameters

- `oldName` (`string`) - Existing face label to rename.
- `newName` (`string`) - Destination face label.

## Returns

`Solid` - The same solid, for chaining.

## Behavior

If `newName` already exists, triangles and metadata from `oldName` are merged into `newName`.

Use this to normalize face names after generation or repair steps.

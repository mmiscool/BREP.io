# `Face.renameFace()`

Renames the underlying face label through the owning solid.

## Usage

```js
face.renameFace('SIDE_MAIN');
```

## Signature

```js
face.renameFace(newName)
```

## Parameters

- `newName` (`string`) - Destination face label.

## Returns

`undefined`.

## Behavior

Calls `face.parentSolid.renameFace(face.name, newName)`.

Use this when interacting through a selected face object instead of the parent `Solid`.

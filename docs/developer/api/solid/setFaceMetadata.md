# `Solid.setFaceMetadata()`

Stores or merges arbitrary metadata for a named face. Returns `this`.

## Usage

```js
solid.setFaceMetadata('CYL_SIDE', { radius: 5, axis: [0, 0, 1] });
```

## Signature

```js
solid.setFaceMetadata(faceName, metadata)
```

## Parameters

- `faceName` (`string`) - Existing or future face label.
- `metadata` (`object`) - Metadata object to merge into the face metadata entry.

## Returns

`Solid` - The same solid, for chaining.

Use face metadata for downstream selection, PMI, feature tagging, or export helpers.

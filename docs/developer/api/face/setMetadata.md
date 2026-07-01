# `Face.setMetadata()`

Writes metadata back to the owning solid by calling `parentSolid.setFaceMetadata()`.

## Usage

```js
face.setMetadata({ tag: 'inspection' });
```

## Signature

```js
face.setMetadata(metadata)
```

## Parameters

- `metadata` (`object`) - Metadata to merge into the owning solid's face metadata for `face.name`.

## Returns

`Face` - The same face object.

This is the convenient face-object wrapper around the solid metadata API.

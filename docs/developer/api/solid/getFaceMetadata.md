# `Solid.getFaceMetadata()`

Reads metadata stored for a named face. When no metadata exists, it returns an empty object.

## Usage

```js
const metadata = solid.getFaceMetadata('CYL_SIDE');
```

## Signature

```js
solid.getFaceMetadata(faceName)
```

## Parameters

- `faceName` (`string`) - Face label to read.

## Returns

`object` - Stored metadata for the face, or `{}` when no face metadata exists.

This is the paired read API for `setFaceMetadata()`.

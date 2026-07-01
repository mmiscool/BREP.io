# `Solid.getFaceNormal()`

Computes an averaged authored normal for a named face and returns diagnostic data about how reliable that normal is.

## Usage

```js
const info = solid.getFaceNormal('FRONT');
console.log(info.normal, info.planarRatio);
```

## Signature

```js
solid.getFaceNormal(faceName)
```

## Parameters

- `faceName` (`string`) - Face label to inspect.

## Returns

`{ faceFound: boolean, validNormal: boolean, normal: number[], planarRatio: number, affectedVertexCount: number }`

- `faceFound` - Whether the label exists.
- `validNormal` - Whether a usable averaged normal was computed.
- `normal` - Averaged normal vector.
- `planarRatio` - Diagnostic measure of normal consistency.
- `affectedVertexCount` - Number of vertices contributing to the face.

Use this before face-driven edits when you need to inspect the solved normal explicitly.

# `Solid.getFaceNormal()`

Computes an averaged authored normal for a named face and returns diagnostic data about how reliable that normal is.

## Usage

```js
const info = solid.getFaceNormal('FRONT');
console.log(info.normal, info.planarRatio);
```

Use this before face-driven edits when you need to inspect the solved normal explicitly.

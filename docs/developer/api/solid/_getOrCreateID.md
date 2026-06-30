# `Solid._getOrCreateID()`

Internal helper that maps a face label to a persistent Manifold face ID, creating one if the face name has not been seen before.

## Usage

```js
const faceID = solid._getOrCreateID('SIDE');
```

This keeps face provenance stable across mesh rebuilds and booleans.

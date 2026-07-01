# `Solid._getOrCreateID()`

Internal helper that maps a face label to a persistent Manifold face ID, creating one if the face name has not been seen before.

## Usage

```js
const faceID = solid._getOrCreateID('SIDE');
```

## Signature

```js
solid._getOrCreateID(faceName)
```

## Parameters

- `faceName` (`string`) - Face label to resolve.

## Returns

`number` - Manifold face ID for the label.

This keeps face provenance stable across mesh rebuilds and booleans.

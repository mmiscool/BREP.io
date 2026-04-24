# `Solid._fromManifold()`

Static helper that rebuilds a `Solid` from an existing Manifold object and an ID-to-face-name map.

## Usage

```js
const rebuilt = Solid._fromManifold(existingManifold, idToFaceName);
```

This is the core reconstruction path used by booleans and tolerance changes.

# `Solid._manifoldize()`

Internal method that builds or reuses the cached Manifold representation from the authored arrays after winding and orientation checks.

## Usage

```js
const manifold = solid._manifoldize();
```

Most callers should use higher-level query, export, or boolean methods instead of calling this directly.

# `Solid._weldVerticesByEpsilon()`

Internal cleanup helper that merges authored vertices within a positional tolerance and drops newly degenerate triangles.

## Usage

```js
solid._weldVerticesByEpsilon(0.0005);
```

This is the low-level operation used by `setEpsilon()`.

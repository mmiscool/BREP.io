# `Solid._weldVerticesByEpsilon()`

Internal cleanup helper that merges authored vertices within a positional tolerance and drops newly degenerate triangles.

## Usage

```js
solid._weldVerticesByEpsilon(0.0005);
```

## Signature

```js
solid._weldVerticesByEpsilon(eps, options = {})
```

## Parameters

- `eps` (`number`) - Positional weld tolerance.
- `options` (`object`, optional) - Reserved for low-level weld behavior.

## Returns

`Solid` - The same solid, for chaining.

This is the low-level operation used by `setEpsilon()`.

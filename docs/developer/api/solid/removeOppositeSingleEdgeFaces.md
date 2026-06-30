# `Solid.removeOppositeSingleEdgeFaces()`

Deletes tiny opposite-facing face patches that connect to the rest of the shell through a minimal shared-edge chain.

## Usage

```js
solid.removeOppositeSingleEdgeFaces({ normalDotThreshold: -0.95 });
```

This is a targeted cleanup pass for thin sliver artifacts.

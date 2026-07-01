# `Solid.removeOppositeSingleEdgeFaces()`

Deletes tiny opposite-facing face patches that connect to the rest of the shell through a minimal shared-edge chain.

## Usage

```js
solid.removeOppositeSingleEdgeFaces({ normalDotThreshold: -0.95 });
```

## Signature

```js
solid.removeOppositeSingleEdgeFaces(options = {})
```

## Options

- `normalDotThreshold` (`number`, default `-0.95`) - Dot-product threshold for considering neighboring face normals opposite-facing. Lower values require stronger opposition.

## Returns

`number` - Count of triangles removed.

This is a targeted cleanup pass for thin sliver artifacts.

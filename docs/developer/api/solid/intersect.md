# `Solid.intersect()`

Runs a boolean intersection with another solid and returns the shared volume as a new `Solid`.

## Usage

```js
const result = solid.intersect(otherSolid);
```

## Signature

```js
solid.intersect(other)
```

## Parameters

- `other` (`Solid`) - Solid to intersect with this solid.

## Returns

`Solid` - A new solid containing the shared volume.

## Behavior

- Runs the native `INTERSECT` boolean path.
- Propagates face labels, supported metadata, aux edges, and owning feature metadata where possible.
- Applies the standard boolean-result cleanup pass.

Inputs are left unchanged.

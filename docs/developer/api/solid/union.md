# `Solid.union()`

Runs a boolean union with another solid and returns a new `Solid` with merged face labels, metadata, and aux edges.

## Usage

```js
const result = solid.union(otherSolid);
```

## Signature

```js
solid.union(other, options = {})
```

## Parameters

- `other` (`Solid`) - Solid to union with this solid.
- `options` (`object`, optional) - Boolean behavior controls.

## Options

- `overlapConditioningEnabled` (`boolean`, default `true`) - Enables edge/point proximity conditioning before the native boolean. Set to `false` to send the raw inputs directly to the boolean engine.

## Returns

`Solid` - A new boolean result solid. Face labels, face metadata, edge metadata, auxiliary edges, and owning feature metadata are propagated where supported.

Inputs are not mutated.

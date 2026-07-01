# `Solid.subtract()`

Runs a boolean subtraction (`this - other`) and returns a new `Solid`.

## Usage

```js
const result = solid.subtract(toolSolid);
```

## Signature

```js
solid.subtract(other, options = {})
```

## Parameters

- `other` (`Solid`) - Tool solid to subtract from this solid.
- `options` (`object`, optional) - Boolean behavior controls.

## Options

- `overlapConditioningEnabled` (`boolean`, default `true`) - Enables edge/point proximity conditioning before subtraction. Set to `false` to subtract the raw `other` solid.

## Returns

`Solid` - A new solid representing `this - other`.

Face labels and supported metadata are propagated into the result.

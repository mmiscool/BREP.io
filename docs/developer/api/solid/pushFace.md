# `Solid.pushFace()`

Moves a named face along its computed outward normal by a signed distance. The solid is mutated and returned.

## Usage

```js
solid.pushFace('FRONT', 2);
```

## Signature

```js
solid.pushFace(faceName, distance = 0.001, options = {})
```

## Parameters

- `faceName` (`string`) - Existing face label to move.
- `distance` (`number`, default `0.001`) - Signed offset distance. Positive values move along the computed outward normal; negative values move the opposite direction.
- `options` (`object`, optional) - Warning controls.

## Options

- `warnMissing` (`boolean`, default `true`) - Logs a warning if `faceName` is not found.
- `warnInvalidNormal` (`boolean`, default `true`) - Logs a warning if the face normal cannot be computed.

## Returns

`Solid` - The same solid. If the face is missing, the distance is zero/non-finite, or no valid normal is available, the solid is returned unchanged.

Use this for simple face offsets driven by existing face labels.

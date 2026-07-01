# `Solid.chamfer()`

Asynchronously applies chamfers to resolved edges and returns the resulting solid.

## Usage

```js
const chamfered = await solid.chamfer({
  distance: 1,
  edges: [edgeObj],
  direction: 'INSET'
});
```

## Signature

```js
await solid.chamfer(options = {})
```

## Options

- `distance` (`number`, required) - Chamfer distance. Must be greater than `0`.
- `edgeNames` (`string[]`, optional) - Edge labels to chamfer.
- `edges` (`Edge[]`, optional) - Pre-resolved rendered `Edge` objects that belong to this solid.
- `direction` (`'INSET' | 'OUTSET' | string`, default `'INSET'`) - Boolean side behavior. `INSET` cuts material; `OUTSET` unions outward material.
- `inflate` (`number`, default `0.1`) - Grow/shrink amount for the chamfer tool. The value is negated for `OUTSET`.
- `debug` (`boolean`, default `false`) - Enables debug helpers on the chamfer builder.
- `featureID` (`string`, default `'CHAMFER'`) - Name/owner prefix for generated intermediate solids and result metadata.
- `sampleCount` (`number`, optional) - Sampling override for the chamfer strip.
- `snapSeamToEdge` (`boolean`, optional) - Forces the seam to snap to the source edge.
- `sideStripSubdiv` (`number`, optional) - Side-strip subdivision count.
- `seamInsetScale` (`number`, optional) - Inset scale for the seam.
- `flipSide` (`boolean`, optional) - Flips side selection.
- `debugStride` (`number`, optional) - Sampling stride for debug output.
- `cleanupTinyFaceIslandsArea` (`number`, optional) - Area threshold for post-chamfer tiny face island cleanup.

## Returns

`Promise<Solid>` - The chamfered result solid.

## Errors

Throws when `distance` is missing, non-finite, or not greater than `0`.

Use `edgeNames` or resolved `Edge` objects to identify the target edges.

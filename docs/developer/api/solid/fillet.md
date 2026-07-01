# `Solid.fillet()`

Asynchronously applies constant-radius fillets to resolved edges and returns the resulting solid.

## Usage

```js
const filleted = await solid.fillet({
  radius: 2,
  edges: [edgeObj],
  direction: 'AUTO'
});
```

## Signature

```js
await solid.fillet(options = {})
```

## Options

- `radius` (`number`, required) - Fillet radius. Must be greater than `0`.
- `edges` (`Edge[]`, optional) - Pre-resolved rendered `Edge` objects that belong to this solid.
- `direction` (`'AUTO' | 'INSET' | 'OUTSET' | string`, default `'AUTO'`) - Boolean side selection. `AUTO` classifies per edge; `INSET` and `OUTSET` force the side.
- `inflate` (`number`, default `0.1`) - Inflation for the cutting/union tube.
- `nudgeFaceDistance` (`number`, default `0.0001`) - `pushFace()` amount applied to wedge end caps before boolean operations.
- `resolution` (`number`, default `32`) - Tube circumference segment count.
- `cleanupTinyFaceIslandsArea` (`number`, default `0.01`) - Area threshold for reassigning tiny enclosed face-label islands. Values `<= 0` disable that cleanup.
- `mergeCoplanarEndCaps` (`boolean`, default `true`) - Merge coplanar fillet end caps into adjacent host faces. Disabled when `renameFaces` is `false`.
- `renameFaces` (`boolean`, default `true`) - Allow fillet cleanup to rename/relabel generated faces.
- `collapseFilletSideWalls` (`boolean`, default `true`) - Collapse generated fillet wedge sidewall triangles into the round face.
- `reassignSliverTriangles` (`boolean`, default `true` only when sidewall collapse is disabled) - Reassign tiny fillet sidewall sliver triangles into planar neighbors.
- `debug` (`boolean`, default `false`) - Enables debug visuals in the fillet builder.
- `consoleLogProcess` (`boolean`, default `false`) - Emits fillet process logs without requiring debug visuals.
- `debugSolidsLevel` (`number`, default `0`) - Debug solid emission level: `-1` none, `0` tube and wedge, `1` edge fillet boolean result, `2` all intermediates.
- `debugShowCombinedBeforeTarget` (`boolean`, default `false`) - Emits the combined fillet solid before booleaning it with the target.
- `featureID` (`string`, default `'FILLET'`) - Name/owner prefix for generated intermediate solids and result metadata.

## Returns

`Promise<Solid>` - The filleted result solid.

## Errors

Throws when `radius` is missing, non-finite, or not greater than `0`.

This is the high-level fillet entry point used by the modeling feature code.

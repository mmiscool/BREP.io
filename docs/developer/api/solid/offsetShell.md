# `Solid.offsetShell()`

Builds an offset shell by thickening all faces except the supplied selections, then unioning the thickened patches into a result solid.

## Usage

```js
const shelled = solid.offsetShell(['TOP'], 2, {
  featureId: 'OffsetShell',
  newSolidName: 'ShellResult'
});
```

## Signature

```js
solid.offsetShell(faces, distance, options = {})
```

## Parameters

- `faces` (`string | Face | Array<string | Face>`) - Faces to exclude from shell thickening. Strings are face names; face objects use their current label.
- `distance` (`number`) - Signed shell distance. The implementation thickens remaining faces by `-distance`.
- `options` (`object`, optional) - Naming, union, smoothing, rounded-corner, and debug controls.

## Core Options

- `featureId` (`string`, default `options.name || solid.name || 'OffsetShell'`) - Feature/source ID used for generated geometry and owning feature metadata.
- `name` (`string`, optional) - Fallback source name for `featureId`.
- `newSolidName` (`string`, default `` `${solid.name || 'Solid'}_${featureId}` ``) - Final result solid name.
- `adjacentNormalDotThreshold` (`number`, optional) - Normal-dot threshold used to group connected faces for smoother adjacent normals.
- `smoothAdjacentNormalDotThreshold` (`number`, optional) - Alias/fallback for `adjacentNormalDotThreshold`.
- `nativeBatchUnion` (`boolean`, optional) - Passed to internal `unionMany()` calls.
- `offsetShellUnionStrategy` (`string`, optional) - Union strategy for the main shell union.

## Rounded Corner Options

- `roundedCornerResolution` (`number`, optional) - Resolution for generated rounded-corner pipe geometry.
- `resolution` (`number`, optional) - Fallback for `roundedCornerResolution`.
- `roundedCornerTubePreferFast` (`boolean`, default `true`) - Prefer the fast native rounded-corner tube builder.
- `roundedCornerTubeUnionStrategy` (`string`, optional) - Union strategy for rounded-corner tube union.
- `roundedCornerShellUnionStrategy` (`string`, optional) - Union strategy when recombining shell and rounded-corner geometry.
- `roundedCornerSubtractOverlapConditioningEnabled` (`boolean`, optional) - Passed to rounded-corner subtract booleans.
- `debugSeparateRoundedCornerPipe` (`boolean`, default `false`) - Return/debug with the rounded pipe separated instead of recombined.
- `roundedCornerAreaLossDetectionEnabled` (`boolean`, default `true`) - Detect sidewall area loss during rounded-corner cleanup.
- `roundedCornerPipeSliverCollapseEnabled` (`boolean`, default `true`) - Collapse pipe slivers during cleanup.
- `roundedCornerAreaLossReassignEnabled` (`boolean`, default `true`) - Reassign sidewall area-loss regions when cleanup detects them.
- `roundedCornerCleanupRollbackEnabled` (`boolean`, default `true`) - Roll back rounded-corner cleanup if it damages the shell.
- `roundedCornerSidewallAreaLossThreshold` (`number`, default `0.98`) - Area-loss threshold for sidewall cleanup.
- `roundedCornerSidewallAreaLossMinOriginalArea` (`number`, optional) - Minimum original sidewall area before area-loss checks are applied.
- `debugOffsetShellPipeSliverCollapse` (`boolean`, default `false`) - Enables pipe sliver collapse diagnostics.
- `roundedCornerPipeSliverHeightTolerance` (`number`, optional) - Height tolerance used by pipe sliver collapse.

## Returns

`Solid | null` - The offset shell result, or `null` when `distance` is invalid or no faces remain to thicken.

## Notes

The method calls `this.faces`, so it may trigger `visualize()` before resolving face objects.

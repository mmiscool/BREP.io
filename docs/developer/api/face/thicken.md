# `Face.thicken()`

Builds a new closed solid by offsetting the face and stitching side walls.

## Usage

```js
const thickened = face.thicken(2, { name: 'ThickenedFace' });
```

## Signature

```js
face.thicken(distance, options = {})
```

## Parameters

- `distance` (`number`) - Signed offset distance used to build the thickened solid.
- `options` (`object`, optional) - Naming, source metadata, normal smoothing, splitting/culling, and diagnostics options.

## Common Options

- `name` (`string`, optional) - Result solid name and fallback feature ID.
- `featureId` (`string`, default derived from `name`, `face.name`, or `'THICKEN'`) - Feature/source ID used for generated face labels and metadata.
- `sourceFaceName` (`string`, default derived from the face label) - Source face label used for cap/sidewall naming.
- `sourceFaceNames` (`string[]`, optional) - Source face labels when thickening a grouped face set.
- `sourceFaceMetadataByName` (`Map | object`, optional) - Source metadata copied onto generated faces.
- `weldTolerance` (`number`, optional) - Tolerance used while extracting/welding face surface points.
- `manifoldWeldTolerance` (`number`, optional) - Tolerance used when welding generated solid vertices.
- `equalAdjacentBoundaryNormals` (`boolean`, default `false`) - Uses equal/shared normals across adjacent boundaries.
- `sharedBoundaryNormalMode` (`string`, optional) - Set to `'equal'` to enable equal adjacent boundary normals.
- `disableAdjacentBoundaryNormals` (`boolean`, default depends on boundary-normal mode) - Disables adjacent boundary normal blending.
- `adjacentNormalDotThreshold` (`number`, optional) - Normal-dot threshold for using adjacent boundary normals.
- `adjacentNormalWeightScale` (`number`, optional) - Weight scale for adjacent boundary normal contribution.

## Cleanup And Debug Options

- `trianglePrismUnion` (`boolean`, default `false`) - Use triangle-prism union construction instead of stitched shell construction.
- `repairBoundaryCaps` (`boolean`, default `true`) - Add repair caps for eligible open/intersection boundaries.
- `skipTriangleSplit` (`boolean`, optional) - Skip or force triangle splitting during cleanup.
- `splitSnapTolerance` (`number`, optional) - Snap tolerance passed to self-intersection splitting.
- `snapTolerance` (`number`, optional) - Fallback snap tolerance.
- `splitDiagnostics` (`boolean`, default `false`) - Enable split diagnostics.
- `diagnostics` (`boolean`, default `false`) - General diagnostic flag used by cleanup passes.
- `skipInternalCull` (`boolean`, default `false`) - Skip internal-triangle removal.
- `internalCullMethod` (`'winding' | 'raycast' | string`, optional) - Internal-triangle culling method.
- `windingOptions` (`object`, optional) - Options passed to winding-based internal culling.
- `raycastCullOptions` (`object`, optional) - Options passed to raycast-based internal culling.
- `orientationRepairDistanceLimit` (`number`, optional) - Distance limit for small-thickness orientation repair.
- `orientationRepairMaxPasses` (`number`, optional) - Maximum orientation repair passes.

## Returns

`Solid` - A new closed thickened solid.

This is the face-level entry point into `faceThicken.js`.

# `Solid.unionMany()`

Unions multiple solids in one operation, using the native batch path when available and falling back to pairwise union strategies when needed.

## Usage

```js
const result = solid.unionMany([a, b, c], {
  name: 'merged',
  unionStrategy: 'native_batch',
  skipFailed: false
});

const batch = Solid.unionMany([a, b, c]);
```

## Signature

```js
solid.unionMany(solidsOrOther, options = {})
Solid.unionMany(solids, options = {})
```

## Parameters

- `solidsOrOther` (`Solid | Solid[]`) - For the instance method, the current solid is included automatically, followed by this solid or array of solids.
- `solids` (`Solid[]`) - For the static method, the full list of solids to union.
- `options` (`object`, optional) - Batch boolean behavior and result metadata.

## Options

- `name` (`string`, optional) - Result solid name.
- `featureID` (`string`, optional) - Feature/source identifier used by the native batch builder and owning-feature fallback.
- `featureId` (`string`, optional) - Alias for `featureID`.
- `owningFeatureID` (`string`, optional) - Explicit owning feature ID placed on the result.
- `nativeBatchUnion` (`boolean`, default `true`) - Enables the native batch union path when available.
- `unionStrategy` (`'native_batch' | 'balanced' | 'sequential' | string`, default `'native_batch'`) - Preferred strategy. `balanced` and `sequential` skip the native batch path.
- `skipFailed` (`boolean`, default `false`) - In fallback strategies, skip failed pair unions instead of throwing.
- `overlapConditioningEnabled` (`boolean`, default `true`) - Passed to pairwise `union()` fallback calls.
- `cleanupTinyFaceIslandsArea` (`number`, native batch default from boolean cleanup constant) - Native batch cleanup threshold for tiny face islands.
- `disconnectedIslandMinVolume` (`number`, native batch default from boolean cleanup constant) - Native batch cleanup threshold for disconnected volume islands.

## Returns

`Solid | null` - The merged solid, a single input solid when only one input is supplied, or `null` when there are no valid inputs.

## Diagnostics

The result receives `__unionManyDiagnostics` and `userData.unionMany` with strategy, native-batch status, attempt counts, failure counts, and skipped-solid counts.

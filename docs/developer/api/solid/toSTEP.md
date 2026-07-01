# `Solid.toSTEP()`

Serializes the current solid to a triangulated STEP string.

## Signature

```js
solid.toSTEP(name = solid.name || 'part', options = {})
```

## Usage

```js
const step = solid.toSTEP('part', {
  unit: 'millimeter',
  precision: 6,
  scale: 1,
  applyWorldTransform: true
});
```

## Parameters

- `name` (`string | undefined`, default `solid.name || 'part'`) - Product/part name written into the STEP file. Passing `undefined` lets the exporter use the solid name fallback.
- `options` (`object`, optional) - STEP exporter settings.

## Options

- `unit` (`string`, default `'millimeter'`) - Length unit recorded in the STEP representation context.
- `precision` (`number`, default `6`) - Decimal precision for generated STEP numeric values.
- `scale` (`number`, default `1`) - Multiplier applied to exported vertex coordinates.
- `applyWorldTransform` (`boolean`, default `true`) - Applies the solid's `matrixWorld` during export when it is not identity.
- `mergePlanarFaces` (`boolean`, default `true`) - Groups coplanar triangles into larger faceted BREP faces when possible.
- `planarNormalTolerance` (`number`, default `2e-4`) - Normal tolerance used for planar face grouping.
- `planarDistanceTolerance` (`number`, default derived from model bounds) - Plane-distance tolerance used for planar face grouping.
- `useTessellatedFaces` (`boolean`, default `true`) - Emits AP242 tessellated-face entities for non-planar regions.
- `exportFaces` (`boolean`, default `true`) - Emits face geometry. Disable only for specialized exports.
- `exportEdgesAsPolylines` (`boolean`, default `true`) - Emits boundary edges as polyline curves when edge export is enabled.

## Returns

`string` - STEP ISO 10303-21 text for the solid.

## Behavior

- Exports the current triangulated mesh through `generateSTEP([solid], options)`.
- `name` is copied into `options.name` before export.
- Temporary mesh snapshots are released by the underlying exporter.

Use the options object to control units, precision, scaling, planar merging, and export behavior.

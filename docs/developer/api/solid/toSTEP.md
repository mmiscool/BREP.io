# `Solid.toSTEP()`

Serializes the current solid to a triangulated STEP string.

## Usage

```js
const step = solid.toSTEP('part', {
  unit: 'millimeter',
  applyWorldTransform: true
});
```

Use the options object to control units, precision, scaling, and export behavior.

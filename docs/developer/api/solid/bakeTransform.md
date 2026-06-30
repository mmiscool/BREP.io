# `Solid.bakeTransform()`

Applies a `THREE.Matrix4` directly to the authored vertices, aux edges, and supported metadata fields without changing the `Object3D` transform.

## Usage

```js
const matrix = new THREE.Matrix4().makeTranslation(0, 0, 10);
solid.bakeTransform(matrix);
```

Use this when geometry should move in model space before export or booleans.

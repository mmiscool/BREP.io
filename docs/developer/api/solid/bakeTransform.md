# `Solid.bakeTransform()`

Applies a `THREE.Matrix4` directly to the authored vertices, aux edges, and supported metadata fields without changing the `Object3D` transform.

## Usage

```js
const matrix = new THREE.Matrix4().makeTranslation(0, 0, 10);
solid.bakeTransform(matrix);
```

## Signature

```js
solid.bakeTransform(matrix)
```

## Parameters

- `matrix` (`THREE.Matrix4 | { elements: number[] }`) - Transform matrix to bake into the solid's authored geometry.

## Returns

`Solid` - The same solid, after local authored vertices, aux edges, and transform-sensitive metadata are updated.

## Behavior

- Mutates the solid's authored geometry.
- Marks the cached manifold and face index dirty.
- Leaves the `Object3D` transform unchanged; the transform is applied directly to authored coordinates.

Use this when geometry should move in model space before export or booleans.

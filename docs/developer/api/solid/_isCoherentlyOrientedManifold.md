# `Solid._isCoherentlyOrientedManifold()`

Internal check that reports whether the authored triangles currently form a coherently oriented manifold.

## Usage

```js
const ok = solid._isCoherentlyOrientedManifold();
```

## Signature

```js
solid._isCoherentlyOrientedManifold()
```

## Parameters

None.

## Returns

`boolean` - Whether the authored mesh is coherently oriented.

This is mainly useful for debugging authoring and repair logic.

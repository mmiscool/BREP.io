# `Solid.simplify()`

Calls Manifold simplification and updates the current solid. Depending on `updateInPlace`, it returns either `this` or a rebuilt `Solid`.

## Usage

```js
const simplified = solid.simplify(0.5);
solid.simplify(0.5, true);
```

## Signature

```js
solid.simplify(tolerance = undefined, updateInPlace = false)
```

## Parameters

- `tolerance` (`number | undefined`, optional) - Tolerance passed to Manifold simplification. When omitted, Manifold chooses its default simplification behavior.
- `updateInPlace` (`boolean`, default `false`) - Return behavior flag. If `true`, returns `this`; otherwise returns a rebuilt `Solid` copy.

## Returns

`Solid` - Either `this` when `updateInPlace` is `true`, or a rebuilt solid when `updateInPlace` is `false`.

## Behavior

- Updates the current solid's authoring state from the simplified manifold.
- Preserves face metadata, edge metadata, aux edges, and known face labels when possible.
- Passing an object as the second argument is treated as `false`.

Simplification runs directly on the current manifold and preserves the normal face-boundary behavior of that path.

Read the return behavior carefully before chaining.

# `Solid.simplify()`

Calls Manifold simplification and updates the current solid. Depending on `updateInPlace`, it returns either `this` or a rebuilt `Solid`.

## Usage

```js
const simplified = solid.simplify(0.5);
solid.simplify(0.5, true);
```

Read the return behavior carefully before chaining.

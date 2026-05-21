# `Solid.simplify()`

Calls Manifold simplification and updates the current solid. Depending on `updateInPlace`, it returns either `this` or a rebuilt `Solid`.

## Usage

```js
const simplified = solid.simplify(0.5);
solid.simplify(0.5, true);
solid.simplify(0.5, true, { condenseCoplanarFaces: true });
```

`condenseCoplanarFaces` uses Manifold's `asOriginal().simplify()` path, which can collapse coplanar relation edges and clean small edges more aggressively. It may merge separate coplanar face labels, so the default path preserves face boundaries.

Read the return behavior carefully before chaining.

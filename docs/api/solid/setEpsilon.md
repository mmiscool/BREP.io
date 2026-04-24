# `Solid.setEpsilon()`

Sets the weld epsilon used when preparing geometry. Positive values trigger vertex welding and cleanup; non-positive values disable welding.

## Usage

```js
solid.setEpsilon(0.001);
```

Use this when authored triangles share nearly identical vertices instead of exact matches.

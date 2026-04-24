# `Solid.mergeTinyFaces()`

Renames faces whose total area is below a threshold into their largest adjacent neighbor. The solid is mutated and returned.

## Usage

```js
solid.mergeTinyFaces(0.001);
```

Use this to simplify face labeling after aggressive edits.

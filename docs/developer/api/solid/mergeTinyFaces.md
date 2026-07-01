# `Solid.mergeTinyFaces()`

Renames faces whose total area is below a threshold into their largest adjacent neighbor. The solid is mutated and returned.

## Usage

```js
solid.mergeTinyFaces(0.001);
```

## Signature

```js
solid.mergeTinyFaces(maxArea = 0.001)
```

## Parameters

- `maxArea` (`number`, default `0.001`) - Faces below this area are candidates for merging.

## Returns

`Solid` - The same solid, for chaining.

Use this to simplify face labeling after aggressive edits.

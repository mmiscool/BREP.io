# `Solid.bakeTRS()`

Builds a transform from `{ t, rDeg, s }` and bakes it into the authored geometry.

## Usage

```js
solid.bakeTRS({ t: [0, 0, 10], rDeg: [0, 45, 0], s: [1, 1, 1] });
```

## Signature

```js
solid.bakeTRS(trs)
```

## Parameters

- `trs` (`object`) - Transform components to compose and bake.
- `trs.t` (`[number, number, number]`, default `[0, 0, 0]`) - Translation.
- `trs.rDeg` (`[number, number, number]`, default `[0, 0, 0]`) - Euler rotation in degrees.
- `trs.s` (`[number, number, number]`, default `[1, 1, 1]`) - Scale.

## Returns

`Solid` - The same solid, after authored vertices, aux edges, and related metadata are transformed.

Use this when translation, rotation in degrees, and scale are easier to express than a raw matrix.

# `Solid.faces`

Getter that rebuilds visualization if needed and returns the current `FACE` children attached to the `Solid`.

## Usage

```js
const faceMeshes = solid.faces;
```

## Signature

```js
solid.faces
```

## Parameters

None.

## Returns

`Face[]` - Current rendered face children. Accessing the getter calls `solid.visualize()` first.

This is a convenience for rendered face objects, not a replacement for `getFaces()`.

# `Solid.setEpsilon()`

Sets the weld epsilon used when preparing geometry. Positive values trigger vertex welding and cleanup; non-positive values disable welding.

## Usage

```js
solid.setEpsilon(0.001);
```

## Signature

```js
solid.setEpsilon(epsilon = 0)
```

## Parameters

- `epsilon` (`number`, default `0`) - Vertex weld tolerance. Values `<= 0` disable welding.

## Returns

`Solid` - The same solid, for chaining.

Use this when authored triangles share nearly identical vertices instead of exact matches.

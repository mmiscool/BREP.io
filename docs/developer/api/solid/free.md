# `Solid.free()`

Disposes the cached Manifold instance so wasm memory can be reclaimed. The `Solid` remains usable and will rebuild its manifold lazily on the next query or boolean.

## Usage

```js
solid.free();
```

## Signature

```js
solid.free()
```

## Parameters

None.

## Returns

`Solid` - The same solid.

Call this after expensive operations if you want to release cached native resources early.

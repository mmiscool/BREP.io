# `Solid.fillet()`

Asynchronously applies constant-radius fillets to resolved edges and returns the resulting solid.

## Usage

```js
const filleted = await solid.fillet({
  radius: 2,
  edges: [edgeObj],
  direction: 'AUTO'
});
```

This is the high-level fillet entry point used by the modeling feature code.

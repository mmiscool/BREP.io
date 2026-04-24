# `Face.constructor()`

Creates a rendered face mesh with the standard face material, selection wiring, and bookkeeping for owning solid and neighboring edges.

## Usage

```js
const face = new Face(geometry);
```

Most code receives `Face` objects from `solid.visualize()` rather than constructing them directly.

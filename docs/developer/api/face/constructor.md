# `Face.constructor()`

Creates a rendered face mesh with the standard face material, selection wiring, and bookkeeping for owning solid and neighboring edges.

## Usage

```js
const face = new Face(geometry);
```

## Signature

```js
new Face(geometry)
```

## Parameters

- `geometry` (`THREE.BufferGeometry`) - Geometry used by the rendered face mesh.

## Initializes

- `edges` to `[]`
- `name` to `null`
- `type` to `'FACE'`
- `parentSolid` to `null`
- selection-state wiring for viewport picking

Most code receives `Face` objects from `solid.visualize()` rather than constructing them directly.

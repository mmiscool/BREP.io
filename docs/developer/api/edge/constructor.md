# `Edge.constructor()`

Creates a rendered edge line with standard edge materials, selection wiring, adjacency storage, and closed-loop tracking.

## Usage

```js
const edge = new Edge(geometry);
```

## Signature

```js
new Edge(geometry)
```

## Parameters

- `geometry` (`THREE.BufferGeometry | LineGeometry`) - Geometry used by the rendered line.

## Initializes

- `faces` to `[]`
- `name` to `null`
- `type` to `'EDGE'`
- `closedLoop` to `false`
- selection-state wiring for viewport picking

Most code works with `Edge` objects created by `solid.visualize()`.

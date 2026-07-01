# `Solid.constructor()`

Creates an empty authored solid with vertex buffers, triangle buffers, face-name tracking, metadata maps, and aux-edge storage.

## Usage

```js
import { Solid } from '../src/BREP/BetterSolid.ts';

const solid = new Solid();
```

## Signature

```js
new Solid()
```

## Parameters

None.

## Initializes

Authored vertex buffers, triangle buffers, face-name/ID maps, face metadata, edge metadata, aux-edge storage, manifold cache state, and standard `THREE.Group` state.

Use this as the starting point for manual triangle authoring or as the base class for generated solids.

# Solid Developer Guide

`Solid` lives in `src/BREP/BetterSolid.ts` and extends `THREE.Group`.

This page is now the concise developer overview for working with `Solid`. The canonical per-method reference lives in the [Solid API index](./api/solid/index.md).

## Use This Page For

- Understanding what `Solid` is responsible for in the kernel.
- Learning the main authoring and boolean workflow.
- Jumping to the right detailed method page quickly.

## Canonical API Docs

- [Solid API index](./api/solid/index.md)
- [Face API index](./api/face/index.md)
- [Edge API index](./api/edge/index.md)

## Mental Model

- `Solid` stores authored triangle geometry in flat arrays plus face-label mappings.
- `_manifoldize()` turns authored arrays into a cached Manifold object for booleans, measurements, and export.
- `visualize()` builds `Face` and `Edge` objects for selection, PMI, and UI inspection.
- Face labels are semantic names attached per triangle and preserved through reconstruction and boolean operations.

## Common Workflows

### Author a solid manually

Use:
- [constructor()](./api/solid/constructor.md)
- [addTriangle()](./api/solid/addTriangle.md)
- [setFaceMetadata()](./api/solid/setFaceMetadata.md)
- [setEpsilon()](./api/solid/setEpsilon.md)

```js
import { Solid } from '../src/BREP/BetterSolid.ts';

const solid = new Solid();
solid.addTriangle('TOP', [0, 0, 1], [1, 0, 1], [0, 1, 1]);
```

### Transform or inspect a solid

Use:
- [bakeTransform()](./api/solid/bakeTransform.md)
- [bakeTRS()](./api/solid/bakeTRS.md)
- [getFace()](./api/solid/getFace.md)
- [getFaces()](./api/solid/getFaces.md)
- [getBoundaryEdgePolylines()](./api/solid/getBoundaryEdgePolylines.md)
- [volume()](./api/solid/volume.md)
- [surfaceArea()](./api/solid/surfaceArea.md)

### Clean up authored or booleaned geometry

Use:
- [fixTriangleWindingsByAdjacency()](./api/solid/fixTriangleWindingsByAdjacency.md)
- [removeTinyBoundaryTriangles()](./api/solid/removeTinyBoundaryTriangles.md)
- [collapseTinyTriangles()](./api/solid/collapseTinyTriangles.md)
- [removeInternalTriangles()](./api/solid/removeInternalTriangles.md)
- [cleanupTinyFaceIslands()](./api/solid/cleanupTinyFaceIslands.md)
- [mergeTinyFaces()](./api/solid/mergeTinyFaces.md)

### Run booleans or feature builders

Use:
- [union()](./api/solid/union.md)
- [subtract()](./api/solid/subtract.md)
- [intersect()](./api/solid/intersect.md)
- [chamfer()](./api/solid/chamfer.md)
- [fillet()](./api/solid/fillet.md)

### Export or visualize

Use:
- [visualize()](./api/solid/visualize.md)
- [toSTL()](./api/solid/toSTL.md)
- [toSTEP()](./api/solid/toSTEP.md)

## Related Pages

- [Kernel and Geometry Docs](./developer/kernel/index.md)
- [BREP Class API Reference](./api/index.md)
- [BREP Kernel Reference](./brep-kernel.md)
- [BREP.js Export Map and Usage](./brep-api.md)
- [BREP Model and Classes](./brep-model.md)

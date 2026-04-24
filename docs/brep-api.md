# BREP.js Export Map and Usage

`src/BREP/BREP.js` aggregates the modeling API under a single `BREP` namespace. Import it once and destructure what you need:

```js
import { BREP } from '../src/BREP/BREP.js';
const { Solid, Cube, Sweep, filletSolid, applyBooleanOperation } = BREP;
```

## Core classes
- `THREE` — Re-export of the project's bundled three.js.
- `Solid` — Authoring + CSG wrapper.
- `Face`, `Edge`, `Vertex` — Visualization/selection helpers attached during `visualize()`.
- `Face.thicken(distance, options)` — Builds a new closed solid from an open face by offsetting the face along its normals and stitching side walls.

## Reference pages
- [Kernel and Geometry Docs](./developer/kernel/index.md)
- [Class API reference](./api/index.md)
- [Solid methods](./api/solid/index.md)
- [Face methods](./api/face/index.md)
- [Edge methods](./api/edge/index.md)
- [Kernel architecture overview](./brep-kernel.md)

## Export categories

### Primitive solids
- `Cube`, `Pyramid`, `Sphere`, `Cylinder`, `Cone`, `Torus` — Parameterized primitives that extend `Solid`.
- `Tube` — Alias of `TubeSolid` for swept tubes along a polyline.

### Feature solids
- `Sweep` — Sweep a face along a path/axis; one side wall per input edge.
- `Revolve` — Revolve a face around an axis for a closed or partial solid.
- `ExtrudeSolid` — Translate a face with optional back distance; names caps and side walls.
- `ChamferSolid` — Builds bevel geometry along an edge for inset/outset chamfers.
- `Face.thicken(distance, options)` — Thickens an existing `Face` selection into a new `Solid`.

### Fillet helpers
- `filletSolid(options)` — Builds wedge/tube/final fillet solids for an edge; supports `inflate`, `resolution`, and `showTangentOverlays` for debugging.
- `computeFilletCenterline(edgeObj, radius, sideMode)` — Returns centerline/tangent/edge polylines plus a `closedLoop` flag.
- `attachFilletCenterlineAuxEdge(solid, edgeObj, radius, sideMode, name, options)` — Adds the centerline as an aux edge on a solid.

### Boolean and conversion utilities
- `applyBooleanOperation({ op, targets, tools, simplify })` — High-level boolean runner for feature code.
- `MeshToBrep` — Wrap an imported mesh as a `Solid` with face labels.
- `MeshRepairer` — Tools to detect and fix mesh issues before conversion/CSG.

### Assembly helper
- `AssemblyComponent` — Groups one or more solids for the assembly constraint system.

## Quick example
```js
import { BREP } from '../src/BREP/BREP.js';

const box = new BREP.Cube({ x: 10, y: 10, z: 10, name: 'Box' });
const cyl = new BREP.Cylinder({ radius: 3, height: 10, name: 'Hole' });

// Center the cylinder through the box
cyl.position.set(5, 5, 0);
cyl.bakeTransform(cyl.matrixWorld);

// Subtract to make a through-hole
const result = box.subtract(cyl);
result.name = 'BoxWithHole';
result.visualize();
```

## Scope

This page exists to answer "what does `BREP.js` export?" It does not duplicate the class method docs or kernel internals.

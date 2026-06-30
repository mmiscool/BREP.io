# BREP Kernel Reference

This page describes the structure of the BREP kernel and where responsibilities live in `src/BREP`. It is the architecture overview, not the canonical method reference.

Use these pages alongside it:
- [Kernel and Geometry Docs](./developer/kernel/index.md) for the navigable kernel doc section.
- [BREP Class API Reference](./api/index.md) for per-method docs.
- [BREP.js Export Map and Usage](./brep-api.md) for public exports.
- [Solid Developer Guide](./solid-methods.md) for the high-level `Solid` workflow.

## Class Docs

- [Solid API Index](./api/solid/index.md)
- [Face API Index](./api/face/index.md)
- [Edge API Index](./api/edge/index.md)
- [Solid Developer Guide](./solid-methods.md)

## Core types
- **Solid / Face / Edge / Vertex** – Core geometry and selection primitives. API docs live under [docs/api/](./api/index.md).
- **AssemblyComponent** – Assembly-level grouping and transform unit for constraints.

## Primitives (`src/BREP/primitives.ts`)
All extend `Solid` and immediately generate geometry.
- `Cube({ x=1, y=1, z=1, name })`
- `Pyramid({ bL=1, s=4, h=1, name })` (`s` is side count ≥ 3)
- `Sphere({ r=1, resolution=24, name })`
- `Cylinder({ radius=1, height=1, resolution=32, name })`
- `Cone({ r1=0.5, r2=1, h=1, resolution=32, name })`
- `Torus({ mR=2, tR=0.5, resolution=48, arcDegrees=360, name })`

## Feature solids
- **ExtrudeSolid** – `{ face, distance=1 | dir:Vector3, distanceBack=0, name='Extrude' }`.
- **Sweep** – `{ face, sweepPathEdges=[], distance=1, distanceBack=0, mode='translate', name='Sweep', omitBaseCap=false }`.
- **Revolve** – `{ face, axis, angle=360, resolution=64, name='Revolve' }`.
- **TubeSolid (Tube)** – `{ points=[], radius=1, innerRadius=0, resolution=32, closed=false, name='Tube' }`.
- **ChamferSolid** – `{ edgeToChamfer, distance=1, sampleCount=50, snapSeamToEdge=true, sideStripSubdiv=8, seamInsetScale=1e-3, direction='INSET'|'OUTSET', inflate=0, flipSide=false, debug=false, debugStride=12 }`.
- **OffsetShellSolid.generate(sourceSolid, distance, { newSolidName, featureId='OffsetShell' })** – Static helper to build offset shells.
- **Face.thicken(distance, options)** – Face-level helper for turning a rendered face into a closed solid.

## Face thickening (`src/BREP/faceThicken.ts`)
- `thickenFaceToSolid(face, distance, options = {})` is the implementation behind `Face.thicken(...)`.
- Requires a valid face with triangulated geometry and a non-zero finite distance.
- Tries a stitched-shell build first, then falls back to deterministic prism-union construction when needed.
- Emits diagnostics on the result:
  - `result.__thickenMethod`
  - `result.__thickenClassificationMethod`
  - `result.__thickenDiagnostics`
  - `result.userData.thicken`
- Propagates available source-face metadata onto the generated start/end cap faces.

## Fillet utilities (`src/BREP/fillets/fillet.ts`)
- `filletSolid({ edgeToFillet, radius, sideMode='INSET'|'OUTSET', inflate=0.1, resolution=32, showTangentOverlays=false, debug=false, name='fillet' })` – Builds wedge/tube helpers and returns `{ finalSolid, tube, wedge }`; overlays add tangency polylines to the tube for debugging/PMI tagging.
- `computeFilletCenterline(edgeObj, radius, sideMode)` – Returns centerline/tangents/edge polylines plus a `closedLoop` flag.
- `attachFilletCenterlineAuxEdge(solid, edgeObj, radius, sideMode='INSET', name='FILLET_CENTERLINE', options)` – Adds centerline as an aux edge; `options` mirrors `Solid.addAuxEdge`.

## Boolean helper
- `applyBooleanOperation(partHistory, baseSolid, booleanParam, featureID)` – Runs `UNION|INTERSECT|SUBTRACT` between `baseSolid` and `booleanParam.targets` (objects or names). Returns `{ added, removed }`. Subtract semantics invert: each target subtracts the new base.

## Conversion and repair
- **MeshToBrep** – `new MeshToBrep(geometryOrMesh, faceDeflectionAngle=30, weldTolerance=1e-5)` groups triangles into faces based on normal deflection and welds shared vertices.
- **MeshRepairer** – Per-geometry repair pipeline:
  - `weldVertices(geometry, epsilon=1e-4)`
  - `fixTJunctions(geometry, lineEps=5e-4, gridCell=0.01)`
  - `removeOverlappingTriangles(geometry, posEps=1e-6)`
  - `fillHoles(geometry)`
  - `fixTriangleNormals(geometry)`
  - `repairAll(geometry, { weldEps=5e-4, lineEps=5e-4, gridCell=0.01 })`

## How To Read The Kernel Docs

- Start here when you need file-level orientation or want to know which module owns a behavior.
- Use [docs/api/](./api/index.md) when you need exact method behavior or examples.
- Use [brep-api.md](./brep-api.md) when you need to know what is exported from `BREP.js`.
- Use [brep-model.md](./brep-model.md) when you want the compact data-model summary.

## Example: boolean with primitives
```js
import { BREP } from '../src/BREP/BREP.ts';

const box = new BREP.Cube({ x: 20, y: 10, z: 10, name: 'Box' });
const hole = new BREP.Cylinder({ radius: 3, height: 10, name: 'Hole' });
hole.position.set(10, 5, 0);
hole.bakeTransform(hole.matrixWorld);

const result = box.subtract(hole);
result.name = 'BoxWithHole';
result.visualize();
```

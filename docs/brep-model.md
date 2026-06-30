# BREP Model and Classes

This page is the compact conceptual summary of the BREP data model. It is intentionally shorter than the API reference and kernel architecture pages.

## Overview
- BREP combines a triangle mesh with per-triangle face labels. Labels map to globally unique IDs in Manifold so selections survive boolean operations.
- During manifoldization, triangle windings are made consistent, outward orientation is enforced, and an optional weld epsilon deduplicates vertices.
- `manifold-3d` provides robust manifold meshes while propagating face IDs through CSG, so selections remain stable after union, subtract, and intersect operations.
- Visualization builds one mesh per face label and edge polylines for label boundaries, enabling semantic selection in the UI and PMI tooling.

## Solid
- `Solid` is a `THREE.Group` subclass that handles authoring, CSG, queries, and export.
- Geometry storage uses `_vertProperties` (flat positions), `_triVerts` (triangle indices), and `_triIDs` (face IDs) plus name-to-ID maps.
- Full `Solid` API details live in the [Solid Developer Guide](./solid-methods.md) and [Solid API index](./api/solid/index.md).

## Face
- `Face` is a `THREE.Mesh` representing all triangles that share a label.
- Provides `getAverageNormal()` and `surfaceArea()` helpers for inspection and downstream logic.
- Provides `thicken(distance, options)` to build a new closed solid from an open face by offsetting along face normals and stitching side walls.
- Full `Face` method docs live in the [Face API index](./api/face/index.md).

## Edge
- `Edge` instances represent boundary polylines between two face labels and expose metadata describing the adjacent faces.
- Use edges for PMI dimension snapping, measurement, and preview visualization.
- Full `Edge` method docs live in the [Edge API index](./api/edge/index.md).

## Use This Page Vs Others

- Use this page for the conceptual model.
- Use [brep-kernel.md](./brep-kernel.md) for source-level architecture.
- Use [docs/api/](./api/index.md) for exact method behavior.

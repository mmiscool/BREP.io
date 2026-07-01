# Kernel and Geometry Docs

Use this section for the BREP kernel, geometry data model, class APIs, topology tracking, and export behavior.

## Start Here

- [BREP Kernel Reference](./brep-kernel.md) - source-level overview of `src/BREP` responsibilities.
- [BREP Model and Classes](./brep-model.md) - compact conceptual summary of the geometry model.
- [BREP.js Export Map and Usage](./brep-api.md) - what is publicly exported from `BREP.js`.

## Core Classes

- [Solid Developer Guide](./solid-methods.md) - workflow-oriented overview for `Solid`.
- [Solid API Index](../api/solid/index.md) - canonical per-method reference for `Solid`.
- [Face API Index](../api/face/index.md) - canonical per-method reference for `Face`.
- [Edge API Index](../api/edge/index.md) - canonical per-method reference for `Edge`.
- [BREP Class API Reference](../api/index.md) - hub for all kernel class method docs.

## Kernel Topics

- [Topological Face Naming and Triangle Ownership](./topological-face-tracking.md)
- [Radius Metadata for Extruded Sketches](./extruded-sketch-radius-embedding.md)
- [Cylindrical Face Radius Embedding](./cylindrical-face-radius-embedding.md)
- [Simplified Radial Dimensions](./simplified-radial-dimensions.md)
- [Fillet Process](./fillet-process.md)
- [File Formats: Import and Export](../../file-formats.md)
- [C++ Solid Porting Notes](./cpp-solid-porting.md)

## Example Pages

- [BREP Booleans Demo](https://BREP.io/apiExamples/BREP_Booleans.html)
- [BREP Primitives Demo](https://BREP.io/apiExamples/BREP_Primitives.html)
- [BREP Transforms Demo](https://BREP.io/apiExamples/BREP_Transforms.html)
- [BREP Export Demo](https://BREP.io/apiExamples/BREP_Export.html)

## Suggested Reading Order

1. Read [BREP Kernel Reference](./brep-kernel.md) for structure
2. Open [BREP Class API Reference](../api/index.md) for exact class behavior
3. Use the topic pages above for deeper geometry-specific behavior

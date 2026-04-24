# C++ Solid Porting

This is the first step toward moving the BREP kernel off the JavaScript side and into the custom manifold wasm build.

## Current foundation

- `manifold-plus/BrepSolidCore` is now compiled into the custom wasm module.
- It owns:
  - authoring vertex and triangle buffers
  - face-name to face-ID mapping
  - reverse face-ID to face-name mapping
  - face metadata and edge metadata as JSON blobs
- It can now ingest/export full Solid authoring snapshots and run `bakeTransform`
  over the vertex buffer on the C++ side.
- It now also runs `weldVerticesByEpsilon` and `pushFace` on the C++ side.
- `src/BREP/CppSolidCore.js` provides the JS bridge layer used by tests and future API adaptation work.
- Migrated methods now require the custom local manifold build; they do not silently
  fall back to the old JS implementation.

## Why this boundary

The current `Solid` implementation mixes several concerns:

- authoring-state ownership
- face-ID reservation and face-tag preservation
- metadata storage and renaming
- heavy geometry cleanup and transform work
- manifold construction and boolean reconstruction
- visualization-only extraction

The first thing to move is the authoring-state owner, because every later expensive operation depends on that state staying canonical in one place.

## Next phases

1. Move JS authoring helpers into `BrepSolidCore`
   - `_key`
   - `_getPointIndex`
   - `_getOrCreateID`
   - `addTriangle`
   - metadata set/get

2. Continue moving bulk authoring transforms into `BrepSolidCore`
   - `bakeTransform` is now running in C++ via the bridge
   - `pushFace` is now running in C++ via the bridge
   - weld-by-epsilon is now running in C++ via the bridge
   - next targets: mirror and cleanup/remesh passes

3. Move mesh/manifold rebuild work into `BrepSolidCore`
   - winding correction
   - weld / epsilon handling
   - `_manifoldize`
   - boolean result reconstruction

4. Move expensive geometry transforms and cleanup
   - `mirrorAcrossPlane`
   - remesh / degenerate cleanup / internal-triangle removal

5. Keep visualization in JS
   - `THREE.Group`
   - scene objects
   - material assignment
   - conversion of kernel state into renderable meshes/edges

## Practical rule

Anything that mutates or scans triangle/vertex buffers at scale should migrate into C++.
Anything that exists only to build scene objects for `three.js` should stay on the JS side.

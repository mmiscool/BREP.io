# Solid Methods Reference

`Solid` lives in `src/BREP/BetterSolid.js` and extends `THREE.Group`. Examples below assume:

```js
import { Solid } from '../src/BREP/BetterSolid.js';
const solid = new Solid();
```

## Conventions

- Methods that return `this` mutate the Solid (authoring buffers, metadata, and/or cached manifold).
- Methods that return a new `Solid` leave the original unchanged unless noted.
- Many queries/exports trigger `_manifoldize()` and allocate wasm resources.
- `getMesh()` returns a wasm-backed `ManifoldMesh`; call `mesh.delete()` when finished.
- `writeSTL`/`writeSTEP` are Node-only and throw in the browser.
- Face labels are per-triangle IDs; a single face name can span many non-coplanar triangles.

## Lifecycle

### constructor()
Initializes empty authoring buffers, face/edge metadata maps, aux-edge storage, and marks the manifold cache dirty. No parameters.
```js
const s = new Solid();
```

### clone()
Creates a lightweight copy of geometry, face/edge metadata, and aux edges (no THREE children or GPU resources). Returns a new Solid with a dirty manifold cache.
```js
const copy = solid.clone();
```

### free()
Disposes the cached `Manifold` instance to release wasm memory; clears any auto-free timer. The Solid remains usable and will rebuild on demand. Returns `this`.
```js
solid.free();
```

### faces (getter)
Ensures `visualize()` has run (clears and rebuilds children), then returns `FACE` children currently attached to the group. Accessing this can be expensive for large meshes.
```js
const faceMeshes = solid.faces;
```

## Authoring

### addTriangle(faceName, v1, v2, v3)
Appends a CCW triangle labeled with `faceName`; vertices are uniqued by exact coordinates. Returns `this`, marks the manifold cache dirty, and throws if any coordinate is non-finite.
```js
solid.addTriangle('TOP', [0, 0, 0], [1, 0, 0], [0, 1, 0]);
```

### _key([x, y, z])
Internal: builds the exact string key used for vertex deduplication.
```js
const key = solid._key([0, 0, 0]); // "0,0,0"
```

### _getPointIndex(point)
Internal: returns the existing vertex index or appends the point to the authoring buffer.
```js
const idx = solid._getPointIndex([1, 2, 3]);
```

### _getOrCreateID(faceName)
Internal: maps a face name to a globally unique Manifold ID, creating one if needed.
```js
const faceId = solid._getOrCreateID('SIDE');
```

### addAuxEdge(name, points, options)
Stores a helper polyline (e.g., centerline) for visualization alongside the solid. Aux edges do not affect the manifold or booleans. Points can be `[x,y,z]` arrays or `{x,y,z}` objects. Returns `this`.
```js
solid.addAuxEdge('CENTER', [[0, 0, 0], [0, 0, 5]], {
  closedLoop: false,       // render as loop when true
  polylineWorld: false,    // points already in world space?
  materialKey: 'OVERLAY',  // visualization material tag
  centerline: true         // optional; also inferred from name
});
```

### addCenterline(a, b, name?, options?)
Convenience wrapper that records a two-point aux edge with `centerline: true`. Returns `this`.
```js
solid.addCenterline([0, 0, 0], [0, 0, 10], 'AXIS', {
  closedLoop: false,
  polylineWorld: false,
  materialKey: 'OVERLAY'
});
```

## Metadata

### setFaceMetadata(faceName, metadata)
Attaches arbitrary metadata to a face label (merged if it already exists). No-op if `metadata` is not an object. Returns `this`.
```js
solid.setFaceMetadata('CYL_SIDE', { radius: 5, axis: [0, 0, 1] });
```

### getFaceMetadata(faceName)
Reads face metadata; returns `{}` when unset. The returned object is the stored metadata (mutating it updates the entry).
```js
const data = solid.getFaceMetadata('CYL_SIDE');
```

### renameFace(oldName, newName)
Renames a face label; if `newName` already exists, triangles are reassigned and metadata is merged. Marks the solid dirty when triangles move.
```js
solid.renameFace('SIDE_A', 'SIDE_MAIN');
```

### getFaceNames()
Lists all face labels currently tracked on the solid (may include labels with zero triangles).
```js
const names = solid.getFaceNames();
```

### setEdgeMetadata(edgeName, metadata)
Stores metadata for boundary edges (used by PMI and downstream tooling). No-op if `metadata` is not an object. Returns `this`.
```js
solid.setEdgeMetadata('EDGE_A', { tag: 'reference' });
```

### getEdgeMetadata(edgeName)
Reads edge metadata; returns `null` when unset. The returned object is the stored metadata reference.
```js
const edgeInfo = solid.getEdgeMetadata('EDGE_A');
```

### _combineFaceMetadata(other)
Internal: merges face metadata maps across solids (used during booleans).
```js
const combined = solid._combineFaceMetadata(otherSolid);
```

## Transforms and offsets

### bakeTransform(matrix)
Applies a `THREE.Matrix4` to authored vertices and aux edges, updates face metadata centers/axes, and rebuilds the vertex index map. Does not change the Object3D transform. Returns `this`.
```js
const m = new THREE.Matrix4().makeTranslation(0, 0, 10);
solid.bakeTransform(m);
```

### bakeTRS(trs)
Composes and bakes a transform from `{ t, rDeg, s }` using `composeTrsMatrixDeg` (rotation in degrees). Returns `this`.
```js
solid.bakeTRS({ t: [0, 0, 10], rDeg: [0, 45, 0], s: [1, 1, 1] });
```

### offsetFace(faceName, distance)
Moves all vertices of a labeled face along its average normal by `distance` using the current manifold mesh. No-op if the face name is unknown or `distance` is 0. Returns `this`.
```js
solid.offsetFace('TOP', 2.0);
```

### mirrorAcrossPlane(point, normal)
Returns a mirrored clone across a plane defined by a point and normal. Face name maps and aux edges are preserved; face/edge metadata is not copied.
```js
const mirrored = solid.mirrorAcrossPlane([0, 0, 0], [1, 0, 0]);
```

### pushFace(faceName, distance)
Translates a face along its outward normal using current triangle windings. Planar faces use the area-weighted average normal; curved faces use per-vertex normals. Returns `this` (warns if the face is missing).
```js
solid.pushFace('FRONT', 1.5);
```

## Manifold, orientation, and welding

### setEpsilon(epsilon)
Sets weld tolerance (<= 0 disables). When > 0, welds existing vertices, drops degenerate triangles, then fixes triangle winding. Returns `this`.
```js
solid.setEpsilon(0.001);
```

### _weldVerticesByEpsilon(epsilon)
Internal: welds vertices on a grid using `epsilon`, drops degenerate triangles, and marks dirty.
```js
solid._weldVerticesByEpsilon(0.0005);
```

### fixTriangleWindingsByAdjacency()
Ensures shared edges have opposite orientation so the mesh is coherently oriented. No-op if already coherent; returns `this`.
```js
solid.fixTriangleWindingsByAdjacency();
```

### _isCoherentlyOrientedManifold()
Checks whether every undirected edge is shared by two triangles with opposite directions.
```js
const ok = solid._isCoherentlyOrientedManifold();
```

### invertNormals()
Flips all triangles (swaps indices 1 and 2) and rebuilds the manifold cache. Returns `this`.
```js
solid.invertNormals();
```

### _manifoldize()
Builds or returns the cached `Manifold` from authored arrays (fixes winding and orientation first). Internal; schedules auto-free of wasm resources and should be used sparingly.
```js
const manifold = solid._manifoldize();
```

## Mesh cleanup and refinement

### remesh({ maxEdgeLength, maxIterations })
Splits edges longer than `maxEdgeLength`, preserving face IDs, and fixes winding after changes. Mutates and returns `this` (no-op if `maxEdgeLength` is invalid).
```js
solid.remesh({
  maxEdgeLength: 5, // required threshold
  maxIterations: 2  // optional passes (default 10)
});
```

### removeSmallIslands({ maxTriangles, removeInternal, removeExternal })
Deletes small connected triangle components relative to the largest shell; classifies components as inside/outside the main shell, and returns count removed. Mutates geometry and marks the manifold dirty.
```js
const removed = solid.removeSmallIslands({
  maxTriangles: 20,    // island size threshold
  removeInternal: true, // drop islands inside main shell
  removeExternal: true  // drop islands outside main shell
});
```

### removeSmallInternalIslands(maxTriangles)
Convenience wrapper removing only internal islands under the given triangle count; returns count removed.
```js
solid.removeSmallInternalIslands(15);
```

### removeOppositeSingleEdgeFaces(options?)
Removes faces that only connect via a single shared edge chain to an opposite-facing neighbor; returns triangles removed and mutates geometry.
```js
const removed = solid.removeOppositeSingleEdgeFaces({
  normalDotThreshold: -0.95 // dot threshold for opposite normals
});
```

### removeTinyBoundaryTriangles(areaThreshold, maxIterations?)
Performs edge flips across inter-face boundaries to remove triangles below `areaThreshold`. Returns the number of flips applied and mutates geometry.
```js
solid.removeTinyBoundaryTriangles(0.001, 3);
```

### collapseTinyTriangles(lengthThreshold)
Collapses triangles whose shortest edge is below `lengthThreshold`, then cleans up via a bounding-box intersect; returns number of edge collapses and mutates geometry.
```js
const collapses = solid.collapseTinyTriangles(0.05);
```

### splitSelfIntersectingTriangles(diagnostics?)
Detects intersecting triangle pairs and subdivides them in place while preserving face IDs; returns splits applied. When `diagnostics` is truthy, logs detailed debug output to the console.
```js
solid.splitSelfIntersectingTriangles();
```

### removeDegenerateTriangles()
Drops triangles with duplicate vertices or near-zero area; returns removed count. Leaves the vertex buffer as-is (orphan vertices may remain) and does not rebuild the manifold cache.
```js
const removed = solid.removeDegenerateTriangles();
```

### removeInternalTriangles(options?)
Rebuilds authoring arrays from the manifold’s exterior surface, removing internal faces; returns removed count. If manifoldization fails, falls back to a winding- or ray-based classifier (configurable via `options`).
```js
solid.removeInternalTriangles();
solid.removeInternalTriangles({ fallback: 'raycast' });
solid.removeInternalTriangles({ fallback: 'winding', windingOptions: { offsetScale: 1e-5 } });
```

### removeInternalTrianglesByRaycast()
Uses centroid ray tests to cull triangles inside the solid without requiring manifoldization; returns removed count. This is O(n^2) in triangle count and can be slow on dense meshes.
```js
solid.removeInternalTrianglesByRaycast();
```

### removeInternalTrianglesByWinding(options?)
Uses solid-angle winding numbers at triangle centroids to delete interior triangles; returns removed count. Robust to self-intersections and does not require manifoldization.
```js
solid.removeInternalTrianglesByWinding({
  offsetScale: 1e-4,      // centroid offset relative to bbox diagonal
  crossingTolerance: 0.05 // tolerance for interior crossing test
});
```

### cleanupTinyFaceIslands(size)
Reassigns disconnected triangle islands smaller than `size` (area) to the largest adjacent face; returns triangles reassigned and updates face IDs in-place.
```js
const reassigned = solid.cleanupTinyFaceIslands(0.002);
```

### mergeTinyFaces(maxArea?)
Renames faces whose total area is below `maxArea` into their largest adjacent neighbor; returns `this` and rebuilds caches when merges occur.
```js
solid.mergeTinyFaces(0.001);
```

## Queries and measurements

### getMesh()
Returns a fresh MeshGL view (`{ vertProperties, triVerts, faceID }`) from the cached manifold. Call `mesh.delete()` when finished to release wasm memory.
```js
const mesh = solid.getMesh();
console.log(mesh.triVerts.length / 3, 'triangles');
mesh.delete?.(); // cleanup when finished
```

### _ensureFaceIndex()
Internal: builds a cache mapping face IDs to triangle indices for fast lookups.
```js
solid._ensureFaceIndex();
```

### getFace(name)
Returns the triangles for a face label with positions and indices (`{ faceName, indices, p1, p2, p3 }`), or an empty array if the label is missing.
```js
const tris = solid.getFace('TOP');
```

### getFaces(includeEmpty?)
Enumerates all faces as `{ faceName, triangles }`, optionally including faces with no triangles. Each triangle entry matches `getFace()` (`{ faceName, indices, p1, p2, p3 }`).
```js
const faces = solid.getFaces();
```

### getBoundaryEdgePolylines()
Extracts boundary polylines between differing face labels. Returns entries like `{ name, faceA, faceB, positions, indices, closedLoop }`.
```js
const edges = solid.getBoundaryEdgePolylines();
```

### getTriangleCount()
Counts triangles in the current manifold mesh.
```js
const triCount = solid.getTriangleCount();
```

### volume()
Computes absolute volume from the manifold mesh.
```js
const vol = solid.volume();
```

### surfaceArea()
Computes total surface area from the manifold mesh.
```js
const area = solid.surfaceArea();
```

## Boolean and reconstruction helpers

### _combineIdMaps(other)
Internal: merges face ID → name maps before constructing boolean results.
```js
const mergedMap = solid._combineIdMaps(otherSolid);
```

### union(other) / subtract(other) / intersect(other) / difference(other)
Runs the corresponding boolean CSG against `other`, returning a new Solid with merged face labels, metadata, and aux edges. Inputs are not mutated. The boolean result also collapses duplicate face IDs that share the same face name so boundaries are generated by label, not by stale IDs.
```js
const united = solid.union(otherSolid);
const cut = solid.subtract(toolSolid);
const common = solid.intersect(otherSolid);
const diff = solid.difference(otherSolid); // alias of subtract
```

### setTolerance(tolerance)
Returns a new Solid built from `Manifold.setTolerance(tolerance)` to adjust robustness (does not mutate the source Solid).
```js
const tolerant = solid.setTolerance(0.02);
```

### simplify(tolerance?, updateInPlace?)
Calls `Manifold.simplify`; always updates the current Solid's arrays and cached manifold. When `updateInPlace` is truthy it returns `this`; otherwise it returns a new Solid built from the simplified manifold (the original is still simplified).
```js
const simplified = solid.simplify(0.5);       // new Solid; original is also simplified
solid.simplify(0.5, true);                    // returns this (in-place)
```

### _expandTriIDsFromMesh(mesh) (static)
Static helper that expands `faceID` on a MeshGL to a JS array, defaulting to zeros when absent.
```js
const ids = Solid._expandTriIDsFromMesh(mesh);
```

### _fromManifold(manifoldObj, idToFaceName) (static)
Static constructor that builds a Solid from an existing `Manifold` plus an ID → face-name map.
```js
const rebuilt = Solid._fromManifold(existingManifold, existingMap);
```

## Export and visualization

### toSTL(name?, precision?)
Generates an ASCII STL string from the current manifold mesh.
```js
const stl = solid.toSTL('part', 5);
```

### writeSTL(filePath, name?, precision?)
Node-only helper that writes the STL string to disk. Throws in the browser and resolves with the written file path.
```js
await solid.writeSTL('out/part.stl', 'part', 6);
```

### toSTEP(name?, options?)
Generates a triangulated STEP string (AP242 tessellated by default) for this solid. Options are forwarded to the STEP exporter; `applyWorldTransform` defaults to true and will use `matrixWorld` when available. Supported options include:
- `unit` (`'millimeter'` default, or `'meter'|'micron'|'inch'|'foot'`)
- `precision` (decimal places, default `6`)
- `scale` (uniform scale, default `1`)
- `applyWorldTransform` (default `true`)
- `mergePlanarFaces` (default `true`)
- `planarNormalTolerance` (default `2e-4`)
- `planarDistanceTolerance` (default `max(2e-5, bboxDiag * 2e-5)`)
- `useTessellatedFaces` (default `true`)
- `exportFaces` (default `true`)
- `exportEdgesAsPolylines` (default `true`)
```js
const step = solid.toSTEP('part', {
  unit: 'millimeter',
  precision: 6,
  applyWorldTransform: true
});
```

### writeSTEP(filePath, name?, options?)
Node-only helper that writes the STEP string to disk. Throws in the browser and resolves with the written file path.
```js
await solid.writeSTEP('out/part.step', 'part', { unit: 'millimeter' });
```

### visualize(options?)
Clears children, disposes existing geometries/materials, builds one `Face` mesh per face label, and optional boundary `Edge` polylines; also adds `Vertex` markers and aux edges. Uses the manifold by default but can fall back to authoring arrays if manifoldization fails. Returns `this`.
```js
solid.visualize({
  showEdges: true,        // include boundary polylines
  forceAuthoring: false,  // force authoring arrays instead of manifold mesh
  authoringOnly: false    // skip manifold path entirely
});
scene.add(solid);
```

## Feature builders

### chamfer(options)
Asynchronously applies chamfers to edges (by name or `Edge` objects), returning a new Solid (union for OUTSET, subtract for INSET). Throws if `distance` is not > 0; returns an unchanged clone when no edges resolve.
```js
const chamfered = await solid.chamfer({
  distance: 1,                // required
  edgeNames: ['EDGE_0'],      // edges to chamfer
  edges: [edgeObj],           // or resolved Edge objects
  direction: 'INSET',         // or 'OUTSET'
  inflate: 0.1,               // tool inflation (negated for OUTSET)
  debug: false,
  featureID: 'CHAMFER',       // name prefix
  sampleCount: undefined,     // optional strip sampling override
  snapSeamToEdge: undefined,  // optional seam snapping
  sideStripSubdiv: undefined, // optional side strip subdivisions
  seamInsetScale: undefined,  // optional seam inset scale
  flipSide: undefined,        // optional side flip
  debugStride: undefined      // optional debug stride
});
```

### fillet(options)
Applies constant-radius fillets to edges on this Solid (union for OUTSET, subtract for INSET). Accepts edge names or resolved edge objects; OUTSET can optionally hull shared corners into a single tool to avoid gaps. Throws if `radius` is not > 0; returns an unchanged clone when no edges resolve.
```js
const filleted = await solid.fillet({
  radius: 2,                  // required
  edgeNames: ['EDGE_0'],      // or edges: [edgeObj]
  direction: 'OUTSET',        // or 'INSET'
  resolution: 48,             // segments around the tube
  inflate: 0.05,              // tangency/cap offset; closed loops skip the wedge inset
  combineEdges: true,         // OUTSET only; hulls fillets that share endpoints
  showTangentOverlays: false, // add tangency overlays on the helper tube (debug-friendly)
  debug: false,
  featureID: 'FILLET'         // name prefix
});
```

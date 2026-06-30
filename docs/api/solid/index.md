# `Solid` Method Index

`Solid` lives in `src/BREP/BetterSolid.ts` and extends `THREE.Group`.

Related pages:
- [Solid Developer Guide](../../solid-methods.md)
- [Kernel and Geometry Docs](../../developer/kernel/index.md)
- [BREP Kernel Reference](../../brep-kernel.md)

## Lifecycle

- [constructor()](./constructor.md)
- [clone()](./clone.md)
- [free()](./free.md)
- [faces](./faces.md)

## Authoring and metadata

- [addTriangle(faceName, v1, v2, v3)](./addTriangle.md)
- [_key(point)](./_key.md)
- [_getPointIndex(point)](./_getPointIndex.md)
- [_getOrCreateID(faceName)](./_getOrCreateID.md)
- [addAuxEdge(name, points, options)](./addAuxEdge.md)
- [addCenterline(a, b, name, options)](./addCenterline.md)
- [setFaceMetadata(faceName, metadata)](./setFaceMetadata.md)
- [getFaceMetadata(faceName)](./getFaceMetadata.md)
- [renameFace(oldName, newName)](./renameFace.md)
- [setEdgeMetadata(edgeName, metadata)](./setEdgeMetadata.md)
- [getEdgeMetadata(edgeName)](./getEdgeMetadata.md)

## Transforms and face edits

- [bakeTransform(matrix)](./bakeTransform.md)
- [bakeTRS(trs)](./bakeTRS.md)
- [mirrorAcrossPlane(point, normal)](./mirrorAcrossPlane.md)
- [pushFace(faceName, distance)](./pushFace.md)
- [getFaceNormal(faceName)](./getFaceNormal.md)

## Welding, manifold, and cleanup

- [setEpsilon(epsilon)](./setEpsilon.md)
- [_weldVerticesByEpsilon(epsilon)](./_weldVerticesByEpsilon.md)
- [fixTriangleWindingsByAdjacency()](./fixTriangleWindingsByAdjacency.md)
- [_isCoherentlyOrientedManifold()](./_isCoherentlyOrientedManifold.md)
- [_manifoldize()](./_manifoldize.md)
- [remesh(options)](./remesh.md)
- [removeSmallIslands(options)](./removeSmallIslands.md)
- [removeOppositeSingleEdgeFaces(options)](./removeOppositeSingleEdgeFaces.md)
- [removeTinyBoundaryTriangles(areaThreshold, maxIterations)](./removeTinyBoundaryTriangles.md)
- [collapseTinyTriangles(lengthThreshold)](./collapseTinyTriangles.md)
- [splitSelfIntersectingTriangles(diagnostics)](./splitSelfIntersectingTriangles.md)
- [removeDegenerateTriangles()](./removeDegenerateTriangles.md)
- [removeInternalTriangles()](./removeInternalTriangles.md)
- [removeInternalTrianglesByRaycast()](./removeInternalTrianglesByRaycast.md)
- [removeInternalTrianglesByWinding(options)](./removeInternalTrianglesByWinding.md)
- [cleanupTinyFaceIslands(size)](./cleanupTinyFaceIslands.md)
- [mergeTinyFaces(maxArea)](./mergeTinyFaces.md)

## Queries and measurements

- [getMesh()](./getMesh.md)
- [_ensureFaceIndex()](./_ensureFaceIndex.md)
- [getFace(name)](./getFace.md)
- [getFaces(includeEmpty)](./getFaces.md)
- [getFaceNames()](./getFaceNames.md)
- [getBoundaryEdgePolylines()](./getBoundaryEdgePolylines.md)
- [getTriangleCount()](./getTriangleCount.md)
- [volume()](./volume.md)
- [surfaceArea()](./surfaceArea.md)
- [minGapToPoint(point, searchLength)](./minGapToPoint.md)

## Booleans and reconstruction

- [_expandTriIDsFromMesh(mesh)](./_expandTriIDsFromMesh.md)
- [union(other)](./union.md)
- [subtract(other)](./subtract.md)
- [intersect(other)](./intersect.md)
- [simplify(tolerance, updateInPlace)](./simplify.md)

## Export, visualization, and feature builders

- [toSTL(name, precision)](./toSTL.md)
- [toSTEP(name, options)](./toSTEP.md)
- [visualize(options)](./visualize.md)
- [chamfer(options)](./chamfer.md)
- [fillet(options)](./fillet.md)

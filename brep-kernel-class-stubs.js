/*
 * Consolidated BREP kernel class stubs.
 *
 * Scope:
 * - Based on the kernel-oriented classes in `src/BREP`.
 * - Keeps the kernel class relationships where they are internal to the repo.
 * - Omits non-class helper functions and external runtime dependencies.
 *
 * Notes:
 * - These are documentation-oriented stubs, not working implementations.
 * - Each method includes an inline comment describing its intended behavior.
 */

function notImplemented() {
  throw new Error('Stub only: implementation intentionally omitted.');
}

class Solid {
  constructor() {
    // Initialize an empty authored solid with triangle buffers, metadata maps, and manifold cache state.
  }

  bakeTransform(matrix) {
    // Bake a transform matrix directly into the authored vertex and metadata data for this solid.
    return notImplemented();
  }

  bakeTRS(trs) {
    // Compose translation/rotation/scale input and bake the resulting transform into the authored geometry.
    return notImplemented();
  }

  _key(point) {
    // Build the exact vertex-deduplication key used for authoring vertices in this solid.
    return notImplemented();
  }

  _getPointIndex(point) {
    // Return the authored vertex index for a point, adding the point to the vertex buffer if needed.
    return notImplemented();
  }

  _getOrCreateID(faceName) {
    // Look up or allocate the persistent face ID associated with a face label.
    return notImplemented();
  }

  addTriangle(faceName, v1, v2, v3) {
    // Add a labeled triangle to the authored mesh data for this solid.
    return notImplemented();
  }

  addAuxEdge(name, points, options = {}) {
    // Attach an auxiliary polyline, such as a centerline or overlay edge, to the solid.
    return notImplemented();
  }

  addCenterline(a, b, name = 'CENTERLINE', options = {}) {
    // Add a two-point auxiliary edge intended to represent a centerline or axis helper.
    return notImplemented();
  }

  setFaceMetadata(faceName, metadata) {
    // Store or merge metadata associated with a named face on this solid.
    return notImplemented();
  }

  getFaceMetadata(faceName) {
    // Read metadata currently associated with a named face on this solid.
    return notImplemented();
  }

  renameFace(oldName, newName) {
    // Rename a face label, merging authored data if the destination label already exists.
    return notImplemented();
  }

  setEdgeMetadata(edgeName, metadata) {
    // Store or merge metadata associated with a named boundary edge on this solid.
    return notImplemented();
  }

  getEdgeMetadata(edgeName) {
    // Read metadata currently associated with a named boundary edge on this solid.
    return notImplemented();
  }

  remesh(options = {}) {
    // Split long edges and rebuild the authored mesh so triangle sizes become more uniform.
    return notImplemented();
  }

  removeSmallIslands(options = {}) {
    // Remove disconnected triangle islands based on size and whether they are internal or external.
    return notImplemented();
  }

  removeSmallInternalIslands(maxTriangles = 30) {
    // Remove only small disconnected islands that lie inside the main shell volume.
    return notImplemented();
  }

  removeOppositeSingleEdgeFaces(options = {}) {
    // Remove tiny opposite-facing patches that connect to the shell through only a minimal edge chain.
    return notImplemented();
  }

  mirrorAcrossPlane(point, normal) {
    // Return a mirrored copy of this solid across a plane defined by a point and normal.
    return notImplemented();
  }

  pushFace(faceName, distance, options = {}) {
    // Move a named face along its derived outward normal by the requested distance.
    return notImplemented();
  }

  removeTinyBoundaryTriangles(areaThreshold, maxIterations = 1) {
    // Clean up tiny boundary-adjacent triangles by applying limited topological edits near the boundary.
    return notImplemented();
  }

  collapseTinyTriangles(lengthThreshold) {
    // Collapse triangles whose shortest edges are below the supplied tolerance and clean up the result.
    return notImplemented();
  }

  invertNormals() {
    // Flip all triangle winding so the solid's authored normals are reversed.
    return notImplemented();
  }

  fixTriangleWindingsByAdjacency() {
    // Make neighboring triangles use coherent winding across shared edges before manifoldization.
    return notImplemented();
  }

  _isCoherentlyOrientedManifold() {
    // Check whether the authored triangles form a manifold with consistent orientation.
    return notImplemented();
  }

  setEpsilon(epsilon = 0) {
    // Set the vertex weld epsilon used when preparing or cleaning the authored mesh.
    return notImplemented();
  }

  clone() {
    // Create a lightweight copy of the authored solid, including labels, metadata, and helper edges.
    return notImplemented();
  }

  _weldVerticesByEpsilon(epsilon) {
    // Merge authored vertices that fall within a specified positional tolerance.
    return notImplemented();
  }

  _manifoldize() {
    // Build or refresh the cached manifold representation from the authored triangle data.
    return notImplemented();
  }

  getMesh() {
    // Return a fresh mesh snapshot of the current manifold-ready geometry.
    return notImplemented();
  }

  free() {
    // Dispose cached native/manifold resources associated with this solid.
    return notImplemented();
  }

  offsetFace(faceName, distance) {
    // Offset a named face by moving its vertices along the face normal by the given distance.
    return notImplemented();
  }

  _ensureFaceIndex() {
    // Build the internal face-to-triangle lookup cache used by face queries.
    return notImplemented();
  }

  getFace(name) {
    // Return the triangle data that currently belongs to a specific face label.
    return notImplemented();
  }

  getFaceNames() {
    // List all face labels currently known on this solid.
    return notImplemented();
  }

  toSTL(name = 'solid', precision = 6) {
    // Serialize the current solid to an ASCII STL string.
    return notImplemented();
  }

  async writeSTL(filePath, name = 'solid', precision = 6) {
    // Write the current solid to an ASCII STL file on disk.
    return notImplemented();
  }

  toSTEP(name = undefined, options = {}) {
    // Serialize the current solid to a triangulated STEP representation.
    return notImplemented();
  }

  async writeSTEP(filePath, name = undefined, options = {}) {
    // Write the current solid to a STEP file on disk.
    return notImplemented();
  }

  getFaces(includeEmpty = false) {
    // Return all face groups, each with its labeled triangle collection.
    return notImplemented();
  }

  visualize(options = {}) {
    // Build or rebuild child face and edge visualization objects for the authored solid.
    return notImplemented();
  }

  getBoundaryEdgePolylines() {
    // Extract boundary-edge polylines that separate different face labels on the solid.
    return notImplemented();
  }

  _combineIdMaps(other) {
    // Merge face-ID-to-name maps from this solid and another solid during reconstruction or booleans.
    return notImplemented();
  }

  _combineFaceMetadata(other) {
    // Merge face metadata coming from this solid and another solid.
    return notImplemented();
  }

  static _expandTriIDsFromMesh(mesh) {
    // Expand or synthesize the per-triangle face-ID array from a mesh snapshot.
    return notImplemented();
  }

  static _fromManifold(manifoldObj, idToFaceName, options = {}) {
    // Reconstruct a Solid instance from a manifold object and an ID-to-face-name map.
    return notImplemented();
  }

  union(other) {
    // Return the boolean union of this solid and another solid.
    return notImplemented();
  }

  subtract(other) {
    // Return the boolean subtraction result of this solid minus another solid.
    return notImplemented();
  }

  intersect(other) {
    // Return the boolean intersection shared by this solid and another solid.
    return notImplemented();
  }

  difference(other) {
    // Return the boolean difference result using the alternative difference code path.
    return notImplemented();
  }

  simplify(tolerance, updateInPlace) {
    // Simplify the manifold geometry, optionally mutating the current solid in place.
    return notImplemented();
  }

  setTolerance(tolerance) {
    // Rebuild the solid with a manifold tolerance applied to the resulting geometry.
    return notImplemented();
  }

  volume() {
    // Compute and return the solid volume from the current mesh state.
    return notImplemented();
  }

  surfaceArea() {
    // Compute and return the total surface area of the current solid.
    return notImplemented();
  }

  getTriangleCount() {
    // Count how many triangles exist in the current mesh representation.
    return notImplemented();
  }

  splitSelfIntersectingTriangles(diagnostics = false) {
    // Split authored triangles conservatively where self-intersections are detected.
    return notImplemented();
  }

  removeDegenerateTriangles() {
    // Remove triangles that collapse to zero area or contain duplicate/collinear vertices.
    return notImplemented();
  }

  removeInternalTriangles() {
    // Remove triangles that do not belong to the exterior shell after rebuilding from the manifold surface.
    return notImplemented();
  }

  removeInternalTrianglesByRaycast() {
    // Remove internal triangles by classifying triangle centroids with ray tests.
    return notImplemented();
  }

  removeInternalTrianglesByWinding(options = {}) {
    // Remove internal triangles by classifying them with a winding-number or solid-angle test.
    return notImplemented();
  }

  cleanupTinyFaceIslands(size) {
    // Reassign tiny disconnected islands inside a face label to stronger neighboring faces.
    return notImplemented();
  }

  mergeTinyFaces(maxArea = 0.001) {
    // Merge very small faces into their dominant adjacent neighbors.
    return notImplemented();
  }

  chamfer(options = {}) {
    // Apply chamfers along selected edges and return the resulting solid.
    return notImplemented();
  }

  fillet(options = {}) {
    // Apply constant-radius fillets along selected edges and return the resulting solid.
    return notImplemented();
  }

  get faces() {
    // Return the current face child objects, visualizing the solid first if necessary.
    return notImplemented();
  }
}

Solid.BaseSolid = Solid;

class Edge {
  constructor(geometry) {
    // Initialize an edge visualization object backed by edge geometry and edge-related state.
  }

  length() {
    // Measure the world-space length of the edge polyline.
    return notImplemented();
  }

  points(applyWorld = true) {
    // Return the sampled edge polyline points, optionally transformed into world space.
    return notImplemented();
  }

  collapseToPoint() {
    // Collapse the vertices referenced by this edge down to a single averaged point on the parent solid.
    return notImplemented();
  }

  setMetadata(metadata) {
    // Forward edge metadata updates to the parent solid using this edge's name.
    return notImplemented();
  }

  getMetadata() {
    // Read edge metadata from the parent solid using this edge's name.
    return notImplemented();
  }
}

class Face {
  constructor(geometry) {
    // Initialize a face visualization object backed by triangle geometry and face-related state.
  }

  getAverageNormal() {
    // Compute the area-weighted average normal of the face in world space.
    return notImplemented();
  }

  surfaceArea() {
    // Compute the total world-space surface area covered by this face's triangles.
    return notImplemented();
  }

  async points(applyWorld = true) {
    // Return the face's vertex positions, optionally transformed into world space.
    return notImplemented();
  }

  setMetadata(metadata) {
    // Forward face metadata updates to the parent solid using this face's name.
    return notImplemented();
  }

  getMetadata() {
    // Read face metadata from the parent solid using this face's name.
    return notImplemented();
  }

  renameFace(newName) {
    // Rename this face by delegating the change to the parent solid.
    return notImplemented();
  }

  thicken(distance, options = {}) {
    // Build a closed solid by thickening this face along its local normals.
    return notImplemented();
  }

  getNeighbors() {
    // Return face objects that share an edge boundary with this face.
    return notImplemented();
  }
}

class Vertex {
  constructor(position = [0, 0, 0], opts = {}) {
    // Initialize a vertex marker object at the requested position with optional naming.
  }
}

class AssemblyComponent {
  constructor({ name = 'Component', fixed = false } = {}) {
    // Initialize an assembly component container that can hold one or more solids or bodies.
  }

  addBody(body) {
    // Add a body or solid to this assembly component.
    return notImplemented();
  }

  async visualize() {
    // Ask each child body to build or refresh its visualization.
    return notImplemented();
  }

  async free() {
    // Ask each child body to release cached resources.
    return notImplemented();
  }
}

class CppSolidCore {
  constructor(nativeCore = null) {
    // Wrap an existing native BrepSolidCore or create a fresh native bridge to the C++ kernel.
  }

  clear() {
    // Reset the native authoring state stored inside the C++ bridge.
    return notImplemented();
  }

  setAuthoringState(state) {
    // Push a complete authoring-state snapshot into the native kernel bridge.
    return notImplemented();
  }

  addTriangle(faceName, v1, v2, v3) {
    // Add a labeled triangle directly into the native authoring state.
    return notImplemented();
  }

  setFaceMetadata(faceName, metadata = {}) {
    // Store face metadata in the native bridge for the named face.
    return notImplemented();
  }

  getFaceMetadata(faceName) {
    // Read face metadata for the named face from the native bridge.
    return notImplemented();
  }

  renameFace(oldFaceName, newFaceName) {
    // Rename a face label inside the native authoring state.
    return notImplemented();
  }

  cleanupTinyFaceIslands(maxArea) {
    // Reassign or remove tiny disconnected face islands in the native bridge.
    return notImplemented();
  }

  removeDisconnectedIslandsByVolume(minVolume) {
    // Remove disconnected shells below a given volume threshold in the native bridge.
    return notImplemented();
  }

  normalizeFaceTracking() {
    // Normalize face-tracking information so persistent labels remain coherent.
    return notImplemented();
  }

  setEdgeMetadata(edgeName, metadata = {}) {
    // Store edge metadata in the native bridge for the named edge.
    return notImplemented();
  }

  getEdgeMetadata(edgeName) {
    // Read edge metadata for the named edge from the native bridge.
    return notImplemented();
  }

  getFaceNames() {
    // Return the list of face labels currently known by the native bridge.
    return notImplemented();
  }

  getFace(faceName) {
    // Return the triangles belonging to a named face from the native bridge.
    return notImplemented();
  }

  getFaces(includeEmpty = false) {
    // Return all face groups and their triangles from the native bridge.
    return notImplemented();
  }

  getBoundaryEdgePolylines() {
    // Return labeled boundary-edge polylines between neighboring faces from the native bridge.
    return notImplemented();
  }

  addAuxEdge(name, points, options = {}) {
    // Add an auxiliary edge polyline into the native authoring state.
    return notImplemented();
  }

  setAuxEdges(auxEdges = []) {
    // Replace the complete auxiliary-edge set stored in the native bridge.
    return notImplemented();
  }

  getAuxEdges() {
    // Read the auxiliary-edge set currently stored in the native bridge.
    return notImplemented();
  }

  computeFilletCenterline(options = {}) {
    // Compute the centerline and tangent data needed to build or inspect a fillet along an edge.
    return notImplemented();
  }

  getAuthoringState() {
    // Return a full JS snapshot of the native authoring buffers, metadata, and helper edges.
    return notImplemented();
  }

  bakeTransform(matrix) {
    // Bake a transform matrix directly into the native authoring geometry.
    return notImplemented();
  }

  transformMetadata(matrix) {
    // Apply a transform to metadata that carries geometric references in the native bridge.
    return notImplemented();
  }

  weldVerticesByEpsilon(epsilon) {
    // Weld authored vertices in the native bridge using the given epsilon.
    return notImplemented();
  }

  offsetFace(faceName, distance) {
    // Offset a named face in native authoring data by the requested distance.
    return notImplemented();
  }

  pushFace(faceName, distance) {
    // Push a named face outward or inward in native authoring data.
    return notImplemented();
  }

  isCoherentlyOrientedManifold() {
    // Check whether the native authoring data forms a coherently oriented manifold.
    return notImplemented();
  }

  fixTriangleWindingsByAdjacency() {
    // Fix triangle winding inconsistencies in the native authoring data using adjacency.
    return notImplemented();
  }

  invertNormals() {
    // Invert all authored triangle normals inside the native bridge.
    return notImplemented();
  }

  prepareManifoldMesh() {
    // Build the mesh payload expected by manifold construction from native authoring data.
    return notImplemented();
  }

  vertexCount() {
    // Return the number of authored vertices stored by the native bridge.
    return notImplemented();
  }

  triangleCount() {
    // Return the number of authored triangles stored by the native bridge.
    return notImplemented();
  }

  dispose() {
    // Release the underlying native C++ bridge object and its resources.
    return notImplemented();
  }
}

class PrimitiveBase extends Solid {
  constructor(defaults, name, primitiveKind) {
    // Initialize a primitive solid with default parameters and immediately generate its geometry.
    super();
  }

  buildNativeSnapshot() {
    // Ask the native kernel to generate the authoring-state snapshot for this primitive type.
    return notImplemented();
  }

  generate() {
    // Rebuild this primitive solid from its current parameter set.
    return notImplemented();
  }
}

class Pyramid extends PrimitiveBase {
  constructor({ bL = 1, s = 4, h = 1, name = 'Pyramid' } = {}) {
    // Create a pyramid primitive using the provided base length, side count, height, and name.
    super();
  }
}

class Sphere extends PrimitiveBase {
  constructor({ r = 1, resolution = 24, name = 'Sphere' } = {}) {
    // Create a sphere primitive using the provided radius, tessellation, and name.
    super();
  }
}

class Torus extends PrimitiveBase {
  constructor({ mR = 2, tR = 0.5, resolution = 48, arcDegrees = 360, name = 'Torus' } = {}) {
    // Create a torus primitive using the provided major/minor radii, tessellation, sweep arc, and name.
    super();
  }
}

class Cube extends PrimitiveBase {
  constructor({ x = 1, y = 1, z = 1, name = 'Cube' } = {}) {
    // Create a box primitive using the provided side lengths and name.
    super();
  }
}

class Cylinder extends PrimitiveBase {
  constructor({ radius = 1, height = 1, resolution = 32, name = 'Cylinder' } = {}) {
    // Create a cylinder primitive using the provided radius, height, tessellation, and name.
    super();
  }
}

class Cone extends PrimitiveBase {
  constructor({ r1 = 0.5, r2 = 1, h = 1, resolution = 32, name = 'Cone' } = {}) {
    // Create a cone or frustum primitive using the provided end radii, height, tessellation, and name.
    super();
  }
}

class ExtrudeSolid extends Solid {
  constructor({ face, distance = 1, dir = null, distanceBack = 0, name = 'Extrude' } = {}) {
    // Initialize an extrude operation from a source face and immediately generate the result solid.
    super();
  }

  generate() {
    // Build the extruded solid by translating a face profile along a direction or distance.
    return notImplemented();
  }
}

class Revolve extends Solid {
  constructor({ face, axis, angle = 360, resolution = 64, name = 'Revolve' } = {}) {
    // Initialize a revolve operation from a source face and axis and immediately generate the result solid.
    super();
  }

  generate() {
    // Build the revolved solid by sweeping a face profile around an axis.
    return notImplemented();
  }
}

class Sweep extends Solid {
  constructor({
    face,
    sweepPathEdges = [],
    distance = 1,
    distanceBack = 0,
    mode = 'translate',
    name = 'Sweep',
    omitBaseCap = false,
    twistAngle = 0,
  } = {}) {
    // Initialize a sweep operation from a source face and immediately generate the swept result solid.
    super();
  }

  generate() {
    // Build the swept solid by moving a face along a translation, path, or twisted sweep configuration.
    return notImplemented();
  }
}

class Tube extends Solid {
  constructor(opts = {}) {
    // Initialize a tube or hollow tube from a path polyline and optionally generate it immediately.
    super();
  }

  generate() {
    // Generate the tube, preferring a fast native path and falling back to the slower native rebuild if needed.
    return notImplemented();
  }

  generateFast() {
    // Generate the tube using the fast native tube builder path.
    return notImplemented();
  }

  generateSlow() {
    // Generate the tube using the slower native path intended for harder or self-intersecting cases.
    return notImplemented();
  }

  buildNativeSnapshot(overrides = {}) {
    // Build the native authoring-state snapshot for the current tube parameters.
    return notImplemented();
  }

  generateNative(overrides = {}) {
    // Rebuild this tube directly from a native snapshot generated from its current parameters.
    return notImplemented();
  }
}

class ChamferSolid extends Solid {
  constructor({
    edgeToChamfer,
    distance = 1,
    sampleCount = 50,
    snapSeamToEdge = true,
    sideStripSubdiv = 8,
    seamInsetScale = 1e-3,
    direction = 'INSET',
    inflate = 0,
    flipSide = false,
    debug = false,
    debugStride = 12,
  } = {}) {
    // Initialize a procedural chamfer-tool solid around a selected edge and generate it immediately.
    super();
  }

  generate() {
    // Build the chamfer wedge geometry that will later be unioned with or subtracted from the target solid.
    return notImplemented();
  }
}

class MeshRepairer {
  constructor() {
    // Initialize a utility object for repairing or regularizing triangle meshes before BREP conversion.
  }

  static _ensureIndexed(geometry) {
    // Ensure the incoming geometry has an index buffer so triangle connectivity can be processed consistently.
    return notImplemented();
  }

  static _getArrays(geometry) {
    // Extract the raw position, UV, normal, and index arrays from a geometry object.
    return notImplemented();
  }

  static _vec3Of(array, index) {
    // Read a single 3D point from a flat numeric array at the requested vertex index.
    return notImplemented();
  }

  static _sub(a, b) {
    // Subtract one 3D vector from another.
    return notImplemented();
  }

  static _dot(a, b) {
    // Compute the dot product of two 3D vectors.
    return notImplemented();
  }

  static _len2(a) {
    // Compute the squared length of a 3D vector.
    return notImplemented();
  }

  static _cross(a, b) {
    // Compute the cross product of two 3D vectors.
    return notImplemented();
  }

  static _norm(a) {
    // Normalize a 3D vector to unit length.
    return notImplemented();
  }

  static _add(a, b) {
    // Add two 3D vectors component-wise.
    return notImplemented();
  }

  static _scale(a, scalar) {
    // Scale a 3D vector by a scalar value.
    return notImplemented();
  }

  static _triangleArea2(a, b, c) {
    // Compute the doubled area magnitude of a triangle defined by three 3D points.
    return notImplemented();
  }

  static _edgeKey(i, j) {
    // Build a stable undirected edge key for a pair of vertex indices.
    return notImplemented();
  }

  static _newellNormal(points) {
    // Compute a polygon normal using Newell's method for an ordered point loop.
    return notImplemented();
  }

  static _basisFromNormal(normal) {
    // Construct an in-plane orthonormal basis from a supplied normal vector.
    return notImplemented();
  }

  static _projectToPlane(points, basis) {
    // Project 3D points into the 2D coordinate system defined by a basis.
    return notImplemented();
  }

  static _polyArea2D(polygon) {
    // Compute the signed area of a 2D polygon.
    return notImplemented();
  }

  static _pointInTri2D(point, a, b, c) {
    // Test whether a 2D point lies inside or on a 2D triangle.
    return notImplemented();
  }

  static _isConvex2D(prev, curr, next, sign) {
    // Determine whether a 2D polygon corner is convex with respect to the loop orientation.
    return notImplemented();
  }

  static _earClip2D(loop2D) {
    // Triangulate a simple 2D polygon loop using ear clipping.
    return notImplemented();
  }

  static _buildEdgeUse(indexArray) {
    // Build a map describing how many triangles use each undirected edge in the indexed mesh.
    return notImplemented();
  }

  static _boundaryEdges(edgeUse) {
    // Return the edges that are used by exactly one triangle and therefore lie on the boundary.
    return notImplemented();
  }

  static _buildBoundaryLoops(boundaryEdges) {
    // Stitch boundary edges into ordered closed loops.
    return notImplemented();
  }

  weldVertices(geometry, epsilon = 1e-4) {
    // Merge nearby vertices, average their attributes, and rebuild a cleaner indexed geometry.
    return notImplemented();
  }

  fixTJunctions(geometry, lineEps = 5e-4, gridCell = 0.01) {
    // Split edges and triangles to resolve T-junctions that would otherwise leave cracks in the mesh.
    return notImplemented();
  }

  removeOverlappingTriangles(geometry, posEps = 1e-6) {
    // Remove duplicate or overlapping triangles from a geometry.
    return notImplemented();
  }

  fillHoles(geometry) {
    // Detect open boundary loops and triangulate them to fill holes in the mesh.
    return notImplemented();
  }

  fixTriangleNormals(geometry) {
    // Reorient triangles so neighboring faces use a more coherent normal direction.
    return notImplemented();
  }

  repairAll(geometry, { weldEps = 5e-4, lineEps = 5e-4, gridCell = 0.01 } = {}) {
    // Run the full mesh-repair pipeline over a geometry using the supplied tolerances.
    return notImplemented();
  }
}

class MeshToBrep extends Solid {
  constructor(geometryOrMesh, faceDeflectionAngle = 30, weldTolerance = 1e-5, options = {}) {
    // Convert a triangle mesh into a labeled BREP-style solid by welding geometry and grouping triangles into faces.
    super();
  }

  toBrep() {
    // Return this object as the BREP-style solid produced from the mesh conversion.
    return notImplemented();
  }

  _buildFromGeometry(geometry) {
    // Build authored vertices, triangles, and face labels from the supplied triangle geometry.
    return notImplemented();
  }
}

class OffsetShellSolid extends Solid {
  constructor(sourceSolid) {
    // Initialize an offset-shell helper around a source solid.
    super();
  }

  run(distance) {
    // Execute the offset-shell operation against the source solid using the supplied distance.
    return notImplemented();
  }

  static generate(sourceSolid, distance, options = {}) {
    // Build a new solid representing the shell offset of a source solid.
    return notImplemented();
  }
}

class ThreadGeometry {
  constructor(options) {
    // Initialize a thread-geometry model with a chosen standard, pitch, diameters, starts, and taper data.
  }

  _computeStandardProfile(standard, pitch) {
    // Compute the fundamental profile values for a supported thread standard and pitch.
    return notImplemented();
  }

  helixAtPitchRadius(t) {
    // Evaluate the helical centerline position at the pitch radius for parameter t.
    return notImplemented();
  }

  toSolid(options = {}) {
    // Convert the thread definition into either a symbolic or fully modeled BREP solid.
    return notImplemented();
  }

  _buildSymbolicSolid(length, options = {}) {
    // Build a simplified symbolic thread solid, typically as a cylinder or tapered cylinder with helper edges.
    return notImplemented();
  }

  _buildModeledSolid(length, options = {}) {
    // Build a detailed helical thread solid by sweeping the thread profile along the thread path.
    return notImplemented();
  }

  diametersAtZ(z) {
    // Return the major, pitch, and minor diameters at a given axial location, including taper when relevant.
    return notImplemented();
  }

  static fromMetricDesignation(designation, opts = {}) {
    // Parse an ISO metric designation like M10x1.5 and return a configured ThreadGeometry instance.
    return notImplemented();
  }

  static fromTrapezoidalDesignation(designation, opts = {}) {
    // Parse a trapezoidal metric designation like Tr60x9 and return a configured ThreadGeometry instance.
    return notImplemented();
  }

  static fromUnified(nominalDiameterInch, tpi, opts = {}) {
    // Build a unified-inch thread definition from diameter and threads-per-inch values.
    return notImplemented();
  }

  static fromAcme(nominalDiameterInch, tpi, opts = {}) {
    // Build an Acme thread definition from diameter and threads-per-inch values.
    return notImplemented();
  }

  static fromStubAcme(nominalDiameterInch, tpi, opts = {}) {
    // Build a Stub Acme thread definition from diameter and threads-per-inch values.
    return notImplemented();
  }

  static fromWhitworth(nominalDiameterInch, pitchOrTpi, opts = {}) {
    // Build a Whitworth thread definition from diameter and either pitch or threads-per-inch input.
    return notImplemented();
  }

  static fromNPT(nominalDiameterInch, tpi, opts = {}) {
    // Build an NPT tapered thread definition from diameter and threads-per-inch input.
    return notImplemented();
  }

  toObject() {
    // Return a plain-object snapshot of the thread geometry parameters and derived values.
    return notImplemented();
  }
}

const BREPKernelStubs = {
  Solid,
  Edge,
  Face,
  Vertex,
  AssemblyComponent,
  CppSolidCore,
  PrimitiveBase,
  Pyramid,
  Sphere,
  Torus,
  Cube,
  Cylinder,
  Cone,
  ExtrudeSolid,
  Revolve,
  Sweep,
  Tube,
  ChamferSolid,
  MeshRepairer,
  MeshToBrep,
  OffsetShellSolid,
  ThreadGeometry,
};

if (typeof globalThis !== 'undefined') {
  globalThis.BREPKernelStubs = BREPKernelStubs;
}

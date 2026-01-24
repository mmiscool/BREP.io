# Sheet Metal Unfolding Requirements (Neutral Surface)

This document defines the requirements for unfolding a triangulated sheet metal mesh using a neutral value (neutral factor) so that bend regions are distorted correctly in the resulting flat pattern.

## 1) Scope

These requirements apply to:
- The neutral surface mesh construction used for flat pattern generation.
- The hinge- or triangle-based unfolding steps that transform 3D geometry into a 2D flat pattern.
- The preview and export paths (SVG/DXF) that use the unfolded mesh.

## 2) Definitions

- **Thickness (t)**: The sheet metal thickness.
- **Neutral factor (k)**: A value in [0, 1] representing where the neutral surface lies between the A-side (outer) and B-side (inner) faces.
- **Neutral surface**: The surface offset from the A or B face by `k * t` (A-side reference) or `(1 - k) * t` (B-side reference), used to preserve material length during flattening.
- **Bend region**: Faces classified as cylindrical or conical in metadata; these should be unfolded using neutral surface geometry.
- **Planar region**: Faces classified as planar (A or B), carried through unfold without distortion.
- **Island**: A disconnected triangle component in the mesh used for unfolding.

## 3) Inputs and Preconditions

### 3.1 Geometry and Topology
- The input mesh MUST provide:
  - `vertProperties` (Float32Array or equivalent), `triVerts` (triangulated indices), and `faceID` for each triangle.
  - Consistent face metadata for identifying planar vs bend faces.
- Triangle winding MUST be coherent across connected triangles. If not, the system MUST correct it or alert.
- Shared edges MUST be detected across the full mesh. If shared vertices are duplicated or nearly coincident, the system MUST merge or connect them via tolerance rules.

### 3.2 Neutral Factor and Thickness
- The neutral factor MUST be resolved deterministically using metadata, with a default fallback (for example, 0.5) if not provided.
- Thickness MUST be resolved from sheet metal metadata with a fallback if not provided.
- The system MUST reject or warn on invalid thickness (<= 0) or a neutral factor outside [0, 1].

## 4) Neutral Surface Construction Requirements

### 4.1 Face Classification
- Faces MUST be classified into:
  - A-side planar faces.
  - B-side planar faces.
  - Bend faces (cylindrical or conical).
- Bend faces MUST be included in the unfolding set if they are required to connect planar faces.

### 4.2 Offset Direction and Magnitude
- For A-side reference, neutral offset MUST be:

```
neutral_offset = k * t
```

- For B-side reference, neutral offset MUST be:

```
neutral_offset = (1 - k) * t
```

- The system MUST be consistent about which side is used (A or B) and apply the same rule for planar faces in the unfolding mesh.
- For cylindrical or conical bend faces, the flat pattern MUST correct bend allowance perpendicular to the bend centerline so that equal bend angles yield equal flat widths regardless of bend direction. The correction MAY be applied as a post-unfold translation of downstream faces rather than by changing the global neutral offset.

### 4.3 Vertex Normal Handling
- Vertex normals used to generate the neutral surface MUST be computed from the unified mesh (shared vertices across all included triangles).
- Normals MUST be oriented consistently toward the A-side reference used by the offset.
- If the system detects normals that oppose their neighbors, it MUST flip them or alert.

### 4.4 Connectivity (Islands)
- The neutral surface mesh MUST be connected for a valid single-piece flat pattern.
- If multiple islands remain after offsetting, the system MUST:
  - Attempt to align islands using edge matching (parallel + overlap) or vertex matching.
  - Weld vertices within a tolerance once alignment occurs.
  - If islands remain, the system MUST alert that the flat pattern will be disconnected.

## 5) Unfolding Requirements

### 5.1 Hinge Graph Construction
- Adjacent triangles MUST be detected by shared edges. If shared edges are not exact matches, the system MUST:
  - Use position tolerance to group near-coincident vertices.
  - Or match boundary edges that are parallel and partially overlapping within tolerance.
- Non-manifold edges (shared by > 2 triangles) MUST be flagged, and the system MUST choose the best pair or alert.

### 5.2 Hinge Angle Selection
- For each shared edge, the system MUST select the hinge rotation that aligns adjacent triangle normals in the same direction (never opposite).
- The rotation MUST be chosen so that the angle between triangles after unfolding is 180 degrees (flat), not 0 degrees (folded back).

### 5.3 Component Unfold Order
- The system MUST choose a base component (typically the largest area) and unfold adjacent components via BFS/DFS.
- Every reachable component MUST be transformed using the same hinge graph.
- If components remain unreachable, the system MUST alert that islands persist.

### 5.4 Second-Pass Unfold
- The system MUST support a second unfold pass using the already-unfolded mesh to reduce residual bends.
- The second pass MUST recompute hinge data from the mostly-flat geometry and re-apply the full unfolding sequence.

## 6) 2D Placement Requirements

### 6.1 Distance Preservation
- The unfolded mesh MUST preserve edge lengths from the neutral surface (within tolerance) for all triangles.
- Distortion beyond tolerance MUST be reported.

### 6.2 Planarity
- The final unfolded mesh MUST be coplanar. All vertices MUST lie on a single plane within tolerance.
- If planarity fails after the second pass, the system MUST force a planar projection of vertices and alert.

### 6.3 Island Handling
- If the unfolded mesh still contains multiple islands, the system MUST:
  - Alert the user with the island count.
  - Continue generating the flat pattern unless the user explicitly requests a hard stop.

## 7) Output Requirements

- The flat pattern mesh MUST include:
  - `vertProperties` (2D positions, Z = 0 or planar),
  - `triVerts` (indices),
  - `triFaces` (face ids),
  - `thickness`, `faceMetaById`, `faceNameById`.
- Debug artifacts MUST include:
  - Placement order,
  - Unfold steps or hinge steps,
  - Island count.

## 8) Validation and Error Reporting

### 8.1 Required Checks
- **Triangle winding**: Must be coherent across all connected triangles.
- **Islands**: Component count MUST be computed and reported.
- **Planarity**: Max distance from plane MUST be computed and compared to a tolerance.

### 8.2 Tolerances
- A size-based tolerance MUST be used for geometric comparisons, for example:

```
edge_tol = max(1e-5, diag * 1e-5)
planar_tol = max(1e-6, diag * 1e-5)
```

Where `diag` is the bounding box diagonal of the working mesh.

### 8.3 Alerts
- The system MUST alert when:
  - Islands remain after unfolding (include island count).
  - The final mesh is not planar after the second pass (include max deviation).

## 9) Acceptance Criteria

The unfolding implementation is considered correct if:
- All triangles are coplanar within tolerance after the second pass or forced planarization.
- The neutral surface offset produces correct bend allowance (edge lengths on the neutral surface are preserved).
- Islands are reported clearly if they remain.
- SVG/DXF exports represent the same unfolded topology as the preview.

## 10) Non-Goals

- Exact manufacturing simulation of material spring-back or stretching beyond neutral surface modeling.
- Automatic resolution of topological errors beyond island alignment and vertex welding.

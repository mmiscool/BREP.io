# CAM Strategy Selection

This is a review checklist for choosing which CAM algorithms and cutter shapes this project should support.

How to use this document:

- Change `[ ]` to `[x]` for items this project should implement.
- Add notes under any selected item if you want a limited first pass or a specific UI behavior.
- After selection, create focused spec documents for the checked algorithms and cutter shapes.

## Milling Strategy Candidates

- [X] **Point drop cutter**
  - Purpose: Given a cutter and a single XY cutter-location point, find the highest safe Z where the cutter touches but does not gouge a triangle mesh.
  - Likely role: Core engine primitive, not usually a user-facing strategy.
  - Needed for: sampled 3D finishing paths, toolpath preview collision checks, and adaptive path projection.

- [X] **Batch drop cutter**
  - Purpose: Run drop-cutter over many cutter-location points with a triangle spatial index.
  - Likely role: Core engine primitive for performance.
  - Needed for: raster finishing and any strategy that starts from sampled XY paths.

- [X] **Uniform path drop cutter**
  - Purpose: Sample a path made of line and arc spans at a fixed interval, then run drop-cutter at each sample.
  - Likely role: Simpler first implementation of path projection.
  - Needed for: predictable stepping, easier debugging, and deterministic simulation slider points.

- [X] **Adaptive path drop cutter**
  - Purpose: Project a line/arc path onto a mesh while recursively adding samples where the resulting cutter-location polyline is too long or not flat enough.
  - Likely role: Main 3D finishing path primitive.
  - Needed for: smoother toolpaths on sloped and curved surfaces without globally tiny sample spacing.
  - Key parameters to expose: maximum sample spacing, minimum sample spacing, flatness/cosine tolerance, minimum floor Z.

- [X] **Parallel finish, one-way zig**
  - Purpose: Generate parallel XY lines in one direction, project them with adaptive path drop-cutter, retract between lines.
  - Likely role: User-facing finishing strategy.
  - Needed for: simple 3-axis finishing of contoured surfaces.
  - Key parameters to expose: direction axis/angle, stepover, sample spacing, min sample spacing, boundary region, safe height, feed/plunge.

- [X] **Parallel finish, bidirectional zig-zag**
  - Purpose: Generate parallel passes but reverse alternating pass direction to reduce long rapids.
  - Likely role: User-facing finishing strategy.
  - Notes: A production implementation needs region clipping and safe linking behavior.
  - Key parameters to expose: direction axis/angle, stepover, link mode, climb/conventional preference, sample spacing.

- [X] **Fiber push cutter**
  - Purpose: At a fixed Z height, push a cutter along one infinite line/fiber and record intervals where the cutter would contact or violate the mesh.
  - Likely role: Core engine primitive for waterline contour extraction.
  - Needed for: constant-Z contouring and z-level roughing/finishing.

- [X] **Batch push cutter**
  - Purpose: Run push-cutter over many X or Y fibers with a triangle spatial index.
  - Likely role: Core engine primitive for waterline performance.
  - Needed for: waterline and adaptive waterline algorithms.

- [X] **Waterline contour loops**
  - Purpose: Generate constant-Z cutter-location loops around a mesh by sampling X and Y fibers, computing intervals, building a weave graph, and traversing faces.
  - Likely role: User-facing z-level contour strategy.
  - Needed for: going around the part at one depth before stepping down, reducing hopping between sides of the part.
  - Key parameters to expose: Z level list or stepdown, sampling spacing, loop ordering, inside/outside region, safe linking, stock allowance.

- [X] **Adaptive waterline contour loops**
  - Purpose: Generate waterline loops with adaptive fiber placement rather than a uniform grid everywhere.
  - Likely role: Higher quality or higher performance z-level contour option.
  - Needed for: fewer samples on flat/simple areas while preserving detail near changing geometry.
  - Key parameters to expose: maximum sampling, minimum sampling, flatness/cosine tolerance, stepdown.

- [X] **Weave graph loop reconstruction**
  - Purpose: Convert X/Y fiber interval intersections into closed loops through a planar graph and face traversal.
  - Likely role: Support algorithm required by waterline; not a standalone UI strategy.
  - Needed for: robust closed contour extraction from push-cutter samples.
  - Notes: Selection should decide whether one robust weave pass is enough or whether separate simple and adaptive variants are useful.

- [X] **Line cutter-location filter**
  - Purpose: Remove redundant nearly-collinear cutter-location points within a tolerance.
  - Likely role: Postprocessor/filter stage.
  - Needed for: reducing simulation points and generated G-code size after dense adaptive sampling.
  - Key parameters to expose: simplification tolerance, preserve endpoints, preserve move type boundaries.

- [X] **Loop/path ordering**
  - Purpose: Order multiple loops or path segments to reduce travel moves.
  - Likely role: Postprocessor/linking stage.
  - Needed for: reducing hopping after generating waterline or parallel paths.
  - Notes: Path ordering may start with deterministic nearest-neighbor ordering and later add TSP-style approximation.

- [X] **Triangle spatial index**
  - Purpose: Build a triangle bounding-box tree for faster overlap queries during drop-cutter and push-cutter evaluation.
  - Likely role: Shared performance infrastructure.
  - Needed for: all non-trivial mesh-based CAM operations.
  - Key parameters to expose internally: bucket size, search projection plane, cutter bounds expansion.

- [X] **Line and arc path spans**
  - Purpose: Represent source paths as line and circular arc spans that can be sampled by path drop-cutter.
  - Likely role: Shared geometry representation.
  - Needed for: G1/G2/G3-aware toolpath generation and future arc-preserving postprocessing.

## Milling Toolhead Shape Candidates

- [X] **Flat end mill / cylindrical cutter**
  - Shape: Cylinder with flat cutting bottom.
  - User parameters: diameter, flute/cutting length, optional shaft length.
  - High-value uses: roughing, pocketing, waterline outside/inside contours, simple stock removal preview.

- [X] **Ball nose end mill / spherical cutter**
  - Shape: Hemispherical end blended into a cylindrical shaft.
  - User parameters: diameter, cutting length, optional shaft length.
  - High-value uses: 3D surface finishing on sloped and curved geometry.

- [X] **Bull nose / corner radius cutter**
  - Shape: Flat-ish center with toroidal corner radius.
  - User parameters: diameter, corner radius, cutting length, optional shaft length.
  - High-value uses: roughing/finishing with less scalloping than a flat tool and stronger edge than a sharp corner.

- [X] **Cone cutter / V-bit**
  - Shape: Sharp conical tip with a maximum diameter and half-angle.
  - User parameters: maximum diameter, included angle or half-angle, cutting length.
  - High-value uses: engraving, chamfer-like toolpaths, tapered wall machining.

- [ ] **Generic composite cutter**
  - Shape: Piecewise radial profile assembled from simpler cutters with radial ranges and Z offsets.
  - User parameters: profile segments, segment radii/heights, axial offsets.
  - High-value uses: custom cutters and a common implementation path for compound tool shapes.

- [ ] **Cylindrical-to-conical compound cutter**
  - Shape: Flat/cylindrical center followed by conical outer wall.
  - User parameters: inner diameter, outer diameter, cone angle.
  - High-value uses: tapered side clearance or specialized engraving/sidewall tools.

- [X] **Ball-to-conical compound cutter**
  - Shape: Ball center tangent to a conical outer wall.
  - User parameters: ball diameter, outer diameter, cone angle.
  - High-value uses: tapered ball tools and specialized finishing.

- [ ] **Bull-to-conical compound cutter**
  - Shape: Bull-nose/toroidal center tangent to a conical outer wall.
  - User parameters: lower diameter, corner radius, outer diameter, cone angle.
  - High-value uses: specialized tapered bull tools.

- [ ] **Cone-to-cone compound cutter**
  - Shape: Lower cone blended into a shallower upper cone.
  - User parameters: lower diameter and angle, upper diameter and angle.
  - High-value uses: specialized tapered cutters and engraving tools.

- [ ] **Offset cutter profile**
  - Shape: Derived cutter inflated by a stock allowance or clearance amount.
  - User parameters: offset distance, source cutter.
  - High-value uses: stock allowance, roughing clearance, collision margin, finish allowance.
  - Notes: This may be an operation parameter rather than a visible tool type.

## Face-Targeted Finishing Requirements

- Finishing and detail operations may allow users to select individual faces or face groups instead of only whole solids.
- A selected face is drive geometry for sampling, clipping, and visible operation scope; the owning solid remains protected target material.
- Cutter-location generation must check non-penetration against the full target solid mesh, not only the selected faces.
- Adjacent unselected faces must be treated as protected unless the operation explicitly includes them.
- The UI should support target solids plus optional target faces so roughing can stay solid-based while finishing can be face-targeted.
- Toolpath preview and simulation must report when no safe cutter locations can be produced for a selected face region.

## Suggested First-Pass Selection

These are not preselected; they are the smallest useful path toward the CAM rewrite.

- [X] Flat end mill / cylindrical cutter.
- [X] Ball nose end mill.
- [X] Point drop cutter.
- [X] Batch drop cutter.
- [X] Adaptive path drop cutter.
- [X] Parallel finish, bidirectional zig-zag.
- [X] Waterline contour loops.
- [X] Weave graph loop reconstruction.
- [X] Line cutter-location filter.
- [X] Triangle spatial index.

## Specification Documents

Use these implementation specs for the selected scope:

- `drop-cutter-spec.md` for point, batch, uniform path, and adaptive path drop-cutter.
- `push-cutter-waterline-spec.md` for fiber push-cutter, batch push-cutter, waterline, adaptive waterline, and weave.
- `cutter-shapes-spec.md` for selected cutter geometries and offset cutter behavior.
- `path-filtering-linking-spec.md` for CL filtering, loop ordering, path spans, and postprocessing support.

Each spec should include:

- Inputs and outputs using BREP.io coordinate conventions.
- Required geometry primitives and numeric tolerances.
- Algorithm stages in implementation-neutral pseudocode.
- Progress reporting checkpoints for web-worker execution.
- Simulation and preview integration expectations.
- Failure cases and user-facing feedback.
- Deterministic tests and fixture ideas.

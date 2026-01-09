# Sheet Metal Flat Pattern – Rewrite Plan

This file captures the requirements and constraints for rebuilding the sheet metal flat pattern feature from scratch. All previous implementation has been removed (see `src/exporters/sheetMetalFlatPattern.js` stub). Use this as the single source of truth for the new implementation.

## Objectives
- Generate a flat pattern that is dimensionally faithful to the solid: planar faces never scale, bend faces only stretch/shrink in the bend-width direction based on neutral factor and inside/outside.
- Provide per-face extracts (off to the side) that exactly match the in-place flattened faces for measurement.
- Keep overlay/orientation correct: base face aligns 1:1 with its 3D counterpart at step 0.
- Support step-by-step unfolding visualization and sketch export without modifying face sizes.

## Invariants
- **Planar faces**: rigid copies only (no scaling). Allowed: translate/rotate to maintain continuity; disallowed: any size change.
- **Bend faces**: may stretch/shrink only perpendicular to the bend line (circumferential direction). The bend line itself remains dimensionally correct where it meets planar faces.
- **Edge continuity**: shared edges between faces must stay coincident after placement; neutral adjustments must not move the shared edge position on flats. The whole flate face can be transfromed to meet the common edge if required. 
- **Per-face extracts**: each flattened face appears once off to the side with identical dimensions to the in-place flattened face; no overlap between extracts.

## Inputs Needed
- Sheet thickness.
- Neutral factor (k-factor) per part/face.
- Bend radius per cylindrical face.
- Inside vs outside for each bend (or inferable from face metadata).
- Face type (A/B) and adjacency graph between faces (planar and cylindrical).

## Geometry Handling
- **Planar faces**:
  - Use original vertices (world or local to face) to build 2D coords; do not offset by normals.
  - Placement in 2D uses transforms derived from shared edges only; no scaling factors applied.
  - Display coords and placement coords are identical.
- **Bend faces**:
  - Determine bend axis/line in 3D and map to 2D bend line.
  - Compute neutral radius:
    - Inside: `bendRadius - (1 - k) * thickness`
    - Outside: `bendRadius + k * thickness`
  - Map circumferential direction to 2D: scale only along the normal to the 2D bend line by `neutralRadius / bendRadius` (or equivalent arc-length ratio). Do **not** scale along the bend line itself.
  - Shared edges to planar faces use the actual bend radius geometry so flats stay true-size at the interface.
  - Record allowance used per bend for reporting/annotations.

## Unfold Algorithm (high level)
1. Build face graph (planar + cylindrical) with shared edges.
2. Pick base face (largest planar A-face) and create its 2D basis directly from face geometry; no size change.
3. BFS/DFS placement:
   - For each neighbor face, compute transform from shared edge: align edge endpoints, resolve reflection if needed.
   - Apply transform to face’s unscaled 2D coords (planar) or scaled bend coords (cyl).
   - Ensure continuity: the shared edge in 2D matches exactly.
4. Components/islands: if multiple components, place them separated with margins.
5. Per-face extracts: after placement, duplicate each face polygon and lay them out off to the side (grid/stack) with margins; use the same coords as in-place faces.

## Sketch/Export Behavior
- Sketch: include all in-place flattened faces plus the per-face extracts. All points fixed; add a single ground constraint to origin.
- Outlines: every flattened face gets a clear border; active step highlighted.
- Exports (SVG/DXF): use placement coords; planar faces unscaled, bend faces scaled only perpendicular to bend line per neutral radius.

## Debug/Visualization
- Step-by-step unfolding should show:
  - In-place flattened faces with borders.
  - Bends scaled only across width; flats unchanged.
  - Per-face extracts off to the side.
- Diagnostics should report for each bend: inside/outside, bend radius, neutral radius, k-factor used, and arc-length scaling factor.

## API Targets (to reimplement)
- `buildSheetMetalFlatPatternSolids`
- `buildSheetMetalFlatPatternDxfs`
- `buildSheetMetalFlatPatternDebugSteps`
- `buildSheetMetalFlatPatternSvgs`

All of the above should be rebuilt to respect the invariants above. Until then, the current stub returns empty results and logs a warning.

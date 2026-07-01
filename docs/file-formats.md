# File Formats: Import and Export

![Export floating window](floating-windows/export.png)

## 3MF (Feature Aware)
- **`📤` Export**: Generates a 3MF container that includes triangulated geometry plus an embedded copy of the feature history at `Metadata/featureHistory.json`. PMI views (camera, view settings, and annotations) are part of that history, and when views exist the exporter also writes labeled PNG captures to `/views/<view-name>.png` with relationships from the package root. Multiple solids export as separate objects in a single file. Units are configurable (default millimeter). Non-manifold solids are skipped with a notification, but the export proceeds.
- **`📥` Import**: Loads 3MF files and restores the embedded feature history when present. If no history is stored, the geometry imports as editable mesh only.
- **Compatibility**: The extra history metadata is ignored by other 3MF viewers, but the file remains valid.

## STL
- **`📤` Export**: Writes ASCII STL. If multiple solids are selected, the dialog produces a ZIP archive with one STL per solid. Unit scaling applies at export time.
- **`📥` Import**: Supports ASCII or binary STL. Imports as geometry only without feature history.

## OBJ
- **`📤` Export**: Writes ASCII OBJ (ZIP with one OBJ per solid when multiple bodies are selected). Unit scaling applies at export time. An export-dialog checkbox can optionally include vertex colors (`v x y z r g b`).

## STEP
- **`📤` Export**: Writes ISO 10303-21 `.step` files using a faceted BREP representation from the current triangulated solids. Planar triangles are merged into larger polygon faces where possible.
- **Options**: Unit scaling applies at export time. The export dialog can include faces, export boundary/adjacency edges as polylines, and optionally emit AP242 tessellated faces for non-planar regions.
- **Limitations**: STEP export is mesh/faceted geometry, not the original parametric feature tree. Solids that cannot provide usable mesh data are skipped and reported, while the remaining solids still export.

## BREP JSON
- **`📤` Export**: Saves the feature history only as JSON (`.BREP.json`) with no mesh data. Useful for versioning or quick backups.
- **`📥` Import**: Reloads the saved history and recomputes the model.

## Sheet Metal Flat Patterns
- The Sheet Metal workbench includes the `FP` Sheet Metal Flat Pattern Export button for DXF or SVG flat-pattern output.

## Implementation Notes
- 3MF exporter lives at `src/exporters/threeMF.ts` and packages geometry plus attachments through JSZip.
- STEP exporter lives at `src/exporters/step.ts`.
- `📤` Export dialog logic resides in `src/UI/toolbarButtons/exportButton.ts`.
- `📥` Import button handling lives in `src/UI/toolbarButtons/importButton.ts`.
- Feature history is embedded directly as JSON without XML conversion.
- Face labels carry through export via per-object BaseMaterials, providing human-readable names in other tools. Materials and textures are not reconstructed on import.

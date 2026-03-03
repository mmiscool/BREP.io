# NURBS Face Solid

Status: Implemented

NURBS Face Solid creates its own base solid (a sphere), then deforms that solid with a 3D control cage.

## Inputs
- `radius` – initial sphere radius.
- `resolution` – initial sphere segment resolution.
- `cageDivisionsU/V/W` – cage resolution along each axis.
- `cagePadding` – default margin around the generated sphere when creating/resetting the cage.
- `cageEditor` – viewport cage editor with draggable control points.
- `boolean.operation` / `boolean.targets` – optional CSG with existing solids.

## Behaviour
- Generates a sphere mesh internally (no source face/solid selection needed).
- Generates (or restores) a control cage around the sphere bounds and stores it in feature `persistentData`.
- Uses only boundary cage points (no internal manipulators) and interpolates interior lattice control values.
- Applies free-form deformation (Bernstein/FFD lattice) so moving cage points reshapes the final mesh.
- Rebuilds the deformed mesh live while cage points are edited.
- Resamples cage points when `cageDivisionsU/V/W` change so shape edits are preserved instead of reset.
- Preserves cage edits when base sphere `radius`/`resolution` are changed.
- Supports multi-point cage selection with Shift/Ctrl/Cmd-click and group transforms.
- `Escape` clears cage point selection.
- Reuses spline-mode viewport picking for cage points to provide direct 3D manipulation.

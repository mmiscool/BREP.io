# Pattern

Status: Implemented

![Pattern dialog](Pattern_dialog.png)

Pattern creates linear or circular arrays of solids, with an option to union the generated instances back into the source. It is the single modeling feature for both linear and circular patterns.

## Inputs
- `solids` – Solids to pattern. Face/edge selections resolve their owning solid automatically.
- `mode` – `LINEAR` or `CIRCULAR`.
- `count` – Total instances including the original (clamped to ≥1).
- `countMode` – `count and pitch` uses the distance/angle as the step between adjacent instances; `count and span` treats the distance/angle as the full extent and divides it across `count - 1` intervals.
- `linearInputMode` – `transform` uses the transform gizmo offset; `vector distance` uses a selected direction reference and numeric distance. New linear patterns default to `vector distance`.
- `offset` – Transform used for linear patterns; only `position` is applied between instances.
- `directionRef` – Edge direction or face/plane normal used for linear patterns in `vector distance` mode.
- `linearDistance` – Distance between linear instances in `vector distance` mode.
- `axisRef` – Edge supplying the axis direction and origin for circular patterns.
- `centerOffset` – Distance along the axis from the reference origin to the pattern center.
- `totalAngleDeg` – Circular angle value. In `count and pitch` mode it is the per-step angle; in `count and span` mode it is the total span.
- `booleanMode` – `NONE` returns separate bodies; `UNION` fuses clones into the source and removes the originals.

## Behaviour
- Linear mode translates clones by either `offset.position * instanceIndex` or `directionRef * linearDistance * instanceIndex`. In `count and span` mode that per-instance offset is divided by `count - 1`.
- Circular mode rotates clones about the selected edge axis and center. In `count and pitch` mode each copy advances by the entered angle, so `count = 3` and `totalAngleDeg = 90` creates copies at 90 degrees and 180 degrees. In `count and span` mode the entered angle is divided by `count - 1`.
- When `booleanMode` is `UNION`, clones are merged into each source solid and the originals are flagged for removal; otherwise all clones are returned as separate solids.
- Face names on clones are retagged with the feature ID to keep downstream selections stable even when booleaned together.

## Linear Patterns

Use `vector distance` when the spacing should follow model geometry. Select an edge for an edge direction, or select a face/plane for its normal, then set `linearDistance`.

Use `transform` when the spacing should come from the transform control. Only the transform position is used; rotation and scale are ignored for Pattern spacing.

## Circular Patterns

Circular mode requires an edge for `axisRef`. The selected edge supplies both the rotation direction and the reference point for the pattern center. `centerOffset` moves the center along that same axis.

## Drag Handles

When a Pattern history entry is expanded, editable dimension handles appear for numeric pattern spacing:

- Linear `vector distance` mode shows a draggable distance handle for `linearDistance`.
- Circular mode shows a draggable angle handle for `totalAngleDeg`.
- Linear `transform` mode uses the transform control instead of a distance handle.

# Feature Dimension Gizmos (Developer)

This document covers the shared draggable dimension gizmo infrastructure used by Modeling features (not PMI annotations).

## Source Files

- `src/UI/featureDimensions/FeatureDimensionOverlay.js`
- `src/UI/HistoryWidget.js`
- `src/UI/viewer.js`

## Scope and Separation from PMI

- Feature dimension gizmos are edit handles for live feature parameters in Modeling mode.
- They reuse `LabelOverlay` for rendering text labels, but they do not participate in PMI authoring, PMI persistence, or PMI interaction rules.
- PMI behavior remains in PMI annotation systems (`src/UI/pmi/*`, `docs/pmi-annotations/*`).

## Runtime Architecture

1. `HistoryWidget` owns a single `FeatureDimensionOverlay` instance.
2. When the expanded history entry changes, `HistoryWidget._syncFeatureDimensionOverlay()` calls:
   - `overlay.setActive({ entryId, entry, featureClass, form })`
   - `overlay.refresh()`
3. `FeatureDimensionOverlay` builds annotation geometry for the active feature and renders:
   - lines/arcs,
   - arrowhead or dot handles,
   - value labels.
4. During drag, overlay emits field updates through `onFieldChange`.
5. `HistoryWidget.#handleFeatureDimensionFieldChange()` writes input params, refreshes the form, and schedules history execution.

## Supported Feature Keys

`FeatureDimensionOverlay.#isSupportedFeatureKey()` currently supports:

- `P.CU` (Primitive Cube)
- `P.CY` (Primitive Cylinder)
- `P.CO` (Primitive Cone)
- `P.S` (Primitive Sphere)
- `P.PY` (Primitive Pyramid)
- `P.T` (Primitive Torus)
- `E` (Extrude)
- `R` (Revolve)

## Current Feature Field Mapping

- `P.CU`: `sizeX`, `sizeY`, `sizeZ` (linear)
- `P.CY`: `radius`, `height` (linear)
- `P.CO`: `radiusBottom`, `radiusTop`, `height` (linear)
- `P.S`: `radius` (linear)
- `P.PY`: `baseSideLength`, `height` (linear)
- `P.T`: `majorRadius`, `tubeRadius` (linear), `arc` (angle)
- `E`: `distance`, `distanceBack` (linear)
- `R`: `angle` (angle)

## Annotation Types

Two shared builders are used:

- `#createLinearAnnotation(...)`
- `#createAngleAnnotation(...)`

Each annotation carries:

- stable id (`${entryId}:${fieldKey}`),
- rendered geometry (`segments`, `arrowSpecs`, `labelPosition`),
- drag metadata (`drag.kind`, bounds, axis/direction info),
- `draggableRoles` to restrict which arrow endpoints are interactive.

## Drag Behavior and Signed Values

Linear drag:

- Uses a view-aligned drag plane with projection onto annotation direction.
- Snaps by `LINEAR_DRAG_SNAP_STEP`.
- Supports negative values.
- Stabilizes re-grab direction across sign changes by normalizing drag direction against value sign.

Angle drag:

- Uses axis-plane intersection with signed `atan2` angle solve.
- Snaps by `ANGLE_DRAG_SNAP_STEP`.
- Supports negative angles.
- Uses `#unwrapAngleDegrees(...)` so repeated drags continue in the expected direction around wrap boundaries.

On pointer release:

- Overlay emits a `commit: true` field update.
- `HistoryWidget` cancels pending drag-run timers and applies the final commit flow.

## Throttling Layers

Two throttles are applied to reduce rebuild pressure while dragging:

- Overlay event throttle: `DRAG_FIELD_CHANGE_THROTTLE_MS` in `FeatureDimensionOverlay`.
- History execution throttle: `FEATURE_DRAG_RUN_THROTTLE_MS` in `HistoryWidget`.

This allows high-frequency pointer motion while coalescing expensive `runHistory()` calls.

## Label and Arrowhead Collision Avoidance

`FeatureDimensionOverlay` offsets label placement in screen space to avoid cone overlap:

- `#resolveLabelPositionAvoidingArrowHeads(...)`
- `#computeArrowLabelPushPixels(...)`

Key tuning constants:

- `LABEL_ARROW_CLEARANCE_PX`
- `LABEL_ARROW_AVOID_MAX_PUSH_PX`
- `LABEL_ARROW_AVOID_MAX_ITERS`

## Screen-Consistent Gizmo Sizing

Gizmo handle and line thickness scale by camera projection to keep interaction size visually stable across zoom levels:

- `#gizmoScaleAt(...)`
- `#gizmoHandleDimensionsAt(...)`
- `#worldLengthToPixels(...)`

Angle gizmos use screen-sized radius controls via:

- `FEATURE_ANGLE_RADIUS_PX`
- `FEATURE_ANGLE_MIN_RADIUS_PX`

## Extrude/Revolve Reference Stability

Selection-driven features resolve geometry with snapshot-first logic so gizmos stay anchored when booleans replace topology:

- Profile geometry: `#resolveProfileReferenceGeometry(...)`
- Axis line: `#resolveAxisLine(...)`
- Snapshot storage lookup: `entry.persistentData.__refPreviewSnapshots`

This is especially important for revolve angle gizmos after boolean target selection.

## Hover Suppression While Dragging

While a feature gizmo drag is active:

- `HistoryWidget.isFeatureDimensionDragging()` returns true.
- `viewer._shouldSuppressSceneHover()` suppresses normal scene hover highlighting.

After pointer-up, hover behavior returns to normal.

## Extending to a New Feature

1. Add the feature key to `#isSupportedFeatureKey(...)`.
2. Add a builder path in `#buildAnnotations(...)`.
3. Build linear and/or angle annotations with field keys matching `inputParams`.
4. If the feature depends on selected references, prefer snapshot-first resolution.
5. Verify drag, negative values, commit behavior, and throttle responsiveness.

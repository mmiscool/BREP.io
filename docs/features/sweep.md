# Sweep

Status: Implemented

![Sweep feature dialog](Sweep_dialog.png)

Sweep extrudes a single profile along one or more connected path edges using `BREP.Sweep`.

## Inputs
- `profile` – a face or sketch containing a face.
- `consumeProfileSketch` – when `true` (default), removes the source sketch after a successful sweep.
- `path` – one or more edges that define the sweep trajectory. Edges are chained in the order selected.
- `orientationMode` – `translate` keeps the profile orientation fixed; `pathAlign` attempts to align the profile frame to the path.
- `twistAngle` – optional twist (degrees) distributed along the path.
- `boolean` – optional union/subtract/intersect applied after the sweep solid is built.

## Behaviour
- The feature requires a path selection; without it the sweep throws an error to prompt the user.
- The generated sweep runs through the shared boolean helper. Source sketches are removed when `consumeProfileSketch` is enabled.

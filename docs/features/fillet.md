# Fillet

Status: Implemented

![Fillet feature dialog](Fillet_dialog.png)

Fillet replaces selected edges on a single solid with a constant-radius BREP blend.

## Inputs
- `edges` – pick edges directly or select faces to expand into their boundary edges.
- `radius` – constant radius applied to every edge.

## Behaviour
- All selected edges must belong to the same solid; face picks expand to boundary edges before the builder runs.
- On success the original solid is replaced by the blended result.

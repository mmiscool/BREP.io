# Push Face

Status: Implemented

Push Face moves one or more selected faces on a solid by calling `solid.pushFace()` with the specified signed distance.

## Inputs
- `faces` – one or more face selections on the same solid.
- `distance` – signed push distance along each selected face normal.
- `id` – optional identifier for the history entry.

## Behaviour
- Resolves all selected faces to a single source solid.
- Clones the source solid, pushes each selected face on the clone, and replaces the source solid in the scene.
- Preserves the source solid name so downstream history references continue to resolve against the updated body.

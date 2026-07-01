# PMI Workbench

![PMI Mode](../PMI.png)

The PMI workbench is for entering and editing PMI views and annotations. It does not add feature-history creation entries to the `+` menu.

Use it after modeling is complete to capture dimensions, callouts, notes, exploded views, inspection data, and view-specific manufacturing intent without altering the underlying solid.

## Features
- No feature-history creation entries are exposed in this workbench.

## PMI Types
- [Linear Dimension](../pmi-annotations/linear-dimension.md)
- [Radial Dimension](../pmi-annotations/radial-dimension.md)
- [Angle Dimension](../pmi-annotations/angle-dimension.md)
- [Leader](../pmi-annotations/leader.md)
- [Note](../pmi-annotations/note.md)
- [Hole Callout](../pmi-annotations/hole-callout.md)
- [Explode Body](../pmi-annotations/explode-body.md)

## Views and Export
- Capture a PMI view from the PMI Views panel to store the current camera, display settings, and annotation list.
- Export Images renders labeled PNGs for saved views by replaying each view and applying its stored annotations.
- 3MF export stores PMI view definitions in `Metadata/featureHistory.json` and attaches generated PNGs under `/views/<view-name>.png`.

## Panels
- [Feature History](../panels/feature-history.md)
- [PMI Views](../panels/pmi-views.md)
- [2D Sheets](../panels/sheets-2d.md)
- [Plugins](../panels/plugins.md)

## Related Docs
- [PMI Annotations Index](../pmi-annotations/index.md)

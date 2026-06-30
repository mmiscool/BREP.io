# Modeling Workbench

![Modeling Mode](../MODELING.png)

The Modeling workbench is the default workbench for new parts. It keeps feature creation focused on general-purpose solid modeling instead of surfacing, sheet metal, or assembly-only workflows.

It combines the feature history tree, 3D viewport, expressions/configurator workflow, and standard modeling toolbars for building and editing parts.

## Features
- Reference geometry: [Datium](../features/datium.md), [Plane](../features/plane.md)
- Primitives: [Cube](../features/primitive-cube.md), [Cylinder](../features/primitive-cylinder.md), [Cone](../features/primitive-cone.md), [Sphere](../features/primitive-sphere.md), [Torus](../features/primitive-torus.md), [Pyramid](../features/primitive-pyramid.md)
- Sketch-driven creation: [Sketch](../features/sketch.md), [Extrude](../features/extrude.md), [Revolve](../features/revolve.md), [Sweep](../features/sweep.md), [Tube](../features/tube.md)
- Editing and booleans: [Boolean](../features/boolean.md), [Fillet](../features/fillet.md), [Chamfer](../features/chamfer.md), [Hole](../features/hole.md), [Push Face](../features/push-face.md), [Thicken](../features/thicken.md), [Offset Shell](../features/offset-shell.md), [Self Intersection Cleanup](../features/self-intersection-cleanup.md)
- Repetition and transforms: [Pattern Linear](../features/pattern-linear.md), [Pattern Radial](../features/pattern-radial.md), [Pattern](../features/pattern.md), [Transform](../features/transform.md), [Mirror](../features/mirror.md)
- Utility geometry: [Text to Face](../features/text-to-face.md), [Helix](../features/helix.md), [Spline](../features/spline.md)

## Panels
- [Feature History](../panels/feature-history.md)
- [Expressions and Configurator](../panels/expressions.md)
- [PMI Views](../panels/pmi-views.md)
- [2D Sheets](../panels/sheets-2d.md)
- [Plugins](../panels/plugins.md)

## Workspace Notes
- The History panel creates, edits, and reorders feature-history entries.
- The Expressions panel stores shared variables such as `width = 20;` and configurator widgets whose values are available as `configurator.fieldName`.
- The Inspector floating window reports per-face and per-edge metrics such as area, length, and owning feature.

## Related
- [All Workbench](./all.md)
- [Expressions and Configurator Panel](../panels/expressions.md)

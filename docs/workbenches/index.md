# Workbenches

Workbench docs are organized around the three UI surfaces each mode controls: tool buttons, feature creation entries, and sidebar panels.

- [Modeling](./modeling.md)
- [Import](./import.md)
- [Surfacing](./surfacing.md)
- [Sheet Metal](./sheet-metal.md)
- [Assemblies](./assemblies.md)
- [Wire Harness](./wire-harness.md)
- [PMI](./pmi.md)
- [Simulation](./simulation.md)
- [All](./all.md)

## Shared Main Toolbar Buttons
Most focused workbenches use the same shared main toolbar set: `📄` New, `💾` Save, `💾+` Save As, `⛶` Zoom To Fit, `🕸️` Wireframe, `📥` Import, `📤` Export, `⠪` Share, `🧾` 2D Sheet Editor, `ℹ️` About, `🪲` History Test Snippet, `</>` Script Runner, `↶` Undo, and `↷` Redo. Localhost builds also show `tests` Browser Tests and `Sel` Selection State when those development tools are enabled for the workbench.

## Workbench-Specific Main Toolbar Buttons
- All exposes every registered built-in main toolbar button, including `⚙` Settings, `Solid diag` Solid Overlap Diagnostics, `FP` Sheet Metal Flat Pattern Export, and localhost-only `tour` Guided Tour, `tests` Browser Tests, `Sel` Selection State, and `SMDBG` Sheet Metal Debug JSON.
- Sheet Metal adds `FP` Sheet Metal Flat Pattern Export and localhost-only `SMDBG` Sheet Metal Debug JSON to the shared main toolbar set.
- Modeling, Import, Surfacing, Assemblies, Wire Harness, PMI, and Simulation do not add extra workbench-specific main toolbar buttons beyond the shared set.
- Simulation adds the selection context action `Sim Xform` Simulation Transform when a single solid is selected.

## Related
- [Tool Buttons](../tools/index.md)
- [Workbench Panels](../panels/index.md)
- [Features](../features/index.md)

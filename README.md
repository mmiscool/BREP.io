# [BREP.io](https://BREP.io)
# [Source https://github.com/mmiscool/BREP](https://github.com/mmiscool/BREP)  
- [NPM package: `brep-io-kernel` https://www.npmjs.com/package/brep-io-kernel](https://www.npmjs.com/package/brep-io-kernel)  
- [Live API examples https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- [Developer Discord https://discord.gg/R5KNAKrQ](https://discord.gg/R5KNAKrQ)

BREP.io is a browser-based CAD application and JavaScript kernel for feature-based solid modeling.  
At its core is a BREP-style modeler with explicit geometry/topology objects such as `Solid`, `Face`, `Edge`, and `Vertex`, paired with an editable feature-history pipeline.  
It also includes sketch workflows powered by a standalone 2D constraint solver, plus robust manifold booleans ([manifold-3d](https://github.com/elalish/manifold)), mesh repair/import tooling, assembly constraints, PMI annotations, and embeddable CAD/sketcher APIs.

This project is in active development and APIs may continue to evolve.

## Screenshots

![Home @280](docs/HOME.png)
[![Modeling Mode @280](docs/MODELING.png)](docs/modes/modeling.md)
[![Sketch Mode @280](docs/SKETCH.png)](docs/modes/sketch.md)
[![PMI Mode @280](docs/PMI.png)](docs/modes/pmi.md)
[![2D Sheets Mode @280](docs/SHEETS.png)](docs/modes/sheets.md)
[![Image to Face 2D @280](docs/features/image-to-face-2D_dialog.png)](docs/features/image-to-face.md)
[![Image to Face 3D @280](docs/features/image-to-face-3D_dialog.png)](docs/features/image-to-face.md)


## Documentation Index

General:
- [Getting Started](docs/getting-started.md)
- [Developer Docs Index](docs/developer-index.md)
- [Bug Reporting and Repro Test Cases](docs/bug-reporting.md)
- [Highlights](docs/highlights.md)
- [What's New](docs/whats-new.md)
- [API Examples](docs/api-examples.md)

Core APIs:
- [BREP API Export Map](docs/brep-api.md)
- [BREP Kernel Reference](docs/brep-kernel.md)
- [Solid Methods](docs/solid-methods.md)
- [Part History](docs/part-history.md)
- [2D Sketch Solver](docs/sketch-solver-2d.md)
- [Embeddable CAD (`CadEmbed`)](docs/cad-embed.md)
- [Embeddable Sketcher (`Sketcher2DEmbed`)](docs/sketcher2d-embed.md)

System docs:
- [History Systems](docs/history-systems.md)
- [Input Params Schema](docs/input-params-schema.md)
- [File Formats: Import and Export](docs/file-formats.md)
- [Plugins and Examples](docs/plugins.md)
- [Inspector](docs/inspector.md)
- [Inspector Improvements](docs/inspector-improvements.md)

Mode guides:
- [Modeling Mode](docs/modes/modeling.md)
- [Sketch Mode](docs/modes/sketch.md)
- [PMI Mode](docs/modes/pmi.md)
- [2D Sheets Mode](docs/modes/sheets.md)

## Modeling Feature Docs

Feature index:
- [All Feature Docs](docs/features/index.md)

Primitives and setup:
- [Primitive Cube](docs/features/primitive-cube.md)
- [Primitive Cylinder](docs/features/primitive-cylinder.md)
- [Primitive Cone](docs/features/primitive-cone.md)
- [Primitive Sphere](docs/features/primitive-sphere.md)
- [Primitive Torus](docs/features/primitive-torus.md)
- [Primitive Pyramid](docs/features/primitive-pyramid.md)
- [Plane](docs/features/plane.md)
- [Datum](docs/features/datum.md)
- [Datium](docs/features/datium.md)
- [Sketch](docs/features/sketch.md)
- [Spline](docs/features/spline.md)
- [Helix](docs/features/helix.md)

Solid operations:
- [Extrude](docs/features/extrude.md)
- [Sweep](docs/features/sweep.md)
- [Tube](docs/features/tube.md)
- [Loft](docs/features/loft.md)
- [Revolve](docs/features/revolve.md)
- [Mirror](docs/features/mirror.md)
- [Boolean](docs/features/boolean.md)
- [Fillet](docs/features/fillet.md)
- [Chamfer](docs/features/chamfer.md)
- [Hole](docs/features/hole.md)
- [Offset Shell](docs/features/offset-shell.md)
- [Remesh](docs/features/remesh.md)
- [Transform](docs/features/transform.md)

Pattern, import, and generation:
- [Pattern (Legacy Combined)](docs/features/pattern.md)
- [Pattern Linear](docs/features/pattern-linear.md)
- [Pattern Radial](docs/features/pattern-radial.md)
- [Import 3D Model](docs/features/import-3d-model.md)
- [Image Heightmap Solid](docs/features/image-heightmap-solid.md)
- [Image to Face](docs/features/image-to-face.md)
- [Text to Face](docs/features/text-to-face.md)

Assembly and sheet metal:
- [Assembly Component](docs/features/assembly-component.md)
- [Sheet Metal Tab](docs/features/sheet-metal-tab.md)
- [Sheet Metal Contour Flange](docs/features/sheet-metal-contour-flange.md)
- [Sheet Metal Flange](docs/features/sheet-metal-flange.md)

Additional implemented features in the codebase include collapse edge, edge smooth, offset face, overlap cleanup, sheet metal hem, and sheet metal cutout.

## Assembly Constraints

- [Assembly Constraint Solver](docs/assembly-constraints/solver.md)
- [Coincident](docs/assembly-constraints/coincident-constraint.md)
- [Distance](docs/assembly-constraints/distance-constraint.md)
- [Angle](docs/assembly-constraints/angle-constraint.md)
- [Parallel](docs/assembly-constraints/parallel-constraint.md)
- [Touch Align](docs/assembly-constraints/touch-align-constraint.md)
- [Fixed](docs/assembly-constraints/fixed-constraint.md)

## PMI Annotation Docs

- [PMI Annotations Index](docs/pmi-annotations/index.md)
- [Linear Dimension](docs/pmi-annotations/linear-dimension.md)
- [Radial Dimension](docs/pmi-annotations/radial-dimension.md)
- [Angle Dimension](docs/pmi-annotations/angle-dimension.md)
- [Leader](docs/pmi-annotations/leader.md)
- [Note](docs/pmi-annotations/note.md)
- [Hole Callout](docs/pmi-annotations/hole-callout.md)
- [Explode Body](docs/pmi-annotations/explode-body.md)


## Quick Start

Prerequisites:
- Node.js 18+
- `pnpm`

Install and run locally:

```bash
pnpm install
pnpm dev
```

Then open the Vite URL shown in your terminal.
- Main app shell: `/index.html`
- Direct CAD workspace: `/cad.html`

## Build, Test, and Utility Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Prepares fonts, builds the kernel bundle, then runs the Vite dev server. |
| `pnpm build` | Production build of the app into `dist/` (includes kernel build step). |
| `pnpm build:kernel` | Builds the ESM kernel bundle into `dist-kernel/` and syncs assets. |
| `pnpm test` | Runs the Node test suite (`src/tests/tests.js`), writing artifacts to `tests/results/`. |
| `pnpm liveTesting` | Watches `src/` and `tests/` and reruns tests on change. |
| `pnpm capture` | Captures docs/dialog screenshots. |
| `pnpm generateLicenses` | Regenerates dependency and bundled-font license summaries. |

Build outputs:
- `dist/`: static web app (ready for CDN/web hosting)
- `dist-kernel/`: published kernel bundle artifacts

## Use as an NPM Package

Package name: `brep-io-kernel` (ESM-only).

Install:

```bash
pnpm add brep-io-kernel
```

Main imports:

```js
import {
  BREP,
  PartHistory,
  AssemblyConstraintHistory,
  AssemblyConstraintRegistry,
  CadEmbed,
  Sketcher2DEmbed
} from "brep-io-kernel";
```

Subpath imports:

```js
import { BREP } from "brep-io-kernel/BREP";
import { PartHistory } from "brep-io-kernel/PartHistory";
import { CadEmbed } from "brep-io-kernel/CAD";
import { Sketcher2DEmbed } from "brep-io-kernel/Sketcher2D";
import { ConstraintSolver, ConstraintEngine, constraints } from "brep-io-kernel/SketchSolver2D";
```

Node examples:
- [brep-io-kernel-examples/README.md](brep-io-kernel-examples/README.md)

CLI helper:

```bash
npx brep-io-kernel
npx brep-io-kernel --host 127.0.0.1 --port 4173
npx brep-io-kernel --help
```

License helper APIs:

```js
import { getPackageLicenseInfoString, getAllLicensesInfoString } from "brep-io-kernel";

console.log(getPackageLicenseInfoString()); // package license info
console.log(getAllLicensesInfoString());    // package + production dependencies
```

CommonJS note:

```js
const { BREP } = await import("brep-io-kernel");
```



## Repository Layout

- `src/BREP`: core solid/kernel implementation
- `src/features`: feature implementations and dialogs
- `src/assemblyConstraints`: assembly solver and constraints
- `src/UI`: CAD/sketcher UI and embedding bridges
- `docs/`: markdown docs and screenshots
- `apiExamples/`: standalone browser API demos
- `tests/` and `src/tests/`: test assets and test runner

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE.md](LICENSE.md). This project uses a dual-licensing strategy managed by Autodrop3d LLC.

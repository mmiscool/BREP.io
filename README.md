# [BREP.io](https://BREP.io)

> [!WARNING]
> ## This project is deprecated
>
> BREP.io is no longer under active development. Please use the new [BREP.io project](https://next.BREP.io) instead. It has a completely new codebase written in Rust and provides a real BREP kernel with real surfaces and support for reading and writing real STEP files.

This repository is preserved for historical and reference purposes. The legacy browser-based CAD application and JavaScript kernel may still be useful for studying the earlier mesh-based implementation, but APIs and behavior are no longer actively maintained.

## Successor project

For the current BREP.io project, visit **[https://next.BREP.io](https://next.BREP.io)**.

The successor is built completely from scratch in Rust and provides:

- Real geometric surfaces
- Real BREP topology
- Reading and writing of STEP files

## Archived project resources

- [Source repository](https://github.com/mmiscool/BREP.io)
- [NPM package: `brep-io-kernel`](https://www.npmjs.com/package/brep-io-kernel)
- [Legacy live application](https://BREP.io)
- [Legacy API examples](https://BREP.io/apiExamples/index.html)
- [Developer Discord](https://discord.gg/R5KNAKrQ)

## Archived documentation

The documentation below describes the deprecated implementation and is retained for reference:

- [Developer Docs Index](docs/developer/index.md)
- [Modeling Workbench](docs/workbenches/modeling.md)
- [Import Workbench](docs/workbenches/import.md)
- [Surfacing Workbench](docs/workbenches/surfacing.md)
- [Sheet Metal Workbench](docs/workbenches/sheet-metal.md)
- [Assemblies Workbench](docs/workbenches/assemblies.md)
- [PMI Workbench](docs/workbenches/pmi.md)
- [All Feature Docs](docs/features/index.md)
- [Assembly Constraint Solver](docs/assembly-constraints/solver.md)
- [PMI Annotations Index](docs/pmi-annotations/index.md)

## Archived quick start

The legacy application can still be run locally with Node.js 18+, `pnpm`, and initialized submodules:

```bash
git submodule update --init --recursive
pnpm install
pnpm dev
```

Then open the Vite URL shown in the terminal. The main app shell is `/index.html` and the CAD workspace is `/cad.html`.

## Archived package usage

The deprecated package was published as `brep-io-kernel`:

```bash
pnpm add brep-io-kernel
```

```js
import { BREP, PartHistory } from "brep-io-kernel";
```

See [brep-io-kernel examples](brep-io-kernel-examples/README.md) for archived package examples.

## License

See [LICENSE.md](LICENSE.md). This project uses a dual-licensing strategy managed by Autodrop3d LLC.

# Embeddable 2D Sketcher

This document covers the iframe-based `Sketcher2DEmbed` API for embedding the 2D sketcher in another app.

## Demo Page
- Hosted demo: [https://BREP.io/apiExamples/Embeded_2D_Sketcher.html](https://BREP.io/apiExamples/Embeded_2D_Sketcher.html)
- Repo demo page: `apiExamples/Embeded_2D_Sketcher.html`
- Source on GitHub: [apiExamples/Embeded_2D_Sketcher.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_2D_Sketcher.html)

## Import
Package usage:
```js
import { Sketcher2DEmbed } from "brep-io-kernel/Sketcher2D";
// or: import { Sketcher2DEmbed } from "brep-io-kernel";
```

Local repo/dev usage:
```js
import { Sketcher2DEmbed } from "/src/Sketcher2D.js";
```

## Create and Mount
```js
const sketcher = new Sketcher2DEmbed({
  mountTo: "#sketch-host",
  width: "100%",
  height: "560px",
  geometryColor: "#ffd400",
  pointColor: "#8bc5ff",
  constraintColor: "#6aa8ff",
  backgroundColor: "#0b0f14",
  pointSizePx: 10,
  curveThicknessPx: 2,
  sidebarExpanded: false,
  gridVisible: true,
  gridSpacing: 1,
  cssText: ".sketch-dims .dim-label { border-color: #4f8cff !important; }",
  onChange: (sketch, payload) => console.log("changed", sketch, payload),
  onFinished: (sketch, payload) => console.log("finished", sketch, payload),
  onCancelled: (payload) => console.log("cancelled", payload),
});

const iframe = await sketcher.mount(); // uses mountTo/container
```

Or pass a host element directly:
```js
const host = document.getElementById("sketch-host");
await sketcher.mount(host);
```

## Runtime API
```js
await sketcher.waitUntilReady();

await sketcher.setTheme({
  geometryColor: "#ff5a00",
  pointColor: "#98fb98",
  constraintColor: "#00ff00",
  backgroundColor: "#000000",
  pointSizePx: 12,
  curveThicknessPx: 2.5,
});
await sketcher.setSidebarExpanded(false);
await sketcher.setGrid({ visible: true, spacing: 2.5 });
await sketcher.setCss("#main-toolbar { background: #111 !important; }");

const sketch = await sketcher.getSketch();
await sketcher.setSketch(sketch);

const cachedSketch = await sketcher.getSketch({ preferCached: true });

const svg = await sketcher.exportSVG({
  flipY: true,
  precision: 3,
  stroke: "#111111",
  strokeWidth: 1.5,
  fill: "none",
  padding: 12,
});

await sketcher.destroy();
```

## Properties
- `sketcher.iframe`: iframe element after `mount()`, otherwise `null`.
- `sketcher.instanceId`: resolved instance id used for the message channel.

## Constructor Options
- `mountTo` or `container`: host selector or DOM element for iframe insertion.
- `width`, `height`: iframe size (defaults: `100%`, `520px`).
- `title`: iframe title attribute (default: `BREP Sketcher 2D`).
- `iframeClassName`: class applied to iframe element.
- `iframeStyle`: inline style object merged into iframe styles.
- `iframeAttributes`: extra iframe attributes map.
- `initialSketch`: initial sketch JSON loaded on init.
- `cssText`: custom CSS injected into the iframe document.
- `geometryColor`: default curve/edge color.
- `pointColor`: default point/handle color.
- `constraintColor`: default constraint glyph/dimension color.
- `backgroundColor`: iframe sketch viewport background.
- `pointSizePx` or `pointSize`: point handle size in pixels.
- `curveThicknessPx` or `curveThickness`: curve stroke thickness in pixels.
- `sidebarExpanded`: initial sidebar state (`true`/`false`, default `false`).
- `gridVisible`: show/hide sketch grid (`true`/`false`, default `false`).
- `gridSpacing`: grid cell spacing in sketch units (default `1`).
- `showGrid`: alias for `gridVisible`.
- `onChange(sketch, payload)`: fired when sketch changes.
- `onFinished(sketch, payload)`: fired when user presses Finish.
- `onCancelled(payload)`: fired when user presses Cancel.
- `onFinish`: alias of `onFinished`.
- `onCanceled`: alias of `onCancelled`.
- `channel`: postMessage channel id (advanced; default `brep:sketcher2d`).
- `instanceId`: explicit iframe instance id.
- `targetOrigin`: postMessage target origin (default `*`).
- `requestTimeoutMs`: request timeout in milliseconds (default `12000`).
- `frameModuleUrl`: module URL used by the iframe to import `bootSketcher2DFrame` (advanced; defaults to current module URL).

## Methods
- `mount(target?)`: mounts and initializes the iframe, returns the iframe element.
- `waitUntilReady()`: resolves when iframe bootstrap and `init` are complete.
- `getSketch(options?)`: returns current sketch JSON.
- `setSketch(sketch)`: replaces current sketch JSON and returns applied sketch.
- `setCss(cssText)`: applies custom CSS inside the iframe.
- `setTheme(theme)`: applies runtime theme.
- `setPointSize(pointSizePx)`: convenience wrapper for `setTheme({ pointSizePx })`.
- `setCurveThickness(curveThicknessPx)`: convenience wrapper for `setTheme({ curveThicknessPx })`.
- `setSidebarExpanded(boolean)`: toggles embedded sidebar.
- `setGrid(options)`: updates grid settings. Supports `{ visible, spacing }` or `{ gridVisible, gridSpacing }`.
- `setGridVisible(boolean)`: toggles grid visibility.
- `setGridSpacing(number)`: updates grid spacing (must be > 0).
- `exportSVG(options?)`: exports current sketch as SVG data (see below).
- `destroy()`: disposes iframe and message handlers.

`getSketch({ preferCached: true })` returns the latest cached sketch from recent events or calls when available.

## `exportSVG()` Options and Return
`exportSVG(options)` uses the same conversion pipeline as `sketchToSVG()`.

Options:
- `precision` (default `3`)
- `padding` (default `10`)
- `stroke` (default `#111111`)
- `strokeWidth` (default `1.5`)
- `fill` (default `none`)
- `background` (default `null`)
- `flipY` (default `true`)
- `includeConstruction` (default `false`)
- `bezierSamples` (default `24`)

Return shape:
- `svg`: serialized `<svg ...>` string.
- `paths`: array of `{ id, type, d, construction, closed }`.
- `bounds`: `{ minX, minY, maxX, maxY, contentWidth, contentHeight, width, height, padding, flipY, transform }`.

## Lifecycle Notes
- `mount()` is idempotent for an active instance: if already mounted, it returns the same iframe after readiness.
- After `destroy()`, the instance is terminal. Create a new `Sketcher2DEmbed` instance to mount again.

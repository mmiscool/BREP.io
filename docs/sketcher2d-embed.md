# Embeddable 2D Sketcher

This document covers the library-facing API for embedding the 2D sketcher in another application using an iframe container.

## Demo Page
- Hosted demo: <a href="https://BREP.io/test.html" target="_blank" rel="noopener noreferrer">https://BREP.io/test.html</a>

## Import and Create
```js
import { Sketcher2DEmbed } from "/src/Sketcher2D.js";

const sketcher = new Sketcher2DEmbed({
  mountTo: "#sketch-host",
  width: "100%",
  height: "560px",
  geometryColor: "#ffd400",
  pointColor: "#8bc5ff",
  constraintColor: "#6aa8ff",
  backgroundColor: "#0b0f14",
  sidebarExpanded: true,
  cssText: ".sketch-dims .dim-label { border-color: #4f8cff !important; }",
  onChange: (sketch) => console.log("changed", sketch),
  onFinished: (sketch) => console.log("finished", sketch),
  onCancelled: () => console.log("cancelled"),
});
```

## Insert iframe into the DOM
`mount()` creates the iframe and appends it to your host element.

```js
await sketcher.mount(); // uses mountTo/container from constructor options
```

Or pass the host directly:

```js
const host = document.getElementById("sketch-host");
await sketcher.mount(host);
```

## Runtime API
```js
await sketcher.setTheme({
  geometryColor: "#ff5a00",
  pointColor: "#98fb98",
  constraintColor: "#00ff00",
  backgroundColor: "#000000",
});
await sketcher.setSidebarExpanded(false);
await sketcher.setCss("#main-toolbar { background: #111 !important; }");

const sketch = await sketcher.getSketch();
await sketcher.setSketch(sketch);
const svg = await sketcher.exportSVG({ flipY: true, precision: 3 });
await sketcher.destroy();
```

## Constructor Options
- `mountTo` or `container`: host selector or DOM element for iframe insertion.
- `width`, `height`: iframe size (defaults: `100%`, `520px`).
- `title`: iframe title attribute.
- `iframeClassName`: class applied to iframe element.
- `iframeStyle`: inline style object merged into iframe styles.
- `iframeAttributes`: extra iframe attributes map.
- `initialSketch`: initial sketch JSON loaded on init.
- `cssText`: custom CSS injected into the iframe document.
- `geometryColor`: default curve/edge color.
- `pointColor`: default point/handle color.
- `constraintColor`: default constraint glyph/dimension color.
- `backgroundColor`: iframe sketch viewport background.
- `sidebarExpanded`: initial sidebar state (`true`/`false`).
- `onChange(sketch, payload)`: fired when sketch changes.
- `onFinished(sketch, payload)`: fired when user presses Finish.
- `onCancelled(payload)`: fired when user presses Cancel.
- `onFinish`: alias of `onFinished`.
- `onCanceled`: alias of `onCancelled`.
- `channel`: postMessage channel id (advanced; default `brep:sketcher2d`).
- `instanceId`: explicit iframe instance id.
- `targetOrigin`: postMessage target origin (default `*`).
- `requestTimeoutMs`: request timeout in milliseconds (default `12000`).

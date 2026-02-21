# Embeddable CAD App

This document covers the iframe-based `CadEmbed` API for embedding the full BREP CAD app in another app.

## Demo Page
- Hosted examples index: [https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- Hosted demo: [https://BREP.io/apiExamples/Embeded_CAD.html](https://BREP.io/apiExamples/Embeded_CAD.html)
- Repo demo page: [apiExamples/Embeded_CAD.html](../apiExamples/Embeded_CAD.html)
- Source on GitHub: [apiExamples/Embeded_CAD.html](https://github.com/mmiscool/BREP/blob/master/apiExamples/Embeded_CAD.html)
- Hosted integration test: [https://BREP.io/apiExamples/Embeded_CAD_Integration_Test.html](https://BREP.io/apiExamples/Embeded_CAD_Integration_Test.html)
- Integration test page: [apiExamples/Embeded_CAD_Integration_Test.html](../apiExamples/Embeded_CAD_Integration_Test.html)

## Import
Package usage:
```js
import { CadEmbed } from "brep-io-kernel";
// or: import { CadEmbed } from "brep-io-kernel/CAD";
```

Local repo/dev usage:
```js
import { CadEmbed } from "/src/CAD.js";
```

## Create and Mount
```js
const cad = new CadEmbed({
  mountTo: "#cad-host",
  width: "100%",
  height: "760px",
  sidebarExpanded: true,
  viewerOnlyMode: false,
  cssText: ".cad-sidebar-home-banner { display: none !important; }",
  onReady: (state) => console.log("cad ready", state),
  onHistoryChanged: (state) => console.log("history changed", state),
});

const iframe = await cad.mount();
```

Or pass a host element directly:
```js
const host = document.getElementById("cad-host");
await cad.mount(host);
```

## Runtime API
```js
await cad.waitUntilReady();

const state = await cad.getState();
console.log(state.featureCount, state.model);

const json = await cad.getPartHistoryJSON();
const history = await cad.getPartHistory();

await cad.setPartHistory(history);
await cad.setCss("#sidebar { background: rgba(5, 10, 16, 0.95) !important; }");
await cad.setSidebarExpanded(false);

await cad.loadModel({
  modelPath: "examples/gearbox", // .3mf optional
  source: "local",              // local | github | mounted
  repoFull: "owner/repo",       // for github/mounted scopes
  branch: "main",               // optional
});

await cad.runHistory();
await cad.reset();
await cad.destroy();
```

## Properties
- `cad.iframe`: iframe element after `mount()`, otherwise `null`.
- `cad.instanceId`: resolved instance id used for the message channel.

## Constructor Options
- `mountTo` or `container`: host selector or DOM element for iframe insertion.
- `width`, `height`: iframe size (defaults: `100%`, `760px`).
- `title`: iframe title attribute (default: `BREP CAD`).
- `iframeClassName`: class applied to iframe element.
- `iframeStyle`: inline style object merged into iframe styles.
- `iframeAttributes`: extra iframe attributes map.
- `backgroundColor`: iframe background color fallback.
- `viewerOnlyMode`: start in viewer-only mode.
- `sidebarExpanded`: initial sidebar state.
- `cssText`: custom CSS injected into the iframe document.
- `initialPartHistoryJSON`: initial part history JSON string.
- `initialPartHistory`: initial part history object (auto-stringified).
- `initialModel`: optional model load request object passed to `loadModel()` during init.
- `onReady(state)`: called after iframe init completes.
- `onHistoryChanged(state)`: called when part history is rerun/reset/loaded.
- `onChange`: alias for `onHistoryChanged`.
- `channel`: postMessage channel id (advanced; default `brep:cad`).
- `instanceId`: explicit iframe instance id.
- `targetOrigin`: postMessage target origin (default `*`).
- `requestTimeoutMs`: request timeout in milliseconds (default `20000`).
- `frameModuleUrl`: module URL used by the iframe to import `bootCadFrame` (advanced; defaults to current module URL).

## Methods
- `mount(target?)`: mounts and initializes the iframe, returns the iframe element.
- `waitUntilReady()`: resolves when iframe bootstrap and `init` are complete.
- `getState()`: returns current summary state.
- `getPartHistoryJSON(options?)`: returns current part history JSON string.
- `getPartHistory(options?)`: returns parsed part history object.
- `setPartHistoryJSON(jsonOrObject)`: replaces part history and reruns.
- `setPartHistory(historyObject)`: convenience wrapper for `setPartHistoryJSON`.
- `setCss(cssText)`: applies custom CSS inside the iframe.
- `setSidebarExpanded(boolean)`: toggles sidebar visibility.
- `loadModel(modelPathOrRequest, options?)`: loads a saved model through File Manager storage scopes.
- `runHistory()`: reruns current feature history.
- `reset()`: clears the model and reruns.
- `destroy()`: disposes iframe and message handlers.

## Lifecycle Notes
- `mount()` is idempotent for an active instance: if already mounted, it returns the same iframe after readiness.
- After `destroy()`, the instance is terminal. Create a new `CadEmbed` instance to mount again.
- `viewerOnlyMode` cannot be changed after initialization.

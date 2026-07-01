# `</>` Script Runner

Opens a JavaScript runner with access to the current app environment.

Use it for ad-hoc automation, inspection, and debugging against `window.env` and the current viewer.

![Script Runner floating window](../floating-windows/script-runner.png)

## Saved Scripts

The editor automatically saves the current script after code changes. Saved scripts are stored in the browser's IndexedDB database for the current site, so they are restored when the Script Runner is opened again in a later browser session.

Use the script selector to switch between saved scripts. The name field controls the current script name. `New` starts a blank script, `Save` writes the current script immediately, and `Delete` removes the selected script.

## Workbench Availability

Available in Modeling, Import, Surfacing, Sheet Metal, Assemblies, Wire Harness, PMI, Simulation, and All.

## Related
- [Plugins and Examples](../developer/subsystems/plugins.md)

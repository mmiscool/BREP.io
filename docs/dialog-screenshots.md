# Documentation Screenshots

1. Run `pnpm dev` and open at least one of the capture helper pages:
   - `http://localhost:5173/feature-dialog-capture.html`
   - `http://localhost:5173/pmi-dialog-capture.html`
   - `http://localhost:5173/assembly-constraint-capture.html`
2. With the dev server running, execute `pnpm capture` to export screenshots. Outputs land in:
   - `docs/features` (feature dialogs)
   - `docs/pmi-annotations` (PMI annotations)
   - `docs/assembly-constraints` (assembly constraints)
   - `docs/MODELING.png`, `docs/SKETCH.png`, `docs/PMI.png`
   - `docs/features/image-to-face-2D_dialog.png`, `docs/features/image-to-face-3D_dialog.png`
   - Full-page documentation captures use a fixed viewport (`1200x760`) for consistent, smaller image size.

For the schema that drives these dialogs (field types, defaults, and selection filters), see [Input Params Schema](./input-params-schema.md).

## Configuration

Customize the automation with environment variables:

- `CAPTURE_SCOPE=features,pmi,assembly,docs` limits which capture helpers are processed.
- `CAPTURE_BASE_URL=http://127.0.0.1:5174` points to a dev server running on a different host/port.
- `CAPTURE_URL` + `CAPTURE_OUTPUT` run a one-off capture against any URL.
- `CAPTURE_HEADLESS=true` runs without showing the browser window (default is headed so you can watch captures live).
- `CAPTURE_KEEP_OPEN=false` closes the browser immediately after capture (default keeps it open in headed mode; press `Ctrl+C` to exit).
- `CAPTURE_SKIP_HISTORY_DIALOGS=true` skips any dialog whose name includes `History`.
  - Equivalent pnpm flag: `pnpm capture --capture-skip-history=true`
- `CAPTURE_DEVICE_SCALE_FACTOR=1` (default `2`) controls the browser’s device pixel ratio for sharper or softer renders.
- `CAPTURE_OUTPUT_SCALE=device` keeps the full hi-DPI image size instead of downscaling back to CSS pixels (default `css` keeps the files small while retaining clarity).

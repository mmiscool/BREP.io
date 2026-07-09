# Image Editor (Shared)

Status: Implemented

The in-app Image Editor is shared by `Image to Face` and `Image Heightmap Solid`. It is a full-screen raster editor with live preview updates and save/cancel handoff back to the feature dialog.

![Image Editor open from Image to Face](image-to-face-2D_dialog.png)

## Where It Is Used
- [Image to Face](./image-to-face.md) via `editImage`
- [Image Heightmap Solid](./image-heightmap-solid.md) via `editImage`

## Open / Save Flow
1. Open a feature dialog (`Image to Face` or `Image Heightmap Solid`).
2. Click `Edit Image`.
3. Edit the bitmap in the full-screen editor.
4. Click `Finish` to write a PNG data URL back into `fileToImport`, or `Cancel` to discard edits.

## Tools
- `Brush` (`B`) – paint with color + brush size.
- `Eraser` (`E`) – erase to transparency.
- `Bucket` (`G`) – flood fill with adjustable tolerance (`0-255`).
- `Pan` (button or hold `Space`) – drag the view.
- `Break` – add/remove manual edge-break points on traced loops (mainly relevant for `Image to Face` edge segmentation).

Brush shapes:
- `Round`
- `Square`
- `Diamond`

## View Controls
- Mouse wheel zooms at cursor.
- Two-finger pinch zooms and pans on touch devices.
- `Fit` button (or `F`) resets view to fit the working canvas.
- Default open view is 1:1 image pixel display.
- Bottom-right resize handle changes working canvas size (supports expanding/cropping while preserving existing edits). The handle uses a larger hit area on touch/pen devices.

## Touch / Mobile Support
- Input is handled through Pointer Events, so mouse, touch, and pen all work.
- One finger draws (or pans/inserts breaks, depending on the active tool); two fingers pinch to zoom and pan. Bringing a second finger down cancels any in-progress single-finger stroke.
- The toolbar wraps onto multiple rows on narrow screens, and buttons/controls get larger touch targets.
- On narrow (mobile) screens the parameter panel becomes a bottom sheet in a split layout: the canvas stays on top and the params sit below, so the live trace preview remains visible while you tune parameters. Toggle the sheet with the `Params` button; opening/closing re-fits the image to the resized canvas area.
- On wider screens the params panel is a side panel that the `Params` button collapses to reclaim canvas space.

## Undo / Redo And Hotkeys
- `Undo`: `Ctrl/Cmd+Z`
- `Redo`: `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z`
- `Finish`: `Enter`
- `Cancel`: `Esc`

## Feature-Specific Notes
- `Image to Face`: editor can include the parameter form in the sidebar and uses live traced-vector overlays + edge-break management (`edgeBreakPoints`, `edgeSuppressedBreaks`).
- `Image Heightmap Solid`: uses the same raster editing workflow to prepare heightmap imagery before height sampling.

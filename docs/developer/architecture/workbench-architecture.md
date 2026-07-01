# Workbench Architecture

This page records the implemented workbench architecture and the design rules that guided it.

## Goal

Persistent CAD workbenches reduce UI clutter by limiting what the user sees in:

- the `+` menu under feature history
- the selection context toolbar
- selected side panels
- selected main toolbar buttons

Workbenches do **not** change the underlying model structure and do **not** hide existing history entries. They are UI filters only.

## Core User Experience

At the top of the History panel, the workbench dropdown selects the current workbench for the part. That selection is saved with the part.

Supported built-in workbenches are:

- `MODELING`
- `IMPORT`
- `SURFACING`
- `SHEET_METAL`
- `ASSEMBLIES`
- `WIRE_HARNESS`
- `PMI`
- `SIMULATION`
- `ALL`

`ALL` means the current behavior: every eligible feature/tool is visible regardless of workbench grouping.

## Non-Goals

- Do not hide or remove existing feature entries from the history list based on workbench.
- Do not prevent editing an existing feature because it belongs to a different workbench.
- Do not infer the active workbench from model contents.

The workbench is an explicit persisted part setting.

## Persistence Rules

Persist the active workbench as top-level part state, alongside other top-level part JSON fields.

Do **not** store it inside `metadataManager`. That system is object-name metadata, not part-level UI state.

Recommended shape:

```json
{
  "features": [],
  "idCounter": 0,
  "expressions": "",
  "activeWorkbench": "MODELING"
}
```

Behavior on load:

- New parts default to `MODELING`.
- Older files with no saved workbench default to `ALL`.
- Files with an explicit saved workbench restore that value.

Because the active workbench is part-level state, it is included in save/load and feature-history undo/redo snapshots with the rest of the serialized part state.

## Workbench Scope

Workbench selection controls only UI visibility for these surfaces:

1. `+` menu in History
2. selection context toolbar actions
3. side panels that are workbench-scoped
4. main toolbar buttons that are workbench-scoped

History entries remain visible and editable regardless of active workbench.

## Side Panel Rules

### Assembly Constraints Panel

The Assembly Constraints panel is visible in `ASSEMBLIES`, `WIRE_HARNESS`, and `ALL`.

### PMI Views Panel

The PMI Views panel is visible in authoring workbenches and `ALL`; it is hidden in `SIMULATION`.

Clicking a PMI view can temporarily enter PMI mode from other authoring workbenches.

## PMI Temporary Override Behavior

PMI has special mode-switch behavior.

If the user is already in `PMI` and enters PMI mode from a PMI view, remain in `PMI`.

If the user is in another workbench and enters PMI mode by clicking a PMI view:

1. store the previously selected workbench in temporary runtime state
2. switch the active workbench to `PMI`
3. enter PMI mode

When PMI editing finishes:

- if PMI was entered from another workbench via view click, return to that previously selected workbench

This return behavior applies on:

- `Finish`
- `Cancel`

Implementation detail:

- persisted part state: `activeWorkbench`
- transient viewer state: something like `workbenchReturnTarget`

`workbenchReturnTarget` must not be persisted to the part file.

## Workbench Definitions

Workbench definitions live in separate declarative TypeScript files.

Current structure:

- `src/workbenches/modelingWorkbench.ts`
- `src/workbenches/importWorkbench.ts`
- `src/workbenches/surfacingWorkbench.ts`
- `src/workbenches/sheetMetalWorkbench.ts`
- `src/workbenches/assembliesWorkbench.ts`
- `src/workbenches/wireHarnessWorkbench.ts`
- `src/workbenches/pmiWorkbench.ts`
- `src/workbenches/simulationWorkbench.ts`
- `src/workbenches/allWorkbench.ts`
- `src/workbenches/index.ts`

Each file exports a plain object. Keep them declarative. Avoid putting UI logic in the config files.

Example shape:

```ts
export const MODELING_WORKBENCH = {
  id: 'MODELING',
  label: 'Modeling',
  featureTypes: [
    'D',
    'P',
    'S',
    'E',
    'R',
    'B',
  ],
  contextFamilies: {
    features: true,
    assemblyConstraints: false,
    pmiAnnotations: false,
  },
  sidePanels: {
    assemblyConstraints: false,
    pmiViews: true,
  },
  toolbarButtons: [
    'new',
    'save',
    'saveAs',
    'zoomToFit',
    'wireframe',
    'import',
    'export',
    'share',
    'sheetEditor',
    'about',
    'undo',
    'redo',
  ],
} satisfies WorkbenchDefinition;
```

Notes:

- `featureTypes` use canonical feature short names.
- Shared features such as `D`, `P`, and `S` can appear in multiple workbenches.
- `ALL` behaves as an unrestricted pass-through.

## Canonical Identity Rules

Workbench configs filter by resolved canonical identifiers, not by arbitrary strings from old files.

For built-in features, use `FeatureClass.shortName`.

Do not rely on raw serialized `feature.type` strings alone because aliases and legacy names already exist.

The same principle applies to plugin-defined features and toolbar buttons.

## UI Integration

### 1. History Panel Header

The History widget renders a header above the history list containing:

- workbench label
- dropdown select

Changing the dropdown:

- update the active workbench in part state
- trigger history add-menu refresh
- trigger selection context action refresh
- trigger side panel visibility refresh
- trigger main toolbar visibility refresh
- queues a history snapshot

### 2. `+` Menu Filtering

The `+` menu uses `getAllowedFeatureClasses(viewer)` to return feature classes allowed for the active workbench. This helper:

- resolves built-in features
- includes plugin features
- treats `ALL` as unfiltered

### 3. Context Toolbar Filtering

The current selection context toolbar draws from multiple registries:

- feature classes
- assembly constraint classes
- PMI annotation classes

Workbench filtering must be able to control those families independently.

Current rule:

- outside PMI mode, use the active workbench to decide whether feature context actions and assembly constraint context actions are visible
- inside PMI mode, PMI annotation actions remain available as needed by PMI mode

### 4. Side Panel Visibility

Workbench-scoped panel visibility is refreshed centrally by viewer workbench methods. Do not scatter workbench checks throughout individual panel widgets.

Viewer-level refresh targets include:

- assembly constraints section visibility
- wire harness section visibility
- simulation section visibility
- plugin side-panel visibility

### 5. Main Toolbar Filtering

Some main-toolbar buttons should be scoped by workbench.

Example:

- sheet metal flat pattern export belongs to `SHEET_METAL`

Toolbar buttons register with stable IDs, source metadata, and optional workbench/global visibility. `MainToolbar.refreshWorkbenchVisibility()` toggles registered buttons when the active workbench changes.

Buttons that are global remain visible in all workbenches.

## Plugin Requirements

Plugins must be able to participate in workbenches without forcing every plugin to care about them.

### Plugin Design Goals

- a plugin can register a feature without specifying a workbench
- a plugin can optionally declare one or more target workbenches
- a plugin can optionally contribute toolbar buttons scoped to workbenches
- a plugin can optionally contribute side panels scoped to workbenches
- a plugin must not be required to modify built-in workbench files directly

### Default Plugin Behavior

If a plugin does not specify workbench information:

- its feature should appear in `ALL`
- it should also be reasonable to place it in no specialized built-in workbench by default

This avoids silently cluttering discipline-specific workbenches with unknown plugin tools.

### Plugin API Extensions

Plugins can optionally provide workbench metadata when registering features, toolbar buttons, or side panels.

Supported patterns:

```js
app.registerFeature(MyFeature, {
  workbenches: ['SURFACING', 'ALL'],
});
```

```js
app.addToolbarButton({
  id: 'myPluginAction',
  label: 'MP',
  title: 'My Plugin Action',
  onClick() {},
  workbenches: ['MODELING', 'ALL'],
});
```

```js
app.addSidePanel({
  id: 'myPluginPanel',
  title: 'My Plugin',
  content: () => element,
  workbenches: ['ASSEMBLIES', 'ALL'],
});
```

The plugin API normalizes structured records with IDs and workbench metadata into the runtime registries.

### Plugin Metadata Storage

Workbench metadata for plugin contributions is stored in runtime registries, not in the plugin feature class source itself unless convenient.

Current registries:

- feature workbench registry
- toolbar button registry
- side panel registry

Each registry should normalize:

- stable ID
- source plugin or built-in
- declared workbenches
- fallback behavior

### Plugin Feature Visibility Rules

Plugin features should:

- remain loadable/editable from history even if their workbench is not active
- appear in the `+` menu only when allowed by the active workbench
- appear in selection context creation actions only when allowed by the active workbench

### Plugin Side Panel Visibility Rules

Plugin side panels may declare target workbenches.

If omitted, they should default to:

- visible in `ALL`
- otherwise hidden unless the plugin explicitly opts into a specific workbench or global visibility

Supported global forms:

```js
workbenches: 'ALL'
```

or:

```js
global: true
```

for always-visible plugin panels.

### Plugin Toolbar Visibility Rules

Plugin toolbar buttons may declare target workbenches.

If omitted, default them to:

- visible in `ALL`
- hidden from specialized workbenches unless explicitly opted in

This keeps built-in workbench UX clean.

## Internal Helpers

The central workbench module answers:

- `getActiveWorkbench(partHistory)`
- `setActiveWorkbench(partHistory, workbenchId)`
- `getWorkbenchDefinition(workbenchId)`
- `getAllowedFeatureClasses(viewer)`
- `isFeatureAllowedInWorkbench(featureClass, workbenchId)`
- `isToolbarButtonAllowed(record, workbenchId)`
- `isSidePanelAllowed(record, workbenchId)`
- `isContextFamilyEnabled(family, workbenchId)`

Keeping this logic centralized is important. Do not duplicate workbench filtering logic in multiple widgets.

## Built-In Toolbar Button IDs

Built-in buttons use stable IDs.

Current built-in IDs:

- `new`
- `save`
- `saveAs`
- `zoomToFit`
- `wireframe`
- `solidOverlapDiagnostics`
- `import`
- `export`
- `share`
- `settings`
- `sheetEditor`
- `sheetMetalFlatExport`
- `sheetMetalDebug`
- `about`
- `guidedTour`
- `tests`
- `historyTestSnippet`
- `scriptRunner`
- `selectionState`
- `undo`
- `redo`

These IDs are what workbench definitions and plugins reference.

## Backward Compatibility

- Older files load as `ALL`.
- Existing feature history remains valid.
- Missing plugin features should continue to show as unavailable but remain in history.
- Existing plugin APIs should continue to work unless explicitly upgraded to workbench-aware structured forms.

## Implemented Flow

- New parts start in `MODELING`.
- Old parts with no saved workbench load in `ALL`.
- Switching workbenches changes the `+` menu contents.
- Switching workbenches changes non-PMI selection context creation actions.
- Existing history entries remain visible and editable in every workbench.
- Assembly Constraints panel is visible in `ASSEMBLIES`, `WIRE_HARNESS`, and `ALL`.
- PMI Views panel is visible in authoring workbenches and `ALL`; it is hidden in `SIMULATION`.
- Clicking a PMI view from another workbench switches into `PMI`.
- Finishing or canceling that PMI session returns to the previous workbench.
- Sheet-metal-specific main toolbar actions can be restricted to `SHEET_METAL`.
- Plugins can optionally declare workbench membership for features, toolbar buttons, and side panels.
- Plugins without workbench metadata remain usable and visible in `ALL`.

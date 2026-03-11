# Workbench Implementation Plan

## Goal

Introduce persistent CAD workbenches that reduce UI clutter by limiting what the user sees in:

- the `+` menu under feature history
- the selection context toolbar
- selected side panels
- selected main toolbar buttons

Workbenches do **not** change the underlying model structure and do **not** hide existing history entries. They are UI filters only.

## Core User Experience

At the top of the History panel, add a workbench dropdown.

The dropdown selects the current workbench for the part. That selection is saved with the part.

Supported built-in workbenches should include at least:

- `MODELING`
- `SURFACING`
- `SHEET_METAL`
- `ASSEMBLIES`
- `PMI`
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

Because the active workbench is part-level state, it should be included in save/load and in feature-history undo/redo snapshots if the implementation continues to snapshot the full serialized part state.

## Workbench Scope

Workbench selection controls only UI visibility for these surfaces:

1. `+` menu in History
2. selection context toolbar actions
3. side panels that are workbench-scoped
4. main toolbar buttons that are workbench-scoped

History entries remain visible and editable regardless of active workbench.

## Side Panel Rules

### Assembly Constraints Panel

The Assembly Constraints panel should be visible only when the active workbench is `ASSEMBLIES`.

This is a change from the current behavior where assembly UI is shown based on the presence of assembly components in the model.

### PMI Views Panel

The PMI Views panel should always remain visible.

The PMI panel is not gated by workbench.

Clicking a PMI view should be allowed from any workbench.

## PMI Temporary Override Behavior

PMI has special mode-switch behavior.

If the user is already in `PMI` and enters PMI mode from a PMI view, remain in `PMI`.

If the user is in another workbench and enters PMI mode by clicking a PMI view:

1. store the previously selected workbench in temporary runtime state
2. switch the active workbench to `PMI`
3. enter PMI mode

When PMI editing finishes:

- if PMI was entered from another workbench via view click, return to that previously selected workbench

This return behavior should apply on:

- `Finish`
- `Cancel`

Recommended implementation detail:

- persisted part state: `activeWorkbench`
- transient viewer state: something like `workbenchReturnTarget`

`workbenchReturnTarget` must not be persisted to the part file.

## Workbench Definitions

Workbench definitions should live in separate declarative JavaScript files.

Recommended structure:

- `src/workbenches/modelingWorkbench.js`
- `src/workbenches/surfacingWorkbench.js`
- `src/workbenches/sheetMetalWorkbench.js`
- `src/workbenches/assembliesWorkbench.js`
- `src/workbenches/pmiWorkbench.js`
- `src/workbenches/allWorkbench.js`
- `src/workbenches/index.js`

Each file should export a plain object. Keep them declarative. Avoid putting UI logic in the config files.

Recommended shape:

```js
export const MODELING_WORKBENCH = {
  id: 'MODELING',
  label: 'Modeling',
  featureTypes: [
    'Sketch',
    'Datium',
    'Plane',
    'Extrude',
    'Revolve',
    'Boolean',
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
    'home',
    'new',
    'save',
    'zoomToFit',
    'wireframe',
    'import',
    'export',
    'share',
    'sheetEditor',
    'undo',
    'redo',
  ],
};
```

Notes:

- `featureTypes` should use canonical feature short names.
- Shared features such as `Sketch`, `Datium`, and `Plane` can appear in multiple workbenches.
- `ALL` should behave as an unrestricted pass-through.

## Canonical Identity Rules

Workbench configs should filter by resolved canonical identifiers, not by arbitrary strings from old files.

For built-in features, use `FeatureClass.shortName`.

Do not rely on raw serialized `feature.type` strings alone because aliases and legacy names already exist.

The same principle applies to plugin-defined features and toolbar buttons.

## UI Integration Plan

### 1. History Panel Header

Add a header section above the history list in the History widget containing:

- workbench label
- dropdown select

Changing the dropdown should:

- update the active workbench in part state
- trigger history add-menu refresh
- trigger selection context action refresh
- trigger side panel visibility refresh
- trigger main toolbar visibility refresh
- queue/save a history snapshot if workbench changes are part of undo/redo

### 2. `+` Menu Filtering

The current `+` menu uses all registered feature classes.

Replace that direct iteration with a helper that returns the feature classes allowed for the active workbench.

This helper should:

- resolve built-in features
- include plugin features
- treat `ALL` as unfiltered

### 3. Context Toolbar Filtering

The current selection context toolbar draws from multiple registries:

- feature classes
- assembly constraint classes
- PMI annotation classes

Workbench filtering must be able to control those families independently.

Recommended rule:

- outside PMI mode, use the active workbench to decide whether feature context actions and assembly constraint context actions are visible
- inside PMI mode, PMI annotation actions remain available as needed by PMI mode

### 4. Side Panel Visibility

Add a central viewer method that refreshes workbench-scoped panel visibility.

Do not scatter workbench checks throughout individual panel widgets.

Recommended viewer-level refresh targets:

- assembly constraints section visibility
- any future harness or discipline-specific sections

PMI Views remains always visible.

### 5. Main Toolbar Filtering

Some main-toolbar buttons should be scoped by workbench.

Example:

- sheet metal flat pattern export belongs to `SHEET_METAL`

The current toolbar registration is append-only at startup. That should be refactored to a registry-based approach so the toolbar can be rebuilt or refreshed when the active workbench changes.

Recommended model:

- every toolbar button gets a stable `id`
- buttons declare default visibility or workbench eligibility
- viewer rebuilds or toggles buttons when workbench changes

Buttons that are global should remain visible in all workbenches.

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

### Recommended Plugin API Extensions

Extend the plugin app surface so plugins can optionally provide workbench metadata.

Recommended patterns:

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

The plugin API can remain backward compatible by still supporting the old positional signatures, but internally everything should normalize to structured records with IDs and workbench metadata.

### Plugin Metadata Storage

Workbench metadata for plugin contributions should be stored in runtime registries, not in the plugin feature class source itself unless convenient.

Recommended registries:

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

Consider also supporting:

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

## Suggested Internal Helpers

Add a central workbench service or helper module that can answer:

- `getActiveWorkbench(partHistory)`
- `setActiveWorkbench(partHistory, workbenchId)`
- `getWorkbenchDefinition(workbenchId)`
- `getAllowedFeatureClasses(viewer)`
- `isFeatureAllowedInWorkbench(featureClass, workbenchId)`
- `isToolbarButtonAllowed(buttonId, workbenchId)`
- `isSidePanelAllowed(panelId, workbenchId)`
- `isContextFamilyEnabled(family, workbenchId)`

Keeping this logic centralized is important. Do not duplicate workbench filtering logic in multiple widgets.

## Built-In Toolbar Button IDs

As part of the refactor, give built-in buttons stable IDs.

Examples:

- `home`
- `new`
- `save`
- `zoomToFit`
- `wireframe`
- `import`
- `export`
- `share`
- `sheetEditor`
- `sheetMetalFlatExport`
- `sheetMetalDebug`
- `about`
- `tests`
- `historyTestSnippet`
- `scriptRunner`
- `selectionState`
- `undo`
- `redo`

These IDs should be what workbench definitions and plugins reference.

## Backward Compatibility

- Older files load as `ALL`.
- Existing feature history remains valid.
- Missing plugin features should continue to show as unavailable but remain in history.
- Existing plugin APIs should continue to work unless explicitly upgraded to workbench-aware structured forms.

## Recommended Implementation Order

1. Add persisted `activeWorkbench` state to part save/load with defaulting rules.
2. Add workbench definition files and central helper/service.
3. Add History dropdown UI.
4. Filter the `+` menu by workbench.
5. Filter selection context actions by workbench.
6. Replace assembly panel auto-visibility with workbench-driven visibility.
7. Refactor main toolbar registration to use stable button IDs and refreshable visibility.
8. Add PMI temporary override and return-to-previous-workbench behavior.
9. Extend plugin APIs and registries for workbench-scoped features, buttons, and side panels.
10. Document plugin usage and examples.

## Acceptance Criteria

- New parts start in `MODELING`.
- Old parts with no saved workbench load in `ALL`.
- Switching workbenches changes the `+` menu contents.
- Switching workbenches changes non-PMI selection context creation actions.
- Existing history entries remain visible and editable in every workbench.
- Assembly Constraints panel is visible only in `ASSEMBLIES`.
- PMI Views panel is always visible.
- Clicking a PMI view from another workbench switches into `PMI`.
- Finishing or canceling that PMI session returns to the previous workbench.
- Sheet-metal-specific main toolbar actions can be restricted to `SHEET_METAL`.
- Plugins can optionally declare workbench membership for features, toolbar buttons, and side panels.
- Plugins without workbench metadata remain usable and visible in `ALL`.


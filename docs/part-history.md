# PartHistory Reference

`PartHistory` lives in `src/PartHistory.js` and is the core modeling history manager. It owns the feature list, the shared Three.js scene, the expression scratchpad, PMI views, metadata, and the assembly constraint history. It can rebuild geometry deterministically by replaying feature entries, serialize and restore part state, and maintain undo/redo via JSON snapshots.

## Responsibilities

- Manage the ordered list of modeling features (`features`).
- Own and mutate the shared Three.js `scene`.
- Evaluate parameter expressions via a user-defined expression script.
- Run the history to (re)build geometry from feature inputs.
- Persist and restore feature history, PMI views, metadata, and assembly constraints.
- Track and apply undo/redo snapshots.
- Sync and update assembly component data.

## Constructor

### `new PartHistory()`

Creates a new history manager and initializes:

- `features`: empty array
- `scene`: `new THREE.Scene()`
- `featureRegistry`: `new FeatureRegistry()`
- `assemblyConstraintRegistry`: `new AssemblyConstraintRegistry()`
- `assemblyConstraintHistory`: `new AssemblyConstraintHistory(this, registry)`
- `pmiViewsManager`: `new PMIViewsManager(this)`
- `metadataManager`: `new MetadataManager()`
- `expressions`: default example script string
- `callbacks`: empty bag for optional hooks
- Undo/redo state in `_historyUndo`

The constructor also soft-overrides `scene.remove` and `scene.add` to aid debugging and to block removal of objects with `userData.preventRemove`.

## Data model

### Feature entry shape

Each entry in `features` is a plain object with at least:

```js
{
  type: string,                 // Feature type string (registry key)
  inputParams: Object,          // User inputs; includes an id
  persistentData: Object,       // Saved outputs from previous runs
  timestamp?: number,           // Last run time (ms epoch)
  dirty?: boolean,              // Marks entry for re-run
  lastRunInputParams?: string,  // JSON string for dirty detection
  lastRun?: {                   // Execution metadata
    ok: boolean,
    startedAt: number,
    endedAt: number,
    durationMs: number,
    error: { name, message, stack } | null
  },
  effects?: { added: [], removed: [] },
  previouseExpressions?: Object // Cached evaluated numeric inputs
}
```

IDs are normalized and kept in sync:

- `feature.inputParams.id` and `feature.id` are strings.
- A non-enumerable `feature.inputParams.featureID` property is defined as an alias of `id` for legacy compatibility.

### Feature class contract

A feature class (from `FeatureRegistry`) is expected to provide:

- `static inputParamsSchema` describing inputs and defaults.
- `run(partHistory)` which returns `{ added, removed }`.
- Optional `longName`, `shortName`, `name` for display.
- (Sketch only) `hasSketchChanged(feature)` for dirty detection.

### Result artifacts

`run()` should return an object with:

- `added`: array of objects to add to the scene
- `removed`: array of objects to remove from the scene

Objects are expected to be compatible with Three.js scene nodes. If they implement `free()` and/or `visualize()`, those are called automatically.

## Expressions

`expressions` is a user-editable script string. Numeric inputs can reference it.

- Static helper: `PartHistory.evaluateExpression(expressionsSource, equation)`
- Instance helper: `partHistory.evaluateExpression(equation)`

`evaluateExpression` uses `Function()` to execute the script and return an evaluated value. It returns `null` on error. Treat expression input as code (do not evaluate untrusted content).

## Execution flow

### `runHistory()`

Rebuilds the scene by replaying `features` in order.

High-level flow:

1. Clear the scene and dispose resources, preserving lights, cameras, and transform gizmos.
2. Iterate features in order:
   - Normalize ID linkage for each feature.
   - Stop after `currentHistoryStepId` (if set) but keep later features in the list.
   - Resolve the feature class from the registry; if missing, mark `lastRun` with a MissingFeature error and continue.
   - Copy `persistentData` into the feature instance.
   - Remove any existing scene children with `owningFeatureID === featureId` (rerun case).
   - Compute `dirty` state based on:
     - changed input params
     - feature timestamps vs. upstream features
     - newer referenced objects
     - expression evaluation changes
     - Sketch change detection
   - If dirty:
     - call `run()`
     - record `lastRun`, `timestamp`, `effects`, `lastRunInputParams`
   - Apply `effects` via `applyFeatureEffects()`.
3. Run assembly constraints.
4. Call optional callbacks.

Notes:

- `currentHistoryStepId` is not cleared inside `runHistory()`.
- Any feature error stops the run and logs the error.
- `runHistory()` returns `this`.

## Scene integration and selection

When adding objects:

- `applyFeatureEffects()` calls `free()` and `visualize()` if present.
- Each added object and its descendants get `timestamp` and `owningFeatureID`.
- Each object gets an `onClick` handler that uses `SelectionFilter.toggleSelection`.

Objects with `userData.preventRemove` are not removed when the scene is cleared.

## Serialization

### `toJSON()`

Returns a pretty-printed JSON string containing:

- `features` (type, inputParams, persistentData, timestamp)
- `idCounter`
- `expressions`
- `pmiViews` (via `PMIViewsManager`)
- `metadata` (from `MetadataManager`)
- `assemblyConstraints` and `assemblyConstraintIdCounter`

Before export, assembly component transforms are synced into feature input params.

### `fromJSON(jsonString, options)`

Restores state from a JSON string. Behavior:

- Migrates legacy `featureID` fields to `id`.
- Rehydrates PMI views and metadata.
- Loads assembly constraints into `AssemblyConstraintHistory`.
- Resets undo/redo history unless `options.skipUndoReset` is `true`.

## Undo / redo

`PartHistory` maintains a JSON snapshot stack:

- `_historyUndo.undoStack` and `_historyUndo.redoStack`
- Debounced snapshot capture (`debounceMs`, default 350ms)
- Max snapshot count (`max`, default 50)

Key methods:

- `queueHistorySnapshot({ debounceMs, force })`
- `flushHistorySnapshot({ force })`
- `undoFeatureHistory()`
- `redoFeatureHistory()`
- `canUndoFeatureHistory()`
- `canRedoFeatureHistory()`

Undo/redo restores by calling `fromJSON()` and re-running `runHistory()`.

## Assembly components and constraints

- `assemblyConstraintHistory` owns constraints and runs the solver.
- `runAssemblyConstraints()` delegates to `AssemblyConstraintHistory.runAll()`.

Assembly component utilities:

- `hasAssemblyComponents()`: returns true if any feature is an assembly component.
- `syncAssemblyComponentTransforms()`: copies scene transforms into feature input params.
- `getOutdatedAssemblyComponentCount()`: counts components whose source data changed.
- `updateAssemblyComponents({ rerun = true })`: refreshes component data and optionally re-runs history.

## Public properties

- `features: Array<Object>`
- `scene: THREE.Scene`
- `idCounter: number`
- `featureRegistry: FeatureRegistry`
- `assemblyConstraintRegistry: AssemblyConstraintRegistry`
- `assemblyConstraintHistory: AssemblyConstraintHistory`
- `pmiViewsManager: PMIViewsManager`
- `metadataManager: MetadataManager`
- `expressions: string`
- `currentHistoryStepId: string | null`
- `callbacks: Object` (optional hooks)
- `_historyUndo: Object` (internal state)

### Callbacks

`callbacks` is a simple bag of optional functions:

- `callbacks.run(featureId)` - called before each feature runs (awaited).
- `callbacks.reset()` - called after `reset()` clears scene (awaited).
- `callbacks.afterRunHistory()` - called after `runHistory()` completes.
- `callbacks.afterReset()` - called after `reset()` finishes.

## API reference

### Static

#### `PartHistory.evaluateExpression(expressionsSource, equation): any | null`

Evaluates `equation` using `expressionsSource` as the preamble. Returns `null` on error.

### Instance

#### `evaluateExpression(equation): any | null`

Same as static helper but uses `this.expressions`.

#### `getObjectByName(name): Object3D | null`

Delegates to `scene.getObjectByName`.

#### `reset(): Promise<void>`

Clears features, resets managers, clears the scene, and resets undo/redo. Calls `callbacks.reset` and `callbacks.afterReset`.

#### `runHistory(): Promise<PartHistory>`

Replays features, rebuilds the scene, runs constraints, and calls `callbacks.afterRunHistory`.

#### `applyFeatureEffects(effects, featureId, feature): Promise<void>`

Applies `added`/`removed` artifacts to the scene, sets timestamps/ownership, and attaches selection handlers.

#### `toJSON(): Promise<string>`

Serializes the full part history and related state.

#### `fromJSON(jsonString, options?): Promise<void>`

Restores from a serialized history string.

#### `generateId(prefix): Promise<string>`

Increments `idCounter` and returns `${prefix}${idCounter}`.

#### `sanitizeInputParams(schema, inputParams): Promise<Object>`

Normalizes and evaluates input params based on schema types:

- `number`: evaluates expressions
- `reference_selection`: resolves object names to scene objects
- `boolean_operation`: normalizes op and target list, optional bias/offset
- `transform`: evaluates position/rotation/scale arrays
- `vec3`: evaluates 3-vector entries
- `boolean`: normalizes to boolean
- default: pass-through

#### `newFeature(featureType): Promise<Object>`

Creates a new feature entry, seeds defaults from schema, assigns an ID, and appends it to `features`.

#### `removeFeature(featureId): Promise<void>`

Removes any feature with matching ID.

#### `resetHistoryUndo(): void`

Clears undo/redo stacks and internal flags.

#### `queueHistorySnapshot(options?): void`

Debounced snapshot capture.

#### `flushHistorySnapshot(options?): Promise<void>`

Forces a snapshot immediately.

#### `undoFeatureHistory(): Promise<boolean>`

Restores the previous snapshot if available.

#### `redoFeatureHistory(): Promise<boolean>`

Reapplies the next snapshot if available.

#### `runAssemblyConstraints(): Promise<Array>`

Runs the assembly constraint solver.

#### `hasAssemblyComponents(): boolean`

Checks if any feature is an assembly component.

#### `syncAssemblyComponentTransforms(): void`

Writes current scene transforms into feature input params.

#### `getOutdatedAssemblyComponentCount(): number`

Returns number of outdated components.

#### `updateAssemblyComponents(options?): Promise<{ updatedCount, reran }>`

Refreshes assembly component data; optionally re-runs history.

### Internal helpers

These methods are intended for internal use:

- `_coerceRunEffects`, `_attachSelectionHandlers`, `_safeRemove`
- `_commitHistorySnapshot`, `_applyHistorySnapshot`
- `_sanitizePersistentDataForExport`, `_collectAssemblyComponentUpdates`
- `#runFeatureEntryMigrations`, `#linkFeatureParams`, `#prepareFeatureEntry`, `#prepareFeatureList`
- `#disposeSceneObjects`, `#disposeObjectResources`, `#disposeMaterialResources`

## Related helper

### `extractDefaultValues(schema)`

Exported alongside `PartHistory`. Returns a deep-cloned object of `default_value` for each schema key.

## Usage examples

### Basic feature run

```js
import { PartHistory } from './PartHistory.js';

const history = new PartHistory();
const feature = await history.newFeature('Sketch');
// set feature.inputParams as needed
await history.runHistory();
```

### Expressions

```js
history.expressions = "x = 10; y = x * 2;";
feature.inputParams.depth = "y + 5";
await history.runHistory();
```

### Save / load

```js
const json = await history.toJSON();

const restored = new PartHistory();
await restored.fromJSON(json);
await restored.runHistory();
```

### Undo / redo

```js
history.queueHistorySnapshot();
await history.undoFeatureHistory();
await history.redoFeatureHistory();
```

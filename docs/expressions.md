# Expressions and Configurator

This page is the dedicated guide for the Expressions panel in Modeling Mode.

## Live Demos
- Examples hub: [https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- Embeded CAD: [https://BREP.io/apiExamples/Embeded_CAD.html](https://BREP.io/apiExamples/Embeded_CAD.html)

## Overview

The Expressions panel has two related parts:

- `expressions`: a shared script where you define variables and formulas
- `configurator`: a set of UI widgets whose values are exposed to expressions as `configurator.fieldName`

Together, they let you drive feature dialogs from reusable parameters instead of hard-coded values.

## Expression syntax

Expressions use JavaScript-style syntax. Typical usage is to assign variables in the script, then reference them in feature fields.

Example script:

```js
wall = 2;
width = 80;
height = width * 1.5;
holeOffset = width * 0.25;
```

Then in a feature dialog field:

```js
height
```

or:

```js
width - wall * 2
```

## Runtime context

When an expression is evaluated, the runtime includes:

- `resolution = 32` by default
- the current configurator values as `configurator`
- the contents of the Expressions script

That means these are valid:

```js
resolution
configurator.panelWidth
configurator.materialName
```

## Configurator

The configurator is for values that should be edited through UI controls instead of typing directly into the script.

Supported widget types:

- `slider`
- `number`
- `select`
- `string`

Example configurator usage:

```js
width = configurator.panelWidth;
height = width * 2;
labelText = configurator.partLabel;
```

Then feature inputs can use:

```js
width
height
labelText
configurator.panelWidth * 0.5
```

## Expressions panel behavior

- If no configurator fields exist, the configurator form is hidden.
- If configurator fields exist, the live configurator form appears above the expression editor.
- Editing a configurator value in that live form re-runs the model.
- Editing the configurator layout with `Edit Configurator` shows a live preview of the widget set above the expression editor.
- While the configurator editor is open, that preview does not re-run the model.
- The model is re-evaluated only when the configurator edit session is committed with `Save Configurator` or by closing the editor.

## Using expressions in feature dialogs

Feature dialogs evaluate against the shared expression source.

Field support:

- `number` fields support expressions by default
- `string` fields can support expressions when the schema enables `allowExpression: true`
- `transform` and `vec3` numeric entries also evaluate expressions

Examples:

```js
distance = configurator.panelWidth * 0.5
```

```js
text = configurator.partLabel
```

## Persistence

Both the script and the configurator are stored in part history.

Saved part history includes:

- `expressions`
- `configurator.fields`
- `configurator.values`

That means they survive:

- save/load
- JSON export/import
- embedded feature history in 3MF
- undo/redo snapshots

## Practical example

Expressions script:

```js
wall = 2;
outerWidth = configurator.panelWidth;
outerHeight = configurator.panelHeight;
innerWidth = outerWidth - wall * 2;
innerHeight = outerHeight - wall * 2;
titleText = configurator.label;
```

Possible configurator fields:

- `panelWidth` as a slider
- `panelHeight` as a slider
- `label` as a string

Then feature inputs can use:

```js
outerWidth
outerHeight
innerWidth
innerHeight
titleText
```

## Developer notes

Relevant API and integration points:

- `partHistory.expressions`
- `partHistory.configurator`
- `partHistory.getExpressionsSource()`
- `partHistory.buildExpressionSource()`
- `partHistory.evaluateExpression()`

If you are authoring a feature dialog schema:

- use `type: 'number'` for expression-capable numeric fields
- use `type: 'string'` with `allowExpression: true` for expression-capable string fields

## Safety note

Expressions are executed as code using `Function()`. Do not evaluate untrusted user input.

## Related docs

- [Modeling Mode](./modes/modeling.md)
- [Input Params Schema](./input-params-schema.md)
- [PartHistory Reference](./part-history.md)

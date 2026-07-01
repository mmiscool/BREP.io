# `Solid.clone()`

Creates a lightweight copy of the solid's authored geometry, face mappings, metadata, and aux edges. It does not copy rendered `THREE` children.

## Usage

```js
const copy = solid.clone();
```

## Signature

```js
solid.clone()
```

## Parameters

None.

## Returns

`Solid` - Lightweight copy of authored geometry, labels, metadata, and aux edges.

Use this when you want another editable `Solid` without mutating the original.

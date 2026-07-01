# `Solid.getFaces()`

Enumerates face groups as `{ faceName, triangles }`, optionally including empty face labels.

## Usage

```js
const faces = solid.getFaces();
```

## Signature

```js
solid.getFaces(includeEmpty = false)
```

## Parameters

- `includeEmpty` (`boolean`, default `false`) - Include known face labels that currently have no triangles.

## Returns

`Array<{ faceName: string, triangles: object[] }>` - Face groups and their triangle records.

This is the programmatic face roster for the authored or booleaned solid.

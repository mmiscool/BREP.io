# `Solid.getFace()`

Returns the triangle records that currently belong to one face label.

## Usage

```js
const triangles = solid.getFace('TOP');
```

## Signature

```js
solid.getFace(name)
```

## Parameters

- `name` (`string`) - Face label to query.

## Returns

`Array<{ faceName: string, indices: number[], p1: number[], p2: number[], p3: number[] }>` - Triangle records for the face.

Use this when you need authored triangle positions for one face name.

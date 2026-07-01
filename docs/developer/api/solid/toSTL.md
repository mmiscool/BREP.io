# `Solid.toSTL()`

Serializes the current solid to an ASCII STL string.

## Signature

```js
solid.toSTL(name = 'solid', precision = 6)
```

## Usage

```js
const stl = solid.toSTL('part', 6);
```

## Parameters

- `name` (`string`, default `'solid'`) - Name written into the `solid <name>` and `endsolid <name>` lines. This is metadata in the STL text; it does not rename the `Solid` instance.
- `precision` (`number`, default `6`) - Number of fixed decimal places used for normals and vertex coordinates. Higher values preserve more numeric detail and produce larger strings.

## Returns

`string` - ASCII STL content for the current manifold mesh.

## Behavior

- Calls `solid.getMesh()` and exports the triangulated mesh.
- Computes one facet normal per triangle from the exported vertices.
- Uses the solid's current authored/manifold geometry. Object/world transforms are not applied by this method; bake transforms first if the STL needs transformed coordinates.
- Releases the temporary mesh snapshot after serialization.

Use this in browser or Node environments when you want the STL content directly.

# `Solid.minGapToPoint(point, searchLength)`

Returns mesh-surface proximity records between a solid and a point.

Each returned object represents one triangle within `searchLength` of the
point. Results are sorted nearest first. `inside` describes whether the point is
inside or on the solid; `distance` is the exact point-to-triangle distance; and
`directionVector` is a normalized vector from the input point toward the nearest
point on that triangle.

## Usage

```js
const records = solid.minGapToPoint([10, 0, 0], 5);
// [
//   {
//     inside: false,
//     distance: 3.2,
//     directionVector: { x: -1, y: 0, z: 0 },
//   },
// ]
```

## Signature

```js
solid.minGapToPoint(point, searchLength = Infinity, options = {})
```

## Parameters

- `point` (`[number, number, number] | { x, y, z }`) - Query point.
- `searchLength` (`number`, default `Infinity`) - Non-negative proximity radius. Triangles farther than this are ignored.
- `options` (`object`, optional) - Query behavior.

## Options

- `nearestOnly` (`boolean`, default `false`) - Return only the nearest triangle record within `searchLength`.

## Returns

`Array<{ inside: boolean, distance: number, directionVector: { x: number, y: number, z: number } }>` - Sorted nearest first unless `nearestOnly` is enabled.

`point` may be `[x, y, z]` or `{ x, y, z }`.

Use `searchLength` as the proximity radius. If no triangles are within that
radius, the method returns `[]`.

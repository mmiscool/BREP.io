# `Edge.length()`

Measures the total edge polyline length in world space.

## Usage

```js
const len = edge.length();
```

## Signature

```js
edge.length()
```

## Parameters

None.

## Returns

`number` - Total polyline length in world-space units.

This prefers the stored polyline payload from `visualize()` and falls back to geometry positions when needed.

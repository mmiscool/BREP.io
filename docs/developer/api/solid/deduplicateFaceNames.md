# `Solid.deduplicateFaceNames()`

Deduplicates the internal face-name tracking maps while preserving the first numeric face ID for each name.

## Usage

```js
solid.deduplicateFaceNames();
```

## Signature

```js
solid.deduplicateFaceNames()
```

## Parameters

None.

## Returns

`Solid` - The same solid, for chaining.

## Notes

This is a repair/normalization helper for generated or imported solids whose face ID maps may contain duplicate names.

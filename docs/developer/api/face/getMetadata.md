# `Face.getMetadata()`

Reads metadata for this face from the owning solid.

## Usage

```js
const metadata = face.getMetadata();
```

## Signature

```js
face.getMetadata()
```

## Parameters

None.

## Returns

`object | null` - Metadata returned by `parentSolid.getFaceMetadata(face.name)`, or `null` when no parent solid is available.

Returns `null` when the face is not attached to a parent solid.

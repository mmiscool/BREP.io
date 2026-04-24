# `Solid._key()`

Internal helper that converts a point into the exact string key used for vertex deduplication in authored buffers.

## Usage

```js
const key = solid._key([0, 0, 0]);
```

This is mainly useful when debugging authoring or vertex welding behavior.

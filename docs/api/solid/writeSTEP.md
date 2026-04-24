# `Solid.writeSTEP()`

Node-only helper that writes the current solid to a STEP file on disk.

## Usage

```js
await solid.writeSTEP('out/part.step', 'part', { unit: 'millimeter' });
```

This is the file-writing companion to `toSTEP()`.

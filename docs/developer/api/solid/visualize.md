# `Solid.visualize()`

Rebuilds rendered `Face`, `Edge`, and helper children for the solid.

## Usage

```js
solid.visualize({
  showEdges: true,
  forceAuthoring: false,
  authoringOnly: false,
  forceRebuild: false
});
```

## Signature

```js
solid.visualize(options = {})
```

## Options

- `materialForFace` (`(name: string) => THREE.Material`, optional) - Material factory for generated face meshes.
- `wireframe` (`boolean`, default `false`) - Render generated face materials as wireframe.
- `name` (`string`, default `'Solid'`) - Group name used by some visualization paths.
- `showEdges` (`boolean`, default `true`) - Generate rendered boundary `Edge` children between face labels.
- `forceAuthoring` (`boolean`, default `false`) - Force authoring-buffer grouping instead of the manifold mesh path.
- `authoringOnly` (`boolean`, default `false`) - Skip the manifold path entirely and always visualize authored triangles.
- `forceRebuild` (`boolean`, default `false`) - Ignore cached visualization children and rebuild.

## Returns

`Solid` - The same solid, with rendered `Face`, `Edge`, and aux-edge children rebuilt or reused.

Call this before interacting with rendered `Face` and `Edge` instances.

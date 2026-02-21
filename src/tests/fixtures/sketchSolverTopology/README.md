# Sketch Solver Topology Fixtures

Drop `.json` files in this folder to add sketch-solver topology regression tests automatically.

Each file becomes its own test in `pnpm test` via `registerSketchSolverTopologyFixtureTests(...)`.

## Fixture schema

```json
{
  "name": "rect_width_height_fixture",
  "sketch": { "points": [], "geometries": [], "constraints": [] },
  "sourcePartFile": "src/tests/partFiles/your_case.BREP.json",
  "sourceFeatureId": "S1",
  "initialSolvePasses": 4,
  "edits": [
    { "constraintId": 5, "value": 110 },
    { "expressionValues": { "x": 1200, "y": 2500, "z": 300 } }
  ],
  "expect": {
    "topologyUnchanged": true,
    "distances": [
      { "a": 0, "b": 1, "value": 110, "tol": 0.06 }
    ],
    "anchors": [
      { "pointId": 0, "x": 0, "y": 0, "tol": 0.01 }
    ],
    "coincidentPairs": [
      { "a": 1, "b": 2, "tol": 0.01 }
    ],
    "orientationLoops": [
      { "pointIds": [0, 1, 2, 3], "preserveSign": true, "minAbsArea": 1.0 }
    ]
  }
}
```

## Notes

- Provide either `sketch` directly, or `sourcePartFile` (optional `sourceFeatureId`) to pull a sketch from an existing part file.
- `edits` are applied in order; solver runs after each edit.
- `constraintId/value` edits set one dimension directly.
- `expressionValues` edits evaluate every `constraint.valueExpr` using provided variables (useful for `x/y/z` expression-driven sketches).
- If `expect.topologyUnchanged` is omitted, it defaults to `true`.
- `tol` defaults to `0.01` when omitted.
- A fixture fails fast with a clear message if IDs are invalid or references break.

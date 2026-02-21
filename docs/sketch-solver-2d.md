# 2D Sketch Solver (Standalone)

This page documents the standalone 2D sketch solver that powers Sketch mode. The solver is exposed as
an npm subpath so you can use it headlessly in Node or inside your own tooling.

## Live Demos
- Examples hub: [https://BREP.io/apiExamples/index.html](https://BREP.io/apiExamples/index.html)
- Embeded 2D Sketcher: [https://BREP.io/apiExamples/Embeded_2D_Sketcher.html](https://BREP.io/apiExamples/Embeded_2D_Sketcher.html)

## Import
```js
import { ConstraintSolver, ConstraintEngine, constraints } from 'brep-io-kernel/SketchSolver2D';
```

## Overview of the solver code
- `ConstraintSolver` is the stateful wrapper. It owns `sketchObject`, provides editing helpers
  (create/remove geometry and constraints), and calls the engine to solve.
- `ConstraintEngine` is the stateless numeric solver. It solves a JSON snapshot and returns a new
  solved sketch object.
- `constraintDefinitions.js` implements each constraint type and exposes a global `tolerance` that
  controls how strictly constraints are considered satisfied.

The engine iterates through constraints in a fixed order, repeatedly nudging points until positions
stabilize or the iteration limit is reached. Some geometries inject temporary constraints (for example,
arc equal-chord and bezier handle colinearity) that are removed from the final output.

## Sketch data model
- `points`: `{ id:number, x:number, y:number, fixed:boolean }`
- `geometries`: `{ id:number, type:"line"|"circle"|"arc"|"bezier", points:number[], construction?:boolean }`
- `constraints`: `{ id:number, type:string, points:number[], value?:number|null, labelX?:number, labelY?:number, displayStyle?:string }`

If you pass an empty sketch, the solver will seed an origin point and a fixed (ground) constraint.

## Constraint symbols and meanings
Constraint types are single-character symbol strings. Use the Unicode symbols below in code, or
inspect `src/features/sketch/sketchSolver2D/constraintDefinitions.js` for the canonical list.

```js
const CONSTRAINTS = {
  HORIZONTAL: "━",      // 2 points
  VERTICAL: "│",        // 2 points
  DISTANCE: "⟺",        // 2 points, value
  EQUAL_DISTANCE: "⇌",  // 4 points
  PARALLEL: "∥",        // 4 points
  PERPENDICULAR: "⟂",   // 4 points
  ANGLE: "∠",           // 4 points, value in degrees
  COINCIDENT: "≡",      // 2 points
  POINT_ON_LINE: "⏛",   // 3 points (line AB, point C)
  MIDPOINT: "⋯",        // 3 points (A, B, midpoint)
  FIXED: "⏚",           // 1 point
};
```

## ConstraintSolver API
`ConstraintSolver` is the main class you use in headless workflows.

Constructor:
```js
const solver = new ConstraintSolver({
  sketch,                // { points, geometries, constraints }
  notifyUser,            // optional: (message, type) => void
  updateCanvas,          // optional: () => void
  getSelectionItems,     // optional: () => Array<{ type:"point"|"geometry", id:number }>
  appState,              // optional: { mode, type, requiredSelections }
});
```

Common methods:
```js
solver.solveSketch("full"); // or solver.solveSketch(iterations)
solver.pause("reason");
solver.resume();
solver.isPaused();
solver.getPointById(id);
solver.createGeometry("line", [pointA, pointB]);
solver.createConstraint(CONSTRAINTS.DISTANCE, [
  { type: "point", id: pointA.id },
  { type: "point", id: pointB.id },
]);
solver.removePointById(id);
solver.removeGeometryById(id);
solver.removeConstraintById(id);
```

Notes:
- `solveSketch` mutates `solver.sketchObject` and also returns the solved sketch.
- `createGeometry` and `createConstraint` can use `getSelectionItems` if you omit points.
- `createConstraint` expects selection items with `{ type:"point"|"geometry", id:number }`; it mirrors
  the UI behavior for allowed selections.

## ConstraintEngine API (stateless)
Use `ConstraintEngine` if you want a one-shot solve without any editing helpers.

```js
const engine = new ConstraintEngine(JSON.stringify(sketch));
const solved = engine.solve(500);
```

## Usage examples

### Basic solve
```js
const solver = new ConstraintSolver({
  sketch: {
    points: [
      { id: 0, x: 0, y: 0, fixed: true },
      { id: 1, x: 10, y: 5, fixed: false },
    ],
    geometries: [
      { id: 0, type: "line", points: [0, 1], construction: false },
    ],
    constraints: [
      { id: 0, type: CONSTRAINTS.FIXED, points: [0] },
      { id: 1, type: CONSTRAINTS.HORIZONTAL, points: [0, 1] },
      { id: 2, type: CONSTRAINTS.DISTANCE, points: [0, 1], value: 20 },
    ],
  },
});

const solved = solver.solveSketch("full");
console.log(solved.points);
```

### Add a constraint after edits (manual)
```js
const p0 = solver.getPointById(0);
const p1 = solver.getPointById(1);
const p2 = { id: 2, x: 10, y: 0, fixed: false };
const p3 = { id: 3, x: 10, y: 10, fixed: false };

solver.sketchObject.points.push(p2, p3);
solver.sketchObject.geometries.push({ id: 1, type: "line", points: [p2.id, p3.id] });
solver.sketchObject.constraints.push({
  id: 3,
  type: CONSTRAINTS.PERPENDICULAR,
  points: [p0.id, p1.id, p2.id, p3.id],
});

solver.solveSketch(500);
```

### Stateless solve for a snapshot
```js
const snapshot = JSON.parse(JSON.stringify(solver.sketchObject));
const engine = new ConstraintEngine(JSON.stringify(snapshot));
const solved = engine.solve(250);
```

## Tuning and control
```js
constraints.tolerance = 1e-5;
constraints.distanceSlideThresholdRatio = 0.10; // only slide distance target updates above 10%
constraints.distanceSlideStepRatio = 0.10;      // when sliding, move 10% of remaining gap per solve pass
constraints.distanceSlideMinStep = 0.001;       // absolute minimum step while sliding
solver.defaultLoops = () => 1500;
solver.fullSolve = () => 2000;
```

## Notes and caveats
- The solver is iterative. Increase iterations for tighter convergence.
- Constraint errors are stored on the constraint objects as `error` strings; the solver does not throw.
- IDs should be numeric and stable. Constraints reference point IDs by value.
- Some constraint/geometry combinations may not converge; use smaller moves or add grounding constraints.

import { ConstraintSolver } from "../SketchSolver2D.js";

const EPS = 1e-2;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertNear(actual, expected, tol, message) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tol) {
        throw new Error(`${message}. Expected ${expected}, got ${actual}`);
    }
}

function getPoint(sketch, id) {
    const p = sketch.points.find((pt) => Number(pt.id) === Number(id));
    if (!p) throw new Error(`Point ${id} not found`);
    return p;
}

function getConstraint(sketch, id) {
    const c = sketch.constraints.find((cc) => Number(cc.id) === Number(id));
    if (!c) throw new Error(`Constraint ${id} not found`);
    return c;
}

function dist(sketch, a, b) {
    const p0 = getPoint(sketch, a);
    const p1 = getPoint(sketch, b);
    return Math.hypot(p1.x - p0.x, p1.y - p0.y);
}

function signedArea(sketch, pointIds) {
    const pts = pointIds.map((id) => getPoint(sketch, id));
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area2 += (a.x * b.y) - (b.x * a.y);
    }
    return area2 * 0.5;
}

function topologySnapshot(sketch) {
    const pointIds = sketch.points.map((p) => Number(p.id)).sort((a, b) => a - b);
    const geometries = (sketch.geometries || [])
        .map((g) => ({
            id: Number(g.id),
            type: String(g.type),
            construction: !!g.construction,
            points: (g.points || []).map((id) => Number(id)),
        }))
        .sort((a, b) => a.id - b.id);
    const constraints = (sketch.constraints || [])
        .map((c) => ({
            id: Number(c.id),
            type: String(c.type),
            points: (c.points || []).map((id) => Number(id)),
        }))
        .sort((a, b) => a.id - b.id);
    return { pointIds, geometries, constraints };
}

function assertTopologyIntegrity(sketch, contextLabel) {
    const pointIds = new Set((sketch.points || []).map((p) => Number(p.id)));
    for (const g of (sketch.geometries || [])) {
        for (const pid of (g.points || [])) {
            assert(pointIds.has(Number(pid)), `${contextLabel}: geometry ${g.id} references missing point ${pid}`);
        }
    }
    for (const c of (sketch.constraints || [])) {
        for (const pid of (c.points || [])) {
            assert(pointIds.has(Number(pid)), `${contextLabel}: constraint ${c.id} references missing point ${pid}`);
        }
    }
}

function assertTopologyUnchanged(before, after, contextLabel) {
    assertTopologyIntegrity(after, contextLabel);
    const beforeSig = JSON.stringify(topologySnapshot(before));
    const afterSig = JSON.stringify(topologySnapshot(after));
    assert(beforeSig === afterSig, `${contextLabel}: topology changed`);
}

function solveSketch(sketch) {
    const solver = new ConstraintSolver({
        sketch: JSON.parse(JSON.stringify(sketch)),
    });
    solver.solveSketch("full");
    return solver;
}

export async function test_sketch_solver_topology_rect_shared_points() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 40, y: 0, fixed: false },
            { id: 2, x: 40, y: 20, fixed: false },
            { id: 3, x: 0, y: 20, fixed: false },
        ],
        geometries: [
            { id: 100, type: "line", points: [0, 1], construction: false },
            { id: 101, type: "line", points: [1, 2], construction: false },
            { id: 102, type: "line", points: [2, 3], construction: false },
            { id: 103, type: "line", points: [3, 0], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 1, type: "━", points: [0, 1] },
            { id: 2, type: "━", points: [2, 3] },
            { id: 3, type: "│", points: [1, 2] },
            { id: 4, type: "│", points: [3, 0] },
            { id: 5, type: "⟺", points: [0, 1], value: 40 },
            { id: 6, type: "⟺", points: [1, 2], value: 20 },
        ],
    };

    const solver = solveSketch(sketch);
    const before = JSON.parse(JSON.stringify(solver.sketchObject));
    const beforeArea = signedArea(before, [0, 1, 2, 3]);

    getConstraint(solver.sketchObject, 5).value = 130;
    solver.solveSketch("full");
    const after = solver.sketchObject;

    assertTopologyUnchanged(before, after, "shared-point rectangle width edit");
    assertNear(dist(after, 0, 1), 130, 5e-2, "shared-point rectangle width changed unexpectedly");
    assertNear(dist(after, 1, 2), 20, 5e-2, "shared-point rectangle height drifted");
    const p0 = getPoint(after, 0);
    assertNear(p0.x, 0, EPS, "shared-point rectangle anchor x moved");
    assertNear(p0.y, 0, EPS, "shared-point rectangle anchor y moved");

    const afterArea = signedArea(after, [0, 1, 2, 3]);
    assert(Math.abs(afterArea) > 1, "shared-point rectangle collapsed");
    assert(Math.sign(afterArea) === Math.sign(beforeArea), "shared-point rectangle flipped orientation");
}

export async function test_sketch_solver_topology_coincident_chain() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 40, y: 0, fixed: false },
            { id: 2, x: 40, y: 0, fixed: false },
            { id: 3, x: 40, y: 30, fixed: false },
            { id: 4, x: 40, y: 30, fixed: false },
            { id: 5, x: 80, y: 30, fixed: false },
        ],
        geometries: [
            { id: 200, type: "line", points: [0, 1], construction: false },
            { id: 201, type: "line", points: [2, 3], construction: false },
            { id: 202, type: "line", points: [4, 5], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 10, type: "≡", points: [1, 2] },
            { id: 11, type: "≡", points: [3, 4] },
            { id: 12, type: "━", points: [0, 1] },
            { id: 13, type: "│", points: [2, 3] },
            { id: 14, type: "━", points: [4, 5] },
            { id: 15, type: "⟺", points: [0, 1], value: 40 },
            { id: 16, type: "⟺", points: [2, 3], value: 30 },
            { id: 17, type: "⟺", points: [4, 5], value: 40 },
        ],
    };

    const solver = solveSketch(sketch);
    const before = JSON.parse(JSON.stringify(solver.sketchObject));
    getConstraint(solver.sketchObject, 16).value = 90;
    solver.solveSketch("full");
    const after = solver.sketchObject;

    assertTopologyUnchanged(before, after, "coincident-chain vertical edit");
    assertNear(dist(after, 2, 3), 90, 5e-2, "coincident-chain edited segment length incorrect");
    assertNear(dist(after, 0, 1), 40, 5e-2, "coincident-chain left segment length drifted");
    assertNear(dist(after, 4, 5), 40, 5e-2, "coincident-chain right segment length drifted");
    assert(dist(after, 1, 2) < EPS, "coincident-chain joint 1 broke");
    assert(dist(after, 3, 4) < EPS, "coincident-chain joint 2 broke");
}

export async function test_sketch_solver_topology_coincident_loop_no_flip() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 40, y: 0, fixed: false },
            { id: 2, x: 40, y: 0, fixed: false },
            { id: 3, x: 40, y: 20, fixed: false },
            { id: 4, x: 40, y: 20, fixed: false },
            { id: 5, x: 0, y: 20, fixed: false },
            { id: 6, x: 0, y: 20, fixed: false },
            { id: 7, x: 0, y: 0, fixed: false },
        ],
        geometries: [
            { id: 300, type: "line", points: [0, 1], construction: false },
            { id: 301, type: "line", points: [2, 3], construction: false },
            { id: 302, type: "line", points: [4, 5], construction: false },
            { id: 303, type: "line", points: [6, 7], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 20, type: "≡", points: [1, 2] },
            { id: 21, type: "≡", points: [3, 4] },
            { id: 22, type: "≡", points: [5, 6] },
            { id: 23, type: "≡", points: [7, 0] },
            { id: 24, type: "━", points: [0, 1] },
            { id: 25, type: "│", points: [2, 3] },
            { id: 26, type: "━", points: [4, 5] },
            { id: 27, type: "│", points: [6, 7] },
            { id: 28, type: "⟺", points: [0, 1], value: 40 },
            { id: 29, type: "⟺", points: [2, 3], value: 20 },
        ],
    };

    const solver = solveSketch(sketch);
    const before = JSON.parse(JSON.stringify(solver.sketchObject));
    const beforeArea = signedArea(before, [0, 1, 3, 5]);

    getConstraint(solver.sketchObject, 28).value = 120;
    getConstraint(solver.sketchObject, 29).value = 55;
    solver.solveSketch("full");
    const after = solver.sketchObject;

    assertTopologyUnchanged(before, after, "coincident-loop dual edit");
    assertNear(dist(after, 0, 1), 120, 6e-2, "coincident-loop width incorrect after edit");
    assertNear(dist(after, 2, 3), 55, 6e-2, "coincident-loop height incorrect after edit");

    assert(dist(after, 1, 2) < EPS, "coincident-loop corner 1 broke");
    assert(dist(after, 3, 4) < EPS, "coincident-loop corner 2 broke");
    assert(dist(after, 5, 6) < EPS, "coincident-loop corner 3 broke");
    assert(dist(after, 7, 0) < EPS, "coincident-loop corner 4 broke");

    const afterArea = signedArea(after, [0, 1, 3, 5]);
    assert(Math.abs(afterArea) > 1, "coincident-loop collapsed");
    assert(Math.sign(afterArea) === Math.sign(beforeArea), "coincident-loop flipped orientation");
}

export async function test_sketch_solver_topology_rect_round_trip_sequence() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 40, y: 0, fixed: false },
            { id: 2, x: 40, y: 20, fixed: false },
            { id: 3, x: 0, y: 20, fixed: false },
        ],
        geometries: [
            { id: 100, type: "line", points: [0, 1], construction: false },
            { id: 101, type: "line", points: [1, 2], construction: false },
            { id: 102, type: "line", points: [2, 3], construction: false },
            { id: 103, type: "line", points: [3, 0], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 1, type: "━", points: [0, 1] },
            { id: 2, type: "━", points: [2, 3] },
            { id: 3, type: "│", points: [1, 2] },
            { id: 4, type: "│", points: [3, 0] },
            { id: 5, type: "⟺", points: [0, 1], value: 40 },
            { id: 6, type: "⟺", points: [1, 2], value: 20 },
        ],
    };

    const solver = solveSketch(sketch);
    const before = JSON.parse(JSON.stringify(solver.sketchObject));
    const beforeArea = signedArea(before, [0, 1, 2, 3]);

    const widthTargets = [130, 25, 80, 60];
    for (const targetWidth of widthTargets) {
        getConstraint(solver.sketchObject, 5).value = targetWidth;
        solver.solveSketch("full");
        const after = solver.sketchObject;
        assertTopologyUnchanged(before, after, "shared-point rectangle round-trip edits");
        assertNear(dist(after, 0, 1), targetWidth, 7e-2, "shared-point rectangle round-trip width mismatch");
        assertNear(dist(after, 1, 2), 20, 7e-2, "shared-point rectangle round-trip height drift");
        const p0 = getPoint(after, 0);
        assertNear(p0.x, 0, EPS, "shared-point rectangle round-trip anchor x moved");
        assertNear(p0.y, 0, EPS, "shared-point rectangle round-trip anchor y moved");
        const area = signedArea(after, [0, 1, 2, 3]);
        assert(Math.abs(area) > 1, "shared-point rectangle round-trip collapsed");
        assert(Math.sign(area) === Math.sign(beforeArea), "shared-point rectangle round-trip flipped orientation");
    }
}

export async function test_sketch_solver_topology_coincident_chain_multi_step() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 40, y: 0, fixed: false },
            { id: 2, x: 40, y: 0, fixed: false },
            { id: 3, x: 40, y: 30, fixed: false },
            { id: 4, x: 40, y: 30, fixed: false },
            { id: 5, x: 80, y: 30, fixed: false },
        ],
        geometries: [
            { id: 200, type: "line", points: [0, 1], construction: false },
            { id: 201, type: "line", points: [2, 3], construction: false },
            { id: 202, type: "line", points: [4, 5], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 10, type: "≡", points: [1, 2] },
            { id: 11, type: "≡", points: [3, 4] },
            { id: 12, type: "━", points: [0, 1] },
            { id: 13, type: "│", points: [2, 3] },
            { id: 14, type: "━", points: [4, 5] },
            { id: 15, type: "⟺", points: [0, 1], value: 40 },
            { id: 16, type: "⟺", points: [2, 3], value: 30 },
            { id: 17, type: "⟺", points: [4, 5], value: 40 },
        ],
    };

    const solver = solveSketch(sketch);
    const before = JSON.parse(JSON.stringify(solver.sketchObject));

    const targets = [90, 15, 60, 45];
    for (const target of targets) {
        getConstraint(solver.sketchObject, 16).value = target;
        solver.solveSketch("full");
        const after = solver.sketchObject;
        assertTopologyUnchanged(before, after, "coincident-chain multi-step edits");
        assertNear(dist(after, 2, 3), target, 8e-2, "coincident-chain multi-step edited segment mismatch");
        assertNear(dist(after, 0, 1), 40, 8e-2, "coincident-chain multi-step left segment drift");
        assertNear(dist(after, 4, 5), 40, 8e-2, "coincident-chain multi-step right segment drift");
        assert(dist(after, 1, 2) < EPS, "coincident-chain multi-step joint 1 broke");
        assert(dist(after, 3, 4) < EPS, "coincident-chain multi-step joint 2 broke");
    }
}

export async function test_sketch_solver_distance_slide_large_drop_settles_single_solve() {
    const sketch = {
        points: [
            { id: 0, x: 0, y: 0, fixed: true },
            { id: 1, x: 1000, y: 0, fixed: false },
        ],
        geometries: [
            { id: 400, type: "line", points: [0, 1], construction: false },
        ],
        constraints: [
            { id: 0, type: "⏚", points: [0] },
            { id: 30, type: "⟺", points: [0, 1], value: 1000 },
        ],
    };

    const solver = solveSketch(sketch);
    const c = getConstraint(solver.sketchObject, 30);
    c.value = 1;
    solver.solveSketch("full");
    const after = solver.sketchObject;
    assertNear(dist(after, 0, 1), 1, 1e-2, "distance slide large-drop did not settle in one solve");
}

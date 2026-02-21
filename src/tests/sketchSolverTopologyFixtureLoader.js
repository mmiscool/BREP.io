import { ConstraintSolver } from "../SketchSolver2D.js";
import { posix as path } from '../path.proxy.js';
import { fs } from '../fs.proxy.js';

const DEFAULT_TOL = 1e-2;
const FIXTURE_DIR = 'src/tests/fixtures/sketchSolverTopology';

function assert(condition, message) {
    if (!condition) throw new Error(message);
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
    const pointIds = (sketch.points || []).map((p) => Number(p.id)).sort((a, b) => a - b);
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

function sanitizeName(value, fallback = 'fixture') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const cleaned = raw
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
    return cleaned || fallback;
}

function assertNear(actual, expected, tol, message) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tol) {
        throw new Error(`${message}. Expected ${expected}, got ${actual}`);
    }
}

function evaluateExpressionWithVars(expression, vars = {}) {
    if (typeof expression !== 'string' || !expression.trim()) return null;
    const keys = Object.keys(vars || {});
    const vals = keys.map((k) => Number(vars[k]));
    if (!vals.every((v) => Number.isFinite(v))) return null;
    try {
        const fn = Function(...keys, `"use strict"; return (${expression});`);
        const out = fn(...vals);
        const num = Number(out);
        return Number.isFinite(num) ? num : null;
    } catch {
        return null;
    }
}

function solveWithSettle(solver, {
    maxPasses = 8,
    stopWhenConstraintsClear = true,
} = {}) {
    const passes = Math.max(1, Number(maxPasses) || 1);
    let prevSig = null;
    for (let pass = 0; pass < passes; pass++) {
        solver.solveSketch("full");
        const s = solver.sketchObject;
        const pointSig = JSON.stringify(s?.points || []);
        const hasConstraintErrors = Array.isArray(s?.constraints)
            ? s.constraints.some((c) => typeof c?.error === 'string' && c.error.length > 0)
            : false;
        if (stopWhenConstraintsClear && !hasConstraintErrors) break;
        if (pointSig === prevSig) break;
        prevSig = pointSig;
    }
}

function applyExpressionValuesToConstraints(solver, exprValues, contextLabel) {
    const vars = (exprValues && typeof exprValues === 'object') ? exprValues : null;
    if (!vars) throw new Error(`${contextLabel}: expressionValues edit requires an object`);
    for (const c of (solver.sketchObject?.constraints || [])) {
        if (typeof c?.valueExpr !== 'string' || !c.valueExpr.length) continue;
        const n = evaluateExpressionWithVars(c.valueExpr, vars);
        if (!Number.isFinite(n)) continue;
        const diameterExpr = c?.type === '⟺' &&
            c?.displayStyle === 'diameter' &&
            c?.valueExprMode === 'diameter';
        c.value = diameterExpr ? Number(n) * 0.5 : Number(n);
    }
}

function applyEdits(solver, edits, contextLabel) {
    for (const edit of edits || []) {
        if (!edit || typeof edit !== 'object') continue;
        if (Object.prototype.hasOwnProperty.call(edit, 'expressionValues')) {
            applyExpressionValuesToConstraints(solver, edit.expressionValues, contextLabel);
        } else {
            const constraintId = Number(edit.constraintId);
            const value = Number(edit.value);
            if (!Number.isFinite(constraintId)) {
                throw new Error(`${contextLabel}: edit has invalid constraintId`);
            }
            if (!Number.isFinite(value)) {
                throw new Error(`${contextLabel}: edit for constraint ${constraintId} has invalid value`);
            }
            const c = getConstraint(solver.sketchObject, constraintId);
            c.value = value;
        }
        solveWithSettle(solver, {
            maxPasses: Number.isFinite(Number(edit.maxPasses)) ? Number(edit.maxPasses) : 8,
            stopWhenConstraintsClear: edit.stopWhenConstraintsClear !== false,
        });
    }
}

function runExpectations({ before, after, expect, contextLabel }) {
    assertTopologyIntegrity(after, contextLabel);
    const topologyUnchanged = expect?.topologyUnchanged !== false;
    if (topologyUnchanged) {
        const beforeSig = JSON.stringify(topologySnapshot(before));
        const afterSig = JSON.stringify(topologySnapshot(after));
        assert(beforeSig === afterSig, `${contextLabel}: topology changed`);
    }

    for (const d of (expect?.distances || [])) {
        const a = Number(d.a);
        const b = Number(d.b);
        const value = Number(d.value);
        const tol = Number.isFinite(Number(d.tol)) ? Number(d.tol) : DEFAULT_TOL;
        assert(Number.isFinite(a) && Number.isFinite(b), `${contextLabel}: invalid distance pair`);
        assertNear(dist(after, a, b), value, tol, `${contextLabel}: distance [${a},${b}] mismatch`);
    }

    for (const a of (expect?.anchors || [])) {
        const pointId = Number(a.pointId);
        const tol = Number.isFinite(Number(a.tol)) ? Number(a.tol) : DEFAULT_TOL;
        const p = getPoint(after, pointId);
        if (Number.isFinite(Number(a.x))) assertNear(p.x, Number(a.x), tol, `${contextLabel}: anchor ${pointId} x drift`);
        if (Number.isFinite(Number(a.y))) assertNear(p.y, Number(a.y), tol, `${contextLabel}: anchor ${pointId} y drift`);
    }

    for (const c of (expect?.coincidentPairs || [])) {
        const a = Number(c.a);
        const b = Number(c.b);
        const tol = Number.isFinite(Number(c.tol)) ? Number(c.tol) : DEFAULT_TOL;
        assert(Number.isFinite(a) && Number.isFinite(b), `${contextLabel}: invalid coincident pair`);
        assert(dist(after, a, b) <= tol, `${contextLabel}: coincident pair [${a},${b}] broke`);
    }

    for (const loop of (expect?.orientationLoops || [])) {
        const pointIds = Array.isArray(loop?.pointIds) ? loop.pointIds.map((id) => Number(id)) : [];
        assert(pointIds.length >= 3, `${contextLabel}: orientation loop needs at least 3 points`);
        const minAbsArea = Number.isFinite(Number(loop.minAbsArea)) ? Number(loop.minAbsArea) : 1;
        const beforeArea = signedArea(before, pointIds);
        const afterArea = signedArea(after, pointIds);
        assert(Math.abs(afterArea) > minAbsArea, `${contextLabel}: loop collapsed`);
        if (loop.preserveSign !== false) {
            assert(Math.sign(afterArea) === Math.sign(beforeArea), `${contextLabel}: loop orientation flipped`);
        }
    }
}

async function runFixture(fixture, fixturePath) {
    const label = fixture?.name || path.basename(fixturePath);
    const contextLabel = `sketch fixture ${label}`;
    assert(fixture && typeof fixture === 'object', `${contextLabel}: fixture is not an object`);
    assert(Array.isArray(fixture.edits), `${contextLabel}: missing edits array`);
    let sourceSketch = null;
    if (fixture.sketch && typeof fixture.sketch === 'object') {
        sourceSketch = fixture.sketch;
    } else if (typeof fixture.sourcePartFile === 'string' && fixture.sourcePartFile.trim().length) {
        const partPath = fixture.sourcePartFile.trim();
        const raw = await fs.promises.readFile(partPath, 'utf8');
        const data = JSON.parse(raw);
        const features = Array.isArray(data?.features) ? data.features : [];
        let sketchFeature = null;
        if (fixture.sourceFeatureId != null) {
            const wanted = String(fixture.sourceFeatureId);
            sketchFeature = features.find((f) => (
                f?.type === 'S' &&
                (String(f?.inputParams?.id ?? '') === wanted ||
                    String(f?.inputParams?.featureID ?? '') === wanted)
            )) || null;
        }
        if (!sketchFeature) sketchFeature = features.find((f) => f?.type === 'S' && f?.persistentData?.sketch) || null;
        sourceSketch = sketchFeature?.persistentData?.sketch || null;
    }
    assert(sourceSketch && typeof sourceSketch === 'object', `${contextLabel}: missing sketch or sourcePartFile sketch`);

    const solver = new ConstraintSolver({
        sketch: JSON.parse(JSON.stringify(sourceSketch)),
    });
    solveWithSettle(solver, {
        maxPasses: Number.isFinite(Number(fixture.initialSolvePasses)) ? Number(fixture.initialSolvePasses) : 4,
        stopWhenConstraintsClear: true,
    });
    const before = JSON.parse(JSON.stringify(solver.sketchObject));

    applyEdits(solver, fixture.edits, contextLabel);
    const after = solver.sketchObject;

    runExpectations({
        before,
        after,
        expect: fixture.expect || {},
        contextLabel,
    });
}

export async function registerSketchSolverTopologyFixtureTests(testFunctions) {
    if (!(typeof process !== 'undefined' && process.versions && process.versions.node)) return 0;
    const seenSourceFiles = new Set(
        (testFunctions || [])
            .map((t) => t?._sourceFile)
            .filter((v) => typeof v === 'string' && v.length > 0)
    );
    let entries = [];
    try {
        entries = await fs.promises.readdir(FIXTURE_DIR);
    } catch {
        return 0;
    }

    const files = entries
        .filter((f) => typeof f === 'string' && f.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));

    let count = 0;
    for (const file of files) {
        const filePath = path.join(FIXTURE_DIR, file);
        if (seenSourceFiles.has(filePath)) continue;
        let fixture = null;
        try {
            const raw = await fs.promises.readFile(filePath, 'utf8');
            fixture = JSON.parse(raw);
        } catch (error) {
            const message = error?.message || String(error);
            throw new Error(`Failed to read sketch fixture ${filePath}: ${message}`);
        }

        const base = String(file).replace(/\.[^.]+$/, '');
        const name = sanitizeName(fixture?.name || base, `fixture_${count}`);
        const testName = `test_sketch_solver_fixture_${name}`;
        const testFn = async function sketchSolverFixtureTest() {
            await runFixture(fixture, filePath);
        };
        try { Object.defineProperty(testFn, 'name', { value: testName, configurable: true }); } catch { }
        testFunctions.push({
            test: testFn,
            printArtifacts: false,
            exportFaces: false,
            exportSolids: false,
            resetHistory: true,
            _sourceFile: filePath,
        });
        seenSourceFiles.add(filePath);
        count += 1;
    }
    return count;
}

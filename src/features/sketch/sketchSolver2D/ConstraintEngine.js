"use strict";

import { constraints } from "./constraintDefinitions.js";
import { distance, calculateAngle } from "./mathHelpersMod.js";

// === Constraint function table ===
const constraintFunctions = constraints.constraintFunctions;
let globalDistanceSolveCycleId = 0;

// === Engine that performs numeric solving on a sketch snapshot ===
class ConstraintEngine {
    constructor(sketchJSON) {
        const sketch = JSON.parse(sketchJSON);
        this.points = sketch.points.map(p => new Point(
            p.id,
            p.x,
            p.y,
            p.fixed,
            p.construction,
            p.externalReference
        ));
        this.geometries = sketch.geometries || [];
        this.constraints = sketch.constraints || [];
    }

    processConstraintsOfType(type) {
        const list = (type === "all")
            ? this.constraints
            : this.constraints.filter(c => c.type === type);

        for (const constraint of list) {
            constraint.status = "";
            const constraintValue = parseFloat(constraint.value);
            const points = constraint.points.map(id => this.points.find(p => p.id === id));
            const before = JSON.stringify(points);

            if (constraint.previousPointValues !== undefined &&
                constraint.previousPointValues === before &&
                constraint.status === "solved") continue;

            try {
                constraintFunctions[constraint.type](this, constraint, points, constraintValue);
            } catch (e) {
                // Keep solving other constraints; record the error on this constraint
                constraint.error = e?.message || String(e);
            }

            const after = JSON.stringify(points);
            if (before === after) {
                constraint.status = "solved";
                constraint.previousPointValues = after;
            }
        }
    }

    async tidyDecimalsOfPoints(decimalsPlaces = 4, resetFixed = true) {
        for (const p of this.points) {
            if (resetFixed) p.fixed = false;

            if (typeof p.x === "string") p.x = parseFloat(p.x);
            if (typeof p.y === "string") p.y = parseFloat(p.y);

            if (p.x === null || p.x === undefined || Number.isNaN(p.x)) p.x = 0;
            if (p.y === null || p.y === undefined || Number.isNaN(p.y)) p.y = 0;

            const k = Math.pow(10, decimalsPlaces);
            p.x = Math.round(p.x * k) / k;
            p.y = Math.round(p.y * k) / k;
        }
    }

    solve(iterations = 100) {
        const decimalsPlaces = 6;
        this._distanceSolveCycleId = ++globalDistanceSolveCycleId;
        const hasPendingDistanceTargetSlides = () => {
            const slideTol = Number.isFinite(constraints?.tolerance) ? Number(constraints.tolerance) : 1e-8;
            return this.constraints.some((c) => (
                c?.type === "⟺" &&
                c?._distanceThrottleActive === true &&
                Number.isFinite(c?._distanceRequestedTarget) &&
                Number.isFinite(c?._distanceAppliedTarget) &&
                Math.abs(c._distanceRequestedTarget - c._distanceAppliedTarget) > slideTol
            ));
        };

        // Implied constraints for certain geometry types (e.g., arcs, bezier splines)
        let nextTempId =
            Math.max(0, ...this.constraints.map(c => Number.isFinite(+c.id) ? +c.id : 0)) + 1;
        const pushTemp = (type, points) => {
            this.constraints.push({
                id: nextTempId++,
                type,
                points,
                temporary: true,
                labelX: 0,
                labelY: 0
            });
        };

        this.geometries.forEach(g => {
            if (g.type === "arc") {
                // Insert a temporary equal-chord constraint between (0-1) and (0-2)
                pushTemp("⇌", [g.points[0], g.points[1], g.points[0], g.points[2]]);
            } else if (g.type === "bezier" && Array.isArray(g.points) && g.points.length >= 4) {
                // Keep internal spline anchors colinear with their adjacent control points
                const ids = g.points || [];
                const segCount = Math.floor((ids.length - 1) / 3);
                const lastAnchorIndex = segCount * 3;
                for (let i = 3; i < lastAnchorIndex; i += 3) {
                    const prevHandle = ids[i - 1];
                    const anchor = ids[i];
                    const nextHandle = ids[i + 1];
                    if (prevHandle == null || anchor == null || nextHandle == null) continue;
                    if (prevHandle === anchor || nextHandle === anchor || prevHandle === nextHandle) continue;
                    pushTemp("⏛", [prevHandle, nextHandle, anchor]);
                }
            }
        });

        this.tidyDecimalsOfPoints(decimalsPlaces, true);

        // Ground first, then everything
        this._distanceSolvePassToken = `${this._distanceSolveCycleId}:pre`;
        this.processConstraintsOfType("⏚");
        this.processConstraintsOfType("all");

        const order = [
            "⏛", "━", "│", "⋯",
            "⟺", "⇌", "∠", "⟂", "∥",
            "⇌", "⟺", "⇌", "⟺", "⏛", "━", "│", // repeated passes for convergence
        ];

        let prev = JSON.stringify(this.points);
        let converged = false;

        for (let i = 0; i < iterations; i++) {
            this._distanceSolvePassToken = `${this._distanceSolveCycleId}:${i}`;
            for (const t of order) {
                this.processConstraintsOfType(t);
                this.processConstraintsOfType("≡"); // keep coincident snapping frequently
                this.processConstraintsOfType("━");
                this.processConstraintsOfType("|");
                this.tidyDecimalsOfPoints(decimalsPlaces, false);
                this.processConstraintsOfType("━");
                this.processConstraintsOfType("|");
                this.tidyDecimalsOfPoints(decimalsPlaces, false);
            }

            const cur = JSON.stringify(this.points);
            if (cur === prev && !hasPendingDistanceTargetSlides()) {
                converged = true;
                break;
            }
            prev = cur;

            // Movement throttling
            const maxMove = 0.5;
            for (let j = 0; j < this.points.length; j++) {
                const p = this.points[j];
                const last = JSON.parse(prev)[j];
                const dx = p.x - last.x;
                const dy = p.y - last.y;
                const d = Math.hypot(dx, dy);
                if (d > maxMove) {
                    const s = maxMove / d;
                    p.x = last.x + dx * s;
                    p.y = last.y + dy * s;
                }
            }
        }

        // Return a new sketch object mirroring input structure
        const updatedSketch = {
            points: this.points.map(p => ({
                id: p.id,
                x: p.x,
                y: p.y,
                fixed: p.fixed,
                construction: p.construction === true,
                externalReference: p.externalReference === true
            })),
            geometries: this.geometries,
            constraints: this.constraints.filter(c => !c.temporary) // drop temporaries
        };

        return JSON.parse(JSON.stringify(updatedSketch));
    }
}

class Point {
    constructor(id, x, y, fixed = false, construction = false, externalReference = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.fixed = fixed;
        this.construction = construction === true;
        this.externalReference = externalReference === true;
    }
}

// === Public API class ===
export class ConstraintSolver {
    /**
     * @param {Object} opts
     * @param {Object} [opts.sketch]  initial sketch {points, geometries, constraints}
     * @param {Function} [opts.notifyUser]  (message, type) => void
     * @param {Function} [opts.updateCanvas] () => void
     * @param {Function} [opts.getSelectionItems] () => Array<{type:"point"|"geometry", id:number}>
     * @param {Object}   [opts.appState] external state to mirror mode/type/requiredSelections
     */
    constructor(opts = {}) {
        this.hooks = {
            notifyUser: typeof opts.notifyUser === "function" ? opts.notifyUser : (m) => { /* no-op in headless */ },
            updateCanvas: typeof opts.updateCanvas === "function" ? opts.updateCanvas : () => { },
            getSelectionItems: typeof opts.getSelectionItems === "function" ? opts.getSelectionItems : () => []
        };

        this.appState = opts.appState || { mode: "", type: "", requiredSelections: 0 };

        this.sketchObject = opts.sketch ? sanitizeSketch(opts.sketch) : {
            points: [{ id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false }],
            geometries: [],
            constraints: [{ id: 0, type: "⏚", points: [0] }]
        };

        this._paused = false;
        this._pauseReason = "";
    }

    // ---------- Solver control ----------
    pause(reason = "") {
        this._paused = true;
        this._pauseReason = reason || "";
    }

    resume() {
        this._paused = false;
        this._pauseReason = "";
    }

    isPaused() { return !!this._paused; }

    // ---------- Core solve ----------
    solveSketch(iterations = null) {
        if (this._paused) {
            return this.sketchObject;
        }

        this.#removeConstraintsDuplicatedByImpliedGeometry();

        const iters = iterations === "full"
            ? this.fullSolve()
            : (iterations == null ? this.defaultLoops() : iterations);

        const engine = new ConstraintEngine(JSON.stringify(this.sketchObject));
        const solved = engine.solve(iters);
        //console.log(`Solver completed in ${iters} iterations.`);
        //console.log(solved.constraints);
        this.sketchObject = solved;
        return this.sketchObject;
    }

    #removeConstraintsDuplicatedByImpliedGeometry() {
        const sketch = this.sketchObject;
        if (!sketch || !Array.isArray(sketch.constraints) || !Array.isArray(sketch.geometries)) return 0;
        const canonicalPointMap = this.#buildCoincidentCanonicalPointMap(sketch.constraints);
        const implied = this.#collectImpliedConstraintKeys(sketch.geometries, canonicalPointMap);
        if (!implied.size) return 0;
        const before = sketch.constraints.length;
        sketch.constraints = sketch.constraints.filter((c) => {
            if (!c || c.temporary) return true;
            const key = this.#constraintSignature(c.type, c.points, canonicalPointMap);
            if (!key) return true;
            return !implied.has(key);
        });
        return before - sketch.constraints.length;
    }

    #collectImpliedConstraintKeys(geometries, canonicalPointMap = null) {
        const set = new Set();
        const add = (type, points) => {
            const key = this.#constraintSignature(type, points, canonicalPointMap);
            if (key) set.add(key);
        };
        for (const g of geometries || []) {
            if (!g || !Array.isArray(g.points)) continue;
            if (g.type === "arc" && g.points.length >= 3) {
                add("⇌", [g.points[0], g.points[1], g.points[0], g.points[2]]);
            } else if (g.type === "bezier" && g.points.length >= 4) {
                const ids = g.points;
                const segCount = Math.floor((ids.length - 1) / 3);
                const lastAnchorIndex = segCount * 3;
                for (let i = 3; i < lastAnchorIndex; i += 3) {
                    const prevHandle = ids[i - 1];
                    const anchor = ids[i];
                    const nextHandle = ids[i + 1];
                    if (prevHandle == null || anchor == null || nextHandle == null) continue;
                    if (prevHandle === anchor || nextHandle === anchor || prevHandle === nextHandle) continue;
                    add("⏛", [prevHandle, nextHandle, anchor]);
                }
            }
        }
        return set;
    }

    #constraintSignature(type, points, canonicalPointMap = null) {
        if (!Array.isArray(points)) return null;
        const canon = (id) => {
            const pid = parseInt(id);
            if (!Number.isFinite(pid)) return null;
            if (!canonicalPointMap) return pid;
            return canonicalPointMap.get(pid) ?? pid;
        };
        if (type === "⇌" && points.length >= 4) {
            const p0 = canon(points[0]);
            const p1 = canon(points[1]);
            const p2 = canon(points[2]);
            const p3 = canon(points[3]);
            if (![p0, p1, p2, p3].every(Number.isFinite)) return null;
            const a = this.#orderedPairKey(p0, p1);
            const b = this.#orderedPairKey(p2, p3);
            return (a <= b) ? `⇌:${a}|${b}` : `⇌:${b}|${a}`;
        }
        if (type === "⏛" && points.length >= 3) {
            const p0 = canon(points[0]);
            const p1 = canon(points[1]);
            const p2 = canon(points[2]);
            if (![p0, p1, p2].every(Number.isFinite)) return null;
            return `⏛:${this.#orderedPairKey(p0, p1)}|${p2}`;
        }
        return null;
    }

    #buildCoincidentCanonicalPointMap(constraints) {
        const parent = new Map();
        const find = (x) => {
            let p = parent.get(x);
            if (p == null) {
                parent.set(x, x);
                return x;
            }
            if (p !== x) {
                p = find(p);
                parent.set(x, p);
            }
            return p;
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra === rb) return;
            // Keep the smaller ID as representative for deterministic signatures.
            if (ra < rb) parent.set(rb, ra);
            else parent.set(ra, rb);
        };
        for (const c of constraints || []) {
            if (!c || c.temporary || c.type !== "≡" || !Array.isArray(c.points) || c.points.length < 2) continue;
            const p0 = parseInt(c.points[0]);
            const p1 = parseInt(c.points[1]);
            if (!Number.isFinite(p0) || !Number.isFinite(p1)) continue;
            union(p0, p1);
        }
        const out = new Map();
        for (const id of parent.keys()) out.set(id, find(id));
        return out;
    }

    #orderedPairKey(a, b) {
        return a <= b ? `${a},${b}` : `${b},${a}`;
    }

    defaultLoops() { return 1500; }
    fullSolve() { return 2000; }

    // ---------- Accessors ----------
    getPointById(id) {
        return this.sketchObject.points.find(p => p.id === parseInt(id));
    }

    // ---------- Edit operations (formerly exported functions) ----------
    removePointById(id) {
        id = parseInt(id);
        if (id === 0) return;

        this.sketchObject.points = this.sketchObject.points.filter(p => p.id !== id);

        // Remove geometries referencing the point
        this.sketchObject.geometries = this.sketchObject.geometries.filter(g => !g.points.includes(id));

        // Remove constraints referencing the point
        this.sketchObject.constraints = this.sketchObject.constraints.filter(c => !c.points.includes(id));
    }

    removeGeometryById(id) {
        id = parseInt(id);
        if (id === 0) return;

        this.sketchObject.geometries = this.sketchObject.geometries.filter(g => parseInt(g.id) !== id);

        // If any constraint stores geometryId, prune those as well
        this.sketchObject.constraints = this.sketchObject.constraints.filter(c => c.geometryId !== id);
    }

    removeConstraintById(id) {
        id = parseInt(id);
        this.sketchObject.constraints = this.sketchObject.constraints.filter(c => parseInt(c.id) !== id);
    }

    toggleConstruction() {
        const items = this.hooks.getSelectionItems();
        if (!items || items.length === 0) return;

        for (const item of items) {
            if (item.type === "geometry") {
                const g = this.sketchObject.geometries.find(x => x.id === parseInt(item.id));
                if (!g) continue;
                if (g.construction === undefined) g.construction = false;
                g.construction = !g.construction;
            }
        }
        this.hooks.updateCanvas(false);
    }

    geometryCreateLine() {
        this.appState.mode = "createGeometry";
        this.appState.type = "line";
        this.appState.requiredSelections = 2;
        this.createGeometry("line");
    }

    geometryCreateCircle() {
        this.appState.mode = "createGeometry";
        this.appState.type = "circle";
        this.appState.requiredSelections = 2;
        this.createGeometry("circle");
    }

    geometryCreateArc() {
        this.appState.mode = "createGeometry";
        this.appState.type = "arc";
        this.appState.requiredSelections = 3;
        this.createGeometry("arc");
    }

    // Create rectangle from two selected points (opposite corners in UV plane)
    // Produces 4 line geometries, 4 coincident constraints (one per corner), and 3 perpendicular constraints
    geometryCreateRectangle() {
        this.appState.mode = "createGeometry";
        this.appState.type = "rectangle";
        this.appState.requiredSelections = 2;

        // Collect two points from selection
        const items = this.hooks.getSelectionItems();
        const selPoints = [];
        for (const it of items || []) {
            if (it.type === "point") {
                const p = this.sketchObject.points.find(x => x.id === parseInt(it.id));
                if (p) selPoints.push(p);
            }
        }
        if (selPoints.length !== 2) return false;

        const pA = selPoints[0]; // one corner
        const pC = selPoints[1]; // opposite corner

        const u1 = pA.x, v1 = pA.y;
        const u2 = pC.x, v2 = pC.y;

        const nextPointId = () => Math.max(0, ...this.sketchObject.points.map(p => +p.id || 0)) + 1;
        const nextGeoId = () => Math.max(0, ...this.sketchObject.geometries.map(g => +g.id || 0)) + 1;
        const nextConId = () => Math.max(0, ...this.sketchObject.constraints.map(c => +c.id || 0)) + 1;

        // Create additional corner points at axis-aligned positions
        // We intentionally duplicate endpoints per edge and tie with coincident constraints.
        // Corners: C1(u1,v1)=pA vs pA_other, C2(u2,v1)=c2a,c2b, C3(u2,v2)=pC vs pC_other, C4(u1,v2)=c4a,c4b
        const pA_other = { id: nextPointId(), x: u1, y: v1, fixed: false };
        const c2a = { id: pA_other.id + 1, x: u2, y: v1, fixed: false };
        const c2b = { id: c2a.id + 1, x: u2, y: v1, fixed: false };
        const pC_other = { id: c2b.id + 1, x: u2, y: v2, fixed: false };
        const c4a = { id: pC_other.id + 1, x: u1, y: v2, fixed: false };
        const c4b = { id: c4a.id + 1, x: u1, y: v2, fixed: false };

        this.sketchObject.points.push(pA_other, c2a, c2b, pC_other, c4a, c4b);

        // Build 4 line geometries with distinct endpoints per adjacent edge
        const gIds = [];
        const pushLine = (a, b) => {
            const gid = nextGeoId();
            this.sketchObject.geometries.push({ id: gid, type: "line", points: [a, b], construction: false });
            gIds.push(gid);
        };

        // L1: bottom (C1 -> C2): pA -> c2a
        pushLine(pA.id, c2a.id);
        // L2: right (C2 -> C3): c2b -> pC
        pushLine(c2b.id, pC.id);
        // L3: top (C3 -> C4): pC_other -> c4a
        pushLine(pC_other.id, c4a.id);
        // L4: left (C4 -> C1): c4b -> pA_other
        pushLine(c4b.id, pA_other.id);

        // Coincident constraints at all four corners
        const pushCoincident = (p1, p2) => {
            const cid = nextConId();
            this.sketchObject.constraints.push({ id: cid, type: "≡", points: [p1, p2] });
        };
        // C1: pA with pA_other
        pushCoincident(pA.id, pA_other.id);
        // C2: c2a with c2b
        pushCoincident(c2a.id, c2b.id);
        // C3: pC with pC_other
        pushCoincident(pC.id, pC_other.id);
        // C4: c4a with c4b
        pushCoincident(c4a.id, c4b.id);

        // Perpendicular constraints between adjacent sides (3 of them; the 4th is implied)
        const pushPerp = (a, b, c, d) => {
            const cid = nextConId();
            this.sketchObject.constraints.push({ id: cid, type: "⟂", points: [a, b, c, d] });
        };
        // Use endpoints that define each line direction
        // L1(pA,c2a) ⟂ L2(c2b,pC)
        pushPerp(pA.id, c2a.id, c2b.id, pC.id);
        // L2(c2b,pC) ⟂ L3(pC_other,c4a)
        pushPerp(c2b.id, pC.id, pC_other.id, c4a.id);
        // L3(pC_other,c4a) ⟂ L4(c4b,pA_other)
        pushPerp(pC_other.id, c4a.id, c4b.id, pA_other.id);

        // Solve and update
        this.sketchObject = this.solveSketch("full");
        this.hooks.updateCanvas();
        this.appState.mode = "";
        this.appState.type = "";
        this.appState.requiredSelections = 0;
        return true;
    }

    createGeometry(type, points = []) {
        // Use selection if not provided
        if (points.length === 0) {
            const items = this.hooks.getSelectionItems();
            if (items && items.length > 0) {
                points = [];
                for (const it of items) {
                    if (it.type === "point") {
                        const p = this.sketchObject.points.find(x => x.id === parseInt(it.id));
                        if (p) points.push(p);
                    }
                }
            }
        }

        if (this.appState.requiredSelections && points.length !== this.appState.requiredSelections) {
            return false;
        }

        let pointIds;
        if (points.length > 0 && typeof points[0] === "object") {
            pointIds = points.map(p => p.id);
        } else {
            pointIds = points;
        }

        if (!pointIds || pointIds.length === 0) return false;

        const maxId = Math.max(0, ...this.sketchObject.geometries.map(geo => +geo.id || 0)) + 1;
        const newGeometry = {
            id: maxId,
            type,
            points: pointIds,
            construction: false
        };

        this.sketchObject.geometries.push(newGeometry);
        this.hooks.updateCanvas();
        this.appState.mode = "";
        this.appState.type = "";
        this.appState.requiredSelections = 0;
        return true;
    }

    createConstraint(type, currentlySelected = null) {
        const selected = [];
        let geometryType = null;

        const items = Array.isArray(currentlySelected) ? currentlySelected : this.hooks.getSelectionItems();

        for (const item of items) {
            if (item.type === "point") {
                const p = this.sketchObject.points.find(pp => pp.id === parseInt(item.id));
                if (p) selected.push(p);
            }
            if (item.type === "geometry") {
                const g = this.sketchObject.geometries.find(gg => gg.id === parseInt(item.id));
                if (!g) continue;
                for (const pid of g.points) {
                    const p = this.sketchObject.points.find(pp => pp.id === pid);
                    if (p) selected.push(p);
                }
                if (g.type === "arc") selected.pop(); // center + start; omit end for 3pt cases
                geometryType = g.type;
            }
        }

        if (selected.length === 0) return;

        const selectedPointIds = selected.map(p => parseInt(p.id));

        const newConstraint = {
            id: 0,
            type,
            points: selectedPointIds,
            labelX: 0,
            labelY: 0,
            displayStyle: "",
            value: null,
            valueNeedsSetup: true
        };

        if (selected.length === 1) {
            if (type === "⏚") return this.createAndPushNewConstraint(newConstraint);
        }

        if (selected.length === 2) {
            if (type === "━") return this.createAndPushNewConstraint(newConstraint);
            if (type === "│") return this.createAndPushNewConstraint(newConstraint);
            if (type === "≡") return this.createAndPushNewConstraint(newConstraint);

            if (type === "⟺") {
                if (geometryType === "arc" || geometryType === "circle") newConstraint.displayStyle = "radius";
                return this.createAndPushNewConstraint(newConstraint);
            }
        }

        if (selected.length === 3) {
            if (type === "⏛") return this.createAndPushNewConstraint(newConstraint);
            if (type === "⋯") {
                // If selection is Point + Line (and Point was first), ensure Point is last (Midpoint)
                const hasGeometry = items.some(i => i.type === "geometry");
                if (hasGeometry && items[0]?.type === "point") {
                    newConstraint.points = selectedPointIds.slice().reverse();
                }
                return this.createAndPushNewConstraint(newConstraint);
            }
            if (type === "⇌") return this.createAndPushNewConstraint(newConstraint);
        }

        if (selected.length === 4 || selected.length === 5) {
            if (type === "⏛") {
                // Allow Point-on-Line from two selected lines: use first line as target,
                // constrain both endpoints of the second line onto it (all points colinear).
                const geometries = items.filter(i => i.type === "geometry");
                if (geometries.length === 2) {
                    const g0 = this.sketchObject.geometries.find(gg => gg.id === parseInt(geometries[0].id));
                    const g1 = this.sketchObject.geometries.find(gg => gg.id === parseInt(geometries[1].id));
                    if (g0?.type === "line" && g1?.type === "line" &&
                        Array.isArray(g0.points) && g0.points.length >= 2 &&
                        Array.isArray(g1.points) && g1.points.length >= 2) {
                        const a = this.sketchObject.points.find(p => p.id === g0.points[0]);
                        const b = this.sketchObject.points.find(p => p.id === g0.points[1]);
                        const c0 = this.sketchObject.points.find(p => p.id === g1.points[0]);
                        const c1 = this.sketchObject.points.find(p => p.id === g1.points[1]);
                        if (a && b && c0 && c1) {
                            const base = {
                                type,
                                labelX: 0,
                                labelY: 0,
                                displayStyle: "",
                                value: null,
                                valueNeedsSetup: true
                            };
                            const maxId = Math.max(0, ...this.sketchObject.constraints.map(c => +c.id || 0)) + 1;
                            const cA = { ...base, id: maxId, points: [a.id, b.id, c0.id] };
                            const cB = { ...base, id: maxId + 1, points: [a.id, b.id, c1.id] };
                            this.sketchObject.constraints.push(cA, cB);
                            this.sketchObject = this.solveSketch("full");
                            this.hooks.updateCanvas();
                            this.hooks.notifyUser("Constraint added", "info");
                            return true;
                        }
                    }
                }
            }
            if (type === "⟂") {
                // Check if this is a tangent constraint (line + arc/circle)
                const isTangentConstraint = this.#detectTangentConstraint(items);

                if (isTangentConstraint) {
                    // Handle tangent constraint: choose closest line endpoint to circle center
                    const optimizedPoints = this.#optimizePointsForTangent(items, selected);
                    if (optimizedPoints) {
                        newConstraint.points = optimizedPoints;
                        return this.createAndPushNewConstraint(newConstraint);
                    }
                }

                // Only proceed with standard perpendicular if we have exactly 4 points (two lines)
                if (selected.length !== 4) {
                    this.hooks.updateCanvas();
                    this.hooks.notifyUser(
                        `Invalid selection for constraint type ${type}\nwith ${selected.length} points.`,
                        "warning"
                    );
                    return;
                }

                // Standard perpendicular constraint for two lines
                let line1AngleA = calculateAngle(selected[0], selected[1]);
                let line1AngleB = calculateAngle(selected[1], selected[0]);
                let line2Angle = calculateAngle(selected[2], selected[3]);

                line1AngleA = (line1AngleA + 180) % 360 - 180;
                line1AngleB = (line1AngleB + 180) % 360 - 180;
                line2Angle = (line2Angle + 180) % 360 - 180;

                let diffA = line1AngleA - line2Angle;
                let diffB = line1AngleB - line2Angle;

                // Choose orientation closer to 90°
                if (Math.abs(90 - diffA) > Math.abs(90 - diffB)) {
                    [newConstraint.points[0], newConstraint.points[1]] = [newConstraint.points[1], newConstraint.points[0]];
                }
                return this.createAndPushNewConstraint(newConstraint);
            }
            if (type === "∥") return this.createAndPushNewConstraint(newConstraint);
            if (type === "∠") {
                // Do NOT set a value on creation. The solver initializes the
                // constraint to the current angle on first evaluation, and the
                // renderer will display the interior arc by default.
                return this.createAndPushNewConstraint(newConstraint);
            }
            if (type === "⇌") return this.createAndPushNewConstraint(newConstraint);
        }

        this.hooks.updateCanvas();
        this.hooks.notifyUser(
            `Invalid selection for constraint type ${type}\nwith ${selected.length} points.`,
            "warning"
        );
    }

    createAndPushNewConstraint(constraint) {
        const maxId = Math.max(0, ...this.sketchObject.constraints.map(c => +c.id || 0)) + 1;
        constraint.id = maxId;
        constraint.value = (constraint.value === null || constraint.value === undefined)
            ? null
            : parseFloat(Number(constraint.value).toFixed(4));

        this.sketchObject.constraints.push(constraint);
        this.sketchObject = this.solveSketch("full");

        this.hooks.updateCanvas();
        this.hooks.notifyUser("Constraint added", "info");
        return true;
    }

    // ---------- Coincident simplification & cleanup ----------
    simplifyCoincidentConstraints() {
        const data = this.sketchObject;
        const coincidentGroups = {};
        const pointToGroup = {};

        data.constraints.forEach(constraint => {
            if (constraint.type === "≡") {
                const [p1, p2] = constraint.points;
                if (!coincidentGroups[p1]) coincidentGroups[p1] = new Set();
                if (!coincidentGroups[p2]) coincidentGroups[p2] = new Set();
                coincidentGroups[p1].add(p2);
                coincidentGroups[p2].add(p1);
            }
        });

        // Merge overlapping groups
        for (const [point, group] of Object.entries(coincidentGroups)) {
            for (const other of group) {
                if (coincidentGroups[other]) {
                    for (const p of coincidentGroups[other]) {
                        group.add(p);
                        coincidentGroups[p] = group;
                    }
                }
            }
        }

        for (const [point, group] of Object.entries(coincidentGroups)) {
            const minId = Math.min(...Array.from(group));
            pointToGroup[point] = minId;
        }

        // Replace IDs in constraints and geometries
        data.constraints.forEach(c => {
            c.points = c.points.map(p => pointToGroup[p] || p);
        });
        data.geometries.forEach(g => {
            g.points = g.points.map(p => pointToGroup[p] || p);
        });

        this.discardUnusedPoints();

        // Remove degenerate coincident constraints (same point twice)
        data.constraints = data.constraints.filter(c => !(c.type === "≡" && c.points[0] === c.points[1]));

        return this.sketchObject;
    }

    discardUnusedPoints() {
        const data = this.sketchObject;
        const used = new Set();
        data.constraints.forEach(c => c.points.forEach(pid => used.add(pid)));
        data.geometries.forEach(g => g.points.forEach(pid => used.add(pid)));
        data.points = data.points.filter(p => used.has(p.id));
        return this.sketchObject;
    }

    // Helper method to detect if this is a tangent constraint (line + arc/circle)
    #detectTangentConstraint(items) {
        if (items.length !== 2) return false;

        const geometries = items.filter(item => item.type === "geometry");
        if (geometries.length !== 2) return false;

        const lineGeo = geometries.find(item => {
            const g = this.sketchObject.geometries.find(gg => gg.id === parseInt(item.id));
            return g?.type === "line";
        });

        const circularGeo = geometries.find(item => {
            const g = this.sketchObject.geometries.find(gg => gg.id === parseInt(item.id));
            return g?.type === "arc" || g?.type === "circle";
        });

        return lineGeo && circularGeo;
    }

    // Helper method to choose optimal points for tangent constraint
    #optimizePointsForTangent(items, selected) {
        const geometries = items.filter(item => item.type === "geometry");
        if (geometries.length !== 2) return null;

        let lineGeo = null;
        let circularGeo = null;
        let linePoints = [];
        let circularPoints = [];

        // Identify line and circular geometry
        for (const item of geometries) {
            const g = this.sketchObject.geometries.find(gg => gg.id === parseInt(item.id));
            if (!g) continue;

            if (g.type === "line") {
                lineGeo = g;
                linePoints = g.points.map(pid => this.sketchObject.points.find(p => p.id === pid));
            } else if (g.type === "arc" || g.type === "circle") {
                circularGeo = g;
                circularPoints = g.points.map(pid => this.sketchObject.points.find(p => p.id === pid));
            }
        }

        if (!lineGeo || !circularGeo || linePoints.length < 2 || circularPoints.length < 1) {
            return null;
        }

        // For circular geometry: [0] = center, [1] = start point, [2] = end point (for arc)
        const center = circularPoints[0];
        const lineStart = linePoints[0];
        const lineEnd = linePoints[1];

        // Get arc/circle points (excluding center)
        const arcPoints = circularPoints.slice(1); // Remove center to get actual arc points

        if (arcPoints.length === 0) {
            // Fallback for circles - use center only
            return [lineStart.id, lineEnd.id, center.id, center.id];
        }

        // Calculate distance from each arc point to the line
        let closestArcPoint = arcPoints[0];
        let minDistance = this.#distancePointToLine(arcPoints[0], lineStart, lineEnd);

        for (let i = 1; i < arcPoints.length; i++) {
            const dist = this.#distancePointToLine(arcPoints[i], lineStart, lineEnd);
            if (dist < minDistance) {
                minDistance = dist;
                closestArcPoint = arcPoints[i];
            }
        }

        // Create perpendicular constraint using the line and the radius to closest arc point
        // Points: [line_start, line_end, center, closest_arc_point]
        return [lineStart.id, lineEnd.id, center.id, closestArcPoint.id];
    }

    // Helper method to calculate distance from point to line
    #distancePointToLine(point, lineStart, lineEnd) {
        // Calculate line direction vector
        let dirX = lineEnd.x - lineStart.x;
        let dirY = lineEnd.y - lineStart.y;
        const mag = Math.sqrt(dirX * dirX + dirY * dirY);

        if (mag === 0) return distance(point, lineStart); // Degenerate line case

        dirX /= mag; // Normalize
        dirY /= mag;

        // Vector from line start to point
        const vecX = point.x - lineStart.x;
        const vecY = point.y - lineStart.y;

        // Project point onto line
        const dot = vecX * dirX + vecY * dirY;
        const projX = lineStart.x + dot * dirX;
        const projY = lineStart.y + dot * dirY;

        // Calculate distance from point to its projection on the line
        const distX = point.x - projX;
        const distY = point.y - projY;
        return Math.sqrt(distX * distX + distY * distY);
    }
}

// ---------- Utilities ----------
function sanitizeSketch(sketch) {
    const s = {
        points: Array.isArray(sketch.points) ? sketch.points.map(p => ({
            id: +p.id,
            x: +p.x,
            y: +p.y,
            fixed: !!p.fixed,
            construction: (typeof p?.construction === "boolean") ? p.construction : (+p?.id === 0),
            externalReference: !!p?.externalReference
        })) : [],
        geometries: Array.isArray(sketch.geometries) ? sketch.geometries.slice() : [],
        constraints: Array.isArray(sketch.constraints) ? sketch.constraints.slice() : []
    };

    // Ensure at least an origin and ground if empty
    if (s.points.length === 0) s.points.push({ id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false });
    if (!s.constraints.some(c => c.type === "⏚")) {
        s.constraints.push({ id: 0, type: "⏚", points: [0] });
    }
    return s;
}

// Named exports for convenience (optional for consumers)
// Consumers should primarily instantiate the default export (ConstraintSolver)
export { ConstraintEngine };

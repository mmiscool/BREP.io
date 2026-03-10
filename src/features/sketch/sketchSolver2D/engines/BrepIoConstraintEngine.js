import { Solver as BrepIoSolver } from "brep-io-2d-solver";

import { constraints as solverConstraints } from "../constraintDefinitions.js";
import { distance as pointDistance, roundToDecimals } from "../mathHelpersMod.js";
import {
    addReflexAngleBranchEquation,
    addMidpointEquations,
    addPointOnLineEquation,
    addSegmentLengthEquation,
    addSignedPointLineDistanceEquation,
} from "./brepIoConstraintExprs.js";

const POINT_LINE_DISTANCE_TYPE = "↥";
const FULL_TURN_DEGREES = 360;
const HALF_TURN_DEGREES = 180;
const DEG_TO_RAD = Math.PI / 180;

export class BrepIoConstraintEngine {
    constructor(sketchJSON) {
        this.sketch = cloneSketch(JSON.parse(sketchJSON));
    }

    solve(iterations = 100) {
        this.sketch = solveSketchWithBrepIoEngine(this.sketch, { iterations });
        return JSON.parse(JSON.stringify(this.sketch));
    }
}

export function solveSketchWithBrepIoEngine(sketch, { iterations = 100 } = {}) {
    const workingSketch = cloneSketch(sketch);
    const pointMap = buildPointMap(workingSketch.points);
    const fixedSeeds = collectFixedSeeds(workingSketch);

    applyConstraintDefaults(workingSketch, pointMap);
    const impliedConstraints = buildImpliedConstraints(workingSketch.geometries);

    const solver = new BrepIoSolver();
    for (const point of workingSketch.points) {
        const pointId = Number(point?.id);
        if (!Number.isFinite(pointId)) continue;
        solver.addPoint(
            Number(point?.x) || 0,
            Number(point?.y) || 0,
            {
                id: pointId,
                fixed: fixedSeeds.has(pointId),
            }
        );
    }

    const explicitDistanceTargets = collectExplicitDistanceTargets(workingSketch.constraints);
    const equalDistancePairs = collectEqualDistancePairs([
        ...workingSketch.constraints,
        ...impliedConstraints,
    ]);
    const lockedSegmentLengths = new Set();
    const context = {
        geometries: workingSketch.geometries,
        pointMap,
        explicitDistanceTargets,
        equalDistancePairs,
        lockedSegmentLengths,
    };

    const allConstraints = [...workingSketch.constraints, ...impliedConstraints];
    for (const constraint of allConstraints) {
        addConstraintToSolver(solver, constraint, context);
    }

    solver.solve({
        maxIterations: normalizeIterations(iterations),
        convergenceTolerance: effectiveTolerance(),
        analysisTolerance: effectiveTolerance(),
        mobilityTolerance: effectiveTolerance(),
        autoActiveFromResiduals: true,
    });

    applySolvedPointPositions(workingSketch.points, solver);
    propagateFixedStates(workingSketch.points, workingSketch.constraints, fixedSeeds);
    annotateConstraintDiagnostics(workingSketch);
    return workingSketch;
}

function cloneSketch(sketch) {
    return {
        points: Array.isArray(sketch?.points)
            ? sketch.points.map((point) => ({ ...point }))
            : [],
        geometries: Array.isArray(sketch?.geometries)
            ? sketch.geometries.map((geometry) => ({
                ...geometry,
                points: Array.isArray(geometry?.points) ? geometry.points.slice() : [],
            }))
            : [],
        constraints: Array.isArray(sketch?.constraints)
            ? sketch.constraints.map((constraint) => ({
                ...constraint,
                points: Array.isArray(constraint?.points) ? constraint.points.slice() : [],
            }))
            : [],
    };
}

function buildPointMap(points) {
    return new Map((points || []).map((point) => [Number(point?.id), point]));
}

function collectFixedSeeds(sketch) {
    const fixedIds = new Set();
    for (const point of sketch?.points || []) {
        const pointId = Number(point?.id);
        if (!Number.isFinite(pointId)) continue;
        if (point?.fixed === true) fixedIds.add(pointId);
    }
    for (const constraint of sketch?.constraints || []) {
        if (constraint?.type !== "⏚") continue;
        const pointId = Number(constraint?.points?.[0]);
        if (Number.isFinite(pointId)) fixedIds.add(pointId);
    }
    return fixedIds;
}

function collectExplicitDistanceTargets(constraints) {
    const map = new Map();
    for (const constraint of constraints || []) {
        if (constraint?.type !== "⟺") continue;
        if (!Array.isArray(constraint?.points) || constraint.points.length < 2) continue;
        const key = orderedPairKey(constraint.points[0], constraint.points[1]);
        if (!key) continue;
        map.set(key, Math.abs(Number(constraint.value) || 0));
    }
    return map;
}

function collectEqualDistancePairs(constraints) {
    const set = new Set();
    for (const constraint of constraints || []) {
        if (constraint?.type !== "⇌") continue;
        if (!Array.isArray(constraint?.points) || constraint.points.length < 4) continue;
        const firstKey = orderedPairKey(constraint.points[0], constraint.points[1]);
        const secondKey = orderedPairKey(constraint.points[2], constraint.points[3]);
        if (firstKey) set.add(firstKey);
        if (secondKey) set.add(secondKey);
    }
    return set;
}

function buildImpliedConstraints(geometries) {
    const implied = [];
    for (const geometry of geometries || []) {
        if (!geometry || !Array.isArray(geometry.points)) continue;
        if (geometry.type === "arc" && geometry.points.length >= 3) {
            implied.push({
                type: "⇌",
                points: [geometry.points[0], geometry.points[1], geometry.points[0], geometry.points[2]],
                implied: true,
            });
            continue;
        }
        if (geometry.type === "bezier" && geometry.points.length >= 4) {
            const ids = geometry.points;
            const segmentCount = Math.floor((ids.length - 1) / 3);
            const lastAnchorIndex = segmentCount * 3;
            for (let i = 3; i < lastAnchorIndex; i += 3) {
                const prevHandle = ids[i - 1];
                const anchor = ids[i];
                const nextHandle = ids[i + 1];
                if (prevHandle == null || anchor == null || nextHandle == null) continue;
                if (prevHandle === anchor || anchor === nextHandle || prevHandle === nextHandle) continue;
                implied.push({
                    type: "⏛",
                    points: [prevHandle, nextHandle, anchor],
                    implied: true,
                });
            }
        }
    }
    return implied;
}

function addConstraintToSolver(solver, constraint, context) {
    if (!constraint || !Array.isArray(constraint.points)) return;
    const points = constraint.points.map((id) => Number(id));
    if (!points.every(Number.isFinite)) return;

    switch (constraint.type) {
        case "⏚": {
            const pointId = points[0];
            if (Number.isFinite(pointId)) solver.setFixed(pointId, true);
            return;
        }
        case "━":
            if (points.length >= 2) solver.addHorizontal(points[0], points[1]);
            return;
        case "│":
            if (points.length >= 2) solver.addVertical(points[0], points[1]);
            return;
        case "≡":
            if (points.length >= 2) solver.addCoincident(points[0], points[1]);
            return;
        case "⟺": {
            if (points.length < 2) return;
            const target = Math.abs(Number(constraint.value) || 0);
            solver.addDistance(points[0], points[1], target);
            return;
        }
        case POINT_LINE_DISTANCE_TYPE: {
            if (points.length < 3) return;
            const side = resolvePointLineDistanceSide(constraint, context.pointMap);
            const target = Math.abs(Number(constraint.value) || 0) * side;
            ensureSegmentLengthLock(solver, points[0], points[1], context);
            addSignedPointLineDistanceEquation(solver, points[0], points[1], points[2], target);
            return;
        }
        case "⇌":
            if (points.length >= 4) addEqualDistanceConstraint(solver, points, context);
            return;
        case "∥":
            if (points.length >= 4) {
                ensureSegmentLengthLock(solver, points[0], points[1], context);
                ensureSegmentLengthLock(solver, points[2], points[3], context);
                solver.addParallel(points[0], points[1], points[2], points[3]);
            }
            return;
        case "⟂":
            if (points.length >= 4) {
                ensureSegmentLengthLock(solver, points[0], points[1], context);
                ensureSegmentLengthLock(solver, points[2], points[3], context);
                solver.addPerpendicular(points[0], points[1], points[2], points[3]);
            }
            return;
        case "∠":
            if (points.length >= 4) {
                ensureSegmentLengthLock(solver, points[0], points[1], context);
                ensureSegmentLengthLock(solver, points[2], points[3], context);
                const targetDegrees = normalizeAngleDegrees(Number(constraint.value) || 0);
                solver.addAngle(
                    points[0],
                    points[1],
                    points[2],
                    points[3],
                    brepIoInteriorAngleDegrees(targetDegrees) * DEG_TO_RAD
                );
                if (targetDegrees !== 0 && targetDegrees !== HALF_TURN_DEGREES) {
                    addReflexAngleBranchEquation(solver, points, targetDegrees);
                }
            }
            return;
        case "⏛":
            if (points.length >= 3) addPointOnLineEquation(solver, points[0], points[1], points[2]);
            return;
        case "⋯":
            if (points.length >= 3) addMidpointEquations(solver, points[0], points[1], points[2]);
            return;
        default:
            return;
    }
}

function ensureSegmentLengthLock(solver, pointAId, pointBId, context) {
    const key = orderedPairKey(pointAId, pointBId);
    if (!key || context.lockedSegmentLengths.has(key)) return;
    if (context.explicitDistanceTargets.has(key) || context.equalDistancePairs.has(key)) {
        context.lockedSegmentLengths.add(key);
        return;
    }

    const pointA = context.pointMap.get(Number(pointAId));
    const pointB = context.pointMap.get(Number(pointBId));
    if (!pointA || !pointB) return;

    addSegmentLengthEquation(solver, Number(pointAId), Number(pointBId), pointDistance(pointA, pointB));
    context.lockedSegmentLengths.add(key);
}

function addEqualDistanceConstraint(solver, points, context) {
    const [pointAId, pointBId, pointCId, pointDId] = points;
    const firstKey = orderedPairKey(pointAId, pointBId);
    const secondKey = orderedPairKey(pointCId, pointDId);
    if (!firstKey || !secondKey) return;

    const firstTarget = context.explicitDistanceTargets.get(firstKey);
    const secondTarget = context.explicitDistanceTargets.get(secondKey);
    const firstHasExplicitTarget = Number.isFinite(firstTarget);
    const secondHasExplicitTarget = Number.isFinite(secondTarget);

    if (firstHasExplicitTarget && !secondHasExplicitTarget) {
        solver.addDistance(pointCId, pointDId, firstTarget);
        context.lockedSegmentLengths.add(secondKey);
        return;
    }
    if (!firstHasExplicitTarget && secondHasExplicitTarget) {
        solver.addDistance(pointAId, pointBId, secondTarget);
        context.lockedSegmentLengths.add(firstKey);
        return;
    }
    if (firstHasExplicitTarget && secondHasExplicitTarget) {
        context.lockedSegmentLengths.add(firstKey);
        context.lockedSegmentLengths.add(secondKey);
        return;
    }

    solver.addDistanceEqual(pointAId, pointBId, pointCId, pointDId);
}

function resolvePointLineDistanceSide(constraint, pointMap) {
    let side = Number(constraint?._linePointDistanceSign);
    if (Number.isFinite(side) && side !== 0) return side > 0 ? 1 : -1;

    const signedDistance = measureSignedPointLineDistance(constraint?.points, pointMap);
    side = Math.sign(signedDistance);
    return side === 0 ? 1 : side;
}

function applyConstraintDefaults(sketch, pointMap) {
    for (const constraint of sketch.constraints || []) {
        if (!constraint || !Array.isArray(constraint.points)) continue;

        if (constraint.type === "⟺") {
            const currentValue = readConstraintValue(constraint.value);
            if (currentValue == null && constraint.points.length >= 2) {
                const pointA = pointMap.get(Number(constraint.points[0]));
                const pointB = pointMap.get(Number(constraint.points[1]));
                if (pointA && pointB) {
                    constraint.value = pointDistance(pointA, pointB);
                }
            }
            const normalizedValue = readConstraintValue(constraint.value) != null
                ? Math.abs(readConstraintValue(constraint.value))
                : 0;
            constraint.value = normalizedValue;
            constraint._distanceRequestedTarget = normalizedValue;
            constraint._distanceAppliedTarget = normalizedValue;
            constraint._distanceThrottleActive = false;
            if (!("_distanceLastAppliedPassToken" in constraint)) {
                constraint._distanceLastAppliedPassToken = null;
            }
            continue;
        }

        if (constraint.type === POINT_LINE_DISTANCE_TYPE) {
            const signedDistance = measureSignedPointLineDistance(constraint.points, pointMap);
            const currentValue = readConstraintValue(constraint.value);
            if (currentValue == null) {
                constraint.value = Math.abs(signedDistance);
            }
            const currentSide = Math.sign(signedDistance);
            const fallbackSide = currentSide === 0 ? 1 : currentSide;
            let side = Number(constraint._linePointDistanceSign);
            if (!Number.isFinite(side) || side === 0) side = fallbackSide;
            if ((readConstraintValue(constraint.value) || 0) < 0) side = -1;
            constraint._linePointDistanceSign = side > 0 ? 1 : -1;

            const normalizedValue = Math.abs(readConstraintValue(constraint.value) || 0);
            constraint.value = normalizedValue;
            constraint._distanceRequestedTarget = normalizedValue;
            constraint._distanceAppliedTarget = normalizedValue;
            constraint._distanceThrottleActive = false;
            if (!("_distanceLastAppliedPassToken" in constraint)) {
                constraint._distanceLastAppliedPassToken = null;
            }
            continue;
        }

        if (constraint.type === "∠") {
            if (constraint.points.length < 4) continue;
            const currentValue = readConstraintValue(constraint.value);
            if (currentValue == null) {
                constraint.value = roundToDecimals(
                    measureOrientedAngleDegrees(constraint.points, pointMap),
                    4
                );
                continue;
            }

            if (currentValue < 0) {
                constraint.value = Math.abs(currentValue);
                constraint.points = [
                    constraint.points[2],
                    constraint.points[3],
                    constraint.points[1],
                    constraint.points[0],
                ];
            }
            constraint.value = normalizeAngleDegrees(readConstraintValue(constraint.value) || 0);
        }
    }
}

function readConstraintValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function applySolvedPointPositions(points, solver) {
    const solvedPoints = new Map(
        solver.getPoints().map((point) => [Number(point?.id), point])
    );
    for (const point of points || []) {
        const solved = solvedPoints.get(Number(point?.id));
        if (!solved) continue;
        point.x = roundCoordinate(solved.x);
        point.y = roundCoordinate(solved.y);
    }
}

function propagateFixedStates(points, constraints, fixedSeeds) {
    const parent = new Map();
    const find = (value) => {
        let parentValue = parent.get(value);
        if (parentValue == null) {
            parent.set(value, value);
            return value;
        }
        if (parentValue !== value) {
            parentValue = find(parentValue);
            parent.set(value, parentValue);
        }
        return parentValue;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot);
        else parent.set(leftRoot, rightRoot);
    };

    for (const point of points || []) {
        const pointId = Number(point?.id);
        if (Number.isFinite(pointId)) find(pointId);
    }
    for (const constraint of constraints || []) {
        if (constraint?.type !== "≡") continue;
        if (!Array.isArray(constraint?.points) || constraint.points.length < 2) continue;
        const pointAId = Number(constraint.points[0]);
        const pointBId = Number(constraint.points[1]);
        if (Number.isFinite(pointAId) && Number.isFinite(pointBId)) union(pointAId, pointBId);
    }

    const fixedRoots = new Set();
    for (const pointId of fixedSeeds) {
        if (Number.isFinite(pointId)) fixedRoots.add(find(pointId));
    }

    for (const point of points || []) {
        const pointId = Number(point?.id);
        point.fixed = Number.isFinite(pointId) && fixedRoots.has(find(pointId));
    }
}

function annotateConstraintDiagnostics(sketch) {
    const pointMap = buildPointMap(sketch.points);
    const tolerance = effectiveTolerance();

    for (const constraint of sketch.constraints || []) {
        const points = Array.isArray(constraint?.points)
            ? constraint.points.map((id) => pointMap.get(Number(id))).filter(Boolean)
            : [];

        const error = diagnoseConstraint(constraint, points, pointMap, tolerance);
        constraint.error = error;
        constraint.status = error ? "" : "solved";
        constraint.previousPointValues = JSON.stringify(points.map(snapshotPoint));
    }
}

function diagnoseConstraint(constraint, points, pointMap, tolerance) {
    if (!constraint) return "Invalid constraint";

    switch (constraint.type) {
        case "⏚":
            return (points[0]?.fixed === true) ? null : "Fixed constraint not satisfied";
        case "━":
            return (points.length >= 2 && Math.abs(points[0].y - points[1].y) <= tolerance)
                ? null
                : "Horizontal constraint not satisfied";
        case "│":
            return (points.length >= 2 && Math.abs(points[0].x - points[1].x) <= tolerance)
                ? null
                : "Vertical constraint not satisfied";
        case "≡":
            return (points.length >= 2 && pointDistance(points[0], points[1]) <= tolerance)
                ? null
                : "Coincident constraint not satisfied";
        case "⟺": {
            if (points.length < 2) return "Distance constraint is missing points";
            const target = Math.abs(Number(constraint.value) || 0);
            const current = pointDistance(points[0], points[1]);
            return Math.abs(current - target) <= tolerance
                ? null
                : "Distance constraint not satisfied";
        }
        case POINT_LINE_DISTANCE_TYPE: {
            if (Array.isArray(constraint?.points) && constraint.points.length >= 3) {
                const side = resolvePointLineDistanceSide(constraint, pointMap);
                const target = Math.abs(Number(constraint.value) || 0) * side;
                const current = measureSignedPointLineDistance(constraint.points, pointMap);
                return Math.abs(current - target) <= tolerance
                    ? null
                    : "Line to point distance constraint not satisfied";
            }
            return "Line to point distance constraint is missing points";
        }
        case "⇌":
            if (points.length < 4) return "Equal distance constraint is missing points";
            return Math.abs(
                pointDistance(points[0], points[1]) - pointDistance(points[2], points[3])
            ) <= tolerance
                ? null
                : "Equal distance constraint not satisfied";
        case "∥": {
            if (Array.isArray(constraint?.points) && constraint.points.length >= 4) {
                const current = measureOrientedAngleDegrees(constraint.points, pointMap);
                const error = Math.min(
                    Math.abs(shortestAngleDeltaDegrees(0, current)),
                    Math.abs(shortestAngleDeltaDegrees(180, current))
                );
                return error <= tolerance ? null : "Parallel constraint not satisfied";
            }
            return "Parallel constraint is missing points";
        }
        case "⟂": {
            if (Array.isArray(constraint?.points) && constraint.points.length >= 4) {
                const current = measureOrientedAngleDegrees(constraint.points, pointMap);
                const error = Math.min(
                    Math.abs(shortestAngleDeltaDegrees(90, current)),
                    Math.abs(shortestAngleDeltaDegrees(270, current))
                );
                return error <= tolerance ? null : "Perpendicular constraint not satisfied";
            }
            return "Perpendicular constraint is missing points";
        }
        case "∠": {
            if (Array.isArray(constraint?.points) && constraint.points.length >= 4) {
                const current = measureOrientedAngleDegrees(constraint.points, pointMap);
                const target = normalizeAngleDegrees(Number(constraint.value) || 0);
                return Math.abs(shortestAngleDeltaDegrees(target, current)) <= tolerance
                    ? null
                    : "Angle constraint not satisfied";
            }
            return "Angle constraint is missing points";
        }
        case "⏛": {
            if (Array.isArray(constraint?.points) && constraint.points.length >= 3) {
                const current = Math.abs(measureSignedPointLineDistance(
                    [constraint.points[0], constraint.points[1], constraint.points[2]],
                    pointMap
                ));
                return current <= tolerance ? null : "Point on line constraint not satisfied";
            }
            return "Point on line constraint is missing points";
        }
        case "⋯":
            if (points.length < 3) return "Midpoint constraint is missing points";
            return midpointResidual(points[0], points[1], points[2]) <= tolerance
                ? null
                : "Midpoint constraint not satisfied";
        default:
            return null;
    }
}

function midpointResidual(pointA, pointB, midpoint) {
    const rx = (2 * midpoint.x) - pointA.x - pointB.x;
    const ry = (2 * midpoint.y) - pointA.y - pointB.y;
    return Math.hypot(rx, ry);
}

function measureSignedPointLineDistance(pointIds, pointMap) {
    const pointA = pointMap.get(Number(pointIds?.[0]));
    const pointB = pointMap.get(Number(pointIds?.[1]));
    const pointC = pointMap.get(Number(pointIds?.[2]));
    if (!pointA || !pointB || !pointC) return 0;

    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-12)) {
        return pointDistance(pointA, pointC);
    }
    const nx = -dy / length;
    const ny = dx / length;
    return ((pointC.x - pointA.x) * nx) + ((pointC.y - pointA.y) * ny);
}

function measureOrientedAngleDegrees(pointIds, pointMap) {
    const pointA = pointMap.get(Number(pointIds?.[0]));
    const pointB = pointMap.get(Number(pointIds?.[1]));
    const pointC = pointMap.get(Number(pointIds?.[2]));
    const pointD = pointMap.get(Number(pointIds?.[3]));
    if (!pointA || !pointB || !pointC || !pointD) return 0;

    const abx = pointB.x - pointA.x;
    const aby = pointB.y - pointA.y;
    const cdx = pointD.x - pointC.x;
    const cdy = pointD.y - pointC.y;
    const radians = Math.atan2((abx * cdy) - (aby * cdx), (abx * cdx) + (aby * cdy));
    return normalizeAngleDegrees(radians * 180 / Math.PI);
}

function normalizeIterations(iterations) {
    const value = Math.max(1, Number(iterations) || 100);
    return Math.round(value);
}

function effectiveTolerance() {
    const configured = Number(solverConstraints?.tolerance);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.max(configured, 1e-4);
    }
    return 1e-4;
}

function normalizeAngleDegrees(angle) {
    const normalized = Number(angle) % FULL_TURN_DEGREES;
    return normalized < 0 ? normalized + FULL_TURN_DEGREES : normalized;
}

function brepIoInteriorAngleDegrees(angleDegrees) {
    const normalized = normalizeAngleDegrees(angleDegrees);
    return normalized <= HALF_TURN_DEGREES
        ? normalized
        : FULL_TURN_DEGREES - normalized;
}

function shortestAngleDeltaDegrees(target, current) {
    const delta = normalizeAngleDegrees(Number(target) - Number(current));
    return delta > 180 ? delta - 180 - 180 : delta;
}

function orderedPairKey(left, right) {
    const leftId = Number(left);
    const rightId = Number(right);
    if (!Number.isFinite(leftId) || !Number.isFinite(rightId)) return null;
    return leftId <= rightId ? `${leftId},${rightId}` : `${rightId},${leftId}`;
}

function roundCoordinate(value) {
    return roundToDecimals(Number(value) || 0, 6);
}

function snapshotPoint(point) {
    return {
        id: Number(point?.id),
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
        fixed: point?.fixed === true,
        construction: point?.construction === true,
        externalReference: point?.externalReference === true,
    };
}

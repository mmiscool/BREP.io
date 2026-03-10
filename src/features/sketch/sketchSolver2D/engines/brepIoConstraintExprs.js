import { Expr } from "brep-io-2d-solver";

const DEG_TO_RAD = Math.PI / 180;

export function addReflexAngleBranchEquation(solver, pointIds, targetDegrees) {
    const [aId, bId, cId, dId] = pointIds;
    const a = solver.point(aId);
    const b = solver.point(bId);
    const c = solver.point(cId);
    const d = solver.point(dId);

    const lineAB = b.v.sub(a.v);
    const lineCD = d.v.sub(c.v);
    const targetRadians = Number(targetDegrees) * DEG_TO_RAD;
    const lenProduct = lineAB.length.mul(lineCD.length);

    solver.addEquation(
        lineAB.cross(lineCD).sub(lenProduct.mul(Math.sin(targetRadians)))
    );
}

export function addPointOnLineEquation(solver, lineStartId, lineEndId, pointId) {
    const lineStart = solver.point(lineStartId);
    const lineEnd = solver.point(lineEndId);
    const point = solver.point(pointId);

    const lineVector = lineEnd.v.sub(lineStart.v);
    const pointVector = point.v.sub(lineStart.v);

    solver.addEquation(lineVector.cross(pointVector));
}

export function addMidpointEquations(solver, pointAId, pointBId, midpointId) {
    const pointA = solver.point(pointAId);
    const pointB = solver.point(pointBId);
    const midpoint = solver.point(midpointId);

    solver.addEquation(midpoint.x.mul(2).sub(pointA.x).sub(pointB.x));
    solver.addEquation(midpoint.y.mul(2).sub(pointA.y).sub(pointB.y));
}

export function addSignedPointLineDistanceEquation(solver, lineStartId, lineEndId, pointId, targetDistance) {
    const lineStart = solver.point(lineStartId);
    const lineEnd = solver.point(lineEndId);
    const point = solver.point(pointId);

    const lineVector = lineEnd.v.sub(lineStart.v);
    const pointVector = point.v.sub(lineStart.v);

    solver.addEquation(
        lineVector.cross(pointVector).sub(lineVector.length.mul(Number(targetDistance) || 0))
    );
}

export function addSegmentLengthEquation(solver, pointAId, pointBId, targetLength) {
    const pointA = solver.point(pointAId);
    const pointB = solver.point(pointBId);
    const distance = pointB.v.sub(pointA.v).length;
    solver.addEquation(distance.sub(Expr.const(Number(targetLength) || 0)));
}

import * as THREE from 'three';
const EPS = 1e-8;
function toVector2(point) {
    return new THREE.Vector2(point[0], point[1]);
}
function edgeEndpoints(polyline, reverse = false) {
    if (polyline.length < 2) {
        throw new Error('Edge polyline must contain at least two points.');
    }
    if (reverse) {
        return {
            start: toVector2(polyline[polyline.length - 1]),
            end: toVector2(polyline[0])
        };
    }
    return {
        start: toVector2(polyline[0]),
        end: toVector2(polyline[polyline.length - 1])
    };
}
function polylineLength(polyline) {
    let length = 0;
    for (let i = 1; i < polyline.length; i += 1) {
        length += toVector2(polyline[i]).distanceTo(toVector2(polyline[i - 1]));
    }
    return length;
}
function transformPolyline(polyline, matrix) {
    return polyline.map((point) => new THREE.Vector3(point[0], point[1], 0).applyMatrix4(matrix));
}
function transformOutline2D(outline, matrix) {
    return outline.map((point) => {
        const transformed = new THREE.Vector3(point[0], point[1], 0).applyMatrix4(matrix);
        return new THREE.Vector2(transformed.x, transformed.y);
    });
}
function pointInPolygon2D(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const yi = polygon[i].y;
        const yj = polygon[j].y;
        const intersects = (yi > point.y) !== (yj > point.y);
        if (!intersects) {
            continue;
        }
        const xi = polygon[i].x;
        const xj = polygon[j].x;
        const xAtY = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
        if (point.x < xAtY) {
            inside = !inside;
        }
    }
    return inside;
}
function polygonCentroidFromVector2(points) {
    if (points.length === 0) {
        return new THREE.Vector2(0, 0);
    }
    let signedArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const cross = a.x * b.y - b.x * a.y;
        signedArea += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
    }
    if (Math.abs(signedArea) <= EPS) {
        const sum = points.reduce((acc, point) => {
            acc.x += point.x;
            acc.y += point.y;
            return acc;
        }, { x: 0, y: 0 });
        return new THREE.Vector2(sum.x / points.length, sum.y / points.length);
    }
    const areaFactor = 1 / (3 * signedArea);
    return new THREE.Vector2(cx * areaFactor, cy * areaFactor);
}
function polygonCentroid(points) {
    return polygonCentroidFromVector2(points.map((point) => new THREE.Vector2(point[0], point[1])));
}
function holeOutlineFromEntry(entry) {
    if (Array.isArray(entry)) {
        return entry;
    }
    if (entry && Array.isArray(entry.outline)) {
        return entry.outline;
    }
    return null;
}
function normalizeLoopPoints2D(points) {
    if (!Array.isArray(points) || points.length < 3) {
        return [];
    }
    const out = [];
    for (const point of points) {
        if (!Array.isArray(point) || point.length < 2) {
            continue;
        }
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        const vec = new THREE.Vector2(x, y);
        if (!out.length || out[out.length - 1].distanceTo(vec) > EPS * 10) {
            out.push(vec);
        }
    }
    if (out.length >= 2 && out[0].distanceTo(out[out.length - 1]) <= EPS * 10) {
        out.pop();
    }
    return out.length >= 3 ? out : [];
}
function collectHoleLoops2D(flat) {
    const raw = flat && Array.isArray(flat.holes) ? flat.holes : [];
    const loops = [];
    for (const entry of raw) {
        const loop = normalizeLoopPoints2D(holeOutlineFromEntry(entry));
        if (loop.length >= 3) {
            loops.push(loop);
        }
    }
    return loops;
}
function edgeMatchesLoopSegment(edgeStart, edgeEnd, loop) {
    if (!edgeStart || !edgeEnd || !Array.isArray(loop) || loop.length < 2) {
        return false;
    }
    let bestScore = Infinity;
    let bestLen = 0;
    for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const segLen = a.distanceTo(b);
        const forward = edgeStart.distanceTo(a) + edgeEnd.distanceTo(b);
        const reverse = edgeStart.distanceTo(b) + edgeEnd.distanceTo(a);
        const score = Math.min(forward, reverse);
        if (score < bestScore) {
            bestScore = score;
            bestLen = segLen;
        }
    }
    const tol = Math.max(1e-4, bestLen * 1e-3);
    return bestScore <= tol;
}
function makeRotationAroundLine(origin, axis, angleRad) {
    const normalizedAxis = axis.clone().normalize();
    const moveToAxis = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
    const rotate = new THREE.Matrix4().makeRotationAxis(normalizedAxis, angleRad);
    const moveBack = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
    return new THREE.Matrix4().multiplyMatrices(moveBack, rotate).multiply(moveToAxis);
}
function makeEdgeAlignment(parentEdge, childEdge, reverseChild) {
    const parent = edgeEndpoints(parentEdge, false);
    const child = edgeEndpoints(childEdge, reverseChild);
    const parentDir = parent.end.clone().sub(parent.start);
    const childDir = child.end.clone().sub(child.start);
    if (parentDir.lengthSq() <= EPS || childDir.lengthSq() <= EPS) {
        throw new Error('Degenerate edge cannot be aligned.');
    }
    const parentAngle = Math.atan2(parentDir.y, parentDir.x);
    const childAngle = Math.atan2(childDir.y, childDir.x);
    const rotateZ = new THREE.Matrix4().makeRotationZ(parentAngle - childAngle);
    const rotatedChildStart = new THREE.Vector3(child.start.x, child.start.y, 0).applyMatrix4(rotateZ);
    const translation = new THREE.Vector3(parent.start.x, parent.start.y, 0).sub(rotatedChildStart);
    const result = rotateZ.clone();
    result.setPosition(translation);
    return result;
}
function transformPoint2(point, matrix) {
    const transformed = new THREE.Vector3(point.x, point.y, 0).applyMatrix4(matrix);
    return new THREE.Vector2(transformed.x, transformed.y);
}
function findEdge(flat, edgeId) {
    const edge = flat.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) {
        throw new Error(`Flat "${flat.id}" is missing edge "${edgeId}".`);
    }
    return edge;
}
function validateFlat(flat, validatedFlats) {
    if (validatedFlats.has(flat)) {
        return;
    }
    if (flat.outline.length < 3) {
        throw new Error(`Flat "${flat.id}" outline must contain at least 3 points.`);
    }
    const edgeIds = new Set();
    for (const edge of flat.edges) {
        if (edgeIds.has(edge.id)) {
            throw new Error(`Flat "${flat.id}" contains duplicate edge id "${edge.id}".`);
        }
        edgeIds.add(edge.id);
        if (edge.polyline.length < 2) {
            throw new Error(`Edge "${edge.id}" on flat "${flat.id}" must contain at least 2 polyline points.`);
        }
        if (polylineLength(edge.polyline) <= EPS) {
            throw new Error(`Edge "${edge.id}" on flat "${flat.id}" has zero length.`);
        }
        if (edge.bend) {
            const bend = edge.bend;
            if (!Number.isFinite(bend.angleDeg) || Math.abs(bend.angleDeg) < 1e-6) {
                throw new Error(`Bend "${bend.id}" must have a non-zero finite angleDeg.`);
            }
            if (!Number.isFinite(bend.midRadius) || bend.midRadius <= 0) {
                throw new Error(`Bend "${bend.id}" must have midRadius > 0.`);
            }
            if (!Number.isFinite(bend.kFactor)) {
                throw new Error(`Bend "${bend.id}" must have a finite kFactor.`);
            }
            if (bend.children.length === 0) {
                throw new Error(`Bend "${bend.id}" must have at least one child flat.`);
            }
        }
    }
    validatedFlats.add(flat);
}
function interiorSideOfBoundaryLoop(outline, edgeStart, edgeEnd) {
    const edge = edgeEnd.clone().sub(edgeStart);
    const edgeLength = edge.length();
    if (edgeLength <= EPS) {
        return 1;
    }
    const edgeDir = edge.multiplyScalar(1 / edgeLength);
    const leftNormal = new THREE.Vector2(-edgeDir.y, edgeDir.x);
    const edgeMid = edgeStart.clone().add(edgeEnd).multiplyScalar(0.5);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of outline) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY);
    const probeDistance = Math.max(1e-5, diagonal * 1e-5, edgeLength * 1e-5);
    const probeLeft = edgeMid.clone().add(leftNormal.clone().multiplyScalar(probeDistance));
    const probeRight = edgeMid.clone().add(leftNormal.clone().multiplyScalar(-probeDistance));
    const insideLeft = pointInPolygon2D(probeLeft, outline);
    const insideRight = pointInPolygon2D(probeRight, outline);
    if (insideLeft !== insideRight) {
        return insideLeft ? 1 : -1;
    }
    const centroid = polygonCentroidFromVector2(outline);
    const interiorDirection = centroid.sub(edgeMid);
    return leftNormal.dot(interiorDirection) >= 0 ? 1 : -1;
}
function interiorSideOfEdge(flat, edgeStart, edgeEnd) {
    if (!flat) {
        return 1;
    }
    const holeLoops = collectHoleLoops2D(flat);
    for (const holeLoop of holeLoops) {
        if (!edgeMatchesLoopSegment(edgeStart, edgeEnd, holeLoop)) {
            continue;
        }
        // Hole-loop interior is void; material interior is the opposite side.
        const holeInteriorSide = interiorSideOfBoundaryLoop(holeLoop, edgeStart, edgeEnd);
        return -holeInteriorSide;
    }
    const outline = flat.outline.map((point) => new THREE.Vector2(point[0], point[1]));
    return interiorSideOfBoundaryLoop(outline, edgeStart, edgeEnd);
}
function outwardDirection(flat, edge) {
    const { start, end } = edgeEndpoints(edge.polyline, false);
    const edgeDir = end.clone().sub(start);
    if (edgeDir.lengthSq() <= EPS) {
        throw new Error(`Edge "${edge.id}" on flat "${flat.id}" is degenerate.`);
    }
    edgeDir.normalize();
    const leftNormal = new THREE.Vector2(-edgeDir.y, edgeDir.x);
    const interiorSide = interiorSideOfEdge(flat, start, end);
    return interiorSide > 0
        ? leftNormal.clone().multiplyScalar(-1).normalize()
        : leftNormal.normalize();
}
function hasInteriorOnLeft(flat, edge) {
    const { start, end } = edgeEndpoints(edge.polyline, false);
    return interiorSideOfEdge(flat, start, end) > 0;
}
function inferReverseEdge(parentFlat, parentEdge, childFlat, childEdge) {
    const parentAttach = edgeEndpoints(parentEdge.polyline, false);
    const parentInteriorSide = interiorSideOfEdge(parentFlat, parentAttach.start, parentAttach.end);
    const scoreFor = (reverse) => {
        const align = makeEdgeAlignment(parentEdge.polyline, childEdge.polyline, reverse);
        const childAttach = edgeEndpoints(childEdge.polyline, reverse);
        const childStart = transformPoint2(childAttach.start, align);
        const childEnd = transformPoint2(childAttach.end, align);
        const childOutline = transformOutline2D(childFlat.outline, align);
        const childInteriorSide = interiorSideOfBoundaryLoop(childOutline, childStart, childEnd);
        // Opposite interior sides at the shared edge are physically valid.
        return parentInteriorSide * childInteriorSide;
    };
    const scoreFalse = scoreFor(false);
    const scoreTrue = scoreFor(true);
    if (scoreTrue !== scoreFalse) {
        return scoreTrue < scoreFalse;
    }
    // Degenerate fallback for ambiguous/non-boundary attach definitions.
    const childCentroid = polygonCentroid(childFlat.outline);
    const childCentroidFalse = transformPoint2(childCentroid, makeEdgeAlignment(parentEdge.polyline, childEdge.polyline, false));
    const childCentroidTrue = transformPoint2(childCentroid, makeEdgeAlignment(parentEdge.polyline, childEdge.polyline, true));
    const parentMid = parentAttach.start.clone().add(parentAttach.end).multiplyScalar(0.5);
    const parentDir = parentAttach.end.clone().sub(parentAttach.start).normalize();
    const parentLeft = new THREE.Vector2(-parentDir.y, parentDir.x);
    const sideFalse = parentLeft.dot(childCentroidFalse.sub(parentMid));
    const sideTrue = parentLeft.dot(childCentroidTrue.sub(parentMid));
    return parentInteriorSide * sideTrue < parentInteriorSide * sideFalse;
}
function localBendAxis(parentEdge, midRadius) {
    const { start, end } = edgeEndpoints(parentEdge.polyline, false);
    const edgeDir = end.clone().sub(start);
    const length = edgeDir.length();
    if (length <= EPS) {
        throw new Error(`Edge "${parentEdge.id}" is degenerate and cannot define a bend axis.`);
    }
    return {
        start: new THREE.Vector3(start.x, start.y, -midRadius),
        dir: new THREE.Vector3(edgeDir.x / length, edgeDir.y / length, 0),
        length
    };
}
function localBendAxisSigned(parentEdge, midRadius, angleRad) {
    const sign = angleRad >= 0 ? 1 : -1;
    const axis = localBendAxis(parentEdge, midRadius);
    // Signed convention:
    // positive angle => bend "up", negative angle => bend "down".
    // The bend center flips with sign so both directions still flow away
    // from the base edge (never folding back over the base flat).
    axis.start.z = -sign * midRadius;
    return axis;
}
function maxPointwiseDistance(a, b) {
    if (a.length !== b.length) {
        return Infinity;
    }
    let max = 0;
    for (let i = 0; i < a.length; i += 1) {
        max = Math.max(max, a[i].distanceTo(b[i]));
    }
    return max;
}
function resamplePolyline3(points, sampleCount) {
    const source = Array.isArray(points) ? points : [];
    const count = Math.max(2, Number.isFinite(sampleCount) ? Math.floor(sampleCount) : 0);
    if (source.length === 0) {
        return [];
    }
    if (source.length === 1) {
        return Array.from({ length: count }, () => source[0].clone());
    }
    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < source.length; i += 1) {
        total += source[i].distanceTo(source[i - 1]);
        cumulative.push(total);
    }
    if (!(total > EPS)) {
        return Array.from({ length: count }, () => source[0].clone());
    }
    const out = [];
    let seg = 1;
    for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        const target = total * t;
        while (seg < cumulative.length - 1 && cumulative[seg] < target) {
            seg += 1;
        }
        const i0 = Math.max(0, seg - 1);
        const i1 = Math.min(source.length - 1, seg);
        const d0 = cumulative[i0];
        const d1 = cumulative[i1];
        if (!(d1 > d0)) {
            out.push(source[i1].clone());
            continue;
        }
        const localT = (target - d0) / (d1 - d0);
        out.push(source[i0].clone().lerp(source[i1], localT));
    }
    return out;
}
export function calculateBendAllowance(midRadius, thickness, kFactor, angleRad) {
    const neutralRadius = midRadius + (kFactor - 0.5) * thickness;
    return Math.abs(angleRad) * neutralRadius;
}
export function evaluateSheetMetal(tree) {
    if (!Number.isFinite(tree.thickness) || tree.thickness <= 0) {
        throw new Error('Sheet thickness must be a finite value greater than zero.');
    }
    const flats3D = [];
    const flats2D = [];
    const bends3D = [];
    const bends2D = [];
    const validatedFlats = new Set();
    const activePath = new Set();
    const flatIdStack = [];
    const walk = (flat, matrix3D, matrix2D) => {
        validateFlat(flat, validatedFlats);
        if (activePath.has(flat)) {
            const cyclePath = [...flatIdStack, flat.id].join(' -> ');
            throw new Error(`Cycle detected in flat tree: ${cyclePath}`);
        }
        activePath.add(flat);
        flatIdStack.push(flat.id);
        flats3D.push({ flat, matrix: matrix3D.clone() });
        flats2D.push({ flat, matrix: matrix2D.clone() });
        for (const parentEdge of flat.edges) {
            const bend = parentEdge.bend;
            if (!bend) {
                continue;
            }
            const angleRad = THREE.MathUtils.degToRad(bend.angleDeg);
            const allowance = calculateBendAllowance(bend.midRadius, tree.thickness, bend.kFactor, angleRad);
            const shift2D = outwardDirection(flat, parentEdge);
            const shiftMatrix = new THREE.Matrix4().makeTranslation(shift2D.x * allowance, shift2D.y * allowance, 0);
            const axisLocal = localBendAxisSigned(parentEdge, bend.midRadius, angleRad);
            const canonicalAxisDir = hasInteriorOnLeft(flat, parentEdge)
                ? axisLocal.dir.clone()
                : axisLocal.dir.clone().multiplyScalar(-1);
            const bendRotation = makeRotationAroundLine(axisLocal.start, canonicalAxisDir, angleRad);
            const parentEdgeWorld3D = transformPolyline(parentEdge.polyline, matrix3D);
            const parentEdgeWorld2D = transformPolyline(parentEdge.polyline, matrix2D);
            const parentNormal = new THREE.Vector3(0, 0, 1).transformDirection(matrix3D).normalize();
            const axisStartWorld = axisLocal.start.clone().applyMatrix4(matrix3D);
            const axisEndWorld = axisLocal.start
                .clone()
                .addScaledVector(canonicalAxisDir, axisLocal.length)
                .applyMatrix4(matrix3D);
            const worldShift = new THREE.Vector3(shift2D.x, shift2D.y, 0).transformDirection(matrix2D).normalize();
            for (const child of bend.children) {
                const childPlacement = placeChildFlat({
                    parentFlat: flat,
                    parentEdge,
                    child,
                    matrix3D,
                    matrix2D,
                    bendRotation,
                    shiftMatrix
                });
                const childNormal = new THREE.Vector3(0, 0, 1).transformDirection(childPlacement.matrix3D).normalize();
                const childEdgeWorldRaw = transformPolyline(childPlacement.childEdge.polyline, childPlacement.matrix3D);
                const childEdgeWorldSeed = childPlacement.reverseEdge ? [...childEdgeWorldRaw].reverse() : childEdgeWorldRaw;
                const childEdgeWorldReversed = [...childEdgeWorldSeed].reverse();
                const expectedChildEdgeWorld = transformPolyline(parentEdge.polyline, matrix3D.clone().multiply(bendRotation));
                const continuitySamples = Math.max(2, expectedChildEdgeWorld.length, childEdgeWorldSeed.length);
                const expectedForCheck = resamplePolyline3(expectedChildEdgeWorld, continuitySamples);
                const childForwardForCheck = resamplePolyline3(childEdgeWorldSeed, continuitySamples);
                const childReverseForCheck = resamplePolyline3(childEdgeWorldReversed, continuitySamples);
                const edgeMismatchForward = maxPointwiseDistance(expectedForCheck, childForwardForCheck);
                const edgeMismatchReverse = maxPointwiseDistance(expectedForCheck, childReverseForCheck);
                const childEdgeWorld = edgeMismatchReverse < edgeMismatchForward
                    ? childEdgeWorldReversed
                    : childEdgeWorldSeed;
                const edgeMismatch = Math.min(edgeMismatchForward, edgeMismatchReverse);
                if (edgeMismatch > 1e-5) {
                    throw new Error(`Bend "${bend.id}" failed continuity check between "${flat.id}" and "${child.flat.id}" ` +
                        `(edge mismatch ${edgeMismatch.toExponential(3)}).`);
                }
                bends3D.push({
                    bend,
                    parentFlatId: flat.id,
                    childFlatId: child.flat.id,
                    axisStart: axisStartWorld.clone(),
                    axisEnd: axisEndWorld.clone(),
                    parentEdgeWorld: parentEdgeWorld3D.map((point) => point.clone()),
                    childEdgeWorld,
                    parentNormal: parentNormal.clone(),
                    childNormal,
                    angleRad,
                    midRadius: bend.midRadius
                });
                bends2D.push({
                    bend,
                    parentFlatId: flat.id,
                    childFlatId: child.flat.id,
                    edgeWorld: parentEdgeWorld2D.map((point) => point.clone()),
                    shiftDir: [worldShift.x, worldShift.y],
                    allowance
                });
                walk(child.flat, childPlacement.matrix3D, childPlacement.matrix2D);
            }
        }
        flatIdStack.pop();
        activePath.delete(flat);
    };
    walk(tree.root, new THREE.Matrix4().identity(), new THREE.Matrix4().identity());
    return {
        flats3D,
        flats2D,
        bends3D,
        bends2D
    };
}
function placeChildFlat(params) {
    const childEdge = findEdge(params.child.flat, params.child.attachEdgeId);
    const parentLength = polylineLength(params.parentEdge.polyline);
    const childLength = polylineLength(childEdge.polyline);
    if (Math.abs(parentLength - childLength) > 1e-4) {
        throw new Error(`Attach edge length mismatch: parent edge "${params.parentEdge.id}" (${parentLength.toFixed(4)}) ` +
            `vs child edge "${childEdge.id}" (${childLength.toFixed(4)}).`);
    }
    const reverseEdge = typeof params.child.reverseEdge === 'boolean'
        ? params.child.reverseEdge
        : inferReverseEdge(params.parentFlat, params.parentEdge, params.child.flat, childEdge);
    const align = makeEdgeAlignment(params.parentEdge.polyline, childEdge.polyline, reverseEdge);
    const childMatrix3D = params.matrix3D.clone().multiply(params.bendRotation).multiply(align);
    const childMatrix2D = params.matrix2D.clone().multiply(params.shiftMatrix).multiply(align);
    return {
        childEdge,
        reverseEdge,
        matrix3D: childMatrix3D,
        matrix2D: childMatrix2D
    };
}

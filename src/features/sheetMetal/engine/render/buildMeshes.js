import * as THREE from 'three';
function normalizeLoop2(loop) {
    if (!Array.isArray(loop) || loop.length < 3) {
        return [];
    }
    const out = [];
    for (const point of loop) {
        const x = Number(point?.[0]);
        const y = Number(point?.[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        if (!out.length) {
            out.push([x, y]);
            continue;
        }
        const prev = out[out.length - 1];
        if (Math.hypot(prev[0] - x, prev[1] - y) <= 1e-8) {
            continue;
        }
        out.push([x, y]);
    }
    if (out.length >= 2) {
        const first = out[0];
        const last = out[out.length - 1];
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-8) {
            out.pop();
        }
    }
    return out.length >= 3 ? out : [];
}
function holeOutlineFromEntry(entry) {
    if (Array.isArray(entry)) {
        return entry;
    }
    if (entry && typeof entry === 'object' && Array.isArray(entry.outline)) {
        return entry.outline;
    }
    return null;
}
function collectHoleOutlines(flat) {
    const holes = Array.isArray(flat?.holes) ? flat.holes : [];
    const out = [];
    for (const hole of holes) {
        const outline = normalizeLoop2(holeOutlineFromEntry(hole));
        if (outline.length >= 3) {
            out.push(outline);
        }
    }
    return out;
}
function shapeFromFlat(flat) {
    const outline = normalizeLoop2(flat?.outline);
    const shape = new THREE.Shape(outline.map((point) => new THREE.Vector2(point[0], point[1])));
    const holeLoops = collectHoleOutlines(flat);
    for (const loop of holeLoops) {
        const path = new THREE.Path(loop.map((point) => new THREE.Vector2(point[0], point[1])));
        shape.holes.push(path);
    }
    return { shape, outline, holeLoops };
}
function transformedOutline(outline, matrix) {
    return outline.map((point) => new THREE.Vector3(point[0], point[1], 0).applyMatrix4(matrix));
}
function transformedLoops(flat, matrix) {
    const outer = transformedOutline(flat.outline, matrix);
    const holeLoops = collectHoleOutlines(flat).map((hole) => transformedOutline(hole, matrix));
    return { outer, holeLoops };
}
function cumulativeLengths(points) {
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
        lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    return lengths;
}
function samplePolyline(points, lengths, t) {
    if (points.length === 0) {
        return new THREE.Vector3();
    }
    if (points.length === 1 || t <= 0) {
        return points[0].clone();
    }
    if (t >= 1) {
        return points[points.length - 1].clone();
    }
    const total = lengths[lengths.length - 1];
    if (total <= 1e-8) {
        return points[0].clone();
    }
    const target = total * t;
    for (let i = 0; i < lengths.length - 1; i += 1) {
        if (target > lengths[i + 1]) {
            continue;
        }
        const segmentLength = lengths[i + 1] - lengths[i];
        if (segmentLength <= 1e-8) {
            return points[i].clone();
        }
        const alpha = (target - lengths[i]) / segmentLength;
        return points[i].clone().lerp(points[i + 1], alpha);
    }
    return points[points.length - 1].clone();
}
function resamplePolyline(points, sampleCount) {
    const lengths = cumulativeLengths(points);
    const sampled = [];
    for (let i = 0; i < sampleCount; i += 1) {
        const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
        sampled.push(samplePolyline(points, lengths, t));
    }
    return sampled;
}
function attachTriangulationOverlay(mesh, color, opacity) {
    const lineMaterial = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false
    });
    const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), lineMaterial);
    wireframe.renderOrder = 20;
    mesh.add(wireframe);
}
function buildBendSurfaceMesh(bend, material) {
    if (bend.parentEdgeWorld.length < 2 || bend.childEdgeWorld.length < 2) {
        return null;
    }
    const axis = bend.axisEnd.clone().sub(bend.axisStart);
    if (axis.lengthSq() <= 1e-8) {
        return null;
    }
    const axisDir = axis.normalize();
    const sampleCount = Math.max(2, bend.parentEdgeWorld.length, bend.childEdgeWorld.length);
    const parentEdge = resamplePolyline(bend.parentEdgeWorld, sampleCount);
    const childEdge = resamplePolyline(bend.childEdgeWorld, sampleCount);
    const sweepSteps = Math.max(16, Math.ceil(Math.abs(bend.angleRad) / THREE.MathUtils.degToRad(4)));
    const columnCount = sweepSteps + 1;
    const positions = [];
    const normals = [];
    const indices = [];
    const axisOrigin = bend.axisStart.clone();
    const rotateAroundAxis = (point, angle) => {
        const translated = point.clone().sub(axisOrigin);
        translated.applyAxisAngle(axisDir, angle);
        return translated.add(axisOrigin);
    };
    for (let i = 0; i < sampleCount; i += 1) {
        const parentPoint = parentEdge[i];
        const childPoint = childEdge[i];
        for (let j = 0; j <= sweepSteps; j += 1) {
            const t = j / sweepSteps;
            const angle = bend.angleRad * t;
            const position = rotateAroundAxis(parentPoint, angle);
            const normal = bend.parentNormal.clone().applyAxisAngle(axisDir, bend.angleRad * t).normalize();
            if (j === 0) {
                position.copy(parentPoint);
                normal.copy(bend.parentNormal);
            }
            else if (j === sweepSteps) {
                position.copy(childPoint);
                normal.copy(bend.childNormal);
            }
            positions.push(position.x, position.y, position.z);
            normals.push(normal.x, normal.y, normal.z);
        }
    }
    for (let i = 0; i < sampleCount - 1; i += 1) {
        for (let j = 0; j < sweepSteps; j += 1) {
            const a = i * columnCount + j;
            const b = a + 1;
            const c = (i + 1) * columnCount + j;
            const d = c + 1;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return new THREE.Mesh(geometry, material);
}
function buildBendVolumeMesh(bend, material, thickness) {
    if (bend.parentEdgeWorld.length < 2 || bend.childEdgeWorld.length < 2 || thickness <= 0) {
        return null;
    }
    const axis = bend.axisEnd.clone().sub(bend.axisStart);
    if (axis.lengthSq() <= 1e-8) {
        return null;
    }
    const axisDir = axis.normalize();
    const sampleCount = Math.max(2, bend.parentEdgeWorld.length, bend.childEdgeWorld.length);
    const parentEdge = resamplePolyline(bend.parentEdgeWorld, sampleCount);
    const childEdge = resamplePolyline(bend.childEdgeWorld, sampleCount);
    const sweepSteps = Math.max(16, Math.ceil(Math.abs(bend.angleRad) / THREE.MathUtils.degToRad(4)));
    const columns = sweepSteps + 1;
    const axisOrigin = bend.axisStart.clone();
    const halfT = thickness * 0.5;
    const rotateAroundAxis = (point, angle) => {
        const translated = point.clone().sub(axisOrigin);
        translated.applyAxisAngle(axisDir, angle);
        return translated.add(axisOrigin);
    };
    const topOffset = (i, j) => (i * columns + j) * 2;
    const botOffset = (i, j) => topOffset(i, j) + 1;
    const positions = [];
    const indices = [];
    for (let i = 0; i < sampleCount; i += 1) {
        const parentPoint = parentEdge[i];
        const childPoint = childEdge[i];
        for (let j = 0; j <= sweepSteps; j += 1) {
            const t = j / sweepSteps;
            const angle = bend.angleRad * t;
            const mid = rotateAroundAxis(parentPoint, angle);
            const normal = bend.parentNormal.clone().applyAxisAngle(axisDir, bend.angleRad * t).normalize();
            if (j === 0) {
                mid.copy(parentPoint);
                normal.copy(bend.parentNormal);
            }
            else if (j === sweepSteps) {
                mid.copy(childPoint);
                normal.copy(bend.childNormal);
            }
            const top = mid.clone().addScaledVector(normal, halfT);
            const bottom = mid.clone().addScaledVector(normal, -halfT);
            positions.push(top.x, top.y, top.z);
            positions.push(bottom.x, bottom.y, bottom.z);
        }
    }
    // Top and bottom skins
    for (let i = 0; i < sampleCount - 1; i += 1) {
        for (let j = 0; j < sweepSteps; j += 1) {
            const ta = topOffset(i, j);
            const tb = topOffset(i, j + 1);
            const tc = topOffset(i + 1, j);
            const td = topOffset(i + 1, j + 1);
            indices.push(ta, tc, tb);
            indices.push(tb, tc, td);
            const ba = botOffset(i, j);
            const bb = botOffset(i, j + 1);
            const bc = botOffset(i + 1, j);
            const bd = botOffset(i + 1, j + 1);
            indices.push(ba, bb, bc);
            indices.push(bb, bd, bc);
        }
    }
    // Caps at parent and child seams
    for (let i = 0; i < sampleCount - 1; i += 1) {
        const pTopA = topOffset(i, 0);
        const pTopB = topOffset(i + 1, 0);
        const pBotA = botOffset(i, 0);
        const pBotB = botOffset(i + 1, 0);
        indices.push(pTopA, pBotA, pTopB);
        indices.push(pTopB, pBotA, pBotB);
        const cTopA = topOffset(i, sweepSteps);
        const cTopB = topOffset(i + 1, sweepSteps);
        const cBotA = botOffset(i, sweepSteps);
        const cBotB = botOffset(i + 1, sweepSteps);
        indices.push(cTopA, cTopB, cBotA);
        indices.push(cTopB, cBotB, cBotA);
    }
    // Caps at edge ends
    for (let j = 0; j < sweepSteps; j += 1) {
        const aTop0 = topOffset(0, j);
        const aTop1 = topOffset(0, j + 1);
        const aBot0 = botOffset(0, j);
        const aBot1 = botOffset(0, j + 1);
        indices.push(aTop0, aTop1, aBot0);
        indices.push(aTop1, aBot1, aBot0);
        const bTop0 = topOffset(sampleCount - 1, j);
        const bTop1 = topOffset(sampleCount - 1, j + 1);
        const bBot0 = botOffset(sampleCount - 1, j);
        const bBot1 = botOffset(sampleCount - 1, j + 1);
        indices.push(bTop0, bBot0, bTop1);
        indices.push(bTop1, bBot0, bBot1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}
function edgeKey(a, b) {
    return `${a[0]},${a[1]}|${b[0]},${b[1]}`;
}
function bendEdgeKeySet(placement) {
    const keys = new Set();
    for (const edge of placement.flat.edges) {
        if (!edge.bend || edge.polyline.length < 2) {
            continue;
        }
        const first = edge.polyline[0];
        const last = edge.polyline[edge.polyline.length - 1];
        keys.add(edgeKey(first, last));
        keys.add(edgeKey(last, first));
    }
    return keys;
}
function buildFlatVolumeMesh(placement, material, thickness) {
    if (placement.flat.outline.length < 3 || thickness <= 0) {
        return null;
    }
    const contourLoop = normalizeLoop2(placement.flat.outline);
    if (contourLoop.length < 3) {
        return null;
    }
    const holeLoopsRaw = collectHoleOutlines(placement.flat);
    const contour = contourLoop.map((point) => new THREE.Vector2(point[0], point[1]));
    const holes = holeLoopsRaw.map((loop) => loop.map((point) => new THREE.Vector2(point[0], point[1])));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
    if (triangles.length === 0) {
        return null;
    }
    const halfT = thickness * 0.5;
    const loops = [contourLoop, ...holeLoopsRaw];
    const loopOffsets = [];
    let pointCount = 0;
    for (const loop of loops) {
        loopOffsets.push(pointCount);
        pointCount += loop.length;
    }
    const positions = [];
    const indices = [];
    for (const loop of loops) {
        for (const point of loop) {
            const top = new THREE.Vector3(point[0], point[1], halfT).applyMatrix4(placement.matrix);
            positions.push(top.x, top.y, top.z);
        }
    }
    for (const loop of loops) {
        for (const point of loop) {
            const bottom = new THREE.Vector3(point[0], point[1], -halfT).applyMatrix4(placement.matrix);
            positions.push(bottom.x, bottom.y, bottom.z);
        }
    }
    for (const tri of triangles) {
        indices.push(tri[0], tri[1], tri[2]);
        indices.push(pointCount + tri[0], pointCount + tri[2], pointCount + tri[1]);
    }
    const bendEdges = bendEdgeKeySet(placement);
    const outerOffset = loopOffsets[0];
    for (let i = 0; i < contourLoop.length; i += 1) {
        const next = (i + 1) % contourLoop.length;
        const a = contourLoop[i];
        const b = contourLoop[next];
        if (bendEdges.has(edgeKey(a, b))) {
            continue;
        }
        const topA = outerOffset + i;
        const topB = outerOffset + next;
        const botA = pointCount + topA;
        const botB = pointCount + topB;
        indices.push(topA, botA, topB);
        indices.push(topB, botA, botB);
    }
    for (let loopIndex = 1; loopIndex < loops.length; loopIndex += 1) {
        const hole = loops[loopIndex];
        const offset = loopOffsets[loopIndex];
        for (let i = 0; i < hole.length; i += 1) {
            const next = (i + 1) % hole.length;
            const topA = offset + i;
            const topB = offset + next;
            const botA = pointCount + topA;
            const botB = pointCount + topB;
            indices.push(topA, botA, topB);
            indices.push(topB, botA, botB);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}
function buildAllowanceBandMesh(bend, material) {
    if (bend.edgeWorld.length < 2 || bend.allowance <= 0) {
        return null;
    }
    const shift = new THREE.Vector2(bend.shiftDir[0], bend.shiftDir[1]);
    if (shift.lengthSq() <= 1e-8) {
        return null;
    }
    shift.normalize().multiplyScalar(bend.allowance);
    const positions = [];
    const indices = [];
    for (let i = 0; i < bend.edgeWorld.length; i += 1) {
        const base = bend.edgeWorld[i];
        positions.push(base.x, base.y, 0);
        positions.push(base.x + shift.x, base.y + shift.y, 0);
    }
    for (let i = 0; i < bend.edgeWorld.length - 1; i += 1) {
        const a = i * 2;
        const b = a + 1;
        const c = (i + 1) * 2;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}
export function buildThreeDGroup(flats, bends, options = {}) {
    const group = new THREE.Group();
    const mode = options.mode ?? 'midplane';
    const thickness = Math.max(1e-4, options.thickness ?? 1);
    const showTriangulation = options.showTriangulation ?? false;
    for (const placement of flats) {
        const faceMaterial = new THREE.MeshStandardMaterial({
            color: placement.flat.color,
            side: THREE.DoubleSide,
            metalness: 0.15,
            roughness: 0.62,
            polygonOffset: mode === 'midplane',
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });
        if (mode === 'volume') {
            const volume = buildFlatVolumeMesh(placement, faceMaterial, thickness);
            if (volume) {
                if (showTriangulation) {
                    attachTriangulationOverlay(volume, 0x9fe7ff, 0.6);
                }
                group.add(volume);
            }
        }
        else {
            const flatShape = shapeFromFlat(placement.flat);
            if (flatShape.outline.length < 3) {
                continue;
            }
            const geometry = new THREE.ShapeGeometry(flatShape.shape);
            const positions = geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i += 1) {
                const point = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
                point.applyMatrix4(placement.matrix);
                positions.setXYZ(i, point.x, point.y, point.z);
            }
            positions.needsUpdate = true;
            geometry.computeVertexNormals();
            const midplane = new THREE.Mesh(geometry, faceMaterial);
            if (showTriangulation) {
                attachTriangulationOverlay(midplane, 0xc8f0ff, 0.75);
            }
            group.add(midplane);
            const bendEdges = bendEdgeKeySet(placement);
            const loops = [flatShape.outline, ...flatShape.holeLoops];
            for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
                const loop = loops[loopIndex];
                for (let i = 0; i < loop.length; i += 1) {
                    const a = loop[i];
                    const b = loop[(i + 1) % loop.length];
                    if (loopIndex === 0 && bendEdges.has(edgeKey(a, b))) {
                        continue;
                    }
                    const worldA = new THREE.Vector3(a[0], a[1], 0).applyMatrix4(placement.matrix);
                    const worldB = new THREE.Vector3(b[0], b[1], 0).applyMatrix4(placement.matrix);
                    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([worldA, worldB]), new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.8 })));
                }
            }
        }
    }
    for (const bend of bends) {
        const bendMaterial = new THREE.MeshStandardMaterial({
            color: bend.bend.color,
            side: THREE.DoubleSide,
            metalness: 0.12,
            roughness: 0.55
        });
        const mesh = mode === 'volume'
            ? buildBendVolumeMesh(bend, bendMaterial, thickness)
            : buildBendSurfaceMesh(bend, bendMaterial);
        if (mesh) {
            if (showTriangulation) {
                attachTriangulationOverlay(mesh, 0xffe9a8, 0.7);
            }
            group.add(mesh);
        }
    }
    return group;
}
export function buildTwoDGroup(flats, bends, options = {}) {
    const group = new THREE.Group();
    const showTriangulation = options.showTriangulation ?? false;
    for (const placement of flats) {
        const loops = transformedLoops(placement.flat, placement.matrix);
        if (loops.outer.length < 3) {
            continue;
        }
        const shape = new THREE.Shape(loops.outer.map((point) => new THREE.Vector2(point.x, point.y)));
        for (const hole of loops.holeLoops) {
            if (hole.length < 3) {
                continue;
            }
            shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, point.y))));
        }
        const face = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
            color: placement.flat.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.3
        }));
        if (showTriangulation) {
            attachTriangulationOverlay(face, 0xb6e4ff, 0.75);
        }
        group.add(face);
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(loops.outer), new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.9 })));
        for (const hole of loops.holeLoops) {
            if (hole.length < 2) {
                continue;
            }
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hole), new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.9 })));
        }
    }
    for (const bend of bends) {
        const material = new THREE.MeshBasicMaterial({
            color: bend.bend.color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.35
        });
        const band = buildAllowanceBandMesh(bend, material);
        if (band) {
            if (showTriangulation) {
                attachTriangulationOverlay(band, 0xfff4b8, 0.75);
            }
            group.add(band);
        }
    }
    return group;
}
export function fitCameraToGroup(camera, group, controlsTarget) {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) {
        return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (camera instanceof THREE.PerspectiveCamera) {
        const maxSize = Math.max(size.x, size.y, size.z);
        const distance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
        camera.position.set(center.x + distance, center.y + distance * 0.8, center.z + distance);
        camera.near = Math.max(0.1, distance / 200);
        camera.far = distance * 20;
        camera.updateProjectionMatrix();
    }
    else {
        const half = Math.max(size.x, size.y) * 0.65;
        camera.left = -half;
        camera.right = half;
        camera.top = half;
        camera.bottom = -half;
        camera.near = -2000;
        camera.far = 2000;
        camera.position.set(center.x, center.y, center.z + 300);
        camera.updateProjectionMatrix();
    }
    if (controlsTarget) {
        controlsTarget.copy(center);
    }
}

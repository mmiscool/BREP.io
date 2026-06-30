import * as THREE from 'three';

type BuildGroupOptions = {
    mode?: 'midplane' | 'volume' | string;
    showTriangulation?: boolean;
    thickness?: number;
};

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
function transformedOutline(outline, matrix) {
    return outline.map((point) => new THREE.Vector3(point[0], point[1], 0).applyMatrix4(matrix));
}
function transformedLoops(flat, matrix) {
    const outer = transformedOutline(flat.outline, matrix);
    const holeLoops = collectHoleOutlines(flat).map((hole) => transformedOutline(hole, matrix));
    return { outer, holeLoops };
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
export function buildTwoDGroup(flats, bends, options: BuildGroupOptions = {}) {
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

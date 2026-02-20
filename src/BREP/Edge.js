import * as THREE from "three";
import { CADmaterials } from "../UI/CADmaterials.js";
import { SelectionState } from "../UI/SelectionState.js";
import { Line2 } from "three/examples/jsm/Addons.js";

export class Edge extends Line2 {
    constructor(geometry) {
        super(geometry, CADmaterials.EDGE.BASE);
        this.faces = [];
        this.name = null;
        this.type = 'EDGE';
        this.renderOrder = 2;
        this.closedLoop = false;
        SelectionState.attach(this);
    }

    // Total polyline length in world space
    length() {
        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        let total = 0;

        // Prefer positions from visualize() payload
        const pts = this.userData && Array.isArray(this.userData.polylineLocal)
            ? this.userData.polylineLocal
            : null;

        const addSeg = (ax, ay, az, bx, by, bz) => {
            tmpA.set(ax, ay, az).applyMatrix4(this.matrixWorld);
            tmpB.set(bx, by, bz).applyMatrix4(this.matrixWorld);
            total += tmpA.distanceTo(tmpB);
        };

        if (pts && pts.length >= 2) {
            for (let i = 0; i < pts.length - 1; i++) {
                const p = pts[i];
                const q = pts[i + 1];
                addSeg(p[0], p[1], p[2], q[0], q[1], q[2]);
            }
            return total;
        }

        // Fallback: read from geometry positions if available
        const pos = this.geometry && this.geometry.getAttribute && this.geometry.getAttribute('position');
        if (pos && pos.itemSize === 3 && pos.count >= 2) {
            for (let i = 0; i < pos.count - 1; i++) {
                addSeg(
                    pos.getX(i), pos.getY(i), pos.getZ(i),
                    pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)
                );
            }
            return total;
        }

        return 0;
    }

    points(applyWorld = true) {
        // Return an array of {x,y,z} points along the polyline.
        // Prefer polylineLocal from userData (installed by visualize), else fallback to geometry positions.
        const tmp = new THREE.Vector3();
        const out = [];

        const pts = this.userData && Array.isArray(this.userData.polylineLocal)
            ? this.userData.polylineLocal
            : null;

        if (pts && pts.length) {
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                tmp.set(p[0], p[1], p[2]);
                if (applyWorld) tmp.applyMatrix4(this.matrixWorld);
                out.push({ x: tmp.x, y: tmp.y, z: tmp.z });
            }
            return out;
        }

        const pos = this.geometry && this.geometry.getAttribute && this.geometry.getAttribute('position');
        if (pos && pos.itemSize === 3 && pos.count >= 1) {
            for (let i = 0; i < pos.count; i++) {
                tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
                if (applyWorld) tmp.applyMatrix4(this.matrixWorld);
                out.push({ x: tmp.x, y: tmp.y, z: tmp.z });
            }
        }
        return out;
    }

    collapseToPoint() {
        const solid = this.parentSolid || this.parent || null;
        const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
        if (!solid || !vp || vp.length < 3) return this;
        if (this?.userData?.auxEdge) return this;

        const vertexIndices = resolveEdgeVertexIndices(this, solid);
        if (!vertexIndices.length) return this;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let count = 0;

        for (const vi of vertexIndices) {
            const base = (vi * 3) | 0;
            if (base < 0 || base + 2 >= vp.length) continue;
            sumX += vp[base + 0];
            sumY += vp[base + 1];
            sumZ += vp[base + 2];
            count++;
        }
        if (!count) return this;

        const inv = 1 / count;
        const cx = sumX * inv;
        const cy = sumY * inv;
        const cz = sumZ * inv;

        for (const vi of vertexIndices) {
            const base = (vi * 3) | 0;
            if (base < 0 || base + 2 >= vp.length) continue;
            vp[base + 0] = cx;
            vp[base + 1] = cy;
            vp[base + 2] = cz;
        }

        const vertCount = (vp.length / 3) | 0;
        solid._vertKeyToIndex = new Map();
        for (let i = 0; i < vertCount; i++) {
            const base = i * 3;
            solid._vertKeyToIndex.set(`${vp[base + 0]},${vp[base + 1]},${vp[base + 2]}`, i);
        }
        solid._dirty = true;
        solid._faceIndex = null;
        try {
            if (solid._manifold && typeof solid._manifold.delete === "function") {
                solid._manifold.delete();
            }
        } catch { /* ignore stale-manifold cleanup errors */ }
        solid._manifold = null;

        try {
            if (typeof solid._manifoldize === "function") solid._manifoldize();
        } catch (error) {
            console.warn(`[Edge.collapseToPoint] Manifold rebuild failed for edge "${this.name || "UNKNOWN"}":`, error?.message || error);
        }
        try {
            if (typeof solid.visualize === "function") solid.visualize();
        } catch (error) {
            console.warn(`[Edge.collapseToPoint] Solid visualize failed for edge "${this.name || "UNKNOWN"}":`, error?.message || error);
        }

        return this;
    }


    setMetadata(metadata) {
        // call the approriate method in the parent solid
        if (this.parentSolid && typeof this.parentSolid.setEdgeMetadata === 'function') {
            this.parentSolid.setEdgeMetadata(this.name, metadata);
        }
        return this;
    }

    getMetadata() {
        // call the approriate method in the parent solid
        if (this.parentSolid && typeof this.parentSolid.getEdgeMetadata === 'function') {
            return this.parentSolid.getEdgeMetadata(this.name);
        }
        return null;
    }
}

function resolveEdgeVertexIndices(edgeObj, solid) {
    const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : null;
    if (!vp || vp.length < 3) return [];
    const maxIndex = ((vp.length / 3) | 0) - 1;

    let boundaries = [];
    try {
        boundaries = (typeof solid.getBoundaryEdgePolylines === "function")
            ? (solid.getBoundaryEdgePolylines() || [])
            : [];
    } catch { boundaries = []; }

    const boundary = findMatchingBoundaryPolyline(edgeObj, boundaries);
    if (boundary && Array.isArray(boundary.indices) && boundary.indices.length) {
        const out = [];
        const seen = new Set();
        for (const raw of boundary.indices) {
            const idx = Number(raw);
            if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) continue;
            if (seen.has(idx)) continue;
            seen.add(idx);
            out.push(idx);
        }
        if (out.length) return out;
    }

    return resolveIndicesFromPolylinePoints(edgeObj?.userData?.polylineLocal, vp);
}

function findMatchingBoundaryPolyline(edgeObj, boundaries) {
    if (!Array.isArray(boundaries) || boundaries.length === 0) return null;
    const edgeName = typeof edgeObj?.name === "string" && edgeObj.name ? edgeObj.name : null;
    if (edgeName) {
        const exact = boundaries.find((b) => b && b.name === edgeName);
        if (exact) return exact;
    }

    const faceA = edgeObj?.userData?.faceA;
    const faceB = edgeObj?.userData?.faceB;
    let candidates = boundaries;
    if (faceA && faceB) {
        candidates = boundaries.filter((b) => {
            if (!b) return false;
            const a = b.faceA;
            const c = b.faceB;
            return (a === faceA && c === faceB) || (a === faceB && c === faceA);
        });
        if (candidates.length === 1) return candidates[0];
    }

    const localPolyline = Array.isArray(edgeObj?.userData?.polylineLocal)
        ? edgeObj.userData.polylineLocal
        : null;
    if (!localPolyline || localPolyline.length < 2) return candidates[0] || null;

    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        const score = polylineEndpointScore(localPolyline, candidate?.positions);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

function polylineEndpointScore(a, b) {
    if (!Array.isArray(a) || a.length < 2 || !Array.isArray(b) || b.length < 2) return Infinity;
    const a0 = a[0];
    const a1 = a[a.length - 1];
    const b0 = b[0];
    const b1 = b[b.length - 1];
    if (!isPoint3(a0) || !isPoint3(a1) || !isPoint3(b0) || !isPoint3(b1)) return Infinity;
    const forward = pointDistanceSq(a0, b0) + pointDistanceSq(a1, b1);
    const reverse = pointDistanceSq(a0, b1) + pointDistanceSq(a1, b0);
    return Math.min(forward, reverse);
}

function resolveIndicesFromPolylinePoints(polylineLocal, vp) {
    if (!Array.isArray(polylineLocal) || polylineLocal.length === 0) return [];
    const vertCount = (vp.length / 3) | 0;
    const keyToIndex = new Map();
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        const key = `${vp[base + 0]},${vp[base + 1]},${vp[base + 2]}`;
        if (!keyToIndex.has(key)) keyToIndex.set(key, i);
    }

    const out = [];
    const seen = new Set();
    for (const p of polylineLocal) {
        if (!isPoint3(p)) continue;
        const key = `${p[0]},${p[1]},${p[2]}`;
        let idx = keyToIndex.get(key);
        if (idx === undefined) idx = findNearestVertexIndex(vp, p, 1e-9);
        if (!Number.isInteger(idx) || idx < 0 || seen.has(idx)) continue;
        seen.add(idx);
        out.push(idx);
    }
    return out;
}

function findNearestVertexIndex(vp, point, epsilon = 1e-9) {
    if (!Array.isArray(vp) || !isPoint3(point) || !Number.isFinite(epsilon) || epsilon <= 0) return -1;
    const thresholdSq = epsilon * epsilon;
    const vertCount = (vp.length / 3) | 0;
    let best = -1;
    let bestSq = thresholdSq;
    for (let i = 0; i < vertCount; i++) {
        const base = i * 3;
        const dx = vp[base + 0] - point[0];
        const dy = vp[base + 1] - point[1];
        const dz = vp[base + 2] - point[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq <= bestSq) {
            bestSq = distSq;
            best = i;
        }
    }
    return best;
}

function pointDistanceSq(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}

function isPoint3(p) {
    return Array.isArray(p) && p.length === 3
        && Number.isFinite(p[0])
        && Number.isFinite(p[1])
        && Number.isFinite(p[2]);
}

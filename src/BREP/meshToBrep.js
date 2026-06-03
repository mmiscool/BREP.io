import * as THREE from "three";
import { Solid } from "./BetterSolid.js";

/**
 * MeshToBrep: Builds a Solid from a triangle mesh by grouping triangles
 * into face labels based on the deflection angle between neighboring
 * triangle normals.
 *
 * Usage
 *   const solid = new MeshToBrep(geometryOrMesh, 15  deg );
 *   solid.name = "ImportedSTL";
 *   solid.visualize();
 *
 * Notes
 * - Accepts a THREE.BufferGeometry or a THREE.Mesh (uses its geometry).
 * - Triangles are welded to a grid (weldTolerance) so shared edges use
 *   identical vertex positions for manifoldization.
 * - If the input geometry has a `normal` attribute (STLLoader does),
 *   those normals are used for deflection. Otherwise, per-triangle
 *   normals are computed from positions.
 */
export class MeshToBrep extends Solid {
    /**
     * @param {THREE.BufferGeometry|THREE.Mesh} geometryOrMesh
     * @param {number} faceDeflectionAngle Degrees; neighbors within this angle join a face
     * @param {number} weldTolerance Vertex welding tolerance (units). Default 1e-5.
     * @param {object} [options]
     * @param {boolean} [options.extractPlanarFaces=false] Extract large planar regions before angle grouping
     * @param {number} [options.planarMinAreaPercent=5] Minimum planar region area as % of total mesh area
     * @param {number} [options.planarNormalToleranceDeg=1] Normal tolerance for planar extraction
     * @param {number} [options.planarDistanceTolerance] Absolute distance tolerance for planarity checks
     */
    constructor(geometryOrMesh, faceDeflectionAngle = 30, weldTolerance = 1e-5, options = {}) {
        super();
        const geom = (geometryOrMesh && geometryOrMesh.isMesh)
            ? geometryOrMesh.geometry
            : geometryOrMesh;
        if (!geom || !geom.isBufferGeometry) {
            throw new Error("MeshToBrep requires a THREE.BufferGeometry or THREE.Mesh");
        }

        const isOptionsObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
        const opts = isOptionsObject(options)
            ? options
            : (isOptionsObject(weldTolerance) ? weldTolerance : {});
        this.faceDeflectionAngle = Number(faceDeflectionAngle) || 0;
        this.weldTolerance = isOptionsObject(weldTolerance)
            ? 1e-5
            : (Number(weldTolerance) || 0);
        this.extractPlanarFaces = !!opts.extractPlanarFaces;
        this.planarMinAreaPercent = Number.isFinite(Number(opts.planarMinAreaPercent))
            ? Number(opts.planarMinAreaPercent)
            : 5;
        this.planarNormalToleranceDeg = Number.isFinite(Number(opts.planarNormalToleranceDeg))
            ? Number(opts.planarNormalToleranceDeg)
            : 1;
        this.planarDistanceTolerance = Number.isFinite(Number(opts.planarDistanceTolerance))
            ? Number(opts.planarDistanceTolerance)
            : null;

        // Build internal mesh arrays and face labels
        this._buildFromGeometry(geom);
    }

    toBrep() { return this; }

    _buildFromGeometry(geometry) {
        // Ensure we have positions
        const posAttr = geometry.getAttribute('position');
        if (!posAttr) throw new Error("Geometry has no 'position' attribute");

        const idxAttr = geometry.getIndex();
        const norAttr = geometry.getAttribute('normal');

        // Accessor helpers
        const getPos = (i, out) => {
            out.x = posAttr.getX(i);
            out.y = posAttr.getY(i);
            out.z = posAttr.getZ(i);
            return out;
        };
        const getTri = (t) => {
            if (idxAttr) {
                const i0 = idxAttr.getX(3 * t + 0) >>> 0;
                const i1 = idxAttr.getX(3 * t + 1) >>> 0;
                const i2 = idxAttr.getX(3 * t + 2) >>> 0;
                return [i0, i1, i2];
            } else {
                const base = 3 * t;
                return [base + 0, base + 1, base + 2];
            }
        };

        const triCount = idxAttr ? ((idxAttr.count / 3) | 0) : ((posAttr.count / 3) | 0);
        if (triCount <= 0) return;

        // Build canonical vertices using a weld grid so that shared edges truly share indices
        const q = Math.max(0, this.weldTolerance) || 0;
        const gridKey = (x, y, z) => {
            if (q <= 0) return `${x},${y},${z}`; // exact
            const rx = Math.round(x / q);
            const ry = Math.round(y / q);
            const rz = Math.round(z / q);
            return `${rx},${ry},${rz}`;
        };
        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        const tmpC = new THREE.Vector3();

        // Vertex dictionary and arrays
        const keyToIndex = new Map();
        const indexToPos = []; // [ [x,y,z], ... ] matching canonical vertices

        // Triangle data arrays
        const triVerts = new Array(triCount);
        const triNormals = new Array(triCount);

        // Grab per-vertex normals if available (STL facet normals replicated per-vertex)
        const getTriNormal = (t) => {
            if (norAttr && norAttr.count === posAttr.count) {
                const [i0] = getTri(t);
                // normals are constant per tri for STL; use any vertex's normal
                const nx = norAttr.getX(i0);
                const ny = norAttr.getY(i0);
                const nz = norAttr.getZ(i0);
                const n = new THREE.Vector3(nx, ny, nz);
                if (n.lengthSq() > 0) return n.normalize();
            }
            // Fallback: compute from positions
            const [a, b, c] = getTri(t);
            getPos(a, tmpA); getPos(b, tmpB); getPos(c, tmpC);
            tmpB.sub(tmpA); tmpC.sub(tmpA);
            const n = tmpB.clone().cross(tmpC);
            if (n.lengthSq() > 0) return n.normalize();
            return new THREE.Vector3(0, 0, 1);
        };

        // Build canonical vertices and triangle index triplets
        for (let t = 0; t < triCount; t++) {
            const [ia, ib, ic] = getTri(t);
            const a = getPos(ia, tmpA.clone());
            const b = getPos(ib, tmpB.clone());
            const c = getPos(ic, tmpC.clone());

            const keyA = gridKey(a.x, a.y, a.z);
            const keyB = gridKey(b.x, b.y, b.z);
            const keyC = gridKey(c.x, c.y, c.z);

            let ai = keyToIndex.get(keyA);
            if (ai === undefined) {
                ai = indexToPos.length;
                keyToIndex.set(keyA, ai);
                const [xr, yr, zr] = (q <= 0) ? [a.x, a.y, a.z] : [Math.round(a.x / q) * q, Math.round(a.y / q) * q, Math.round(a.z / q) * q];
                indexToPos.push([xr, yr, zr]);
            }
            let bi = keyToIndex.get(keyB);
            if (bi === undefined) {
                bi = indexToPos.length;
                keyToIndex.set(keyB, bi);
                const [xr, yr, zr] = (q <= 0) ? [b.x, b.y, b.z] : [Math.round(b.x / q) * q, Math.round(b.y / q) * q, Math.round(b.z / q) * q];
                indexToPos.push([xr, yr, zr]);
            }
            let ci = keyToIndex.get(keyC);
            if (ci === undefined) {
                ci = indexToPos.length;
                keyToIndex.set(keyC, ci);
                const [xr, yr, zr] = (q <= 0) ? [c.x, c.y, c.z] : [Math.round(c.x / q) * q, Math.round(c.y / q) * q, Math.round(c.z / q) * q];
                indexToPos.push([xr, yr, zr]);
            }

            triVerts[t] = [ai, bi, ci];
            triNormals[t] = getTriNormal(t);
        }

        // Geometric triangle normals/areas from welded vertices
        const triGeoNormals = new Array(triCount);
        const triAreas = new Array(triCount);
        let totalArea = 0;
        for (let t = 0; t < triCount; t++) {
            const [a, b, c] = triVerts[t];
            const pa = indexToPos[a];
            const pb = indexToPos[b];
            const pc = indexToPos[c];
            const abx = pb[0] - pa[0];
            const aby = pb[1] - pa[1];
            const abz = pb[2] - pa[2];
            const acx = pc[0] - pa[0];
            const acy = pc[1] - pa[1];
            const acz = pc[2] - pa[2];
            const nx = (aby * acz) - (abz * acy);
            const ny = (abz * acx) - (abx * acz);
            const nz = (abx * acy) - (aby * acx);
            const len = Math.hypot(nx, ny, nz);
            const area = 0.5 * len;
            triAreas[t] = Number.isFinite(area) ? area : 0;
            totalArea += triAreas[t];
            if (len > 1e-12) triGeoNormals[t] = new THREE.Vector3(nx / len, ny / len, nz / len);
            else triGeoNormals[t] = triNormals[t] ? triNormals[t].clone() : new THREE.Vector3(0, 0, 1);
        }

        // Build adjacency via undirected edge -> list of triangle indices
        const ek = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
        const edgeToTris = new Map();
        for (let t = 0; t < triCount; t++) {
            const [a, b, c] = triVerts[t];
            const edges = [[a, b], [b, c], [c, a]];
            for (const [u, v] of edges) {
                const key = ek(u, v);
                let list = edgeToTris.get(key);
                if (!list) { list = []; edgeToTris.set(key, list); }
                list.push(t);
            }
        }

        // Convert to per-triangle neighbor lists
        const neighbors = new Array(triCount);
        for (let i = 0; i < triCount; i++) neighbors[i] = [];
        for (const list of edgeToTris.values()) {
            if (list.length < 2) continue;
            // each pair of triangles sharing this edge are neighbors
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const a = list[i], b = list[j];
                    neighbors[a].push(b);
                    neighbors[b].push(a);
                }
            }
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < indexToPos.length; i++) {
            const p = indexToPos[i];
            if (!p) continue;
            if (p[0] < minX) minX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[2] < minZ) minZ = p[2];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] > maxY) maxY = p[1];
            if (p[2] > maxZ) maxZ = p[2];
        }
        const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);

        const triFaceName = new Array(triCount);
        const autoPlanarFaceNames = new Set();
        let faceCounter = 0;

        const dot = (a, b) => {
            const d = a.x * b.x + a.y * b.y + a.z * b.z;
            const la = Math.hypot(a.x, a.y, a.z);
            const lb = Math.hypot(b.x, b.y, b.z);
            if (la === 0 || lb === 0) return 1; // treat degenerate as same
            return d / (la * lb);
        };

        const maxAngleRad = Math.max(0, this.faceDeflectionAngle) * Math.PI / 180.0;
        const cosThresh = Math.cos(maxAngleRad);
        let smoothGroupAreas = null;

        const computeSmoothGroupAreas = () => {
            const groupAreas = new Float64Array(triCount);
            const visitedSmooth = new Uint8Array(triCount);
            for (let seed = 0; seed < triCount; seed++) {
                if (visitedSmooth[seed]) continue;
                const component = [];
                const queue = [seed];
                let qHead = 0;
                let areaSum = 0;
                visitedSmooth[seed] = 1;
                while (qHead < queue.length) {
                    const t = queue[qHead++];
                    component.push(t);
                    areaSum += triAreas[t] || 0;
                    const nrmT = triNormals[t];
                    for (const nb of neighbors[t]) {
                        if (visitedSmooth[nb]) continue;
                        const nrmN = triNormals[nb];
                        if (dot(nrmT, nrmN) >= cosThresh) {
                            visitedSmooth[nb] = 1;
                            queue.push(nb);
                        }
                    }
                }
                for (let i = 0; i < component.length; i++) {
                    groupAreas[component[i]] = areaSum;
                }
            }
            return groupAreas;
        };

        // Optional planar pre-pass: lock in large planar connected regions as faces first.
        let planarMergeCos = null;
        let planarMergeDistTol = null;
        if (this.extractPlanarFaces && totalArea > 0) {
            const pct = Math.max(0, Math.min(100, Number(this.planarMinAreaPercent) || 0));
            const minPlanarArea = totalArea * (pct / 100);
            if (minPlanarArea > 0) {
                const normalTolDeg = Math.max(0, Number(this.planarNormalToleranceDeg) || 0);
                const planarCos = Math.cos(normalTolDeg * Math.PI / 180.0);
                const distTol = Number.isFinite(this.planarDistanceTolerance)
                    ? Math.max(0, Number(this.planarDistanceTolerance))
                    : Math.max(this.weldTolerance * 4, diag * 1e-6, 1e-9);
                planarMergeCos = planarCos;
                planarMergeDistTol = Math.max(distTol * 4, this.weldTolerance * 8, diag * 4e-6, 1e-9);
                const planarLocked = new Uint8Array(triCount);
                const planarVisitToken = new Uint32Array(triCount);
                let planarVisitRun = 1;
                const beginPlanarVisitRun = () => {
                    planarVisitRun += 1;
                    if (planarVisitRun === 0xffffffff) {
                        planarVisitToken.fill(0);
                        planarVisitRun = 1;
                    }
                    return planarVisitRun;
                };

                const triIsCoplanar = (triIndex, planeNormal, planeD) => {
                    const n = triGeoNormals[triIndex];
                    if (Math.abs(dot(planeNormal, n)) < planarCos) return false;
                    const [ia, ib, ic] = triVerts[triIndex];
                    const pa = indexToPos[ia];
                    const pb = indexToPos[ib];
                    const pc = indexToPos[ic];
                    const da = Math.abs((planeNormal.x * pa[0]) + (planeNormal.y * pa[1]) + (planeNormal.z * pa[2]) + planeD);
                    const db = Math.abs((planeNormal.x * pb[0]) + (planeNormal.y * pb[1]) + (planeNormal.z * pb[2]) + planeD);
                    const dc = Math.abs((planeNormal.x * pc[0]) + (planeNormal.y * pc[1]) + (planeNormal.z * pc[2]) + planeD);
                    return da <= distTol && db <= distTol && dc <= distTol;
                };

                smoothGroupAreas = computeSmoothGroupAreas();
                const allowLocalPlanarPatches = pct <= 5;
                const minMeaningfulPatchArea = totalArea * 0.00025;
                const localPlanarAreaFraction = 0.04;
                const shouldAcceptPlanarComponent = (component, areaSum, seedTriIndex) => {
                    if (areaSum >= minPlanarArea) return true;
                    if (!allowLocalPlanarPatches) return false;
                    if (!component || component.length < 2) return false;
                    if (areaSum < minMeaningfulPatchArea) return false;
                    const smoothArea = smoothGroupAreas ? Number(smoothGroupAreas[seedTriIndex] || 0) : 0;
                    if (!(smoothArea > 0)) return false;
                    return areaSum >= (smoothArea * localPlanarAreaFraction);
                };

                for (let seed = 0; seed < triCount; seed++) {
                    if (planarLocked[seed]) continue;
                    if (triAreas[seed] <= 0) continue;

                    const seedNormal = triGeoNormals[seed];
                    const [seedA] = triVerts[seed];
                    const p0 = indexToPos[seedA];
                    const planeD = -((seedNormal.x * p0[0]) + (seedNormal.y * p0[1]) + (seedNormal.z * p0[2]));
                    const runToken = beginPlanarVisitRun();
                    const queue = [seed];
                    const component = [seed];
                    let areaSum = triAreas[seed];
                    let qHead = 0;
                    planarVisitToken[seed] = runToken;

                    while (qHead < queue.length) {
                        const t = queue[qHead++];
                        for (const nb of neighbors[t]) {
                            if (planarLocked[nb]) continue;
                            if (planarVisitToken[nb] === runToken) continue;
                            planarVisitToken[nb] = runToken;
                            if (!triIsCoplanar(nb, seedNormal, planeD)) continue;
                            component.push(nb);
                            areaSum += triAreas[nb];
                            queue.push(nb);
                        }
                    }

                    if (shouldAcceptPlanarComponent(component, areaSum, seed)) {
                        const faceName = `STL_FACE_${++faceCounter}`;
                        autoPlanarFaceNames.add(faceName);
                        for (let i = 0; i < component.length; i++) {
                            const triIndex = component[i];
                            triFaceName[triIndex] = faceName;
                            planarLocked[triIndex] = 1;
                        }
                    }
                }
            }
        }

        // Region grow remaining faces by deflection angle between neighboring triangle normals
        const visited = new Uint8Array(triCount);
        for (let t = 0; t < triCount; t++) {
            if (triFaceName[t]) visited[t] = 1;
        }
        for (let seed = 0; seed < triCount; seed++) {
            if (visited[seed]) continue;
            const faceName = `STL_FACE_${++faceCounter}`;
            // BFS using pairwise deflection with the parent triangle
            const queue = [seed];
            let qHead = 0;
            visited[seed] = 1;
            triFaceName[seed] = faceName;
            while (qHead < queue.length) {
                const t = queue[qHead++];
                const nrmT = triNormals[t];
                for (const nb of neighbors[t]) {
                    if (visited[nb]) continue;
                    const nrmN = triNormals[nb];
                    // If normals are close (angle <= threshold), grow region
                    if (dot(nrmT, nrmN) >= cosThresh) {
                        visited[nb] = 1;
                        triFaceName[nb] = faceName;
                        queue.push(nb);
                    }
                }
            }
        }

        if (autoPlanarFaceNames.size > 0 && planarMergeCos !== null && planarMergeDistTol !== null) {
            const faceStats = new Map();
            for (let t = 0; t < triCount; t++) {
                const faceName = triFaceName[t];
                if (!faceName) continue;
                let stats = faceStats.get(faceName);
                if (!stats) {
                    stats = {
                        area: 0,
                        normal: new THREE.Vector3(),
                        centroid: new THREE.Vector3(),
                        triangles: [],
                    };
                    faceStats.set(faceName, stats);
                }
                const area = triAreas[t] || 0;
                stats.area += area;
                stats.normal.addScaledVector(triGeoNormals[t], area);
                const [ia, ib, ic] = triVerts[t];
                const pa = indexToPos[ia];
                const pb = indexToPos[ib];
                const pc = indexToPos[ic];
                stats.centroid.x += ((pa[0] + pb[0] + pc[0]) / 3) * area;
                stats.centroid.y += ((pa[1] + pb[1] + pc[1]) / 3) * area;
                stats.centroid.z += ((pa[2] + pb[2] + pc[2]) / 3) * area;
                stats.triangles.push(t);
            }
            for (const stats of faceStats.values()) {
                if (stats.area > 0) {
                    stats.normal.normalize();
                    stats.centroid.multiplyScalar(1 / stats.area);
                }
            }

            const parentFace = new Map();
            const findFace = (name) => {
                let root = parentFace.get(name) || name;
                while ((parentFace.get(root) || root) !== root) root = parentFace.get(root);
                let cur = name;
                while ((parentFace.get(cur) || cur) !== root) {
                    const next = parentFace.get(cur) || cur;
                    parentFace.set(cur, root);
                    cur = next;
                }
                return root;
            };
            const unionFace = (a, b) => {
                const ra = findFace(a);
                const rb = findFace(b);
                if (ra === rb) return;
                const sa = faceStats.get(ra) || faceStats.get(a);
                const sb = faceStats.get(rb) || faceStats.get(b);
                const root = (Number(sa?.area || 0) >= Number(sb?.area || 0)) ? ra : rb;
                const child = root === ra ? rb : ra;
                parentFace.set(child, root);
            };

            const facePlaneDistance = (stats, p) => (
                (stats.normal.x * (p[0] - stats.centroid.x)) +
                (stats.normal.y * (p[1] - stats.centroid.y)) +
                (stats.normal.z * (p[2] - stats.centroid.z))
            );
            const faceIsPlanarOn = (faceName, planeStats) => {
                const stats = faceStats.get(faceName);
                if (!stats || stats.normal.lengthSq() <= 0) return false;
                for (const triIndex of stats.triangles) {
                    const [ia, ib, ic] = triVerts[triIndex];
                    const pa = indexToPos[ia];
                    const pb = indexToPos[ib];
                    const pc = indexToPos[ic];
                    if (Math.abs(facePlaneDistance(planeStats, pa)) > planarMergeDistTol) return false;
                    if (Math.abs(facePlaneDistance(planeStats, pb)) > planarMergeDistTol) return false;
                    if (Math.abs(facePlaneDistance(planeStats, pc)) > planarMergeDistTol) return false;
                }
                return true;
            };
            const facesAreCoplanar = (faceA, faceB) => {
                const statsA = faceStats.get(faceA);
                const statsB = faceStats.get(faceB);
                if (!statsA || !statsB) return false;
                if (statsA.normal.lengthSq() <= 0 || statsB.normal.lengthSq() <= 0) return false;
                if (Math.abs(dot(statsA.normal, statsB.normal)) < planarMergeCos) return false;
                const areaA = Number(statsA.area || 0);
                const areaB = Number(statsB.area || 0);
                if (areaA > 0 && areaB > 0) {
                    const largerFace = areaA >= areaB ? faceA : faceB;
                    const smallerFace = largerFace === faceA ? faceB : faceA;
                    const largerStats = largerFace === faceA ? statsA : statsB;
                    const smallerStats = largerFace === faceA ? statsB : statsA;
                    if (smallerStats.area <= largerStats.area * 0.2) {
                        return faceIsPlanarOn(smallerFace, largerStats);
                    }
                }
                return faceIsPlanarOn(faceA, statsB) && faceIsPlanarOn(faceB, statsA);
            };

            for (const list of edgeToTris.values()) {
                if (list.length < 2) continue;
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        const faceA = triFaceName[list[i]];
                        const faceB = triFaceName[list[j]];
                        if (!faceA || !faceB || faceA === faceB) continue;
                        if (!autoPlanarFaceNames.has(faceA) && !autoPlanarFaceNames.has(faceB)) continue;
                        if (facesAreCoplanar(faceA, faceB)) unionFace(faceA, faceB);
                    }
                }
            }

            const mergedAutoPlanarFaceNames = new Set();
            for (let t = 0; t < triCount; t++) {
                const faceName = triFaceName[t];
                if (!faceName) continue;
                const root = findFace(faceName);
                triFaceName[t] = root;
            }
            for (const faceName of autoPlanarFaceNames) {
                mergedAutoPlanarFaceNames.add(findFace(faceName));
            }
            autoPlanarFaceNames.clear();
            for (const faceName of mergedAutoPlanarFaceNames) autoPlanarFaceNames.add(faceName);
        }

        // Author triangles into this Solid with their face labels
        for (let t = 0; t < triCount; t++) {
            const name = triFaceName[t] || `STL_FACE_${faceCounter + 1}`;
            const [a, b, c] = triVerts[t];
            const pa = indexToPos[a];
            const pb = indexToPos[b];
            const pc = indexToPos[c];
            this.addTriangle(name, pa, pb, pc);
        }

        // Mark faces that were explicitly extracted by the planar pre-pass so downstream
        // import segmentation can preserve them and only split the remaining regions.
        if (autoPlanarFaceNames.size > 0) {
            for (const faceName of autoPlanarFaceNames) {
                this.setFaceMetadata(faceName, {
                    source: 'MESH_TO_BREP',
                    importAutoPlanarGroup: true,
                });
            }
        }

        // Let downstream visualization build per-face meshes and edges
        // We'll leave winding correction/orientation to _manifoldize()
    }
}

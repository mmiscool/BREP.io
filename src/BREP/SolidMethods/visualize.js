import { SelectionState } from "../../UI/SelectionState.js";
import {
    hasOccShape,
} from "../OpenCascadeKernel.js";
import {
    getOccVisualizationCurveSampleCount,
    getOccVisualizationTriangulationOptions,
} from "../occTriangulationSettings.js";
import {
    CADmaterials,
    debugMode,
    Edge,
    Face,
    LineGeometry,
    THREE,
    Vertex
} from "../SolidShared.js";

function distance3(a, b) {
    return Math.hypot(
        Number(b?.[0] || 0) - Number(a?.[0] || 0),
        Number(b?.[1] || 0) - Number(a?.[1] || 0),
        Number(b?.[2] || 0) - Number(a?.[2] || 0),
    );
}

function interpolatePoint(a, b, t) {
    return [
        Number(a?.[0] || 0) + (Number(b?.[0] || 0) - Number(a?.[0] || 0)) * t,
        Number(a?.[1] || 0) + (Number(b?.[1] || 0) - Number(a?.[1] || 0)) * t,
        Number(a?.[2] || 0) + (Number(b?.[2] || 0) - Number(a?.[2] || 0)) * t,
    ];
}

function resamplePolylineForVisualization(points, sampleCount, closedLoop = false) {
    const src = Array.isArray(points) ? points.filter(p => Array.isArray(p) && p.length === 3) : [];
    if (src.length < 2) return src;
    const count = Math.max(2, Math.floor(Number(sampleCount) || src.length));
    const path = src.slice();
    if (closedLoop && distance3(path[0], path[path.length - 1]) > 1e-12) path.push(path[0]);
    const cumulative = [0];
    for (let i = 1; i < path.length; i += 1) cumulative.push(cumulative[i - 1] + distance3(path[i - 1], path[i]));
    const total = cumulative[cumulative.length - 1];
    if (!(total > 1e-12)) return src;

    const out = [];
    const wanted = closedLoop ? count : Math.max(2, count);
    const denom = closedLoop ? wanted : Math.max(1, wanted - 1);
    let seg = 1;
    for (let i = 0; i < wanted; i += 1) {
        const target = total * (i / denom);
        while (seg < cumulative.length - 1 && cumulative[seg] < target) seg += 1;
        const aLen = cumulative[seg - 1];
        const bLen = cumulative[seg];
        const t = bLen > aLen ? (target - aLen) / (bLen - aLen) : 0;
        out.push(interpolatePoint(path[seg - 1], path[seg], t));
    }
    if (closedLoop && out.length && distance3(out[0], out[out.length - 1]) > 1e-12) out.push(out[0]);
    return out;
}

function circularizeClosedPolylineForVisualization(points, sampleCount) {
    const src = Array.isArray(points) ? points.filter(p => Array.isArray(p) && p.length === 3) : [];
    if (src.length < 4) return null;
    const open = distance3(src[0], src[src.length - 1]) <= 1e-12 ? src.slice(0, -1) : src.slice();
    if (open.length < 4) return null;

    const center = open.reduce((acc, p) => {
        acc[0] += Number(p[0] || 0);
        acc[1] += Number(p[1] || 0);
        acc[2] += Number(p[2] || 0);
        return acc;
    }, [0, 0, 0]).map(v => v / open.length);

    const radii = open.map(p => distance3(p, center));
    const radius = radii.reduce((sum, v) => sum + v, 0) / radii.length;
    if (!(radius > 1e-9)) return null;
    const maxRadialError = radii.reduce((max, v) => Math.max(max, Math.abs(v - radius)), 0);
    if (maxRadialError > Math.max(1e-6, radius * 0.03)) return null;

    const normal = [0, 0, 0];
    for (let i = 0; i < open.length; i += 1) {
        const a = open[i];
        const b = open[(i + 1) % open.length];
        normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
        normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
        normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const nLen = Math.hypot(normal[0], normal[1], normal[2]);
    if (!(nLen > 1e-12)) return null;
    normal[0] /= nLen; normal[1] /= nLen; normal[2] /= nLen;

    let u = [
        Number(open[0][0] || 0) - center[0],
        Number(open[0][1] || 0) - center[1],
        Number(open[0][2] || 0) - center[2],
    ];
    const uLen = Math.hypot(u[0], u[1], u[2]);
    if (!(uLen > 1e-12)) return null;
    u = u.map(v => v / uLen);
    const v = [
        normal[1] * u[2] - normal[2] * u[1],
        normal[2] * u[0] - normal[0] * u[2],
        normal[0] * u[1] - normal[1] * u[0],
    ];

    const count = Math.max(8, Math.floor(Number(sampleCount) || src.length));
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        out.push([
            center[0] + radius * (u[0] * c + v[0] * s),
            center[1] + radius * (u[1] * c + v[1] * s),
            center[2] + radius * (u[2] * c + v[2] * s),
        ]);
    }
    out.push(out[0]);
    return out;
}

function prepareAuxPolylineForVisualization(points, aux) {
    const closedLoop = !!aux?.closedLoop;
    const sampleCount = getOccVisualizationCurveSampleCount(closedLoop ? 65 : Math.max(2, points?.length || 2));
    if (closedLoop) {
        const circular = circularizeClosedPolylineForVisualization(points, sampleCount);
        if (circular) return circular;
    }
    if (closedLoop || (Array.isArray(points) && points.length > 2)) {
        return resamplePolylineForVisualization(points, sampleCount, closedLoop);
    }
    return points;
}





/**
 * Build a Three.js Group of per-face meshes for visualization.
 * - Each face label becomes its own Mesh with a single material.
 * - By default, generates a deterministic color per face name.
 * - Accepts a THREE reference or uses global window.THREE if available.
 *
 * @param {any} THREERef Optional reference to the three.js module/object.
 * @param {object} options Optional settings
 * @param {(name:string)=>any} options.materialForFace Optional factory returning a THREE.Material for a face
 * @param {boolean} [options.wireframe=false] Render materials as wireframe
 * @param {string} [options.name='Solid'] Name for the group
 * @param {boolean} [options.showEdges=true] Include boundary polylines between faces
 * @param {boolean} [options.forceAuthoring=false] Force authoring-based grouping instead of manifold mesh
 * @param {boolean} [options.authoringOnly=false] Skip manifold path entirely (always use authoring arrays)
 * @returns {any} THREE.Group containing one child Mesh per face
 */
export function visualize(options = {}) {
    // stack trace here
    //console.trace();



    const preservedDebugChildren = [];
    // Clear existing children and dispose resources
    for (let i = this.children.length - 1; i >= 0; i--) {
        const child = this.children[i];
        this.remove(child);
        if (child?.userData?.filletDebug === true) {
            preservedDebugChildren.push(child);
            continue;
        }
        if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
        const mat = child.material;
        if (mat) {
            if (Array.isArray(mat)) mat.forEach(m => m && m.dispose && m.dispose());
            else if (typeof mat.dispose === 'function') mat.dispose();
        }
    }

    const { showEdges = true, forceAuthoring = false, authoringOnly = false } = options;
    const occVisualizationOptions = hasOccShape(this) ? getOccVisualizationTriangulationOptions() : {};
    let faces; let usedFallback = false;
    if (!forceAuthoring && !authoringOnly) {
        try {
            faces = this.getFaces(false, occVisualizationOptions);
        } catch (err) {
            console.warn('[Solid.visualize] getFaces failed, falling back to raw arrays:', err?.message || err);
            usedFallback = true;
        }
    } else {
        usedFallback = true;
    }
    if (usedFallback || !faces) {
        // Fallback: group authored triangles by face name directly from arrays.
        // This enables visualization even if manifoldization failed, which helps debugging.
        const vp = this._vertProperties || [];
        const tv = this._triVerts || [];
        const ids = this._triIDs || [];
        const nameOf = (id) => this._idToFaceName && this._idToFaceName.get ? this._idToFaceName.get(id) : String(id);
        const nameToTris = new Map();
        const triCount = (tv.length / 3) | 0;
        for (let t = 0; t < triCount; t++) {
            const id = ids[t];
            const name = nameOf(id);
            if (!name) continue;
            let arr = nameToTris.get(name);
            if (!arr) { arr = []; nameToTris.set(name, arr); }
            const i0 = tv[t * 3 + 0], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
            const p0 = [vp[i0 * 3 + 0], vp[i0 * 3 + 1], vp[i0 * 3 + 2]];
            const p1 = [vp[i1 * 3 + 0], vp[i1 * 3 + 1], vp[i1 * 3 + 2]];
            const p2 = [vp[i2 * 3 + 0], vp[i2 * 3 + 1], vp[i2 * 3 + 2]];
            arr.push({ faceName: name, indices: [i0, i1, i2], p1: p0, p2: p1, p3: p2 });
        }
        faces = [];
        for (const [faceName, triangles] of nameToTris.entries()) faces.push({ faceName, triangles });
    }

    const buildGeometryForTriangles = (triangles) => {
        const positions = [];
        const indices = [];
        const sourceToLocal = new Map();
        const addVertex = (sourceIndex, point) => {
            if (Number.isFinite(sourceIndex)) {
                const existing = sourceToLocal.get(sourceIndex);
                if (existing != null) return existing;
            }
            const local = (positions.length / 3) | 0;
            positions.push(point[0], point[1], point[2]);
            if (Number.isFinite(sourceIndex)) sourceToLocal.set(sourceIndex, local);
            return local;
        };

        for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const points = [tri.p1, tri.p2, tri.p3];
            const triIndices = Array.isArray(tri.indices) && tri.indices.length >= 3
                ? tri.indices
                : [NaN, NaN, NaN];

            if (debugMode) {
                const coords = [
                    points[0][0], points[0][1], points[0][2],
                    points[1][0], points[1][1], points[1][2],
                    points[2][0], points[2][1], points[2][2],
                ];
                const hasInvalidCoords = coords.some(coord => !isFinite(coord));

                if (hasInvalidCoords) {
                    console.error(`Invalid triangle coordinates in face ${tri.faceName || ''}, triangle ${t}:`);
                    console.error('p0:', points[0], 'p1:', points[1], 'p2:', points[2]);
                    console.error('Triangle data:', tri);
                    continue;
                }

                try {
                    const ux = points[1][0] - points[0][0], uy = points[1][1] - points[0][1], uz = points[1][2] - points[0][2];
                    const vx = points[2][0] - points[0][0], vy = points[2][1] - points[0][1], vz = points[2][2] - points[0][2];
                    const nx = uy * vz - uz * vy;
                    const ny = uz * vx - ux * vz;
                    const nz = ux * vy - uy * vx;
                    const area2 = nx * nx + ny * ny + nz * nz;
                    if (area2 <= 1e-30) {
                        console.warn(`[Solid.visualize] Degenerate triangle in face ${tri.faceName || ''} @ index ${t}`);
                        console.warn('points:', { p0: points[0], p1: points[1], p2: points[2] });
                    }
                } catch { /* best-effort logging only */ }
            }

            indices.push(
                addVertex(Number(triIndices[0]), points[0]),
                addVertex(Number(triIndices[1]), points[1]),
                addVertex(Number(triIndices[2]), points[2]),
            );
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        return geom;
    };

    // Build Face meshes and index by name
    const faceMap = new Map();
    for (const { faceName, triangles } of faces) {
        if (!triangles.length) continue;
        const geom = buildGeometryForTriangles(triangles.map(tri => ({ ...tri, faceName })));

        const faceObj = new Face(geom);
        faceObj.name = faceName;
        if (this._kernel === 'opencascade' && faceObj.material?.clone) {
            const material = faceObj.material.clone();
            try { material.side = THREE.DoubleSide; } catch { /* ignore */ }
            try { material.flatShading = false; material.needsUpdate = true; } catch { /* ignore */ }
            faceObj.material = material;
        }
        faceObj.userData.faceName = faceName;
        faceObj.userData.__defaultMaterial = faceObj.material;
        try {
            const faceMeta = (typeof this.getFaceMetadata === 'function') ? this.getFaceMetadata(faceName) : null;
            if (faceMeta && typeof faceMeta === 'object') {
                faceObj.userData = { ...(faceObj.userData || {}), ...faceMeta };
            }
        } catch { /* ignore face metadata lookup errors */ }
        faceObj.parentSolid = this;
        // Tag with the owning feature for inspector/debug traceability.
        try { faceObj.owningFeatureID = this?.owningFeatureID || null; } catch { }
        faceMap.set(faceName, faceObj);
        this.add(faceObj);
    }

    if (showEdges) {
        if (!usedFallback) {
            let polylines = [];
            try { polylines = this.getBoundaryEdgePolylines(occVisualizationOptions) || []; } catch { polylines = []; }
            // Safety net: if manifold-based extraction yielded no edges (e.g., faceID missing),
            // fall back to authoring-based boundary extraction so we still visualize edges.
            if (!Array.isArray(polylines) || polylines.length === 0) {
                try { usedFallback = true; } catch { }
            }
            for (const e of polylines) {
                const positions = new Float32Array(e.positions.length * 3);
                let w = 0;
                for (let i = 0; i < e.positions.length; i++) {
                    const p = e.positions[i];
                    positions[w++] = p[0]; positions[w++] = p[1]; positions[w++] = p[2];
                }
                const g = new LineGeometry();
                g.setPositions(Array.from(positions));
                try { g.computeBoundingSphere(); } catch { }

                const edgeObj = new Edge(g);
                edgeObj.name = e.name;
                edgeObj.closedLoop = !!e.closedLoop;
                edgeObj.userData = {
                    faceA: e.faceA,
                    faceB: e.faceB,
                    polylineLocal: e.positions,
                    closedLoop: !!e.closedLoop,
                };
                edgeObj.userData.__defaultMaterial = edgeObj.material;
                annotateEdgeFromMetadata(edgeObj, this);
                // For convenience in feature code, mirror THREE's parent with an explicit handle
                edgeObj.parentSolid = this;
                const fa = faceMap.get(e.faceA);
                const fb = faceMap.get(e.faceB);
                if (fa) fa.edges.push(edgeObj);
                if (fb && fb !== fa) fb.edges.push(edgeObj);
                if (fa) edgeObj.faces.push(fa);
                if (fb && fb !== fa) edgeObj.faces.push(fb);
                this.add(edgeObj);
            }
        }
        if (usedFallback) {
            // Fallback boundary extraction from raw authoring arrays.
            try {
                const vp = this._vertProperties || [];
                const tv = this._triVerts || [];
                const ids = this._triIDs || [];
                const nv = (vp.length / 3) | 0;
                const triCount = (tv.length / 3) | 0;
                const NV = BigInt(Math.max(1, nv));
                const ukey = (a, b) => { const A = BigInt(a), B = BigInt(b); return A < B ? A * NV + B : B * NV + A; };
                const e2t = new Map(); // key -> [{id,a,b,tri}...]
                for (let t = 0; t < triCount; t++) {
                    const id = ids[t];
                    const base = t * 3;
                    const i0 = tv[base + 0] >>> 0, i1 = tv[base + 1] >>> 0, i2 = tv[base + 2] >>> 0;
                    const edges = [[i0, i1], [i1, i2], [i2, i0]];
                    for (let k = 0; k < 3; k++) {
                        const a = edges[k][0], b = edges[k][1];
                        const key = ukey(a, b);
                        let arr = e2t.get(key);
                        if (!arr) { arr = []; e2t.set(key, arr); }
                        arr.push({ id, a, b, tri: t });
                    }
                }
                // Create polyline objects between differing face IDs (authoring labels)
                const nameOf = (id) => this._idToFaceName && this._idToFaceName.get ? this._idToFaceName.get(id) : String(id);
                const pairToEdges = new Map(); // pairKey -> array of [u,v]
                for (const [, arr] of e2t.entries()) {
                    if (arr.length !== 2) continue;
                    const a = arr[0], b = arr[1];
                    if (a.id === b.id) continue;
                    const nameA = nameOf(a.id), nameB = nameOf(b.id);
                    const pair = nameA < nameB ? [nameA, nameB] : [nameB, nameA];
                    const pairKey = JSON.stringify(pair);
                    let list = pairToEdges.get(pairKey);
                    if (!list) { list = []; pairToEdges.set(pairKey, list); }
                    const u = Math.min(a.a, a.b), v = Math.max(a.a, a.b);
                    list.push([u, v]);
                }

                const addPolyline = (nameA, nameB, indices) => {
                    const visited = new Set();
                    const adj = new Map();
                    const ek = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
                    for (const [u, v] of indices) {
                        if (!adj.has(u)) adj.set(u, new Set());
                        if (!adj.has(v)) adj.set(v, new Set());
                        adj.get(u).add(v); adj.get(v).add(u);
                    }
                    const verts = (idx) => [vp[idx * 3 + 0], vp[idx * 3 + 1], vp[idx * 3 + 2]];
                    for (const [u0] of adj.entries()) {
                        // find start (degree 1) or any if loop
                        if ([...adj.get(u0)].length !== 1) continue;
                        const poly = [];
                        let u = u0, prev = -1;
                        while (true) {
                            const nbrs = [...adj.get(u)];
                            let v = nbrs[0];
                            if (v === prev && nbrs.length > 1) v = nbrs[1];
                            if (v === undefined) break;
                            const key = ek(u, v);
                            if (visited.has(key)) break;
                            visited.add(key);
                            poly.push(verts(u));
                            prev = u; u = v;
                            if (!adj.has(u)) break;
                        }
                        poly.push(verts(u));
                        if (poly.length >= 2) {
                            // Validate polyline coordinates before creating geometry
                            const flatCoords = poly.flat();
                            const hasInvalidCoords = flatCoords.some(coord => !isFinite(coord));

                            if (hasInvalidCoords) {
                                console.error('Invalid coordinates detected in edge polyline:');
                                console.error('Poly coordinates:', poly);
                                console.error('Flat coordinates:', flatCoords);
                                console.error('Face names:', nameA, '|', nameB);
                                continue; // Skip this edge
                            }

                            const g = new LineGeometry();
                            g.setPositions(flatCoords);
                            try { g.computeBoundingSphere(); } catch { }
                            const edgeObj = new Edge(g);
                            edgeObj.name = `${nameA}|${nameB}`;
                            edgeObj.closedLoop = false;
                            edgeObj.userData = {
                                faceA: nameA,
                                faceB: nameB,
                                polylineLocal: poly,
                                closedLoop: false,
                            };
                            edgeObj.userData.__defaultMaterial = edgeObj.material;
                            annotateEdgeFromMetadata(edgeObj, this);
                            edgeObj.parentSolid = this;
                            const fa = faceMap.get(nameA); const fb = faceMap.get(nameB);
                            if (fa) fa.edges.push(edgeObj); if (fb && fb !== fa) fb.edges.push(edgeObj);
                            if (fa) edgeObj.faces.push(fa); if (fb && fb !== fa) edgeObj.faces.push(fb);
                            try { edgeObj.computeLineDistances(); } catch { }
                            this.add(edgeObj);
                        }
                    }
                };
                for (const [pairKey, edgeList] of pairToEdges.entries()) {
                    const [a, b] = JSON.parse(pairKey);
                    addPolyline(a, b, edgeList);
                }
            } catch (_) { /* ignore fallback edge errors */ }
        }
    }

    // Add auxiliary edges stored on this solid (e.g., centerlines)
    try {
        if (Array.isArray(this._auxEdges) && this._auxEdges.length) {
            for (const aux of this._auxEdges) {
                const sourcePts = Array.isArray(aux?.points) ? aux.points.filter(p => Array.isArray(p) && p.length === 3) : [];
                if (sourcePts.length < 2) continue;
                const pts = prepareAuxPolylineForVisualization(sourcePts, aux);
                if (pts.length < 2) continue;
                const flat = [];
                for (const p of pts) { flat.push(p[0], p[1], p[2]); }

                // If the auxiliary edge is marked as a closed loop, ensure the
                // rendered polyline has an explicit closing segment by duplicating
                // the first point at the end if necessary. This affects rendering
                // only; stored userData remains unchanged for downstream consumers.
                if (aux?.closedLoop && pts.length >= 2) {
                    const f = pts[0];
                    const l = pts[pts.length - 1];
                    const dx = l[0] - f[0];
                    const dy = l[1] - f[1];
                    const dz = l[2] - f[2];
                    const needsClosure = (dx !== 0) || (dy !== 0) || (dz !== 0);
                    if (needsClosure) {
                        flat.push(f[0], f[1], f[2]);
                    }
                }

                // Validate auxiliary edge coordinates
                const hasInvalidCoords = flat.some(coord => !isFinite(coord));
                if (hasInvalidCoords) {
                    console.error('Invalid coordinates in auxiliary edge:', aux?.name || 'CENTERLINE');
                    console.error('Points:', pts);
                    console.error('Flat coordinates:', flat);
                    continue; // Skip this auxiliary edge
                }

                const g = new LineGeometry();
                g.setPositions(flat);
                try { g.computeBoundingSphere(); } catch { }
                const edgeObj = new Edge(g);
                edgeObj.name = aux?.name || 'CENTERLINE';
                edgeObj.closedLoop = !!aux?.closedLoop;
                const behavesLikeBoundary = !aux?.centerline && (!!aux?.faceA || !!aux?.faceB);
                edgeObj.userData = {
                    ...(edgeObj.userData || {}),
                    faceA: aux?.faceA || null,
                    faceB: aux?.faceB || null,
                    polylineLocal: pts,
                    polylineWorld: !!aux?.polylineWorld,
                    centerline: !!aux?.centerline,
                    auxEdge: !behavesLikeBoundary,
                };
                edgeObj.parentSolid = this;
                const fa = aux?.faceA ? faceMap.get(aux.faceA) : null;
                const fb = aux?.faceB ? faceMap.get(aux.faceB) : null;
                if (fa) fa.edges.push(edgeObj);
                if (fb && fb !== fa) fb.edges.push(edgeObj);
                if (fa) edgeObj.faces.push(fa);
                if (fb && fb !== fa) edgeObj.faces.push(fb);
                try {
                    const fallbackKey = behavesLikeBoundary ? 'SECTION' : 'OVERLAY';
                    const requestedKey = (aux?.materialKey || fallbackKey).toUpperCase();
                    const key = behavesLikeBoundary && requestedKey === 'BASE' ? 'SECTION' : requestedKey;
                    const edgeMats = CADmaterials?.EDGE || {};
                    const mat = edgeMats[key] || (key === 'OVERLAY' ? edgeMats.OVERLAY : null) || edgeMats.BASE;
                    let appliedMat = mat;
                    const wantsOverlay = key === 'OVERLAY' || key === 'THREAD_SYMBOLIC_MAJOR';
                    if (mat && wantsOverlay) {
                        const alreadyOverlay = mat.depthTest === false && mat.depthWrite === false;
                        if (!alreadyOverlay) {
                            const shared = Object.values(edgeMats).includes(mat);
                            let cloned = false;
                            if (shared && typeof mat.clone === 'function') {
                                try {
                                    appliedMat = mat.clone();
                                    cloned = !!appliedMat && appliedMat !== mat;
                                } catch { appliedMat = mat; cloned = false; }
                                if (cloned) {
                                    try {
                                        if (mat.resolution && appliedMat.resolution && typeof appliedMat.resolution.copy === 'function') {
                                            appliedMat.resolution.copy(mat.resolution);
                                        }
                                    } catch { }
                                }
                            }
                            if ((cloned || !shared) && appliedMat) {
                                try { appliedMat.depthTest = false; } catch { }
                                try { appliedMat.depthWrite = false; } catch { }
                            }
                        }
                    }
                    if (appliedMat) edgeObj.material = appliedMat;
                    if (appliedMat) SelectionState.setBaseMaterial(edgeObj, appliedMat, { force: false });
                    try { edgeObj.computeLineDistances(); } catch { }
                    edgeObj.renderOrder = behavesLikeBoundary ? 2 : 10020;
                } catch { }
                if (!edgeObj.userData) edgeObj.userData = {};
                edgeObj.userData.__defaultMaterial = edgeObj.material;
                this.add(edgeObj);
            }
        }
    } catch { /* ignore aux edge errors */ }

    // Helper function to generate deterministic vertex names based on meeting edges
    const generateVertexName = (position, meetingEdges) => {
        if (!meetingEdges || meetingEdges.length === 0) {
            return `VERTEX(${position[0]},${position[1]},${position[2]})`;
        }
        // Sort edge names for consistency, then join them
        const sortedEdgeNames = [...meetingEdges].sort();
        return `VERTEX[${sortedEdgeNames.join('+')}]`;
    };

    // Generate unique vertex objects at the start and end points of all edges
    try {
        const endpoints = new Map();
        const vertexToEdges = new Map(); // Track which edges meet at each vertex
        const usedVertexNames = new Set();

        // First pass: collect all endpoint positions and track which edges meet at each vertex
        for (const ch of this.children) {
            if (!ch || ch.type !== 'EDGE') continue;
            const poly = ch.userData && Array.isArray(ch.userData.polylineLocal) ? ch.userData.polylineLocal : null;
            if (!poly || poly.length === 0) continue;

            const edgeName = ch.name || 'UNNAMED_EDGE';
            const first = poly[0];
            const last = poly[poly.length - 1];

            const addEP = (p) => {
                if (!p || p.length !== 3) return;
                const k = `${Math.round(Number(p[0] || 0) * 1e8)},${Math.round(Number(p[1] || 0) * 1e8)},${Math.round(Number(p[2] || 0) * 1e8)}`;
                if (!endpoints.has(k)) endpoints.set(k, p);

                // Track which edges meet at this vertex position
                if (!vertexToEdges.has(k)) {
                    vertexToEdges.set(k, new Set());
                }
                vertexToEdges.get(k).add(edgeName);
            };

            addEP(first);
            addEP(last);
        }

        // Second pass: create vertices with deterministic names based on meeting edges
        if (endpoints.size) {
            for (const [positionKey, position] of endpoints.entries()) {
                try {
                    const meetingEdges = vertexToEdges.get(positionKey);
                    let vertexName = generateVertexName(position, meetingEdges ? Array.from(meetingEdges) : []);
                    if (usedVertexNames.has(vertexName)) {
                        let suffix = 1;
                        while (usedVertexNames.has(`${vertexName}[${suffix}]`)) {
                            suffix++;
                        }
                        vertexName = `${vertexName}[${suffix}]`;
                    }
                    usedVertexNames.add(vertexName);
                    this.add(new Vertex(position, { name: vertexName }));
                } catch { }
            }
        }
    } catch { /* best-effort vertices */ }

    if (preservedDebugChildren.length) {
        for (let i = preservedDebugChildren.length - 1; i >= 0; i--) {
            const child = preservedDebugChildren[i];
            if (!child) continue;
            this.add(child);
        }
    }

    return this;

}

function annotateEdgeFromMetadata(edgeObj, solid) {
    if (!edgeObj || !solid) return;
    const edgeName = edgeObj.name || null;
    if (!edgeName) return;
    let meta = null;
    try {
        meta = typeof solid.getEdgeMetadata === "function" ? solid.getEdgeMetadata(edgeName) : null;
    } catch { meta = null; }
    if (meta && typeof meta === "object") {
        edgeObj.userData = { ...(edgeObj.userData || {}), ...meta };
    }
    const seType = edgeObj.userData?.sheetMetalEdgeType;
    if (seType && seType !== "AMBIGUOUS") return;
    try {
        // If edge metadata not populated, see if adjacent faces (or face metadata by name) carry a sheet-metal type
        const faces = Array.isArray(edgeObj.faces) ? edgeObj.faces : [];
        const faceTypes = new Set();
        let hasSheetMeta = false;
        let hasABCandidate = false;
        for (const f of faces) {
            const t = resolveSheetTypeFromFace(f);
            if (t) hasSheetMeta = true;
            if (isSheetSurfaceType(t)) {
                faceTypes.add(t);
                hasABCandidate = true;
            }
        }
        // Try userData face names if no attached face objects
        if (!faceTypes.size && edgeObj.userData) {
            const names = [];
            if (edgeObj.userData.faceA) names.push(edgeObj.userData.faceA);
            if (edgeObj.userData.faceB) names.push(edgeObj.userData.faceB);
            for (const n of names) {
                const m = typeof solid.getFaceMetadata === "function" ? solid.getFaceMetadata(n) : null;
                const t = m?.sheetMetalFaceType;
                if (t) hasSheetMeta = true;
                if (isSheetSurfaceType(t)) {
                    faceTypes.add(t);
                    hasABCandidate = true;
                }
            }
        }
        if (faceTypes.size >= 1) {
            const t = [...faceTypes][0];
            edgeObj.userData = { ...(edgeObj.userData || {}), sheetMetalEdgeType: t };
            if (solid && typeof solid.setEdgeMetadata === "function") {
                solid.setEdgeMetadata(edgeName, { ...(solid.getEdgeMetadata(edgeName) || {}), sheetMetalEdgeType: t });
            }
        } else {
            // Fallback: derive from edge name segments via face metadata
            const parts = typeof edgeName === "string" ? edgeName.split("|") : [];
            let derivedType = null;
            for (const p of parts) {
                const meta = solid && typeof solid.getFaceMetadata === "function" ? solid.getFaceMetadata(p) : null;
                const t = meta?.sheetMetalFaceType;
                if (t) hasSheetMeta = true;
                if (isSheetSurfaceType(t)) {
                    hasABCandidate = true;
                    derivedType = t;
                    break;
                }
            }
            if (derivedType) {
                edgeObj.userData = { ...(edgeObj.userData || {}), sheetMetalEdgeType: derivedType };
                if (solid && typeof solid.setEdgeMetadata === "function") {
                    solid.setEdgeMetadata(edgeName, { ...(solid.getEdgeMetadata(edgeName) || {}), sheetMetalEdgeType: derivedType });
                }
            } else if (hasSheetMeta && hasABCandidate) {
                console.warn("[visualize] Edge has mixed or missing sheet metal face types", {
                    edge: edgeName,
                    faceTypes: Array.from(faceTypes),
                    faces: faces.map((f) => f?.name || f?.userData?.faceName || "UNKNOWN"),
                });
            }
        }
    } catch { /* ignore */ }
}

function normalizeSheetSurfaceType(rawType) {
    const t = String(rawType || "").trim().toUpperCase();
    if (t === "A" || t === "B") return t;
    return null;
}

function isSheetSurfaceType(rawType) {
    return normalizeSheetSurfaceType(rawType) != null;
}

function resolveSheetTypeFromFace(faceObj) {
    if (!faceObj || typeof faceObj !== "object") return null;
    const direct = normalizeSheetSurfaceType(faceObj?.userData?.sheetMetalFaceType);
    if (direct) return direct;
    const solid = faceObj?.parentSolid || faceObj?.parent || null;
    const faceName = faceObj?.name || faceObj?.userData?.faceName || null;
    if (!solid || !faceName || typeof solid.getFaceMetadata !== "function") return null;
    try {
        return normalizeSheetSurfaceType(solid.getFaceMetadata(faceName)?.sheetMetalFaceType);
    } catch {
        return null;
    }
}

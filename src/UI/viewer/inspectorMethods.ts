import * as THREE from 'three';

import { FloatingWindow } from '../FloatingWindow.js';
import { generateObjectUI } from '../objectDump.js';
import { TriangleDebuggerWindow } from '../triangleDebuggerWindow.js';

export const inspectorMethods: any = {
    enableDiagnosticPick() {
        this._diagPickOnce = true;
        // Do not modify the SelectionFilter; inspect will honor the current filter.
        try { this._toast('Click an item to inspect'); } catch { /* ignore diagnostic fallback failures */ }
    },

    // ----------------------------------------
    // Inspector panel (toggle + update-on-click)
    // ----------------------------------------

    toggleInspectorPanel() { this._inspectorOpen ? this._closeInspectorPanel() : this._openInspectorPanel(); },

    _getInspectorSelectionTarget() {
        const last = this._lastInspectorTarget;
        if (last && last.selected) return last;
        const scene = this.partHistory?.scene || this.scene || null;
        if (!scene || typeof scene.traverse !== 'function') return null;
        let found = null;
        scene.traverse((obj) => {
            if (found || !obj || !obj.selected) return;
            found = obj;
        });
        return found;
    },

    _openInspectorPanel() {
        if (this._inspectorOpen) return;
        this._ensureInspectorPanel();
        this._inspectorEl.style.display = 'flex';
        this._inspectorOpen = true;
        const target = this._getInspectorSelectionTarget();
        if (target) {
            try { this._updateInspectorFor(target); } catch { /* ignore diagnostic fallback failures */ }
            return;
        }
        try { this._setInspectorPlaceholder('Click an object in the scene to inspect.'); } catch { /* ignore diagnostic fallback failures */ }
    },

    _closeInspectorPanel() {
        if (!this._inspectorOpen) return;
        this._inspectorOpen = false;
        try { this._inspectorEl.style.display = 'none'; } catch { /* ignore diagnostic fallback failures */ }
    },

    _ensureInspectorPanel() {
        if (this._inspectorEl) return;
        // Create a floating window anchored bottom-left, resizable and draggable
        const height = Math.max(260, Math.floor((window?.innerHeight || 800) * 0.7));
        const fw = new FloatingWindow({
            title: 'Inspector',
            width: 520,
            height,
            x: 12,
            bottom: 12,
            shaded: false,
            onClose: () => this._closeInspectorPanel(),
        });
        // Header actions
        const btnTriangles = document.createElement('button');
        btnTriangles.className = 'fw-btn';
        btnTriangles.textContent = 'Triangle Debugger';
        btnTriangles.title = 'Open triangle debugger for the current selection';
        btnTriangles.addEventListener('click', () => {
            try { this._openTriangleDebugger(); }
            catch (e) { try { console.warn('Triangle debugger failed:', e); } catch { /* ignore diagnostic fallback failures */ } }
        });
        fw.addHeaderAction(btnTriangles);

        const btnDownload = document.createElement('button');
        btnDownload.className = 'fw-btn';
        btnDownload.textContent = 'Download JSON';
        btnDownload.addEventListener('click', () => {
            try {
                const json = this._lastInspectorDownload ? this._lastInspectorDownload() : (this._lastInspectorJSON || '{}');
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'diagnostics.json'; document.body.appendChild(a); a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
            } catch { /* ignore diagnostic fallback failures */ }
        });
        fw.addHeaderAction(btnDownload);

        // Wire content area
        const content = document.createElement('div');
        content.style.display = 'block';
        content.style.width = '100%';
        content.style.height = '100%';
        fw.content.appendChild(content);

        this._inspectorFW = fw;
        this._inspectorEl = fw.root;
        this._inspectorContent = content;
        this._lastInspectorDownload = null;
        this._lastInspectorJSON = '{}';
    },

    _setInspectorPlaceholder(msg) {
        if (!this._inspectorContent) return;
        this._inspectorContent.innerHTML = '';
        const p = document.createElement('div');
        p.textContent = msg || '';
        p.style.color = '#9aa4b2';
        p.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        p.style.opacity = '0.9';
        this._inspectorContent.appendChild(p);
        this._lastInspectorDownload = null;
        this._lastInspectorJSON = '{}';
    },

    _updateInspectorFor(target) {
        this._ensureInspectorPanel();
        this._lastInspectorTarget = target || null;
        this._lastInspectorSolid = this._findParentSolid(target);
        if (this._triangleDebugger && this._triangleDebugger.isOpen && this._triangleDebugger.isOpen()) {
            try { this._triangleDebugger.refreshTarget(target); } catch { /* ignore diagnostic fallback failures */ }
        }
        if (!target) { this._setInspectorPlaceholder('Nothing selected.'); return; }
        try {
            const { out, downloadFactory } = this._renderInspectorTree(target, this._inspectorContent, { title: 'Object Inspector' });
            // Persist download factory and raw JSON for header button
            this._lastInspectorDownload = downloadFactory;
            this._lastInspectorJSON = JSON.stringify(out, null, 2);
        } catch (e) {
            console.warn(e);
            this._setInspectorPlaceholder('Inspector failed. See console.');
        }
    },

    _renderInspectorTree(target, container, options: any = {}) {
        const title = options?.title || 'Object Inspector';
        const { out, downloadFactory } = this._buildDiagnostics(target);
        if (container) {
            container.innerHTML = '';
            const ui = generateObjectUI(out, {
                title,
                showTypes: true,
                collapseChildren: true,
                resolveReference: (context) => this._resolveInspectorReference(target, context),
                onReferenceNavigate: (ref) => this._openDetachedInspectorWindowFor(ref?.target || null),
            });
            container.appendChild(ui);
        }
        return { out, downloadFactory };
    },

    _formatInspectorTargetLabel(target) {
        const type = String(target?.type || target?.constructor?.name || 'Object').toUpperCase();
        const name = target?.name || target?.userData?.faceName || target?.userData?.edgeName || null;
        return name ? `${type} ${name}` : type;
    },

    _makeInspectorReference(node, label) {
        if (!node) return null;
        const fallbackLabel = this._formatInspectorTargetLabel(node);
        const text = String(label || fallbackLabel);
        return {
            target: node,
            label: text,
            title: `Open ${text} in a new inspector window`,
        };
    },

    _nodeHasName(node, expectedName) {
        if (!node || !expectedName) return false;
        const names = [
            node?.name,
            node?.userData?.faceName,
            node?.userData?.edgeName,
            node?.userData?.vertexName,
            node?.userData?.name,
        ];
        for (const candidate of names) {
            if (typeof candidate === 'string' && candidate === expectedName) return true;
        }
        return false;
    },

    _findSceneNodeByTypeAndName(type, name, sourceTarget = null) {
        if (!type || !name) return null;
        const typeNorm = String(type).toUpperCase();
        const roots = [];
        const solid = this._findParentSolid(sourceTarget);
        if (solid) roots.push(solid);
        if (sourceTarget) roots.push(sourceTarget);
        const scene = this.partHistory?.scene || this.scene || null;
        if (scene) roots.push(scene);
        const visited = new Set();
        for (const root of roots) {
            if (!root || visited.has(root)) continue;
            visited.add(root);
            let found = null;
            if (typeof root.traverse === 'function') {
                root.traverse((node) => {
                    if (found || !node) return;
                    if (String(node.type || '').toUpperCase() !== typeNorm) return;
                    if (this._nodeHasName(node, name)) found = node;
                });
            } else if (String(root?.type || '').toUpperCase() === typeNorm && this._nodeHasName(root, name)) {
                found = root;
            }
            if (found) return found;
        }
        return null;
    },

    _resolveInspectorReference(sourceTarget, context: any = {}) {
        if (!sourceTarget || !context) return null;
        const path = Array.isArray(context.path) ? context.path : [];
        const key = context.key;
        const value = context.value;
        if (!path.length || typeof value !== 'string' || !value) return null;
        const sourceType = String(sourceTarget.type || '').toUpperCase();
        const asIndex = (v) => Number.isInteger(v) ? v : -1;
        const faceRef = (name, direct = null) => {
            const directFace = (direct && String(direct.type || '').toUpperCase() === 'FACE') ? direct : null;
            const faceNode = directFace || this._findSceneNodeByTypeAndName('FACE', name, sourceTarget);
            return this._makeInspectorReference(faceNode, `FACE ${name}`);
        };
        const edgeRef = (name, direct = null) => {
            const directEdge = (direct && String(direct.type || '').toUpperCase() === 'EDGE') ? direct : null;
            const edgeNode = directEdge || this._findSceneNodeByTypeAndName('EDGE', name, sourceTarget);
            return this._makeInspectorReference(edgeNode, `EDGE ${name}`);
        };

        if (sourceType === 'EDGE') {
            if (path[0] === 'faces') {
                const faceIdx = asIndex(path[1]);
                const directFace = (Array.isArray(sourceTarget.faces) && faceIdx >= 0) ? sourceTarget.faces[faceIdx] : null;
                return faceRef(value, directFace);
            }
            return null;
        }

        if (sourceType === 'FACE') {
            if (path[0] === 'neighbors') {
                return faceRef(value);
            }
            if (path[0] === 'edges') {
                const edgeIdx = asIndex(path[1]);
                const edgeObj = (Array.isArray(sourceTarget.edges) && edgeIdx >= 0) ? sourceTarget.edges[edgeIdx] : null;
                if (path[2] === 'name') return edgeRef(value, edgeObj);
                if (path[2] === 'faces') {
                    const faceIdx = asIndex(path[3]);
                    const directFace = (Array.isArray(edgeObj?.faces) && faceIdx >= 0) ? edgeObj.faces[faceIdx] : null;
                    return faceRef(value, directFace);
                }
            }
        }

        if (sourceType === 'SOLID') {
            if ((key === 'faceName' || key === 'face') && typeof value === 'string') {
                return faceRef(value);
            }
            if (key === 'name' && path[0] === 'edges') {
                return edgeRef(value);
            }
        }

        if (key === 'faceName' && typeof value === 'string') return faceRef(value);
        return null;
    },

    _openDetachedInspectorWindowFor(target) {
        if (!target) return null;
        const windowIndex = this._inspectorLinkedWindowSeed++;
        const width = 520;
        const height = Math.max(260, Math.floor((window?.innerHeight || 800) * 0.62));
        const x = 28 + ((windowIndex % 8) * 26);
        const y = 52 + ((windowIndex % 8) * 20);
        let fw = null;
        let downloadFactory = null;
        let lastJSON = '{}';
        const title = `Inspector: ${this._formatInspectorTargetLabel(target)}`;
        fw = new FloatingWindow({
            title,
            width,
            height,
            x,
            y,
            shaded: false,
            onClose: () => {
                try { this._inspectorLinkedWindows.delete(fw); } catch { /* ignore diagnostic fallback failures */ }
                try { fw?.destroy?.(); } catch { /* ignore diagnostic fallback failures */ }
            },
        });
        this._inspectorLinkedWindows.add(fw);

        const btnDownload = document.createElement('button');
        btnDownload.className = 'fw-btn';
        btnDownload.textContent = 'Download JSON';
        btnDownload.addEventListener('click', () => {
            try {
                const json = downloadFactory ? downloadFactory() : lastJSON;
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'diagnostics.json'; document.body.appendChild(a); a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
            } catch { /* ignore diagnostic fallback failures */ }
        });
        fw.addHeaderAction(btnDownload);

        const content = document.createElement('div');
        content.style.display = 'block';
        content.style.width = '100%';
        content.style.height = '100%';
        fw.content.appendChild(content);

        try {
            const rendered = this._renderInspectorTree(target, content, { title: 'Object Inspector' });
            downloadFactory = rendered.downloadFactory;
            lastJSON = JSON.stringify(rendered.out, null, 2);
        } catch (error) {
            try { console.warn('Detached inspector render failed:', error); } catch { /* ignore diagnostic fallback failures */ }
            content.innerHTML = '';
            const msg = document.createElement('div');
            msg.textContent = 'Inspector failed. See console.';
            msg.style.color = '#9aa4b2';
            msg.style.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            content.appendChild(msg);
        }
        try { fw.bringToFront?.(); } catch { /* ignore diagnostic fallback failures */ }
        return fw;
    },

    _getTriangleDebugger() {
        if (!this._triangleDebugger) {
            this._triangleDebugger = new TriangleDebuggerWindow({ viewer: this });
        }
        return this._triangleDebugger;
    },

    _openTriangleDebugger() {
        try {
            const dbg = this._getTriangleDebugger();
            dbg.openFor(this._lastInspectorTarget || this._lastInspectorSolid || null);
        } catch (e) {
            try { console.warn('Triangle debugger open failed:', e); } catch { /* ignore diagnostic fallback failures */ }
        }
    },

    _findParentSolid(obj) {
        const isSolid = (node) => node && (String(node.type || '').toUpperCase() === 'SOLID');
        let cur = obj || null;
        if (cur && cur.parentSolid && isSolid(cur.parentSolid)) return cur.parentSolid;
        if (cur && cur.userData && cur.userData.parentSolid && isSolid(cur.userData.parentSolid)) return cur.userData.parentSolid;
        while (cur) {
            if (isSolid(cur)) return cur;
            if (cur.parentSolid && isSolid(cur.parentSolid)) return cur.parentSolid;
            if (cur.userData && cur.userData.parentSolid && isSolid(cur.userData.parentSolid)) return cur.userData.parentSolid;
            cur = cur.parent || null;
        }
        return null;
    },

    _round(n) { return Math.abs(n) < 1e-12 ? 0 : Number(n.toFixed(6)); },

    _edgePointsWorld(edge) {
        const pts = [];
        const v = new THREE.Vector3();
        const local = edge?.userData?.polylineLocal;
        const isWorld = !!(edge?.userData?.polylineWorld);
        if (Array.isArray(local) && local.length >= 2) {
            if (isWorld) {
                for (const p of local) pts.push([this._round(p[0]), this._round(p[1]), this._round(p[2])]);
            } else {
                for (const p of local) { v.set(p[0], p[1], p[2]).applyMatrix4(edge.matrixWorld); pts.push([this._round(v.x), this._round(v.y), this._round(v.z)]); }
            }
        } else {
            const pos = edge?.geometry?.getAttribute?.('position');
            if (pos && pos.itemSize === 3) {
                for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(edge.matrixWorld); pts.push([this._round(v.x), this._round(v.y), this._round(v.z)]); }
            }
        }
        return pts;
    },

    _buildDiagnostics(target) {
        const out: any = { type: target?.type || String(target?.constructor?.name || 'Object'), name: target?.name || null };
        let downloadFactory = null; // optional closure that returns full JSON text for download

        // Add owning feature information if available
        try {
            if (target.owningFeatureID) {
                out.owningFeatureID = target.owningFeatureID;
                out._owningFeatureFormatted = `Created by: ${target.owningFeatureID}`;
            } else if (target.parentSolid && target.parentSolid.owningFeatureID) {
                out.owningFeatureID = target.parentSolid.owningFeatureID;
                out._owningFeatureFormatted = `Created by: ${target.parentSolid.owningFeatureID}`;
            }
        } catch { /* ignore diagnostic fallback failures */ }

        if (target.type === 'FACE') {
            // Triangles via Solid API to ensure correct grouping
            let solid = target.parent; while (solid && solid.type !== 'SOLID') solid = solid.parent;
            const faceName = target.userData?.faceName || target.name;
            try {
                if (solid && typeof solid.getFace === 'function' && faceName) {
                    const tris = solid.getFace(faceName) || [];
                    const mapTri = (t) => ({
                        indices: Array.isArray(t.indices) ? t.indices : undefined,
                        p1: t.p1.map(this._round), p2: t.p2.map(this._round), p3: t.p3.map(this._round),
                        normal: (() => { const a = t.p1, b = t.p2, c = t.p3; const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]; const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz) || 1; return [this._round(nx / len), this._round(ny / len), this._round(nz / len)]; })(),
                        area: (() => { const a = t.p1, b = t.p2, c = t.p3; const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]; const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; return this._round(0.5 * Math.hypot(cx, cy, cz)); })()
                    });
                    const triFull = tris.map(mapTri);
                    try {
                        let triMax = 5000; // preview cap
                        if (typeof window !== 'undefined' && Number.isFinite((window as any).BREP_DIAG_TRI_MAX_FACE)) triMax = (window as any).BREP_DIAG_TRI_MAX_FACE | 0;
                        if (triMax < 0) triMax = triFull.length;
                        const count = Math.min(triFull.length, triMax);
                        // Make triangles lazy-loaded for performance
                        out._trianglesSummary = `${triFull.length} triangles (click to expand)`;
                        out._lazyTriangles = () => triFull.slice(0, count);
                        if (count < triFull.length) { out.trianglesTruncated = true; out.trianglesTotal = triFull.length; out.trianglesLimit = triMax; }
                    } catch {
                        out._trianglesSummary = `${triFull.length} triangles (click to expand)`;
                        out._lazyTriangles = () => triFull;
                    }
                    // Full JSON factory for download
                    downloadFactory = () => {
                        const full = JSON.parse(JSON.stringify(out));
                        full.triangles = triFull;
                        delete full.trianglesTruncated; delete full.trianglesLimit; delete full.trianglesTotal;
                        return JSON.stringify(full, null, 2);
                    };
                } else {
                    // Fallback: read triangles from the face geometry
                    const pos = target.geometry?.getAttribute?.('position');
                    if (pos) {
                        const v = new THREE.Vector3();
                        const triCount = (pos.count / 3) | 0;
                        const triFull = new Array(triCount);
                        for (let i = 0; i < triCount; i++) {
                            v.set(pos.getX(3 * i + 0), pos.getY(3 * i + 0), pos.getZ(3 * i + 0)).applyMatrix4(target.matrixWorld);
                            const p0 = [this._round(v.x), this._round(v.y), this._round(v.z)];
                            v.set(pos.getX(3 * i + 1), pos.getY(3 * i + 1), pos.getZ(3 * i + 1)).applyMatrix4(target.matrixWorld);
                            const p1 = [this._round(v.x), this._round(v.y), this._round(v.z)];
                            v.set(pos.getX(3 * i + 2), pos.getY(3 * i + 2), pos.getZ(3 * i + 2)).applyMatrix4(target.matrixWorld);
                            const p2 = [this._round(v.x), this._round(v.y), this._round(v.z)];
                            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
                            const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
                            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const len = Math.hypot(cx, cy, cz) || 1;
                            triFull[i] = { p1: p0, p2: p1, p3: p2, normal: [this._round(cx / len), this._round(cy / len), this._round(cz / len)], area: this._round(0.5 * Math.hypot(cx, cy, cz)) };
                        }
                        try {
                            let triMax = 5000; // preview cap for UI
                            if (typeof window !== 'undefined' && Number.isFinite((window as any).BREP_DIAG_TRI_MAX_FACE)) triMax = (window as any).BREP_DIAG_TRI_MAX_FACE | 0;
                            if (triMax < 0) triMax = triFull.length;
                            const count = Math.min(triFull.length, triMax);
                            out.triangles = triFull.slice(0, count);
                            if (count < triFull.length) { out.trianglesTruncated = true; out.trianglesTotal = triFull.length; out.trianglesLimit = triMax; }
                        } catch { out.triangles = triFull; }
                        downloadFactory = () => {
                            const full = JSON.parse(JSON.stringify(out));
                            full.triangles = triFull;
                            delete full.trianglesTruncated; delete full.trianglesLimit; delete full.trianglesTotal;
                            return JSON.stringify(full, null, 2);
                        };
                    }
                }
            } catch { /* ignore diagnostic fallback failures */ }

            // Edges connected to this face
            try {
                const edges = Array.isArray(target.edges) ? target.edges : [];
                out.edges = edges.map(e => ({ name: e.name || null, faces: (Array.isArray(e.faces) ? e.faces.map(f => f?.name || f?.userData?.faceName || null) : []), closedLoop: !!e.closedLoop, length: (typeof e.length === 'function' ? this._round(e.length()) : undefined), points: this._edgePointsWorld(e) }));
            } catch { out.edges = []; }

            // Lazy-load unique vertices to improve performance
            try {
                out._lazyUniqueVertices = () => {
                    const triangles = (out._lazyTriangles && typeof out._lazyTriangles === 'function') ? out._lazyTriangles() : [];
                    const uniq = new Map();
                    for (const tri of triangles) {
                        for (const P of [tri.p1, tri.p2, tri.p3]) {
                            const k = `${P[0]},${P[1]},${P[2]}`;
                            if (!uniq.has(k)) uniq.set(k, P);
                        }
                    }
                    return Array.from(uniq.values());
                };
            } catch { /* ignore diagnostic fallback failures */ }

            // Basic metrics and orientation hints
            try { const n = target.getAverageNormal?.(); if (n) out.averageNormal = [this._round(n.x), this._round(n.y), this._round(n.z)]; } catch { /* ignore diagnostic fallback failures */ }
            try {
                const a = target.surfaceArea?.();
                if (Number.isFinite(a)) {
                    out.surfaceArea = this._round(a);
                    // Make face area more prominent for easy reference
                    out._faceAreaFormatted = `${this._round(a)} units²`;
                }
            } catch { /* ignore diagnostic fallback failures */ }
            try {
                // Bounding box in world coords from triangle points (lazy-loaded)
                out._lazyBbox = () => {
                    const pts = []; for (const tri of out.triangles || []) { pts.push(tri.p1, tri.p2, tri.p3); }
                    if (pts.length) {
                        let min = [+Infinity, +Infinity, +Infinity], max = [-Infinity, -Infinity, -Infinity];
                        for (const p of pts) { if (p[0] < min[0]) min[0] = p[0]; if (p[1] < min[1]) min[1] = p[1]; if (p[2] < min[2]) min[2] = p[2]; if (p[0] > max[0]) max[0] = p[0]; if (p[1] > max[1]) max[1] = p[1]; if (p[2] > max[2]) max[2] = p[2]; }
                        return { min, max };
                    }
                    return null;
                };
            } catch { /* ignore diagnostic fallback failures */ }

            // Neighbor face names
            try {
                const faceName = target?.name || target?.userData?.faceName || null;
                let neighbors = new Set();
                const solid = target?.parentSolid || target?.userData?.parentSolid || null;
                if (solid && typeof solid.getBoundaryEdgePolylines === 'function' && faceName) {
                    const boundaries = solid.getBoundaryEdgePolylines() || [];
                    for (const poly of boundaries) {
                        const a = poly?.faceA;
                        const b = poly?.faceB;
                        if (a === faceName && b) neighbors.add(b);
                        else if (b === faceName && a) neighbors.add(a);
                    }
                }
                if (neighbors.size === 0 && solid && Array.isArray(solid.children)) {
                    // Fallback: use the face's edges to gather neighbor faces in the current scene graph
                    for (const edge of (target.edges || [])) {
                        if (!edge || !Array.isArray(edge.faces)) continue;
                        for (const f of edge.faces) {
                            const n = f?.name || f?.userData?.faceName || null;
                            if (n) neighbors.add(n);
                        }
                    }
                }
                if (faceName) neighbors.delete(faceName);
                out.neighbors = Array.from(neighbors);
            } catch { /* ignore diagnostic fallback failures */ }

            // Boundary loops if available from metadata
            try {
                const loops = target.userData?.boundaryLoopsWorld;
                if (Array.isArray(loops) && loops.length) {
                    out.boundaryLoops = loops.map(l => ({ isHole: !!l.isHole, pts: (Array.isArray(l.pts) ? l.pts : l).map(p => [this._round(p[0]), this._round(p[1]), this._round(p[2])]) }));
                }
            } catch { /* ignore diagnostic fallback failures */ }
        } else if (target.type === 'EDGE') {
            out.closedLoop = !!target.closedLoop;
            // Lazy-load points to improve performance
            out._lazyPoints = () => this._edgePointsWorld(target);
            try {
                const len = target.length();
                if (Number.isFinite(len)) {
                    out.length = this._round(len);
                    out._edgeLengthFormatted = `${this._round(len)} units`;
                }
            } catch { /* ignore diagnostic fallback failures */ }
            try { out.faces = (Array.isArray(target.faces) ? target.faces.map(f => f?.name || f?.userData?.faceName || null) : []); } catch { /* ignore diagnostic fallback failures */ }
        } else if (target.type === 'SOLID') {
            try {
                const faces = target.getFaces?.(false) || [];
                out.faceCount = faces.length;
                out.faces = faces.slice(0, 10).map(f => ({ faceName: f.faceName, triangles: (f.triangles || []).length }));
                if (faces.length > 10) out.facesTruncated = true;
            } catch { /* ignore diagnostic fallback failures */ }
            // Gather geometry arrays (prefer manifold mesh, fallback to authoring arrays)
            let arrays = null; let usedAuthoring = false;
            try {
                const mesh = target.getMesh?.();
                if (mesh && mesh.vertProperties && mesh.triVerts) {
                    arrays = { vp: Array.from(mesh.vertProperties), tv: Array.from(mesh.triVerts), ids: Array.isArray(mesh.faceID) ? Array.from(mesh.faceID) : [] };
                }
            } catch { /* ignore diagnostic fallback failures */ }
            if (!arrays) {
                try {
                    const vp = Array.isArray(target._vertProperties) ? target._vertProperties.slice() : [];
                    const tv = Array.isArray(target._triVerts) ? target._triVerts.slice() : [];
                    const ids = Array.isArray(target._triIDs) ? target._triIDs.slice() : [];
                    arrays = { vp, tv, ids }; usedAuthoring = true;
                } catch { /* ignore diagnostic fallback failures */ }
            }

            if (arrays) {
                const { vp, tv, ids } = arrays;
                out.meshStats = { vertices: (vp.length / 3) | 0, triangles: (tv.length / 3) | 0, source: usedAuthoring ? 'authoring' : 'manifold' };
                // BBox
                let min = [+Infinity, +Infinity, +Infinity], max = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < vp.length; i += 3) { const x = this._round(vp[i]), y = this._round(vp[i + 1]), z = this._round(vp[i + 2]); if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z; if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z; }
                if (min[0] !== Infinity) out.bbox = { min, max };

                // Triangles with points (cap output size in preview; full list available via Download)
                try {
                    const triCount = (tv.length / 3) | 0;
                    let triMax = 5000; // sane default for UI
                    try { if (typeof window !== 'undefined' && Number.isFinite((window as any).BREP_DIAG_TRI_MAX)) triMax = (window as any).BREP_DIAG_TRI_MAX | 0; } catch { /* ignore diagnostic fallback failures */ }
                    if (triMax < 0) triMax = triCount; // -1 => no cap
                    const count = Math.min(triCount, triMax);
                    const tris = new Array(count);
                    const nameOf = (id) => (target._idToFaceName && target._idToFaceName.get) ? target._idToFaceName.get(id) : undefined;
                    for (let t = 0; t < count; t++) {
                        const i0 = tv[3 * t + 0] >>> 0, i1 = tv[3 * t + 1] >>> 0, i2 = tv[3 * t + 2] >>> 0;
                        const p0 = [this._round(vp[3 * i0 + 0]), this._round(vp[3 * i0 + 1]), this._round(vp[3 * i0 + 2])];
                        const p1 = [this._round(vp[3 * i1 + 0]), this._round(vp[3 * i1 + 1]), this._round(vp[3 * i1 + 2])];
                        const p2 = [this._round(vp[3 * i2 + 0]), this._round(vp[3 * i2 + 1]), this._round(vp[3 * i2 + 2])];
                        let faceID = (Array.isArray(ids) && ids.length === triCount) ? ids[t] : undefined;
                        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
                        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
                        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nlen = Math.hypot(nx, ny, nz) || 1;
                        tris[t] = {
                            index: t,
                            faceID: faceID,
                            faceName: faceID !== undefined ? (nameOf(faceID) || null) : null,
                            p1: p0, p2: p1, p3: p2,
                            normal: [this._round(nx / nlen), this._round(ny / nlen), this._round(nz / nlen)],
                            area: this._round(0.5 * nlen)
                        };
                    }
                    // Make triangles lazy-loaded for performance
                    out._trianglesSummary = `${triCount} triangles (click to expand)`;
                    out._lazyTriangles = () => tris;
                    if (count < triCount) { out.trianglesTruncated = true; out.trianglesTotal = triCount; out.trianglesLimit = triMax; }
                    // Build full JSON on demand
                    downloadFactory = () => {
                        const trisFull = new Array(triCount);
                        const nameOf = (id) => (target._idToFaceName && target._idToFaceName.get) ? target._idToFaceName.get(id) : undefined;
                        for (let t = 0; t < triCount; t++) {
                            const i0 = tv[3 * t + 0] >>> 0, i1 = tv[3 * t + 1] >>> 0, i2 = tv[3 * t + 2] >>> 0;
                            const p0 = [this._round(vp[3 * i0 + 0]), this._round(vp[3 * i0 + 1]), this._round(vp[3 * i0 + 2])];
                            const p1 = [this._round(vp[3 * i1 + 0]), this._round(vp[3 * i1 + 1]), this._round(vp[3 * i1 + 2])];
                            const p2 = [this._round(vp[3 * i2 + 0]), this._round(vp[3 * i2 + 1]), this._round(vp[3 * i2 + 2])];
                            let faceID = (Array.isArray(ids) && ids.length === triCount) ? ids[t] : undefined;
                            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
                            const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
                            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nlen = Math.hypot(nx, ny, nz) || 1;
                            trisFull[t] = {
                                index: t,
                                faceID: faceID,
                                faceName: faceID !== undefined ? (nameOf(faceID) || null) : null,
                                p1: p0, p2: p1, p3: p2,
                                normal: [this._round(nx / nlen), this._round(ny / nlen), this._round(nz / nlen)],
                                area: this._round(0.5 * nlen)
                            };
                        }
                        const full = JSON.parse(JSON.stringify(out));
                        full.triangles = trisFull; delete full.trianglesTruncated; delete full.trianglesLimit; delete full.trianglesTotal;
                        return JSON.stringify(full, null, 2);
                    };
                } catch { /* ignore diagnostic fallback failures */ }

                // Non-manifold / topology diagnostics (undirected edge uses)
                try {
                    const nv = (vp.length / 3) | 0; const NV = BigInt(Math.max(1, nv));
                    const eKey = (a, b) => { const A = BigInt(a), B = BigInt(b); return A < B ? A * NV + B : B * NV + A; };
                    const e2c = new Map();
                    const triCount = (tv.length / 3) | 0;
                    const degenerate = []; const used = new Uint8Array(nv);
                    for (let t = 0; t < triCount; t++) {
                        const i0 = tv[3 * t + 0] >>> 0, i1 = tv[3 * t + 1] >>> 0, i2 = tv[3 * t + 2] >>> 0;
                        used[i0] = 1; used[i1] = 1; used[i2] = 1;
                        const ax = vp[3 * i0 + 0], ay = vp[3 * i0 + 1], az = vp[3 * i0 + 2];
                        const bx = vp[3 * i1 + 0], by = vp[3 * i1 + 1], bz = vp[3 * i1 + 2];
                        const cx = vp[3 * i2 + 0], cy = vp[3 * i2 + 1], cz = vp[3 * i2 + 2];
                        const ux = bx - ax, uy = by - ay, uz = bz - az; const vx = cx - ax, vy = cy - ay, vz = cz - az;
                        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const area2 = nx * nx + ny * ny + nz * nz;
                        if (area2 <= 1e-30) degenerate.push(t);
                        const add = (a, b) => { const k = eKey(Math.min(a, b), Math.max(a, b)); e2c.set(k, (e2c.get(k) || 0) + 1); };
                        add(i0, i1); add(i1, i2); add(i2, i0);
                    }
                    let gt2 = 0, lt2 = 0, eq1 = 0; const exGT = [], exLT = [], exB = [];
                    for (const [k, c] of e2c.entries()) {
                        if (c > 2) { gt2++; if (exGT.length < 12) exGT.push({ edge: k.toString(), uses: c }); }
                        else if (c < 2) { lt2++; if (c === 1) { eq1++; if (exB.length < 12) exB.push({ edge: k.toString(), uses: c }); } else { if (exLT.length < 12) exLT.push({ edge: k.toString(), uses: c }); } }
                    }
                    let isolated = 0; for (let i = 0; i < nv; i++) if (!used[i]) isolated++;
                    const isClosed = (eq1 === 0);
                    const hasNonManifoldEdges = (gt2 > 0);
                    const isManifold = isClosed && !hasNonManifoldEdges;
                    out.topology = {
                        isManifold,
                        closed: isClosed,
                        nonManifoldEdges: hasNonManifoldEdges ? gt2 : 0,
                        degenerateTriangles: { count: degenerate.length, examples: degenerate.slice(0, 12) },
                        edges: { gt2, lt2, boundary: eq1, examples_gt2: exGT, examples_lt2: exLT, examples_boundary: exB },
                        isolatedVertices: isolated
                    };
                    // Expose quick boolean at root for easy scanning
                    out.isManifold = isManifold;
                } catch { /* ignore diagnostic fallback failures */ }

                // Faces fallback from authoring arrays when manifold faces unavailable
                if (!out.faceCount || !Array.isArray(out.faces)) {
                    try {
                        const nameOf = (id) => (target._idToFaceName && target._idToFaceName.get) ? target._idToFaceName.get(id) : String(id);
                        const nameToTris = new Map();
                        const triCount = (tv.length / 3) | 0;
                        for (let t = 0; t < triCount; t++) {
                            const id = Array.isArray(ids) ? ids[t] : undefined;
                            const name = nameOf(id);
                            if (!name) continue;
                            let arr = nameToTris.get(name); if (!arr) { arr = []; nameToTris.set(name, arr); }
                            arr.push(t);
                        }
                        const facesRaw = [];
                        for (const [faceName, trisIdx] of nameToTris.entries()) facesRaw.push({ faceName, triangles: trisIdx.length });
                        facesRaw.sort((a, b) => b.triangles - a.triangles);
                        out.faceCount = facesRaw.length;
                        out.faces = facesRaw.slice(0, 20);
                        if (facesRaw.length > 20) out.facesTruncated = true;
                    } catch { /* ignore diagnostic fallback failures */ }
                }
            }

            try { const vol = target.volume?.(); if (Number.isFinite(vol)) out.volume = this._round(vol); } catch { /* ignore diagnostic fallback failures */ }
            try { const area = target.surfaceArea?.(); if (Number.isFinite(area)) out.surfaceArea = this._round(area); } catch { /* ignore diagnostic fallback failures */ }
        }

        return { out, downloadFactory: downloadFactory || (() => JSON.stringify(out, null, 2)) };
    },

    _showDiagnosticsFor(target) {
        const { out, downloadFactory } = this._buildDiagnostics(target);
        const json = JSON.stringify(out, null, 2);
        this._showModal('Selection Diagnostics', json, { onDownload: downloadFactory });
    },

    _toast(msg, ms = 1200) {
        try {
            const el = document.createElement('div');
            el.textContent = msg;
            el.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);background:#111c;backdrop-filter:blur(6px);color:#e5e7eb;padding:6px 10px;border:1px solid #2a3442;border-radius:8px;z-index:7;font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;';
            document.body.appendChild(el);
            setTimeout(() => { try { el.parentNode && el.parentNode.removeChild(el); } catch { /* ignore diagnostic fallback failures */ } }, ms);
        } catch { /* ignore diagnostic fallback failures */ }
    },

    _showModal(title, text, opts: any = {}) {
        let fw = null;
        const box = document.createElement('div');
        box.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;';
        const pre = document.createElement('textarea');
        pre.readOnly = true;
        pre.value = text || '';
        pre.style.cssText = 'flex:1;resize:none;background:#0f141a;color:#e5e7eb;border:0;padding:10px 12px;font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:pre;';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'fw-btn mtb-btn';
        copyBtn.textContent = 'Copy JSON';
        copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.value); copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy JSON', 900); } catch { /* ignore diagnostic fallback failures */ } });
        const dlBtn = document.createElement('button');
        dlBtn.className = 'fw-btn mtb-btn';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', () => {
            try {
                const content = (opts && typeof opts.onDownload === 'function') ? opts.onDownload() : pre.value;
                const blob = new Blob([content], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'diagnostics.json'; document.body.appendChild(a); a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
            } catch { /* ignore diagnostic fallback failures */ }
        });

        fw = new FloatingWindow({
            title: title || 'Diagnostics',
            width: Math.min(980, Math.max(360, window.innerWidth - 96)),
            height: Math.min(720, Math.max(320, Math.round(window.innerHeight * 0.7))),
            minWidth: 360,
            minHeight: 260,
            modal: true,
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => { try { fw?.destroy?.(); } catch { /* ignore diagnostic fallback failures */ } },
        });
        fw.addHeaderAction(copyBtn);
        fw.addHeaderAction(dlBtn);
        box.appendChild(pre);
        fw.content.appendChild(box);
    }

    // ----------------------------------------
    // Internal: Resize & Camera Frustum
    // ----------------------------------------
};

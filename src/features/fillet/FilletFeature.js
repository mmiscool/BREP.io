import { clearFilletCaches } from "../../BREP/fillets/fillet.js";
import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";
import { runSheetMetalCornerFillet } from "../sheetMetal/sheetMetalEngineBridge.js";

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the fillet feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["FACE", "EDGE"],
        multiple: true,
        default_value: null,
        hint: "Select faces (or an edge) to fillet along shared edges",
    },
    radius: {
        type: "number",
        step: 0.1,
        default_value: 1,
        hint: "Fillet radius",
    },
    resolution: {
        type: "number",
        step: 1,
        default_value: 32,
        hint: "Segments around the fillet tube circumference",
    },
    inflate: {
        type: "number",
        step: 0.1,
        default_value: 0.1,
        hint: "Grow the cutting solid by this amount (units). Keep tiny (e.g. 0.0005). Closed loops ignore inflation to avoid self‑intersection.",
    },
    direction: {
        type: "options",
        options: ["INSET", "OUTSET"],
        default_value: "INSET",
        hint: "Prefer fillet inside (INSET) or outside (OUTSET)",
    },
    combineEdges: {
        type: "boolean",
        default_value: false,
        hint: "Combine connected edges into a single fillet path when possible",
    },
    showTangentOverlays: {
        type: "boolean",
        default_value: false,
        hint: "Show pre-inflate tangent overlays on the fillet tube",
    },
    cleanupTinyFaceIslandsArea: {
        type: "number",
        step: 0.001,
        default_value: 0.01,
        hint: "Relabel tiny disconnected face islands below this area threshold (<= 0 disables).",
    },
    debug: {
        type: "boolean",
        default_value: false,
        hint: "Draw diagnostic vectors for section frames (u,v, bisector, tangency)",
    },
};

function normalizeSelectionToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    return raw.replace(/\[\d+\]$/, '');
}

function expandReferenceSelections(rawSelections, partHistory) {
    const out = [];
    const seenObjects = new Set();
    const unresolved = [];
    const pushObject = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (seenObjects.has(obj)) return;
        seenObjects.add(obj);
        out.push(obj);
    };

    const resolveByName = (name) => {
        if (!name || typeof partHistory?.getObjectByName !== 'function') return null;
        try {
            return partHistory.getObjectByName(name) || null;
        } catch {
            return null;
        }
    };

    for (const item of (Array.isArray(rawSelections) ? rawSelections : [])) {
        if (!item) continue;
        if (typeof item === 'object') {
            pushObject(item);
            continue;
        }
        const text = String(item || '').trim();
        if (!text) continue;
        const segments = text.includes('|') ? text.split('|') : [text];
        for (const segment of segments) {
            const normalized = normalizeSelectionToken(segment);
            if (!normalized) continue;
            const obj = resolveByName(normalized);
            if (obj) pushObject(obj);
            else unresolved.push(normalized);
        }
    }

    return { selections: out, unresolved };
}

function resolveSheetMetalCarrierFromSelections(rawSelections, partHistory) {
    const resolveByName = (name) => {
        if (!name || typeof partHistory?.getObjectByName !== 'function') return null;
        try {
            return partHistory.getObjectByName(name) || null;
        } catch {
            return null;
        }
    };
    const isSheetCarrier = (obj) => !!obj?.userData?.sheetMetalModel?.tree;

    const tokens = [];
    const collectTokens = (value) => {
        if (value == null) return;
        const text = String(value || '').trim();
        if (!text) return;
        const pieces = text.includes('|') ? text.split('|') : [text];
        for (const piece of pieces) {
            const normalized = normalizeSelectionToken(piece);
            if (!normalized) continue;
            tokens.push(normalized);
        }
    };
    const selections = Array.isArray(rawSelections) ? rawSelections : [];
    for (const item of selections) {
        if (item && typeof item === 'object') {
            const direct = item?.parentSolid;
            if (isSheetCarrier(direct)) return direct;
            let current = item;
            while (current && typeof current === 'object') {
                if (isSheetCarrier(current)) return current;
                current = current.parent || null;
            }
            collectTokens(item?.name);
            collectTokens(item?.userData?.edgeName);
            collectTokens(item?.userData?.faceName);
            continue;
        }
        if (typeof item !== 'string') continue;
        collectTokens(item);
    }

    for (const token of tokens) {
        const marker = ':FLAT:';
        const markerIndex = token.indexOf(marker);
        if (markerIndex <= 0) continue;
        const carrierName = token.slice(0, markerIndex);
        const resolved = resolveByName(carrierName);
        if (isSheetCarrier(resolved)) return resolved;
    }

    const scene = partHistory?.scene;
    if (scene && typeof scene.traverse === 'function') {
        const carriers = [];
        scene.traverse((obj) => {
            if (isSheetCarrier(obj)) carriers.push(obj);
        });
        if (carriers.length === 1) return carriers[0];
    }
    return null;
}

export class FilletFeature {
    static shortName = "F";
    static longName = "Fillet";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const edges = items
            .filter((it) => {
                const type = String(it?.type || '').toUpperCase();
                return type === 'EDGE' || type === 'FACE';
            })
            .map((it) => it?.name || it?.userData?.edgeName || it?.userData?.faceName)
            .filter((name) => !!name);
        if (!edges.length) return false;
        return { params: { edges } };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    uiFieldsTest(context) {
        const params = this.inputParams || context?.params || {};
        const dir = String(params?.direction || 'INSET').toUpperCase();
        return dir === 'INSET' ? ['combineEdges'] : [];
    }

    async run(partHistory) {
        console.log('[FilletFeature] Starting fillet run...', {
            featureID: this.inputParams?.featureID,
            direction: this.inputParams?.direction,
            combineEdges: this.inputParams?.combineEdges,
            radius: this.inputParams?.radius,
            resolution: this.inputParams?.resolution,
            inflate: this.inputParams?.inflate,
            showTangentOverlays: this.inputParams?.showTangentOverlays,
            cleanupTinyFaceIslandsArea: this.inputParams?.cleanupTinyFaceIslandsArea,
            debug: this.inputParams?.debug,
        });
        try { clearFilletCaches(); } catch { }
        const added = [];
        const removed = [];

        // Resolve inputs from sanitizeInputParams()
        const rawInputSelections = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const expanded = expandReferenceSelections(rawInputSelections, partHistory);
        const inputObjects = expanded.selections;
        const edgeObjs = collectEdgesFromSelection(inputObjects);
        const sheetCarrierFromRefs = resolveSheetMetalCarrierFromSelections(rawInputSelections, partHistory);

        let { solid: targetSolid, solids } = resolveSingleSolidFromEdges(edgeObjs);
        if (sheetCarrierFromRefs) {
            targetSolid = sheetCarrierFromRefs;
            solids = new Set([sheetCarrierFromRefs]);
        } else if (!targetSolid) {
            targetSolid = null;
        }
        if (!targetSolid) {
            if (solids.size > 1) {
                console.warn('[FilletFeature] Edges reference multiple solids; aborting fillet.', { solids: Array.from(solids).map(s => s?.name) });
            } else {
                console.warn('[FilletFeature] Edges do not reference a target solid; aborting fillet.', {
                    unresolvedRefs: expanded.unresolved,
                    rawSelectionCount: rawInputSelections.length,
                });
            }
            return { added: [], removed: [] };
        }
        console.log('[FilletFeature] Target solid resolved', {
            name: targetSolid?.name,
            edgeCount: edgeObjs.length,
            edgeNames: edgeObjs.map(e => e?.name).filter(Boolean),
        });

        const dir = String(this.inputParams.direction || 'INSET').toUpperCase();
        const r = Number(this.inputParams.radius);
        if (!Number.isFinite(r) || !(r > 0)) {
            console.warn('[FilletFeature] Invalid radius supplied; aborting.', { radius: this.inputParams.radius });
            return { added: [], removed: [] };
        }

        const fid = this.inputParams.featureID;

        const isSheetMetalCarrier = !!targetSolid?.userData?.sheetMetalModel?.tree;
        if (isSheetMetalCarrier) {
            const sheetResult = runSheetMetalCornerFillet({
                sourceCarrier: targetSolid,
                selections: rawInputSelections,
                edgeSelections: edgeObjs,
                radius: r,
                resolution: this.inputParams?.resolution,
                featureID: fid || "SM_FILLET",
                showFlatPattern: true,
            });
            this.persistentData = {
                ...(this.persistentData || {}),
                sheetMetalFilletSummary: sheetResult?.summary || null,
            };
            if (sheetResult?.root) {
                console.log('[FilletFeature] Sheet-metal corner fillet applied; replacing target solid.', {
                    featureID: fid,
                    appliedTargets: sheetResult?.summary?.applied || 0,
                    appliedCorners: sheetResult?.summary?.appliedCorners || 0,
                });
                added.push(sheetResult.root);
                removed.push(targetSolid);
            } else {
                console.warn('[FilletFeature] Sheet-metal corner fillet produced no changes.', {
                    featureID: fid,
                    summary: sheetResult?.summary || null,
                });
            }
            return { added, removed };
        }

        let result = null;
        try {
            result = await targetSolid.fillet({
                radius: r,
                combineEdges: this.inputParams?.combineEdges,
                resolution: this.inputParams?.resolution,
                edges: edgeObjs,
                featureID: fid,
                direction: dir,
                inflate: Number(this.inputParams.inflate) || 0,
                debug: !!this.inputParams.debug,
                showTangentOverlays: !!this.inputParams.showTangentOverlays,
                cleanupTinyFaceIslandsArea: this.inputParams?.cleanupTinyFaceIslandsArea,
            });
        } catch (err) {
            console.error('[FilletFeature] Fillet threw an error; attempting to continue with debug solids.', {
                featureID: fid,
                error: err?.message || err,
            });
        }
        const collectDebugSolids = (res) => {
            const out = [];
            if (!this.inputParams.debug || !Array.isArray(res?.__debugAddedSolids)) return out;
            for (const dbg of res.__debugAddedSolids) {
                if (!dbg) continue;
                try { dbg.name = `${fid}_${dbg.name || 'DEBUG'}`; } catch { }
                console.log('[FilletFeature] Adding fillet debug solid', { featureID: fid, name: dbg.name });
                out.push(dbg);
            }
            return out;
        };
        const debugSolids = collectDebugSolids(result);
        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (!result) {
            console.error('[FilletFeature] Fillet returned no result; skipping scene replacement.', { featureID: fid });
            if (debugSolids.length) {
                console.warn('[FilletFeature] Returning fillet debug solids despite failure.', {
                    featureID: fid,
                    debugSolidCount: debugSolids.length,
                });
                added.push(...debugSolids);
            }
            return { added, removed };
        }
        if (triCount === 0 || vertCount === 0) {
            console.error('[FilletFeature] Fillet produced an empty solid; skipping scene replacement.', {
                featureID: fid,
                triangleCount: triCount,
                vertexCount: vertCount,
                direction: dir,
                radius: r,
                inflate: this.inputParams.inflate,
            });
            if (debugSolids.length) {
                console.warn('[FilletFeature] Returning fillet debug solids despite empty result.', {
                    featureID: fid,
                    debugSolidCount: debugSolids.length,
                });
                added.push(...debugSolids);
            }
            return { added, removed };
        }
        console.log('[FilletFeature] Fillet succeeded; replacing target solid.', {
            featureID: fid,
            triangles: triCount,
            vertices: vertCount,
        });
        added.push(result);
        added.push(...debugSolids);
        // Replace the original geometry in the scene
        removed.push(targetSolid);
        return { added, removed };
    }
}

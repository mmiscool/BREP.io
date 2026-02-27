import {
    advanceFilletSectionDebuggerStep,
    clearFilletCaches,
    clearFilletSectionDebuggerState,
    getFilletSectionDebuggerState,
    setFilletSectionDebuggerState,
} from "../../BREP/fillets/fillet.js";
import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";
import { runSheetMetalCornerFillet } from "../sheetMetal/sheetMetalEngineBridge.js";

const DEBUG_MODE_NONE = "NONE";
const DEBUG_MODE_WEDGE_AND_TUBE = "WEDGE AND TUBE";
const DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN = "WEDGE AND TUBE AFTER BOOLEAN";
const DEBUG_MODE_COMBINED_BEFORE_TARGET = "COMBINED FILLET BEFORE TARGET BOOLEAN";

function normalizeFilletDebuggerEdgeName(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    return raw.replace(/\[\d+\]$/, '');
}

function resolveFilletDebuggerEdgeFromParams(params, partHistory = null) {
    const firstNormalizedToken = (value) => {
        if (value == null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const parts = raw.includes('|') ? raw.split('|') : [raw];
        for (const part of parts) {
            const normalized = normalizeFilletDebuggerEdgeName(part);
            if (normalized) return normalized;
        }
        return null;
    };
    const list = Array.isArray(params?.edges) ? params.edges : [];

    // Prefer resolving through the same edge collection path used by the feature run.
    // This avoids token mismatches for composite reference strings (e.g. "A|B").
    if (partHistory) {
        try {
            const expanded = expandReferenceSelections(list, partHistory);
            const edgeObjs = collectEdgesFromSelection(expanded?.selections || []);
            for (const edgeObj of edgeObjs) {
                const normalized = firstNormalizedToken(edgeObj?.name || edgeObj?.userData?.edgeName);
                if (normalized) return normalized;
            }
        } catch { }
    }

    for (const item of list) {
        if (!item) continue;
        if (typeof item === 'object') {
            const normalized =
                firstNormalizedToken(item?.name)
                || firstNormalizedToken(item?.userData?.edgeName)
                || firstNormalizedToken(item?.userData?.faceName);
            if (normalized) return normalized;
            continue;
        }
        const normalized = firstNormalizedToken(item);
        if (normalized) return normalized;
    }
    return null;
}

async function rerunFilletDebugger(partHistory, viewer, featureID = null, paramsRef = null) {
    if (!partHistory || typeof partHistory.runHistory !== 'function') return;

    const normalizeId = (value) => {
        if (value == null) return null;
        const text = String(value).trim();
        return text ? text : null;
    };
    const resolveEntryId = (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const directId = normalizeId(entry.id) || normalizeId(entry.featureID);
        if (directId) return directId;
        const params = entry.inputParams;
        if (params && typeof params === 'object') {
            return normalizeId(params.id) || normalizeId(params.featureID);
        }
        return null;
    };
    const targetId = normalizeId(featureID);
    try {
        const features = Array.isArray(partHistory?.features) ? partHistory.features : [];
        let marked = false;
        for (const entry of features) {
            if (!entry || typeof entry !== 'object') continue;
            const entryId = resolveEntryId(entry);
            const sameById = !!targetId && entryId === targetId;
            const sameByParams = !!paramsRef && entry?.inputParams && entry.inputParams === paramsRef;
            if (!sameById && !sameByParams) continue;
            entry.dirty = true;
            marked = true;
            break;
        }
        if (!marked && targetId) {
            for (const entry of features) {
                const paramsId = normalizeId(entry?.inputParams?.featureID) || normalizeId(entry?.inputParams?.id);
                if (paramsId === targetId) {
                    entry.dirty = true;
                    marked = true;
                    break;
                }
            }
        }
    } catch { }

    try {
        if (featureID != null && featureID !== '') {
            partHistory.currentHistoryStepId = String(featureID);
        }
    } catch { }
    try { await partHistory.runHistory(); } catch (err) {
        console.warn('[FilletFeature] Section debugger rerun failed.', { message: err?.message || err });
    }
    try { if (viewer && typeof viewer.render === 'function') viewer.render(); } catch { }
}


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
        options: ["AUTO", "INSET", "OUTSET"],
        default_value: "AUTO",
        hint: "AUTO classifies each selected edge as inside/outside and applies subtract/union automatically.",
    },
    patchFilletEndCaps: {
        type: "boolean",
        default_value: true,
        hint: "Move eligible three-face fillet tip points and replace selected end-cap triangles with a patched face.",
    },
    smoothGeneratedEdges: {
        type: "boolean",
        default_value: false,
        hint: "Smooth generated edges by reducing local kinks while preserving local triangle orientation.",
    },
    cleanupTinyFaceIslandsArea: {
        type: "number",
        step: 0.001,
        default_value: 0.01,
        hint: "Relabel tiny disconnected face islands below this area threshold (<= 0 disables).",
    },
    debug: {
        type: "options",
        options: [
            DEBUG_MODE_NONE,
            DEBUG_MODE_WEDGE_AND_TUBE,
            DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN,
            DEBUG_MODE_COMBINED_BEFORE_TARGET,
        ],
        default_value: DEBUG_MODE_NONE,
        hint: "Controls which fillet debug solids are emitted.",
    },
    showTangentOverlays: {
        type: "boolean",
        default_value: false,
        hint: "Show pre-inflate tangent overlays on the fillet tube",
    },
    sectionDebuggerStart: {
        type: "button",
        label: "Start Section Debugger",
        hint: "Activate per-cross-section debugger overlays and reset to the first section sample.",
        actionFunction: async ({ featureID, params, partHistory, viewer }) => {
            const edgeName = resolveFilletDebuggerEdgeFromParams(params, partHistory);
            setFilletSectionDebuggerState({
                enabled: true,
                featureID: featureID || params?.featureID || params?.id || null,
                edgeName,
                stepIndex: 0,
            });
            await rerunFilletDebugger(partHistory, viewer, featureID || params?.featureID || params?.id || null, params || null);
        },
    },
    sectionDebuggerPrev: {
        type: "button",
        label: "Prev Section",
        hint: "Step the fillet section debugger to the previous sample.",
        actionFunction: async ({ featureID, params, partHistory, viewer }) => {
            const fid = featureID || params?.featureID || params?.id || null;
            const state = getFilletSectionDebuggerState();
            const edgeName = resolveFilletDebuggerEdgeFromParams(params, partHistory);
            setFilletSectionDebuggerState({
                enabled: true,
                featureID: fid,
                edgeName: state?.edgeName || edgeName,
            });
            advanceFilletSectionDebuggerStep(-1);
            await rerunFilletDebugger(partHistory, viewer, fid, params || null);
        },
    },
    sectionDebuggerNext: {
        type: "button",
        label: "Next Section",
        hint: "Step the fillet section debugger to the next sample.",
        actionFunction: async ({ featureID, params, partHistory, viewer }) => {
            const fid = featureID || params?.featureID || params?.id || null;
            const state = getFilletSectionDebuggerState();
            const edgeName = resolveFilletDebuggerEdgeFromParams(params, partHistory);
            setFilletSectionDebuggerState({
                enabled: true,
                featureID: fid,
                edgeName: state?.edgeName || edgeName,
            });
            advanceFilletSectionDebuggerStep(1);
            await rerunFilletDebugger(partHistory, viewer, fid, params || null);
        },
    },
    sectionDebuggerClear: {
        type: "button",
        label: "Clear Section Debugger",
        hint: "Disable and clear fillet section debugger overlays.",
        actionFunction: async ({ featureID, params, partHistory, viewer }) => {
            clearFilletSectionDebuggerState();
            await rerunFilletDebugger(partHistory, viewer, featureID || params?.featureID || params?.id || null, params || null);
        },
    },
};

function resolveDebugMode(rawValue) {
    const normalized = String(rawValue).trim().toUpperCase();
    if (normalized === DEBUG_MODE_NONE) return DEBUG_MODE_NONE;
    if (normalized === DEBUG_MODE_WEDGE_AND_TUBE) return DEBUG_MODE_WEDGE_AND_TUBE;
    if (normalized === DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN) {
        return DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN;
    }
    if (normalized === DEBUG_MODE_COMBINED_BEFORE_TARGET) {
        return DEBUG_MODE_COMBINED_BEFORE_TARGET;
    }
    return DEBUG_MODE_NONE;
}

function getDebugConfig(debugMode) {
    if (debugMode === DEBUG_MODE_WEDGE_AND_TUBE) {
        return { enabled: true, solidsLevel: 0, showCombinedBeforeTarget: false };
    }
    if (debugMode === DEBUG_MODE_WEDGE_AND_TUBE_AFTER_BOOLEAN) {
        return { enabled: true, solidsLevel: 1, showCombinedBeforeTarget: false };
    }
    if (debugMode === DEBUG_MODE_COMBINED_BEFORE_TARGET) {
        return { enabled: true, solidsLevel: -1, showCombinedBeforeTarget: true };
    }
    return { enabled: false, solidsLevel: -1, showCombinedBeforeTarget: false };
}

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

    uiFieldsTest() {
        return [];
    }

    async run(partHistory) {
        const debugMode = resolveDebugMode(this.inputParams?.debug);
        const debugConfig = getDebugConfig(debugMode);
        const debugEnabled = !!debugConfig.enabled;
        const configuredDebugLevel = Number(debugConfig.solidsLevel);
        const debugShowCombinedBeforeTarget = !!debugConfig.showCombinedBeforeTarget;
        console.log('[FilletFeature] Starting fillet run...', {
            featureID: this.inputParams?.featureID,
            direction: this.inputParams?.direction,
            radius: this.inputParams?.radius,
            resolution: this.inputParams?.resolution,
            inflate: this.inputParams?.inflate,
            showTangentOverlays: this.inputParams?.showTangentOverlays,
            patchFilletEndCaps: this.inputParams?.patchFilletEndCaps,
            smoothGeneratedEdges: this.inputParams?.smoothGeneratedEdges,
            cleanupTinyFaceIslandsArea: this.inputParams?.cleanupTinyFaceIslandsArea,
            debug: debugEnabled,
            debugMode,
            debugSolidsLevel: configuredDebugLevel,
            debugShowCombinedBeforeTarget,
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

        const dir = String(this.inputParams.direction || 'AUTO').toUpperCase();
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
                usedSheetMetalPath: true,
                edgeSmoothing: null,
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
        result = await targetSolid.fillet({
            radius: r,
            resolution: this.inputParams?.resolution,
            edges: edgeObjs,
            featureID: fid,
            direction: dir,
            inflate: Number(this.inputParams.inflate) || 0,
            debug: debugEnabled,
            debugSolidsLevel: configuredDebugLevel,
            debugShowCombinedBeforeTarget,
            showTangentOverlays: !!this.inputParams.showTangentOverlays,
            patchFilletEndCaps: !!this.inputParams.patchFilletEndCaps,
            smoothGeneratedEdges: !!this.inputParams.smoothGeneratedEdges,
            cleanupTinyFaceIslandsArea: this.inputParams?.cleanupTinyFaceIslandsArea,
        });
        const collectDebugSolids = (res) => {
            const out = [];
            if (!Array.isArray(res?.__debugAddedSolids)) return out;
            for (const dbg of res.__debugAddedSolids) {
                if (!dbg) continue;
                try { dbg.name = `${fid}_${dbg.name || 'DEBUG'}`; } catch { }
                console.log('[FilletFeature] Adding fillet debug solid', { featureID: fid, name: dbg.name });
                out.push(dbg);
            }
            return out;
        };
        const debugSolids = collectDebugSolids(result);
        const edgeSmoothing = result?.__filletEdgeSmoothing || null;
        const edgeDirectionDecision = result?.__filletDirectionDecision || null;
        this.persistentData = {
            ...(this.persistentData || {}),
            edgeSmoothing,
            edgeDirectionDecision,
            usedSheetMetalPath: false,
            smoothGeneratedEdges: !!this.inputParams.smoothGeneratedEdges,
        };
        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (!result) {
            throw new Error(`[FilletFeature] Fillet returned no result for feature ${fid || '(unknown)'}.`);
        }
        if (triCount === 0 || vertCount === 0) {
            throw new Error(`[FilletFeature] Fillet produced empty geometry for feature ${fid || '(unknown)'}. `
                + `(triangles=${triCount}, vertices=${vertCount}, direction=${dir}, radius=${r}, `
                + `inflate=${this.inputParams.inflate})`);
        }
        console.log('[FilletFeature] Fillet succeeded; replacing target solid.', {
            featureID: fid,
            triangles: triCount,
            vertices: vertCount,
            edgeSmoothing: edgeSmoothing || null,
            edgeDirectionDecision: edgeDirectionDecision || null,
        });
        added.push(result);
        added.push(...debugSolids);
        // Replace the original geometry in the scene
        removed.push(targetSolid);
        return { added, removed };
    }
}

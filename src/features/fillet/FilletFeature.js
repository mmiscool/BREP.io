import {
    collectEdgesFromSelection,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";

const FILLET_DIRECTIONS = ["AUTO", "INSET", "OUTSET"];
const DEBUG_MODE_NONE = "NONE";
const DEBUG_MODE_TOOLS = "MITER TOOLS";
const DEBUG_MODE_TOOLS_AND_RESULT = "MITER TOOLS + RESULT";
const FILLET_DEBUG_MODES = [DEBUG_MODE_NONE, DEBUG_MODE_TOOLS, DEBUG_MODE_TOOLS_AND_RESULT];

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
        hint: "Select edges and/or faces to target fillet edges",
    },
    direction: {
        type: "options",
        options: FILLET_DIRECTIONS,
        default_value: "AUTO",
        hint: "AUTO currently defaults to INSET while miter direction auto-classification is pending.",
    },
    debug: {
        type: "options",
        options: FILLET_DEBUG_MODES,
        default_value: DEBUG_MODE_NONE,
        hint: "Emit miter helper solids for fillet debugging.",
    },
    inflate: {
        type: "number",
        default_value: 0.05,
        step: 0.01,
        hint: "Extend cutter tangent points along each tangent-pair line (A<-v, B->v). True tangent overlays remain unchanged.",
    },
    radius: {
        type: "number",
        step: 0.1,
        default_value: 1,
        hint: "Fillet radius",
    },
    resolution: {
        type: "number",
        default_value: 32,
        hint: "Tube segment resolution used for the fillet round section.",
    },
};

function normalizeDirection(value) {
    const text = String(value || "AUTO").trim().toUpperCase();
    return FILLET_DIRECTIONS.includes(text) ? text : "AUTO";
}

function normalizeDebugMode(value) {
    const text = String(value || DEBUG_MODE_NONE).trim().toUpperCase();
    if (text === DEBUG_MODE_TOOLS) return DEBUG_MODE_TOOLS;
    if (text === DEBUG_MODE_TOOLS_AND_RESULT) return DEBUG_MODE_TOOLS_AND_RESULT;
    return DEBUG_MODE_NONE;
}

function normalizeSelectionToken(token) {
    const text = String(token || "").trim();
    if (!text) return null;
    return text.replace(/\[\d+\]$/, "");
}

function expandReferenceSelections(rawSelections, partHistory) {
    const out = [];
    const seen = new Set();

    const push = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (seen.has(obj)) return;
        seen.add(obj);
        out.push(obj);
    };

    const resolveByName = (name) => {
        if (!name || typeof partHistory?.getObjectByName !== "function") return null;
        try {
            return partHistory.getObjectByName(name) || null;
        } catch {
            return null;
        }
    };

    for (const item of (Array.isArray(rawSelections) ? rawSelections : [])) {
        if (!item) continue;
        if (typeof item === "object") {
            push(item);
            continue;
        }
        const text = String(item || "").trim();
        if (!text) continue;
        const parts = text.includes("|") ? text.split("|") : [text];
        for (const part of parts) {
            const token = normalizeSelectionToken(part);
            if (!token) continue;
            const resolved = resolveByName(token);
            if (resolved) push(resolved);
        }
    }
    return out;
}

export class FilletFeature {
    static shortName = "F";
    static longName = "Fillet";
    static inputParamsSchema = inputParamsSchema;

    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const edges = items
            .filter((it) => {
                const type = String(it?.type || "").toUpperCase();
                return type === "EDGE" || type === "FACE";
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

    async run(partHistory) {
        const rawSelections = Array.isArray(this.inputParams.edges)
            ? this.inputParams.edges.filter(Boolean)
            : [];
        const inputObjects = expandReferenceSelections(rawSelections, partHistory);
        const edgeObjs = collectEdgesFromSelection(inputObjects);

        if (edgeObjs.length === 0) {
            console.warn("[FilletFeature] No edges resolved from selection; skipping.");
            this.persistentData = {
                ...(this.persistentData || {}),
                stubbed: true,
                strategy: "miter_tangent_boolean",
                skipped: "no_edges",
            };
            return { added: [], removed: [] };
        }

        const { solid: targetSolid, solids } = resolveSingleSolidFromEdges(edgeObjs);
        if (!targetSolid) {
            console.warn("[FilletFeature] Fillet selections must resolve to exactly one solid.", {
                solids: Array.from(solids).map((solid) => solid?.name).filter(Boolean),
            });
            this.persistentData = {
                ...(this.persistentData || {}),
                stubbed: true,
                strategy: "miter_tangent_boolean",
                skipped: "target_solid_unresolved",
            };
            return { added: [], removed: [] };
        }

        const radius = Number(this.inputParams.radius);
        if (!Number.isFinite(radius) || !(radius > 0)) {
            console.warn("[FilletFeature] Invalid radius supplied; skipping.", {
                radius: this.inputParams.radius,
            });
            this.persistentData = {
                ...(this.persistentData || {}),
                stubbed: true,
                strategy: "miter_tangent_boolean",
                skipped: "invalid_radius",
            };
            return { added: [], removed: [] };
        }

        const direction = normalizeDirection(this.inputParams.direction);
        const debugMode = normalizeDebugMode(this.inputParams.debug);
        const inflate = Number(this.inputParams.inflate);
        const inflateValue = Number.isFinite(inflate) ? inflate : 0.05;
        const resolutionRaw = Number(this.inputParams.resolution);
        const resolutionValue = (Number.isFinite(resolutionRaw) && resolutionRaw > 0)
            ? Math.max(8, Math.floor(resolutionRaw))
            : 32;
        const result = await targetSolid.fillet({
            radius,
            direction,
            edges: edgeObjs,
            inflate: inflateValue,
            resolution: resolutionValue,
            featureID: this.inputParams.featureID,
            debug: debugMode !== DEBUG_MODE_NONE,
            debugMode,
        });
        if (!result) return { added: [], removed: [] };

        try { result.name = targetSolid.name; } catch { }

        const debugSolids = [];
        if (debugMode !== DEBUG_MODE_NONE && Array.isArray(result?.__debugAddedSolids)) {
            for (const dbg of result.__debugAddedSolids) {
                if (!dbg) continue;
                try { dbg.name = `${this.inputParams.featureID || "FILLET"}_${dbg.name || "DEBUG"}`; } catch { }
                debugSolids.push(dbg);
            }
        }

        this.persistentData = {
            ...(this.persistentData || {}),
            stubbed: true,
            strategy: "miter_tangent_boolean",
            direction,
            radius,
            inflate: inflateValue,
            resolution: resolutionValue,
            debugMode,
            selectedEdgeCount: edgeObjs.length,
            selectedEdgeNames: edgeObjs.map((edge) => edge?.name).filter(Boolean),
            miterSummary: result?.__filletStub || null,
        };

        return { added: [result, ...debugSolids], removed: [targetSolid] };
    }
}

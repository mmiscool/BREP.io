import {
    collectEdgesFromSelection,
    getSolidGeometryCounts,
    resolveSingleSolidFromEdges,
} from "../edgeFeatureUtils.js";

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the chamfer feature",
    },
    edges: {
        type: "reference_selection",
        selectionFilter: ["EDGE", "FACE"],
        multiple: true,
        default_value: null,
        hint: "Select edges or faces to apply the chamfer",
    },
    distance: {
        type: "number",
        step: 0.1,
        default_value: 1,
        hint: "Chamfer distance (equal offset along both faces)",
    },
};

export class ChamferFeature {
    static shortName = "CH";
    static longName = "Chamfer";
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
    async run(_partHistory) {
        const inputObjects = Array.isArray(this.inputParams.edges) ? this.inputParams.edges.filter(Boolean) : [];
        const edgeObjs = collectEdgesFromSelection(inputObjects);

        if (edgeObjs.length === 0) {
            console.warn("No edges selected for chamfer");
            return { added: [], removed: [] };
        }

        const { solid: targetSolid, solids } = resolveSingleSolidFromEdges(edgeObjs);
        if (!targetSolid) {
            if (solids.size === 0) {
                console.warn("Selected edges do not belong to any solid");
            } else {
                console.warn("Selected edges belong to multiple solids");
            }
            return { added: [], removed: [] };
        }
        const distance = Number(this.inputParams.distance);
        if (!Number.isFinite(distance) || !(distance > 0)) {
            console.warn("Invalid chamfer distance supplied; aborting.", { distance: this.inputParams.distance });
            return { added: [], removed: [] };
        }

        const fid = this.inputParams.featureID;
        const result = await targetSolid.chamfer({
            distance,
            edges: edgeObjs,
            featureID: fid,
        });

        const { triCount, vertCount } = getSolidGeometryCounts(result);
        if (!result || triCount === 0 || vertCount === 0) {
            console.error("[ChamferFeature] Chamfer produced an empty result; skipping scene replacement.", {
                featureID: fid,
                triangleCount: triCount,
                vertexCount: vertCount,
                distance,
            });
            return { added: [], removed: [] };
        }

        try { result.name = targetSolid.name; } catch {}
        try { targetSolid.__removeFlag = true; } catch {}
        result.visualize();

        const added = [result];
        return { added, removed: [targetSolid] };
    }
}

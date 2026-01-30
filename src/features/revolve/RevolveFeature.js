import { BREP } from "../../BREP/BREP.js";
import { selectionHasSketch } from "../selectionUtils.js";

const inputParamsSchema = {
    id: {
        type: "string",
        default_value: null,
        hint: "unique identifier for the revolve feature",
    },
    profile: {
        type: "reference_selection",
        selectionFilter: ["SKETCH", "FACE"],
        multiple: false,
        default_value: null,
        hint: "Select the profile (face) to revolve",
    },
    consumeProfileSketch: {
        type: "boolean",
        default_value: true,
        hint: "Remove the referenced sketch after creating the revolve. Turn off to keep it in the scene.",
    },
    axis: {
        type: "reference_selection",
        selectionFilter: ["EDGE"],
        multiple: false,
        default_value: null,
        hint: "Select the axis to revolve about",
    },
    angle: {
        type: "number",
        default_value: 360,
        hint: "Revolve angle",
    },
    resolution: {
        type: "number",
        default_value: 64,
        hint: "Number of segments used for the revolve sweep",
    },
    boolean: {
        type: "boolean_operation",
        default_value: { targets: [], operation: 'NONE' },
        hint: "Optional boolean operation with selected solids"
    }
};

export class RevolveFeature {
    static shortName = "R";
    static longName = "Revolve";
    static inputParamsSchema = inputParamsSchema;
    static showContexButton(selectedItems) {
        const items = Array.isArray(selectedItems) ? selectedItems : [];
        const profileObj = items.find((it) => {
            const type = String(it?.type || '').toUpperCase();
            return type === 'FACE' || type === 'SKETCH';
        });
        if (!profileObj) return false;
        const profileName = profileObj?.name || profileObj?.userData?.faceName || null;
        if (!profileName) return false;
        const axisObj = items.find((it) => String(it?.type || '').toUpperCase() === 'EDGE');
        const axisName = axisObj?.name || axisObj?.userData?.edgeName || null;
        const params = { profile: profileName };
        if (axisName) params.axis = axisName;
        return { params };
    }

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    uiFieldsTest(context) {
        const params = this.inputParams || context?.params || {};
        const partHistory = context?.history || null;
        return selectionHasSketch(params.profile, partHistory) ? [] : ["consumeProfileSketch"];
    }

    async run(partHistory) {
        const { profile, axis, angle, resolution } = this.inputParams;

        // Resolve profile object: accept FACE or SKETCH group object
        const obj = Array.isArray(profile) ? (profile[0] || null) : (profile || null);
        let faceObj = obj;
        if (obj && obj.type === 'SKETCH') {
            faceObj = obj.children.find(ch => ch.type === 'FACE') || obj.children.find(ch => ch.userData?.faceName);
        }
        if (!faceObj || !faceObj.geometry) return { added: [], removed: [] };
        // if the face is a child of a sketch we need to remove the sketch from the scene

        const axisObj = Array.isArray(axis) ? (axis[0] || null) : (axis || null);
        if (!axisObj) {
            console.warn("RevolveFeature: no axis selected");
            return { added: [], removed: [] };
        }
        if (!faceObj) {
            console.warn("RevolveFeature: no profile face found");
            return { added: [], removed: [] };
        }

        const removed = [];
        const consumeSketch = this.inputParams?.consumeProfileSketch !== false;
        if (consumeSketch && faceObj && faceObj.type === 'FACE' && faceObj.parent && faceObj.parent.type === 'SKETCH') {
            removed.push(faceObj.parent);
        }

        const revolve = new BREP.Revolve({
            face: faceObj,
            axis: axisObj,
            angle,
            resolution,
            name: this.inputParams.featureID,
        });

        // Weld slight numerical seams and build mesh
        try { revolve.setEpsilon(1e-6); } catch { }
        revolve.visualize();
        const effects = await BREP.applyBooleanOperation(partHistory || {}, revolve, this.inputParams.boolean, this.inputParams.featureID);
        const booleanRemoved = Array.isArray(effects.removed) ? effects.removed : [];
        const removedArtifacts = [...removed, ...booleanRemoved];
        // Flag removals (sketch parent + boolean effects)
        try { for (const obj of removedArtifacts) { if (obj) obj.__removeFlag = true; } } catch { }
        return {
            added: Array.isArray(effects.added) ? effects.added : [],
            removed: removedArtifacts,
        };
    }
}

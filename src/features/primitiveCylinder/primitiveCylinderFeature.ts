// primitiveCylinderFeature.js
// Creates a primitive cylinder as separate faces: lateral (side) and two caps.
// Aligned along the Y axis with base at y=0 and top at y=height (not centered).

import { BREP } from '../../BREP/BREP.js'
import { composeReferencedTransformMatrix } from '../../utils/transformReferenceUtils.js';

type AnyRecord = Record<string, any>;

const inputParamsSchema = {
    id: {
        type: 'string',
        default_value: null,
        hint: 'Unique identifier for the feature'
    },
    radius: {
        type: 'number',
        default_value: 5,
        hint: 'Radius of the cylinder'
    },
    height: {
        type: 'number',
        default_value: 10,
        hint: 'Height of the cylinder along Y-axis'
    },
    resolution: {
        type: 'number',
        default_value: "resolution",
        hint: 'Number of segments around the circumference'
    },
    transform: {
        type: 'transform',
        default_value: { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
        referenceSelectionFilter: ['FACE', 'EDGE', 'VERTEX', 'PLANE', 'DATUM'],
        referenceLabel: 'Start Reference',
        referencePlaceholder: 'Select point, edge, or face…',
        hint: 'Select a start reference, then position, rotate, and scale the solid relative to it.'
    },
    boolean: {
        type: 'boolean_operation',
        default_value: { targets: [], operation: 'NONE' },
        hint: 'Optional boolean operation with selected solids'
    }
};

export class PrimitiveCylinderFeature {
    static shortName = "P.CY";
    static longName = "Primitive Cylinder";
    static inputParamsSchema = inputParamsSchema;

    inputParams: AnyRecord;
    persistentData: AnyRecord;

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

  async run(partHistory: any) {
        const { radius, height, resolution, featureID } = this.inputParams;

        const cyl = await new BREP.Cylinder({
            radius,
            height,
            resolution,
            name: featureID,
        });
        try {
            if (this.inputParams.transform) {
                cyl.bakeTransform(composeReferencedTransformMatrix(this.inputParams.transform, partHistory || null, {}, BREP.THREE));
            }
        } catch (_) { /* ignore transform failures */ }

        cyl.visualize();
        return await BREP.applyBooleanOperation(partHistory || {}, cyl, this.inputParams.boolean, featureID);
  }
}

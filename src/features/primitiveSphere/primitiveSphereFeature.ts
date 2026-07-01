// primitiveSphereFeature.js
// Creates a primitive sphere as a Solid containing a single Face (one analytic surface).
// Centered at the origin, aligned with the Y axis (poles at ±radius along Y).

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
        hint: 'Radius of the sphere'
    },
    resolution: {
        type: 'number',
        default_value: "resolution",
        hint: 'Base segment count (longitude). Latitude segments are derived from this.'
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

export class PrimitiveSphereFeature {
    static shortName = "P.S";
    static longName = "Primitive Sphere";
    static inputParamsSchema = inputParamsSchema;

    inputParams: AnyRecord;
    persistentData: AnyRecord;

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    async run(partHistory: any) {
        const { radius, resolution, featureID } = this.inputParams;

        const sphere = await new BREP.Sphere({
            r: radius,
            resolution,
            name: featureID,
        });
        try {
            if (this.inputParams.transform) {
                sphere.bakeTransform(composeReferencedTransformMatrix(this.inputParams.transform, partHistory || null, {}, BREP.THREE));
            }
        } catch (_) { /* ignore transform failures */ }
        sphere.visualize();

        return await BREP.applyBooleanOperation(partHistory || {}, sphere, this.inputParams.boolean, featureID);
    }
}

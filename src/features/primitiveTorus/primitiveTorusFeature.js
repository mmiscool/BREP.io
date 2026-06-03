// primitiveTorusFeature.js
// Creates a primitive torus as a Solid composed of Face objects.
// If arc < 360°, adds end-cap Faces to close the open torus, matching
// the original orientation (start cap built at θ=0 with normal (0,-1,0),
// end cap is a rotated clone about +Z by the sweep arc).

import { BREP } from '../../BREP/BREP.js'
import { composeReferencedTransformMatrix } from '../../utils/transformReferenceUtils.js';
// no extra imports needed for centerline metadata

function buildTubeCenterlinePoints(THREE, matrix, majorRadius, resolution, arcDegrees) {
    const major = Number(majorRadius);
    const segments = Math.max(8, Math.floor(Number(resolution) || 48));
    const arc = Number.isFinite(Number(arcDegrees)) ? Number(arcDegrees) : 360;
    const fullArc = arc >= 360 - 1e-6;
    const sweep = fullArc ? Math.PI * 2 : (arc / 180) * Math.PI;
    if (!Number.isFinite(major) || Math.abs(major) <= 1e-12 || !(sweep > 0)) return [];

    const count = fullArc ? segments : segments + 1;
    const points = [];
    for (let i = 0; i < count; i++) {
        const u = fullArc
            ? (i / segments) * sweep
            : (i / Math.max(1, count - 1)) * sweep;
        const point = new THREE.Vector3(
            major * Math.cos(u),
            0,
            -major * Math.sin(u),
        ).applyMatrix4(matrix);
        points.push([point.x, point.y, point.z]);
    }
    return points;
}

const inputParamsSchema = {
    id: {
        type: 'string',
        default_value: null,
        hint: 'Unique identifier for the feature'
    },
    majorRadius: {
        type: 'number',
        default_value: 10,
        hint: 'Distance from center to the centerline of the tube (R)'
    },
    tubeRadius: {
        type: 'number',
        default_value: 2,
        hint: 'Radius of the tube (r)'
    },
    resolution: {
        type: 'number',
        default_value: "resolution",
        hint: 'Quality resolution (base setting for segments)'
    },
    arc: {
        type: 'number',
        default_value: 360,
        hint: 'Sweep angle of the torus in degrees (0, 360]'
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

export class PrimitiveTorusFeature {
    static shortName = "P.T";
    static longName = "Primitive Torus";
    static inputParamsSchema = inputParamsSchema;

    constructor() {
        this.inputParams = {};
        this.persistentData = {};
    }

    async run(partHistory) {
        let {
            majorRadius,
            tubeRadius,
            resolution,
            arc,
            featureID
        } = this.inputParams;

        const torus = await new BREP.Torus({
            mR: majorRadius,
            tR: tubeRadius,
            resolution,
            arcDegrees: arc,
            name: featureID,
        });
        try {
            if (this.inputParams.transform) {
                torus.bakeTransform(composeReferencedTransformMatrix(this.inputParams.transform, partHistory || null, {}, BREP.THREE));
            }
        } catch (_) { }

        // Add a world-space centerline edge along the torus revolve axis (Y).
        const THREE = BREP.THREE;
        try {
            const M = composeReferencedTransformMatrix(this.inputParams?.transform, partHistory || null, {}, THREE);

            const tubeDiameter = 2 * Math.abs(Number(tubeRadius) || 0);
            const L = tubeDiameter * 1.5;
            const a0 = new THREE.Vector3(0, -0.5 * L, 0).applyMatrix4(M);
            const a1 = new THREE.Vector3(0, +0.5 * L, 0).applyMatrix4(M);
            if (a0.distanceToSquared(a1) >= 1e-16) {
                torus.addCenterline([a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z], (featureID ? `${featureID}_AXIS` : 'AXIS'), { materialKey: 'OVERLAY' });
            }

            const tubeCenterline = buildTubeCenterlinePoints(THREE, M, majorRadius, resolution, arc);
            if (tubeCenterline.length >= 2) {
                torus.addAuxEdge(
                    (featureID ? `${featureID}_TUBE_CENTERLINE` : 'TUBE_CENTERLINE'),
                    tubeCenterline,
                    {
                        closedLoop: Number(arc) >= 360 - 1e-6,
                        materialKey: 'OVERLAY',
                        centerline: true,
                        faceA: (featureID ? `${featureID}_Side` : 'Side'),
                    },
                );
            }
        } catch (_) { }

        torus.visualize();
        return await BREP.applyBooleanOperation(partHistory || {}, torus, this.inputParams.boolean, featureID);
    }
}

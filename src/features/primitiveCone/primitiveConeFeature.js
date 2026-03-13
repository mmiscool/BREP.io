// primitiveConeFeature.js
// Creates a primitive cone/frustum as separate meshes per surface: lateral (side) and caps.
// Aligned along the Y axis with base at y=0 and top at y=height (not centered).

import { BREP } from '../../BREP/BREP.js'
import { composeReferencedTransformMatrix } from '../../utils/transformReferenceUtils.js';
// no extra imports needed for centerline metadata

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for the feature'
  },
  radiusTop: {
    type: 'number',
    default_value: 5,
    hint: 'Top radius of the cone (tip if 0)'
  },
  radiusBottom: {
    type: 'number',
    default_value: 10,
    hint: 'Base radius of the cone'
  },
  height: {
    type: 'number',
    default_value: 10,
    hint: 'Height of the cone along Y-axis'
  },
  resolution: {
    type: 'number',
    default_value: 32,
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

export class PrimitiveConeFeature {
    static shortName = "P.CO";
    static longName = "Primitive Cone";
    static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const { radiusTop, radiusBottom, height, resolution } = this.inputParams;

    const cone = await new BREP.Cone({
      r1: radiusTop,
      r2: radiusBottom,
      h: height,
      resolution,
      name: this.inputParams.featureID
    });
    try {
      if (this.inputParams.transform) {
        cone.bakeTransform(composeReferencedTransformMatrix(this.inputParams.transform, partHistory || null, {}, BREP.THREE));
      }
    } catch (_) { }

    // Add a world-space centerline along Y from base to top and store on the solid
    const THREE = BREP.THREE;
    try {
      const M = composeReferencedTransformMatrix(this.inputParams?.transform, partHistory || null, {}, THREE);
      const a0 = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
      const a1 = new THREE.Vector3(0, Number(height) || 0, 0).applyMatrix4(M);
      if (a0.distanceToSquared(a1) >= 1e-16) {
        const featureID = this.inputParams.featureID;
        cone.addCenterline([a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z], (featureID ? `${featureID}_AXIS` : 'AXIS'), { materialKey: 'OVERLAY' });
      }
    } catch (_) { }

    cone.visualize();
    return await BREP.applyBooleanOperation(partHistory || {}, cone, this.inputParams.boolean, this.inputParams.featureID);
  }
}

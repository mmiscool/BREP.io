import { createPortGroupFromDefinition, buildPortDefinitionFromInputs, normalizePortKind } from './portUtils.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for the port feature.',
  },
  portName: {
    type: 'string',
    default_value: 'Port',
    label: 'Port Name',
    hint: 'Logical name for this electrical termination or waypoint.',
  },
  kind: {
    type: 'options',
    options: ['termination', 'waypoint'],
    default_value: 'termination',
    label: 'Port Type',
    hint: 'Termination ports are cable endpoints. Waypoint ports join spline paths into a network.',
  },
  anchor: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'EDGE', 'VERTEX', 'PLANE', 'DATUM'],
    multiple: false,
    default_value: null,
    hint: 'Optional geometry or datum used to locate the port.',
  },
  directionRef: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'EDGE', 'PLANE', 'DATUM'],
    multiple: false,
    default_value: null,
    label: 'Direction Reference',
    hint: 'Optional geometry used to define the port direction. Defaults to the anchor direction.',
  },
  transform: {
    type: 'transform',
    default_value: { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
    label: 'Local Offset',
    hint: 'Position and rotate the port relative to its anchor.',
  },
  reverseDirection: {
    type: 'boolean',
    default_value: false,
    label: 'Reverse Direction',
    hint: 'Flip the port direction vector.',
  },
  extension: {
    type: 'number',
    default_value: 2,
    label: 'Extension',
    hint: 'How far the wire stays straight from the base point before bending.',
  },
  displayLength: {
    type: 'number',
    default_value: 6,
    label: 'Display Length',
    hint: 'Visual length of the purple port line in the scene.',
  },
};

export class PortFeature {
  static shortName = 'PORT';
  static longName = 'Port';
  static inputParamsSchema = inputParamsSchema;

  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const ref = items.find((item) => {
      const type = String(item?.type || '').toUpperCase();
      return type === 'FACE' || type === 'EDGE' || type === 'VERTEX' || type === 'PLANE' || type === 'DATUM';
    });
    const name = ref?.name || ref?.userData?.faceName || null;
    if (!name) return false;
    return { field: 'anchor', value: name };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run() {
    const featureId = this.inputParams?.featureID ? String(this.inputParams.featureID) : 'Port';
    const definition = buildPortDefinitionFromInputs({
      featureId,
      inputParams: this.inputParams,
    });
    definition.kind = normalizePortKind(this.inputParams?.kind);

    this.persistentData = this.persistentData || {};
    this.persistentData.port = definition;

    const group = createPortGroupFromDefinition(definition, {
      nameOverride: featureId,
    });
    group.userData = group.userData || {};
    group.userData.portData = {
      ...group.userData.portData,
      featureId,
      objectName: featureId,
    };
    return { added: [group], removed: [] };
  }
}

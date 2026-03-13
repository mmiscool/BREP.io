import { createPortGroupFromDefinition, buildPortDefinitionFromInputs, normalizePortKind } from './portUtils.js';

const DEFAULT_TRANSFORM = { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] };

function readReferencePickMeta(ref) {
  const meta = ref?.userData?.__lastReferencePickMeta;
  if (!meta || typeof meta !== 'object') return null;
  const next = {};
  if (Array.isArray(meta.pickPoint) && meta.pickPoint.length >= 3) {
    const x = Number(meta.pickPoint[0]);
    const y = Number(meta.pickPoint[1]);
    const z = Number(meta.pickPoint[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      next.pickPoint = [x, y, z];
    }
  }
  const faceIndex = Number(meta.faceIndex);
  if (Number.isFinite(faceIndex) && faceIndex >= 0) next.faceIndex = Math.floor(faceIndex);
  return Object.keys(next).length ? next : null;
}

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
  directionRef: {
    type: 'reference_selection',
    selectionFilter: ['FACE', 'EDGE', 'PLANE', 'DATUM'],
    multiple: false,
    default_value: null,
    label: 'Direction Reference',
    hint: 'Optional geometry used to define the port direction. Defaults to the transform reference direction.',
  },
  transform: {
    type: 'transform',
    default_value: DEFAULT_TRANSFORM,
    label: 'Placement',
    hint: 'Pick a start reference, then position and rotate the port relative to that reference.',
    referenceLabel: 'Start Reference',
    referencePlaceholder: 'Click then pick a point, edge, face, plane, or datum…',
    referenceSelectionFilter: ['FACE', 'EDGE', 'VERTEX', 'PLANE', 'DATUM'],
    referenceDirectionField: 'directionRef',
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
    const reference = {
      name,
      type: String(ref?.type || '').toUpperCase(),
      ...(readReferencePickMeta(ref) || {}),
    };
    return {
      params: {
        transform: {
          ...DEFAULT_TRANSFORM,
          reference,
        },
      },
    };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const featureId = this.inputParams?.featureID ? String(this.inputParams.featureID) : 'Port';
    const definition = buildPortDefinitionFromInputs({
      featureId,
      inputParams: this.inputParams,
      referenceSource: partHistory,
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

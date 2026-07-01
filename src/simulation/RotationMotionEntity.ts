import { ListEntityBase } from '../core/entities/ListEntityBase.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this rotation motion.',
  },
  solid: {
    type: 'reference_selection',
    selectionFilter: ['SOLID'],
    multiple: false,
    default_value: null,
    hint: 'Select the solid to drive.',
  },
  axis: {
    type: 'reference_selection',
    selectionFilter: ['EDGE'],
    multiple: false,
    default_value: null,
    hint: 'Select an edge or centerline to rotate about.',
  },
  speed: {
    type: 'number',
    default_value: 90,
    hint: 'Rotation speed in degrees per second.',
  },
  angle: {
    type: 'number',
    default_value: 0,
    hint: 'Optional total angle in degrees. Leave blank to rotate continuously.',
  },
};

export class RotationMotionEntity extends ListEntityBase {
  static entityType = 'rotation';
  static shortName = 'ROT';
  static longName = 'Rotation Motion';
  static inputParamsSchema = inputParamsSchema;

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

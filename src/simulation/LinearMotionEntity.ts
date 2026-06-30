import { ListEntityBase } from '../core/entities/ListEntityBase.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this linear motion.',
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
    hint: 'Select an edge or centerline to use as the travel direction.',
  },
  speed: {
    type: 'number',
    default_value: 10,
    hint: 'Linear speed in scene units per second.',
  },
  distance: {
    type: 'number',
    default_value: 0,
    hint: 'Optional travel distance. Leave blank to move continuously.',
  },
};

export class LinearMotionEntity extends ListEntityBase {
  static entityType = 'linear';
  static shortName = 'LIN';
  static longName = 'Linear Motion';
  static inputParamsSchema = inputParamsSchema;

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

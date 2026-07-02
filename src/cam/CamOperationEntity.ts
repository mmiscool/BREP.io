import { ListEntityBase } from '../core/entities/ListEntityBase.js';

export const CAM_OPERATION_TYPE_3_AXIS = 'cam3axis';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this CAM operation.',
  },
  name: {
    type: 'string',
    default_value: 'PNG Raster Toolpath',
    hint: 'Display name for this toolpath.',
  },
  enabled: {
    type: 'boolean',
    default_value: true,
    hint: 'Include this operation when generating G-code.',
  },
  targetSolids: {
    type: 'reference_selection',
    selectionFilter: ['SOLID'],
    multiple: true,
    default_value: [],
    hint: 'Solids to machine. Leave empty to use all visible solids.',
  },
  toolShape: {
    type: 'options',
    default_value: 'flat',
    options: [
      { value: 'flat', label: 'Flat End Mill' },
      { value: 'ball', label: 'Ball End Mill' },
      { value: 'vbit', label: 'V-bit' },
    ],
    hint: 'Cutter shape used by the pngcam heightmap sampler.',
  },
  includedAngleDeg: {
    type: 'number',
    default_value: 90,
    label: 'V-bit Angle',
    hint: 'Included angle in degrees for V-bit cutters.',
  },
  toolDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Cutter diameter in model units.',
  },
  stepover: {
    type: 'number',
    default_value: 1.5,
    hint: 'Distance between adjacent raster passes.',
  },
  stepDown: {
    type: 'number',
    default_value: 1,
    hint: 'Maximum Z depth per roughing level.',
  },
};

export class CamOperationEntity extends ListEntityBase {
  static entityType = CAM_OPERATION_TYPE_3_AXIS;
  static shortName = 'CAM3';
  static longName = 'CNC Toolpath';
  static inputParamsSchema = inputParamsSchema;

  static uiFieldsTest({ params = {} }: any = {}) {
    const exclude = ['enabled'];
    if (String(params.toolShape || 'flat') !== 'vbit') exclude.push('includedAngleDeg');
    return { exclude };
  }

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

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
    default_value: '3 Axis Raster',
    hint: 'Display name for this operation.',
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
  strategy: {
    type: 'options',
    default_value: 'waterline-raster',
    options: ['waterline-raster', 'waterline-contour', 'waterline-contour-low-hop'],
    hint: '3-axis strategy used to create toolpaths from horizontal cross sections.',
  },
  rasterAxis: {
    type: 'options',
    default_value: 'X',
    options: ['X', 'Y'],
    hint: 'Primary cutting direction for raster passes.',
  },
  cutRegion: {
    type: 'options',
    default_value: 'outside',
    options: ['outside', 'inside'],
    hint: 'Cut outside the target silhouette for profile/roughing, or inside it for pocket-style rastering.',
  },
  toolDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Cutter diameter in model units.',
  },
  toolLength: {
    type: 'number',
    default_value: 25,
    hint: 'Visible cutter length for simulation.',
  },
  stepover: {
    type: 'number',
    default_value: 1.5,
    hint: 'Distance between adjacent raster passes.',
  },
  stepDown: {
    type: 'number',
    default_value: 1,
    hint: 'Maximum Z depth per level.',
  },
  stockAllowance: {
    type: 'number',
    default_value: 0,
    hint: 'Extra material to leave around the generated cross section.',
  },
  stockMargin: {
    type: 'number',
    default_value: 6.35,
    hint: 'XY stock margin around target solids for outside roughing.',
  },
  safeHeight: {
    type: 'number',
    default_value: 5,
    hint: 'Safe clearance above the operation top.',
  },
  topZ: {
    type: 'number',
    default_value: null,
    hint: 'Optional operation top Z. Leave empty to use the target bounds.',
  },
  bottomZ: {
    type: 'number',
    default_value: null,
    hint: 'Optional operation bottom Z. Leave empty to use the target bounds.',
  },
  feedRate: {
    type: 'number',
    default_value: 800,
    hint: 'Cutting feed rate emitted in G-code.',
  },
  plungeRate: {
    type: 'number',
    default_value: 200,
    hint: 'Plunge feed rate emitted in G-code.',
  },
  spindleRPM: {
    type: 'number',
    default_value: 12000,
    hint: 'Spindle RPM emitted in G-code.',
  },
};

export class CamOperationEntity extends ListEntityBase {
  static entityType = CAM_OPERATION_TYPE_3_AXIS;
  static shortName = 'CAM3';
  static longName = '3 Axis CAM Operation';
  static inputParamsSchema = inputParamsSchema;

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

import { ListEntityBase } from '../core/entities/ListEntityBase.js';

export const CAM_OPERATION_TYPE_3_AXIS = 'cam3axis';

const CAM_ADVANCED_FIELD_GROUP = {
  key: 'advanced',
  label: 'Advanced',
};

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this CAM operation.',
  },
  name: {
    type: 'string',
    default_value: '3 Axis CAM Operation',
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
  targetFaces: {
    type: 'reference_selection',
    selectionFilter: ['FACE'],
    multiple: true,
    default_value: [],
    hint: 'Optional drive faces for finishing. The owning solid remains protected.',
  },
  strategy: {
    type: 'options',
    default_value: 'waterline-contour',
    options: [
      { value: 'waterline-contour', label: 'Waterline Contour' },
      { value: 'adaptive-waterline-contour', label: 'Adaptive Waterline Contour' },
      { value: 'waterline-contour-low-hop', label: 'Waterline Contour Low-Hop' },
      { value: 'parallel-finish-zig', label: 'Surface Finish Zig' },
      { value: 'parallel-finish-zig-zag', label: 'Surface Finish Zig-Zag' },
    ],
    hint: '3-axis strategy used to create waterline or surface-following toolpaths.',
  },
  rasterAxis: {
    type: 'options',
    default_value: 'X',
    options: ['X', 'Y'],
    hint: 'Primary cutting direction for raster passes.',
  },
  rasterAngleDeg: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional parallel finish cutting angle in degrees. Leave empty to use the X/Y axis selector.',
  },
  cutRegion: {
    type: 'options',
    default_value: 'outside',
    options: [
      { value: 'outside', label: 'Outside' },
      { value: 'inside', label: 'Inside' },
    ],
    hint: 'Cut outside the target silhouette for profile/roughing, or inside it for pocket-style rastering.',
  },
  linkMode: {
    type: 'options',
    default_value: 'retract',
    options: [
      { value: 'retract', label: 'Retract' },
      { value: 'low-hop', label: 'Low-Hop' },
      { value: 'feed-link', label: 'Feed Link' },
    ],
    hint: 'How safe links between generated passes should move.',
  },
  cutDirection: {
    type: 'options',
    default_value: 'auto',
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'climb', label: 'Climb' },
      { value: 'conventional', label: 'Conventional' },
    ],
    hint: 'Parallel finish cutting direction preference. Auto allows zig-zag reversal.',
  },
  toolShape: {
    type: 'options',
    default_value: 'flat',
    options: [
      { value: 'flat', label: 'Flat End Mill' },
      { value: 'ball', label: 'Ball End Mill' },
      { value: 'bull', label: 'Bull Nose' },
      { value: 'cone', label: 'Cone' },
      { value: 'ball-cone', label: 'Ball-Cone' },
    ],
    hint: 'Cutter profile used by surface-following CAM and cutter simulation metadata.',
  },
  toolDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Cutter diameter in model units.',
  },
  toolLength: {
    type: 'number',
    default_value: 25,
    label: 'Cutting Length',
    hint: 'Usable cutter cutting length. Shaft extension is optional metadata for visualization and collision checks.',
  },
  shaftLength: {
    type: 'number',
    default_value: 0,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional shaft extension above the cutting length for preview and collision checks.',
  },
  cornerRadius: {
    type: 'number',
    default_value: 0.25,
    hint: 'Bull-nose corner radius. Used when tool shape is bull.',
  },
  includedAngle: {
    type: 'number',
    default_value: 90,
    hint: 'Included cone angle in degrees. Used by cone and ball-cone tools.',
  },
  ballDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Ball diameter for ball-cone compound tools.',
  },
  maximumDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Maximum cutting diameter for cone and ball-cone tools.',
  },
  stepover: {
    type: 'number',
    default_value: 1.5,
    hint: 'Distance between adjacent raster passes.',
  },
  sampleSpacing: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Maximum adaptive sample spacing. Leave empty to use the cutter-based default.',
  },
  minSampleSpacing: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Smallest adaptive subdivision spacing. Leave empty to derive it from sample spacing.',
  },
  flatnessCosLimit: {
    type: 'number',
    default_value: 0.999,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Adaptive flatness threshold. Higher values preserve more detail.',
  },
  filterTolerance: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional cutter-location simplification tolerance. Leave empty to keep all generated path points.',
  },
  stepDown: {
    type: 'number',
    default_value: 1,
    hint: 'Maximum Z depth per level.',
  },
  stockAllowance: {
    type: 'number',
    default_value: 0,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional material allowance around generated boundaries and protected surface clearance.',
  },
  safeHeight: {
    type: 'number',
    default_value: 5,
    hint: 'Safe clearance above the operation top.',
  },
  topZ: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional operation top Z. Leave empty to use the target bounds.',
  },
  bottomZ: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional operation bottom Z. Leave empty to use the target bounds.',
  },
  floorZ: {
    type: 'number',
    default_value: null,
    uiGroup: CAM_ADVANCED_FIELD_GROUP,
    hint: 'Optional fallback minimum Z for surface-finish projection when no target contact is found.',
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

  static uiFieldsTest({ params = {} }: any = {}) {
    const shape = String(params.toolShape || 'flat').trim().toLowerCase();
    const strategy = String(params.strategy || 'waterline-contour').trim().toLowerCase();
    const isParallelFinish = strategy === 'parallel-finish-zig' || strategy === 'parallel-finish-zig-zag';
    const isAdaptiveWaterline = strategy === 'adaptive-waterline-contour';
    const isLowHopWaterline = strategy === 'waterline-contour-low-hop';
    const isWaterlineContour = strategy === 'waterline-contour' || isLowHopWaterline || isAdaptiveWaterline;
    const supportsTargetFaces = isParallelFinish || isWaterlineContour;
    const usesSampleSpacing = isParallelFinish || isWaterlineContour;
    const usesAdaptiveSampling = isParallelFinish || isAdaptiveWaterline;
    const supportsLineFiltering = isWaterlineContour || isParallelFinish;
    const exclude = ['enabled'];

    if (!supportsTargetFaces) exclude.push('targetFaces');
    if (isWaterlineContour) exclude.push('rasterAxis');
    if (!isParallelFinish) exclude.push('rasterAngleDeg');
    if ((!isWaterlineContour && !isParallelFinish) || isLowHopWaterline) exclude.push('linkMode');
    if (!isParallelFinish) exclude.push('cutDirection');
    if (isParallelFinish) exclude.push('cutRegion', 'stepDown', 'topZ', 'bottomZ');
    if (!isParallelFinish) exclude.push('floorZ');
    if (!usesSampleSpacing) exclude.push('sampleSpacing');
    if (!usesAdaptiveSampling) exclude.push('minSampleSpacing', 'flatnessCosLimit');
    if (!supportsLineFiltering) exclude.push('filterTolerance');

    if (shape !== 'bull') exclude.push('cornerRadius');
    if (shape !== 'cone' && shape !== 'ball-cone') exclude.push('includedAngle', 'maximumDiameter');
    if (shape !== 'ball-cone') exclude.push('ballDiameter');
    if (shape === 'cone' || shape === 'ball-cone') exclude.push('toolDiameter');
    return { exclude };
  }

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

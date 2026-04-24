import { OffsetShellSolid } from '../../BREP/OffsetShellSolid.js';

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Optional identifier used when naming the generated solid and faces',
  },
  distance: {
    type: 'number',
    default_value: 1,
    hint: 'Positive grows the shell, negative shrinks it',
  },
  faces: {
    type: 'reference_selection',
    selectionFilter: ['FACE'],
    multiple: true,
    default_value: [],
    hint: 'Pick one or more faces to remove and open while shelling the solid',
  },
  replaceOriginalSolid: {
    type: 'boolean',
    label: 'REPLACE ORIGINAL SOLID',
    default_value: true,
    hint: 'When enabled, remove the source solid and leave only the shell result in the scene.',
  },
};

export class OffsetShellFeature {
  static shortName = 'O.S';
  static longName = 'Offset Shell';
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(_partHistory) {
    try {
      OffsetShellSolid.generate(null, null, {
        featureId: this.inputParams.featureID || OffsetShellFeature.shortName || 'OffsetShell',
      });
    } catch (err) {
      console.warn('[OffsetShellFeature] Offset Shell is currently stubbed out.', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { added: [], removed: [] };
    }
    return { added: [], removed: [] };
  }
}

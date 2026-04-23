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
    const faceEntries = Array.isArray(this.inputParams.faces) ? this.inputParams.faces.filter(Boolean) : [];
    if (!faceEntries.length) {
      console.warn('[OffsetShellFeature] No faces selected.');
      return { added: [], removed: [] };
    }

    const solids = new Set();
    for (const entry of faceEntries) {
      if (!entry || entry.type !== 'FACE') continue;
      const solid = entry.parentSolid || (entry.parent && entry.parent.type === 'SOLID' ? entry.parent : null);
      if (solid) solids.add(solid);
    }

    if (!solids.size) {
      console.warn('[OffsetShellFeature] Selected faces are not attached to a solid.');
      return { added: [], removed: [] };
    }
    if (solids.size > 1) {
      console.warn('[OffsetShellFeature] Faces from multiple solids selected; aborting offset shell.');
      return { added: [], removed: [] };
    }

    const targetSolid = solids.values().next().value;
    const removeFaceNames = Array.from(new Set(faceEntries
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        return String(
          entry?.userData?.faceName
          || entry?.faceName
          || entry?.name
          || ''
        ).trim();
      })
      .filter(Boolean)));

    const dist = Number(this.inputParams.distance);
    if (!Number.isFinite(dist) || dist === 0) {
      console.warn('[OffsetShellFeature] Distance must be a non-zero finite number.');
      return { added: [], removed: [] };
    }

    const fallbackId = OffsetShellFeature.shortName || OffsetShellFeature.longName || 'OffsetShell';
    const featureId = (this.inputParams.featureID || fallbackId).trim();
    const newSolidName = `${targetSolid.name || 'Solid'}_${featureId}`;

    let resultSolid = null;
    try {
      resultSolid = OffsetShellSolid.generate(targetSolid, dist, {
        featureId,
        newSolidName,
        removeFaceNames,
      });
    } catch (err) {
      console.error('[OffsetShellFeature] Solid.offsetShell failed:', err);
      return { added: [], removed: [] };
    }

    if (!resultSolid) {
      console.warn('[OffsetShellFeature] offsetShell returned no result.');
      return { added: [], removed: [] };
    }

    const triangleEscapeDiagnostics = resultSolid?.__offsetDiagnostics?.triangleGenerationEscapeCheck || null;
    if (triangleEscapeDiagnostics?.enabled && Number(triangleEscapeDiagnostics.escapedTriangleCount || 0) > 0) {
      const topFaces = Object.entries(triangleEscapeDiagnostics.escapedFaceCounts || {})
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, 6)
        .map(([faceName, count]) => ({ faceName, count: Number(count) || 0 }));
      console.warn(
        `[OffsetShellFeature] Inward shell triangle diagnostics detected ${Number(triangleEscapeDiagnostics.escapedTriangleCount || 0)} `
        + `escaping emitted triangles while building "${newSolidName}".`,
        {
          escapedVertexCount: Number(triangleEscapeDiagnostics.escapedVertexCount || 0),
          topFaces,
        },
      );
    }

    const inwardEscapeDiagnostics = resultSolid?.__offsetDiagnostics?.inwardEscapeCheck || null;
    if (
      (!triangleEscapeDiagnostics?.enabled || Number(triangleEscapeDiagnostics.escapedTriangleCount || 0) <= 0)
      && inwardEscapeDiagnostics?.enabled
      && Number(inwardEscapeDiagnostics.rawEscapedVertexCount || 0) > 0
    ) {
      console.warn(
        `[OffsetShellFeature] Inward offset diagnostics detected ${Number(inwardEscapeDiagnostics.rawEscapedVertexCount || 0)} `
        + `source-escape vertices while building "${newSolidName}".`,
        {
          escapedVertices: (inwardEscapeDiagnostics.escapedVertices || []).slice(0, 8),
        },
      );
    }

    try { resultSolid.name = newSolidName; } catch {}
    try { resultSolid.visualize(); } catch {}

    const replaceOriginalSolid = this.inputParams.replaceOriginalSolid !== false;
    return {
      added: [resultSolid],
      removed: replaceOriginalSolid ? [targetSolid] : [],
    };
  }
}
